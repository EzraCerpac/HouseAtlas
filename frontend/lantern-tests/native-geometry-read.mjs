/** SOURCE ONLY until Root registers this exact command. One healthy synthetic
 * descriptor + streamed profile read through the actual client and parser.
 * No listener/browser/native store/import/denial or failure-control cases. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';
import { loadScanProfileSource, syntheticMeshFixture } from './scan-mesh-read.mjs';

const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
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
function streamed(bytes, mime, viewKey) {
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 37, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    },
  }), { status: 200, headers: { 'Content-Type': mime, 'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store', 'X-Atlas-Geometry-View': viewKey } });
}

export async function runHealthyNativeGeometryRead() {
  const { createNativeGeometryReadClient } = await import(await loadClientSource());
  const { readScanMesh } = await import(await loadScanProfileSource());
  const origin = 'https://synthetic.invalid';
  const scope = Object.freeze({ workspaceId: '11111111-1111-1111-1111-111111111111', homeId: '22222222-2222-2222-2222-222222222222' });
  const binding = Object.freeze({ sessionIdentity: Object.freeze({}), expiresAt: new Date(Date.now() + 60_000).toISOString(), scope });
  const buildingId = '33333333-3333-3333-3333-333333333333', viewKey = '9'.repeat(64), floorKey = '8'.repeat(64);
  const profileBytes = new TextEncoder().encode(JSON.stringify(syntheticMeshFixture()));
  const derivativeSHA256 = Buffer.from(await crypto.subtle.digest('SHA-256', profileBytes)).toString('hex');
  const path = `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
  const readPath = `${path}/frames/${viewKey}/meshes/${floorKey}`;
  const floor = { key: floorKey, exportLabel: 'Synthetic export A', originalSha256: 'a'.repeat(64), derivativeSha256: derivativeSHA256,
    geometryId: '44444444-4444-4444-4444-444444444444', geometryRevision: '9007199254740993',
    evidenceId: '55555555-5555-5555-5555-555555555555', evidenceRevision: '18446744073709551615',
    originalAssetId: '66666666-6666-6666-6666-666666666666', originalRevision: '9007199254740995',
    derivativeAssetId: '77777777-7777-7777-7777-777777777777', derivativeRevision: '9007199254740997',
    originalLicense: { status: 'unknown', reference: null }, derivativeLicense: { status: 'permitted', reference: 'Synthetic fixture permission only' } };
  let descriptor = JSON.stringify({ schemaVersion: 1, profile: 'houseatlas.magicplan-authored-mesh.v1', scope, buildingId, viewKey,
    floors: [{ floor, readPath }], physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null });
  // Actual native u64 JSON numbers, never rounded by a JS fixture literal.
  for (const key of ['geometryRevision', 'evidenceRevision', 'originalRevision', 'derivativeRevision'])
    descriptor = descriptor.replace(`"${key}":"${floor[key]}"`, `"${key}":${floor[key]}`);
  const descriptorBytes = new TextEncoder().encode(descriptor), reads = [], bindingListeners = new Set();
  const client = createNativeGeometryReadClient({ origin, getBinding: () => binding,
    subscribeBinding(changed) { bindingListeners.add(changed); return () => bindingListeners.delete(changed); },
    async transport(url, init) {
      reads.push(String(url)); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
      assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert.equal(init.signal.aborted, false);
      if (reads.length === 1) {
        assert.equal(String(url), origin + path); assert.equal(init.headers.Accept, 'application/json');
        return streamed(descriptorBytes, 'application/json', viewKey);
      }
      assert.equal(reads.length, 2); assert.equal(String(url), origin + readPath);
      assert.equal(init.headers.Accept, 'application/vnd.houseatlas.magicplan-authored-mesh+json');
      return streamed(profileBytes, 'application/vnd.houseatlas.magicplan-authored-mesh+json', viewKey);
    },
  });
  try {
    const frame = await client.loadBuilding(buildingId, new AbortController().signal);
    assert.equal(client.isCurrent(frame), true); assert.equal(frame.viewKey, viewKey); assert.equal(frame.floors.length, 1);
    const selected = frame.floors[0], native = frame.descriptor.floors[0].floor;
    assert.equal(frame.descriptor.floors[0].readPath, readPath); assert.equal(frame.descriptor.schemaVersion.token, '1');
    for (const key of ['geometryRevision', 'evidenceRevision', 'originalRevision', 'derivativeRevision'])
      { assert.equal(selected[key].token, floor[key]); assert.equal(selected[key], native[key]); }
    assert.equal(native.originalSha256, floor.originalSha256); assert.equal(native.derivativeSha256, derivativeSHA256);
    assert.equal(selected.originalSHA256, native.originalSha256); assert.equal(selected.derivativeSHA256, native.derivativeSha256);
    assert.deepEqual(selected.originalLicense, floor.originalLicense); assert.deepEqual(selected.derivativeLicense, floor.derivativeLicense);
    assert(Object.isFrozen(frame) && Object.isFrozen(frame.lease) && Object.isFrozen(frame.floors) && Object.isFrozen(selected));
    assert(Object.isFrozen(frame.descriptor.floors) && Object.isFrozen(frame.descriptor.scope) && Object.isFrozen(native) && Object.isFrozen(selected.originalLicense));
    let invalidations = 0;
    const unsubscribe = client.subscribeInvalidation(frame, () => { invalidations++; });
    const profile = await readScanMesh(frame.readPort, frame.viewKey, selected, new AbortController().signal);
    assert.equal(profile.source.originalSHA256, selected.originalSHA256); assert.equal(profile.source.floorLabel, selected.exportLabel);
    assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0.000'); assert.equal(profile.meshes[0].authoredDoubleSidedToken, '1');
    assert.equal(profile.qualification.physicalScale, 'unknown'); assert.equal(profile.qualification.floorAlignment, 'unknown');
    assert.equal(profile.qualification.stageToHouseTransform, null); assert.equal(profile.qualification.semanticRoomObjects.token, '0');
    assert.equal(client.isCurrent(frame), true); assert.equal(invalidations, 0); unsubscribe();
    assert.deepEqual(reads, [origin + path, origin + readPath]); assert.equal(bindingListeners.size, 1);
    console.log('PASS healthy streamed native descriptor/profile read; exact u64 revisions and owner-offered paths; synthetic only');
  } finally { client.dispose(); }
  assert.equal(bindingListeners.size, 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runHealthyNativeGeometryRead();
