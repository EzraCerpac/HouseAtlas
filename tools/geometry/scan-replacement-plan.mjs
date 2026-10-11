/** Assistant-only, local replacement planning. Never creates custody or submits an intent. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, fchmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadScanProfileSource } from '../../frontend/lantern-tests/scan-mesh-read.mjs';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const Ajv = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
const atlasSchemaBytes = readFileSync(new URL('../../packages/contracts/schemas/atlas.schema.json', import.meta.url));
const schema = JSON.parse(atlasSchemaBytes);
const ajv = new Ajv({ strict: false, allErrors: false });
addFormats(ajv); ajv.addSchema(schema, 'atlas');
const geometryRecord = ajv.compile({ $ref: 'atlas#/$defs/geometryRecord' });
const sceneRecord = ajv.compile({ $ref: 'atlas#/$defs/sceneAssociationRecord' });
export const LIMITS = Object.freeze({ floors: 3, manifestBytes: 2 * 1024 * 1024, meshBytes: 8 * 1024 * 1024, support: 256 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
// Current retained native profile; proposed future converters remain frame-qualified separately.
const MAX_RETAINED_NATIVE_HISTORY_VERSIONS = 64;
const nativeConverterPins = Object.freeze({
  schemaSHA256: '7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863',
  codeSHA256: 'c9bf5c49ceba9b8dcace64102dc9e7d714731952dae4ca3c2f704ad1569caeb3',
  profileSHA256: '3deec596c1fedef079c4e353432f7848ae4d5d403b9e1bec92fad2907ca18aff',
});
function closed(value, fields) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
}
function bounded(array, max) { assert(Array.isArray(array) && array.length <= max); return array; }
function text(value) { assert(typeof value === 'string' && value.length > 0 && value.length <= 512); return value; }
function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i); assert(next >= 0xdc00 && next <= 0xdfff, 'Selected JSON requires paired Unicode');
    } else assert(c < 0xdc00 || c > 0xdfff, 'Selected JSON requires paired Unicode');
  }
}
function jsonData(value, ancestors = new Set()) {
  if (typeof value === 'string') { validUnicode(value); return; }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert(Number.isFinite(value) && !Object.is(value, -0), 'Selected JSON numbers must retain their value'); return;
  }
  assert(value && typeof value === 'object' && !ancestors.has(value), 'Selected history must be lossless JSON data');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  assert(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    'Selected history requires JSON data containers');
  const keys = Reflect.ownKeys(value);
  if (array) assert.equal(keys.length, value.length + 1, 'Selected JSON arrays must be dense with no extra fields');
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const field = Object.getOwnPropertyDescriptor(value, key);
    assert(typeof key === 'string' && field.enumerable && Object.hasOwn(field, 'value'), 'Selected JSON fields must be data');
    validUnicode(key);
    if (array) assert(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, 'Selected JSON array index changed');
    jsonData(field.value, ancestors);
  }
  ancestors.delete(value);
}
const clone = value => { jsonData(value); return JSON.parse(JSON.stringify(value)); };
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const equal = (a, b) => canonical(a) === canonical(b);
const sourceFloorKey = row => JSON.stringify([row.sourceFloorKey, row.sourceOriginalSha256]);
const roomKey = row => JSON.stringify([row.sourceFloorKey, row.sourceOriginalSha256, row.sourceRoomId]);
function fingerprint(profile, mesh) {
  const nodes = new Map(profile.nodes.map(node => [node.path, node]));
  return sha(canonical({ ...mesh, vertexCount: mesh.vertexCount.token, triangleCount: mesh.triangleCount.token,
    faceVertexCounts: { ...mesh.faceVertexCounts, count: mesh.faceVertexCounts.count.token },
    // Retain every ancestor, including raw op order, reset and authored operations.
    nodes: mesh.ancestorChain.map(path => nodes.get(path)) }));
}
async function inspect(snapshot, reader) {
  closed(snapshot, ['key', 'exportLabel', 'originalSha256', 'derivativeSha256', 'geometry', 'meshBytes']);
  text(snapshot.key); text(snapshot.exportLabel);
  assert(hashPattern.test(snapshot.key), 'Selected native descriptor keys require lowercase SHA256');
  assert(hashPattern.test(snapshot.originalSha256) && hashPattern.test(snapshot.derivativeSha256));
  assert(geometryRecord(snapshot.geometry), 'Snapshot geometry must satisfy the existing Atlas record schema');
  assert(!(Date.parse(snapshot.geometry.updatedAt) < Date.parse(snapshot.geometry.createdAt)), 'Geometry record time cannot move backward');
  const placement = snapshot.geometry.payload;
  assert.equal(new Set(placement.mappings.map(mapping => mapping.producerRoomId)).size, placement.mappings.length,
    'Producer room mappings must have distinct source IDs');
  for (const mapping of placement.mappings) {
    const source = mapping.homeboxEntity;
    assert(source === null || (source.workspaceId === snapshot.geometry.workspaceId
      && source.homeId === snapshot.geometry.homeId && source.key.sourceKind === 'homebox-entity'),
    'Geometry HomeBox references must retain scope and source kind');
  }
  assert(placement.coordinateUnits !== 'unknown' || (placement.scale === null && placement.transform === null),
    'Unknown geometry units cannot imply scale or transform');
  assert.equal(snapshot.geometry.lifecycle, 'active');
  assert(snapshot.meshBytes instanceof Uint8Array && snapshot.meshBytes.length > 0 && snapshot.meshBytes.length <= LIMITS.meshBytes);
  assert.equal(sha(snapshot.meshBytes), snapshot.derivativeSha256, 'Derivative bytes must match the selected digest');
  const floor = Object.freeze({ key: snapshot.key, exportLabel: snapshot.exportLabel,
    originalSHA256: snapshot.originalSha256, derivativeSHA256: snapshot.derivativeSha256 });
  const port = { isCurrent: key => key === 'assistant-local-plan', subscribeInvalidation: () => () => {},
    async read(viewKey, selected) { assert.equal(selected, floor); return { viewKey, floorKey: floor.key, bytes: snapshot.meshBytes }; } };
  const profile = await reader.readScanMesh(port, 'assistant-local-plan', floor, new AbortController().signal);
  const counts = [profile.source.originalBytes, profile.source.primaryLayerBytes, profile.source.serializedUSDABytes,
    profile.qualification.semanticRoomObjects, ...Object.values(profile.counts),
    ...profile.meshes.flatMap(mesh => [mesh.vertexCount, mesh.triangleCount, mesh.faceVertexCounts.count])];
  assert(counts.every(value => /^(0|[1-9][0-9]*)$/.test(value.token)), 'Native mesh integer fields require unsigned integer tokens');
  return { snapshot, profile, meshes: new Map(profile.meshes.map(mesh => [mesh.sourceObjectId, fingerprint(profile, mesh)])),
    frame: { authoredCoordinates: profile.authoredCoordinates, converter: profile.converter,
      geometryPlacement: { coordinateUnits: snapshot.geometry.payload.coordinateUnits,
        scale: snapshot.geometry.payload.scale, transform: clone(snapshot.geometry.payload.transform) } } };
}
function pin(floor) {
  const s = floor.snapshot;
  return { key: s.key, geometryId: s.geometry.recordId, geometryRevision: s.geometry.revision,
    geometryVersion: s.geometry.payload.geometryVersion, previousGeometryId: s.geometry.payload.previousGeometryId, originalAssetId: s.geometry.payload.originalAssetId,
    originalSha256: s.originalSha256, derivativeSha256: s.derivativeSha256,
    originalLineage: { originalBytesToken: floor.profile.source.originalBytes.token,
      primaryLayerName: floor.profile.source.primaryLayerName, primaryLayerSha256: floor.profile.source.primaryLayerSHA256,
      primaryLayerBytesToken: floor.profile.source.primaryLayerBytes.token } };
}

/** Input is an explicit local selection, never native authority or an inferred floor match.
 * `successors` contains only replaced floors; omitted floors remain selected unchanged.
 * A successor uses the existing append-only geometry payload predecessor/version fields.
 * Room support is independently reviewed mesh membership, not a mesh-as-room assertion.
 */
