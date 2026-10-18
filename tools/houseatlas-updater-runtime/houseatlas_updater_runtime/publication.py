"""Exclusive immutable code closures and owner-mechanism exact activation CAS."""

import os
import stat
from pathlib import Path, PurePosixPath
from typing import Callable

from houseatlas_updater.archive import sync_directory
from houseatlas_updater.model import Bundle, Installed, Policy
from houseatlas_updater.validation import (
    bundle as validate_bundle, canonical, installed as validate_installed, json_object,
    layout, relative_path, require, sha256,
    private_directory,
)
from .native import CHUNK_BYTES, checkpoint, read_file, scan_file


RECORD = ".runtime-selection.json"
MANIFEST = ".release-manifest.json"


class CodeStore:
    """Never overwrites or removes a release; the selected manifest pins its bytes.

    parse_manifest is the owner's pinned packaging normalizer with retained
    trusted release/producer context. It is not caller-selected code or a path.
    Activation is separate: no current symlink or whole-directory root swap.
    """
    def __init__(self, policy: Policy, parse_manifest: Callable[[bytes, float], Bundle]):
        layout(policy)
        self.policy, self.parse_manifest = policy, parse_manifest

    def _paths(self, root: Path, bundle: Bundle, deadline: float) -> tuple[Path, Path]:
        checkpoint(deadline)
        require(root.parent == self.policy.publication_root and
                root.name == bundle.selection.manifest_sha256, "installed-invalid")
        record = root / RECORD
        if record.exists() or record.is_symlink():
            raw, _ = read_file(record, 4096, 0o600, deadline)
            value = json_object(raw, 4096)
            require(set(value) == {"revision", "binary", "frontend"} and
                    value["revision"] == root.name, "installed-invalid")
            paths = []
            for field in ("binary", "frontend"):
                paths.append(self.policy.publication_root / relative_path(value[field]))
            return paths[0], paths[1]
        # Initial owner-onboarded closures may predate the adapter record only
        # when both components are present in that exact immutable closure.
        require(all(part.action == "replace" for part in bundle.components), "installed-invalid")
        return root / self.policy.backend_entry, root / self.policy.frontend_root

    def verify(self, installed: Installed, deadline: float) -> None:
        checkpoint(deadline)
        validate_installed(installed, self.policy)
        visited: set[Path] = set()
        found = self._verify_root(installed.release_directory, visited, {}, deadline)
        require(found == installed, "installed-invalid")
        checkpoint(deadline)

    def _verify_root(self, root: Path, visited: set[Path], verified: dict[Path, Installed],
                     deadline: float) -> Installed:
        checkpoint(deadline)
        if root in verified:
            return verified[root]
        private_directory(root)
        require(root not in visited and len(visited) + len(verified) < 256 and root.resolve(strict=True) == root and
                root.parent == self.policy.publication_root, "installed-invalid")
        visited.add(root)
        raw, _ = read_file(root / MANIFEST, self.policy.max_manifest_bytes, 0o600, deadline)
        require(sha256(raw) == root.name, "installed-invalid")
        bundle = self.parse_manifest(raw, deadline)
        checkpoint(deadline)
        require(bundle.selection.manifest_sha256 == root.name and bundle.target == self.policy.target and
                bundle.contract == self.policy.bundle_contract, "installed-invalid")
        binary, frontend = self._paths(root, bundle, deadline)
        installed = Installed(root.name, bundle.selection, bundle.frontend_identity, bundle.components,
                              bundle.storage, binary, frontend, bundle.target, root, bundle.shell_identity)
        validate_installed(installed, self.policy)
        self.verify_payload(root, bundle, deadline)
        for name, path, entry in (("backend", binary, self.policy.backend_entry),
                                  ("frontend", frontend, self.policy.frontend_root)):
            part = next(part for part in bundle.components if part.name == name)
            checkpoint(deadline)
            if part.action == "replace":
                require(path == root / entry, "installed-invalid")
            else:
                require(part.action == "retain", "installed-invalid")
                ancestor = path
                for _ in PurePosixPath(entry).parts:
                    ancestor = ancestor.parent
                require(ancestor != root and path == ancestor / entry, "installed-invalid")
                # A release can retain both components from one predecessor.
                retained = self._verify_root(ancestor, visited, verified, deadline)
                previous_path = retained.binary if name == "backend" else retained.frontend
                prior_part = next(item for item in retained.components if item.name == name)
                require(path == previous_path and part.identity == prior_part.identity and
                        (part.required_installed is None or part.required_installed == prior_part.identity),
                        "installed-invalid")
                if name == "frontend":
                    require(bundle.frontend_identity == retained.frontend_identity and
                            bundle.shell_identity == retained.shell_identity, "installed-invalid")
        if bundle.shell_identity is not None and any(
                part.name == "frontend" and part.action == "replace" for part in bundle.components):
            from houseatlas_updater.release_bundle import verify_shell
            checkpoint(deadline)
            verify_shell(frontend, bundle.shell_identity)
            checkpoint(deadline)
        visited.remove(root)
        verified[root] = installed
        return installed

    def verify_payload(self, root: Path, bundle: Bundle, deadline: float) -> None:
        checkpoint(deadline)
        private_directory(root)
        expected = {spec.path for spec in bundle.files} | {MANIFEST}
        if (root / RECORD).exists() or (root / RECORD).is_symlink():
            expected.add(RECORD)
        require(0 < len(bundle.files) <= self.policy.max_files and
                sum(spec.size for spec in bundle.files) <= self.policy.max_payload_bytes,
                "archive-invalid")
        actual = set()
        directories = {parent.as_posix() for path in expected
                       for parent in PurePosixPath(path).parents if str(parent) != "."}
        pending = [root]
        count = 0
        while pending:
            checkpoint(deadline)
            directory = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    checkpoint(deadline)
                    count += 1
                    require(count <= self.policy.max_files * 4 + 3, "archive-invalid")
                    path = directory / entry.name
                    name = path.relative_to(root).as_posix()
                    meta = path.lstat()
                    require(meta.st_uid == os.geteuid() and not stat.S_ISLNK(meta.st_mode), "archive-invalid")
                    if stat.S_ISDIR(meta.st_mode):
                        require(name in directories and stat.S_IMODE(meta.st_mode) == 0o700,
                                "archive-invalid")
                        pending.append(path)
                    else:
                        require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1, "archive-invalid")
                        actual.add(name)
        require(actual == expected, "archive-invalid")
        for spec in bundle.files:
            checkpoint(deadline)
            relative_path(spec.path)
            require(spec.path == self.policy.backend_entry or
                    spec.path.startswith(self.policy.frontend_root + "/") or
                    (spec.path.startswith(self.policy.license_root + "/") and spec.path.endswith(".txt")),
                    "archive-invalid")
            require(spec.mode == (0o755 if spec.path == self.policy.backend_entry else 0o644),
                    "archive-invalid")
            scanned = scan_file(root / spec.path, spec.size, spec.mode, deadline, expected_size=spec.size)
            require(scanned.sha256 == spec.sha256, "archive-invalid")
        checkpoint(deadline)

    def create(self, stage: Path, bundle: Bundle, previous: Installed, deadline: float) -> Installed:
        checkpoint(deadline)
        layout(self.policy)
        require(stage.parent == self.policy.staging_parent and stage.resolve(strict=True) == stage and
                stage.stat().st_dev == self.policy.publication_root.stat().st_dev, "layout-invalid")
        self.verify(previous, deadline)
        self.verify_payload(stage, bundle, deadline)
        raw, _ = read_file(stage / MANIFEST, self.policy.max_manifest_bytes, 0o600, deadline)
        require(sha256(raw) == bundle.selection.manifest_sha256 and self.parse_manifest(raw, deadline) == bundle,
                "manifest-invalid")
        checkpoint(deadline)
        root = self.policy.publication_root / bundle.selection.manifest_sha256
        actions = {part.name: part.action for part in bundle.components}
        candidate = Installed(bundle.selection.manifest_sha256, bundle.selection, bundle.frontend_identity,
                              bundle.components, bundle.storage,
                              previous.binary if actions["backend"] == "retain" else root / self.policy.backend_entry,
                              previous.frontend if actions["frontend"] == "retain" else root / self.policy.frontend_root,
                              bundle.target, root, bundle.shell_identity)
        require(root != previous.release_directory, "installed-changed")
        # Exclusive reservation: no rename can replace an existing empty or
        # partially built immutable release. Partial unactivated code stays put
        # for owner review after an ambiguous write; never delete it here.
        checkpoint(deadline)
        root.mkdir(mode=0o700)
        for name, maximum, mode in [(spec.path, spec.size, spec.mode) for spec in bundle.files] + [
                (MANIFEST, self.policy.max_manifest_bytes, 0o600)]:
            checkpoint(deadline)
            target = root / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            self._copy(stage / name, target, maximum, mode, deadline)
        self._write(root / RECORD, canonical({"revision": candidate.revision,
                     "binary": str(candidate.binary.relative_to(self.policy.publication_root)),
                     "frontend": str(candidate.frontend.relative_to(self.policy.publication_root))}), 0o600, deadline)
        directories = []
        for path in root.rglob("*"):
            checkpoint(deadline)
            if path.is_dir():
                directories.append(path)
        for directory in sorted(directories, key=lambda p: len(p.parts), reverse=True):
            checkpoint(deadline)
            sync_directory(directory)
            checkpoint(deadline)
        sync_directory(root)
        checkpoint(deadline)
        sync_directory(root.parent)
        self.verify(candidate, deadline)
        self.verify(previous, deadline)
        return candidate

    @staticmethod
    def _write(path: Path, data: bytes, mode: int, deadline: float):
        checkpoint(deadline)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            for offset in range(0, len(data), CHUNK_BYTES):
                checkpoint(deadline)
                output.write(data[offset:offset + CHUNK_BYTES])
                checkpoint(deadline)
            output.flush()
            os.fchmod(output.fileno(), mode)
            os.fsync(output.fileno())
        checkpoint(deadline)

    @staticmethod
    def _copy(source: Path, target: Path, maximum: int, mode: int, deadline: float):
        checkpoint(deadline)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            scan_file(source, maximum, mode, deadline, consume=output.write)
            checkpoint(deadline)
            output.flush()
            os.fchmod(output.fileno(), mode)
            os.fsync(output.fileno())
        checkpoint(deadline)


