/** Sequential healthy browser composition with explicit synthetic JSON ports.
 * No provider, login, grants, domain mutation, rejected transport or control probe. */
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiPanelView } from '../AiPanel.js';
import { hasConnectionActionCapacity, isConnectionActionAdmissionBlocking } from '../useAiSession.js';
import { AiActivityStatus, AiHost, AiSettingsSection } from './AiHost.js';
import { createAiHostClient } from './client.js';
import type { AiSessionState, ConnectionSnapshot, ReviewRequired, RunOutcome, UnresolvedConnectionAction, Usage } from '../types.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const usage: Usage = { inputTokens: 12, outputTokens: 7, totalTokens: 19 };
const unknownUsage: Usage = { inputTokens: null, outputTokens: null, totalTokens: null };
const held: ConnectionSnapshot = {
  method: 'sign-in-with-chatgpt', account: null, eligibility: 'unknown', permission: 'unknown',
  authorization: 'unconfigured', paidUseAdmission: 'held', usageSupported: false,
  runtime: { kind: 'hosted', route: 'unset', qualification: 'held', availability: 'unknown', checkedAt: null },
};
const ready: ConnectionSnapshot = {
  method: 'sign-in-with-chatgpt', account: { accountId: 'synthetic-account', workspaceId: 'synthetic-workspace', label: 'Synthetic account' },
  eligibility: 'eligible', permission: 'granted', authorization: 'connected', paidUseAdmission: 'verified-zero-paid-use', usageSupported: true,
  runtime: { kind: 'hosted', route: 'issued-website-client', qualification: 'qualified', availability: 'ready', checkedAt: '2026-10-07T00:00:00Z' },
};
const U = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const review: ReviewRequired = {
  status: 'review-required', continuationId: U(2), usage,
  calls: [{ callId: 'synthetic-call', name: 'atlas_records', arguments: {
    schemaVersion: 3, commandId: 'atlas.circuit.create', requestId: U(3),
    context: { workspaceId: U(4), homeId: U(5) }, target: { authority: 'atlas', recordType: 'circuit', recordId: U(6) },
    payload: { label: null, panel: null, evidenceIds: [U(7)] }, idempotencyKey: U(8), reason: 'Synthetic review preview',
    preconditions: { target: null, guards: [{ target: { authority: 'atlas', recordType: 'evidence', recordId: U(7) }, revision: { kind: 'atlas', value: 1 } }] }, approvalReceiptId: null,
  } }],
  // Empty challenges use the donor's separate human-review preview example.
  reviews: [],
};
type Mode = 'connection' | 'completed' | 'review' | 'cancel' | 'status' | 'terminal-display';
interface Observed { readonly path: string; readonly method: string; readonly body: Record<string, unknown> | null }

