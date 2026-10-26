// Healthy generated checks for the Atlas overlay feed (#356): the actual feed,
// stored-overlay codec and Atlas cache over a SYNTHETIC IndexedDB disk. A fake
// source owner counts every createOverlays/open, so the checks show what a
// toggle reads, what shows before a fresh read finishes, and what stays on
// screen when the network goes away. Generated data only; no browser, server,
// credential, household input or device acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createSyntheticDisk, createSyntheticIndexedDB } from './synthetic-indexeddb.mjs';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, {
    lang: file.pathname.endsWith('.tsx') ? 'tsx' : 'ts', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}
const networkModelURL = await sourceURL('../src/lantern/overlays/network/model.ts');
const runtimeURL = await sourceURL('../src/lantern/unified-atlas/runtime-overlays.ts', { '../overlays/network/model': networkModelURL });
// Every check passes its own environment; the browser preference is never read.
const feedURL = await sourceURL('../src/lantern/unified-atlas/overlay-feed.ts', { './runtime-overlays': runtimeURL,
  './model-updates': dataURL('export const modelUpdatesAllowed = () => { throw new Error("browser preference read"); };') });
const codecURL = await sourceURL('../src/lantern/unified-atlas/stored-overlays.ts');
const storeURL = await sourceURL('../integration/native-geometry-scan-cache.ts');
const cacheURL = await sourceURL('../integration/unified-atlas-cache.ts', { './native-geometry-scan-cache': storeURL });
const { createOverlayFeed, OVERLAY_PREFETCH_DELAY_MS, OVERLAY_REOPEN_DELAY_MS } = await import(feedURL);
const { encodeStoredOverlays, decodeStoredOverlays } = await import(codecURL);
const { openUnifiedAtlasStore, createUnifiedAtlasCache } = await import(cacheURL);

// --- Generated scene: two floor buildings, one room each, both linked. ---
const scope = { workspaceId: '00000000-0000-4000-8000-000000000900', homeId: '00000000-0000-4000-8000-000000000901' };
const publication = { publicationId: '00000000-0000-4000-8000-000000000902', sourceRevisionId: 'r1', sourceSha256: 'a'.repeat(64), semanticsSha256: 'b'.repeat(64) };
const buildings = ['house', 'shed'].map((buildingId, at) => ({ buildingId, label: buildingId === 'house' ? 'House' : 'Shed',
  nativePlaceId: `00000000-0000-4000-8000-00000000091${at}`, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, levelIds: [`${buildingId}-0`] }));
const scene = { profile: 'houseatlas.unified-atlas-scene.v1', scope, selection: { revision: 'rev-1', publicationId: publication.publicationId }, publication,
  buildings, rooms: buildings.map(b => ({ roomId: `${b.buildingId}-room`, buildingId: b.buildingId, nativePlaceId: null, occurrenceIds: [`${b.buildingId}-occ`] })) };
const model = { scene, floorBuildings: buildings, selectable: new Set(buildings.map(b => `${b.buildingId}-occ`)),
  buildingsById: new Map(buildings.map(b => [b.buildingId, b])), roomsById: new Map(scene.rooms.map(r => [r.roomId, r])) };
const unavailable = { status: 'unavailable', reason: 'synthetic' };
let generation = 0;
const frameFor = building => {
  generation += 1;
  return Object.freeze({ status: 'available', lease: {}, nativeBuildingId: building.nativePlaceId,
    sceneSelection: { ...scope, revision: scene.selection.revision, publicationId: publication.publicationId, semanticsSha256: publication.semanticsSha256 },
    currentSource: { recordId: `assoc-${building.buildingId}`, revision: generation, payload: {} },
    sourceSelection: { workspaceId: scope.workspaceId, homeId: scope.homeId, sceneEvidenceId: `scene-${building.buildingId}`, sceneEvidenceRevision: 1,
      sceneOriginalSha256: 'c'.repeat(64), sceneAssetId: 'asset', sceneAssetRevision: 1, acceptedRoomReceiptId: null, acceptedRoomReceiptSha256: null,
      acceptedRoomAnchors: [], acceptedRoomMappings: [] },
    roomBindings: [],
    network: { status: 'available', data: { viewKey: `view-${generation}`, source: { label: 'Synthetic network', revision: `n${generation}`, recordedAt: null,
      retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'partial', notes: '' },
      devices: [{ id: `router-${building.buildingId}`, label: `Router ${building.label}`, kind: 'router', mobility: 'fixed', confidence: 'recorded', notes: '', place: null }],
      links: [], endpoints: [] } },
    electricity: unavailable, electricalFixtures: unavailable });
};

