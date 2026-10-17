// Healthy synthetic interaction sequences. Node/CPU only: no DOM, browser, GPU,
// real transport, credentials, household inputs, lifecycle or held control cases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAPI, generatedModel } from './api.mjs';

assert.equal(process.version, 'v26.10.0', 'Use the pinned runtime');
const api = await loadAPI();
const { model, calls, composed } = await generatedModel(api);
const empty = new Set();
const initial = () => api.initialAtlasState(model);
const reduce = (state, ...actions) => actions.reduce((value, action) => api.atlasReducer(model, value, action), state);
const select = occurrenceId => ({ type: 'select', occurrenceId });
const view = view => ({ type: 'view', view });
const building = buildingId => ({ type: 'building', buildingId });
const level = levelId => ({ type: 'level', levelId });
const overlay = overlay => ({ type: 'overlay', overlay });
const H = 'syn-building-house', S = 'syn-building-studio';
const G = 'syn-level-ground', U = 'syn-level-upper';
const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-4, `${actual} != ${expected}`));

test('one scene read followed by exactly its pinned model; no extra reads during interactions', () => {
  assert.deepEqual(calls, [`${api.SYNTHETIC_ATLAS.origin}${api.atlasScenePath(model.scene.scope)}?expectedManifestSha256=${composed.manifestSha256}`,
    `${api.SYNTHETIC_ATLAS.origin}${composed.href}`]);
  let state = initial();
  for (let n = 0; n < 12; n++) state = reduce(state, building(H), select('syn-occ-hall'), view('plan'),
    overlay('electrical'), view('3d'), building(S), select('syn-occ-studio'), overlay('network'));
  assert.equal(state.occurrenceId, 'syn-occ-studio');
  assert.equal(calls.length, 2);
});

test('each of ten declared selectable occurrences is individually selectable across 3D → Plan → 3D', () => {
  assert.equal(model.selectable.size, 10);
  for (const id of model.selectable) {
    const occurrence = model.occurrencesById.get(id);
    let state = reduce(initial(), select(id), overlay('electrical'), view('plan'));
    assert.equal(state.occurrenceId, id);
    assert.equal(state.buildingId, occurrence.buildingId);
    assert.equal(state.levelId, occurrence.levelId);
    const presentation = api.presentAtlas(model, state, new Set([id]));
    assert.ok(presentation.pickable.has(id));
    state = reduce(state, view('3d'));
    assert.equal(state.occurrenceId, id);
    assert.equal(state.overlay, 'electrical');
  }
});

test('two Bedrooms preserve distinct IDs and floors; stairs preserve a logical room across occurrences', () => {
  const bedrooms = ['syn-occ-bedroom-split', 'syn-occ-bedroom-upper'];
  assert.equal(model.roomsById.get(model.occurrencesById.get(bedrooms[0]).roomId).label, 'Bedroom');
  assert.equal(model.roomsById.get(model.occurrencesById.get(bedrooms[1]).roomId).label, 'Bedroom');
  let state = initial();
  for (const id of bedrooms) {
    state = reduce(state, select(id), view('plan'), view('3d'));
    assert.equal(state.occurrenceId, id);
    assert.equal(state.levelId, model.occurrencesById.get(id).levelId);
  }
  state = reduce(state, select('syn-occ-stairs-ground'), view('plan'));
  assert.deepEqual(api.contextOccurrenceIds(model, state.occurrenceId), ['syn-occ-stairs-upper']);
  state = reduce(state, select('syn-occ-stairs-upper'));
  assert.equal(state.levelId, U);
  assert.equal(model.occurrencesById.get(state.occurrenceId).roomId, 'syn-room-stairs');
});

test('building transitions clear foreign selection, preserve overlay and choose that building’s plan', () => {
  let state = reduce(initial(), building(H), select('syn-occ-hall'), overlay('network'), view('plan'), building(S));
  assert.equal(state.occurrenceId, null);
  assert.equal(state.levelId, 'syn-level-studio');
  assert.equal(state.overlay, 'network');
  assert.deepEqual([...api.presentAtlas(model, state, empty).pickable].sort(), ['syn-occ-gallery', 'syn-occ-studio']);
  state = reduce(state, select('syn-occ-studio'), building(null));
  assert.equal(state.view, '3d');
  assert.equal(state.occurrenceId, 'syn-occ-studio');
  state = reduce(state, building(H), view('plan'));
  assert.equal(state.occurrenceId, null);
  assert.equal(state.levelId, G);
});

