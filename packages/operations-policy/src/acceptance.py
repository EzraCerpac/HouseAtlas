"""AT-05 design acceptance checks; no production authorization or backup API."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import UUID


class Rejected(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Rejected(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exact_keys(value: dict, expected: set[str], context: str) -> None:
    require(isinstance(value, dict) and set(value) == expected,
            f"{context}: missing or unreviewed fields")


def canonical_uuid(value: str) -> None:
    try:
        require(str(UUID(value)) == value, "noncanonical UUID")
    except (ValueError, TypeError, AttributeError) as error:
        raise Rejected("invalid UUID") from error


def safe_path(value: str) -> str:
    require(isinstance(value, str) and value and "\\" not in value
            and "\x00" not in value, "unsafe bundle path")
    path = PurePosixPath(value)
    require(path.parts and not path.is_absolute() and str(path) == value
            and all(part not in {".", ".."} for part in path.parts),
            "unsafe bundle path")
    return value


def time_value(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None, "timezone required")
        return parsed
    except (ValueError, TypeError, AttributeError) as error:
        raise Rejected("invalid timestamp") from error


def can_read(role: str, member: bool, session_valid: bool,
             partition_allowed: bool, upstream: str) -> bool:
    """Timeout permits cached data; denied scope and principal revocation do not."""
    return (role in {"viewer", "editor"} and member and session_valid
            and partition_allowed and upstream in {"available", "timeout", "unavailable"})


def can_mutate(role: str, member: bool, session_valid: bool,
               resource_owner: str, revision_matches: bool) -> bool:
    return (role == "editor" and member and session_valid
            and resource_owner == "atlas" and revision_matches)


def rollback_choice(db_schema: int, reader_min: int, reader_max: int,
                    complete_prechange_bundle: bool) -> str:
    if reader_min <= db_schema <= reader_max:
        return "atlas-code-only"
    if complete_prechange_bundle:
        return "atlas-coherent-state-restore-with-loss-scope"
    return "stop"


def validate_envelope(manifest: dict) -> None:
    """Strict example of a quiesced local complete bundle acceptance boundary.

    Other capture methods require their own evidence and validator. This checker
    cannot prove that a real operator blocked writes; AT-15/22 must demonstrate it.
    """
    exact_keys(manifest, {"formatVersion", "state", "bundleId", "createdAt", "scope",
                         "capture", "compatibility", "components", "assets",
                         "identityInventory", "accessRecovery",
                         "privateRecoveryReferences", "checks"}, "manifest")
    require(manifest["formatVersion"] == 1 and manifest["state"] == "complete",
            "incomplete or unsupported recovery envelope")
    canonical_uuid(manifest["bundleId"])
    created = time_value(manifest["createdAt"])
    scope = manifest["scope"]
    exact_keys(scope, {"workspaceId", "homeId", "sourceInstanceId", "collectionId"}, "scope")
    for value in scope.values():
        canonical_uuid(value)
    capture = manifest["capture"]
    exact_keys(capture, {"method", "coordinationId", "windowStartedAt", "windowEndedAt",
                         "allWritersBlocked", "inFlightWritesDrained", "blobDeletionHeld",
                         "mutationEpochBefore", "mutationEpochAfter"}, "capture")
    require(capture["method"] == "quiesced-sqlite-backup-and-immutable-blobs",
            "capture method lacks reviewed acceptance evidence")
    canonical_uuid(capture["coordinationId"])
    require(time_value(capture["windowStartedAt"]) <= time_value(capture["windowEndedAt"])
            <= created, "capture window invalid")
    require(all(capture[key] is True for key in
                ("allWritersBlocked", "inFlightWritesDrained", "blobDeletionHeld")),
            "capture fence/drain incomplete")
    require(type(capture["mutationEpochBefore"]) is int
            and capture["mutationEpochBefore"] >= 0
            and capture["mutationEpochBefore"] == capture["mutationEpochAfter"],
            "capture epoch changed or unknown")
    compatibility = manifest["compatibility"]
    exact_keys(compatibility, {"contractVersion", "recordSchemaVersion", "atlasRelease",
                              "atlasDbSchemaVersion", "atlasMinReadableDbSchema",
                              "atlasMaxReadableDbSchema", "homeboxVersion", "runtimeIdentity",
                              "configVersion", "mediaPolicyVersion"}, "compatibility")
    require(compatibility["contractVersion"] == "1.0.0"
            and compatibility["recordSchemaVersion"] == 1, "wrong contract/schema")
    require(all(isinstance(compatibility[key], str) and compatibility[key]
                for key in ("atlasRelease", "homeboxVersion", "runtimeIdentity",
                            "configVersion", "mediaPolicyVersion")), "missing version identity")
    require(compatibility["homeboxVersion"] == "v0.26.2",
            "source version mismatch requires affected baseline requalification")
    require(all(type(compatibility[key]) is int and compatibility[key] >= 1
                for key in ("atlasDbSchemaVersion", "atlasMinReadableDbSchema",
                            "atlasMaxReadableDbSchema")), "missing database compatibility")
    require(compatibility["atlasMinReadableDbSchema"] <= compatibility["atlasDbSchemaVersion"]
            <= compatibility["atlasMaxReadableDbSchema"], "release cannot read bundle database")
    components = manifest["components"]
    require(isinstance(components, list) and components, "empty bundle")
    paths = set()
    kinds = {"atlas": set(), "homebox": set()}
    for component in components:
        exact_keys(component, {"owner", "kind", "bundlePath", "sha256", "bytes"}, "component")
        require(component["owner"] in kinds, "unreviewed owner (Network must stay untouched)")
        path = safe_path(component["bundlePath"])
        require(path not in paths, "duplicate component")
        paths.add(path)
        require(re.fullmatch(r"[0-9a-f]{64}", component["sha256"]) is not None,
                "invalid component digest")
        require(type(component["bytes"]) is int and component["bytes"] >= 0, "invalid byte count")
        require(component["kind"] in {"database", "blob", "configuration", "permissions", "identity"},
                "unreviewed component kind")
        kinds[component["owner"]].add(component["kind"])
    for owner in kinds:
        require({"database", "configuration", "permissions", "identity"} <= kinds[owner],
                f"{owner} recovery scope incomplete")
    require(isinstance(manifest["assets"], list), "invalid asset index")
    asset_ids = set()
    for asset in manifest["assets"]:
        exact_keys(asset, {"owner", "assetId", "bundlePath", "sha256", "bytes"}, "asset")
        canonical_uuid(asset["assetId"])
        key = (asset["owner"], asset["assetId"])
        require(key not in asset_ids, "duplicate asset identity")
        asset_ids.add(key)
        require(any(component["kind"] == "blob" and all(component[k] == asset[k]
                    for k in ("owner", "bundlePath", "sha256", "bytes"))
                    for component in components), "asset has no exact blob component")
    identities = manifest["identityInventory"]
    exact_keys(identities, {"atlasIds", "bindingKeys", "reconciliationJournalIds"}, "identity inventory")
    for key in ("atlasIds", "reconciliationJournalIds"):
        require(isinstance(identities[key], list) and len(identities[key]) == len(set(identities[key])),
                "invalid/duplicate identity inventory")
        for value in identities[key]:
            canonical_uuid(value)
    require(isinstance(identities["bindingKeys"], list), "invalid binding inventory")
    qualified_keys = set()
    for binding in identities["bindingKeys"]:
        exact_keys(binding, {"workspaceId", "sourceInstanceId", "collectionId", "sourceKind",
                             "externalId", "atlasId"}, "binding inventory key")
        require(binding["workspaceId"] == scope["workspaceId"], "wrong workspace binding scope")
        canonical_uuid(binding["sourceInstanceId"])
        require(binding["sourceKind"] in {"homebox-entity", "network-device", "network-group"},
                "unsupported physical binding source kind")
        require(isinstance(binding["collectionId"], str) and binding["collectionId"]
                and isinstance(binding["externalId"], str) and binding["externalId"],
                "missing opaque qualified source key")
        if binding["sourceKind"] == "homebox-entity":
            require(all(binding[k] == scope[k] for k in ("sourceInstanceId", "collectionId")),
                    "wrong HomeBox capture scope")
            canonical_uuid(binding["externalId"])
        require(binding["atlasId"] in identities["atlasIds"], "binding without permanent identity")
        key = tuple(binding[k] for k in ("workspaceId", "sourceInstanceId", "collectionId", "sourceKind", "externalId"))
        require(key not in qualified_keys, "duplicate qualified source key")
        qualified_keys.add(key)
    access = manifest["accessRecovery"]
    exact_keys(access, {"membershipIncluded", "currentRevocationsReconciled", "invalidatePriorSessions"},
               "access recovery")
    require(access["membershipIncluded"] is True and access["invalidatePriorSessions"] is True,
            "missing permission recovery/session invalidation")
    require(type(access["currentRevocationsReconciled"]) is bool, "invalid revocation evidence")
    # Reconciliation is required before reopening, not a fabricated capture-time result.
    require(isinstance(manifest["privateRecoveryReferences"], list)
            and manifest["privateRecoveryReferences"]
            and all(re.fullmatch(r"private-recovery:[a-z0-9-]+", ref) for ref in manifest["privateRecoveryReferences"]),
            "missing/unsafe private recovery reference")
    checks = manifest["checks"]
    exact_keys(checks, {"databaseIntegrity", "allReferencedBlobsVerified", "scopeAndIdentityVerified",
                        "emptyDirectoryRestoreEvidence"}, "checks")
    require(all(checks[k] is True for k in ("databaseIntegrity", "allReferencedBlobsVerified", "scopeAndIdentityVerified")),
            "bundle checks incomplete")
    require(isinstance(checks["emptyDirectoryRestoreEvidence"], str)
            and checks["emptyDirectoryRestoreEvidence"], "restore evidence reference missing")


def verify_bundle(manifest: dict, root: Path) -> None:
    validate_envelope(manifest)
    require(root.is_dir() and not root.is_symlink(), "invalid bundle root")
    trusted_root = root.resolve()
    expected = {component["bundlePath"] for component in manifest["components"]}
    for component in manifest["components"]:
        path = root / component["bundlePath"]
        current = path
        while current != root:
            require(not current.is_symlink(), "symlink in bundle")
            current = current.parent
        require(path.is_file() and path.resolve().is_relative_to(trusted_root), "missing/outside component")
        content = path.read_bytes()
        require(len(content) == component["bytes"] and sha256(content) == component["sha256"],
                "component bytes/digest mismatch")
    actual = {str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()}
    require(actual == expected, "unlisted component (possible secret/staging contamination)")


def reopening_allowed(manifest: dict, secrets_recovered: bool,
                      target_scope_verified: bool, actual_auth_denials_passed: bool) -> bool:
    return (manifest["accessRecovery"]["currentRevocationsReconciled"] is True
            and secrets_recovered and target_scope_verified and actual_auth_denials_passed)


def load_policy() -> dict:
    return json.loads((Path(__file__).resolve().parents[1] / "policy.json").read_text())
