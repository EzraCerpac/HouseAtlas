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


    def test_policy_smoke_args_keep_exact_pair_without_other_custody(self):
        policy = ["--atlas-display-policy", "/srv/model/display-policy.json", "--atlas-display-policy-sha256", "a" * 64]
        args = SERVICE["ProgramArguments"] + policy + ["--ai-account-selection", "/srv/ai.json"]
        selected = dn.model_args(args)
        self.assertEqual(selected[-4:], policy)
        self.assertNotIn("--ai-account-selection", selected)
        self.assertEqual(dn.with_binary(dict(SERVICE, ProgramArguments=args), Path("/srv/new/houseatlas"))["ProgramArguments"][1:], args[1:])

    def test_policy_arguments_refuse_partial_or_duplicate_selection(self):
        for args in [
            ["--atlas-display-policy", "/srv/policy.json"],
            ["--atlas-display-policy-sha256", "a" * 64],
            ["--atlas-display-policy", "relative.json", "--atlas-display-policy-sha256", "a" * 64],
            ["--atlas-display-policy", "/srv/policy.json", "--atlas-display-policy", "/srv/other.json"],
        ]:
            with self.assertRaises(dn.DeployError):
                dn.model_args(args)

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


    def test_policy_replacement_and_explicit_retirement(self):
        files = dn.validate_release(self.rel, self.data)
        selected = dict(SERVICE, ProgramArguments=SERVICE["ProgramArguments"] + [
            "--atlas-display-policy", "/srv/old/display-policy.json", "--atlas-display-policy-sha256", "a" * 64])
        with self.assertRaises(dn.DeployError):
            dn.with_model(selected, files)
        retired = dn.with_model(selected, files, without_display_policy=True)["ProgramArguments"]
        self.assertNotIn("--atlas-display-policy", retired)
        self.assertEqual(dn.flag_value(retired, "--atlas-entry-building-id"), "main_house")
        policy = write(self.rel / "display-policy.json", '{"profile":"synthetic"}')
        files = dn.validate_release(self.rel, self.data)
        replaced = dn.with_model(selected, files)["ProgramArguments"]
        self.assertEqual(dn.display_policy_args(replaced), (policy, dn.sha256_file(policy)))
        self.assertEqual(replaced.count("--atlas-display-policy"), 1)
        with self.assertRaises(dn.DeployError):
            dn.with_model(selected, files, without_display_policy=True)

    def test_private_policy_source_bounds_and_identity(self):
        policy = write(self.root / "source-policy.json", '{"profile":"synthetic"}')
        digest = dn.sha256_file(policy)
        self.assertEqual(dn.private_policy_bytes(policy, digest), policy.read_bytes())
        policy.chmod(0o644)
        self.assertRaises(dn.DeployError, dn.private_policy_bytes, policy, digest)
        policy.chmod(0o600)
        os.link(policy, self.root / "second-policy-link")
        self.assertRaises(dn.DeployError, dn.private_policy_bytes, policy, digest)
        (self.root / "second-policy-link").unlink()
        alias = self.root / "policy-alias"
        alias.symlink_to(policy)
        self.assertRaises(dn.DeployError, dn.private_policy_bytes, alias, digest)
        write(policy, "x" * 32769)
        self.assertRaises(dn.DeployError, dn.private_policy_bytes, policy, dn.sha256_file(policy))

    def staged_policy(self):
        files = dn.validate_release(self.rel, self.data)
        live_service = dn.with_model(SERVICE, files)
        cfg = dn.Config(setup_root=self.root / "setup", plist=self.root / "service.plist",
                        label="synthetic", gateway_url="https://gateway.invalid", smoke_template=self.root / "smoke.json")
        cfg.plist.write_bytes(plistlib.dumps(live_service))
        write(self.root / "frontend/index.html", '<script src="/assets/synthetic.js">')
        live = dict(service=live_service, binary=Path(live_service["ProgramArguments"][0]),
                    frontend=self.root / "frontend", data_dir=self.data)
        class StageOnly(dn.Deployer):
            def require_settled(self):
                pass
            def live(self):
                return live
            def model(self, release, **options):
                return dict(release=release, options=options)
        class NoEffects(dn.Runner):
            def run(self, *args, **kwargs):
                raise AssertionError("unexpected external command")
            def curl(self, *args, **kwargs):
                raise AssertionError("unexpected network request")
        dep = StageOnly(cfg, NoEffects(cfg), out=io.StringIO())
        policy = write(self.root / "source-policy.json", '{"profile":"synthetic"}')
        original = dn.release_stamp(files)
        before_service = cfg.plist.read_bytes()
        result = dep.policy(policy, dn.sha256_file(policy), prepare_only=True)
        return dep, files, policy, original, before_service, result

    def test_policy_stages_new_immutable_copy_without_active_writes(self):
        dep, files, policy, original, before_service, result = self.staged_policy()
        stage = result["release"]
        self.assertNotEqual(stage, self.rel)
        self.assertEqual(stage.parent, dep.cfg.setup_root)
        self.assertEqual(stage.stat().st_mode & 0o777, 0o700)
        for source in dn.release_paths(files):
            self.assertEqual(dn.sha256_file(stage / source.name), dn.sha256_file(source))
            self.assertEqual((stage / source.name).stat().st_nlink, 1)
            self.assertEqual((stage / source.name).stat().st_mode & 0o777, 0o600)
        self.assertEqual((stage / "display-policy.json").read_bytes(), policy.read_bytes())
        self.assertEqual(dn.release_stamp(files), original)
        self.assertEqual(dep.cfg.plist.read_bytes(), before_service)
        self.assertTrue(result["options"]["policy_only"])
        self.assertEqual(result["options"]["expected_service"], hashlib.sha256(before_service).hexdigest())
        self.assertEqual(result["options"]["expected_inputs"]["publication.json"], dn.sha256_file(files["publication.json"]))

    def test_policy_transaction_refuses_changed_service_and_post_smoke_inputs(self):
        dep, files, policy, original, before_service, result = self.staged_policy()
        stage, options = result["release"], result["options"]
        with self.assertRaises(dn.DeployError):
            dn.Deployer.model(dep, stage, prepare_only=True, policy_only=True,
                              expected_service="0" * 64, expected_inputs=options["expected_inputs"])
        def changed_smoke(*args, **kwargs):
            write(stage / "display-policy.json", '{"changed":true}')
            return dn.Checks()
        dep.smoke = changed_smoke
        with self.assertRaises(dn.DeployError):
            dn.Deployer.model(dep, stage, **options)
        self.assertEqual(dep.cfg.plist.read_bytes(), before_service)
        self.assertEqual(dn.release_stamp(files), original)

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


