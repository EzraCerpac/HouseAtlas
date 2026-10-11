import { AiPanelView } from './AiPanel.js';
import type { AiPanelViewProps } from './AiPanel.js';
import type { AiSessionState, ConnectionSnapshot, JsonValue } from './types.js';

/** Safe initial host snapshot: sign-in does not imply runtime or paid-use admission. */
export const heldConnection: ConnectionSnapshot = {
  method: 'sign-in-with-chatgpt', account: null, eligibility: 'unknown', permission: 'unknown',
  authorization: 'unconfigured', paidUseAdmission: 'held',
  runtime: { kind: 'hosted', route: 'unset', qualification: 'held', availability: 'unknown', checkedAt: null },
  usageSupported: false,
};

/** Healthy synthetic data only; qualification and paid-use facts are fixture values. */
export const syntheticConnection: ConnectionSnapshot = {
  method: 'local-runtime', account: { accountId: 'synthetic-account', workspaceId: 'synthetic-workspace', label: 'Synthetic account' },
  eligibility: 'not-applicable', permission: 'not-applicable', authorization: 'connected',
  paidUseAdmission: 'verified-zero-paid-use',
  runtime: { kind: 'local', route: 'local-inference-companion', qualification: 'qualified', availability: 'ready', checkedAt: '2026-10-06T10:00:00Z' },
  usageSupported: true,
};

/** Actual stock.2 wire3 atlas_records arm; no receipt or domain execution. */
export const syntheticCircuitRequest: JsonValue = {
  schemaVersion: 3, commandId: 'atlas.circuit.create',
  context: { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002' },
  target: { authority: 'atlas', recordType: 'circuit', recordId: '00000000-0000-4000-8000-000000001000' },
  payload: { label: null, panel: null, evidenceIds: ['00000000-0000-4000-8000-000000000100'] },
  idempotencyKey: '00000000-0000-4000-8000-000000001001', reason: 'Synthetic circuit record, label still unknown',
  preconditions: { target: null, guards: [{
    target: { authority: 'atlas', recordType: 'evidence', recordId: '00000000-0000-4000-8000-000000000100' }, revision: { kind: 'atlas', value: 1 },
  }] },
  approvalReceiptId: null, requestId: '00000000-0000-4000-8000-000000001002',
};

const idleActions: Pick<AiSessionState, 'connectionAction' | 'reviewAction' | 'recoveryAction'> = {
  connectionAction: { status: 'idle', action: null, actionId: null }, reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' },
};

export const healthyAiExamples: Readonly<Record<'ready' | 'siwcReady' | 'completed' | 'review' | 'cancelRequested' | 'cancelled', AiSessionState>> = {
  ready: { ...idleActions, connection: { status: 'available', snapshot: syntheticConnection }, request: { status: 'idle' } },
  siwcReady: { ...idleActions, connection: { status: 'available', snapshot: {
    method: 'sign-in-with-chatgpt', account: syntheticConnection.account,
    eligibility: 'unknown', permission: 'granted', authorization: 'connected', paidUseAdmission: 'verified-zero-paid-use',
    runtime: { kind: 'hosted', route: 'issued-website-client', qualification: 'qualified', availability: 'ready', checkedAt: '2026-10-06T10:00:00Z' },
    usageSupported: true,
  } }, request: { status: 'idle' } },
  completed: {
    ...idleActions, connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'finished', requestId: 'synthetic-completed', outcome: {
      status: 'completed', text: 'Synthetic room summary.', operationIds: [], usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    } },
  },
  review: {
    ...idleActions, connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'awaiting-review', requestId: 'synthetic-review', cancellation: { status: 'idle' }, outcome: {
      status: 'review-required', continuationId: 'synthetic-server-continuation',
      calls: [{ callId: 'synthetic-call', name: 'atlas_records', arguments: syntheticCircuitRequest }], reviews: [],
      usage: { inputTokens: 12, outputTokens: null, totalTokens: null },
    } },
  },
  cancelRequested: {
    ...idleActions, connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'running', requestId: 'synthetic-cancel', cancellation: { status: 'received', receipt: { requestId: 'synthetic-cancel', status: 'requested' } } },
  },
  cancelled: {
    ...idleActions, connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'finished', requestId: 'synthetic-cancel', outcome: { status: 'cancelled', usage: { inputTokens: 12, outputTokens: null, totalTokens: null } } },
  },
};

const doNothing = () => undefined;

/** Render-only examples. The live island receives an explicitly scoped host client. */
export function HealthyAiExample({ example }: { readonly example: keyof typeof healthyAiExamples }) {
  const props: AiPanelViewProps = {
    state: healthyAiExamples[example], scopeLabel: 'Synthetic room', prompt: 'Summarize this synthetic room.',
    onPromptChange: doNothing, onSubmit: doNothing, onCancel: doNothing, onRefresh: doNothing,
    onConnectionAction: doNothing, onReview: doNothing, onRecover: doNothing,
  };
  return <AiPanelView {...props} />;
}
