"""Deterministic, bounded software bundles. Verification never extracts or executes.

The schema is a local trusted input. Manifest hashes prove bytes, not producer
authorization; callers must separately verify the GitHub run and approval pin.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

HERE = Path(__file__).resolve().parent
MAX_MANIFEST = 262_144
MAX_ARCHIVE = 268_435_456
MAX_UNPACKED = 536_870_912
MAX_FILES = 512
FRONTEND_EXTENSIONS = {"html", "js", "css", "woff2", "webmanifest", "png"}
PRESERVED = ["updater", "configuration", "database", "access-state", "media", "models", "saved-copies"]


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode()


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "Duplicate JSON key")
        value[key] = item
    return value


def read_json(path):
    need(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_MANIFEST,
         "JSON must be a bounded regular file")
    return json.loads(path.read_bytes(), object_pairs_hook=_pairs,
                      parse_constant=lambda _: need(False, "Non-finite JSON number"))


def validate(value, schema=None, location="manifest"):
    """Interpret only the keywords used by our pinned, closed JSON Schema.

    This is deliberately not a general-purpose JSON Schema implementation.
    Consumers may instead use an existing draft-2020-12 validator plus the
    cross-field and archive checks in validate_manifest/verify_bundle.
    """
    root = json.loads((HERE / "bundle.schema.json").read_bytes())

    def check(item, rule, at):
        if "$ref" in rule:
            check(item, root["$defs"][rule["$ref"].removeprefix("#/$defs/")], at)
            return
        if "const" in rule:
            need(type(item) is type(rule["const"]) and item == rule["const"], at + ": const")
            return
        if "enum" in rule:
            need(any(type(item) is type(x) and item == x for x in rule["enum"]), at + ": enum")
            return
        if "type" in rule:
            types = rule["type"] if isinstance(rule["type"], list) else [rule["type"]]
            matches = {"object": type(item) is dict, "array": type(item) is list,
                       "integer": type(item) is int, "boolean": type(item) is bool,
                       "string": type(item) is str, "null": item is None}
            need(any(matches[t] for t in types), at + ": type")
        if type(item) is dict:
            need(set(rule.get("required", [])) <= item.keys(), at + ": required")
            if rule.get("additionalProperties") is False:
                need(item.keys() <= rule["properties"].keys(), at + ": unknown property")
            for key, sub in item.items():
                check(sub, rule["properties"][key], at + "." + key)
        elif type(item) is list:
            need(rule.get("minItems", 0) <= len(item) <= rule.get("maxItems", MAX_FILES), at + ": count")
            if rule.get("uniqueItems"):
                need(len({canonical(x) for x in item}) == len(item), at + ": uniqueness")
            for index, sub in enumerate(item):
                check(sub, rule["items"], f"{at}[{index}]")
        elif type(item) is str:
            need(len(item) <= rule.get("maxLength", 1024), at + ": length")
            if "pattern" in rule:
                need(re.fullmatch(rule["pattern"], item, flags=re.ASCII) is not None, at + ": pattern")
        elif type(item) is int:
            need(rule.get("minimum", item) <= item <= rule.get("maximum", item), at + ": range")
    check(value, root if schema is None else schema, location)


def safe_path(name):
    need(type(name) is str and len(name) <= 180 and re.fullmatch(r"[A-Za-z0-9._/-]+", name), "Unsafe payload path")
    need(not name.startswith("/") and all(part not in ("", ".", "..") and not part.startswith(".")
                                        for part in name.split("/")), "Unsafe payload component")
    # The overall schema length does not guarantee a representable USTAR
    # prefix/name split. Use the selected encoder here so both producer scans
    # and manifest validation reject unencodable paths before output creation.
    try:
        tarfile.TarInfo(name).tobuf(format=tarfile.USTAR_FORMAT, encoding="ascii", errors="strict")
    except ValueError as error:
        raise ValueError("Payload path cannot be encoded as USTAR") from error
    path = PurePosixPath(name)
    if name == "bin/houseatlas":
        return "0755"
    if name.startswith("frontend/"):
        need(path.suffix[1:] in FRONTEND_EXTENSIONS, "Unsupported frontend payload")
        return "0644"
    need(name.startswith("licenses/") and path.suffix == ".txt", "Only software and license payloads are permitted")
    return "0644"


def closure(rows):
    return digest("".join(f"{r['path']}\t{r['mode']}\t{r['bytes']}\t{r['sha256']}\n" for r in rows).encode())


def check_compatibility(value):
    if value["status"] == "reviewed":
        need(value["requiredStorageContractSha256"] is not None and
             value["resultingStorageContractSha256"] is not None, "Reviewed storage contracts must be pinned")
    else:
        need(value["requiredStorageContractSha256"] is None and
             value["resultingStorageContractSha256"] is None and not value["codeRollbackCompatible"],
             "Unqualified storage must not claim compatibility")
    if value["codeRollbackCompatible"]:
        need(value["requiredStorageContractSha256"] == value["resultingStorageContractSha256"],
             "Code rollback requires unchanged declared storage contract")


def validate_manifest(manifest):
    validate(manifest)
    need(manifest["schemaSha256"] == file_digest(HERE / "bundle.schema.json"), "Schema pin differs")
    need(manifest["source"]["commit"] == manifest["build"]["workflowCommit"], "Workflow/source commit differs")
    need(manifest["archive"]["name"] == f"houseatlas-{manifest['version']}-x86_64-apple-darwin.tar.gz", "Archive identity differs")
    rows = manifest["files"]
    names = [row["path"] for row in rows]
    need(names == sorted(set(names)), "File closure must be sorted and unique")
    for row in rows:
        need(row["mode"] == safe_path(row["path"]), "Payload mode differs")
        if row["path"].startswith("frontend/"):
            need(row["bytes"] <= 4_000_000, "Backend frontend size bound")
    need(sum(row["bytes"] for row in rows) == manifest["archive"]["unpackedBytes"], "Unpacked bound differs")
    need(manifest["archive"]["unpackedBytes"] <= MAX_UNPACKED, "Unpacked bound exceeded")
    front = [row for row in rows if row["path"].startswith("frontend/")]
    backend = [row for row in rows if row["path"] == "bin/houseatlas"]
    components = manifest["components"]
    need(any(name.startswith("licenses/") for name in names), "Software license closure missing")
    for component, identity, payload in [("backend", backend[0]["sha256"] if backend else None, backend),
                                         ("frontend", closure(front) if front else None, front)]:
        policy = components[component]
        if policy["action"] == "replace":
            need(bool(payload) and policy["identitySha256"] == identity, "Replacement identity differs")
        else:
            need(not payload and policy["requiredInstalledSha256"] == policy["identitySha256"],
                 "Retained component needs exact installed identity and no replacement files")
    need(components["frontend"]["identitySha256"] == manifest["frontend"]["closureSha256"], "Frontend identity differs")
    if front:
        need({"frontend/index.html", "frontend/saved/index.html", "frontend/saved/service-worker.js"} <= set(names),
             "Required frontend entries missing")
    check_compatibility(manifest["compatibility"])
    return manifest


def shell_identity(index, worker):
    marks = re.findall(rb'<meta name="houseatlas-saved-shell-build" content="([0-9a-f]{64})">', index)
    builds = re.findall(rb'^const BUILD="([0-9a-f]{64})", TABLE=', worker)
    need(len(marks) == len(builds) == 1 and marks == builds, "Saved shell identities differ")
    return marks[0].decode()


def payload_rows(payload):
    need(payload.is_dir() and not payload.is_symlink(), "Payload root must be a regular directory")
    rows = []
    for directory, dirs, files in os.walk(payload, followlinks=False):
        need(not any((Path(directory) / name).is_symlink() for name in dirs), "Payload symlink directory")
        for name in files:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            need(stat.S_ISREG(mode) and not stat.S_ISLNK(mode), "Payload must contain regular files only")
            relative = path.relative_to(payload).as_posix()
            expected_mode = safe_path(relative)
            size = path.stat().st_size
            need(0 < size <= (4_000_000 if relative.startswith("frontend/") else MAX_ARCHIVE), "Payload file bound")
            rows.append({"path": relative, "mode": expected_mode, "bytes": size, "sha256": file_digest(path)})
            need(len(rows) <= MAX_FILES and sum(row["bytes"] for row in rows) <= MAX_UNPACKED, "Payload bound")
    return sorted(rows, key=lambda row: row["path"])


def pack(payload, metadata, output):
    """Pack an already built software-only payload. No build or runtime hooks."""
    need(not output.exists() and not output.is_symlink(), "Output must be create-only")
    rows = payload_rows(payload)
    manifest = dict(metadata)
    manifest.update(format="houseatlas.release-bundle.v1", schemaSha256=file_digest(HERE / "bundle.schema.json"),
                    files=rows, preservedComponents=PRESERVED, runtimeQualification="not-established")
    frontend = [row for row in rows if row["path"].startswith("frontend/")]
    binary = next(row for row in rows if row["path"] == "bin/houseatlas")
    manifest["frontend"] = {"shellBuildSha256": shell_identity((payload / "frontend/saved/index.html").read_bytes(),
                                                                 (payload / "frontend/saved/service-worker.js").read_bytes()),
                            "closureSha256": closure(frontend)}
    manifest["components"] = {"backend": {"action": "replace", "identitySha256": binary["sha256"], "requiredInstalledSha256": None},
                              "frontend": {"action": "replace", "identitySha256": closure(frontend), "requiredInstalledSha256": None}}
    archive_name = f"houseatlas-{manifest['version']}-x86_64-apple-darwin.tar.gz"
    # Validate metadata and all cross-fields before writing; final archive digest
    # replaces these well-formed placeholders once compression has finished.
    manifest["archive"] = {"name": archive_name, "format": "ustar+gzip", "bytes": 1,
                           "unpackedBytes": sum(row["bytes"] for row in rows), "sha256": "0" * 64}
    validate_manifest(manifest)
    output.mkdir(mode=0o700)
    archive = output / archive_name
    with archive.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as tar:
                for row in rows:
                    info = tarfile.TarInfo(row["path"])
                    info.size, info.mode, info.mtime = row["bytes"], int(row["mode"], 8), 0
                    info.uid = info.gid = 0
                    with (payload / row["path"]).open("rb") as stream:
                        tar.addfile(info, stream)
    need(archive.stat().st_size <= MAX_ARCHIVE, "Compressed archive bound")
    manifest["archive"].update(bytes=archive.stat().st_size, sha256=file_digest(archive))
    validate_manifest(manifest)
    manifest_bytes = canonical(manifest)
    need(len(manifest_bytes) <= MAX_MANIFEST, "Manifest bound")
    (output / "manifest.json").write_bytes(manifest_bytes)
    (output / "SHA256SUMS").write_text(f"{file_digest(archive)}  {archive_name}\n{digest(manifest_bytes)}  manifest.json\n")
    verify_bundle(output, digest(manifest_bytes))
    return manifest


def verify_bundle(directory, expected_manifest_sha256):
    """Check exact closure without extracting. Expected digest must come from approval.

    Producer authorization and current installed compatibility are intentionally
    separate checks, performed by the controller before any activation.
    """
    need(re.fullmatch(r"[0-9a-f]{64}", expected_manifest_sha256) is not None, "Expected manifest SHA256 required")
    need(directory.is_dir() and not directory.is_symlink(), "Bundle directory must be regular")
    path = directory / "manifest.json"
    manifest = read_json(path)
    need(file_digest(path) == expected_manifest_sha256, "Manifest approval digest differs")
    need(path.read_bytes() == canonical(manifest), "Manifest must use canonical serialization")
    validate_manifest(manifest)
    archive = directory / manifest["archive"]["name"]
    need({p.name for p in directory.iterdir()} == {archive.name, "manifest.json", "SHA256SUMS"}, "Release asset closure differs")
    need(all(p.is_file() and not p.is_symlink() for p in directory.iterdir()), "Release assets must be regular files")
    need(archive.stat().st_size == manifest["archive"]["bytes"] and file_digest(archive) == manifest["archive"]["sha256"], "Archive pin differs")
    checksums = directory / "SHA256SUMS"
    expected_sums = f"{manifest['archive']['sha256']}  {archive.name}\n{expected_manifest_sha256}  manifest.json\n"
    need(checksums.stat().st_size <= 1024 and checksums.read_text() == expected_sums, "Checksum closure differs")
    front_entries = {}
    # Read an explicitly bounded decompressed stream. No tar extraction and no
    # gzip expansion beyond the file bytes plus bounded USTAR header/padding.
    limit = manifest["archive"]["unpackedBytes"] + 2048 * (len(manifest["files"]) + 20)
    with gzip.open(archive, "rb") as stream:
        raw = stream.read(limit + 1)
        need(len(raw) <= limit and stream.read(1) == b"", "Expanded tar bound exceeded")
    offset = 0
    for row in manifest["files"]:
        # Compare the complete canonical USTAR header before reading a body.
        # There is no permissive tar parser on the untrusted input path: PAX,
        # GNU names, links, directories and extra metadata cannot be adopted.
        expected = tarfile.TarInfo(row["path"])
        expected.size, expected.mode, expected.mtime = row["bytes"], int(row["mode"], 8), 0
        expected.uid = expected.gid = 0
        need(raw[offset:offset + 512] == expected.tobuf(format=tarfile.USTAR_FORMAT), "Archive header/closure differs")
        offset += 512
        data = raw[offset:offset + row["bytes"]]
        need(len(data) == row["bytes"] and digest(data) == row["sha256"], "Archive file pin differs")
        if row["path"] in ("frontend/saved/index.html", "frontend/saved/service-worker.js"):
            front_entries[row["path"]] = data
        padding = (-row["bytes"]) % 512
        offset += row["bytes"]
        need(raw[offset:offset + padding] == bytes(padding), "Nonzero tar padding")
        offset += padding
    need(len(raw) - offset >= 1024 and all(byte == 0 for byte in raw[offset:]), "Tar trailer/closure differs")
    if front_entries:
        need(shell_identity(front_entries["frontend/saved/index.html"], front_entries["frontend/saved/service-worker.js"]) ==
             manifest["frontend"]["shellBuildSha256"], "Frontend shell pin differs")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    package = commands.add_parser("pack")
    package.add_argument("--payload", type=Path, required=True)
    package.add_argument("--metadata", type=Path, required=True)
    package.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle", type=Path, required=True)
    verify.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    if args.command == "pack":
        result = pack(args.payload, read_json(args.metadata), args.output)
    else:
        result = verify_bundle(args.bundle, args.manifest_sha256)
    print(f"Verified software bundle {result['version']}: {len(result['files'])} files; runtime qualification not established")


if __name__ == "__main__":
    main()
