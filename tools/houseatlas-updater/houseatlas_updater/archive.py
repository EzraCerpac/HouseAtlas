"""Extract only the admitted code closure; no archive helper or shell is run."""

import hashlib
import gzip
import io
import os
from pathlib import Path, PurePosixPath

from .model import Acquired, Bundle, Policy, UpdateError
from .validation import relative_path, require


def octal(field: bytes) -> int:
    value = field.rstrip(b"\x00 ").lstrip(b" ")
    require(bool(value) and all(48 <= byte <= 55 for byte in value), "archive-invalid")
    return int(value, 8)


def header_name(field: bytes) -> str:
    head, _, tail = field.partition(b"\x00")
    require(not tail.strip(b"\x00"), "archive-invalid")
    try:
        return head.decode("ascii")
    except UnicodeError:
        raise UpdateError("archive-invalid") from None


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def extract(acquired: Acquired, bundle: Bundle, stage: Path, policy: Policy) -> None:
    expected = {entry.path: entry for entry in bundle.files}
    seen: set[str] = set()
    folded: set[str] = set()
    allowed_directories = {parent.as_posix() for entry in bundle.files
                           for parent in PurePosixPath(entry.path).parents if str(parent) != "."}
    remaining = policy.max_payload_bytes + policy.max_manifest_bytes
    try:
        # Parse the strict ustar profile directly: general tar readers process
        # PAX/GNU extension bodies before yielding a member and can allocate an
        # unbounded decompressed extension. Each read here has a fixed bound.
        with gzip.GzipFile(fileobj=io.BytesIO(acquired.archive), mode="rb") as archive:
            count = 0
            while True:
                header = archive.read(512)
                require(len(header) == 512, "archive-invalid")
                if header == b"\x00" * 512:
                    require(archive.read(512) == b"\x00" * 512, "archive-invalid")
                    # Standard tar record padding only, bounded independently
                    # of compressed bytes; reaching EOF also verifies gzip CRC.
                    tail = archive.read(10241)
                    require(len(tail) <= 10240 and not tail.strip(b"\x00"), "archive-invalid")
                    break
                count += 1
                require(count <= policy.max_files * 4 + 1, "archive-invalid")
                require(header[257:265] == b"ustar\x0000" and
                        octal(header[148:156]) == sum(header[:148] + b" " * 8 + header[156:]),
                        "archive-invalid")
                kind = header[156:157]
                require(kind in (b"0", b"\x00", b"5") and
                        not header[157:257].strip(b"\x00"), "archive-invalid")
                name = header_name(header[:100])
                prefix = header_name(header[345:500])
                if prefix:
                    name = prefix + "/" + name
                name = relative_path(name.rstrip("/") if kind == b"5" else name)
                require(name.casefold() not in folded, "archive-invalid")
                size, mode = octal(header[124:136]), octal(header[100:108])
                folded.add(name.casefold())
                if kind == b"5":
                    require(name in allowed_directories and size == 0 and mode == 0o755,
                            "archive-invalid")
                    continue
                is_manifest = name == bundle.embedded_manifest
                require(name in expected or is_manifest, "archive-invalid")
                require(0 <= size <= remaining, "archive-invalid")
                spec = expected.get(name)
                expected_size = len(acquired.manifest) if is_manifest else spec.size
                expected_mode = 0o644 if is_manifest else spec.mode
                require(size == expected_size and mode == expected_mode, "archive-invalid")
                remaining -= size
                if is_manifest:
                    require(archive.read(size) == acquired.manifest, "manifest-invalid")
                    padding = (-size) % 512
                    require(archive.read(padding) == b"\x00" * padding, "archive-invalid")
                    seen.add(name)
                    continue
                target = stage.joinpath(*PurePosixPath(name).parts)
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                digest = hashlib.sha256()
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                     0o600)
                with os.fdopen(descriptor, "wb") as output:
                    left = size
                    while left:
                        block = archive.read(min(left, 65536))
                        require(bool(block), "archive-invalid")
                        output.write(block)
                        digest.update(block)
                        left -= len(block)
                    require(digest.hexdigest() == spec.sha256, "archive-invalid")
                    output.flush()
                    os.fchmod(output.fileno(), mode)
                    os.fsync(output.fileno())
                seen.add(name)
                padding = (-size) % 512
                require(archive.read(padding) == b"\x00" * padding, "archive-invalid")
    except (gzip.BadGzipFile, EOFError, ValueError):
        raise UpdateError("archive-invalid") from None
    closure = set(expected)
    if bundle.embedded_manifest is not None:
        closure.add(bundle.embedded_manifest)
    require(seen == closure, "archive-invalid")
    # Persist the externally digest-selected manifest outside payload paths;
    # publication receives exactly these admitted bytes, never a rewritten copy.
    with (stage / ".release-manifest.json").open("xb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(acquired.manifest)
        output.flush()
        os.fsync(output.fileno())
    for directory in sorted((p for p in stage.rglob("*") if p.is_dir()),
                            key=lambda p: len(p.parts), reverse=True):
        sync_directory(directory)
    sync_directory(stage)
