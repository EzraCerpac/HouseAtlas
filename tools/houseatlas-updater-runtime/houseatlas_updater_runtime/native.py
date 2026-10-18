"""Private, read-only filesystem capture surrounding the native owner's validators.

No SQLite version heuristic substitutes for compiled Access/Atlas validation.
The required validator must validate the captured selection using those owners.
"""

import os
import hashlib
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from houseatlas_updater.model import Installed, Runtime, Storage
from houseatlas_updater.validation import canonical, digest, json_object, require, sha256


CHUNK_BYTES = 64 * 1024
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024


def checkpoint(deadline: float) -> None:
    require(time.monotonic() < deadline, "boundary-failed")


@dataclass(frozen=True)
class FileScan:
    byte_size: int
    sha256: str
    identity: tuple[int, int]
    mode: int


def scan_file(path: Path, maximum: int, mode: int | None, deadline: float,
              *, expected_size: int | None = None,
              consume: Callable[[bytes], object] | None = None) -> FileScan:
    """Hash one pinned descriptor in bounded chunks; never accumulate file bytes.

    Local deadline checks surround each read/callback and descriptor/path check.
    They cannot preempt an OS filesystem operation that itself blocks.
    """
    checkpoint(deadline)
    require(type(maximum) is int and maximum >= 0 and
            (expected_size is None or type(expected_size) is int and 0 <= expected_size <= maximum),
            "state-incompatible")
    require(path.is_absolute() and path.resolve(strict=True) == path, "state-incompatible")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_uid == os.geteuid() and before.st_size <= maximum and
                (expected_size is None or before.st_size == expected_size) and
                (mode is None or stat.S_IMODE(before.st_mode) == mode), "state-incompatible")
        hasher, total = hashlib.sha256(), 0
        while total <= maximum:
            checkpoint(deadline)
            block = source.read(min(CHUNK_BYTES, maximum + 1 - total))
            checkpoint(deadline)
            if not block:
                break
            total += len(block)
            require(total <= maximum, "state-incompatible")
            hasher.update(block)
            if consume is not None:
                consume(block)
                checkpoint(deadline)
        after = os.fstat(source.fileno())
    named = path.lstat()
    def stable(meta):
        return (meta.st_dev, meta.st_ino, meta.st_size, meta.st_mode, meta.st_uid, meta.st_gid,
                meta.st_nlink, meta.st_mtime_ns, meta.st_ctime_ns)
    require(total == before.st_size and stable(before) == stable(after) == stable(named) and
            (before.st_dev, before.st_ino) == (named.st_dev, named.st_ino), "state-incompatible")
    checkpoint(deadline)
    return FileScan(total, hasher.hexdigest(), (before.st_dev, before.st_ino), before.st_mode)


def read_file(path: Path, maximum: int, mode: int | None, deadline: float) -> tuple[bytes, tuple[int, int]]:
    blocks = []
    result = scan_file(path, maximum, mode, deadline, consume=blocks.append)
    return b"".join(blocks), result.identity


@dataclass(frozen=True)
class ArtifactPin:
    """Exact owner-selected custody, including the independently reviewed bound."""
    name: str
    path: Path
    byte_size: int
    sha256: str
    maximum_bytes: int  # Per-artifact review; never above the reviewed 32MiB ceiling.


@dataclass(frozen=True)
class NativePolicy:
    data_directory: Path
    original_config: Path
    original_config_sha256: str
    effective_config: Path
    arguments: tuple[str, ...]  # Exact argv after argv[0], including stable --server-config path.
    storage: Storage  # Reviewed mapping, not a release-manifest assertion.
    # Complete private argv-selected model/AI/source/shell/TLS artifacts and custody pins.
    artifacts: tuple[ArtifactPin, ...]
    maximum_entries: int = 8192


@dataclass(frozen=True)
class NativeInput:
    policy: NativePolicy
    installed: Installed
    config: bytes
    original_config: bytes
    receipt: bytes
    identities: tuple[tuple[str, int, int], ...]
    lease: object | None
    nonce: object


