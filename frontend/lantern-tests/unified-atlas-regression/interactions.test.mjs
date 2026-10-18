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

test('Plan picks follow topmost filled groups and display-only rooms retain hierarchy targets', async () => {
  const { model: subject } = await generatedModel(api, async scope => {
    const input = await api.buildSingleFloorBuildingsAtlas(scope, 2);
    const source = JSON.parse(new TextDecoder().decode(input.companionBytes));
    const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const add = (plan, feature) => { plan.features.push(feature); plan.featureIds.push(feature.featureId); };
    const feature = (id, role, outer, holes = []) => ({ featureId: id, role, roomId: null, spaceOccurrenceId: null, polygons: [{ outer, holes }] });
    // Later source group adds an authored display-only band overlapping the
    // first building. Its hole exposes the original selectable room beneath.
    add(source.plans[1], feature('generated:overlapping-room', 'room', rect(0, 0, 3, 3), [rect(1, 1, 2, 2)]));
    for (const [at, role] of ['room', 'wall', 'opening', 'stair', 'context'].entries())
      add(source.plans[0], feature(`generated:surface-${role}`, role, rect(4 + at, 0, 4.8 + at, .8)));
    add(source.plans[1], feature('generated:overlapping-context', 'context', rect(4, 0, 4.8, .8)));
    source.plans[0].features[0].roomId = null; // explicit occurrence remains selectable without a feature room/native ID
    source.buildings[1].bounds.min[0] = 0; source.levels[1].bounds.min[0] = 0;
    return { ...input, companionBytes: new TextEncoder().encode(JSON.stringify(source)) };
  });
  const initial = api.atlasReducer(subject, api.initialAtlasState(subject), view('plan'));
  const firstBuilding = api.atlasReducer(subject, initial, building('single-building-0'));
  const chosenFloor = api.atlasReducer(subject, firstBuilding, level('single-level-0'));
  const pick = (state, point, presentationOverride) => {
    const presentation = presentationOverride ?? api.presentAtlas(subject, state, empty);
    const projection = api.makeProjection({ yaw: 17, pitch: 76, zoom: 1, panX: 0, panY: 0 }, api.frameBox(subject, state, presentation), { width: 960, height: 640 }, 0);
    const levelId = presentation.planLevels.at(-1);
    const y = subject.floorY.get(levelId) + api.levelLift(presentation, levelId, .5);
    const pixel = projection.project(point[0], y, point[1]);
    return api.planPickTarget(subject, presentation, state, .5, projection, ...pixel);
  };
  const originalOrder = [...api.presentAtlas(subject, initial, empty).planLevels];
  const sourcePlans = JSON.stringify(subject.scene.plans), sourceVertices = subject.meshes.map(mesh => mesh.vertices.slice());
  assert.deepEqual(pick(initial, [.5, .5]), { kind: 'building', buildingId: 'single-building-1' });
  assert.deepEqual(pick(initial, [1.5, 1.5]), { kind: 'building', buildingId: 'single-building-0' }, 'later hole reveals the earlier filled group');
  assert.deepEqual(pick(initial, [9, 1]), { kind: 'building', buildingId: 'single-building-1' }, 'nonoverlapping authored room remains accessible');
  assert.deepEqual(pick(initial, [4.4, .4]), { kind: 'building', buildingId: 'single-building-0' }, 'later context fill cannot intercept a floor');
  for (const x of [4.4, 5.4, 6.4, 7.4]) {
    assert.deepEqual(pick(firstBuilding, [x, .4]), { kind: 'level', levelId: 'single-level-0' });
    assert.deepEqual(pick(chosenFloor, [x, .4]), { kind: 'level', levelId: 'single-level-0' }, 'display-only surfaces do not become selected rooms');
  }
  assert.equal(pick(firstBuilding, [8.4, .4]), null, 'context alone remains empty paper');
  assert.deepEqual(pick(chosenFloor, [1.5, 1.5]), { kind: 'room', occurrenceId: 'single-occ-0' });
  assert.deepEqual(api.presentAtlas(subject, initial, empty).planLevels, originalOrder);
  // Different authored planes/lifts use each group's own inverse projection.
  const p = api.presentAtlas(subject, initial, empty), shifted = { ...subject, floorY: new Map(subject.floorY).set('single-level-1', 4) };
  const projected = { ...p, offsets: new Map(p.offsets).set('single-level-1', 3) };
  const projection = api.makeProjection({ yaw: 0, pitch: 60, zoom: 1, panX: 0, panY: 0 }, api.frameBox(subject, initial, p), { width: 960, height: 640 }, 0);
  const pixel = projection.project(.5, 4 + api.levelLift(projected, 'single-level-1', .5), .5);
  assert.deepEqual(api.planPickTarget(shifted, projected, initial, .5, projection, ...pixel), { kind: 'building', buildingId: 'single-building-1' });
  assert.equal(JSON.stringify(subject.scene.plans), sourcePlans);
  subject.meshes.forEach((mesh, at) => assert.deepEqual(mesh.vertices, sourceVertices[at]));
});

