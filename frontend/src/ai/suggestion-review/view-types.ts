/** LOCAL presentation seam only. Not a wire envelope, validator or approval contract.
 * Adapt only the shared source writer's validated proposal/evidence into this shape. */
export type SuggestionKind = 'inventory' | 'document' | 'maintenance' | 'answer' | 'contradictions';
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
/** Private presentation values matching canonical interval/urgency semantics; no wire envelope. */
export type MaintenanceUnit = 'days' | 'weeks' | 'months' | 'years' | 'usage-hours';
export type MaintenanceUrgency = 'unknown' | 'routine' | 'review-soon';
export type MaintenanceIntervalView =
  | Readonly<{ kind: 'periodic'; every: number; unit: MaintenanceUnit }>
  | Readonly<{ kind: 'conditional'; condition: string }>
  | Readonly<{ kind: 'unknown' }>;
export interface MaintenanceTaskView {
  readonly key: string; readonly targetKey: string; readonly targetLabel: string;
  readonly title: string; readonly interval: MaintenanceIntervalView;
  readonly conditions: readonly string[]; readonly urgency: MaintenanceUrgency;
  readonly reason: string; readonly uncertainty: string; readonly evidenceKeys: readonly string[];
  /** Exact source-owned baseline text or unknown. Never an inferred due date. */
  readonly baselineDate: string | null;
}
export type MaintenanceIntervalDraft =
  | Readonly<{ kind: 'periodic'; every: string; unit: MaintenanceUnit | null }>
  | Readonly<{ kind: 'conditional'; condition: string }>
  | Readonly<{ kind: 'unknown' }>;
export interface MaintenanceTaskDraft {
  readonly key: string; readonly selected: boolean; readonly title: string;
  readonly interval: MaintenanceIntervalDraft; readonly conditions: readonly string[];
  readonly urgency: MaintenanceUrgency; readonly valid: boolean; readonly edited: boolean;
}
export type MaintenanceEditedField = 'title' | 'interval' | 'conditions' | 'urgency';
export interface MaintenanceTaskReviewIntent {
  readonly key: string; readonly targetKey: string; readonly title: string;
  readonly interval: MaintenanceIntervalView; readonly conditions: readonly string[];
  readonly urgency: MaintenanceUrgency; readonly editedFields: readonly MaintenanceEditedField[];
}
/** Read-only, owner-admitted answer DATA. Ranking is order, never authority. */
export type AnswerRoute = 'inventory' | 'documents' | 'maintenance' | 'electrical' | 'network' | 'clarify' | 'unknown';
export interface AnswerStatementView {
  readonly key: string; readonly text: string; readonly reason: string;
  readonly uncertainty: string; readonly evidenceKeys: readonly string[];
}
export interface CitedAnswerView {
  readonly route: AnswerRoute; readonly coverage: 'partial' | 'no-answer';
  /** Local keys bound by the source adapter to ranked_refs; preserve array order. */
  readonly rankedCandidates: readonly { readonly key: string; readonly label: string }[];
  readonly statements: readonly AnswerStatementView[];
  readonly missingEvidence: readonly string[];
}
/** Read-only comparison candidates supplied by the canonical source owner. */
export type ContradictionPattern = 'incompatible-location' | 'conflicting-association' | 'possible-supersession';
export type QualitativeUncertainty = 'tentative' | 'ambiguous' | 'unknown';
export interface ComparisonAssertionView {
  /** Bind to claim_ref and source_ref respectively; not identity or read grants. */
  readonly key: string; readonly inputKey: string;
  readonly text: string; readonly uncertainty: QualitativeUncertainty;
  /** Known fact time from the original owner or null; never copied from retrieval. */
  readonly factDate: string | null;
  readonly evidenceKeys: readonly string[];
}
export interface ComparisonFindingView {
  /** Owner-supplied finding binding. This view performs no durable deduplication. */
  readonly key: string; readonly pattern: ContradictionPattern;
  readonly assertions: readonly ComparisonAssertionView[];
  readonly rationale: string; readonly uncertainty: QualitativeUncertainty;
}
export interface ContradictionsView {
  readonly findings: readonly ComparisonFindingView[];
  readonly missingEvidence: readonly string[];
}
export interface SuggestionReviewView {
  /** Replace for EVERY account/home/selection generation, including A-B-A. */
  readonly context: object;
  readonly key: string; readonly revision: string; readonly sourceSetRevision: string;
  readonly kind: SuggestionKind; readonly title: string;
  /** Present only for maintenance. Other kinds keep their original shape. */
  readonly maintenance?: readonly MaintenanceTaskView[];
  /** Present only for answer. Never contributes an intent or editable state. */
  readonly answer?: CitedAnswerView;
  /** Present only for contradictions; inspection/dismissal only, no intent. */
  readonly contradictions?: ContradictionsView;
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
  /** Present only for maintenance; reject carries an empty list. */
  readonly maintenance?: readonly MaintenanceTaskReviewIntent[];
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
  readonly maintenance: readonly MaintenanceTaskDraft[];
}
