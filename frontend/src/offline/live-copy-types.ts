import type { Cache, Entry, Scope } from '../app/types';
/** Historical display data only. Never an AtlasView, session or admission. */
export interface OfflineDisplayData {
  readonly scope: Readonly<Scope>; readonly homeLabel: string; readonly sourceNow: string;
  readonly entries: readonly OfflineEntry[];
  readonly caches: readonly Cache[];
}
export type OfflineEntry = Omit<Entry, 'attachments' | 'nativeLinks'> & {
  readonly attachments: readonly OfflineAttachment[];
};
export interface OfflineAttachment {
  readonly attachmentId: string; readonly title: string | null;
  readonly kind: 'stored-file' | 'external-link'; readonly archived?: boolean;
  readonly contentType?: string | null; readonly byteSize?: string | null;
}
export interface OfflineViewSnapshotV1 {
  readonly version: 1; readonly kind: 'stored-display'; readonly freshness: 'stale';
  readonly actorRevision: string; readonly snapshotRevision: string; readonly capturedAt: string;
  readonly payloadSha256: string; readonly data: OfflineDisplayData;
  readonly coverage: Readonly<{ entries: 'captured'; geometry: 'unavailable'; history: 'unavailable';
    topology: 'unavailable'; electrical: 'unavailable'; nativeCatalog: 'separate-read' }>;
}
export interface OfflineDocumentPinV1 {
  readonly documentId: string; readonly documentRevision: number; readonly assetId: string;
  readonly assetRevision: number; readonly sha256: string; readonly bytes: number;
  readonly contentType: string;
}
export type OfflineDocumentReferenceV1 = Omit<OfflineDocumentPinV1, 'contentType'>;
export type OfflineDocumentAvailability =
  | Readonly<{ availability: 'held'; bytes: number; pin: OfflineDocumentPinV1 }>
  | Readonly<{ availability: 'not-held' | 'failed-integrity'; bytes: number }>;
/** Link only; opening still revalidates the existing last-Atlas pointer and hashes its bytes. */
export interface OfflineAtlasReferenceV1 {
  readonly version: 1; readonly scope: Readonly<Scope>; readonly publicationId: string;
  readonly manifestSha256: string; readonly atlasActorRevision: string;
}
export interface OfflineCatalogItemV1 {
  readonly documentId: string; readonly documentRevision: number; readonly title: string;
  readonly lifecycle: 'active' | 'tombstoned';
  readonly assetId: string; readonly assetRevision: number; readonly sha256: string; readonly bytes: number;
  /** Availability at capture time, not a current server promise. */
  readonly recordedAvailability: string;
}
export interface OfflineCatalogV1 {
  readonly version: 1; readonly capturedAt: string;
  readonly completeness: 'captured-pages' | 'captured-complete';
  readonly documents: readonly OfflineCatalogItemV1[];
}
export type OfflineFailure = 'unavailable' | 'retired' | 'missing' | 'integrity' | 'quota' | 'limit' | 'invalid' | 'aborted';
export type OfflineResult<T> = Readonly<{ status: 'ok'; value: T }> | Readonly<{ status: OfflineFailure }>;
/** Opaque local historical selection, with no live authorization. */
export interface OfflineCopyHandle { readonly kind: 'stored-copy' }
export interface OfflineReadPort {
  readLast(signal: AbortSignal): Promise<OfflineResult<{ readonly handle: OfflineCopyHandle; readonly snapshot: OfflineViewSnapshotV1 }>>;
  documentStatus(handle: OfflineCopyHandle, reference: OfflineDocumentReferenceV1, signal: AbortSignal): Promise<OfflineResult<OfflineDocumentAvailability>>;
  atlasReference(handle: OfflineCopyHandle, signal: AbortSignal): Promise<OfflineResult<OfflineAtlasReferenceV1 | null>>;
  readCatalog(handle: OfflineCopyHandle, signal: AbortSignal): Promise<OfflineResult<OfflineCatalogV1>>;
  readDocument(handle: OfflineCopyHandle, pin: OfflineDocumentPinV1, signal: AbortSignal): Promise<OfflineResult<Blob>>;
  subscribe(changed: () => void): () => void;
}
export interface OfflineStorageStatus {
  readonly bytes: number; readonly documents: number; readonly budgetBytes: number;
  readonly persistence: 'unknown' | 'granted' | 'not-granted' | 'unsupported';
  readonly estimatedUsage: number | null; readonly estimatedQuota: number | null;
}
export interface OfflineStoragePort {
  status(signal: AbortSignal): Promise<OfflineResult<OfflineStorageStatus>>;
  /** Explicit caller action only; never called by construction, status or retention. */
  requestPersistence(signal: AbortSignal): Promise<OfflineResult<OfflineStorageStatus['persistence']>>;
  clear(): Promise<OfflineResult<null>>;
}
export type OfflineTable = 'control' | 'metadata' | 'bytes';
export interface OfflineTransaction {
  get<T>(table: OfflineTable, key: string): Promise<T | undefined>;
  list<T>(table: OfflineTable): Promise<readonly { readonly key: string; readonly value: T }[]>;
  put(table: OfflineTable, key: string, value: unknown): Promise<void>;
  remove(table: OfflineTable, key: string): Promise<void>;
  empty(table: OfflineTable): Promise<void>;
}
/** Callback may await only transaction operations, never crypto/transport/timers. */
export interface OfflineBackend {
  transaction<T>(write: boolean, work: (tx: OfflineTransaction) => Promise<T>): Promise<T>;
  close(): void;
}
