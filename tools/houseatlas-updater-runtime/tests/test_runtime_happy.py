"""Only generated successful apply/coherence; no rollback/failure/platform execution."""

import importlib.util
import json
import os
import sqlite3
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path

from houseatlas_updater.controller import Controller
from houseatlas_updater.validation import canonical, require, sha256
from houseatlas_updater_runtime import (
    CodeStore, ExitProof, HealthProbe, Launcher, NativeInspector, NativePolicy,
    NativeValidation, PlatformOperations, Process, Publication, Readiness,
)


# Import only the inspected generated artifact helper, without colliding with
# the core tests package. No user/environment-selected source path is accepted.
_path = Path(__file__).resolve().parents[2] / "houseatlas-updater/tests/synthetic.py"
_spec = importlib.util.spec_from_file_location("runtime_generated_artifacts", _path)
generated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generated)


class GeneratedOwner:
    """In-process synthetic owner; NOT an implementation of native NAS validation."""
    def __init__(self, root):
        self.world = generated.World(root)
        world = self.world
        data = root / "native"
        for directory in (data / "media/blobs", data / "media/staging", root / "effective"):
            directory.mkdir(mode=0o700)
        for path in (data / "server.lock", data / "logs/server.events.jsonl"):
            path.write_bytes(b"generated stable private file")
            os.chmod(path, 0o600)
        tls = []
        for name in ("certificate.fixture", "private-key.fixture"):
            path = data / name
            path.write_bytes(b"generated placeholder; not TLS material or a credential")
            os.chmod(path, 0o600)
            tls.append(path)
        config = {"schemaVersion": 1, "dataDirectory": str(data), "logDirectory": str(data / "logs"),
                  "frontendDirectory": str(world.installed.frontend),
                  "tlsCertificate": str(tls[0]), "tlsPrivateKey": str(tls[1]),
                  "fixture": "not native ServerConfig validation"}
        original = data / "config.json"
        original.write_bytes(canonical(config))
        self.effective = root / "effective/config.json"
        self.effective.write_bytes(original.read_bytes())
        os.chmod(self.effective, 0o600)
        receipt = {"format": generated.STORAGE.receipt_format, "configurationDigest": "1" * 64,
                   "accessSchema": generated.STORAGE.access_schema, "atlasSchema": generated.STORAGE.atlas_schema}
        for name in ("access", "atlas"):
            meta = (data / (name + ".sqlite")).stat()
            receipt[name + "Device"], receipt[name + "Inode"] = meta.st_dev, meta.st_ino
        (data / "server-state.json").write_bytes(canonical(receipt))
        world.policy = replace(world.policy, protected_roots=(data, root / "effective"))
        self.arguments = ("serve", "--server-config", str(self.effective))
        self.service = b"generated-domain/account/existing-job"
        self.birth = 0
        self.running = self.new_process(world.installed)
        self.fence, self.native = None, None
        self.calls = []
        self.catalog = {world.installed.selection.manifest_sha256: generated.artifact("0.1.0", 1)}
        native_policy = NativePolicy(data, original, sha256(original.read_bytes()), self.effective,
                                      self.arguments, generated.STORAGE,
                                      (("generated-model", data / "models/model.fixture",
                                        sha256((data / "models/model.fixture").read_bytes())),
                                       *(("generated-tls-" + str(number), path, sha256(path.read_bytes()))
                                         for number, path in enumerate(tls))))
        self.inspector = NativeInspector(native_policy, self.validate_generated)
        self.store = CodeStore(world.policy, self.parse_manifest)
        self.platform = PlatformOperations(
            self.process, self.take_fence, self.fence_held, self.stop_existing, self.wait_exited,
            self.acquire_native, self.native_lease_held, self.release_native,
            self.start_existing, self.readiness)
        self.launcher = Launcher(self.store, self.inspector, self.platform,
                                 lambda: world.installed, self.service)
        self.publisher = Publication(self.launcher, self.store, self.activate)
        self.controller = Controller(world.policy, world, world.fixture_manifest,
                                     self.launcher, self.publisher, HealthProbe(self.launcher))

    def new_process(self, installed):
        self.birth += 1
        return Process(123, b"generated-full-birth-" + str(self.birth).encode(), installed.binary,
                       (str(installed.binary), *self.arguments), self.service)

    def parse_manifest(self, raw):
        acquired = self.catalog[sha256(raw)]
        require(acquired.manifest == raw, "manifest-invalid")
        return self.world.fixture_manifest.verify(acquired, self.world.policy)

    def validate_generated(self, request, deadline):
        require(time.monotonic() < deadline and
                (request.lease is None or request.lease is self.native), "state-incompatible")
        # This is intentionally the tiny generated fixture catalog, not the
        # actual Access/Atlas schema. Real owner onboarding must bind their
        # complete compiled read validators instead of this test function.
        for name, schema in (("access", 1), ("atlas", 5)):
            path = request.policy.data_directory / (name + ".sqlite")
            with sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
                require(db.execute("PRAGMA user_version").fetchone()[0] == schema and
                        db.execute("SELECT name FROM sqlite_master ORDER BY name").fetchall() == [("synthetic",)] and
                        db.execute("SELECT id,value FROM synthetic").fetchall() == [(1, "generated only")],
                        "state-incompatible")
        named = {name: (dev, ino) for name, dev, ino in request.identities}
        return NativeValidation(request.nonce, generated.STORAGE, "1" * 64,
                                named["access.sqlite"], named["atlas.sqlite"])

    def process(self, deadline):
        require(time.monotonic() < deadline, "boundary-failed")
        return self.running

    def take_fence(self, deadline):
        self.fence = object()
        self.calls.append("fence")
        return self.fence

    def fence_held(self, token, deadline):
        return self.fence is token and token is not None

    def stop_existing(self, process, fence, deadline):
        require(self.running == process and self.fence_held(fence, deadline), "state-incompatible")
        self.running = None
        self.calls.append("stop-full-birth")

    def wait_exited(self, process, deadline):
        require(self.running is None, "state-incompatible")
        self.calls.append("prove-exit")
        return ExitProof(process, b"generated native exit evidence")

    def acquire_native(self, deadline):
        require(self.running is None and self.fence is not None, "state-incompatible")
        self.native = object()
        self.calls.append("lease")
        return self.native

    def native_lease_held(self, token, deadline):
        return self.native is token and token is not None

    def release_native(self, token, deadline):
        require(self.native_lease_held(token, deadline), "state-incompatible")
        self.native = None
        self.calls.append("release-lease")

    def activate(self, expected, replacement, native, fence, deadline):
        require(self.world.installed == expected and self.native_lease_held(native, deadline) and
                self.fence_held(fence, deadline) and self.running is None, "installed-changed")
        config = json.loads(self.effective.read_bytes())
        config["frontendDirectory"] = str(replacement.frontend)
        # Only this generated fixture activation mechanism is exercised. Real
        # publication must use the qualified owner's guarded leaf CAS.
        temporary = self.effective.with_name("config.next")
        temporary.write_bytes(canonical(config))
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.effective)
        self.world.write_activation(replacement)
        self.world.installed = replacement
        self.calls.append("exact-cas")

    def start_existing(self, installed, fence, deadline):
        require(self.native is None and self.running is None and self.fence_held(fence, deadline),
                "state-incompatible")
        self.running, self.fence = self.new_process(installed), None
        self.calls.append("start-existing")
        return self.running

    def readiness(self, process, deadline):
        require(self.running == process, "health-failed")
        self.calls.append("service-readiness")
        return Readiness(process, True, (self.world.installed.frontend / "index.html").read_bytes())


