"""Synthetic checks for deploy-nas: temp folders and a fake service, no launchd, network or real data."""
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest

import deploy_nas as dn


def write(path: Path, text: str, mode=0o600) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)
    return path


SERVICE = {
    "Label": "example.houseatlas",
    "ProgramArguments": [
        "/srv/houseatlas-main-aaaaaaa-20260101-v1/candidate/houseatlas", "serve",
        "--server-config", "/srv/server-config.json",
        "--model-overview-manifest", "/srv/model/publication.json", "--model-overview-manifest-sha256", "0" * 64,
        "--atlas-scene-manifest", "/srv/model/atlas-scene.json", "--atlas-scene-manifest-sha256", "1" * 64,
        "--atlas-room-links-manifest", "/srv/model/reviewed-room-links.json", "--atlas-room-links-manifest-sha256", "2" * 64,
        "--atlas-entry-building-id", "main_house",
    ],
}


class Pure(unittest.TestCase):
    def test_env_file(self):
        self.assertEqual(dn.parse_env("# c\nA=1\nB_C='x y'\n\n"), {"A": "1", "B_C": "x y"})
        with self.assertRaises(dn.DeployError):
            dn.parse_env("not a pair")

    def test_binary_swap_keeps_every_other_argument(self):
        out = dn.with_binary(SERVICE, Path("/srv/new/houseatlas"))
        self.assertEqual(out["ProgramArguments"][0], "/srv/new/houseatlas")
        self.assertEqual(out["ProgramArguments"][1:], SERVICE["ProgramArguments"][1:])
        self.assertEqual(SERVICE["ProgramArguments"][0][-10:], "houseatlas")  # input untouched

    def test_binary_swap_also_moves_an_explicit_program(self):
        out = dn.with_binary(dict(SERVICE, Program="/srv/old/houseatlas"), Path("/srv/new/houseatlas"))
        self.assertEqual(out["Program"], "/srv/new/houseatlas")

    def test_final_response_headers_win(self):
        head = ("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 Connection established\r\n\r\n"
                "HTTP/2 401 \r\ncache-control: private, no-store\r\n\r\n")
        self.assertEqual(dn.parse_head(head), (401, {"cache-control": "private, no-store"}))
        self.assertEqual(dn.parse_head(""), (0, {}))

    def test_smoke_args_keep_only_model_pins_and_entry_building(self):
        live = SERVICE["ProgramArguments"] + ["--ai-account-selection", "/srv/ai.json"]
        args = dn.model_args(live)
        self.assertNotIn("--server-config", args)
        self.assertNotIn("--ai-account-selection", args)
        self.assertEqual(args[-2:], ["--atlas-entry-building-id", "main_house"])
        self.assertEqual(args, SERVICE["ProgramArguments"][4:])

    def test_storage_gate(self):
        changed = ["frontend/src/App.tsx", "backend/migrations/0009_x.sql", "backend/src/storage/mod.rs",
                   "backend/src/access/schema.sql", "backend/src/contracts/stock/schema.rs", "backend/src/transports/mcp/native_schemas.rs",
                   "docs/x.md"]
        self.assertEqual(dn.storage_sensitive(changed), changed[1:5])

    def test_ledger_takes_latest_snapshot_and_rolls_back_newest_live(self):
        with tempfile.TemporaryDirectory() as t:
            led = Path(t) / "ledger.jsonl"
            dn.save_record(led, {"id": "a", "status": "verified"})
            dn.save_record(led, {"id": "b", "status": "prepared"})
            dn.save_record(led, {"id": "c", "status": "live"})
            dn.save_record(led, {"id": "c", "status": "rolled-back"})
            records = dn.ledger_records(led)
            self.assertEqual([r["status"] for r in records], ["verified", "prepared", "rolled-back"])
            self.assertEqual(dn.rollback_target(records)["id"], "a")