test('explosion lifts drawing and CPU picks together throughout transition without modifying geometry', () => {
  const before = model.meshes.map(mesh => mesh.vertices.slice());
  const state = reduce(initial(), building(H));
  const p = api.presentAtlas(model, state, empty);
  for (const t of [0, .25, .5, .75, 1]) {
    const lifts = api.partLifts(model, p, t);
    for (const part of model.parts) assert.equal(lifts.get(part.mesh.meshKey) ?? 0,
      api.levelLift(p, part.levelId, t));
    const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
      api.frameBox(model, state, p), { width: 960, height: 640 }, 0);
    for (const id of ['syn-occ-bedroom-split', 'syn-occ-bedroom-upper', 'syn-occ-bath']) {
      const o = model.occurrencesById.get(id);
      const [px, py] = projection.project((o.bounds.min[0] + o.bounds.max[0]) / 2,
        model.floorY.get(o.levelId) + .6 + api.levelLift(p, o.levelId, t), (o.bounds.min[2] + o.bounds.max[2]) / 2);
      assert.equal(api.pickOccurrence(model, p, t, projection, px, py), id);
    }
  }
  model.meshes.forEach((mesh, at) => assert.deepEqual(mesh.vertices, before[at]));
});

test('single-floor studio stays whole while house explodes, including section clips', () => {
  const p = api.presentAtlas(model, initial(), empty);
  for (const part of model.parts.filter(part => part.buildingId === S && part.role !== 'room-pick'))
    assert.equal(p.clips.get(part.mesh.meshKey), null);
  const state = reduce(initial(), building(S));
  assert.equal(api.hasExplodableLevels(model, S), false);
  assert.equal(api.presentAtlas(model, state, empty).explodeTarget, 0);
});

test('collapsing an exploded selection focuses its exact floor before any Plan visit', () => {
  for (const id of ['syn-occ-living', 'syn-occ-bedroom-upper', 'syn-occ-stairs-ground', 'syn-occ-stairs-upper']) {
    const occurrence = model.occurrencesById.get(id);
    const state = reduce(initial(), building(H), select(id), overlay('network'));
    assert.equal(state.levelId, null);
    assert.equal(state.exploded, true);
    const collapsed = reduce(state, { type: 'explode', exploded: false });
    assert.deepEqual([collapsed.buildingId, collapsed.levelId, collapsed.occurrenceId, collapsed.overlay],
      [occurrence.buildingId, occurrence.levelId, id, 'network']);
    const presentation = api.presentAtlas(model, collapsed, new Set([id]));
    assert.ok(presentation.pickable.has(id));
    for (const part of model.parts.filter(part => part.buildingId === H && part.role === 'roof'))
      assert.ok(presentation.hidden.has(part.mesh.meshKey));
    const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
      api.frameBox(model, collapsed, presentation), { width: 960, height: 640 }, 0);
    const [px, py] = projection.project((occurrence.bounds.min[0] + occurrence.bounds.max[0]) / 2,
      model.floorY.get(occurrence.levelId) + .6, (occurrence.bounds.min[2] + occurrence.bounds.max[2]) / 2);
    assert.equal(api.pickOccurrence(model, presentation, 0, projection, px, py), id);
    assert.equal(reduce(collapsed, { type: 'explode', exploded: false }), collapsed);
  }
  const whole = reduce(initial(), building(H), { type: 'explode', exploded: false });
  assert.equal(whole.levelId, null);
  const presentation = api.presentAtlas(model, whole, empty);
  for (const part of model.parts.filter(part => part.buildingId === H && part.role === 'roof'))
    assert.equal(presentation.hidden.has(part.mesh.meshKey), false);
});

