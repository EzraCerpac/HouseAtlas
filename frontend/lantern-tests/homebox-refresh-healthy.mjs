// Healthy generated checks for the Editor-only "Refresh from HomeBox" control,
// driven through the production controller that the button renders: the
// server's admission read decides whether it is offered, a press is the only
// POST, and every recorded answer re-reads the view. A generated server model
// with the route's answer shapes; no browser, network, HomeBox or credential.
import assert from 'node:assert/strict';
import { createRefreshControl, decodeAvailability, decodeRefreshResult, describeRefresh, requestRefresh, shownView, withholdHomebox } from '../src/lantern/homebox-refresh.ts';

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
      // One answer for every ineligible caller, configured or not.
      return Response.json({ status: configured && role === 'editor' && approved ? 'available' : 'unavailable' });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
    if (role !== 'editor') return new Response(null, { status: 403 });
    if (!configured) return Response.json({ status: 'not-configured' });
    if (!approved) return Response.json({ status: 'failed', reason: 'registration-unavailable' });
    // A quarantined cache is refused before any HomeBox request.
    if (model.cache?.status === 'access-revoked') return Response.json({ status: 'failed', reason: 'access-revoked' });
    model.refreshes += 1;
    model.duringPost?.();
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
  model.withheld = 0;
  model.withhold = on => { if (on) model.withheld += 1; };
  model.reload = async () => { model.view = { caches: model.cache ? [{ ...model.cache }] : [] }; return true; };
  return model;
}
const control = model => createRefreshControl({ scope, transport: model.transport, online: () => model.online !== false });
const say = state => state.result ? describeRefresh(state.result, format, state.reconciled) : '';

// Admission: offered only to the approved Editor of a configured source.
for (const [options, offered] of [[{}, true], [{ role: 'viewer' }, false], [{ approved: false }, false], [{ configured: false }, false]]) {
  const model = server(options), refresh = control(model);
  await refresh.check();
  assert.equal(refresh.getSnapshot().offered, offered, JSON.stringify(options));
  await refresh.press(model.reload, model.withhold);
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
  const pressed = refresh.press(model.reload, model.withhold);
  assert.equal(refresh.getSnapshot().busy, true);
  await pressed;
  assert.equal(say(refresh.getSnapshot()), 'Refreshed from HomeBox 2026-11-14 09:30.');
  assert.deepEqual(model.view.caches, [{ status: 'fresh', lastSuccessfulFetchAt: model.now, entries: ['generated entity'] }]);

  model.upstream = 'unauthorized';
  await refresh.press(model.reload, model.withhold);
  const state = refresh.getSnapshot();
  assert.equal(state.busy, false);
  assert.deepEqual(state.result, { kind: 'failed', reason: 'auth', quarantined: true, lastSuccessfulFetchAt: model.now });
  assert.equal(say(state), 'Not refreshed: HomeBox refused the configured credential. Access revoked: the saved HomeBox copy is withheld, and refreshing cannot restore it on this server yet.');
  // The failed answer also re-read the view: the old rows are no longer shown.
  assert.deepEqual(model.view.caches, [{ status: 'access-revoked', lastSuccessfulFetchAt: model.now, entries: [] }]);
  assert.equal(model.refreshes, 2);
  assert.equal(model.withheld, 0, 'A successful re-read needs no local withholding');
  // Pressing again cannot lift the quarantine and never reaches HomeBox.
  model.upstream = 'ok';
  await refresh.press(model.reload, model.withhold);
  assert.equal(model.refreshes, 2);
  assert.equal(say(refresh.getSnapshot()), 'Not refreshed: access to this HomeBox source is revoked, and refreshing cannot restore it on this server yet.');
  model.upstream = 'unauthorized';

  // Offline: the press sends nothing.
  model.online = false;
  const before = model.calls.length;
  await refresh.press(model.reload, model.withhold);
  assert.equal(model.calls.length, before);
  assert.equal(say(refresh.getSnapshot()), 'Refreshing from HomeBox is unavailable offline.');
}

