// Healthy generated checks for the unified Atlas production path only: the
// actual scene reader against an in-process synthetic HTTPS transport, the
// pinned three.js GLTFLoader through loadStandardGlb, selector binding, and the
// shared presentation used for drawing, picking, plans and labels. Generated
// data only; no server, browser, GPU, credentials, household input, native
// host or deployment. It adds no malformed, denial, replay, expiry, crash or
// private-intake case. Display-policy checks include explicit membership invariants; it takes no arguments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
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
const frontend = new URL('../', import.meta.url);
const { createElement } = await import(new URL('./node_modules/react/index.js', frontend).href);
const { renderToStaticMarkup } = await import(new URL('./node_modules/react-dom/server.node.js', frontend).href);
const detailsURL = await sourceURL('../src/lantern/unified-atlas/PublishedOverlayDetails.tsx', {
  react: new URL('./node_modules/react/index.js', frontend).href,
  'react/jsx-runtime': new URL('./node_modules/react/jsx-runtime.js', frontend).href,
});
const { PublishedOverlayDetails, PublishedUnplacedSource } = await import(detailsURL);
const threeURL = new URL('./node_modules/three/build/three.module.js', frontend).href;
const gltfLoaderURL = new URL('./node_modules/three/examples/jsm/loaders/GLTFLoader.js', frontend).href;
const pointersURL = await sourceURL('../src/lantern/canonical-ifc/stage-pointers.ts');
const labelsURL = await sourceURL('../src/lantern/unified-atlas/labels.ts');
const geometryURL = await sourceURL('../src/lantern/canonical-ifc/geometry.ts');
const preflightURL = await sourceURL('../src/lantern/canonical-ifc/glb-preflight.ts');
const standardURL = await sourceURL('../src/lantern/canonical-ifc/standard-glb.ts', { three: threeURL,
  'three/examples/jsm/loaders/GLTFLoader.js': gltfLoaderURL, './geometry': geometryURL, './glb-preflight': preflightURL });
const typesURL = await sourceURL('../src/lantern/unified-atlas/types.ts');
const sceneURL = await sourceURL('../src/lantern/unified-atlas/scene.ts', { '../canonical-ifc/geometry': geometryURL, './types': typesURL });
const atlasTextURL = await sourceURL('../src/lantern/unified-atlas/atlas-text.ts');
const iconURL = await sourceURL('../src/lantern/components/Icon.tsx', {
  'react/jsx-runtime': new URL('./node_modules/react/jsx-runtime.js', frontend).href,
});
const floorStackURL = await sourceURL('../src/lantern/unified-atlas/FloorStack.tsx', {
  react: new URL('./node_modules/react/index.js', frontend).href,
  'react/jsx-runtime': new URL('./node_modules/react/jsx-runtime.js', frontend).href,
  '../components/Icon': iconURL, './scene': sceneURL, './labels': labelsURL, './atlas-text': atlasTextURL,
});
const { FloorStack } = await import(floorStackURL);
const tonesURL = await sourceURL('../src/lantern/canonical-ifc/tones.ts');
const planPresentationURL = await sourceURL('../src/lantern/unified-atlas/plan-presentation.tsx', {
  react: new URL('./node_modules/react/index.js', frontend).href,
  'react/jsx-runtime': new URL('./node_modules/react/jsx-runtime.js', frontend).href,
  '../canonical-ifc/geometry': geometryURL, '../canonical-ifc/tones': tonesURL, './scene': sceneURL,
});
const { PlanTile, AreaValue, planTileLevels } = await import(planPresentationURL);
const graphURL = await sourceURL('../src/lantern/unified-atlas/NetworkGraph.tsx', {
  react: new URL('./node_modules/react/index.js', frontend).href,
  'react/jsx-runtime': new URL('./node_modules/react/jsx-runtime.js', frontend).href,
  // CSS has no server execution; component logic and React are the actual modules.
  './network-graph.css': dataURL(''),
});
const { NetworkGraph } = await import(graphURL);
const readerURL = await sourceURL('../integration/unified-atlas-reader.ts', { '../src/lantern/unified-atlas/scene': sceneURL,
  '../src/lantern/unified-atlas/types': typesURL, './sha256-thread': await sourceURL('../integration/sha256-thread.ts') });
const syntheticURL = await sourceURL('./unified-atlas/synthetic-atlas.ts');
const { stageTier, shownTier } = await import(await sourceURL('../src/lantern/unified-atlas/model-tier.ts'));

const { makeProjection, pointInShape, prepareMeshes, sourceMeshColor } = await import(geometryURL);
const { readGlbContainer } = await import(preflightURL);
const { loadStandardGlb } = await import(standardURL);
const scene = await import(sceneURL);
const measurements = await import(await sourceURL('../src/lantern/unified-atlas/measurements.ts', { './scene': sceneURL }));
const { readUnifiedAtlas, readUnifiedAtlasDetail } = await import(readerURL);
const { buildSyntheticAtlas, buildSingleFloorBuildingsAtlas, composeAtlasEnvelope, createAtlasTransport, atlasScenePath, SYNTHETIC_ATLAS, SYNTHETIC_OCCURRENCES,
  SYNTHETIC_ATLAS_DRAWN_PRIMITIVES } = await import(syntheticURL);
const { bindAtlasModel, presentAtlas, partLifts, levelLift, frameBox, pickOccurrence, planPoint, planPickOccurrence, labelHeight,
  occurrenceLiftLevel, occurrenceArea, contextOccurrenceIds, atlasReducer, initialAtlasState, hasExplodableLevels } = scene;

// ---- Read: production reader, generated transport ----------------------------------------
const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const { glb, companionBytes } = await buildSyntheticAtlas(scope);
const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
const calls = [];
const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: composed.envelopeBytes,
  href: composed.href, glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision, onRequest: url => calls.push(url) });
const selection = { owner: {}, scope, expiresAt: new Date(Date.now() + 600_000).toISOString(), publicationId: SYNTHETIC_ATLAS.publicationId,
  manifestSha256: composed.manifestSha256 };
const read = await readUnifiedAtlas({ selection, signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport });
assert.deepEqual(calls, [`${SYNTHETIC_ATLAS.origin}${atlasScenePath(scope)}?expectedManifestSha256=${composed.manifestSha256}`, `${SYNTHETIC_ATLAS.origin}${composed.href}`], 'scene, then its pinned model');
assert.deepEqual(Buffer.from(read.model), Buffer.from(glb));
const { createHash } = await import('node:crypto');
assert.equal(composed.manifestSha256, createHash('sha256').update(composed.overviewManifestBytes).digest('hex'));
assert.equal(new Set([composed.manifestSha256, composed.sha256, read.scene.publication.semanticsSha256, read.scene.publication.sourceSha256]).size, 4, 'overview manifest, model, semantics and source are separate pins');
assert.equal(read.scene.selection.revision, SYNTHETIC_ATLAS.revision);
assert.equal(read.scene.publication.semanticsSha256, (await import('node:crypto')).createHash('sha256').update(companionBytes).digest('hex'));
assert.equal(read.entryBuildingId, null, 'an unconfigured descriptor has no implicit primary building');
// Optional owner-selected presentation metadata accompanies the same verified
// descriptor and model; it is neither source JSON nor a native room binding.
const entryRead = await readUnifiedAtlas({ selection, signal: new AbortController().signal,
  origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport: async (...args) => {
    const response = await transport(...args);
    const headers = new Headers(response.headers);
    if (headers.get('content-type') === 'application/json') headers.set('x-atlas-entry-building-id', 'syn-building-house');
    return new Response(response.body, { status: response.status, headers });
  } });
assert.equal(entryRead.entryBuildingId, 'syn-building-house');
assert.deepEqual(entryRead.scene, read.scene);
assert.deepEqual(Buffer.from(entryRead.model), Buffer.from(read.model));

// Valid scalar text at the backend's human-field bounds. These generated
// source strings are retained exactly, not normalized or interpreted as dates.
const scalarText = (prefix, count) => prefix + '🧭'.repeat(count - [...prefix].length);
const unicode = JSON.parse(new TextDecoder().decode(companionBytes));
const sourceLabel = scalarText('Generated e\u0301 👩‍🔬 ', 128);
unicode.buildings[0].label = sourceLabel; unicode.levels[0].label = sourceLabel; unicode.rooms[0].label = sourceLabel;
unicode.levels[0].elevationBasis = scalarText('Generated source elevation ', 256);
unicode.occurrences[0].geometryBasis.sourceRef = scalarText('Generated source reference ', 256);
unicode.occurrences[0].geometryBasis.note = scalarText('Generated source note ', 1024);
unicode.coverage.exclusions = [scalarText('Generated exclusion ', 1024)];
const positioned = unicode.overlayBindings.find(binding => binding.anchor.kind === 'source-position');
positioned.anchor.basis = scalarText('Generated source position ', 1024);
positioned.sourceRevision = scalarText('Generated revision ', 128);
positioned.sourceUpdatedAt = scalarText('Generated source date text ', 64);
positioned.retrievedAt = scalarText('Generated retrieval text ', 64);
const unicodeEnvelope = await composeAtlasEnvelope(new TextEncoder().encode(JSON.stringify(unicode)), glb, SYNTHETIC_ATLAS.revision);
const unicodeRead = await readUnifiedAtlas({ selection: { ...selection, manifestSha256: unicodeEnvelope.manifestSha256 },
  signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: unicodeEnvelope.envelopeBytes,
    href: unicodeEnvelope.href, glb, sha256: unicodeEnvelope.sha256, manifestSha256: unicodeEnvelope.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
assert.equal(unicodeRead.scene.rooms[0].label, sourceLabel);
assert.equal(unicodeRead.scene.buildings[0].label, sourceLabel); assert.equal(unicodeRead.scene.levels[0].label, sourceLabel);
assert.equal(unicodeRead.scene.levels[0].elevationBasis, unicode.levels[0].elevationBasis);
assert.deepEqual(unicodeRead.scene.occurrences[0].geometryBasis, unicode.occurrences[0].geometryBasis);
const retainedPosition = unicodeRead.scene.overlayBindings.find(binding => binding.anchor.kind === 'source-position');
assert.deepEqual(retainedPosition, positioned);
assert.equal(unicodeRead.scene.coverage.exclusions[0].reason, unicode.coverage.exclusions[0]);
assert.equal([...retainedPosition.anchor.basis].length, 1024);

// Optional detail tier: the same publication unsimplified, admitted beside the
// model and only after it. The reader still fetches the scene and the model only.
const withDetail = composed.envelope.artifacts.concat({ artifactId: 'detail', role: 'detail', contentType: 'model/gltf-binary',
  bytes: 150 * 1024 * 1024, sha256: 'd'.repeat(64), href: composed.href.replace('/artifacts/model?', '/artifacts/model-detail?') });
const admitArtifacts = artifacts => {
  const envelope = { ...composed.envelope, artifacts };
  return scene.admitAtlasScene(envelope, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(envelope)).byteLength);
};
assert.equal(read.scene.detail, null, 'a publication without a detail GLB has none');
const { bytes: detailBytes, sha256: detailSha256, href: detailHref } = withDetail[1];
assert.deepEqual(admitArtifacts(withDetail).detail, { bytes: detailBytes, sha256: detailSha256, href: detailHref });
assert.throws(() => admitArtifacts([...withDetail].reverse()), error => error.reason === 'invalid', 'the model comes first');
assert.throws(() => admitArtifacts([withDetail[0], { ...withDetail[1], role: 'model' }]), error => error.reason === 'invalid');
assert.throws(() => admitArtifacts([withDetail[0], { ...withDetail[1], artifactId: 'model' }]), error => error.reason === 'invalid');
assert.throws(() => admitArtifacts([...withDetail, withDetail[1]]), error => error.reason === 'too-large');
assert.throws(() => admitArtifacts([withDetail[0], { ...withDetail[1], bytes: 256 * 1024 * 1024 + 1 }]), error => error.reason === 'too-large');
// Optional geographic frame for the sun: absent is null; present is all three
// degrees in range, never null. A neutral reference place, not a household one.
const admitFrame = frame => {
  const envelope = { ...composed.envelope, frame };
  return scene.admitAtlasScene(envelope, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(envelope)).byteLength);
};
assert.equal(read.scene.geographic, null, 'a release without a geographic frame has none');
const geographic = { latitude: 51.48, longitude: 0, northDeg: -12.5 };
assert.deepEqual(admitFrame({ ...composed.envelope.frame, geographic }).geographic, geographic);
for (const wrong of [null, { latitude: 51.48, longitude: 0 }, { ...geographic, altitude: 0 }, { ...geographic, latitude: 90.5 },
  { ...geographic, longitude: -181 }, { ...geographic, northDeg: 361 }, { ...geographic, northDeg: '0' }])
  assert.throws(() => admitFrame({ ...composed.envelope.frame, geographic: wrong }), error => error.reason === 'invalid', JSON.stringify(wrong));
const detailEnvelopeBytes = new TextEncoder().encode(JSON.stringify({ ...composed.envelope, artifacts: withDetail }));
const detailCalls = [];
const detailRead = await readUnifiedAtlas({ selection, signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: detailEnvelopeBytes,
    href: composed.href, glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision, onRequest: url => detailCalls.push(url) }) });
assert.deepEqual(detailCalls, calls.slice(0, 2), 'the detail is never fetched with the scene');
assert.equal(detailRead.scene.detail.href, detailHref);
assert.deepEqual(Buffer.from(detailRead.model), Buffer.from(glb));

// Full quality reads the detail on its own, after the scene: one GET of the
// exact href the scene pins, with the model's length, digest and revision checks.
const servedDetail = { ...withDetail[1], bytes: glb.byteLength, sha256: composed.sha256,
  href: composed.href.replace('/artifacts/model?', '/artifacts/model-detail?') };
const servedEnvelopeBytes = new TextEncoder().encode(JSON.stringify({ ...composed.envelope, artifacts: [withDetail[0], servedDetail] }));
const readDetail = async (served, sceneOf = detailScene, store) => {
  const urls = [];
  const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: servedEnvelopeBytes,
    href: composed.href, glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision,
    detail: { href: servedDetail.href, glb: served, sha256: composed.sha256 }, onRequest: url => urls.push(url) });
  const bytes = await readUnifiedAtlasDetail({ selection, scene: sceneOf, signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin,
    isCurrent: () => true, transport, store });
  return { bytes, urls };
};
const detailScene = (await readUnifiedAtlas({ selection, signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: servedEnvelopeBytes,
    href: composed.href, glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) })).scene;
const fullRead = await readDetail(glb);
assert.deepEqual(fullRead.urls, [`${SYNTHETIC_ATLAS.origin}${servedDetail.href}`], 'only the detail is fetched');
assert.deepEqual(Buffer.from(fullRead.bytes), Buffer.from(glb));
const tampered = glb.slice(); tampered[tampered.length - 1] ^= 1;
await assert.rejects(readDetail(tampered), { reason: 'invalid' }, 'bytes that miss the pinned digest are refused');
await assert.rejects(readDetail(glb.slice(1)), { reason: 'unavailable' }, 'a short body is refused');
await assert.rejects(readDetail(glb, read.scene), { reason: 'absent' }, 'a scene without a detail has nothing to read');
await assert.rejects(readDetail(glb, { ...detailScene, detail: { ...detailScene.detail, href: composed.href } }), { reason: 'invalid' },
  'only the detail route is read');

// Full quality keeps the verified detail on the device: the next read with the
// same pin uses the stored copy and fetches nothing. A copy that misses the
// digest is dropped and read again; a new pin replaces the old copy; a quota
// without the headroom stores nothing; removal clears every copy. The cache is
// an in-memory stand-in for Cache Storage.
const { openDetailStore, storedDetailBytes, clearDetailStore, subscribeDetailStore, DETAIL_STORE_NAME, DETAIL_STORE_HEADROOM } =
  await import(await sourceURL('../src/lantern/unified-atlas/detail-store.ts'));
