"""Deploy, roll back and switch models for the one HouseAtlas service on the NAS.

Every change is a record: build or validate, smoke-test on throwaway state, swap
the launchd service, verify through the gateway, and keep what is needed to undo
it. `rollback` undoes the newest live record. Host paths, hostnames and IDs live
in an env file outside Git (see README.md); nothing private is in this file.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import plistlib
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG = Path("~/.config/houseatlas/deploy-nas.env").expanduser()
REPO_URL = "https://github.com/EzraCerpac/HouseAtlas"

# Paths whose change can alter native storage. A match stops the deploy until a
# person has reviewed the diff and passes --storage-reviewed with the reason.
STORAGE_PATTERNS = (
    re.compile(r"^backend/migrations/"),
    re.compile(r"^backend/src/storage/"),
    re.compile(r"\.sql$"),
    re.compile(r"^backend/src/.*schema[^/]*\.rs$"),
    re.compile(r"^backend/src/providers/network/(durable|archive)\.rs$"),
)
# Embedded SQL anywhere in the backend: a changed line matching this also needs review.
STORAGE_DIFF_REGEX = r"(CREATE|ALTER|DROP) (TABLE|INDEX|VIEW|TRIGGER)|user_version|schema_version|SCHEMA_VERSION"
MODEL_FLAGS = {
    "publication.json": "--model-overview-manifest",
    "atlas-scene.json": "--atlas-scene-manifest",
    "reviewed-room-links.json": "--atlas-room-links-manifest",
}
# The server refuses room links that do not match the selected scene, so a release carries both.
REQUIRED_MODEL_FILES = ("publication.json", "atlas-scene.json", "reviewed-room-links.json")
NO_STORE = "private, no-store"
IMMUTABLE = "public, max-age=31536000, immutable"


class DeployError(RuntimeError):
    pass


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- configuration

@dataclass
class Config:
    setup_root: Path
    plist: Path
    label: str
    gateway_url: str
    smoke_template: Path
    toolchain_root: Path | None = None
    build_target: str = "x86_64-apple-darwin"
    repo_url: str = REPO_URL
    stop_timeout: int = 30
    start_timeout: int = 90

    @property
    def ledger(self) -> Path:
        return self.setup_root / "deploy-nas" / "ledger.jsonl"


def parse_env(text: str) -> dict[str, str]:
    values = {}
    for n, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key.strip()):
            raise DeployError(f"config line {n} is not KEY=value")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config(path: Path) -> Config:
    if not path.is_file():
        raise DeployError(f"no config at {path}; see tools/deploy-nas/README.md")
    v = parse_env(path.read_text())
    missing = [k for k in ("SETUP_ROOT", "PLIST", "SERVICE_LABEL", "GATEWAY_URL", "SMOKE_TEMPLATE") if k not in v]
    if missing:
        raise DeployError(f"config {path} is missing {', '.join(missing)}")
    p = lambda k: Path(os.path.expanduser(v[k]))
    return Config(
        setup_root=p("SETUP_ROOT"), plist=p("PLIST"), label=v["SERVICE_LABEL"],
        gateway_url=v["GATEWAY_URL"].rstrip("/"), smoke_template=p("SMOKE_TEMPLATE"),
        toolchain_root=p("TOOLCHAIN_ROOT") if "TOOLCHAIN_ROOT" in v else None,
        build_target=v.get("BUILD_TARGET", "x86_64-apple-darwin"),
        repo_url=v.get("REPO_URL", REPO_URL),
        stop_timeout=int(v.get("STOP_TIMEOUT", 30)), start_timeout=int(v.get("START_TIMEOUT", 90)),
    )


# ------------------------------------------------------------- service arguments

def read_plist(path: Path) -> dict:
    with open(path, "rb") as f:
        return plistlib.load(f)


def flag_value(args: list[str], flag: str) -> str | None:
    for i, a in enumerate(args[:-1]):
        if a == flag:
            return args[i + 1]
    return None


def with_flag(args: list[str], flag: str, value: str) -> list[str]:
    out = list(args)
    for i, a in enumerate(out[:-1]):
        if a == flag:
            out[i + 1] = value
            return out
    raise DeployError(f"service arguments have no {flag}")


def with_binary(service: dict, binary: Path) -> dict:
    out = dict(service)
    out["ProgramArguments"] = [str(binary)] + list(service["ProgramArguments"][1:])
    if "Program" in out:  # launchd runs Program, not ProgramArguments[0], when both exist
        out["Program"] = str(binary)
    return out


def with_model(service: dict, files: dict[str, Path]) -> dict:
    """Point every model flag the release provides at it, with its pinned SHA-256."""
    args = list(service["ProgramArguments"])
    for name, path in files.items():
        flag = MODEL_FLAGS[name]
        args = with_flag(args, flag, str(path))
        args = with_flag(args, flag + "-sha256", sha256_file(path))
    out = dict(service)
    out["ProgramArguments"] = args
    return out


SMOKE_FLAGS = {*MODEL_FLAGS.values(), *(f + "-sha256" for f in MODEL_FLAGS.values()), "--atlas-entry-building-id"}


def model_args(args: list[str]) -> list[str]:
    """Only the model pins and entry building: live-only selections (accounts, custody) need the live data."""
    out = []
    for i, a in enumerate(args[:-1]):
        if a in SMOKE_FLAGS:
            out += [a, args[i + 1]]
    return out


# --------------------------------------------------------------- storage gate

def storage_sensitive(paths: list[str]) -> list[str]:
    return [p for p in paths if any(r.search(p) for r in STORAGE_PATTERNS)]


# ------------------------------------------------------------- frontend union

def _files(root: Path) -> dict[str, Path]:
    return {str(p.relative_to(root)): p for p in sorted(root.rglob("*")) if p.is_file()}


def union_frontend(dist: Path, live: Path, out: Path) -> dict:
    """Copy the new build and keep every older top-level hashed asset, so open tabs keep loading."""
    if out.exists():
        raise DeployError(f"{out} already exists")
    new, old = _files(dist), _files(live)
    shutil.copytree(dist, out)
    retained, identical, dropped = 0, 0, []
    for rel, p in old.items():
        if rel in new:
            if rel.startswith("assets/"):
                if sha256_file(p) != sha256_file(new[rel]):
                    shutil.rmtree(out)
                    raise DeployError(f"asset name reused with different bytes: {rel}")
                identical += 1
            continue
        if rel.startswith("assets/") and "/" not in rel[len("assets/"):]:
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, out / rel)
            retained += 1
        else:
            dropped.append(rel)
    union = _files(out)
    closure = hashlib.sha256("".join(f"{k}\0{sha256_file(v)}\n" for k, v in union.items()).encode()).hexdigest()
    for p in [out, *out.rglob("*")]:
        p.chmod(p.stat().st_mode & ~0o077)
    return dict(new=len(new), live=len(old), retainedAssets=retained, identicalAssets=identical,
                droppedNonAssets=dropped, union=len(union), closureSha256=closure)


def entry_scripts(index_html: Path) -> list[str]:
    return sorted(set(re.findall(r'assets/[^"\'\s>]+\.js', index_html.read_text())))


# ------------------------------------------------------------ model releases

def validate_release(release: Path, data_dir: Path) -> dict[str, Path]:
    """Check a model release has the shape the server's overview selection accepts."""
    if release.is_symlink() or Path(os.path.realpath(release)) != release or not release.is_absolute():
        raise DeployError(f"{release} is not a canonical absolute path")
    st = release.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid():
        raise DeployError(f"{release} must be a 0700 directory owned by this user")
    real_data = Path(os.path.realpath(data_dir))
    if release == real_data or real_data in release.parents:
        raise DeployError("a model release cannot live inside the native data directory")
    files = {}
    for name in MODEL_FLAGS:
        p = release / name
        if not p.exists() and not p.is_symlink():
            if name in REQUIRED_MODEL_FILES:
                raise DeployError(f"{release} has no {name}")
            continue
        files[name] = p
    for p in [release / "overview.glb", *files.values()]:
        st = p.lstat() if (p.exists() or p.is_symlink()) else None
        if st is None:
            raise DeployError(f"{release} has no {p.name}")
        if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1 or st.st_uid != os.getuid():
            raise DeployError(f"{p} must be a regular 0600 file with one link, owned by this user")
    pub = json.loads(files["publication.json"].read_text())
    if not pub.get("publicationId"):
        raise DeployError("publication.json has no publicationId")
    return files


