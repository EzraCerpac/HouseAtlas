// Healthy generated checks for the unified Atlas production path only: the
// actual scene reader against an in-process synthetic HTTPS transport, the
// pinned three.js GLTFLoader through loadStandardGlb, selector binding, and the
// shared presentation used for drawing, picking, plans and labels. Generated
// data only; no server, browser, GPU, credentials, household input, native
// host or deployment. It adds no malformed, denial, replay, expiry, crash or
// private-intake case, and it takes no arguments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}
const frontend = new URL('../', import.meta.url);
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
const readerURL = await sourceURL('../integration/unified-atlas-reader.ts',
  { '../src/lantern/unified-atlas/scene': sceneURL, '../src/lantern/unified-atlas/types': typesURL });
const syntheticURL = await sourceURL('./unified-atlas/synthetic-atlas.ts');

const { makeProjection, pointInShape } = await import(geometryURL);
const { loadStandardGlb } = await import(standardURL);
const scene = await import(sceneURL);
const { readUnifiedAtlas } = await import(readerURL);
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
assert.deepEqual([...electrical.placed.keys()].sort(), ['syn-room-hall', 'syn-room-living']);
assert.deepEqual(electrical.placed.get('syn-room-hall').occurrenceIds, ['syn-occ-hall']);
assert.equal(electrical.placed.get('syn-room-hall').recordIds.length, 3);
assert.deepEqual(electrical.placed.get('syn-room-living').positions.map(row => row.occurrenceId), ['syn-occ-living']);
assert.deepEqual(electrical.unplaced, []);
assert.deepEqual(network.placed.get('syn-room-stairs').occurrenceIds, ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
assert.deepEqual(network.unplaced, []);
assert.deepEqual([electrical.records, electrical.unplacedRecords, network.records, network.unplacedRecords], [4, 0, 1, 0]);

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
assert.deepEqual(initial, { buildingId: null, levelId: null, occurrenceId: null, view: '3d', exploded: true, overlay: null });
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
assert.deepEqual(reduce(initial, { type: 'view', view: 'plan' }), { ...initial, view: 'plan', buildingId: 'syn-building-house', levelId: 'syn-level-ground' });
// Feature references may use any order; the generated Split plan is intentionally reordered.
const rawSplit = JSON.parse(new TextDecoder().decode(companionBytes)).plans.find(row => row.levelId === 'syn-level-split');
assert.notDeepEqual(rawSplit.featureIds, rawSplit.features.map(row => row.featureId));
assert.deepEqual(new Set(rawSplit.featureIds), new Set(model.planByLevel.get('syn-level-split').features.map(row => row.featureId)));
// Focused exploded floors frame every displayed section, including Upper's lift.
for (const levelId of ['syn-level-ground', 'syn-level-split']) {
  const focused = reduce(initial, { type: 'level', levelId });
  const bounds = frameBox(model, focused, presentAtlas(model, focused, none));
  near(bounds.min, [102, -0.2, 51], 'focused exploded min');
  near(bounds.max, [112, 9.6, 59], 'focused exploded max');
}


// Room picks are never drawn unless highlighted, yet remain pickable.
const exploded = presentAtlas(model, initial, none);
const pickKeys = model.parts.filter(part => part.role === 'room-pick').map(part => part.mesh.meshKey);
assert.equal(pickKeys.length, 10);
assert.ok(pickKeys.every(key => exploded.hidden.has(key)));
assert.equal(exploded.pickable.size, 10);
assert.ok(!exploded.hidden.has(drawnAt(2, 0).mesh.meshKey) && exploded.hidden.has(drawnAt(3, 0).mesh.meshKey), 'structure drawn, roof hidden when exploded');
const highlighted = presentAtlas(model, initial, new Set(['syn-occ-hall']));
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
for (const key of everyRoom) assert.equal(pickAt(initial, 1, key, 36), key, `exploded pick ${key}`);
// Mid-transition: lifted floors pick at the same half lift they are drawn with.
for (const key of ['syn-occ-bedroom-split', 'syn-occ-study', 'syn-occ-bedroom-upper', 'syn-occ-bath', 'syn-occ-stairs-upper'])
  assert.equal(pickAt(initial, 0.5, key, 36), key, `transition pick ${key}`);

// Labels: anchor height and lift come from the same presentation and pick back to their room.
// Non-overlapping anchor rays return their own room. Overlapping proxies use
// nearest geometry; visible label buttons instead select their explicit occurrence ID.
for (const key of ['syn-occ-hall', 'syn-occ-bedroom-split', 'syn-occ-bedroom-upper']) {
  const projection = makeProjection(pose(36), frameBox(model, initial, exploded), VIEWPORT, 0);
  const anchor = model.labels.get(key);
  assert.ok(pointInShape(anchor.x, anchor.z, model.shapes.get(key)));
  assert.equal(labelHeight(model, exploded, key, false), model.floorY.get(model.occurrencesById.get(key).levelId) + 1.2, 'label at the section cut');
  const [px, py] = projection.project(anchor.x, labelHeight(model, exploded, key, false) - 0.05 + levelLift(exploded, occurrenceLiftLevel(model, key), 1), anchor.z);
  assert.equal(pickOccurrence(model, exploded, 1, projection, px, py), key, `label pick ${key}`);
}

// Stacked whole building: the topmost room at each point wins; structure and roof never claim a room.
const stacked = reduce(initial, { type: 'building', buildingId: 'syn-building-house' }, { type: 'explode', exploded: false });
assert.ok(!presentAtlas(model, stacked, none).hidden.has(drawnAt(3, 0).mesh.meshKey), 'roof drawn when stacked');
for (const key of ['syn-occ-bedroom-upper', 'syn-occ-bath', 'syn-occ-stairs-upper', 'syn-occ-bedroom-split', 'syn-occ-study'])
  assert.equal(pickAt(stacked, 0, key, 60), key, `stacked pick ${key}`);
assert.equal(pickAt(stacked, 0, 'syn-occ-hall', 60), 'syn-occ-bedroom-upper', 'the upper room is above the hall');
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
    assert.ok(model.planByLevel.get(levelId).features.some(feature => feature.spaceOccurrenceId === key && feature.role === 'room'));
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
  whole: initial,
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
  assert.deepEqual(network.placed.get('syn-room-stairs').occurrenceIds.filter(key => shown.pickable.has(key)), ['syn-occ-stairs-ground'],
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
  assert.deepEqual(raised.overlays.get('network').placed.get('syn-room-stairs').occurrenceIds, network.placed.get('syn-room-stairs').occurrenceIds);
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
        if (name === 'stacked' && key === 'syn-occ-living' && pitch === 90) {
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
assert.equal(state.levelId, null, 'an exploded whole building keeps every floor in view');
state = reduce(state, { type: 'view', view: 'plan' });
assert.deepEqual([state.view, state.occurrenceId, state.levelId], ['plan', 'syn-occ-living', 'syn-level-ground']);
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-study' });
assert.deepEqual([state.occurrenceId, state.levelId], ['syn-occ-study', 'syn-level-split'], 'the plan follows the room to its floor');
state = reduce(state, { type: 'overlay', overlay: 'electrical' }, { type: 'view', view: '3d' }, { type: 'explode', exploded: false });
assert.deepEqual([state.occurrenceId, state.overlay, state.view, state.exploded], ['syn-occ-study', 'electrical', '3d', false]);
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-stairs-ground' }, { type: 'select', occurrenceId: 'syn-occ-stairs-upper' });
assert.deepEqual([state.occurrenceId, state.levelId], ['syn-occ-stairs-upper', 'syn-level-upper']);
state = reduce(state, { type: 'building', buildingId: 'syn-building-studio' });
assert.deepEqual([state.occurrenceId, state.buildingId, state.levelId], [null, 'syn-building-studio', null], 'another building clears the room');
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-studio' }, { type: 'building', buildingId: null });
assert.equal(state.occurrenceId, 'syn-occ-studio', 'all buildings keep the room');

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

console.log('PASS unified Atlas healthy: generated scene/model read through the production reader; standard loader nested, reused and '
  + 'multi-primitive transforms applied once; explicit selector binding; room picks hidden yet pickable; stacked, focused, exploded, '
  + 'mid-transition and plan picks at shared lifts; labels, duplicate names, a two-floor room, overlay joins and selection continuity. '
  + 'Section targets, settled and reduced-motion equivalence, mid-sweep reveal agreeing across drawing, picks and room controls, '
  + 'retargeting from an intermediate cut, and the same publication 100 000 m higher. '
  + 'Normal pointer tap, drag, capture handoff, drag-to-pinch, either-finger release and plan pan use production handlers. '
  + 'Scalar source-text bounds and the full position basis are retained; admission-only projection covers 4,096 occurrences and 16,381 features. '
  + 'Generated data only; no renderer, browser or device acceptance.');