test('authored room fill with an explicitly unselectable occurrence selects only its floor', async () => {
  const { model: subject } = await generatedModel(api, async scope => {
    const input = await api.buildSyntheticAtlas(scope), source = JSON.parse(new TextDecoder().decode(input.companionBytes));
    const feature = { featureId: 'generated:display-only-void', roomId: 'syn-room-void', spaceOccurrenceId: 'syn-occ-void', role: 'room',
      polygons: [{ outer: [[108, 56], [109, 56], [109, 57], [108, 57]], holes: [] }] };
    const plan = source.plans.find(plan => plan.levelId === U); plan.features.push(feature); plan.featureIds.push(feature.featureId);
    source.occurrences.find(row => row.spaceOccurrenceId === 'syn-occ-void').planFeatureIds.push(feature.featureId);
    source.coverage.exclusions.find(row => row.spaceOccurrenceId === 'syn-occ-void').reason = 'Display-only source occurrence without pick geometry.';
    return { ...input, companionBytes: new TextEncoder().encode(JSON.stringify(source)) };
  });
  const state = api.atlasReducer(subject, api.atlasReducer(subject, api.initialAtlasState(subject), level(U)), view('plan'));
  const p = api.presentAtlas(subject, state, empty), projection = api.makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, api.frameBox(subject, state, p), { width: 960, height: 640 }, 0);
  const pixel = projection.project(108.5, subject.floorY.get(U), 56.5);
  const target = api.planPickTarget(subject, p, state, 0, projection, ...pixel);
  assert.equal(subject.selectable.has('syn-occ-void'), false);
  assert.deepEqual(target, { kind: 'level', levelId: U });
  const next = api.atlasReducer(subject, state, api.targetAction(target));
  assert.equal(next.levelId, U); assert.equal(next.occurrenceId, null);
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
  const contextual = (await generatedModel(api, scope => api.buildSingleFloorBuildingsAtlas(scope, 1, true))).model;
  assert.equal(contextual.scene.buildings.length, 2);
  assert.equal(contextual.floorBuildings.length, 1);
  assert.equal(api.initialAtlasState(contextual).buildingId, 'single-building-0', 'an unconfigured entry retains the sole navigable building default');
  assert.equal(api.initialAtlasState(contextual, null).buildingId, 'single-building-0');
  assert.equal(api.initialAtlasState(contextual, 'generated-unrecognized-entry').buildingId, 'single-building-0', 'an unknown presentation entry retains the same sole-building default');
  assert.equal(api.initialAtlasState(contextual, 'single-building-0').buildingId, 'single-building-0');
  assert.equal(api.initialAtlasState(contextual, 'single-context').buildingId, null, 'an admitted context-only entry retains property scope without substituting another building');
  assert.equal(api.initialAtlasState(model, 'generated-unrecognized-entry').buildingId, null, 'multiple navigable buildings retain property scope');
});

