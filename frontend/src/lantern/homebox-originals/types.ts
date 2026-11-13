import type { ReadyView, Scope } from '../../app/types';
import type { PinnedFileClient } from '../../api/pinned-file-client';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1, OfflineHomeboxAvailability, OfflineResult } from '../../offline/live-copy-types';

declare const frameBrand: unique symbol;
export interface HomeboxOriginalFrame { readonly [frameBrand]: true }
export type HomeboxOriginalSource = Pick<PinnedFileClient, 'getBindingIdentity' | 'getBindingScope' | 'discover'>;
export type HomeboxOriginalOpenResult =
  | { readonly status: 'ok'; readonly frame: HomeboxOriginalFrame; readonly backing: 'memory' | 'exact-held' }
  | { readonly status: 'busy' }
  | { readonly status: 'spent'; readonly outcome: 'success' | 'definitive-refusal' | 'unknown' }
  | { readonly status: 'unavailable'; readonly reason?: 'bytes-released' | 'held-missing' | 'local-storage' | 'cancellation-ownership' }
  | { readonly status: 'resource'; readonly resource?: string }
  | { readonly status: 'unknown' | 'integrity' | 'retired' | 'aborted' | 'invalid' | 'missing' | 'limit' | 'settling' };
export type HomeboxOriginalJoinResult = HomeboxOriginalOpenResult | { readonly status: 'not-started' };
/** subscribe preserves its unsubscribe API; a second distinct callback throws this typed refusal. */
export interface HomeboxAdmissionError extends Error { readonly status: 'resource'; readonly resource: string }
export type HomeboxRetentionReconciliation =
  | { readonly status: 'held'; readonly pin: Readonly<OfflineHomeboxPinV1> }
  | { readonly status: 'unresolved' }
  | { readonly status: 'unavailable' | 'retired' | 'integrity' | 'aborted' };
export interface HomeboxRetentionAttempt {
  readonly result: Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>>;
  /** Local reads only. Missing is unresolved; another full pin is integrity, never rollback. */
  reconcile(signal: AbortSignal): Promise<HomeboxRetentionReconciliation>;
}
export interface HomeboxOriginalReader {
  readonly scope: Readonly<Scope>;
  open(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<HomeboxOriginalOpenResult>;
  /** Never dispatches an original read or storage write. */
  join(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<HomeboxOriginalJoinResult>;
  isCurrent(frame: HomeboxOriginalFrame): boolean;
  getBlob(frame: HomeboxOriginalFrame): Blob | null;
  subscribe(changed: () => void): () => void;
  /** One storage attempt, independent of the bulk preference and UI-close signal. */
  retain(frame: HomeboxOriginalFrame): OfflineResult<HomeboxRetentionAttempt>;
  release(frame: HomeboxOriginalFrame): void;
  /** Releases UI borrows; an admitted storage attempt keeps its own bounded borrow. */
  dispose(): void;
}
export interface HomeboxOriginalsPort {
  createReader(view: ReadyView, signal: AbortSignal): Promise<OfflineResult<HomeboxOriginalReader>>;
}
/** Internal integration pass. One leased preparation/pipeline; no caller-supplied authority or token. */
export interface HomeboxFillPass {
  readonly otherBytes: number;
  readonly budgetBytes: number;
  current(): boolean;
  installed(ref: OfflineHomeboxAttachmentRefV1): boolean;
  status(ref: OfflineHomeboxAttachmentRefV1): Promise<OfflineResult<OfflineHomeboxAvailability>>;
  retain(ref: OfflineHomeboxAttachmentRefV1): Promise<OfflineResult<OfflineHomeboxPinV1>>;
}
export interface HomeboxFillOutcome { readonly message: string; readonly complete: boolean }
