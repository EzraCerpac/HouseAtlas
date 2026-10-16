/** Shared harness for the scan-cache persistence checks. A synthetic owner
 * serves descriptors and meshes over an owned loopback HTTP listener, so every
 * counted request is an actual GET received by it. Each "process" imports fresh
 * instances of the actual read client and scan-cache modules, creates a new
 * client and cache, and reaches stored bytes only through a SYNTHETIC
 * IndexedDB disk that outlives it. No browser, credential or user data. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { loadClientSource } from './native-geometry-read.mjs';
import { loadScanProfileSource, syntheticMeshFixture } from './scan-mesh-read.mjs';
import { createSyntheticIndexedDB } from './synthetic-indexeddb.mjs';

export const MESH_MIME = 'application/vnd.houseatlas.magicplan-authored-mesh+json';
export const workspaceId = '11111111-1111-1111-1111-111111111111', buildingId = '33333333-3333-3333-3333-333333333333';
export const homeA = '22222222-2222-2222-2222-222222222222', homeB = '22222222-2222-2222-2222-22222222222b';
export const actorA = 'synthetic-actor-a', actorB = 'synthetic-actor-b';
/** Present on every synthetic session; must never reach storage. */
export const CSRF_MARKER = 'synthetic-csrf-marker-never-stored';
const ROUTE = /^\/api\/atlas\/geometry\/v1\/workspaces\/([0-9a-f-]{36})\/homes\/([0-9a-f-]{36})\/buildings\/([0-9a-f-]{36})(?:\/frames\/([0-9a-f]{64})\/meshes\/([0-9a-f]{64}))?$/;
const DATA_PREFIX = 'data:text/javascript;base64,';
const dataUrl = code => `${DATA_PREFIX}${Buffer.from(code).toString('base64')}`;

