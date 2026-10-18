"""Producer-only frontend asset assembly before the existing pack/verify step.

All paths and release approvals are trusted producer-owner inputs. This helper
does not fetch, authenticate GitHub evidence, choose prior releases, modify an
installed frontend, or grant approval by matching self-declared manifest fields.
"""

import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tarfile
from dataclasses import asdict, dataclass

import bundle


HERE = Path(__file__).resolve().parent
BUNDLE_SHA256 = "b215dac5ef4ef37607d2883cfb38c82f94d7cab3f6007e96679902ae35a535c4"
SCHEMA_SHA256 = "421ce99daf71e45df1580cafcc1eb146be1561023059075825fc6b77b2700a0f"
MAX_PRIORS = 4
MAX_RECEIPT_BYTES = 262_144
CHUNK = 64 * 1024
REPOSITORY = "EzraCerpac/HouseAtlas"
WORKFLOW = ".github/workflows/release-bundle.yml"
REF = "refs/heads/main"


@dataclass(frozen=True)
class ApprovedProducer:
    """Already verified public release custody, supplied by its separate owner.

    evidence_sha256 pins that owner's public producer/approval evidence. Neither
    this type nor matching strings establishes its authenticity. The producer
    owner must verify real public repository/run/attempt/release/asset evidence
    before constructing it, and bind this receipt in the new build's approval.
    """
    repository: str
    commit: str
    tree: str
    workflow: str
    ref: str
    run_id: str
    run_attempt: int
    release_id: int
    asset_id: int
    archive_sha256: str
    evidence_sha256: str


@dataclass(frozen=True)
class PriorClosure:
    bundle_directory: Path
    expected_manifest_sha256: str
    expected_frontend_closure_sha256: str
    approved_producer: ApprovedProducer


@dataclass(frozen=True)
class UnionResult:
    frontend_directory: Path
    closure_sha256: str
    provenance_receipt: bytes  # Bounded public software provenance; no local paths.


def _pin(value, length=64):
    return type(value) is str and re.fullmatch(f"[0-9a-f]{{{length}}}", value) is not None


def _guard_packaging():
    bundle.need(Path(bundle.__file__).resolve() == HERE / "bundle.py" and
                bundle.file_digest(HERE / "bundle.py") == BUNDLE_SHA256 and
                bundle.file_digest(HERE / "bundle.schema.json") == SCHEMA_SHA256,
                "Reviewed packaging preimage differs")


def _identity(meta):
    return (meta.st_dev, meta.st_ino, meta.st_size, meta.st_mode, meta.st_uid,
            meta.st_gid, meta.st_nlink, meta.st_mtime_ns, meta.st_ctime_ns)


def _canonical_directory(path):
    bundle.need(isinstance(path, Path), "Owner path required")
    bundle.need(path.is_absolute() and path.resolve(strict=True) == path and path.is_dir(),
                "Canonical owner directory required")


def _file(path, maximum, *, consume=None):
    bundle.need(path.is_absolute() and path.resolve(strict=True) == path, "Canonical file required")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        bundle.need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                    0 < before.st_size <= maximum, "Bounded single-link regular file required")
        hasher, total = hashlib.sha256(), 0
        while total <= maximum:
            data = source.read(min(CHUNK, maximum + 1 - total))
            if not data:
                break
            total += len(data)
            bundle.need(total <= maximum, "File byte bound exceeded")
            hasher.update(data)
            if consume is not None:
                consume(data)
        after = os.fstat(source.fileno())
    bundle.need(total == before.st_size and
                _identity(before) == _identity(after) == _identity(path.lstat()),
                "File changed during bounded read")
    return total, hasher.hexdigest(), _identity(before)


def _scan_frontend(root):
    _canonical_directory(root)
    rows, identities, pending, entries = {}, {}, [root], 0
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as children:
            for child in children:
                entries += 1
                bundle.need(entries <= bundle.MAX_FILES * 4 + 3, "Frontend entry bound exceeded")
                path = directory / child.name
                mode = path.lstat().st_mode
                bundle.need(not stat.S_ISLNK(mode), "Frontend symlink unsupported")
                if stat.S_ISDIR(mode):
                    pending.append(path)
                    continue
                name = "frontend/" + path.relative_to(root).as_posix()
                bundle.need(bundle.safe_path(name) == "0644", "Frontend path required")
                size, pin, identity = _file(path, 4_000_000)
                rows[name] = {"path": name, "mode": "0644", "bytes": size, "sha256": pin}
                identities[name] = identity
                bundle.need(len(rows) <= bundle.MAX_FILES and
                            sum(row["bytes"] for row in rows.values()) <= bundle.MAX_UNPACKED,
                            "Frontend closure bound exceeded")
    bundle.need({"frontend/index.html", "frontend/saved/index.html", "frontend/saved/service-worker.js"}
                <= rows.keys(), "Current frontend entries missing")
    return rows, identities