export function createHealthyAiHostFixture(mode: Mode) {
  let snapshot = mode === 'connection' ? held : ready;
  let pendingAction = '';
  let requestId = '';
  let reviewCount = 0;
  let finish: ((outcome: RunOutcome) => void) | null = null;
  const observed: Observed[] = [];
  const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const client = createAiHostClient({
    endpoints: {
      connection: '/synthetic/connection', connectionAction: '/synthetic/action',
      connectionActionStatus: id => `/synthetic/action/${encodeURIComponent(id)}`,
      run: '/synthetic/run', cancel: id => `/synthetic/cancel/${encodeURIComponent(id)}`,
      openReview: '/synthetic/review', resume: '/synthetic/resume', requestStatus: id => `/synthetic/status/${encodeURIComponent(id)}`,
    },
    mutationHeaders: async () => ({ 'X-Atlas-CSRF': 'synthetic-application-nonce' }),
    fetch: async (input, init) => {
      assert(typeof input === 'string' && init, 'Explicit synthetic transport');
      assert(init.credentials === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error', 'Host request options');
      const method = init.method ?? '';
      const raw: unknown = init.body === undefined ? null : JSON.parse(String(init.body));
      assert(raw === null || (typeof raw === 'object' && !Array.isArray(raw)), 'JSON body');
      const body = raw as Record<string, unknown> | null;
      observed.push({ path: input, method, body });
      if (method === 'POST') assert(new Headers(init.headers).get('X-Atlas-CSRF') === 'synthetic-application-nonce', 'Application nonce');
      if (input === '/synthetic/connection') return response(snapshot);
      if (input === '/synthetic/action') {
        assert(body && typeof body['actionId'] === 'string', 'Retained action ID');
        const command = body['command'];
        assert(command && typeof command === 'object' && 'action' in command, 'Typed connection command');
        if (command.action === 'connect') {
          pendingAction = body['actionId'];
          return response({ actionId: pendingAction, status: 'pending', snapshot });
        }
        return response({ actionId: body['actionId'], status: 'completed', snapshot });
      }
      if (input.startsWith('/synthetic/action/')) {
        assert(input === `/synthetic/action/${pendingAction}`, 'Original action status ID');
        snapshot = ready;
        return response({ actionId: pendingAction, status: 'completed', snapshot });
      }
      if (input === '/synthetic/run') {
        assert(body && typeof body['requestId'] === 'string', 'Original run ID');
        assert(Object.keys(body).sort().join(',') === 'prompt,requestId', 'Run has no authority fields');
        requestId = body['requestId'];
        if (mode === 'review') return response(review);
        if (mode === 'cancel' || mode === 'status') return new Promise<Response>(resolve => {
          finish = outcome => resolve(response(outcome));
        });
        if (mode === 'terminal-display') return response({ status: 'failed', reason: 'domain-unavailable', operationIds: [U(30)], usage: unknownUsage });
        return response({ status: 'completed', text: 'Canonical synthetic response <em>plain text</em>', operationIds: [], usage });
      }
      if (input === '/synthetic/review' || input === '/synthetic/resume') {
        assert(body?.['requestId'] === requestId && body['continuationId'] === review.continuationId, 'Retained review identity');
        assert(Object.keys(body).sort().join(',') === 'continuationId,requestId', 'No approval receipt or mutated arguments');
        if (input === '/synthetic/review') return response({ status: ++reviewCount === 1 ? 'pending' : 'ready-to-resume' });
        return response({ status: 'completed', text: 'Canonical reviewed response', operationIds: [], usage });
      }
      if (input.startsWith('/synthetic/cancel/')) {
        assert(body?.['requestId'] === requestId, 'Cancellation ID');
        return response({ requestId, status: 'requested' });
      }
      if (input.startsWith('/synthetic/status/')) {
        assert(input === `/synthetic/status/${requestId}`, 'Status is for original request');
        return response({ requestId, status: 'finished', outcome: { status: 'completed', text: 'Canonical status response', operationIds: [], usage } });
      }
      throw new Error('Unexpected healthy fixture route');
    },
  });
  return {
    client, observed,
    confirmConnection() { snapshot = ready; },
    finishCancelled() { assert(finish, 'Synthetic result retained'); finish({ status: 'cancelled', usage }); },
    finishStatusTransport() { assert(finish, 'Synthetic result retained'); finish({ status: 'completed', text: 'Canonical status response', operationIds: [], usage }); },
  };
}

function Example({ client }: { readonly client: ReturnType<typeof createAiHostClient> }) {
  const [settings, setSettings] = useState(true);
  return <AiHost context={{ client, scopeKey: 'synthetic-actor/home/registration/session/epoch', scopeLabel: 'Synthetic home' }}>
    <button type="button" onClick={() => setSettings(value => !value)}>Toggle Settings example</button>
    {settings ? <div className="settings-list"><AiSettingsSection /></div> : <AiActivityStatus />}
  </AiHost>;
}
async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Healthy example timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent === name);
  assert(found && !found.disabled, `Available button: ${name}`);
  return found;
}
function click(container: HTMLElement, name: string) {
  flushSync(() => button(container, name).click());
}
function prompt(container: HTMLElement) {
  const field = container.querySelector('textarea');
  assert(field, 'Prompt field');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  assert(setter, 'Native textarea input');
  flushSync(() => { setter.call(field, 'Synthetic prompt'); field.dispatchEvent(new Event('input', { bubbles: true })); });
}

