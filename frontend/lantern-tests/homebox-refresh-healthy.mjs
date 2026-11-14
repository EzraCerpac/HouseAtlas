// Healthy generated checks for the Editor-only "Refresh from HomeBox" control:
// decoding the server's answer, each state's sentence, and the exchange
// (session read for CSRF, then one POST). A generated server; no browser,
// network, HomeBox or real credential.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeRefreshResult, describeRefresh, requestRefresh } from '../src/lantern/homebox-refresh.ts';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const at = '2026-11-14T09:30:00.000Z', earlier = '2026-11-01T08:00:00.000Z';
const format = iso => iso.slice(0, 16).replace('T', ' ');
const scope = { workspaceId: 'w 1', homeId: 'h/2' };

// Decoding: only the four structured answers are accepted.
{
  assert.deepEqual(decodeRefreshResult({ status: 'refreshed', cache: { status: 'fresh', lastSuccessfulFetchAt: at } }),
    { kind: 'refreshed', refreshedAt: at });
  assert.deepEqual(decodeRefreshResult({ status: 'failed', reason: 'timeout', cache: { lastSuccessfulFetchAt: earlier } }),
    { kind: 'failed', reason: 'timeout', lastSuccessfulFetchAt: earlier });
  assert.deepEqual(decodeRefreshResult({ status: 'failed', reason: 'unavailable' }),
    { kind: 'failed', reason: 'unavailable', lastSuccessfulFetchAt: null });
  assert.deepEqual(decodeRefreshResult({ status: 'not-configured' }), { kind: 'not-configured' });
  assert.deepEqual(decodeRefreshResult({ status: 'running' }), { kind: 'running' });
  for (const bad of [null, [], {}, { status: 'fresh' }]) assert.throws(() => decodeRefreshResult(bad), TypeError);
}

// What the control says in each state.
{
  const say = result => describeRefresh(result, format);
  assert.equal(say({ kind: 'refreshed', refreshedAt: at }), 'Refreshed from HomeBox 2026-11-14 09:30.');
  assert.equal(say({ kind: 'failed', reason: 'auth', lastSuccessfulFetchAt: earlier }),
    'Not refreshed: HomeBox refused the configured credential. The copy from 2026-11-01 08:00 is still shown.');
  assert.equal(say({ kind: 'failed', reason: 'upstream', lastSuccessfulFetchAt: null }), 'Not refreshed: HomeBox could not be read.');
  assert.equal(say({ kind: 'not-configured' }), 'Refreshing from HomeBox is not set up on this server.');
  assert.equal(say({ kind: 'running' }), 'A refresh is already running. Try again when it finishes.');
  assert.equal(say({ kind: 'denied' }), 'Only a signed-in Editor can refresh from HomeBox.');
  assert.equal(say({ kind: 'offline' }), 'Refreshing from HomeBox is unavailable offline.');
  assert.equal(say({ kind: 'unreachable' }), 'Not refreshed: this server could not be reached.');
}

// The exchange with a generated server.
{
  const calls = [];
  let answer = { status: 'refreshed', cache: { lastSuccessfulFetchAt: at } }, status = 200, reachable = true;
  const transport = async (path, init) => {
    if (!reachable) throw new TypeError('Generated network unavailable');
    calls.push([init.method, path]);
    assert.equal(init.credentials, 'same-origin');
    if (path === '/api/atlas/auth/session')
      return Response.json({ schemaVersion: 1, actorId: 'a1', csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00Z' });
    assert.equal(path, '/api/atlas/providers/homebox/workspaces/w%201/homes/h%2F2/refresh');
    assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
    assert.equal(init.body, undefined);
    return status === 200 ? Response.json(answer) : new Response(null, { status });
  };
  assert.deepEqual(await requestRefresh(scope, transport, true), { kind: 'refreshed', refreshedAt: at });
  assert.deepEqual(calls, [['GET', '/api/atlas/auth/session'], ['POST', '/api/atlas/providers/homebox/workspaces/w%201/homes/h%2F2/refresh']]);
  // Offline: nothing is sent at all.
  calls.length = 0;
  assert.deepEqual(await requestRefresh(scope, transport, false), { kind: 'offline' });
  assert.deepEqual(calls, []);
  for (const [next, expected] of [[{ status: 'running' }, { kind: 'running' }], [{ status: 'not-configured' }, { kind: 'not-configured' }]]) {
    answer = next;
    assert.deepEqual(await requestRefresh(scope, transport, true), expected);
  }
  status = 403;
  assert.deepEqual(await requestRefresh(scope, transport, true), { kind: 'denied' });
  status = 500;
  assert.deepEqual(await requestRefresh(scope, transport, true), { kind: 'unreachable' });
  reachable = false;
  assert.deepEqual(await requestRefresh(scope, transport, true), { kind: 'unreachable' });
  const signedOut = async () => new Response(null, { status: 401 });
  assert.deepEqual(await requestRefresh(scope, signedOut, true), { kind: 'denied' });
}

// Mounted only for Editors, called only from the button; no other caller.
{
  const panel = readFileSync(new URL('../src/lantern/components/DetailPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /projection\.view\.canEdit && projection\.view\.caches\.some\(cache => cache\.owner === 'homebox'\) && <HomeboxRefresh \/>/);
  const control = panel.slice(panel.indexOf('export function HomeboxRefresh'), panel.indexOf('// ---------------- Room'));
  assert.doesNotMatch(control, /useEffect|useLayoutEffect/);
  assert.match(control, /onClick=\{\(\) => \{ void refresh\(\); \}\}/);
  assert.equal(panel.split('requestRefresh(').length, 2);
}

console.log('PASS HomeBox refresh: strict decoding, state sentences, CSRF exchange, offline sends nothing, denial and unreachable, Editor-only button');
