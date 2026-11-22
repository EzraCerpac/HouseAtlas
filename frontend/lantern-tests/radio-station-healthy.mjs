// Named ordinary positive: the Atlas radio station card and rings. Generated
// station responses through the closed decoder; freshness from the server's
// read age counted from the request's send, so waiting for an answer never
// extends it; a "Now playing" card only while fresh and playing (with its one
// Hide control), its tuck kept per viewer and home; decorative rings only while
// fresh, playing and placed in this publication, still for reduced motion; a
// feed whose expiry publishes a new state, which drops the reading and stops
// polling on 401/403 from either route until the viewer changes, fetches a
// cover only while it would show (aborted on hide, unwatch, a stopped reply or
// expiry, with a deadline and three tries per digest) and sends only GETs, only
// while watched and visible. Fake transport, timers, storage and visibility; no browser,
// network or device.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}, lang = 'ts') {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang, jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}
const reactURL = new URL('../node_modules/react/index.js', import.meta.url).href;
const jsxURL = new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href;
const { createElement } = await import(reactURL);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
const radioURL = await sourceURL('../src/lantern/unified-atlas/radio.ts');
const radio = await import(radioURL);
const { createRadioClient } = await import(await sourceURL('../integration/radio-station.ts', { '../src/lantern/unified-atlas/radio': radioURL }));
const card = await import(await sourceURL('../src/lantern/unified-atlas/RadioCard.tsx', { react: reactURL, 'react/jsx-runtime': jsxURL, './radio': radioURL }, 'tsx'));
const { decodeRadioStation, radioView, radioPlacement, radioFreshUntil, createRadioFeed, dialFraction, RadioRefused, RADIO_POLL_MS } = radio;
const { RadioCard, RadioRings, RadioRingsSlot, RadioCardSlot, RADIO_RING_M, radioTuckKey } = card;

const PUBLICATION = '00000000-0000-4000-8000-000000000009', SHA = 'a'.repeat(64);
const snapshot = (state, checkedAt, extra = {}) => ({ schema: 'houseatlas.now-playing.v1', state,
  since: state === 'unknown' ? null : '2026-01-01T12:00:02.000Z', checkedAt,
  track: state === 'playing' ? { title: 'Example title', artist: 'Example artist' } : null,
  lastTrack: { title: 'Example title', artist: 'Example artist' }, ...extra });
const station = (shot, readAt = '2026-01-01T12:00:10.000Z', placement = { publicationId: PUBLICATION, spaceOccurrenceId: 'occ-hall' }) => ({
  schema: 'houseatlas.radio-station.v1', frequencyKhz: 1440, placement, readAt, snapshot: shot });
const clone = value => JSON.parse(JSON.stringify(value));
const scope = { workspaceId: '00000000-0000-4000-8000-000000000002', homeId: '00000000-0000-4000-8000-000000000003' };
const place = { transform: 'matrix(1 0 0 1 0 0)', x: 2, z: 3 };
const fixedFeed = state => ({ subscribe: () => () => undefined, state: () => state, dispose() {} });
const cardSlot = (state, now, tuckKey = null) =>
  renderToStaticMarkup(createElement(RadioCardSlot, { feed: fixedFeed(state), placeName: () => 'Hallway', now: () => now, reduced: false, tuckKey }));
const ringsSlot = (state, now, placeAt = () => place) =>
  renderToStaticMarkup(createElement('svg', null, createElement(RadioRingsSlot, { feed: fixedFeed(state), place: placeAt, now: () => now, reduced: false })));

