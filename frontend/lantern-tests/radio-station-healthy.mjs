// Named ordinary positive: the Atlas radio station card and rings. Generated
// station responses through the closed decoder, the 15-second freshness rule on
// the server's clock plus the page's own elapsed time, the three card states,
// rings only while fresh, on air and placed in this publication, still rings
// for reduced motion, and a feed that sends only GETs, only while watched and
// visible. Fake transport, timers and visibility; no browser, network or device.
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
const { decodeRadioStation, radioView, radioPlacement, radioExpiry, createRadioFeed, dialFraction, RADIO_POLL_MS } = radio;
const { RadioCard, RadioRings, RadioRingsSlot, RadioCardSlot, RADIO_RING_M } = card;

const PUBLICATION = '00000000-0000-4000-8000-000000000009', SHA = 'a'.repeat(64);
const snapshot = (state, checkedAt, extra = {}) => ({ schema: 'houseatlas.now-playing.v1', state,
  since: state === 'unknown' ? null : '2026-01-01T12:00:02.000Z', checkedAt,
  track: state === 'playing' ? { title: 'Example title', artist: 'Example artist' } : null,
  lastTrack: { title: 'Example title', artist: 'Example artist' }, ...extra });
const station = (shot, readAt = '2026-01-01T12:00:10.000Z', placement = { publicationId: PUBLICATION, spaceOccurrenceId: 'occ-hall' }) => ({
  schema: 'houseatlas.radio-station.v1', frequencyKhz: 1440, placement, readAt,
  lastCheckedAt: shot?.checkedAt ?? null, snapshot: shot });
const clone = value => JSON.parse(JSON.stringify(value));

