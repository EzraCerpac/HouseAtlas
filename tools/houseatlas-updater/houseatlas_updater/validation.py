"""Bounded closed caller protocol and normalized bundle checks (stdlib only)."""

import hashlib
import json
import re
import stat
import uuid
from pathlib import Path, PurePosixPath

from .model import Bundle, Installed, Policy, Runtime, Selection, UpdateError


def require(condition: bool, code: str) -> None:
    if not condition:
        raise UpdateError(code)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def json_object(data: bytes, limit: int) -> dict:
    require(type(data) is bytes and len(data) <= limit, "invalid-request")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "invalid-request")
            result[key] = value
        return result

    try:
        result = json.loads(data, object_pairs_hook=unique, parse_constant=lambda _: None)
    except (ValueError, UnicodeError, RecursionError):
        raise UpdateError("invalid-request") from None
    require(type(result) is dict, "invalid-request")
    return result


def digest(value: object, length: int = 64) -> bool:
    return type(value) is str and re.fullmatch(f"[0-9a-f]{{{length}}}", value) is not None


def operation_id(value: object) -> str:
    require(type(value) is str, "invalid-request")
    try:
        require(str(uuid.UUID(value)) == value, "invalid-request")
    except ValueError:
        raise UpdateError("invalid-request") from None
    return value


def selection(value: dict) -> Selection:
    require(type(value) is dict and set(value) == {
        "version", "commit", "tree", "releaseId", "assetId", "assetName",
        "archiveSha256", "manifestSha256",
    }, "invalid-request")
    require(type(value["version"]) is str and re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", value["version"]
    ) is not None and len(value["version"]) <= 80, "invalid-request")
    for name in ("commit", "tree"):
        require(digest(value[name], 40), "invalid-request")
    for name in ("archiveSha256", "manifestSha256"):
        require(digest(value[name]), "invalid-request")
    for name in ("releaseId", "assetId"):
        require(type(value[name]) is int and 0 < value[name] <= 2**53 - 1, "invalid-request")
    require(type(value["assetName"]) is str and re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", value["assetName"]
    ) is not None, "invalid-request")
    return Selection(value["version"], value["commit"], value["tree"],
                     value["releaseId"], value["assetId"], value["assetName"],
                     value["archiveSha256"], value["manifestSha256"])


def public_selection(value: Selection) -> dict:
    return {
        "version": value.version, "commit": value.commit, "tree": value.tree,
        "releaseId": value.release_id, "assetId": value.asset_id,
        "assetName": value.asset_name, "archiveSha256": value.archive_sha256,
        "manifestSha256": value.manifest_sha256,
    }


def public_installed(value: Installed) -> dict:
    return {"revision": value.revision, "release": public_selection(value.selection),
            "frontendIdentity": value.frontend_identity, "frontendShellIdentity": value.shell_identity}


def request(data: bytes) -> tuple[dict, Selection]:
    result = json_object(data, 4096)
    require(set(result) == {"format", "operationId", "expectedInstalledRevision", "release"},
            "invalid-request")
    require(result["format"] in ("houseatlas.updater.check.v1", "houseatlas.updater.apply.v1"),
            "invalid-request")
    operation_id(result["operationId"])
    require(digest(result["expectedInstalledRevision"]), "invalid-request")
    return result, selection(result["release"])


def relative_path(value: object) -> str:
    require(type(value) is str and 0 < len(value) <= 240 and
            re.fullmatch(r"[A-Za-z0-9._/-]+", value) is not None,
            "archive-invalid")
    path = PurePosixPath(value)
    require(not path.is_absolute() and str(path) == value and
            all(part not in ("", ".", "..") for part in value.split("/")), "archive-invalid")
    return value


def os_version(value: str) -> tuple[int, int, int]:
    require(type(value) is str and re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}", value)
            is not None, "platform-incompatible")
    parts = tuple(int(part) for part in value.split("."))
    return parts + (0,) * (3 - len(parts))


def private_directory(path: Path) -> None:
    require(path.is_absolute() and path.resolve(strict=True) == path, "layout-invalid")
    meta = path.stat()
    import os
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == os.geteuid()
            and stat.S_IMODE(meta.st_mode) == 0o700, "layout-invalid")


def overlaps(a: Path, b: Path) -> bool:
    return a == b or a in b.parents or b in a.parents


def layout(policy: Policy) -> None:
    for path in (policy.staging_parent, policy.publication_root, policy.journal_directory):
        private_directory(path)
    require(policy.staging_parent.stat().st_dev == policy.publication_root.stat().st_dev,
            "layout-invalid")
    require(not overlaps(policy.journal_directory, policy.staging_parent) and
            not overlaps(policy.journal_directory, policy.publication_root), "layout-invalid")
    for protected in policy.protected_roots:
        require(protected.is_absolute() and protected.resolve(strict=True) == protected,
                "layout-invalid")
        for path in (policy.staging_parent, policy.publication_root, policy.journal_directory):
            require(not overlaps(path, protected), "layout-invalid")
    require(policy.target in ("x86_64-apple-darwin", "aarch64-apple-darwin"),
            "platform-incompatible")
    os_version(policy.os_version)
    require(1 <= policy.health_timeout_seconds <= 120 and
            1 <= policy.max_files <= 8192 and
            1 <= policy.max_archive_bytes <= 512 * 1024 * 1024 and
            1 <= policy.max_payload_bytes <= 1024 * 1024 * 1024 and
            1 <= policy.max_manifest_bytes <= 1024 * 1024, "layout-invalid")
    relative_path(policy.backend_entry)
    relative_path(policy.frontend_root)
    relative_path(policy.license_root)
    require(not policy.backend_entry.startswith(policy.frontend_root + "/"), "layout-invalid")