export async function buildReplacementPlan(input) {
  closed(input, ['association', 'floors', 'successors', 'roomSupport', 'retainedState']);
  assert(Buffer.byteLength(JSON.stringify(input, (key, value) => key === 'meshBytes' ? undefined : value)) <= LIMITS.manifestBytes);
  // Own the complete selection before the first await; later caller edits cannot
  // substitute a digest, prior record or dependency while the decoder is running.
  const copyFloor = snapshot => {
    closed(snapshot, ['key', 'exportLabel', 'originalSha256', 'derivativeSha256', 'geometry', 'meshBytes']);
    assert(snapshot.meshBytes instanceof Uint8Array && snapshot.meshBytes.length > 0 && snapshot.meshBytes.length <= LIMITS.meshBytes);
    const { meshBytes, ...metadata } = snapshot;
    return { ...clone(metadata), meshBytes: new Uint8Array(meshBytes) };
  };
  input = { association: clone(input.association), roomSupport: clone(input.roomSupport), retainedState: clone(input.retainedState),
    floors: bounded(input.floors, LIMITS.floors).map(copyFloor), successors: bounded(input.successors, LIMITS.floors).map(copyFloor) };
  assert(sceneRecord(input.association), 'Use the existing accepted scene-association record');
  assert(!(Date.parse(input.association.updatedAt) < Date.parse(input.association.createdAt)), 'Association record time cannot move backward');
  const association = input.association.payload;
  assert(Buffer.byteLength(JSON.stringify(association)) <= 524288, 'Selected scene payload exceeds the existing contract byte bound');
  assert(association.roomMappings.length <= 32
    && new Set(association.roomMappings.map(mapping => mapping.sourceRoomId)).size === association.roomMappings.length,
    'Native scene mappings require at most 32 globally distinct source entry IDs');
  assert(association.previousAssociationId !== input.association.recordId, 'Association cannot be its own predecessor');
  assert.equal(association.previousAssociationId === null, association.associationVersion === 1, 'Association roots need version one and no predecessor');
  const primary = association.sourceDocuments.filter(source => source.role === 'primary-scene');
  const documentary = association.sourceDocuments.filter(source => source.role === 'documentary-sheet');
  assert(association.sourceDocuments.length === 2 && primary.length === 1 && documentary.length === 1,
    'Selected native scene requires one primary and one documentary source');
  assert(primary[0].contentType === 'text/plain' && documentary[0].contentType === 'text/plain'
    && primary[0].originalAssetId !== documentary[0].originalAssetId, 'Native scene sources must be distinct retained text originals');
  assert.equal(new Set(association.sourceDocuments.map(source => source.evidenceId)).size, association.sourceDocuments.length,
    'Selected scene source evidence IDs must be distinct');
  assert(Buffer.byteLength(JSON.stringify({ association, roomSupport: input.roomSupport, retainedState: input.retainedState })) <= LIMITS.manifestBytes);
  closed(input.retainedState, ['identities', 'overlayAssociations', 'floorPlacementFacts']);
  assert(Buffer.byteLength(JSON.stringify(input.retainedState)) <= LIMITS.manifestBytes);
  for (const values of Object.values(input.retainedState)) bounded(values, 1024);
  const receipt = association.acceptedReceipt;
  assert(Buffer.byteLength(receipt.canonicalJson) <= 131072, 'Accepted receipt exceeds its UTF-8 byte bound');
  assert.equal(sha(receipt.canonicalJson), receipt.canonicalSha256, 'Accepted receipt literal bytes must match its digest');
  const decoded = JSON.parse(receipt.canonicalJson);
  closed(decoded, ['profile', 'receiptId', 'sourceReceiptSha256', 'anchors']);
  assert.equal(decoded.profile, 'houseatlas.native-scene-room-review.v1');
  assert.equal(decoded.receiptId, receipt.receiptId); assert(hashPattern.test(decoded.sourceReceiptSha256));
  assert.equal(decoded.sourceReceiptSha256, documentary[0].originalSha256, 'Receipt source must match its retained documentary original');
  assert(equal(decoded.anchors, receipt.anchors), 'Complete accepted anchor membership must match');
  jsonData(decoded);
  assert(canonical(decoded) === receipt.canonicalJson, 'Receipt must be canonical');
  const anchors = new Map();
  assert(receipt.anchors.length > 0, 'Native scene receipt requires at least one source anchor');
  for (const anchor of receipt.anchors) {
    assert(!anchors.has(anchor.id), 'Ambiguous source anchor');
    assert.equal(new Set(anchor.targets.map(target => JSON.stringify([target.packagePlaceKey, target.packagePlaceUuid]))).size,
      anchor.targets.length, 'Accepted anchor targets must be distinct');
    assert.equal(new Set(anchor.unresolvedLabels).size, anchor.unresolvedLabels.length, 'Accepted anchor unresolved labels must be distinct');
    anchors.set(anchor.id, anchor);
  }
  const decoderModule = await loadScanProfileSource();
  const decoderPrefix = 'data:text/javascript;base64,';
  assert(decoderModule.startsWith(decoderPrefix));
  const decoderBytes = Buffer.from(decoderModule.slice(decoderPrefix.length), 'base64');
  assert(decoderBytes.length > 0 && decoderBytes.length <= LIMITS.manifestBytes);
  const reader = await import(decoderModule);
  // The decoder yields on this one event loop; isolate its existing per-read
  // budgets rather than charging another floor's work against this one.
  const previous = [], next = [], retainedEvidenceIds = new Set(), retainedPredecessorIds = new Set();
  const selectedGeometryIds = new Set(input.floors.map(snapshot => snapshot.geometry.recordId));
  for (const snapshot of input.floors) {
    const p = snapshot.geometry.payload;
    assert(p.producer === 'magicplan' && p.exportFormat === 'usdz' && p.coordinateUnits === 'unknown'
      && p.scale === null && p.transform === null && p.mappings.length === 0
      && Number.isSafeInteger(p.geometryVersion) && p.geometryVersion >= 1
      && p.geometryVersion <= MAX_RETAINED_NATIVE_HISTORY_VERSIONS
      && ((p.geometryVersion === 1 && p.previousGeometryId === null)
        || (p.geometryVersion > 1 && typeof p.previousGeometryId === 'string')) && p.evidenceIds.length === 1,
    'Selected retained geometry must match the current native bundle profile');
    if (p.previousGeometryId !== null) {
      assert(!selectedGeometryIds.has(p.previousGeometryId), 'Selected native floors must be lineage heads, not known ancestors');
      assert(!retainedPredecessorIds.has(p.previousGeometryId), 'Selected native floor metadata must not fork a predecessor');
      retainedPredecessorIds.add(p.previousGeometryId);
    }
    assert(!retainedEvidenceIds.has(p.evidenceIds[0]), 'Retained native floor evidence IDs must be distinct');
    retainedEvidenceIds.add(p.evidenceIds[0]);
    assert(!association.sourceDocuments.some(source => p.evidenceIds.includes(source.evidenceId)),
      'Retained native geometry evidence cannot also be scene document evidence');
    const retained = await inspect(snapshot, reader);
    assert(Object.entries(nativeConverterPins).every(([key, digest]) => retained.profile.converter[key] === digest),
      'Retained native meshes require the current converter provenance pins');
    previous.push(retained);
  }
  for (const snapshot of input.successors) next.push(await inspect(snapshot, reader));
  const lineages = new Map();
  for (const floor of [...previous, ...next]) {
    const source = floor.profile.source, known = lineages.get(floor.snapshot.originalSha256);
    assert(!known || (known.originalBytes.compare(source.originalBytes) === 0
      && known.primaryLayerName === source.primaryLayerName && known.primaryLayerSHA256 === source.primaryLayerSHA256
      && known.primaryLayerBytes.compare(source.primaryLayerBytes) === 0), 'Immutable original content must preserve its byte/layer lineage');
    lineages.set(floor.snapshot.originalSha256, source);
  }
  const originalDigests = new Map();
  const retainOriginal = (id, digest, role) => {
    const known = originalDigests.get(id);
    assert(!known || (known.digest === digest && known.role === role), 'Original asset identity/content and purpose are immutable');
    originalDigests.set(id, { digest, role });
  };
  for (const source of association.sourceDocuments) retainOriginal(source.originalAssetId, source.originalSha256, 'evidence-original');
  for (const floor of [...previous, ...next]) retainOriginal(floor.snapshot.geometry.payload.originalAssetId, floor.snapshot.originalSha256, 'geometry-original');
  const nonGeometryIds = new Map();
  const reserve = (id, type) => {
    if (id === null) return;
    assert(!nonGeometryIds.has(id) || nonGeometryIds.get(id) === type, 'Known permanent record IDs cannot cross types');
    nonGeometryIds.set(id, type);
  };
  reserve(input.association.recordId, 'scene-association'); reserve(association.previousAssociationId, 'scene-association');
  reserve(association.buildingId, 'identity');
  for (const id of originalDigests.keys()) reserve(id, 'asset');
  for (const source of association.sourceDocuments) reserve(source.evidenceId, 'evidence');
  for (const mapping of association.roomMappings) {
    for (const target of mapping.targets) reserve(target.atlasPlaceId, 'identity');
    for (const id of mapping.evidenceIds) reserve(id, 'evidence');
  }
  for (const floor of [...previous, ...next]) {
    for (const id of floor.snapshot.geometry.payload.evidenceIds) reserve(id, 'evidence');
    for (const mapping of floor.snapshot.geometry.payload.mappings) {
      reserve(mapping.atlasId, 'identity'); for (const id of mapping.evidenceIds) reserve(id, 'evidence');
    }
    assert(floor.snapshot.geometry.payload.previousGeometryId !== floor.snapshot.geometry.recordId, 'Geometry cannot be its own predecessor');
  }
  const priorGeometryIds = new Set(previous.flatMap(floor => [floor.snapshot.geometry.recordId,
    floor.snapshot.geometry.payload.previousGeometryId]).filter(id => id !== null));
  for (const id of priorGeometryIds) {
    assert(!nonGeometryIds.has(id), 'Known predecessor geometry IDs cannot cross record types');
  }
  const byId = new Map(), byKey = new Map();
  for (const floor of previous) {
    const p = pin(floor); assert(!byId.has(p.geometryId) && !byKey.has(p.key), 'Ambiguous previous floor');
    assert(!nonGeometryIds.has(p.geometryId), 'Geometry record identity must be distinct from known non-geometry records');
    for (const field of ['workspaceId', 'homeId']) assert.equal(floor.snapshot.geometry[field], input.association[field]);
    byId.set(p.geometryId, floor); byKey.set(p.key, floor);
  }
  const replacements = new Map(), nextIds = new Set([...priorGeometryIds, ...nonGeometryIds.keys()]), nextKeys = new Set(byKey.keys());
  for (const floor of next) {
    const p = pin(floor), old = byId.get(floor.snapshot.geometry.payload.previousGeometryId);
    assert(old && !replacements.has(old.snapshot.geometry.recordId), 'Select one explicit successor per retained predecessor');
    assert(!nextIds.has(p.geometryId) && !nextKeys.has(p.key), 'Successors need distinct immutable IDs and floor keys');
    nextIds.add(p.geometryId); nextKeys.add(p.key);
    assert.equal(p.geometryVersion, old.snapshot.geometry.payload.geometryVersion + 1, 'Version must advance from the selected predecessor');
    assert(p.geometryVersion <= MAX_RETAINED_NATIVE_HISTORY_VERSIONS,
      'Proposed native successor cannot exceed the complete native history version limit');
    assert.equal(floor.snapshot.geometry.revision, 1, 'New geometry is append-only, not an in-place replace');
    for (const field of ['workspaceId', 'homeId']) assert.equal(floor.snapshot.geometry[field], old.snapshot.geometry[field]);
    replacements.set(old.snapshot.geometry.recordId, floor);
  }
  const bindings = new Map(), boundGeometryIds = new Set(), nativeFloorKeys = new Set(), sourceFloorKeys = new Set();
  for (const source of association.sourceFloors) {
    const key = sourceFloorKey(source);
    assert(!bindings.has(key), 'Ambiguous accepted source floor');
    assert(!nativeFloorKeys.has(source.nativeFloorKey), 'Native scene source floors require distinct descriptor keys');
    nativeFloorKeys.add(source.nativeFloorKey);
    assert(!sourceFloorKeys.has(source.sourceFloorKey), 'Native scene reader requires distinct source floor keys');
    sourceFloorKeys.add(source.sourceFloorKey);
    const old = byId.get(source.nativeGeometryId); assert(old, 'Every accepted floor needs its exact retained snapshot');
    const p = pin(old);
    assert.equal(source.nativeFloorKey, p.key); assert.equal(source.nativeGeometryRevision, p.geometryRevision);
    assert.equal(source.nativeOriginalAssetId, p.originalAssetId); assert.equal(source.nativeOriginalSha256, p.originalSha256);
    bindings.set(key, old); boundGeometryIds.add(p.geometryId);
  }
  assert.equal(boundGeometryIds.size, previous.length, 'Every retained snapshot must belong to the selected association');
  for (const anchor of receipt.anchors) assert(bindings.has(sourceFloorKey(anchor)), 'Every accepted receipt anchor needs a selected source-floor binding');
  const support = new Map();
  for (const row of bounded(input.roomSupport, LIMITS.support)) {
    closed(row, ['sourceRoomId', 'sourceFloorKey', 'sourceOriginalSha256', 'derivativeSha256', 'receiptSha256', 'meshIds']);
    text(row.sourceRoomId); const old = bindings.get(sourceFloorKey(row));
    assert(old && row.derivativeSha256 === old.snapshot.derivativeSha256 && row.receiptSha256 === receipt.canonicalSha256,
      'Room support must pin the prior floor and accepted receipt');
    bounded(row.meshIds, 512); assert(row.meshIds.length > 0 && new Set(row.meshIds).size === row.meshIds.length);
    for (const id of row.meshIds) assert(old.meshes.has(id), 'Support references a retained source mesh');
    assert(!support.has(roomKey(row)), 'Ambiguous room support'); support.set(roomKey(row), row);
  }
  // Native building evidence appends change every descriptor key, including untouched floors.
  const nativeBindingRefreshRequired = next.length > 0;
  const floorPlans = previous.map(old => {
    const candidate = replacements.get(old.snapshot.geometry.recordId) ?? old;
    const frameUnchanged = equal(old.frame, candidate.frame);
    const unchanged = [], changed = [], removed = [], added = [];
    for (const [id, digest] of old.meshes) {
      if (!candidate.meshes.has(id)) removed.push(id);
      else if (frameUnchanged && candidate.meshes.get(id) === digest) unchanged.push(id);
      else changed.push(id);
    }
    for (const id of candidate.meshes.keys()) if (!old.meshes.has(id)) added.push(id);
    const geometryUnchanged = frameUnchanged && changed.length + removed.length + added.length === 0;
    return { previous: pin(old), candidate: pin(candidate), status: candidate === old ? 'retained' : 'replacement-proposed',
      nativeBindingRefreshRequired, frameUnchanged, geometryUnchanged, meshes: { unchanged, changed, removed, added },
      previousFrame: clone(old.frame), candidateFrame: clone(candidate.frame),
      objectFingerprints: { previous: Object.fromEntries(old.meshes), candidate: Object.fromEntries(candidate.meshes) },
      priorPlacement: clone({ coordinateUnits: old.snapshot.geometry.payload.coordinateUnits,
        scale: old.snapshot.geometry.payload.scale, transform: old.snapshot.geometry.payload.transform }),
      placementReuse: candidate === old ? 'retained' : geometryUnchanged ? 'reviewable-exact-candidate' : 'requires-frame-review',
      qualification: { physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null } };
  });
  const mappingIds = new Set();
  const roomPlans = association.roomMappings.map(mapping => {
    assert(mapping.sourceAnchorIds.length <= 32, 'Native room entries require at most 32 source anchors');
    assert(!mappingIds.has(roomKey(mapping)), 'Ambiguous room mapping'); mappingIds.add(roomKey(mapping));
    const old = bindings.get(sourceFloorKey(mapping)); assert(old, 'Mapping needs an explicit accepted source floor');
    const sourceFloor = association.sourceFloors.find(s => sourceFloorKey(s) === sourceFloorKey(mapping));
    assert.equal(sourceFloor.sourceOriginalSha256, mapping.sourceOriginalSha256);
    const members = mapping.sourceAnchorIds.map(id => {
      const anchor = anchors.get(id); assert(anchor && anchor.sourceFloorKey === mapping.sourceFloorKey
        && anchor.sourceOriginalSha256 === mapping.sourceOriginalSha256, 'Mapping must match its accepted source anchors');
      return anchor;
    });
    const firstTarget = members[0]?.targets[0];
    assert(firstTarget && members.every(anchor => anchor.targets.length === 1
      && equal(anchor.targets[0], firstTarget)), 'Native room entries require one consistent accepted place across their source anchors');
    const targetKey = t => JSON.stringify([t.packagePlaceKey, t.packagePlaceUuid]);
    const targets = new Set(members.flatMap(anchor => anchor.targets.map(targetKey)));
    const actual = new Set(mapping.targets.map(targetKey));
    const unresolved = new Set(members.flatMap(anchor => anchor.unresolvedLabels));
    assert(targets.size === actual.size && [...targets].every(t => actual.has(t))
      && actual.size === mapping.targets.length && unresolved.size === mapping.unresolvedLabels.length
      && mapping.unresolvedLabels.every(label => unresolved.has(label)), 'Retain the complete target and unresolved union');
    const candidate = replacements.get(old.snapshot.geometry.recordId) ?? old;
    const dep = support.get(roomKey(mapping)), frameUnchanged = equal(old.frame, candidate.frame);
    if (dep) assert.equal(dep.sourceOriginalSha256, mapping.sourceOriginalSha256);
    const affected = dep ? dep.meshIds.filter(id => !frameUnchanged || old.meshes.get(id) !== candidate.meshes.get(id)) : [];
    const resolved = mapping.sourceAnchorIds.length > 0 && mapping.targets.length > 0 && mapping.unresolvedLabels.length === 0;
    const status = candidate === old ? 'retained' : !resolved ? 'unmatched' : !dep ? 'requires-support-review'
      : affected.length > 0 ? 'changed' : 'reuse-proposed';
    return { sourceRoomId: mapping.sourceRoomId, sourceFloorKey: mapping.sourceFloorKey,
      sourceOriginalSha256: mapping.sourceOriginalSha256, status,
      retainedMapping: clone(mapping), affectedMeshIds: affected, receiptId: receipt.receiptId,
      receiptSha256: receipt.canonicalSha256, candidateGeometryId: candidate.snapshot.geometry.recordId,
      nativeBindingRefreshRequired, spatialAcceptance: 'not-issued' };
  });
  for (const id of support.keys()) assert(mappingIds.has(id), 'Support must belong to a retained reviewed room mapping');
  const plan = { schema: 'houseatlas.assistant-scan-replacement-plan.v1', buildingId: association.buildingId,
    disposition: 'proposal-only', previousAssociation: clone(input.association), floors: floorPlans, rooms: roomPlans,
    priorScenePin: { recordId: input.association.recordId, revision: input.association.revision,
      workspaceId: input.association.workspaceId, homeId: input.association.homeId, associationVersion: association.associationVersion },
    provenanceSelection: 'caller-selected historical evidence; native current-head freshness unverified',
    nativeDescriptorRefresh: { required: nativeBindingRefreshRequired, scope: 'all-selected-floors',
      candidateGeometryIds: floorPlans.map(floor => floor.candidate.geometryId),
      currentKeys: 'unverified; read after native commit, never derived from this proposal' },
    roomSupportEvidence: clone(input.roomSupport),
    // These are copies of the selected historical input, not fresh native records.
    geometryHistory: { previous: previous.map(f => clone(f.snapshot.geometry)), candidates: next.map(f => clone(f.snapshot.geometry)) },
    retainedState: clone(input.retainedState), retainedStateSha256: sha(canonical(input.retainedState)),
    placementEvidenceApplications: input.retainedState.floorPlacementFacts.map(fact => {
      const old = fact && typeof fact === 'object' && !Array.isArray(fact)
        && previous.find(f => f.snapshot.geometry.recordId === fact.geometryId);
      const floorPlan = old && floorPlans.find(p => p.previous.geometryId === fact.geometryId);
      const exactPriorFrame = old && fact.originalSha256 === old.snapshot.originalSha256
        && fact.derivativeSha256 === old.snapshot.derivativeSha256;
      return { evidenceFact: clone(fact), applicability: !exactPriorFrame ? 'unqualified-frame'
        : floorPlan.status === 'retained' ? 'selected-prior-frame-only'
        : floorPlan.geometryUnchanged ? 'reviewable-exact-candidate' : 'prior-frame-only-requires-review' };
    }),
    producer: { nativeGeometryQualifierSha256: sha(readFileSync(new URL('../../backend/src/media/geometry_bundle.rs', import.meta.url))),
      retainedNativeHistoryVersionLimit: MAX_RETAINED_NATIVE_HISTORY_VERSIONS, retainedNativeConverterPins: { ...nativeConverterPins }, toolSha256: sha(readFileSync(fileURLToPath(import.meta.url))), atlasSchemaSha256: sha(atlasSchemaBytes),
      meshReaderSha256: sha(readFileSync(new URL('../../frontend/src/lantern/scans/mesh-profile.ts', import.meta.url))),
      compiledMeshDecoderSha256: sha(decoderBytes), compiledMeshDecoderBytes: decoderBytes.length },
    reversal: { kind: 'new-association-to-retained-prior-geometry', priorFloorPins: previous.map(pin),
      priorAssociationId: input.association.recordId, priorAssociationRevision: input.association.revision,
      priorReceiptId: receipt.receiptId, priorReceiptSha256: receipt.canonicalSha256, deletes: [] },
    nativeGap: 'Guarded successor admission and retained lineage-head reads are implemented by the native owner. This local proposal does not authenticate custody, complete history, current heads or capacity, and performs no adoption. Native commit requires fresh building/semantics/predecessor/evidence/asset guards; after commit re-read every floor descriptor and normally qualify a fresh scene association before mounting.',
    operationsExecuted: 0, originalsToOverwrite: [], identitiesToCreate: [], physicalAccuracy: 'not-established' };
  assert(Buffer.byteLength(JSON.stringify(plan)) <= LIMITS.manifestBytes, 'Plan exceeds output bound');
  const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } };
  freeze(plan); return plan;
}

