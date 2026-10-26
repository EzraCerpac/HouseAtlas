// Healthy generated cold-reopen checks for the persistent unified Atlas cache:
// the actual reader, the actual Atlas cache over the shared verified byte
// store, and a SYNTHETIC IndexedDB disk that outlives each simulated process.
// Counts are GETs seen by a generated in-process transport. It shows what a
// returning page reads from the network and what it can show before the fresh
// read finishes. No browser, service worker, server, credential or household
// input. A synthetic disk proves nothing about Safari or an installed PWA.
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
const geometryURL = await sourceURL('../src/lantern/canonical-ifc/geometry.ts');
const typesURL = await sourceURL('../src/lantern/unified-atlas/types.ts');
const sceneURL = await sourceURL('../src/lantern/unified-atlas/scene.ts', { '../canonical-ifc/geometry': geometryURL, './types': typesURL });
const storeURL = await sourceURL('../integration/native-geometry-scan-cache.ts');
const cacheURL = await sourceURL('../integration/unified-atlas-cache.ts', { './native-geometry-scan-cache': storeURL });
const readerURL = await sourceURL('../integration/unified-atlas-reader.ts', { '../src/lantern/unified-atlas/scene': sceneURL,
  '../src/lantern/unified-atlas/types': typesURL, './sha256-thread': await sourceURL('../integration/sha256-thread.ts') });
const codecURL = await sourceURL('../src/lantern/unified-atlas/stored-overlays.ts');
const lastCopyURL = await sourceURL('../integration/last-atlas-copy.ts', { '../src/lantern/unified-atlas/types': typesURL,
  '../src/lantern/unified-atlas/stored-overlays': codecURL, './unified-atlas-cache': cacheURL, './unified-atlas-reader': readerURL });
const syntheticURL = await sourceURL('./unified-atlas/synthetic-atlas.ts');
const { readUnifiedAtlas, readCachedUnifiedAtlas } = await import(readerURL);
const { openUnifiedAtlasStore, createUnifiedAtlasCache, observeUnifiedAtlasActor, readLastAtlas, ATLAS_CACHE_DATABASE } = await import(cacheURL);
const { openLastAtlasCopy } = await import(lastCopyURL);
const { encodeStoredOverlays, decodeStoredOverlays } = await import(codecURL);
const { buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, atlasScenePath, SYNTHETIC_ATLAS } = await import(syntheticURL);

const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const actorA = 'synthetic-actor-a', actorB = 'synthetic-actor-b';
const versions = [];
for (const rise of [0, 0.25]) {
  const { glb, companionBytes } = await buildSyntheticAtlas(scope, rise);
  const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
  versions.push({ glb, composed });
}
assert.notEqual(versions[0].composed.sha256, versions[1].composed.sha256, 'two generated model versions');

let online = true, served = versions[0];
const calls = [];
const transport = async (...args) => {
  if (!online) throw new TypeError('Synthetic network unavailable');
  const { glb, composed } = served;
  return createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: composed.envelopeBytes,
    href: composed.href, glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision,
    onRequest: url => calls.push(url.includes('/artifacts/model') ? 'model' : 'scene') })(...args);
};
const selectionOf = version => Object.freeze({ owner: {}, scope, expiresAt: new Date(Date.now() + 600_000).toISOString(),
  publicationId: SYNTHETIC_ATLAS.publicationId, manifestSha256: version.composed.manifestSha256 });

/** One simulated process: fresh modules state, store handle and cache over the same disk. */
async function openProcess(disk, actorId, body) {
  const store = openUnifiedAtlasStore(createSyntheticIndexedDB(disk));
  await store.ready();
  // A simulated canonical session observation, separate from cached bytes.
  const actor = await observeUnifiedAtlasActor(store, actorId);
  assert.equal(actor.actorId, actorId);
  const cache = createUnifiedAtlasCache(store, { actorId, ...scope }, actor);
  calls.length = 0;
  try { return await body({ cache, store }); } finally { await store.close(); }
}
const signal = () => new AbortController().signal;
const fresh = (cache, selection) => readUnifiedAtlas({ selection, signal: signal(), origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport, cache });
const stored = (cache, selection) => readCachedUnifiedAtlas({ selection, signal: signal(), cache });
const results = [];
const record = (label, expected) => { assert.deepEqual([...calls], expected, label); results.push(`${label}: ${calls.length ? calls.join(' + ') : 'no'} GET`); };

