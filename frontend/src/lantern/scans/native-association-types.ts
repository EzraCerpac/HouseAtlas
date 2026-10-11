import type { Scope } from '../../app/types';
import type { LosslessJson } from '../../numeric/lossless-json';
import type { ExactDecimal } from '../../numeric/decimal';

/** The private host supplies a stable canonical session-owner identity. */
export interface NativeAssociationBinding { readonly scope: Readonly<Scope> }
export interface NativeAssociationSelection {
  readonly buildingId: string;
  /** The actual accepted building classification record ID, never inferred from a package. */
  readonly semanticsId: string;
  readonly originalAssetId: string;
  readonly derivativeAssetId: string;
  /** Explicit current same-building native lineage head; absent/null creates v1. */
  readonly previousGeometryId?: string | null;
}
export interface NativeAssociationAdmission {
  readonly binding: NativeAssociationBinding;
  readonly selection: Readonly<NativeAssociationSelection>;
  /** Exact current Stock reads, including all evidence and both asset records. */
  readonly records: readonly LosslessJson[];
}
export interface NativeAssociationPrepared {
  readonly binding: NativeAssociationBinding;
  readonly selection: Readonly<NativeAssociationSelection>;
  readonly requestId: string;
  readonly body: string;
  readonly originalRequest: LosslessJson;
}
export interface NativeAssociationPending {
  readonly prepared: NativeAssociationPrepared;
  readonly outcome: 'unknown' | 'committed';
  readonly receipt?: LosslessJson;
}
export interface NativeAssociationReservationInput {
  readonly buildingId: string;
  readonly semanticsId: string;
  /** Complete ordered set which needs new custody; already reused floors are excluded. */
  readonly floors: readonly { readonly previousGeometryId?: string | null }[];
  readonly statement: string;
  readonly reason: string;
}
/** GET-only capacity observation. This is neither custody nor commit admission;
 * actual retained assets and current record guards must still be loaded afresh. */
export interface NativeAssociationReservation {
  readonly binding: NativeAssociationBinding;
  readonly identityRevision: ExactDecimal;
  readonly semanticsRevision: ExactDecimal;
  readonly floors: readonly {
    readonly index: number;
    readonly previousGeometryId: string | null;
    readonly recordCount: number;
    readonly guardCount: number;
    readonly bodyBytes: number;
  }[];
}
export interface NativeAssociationClient {
  getBinding(): NativeAssociationBinding | null;
  subscribe(changed: () => void): () => void;
  subscribePending(changed: () => void): () => void;
  pending(binding: NativeAssociationBinding): readonly NativeAssociationPending[];
  reserve(binding: NativeAssociationBinding, input: NativeAssociationReservationInput, signal: AbortSignal): Promise<NativeAssociationReservation>;
  load(binding: NativeAssociationBinding, selection: NativeAssociationSelection, signal: AbortSignal): Promise<NativeAssociationAdmission>;
  prepare(admission: NativeAssociationAdmission, input: { readonly statement: string; readonly reason: string }): NativeAssociationPrepared;
  commit(prepared: NativeAssociationPrepared, signal: AbortSignal): Promise<LosslessJson>;
}
