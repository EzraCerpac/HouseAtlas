import type {
  Guard,
  License,
  LocationSemanticsPayloadSemanticKind,
  LocationSemanticsRecord,
  Scope,
  SourceRef,
} from "../api/generated/contracts.js";
import type {
  StockRequestEnvelope,
  StockResultEnvelope,
} from "../webmcp/stock.js";
import type { BrowserSelectionClaim } from "../capture-evidence/types";

/** Proposed host admission, never inferred from canEdit or the stock catalog. */
export interface PlaceEditAdmission {
  readonly record: LocationSemanticsRecord;
  readonly guards: readonly Guard[];
  readonly canReplaceClassification: boolean;
  readonly attachmentPolicy?: {
    readonly contentTypes: readonly string[];
    readonly maximumBytes: number;
    readonly licenses: readonly {
      readonly label: string;
      readonly value: License;
    }[];
  };
}
/** Binary intent for a root-owned guarded asset/evidence/location batch.
 * Root derives asset identity, storage proof and new immutable evidence. */
export interface UploadPlaceEvidence {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly context: Scope;
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly guards: readonly Guard[];
  readonly file: File;
  readonly statement: string;
  readonly sourceLicense: License;
  readonly reason: string;
  /** Optional browser selection labels, never factAt or measured Media proof. */
  readonly capture?: BrowserSelectionClaim;
}
export interface AtlasEditingClient {
  loadPlace(
    source: SourceRef,
    signal: AbortSignal,
  ): Promise<PlaceEditAdmission | null>;
  replacePlace(
    request: StockRequestEnvelope,
    signal: AbortSignal,
  ): Promise<StockResultEnvelope>;
  uploadPlaceEvidence?: (
    intent: UploadPlaceEvidence,
    signal: AbortSignal,
  ) => Promise<StockResultEnvelope>;
}

export const kindLabel = (kind: LocationSemanticsPayloadSemanticKind): string =>
  `${kind[0]?.toUpperCase()}${kind.slice(1)}`;

/** The replace command for a new classification, guarded by the admitted
 * record's revision and its evidence. A floor keeps its elevation; any other
 * kind drops it. Fresh request identity on every call. */
export function classificationRequest(
  admission: PlaceEditAdmission,
  kind: LocationSemanticsPayloadSemanticKind,
  reason: string,
): StockRequestEnvelope {
  const record = admission.record,
    { elevation, ...payload } = record.payload;
  return {
    schemaVersion: 3,
    commandId: "atlas.location-semantics.replace",
    requestId: crypto.randomUUID(),
    context: { workspaceId: record.workspaceId, homeId: record.homeId },
    target: {
      authority: "atlas",
      recordType: "location-semantics",
      recordId: record.recordId,
    },
    payload: {
      ...payload,
      semanticKind: kind,
      ...(kind === "floor" && elevation !== undefined
        ? { elevation: { ...elevation } }
        : {}),
    },
    idempotencyKey: crypto.randomUUID(),
    reason,
    approvalReceiptId: null,
    preconditions: {
      target: { kind: "atlas", value: record.revision },
      guards: admission.guards.map((guard) => ({
        target: { authority: "atlas", ...guard.record },
        revision: { kind: "atlas", value: guard.expectedRevision },
      })),
    },
  } as StockRequestEnvelope;
}