def runtime(value: Runtime) -> None:
    require(not value.pending_transition and bool(value.configuration) and
            bool(value.receipt_identity) and bool(value.native_identities), "state-incompatible")
    names = [name for name, _, _ in value.native_identities]
    require(len(names) == len(set(names)) and
            all(type(dev) is int and type(ino) is int and dev >= 0 and ino > 0
                for _, dev, ino in value.native_identities), "state-incompatible")


def installed(value: Installed, policy: Policy) -> None:
    require(digest(value.revision) and digest(value.frontend_identity), "installed-invalid")
    require(value.target == policy.target, "platform-incompatible")
    require(value.shell_identity is None or digest(value.shell_identity), "installed-invalid")
    selection(public_selection(value.selection))
    require({part.name for part in value.components} == {"backend", "frontend"} and
            len(value.components) == 2 and all(digest(part.identity) for part in value.components),
            "installed-invalid")
    require(value.binary.is_absolute() and value.binary.resolve(strict=True) == value.binary
            and value.binary.is_file() and value.frontend.is_absolute() and
            value.frontend.resolve(strict=True) == value.frontend and value.frontend.is_dir(),
            "installed-invalid")
    for path in (value.binary, value.frontend):
        require(policy.publication_root in path.parents, "installed-invalid")
    require(value.release_directory.is_absolute() and
            value.release_directory.resolve(strict=True) == value.release_directory and
            value.release_directory.is_dir() and policy.publication_root in value.release_directory.parents,
            "installed-invalid")


def bundle(value: Bundle, expected: Selection, before: Installed,
           state: Runtime, policy: Policy) -> None:
    require(value.contract == policy.bundle_contract and value.contract in
            ("provisional-fixture", "houseatlas.release-bundle.v1"), "manifest-invalid")
    require(value.selection == expected, "release-identity-mismatch")
    require(value.target == policy.target and
            os_version(value.minimum_os) <= os_version(policy.os_version) and
            set(value.required_abi) <= set(policy.available_abi), "platform-incompatible")
    runtime(state)
    require(value.storage == state.storage == before.storage and value.migration == "none",
            "state-incompatible")
    require(digest(value.frontend_identity), "manifest-invalid")
    require(value.shell_identity is None or digest(value.shell_identity), "manifest-invalid")
    require(len(value.components) == 2 and
            {part.name for part in value.components} == {"backend", "frontend"}, "manifest-invalid")
    old = {part.name: part.identity for part in before.components}
    for part in value.components:
        require(part.action in ("replace", "retain") and digest(part.identity), "manifest-invalid")
        if part.required_installed is not None:
            require(digest(part.required_installed) and part.required_installed == old[part.name],
                    "component-incompatible")
        if part.action == "retain":
            require(part.identity == old[part.name], "component-incompatible")
            if part.name == "frontend":
                require(value.frontend_identity == before.frontend_identity and
                        value.shell_identity == before.shell_identity, "component-incompatible")
    require(0 < len(value.files) <= policy.max_files, "manifest-invalid")
    paths = set()
    folded = set()
    prefixes = {}
    total = 0
    components = {part.name: part for part in value.components}
    for entry in value.files:
        path = relative_path(entry.path)
        require(path not in paths and path.casefold() not in folded, "manifest-invalid")
        require(digest(entry.sha256) and type(entry.size) is int and entry.size >= 0,
                "manifest-invalid")
        is_backend = path == policy.backend_entry
        is_frontend = path.startswith(policy.frontend_root + "/")
        is_license = path.startswith(policy.license_root + "/") and path.endswith(".txt")
        require(is_backend or is_frontend or is_license, "manifest-invalid")
        component = "backend" if is_backend else "frontend"
        require((is_license or components[component].action == "replace") and
                entry.mode == (0o755 if is_backend else 0o644), "manifest-invalid")
        paths.add(path)
        folded.add(path.casefold())
        for prefix in (PurePosixPath(path), *PurePosixPath(path).parents):
            text = prefix.as_posix()
            require(prefixes.get(text.casefold(), text) == text, "manifest-invalid")
            prefixes[text.casefold()] = text
        total += entry.size
    require(total <= policy.max_payload_bytes, "manifest-invalid")
    require(all(not any(parent.as_posix() in paths for parent in PurePosixPath(path).parents)
                for path in paths), "manifest-invalid")
    if components["backend"].action == "replace":
        require(policy.backend_entry in paths, "manifest-invalid")
    if components["frontend"].action == "replace":
        require(policy.frontend_root + "/index.html" in paths, "manifest-invalid")
    if value.embedded_manifest is not None:
        require(value.embedded_manifest in policy.manifest_names and
                value.embedded_manifest not in paths, "manifest-invalid")


def compatible(old: Runtime, current: Runtime) -> bool:
    # Conservative unchanged profile/receipt/config/native identities only.
    return not current.pending_transition and old == current
