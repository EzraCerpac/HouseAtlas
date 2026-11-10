#!/usr/bin/env python3
"""Read-only source snapshot audit; never imports or invokes application owners.

No network, subprocess, source rewrite, admission query or test dispatch. Source
hash equality only establishes that the reviewed inputs have not changed. This
does not parse Rust/TypeScript semantics or revalidate historical CI execution.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
MATRIX = "docs/rust-integration/mcp-operation-qualification-v5.json"
CATALOG_KEYS = (
    "toolFamily", "authority", "effect", "permission", "confirmation",
    "capabilityStatus", "inputSchema", "outputSchema", "transports",
)


class StaleInventory(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise StaleInventory(message)


def source(path):
    require(isinstance(path, str) and re.fullmatch(r"[A-Za-z0-9._/-]+", path)
            and all(part not in ("", ".", "..") for part in path.split("/"))
            and not path.startswith("/"), "Invalid source-relative inventory path")
    file = ROOT / path
    require(file.resolve().is_relative_to(ROOT), "Source path escapes checkout")
    require(file.is_file() and not any(p.is_symlink() for p in
            [file, *file.parents] if p != ROOT.parent),
            f"Source is missing or is not an ordinary file: {path}")
    return file.read_bytes()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def invalid_constant(_):
    raise StaleInventory("Nonfinite JSON value")


def load(path):
    return json.loads(source(path), object_pairs_hook=pairs,
                      parse_constant=invalid_constant)


def audit():
    matrix = load(MATRIX)
    require(matrix["format"] == "houseatlas-operation-qualification/5",
            "Unknown qualification snapshot format")
    require(re.fullmatch(r"[0-9a-f]{40}", matrix["baseline"]["mainCommit"]),
            "Missing exact baseline commit")
    pins = matrix["sourcePins"]
    paths = [pin["path"] for pin in pins]
    require(len(paths) == len(set(paths)), "Duplicate source pin")
    changed = [pin["path"] for pin in pins
               if hashlib.sha256(source(pin["path"])).hexdigest() != pin["sha256"]]
    require(not changed, "Reviewed source changed; reinspect before updating pins: "
            + ", ".join(changed))
    require({matrix["catalogPath"], matrix["legacyLedgerPath"]} <= set(paths),
            "Catalog and historical ledger must be pinned")
    catalog = load(matrix["catalogPath"])["commands"]
    rows = matrix["operations"]
    ids = [row["operation"] for row in rows]
    require(len(ids) == len(set(ids)) and ids == [c["commandId"] for c in catalog],
            "Inventory must contain every canonical operation exactly once in catalog order")
    ledger = source(matrix["legacyLedgerPath"]).decode("utf-8")
    for row, command in zip(rows, catalog):
        op = row["operation"]
        require(row["catalog"] == {key: command[key] for key in CATALOG_KEYS},
                f"Catalog metadata differs: {op}")
        require(row["serviceOwner"] in matrix["serviceOwners"],
                f"Missing service ownership disposition: {op}")
        require(row["limitKeys"] and set(row["limitKeys"]) <= matrix["limits"].keys(),
                f"Missing limit disposition: {op}")
        require(set(row["hostProfiles"]) == {"R", "L", "M", "E", "HTTP", "D"},
                f"Missing host profile disposition: {op}")
        require(set(row["historicalEvidence"]) <= matrix["historicalEvidence"].keys(),
                f"Unknown historical evidence reference: {op}")
        # Do not promote any row merely because the source snapshot is current.
        require(row["currentExecution"] == "NOT RUN"
                and row["installedConfiguredAcceptance"] == "OPEN"
                and row["webmcp"]["operationExecution"] == "NOT RUN"
                and row["webmcp"]["browserDevice"] == "DEFERRED",
                f"Source inventory cannot promote execution/acceptance: {op}")
        old = next((line for line in ledger.splitlines()
                    if line.startswith(f"| `{op}` |")), None)
        require(old is not None, f"Missing historical ledger row: {op}")
        cells = [cell.strip() for cell in old.split("|")[1:-1]]
        require(row["historicalDisposition"] == cells[6].split(";")[0]
                and row["remaining"] == cells[6].split(";", 1)[1].strip()
                and row["historicalEvidence"] == re.findall(r"\b[MB][0-9]{2}\b", cells[5]),
                f"Historical row was changed rather than indexed: {op}")
    referenced_paths = {owner["source"] for owner in matrix["serviceOwners"].values()}
    referenced_paths.update(path for limit in matrix["limits"].values()
                            for path in limit["sources"])
    referenced_paths.update(ev["casePath"] for ev in matrix["historicalEvidence"].values())
    require(referenced_paths <= set(paths), "Unpinned owner, limits or historical test source")
    for key, ev in matrix["historicalEvidence"].items():
        require(re.fullmatch(r"[0-9a-f]{40}", ev["sourceCommit"])
                and ev["sourceCommit"] in ledger
                and ev["ciJob"] in ledger,
                f"Historical CI identity is absent from pinned ledger: {key}")
    for profile in ("R", "L", "M", "E", "HTTP"):
        maximum = sum(row["hostProfiles"][profile] != "not-admitted" for row in rows)
        require(maximum == matrix["profiles"][profile]["maximumOperations"],
                f"Reviewed profile maximum differs: {profile}")
    return matrix


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", help="Print one canonical operation with resolved references")
    args = parser.parse_args()
    try:
        matrix = audit()
        rows = matrix["operations"]
        output = {
            "sourceSnapshot": "MATCHES REVIEWED INPUTS",
            "baseline": matrix["baseline"],
            "boundary": matrix["boundary"],
            "operationCount": len(rows),
            "sourcePinCount": len(matrix["sourcePins"]),
            "historicalDispositions": dict(Counter(row["historicalDisposition"] for row in rows)),
            "currentExecution": "NOT RUN",
            "browserDevice": "DEFERRED",
            "installedConfiguredAcceptance": "OPEN",
        }
        if args.operation:
            row = next((r for r in rows if r["operation"] == args.operation), None)
            require(row is not None, "Unknown canonical operation")
            output.update(operation=row,
                          serviceOwner=matrix["serviceOwners"][row["serviceOwner"]],
                          profiles={key: matrix["profiles"][key] for key in row["hostProfiles"]},
                          limits={key: matrix["limits"][key] for key in row["limitKeys"]},
                          historicalEvidence={key: matrix["historicalEvidence"][key]
                                              for key in row["historicalEvidence"]})
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Inventory unavailable: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
