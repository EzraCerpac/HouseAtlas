// Healthy synthetic identity, persistence, frame, picking and v2 scene checks
// for the canonical model viewer. Generated fixtures and the checked-in public
// two-floor-v2 snapshot only, served through an owned in-process fake port; no
// network, storage, browser, GPU or native host is used.
//
// Selection: with no argument every check runs, unchanged. `--healthy` runs only
// the ordinary healthy cases; each rejection, malformed or mutated input,
// exclusion and aborted-signal control is wrapped in `held(...)` and skipped.
// Any other argument is refused, so a mistyped flag never runs held controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
const jsx = new URL('./node_modules/react/jsx-runtime.js', frontend).href;
const react = new URL('./node_modules/react/index.js', frontend).href;
const base = '../src/lantern/canonical-ifc/';
const decimalURL = await sourceURL('../src/numeric/decimal.ts', 'ts');
const glbProfileURL = await sourceURL('../src/lantern/scans/ifc-glb-profile.ts', 'ts', { '../../numeric/decimal': decimalURL });
const yieldURL = await sourceURL('../src/lantern/scans/presentation/yield-task.ts', 'ts');
const meshProfileURL = await sourceURL('../src/lantern/scans/mesh-profile.ts', 'ts',
  { './presentation/yield-task': yieldURL, '../../numeric/decimal': decimalURL, './ifc-glb-profile': glbProfileURL });
const modelURL = await sourceURL(`${base}model.ts`, 'ts');
const selectionURL = await sourceURL(`${base}selection.ts`, 'ts', { './model': modelURL });
const geometryURL = await sourceURL(`${base}geometry.ts`, 'ts');
const overlaysURL = await sourceURL(`${base}overlays.ts`, 'ts');
const tonesURL = await sourceURL(`${base}tones.ts`, 'ts');
const staleRetryURL = await sourceURL(`${base}stale-retry.ts`, 'ts');
const adapterURL = await sourceURL(`${base}adapter.ts`, 'ts', { '../../numeric/decimal': decimalURL,
  '../scans/ifc-glb-profile': glbProfileURL, '../scans/mesh-profile': meshProfileURL, './model': modelURL });
const fixturesURL = await sourceURL('./canonical-ifc-visual/synthetic-publication.ts', 'ts', { '../../src/lantern/canonical-ifc/model': modelURL });
const iconURL = await sourceURL('../src/lantern/components/Icon.tsx', 'tsx', { 'react/jsx-runtime': jsx });
const cameraURL = await sourceURL('../src/lantern/atlas/useCamera.ts', 'ts', { react });
const pointersURL = await sourceURL(`${base}stage-pointers.ts`, 'ts');
const trackpadURL = await sourceURL(`${base}trackpad-gesture.ts`, 'ts');
const stageCameraURL = await sourceURL(`${base}useStageCamera.ts`, 'ts', { react, '../atlas/useCamera': cameraURL,
  './stage-pointers': pointersURL, './trackpad-gesture': trackpadURL });
const meshLayerURL = await sourceURL(`${base}MeshLayer.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx, './geometry': geometryURL });
const stageURL = await sourceURL(`${base}ModelStage.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx, '../components/Icon': iconURL,
  './geometry': geometryURL, './selection': selectionURL, './MeshLayer': meshLayerURL, './tones': tonesURL, './useStageCamera': stageCameraURL });
const preflightURL = await sourceURL(`${base}glb-preflight.ts`, 'ts');
const manifestURL = await sourceURL(`${base}browser-manifest.ts`, 'ts');
// The pinned three.js GLTFLoader, loaded from the installed package as a browser bundle would.
const threeURL = new URL('./node_modules/three/build/three.module.js', frontend).href;
const gltfLoaderURL = new URL('./node_modules/three/examples/jsm/loaders/GLTFLoader.js', frontend).href;
const standardURL = await sourceURL(`${base}standard-glb.ts`, 'ts', { three: threeURL, 'three/examples/jsm/loaders/GLTFLoader.js': gltfLoaderURL,
  './geometry': geometryURL, './glb-preflight': preflightURL });
