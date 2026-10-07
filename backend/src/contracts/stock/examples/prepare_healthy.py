"""Prepare explicit synthetic schema examples; never execute a domain operation.

Uses only published healthy fixture facts and static synthetic envelope metadata.
The fixture uses integer numbers and ASCII keys, so this small offline golden
digest computation needs no general canonical-number or UTF-16 implementation.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
FIXTURES = ROOT / "packages/contracts/fixtures"


def read(name):
    return json.loads((FIXTURES / name).read_text())


def uid(number):
    return f"00000000-0000-4000-8000-{number:012d}"


def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":")).encode()).hexdigest()


def intent(request):
    value = deepcopy(request)
    value.pop("requestId", None)
    value.pop("approvalReceiptId", None)
    if value["target"]["authority"] == "homebox" and "preconditions" in value:
        value["preconditions"].pop("providerObservation", None)
    return digest(value)


snapshot = read("plan-free.snapshot.json")
remapped = read("import-remap.snapshot.json")
created = read("create-circuit.result.json")
command = read("create-circuit.mutation.json")
batch = read("import-remap.batch.json")
scope = {key: created["record"][key] for key in ["workspaceId", "homeId"]}
records = {record["recordId"]: record for record in snapshot["records"]}
final_records = {record["recordId"]: record for record in remapped["records"]}


def target(record):
    return {"authority": "atlas", "recordType": record["recordType"],
            "recordId": record["recordId"]}


def public_record(record):
    return {"target": target(record), "revision": record["revision"],
            "lifecycle": record["lifecycle"], "payload": record["payload"]}


def request(name, selected, payload, number):
    return {"schemaVersion": 3, "commandId": name, "requestId": uid(number),
            "context": scope, "target": selected, "payload": payload}


identity = records[uid(201)]
get_identity = request("atlas.identity.get", target(identity), {}, 60001)
create = request("atlas.circuit.create", target(created["record"]),
                 command["value"]["payload"], 60002)
create.update(idempotencyKey=command["mutationId"], reason=command["reason"],
              approvalReceiptId=None,
              preconditions={"target": None, "guards": [
                  {"target": {"authority": "atlas", **guard["record"]},
                   "revision": {"kind": "atlas", "value": guard["expectedRevision"]}}
                  for guard in command["guards"]]})
new_binding = final_records[uid(304)]
journal = final_records[uid(405)]
remap = request("atlas.binding.remap", target(records[uid(301)]), {
    "oldBindingId": uid(301), "newBindingId": uid(304), "journalId": uid(405),
    "source": new_binding["payload"]["source"], "reason": "import-id-remap",
    "evidenceIds": journal["payload"]["evidenceIds"]}, 60003)
remap.update(idempotencyKey=uid(61003), reason=batch["reason"], approvalReceiptId=None,
             preconditions={"target": {"kind": "atlas", "value": 1}, "guards": [
                 {"target": {"authority": "atlas", **guard["record"]},
                  "revision": {"kind": "atlas", "value": guard["expectedRevision"]}}
                 for guard in batch["commands"][2]["command"]["guards"]]})
ordered_batch = request("atlas.batch.execute", {"authority": "atlas", "kind": "batch",
                        "batchId": uid(61004)}, {"commands": [create, remap]}, 60004)
ordered_batch.update(idempotencyKey=uid(61004), reason=batch["reason"],
                     approvalReceiptId=None, preconditions={"target": None, "guards": []})
collection = {"authority": "homebox", "sourceInstanceId": uid(10),
              "collectionId": uid(62001), "resourceKind": "collection"}
currency = request("homebox.query.read", collection, {"view": "currency", "limit": 1}, 60005)
bulk = request("homebox.bulk.execute", collection, {
    "action": "create-missing-thumbnails", "impactId": uid(62002),
    "impactDigest": "a" * 64}, 60006)
bulk.update(idempotencyKey=uid(61006), reason="Synthetic schema-only preparation",
            approvalReceiptId=None, preconditions={"providerObservation": {
                "kind": "provider-observation", "handle": uid(62003)}, "atlasGuards": []})
network_binding = records[uid(302)]
network_key = network_binding["payload"]["source"]
network = request("network.inventory.get", {"authority": "network",
    "sourceInstanceId": network_key["sourceInstanceId"],
    "collectionId": network_key["collectionId"]}, {}, 60007)
requests = [get_identity, create, remap, ordered_batch, currency, bulk, network]


def result(request_value, data, committed=False):
    wire = {"schemaVersion": 3, "commandId": request_value["commandId"],
            "requestId": request_value["requestId"], "resolvedScope": scope,
            "status": "committed" if committed else "read", "replayed": False, "data": data}
    if committed:
        wire["operationId"] = request_value["idempotencyKey"]
    return wire


def receipt(request_value, selected_records):
    return result(request_value, {
        "auditIds": [record["lastAuditId"] for record in selected_records],
        "records": [public_record(record) for record in selected_records],
        "requestDigest": intent(request_value)}, True)


create_result = receipt(create, [created["record"]])
remap_result = receipt(remap, [final_records[uid(301)], new_binding, journal])
batch_result = result(ordered_batch, {
    "auditIds": create_result["data"]["auditIds"] + remap_result["data"]["auditIds"],
    "records": create_result["data"]["records"] + remap_result["data"]["records"],
    "requestDigest": intent(ordered_batch)}, True)
currency_result = {"schemaVersion": 3, "commandId": currency["commandId"],
    "requestId": currency["requestId"], "status": "read", "resolvedScope": scope,
    "sourceInstanceId": collection["sourceInstanceId"], "collectionId": collection["collectionId"],
    "retrievedAt": "2026-01-02T12:00:00Z", "data": {"kind": "currency", "currency": {
        "code": "USD", "decimals": 2, "name": "Synthetic dollar", "symbol": "$", "local": "en-US"}}}
prepared = {"schemaVersion": 3, "commandId": bulk["commandId"], "requestId": bulk["requestId"],
    "operationId": bulk["idempotencyKey"], "resolvedScope": scope, "requestDigest": intent(bulk),
    "causalityProven": False, "atomicProviderCAS": False, "nativeEditorRacePossible": True,
    "knownEffects": [], "observedAt": "2026-01-02T12:00:00Z", "responseDigest": None,
    "readbackDigest": None, "generatedIdentityResolved": False, "unknownScopeFenceRetained": False,
    "remoteActivity": {"state": "not-dispatched", "terminationEvidenceDigest": None},
    "storageLiability": {"accountingComplete": True, "metadataCommitEvidence": "not-dispatched",
        "byteDisposition": "none", "referenceClosureEvidence": "unassessed", "orphanCandidateId": None,
        "unresolvedAttempts": 0, "knownBytes": 0, "reservedBytes": 0},
    "state": "prepared", "verification": "unresolved", "responseSuccess": False,
    "readbackAgrees": False, "resolutionEvidenceDigest": None, "resolutionActorId": None}
results = [
    {"wire": result(get_identity, {"records": [public_record(identity)], "nextCursor": None,
        "sourceStatus": "current"}), "children": []},
    {"wire": create_result, "children": []}, {"wire": remap_result, "children": []},
    {"wire": batch_result, "children": [create_result, remap_result]},
    {"wire": currency_result, "children": []}, {"wire": prepared, "children": []},
    {"wire": result(network, {"capability": "inventory", "relations": snapshot["networkRelations"],
        "devices": [{"source": network_key, "label": None, "confidence": None}],
        "sourceStatus": "current", "readOnly": True}), "children": []}]

witnesses = []
for index, source in enumerate([new_binding["payload"]["source"], network_key,
                               {**network_key, "sourceKind": "network-group", "externalId": "group-a"}]):
    registration = next(row for row in snapshot["sources"] if row["sourceInstanceId"] == source["sourceInstanceId"])
    observation = ({"kind": "homebox-entity", "memberSha256": "b" * 64,
        "memberRetrievedAt": "2026-01-02T12:00:00Z", "sourceUpdatedAt": None}
        if source["sourceKind"] == "homebox-entity" else {"kind": "network-inventory",
        "memberSha256": "b" * 64, "verifiedGenerationSha256": "c" * 64,
        "generationRetrievedAt": "2026-01-02T12:00:00Z", "sourceSnapshotAt": None})
    witnesses.append({"schemaVersion": 1, "semanticAmendmentVersion": "1.1.0", **scope,
        "bindingRecordId": uid(304 if index == 0 else 302), "bindingRevision": 1,
        "auditId": uid(63001 + index), "mutationId": uid(63011 + index), "actorId": uid(63021),
        "operation": "create", "trigger": "create-present", "source": source,
        "observedAt": "2026-01-02T12:00:00Z", "admittedAt": "2026-01-02T12:00:01Z",
        "cache": {"generationId": uid(63031 + index), "cacheEpoch": 1,
            "status": "fresh", "lastSuccessfulFetchAt": "2026-01-02T12:00:00Z"},
        "authority": {"authorityContextVersion": "atlas-mutation-authorization-context/1",
            "contextId": uid(63041), "accessPackageVersion": "1.0.0", "accessEpoch": "synthetic-epoch",
            "sourceRegistrationVersion": 1, "sourceRegistrationSha256": digest(registration)},
        "observation": observation})
qualification_keys = ["bindingRecordId", "source", "observedAt", "cache", "authority", "observation"]
example = {"synthetic": True, "scope": "Schema/representation examples only; no mutations, dispatch, authority or witness admission",
    "requests": requests, "results": results, "intentDigests": [intent(value) for value in requests],
    "presenceWitnesses": witnesses,
    "presenceQualifications": [{key: value[key] for key in qualification_keys} for value in witnesses]}
Path(__file__).with_name("healthy.json").write_text(json.dumps(example, ensure_ascii=False, indent=2) + "\n")
print("Prepared seven explicit synthetic envelope pairs and three presence shape examples")
