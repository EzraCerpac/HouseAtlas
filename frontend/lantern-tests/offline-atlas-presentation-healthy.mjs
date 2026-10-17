// Generated positive facade checks; in-memory resources only. No native host,
// provider, credentials, IndexedDB, browser, listener or held controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buffer = bytes => Uint8Array.from(bytes).buffer;
async function source(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:'), `Unexpected import ${match[1]}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const decimal = await source('../src/numeric/decimal.ts');
const lossless = await source('../src/numeric/lossless-json.ts', { './decimal': decimal });
const storage = await source('../src/offline/store.ts');
const manifestURL = await source('../src/offline/manifest.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, './store': storage });
const geometry = await source('../src/lantern/canonical-ifc/geometry.ts');
const types = await source('../src/lantern/unified-atlas/types.ts');
const sceneURL = await source('../src/lantern/unified-atlas/scene.ts', { '../canonical-ifc/geometry': geometry, './types': types });
const modelURL = await source('../src/offline/model-v2.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, '../lantern/unified-atlas/scene': sceneURL, './manifest': manifestURL });
const adapterURL = await source('../src/offline/saved-atlas-port.ts', { './manifest': manifestURL, './model-v2': modelURL, './store': storage });
const facadeURL = await source('../src/offline/saved-atlas-presentation.ts', {
  './manifest': manifestURL, './saved-atlas-port': adapterURL });
const syntheticURL = await source('./unified-atlas/synthetic-atlas.ts');
const { openSavedAtlasPresentation, createLiveAtlasPresentationPort } = await import(facadeURL);
const { readPackManifest, canonicalPack, PACK_LIMITS, SECTION_NAMES } = await import(manifestURL);
const { parseLosslessJson } = await import(lossless);
const { savedHouseKey } = await import(storage);
const { buildSyntheticAtlas, composeAtlasEnvelope, SYNTHETIC_ATLAS } = await import(syntheticURL);
const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const generated = await buildSyntheticAtlas(scope);
const composed = await composeAtlasEnvelope(generated.companionBytes, generated.glb, SYNTHETIC_ATLAS.revision);
const canonical = value => canonicalPack(parseLosslessJson(JSON.stringify(value)));
const encode = value => buffer(Buffer.from(canonical(value)));
const signal = () => new AbortController().signal;
async function capture(mode) {
  const resources = new Map(), rows = [];
  const add = (bytes, contentType, section, role, record = null) => {
    const sha256 = hash(Buffer.from(bytes)); resources.set(sha256, bytes);
    rows.push({ sha256, bytes: bytes.byteLength, contentType, section, role, record });
    return { resourceSha256: sha256, bytes: bytes.byteLength, contentType };
  };
  const home = add(encode({ profile: 'generated-home' }), 'application/json', 'home', 'section');
  const original = add(buffer(generated.glb), 'model/gltf-binary', 'model', 'model');
  const companion = add(buffer(generated.companionBytes), 'application/json', 'model', 'original');
  const room = generated.companion.rooms.find(room => room.nativePlaceId !== null);
  const links = { profile: 'houseatlas.unified-atlas-room-links.v1', ...scope, publicationId: composed.publicationId,
    semanticsSha256: composed.envelope.publication.semanticsSha256,
    links: [{ roomId: room.roomId, nativePlaceId: room.nativePlaceId, packagePlaceKey: 'generated:room',
      packagePlaceUuid: '00000000-0000-4000-8000-000000000802' }] };
  const roomLinks = mode === 'complete' ? add(encode(links), 'application/json', 'model', 'original') : null;
  const overview = JSON.parse(Buffer.from(composed.overviewManifestBytes));
  const root = { profile: 'houseatlas.home-read-pack.model.v2', overview: { ...overview,
    profile: 'houseatlas.model-overview-read.v1', manifestSha256: composed.manifestSha256,
    original: { ...original, sha256: original.resourceSha256 } },
    unifiedAtlas: mode === 'overview-only' ? null : { profile: 'houseatlas.home-read-pack.unified-atlas.v1',
      scope, publicationId: composed.publicationId, selectionRevision: SYNTHETIC_ATLAS.revision,
      semanticsSha256: companion.resourceSha256, companion, originalResourceSha256: original.resourceSha256, roomLinks } };
  const model = add(encode(root), 'application/json', 'model', 'section');
  const sections = Object.fromEntries(SECTION_NAMES.map(name => [name, { state: 'not-configured', resourceSha256: null, requiredBytesComplete: false }]));
  sections.home = { state: 'complete', resourceSha256: home.resourceSha256, requiredBytesComplete: true };
  sections.model = { state: mode === 'complete' ? 'complete' : 'partial', resourceSha256: model.resourceSha256, requiredBytesComplete: mode === 'complete' };
  const exclusions = mode === 'complete' ? [] : [{ section: 'model', code: 'room-map-unavailable', label: 'No saved room map is included' }];
  const manifest = { profile: 'houseatlas.home-read-pack.v1', scope, capturedAt: '2026-10-17T12:34:56.000Z',
    completeness: mode === 'complete' ? 'complete' : 'partial', limits: PACK_LIMITS,
    totals: { bytes: rows.reduce((sum, row) => sum + row.bytes, 0), resources: rows.length }, sections, resources: rows, exclusions };
  const snapshotId = hash(Buffer.from(canonical(manifest)));
  const admitted = await readPackManifest(encode({ ...manifest, snapshotId }), scope, true);
  const house = { version: 1, localRevision: randomUUID(), key: savedHouseKey(scope), scope, snapshotId,
    label: 'Generated house', capturedAt: admitted.capturedAt, shellBuildId: hash(Buffer.from('generated-shell')),
    resources: admitted.resources, manifest: admitted.localBytes };
  let reads = 0, checks = 0;
  const callbacks = new Set();
  const store = {
    list: async () => { checks++; return [structuredClone(house)]; },
    asset: async (selected, id) => {
      assert.equal(selected.localRevision, house.localRevision); assert.equal(selected.snapshotId, snapshotId);
      const row = house.resources.find(row => row.id === id); assert(row); reads++;
      return new Blob([resources.get(row.sha256)], { type: row.contentType });
    },
    subscribe: callback => { callbacks.add(callback); return () => callbacks.delete(callback); },
  };
  return { house, store, callbacks, resources, exclusions, counts: () => ({ reads, checks }) };
}
for (const mode of ['complete', 'partial-map', 'overview-only']) {
  const fixture = await capture(mode);
  console.log(JSON.stringify({ fixture: mode, snapshotId: fixture.house.snapshotId, localRevision: fixture.house.localRevision,
    overviewManifestSha256: composed.manifestSha256, semanticsSha256: hash(generated.companionBytes), modelSha256: composed.sha256 }));
  const port = await openSavedAtlasPresentation(fixture.store, fixture.house, signal());
  if (mode === 'overview-only') {
    assert.equal(port, null); assert.equal(fixture.callbacks.size, 0); continue;
  }
  const selected = port.current();
  assert.equal(selected.kind, 'saved'); assert(Object.isFrozen(selected)); assert(Object.isFrozen(selected.scope));
  assert.deepEqual(Object.keys(selected).sort(), ['kind', 'owner', 'scope', 'publicationId', 'overviewManifestSha256',
    'semanticsSha256', 'selectionRevision', 'snapshotId', 'localRevision', 'capturedAt'].sort());
  assert.equal(selected.overviewManifestSha256, hash(composed.overviewManifestBytes));
  assert.equal(selected.semanticsSha256, hash(generated.companionBytes));
  assert.equal(selected.snapshotId, fixture.house.snapshotId); assert.equal(selected.localRevision, fixture.house.localRevision);
  assert.deepEqual(selected.scope, scope); assert.equal(selected.publicationId, composed.publicationId);
  assert.equal(selected.selectionRevision, SYNTHETIC_ATLAS.revision); assert.equal(selected.capturedAt, fixture.house.capturedAt);
  assert.equal(new Set([selected.overviewManifestSha256, selected.semanticsSha256,
    selected.snapshotId, composed.sha256, generated.companion.sourceSha256]).size, 5);
  const before = fixture.counts().reads;
  for (let repeat = 0; repeat < 2; repeat++) {
    const read = await port.read(selected, signal());
    assert.equal(read.selection, selected);
    assert.deepEqual(Buffer.from(read.model), Buffer.from(generated.glb));
    assert.deepEqual(Buffer.from(read.companion), Buffer.from(generated.companionBytes));
    for (const plan of read.scene.plans) {
      const source = generated.companion.plans.find(item => item.planId === plan.planId);
      assert.deepEqual(plan.features, source.features);
      assert.deepEqual([...plan.featureIds].sort(), [...source.featureIds].sort());
    }
    assert.deepEqual(read.scene.overlayBindings, generated.companion.overlayBindings);
    assert.deepEqual(read.saved.exclusions, fixture.exclusions);
    assert.equal(read.saved.completeness, mode === 'complete' ? 'complete' : 'partial');
    assert.equal(read.scene.coverage.unselectableCount, 1);
    assert.equal(read.overlays.state, 'unavailable'); assert(!('createOverlays' in port));
    if (mode === 'complete') {
      assert.deepEqual(Buffer.from(read.roomLinks.bytes), Buffer.from(fixture.resources.get(read.roomLinks.resource.sha256)));
      assert.equal(read.roomLinks.data.links[0].roomId, generated.companion.rooms[0].roomId);
      assert(!('checkedAt' in read.roomLinks.data));
    } else assert.equal(read.roomLinks, null);
  }
  assert(fixture.counts().reads > before); assert(fixture.counts().checks > fixture.counts().reads * 2);
  // Independent allocations preserve content identity without sharing an owner.
  const second = await openSavedAtlasPresentation(fixture.store, fixture.house, signal());
  assert.notEqual(second.current().owner, selected.owner); second.dispose();
  let notifications = 0; const stop = port.subscribe(() => notifications++);
  port.dispose(); assert.equal(port.current(), null); assert.equal(notifications, 1); stop();
  assert.equal(fixture.callbacks.size, 0);
  console.log(`PASS ${mode}: exact tagged identities, bytes, coverage; ${fixture.counts().reads} checked resource reads`);
}
// Positive native forwarding preserves the original selection object and args.
const overview = { owner: {}, scope, expiresAt: '2026-10-18T00:00:00Z', publicationId: composed.publicationId,
  manifestSha256: composed.manifestSha256 };
const calls = [], nativeResult = { scene: composed.envelope, model: generated.glb }, overlayResult = { source: {}, request: {} };
const native = { current: () => overview, subscribe: callback => { calls.push(callback); return () => calls.push('unsubscribed'); },
  read: async (...args) => { calls.push(args); return nativeResult; },
  createOverlays: async (...args) => { calls.push(args); return overlayResult; } };
const live = createLiveAtlasPresentationPort(native), selected = live.current(), readSignal = signal();
assert.equal(selected.kind, 'live'); assert.equal(selected.overview, overview);
assert.equal(await live.read(selected, readSignal), nativeResult); assert.deepEqual(calls.pop(), [overview, readSignal]);
const building = composed.envelope.buildings[0];
assert.equal(await live.createOverlays(selected, nativeResult.scene, building, readSignal), overlayResult);
assert.deepEqual(calls.pop(), [overview, nativeResult.scene, building, readSignal]);
const changed = () => {}; live.subscribe(changed)(); assert.deepEqual(calls, [changed, 'unsubscribed']);
assert.equal(createLiveAtlasPresentationPort({ ...native, current: () => null }).current(), null);
const { createOverlays: _optional, ...withoutOverlays } = native;
assert.equal(await createLiveAtlasPresentationPort(withoutOverlays).createOverlays(selected, nativeResult.scene, building, readSignal), null);
console.log('PASS live wrapper: unchanged native selection/read/subscription and explicit live overlay forwarding');
console.log('PASS generated facade positives only; mounted offline, browser/storage and device acceptance remain unestablished');