const disk = createSyntheticDisk();
const v0 = selectionOf(versions[0]);

await openProcess(disk, actorA, async ({ cache }) => {
  assert.equal(await stored(cache, v0), null, 'nothing is stored before the first read');
  const read = await fresh(cache, v0);
  record('first open', ['scene', 'model']);
  assert.deepEqual(Buffer.from(read.model), Buffer.from(versions[0].glb));
  assert.match(read.envelopeSha256, /^[0-9a-f]{64}$/);
});

let shownAt;
await openProcess(disk, actorA, async ({ cache }) => {
  const copy = await stored(cache, v0);
  record('cold reopen, stored copy before any request', []);
  assert.ok(copy, 'the last verified copy is available at start');
  assert.deepEqual(Buffer.from(copy.model), Buffer.from(versions[0].glb));
  assert.ok(Number.isFinite(Date.parse(copy.storedAt)));
  shownAt = copy.storedAt;
  const read = await fresh(cache, v0);
  record('cold reopen, fresh read of an unchanged model', ['scene']);
  assert.equal(read.envelopeSha256, copy.envelopeSha256, 'the fresh scene confirms the copy on screen');
  assert.equal(read.scene.model.sha256, copy.scene.model.sha256);
  assert.deepEqual(read.scene, copy.scene);
});

online = false;
await openProcess(disk, actorA, async ({ cache }) => {
  const copy = await stored(cache, v0);
  await assert.rejects(fresh(cache, v0), error => error.reason === 'unavailable');
  record('offline reopen', []);
  assert.ok(copy, 'offline, the stored copy still opens');
  assert.equal(copy.storedAt, shownAt, 'an unchanged scene is not written again');
});
online = true;

served = versions[1];
const v1 = selectionOf(versions[1]);
await openProcess(disk, actorA, async ({ cache }) => {
  assert.equal(await stored(cache, v1), null, 'a new publication manifest has no stored copy yet');
  await fresh(cache, v1);
  record('new model published', ['scene', 'model']);
});
await openProcess(disk, actorA, async ({ cache }) => {
  assert.ok(await stored(cache, v1));
  assert.equal(await stored(cache, v0), null, 'one scene slot per home: the newest replaces the earlier one');
  await fresh(cache, v1);
  record('cold reopen after the new model', ['scene']);
});

await openProcess(disk, actorB, async ({ cache }) => {
  assert.equal(await stored(cache, v1), null, 'another actor sees nothing stored by the first');
  await fresh(cache, v1);
  record('another actor on the same device', ['scene', 'model']);
});

// A stored scene envelope that no longer matches its recorded digest is not shown, and a fresh read rewrites it.
{
  const sceneDisk = createSyntheticDisk();
  await openProcess(sceneDisk, actorA, async ({ cache }) => { await fresh(cache, v1); });
  const records = sceneDisk.databases.get(ATLAS_CACHE_DATABASE).stores.get('blobs').records;
  for (const value of records.values()) if (value.data.byteLength !== versions[1].glb.byteLength) {
    const bytes = new Uint8Array(value.data), at = bytes.lastIndexOf(0x22);
    bytes[at - 1] = bytes[at - 1] === 0x41 ? 0x42 : 0x41; // one character inside the last JSON string
  }
  await openProcess(sceneDisk, actorA, async ({ cache }) => {
    assert.equal(await stored(cache, v1), null, 'a changed stored envelope is not shown');
    await fresh(cache, v1);
  });
  await openProcess(sceneDisk, actorA, async ({ cache }) => assert.ok(await stored(cache, v1), 'the fresh read repaired it'));
}

// Stored model bytes that no longer hash to the pinned digest are never shown or used.
const blobs = disk.databases.get(ATLAS_CACHE_DATABASE).stores.get('blobs').records;
for (const value of blobs.values()) if (value.data.byteLength === versions[1].glb.byteLength) new Uint8Array(value.data)[100] ^= 0xff;
await openProcess(disk, actorA, async ({ cache }) => {
  assert.equal(await stored(cache, v1), null, 'changed stored bytes are not shown');
  const read = await fresh(cache, v1);
  record('changed stored model bytes', ['scene', 'model']);
  assert.deepEqual(Buffer.from(read.model), Buffer.from(versions[1].glb));
});

