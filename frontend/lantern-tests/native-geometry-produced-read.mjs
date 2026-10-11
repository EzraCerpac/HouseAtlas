/** SOURCE ONLY: Root must separately review/register this exact two-step positive.
 * Read only exclusive synthetic native evidence emitted after healthy Rust cleanup.
 * No native writes, fetch, listener, browser, supplied grants or private specimen. */
import assert from 'node:assert/strict';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';
import { loadScanProfileSource } from './scan-mesh-read.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const keys = (value, fields) => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
};
async function loadClientSource() {
  const file = new URL('../integration/native-geometry-read-client.ts', import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, target] of [
    ['../src/numeric/decimal', await loadNumericSource('numeric/decimal.ts')],
    ['../src/lantern/scans/mesh-profile', await loadScanProfileSource()],
  ]) {
    const literal = JSON.stringify(specifier); assert(code.includes(literal));
    code = code.replaceAll(literal, JSON.stringify(target));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:'), `Unexpected runtime import ${match[1]}`);
  return dataUrl(code);
}
function localBytes(dir, filename, max) {
  const path = join(dir, filename), info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0);
  assert(info.size > 0 && info.size <= max);
  const bytes = new Uint8Array(readFileSync(path));
  assert.equal(bytes.byteLength, info.size); return bytes;
}
function responseRecord(dir, record, filename, mime, max) {
  keys(record, ['file', 'path', 'status', 'headers', 'bytes', 'sha256']);
  assert.equal(record.file, filename); assert.equal(record.status, 200);
  assert(Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= max);
  assert(/^[a-f0-9]{64}$/.test(record.sha256));
  const allowed = new Set(['content-type', 'content-length', 'cache-control',
    'x-content-type-options', 'content-security-policy', 'x-atlas-geometry-view']);
  assert(record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers));
  for (const [name, value] of Object.entries(record.headers)) {
    assert(allowed.has(name)); assert.equal(typeof value, 'string');
  }
  assert(Buffer.byteLength(JSON.stringify(record.headers)) <= 8192);
  assert.equal(record.headers['content-type'], mime);
  assert.equal(record.headers['cache-control'], 'private, no-store');
  assert.equal(record.headers['x-content-type-options'], 'nosniff');
  assert(/^[a-f0-9]{64}$/.test(record.headers['x-atlas-geometry-view']));
  const bytes = localBytes(dir, filename, max);
  assert.equal(bytes.byteLength, record.bytes); assert.equal(sha(bytes), record.sha256);
  return Object.freeze({ record, bytes });
}
function exactResponse(captured) {
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === captured.bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 65536, captured.bytes.byteLength);
      controller.enqueue(captured.bytes.slice(offset, end)); offset = end;
    },
  }), { status: captured.record.status, headers: captured.record.headers });
}

const dir = process.env.HOUSEATLAS_GEOMETRY_SEAM_EVIDENCE;
assert(dir && isAbsolute(dir), 'Select the exact new synthetic capture directory');
assert.equal(realpathSync(dir), dir);
const directory = lstatSync(dir);
assert(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o077) === 0);
const capture = JSON.parse(new TextDecoder().decode(localBytes(dir, 'produced-read.json', 16384)));
keys(capture, ['schema', 'basis', 'origin', 'scope', 'buildingId', 'descriptor', 'mesh', 'producer', 'cleanup']);
assert.equal(capture.schema, 'houseatlas.synthetic-native-produced-read.v1');
assert.equal(capture.basis, 'generated native healthy example; no converter or household data');
assert.equal(capture.origin, 'https://127.0.0.1:48743');
keys(capture.scope, ['workspaceId', 'homeId']);
assert.equal(capture.scope.workspaceId, '00000000-0000-4000-8000-000000000002');
assert.equal(capture.scope.homeId, '00000000-0000-4000-8000-000000000003');
assert.equal(capture.buildingId, '00000000-0000-4000-8000-000000000101');
assert.deepEqual(capture.cleanup, { nativeClientsAndLeasesDropped: true, nativeScratchRemoved: true,
  sameDescriptorAndMeshAfterStrictReopen: true });
assert.deepEqual(capture.producer, {
  profile: 'houseatlas.magicplan-authored-mesh.v1',
  codeSHA256: 'c9bf5c49ceba9b8dcace64102dc9e7d714731952dae4ca3c2f704ad1569caeb3',
  schemaSHA256: '7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863',
  profileSHA256: '3deec596c1fedef079c4e353432f7848ae4d5d403b9e1bec92fad2907ca18aff',
});
const descriptor = responseRecord(dir, capture.descriptor, 'descriptor.json', 'application/json', 1024 * 1024);
const mesh = responseRecord(dir, capture.mesh, 'mesh.json',
  'application/vnd.houseatlas.magicplan-authored-mesh+json', 8 * 1024 * 1024);
