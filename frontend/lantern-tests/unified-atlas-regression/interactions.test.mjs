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
const layer = (layer, on = true) => ({ type: 'layer', layer, on });
const H = 'syn-building-house', S = 'syn-building-studio';
const G = 'syn-level-ground', U = 'syn-level-upper';
const near = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-4, `${actual} != ${expected}`));

test('one scene read followed by exactly its pinned model; no extra reads during interactions', () => {
  assert.deepEqual(calls, [`${api.SYNTHETIC_ATLAS.origin}${api.atlasScenePath(model.scene.scope)}?expectedManifestSha256=${composed.manifestSha256}`,
    `${api.SYNTHETIC_ATLAS.origin}${composed.href}`]);
  let state = initial();
  for (let n = 0; n < 12; n++) state = reduce(state, building(H), select('syn-occ-hall'), view('plan'),
    layer('electrical'), view('3d'), building(S), select('syn-occ-studio'), layer('network'));
  assert.equal(state.occurrenceId, 'syn-occ-studio');
  assert.equal(calls.length, 2);
});

test('each of ten declared selectable occurrences is individually selectable across 3D → Plan → 3D', () => {
  assert.equal(model.selectable.size, 10);
  for (const id of model.selectable) {
    const occurrence = model.occurrencesById.get(id);
    let state = reduce(initial(), select(id), layer('electrical'), view('plan'));
    assert.equal(state.occurrenceId, id);
    assert.equal(state.buildingId, occurrence.buildingId);
    assert.equal(state.levelId, occurrence.levelId);
    const presentation = api.presentAtlas(model, state, new Set([id]));
    assert.ok(presentation.pickable.has(id));
    state = reduce(state, view('3d'));
    assert.equal(state.occurrenceId, id);
    assert.equal(state.layers.electrical, true);
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
  let state = reduce(initial(), building(H), select('syn-occ-hall'), layer('network'), view('plan'), building(S));
  assert.equal(state.occurrenceId, null);
  assert.equal(state.levelId, null);
  assert.equal(state.layers.network, true);
  assert.equal(api.presentAtlas(model, state, empty).focusLevelId, 'syn-level-studio');
  state = reduce(state, select('syn-occ-studio'), building(null));
  assert.equal(state.view, 'plan');
  assert.equal(state.occurrenceId, null);
  state = reduce(state, building(H), view('plan'));
  assert.equal(state.occurrenceId, null);
  assert.equal(state.levelId, null);
  // An authored opening outside the room polygon still belongs to its floor.
  for (const scoped of [reduce(initial(), view('plan')), state, reduce(state, level(G))]) {
    const presentation = api.presentAtlas(model, scoped, empty);
    const projection = api.makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 },
      api.frameBox(model, scoped, presentation), { width: 960, height: 640 }, 0);
    const pixel = projection.project(103.5, model.floorY.get(G), 50.975);
    assert.deepEqual(api.planPickTarget(model, presentation, scoped, 0, projection, ...pixel),
      scoped.buildingId === null ? { kind: 'building', buildingId: H } : { kind: 'level', levelId: G });
  }
});

