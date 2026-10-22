"""PREPARED ONLY: explicit healthy generated-store cases; see Python parity document.

Future entry requires a separately reviewed restrictive parent launcher, -I -S,
an empty identity-pinned generated root and its one fixed numeric fixture port.
No import, --help, fixture or executable invocation is a preparation check.
"""

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time
import traceback


PINS = {
    "old": {"source": "20acc832919f4d5b7ec93e6d6641660f999e7688", "bytes": 40994600,
            "sha256": "2699f230c03084b1ecb1f86b577615a25a51470fe2c2bd994d0fdcb0452db7d0"},
    "new": {"source": "d36a48546a92b58cb3c515d8034272dfa1d92e5a", "bytes": 41093032,
            "sha256": "107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941"},
}
MAX_FILE, MAX_OUTPUT = 64 * 1024 * 1024, 4 * 1024 * 1024
REQUIRED = {"atlas.sqlite", "access.sqlite", "server-state.json", "server.lock",
            "logs/server.events.jsonl"}
DIRECTORIES = {"logs", "media", "media/blobs", "media/staging"}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def uid(number):
    return "00000000-0000-4000-8000-" + str(number).zfill(12)


def sha(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def decoded(data):
    if isinstance(data, bytes):
        data = data.decode("utf-8", errors="strict")
    require(type(data) is str, "JSON input must be explicit UTF-8 bytes or text")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def invalid(value):
        raise RuntimeError("Non-finite JSON number: " + value)

    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)


def integer(value, name):
    # Preserve JSON Number-category 1 == 1.0 without ever coercing exact ints.
    require(type(value) is int or (type(value) is float and value.is_integer()),
            name + " must be an integer-valued JSON number, not a boolean")
    return value


def json_equal(left, right):
    # JSON booleans and numbers are distinct categories, including recursively.
    numbers = (int, float)
    if type(left) in numbers and type(right) in numbers:
        return left == right
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    if type(left) is list:
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    require(type(left) in (str, bool, type(None)), "Unsupported JSON comparison category")
    return left == right


def canonical(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path))
            and path.resolve(strict=True) == path, "Exact canonical absolute path required")
    for current in (path, *path.parents):
        info = current.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid in (0, os.getuid()),
                "Path alias or unexpected owner")
        sticky_tmp = (current == Path("/private/tmp") and stat.S_ISDIR(info.st_mode)
                      and info.st_uid == 0 and info.st_mode & stat.S_ISVTX)
        require(not info.st_mode & 0o022 or sticky_tmp, "Writable path ancestry refused")
    return path.lstat()


def regular(path, executable=False):
    info = canonical(path)
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= MAX_FILE,
            "Bounded regular single-link file required")
    require(not executable or info.st_mode & 0o111, "Existing executable required")
    return info


def identity(info):
    return info.st_dev, info.st_ino


