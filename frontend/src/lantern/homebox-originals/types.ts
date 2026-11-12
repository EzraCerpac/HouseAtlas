import type { ReadyView, Scope } from '../../app/types';
import type { PinnedFileClient } from '../../api/pinned-file-client';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1, OfflineResult } from '../../offline/live-copy-types';

declare const frameBrand: unique symbol;
export interface HomeboxOriginalFrame { readonly [frameBrand]: true }
export type HomeboxOriginalSource = Pick<PinnedFileClient, 'getBindingIdentity' | 'getBindingScope' | 'discover'>;
export type HomeboxOriginalOpenResult =
  | { readonly status: 'ok'; readonly frame: HomeboxOriginalFrame }
  | { readonly status: 'busy' }
  | { readonly status: 'spent'; readonly outcome: 'success' | 'definitive-refusal' | 'unknown' }
  | { readonly status: 'unavailable' | 'unknown' | 'integrity' | 'retired' | 'aborted' | 'invalid' | 'missing' | 'limit' };
export type HomeboxRetentionReconciliation =
  | { readonly status: 'held'; readonly pin: Readonly<OfflineHomeboxPinV1> }
  | { readonly status: 'unresolved' }
  | { readonly status: 'unavailable' | 'retired' | 'integrity' | 'aborted' };
export interface HomeboxRetentionAttempt {
  readonly result: Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>>;
  /** Local reads only. Missing or another observation is unresolved, never proof of rollback. */
  reconcile(signal: AbortSignal): Promise<HomeboxRetentionReconciliation>;
}
export interface HomeboxOriginalReader {
  readonly scope: Readonly<Scope>;
  open(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<HomeboxOriginalOpenResult>;
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
