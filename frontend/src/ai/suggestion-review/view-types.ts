/** LOCAL presentation seam only. Not a wire envelope, validator or approval contract.
 * Adapt only the shared source writer's validated proposal/evidence into this shape. */
export type SuggestionKind = 'inventory' | 'document';
export interface SuggestionSourceView {
  readonly key: string; readonly label: string; readonly recordVersion: string;
  readonly sourceDate: string | null; readonly retrievedAt: string | null;
  readonly page: number | null; readonly section: string | null; readonly excerpt: string;
  readonly freshness: 'snapshot-current' | 'stale' | 'unknown';
  readonly original: 'available' | 'unavailable' | 'withdrawn';
}
export interface SuggestionFieldView {
  readonly key: string; readonly label: string; readonly current: string | null;
  readonly proposed: string; readonly reason: string; readonly uncertainty: string;
  readonly evidenceKeys: readonly string[];
}
export interface SuggestionCandidateView {
  readonly key: string; readonly label: string;
  readonly relation: 'possible-duplicate' | 'same-product' | 'proposed-association';
  readonly reason: string; readonly uncertainty: string; readonly evidenceKeys: readonly string[];
}
export interface SuggestionReviewView {
  /** Replace for EVERY account/home/selection generation, including A-B-A. */
  readonly context: object;
  readonly key: string; readonly revision: string; readonly sourceSetRevision: string;
  readonly kind: SuggestionKind; readonly title: string;
  readonly sources: readonly SuggestionSourceView[];
  readonly fields: readonly SuggestionFieldView[];
  readonly candidates: readonly SuggestionCandidateView[];
  readonly uncertainty: readonly string[];
  /** Raw model score, if supplied; never a probability or authority. */
  readonly uncalibratedScore: string | null;
}
export interface SuggestionReviewContext {
  readonly context: object; readonly proposalRevision: string; readonly sourceSetRevision: string;
  readonly availability: 'ready' | 'offline' | 'disabled' | 'unavailable';
}
export interface SuggestionReviewIntent {
  readonly kind: 'suggestion-review-intent'; readonly authority: 'none';
  readonly intentId: string; readonly context: object;
  readonly proposalKey: string; readonly proposalRevision: string; readonly sourceSetRevision: string;
  readonly action: 'accept-for-review' | 'reject';
  readonly fields: readonly { readonly key: string; readonly value: string; readonly edited: boolean }[];
  readonly candidateKeys: readonly string[];
}
export interface SuggestionReviewPorts {
  /** Side-effect-free; supplied by the current authenticated/source owner. */
  current(): SuggestionReviewContext | null;
  subscribe(changed: () => void): () => void;
  /** Read-only check of exact revisions, scope, access and original availability.
   * A current result grants no approval or mutation authority. */
  recheck(view: SuggestionReviewView, signal: AbortSignal): Promise<'current' | 'stale' | 'withdrawn' | 'unavailable'>;
  /** Resolve the exact admitted original/version/page through its existing owner.
   * Never follow a model URL or substitute another page. May inspect historical evidence. */
  inspectSource(view: SuggestionReviewView, source: SuggestionSourceView, signal: AbortSignal): Promise<void>;
  /** A delivery acknowledgement is NOT a committed domain outcome. Owner revalidates
   * permissions/revisions and stages the existing workflow separately. No auto replay. */
  onIntent(intent: SuggestionReviewIntent): void | Promise<void>;
}
export type SuggestionReviewPhase = 'reviewing' | 'checking' | 'inspecting' | 'stale' | 'unavailable'
  | 'superseded' | 'sent' | 'rejected' | 'handoff-unconfirmed' | 'closed';
export interface SuggestionReviewSnapshot {
  readonly phase: SuggestionReviewPhase; readonly message: string;
  readonly view: SuggestionReviewView | null;
  readonly fields: readonly { readonly key: string; readonly value: string; readonly selected: boolean; readonly edited: boolean }[];
  readonly candidateKeys: readonly string[];
}
