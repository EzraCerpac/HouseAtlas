/** Rust DTO/browser composition with synthetic peers. Focused terminal-stop and
 * prelaunch failure checks below are explicitly requested; other held controls
 * remain unrun. No held-step dispatch, remote revocation or provider operation. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiHost, AiSettingsSection, AiActivityStatus } from './AiHost.js';
import { bindAiHostPort } from './client.js';
import { decodeRequestStatus, decodeRunOutcome } from './decode.js';
import { decodeConnectionActionResult } from '../wire.js';
import { createHealthyAiHostFixture } from './healthy.examples.js';
import { AiPanelView } from '../AiPanel.js';
import { useAiSession } from '../useAiSession.js';
import type { AiClient } from '../types.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// Each probe owns an independent real session hook and panel. The small output
// verifies state propagation as well as rendered rows, without sharing a host
// context or treating shared action metadata as current account authority.
function AliasPanel({ client, scopeKey, name }: { client: AiClient; scopeKey: string; name: string }) {
  const session = useAiSession(client, scopeKey);
  return <div data-alias={name}>
    <output data-action-state={session.state.connectionAction.status}
      data-host-status={session.unresolvedConnectionActions[0]?.hostStatus ?? 'none'}>{session.state.connectionAction.status}</output>
    <AiPanelView state={session.state} scopeLabel="Synthetic alias home" prompt="" onPromptChange={() => {}}
      onSubmit={() => {}} onCancel={() => {}} onReview={() => {}} onRecover={() => {}}
      onRefresh={() => { void session.refresh(); }}
      onConnectionAction={input => { void session.connectionAction(input); }}
      unresolvedConnectionActions={session.unresolvedConnectionActions} />
  </div>;
}

/** Sequential, under-budget positive lifecycle only. No overlapping opening
 * call/status lookup, capacity exhaustion, real account or provider operation. */
