// Healthy synthetic admission, frame, picking and standard GLB checks for the
// canonical model and geometry modules the unified Atlas draws with. Generated
// fixtures only; no network, storage, browser, GPU or native host is used.
//
// Selection: with no argument every check runs, unchanged. `--healthy` runs only
// the ordinary healthy cases; each rejection, malformed or mutated input,
// exclusion and aborted-signal control is wrapped in `held(...)` and skipped.
// Any other argument is refused, so a mistyped flag never runs held controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--healthy')) throw new Error(`Unknown argument; the only selection is --healthy: ${args.join(' ')}`);
const healthy = args.includes('--healthy');
/** Runs a held control only in the default full selection. */
const held = async control => { if (!healthy) await control(); };

const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, lang, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang, target: 'esnext', tsconfig: false, sourcemap: false, jsx: { runtime: 'automatic' } });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}
const frontend = new URL('../', import.meta.url);
const base = '../src/lantern/canonical-ifc/';
const modelURL = await sourceURL(`${base}model.ts`, 'ts');
const geometryURL = await sourceURL(`${base}geometry.ts`, 'ts');
const tonesURL = await sourceURL(`${base}tones.ts`, 'ts');
const fixturesURL = await sourceURL('./canonical-ifc-visual/synthetic-publication.ts', 'ts', { '../../src/lantern/canonical-ifc/model': modelURL });
const preflightURL = await sourceURL(`${base}glb-preflight.ts`, 'ts');
// The pinned three.js GLTFLoader, loaded from the installed package as a browser bundle would.
const threeURL = new URL('./node_modules/three/build/three.module.js', frontend).href;
const gltfLoaderURL = new URL('./node_modules/three/examples/jsm/loaders/GLTFLoader.js', frontend).href;
const standardURL = await sourceURL(`${base}standard-glb.ts`, 'ts', { three: threeURL, 'three/examples/jsm/loaders/GLTFLoader.js': gltfLoaderURL,
  './geometry': geometryURL, './glb-preflight': preflightURL });
const sampleURL = await sourceURL('./canonical-ifc-visual/standard-glb-sample.ts', 'ts');

const { admitPresentation, PresentationError, isDuplicateLabel, isSyntheticSource, selectionLabel } = await import(modelURL);
const { makeProjection, drawnBounds, floorPlanRings, prepareMeshes, pick, planPick, labelPoint, LABEL_WORK, pointInShape, relativePath,
  visibleFloorIds, occurrenceTops, sourceMeshColor } = await import(geometryURL);
const { badgeFill, contrast, TONE_COLOR } = await import(tonesURL);
const { GlbFormatError } = await import(preflightURL);
const { loadStandardGlb } = await import(standardURL);
const { buildGlb, box, SAMPLE_HOUSE, SAMPLE_HOUSE_BOUNDS, SAMPLE_REFERENCE, SAMPLE_REFERENCE_BOUNDS } = await import(sampleURL);
const { publicationA, publicationB, generatedCoverage } = await import(fixturesURL);

const A = admitPresentation(publicationA()), B = admitPresentation(publicationB()), C = admitPresentation(generatedCoverage());
const roomByLabel = (model, label) => model.source.rooms.filter(room => room.label === label);
const only = room => { assert.equal(room.occurrences.length, 1); return room.occurrences[0].spaceOccurrenceId; };
const kitchen = roomByLabel(A, 'Kitchen')[0];
const kitchenOcc = only(kitchen);
const budget = () => ({ remaining: LABEL_WORK });
const preparedOf = model => prepareMeshes(model.source.meshes, mesh => model.meshOccurrence.get(mesh.meshKey) ?? null);

