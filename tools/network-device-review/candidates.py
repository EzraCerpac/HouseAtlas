#!/usr/bin/env python3
"""Offline suggestions only. Never publishes or accepts a reviewed device link."""
import argparse
import hashlib
import json
import os
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON member")
        result[key] = value
    return result


def read(path):
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Input exceeds 10 MiB")
    return data, json.loads(data, object_pairs_hook=unique_object,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite number")))


def hardware(row):
    # Only explicitly recorded fields, never names, labels or prose.
    result = set()
    for key in ("mac", "hardwareAddress"):
        value = row.get(key)
        if isinstance(value, str):
            normalized = value.lower().replace(":", "").replace("-", "")
            if len(normalized) == 12 and all(c in "0123456789abcdef" for c in normalized):
                result.add(normalized)
    return result


def candidates(snapshot_bytes, snapshot, cached):
    devices = snapshot["network"]["devices"]
    live = cached["devices"]
    interfaces = cached["interfaces"]
    if not isinstance(devices, list) or not isinstance(live, list) or not isinstance(interfaces, list):
        raise ValueError("Expected device and interface lists")
    if len(devices) > 512 or len(live) > 10000 or len(interfaces) > 10000:
        raise ValueError("Input record limit exceeded")
    scope = {k: cached[k] for k in ("workspaceId", "homeId", "sourceInstanceId", "collectionId")}
    sha = hashlib.sha256(snapshot_bytes).hexdigest()
    by_id, by_mac, rows = {}, {}, {}
    for other in live:
        external = other["externalId"]
        if external in rows or any(other.get(k) != v for k, v in scope.items()):
            raise ValueError("Ambiguous or mismatched cached identity")
        rows[external] = other
        by_id[external] = {external}
        for mac in hardware(other["value"]):
            by_mac.setdefault(mac, set()).add(external)
    for interface in interfaces:
        if any(interface.get(k) != v for k, v in scope.items()):
            raise ValueError("Mismatched interface scope")
        external = interface["value"].get("deviceId")
        if external not in rows:
            raise ValueError("Missing interface parent")
        for mac in hardware(interface["value"]):
            by_mac.setdefault(mac, set()).add(external)
    suggestions, templates = [], []
    for device in devices:
        possible = []
        eligible = set(by_id.get(device["id"], set()))
        for mac in hardware(device):
            eligible.update(by_mac.get(mac, set()))
        for external in sorted(eligible):
            other = rows[external]
            evidence = []
            if device["id"] == other["externalId"]:
                evidence.append({"kind": "exact-identifier-equality", "value": device["id"]})
            for mac in sorted(hardware(device)):
                if external in by_mac.get(mac, set()):
                    evidence.append({"kind": "shared-explicit-hardware-address", "value": mac})
            if not evidence:
                continue
            source = {**scope, "sourceKind": "network-device", "externalId": other["externalId"]}
            template = {"sceneOriginalSha256": sha, "documentaryDeviceId": device["id"],
                        "source": source, "reviewStatus": "unreviewed", "reviewer": None,
                        "reviewedAt": None, "evidenceReference": "REPLACE_WITH_REVIEW_EVIDENCE"}
            possible.append({"source": source, "evidence": evidence, "reviewStatus": "unreviewed"})
            if len(templates) >= 4096:
                raise ValueError("Candidate pair limit exceeded")
            templates.append(template)
        suggestions.append({"documentaryDeviceId": device["id"], "candidates": possible})
    return {"profile": "houseatlas.network-device-review-candidates.v1",
            "warning": "UNREVIEWED suggestions only. No identity or placement is confirmed. Prepare a separate reviewed file after owner decisions.",
            "devices": suggestions,
            "unreviewedLinkTemplate": {"profile": "houseatlas.atlas-device-links.v1", "links": templates}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("cached_export", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw, snapshot = read(args.snapshot)
    _, cached = read(args.cached_export)
    result = candidates(raw, snapshot, cached)
    # Exclusive creation cannot overwrite an existing review file or an input.
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


if __name__ == "__main__":
    main()
