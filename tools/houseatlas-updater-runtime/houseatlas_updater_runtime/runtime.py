"""Concrete orchestration over explicitly injected existing host operations.

No subprocess, platform discovery, shell, socket, service creation or privilege
fallback exists. Platform callbacks are owner-bound and must enforce the given
absolute monotonic deadline internally, including cancellation of native I/O.
"""

import time
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from houseatlas_updater.model import Health, Installed, Observation, Stopped
from houseatlas_updater.validation import digest, operation_id, require, sha256
from .native import read_file


@dataclass(frozen=True)
class Process:
    pid: int
    birth: bytes  # Full native birth identity, not PID/time rounded to seconds.
    executable: Path
    arguments: tuple[str, ...]  # Includes argv[0].
    service: bytes  # Existing launchd domain/account/job identity from owner config.


@dataclass(frozen=True)
class ExitProof:
    process: Process
    evidence: bytes  # Owner native process-exit proof for this full birth.


@dataclass(frozen=True)
class ApplicationExpectations:
    """Owner-pinned configured application selection; no caller-selected route/grant."""
    scope: tuple[str, str]
    model_configured: bool
    scene_configured: bool
    room_links_configured: bool
    publication_id: str | None
    overview_manifest_sha256: str | None
    model_sha256: str | None
    model_bytes: int | None
    source_revision_id: str | None
    source_sha256: str | None
    semantics_sha256: str | None
    room_links_sha256: str | None


@dataclass(frozen=True)
class ReadinessRequest:
    process: Process
    nonce: object
    expected: ApplicationExpectations


@dataclass(frozen=True)
class NativeReadiness:
    """Parsed results of qualified actual authorized application reads.

    The owner callback must validate current scoped view, overview and scene
    descriptors and exact model/media responses using existing Read/Media
    authority. It must enforce status, origin, no redirects/cache, bounded body,
    type/length/digest, complete selected references and current authorization.
    Optional configured companions require their own qualified read as well.
    Disk custody checks, manifest assertions and a listening port are insufficient.
    """
    request: ReadinessRequest
    scope: tuple[str, str]
    model_configured: bool
    scene_configured: bool
    room_links_configured: bool
    publication_id: str | None
    overview_manifest_sha256: str | None
    model_sha256: str | None
    model_bytes: int | None
    model_content_type: str | None
    model_content_digest: str | None
    source_revision_id: str | None
    source_sha256: str | None
    semantics_sha256: str | None
    room_links_sha256: str | None
    selection_revision: str | None
    model_selection_revision: str | None
    source_selection_revision: str | None
    room_links_selection_revision: str | None


@dataclass(frozen=True)
class Readiness:
    process: Process
    frontend_index: bytes  # Actual bounded service response, not disk bytes.
    application: NativeReadiness
    saved_index: bytes | None = None


@dataclass(frozen=True)
class PlatformOperations:
    process: Callable[[float], Process | None]
    fence: Callable[[float], object]
    fence_held: Callable[[object, float], bool]
    stop_existing: Callable[[Process, object, float], None]
    wait_exited: Callable[[Process, float], ExitProof]
    acquire_native: Callable[[float], object]
    native_lease_held: Callable[[object, float], bool]
    release_native: Callable[[object, float], None]
    # Starts only the existing qualified job, with exact paired canonical paths.
    # Atomically hands back launchd control using the same held fence.
    start_existing: Callable[[Installed, object, float], Process]
    readiness: Callable[[ReadinessRequest, float], Readiness]


@dataclass(frozen=True)
class _Lease:
    owner: object
    native: object
    fence: object
    exited: ExitProof


