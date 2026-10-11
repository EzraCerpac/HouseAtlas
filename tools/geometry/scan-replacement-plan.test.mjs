import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Healthy synthetic local planning only; no native calls, browser or private input.
const { buildReplacementPlan, writeReplacementArtifact } = await import(new URL('../../tools/geometry/scan-replacement-plan.mjs', import.meta.url));
const { syntheticMeshFixture, loadScanProfileSource } = await import(new URL('../../frontend/lantern-tests/scan-mesh-read.mjs', import.meta.url));
const { loadNumericSource } = await import(new URL('../../frontend/lantern-tests/load-numeric-source.mjs', import.meta.url));

let nextId = 100;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
const deepCopy = value => JSON.parse(JSON.stringify(value));
const date = '2026-10-11T00:00:00Z';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const homeId = '00000000-0000-4000-8000-000000000002';
const buildingId = '00000000-0000-4000-8000-000000000003';

function originalHash(label) { return sha(`synthetic original source: ${label}`); }

function profileBytes(label, sourceHash, mutate = () => {}) {
  const profile = deepCopy(syntheticMeshFixture(label));
  profile.source.originalSHA256 = sourceHash;
  mutate(profile);
  return { profile, bytes: new TextEncoder().encode(JSON.stringify(profile)) };
}

function geometry({ version, previousId = null, originalAssetId, evidenceId = uuid(), coordinateUnits = 'unknown', transform = null }) {
  return {
    schemaVersion: 1, recordType: 'geometry', recordId: uuid(), workspaceId, homeId, revision: 1,
    lifecycle: 'active', createdAt: date, updatedAt: date, lastAuditId: uuid(),
    payload: {
      producer: 'magicplan', producerVersion: 'synthetic fixture', exportFormat: 'usdz', originalAssetId,
      importedAt: date, coordinateUnits, scale: null, transform, geometryVersion: version,
      previousGeometryId: previousId, mappings: [], evidenceIds: [evidenceId],
    },
  };
}

function snapshot({ floorKey, sourceFloorKey, label, sourceHash = originalHash(label), profileEdit = () => {}, version = 1, previousId = null, prior = null }) {
  const { profile, bytes } = profileBytes(label, sourceHash, profileEdit);
  const originalAssetId = uuid();
  const record = geometry({ version, previousId, originalAssetId });
  return {
    key: floorKey, exportLabel: label, originalSha256: sourceHash,
    derivativeSha256: sha(bytes), geometry: record, meshBytes: bytes,
    sourceFloorKey, profile,
  };
}

function publicSnapshot(value) {
  const { sourceFloorKey: _sourceFloorKey, profile: _profile, ...fields } = value;
  return fields;
}

function makeReceipt(rooms) {
  const receiptId = 'synthetic-accepted-receipt-v1';
  const anchors = rooms.map(room => ({ id: room.anchorId, sourceFloorKey: room.sourceFloorKey,
    sourceOriginalSha256: room.sourceOriginalSha256,
    targets: room.targets.map(({ packagePlaceKey, packagePlaceUuid }) => ({ packagePlaceKey, packagePlaceUuid })),
    unresolvedLabels: [...room.unresolvedLabels] }));
  const body = { profile: 'houseatlas.native-scene-room-review.v1', receiptId,
    sourceReceiptSha256: sha('synthetic accepted source receipt'), anchors };
  const canonicalJson = canonical(body);
  return { receiptId, canonicalJson, canonicalSha256: sha(canonicalJson), anchors };
}

function associationFor(floors, rooms, receipt = makeReceipt(rooms)) {
  return {
    schemaVersion: 1, recordType: 'scene-association', recordId: uuid(), workspaceId, homeId, revision: 1,
    lifecycle: 'active', createdAt: date, updatedAt: date, lastAuditId: uuid(), payload: {
    profile: 'houseatlas.native-scene-association.v1', buildingId, associationVersion: 1,
    previousAssociationId: null, reviewStatus: 'accepted', reviewStatement: 'Synthetic accepted baseline for planner-only tests.',
    sourceDocuments: [{ role: 'primary-scene', evidenceId: uuid(), evidenceRevision: 1,
      originalAssetId: uuid(), originalAssetRevision: 1, originalSha256: sha('synthetic source document'), contentType: 'text/plain' }],
    acceptedReceipt: receipt,
    sourceFloors: floors.map(floor => ({ sourceFloorKey: floor.sourceFloorKey,
      sourceOriginalSha256: floor.originalSha256, nativeFloorKey: floor.key,
      nativeGeometryId: floor.geometry.recordId, nativeGeometryRevision: floor.geometry.revision,
      nativeOriginalAssetId: floor.geometry.payload.originalAssetId, nativeOriginalSha256: floor.originalSha256 })),
    roomMappings: rooms.map(room => ({ sourceRoomId: room.sourceRoomId, sourceFloorKey: room.sourceFloorKey,
      sourceOriginalSha256: room.sourceOriginalSha256, sourceAnchorIds: [room.anchorId],
      targets: room.targets, unresolvedLabels: room.unresolvedLabels, evidenceIds: [uuid()] })),
    },
  };
}