function memoryCaches() {
  const named = new Map(), url = key => typeof key === 'string' ? key : key.url;
  const create = () => { const rows = new Map(); return {
    rows, async match(key) { return rows.get(url(key))?.clone(); }, async delete(key) { return rows.delete(url(key)); },
    async put(key, response) { rows.set(url(key), new Response(await response.arrayBuffer(), { headers: response.headers })); },
    async keys() { return [...rows.keys()].map(key => new Request(key)); } }; };
  return { named, async has(name) { return named.has(name); }, async delete(name) { return named.delete(name); },
    async open(name) { if (!named.has(name)) named.set(name, create()); return named.get(name); } };
}
/** Resolves after `count` store changes; subscribe before the operations that make them. */
const settled = (count = 1) => new Promise(resolve => { const off = subscribeDetailStore(() => { if (--count === 0) { off(); resolve(); } }); });
const owner = { actorId: 'synthetic-actor', workspaceId: scope.workspaceId, homeId: scope.homeId };
const roomy = { usage: 0, quota: glb.byteLength + DETAIL_STORE_HEADROOM };
let persistAsked = 0;
const manager = estimate => ({ estimate: async () => estimate, persisted: async () => false, persist: async () => { persistAsked++; return true; } });
const memory = memoryCaches(), host = { caches: memory, storage: manager(roomy), origin: SYNTHETIC_ATLAS.origin };
const store = openDetailStore(owner, host);
assert.equal(await storedDetailBytes(host), 0);
let kept = settled();
const missRead = await readDetail(glb, detailScene, store); await kept;
assert.equal(missRead.urls.length, 1, 'nothing stored yet: one download');
assert.equal(await storedDetailBytes(host), glb.byteLength, 'the verified download is kept');
assert.equal(persistAsked, 1, 'storing asks the browser to keep the origin');
const hitRead = await readDetail(tampered, detailScene, store);
assert.deepEqual(hitRead.urls, [], 'a stored copy with the pinned digest makes no request');
assert.deepEqual(Buffer.from(hitRead.bytes), Buffer.from(glb));
const [stored] = await (await memory.open(DETAIL_STORE_NAME)).keys();
memory.named.get(DETAIL_STORE_NAME).rows.set(stored.url, new Response(tampered, { headers: (await memory.named.get(DETAIL_STORE_NAME).match(stored)).headers }));
kept = settled(2);
const repaired = await readDetail(glb, detailScene, store); await kept;
assert.equal(repaired.urls.length, 1, 'a stored copy that misses the digest is not drawn: the detail is read again');
assert.deepEqual(Buffer.from(repaired.bytes), Buffer.from(glb));
assert.deepEqual(Buffer.from(await store.read(composed.sha256, glb.byteLength)), Buffer.from(glb), 'and the verified bytes replace it');
const other = openDetailStore(owner, host);
kept = settled(); other.keep('f'.repeat(64), glb.slice()); await kept;
assert.equal((await (await memory.open(DETAIL_STORE_NAME)).keys()).length, 1, 'one copy: a new pin replaces the old');
assert.equal(await store.read(composed.sha256, glb.byteLength), null);
assert.equal(await other.read('f'.repeat(64), glb.byteLength - 1), null, 'a length the pin does not name is not read');
const tight = { caches: memoryCaches(), storage: manager({ usage: 1, quota: glb.byteLength + DETAIL_STORE_HEADROOM }), origin: SYNTHETIC_ATLAS.origin };
kept = settled();
const tightRead = await readDetail(glb, detailScene, openDetailStore(owner, tight)); await kept;
assert.deepEqual(Buffer.from(tightRead.bytes), Buffer.from(glb), 'a quota without the headroom still shows Full');
assert.equal(await storedDetailBytes(tight), 0, 'but stores nothing');
const lost = settled(); await clearDetailStore(host); await lost;
assert.equal(await storedDetailBytes(host), 0, 'removal clears every copy');
assert.equal(memory.named.has(DETAIL_STORE_NAME), false);
// A stored entry its read refuses (wrong length) is replaced by the next verified keep.
const shortHost = { caches: memoryCaches(), storage: manager(roomy), origin: SYNTHETIC_ATLAS.origin };
const shortStore = openDetailStore(owner, shortHost);
kept = settled(); shortStore.keep(composed.sha256, glb.slice()); await kept;
const shortCache = shortHost.caches.named.get(DETAIL_STORE_NAME), [shortKey] = await shortCache.keys();
shortCache.rows.set(shortKey.url, new Response(glb.slice(1), { headers: (await shortCache.match(shortKey)).headers }));
assert.equal(await shortStore.read(composed.sha256, glb.byteLength), null, 'a short entry is not read');
kept = settled();
const shortRead = await readDetail(glb, detailScene, shortStore); await kept;
assert.equal(shortRead.urls.length, 1);
assert.deepEqual(Buffer.from(await shortStore.read(composed.sha256, glb.byteLength)), Buffer.from(glb), 'the verified download replaces it');
// Two keeps at once, for different homes, still leave one copy within the quota.
const raceHost = { caches: memoryCaches(), storage: manager(roomy), origin: SYNTHETIC_ATLAS.origin };
kept = settled(2);
openDetailStore(owner, raceHost).keep(composed.sha256, glb.slice());
openDetailStore({ ...owner, homeId: '00000000-0000-4000-8000-000000000802' }, raceHost).keep('e'.repeat(64), glb.slice());
await kept;
assert.equal((await raceHost.caches.named.get(DETAIL_STORE_NAME).keys()).length, 1, 'concurrent keeps replace one at a time');
// Removal waits behind a write another tab already queued on the origin-wide
// lock, so that write cannot bring the copy back. The lock stand-in grants in order.
let held = Promise.resolve();
const locks = { request: (name, task) => { const run = held.then(() => task()); held = run.catch(() => undefined); return run; } };
const lockedHost = { caches: memoryCaches(), storage: manager(roomy), origin: SYNTHETIC_ATLAS.origin, locks };
let release; const gate = new Promise(resolve => { release = resolve; });
locks.request(DETAIL_STORE_NAME, () => gate);
kept = settled(2);
openDetailStore(owner, lockedHost).keep(composed.sha256, glb.slice());
const removal = clearDetailStore(lockedHost);
release(); await removal; await kept;
assert.equal(await storedDetailBytes(lockedHost), 0, 'a write queued before removal does not survive it');
const unsupported = openDetailStore(owner, { origin: SYNTHETIC_ATLAS.origin });
assert.equal(await unsupported.read(composed.sha256, glb.byteLength), null, 'without Cache Storage nothing is stored or read');
unsupported.keep(composed.sha256, glb.slice());

// Admission-only projection at the 4,096-occurrence bound: four differently
// ordered room/non-room feature references each, plus an empty occurrence and
// an unbound context feature. No GLB binding or backend admission is claimed.
const wide = structuredClone(composed.envelope), extent = { min: [0, 0, 0], max: [1, 1, 1] };
const occurrenceIds = Array.from({ length: scene.ATLAS_LIMITS.occurrences }, (_, at) => `generated:occ:${at}`);
wide.buildings = [{ buildingId: 'generated:building', label: 'Generated building', nativePlaceId: null, bounds: extent, levelIds: ['generated:level'] }];
wide.levels = [{ levelId: 'generated:level', buildingId: 'generated:building', label: 'Generated level', nativePlaceId: null,
  sourceElevationM: null, elevationBasis: null, occurrenceIds, bounds: extent }];
wide.rooms = [{ roomId: 'generated:room', buildingId: 'generated:building', label: 'Generated room', nativePlaceId: null,
  nativeBinding: { status: 'unmapped', receiptSha256: null }, occurrenceIds }];
wide.occurrences = occurrenceIds.map((spaceOccurrenceId, at) => ({ spaceOccurrenceId, roomId: 'generated:room', buildingId: 'generated:building',
  levelId: 'generated:level', bounds: extent, planFeatureIds: at === occurrenceIds.length - 1 ? [] : [3, 1, 0, 2].map(part => `${spaceOccurrenceId}:feature:${part}`),
  geometryBasis: { kind: 'source-model', sourceRef: null, note: null } }));
const features = wide.occurrences.flatMap(occurrence => [...occurrence.planFeatureIds].sort().map((featureId, at) => ({ featureId,
  roomId: occurrence.roomId, spaceOccurrenceId: occurrence.spaceOccurrenceId, role: ['room', 'wall', 'opening', 'stair'][at],
  polygons: [{ outer: [[0, 0], [1, 0], [0, 1]], holes: [] }] })));
features.push({ featureId: 'generated:context', roomId: null, spaceOccurrenceId: null, role: 'context', polygons: [{ outer: [[0, 0], [1, 0], [0, 1]], holes: [] }] });
wide.plans = [{ planId: 'generated:plan', buildingId: 'generated:building', levelId: 'generated:level', coordinates: 'scene-XZ-metres',
  featureIds: features.map(feature => feature.featureId).reverse(), features }];
wide.meshBindings = []; wide.overlayBindings = [];
wide.coverage = { selectableOccurrences: [], unselectableOccurrences: occurrenceIds, exclusions: ['Generated admission-only projection; no bound model selectors.'] };
const admittedWide = scene.admitAtlasScene(wide, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(wide)).byteLength);
assert.equal(admittedWide.occurrences.length, 4096); assert.equal(admittedWide.plans[0].features.length, 16_381);
assert.equal(admittedWide.occurrences.at(-1).planFeatureIds.length, 0);
assert.deepEqual(admittedWide.occurrences[0].planFeatureIds, wide.occurrences[0].planFeatureIds);
assert.equal(admittedWide.coverage.unselectableCount, 4096);

// ---- Load and bind: standard loader transforms applied once -------------------------------
const loaded = await loadStandardGlb(read.model, 'atlas', new AbortController().signal);
assert.equal(loaded.drawn.length, SYNTHETIC_ATLAS_DRAWN_PRIMITIVES, 'every primitive of every node use is drawn once');
const model = bindAtlasModel(read.scene, loaded);

// Explicit split-level display policy; source containment remains unchanged.
{
  const policy = { profile: 'houseatlas.atlas-display.v1', publicationId: read.scene.publication.publicationId,
    semanticsSha256: read.scene.publication.semanticsSha256,
    groups: [{ levelIds: ['syn-level-split', 'syn-level-upper'], label: 'Generated split-level group' }],
    memberships: [{ nodeIndex: 2, meshIndex: 0, primitiveIndex: 4, levelIds: ['syn-level-ground'], cutaway: 'preserve' }] };
  const grouped = bindAtlasModel(read.scene, loaded, policy);
  assert.equal(grouped.scene, model.scene, 'display policy does not rewrite the admitted semantic scene');
  assert.deepEqual(grouped.parts.map(part => part.levelIds), model.parts.map(part => part.levelIds));
  assert.deepEqual(grouped.meshes.map(mesh => mesh.vertices), model.meshes.map(mesh => mesh.vertices));
  assert.deepEqual(scene.displayLevels(grouped, grouped.levelsByBuilding.get('syn-building-house')).map(level => level.levelId),
    ['syn-level-ground', 'syn-level-split'], 'one navigation step for the group');
  const base = { ...initialAtlasState(grouped, 'syn-building-house'), levelId: 'syn-level-split' };
  const shown = presentAtlas(grouped, base, new Set());
  assert.deepEqual([...shown.focusLevels], ['syn-level-split', 'syn-level-upper']);
  const propertyPlan = presentAtlas(grouped, { ...initialAtlasState(grouped), buildingId: null, view: 'plan' }, new Set());
  assert.equal(propertyPlan.focusLevels.size, 0, 'property plans are not a selected display group');
  assert.equal(propertyPlan.pickable.size, 0, 'property Plan still picks a building first');
  const expected = read.scene.occurrences.filter(row => ['syn-level-split', 'syn-level-upper'].includes(row.levelId)
    && grouped.selectable.has(row.spaceOccurrenceId)).map(row => row.spaceOccurrenceId).sort();
  assert.deepEqual([...shown.pickable].sort(), expected, 'both member levels retain their own room picks');
  for (const levelId of shown.focusLevels) {
    const wall = grouped.parts.find(part => part.role === 'structure' && part.levelId === levelId);
    assert.ok(wall);
    assert.equal(shown.clips.get(wall.mesh.meshKey), grouped.floorY.get(levelId) + scene.SECTION_HEIGHT,
      'each member wall cuts relative to its own floor');
  }
  const box = frameBox(grouped, base, shown);
  const projection = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, box, { width: 960, height: 640 }, 0);
  for (const occurrenceId of expected) {
    const occurrence = grouped.occurrencesById.get(occurrenceId), point = grouped.labels.get(occurrenceId);
    assert.ok(point);
    const pixel = projection.project(point.x, grouped.floorY.get(occurrence.levelId) + 0.6, point.z);
    // The exact surface target also checks occlusion; this verifies both levels'
    // own CPU room-pick geometry is admitted in the grouped presentation.
    assert.equal(pickOccurrence(grouped, shown, 0, projection, pixel[0], pixel[1]), occurrenceId);
  }
  const props = { model: grouped, levels: grouped.levelsByBuilding.get('syn-building-house'),
    buildings: grouped.floorBuildings, buildingNav: true,
    building: { buildingId: 'syn-building-house', label: 'Generated building' }, state: base,
    dispatch() {}, chooseBuilding() {}, shownLevel: null, selectionLevel: null, contextLevels: new Set(),
    canExplode: true, compact: false, open: true, setOpen() {}, head: { current: null }, panelId: 'generated-group-panel' };
  const markup = renderToStaticMarkup(createElement(FloorStack, props));
  assert.equal((markup.match(/class="ua-rung-name">Generated split-level group</g) ?? []).length, 1, 'one group choice in the rail');
  const planMarkup = renderToStaticMarkup(createElement(FloorStack, { ...props, state: { ...base, view: 'plan' } }));
  assert.match(planMarkup, /aria-label="Plan level"/);
  assert.match(planMarkup, /Split level/);
  assert.match(planMarkup, /Upper floor/i);
  for (const levelId of shown.focusLevels) for (const occurrenceId of grouped.levelsById.get(levelId).occurrenceIds) {
    if (!grouped.selectable.has(occurrenceId)) continue;
    const bounds = grouped.occurrencesById.get(occurrenceId).bounds;
    assert.ok(box.min[0] <= bounds.min[0] && box.max[0] >= bounds.max[0]
      && box.min[2] <= bounds.min[2] && box.max[2] >= bounds.max[2], 'group frame contains each room footprint');
  }
  const shared = grouped.parts.find(part => grouped.displayMemberships.has(part.mesh.meshKey));
  assert.ok(shared);
  assert.deepEqual(shared.levelIds, ['syn-level-ground', 'syn-level-upper'], 'multilevel containment is retained');
  const lower = presentAtlas(grouped, { ...base, levelId: 'syn-level-ground' }, new Set());
  assert.equal(lower.hidden.has(shared.mesh.meshKey), false);
  assert.equal(lower.clips.get(shared.mesh.meshKey), null, 'connecting structure keeps its full height in its display scope');
  assert.equal(shown.hidden.has(shared.mesh.meshKey), true, 'lower-flight association is separate from grouped membership');
  const ceilings = scene.sectionCeilings(grouped), targets = scene.sectionTargets(grouped, shown, ceilings);
  const moving = scene.easePresentation(grouped, shown, 0, targets.map((target, at) => (target + ceilings[at]) / 2), targets, ceilings);
  const lowWall = grouped.parts.find(part => part.role === 'structure' && part.levelId === 'syn-level-split');
  const highWall = grouped.parts.find(part => part.role === 'structure' && part.levelId === 'syn-level-upper');
  assert.ok(moving.clips.get(lowWall.mesh.meshKey) < moving.clips.get(highWall.mesh.meshKey), 'per-level cuts also differ in transition');
  const selected = atlasReducer(grouped, base, { type: 'select', occurrenceId: 'syn-occ-bath' });
  assert.equal(selected.levelId, 'syn-level-upper');
  assert.equal(selected.occurrenceId, 'syn-occ-bath');
  const plan = atlasReducer(grouped, selected, { type: 'view', view: 'plan' });
  assert.deepEqual(presentAtlas(grouped, plan, new Set()).planLevels, ['syn-level-upper'], 'Plan uses one actual member');
  const otherPlan = atlasReducer(grouped, plan, { type: 'level', levelId: 'syn-level-split' });
  assert.deepEqual(presentAtlas(grouped, otherPlan, new Set()).planLevels, ['syn-level-split']);
  const back = atlasReducer(grouped, otherPlan, { type: 'view', view: '3d' });
  assert.deepEqual([...presentAtlas(grouped, back, new Set()).focusLevels], ['syn-level-split', 'syn-level-upper']);
  assert.equal(scene.admitAtlasDisplay(read.scene, { ...policy, semanticsSha256: '0'.repeat(64) }), null, 'no retargeting after publication changes');
  assert.throws(() => scene.admitAtlasDisplay(read.scene, { ...policy, groups: [...policy.groups, ...policy.groups] }),
    'overlapping groups cannot assign ambiguous navigation');
  assert.throws(() => scene.admitAtlasDisplay(read.scene, { ...policy, memberships: [{ ...policy.memberships[0], levelIds: ['syn-level-studio'] }] }),
    'a display override cannot cross buildings');
}


