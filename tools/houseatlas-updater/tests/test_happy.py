"""Exact generated happy-path allowlist; no network/process/fault/crash/replay tests."""

import io
import json
import tempfile
import unittest
from pathlib import Path

from houseatlas_updater.cli import run
from houseatlas_updater.controller import Controller
from houseatlas_updater.journal import CODES, PHASES
from .synthetic import World, artifact, native_cut, packet


class GeneratedHappyPaths(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="houseatlas-updater-generated-")
        self.addCleanup(self.temporary.cleanup)
        self.world = World(Path(self.temporary.name))
        self.controller = Controller(self.world.policy, self.world, self.world.fixture_manifest,
                                     self.world, self.world, self.world)

    def test_check_generated_full_bundle(self):
        before = self.world.installed
        selected = self.world.add(artifact("0.2.0", 2))
        native = native_cut(self.world.root / "native")
        status = self.controller.execute(packet("check", selected, before))
        self.assertEqual(status["phase"], "checked")
        self.assertEqual(status["bundleContract"], "provisional-fixture")
        self.assertEqual(status["compatibility"], "compatible")
        self.assertFalse(status["healthVerified"])
        self.assertEqual(self.world.installed, before)
        self.assertEqual(native_cut(self.world.root / "native"), native)
        self.assertEqual(self.world.calls, ["observe", "acquire", "observe"])
        self.assertEqual(list(self.world.policy.staging_parent.iterdir()), [])

    def test_apply_generated_full_bundle_preserves_native_state(self):
        before = self.world.installed
        native = native_cut(self.world.root / "native")
        selected = self.world.add(artifact("0.2.0", 2))
        status = self.controller.execute(packet("apply", selected, before))
        self.assertEqual(status["phase"], "succeeded")
        self.assertEqual(status["active"]["revision"], selected.manifest_sha256)
        self.assertTrue(status["healthVerified"])
        self.assertFalse(status["recoveryNeeded"])
        self.assertEqual(native_cut(self.world.root / "native"), native)
        self.assertTrue(before.binary.is_file())
        self.assertTrue(before.frontend.is_dir())
        self.assertNotEqual(before.binary, self.world.installed.binary)
        self.assertNotEqual(before.frontend, self.world.installed.frontend)
        self.assertEqual(self.world.installed.binary.resolve(), self.world.installed.binary)
        self.assertEqual(self.world.installed.frontend.resolve(), self.world.installed.frontend)
        self.assertEqual(self.world.calls, ["observe", "acquire", "observe", "stop", "observe",
                                          "publish", "start", "health"])
        self.assertEqual(list(self.world.policy.staging_parent.iterdir()), [])
        activation = json.loads((self.world.policy.publication_root / "active.json").read_bytes())
        self.assertEqual(activation["revision"], status["active"]["revision"])

    def test_apply_frontend_only_retains_exact_backend(self):
        before = self.world.installed
        binary_bytes = before.binary.read_bytes()
        binary_inode = before.binary.stat().st_ino
        native = native_cut(self.world.root / "native")
        selected = self.world.add(artifact("0.2.0", 2, before))
        status = self.controller.execute(packet("apply", selected, before))
        self.assertEqual(status["phase"], "succeeded")
        self.assertEqual(self.world.installed.binary, before.binary)
        self.assertEqual(before.binary.stat().st_ino, binary_inode)
        self.assertEqual(before.binary.read_bytes(), binary_bytes)
        self.assertNotEqual(self.world.installed.frontend, before.frontend)
        self.assertEqual(native_cut(self.world.root / "native"), native)

    def test_cli_json_check_and_durable_status(self):
        selected = self.world.add(artifact("0.2.0", 2))
        output = io.StringIO()
        code = run(self.controller, io.BytesIO(packet("check", selected, self.world.installed)), output)
        self.assertEqual(code, 0)
        response = json.loads(output.getvalue())
        self.assertEqual(response["format"], "houseatlas.updater.result.v1")
        self.assertTrue(response["ok"])
        schema = json.loads((Path(__file__).resolve().parents[1] / "protocol.schema.json").read_bytes())
        self.assertEqual(set(schema["$defs"]["result"]["required"]), set(response))
        self.assertEqual(set(schema["$defs"]["status"]["required"]), set(response["status"]))
        self.assertEqual(set(schema["$defs"]["code"]["enum"]), CODES)
        self.assertEqual(set(schema["$defs"]["status"]["properties"]["phase"]["enum"]), PHASES)
        reopened = Controller(self.world.policy, self.world, self.world.fixture_manifest,
                              self.world, self.world, self.world)
        output = io.StringIO()
        code = run(reopened, io.BytesIO(b'{"format":"houseatlas.updater.status-request.v1","operationId":null}'), output)
        self.assertEqual(code, 0)
        saved = json.loads(output.getvalue())
        self.assertEqual(saved["status"], response["status"])
        # Public status has only code identities: no runtime config/paths/data
        # fingerprints, secret fixture bytes or arbitrary process output.
        text = output.getvalue()
        self.assertNotIn(str(self.world.root), text)
        self.assertNotIn("NOT A CREDENTIAL", text)
        self.assertNotIn("native_identities", text)
        self.assertNotIn("configuration", text)