// One page reading A, then B, then A again leaves A stored for the next start.
{
  const pageDisk = createSyntheticDisk();
  await openProcess(pageDisk, actorA, async ({ cache }) => {
    served = versions[0]; await fresh(cache, v0);
    served = versions[1]; await fresh(cache, v1);
    served = versions[0]; await fresh(cache, v0);
  });
  await openProcess(pageDisk, actorA, async ({ cache }) => {
    assert.ok(await stored(cache, v0), 'the latest read scene is the stored one');
    assert.equal(await stored(cache, v1), null);
  });
  served = versions[1];
}

// Storage that never finishes opening does not hold back the fresh read.
calls.length = 0;
const pending = await readUnifiedAtlas({ selection: v1, signal: signal(), origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport,
  cache: new Promise(() => {}) });
record('storage that never opens', ['scene', 'model']);
assert.deepEqual(Buffer.from(pending.model), Buffer.from(versions[1].glb));

// An explicit refusal is reported as denied, not as an unavailable network.
for (const status of [401, 403])
  await assert.rejects(readUnifiedAtlas({ selection: v1, signal: signal(), origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
    transport: async () => new Response(null, { status }) }), error => error.reason === 'denied', `HTTP ${status}`);

// The Saved entry's last copy: the newest fresh read on this device, opened
// from the cache alone with the network gone, and gone again after sign-out.
{
  const lastDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(lastDisk);
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'no fresh read yet, no last copy');
  served = versions[0]; await openProcess(lastDisk, actorA, async ({ cache }) => { await fresh(cache, v0); });
  served = versions[1]; await openProcess(lastDisk, actorA, async ({ cache }) => { await fresh(cache, v1); });
  online = false; calls.length = 0;
  const copy = await openLastAtlasCopy(factory(), signal());
  try {
    assert.ok(copy, 'offline, the last copy opens');
    const selection = copy.port.current();
    assert.equal(selection.kind, 'live');
    assert.equal(selection.overview.manifestSha256, v1.manifestSha256, 'the newest fresh read is the last copy');
    assert.deepEqual({ ...selection.overview.scope }, scope);
    assert.ok(Date.parse(selection.overview.expiresAt) <= Date.now(), 'the copy carries no live authority');
    const read = await copy.port.stored(selection, signal());
    assert.deepEqual(Buffer.from(read.model), Buffer.from(versions[1].glb));
    assert.equal(read.storedAt, copy.storedAt);
    await assert.rejects(copy.port.read(selection, signal()), error => error.reason === 'unavailable', 'the fresh read reports the server out of reach');
    assert.equal(copy.port.readDetail, undefined); assert.equal(copy.port.createOverlays, undefined);
    record('Saved entry opens the last copy offline', []);
  } finally { await copy?.close(); online = true; }
  await openProcess(lastDisk, actorB, async ({ cache }) => { await fresh(cache, v1); });
  const other = await openLastAtlasCopy(factory(), signal());
  assert.ok(other, 'the pointer follows the newest actor on this device'); await other.close();
  // A Saved tab left open while another tab signs out withdraws its copy when looked at again.
  const events = new EventTarget(), watched = await openLastAtlasCopy(factory(), signal(), events);
  let notified = 0; watched.port.subscribe(() => notified++);
  const shown = watched.port.current();
  events.dispatchEvent(new Event('focus')); await new Promise(done => setTimeout(done, 50));
  assert.equal(watched.port.current(), shown, 'an unchanged pointer keeps the copy');
  await openProcess(lastDisk, actorA, async ({ store }) => { await store.clear(); });
  events.dispatchEvent(new Event('visibilitychange'));
  for (let tries = 0; watched.port.current() !== null && tries < 100; tries++) await new Promise(done => setTimeout(done, 10));
  assert.equal(watched.port.current(), null, 'sign-out elsewhere withdraws the open copy');
  assert.equal(notified, 1); assert.equal(await watched.port.stored(shown, signal()), null, 'the held bytes are released');
  await watched.close();
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'sign-out removes the last copy');
}

