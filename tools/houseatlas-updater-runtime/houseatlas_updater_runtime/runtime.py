"""Concrete orchestration over explicitly injected existing host operations.

No subprocess, platform discovery, shell, socket, service creation or privilege
fallback exists. Platform callbacks are owner-bound and must enforce the given
absolute monotonic deadline internally, including cancellation of native I/O.
"""

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from houseatlas_updater.model import Health, Installed, Observation, Stopped
from houseatlas_updater.validation import require, sha256
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
class Readiness:
    process: Process
    ready: bool  # Parsed successful actual native-service readiness, not a port check.
    frontend_index: bytes  # Actual bounded service response, not disk bytes.
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
    readiness: Callable[[Process, float], Readiness]


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


class HealthProbe:
    def __init__(self, launcher: Launcher):
        self.launcher = launcher

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
        evidence = launcher.operations.readiness(process, deadline)
        require(isinstance(evidence, Readiness) and evidence.ready is True and evidence.process == process and
                type(evidence.frontend_index) is bytes and len(evidence.frontend_index) <= 4_000_000,
                "health-failed")
        index, _ = read_file(installed.frontend / "index.html", 4_000_000, 0o644, deadline)
        require(sha256(evidence.frontend_index) == sha256(index), "health-failed")
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
