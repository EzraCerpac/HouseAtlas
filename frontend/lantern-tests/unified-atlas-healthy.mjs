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
const { buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, atlasScenePath, SYNTHETIC_ATLAS, SYNTHETIC_OCCURRENCES,
  SYNTHETIC_ATLAS_DRAWN_PRIMITIVES } = await import(syntheticURL);
const { bindAtlasModel, presentAtlas, partLifts, levelLift, frameBox, pickOccurrence, planPoint, planPickOccurrence, labelHeight,
  occurrenceLiftLevel, contextOccurrenceIds, atlasReducer, initialAtlasState } = scene;

// ---- Read: production reader, generated transport ----------------------------------------
const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const { glb, companionBytes } = await buildSyntheticAtlas(scope);
const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
const calls = [];
const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: composed.envelopeBytes,
  href: composed.href, glb, sha256: composed.sha256, revision: SYNTHETIC_ATLAS.revision, onRequest: url => calls.push(url) });
const selection = { owner: {}, scope, expiresAt: new Date(Date.now() + 600_000).toISOString(), publicationId: SYNTHETIC_ATLAS.publicationId,
  manifestSha256: composed.sha256 };
const read = await readUnifiedAtlas({ selection, signal: new AbortController().signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport });
assert.deepEqual(calls, [`${SYNTHETIC_ATLAS.origin}${atlasScenePath(scope)}`, `${SYNTHETIC_ATLAS.origin}${composed.href}`], 'scene, then its pinned model');
assert.deepEqual(Buffer.from(read.model), Buffer.from(glb));
assert.equal(read.scene.selection.revision, SYNTHETIC_ATLAS.revision);
assert.equal(read.scene.publication.semanticsSha256, (await import('node:crypto')).createHash('sha256').update(companionBytes).digest('hex'));

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
assert.equal(model.selectable.size, 9); assert.ok(!model.selectable.has('syn-occ-void'));
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
assert.deepEqual(electrical.unplaced.map(row => [row.binding.roomId, row.reason]), [['syn-room-study', 'not-linked']]);
assert.deepEqual(network.placed.get('syn-room-stairs').occurrenceIds, ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
assert.deepEqual(network.unplaced.map(row => [row.binding.roomId, row.reason]),
  [['syn-room-bath', 'other-publication'], ['syn-room-bedroom-b', 'not-linked']]);
assert.deepEqual([electrical.records, electrical.unplacedRecords, network.records, network.unplacedRecords], [5, 1, 3, 2]);

// ---- Presentation, drawing and picking share one rule set ---------------------------------
const VIEWPORT = { width: 960, height: 640 };
const pose = (pitch, yaw = 0) => ({ yaw, pitch, zoom: 1, panX: 0, panY: 0 });
const none = new Set();
const centre = key => { const b = model.occurrencesById.get(key).bounds; return [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2]; };
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

// Room picks are never drawn unless highlighted, yet remain pickable.
const exploded = presentAtlas(model, initial, none);
const pickKeys = model.parts.filter(part => part.role === 'room-pick').map(part => part.mesh.meshKey);
assert.equal(pickKeys.length, 9);
assert.ok(pickKeys.every(key => exploded.hidden.has(key)));
assert.equal(exploded.pickable.size, 9);
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

const everyRoom = SYNTHETIC_OCCURRENCES.filter(row => row.selectable !== false).map(row => row.id);
for (const key of everyRoom) assert.equal(pickAt(initial, 1, key, 36), key, `exploded pick ${key}`);
// Mid-transition: lifted floors pick at the same half lift they are drawn with.
for (const key of ['syn-occ-bedroom-split', 'syn-occ-study', 'syn-occ-bedroom-upper', 'syn-occ-bath', 'syn-occ-stairs-upper'])
  assert.equal(pickAt(initial, 0.5, key, 36), key, `transition pick ${key}`);

// Labels: anchor height and lift come from the same presentation and pick back to their room.
for (const key of ['syn-occ-hall', 'syn-occ-bedroom-split', 'syn-occ-bedroom-upper', 'syn-occ-studio']) {
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
assert.equal(reduce(state, { type: 'select', occurrenceId: 'syn-occ-void' }), state, 'an unselectable part changes nothing');
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-stairs-ground' }, { type: 'select', occurrenceId: 'syn-occ-stairs-upper' });
assert.deepEqual([state.occurrenceId, state.levelId], ['syn-occ-stairs-upper', 'syn-level-upper']);
state = reduce(state, { type: 'building', buildingId: 'syn-building-studio' });
assert.deepEqual([state.occurrenceId, state.buildingId, state.levelId], [null, 'syn-building-studio', null], 'another building clears the room');
state = reduce(state, { type: 'select', occurrenceId: 'syn-occ-studio' }, { type: 'building', buildingId: null });
assert.equal(state.occurrenceId, 'syn-occ-studio', 'all buildings keep the room');

console.log('PASS unified Atlas healthy: generated scene/model read through the production reader; standard loader nested, reused and '
  + 'multi-primitive transforms applied once; explicit selector binding; room picks hidden yet pickable; stacked, focused, exploded, '
  + 'mid-transition and plan picks at shared lifts; labels, duplicate names, a two-floor room, overlay joins and selection continuity. '
  + 'Generated data only; no renderer, browser or device acceptance.');