class Publication:
    def __init__(self, launcher, store: CodeStore,
                 compare_and_swap: Callable[[Installed, Installed, object, object, float], None]):
        require(launcher.store is store, "layout-invalid")
        self.launcher, self.store, self.compare_and_swap = launcher, store, compare_and_swap
        self._published = None

    def publish(self, staged, bundle, previous, fresh, stopped):
        deadline = self.launcher.deadline()
        self.launcher.consume(fresh, previous, stopped, deadline)
        validate_bundle(bundle, bundle.selection, previous, fresh.runtime, self.store.policy)
        candidate = self.store.create(staged, bundle, previous, deadline)
        self._activate(previous, candidate, stopped, deadline)
        self._published = (candidate, previous, fresh.runtime)
        return candidate

    def _activate(self, expected, replacement, stopped, deadline):
        # Repeat the full stopped fence/lease/config inspection immediately
        # before the owner's exact activation CAS, after potentially slow copy.
        require(self.launcher.inspect_stopped(stopped, deadline) == stopped.runtime and
                self.launcher.read_installed(deadline) == expected, "installed-changed")
        self.store.verify(expected, deadline)
        self.store.verify(replacement, deadline)
        self.launcher.check_deadline(deadline)
        self.compare_and_swap(expected, replacement, stopped.lease.native, stopped.lease.fence, deadline)
        self.launcher.check_deadline(deadline)
        require(self.launcher.read_installed(deadline) == replacement and
                self.launcher.inspect_stopped(stopped, deadline) == stopped.runtime, "installed-changed")
        self.store.verify(replacement, deadline)

    def restore(self, candidate, previous, fresh, stopped):
        # Source implementation only; ordinary tests deliberately do not invoke
        # rollback. Restore activation metadata/code selections, never native data.
        deadline = self.launcher.deadline()
        self.launcher.consume(fresh, candidate, stopped, deadline)
        require(self._published == (candidate, previous, fresh.runtime) and
                candidate.storage == previous.storage == fresh.runtime.storage and
                fresh.runtime == stopped.runtime and not fresh.runtime.pending_transition,
                "rollback-incompatible")
        self._activate(candidate, previous, stopped, deadline)
        return previous