// The closed decoder.
{
  const playing = station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  const decoded = decodeRadioStation(playing);
  assert.equal(decoded.frequencyKhz, 1440);
  assert.deepEqual(decoded.snapshot.cover, { mediaType: 'image/png', sha256: SHA });
  assert.equal(decodeRadioStation(station(snapshot('playing', '2026-01-01T12:00:08.000Z', { track: null }))).snapshot.track, null, 'playing may have no current track');
  assert.equal(decodeRadioStation(station(null)).snapshot, null);
  assert.equal(decodeRadioStation({ ...station(null), frequencyKhz: null }).frequencyKhz, null, 'an absent station file reads as no frequency');
  assert.equal(decodeRadioStation(station(null, undefined, null)).placement, null);
  const mutations = [
    v => { v.schema = 'houseatlas.radio-station.v2'; },
    v => { v.extra = 1; },
    v => { v.lastCheckedAt = null; },
    v => { delete v.placement; },
    v => { delete v.frequencyKhz; },
    v => { v.frequencyKhz = '1440'; },
    v => { v.frequencyKhz = 1440.5; },
    v => { v.frequencyKhz = 519; },
    v => { v.frequencyKhz = 2000; },
    v => { v.placement.spaceOccurrenceId = 'hall way'; },
    v => { v.placement.publicationId = 'publication'; },
    v => { v.readAt = 'now'; },
    v => { v.snapshot.schema = 'houseatlas.now-playing.v2'; },
    v => { v.snapshot.state = 'paused'; },
    v => { v.snapshot.volume = 3; },
    v => { delete v.snapshot.lastTrack; },
    v => { v.snapshot.since = null; },
    v => { v.snapshot.state = 'stopped'; }, // a stopped snapshot cannot carry a current track
    v => { v.snapshot.track.album = 'x'; },
    v => { v.snapshot.track.title = 'a\u0007b'; },
    v => { v.snapshot.lastTrack.artist = 'x'.repeat(257); },
    v => { v.snapshot.cover = null; },
    v => { v.snapshot.cover.mediaType = 'image/gif'; },
    v => { v.snapshot.cover.sha256 = 'A'.repeat(64); },
    v => { v.snapshot.cover.base64 = ''; },
    v => { v.snapshot.lastTrack = null; },
  ];
  mutations.forEach((mutate, at) => {
    const value = clone(playing); mutate(value);
    assert.throws(() => decodeRadioStation(value), TypeError, `mutation ${at}`);
  });
}