// Owner-measured dimensions travel on the occurrence: absent means none; a
// measured area and a measured wall replace the "≈" outline values as given,
// and the other walls keep their approximate spans.
{
  const owner = read.scene.occurrences.find(o => o.geometryBasis.kind === 'source-model' && model.selectable.has(o.spaceOccurrenceId)
    && measurements.edgeSpans(model, o.spaceOccurrenceId).length > 1);
  assert.ok(owner, 'a generated room part with outline spans');
  assert.equal(owner.measured, undefined, 'nothing measured unless the release says so');
  const feature = read.scene.plans.flatMap(plan => plan.features).find(f => f.role === 'room' && f.spaceOccurrenceId === owner.spaceOccurrenceId);
  const outer = feature.polygons[0].outer, first = measurements.ringRuns(outer)[0];
  const from = outer.findIndex(p => p[0] === first.a[0] && p[1] === first.a[1]), to = outer.findIndex(p => p[0] === first.b[0] && p[1] === first.b[1]);
  const basis = 'owner-confirmed-measurement';
  const wall = { quantity: 'length', value: 3.52, unit: 'm', basis, edge: { featureId: feature.featureId, polygon: 0, from, to } };
  const withMeasured = dimensions => {
    const envelope = { ...composed.envelope, occurrences: composed.envelope.occurrences.map(o =>
      o.spaceOccurrenceId === owner.spaceOccurrenceId ? { ...o, measuredDimensions: dimensions } : o) };
    return scene.admitAtlasScene(envelope, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(envelope)).byteLength);
  };
  const admitted = withMeasured([{ quantity: 'area', value: 14.65, unit: 'm2', basis }, wall]);
  const measuredModel = bindAtlasModel(admitted, loaded);
  const area = measurements.roomArea(measuredModel, owner.spaceOccurrenceId);
  assert.equal(area.measured, true); assert.equal(area.text, '14.65 m²');
  const spans = measurements.edgeSpans(measuredModel, owner.spaceOccurrenceId), before = measurements.edgeSpans(model, owner.spaceOccurrenceId);
  assert.equal(spans.length, before.length, 'a measured run replaces its outline span, never adds one');
  assert.deepEqual(spans.filter(span => span.measured).map(span => span.text), ['3.52 m']);
  assert.ok(spans.filter(span => !span.measured).every(span => span.text.startsWith('≈ ')));
  assert.equal(measurements.carriesMeasurements(measuredModel, owner.spaceOccurrenceId), true);
  assert.equal(measurements.carriesMeasurements(model, owner.spaceOccurrenceId), false);
  // Reversed ends walk the rest of the ring: listed end to end, never on this run.
  const reversed = measurements.edgeSpans(bindAtlasModel(withMeasured([{ ...wall, value: 12, edge: { ...wall.edge, from: to, to: from } }]), loaded), owner.spaceOccurrenceId);
  assert.equal(reversed.length, before.length + 1); assert.equal(reversed[0].text, before[0].text);
  assert.deepEqual(reversed.filter(span => span.measured).map(span => [span.text, span.drawn]), [['12 m', false]], 'listed, never drawn');
  // Two sides in ring order are not one wall: listed only, never drawn as their chord.
  const second = measurements.ringRuns(outer)[1], corner = outer.findIndex(p => p[0] === second.b[0] && p[1] === second.b[1]);
  const bent = measurements.edgeSpans(bindAtlasModel(withMeasured([{ ...wall, value: 8, edge: { ...wall.edge, to: corner } }]), loaded), owner.spaceOccurrenceId);
  assert.deepEqual(bent.filter(span => span.measured).map(span => [span.text, span.drawn]), [['8 m', false]]);
  assert.ok(bent.filter(span => !span.measured).every(span => span.drawn));
  assert.ok(spans.every(span => span.drawn), 'a measured single run is drawn along its wall');
  assert.equal(measurements.roomArea(bindAtlasModel(withMeasured([{ quantity: 'area', value: 0.004, unit: 'm2', basis }]), loaded),
    owner.spaceOccurrenceId).text, '0.004 m²', 'a small measured value is never shown as zero');
  assert.ok(!/^0 /.test(measurements.measuredText(1e-7, 'm')), 'however small');
  assert.equal(measurements.measuredText(1234.5, 'm²'), (1234.5).toLocaleString() + ' m²');
  for (const wrong of [[], [{ quantity: 'area', value: 14, unit: 'm2', basis }, { quantity: 'area', value: 15, unit: 'm2', basis }],
    [wall, wall], [{ ...wall, value: 0 }], [{ ...wall, unit: 'cm' }], [{ ...wall, basis: 'outline' }],
    [{ ...wall, edge: { ...wall.edge, to: from } }], [{ ...wall, edge: { ...wall.edge, to: outer.length } }],
    [{ ...wall, edge: { ...wall.edge, polygon: feature.polygons.length } }], [{ ...wall, note: 'x' }],
    [{ quantity: 'height', value: 2.6, unit: 'm', basis }]])
    assert.throws(() => withMeasured(wrong), error => error.reason === 'invalid', JSON.stringify(wrong));
}

// Tier ownership: the stage reads the model whose meshes are on screen. Light
// draws first even when Full is already bound; Full is drawn behind it and owns
// picking only once its meshes are shown; leaving Full draws Light behind Full.
{
  const light = model, full = { ...model, meshes: model.meshes.map(mesh => ({ ...mesh })) };
  assert.deepEqual(stageTier(light, full, null), { model: light, target: light }, 'nothing shown yet: Light first, however fast Full arrived');
  assert.equal(shownTier(light, light.meshes), light);
  assert.deepEqual(stageTier(light, full, light), { model: light, target: full }, 'Full builds behind; Light still owns picks');
  assert.equal(shownTier(full, light.meshes), null, 'a set the stage no longer wants does not take over');
  assert.equal(shownTier(full, full.meshes), full);
  assert.deepEqual(stageTier(light, full, full), { model: full, target: full });
  assert.deepEqual(stageTier(light, null, full), { model: full, target: light }, 'back to Light: Full owns picks until Light is drawn');
  assert.deepEqual(stageTier(light, null, null), { model: light, target: light });
}
const near = (a, b, label) => a.forEach((value, at) => assert.ok(Math.abs(value - b[at]) < 1e-4, `${label}: ${a} vs ${b}`));
const drawnAt = (node, primitive) => model.parts[loaded.drawn.findIndex(row => row.nodeIndex === node && row.primitiveIndex === primitive)];
// Nested translations (site > house > rooms) land at the companion's world coordinates, not twice.
const hallPick = model.pickParts.get('syn-occ-hall')[0];
near(hallPick.mesh.bounds.min, [102.1, 0.02, 51.1], 'hall pick min'); near(hallPick.mesh.bounds.max, [104.4, 2.4, 58.9], 'hall pick max');
// The reused lamp mesh is two separate drawn primitives at their own node transforms.
near(drawnAt(5, 0).mesh.bounds.min, [100.4, 0, 50.4], 'lamp A'); near(drawnAt(9, 0).mesh.bounds.min, [118.9, 0, 55.9], 'lamp B');
assert.equal(drawnAt(5, 0).buildingId, 'syn-building-house'); assert.equal(drawnAt(9, 0).buildingId, 'syn-building-studio');
// A multi-primitive mesh: each primitive keeps its own level membership.
assert.deepEqual([0, 1, 2, 3, 4, 5].map(primitive => drawnAt(2, primitive).levelIds.join('+')),
  ['syn-level-ground', 'syn-level-split', 'syn-level-upper', 'syn-level-ground', 'syn-level-ground+syn-level-upper', 'syn-level-split']);
assert.equal(drawnAt(2, 4).levelId, null, 'the shared slab moves with no single level');
assert.ok(model.parts.every(part => part.buildingId && Array.isArray(part.levelIds)), 'explicit building and level membership on every part');

// A complete valid generated colour publication keeps the same geometry and
// selectors, with its own model and companion pins. Reuse the generated BIN
// unchanged while declaring opaque core materials in its glTF JSON.
const colourFactors = [[.25, .5, .75, 1], [.625, .125, .375, 1]];
const colourContainer = readGlbContainer(glb);
assert.ok(colourContainer.bin);
const colourJson = { ...colourContainer.json,
  materials: [...colourFactors.map(baseColorFactor => ({ pbrMetallicRoughness: { baseColorFactor, metallicFactor: 0, roughnessFactor: 1 } })),
    { pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }],
  meshes: colourContainer.json.meshes.map(mesh => ({ ...mesh,
    primitives: mesh.primitives.map((primitive, at) => ({ ...primitive, material: (at + 1) % 3 })) })),
};
const colourJsonBefore = JSON.stringify(colourJson), colourText = new TextEncoder().encode(colourJsonBefore);
const paddedLength = size => (size + 3) & ~3;
const colourJsonLength = paddedLength(colourText.byteLength), colourBinLength = paddedLength(colourContainer.bin.byteLength);
const colourGlb = new Uint8Array(28 + colourJsonLength + colourBinLength), colourView = new DataView(colourGlb.buffer);
colourView.setUint32(0, 0x46546c67, true); colourView.setUint32(4, 2, true); colourView.setUint32(8, colourGlb.byteLength, true);
colourView.setUint32(12, colourJsonLength, true); colourView.setUint32(16, 0x4e4f534a, true);
colourGlb.set(colourText, 20); colourGlb.fill(0x20, 20 + colourText.byteLength, 20 + colourJsonLength);
colourView.setUint32(20 + colourJsonLength, colourBinLength, true); colourView.setUint32(24 + colourJsonLength, 0x004e4942, true);
colourGlb.set(colourContainer.bin, 28 + colourJsonLength);
const colourCompanion = JSON.parse(new TextDecoder().decode(companionBytes));
colourCompanion.original = { sha256: createHash('sha256').update(colourGlb).digest('hex'), bytes: colourGlb.byteLength };
const colourCompanionBytes = new TextEncoder().encode(JSON.stringify(colourCompanion));
const colourEnvelope = await composeAtlasEnvelope(colourCompanionBytes, colourGlb, SYNTHETIC_ATLAS.revision);
const colourCalls = [], colourBytesBefore = colourGlb.slice();
const colourRead = await readUnifiedAtlas({ selection: { ...selection, manifestSha256: colourEnvelope.manifestSha256 },
  signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: colourEnvelope.envelopeBytes,
    href: colourEnvelope.href, glb: colourGlb, sha256: colourEnvelope.sha256, manifestSha256: colourEnvelope.manifestSha256,
    revision: SYNTHETIC_ATLAS.revision, onRequest: url => colourCalls.push(url) }) });
assert.deepEqual(colourCalls, [`${SYNTHETIC_ATLAS.origin}${atlasScenePath(scope)}?expectedManifestSha256=${colourEnvelope.manifestSha256}`,
  `${SYNTHETIC_ATLAS.origin}${colourEnvelope.href}`], 'the colour publication reads only its exact scene and pinned model');
assert.deepEqual(Buffer.from(colourRead.model), Buffer.from(colourGlb));
assert.equal(colourRead.scene.publication.semanticsSha256, createHash('sha256').update(colourCompanionBytes).digest('hex'));
assert.notEqual(colourEnvelope.sha256, composed.sha256);
assert.notEqual(colourEnvelope.manifestSha256, composed.manifestSha256);
const colourLoaded = await loadStandardGlb(colourRead.model, 'atlas', new AbortController().signal);
const colourModel = bindAtlasModel(colourRead.scene, colourLoaded);
assert.deepEqual(colourLoaded.drawn, loaded.drawn, 'authored colours retain every node/mesh/primitive selector and draw order');
assert.deepEqual(colourLoaded.counts, loaded.counts); assert.deepEqual(colourLoaded.work, loaded.work);
colourLoaded.meshes.forEach((mesh, at) => {
  const expected = [colourFactors[1], undefined, colourFactors[0]][colourLoaded.drawn[at].primitiveIndex % 3];
  assert.deepEqual(mesh.sourceBaseColor, expected, 'the exact primitive material supplies its raw linear RGBA factor');
  if (expected) assert.equal(Object.isFrozen(mesh.sourceBaseColor), true);
  assert.equal(loaded.meshes[at].sourceBaseColor, undefined, 'the existing no-material publication keeps its palette');
  assert.deepEqual(mesh.vertices, loaded.meshes[at].vertices);
  assert.deepEqual(mesh.bounds, loaded.meshes[at].bounds); assert.deepEqual(mesh.yRange, loaded.meshes[at].yRange);
  assert.equal(mesh.triangles, loaded.meshes[at].triangles); assert.equal(mesh.vertices.byteLength, mesh.triangles * 72);
  const part = colourModel.parts[at], original = model.parts[at];
  assert.equal(part.mesh.sourceBaseColor, mesh.sourceBaseColor, 'the binder retains the same immutable factor');
  assert.equal(part.mesh.vertices, mesh.vertices, 'binding does not rebuild colour or geometry buffers');
  assert.deepEqual([part.role, part.buildingId, part.levelIds, part.levelId, part.occurrenceId],
    [original.role, original.buildingId, original.levelIds, original.levelId, original.occurrenceId]);
});
const colourAt = (node, primitive) => colourModel.parts[colourLoaded.drawn.findIndex(row => row.nodeIndex === node && row.primitiveIndex === primitive)];
assert.deepEqual([0, 1, 2, 3, 4, 5].map(primitive => colourAt(2, primitive).mesh.sourceBaseColor),
  [colourFactors[1], undefined, colourFactors[0], colourFactors[1], undefined, colourFactors[0]]);
assert.deepEqual([colourAt(5, 0).mesh.sourceBaseColor, colourAt(9, 0).mesh.sourceBaseColor], [colourFactors[1], colourFactors[1]],
  'both transformed uses of the shared lamp retain its own primitive material');
const colourState = { enabled: true, selected: false, reference: false,
  selectedOccurrenceId: null, contextOccurrenceIds: [], tints: new Map() };
const colourHall = colourModel.pickParts.get('syn-occ-hall')[0].mesh;
for (const mesh of [colourHall, colourAt(3, 0).mesh, colourAt(5, 0).mesh, colourAt(10, 0).mesh]) {
  assert.deepEqual(mesh.sourceBaseColor, colourFactors[1]);
  assert.equal(sourceMeshColor(mesh, colourState), mesh.sourceBaseColor, 'normal room, roof and context appearance uses source colour before fallback tones');
  for (const enabled of [false, undefined]) assert.equal(sourceMeshColor(mesh, { ...colourState, enabled }), undefined);
  assert.equal(sourceMeshColor(mesh, { ...colourState, selected: true }), undefined, 'explicit mesh selection wins');
  assert.equal(sourceMeshColor(mesh, { ...colourState, reference: true }), undefined, 'reference presentation wins');
}
assert.equal(sourceMeshColor(colourAt(2, 1).mesh, colourState), undefined, 'a valid material without an explicit factor uses the palette');
for (const highlight of [{ selectedOccurrenceId: 'syn-occ-hall' }, { contextOccurrenceIds: ['syn-occ-hall'] },
  { tints: new Map([['syn-occ-hall', '#5382A6']]) }])
  assert.equal(sourceMeshColor(colourHall, { ...colourState, ...highlight }), undefined, 'selected, related and overlay room highlights each win');
for (const elsewhere of [{ selectedOccurrenceId: 'syn-occ-living' }, { contextOccurrenceIds: ['syn-occ-living'] },
  { tints: new Map([['syn-occ-living', '#5382A6']]) }])
  assert.equal(sourceMeshColor(colourHall, { ...colourState, ...elsewhere }), colourHall.sourceBaseColor, 'another room highlight never suppresses this source colour');
assert.deepEqual(colourGlb, colourBytesBefore); assert.equal(JSON.stringify(colourJson), colourJsonBefore);

