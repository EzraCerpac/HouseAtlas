import type {
  Guard,
  License,
  LocationSemanticsRecord,
  Scope,
  SourceRef,
} from "../api/generated/contracts.js";
import type {
  StockRequestEnvelope,
  StockResultEnvelope,
} from "../webmcp/stock.js";

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