export async function loadScanCacheSource() {
  const file = new URL('../integration/native-geometry-scan-cache.ts', import.meta.url);
  const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  assert(!/^\s*import\s/m.test(code), 'The scan cache has no runtime imports');
  return code;
}
export async function derivative(label) {
  const bytes = new TextEncoder().encode(JSON.stringify(syntheticMeshFixture(label)));
  return Object.freeze({ label, bytes, sha: Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex') });
}
// Like the native owner's digest, this changes with the offered record's
// revision, content or licence; the logical geometry record ID stays stable.
export const floorKey = (index, state) => createHash('sha256').update(JSON.stringify([
  index, state.revision, state.mesh.sha, state.license,
])).digest('hex');
const id = (prefix, index) => `${prefix}-${prefix.slice(0, 4)}-${prefix.slice(0, 4)}-${prefix.slice(0, 4)}-${String(index).padStart(12, '0')}`;

/** One building whose descriptor offers `floors` exports of the current
 * derivative. `viewKey` changes with any home edit. */
export async function startSyntheticOwner(initial) {
  const state = { viewKey: '9'.repeat(64), revision: '3', license: { status: 'permitted', reference: 'Synthetic fixture permission only' },
    floors: 1, ...initial };
  const reads = [], unexpected = [];
  const descriptor = homeId => {
    const path = `/api/atlas/geometry/v1/workspaces/${workspaceId}/homes/${homeId}/buildings/${buildingId}`;
    const floors = Array.from({ length: state.floors }, (_, index) => ({ floor: {
      key: floorKey(index, state), exportLabel: state.mesh.label, originalSha256: 'a'.repeat(64), derivativeSha256: state.mesh.sha,
      geometryId: id('44444444', index), geometryRevision: '5', evidenceId: id('55555555', index), evidenceRevision: '7',
      originalAssetId: id('66666666', index), originalRevision: '11', derivativeAssetId: id('77777777', index), derivativeRevision: state.revision,
      originalLicense: { status: 'unknown', reference: null }, derivativeLicense: state.license,
    }, readPath: `${path}/frames/${state.viewKey}/meshes/${floorKey(index, state)}` }));
    const json = JSON.stringify({ schemaVersion: 1, profile: 'houseatlas.magicplan-authored-mesh.v1', scope: { workspaceId, homeId },
      buildingId, viewKey: state.viewKey, floors, physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null });
    // Native u64 revisions are JSON numbers.
    return Buffer.from(json.replace(/"(geometryRevision|evidenceRevision|originalRevision|derivativeRevision)":"([0-9]+)"/g, '"$1":$2'));
  };
  const send = (response, bytes, mime) => {
    response.writeHead(200, { 'Content-Type': mime, 'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store', 'X-Atlas-Geometry-View': state.viewKey });
    response.end(bytes);
  };
  const server = createServer((request, response) => {
    const { pathname, search } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const match = ROUTE.exec(pathname);
    const refuse = reason => { unexpected.push(`${reason}: ${request.method} ${pathname}${search}`); response.writeHead(404); response.end(); };
    if (request.method !== 'GET' || request.socket.remoteAddress !== '127.0.0.1' || search) return refuse('not an owned GET');
    if (!match || match[1] !== workspaceId || match[3] !== buildingId) return refuse('unknown path');
    const [, , homeId, , viewKey, key] = match;
    if (!viewKey) {
      if (request.headers.accept !== 'application/json') return refuse('descriptor accept');
      reads.push({ kind: 'descriptor', homeId }); send(response, descriptor(homeId), 'application/json'); return;
    }
    // Only the current frame's owner-offered mesh path is served.
    const offered = Array.from({ length: state.floors }, (_, index) => floorKey(index, state));
    if (viewKey !== state.viewKey || !offered.includes(key) || request.headers.accept !== MESH_MIME) return refuse('not offered');
    reads.push({ kind: 'mesh', homeId, key }); send(response, Buffer.from(state.mesh.bytes), MESH_MIME);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, state, reads, unexpected,
    count: kind => reads.filter(read => read.kind === kind).length,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

/** Opens simulated processes against one owner. Each has fresh module, client
 * and cache memory; only `disk` carries anything from an earlier process. */
export async function createProcesses(owner) {
  const clientUrl = await loadClientSource(), cacheCode = await loadScanCacheSource();
  assert(clientUrl.startsWith(DATA_PREFIX));
  const clientCode = Buffer.from(clientUrl.slice(DATA_PREFIX.length), 'base64').toString();
  const { readScanMesh } = await import(await loadScanProfileSource());
  let opened = 0;
  return async function openProcess({ disk, actorId, homeId, limits }) {
    const tag = `\n// synthetic process ${++opened}\n`;
    const { createNativeGeometryReadClient } = await import(dataUrl(clientCode + tag));
    const cacheModule = await import(dataUrl(cacheCode + tag));
    const cache = cacheModule.openNativeGeometryScanCache(createSyntheticIndexedDB(disk), limits ? { limits } : {});
    // The canonical session as published by the session route.
    const session = Object.freeze({ schemaVersion: 1, actorId, csrfToken: CSRF_MARKER, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    const scope = Object.freeze({ workspaceId, homeId });
    let cacheRequests = 0;
    const client = createNativeGeometryReadClient({
      origin: owner.origin,
      getBinding: () => ({ sessionIdentity: session, actorId: session.actorId, expiresAt: session.expiresAt, scope }),
      subscribeBinding: () => () => undefined,
      retainMeshes: { sessionPresent: () => true, persist: async () => { cacheRequests++; return cache; } },
    });
    // The scans view's sequence: a fresh descriptor, then each floor through
    // the verifying mesh reader.
    const open = async (options, order) => {
      const before = { descriptors: owner.count('descriptor'), meshes: owner.count('mesh') };
      const frame = await client.loadBuilding(buildingId, new AbortController().signal, options);
      assert.equal(client.isCurrent(frame), true); assert.equal(frame.viewKey, owner.state.viewKey);
      for (const index of order ?? frame.floors.map((_, index) => index)) {
        const profile = await readScanMesh(frame.readPort, frame.viewKey, frame.floors[index], new AbortController().signal);
        assert.equal(profile.source.floorLabel, owner.state.mesh.label); assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0.000');
      }
      assert.equal(client.isCurrent(frame), true); assert.deepEqual(owner.unexpected, []);
      return { descriptors: owner.count('descriptor') - before.descriptors, meshes: owner.count('mesh') - before.meshes };
    };
    return {
      open, cache, database: cacheModule.SCAN_CACHE_DATABASE, limits: cacheModule.SCAN_CACHE_LIMITS,
      get cacheRequests() { return cacheRequests; },
      // A closed page: queued cache work settles, then every reference is dropped.
      async close() { client.dispose(); await cache.close(); },
    };
  };
}