const sampleURL = await sourceURL('./canonical-ifc-visual/standard-glb-sample.ts', 'ts');
// The rest of LocalGlbPreview's actual eager import graph: site budget, stage timing, model navigator and the
// electrical review owners. Stylesheets are inert in Node; SourcePdf's lazy PDF viewer is never rendered here.
const inertCss = 'data:text/javascript,';
const siteBudgetURL = await sourceURL('../src/lantern/site-artifacts/site-budget.ts', 'ts');
const stageTimingURL = await sourceURL('../src/lantern/observability/stage-timing.ts', 'ts');
const navigatorURL = await sourceURL(`${base}ModelNavigator.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx });
const electricalBase = '../src/lantern/electrical-documentary/';
const localSourceReaderURL = await sourceURL(`${electricalBase}local-source-reader.ts`, 'ts');
const sourceFocusURL = await sourceURL(`${electricalBase}source-focus.ts`, 'ts');
const rendererOwnerURL = await sourceURL(`${electricalBase}renderer-owner.ts`, 'ts');
const seenLedgerURL = await sourceURL(`${electricalBase}seen-ledger.ts`, 'ts');
const reviewURL = await sourceURL(`${electricalBase}useElectricalReview.ts`, 'ts', { react, './local-source-reader': localSourceReaderURL,
  './renderer-owner': rendererOwnerURL, './seen-ledger': seenLedgerURL });
const boundaryURL = await sourceURL('../src/lantern/components/OptionalViewerBoundary.tsx', 'tsx',
  { react, 'react/jsx-runtime': jsx, './optional-viewer.css': inertCss });
const sourcePdfURL = await sourceURL('../src/lantern/source-documents/SourcePdf.tsx', 'tsx',
  { react, 'react/jsx-runtime': jsx, '../components/OptionalViewerBoundary': boundaryURL });
const sourceViewURL = await sourceURL(`${electricalBase}LocalSourceView.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx,
  '../source-documents/SourcePdf': sourcePdfURL, './local-source-reader': localSourceReaderURL, './source-focus': sourceFocusURL,
  './electrical-documentary.css': inertCss });
const panelURL = await sourceURL(`${electricalBase}ElectricalDocumentaryPanel.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx,
  '../observability/stage-timing': stageTimingURL, './source-focus': sourceFocusURL, './LocalSourceView': sourceViewURL });
const reviewSectionURL = await sourceURL(`${electricalBase}ElectricalReviewSection.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx,
  './ElectricalDocumentaryPanel': panelURL, './source-focus': sourceFocusURL, './electrical-documentary.css': inertCss });
