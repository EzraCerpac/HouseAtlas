import type { createCaptureDrafts } from '../capture-drafts/controller';
import type { DraftBoundary, DraftReview } from '../capture-drafts/types';
import type { SourceRef } from '../api/generated/contracts';
import type { StockResultEnvelope } from '../webmcp/stock';
import type { NativeEvidencePending } from '../api/native-evidence-client';

type Controller = ReturnType<typeof createCaptureDrafts>;
export interface CaptureDraftPort {
  current(): DraftBoundary | null;
  unavailableReason(): string | null;
  prepare(signal: AbortSignal): Promise<DraftBoundary | null>;
  operation(): { controller: AbortController; release(): void };
  subscribeInvalidation(listener: (reason: 'boundary' | 'review') => void): () => void;
  invalidate(): void;
  save: Controller['save'];
  list: Controller['list'];
  review: Controller['review'];
  inspectUnknown: Controller['inspectUnknown'];
  discard: Controller['discard'];
  clearBeforeSignOut(): Promise<void>;
  /** A null target is a native Atlas place; its result is the native owner's attempt. */
  submit(review: DraftReview, target: SourceRef | null, recordId: string, signal: AbortSignal): Promise<DraftCompletion>;
}
export interface DraftCompletion {
  committed: boolean;
  result: StockResultEnvelope | NativeEvidencePending;
  localCleanup: 'removed' | 'unconfirmed';
}

/** Null is a native Atlas place, which matches only another null target. */
export function sameTarget(a: SourceRef | null, b: SourceRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.workspaceId === b.workspaceId && a.homeId === b.homeId
    && a.key.sourceInstanceId === b.key.sourceInstanceId && a.key.collectionId === b.key.collectionId
    && a.key.sourceKind === b.key.sourceKind && a.key.externalId === b.key.externalId;
}
