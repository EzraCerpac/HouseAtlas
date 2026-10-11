/** Assistant-managed filesystem intake through the existing native owners. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNativeImportRuntime } from './native-scan-import-runtime.mjs';
import { createNativeCurlTransport } from './native-scan-import-transport.mjs';

export const IMPORT_LIMITS = Object.freeze({ manifest: 2 * 1024 * 1024, floors: 3,
  original: 10 * 1024 * 1024, derivative: 8 * 1024 * 1024, events: 128,
  // A bounded 1 MiB wire string can expand sixfold when JSON escapes control
  // bytes. This is journal storage, not a larger request/response allowance.
  eventBytes: 8 * 1024 * 1024, wireBytes: 1024 * 1024, metadataBytes: 16 * 1024, pathBytes: 8192 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
function closed(value, fields) { assert(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...fields].sort()); }
const id = value => { assert(typeof value === 'string' && UUID.test(value), 'Expected a native UUID'); return value; };
const text = (value, bound) => { assert(typeof value === 'string' && value.trim() && [...value].length <= bound && value.isWellFormed()); return value; };
function filePin(pin) { closed(pin, ['path', 'bytes', 'sha256', 'filename']); assert(typeof pin.path === 'string' && isAbsolute(pin.path)); assert(typeof pin.sha256 === 'string' && SHA.test(pin.sha256));
  assert(Number.isSafeInteger(pin.bytes) && pin.bytes > 0); text(pin.filename, 255); assert(!/[\\/\u0000-\u001f]/.test(pin.filename)); }
async function canonicalPath(path) {
  assert(isAbsolute(path) && resolve(path) === path, 'Use an absolute canonical path');
  assert.equal(await realpath(path), path, 'Symlink paths are not accepted');
}
export async function readPinnedFile(pin, limit) {
  filePin(pin); assert(pin.bytes <= limit); await canonicalPath(pin.path);
  const before = await lstat(pin.path); assert(before.isFile() && !before.isSymbolicLink());
  const handle = await open(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat(); assert(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === pin.bytes);
    const bytes = new Uint8Array(pin.bytes); let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(result.bytesRead > 0, 'Selected file shortened'); offset += result.bytesRead;
    }
    const end = await handle.stat(), current = await lstat(pin.path);
    assert(end.size === stat.size && end.mtimeMs === stat.mtimeMs && end.ctimeMs === stat.ctimeMs
      && current.ino === stat.ino && current.dev === stat.dev && current.size === stat.size && current.mtimeMs === stat.mtimeMs,
    'Selected file changed while reading');
    assert.equal(sha256(bytes), pin.sha256, 'Selected source bytes differ'); return bytes;
  } finally { await handle.close(); }
}
export async function validateImportManifest(pin, runtime, signal = new AbortController().signal) {
  const raw = await readPinnedFile(pin, IMPORT_LIMITS.manifest);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  closed(manifest, ['schema', 'origin', 'scope', 'buildingId', 'semanticsId', 'reason', 'statement', 'sourceLicense',
    'expectedCurrentGeometryIds', 'floors', 'scene']);
  assert.equal(manifest.schema, 'houseatlas.agent-native-scan-import.v1');
  const origin = new URL(manifest.origin); assert(origin.protocol === 'https:' && origin.origin === manifest.origin && !origin.username && !origin.password);
  closed(manifest.scope, ['workspaceId', 'homeId']); id(manifest.scope.workspaceId); id(manifest.scope.homeId);
  id(manifest.buildingId); id(manifest.semanticsId); text(manifest.reason, 1024); text(manifest.statement, 4096);
  closed(manifest.sourceLicense, ['status', 'reference']); assert(['unknown', 'permitted', 'restricted'].includes(manifest.sourceLicense.status));
  if (manifest.sourceLicense.reference !== null) text(manifest.sourceLicense.reference, 4096);
  assert(Array.isArray(manifest.expectedCurrentGeometryIds) && manifest.expectedCurrentGeometryIds.length <= IMPORT_LIMITS.floors);
  manifest.expectedCurrentGeometryIds.forEach(id); assert.equal(new Set(manifest.expectedCurrentGeometryIds).size, manifest.expectedCurrentGeometryIds.length);
  assert(Array.isArray(manifest.floors) && manifest.floors.length > 0 && manifest.floors.length <= IMPORT_LIMITS.floors);
  const keys = new Set(), previous = new Set(), prepared = [];
  for (const floor of manifest.floors) {
    signal.throwIfAborted(); closed(floor, ['sourceFloorKey', 'sourceOriginalSha256', 'exportLabel', 'original', 'derivative', 'previousGeometryId']);
    text(floor.sourceFloorKey, 512); assert(typeof floor.sourceOriginalSha256 === 'string' && SHA.test(floor.sourceOriginalSha256)); text(floor.exportLabel, 4096);
    const source = JSON.stringify([floor.sourceFloorKey, floor.sourceOriginalSha256]); assert(!keys.has(source)); keys.add(source);
    if (floor.previousGeometryId !== null) { id(floor.previousGeometryId); assert(manifest.expectedCurrentGeometryIds.includes(floor.previousGeometryId));
      assert(!previous.has(floor.previousGeometryId)); previous.add(floor.previousGeometryId); }
    const original = await readPinnedFile(floor.original, IMPORT_LIMITS.original);
    const derivative = await readPinnedFile(floor.derivative, IMPORT_LIMITS.derivative);
    const profile = await runtime.mesh.readScanMesh({ isCurrent: () => !signal.aborted,
      subscribeInvalidation: () => () => {}, read: async () => ({ viewKey: 'selected-files', floorKey: source, bytes: derivative }) },
    'selected-files', { key: source, exportLabel: floor.exportLabel, originalSHA256: floor.original.sha256,
      derivativeSHA256: floor.derivative.sha256 }, signal);
    assert.equal(profile.source.originalBytes.token, String(original.length), 'Derivative original byte count differs');
    assert.equal(profile.source.fileName, floor.original.filename, 'Derivative original filename differs');
    assert.equal(profile.converter.codeSHA256, 'c9bf5c49ceba9b8dcace64102dc9e7d714731952dae4ca3c2f704ad1569caeb3');
    assert.equal(profile.converter.schemaSHA256, '7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863');
    assert.equal(profile.converter.profileSHA256, '3deec596c1fedef079c4e353432f7848ae4d5d403b9e1bec92fad2907ca18aff');
    prepared.push({ selected: floor, original: new Blob([original], { type: 'model/vnd.usdz+zip' }),
      derivative: new Blob([derivative], { type: 'application/vnd.houseatlas.magicplan-authored-mesh+json' }) });
  }
  assert(manifest.scene === null || manifest.scene && typeof manifest.scene === 'object' && !Array.isArray(manifest.scene));
  let scene = null;
  if (manifest.scene !== null) {
    const spec = manifest.scene;
    closed(spec, ['primary', 'historical', 'sourceFloors', 'roomMappings', 'statement', 'reason', 'confirmDrawingSupport']);
    assert(Array.isArray(spec.sourceFloors) && spec.sourceFloors.length === manifest.floors.length);
    const selectedKeys = new Set();
    for (const item of spec.sourceFloors) {
      closed(item, ['sourceFloorKey', 'sourceOriginalSha256']);
      assert(manifest.floors.some(f => f.sourceFloorKey === item.sourceFloorKey && f.sourceOriginalSha256 === item.sourceOriginalSha256));
      const key = JSON.stringify([item.sourceFloorKey, item.sourceOriginalSha256]); assert(!selectedKeys.has(key)); selectedKeys.add(key);
    }
    assert(manifest.sourceLicense.status === 'unknown' && manifest.sourceLicense.reference === null,
      'The reviewed documentary adapter requires explicit unknown license');
    const input = async pin => ({ buildingId: manifest.buildingId,
      file: new Blob([await readPinnedFile(pin, IMPORT_LIMITS.derivative)], { type: 'text/plain' }),
      filename: pin.filename, byteSize: pin.bytes, sha256: pin.sha256,
      statement: spec.statement, reason: spec.reason, sourceLicense: manifest.sourceLicense });
    scene = { buildingId: manifest.buildingId, primary: await input(spec.primary), historical: await input(spec.historical),
      sourceFloors: spec.sourceFloors, roomMappings: spec.roomMappings, statement: spec.statement, reason: spec.reason,
      confirmDrawingSupport: spec.confirmDrawingSupport };
    assert(runtime.scene?.preflightNativeScanScene, 'Load the actual reviewed scene preflight');
    await runtime.scene.preflightNativeScanScene(scene, signal, manifest.scope);
  }
  return { manifest, manifestSha256: sha256(raw), floors: prepared, scene };
}

async function privateDirectory(path) {
  await canonicalPath(path); const stat = await lstat(path);
  assert(stat.isDirectory() && (stat.mode & 0o777) === 0o700, 'Use a private mode0700 directory');
}
async function durableFile(directory, name, bytes) {
  const file = await open(resolve(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}
export async function openImportJournal(path, { create = false } = {}) {
  assert(isAbsolute(path) && resolve(path) === path); await privateDirectory(dirname(path));
  if (create) { await mkdir(path, { mode: 0o700 }); const parent = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); } }
  await privateDirectory(path);
  const names = (await readdir(path)).sort(); assert(names.length <= IMPORT_LIMITS.events);
  const events = []; let previousSha256 = null;
  for (const name of names) {
    assert.equal(name, `${String(events.length + 1).padStart(4, '0')}.json`, 'Journal closure differs');
    const absolute = resolve(path, name), stat = await lstat(absolute);
    assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600 && stat.size <= IMPORT_LIMITS.eventBytes);
    const bytes = await readPinnedFile({ path: absolute, filename: name, bytes: stat.size,
      sha256: await (async () => { const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { return sha256(await handle.readFile()); } finally { await handle.close(); } })() }, IMPORT_LIMITS.eventBytes);
    const event = JSON.parse(bytes.toString ? new TextDecoder().decode(bytes) : bytes);
    closed(event, ['schema', 'sequence', 'previousSha256', 'at', 'kind', 'data']);
    assert(event.schema === 'houseatlas.agent-import-event.v1' && event.sequence === events.length + 1 && event.previousSha256 === previousSha256);
    events.push(event); previousSha256 = sha256(bytes);
  }
  return { events,
    async append(kind, data) {
      assert(events.length < IMPORT_LIMITS.events); text(kind, 128);
      const event = { schema: 'houseatlas.agent-import-event.v1', sequence: events.length + 1, previousSha256,
        at: new Date().toISOString(), kind, data };
      const bytes = JSON.stringify(event) + '\n'; assert(Buffer.byteLength(bytes) <= IMPORT_LIMITS.eventBytes);
      await durableFile(path, `${String(event.sequence).padStart(4, '0')}.json`, bytes);
      events.push(event); previousSha256 = sha256(bytes); return event;
    },
  };
}

export async function createAgentContext(manifest, transport, runtime, signal) {
  const body = async response => { assert(response.status === 200, `Native access returned HTTP${response.status}`);
    const bytes = await response.arrayBuffer(); assert(bytes.byteLength <= 1024 * 1024); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); };
  assert.equal(runtime.session.decodeAuthMode(await body(await transport('/api/atlas/auth/mode', { signal }))), 'trusted-proxy');
  let bootstrap;
  try { bootstrap = runtime.session.decodeSessionInfo(await body(await transport('/api/atlas/auth/proxy', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}', signal }))); }
  catch { throw new Error('Native sign-in issuance is unavailable; retirement of any new expiring session is unconfirmed'); }
  let session = bootstrap, admission;
  try {
    session = runtime.session.decodeSessionInfo(await body(await transport('/api/atlas/auth/session', { signal })));
    assert(Date.parse(session.expiresAt) > Date.now());
    admission = await body(await transport(`/api/atlas/stock/v3/workspaces/${manifest.scope.workspaceId}/homes/${manifest.scope.homeId}/admission`, { signal }));
    closed(admission, ['schemaVersion', 'scope', 'commandIds', 'nativeCommandIds', 'revision', 'maximumReasonCodePoints']);
    assert.equal(admission.schemaVersion, 3); assert.deepEqual(admission.scope, manifest.scope);
    assert(Array.isArray(admission.commandIds) && admission.commandIds.every(value => typeof value === 'string'));
    assert(Array.isArray(admission.nativeCommandIds) && admission.nativeCommandIds.every(value =>
      ['atlas.asset.create', 'atlas.scene-association.create'].includes(value)));
    assert.equal(new Set(admission.nativeCommandIds).size, admission.nativeCommandIds.length);
    assert(!admission.commandIds.some(value => admission.nativeCommandIds.includes(value)), 'Native admission must remain separate from generic Stock');
    const genericRequired = ['atlas.evidence.create', 'atlas.identity.replace', 'atlas.batch.execute', 'atlas.geometry.create'];
    const nativeRequired = ['atlas.asset.create', ...(manifest.scene ? ['atlas.scene-association.create'] : [])];
    assert(genericRequired.every(command => admission.commandIds.includes(command)) &&
      nativeRequired.every(command => admission.nativeCommandIds.includes(command)), 'Current native admission does not permit this import');
    text(admission.revision, 256); assert.equal(admission.maximumReasonCodePoints, 1024);
    // Only the actual current server response supplies these native capabilities.
    // Existing native clients share a commandIds type; normalize it privately.
    // The server's generic Stock/MCP catalogue and POST authorization stay separate.
    admission = Object.freeze({ ...admission, genericCommandIds: Object.freeze([...admission.commandIds]),
      nativeCommandIds: Object.freeze([...admission.nativeCommandIds]),
      commandIds: Object.freeze([...admission.commandIds, ...admission.nativeCommandIds]) });
  } catch (error) {
    if (session) {
      try { const response = await transport('/api/atlas/auth/logout', { method: 'POST', headers: { 'X-Atlas-CSRF': session.csrfToken }, body: '{}' });
        await response.body?.cancel(); assert(response.ok); }
      catch { throw new Error('Native setup failed; retirement of this new expiring session is unconfirmed'); }
    }
    throw error;
  }
  const listeners = new Set(), sessionIdentity = Object.freeze({}), scope = Object.freeze({ ...manifest.scope });
  // Editing eligibility comes from the genuine current admission, not a supplied role.
  let current = { sessionIdentity, session, scope, view: Object.freeze({ scope, canEdit: true }), admission };
  const readBinding = Object.freeze({ sessionIdentity, expiresAt: session.expiresAt, scope });
  return { getContext: () => current, subscribe: changed => { listeners.add(changed); return () => listeners.delete(changed); },
    getBinding: () => current && readBinding,
    close: async () => { const saved = current; current = null; for (const changed of listeners) changed(); listeners.clear();
      if (saved) { const response = await transport('/api/atlas/auth/logout', { method: 'POST', headers: { 'X-Atlas-CSRF': saved.session.csrfToken }, body: '{}' });
        await response.body?.cancel(); assert(response.ok, 'Own session logout is unconfirmed'); } },
  };
}
export function journalTransport(base, journal) {
  return async (input, init = {}) => {
    const path = new URL(typeof input === 'string' ? input : input.url, 'https://selected.invalid').pathname;
    const mutation = init.method === 'POST' && !path.startsWith('/api/atlas/auth/') && path !== '/api/atlas/retained-intent';
    if (mutation) {
      const metadata = init.body instanceof FormData ? init.body.get('metadata') : null;
      assert(Buffer.byteLength(path) <= IMPORT_LIMITS.pathBytes);
      assert(metadata === null || typeof metadata === 'string' && Buffer.byteLength(metadata) <= IMPORT_LIMITS.metadataBytes);
      assert(typeof init.body !== 'string' || Buffer.byteLength(init.body) <= IMPORT_LIMITS.wireBytes);
      await journal.append('dispatch', { path, method: 'POST', metadata, body: typeof init.body === 'string' ? init.body : null });
    }
    try {
      const response = await base(input, init);
      if (mutation) { const raw = await boundedJournalResponse(response.clone(), init.signal);
        await journal.append('response', { path, status: response.status, body: raw }); }
      return response;
    } catch (error) { if (mutation) await journal.append('unknown', { path, message: 'Response or local durable receipt unavailable; do not resend' }); throw error; }
  };
}
async function boundedJournalResponse(response, signal) {
  const reader = response.body?.getReader(); assert(reader);
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks = []; let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const next = await reader.read(); signal?.throwIfAborted();
      if (next.done) break;
      assert(next.value instanceof Uint8Array && next.value.length <= IMPORT_LIMITS.wireBytes - total && chunks.length < 8192);
      total += next.value.length; chunks.push(next.value);
    }
    const combined = new Uint8Array(total); let offset = 0;
    for (const part of chunks) { combined.set(part, offset); offset += part.length; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(combined);
  } catch (error) { abort(); throw error; }
  finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
const compareIds = (a, b) => assert.deepEqual([...a].sort(), [...b].sort(), 'Current native floor selection changed');
const licensesMatch = (floor, selected) => [floor.originalLicense, floor.derivativeLicense].every(license =>
  license.status === selected.status && license.reference === selected.reference);
function sceneInputForGeometry(selected, mappings) {
  const sourceFloors = selected.scene.sourceFloors.map(source => {
    const mapping = mappings.find(item => item.sourceFloorKey === source.sourceFloorKey
      && item.sourceOriginalSha256 === source.sourceOriginalSha256);
    assert(mapping, 'Reviewed source has no verified native geometry');
    return { ...source, nativeGeometryId: mapping.geometryId };
  });
  return { ...selected.scene, sourceFloors };
}
function planNativeFloors(floors, frame, manifest) {
  const used = new Set();
  return floors.map(item => {
    const floor = item.selected;
    const matches = frame.floors.filter(row => row.originalSHA256 === floor.original.sha256 && row.derivativeSHA256 === floor.derivative.sha256
      && (floor.previousGeometryId !== null ? row.geometryId === floor.previousGeometryId : !used.has(row.geometryId)));
    assert(matches.length <= 1, 'Retained geometry is ambiguous');
    if (matches.length && licensesMatch(matches[0], manifest.sourceLicense)) {
      const native = matches[0]; assert(!used.has(native.geometryId)); used.add(native.geometryId);
      return { item, reusedGeometryId: native.geometryId };
    }
    assert(!matches.length || floor.previousGeometryId !== null, 'A license correction requires an explicit native predecessor');
    if (floor.previousGeometryId !== null) assert(frame.floors.some(row => row.geometryId === floor.previousGeometryId));
    return { item, reusedGeometryId: null };
  });
}
export async function applyNativeImport(selected, runtime, context, transport, journal, signal, sceneOwner = null) {
  const { manifest, floors } = selected;
  await journal.append('selection', { manifestSha256: selected.manifestSha256, manifest, provenance: runtime.provenance });
  const reader = runtime.read.createNativeGeometryReadClient({ getBinding: context.getBinding, subscribeBinding: context.subscribe,
    origin: manifest.origin, transport });
  const write = runtime.write.createNativeGeometryWriteClient({ ...context, transport });
  const associate = runtime.association.createNativeGeometryAssociationClient({ ...context, origin: manifest.origin, transport });
  const mappings = [], currentIds = new Set(manifest.expectedCurrentGeometryIds);
  try {
    let frame = await reader.loadBuilding(manifest.buildingId, signal);
    compareIds(frame.floors.map(floor => floor.geometryId), currentIds);
    const planned = planNativeFloors(floors, frame, manifest);
    const creating = planned.filter(part => part.reusedGeometryId === null);
    if (selected.scene) {
      // A scene binds the entire final current frame, including untouched
      // lineages. Validate that known coverage before any geometry custody.
      const replacements = new Set(creating.map(part => part.item.selected.previousGeometryId).filter(value => value !== null));
      const reused = new Set(planned.map(part => part.reusedGeometryId).filter(value => value !== null));
      const finalCount = frame.floors.length + creating.filter(part => part.item.selected.previousGeometryId === null).length;
      assert(finalCount <= IMPORT_LIMITS.floors && planned.length === finalCount
        && selected.scene.sourceFloors.length === planned.length
        && frame.floors.every(floor => replacements.has(floor.geometryId) || reused.has(floor.geometryId)),
      'Reviewed scene must cover the complete projected native floor set within the three-floor bound');
    }
    if (sceneOwner) {
      const captured = await sceneOwner.capturePriorScene(manifest.buildingId, signal);
      await journal.append('scene-predecessor', { buildingId: manifest.buildingId, status: captured.status,
        recordId: captured.status === 'available' ? captured.recordId : null });
    }
    // Capacity covers the complete ordered set before any original/derivative
    // custody. It observes current reads; actual prepare still uses fresh guards.
    if (creating.length) {
      const owner = associate.getBinding(); assert(owner);
      const capacity = await associate.reserve(owner, { buildingId: manifest.buildingId, semanticsId: manifest.semanticsId,
        floors: creating.map(part => ({ previousGeometryId: part.item.selected.previousGeometryId })),
        statement: manifest.statement, reason: manifest.reason }, signal);
      await journal.append('geometry-capacity-observation', {
        identityRevision: capacity.identityRevision.token, semanticsRevision: capacity.semanticsRevision.token,
        floors: capacity.floors, applicationMutation: false,
      });
    }
    const used = new Set();
    for (const plan of planned) {
      const item = plan.item;
      const floor = item.selected;
      const matches = frame.floors.filter(row => row.originalSHA256 === floor.original.sha256 && row.derivativeSHA256 === floor.derivative.sha256
        && (floor.previousGeometryId !== null ? row.geometryId === floor.previousGeometryId : !used.has(row.geometryId)));
      assert(matches.length <= 1, 'Retained geometry is ambiguous');
      let native;
      if (matches.length && licensesMatch(matches[0], manifest.sourceLicense)) {
        native = matches[0]; assert(!used.has(native.geometryId));
        assert.equal(native.geometryId, plan.reusedGeometryId, 'Current reuse selection changed after capacity observation');
        assert(floor.previousGeometryId === null || floor.previousGeometryId === native.geometryId,
          'Selected predecessor differs from retained identical floor');
        await journal.append('reused', { sourceFloorKey: floor.sourceFloorKey, sourceOriginalSha256: floor.sourceOriginalSha256, geometryId: native.geometryId });
      } else {
        assert.equal(plan.reusedGeometryId, null, 'Current reuse eligibility changed after capacity observation');
        assert(!matches.length || floor.previousGeometryId !== null,
          'A license correction requires an explicit native predecessor');
        if (floor.previousGeometryId !== null) assert(frame.floors.some(row => row.geometryId === floor.previousGeometryId));
        const binding = write.getBinding(); assert(binding && write.canPrepare(binding));
        const original = await write.prepareOriginal(binding, { file: item.original, filename: floor.original.filename, reason: manifest.reason,
          sourceLicense: manifest.sourceLicense, contentType: 'model/vnd.usdz+zip' }, signal);
        const originalReceipt = await write.commit(original, signal);
        await journal.append('custody', { kind: 'original', sourceFloorKey: floor.sourceFloorKey, assetId: originalReceipt.assetId,
          originalRequestBody: originalReceipt.originalRequestBody, responseBody: originalReceipt.responseBody });
        const derivative = await write.prepareDerivative(binding, originalReceipt, { file: item.derivative,
          filename: floor.derivative.filename, reason: manifest.reason, sourceLicense: manifest.sourceLicense }, signal);
        const derivativeReceipt = await write.commit(derivative, signal);
        await journal.append('custody', { kind: 'derivative', sourceFloorKey: floor.sourceFloorKey, assetId: derivativeReceipt.assetId,
          originalRequestBody: derivativeReceipt.originalRequestBody, responseBody: derivativeReceipt.responseBody });
        const owner = associate.getBinding(); assert(owner);
        const admission = await associate.load(owner, { buildingId: manifest.buildingId, semanticsId: manifest.semanticsId,
          originalAssetId: originalReceipt.assetId, derivativeAssetId: derivativeReceipt.assetId,
          previousGeometryId: floor.previousGeometryId }, signal);
        const prepared = associate.prepare(admission, { statement: manifest.statement, reason: manifest.reason });
        const receipt = await associate.commit(prepared, signal);
        await journal.append('association', { sourceFloorKey: floor.sourceFloorKey, originalRequestBody: prepared.body,
          receiptBody: runtime.numeric.stringifyLosslessJson(receipt) });
        const parsed = runtime.numeric.parseLosslessJson(prepared.body);
        const geometryId = parsed.payload.commands[1].target.recordId;
        if (floor.previousGeometryId) currentIds.delete(floor.previousGeometryId); currentIds.add(geometryId);
        frame = await reader.loadBuilding(manifest.buildingId, signal); compareIds(frame.floors.map(row => row.geometryId), currentIds);
        native = frame.floors.find(row => row.geometryId === geometryId); assert(native && native.originalSHA256 === floor.original.sha256
          && native.derivativeSHA256 === floor.derivative.sha256 && licensesMatch(native, manifest.sourceLicense),
        'Committed native floor differs from selected source or license');
      }
      used.add(native.geometryId); mappings.push({ sourceFloorKey: floor.sourceFloorKey, sourceOriginalSha256: floor.sourceOriginalSha256,
        geometryId: native.geometryId, originalAssetId: native.originalAssetId, derivativeAssetId: native.derivativeAssetId });
    }
    // Every evidence append changes descriptor keys, including untouched floors.
    frame = await reader.loadBuilding(manifest.buildingId, signal); compareIds(frame.floors.map(row => row.geometryId), currentIds);
    for (const floor of frame.floors) await runtime.mesh.readScanMesh(frame.readPort, frame.viewKey, floor, signal);
    await journal.append('geometry-complete', { mappings, viewKey: frame.viewKey,
      floors: frame.descriptor.floors.map(offer => ({ key: offer.floor.key, geometryId: offer.floor.geometryId,
        originalSha256: offer.floor.originalSha256, derivativeSha256: offer.floor.derivativeSha256 })) });
    return { mappings, frame, reader };
  } catch (error) { reader.dispose(); await journal.append('held', { message: 'No retry authorized; inspect the exact journal and current native information' }); throw error; }
}

function createSceneOwner(selected, runtime, context, transport, journal) {
  return runtime.scene.createNativeScanSceneImporter({ ...context, origin: selected.manifest.origin, transport,
    beforeDispatch: (kind, request) => {
      assert(request.body === undefined || typeof request.body === 'string' && Buffer.byteLength(request.body) <= IMPORT_LIMITS.wireBytes);
      assert(request.metadata === undefined || typeof request.metadata === 'string' && Buffer.byteLength(request.metadata) <= IMPORT_LIMITS.metadataBytes);
      return journal.append('adapter-claim', { kind, ...request });
    },
    afterResult: (kind, result) => journal.append('adapter-result', { kind, requestId: result.requestId, outcome: result.outcome,
      receiptBody: result.receipt ? runtime.numeric.stringifyLosslessJson(result.receipt) : null }),
  });
}
export async function applyNativeScene(selected, geometry, runtime, context, transport, journal, signal, suppliedOwner = null) {
  if (!selected.scene) return null;
  const input = sceneInputForGeometry(selected, geometry.mappings);
  const owner = suppliedOwner ?? createSceneOwner(selected, runtime, context, transport, journal);
  try {
    let current = await owner.inspectCurrentScene(input, signal);
    const reused = current !== null;
    if (!current) {
      const result = await owner.importScene(input, signal);
      if (result.outcome !== 'committed') {
        await journal.append('scene-held', { outcome: result.outcome, phase: result.phase, requestId: result.requestId ?? null });
        throw new Error('Documentary scene phase is held; preserve journal without resending');
      }
      current = result.current;
    }
    // Documentary evidence appends change every descriptor key again.
    const frame = await geometry.reader.loadBuilding(selected.manifest.buildingId, signal);
    compareIds(frame.floors.map(f => f.geometryId), input.sourceFloors.map(f => f.nativeGeometryId));
    for (const floor of frame.floors) await runtime.mesh.readScanMesh(frame.readPort, frame.viewKey, floor, signal);
    const primary = current.payload.sourceDocuments.find(doc => doc.role === 'primary-scene');
    const historical = current.payload.sourceDocuments.find(doc => doc.role === 'documentary-sheet');
    assert(primary && historical);
    await journal.append(reused ? 'scene-reused' : 'scene-complete', { recordId: current.recordId,
      payloadBody: runtime.numeric.stringifyLosslessJson(current.payload),
      primarySha256: selected.scene.primary.sha256, historicalSha256: selected.scene.historical.sha256,
      primary: { assetId: primary.originalAssetId, evidenceId: primary.evidenceId },
      historical: { assetId: historical.originalAssetId, evidenceId: historical.evidenceId },
      viewKey: frame.viewKey, floors: frame.floors.map(f => ({ geometryId: f.geometryId, key: f.key })) });
    return { recordId: current.recordId, frame, reused };
  } catch (error) {
    if (journal.events.at(-1)?.kind !== 'scene-held')
      await journal.append('scene-held', { outcome: 'unverified', phase: 'current-scene-read-or-documentary-write', requestId: null });
    throw error;
  } finally { if (!suppliedOwner) owner.dispose(); }
}

/** Restart reconciliation is passive. Missing receipts never authorize resubmission. */
export async function inspectImportJournal(journal, runtime, context, transport, signal, selected = null) {
  const selections = journal.events.filter(event => event.kind === 'selection'); assert.equal(selections.length, 1);
  const { manifest } = selections[0].data;
  const inspections = [], unresolvedCustody = [], seen = new Set(), correlated = new Set(), client = runtime.retained.createRetainedIntentClient(transport);
  for (const event of journal.events) {
    if (event.kind === 'custody') correlated.add(JSON.parse(event.data.originalRequestBody).requestId);
    if (event.kind === 'adapter-result' && event.data.outcome === 'committed') correlated.add(event.data.requestId);
  }
  for (const event of journal.events) {
    let body = event.kind === 'association' || event.kind === 'custody' ? event.data.originalRequestBody : null;
    if (event.kind === 'dispatch' && event.data.body) body = event.data.body;
    if (!body) {
      if (event.kind === 'dispatch' && event.data.metadata) {
        const metadata = JSON.parse(event.data.metadata);
        if (!correlated.has(metadata.requestId)) unresolvedCustody.push({ path: event.data.path, requestId: metadata.requestId,
          metadata: event.data.metadata, status: 'unresolved-server-issued-asset-intent-unavailable' });
      }
      continue;
    }
    const original = runtime.numeric.parseLosslessJson(body);
    if (seen.has(original.requestId)) continue; seen.add(original.requestId);
    // Scene commands have their own closed request/current-head reader. Never
    // reinterpret them as Stock requests during passive restart inspection.
    if (original.commandId === 'atlas.scene-association.create') continue;
    // Stock requests include exact numeric guards; the native reader accepts their retained spelling.
    const result = original.commandId === 'atlas.batch.execute'
      ? await client.readSerializedNativePlace(body, () => context.getContext(), signal)
      : await client.read(JSON.parse(body), () => context.getContext(), signal);
    inspections.push({ requestId: original.requestId, result });
  }
  const reader = runtime.read.createNativeGeometryReadClient({ getBinding: context.getBinding, subscribeBinding: context.subscribe,
    origin: manifest.origin, transport });
  try {
    const frame = await reader.loadBuilding(manifest.buildingId, signal);
    const complete = journal.events.filter(event => event.kind === 'geometry-complete').at(-1);
    const verified = !!complete && complete.data.mappings.length === manifest.floors.length
      && JSON.stringify(frame.floors.map(row => row.geometryId).sort()) === JSON.stringify(complete.data.floors.map(row => row.geometryId).sort())
      && complete.data.mappings.every(mapping => {
      const selected = manifest.floors.find(row => row.sourceFloorKey === mapping.sourceFloorKey && row.sourceOriginalSha256 === mapping.sourceOriginalSha256);
      const floor = frame.floors.find(row => row.geometryId === mapping.geometryId);
      return selected && floor && floor.originalSHA256 === selected.original.sha256 && floor.derivativeSHA256 === selected.derivative.sha256
        && licensesMatch(floor, manifest.sourceLicense);
    });
    if (verified) for (const floor of frame.floors) await runtime.mesh.readScanMesh(frame.readPort, frame.viewKey, floor, signal);
    let sceneStatus = manifest.scene ? 'held' : 'not-requested', sceneRecordId = null;
    if (verified && selected?.scene) {
      assert.equal(selected.manifestSha256, selections[0].data.manifestSha256);
      const terminal = journal.events.filter(event => ['scene-complete', 'scene-reused'].includes(event.kind)).at(-1);
      const claim = journal.events.filter(event => event.kind === 'adapter-claim' && event.data.kind === 'scene-association').at(-1);
      let expected;
      if (terminal) expected = { recordId: terminal.data.recordId, payload: runtime.numeric.parseLosslessJson(terminal.data.payloadBody) };
      else if (claim) {
        const request = runtime.numeric.parseLosslessJson(claim.data.body);
        assert.equal(request.commandId, 'atlas.scene-association.create');
        expected = { recordId: request.target.recordId, payload: request.payload };
      }
      if (expected) {
        const owner = runtime.scene.createNativeScanSceneImporter({ ...context, origin: manifest.origin, transport,
          beforeDispatch: async () => { throw new Error('Passive inspection cannot claim a mutation'); },
          afterResult: async () => { throw new Error('Passive inspection cannot manufacture a receipt'); } });
        try {
          const current = await owner.inspectCurrentScene(sceneInputForGeometry(selected, complete.data.mappings), signal, expected);
          if (current) { sceneStatus = 'exact-current-scene-verified'; sceneRecordId = current.recordId; }
        } finally { owner.dispose(); }
      } else sceneStatus = 'no-correlated-scene-claim';
    }
    return { status: verified ? 'current-geometry-verified' : 'held', retrySafety: 'not-established', unresolvedCustody,
      sceneStatus, sceneRecordId,
      viewKey: frame.viewKey, inspections: inspections.map(row => ({ requestId: row.requestId,
        status: row.result.status, receipt: row.result.status === 'ready' ? runtime.numeric.stringifyLosslessJson(row.result.receipt) : null })) };
  } finally { reader.dispose(); }
}