test('count controls retain source anchors and counts with deterministic non-overlapping touch targets', () => {
  const marker = (key, x, y, count = 1) => ({ key, occurrenceId: key, x, y, count });
  const size = { width: 600, height: 500 };
  const separated = [marker('a', 80, 80), marker('b', 160, 80, 1024)];
  assert.deepEqual(api.visibleCountMarkers(separated, size, [], null, []), separated);
  const shared = [marker('a', 250, 250, 3), marker('b', 250, 250, 1)];
  for (const rows of [shared, [...shared].reverse()]) {
    assert.deepEqual(api.visibleCountMarkers(rows, size, [], 'b', []), [shared[1]]);
    assert.deepEqual(api.visibleCountMarkers(rows, size, [], 'a', []), [shared[0]]);
    assert.deepEqual(api.visibleCountMarkers(rows, size, [], null, ['b']), [shared[1]]);
  }
  // The visible 28px badges do not overlap, but their 46px touch targets do.
  const near = [marker('hall', 113, 287, 3), marker('living', 149, 267, 1)];
  assert.deepEqual(api.visibleCountMarkers(near, size, [], 'living', []), [near[1]]);
  assert.deepEqual(api.visibleCountMarkers(near, size, [], 'hall', []), [near[0]]);
  const dense = Array.from({ length: 144 }, (_, i) => marker(String(i).padStart(3, '0'), 50 + i % 12 * 30, 50 + Math.floor(i / 12) * 30));
  const survivors = api.visibleCountMarkers(dense, size, [], null, []);
  assert.ok(survivors.length > 1 && survivors.length < dense.length);
  assert.deepEqual(api.visibleCountMarkers([...dense].reverse(), size, [], null, []).map(row => row.key).sort(), survivors.map(row => row.key).sort());
  const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  survivors.forEach((row, i) => {
    assert.equal(row, dense.find(source => source.key === row.key));
    for (const other of survivors.slice(i + 1)) assert.equal(overlaps(api.countMarkerTarget(row), api.countMarkerTarget(other)), false);
  });
  const panel = { l: 40, t: 40, r: 100, b: 100 };
  assert.deepEqual(api.visibleCountMarkers(separated, size, [panel], null, []), [separated[1]]);
});

test('two independent single-floor buildings initially keep roofs and no exploded sections', async () => {
  const { model: single } = await generatedModel(api, api.buildSingleFloorBuildingsAtlas);
  const state = api.initialAtlasState(single), p = api.presentAtlas(single, state, empty);
  assert.equal(state.exploded, false);
  assert.equal(p.explodeTarget, 0);
  for (const part of single.parts.filter(part => part.role === 'roof')) {
    assert.equal(p.hidden.has(part.mesh.meshKey), false);
    assert.equal(p.clips.get(part.mesh.meshKey), null);
  }
});

test('each plan uses its own source X/Z and room IDs at different yaw/zoom/pan values', () => {
  for (const floor of model.scene.levels) {
    const state = reduce(initial(), level(floor.levelId), view('plan'));
    const p = api.presentAtlas(model, state, empty);
    for (const yaw of [0, 45, 135]) {
      const projection = api.makeProjection({ yaw, pitch: 90, zoom: 1.7, panX: 35, panY: -20 },
        api.frameBox(model, state, p), { width: 960, height: 640 }, 1);
      for (const id of p.pickable) {
        const spec = api.SYNTHETIC_OCCURRENCES.find(row => row.id === id);
        // Studio overlaps Gallery. Interior of Gallery's hole selects Studio;
        // Gallery's own narrow band selects the smaller Gallery polygon.
        const point = spec.probe ?? [(spec.min[0] + spec.max[0]) / 2, (spec.min[1] + spec.max[1]) / 2];
        const [px, py] = projection.project(point[0], model.floorY.get(floor.levelId), point[1]);
        const inverse = api.planPoint(projection, model.floorY.get(floor.levelId), px, py);
        near(inverse, point);
        assert.equal(api.planPickOccurrence(model, p, floor.levelId, ...inverse), id);
      }
    }
  }
});

