"""Typed, in-process boundaries; none grants remote or host maintenance authority.

The packaging owner owns raw release-bundle JSON. ManifestVerifier translates
that independently verified schema into Bundle; the controller still checks its
identity, compatibility, paths and complete archive closure. No production
manifest adapter is installed here until its exact schema is acknowledged.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class UpdateError(Exception):
    """Only fixed codes cross the caller/status boundary."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Selection:
    version: str
    commit: str
    tree: str
    release_id: int
    asset_id: int
    asset_name: str
    archive_sha256: str
    manifest_sha256: str


@dataclass(frozen=True)
class Producer:
    repository: str
    workflow: str
    ref: str
    commit: str
    tree: str
    run_id: int
    attempt: int


@dataclass(frozen=True)
class Acquired:
    selection: Selection
    manifest: bytes
    archive: bytes
    # Acquisition must verify actual provenance before returning this evidence.
    # Matching strings or hashes supplied by a caller are not that verification.
    producer: Producer


# Revision of this updater's normalized storage-mapping interpretation, NOT the
# caller JSON schema, MCP/JSON-RPC/HTTP protocol or a backend package version.
# Revision one supports only these unchanged preserve-no-migration profiles.
# The literal does not qualify an owner mapping, a contract hash or live state.
STORAGE_MAPPING_PROTOCOL_V1 = 1
_STORAGE_MAPPING_V1 = (
    ("houseatlas-persistent-server/1", "houseatlas-server-state/2", 1, "atlas", 5, 1),
    ("houseatlas-persistent-full-geodata-server/1", "houseatlas-server-state/2", 1,
     "full-geodata", 1, 1),
)


@dataclass(frozen=True)
class Storage:
    """Owner-normalized profile under the explicit updater mapping revision.

    This describes how the six fields are interpreted, not proof that native
    state implements them. Exact owner-reviewed hash mapping and fresh compiled
    native validation remain separate requirements. No default or inference.
    """
    receipt_format: str
    config_digest_format: str
    access_schema: int
    atlas_profile: str
    atlas_schema: int
    protocol: int

    def __post_init__(self):
        Storage.validate(self)

    def validate(self) -> None:
        """Recheck owner inputs before equality; bool/float are not integers."""
        if type(self) is not Storage:
            raise UpdateError("state-incompatible")
        values = tuple(getattr(self, name, None) for name in (
            "receipt_format", "config_digest_format", "access_schema",
            "atlas_profile", "atlas_schema", "protocol",
        ))
        if (tuple(type(value) for value in values) != (str, str, int, str, int, int)
                or self.protocol != STORAGE_MAPPING_PROTOCOL_V1
                or values not in _STORAGE_MAPPING_V1):
            raise UpdateError("state-incompatible")


@dataclass(frozen=True)
class Runtime:
    storage: Storage
    # Owner-normalized invariant binding of config/argv, excluding ONLY the two
    # release-derived executable/frontend path selections. Bind those separately
    # to Installed and Health. All private/source/model/AI/shell selections and
    # original private config bytes must remain pinned. Never public status.
    configuration: bytes
    # Stable named directory/database device+inode identities, not DB contents.
    native_identities: tuple[tuple[str, int, int], ...]
    receipt_identity: bytes
    pending_transition: bool = False


@dataclass(frozen=True)
class FileSpec:
    path: str
    size: int
    sha256: str
    mode: int


@dataclass(frozen=True)
class Component:
    name: str
    action: str  # replace or retain
    identity: str
    required_installed: str | None = None


@dataclass(frozen=True)
class Bundle:
    selection: Selection
    target: str
    minimum_os: str
    required_abi: tuple[str, ...]
    storage: Storage
    migration: str
    frontend_identity: str
    components: tuple[Component, ...]
    files: tuple[FileSpec, ...]
    # Optional archive copy of the exact externally digest-selected manifest.
    embedded_manifest: str | None = None
    contract: str = "provisional-fixture"
    shell_identity: str | None = None


@dataclass(frozen=True)
class Installed:
    revision: str
    selection: Selection
    frontend_identity: str
    components: tuple[Component, ...]
    storage: Storage
    binary: Path
    frontend: Path
    target: str
    release_directory: Path
    shell_identity: str | None = None