function room({ id, floor, targets, supported = true, meshIds = ['/Stage/Triangle'], unresolvedLabels = [] }) {
  return { sourceRoomId: id, sourceFloorKey: floor.sourceFloorKey, sourceOriginalSha256: floor.originalSha256,
    anchorId: `anchor-${floor.sourceFloorKey}-${id}`,
    targets: (targets ?? [{ packagePlaceKey: `place-${floor.sourceFloorKey}-${id}`, packagePlaceUuid: uuid() }]).map(t => ({ ...t, atlasPlaceId: null })),
    unresolvedLabels: [...unresolvedLabels], supported, meshIds };
}

function retainedState(floors, rooms) {
  return {
    identities: rooms.map(r => ({ sourceRoomId: r.sourceRoomId, atlasPlaceId: null, packagePlaceUuid: r.targets[0]?.packagePlaceUuid ?? null,
      identityKey: `stable:${r.sourceFloorKey}:${r.sourceRoomId}` })),
    overlayAssociations: rooms.map(r => ({ sourceRoomId: r.sourceRoomId, overlayId: `overlay:${r.sourceFloorKey}:${r.sourceRoomId}`,
      packagePlaceKey: r.targets[0]?.packagePlaceKey ?? null })),
    floorPlacementFacts: floors.map((f, i) => ({ geometryId: f.geometry.recordId, originalSha256: f.originalSha256,
      derivativeSha256: f.derivativeSha256, elevation: { value: 4.25 + i * 3.1, units: 'opaque synthetic display fact' } })),
  };
}

function supportRows(floors, rooms, receipt) {
  return rooms.filter(r => r.supported).map(r => {
    const floor = floors.find(f => f.sourceFloorKey === r.sourceFloorKey);
    return { sourceRoomId: r.sourceRoomId, sourceFloorKey: r.sourceFloorKey,
      sourceOriginalSha256: r.sourceOriginalSha256, derivativeSha256: floor.derivativeSha256,
      receiptSha256: receipt.canonicalSha256, meshIds: [...r.meshIds] };
  });
}

function world({ floors, rooms }) {
  const receipt = makeReceipt(rooms);
  return { association: associationFor(floors, rooms, receipt), floors: floors.map(publicSnapshot),
    successors: [], roomSupport: supportRows(floors, rooms, receipt), retainedState: retainedState(floors, rooms),
    rooms, receipt };
}

function successor(old, { edit = () => {}, label = old.exportLabel, sourceHash = old.originalSha256,
  floorKey = `${old.key}-v2`, sourceFloorKey = old.sourceFloorKey, units = old.geometry.payload.coordinateUnits,
  transform = old.geometry.payload.transform } = {}) {
  const oldProfile = JSON.parse(new TextDecoder().decode(old.meshBytes));
  const { profile, bytes } = profileBytes(label, sourceHash, next => {
    Object.assign(next, oldProfile);
    next.source = { ...oldProfile.source, floorLabel: label, originalSHA256: sourceHash };
    edit(next);
  });
  const record = geometry({ version: old.geometry.payload.geometryVersion + 1,
    previousId: old.geometry.recordId, originalAssetId: uuid(), coordinateUnits: units, transform });
  return { key: floorKey, exportLabel: label, originalSha256: sourceHash, derivativeSha256: sha(bytes),
    geometry: record, meshBytes: bytes, sourceFloorKey, profile };
}

function inputWith(worldValue, replacements) {
  return { association: worldValue.association, floors: worldValue.floors,
    successors: replacements.map(publicSnapshot), roomSupport: worldValue.roomSupport,
    retainedState: worldValue.retainedState };
}

function twoMeshEdit(profile, editFirst = () => {}) {
  const first = profile.meshes[0];
  editFirst(first);
  const second = deepCopy(first);
  second.sourceObjectId = '/Stage/Triangle2'; second.sourceName = 'Triangle2';
  second.positionsLocalTokens = ['2', '0', '0', '3', '0', '0', '2', '1', '0'];
  second.ancestorChain = ['/Stage/Triangle2', '/Stage']; second.appliedChain = [...second.ancestorChain];
  profile.meshes = [first, second];
  const meshNode = (path, name) => ({ path, primType: 'Mesh', parentPath: '/Stage', authoredOpOrder: null,
    rawOpOrderLiteral: null, resetXformStack: false, operations: [], localMatrixTokens: ['1','0','0','0','0','1','0','0','0','0','1','0','0','0','0','1'] });
  profile.nodes.push(meshNode('/Stage/Triangle2', 'Triangle2'));
  profile.meshes[1].composedLocalToStageMatrixTokens = [...profile.nodes[0].localMatrixTokens];
  profile.counts.meshes = 2; profile.counts.vertices = 6; profile.counts.triangles = 2; profile.counts.nodes = 3;
}