export async function runHealthyAiHostExamples(container: HTMLElement) {
  const groups: string[] = [];
  let root: Root | null = null;
  async function mount(mode: Mode) {
    if (root) flushSync(() => root?.unmount());
    const port = createHealthyAiHostFixture(mode);
    root = createRoot(container);
    flushSync(() => root?.render(<Example client={port.client} />));
    await until(() => container.textContent?.includes(mode === 'connection' ? 'Unconfigured' : 'Synthetic account') === true, 'connection snapshot');
    return port;
  }
  const includes = (value: string) => container.textContent?.includes(value) === true;
  try {
    const connection = await mount('connection');
    const run = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    assert(run?.disabled && includes('Unknown') && includes('Held'), 'Held connection preserved');
    const route = container.querySelector('select'); assert(route, 'Runtime candidate');
    flushSync(() => { route.value = 'issued-website-client'; route.dispatchEvent(new Event('change', { bubbles: true })); });
    click(container, 'Connect');
    await until(() => includes('Connect is pending.'), 'Pending host action');
    connection.confirmConnection();
    click(container, 'Manage usage');
    await until(() => !includes('Opening connection action.'), 'Usage surface returned');
    assert(includes('Connect is pending.'), 'Connected facts do not finish an earlier workflow');
    click(container, 'Refresh status');
    await until(() => !includes('Connect is pending.') && includes('Synthetic account'), 'Original action reconciled');
    assert(connection.observed.filter(row => row.path === '/synthetic/action').length === 2, 'No action replay');
    groups.push('held connection; pending Connect; Manage usage; original-ID reconciliation');

    const completed = await mount('completed');
    prompt(container); click(container, 'Run');
    await until(() => includes('Canonical synthetic response'), 'Completed response');
    assert(includes('<em>plain text</em>') && container.querySelector('.ha-ai__text em') === null, 'Canonical text is React text');
    assert(includes('Total tokens') && includes('19'), 'Actual supplied token counts');
    assert(completed.observed.filter(row => row.path === '/synthetic/run').length === 1, 'Single run');
    groups.push('terminal response and usage through decoded host client');

    const reviewed = await mount('review');
    prompt(container); click(container, 'Run');
    await until(() => includes('Tool review'), 'Review preview');
    assert(includes('atlas.circuit.create') && includes('synthetic-call'), 'Retained call preview');
    click(container, 'Open human review');
    await until(() => includes('Human review is pending.'), 'Host review pending');
    assert(!reviewed.observed.some(row => row.path === '/synthetic/resume'), 'Pending review retains the continuation');
    click(container, 'Toggle Settings example');
    await until(() => includes('AI tool review is required.'), 'Activity outside Settings');
    assert(container.querySelector('a')?.getAttribute('href') === '#settings', 'Settings placement');
    click(container, 'Toggle Settings example');
    await until(() => includes('Human review is pending.'), 'Review retained across page composition');
    click(container, 'Open human review');
    await until(() => includes('Canonical reviewed response'), 'Ready continuation');
    assert(reviewed.observed.filter(row => row.path === '/synthetic/resume').length === 1, 'Exactly one ready continuation');
    groups.push('pending human review; page navigation retention; ready resume with original IDs');

    const cancelled = await mount('cancel');
    prompt(container); click(container, 'Run');
    await until(() => includes('Running'), 'Request running');
    click(container, 'Cancel request');
    await until(() => includes('Cancellation requested. Waiting for the final result.'), 'Requested acknowledgement');
    cancelled.finishCancelled();
    await until(() => includes('Request cancelled.'), 'Terminal cancellation result');
    assert(cancelled.observed.filter(row => row.path.startsWith('/synthetic/cancel/')).length === 1, 'Separate cancellation request');
    groups.push('requested cancellation followed by terminal result and usage');

    const recovered = await mount('status');
    prompt(container); click(container, 'Run');
    await until(() => includes('Running'), 'Status request running');
    click(container, 'Refresh request status');
    await until(() => includes('Canonical status response'), 'Authoritative retained status');
    recovered.finishStatusTransport();
    assert(recovered.observed.filter(row => row.path === '/synthetic/run').length === 1, 'Lookup does not replay run');
    groups.push('original request status lookup and canonical completion');

    await mount('terminal-display');
    prompt(container); click(container, 'Run');
    await until(() => includes('Request failed'), 'Canonical terminal error DTO display');
    assert(includes('The requested data is unavailable.') && includes(U(30)) && includes('Unknown'), 'Canonical reason, earlier operation ID and unknown usage');
    groups.push('supplied terminal error display; recorded operation ID; unknown usage');
    return { groups, scope: 'Explicit synthetic host transport and real React composition only; no actual root mount, Rust host, live account, provider, domain mutation or stopped control.' };
  } finally {
    if (root) flushSync(() => root?.unmount());
  }
}

