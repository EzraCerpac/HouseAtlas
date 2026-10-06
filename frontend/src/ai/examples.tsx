import { AiPanelView } from './AiPanel.js';
import type { AiPanelViewProps } from './AiPanel.js';
import type { AiSessionState, ConnectionSnapshot } from './types.js';

/** Healthy synthetic data only; no providers, household records, or credentials. */
export const syntheticConnection: ConnectionSnapshot = {
  method: 'local-runtime',
  eligibility: 'not-applicable',
  permission: 'not-applicable',
  authorization: 'connected',
  runtime: { kind: 'local', availability: 'ready', checkedAt: '2026-10-06T10:00:00Z' },
  usageSupported: true,
};

export const healthyAiExamples: Readonly<Record<'ready' | 'siwcReady' | 'completed' | 'review' | 'cancelRequested' | 'cancelled', AiSessionState>> = {
  ready: { connection: { status: 'available', snapshot: syntheticConnection }, request: { status: 'idle' } },
  siwcReady: { connection: { status: 'available', snapshot: {
    method: 'sign-in-with-chatgpt', eligibility: 'unknown', permission: 'granted', authorization: 'connected',
    runtime: { kind: 'hosted', availability: 'ready', checkedAt: '2026-10-06T10:00:00Z' }, usageSupported: true,
  } }, request: { status: 'idle' } },
  completed: {
    connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'finished', requestId: 'synthetic-completed', outcome: {
      status: 'completed', text: 'Synthetic room summary.', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    } },
  },
  review: {
    connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'finished', requestId: 'synthetic-review', outcome: {
      status: 'review-required', calls: [{ callId: 'synthetic-call', name: 'mutateAtlasRecord', arguments: {
        schemaVersion: 1, mutationId: '00000000-0000-4000-8000-000000001000', operation: 'create', expectedRevision: null,
        reason: 'Synthetic circuit record, label still unknown',
        guards: [{ record: { recordType: 'evidence', recordId: '00000000-0000-4000-8000-000000000100' }, expectedRevision: 1 }],
        value: { recordType: 'circuit', payload: { label: null, panel: null, evidenceIds: ['00000000-0000-4000-8000-000000000100'] } },
      } }],
      usage: { inputTokens: 12, outputTokens: null, totalTokens: null },
    } },
  },
  cancelRequested: {
    connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'running', requestId: 'synthetic-cancel', cancellation: { status: 'received', receipt: { requestId: 'synthetic-cancel', status: 'requested' } } },
  },
  cancelled: {
    connection: { status: 'available', snapshot: syntheticConnection },
    request: { status: 'finished', requestId: 'synthetic-cancel', outcome: { status: 'cancelled', usage: { inputTokens: 12, outputTokens: null, totalTokens: null } } },
  },
};

const doNothing = () => undefined;

/** Render-only example. The live island must receive an explicitly scoped AiClient. */
export function HealthyAiExample({ example }: { readonly example: keyof typeof healthyAiExamples }) {
  const props: AiPanelViewProps = {
    state: healthyAiExamples[example], scopeLabel: 'Synthetic room', prompt: 'Summarize this synthetic room.',
    onPromptChange: doNothing, onSubmit: doNothing, onCancel: doNothing, onRefresh: doNothing,
  };
  return <AiPanelView {...props} />;
}