// Admission: explicit links survive; unlinked geometry stays display-only.
assert.equal(A.issues.planFeaturesDemoted, 0);
assert.equal(A.issues.meshBindingsDemoted, 0);
assert.equal(A.issues.occurrencesWithoutPlanShape, 1, 'Cellar has no plan shape');
assert.ok(A.issues.displayOnlyMeshes > 0, 'Slab and walls are display-only');
assert.equal(A.occurrenceMeshes.get(kitchenOcc).length, 1);
assert.equal(A.issues.overlayLayersWithheld, 1, 'An overlay pinned to another publication is withheld');
assert.equal(C.issues.occurrencesWithUnknownFloor, 1, 'Loft keeps an explicit unknown floor');
const boxOcc = only(roomByLabel(C, 'Box room')[0]);
assert.ok(C.planShapes.has(boxOcc) && !C.occurrenceMeshes.has(boxOcc), 'Box room is plan-only');
assert.equal(selectionLabel(A.source), 'Mock selection', 'A synthetic snapshot never claims native publication');
assert.equal(selectionLabel(B.source), 'Preview');
assert.ok(isSyntheticSource(A.source));


// Duplicate labels never merge identities.
const bedrooms = roomByLabel(C, 'Bedroom');
assert.equal(bedrooms.length, 2);
assert.notEqual(bedrooms[0].roomId, bedrooms[1].roomId);


// One logical room, two floor-qualified occurrences with distinct opaque IDs.
const [groundC, upperC] = C.source.floors.map(floor => floor.floorId);
const stair = C.source.rooms.find(room => room.label === 'Stair hall' && room.occurrences.length === 2);
assert.ok(stair, 'Coverage stair hall spans two floors');
const stairGround = stair.occurrences.find(row => row.floorId === groundC).spaceOccurrenceId;
const stairUpper = stair.occurrences.find(row => row.floorId === upperC).spaceOccurrenceId;
assert.notEqual(stairGround, stairUpper);
assert.ok(!isDuplicateLabel(C, stair), 'Occurrences of one room are not duplicate labels');

for (const tone of Object.keys(TONE_COLOR)) assert.ok(contrast(badgeFill(tone), '#FFFFFF') >= 4.5, `${tone} badge text contrast`);

// One shared frame: no per-floor centring, scaling or spacing.
const meshesC = preparedOf(C), bounds = drawnBounds(meshesC, floorPlanRings(C, null), null), viewport = { width: 1000, height: 700 };
const planView = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 1);
const g = planView.project(2, 0, 3), u = planView.project(2, 2.9, 3);
assert.ok(Math.abs(g[0] - u[0]) < 1e-9 && Math.abs(g[1] - u[1]) < 1e-9, 'Equal x/z coincide in plan on every floor');
const view3d = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 0);
assert.ok(view3d.project(2, 2.9, 3)[1] < view3d.project(2, 0, 3)[1], 'Upper geometry sits above lower in 3D');
assert.deepEqual([...visibleFloorIds(C, groundC)], [groundC]);
assert.deepEqual(new Set(visibleFloorIds(C, upperC)), new Set([upperC, groundC]));
const groundA = A.source.floors[0].floorId;
assert.equal(A.source.registration.kind, 'isolated-floors');
assert.deepEqual([...visibleFloorIds(A, groundA)], [groundA], 'Isolated floors are never stacked');

// Plan and 3D picking resolve the same occurrence through explicit geometry.
const meshesA = preparedOf(A), boundsA = drawnBounds(meshesA, floorPlanRings(A, groundA), groundA);
const point = labelPoint(A.planShapes.get(kitchenOcc), budget());
assert.ok(pointInShape(point.x, point.z, A.planShapes.get(kitchenOcc)));
const planA = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, boundsA, viewport, 1);
const [px, py] = planA.project(point.x, 0, point.z);
assert.equal(planPick(A, groundA, 0, planA, px, py), kitchenOcc);
const rules = { visibleFloors: visibleFloorIds(A, groundA), clipY: 1.2 };
const threeA = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, boundsA, viewport, 0);
const [qx, qy] = threeA.project(point.x, occurrenceTops(meshesA).get(kitchenOcc), point.z);
assert.equal(pick(meshesA, threeA, rules, qx, qy).occurrenceId, kitchenOcc);
const [wx, wy] = threeA.project(5.6, 1.0, 3.5);
assert.equal(pick(meshesA, threeA, rules, wx, wy).kind, 'display-only', 'A wall is display-only');
assert.equal(pick(meshesA, threeA, rules, 2, 2).kind, 'none');
const boxPoint = labelPoint(C.planShapes.get(boxOcc), budget());
const threeC = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 0);
const [bx, by] = threeC.project(boxPoint.x, 2.92, boxPoint.z);
assert.equal(pick(meshesC, threeC, { visibleFloors: visibleFloorIds(C, upperC), clipY: 2.9 + 1.2 }, bx, by).kind, 'display-only', 'An unmapped room mesh selects no room');

