// Healthy synthetic identity, persistence, shared-frame and picking checks for
// the canonical model viewer. Generated fixtures only; no network, storage,
// browser, GPU or native host is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

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
const modelURL = await sourceURL(`${base}model.ts`, 'ts');
const selectionURL = await sourceURL(`${base}selection.ts`, 'ts');
const geometryURL = await sourceURL(`${base}geometry.ts`, 'ts');
const overlaysURL = await sourceURL(`${base}overlays.ts`, 'ts');
const tonesURL = await sourceURL(`${base}tones.ts`, 'ts');
const fixturesURL = await sourceURL('./canonical-ifc-visual/synthetic-publication.ts', 'ts', { '../../src/lantern/canonical-ifc/model': modelURL });

const { admitPresentation, PresentationError, isDuplicateLabel } = await import(modelURL);
const { reconcile, viewerReducer, encodeMemory, decodeMemory, initialState } = await import(selectionURL);
const { makeProjection, modelBounds, prepareMeshes, pick, planPick, labelPoint, pointInRings, visibleFloorIds, roomTop } = await import(geometryURL);
const { joinOverlay } = await import(overlaysURL);
const { publicationA, publicationB, generatedCoverage } = await import(fixturesURL);

const A = admitPresentation(publicationA()), B = admitPresentation(publicationB()), C = admitPresentation(generatedCoverage());
const roomByLabel = (model, label) => model.source.rooms.filter(room => room.label === label);
const kitchen = roomByLabel(A, 'Kitchen')[0], dining = roomByLabel(A, 'Dining room')[0];

// Admission: explicit links survive; unlinked geometry stays display-only.
assert.equal(A.issues.planFeaturesDemoted, 0);
assert.equal(A.issues.meshBindingsDemoted, 0);
assert.equal(A.issues.roomsWithoutPlanShape, 1, 'Cellar has no plan shape');
assert.ok(A.issues.displayOnlyMeshes > 0, 'Slab and walls are display-only');
assert.equal(A.roomMeshes.get(kitchen.atlasId).length, 1);
assert.equal(C.issues.roomsWithUnknownFloor, 1, 'Loft keeps an explicit unknown floor');
const boxRoom = roomByLabel(C, 'Box room')[0];
assert.ok(C.planShapes.has(boxRoom.atlasId) && !C.roomMeshes.has(boxRoom.atlasId), 'Box room is plan-only');

// Duplicate labels never merge identities.
const bedrooms = roomByLabel(C, 'Bedroom');
assert.equal(bedrooms.length, 2);
assert.notEqual(bedrooms[0].atlasId, bedrooms[1].atlasId);
assert.ok(bedrooms.every(room => isDuplicateLabel(C, room)));
const second = reconcile(C, { v: 1, publicationId: C.source.publication.publicationId, roomId: bedrooms[1].atlasId, floorId: null, view: '3d', overlayId: null });
assert.equal(second.state.roomId, bedrooms[1].atlasId, 'The second Bedroom restores by ID, not label');

// Memory holds the publication pin and IDs only.
const selected = viewerReducer(A, { ...initialState(A), overlayId: A.source.overlays[0].id }, { type: 'selectRoom', roomId: kitchen.atlasId });
const text = encodeMemory(selected), record = decodeMemory(text);
assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['floorId', 'overlayId', 'publicationId', 'roomId', 'v', 'view']);
assert.ok(!text.includes('Kitchen'), 'No label is persisted');
const restored = reconcile(A, record);
assert.deepEqual(restored.state, selected, 'Same publication restores room, floor, view and overlay');
assert.equal(restored.notice, null);

// New publication: carry only an identical Atlas ID; the renamed label is shown.
const carried = reconcile(B, record);
assert.equal(carried.state.roomId, kitchen.atlasId);
assert.equal(carried.state.publicationId, 'synthetic-publication-b');
assert.equal(B.roomsById.get(kitchen.atlasId).label, 'Kitchen and dining');
assert.deepEqual(carried.notice, { kind: 'carried', fromPublicationId: 'synthetic-publication-a' });
assert.equal(carried.state.overlayId, null, 'Overlay layer IDs of another publication are not carried');
const absent = reconcile(B, decodeMemory(encodeMemory(viewerReducer(A, initialState(A), { type: 'selectRoom', roomId: dining.atlasId }))));
assert.equal(absent.state.roomId, null, 'A removed room is not revived');
assert.equal(absent.notice.kind, 'room-absent');
const gardenRoom = roomByLabel(B, 'Garden room')[0];
assert.notEqual(gardenRoom.atlasId, dining.atlasId, 'The room occupying the same area has a new identity');

// Room identity stays separate from the visible floor and the view.
const upper = C.source.floors[1].atlasId, ground = C.source.floors[0].atlasId;
let state = viewerReducer(C, initialState(C), { type: 'selectRoom', roomId: bedrooms[0].atlasId });
assert.equal(state.floorId, upper, 'Selecting reveals the explicitly linked floor');
for (const action of [{ type: 'showFloor', floorId: ground }, { type: 'view', view: '3d' }, { type: 'view', view: 'plan' }, { type: 'showFloor', floorId: upper }])
  state = viewerReducer(C, state, action);
assert.equal(state.roomId, bedrooms[0].atlasId, 'Floor and view navigation keep the room');
assert.equal(state.publicationId, C.source.publication.publicationId);
const loft = roomByLabel(C, 'Loft')[0];
assert.equal(viewerReducer(C, state, { type: 'selectRoom', roomId: loft.atlasId }).floorId, upper, 'Unknown floor keeps the current floor');

