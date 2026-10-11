/** Narrow synthetic lifecycle checks for cancellation-epoch receipt rotation.
 * Uses the real hook, host composition and panel; no provider or domain port. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiActivityStatus, AiHost, AiSettingsSection } from './AiHost.js';
import { createHealthyAiHostFixture } from './healthy.examples.js';
import type { AiClient, AiReceiptIdentity, ConnectionActionResult, RunOutcome, Usage } from '../types.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const identity: AiReceiptIdentity = Object.freeze({ actorId: 'actor-a', workspaceId: 'workspace-a', homeId: 'home-a',
  registrationId: 'registration-a', authorityEpoch: 'authority-a' });
const status = (status: ConnectionActionResult['status'], actionId: string, snapshot: ConnectionActionResult['snapshot']): ConnectionActionResult =>
  ({ status, actionId, snapshot });

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Epoch receipt timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  assert(button && !button.disabled, `Available synthetic action ${label}`);
  flushSync(() => button.click());
}

function prompt(container: HTMLElement) {
  const field = container.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  assert(field && setter, 'Synthetic prompt control');
  flushSync(() => { setter.call(field, 'Synthetic request'); field.dispatchEvent(new Event('input', { bubbles: true })); });
}

function resetScope(base: AiClient, actionStatus: AiClient['connectionActionStatus'], overrides: Partial<AiClient> = {}): AiClient {
  return { ...base, connection: signal => base.connection(signal), connectionActionStatus: actionStatus,
    ...overrides };
}

/** Pending disconnect row crosses a cancellation epoch only for the exact
 * trusted actor/workspace/home/registration/authority tuple. */
export async function runEpochRotatedDisconnectReceipt(container: HTMLElement) {
  const base = createHealthyAiHostFixture('completed').client;
  const snapshot = await base.connection(new AbortController().signal);
  const actionIds: string[] = [], statusReads: string[] = [];
  const resultGate = gate<ConnectionActionResult>();
  const original = resetScope(base, async actionId => {
    statusReads.push(actionId);
    return resultGate.promise;
  }, { async connectionAction(input) {
    assert(input.command.action === 'disconnect', 'Only the explicit synthetic disconnect is submitted');
    actionIds.push(input.actionId);
    return status('pending', input.actionId, snapshot);
  } });
  const rootA = createRoot(container);
  let activeRoot = rootA;
  const seenLookups = statusReads.length;
  try {
    flushSync(() => rootA.render(<AiHost context={{ client: original, scopeKey: 'synthetic/epoch-a', receiptIdentity: identity,
      scopeLabel: 'Synthetic home' }}><AiSettingsSection /></AiHost>));
    await until(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Disconnect' && !button.disabled),
      'Initial epoch connection');
    click(container, 'Disconnect');
    await until(() => actionIds.length === 1 && container.textContent?.includes('Disconnect is pending.'), 'Pending original receipt');
    const originalId = actionIds[0];
    assert(originalId, 'Original disconnect identifier');

    // Stable identity dimensions are exact; each changed dimension remains isolated.
    for (const changed of [
      { ...identity, actorId: 'actor-b' },
      { ...identity, workspaceId: 'workspace-b' },
      { ...identity, homeId: 'home-b' },
      { ...identity, registrationId: 'registration-b' },
      { ...identity, authorityEpoch: 'authority-b' },
    ]) {
      activeRoot.unmount();
      activeRoot = createRoot(container);
      const isolatedClient = resetScope(base, async actionId => {
        statusReads.push(`unexpected:${actionId}`);
        return status('completed', actionId, snapshot);
      });
      flushSync(() => activeRoot.render(<AiHost context={{ client: isolatedClient, scopeKey: `synthetic/isolated/${crypto.randomUUID()}`,
        receiptIdentity: changed, scopeLabel: 'Synthetic home' }}><AiSettingsSection /></AiHost>));
      await until(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Disconnect' && !button.disabled),
        'Independent identity scope');
      assert(!container.textContent?.includes('Disconnect is pending.'), 'Changed identity shows no old receipt');
      assert(statusReads.every(read => read === originalId), 'Changed identity never queries the old receipt ID');
    }

    activeRoot.unmount();
    activeRoot = createRoot(container);
    const rotated = resetScope(base, async actionId => {
      statusReads.push(actionId);
      assert(actionId === originalId, 'Rotated scope reads only the original action ID');
      return resultGate.promise;
    });
    flushSync(() => activeRoot.render(<AiHost context={{ client: rotated, scopeKey: 'synthetic/epoch-b', receiptIdentity: identity,
      scopeLabel: 'Synthetic home' }}><AiSettingsSection /></AiHost>));
    await until(() => statusReads.length === seenLookups + 1, 'Current-epoch original-ID status read');
    assert(container.textContent?.includes('Disconnect is pending.'), 'Original receipt remains visible while status is pending');
    assert(actionIds.length === 1, 'No duplicate disconnect submission across rotation');
    resultGate.resolve(status('completed', originalId, snapshot));
    await until(() => !container.textContent?.includes('Disconnect is pending.'), 'Matching completion retires the receipt');
    assert(statusReads.length === 1 && statusReads[0] === originalId, 'One exact original-ID read');
    return { case: 'pending-disconnect-receipt-cross-epoch', actionIds, statusReads,
      isolatedDimensions: ['actorId', 'workspaceId', 'homeId', 'registrationId', 'authorityEpoch'],
      scope: 'Synthetic host binding and ports; actual AiHost, hook and panel.' };
  } finally {
    resultGate.resolve(status('unconfirmed', actionIds[0] ?? 'synthetic-cleanup', snapshot));
    activeRoot.unmount();
  }
}