// The view re-read fails after a recorded 401: refused or rejected. HomeBox
// entries are withheld locally so the text and the content agree.
for (const failedReload of [async () => false, async () => { throw new TypeError('Generated view read failed'); }]) {
  const model = server(), refresh = control(model);
  await refresh.check();
  await refresh.press(model.reload, model.withhold);
  const shown = model.view;
  model.upstream = 'unauthorized';
  await refresh.press(failedReload, model.withhold);
  const state = refresh.getSnapshot();
  assert.equal(state.reconciled, false);
  assert.equal(model.withheld, 1);
  assert.equal(model.view, shown, 'The failed re-read changed nothing');
  assert.equal(say(state), 'Not refreshed: HomeBox refused the configured credential. Access revoked: HomeBox entries are withheld here, and refreshing cannot restore them on this server yet.');
  // An ordinary failure with a failed re-read says the view is out of date.
  model.upstream = 'ok';
  const timeout = async (path, init) => init.method === 'POST'
    ? Response.json({ status: 'failed', reason: 'timeout', cache: { status: 'error', lastSuccessfulFetchAt: model.now } })
    : model.transport(path, init);
  const ordinary = createRefreshControl({ scope, transport: timeout, online: () => true });
  await ordinary.check();
  await ordinary.press(failedReload, model.withhold);
  assert.equal(model.withheld, 1, 'An ordinary failure never withholds');
  assert.equal(say(ordinary.getSnapshot()), 'Not refreshed: HomeBox did not answer in time. This view could not be updated.');
}

// Another reload replaces the view while the refresh is in flight; the 401 and
// failed re-read then withhold the CURRENT same-home view, not the old object.
{
  const entry = key => ({ key, source: { sourceInstanceId: 's', collectionId: 'c', sourceKind: 'homebox-entity', externalId: key } });
  const view = (key, home = scope) => ({ status: 'ready', scope: home, homeLabel: 'Generated home', now: '2026-11-14T09:30:00.000Z',
    canEdit: false, homes: [], entries: [entry(key)], caches: [{ owner: 'homebox', status: 'fresh', displayStatus: 'fresh' }] });
  const model = server(), refresh = control(model);
  let current = view('before'), withheld = null;
  const session = 'session-1';
  await refresh.check();
  model.upstream = 'unauthorized';
  model.duringPost = () => { current = view('replaced'); };
  await refresh.press(async () => false, on => { withheld = on ? { scope, session } : null; });
  assert.equal(current.entries[0].key, 'replaced');
  const shown = shownView(current, session, withheld);
  assert.deepEqual(shown.entries, []);
  assert.deepEqual(shown.caches, [{ owner: 'homebox', status: 'access-revoked', displayStatus: 'access-revoked' }]);
  // Later views of the same home in that session stay withheld; another
  // session or home is not affected, and a successful re-read clears it.
  assert.deepEqual(shownView(view('later'), session, withheld).entries, []);
  assert.equal(shownView(view('later'), 'session-2', withheld).entries.length, 1);
  assert.equal(shownView(view('other', { workspaceId: 'w 1', homeId: 'other' }), session, withheld).entries.length, 1);
  await refresh.press(async () => true, on => { withheld = on ? { scope, session } : null; });
  assert.equal(withheld, null);
}

// The local stand-in matches the server's quarantine marker and drops entries.
{
  const view = { status: 'ready', scope, homeLabel: 'Generated home', now: '2026-11-14T09:30:00.000Z', canEdit: false, homes: [],
    entries: [{ key: 'e1', source: { sourceInstanceId: 's', collectionId: 'c', sourceKind: 'homebox-entity', externalId: 'x' } }],
    caches: [{ owner: 'homebox', status: 'fresh', displayStatus: 'fresh', sourceInstanceId: 's', collectionId: 'c', lastSuccessfulFetchAt: '2026-11-14T09:30:00.000Z' },
      { owner: 'network', status: 'fresh', displayStatus: 'fresh' }] };
  const withheld = withholdHomebox(view);
  assert.deepEqual(withheld.entries, []);
  assert.deepEqual(withheld.caches, [{ owner: 'homebox', status: 'access-revoked', displayStatus: 'access-revoked' }, view.caches[1]]);
  assert.equal(view.entries.length, 1, 'The original view is unchanged');
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

console.log('PASS HomeBox refresh: server admission decides the button, first refresh without a cache, later 401 quarantine re-reads the view and withholds the copy, a failed re-read withholds HomeBox entries of the current same-home view, a quarantine is never presented as retryable, offline sends nothing, strict decoding');