// The closed decoder.
{
  const playing = station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: SHA } }));
  const decoded = decodeRadioStation(playing);
  assert.equal(decoded.frequencyKhz, 1440);
  assert.deepEqual(decoded.snapshot.cover, { mediaType: 'image/png', sha256: SHA });
  assert.equal(decodeRadioStation(station(null)).snapshot, null);
  assert.equal(decodeRadioStation(station(null, undefined, null)).placement, null);
  assert.equal(decodeRadioStation({ ...station(null), lastCheckedAt: '2026-01-01T11:59:00.000Z' }).lastCheckedAt, '2026-01-01T11:59:00.000Z');
  const mutations = [
    v => { v.schema = 'houseatlas.radio-station.v2'; },
    v => { v.extra = 1; },
    v => { delete v.placement; },
    v => { v.frequencyKhz = 1440.5; },
    v => { v.frequencyKhz = 2000; },
    v => { v.placement.spaceOccurrenceId = 'hall way'; },
    v => { v.placement.publicationId = 'publication'; },
    v => { v.readAt = 'now'; },
    v => { v.lastCheckedAt = null; },
    v => { v.snapshot.schema = 'houseatlas.now-playing.v2'; },
    v => { v.snapshot.state = 'paused'; },
    v => { v.snapshot.volume = 3; },
    v => { delete v.snapshot.lastTrack; },
    v => { v.snapshot.since = null; },
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

// Freshness: the server's age at read plus the page's elapsed time, never mixed clocks.
const feedState = (value, receivedAt = 1_000, cover = null) => ({ configured: true, station: decodeRadioStation(value), receivedAt, cover });
{
  const fresh = feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z')));
  assert.equal(radioView(fresh, 1_000).kind, 'on-air');
  assert.equal(radioView(fresh, 1_000 + 13_000).kind, 'on-air');
  assert.equal(radioView(fresh, 1_000 + 13_001).kind, 'unknown', '15 s after the helper last checked');
  assert.equal(radioExpiry(fresh), 1_000 + 13_001);
  assert.deepEqual(radioView(fresh, 20_000), { kind: 'unknown', frequencyKhz: 1440, lastCheckedAt: '2026-01-01T12:00:08.000Z' });
  // A check far ahead of the server's read, an unknown state, or no snapshot is unknown.
  assert.equal(radioView(feedState(station(snapshot('playing', '2026-01-01T12:00:12.001Z'))), 1_000).kind, 'unknown');
  assert.equal(radioView(feedState(station(snapshot('unknown', '2026-01-01T12:00:09.000Z'))), 1_000).kind, 'unknown');
  assert.deepEqual(radioView(feedState({ ...station(null), lastCheckedAt: '2026-01-01T11:59:00.000Z' }), 1_000),
    { kind: 'unknown', frequencyKhz: 1440, lastCheckedAt: '2026-01-01T11:59:00.000Z' });
  assert.equal(radioExpiry(feedState(station(null))), null);
  assert.deepEqual(radioView({ configured: false, station: null, receivedAt: 0, cover: null }, 0), { kind: 'none' });
  // The cover belongs to lastTrack: off air it shows; on air only while that is the current track.
  const covered = { cover: { mediaType: 'image/png', sha256: SHA } }, held = { sha256: SHA, url: 'blob:cover' };
  assert.equal(radioView(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z', covered)), 1_000, held), 1_000).coverUrl, 'blob:cover');
  assert.equal(radioView(feedState(station(snapshot('playing', '2026-01-01T12:00:08.000Z', covered)), 1_000, held), 1_000).coverUrl, 'blob:cover');
  const changed = snapshot('playing', '2026-01-01T12:00:08.000Z', covered); changed.track = { title: 'Next title', artist: 'Example artist' };
  assert.equal(radioView(feedState(station(changed), 1_000, held), 1_000).coverUrl, null);
  assert.equal(radioView(feedState(station(snapshot('stopped', '2026-01-01T12:00:08.000Z', covered)), 1_000, { sha256: 'b'.repeat(64), url: 'blob:old' }), 1_000).coverUrl, null);
  assert.equal(dialFraction(520), 0); assert.equal(dialFraction(1710), 1); assert.equal(dialFraction(9999), 1);
}

// Card states: what each one says, with a fixed clock text.
const time = iso => `T${iso.slice(11, 19)}`;
const markup = props => renderToStaticMarkup(createElement(RadioCard, { time, ...props }));
const visible = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
{
  const on = markup({ view: { kind: 'on-air', frequencyKhz: 1440, track: { title: 'Example title', artist: 'Example artist' }, coverUrl: 'blob:cover', checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: 'Hallway' });
  assert.deepEqual(visible(on), ['On air · 1440 kHz', 'Example title', 'Example artist', 'Checked T12:00:08', 'Transmitter in Hallway']);
  assert.match(on, /<section class="ua-radio is-on-air" aria-label="Radio">/);
  assert.match(on, /role="status"/);
  assert.match(on, /<img class="ua-radio-cover" src="blob:cover" alt=""/);
  assert.match(on, /<svg class="ua-radio-dial is-lit"[^>]*aria-hidden="true"/);
  assert.match(on, /<time dateTime="2026-01-01T12:00:08.000Z">/);
  assert.doesNotMatch(on, /<button|<input|<a /, 'no playback controls');
  const needle = Number(/class="ua-radio-needle" x1="([\d.]+)"/.exec(on)[1]);
  assert.ok(Math.abs(needle - (8 + dialFraction(1440) * 184)) < 0.06, `needle ${needle}`);
  const off = markup({ view: { kind: 'off-air', frequencyKhz: 1440, lastTrack: { title: 'Example title', artist: null }, coverUrl: null, checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: null });
  assert.deepEqual(visible(off), ['Off air · 1440 kHz', 'Last played', 'Example title', 'Checked T12:00:08']);
  assert.match(off, /<svg class="ua-radio-dial"/);
  assert.doesNotMatch(off, /<img/);
  assert.deepEqual(visible(markup({ view: { kind: 'off-air', frequencyKhz: 1440, lastTrack: null, coverUrl: null, checkedAt: '2026-01-01T12:00:08.000Z' }, placeName: null })),
    ['Off air · 1440 kHz', 'Last played', 'No track details', 'Checked T12:00:08']);
  const unknown = markup({ view: { kind: 'unknown', frequencyKhz: 1440, lastCheckedAt: '2026-01-01T11:59:00.000Z' }, placeName: 'Hallway' });
  assert.deepEqual(visible(unknown), ['Unknown · 1440 kHz', 'Last confirmed T11:59:00', 'Transmitter in Hallway']);
  assert.doesNotMatch(unknown, /Example|is-lit|<img/);
  assert.deepEqual(visible(markup({ view: { kind: 'unknown', frequencyKhz: 1440, lastCheckedAt: null }, placeName: null })), ['Unknown · 1440 kHz', 'Not confirmed']);
}

// Rings: only fresh, on air and placed in this publication; still for reduced motion.
{
  const scene = { publication: { publicationId: PUBLICATION }, occurrences: [{ spaceOccurrenceId: 'occ-hall' }, { spaceOccurrenceId: 'occ-living' }] };
  const at = value => radioPlacement(decodeRadioStation(value), scene);
  assert.equal(at(station(null)), 'occ-hall');
  assert.equal(at(station(null, undefined, null)), null);
  assert.equal(at(station(null, undefined, { publicationId: '00000000-0000-4000-8000-000000000008', spaceOccurrenceId: 'occ-hall' })), null);
  assert.equal(at(station(null, undefined, { publicationId: PUBLICATION, spaceOccurrenceId: 'occ-attic' })), null);
  const place = { transform: 'matrix(1 0 0 1 0 0)', x: 2, z: 3 };
  const moving = renderToStaticMarkup(createElement('svg', null, createElement(RadioRings, { place, reduced: false })));
  assert.equal((moving.match(/<circle /g) ?? []).length, 3);
  assert.equal((moving.match(new RegExp(`r="${RADIO_RING_M}"`, 'g')) ?? []).length, 3);
  assert.match(moving, /animation-delay:-1.2s/);
  assert.match(moving, /vector-effect="non-scaling-stroke"/);
  const still = renderToStaticMarkup(createElement('svg', null, createElement(RadioRings, { place, reduced: true })));
  assert.match(still, /class="ua-radio-rings is-still"/);
  assert.doesNotMatch(still, /animation/);
  assert.deepEqual([...still.matchAll(/ r="([\d.]+)"/g)].map(m => Number(m[1])), [1.5, 3, 4.5]);
  const slot = (value, now, placeAt = () => place) => {
    const state = feedState(value);
    const feed = { subscribe: () => () => undefined, state: () => state, dispose() {} };
    return renderToStaticMarkup(createElement('svg', null, createElement(RadioRingsSlot, { feed, place: placeAt, now: () => now, reduced: false })));
  };
  assert.match(slot(station(snapshot('playing', '2026-01-01T12:00:08.000Z')), 1_000), /ua-radio-rings/);
  assert.doesNotMatch(slot(station(snapshot('playing', '2026-01-01T12:00:08.000Z')), 20_000), /ua-radio-rings/, 'stale');
  assert.doesNotMatch(slot(station(snapshot('stopped', '2026-01-01T12:00:08.000Z')), 1_000), /ua-radio-rings/, 'off air');
  assert.doesNotMatch(slot(station(snapshot('unknown', '2026-01-01T12:00:08.000Z')), 1_000), /ua-radio-rings/, 'unknown');
  assert.doesNotMatch(slot(station(snapshot('playing', '2026-01-01T12:00:08.000Z')), 1_000, () => null), /ua-radio-rings/, 'unplaced or floor not drawn');
  const noStation = { subscribe: () => () => undefined, state: () => ({ configured: false, station: null, receivedAt: 0, cover: null }), dispose() {} };
  assert.equal(renderToStaticMarkup(createElement(RadioCardSlot, { feed: noStation, placeName: () => null, now: () => 0 })), '', 'no station, no card');
}

// The feed and client: GETs only, only while watched and visible.
{
  const requests = [], timers = new Map();
  let clock = 0, hidden = false, nextTimer = 1, visibility = null, reply = () => station(snapshot('playing', '2026-01-01T12:00:08.000Z', { cover: { mediaType: 'image/png', sha256: pngSha } }));
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const pngSha = Buffer.from(await crypto.subtle.digest('SHA-256', png)).toString('hex');
  const transport = async (url, init) => {
    requests.push({ url, method: init.method, credentials: init.credentials, cache: init.cache, body: init.body });
    if (url.includes('/covers/')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    const value = reply();
    return value === 404 ? new Response('', { status: 404 }) : new Response(JSON.stringify(value), { status: 200 });
  };
  const env = {
    now: () => clock, hidden: () => hidden,
    onVisibility(changed) { visibility = changed; return () => { visibility = null; }; },
    setTimeout(run, ms) { const id = nextTimer++; timers.set(id, { run, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    createObjectURL: () => 'blob:cover', revokeObjectURL() {},
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
  const scope = { workspaceId: '00000000-0000-4000-8000-000000000002', homeId: '00000000-0000-4000-8000-000000000003' };
  // The client: exact routes, GET, same-origin, no-store, digest-checked cover.
  const client = createRadioClient(transport);
  const coverBlob = await client.cover(scope, pngSha, AbortSignal.timeout(1000));
  assert.equal(coverBlob.type, 'image/png');
  await assert.rejects(client.cover(scope, SHA, AbortSignal.timeout(1000)), TypeError, 'bytes must match their digest');
  await assert.rejects(client.cover(scope, '../station', AbortSignal.timeout(1000)), TypeError);
  requests.length = 0;
  const feed = createRadioFeed(client, scope, env);
  await settle();
  assert.equal(requests.length, 0, 'nothing is read until someone watches');
  let notified = 0;
  const stop = feed.subscribe(() => { notified++; });
  await settle();
  assert.equal(requests.length, 2, 'station, then its cover once');
  assert.equal(requests[0].url, `/api/atlas/radio/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/station`);
  assert.equal(requests[1].url, `/api/atlas/radio/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/covers/${pngSha}`);
  assert.equal(feed.state().cover.url, 'blob:cover');
  assert.ok(notified >= 2);
  await advance(RADIO_POLL_MS - 1);
  assert.equal(requests.length, 2);
  await advance(1);
  assert.equal(requests.length, 3, 'about every four seconds');
  await advance(RADIO_POLL_MS * 2);
  assert.equal(requests.length, 5, 'the same cover digest is not fetched again');
  // Hidden: polling stops; showing again reads at once.
  hidden = true; visibility(); await advance(RADIO_POLL_MS * 5);
  assert.equal(requests.length, 5);
  assert.equal(radioView(feed.state(), clock).kind, 'unknown', 'the last answer ages into unknown');
  hidden = false; visibility(); await settle();
  assert.equal(requests.length, 6);
  // A failed read keeps the last answer to age out; the next poll still runs.
  reply = () => { throw new Error('offline'); };
  await advance(RADIO_POLL_MS); assert.equal(requests.length, 7);
  await advance(RADIO_POLL_MS); assert.equal(requests.length, 8);
  // No watcher: no requests.
  stop(); await advance(RADIO_POLL_MS * 5);
  assert.equal(requests.length, 8);
  assert.equal(visibility, null);
  // A home without a station: one read, then no card and no polling.
  reply = () => 404;
  const unconfigured = createRadioFeed(client, scope, env), stop2 = unconfigured.subscribe(() => undefined);
  await settle(); await advance(RADIO_POLL_MS * 3);
  assert.equal(requests.length, 9);
  assert.equal(unconfigured.state().configured, false);
  assert.equal(radioView(unconfigured.state(), clock).kind, 'none');
  stop2(); feed.dispose(); unconfigured.dispose();
  assert.deepEqual(new Set(requests.map(r => r.method)), new Set(['GET']), 'browsing sends only GETs');
  assert.ok(requests.every(r => r.body === undefined && r.credentials === 'same-origin' && r.cache === 'no-store'));
}
console.log('INFO radio station: decoder, freshness, card states, rings and GET-only feed');
