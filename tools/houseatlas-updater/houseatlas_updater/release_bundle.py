"""Consumer of the exact packaging-owner schema; no production runtime adapter.

Schema pin ACK: packaging commit 6be0a4d9fe16859794ffe3587e6ad8ddb6080bc2.
Native-profile and storage-contract mappings remain owner-reviewed inputs.
"""

import json
import re
from pathlib import Path

from .model import Bundle, Component, FileSpec, Policy, Storage
from .validation import canonical, digest, json_object, require, sha256


SCHEMA_SHA256 = "421ce99daf71e45df1580cafcc1eb146be1561023059075825fc6b77b2700a0f"
FIXTURE_SHA256 = "8073e8a088c9976e50659bd7828881d4898da81a47f6e5b8777320de3b193635"


def validate_schema(value, schema):
    """Only the keywords in the pinned packaging schema; no refs/network fetch."""
    if "const" in schema:
        require(type(value) is type(schema["const"]) and value == schema["const"], "manifest-invalid")
        return
    if "enum" in schema:
        require(any(type(value) is type(item) and value == item for item in schema["enum"]),
                "manifest-invalid")
        return
    if "type" in schema:
        types = schema["type"] if type(schema["type"]) is list else [schema["type"]]
        matches = {"object": type(value) is dict, "array": type(value) is list,
                   "integer": type(value) is int, "boolean": type(value) is bool,
                   "string": type(value) is str, "null": value is None}
        require(any(matches[kind] for kind in types), "manifest-invalid")
    if type(value) is dict:
        require(set(schema.get("required", [])) <= value.keys(), "manifest-invalid")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            require(value.keys() <= properties.keys(), "manifest-invalid")
        for key, item in value.items():
            validate_schema(item, properties[key])
    elif type(value) is list:
        require(schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 512), "manifest-invalid")
        if schema.get("uniqueItems"):
            require(len({canonical(item) for item in value}) == len(value), "manifest-invalid")
        for item in value:
            validate_schema(item, schema["items"])
    elif type(value) is str:
        require(len(value) <= schema.get("maxLength", 1024), "manifest-invalid")
        if "pattern" in schema:
            require(re.fullmatch(schema["pattern"], value, flags=re.ASCII) is not None, "manifest-invalid")
    elif type(value) is int:
        require(schema.get("minimum", value) <= value <= schema.get("maximum", value), "manifest-invalid")


def closure(rows):
    return sha256("".join(f"{r['path']}\t{r['mode']}\t{r['bytes']}\t{r['sha256']}\n" for r in rows).encode())


