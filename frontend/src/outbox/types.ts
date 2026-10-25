/** One edit waiting to reach the server, or recently sent. The body is the
 * exact stock v3 envelope prepared when the person made the edit: its
 * idempotency key makes a resend replay the first commit instead of writing
 * twice, and its revision preconditions turn a change made elsewhere into a
 * conflict instead of an overwrite. */
export interface OutboxEntry {
  readonly id: string;
  /** Creation order; entries send oldest first. */
  readonly seq: number;
  readonly owner: OutboxOwner;
  readonly kind: string;
  /** What the person did, in their words: "Rename Schuur to Werkplaats". */
  readonly label: string;
  readonly target: Readonly<{ recordType: string; recordId: string }>;
  /** The fields the person chose, kept so "Keep mine" can prepare them again
   * against the current record. */
  readonly intent: Readonly<Record<string, string>>;
  readonly commandId: string;
  readonly requestId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly state: OutboxState;
  /** Dispatched at least once. A waiting entry that was sent has an unknown
   * outcome; its next send is a replay check as much as a write. */
  readonly sent: boolean;
  readonly problem: OutboxProblem | null;
  readonly settledAt: string | null;
}
export type OutboxState = 'waiting' | 'sending' | 'needs-you' | 'synced';
/** changed: the record changed elsewhere since the edit. removed: it no
 * longer exists. denied: this account may no longer make the change.
 * rejected: the server refused the change itself. */
/** unconfirmed: sent, but the server refuses to say whether it arrived. */
export type OutboxProblem = 'changed' | 'removed' | 'denied' | 'rejected' | 'unconfirmed';
export interface OutboxOwner {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly homeId: string;
}
/** A freshly prepared command for the outbox. */
export interface OutboxSubmission {
  readonly kind: string;
  readonly label: string;
  readonly target: OutboxEntry['target'];
  readonly intent: OutboxEntry['intent'];
  readonly commandId: string;
  readonly requestId: string;
  readonly body: string;
}
/** The signed-in person and home the outbox may send for right now. */
export interface OutboxContext extends OutboxOwner {
  readonly csrfToken: string;
}
/** Per kind of edit: how to show the record as it is now, and how to prepare
 * the same edit again against it when the person keeps their version. */
export interface OutboxKind {
  current(entry: OutboxEntry, signal: AbortSignal): Promise<string | null>;
  rebase(entry: OutboxEntry, signal: AbortSignal): Promise<Pick<OutboxSubmission, 'requestId' | 'body' | 'label'>>;
}