class FrontendUnion(unittest.TestCase):
    def test_keeps_old_assets_and_drops_old_pages(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            write(t / "dist/index.html", '<script src="/assets/live-new.js">')
            write(t / "dist/assets/live-new.js", "new")
            write(t / "dist/assets/shared.js", "same")
            write(t / "live/index.html", '<script src="/assets/live-old.js">')
            write(t / "live/assets/live-old.js", "old")
            write(t / "live/assets/shared.js", "same")
            write(t / "live/old-page.html", "gone")
            r = dn.union_frontend(t / "dist", t / "live", t / "out")
            self.assertEqual((r["retainedAssets"], r["identicalAssets"], r["droppedNonAssets"]), (1, 1, ["old-page.html"]))
            self.assertEqual((t / "out/assets/live-old.js").read_text(), "old")
            self.assertEqual((t / "out/index.html").read_text(), '<script src="/assets/live-new.js">')
            self.assertEqual(os.stat(t / "out").st_mode & 0o077, 0)
            self.assertEqual(dn.entry_scripts(t / "out/index.html"), ["assets/live-new.js"])

    def test_refuses_a_reused_asset_name_with_new_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            write(t / "dist/assets/a.js", "one")
            write(t / "live/assets/a.js", "two")
            with self.assertRaises(dn.DeployError):
                dn.union_frontend(t / "dist", t / "live", t / "out")
            self.assertFalse((t / "out").exists())


class ModelRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.tmp.name))
        self.rel = self.root / "releases/v1"
        self.rel.mkdir(parents=True)
        self.rel.chmod(0o700)
        write(self.rel / "publication.json", json.dumps({"publicationId": "p-1"}))
        write(self.rel / "atlas-scene.json", "{}")
        write(self.rel / "overview.glb", "glb")
        write(self.rel / "reviewed-room-links.json", "{}")
        self.data = self.root / "data"

    def tearDown(self):
        self.tmp.cleanup()

    def test_accepts_the_server_shape_and_pins_hashes(self):
        files = dn.validate_release(self.rel, self.data)
        self.assertEqual(sorted(files), ["atlas-scene.json", "publication.json", "reviewed-room-links.json"])
        out = dn.with_model(SERVICE, files)["ProgramArguments"]
        pub = hashlib.sha256((self.rel / "publication.json").read_bytes()).hexdigest()
        self.assertEqual(dn.flag_value(out, "--model-overview-manifest"), str(self.rel / "publication.json"))
        self.assertEqual(dn.flag_value(out, "--model-overview-manifest-sha256"), pub)
        self.assertEqual(dn.flag_value(out, "--atlas-room-links-manifest"), str(self.rel / "reviewed-room-links.json"))

    def test_rejections(self):
        (self.rel / "overview.glb").chmod(0o644)
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)
        (self.rel / "overview.glb").chmod(0o600)
        os.link(self.rel / "atlas-scene.json", self.root / "second-link")
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)
        (self.root / "second-link").unlink()
        self.rel.chmod(0o755)
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)
        self.rel.chmod(0o700)
        os.symlink(self.rel, self.root / "alias")
        self.assertRaises(dn.DeployError, dn.validate_release, self.root / "alias", self.data)
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.root)
        (self.rel / "atlas-scene.json").unlink()
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)

    def test_detail_is_required_once_the_publication_names_it(self):
        write(self.rel / "publication.json", json.dumps({"publicationId": "p-1", "detail": {"file": "detail.glb"}}))
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)
        write(self.rel / "detail.glb", "glb")
        (self.rel / "detail.glb").chmod(0o644)
        self.assertRaises(dn.DeployError, dn.validate_release, self.rel, self.data)
        (self.rel / "detail.glb").chmod(0o600)
        self.assertIn("publication.json", dn.validate_release(self.rel, self.data))


