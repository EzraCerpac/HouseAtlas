/** Positive Rust DTO/browser composition only. Account and transport peers are
 * synthetic; no held-step dispatch, remote revocation or failure injection. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiHost, AiSettingsSection } from './AiHost.js';
import { bindAiHostPort } from './client.js';
import { decodeRequestStatus, decodeRunOutcome } from './decode.js';
import { decodeConnectionActionResult } from '../wire.js';
import { createHealthyAiHostFixture } from './healthy.examples.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Healthy receipt timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function runHealthyOperationReceiptsExample(container: HTMLElement, peer: unknown) {
  assert(peer !== null && typeof peer === 'object' && 'domainHeld' in peer
    && 'requestStatus' in peer && 'disconnect' in peer && 'completedDisconnect' in peer, 'Rust-produced DTOs');
  const outcome = decodeRunOutcome(peer.domainHeld);
  assert(outcome.status === 'domain-held' && outcome.operationIds.length === 3, 'Populated host correlations');
  const rawStatus = peer.requestStatus;
  assert(rawStatus !== null && typeof rawStatus === 'object' && 'requestId' in rawStatus
    && typeof rawStatus.requestId === 'string', 'Rust request ID');
  const status = decodeRequestStatus(rawStatus, rawStatus.requestId);
  assert(status.status === 'finished' && status.outcome.status === 'domain-held'
    && JSON.stringify(status.outcome) === JSON.stringify(outcome), 'Actual status preserves the same outcome');
  const disconnect = decodeConnectionActionResult(peer.disconnect);
  const completed = decodeConnectionActionResult(peer.completedDisconnect);
  assert(disconnect.status === 'unconfirmed' && completed.status === 'completed', 'Seeded receipt projections');
  const base = createHealthyAiHostFixture('completed').client;
  const actions: string[] = [], lookups: string[] = [], requests: string[] = [];
  const client = bindAiHostPort({
    connection: signal => actions.length === 0 ? base.connection(signal) : Promise.resolve(disconnect.snapshot),
    async connectionAction(input) {
      assert(input.command.action === 'disconnect', 'Explicit disconnect command only');
      actions.push(input.actionId);
      // Only the synthetic browser's new correlation ID is rebound. Receipt
      // status/display remain the actual Rust DTO projection, without revocation.
      return { ...(actions.length === 1 ? disconnect : completed), actionId: input.actionId };
    },
    async connectionActionStatus(actionId) {
      assert(actionId === actions[0], 'Retained original unconfirmed receipt');
      lookups.push(actionId);
      return { ...disconnect, actionId };
    },
    async run(input) {
      requests.push(input.requestId);
      return requests.length === 1 ? peer.domainHeld
        : { status: 'completed', text: 'Fresh synthetic request after held outcome', usage: outcome.usage };
    },
    cancel: requestId => base.cancel(requestId),
    requestStatus: (requestId, signal) => base.requestStatus(requestId, signal),
    openReview: (input, signal) => base.openReview(input, signal),
    resume: (input, signal) => base.resume(input, signal),
  });
  const root = createRoot(container);
  const includes = (text: string) => container.textContent?.includes(text) === true;
  function click(name: string) {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === name);
    assert(button && !button.disabled, `Available receipt action: ${name}`);
    flushSync(() => button.click());
  }
  try {
    flushSync(() => root.render(<AiHost context={{ client, scopeKey: `synthetic-receipts/${crypto.randomUUID()}`,
      scopeLabel: 'Synthetic home' }}><AiSettingsSection /></AiHost>));
    await until(() => includes('Synthetic account'), 'Initial synthetic connection');
    const field = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    assert(field && setter, 'Prompt input');
    flushSync(() => { setter.call(field, 'Synthetic prompt'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    click('Run');
    await until(() => includes('Recorded domain operations'), 'Canonical held outcome');
    const rendered = [...container.querySelectorAll('[aria-label="Recorded domain operations"] li')].map(item => item.textContent);
    assert(JSON.stringify(rendered) === JSON.stringify(outcome.operationIds), 'All correlations retain host order');
    assert(includes('Current operation ID') && includes(outcome.operationId ?? 'Unknown')
      && includes('Current domain operation is queued.'), 'Current operation and held state');
    const labels = { 'Input tokens': 'inputTokens', 'Output tokens': 'outputTokens', 'Total tokens': 'totalTokens' } as const;
    for (const label of container.querySelectorAll('.ha-ai__result dt')) {
      const key = Object.entries(labels).find(([name]) => name === label.textContent)?.[1];
      if (key) assert(label.nextElementSibling?.textContent === (outcome.usage[key] === null
        ? 'Unknown' : outcome.usage[key].toLocaleString('en-US')), `Preserved ${key}`);
    }
    click('Run');
    await until(() => includes('Fresh synthetic request after held outcome'), 'Held outcome frees request slot');
    assert(requests.length === 2 && requests[0] !== requests[1], 'Fresh request ID, no replay');
    click('Disconnect');
    await until(() => includes('Disconnect or remote revocation is unconfirmed.'), 'Retained unconfirmed receipt');
    click('Disconnect');
    await until(() => actions.length === 2 && !includes('Opening connection action.'), 'Explicit retry completes');
    assert(actions[0] !== actions[1] && includes('Disconnect or remote revocation is unconfirmed.'), 'Fresh action preserves earlier uncertainty');
    click('Refresh status');
    await until(() => lookups.length === 1, 'Original receipt can still be polled');
    assert(actions.length === 2 && lookups[0] === actions[0], 'Status lookup submits no action');
    return { groups: ['actual Rust held/status DTOs; ordered correlations/current state/usage; fresh request',
      'seeded unconfirmed disconnect; explicit fresh-ID retry; original receipt retained and polled'],
    operationIds: outcome.operationIds, currentOperationId: outcome.operationId, usage: outcome.usage,
    actionCount: actions.length, retainedReceiptLookups: lookups.length,
    scope: 'Actual Rust serde projections and real browser client/hook/panel with synthetic ports. No domain dispatch, provider revocation, root mount or held controls.' };
  } finally {
    flushSync(() => root.unmount());
  }
}