async function main(args) {
  const command = args.shift(); assert(['validate', 'preflight', 'apply', 'inspect'].includes(command), 'Use validate, preflight, apply or inspect');
  const options = new Map(); while (args.length) { const key = args.shift(), value = args.shift(); assert(/^--[a-z0-9-]+$/.test(key) && value && !options.has(key)); options.set(key, value); }
  assert([...options.keys()].every(key => ['--manifest', '--sha256', '--journal', '--origin', '--proxy'].includes(key)));
  const runtime = await loadNativeImportRuntime({ scene: 'frontend/integration/native-scan-import-scene.ts' }); let context, network, geometry, sceneOwner;
  try {
    const signal = AbortSignal.timeout(10 * 60_000);
    const path = options.get('--manifest'); assert(path && SHA.test(options.get('--sha256')));
    await canonicalPath(path); const stat = await lstat(path);
    const selected = await validateImportManifest({ path, filename: basename(path), bytes: stat.size, sha256: options.get('--sha256') }, runtime, signal);
    if (command === 'validate') { console.log(JSON.stringify({ status: 'validated', manifestSha256: selected.manifestSha256, floors: selected.floors.length,
      nativeMutation: false, sceneRequested: selected.manifest.scene !== null })); return; }
    assert.equal(options.get('--origin'), selected.manifest.origin, 'Explicit origin must match reviewed manifest');
    const journal = command === 'preflight' ? null : await openImportJournal(options.get('--journal'), { create: command === 'apply' });
    if (command === 'inspect') assert.equal(journal.events.find(event => event.kind === 'selection')?.data.manifestSha256, selected.manifestSha256);
    network = createNativeCurlTransport({ origin: selected.manifest.origin, proxy: options.get('--proxy'), scope: selected.manifest.scope });
    const transport = command === 'apply' ? journalTransport(network.exchange, journal) : network.exchange;
    context = await createAgentContext(selected.manifest, transport, runtime, signal);
    if (command === 'preflight') {
      const reader = runtime.read.createNativeGeometryReadClient({ getBinding: context.getBinding, subscribeBinding: context.subscribe,
        origin: selected.manifest.origin, transport });
      try {
        const frame = await reader.loadBuilding(selected.manifest.buildingId, signal);
        compareIds(frame.floors.map(f => f.geometryId), selected.manifest.expectedCurrentGeometryIds);
        console.log(JSON.stringify({ status: 'current-native-admission-and-selection-verified', manifestSha256: selected.manifestSha256,
          currentGeometryIds: frame.floors.map(f => f.geometryId), applicationMutation: false,
          accessSession: 'one-expiring-session-created-and-owned-logout-required' }));
      } finally { reader.dispose(); }
      return;
    }
    if (command === 'inspect') { console.log(JSON.stringify(await inspectImportJournal(journal, runtime, context, transport, signal, selected))); return; }
    if (selected.scene) sceneOwner = createSceneOwner(selected, runtime, context, transport, journal);
    geometry = await applyNativeImport(selected, runtime, context, transport, journal, signal, sceneOwner);
    const scene = await applyNativeScene(selected, geometry, runtime, context, transport, journal, signal, sceneOwner);
    const status = scene ? 'geometry-and-scene-saved-and-read-back' : 'geometry-saved-and-read-back';
    await journal.append('complete', { status, sceneRecordId: scene?.recordId ?? null });
    console.log(JSON.stringify({ status, manifestSha256: selected.manifestSha256,
      journal: options.get('--journal'), floors: geometry.mappings.length }));
  } finally {
    geometry?.reader.dispose();
    sceneOwner?.dispose();
    try { await context?.close(); } finally { network?.forget(); await runtime.dispose(); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('Native import stopped. Preserve the private journal; do not resend unknown requests.'); process.exitCode = 1; });
}
