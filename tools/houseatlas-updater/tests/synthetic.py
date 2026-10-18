"""Generated non-executable artifacts and deterministic, in-process fake ports.

NOT a production manifest adapter, acquisition transport, installer or launchd
implementation. All writes are below a caller-owned fresh TemporaryDirectory.
"""

import gzip
import io
import json
import os
import sqlite3
import struct
import tarfile
from dataclasses import asdict
from pathlib import Path

from houseatlas_updater.archive import extract, sync_directory
from houseatlas_updater.model import (
    Acquired, Bundle, Component, FileSpec, Health, Installed, Observation, Policy,
    Producer, Runtime, Selection, Stopped, Storage,
)
from houseatlas_updater.validation import canonical, public_selection, require, sha256


STORAGE = Storage("houseatlas-persistent-server/1", "houseatlas-server-state/2", 1, "atlas", 5, 1)
TARGET = "x86_64-apple-darwin"


def macho(marker: bytes) -> bytes:
    # A generated header and load command for parser tests, never runnable code.
    return struct.pack("<8I", 0xFEEDFACF, 0x01000007, 3, 2, 1, 24, 0, 0) + struct.pack(
        "<6I", 0x32, 24, 1, 13 << 16, 13 << 16, 0) + marker


def artifact(version: str, number: int, previous: Installed | None = None) -> Acquired:
    payload = {
        "frontend/index.html": b'<!doctype html><html><body>Generated fixture ' + version.encode() + b'</body></html>',
        "frontend/assets/app.js": b'/* Generated fixture; no network or application authority. */',
    }
    if previous is None:
        payload["backend/houseatlas"] = macho(version.encode())
    backend = (next(part.identity for part in previous.components if part.name == "backend")
               if previous is not None else sha256(payload["backend/houseatlas"]))
    frontend_identity = sha256(canonical({path: sha256(data) for path, data in payload.items()
                                         if path.startswith("frontend/")}))
    files = [asdict(FileSpec(path, len(data), sha256(data), 0o755 if path.startswith("backend/") else 0o644))
             for path, data in sorted(payload.items())]
    components = [asdict(Component("backend", "retain" if previous else "replace", backend)),
                  asdict(Component("frontend", "replace", frontend_identity))]
    manifest = canonical({
        "format": "houseatlas.updater.provisional-fixture.v1", "version": version,
        "commit": f"{number:040x}", "tree": f"{number + 100:040x}", "target": TARGET,
        "minimum_os": "13.0", "required_abi": ["synthetic-abi"], "storage": asdict(STORAGE),
        "migration": "none", "frontend_identity": frontend_identity,
        "components": components, "files": files, "embedded_manifest": "manifest.json",
    })
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0, filename="") as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
            contents = {**payload, "manifest.json": manifest}
            for name, data in sorted(contents.items()):
                entry = tarfile.TarInfo(name)
                entry.mode = 0o755 if name.startswith("backend/") else 0o644
                entry.size = len(data)
                entry.mtime = 0
                archive.addfile(entry, io.BytesIO(data))
    archive_bytes = output.getvalue()
    selected = Selection(version, f"{number:040x}", f"{number + 100:040x}", number, number + 1000,
                         f"houseatlas-{version}-intel-darwin.tar.gz", sha256(archive_bytes), sha256(manifest))
    producer = Producer("EzraCerpac/HouseAtlas", ".github/workflows/release-bundle.yml",
                        "refs/heads/main", selected.commit, selected.tree, number + 2000, 1)
    return Acquired(selected, manifest, archive_bytes, producer)


class FixtureManifest:
    def verify(self, acquired, policy):
        value = json.loads(acquired.manifest)
        require(value["format"] == "houseatlas.updater.provisional-fixture.v1", "manifest-invalid")
        require(value["version"] == acquired.selection.version and
                value["commit"] == acquired.selection.commit and value["tree"] == acquired.selection.tree,
                "release-identity-mismatch")
        return Bundle(acquired.selection, value["target"], value["minimum_os"],
                      tuple(value["required_abi"]), Storage(**value["storage"]), value["migration"],
                      value["frontend_identity"], tuple(Component(**part) for part in value["components"]),
                      tuple(FileSpec(**entry) for entry in value["files"]), value["embedded_manifest"])