// A canonical account change must withdraw A even if B has no scene yet. Late
// A observations and valid cache completions cannot restore A or replace B.
{
  const accountDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(accountDisk);
  served = versions[0];
  let originalRead;
  await openProcess(accountDisk, actorA, async ({ cache }) => { originalRead = await fresh(cache, v0); });
  const oldStore = openUnifiedAtlasStore(factory()), nextStore = openUnifiedAtlasStore(factory());
  await Promise.all([oldStore.ready(), nextStore.ready()]);
  const oldActor = await observeUnifiedAtlasActor(oldStore, actorA);
  const oldCache = createUnifiedAtlasCache(oldStore, { actorId: actorA, ...scope }, oldActor);
  let releaseObservation, observationReached;
  const observationHeld = new Promise(resolve => { releaseObservation = resolve; });
  const observationStarted = new Promise(resolve => { observationReached = resolve; });
  let activeActor = actorA, held = false;
  const delayedStore = { ...oldStore, async read(...args) {
    const bytes = await oldStore.read(...args);
    if (!held) { held = true; observationReached(); await observationHeld; }
    return bytes;
  } };
  const oldObservation = observeUnifiedAtlasActor(delayedStore, actorA, () => activeActor === actorA);
  await observationStarted;
  let releaseRead, readReached;
  const readHeld = new Promise(resolve => { releaseRead = resolve; });
  const readStarted = new Promise(resolve => { readReached = resolve; });
  served = versions[1];
  const pendingRead = readUnifiedAtlas({ selection: v1, signal: signal(), origin: SYNTHETIC_ATLAS.origin,
    isCurrent: () => true, cache: oldCache, transport: async (...args) => {
      const response = await transport(...args);
      if (String(args[0]).includes('/artifacts/model')) { readReached(); await readHeld; }
      return response;
    } });
  await Promise.race([readStarted, pendingRead.then(() => assert.fail('Expected the held A model read'))]);
  activeActor = actorB;
  const nextActor = await observeUnifiedAtlasActor(nextStore, actorB);
  assert.equal(nextActor.actorId, actorB);
  assert.equal(await readLastAtlas(nextStore), null, 'B has no fresh scene: never fall back to A');
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'cold reopen after B sign-in cannot show A');
  releaseObservation();
  assert.equal(await oldObservation, null, 'a delayed old canonical observation cannot restore A');
  const nextCache = createUnifiedAtlasCache(nextStore, { actorId: actorB, ...scope }, nextActor);
  await fresh(nextCache, v1);
  const before = await readLastAtlas(nextStore);
  assert.equal(before.pointer.actorId, actorB);
  assert.equal(before.pointer.actorRevision, nextActor.revision);
  releaseRead(); const lateRead = await pendingRead;
  const after = await readLastAtlas(oldStore);
  assert.deepEqual(after.pointer, before.pointer, 'a late A completion cannot replace B\'s pointer');
  const reopened = await openLastAtlasCopy(factory(), signal());
  assert.ok(reopened, 'B remains available after the old completion and a cold reopen'); await reopened.close();
  const returnedActor = await observeUnifiedAtlasActor(nextStore, actorA);
  assert.notEqual(returnedActor.revision, oldActor.revision, 'returning to A starts a new display allocation');
  assert.equal(await readLastAtlas(nextStore), null, 'old A pointers cannot return before a new A scene');
  oldCache.keepScene(v0.publicationId, v0.manifestSha256, versions[0].composed.envelopeBytes,
    originalRead.envelopeSha256, originalRead.entryBuildingId);
  assert.equal(await readLastAtlas(oldStore), null, 'an old A cache cannot select the new A allocation');
  const returnedCache = createUnifiedAtlasCache(nextStore, { actorId: actorA, ...scope }, returnedActor);
  await fresh(returnedCache, v1);
  assert.equal((await readLastAtlas(nextStore)).pointer.actorRevision, returnedActor.revision);
  await observeUnifiedAtlasActor(nextStore, null);
  assert.equal(await readLastAtlas(nextStore), null, 'a confirmed null session withdraws the offline copy');
  await nextStore.clear();
  oldCache.keepModel(versions[1].composed.sha256, versions[1].glb);
  oldCache.keepScene(v1.publicationId, v1.manifestSha256, versions[1].composed.envelopeBytes,
    lateRead.envelopeSha256, lateRead.entryBuildingId);
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'sign-out plus a stale handle cannot restore display ownership');
  await Promise.all([oldStore.close(), nextStore.close()]);
}