class FakeService(dn.Runner):
    """launchd plus a gateway that serves whatever binary the plist names."""

    def __init__(self, cfg, healthy=lambda binary: True):
        super().__init__(cfg)
        self.healthy, self.pid, self.binary, self.calls = healthy, 100, None, []

    def bootout(self):
        self.calls.append("bootout")
        self.pid = None

    def bootstrap(self):
        self.calls.append("bootstrap")
        self.binary = plistlib.loads(self.cfg.plist.read_bytes())["ProgramArguments"][0]
        self.pid = 200 + len(self.calls)

    def service_pid(self):
        return self.pid

    def alive(self, pid):
        return pid == self.pid

    def process_command(self, pid):
        return f"{self.binary} serve --server-config x"

    def curl(self, url, *, method="GET", headers=(), cookie=None, data=None, insecure=False, timeout=30):
        path = url.split("://", 1)[1].split("/", 1)[1]
        if not self.healthy(self.binary):
            return 502, {}, b""
        if path == "api/atlas/auth/mode":
            return 200, {}, b'{"mode":"trusted-proxy"}'
        if path == "api/atlas/auth/proxy":
            self.out = False
            return 200, {"set-cookie": "s=1; Path=/"}, b""
        if path == "api/atlas/auth/logout":
            self.out = True
            return 200, {}, b""
        if path == "api/atlas/auth/session":
            return (401, {}, b"") if getattr(self, "out", False) else (200, {}, b'{"csrfToken":"t"}')
        if path.endswith("/overview"):
            return 200, {}, json.dumps({"publicationId": "p", "original": {"href": "/glb",
                                         "sha256": hashlib.sha256(b"glb").hexdigest()}}).encode()
        if path == "glb":
            return 200, {}, b"glb"
        if path.startswith("assets/"):
            return 200, {"cache-control": dn.IMMUTABLE}, b""
        if path in ("", "saved/index.html", "saved/service-worker.js", "offline-entry-worker.js"):
            return 200, {"cache-control": dn.NO_STORE}, b""
        return 200, {}, b"{}"