test('explosion lifts drawing and CPU picks together throughout transition without modifying geometry', () => {
  const before = model.meshes.map(mesh => mesh.vertices.slice());
  const state = reduce(initial(), building(H), { type: 'explode', exploded: true });
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
    const state = reduce(initial(), building(H), { type: 'explode', exploded: true }, select(id), layer('network'));
    assert.equal(state.levelId, occurrence.levelId);
    assert.equal(state.exploded, true);
    const collapsed = reduce(state, { type: 'explode', exploded: false });
    assert.deepEqual([collapsed.buildingId, collapsed.levelId, collapsed.occurrenceId, collapsed.layers.network],
      [occurrence.buildingId, occurrence.levelId, id, true]);
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

test('label actions use their full mounted targets and reserve surviving enlarged count targets', () => {
  const label = (id, x, text = id, tier = 'plain') => ({ id, text, x, y: 150, rise: 0, tier });
  const size = { width: 900, height: 500 };
  for (const rows of [[label('a', 100), label('b', 136, 'b', 'selected')],
    [label('a', 250, 'A'.repeat(40)), label('b', 510, 'B'.repeat(40), 'selected')]]) {
    assert.deepEqual(api.visibleLabelHits(rows, size, [], []), [rows[1]]);
    assert.deepEqual(api.visibleLabelHits([...rows].reverse(), size, [], []), [rows[1]]);
  }
  const rows = [label('room', 100, 'Room', 'selected'), label('other', 300, 'Other', 'context')];
  const count = { key: 'electrical:room', occurrenceId: 'room', x: 100, y: 172, count: 3 };
  assert.deepEqual(api.visibleLabelHits(rows, size, [], [count]), [rows[1]], 'The SVG name may remain but its overlapping action must not mount');
  const panel = { l: 275, r: 325, t: 125, b: 175 };
  assert.deepEqual(api.visibleLabelHits(rows, size, [panel], []), [rows[0]]);
  assert.equal(api.labelHitWidth('a'), 44); assert.equal(api.labelHitWidth('A'.repeat(40)), 292);
  assert.equal(api.labelHitTarget(rows[0]).b - api.labelHitTarget(rows[0]).t, 32);
});

test('duplicate floor names use source facts and stable source-order qualifiers without changing identities', async () => {
  for (const heights of [[0, 1.4, 2.8], [0, 0, 0], [null, null, null], [1.401, 1.404, 2.8]]) {
    let inputLevels;
    const { model: named } = await generatedModel(api, async scope => {
      const input = await api.buildSyntheticAtlas(scope), companion = JSON.parse(new TextDecoder().decode(input.companionBytes));
      let at = 0;
      for (const level of companion.levels) {
        level.label = 'Ground floor';
        if (level.buildingId === H) { level.sourceElevationM = heights[at++]; level.elevationBasis = level.sourceElevationM === null ? null : 'Generated original source datum'; }
      }
      inputLevels = companion.levels;
      return { ...input, companionBytes: new TextEncoder().encode(JSON.stringify(companion)) };
    });
    const names = api.atlasLevelNames(named), house = named.buildingsById.get(H);
    assert.equal(new Set(house.levelIds.map(id => names.get(id))).size, house.levelIds.length);
    assert.equal(api.atlasLevelNames(named), names, 'Names are derived once per immutable model');
    for (const level of named.scene.levels) {
      const original = inputLevels.find(row => row.levelId === level.levelId);
      assert.deepEqual([level.label, level.sourceElevationM, level.elevationBasis], [original.label, original.sourceElevationM, original.elevationBasis]);
      assert.ok(api.atlasLevelName(named, level.levelId, true).includes(named.buildingsById.get(level.buildingId).label));
      if (level.buildingId === H) assert.ok(names.get(level.levelId).includes(level.sourceElevationM === null ? 'source elevation unknown' : `source ${level.sourceElevationM} m`));
    }
    if (heights.every(value => value === heights[0])) for (const id of house.levelIds) assert.ok(names.get(id).includes(`source level ${house.levelIds.indexOf(id) + 1}`));
  }
});

test('indexed 3D picks preserve source-order depth winners with bounded work on a tessellated room', async () => {
  const id = 'syn-occ-bedroom-upper', other = 'syn-occ-bath';
  for (const rise of [0, 100_000]) {
    const source = rise === 0 ? model : (await generatedModel(api, scope => api.buildSyntheticAtlas(scope, rise))).model;
    const occurrence = source.occurrencesById.get(id), part = source.pickParts.get(id)[0], dim = 32;
    const positions = [], indices = [], y = source.floorY.get(U) + .6;
    const [x0, , z0] = occurrence.bounds.min, [x1, , z1] = occurrence.bounds.max;
    for (let z = 0; z < dim; z++) for (let x = 0; x < dim; x++) {
      const base = positions.length / 3, l = x0 + (x1 - x0) * x / dim, r = x0 + (x1 - x0) * (x + 1) / dim;
      const top = z0 + (z1 - z0) * z / dim, bottom = z0 + (z1 - z0) * (z + 1) / dim;
      positions.push(l, y, top, r, y, top, r, y, bottom, l, y, bottom);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const [mesh] = api.prepareMeshes([{ meshKey: part.mesh.meshKey, floorId: U, occurrenceId: id,
      positions: new Float32Array(positions), indices: new Uint32Array(indices) }]);
    const indexedPart = { ...part, mesh }, picks = new Map(source.pickParts); picks.set(id, [indexedPart]);
    const indexed = { ...source, pickParts: picks };
    const state = api.atlasReducer(indexed, api.initialAtlasState(indexed), level(U));
    const presentation = api.presentAtlas(indexed, state, empty);
    for (const t of [0, .25, .5, .75, 1]) {
      const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
        api.frameBox(indexed, state, presentation), { width: 960, height: 640 }, 0);
      const [px, py] = projection.project(x0 + (x1 - x0) * .37, mesh.yRange[0] + api.levelLift(presentation, U, t), z0 + (z1 - z0) * .43);
      let calls = 0;
      const measured = { ...projection, project: (...args) => { calls++; return projection.project(...args); } };
      assert.equal(api.pickOccurrence(indexed, presentation, t, measured, px, py), id);
      assert.ok(calls < mesh.triangles, `Indexed successful tap projected ${calls} points for ${mesh.triangles} triangles`);
      // Two actual pick parts with the same geometry retain the first source
      // occurrence at an exact depth tie, then the higher surface wins.
      const otherPart = { ...source.pickParts.get(other)[0], mesh: { ...mesh, meshKey: source.pickParts.get(other)[0].mesh.meshKey, occurrenceId: other } };
      const tied = { ...indexed, pickParts: new Map(picks).set(other, [otherPart]) };
      const both = { ...presentation, pickable: new Set([id, other]) };
      assert.equal(api.pickOccurrence(tied, both, t, projection, px, py), id);
      const raised = mesh.vertices.slice();
      for (let at = 1; at < raised.length; at += 6) raised[at] += .2;
      const higher = { ...otherPart, mesh: { ...otherPart.mesh, vertices: raised,
        yRange: [raised[1], raised[1]], bounds: { min: [x0, raised[1], z0], max: [x1, raised[1], z1] } } };
      const nearer = { ...indexed, pickParts: new Map(picks).set(other, [otherPart, higher]) };
      assert.equal(api.pickOccurrence(nearer, both, t, projection, px, py), other);
    }
  }
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
  for (const [kind, on] of [['electrical', true], ['network', true], ['electrical', false], ['network', false]]) {
    state = reduce(state, layer(kind, on));
    assert.equal(state.layers[kind], on);
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
  let state = reduce(initial(), level(G));
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
    onTap: (px, py) => { taps++; const target = api.pickTarget(model, presentation, state, 0, projection, px, py);
      state = reduce(state, api.targetAction(target)); } });
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
  handlers.onPointerDown(pointer(5, -10000, -10000)); handlers.onPointerUp(pointer(5, -10000, -10000));
  assert.deepEqual([state.buildingId, state.levelId, state.occurrenceId], [H, G, null], 'an empty tap moves one level outward');
});

test('semantic ancestry survives every layer combination, view and explicit explosion, including a single building', async () => {
  const single = (await generatedModel(api, scope => api.buildSingleFloorBuildingsAtlas(scope, 1))).model;
  for (const subject of [model, single]) for (const exploded of [false, true]) for (let mask = 0; mask < 8; mask++) {
    const id = subject === model ? 'syn-occ-hall' : 'single-occ-0';
    const occurrence = subject.occurrencesById.get(id);
    const reduceSubject = (state, action) => api.atlasReducer(subject, state, action);
    let state = reduceSubject(api.initialAtlasState(subject), { type: 'explode', exploded });
    ['electrical', 'network', 'measurements'].forEach((kind, at) => { state = reduceSubject(state, layer(kind, Boolean(mask & 1 << at))); });
    state = reduceSubject(state, select(id));
    const layers = state.layers;
    for (const mode of ['plan', '3d']) {
      const before = state; state = reduceSubject(state, view(mode));
      assert.deepEqual({ ...state, view: before.view }, before, 'view changes no semantic or layer state');
    }
    const expected = [[occurrence.buildingId, occurrence.levelId, null], [occurrence.buildingId, null, null], [null, null, null]];
    for (const path of expected) {
      state = reduceSubject(state, { type: 'out' });
      assert.deepEqual([state.buildingId, state.levelId, state.occurrenceId], path);
      assert.equal(state.layers, layers); assert.equal(state.exploded, exploded); assert.equal(state.view, '3d');
    }
    const whole = api.presentAtlas(subject, state, empty);
    if (!exploded) assert.equal(api.partLifts(subject, whole, 0).size, 0);
  }
  assert.equal(api.initialAtlasState(model, H).buildingId, H, 'an explicit admitted host entry selects its building');
});

test('an opaque upper slab takes its floor hit until the ordinary cutaway exposes the room beneath', () => {
  const state = reduce(initial(), level(G));
  const target = api.presentAtlas(model, state, empty), ceilings = api.sectionCeilings(model);
  const targets = api.sectionTargets(model, target, ceilings);
  const projection = api.makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 },
    api.frameBox(model, state, target), { width: 960, height: 640 }, 0);
  const pixel = projection.project(103.25, 0, 55);
  const shown = api.easePresentation(model, target, 0, [3, ceilings[1]], targets, ceilings);
  const opaque = api.pickTarget(model, shown, state, 0, projection, ...pixel);
  assert.deepEqual(opaque, { kind: 'level', levelId: U });
  // During the cut, the upper face is gone but its opaque underside remains.
  // Shared floor membership must not let the room pass through that slab.
  const underside = api.easePresentation(model, target, 0, [2.7, ceilings[1]], targets, ceilings);
  assert.deepEqual(api.pickTarget(model, underside, state, 0, projection, ...pixel), { kind: 'level', levelId: G });
  assert.deepEqual(api.pickTarget(model, target, state, 0, projection, ...pixel), { kind: 'room', occurrenceId: 'syn-occ-hall' });
  // Retarget from the current visible hit, repeat it, then return before settling.
  const upper = reduce(state, api.targetAction(opaque));
  assert.equal(reduce(upper, api.targetAction(opaque)), upper);
  const back = reduce(upper, level(G));
  assert.equal(back.levelId, G); assert.equal(back.exploded, false);
});