// Unverifiable links are demoted to display-only; ambiguous identity is refused.
await held(() => {
  const source = publicationA();
  const unlinked = admitPresentation({ ...source, meshes: source.meshes.map(mesh => mesh.occurrenceId === kitchenOcc ? { ...mesh, floorId: null } : mesh) });
  assert.equal(unlinked.issues.meshBindingsDemoted, 1);
  assert.ok(!unlinked.occurrenceMeshes.has(kitchenOcc));
  assert.throws(() => admitPresentation({ ...source, rooms: [...source.rooms, { ...source.rooms[0], label: 'Copy' }] }), PresentationError);
  const living = source.rooms.find(room => room.label === 'Living room');
  assert.throws(() => admitPresentation({ ...source, rooms: source.rooms.map(room => room === living
    ? { ...room, occurrences: [{ ...room.occurrences[0], spaceOccurrenceId: kitchenOcc }] } : room) }), PresentationError,
  'One occurrence token in two rooms is refused');
  const coverage = generatedCoverage();
  assert.throws(() => admitPresentation({ ...coverage, rooms: coverage.rooms.map(room => room.roomId === stair.roomId
    ? { ...room, occurrences: room.occurrences.map(row => ({ ...row, spaceOccurrenceId: stairGround })) } : room) }), PresentationError,
  'A repeated token on two floors cannot silently choose one floor');
});

// Precision: far-from-origin geometry projects relative to its own centre.
const shift = 1000;
const translate = presentation => ({ ...presentation,
  floors: presentation.floors.map(floor => ({ ...floor, plan: floor.plan && { features: floor.plan.features.map(feature =>
    ({ ...feature, rings: feature.rings.map(ring => ring.map(([x, z]) => [x + shift, z + shift])) })) } })),
  meshes: presentation.meshes.map(mesh => ({ ...mesh, positions: mesh.positions.map((value, i) => i % 3 === 1 ? value : value + shift) })) });
const far = admitPresentation(translate(publicationA()));
const meshesFar = preparedOf(far), boundsFar = drawnBounds(meshesFar, floorPlanRings(far, groundA), groundA);
const planFar = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, boundsFar, viewport, 1);
const farPoint = labelPoint(far.planShapes.get(kitchenOcc), budget());
const [fx, fy] = planFar.project(farPoint.x, 0, farPoint.z);
assert.ok(Math.abs(fx - (point.x + shift - planFar.center[0]) * planFar.k - planFar.ox) < 1e-3);
assert.ok(Math.abs(fx - px) < 1e-2 && Math.abs(fy - py) < 1e-2, 'Translation does not move the projected room');
assert.equal(planPick(far, groundA, 0, planFar, fx, fy), kitchenOcc);
const farPath = relativePath(far.planShapes.get(kitchenOcc)[0], planFar.center);
assert.ok(farPath.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).every(value => Math.abs(Number(value)) < 20), 'SVG path coordinates stay relative');
const threeFar = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, boundsFar, viewport, 0);
const [tx, ty] = threeFar.project(farPoint.x, occurrenceTops(meshesFar).get(kitchenOcc), farPoint.z);
assert.equal(pick(meshesFar, threeFar, rules, tx, ty).occurrenceId, kitchenOcc);