function transformRoot(profile, xToken) {
  const root = profile.nodes.find(node => node.path === '/Stage');
  root.operations[0].matrixTokens[12] = xToken;
  root.localMatrixTokens[12] = xToken;
  for (const mesh of profile.meshes) mesh.composedLocalToStageMatrixTokens[12] = xToken;
}

function replaceWithAddedAndRemovedMesh(profile) {
  const kept = deepCopy(profile.meshes.find(mesh => mesh.sourceObjectId === '/Stage/Triangle2'));
  const added = deepCopy(kept);
  added.sourceObjectId = '/Stage/Triangle3'; added.sourceName = 'Triangle3';
  added.ancestorChain = ['/Stage/Triangle3', '/Stage']; added.appliedChain = [...added.ancestorChain];
  profile.meshes = [kept, added];
  const identity = ['1','0','0','0','0','1','0','0','0','0','1','0','0','0','0','1'];
  profile.nodes = [profile.nodes.find(node => node.path === '/Stage'),
    { path: '/Stage/Triangle2', primType: 'Mesh', parentPath: '/Stage', authoredOpOrder: null, rawOpOrderLiteral: null,
      resetXformStack: false, operations: [], localMatrixTokens: identity },
    { path: '/Stage/Triangle3', primType: 'Mesh', parentPath: '/Stage', authoredOpOrder: null, rawOpOrderLiteral: null,
      resetXformStack: false, operations: [], localMatrixTokens: identity }];
  for (const mesh of profile.meshes) mesh.composedLocalToStageMatrixTokens = [...profile.nodes[0].localMatrixTokens];
  profile.counts.meshes = 2; profile.counts.vertices = 6; profile.counts.triangles = 2; profile.counts.nodes = 3;
}

test('partial two-floor update keeps untouched floor and retained identities, overlays, and elevation facts', async () => {
  const hg = snapshot({ floorKey: 'native-hg-v1', sourceFloorKey: 'source-hg', label: 'Higher Ground' });
  const upper = snapshot({ floorKey: 'native-upper-v1', sourceFloorKey: 'source-upper', label: 'Upper Floor' });
  const rooms = [room({ id: 'hg-room', floor: hg }), room({ id: 'upper-room', floor: upper })];
  const baseline = world({ floors: [hg, upper], rooms });
  const changedHg = successor(hg, { edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.125'; } });
  const before = JSON.stringify({ association: baseline.association, floors: baseline.floors,
    roomSupport: baseline.roomSupport, retainedState: baseline.retainedState });
  const plan = await buildReplacementPlan(inputWith(baseline, [changedHg]));
  assert.equal(plan.floors.find(f => f.previous.key === hg.key).status, 'replacement-proposed');
  assert.equal(plan.floors.find(f => f.previous.key === upper.key).status, 'retained');
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'hg-room').status, 'changed');
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'upper-room').status, 'retained');
  assert.deepEqual(plan.retainedState, baseline.retainedState);
  assert.deepEqual(plan.placementEvidenceApplications.map(row => row.applicability),
    ['prior-frame-only-requires-review', 'selected-prior-frame-only']);
  assert.deepEqual(plan.reversal.priorFloorPins.map(pin => pin.geometryId), [hg.geometry.recordId, upper.geometry.recordId]);
  assert.deepEqual(plan.reversal.deletes, []);
  assert.equal(JSON.stringify({ association: baseline.association, floors: baseline.floors,
    roomSupport: baseline.roomSupport, retainedState: baseline.retainedState }), before);
});

test('byte-identical supported replacement is reuse-proposed and still requires a native binding refresh', async () => {
  const floor = snapshot({ floorKey: 'native-first-v1', sourceFloorKey: 'source-first', label: 'First Floor' });
  const roomSpec = room({ id: 'room-first', floor }); const baseline = world({ floors: [floor], rooms: [roomSpec] });
  const candidate = successor(floor);
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.equal(plan.floors[0].geometryUnchanged, true);
  assert.equal(plan.floors[0].placementReuse, 'reviewable-exact-candidate');
  assert.equal(plan.rooms[0].status, 'reuse-proposed');
  assert.equal(plan.rooms[0].nativeBindingRefreshRequired, true);
  assert.equal(plan.rooms[0].spatialAcceptance, 'not-issued');
  assert.equal(plan.disposition, 'proposal-only');
  assert.equal(plan.placementEvidenceApplications[0].applicability, 'reviewable-exact-candidate');
});

