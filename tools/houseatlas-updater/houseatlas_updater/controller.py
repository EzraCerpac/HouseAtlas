"""One controller shared by local typed callers. No runtime ports are installed."""

import os
import shutil
import stat
import tempfile
from pathlib import Path, PurePosixPath

from . import archive
from .journal import CODES, TERMINAL, Journal
from .model import (
    Acquisition, Bundle, HealthProbe, Installed, Launcher, ManifestVerifier,
    Policy, Publication, UpdateError,
)
from .native_binary import verify_macho
from .validation import (
    bundle as validate_bundle, canonical, compatible, installed as validate_installed,
    layout, operation_id, public_installed, public_selection, request, require,
    overlaps, runtime as validate_runtime, sha256,
)


class Controller:
    def __init__(self, policy: Policy, acquisition: Acquisition, manifest: ManifestVerifier,
                 launcher: Launcher, publication: Publication, health: HealthProbe):
        layout(policy)
        self.policy = policy
        self.acquisition = acquisition
        self.manifest = manifest
        self.launcher = launcher
        self.publication = publication
        self.health = health

    def status(self, identifier: str | None = None) -> dict | None:
        if identifier is not None:
            operation_id(identifier)
        directory = self.policy.journal_directory

        def read(owned_lock):
            data = Journal.read(directory)
            key = identifier if identifier is not None else data["current"]
            entry = data["operations"].get(key)
            pending = directory / "journal.next"
            # .next may belong to a different/new operation whose first durable
            # snapshot was never published. Keep this global fence separate
            # from historical operation results rather than misattributing it.
            if owned_lock and (pending.exists() or pending.is_symlink()):
                raise UpdateError("recovery-required")
            abandoned = owned_lock and entry is not None and entry["status"]["phase"] not in TERMINAL
            if abandoned:
                require(entry is not None, "recovery-required")
                status = entry["status"].copy()
                status.update(phase="recovery-needed", code="interrupted", recoveryNeeded=True,
                              active=None, rollback="blocked", healthVerified=False)
                return status
            return None if entry is None else entry["status"].copy()

        # A pristine directory has no updater state; status creates no files.
        if not any(path.exists() or path.is_symlink()
                   for path in (directory / "journal.json", directory / "journal.next")):
            return None
        try:
            with Journal(directory):
                return read(True)
        except UpdateError as error:
            if error.code != "busy":
                raise
            # An active writer owns .next until its atomic save completes. Read
            # only its last durable snapshot, without declaring interruption.
            return read(False)

    def execute(self, raw_request: bytes) -> dict:
        packet, selected = request(raw_request)
        identifier = packet["operationId"]
        action = packet["format"].split(".")[-2]
        with Journal(self.policy.journal_directory) as journal:
            layout(self.policy)
            old_status = journal.existing(identifier, sha256(canonical(packet)))
            if old_status is not None:
                return old_status
            status = {
                "format": "houseatlas.updater.status.v1", "operationId": identifier,
                "action": action, "sequence": 0, "updatedAt": "", "phase": "checking",
                "code": "none", "expectedInstalledRevision": packet["expectedInstalledRevision"],
                "requested": public_selection(selected), "previous": None, "active": None,
                "compatibility": "unknown", "rollback": "unknown", "healthVerified": False,
                "recoveryNeeded": False,
                "bundleContract": "unverified",
            }
            journal.begin(status, sha256(canonical(packet)))

            def record(phase: str, code: str = "none", **fields):
                return journal.transition(identifier, phase, code, **fields)

            stage = None
            stop_attempted = False
            candidate = None
            before = None
            state = None
            try:
                observed = self.launcher.observe()
                before, state = observed.installed, observed.runtime
                validate_installed(before, self.policy)
                validate_runtime(state)
                require(before.revision == packet["expectedInstalledRevision"], "installed-changed")
                record("checking", previous=public_installed(before), active=public_installed(before))
                acquired = self.acquisition.acquire(selected, self.policy)
                require(acquired.selection == selected, "release-identity-mismatch")
                producer = acquired.producer
                require(producer.repository == self.policy.repository and
                        producer.workflow == self.policy.workflow and
                        producer.ref == self.policy.source_ref and
                        producer.commit == selected.commit and producer.tree == selected.tree and
                        type(producer.run_id) is int and producer.run_id > 0 and
                        type(producer.attempt) is int and producer.attempt > 0, "producer-untrusted")
                require(type(acquired.manifest) is bytes and type(acquired.archive) is bytes and
                        0 < len(acquired.manifest) <= self.policy.max_manifest_bytes and
                        0 < len(acquired.archive) <= self.policy.max_archive_bytes,
                        "acquisition-failed")
                require(sha256(acquired.manifest) == selected.manifest_sha256 and
                        sha256(acquired.archive) == selected.archive_sha256, "digest-mismatch")
                admitted = self.manifest.verify(acquired, self.policy)
                validate_bundle(admitted, selected, before, state, self.policy)
                record("staging" if action == "apply" else "checking", compatibility="compatible",
                       bundleContract=admitted.contract)
                stage = Path(tempfile.mkdtemp(prefix="houseatlas-stage-", dir=self.policy.staging_parent))
                require(stage.stat().st_dev == self.policy.publication_root.stat().st_dev,
                        "layout-invalid")
                archive.extract(acquired, admitted, stage, self.policy)
                if admitted.shell_identity is not None and any(
                        part.name == "frontend" and part.action == "replace" for part in admitted.components):
                    from .release_bundle import verify_shell
                    verify_shell(stage / self.policy.frontend_root, admitted.shell_identity)
                components = {part.name: part for part in admitted.components}
                if components["backend"].action == "replace":
                    verify_macho(stage / self.policy.backend_entry, admitted.target, admitted.minimum_os)
                if action == "check":
                    # A check is advisory; apply re-acquires/revalidates and binds
                    # its own operation and fresh installed revision.
                    fresh = self.launcher.observe()
                    require(fresh.installed == before and fresh.runtime == state, "installed-changed")
                    return record("checked", rollback="eligible")

                record("staged", rollback="eligible")
                fresh = self.launcher.observe()
                require(fresh.installed == before and fresh.runtime == state, "installed-changed")
                # Write ahead of every externally consequential operation. A
                # boundary exception can be ambiguous, so never assume no effect.
                record("stopping")
                stop_attempted = True
                stopped = self.launcher.stop()
                require(stopped.runtime == state and
                        self.launcher.inspect_stopped(stopped) == state, "state-incompatible")
                fresh = self.launcher.observe()
                require(fresh.installed == before and fresh.runtime == state, "installed-changed")
                journal.check()
                layout(self.policy)
                record("publishing", active=None)
                published = self.publication.publish(stage, admitted, before, fresh, stopped)
                self.validate_publication(published, admitted, before)
                candidate = published
                require(self.launcher.inspect_stopped(stopped) == state, "state-incompatible")
                record("starting", active=public_installed(candidate))
                self.launcher.start(stopped, candidate)
                record("verifying")
                self.verify_health(candidate, state)
                return record("succeeded", healthVerified=True)
            except Exception as error:
                code = error.code if isinstance(error, UpdateError) and error.code in CODES else "boundary-failed"
                if not stop_attempted:
                    return record("rejected", code, compatibility=(
                        "incompatible" if code in {"state-incompatible", "platform-incompatible",
                                                   "component-incompatible"} else status["compatibility"]))
                if candidate is None:
                    return record("recovery-needed", code, rollback="blocked")
                # Rollback only after a fresh stopped native inspection. Never
                # restore native data, receipts, accounts or source-provider state.
                try:
                    record("rolling-back", code, healthVerified=False)
                    stopped = self.launcher.stop()
                    current = self.launcher.inspect_stopped(stopped)
                    require(stopped.runtime == current and compatible(state, current) and
                            current.storage == before.storage, "rollback-incompatible")
                    fresh = self.launcher.observe()
                    require(fresh.installed == candidate and fresh.runtime == current,
                            "rollback-incompatible")
                    journal.check()
                    restored = self.publication.restore(candidate, before, fresh, stopped)
                    require(restored == before and self.launcher.inspect_stopped(stopped) == current,
                            "rollback-incompatible")
                    validate_installed(restored, self.policy)
                    record("rolling-back", code, active=public_installed(restored))
                    self.launcher.start(stopped, restored)
                    self.verify_health(restored, current)
                    return record("rolled-back", code, healthVerified=True, rollback="eligible")
                except Exception as rollback_error:
                    rollback_code = ("rollback-incompatible" if isinstance(rollback_error, UpdateError)
                                     and rollback_error.code == "rollback-incompatible" else "rollback-failed")
                    return record("recovery-needed", rollback_code, rollback="blocked", active=None)
            finally:
                # Remove only this transaction's disposable extraction directory.
                # The publisher owns durable releases and must not move it into
                # a protected tree or use a different filesystem.
                if stage is not None and stage.exists():
                    try:
                        shutil.rmtree(stage)
                        archive.sync_directory(self.policy.staging_parent)
                    except OSError:
                        # Scratch cleanup cannot reverse a durable terminal
                        # result. Leave an identifiable generated stage for the
                        # owner; never expand cleanup beyond this owned path.
                        pass

    def validate_publication(self, value: Installed, admitted: Bundle, before: Installed):
        validate_installed(value, self.policy)
        require(value.revision == admitted.selection.manifest_sha256 and
                value.selection == admitted.selection and
                value.frontend_identity == admitted.frontend_identity and
                value.shell_identity == admitted.shell_identity and
                value.target == admitted.target and
                value.storage == admitted.storage and value.components == admitted.components,
                "release-identity-mismatch")
        components = {part.name: part for part in admitted.components}
        require(not overlaps(value.release_directory, before.release_directory), "component-incompatible")
        for name, path, previous in (("backend", value.binary, before.binary),
                                     ("frontend", value.frontend, before.frontend)):
            if components[name].action == "retain":
                require(path == previous, "component-incompatible")
            else:
                require(not overlaps(path, previous), "component-incompatible")
        if components["frontend"].action == "replace":
            actual = set()
            for entry in value.frontend.rglob("*"):
                require(not entry.is_symlink(), "archive-invalid")
                if entry.is_file():
                    actual.add(self.policy.frontend_root + "/" + entry.relative_to(value.frontend).as_posix())
                else:
                    require(entry.is_dir(), "archive-invalid")
            expected = {entry.path for entry in admitted.files
                        if entry.path.startswith(self.policy.frontend_root + "/")}
            require(actual == expected, "archive-invalid")
        for entry in admitted.files:
            if entry.path == self.policy.backend_entry:
                path = value.binary
                require(path == value.release_directory / self.policy.backend_entry, "archive-invalid")
            elif entry.path.startswith(self.policy.frontend_root + "/"):
                require(value.frontend == value.release_directory / self.policy.frontend_root, "archive-invalid")
                path = value.frontend.joinpath(*PurePosixPath(entry.path).relative_to(self.policy.frontend_root).parts)
            else:
                path = value.release_directory / entry.path
            require(path.resolve(strict=True) == path, "archive-invalid")
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as source:
                metadata = os.fstat(source.fileno())
                require(stat.S_ISREG(metadata.st_mode) and metadata.st_size == entry.size and
                        stat.S_IMODE(metadata.st_mode) == entry.mode and metadata.st_nlink == 1,
                        "archive-invalid")
                require(sha256(source.read(entry.size + 1)) == entry.sha256, "archive-invalid")

    def verify_health(self, installed: Installed, expected_runtime):
        health = self.health.verify(installed, self.policy.health_timeout_seconds)
        require(health.ready and health.revision == installed.revision and
                health.selection == installed.selection and
                health.frontend_identity == installed.frontend_identity and
                health.shell_identity == installed.shell_identity and
                health.binary == installed.binary and health.frontend == installed.frontend and
                health.runtime == expected_runtime, "health-failed")
