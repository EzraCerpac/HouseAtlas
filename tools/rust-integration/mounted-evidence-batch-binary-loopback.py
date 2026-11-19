#!/usr/bin/env python3
"""Qualify one mounted Editor evidence batch on a disposable production Host."""
import importlib.util
import json
from pathlib import Path
import sys
from urllib.parse import urlencode


# Reuse the opt-in production-binary harness's provisioning and cleanup owners.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "network_binary_loopback", Path(__file__).with_name("network-binary-loopback.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
require = fixture.require
PROTOCOL = "2025-11-25"


def uid(number):
    return f"00000000-0000-4000-8000-{number:012}"


def evidence_create(scope, number, serial):
    return {
        "schemaVersion": 3, "commandId": "atlas.evidence.create", "requestId": uid(serial),
        "context": scope, "target": {"authority": "atlas", "recordType": "evidence", "recordId": uid(number)},
        "payload": {"statement": f"Synthetic mounted evidence read controls {number} α",
                    "provenance": {"source": None, "sourceRevision": None, "sourceConfidence": None,
                                   "evidenceBasis": "unknown", "factAt": None,
                                   "retrievedAt": "2026-01-01T12:00:00Z", "vantage": None,
                                   "uncertainty": {"status": "unknown", "explanation": None}},
                    "supersedesEvidenceIds": [], "references": []},
        "idempotencyKey": uid(serial + 1), "reason": "Generated mounted evidence read setup α",
        "approvalReceiptId": None, "preconditions": {"target": None, "guards": []},
    }


def committed(receipt, intent):
    require(receipt["schemaVersion"] == 3 and receipt["commandId"] == intent["commandId"]
            and receipt["requestId"] == intent["requestId"] and receipt["resolvedScope"] == intent["context"]
            and receipt["status"] == "committed" and receipt["replayed"] is False,
            "Canonical committed response did not match its submitted request")