@dataclass(frozen=True)
class Observation:
    installed: Installed
    runtime: Runtime
    # Opaque fresh owner observation; publisher must consume it once as a CAS
    # claim. It is not caller input or a persisted bearer credential.
    claim: object


@dataclass(frozen=True)
class Stopped:
    runtime: Runtime
    # Owner-held native lease + proof of full exit and launchd relaunch fence.
    lease: object


@dataclass(frozen=True)
class Health:
    ready: bool
    revision: str
    selection: Selection
    frontend_identity: str
    runtime: Runtime
    binary: Path
    frontend: Path
    shell_identity: str | None = None


@dataclass(frozen=True)
class Policy:
    staging_parent: Path
    publication_root: Path
    journal_directory: Path
    # Includes native data/media/models/config/secrets trees; no such path is
    # ever accepted in check/apply requests or emitted in caller status.
    protected_roots: tuple[Path, ...]
    target: str
    os_version: str
    available_abi: tuple[str, ...]
    repository: str = "EzraCerpac/HouseAtlas"
    workflow: str = ".github/workflows/release-bundle.yml"
    source_ref: str = "refs/heads/main"
    max_archive_bytes: int = 64 * 1024 * 1024
    max_manifest_bytes: int = 512 * 1024
    max_payload_bytes: int = 128 * 1024 * 1024
    max_files: int = 2048
    health_timeout_seconds: int = 30
    backend_entry: str = "backend/houseatlas"
    frontend_root: str = "frontend"
    license_root: str = "licenses"
    manifest_names: tuple[str, ...] = ("manifest.json", "release-manifest.json")
    bundle_contract: str = "provisional-fixture"


class Acquisition(Protocol):
    def acquire(self, selection: Selection, policy: Policy) -> Acquired:
        """Bounded allowlisted acquisition and trusted producer verification.

        No arbitrary URL, redirect host, ref, executable or shell caller input.
        Enforce size/time limits while streaming, before allocating the result.
        """
        ...


class ManifestVerifier(Protocol):
    def verify(self, acquired: Acquired, policy: Policy) -> Bundle:
        """Validate pinned packaging schema and attestations; normalize Bundle."""
        ...


class Launcher(Protocol):
    def observe(self) -> Observation:
        """Fresh verified installed closure and actual native-owner validation.

        Validate full DB/profile/schema/receipt identities and every pending
        fence, not reported version integers. Runtime binds the complete private
        config/argv invariant except the two release-derived paths; Installed
        binds both canonical selections. Preserve original config bytes; any
        derived runtime config may change only those release selections.
        """
        ...

    def stop(self) -> Stopped:
        """Fence existing launchd relaunch, fully exit, acquire native lease.

        On error, preserve owner evidence; controller marks recovery-needed.
        Listener closure or an HTTP drain timeout is not process exit.
        """
        ...

    def inspect_stopped(self, stopped: Stopped) -> Runtime:
        """Fresh native-owner schema/receipt/fence/config inspection under lease."""
        ...

    def start(self, stopped: Stopped, installed: Installed) -> None:
        """Release native lease, start via existing qualified launchd mechanism.

        Preserve service identity, original config/argv/model/AI selections;
        select matching canonical binary/frontend. No provisioning or migration.
        """
        ...


class Publication(Protocol):
    def publish(
        self, staged: Path, bundle: Bundle, previous: Installed, fresh: Observation,
        stopped: Stopped,
    ) -> Installed:
        """Consume fresh claim, recheck CAS/state drift, sync immutable closure,
        then activate atomically using owner-qualified publication mechanics.

        Before any mutation enforce immutable versioned releases, disjoint new
        replacement paths and preservation of the prior verified closure. This
        method must not mutate protected roots or overwrite an existing release.
        On ambiguous failure, never assume no change.
        """
        ...

    def restore(
        self, candidate: Installed, previous: Installed, fresh: Observation,
        stopped: Stopped,
    ) -> Installed:
        """Code-only CAS to retained compatible closure, with fresh one-shot claim."""
        ...


class HealthProbe(Protocol):
    def verify(self, installed: Installed, timeout_seconds: int) -> Health:
        """Bounded actual-service identity, frontend, readiness and state evidence."""
        ...