// Split levels in actual height order, whatever the listed order.
assert.deepEqual(model.levelsByBuilding.get('syn-building-house').map(level => level.levelId), ['syn-level-ground', 'syn-level-split', 'syn-level-upper']);
assert.deepEqual(['syn-level-ground', 'syn-level-split', 'syn-level-upper'].map(key => model.floorY.get(key)), [0, 1.4, 2.8]);
near([model.spread.get('syn-building-house')], [2.8], 'display gap close to one storey');
assert.equal(model.selectable.size, 10); assert.ok(!model.selectable.has('syn-occ-void'));
assert.equal(read.scene.coverage.exclusions[0].reason, 'No floor outline in the generated source.');

// Duplicate labels stay two rooms on two floors.
const bedrooms = read.scene.rooms.filter(room => room.label === 'Bedroom');
assert.equal(bedrooms.length, 2); assert.notEqual(bedrooms[0].roomId, bedrooms[1].roomId);
assert.deepEqual(bedrooms.map(room => model.occurrencesById.get(room.occurrenceIds[0]).levelId).sort(), ['syn-level-split', 'syn-level-upper']);
assert.ok(bedrooms.every(room => model.labels.has(room.occurrenceIds[0])));
// One room with parts on two floors.
assert.deepEqual(contextOccurrenceIds(model, 'syn-occ-stairs-ground'), ['syn-occ-stairs-upper']);
assert.equal(model.occurrencesById.get('syn-occ-study').geometryBasis.kind, 'owner-estimated-pick-proxy');

// ---- Overlay joins: publication + room + reviewed native place only -----------------------
const electrical = model.overlays.get('electrical'), network = model.overlays.get('network');
assert.deepEqual([...electrical.placed.keys()].sort(), ['syn-occ-hall', 'syn-occ-living']);
assert.equal(electrical.placed.get('syn-occ-hall').occurrenceId, 'syn-occ-hall');
assert.equal(electrical.placed.get('syn-occ-hall').recordIds.length, 3);
assert.deepEqual(electrical.placed.get('syn-occ-living').positions.map(row => row.occurrenceId), ['syn-occ-living']);
assert.deepEqual(electrical.unplaced, []);
assert.deepEqual([...network.placed.keys()], ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
assert.deepEqual(network.unplaced, []);
assert.deepEqual([electrical.records, electrical.unplacedRecords, network.records, network.unplacedRecords], [4, 0, 1, 0]);

// A valid mixed-scope source projection on one logical two-floor room. Shared
// facts fan out, explicit records/dates/positions stay on their own occurrence.
const shared = { ...read.scene.overlayBindings.find(row => row.kind === 'network'), recordIds: ['generated:shared'],
  sourceRevision: 'a|b', sourceUpdatedAt: 'c', retrievedAt: 'd' };
const ground = { ...shared, recordIds: ['generated:ground'], spaceOccurrenceId: 'syn-occ-stairs-ground',
  sourceRevision: 'a', sourceUpdatedAt: 'b|c',
  anchor: { kind: 'source-position', position: [105, 0.3, 57], basis: positioned.anchor.basis } };
const upper = { ...shared, recordIds: ['generated:upper'], spaceOccurrenceId: 'syn-occ-stairs-upper',
  sourceRevision: 'Generated upper revision', sourceUpdatedAt: null, anchor: { kind: 'room-summary' } };
const scopedScene = { ...read.scene, overlayBindings: [shared, ground, upper] };
const scoped = bindAtlasModel(scopedScene, loaded).overlays.get('network');
const groundPlacement = scoped.placed.get('syn-occ-stairs-ground'), upperPlacement = scoped.placed.get('syn-occ-stairs-upper');
assert.deepEqual(groundPlacement.recordIds, ['generated:shared', 'generated:ground']);
assert.deepEqual(upperPlacement.recordIds, ['generated:shared', 'generated:upper']);
assert.deepEqual(groundPlacement.bindings, [shared, ground]); assert.deepEqual(upperPlacement.bindings, [shared, upper]);
assert.deepEqual(groundPlacement.positions, [{ occurrenceId: ground.spaceOccurrenceId, position: ground.anchor.position, basis: ground.anchor.basis }]);
assert.deepEqual(upperPlacement.positions, []); assert.equal(scoped.records, 3);
const groundHTML = renderToStaticMarkup(createElement(PublishedOverlayDetails, { placement: groundPlacement }));
assert.ok(groundHTML.includes(ground.anchor.basis), 'Actual React details retain the full source-position basis');
assert.ok(groundHTML.includes('Model-frame coordinates; physical registration unknown.'));
assert.ok(groundHTML.includes('generated:ground') && !groundHTML.includes('generated:upper'));
assert.ok(!groundHTML.includes('Generated upper revision'), 'Another floor source date is not rendered');
const unknownDate = { ...shared, sourceRevision: 'Generated unknown', sourceUpdatedAt: null, retrievedAt: null };
const literalNull = { ...unknownDate, sourceUpdatedAt: 'null' };
const datesHTML = renderToStaticMarkup(createElement(PublishedOverlayDetails, {
  placement: { ...groundPlacement, bindings: [shared, ground, unknownDate, literalNull, shared] },
}));
const dateList = datesHTML.match(/<ul class="ua-dates">([\s\S]*?)<\/ul>/)[1];
assert.equal((dateList.match(/<li>/g) ?? []).length, 4, 'Distinct delimiter/null tuples survive; only the exact repeated tuple is grouped');
assert.ok(dateList.includes('a|b') && dateList.includes('b|c') && dateList.includes('update date unknown') && dateList.includes('>null</time>'));
const buildingPosition = { ...shared, anchor: { kind: 'source-position', position: [105, 0.3, 57], basis: 'Generated building source position; occurrence not specified.' } };
const buildingHTML = renderToStaticMarkup(createElement(PublishedOverlayDetails, {
  placement: { ...groundPlacement, positions: [], bindings: [buildingPosition] },
}));
assert.ok(buildingHTML.includes(buildingPosition.anchor.basis) && buildingHTML.includes('<dd>Unspecified</dd>'));

// Sparse shapes the backend admits, as in its generated publication: an
// electrical binding with no record IDs and a reviewed logical room with no
// occurrence. Record IDs use this fixture's generated text, like the rest of it. One record shared by two reasons counts once per reason and once
// in the total. Scene admission and binding only; the GLB is unchanged.
const sparse = structuredClone(composed.envelope);
const unpositionedPlace = '00000000-0000-4000-8000-0000000a71ff';
sparse.rooms.push({ roomId: 'generated:room-unpositioned', buildingId: 'syn-building-house', label: 'Generated unpositioned room',
  nativePlaceId: unpositionedPlace, nativeBinding: { status: 'reviewed', receiptSha256: 'c'.repeat(64) }, occurrenceIds: [] });
const hallElectrical = sparse.overlayBindings.find(row => row.kind === 'electrical' && row.roomId === 'syn-room-hall');
hallElectrical.recordIds = [];
const stairsNetwork = sparse.overlayBindings.find(row => row.kind === 'network');
const studyNetwork = { ...stairsNetwork, roomId: 'syn-room-study', nativePlaceId: null, recordIds: ['generated:shared-record'] };
sparse.overlayBindings.push(
  { ...stairsNetwork, roomId: 'generated:room-unpositioned', nativePlaceId: unpositionedPlace, recordIds: ['generated:shared-record', 'generated:unpositioned'] },
  studyNetwork, { ...studyNetwork, sourceRevision: 'Generated second study revision' });
const sparseScene = scene.admitAtlasScene(sparse, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(sparse)).byteLength);
assert.deepEqual(sparseScene.rooms.at(-1).occurrenceIds, []);
assert.deepEqual(sparseScene.overlayBindings.find(row => row.roomId === 'syn-room-hall' && row.kind === 'electrical'), hallElectrical,
  'the empty binding keeps its revision, dates and anchor');
const sparseModel = bindAtlasModel(sparseScene, loaded);
assert.deepEqual([...sparseModel.selectable].sort(), [...model.selectable].sort(), 'other rooms stay selectable');
assert.ok(sparseModel.roomsById.has('generated:room-unpositioned'));
const sparseElectrical = sparseModel.overlays.get('electrical'), sparseNetwork = sparseModel.overlays.get('network');
const emptyPlacement = sparseElectrical.placed.get('syn-occ-hall');
assert.deepEqual(emptyPlacement.recordIds, []); assert.deepEqual(emptyPlacement.bindings, [hallElectrical]);
assert.deepEqual([sparseElectrical.records, sparseElectrical.unplacedRecords], [1, 0]);
const emptyHTML = renderToStaticMarkup(createElement(PublishedOverlayDetails, { placement: emptyPlacement }));
assert.ok(emptyHTML.includes(hallElectrical.sourceRevision) && emptyHTML.includes(hallElectrical.retrievedAt) && !emptyHTML.includes('Record references'));
assert.deepEqual(sparseNetwork.unplaced.map(row => row.reason), ['no-placement', 'not-linked', 'not-linked']);
assert.deepEqual([sparseNetwork.records, sparseNetwork.unplacedRecords], [3, 2]);
assert.deepEqual([...scene.unplacedByReason(sparseNetwork)], [['no-placement', 2], ['not-linked', 1]]);

// Admission at the host's separate capacities, beyond the former frontend-only
// aggregates: 8,193 selectors over two bindings (admission only; the drawn
// primitive budget is the standard loader's), and nine overlay bindings of
// 1,024 record IDs each, joined on one room.
const { STANDARD_GLB_LIMITS } = await import(preflightURL);
assert.equal(scene.ATLAS_LIMITS.drawnPrimitives, STANDARD_GLB_LIMITS.primitives);
const selectorsWide = structuredClone(composed.envelope);
selectorsWide.meshBindings.push(...[[2000, scene.ATLAS_LIMITS.primitivesPerBinding], [2001, 1]].map(([nodeIndex, count]) => ({ artifactId: 'model',
  nodeIndex, meshIndex: 0, primitiveIndices: Array.from({ length: count }, (_, at) => at), buildingId: 'syn-building-house', levelIds: [],
  spaceOccurrenceId: null, role: 'context' })));
const admittedSelectors = scene.admitAtlasScene(selectorsWide, { scope, publicationId: selection.publicationId },
  new TextEncoder().encode(JSON.stringify(selectorsWide)).byteLength);
assert.equal(admittedSelectors.meshBindings.reduce((sum, row) => sum + row.primitiveIndices.length, 0), read.scene.meshBindings.reduce((sum, row) => sum + row.primitiveIndices.length, 0) + 8193);
const recordsWide = structuredClone(composed.envelope);
const hallSource = recordsWide.overlayBindings.find(row => row.kind === 'electrical' && row.roomId === 'syn-room-hall');
recordsWide.overlayBindings.push(...Array.from({ length: 9 }, (_, binding) => ({ ...hallSource,
  recordIds: Array.from({ length: scene.ATLAS_LIMITS.recordsPerBinding }, (_, at) => `generated:record:${binding}:${at}`) })));
const recordsScene = scene.admitAtlasScene(recordsWide, { scope, publicationId: selection.publicationId },
  new TextEncoder().encode(JSON.stringify(recordsWide)).byteLength);
const recordsLayer = bindAtlasModel(recordsScene, loaded).overlays.get('electrical');
assert.equal(recordsLayer.placed.get('syn-occ-hall').recordIds.length, 3 + 9 * 1024);
assert.equal(recordsLayer.records, 4 + 9 * 1024);

// Successful binding with shared records, rather than a large allocation stress
// matrix. Extra occurrences have no pick geometry and are explicitly unselectable.
const sharedEnvelope = structuredClone(composed.envelope);
const sharedRoom = sharedEnvelope.rooms.find(row => row.roomId === 'syn-room-hall');
const sharedLevel = sharedEnvelope.levels.find(row => row.levelId === 'syn-level-ground');
const hallOccurrence = sharedEnvelope.occurrences.find(row => row.spaceOccurrenceId === 'syn-occ-hall');
const extraOccurrences = Array.from({ length: 32 }, (_, at) => `generated:shared-occ:${at}`);
sharedRoom.occurrenceIds.push(...extraOccurrences); sharedLevel.occurrenceIds.push(...extraOccurrences);
sharedEnvelope.occurrences.push(...extraOccurrences.map(spaceOccurrenceId => ({ ...hallOccurrence, spaceOccurrenceId, planFeatureIds: [] })));
sharedEnvelope.coverage.unselectableOccurrences.push(...extraOccurrences);
const commonBindings = Array.from({ length: 9 }, (_, at) => ({ ...hallSource, spaceOccurrenceId: null, anchor: { kind: 'room-summary' },
  sourceRevision: `Generated common ${at}`, recordIds: Array.from({ length: 1024 }, (_, id) => `generated:shared:${at}:${id}`) }));
const localBefore = { ...hallSource, spaceOccurrenceId: 'syn-occ-hall',
  anchor: { kind: 'source-position', position: [103, 0.3, 52], basis: 'Generated occurrence-only position' },
  sourceRevision: 'Generated local before', recordIds: ['generated:local-before', 'generated:shared:0:0'] };
const localAfter = { ...localBefore, sourceRevision: 'Generated local after', recordIds: ['generated:local-after', 'generated:shared:0:0'] };
const emptyCommon = { ...commonBindings[0], sourceRevision: 'Generated empty provenance', recordIds: [] };
const stairsNative = sharedEnvelope.rooms.find(row => row.roomId === 'syn-room-stairs').nativePlaceId;
const stairsBindings = [...commonBindings, emptyCommon].map(binding => ({ ...binding, roomId: 'syn-room-stairs', nativePlaceId: stairsNative }));
sharedEnvelope.overlayBindings = [localBefore, ...commonBindings, emptyCommon, localAfter, ...stairsBindings];
const sharedScene = scene.admitAtlasScene(sharedEnvelope, { scope, publicationId: selection.publicationId },
  new TextEncoder().encode(JSON.stringify(sharedEnvelope)).byteLength);