test('authored roof membership selects a floor while visible foreign surfaces select their building', async () => {
  const { model: authored } = await generatedModel(api, async scope => {
    const input = await api.buildSyntheticAtlas(scope), companion = JSON.parse(new TextDecoder().decode(input.companionBytes));
    for (const binding of companion.meshBindings) if (binding.nodeIndex === 3 && binding.role === 'roof') binding.levelIds = [U];
    return { ...input, companionBytes: new TextEncoder().encode(JSON.stringify(companion)) };
  });
  const own = api.atlasReducer(authored, api.initialAtlasState(authored), building(H));
  const p = api.presentAtlas(authored, own, empty);
  const projection = api.makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 },
    api.frameBox(authored, own, p), { width: 960, height: 640 }, 0);
  const pixel = projection.project(103.25, 5, 55);
  assert.deepEqual(api.pickTarget(authored, p, own, 0, projection, ...pixel), { kind: 'level', levelId: U });
  const foreign = api.atlasReducer(authored, own, level('syn-level-studio'));
  const foreignPresentation = api.presentAtlas(authored, foreign, empty);
  assert.deepEqual(api.pickTarget(authored, foreignPresentation, foreign, 0, projection, ...pixel), { kind: 'building', buildingId: H });
});

test('measurement spans retain irregular outlines and holes without turning a curved boundary into a chord', () => {
  const ring = [[0, 0], [2, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
  const lengths = points => api.ringRuns(points).map(run => Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1])).sort((a, b) => a - b);
  assert.deepEqual(lengths(ring), [1, 1, 2, 3, 3, 4]);
  assert.deepEqual(lengths([...ring].reverse()), lengths(ring));
  const open = ring.slice(0, -1); assert.deepEqual(lengths([...open.slice(3), ...open.slice(0, 3)]), lengths(ring));
  const arc = Array.from({ length: 181 }, (_, at) => [5 * Math.cos(at * Math.PI / 360), 5 * Math.sin(at * Math.PI / 360)]);
  const long = api.ringRuns(arc).filter(run => Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]) >= api.MIN_SPAN_M);
  assert.equal(long.length, 1, 'only the actual closing diagonal qualifies, once');
  assert.ok(Math.abs(Math.hypot(long[0].b[0] - long[0].a[0], long[0].b[1] - long[0].a[1]) - Math.sqrt(50)) < 1e-9);
  const occurrenceId = 'syn-occ-hall', occurrence = model.occurrencesById.get(occurrenceId), room = model.roomsById.get(occurrence.roomId);
  const polygon = { outer: ring, holes: [[[.1, .1], [.6, .1], [.6, .6], [.1, .6]]] };
  const subject = { ...model, roomPolygons: new Map(model.roomPolygons).set(occurrenceId, [polygon]),
    shapes: new Map(model.shapes).set(occurrenceId, [[ring, ...polygon.holes]]),
    roomsById: new Map(model.roomsById).set(room.roomId, { ...room, occurrenceIds: [occurrenceId, 'generated-excluded-sibling'] }) };
  assert.equal(api.roomArea(subject, occurrenceId).partial, true);
  assert.equal(api.roomArea(subject, occurrenceId).squareMetres, 5.75);
  assert.equal(api.edgeSpans(subject, occurrenceId).length, 6);
  assert.equal(api.roomArea(model, 'syn-occ-study'), null, 'estimated proxies never acquire measured dimensions');
});

