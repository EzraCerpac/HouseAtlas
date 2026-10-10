import type { createCaptureDrafts } from '../capture-drafts/controller';
import type { DraftBoundary, DraftReview } from '../capture-drafts/types';
import type { SourceRef } from '../api/generated/contracts';
import type { StockResultEnvelope } from '../webmcp/stock';

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
  submit(review: DraftReview, target: SourceRef, recordId: string, signal: AbortSignal): Promise<{
    result: StockResultEnvelope;
    localCleanup: 'removed' | 'unconfirmed';
  }>;
}

export function sameTarget(a: SourceRef, b: SourceRef): boolean {
  return a.workspaceId === b.workspaceId && a.homeId === b.homeId
    && a.key.sourceInstanceId === b.key.sourceInstanceId && a.key.collectionId === b.key.collectionId
    && a.key.sourceKind === b.key.sourceKind && a.key.externalId === b.key.externalId;
}
