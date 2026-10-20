/** Actual SessionApp/React DOM with generated views and successful fake ports.
 * Regression cases below are explicit synthetic concurrency/failure cases. */
import assert from 'node:assert/strict';
import { createElement as element, StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionApp } from '../src/app/SessionApp';
import { createInitialHomeBootstrap } from '../src/app/session-bootstrap';
import { decodeAtlasView } from '../src/app/decode';
import { demoSnapshot, demoOptions } from '../../web/demo/fixtures.mjs';
import { prepareAtlasView } from '../../web/src/prepare.mjs';

const snapshot = demoSnapshot('normal');
const options = demoOptions(snapshot, 'normal');
options.now = '2026-10-08T00:00:00Z';
// The generated web projection uses safe numeric fixture values; native DTOs
// retain quantities/costs/byte sizes as text. Match the established healthy
// decoder fixture without substituting any production decoder or app code.
const dto = structuredClone(prepareAtlasView(snapshot, options));
for (const entry of dto.entries) {
  entry.entity.quantity = entry.entity.quantity == null ? null : String(entry.entity.quantity);
  for (const item of entry.maintenance) item.cost = item.cost == null ? null : String(item.cost);
  for (const item of entry.attachments)
    if (item.kind === 'stored-file') item.byteSize = item.byteSize == null ? null : String(item.byteSize);
}
const view = decodeAtlasView(dto);
const info = Object.freeze({ schemaVersion: 1,
  actorId: '00000000-0000-4000-8000-000000000010',
  csrfToken: 'generated-unused-session-marker', expiresAt: '2099-01-01T00:00:00Z' });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => act(async () => { await Promise.resolve(); });
function ports(mode = 'loopback-local', present = false) {
  const pending = deferred(), calls = { session: 0, mode: 0, local: 0, proxy: 0, home: 0 };
  const listeners = new Set();
  let current = present ? info : null;
  const open = kind => async () => {
    calls[kind]++;
    // This stands for the existing wrapped port's verified completion, not a
    // raw login receipt. It deliberately may complete after observer cleanup.
    const value = await pending.promise;
    current = value;
    return value;
  };
  const sessions = {
    async session(signal) { calls.session++; await Promise.resolve(); signal.throwIfAborted(); return current; },
    async signIn() { throw new Error('No password submission in these cases'); },
    localAccess: {
      async mode(signal) { calls.mode++; await Promise.resolve(); signal.throwIfAborted(); return mode; },
      signIn: open('local'), proxySignIn: open('proxy'),
    },
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
  };
  const client = {
    async load() { calls.home++; return view; },
    async loadHome() { return view; },
  };
  return { sessions, client, pending, calls, notify: () => { for (const listener of listeners) listener(); } };
}
async function mount(host, { fence = createInitialHomeBootstrap(host.sessions), strict = false } = {}) {
  const container = document.createElement('div'); document.body.append(container);
  let root = createRoot(container);
  const render = async next => {
    const app = element(SessionApp, { client: next.client, sessions: next.sessions,
      ...(fence ? { initialHomeBootstrap: fence } : {}) });
    await act(async () => root.render(strict ? element(StrictMode, null, app) : app));
    await flush();
  };
  try { await render(host); }
  catch (error) { root.unmount(); container.remove(); throw error; }
  return { container, render,
    async remount() { await act(async () => root.unmount()); root = createRoot(container); await render(host); },
    async close() { await act(async () => root.unmount()); container.remove(); },
  };
}
function noHome(host, container) {
  assert.equal(host.calls.home, 0, 'App cannot load the home before verified session completion');
  assert(!container.textContent.includes(view.homeLabel));
}
async function complete(host, ui) {
  await act(async () => host.pending.resolve(info)); await flush();
  assert(ui.container.textContent.includes(view.homeLabel));
  assert(host.calls.home > 0);
}

export const healthyCases = ['local-initial', 'proxy-initial', 'existing-session', 'host-opt-out', 'password-mode'];
export const regressionCases = ['strict-effect-setup', 'pending-remount', 'uncertain-open', 'port-replacement', 'subscription-during-open'];
export async function run(name) {
  const host = ports(name === 'proxy-initial' ? 'trusted-proxy' : name === 'password-mode' ? 'password' : 'loopback-local', name === 'existing-session');
  const fence = createInitialHomeBootstrap(host.sessions);
  const ui = await mount(host, { fence: name === 'host-opt-out' ? null : fence, strict: name === 'strict-effect-setup' });
  try {
    if (name === 'local-initial' || name === 'proxy-initial' || name === 'strict-effect-setup') {
      noHome(host, ui.container);
      assert.equal(host.calls.local, name === 'proxy-initial' ? 0 : 1);
      assert.equal(host.calls.proxy, name === 'proxy-initial' ? 1 : 0);
      assert(![...ui.container.querySelectorAll('button')].some(b => b.textContent === 'Open Home'));
      assert.equal(ui.container.querySelector('[role="status"]')?.textContent, 'Opening Home…');
      await complete(host, ui);
      assert.equal(host.calls.local + host.calls.proxy, 1);
    } else if (name === 'existing-session') {
      assert.equal(host.calls.mode, 0); assert.equal(host.calls.local + host.calls.proxy, 0);
      assert(ui.container.textContent.includes(view.homeLabel));
    } else if (name === 'host-opt-out') {
      noHome(host, ui.container); assert.equal(host.calls.local + host.calls.proxy, 0);
      assert([...ui.container.querySelectorAll('button')].some(b => b.textContent === 'Open Home'));
    } else if (name === 'password-mode') {
      noHome(host, ui.container); assert.equal(host.calls.local + host.calls.proxy, 0);
      assert(ui.container.querySelector('input[autocomplete="username"]'));
      assert(ui.container.querySelector('input[type="password"][autocomplete="current-password"]'));
    } else if (name === 'pending-remount') {
      assert.equal(host.calls.local, 1); await ui.remount();
      assert.equal(host.calls.local, 1); noHome(host, ui.container);
      await act(async () => host.pending.resolve(info)); await flush();
      noHome(host, ui.container); assert.equal(host.calls.local, 1);
    } else if (name === 'uncertain-open') {
      await act(async () => host.pending.reject(new Error('Synthetic unconfirmed completion'))); await flush();
      assert(ui.container.textContent.includes('Opening Home could not be confirmed.'));
      const check = [...ui.container.querySelectorAll('button')].find(b => b.textContent === 'Check session');
      assert(check); await act(async () => check.click()); await flush();
      assert.equal(host.calls.local, 1); noHome(host, ui.container);
    } else if (name === 'port-replacement') {
      const replacement = ports(); await ui.render(replacement);
      assert.equal(replacement.calls.local + replacement.calls.proxy, 0);
      await act(async () => host.pending.resolve(info)); await flush();
      noHome(host, ui.container); noHome(replacement, ui.container);
    } else if (name === 'subscription-during-open') {
      await act(async () => host.notify()); await flush();
      await act(async () => host.pending.resolve(info)); await flush();
      assert.equal(host.calls.local, 1); noHome(host, ui.container);
    } else throw new Error('Unreviewed fixture case');
    assert(!ui.container.textContent.includes(info.csrfToken));
  } finally { await ui.close(); }
}
