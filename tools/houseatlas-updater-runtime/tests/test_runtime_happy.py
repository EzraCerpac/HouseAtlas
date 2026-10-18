"""Only generated successful apply/coherence; no rollback/failure/platform execution."""

import importlib.util
import hashlib
import base64
import gzip
import io
import json
import os
import sqlite3
import tempfile
import tarfile
import time
import unittest
from dataclasses import asdict, replace
from pathlib import Path

from houseatlas_updater.controller import Controller
from houseatlas_updater.validation import canonical, require, sha256
from houseatlas_updater_runtime import (
    ArtifactPin, CodeStore, ExitProof, HealthProbe, Launcher, NativeInspector, NativePolicy,
    NativeValidation, PlatformOperations, Process, Publication, Readiness,
)
from houseatlas_updater_runtime.publication import PreservingManifestVerifier
from houseatlas_updater_runtime.runtime import ApplicationExpectations, NativeReadiness


# Import only the inspected generated artifact helper, without colliding with
# the core tests package. No user/environment-selected source path is accepted.
_path = Path(__file__).resolve().parents[2] / "houseatlas-updater/tests/synthetic.py"
_spec = importlib.util.spec_from_file_location("runtime_generated_artifacts", _path)
generated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generated)


_base_artifact = generated.artifact


def runtime_artifact(version, number, previous=None):
    """Extend only the private generated helper with a real root and declared legacy assets."""
    original = _base_artifact(version, number, previous)
    manifest = json.loads(original.manifest)
    with tarfile.open(fileobj=io.BytesIO(original.archive), mode="r:gz") as archive:
        payload = {row["path"]: archive.extractfile(row["path"]).read() for row in manifest["files"]}
    payload["frontend/index.html"] = payload["frontend/index.html"].replace(
        b"<body>", b'<body><div id="root"></div>', 1)
    payload["frontend/assets/legacy-deadbeef.js"] = b"/* Generated prior lazy chunk; retained by manifest. */"
    manifest["files"] = [asdict(generated.FileSpec(path, len(data), sha256(data),
                          0o755 if path.startswith("backend/") else 0o644))
                         for path, data in sorted(payload.items())]
    identity = sha256(canonical({path: sha256(data) for path, data in payload.items()
                                 if path.startswith("frontend/")}))
    manifest["frontend_identity"] = identity
    next(part for part in manifest["components"] if part["name"] == "frontend")["identity"] = identity
    raw = canonical(manifest)
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0, filename="") as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
            for path, data in sorted({**payload, "manifest.json": raw}.items()):
                entry = tarfile.TarInfo(path)
                entry.mode, entry.size, entry.mtime = (0o755 if path.startswith("backend/") else 0o644), len(data), 0
                archive.addfile(entry, io.BytesIO(data))
    return replace(original, manifest=raw, archive=output.getvalue(),
                   selection=replace(original.selection, manifest_sha256=sha256(raw),
                                     archive_sha256=sha256(output.getvalue())))


# This privately imported fixture module has no other consumers. Its World must
# start with the same realistic generated artifact profile as later replacements.
generated.artifact = runtime_artifact