// A different handle can commit B after A passed its initial currentness
// guard. Only the atomic raw-byte exchange prevents A from overwriting B.
// Exercise missing, JSON-null and populated witness preimages separately.
for (const previousActor of [undefined, null, 'synthetic-prior-actor']) {
  const racingDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(racingDisk);
  const older = openUnifiedAtlasStore(factory()), newer = openUnifiedAtlasStore(factory());
  await Promise.all([older.ready(), newer.ready()]);
  if (previousActor !== undefined) await observeUnifiedAtlasActor(older, previousActor);
  let releaseExchange, exchangeReached;
  const exchangeHeld = new Promise(resolve => { releaseExchange = resolve; });
  const exchangeStarted = new Promise(resolve => { exchangeReached = resolve; });
  const delayed = { ...older, async compareExchange(...args) {
    exchangeReached(); await exchangeHeld;
    return older.compareExchange(...args);
  } };
  // A's local guard stays true: a second handle's canonical observation must
  // win through the shared-store preimage check, not another callback guard.
  const pending = observeUnifiedAtlasActor(delayed, actorA, () => true);
  await Promise.race([exchangeStarted, pending.then(() => assert.fail('Expected the held actor exchange'))]);
  const actor = await observeUnifiedAtlasActor(newer, actorB);
  assert.equal(actor.actorId, actorB);
  const cache = createUnifiedAtlasCache(newer, { actorId: actorB, ...scope }, actor);
  await fresh(cache, v1);
  const before = await readLastAtlas(newer);
  releaseExchange();
  assert.equal(await pending, null, 'A loses the exact witness exchange after B committed');
  assert.deepEqual((await readLastAtlas(older)).pointer, before.pointer, 'late A leaves B\'s pointer unchanged');
  const reopened = await openLastAtlasCopy(factory(), signal());
  assert.ok(reopened, 'B remains available across cold reopen after the failed exchange'); await reopened.close();
  await Promise.all([older.close(), newer.close()]);
}

// The account may change while the initial offline model is being hashed.
// Hold only that generated model digest, not storage or a live transport.
{
  const openingDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(openingDisk);
  await openProcess(openingDisk, actorA, async ({ cache }) => { await fresh(cache, v1); });
  const subtle = crypto.subtle, previous = Object.getOwnPropertyDescriptor(subtle, 'digest');
  const digest = subtle.digest.bind(subtle);
  let releaseHash, hashReached, held = false, opened;
  const hashHeld = new Promise(resolve => { releaseHash = resolve; });
  const hashStarted = new Promise(resolve => { hashReached = resolve; });
  Object.defineProperty(subtle, 'digest', { configurable: true, value: async (algorithm, data) => {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    if (!held && bytes.byteLength === versions[1].glb.byteLength && bytes[0] === 103 && bytes[1] === 108) {
      held = true; hashReached(); await hashHeld;
    }
    return digest(algorithm, data);
  } });
  try {
    const opening = openLastAtlasCopy(factory(), signal());
    await Promise.race([hashStarted, opening.then(() => assert.fail('Expected the held initial model digest'))]);
    const store = openUnifiedAtlasStore(factory()); await store.ready();
    await observeUnifiedAtlasActor(store, actorB); await store.close();
    releaseHash(); opened = await opening;
    assert.equal(opened, null, 'account change during initial admission cannot publish A\'s copy');
  } finally {
    releaseHash(); await opened?.close();
    if (previous) Object.defineProperty(subtle, 'digest', previous); else delete subtle.digest;
  }
}

// Old cache bytes and a legacy device-wide pointer do not manufacture a
// canonical account observation after upgrade.
{
  const legacyDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(legacyDisk);
  const store = openUnifiedAtlasStore(factory()); await store.ready();
  const cache = createUnifiedAtlasCache(store, { actorId: actorA, ...scope });
  await fresh(cache, v1);
  const legacy = { actorId: actorA, ...scope, publicationId: v1.publicationId, manifestSha256: v1.manifestSha256 };
  store.write(JSON.stringify(['unified-atlas-last']), 'pointer', 'pointer', new TextEncoder().encode(JSON.stringify(legacy)));
  await store.close();
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'legacy pointer needs a fresh canonical account observation');
}

