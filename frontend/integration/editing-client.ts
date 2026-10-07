import atlas from "../../packages/contracts/schemas/atlas.schema.json";
import type { SourceRef } from "../src/api/generated/contracts.js";
import type { AtlasEditingClient, PlaceEditAdmission } from "../src/app/editing.js";
import type { AtlasSessionInfo } from "../src/app/session.js";
import type { StockRequestEnvelope, StockResultEnvelope, StockSchemaPort } from "../src/webmcp/stock.js";

export const maximumReasonCodePoints = 1024;
/** Retain the full submitted reason. This native profile never clips text. */
export function assertNativeReason(reason: unknown): asserts reason is string {
  if (typeof reason !== "string" || !reason.trim() || Array.from(reason).length > maximumReasonCodePoints)
    throw new RangeError("Reason must contain at most 1024 Unicode characters");
}
export function createEditingClient(schemas: StockSchemaPort, session: () => AtlasSessionInfo | null): AtlasEditingClient {
  const validate = (name: string, value: unknown) => schemas.validate(`${atlas.$id}#/$defs/${name}`, value);
  return {
    async loadPlace(source: SourceRef, signal: AbortSignal): Promise<PlaceEditAdmission | null> {
      validate("sourceRef", source);
      const sourceJson = JSON.stringify(source);
      if (new TextEncoder().encode(sourceJson).byteLength > 2048)
        throw new TypeError("Place source exceeds the decoded transport bound");
      const query = `source=${encodeURIComponent(sourceJson)}`;
      if (query.length > 4096) throw new TypeError("Place source exceeds transport bound");
      const path = `/api/atlas/editing/v1/workspaces/${encodeURIComponent(source.workspaceId)}/homes/${encodeURIComponent(source.homeId)}/place`;
      const response = await fetch(`${path}?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Place admission could not complete");
      const raw: unknown = await response.json();
      if (raw === null) return null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Place admission is incompatible");
      const value = raw as Record<string, unknown>;
      if (typeof value.canReplaceClassification !== "boolean" || value.maximumReasonCodePoints !== maximumReasonCodePoints || !Array.isArray(value.guards)) throw new TypeError("Place admission is incompatible");
      validate("location-semanticsRecord", value.record);
      for (const guard of value.guards) validate("guard", guard);
      const admission = value as unknown as PlaceEditAdmission;
      if (admission.record.workspaceId !== source.workspaceId || admission.record.homeId !== source.homeId || admission.record.lifecycle !== "active") throw new TypeError("Place admission scope differs");
      return { record: admission.record, guards: admission.guards, canReplaceClassification: admission.canReplaceClassification };
    },
    async replacePlace(request: StockRequestEnvelope, signal: AbortSignal): Promise<StockResultEnvelope> {
      schemas.validate("#/$defs/request_atlas_location_semantics_replace", request);
      assertNativeReason(request["reason"]);
      const actual = session();
      if (!actual) throw new Error("Application session is unavailable");
      const path = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(request.context.workspaceId)}/homes/${encodeURIComponent(request.context.homeId)}/commands`;
      const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Atlas-CSRF": actual.csrfToken }, body: JSON.stringify(request) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("Place command could not complete");
      schemas.validate("#/$defs/result_atlas_location_semantics_replace", body);
      const result = body as StockResultEnvelope;
      const resolved = result["resolvedScope"] as Record<string, unknown>;
      if (result.requestId !== request.requestId || result["commandId"] !== request.commandId || resolved["workspaceId"] !== request.context.workspaceId || resolved["homeId"] !== request.context.homeId) throw new TypeError("Place completion correlation differs");
      return result;
    },
  };
}