test('a foreground wall keeps its floor target while the exposed interior remains a room', () => {
  const state = reduce(initial(), level(G)), presentation = api.presentAtlas(model, state, empty);
  const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
    api.frameBox(model, state, presentation), { width: 960, height: 640 }, 0);
  const wall = projection.project(103.25, .6, 59);
  assert.equal(api.pickOccurrenceHit(model, presentation, 0, projection, ...wall).occurrenceId, 'syn-occ-hall', 'the inset room proxy lies behind the drawn wall');
  assert.deepEqual(api.pickTarget(model, presentation, state, 0, projection, ...wall), { kind: 'level', levelId: G });
  const interior = projection.project(103.25, .6, 55);
  assert.deepEqual(api.pickTarget(model, presentation, state, 0, projection, ...interior), { kind: 'room', occurrenceId: 'syn-occ-hall' });
});

test('a generated horizontal floor skin retains room access at its own floor height', () => {
  // CPU binding projection, like the indexed triangle positive above. Original
  // publication bytes and all existing source meshes remain unchanged.
  const id = 'syn-occ-hall', floorY = model.floorY.get(G), before = model.meshes.map(mesh => mesh.vertices.slice());
  const plane = (meshKey, y, occurrenceId) => api.prepareMeshes([{ meshKey, floorId: G, occurrenceId,
    positions: new Float32Array([102.2, y, 52, 104.3, y, 52, 104.3, y, 58.8, 102.2, y, 58.8]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]) }])[0];
  const base = model.pickParts.get(id)[0], proxy = { ...base, mesh: plane('generated-low-room', floorY, id) };
  const state = reduce(initial(), level(G)), original = api.presentAtlas(model, state, empty);
  const presentation = { ...original, hidden: new Set(), clips: new Map(), pickable: new Set([id]) };
  const projection = api.makeProjection({ yaw: 0, pitch: 36, zoom: 1, panX: 0, panY: 0 },
    api.frameBox(model, state, original), { width: 960, height: 640 }, 0);
  for (const height of [.04, .2]) {
    const skin = { ...base, occurrenceId: null, role: 'structure', mesh: plane(`generated-floor-skin-${height}`, floorY + height, null) };
    const subject = { ...model, parts: [skin], pickParts: new Map([[id, [proxy]]]) };
    const pixel = projection.project(103.25, floorY + height, 55), room = api.pickOccurrenceHit(subject, presentation, 0, projection, ...pixel);
    assert.equal(room.occurrenceId, id);
    assert.ok(pixel[2] - room.depth > api.PICK_DEPTH_TOLERANCE, 'the retained skin exemption is required beyond the ordinary depth tolerance');
    assert.deepEqual(api.pickTarget(subject, presentation, state, 0, projection, ...pixel), height === .04
      ? { kind: 'room', occurrenceId: id } : { kind: 'level', levelId: G });
  }
  model.meshes.forEach((mesh, at) => assert.deepEqual(mesh.vertices, before[at]));
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


test('shared documentary entities retain each room’s whole local primary observation', () => {
  const local = (room, sourceDate) => ({ key: 'generated-source/sheet/shared', id: 'shared', label: 'Shared sheet', category: 'Electrical drawing',
    detail: `Observed in ${room}`, qualification: 'Documentary only', sourceDate, retrievedAt: `${sourceDate}T12:00:00Z`,
    connections: [`Connection observed in ${room}`], sourceFacts: [{ label: 'Room association in this observation', value: room }] });
  const hall = local('Hall', '2026-10-01'), stairs = local('Stairs', '2026-10-02'), unplaced = local('Unplaced source observation', '2026-10-03');
  const distinct = { ...hall, key: 'another-source/sheet/shared', detail: 'Distinct source with reused raw ID' };
  const records = { rooms: new Map([['syn-room-hall', { network: [], electrical: [hall] }], ['syn-room-stairs', { network: [], electrical: [stairs] }]]),
    network: 'unavailable', electrical: 'available', sourceFacts: [], unplaced: { network: [], electrical: [unplaced, distinct] } };
  const before = JSON.stringify([...records.rooms]);
  const merged = api.mergeRuntimeRecords(model, [{ buildingId: H, reason: 'available', records }]);
  for (const [roomId, expected] of [['syn-room-hall', hall], ['syn-room-stairs', stairs]]) {
    const { observations, ...primary } = merged.rooms.get(roomId).electrical[0];
    assert.deepEqual(primary, expected, 'all primary dates, connections and association facts remain room-local');
    assert.equal(observations.length, 2);
    assert.deepEqual(new Set([primary, ...observations].map(row => row.detail)), new Set([hall.detail, stairs.detail, unplaced.detail]));
  }
  const index = api.documentaryOverlayIndex(model, merged, 'electrical');
  assert.deepEqual([index.records, index.unplacedRecords], [2, 1]);
  assert.equal(merged.unplaced.electrical[0].key, distinct.key);
  assert.equal(JSON.stringify([...records.rooms]), before);
});


test('presentation-scaled and off-centre Plan fits retain full-frame zoom-out through shared gesture limits', () => {
  const state = reduce(initial(), level(G), view('plan'));
  const presentation = api.presentAtlas(model, state, empty), box = api.frameBox(model, state, presentation);
  const size = { width: 320, height: 240 }, pose = { yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 };
  const scale = 4, shift = { x: (box.max[0] - box.min[0]) * .45, z: (box.max[2] - box.min[2]) * -.3 };
  const minimum = api.frameZoomMinimum(box, size, pose, 1, scale, shift, .6);
  assert.ok(minimum > 0 && minimum < .6 / scale, 'the floor also accommodates the off-centre drawing extent');
  assert.equal(api.frameZoomMinimum(box, size, pose, 1, 1, { x: 0, z: 0 }, .6), .6);
  const base = api.makeProjection({ ...pose, zoom: minimum * scale }, box, size, 1);
  const recovered = api.makeProjection({ ...pose, zoom: minimum * scale,
    panX: -base.k * (shift.x * base.ct - shift.z * base.st),
    panY: -base.k * (shift.x * base.st + shift.z * base.ct) * base.sf }, box, size, 1);
  for (const x of [box.min[0], box.max[0]]) for (const z of [box.min[2], box.max[2]]) {
    const [px, py] = recovered.project(x, box.min[1], z);
    assert.ok(px >= 0 && px <= size.width && py >= 0 && py <= size.height, 'every source-frame corner remains reachable without changing the fitted centre');
  }
  let zoom = 1, floor = minimum, taps = 0;
  const limits = { get min() { return floor; }, max: 8 };
  const captures = new Set(), node = { getBoundingClientRect: () => ({ left: 0, top: 0 }),
    hasPointerCapture: id => captures.has(id), setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id) };
  const pointer = (id, x) => ({ button: 0, pointerId: id, pointerType: 'touch', clientX: x, clientY: 10, target: node, currentTarget: node });
  const handlers = api.createStagePointers({ gesture: { drag: null, pointers: new Map(), pinch: null, pinched: false }, top: true,
    onTap: () => taps++, dragging: () => {}, zoom: update => { zoom = update(zoom); }, zoomLimits: limits,
    pan: () => {}, orbit: () => {} });
  handlers.onPointerDown(pointer(1, 10)); handlers.onPointerDown(pointer(2, 110)); handlers.onPointerMove(pointer(2, 11));
  assert.equal(zoom, minimum); handlers.onPointerUp(pointer(1, 10)); handlers.onPointerUp(pointer(2, 11));
  assert.equal(taps, 0); assert.equal(captures.size, 0);
  floor = minimum * 2; zoom = 1;
  const gesture = api.createTrackpadGesture({ read: () => ({ yaw: 0, zoom }), apply: value => { zoom = value.zoom; }, rotates: () => false, zoomLimits: limits });
  const event = scale => ({ preventDefault: () => {}, scale, rotation: 0 });
  gesture.start(event(1)); gesture.change(event(.01)); gesture.end(event(.01));
  assert.equal(zoom, floor, 'native cumulative zoom reads the same current presentation floor');
});