/** Static healthy receipt/admission projection only. No host action, runtime
 * rotation, disconnect, reconnect, enrollment or status lifecycle is executed. */
export function runHealthyConnectionAdmissionProjection(container: HTMLElement) {
  const root = createRoot(container);
  const currentScope = 'synthetic/current-runtime';
  const previousScope = 'synthetic/prior-runtime';
  let hostActions = 0;
  const state: AiSessionState = {
    connection: { status: 'available', snapshot: held }, request: { status: 'idle' },
    connectionAction: { status: 'idle', action: null, actionId: null },
    reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' },
  };
  const row = (action: UnresolvedConnectionAction['action'], scopeKey: string, index: number): UnresolvedConnectionAction => ({
    action, actionId: `synthetic-retained-${index}`, status: 'pending', hostStatus: 'pending',
    admissionBlocking: isConnectionActionAdmissionBlocking({ action, scopeKey }, currentScope),
  });
  const button = (label: string) => {
    const found = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    assert(found, `Projected control ${label}`); return found;
  };
  const render = (rows: readonly UnresolvedConnectionAction[]) => {
    const noop = () => {};
    flushSync(() => root.render(<AiPanelView state={state} scopeLabel="Synthetic admission metadata"
      prompt="" onPromptChange={noop} onSubmit={noop} onCancel={noop} onRefresh={noop}
      onConnectionAction={() => { hostActions++; }} onReview={noop} onRecover={noop}
      unresolvedConnectionActions={rows} />));
    const route = container.querySelector('select'); assert(route, 'Synthetic route selector');
    flushSync(() => { route.value = 'issued-website-client'; route.dispatchEvent(new Event('change', { bubbles: true })); });
    assert(container.querySelectorAll('ul[aria-label="Unresolved connection actions"] li').length === rows.length,
      'Every receipt remains visible');
  };
  try {
    for (const action of ['connect', 'consent'] as const) {
      assert(isConnectionActionAdmissionBlocking({ action, scopeKey: previousScope, opening: true }, currentScope),
        'Older active opening metadata remains blocking');
    }
    const older = [row('connect', previousScope, 1), row('consent', previousScope, 2)];
    render(older);
    assert(!button('Connect').disabled && !button('Review inference consent').disabled, 'Older Connect/Consent are display-only admission metadata');
    assert(older.length === 2 && hasConnectionActionCapacity(older.length), 'Both older rows still count toward receipt capacity');
    for (const action of ['connect', 'consent'] as const) {
      render([row(action, currentScope, 3)]);
      assert(button('Connect').disabled && button('Review inference consent').disabled, 'Current-runtime receipts still block admission');
    }
    for (const action of ['disconnect', 'manage-usage'] as const) {
      const olderGuard = row(action, previousScope, 4);
      assert(olderGuard.admissionBlocking, 'Older Disconnect/usage retain their admission safeguards');
      render([olderGuard]);
      assert(button('Connect').disabled && button('Review inference consent').disabled, 'Older Disconnect/usage still block connection controls');
      if (action === 'disconnect') assert(button('Disconnect').disabled, 'Pending Disconnect retry remains blocked');
      else assert(button('Manage usage').disabled, 'Manage usage duplicate remains blocked');
    }
    const legacy: UnresolvedConnectionAction = { action: 'connect', actionId: 'synthetic-legacy', status: 'pending', hostStatus: 'pending' };
    render([legacy]);
    assert(button('Connect').disabled && button('Review inference consent').disabled, 'Absent admission metadata preserves legacy blocking');
    assert(hostActions === 0, 'Static projection performs no host actions');
    return { groups: ['retained old Connect/Consent display and capacity', 'current-runtime blockers',
      'older Disconnect and usage safeguards', 'legacy admission metadata'], hostActions };
  } finally { flushSync(() => root.unmount()); }
}