// The cold last-copy port exposes only the stored documentary overlay records
// for its admitted scene and current actor allocation, never a native frame.
{
  const overlayDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(overlayDisk);
  let scene, overlays, encoded;
  served = versions[1];
  await openProcess(overlayDisk, actorA, async ({ cache }) => {
    scene = (await fresh(cache, v1)).scene;
    const building = scene.buildings.find(row => row.levelIds.length > 0);
    assert.ok(building, 'generated Atlas has a floor building');
    const records = { rooms: new Map(), network: 'partial', electrical: 'unavailable', sourceFacts: [],
      unplaced: { network: [{ key: 'synthetic-offline-router', id: 'synthetic-router', label: 'Synthetic router',
        category: 'network', detail: 'Stored documentary record', qualification: 'stored-copy', sourceDate: null,
        retrievedAt: null, connections: [], sourceFacts: [] }], electrical: [] }, networkGraphs: [] };
    overlays = new Map([[building.buildingId, { storedAt: '2026-10-26T12:00:00.000Z', records }]]);
    encoded = encodeStoredOverlays(scene, overlays);
    cache.keepOverlays(scene.publication.publicationId, scene.selection.revision, scene.publication.semanticsSha256, encoded);
  });
  calls.length = 0;
  const copy = await openLastAtlasCopy(factory(), signal());
  try {
    assert.ok(copy);
    const selection = copy.port.current(), read = await copy.port.stored(selection, signal());
    const selectable = new Set(read.scene.occurrences.map(row => row.spaceOccurrenceId));
    const expected = decodeStoredOverlays(encoded, read.scene, selectable);
    assert.ok(expected, 'the actual current codec admits the generated stored records');
    assert.deepEqual(await copy.port.storedOverlays(selection, read.scene, selectable, signal()), expected,
      'cold copy preserves stored records and their documentary timestamp');
    assert.equal(await copy.port.storedOverlays({ ...selection }, read.scene, selectable, signal()), null,
      'a copied selection cannot reuse the cold-copy binding');
    assert.equal(await copy.port.storedOverlays(selection, { ...read.scene }, selectable, signal()), null,
      'a caller-provided scene cannot replace the admitted scene');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(copy.port.storedOverlays(selection, read.scene, selectable, aborted.signal),
      error => error.name === 'AbortError', 'cancelled overlay read releases no records');
    const interrupted = new AbortController();
    const pendingOverlays = copy.port.storedOverlays(selection, read.scene, selectable, interrupted.signal);
    interrupted.abort();
    await assert.rejects(pendingOverlays, error => error.name === 'AbortError',
      'cancellation after the async cache read starts releases no records');
    assert.equal(copy.port.createOverlays, undefined); assert.equal(copy.port.keepOverlays, undefined);
    assert.equal(copy.port.readDetail, undefined, 'stored records add no detail or native-source route');
    await openProcess(overlayDisk, actorB, async () => {});
    assert.equal(await copy.port.storedOverlays(selection, read.scene, selectable, signal()), null,
      'account switch withdraws overlay results even before a focus event');
    record('Saved entry reads only current-account documentary overlays offline', []);
  } finally { await copy?.close(); }

  // Correct outer cache keys must not bless bytes encoded for another scene.
  // This reaches the codec instead of only checking the cache-key miss path.
  for (const staleScene of [
    { ...scene, publication: { ...scene.publication, publicationId: '00000000-0000-4000-8000-000000009999' } },
    { ...scene, selection: { ...scene.selection, revision: `${scene.selection.revision}-stale` } },
    { ...scene, publication: { ...scene.publication, semanticsSha256: '0'.repeat(64) } },
  ]) {
    await openProcess(overlayDisk, actorA, async ({ cache }) => {
      await fresh(cache, v1);
      cache.keepOverlays(scene.publication.publicationId, scene.selection.revision, scene.publication.semanticsSha256,
        encodeStoredOverlays(staleScene, overlays));
    });
    const stale = await openLastAtlasCopy(factory(), signal());
    try {
      assert.ok(stale);
      const selected = stale.port.current(), read = await stale.port.stored(selected, signal());
      assert.equal(await stale.port.storedOverlays(selected, read.scene,
        new Set(read.scene.occurrences.map(row => row.spaceOccurrenceId)), signal()), null,
      'wrong publication, revision or semantics bytes cannot appear under matching outer keys');
    } finally { await stale?.close(); }
  }
}