test('native trackpad rotation and scale use cumulative start values and scoped listeners release normally', () => {
  let pose = { yaw: 30, zoom: 2 }, rotates = true, prevented = 0;
  const gesture = api.createTrackpadGesture({ read: () => pose, apply: value => { pose = { yaw: value.yaw ?? pose.yaw, zoom: value.zoom }; },
    rotates: () => rotates, zoomLimits: { min: .5, max: 8 } });
  const event = (rotation, scale) => ({ rotation, scale, preventDefault() { prevented++; } });
  const listeners = new Map();
  const node = { addEventListener(name, handler, options) { assert.equal(options.passive, false); listeners.set(name, handler); },
    removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); } };
  const stop = api.bindTrackpadGesture(node, gesture);
  listeners.get('gesturestart')(event(0, 1)); assert.equal(gesture.active(), true);
  listeners.get('gesturechange')(event(10, 1.2)); assert.deepEqual(pose, { yaw: 40, zoom: 2.4 });
  listeners.get('gesturechange')(event(20, 1.5)); assert.deepEqual(pose, { yaw: 50, zoom: 3 });
  listeners.get('gestureend')(event(20, 1.5)); assert.equal(gesture.active(), false);
  rotates = false; gesture.start(event(0, 1)); gesture.change(event(45, 2));
  assert.deepEqual(pose, { yaw: 50, zoom: 6 }, 'Plan keeps its yaw while pinch still scales'); gesture.end(event(45, 2));
  stop(); assert.equal(listeners.size, 0); assert.equal(prevented, 7);
});