class World:
    def __init__(self, root: Path):
        self.root = root
        os.chmod(root, 0o700)
        for name in ("publication", "staging", "journal", "native"):
            (root / name).mkdir(mode=0o700)
        native = root / "native"
        for name, schema in (("atlas.sqlite", 5), ("access.sqlite", 1)):
            with sqlite3.connect(native / name) as database:
                database.execute(f"PRAGMA user_version={schema}")
                database.execute("CREATE TABLE synthetic (id INTEGER PRIMARY KEY, value TEXT)")
                database.execute("INSERT INTO synthetic VALUES (1, 'generated only')")
            os.chmod(native / name, 0o600)
        for name in ("models", "media", "logs", "saved-copies"):
            (native / name).mkdir(mode=0o700)
        for name, data in {
            "models/model.fixture": b"generated model",
            "media/original.fixture": b"generated media",
            "logs/events.fixture": b"generated log",
            "saved-copies/copy.fixture": b"generated retained copy",
            "config.json": b'{"fixture":true}', "secrets.fixture": b"NOT A CREDENTIAL",
            "server-state.json": b"generated receipt", "unknown.fixture": b"preserve unknown native file",
        }.items():
            (native / name).write_bytes(data)
            os.chmod(native / name, 0o600)
        self.policy = Policy(root / "staging", root / "publication", root / "journal", (native,),
                             TARGET, "13.6", ("synthetic-abi",))
        self.catalog = {}
        self.calls = []
        self.claim = 0
        self.consumed_claims = set()
        self.stopped = None
        self.running = True
        self.fixture_manifest = FixtureManifest()
        old = artifact("0.1.0", 1)
        old_bundle = self.fixture_manifest.verify(old, self.policy)
        old_release = self.policy.publication_root / old.selection.manifest_sha256
        old_release.mkdir(mode=0o700)
        extract(old, old_bundle, old_release, self.policy)
        self.installed = Installed(old.selection.manifest_sha256, old.selection, old_bundle.frontend_identity,
                                   old_bundle.components, STORAGE, old_release / "backend/houseatlas",
                                   old_release / "frontend", TARGET, old_release)
        self.runtime = self.native_runtime()
        self.write_activation(self.installed)

    def native_runtime(self):
        native = self.root / "native"
        identities = tuple((name, (native / name).stat().st_dev, (native / name).stat().st_ino)
                           for name in (".", "atlas.sqlite", "access.sqlite", "models", "media"))
        return Runtime(STORAGE, (native / "config.json").read_bytes(), identities,
                       (native / "server-state.json").read_bytes())

    def add(self, acquired):
        self.catalog[acquired.selection] = acquired
        return acquired.selection

    def acquire(self, selected, policy):
        self.calls.append("acquire")
        return self.catalog[selected]

    def observe(self):
        self.calls.append("observe")
        self.claim += 1
        return Observation(self.installed, self.native_runtime(), self.claim)

    def stop(self):
        self.calls.append("stop")
        self.running = False
        self.stopped = object()
        return Stopped(self.native_runtime(), self.stopped)

    def inspect_stopped(self, stopped):
        require(not self.running and self.stopped is stopped.lease, "state-incompatible")
        return self.native_runtime()

    def start(self, stopped, installed):
        require(self.stopped is stopped.lease and installed == self.installed, "state-incompatible")
        self.calls.append("start")
        self.stopped = None
        self.running = True

    def consume(self, fresh, expected, stopped):
        require(fresh.claim == self.claim and fresh.claim not in self.consumed_claims and
                fresh.installed == self.installed == expected and
                self.inspect_stopped(stopped) == fresh.runtime, "installed-changed")
        self.consumed_claims.add(fresh.claim)

    def publish(self, staged, bundle, previous, fresh, stopped):
        self.consume(fresh, previous, stopped)
        self.calls.append("publish")
        target = self.policy.publication_root / bundle.selection.manifest_sha256
        require(not target.exists() and staged.stat().st_dev == target.parent.stat().st_dev,
                "layout-invalid")
        os.rename(staged, target)
        sync_directory(target.parent)
        actions = {part.name: part.action for part in bundle.components}
        installed = Installed(bundle.selection.manifest_sha256, bundle.selection, bundle.frontend_identity,
                              bundle.components, bundle.storage,
                              previous.binary if actions["backend"] == "retain" else target / self.policy.backend_entry,
                              previous.frontend if actions["frontend"] == "retain" else target / "frontend",
                              bundle.target, target, bundle.shell_identity)
        self.write_activation(installed)
        self.installed = installed
        return installed

    def restore(self, candidate, previous, fresh, stopped):
        self.consume(fresh, candidate, stopped)
        self.calls.append("restore")
        self.write_activation(previous)
        self.installed = previous
        return previous

    def write_activation(self, installed):
        # Reference fixture only. The NAS owner's existing guarded leaf
        # publication is a different runtime adapter, not this example record.
        root = self.policy.publication_root
        data = canonical({"revision": installed.revision,
                          "binary": str(installed.binary.relative_to(root)),
                          "frontend": str(installed.frontend.relative_to(root))})
        with (root / "active.next").open("xb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(root / "active.next", root / "active.json")
        sync_directory(root)

    def verify(self, installed, timeout_seconds):
        self.calls.append("health")
        require(self.running and installed == self.installed and 0 < timeout_seconds <= 120,
                "health-failed")
        return Health(True, installed.revision, installed.selection,
                      installed.frontend_identity, self.native_runtime(), installed.binary, installed.frontend,
                      installed.shell_identity)


def packet(action: str, selected: Selection, before: Installed, number: int = 1) -> bytes:
    return canonical({"format": f"houseatlas.updater.{action}.v1",
                      "operationId": f"00000000-0000-4000-8000-{number:012d}",
                      "expectedInstalledRevision": before.revision, "release": public_selection(selected)})


def native_cut(root: Path):
    return {str(path.relative_to(root)): (path.stat().st_dev, path.stat().st_ino,
                                         path.stat().st_mode,
                                         path.read_bytes() if path.is_file() else None)
            for path in (root, *sorted(root.rglob("*")))}
