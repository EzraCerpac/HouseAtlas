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
/** Separate captured evidence-original identity; never a native Document v2 ID. */
export interface OfflineElectricalPinV1 {
  readonly source: 'electrical-evidence'; readonly buildingId: string;
  readonly evidenceId: string; readonly evidenceRevision: number; readonly assetId: string;
  readonly assetRevision: string; readonly byteSize: string; readonly sha256: string;
  readonly contentType: 'application/pdf';
}
export interface OfflineElectricalPageV1 {
  readonly sheetId: string; readonly title: string; readonly pdfPage: number; readonly sourceDate: string | null;
  readonly correlationId: string; readonly correlationSha256: string;
  readonly originalPhotoSha256: string; readonly renderedPhotoSha256: string;
}
export interface OfflineElectricalBuildingV1 {
  readonly buildingId: string; readonly capturedAt: string;
  readonly provenance: Readonly<{
    historicalRoomMappingReceipt: Readonly<{ id: string; sha256: string }>;
    fixtureLedgerSha256: string; supportOriginalSha256: string;
    currentNativeRoomReview: Readonly<{ id: string; sha256: string }>;
  }> | null;
  readonly documents: readonly Readonly<{ pin: OfflineElectricalPinV1; pages: readonly OfflineElectricalPageV1[] }>[];
}
export interface OfflineElectricalCatalogV1 {
  readonly version: 1; readonly capturedAt: string;
  /** Independently captured buildings, never a claim of whole-home enumeration. */
  readonly buildings: readonly OfflineElectricalBuildingV1[];
}
export type OfflineElectricalAvailability =
  | Readonly<{ availability: 'held'; bytes: number; pin: OfflineElectricalPinV1 }>
  | Readonly<{ availability: 'not-held' | 'failed-integrity'; bytes: number }>;
/** Exact HomeBox attachment association; never a native Document v2 or electrical identity. */
export interface OfflineHomeboxAttachmentRefV1 {
  readonly source: 'homebox-attachment'; readonly sourceInstanceId: string; readonly collectionId: string;
  readonly entityId: string; readonly attachmentId: string;
}
/** One finite server-local capture of that attachment. observationId is a random response label and the
 * registration fields are configuration provenance: neither is a provider revision or current membership.
 * contentType is measured locally (PDF signature only); sourceContentType stays descriptive source text. */
export interface OfflineHomeboxPinV1 extends OfflineHomeboxAttachmentRefV1 {
  readonly observationId: string; readonly sourceRegistrationVersion: number; readonly sourceRegistrationSha256: string;
  readonly sha256: string; readonly bytes: number; readonly contentType: 'application/pdf' | null;
  readonly sourceContentType: string | null;
  readonly beforeRetrievedAt: string; readonly bodyRetrievedAt: string; readonly afterRetrievedAt: string;
}
export type OfflineHomeboxAvailability =
  | Readonly<{ availability: 'held'; bytes: number; pin: OfflineHomeboxPinV1 }>
  | Readonly<{ availability: 'not-held' | 'failed-integrity'; bytes: number | null }>;
export type OfflineFailure ='unavailable' | 'retired' | 'missing' | 'integrity' | 'quota' | 'limit' | 'invalid' | 'aborted' | 'uncertain';
export type OfflineResult<T> = Readonly<{ status: 'ok'; value: T }> | Readonly<{ status: OfflineFailure }>;
/** Opaque local historical selection, with no live authorization. */
export interface OfflineCopyHandle { readonly kind: 'stored-copy' }
export interface OfflineReadPort {
  readLast(signal: AbortSignal): Promise<OfflineResult<{ readonly handle: OfflineCopyHandle; readonly snapshot: OfflineViewSnapshotV1 }>>;
  documentStatus(handle: OfflineCopyHandle, reference: OfflineDocumentReferenceV1, signal: AbortSignal): Promise<OfflineResult<OfflineDocumentAvailability>>;
  atlasReference(handle: OfflineCopyHandle, signal: AbortSignal): Promise<OfflineResult<OfflineAtlasReferenceV1 | null>>;
  readCatalog(handle: OfflineCopyHandle, signal: AbortSignal): Promise<OfflineResult<OfflineCatalogV1>>;
  readDocument(handle: OfflineCopyHandle, pin: OfflineDocumentPinV1, signal: AbortSignal): Promise<OfflineResult<Blob>>;
  readElectricalCatalog(handle: OfflineCopyHandle, signal: AbortSignal): Promise<OfflineResult<OfflineElectricalCatalogV1>>;
  electricalStatus(handle: OfflineCopyHandle, pin: OfflineElectricalPinV1, signal: AbortSignal): Promise<OfflineResult<OfflineElectricalAvailability>>;
  readElectricalDocument(handle: OfflineCopyHandle, pin: OfflineElectricalPinV1, signal: AbortSignal): Promise<OfflineResult<Blob>>;
  /** Held observation for one exact association still present in the held view; no catalog completeness. */
  homeboxStatus(handle: OfflineCopyHandle, ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<OfflineResult<OfflineHomeboxAvailability>>;
  readHomeboxDocument(handle: OfflineCopyHandle, pin: OfflineHomeboxPinV1, signal: AbortSignal): Promise<OfflineResult<Blob>>;
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
