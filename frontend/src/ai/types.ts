/** AT42 boundary proposal: reconcile with AT51 generated stock.2/wire3 contracts. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type RuntimeRoute = 'unset' | 'local-sign-in-helper' | 'issued-website-client' | 'local-inference-companion';

export interface ConnectionSnapshot {
  readonly method: 'sign-in-with-chatgpt' | 'api-key' | 'local-runtime';
  readonly account: { readonly accountId: string; readonly workspaceId: string; readonly label: string } | null;
  readonly eligibility: 'unknown' | 'eligible' | 'ineligible' | 'not-applicable';
  readonly permission: 'unknown' | 'granted' | 'denied' | 'not-applicable';
  readonly authorization: 'unconfigured' | 'sign-in-required' | 'connected' | 'expired';
  readonly paidUseAdmission: 'held' | 'verified-zero-paid-use' | 'explicit-spend-approval';
  readonly runtime: {
    readonly kind: 'hosted' | 'local';
    readonly route: RuntimeRoute;
    readonly qualification: 'held' | 'qualified';
    readonly availability: 'unknown' | 'ready' | 'sleeping' | 'unreachable';
    readonly checkedAt: string | null;
  };
  readonly usageSupported: boolean;
}

export interface Usage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
}

/** Credential-free stock wire3 challenge projection; the server retains authority. */
export interface ReviewChallenge {
  readonly challengeId: string;
  readonly commandId: string;
  readonly requestDigest: string;
  readonly targetDigest: string;
  readonly impactId: string;
  readonly impactDigest: string;
  readonly affectedTargets: readonly JsonValue[];
  readonly recoverability: 'reversible-tombstone' | 'provider-permanent' | 'unresolved-provider-effects';
  readonly expiresAt: string;
}

export type AiErrorCode =
  | 'connection-unavailable' | 'invalid-input' | 'invalid-catalog' | 'invalid-provider-output'
  | 'unknown-tool' | 'limit-reached' | 'cancel-requested' | 'provider-unavailable'
  | 'usage-limit-reached' | 'domain-unavailable';

export interface ReviewRequired {
  readonly status: 'review-required';
  readonly continuationId: string;
  readonly calls: readonly ToolCall[];
  readonly reviews: readonly ReviewChallenge[];
  readonly usage: Usage;
}

export interface DomainHeld {
  readonly status: 'domain-held';
  readonly operationId: string | null;
  /** Ordered correlations retained by the host, including earlier operations. */
  readonly operationIds: readonly string[];
  readonly state: 'prepared' | 'queued' | 'dispatching' | 'rejected-before-dispatch' | 'partial' | 'unknown-held';
  readonly usage: Usage;
}

export type RunOutcome =
  | { readonly status: 'completed'; readonly text: string; readonly usage: Usage }
  | ReviewRequired
  | DomainHeld
  | { readonly status: 'cancelled'; readonly usage: Usage }
  | { readonly status: 'stopped'; readonly usage: Usage }
  | { readonly status: 'failed'; readonly reason: AiErrorCode; readonly operationIds: readonly string[]; readonly usage: Usage };

export interface CancelReceipt {
  readonly requestId: string;
  readonly status: 'requested' | 'confirmed' | 'already-finished' | 'unsupported';
}

export type ConnectionAction =
  | { readonly action: 'connect'; readonly route: Exclude<RuntimeRoute, 'unset'> }
  | { readonly action: 'consent' | 'disconnect' | 'manage-usage' };

export interface ConnectionActionResult {
  readonly actionId: string;
  readonly status: 'completed' | 'pending' | 'unconfirmed';
  readonly snapshot: ConnectionSnapshot;
}

export interface ConnectionActionRequest {
  readonly actionId: string;
  readonly command: ConnectionAction;
}

export interface HumanReviewResult {
  readonly status: 'pending' | 'closed' | 'ready-to-resume';
}

export interface ReviewInput {
  readonly requestId: string;
  readonly continuationId: string;
}

export type RequestStatus =
  | { readonly requestId: string; readonly status: 'running' | 'unconfirmed' }
  | { readonly requestId: string; readonly status: 'finished'; readonly outcome: RunOutcome };

/**
 * The host supplies authenticated, scoped ports. Tokens, provider URLs, receipt
 * generation and authority never enter this island. Review opens the separate
 * trusted human UI; only its ready result initiates the existing continuation.
 */
export interface AiClient {
  connection(signal: AbortSignal): Promise<ConnectionSnapshot>;
  connectionAction(input: ConnectionActionRequest, signal: AbortSignal): Promise<ConnectionActionResult>;
  connectionActionStatus(actionId: string, signal: AbortSignal): Promise<ConnectionActionResult>;
  run(input: { readonly requestId: string; readonly prompt: string }, signal: AbortSignal): Promise<RunOutcome>;
  cancel(requestId: string): Promise<CancelReceipt>;
  openReview(input: ReviewInput, signal: AbortSignal): Promise<HumanReviewResult>;
  resume(input: ReviewInput, signal: AbortSignal): Promise<RunOutcome>;
  requestStatus(requestId: string, signal: AbortSignal): Promise<RequestStatus>;
}

export type ConnectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'available'; readonly snapshot: ConnectionSnapshot }
  | { readonly status: 'unavailable' };

export type CancellationState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending' }
  | { readonly status: 'received'; readonly receipt: CancelReceipt }
  | { readonly status: 'unavailable' };

export type ActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'working' }
  | { readonly status: 'pending' | 'unconfirmed' | 'unavailable' };

export type ConnectionActionState = ActionState & {
  readonly action: ConnectionAction['action'] | null;
  readonly actionId: string | null;
};

/** Browser progress only; the host owns each scoped action's completion. */
export interface UnresolvedConnectionAction {
  readonly actionId: string;
  readonly action: ConnectionAction['action'];
  readonly status: 'pending' | 'unconfirmed';
  /** Last accepted host receipt; local transport failure is not an observation. */
  readonly hostStatus: 'pending' | 'unconfirmed' | null;
}

export type RequestState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' | 'unconfirmed'; readonly requestId: string; readonly cancellation: CancellationState }
  | { readonly status: 'awaiting-review'; readonly requestId: string; readonly outcome: ReviewRequired; readonly cancellation: CancellationState }
  | { readonly status: 'domain-held'; readonly requestId: string; readonly outcome: DomainHeld; readonly cancellation: CancellationState }
  | { readonly status: 'finished'; readonly requestId: string; readonly outcome: RunOutcome }
  | { readonly status: 'start-unavailable' };

export interface AiSessionState {
  readonly connection: ConnectionState;
  readonly request: RequestState;
  readonly connectionAction: ConnectionActionState;
  readonly reviewAction: ActionState;
  readonly recoveryAction: ActionState;
}