// Precision: one occurrence may own several features (union), each with holes.
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const shape = [[square(0, 0, 4, 4), square(1, 1, 3, 3)], [square(6, 0, 8, 2)], [square(1.5, 1.5, 2.5, 2.5)]];
assert.ok(pointInShape(0.5, 0.5, shape), 'Inside the outer ring');
assert.ok(!pointInShape(1.2, 1.2, shape), 'A hole is empty');
assert.ok(pointInShape(2, 2, shape), 'An overlapping feature fills part of the hole');
assert.ok(pointInShape(7, 1, shape), 'A separate feature belongs to the same occurrence');
assert.ok(!pointInShape(5, 1, shape));
const union = labelPoint(shape, budget());
assert.ok(union && pointInShape(union.x, union.z, shape), 'Label stays inside the union');
const twoFeatures = publicationA();
const kitchenFloor = twoFeatures.floors[0];
const split = admitPresentation({ ...twoFeatures, floors: [{ ...kitchenFloor, plan: { features: [...kitchenFloor.plan.features,
  { occurrenceId: kitchenOcc, role: 'space', rings: [square(20, 0, 22, 2), square(20.5, 0.5, 21.5, 1.5)] }] } }, ...twoFeatures.floors.slice(1)] });
assert.equal(split.planShapes.get(kitchenOcc).length, 2);
assert.ok(pointInShape(20.2, 1, split.planShapes.get(kitchenOcc)) && !pointInShape(21, 1, split.planShapes.get(kitchenOcc)));

// Precision: unused vertices never extend drawn bounds or floor ranges.
await held(() => {
  const stray = publicationA();
  const padded = admitPresentation({ ...stray, meshes: stray.meshes.map(mesh => mesh.occurrenceId === kitchenOcc
    ? { ...mesh, positions: Float32Array.from([...mesh.positions, 500, 50, -500]) } : mesh) });
  assert.deepEqual(padded.floorFacts.get(groundA).yRange, A.floorFacts.get(groundA).yRange);
  const paddedKitchen = preparedOf(padded).find(mesh => mesh.occurrenceId === kitchenOcc);
  assert.ok(paddedKitchen.bounds.max[0] < 100 && paddedKitchen.yRange[1] < 1 && paddedKitchen.bounds.min[2] > -100);
  assert.deepEqual(drawnBounds(preparedOf(padded), floorPlanRings(padded, groundA), groundA), boundsA);
});

// Standard GLB, loaded by the pinned three.js GLTFLoader. Generated anonymous sample only.
const live = () => new AbortController().signal;
const flat = bounds => [...bounds.min, ...bounds.max];
const houseGlb = buildGlb(SAMPLE_HOUSE), referenceGlb = buildGlb(SAMPLE_REFERENCE);
const house = await loadStandardGlb(houseGlb, 'house', live()), reference = await loadStandardGlb(referenceGlb, 'reference', live());
assert.deepEqual(flat(drawnBounds(house.meshes, [], null)), SAMPLE_HOUSE_BOUNDS.flat(),
  'Baked poses are drawn as stored: provenance matrices are not applied and the unused far vertex does not frame the model');
assert.equal(house.counts.declaredTransforms, 0);
assert.deepEqual(house.drawn.map(item => item.nodeIndex), [1, 2, 3]);
assert.equal(house.counts.triangles, 36);
assert.equal(house.counts.metadataOnlyNodes, 3, 'Group, room occurrence and product without geometry stay as metadata-only nodes');
assert.deepEqual(house.nodes.find(node => node.nodeIndex === 4).extras, SAMPLE_HOUSE.nodes[4].extras, 'Opaque extras are kept unchanged');
assert.ok([...house.meshes, ...reference.meshes].every(mesh => mesh.floorId === null && mesh.occurrenceId === null),
  'Standard meshes stay unbound: no floor, room or occurrence is inferred from names, extras or tree order');
assert.deepEqual(flat(drawnBounds(reference.meshes, [], null)), SAMPLE_REFERENCE_BOUNDS.flat().map(Math.fround), 'GLB positions are float32 as stored');
assert.equal(reference.copyright, SAMPLE_REFERENCE.asset.copyright, 'Reference attribution is preserved');
assert.ok(reference.meshes.every(mesh => mesh.meshKey.startsWith('reference#')));