def _paths(rows):
    # Case folding covers every prefix, including differently cased directories;
    # an exact path may be deduplicated only after its complete row agrees.
    prefixes, files = {}, set(rows)
    for name in rows:
        pieces = name.split("/")
        for index in range(1, len(pieces) + 1):
            prefix = "/".join(pieces[:index])
            key = prefix.casefold()
            bundle.need(key not in prefixes or prefixes[key] == prefix, "Case-colliding frontend paths")
            prefixes[key] = prefix
            bundle.need(index == len(pieces) or prefix not in files, "Frontend file/directory collision")


def _current(metadata):
    bundle.need(type(metadata) is dict and {"version", "source", "build"} <= metadata.keys(),
                "Current producer metadata required")
    schema = json.loads((HERE / "bundle.schema.json").read_bytes())
    for field in ("version", "source", "build"):
        bundle.validate(metadata[field], schema["properties"][field], "current." + field)
    bundle.need(metadata["build"]["kind"] == "github-actions" and
                metadata["source"]["commit"] == metadata["build"]["workflowCommit"],
                "Current build source differs")
    # JSON roundtrip makes a private immutable snapshot of public fields only.
    return json.loads(bundle.canonical({field: metadata[field] for field in ("version", "source", "build")}))


def _prior(selected):
    bundle.need(type(selected) is PriorClosure and _pin(selected.expected_manifest_sha256) and
                _pin(selected.expected_frontend_closure_sha256) and
                type(selected.approved_producer) is ApprovedProducer, "Exact owner-approved prior required")
    _canonical_directory(selected.bundle_directory)
    approved = selected.approved_producer
    bundle.need((approved.repository, approved.workflow, approved.ref) == (REPOSITORY, WORKFLOW, REF) and
                _pin(approved.commit, 40) and _pin(approved.tree, 40) and
                type(approved.run_id) is str and re.fullmatch(r"[1-9][0-9]{0,19}", approved.run_id) and
                type(approved.run_attempt) is int and 1 <= approved.run_attempt <= 1000 and
                all(type(value) is int and 0 < value <= 2**53 - 1
                    for value in (approved.release_id, approved.asset_id)) and
                _pin(approved.archive_sha256) and _pin(approved.evidence_sha256),
                "Prior producer evidence pins differ")
    # The existing verifier owns canonical schema/archive/checksum closure. This
    # is required in addition to the external owner's producer authentication.
    manifest = bundle.verify_bundle(selected.bundle_directory, selected.expected_manifest_sha256)
    source, build = manifest["source"], manifest["build"]
    bundle.need(source == {"repository": approved.repository, "commit": approved.commit, "tree": approved.tree} and
                build["kind"] == "github-actions" and build["workflow"] == approved.workflow and
                build["ref"] == approved.ref and build["workflowCommit"] == approved.commit and
                build["runId"] == approved.run_id and build["runAttempt"] == approved.run_attempt and
                manifest["archive"]["sha256"] == approved.archive_sha256 and
                manifest["components"]["frontend"]["action"] == "replace" and
                manifest["frontend"]["closureSha256"] == selected.expected_frontend_closure_sha256,
                "Prior approved identity or frontend closure differs")
    archive = selected.bundle_directory / manifest["archive"]["name"]
    _, archive_pin, archive_identity = _file(archive, bundle.MAX_ARCHIVE)
    bundle.need(archive_pin == approved.archive_sha256, "Prior archive changed")
    assets = [row for row in manifest["files"] if row["path"].startswith("frontend/assets/")]
    return manifest, assets, archive_identity


def _destination_file(root, name):
    relative = name.removeprefix("frontend/")
    path = root / relative
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    return os.fdopen(descriptor, "wb")


def _copy_prior(selected, manifest, archive_identity, wanted, destination):
    archive = selected.bundle_directory / manifest["archive"]["name"]
    bundle.need(_identity(archive.lstat()) == archive_identity, "Prior archive changed before assembly")
    limit = manifest["archive"]["unpackedBytes"] + 2048 * (len(manifest["files"]) + 20)
    consumed = 0
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as raw, gzip.GzipFile(fileobj=raw, mode="rb") as stream:
        bundle.need(_identity(os.fstat(raw.fileno())) == archive_identity,
                    "Prior archive descriptor changed")
        for row in manifest["files"]:
            expected = tarfile.TarInfo(row["path"])
            expected.size, expected.mode, expected.mtime = row["bytes"], int(row["mode"], 8), 0
            expected.uid = expected.gid = 0
            bundle.need(stream.read(512) == expected.tobuf(format=tarfile.USTAR_FORMAT),
                        "Prior canonical archive header changed")
            consumed += 512
            output = _destination_file(destination, row["path"]) if row["path"] in wanted else None
            try:
                left, hasher = row["bytes"], hashlib.sha256()
                while left:
                    data = stream.read(min(CHUNK, left))
                    bundle.need(bool(data), "Prior archive body incomplete")
                    left -= len(data)
                    consumed += len(data)
                    hasher.update(data)
                    if output is not None:
                        output.write(data)
                bundle.need(hasher.hexdigest() == row["sha256"], "Prior archive member changed")
                if output is not None:
                    output.flush()
                    os.fchmod(output.fileno(), 0o644)
                    os.fsync(output.fileno())
            finally:
                if output is not None:
                    output.close()
            padding = (-row["bytes"]) % 512
            bundle.need(stream.read(padding) == bytes(padding), "Prior tar padding changed")
            consumed += padding
        bundle.need(consumed <= limit, "Prior expanded archive bound exceeded")
        trailer = stream.read(limit - consumed + 1)
        bundle.need(1024 <= len(trailer) <= limit - consumed and not any(trailer) and stream.read(1) == b"",
                    "Prior archive trailer changed")
        bundle.need(_identity(os.fstat(raw.fileno())) == archive_identity,
                    "Prior archive descriptor changed during assembly")
    bundle.need(_identity(archive.lstat()) == archive_identity, "Prior archive changed during assembly")


