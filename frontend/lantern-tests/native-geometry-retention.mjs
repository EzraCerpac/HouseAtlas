/** SOURCE ONLY until Root registers this exact command. Healthy synthetic
 * transitions of page-memory mesh reuse through the actual read client and
 * parser: warm remount, unrelated home edit, explicit refresh, derivative
 * version/licence update, home-view reload, other home, session check, other
 * session and the entry bound. Every descriptor is still read; request counts
 * prove which meshes were read again. Fake transport only; no listener, browser,
 * native store, denial or failure-control cases. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadClientSource } from './native-geometry-read.mjs';
import { loadScanProfileSource, syntheticMeshFixture } from './scan-mesh-read.mjs';

const MESH_MIME = 'application/vnd.houseatlas.magicplan-authored-mesh+json';
const origin = 'https://synthetic.invalid', buildingId = '33333333-3333-3333-3333-333333333333';
const workspaceId = '11111111-1111-1111-1111-111111111111';
const homeA = '22222222-2222-2222-2222-222222222222', homeB = '22222222-2222-2222-2222-22222222222b';
const ROUTE = /^\/api\/atlas\/geometry\/v1\/workspaces\/([0-9a-f-]{36})\/homes\/([0-9a-f-]{36})\/buildings\/([0-9a-f-]{36})(?:\/frames\/([0-9a-f]{64})\/meshes\/([0-9a-f]{64}))?$/;

function streamed(bytes, mime, viewKey) {
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 4093, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    },
  }), { status: 200, headers: { 'Content-Type': mime, 'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store', 'X-Atlas-Geometry-View': viewKey } });
}
async function derivative(label) {
  const bytes = new TextEncoder().encode(JSON.stringify(syntheticMeshFixture(label)));
  return Object.freeze({ label, bytes, sha: Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex') });
}
const floorKey = index => (index + 1).toString(16).padStart(64, '8');
const id = (prefix, index) => `${prefix}-${prefix.slice(0, 4)}-${prefix.slice(0, 4)}-${prefix.slice(0, 4)}-${String(index).padStart(12, '0')}`;

/** A synthetic owner: one building whose descriptor offers `floors` exports of
 * the current derivative. `viewKey` changes with any home edit. */
function syntheticOwner(initial) {
  const state = { viewKey: '9'.repeat(64), revision: '3', license: { status: 'permitted', reference: 'Synthetic fixture permission only' },
    floors: 1, ...initial };
  const reads = [];
  const descriptor = (homeId) => {
    const path = `/api/atlas/geometry/v1/workspaces/${workspaceId}/homes/${homeId}/buildings/${buildingId}`;
    const floors = Array.from({ length: state.floors }, (_, index) => ({ floor: {
      key: floorKey(index), exportLabel: state.mesh.label, originalSha256: 'a'.repeat(64), derivativeSha256: state.mesh.sha,
      geometryId: id('44444444', index), geometryRevision: '5', evidenceId: id('55555555', index), evidenceRevision: '7',
      originalAssetId: id('66666666', index), originalRevision: '11', derivativeAssetId: id('77777777', index), derivativeRevision: state.revision,
      originalLicense: { status: 'unknown', reference: null }, derivativeLicense: state.license,
    }, readPath: `${path}/frames/${state.viewKey}/meshes/${floorKey(index)}` }));
    const json = JSON.stringify({ schemaVersion: 1, profile: 'houseatlas.magicplan-authored-mesh.v1', scope: { workspaceId, homeId },
      buildingId, viewKey: state.viewKey, floors, physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null });
    // Native u64 revisions are JSON numbers.
    return new TextEncoder().encode(json.replace(/"(geometryRevision|evidenceRevision|originalRevision|derivativeRevision)":"([0-9]+)"/g, '"$1":$2'));
  };
  async function transport(url, init) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error'); assert.equal(init.signal.aborted, false);
    const { origin: requested, pathname } = new URL(String(url)); assert.equal(requested, origin);
    const match = ROUTE.exec(pathname); assert(match, `Unexpected synthetic path ${pathname}`);
    const [, workspace, homeId, building, viewKey, key] = match;
    assert.equal(workspace, workspaceId); assert.equal(building, buildingId);
    if (!viewKey) {
      reads.push({ kind: 'descriptor', homeId }); assert.equal(init.headers.Accept, 'application/json');
      return streamed(descriptor(homeId), 'application/json', state.viewKey);
    }
    // Only the current frame's owner-offered mesh path is served.
    assert.equal(viewKey, state.viewKey); assert(Array.from({ length: state.floors }, (_, index) => floorKey(index)).includes(key));
    reads.push({ kind: 'mesh', homeId, key }); assert.equal(init.headers.Accept, MESH_MIME);
    return streamed(state.mesh.bytes, MESH_MIME, state.viewKey);
  }
  return { state, reads, transport, count: kind => reads.filter(read => read.kind === kind).length };
}

/** The host's canonical session object and completed view scope, published to
 * subscribers synchronously like the integration's quantity events. */
function syntheticHost() {
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(), listeners = new Set();
  const host = { session: Object.freeze({}), scope: Object.freeze({ workspaceId, homeId: homeA }), listeners,
    publish(change) { change(host); for (const listener of [...listeners]) listener(); },
    options: {
      origin,
      getBinding: () => host.session && host.scope ? { sessionIdentity: host.session, expiresAt, scope: host.scope } : null,
      subscribeBinding(changed) { listeners.add(changed); return () => listeners.delete(changed); },
    },
  };
  return host;
}