class RuntimeHappyPaths(unittest.TestCase):
    def test_generated_full_and_frontend_apply_with_journal_coherence(self):
        with tempfile.TemporaryDirectory(prefix="houseatlas-runtime-generated-") as temporary:
            owner = GeneratedOwner(Path(temporary))
            native = generated.native_cut(owner.world.root / "native")
            original = owner.world.installed
            old_binary = original.binary.read_bytes()
            for number, frontend_only in ((2, False), (3, True)):
                before = owner.world.installed
                artifact = generated.artifact(f"0.{number}.0", number, before if frontend_only else None)
                owner.catalog[artifact.selection.manifest_sha256] = artifact
                selected = owner.world.add(artifact)
                status = owner.controller.execute(generated.packet("apply", selected, before, number))
                self.assertEqual(status["phase"], "succeeded", status)
                self.assertTrue(status["healthVerified"])
                self.assertFalse(status["recoveryNeeded"])
                self.assertEqual(owner.controller.status(status["operationId"]), status)
                self.assertEqual(status["active"]["revision"], selected.manifest_sha256)
                self.assertEqual(generated.native_cut(owner.world.root / "native"), native)
                self.assertEqual(original.binary.read_bytes(), old_binary)
                self.assertEqual(owner.running.executable, owner.world.installed.binary)
                self.assertEqual(json.loads(owner.effective.read_bytes())["frontendDirectory"],
                                 str(owner.world.installed.frontend))
                self.assertEqual(owner.world.installed.binary == before.binary, frontend_only)
                self.assertNotEqual(owner.world.installed.frontend, before.frontend)
                self.assertEqual(list(owner.world.policy.staging_parent.iterdir()), [])
                owner.store.verify(original)
                owner.store.verify(owner.world.installed)
            # Reconstruct source adapters over durable release manifests/records;
            # reading retained closure/journal does not run a second activation.
            reopened = CodeStore(owner.world.policy, owner.parse_manifest)
            reopened.verify(owner.world.installed)
            self.assertEqual(owner.calls, ["fence", "stop-full-birth", "prove-exit", "lease", "exact-cas",
                                          "release-lease", "start-existing", "service-readiness"] * 2)
            raw_status = canonical(owner.controller.status())
            self.assertNotIn(str(owner.world.root).encode(), raw_status)
            self.assertNotIn(b"configurationDigest", raw_status)
