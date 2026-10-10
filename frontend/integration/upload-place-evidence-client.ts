/** Actual one-request upload transport. This helper grants no authority. */
import atlas from "../../packages/contracts/schemas/atlas.schema.json";
import type { AtlasEditingClient, PlaceEditAdmission, UploadPlaceEvidence } from "../src/app/editing.js";
import type { AtlasSessionInfo } from "../src/app/session.js";
import type { StockResultEnvelope, StockSchemaPort } from "../src/webmcp/stock.js";
import { validateSelectionClaim } from "../src/capture-evidence/types";

const maximumBytes = 10 * 1024 * 1024;
const maximumMetadataBytes = 64 * 1024;
const supportedContentTypes = ["image/png", "image/jpeg", "application/pdf", "text/plain"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Attachment admission is incompatible");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    throw new TypeError("Attachment admission is incompatible");
}

/** Preserve actual host policy values. This parses a UI DTO, not authority. */
export function readAttachmentPolicy(
  value: unknown,
  schemas: StockSchemaPort,
): PlaceEditAdmission["attachmentPolicy"] {
  if (value === undefined) return undefined;
  const policy = object(value);
  exactKeys(policy, ["contentTypes", "maximumBytes", "licenses"]);
  if (policy["maximumBytes"] !== maximumBytes || !Array.isArray(policy["contentTypes"]) ||
      policy["contentTypes"].length === 0 || policy["contentTypes"].length > supportedContentTypes.length ||
      !policy["contentTypes"].every(type => typeof type === "string" &&
        supportedContentTypes.includes(type as typeof supportedContentTypes[number])) ||
      new Set(policy["contentTypes"]).size !== policy["contentTypes"].length ||
      !Array.isArray(policy["licenses"]) || policy["licenses"].length === 0 || policy["licenses"].length > 3)
    throw new TypeError("Attachment admission is incompatible");
  for (const raw of policy["licenses"]) {
    const choice = object(raw);
    exactKeys(choice, ["label", "value"]);
    if (typeof choice["label"] !== "string" || !choice["label"].trim() || Array.from(choice["label"]).length > 255)
      throw new TypeError("Attachment admission is incompatible");
    schemas.validate(`${atlas.$id}#/$defs/license`, choice["value"]);
  }
  return structuredClone(policy) as unknown as NonNullable<PlaceEditAdmission["attachmentPolicy"]>;
}

/** One fresh request; no client stage/token round trip and no automatic retry. */
export function createUploadPlaceEvidence(
  schemas: StockSchemaPort,
  session: () => AtlasSessionInfo | null,
): NonNullable<AtlasEditingClient["uploadPlaceEvidence"]> {
  const validate = (name: string, value: unknown) => schemas.validate(`${atlas.$id}#/$defs/${name}`, value);
  return async (intent: UploadPlaceEvidence, signal: AbortSignal): Promise<StockResultEnvelope> => {
    validate("scope", intent.context);
    validate("recordRef", { recordType: "location-semantics", recordId: intent.recordId });
    validate("license", intent.sourceLicense);
    if (intent.capture) {
      validateSelectionClaim(intent.capture, intent.file.name);
    }
    if (!uuid.test(intent.requestId) || !uuid.test(intent.idempotencyKey) ||
        !Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 1 ||
        !Array.isArray(intent.guards) || intent.guards.length > 100)
      throw new TypeError("Attachment intent is incompatible");
    for (const guard of intent.guards) validate("guard", guard);
    if (typeof intent.reason !== "string" || !intent.reason.trim() || Array.from(intent.reason).length > 1024)
      throw new RangeError("Reason must contain at most 1024 Unicode characters");
    if (typeof intent.statement !== "string" || !intent.statement.trim() || Array.from(intent.statement).length > 4096)
      throw new RangeError("Evidence statement must contain at most 4096 Unicode characters");
    if (!(intent.file instanceof File) || intent.file.size < 1 || intent.file.size > maximumBytes ||
        !supportedContentTypes.includes(intent.file.type as typeof supportedContentTypes[number]) ||
        !intent.file.name || Array.from(intent.file.name).length > 255 || /[\/\\\u0000-\u001f]/u.test(intent.file.name))
      throw new TypeError("Attachment file is incompatible");
    const actual = session();
    if (!actual) throw new Error("Application session is unavailable");

    // File facts in metadata are declared labels. The Media owner measures and
    // validates actual bytes; file.size and file.type confer no storage proof.
    const metadata = {
      schemaVersion: intent.capture ? 2 : 1,
      requestId: intent.requestId,
      idempotencyKey: intent.idempotencyKey,
      context: intent.context,
      recordId: intent.recordId,
      expectedRevision: intent.expectedRevision,
      guards: intent.guards,
      statement: intent.statement,
      sourceLicense: intent.sourceLicense,
      reason: intent.reason,
      filename: intent.file.name,
      contentType: intent.file.type,
      ...(intent.capture ? { capture: intent.capture } : {}),
    };
    const encoded = JSON.stringify(metadata);
    if (new TextEncoder().encode(encoded).byteLength > maximumMetadataBytes)
      throw new RangeError("Attachment metadata exceeds transport bound");
    const body = new FormData();
    body.append("metadata", encoded);
    body.append("file", intent.file, intent.file.name);
    const path = `/api/atlas/editing/v1/workspaces/${encodeURIComponent(intent.context.workspaceId)}/homes/${encodeURIComponent(intent.context.homeId)}/places/${encodeURIComponent(intent.recordId)}/evidence`;
    const response = await fetch(path, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { Accept: "application/json", "X-Atlas-CSRF": actual.csrfToken }, body,
    });
    const raw: unknown = await response.json();
    if (!response.ok) throw new Error("Attachment command could not complete");
    schemas.validate("#/$defs/result_atlas_batch_execute", raw);
    const result = raw as StockResultEnvelope;
    const resolved = object(result["resolvedScope"]);
    if (result.requestId !== intent.requestId || result["commandId"] !== "atlas.batch.execute" ||
        resolved["workspaceId"] !== intent.context.workspaceId || resolved["homeId"] !== intent.context.homeId)
      throw new TypeError("Attachment completion correlation differs");
    return result;
  };
}