// A glTF-declared node transform is the scene itself and is applied exactly once.
const posed = await loadStandardGlb(buildGlb({ meshes: [box([0, 0, 0], [1, 1, 1])], roots: [0],
  nodes: [{ translation: [10, 0, 0], children: [1], extras: { posesAlreadyApplied: true } }, { mesh: 0, translation: [0, 2, 0] }] }), 'house', live());
assert.deepEqual(flat(posed.meshes[0].bounds), [10, 2, 0, 11, 3, 1]);
assert.equal(posed.counts.declaredTransforms, 2);
await held(() => assert.rejects(loadStandardGlb(houseGlb, 'house', AbortSignal.abort()), { name: 'AbortError' }));

// Extras stay opaque: a loader-specific key such as pivot never moves geometry; core transforms still apply once.
const pivotExtras = { posesAlreadyApplied: true, pivot: [5, 0, 0] };
const pivoted = await loadStandardGlb(buildGlb({ meshes: [box([0, 0, 0], [1, 1, 1])], roots: [0],
  nodes: [{ translation: [10, 0, 0], children: [1], extras: pivotExtras }, { mesh: 0, translation: [0, 2, 0] }] }), 'house', live());
assert.deepEqual(flat(pivoted.meshes[0].bounds), [10, 2, 0, 11, 3, 1]);
assert.deepEqual(pivoted.nodes[0].extras, pivotExtras, 'The original extras are kept as facts');

// One mesh used by three nodes is three drawn instances, counted in the admitted work before loading.
const reused = await loadStandardGlb(buildGlb({ meshes: [box([0, 0, 0], [1, 1, 1])], roots: [0, 1, 2],
  nodes: [{ mesh: 0 }, { mesh: 0, translation: [2, 0, 0] }, { mesh: 0, translation: [4, 0, 0] }] }), 'house', live());
assert.deepEqual(reused.drawn.map(item => [item.nodeIndex, item.meshIndex]), [[0, 0], [1, 0], [2, 0]]);
assert.deepEqual(reused.work, { instances: 3, vertices: 24, triangles: 36, outputBytes: 24 * 12 + 108 * 4 + 36 * 72 });
assert.equal(reused.counts.triangles, 36);
assert.deepEqual(reused.meshes.map(mesh => mesh.bounds.min[0]), [0, 2, 4]);

// Valid opaque core materials on a multi-primitive mesh reused by two nodes.
// The factors are linear source metadata, independent of names and geometry;
// a material without an explicit factor retains the viewer's palette fallback.
const sourceFactors = [[.25, .5, .75, 1], [.625, .125, .375, 1]];
const materialSample = withFactors => buildGlb({
  meshes: [box([0, 0, 0], [1, 1, 1]), box([0, 1, 0], [1, 2, 1]), box([0, 0, 2], [1, 1, 3])],
  roots: [0, 1, 2], nodes: [{ name: 'Shared source', mesh: 0 },
    { name: 'Shared source again', mesh: 0, translation: [4, 0, 0] }, { name: 'Palette fallback', mesh: 1 }],
  patch: json => {
    const [first, second, fallback] = json.meshes;
    json.meshes = [{ primitives: [{ ...first.primitives[0], material: 1 }, { ...second.primitives[0], material: 0 }] },
      { primitives: [{ ...fallback.primitives[0], material: 2 }] }];
    json.materials = [...sourceFactors.map(factor => ({ pbrMetallicRoughness: {
      ...(withFactors ? { baseColorFactor: factor } : {}), metallicFactor: 0, roughnessFactor: 1 } })),
      { pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }];
  },
});
const materialBytes = materialSample(true), materialBytesBefore = materialBytes.slice();
const materialLoaded = await loadStandardGlb(materialBytes, 'source-colours', live());
const paletteLoaded = await loadStandardGlb(materialSample(false), 'source-colours', live());
assert.deepEqual(materialLoaded.drawn.map(({ nodeIndex, meshIndex, primitiveIndex }) => [nodeIndex, meshIndex, primitiveIndex]),
  [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [2, 1, 0]], 'material lookup follows exact primitive selectors across reused nodes');
