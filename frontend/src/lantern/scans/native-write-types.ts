import type { Scope } from '../../app/types';
import type { LosslessJson } from '../../numeric/lossless-json';

export type NativeGeometryKind = 'original' | 'derivative';
export type NativeGeometryOriginalType = 'model/vnd.usdz+zip' | 'application/x-step';
export interface NativeGeometryLicense {
  readonly status: 'unknown' | 'permitted' | 'restricted';
  readonly reference: string | null;
}
/** Public binding contains scope only; the host owns session and CSRF values. */
export interface NativeGeometryBinding { readonly scope: Readonly<Scope> }
export interface NativeGeometryInput {
  readonly file: Blob;
  readonly filename: string;
  readonly reason: string;
  readonly sourceLicense: NativeGeometryLicense;
}
/** One local, immutable intent. A submitted file and metadata remain inspectable
 * in the client memory ledger even if the custody response is lost. */
export interface NativeGeometryPrepared {
  readonly binding: NativeGeometryBinding;
  readonly kind: NativeGeometryKind;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly metadata: string;
  readonly file: Blob;
  readonly filename: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly sourceLicense: NativeGeometryLicense;
  readonly originalAssetId?: string;
}
/** A correlated custody commit, not a building association or fresh graph read.
 * Raw numeric nodes retain their original wire spelling as ExactDecimal. */
export interface NativeGeometryCustodyReceipt {
  readonly schemaVersion: 1;
  readonly kind: NativeGeometryKind;
  readonly association: 'not-associated';
  readonly assetId: string;
  readonly originalRequest: LosslessJson;
  readonly result: LosslessJson;
  readonly originalRequestBody: string;
  readonly responseBody: string;
}
export interface NativeGeometryPending {
  readonly prepared: NativeGeometryPrepared;
  readonly outcome: 'unknown' | 'committed';
  readonly receipt?: NativeGeometryCustodyReceipt;
}
export interface NativeGeometryWriteClient {
  getBinding(): NativeGeometryBinding | null;
  subscribe(changed: () => void): () => void;
  subscribePending(changed: () => void): () => void;
  pending(binding: NativeGeometryBinding): readonly NativeGeometryPending[];
  canPrepare(binding: NativeGeometryBinding): boolean;
  prepareOriginal(binding: NativeGeometryBinding, input: NativeGeometryInput & {
    readonly contentType: NativeGeometryOriginalType;
  }, signal: AbortSignal): Promise<NativeGeometryPrepared>;
  prepareDerivative(binding: NativeGeometryBinding, original: NativeGeometryCustodyReceipt,
    input: NativeGeometryInput, signal: AbortSignal): Promise<NativeGeometryPrepared>;
  commit(prepared: NativeGeometryPrepared, signal: AbortSignal): Promise<NativeGeometryCustodyReceipt>;
}