class PolicyHttpChecks(unittest.TestCase):
    def check(self, *, corrupt=False, configured=True):
        cfg = dn.Config(setup_root=Path("/unused"), plist=Path("/unused/service.plist"),
                        label="synthetic", gateway_url="https://gateway.invalid", smoke_template=Path("/unused/smoke.json"))
        rt = FakeService(cfg)
        calls = []
        body = json.dumps({"profile": "houseatlas.atlas-display-selection.v1", "workspaceId": "w", "homeId": "h",
                           "displayConfig": {"profile": "houseatlas.atlas-display.v1", "publicationId": "p",
                                             "semanticsSha256": "b" * 64, "groups": [], "memberships": []}}).encode()
        digest = hashlib.sha256(body).hexdigest()
        original = rt.curl
        def curl(url, **kwargs):
            calls.append(url)
            atlas = "https://gateway.invalid/api/atlas/models/v1/workspaces/w/homes/h/atlas"
            if url == atlas:
                return 200, {"x-atlas-display-policy-sha256": digest, "x-atlas-display-policy-bytes": str(len(body)),
                             "x-atlas-selection-revision": "c" * 64}, json.dumps({
                    "scope": {"workspaceId": "w", "homeId": "h"}, "selection": {"revision": "c" * 64},
                    "publication": {"publicationId": "p", "semanticsSha256": "b" * 64}}).encode()
            if url.startswith(atlas + "/p/display-policy?"):
                return 200, {"content-type": "application/json", "content-length": str(len(body)), "cache-control": dn.NO_STORE,
                             "x-content-type-options": "nosniff", "x-atlas-selection-revision": "c" * 64,
                             "content-digest": "bad" if corrupt else "sha-256=:" + dn.base64.b64encode(hashlib.sha256(body).digest()).decode() + ":"}, body
            return original(url, **kwargs)
        rt.curl = curl
        return dn.http_checks(rt, "https://gateway.invalid", assets=[], ws="w", home="h",
                              expect_policy=digest if configured else None), calls

    def test_policy_response_pins_and_default_absence(self):
        result, calls = self.check()
        self.assertFalse(result.failures)
        self.assertEqual(sum("/display-policy?" in url for url in calls), 1)
        absent, calls = self.check(configured=False)
        self.assertFalse(absent.failures)
        self.assertFalse(any("/homes/h/atlas" in url for url in calls))

    def test_policy_bad_content_digest_refuses_verification(self):
        result, _ = self.check(corrupt=True)
        self.assertTrue(result.failures)


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

    def test_policy_rollback_restores_exact_arguments_and_keeps_private_files(self):
        policy = write(self.root / "policy.json", '{"profile":"synthetic"}')
        after = dict(self.new, ProgramArguments=self.new["ProgramArguments"] + [
            "--atlas-display-policy", str(policy), "--atlas-display-policy-sha256", dn.sha256_file(policy)])
        Path(self.record["after_plist"]).write_bytes(plistlib.dumps(after))
        svc = FakeService(self.cfg)
        dep = dn.Deployer(self.cfg, svc, out=io.StringIO())
        dep.swap(self.record, self.root / "events.log", self.moves)
        self.assertEqual(dn.display_policy_args(dn.read_plist(self.cfg.plist)["ProgramArguments"]), (policy, dn.sha256_file(policy)))
        dn.save_record(self.cfg.ledger, self.record)
        dep.rollback()
        self.assertEqual(dn.read_plist(self.cfg.plist), self.old)
        self.assertTrue(policy.exists())
        self.assertEqual(policy.read_text(), '{"profile":"synthetic"}')

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

    def test_rolled_back_records_do_not_shorten_the_rollback_window(self):
        # Deploy a-f, roll back f, deploy g: rollback walks g, e, d, so those parked frontends stay.
        records = dn.ledger_records(self.cfg.ledger)
        dn.save_record(self.cfg.ledger, dict(records[-1], status="rolled-back"))
        g = "houseatlas-main-ggggggg-20260101-v1"
        write(self.fe / f"frontend.before-{g}/index.html", "parked")
        dn.save_record(self.cfg.ledger, dict(records[-1], id=g, previous_binary=records[-2]["binary"],
                                             parked_frontend=str(self.fe / f"frontend.before-{g}")))
        self.dep.prune()
        parked = sorted(p.name for p in self.fe.glob("frontend.before-*"))
        self.assertEqual(parked, sorted(f"frontend.before-{n}" for n in (self.ids[3], self.ids[4], g)))

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

    def test_a_standalone_prune_is_its_own_ledger_record(self):
        target = dn.rollback_target(dn.ledger_records(self.cfg.ledger))["id"]
        self.dep.prune_alone(dry_run=True)
        self.assertEqual(dn.ledger_records(self.cfg.ledger)[-1]["id"], target)  # a dry run records nothing
        self.dep.prune_alone()
        records = dn.ledger_records(self.cfg.ledger)
        self.assertEqual((records[-1]["kind"], records[-1]["status"]), ("prune", "pruned"))
        self.assertIn(str(self.inputs(0, "target")), [r["path"] for r in records[-1]["prune"]["removed"]])
        self.assertGreaterEqual(records[-1]["prune"]["freedBytes"], 0)
        self.assertEqual(dn.rollback_target(records)["id"], target)  # rollback still undoes the newest deploy
        self.assertEqual(self.dep.live_sha(Path(records[-2]["binary"])), "f" * 7)
        self.dep.prune_alone()  # a second run is a second record
        self.assertEqual(sum(r["kind"] == "prune" for r in dn.ledger_records(self.cfg.ledger)), 2)

    def test_repeated_prunes_keep_the_newest_prepared_frontend(self):
        write(self.fe / "frontend.next-prep/index.html", "inspecting")
        dn.save_record(self.cfg.ledger, dict(id="prep", kind="code", status="prepared",
                                             staged_frontend=str(self.fe / "frontend.next-prep")))
        self.dep.prune_alone()
        self.dep.prune_alone()
        self.assertTrue((self.fe / "frontend.next-prep/index.html").exists())

    def test_a_standalone_prune_waits_for_an_unfinished_record(self):
        dn.save_record(self.cfg.ledger, dict(dn.ledger_records(self.cfg.ledger)[-1], status="swapping"))
        with self.assertRaises(dn.DeployError):
            self.dep.prune_alone()
        self.assertTrue(self.inputs(0, "target").exists())

    def test_the_deploy_record_logs_what_was_removed(self):
        record = dict(dn.ledger_records(self.cfg.ledger)[-1])
        self.dep.prune_into(record)
        saved = dn.ledger_records(self.cfg.ledger)[-1]["prune"]
        self.assertIn(str(self.inputs(0, "target")), [r["path"] for r in saved["removed"]])
        self.assertGreaterEqual(saved["freedBytes"], 0)


if __name__ == "__main__":
    unittest.main()