// Overlays join by Atlas room ID only; unknown and null links stay unplaced.
const electrical = joinOverlay(A, A.source.overlays[0]);
assert.equal(electrical.byRoom.get(kitchen.atlasId).length, 2);
assert.deepEqual(electrical.unplaced.map(record => record.roomAtlasId === null ? 'null' : 'absent').sort(), ['absent', 'null']);

// One shared frame: no per-floor centring, scaling or spacing.
const bounds = modelBounds(C), viewport = { width: 1000, height: 700 };
const planView = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 1);
const g = planView.project(2, 0, 3), u = planView.project(2, 2.9, 3);
assert.ok(Math.abs(g[0] - u[0]) < 1e-9 && Math.abs(g[1] - u[1]) < 1e-9, 'Equal x/z coincide in plan on every floor');
const view3d = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 0);
assert.ok(view3d.project(2, 2.9, 3)[1] < view3d.project(2, 0, 3)[1], 'Upper geometry sits above lower in 3D');
assert.deepEqual([...visibleFloorIds(C, ground)], [ground]);
assert.deepEqual(new Set(visibleFloorIds(C, upper)), new Set([upper, ground]));

// Plan and 3D picking resolve the same Atlas room through explicit geometry.
const meshesA = prepareMeshes(A), boundsA = modelBounds(A);
const point = labelPoint(A.planShapes.get(kitchen.atlasId));
assert.ok(pointInRings(point.x, point.z, A.planShapes.get(kitchen.atlasId)));
const groundA = A.source.floors[0].atlasId;
const planA = makeProjection({ yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 }, boundsA, viewport, 1);
const [px, py] = planA.project(point.x, 0, point.z);
assert.equal(planPick(A, groundA, 0, planA, px, py), kitchen.atlasId);
const rules = { visibleFloors: visibleFloorIds(A, groundA), clipY: 1.2 };
const threeA = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, boundsA, viewport, 0);
const [qx, qy] = threeA.project(point.x, roomTop(meshesA, kitchen.atlasId), point.z);
assert.deepEqual(pick(meshesA, threeA, rules, qx, qy).roomId, kitchen.atlasId);
const [wx, wy] = threeA.project(5.6, 1.0, 3.5);
assert.equal(pick(meshesA, threeA, rules, wx, wy).kind, 'display-only', 'A wall is display-only');
assert.equal(pick(meshesA, threeA, rules, 2, 2).kind, 'none');
const meshesC = prepareMeshes(C), boxPoint = labelPoint(C.planShapes.get(boxRoom.atlasId));
const threeC = makeProjection({ yaw: -32, pitch: 36, zoom: 1, panX: 0, panY: 0 }, bounds, viewport, 0);
const [bx, by] = threeC.project(boxPoint.x, 2.92, boxPoint.z);
assert.equal(pick(meshesC, threeC, { visibleFloors: visibleFloorIds(C, upper), clipY: 2.9 + 1.2 }, bx, by).kind, 'display-only', 'An unmapped room mesh selects no room');

// Unverifiable links are demoted to display-only; ambiguous identity is refused.
const source = publicationA();
const moved = { ...source, meshes: source.meshes.map(mesh => mesh.roomAtlasId === kitchen.atlasId ? { ...mesh, floorAtlasId: null } : mesh) };
const demoted = admitPresentation(moved);
assert.equal(demoted.issues.meshBindingsDemoted, 1);
assert.ok(!demoted.roomMeshes.has(kitchen.atlasId));
assert.throws(() => admitPresentation({ ...source, rooms: [...source.rooms, { ...source.rooms[0], label: 'Copy' }] }), PresentationError);

// Static markup: pressed state, identity attributes and synchronized selection.
const iconURL = await sourceURL('../src/lantern/components/Icon.tsx', 'tsx', { 'react/jsx-runtime': jsx });
const cameraURL = await sourceURL('../src/lantern/atlas/useCamera.ts', 'ts', { react });
const meshLayerURL = await sourceURL(`${base}MeshLayer.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx, './geometry': geometryURL });
const stageURL = await sourceURL(`${base}ModelStage.tsx`, 'tsx', { react, 'react/jsx-runtime': jsx, '../components/Icon': iconURL,
  '../atlas/useCamera': cameraURL, './geometry': geometryURL, './MeshLayer': meshLayerURL, './tones': tonesURL });
const { ModelStage } = await import(stageURL);
const labelPoints = new Map([...A.planShapes].map(([id, rings]) => [id, labelPoint(rings)]));
const stageMarkup = view => renderToStaticMarkup(createElement(ModelStage, { model: A, meshes: meshesA, bounds: boundsA, labelPoints,
  state: { ...viewerReducer(A, initialState(A), { type: 'selectRoom', roomId: kitchen.atlasId }), view },
  dispatch() {}, overlay: null, roomTints: new Map(), reduced: true, status: null }));
const planMarkup = stageMarkup('plan');
const entityIds = [...planMarkup.matchAll(/data-entity-id="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(new Set(entityIds), new Set([...A.planShapes.keys()]), 'Plan rooms carry their Atlas IDs');
assert.match(planMarkup, new RegExp(`class="cifc-plan-room is-selected" data-entity-id="${kitchen.atlasId}"|data-entity-id="${kitchen.atlasId}"[^>]*class="cifc-plan-room is-selected"`));
assert.match(planMarkup, /<button type="button" aria-pressed="true">Plan<\/button>/);
assert.match(planMarkup, /class="cifc-label is-selected"[^]*?>Kitchen</);
const threeMarkup = stageMarkup('3d');
assert.match(threeMarkup, /<button type="button" aria-pressed="true">3D<\/button>/);
assert.match(threeMarkup, /class="floor-btn is-current" aria-pressed="true"/);

console.log('PASS canonical viewer keeps one publication, stable room identity and one shared frame across plan and 3D.');