export async function runHealthyNativeGeometryRetention() {
  const { createNativeGeometryReadClient, NATIVE_GEOMETRY_RETAINED_LIMITS } = await import(await loadClientSource());
  const { readScanMesh } = await import(await loadScanProfileSource());
  const meshA = await derivative('Synthetic export A'), meshB = await derivative('Synthetic export B');
  assert.notEqual(meshA.sha, meshB.sha);
  assert.equal(NATIVE_GEOMETRY_RETAINED_LIMITS.entries, 6);

  // The same sequence the scans view uses: a fresh descriptor, then each floor
  // through the verifying mesh reader.
  const open = async (client, owner, options, order) => {
    const before = { descriptors: owner.count('descriptor'), meshes: owner.count('mesh') };
    const frame = await client.loadBuilding(buildingId, new AbortController().signal, options);
    assert.equal(client.isCurrent(frame), true); assert.equal(frame.viewKey, owner.state.viewKey);
    const profiles = [];
    for (const index of order ?? frame.floors.map((_, index) => index)) {
      const profile = await readScanMesh(frame.readPort, frame.viewKey, frame.floors[index], new AbortController().signal);
      assert.equal(profile.source.floorLabel, owner.state.mesh.label); assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0.000');
      profiles.push(profile);
    }
    assert.equal(client.isCurrent(frame), true);
    return { frame, descriptors: owner.count('descriptor') - before.descriptors, meshes: owner.count('mesh') - before.meshes };
  };
  const results = [];
  const step = async (label, client, owner, expected, options, order) => {
    const { descriptors, meshes } = await open(client, owner, options, order);
    assert.deepEqual({ descriptors, meshes }, expected, label); results.push(`${label}: ${descriptors} descriptor, ${meshes} mesh`);
  };

  {
    const owner = syntheticOwner({ mesh: meshA }), host = syntheticHost();
    const client = createNativeGeometryReadClient({ ...host.options, transport: owner.transport,
      retainMeshes: { sessionPresent: () => host.session !== null } });
    try {
      await step('first open', client, owner, { descriptors: 1, meshes: 1 });
      await step('warm remount', client, owner, { descriptors: 1, meshes: 0 });
      owner.state.viewKey = '7'.repeat(64);
      await step('unrelated home edit, same derivative', client, owner, { descriptors: 1, meshes: 0 });
      await step('explicit refresh', client, owner, { descriptors: 1, meshes: 1 }, { refresh: true });
      await step('remount after refresh', client, owner, { descriptors: 1, meshes: 0 });
      Object.assign(owner.state, { viewKey: '6'.repeat(64), revision: '4', mesh: meshB });
      await step('derivative version update', client, owner, { descriptors: 1, meshes: 1 });
      await step('remount after version update', client, owner, { descriptors: 1, meshes: 0 });
      owner.state.license = { status: 'permitted', reference: 'Synthetic fixture permission, second wording' };
      await step('derivative licence update', client, owner, { descriptors: 1, meshes: 1 });

      // A home-view reload leaves a scope gap under the same session object.
      host.publish(value => { value.scope = null; });
      host.publish(value => { value.scope = Object.freeze({ workspaceId, homeId: homeA }); });
      await step('home view reload, same session', client, owner, { descriptors: 1, meshes: 0 });

      host.publish(value => { value.scope = Object.freeze({ workspaceId, homeId: homeB }); });
      await step('other home, identical derivative facts', client, owner, { descriptors: 1, meshes: 1 });
      assert.equal(owner.reads.at(-1).homeId, homeB);
      host.publish(value => { value.scope = Object.freeze({ workspaceId, homeId: homeA }); });
      await step('back to the first home', client, owner, { descriptors: 1, meshes: 1 });
      assert.equal(owner.reads.at(-1).homeId, homeA);

      // A session check or sign-out clears the session before publishing one.
      const session = host.session;
      host.publish(value => { value.session = null; value.scope = null; });
      host.publish(value => { value.session = session; value.scope = Object.freeze({ workspaceId, homeId: homeA }); });
      await step('session check gap', client, owner, { descriptors: 1, meshes: 1 });
      host.publish(value => { value.session = Object.freeze({}); });
      await step('other session object', client, owner, { descriptors: 1, meshes: 1 });
      await step('remount in the new session', client, owner, { descriptors: 1, meshes: 0 });
    } finally { client.dispose(); }
    assert.equal(host.listeners.size, 0);
  }

  {
    // The entry bound evicts the least recently used mesh.
    const floors = NATIVE_GEOMETRY_RETAINED_LIMITS.entries + 1;
    const owner = syntheticOwner({ mesh: meshA, floors }), host = syntheticHost();
    const client = createNativeGeometryReadClient({ ...host.options, transport: owner.transport,
      retainMeshes: { sessionPresent: () => host.session !== null } });
    try {
      await step(`first open of ${floors} floors`, client, owner, { descriptors: 1, meshes: floors });
      await step('six most recent floors', client, owner, { descriptors: 1, meshes: 0 }, undefined, [1, 2, 3, 4, 5, 6]);
      await step('least recently used floor', client, owner, { descriptors: 1, meshes: 1 }, undefined, [0]);
      assert.equal(owner.reads.at(-1).key, floorKey(0));
    } finally { client.dispose(); }
  }

  {
    // Without the option every open reads every mesh, as before.
    const owner = syntheticOwner({ mesh: meshA }), host = syntheticHost();
    const client = createNativeGeometryReadClient({ ...host.options, transport: owner.transport });
    try {
      await step('first open without retention', client, owner, { descriptors: 1, meshes: 1 });
      await step('remount without retention', client, owner, { descriptors: 1, meshes: 1 });
    } finally { client.dispose(); }
  }
  for (const line of results) console.log(`PASS ${line}`);
  console.log('PASS healthy page-memory mesh reuse transitions; fresh descriptor on every open; synthetic only');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runHealthyNativeGeometryRetention();