/** Durable, content-addressed, create-only private artifact; never native custody.
 * Parent ownership/privacy are verified locally. Failures only clean this new child.
 */
export function writeReplacementArtifact(plan, directory) {
  assert.equal(plan.schema, 'houseatlas.assistant-scan-replacement-plan.v1');
  assert.equal(plan.disposition, 'proposal-only'); assert.equal(plan.operationsExecuted, 0);
  assert(isAbsolute(directory) && resolve(directory) === directory, 'Select a new canonical absolute artifact directory');
  const parent = dirname(directory), stat = lstatSync(parent);
  assert.equal(realpathSync(parent), parent); assert(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o077, 0, 'Artifact parent must be owned and private');
  const bytes = Buffer.from(canonical(plan) + '\n'); assert(bytes.length <= LIMITS.manifestBytes);
  const digest = sha(bytes), fileName = `replacement-plan.${digest}.json`;
  mkdirSync(directory, { mode: 0o700 }); // Exclusive: existing directories are never adopted.
  try {
    for (const [name, content] of [[fileName, bytes], ['SHA256SUMS', Buffer.from(`${digest}  ${fileName}\n`)]]) {
      const path = resolve(directory, name), fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, content); fchmodSync(fd, 0o400); fsyncSync(fd); } finally { closeSync(fd); }
    }
    for (const path of [directory, parent]) {
      const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    }
  } catch (error) { try { rmSync(directory, { recursive: true }); } catch {} throw error; }
  return { schema: 'houseatlas.assistant-scan-replacement-artifact.v1', sha256: digest, bytes: bytes.length, fileName,
    custody: 'private-local-proposal', nativeMutationCount: 0 };
}

/** CLI reads bounded selected local files and emits one new private artifact. */
export async function readPlanInput(path) {
  const raw = localFile(path, LIMITS.manifestBytes), input = JSON.parse(raw.toString('utf8'));
  closed(input, ['association', 'floors', 'successors', 'roomSupport', 'retainedState']);
  for (const field of ['floors', 'successors']) {
    input[field] = bounded(input[field], LIMITS.floors).map(snapshot => {
      closed(snapshot, ['key', 'exportLabel', 'originalSha256', 'derivativeSha256', 'geometry', 'meshFile']);
      const { meshFile, ...selection } = snapshot; text(meshFile);
      return { ...selection, meshBytes: new Uint8Array(localFile(resolve(dirname(path), meshFile), LIMITS.meshBytes)) };
    });
  }
  return input;
}
function localFile(path, max) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= max);
  const bytes = readFileSync(path); assert.equal(bytes.length, stat.size); return bytes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 4, 'Usage: node tools/geometry/scan-replacement-plan.mjs /absolute/private/selection.json /absolute/private/NEW-artifact-directory');
  const plan = await buildReplacementPlan(await readPlanInput(resolve(process.argv[2])));
  console.log(JSON.stringify(writeReplacementArtifact(plan, process.argv[3])));
}
