/** Native v2 source Documents as read from the full geodata profile. Document,
 * asset and audit IDs are native Atlas identities; they are never HomeBox,
 * Stock evidence or attachment IDs, and nothing here is joined by title. */

export type SourceDocumentMime = 'application/geo+json' | 'application/city+json' | 'application/json'
  | 'image/tiff' | 'application/pdf' | 'image/png';
export type SourceOriginalAvailability = 'available' | 'unavailable' | 'access-revoked' | 'stale' | 'quarantined';
export type SourcePreviewAvailability = SourceOriginalAvailability | 'not-qualified';

/** Immutable retained bytes: identity, revision, SHA-256 and exact length. */
export interface SourceAssetPin { readonly assetId: string; readonly revision: number; readonly sha256: string; readonly bytes: number }
export interface SourceDate { readonly value: string; readonly precision: 'year' | 'day' | 'instant' }
/** Declared frame; extent numbers keep their exact source tokens. */
export interface SourceFrame {
  readonly crs: string | null; readonly axes: readonly string[]; readonly linearUnit: string | null;
  readonly extent: readonly string[] | null;
}
export interface SourceProvenance {
  readonly agency: string;
  /** Inert recorded text. It is never fetched, opened or used to resolve media. */
  readonly url: string | null;
  readonly license: { readonly status: 'unknown' | 'permitted' | 'restricted'; readonly reference: string | null };
  readonly retrievedAt: string;
  readonly published: SourceDate | null;
  readonly observed: SourceDate | null;
  readonly frame: SourceFrame;
  readonly custodyReceiptSha256: string;
}
/** Lineage of a qualified stripped PNG derived from exactly one original. */
export interface SourcePreviewLineage {
  readonly asset: SourceAssetPin; readonly inputs: readonly SourceAssetPin[];
  readonly renderer: string; readonly rendererVersion: string; readonly rendererConfigSha256: string;
  readonly qualificationReceiptSha256: string; readonly sourceCropExtent: readonly string[] | null; readonly description: string;
}
export interface SourceDocument {
  readonly scope: { readonly workspaceId: string; readonly homeId: string };
  readonly documentId: string; readonly revision: number; readonly lifecycle: 'active' | 'tombstoned';
  readonly createdAt: string; readonly updatedAt: string; readonly lastAuditId: string;
  readonly title: string; readonly original: SourceAssetPin; readonly provenance: SourceProvenance;
  readonly preview: SourcePreviewLineage | null;
  readonly availability: { readonly original: SourceOriginalAvailability; readonly preview: SourcePreviewAvailability };
}
export interface SourceDocumentPage { readonly documents: readonly SourceDocument[]; readonly nextCursor: string | null }

/** One leased byte read. Its blob is available only while the frame is current. */
export interface SourceDocumentFrame {
  readonly lease: object;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly mode: 'original' | 'preview';
  readonly asset: SourceAssetPin;
  /** Server-measured type from the authenticated frame; previews are always image/png. */
  readonly measuredContentType: SourceDocumentMime;
}

export interface SourceDocumentReader {
  /** Identity of the current session/scope owner; null while none is bound. */
  owner(): object | null;
  /** Synchronous notice of every owner replacement or gap. */
  subscribeOwner(changed: () => void): () => void;
  list(cursor: string | null, signal: AbortSignal): Promise<SourceDocumentPage>;
  get(documentId: string, signal: AbortSignal): Promise<SourceDocument>;
  openOriginal(documentId: string, expectedRevision: number, signal: AbortSignal): Promise<SourceDocumentFrame>;
  openPreview(documentId: string, expectedRevision: number, signal: AbortSignal): Promise<SourceDocumentFrame>;
  isCurrent(frame: SourceDocumentFrame): boolean;
  getBlob(frame: SourceDocumentFrame): Blob | null;
  /** Called at most once, synchronously, when the frame stops being current. */
  subscribeInvalidation(frame: SourceDocumentFrame, changed: () => void): () => void;
  release(frame: SourceDocumentFrame): void;
  dispose(): void;
}

/** Host port. The reader module loads only when a Documents surface opens. */
export interface SourceDocumentsPort { createReader(): Promise<SourceDocumentReader> }
