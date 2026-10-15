/** Healthy public synthetic IFC-derived GLB reader fixture. No private bytes,
 * conversion claim, native host, network, file write or provider mutation. */
import assert from 'node:assert/strict';
import { loadScanProfileSource } from './scan-mesh-read.mjs';
import { loadClientSource } from './native-geometry-read.mjs';

const profile = 'houseatlas.ifc-derived-glb.v1';
const originalSHA256 = 'a'.repeat(64), floorLabel = 'Synthetic IFC floor';
const converter = { name: 'synthetic-test-converter', version: '1', configSha256: 'b'.repeat(64) };
function glbFixture() {
  const binary = new Uint8Array(44), numbers = new DataView(binary.buffer);
  for (const [index, value] of [0,0,0, 1,0,0, 0,0,1].entries()) numbers.setFloat32(index * 4, value, true);
  for (const [index, value] of [0,1,2].entries()) numbers.setUint16(36 + index * 2, value, true);
  const document = { asset: { version: '2.0', extras: { houseatlasIfcDerivative: {
    profile, originalSha256: originalSHA256, originalBytes: 64, floorLabel, sourceUnits: 'mm', sourceUpAxis: 'Z',
    glbUnits: 'm', glbUpAxis: 'Y', sourceToGlb: { axisMap: ['x', 'z', '-y'], scale: 0.001 }, converter,
  } } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'SyntheticTriangle' }],
  meshes: [{ name: 'SyntheticTriangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  buffers: [{ byteLength: 44 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const json = new Uint8Array(Math.ceil(encoded.length / 4) * 4).fill(32); json.set(encoded);
  const bytes = new Uint8Array(12 + 8 + json.length + 8 + binary.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  view.setUint32(20 + json.length, binary.length, true); view.setUint32(24 + json.length, 0x004e4942, true);
  bytes.set(binary, 28 + json.length); return bytes;
}

const { readScanMesh, prepareMeshRender } = await import(await loadScanProfileSource());
const bytes = glbFixture(), derivativeSHA256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const floor = Object.freeze({ key: '1'.repeat(64), exportLabel: floorLabel, profile, originalSHA256, derivativeSHA256,
  originalContentType: 'application/x-step', derivativeContentType: 'model/gltf-binary', sourceUnits: 'unknown', declaredSourceUnits: 'mm', sourceUpAxis: 'unknown', declaredSourceUpAxis: 'Z',
  glbUnits: 'm', glbUpAxis: 'Y', sourceToGlb: { axisMap: ['x', 'z', '-y'], scale: 0.001 }, converter });
const port = { isCurrent: key => key === 'synthetic-view', subscribeInvalidation: () => () => undefined,
  async read(key, selected) { assert.equal(key, 'synthetic-view'); assert.equal(selected, floor);
    return { viewKey: key, floorKey: floor.key, bytes }; } };
const parsed = await readScanMesh(port, 'synthetic-view', floor, new AbortController().signal);
assert.equal(parsed.profile, profile); assert.equal(parsed.source.originalSHA256, originalSHA256);
assert.deepEqual(parsed.source.sourceToGlb.axisMap, ['x', 'z', '-y']);
assert.equal(parsed.authoredCoordinates.upAxis, 'Y'); assert.equal(parsed.counts.triangles, 1);
assert(Object.isFrozen(parsed) && Object.isFrozen(parsed.source) && Object.isFrozen(parsed.source.converter)
  && Object.isFrozen(parsed.source.sourceToGlb.axisMap) && Object.isFrozen(parsed.meshes)
  && Object.isFrozen(parsed.meshes[0].positionsLocalTokens) && Object.isFrozen(parsed.meshes[0].triangleIndicesTokens));
const rendered = await prepareMeshRender(parsed, new AbortController().signal);
assert.equal(rendered.meshes.length, 1); assert.equal(rendered.meshes[0].triangles, 1);
assert.equal(rendered.meshes[0].vertices[1], 0); // already Y-up; never rotate again
const { createNativeGeometryReadClient } = await import(await loadClientSource());
const scope = { workspaceId: '11111111-1111-1111-1111-111111111111', homeId: '22222222-2222-2222-2222-222222222222' };
const buildingId = '33333333-3333-3333-3333-333333333333', viewKey = '9'.repeat(64);
const path = `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
const readPath = `${path}/frames/${viewKey}/meshes/${floor.key}`;
const nativeFloor = { key: floor.key, exportLabel: floor.exportLabel, originalSha256: originalSHA256,
  derivativeSha256: derivativeSHA256, geometryId: '44444444-4444-4444-4444-444444444444', geometryRevision: 1,
  evidenceId: '55555555-5555-5555-5555-555555555555', evidenceRevision: 1,
  originalAssetId: '66666666-6666-6666-6666-666666666666', originalRevision: 1,
  derivativeAssetId: '77777777-7777-7777-7777-777777777777', derivativeRevision: 1,
  originalLicense: { status: 'unknown', reference: null }, derivativeLicense: { status: 'unknown', reference: null },
  profile, originalContentType: 'application/x-step', derivativeContentType: 'model/gltf-binary',
  sourceUnits: 'unknown', declaredSourceUnits: 'mm', sourceUpAxis: 'unknown', declaredSourceUpAxis: 'Z', glbUnits: 'm', glbUpAxis: 'Y', sourceToGlb: floor.sourceToGlb, converter };
const descriptor = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, profile: 'houseatlas.native-geometry.v2',
  scope, buildingId, viewKey, floors: [{ floor: nativeFloor, readPath }], physicalScale: 'unknown',
  floorAlignment: 'unknown', stageToHouseTransform: null }));
const binding = { sessionIdentity: {}, scope, expiresAt: new Date(Date.now() + 60_000).toISOString() };
let reads = 0;
const client = createNativeGeometryReadClient({ origin: 'https://synthetic.invalid', getBinding: () => binding,
  subscribeBinding: () => () => undefined,
  async transport(url, init) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
    const descriptorRead = ++reads === 1;
    assert.equal(url, `https://synthetic.invalid${descriptorRead ? path : readPath}`);
    assert.equal(init.headers.Accept, descriptorRead ? 'application/json' : 'model/gltf-binary');
    const body = descriptorRead ? descriptor : bytes;
    return new Response(body, { status: 200, headers: { 'Content-Type': descriptorRead ? 'application/json' : 'model/gltf-binary',
      'Content-Length': String(body.byteLength), 'X-Atlas-Geometry-View': viewKey } });
  } });
try {
  const frame = await client.loadBuilding(buildingId, new AbortController().signal);
  assert.equal(frame.descriptor.profile, 'houseatlas.native-geometry.v2');
  assert.equal(frame.floors[0].profile, profile);
  const actual = await readScanMesh(frame.readPort, frame.viewKey, frame.floors[0], new AbortController().signal);
  assert.equal(actual.profile, profile); assert.equal(reads, 2);
} finally { client.dispose(); }
console.log('PASS healthy synthetic IFC GLB digest, exact lineage, Y-up render; no native or converter acceptance');