// Fictional screen-space floor outlines and supplied painted-text metrics.
// These are presentation positives, not household or physical measurements.
const labelRectangle = (l, t, r, b) => ({ outer: [[l, t], [r, t], [r, b], [l, b]], holes: [] });
const labelFrame = api.planLabelFrame((x, _y, z) => [x, z], 0);
const labelInput = (id, polygon, text, width, tier = 'plain', anchor) => {
  const xs = polygon.outer.map(p => p[0]), ys = polygon.outer.map(p => p[1]);
  const x = anchor?.[0] ?? (Math.min(...xs) + Math.max(...xs)) / 2, y = anchor?.[1] ?? (Math.min(...ys) + Math.max(...ys)) / 2;
  return { id, text, tier, x, y, anchorX: x, anchorY: y, rise: 0, clearance: Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2,
    shape: api.preparePlanLabelShape([polygon]), metrics: { width, height: 18 } };
};
const labelOverlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

test('settled Plan keeps horizontal names and turns a fictional narrow name inside its own source outline', () => {
  const strip = labelRectangle(300, 240, 320, 360), spacious = labelRectangle(500, 220, 660, 380);
  const rows = [labelInput('syn-occ-hall', strip, 'Linen', 50), labelInput('syn-occ-living', spacious, 'Craft room', 76)];
  const before = JSON.stringify(rows), paper = api.preparePlanLabelPaper([{ role: 'room', polygons: [strip, spacious] }]);
  const resolved = api.placePlanRoomLabels(rows, { width: 960, height: 640 }, [], [], labelFrame, paper);
  assert.deepEqual(resolved.map(row => [row.id, row.plan.mode]), [['syn-occ-living', 'horizontal'], ['syn-occ-hall', 'rotated']]);
  const along = resolved[1];
  assert.deepEqual([along.plan.x, along.plan.y, along.plan.angle], [310, 300, -90]);
  assert.equal(along.plan.width, 50); assert.equal(along.plan.height, 32);
  assert.equal(Math.round(along.plan.box.r - along.plan.box.l), 32, 'the complete rotated hit AABB can be wider than the narrow visual outline');
  assert.deepEqual(api.visibleLabelHits(resolved, { width: 960, height: 640 }, [], []), resolved);
  for (const row of resolved) {
    const state = reduce(initial(), view('plan'), select(row.id));
    assert.equal(state.occurrenceId, row.id);
    assert.equal(state.levelId, model.occurrencesById.get(row.id).levelId);
    assert.equal(state.buildingId, model.occurrencesById.get(row.id).buildingId);
  }
  assert.deepEqual(api.placePlanRoomLabels([...rows].reverse(), { width: 960, height: 640 }, [], [], labelFrame, paper), resolved);
  assert.equal(JSON.stringify(rows), before, 'source anchors and polygons are unchanged');
  const covered = api.placePlanRoomLabels(rows, { width: 960, height: 640 }, [along.plan.box], [], labelFrame, paper);
  assert.deepEqual(covered.map(row => row.id), ['syn-occ-living'], 'a collision alone does not turn an inside name into a callout');
  const holed = { ...strip, holes: [labelRectangle(305, 292, 315, 300).outer] };
  const crossingHole = labelInput('generated-holed-strip', holed, 'Linen', 50, 'plain', [310, 280]);
  const aroundHole = api.placePlanRoomLabels([crossingHole], { width: 960, height: 640 }, [], [], labelFrame,
    api.preparePlanLabelPaper([{ role: 'room', polygons: [holed] }]));
  assert.ok(aroundHole.every(row => row.plan.mode !== 'rotated'), 'a visual rectangle cannot bridge an authored hole even with all four corners inside');
});