test('property aggregation counts source entities once and retains differing same-date observations and building coverage', () => {
  const record = (key, detail) => ({ key, id: 'ap-1', label: 'Generated AP', category: 'Recorded device', detail,
    qualification: 'Generated documentary fact', sourceDate: null, retrievedAt: null, connections: [], sourceFacts: [] });
  const one = record('generated-source-A/device/ap-1', 'First observation'), next = record(one.key, 'Later source revision');
  const distinct = record('generated-source-B/device/ap-1', 'Another source package');
  const records = (placed, unplaced) => ({ rooms: new Map(placed ? [['syn-room-hall', { network: [placed], electrical: [] }]] : []),
    network: 'available', electrical: 'unavailable', sourceFacts: [], unplaced: { network: unplaced, electrical: [] } });
  const merged = api.mergeRuntimeRecords(model, [{ buildingId: H, reason: 'available', records: records(one, []) },
    { buildingId: S, reason: 'available', records: records(null, [next, distinct]) }]);
  const index = api.documentaryOverlayIndex(model, merged, 'network');
  assert.deepEqual([index.records, index.unplacedRecords], [2, 1]);
  assert.equal(merged.rooms.get('syn-room-hall').network[0].observations[0].detail, next.detail);
  assert.equal(merged.unplaced.network[0].key, distinct.key);
  const unavailable = api.mergeRuntimeRecords(model, [{ buildingId: H, reason: 'no-native-building-link', records: null },
    { buildingId: S, reason: 'room-link-not-qualified', records: null }]);
  assert.deepEqual(unavailable.buildings.map(row => [row.buildingId, row.reason]), [[H, 'no-native-building-link'], [S, 'room-link-not-qualified']]);
});