// Freshness: the server's age at its read, counted from the request's send on the page's own clock.
const feedState = (value, sentAt = 1_000, cover = null) => {
  const decoded = decodeRadioStation(value);
  return { configured: true, station: decoded, freshUntil: radioFreshUntil(decoded, sentAt), cover };
};
{
  const fresh = feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z')));
  assert.equal(fresh.freshUntil, 1_000 + 13_000, 'checked 2 s before the server read');
  assert.ok(radioView(fresh, 1_000));
  assert.ok(radioView(fresh, 1_000 + 13_000));
  assert.equal(radioView(fresh, 1_000 + 13_001), null, '15 s after the helper last checked');
  assert.deepEqual(radioView(fresh, 1_000), { frequencyKhz: 1440, track: { title: 'Example title', artist: 'Example artist' }, coverUrl: null, checkedAt: '2026-01-01T12:00:08.000Z' });
  // A check ahead of the server's read counts as age 0; the server refuses more than 2 s ahead.
  assert.equal(feedState(station(snapshot('playing', '2026-01-01T12:00:11.000Z'))).freshUntil, 1_000 + 15_000);
  assert.equal(feedState(station(snapshot('playing', '2026-01-01T11:59:54.999Z'))).freshUntil, null, 'over 15 s old at the server');
  assert.equal(radioView({ ...fresh, freshUntil: null }, 1_000), null, 'an expired state shows nothing at any time');
  // Only a playing reading has a view.
  assert.equal(radioView(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z'))), 1_000), null);
  assert.equal(radioView(feedState(station(snapshot('unknown', '2026-01-01T12:00:09.000Z'))), 1_000), null);
  assert.equal(feedState(station(null)).freshUntil, null);
  assert.equal(radioView(feedState(station(null)), 1_000), null);
  assert.equal(radioView({ configured: false, station: null, freshUntil: null, cover: null }, 0), null);
  assert.equal(radioView(feedState({ ...station(snapshot('playing', '2026-01-01T12:00:08.000Z')), frequencyKhz: null }), 1_000).frequencyKhz, null);
  // The cover belongs to lastTrack: it shows only while that is the current track.
  const covered = { cover: { mediaType: 'image/png', sha256: SHA } }, held = { sha256: SHA, url: 'blob:cover' };
  assert.equal(radioView(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z', covered)), 1_000, held), 1_000).coverUrl, 'blob:cover');
  const changed = snapshot('playing', '2026-01-01T12:00:08.000Z', covered); changed.track = { title: 'Next title', artist: 'Example artist' };
  assert.equal(radioView(feedState(station(changed), 1_000, held), 1_000).coverUrl, null);
  assert.equal(radioView(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z', covered)), 1_000, { sha256: 'b'.repeat(64), url: 'blob:old' }), 1_000).coverUrl, null);
  assert.equal(dialFraction(520), 0); assert.equal(dialFraction(1710), 1); assert.equal(dialFraction(9999), 1);
}

// The card: what it says while playing, with a fixed clock text. Anything else shows none.
const time = iso => `T${iso.slice(11, 19)}`;
const markup = props => renderToStaticMarkup(createElement(RadioCard, { time, ...props }));
const visible = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
{
  const on = markup({ view: { frequencyKhz: 1440, track: { title: 'Example title', artist: 'Example artist' }, coverUrl: 'blob:cover', checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: 'Hallway' });
  assert.deepEqual(visible(on), ['Now playing · 1440 AM', 'Example title', 'Example artist', 'Checked T12:00:08', 'Transmitter in Hallway']);
  assert.match(on, /<section class="ua-radio" aria-label="Radio">/);
  assert.doesNotMatch(on, /role=|aria-live/, 'ambient: nothing is announced');
  assert.doesNotMatch(on, /[Oo]n air|kHz/, 'no broadcast claim');
  assert.match(on, /<img class="ua-radio-cover" src="blob:cover" alt=""/);
  assert.match(on, /<svg class="ua-radio-dial"[^>]*aria-hidden="true"/);
  assert.match(on, /<time dateTime="2026-01-01T12:00:08.000Z">/);
  assert.doesNotMatch(on, /<button|<input|<a /, 'no playback controls');
  const needle = Number(/class="ua-radio-needle" x1="([\d.]+)"/.exec(on)[1]);
  assert.ok(Math.abs(needle - (8 + dialFraction(1440) * 184)) < 0.06, `needle ${needle}`);
  const hiding = markup({ view: { frequencyKhz: 1440, track: null, coverUrl: null, checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: null, onHide: () => {} });
  assert.deepEqual(visible(hiding), ['Now playing · 1440 AM', 'No track details', 'Checked T12:00:08']);
  assert.deepEqual([...hiding.matchAll(/<button [^>]*>/g)].map(m => m[0]), ['<button type="button" class="ua-radio-hide" aria-label="Hide radio" title="Hide radio">']);
  // Without a stated frequency the header says only Now playing and the dial is omitted.
  const bare = markup({ view: { frequencyKhz: null, track: { title: 'Example title', artist: null }, coverUrl: null, checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: null });
  assert.deepEqual(visible(bare), ['Now playing', 'Example title', 'Checked T12:00:08']);
  assert.doesNotMatch(bare, /<svg class="ua-radio-dial|ua-radio-needle| AM/);
  const shown = cardSlot(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z'))), 1_000);
  assert.match(shown, /^<div class="ua-radio-dock"><section class="ua-radio" aria-label="Radio">/);
  assert.match(shown, /aria-label="Hide radio"/);
  assert.equal(cardSlot(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z'))), 20_000), '', 'stale: no card');
  assert.equal(cardSlot(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z'))), 1_000), '', 'stopped: no card');
  assert.equal(cardSlot(feedState(station(snapshot('unknown', '2026-01-01T12:00:08.000Z'))), 1_000), '', 'unknown: no card');
  assert.equal(cardSlot(feedState(station(null)), 1_000), '', 'no snapshot: no card');
  assert.equal(cardSlot({ configured: false, station: null, freshUntil: null, cover: null }, 0), '', 'no station: no card');
}

// The tuck: kept per viewer and home on this device; without a viewer, for the page only.
{
  const stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, String(value)); }, removeItem: key => { stored.delete(key); } } });
  const keyA = radioTuckKey('actor-a', scope.workspaceId, scope.homeId);
  assert.equal(keyA, `houseatlas.radio.tucked:["actor-a","${scope.workspaceId}","${scope.homeId}"]`);
  assert.equal(radioTuckKey(null, scope.workspaceId, scope.homeId), null);
  stored.set(keyA, '1');
  const playing = feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z')));
  assert.equal(cardSlot(playing, 1_000, keyA), '<button type="button" class="ua-radio-tab" aria-label="Show radio" title="Show radio"><span class="ua-radio-lamp" aria-hidden="true"></span><svg class="icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>');
  assert.match(cardSlot(playing, 1_000, radioTuckKey('actor-b', scope.workspaceId, scope.homeId)), /class="ua-radio-dock"/, 'another viewer keeps its own choice');
  assert.match(cardSlot(playing, 1_000, radioTuckKey('actor-a', scope.workspaceId, '00000000-0000-4000-8000-000000000006')), /class="ua-radio-dock"/, 'and so does another home');
  assert.match(cardSlot(playing, 1_000, null), /class="ua-radio-dock"/);
  assert.equal(cardSlot(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z'))), 1_000, keyA), '', 'no tab when nothing plays');
  delete globalThis.localStorage;
}

// Rings: decorative, only fresh, playing and placed in this publication; still for reduced motion.
{
  const scene = { publication: { publicationId: PUBLICATION }, occurrences: [{ spaceOccurrenceId: 'occ-hall' }, { spaceOccurrenceId: 'occ-living' }] };
  const at = value => radioPlacement(decodeRadioStation(value), scene);
  assert.equal(at(station(null)), 'occ-hall');
  assert.equal(at(station(null, undefined, null)), null);
  assert.equal(at(station(null, undefined, { publicationId: '00000000-0000-4000-8000-000000000008', spaceOccurrenceId: 'occ-hall' })), null);
  assert.equal(at(station(null, undefined, { publicationId: PUBLICATION, spaceOccurrenceId: 'occ-attic' })), null);
  const moving = renderToStaticMarkup(createElement('svg', null, createElement(RadioRings, { place, reduced: false })));
  assert.match(moving, /<g class="ua-radio-rings" transform="[^"]+" aria-hidden="true">/);
  assert.equal((moving.match(/<circle /g) ?? []).length, 5);
  assert.equal((moving.match(new RegExp(`r="${RADIO_RING_M}"`, 'g')) ?? []).length, 5);
  assert.deepEqual([...moving.matchAll(/animation-delay:(-?[\d.]+)s/g)].map(m => Number(m[1])), [0, -1.2, -2.4, -3.6, -4.8]);
  assert.match(moving, /vector-effect="non-scaling-stroke"/);
  const still = renderToStaticMarkup(createElement('svg', null, createElement(RadioRings, { place, reduced: true })));
  assert.match(still, /class="ua-radio-rings is-still"/);
  assert.doesNotMatch(still, /animation/);
  assert.deepEqual([...still.matchAll(/ r="([\d.]+)"/g)].map(m => Number(m[1])), [0.9, 1.8, 2.7, 3.6, 4.5]);
  assert.match(ringsSlot(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z'))), 1_000), /ua-radio-rings/);
  assert.doesNotMatch(ringsSlot(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z'))), 20_000), /ua-radio-rings/, 'stale');
  assert.doesNotMatch(ringsSlot(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z'))), 1_000), /ua-radio-rings/, 'stopped');
  assert.doesNotMatch(ringsSlot(feedState(station(snapshot('unknown', '2026-01-01T12:00:08.000Z'))), 1_000), /ua-radio-rings/, 'unknown');
  assert.doesNotMatch(ringsSlot(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z'))), 1_000, () => null), /ua-radio-rings/, 'unplaced or floor not drawn');
}

// Fake timers, clock, object URLs and visibility for the feed.
function harness() {
  const timers = new Map(), revoked = [];
  let clock = 0, hidden = false, nextTimer = 1, visibility = null, urls = 0;
  const env = {
    now: () => clock, hidden: () => hidden,
    onVisibility(changed) { visibility = changed; return () => { visibility = null; }; },
    setTimeout(run, ms) { const id = nextTimer++; timers.set(id, { run, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    createObjectURL: () => `blob:${++urls}`, revokeObjectURL: url => { revoked.push(url); },
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const advance = async ms => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; due[1].run(); await settle();
    }
    clock = until;
  };
  return { env, settle, advance, revoked, now: () => clock, hide: value => { hidden = value; visibility?.(); }, watched: () => visibility !== null };
}
const pending = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

// Expiry publishes a new state, so a stale card and rings leave on time while reads hang or fail.
{
  const h = harness();
  let answer = () => decodeRadioStation(station(snapshot('playing', '2026-01-01T12:00:08.000Z')));
  const port = { read: (_scope, signal) => answer(signal), cover: () => Promise.reject(new Error('none')) };
  const feed = createRadioFeed(port, scope, h.env), seen = [];
  const stop = feed.subscribe(() => { seen.push(feed.state()); });
  await h.settle();
  const fresh = feed.state();
  assert.equal(fresh.freshUntil, 13_000);
  answer = pending; seen.length = 0;
  await h.advance(13_000);
  assert.equal(seen.length, 0, 'a hanging read publishes nothing');
  assert.ok(radioView(feed.state(), h.now()), 'still fresh at 13 s');
  await h.advance(1);
  assert.equal(seen.length, 1, 'expiry notifies');
  const expired = seen[0];
  assert.notEqual(expired, fresh, 'with a new state, so useSyncExternalStore renders again');
  assert.equal(expired.freshUntil, null);
  assert.equal(radioView(expired, 0), null, 'the expired state shows nothing, whatever the clock');
  assert.equal(cardSlot(expired, h.now()), '', 'no card');
  assert.equal(ringsSlot(expired, h.now()), '<svg></svg>', 'no rings');
  answer = () => Promise.reject(new Error('offline'));
  await h.advance(RADIO_POLL_MS * 3);
  assert.equal(seen.length, 1, 'failed reads publish nothing more');
  stop(); feed.dispose();
}
// Time spent waiting for the answer counts: 14 s old at the server and 3 s in flight is not shown.
{
  const h = harness();
  const answer = () => decodeRadioStation(station(snapshot('playing', '2026-01-01T12:00:00.000Z'), '2026-01-01T12:00:14.000Z'));
  const port = { read: () => new Promise(resolve => h.env.setTimeout(() => resolve(answer()), 3_000)), cover: () => Promise.reject(new Error('none')) };
  const feed = createRadioFeed(port, scope, h.env), stop = feed.subscribe(() => undefined);
  await h.advance(3_000);
  assert.equal(feed.state().configured, true);
  assert.equal(feed.state().freshUntil, null);
  assert.equal(radioView(feed.state(), h.now()), null);
  assert.equal(cardSlot(feed.state(), h.now()), '');
  assert.equal(radioFreshUntil(feed.state().station, 3_000), 4_000, 'counted from receipt it would have shown');
  stop(); feed.dispose();
}

// Covers: asked for only while they would show, aborted when hidden or unwatched, with a deadline and three tries per digest.
{
  const h = harness(), calls = [];
  const covered = station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  const otherTrack = clone(covered); otherTrack.snapshot.track = { title: 'Next title', artist: null };
  let reply = otherTrack, failing = false;
  const port = {
    read: async () => decodeRadioStation(reply),
    cover: (_scope, sha256, signal) => { calls.push({ sha256, signal }); return failing ? Promise.reject(new Error('offline')) : pending(signal); },
  };
  const feed = createRadioFeed(port, scope, h.env);
  let stop = feed.subscribe(() => undefined);
  await h.settle();
  assert.equal(calls.length, 0, 'the cover of another track is not asked for');
  reply = covered;
  await h.advance(RADIO_POLL_MS);
  assert.equal(calls.length, 1);
  h.hide(true);
  assert.ok(calls[0].signal.aborted, 'hiding aborts it');
  h.hide(false); await h.settle();
  assert.equal(calls.length, 2, 'asked again once shown');
  stop();
  assert.ok(calls[1].signal.aborted, 'unwatching aborts it');
  stop = feed.subscribe(() => undefined); await h.settle();
  assert.equal(calls.length, 3);
  await h.advance(10_000);
  assert.ok(calls[2].signal.aborted, 'a cover that does not answer is given up after 10 s');
  failing = true;
  await h.advance(RADIO_POLL_MS * 6);
  assert.equal(calls.length, 5, 'retried on later polls, three failed tries per digest');
  assert.ok(calls.every(call => call.sha256 === SHA));
  assert.equal(feed.state().cover, null);
  stop(); feed.dispose();
}
// A pending cover is aborted as soon as the view no longer needs it: a stopped reply, or expiry.
{
  const h = harness(), calls = [];
  // Ten seconds old at the server: believed for five seconds from each send, inside the cover's 10 s deadline.
  const covered = station(snapshot('playing', '2026-01-01T12:00:00.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  let reply = covered;
  const port = {
    read: (_scope, signal) => reply === 'hang' ? pending(signal) : Promise.resolve(decodeRadioStation(reply)),
    cover: (_scope, sha256, signal) => { calls.push({ sha256, signal }); return pending(signal); },
  };
  const feed = createRadioFeed(port, scope, h.env), stop = feed.subscribe(() => undefined);
  await h.settle();
  assert.equal(calls.length, 1);
  reply = station(snapshot('stopped', '2026-01-01T12:00:00.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  await h.advance(RADIO_POLL_MS);
  assert.ok(calls[0].signal.aborted, 'a stopped reply aborts it');
  reply = covered;
  await h.advance(RADIO_POLL_MS);
  assert.equal(calls.length, 2, 'asked again once it would show');
  reply = 'hang';
  await h.advance(RADIO_POLL_MS + 1_000);
  assert.ok(!calls[1].signal.aborted && radioView(feed.state(), h.now()), 'still fresh, still asked for');
  await h.advance(1);
  assert.equal(radioView(feed.state(), h.now()), null);
  assert.ok(calls[1].signal.aborted, 'expiry aborts it');
  assert.equal(calls.length, 2);
  stop(); feed.dispose();
}
// A refusal observed on a cover request that a newer reading already made unnecessary still drops the reading and stops.
{
  const h = harness(), calls = [], reads = [];
  let reply = station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  const port = {
    read: () => { reads.push(1); return Promise.resolve(decodeRadioStation(reply)); },
    cover: (_scope, sha256, signal) => new Promise((_, reject) => calls.push({ sha256, signal, reject })),
  };
  const feed = createRadioFeed(port, scope, h.env), stop = feed.subscribe(() => undefined);
  await h.settle();
  assert.equal(calls.length, 1);
  reply = station(snapshot('playing', '2026-01-01T12:00:08.000Z', { track: { title: 'Replacement', artist: null }, lastTrack: { title: 'Replacement', artist: null } }));
  await h.advance(RADIO_POLL_MS);
  assert.ok(calls[0].signal.aborted && radioView(feed.state(), h.now()), 'the replacement song shows and the old cover request is dropped');
  calls[0].reject(new RadioRefused()); await h.settle();
  assert.deepEqual(feed.state(), { configured: null, station: null, freshUntil: null, cover: null }, 'the superseded refusal still drops the reading');
  const after = reads.length;
  await h.advance(RADIO_POLL_MS * 3);
  assert.equal(reads.length, after, 'and polling stops');
  stop(); feed.dispose();
}

// The feed and client: GETs only, only while watched and visible; 401 and 403 drop the reading.
{
  const requests = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const pngSha = Buffer.from(await crypto.subtle.digest('SHA-256', png)).toString('hex');
  let reply = () => station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: pngSha } }));
  let coverRefusal = null;
  const transport = async (url, init) => {
    requests.push({ url, method: init.method, credentials: init.credentials, cache: init.cache, body: init.body });
    if (coverRefusal && url.endsWith(`/covers/${coverRefusal.sha}`)) return new Response('', { status: coverRefusal.status });
    if (url.includes('/covers/')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    const value = reply();
    return typeof value === 'number' ? new Response('', { status: value }) : new Response(JSON.stringify(value), { status: 200 });
  };
  const h = harness();
  // The client: exact routes, GET, same-origin, no-store, digest-checked cover, refusals distinguished.
  const client = createRadioClient(transport);
  const coverBlob = await client.cover(scope, pngSha, AbortSignal.timeout(1000));
  assert.equal(coverBlob.type, 'image/png');
  await assert.rejects(client.cover(scope, SHA, AbortSignal.timeout(1000)), TypeError, 'bytes must match their digest');
  await assert.rejects(client.cover(scope, '../station', AbortSignal.timeout(1000)), TypeError);
  for (const status of [401, 403]) {
    reply = () => status; await assert.rejects(client.read(scope, AbortSignal.timeout(1000)), RadioRefused);
    coverRefusal = { sha: pngSha, status }; await assert.rejects(client.cover(scope, pngSha, AbortSignal.timeout(1000)), RadioRefused);
  }
  coverRefusal = null;
  reply = () => 500;
  await assert.rejects(client.read(scope, AbortSignal.timeout(1000)), error => !(error instanceof RadioRefused));
  reply = () => station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: pngSha } }));
  requests.length = 0;
  const feed = createRadioFeed(client, scope, h.env);
  await h.settle();
  assert.equal(requests.length, 0, 'nothing is read until someone watches');
  let notified = 0;
  const stop = feed.subscribe(() => { notified++; });
  await h.settle();
  assert.equal(requests.length, 2, 'station, then its cover once');
  assert.equal(requests[0].url, `/api/atlas/radio/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/station`);
  assert.equal(requests[1].url, `/api/atlas/radio/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/covers/${pngSha}`);
  assert.equal(feed.state().cover.url, 'blob:1');
  assert.equal(radioView(feed.state(), h.now()).coverUrl, 'blob:1');
  assert.ok(notified >= 2);
  await h.advance(RADIO_POLL_MS - 1);
  assert.equal(requests.length, 2);
  await h.advance(1);
  assert.equal(requests.length, 3, 'about every four seconds');
  await h.advance(RADIO_POLL_MS * 2);
  assert.equal(requests.length, 5, 'the same cover digest is not fetched again');
  // Hidden: polling stops and the reading expires; showing again reads at once.
  h.hide(true); await h.advance(RADIO_POLL_MS * 5);
  assert.equal(requests.length, 5);
  assert.equal(radioView(feed.state(), h.now()), null, 'the last answer expires');
  h.hide(false); await h.settle();
  assert.equal(requests.length, 6);
  // A failed read keeps the last answer until it expires; the next poll still runs.
  reply = () => 500;
  await h.advance(RADIO_POLL_MS); assert.equal(requests.length, 7);
  assert.ok(feed.state().station && feed.state().cover, 'a transport failure keeps the reading');
  // No watcher: no requests.
  const beforeStop = requests.length;
  stop(); await h.advance(RADIO_POLL_MS * 5);
  assert.equal(requests.length, beforeStop);
  assert.equal(h.watched(), false);
  feed.dispose();
  // 401 and 403 from either route drop the reading and its held cover at once
  // and stop polling, until the feed is made again or the signed-in viewer changes.
  const coveredBy = sha => () => station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: sha } }));
  for (const [status, route] of [[401, 'station'], [403, 'station'], [401, 'cover'], [403, 'cover']]) {
    let viewer = 'actor-a';
    reply = coveredBy(pngSha); coverRefusal = null;
    const refusing = createRadioFeed({ ...client, viewer: () => viewer }, scope, h.env), off = refusing.subscribe(() => undefined);
    await h.settle();
    const url = refusing.state().cover.url;
    assert.equal(radioView(refusing.state(), h.now()).coverUrl, url);
    if (route === 'station') reply = () => status;
    else { reply = coveredBy(SHA); coverRefusal = { sha: SHA, status }; }
    await h.advance(RADIO_POLL_MS);
    assert.deepEqual(refusing.state(), { configured: null, station: null, freshUntil: null, cover: null }, `${status} from the ${route} route drops the reading`);
    assert.equal(h.revoked.at(-1), url, `${status} from the ${route} route revokes the held cover`);
    assert.equal(cardSlot(refusing.state(), h.now()), '');
    const refusedAt = requests.length;
    await h.advance(RADIO_POLL_MS * 5);
    h.hide(true); h.hide(false); await h.settle();
    assert.equal(requests.length, refusedAt, `no polling after ${status} from the ${route} route, even when the page shows again`);
    viewer = 'actor-b'; reply = coveredBy(pngSha); coverRefusal = null;
    h.hide(true); h.hide(false); await h.settle();
    assert.ok(radioView(refusing.state(), h.now()), 'another signed-in viewer reads again');
    off(); refusing.dispose();
  }
  const beforeUnconfigured = requests.length;
  // A home without a station: one read, then no card and no polling.
  reply = () => 404;
  const unconfigured = createRadioFeed(client, scope, h.env), stop2 = unconfigured.subscribe(() => undefined);
  await h.settle(); await h.advance(RADIO_POLL_MS * 3);
  assert.equal(requests.length, beforeUnconfigured + 1);
  assert.equal(unconfigured.state().configured, false);
  assert.equal(radioView(unconfigured.state(), h.now()), null);
  stop2(); unconfigured.dispose();
  assert.deepEqual(new Set(requests.map(r => r.method)), new Set(['GET']), 'browsing sends only GETs');
  assert.ok(requests.every(r => r.body === undefined && r.credentials === 'same-origin' && r.cache === 'no-store'));
}
console.log('INFO radio station: decoder, freshness and expiry, card, tuck keys, rings, covers, refusal stop and GET-only feed');