test('one changed vertex affects only the room whose reviewed mesh support names that mesh', async () => {
  const floor = snapshot({ floorKey: 'native-two-mesh-v1', sourceFloorKey: 'source-two-mesh', label: 'Two Mesh Floor',
    profileEdit: profile => twoMeshEdit(profile) });
  const rooms = [room({ id: 'triangle-one-room', floor, meshIds: ['/Stage/Triangle'] }),
    room({ id: 'triangle-two-room', floor, meshIds: ['/Stage/Triangle2'] })];
  const baseline = world({ floors: [floor], rooms });
  const candidate = successor(floor, { edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.25'; } });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.deepEqual(plan.floors[0].meshes.changed, ['/Stage/Triangle']);
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'triangle-one-room').status, 'changed');
  assert.deepEqual(plan.rooms.find(r => r.sourceRoomId === 'triangle-one-room').affectedMeshIds, ['/Stage/Triangle']);
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'triangle-two-room').status, 'reuse-proposed');
  assert.deepEqual(plan.rooms.find(r => r.sourceRoomId === 'triangle-two-room').affectedMeshIds, []);
});

test('consistent ancestor transform edit changes fingerprints for dependent meshes', async () => {
  const floor = snapshot({ floorKey: 'native-transform-v1', sourceFloorKey: 'source-transform', label: 'Transformed Floor',
    profileEdit: profile => twoMeshEdit(profile) });
  const rooms = [room({ id: 'transform-room-a', floor, meshIds: ['/Stage/Triangle'] }),
    room({ id: 'transform-room-b', floor, meshIds: ['/Stage/Triangle2'] })];
  const baseline = world({ floors: [floor], rooms });
  const candidate = successor(floor, { edit: profile => transformRoot(profile, '3.0000') });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.deepEqual(plan.floors[0].meshes.changed, ['/Stage/Triangle', '/Stage/Triangle2']);
  assert.equal(plan.floors[0].geometryUnchanged, false);
  assert.equal(plan.rooms[0].status, 'changed'); assert.equal(plan.rooms[1].status, 'changed');
});

test('added and removed source meshes are separately reported against retained paths', async () => {
  const floor = snapshot({ floorKey: 'native-diff-v1', sourceFloorKey: 'source-diff', label: 'Mesh Diff Floor',
    profileEdit: profile => twoMeshEdit(profile) });
  const rooms = [room({ id: 'removed-mesh-room', floor, meshIds: ['/Stage/Triangle'] }),
    room({ id: 'retained-mesh-room', floor, meshIds: ['/Stage/Triangle2'] })];
  const baseline = world({ floors: [floor], rooms });
  const candidate = successor(floor, { edit: replaceWithAddedAndRemovedMesh });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.deepEqual(plan.floors[0].meshes.unchanged, ['/Stage/Triangle2']);
  assert.deepEqual(plan.floors[0].meshes.removed, ['/Stage/Triangle']);
  assert.deepEqual(plan.floors[0].meshes.added, ['/Stage/Triangle3']);
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'removed-mesh-room').status, 'changed');
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'retained-mesh-room').status, 'reuse-proposed');
});

