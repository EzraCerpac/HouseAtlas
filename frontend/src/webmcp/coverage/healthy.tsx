/** Healthy browser fixtures only. No authentication, provider or storage writes. */
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import agent from "../../../../contracts/stock-wire3/agent/agent.schema.json";
import atlas from "../../../../packages/contracts/schemas/atlas.schema.json";
import fixture from "../../../../backend/src/contracts/stock/examples/healthy.json";
import geometryFixture from "../../../../packages/contracts/fixtures/optional-geometry.snapshot.json";
import reconciliationFixture from "../../../../packages/contracts/fixtures/import-remap.snapshot.json";
import { createStockSchemas } from "../../../integration/stock-schemas.js";
import type { StockRequestEnvelope, StockSessionPort } from "../stock.js";
import { stockCatalog } from "../stock-schema.js";
import { bindAtlasService, bindCommandFamilies } from "./families.js";
import { CommandCoverageBoundary } from "./CommandCoverageBoundary.js";

const identity = fixture.requests[0]!;
const circuit = fixture.requests[1]!;
const scope = identity.context;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Published healthy snapshots cover all ten current native record types.
// This port projects their records; it does not claim a Rust transaction ran.
const recordTypes = ["identity", "binding", "evidence", "location-semantics", "circuit", "valve", "relation", "geometry", "asset", "reconciliation"];
const requests = [identity, circuit] as unknown as StockRequestEnvelope[];
const responses: unknown[] = [fixture.results[0]!.wire, fixture.results[1]!.wire];
for (const [index, recordType] of recordTypes.entries()) {
  const record = [...geometryFixture.records, ...reconciliationFixture.records].find(row => row.recordType === recordType)!;
  const target = { authority: "atlas", recordType, recordId: record.recordId };
  const payload = structuredClone(record.payload) as Record<string, unknown>;
  if (recordType === "asset") delete payload["storageKey"]; // Canonical public asset projection.
  for (const action of ["get", "history"]) {
    if (recordType === "identity" && action === "get") continue; // Exact original fixture already included.
    const request = { schemaVersion: 3, commandId: `atlas.${recordType}.${action}`,
      requestId: uuid(71000 + index * 2 + (action === "history" ? 1 : 0)), context: scope, target,
      payload: action === "get" ? {} : { pageSize: 1, cursor: null, includeArchived: false, q: "healthy fixture" } };
    requests.push(request as unknown as StockRequestEnvelope);
    responses.push({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId,
      resolvedScope: scope, status: "read", replayed: false,
      data: action === "get" ? { records: [{ target, revision: record.revision, lifecycle: record.lifecycle, payload }], nextCursor: null, sourceStatus: "current" }
        : { entries: [], nextCursor: null, completeness: "atlas-owned-audit" } });
  }
}
const location = geometryFixture.records.find(row => row.recordType === "location-semantics")!;
const classificationTarget = { authority: "atlas", recordType: location.recordType, recordId: location.recordId };
const classification = { schemaVersion: 3, commandId: "atlas.location-semantics.replace", requestId: uuid(72000),
  context: scope, target: classificationTarget, payload: { ...location.payload, semanticKind: "floor" },
  idempotencyKey: uuid(72001), reason: "Healthy synthetic classification fixture", approvalReceiptId: null,
  preconditions: { target: { kind: "atlas", value: location.revision }, guards: [
    { target: { authority: "atlas", recordType: "identity", recordId: uuid(200) }, revision: { kind: "atlas", value: 1 } },
    { target: { authority: "atlas", recordType: "evidence", recordId: uuid(100) }, revision: { kind: "atlas", value: 1 } },
  ] } };
requests.push(classification as unknown as StockRequestEnvelope);
responses.push({ schemaVersion: 3, commandId: classification.commandId, requestId: classification.requestId,
  resolvedScope: scope, status: "committed", replayed: false, operationId: classification.idempotencyKey,
  data: { auditIds: [uuid(72002)], records: [{ target: classificationTarget, revision: 2, lifecycle: "active", payload: classification.payload }],
    requestDigest: "0".repeat(64) } }); // Explicit synthetic port result, no native commit/digest claim.
const schemas = createStockSchemas();
const session = { schemaVersion: 1 as const, actorId: "healthy-fixture-actor",
  csrfToken: "synthetic-port-marker-no-credential", expiresAt: "2026-12-01T00:00:00Z" };
const sessions: StockSessionPort = {
  getSnapshot: () => ({ state: "authenticated", revision: "healthy-coverage:1" }),
  subscribe: () => () => {},
  getContext: () => ({ session, scope, commandIds: requests.map(row => row.commandId) }),
};
const calls: StockRequestEnvelope[] = [];
const events: string[] = [];
const service = { async dispatch(request: StockRequestEnvelope, context: Parameters<import("../stock.js").StockDispatchPort["dispatch"]>[1]) {
  if (context.applicationSession !== session || context.session.revision !== "healthy-coverage:1")
    throw new Error("Existing host context was not preserved");
  calls.push(structuredClone(request));
  events.push(`dispatch:${request.requestId}`);
  const index = requests.findIndex(row => row.requestId === request.requestId);
  if (index < 0) throw new Error("Unknown healthy fixture");
  return structuredClone(responses[index]);
} };
const bindings = bindAtlasService(service, requests.map(row => row.commandId));
function CommitObservation() {
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => {
      const raw = document.querySelector(".stock-completion pre")?.textContent;
      if (raw) events.push(`visible:${(JSON.parse(raw) as { requestId: string }).requestId}`);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Healthy fixture root missing");
const root = createRoot(rootElement);
root.render(<CommandCoverageBoundary sessions={sessions} schemas={schemas} bindings={bindings}><CommitObservation /></CommandCoverageBoundary>);

const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(validator);
validator.addSchema(atlas);
validator.addSchema(agent);
for (const [index, request] of requests.entries()) {
  const operation = stockCatalog.commands.find(row => row.commandId === request.commandId)!;
  schemas.validate(operation.inputSchema, request);
  schemas.validate(operation.outputSchema, responses[index]);
}
Object.assign(window, { healthyCoverage: {
  requests, responses, calls, events,
  coverage: bindCommandFamilies(sessions, bindings).coverage(),
  validateInput(schema: object, request: unknown) {
    if (!validator.compile(schema)(request)) throw new Error("Advertised browser schema did not accept healthy request");
  },
  unmount: () => root.unmount(),
} });