def assemble_frontend(new_frontend: Path, priors: tuple[PriorClosure, ...], destination: Path,
                      *, current_metadata: dict) -> UnionResult:
    """Create a new frontend from current files plus ALL approved prior assets/**.

    All ownership/provenance inputs are trusted producer-side configuration.
    The helper mechanically checks their byte/identity agreement, not external
    authenticity or stale-client/backend compatibility. Record the returned
    receipt in the trusted new producer approval/run evidence before pack/promote.
    """
    _guard_packaging()
    bundle.need(type(priors) is tuple and 0 < len(priors) <= MAX_PRIORS, "Bounded explicit prior tuple required")
    current = _current(current_metadata)
    new_rows, new_identities = _scan_frontend(new_frontend)
    rows = dict(new_rows)
    prepared = []
    for selected in priors:
        manifest, assets, archive_identity = _prior(selected)
        wanted = set()
        for row in assets:
            name = row["path"]
            if name in rows:
                bundle.need(rows[name] == row, "Overlapping asset path differs in size/hash/mode")
            else:
                rows[name] = row
                wanted.add(name)
        prepared.append((selected, manifest, assets, archive_identity, wanted))
    bundle.need(len({selected.expected_manifest_sha256 for selected in priors}) == len(priors),
                "Prior closure inputs must be distinct")
    _paths(rows)
    bundle.need(len(rows) <= bundle.MAX_FILES and
                sum(row["bytes"] for row in rows.values()) <= bundle.MAX_UNPACKED, "Union closure bound exceeded")
    ordered = sorted(rows.values(), key=lambda row: row["path"])
    union_pin = bundle.closure(ordered)
    current["frontendClosureSha256"] = bundle.closure(sorted(new_rows.values(), key=lambda row: row["path"]))
    receipt = bundle.canonical({
        "format": "houseatlas.frontend-asset-retention.v1",
        "packaging": {"bundleSha256": BUNDLE_SHA256, "schemaSha256": SCHEMA_SHA256},
        "currentEntrypoints": current,
        "priorInputs": [{"version": manifest["version"], "source": manifest["source"], "build": manifest["build"],
                         "manifestSha256": selected.expected_manifest_sha256,
                         "frontendClosureSha256": selected.expected_frontend_closure_sha256,
                         "approvedProducer": asdict(selected.approved_producer), "retainedAssets": assets}
                        for selected, manifest, assets, _, _ in prepared],
        "union": {"closureSha256": union_pin, "fileCount": len(rows),
                  "bytes": sum(row["bytes"] for row in rows.values())},
        "producerAuthentication": "required-external-owner-evidence-not-established-by-assembler",
        "activeCompatibility": "current-entrypoints-with-explicit-prior-assets-owner-review-required",
    })
    bundle.need(len(receipt) <= MAX_RECEIPT_BYTES, "Provenance receipt bound exceeded")
    bundle.need(isinstance(destination, Path) and destination.is_absolute() and
                destination.parent.resolve(strict=True) == destination.parent and
                not destination.exists() and not destination.is_symlink() and
                destination != new_frontend and new_frontend not in destination.parents,
                "Canonical create-only union destination required")
    bundle.need(all(selected.bundle_directory != destination and
                    selected.bundle_directory not in destination.parents for selected in priors),
                "Union destination must be outside prior bundles")
    destination.mkdir(mode=0o700)
    for name, row in sorted(new_rows.items()):
        source = new_frontend / name.removeprefix("frontend/")
        with _destination_file(destination, name) as output:
            size, pin, identity = _file(source, 4_000_000, consume=output.write)
            bundle.need((size, pin, identity) == (row["bytes"], row["sha256"], new_identities[name]),
                        "Current frontend changed during assembly")
            output.flush()
            os.fchmod(output.fileno(), 0o644)
            os.fsync(output.fileno())
    for selected, manifest, _, archive_identity, wanted in prepared:
        _copy_prior(selected, manifest, archive_identity, wanted, destination)
        bundle.verify_bundle(selected.bundle_directory, selected.expected_manifest_sha256)
    actual, _ = _scan_frontend(destination)
    bundle.need(actual == rows and _scan_frontend(new_frontend) == (new_rows, new_identities),
                "Assembled or current closure changed")
    return UnionResult(destination, union_pin, receipt)