/** A canceled request is reconciled by original ID through the rotated host;
 * canonical usage and provider uncertainty remain in the actual UI. */
export async function runEpochRotatedRequestReceipt(container: HTMLElement) {
  const base = createHealthyAiHostFixture('completed').client;
  const snapshot = await base.connection(new AbortController().signal);
  const usage: Usage = { inputTokens: 5, outputTokens: null, totalTokens: null };
  const runIds: string[] = [], cancelIds: string[] = [], requestReads: string[] = [], actionIds: string[] = [];
  let requestGate = gate<RunOutcome>();
  const first = resetScope(base, async actionId => status('pending', actionId, snapshot), {
    async run(input, signal) {
      runIds.push(input.requestId);
      return new Promise<RunOutcome>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic transport disposed')), { once: true }));
    },
    async cancel(requestId) { cancelIds.push(requestId); return { requestId, status: 'requested' }; },
    async connectionAction(input) {
      assert(input.command.action === 'disconnect', 'Only the explicit synthetic disconnect is submitted');
      actionIds.push(input.actionId);
      return status('pending', input.actionId, snapshot);
    },
  });
  const rootA = createRoot(container);
  let activeRoot = rootA;
  try {
    flushSync(() => rootA.render(<AiHost context={{ client: first, scopeKey: 'synthetic/request-epoch-a', receiptIdentity: identity,
      scopeLabel: 'Synthetic home' }}><AiSettingsSection /></AiHost>));
    await until(() => container.textContent?.includes('Synthetic account') === true
      && container.querySelector('textarea')?.disabled === false, 'Initial request-ready connection');
    prompt(container);
    await until(() => [...container.querySelectorAll('button')].some(button => button.textContent === 'Run' && !button.disabled),
      'Run enabled after entering a prompt');
    click(container, 'Run');
    await until(() => runIds.length === 1 && container.textContent?.includes('Running'), 'Original request submission');
    const requestId = runIds[0];
    click(container, 'Disconnect');
    await until(() => actionIds.length === 1 && cancelIds.length === 1, 'Disconnect cancels original request once');
    assert(cancelIds[0] === requestId, 'Cancellation retains original request ID');

    activeRoot.unmount();
    activeRoot = createRoot(container);
    const rotated = resetScope(base, async actionId => {
      actionIds.push(`status:${actionId}`);
      return status('completed', actionId, snapshot);
    }, {
      async requestStatus(id) {
        requestReads.push(id);
        assert(id === requestId, 'Current trusted client reads the original request ID');
        return requestGate.promise.then(outcome => ({ requestId: id, status: 'finished' as const, outcome }));
      },
    });
    flushSync(() => activeRoot.render(<AiHost context={{ client: rotated, scopeKey: 'synthetic/request-epoch-b', receiptIdentity: identity,
      scopeLabel: 'Synthetic home' }}><AiSettingsSection /><AiActivityStatus /></AiHost>));
    await until(() => requestReads.length === 1
      && container.textContent?.includes('Result is unavailable. Request completion is unconfirmed.') === true,
    'Current-epoch original-ID request recovery and rendered unconfirmed state');
    assert(container.textContent?.includes('Result is unavailable. Request completion is unconfirmed.'),
      'Unresolved request remains visible during recovery');
    const stopped: RunOutcome = { status: 'stopped', usage };
    requestGate.resolve(stopped);
    await until(() => container.textContent?.includes('AI local processing stopped. Provider completion is unconfirmed.'),
      'Canonical stopped outcome and uncertainty');
    assert(container.textContent?.includes('Input tokens') && container.textContent?.includes('5'), 'Known usage remains visible');
    assert(container.textContent?.includes('Unknown'), 'Unknown usage remains visible');
    assert(runIds.length === 1 && cancelIds.length === 1 && cancelIds[0] === requestId
      && requestReads.length === 1 && requestReads[0] === requestId, 'Original IDs only; no replay');
    assert(!actionIds.some(id => id.startsWith('status:')) || actionIds.filter(id => id.startsWith('status:')).length === 1,
      'At most one original disconnect receipt read');
    return { case: 'request-terminal-usage-cross-epoch', runIds, cancelIds, requestReads,
      outcome: stopped, scope: 'Synthetic host binding and terminal DTO; actual AiHost, hook, panel and activity status.' };
  } finally {
    requestGate.resolve({ status: 'stopped', usage });
    activeRoot.unmount();
  }
}