class SwapAndRollback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.root = Path(self.tmp.name)
        self.cfg = dn.Config(setup_root=t / "setup", plist=t / "service.plist", label="example.houseatlas",
                             gateway_url="https://gateway.invalid", smoke_template=t / "smoke.json",
                             stop_timeout=1, start_timeout=2)
        write(self.cfg.smoke_template, json.dumps({"homes": [{"workspaceId": "w", "homeId": "h"}]}))
        self.old = dict(SERVICE)
        self.new = dn.with_binary(SERVICE, t / "new/houseatlas")
        self.cfg.plist.write_bytes(plistlib.dumps(self.old))
        d = self.cfg.setup_root / "rec" / "recovery"
        d.mkdir(parents=True)
        (d / "service.before.plist").write_bytes(plistlib.dumps(self.old))
        (d / "service.after.plist").write_bytes(plistlib.dumps(self.new))
        write(t / "fe/frontend/index.html", '<script src="/assets/old.js">')
        write(t / "fe/frontend.next/index.html", '<script src="/assets/new.js">')
        self.record = dict(id="rec", kind="code", dir=str(d.parent), binary=self.new["ProgramArguments"][0],
                           before_plist=str(d / "service.before.plist"), after_plist=str(d / "service.after.plist"),
                           frontend=str(t / "fe/frontend"), parked_frontend=str(t / "fe/frontend.before-rec"),
                           status="live")
        self.moves = [(t / "fe/frontend", t / "fe/frontend.before-rec"), (t / "fe/frontend.next", t / "fe/frontend")]

    def tearDown(self):
        self.tmp.cleanup()

    def test_verified_deploy_then_one_command_rollback(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        rec = dep.finish(self.record, ["assets/new.js", "assets/old.js"], auto_rollback=True)
        self.assertEqual(rec["status"], "verified")
        self.assertIn("new.js", (self.root / "fe/frontend/index.html").read_text())
        dep.rollback()
        self.assertEqual(svc.binary, SERVICE["ProgramArguments"][0])
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(plistlib.loads(self.cfg.plist.read_bytes()), self.old)
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "rolled-back")
        with self.assertRaises(dn.DeployError):
            dep.rollback()

    def test_failed_gateway_verification_rolls_back(self):
        svc = FakeService(self.cfg, healthy=lambda binary: not binary.endswith("new/houseatlas"))
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        with self.assertRaises(dn.DeployError) as e:
            dep.finish(self.record, ["assets/new.js"], auto_rollback=True)
        self.assertIn("rolled back", str(e.exception))
        self.assertEqual(svc.binary, SERVICE["ProgramArguments"][0])
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "rolled-back")

    def test_malformed_gateway_answer_rolls_back(self):
        svc = FakeService(self.cfg)
        real = svc.curl
        svc.curl = lambda url, **kw: (200, {}, b"<html>") if url.endswith("/overview") and svc.binary.endswith("new/houseatlas") \
            else real(url, **kw)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        with self.assertRaises(dn.DeployError):
            dep.finish(self.record, ["assets/new.js"], auto_rollback=True)
        self.assertEqual(svc.binary, SERVICE["ProgramArguments"][0])

    def test_interrupted_swap_is_still_the_rollback_target(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dn.save_record(self.cfg.ledger, dict(self.record, id="older", status="verified"))
        self.record["status"] = "swapping"
        dn.save_record(self.cfg.ledger, self.record)
        (self.root / "fe/frontend").rename(self.root / "fe/frontend.before-rec")  # stopped after parking
        self.assertEqual(dn.rollback_target(dn.ledger_records(self.cfg.ledger))["id"], "rec")
        dep.rollback()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(svc.binary, SERVICE["ProgramArguments"][0])

    def test_interrupted_rollback_can_be_retried(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        real = dep.swap
        def interrupted(record, events, moves, expect=None):
            for src, dst in moves:
                src.rename(dst)
            raise KeyboardInterrupt
        dep.swap = interrupted
        with self.assertRaises(KeyboardInterrupt):
            dep.rollback()
        dep.swap = real
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "rolling-back")
        dep.rollback()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(svc.binary, SERVICE["ProgramArguments"][0])
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "rolled-back")

    def test_rollback_keeps_the_newer_builds_lazy_chunks(self):
        write(self.root / "fe/frontend.next/assets/lazy-new.js", "chunk")
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        dep.rollback()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual((self.root / "fe/frontend/assets/lazy-new.js").read_text(), "chunk")

    def test_rollback_interrupted_between_moves_resumes_the_union(self):
        write(self.root / "fe/frontend.next/assets/lazy-new.js", "chunk")
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        real = dep.swap
        def first_move_only(record, events, moves, expect=None):
            moves[0][0].rename(moves[0][1])
            raise KeyboardInterrupt
        dep.swap = first_move_only
        with self.assertRaises(KeyboardInterrupt):
            dep.rollback()
        dep.swap = real
        dep.rollback()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual((self.root / "fe/frontend/assets/lazy-new.js").read_text(), "chunk")

    def test_swap_refuses_a_plist_changed_during_preparation(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        baseline = dn.sha256_file(self.cfg.plist)
        self.cfg.plist.write_bytes(plistlib.dumps(dict(self.old, Label="edited")))
        with self.assertRaises(dn.DeployError):
            dep.swap(self.record, self.root / "events.log", self.moves, expect={baseline})
        self.assertEqual(svc.calls, [])
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())

    def test_rollback_refuses_without_the_parked_frontend(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        (self.root / "fe/frontend.before-rec").rename(self.root / "fe/elsewhere")
        with self.assertRaises(dn.DeployError):
            dep.rollback()
        self.assertTrue(svc.binary.endswith("new/houseatlas"))

    def test_live_commit_skips_model_switches(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        b = "/srv/houseatlas-main-bbbbbbb-20260101-v1/candidate/houseatlas"
        dn.save_record(self.cfg.ledger, {"id": "c", "kind": "code", "status": "verified", "binary": b, "sha": "f" * 40})
        dn.save_record(self.cfg.ledger, {"id": "m", "kind": "model", "status": "verified", "binary": b})
        self.assertEqual(dep.live_sha(Path(b)), "f" * 40)
        self.assertEqual(dep.live_sha(Path(SERVICE["ProgramArguments"][0])), "aaaaaaa")

    def test_no_new_change_while_one_is_unfinished(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dn.save_record(self.cfg.ledger, dict(self.record, status="swapping"))
        with self.assertRaises(dn.DeployError):
            dep.deploy("abcdef0")
        with self.assertRaises(dn.DeployError):
            dep.model(self.root / "release")

    def run_standalone(self, check=True, fail_bootstrap=False):
        dn.write_rollback_script(self.record, self.cfg)
        bin_dir = self.root / "bin"
        calls = self.root / "launchctl.calls"
        write(bin_dir / "launchctl", f"#!/bin/sh\necho \"$1\" >> {calls}\n[ \"$1\" = print ] && exit 1\n"
              + ("[ \"$1\" = bootstrap ] && exit 1\n" if fail_bootstrap else "") + "exit 0\n", mode=0o755)
        return subprocess.run([str(Path(self.record["dir"]) / "recovery/rollback.sh")], check=check,
                              capture_output=not check, env=dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}"))

    def test_standalone_script_restores_and_tells_the_ledger(self):
        write(self.root / "fe/frontend.next/assets/lazy-new.js", "chunk")
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dn.save_record(self.cfg.ledger, dict(self.record, id="older", status="verified"))
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, dict(self.record, status="verified"))
        self.run_standalone()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual((self.root / "fe/frontend/assets/lazy-new.js").read_text(), "chunk")
        self.assertEqual(plistlib.loads(self.cfg.plist.read_bytes()), self.old)
        self.assertEqual(dn.rollback_target(dn.ledger_records(self.cfg.ledger))["id"], "older")

    def test_standalone_script_handles_an_already_parked_frontend(self):
        self.moves[0][0].rename(self.moves[0][1])  # deploy stopped right after parking
        self.run_standalone()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())

    def test_standalone_script_refuses_without_the_parked_frontend(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, dict(self.record, status="verified"))
        (self.root / "fe/frontend.before-rec").rename(self.root / "fe/elsewhere")
        plist = self.cfg.plist.read_bytes()
        self.assertNotEqual(self.run_standalone(check=False).returncode, 0)
        self.assertFalse((self.root / "launchctl.calls").exists())
        self.assertEqual(self.cfg.plist.read_bytes(), plist)
        self.assertIn("new.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "verified")

    def test_standalone_script_can_be_retried_after_restoring_the_frontend(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, dict(self.record, status="verified"))
        self.assertNotEqual(self.run_standalone(check=False, fail_bootstrap=True).returncode, 0)
        self.assertFalse((self.root / "fe/frontend.before-rec").exists())
        self.run_standalone()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(plistlib.loads(self.cfg.plist.read_bytes()), self.old)
        self.assertNotEqual(self.run_standalone(check=False).returncode, 0)  # finished: nothing left to retry

    def test_standalone_retry_after_an_interruption_right_after_the_restore(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, dict(self.record, status="verified"))
        dn.write_rollback_script(self.record, self.cfg)
        script = (Path(self.record["dir"]) / "recovery/rollback.sh").read_text()
        move = script.index("  mv ", script.index("cksum <"))
        end = script.index("\n", move)
        partial = self.root / "partial.sh"  # stops right after the restoring move
        write(partial, script[:end] + "; exit 1" + script[end:], mode=0o755)
        bin_dir = self.root / "bin"
        write(bin_dir / "launchctl", "#!/bin/sh\n[ \"$1\" = print ] && exit 1\nexit 0\n", mode=0o755)
        subprocess.run(["bash", str(partial)], env=dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}"))
        self.assertFalse((self.root / "fe/frontend.before-rec").exists())
        self.run_standalone()
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(plistlib.loads(self.cfg.plist.read_bytes()), self.old)

    def test_standalone_retry_refuses_after_a_later_deployment(self):
        dep = dn.Deployer(self.cfg, FakeService(self.cfg), out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, dict(self.record, status="verified"))
        self.assertNotEqual(self.run_standalone(check=False, fail_bootstrap=True).returncode, 0)
        write(self.root / "fe/frontend/index.html", '<script src="/assets/newer.js">')  # a later deploy
        later = self.cfg.plist.read_bytes()
        self.assertNotEqual(self.run_standalone(check=False).returncode, 0)
        self.assertIn("newer.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(self.cfg.plist.read_bytes(), later)
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["status"], "verified")
        write(self.root / "fe/frontend/index.html", '<script src="/assets/old.js">')  # frontend back, service not
        self.cfg.plist.write_bytes(plistlib.dumps(dn.with_binary(SERVICE, self.root / "newer/houseatlas")))
        self.assertNotEqual(self.run_standalone(check=False).returncode, 0)

    def test_rollback_refuses_a_service_changed_by_hand(self):
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        dn.save_record(self.cfg.ledger, self.record)
        self.cfg.plist.write_bytes(plistlib.dumps(dict(self.old, Label="changed")))
        with self.assertRaises(dn.DeployError):
            dep.rollback()

    def test_old_process_that_will_not_stop_leaves_the_service_unchanged(self):
        svc = FakeService(self.cfg)
        svc.bootout = lambda: svc.calls.append("bootout")  # pid stays alive
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        with self.assertRaises(dn.DeployError):
            dep.swap(self.record, self.root / "events.log", self.moves)
        self.assertEqual(plistlib.loads(self.cfg.plist.read_bytes()), self.old)
        self.assertIn("old.js", (self.root / "fe/frontend/index.html").read_text())
        self.assertEqual(svc.calls[-1], "bootstrap")


class Prune(unittest.TestCase):
    """The keep set: what the live build, `rollback` and the service still use survives a prune."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.root = Path(os.path.realpath(self.tmp.name))
        self.setup = t / "setup"
        self.fe = self.setup / "houseatlas-main-0000000-20260101-v1/candidate"
        self.cfg = dn.Config(setup_root=self.setup, plist=t / "service.plist", label="example.houseatlas",
                             gateway_url="https://gateway.invalid", smoke_template=t / "smoke.json")
        self.ids = [f"houseatlas-main-{c * 7}-20260101-v1" for c in "abcdef"]  # f is live, e the one before
        for name in ["houseatlas-main-0000000-20260101-v1", *self.ids]:
            write(self.setup / name / "candidate/houseatlas", "bin")
            for f in ("target/release/houseatlas", "npm-cache/_cacache/x", "src/README.md", "smoke/smoke.out",
                      "backend-build.log"):
                write(self.setup / f"{name}-inputs" / f, "x" * 5000)
        write(self.fe / "frontend/index.html", "live")
        for name in [*self.ids, "houseatlas-main-manual"]:
            write(self.fe / f"frontend.before-{name}/index.html", "parked")
        write(self.fe / "frontend.next-old/index.html", "staged")
        write(self.fe / "frontend.rolled-back-x-20260101T000000Z/index.html", "newer")
        write(self.fe / "frontend.next-pinned/index.html", "smoke")
        write(self.root / "server.json", json.dumps({"frontendDirectory": str(self.fe / "frontend"),
                                                     "dataDirectory": str(t / "data")}))
        write(self.cfg.smoke_template, json.dumps({
            "homes": [{"workspaceId": "w", "homeId": "h"}], "dataDirectory": "/nonexistent/data",
            "frontendDirectory": str(self.fe / "frontend.next-pinned"),
            "logDirectory": str(self.setup / f"{self.ids[0]}-inputs/smoke/data/logs")}))
        live = self.setup / self.ids[-1] / "candidate/houseatlas"
        service = dn.with_binary(dict(SERVICE, WorkingDirectory=str(t)), live)
        service["ProgramArguments"] = [a if a != "/srv/server-config.json" else str(t / "server.json")
                                       for a in service["ProgramArguments"]] + [
            "--extra-cache", str(self.setup / f"{self.ids[1]}-inputs/npm-cache")]
        self.cfg.plist.write_bytes(plistlib.dumps(service))
        for prev, name in zip(["houseatlas-main-0000000-20260101-v1", *self.ids], self.ids):
            dn.save_record(self.cfg.ledger, dict(
                id=name, kind="code", status="verified", binary=str(self.setup / name / "candidate/houseatlas"),
                previous_binary=str(self.setup / prev / "candidate/houseatlas"), frontend=str(self.fe / "frontend"),
                parked_frontend=str(self.fe / f"frontend.before-{name}"),
                staged_frontend=str(self.fe / f"frontend.next-{name}")))
        self.dep = dn.Deployer(self.cfg, dn.Runner(self.cfg), out=io.StringIO())

    def tearDown(self):
        self.tmp.cleanup()

    def inputs(self, i, rest):
        return self.setup / f"{self.ids[i]}-inputs" / rest

    def test_keeps_live_and_rollback_caches_and_newest_parked_frontends(self):
        report = self.dep.prune()
        for i in (-1, -2):  # live, and the build `rollback` returns to
            self.assertTrue(self.inputs(i, "target/release/houseatlas").exists())
            self.assertTrue(self.inputs(i, "npm-cache").exists())
        for i in (0, 2, 3):
            self.assertFalse(self.inputs(i, "target").exists())
            self.assertFalse(self.inputs(i, "npm-cache").exists())
        self.assertFalse((self.setup / "houseatlas-main-0000000-20260101-v1-inputs/target").exists())
        for i in range(len(self.ids)):  # sources, logs, smoke results and every release folder stay
            for rest in ("src/README.md", "smoke/smoke.out", "backend-build.log"):
                self.assertTrue(self.inputs(i, rest).exists())
            self.assertTrue((self.setup / self.ids[i] / "candidate/houseatlas").exists())
        parked = sorted(p.name for p in self.fe.glob("frontend.before-*"))
        self.assertEqual(parked, [f"frontend.before-{n}" for n in self.ids[-3:]])
        self.assertFalse((self.fe / "frontend.next-old").exists())
        self.assertFalse((self.fe / "frontend.rolled-back-x-20260101T000000Z").exists())
        self.assertTrue((self.fe / "frontend/index.html").exists())
        self.assertGreater(report["allocatedBytes"], 0)
        self.assertIn("freedBytes", report)
        self.assertEqual(report["errors"], [])

    def test_never_touches_what_the_plist_or_smoke_template_names(self):
        report = self.dep.prune()
        self.assertTrue(self.inputs(1, "npm-cache/_cacache/x").exists())  # named by the plist
        self.assertFalse(self.inputs(1, "target").exists())
        self.assertTrue((self.fe / "frontend.next-pinned/index.html").exists())  # named by the smoke template
        self.assertTrue(self.inputs(0, "smoke/smoke.out").exists())
        self.assertFalse(self.inputs(0, "target").exists())  # the template names only its smoke folder
        self.assertEqual(sorted(Path(p["path"]).name for p in report["pinned"]), ["frontend.next-pinned", "npm-cache"])

    def test_dry_run_lists_without_removing(self):
        before = sorted(str(p) for p in self.setup.rglob("*"))
        dry = self.dep.prune(dry_run=True)
        self.assertEqual(sorted(str(p) for p in self.setup.rglob("*")), before)
        self.assertNotIn("freedBytes", dry)
        self.assertEqual([r["path"] for r in dry["removed"]], [r["path"] for r in self.dep.prune()["removed"]])

    def test_unfinished_records_and_the_rollback_target_keep_their_frontends(self):
        write(self.fe / "frontend.restored-x/index.html", "restoring")
        write(self.fe / "frontend.next-prepared/index.html", "inspecting")
        dn.save_record(self.cfg.ledger, dict(id="older", kind="code", status="rolling-back",
                                             restored_frontend=str(self.fe / "frontend.restored-x")))
        dn.save_record(self.cfg.ledger, dict(id="prep", kind="code", status="prepared",
                                             staged_frontend=str(self.fe / "frontend.next-prepared")))
        records = dn.ledger_records(self.cfg.ledger)
        old_parked = [self.fe / f"frontend.before-{self.ids[0]}"]
        remove, pinned = dn.prune_plan(self.setup, self.fe, records, [], old_parked, set())
        self.assertNotIn(self.fe / "frontend.restored-x", remove)
        self.assertNotIn(self.fe / "frontend.next-prepared", remove)
        self.assertNotIn(old_parked[0], remove)
        self.assertIn(self.fe / f"frontend.before-{self.ids[1]}", remove)
        self.assertIn(self.fe / "frontend.before-houseatlas-main-manual", remove)  # predates the ledger

    def test_does_not_follow_symlinks_out_of_the_prune_area(self):
        outside = self.root / "elsewhere"
        write(outside / "target/keep", "x")
        write(outside / "npm-cache/keep", "x")
        os.symlink(outside, self.setup / "houseatlas-main-1111111-20260101-v1-inputs")
        self.dep.prune()
        self.assertTrue((outside / "target/keep").exists())
        self.assertTrue((outside / "npm-cache/keep").exists())

    def test_a_folder_containing_the_whole_prune_area_pins_nothing(self):
        named = {self.root, self.setup}
        remove, pinned = dn.prune_plan(self.setup, self.fe, [], [], [], named)
        self.assertEqual(pinned, [])
        self.assertIn(self.inputs(0, "target"), remove)

    def test_a_failed_prune_still_leaves_the_deploy_verified(self):
        record = dict(dn.ledger_records(self.cfg.ledger)[-1])
        self.cfg.smoke_template.write_text("not json")
        self.dep.prune_into(record)
        saved = dn.ledger_records(self.cfg.ledger)[-1]
        self.assertEqual(saved["status"], "verified")
        self.assertTrue(saved["prune"]["errors"])
        self.assertTrue(self.inputs(0, "target").exists())

    def test_the_deploy_record_logs_what_was_removed(self):
        record = dict(dn.ledger_records(self.cfg.ledger)[-1])
        self.dep.prune_into(record)
        saved = dn.ledger_records(self.cfg.ledger)[-1]["prune"]
        self.assertIn(str(self.inputs(0, "target")), [r["path"] for r in saved["removed"]])
        self.assertGreaterEqual(saved["freedBytes"], 0)


if __name__ == "__main__":
    unittest.main()