test('source original digest change with exact mesh data stays proposal-only and cannot promote old receipt bindings', async () => {
  const floor = snapshot({ floorKey: 'native-original-v1', sourceFloorKey: 'source-original', label: 'Re-exported Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'reexport-room', floor })] });
  const newSourceHash = sha('new source original with exact same authored mesh');
  const candidate = successor(floor, { sourceHash: newSourceHash });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.equal(plan.floors[0].geometryUnchanged, true);
  assert.equal(plan.rooms[0].status, 'reuse-proposed');
  assert.equal(plan.rooms[0].nativeBindingRefreshRequired, true);
  assert.equal(plan.rooms[0].retainedMapping.sourceOriginalSha256, floor.originalSha256);
  assert.equal(plan.rooms[0].receiptSha256, baseline.receipt.canonicalSha256);
  assert.equal(plan.rooms[0].spatialAcceptance, 'not-issued');
});

test('coordinate frame change reviews every supported room even when mesh coordinates are unchanged', async () => {
  const floor = snapshot({ floorKey: 'native-frame-v1', sourceFloorKey: 'source-frame', label: 'Frame Floor',
    profileEdit: profile => twoMeshEdit(profile) });
  const rooms = [room({ id: 'frame-room-a', floor, meshIds: ['/Stage/Triangle'] }),
    room({ id: 'frame-room-b', floor, meshIds: ['/Stage/Triangle2'] })];
  const baseline = world({ floors: [floor], rooms });
  for (const edit of [profile => { profile.authoredCoordinates.upAxis = 'Z'; },
    profile => { profile.authoredCoordinates.metersPerUnitToken = '0.01'; },
    profile => { profile.converter.codeSHA256 = sha('new synthetic converter'); }]) {
    const candidate = successor(floor, { edit });
    const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
    assert.equal(plan.floors[0].frameUnchanged, false);
    assert.equal(plan.floors[0].placementReuse, 'requires-frame-review');
    assert.deepEqual(plan.floors[0].meshes.changed, ['/Stage/Triangle', '/Stage/Triangle2']);
    assert.equal(plan.rooms[0].status, 'changed'); assert.equal(plan.rooms[1].status, 'changed');
  }
});

test('unresolved mappings stay unmatched while a resolved room without mesh support requests support review', async () => {
  const floor = snapshot({ floorKey: 'native-support-v1', sourceFloorKey: 'source-support', label: 'Support Floor' });
  const rooms = [room({ id: 'unresolved-room', floor, targets: [], supported: false,
      unresolvedLabels: ['unmatched source label'] }),
    room({ id: 'resolved-no-support-room', floor, supported: false })];
  const baseline = world({ floors: [floor], rooms });
  const candidate = successor(floor, { edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.5'; } });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'unresolved-room').status, 'unmatched');
  assert.equal(plan.rooms.find(r => r.sourceRoomId === 'resolved-no-support-room').status, 'requires-support-review');
});

test('incremental successors retain version history pins and produce a fresh reversal target without mutating inputs', async () => {
  const floorV1 = snapshot({ floorKey: 'native-incremental-v1', sourceFloorKey: 'source-incremental', label: 'Incremental Floor' });
  const roomSpec = room({ id: 'incremental-room', floor: floorV1 });
  const baseline = world({ floors: [floorV1], rooms: [roomSpec] });
  const floorV2 = successor(floorV1, { edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.1'; } });
  const firstPlan = await buildReplacementPlan(inputWith(baseline, [floorV2]));
  assert.equal(firstPlan.geometryHistory.previous[0].recordId, floorV1.geometry.recordId);
  assert.equal(firstPlan.geometryHistory.candidates[0].payload.previousGeometryId, floorV1.geometry.recordId);
  assert.deepEqual(firstPlan.reversal.priorFloorPins.map(pin => pin.geometryId), [floorV1.geometry.recordId]);
  assert.deepEqual(firstPlan.reversal.deletes, []);

  const v2ForSelection = { ...floorV2, sourceFloorKey: floorV1.sourceFloorKey };
  const associationV2 = associationFor([v2ForSelection], [roomSpec], baseline.receipt);
  const supportV2 = supportRows([v2ForSelection], [roomSpec], baseline.receipt);
  const secondInput = { association: associationV2, floors: [publicSnapshot(v2ForSelection)],
    successors: [publicSnapshot(successor(v2ForSelection, { floorKey: 'native-incremental-v3',
      edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.2'; } }))],
    roomSupport: supportV2, retainedState: baseline.retainedState };
  const before = JSON.stringify({ association: secondInput.association, floors: secondInput.floors,
    successors: secondInput.successors, roomSupport: secondInput.roomSupport, retainedState: secondInput.retainedState });
  const secondPlan = await buildReplacementPlan(secondInput);
  assert.equal(secondPlan.geometryHistory.previous[0].recordId, floorV2.geometry.recordId);
  assert.equal(secondPlan.geometryHistory.candidates[0].payload.geometryVersion, 3);
  assert.equal(secondPlan.geometryHistory.candidates[0].payload.previousGeometryId, floorV2.geometry.recordId);
  assert.deepEqual(secondPlan.reversal.priorFloorPins.map(pin => pin.geometryId), [floorV2.geometry.recordId]);
  assert.deepEqual(secondPlan.reversal.deletes, []);
  assert.equal(JSON.stringify({ association: secondInput.association, floors: secondInput.floors,
    successors: secondInput.successors, roomSupport: secondInput.roomSupport, retainedState: secondInput.retainedState }), before);
});

test('identical plans produce byte-identical private artifacts in two fresh create-only child directories', async () => {
  const floor = snapshot({ floorKey: 'native-artifact-v1', sourceFloorKey: 'source-artifact', label: 'Artifact Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'artifact-room', floor })] });
  const candidate = successor(floor);
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  const temporaryParent = realpathSync(mkdtempSync(join(tmpdir(), 'scan-replacement-plan-test-')));
  try {
    const firstDirectory = join(temporaryParent, 'first');
    const secondDirectory = join(temporaryParent, 'second');
    const first = writeReplacementArtifact(plan, firstDirectory);
    const second = writeReplacementArtifact(plan, secondDirectory);
    assert.equal(statSync(temporaryParent).mode & 0o777, 0o700);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.fileName, second.fileName);
    assert.deepEqual(readdirSync(firstDirectory).sort(), ['SHA256SUMS', first.fileName].sort());
    assert.deepEqual(readdirSync(secondDirectory).sort(), ['SHA256SUMS', second.fileName].sort());
    assert.deepEqual(readFileSync(join(firstDirectory, first.fileName)), readFileSync(join(secondDirectory, second.fileName)));
    assert.deepEqual(readFileSync(join(firstDirectory, 'SHA256SUMS')), readFileSync(join(secondDirectory, 'SHA256SUMS')));
    assert.equal(statSync(join(firstDirectory, first.fileName)).mode & 0o777, 0o400);
    assert.equal(statSync(join(firstDirectory, 'SHA256SUMS')).mode & 0o777, 0o400);
    assert.equal(first.custody, 'private-local-proposal');
    assert.equal(first.nativeMutationCount, 0);
  } finally {
    rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test('actual assistant CLI reads selected synthetic files and retains a verified immutable artifact', () => {
  const floor = snapshot({ floorKey: 'native-cli-v1', sourceFloorKey: 'source-cli', label: 'CLI Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'cli-room', floor })] });
  const candidate = successor(floor);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'scan-replacement-cli-test-')));
  try {
    const input = inputWith(baseline, [candidate]);
    for (const field of ['floors', 'successors']) input[field] = input[field].map((s, i) => {
      const { meshBytes, ...rest } = s, meshFile = `${field}-${i}.json`;
      writeFileSync(join(parent, meshFile), meshBytes, { mode: 0o600 });
      return { ...rest, meshFile };
    });
    const manifest = join(parent, 'selection.json'), output = join(parent, 'new-artifact');
    writeFileSync(manifest, JSON.stringify(input), { mode: 0o600 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./scan-replacement-plan.mjs', import.meta.url)), manifest, output],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 65_536, env: { PATH: process.env.PATH ?? '' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined);
    const receipt = JSON.parse(result.stdout), bytes = readFileSync(join(output, receipt.fileName));
    assert.equal(sha(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes);
    const plan = JSON.parse(bytes);
    assert.equal(plan.rooms[0].status, 'reuse-proposed'); assert.equal(plan.operationsExecuted, 0);
    assert.deepEqual(plan.retainedState, baseline.retainedState); assert.equal(plan.identitiesToCreate.length, 0);
    assert.equal(statSync(join(output, receipt.fileName)).mode & 0o777, 0o400);
    assert.equal(plan.geometryHistory.candidates[0].payload.previousGeometryId, floor.geometry.recordId);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('repeated producer room IDs on different floors keep separate stable targets and support', async () => {
  const a = snapshot({ floorKey: 'same-id-floor-a', sourceFloorKey: 'same-id-source-a', label: 'Repeated ID Floor A' });
  const b = snapshot({ floorKey: 'same-id-floor-b', sourceFloorKey: 'same-id-source-b', label: 'Repeated ID Floor B' });
  const baseline = world({ floors: [a, b], rooms: [room({ id: 'R1', floor: a }), room({ id: 'R1', floor: b })] });
  const nextA = successor(a, { edit: profile => { profile.meshes[0].positionsLocalTokens[3] = '1.15'; } });
  const plan = await buildReplacementPlan(inputWith(baseline, [nextA]));
  assert.equal(plan.rooms.find(r => r.sourceFloorKey === a.sourceFloorKey).status, 'changed');
  assert.equal(plan.rooms.find(r => r.sourceFloorKey === b.sourceFloorKey).status, 'retained');
  assert.notEqual(plan.rooms[0].retainedMapping.targets[0].packagePlaceUuid, plan.rooms[1].retainedMapping.targets[0].packagePlaceUuid);
  assert(plan.rooms.every(r => r.retainedMapping.targets[0].atlasPlaceId === null));
});

test('unqualified historical placement stays unknown and cannot acquire a new frame', async () => {
  const floor = snapshot({ floorKey: 'unknown-place-v1', sourceFloorKey: 'unknown-place-source', label: 'Unknown Placement Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'unknown-place-room', floor })] });
  baseline.retainedState.floorPlacementFacts = [{ elevation: { status: 'unknown' }, alignment: 'unknown', transform: null }];
  const plan = await buildReplacementPlan(inputWith(baseline, [successor(floor)]));
  assert.equal(plan.placementEvidenceApplications[0].applicability, 'unqualified-frame');
  assert.deepEqual(plan.retainedState.floorPlacementFacts, baseline.retainedState.floorPlacementFacts);
  assert.equal(plan.floors[0].qualification.floorAlignment, 'unknown');
  assert.equal(plan.floors[0].qualification.stageToHouseTransform, null);
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.previousAssociation));
});

test('reopened artifact retains numeric reviewed placement and exact room-to-mesh support without adopting either', async () => {
  const floor = snapshot({ floorKey: 'placement-source-v1', sourceFloorKey: 'placement-source', label: 'Placement Source' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'placement-room', floor })] });
  const fact = { geometryId: floor.geometry.recordId, originalSha256: floor.originalSha256,
    derivativeSha256: floor.derivativeSha256, evidenceReceipt: { id: 'synthetic-placement-review', sha256: sha('synthetic placement review'), reviewStatus: 'accepted' },
    fromFrame: 'authored-stage', toFrame: 'synthetic-house-frame', matrixConvention: 'row-vector', coordinateUnits: 'm',
    stageToHouseTransform: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2.5, 4.25, -1.75, 1],
    elevation: { value: 4.25, units: 'm', referenceFrame: 'synthetic-house-frame', axis: 'Y' } };
  baseline.retainedState.floorPlacementFacts = [fact];
  const exact = await buildReplacementPlan(inputWith(baseline, [successor(floor)]));
  const changed = await buildReplacementPlan(inputWith(baseline, [successor(floor, { edit: p => transformRoot(p, '3.5') })]));
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'scan-replacement-placement-test-')));
  try {
    for (const [name, plan, applicability] of [['exact', exact, 'reviewable-exact-candidate'], ['changed', changed, 'prior-frame-only-requires-review']]) {
      const receipt = writeReplacementArtifact(plan, join(parent, name));
      const bytes = readFileSync(join(parent, name, receipt.fileName));
      assert.equal(sha(bytes), receipt.sha256);
      const reopened = JSON.parse(bytes);
      assert.deepEqual(reopened.retainedState.floorPlacementFacts, [fact]);
      assert.deepEqual(reopened.placementEvidenceApplications[0].evidenceFact.stageToHouseTransform, fact.stageToHouseTransform);
      assert.deepEqual(reopened.placementEvidenceApplications[0].evidenceFact.elevation, fact.elevation);
      assert.equal(reopened.placementEvidenceApplications[0].applicability, applicability);
      assert.deepEqual(reopened.roomSupportEvidence, baseline.roomSupport);
      assert.deepEqual(reopened.rooms[0].retainedMapping, baseline.association.payload.roomMappings[0]);
      assert.deepEqual(reopened.previousAssociation.payload.acceptedReceipt, baseline.receipt);
      assert.equal(reopened.floors[0].qualification.stageToHouseTransform, null);
      assert.equal(reopened.rooms[0].spatialAcceptance, 'not-issued');
      assert.equal(reopened.operationsExecuted, 0);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('opaque null and non-object placement facts survive a reopened successful artifact', async () => {
  const floor = snapshot({ floorKey: 'opaque-v1', sourceFloorKey: 'opaque-source', label: 'Opaque Placement Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'opaque-room', floor })] });
  const facts = [null, 'unknown', 0, false, ['opaque-history'], { alignment: 'unknown', transform: null }];
  baseline.retainedState.floorPlacementFacts = facts;
  const plan = await buildReplacementPlan(inputWith(baseline, [successor(floor)]));
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'scan-replacement-opaque-test-')));
  try {
    const receipt = writeReplacementArtifact(plan, join(parent, 'artifact'));
    const bytes = readFileSync(join(parent, 'artifact', receipt.fileName));
    assert.equal(sha(bytes), receipt.sha256);
    const reopened = JSON.parse(bytes);
    assert.deepEqual(reopened.retainedState.floorPlacementFacts, facts);
    assert.deepEqual(reopened.placementEvidenceApplications.map(row => row.evidenceFact), facts);
    assert(reopened.placementEvidenceApplications.every(row => row.applicability === 'unqualified-frame'));
    assert.equal(reopened.operationsExecuted, 0);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('geometry placement metadata changes require frame review even with byte-identical derivatives', async () => {
  const floor = snapshot({ floorKey: 'metadata-v1', sourceFloorKey: 'metadata-source', label: 'Metadata Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'metadata-room', floor })] });
  for (const [field, value] of [['coordinateUnits', 'm'], ['scale', 1.25], ['transform', [1, 0, 0, 1, 2.5, -1.75]]]) {
    const candidate = successor(floor);
    candidate.geometry.payload[field] = value;
    assert.deepEqual(candidate.meshBytes, floor.meshBytes);
    const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
    assert.equal(plan.floors[0].frameUnchanged, false);
    assert.equal(plan.floors[0].geometryUnchanged, false);
    assert.equal(plan.floors[0].placementReuse, 'requires-frame-review');
    assert.equal(plan.rooms[0].status, 'changed');
    assert.equal(plan.placementEvidenceApplications[0].applicability, 'prior-frame-only-requires-review');
    assert.deepEqual(plan.floors[0].candidateFrame.geometryPlacement[field], value);
  }
});

test('accepted multi-anchor room mappings retain disjoint target and unresolved-label unions', async () => {
  for (const withUnresolved of [false, true]) {
    const floor = snapshot({ floorKey: 'union-v1', sourceFloorKey: 'union-source', label: 'Union Floor' });
    const baseline = world({ floors: [floor], rooms: [room({ id: 'union-room', floor })] });
    const mapping = baseline.association.payload.roomMappings[0], receipt = baseline.receipt;
    const first = receipt.anchors[0], secondTarget = { packagePlaceKey: 'synthetic-second-place', packagePlaceUuid: uuid() };
    first.unresolvedLabels = withUnresolved ? ['first unresolved component'] : [];
    const second = { ...deepCopy(first), id: 'synthetic-second-anchor', targets: [secondTarget],
      unresolvedLabels: withUnresolved ? ['second unresolved component', 'first unresolved component'] : [] };
    receipt.anchors.push(second);
    mapping.sourceAnchorIds = [second.id, first.id];
    mapping.targets = [{ ...secondTarget, atlasPlaceId: null }, ...mapping.targets];
    mapping.unresolvedLabels = withUnresolved ? ['second unresolved component', 'first unresolved component'] : [];
    const decoded = JSON.parse(receipt.canonicalJson); decoded.anchors = receipt.anchors;
    receipt.canonicalJson = canonical(decoded); receipt.canonicalSha256 = sha(receipt.canonicalJson);
    baseline.roomSupport[0].receiptSha256 = receipt.canonicalSha256;
    const plan = await buildReplacementPlan(inputWith(baseline, [successor(floor)]));
    assert.deepEqual(plan.rooms[0].retainedMapping, mapping);
    assert.deepEqual(plan.previousAssociation.payload.acceptedReceipt, receipt);
    assert.equal(plan.rooms[0].status, withUnresolved ? 'unmatched' : 'reuse-proposed');
    assert.equal(plan.rooms[0].spatialAcceptance, 'not-issued');
  }
});

test('normal caller Buffer reuse after invocation preserves owned bytes and deterministic retained artifacts', async () => {
  const floor = snapshot({ floorKey: 'buffer-v1', sourceFloorKey: 'buffer-source', label: 'Buffer Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'buffer-room', floor })] });
  const candidate = successor(floor);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'scan-replacement-buffer-test-')));
  try {
    const receipts = [];
    for (const name of ['first', 'second']) {
      const input = inputWith(baseline, [candidate]);
      for (const field of ['floors', 'successors']) input[field] = input[field].map(s => ({ ...s, meshBytes: Buffer.from(s.meshBytes) }));
      const pending = buildReplacementPlan(input);
      for (const field of ['floors', 'successors']) for (const s of input[field]) s.meshBytes.fill(0);
      const plan = await pending;
      assert.equal(plan.rooms[0].status, 'reuse-proposed');
      assert.equal(plan.floors[0].previous.derivativeSha256, floor.derivativeSha256);
      const receipt = writeReplacementArtifact(plan, join(parent, name));
      const bytes = readFileSync(join(parent, name, receipt.fileName));
      assert.equal(sha(bytes), receipt.sha256);
      assert.equal(JSON.parse(bytes).operationsExecuted, 0);
      receipts.push(receipt);
    }
    assert.deepEqual(receipts[0], receipts[1]);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('corrected source key/hash versions keep distinct room support even when they bind one native floor', async () => {
  const floor = snapshot({ floorKey: 'corrected-v1', sourceFloorKey: 'corrected-source', label: 'Corrected Source Floor', profileEdit: p => twoMeshEdit(p) });
  const originalRoom = room({ id: 'R1', floor, meshIds: ['/Stage/Triangle'] });
  const correctedHash = sha('synthetic corrected source document');
  const correctedRoom = room({ id: 'R1', floor: { ...floor, originalSha256: correctedHash }, meshIds: ['/Stage/Triangle2'] });
  correctedRoom.anchorId += '-corrected';
  const baseline = world({ floors: [floor], rooms: [originalRoom, correctedRoom] });
  baseline.association.payload.sourceFloors.push({ ...baseline.association.payload.sourceFloors[0], sourceOriginalSha256: correctedHash });
  const candidate = successor(floor, { edit: p => { p.meshes[0].positionsLocalTokens[3] = '1.125'; } });
  const plan = await buildReplacementPlan(inputWith(baseline, [candidate]));
  assert.equal(plan.rooms.find(r => r.sourceOriginalSha256 === floor.originalSha256).status, 'changed');
  assert.equal(plan.rooms.find(r => r.sourceOriginalSha256 === correctedHash).status, 'reuse-proposed');
  assert.deepEqual(plan.roomSupportEvidence, baseline.roomSupport);
  assert.deepEqual(plan.previousAssociation.payload.sourceFloors, baseline.association.payload.sourceFloors);
  assert.equal(plan.floors.length, 1);
  assert.equal(plan.geometryHistory.previous.length, 1);
  assert(plan.rooms.every(r => r.sourceRoomId === 'R1' && r.sourceFloorKey === floor.sourceFloorKey));
  assert.equal(plan.rooms[1].retainedMapping.targets[0].atlasPlaceId, null);
});

test('producer pins the exact compiled decoder with its embedded numeric implementation', async () => {
  const floor = snapshot({ floorKey: 'decoder-v1', sourceFloorKey: 'decoder-source', label: 'Decoder Floor' });
  const baseline = world({ floors: [floor], rooms: [room({ id: 'decoder-room', floor })] });
  const plan = await buildReplacementPlan(inputWith(baseline, [successor(floor)]));
  const module = await loadScanProfileSource();
  const compiled = Buffer.from(module.slice('data:text/javascript;base64,'.length), 'base64');
  assert(compiled.toString('utf8').includes(await loadNumericSource('numeric/decimal.ts')));
  assert.equal(plan.producer.compiledMeshDecoderSha256, sha(compiled));
  assert.equal(plan.producer.compiledMeshDecoderBytes, compiled.length);
  assert.notEqual(plan.producer.compiledMeshDecoderSha256, plan.producer.meshReaderSha256);
});