/** A fake current source owner per building; `online` gates every open. */
function createWorld({ stored = null } = {}) {
  const counts = { creates: 0, opens: 0, releases: 0, disposes: 0 }, kept = [], live = new Map();
  const world = { counts, kept, online: true, gate: null };
  const selection = Object.freeze({ kind: 'live', overview: {} });
  world.selection = selection;
  world.port = {
    kind: 'live', current: () => selection, subscribe: () => () => undefined,
    async createOverlays(_selection, _scene, building) {
      counts.creates += 1;
      const listeners = new Set();
      const source = {
        async open() {
          counts.opens += 1;
          if (world.gate) await world.gate;
          if (!world.online) throw new TypeError('Synthetic network unavailable');
          const frame = frameFor(building); live.set(building.buildingId, { frame, listeners, current: true }); return frame;
        },
        isCurrent: frame => live.get(building.buildingId)?.frame === frame && live.get(building.buildingId).current,
        subscribeInvalidation(frame, changed) { listeners.add(changed); return () => listeners.delete(changed); },
        release(frame) { counts.releases += 1; if (live.get(building.buildingId)?.frame === frame) live.delete(building.buildingId); },
        dispose() { counts.disposes += 1; },
      };
      return { source, request: {} };
    },
    async storedOverlays() { return stored; },
    keepOverlays(_selection, _scene, overlays) { kept.push(overlays); },
  };
  // The head check fails for every frame, as when the network drops.
  world.drop = () => { for (const row of live.values()) { row.current = false; for (const changed of [...row.listeners]) changed(); } };
  return world;
}
function createClock({ mayReadUnasked = true } = {}) {
  let at = Date.parse('2026-10-26T12:00:00.000Z'), next = 1;
  const timers = new Map(), online = new Set();
  return {
    setTimeout(run, ms) { const id = next++; timers.set(id, { run, due: at + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    subscribeOnline(changed) { online.add(changed); return () => online.delete(changed); },
    now: () => at,
    mayReadUnasked: () => mayReadUnasked,
    pending: () => [...timers.values()].map(timer => timer.due - at),
    advance(ms) { at += ms; for (const [id, timer] of [...timers]) if (timer.due <= at) { timers.delete(id); timer.run(); } },
    goOnline() { for (const changed of [...online]) changed(); },
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const results = [];

// 1. Nothing stored: one background read once the model has drawn, kept, then let go.
{
  const world = createWorld(), clock = createClock();
  const feed = createOverlayFeed(world.port, world.selection, model, clock);
  await settle();
  assert.deepEqual(clock.pending(), [OVERLAY_PREFETCH_DELAY_MS], 'a background read waits for the model to draw');
  assert.equal(world.counts.creates, 0, 'nothing is read before the delay');
  clock.advance(OVERLAY_PREFETCH_DELAY_MS); await settle(); await settle();
  assert.equal(world.counts.opens, 2, 'both buildings read once in the background');
  assert.equal(world.kept.length, 2, 'each building\'s records are kept as they arrive');
  assert.deepEqual([...world.kept.at(-1).keys()].sort(), ['house', 'shed']);
  assert.equal(world.counts.releases, 2, 'the background read lets its frames go');
  const shown = feed.snapshot();
  assert.equal(shown.reason, 'stored-copy', 'what was read stays on screen as the stored copy');
  assert.equal(shown.records.unplaced.network.length, 2);
  assert.equal(shown.stored.refreshing, false);
  feed.setActive(true); await settle(); await settle();
  assert.equal(world.counts.opens, 4, 'turning a layer on reads the current sources');
  assert.equal(feed.snapshot().reason, 'available'); assert.equal(feed.snapshot().stored, null);
  feed.dispose();
  results.push('nothing stored: one background read after the model draws, kept and released');
}
// 1b. "When I ask" (or mobile data): nothing is read until a layer is turned on.
{
  const world = createWorld(), clock = createClock({ mayReadUnasked: false });
  const feed = createOverlayFeed(world.port, world.selection, model, clock);
  await settle();
  assert.deepEqual(clock.pending(), [], 'no background read while downloads wait for the user');
  feed.setActive(true); await settle(); await settle();
  assert.equal(world.counts.opens, 2, 'turning a layer on still reads');
  assert.equal(feed.snapshot().reason, 'available');
  feed.dispose();
  results.push('held downloads: no background read, a toggle still reads');
}

// 2. Stored copy: the first toggle shows it at once; the fresh read replaces it;
// later toggles read nothing; offline falls back to the stored copy.
{
  const storedAt = '2026-10-25T08:00:00.000Z';
  const first = createWorld(), clock0 = createClock();
  const seed = createOverlayFeed(first.port, first.selection, model, clock0);
  await settle(); clock0.advance(OVERLAY_PREFETCH_DELAY_MS); await settle(); await settle(); seed.dispose();
  const stored = new Map([...first.kept.at(-1)].map(([id, row]) => [id, { ...row, storedAt }]));
  const world = createWorld({ stored }), clock = createClock();
  let release; world.gate = new Promise(resolve => { release = resolve; });
  const feed = createOverlayFeed(world.port, world.selection, model, clock);
  await settle();
  assert.deepEqual(clock.pending(), [], 'a stored copy needs no background read');
  feed.setActive(true); await settle();
  let shown = feed.snapshot();
  assert.equal(shown.reason, 'stored-copy', 'the first toggle shows the stored copy before the fresh read ends');
  assert.deepEqual(shown.stored, { storedAt, refreshing: true });
  assert.equal(shown.records.unplaced.network.length, 2);
  assert.equal(shown.records.network, 'available');
  assert.equal(feed.snapshot(), shown, 'an unchanged feed returns the same snapshot');
  release(); world.gate = null; await settle(); await settle();
  shown = feed.snapshot();
  assert.equal(shown.reason, 'available'); assert.equal(shown.stored, null, 'fresh frames replace the stored copy');
  assert.deepEqual(shown.buildings.map(row => row.reason), ['available', 'available']);
  const reads = { ...world.counts };
  for (const value of [false, true, false, true]) feed.setActive(value);
  await settle();
  assert.deepEqual(world.counts, reads, 'turning layers off and on again reads nothing');
  assert.equal(feed.snapshot().reason, 'available');

  world.online = false; world.drop(); await settle();
  shown = feed.snapshot();
  assert.equal(shown.reason, 'stored-copy', 'offline, the last loaded records stay on screen');
  assert.equal(shown.stored.refreshing, false);
  assert.equal(shown.stored.storedAt, new Date(clock.now()).toISOString(), 'the stored copy is the one this page just read');
  assert.deepEqual(clock.pending(), [OVERLAY_REOPEN_DELAY_MS], 'a dropped frame is read again later');
  clock.advance(OVERLAY_REOPEN_DELAY_MS); await settle(); await settle();
  assert.equal(world.counts.opens, reads.opens + 2, 'the later read runs');
  assert.equal(feed.snapshot().reason, 'stored-copy', 'and fails offline without hiding the overlay');
  world.online = true; clock.goOnline(); await settle(); await settle();
  assert.equal(world.counts.opens, reads.opens + 4, 'coming back online reads again');
  assert.equal(feed.snapshot().reason, 'available');
  feed.dispose();
  assert.equal(world.counts.disposes, world.counts.creates, 'dispose lets every source go');
  results.push('stored copy: shown at once, replaced by fresh frames, no reads on repeat toggles, kept offline, re-read when online');
}

// 3. Codec: round trip, exact scene pins, rooms limited to the current scene.
{
  const world = createWorld(), clock = createClock();
  const feed = createOverlayFeed(world.port, world.selection, model, clock);
  await settle(); clock.advance(OVERLAY_PREFETCH_DELAY_MS); await settle(); await settle(); feed.dispose();
  const overlays = new Map([...world.kept.at(-1)].map(([id, row]) => [id, { ...row, records: { ...row.records,
    rooms: new Map([[`${id}-room`, row.records.unplaced]]) } }]));
  const bytes = encodeStoredOverlays(scene, overlays);
  const back = decodeStoredOverlays(bytes, scene, model.selectable);
  assert.deepEqual(back, overlays, 'records, rooms and graph device keys survive a round trip');
  assert.ok(back.get('house').records.networkGraphs[0].deviceRecordKeys instanceof Map);
  assert.equal(decodeStoredOverlays(bytes, { ...scene, selection: { ...scene.selection, revision: 'rev-2' } }, model.selectable), null, 'another scene revision is not shown');
  assert.equal(decodeStoredOverlays(bytes, { ...scene, publication: { ...publication, semanticsSha256: 'd'.repeat(64) } }, model.selectable), null);
  const narrower = decodeStoredOverlays(bytes, scene, new Set(['house-occ']));
  assert.deepEqual([...narrower.get('shed').records.rooms.keys()], [], 'a room without a selectable part is dropped');
  assert.deepEqual([...narrower.get('house').records.rooms.keys()], ['house-room']);
  assert.equal(decodeStoredOverlays(new TextEncoder().encode('{"profile":"houseatlas.stored-overlays.v0"}'), scene, model.selectable), null);
  assert.equal(decodeStoredOverlays(new Uint8Array([0xff, 0xfe]), scene, model.selectable), null, 'unreadable bytes show nothing');
  const broken = JSON.parse(new TextDecoder().decode(bytes)); broken.buildings[0].records.unplaced.network[0].label = 7;
  assert.equal(decodeStoredOverlays(new TextEncoder().encode(JSON.stringify(broken)), scene, model.selectable), null, 'a malformed record shows nothing');

  // 4. Cache: per actor and home, one slot, sign-out deletes it.
  const disk = createSyntheticDisk();
  const open = async (actorId, body) => {
    const store = openUnifiedAtlasStore(createSyntheticIndexedDB(disk)); await store.ready();
    try { return await body(createUnifiedAtlasCache(store, { actorId, ...scope }), store); } finally { await store.close(); }
  };
  const pins = [publication.publicationId, scene.selection.revision, publication.semanticsSha256];
  await open('actor-a', async cache => { cache.keepOverlays(...pins, bytes); });
  await open('actor-a', async cache => {
    assert.deepEqual(decodeStoredOverlays(await cache.overlays(...pins), scene, model.selectable), overlays, 'a reopened page reads its stored overlays');
    assert.equal(await cache.overlays(publication.publicationId, 'rev-2', publication.semanticsSha256), null);
  });
  await open('actor-b', async cache => { assert.equal(await cache.overlays(...pins), null, 'another actor reads nothing'); });
  await open('actor-a', async cache => { cache.keepOverlays(publication.publicationId, 'rev-2', publication.semanticsSha256, bytes); });
  await open('actor-a', async cache => { assert.equal(await cache.overlays(...pins), null, 'a newer scene\'s overlays replace the old slot'); });
  await open('actor-a', async (cache, store) => { await store.clear(); assert.equal(await cache.overlays(publication.publicationId, 'rev-2', publication.semanticsSha256), null, 'sign-out clears them'); });
  results.push('codec and cache: exact scene pins, current rooms only, malformed copies ignored, per-actor slot cleared on sign-out');
}

for (const line of results) console.log(`PASS ${line}`);
console.log('PASS generated overlay feed only; mounted browser, storage and device acceptance remain unestablished');