// One canonical observation must survive ordinary LRU pressure. Three homes
// contribute nine model/scene/overlay rows, plus the witness and last pointer:
// the default ten-entry cache must evict old content, not lose the newest copy.
{
  const pressureDisk = createSyntheticDisk(), factory = () => createSyntheticIndexedDB(pressureDisk);
  const store = openUnifiedAtlasStore(factory()); await store.ready();
  const actor = await observeUnifiedAtlasActor(store, actorA);
  assert.equal(actor.actorId, actorA);
  let newest;
  try {
    for (let index = 0; index < 3; index++) {
      const homeScope = { workspaceId: scope.workspaceId, homeId: `00000000-0000-4000-8000-00000000081${index}` };
      const { glb, companionBytes } = await buildSyntheticAtlas(homeScope, index / 4);
      const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
      const selection = Object.freeze({ owner: {}, scope: homeScope, expiresAt: new Date(Date.now() + 600_000).toISOString(),
        publicationId: SYNTHETIC_ATLAS.publicationId, manifestSha256: composed.manifestSha256 });
      const cache = createUnifiedAtlasCache(store, { actorId: actorA, ...homeScope }, actor);
      const read = await readUnifiedAtlas({ selection, signal: signal(), origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, cache,
        transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(homeScope),
          envelopeBytes: composed.envelopeBytes, href: composed.href, glb, sha256: composed.sha256,
          manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
      const building = read.scene.buildings.find(row => row.levelIds.length > 0);
      assert.ok(building);
      const overlays = new Map([[building.buildingId, { storedAt: '2026-10-26T12:00:00.000Z', records: {
        rooms: new Map(), network: 'unavailable', electrical: 'unavailable', sourceFacts: [],
        unplaced: { network: [], electrical: [] }, networkGraphs: [],
      } }]]);
      cache.keepOverlays(read.scene.publication.publicationId, read.scene.selection.revision,
        read.scene.publication.semanticsSha256, encodeStoredOverlays(read.scene, overlays));
      newest = { scope: homeScope, glb, overlays };
    }
  } finally { await store.close(); }
  const entries = pressureDisk.databases.get(ATLAS_CACHE_DATABASE).stores.get('entries').records;
  assert.equal(entries.size, 10, 'three homes reach the unchanged default entry bound');
  const copy = await openLastAtlasCopy(factory(), signal());
  try {
    assert.ok(copy, 'LRU content pressure must retain the current actor witness and newest last copy');
    const selected = copy.port.current(), read = await copy.port.stored(selected, signal());
    assert.deepEqual({ ...selected.overview.scope }, newest.scope, 'cold reopen selects the newest home');
    assert.deepEqual(Buffer.from(read.model), Buffer.from(newest.glb), 'the newest pinned model remains available');
    assert.deepEqual(await copy.port.storedOverlays(selected, read.scene,
      new Set(read.scene.occurrences.map(row => row.spaceOccurrenceId)), signal()), newest.overlays,
    'the newest home retains its documentary overlays under the same bound');
  } finally { await copy?.close(); }
  results.push('default ten-entry LRU: one account observation, three homes, newest cold copy and overlays retained');
}

// Tightening the entry bound below witness+content capacity must refuse the
// content write instead of evicting ownership or exceeding the caller's bound.
{
  const tightDisk = createSyntheticDisk(), store = openUnifiedAtlasStore(createSyntheticIndexedDB(tightDisk), { entries: 1 });
  await store.ready();
  try {
    const actor = await observeUnifiedAtlasActor(store, actorA);
    assert.equal(actor.actorId, actorA);
    const cache = createUnifiedAtlasCache(store, { actorId: actorA, ...scope }, actor);
    cache.keepModel(versions[1].composed.sha256, versions[1].glb);
    const witness = await store.read(JSON.stringify(['unified-atlas-last']), 'actor');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(witness)), actor,
      'content pressure cannot replace the retained canonical witness');
    assert.equal(await cache.model(versions[1].composed.sha256, versions[1].glb.byteLength), null,
      'content that cannot fit beside ownership is refused');
    assert.equal(tightDisk.databases.get(ATLAS_CACHE_DATABASE).stores.get('entries').records.size, 1,
      'protected ownership counts toward the tightened entry bound');
  } finally { await store.close(); }
}

await openProcess(disk, actorA, async ({ cache, store }) => {
  assert.ok(await stored(cache, v1));
  await store.clear();
  assert.equal(await stored(cache, v1), null, 'sign-out clears every stored copy');
});

for (const line of results) console.log(line);
console.log('Unified Atlas cache healthy checks passed.');