test('wide Plan callouts clear authored features and full controls while the owned count and source anchor stay fixed', () => {
  const strip = labelRectangle(393, 280, 407, 380), floor = labelRectangle(260, 260, 540, 400);
  const row = labelInput('generated-textile-strip', strip, 'Textile store', 80);
  const count = { key: 'network:generated-textile-strip', occurrenceId: row.id, count: 3, x: row.anchorX, y: row.anchorY };
  const other = { key: 'electrical:other', occurrenceId: 'other', count: 1, x: 550, y: 210 };
  const cover = [{ l: 0, t: 0, r: 160, b: 640 }], size = { width: 960, height: 640 };
  // A context outline covers the whole stage but is intentionally clear paper.
  const paper = api.preparePlanLabelPaper([{ role: 'room', polygons: [floor] }, { role: 'context', polygons: [labelRectangle(0, 0, 960, 640)] }]);
  const before = JSON.stringify({ row, count, other });
  const resolved = api.placePlanRoomLabels([row], size, cover, [count, other], labelFrame, paper);
  assert.equal(resolved.length, 1); const callout = resolved[0], pose = callout.plan;
  assert.equal(pose.mode, 'callout'); assert.equal(pose.leader.dot, false);
  assert.deepEqual([callout.anchorX, callout.anchorY], [row.anchorX, row.anchorY]);
  for (const box of [...cover, api.countMarkerTarget(count), api.countMarkerTarget(other), { l: 260, t: 260, r: 540, b: 400 }])
    assert.equal(labelOverlap(pose.box, box), false);
  const own = api.countMarkerTarget(count), start = pose.leader.points[0];
  assert.ok(start[0] >= own.l && start[0] <= own.r && start[1] >= own.t && start[1] <= own.b);
  assert.ok([Math.abs(start[0] - own.l), Math.abs(start[0] - own.r), Math.abs(start[1] - own.t), Math.abs(start[1] - own.b)].some(n => n < 1e-8));
  const leaderLength = pose.leader.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pose.leader.points[i][0], p[1] - pose.leader.points[i][1]), 0);
  assert.ok(leaderLength <= 160);
  const obstacles = api.planLabelObstacles(callout), end = pose.leader.points.at(-1);
  assert.ok(obstacles.length > 2);
  assert.deepEqual(api.placeLabels([{ x: end[0], y: end[1], w: 30, h: 16 }], obstacles, size), [], 'measurement text gives way to the complete connector');
  assert.deepEqual(api.visibleLabelHits(resolved, size, cover, [count, other]), resolved);
  const remembered = new Map([[row.id, pose.direction]]);
  assert.equal(api.placePlanRoomLabels([row], size, cover, [count, other], labelFrame, paper, remembered)[0].plan.direction, pose.direction);
  assert.equal(JSON.stringify({ row, count, other }), before);
  assert.deepEqual(api.placePlanRoomLabels([row], { width: 720, height: 640 }, [], [], labelFrame, paper), [], 'narrow stages keep unselected external names in the room list');
});

