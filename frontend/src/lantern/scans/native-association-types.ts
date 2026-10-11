import type { Scope } from '../../app/types';
import type { LosslessJson } from '../../numeric/lossless-json';

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
export interface NativeAssociationClient {
  getBinding(): NativeAssociationBinding | null;
  subscribe(changed: () => void): () => void;
  subscribePending(changed: () => void): () => void;
  pending(binding: NativeAssociationBinding): readonly NativeAssociationPending[];
  load(binding: NativeAssociationBinding, selection: NativeAssociationSelection, signal: AbortSignal): Promise<NativeAssociationAdmission>;
  prepare(admission: NativeAssociationAdmission, input: { readonly statement: string; readonly reason: string }): NativeAssociationPrepared;
  commit(prepared: NativeAssociationPrepared, signal: AbortSignal): Promise<LosslessJson>;
}