test('electrical/network/rooms toggles preserve selected room and bind only the declared records', () => {
  let state = reduce(initial(), select('syn-occ-stairs-ground'), view('plan'));
  for (const kind of ['electrical', 'network', null, 'network']) {
    state = reduce(state, overlay(kind));
    assert.equal(state.occurrenceId, 'syn-occ-stairs-ground');
    assert.equal(state.levelId, G);
  }
  const electrical = model.overlays.get('electrical'), network = model.overlays.get('network');
  assert.deepEqual([electrical.records, network.records], [4, 1]);
  assert.deepEqual([...network.placed.keys()], ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
  assert.equal(network.placed.get('syn-occ-stairs-ground').bindings[0].sourceUpdatedAt, null);
  assert.equal(electrical.placed.get('syn-occ-living').positions[0].occurrenceId, 'syn-occ-living');
});

test('runtime documentary summaries count records once while marking both parts of a room', () => {
  const record = { key: 'device:synthetic', id: 'synthetic', label: 'Synthetic fixed AP', category: 'Recorded device',
    detail: 'Generated fixture', qualification: 'Documentary only', sourceDate: null, retrievedAt: null,
    connections: ['Logical connection; no physical route'], sourceFacts: [] };
  const records = { rooms: new Map([['syn-room-stairs', { network: [record], electrical: [] }]]),
    network: 'available', electrical: 'unavailable', sourceFacts: [], unplaced: { network: [], electrical: [] } };
  const index = api.documentaryOverlayIndex(model, records, 'network');
  assert.equal(index.records, 1);
  assert.deepEqual([...index.placed.keys()], ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
  assert.deepEqual(index.placed.get('syn-occ-stairs-ground').positions, [], 'Summary counts never invent device positions');
});

test('normal pointer tap selects through the real CPU picker; drag or pinch changes camera without selecting', () => {
  let state = reduce(initial(), building(H));
  const presentation = api.presentAtlas(model, state, empty);
  const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
    api.frameBox(model, state, presentation), { width: 960, height: 640 }, 0);
  const occurrence = model.occurrencesById.get('syn-occ-hall');
  const [x, y] = projection.project((occurrence.bounds.min[0] + occurrence.bounds.max[0]) / 2, .6,
    (occurrence.bounds.min[2] + occurrence.bounds.max[2]) / 2);
  const captures = new Set(), viewport = { getBoundingClientRect: () => ({ left: 10, top: 20 }),
    hasPointerCapture: id => captures.has(id), setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id) };
  let taps = 0, orbit = { yaw: 0, pitch: 36 }, pan = { x: 0, y: 0 }, zoom = 1;
  const handlers = api.createStagePointers({ top: false,
    gesture: { drag: null, pointers: new Map(), pinch: null, pinched: false }, dragging() {},
    orbit: update => { orbit = update(orbit); }, pan: update => { pan = update(pan); }, zoom: update => { zoom = update(zoom); },
    onTap: (px, py) => { taps++; state = reduce(state, select(api.pickOccurrence(model, presentation, 1, projection, px, py))); } });
  const pointer = (id, px, py, type = 'mouse') => ({ button: 0, pointerId: id, pointerType: type,
    clientX: px + 10, clientY: py + 20, target: viewport, currentTarget: viewport });
  handlers.onPointerDown(pointer(1, x, y)); handlers.onPointerUp(pointer(1, x, y));
  assert.equal(state.occurrenceId, 'syn-occ-hall');
  handlers.onPointerDown(pointer(2, x, y)); handlers.onPointerMove(pointer(2, x + 40, y)); handlers.onPointerUp(pointer(2, x + 40, y));
  assert.equal(orbit.yaw, 16);
  assert.equal(taps, 1);
  handlers.onPointerDown(pointer(3, x, y, 'touch')); handlers.onPointerDown(pointer(4, x + 20, y, 'touch'));
  handlers.onPointerMove(pointer(4, x + 40, y, 'touch'));
  handlers.onPointerUp(pointer(3, x, y, 'touch')); handlers.onPointerUp(pointer(4, x + 40, y, 'touch'));
  assert.equal(zoom, 2); assert.equal(pan.x, 10); assert.equal(taps, 1);
  assert.equal(state.occurrenceId, 'syn-occ-hall');
  assert.equal(captures.size, 0);
});