const localURL = await sourceURL(`${base}LocalGlbPreview.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx, '../components/Icon': iconURL,
  '../scans/ifc-glb-profile': glbProfileURL, '../scans/mesh-profile': meshProfileURL, './browser-manifest': manifestURL, './geometry': geometryURL,
  './glb-preflight': preflightURL, './MeshLayer': meshLayerURL, './standard-glb': standardURL, './useStageCamera': stageCameraURL,
  '../site-artifacts/site-budget': siteBudgetURL, '../observability/stage-timing': stageTimingURL, './ModelNavigator': navigatorURL,
  '../electrical-documentary/ElectricalReviewSection': reviewSectionURL, '../electrical-documentary/LocalSourceView': sourceViewURL,
  '../electrical-documentary/useElectricalReview': reviewURL, './canonical-ifc.css': inertCss });

const { admitPresentation, PresentationError, isDuplicateLabel, isSyntheticSource, selectionLabel } = await import(modelURL);
const { reconcile, viewerReducer, encodeMemory, decodeMemory, initialState, contextOccurrences, scopedMemoryKey, memoryKey } = await import(selectionURL);
const { makeProjection, drawnBounds, floorPlanRings, prepareMeshes, pick, planPick, labelPoint, LABEL_WORK, pointInShape, relativePath,
  visibleFloorIds, occurrenceTops } = await import(geometryURL);
const { joinOverlay } = await import(overlaysURL);
const { badgeFill, contrast, TONE_COLOR } = await import(tonesURL);
const { readCanonicalSceneV2, ADAPTER_ID } = await import(adapterURL);
const { retriesFor, takeRetry, MAX_STALE_RETRIES } = await import(staleRetryURL);
const { readLocalGlb, readLocalFiles, LocalReadError } = await import(localURL);
const { loadStandardGlb } = await import(standardURL);
const { navigationIndex } = await import(navigatorURL);
const { buildGlb, box, SAMPLE_HOUSE, SAMPLE_HOUSE_BOUNDS, SAMPLE_REFERENCE, SAMPLE_REFERENCE_BOUNDS, sampleManifest } = await import(sampleURL);
const { publicationA, publicationB, generatedCoverage } = await import(fixturesURL);

const A = admitPresentation(publicationA()), B = admitPresentation(publicationB()), C = admitPresentation(generatedCoverage());
const roomByLabel = (model, label) => model.source.rooms.filter(room => room.label === label);
const only = room => { assert.equal(room.occurrences.length, 1); return room.occurrences[0].spaceOccurrenceId; };
const kitchen = roomByLabel(A, 'Kitchen')[0], dining = roomByLabel(A, 'Dining room')[0];
const kitchenOcc = only(kitchen), diningOcc = only(dining);
const budget = () => ({ remaining: LABEL_WORK });
const preparedOf = model => prepareMeshes(model.source.meshes, mesh => model.meshOccurrence.get(mesh.meshKey) ?? null);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
assert.ok(bedrooms.every(room => isDuplicateLabel(C, room)));
const second = reconcile(C, { v: 2, publicationId: C.source.publication.publicationId, roomId: bedrooms[1].roomId,
  occurrenceId: only(bedrooms[1]), floorId: null, view: '3d', overlayId: null });
assert.equal(second.state.occurrenceId, only(bedrooms[1]), 'The second Bedroom restores by ID, not label');

// One logical room, two floor-qualified occurrences with distinct opaque IDs.
const [groundC, upperC] = C.source.floors.map(floor => floor.floorId);
const stair = C.source.rooms.find(room => room.label === 'Stair hall' && room.occurrences.length === 2);
assert.ok(stair, 'Coverage stair hall spans two floors');
const stairGround = stair.occurrences.find(row => row.floorId === groundC).spaceOccurrenceId;
const stairUpper = stair.occurrences.find(row => row.floorId === upperC).spaceOccurrenceId;
assert.notEqual(stairGround, stairUpper);
assert.ok(!isDuplicateLabel(C, stair), 'Occurrences of one room are not duplicate labels');
assert.ok(C.occurrenceMeshes.has(stairUpper) && C.planShapes.has(stairUpper) && C.planShapes.has(stairGround));
const stairState = viewerReducer(C, initialState(C), { type: 'selectOccurrence', occurrenceId: stairUpper });
assert.equal(stairState.floorId, upperC);
assert.deepEqual(contextOccurrences(C, stairState, groundC), [stairGround], 'The other occurrence is context on its own floor');
assert.deepEqual(contextOccurrences(C, stairState, upperC), []);
const stairBack = reconcile(C, decodeMemory(encodeMemory(C, stairState)));
assert.equal(stairBack.state.occurrenceId, stairUpper, 'The upper occurrence restores, not the first of the room');
assert.equal(stairBack.state.floorId, upperC);
assert.equal(JSON.parse(encodeMemory(C, stairState)).roomId, stair.roomId);

// Memory holds the publication pin and IDs only.
const selected = viewerReducer(A, { ...initialState(A), overlayId: A.overlays[0].id }, { type: 'selectOccurrence', occurrenceId: kitchenOcc });
const text = encodeMemory(A, selected), record = decodeMemory(text);
assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['floorId', 'occurrenceId', 'overlayId', 'publicationId', 'roomId', 'v', 'view']);
assert.ok(!text.includes('Kitchen'), 'No label is persisted');
await held(() => {
  assert.equal(decodeMemory(text.replace('"v":2', '"v":1')), null, 'Older records are ignored, not partially trusted');
  assert.equal(decodeMemory(JSON.stringify({ ...JSON.parse(text), label: 'Kitchen' })), null);
});
const restored = reconcile(A, record);
assert.deepEqual(restored.state, selected, 'Same publication restores occurrence, floor, view and overlay');
assert.equal(restored.notice, null);
const scopeOne = { workspaceId: 'w1', homeId: 'h1' }, scopeTwo = { workspaceId: 'w2', homeId: 'h1' };
assert.notEqual(scopedMemoryKey(scopeOne, 'b1'), scopedMemoryKey(scopeTwo, 'b1'), 'Memory is scoped by workspace');
assert.notEqual(scopedMemoryKey(scopeOne, 'b1'), scopedMemoryKey(scopeOne, 'b2'), 'Memory is scoped by building');
assert.notEqual(scopedMemoryKey(null, 'b1'), scopedMemoryKey(scopeOne, 'b1'));

// New publication: carry only the identical (roomId, occurrence) pair; the renamed label is shown.
const carried = reconcile(B, record);
assert.equal(carried.state.occurrenceId, kitchenOcc);
assert.equal(carried.state.publicationId, B.source.publication.publicationId);
assert.notEqual(B.source.publication.publicationId, A.source.publication.publicationId);
assert.equal(B.roomsById.get(kitchen.roomId).label, 'Kitchen and dining');
assert.deepEqual(carried.notice, { kind: 'carried', fromPublicationId: A.source.publication.publicationId });
assert.equal(carried.state.overlayId, null, 'Overlay layer IDs of another publication are not carried');
const absent = reconcile(B, decodeMemory(encodeMemory(A, viewerReducer(A, initialState(A), { type: 'selectOccurrence', occurrenceId: diningOcc }))));
assert.equal(absent.state.occurrenceId, null, 'A removed room is not revived');
assert.equal(absent.notice.kind, 'room-absent');
const gardenRoom = roomByLabel(B, 'Garden room')[0];
assert.notEqual(gardenRoom.roomId, dining.roomId, 'The room occupying the same area has a new identity');
await held(() => {
  const moved = reconcile(B, { ...record, roomId: gardenRoom.roomId });
  assert.equal(moved.state.occurrenceId, null, 'An occurrence under another room is not carried');
});

// Selection identity stays separate from the visible floor and the view.
let state = viewerReducer(C, initialState(C), { type: 'selectOccurrence', occurrenceId: only(bedrooms[0]) });
assert.equal(state.floorId, upperC, 'Selecting reveals the explicitly linked floor');
for (const action of [{ type: 'showFloor', floorId: groundC }, { type: 'view', view: '3d' }, { type: 'view', view: 'plan' }, { type: 'showFloor', floorId: upperC }])
  state = viewerReducer(C, state, action);
assert.equal(state.occurrenceId, only(bedrooms[0]), 'Floor and view navigation keep the selection');
assert.equal(state.publicationId, C.source.publication.publicationId);
const loft = roomByLabel(C, 'Loft')[0];
assert.equal(viewerReducer(C, state, { type: 'selectOccurrence', occurrenceId: only(loft) }).floorId, upperC, 'Unknown floor keeps the current floor');

// Overlays join by reviewed Atlas place only; unknown and null links stay unplaced.
const electrical = joinOverlay(A, A.overlays[0]);
assert.equal(electrical.byRoom.get(kitchen.roomId).length, 2);
assert.deepEqual(electrical.unplaced.map(row => row.atlasPlaceId === null ? 'null' : 'absent').sort(), ['absent', 'null']);
await held(() => assert.equal(joinOverlay(A, A.source.overlays.find(layer => layer.publicationId !== A.source.publication.publicationId)), null));
// Distinct reviewed places join to the same rooms whatever the room order.
const sourceA = publicationA(), reversedA = admitPresentation({ ...sourceA, rooms: [...sourceA.rooms].reverse() });
const joined = join => new Map([...join.byRoom].map(([roomId, rows]) => [roomId, rows.map(row => row.id)]));
const reversedJoin = joinOverlay(reversedA, reversedA.overlays[0]);
assert.deepEqual(joined(reversedJoin), joined(electrical));
assert.deepEqual(reversedJoin.unplaced.map(row => row.id), electrical.unplaced.map(row => row.id));
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

// Static markup: pressed state, identity attributes and synchronized selection.
const { ModelStage } = await import(stageURL);
const shared = budget(), labelPoints = new Map([...A.planShapes].map(([id, rings]) => [id, labelPoint(rings, shared)]));
const stageMarkup = (model, meshes, points, stageState) => renderToStaticMarkup(createElement(ModelStage, { model, meshes, labelPoints: points,
  state: stageState, dispatch() {}, overlay: null, tints: new Map(), reduced: true, status: null, viewport: { current: null } }));
const kitchenState = view => ({ ...viewerReducer(A, initialState(A), { type: 'selectOccurrence', occurrenceId: kitchenOcc }), view });
const planMarkup = stageMarkup(A, meshesA, labelPoints, kitchenState('plan'));
const spaceIds = [...planMarkup.matchAll(/data-space-occurrence-id="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(new Set(spaceIds), new Set([...A.planShapes.keys()]), 'Plan spaces carry their occurrence IDs');
const kitchenAttr = escape(`data-space-occurrence-id="${kitchenOcc}"`);
assert.match(planMarkup, new RegExp(`class="cifc-plan-space is-selected" ${kitchenAttr}|${kitchenAttr}[^>]*class="cifc-plan-space is-selected"`));
assert.match(planMarkup, /<button type="button" aria-pressed="true">Plan<\/button>/);
assert.match(planMarkup, /class="cifc-label is-selected"[^]*?>Kitchen</);
const threeMarkup = stageMarkup(A, meshesA, labelPoints, kitchenState('3d'));
assert.match(threeMarkup, /<button type="button" aria-pressed="true">3D<\/button>/);
assert.match(threeMarkup, /class="floor-btn is-current" aria-pressed="true"/);
const stairPoints = new Map([...C.planShapes].map(([id, rings]) => [id, labelPoint(rings, shared)]));
const stairMarkup = stageMarkup(C, meshesC, stairPoints, { ...stairState, floorId: groundC, view: 'plan' });
assert.match(stairMarkup, new RegExp(`${escape(`data-space-occurrence-id="${stairGround}"`)}[^>]*class="cifc-plan-space is-context"`),
  'The other occurrence of the selected room is context on the ground floor');

// Public two-floor-v2 snapshot through an owned fake port: exact hrefs, exact bytes.
const fixture = new URL('../../docs/canonical-ifc/fixtures/two-floor-v2/', import.meta.url);
const SCOPE = { workspaceId: 'eda986dc-80fc-584c-9350-ebcc4bd5d599', homeId: '5ac4b592-ed7c-5a17-a503-0eedb2477bb1',
  buildingId: 'ed098a05-48ae-5253-a1b8-214d4b82c8d6' };
const PUBLICATION_ID = '1f8e08c7-366b-559d-81f7-cff3fe5e71a2';
const GROUND = '2ff038c0-2e81-5cbe-95d4-59d3df81245a', UPPER = 'ed6121fa-55c6-5ee1-9990-1285dccbc6af';
const PREFIX = `/api/atlas/ifc/v2/workspaces/${SCOPE.workspaceId}/homes/${SCOPE.homeId}/buildings/${SCOPE.buildingId}/publications/${PUBLICATION_ID}/`;
const bytesOf = relative => new Uint8Array(readFileSync(new URL(relative, fixture)));
const files = new Map([
  ['artifacts/semantics', 'publication/semantics.json'],
  ...[GROUND, UPPER].flatMap(floorId => [
    [`floors/${floorId}/artifacts/glb`, `publication/floors/${floorId}/model.glb`],
    [`floors/${floorId}/artifacts/floorplanFeatures`, `publication/floors/${floorId}/floorplan.json`],
    [`floors/${floorId}/artifacts/floorplan2d`, `publication/floors/${floorId}/floorplan.svg`]]),
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sceneBytes = bytesOf('scene-read.json'), scene = JSON.parse(Buffer.from(sceneBytes).toString('utf8'));
const request = { scope: SCOPE, publicationId: null, buildingLabel: 'Synthetic two-floor building' };
const reads = [];
const port = {
  transport: 'synthetic-fixture', owner: 'Synthetic fixture transport',
  async readScene(asked, signal) {
    signal.throwIfAborted();
    assert.deepEqual(asked, request);
    return sceneBytes;
  },
  async readArtifact(href, signal) {
    signal.throwIfAborted();
    const relative = href.startsWith(PREFIX) ? files.get(href.slice(PREFIX.length)) : undefined;
    if (!relative) throw new Error('Unknown fixture artifact');
    reads.push(href.slice(PREFIX.length));
    return bytesOf(relative);
  },
};
const reviewed = { id: 'synthetic-v2-electrical', publicationId: PUBLICATION_ID, label: 'Synthetic electrical', tone: 'electrical',
  owner: 'Synthetic circuit fixture', sourceDate: null, retrievedAt: '2026-10-15T00:00:00Z', freshness: 'current',
  records: [{ id: 'synthetic-v2-e1', label: 'Circuit 1', atlasPlaceId: null, detail: null }] };
const elsewhere = { ...reviewed, id: 'synthetic-v2-other', publicationId: '00000000-0000-4000-8000-000000000000' };
// The other-publication layer is an exclusion input; the healthy selection supplies only the reviewed layer.
const result = await readCanonicalSceneV2(port, request, new AbortController().signal,
  { now: () => '2026-10-15T00:00:00Z', overlays: healthy ? [reviewed] : [reviewed, elsewhere] });
assert.equal(result.status, 'available', result.detail);
assert.deepEqual(result.fence, { selectionRevision: scene.selection.revision, publicationId: PUBLICATION_ID });
assert.deepEqual(new Set(reads), new Set(files.keys()), 'Every pinned artifact is read once through the port at its canonical publication path');
assert.equal(reads.length, files.size);
const presentation = result.presentation;
assert.deepEqual(presentation.origin, { kind: 'adapted-publication', adapter: ADAPTER_ID, transport: 'synthetic-fixture' });
const pub = presentation.publication;
assert.deepEqual({ publicationId: pub.publicationId, sourceRevisionId: pub.sourceRevisionId, sourceRevisionSha256: pub.sourceRevisionSha256,
  sourceIfcSha256: pub.sourceIfcSha256, semanticMapRevisionId: pub.semanticMapRevision, semanticMapSha256: pub.semanticMapSha256,
  validation: pub.validation }, scene.publication);
assert.deepEqual(pub.selection, { mode: 'published', revision: scene.selection.revision });
assert.equal(pub.retrievedAt, '2026-10-15T00:00:00Z');
assert.equal(pub.publishedAt, null, 'No publish date is invented');
assert.equal(pub.sourceDate, null);
assert.equal(pub.owner, 'Synthetic fixture transport');
const pinOf = (label, floorId, suffix) => { const bytes = bytesOf(files.get(suffix)); return { label, floorId, sha256: digest(bytes), bytes: bytes.byteLength }; };
assert.deepEqual(pub.artifacts, [pinOf('Semantics', null, 'artifacts/semantics'), ...[GROUND, UPPER].flatMap(floorId => [
  pinOf('GLB', floorId, `floors/${floorId}/artifacts/glb`), pinOf('plan features', floorId, `floors/${floorId}/artifacts/floorplanFeatures`),
  pinOf('plan SVG', floorId, `floors/${floorId}/artifacts/floorplan2d`)])]);
assert.equal(scene.semantics.sha256, digest(bytesOf('publication/semantics.json')), 'Scene pins match the checked-in bytes');
assert.deepEqual(presentation.building, { buildingId: SCOPE.buildingId, label: 'Synthetic two-floor building',
  scope: { workspaceId: SCOPE.workspaceId, homeId: SCOPE.homeId } });
assert.deepEqual(presentation.registration, { kind: 'isolated-floors' });
assert.equal(presentation.coordinates.physicalAlignment, 'unknown');
assert.deepEqual(presentation.floors.map(floor => [floor.floorId, floor.label, floor.elevation]),
  [[GROUND, 'Synthetic floor', null], [UPPER, 'Second floor', null]]);
const bound = presentation.meshes.filter(mesh => mesh.occurrenceId !== null).map(mesh => [mesh.floorId, mesh.occurrenceId]);
assert.deepEqual(bound, [[GROUND, 'synthetic-space-one'], [UPPER, 'synthetic-space-two']], 'Hashed GLB names join each floor to its own occurrence');
assert.ok(presentation.meshes.every(mesh => mesh.meshKey === `${mesh.floorId}#${mesh.glbMeshIndex}`));
assert.deepEqual(presentation.overlays.map(layer => layer.id), ['synthetic-v2-electrical'],
  healthy ? 'The reviewed overlay of this publication is adapted' : 'Overlays of another publication are not adapted');

const V2 = admitPresentation(presentation);
assert.equal(selectionLabel(presentation), 'Mock selection', 'A fake-port ready state is a mock, not native publication');
assert.ok(isSyntheticSource(presentation));
assert.equal(V2.roomsById.size, 1);
const combined = V2.roomsById.get('27c1c078-4ea7-56a5-9ca3-00bb5a210f22');
assert.deepEqual(combined.occurrences.map(row => [row.spaceOccurrenceId, row.floorId]), [['synthetic-space-one', GROUND], ['synthetic-space-two', UPPER]]);
assert.ok(V2.planShapes.has('synthetic-space-one') && V2.planShapes.has('synthetic-space-two'));
assert.deepEqual(Object.values(V2.issues), Object.values(V2.issues).map(() => 0), 'Nothing is demoted or withheld');
assert.deepEqual([...visibleFloorIds(V2, UPPER)], [UPPER]);
let v2State = viewerReducer(V2, initialState(V2), { type: 'selectOccurrence', occurrenceId: 'synthetic-space-two' });
assert.equal(v2State.floorId, UPPER);
for (const view of ['3d', 'plan']) v2State = viewerReducer(V2, v2State, { type: 'view', view });
assert.equal(v2State.occurrenceId, 'synthetic-space-two', 'Plan/3D switching keeps the occurrence');
assert.deepEqual(contextOccurrences(V2, v2State, GROUND), ['synthetic-space-one']);
const v2Back = reconcile(V2, decodeMemory(encodeMemory(V2, v2State)));
assert.deepEqual(v2Back.state, v2State);
assert.equal(v2Back.notice, null);
assert.equal(memoryKey(V2), scopedMemoryKey(presentation.building.scope, SCOPE.buildingId));
const v2Join = joinOverlay(V2, V2.overlays[0]);
assert.equal(v2Join.byRoom.size, 0, 'A null Atlas link is never placed');
assert.deepEqual(v2Join.unplaced.map(row => row.id), ['synthetic-v2-e1']);
await held(() => assert.equal(joinOverlay(V2, elsewhere), null));

// Stale re-reads: another attempt of one request keeps its used allowance; a replacement request starts fresh.
const requestA = {}, requestB = {};
let allowance = retriesFor(null, requestA);
for (let at = 0; at < MAX_STALE_RETRIES; at++) allowance = takeRetry(retriesFor(allowance, requestA));
assert.equal(allowance.used, MAX_STALE_RETRIES);
assert.equal(retriesFor(allowance, requestA), allowance, 'Another attempt of the same request keeps its used allowance');
await held(() => assert.equal(takeRetry(retriesFor(allowance, requestA)), null, 'An attempt does not refill its request allowance'));
assert.deepEqual(retriesFor(allowance, requestB), { identity: requestB, used: 0 }, 'A replacement request has its own allowance');

// Local GLB: browser-only read of a checked-in public GLB; nothing is bound.
const glbBytes = bytesOf(files.get(`floors/${GROUND}/artifacts/glb`));
const local = await readLocalGlb(new Blob([glbBytes]), new AbortController().signal);
assert.equal(local.sha256, digest(glbBytes));
assert.equal(local.bytes, glbBytes.byteLength);
assert.equal(local.meshes.length, presentation.meshes.filter(mesh => mesh.floorId === GROUND).length);
assert.ok(local.meshes.every((mesh, index) => mesh.meshKey === `local#${index}` && mesh.floorId === null && mesh.occurrenceId === null),
  'Local meshes stay unbound: no floor, room or occurrence is inferred');

// Local closed-profile GLB through the multi-file reader keeps its own path.
const routed = await readLocalFiles([new File([glbBytes], 'ground.glb')], new AbortController().signal);
assert.equal(routed.kind, 'closed-profile');
assert.equal(routed.summary.sha256, digest(glbBytes));
assert.equal(routed.summary.meshes.length, local.meshes.length);
assert.deepEqual(routed.files, [{ name: 'ground.glb', bytes: glbBytes.byteLength, sha256: digest(glbBytes), role: 'glb' }]);

// Standard GLB + browser manifest, loaded by the pinned three.js GLTFLoader. Generated anonymous sample only.
const live = () => new AbortController().signal;
const houseGlb = buildGlb(SAMPLE_HOUSE), referenceGlb = buildGlb(SAMPLE_REFERENCE);
const manifestFile = async (overrides = {}) =>
  new File([new TextEncoder().encode(JSON.stringify(await sampleManifest(houseGlb, referenceGlb, overrides)))], 'manifest.json');
const read = await readLocalFiles([await manifestFile(), new File([houseGlb], 'house.glb'), new File([referenceGlb], 'reference.glb')], live());
assert.equal(read.kind, 'standard');
assert.deepEqual(read.files.map(file => [file.role, file.sha256]),
  [['manifest', read.files[0].sha256], ['house', digest(houseGlb)], ['reference', digest(referenceGlb)]]);
const flat = bounds => [...bounds.min, ...bounds.max];
assert.deepEqual(flat(read.house.bounds), SAMPLE_HOUSE_BOUNDS.flat(),
  'Baked poses are drawn as stored: provenance matrices are not applied and the unused far vertex does not frame the model');
assert.equal(read.house.glb.counts.declaredTransforms, 0);
assert.deepEqual(read.house.glb.drawn.map(item => item.nodeIndex), [1, 2, 3]);
assert.equal(read.house.glb.counts.triangles, 36);
assert.equal(read.house.glb.counts.metadataOnlyNodes, 3, 'Group, room occurrence and product without geometry stay as metadata-only nodes');
assert.deepEqual(read.house.glb.nodes.find(node => node.nodeIndex === 4).extras, SAMPLE_HOUSE.nodes[4].extras, 'Opaque extras are kept unchanged');
assert.ok([...read.house.glb.meshes, ...read.reference.glb.meshes].every(mesh => mesh.floorId === null && mesh.occurrenceId === null),
  'Standard meshes stay unbound: no floor, room or occurrence is inferred from names, extras or tree order');
assert.deepEqual(read.manifest.check, { meshes: { declared: 3, loaded: 3 }, triangles: { declared: 36, loaded: 36 }, boundsDifference: 0,
  boundsTolerance: 1e-4, geometryFreeProducts: 1, occurrencesWithFootprint: 0, identitiesInExtras: 4 });
assert.deepEqual(read.manifest.data.sourceIFC, { file: 'synthetic.ifc', sha256: '0'.repeat(64), bytes: 0 }, 'The complete manifest keeps its source IFC pin');
assert.deepEqual(read.manifest.data.storeys.map(storey => storey.visibleMeshes), [1, 2]);
assert.equal(read.manifest.data.document.storeys[0].sourceToLocalENNAPMetresMatrix[0][3], 120.5, 'Provenance is retained as declared, not applied');
assert.equal(read.manifest.data.qualifications.atticShapeKnown, false);
assert.equal(read.manifest.data.qualifications.physicalRegistrationEstablished, false);
assert.deepEqual(read.manifest.data.reference.groups.map(group => group.name), ['GroundSurface', 'WallSurface', 'RoofSurface']);
assert.deepEqual(flat(read.reference.bounds), SAMPLE_REFERENCE_BOUNDS.flat().map(Math.fround), 'GLB positions are float32 as stored');
assert.equal(read.reference.glb.copyright, SAMPLE_REFERENCE.asset.copyright, 'Reference attribution is preserved');
assert.ok(read.reference.glb.meshes.every(mesh => mesh.meshKey.startsWith('reference#')));
// Navigation preserves source order and object identity while grouping into
// its own local arrays, including metadata-only products and repeated parts.
const navigationInput = read.manifest.data;
const navigationBefore = JSON.stringify(navigationInput);
const navigation = navigationIndex(read.house.glb, navigationInput);
assert.deepEqual(navigation.storeys.map(group => [group.key, group.products.map(product => product.nodeIndex)]),
  [['a', [1]], ['b', [2, 3, 5]]]);
assert.equal(navigation.storeys[1].products[2], navigationInput.products[3]);
assert.equal(navigation.occurrences.get(4), navigationInput.roomOccurrences[0]);
assert.deepEqual(navigation.unlisted, []);
assert.deepEqual(navigationIndex(read.house.glb, undefined).unlisted, read.house.glb.drawn.map(item => item.meshKey));
const repeatedParts = navigationIndex({ ...read.house.glb, drawn: [read.house.glb.drawn[1],
  { ...read.house.glb.drawn[1], meshKey: 'generated-second-part' }, read.house.glb.drawn[0]] }, navigationInput);
assert.deepEqual(repeatedParts.meshesByNode.get(2), [read.house.glb.drawn[1].meshKey, 'generated-second-part']);
assert.deepEqual([...repeatedParts.meshesByNode.keys()], [2, 1]);
assert.notEqual(repeatedParts.meshesByNode.get(2), navigation.meshesByNode.get(2));
assert.equal(JSON.stringify(navigationInput), navigationBefore, 'Navigation does not mutate the admitted manifest');
const houseOnly = await readLocalFiles([await manifestFile(), new File([houseGlb], 'house.glb')], live());
assert.equal(houseOnly.reference, null, 'The reference layer is optional');

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

// Missing or mismatched artifacts and closed-preflight refusals stay explicit; each failure reports what the browser read.
await held(async () => {
  const failure = async (blobs, kind) => {
    const error = await readLocalFiles(blobs, live()).then(() => null, value => value);
    assert.ok(error instanceof LocalReadError && error.kind === kind, `Expected ${kind}, got ${error?.kind ?? error}`);
    return error;
  };
  const otherHouse = buildGlb({ ...SAMPLE_HOUSE, asset: { generator: 'other version' } });
  await failure([await manifestFile(), new File([otherHouse], 'house.glb')], 'pin');
  await failure([await manifestFile(), new File([referenceGlb], 'reference.glb')], 'pin');
  const external = buildGlb({ ...SAMPLE_HOUSE, patch: json => { json.buffers[0].uri = 'house.bin'; } });
  const refused = await failure([new File([external], 'external.glb')], 'preflight');
  assert.deepEqual(refused.files, [{ name: 'external.glb', bytes: external.byteLength, sha256: digest(external), role: 'glb' }]);
  await failure([new File([buildGlb({ ...SAMPLE_HOUSE, patch: json => { json.extensionsUsed = ['KHR_draco_mesh_compression']; } })], 'compressed.glb')], 'preflight');
  const patched = patch => [new File([buildGlb({ ...SAMPLE_HOUSE, patch })], 'patched.glb')];
  const because = async (blobs, kind, reason) => assert.match((await failure(blobs, kind)).message, reason);
  await because(patched(json => { json.scenes.push({ nodes: [] }); }), 'preflight', /Exactly one scene/);
  await because(patched(json => { json.materials = [{ extensions: { KHR_materials_unlit: {} } }]; }), 'preflight', /unsupported glTF extension/);
  await because(patched(json => { delete json.accessors[0].bufferView; }), 'preflight', /Accessor 0 buffer view/);
  await because(patched(json => { json.accessors[0].count += 1; }), 'preflight', /Accessor 0 reads past/);
  await because(patched(json => { json.accessors[1].normalized = true; }), 'preflight', /Indices must be unnormalized/);

  // The complete v1 manifest is validated before display, and identities are unambiguous before any lookup.
  const edited = async (edit, house = houseGlb) => {
    const manifest = await sampleManifest(house, referenceGlb); edit(manifest);
    return [new File([new TextEncoder().encode(JSON.stringify(manifest))], 'manifest.json'), new File([house], 'house.glb')];
  };
  await because(await edited(manifest => { delete manifest.sourceIFC; }), 'manifest', /manifest\.sourceIFC is missing/);
  await because(await edited(manifest => { delete manifest.storeyVisibleMeshBounds[0].boundsLocalENNAPMetres; }), 'manifest',
    /storeyVisibleMeshBounds\[0\]\.boundsLocalENNAPMetres is missing/);
  await because(await edited(manifest => { manifest.format.sourceIFCSHA256 = '1'.repeat(64); }), 'manifest', /different source IFC/);
  await because(await edited(manifest => { manifest.storeyVisibleMeshBounds[1].storeyGlobalId = 'syn-storey-a'; }), 'manifest', /Storey bounds b/);
  await because(await edited(manifest => { manifest.products[1].nodeIndex = 1; }), 'manifest', /Product node 1 appears more than once/);
  await because(await edited(manifest => { manifest.products[1].globalId = 'syn-product-0001'; }), 'manifest', /Product GlobalId syn-product-0001 appears/);
  await because(await edited(manifest => { manifest.roomOccurrences[0].globalId = 'syn-product-0001'; }), 'manifest', /names different product and room occurrence/);
  const relabelled = buildGlb({ ...SAMPLE_HOUSE, nodes: SAMPLE_HOUSE.nodes.map((node, at) => at === 2 ? { ...node, extras: { globalId: 'syn-product-0003' } } : node) });
  await because(await edited(() => {}, relabelled), 'binding', /GLB node 2 declares a different identity than the manifest/);
});

console.log(healthy
  ? 'PASS --healthy canonical viewer: healthy synthetic cases only (identity, memory restore, publication replacement, view and floor selection, overlay join, one frame and picking, v2 fixture pins, per-request retry allowance, local and standard GLB loads). Held rejection, mutated-input, exclusion and aborted-signal controls were not run.'
  : 'PASS canonical viewer keeps one publication, stable occurrence identity, exact v2 pins and one frame per registration across plan and 3D; standard GLB previews keep baked poses, opaque extras, admitted instance work, complete manifests, unambiguous identities and explicit unknowns.');