@dataclass(frozen=True)
class NativeValidation:
    """Result of actual compiled-owner read validation of this exact capture.

    The callback validates complete config/argv, Access catalog/meta/epoch and
    Atlas catalog/ledger/lineage plus selected profile peers/document custody.
    Returning manifest versions or calling a provisioning/reopen writer is invalid.
    """
    nonce: object
    storage: Storage
    configuration_digest: str  # Native ServerConfig::state_digest (JCS), not Python JSON.
    access_identity: tuple[int, int]
    atlas_identity: tuple[int, int]


class NativeInspector:
    def __init__(self, policy: NativePolicy,
                 validate_native: Callable[[NativeInput, float], NativeValidation]):
        require(digest(policy.original_config_sha256) and 1 <= policy.maximum_entries <= 65536,
                "layout-invalid")
        require(policy.original_config != policy.effective_config and
                policy.data_directory not in policy.effective_config.parents,
                "layout-invalid")
        require(len(policy.artifacts) <= 256 and
                len({item.name for item in policy.artifacts}) == len(policy.artifacts) and
                all(type(item.name) is str and 0 < len(item.name) <= 120 and digest(item.sha256) and
                    type(item.byte_size) is int and type(item.maximum_bytes) is int and
                    0 <= item.byte_size <= item.maximum_bytes <= MAX_ARTIFACT_BYTES and item.maximum_bytes > 0
                    for item in policy.artifacts), "layout-invalid")
        require(bool(policy.arguments) and policy.arguments[0] == "serve" and
                policy.arguments.count("--server-config") == 1, "layout-invalid")
        index = policy.arguments.index("--server-config")
        require(index + 1 < len(policy.arguments) and
                policy.arguments[index + 1] == str(policy.effective_config), "layout-invalid")
        self.policy, self.validate_native = policy, validate_native

    def _identities(self, deadline: float) -> tuple[tuple[tuple[str, int, int], ...], bytes]:
        checkpoint(deadline)
        root = self.policy.data_directory
        require(root.is_absolute() and root.resolve(strict=True) == root, "state-incompatible")
        result = []
        metadata = []
        pending = [(root, ".")]
        while pending:
            checkpoint(deadline)
            path, name = pending.pop()
            meta = path.lstat()
            require(meta.st_uid == os.geteuid() and not stat.S_ISLNK(meta.st_mode) and
                    (stat.S_ISREG(meta.st_mode) or stat.S_ISDIR(meta.st_mode) or
                     (name == "gateway.sock" and stat.S_ISSOCK(meta.st_mode))), "state-incompatible")
            require(not stat.S_ISREG(meta.st_mode) or meta.st_nlink == 1, "state-incompatible")
            if name == ".":
                require(stat.S_ISDIR(meta.st_mode) and stat.S_IMODE(meta.st_mode) == 0o700,
                        "state-incompatible")
            result.append((name, meta.st_dev, meta.st_ino))
            metadata.append((name, meta.st_mode, meta.st_uid, meta.st_gid, meta.st_nlink
                             if stat.S_ISREG(meta.st_mode) else None))
            require(len(result) + len(pending) <= self.policy.maximum_entries, "state-incompatible")
            if stat.S_ISDIR(meta.st_mode):
                with os.scandir(path) as entries:
                    for entry in entries:
                        checkpoint(deadline)
                        relative = entry.name if name == "." else name + "/" + entry.name
                        pending.append((path / entry.name, relative))
                        require(len(result) + len(pending) <= self.policy.maximum_entries,
                                "state-incompatible")
        checkpoint(deadline)
        return tuple(sorted(result)), canonical(sorted(metadata))

    @staticmethod
    def _artifact(item: ArtifactPin, deadline: float) -> tuple:
        scanned = scan_file(item.path, item.maximum_bytes, None, deadline, expected_size=item.byte_size)
        require(scanned.sha256 == item.sha256, "state-incompatible")
        return (item.name, str(item.path), scanned.identity, scanned.byte_size, scanned.sha256,
                scanned.mode, item.maximum_bytes)

    def inspect(self, installed: Installed, lease: object | None, deadline: float) -> Runtime:
        checkpoint(deadline)
        policy = self.policy
        before, metadata = self._identities(deadline)
        named = {name: (dev, ino) for name, dev, ino in before}
        require({".", "access.sqlite", "atlas.sqlite", "server.lock", "media", "media/blobs",
                 "media/staging", "logs", "logs/server.events.jsonl"} <= named.keys(), "state-incompatible")
        for name in ("server-state.rebind.pending", "server-state.receipt-compatibility.pending",
                     "server-state.receipt-compatibility.next"):
            require(name not in named, "state-incompatible")
        original, original_id = read_file(policy.original_config, 65536, 0o600, deadline)
        require(sha256(original) == policy.original_config_sha256, "state-incompatible")
        effective, _ = read_file(policy.effective_config, 65536, 0o600, deadline)
        old, selected = json_object(original, 65536), json_object(effective, 65536)
        require(old.get("dataDirectory") == selected.get("dataDirectory") == str(policy.data_directory) and
                selected.get("logDirectory") == str(policy.data_directory / "logs") and
                selected.get("frontendDirectory") == str(installed.frontend), "state-incompatible")
        old.pop("frontendDirectory", None)
        selected.pop("frontendDirectory", None)
        require(old == selected, "state-incompatible")
        artifact_paths = {str(item.path) for item in policy.artifacts}
        require(selected.get("tlsCertificate") in artifact_paths and
                selected.get("tlsPrivateKey") in artifact_paths, "state-incompatible")
        artifacts = []
        for item in policy.artifacts:
            artifacts.append(self._artifact(item, deadline))
        profile = policy.storage.atlas_profile
        require(profile in ("atlas", "full-geodata"), "state-incompatible")
        receipt_name = "server-state.json" if profile == "atlas" else "server-full-geodata-state.json"
        receipt, _ = read_file(policy.data_directory / receipt_name, 16384, 0o600, deadline)
        request = NativeInput(policy, installed, effective, original, receipt, before, lease, object())
        validated = self.validate_native(request, deadline)
        checkpoint(deadline)
        require(validated.nonce is request.nonce and validated.storage == policy.storage and
                validated.access_identity == named["access.sqlite"] and
                validated.atlas_identity == named["atlas.sqlite"] and
                digest(validated.configuration_digest), "state-incompatible")
        expected = {
            "format": "houseatlas-persistent-server/1" if profile == "atlas" else
                      "houseatlas-persistent-full-geodata-server/1",
            "configurationDigest": validated.configuration_digest,
            "accessSchema": policy.storage.access_schema, "atlasSchema": policy.storage.atlas_schema,
            "accessDevice": named["access.sqlite"][0], "accessInode": named["access.sqlite"][1],
            "atlasDevice": named["atlas.sqlite"][0], "atlasInode": named["atlas.sqlite"][1],
        }
        actual = json_object(receipt, 16384)
        require(actual == expected and all(type(actual[key]) is type(value) for key, value in expected.items()) and
                policy.storage.receipt_format == expected["format"] and
                policy.storage.config_digest_format == "houseatlas-server-state/2", "state-incompatible")
        receipts = []
        for name in sorted(named):
            if "/" not in name and (name.startswith("server-state") or name == receipt_name) and name.endswith(".json"):
                data, identity = read_file(policy.data_directory / name, 16384, 0o600, deadline)
                receipts.append((name, identity, data.hex()))
        # Repeat all selected byte/identity reads after the owner callback. It
        # must supply a coherent read snapshot and never mutate the native files.
        require(self._identities(deadline) == (before, metadata) and
                read_file(policy.original_config, 65536, 0o600, deadline) == (original, original_id) and
                read_file(policy.effective_config, 65536, 0o600, deadline)[0] == effective and
                read_file(policy.data_directory / receipt_name, 16384, 0o600, deadline)[0] == receipt,
                "state-incompatible")
        require([self._artifact(item, deadline) for item in policy.artifacts] == artifacts,
                "state-incompatible")
        for name, identity, encoded in receipts:
            data, current_id = read_file(policy.data_directory / name, 16384, 0o600, deadline)
            require(current_id == identity and data.hex() == encoded, "state-incompatible")
        checkpoint(deadline)
        invariant = canonical({"original": (str(policy.original_config), original_id, sha256(original)),
                               "effectivePath": str(policy.effective_config), "config": selected,
                               "arguments": policy.arguments, "artifacts": artifacts,
                               "nativeMetadata": metadata.hex()})
        return Runtime(policy.storage, invariant, before, canonical(receipts))