class Launcher:
    def __init__(self, store, inspector, operations: PlatformOperations,
                 read_installed: Callable[[float], Installed], service_identity: bytes,
                 *, operation_timeout_seconds: int = 30, claim_seconds: int = 5):
        require(type(service_identity) is bytes and bool(service_identity) and 1 <= operation_timeout_seconds <= 120 and
                1 <= claim_seconds <= 30, "layout-invalid")
        native_policy = inspector.policy
        for path in (native_policy.data_directory, native_policy.original_config,
                     native_policy.effective_config, *(item.path for item in native_policy.artifacts)):
            require(any(path == protected or protected in path.parents
                        for protected in store.policy.protected_roots), "layout-invalid")
        self.store, self.inspector, self.operations = store, inspector, operations
        self._read_installed, self.service = read_installed, service_identity
        self.timeout, self.claim_seconds, self.clock = operation_timeout_seconds, claim_seconds, time.monotonic
        self._owner, self._stopped, self._fresh = object(), None, None

    def deadline(self):
        return self.clock() + self.timeout

    def check_deadline(self, deadline):
        require(self.clock() < deadline, "boundary-failed")

    def read_installed(self, deadline):
        self.check_deadline(deadline)
        installed = self._read_installed(deadline)
        self.check_deadline(deadline)
        self.store.verify(installed, deadline)
        self.check_deadline(deadline)
        return installed

    def _process(self, process, installed):
        require(isinstance(process, Process) and type(process.pid) is int and process.pid > 0 and
                type(process.birth) is bytes and bool(process.birth) and process.service == self.service and
                process.executable == installed.binary and
                process.arguments == (str(installed.binary), *self.inspector.policy.arguments),
                "installed-changed")

    def _held(self, stopped, deadline):
        require(self._stopped is stopped and isinstance(stopped.lease, _Lease) and
                stopped.lease.owner is self._owner, "state-incompatible")
        lease = stopped.lease
        require(self.operations.fence_held(lease.fence, deadline) and
                self.operations.process(deadline) is None and
                self.operations.native_lease_held(lease.native, deadline), "state-incompatible")
        self.check_deadline(deadline)
        return lease

    def observe(self):
        deadline = self.deadline()
        installed = self.read_installed(deadline)
        if self._stopped is None:
            process = self.operations.process(deadline)
            self._process(process, installed)
            native = None
        else:
            process = None
            native = self._held(self._stopped, deadline).native
        runtime = self.inspector.inspect(installed, native, deadline)
        require(self.read_installed(deadline) == installed and
                self.operations.process(deadline) == process, "installed-changed")
        if self._stopped is not None:
            self._held(self._stopped, deadline)
        self.check_deadline(deadline)
        observation = Observation(installed, runtime, object())
        # Retain exactly the latest observation by object identity; no bearer
        # token, caller timestamp, integer sequence or persisted claim is accepted.
        self._fresh = (observation, self.clock())
        return observation

    def stop(self):
        require(self._stopped is None, "state-incompatible")
        deadline = self.deadline()
        installed = self.read_installed(deadline)
        process = self.operations.process(deadline)
        self._process(process, installed)
        fence = self.operations.fence(deadline)
        require(fence is not None and self.operations.fence_held(fence, deadline), "state-incompatible")
        # A replacement birth during fencing is never signalled or adopted.
        require(self.operations.process(deadline) == process, "installed-changed")
        self.check_deadline(deadline)
        self.operations.stop_existing(process, fence, deadline)
        exited = self.operations.wait_exited(process, deadline)
        require(isinstance(exited, ExitProof) and exited.process == process and bool(exited.evidence) and
                self.operations.process(deadline) is None and
                self.operations.fence_held(fence, deadline), "state-incompatible")
        native = self.operations.acquire_native(deadline)
        require(native is not None and self.operations.native_lease_held(native, deadline), "state-incompatible")
        runtime = self.inspector.inspect(installed, native, deadline)
        stopped = Stopped(runtime, _Lease(self._owner, native, fence, exited))
        self._stopped, self._fresh = stopped, None
        self._held(stopped, deadline)
        require(self.read_installed(deadline) == installed, "installed-changed")
        return stopped

    def inspect_stopped(self, stopped, deadline=None):
        # The core protocol starts a new boundary call without a deadline;
        # nested adapter calls preserve their existing absolute budget.
        if deadline is None:
            deadline = self.deadline()
        lease = self._held(stopped, deadline)
        installed = self.read_installed(deadline)
        current = self.inspector.inspect(installed, lease.native, deadline)
        require(current == stopped.runtime and self.read_installed(deadline) == installed, "state-incompatible")
        self._held(stopped, deadline)
        return current

    def consume(self, fresh, expected, stopped, deadline):
        retained, self._fresh = self._fresh, None  # Consume even if a later check fails.
        require(retained is not None and retained[0] is fresh and
                0 <= self.clock() - retained[1] < self.claim_seconds and
                fresh.installed == expected == self.read_installed(deadline) and
                fresh.runtime == self.inspect_stopped(stopped, deadline), "installed-changed")
        self.check_deadline(deadline)

    def start(self, stopped, installed):
        deadline = self.deadline()
        lease = self._held(stopped, deadline)
        require(self.read_installed(deadline) == installed and
                self.inspect_stopped(stopped, deadline) == stopped.runtime,
                "state-incompatible")
        self.check_deadline(deadline)
        self.operations.release_native(lease.native, deadline)
        require(not self.operations.native_lease_held(lease.native, deadline) and
                self.operations.fence_held(lease.fence, deadline) and
                self.operations.process(deadline) is None, "state-incompatible")
        self.check_deadline(deadline)
        process = self.operations.start_existing(installed, lease.fence, deadline)
        self._process(process, installed)
        require(self.operations.process(deadline) == process and
                (process.pid, process.birth) != (lease.exited.process.pid, lease.exited.process.birth),
                "installed-changed")
        self.check_deadline(deadline)
        self._stopped, self._fresh = None, None


