import type { License, SourceRef } from '../api/generated/contracts.ts';
import type { PlaceEditAdmission, UploadPlaceEvidence } from '../app/editing.ts';

/** Host-owned, non-secret boundary. Never put CSRF, cookies or session IDs here. */
export interface DraftBoundary {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly homeId: string;
  /** Memory-only identity of the currently verified application session. */
  readonly sessionEpoch: object;
}
export interface CaptureSelection {
  /** Exact structural seam with capture-evidence/EvidenceSelection, pinned in
   * the donor handoff; no shared frontend import before coordinated composition. */
  readonly original: File;
  readonly file: File;
  readonly capture: DraftCapture;
}
export interface DraftForm {
  readonly statement: string;
  readonly sourceLicense: License;
  readonly reason: string;
}
export interface DraftOwner {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly homeId: string;
}
export interface DraftCapture {
  readonly schemaVersion: 1;
  readonly selectionMethod: 'camera-request' | 'photo-picker' | 'file-picker';
  /** Local claimed selection time, not a device capture/source timestamp. */
  readonly selectedAt: string;
  readonly filename: string;
  readonly reportedContentType: string;
  readonly byteOrigin: 'browser-returned-unmodified';
}
export type DraftUploadIntent = UploadPlaceEvidence & { readonly capture: DraftCapture };
export interface DraftAttempt {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly startedAt: string;
}
/** Internal IndexedDB row. It contains no server record/admission/credentials. */
export interface DraftRow {
  readonly format: 'houseatlas-local-capture-draft/1';
  readonly id: string;
  readonly owner: DraftOwner;
  readonly targetSourceRef: SourceRef;
  readonly recordId: string;
  readonly original: Blob;
  readonly contentType: string;
  readonly lastModified: number;
  /** SHA-256 of browser-returned bytes; not proof of device originality. */
  readonly sha256: string;
  readonly capture: DraftCapture;
  readonly form: DraftForm;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: 'unsent' | 'outcome-unknown';
  readonly attempt: DraftAttempt | null;
}
export interface DraftSummary {
  readonly id: string;
  readonly targetSourceRef: SourceRef;
  readonly recordId: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: DraftRow['state'];
  readonly expired: boolean;
}
export interface DraftReview {
  /** Opaque one-use memory handle; no caller-supplied replacement is accepted. */
  readonly token: object;
  readonly file: File;
  readonly form: DraftForm;
  readonly targetSourceRef: SourceRef;
  readonly recordId: string;
  readonly capture: DraftCapture;
  readonly sha256: string;
}
export interface DraftSubmission {
  readonly draftId: string;
  readonly capture: DraftCapture;
  readonly sha256: string;
  /** One-use synchronous handoff, immediately before the host invokes upload.
   * Calling this does not submit. The host must never copy/retry its result. */
  takeForForegroundSubmit(): DraftUploadIntent;
}
export interface DraftUnknownInspection {
  readonly draftId: string;
  readonly attempt: DraftAttempt;
  readonly targetSourceRef: SourceRef;
  readonly recordId: string;
  readonly sha256: string;
  /** Fresh saved information is observation only, not proof of this outcome. */
  readonly savedPlace: PlaceEditAdmission | null;
  readonly outcome: 'unknown';
  readonly retrySafety: 'not-established';
}
export interface DraftHost {
  /** Must fail closed while the canonical session read is pending/unavailable. */
  current(): DraftBoundary | null;
  /** Fresh canonical session GET; updates host current(), preserves the epoch
   * only for the same verified session. No auth material enters this module. */
  refreshBoundary(signal: AbortSignal): Promise<DraftBoundary | null>;
  foreground(): boolean;
  /** Genuine fresh editing-client read, never a cached or stored admission. */
  loadPlace(source: SourceRef, signal: AbortSignal): Promise<PlaceEditAdmission | null>;
  /** Actual schema/correlation validator for the server's upload result. */
  validateAcknowledgement(result: unknown, intent: UploadPlaceEvidence): void;
}
/** Every mutation callback is synchronous, atomic, and serialized across tabs. */
export interface DraftStore {
  read(): Promise<readonly DraftRow[]>;
  change<T>(edit: (rows: readonly DraftRow[]) => { rows: readonly DraftRow[]; value: T }): Promise<T>;
  close(): void;
}

export const DRAFT_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  count: 4,
  metadataBytes: 64 * 1024,
  unsentLifetimeMs: 7 * 24 * 60 * 60 * 1000,
});