# ------------------------------------------------------------------ ledger

def ledger_records(path: Path) -> list[dict]:
    """Latest snapshot of each record, in creation order."""
    if not path.exists():
        return []
    latest: dict[str, dict] = {}
    for line in path.read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            latest[r["id"]] = r
    return list(latest.values())


def save_record(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record["updated"] = now()
    with open(path, "a") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def rollback_target(records: list[dict]) -> dict | None:
    live = [r for r in records if r["status"] in ("swapping", "swap-failed", "live", "verified", "verify-failed", "rolling-back")]
    return live[-1] if live else None


def next_name(root: Path, stem: str) -> str:
    n = 1
    while (root / f"{stem}-v{n}").exists() or (root / f"{stem}-v{n}-inputs").exists():
        n += 1
    return f"{stem}-v{n}"


# ------------------------------------------------------------------- runtime

class Runner:
    """Process, HTTP and launchd effects, kept in one place so tests can fake them."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.domain = f"gui/{os.getuid()}"

    def run(self, cmd, *, log: Path | None = None, cwd=None, env=None, check=True) -> subprocess.CompletedProcess:
        if log:
            with open(log, "a") as f:
                res = subprocess.run(cmd, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT, text=True)
        else:
            res = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
        if check and res.returncode != 0:
            tail = "" if log else (res.stderr or res.stdout)[-2000:]
            raise DeployError(f"{' '.join(map(str, cmd[:4]))} failed ({res.returncode}){': ' + tail if tail else f'; see {log}'}")
        return res

    def service_pid(self) -> int | None:
        res = self.run(["launchctl", "print", f"{self.domain}/{self.cfg.label}"], check=False)
        m = re.search(r"^\s+pid = (\d+)", res.stdout, re.M)
        return int(m.group(1)) if res.returncode == 0 and m else None

    def process_command(self, pid: int) -> str:
        return self.run(["ps", "-o", "command=", "-p", str(pid)], check=False).stdout.strip()

    def bootout(self) -> None:
        self.run(["launchctl", "bootout", f"{self.domain}/{self.cfg.label}"], check=False)

    def bootstrap(self) -> None:
        self.run(["launchctl", "bootstrap", self.domain, str(self.cfg.plist)])

    def alive(self, pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    def curl(self, url: str, *, method="GET", headers=(), cookie=None, data=None, insecure=False, timeout=30):
        cmd = ["curl", "-s", "--max-time", str(timeout), "-X", method, "-D", "/dev/stderr", "-o", "-"]
        if insecure:
            cmd.append("-k")
        for h in headers:
            cmd += ["-H", h]
        if cookie:
            cmd += ["-H", f"Cookie: {cookie}"]
        if data is not None:
            cmd += ["-H", "Content-Type: application/json", "--data", data]
        res = subprocess.run(cmd + [url], capture_output=True)
        if res.returncode != 0:  # refused, timed out or truncated: never a pass
            return 0, {}, b""
        return (*parse_head(res.stderr.decode("latin-1")), res.stdout)


def parse_head(text: str) -> tuple[int, dict]:
    """Status and headers of the final response; skips 1xx and proxy CONNECT blocks."""
    blocks = [b for b in text.replace("\r\n", "\n").split("\n\n") if b.startswith("HTTP/")]
    if not blocks:
        return 0, {}
    lines = blocks[-1].split("\n")
    parts = lines[0].split()
    hdrs = {}
    for line in lines[1:]:
        k, _, val = line.partition(":")
        hdrs.setdefault(k.strip().lower(), val.strip())
    return (int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0), hdrs


# ------------------------------------------------------------------- checks

@dataclass
class Checks:
    lines: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    def expect(self, ok: bool, what: str) -> bool:
        self.lines.append(f"{'PASS' if ok else 'FAIL'} {what}")
        if not ok:
            self.failures.append(what)
        return ok


def http_checks(rt: Runner, base: str, *, assets: list[str], ws: str, home: str,
                expect_publication: str | None = None, insecure=False) -> Checks:
    """What a phone needs after a deploy: login, shell pages, old and new assets, model, logout."""
    c = Checks()
    try:
        _http_checks(c, rt, base, assets, ws, home, expect_publication, insecure)
    except (ValueError, KeyError, TypeError, AttributeError) as e:  # malformed answer from the server
        c.expect(False, f"unexpected response: {type(e).__name__}: {e}")
    return c


def _http_checks(c: Checks, rt: Runner, base: str, assets, ws, home, expect_publication, insecure) -> None:
    hdr = [f"Origin: {base}", "Sec-Fetch-Site: same-origin"]
    get = lambda path, **kw: rt.curl(base + path, headers=hdr, insecure=insecure, **kw)
    code, _, body = get("/api/atlas/auth/mode")
    mode = json.loads(body or b"{}").get("mode") if code == 200 else None
    if not c.expect(mode is not None, f"auth mode answers ({code}, {mode})"):
        return
    login = "/api/atlas/auth/" + ("proxy" if mode == "trusted-proxy" else "local")
    code, h, _ = get(login, method="POST", data="{}")
    cookie = h.get("set-cookie", "").split(";")[0]
    if not c.expect(code == 200 and bool(cookie), f"login via {login} ({code})"):
        return
    for path in ("/", "/saved/index.html", "/saved/service-worker.js", "/offline-entry-worker.js"):
        code, h, _ = get(path, cookie=cookie)
        c.expect(code == 200 and h.get("cache-control") == NO_STORE, f"{path} {code} {h.get('cache-control')}")
    for a in assets:
        code, h, _ = get("/" + a, cookie=cookie)
        c.expect(code == 200 and h.get("cache-control") == IMMUTABLE, f"/{a} {code}")
    for path in ("/api/atlas/auth/session", f"/api/atlas/v1/workspaces/{ws}/homes/{home}/view", "/api/atlas/rooms"):
        code, _, _ = get(path, cookie=cookie)
        c.expect(code == 200, f"{path} {code}")
    code, _, body = get(f"/api/atlas/models/v1/workspaces/{ws}/homes/{home}/overview", cookie=cookie)
    if c.expect(code == 200, f"model overview descriptor {code}"):
        d = json.loads(body)
        if expect_publication:
            c.expect(d.get("publicationId") == expect_publication, f"model publication {d.get('publicationId')}")
        code, _, glb = get(d["original"]["href"], cookie=cookie, timeout=120)
        c.expect(code == 200 and hashlib.sha256(glb).hexdigest() == d["original"]["sha256"],
                 f"model GLB {code}, {len(glb)} bytes, SHA-256 matches descriptor")
    code, _, body = get("/api/atlas/auth/session", cookie=cookie)
    csrf = json.loads(body or b"{}").get("csrfToken", "") if code == 200 else ""
    code, _, _ = rt.curl(base + "/api/atlas/auth/logout", method="POST", cookie=cookie,
                         headers=hdr + [f"X-Atlas-CSRF: {csrf}"], insecure=insecure)
    after, _, _ = get("/api/atlas/auth/session", cookie=cookie)
    c.expect(code == 200 and after == 401, f"logout {code}, session afterwards {after}")


# -------------------------------------------------------------------- deploy

class Deployer:
    def __init__(self, cfg: Config, rt: Runner | None = None, out=sys.stdout):
        self.cfg, self.rt, self.out = cfg, rt or Runner(cfg), out

    def say(self, msg: str) -> None:
        print(msg, file=self.out, flush=True)

    @contextlib.contextmanager
    def lock(self):
        self.cfg.ledger.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cfg.ledger.parent / "lock", "w") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeployError("another deploy-nas run holds the lock")
            yield

    # -- live state

    def require_settled(self) -> None:
        for r in ledger_records(self.cfg.ledger):
            if r["status"] in ("swapping", "swap-failed", "rolling-back"):
                raise DeployError(f"{r['id']} was interrupted ({r['status']}); finish it with `deploy-nas rollback` first")

    def live(self) -> dict:
        service = read_plist(self.cfg.plist)
        args = service["ProgramArguments"]
        server_config = Path(flag_value(args, "--server-config") or "")
        conf = json.loads(server_config.read_text())
        return dict(service=service, binary=Path(args[0]), server_config=server_config,
                    frontend=Path(conf["frontendDirectory"]), data_dir=Path(conf["dataDirectory"]))

    def scope(self) -> tuple[str, str]:
        t = json.loads(self.cfg.smoke_template.read_text())
        return t["homes"][0]["workspaceId"], t["homes"][0]["homeId"]

    def live_sha(self, binary: Path) -> str | None:
        for r in reversed(ledger_records(self.cfg.ledger)):
            if r["status"] in ("live", "verified") and r.get("binary") == str(binary) and r.get("sha"):
                return r["sha"]
        m = re.search(r"houseatlas-main-([0-9a-f]{7,40})-", str(binary))
        return m.group(1) if m else None

    # -- throwaway server

    def smoke(self, binary: Path, frontend: Path, serve_args: list[str], work: Path, *,
              assets: list[str], expect_publication: str | None = None) -> Checks:
        work.mkdir(parents=True, exist_ok=True)
        conf = json.loads(self.cfg.smoke_template.read_text())
        if conf.get("authentication", {}).get("mode") != "loopback-local":
            raise DeployError("the smoke template must use loopback-local authentication")
        conf.update(dataDirectory=str(work / "data"), logDirectory=str(work / "data/logs"),
                    frontendDirectory=str(frontend), deploymentId=str(uuid.uuid4()))
        config = work / "server.json"
        config.write_text(json.dumps(conf, indent=1))
        config.chmod(0o600)
        host, port = conf["listen"].rsplit(":", 1)
        if self.rt.run(["lsof", "-nP", f"-iTCP@{host}:{port}", "-sTCP:LISTEN"], check=False).returncode == 0:
            raise DeployError(f"smoke port {conf['listen']} is already in use")
        self.rt.run([str(binary), "initialize", "--server-config", str(config)], log=work / "init.out")
        log = open(work / "serve.out", "w")
        proc = subprocess.Popen([str(binary), "serve", "--server-config", str(config), *serve_args],
                                cwd=work, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            for _ in range(60):
                if "listening" in (work / "serve.out").read_text() or proc.poll() is not None:
                    break
                time.sleep(1)
            if proc.poll() is not None:
                raise DeployError(f"smoke server exited: {(work / 'serve.out').read_text()[-1500:]}")
            ws, home = self.scope()
            checks = http_checks(self.rt, conf["origin"], assets=assets, ws=ws, home=home,
                                 expect_publication=expect_publication, insecure=True)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(15)
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            log.close()
        (work / "smoke.out").write_text("\n".join(checks.lines) + "\n")
        return checks

    # -- launchd swap

    def swap(self, record: dict, events: Path, frontend_moves: list[tuple[Path, Path]],
             expect: set[str] | None = None) -> None:
        """Stop, move frontends, write the plist, start. `expect`: plist hashes the service may have now."""
        def ev(msg):
            with open(events, "a") as f:
                f.write(f"{now()} {msg}\n")
            self.say(f"  {msg}")
        if expect is not None and sha256_file(self.cfg.plist) not in expect:
            raise DeployError("the service plist changed while this run was preparing; nothing was stopped")
        old = self.rt.service_pid()
        ev(f"STOP_OLD {old}")
        self.rt.bootout()
        deadline = time.monotonic() + self.cfg.stop_timeout
        while old and self.rt.alive(old) and time.monotonic() < deadline:
            time.sleep(0.5)
        if old and self.rt.alive(old):
            ev("OLD_STILL_RUNNING")
            self.rt.bootstrap()
            raise DeployError(f"old process {old} did not stop within {self.cfg.stop_timeout}s; service restarted unchanged")
        ev("OLD_GONE")
        for src, dst in frontend_moves:
            if dst.exists():
                raise DeployError(f"{dst} already exists")
            src.rename(dst)
            ev(f"MOVED {src.name} -> {dst.name}")
        tmp = self.cfg.plist.with_name(f".{self.cfg.plist.name}.deploy-nas")
        shutil.copyfile(record["after_plist"], tmp)
        tmp.chmod(0o600)
        os.replace(tmp, self.cfg.plist)  # atomic: an interruption leaves the whole old or new plist
        ev("PLIST_SWAPPED")
        self.rt.bootstrap()
        ev("BOOTSTRAPPED")

    def wait_running(self, binary: str) -> int:
        deadline = time.monotonic() + self.cfg.start_timeout
        while time.monotonic() < deadline:
            pid = self.rt.service_pid()
            if pid and self.rt.process_command(pid).startswith(binary + " serve"):
                code, _, _ = self.rt.curl(self.cfg.gateway_url + "/api/atlas/auth/mode", timeout=10)
                if code == 200:
                    return pid
            time.sleep(2)
        raise DeployError(f"service did not come up on {binary} within {self.cfg.start_timeout}s")

    def verify(self, record: dict, assets: list[str]) -> Checks:
        pid = self.wait_running(record["binary"])
        ws, home = self.scope()
        c = http_checks(self.rt, self.cfg.gateway_url, assets=assets, ws=ws, home=home,
                        expect_publication=record.get("publication"))
        c.lines.insert(0, f"PASS service pid {pid} runs {record['binary']}")
        return c

    def report(self, c: Checks, path: Path) -> None:
        path.write_text("\n".join(c.lines) + "\n")
        for line in c.lines:
            self.say(f"  {line}")

    def finish(self, record: dict, assets: list[str], auto_rollback: bool) -> dict:
        d = Path(record["dir"])
        try:
            c = self.verify(record, assets)
        except Exception as e:
            c = Checks()
            c.expect(False, str(e))
        self.report(c, d / "gateway-verify.txt")
        if not c.failures:
            record["status"] = "verified"
            save_record(self.cfg.ledger, record)
            self.say(f"Deployed and verified through the gateway: {record['id']}")
            return record
        record["status"] = "verify-failed"
        save_record(self.cfg.ledger, record)
        if not auto_rollback:
            raise DeployError(f"gateway verification failed; roll back with `deploy-nas rollback`")
        self.say("Gateway verification failed; rolling back.")
        self.rollback(record)
        raise DeployError("gateway verification failed; rolled back to the previous release")

    # -- commands

    def deploy(self, sha: str, *, prepare_only=False, storage_reviewed: str | None = None, auto_rollback=True) -> dict:
        cfg, rt = self.cfg, self.rt
        self.require_settled()
        baseline = sha256_file(cfg.plist)
        live = self.live()
        if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
            raise DeployError("give a commit SHA from main")
        name = next_name(cfg.setup_root, f"houseatlas-main-{sha[:7]}-{dt.date.today():%Y%m%d}")
        d, inp = cfg.setup_root / name, cfg.setup_root / f"{name}-inputs"
        prev_inputs = Path(str(live["binary"].parent.parent) + "-inputs")
        inp.mkdir(parents=True)
        self.say(f"[1/6] Fetching {sha} into {inp.name}")
        src = inp / "src"
        rt.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", cfg.repo_url, str(src)])
        full = rt.run(["git", "-C", str(src), "rev-parse", "--verify", f"{sha}^{{commit}}"]).stdout.strip()
        if rt.run(["git", "-C", str(src), "merge-base", "--is-ancestor", full, "origin/main"], check=False).returncode:
            raise DeployError(f"{full} is not on origin/main")
        rt.run(["git", "-C", str(src), "checkout", "-q", full])

        self.say("[2/6] Checking for storage changes since the live build")
        old_sha = self.live_sha(live["binary"])
        if not old_sha:
            raise DeployError(f"cannot tell which commit {live['binary']} was built from")
        changed = rt.run(["git", "-C", str(src), "diff", "--name-only", old_sha, full]).stdout.split()
        sensitive = sorted(set(storage_sensitive(changed)) | set(rt.run(
            ["git", "-C", str(src), "diff", "--name-only", "-G", STORAGE_DIFF_REGEX, old_sha, full, "--", "backend"]).stdout.split()))
        (inp / "storage-gate.txt").write_text(
            f"live {old_sha}\nnew {full}\nchanged {len(changed)}\n" + "".join(f"storage {p}\n" for p in sensitive)
            + (f"reviewed: {storage_reviewed}\n" if storage_reviewed else ""))
        if sensitive and not storage_reviewed:
            raise DeployError("storage-sensitive changes since the live build; review them and pass "
                              "--storage-reviewed '<reason>':\n  " + "\n  ".join(sensitive))
        self.say(f"  {len(changed)} files changed, {len(sensitive)} storage-sensitive")

        self.say("[3/6] Building backend and frontend")
        for cache in ("target", "npm-cache"):
            if (prev_inputs / cache).is_dir():
                rt.run(["cp", "-cR", str(prev_inputs / cache), str(inp / cache)])
        env = dict(os.environ, CARGO_TARGET_DIR=str(inp / "target"))
        if cfg.toolchain_root:
            env.update(CARGO_HOME=str(cfg.toolchain_root / "cargo"), RUSTUP_HOME=str(cfg.toolchain_root / "rustup"),
                       PATH=f"{cfg.toolchain_root / 'cargo/bin'}:{env['PATH']}")
        backend = subprocess.Popen(
            ["cargo", "build", "--release", "--locked", "--target", cfg.build_target, "-p", "houseatlas-backend"],
            cwd=src, env=env, stdout=open(inp / "backend-build.log", "w"), stderr=subprocess.STDOUT)
        fe_log = inp / "frontend-build.log"
        try:
            rt.run(["npm", "ci", "--cache", str(inp / "npm-cache"), "--no-audit", "--no-fund"], cwd=src / "frontend", log=fe_log)
            for script in ("typecheck", "build", "check:backend-frontend-compat"):
                rt.run(["npm", "run", script], cwd=src / "frontend", log=fe_log)
        finally:
            if backend.wait():
                raise DeployError(f"backend build failed; see {inp / 'backend-build.log'}")
        built = inp / "target" / cfg.build_target / "release" / "houseatlas"

        self.say("[4/6] Staging the binary and the frontend union")
        (d / "candidate").mkdir(parents=True)
        (d / "recovery").mkdir()
        binary = d / "candidate" / "houseatlas"
        shutil.copy2(built, binary)
        stage = live["frontend"].parent / f"frontend.next-{name}"
        union = union_frontend(src / "frontend" / "dist", live["frontend"], stage)
        (inp / "frontend-union.json").write_text(json.dumps(union, indent=1))
        self.say(f"  binary {sha256_file(binary)[:12]} (live {sha256_file(live['binary'])[:12]}), "
                 f"frontend {union['new']} new + {union['retainedAssets']} retained assets")
        assets = sorted(set(entry_scripts(src / "frontend/dist/index.html")) | set(entry_scripts(live["frontend"] / "index.html")))

        self.say("[5/6] Smoke-testing on throwaway state")
        c = self.smoke(binary, stage, model_args(live["service"]["ProgramArguments"]), inp / "smoke", assets=assets)
        for line in c.lines:
            self.say(f"  {line}")
        if c.failures:
            raise DeployError("smoke test failed; nothing live was touched")

        before, after = d / "recovery/service.before.plist", d / "recovery/service.after.plist"
        shutil.copy2(cfg.plist, before)
        if sha256_file(before) != baseline:
            raise DeployError("the service plist changed during the build; nothing live was touched, run deploy again")
        with open(after, "wb") as f:
            plistlib.dump(with_binary(live["service"], binary), f)
        rt.run(["plutil", "-lint", str(after)])
        parked = live["frontend"].parent / f"frontend.before-{name}"
        record = dict(id=name, kind="code", sha=full, dir=str(d), binary=str(binary), previous_binary=str(live["binary"]),
                      before_plist=str(before), after_plist=str(after), frontend=str(live["frontend"]),
                      staged_frontend=str(stage), parked_frontend=str(parked), assets=assets,
                      status="prepared", created=now())
        write_rollback_script(record, cfg)
        save_record(cfg.ledger, record)
        if prepare_only:
            self.say(f"Prepared {name}; nothing live was touched. Deploy it with `deploy-nas deploy {sha}`.")
            return record

        self.say("[6/6] Swapping the service and verifying through the gateway")
        record["status"] = "swapping"
        save_record(cfg.ledger, record)
        try:
            self.swap(record, d / "events.log", [(live["frontend"], parked), (stage, live["frontend"])], expect={baseline})
        except Exception:
            record["status"] = "swap-failed"
            save_record(cfg.ledger, record)
            self.say("Swap failed; restoring the previous release.")
            self.rollback(record)
            raise
        record["status"] = "live"
        save_record(cfg.ledger, record)
        return self.finish(record, assets, auto_rollback)

    def model(self, release: Path, *, prepare_only=False, auto_rollback=True) -> dict:
        cfg = self.cfg
        self.require_settled()
        baseline = sha256_file(cfg.plist)
        live = self.live()
        release = release.expanduser()
        files = validate_release(release, live["data_dir"])
        publication = json.loads(files["publication.json"].read_text())["publicationId"]
        name = next_name(cfg.setup_root, f"model-switch-{release.name}-{dt.date.today():%Y%m%d}")
        d = cfg.setup_root / name
        (d / "recovery").mkdir(parents=True)
        service = with_model(live["service"], files)
        self.say(f"[1/3] Smoke-testing publication {publication} on throwaway state")
        assets = entry_scripts(live["frontend"] / "index.html")
        c = self.smoke(live["binary"], live["frontend"], model_args(service["ProgramArguments"]), d / "smoke",
                       assets=assets, expect_publication=publication)
        for line in c.lines:
            self.say(f"  {line}")
        if c.failures:
            raise DeployError("smoke test failed; nothing live was touched")
        before, after = d / "recovery/service.before.plist", d / "recovery/service.after.plist"
        shutil.copy2(cfg.plist, before)
        if sha256_file(before) != baseline:
            raise DeployError("the service plist changed during the smoke test; nothing live was touched, run model again")
        with open(after, "wb") as f:
            plistlib.dump(service, f)
        self.rt.run(["plutil", "-lint", str(after)])
        record = dict(id=name, kind="model", release=str(release), publication=publication, dir=str(d),
                      binary=str(live["binary"]), before_plist=str(before), after_plist=str(after),
                      assets=assets, status="prepared", created=now())
        write_rollback_script(record, cfg)
        save_record(cfg.ledger, record)
        if prepare_only:
            self.say(f"Prepared {name}; nothing live was touched.")
            return record
        self.say("[2/3] Restarting the service on the new model")
        record["status"] = "swapping"
        save_record(cfg.ledger, record)
        try:
            self.swap(record, d / "events.log", [], expect={baseline})
        except Exception:
            record["status"] = "swap-failed"
            save_record(cfg.ledger, record)
            self.rollback(record)
            raise
        record["status"] = "live"
        save_record(cfg.ledger, record)
        self.say("[3/3] Verifying through the gateway")
        return self.finish(record, assets, auto_rollback)

    def rollback(self, record: dict | None = None, *, force=False) -> dict:
        cfg = self.cfg
        if record is None:
            record = rollback_target(ledger_records(cfg.ledger))
            if record is None:
                raise DeployError("no live deploy-nas record to roll back")
        expected = {sha256_file(Path(record["after_plist"]))}
        if record["status"] in ("swapping", "swap-failed", "rolling-back"):  # interrupted: either side is consistent
            expected.add(sha256_file(Path(record["before_plist"])))
        if force:
            expected = None
        elif sha256_file(cfg.plist) not in expected:
            raise DeployError(f"the service no longer matches {record['id']}; inspect it, or pass --force")
        if (record["kind"] == "code" and record["status"] in ("live", "verified", "verify-failed")
                and not Path(record["parked_frontend"]).exists() and not force):
            raise DeployError(f"the parked frontend {record['parked_frontend']} is missing; rolling back would mix "
                              "the old binary with the new frontend. Restore it, or pass --force")
        self.say(f"Rolling back {record['id']}")
        d = Path(record["dir"])
        moves = []
        if record["kind"] == "code":
            live, parked = Path(record["frontend"]), Path(record["parked_frontend"])
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{uuid.uuid4().hex[:6]}"
            if parked.exists() and live.exists():
                # The old build plus the newer build's hashed assets, so tabs opened on it keep loading chunks.
                restored = live.parent / f"frontend.restored-{record['id']}-{stamp}"
                union = union_frontend(parked, live, restored)
                self.say(f"  restored frontend keeps {union['retainedAssets']} assets from the rolled-back build")
                moves = [(live, live.parent / f"frontend.rolled-back-{record['id']}-{stamp}"), (restored, live)]
            elif parked.exists():  # interrupted after the live frontend was moved aside
                moves = [(parked, live)]
        record["status"] = "rolling-back"  # a retry after an interruption picks this record up again
        save_record(cfg.ledger, record)
        restore = dict(record, after_plist=record["before_plist"])
        self.swap(restore, d / "events.log", moves, expect=expected)
        record["status"] = "rolled-back"
        save_record(cfg.ledger, record)
        restored = Path(record["before_plist"])
        binary = read_plist(restored)["ProgramArguments"][0]
        try:
            pid = self.wait_running(binary)
            ws, home = self.scope()
            assets = sorted(set(entry_scripts(Path(record.get("frontend") or self.live()["frontend"]) / "index.html"))
                            | set(record.get("assets", [])))
            c = http_checks(self.rt, cfg.gateway_url, assets=assets, ws=ws, home=home)
            c.lines.insert(0, f"PASS service pid {pid} runs {binary}")
        except Exception as e:
            c = Checks()
            c.expect(False, str(e))
        self.report(c, d / "rollback-verify.txt")
        if c.failures:
            raise DeployError(f"rolled back, but the restored service fails verification; see {d / 'rollback-verify.txt'}")
        self.say(f"Rolled back {record['id']} and verified the restored service through the gateway.")
        return record

    def status(self) -> None:
        live = self.live()
        pid = self.rt.service_pid()
        args = live["service"]["ProgramArguments"]
        pub_path = flag_value(args, "--model-overview-manifest")
        pub = json.loads(Path(pub_path).read_text()) if pub_path else {}
        code, _, body = self.rt.curl(self.cfg.gateway_url + "/api/atlas/auth/mode", timeout=10)
        self.say(f"service   {self.cfg.label} pid {pid or 'not running'}")
        self.say(f"binary    {live['binary']} (commit {self.live_sha(live['binary']) or 'unknown'})")
        self.say(f"model     {pub.get('publicationId')} {pub.get('label', '')}")
        self.say(f"gateway   {code} {body.decode(errors='replace')[:80]}")
        for r in ledger_records(self.cfg.ledger)[-5:]:
            self.say(f"record    {r['updated']} {r['status']:<13} {r['id']}")


def write_rollback_script(record: dict, cfg: Config) -> None:
    """A standalone undo that works without this checkout. Prefer `deploy-nas rollback`."""
    d = Path(record["dir"])
    domain = f"gui/{os.getuid()}"
    lines = ["#!/bin/bash", f"# Undo {record['id']} without deploy-nas. Prefer `deploy-nas rollback`.", "set -eu",
             f"launchctl bootout {domain}/{cfg.label} || true",
             f"while launchctl print {domain}/{cfg.label} >/dev/null 2>&1; do sleep 1; done"]
    if record["kind"] == "code":
        live, parked = record["frontend"], record["parked_frontend"]
        lines += [f'mv "{live}" "{live}.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"', f'mv "{parked}" "{live}"']
    lines += [f'cp "{record["before_plist"]}" "{cfg.plist}"', f'chmod 600 "{cfg.plist}"',
              f"launchctl bootstrap {domain} \"{cfg.plist}\""]
    p = d / "recovery" / "rollback.sh"
    p.write_text("\n".join(lines) + "\n")
    p.chmod(0o700)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="deploy-nas", description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=Path(os.environ.get("HOUSEATLAS_DEPLOY_CONFIG", DEFAULT_CONFIG)))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="show the live service, model and recent records")
    p = sub.add_parser("deploy", help="build a main commit, smoke-test it, swap it in and verify it")
    p.add_argument("sha")
    p.add_argument("--prepare-only", action="store_true", help="stop before touching the live service")
    p.add_argument("--storage-reviewed", metavar="REASON", help="accept reviewed storage-sensitive changes")
    p.add_argument("--no-auto-rollback", action="store_true", help="leave a failed release live for inspection")
    p = sub.add_parser("model", help="switch the served model to a release folder")
    p.add_argument("release", type=Path)
    p.add_argument("--prepare-only", action="store_true")
    p.add_argument("--no-auto-rollback", action="store_true")
    p = sub.add_parser("rollback", help="undo the newest live record")
    p.add_argument("--force", action="store_true", help="roll back even if the service plist changed since")
    a = ap.parse_args(argv)
    try:
        dep = Deployer(load_config(a.config))
        if a.cmd == "status":
            dep.status()
            return 0
        with dep.lock():
            if a.cmd == "deploy":
                dep.deploy(a.sha, prepare_only=a.prepare_only, storage_reviewed=a.storage_reviewed,
                           auto_rollback=not a.no_auto_rollback)
            elif a.cmd == "model":
                dep.model(a.release, prepare_only=a.prepare_only, auto_rollback=not a.no_auto_rollback)
            else:
                dep.rollback(force=a.force)
        return 0
    except DeployError as e:
        print(f"deploy-nas: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