ROOT_MARKER = b'id="root"'
# Exact serving transformation from backend/src/main.rs::frontend. No generic
# HTML normalization is accepted; a backend transform change requires review.
BOOTSTRAPPED_ROOT = (
    b'id="root" data-bootstrap-url="/api/atlas/view" '
    b'data-home-url-template="/api/atlas/homes/{workspaceId}/{homeId}/view" '
    b'data-session-url="/api/atlas/auth/session" data-login-url="/api/atlas/auth/login" '
    b'data-logout-url="/api/atlas/auth/logout" data-auth-mode-url="/api/atlas/auth/mode" '
    b'data-local-sign-in-url="/api/atlas/auth/local" data-proxy-sign-in-url="/api/atlas/auth/proxy"'
)
SERVED_INDEX_LIMIT = 4_000_000 + len(BOOTSTRAPPED_ROOT) - len(ROOT_MARKER)


class HealthProbe:
    def __init__(self, launcher: Launcher, expected: ApplicationExpectations):
        require(isinstance(expected, ApplicationExpectations) and
                callable(launcher.operations.readiness), "layout-invalid")
        require(type(expected.scope) is tuple and len(expected.scope) == 2, "layout-invalid")
        for identifier in expected.scope:
            operation_id(identifier)
        require(all(type(value) is bool for value in (expected.model_configured, expected.scene_configured,
                                                     expected.room_links_configured)), "layout-invalid")
        pins = {item.sha256 for item in launcher.inspector.policy.artifacts}
        if expected.model_configured:
            operation_id(expected.publication_id)
            require(digest(expected.overview_manifest_sha256) and digest(expected.model_sha256) and
                    type(expected.model_bytes) is int and 0 < expected.model_bytes <= 32 * 1024 * 1024 and
                    expected.overview_manifest_sha256 in pins and
                    any(item.sha256 == expected.model_sha256 and item.byte_size == expected.model_bytes
                        for item in launcher.inspector.policy.artifacts), "layout-invalid")
        else:
            require(not expected.scene_configured and not expected.room_links_configured and
                    all(value is None for value in (expected.publication_id, expected.overview_manifest_sha256,
                                                   expected.model_sha256, expected.model_bytes)), "layout-invalid")
        if expected.scene_configured:
            require(expected.model_configured and digest(expected.source_sha256) and
                    digest(expected.semantics_sha256) and expected.semantics_sha256 in pins and
                    type(expected.source_revision_id) is str and 0 < len(expected.source_revision_id) <= 256,
                    "layout-invalid")
        else:
            require(not expected.room_links_configured and all(value is None for value in
                    (expected.source_revision_id, expected.source_sha256, expected.semantics_sha256)),
                    "layout-invalid")
        require((expected.room_links_configured and expected.scene_configured and
                 digest(expected.room_links_sha256) and expected.room_links_sha256 in pins) or
                (not expected.room_links_configured and expected.room_links_sha256 is None),
                "layout-invalid")
        self.launcher, self.expected = launcher, expected

    def _application(self, evidence, request):
        expected = self.expected
        require(isinstance(evidence, NativeReadiness) and evidence.request is request and
                evidence.request.process == request.process, "health-failed")
        for name in ("scope", "model_configured", "scene_configured", "room_links_configured", "publication_id",
                     "overview_manifest_sha256", "model_sha256", "model_bytes", "source_revision_id",
                     "source_sha256", "semantics_sha256", "room_links_sha256"):
            actual, pinned = getattr(evidence, name), getattr(expected, name)
            require(type(actual) is type(pinned) and actual == pinned, "health-failed")
        if expected.model_configured:
            require(evidence.model_content_type == "model/gltf-binary" and
                    evidence.model_content_digest == "sha-256=:" + base64.b64encode(
                        bytes.fromhex(expected.model_sha256)).decode("ascii") + ":", "health-failed")
        else:
            require(evidence.model_content_type is None and evidence.model_content_digest is None, "health-failed")
        if expected.scene_configured:
            require(digest(evidence.selection_revision) and
                    evidence.model_selection_revision == evidence.source_selection_revision == evidence.selection_revision,
                    "health-failed")
        else:
            require(evidence.selection_revision is None and evidence.model_selection_revision is None and
                    evidence.source_selection_revision is None, "health-failed")
        require((expected.room_links_configured and evidence.room_links_selection_revision == evidence.selection_revision) or
                (not expected.room_links_configured and evidence.room_links_selection_revision is None), "health-failed")

    def verify(self, installed, timeout_seconds):
        launcher = self.launcher
        require(type(timeout_seconds) is int and 1 <= timeout_seconds <= 120 and
                launcher._stopped is None, "health-failed")
        deadline = launcher.clock() + timeout_seconds
        require(launcher.read_installed(deadline) == installed, "health-failed")
        process = launcher.operations.process(deadline)
        launcher._process(process, installed)
        runtime = launcher.inspector.inspect(installed, None, deadline)
        launcher.check_deadline(deadline)
        # This operation owns bounded fixed-route native readiness and actual
        # frontend response reads; it must cancel all I/O at this same deadline.
        request = ReadinessRequest(process, object(), self.expected)
        evidence = launcher.operations.readiness(request, deadline)
        require(isinstance(evidence, Readiness) and evidence.process == process and
                type(evidence.frontend_index) is bytes and len(evidence.frontend_index) <= SERVED_INDEX_LIMIT,
                "health-failed")
        self._application(evidence.application, request)
        index, _ = read_file(installed.frontend / "index.html", 4_000_000, 0o644, deadline)
        # Match the native UTF-8 contract, then undo only its exact fixed root
        # insertion. All other response bytes must equal the pinned raw index.
        index.decode("utf-8", errors="strict")
        require(index.count(ROOT_MARKER) == 1 and evidence.frontend_index.count(BOOTSTRAPPED_ROOT) == 1 and
                evidence.frontend_index.replace(BOOTSTRAPPED_ROOT, ROOT_MARKER, 1) == index,
                "health-failed")
        if installed.shell_identity is not None:
            saved, _ = read_file(installed.frontend / "saved/index.html", 4_000_000, 0o644, deadline)
            require(type(evidence.saved_index) is bytes and len(evidence.saved_index) <= 4_000_000 and
                    sha256(saved) == sha256(evidence.saved_index), "health-failed")
        require(launcher.operations.process(deadline) == process and
                launcher.read_installed(deadline) == installed and
                launcher.inspector.inspect(installed, None, deadline) == runtime, "health-failed")
        launcher.check_deadline(deadline)
        return Health(True, installed.revision, installed.selection, installed.frontend_identity,
                      runtime, installed.binary, installed.frontend, installed.shell_identity)
