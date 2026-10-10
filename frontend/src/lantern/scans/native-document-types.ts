import type { ExactDecimal } from '../../numeric/decimal';

export type NativeDocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'text/plain';

/** Private host observation only; this cannot issue native read authority. */
export interface NativeDocumentBinding {
  readonly sessionIdentity: object;
  readonly expiresAt: string;
  readonly scope: { readonly workspaceId: string; readonly homeId: string };
}

/** Actual retained Atlas asset identity and original metadata, supplied on click. */
export interface NativeDocumentExpected {
  readonly assetId: string;
  readonly contentType: NativeDocumentMime;
  readonly sha256: string;
  readonly byteSize: ExactDecimal;
  readonly revision?: ExactDecimal;
}

export interface NativeDocumentAsset {
  readonly assetId: string;
  readonly revision: ExactDecimal;
  readonly contentType: NativeDocumentMime;
  readonly sha256: string;
  readonly byteSize: ExactDecimal;
  readonly purpose: 'evidence-original' | 'geometry-original';
  readonly previewPolicy: 'safe-rendered' | 'download-only';
  readonly sourceLicense: { readonly status: 'unknown' | 'permitted' | 'restricted'; readonly reference: string | null };
  readonly evidenceIds: readonly string[];
}

/** Opaque allocation, meaningful only to the client that returned it. */
export interface NativeDocumentFrame {
  readonly lease: object;
  readonly asset: NativeDocumentAsset;
}

export interface NativeDocumentReadClient {
  /** One explicit user action; no background loading, retry or upload. */
  loadOriginal(expected: NativeDocumentExpected, signal: AbortSignal): Promise<NativeDocumentFrame>;
  isCurrent(frame: NativeDocumentFrame): boolean;
  /** Returns the immutable original only while this client still owns its lease. */
  getBlob(frame: NativeDocumentFrame): Blob | null;
  /** Fires synchronously on withdrawal; already invalid frames notify immediately. */
  subscribeInvalidation(frame: NativeDocumentFrame, changed: () => void): () => void;
  release(frame: NativeDocumentFrame): void;
  dispose(): void;
}