# Read the actual backend's fixed replacement literal for the fake wire response,
# independently of the adapter constant. No backend code or native binary runs.
_backend = Path(__file__).resolve().parents[3] / "backend/src/main.rs"
_line = next(line.strip() for line in _backend.read_text().splitlines() if "bytes = html.replace(" in line)
_served_root = json.loads(_line.split(", ", 1)[1].split(").into_bytes()", 1)[0]).encode()


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
        # Generated custody specimen exceeds the former implicit 4MiB limit.
        # Its exact size and reviewed 32MiB model cap are explicit owner policy;
        # source inspection/verification must hash it without materializing it.
        model = data / "models/model.fixture"
        remaining = 5 * 1024 * 1024 + 17
        model_size, model_hash = remaining, hashlib.sha256()
        block = b"generated-model!" * 4096
        with model.open("wb") as output:
            while remaining:
                chunk = block[:min(remaining, len(block))]
                output.write(chunk)
                model_hash.update(chunk)
                remaining -= len(chunk)
        self.model = model
        self.overview = data / "models/publication.fixture"
        self.scene = data / "models/scene.fixture"
        self.room_links = data / "models/room-links.fixture"
        overview = {"scope": ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"],
                    "publicationId": "00000000-0000-4000-8000-000000000103",
                    "modelSha256": model_hash.hexdigest(), "modelBytes": model_size}
        scene = {"sourceRevisionId": "generated-source-revision", "sourceSha256": sha256(b"generated source")}
        self.overview.write_bytes(canonical(overview))
        self.scene.write_bytes(canonical(scene))
        self.room_links.write_bytes(canonical({"profile": "generated-room-links", "links": []}))
        for path in (self.overview, self.scene, self.room_links):
            os.chmod(path, 0o600)
        self.application = ApplicationExpectations(
            scope=tuple(overview["scope"]), model_configured=True, scene_configured=True, room_links_configured=True,
            publication_id=overview["publicationId"], overview_manifest_sha256=sha256(self.overview.read_bytes()),
            model_sha256=model_hash.hexdigest(), model_bytes=model_size, source_revision_id=scene["sourceRevisionId"],
            source_sha256=scene["sourceSha256"], semantics_sha256=sha256(self.scene.read_bytes()),
            room_links_sha256=sha256(self.room_links.read_bytes()))
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
                                      (ArtifactPin("generated-model", model, model_size,
                                                   model_hash.hexdigest(), 32 * 1024 * 1024),
                                       *(ArtifactPin("generated-" + path.stem, path, path.stat().st_size,
                                                     sha256(path.read_bytes()), 65536)
                                         for path in (self.overview, self.scene, self.room_links)),
                                       *(ArtifactPin("generated-tls-" + str(number), path, path.stat().st_size,
                                                     sha256(path.read_bytes()), 65536)
                                         for number, path in enumerate(tls))))
        self.inspector = NativeInspector(native_policy, self.validate_generated)
        self.store = CodeStore(world.policy, self.parse_manifest)
        self.platform = PlatformOperations(
            self.process, self.take_fence, self.fence_held, self.stop_existing, self.wait_exited,
            self.acquire_native, self.native_lease_held, self.release_native,
            self.start_existing, self.readiness)
        self.launcher = Launcher(self.store, self.inspector, self.platform,
                                 self.read_installed, self.service)
        self.publisher = Publication(self.launcher, self.store, self.activate)
        verifier = PreservingManifestVerifier(world.fixture_manifest, self.launcher, self.store)
        self.controller = Controller(world.policy, world, verifier,
                                     self.launcher, self.publisher, HealthProbe(self.launcher, self.application))

    def new_process(self, installed):
        self.birth += 1
        return Process(123, b"generated-full-birth-" + str(self.birth).encode(), installed.binary,
                       (str(installed.binary), *self.arguments), self.service)

    def read_installed(self, deadline):
        require(time.monotonic() < deadline, "boundary-failed")
        return self.world.installed

    def parse_manifest(self, raw, deadline):
        require(time.monotonic() < deadline, "boundary-failed")
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

    def readiness(self, request, deadline):
        process = request.process
        require(self.running == process and time.monotonic() < deadline, "health-failed")
        self.calls.append("service-readiness")
        # Generated in-process response specimens only: no real HTTP, session,
        # native service or model parser qualification is represented here.
        overview, scene = json.loads(self.overview.read_bytes()), json.loads(self.scene.read_bytes())
        with self.model.open("rb") as source:
            model_hash = hashlib.file_digest(source, "sha256").hexdigest()
        revision = sha256(process.birth)
        application = NativeReadiness(
            request=request, scope=tuple(overview["scope"]), model_configured=True, scene_configured=True,
            room_links_configured=True, publication_id=overview["publicationId"],
            overview_manifest_sha256=sha256(self.overview.read_bytes()), model_sha256=model_hash,
            model_bytes=self.model.stat().st_size, model_content_type="model/gltf-binary",
            model_content_digest="sha-256=:" + base64.b64encode(bytes.fromhex(model_hash)).decode() + ":",
            source_revision_id=scene["sourceRevisionId"], source_sha256=scene["sourceSha256"],
            semantics_sha256=sha256(self.scene.read_bytes()), room_links_sha256=sha256(self.room_links.read_bytes()),
            selection_revision=revision, model_selection_revision=revision, source_selection_revision=revision,
            room_links_selection_revision=revision)
        raw = (self.world.installed.frontend / "index.html").read_bytes()
        return Readiness(process, raw.replace(b'id="root"', _served_root), application)


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
                self.assertEqual((owner.world.installed.frontend / "assets/legacy-deadbeef.js").read_bytes(),
                                 (original.frontend / "assets/legacy-deadbeef.js").read_bytes())
                self.assertEqual(list(owner.world.policy.staging_parent.iterdir()), [])
                owner.store.verify(original, time.monotonic() + 30)
                owner.store.verify(owner.world.installed, time.monotonic() + 30)
            # Reconstruct source adapters over durable release manifests/records;
            # reading retained closure/journal does not run a second activation.
            reopened = CodeStore(owner.world.policy, owner.parse_manifest)
            reopened.verify(owner.world.installed, time.monotonic() + 30)
            self.assertEqual(owner.calls, ["fence", "stop-full-birth", "prove-exit", "lease", "exact-cas",
                                          "release-lease", "start-existing", "service-readiness"] * 2)
            raw_status = canonical(owner.controller.status())
            self.assertNotIn(str(owner.world.root).encode(), raw_status)
            self.assertNotIn(b"configurationDigest", raw_status)