test('callouts have stable context priority and a four-name cap; an occupied valid floor retains list fallback', () => {
  const rows = Array.from({ length: 6 }, (_, at) => labelInput(`generated-strip-${at}`, labelRectangle(133 + at * 150, 250, 147 + at * 150, 370), `Store ${at}`, 58,
    at === 5 ? 'context' : 'plain'));
  const paper = api.preparePlanLabelPaper(rows.map(row => ({ role: 'room', polygons: row.shape.polygons }))), size = { width: 1200, height: 640 };
  const resolved = api.placePlanRoomLabels(rows, size, [], [], labelFrame, paper);
  assert.equal(resolved.length, 4); assert.equal(resolved[0].id, 'generated-strip-5');
  assert.ok(resolved.every(row => row.plan.mode === 'callout' && row.plan.leader.dot));
  assert.deepEqual(api.placePlanRoomLabels([...rows].reverse(), size, [], [], labelFrame, paper), resolved);
  resolved.forEach((row, i) => {
    assert.deepEqual(row.plan.leader.points[0], [row.anchorX, row.anchorY]);
    for (const other of resolved.slice(i + 1)) assert.equal(labelOverlap(row.plan.box, other.plan.box), false);
  });
  const occupied = api.preparePlanLabelPaper([{ role: 'wall', polygons: [labelRectangle(0, 0, 1200, 640)] }]);
  assert.deepEqual(api.placePlanRoomLabels(rows, size, [], [], labelFrame, occupied), []);
  assert.deepEqual(rows.map(row => row.text), ['Store 0', 'Store 1', 'Store 2', 'Store 3', 'Store 4', 'Store 5']);
});