assert.deepEqual(materialLoaded.meshes.map(mesh => mesh.sourceBaseColor),
  [sourceFactors[1], sourceFactors[0], sourceFactors[1], sourceFactors[0], undefined]);
assert.deepEqual(materialLoaded.drawn, paletteLoaded.drawn);
assert.deepEqual(materialLoaded.counts, paletteLoaded.counts);
assert.deepEqual(materialLoaded.work, paletteLoaded.work);
assert.equal(materialLoaded.counts.triangles, 60);
const sourceState = { enabled: true, selected: false, reference: false,
  selectedOccurrenceId: null, contextOccurrenceIds: [], tints: new Map() };
materialLoaded.meshes.forEach((mesh, at) => {
  const plain = paletteLoaded.meshes[at];
  assert.deepEqual(mesh.vertices, plain.vertices, 'source colours never alter positions or normals');
  assert.deepEqual(mesh.bounds, plain.bounds); assert.deepEqual(mesh.yRange, plain.yRange);
  assert.equal(mesh.triangles, plain.triangles); assert.equal(mesh.vertices.byteLength, mesh.triangles * 72);
  assert.equal(mesh.floorId, null); assert.equal(mesh.occurrenceId, null);
  assert.equal(plain.sourceBaseColor, undefined, 'no loader-default white is manufactured');
  if (mesh.sourceBaseColor) assert.equal(Object.isFrozen(mesh.sourceBaseColor), true, 'source factors remain immutable');
  assert.equal(sourceMeshColor(mesh, sourceState), mesh.sourceBaseColor, 'the production renderer resolver returns the linear source factor');
  assert.equal(sourceMeshColor(mesh, { ...sourceState, enabled: false }), undefined, 'other viewers can retain their palette');
  assert.equal(sourceMeshColor(mesh, { ...sourceState, enabled: undefined }), undefined);
  assert.equal(sourceMeshColor(mesh, { ...sourceState, selected: true }), undefined);
  assert.equal(sourceMeshColor(mesh, { ...sourceState, reference: true }), undefined);
});
assert.deepEqual(materialBytes, materialBytesBefore, 'loading and colour routing preserve the original generated bytes');


// Closed-preflight refusals stay explicit and name their stage.
await held(async () => {
  const because = (spec, reason) => assert.rejects(loadStandardGlb(buildGlb({ ...SAMPLE_HOUSE, ...spec }), 'house', live()),
    error => error instanceof GlbFormatError && error.stage === 'preflight' && reason.test(error.message));
  const patched = patch => ({ patch });
  await because(patched(json => { json.buffers[0].uri = 'house.bin'; }), /External or data URI buffers/);
  await because(patched(json => { json.extensionsUsed = ['KHR_draco_mesh_compression']; }), /unsupported glTF extension/);
  await because(patched(json => { json.scenes.push({ nodes: [] }); }), /Exactly one scene/);
  await because(patched(json => { json.materials = [{ extensions: { KHR_materials_unlit: {} } }]; }), /unsupported glTF extension/);
  await because(patched(json => { delete json.accessors[0].bufferView; }), /Accessor 0 buffer view/);
  await because(patched(json => { json.accessors[0].count += 1; }), /Accessor 0 reads past/);
  await because(patched(json => { json.accessors[1].normalized = true; }), /Indices must be unnormalized/);
});

console.log(healthy
  ? 'PASS --healthy canonical geometry: healthy synthetic cases only (admission identity, one frame and picking, standard GLB loads and source colours). Held rejection, mutated-input and aborted-signal controls were not run.'
  : 'PASS canonical geometry keeps stable occurrence identity and one frame per registration across plan and 3D; standard GLB loads keep baked poses, opaque extras, admitted instance work, source colours and explicit preflight refusals.');
