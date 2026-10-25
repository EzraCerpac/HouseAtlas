"""Trusted, optional composition of the existing updater; installs nothing.

Integration must establish the native session first, then construct the existing
EstablishedNativeReadTransport with owner-qualified numeric peer and TLS policy.
Pass that transport here; importing this module or listing tools never constructs
a transport, prepares a session, acquires a lease or opens an updater journal.
The returned MaintenanceOwner is installed only by explicit bridge injection.
The default bridge entrypoint does not import this module.
"""

from dataclasses import dataclass, fields, replace
from typing import Callable

from houseatlas_updater.controller import Controller
from houseatlas_updater.model import Acquisition, Bundle, Installed, ManifestVerifier, Policy
from houseatlas_updater.validation import require
from houseatlas_updater_runtime import (
    ApplicationExpectations, CodeStore, HealthProbe, Launcher, NativeInspector,
    NativePolicy, PlatformOperations, PreservingManifestVerifier, Process,
    Publication, Readiness, ReadinessRequest,
)
from houseatlas_updater_runtime.application_readiness import (
    EstablishedApplicationReadiness, PinnedApplicationDocuments,
)
from houseatlas_updater_runtime.established_native_http import (
    EstablishedNativeReadTransport, FixedRead,
)
from houseatlas_updater_runtime.native import NativeInput, NativeValidation, checkpoint
from houseatlas_updater_runtime.runtime import SERVED_INDEX_LIMIT
from maintenance_owner import MaintenanceOwner


@dataclass(frozen=True)
class TrustedMaintenanceBindings:
    """Owner inputs only; none is accepted from MCP JSON or environment lookup.

    Acquisition and manifest verification are the already qualified existing
    ports (for GitHub releases, GitHubReleaseAcquisition and ReleaseBundleV1).
    parse_manifest retains the same trusted producer context for installed code.
    The existing Controller alone opens/locks/syncs its policy-selected journal.

    Native validation must use the compiled configuration/Access/Atlas/profile
    read peers, coherent running captures and the supplied stopped native lease.
    Platform operations and pair CAS must use the existing qualified mechanisms,
    preserve original configuration/argv and native state, and enforce deadlines.
    Their implementation and onboarding remain the runtime owner's obligation.

    qualify_read_peer(process, deadline) must return literal True after proving
    this transport's fixed endpoint belongs to that full process birth under the
    existing gateway/TLS policy. A process lookup or HTTP 200 is insufficient.
    The platform readiness member is replaced by the concrete reader below.
    """

    policy: Policy
    acquisition: Acquisition
    manifest_verifier: ManifestVerifier
    parse_manifest: Callable[[bytes, float], Bundle]
    native_policy: NativePolicy
    validate_native: Callable[[NativeInput, float], NativeValidation]
    platform: PlatformOperations
    read_installed: Callable[[float], Installed]
    compare_and_swap: Callable[[Installed, Installed, object, object, float], None]
    service_identity: bytes
    application: ApplicationExpectations
    documents: PinnedApplicationDocuments
    established_bridge: object
    transport: EstablishedNativeReadTransport
    qualify_read_peer: Callable[[Process, float], bool]
    operation_timeout_seconds: int
    claim_seconds: int


def _index(attempt, route, limit):
    """Collect only one fixed bounded HTML response through the existing port."""
    body = bytearray()
    with attempt.open(FixedRead(route)) as response:
        while True:
            part = response.read(min(65536, limit + 1 - len(body)))
            require(len(body) + len(part) <= limit, "health-failed")
            if not part:
                break
            body.extend(part)
    attempt.guard()
    return bytes(body)


def compose_maintenance(bindings: TrustedMaintenanceBindings, *,
                        authorize: Callable[[str, bytes], bool]) -> MaintenanceOwner:
    """Return an unregistered owner using explicit established-session custody.

    authorize receives each exact command and original UTF-8 request bytes via
    MaintenanceOwner, and must return literal True for separate maintenance
    policy, target, selected release and current action-time approval. Native
    Editor/Read/Media authority supplies no maintenance approval. No grant cache,
    login, session refresh, service discovery or alternate updater exists here.
    """
    require(type(bindings) is TrustedMaintenanceBindings and callable(authorize), "layout-invalid")
    require(type(bindings.platform) is PlatformOperations and
            type(bindings.transport) is EstablishedNativeReadTransport, "layout-invalid")
    for callback in (bindings.parse_manifest, bindings.validate_native, bindings.read_installed,
                     bindings.compare_and_swap, bindings.qualify_read_peer,
                     *(getattr(bindings.platform, field.name) for field in fields(PlatformOperations))):
        require(callable(callback), "layout-invalid")
    require(callable(getattr(bindings.acquisition, "acquire", None)) and
            callable(getattr(bindings.manifest_verifier, "verify", None)), "layout-invalid")
    reader = EstablishedApplicationReadiness(bindings.established_bridge, bindings.transport,
                                             bindings.documents)
    require(type(bindings.application) is ApplicationExpectations and
            bindings.application.scope == bindings.transport._scope and
            (bindings.application.model_configured, bindings.application.scene_configured,
             bindings.application.room_links_configured) == tuple(raw is not None for raw in
                (bindings.documents.overview, bindings.documents.semantics, bindings.documents.room_links)),
            "layout-invalid")

    def readiness(request: ReadinessRequest, deadline: float) -> Readiness:
        checkpoint(deadline)
        require(bindings.platform.process(deadline) == request.process and
                bindings.qualify_read_peer(request.process, deadline) is True, "health-failed")
        checkpoint(deadline)
        installed = bindings.read_installed(deadline)
        require(installed.binary == request.process.executable, "health-failed")
        # Two sequential transport attempts share the HealthProbe's absolute
        # deadline: fixed HTML reads, then the reader's bracketed application
        # reads. Neither attempt retries a request or renews the time budget.
        with bindings.transport.attempt(deadline=deadline) as attempt:
            index = _index(attempt, "index", SERVED_INDEX_LIMIT)
            saved = (_index(attempt, "saved-index", 4_000_000)
                     if installed.shell_identity is not None else None)
        application = reader.read(request, deadline)
        require(bindings.qualify_read_peer(request.process, deadline) is True and
                bindings.platform.process(deadline) == request.process and
                bindings.read_installed(deadline) == installed, "health-failed")
        checkpoint(deadline)
        return Readiness(request.process, index, application, saved)

    store = CodeStore(bindings.policy, bindings.parse_manifest)
    inspector = NativeInspector(bindings.native_policy, bindings.validate_native)
    launcher = Launcher(store, inspector, replace(bindings.platform, readiness=readiness),
                        bindings.read_installed, bindings.service_identity,
                        operation_timeout_seconds=bindings.operation_timeout_seconds,
                        claim_seconds=bindings.claim_seconds)
    verifier = PreservingManifestVerifier(bindings.manifest_verifier, launcher, store)
    publication = Publication(launcher, store, bindings.compare_and_swap)
    health = HealthProbe(launcher, bindings.application)
    controller = Controller(bindings.policy, bindings.acquisition, verifier, launcher, publication, health)
    return MaintenanceOwner(controller, authorize=authorize)
