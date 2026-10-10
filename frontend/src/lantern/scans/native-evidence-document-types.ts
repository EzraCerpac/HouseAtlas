import type { NativeDocumentAsset } from './native-document-types';

/** A saved evidence reference, its current original, and an optional qualified preview. */
export interface NativeEvidenceDocumentFrame {
  readonly lease: object;
  readonly evidenceId: string;
  readonly evidenceRevision: number;
  readonly asset: NativeDocumentAsset;
  readonly mode: 'inline-png' | 'original-download';
}

export interface NativeEvidenceDocumentClient {
  /** Resolves the genuine current evidence -> asset join on each explicit click. */
  open(evidenceId: string, signal: AbortSignal): Promise<NativeEvidenceDocumentFrame>;
  isCurrent(frame: NativeEvidenceDocumentFrame): boolean;
  getBlob(frame: NativeEvidenceDocumentFrame): Blob | null;
  subscribeInvalidation(frame: NativeEvidenceDocumentFrame, changed: () => void): () => void;
  release(frame: NativeEvidenceDocumentFrame): void;
  dispose(): void;
}
