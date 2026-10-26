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
const readerURL = await sourceURL('../integration/unified-atlas-reader.ts',
  { '../src/lantern/unified-atlas/scene': sceneURL, '../src/lantern/unified-atlas/types': typesURL });
const lastCopyURL = await sourceURL('../integration/last-atlas-copy.ts', { '../src/lantern/unified-atlas/types': typesURL,
  './unified-atlas-cache': cacheURL, './unified-atlas-reader': readerURL });
const syntheticURL = await sourceURL('./unified-atlas/synthetic-atlas.ts');
const { readUnifiedAtlas, readCachedUnifiedAtlas } = await import(readerURL);
const { openUnifiedAtlasStore, createUnifiedAtlasCache, ATLAS_CACHE_DATABASE } = await import(cacheURL);
const { openLastAtlasCopy } = await import(lastCopyURL);
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
  const cache = createUnifiedAtlasCache(store, { actorId, ...scope });
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
  await openProcess(lastDisk, actorA, async ({ store }) => { await store.clear(); });
  assert.equal(await openLastAtlasCopy(factory(), signal()), null, 'sign-out removes the last copy');
}

await openProcess(disk, actorA, async ({ cache, store }) => {
  assert.ok(await stored(cache, v1));
  await store.clear();
  assert.equal(await stored(cache, v1), null, 'sign-out clears every stored copy');
});

for (const line of results) console.log(line);
console.log('Unified Atlas cache healthy checks passed.');