const sharedModel = bindAtlasModel(sharedScene, loaded);
const sharedLayer = sharedModel.overlays.get('electrical');
const firstCommon = sharedLayer.placed.get('syn-occ-stairs-ground'), mixed = sharedLayer.placed.get('syn-occ-hall');
for (const id of extraOccurrences) assert.equal(sharedLayer.placed.has(id), false, 'Excluded occurrences never acquire an inspectable placement');
for (const id of ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']) {
  const row = sharedLayer.placed.get(id);
  assert.equal(row.recordCount, 9 * 1024);
  assert.strictEqual(row.recordIds, firstCommon.recordIds, 'common records are one shared array');
  assert.strictEqual(row.bindings, firstCommon.bindings, 'empty and nonempty provenance are shared too');
  assert.deepEqual(row.positions, [], 'summary bindings do not invent occurrence positions');
  assert.equal(Object.getOwnPropertyDescriptor(row, 'recordCount').get, undefined, 'marker counts are stored scalars');
}
assert.equal(mixed.recordCount, 9 * 1024 + 2);
assert.equal(sharedLayer.records, 9 * 1024 + 2);
const hallBindings = sharedScene.overlayBindings.filter(binding => binding.roomId === 'syn-room-hall');
assert.deepEqual(mixed.bindings, hallBindings, 'selected detail bindings retain the original interleaved order');
const expectedRecords = [...new Set(hallBindings.flatMap(row => row.recordIds))];
assert.deepEqual(mixed.recordIds, expectedRecords, 'selected detail IDs retain first source appearance');
assert.equal(firstCommon.bindings.at(-1).sourceRevision, emptyCommon.sourceRevision);
// Actual tile summaries count source entities once per floor/layer, while all
// original per-occurrence counts and shared lazy record arrays stay intact.
for (const [levelId, expected] of [['syn-level-ground', 9218], ['syn-level-upper', 9216]]) {
  const html = renderToStaticMarkup(createElement(PlanTile, { model: sharedModel, level: sharedModel.levelsById.get(levelId),
    layers: [sharedLayer], tints: new Map(), selected: null, name: levelId, choose() {} }));
  assert.ok(html.includes(`${expected.toLocaleString()} electrical records`));
  assert.equal((html.match(/<circle /g) ?? []).length, levelId === 'syn-level-ground' ? 2 : 1);
}
{
  // Binding-only projection: a second selectable part of the same logical room
  // on one floor, using a repeated prepared primitive (no new GLB admission).
  const projected = structuredClone(read.scene), sourceId = 'syn-occ-stairs-ground', extraId = 'generated:second-stairs-part';
  const occurrence = projected.occurrences.find(row => row.spaceOccurrenceId === sourceId);
  const originalFeature = projected.plans.flatMap(plan => plan.features).find(feature => feature.spaceOccurrenceId === sourceId && feature.role === 'room');
  const feature = { ...originalFeature, featureId: 'generated:second-stairs-feature', spaceOccurrenceId: extraId };
  const plan = projected.plans.find(plan => plan.levelId === occurrence.levelId);
  plan.features.push(feature); plan.featureIds.push(feature.featureId);
  projected.occurrences.push({ ...occurrence, spaceOccurrenceId: extraId, planFeatureIds: [feature.featureId] });
  projected.rooms.find(room => room.roomId === occurrence.roomId).occurrenceIds.push(extraId);
  projected.levels.find(level => level.levelId === occurrence.levelId).occurrenceIds.push(extraId);
  projected.coverage.selectable.push(extraId); projected.coverage.selectableCount++;
  const part = model.pickParts.get(sourceId)[0], drawn = loaded.drawn.find(row => row.meshKey === part.mesh.meshKey);
  const meshKey = 'generated:second-stairs-mesh', nodeIndex = 2500;
  const binding = projected.meshBindings.find(binding => binding.spaceOccurrenceId === sourceId && binding.role === 'room-pick');
  projected.meshBindings.push({ ...binding, nodeIndex, primitiveIndices: [0] });
  projected.meshBindings.at(-1).spaceOccurrenceId = extraId;
  projected.rooms.push({ ...projected.rooms.find(room => room.roomId === 'syn-room-hall'), roomId: 'generated:unlocated-room', occurrenceIds: [] });
  const forRoom = (roomId, kind, recordIds, spaceOccurrenceId = null) => ({ ...hallSource, kind, roomId,
    nativePlaceId: projected.rooms.find(room => room.roomId === roomId).nativePlaceId, spaceOccurrenceId,
    anchor: { kind: 'room-summary' }, recordIds });
  projected.overlayBindings = [forRoom('syn-room-stairs', 'electrical', ['source-A/sheet/reused', 'source-A/symbol/reused']),
    forRoom('syn-room-hall', 'electrical', ['source-A/sheet/reused', 'source-B/sheet/reused']),
    forRoom('syn-room-stairs', 'network', ['source-A/sheet/reused']),
    forRoom('syn-room-hall', 'network', ['network/device/reused']),
    forRoom('generated:unlocated-room', 'electrical', ['unplaced-source/sheet/reused'])];
  const bound = bindAtlasModel(projected, { meshes: [...loaded.meshes, { ...part.mesh, meshKey }],
    drawn: [...loaded.drawn, { ...drawn, meshKey, nodeIndex, primitiveIndex: 0 }] });
  const layers = [...bound.overlays.values()];
  const ground = renderToStaticMarkup(createElement(PlanTile, { model: bound, level: bound.levelsById.get('syn-level-ground'),
    layers, tints: new Map(), selected: null, name: 'Generated shared floor', choose() {} }));
  assert.ok(ground.includes('3 electrical records, 2 network records'));
  assert.equal((ground.match(/<circle /g) ?? []).length, 6, 'per-room/layer markers remain per occurrence');
  const upper = renderToStaticMarkup(createElement(PlanTile, { model: bound, level: bound.levelsById.get('syn-level-upper'),
    layers, tints: new Map(), selected: null, name: 'Generated upper floor', choose() {} }));
  assert.ok(upper.includes('2 electrical records, 1 network record'));
  assert.equal(bound.overlays.get('electrical').records, 4);
  assert.equal(bound.overlays.get('electrical').unplacedRecords, 1, 'unplaced source entities stay out of every tile');
  assert.strictEqual(bound.overlays.get('electrical').placed.get(sourceId).recordIds, bound.overlays.get('electrical').placed.get(extraId).recordIds);
}

assert.equal(mixed.positions.length, 2);
assert.ok(renderToStaticMarkup(createElement(PublishedOverlayDetails, { placement: mixed })).includes(emptyCommon.sourceRevision));

