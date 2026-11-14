// Healthy generated checks for the Editor-only "Refresh from HomeBox" control
// and its "Recheck HomeBox access" replacement after a revocation,
// driven through the production controller that the button renders: the
// server's admission read decides whether it is offered, a press is the only
// POST, and every recorded answer re-reads the view. A generated server model
// with the route's answer shapes; no browser, network, HomeBox or credential.
import assert from 'node:assert/strict';
import { createRefreshOwner, decodeAvailability, decodeRecheckResult, decodeRefreshResult, describeRefresh, ownerOf, requestRefresh } from '../src/lantern/homebox-refresh.ts';
import { shownView, withholdHomebox } from '../src/lantern/homebox-withheld.ts';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const format = iso => iso.slice(0, 16).replace('T', ' ');
const scope = { workspaceId: 'w 1', homeId: 'h/2' };
const ROUTE = '/api/atlas/providers/homebox/workspaces/w%201/homes/h%2F2/refresh';
const RECHECK = '/api/atlas/providers/homebox/workspaces/w%201/homes/h%2F2/recheck';

/** The routes' rules over one in-memory cache: admission, CSRF POST, 401
 * quarantine, and the recheck where the profile names it. */
function server({ role = 'editor', approved = true, configured = true, recheck = false } = {}) {
  const model = { cache: null, upstream: 'ok', calls: [], refreshes: 0, rechecks: 0, now: '2026-11-14T09:30:00.000Z' };
  model.transport = async (path, init) => {
    model.calls.push([init.method, path]);
    assert.equal(init.credentials, 'same-origin');
    if (path === '/api/atlas/auth/session') return Response.json({ schemaVersion: 1, actorId: 'a1', csrfToken: 'csrf-1' });
    if (init.method === 'GET') {
      assert.equal(path, ROUTE);
      // One answer for every ineligible caller, configured or not.
      return Response.json(configured && role === 'editor' && approved ? { status: 'available', recheck } : { status: 'unavailable' });
    }
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
    if (role !== 'editor') return new Response(null, { status: 403 });
    if (path === RECHECK) {
      if (!configured || !recheck) return Response.json({ status: 'not-configured' });
      if (model.cache?.status !== 'access-revoked') return Response.json({ status: 'not-needed' });
      model.rechecks += 1;
      // A failed recheck writes nothing; only a complete read lifts the quarantine.
      if (model.upstream !== 'ok') return Response.json({ status: 'failed', reason: 'auth' });
      model.cache = { status: 'fresh', lastSuccessfulFetchAt: model.now, entries: ['generated entity'] };
      return Response.json({ status: 'rechecked', cache: { status: 'fresh', lastSuccessfulFetchAt: model.now, lastAttemptAt: model.now, errorCode: null } });
    }
    assert.equal(path, ROUTE);
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
const SESSION = 'session-1';
const token = { ...scope, session: SESSION };
/** The production owner as a live host holds it, whose shown home and
 * session are `model.current` (default: the pressed ones), seen through one
 * button for `token`. Each press supplies the host's reload and withholding. */
function control(model, transport = model.transport) {
  model.live = true;
  const owner = createRefreshOwner({ transport, online: () => model.online !== false,
    live: () => model.live,
    current: () => model.current === undefined ? token : model.current,
    reload: () => model.hostReload(),
    withhold: (pressed, on) => { assert.deepEqual(pressed, token); model.hostWithhold(on); } });
  model.detach = () => { model.live = false; };
  return {
    check: signal => owner.check(token, signal),
    getSnapshot: () => owner.stateFor(token),
    subscribe: owner.subscribe,
    press(reload, withhold, action) { model.hostReload = reload; model.hostWithhold = withhold; return owner.press(token, action); },
  };
}
const say = state => state.result ? describeRefresh(state.result, format, state.reconciled, state.recheck) : '';

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
  const ordinary = control({}, timeout);
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

// The continuation is fenced: switching home, signing out or tearing down the
// host while the POST or the re-read is pending drops it. No read for the
// pressed home is issued, nothing is withheld, no status is kept, and the other
// home's view and its pending read stay as they are. The server's result stands.
for (const upstream of ['ok', 'unauthorized']) {
  const cases = {
    'home switched': model => { model.current = { workspaceId: 'w 1', homeId: 'other', session: SESSION }; },
    'signed out': model => { model.current = { ...scope, session: undefined }; },
    'host torn down': model => { model.detach(); },
  };
  for (const [name, leave] of Object.entries(cases)) for (const during of ['post', 'reload']) {
    const model = server(), refresh = control(model);
    await refresh.check();
    model.upstream = upstream;
    // An App-like owner: the shown view and a pending read that a new read would abort.
    const app = { shown: 'other home', pending: { aborted: false }, reads: [], withheld: [] };
    const reload = async () => {
      if (during === 'reload') { leave(model); return false; }
      app.reads.push('pressed home'); app.pending.aborted = true; app.shown = 'pressed home'; return true;
    };
    if (during === 'post') model.duringPost = () => leave(model);
    await refresh.press(reload, on => { app.withheld.push(on); });
    const label = `${upstream} ${name} during ${during}`;
    assert.equal(model.refreshes, 1, label);
    assert.deepEqual(app, { shown: 'other home', pending: { aborted: false }, reads: [], withheld: [] }, label);
    assert.deepEqual(refresh.getSnapshot(), { offered: false, recheck: false, busy: false, result: null, reconciled: true }, `${label}: nothing kept`);
  }
}

// The button is only a view of the host's state: closing the panel or
// selecting a record in the same home mid-refresh drops nothing. The host still
// re-reads (and withholds after a 401 whose re-read failed); a button mounted
// meanwhile shows the refresh running and cannot start a second one, and one
// mounted afterwards shows the result.
for (const upstream of ['ok', 'unauthorized']) {
  const model = server(), refresh = control(model);
  await refresh.check();
  model.upstream = upstream;
  const app = { reads: 0, withheld: [] };
  const unmount = refresh.subscribe(() => {});
  const reload = async () => { app.reads += 1; return upstream === 'ok'; }, withhold = on => { app.withheld.push(on); };
  let remounted;
  model.duringPost = () => {
    unmount();
    remounted = refresh.getSnapshot();
    void refresh.press(reload, withhold);
  };
  await refresh.press(reload, withhold);
  assert.equal(remounted.busy, true);
  assert.equal(model.refreshes, 1, 'One refresh at a time per home and session');
  assert.equal(app.reads, 1);
  assert.deepEqual(app.withheld, [upstream === 'ok' ? false : true]);
  assert.equal(say(refresh.getSnapshot()), upstream === 'ok'
    ? 'Refreshed from HomeBox 2026-11-14 09:30.'
    : 'Not refreshed: HomeBox refused the configured credential. Access revoked: HomeBox entries are withheld here, and refreshing cannot restore them on this server yet.');
}
// An availability answer that arrives after the home changed is dropped too.
{
  const model = server();
  const refresh = control(model, async (path, init) => {
    model.current = { workspaceId: 'w 1', homeId: 'other', session: SESSION };
    return model.transport(path, init);
  });
  await refresh.check();
  assert.equal(refresh.getSnapshot().offered, false, 'Nothing is offered for a home no longer shown');
}

// The session ends (sign-out or another account) while the availability read is
// in flight: the button's effect aborts it with the token it was asked for, the
// GET's own signal is aborted, and an answer that still arrives is not applied.
// Without the abort, the session fence alone still drops it.
for (const aborted of [true, false]) {
  const model = server(), button = new AbortController();
  let sent;
  const refresh = control(model, async (path, init) => {
    sent = init.signal;
    model.current = { ...scope, session: aborted ? undefined : 'session-2' };
    if (aborted) button.abort();
    return model.transport(path, init);
  });
  await refresh.check(button.signal);
  assert.equal(sent.aborted, aborted, 'the GET carries the button\'s signal');
  assert.deepEqual(refresh.getSnapshot(), { offered: false, recheck: false, busy: false, result: null, reconciled: true }, 'no late admission is applied');
  assert.deepEqual(model.calls, [['GET', ROUTE]], 'one admission read, no POST');
}

// Recheck: offered only where the server names it. After a revocation it is
// the one way back, a failure changes nothing, and success re-reads the view.
{
  const model = server({ recheck: true }), refresh = control(model);
  await refresh.check();
  assert.deepEqual(refresh.getSnapshot(), { offered: true, recheck: true, busy: false, result: null, reconciled: true });
  await refresh.press(model.reload, model.withhold);
  model.upstream = 'unauthorized';
  await refresh.press(model.reload, model.withhold);
  assert.equal(say(refresh.getSnapshot()), 'Not refreshed: HomeBox refused the configured credential. Access revoked: the saved HomeBox copy is withheld, and only a recheck of HomeBox access can restore it.');
  let reloads = 0;
  const reload = async () => { reloads += 1; return model.reload(); };
  const shown = model.view, withheld = [];
  await refresh.press(reload, on => { withheld.push(on); }, 'recheck');
  assert.equal(model.rechecks, 1);
  assert.equal(reloads, 0, 'A failed recheck wrote nothing, so the view is not re-read');
  assert.equal(model.view, shown);
  assert.deepEqual(withheld, []);
  assert.equal(say(refresh.getSnapshot()), 'Access not restored: HomeBox refused the configured credential. HomeBox entries stay withheld.');
  model.upstream = 'ok';
  await refresh.press(reload, on => { withheld.push(on); }, 'recheck');
  assert.equal(model.rechecks, 2);
  assert.equal(reloads, 1);
  assert.deepEqual(withheld, [false]);
  assert.deepEqual(model.view.caches, [{ status: 'fresh', lastSuccessfulFetchAt: model.now, entries: ['generated entity'] }]);
  assert.equal(say(refresh.getSnapshot()), 'Access restored: refreshed from HomeBox 2026-11-14 09:30.');
  // Nothing to recheck once access is back; the server sends nothing upstream.
  await refresh.press(reload, () => {}, 'recheck');
  assert.equal(model.rechecks, 2);
  assert.equal(say(refresh.getSnapshot()), 'HomeBox access is not revoked; nothing was rechecked.');
}
// Where the server does not offer it, a recheck press sends nothing.
{
  const model = server(), refresh = control(model);
  await refresh.check();
  assert.equal(refresh.getSnapshot().recheck, false);
  const before = model.calls.length;
  await refresh.press(model.reload, model.withhold, 'recheck');
  assert.equal(model.calls.length, before);
}

// The lazily loaded button keeps one owner per host port, so a remounted
// button sees the same refresh; the port itself holds no controller code.
{
  const port = { live: () => true, current: () => token, reload: async () => true, withhold: () => {} };
  const first = ownerOf(port);
  assert.equal(ownerOf(port), first);
  assert.equal(port.owner, first);
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
    assert.throws(() => decodeRecheckResult(bad), TypeError);
    assert.throws(() => decodeAvailability(bad), TypeError);
  }
  assert.throws(() => decodeAvailability({ status: 'available', recheck: 'yes' }), TypeError);
  assert.deepEqual(decodeAvailability({ status: 'available' }), { offered: true, recheck: false });
  assert.deepEqual(decodeRecheckResult({ status: 'failed', reason: 'wrong-scope' }), { kind: 'recheck-failed', reason: 'wrong-scope' });
  assert.equal(describeRefresh(decodeRecheckResult({ status: 'failed', reason: 'timeout' }), format),
    'Access not restored: HomeBox did not answer in time. HomeBox entries stay withheld.');
  assert.equal(describeRefresh(decodeRecheckResult({ status: 'failed', reason: 'records-missing' }), format),
    'Access not restored: HomeBox did not return every record saved for this source. HomeBox entries stay withheld.');
  const model = server();
  for (const [answer, expected] of [[{ status: 'running' }, 'A refresh is already running. Try again when it finishes.'],
    [{ status: 'not-configured' }, 'Refreshing from HomeBox is not set up on this server.']]) {
    const transport = async (path, init) => init.method === 'POST' ? Response.json(answer) : model.transport(path, init);
    assert.equal(describeRefresh(await requestRefresh(scope, transport, true), format), expected);
  }
  assert.deepEqual(await requestRefresh(scope, async () => new Response(null, { status: 401 }), true), { kind: 'denied' });
  assert.deepEqual(await requestRefresh(scope, async () => { throw new TypeError('Generated network unavailable'); }, true), { kind: 'unreachable' });
}

console.log('PASS HomeBox refresh: server admission decides the button, first refresh without a cache, later 401 quarantine re-reads the view and withholds the copy, a failed re-read withholds HomeBox entries of the current same-home view, a quarantine is never presented as retryable, closing the panel mid-refresh still reconciles and a remount shows it running then its result, a home switch, sign-out or host teardown during the POST or re-read drops the whole continuation, a session ending during the admission read aborts it and applies nothing, the access recheck is offered only where the server names it, a failed recheck changes nothing and a successful one re-reads the view, offline sends nothing, strict decoding');