test('selected narrow Plan names keep the standing tag and full target; full Unicode names stay intact or remain in the list', () => {
  const strip = labelRectangle(393, 280, 407, 380), row = { ...labelInput('generated-selected-strip', strip, 'Tool store', 95, 'selected'), rise: 1,
    metrics: { width: 95, height: 36 } };
  const size = { width: 640, height: 640 }, paper = api.preparePlanLabelPaper([{ role: 'room', polygons: [strip] }]);
  assert.equal(api.planRoomLabelFits(row, labelFrame), false);
  const [resolved] = api.placePlanRoomLabels([row], size, [], [], labelFrame, paper);
  assert.equal(resolved.plan.mode, 'standing');
  assert.equal(resolved.plan.y, row.anchorY - api.LABEL_TAG_RISE);
  assert.deepEqual(resolved.plan.leader.points[0], [row.anchorX, row.anchorY]);
  assert.ok(api.planLabelObstacles(resolved).length > 2);
  const wide = labelRectangle(200, 140, 600, 260), full = '工房 / WWW 👩‍🔧 é', long = full.repeat(60);
  const normal = labelInput('generated-unicode', wide, full, 180), extended = labelInput('generated-long-unicode', wide, long, 2200);
  const names = api.placePlanRoomLabels([normal, extended], size, [], [], labelFrame, paper);
  assert.deepEqual(names.map(row => row.text), [full]);
  assert.equal(extended.text, long, 'a full name that exceeds the available frame is not truncated or compressed');
  const tall = labelRectangle(140, 60, 160, 580), tallName = labelInput('generated-tall-name', tall, full.repeat(3), 400);
  const tallNames = api.placePlanRoomLabels([tallName], { width: 320, height: 640 }, [], [], labelFrame,
    api.preparePlanLabelPaper([{ role: 'room', polygons: [tall] }]));
  assert.equal(tallNames[0].plan.mode, 'rotated', 'a complete vertical name may use the stage height instead of being capped to its width');
  assert.equal(tallNames[0].text, tallName.text);
});

test('Plan label projections across source floors and yaw preserve all model buffers, anchors and polygon coordinates', () => {
  const vertices = model.meshes.map(mesh => mesh.vertices.slice()), shapes = JSON.stringify([...model.shapes]), anchors = JSON.stringify([...model.labels]);
  for (const floor of model.scene.levels) for (const yaw of [0, 45, 135]) {
    const state = reduce(initial(), level(floor.levelId), view('plan')), presentation = api.presentAtlas(model, state, empty), size = { width: 960, height: 640 };
    const projection = api.makeProjection({ yaw, pitch: 90, zoom: 1.4, panX: 12, panY: -8 }, api.frameBox(model, state, presentation), size, 1);
    const y = model.floorY.get(floor.levelId), frame = api.planLabelFrame(projection.project, y);
    const rows = [...presentation.pickable].map(id => {
      const anchor = model.labels.get(id), [x, sy] = projection.project(anchor.x, y, anchor.z);
      return { id, text: model.roomsById.get(model.occurrencesById.get(id).roomId).label, tier: 'plain', x, y: sy, anchorX: x, anchorY: sy,
        rise: 0, clearance: anchor.clearance, shape: api.preparePlanLabelShape(model.roomPolygons.get(id)), metrics: { width: 60, height: 18 } };
    });
    const paper = api.preparePlanLabelPaper(api.planFeaturesForLevel(model, floor.levelId));
    const resolved = api.placePlanRoomLabels(rows, size, [], [], frame, paper);
    assert.ok(resolved.length > 0);
    for (const row of resolved) {
      const source = rows.find(source => source.id === row.id);
      assert.deepEqual([row.anchorX, row.anchorY], [source.x, source.y]);
    }
  }
  model.meshes.forEach((mesh, at) => assert.deepEqual(mesh.vertices, vertices[at]));
  assert.equal(JSON.stringify([...model.shapes]), shapes); assert.equal(JSON.stringify([...model.labels]), anchors);
  assert.equal(api.roomArea(model, 'syn-occ-study'), null, 'the estimated source proxy remains outside dimensions and areas');
});