// Known geometric parts can be explicitly excluded from selection. Their
// original bindings remain unplaced, while a mixed room's common record is
// still available through its selectable part.
for (const excluded of [['syn-occ-stairs-upper'], ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']]) {
  const envelope = structuredClone(composed.envelope), common = envelope.overlayBindings.find(binding => binding.kind === 'network');
  envelope.coverage.selectableOccurrences = envelope.coverage.selectableOccurrences.filter(id => !excluded.includes(id));
  envelope.coverage.unselectableOccurrences.push(...excluded);
  const explicit = { ...common, spaceOccurrenceId: 'syn-occ-stairs-upper', sourceRevision: 'Generated excluded source',
    sourceUpdatedAt: null, recordIds: [common.recordIds[0], 'generated:excluded-record'],
    anchor: { kind: 'source-position', position: [105.5, 3.3, 57], basis: 'Generated original excluded-part anchor' } };
  const emptyExcluded = { ...explicit, sourceRevision: 'Generated excluded empty provenance', recordIds: [] };
  envelope.overlayBindings = [common, explicit, emptyExcluded];
  const admitted = scene.admitAtlasScene(envelope, { scope, publicationId: selection.publicationId }, new TextEncoder().encode(JSON.stringify(envelope)).byteLength);
  const layer = bindAtlasModel(admitted, loaded).overlays.get('network');
  assert.equal(layer.records, 2); assert.equal(layer.unplacedRecords, 2);
  assert.deepEqual([...layer.placed.keys()], excluded.length === 1 ? ['syn-occ-stairs-ground'] : []);
  assert.ok(layer.unplaced.every(row => row.reason === 'not-selectable'));
  assert.deepEqual([...scene.unplacedByReason(layer)], [['not-selectable', 2]]);
  const unplacedExplicit = layer.unplaced.find(row => row.binding.sourceRevision === explicit.sourceRevision).binding;
  assert.deepEqual(unplacedExplicit.anchor, explicit.anchor);
  assert.equal(unplacedExplicit.spaceOccurrenceId, explicit.spaceOccurrenceId);
  const markup = renderToStaticMarkup(createElement(PublishedUnplacedSource, { binding: unplacedExplicit }));
  for (const value of [explicit.spaceOccurrenceId, explicit.anchor.basis, 'generated:excluded-record', 'update date unknown']) assert.ok(markup.includes(value));
  assert.ok(layer.unplaced.some(row => row.binding.sourceRevision === emptyExcluded.sourceRevision && row.binding.recordIds.length === 0));
}

// Owner-confirmed contract: distinct plans may share a level. Split the
// generated source features into two authored plans without changing geometry.
const multiple = JSON.parse(new TextDecoder().decode(companionBytes));
const authored = multiple.plans[0], midpoint = Math.ceil(authored.features.length / 2);
const firstPlan = { ...authored, features: authored.features.slice(0, midpoint) };
firstPlan.featureIds = firstPlan.features.map(row => row.featureId);
const secondPlan = { ...authored, planId: `${authored.planId}:second`, features: authored.features.slice(midpoint) };
secondPlan.featureIds = secondPlan.features.map(row => row.featureId);
multiple.plans.splice(0, 1, firstPlan, secondPlan);
const multipleEnvelope = await composeAtlasEnvelope(new TextEncoder().encode(JSON.stringify(multiple)), glb, SYNTHETIC_ATLAS.revision);
const multipleRead = await readUnifiedAtlas({ selection: { ...selection, manifestSha256: multipleEnvelope.manifestSha256 },
  signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: multipleEnvelope.envelopeBytes,
    href: multipleEnvelope.href, glb, sha256: multipleEnvelope.sha256, manifestSha256: multipleEnvelope.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
const multipleModel = bindAtlasModel(multipleRead.scene, await loadStandardGlb(multipleRead.model, 'multiple-plans', new AbortController().signal));
assert.deepEqual(multipleModel.plansByLevel.get(authored.levelId).map(row => row.planId), [firstPlan.planId, secondPlan.planId]);
assert.ok(Object.isFrozen(multipleModel.plansByLevel.get(authored.levelId)));
assert.deepEqual(scene.planFeaturesForLevel(multipleModel, authored.levelId).map(row => row.featureId), authored.features.map(row => row.featureId));
const multipleState = { ...initialAtlasState(multipleModel), buildingId: authored.buildingId, levelId: authored.levelId, view: 'plan' };
const multiplePresentation = presentAtlas(multipleModel, multipleState, new Set());
assert.deepEqual(frameBox(multipleModel, multipleState, multiplePresentation), frameBox(model, multipleState, presentAtlas(model, multipleState, new Set())));
for (const key of multipleModel.levelsById.get(authored.levelId).occurrenceIds.filter(key => multipleModel.selectable.has(key))) {
  const point = multipleModel.labels.get(key);
  assert.equal(planPickOccurrence(multipleModel, multiplePresentation, authored.levelId, point.x, point.z), key);
}

// Actual React presentation: an additive empty floor retains navigation but
// produces no thumbnail or non-finite coordinates. Every original feature,
// occurrence, primitive binding and coverage record remains in the publication.
for (const emptyFloor of [
  { levelId: 'syn-level-empty', min: [102, 4, 51], max: [107, 5, 59] },
  { levelId: 'syn-level-empty-below', min: [102, -.1, 51], max: [107, -.05, 59] },
]) {
  const extra = JSON.parse(new TextDecoder().decode(companionBytes)), emptyLevel = emptyFloor.levelId;
  extra.buildings.find(building => building.buildingId === 'syn-building-house').levelIds.push(emptyLevel);
  extra.levels.push({ levelId: emptyLevel, buildingId: 'syn-building-house', label: 'Generated empty floor', nativePlaceId: null,
    sourceElevationM: null, elevationBasis: null, occurrenceIds: [], bounds: { min: emptyFloor.min, max: emptyFloor.max } });
  extra.plans.push({ planId: `syn-plan-${emptyLevel}`, buildingId: 'syn-building-house', levelId: emptyLevel,
    coordinates: 'scene-XZ-metres', featureIds: [], features: [] });
  const emptyEnvelope = await composeAtlasEnvelope(new TextEncoder().encode(JSON.stringify(extra)), glb, SYNTHETIC_ATLAS.revision);
  const emptyRead = await readUnifiedAtlas({ selection: { ...selection, manifestSha256: emptyEnvelope.manifestSha256 },
    signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
    transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: emptyEnvelope.envelopeBytes,
      href: emptyEnvelope.href, glb, sha256: emptyEnvelope.sha256, manifestSha256: emptyEnvelope.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
  const emptyModel = bindAtlasModel(emptyRead.scene, await loadStandardGlb(emptyRead.model, 'empty-plan', new AbortController().signal));
  assert.deepEqual(Buffer.from(emptyRead.model), Buffer.from(read.model));
  assert.notEqual(emptyRead.scene.publication.semanticsSha256, read.scene.publication.semanticsSha256);
  assert.deepEqual(emptyModel.scene.occurrences, model.scene.occurrences);
  assert.deepEqual(emptyModel.scene.meshBindings, model.scene.meshBindings);
  assert.deepEqual(emptyModel.scene.coverage, model.scene.coverage);
  assert.deepEqual(emptyModel.scene.plans.slice(0, model.scene.plans.length), model.scene.plans);
  assert.equal(emptyModel.plansByLevel.has(emptyLevel), true);
  assert.deepEqual(scene.planFeaturesForLevel(emptyModel, emptyLevel), []);
  if (emptyFloor.min[1] < 0) assert.equal(emptyModel.levelsByBuilding.get('syn-building-house')[0].levelId, emptyLevel, 'source heights, rather than appended array order, choose the lowest floor');
  assert.deepEqual(scene.sitePlanLevels(emptyModel), ['syn-level-ground', 'syn-level-studio']);
  assert.deepEqual(scene.sitePlanLevels(emptyModel), scene.sitePlanLevels(model));
  const property = { ...initialAtlasState(emptyModel), buildingId: null, view: 'plan' };
  const propertyPlan = presentAtlas(emptyModel, property, new Set());
  assert.deepEqual(propertyPlan.planLevels, scene.sitePlanLevels(model));
  assert.ok(propertyPlan.planLevels.every(levelId => scene.planFeaturesForLevel(emptyModel, levelId).length > 0));
  const emptyState = atlasReducer(emptyModel, initialAtlasState(emptyModel), { type: 'level', levelId: emptyLevel });
  assert.equal(emptyState.levelId, emptyLevel, 'the floor remains available through semantic navigation');
  const props = { model: emptyModel, layers: [...emptyModel.overlays.values()], tints: new Map(), selected: null, choose() {} };
  assert.equal(renderToStaticMarkup(createElement(PlanTile, { ...props, level: emptyModel.levelsById.get(emptyLevel), name: 'Generated empty floor' })), '');
  const available = planTileLevels(emptyModel, emptyModel.levelsByBuilding.get('syn-building-house'), new Set(['syn-level-ground']));
  assert.deepEqual(available.map(level => level.levelId), ['syn-level-split', 'syn-level-upper']);
  const full = renderToStaticMarkup(createElement(PlanTile, { ...props, level: emptyModel.levelsById.get('syn-level-ground'), name: 'Generated ground floor' }));
  assert.match(full, /class="ua-tile"/); assert.match(full, /<path /);
  assert.ok(full.includes('Generated ground floor')); assert.ok(full.includes('4 electrical records')); assert.ok(full.includes('1 network record'));
  assert.doesNotMatch(full, /NaN|Infinity/);
}

// Actual thumbnails use the same logical-room sibling context as the stage,
// before ordinary overlay tint, in both directions across the two room parts.
for (const [selected, sibling, levelId, unrelated] of [
  ['syn-occ-stairs-ground', 'syn-occ-stairs-upper', 'syn-level-upper', 'syn-occ-bath'],
  ['syn-occ-stairs-upper', 'syn-occ-stairs-ground', 'syn-level-ground', 'syn-occ-living'],
]) {
  const props = { model, level: model.levelsById.get(levelId), layers: [], tints: new Map([[sibling, '#123456'], [unrelated, '#654321']]),
    selected, name: 'Generated sibling floor', choose() {} };
  const html = renderToStaticMarkup(createElement(PlanTile, props));
  const contextPaths = [...html.matchAll(/<path\b[^>]*class="cifc-plan-space is-context"[^>]*>/g)];
  assert.equal(contextPaths.length, 1);
  assert.ok(!contextPaths[0][0].includes('style='), 'sibling context takes precedence over its ordinary layer tint');
  assert.ok(html.includes('class="cifc-plan-space is-other" style="fill:#654321"'));
  assert.ok(!html.includes('is-selected'));
  const ordinary = renderToStaticMarkup(createElement(PlanTile, { ...props, selected: null }));
  assert.ok(!ordinary.includes('is-context')); assert.ok(!ordinary.includes('is-selected'));
  assert.ok(ordinary.includes('fill:#123456')); assert.ok(ordinary.includes('fill:#654321'));
}

// Nullable area is an ordinary presentation value, independent of the source
// geometry basis. No degenerate geometry or forced room selection is supplied.
{
  const source = { kind: 'source-model', sourceRef: 'generated-source-outline', note: null };
  const estimated = { kind: 'owner-estimated-pick-proxy', sourceRef: null, note: 'Generated preliminary outline' };
  const value = (geometryBasis, area) => renderToStaticMarkup(createElement(AreaValue, { geometryBasis, area }));
  assert.equal(value(source, null), 'Area unavailable from model outline');
  assert.equal(value(estimated, null), 'Not measured: estimated outline');
  const area = { occurrenceId: 'syn-occ-hall', squareMetres: 12, text: '≈ 12 m²', partial: false };
  assert.equal(value(source, area), '≈ 12 m²');
  assert.equal(value(source, { ...area, partial: true }), '≈ 12 m², this part of the room');
}

// Actual graph SSR: self links stay in the drawing even when both source ends
// collapse to one device. A record with no incident link remains listed apart.
{
  const loop = { id: 'generated-loop-device', label: 'Loop device', kind: 'Generated device', mobility: 'fixed', confidence: 'recorded', notes: '', place: null };
  const isolated = { ...loop, id: 'generated-isolated-device', label: 'Isolated device' };
  const port = (id, ownerDeviceId) => ({ id, label: id === 'loose' ? 'Loop endpoint' : id, kind: 'interface', ownerDeviceId, notes: '' });
  const source = { label: 'Generated network', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded',
    acceptedAt: null, coverage: 'complete', notes: 'Fictional topology only' };
  const cases = [
    { name: 'direct', devices: [loop, isolated], endpoints: [], from: loop.id, to: loop.id, node: loop.label },
    { name: 'owned-collapse', devices: [loop, isolated], endpoints: [port('port-a', loop.id), port('port-b', loop.id)], from: 'port-a', to: 'port-b', node: loop.label },
    { name: 'ownerless', devices: [isolated], endpoints: [port('loose', null)], from: 'loose', to: 'loose', node: 'Loop endpoint' },
  ];
  for (const item of cases) for (const linkCount of [1, 2, 3, 5]) {
    const data = { viewKey: `generated-loop-${item.name}-${linkCount}`, source, devices: item.devices, endpoints: item.endpoints,
      links: Array.from({ length: linkCount }, (_, at) => ({ id: `generated-link-${item.name}-${at}`, fromEndpointId: at % 2 ? item.to : item.from, toEndpointId: at % 2 ? item.from : item.to, kind: 'connection', medium: 'Generated logical medium',
        confidence: 'recorded', sourceConfidence: null, temporalStatus: '', recordedAtPrecision: null, basis: 'Generated source record', recordedAt: null, notes: '', path: null })) };
    const before = JSON.stringify(data);
    const html = renderToStaticMarkup(createElement(NetworkGraph, { graph: { key: data.viewKey, qualification: 'Generated documentary topology', data } }));
    const svg = html.match(/<svg class="ung-svg"[\s\S]*?<\/svg>/)?.[0];
    assert.ok(svg, 'the actual graph drawing is mounted separately from legend/list samples');
    assert.match(svg, /<svg class="ung-svg"[^>]*role="img"/);
    assert.equal((svg.match(/<g class="ung-node"/g) ?? []).length, 1);
    const paths = [...svg.matchAll(/class="ung-edge is-recorded" d="([^"]+)"/g)].map(match => match[1]);
    const hits = [...svg.matchAll(/class="ung-edge-hit" d="([^"]+)"/g)].map(match => match[1]);
    assert.equal(paths.length, linkCount); assert.deepEqual(hits, paths);
    assert.equal(new Set(paths).size, linkCount, 'every parallel self-link retains a distinct pointer path');
    assert.match(svg, /class="ung-edge is-recorded" d="M[^"\n]*C[^"\n]*"/);
    assert.doesNotMatch(html, /NaN|Infinity/);
    const [l, t, width, height] = svg.match(/<svg class="ung-svg" viewBox="([^"]+)"/)[1].split(' ').map(Number);
    assert.ok(Number.isFinite(l + t + width + height) && width > 0 && height > 0);
    for (const path of paths) {
      const coordinates = path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi).map(Number);
      assert.equal(coordinates.length, 8, 'the actual self-link remains a cubic');
      for (let at = 0; at < coordinates.length; at += 2) {
        assert.ok(coordinates[at] >= l + 8 - 1e-8 && coordinates[at] <= l + width - 8 + 1e-8);
        assert.ok(coordinates[at + 1] >= t + 8 - 1e-8 && coordinates[at + 1] <= t + height - 8 + 1e-8, 'the full control envelope and hit stroke stay within the frame');
      }
    }
    const total = `${linkCount} ${linkCount === 1 ? 'connection' : 'connections'}`;
    assert.ok(html.includes(`${item.devices.length} ${item.devices.length === 1 ? 'device' : 'devices'}, ${item.endpoints.length} ${item.endpoints.length === 1 ? 'endpoint' : 'endpoints'}, ${total}`));
    assert.ok(html.includes(`Devices (${item.devices.length})`)); assert.ok(html.includes(`Connections (${linkCount})`));
    assert.ok(html.includes(`${item.node} ↔ ${item.node}`));
    const alone = html.match(/<div class="ung-alone"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    assert.match(alone, /Isolated device/); assert.doesNotMatch(alone, /Loop device|Loop endpoint/);
    assert.equal((html.match(/class="ung-chip"/g) ?? []).length, 1);
    assert.ok(html.includes(`${total}</span>`)); assert.ok(html.includes('no connection</span>'));
    assert.equal(JSON.stringify(data), before);
  }
}

// Actual graph drawing: mixed source directions cannot cancel parallel lanes.
{
  const device = id => ({ id, label: id, kind: 'Generated device', mobility: 'fixed', confidence: 'recorded', notes: '', place: null });
  const port = (id, ownerDeviceId) => ({ id, label: id, kind: 'interface', ownerDeviceId, notes: '' });
  const source = { label: 'Generated network', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'complete', notes: 'Generated source note' };
  const cases = [
    { name: 'devices', devices: [device('A'), device('B')], endpoints: [], ends: [['A', 'B'], ['B', 'A']], labels: [['A', 'B'], ['B', 'A']] },
    { name: 'owned-aliases', devices: [device('A'), device('B')], endpoints: [port('pa', 'A'), port('pb', 'B')], ends: [['pa', 'B'], ['pb', 'A'], ['A', 'pb']], labels: [['A', 'B'], ['B', 'A'], ['A', 'B']] },
    { name: 'ownerless', devices: [], endpoints: [port('A', null), port('B', null)], ends: [['A', 'B'], ['B', 'A']], labels: [['A', 'B'], ['B', 'A']] },
  ];
  const numbers = path => path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi).map(Number);
  // Normalize only traversal of the emitted path; do not duplicate lane math.
  const geometry = path => { const n = numbers(path); return n[0] < n.at(-2) || (n[0] === n.at(-2) && n[1] <= n.at(-1))
    ? n : n.length === 6 ? [n[4], n[5], n[2], n[3], n[0], n[1]] : [n[2], n[3], n[0], n[1]]; };
  for (const item of cases) for (const count of [2, 3, 5]) {
    const data = { viewKey: `generated-mixed-${item.name}-${count}`, source, devices: [...item.devices, device('Isolated')], endpoints: item.endpoints,
      links: Array.from({ length: count }, (_, at) => ({ id: `mixed-${at}`, fromEndpointId: item.ends[at % item.ends.length][0], toEndpointId: item.ends[at % item.ends.length][1],
        kind: 'connection', medium: '', confidence: 'recorded', sourceConfidence: null, temporalStatus: '', recordedAtPrecision: null, basis: 'Generated source', recordedAt: null, notes: `Source note ${at}`, path: null })) };
    const before = JSON.stringify(data);
    const draw = (value, reversed = false) => {
      const html = renderToStaticMarkup(createElement(NetworkGraph, { graph: { key: value.viewKey, qualification: 'Generated topology', data: value } }));
      const svg = html.match(/<svg class="ung-svg"[\s\S]*?<\/svg>/)[0];
      const paths = [...svg.matchAll(/class="ung-edge is-recorded" d="([^"]+)"/g)].map(match => match[1]);
      assert.equal(paths.length, count);
      assert.deepEqual([...svg.matchAll(/class="ung-edge-hit" d="([^"]+)"/g)].map(match => match[1]), paths);
      assert.equal((svg.match(/<g class="ung-node"/g) ?? []).length, 2);
      const [l, t, width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
      for (const path of paths) { const n = numbers(path); for (let at = 0; at < n.length; at += 2) {
        assert.ok(n[at] >= l + 8 - 1e-8 && n[at] <= l + width - 8 + 1e-8);
        assert.ok(n[at + 1] >= t + 8 - 1e-8 && n[at + 1] <= t + height - 8 + 1e-8);
      } }
      assert.ok(html.includes(source.notes), 'source notes remain visible; individual link notes remain intact in the unchanged source data');
      assert.ok(html.includes(`Connections (${count})`)); assert.ok(html.includes(`Devices (${value.devices.length})`));
      const list = html.match(/<details class="ung-list"><summary>Connections \([^<]*<\/summary>([\s\S]*?)<\/details>/)[1];
      const names = [...list.matchAll(/class="ung-item-name">([^<]*)<\/span>/g)].map(match => match[1]);
      assert.deepEqual(names, value.links.map((_, at) => { const pair = item.labels[at % item.labels.length]; return (reversed ? [...pair].reverse() : pair).join(' ↔ '); }), 'source endpoint order remains visible in the connection list');
      assert.ok(html.includes(`${value.endpoints.length} ${value.endpoints.length === 1 ? 'endpoint' : 'endpoints'}`));
      assert.match(html.match(/<div class="ung-alone"[^>]*>([\s\S]*?)<\/div>/)[1], /Isolated/);
      assert.doesNotMatch(html, /NaN|Infinity/);
      return paths.map(geometry);
    };
    const original = draw(data);
    for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
      assert.ok(original[a].some((value, at) => Math.abs(value - original[b][at]) > 1e-6), 'parallel curves differ geometrically even modulo traversal reversal');
    }
    const reversed = draw({ ...data, links: data.links.map(link => ({ ...link, fromEndpointId: link.toEndpointId, toEndpointId: link.fromEndpointId })) }, true);
    original.forEach((curve, at) => curve.forEach((value, coordinate) => assert.ok(Math.abs(value - reversed[at][coordinate]) < 1e-8)));
    assert.equal(JSON.stringify(data), before);
  }
}

// Bounded binding-only projection: append repeated prepared primitives and
// room features, retaining original ring/hole grouping and loaded part order.
// This is not a new GLB publication or backend geometry admission.
const manyScene = structuredClone(read.scene), galleryId = 'syn-occ-gallery', repeats = 128;
const galleryPlan = manyScene.plans.find(plan => plan.features.some(feature => feature.spaceOccurrenceId === galleryId));
const galleryFeature = galleryPlan.features.find(feature => feature.spaceOccurrenceId === galleryId && feature.role === 'room');
const originalGalleryFeatures = galleryPlan.features.filter(feature => feature.spaceOccurrenceId === galleryId && feature.role === 'room');
const galleryOccurrence = manyScene.occurrences.find(row => row.spaceOccurrenceId === galleryId);
const galleryBinding = manyScene.meshBindings.find(row => row.spaceOccurrenceId === galleryId && row.role === 'room-pick');
const galleryPart = model.pickParts.get(galleryId)[0], galleryDrawn = loaded.drawn.find(row => row.meshKey === galleryPart.mesh.meshKey);
const extraMeshes = [], extraDrawn = [];
for (let at = 0; at < repeats; at++) {
  const featureId = `generated:repeat-feature:${at}`, meshKey = `generated:repeat-part:${at}`, nodeIndex = 1000 + at;
  galleryPlan.features.push({ ...galleryFeature, featureId }); galleryPlan.featureIds.push(featureId); galleryOccurrence.planFeatureIds.push(featureId);
  manyScene.meshBindings.push({ ...galleryBinding, nodeIndex, primitiveIndices: [0] });
  extraMeshes.push({ ...galleryPart.mesh, meshKey }); extraDrawn.push({ ...galleryDrawn, meshKey, nodeIndex, primitiveIndex: 0 });
}
const many = bindAtlasModel(manyScene, { meshes: [...loaded.meshes, ...extraMeshes], drawn: [...loaded.drawn, ...extraDrawn] });
assert.equal(many.shapes.get(galleryId).length, originalGalleryFeatures.length + repeats);
assert.equal(many.roomPolygons.get(galleryId).length, originalGalleryFeatures.reduce((n, f) => n + f.polygons.length, 0) + repeats * galleryFeature.polygons.length);
assert.deepEqual(many.shapes.get(galleryId).at(-1), galleryFeature.polygons.flatMap(polygon => [polygon.outer, ...polygon.holes]));
assert.equal(many.roomPolygons.get(galleryId).at(-1), galleryFeature.polygons.at(-1));
assert.deepEqual(many.pickParts.get(galleryId).map(part => part.mesh.meshKey), [...model.pickParts.get(galleryId).map(part => part.mesh.meshKey), ...extraMeshes.map(mesh => mesh.meshKey)]);
assert.ok(Object.isFrozen(many.shapes.get(galleryId)) && Object.isFrozen(many.roomPolygons.get(galleryId)) && Object.isFrozen(many.pickParts.get(galleryId)));

// ---- Presentation, drawing and picking share one rule set ---------------------------------
const VIEWPORT = { width: 960, height: 640 };
const pose = (pitch, yaw = 0) => ({ yaw, pitch, zoom: 1, panX: 0, panY: 0 });
const none = new Set();
const centre = key => { const spec = SYNTHETIC_OCCURRENCES.find(row => row.id === key); if (spec?.probe) return spec.probe; const b = model.occurrencesById.get(key).bounds; return [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2]; };
/** Projects a known interior point at the drawn lift, then picks through the same projection. */
function pickAt(state, t, key, pitch) {
  const presentation = presentAtlas(model, state, none);
  const projection = makeProjection(pose(pitch), frameBox(model, state, presentation), VIEWPORT, 0);
  const [x, z] = centre(key);
  const y = model.floorY.get(model.occurrencesById.get(key).levelId) + 0.6 + levelLift(presentation, occurrenceLiftLevel(model, key), t);
  const [px, py] = projection.project(x, y, z);
  return pickOccurrence(model, presentation, t, projection, px, py);
}
const reduce = (state, ...actions) => actions.reduce((value, action) => atlasReducer(model, value, action), state);
const initial = initialAtlasState(model);
assert.deepEqual(initial, { buildingId: null, levelId: null, occurrenceId: null, view: '3d', exploded: false,
  layers: { electrical: false, network: false, measurements: false } });
const explicitExploded = reduce(initial, { type: 'explode', exploded: true });
assert.deepEqual(model.floorBuildings.map(row => row.buildingId), ['syn-building-house', 'syn-building-studio']);
assert.equal(model.defaultBuildingId, 'syn-building-house');
assert.equal(hasExplodableLevels(model, null), true);
assert.equal(hasExplodableLevels(model, 'syn-building-studio'), false);
for (const part of model.parts.filter(part => part.buildingId === 'syn-building-studio' && part.role !== 'room-pick')) {
  assert.equal(presentAtlas(model, initial, none).clips.get(part.mesh.meshKey), null, 'Exploding the house does not section the single-floor studio');
}
const studioWhole = reduce(initial, { type: 'building', buildingId: 'syn-building-studio' });
assert.equal(presentAtlas(model, studioWhole, none).explodeTarget, 0);
assert.equal(reduce(studioWhole, { type: 'select', occurrenceId: 'syn-occ-studio' }).levelId, 'syn-level-studio');
// A second independently generated publication has two one-floor buildings,
// complete room geometry/plans and roofs; both open whole and stacked.
const singleInput = await buildSingleFloorBuildingsAtlas(scope);
const singleEnvelope = await composeAtlasEnvelope(singleInput.companionBytes, singleInput.glb, SYNTHETIC_ATLAS.revision);
const singleRead = await readUnifiedAtlas({ selection: { ...selection, publicationId: singleEnvelope.publicationId, manifestSha256: singleEnvelope.manifestSha256 },
  signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
  transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: singleEnvelope.envelopeBytes,
    href: singleEnvelope.href, glb: singleInput.glb, sha256: singleEnvelope.sha256, manifestSha256: singleEnvelope.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
const singleModel = bindAtlasModel(singleRead.scene, await loadStandardGlb(singleRead.model, 'single', new AbortController().signal));
const singleState = initialAtlasState(singleModel), singlePresentation = presentAtlas(singleModel, singleState, none);
assert.equal(singleModel.selectable.size, 2);
assert.equal(singleState.exploded, false);
assert.equal(hasExplodableLevels(singleModel, null), false);
assert.ok(singleModel.floorBuildings.every(building => !hasExplodableLevels(singleModel, building.buildingId)));
for (const part of singleModel.parts.filter(part => part.role === 'roof')) {
  assert.equal(singlePresentation.hidden.has(part.mesh.meshKey), false);
  assert.equal(singlePresentation.clips.get(part.mesh.meshKey), null);
}
assert.deepEqual(reduce(initial, { type: 'view', view: 'plan' }), { ...initial, view: 'plan' });
// Feature references may use any order; the generated Split plan is intentionally reordered.
const rawSplit = JSON.parse(new TextDecoder().decode(companionBytes)).plans.find(row => row.levelId === 'syn-level-split');
assert.notDeepEqual(rawSplit.featureIds, rawSplit.features.map(row => row.featureId));
assert.deepEqual(new Set(rawSplit.featureIds), new Set(scene.planFeaturesForLevel(model, 'syn-level-split').map(row => row.featureId)));
// Focused exploded floors frame every displayed section, including Upper's lift.
for (const levelId of ['syn-level-ground', 'syn-level-split']) {
  const focused = reduce(explicitExploded, { type: 'level', levelId });
  const bounds = frameBox(model, focused, presentAtlas(model, focused, none));
  near(bounds.min, [102, -0.2, 51], 'focused exploded min');
  near(bounds.max, [112, 9.6, 59], 'focused exploded max');
}


// Room picks are never drawn unless highlighted, yet remain pickable.
const exploded = presentAtlas(model, explicitExploded, none);
const pickKeys = model.parts.filter(part => part.role === 'room-pick').map(part => part.mesh.meshKey);
assert.equal(pickKeys.length, 10);
assert.ok(pickKeys.every(key => exploded.hidden.has(key)));
assert.equal(exploded.pickable.size, 10);
assert.ok(!exploded.hidden.has(drawnAt(2, 0).mesh.meshKey) && exploded.hidden.has(drawnAt(3, 0).mesh.meshKey), 'structure drawn, roof hidden when exploded');
const highlighted = presentAtlas(model, explicitExploded, new Set(['syn-occ-hall']));
assert.ok(!highlighted.hidden.has(hallPick.mesh.meshKey) && highlighted.pickable.has('syn-occ-hall'));

// Exploded: display offsets from the actual level order; shared and level-free parts stay put.
near(['syn-level-ground', 'syn-level-split', 'syn-level-upper'].map(key => exploded.offsets.get(key)), [0, 2.8, 5.6], 'exploded offsets');
for (const t of [1, 0.5]) {
  const lifts = partLifts(model, exploded, t);
  for (const part of model.parts) {
    if (part.levelId === null) assert.ok(!lifts.has(part.mesh.meshKey), `no lift for shared/level-free ${part.mesh.meshKey}`);
    else assert.equal(lifts.get(part.mesh.meshKey) ?? 0, levelLift(exploded, part.levelId, t), 'draw lift equals pick lift');
  }
}
assert.equal(exploded.clips.get(drawnAt(2, 4).mesh.meshKey), 2.8 + 1.2, 'shared slab cut at its highest level section');
assert.equal(partLifts(model, exploded, 0).size, 0);
// Lifting is display-only: prepared vertices are unchanged.
near(hallPick.mesh.bounds.min, [102.1, 0.02, 51.1], 'hall pick after presentation');

const everyRoom = SYNTHETIC_OCCURRENCES.filter(row => row.selectable !== false && !row.hole).map(row => row.id);
for (const key of everyRoom) assert.equal(pickAt(explicitExploded, 1, key, 36), key, `exploded pick ${key}`);
// Mid-transition: lifted floors pick at the same half lift they are drawn with.
for (const key of ['syn-occ-bedroom-split', 'syn-occ-study', 'syn-occ-bedroom-upper', 'syn-occ-bath', 'syn-occ-stairs-upper'])
  assert.equal(pickAt(explicitExploded, 0.5, key, 36), key, `transition pick ${key}`);

// Labels: anchor height and lift come from the same presentation and pick back to their room.
// Non-overlapping anchor rays return their own room. Overlapping proxies use
// nearest geometry; visible label buttons instead select their explicit occurrence ID.
for (const key of ['syn-occ-hall', 'syn-occ-bedroom-split', 'syn-occ-bedroom-upper']) {
  const projection = makeProjection(pose(36), frameBox(model, explicitExploded, exploded), VIEWPORT, 0);
  const anchor = model.labels.get(key);
  assert.ok(pointInShape(anchor.x, anchor.z, model.shapes.get(key)));
  assert.equal(labelHeight(model, exploded, key, false), model.floorY.get(model.occurrencesById.get(key).levelId) + 1.2, 'label at the section cut');
  const [px, py] = projection.project(anchor.x, labelHeight(model, exploded, key, false) - 0.05 + levelLift(exploded, occurrenceLiftLevel(model, key), 1), anchor.z);
  assert.equal(pickOccurrence(model, exploded, 1, projection, px, py), key, `label pick ${key}`);
}

// Normal whole-building navigation selects authored surfaces before rooms.
const stacked = reduce(initial, { type: 'building', buildingId: 'syn-building-house' });
const stackedPresentation = presentAtlas(model, stacked, none);
assert.ok(!stackedPresentation.hidden.has(drawnAt(3, 0).mesh.meshKey), 'roof drawn when stacked');
assert.equal(stackedPresentation.pickable.size, 0, 'building scope does not jump straight to room details');
assert.equal(partLifts(model, stackedPresentation, stackedPresentation.explodeTarget).size, 0, 'settled normal navigation never separates floors');
const stackedProjection = makeProjection(pose(90, 0), frameBox(model, stacked, stackedPresentation), VIEWPORT, 0);
const roofPixel = stackedProjection.project(103.25, 5, 55);
assert.deepEqual(scene.pickTarget(model, stackedPresentation, stacked, 0, stackedProjection, ...roofPixel),
  { kind: 'building', buildingId: 'syn-building-house' }, 'this fixture roof has no authored floor, so it retains building scope');
// Generated room behind a pane: the CPU target follows the glass pass, and a
// highlighted pane that returns to the solid pass still occludes the room.
{
  const occurrenceId = 'syn-occ-hall', levelId = 'syn-level-ground';
  const paneInput = (meshKey, z, occurrenceId) => ({ meshKey, floorId: levelId, occurrenceId,
    positions: new Float32Array([0, .1, z, 1, .1, z, 0, 1.1, z, 1, 1.1, z]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) });
  const [pane, room] = prepareMeshes([paneInput('synthetic-pane', 1, 'syn-occ-living'), paneInput('synthetic-room', 0, occurrenceId)]);
  const part = (mesh, role) => ({ mesh, role, buildingId: 'syn-building-house', levelIds: [levelId], levelId, occurrenceId: mesh.occurrenceId });
  const roomPart = part(room, 'room-pick');
  const testModel = glass => ({ ...model, parts: [part(glass ? { ...pane, sourceNight: 'glazing' } : pane, 'structure'), roomPart],
    pickParts: new Map([[occurrenceId, [roomPart]]]) });
  const state = reduce(stacked, { type: 'level', levelId });
  const projection = makeProjection(pose(0, 0), { min: [0, 0, 0], max: [1, 1.2, 1] }, VIEWPORT, 0);
  const pixel = projection.project(.5, .6, 0);
  const glassModel = testModel(true), clear = presentAtlas(glassModel, state, none);
  assert.ok(clear.transparent.has(pane.meshKey));
  assert.deepEqual(scene.pickTarget(glassModel, clear, state, 0, projection, ...pixel), { kind: 'room', occurrenceId }, 'room visible through building glass is picked');
  const picked = presentAtlas(glassModel, state, new Set(['syn-occ-living']));
  assert.ok(!picked.transparent.has(pane.meshKey));
  assert.deepEqual(scene.pickTarget(glassModel, picked, state, 0, projection, ...pixel), { kind: 'level', levelId }, 'highlighted solid glass occludes the room');
  const solidModel = testModel(false);
  assert.deepEqual(scene.pickTarget(solidModel, presentAtlas(solidModel, state, none), state, 0, projection, ...pixel),
    { kind: 'level', levelId }, 'ordinary opaque structure still occludes the room');
}
// Stacked with one floor in focus: lower floors only, cut at the focus section.
for (const [levelId, keys] of [['syn-level-ground', ['syn-occ-hall', 'syn-occ-living', 'syn-occ-stairs-ground']],
  ['syn-level-upper', ['syn-occ-bedroom-upper', 'syn-occ-bath', 'syn-occ-stairs-upper']]]) {
  const state = reduce(stacked, { type: 'level', levelId });
  const presentation = presentAtlas(model, state, none);
  assert.ok(presentation.hidden.has(drawnAt(3, 0).mesh.meshKey), 'roof off for a focused floor');
  for (const key of keys) assert.equal(pickAt(state, 0, key, 60), key, `focused ${levelId} pick ${key}`);
}

// Plan: the same source X/Z and IDs, at the plan pose and through the inverse projection.
for (const levelId of ['syn-level-ground', 'syn-level-split', 'syn-level-upper', 'syn-level-studio']) {
  const state = reduce(initial, { type: 'level', levelId }, { type: 'view', view: 'plan' });
  assert.equal(state.levelId, levelId);
  const presentation = presentAtlas(model, state, none);
  assert.equal(presentation.explodeTarget, 0); assert.equal(presentation.focusLevelId, levelId);
  const projection = makeProjection(pose(90), frameBox(model, state, presentation), VIEWPORT, 1);
  const y = model.floorY.get(levelId) + levelLift(presentation, levelId, 0);
  for (const key of model.levelsById.get(levelId).occurrenceIds.filter(item => model.selectable.has(item))) {
    const [x, z] = centre(key), [px, py] = projection.project(x, y, z);
    near(planPoint(projection, y, px, py), [x, z], `plan inverse ${key}`);
    assert.equal(planPickOccurrence(model, presentation, levelId, x, z), key, `plan pick ${key}`);
    assert.ok(scene.planFeaturesForLevel(model, levelId).some(feature => feature.spaceOccurrenceId === key && feature.role === 'room'));
  }
}
// Mid-transition from exploded into plan: the floor keeps its display offset while the explode
// factor eases to 0, so the plan is drawn, inverted and picked at that same eased lift.
{
  const state = reduce(initial, { type: 'level', levelId: 'syn-level-upper' }, { type: 'view', view: 'plan' });
  const presentation = presentAtlas(model, state, none);
  assert.equal(presentation.offsets.get('syn-level-upper'), exploded.offsets.get('syn-level-upper'));
  const y = model.floorY.get('syn-level-upper') + levelLift(presentation, 'syn-level-upper', 0.5);
  near([y], [2.8 + 2.8], 'half-eased plan height');
  const projection = makeProjection(pose(80), frameBox(model, state, presentation), VIEWPORT, .5);
  const [x, z] = centre('syn-occ-bath'), [px, py] = projection.project(x, y, z);
  const [ix, iz] = planPoint(projection, y, px, py);
  near([ix, iz], [x, z], 'mid-transition plan inverse');
  assert.equal(planPickOccurrence(model, presentation, 'syn-level-upper', ix, iz), 'syn-occ-bath');
}

// Same-winding holes: smaller filled area wins outside its hole; the underlying
// studio remains selectable through the hole. Overlapping 3D proxies retain frontmost picking.
{
  const state = reduce(initial, { type: 'level', levelId: 'syn-level-studio' }, { type: 'view', view: 'plan' });
  const presentation = presentAtlas(model, state, none);
  assert.equal(occurrenceArea(model, 'syn-occ-gallery'), 18);
  assert.equal(occurrenceArea(model, 'syn-occ-studio'), 30);
  assert.equal(planPickOccurrence(model, presentation, 'syn-level-studio', 120.5, 52.5), 'syn-occ-gallery');
  assert.equal(planPickOccurrence(model, presentation, 'syn-level-studio', 123, 52.5), 'syn-occ-studio');
  const anchor = model.labels.get('syn-occ-gallery');
  assert.ok(pointInShape(anchor.x, anchor.z, model.shapes.get('syn-occ-gallery')));
  assert.equal(reduce(state, { type: 'select', occurrenceId: 'syn-occ-gallery' }).occurrenceId, 'syn-occ-gallery');
}

// ---- Section transitions: one eased plane per building --------------------------------------
// The stage eases `sectionGoals` and restores them with `sectionCuts`; these checks call the same
// helpers and `easePresentation` with fixed intermediate values instead of animation frames.
const { atlasOrigin, sectionCeilings, sectionTargets, sectionGoals, sectionCuts, easePresentation } = scene;
const ceilings = sectionCeilings(model);
near(ceilings, [5.71, 3.01], 'each building rests just above its own geometry');
const datum = atlasOrigin(model)[1];
const sweep = {
  whole: explicitExploded,
  stacked,
  ground: reduce(stacked, { type: 'level', levelId: 'syn-level-ground' }),
  upper: reduce(stacked, { type: 'level', levelId: 'syn-level-upper' }),
  explodedGround: reduce(stacked, { type: 'level', levelId: 'syn-level-ground' }, { type: 'explode', exploded: true }),
  planSplit: reduce(initial, { type: 'level', levelId: 'syn-level-split' }, { type: 'view', view: 'plan' }),
  studio: reduce(initial, { type: 'level', levelId: 'syn-level-studio' }),
};
// Focused stacked floors and plans cut at their section; whole, exploded and other buildings rest uncut.
const sweepTargets = { whole: [5.71, 3.01], stacked: [5.71, 3.01], ground: [1.2, 3.01], upper: [4, 3.01], explodedGround: [5.71, 3.01],
  planSplit: [2.6, 3.01], studio: [5.71, 1.2] };
for (const [name, value] of Object.entries(sweep)) {
  const presentation = presentAtlas(model, value, none), targets = sectionTargets(model, presentation, ceilings);
  near(targets, sweepTargets[name], `${name} section targets`);
  assert.equal(easePresentation(model, presentation, presentation.explodeTarget, targets, targets, ceilings), presentation,
    `${name}: settled sections are the target presentation`);
  // Reduced motion hands the goals straight back; the restored cuts are the exact targets.
  assert.deepEqual(sectionCuts(sectionGoals(targets, datum), targets, datum), targets, `${name}: reduced-motion cuts`);
}
/** A room is revealed while one of its pick parts starts at or below its current cut. */
const revealed = (presentation, key) => model.pickParts.get(key).some(part => {
  const clip = presentation.clips.get(part.mesh.meshKey) ?? null;
  return clip === null || part.mesh.yRange[0] <= clip;
});
// Stacked Ground -> Exploded, partway: the section has risen to 2 m while floors part. Upper rooms
// are still cut away, so their labels, overlay counts and taps must not appear yet.
{
  const target = presentAtlas(model, sweep.explodedGround, none), targets = sectionTargets(model, target, ceilings);
  const t = 0.3, shown = easePresentation(model, target, t, [2, targets[1]], targets, ceilings);
  assert.equal(target.pickable.size, 8);
  assert.deepEqual([...shown.pickable].sort(), ['syn-occ-bedroom-split', 'syn-occ-hall', 'syn-occ-living', 'syn-occ-stairs-ground', 'syn-occ-study']);
  for (const key of target.pickable) assert.equal(shown.pickable.has(key), revealed(shown, key), `mid-sweep control follows geometry: ${key}`);
  assert.deepEqual([...network.placed.keys()].filter(key => shown.pickable.has(key)), ['syn-occ-stairs-ground'],
    'the two-floor network count stands only on the revealed stairs part');
  // Straight down through both stairs parts: the target alone would pick the lifted upper part;
  // the current cut picks the revealed ground part.
  const projection = makeProjection(pose(90), frameBox(model, sweep.explodedGround, target), VIEWPORT, 0);
  const [x, z] = centre('syn-occ-stairs-upper');
  const [px, py] = projection.project(x, model.floorY.get('syn-level-upper') + 0.6 + levelLift(target, 'syn-level-upper', t), z);
  assert.equal(pickOccurrence(model, target, t, projection, px, py), 'syn-occ-stairs-upper');
  assert.equal(pickOccurrence(model, shown, t, projection, px, py), 'syn-occ-stairs-ground');
}
// Stacked whole -> Ground, partway down at 3 m: floors above the new focus are cut by the moving
// plane instead of vanishing, and the roof above it stays off.
{
  const target = presentAtlas(model, sweep.ground, none), targets = sectionTargets(model, target, ceilings);
  const shown = easePresentation(model, target, 0, [3, targets[1]], targets, ceilings);
  for (const [node, primitive] of [[2, 1], [2, 2]]) {
    const key = drawnAt(node, primitive).mesh.meshKey;
    assert.ok(target.hidden.has(key) && !shown.hidden.has(key), `walls ${primitive} drawn while the plane passes`);
    assert.equal(shown.clips.get(key), 3);
  }
  assert.ok(shown.hidden.has(drawnAt(3, 0).mesh.meshKey), 'roof above the plane stays off');
  assert.deepEqual([...shown.pickable].sort(), [...target.pickable].sort());
}
// Retargeting mid-sweep: on its way down to Ground at 2 m, the reader picks Upper. The plane turns
// back up from 2 m, and Upper's rooms gain controls only as the cut passes their floor.
{
  const target = presentAtlas(model, sweep.upper, none), targets = sectionTargets(model, target, ceilings);
  const goals = sectionGoals(targets, datum);
  let eased = sectionGoals([2, targets[1]], datum), settled = false;
  const cutsSeen = [], bathLive = [];
  for (let frame = 0; frame < 240 && !settled; frame++) {
    // An exponential approach that lands exactly on its goal, as the stage's easing does.
    eased = Object.fromEntries(Object.entries(goals).map(([key, goal]) => {
      const value = eased[key] + (goal - eased[key]) * 0.1;
      return [key, Math.abs(goal - value) < 0.002 ? goal : value];
    }));
    const cuts = sectionCuts(eased, targets, datum), shown = easePresentation(model, target, 0, cuts, targets, ceilings);
    for (const key of target.pickable) assert.equal(shown.pickable.has(key), revealed(shown, key), `retarget frame ${frame}: ${key}`);
    cutsSeen.push(cuts[0]); bathLive.push(shown.pickable.has('syn-occ-bath'));
    settled = shown === target;
  }
  assert.ok(settled, 'the retargeted sweep settles on the target presentation');
  assert.ok(cutsSeen[0] > 2 && cutsSeen[0] < 2.3, 'the plane continues from its intermediate height');
  assert.ok(cutsSeen.every((cut, at) => at === 0 || cut >= cutsSeen[at - 1]), 'and rises without a jump');
  assert.equal(cutsSeen.at(-1), targets[0]);
  const bathFloor = model.pickParts.get('syn-occ-bath')[0].mesh.yRange[0];
  assert.ok(bathLive.includes(false) && bathLive.at(-1));
  assert.deepEqual(bathLive, cutsSeen.map(cut => cut >= bathFloor), 'the bathroom becomes selectable as the cut reveals it');
}
// The same coherent publication 100 000 m higher in its valid source frame: targets move with it,
// eased goals do not, and mid-sweep reveal, picks and label heights match. World positions are
// float32 after the standard loader, spaced 1/128 m at this height.
{
  const RISE = 100_000, tolerance = 0.01;
  const input = await buildSyntheticAtlas(scope, RISE);
  const envelope = await composeAtlasEnvelope(input.companionBytes, input.glb, SYNTHETIC_ATLAS.revision);
  const raisedRead = await readUnifiedAtlas({ selection: { ...selection, publicationId: envelope.publicationId, manifestSha256: envelope.manifestSha256 },
    signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true,
    transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: envelope.envelopeBytes,
      href: envelope.href, glb: input.glb, sha256: envelope.sha256, manifestSha256: envelope.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
  const raised = bindAtlasModel(raisedRead.scene, await loadStandardGlb(raisedRead.model, 'raised', new AbortController().signal));
  const close = (a, b, label) => a.forEach((value, at) => assert.ok(Math.abs(value - b[at]) <= tolerance, `${label}: ${a} vs ${b}`));
  assert.equal(raised.parts.length, model.parts.length);
  assert.deepEqual([...raised.selectable].sort(), [...model.selectable].sort());
  for (const level of model.scene.levels) {
    const elevated = raised.levelsById.get(level.levelId).sourceElevationM;
    if (level.sourceElevationM === null) assert.equal(elevated, null);
    else close([elevated - RISE], [level.sourceElevationM], `raised recorded elevation ${level.levelId}`);
  }
  assert.deepEqual([...raised.overlays.get('network').placed.keys()], [...network.placed.keys()]);
  const raisedDatum = atlasOrigin(raised)[1], raisedCeilings = sectionCeilings(raised);
  close([raisedDatum - RISE], [datum], 'raised datum');
  close(raisedCeilings.map(value => value - RISE), ceilings, 'raised ceilings');
  for (const [name, value] of Object.entries(sweep)) {
    const base = presentAtlas(model, value, none), high = presentAtlas(raised, value, none);
    const baseTargets = sectionTargets(model, base, ceilings), highTargets = sectionTargets(raised, high, raisedCeilings);
    close(highTargets.map(target => target - RISE), baseTargets, `${name} raised targets`);
    // The stage eases goals relative to the datum: the same small values, so the same motion and
    // settle tolerance, at either height.
    const highGoals = Object.values(sectionGoals(highTargets, raisedDatum));
    close(highGoals, Object.values(sectionGoals(baseTargets, datum)), `${name} eased goals`);
    assert.ok(highGoals.every(goal => Math.abs(goal) < 10), `${name} goals stay within the model's own height`);
    assert.deepEqual(sectionCuts(sectionGoals(highTargets, raisedDatum), highTargets, raisedDatum), highTargets, `${name} raised settled cuts`);
    assert.equal(easePresentation(raised, high, high.explodeTarget, highTargets, highTargets, raisedCeilings), high, `${name} raised settled presentation`);
    // Halfway from rest to each target while floors half part or close.
    const baseShown = easePresentation(model, base, 0.5, baseTargets.map((target, at) => (target + ceilings[at]) / 2), baseTargets, ceilings);
    const highShown = easePresentation(raised, high, 0.5, highTargets.map((target, at) => (target + raisedCeilings[at]) / 2), highTargets, raisedCeilings);
    assert.deepEqual([...highShown.pickable].sort(), [...baseShown.pickable].sort(), `${name} raised reveal`);
    model.parts.forEach((part, at) => {
      const key = part.mesh.meshKey, highKey = raised.parts[at].mesh.meshKey;
      assert.equal(highShown.hidden.has(highKey), baseShown.hidden.has(key), `${name} raised drawing ${at}`);
      const baseClip = baseShown.clips.get(key) ?? null, highClip = highShown.clips.get(highKey) ?? null;
      assert.equal(highClip === null, baseClip === null, `${name} raised clip ${at}`);
      if (baseClip !== null) close([highClip - RISE], [baseClip], `${name} raised clip ${at}`);
    });
    for (const pitch of [60, 90]) {
      const baseProjection = makeProjection(pose(pitch, 20), frameBox(model, value, base), VIEWPORT, 0);
      const highProjection = makeProjection(pose(pitch, 20), frameBox(raised, value, high), VIEWPORT, 0);
      for (const key of baseShown.pickable) {
        const [x, z] = centre(key), level = model.occurrencesById.get(key).levelId;
        const probe = (subject, presentation, projection) => projection.project(x,
          subject.floorY.get(level) + 0.6 + levelLift(presentation, occurrenceLiftLevel(subject, key), 0.5), z);
        assert.equal(pickOccurrence(raised, highShown, 0.5, highProjection, ...probe(raised, high, highProjection)),
          pickOccurrence(model, baseShown, 0.5, baseProjection, ...probe(model, base, baseProjection)), `${name} raised pick ${key} at ${pitch}°`);
        if (name === 'whole' && key === 'syn-occ-living' && pitch === 90) {
          assert.equal(pickOccurrence(model, baseShown, 0.5, baseProjection, ...probe(model, base, baseProjection)), 'syn-occ-bath');
          assert.equal(pickOccurrence(raised, highShown, 0.5, highProjection, ...probe(raised, high, highProjection)), 'syn-occ-bath',
            'the room interior remains pickable on a shared triangle seam');
        }
        close([labelHeight(raised, highShown, key, false) - RISE], [labelHeight(model, baseShown, key, false)], `${name} raised label ${key}`);
      }
    }
  }
}

// ---- Selection continuity ----------------------------------------------------------------
let state = reduce(initial, { type: 'select', occurrenceId: 'syn-occ-hall' });
assert.deepEqual([state.occurrenceId, state.buildingId, state.levelId], ['syn-occ-hall', 'syn-building-house', 'syn-level-ground']);
state = reduce(state, { type: 'level', levelId: null });
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-living' });
assert.equal(state.levelId, 'syn-level-ground', 'a room retains its semantic floor regardless of presentation');
state = reduce(state, { type: 'view', view: 'plan' });
assert.deepEqual([state.view, state.occurrenceId, state.levelId], ['plan', 'syn-occ-living', 'syn-level-ground']);
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-study' });
assert.deepEqual([state.occurrenceId, state.levelId], ['syn-occ-study', 'syn-level-split'], 'the plan follows the room to its floor');
state = reduce(state, { type: 'layer', layer: 'electrical', on: true }, { type: 'view', view: '3d' }, { type: 'explode', exploded: false });
assert.deepEqual([state.occurrenceId, state.layers.electrical, state.view, state.exploded], ['syn-occ-study', true, '3d', false]);
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-stairs-ground' }, { type: 'select', occurrenceId: 'syn-occ-stairs-upper' });
assert.deepEqual([state.occurrenceId, state.levelId], ['syn-occ-stairs-upper', 'syn-level-upper']);
state = reduce(state, { type: 'building', buildingId: 'syn-building-studio' });
assert.deepEqual([state.occurrenceId, state.buildingId, state.levelId], [null, 'syn-building-studio', null], 'another building clears the room');
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-studio' }, { type: 'building', buildingId: null });
assert.deepEqual([state.occurrenceId, state.levelId, state.buildingId], [null, null, null], 'property scope clears the complete child path');

// Normal pointer sequences through the same production handlers used by the hook.
const { createStagePointers } = await import(pointersURL);
const { floorLabel } = await import(labelsURL);
assert.deepEqual(['ground', 'intermediate', 'upper', 'attic', 'Custom level'].map(floorLabel),
  ['Ground Floor', 'Tussenfloor', 'Upper Floor', 'Attic', 'Custom level']);
function gestureHarness(top = false) {
  const gesture = { drag: null, pointers: new Map(), pinch: null, pinched: false };
  const capture = new Set(), child = {};
  let zoom = 1, pan = { x: 0, y: 0 }, orbit = { yaw: 0, pitch: 36 }, moving = false;
  const taps = [];
  const viewport = { hasPointerCapture: id => capture.has(id), setPointerCapture: id => capture.add(id),
    releasePointerCapture: id => capture.delete(id), getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const handlers = createStagePointers({ gesture, top, onTap: (x, y) => taps.push([x, y]), dragging: value => { moving = value; },
    zoom: update => { zoom = update(zoom); }, pan: update => { pan = update(pan); }, orbit: update => { orbit = update(orbit); } });
  const event = (id, type, x, y, target = viewport) => ({ button: 0, pointerId: id, pointerType: type, clientX: x, clientY: y, target, currentTarget: viewport });
  return { gesture, handlers, event, child, viewport, capture, taps, value: () => ({ zoom, pan, orbit, moving }) };
}
{
  const h = gestureHarness(), e = h.event(1, 'mouse', 30, 40);
  h.handlers.onPointerDown(e); h.handlers.onPointerUp(e);
  assert.deepEqual(h.taps, [[20, 20]]); assert.equal(h.value().moving, false);
  h.handlers.onPointerDown(e); h.handlers.onPointerMove(h.event(1, 'mouse', 50, 40));
  assert.equal(h.value().moving, true); const yaw = h.value().orbit.yaw;
  h.handlers.onPointerUp(h.event(1, 'mouse', 50, 40));
  h.handlers.onLostPointerCapture(h.event(1, 'mouse', 50, 40));
  h.handlers.onPointerMove(h.event(1, 'mouse', 80, 40));
  assert.equal(h.value().orbit.yaw, yaw); assert.equal(h.value().moving, false); assert.equal(h.taps.length, 1);
  // A normal capture handoff retires the matching mouse drag, even without a touch entry.
  h.handlers.onPointerDown(e); h.handlers.onPointerMove(h.event(1, 'mouse', 50, 40));
  h.capture.delete(1); h.handlers.onLostPointerCapture(h.event(1, 'mouse', 50, 40));
  const handedYaw = h.value().orbit.yaw;
  h.handlers.onPointerMove(h.event(1, 'mouse', 90, 40));
  assert.equal(h.value().orbit.yaw, handedYaw); assert.equal(h.value().moving, false);
}
for (const firstLift of [1, 2]) {
  const h = gestureHarness();
  h.handlers.onPointerDown(h.event(1, 'touch', 30, 40, h.child));
  h.handlers.onPointerMove(h.event(1, 'touch', 50, 40, h.child));
  h.handlers.onLostPointerCapture(h.event(1, 'touch', 50, 40, h.child));
  assert.equal(h.gesture.pointers.size, 1); assert.equal(h.value().moving, true);
  h.handlers.onPointerDown(h.event(2, 'touch', 80, 40));
  assert.ok(h.capture.has(1) && h.capture.has(2), 'pinch transfers both touches to the stable viewport');
  const yaw = h.value().orbit.yaw;
  h.handlers.onPointerMove(h.event(2, 'touch', 110, 50));
  assert.ok(h.value().zoom > 1); assert.notDeepEqual(h.value().pan, { x: 0, y: 0 });
  assert.equal(h.value().orbit.yaw, yaw);
  h.handlers.onPointerUp(h.event(firstLift, 'touch', firstLift === 1 ? 50 : 110, 40));
  const survivor = firstLift === 1 ? 2 : 1;
  h.handlers.onPointerMove(h.event(survivor, 'touch', 130, 60));
  h.handlers.onPointerUp(h.event(survivor, 'touch', 130, 60));
  assert.deepEqual(h.taps, []); assert.equal(h.value().moving, false); assert.equal(h.value().orbit.yaw, yaw);
  h.handlers.onPointerDown(h.event(3, 'touch', 30, 40)); h.handlers.onPointerUp(h.event(3, 'touch', 30, 40));
  assert.deepEqual(h.taps, [[20, 20]]);
}
{
  const h = gestureHarness(true);
  h.handlers.onPointerDown(h.event(1, 'touch', 30, 40)); h.handlers.onPointerMove(h.event(1, 'touch', 50, 60));
  assert.deepEqual(h.value().pan, { x: 20, y: 20 }); assert.equal(h.value().orbit.yaw, 0);
  h.handlers.onPointerUp(h.event(1, 'touch', 50, 60)); assert.deepEqual(h.taps, []);
}
for (const type of ['touch', 'mouse']) {
  // The house follows the hand: a drag moves the side facing the viewer with it.
  const h = gestureHarness(), bounds = { min: [-4, 0, -3], max: [4, 6, 3] };
  const screen = point => makeProjection(pose(h.value().orbit.pitch, h.value().orbit.yaw), bounds, VIEWPORT, 0).project(...point);
  const near = [0, 3, 3], far = [0, 3, -3], top = [0, 6, 0];
  assert.ok(screen(near)[2] > screen(far)[2], 'the near side is the one nearer the viewer');
  let before = screen(near);
  h.handlers.onPointerDown(h.event(1, type, 100, 100)); h.handlers.onPointerMove(h.event(1, type, 140, 100));
  h.handlers.onPointerUp(h.event(1, type, 140, 100));
  assert.ok(screen(near)[0] > before[0], `${type} drag right moves the near side right`);
  before = screen(top);
  h.handlers.onPointerDown(h.event(2, type, 100, 100)); h.handlers.onPointerMove(h.event(2, type, 100, 140));
  h.handlers.onPointerUp(h.event(2, type, 100, 140));
  assert.ok(screen(top)[1] > before[1], `${type} drag down moves the top down`);
  assert.deepEqual(h.taps, []);
}

console.log('PASS unified Atlas healthy: generated scene/model read through the production reader; standard loader nested, reused and '
  + 'multi-primitive transforms applied once; explicit selector binding; room picks hidden yet pickable; stacked, focused, exploded, '
  + 'mid-transition and plan picks at shared lifts; labels, duplicate names, a two-floor room, overlay joins and selection continuity. '
  + 'Section targets, settled and reduced-motion equivalence, mid-sweep reveal agreeing across drawing, picks and room controls, '
  + 'retargeting from an intermediate cut, and the same publication 100 000 m higher. '
  + 'Normal pointer tap, drag, capture handoff, drag-to-pinch, either-finger release and plan pan use production handlers. '
  + 'Scalar source-text bounds and the full position basis are retained; admission-only projection covers 4,096 occurrences and 16,381 features. '
  + 'Mixed-floor records, static React provenance output, bounded repeated binding indexes and multiple same-level plans retain their source scope/order. '
  + 'An empty record binding, a room with no occurrence, per-reason distinct unplaced counts, 8,193 selectors and nine 1,024-record bindings are admitted. '
  + 'Common records/provenance are shared across two selectable Stairs parts; 32 excluded occurrences acquire no placement. '
  + 'Explicit excluded-part and wholly excluded-room bindings retain unplaced totals, original anchors, dates and inspectable source references. '
  + 'Scalar counts and selected details retain source order. '
  + 'Actual static React graph, PlanTile and AreaValue checks retain distinct parallel self-links and mixed-direction lanes with enclosing frames, distinct floor record summaries, sibling room context, empty-floor navigation and usable property plans, and nullable area basis. '
  + 'Generated data only; no mounted browser, GPU or device acceptance.');