const basePath = `/api/atlas/geometry/v1/workspaces/${capture.scope.workspaceId}/homes/${capture.scope.homeId}/buildings/${capture.buildingId}`;
assert.equal(capture.descriptor.path, basePath);
assert.equal(capture.descriptor.headers['x-atlas-geometry-view'], capture.mesh.headers['x-atlas-geometry-view']);
assert(capture.mesh.path.startsWith(`${basePath}/frames/`));
const { createNativeGeometryReadClient } = await import(await loadClientSource());
const { readScanMesh, prepareMeshRender } = await import(await loadScanProfileSource());
// This is an explicit local synthetic binding observation, never native authority.
const binding = Object.freeze({ sessionIdentity: Object.freeze({}),
  expiresAt: new Date(Date.now() + 60_000).toISOString(), scope: Object.freeze(capture.scope) });
const listeners = new Set(), reads = [];
const client = createNativeGeometryReadClient({ origin: capture.origin, getBinding: () => binding,
  subscribeBinding(changed) { listeners.add(changed); return () => listeners.delete(changed); },
  async transport(url, init) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal(init.signal.aborted, false); reads.push(String(url));
    assert(reads.length <= 2);
    const response = reads.length === 1 ? descriptor : mesh;
    assert.equal(String(url), capture.origin + response.record.path);
    assert.equal(init.headers.Accept, response.record.headers['content-type']);
    return exactResponse(response); // Only captured bytes and actual allowlisted headers.
  },
});
try {
  const frame = await client.loadBuilding(capture.buildingId, new AbortController().signal);
  assert.equal(frame.floors.length, 1); assert.equal(client.isCurrent(frame), true);
  assert.equal(frame.viewKey, capture.descriptor.headers['x-atlas-geometry-view']);
  const floor = frame.floors[0], native = frame.descriptor.floors[0].floor;
  assert.equal(frame.descriptor.floors[0].readPath, capture.mesh.path);
  assert.equal(floor.derivativeSHA256, sha(mesh.bytes));
  assert.equal(native.derivativeSha256, floor.derivativeSHA256);
  assert.equal(native.originalSha256, floor.originalSHA256);
  assert.equal(floor.geometryRevision.token, '1'); assert.equal(floor.originalRevision.token, '1');
  assert.equal(floor.derivativeRevision.token, '1'); assert.equal(floor.evidenceRevision.token, '1');
  assert.deepEqual(floor.originalLicense, { status: 'unknown', reference: null });
  assert.deepEqual(floor.derivativeLicense, { status: 'permitted', reference: 'Synthetic fixture authored here; no provider license assertion' });
  const profile = await readScanMesh(frame.readPort, frame.viewKey, floor, new AbortController().signal);
  assert.equal(profile.source.originalSHA256, floor.originalSHA256);
  assert.equal(profile.source.floorLabel, floor.exportLabel);
  for (const field of ['codeSHA256', 'schemaSHA256', 'profileSHA256'])
    assert.equal(profile.converter[field], capture.producer[field]);
  assert.equal(profile.converter.usdcatVersion, 'synthetic example; no actual conversion claim');
  assert.equal(profile.authoredCoordinates.metersPerUnitToken, '1');
  assert.equal(profile.qualification.physicalScale, 'unknown');
  assert.equal(profile.qualification.floorAlignment, 'unknown');
  assert.equal(profile.qualification.stageToHouseTransform, null);
  assert.equal(profile.qualification.semanticRoomObjects.token, '0');
  assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0');
  assert.equal(profile.meshes[0].composedLocalToStageMatrixTokens[12], '5');
  assert.deepEqual(profile.meshes[0].ancestorChain, ['/Synthetic/Triangle', '/Synthetic']);
  const rendered = await prepareMeshRender(profile, new AbortController().signal);
  assert.equal(rendered.meshes.length, 1); assert.equal(rendered.meshes[0].triangles, 1);
  assert.equal(rendered.meshes[0].sourceObjectId, '/Synthetic/Triangle');
  assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0');
  assert.equal(client.isCurrent(frame), true);
  assert.deepEqual(reads, [capture.origin + capture.descriptor.path, capture.origin + capture.mesh.path]);
} finally { client.dispose(); }
assert.equal(listeners.size, 0);

console.log(JSON.stringify({ result: 'PASS synthetic native-produced descriptor/mesh -> actual TS reader',
  descriptorSHA256: sha(descriptor.bytes), meshSHA256: sha(mesh.bytes),
  clientDisposed: true, nativeScratchRemoved: true,
  qualification: 'No converter authenticity, private intake, browser, GPU or mounted availability claim' }));
