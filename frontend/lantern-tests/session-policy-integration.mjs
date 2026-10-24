/** Explicit local regression selectors. Generated data, fake clock/transport,
 * no listener, browser, native state, provider, credentials or capture replay. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

assert.equal(process.version, 'v26.10.0');
const selected = process.argv.slice(2);
assert(selected.length === 2 && selected[0] === '--case'
  && ['annual-expiry', 'expiry-cancel', 'explicit-rotation', 'rotation-interruption'].includes(selected[1]), 'Select one named local regression');
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text, { mode: 'strip' })).toString('base64')}`;
const expiryUrl = moduleUrl(source('../integration/session-expiry.ts'));
const sessionUrl = moduleUrl(source('../src/app/session.ts'));
const rotationUrl = moduleUrl(source('../src/app/session-rotation.ts'));
// The unrelated saved-view decoder is never invoked by this session-only test.
// Session decoding, transition and transport implementation are actual source.
const viewUrl = moduleUrl('export function decodeAtlasView() { throw new Error("Unexpected atlas view decode"); }');
const clientUrl = moduleUrl(source('../src/api/client.ts')
  .replace('"../app/decode"', JSON.stringify(viewUrl))
  .replace('"../app/session"', JSON.stringify(sessionUrl))
  .replace('"../app/session-rotation"', JSON.stringify(rotationUrl)));

const { scheduleSessionExpiry } = await import(expiryUrl);
if (selected[1] === 'annual-expiry' || selected[1] === 'expiry-cancel') {
  const original = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const cap = 2_147_483_647, day = 86_400_000;
  let now = 1_800_000_000_000, nextId = 0, expired = 0;
  const tasks = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (callback, delay) => {
    assert(delay > 0 && delay <= cap);
    const id = ++nextId; tasks.set(id, { callback, due: now + delay }); return id;
  };
  globalThis.clearTimeout = id => tasks.delete(id);
  const wake = () => {
    assert.equal(tasks.size, 1);
    const [id, task] = [...tasks][0]; tasks.delete(id); now = task.due; task.callback();
  };
  try {
    const expiresAt = now + 365 * day;
    const cancel = scheduleSessionExpiry(expiresAt, () => expired++);
    assert.equal([...tasks.values()][0].due, now + cap);
    wake(); assert.equal(expired, 0); assert.equal(tasks.size, 1);
    if (selected[1] === 'annual-expiry') {
      // A backward clock adjustment after scheduling must extend the recheck,
      // without making a capped wake-up an expiry event.
      const [id, queued] = [...tasks][0]; tasks.delete(id);
      now -= day; queued.callback(); assert.equal(expired, 0);
      let wakes = 0;
      while (now < expiresAt) { wake(); assert(++wakes < 20); }
      assert.equal(expired, 1); assert.equal(tasks.size, 0);
      cancel(); assert.equal(expired, 1);
    } else {
      const queued = [...tasks.values()][0].callback;
      cancel(); cancel(); assert.equal(tasks.size, 0);
      now = expiresAt + day; queued();
      assert.equal(expired, 0); assert.equal(tasks.size, 0);
      // Cancelling one generation cannot cancel a replacement generation.
      const stopNext = scheduleSessionExpiry(now + day, () => expired++);
      queued(); assert.equal(tasks.size, 1); wake();
      assert.equal(expired, 1); stopNext(); assert.equal(tasks.size, 0);
      const stopExpired = scheduleSessionExpiry(now - 1, () => expired++);
      assert.equal(expired, 1, 'Already expired allocation never calls back reentrantly');
      stopExpired(); assert.equal(tasks.size, 0);
    }
  } finally { Date.now = original.now; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; }
} else {
  const { createAtlasSessionClient } = await import(clientUrl);
  const before = { schemaVersion: 1, actorId: 'generated-actor', csrfToken: 'generated-before', expiresAt: '2099-01-01T00:00:00Z' };
  const receipt = { ...before, csrfToken: 'generated-receipt' };
  const canonical = { ...before, csrfToken: 'generated-canonical' };
  const endpoints = { session: '/api/atlas/auth/session', login: '/api/atlas/auth/login', rotate: '/api/atlas/auth/rotate' };
  const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const signal = new AbortController().signal;
  if (selected[1] === 'explicit-rotation') {
    const calls = [];
    let releaseCanonical, canonicalStarted;
    const started = new Promise(resolve => { canonicalStarted = resolve; });
    const held = new Promise(resolve => { releaseCanonical = resolve; });
    const client = createAtlasSessionClient(endpoints, async (url, init) => {
      calls.push([url, init.method]);
      assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
      assert.equal(init.signal, signal); assert.equal(init.body, undefined);
      if (calls.length === 1) { assert.equal(init.method, 'GET'); return response(before); }
      if (calls.length === 2) {
        assert.equal(url, endpoints.rotate); assert.equal(init.method, 'POST');
        assert.equal(init.headers['X-Atlas-CSRF'], before.csrfToken); return response(receipt);
      }
      assert.equal(calls.length, 3); assert.equal(url, endpoints.session); assert.equal(init.method, 'GET');
      canonicalStarted(); await held; return response(canonical);
    });
    assert.deepEqual(calls, [], 'Construction performs no rotation');
    let published = false;
    const pending = client.rotate(signal).then(value => { published = true; return value; });
    await started; assert.equal(published, false, 'No binding before canonical reconciliation');
    releaseCanonical(); assert.deepEqual(await pending, canonical);
    assert.deepEqual(calls, [[endpoints.session, 'GET'], [endpoints.rotate, 'POST'], [endpoints.session, 'GET']]);
    assert.equal(createAtlasSessionClient({ session: endpoints.session, login: endpoints.login }).rotate, undefined);
  } else {
    // A lost POST result is uncertain. Nothing here retries or sends a capture.
    let calls = 0;
    const uncertain = createAtlasSessionClient(endpoints, async () => {
      if (++calls === 1) return response(before);
      throw new Error('Generated lost rotation response');
    });
    await assert.rejects(uncertain.rotate(signal)); assert.equal(calls, 2);
    for (const replacement of [null, before, { ...canonical, actorId: 'other-generated-actor' }, { ...canonical, expiresAt: '2098-01-01T00:00:00Z' }]) {
      calls = 0;
      const client = createAtlasSessionClient(endpoints, async () => response([before, receipt, replacement][calls++]));
      await assert.rejects(client.rotate(signal)); assert.equal(calls, 3);
    }
    for (const badReceipt of [{ ...receipt, actorId: 'other-generated-actor' }, { ...receipt, expiresAt: '2098-01-01T00:00:00Z' }]) {
      calls = 0;
      const client = createAtlasSessionClient(endpoints, async () => response([before, badReceipt][calls++]));
      await assert.rejects(client.rotate(signal)); assert.equal(calls, 2, 'A changed receipt cannot publish a binding');
    }
    calls = 0;
    const cancelled = new AbortController();
    const client = createAtlasSessionClient(endpoints, async () => { calls++; cancelled.abort(); return response(before); });
    await assert.rejects(client.rotate(cancelled.signal)); assert.equal(calls, 1, 'Cancelled preflight sends no POST');
    calls = 0;
    const late = new AbortController();
    const lateClient = createAtlasSessionClient(endpoints, async () => {
      calls++; if (calls === 3) late.abort(); return response([before, receipt, canonical][calls - 1]);
    });
    await assert.rejects(lateClient.rotate(late.signal)); assert.equal(calls, 3, 'Late canonical result cannot publish after cancellation');
  }
}
console.log(`PASS session-policy-integration ${selected[1]} (generated clock/transport only)`);