def qualify(executable, root):
    config, client, scope, users = fixture.initialize_host(executable, root, "existing-editor-commands")
    workspace, home = scope["workspaceId"], scope["homeId"]
    scoped = f"workspaces/{workspace}/homes/{home}"
    mcp_path = f"/api/atlas/mcp/{scoped}"
    records_path = f"/api/atlas/stock/v3/{scoped}/records/evidence"
    initialize = {"jsonrpc": "2.0", "id": "initialize", "method": "initialize",
                  "params": {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {
                      "name": "Generated mounted evidence batch", "version": "1"}}}
    # Descending record IDs distinguish submission order from record-ID sorting.
    children = [evidence_create(scope, 42002, 91010), evidence_create(scope, 42001, 91020)]
    batch = {"schemaVersion": 3, "commandId": "atlas.batch.execute", "requestId": uid(91000),
             "context": scope, "target": {"authority": "atlas", "kind": "batch", "batchId": uid(91002)},
             "payload": {"commands": children}, "idempotencyKey": uid(91001),
             "reason": "Generated mounted ordered evidence batch", "approvalReceiptId": None,
             "preconditions": {"target": None, "guards": []}}

    with fixture.backend(executable, config, None, client, root / "backend.log"):
        editor, viewer = (client.login(user) for user in users)
        mcp_session = None

        def mcp_call(message):
            status, headers, value = client.request(
                "POST", mcp_path, editor, body=message, mcp_protocol=PROTOCOL, mcp_session=mcp_session)
            require(status == 200, f"Editor {message['method']}: HTTP {status}")
            require(headers.get("content-type") == "application/json" and value["jsonrpc"] == "2.0"
                    and value["id"] == message["id"] and "error" not in value,
                    f"Editor {message['method']} response did not correlate")
            return headers, value["result"]

        headers, initialized = mcp_call(initialize)
        require(initialized["protocolVersion"] == PROTOCOL and headers.get("mcp-session-id"),
                "Editor initialization did not issue a mounted session")
        mcp_session = headers["mcp-session-id"]
        status, _headers, value = client.request(
            "POST", mcp_path, editor, mcp_protocol=PROTOCOL, mcp_session=mcp_session,
            body={"jsonrpc": "2.0", "method": "notifications/initialized"})
        require(status == 202 and value is None, "Mounted Editor session did not become ready")
        _, listed = mcp_call({"jsonrpc": "2.0", "id": "tools", "method": "tools/list", "params": {}})
        require(any(tool["name"] == "atlas_records" and tool["annotations"]["readOnlyHint"] is False
                    for tool in listed["tools"]), "Mounted Editor did not advertise writable atlas_records")
        _, result = mcp_call({"jsonrpc": "2.0", "id": "batch", "method": "tools/call",
                              "params": {"name": "atlas_records", "arguments": batch}})
        wire = result["structuredContent"]
        content = result["content"]
        require(result["isError"] is False and len(content) == 1 and content[0]["type"] == "text"
                and json.loads(content[0]["text"]) == wire, "Mounted batch text and structured response differ")
        committed(wire, batch)

        lookup = {**batch, "requestId": uid(91030)}
        status, _, retained = client.request("POST", "/api/atlas/retained-intent", editor, body=lookup)
        require(status == 200, f"Editor retained intent: HTTP {status}")
        saved = retained["committedResult"]
        require(retained["format"] == "atlas-retained-reconciliation/1"
                and retained["lookupRequestId"] == lookup["requestId"]
                and saved["originalRequestId"] == batch["requestId"] and saved["wire"] == wire,
                "Retained root did not match the mounted response")
        require(retained["inspection"] == {
            "format": "atlas-retained-intent-inspection/1", "resolvedScope": scope,
            "coverage": "retained-atlas-stock-only", "outcome": "retained-commit",
            "retrySafety": "not-established", "rootOperationId": wire["operationId"],
            "operationId": wire["operationId"], "commandId": batch["commandId"],
            "requestDigest": wire["data"]["requestDigest"],
        }, "Retained inspection did not identify the submitted root batch")
        receipts = saved["children"]
        require(len(receipts) == 2 and len({wire["operationId"], *(r["operationId"] for r in receipts)}) == 3,
                "Expected two retained children and distinct root/child operations")

        status, headers, refusal = client.request(
            "POST", mcp_path, viewer, body=initialize, mcp_protocol=PROTOCOL)
        require(status == 403 and "mcp-session-id" not in headers and refusal["jsonrpc"] == "2.0"
                and refusal["error"]["code"] == -32003 and "result" not in refusal,
                "Viewer initialization did not refuse without issuing a session")

        expected_records, expected_events = [], []
        for child, receipt in zip(children, receipts, strict=True):
            committed(receipt, child)
            target = child["target"]
            expected = {"target": target, "revision": 1, "lifecycle": "active", "payload": child["payload"]}
            record = client.ok("GET", f"{records_path}/{target['recordId']}", viewer)
            require(receipt["data"]["records"] == record["data"]["records"] == [expected]
                    and record["schemaVersion"] == 3 and record["commandId"] == "atlas.evidence.get"
                    and record["resolvedScope"] == scope and record["status"] == "read"
                    and record["replayed"] is False, "Child receipt and ordinary native readback differ")
            expected_records.append(expected)
            audits = receipt["data"]["auditIds"]
            require(len(audits) == 1, "Expected one audit per evidence create")
            expected_events.append({"eventId": audits[0], "rootOperationId": wire["operationId"],
                "operationId": receipt["operationId"], "commandId": child["commandId"],
                "actorId": editor["actorId"], "target": target, "state": "committed",
                "requestDigest": receipt["data"]["requestDigest"]})

        ordered_ids = [entry["eventId"] for entry in expected_events]
        require(wire["data"]["records"] == expected_records and wire["data"]["auditIds"] == ordered_ids
                and len(set(ordered_ids)) == 2, "Root did not flatten the ordered child records and audits")
        event_path = "/api/atlas/operation-events?" + urlencode({**scope, "pageSize": 2})
        page = client.ok("GET", event_path, editor)
        require(page["format"] == "atlas-operation-events/1" and page["resolvedScope"] == scope
                and page["coverage"] == "retained-atlas-stock-only" and page["order"] == "audit-sequence-ascending"
                and page["nextCursor"] is None and len(page["entries"]) == 2,
                "Native operation history did not contain exactly two ordered audits")
        for event, expected in zip(page["entries"], expected_events, strict=True):
            require(all(event[key] == value for key, value in expected.items()),
                    "Native audit did not match the Editor's ordered child receipt")

    print("PASS mounted Editor batch: two ordered evidence creates, retained root and child receipts, "
          "native record and audit readback; Viewer read allowed and mounted initialization refused")
    print("PASS production serve drained on SIGTERM")


if __name__ == "__main__":
    fixture.run(qualify, __doc__, "houseatlas-mounted-evidence-batch-")
