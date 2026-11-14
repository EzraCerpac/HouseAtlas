// Healthy generated checks for the Editor-only "Refresh from HomeBox" control,
// driven through the production controller that the button renders: the
// server's admission read decides whether it is offered, a press is the only
// POST, and every recorded answer re-reads the view. A generated server model
// with the route's answer shapes; no browser, network, HomeBox or credential.
import assert from 'node:assert/strict';
import { createRefreshControl, decodeAvailability, decodeRefreshResult, describeRefresh, requestRefresh } from '../src/lantern/homebox-refresh.ts';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const format = iso => iso.slice(0, 16).replace('T', ' ');
const scope = { workspaceId: 'w 1', homeId: 'h/2' };
const ROUTE = '/api/atlas/providers/homebox/workspaces/w%201/homes/h%2F2/refresh';

/** The route's rules over one in-memory cache: admission, CSRF POST, 401 quarantine. */
function server({ role = 'editor', approved = true, configured = true } = {}) {
  const model = { cache: null, upstream: 'ok', calls: [], refreshes: 0, now: '2026-11-14T09:30:00.000Z' };
  model.transport = async (path, init) => {
    model.calls.push([init.method, path]);
    assert.equal(init.credentials, 'same-origin');
    if (path === '/api/atlas/auth/session') return Response.json({ schemaVersion: 1, actorId: 'a1', csrfToken: 'csrf-1' });
    assert.equal(path, ROUTE);
    if (init.method === 'GET')
      return Response.json({ status: !configured ? 'not-configured' : role === 'editor' && approved ? 'available' : 'not-approved' });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
    if (role !== 'editor') return new Response(null, { status: 403 });
    if (!configured) return Response.json({ status: 'not-configured' });
    if (!approved) return Response.json({ status: 'failed', reason: 'registration-unavailable' });
    model.refreshes += 1;
    if (model.upstream === 'ok') {
      model.cache = { status: 'fresh', lastSuccessfulFetchAt: model.now, entries: ['generated entity'] };
      return Response.json({ status: 'refreshed', cache: { status: 'fresh', lastSuccessfulFetchAt: model.now, lastAttemptAt: model.now, errorCode: null } });
    }
    // HomeBox answered 401: the server records quarantine and withholds rows.
    model.cache = { status: 'access-revoked', lastSuccessfulFetchAt: model.cache?.lastSuccessfulFetchAt ?? null, entries: [] };
    return Response.json({ status: 'failed', reason: 'auth', cache: { status: 'access-revoked', lastSuccessfulFetchAt: model.cache.lastSuccessfulFetchAt, errorCode: 'auth' } });
  };
  // The view the panel shows is whatever the last reload read from the server.
  model.view = { caches: [] };
  model.reload = async () => { model.view = { caches: model.cache ? [{ ...model.cache }] : [] }; return true; };
  return model;
}
const control = model => createRefreshControl({ scope, transport: model.transport, online: () => model.online !== false });
const say = state => state.result ? describeRefresh(state.result, format) : '';

// Admission: offered only to the approved Editor of a configured source.
for (const [options, offered] of [[{}, true], [{ role: 'viewer' }, false], [{ approved: false }, false], [{ configured: false }, false]]) {
  const model = server(options), refresh = control(model);
  await refresh.check();
  assert.equal(refresh.getSnapshot().offered, offered, JSON.stringify(options));
  await refresh.press(model.reload);
  // A control that was not offered sends no POST at all.
  if (!offered) assert.deepEqual(model.calls, [['GET', ROUTE]]);
}

// The first refresh happens with no cache at all, then a later 401 quarantines.
{
  const model = server(), refresh = control(model);
  assert.deepEqual(model.view.caches, []);
  await refresh.check();
  assert.equal(refresh.getSnapshot().offered, true);
  assert.equal(model.refreshes, 0, 'Checking admission sends no refresh');
  const pressed = refresh.press(model.reload);
  assert.equal(refresh.getSnapshot().busy, true);
  await pressed;
  assert.equal(say(refresh.getSnapshot()), 'Refreshed from HomeBox 2026-11-14 09:30.');
  assert.deepEqual(model.view.caches, [{ status: 'fresh', lastSuccessfulFetchAt: model.now, entries: ['generated entity'] }]);

  model.upstream = 'unauthorized';
  await refresh.press(model.reload);
  const state = refresh.getSnapshot();
  assert.equal(state.busy, false);
  assert.deepEqual(state.result, { kind: 'failed', reason: 'auth', quarantined: true, lastSuccessfulFetchAt: model.now });
  assert.equal(say(state), 'Not refreshed: HomeBox refused the configured credential. Access revoked: the saved HomeBox copy is withheld.');
  // The failed answer also re-read the view: the old rows are no longer shown.
  assert.deepEqual(model.view.caches, [{ status: 'access-revoked', lastSuccessfulFetchAt: model.now, entries: [] }]);
  assert.equal(model.refreshes, 2);

  // Offline: the press sends nothing.
  model.online = false;
  const before = model.calls.length;
  await refresh.press(model.reload);
  assert.equal(model.calls.length, before);
  assert.equal(say(refresh.getSnapshot()), 'Refreshing from HomeBox is unavailable offline.');
}

// An ordinary failure keeps the earlier copy and says so.
{
  const result = decodeRefreshResult({ status: 'failed', reason: 'timeout', cache: { status: 'error', lastSuccessfulFetchAt: '2026-11-01T08:00:00.000Z' } });
  assert.deepEqual(result, { kind: 'failed', reason: 'timeout', quarantined: false, lastSuccessfulFetchAt: '2026-11-01T08:00:00.000Z' });
  assert.equal(describeRefresh(result, format), 'Not refreshed: HomeBox did not answer in time. The copy from 2026-11-01 08:00 is still shown.');
}

// Strict decoding and the remaining answers.
{
  for (const bad of [null, [], {}, { status: 'fresh' }]) {
    assert.throws(() => decodeRefreshResult(bad), TypeError);
    assert.throws(() => decodeAvailability(bad), TypeError);
  }
  const model = server();
  for (const [answer, expected] of [[{ status: 'running' }, 'A refresh is already running. Try again when it finishes.'],
    [{ status: 'not-configured' }, 'Refreshing from HomeBox is not set up on this server.']]) {
    const transport = async (path, init) => init.method === 'POST' ? Response.json(answer) : model.transport(path, init);
    assert.equal(describeRefresh(await requestRefresh(scope, transport, true), format), expected);
  }
  assert.deepEqual(await requestRefresh(scope, async () => new Response(null, { status: 401 }), true), { kind: 'denied' });
  assert.deepEqual(await requestRefresh(scope, async () => { throw new TypeError('Generated network unavailable'); }, true), { kind: 'unreachable' });
}

console.log('PASS HomeBox refresh: server admission decides the button, first refresh without a cache, later 401 quarantine re-reads the view and withholds the copy, offline sends nothing, strict decoding');
