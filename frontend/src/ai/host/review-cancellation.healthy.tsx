/** Healthy UI consumption of the actual Rust example's persisted dismissal DTOs.
 * Browser transport/session peers are synthetic; no approval or dispatch occurs. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiHost, AiSettingsSection } from './AiHost.js';
import { bindAiHostPort } from './client.js';
import { decodeCancelReceipt, decodeRequestStatus } from './decode.js';
import { createHealthyAiHostFixture } from './healthy.examples.js';
import type { ReviewRequired, Usage } from '../types.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Healthy cancellation timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function runHealthyReviewCancellationExample(container: HTMLElement, peer: unknown) {
  assert(peer !== null && typeof peer === 'object' && 'dismissal' in peer && 'dismissedStatus' in peer,
    'Actual Rust healthy example JSON');
  const rawReceipt = peer.dismissal;
  assert(rawReceipt !== null && typeof rawReceipt === 'object' && 'requestId' in rawReceipt
    && typeof rawReceipt.requestId === 'string', 'Actual peer request ID');
  // First decode the unmodified Rust-produced pair, including its original ID.
  const receipt = decodeCancelReceipt(rawReceipt, rawReceipt.requestId);
  const status = decodeRequestStatus(peer.dismissedStatus, receipt.requestId);
  assert(receipt.status === 'confirmed' && status.status === 'finished'
    && status.outcome.status === 'cancelled', 'Persisted terminal dismissal');
  const persisted = status.outcome;
  const lifecycle = createHealthyAiHostFixture('completed').client;
  const calls: { readonly kind: string; readonly requestId: string }[] = [];
  let waitingId: string | null = null;
  const client = bindAiHostPort({
    connection: signal => lifecycle.connection(signal),
    connectionAction: (input, signal) => lifecycle.connectionAction(input, signal),
    connectionActionStatus: (id, signal) => lifecycle.connectionActionStatus(id, signal),
    async run(input) {
      calls.push({ kind: 'run', requestId: input.requestId });
      if (waitingId === null) {
        waitingId = input.requestId;
        const waiting: ReviewRequired = {
          status: 'review-required', continuationId: 'synthetic-waiting-continuation',
          calls: [{ callId: 'synthetic-call', name: 'synthetic-held', arguments: {} }],
          reviews: [], usage: persisted.usage,
        };
        return waiting;
      }
      return { status: 'completed', text: 'Fresh synthetic request after review cancellation', usage: persisted.usage };
    },
    async cancel(requestId) {
      assert(requestId === waitingId, 'Cancel original browser request');
      calls.push({ kind: 'cancel', requestId });
      // Only the explicit browser fixture ID is rebound; host status/usage is exact.
      return { ...receipt, requestId };
    },
    async requestStatus(requestId) {
      assert(requestId === waitingId, 'Status for original browser request');
      calls.push({ kind: 'status', requestId });
      return { ...status, requestId };
    },
    async openReview(input) {
      calls.push({ kind: 'review', requestId: input.requestId });
      return { status: 'pending' };
    },
    async resume(input) {
      calls.push({ kind: 'resume', requestId: input.requestId });
      return { status: 'completed', text: 'Synthetic resume', usage: persisted.usage };
    },
  });
  const root = createRoot(container);
  const includes = (text: string) => container.textContent?.includes(text) === true;
  function click(name: string) {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === name);
    assert(button && !button.disabled, `Available cancellation example action: ${name}`);
    flushSync(() => button.click());
  }
  try {
    flushSync(() => root.render(<AiHost context={{ client,
      scopeKey: 'synthetic-actor/home/registration/session/epoch', scopeLabel: 'Synthetic home' }}>
      <div className="settings-list"><AiSettingsSection /></div>
    </AiHost>));
    await until(() => includes('Synthetic account'), 'Connection snapshot');
    const field = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    assert(field && setter, 'Native prompt input');
    flushSync(() => { setter.call(field, 'Synthetic prompt'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    click('Run');
    await until(() => includes('Tool review'), 'Waiting review result');
    click('Cancel request');
    await until(() => includes('Request cancelled.'), 'Automatic persisted status reconciliation');
    assert(!includes('Tool review') && !includes('Open human review'), 'Dismissed review cleared');
    const observedUsage: Partial<Record<keyof Usage, string>> = {};
    const labels = { 'Input tokens': 'inputTokens', 'Output tokens': 'outputTokens', 'Total tokens': 'totalTokens' } as const;
    for (const label of container.querySelectorAll('.ha-ai__result dt')) {
      const key = Object.entries(labels).find(([name]) => name === label.textContent)?.[1];
      if (key) observedUsage[key] = label.nextElementSibling?.textContent ?? '';
    }
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const)
      assert(observedUsage[key] === (persisted.usage[key] === null ? 'Unknown' : persisted.usage[key].toLocaleString('en-US')),
        `Original persisted ${key}`);
    assert(calls.filter(call => call.kind === 'cancel').length === 1
      && calls.filter(call => call.kind === 'status').length === 1, 'One cancel and one original status lookup');
    assert(calls.filter(call => call.kind === 'run').length === 1, 'Status reconciliation did not replay run');
    click('Run');
    await until(() => includes('Fresh synthetic request after review cancellation'), 'Fresh request admitted by existing UI hook');
    const runs = calls.filter(call => call.kind === 'run');
    assert(runs.length === 2 && runs[0]?.requestId !== runs[1]?.requestId, 'New request has a fresh ID');
    assert(!calls.some(call => call.kind === 'review' || call.kind === 'resume'), 'Cancellation performs no review or continuation');
    return { groups: ['actual Rust cancellation/status DTOs; automatic original-ID lookup; preserved usage; fresh request after dismissal'],
      peerRequestId: receipt.requestId, usage: persisted.usage, statusLookups: 1,
      scope: 'Actual backend healthy example DTOs decoded unchanged; explicit synthetic browser ports rebind only requestId. No actual application root mount or live provider.' };
  } finally {
    flushSync(() => root.unmount());
  }
}