export async function runHealthyAliasPanelsExample(container: HTMLElement) {
  const base = createHealthyAiHostFixture('completed').client;
  const snapshot = await base.connection(new AbortController().signal);
  const actionIds: string[] = [], lookups: string[] = [];
  let observed: 'pending' | 'unconfirmed' | 'completed' = 'pending';
  const client = bindAiHostPort({
    connection: async () => snapshot,
    async connectionAction(input) {
      assert(input.command.action === 'manage-usage', 'Side-effect-free synthetic usage projection');
      actionIds.push(input.actionId);
      await until(() => aliasesMatch('working', 0), 'Opening progress in both aliases');
      for (const name of ['A1', 'A2']) {
        assert(button(name, 'Disconnect').disabled && button(name, 'Manage usage').disabled
          && button(name, 'Refresh status').disabled, 'Shared opening controls');
      }
      isolated();
      return { actionId: input.actionId, status: 'pending', snapshot };
    },
    async connectionActionStatus(actionId) {
      assert(actionIds.includes(actionId), 'Original alias workflow identifier');
      lookups.push(actionId);
      return { actionId, status: observed, snapshot };
    },
    run: (input, signal) => base.run(input, signal),
    cancel: requestId => base.cancel(requestId),
    requestStatus: (requestId, signal) => base.requestStatus(requestId, signal),
    openReview: (input, signal) => base.openReview(input, signal),
    resume: (input, signal) => base.resume(input, signal),
  });
  const scope = `synthetic/actor/session/workspace/home/registration/epoch/${crypto.randomUUID()}`;
  const root = createRoot(container);
  const panel = (name: string) => {
    const value = container.querySelector<HTMLElement>(`[data-alias="${name}"]`);
    assert(value, `Mounted ${name}`); return value;
  };
  const rows = (name: string) => panel(name).querySelectorAll('[aria-label="Unresolved connection actions"] li');
  const state = (name: string) => panel(name).querySelector('output')?.getAttribute('data-action-state');
  function button(name: string, action: string) {
    const value = [...panel(name).querySelectorAll('button')].find(item => item.textContent === action);
    assert(value, `Alias action ${name}/${action}`); return value;
  }
  function click(name: string, action: string) {
    const value = button(name, action); assert(!value.disabled, `Available ${name}/${action}`);
    flushSync(() => value.click());
  }
  const aliasesMatch = (status: 'working' | 'pending' | 'unconfirmed' | 'idle', count: number) =>
    ['A1', 'A2'].every(name => state(name) === status && rows(name).length === count);
  function isolated() {
    assert(state('B') === 'idle' && rows('B').length === 0 && !button('B', 'Manage usage').disabled,
      'Same display label never crosses different full scope');
  }
  try {
    flushSync(() => root.render(<>
      <AliasPanel client={client} scopeKey={scope} name="A1" />
      <AliasPanel client={client} scopeKey={scope} name="A2" />
      <AliasPanel client={client} scopeKey={`${scope}/other-home`} name="B" />
    </>));
    await until(() => ['A1', 'A2', 'B'].every(name => !button(name, 'Manage usage').disabled), 'Three ready independent sessions');
    // Repeat fully reconciled transitions; at most one shared row exists.
    for (let cycle = 0; cycle < 2; cycle++) {
      observed = 'pending';
      click('A1', 'Manage usage');
      await until(() => aliasesMatch('pending', 1), 'Pending state/row in both aliases');
      for (const name of ['A1', 'A2']) {
        assert(rows(name)[0]?.textContent?.includes('Manage usage is pending.'), 'Pending display');
        assert(panel(name).querySelector('output')?.getAttribute('data-host-status') === 'pending', 'Accepted pending host receipt');
        assert(button(name, 'Manage usage').disabled, 'Duplicate pending action blocked in both aliases');
      }
      isolated();
      observed = 'unconfirmed';
      click('A2', 'Refresh status');
      await until(() => aliasesMatch('unconfirmed', 1), 'Same-size metadata/state update in both aliases');
      for (const name of ['A1', 'A2']) {
        assert(rows(name)[0]?.textContent?.includes('Manage usage is unconfirmed.'), 'Unconfirmed display');
        assert(panel(name).querySelector('output')?.getAttribute('data-host-status') === 'unconfirmed', 'Accepted unconfirmed host receipt');
      }
      isolated();
      observed = 'completed';
      click('A1', 'Refresh status');
      await until(() => aliasesMatch('idle', 0) && ['A1', 'A2'].every(name => !button(name, 'Manage usage').disabled),
        'Retirement clears state/rows and restores both alias controls');
      isolated();
    }
    assert(actionIds.length === 2 && actionIds[0] !== actionIds[1], 'Repeated fresh explicit workflows');
    assert(JSON.stringify(lookups) === JSON.stringify([actionIds[0], actionIds[0], actionIds[1], actionIds[1]]),
      'Only original-ID reads, no action replay');
    return { groups: ['three independent sessions; same-scope insertion/status/retirement; different-scope isolation',
      'two sequential under-budget cycles; shared state and rows; original-ID reads; fresh explicit IDs'],
    actions: actionIds.length, statusLookups: lookups.length, maximumScopeRows: 1,
    scope: 'Synthetic decoded ports and actual React sessions/panels; same visible labels, distinct full keys. No capacity exhaustion, overlapping calls, provider or held controls.' };
  } finally { flushSync(() => root.unmount()); }
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
        : { status: 'completed', text: 'Fresh synthetic request after held outcome', operationIds: [], usage: outcome.usage };
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

/** Explicitly requested narrow checks: a supplied canonical local Stopped DTO,
 * then prelaunch selection rejection followed by its real persisted receipt.
 * Neither check interrupts provider I/O or probes other held failure paths. */
export async function runFocusedTerminalWorkflowChecks(container: HTMLElement, peer: unknown, prelaunchPeer: unknown) {
  assert(peer !== null && typeof peer === 'object' && 'stopped' in peer, 'Actual Rust Stopped DTO');
  const stopped = decodeRunOutcome(peer.stopped);
  assert(stopped.status === 'stopped', 'Local terminal stop with upstream uncertainty');
  assert(prelaunchPeer !== null && typeof prelaunchPeer === 'object' && 'result' in prelaunchPeer
    && 'reason' in prelaunchPeer && prelaunchPeer.reason === 'connection-unavailable', 'Actual prelaunch failure receipt/cause');
  const terminalAction = decodeConnectionActionResult(prelaunchPeer.result);
  assert(terminalAction.status === 'completed' && terminalAction.snapshot.paidUseAdmission === 'held'
    && terminalAction.snapshot.permission === 'unknown' && terminalAction.snapshot.runtime.qualification === 'held',
  'Terminal local action supplies no inference/runtime authority');
  const base = createHealthyAiHostFixture('completed').client;
  const requests: string[] = [], actions: string[] = [], lookups: string[] = [];
  let cancellations = 0, requestLookups = 0;
  const client = bindAiHostPort({
    connection: signal => actions.length === 0 ? base.connection(signal) : Promise.resolve(terminalAction.snapshot),
    async connectionAction(input) {
      assert(input.command.action === 'connect' && input.command.route === 'local-sign-in-helper', 'Explicit candidate selection');
      actions.push(input.actionId);
      throw new Error('Synthetic prelaunch selection failed before any launch');
    },
    async connectionActionStatus(actionId) {
      assert(actions.includes(actionId), 'Original failed prelaunch ID');
      lookups.push(actionId); return { ...terminalAction, actionId };
    },
    async run(input) {
      requests.push(input.requestId);
      return requests.length === 1 ? peer.stopped
        : { status: 'completed', text: 'Fresh request after local stopped result', operationIds: [], usage: stopped.usage };
    },
    async cancel(requestId) { cancellations++; return base.cancel(requestId); },
    async requestStatus(requestId, signal) { requestLookups++; return base.requestStatus(requestId, signal); },
    openReview: (input, signal) => base.openReview(input, signal),
    resume: (input, signal) => base.resume(input, signal),
  });
  const root = createRoot(container);
  const includes = (text: string) => container.textContent?.includes(text) === true;
  const button = (name: string) => {
    const value = [...container.querySelectorAll('button')].find(item => item.textContent === name);
    assert(value, `Focused action ${name}`); return value;
  };
  const click = (name: string) => {
    const value = button(name); assert(!value.disabled, `Available focused action ${name}`);
    flushSync(() => value.click());
  };
  try {
    flushSync(() => root.render(<AiHost context={{ client, scopeKey: `synthetic-focused/${crypto.randomUUID()}`,
      scopeLabel: 'Synthetic focused home' }}><AiSettingsSection /><AiActivityStatus /></AiHost>));
    await until(() => includes('Synthetic account'), 'Focused synthetic connection');
    const field = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    assert(field && setter, 'Focused prompt input');
    flushSync(() => { setter.call(field, 'Synthetic local-stop result'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    click('Run');
    await until(() => includes('AI local processing stopped. Provider completion is unconfirmed.'), 'Finished local-stop activity');
    assert(includes('Local processing stopped. Provider completion is unconfirmed.') && !button('Run').disabled,
      'Local slot released while provider uncertainty remains displayed');
    assert(![...container.querySelectorAll('button')].some(item => item.textContent === 'Cancel request'
      || item.textContent === 'Refresh request status'), 'No permanently active stopped controls');
    const labels = { 'Input tokens': 'inputTokens', 'Output tokens': 'outputTokens', 'Total tokens': 'totalTokens' } as const;
    for (const label of container.querySelectorAll('.ha-ai__result dt')) {
      const key = Object.entries(labels).find(([name]) => name === label.textContent)?.[1];
      if (key) assert(label.nextElementSibling?.textContent === (stopped.usage[key] === null
        ? 'Unknown' : stopped.usage[key].toLocaleString('en-US')), `Stopped preserves ${key}`);
    }
    assert(Number(requests.length) === 1 && cancellations === 0 && requestLookups === 0, 'No automatic replay/cancel/recovery');
    click('Run');
    await until(() => includes('Fresh request after local stopped result'), 'Fresh explicit request admitted');
    assert(requests.length === 2 && requests[0] !== requests[1], 'Stopped frees the slot without reusing request ID');
    const selection = container.querySelector('select');
    assert(selection, 'Candidate selection');
    flushSync(() => { selection.value = 'local-sign-in-helper'; selection.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let cycle = 0; cycle < 2; cycle++) {
      click('Connect');
      await until(() => includes('Connect is unconfirmed.'), 'Lost error-channel response retains original ID');
      click('Refresh status');
      await until(() => !includes('Connect is unconfirmed.') && !button('Connect').disabled, 'Known terminal prelaunch failure retires correlation');
    }
    assert(actions.length === 2 && actions[0] !== actions[1]
      && JSON.stringify(actions) === JSON.stringify(lookups), 'Two explicit fresh actions and original-ID reads only');
    return { groups: ['canonical local Stopped preserves usage/provider uncertainty; active slot released; fresh explicit request',
      'actual persisted prelaunch failure receipt; two original-ID reconciliations; fresh explicit Connect IDs; admission held'],
    stoppedUsage: stopped.usage, requestCount: requests.length, prelaunchActions: actions.length, actionLookups: lookups.length,
    cancellations, requestLookups,
    scope: 'Explicitly requested seeded Stopped and synthetic prelaunch rejection checks; actual Rust receipt/decoder/hook/panel/activity. No provider interruption, credential/grant, launch, inference or other held controls.' };
  } finally { flushSync(() => root.unmount()); }
}