class ReleaseBundleV1:
    def __init__(self, schema_bytes: bytes, storage_contracts: dict[str, Storage],
                 native_profile_sha256: str, *, synthetic_only: bool = False):
        require(sha256(schema_bytes) == SCHEMA_SHA256 and digest(native_profile_sha256), "manifest-invalid")
        require(bool(storage_contracts) and all(digest(key) for key in storage_contracts), "state-incompatible")
        self.schema = json.loads(schema_bytes)
        self.storage_contracts = dict(storage_contracts)
        self.native_profile = native_profile_sha256
        self.synthetic_only = synthetic_only

    def verify(self, acquired, policy: Policy):
        value = json_object(acquired.manifest, min(policy.max_manifest_bytes, 262144))
        validate_schema(value, self.schema)
        # Raw manifests use the packaging owner's exact canonical serialization.
        canonical_manifest = (json.dumps(value, sort_keys=True, indent=2,
                                         ensure_ascii=True, allow_nan=False) + "\n").encode()
        require(acquired.manifest == canonical_manifest and value["schemaSha256"] == SCHEMA_SHA256,
                "manifest-invalid")
        selected, producer = acquired.selection, acquired.producer
        source, build = value["source"], value["build"]
        require(value["version"] == selected.version and source["repository"] == policy.repository and
                source["commit"] == build["workflowCommit"] == selected.commit and
                source["tree"] == selected.tree and build["workflow"] == producer.workflow and
                build["ref"] == producer.ref and build["runId"] == str(producer.run_id) and
                build["runAttempt"] == producer.attempt, "release-identity-mismatch")
        require(build["kind"] == ("synthetic-fixture" if self.synthetic_only else "github-actions") and
                build["nativeProfileSha256"] == self.native_profile, "producer-untrusted")
        archive = value["archive"]
        require(archive["name"] == selected.asset_name ==
                f"houseatlas-{selected.version}-x86_64-apple-darwin.tar.gz" and
                archive["sha256"] == selected.archive_sha256 and archive["bytes"] == len(acquired.archive),
                "release-identity-mismatch")
        compatibility = value["compatibility"]
        pin = compatibility["requiredStorageContractSha256"]
        require(compatibility["status"] == "reviewed" and pin in self.storage_contracts and
                compatibility["resultingStorageContractSha256"] == pin and
                compatibility["codeRollbackCompatible"], "state-incompatible")
        rows = value["files"]
        paths = [row["path"] for row in rows]
        require(paths == sorted(set(paths)) and
                sum(row["bytes"] for row in rows) == archive["unpackedBytes"] and
                any(path.startswith("licenses/") for path in paths), "manifest-invalid")
        front = [row for row in rows if row["path"].startswith("frontend/")]
        back = [row for row in rows if row["path"] == "bin/houseatlas"]
        for row in rows:
            require(all(not part.startswith(".") for part in row["path"].split("/")), "manifest-invalid")
            if row["path"].startswith("frontend/"):
                require(Path(row["path"]).suffix[1:] in
                        {"html", "js", "css", "woff2", "webmanifest", "png"} and
                        row["bytes"] <= 4_000_000 and row["mode"] == "0644", "manifest-invalid")
            else:
                require(row["mode"] == ("0755" if row["path"] == "bin/houseatlas" else "0644"),
                        "manifest-invalid")
        components = []
        for name, payload, identity in (("backend", back, back[0]["sha256"] if back else None),
                                         ("frontend", front, closure(front) if front else None)):
            part = value["components"][name]
            if part["action"] == "replace":
                require(bool(payload) and part["identitySha256"] == identity, "manifest-invalid")
                # A replace policy may additionally constrain the installed
                # component; model.Component retains that exact requirement.
            else:
                require(not payload and part["identitySha256"] == part["requiredInstalledSha256"],
                        "manifest-invalid")
            components.append(Component(name, part["action"], part["identitySha256"],
                                        part["requiredInstalledSha256"]))
        require(value["components"]["frontend"]["identitySha256"] == value["frontend"]["closureSha256"],
                "manifest-invalid")
        if front:
            require({"frontend/index.html", "frontend/saved/index.html", "frontend/saved/service-worker.js"}
                    <= set(paths), "manifest-invalid")
        platform = value["platform"]
        require(policy.backend_entry == "bin/houseatlas" and policy.frontend_root == "frontend" and
                policy.license_root == "licenses", "layout-invalid")
        return Bundle(selected, platform["target"], platform["minimumOs"],
                      (platform["abi"], *platform["dynamicLibraries"]), self.storage_contracts[pin], "none",
                      value["frontend"]["closureSha256"], tuple(components),
                      tuple(FileSpec(row["path"], row["bytes"], row["sha256"], int(row["mode"], 8))
                            for row in rows), None, "houseatlas.release-bundle.v1",
                      value["frontend"]["shellBuildSha256"])


def verify_shell(frontend: Path, expected: str):
    paths = (frontend / "saved/index.html", frontend / "saved/service-worker.js")
    require(all(path.is_file() and path.stat().st_size <= 4_000_000 for path in paths), "manifest-invalid")
    marks = re.findall(rb'<meta name="houseatlas-saved-shell-build" content="([0-9a-f]{64})">', paths[0].read_bytes())
    builds = re.findall(rb'^const BUILD="([0-9a-f]{64})", TABLE=', paths[1].read_bytes())
    require(marks == builds == [expected.encode()], "manifest-invalid")
