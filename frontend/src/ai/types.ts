/** AT42 proposal: reconcile these boundary types with AT51 generated contracts. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ConnectionSnapshot {
  readonly method: 'sign-in-with-chatgpt' | 'api-key' | 'local-runtime';
  readonly eligibility: 'unknown' | 'eligible' | 'ineligible' | 'not-applicable';
  readonly permission: 'unknown' | 'granted' | 'denied' | 'not-applicable';
  readonly authorization: 'unconfigured' | 'sign-in-required' | 'connected' | 'expired';
  readonly runtime: {
    readonly kind: 'hosted' | 'local';
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

export type AiErrorCode =
  | 'connection-unavailable' | 'invalid-input' | 'invalid-catalog' | 'invalid-provider-output'
  | 'unknown-tool' | 'limit-reached' | 'cancel-requested' | 'provider-unavailable'
  | 'usage-limit-reached' | 'domain-unavailable';

export type RunOutcome =
  | { readonly status: 'completed'; readonly text: string; readonly usage: Usage }
  | { readonly status: 'review-required'; readonly calls: readonly ToolCall[]; readonly usage: Usage }
  | { readonly status: 'cancelled'; readonly usage: Usage }
  | { readonly status: 'stopped'; readonly usage: Usage }
  | { readonly status: 'failed'; readonly reason: AiErrorCode; readonly usage: Usage };

export interface CancelReceipt {
  readonly requestId: string;
  readonly status: 'requested' | 'confirmed' | 'already-finished' | 'unsupported';
}

/**
 * A caller supplies an already-scoped client. This island has no provider URLs,
 * credentials, login flow, tool execution, or transport implementation.
 * A rejected run does not establish that inference stopped.
 */
export interface AiClient {
  connection(signal: AbortSignal): Promise<ConnectionSnapshot>;
  run(input: { readonly requestId: string; readonly prompt: string }, signal: AbortSignal): Promise<RunOutcome>;
  cancel(requestId: string): Promise<CancelReceipt>;
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

export type RequestState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' | 'unconfirmed'; readonly requestId: string; readonly cancellation: CancellationState }
  | { readonly status: 'finished'; readonly requestId: string; readonly outcome: RunOutcome }
  | { readonly status: 'start-unavailable' };

export interface AiSessionState {
  readonly connection: ConnectionState;
  readonly request: RequestState;
}