test('a long full-name callout can clear a fictional strip while its centre exceeds the leader bound', () => {
  const strip = labelRectangle(592, 100, 608, 500), row = labelInput('generated-long-strip', strip, 'Materials and instrument storage', 300);
  const size = { width: 1200, height: 640 }, paper = api.preparePlanLabelPaper([{ role: 'room', polygons: [strip] }]);
  const [resolved] = api.placePlanRoomLabels([row], size, [], [], labelFrame, paper);
  assert.equal(resolved.plan.mode, 'callout');
  assert.equal(resolved.text, row.text);
  assert.ok(Math.hypot(resolved.plan.x - row.anchorX, resolved.plan.y - row.anchorY) > 160);
  const points = resolved.plan.leader.points;
  const length = points.slice(1).reduce((sum, point, at) => sum + Math.hypot(point[0] - points[at][0], point[1] - points[at][1]), 0);
  assert.ok(length > 0 && length <= 160);
  assert.equal(labelOverlap(resolved.plan.box, { l: 592, t: 100, r: 608, b: 500 }), false);
});

test('ordinary horizontal Plan names and selected tags clear their own complete count targets without moving source anchors', () => {
  const selected = { ...labelInput('generated-selected-workroom', labelRectangle(200, 100, 400, 400), 'Workroom', 120, 'selected'),
    metrics: { width: 120, height: 36 } };
  const plain = labelInput('generated-plain-workroom', labelRectangle(500, 100, 700, 400), 'Materials', 76);
  const rows = [plain, selected], counts = rows.map(row => ({ key: `network:${row.id}`, occurrenceId: row.id, count: 3, x: row.anchorX, y: row.anchorY }));
  const before = JSON.stringify({ rows, counts }), size = { width: 960, height: 640 };
  const paper = api.preparePlanLabelPaper(rows.map(row => ({ role: 'room', polygons: row.shape.polygons })));
  assert.equal(api.planRoomLabelFits(selected, labelFrame, counts), true, 'a spacious selected room can fold its tag above its count');
  const resolved = api.placePlanRoomLabels(rows, size, [], counts, labelFrame, paper);
  assert.deepEqual(resolved.map(row => [row.id, row.plan.mode]), [[selected.id, 'horizontal'], [plain.id, 'horizontal']]);
  assert.deepEqual(api.visibleLabelHits(resolved, size, [], counts), resolved);
  for (const row of resolved) {
    const own = api.countMarkerTarget(counts.find(count => count.occurrenceId === row.id)), source = rows.find(source => source.id === row.id);
    assert.equal(row.plan.box.b, own.t - 2);
    assert.deepEqual([row.anchorX, row.anchorY], [source.anchorX, source.anchorY]);
    assert.equal(row.plan.y, api.countClearedLabelY(source, counts));
    assert.deepEqual(api.planLabelObstacles(row)[0], row.plan.box);
  }
  const narrow = { ...labelInput('generated-counted-strip', labelRectangle(300, 240, 320, 360), 'Linen', 50, 'selected'), rise: 1 };
  const narrowCount = { key: `electrical:${narrow.id}`, occurrenceId: narrow.id, count: 2, x: narrow.anchorX, y: narrow.anchorY };
  assert.equal(api.planRoomLabelFits(narrow, labelFrame), true, 'the short name fits along this source strip without a badge');
  assert.equal(api.planRoomLabelFits(narrow, labelFrame, [narrowCount]), false, 'an owned badge occupies the rotated target at the fixed anchor');
  const [standing] = api.placePlanRoomLabels([narrow], size, [], [narrowCount], labelFrame,
    api.preparePlanLabelPaper([{ role: 'room', polygons: narrow.shape.polygons }]));
  assert.equal(standing.plan.mode, 'standing'); assert.equal(standing.plan.leader.dot, false);
  assert.equal(labelOverlap(standing.plan.box, api.countMarkerTarget(narrowCount)), false);
  assert.deepEqual(api.visibleLabelHits([standing], size, [], [narrowCount]), [standing]);
  assert.equal(JSON.stringify({ rows, counts }), before);
});