def read_bytes(path):
    before = regular(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require(identity(opened) == identity(before), "Opened file identity changed")
        chunks, length = [], 0
        while True:
            chunk = os.read(fd, min(65536, MAX_FILE + 1 - length))
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
            require(length <= MAX_FILE, "File grew beyond byte budget")
        after, named = os.fstat(fd), Path(path).lstat()
        for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink", "st_mode"):
            require(getattr(opened, field) == getattr(after, field) == getattr(named, field),
                    "File changed during bounded capture")
        require(length == opened.st_size, "File length changed")
        return b"".join(chunks)
    finally:
        os.close(fd)


# A generated helper body, not an independently selectable top-level case.
# Only observation copies are read; no immutable=1, extension or attached store.
SQLITE_TOOL = r'''
import json, os, sqlite3, stat, sys, time
from pathlib import Path
action, root_name, device, inode, directory = sys.argv[1:]
root, base = Path(root_name), Path(directory)
assert action in ('observe', 'hold-wal') and sys.flags.isolated and sys.flags.no_site
assert not sys.flags.optimize
assert root.is_absolute() and root.resolve() == root
r = root.lstat()
assert (r.st_dev, r.st_ino) == (int(device), int(inode))
assert stat.S_ISDIR(r.st_mode) and r.st_uid == os.getuid() and r.st_mode & 0o777 == 0o700
assert base != root and base.is_relative_to(root) and base.resolve() == base
for parent in (base, *base.parents):
    s = parent.lstat()
    assert not stat.S_ISLNK(s.st_mode)
    if parent == root:
        break
    assert stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and s.st_mode & 0o777 == 0o700
connections = []
deadline = time.monotonic() + 30
for name in ['atlas.sqlite', 'access.sqlite']:
    path = base / name
    s = path.lstat()
    assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1
    assert s.st_uid == os.getuid() and s.st_mode & 0o777 == 0o600
    db = sqlite3.connect(path.as_uri() + ('?mode=rw' if action == 'hold-wal' else '?mode=ro'),
                         uri=True, timeout=2)
    db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
    connections.append((name, db))
if action == 'hold-wal':
    for name, db in connections:
        assert db.execute('PRAGMA main.journal_mode=WAL').fetchall() == [('wal',)]
        db.execute('PRAGMA wal_autocheckpoint=0')
    print('WAL_KEEPER_READY', flush=True)
    assert sys.stdin.readline() == 'close\n'
    for name, db in connections:
        db.close()
    print('WAL_KEEPER_CLOSED', flush=True)
else:
    result = {'sqliteVersion': sqlite3.sqlite_version, 'stores': {}}
    def enc(v):
        return {'blobHex': v.hex()} if isinstance(v, bytes) else v
    def quote(v):
        return '"' + v.replace('"', '""') + '"'
    for name, db in connections:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        attached = db.execute('PRAGMA database_list').fetchall()
        assert len(attached) == 1 and attached[0][1] == 'main'
        integrity = db.execute('PRAGMA main.integrity_check').fetchall()
        foreign = db.execute('PRAGMA main.foreign_key_check').fetchall()
        assert integrity == [('ok',)], repr(integrity)
        assert foreign == [], repr(foreign)
        schema = db.execute('SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name').fetchall()
        tables = {}
        for kind, table, _, sql in schema:
            if kind != 'table':
                continue
            columns = [r[1] for r in db.execute('PRAGMA main.table_info(' + quote(table) + ')')]
            rows = [[enc(v) for v in row] for row in db.execute('SELECT * FROM main.' + quote(table))]
            rows.sort(key=lambda r: json.dumps(r, ensure_ascii=True, separators=(',', ':')))
            tables[table] = {'columns': columns, 'rows': rows,
                'foreignKeys': db.execute('PRAGMA main.foreign_key_list(' + quote(table) + ')').fetchall()}
        result['stores'][name] = {'integrity': integrity, 'foreignKeyCheck': foreign, 'schema': schema,
            'userVersion': db.execute('PRAGMA main.user_version').fetchone()[0],
            'applicationId': db.execute('PRAGMA main.application_id').fetchone()[0],
            'journalMode': db.execute('PRAGMA main.journal_mode').fetchone()[0],
            'pageCount': db.execute('PRAGMA main.page_count').fetchone()[0],
            'freelistCount': db.execute('PRAGMA main.freelist_count').fetchone()[0], 'tables': tables}
        db.rollback()
        db.close()
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
'''


class OwnedChild:
    """Owned Popen only; independent deadline/escalation even during parent waits."""

    def __init__(self, run, executable, args, label, lifetime):
        self.run, self.label = run, label
        self.failure, self.escalation = None, None
        self.closed = threading.Event()
        self.buffers = {"stdout": bytearray(), "stderr": bytearray()}
        self.record = {"label": label, "executable": str(executable), "args": args,
                       "startedAtMs": now(), "status": "starting"}
        with run.lock:
            run.check()
            run.receipt["processes"].append(self.record)
        try:
            self.process = subprocess.Popen(
                [str(executable), *args], cwd=run.root, env=run.env,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                close_fds=True, pass_fds=(), start_new_session=False, bufsize=0)
        except BaseException as error:
            with run.lock:
                self.record.update(status="spawn-failed", error=str(error))
            raise
        with run.lock:
            self.record["pid"] = self.process.pid
            run.owned.add(self)
            self.lifetime = threading.Timer(lifetime, self.expire)
            self.lifetime.daemon = True
            self.monitor = threading.Thread(target=self.observe_close, daemon=True)
            self.monitor.start()
            self.lifetime.start()
            if run.interruption:
                self.fail("Interrupted by " + run.interruption)
                self.terminate()
        run.persist()

    def fail(self, reason):
        with self.run.lock:
            if self.failure is None:
                self.failure = reason
            self.record["status"] = "uncertain"

    def expire(self):
        with self.run.lock:
            if not self.closed.is_set():
                self.fail(self.label + ": deadline; outcome uncertain")
                self.terminate()

    def terminate(self):
        with self.run.lock:
            if self.closed.is_set() or self not in self.run.owned or self.escalation is not None:
                return
            self.escalation = threading.Timer(7, self.force)
            self.escalation.daemon = True
            self.escalation.start()  # First request establishes the bound before TERM.
            if self.process.poll() is None:
                self.process.terminate()

    def force(self):
        with self.run.lock:
            if not self.closed.is_set() and self in self.run.owned and self.process.poll() is None:
                self.fail(self.label + ": KILL escalation; outcome uncertain")
                self.process.kill()

    def observe_close(self):
        selector = None
        ended, streams_eof = None, True
        try:
            selector = selectors.DefaultSelector()
            for name, stream in (("stdout", self.process.stdout), ("stderr", self.process.stderr)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map() or self.process.poll() is None:
                for key, _ in selector.select(0.05):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                        continue
                    with self.run.lock:
                        available = MAX_OUTPUT - sum(map(len, self.buffers.values()))
                        self.buffers[key.data].extend(chunk[:available])
                        if len(chunk) > available:
                            self.fail(self.label + ": output bound; outcome uncertain")
                            self.terminate()
                if self.process.poll() is not None:
                    ended = ended or time.monotonic()
                    if selector.get_map() and time.monotonic() - ended > 2:
                        streams_eof = False
                        self.fail(self.label + ": pipe EOF unconfirmed after child exit")
                        break
        except BaseException as error:
            streams_eof = False
            self.fail(self.label + ": monitor error: " + repr(error))
            self.terminate()
        finally:
            # Never call a timed-out child closed merely because terminate() returned.
            code = self.process.wait()
            for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
                if not stream.closed:
                    stream.close()
            if selector is not None:
                selector.close()
            with self.run.lock:
                self.lifetime.cancel()
                if self.escalation is not None:
                    self.escalation.cancel()
                self.record.update(
                    code=code, signal=(-code if code < 0 else None), endedAtMs=now(),
                    status="uncertain" if self.failure else "closed" if code == 0 else "failed",
                    error=self.failure, reaped=True, streamsEOF=streams_eof,
                    **{key: value.decode("utf-8", errors="replace") for key, value in self.buffers.items()})
                self.run.owned.discard(self)
                self.closed.set()

    def input(self, data=b""):
        try:
            if data:
                self.process.stdin.write(data)
            self.process.stdin.close()
        except (BrokenPipeError, OSError) as error:
            self.fail(self.label + ": stdin closure uncertain: " + str(error))
            self.terminate()

    def finish(self):
        self.closed.wait()  # Independently scheduled TERM/KILL remain live while waiting.
        require(not self.failure and self.record["code"] == 0,
                self.failure or self.label + ": nonzero close; retain and stop")
        return bytes(self.buffers["stdout"])

    def ready(self, marker):
        deadline = time.monotonic() + 15
        while True:
            self.run.check()
            with self.run.lock:
                require(not self.closed.is_set() and self.process.poll() is None and not self.failure,
                        self.failure or self.label + ": child closed before readiness")
                if marker.encode() in self.buffers["stdout"]:
                    return
            require(time.monotonic() < deadline, self.label + ": readiness uncertain")
            time.sleep(0.025)


def now():
    return time.time_ns() // 1_000_000


class Run:
    def __init__(self, options):
        self.options, self.root = options, Path(options["--fixture-root"])
        self.expected_identity = (int(options["--fixture-device"]), int(options["--fixture-inode"]))
        self.root_info = canonical(self.root)
        require(identity(self.root_info) == self.expected_identity and stat.S_ISDIR(self.root_info.st_mode)
                and self.root_info.st_uid == os.getuid() and stat.S_IMODE(self.root_info.st_mode) == 0o700,
                "Fresh launcher root identity/owner/0700 mismatch")
        require(self.root != Path("/") and not list(self.root.iterdir()), "Launcher root must be fresh and empty")
        self.root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        require(identity(os.fstat(self.root_fd)) == self.expected_identity, "Root descriptor identity mismatch")
        self.lock, self.owned = threading.RLock(), set()
        self.interruption, self.connection, self.active = None, None, None
        self.sequence, self.observations = 0, 0
        self.window, self.cookie, self.csrf = None, None, None
        self.port = int(options["--fixture-port"])
        require(str(self.port) == options["--fixture-port"] and 1024 <= self.port <= 65535,
                "One canonical numeric unprivileged fixture port required")
        self.origin = "https://127.0.0.1:" + str(self.port)
        self.prefix = f"/api/atlas/v1/workspaces/{uid(1)}/homes/{uid(2)}"
        self.receipt = {"format": "houseatlas-generated-storage-python/1", "status": "in-progress",
                        "case": options["--case"], "pins": PINS, "startedAtMs": now(),
                        "root": str(self.root), "rootDevice": self.expected_identity[0],
                        "rootInode": self.expected_identity[1], "fixturePort": self.port,
                        "harnessSha256": sha(read_bytes(Path(__file__).resolve(strict=True))),
                        "pythonVersion": sys.version, "processes": [], "requests": [], "observations": []}

    def check(self):
        require(not self.interruption, "Interrupted run: " + str(self.interruption))
        info = self.root.lstat()
        require(identity(info) == self.expected_identity == identity(os.fstat(self.root_fd))
                and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
                and info.st_uid == os.getuid(), "Generated root changed")

    def fence(self, path):
        self.check()
        path = Path(path)
        require(path != self.root and path.is_relative_to(self.root)
                and os.path.normpath(str(path)) == str(path), "Generated path escaped exact root")
        canonical(path.parent)
        return path

    def put(self, path, data, mode=0o600):
        path = self.fence(path)
        if isinstance(data, str):
            data = data.encode("utf-8")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, "wb") as output:
            output.write(data)

    def mkdir(self, path):
        os.mkdir(self.fence(path), 0o700)

    def persist(self):
        # Final uncertainty receipts must remain possible after an interruption.
        with self.lock:
            info = self.root.lstat()
            require(identity(info) == self.expected_identity == identity(os.fstat(self.root_fd))
                    and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
                    and info.st_uid == os.getuid(), "Cannot safely retain receipt: root changed")
            self.sequence += 1
            name, snapshot = f"receipt-{self.sequence:03d}.json", copy.deepcopy(self.receipt)
        # No filesystem I/O holds the lock needed by TERM/KILL timer callbacks.
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.root_fd)
        with os.fdopen(fd, "wb") as output:
            output.write(encoded(snapshot) + b"\n")

    def interrupt(self, reason):
        with self.lock:
            self.interruption = self.interruption or reason
            self.receipt.update(status="uncertain", interruption=self.interruption)
            for child in tuple(self.owned):
                child.fail("Interrupted by " + self.interruption)
                child.terminate()
            if self.connection is not None:
                self.abort_socket(self.connection)

    def launch(self, executable, args, label, lifetime=35):
        self.check()
        info = regular(executable, executable=True)
        role = next((role for role in PINS if executable == self.root / "bin" / role), None)
        if role:
            require(info.st_size == PINS[role]["bytes"] and sha(read_bytes(executable)) == PINS[role]["sha256"],
                    "Owned executable pin mismatch")
        else:
            require(identity(info) == self.tools[str(executable)]["identity"]
                    and sha(read_bytes(executable)) == self.tools[str(executable)]["sha256"], "Tool identity changed")
        return OwnedChild(self, executable, args, label, lifetime)

    def command(self, executable, args, label):
        child = self.launch(executable, args, label)
        child.input()
        return child.finish()

    def helper(self, action, data, label, lifetime=35):
        return self.launch(self.python, ["-I", "-S", str(self.root / "sqlite-tool.py"), action,
                           str(self.root), str(self.expected_identity[0]), str(self.expected_identity[1]), str(data)],
                           label, lifetime)

    def tree(self, source, target=None):
        self.fence(source)
        if target is not None:
            self.mkdir(target)
        files, total = [], 0

        def walk(directory, destination, relative=""):
            nonlocal total
            self.check()
            info = canonical(directory)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o700, "Private generated directory required")
            for member in sorted(directory.iterdir()):
                key = relative + member.name
                copied = destination / member.name if destination is not None else None
                info = member.lstat()
                if stat.S_ISDIR(info.st_mode):
                    require(key in DIRECTORIES, "Unexpected persistent directory")
                    if copied is not None:
                        self.mkdir(copied)
                    walk(member, copied, key + "/")
                else:
                    require(key in REQUIRED or re.fullmatch(r"(atlas|access)\.sqlite-(wal|shm)", key),
                            "Unexpected persistent member/media byte/rollback journal")
                    require(stat.S_IMODE(info.st_mode) == 0o600, "Private generated file mode required")
                    content = read_bytes(member)
                    total += len(content)
                    require(total <= 128 * 1024 * 1024 and len(files) < 256, "Tree budget exceeded")
                    files.append({"path": key, "bytes": len(content), "sha256": sha(content), "mode": 0o600})
                    if copied is not None:
                        self.put(copied, content)
        walk(source, target)
        require(REQUIRED.issubset({item["path"] for item in files}), "Required generated member missing")
        return files

    def observe(self, data, label):
        self.observations += 1
        target = self.root / f"observation-{self.observations}"
        files = self.tree(data, target)
        child = self.helper("observe", target, label)
        child.input()
        result = decoded(child.finish())
        self.receipt["observations"].append({"label": label, "files": files, "result": result})
        self.persist()
        return result

    def install(self, baseline, data):
        for name in ("atlas.sqlite", "access.sqlite"):
            self.check()
            require(all(not (data / (name + suffix)).exists() for suffix in ("-wal", "-shm", "-journal")),
                    "Unexpected initializer companion; no deletion/adoption")
            destination, content = data / name, read_bytes(baseline / name)
            before = regular(destination)
            fd = os.open(destination, os.O_WRONLY | os.O_NOFOLLOW)
            try:
                require(identity(os.fstat(fd)) == identity(before), "Destination inode changed")
                os.ftruncate(fd, 0)
                with os.fdopen(fd, "wb", closefd=False) as output:
                    output.write(content)
                    output.flush()
            finally:
                os.close(fd)
            require(identity(destination.lstat()) == identity(before), "Initializer inode replaced")
            if (baseline / (name + "-wal")).exists():
                self.put(data / (name + "-wal"), read_bytes(baseline / (name + "-wal")))

    @staticmethod
    def abort_socket(connection):
        try:
            connection.shutdown(2)
        except OSError:
            pass
        connection.close()

    def request(self, path, body=None, tls_only=False):
        self.check()
        require(self.active is not None and self.active.process.poll() is None and not self.active.failure,
                "No ready owned server")
        require(path.startswith("/api/atlas/") and "://" not in path and ".." not in path
                and "\r" not in path and "\n" not in path, "Unscoped HTTP path")
        import socket
        connection, deadline, stream = None, None, None
        expired = threading.Event()
        expires_at = time.monotonic() + 5
        record = {"path": path, "method": "TLS-only" if tls_only else "POST" if body is not None else "GET",
                  "startedAtMs": now(), "status": "in-progress"}
        self.receipt["requests"].append(record)
        try:
            raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            raw.settimeout(5)
            with self.lock:
                self.connection = raw
            def expire():
                with self.lock:
                    expired.set()
                    if self.connection is not None:
                        self.abort_socket(self.connection)
            deadline = threading.Timer(max(0, expires_at - time.monotonic()), expire)
            deadline.daemon = True
            deadline.start()
            remaining = expires_at - time.monotonic()
            require(not expired.is_set() and not self.interruption and remaining > 0, "Exchange expired before connect")
            raw.settimeout(remaining)
            raw.connect(("127.0.0.1", self.port))  # No getaddrinfo, DNS, URL opener or proxy.
            with self.lock:
                require(not expired.is_set() and not self.interruption and time.monotonic() < expires_at,
                        "Exchange expired/interrupted before TLS ownership transfer")
                # Expiry cannot see a detached raw socket between wrap and publication.
                connection = self.tls.wrap_socket(raw, server_hostname="127.0.0.1", do_handshake_on_connect=False)
                self.connection = connection
                remaining = expires_at - time.monotonic()
                require(not expired.is_set() and not self.interruption and remaining > 0,
                        "Exchange expired/interrupted before handshake")
                connection.settimeout(remaining)
            connection.do_handshake()
            require(connection.getpeercert(binary_form=True) == self.peer_der, "Exact generated peer certificate mismatch")
            self.check()
            require(not expired.is_set() and time.monotonic() < expires_at
                    and self.active.process.poll() is None and not self.active.failure,
                    "Owned server/TLS deadline changed before credential transmission")
            record["peerCertificateSha256"] = sha(self.peer_der)
            if tls_only:
                record["status"] = "verified-generated-peer"
                return b"", {}
            # No credential-bearing HTTP bytes are constructed/sent before peer admission.
            payload = encoded(body) if body is not None else b""
            require(len(payload) <= 4096, "Generated HTTP request byte bound")
            headers = {"Host": f"127.0.0.1:{self.port}", "Origin": self.origin,
                       "Sec-Fetch-Site": "same-origin", "Connection": "close"}
            if self.cookie:
                headers["Cookie"] = self.cookie
            if body is not None:
                headers.update({"Content-Type": "application/json", "Content-Length": str(len(payload))})
                if self.csrf:
                    headers["X-Atlas-Csrf"] = self.csrf
            method = "POST" if body is not None else "GET"
            wire = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n"
            with self.lock:
                remaining = expires_at - time.monotonic()
                require(not expired.is_set() and not self.interruption and remaining > 0, "Exchange expired before send")
                connection.settimeout(remaining)
            connection.sendall(wire.encode("ascii") + payload)
            stream = connection.makefile("rb")
            status_line = stream.readline(8193)
            require(re.fullmatch(rb"HTTP/1\.[01] 200 [^\r\n]*\r\n", status_line) is not None,
                    "Unexpected HTTP status; no redirect or retry")
            received, header_bytes = {}, len(status_line)
            for _ in range(33):
                line = stream.readline(8193)
                header_bytes += len(line)
                require(len(line) <= 8192 and header_bytes <= 65536 and line.endswith(b"\r\n"), "HTTP header budget/framing")
                if line == b"\r\n":
                    break
                name, separator, value = line[:-2].partition(b":")
                require(separator and re.fullmatch(rb"[A-Za-z0-9-]+", name), "Invalid HTTP header")
                received.setdefault(name.decode("ascii").lower(), []).append(value.strip().decode("ascii"))
            else:
                raise RuntimeError("HTTP header count budget")
            length = received.get("content-length", [])
            require(len(length) == 1 and re.fullmatch(r"[0-9]+", length[0])
                    and "transfer-encoding" not in received, "Explicit single HTTP length required")
            length = int(length[0])
            require(length <= MAX_OUTPUT, "HTTP body budget")
            content = stream.read(length + 1)
            require(len(content) == length and not expired.is_set() and time.monotonic() < expires_at,
                    "HTTP truncated/extra body/deadline; outcome uncertain")
            if self.window is not None:
                count = 2 if path.startswith("/api/atlas/offline/") else 1
                self.window["authentications"] += count
                self.window["authenticationObservations"].append({"start": record["startedAtMs"], "end": now(), "count": count})
            record.update(status="complete", bytes=length, sha256=sha(content))
            return content, received
        except BaseException as error:
            record.update(status="uncertain", error=str(error))
            raise
        finally:
            if deadline is not None:
                deadline.cancel()
                deadline.join()
            with self.lock:
                if self.connection is not None:
                    self.abort_socket(self.connection)
                self.connection = None
            if stream is not None:
                stream.close()
            record["endedAtMs"] = now()

    def json_request(self, path, body=None):
        return decoded(self.request(path, body)[0])

    def serve(self, binary, fixture, label):
        data, config = fixture
        self.active = self.launch(binary, ["serve", "--server-config", str(config)], label, 45)
        self.active.data = data
        self.active.input()
        self.active.ready(f"HouseAtlas persistent server listening on 127.0.0.1:{self.port} for {self.origin}")
        self.request("/api/atlas/auth/mode", tls_only=True)

    def stop(self):
        child = self.active
        require(child is not None and not child.closed.is_set() and not child.failure, "Pre-shutdown outcome changed")
        child.terminate()
        child.finish()
        events = [decoded(line) for line in read_bytes(child.data / "logs/server.events.jsonl").splitlines()]
        require(events[-1]["format"] == "houseatlas-server-event/1"
                and events[-1]["event"] == "graceful-shutdown", "Clean owner close event required")
        self.active = None

    def reads(self, expected):
        page = self.json_request(self.prefix + "/records?limit=100")
        require(page["contractVersion"] == "1.0.0" and page["nextCursor"] is None
                and json_equal(sorted(page["items"], key=lambda row: row["recordId"]), expected), "Exact scoped record page required")
        histories = []
        for record in expected:
            path = f'{self.prefix}/records/{record["recordType"]}/{record["recordId"]}'
            require(json_equal(self.json_request(path), record), "Exact individual record required")
            history = self.json_request(path + "/history")
            require(len(history) == 1 and history[0]["auditId"] == record["lastAuditId"]
                    and history[0]["actorId"] == uid(5), "Non-vacuous audit/actor history required")
            histories.append(history)
        for collection in ("homebox/entities", "network/relations"):
            empty = self.json_request(self.prefix + "/" + collection + "?limit=100")
            require(json_equal(empty["items"], []) and empty["nextCursor"] is None, "Expected empty provider page")
        return {"records": page["items"], "histories": histories}

    def export(self, original):
        base = f"/api/atlas/offline/v1/workspaces/{uid(1)}/homes/{uid(2)}"
        manifest = self.json_request(base + "/manifest")
        require(manifest["profile"] == "houseatlas.home-read-pack.v1"
                and re.fullmatch("[a-f0-9]{64}", manifest["snapshotId"])
                and manifest["sections"]["atlas"]["state"] == "complete", "Complete scoped Atlas export required")

        def get(digest):
            require(re.fullmatch("[a-f0-9]{64}", digest), "Resource hash spelling")
            resources = [row for row in manifest["resources"] if row["sha256"] == digest]
            require(len(resources) == 1, "Exactly one matching resource descriptor")
            content = self.request(f'{base}/snapshots/{manifest["snapshotId"]}/resources/{digest}')[0]
            require(sha(content) == digest and len(content) == integer(resources[0]["bytes"], "Resource bytes"), "Resource hash/length mismatch")
            return content

        atlas = decoded(get(manifest["sections"]["atlas"]["resourceSha256"]))
        if original is None:
            require("retainedIdentityBodies" not in atlas, "Empty identity extension must be absent")
        else:
            descriptor, body = atlas["retainedIdentityBodies"], original.encode("utf-8")
            require(descriptor["profile"] == "houseatlas.home-read-pack.retained-identity-bodies.v1"
                    and json_equal(descriptor["omissions"], []) and len(descriptor["members"]) == 1,
                    "One exact retained identity member without omissions required")
            member = descriptor["members"][0]
            require(all(json_equal(member[key], value) for key, value in {
                "recordId": uid(200), "recordType": "identity", "workspaceId": uid(1), "homeId": uid(2),
                "revision": 1, "offset": 0, "bytes": len(body), "sha256": sha(body)}.items()), "Identity member attribution mismatch")
            for field in ("revision", "offset", "bytes"):
                integer(member[field], "Identity member " + field)
            require(integer(descriptor["bytes"], "Identity aggregate bytes") == len(body) and descriptor["resourceSha256"] == sha(body)
                    and get(descriptor["resourceSha256"]) == body, "Exact original identity aggregate bytes required")
        self.receipt["identityExport"] = {"manifest": manifest, "exactOriginalCompared": original is not None}

    def setup(self):
        for leaf in ("home", "tmp", "frontend", "bin"):
            self.mkdir(self.root / leaf)
        self.env = {"HOME": str(self.root / "home"), "TMPDIR": str(self.root / "tmp"),
                    "PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
        os.environ.clear()
        os.environ.update(self.env)
        self.python, self.openssl = Path(self.options["--python"]), Path(self.options["--openssl"])
        require(identity(regular(self.python, True)) == identity(regular(Path(sys.executable), True)),
                "Helper must use the selected running interpreter")
        self.tools = {}
        for tool in (self.python, self.openssl):
            info = regular(tool, True)
            self.tools[str(tool)] = {"identity": identity(info), "sha256": sha(read_bytes(tool))}
        self.receipt["tools"] = self.tools
        selected = []
        for role, pin in PINS.items():
            path = Path(self.options["--" + role + "-binary"])
            info, content = regular(path, True), read_bytes(path)
            require(info.st_size == pin["bytes"] and sha(content) == pin["sha256"], "Exact artifact pin mismatch")
            selected.append(identity(info))
            self.receipt.setdefault("artifacts", {})[role] = {"path": str(path), "identity": identity(info)}
            self.put(self.root / "bin" / role, content, 0o700)
        require(selected[0] != selected[1], "Old/new artifact alias refused")
        self.put(self.root / "frontend/index.html", '<!doctype html><html><body><div id="root"></div></body></html>')
        self.put(self.root / "sqlite-tool.py", SQLITE_TOOL)
        self.receipt["sqliteToolSha256"] = sha(SQLITE_TOOL)
        self.put(self.root / "openssl.cnf", "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n"
                 "[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n")
        self.command(self.openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config",
                     str(self.root / "openssl.cnf"), "-keyout", str(self.root / "key.pem"), "-out", str(self.root / "cert.pem")],
                     "generated TLS")
        import ssl
        pem = read_bytes(self.root / "cert.pem").decode("ascii")
        self.peer_der = ssl.PEM_cert_to_DER_cert(pem)
        self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)  # No system CA or environment defaults.
        self.tls.load_verify_locations(cadata=pem)
        self.tls.check_hostname = True
        self.tls.verify_mode = ssl.CERT_REQUIRED
        self.receipt["sslVersion"] = ssl.OPENSSL_VERSION
        self.login = {"username": "generated-storage-editor", "password": "generated-only-no-real-credential-2026"}
        self.put(self.root / "provisioning.json", encoded({"schemaVersion": 1, "users": [{"userId": uid(4),
                 "actorId": uid(5), **self.login, "memberships": [{"workspaceId": uid(1), "homeId": uid(2), "role": "editor"}]}]}))

    def initialize(self, leaf):
        data, config = self.root / leaf, self.root / (leaf + ".config.json")
        self.put(config, encoded({"schemaVersion": 1, "deploymentId": uid(6), "dataDirectory": str(data),
                 "logDirectory": str(data / "logs"), "frontendDirectory": str(self.root / "frontend"),
                 "tlsCertificate": str(self.root / "cert.pem"), "tlsPrivateKey": str(self.root / "key.pem"),
                 "listen": "127.0.0.1:" + str(self.port), "origin": self.origin,
                 "homes": [{"workspaceId": uid(1), "homeId": uid(2), "label": "Generated storage home"}],
                 "mcpCommands": "read-only", "authentication": {"mode": "password"}}))
        self.command(self.root / "bin/old", ["initialize", "--server-config", str(config), "--provisioning-file",
                     str(self.root / "provisioning.json")], leaf + " initialize")
        return data, config

    def execute(self):
        self.setup()
        generator = self.initialize("generator")
        keeper = None
        if self.receipt["case"] == "committed-wal":
            keeper = self.helper("hold-wal", generator[0], "owned idle WAL keeper", 90)
            keeper.ready("WAL_KEEPER_READY")
        self.serve(self.root / "bin/old", generator, "old baseline")
        content, headers = self.request("/api/atlas/auth/login", self.login)
        session = decoded(content)
        require(session["actorId"] == uid(5) and len(headers.get("set-cookie", [])) == 1, "Expected fake session")
        self.csrf, self.cookie = session["csrfToken"], headers["set-cookie"][0].split(";")[0]
        require(re.fullmatch(r"[A-Za-z0-9_-]{1,128}=[A-Za-z0-9_-]{1,256}", self.cookie)
                and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", self.csrf), "Generated cookie/CSRF syntax")
        self.put(self.root / "generated-session.json", encoded({"cookie": self.cookie, "csrf": self.csrf}))
        expected = []
        if self.receipt["case"] != "empty":
            evidence = {"statement": "Generated storage compatibility evidence only.", "provenance": {
                "source": None, "sourceRevision": None, "sourceConfidence": None, "evidenceBasis": "owner-report",
                "factAt": "2026-01-02T12:00:00Z", "retrievedAt": "2026-01-02T12:00:00Z", "vantage": None,
                "uncertainty": {"status": "supported", "explanation": None}}, "supersedesEvidenceIds": [], "references": []}
            rows = [(100, "evidence", evidence, []), (200, "identity", {"kind": "item", "evidenceIds": [uid(100)]},
                    [{"record": {"recordType": "evidence", "recordId": uid(100)}, "expectedRevision": 1}])]
            for number, kind, payload, guards in rows:
                result = self.json_request(f"{self.prefix}/records/{kind}/{uid(number)}/mutations", {
                    "schemaVersion": 1, "mutationId": uid(number + 1000), "operation": "create", "expectedRevision": None,
                    "reason": "Generated storage compatibility setup", "guards": guards, "value": {"recordType": kind, "payload": payload}})
                require(result["replayed"] is False and integer(result["record"]["revision"], "Record revision") == 1, "Fresh committed mutation required")
                expected.append(result["record"])
            require(json_equal(expected[1]["payload"]["evidenceIds"], [expected[0]["recordId"]]), "Explicit evidence reference required")
        expected.sort(key=lambda row: row["recordId"])
        baseline_reads = self.reads(expected)
        self.stop()
        baseline = self.root / "baseline"
        baseline_files = self.tree(generator[0], baseline)
        if keeper is not None:
            for name in ("atlas.sqlite", "access.sqlite"):
                wal = read_bytes(baseline / (name + "-wal"))
                require(len(wal) > 32 and int.from_bytes(wal[:4], "big") in (0x377F0682, 0x377F0683), "Committed WAL required")
                size = int.from_bytes(wal[8:12], "big")
                require(512 <= size <= 65536 and not size & (size - 1) and (len(wal) - 32) % (24 + size) == 0, "WAL frame/page bounds")
                commits = sum(bool(int.from_bytes(wal[offset + 4:offset + 8], "big")) for offset in range(32, len(wal), 24 + size))
                require(commits > 0, "WAL commit marker required in both stores")
                self.receipt.setdefault("committedWal", []).append({"store": name, "pageSize": size,
                     "frames": (len(wal) - 32) // (24 + size), "commits": commits})
            keeper.input(b"close\n")
            keeper.finish()
        self.receipt["baselineFiles"] = baseline_files
        before = self.observe(baseline, "old baseline SQL")
        tables = before["stores"]["atlas.sqlite"]["tables"]
        require(integer(before["stores"]["atlas.sqlite"]["userVersion"], "Atlas userVersion") == 5
                and integer(before["stores"]["access.sqlite"]["tables"]["access_meta"]["rows"][0][1], "Access meta version") == 1, "Exact schema versions")
        bodies = [decoded(row[tables["records"]["columns"].index("body")]) for row in tables["records"]["rows"]]
        require(json_equal(sorted(bodies, key=lambda row: row["recordId"]), expected)
                and len(tables["audits"]["rows"]) == len(expected) == len(tables["receipts"]["rows"]), "SQL record/audit/receipt state")
        transition = self.initialize("transition")
        self.install(baseline, transition[0])
        prior = self.observe(transition[0], "transition before candidate")
        require(json_equal(comparable(prior), comparable(before)), "Installed logical state must equal preserved baseline")
        state_pin = sha(read_bytes(transition[0] / "server-state.json"))
        for role, label in (("new", "candidate"), ("old", "old reopen")):
            window = {"start": now(), "authentications": 0, "authenticationObservations": []}
            self.window = window
            self.serve(self.root / "bin" / role, transition, label)
            require(json_equal(self.reads(expected), baseline_reads), "Old/new/old exact record/history reads")
            if role == "new":
                table = tables["records"]
                originals = [row[table["columns"].index("body")] for row in table["rows"]
                             if row[table["columns"].index("record_type")] == "identity"]
                self.export(originals[0] if originals else None)
            self.stop()
            self.window = None
            window["end"] = now()
            require(sha(read_bytes(transition[0] / "server-state.json")) == state_pin, "Receipt bytes changed")
            after = self.observe(transition[0], label + " SQL")
            compare(prior, after, window)
            prior = after
            self.receipt["observations"].append({"label": label + " admitted authentication window", "window": window})
            self.receipt["observations"].append({"label": label + " closed tree",
                "files": self.tree(transition[0], self.root / (label.replace(" ", "-") + "-closed"))})
        require(json_equal(self.tree(baseline), baseline_files), "Untouched generated baseline must remain exact")


def comparable(snapshot):
    keys = ("schema", "userVersion", "applicationId", "journalMode", "tables")
    return copy.deepcopy({name: {key: store[key] for key in keys} for name, store in snapshot["stores"].items()})


def compare(before, after, window):
    a, b = comparable(before), comparable(after)
    ta, tb = a["access.sqlite"]["tables"], b["access.sqlite"]["tables"]
    sa, sb = ta["access_sessions"], tb["access_sessions"]
    require(json_equal(sa["columns"], sb["columns"]) and len(sa["rows"]) == len(sb["rows"]) == 1, "One unchanged session required")
    seen = sa["columns"].index("last_seen")
    previous, current = integer(sa["rows"][0][seen], "Previous last_seen"), integer(sb["rows"][0][seen], "Current last_seen")
    require(previous <= current <= window["end"] and current >= window["start"], "Only current monotone last_seen admitted")
    sb["rows"][0][seen] = previous
    ra, rb = ta["access_rates"], tb["access_rates"]
    require(json_equal(ra["columns"], rb["columns"])
            and json_equal(ra["columns"], ["bucket", "starts_at", "expires_at", "count"]), "Exact rate columns")
    bucket, old_rows = sha("request:user:" + uid(4)), {row[0]: row for row in ra["rows"]}
    observations = window["authenticationObservations"]
    require(sum(event["count"] for event in observations) == window["authentications"] > 0,
            "Non-vacuous observed authentication count required")
    for row in ra["rows"] + rb["rows"]:
        for index, name in ((1, "starts_at"), (2, "expires_at"), (3, "count")):
            integer(row[index], "Rate " + name)
    for row in rb["rows"]:
        old = old_rows.get(row[0])
        if row[0] != bucket:
            require(json_equal(old, row), "Unrelated rate row changed")
        else:
            require(row[1] <= window["end"] and row[2] == row[1] + 60000 and 0 < row[3] <= 300, "Bounded request rate window")
            if old and row[1] == old[1]:
                require(old[2] > window["start"] and all(event["start"] < old[2] for event in observations)
                        and row[3] == old[3] + window["authentications"], "Exact viable-window auth rate increment")
            else:
                # consume_rate deletes only expires_at<=now, then creates a new
                # starts_at=now, expires_at=now+60_000, count=1 request-user row.
                require(row[1] >= window["start"] and (old is None or row[1] >= old[2]),
                        "Request-user bucket replaced before actual old expiration")
                crossing = [event for event in observations if event["start"] <= row[1] <= event["end"]]
                lower = sum(event["count"] for event in observations if event["start"] > row[1])
                upper = sum(event["count"] for event in observations if event["end"] >= row[1])
                require(crossing and max(1, lower) <= row[3] <= upper,
                        "Replacement bucket count/start lacks observed authentication support")
    require(any(row[0] == bucket for row in rb["rows"]), "Expected request-user rate row")
    for row in ra["rows"]:
        require(any(new[0] == row[0] for new in rb["rows"])
                or any(event["end"] >= row[2] for event in observations), "Only rates expired by observed authentication may disappear")
    del ta["access_rates"], tb["access_rates"]
    require(json_equal(a, b), "Unexpected catalogue/row/reference/journal/authority change")


def main():
    # The launcher must sanitize before Python/native modules load; clearing here
    # also prevents subsequent stdlib/child consumers inheriting ambient values.
    os.environ.clear()
    require(sys.flags.isolated and sys.flags.no_site and not sys.flags.optimize, "Invoke reviewed Python with -I -S, no -O")
    require(sys.platform == "darwin" and os.uname().machine == "x86_64"
            and sys.version_info[:3] == (3, 14, 7), "Exact observed Intel macOS Python 3.14.7 required; suitability remains held")
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    require(0 <= soft <= hard <= 1_048_576, "Finite descriptor close bound required")
    os.closerange(3, hard)
    null = os.open(os.devnull, os.O_RDONLY)
    if null != 0:
        os.dup2(null, 0)
        os.close(null)
    os.umask(0o077)
    names = {"--case", "--old-binary", "--new-binary", "--old-sha256", "--new-sha256", "--python", "--openssl",
             "--fixture-root", "--fixture-device", "--fixture-inode", "--fixture-port", "--acknowledge"}
    require(len(sys.argv) == 1 + 2 * len(names), "All twelve exact options required; no default/all/helper selector")
    options = {}
    for key, value in zip(sys.argv[1::2], sys.argv[2::2]):
        require(key in names and key not in options and value, "Unsupported/repeated/missing option")
        options[key] = value
    for key in ("--fixture-root", "--old-binary", "--new-binary", "--python", "--openssl"):
        require(str(Path(options[key])) == options[key] and ".." not in Path(options[key]).parts,
                "Exact path spelling without normalization aliases required")
    for key in ("--fixture-device", "--fixture-inode"):
        require(str(int(options[key])) == options[key] and int(options[key]) > 0, "Canonical positive root identity required")
    require(options["--case"] in ("empty", "populated", "committed-wal")
            and options["--acknowledge"] == "generated-only-after-independent-review", "One reviewed healthy case required")
    for role in PINS:
        require(options["--" + role + "-sha256"] == PINS[role]["sha256"], "Exact registered hash acknowledgement required")
    run = Run(options)
    for selected_signal in (signal.SIGINT, signal.SIGTERM):
        signal.signal(selected_signal, lambda received, frame: run.interrupt(signal.Signals(received).name))
    total = threading.Timer(210, lambda: run.interrupt("whole-run-210-second-deadline"))
    total.daemon = True
    total.start()
    try:
        run.persist()
        run.execute()
        run.check()
        run.receipt["status"] = "pass-generated-only"
    except BaseException:
        run.receipt.update(status="held", error=traceback.format_exc())
    finally:
        total.cancel()
        total.join()
        with run.lock:
            remaining = tuple(run.owned)
            for child in remaining:
                child.fail("Incomplete operation: outcome uncertain")
                child.terminate()  # Initiate ALL children before waiting for any close.
        for child in remaining:
            child.closed.wait()
        if (run.interruption or any(row["status"] == "uncertain" for row in run.receipt["processes"])
                or any(row["status"] == "uncertain" for row in run.receipt["requests"])):
            run.receipt["status"] = "uncertain"
        run.receipt["endedAtMs"] = now()
        run.persist()
        os.close(run.root_fd)
        print(json.dumps({"status": run.receipt["status"], "retainedRoot": str(run.root), "syntheticOnly": True}))
    return 0 if run.receipt["status"] == "pass-generated-only" else 1


if __name__ == "__main__":
    raise SystemExit(main())
