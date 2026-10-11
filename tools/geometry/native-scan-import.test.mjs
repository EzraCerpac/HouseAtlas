/** Bounded synthetic import lane: private disposable files and fake responses only.
 * No curl, socket, account, provider, household input or native service is used. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, rm, realpath, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNativeImportRuntime } from './native-scan-import-runtime.mjs';
import { validateImportManifest, readPinnedFile, sha256, openImportJournal, applyNativeImport,
  applyNativeScene, inspectImportJournal, journalTransport, createAgentContext, IMPORT_LIMITS } from './native-scan-import.mjs';
import { parseCurlResponse, createNativeCurlTransport } from './native-scan-import-transport.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syntheticMeshFixture } from '../../frontend/lantern-tests/scan-mesh-read.mjs';

const runtime = await loadNativeImportRuntime();
test.after(() => runtime.dispose());
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: U(1), homeId: U(2) }, buildingId = U(3), semanticsId = U(4);
const license = { status: 'unknown', reference: null };
const commands = ['atlas.asset.create', 'atlas.asset.get', 'atlas.identity.get', 'atlas.location-semantics.get',
  'atlas.evidence.get', 'atlas.geometry.get', 'atlas.batch.execute', 'atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace'];
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
function intentDigest(request) { const copy = { ...request }; delete copy.requestId; delete copy.approvalReceiptId; return sha256(canonical(copy)); }
const json = (value, headers = {}) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const target = (recordType, recordId) => ({ authority: 'atlas', recordType, recordId });
const record = (kind, recordId, payload, revision = 1) => ({ target: target(kind, recordId), revision, lifecycle: 'active', payload });
const origin = 'https://synthetic.invalid';
function localContext() {
  const sessionIdentity = {}, allocation = { ...scope }, session = { schemaVersion: 1, actorId: U(9), csrfToken: 'synthetic-only', expiresAt: '2099-01-01T00:00:00Z' };
  const context = { sessionIdentity, session, scope: allocation, view: { scope: allocation, canEdit: true },
    admission: { scope, commandIds: commands, revision: 'synthetic-current' } };
  const binding = { sessionIdentity, expiresAt: session.expiresAt, scope: allocation }, listeners = new Set();
  return { getContext: () => context, getBinding: () => binding,
    subscribe: changed => { listeners.add(changed); return () => listeners.delete(changed); } };
}
function fakeNative({ unknownAt = null } = {}) {
  let serial = 100, postCount = 0;
  const records = new Map(), meshes = new Map(), retained = new Map();
  records.set(`identity:${buildingId}`, record('identity', buildingId, { kind: 'location', evidenceIds: [U(5)] }));
  records.set(`location-semantics:${semanticsId}`, record('location-semantics', semanticsId,
    { atlasId: buildingId, semanticKind: 'building', reviewStatus: 'accepted', evidenceIds: [U(5)] }));
  records.set(`evidence:${U(5)}`, record('evidence', U(5), { statement: 'Synthetic accepted building name.',
    provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'owner-report', factAt: null,
      retrievedAt: '2026-10-11T00:00:00Z', vantage: null, uncertainty: { status: 'unknown', explanation: null } },
    supersedesEvidenceIds: [], references: [] }));
  const viewKey = () => sha256(`synthetic-view-${records.get(`identity:${buildingId}`).revision}`);
  const floors = () => [...records.values()].filter(row => row.target.recordType === 'geometry'
    && ![...records.values()].some(next => next.target.recordType === 'geometry' && next.payload.previousGeometryId === row.target.recordId)).map(geometry => {
    const evidence = records.get(`evidence:${geometry.payload.evidenceIds[0]}`);
    const [original, derivative] = evidence.payload.references.map(ref => records.get(`asset:${ref.assetId}`));
    const key = sha256(viewKey() + geometry.target.recordId), profile = JSON.parse(meshes.get(derivative.target.recordId).toString());
    return { floor: { key, exportLabel: profile.source.floorLabel, originalSha256: original.payload.sha256, derivativeSha256: derivative.payload.sha256,
      geometryId: geometry.target.recordId, geometryRevision: geometry.revision, evidenceId: evidence.target.recordId, evidenceRevision: evidence.revision,
      originalAssetId: original.target.recordId, originalRevision: original.revision, derivativeAssetId: derivative.target.recordId, derivativeRevision: derivative.revision,
      originalLicense: original.payload.sourceLicense, derivativeLicense: derivative.payload.sourceLicense },
    readPath: `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}/frames/${viewKey()}/meshes/${key}` };
  });
  const wire = (request, produced) => ({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId, resolvedScope: scope,
    status: 'committed', replayed: false, operationId: U(serial++), data: { records: produced, auditIds: produced.map(() => U(serial++)), requestDigest: intentDigest(request) } });
  return { records, viewKey, floors, get postCount() { return postCount; },
    async transport(input, init = {}) {
      const url = new URL(input, origin), path = url.pathname;
      if (path === '/api/atlas/retained-intent') {
        const request = JSON.parse(init.body), saved = retained.get(request.requestId); assert(saved);
        return json({ format: 'atlas-retained-reconciliation/1', lookupRequestId: request.requestId,
          inspection: { format: 'atlas-retained-intent-inspection/1', resolvedScope: scope, coverage: 'retained-atlas-stock-only', outcome: 'retained-commit',
            retrySafety: 'not-established', rootOperationId: saved.wire.operationId, operationId: saved.wire.operationId,
            commandId: request.commandId, requestDigest: saved.wire.data.requestDigest },
          committedResult: { originalRequestId: request.requestId, wire: saved.wire, children: saved.children,
            originalMediaRelease: 'not-established', originalHttpDelivery: 'not-established' } });
      }
      if (init.method !== 'POST') {
        if (path.endsWith('/invoke')) {
          const request = JSON.parse(url.searchParams.get('request')), row = records.get(`${request.target.recordType}:${request.target.recordId}`); assert(row);
          return json({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId, resolvedScope: scope, status: 'read', replayed: false,
            data: { records: [row], nextCursor: null, sourceStatus: 'current' } });
        }
        if (path.includes('/meshes/')) {
          const offer = floors().find(row => row.readPath === path); assert(offer);
          return new Response(meshes.get(offer.floor.derivativeAssetId), { headers: { 'content-type': 'application/vnd.houseatlas.magicplan-authored-mesh+json',
            'x-atlas-geometry-view': viewKey() } });
        }
        assert(path.endsWith(`/buildings/${buildingId}`));
        return json({ schemaVersion: 1, profile: 'houseatlas.magicplan-authored-mesh.v1', scope, buildingId, viewKey: viewKey(), floors: floors(),
          physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null }, { 'x-atlas-geometry-view': viewKey() });
      }
      postCount++;
      if (init.body instanceof FormData) {
        const metadata = JSON.parse(init.body.get('metadata')), bytes = Buffer.from(await init.body.get('file').arrayBuffer());
        const assetId = U(serial++), derivative = path.endsWith('/derivative');
        const request = { schemaVersion: 3, commandId: 'atlas.asset.create', requestId: metadata.requestId, context: scope,
          target: target('asset', assetId), payload: { staged: { uploadToken: U(serial++), sha256: sha256(bytes), byteSize: bytes.length,
            contentType: metadata.contentType, filename: metadata.filename }, purpose: derivative ? 'derived-preview' : 'geometry-original',
          sourceLicense: metadata.sourceLicense, evidenceIds: [] }, idempotencyKey: metadata.idempotencyKey, reason: metadata.reason, approvalReceiptId: null,
          preconditions: { target: null, guards: derivative ? [{ target: target('asset', path.split('/').at(-2)), revision: { kind: 'atlas', value: 1 } }] : [] } };
        const created = record('asset', assetId, { owner: 'atlas', purpose: request.payload.purpose, sha256: sha256(bytes), byteSize: bytes.length,
          contentType: metadata.contentType, sourceLicense: metadata.sourceLicense, availability: 'available', previewPolicy: 'download-only', evidenceIds: [] });
        records.set(`asset:${assetId}`, created); meshes.set(assetId, bytes);
        const result = wire(request, [created]); retained.set(request.requestId, { wire: result, children: [] });
        if (unknownAt === postCount) throw new Error('Synthetic unavailable response');
        return json({ schemaVersion: 1, association: 'not-associated', originalRequest: request, result });
      }
      const request = JSON.parse(init.body); assert.equal(request.commandId, 'atlas.batch.execute'); assert(path.endsWith('/associations'));
      const produced = request.payload.commands.map(child => {
        const key = `${child.target.recordType}:${child.target.recordId}`, prior = records.get(key);
        const payload = child.target.recordType === 'geometry' ? { ...child.payload, importedAt: '2026-10-11T00:00:00Z' } : child.payload;
        const created = record(child.target.recordType, child.target.recordId, payload, (prior?.revision ?? 0) + 1); records.set(key, created); return created;
      });
      const children = request.payload.commands.map((child, index) => wire(child, [produced[index]]));
      const result = wire(request, produced); result.data.auditIds = children.flatMap(child => child.data.auditIds);
      retained.set(request.requestId, { wire: result, children });
      if (unknownAt === postCount) throw new Error('Synthetic unavailable response');
      return json(result);
    },
  };
}
function addSyntheticEvidence(native, count) {
  const identity = native.records.get(`identity:${buildingId}`);
  const source = native.records.get(`evidence:${U(5)}`).payload;
  for (let index = 0; index < count; index++) {
    const id = U(5000 + index);
    native.records.set(`evidence:${id}`, record('evidence', id, structuredClone(source)));
    identity.payload.evidenceIds.push(id);
  }
}
async function fixture(labels = ['One', 'Two']) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'houseatlas-agent-import-test-'))); await chmod(directory, 0o700);
  const floors = [];
  for (const label of labels) {
    const original = Buffer.from(`synthetic original ${label}`), profile = syntheticMeshFixture(label);
    Object.assign(profile.source, { fileName: `${label}.usdz`, originalSHA256: sha256(original), originalBytes: original.length });
    Object.assign(profile.converter, { codeSHA256: 'c9bf5c49ceba9b8dcace64102dc9e7d714731952dae4ca3c2f704ad1569caeb3',
      schemaSHA256: '7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863', profileSHA256: '3deec596c1fedef079c4e353432f7848ae4d5d403b9e1bec92fad2907ca18aff' });
    const derivative = Buffer.from(JSON.stringify(profile));
    const save = async (filename, bytes) => { const path = join(directory, filename); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      return { path, filename, bytes: bytes.length, sha256: sha256(bytes) }; };
    floors.push({ sourceFloorKey: `synthetic:${label}`, sourceOriginalSha256: sha256(`synthetic documentary ${label}`), exportLabel: label,
      original: await save(`${label}.usdz`, original), derivative: await save(`${label}.mesh.json`, derivative), previousGeometryId: null });
  }
  const manifest = { schema: 'houseatlas.agent-native-scan-import.v1', origin, scope, buildingId, semanticsId,
    reason: 'Bounded synthetic agent import', statement: 'Synthetic authored mesh; physical alignment remains unknown.', sourceLicense: license,
    expectedCurrentGeometryIds: [], floors, scene: null };
  return { directory, manifest, async selected(name = 'selection.json') {
    const bytes = Buffer.from(JSON.stringify(manifest)), path = join(directory, name); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    return validateImportManifest({ path, filename: name, bytes: bytes.length, sha256: sha256(bytes) }, runtime); },
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('real source runtime records exact compiled decimal/mesh/client and schema dependencies', () => {
  assert(runtime.provenance.modules.some(pin => pin.path === 'frontend/src/numeric/decimal.ts' && /^[a-f0-9]{64}$/.test(pin.compiledSha256)));
  assert(runtime.provenance.modules.some(pin => pin.path.endsWith('agent.schema.json?raw')));
});
test('maximum escaped request and response wire bodies durably reopen without changing wire bounds', async () => {
  const files = await fixture(['Journal']);
  try {
    const journal = await openImportJournal(join(files.directory, 'escaped'), { create: true });
    const body = JSON.stringify('\\'.repeat((IMPORT_LIMITS.wireBytes - 2) / 2));
    const raw = '\u0000'.repeat(IMPORT_LIMITS.wireBytes);
    assert.equal(Buffer.byteLength(body), IMPORT_LIMITS.wireBytes);
    assert.equal(Buffer.byteLength(raw), IMPORT_LIMITS.wireBytes);
    await journal.append('adapter-claim', { kind: 'scene-association', requestId: U(991), body });
    let calls = 0;
    const exchange = journalTransport(async () => { calls++; return new Response(raw); }, journal);
    const response = await exchange('/api/atlas/synthetic-mutation', { method: 'POST', body });
    assert.equal(await response.text(), raw); assert.equal(calls, 1);
    const reopened = await openImportJournal(join(files.directory, 'escaped'));
    assert.equal(reopened.events[0].data.body, body);
    assert.equal(reopened.events[1].data.body, body);
    assert.equal(reopened.events[2].data.body, raw);
    assert.equal((await readFile(join(files.directory, 'escaped', '0003.json'))).length > 2 * 1024 * 1024, true);
    assert.equal(reopened.events.length, 3);
  } finally { await files.cleanup(); }
});
test('actual two-floor save, ALL fresh descriptor keys, durable reopen and identical no-POST reuse', async () => {
  const files = await fixture(), native = fakeNative(), context = localContext();
  try {
    const selected = await files.selected(), journal = await openImportJournal(join(files.directory, 'first'), { create: true });
    const transport = journalTransport(native.transport, journal);
    const result = await applyNativeImport(selected, runtime, context, transport, journal, new AbortController().signal);
    assert.equal(native.postCount, 6); assert.equal(result.mappings.length, 2); const firstIds = result.mappings.map(row => row.geometryId);
    assert.equal(result.frame.floors.length, 2); result.reader.dispose();
    assert.equal(journal.events.filter(row => row.kind === 'dispatch').length, 6);
    const reopened = await openImportJournal(join(files.directory, 'first')); assert.equal(reopened.events.length, journal.events.length);
    assert(!(await readFile(join(files.directory, 'first', '0001.json'), 'utf8')).includes('synthetic-only'));
    files.manifest.expectedCurrentGeometryIds = firstIds;
    const again = await files.selected('again.json'), second = await openImportJournal(join(files.directory, 'second'), { create: true });
    const reused = await applyNativeImport(again, runtime, context, journalTransport(native.transport, second), second, new AbortController().signal);
    assert.equal(native.postCount, 6); assert.deepEqual(reused.mappings.map(row => row.geometryId), firstIds); reused.reader.dispose();
  } finally { await files.cleanup(); }
});
test('complete geometry capacity refuses 99 retained evidence rows before any asset custody', async () => {
  const files = await fixture(), native = fakeNative();
  try {
    addSyntheticEvidence(native, 98);
    const selected = await files.selected(), journal = await openImportJournal(join(files.directory, 'capacity'), { create: true });
    await assert.rejects(applyNativeImport(selected, runtime, localContext(), native.transport, journal, new AbortController().signal));
    assert.equal(native.postCount, 0); assert.equal(journal.events.at(-1).kind, 'held');
    assert.equal([...native.records.values()].filter(row => ['asset', 'geometry'].includes(row.target.recordType)).length, 0);
  } finally { await files.cleanup(); }
});
test('scene geometry coverage refuses an omitted current floor or oversized projected frame before custody', async () => {
  // This exercises the host's actual geometry clients and projection guard.
  // The scene marker is an orchestration stub, not scene-document acceptance.
  for (const kind of ['omitted', 'oversized']) {
    const seed = await fixture(), next = await fixture(kind === 'omitted' ? ['Changed'] : ['NewA', 'NewB', 'NewC']);
    const native = fakeNative(), context = localContext(); let reader;
    try {
      const saved = await applyNativeImport(await seed.selected(), runtime, context, native.transport,
        await openImportJournal(join(seed.directory, 'seed'), { create: true }), new AbortController().signal);
      reader = saved.reader; const ids = saved.mappings.map(row => row.geometryId); reader.dispose(); reader = null;
      assert.equal(native.postCount, 6);
      next.manifest.expectedCurrentGeometryIds = ids;
      if (kind === 'omitted') next.manifest.floors[0].previousGeometryId = ids[0];
      const selected = await next.selected();
      selected.scene = { sourceFloors: selected.floors.map(part => ({ sourceFloorKey: part.selected.sourceFloorKey,
        sourceOriginalSha256: part.selected.sourceOriginalSha256 })) };
      const before = JSON.stringify([...native.records.entries()]);
      const journal = await openImportJournal(join(next.directory, 'held'), { create: true });
      await assert.rejects(applyNativeImport(selected, runtime, context, native.transport, journal,
        new AbortController().signal, { async capturePriorScene() { throw new Error('Incomplete coverage must stop before capture'); } }),
      /complete projected native floor set/);
      assert.equal(native.postCount, 6); assert.equal(JSON.stringify([...native.records.entries()]), before);
      assert.equal(journal.events.at(-1).kind, 'held');
    } finally { reader?.dispose(); await next.cleanup(); await seed.cleanup(); }
  }
});
test('complete scene floor coverage permits a partial successor and an untouched reused lineage', async () => {
  const seed = await fixture(), next = await fixture(['Changed', 'Two']), native = fakeNative(), context = localContext(); let reader;
  try {
    const initial = await applyNativeImport(await seed.selected(), runtime, context, native.transport,
      await openImportJournal(join(seed.directory, 'seed'), { create: true }), new AbortController().signal);
    const ids = initial.mappings.map(row => row.geometryId); initial.reader.dispose();
    next.manifest.expectedCurrentGeometryIds = ids; next.manifest.floors[0].previousGeometryId = ids[0];
    const selected = await next.selected();
    selected.scene = { sourceFloors: selected.floors.map(part => ({ sourceFloorKey: part.selected.sourceFloorKey,
      sourceOriginalSha256: part.selected.sourceOriginalSha256 })) };
    let captured = false;
    const result = await applyNativeImport(selected, runtime, context, native.transport,
      await openImportJournal(join(next.directory, 'complete'), { create: true }), new AbortController().signal,
      { async capturePriorScene() { assert.equal(native.postCount, 6); captured = true;
        return { status: 'unavailable', reason: 'no-current-association' }; } });
    reader = result.reader; assert(captured); assert.equal(native.postCount, 9); assert.equal(result.frame.floors.length, 2);
    assert.notEqual(result.mappings[0].geometryId, ids[0]); assert.equal(result.mappings[1].geometryId, ids[1]);
  } finally { reader?.dispose(); await next.cleanup(); await seed.cleanup(); }
});
test('geometry association UTF-8 batch capacity is checked before original and derivative uploads', async () => {
  const files = await fixture(['Capacity']), native = fakeNative();
  try {
    files.manifest.reason = '😀'.repeat(1024);
    const selected = await files.selected(), journal = await openImportJournal(join(files.directory, 'utf8-capacity'), { create: true });
    await assert.rejects(applyNativeImport(selected, runtime, localContext(), native.transport, journal, new AbortController().signal));
    assert.equal(native.postCount, 0); assert.equal(journal.events.at(-1).kind, 'held');
  } finally { await files.cleanup(); }
});
test('the later floor capacity is reserved before the first floor uploads any asset', async () => {
  const files = await fixture();
  try {
    const selected = await files.selected(); let threshold = null;
    // At most forty small GET-only synthetic observations locate the actual
    // published batch threshold, without mirroring its serialization formula.
    for (let count = 0; count < 40; count++) {
      const native = fakeNative(), context = localContext(); addSyntheticEvidence(native, count);
      const client = runtime.association.createNativeGeometryAssociationClient({ ...context, origin, transport: native.transport });
      const binding = client.getBinding(); assert(binding);
      const input = { buildingId, semanticsId, statement: selected.manifest.statement, reason: selected.manifest.reason };
      let first;
      try { first = await client.reserve(binding, { ...input, floors: [{ previousGeometryId: null }] }, AbortSignal.timeout(3000)); }
      catch { break; }
      assert(first.floors[0].bodyBytes <= 16384);
      try { await client.reserve(binding, { ...input, floors: [{ previousGeometryId: null }, { previousGeometryId: null }] }, AbortSignal.timeout(3000)); }
      catch { threshold = { native, context, count, first }; break; }
      assert.equal(native.postCount, 0);
    }
    assert(threshold, 'Actual first-floor-fit/later-floor-full threshold must be observed');
    const journal = await openImportJournal(join(files.directory, 'later-capacity'), { create: true });
    await assert.rejects(applyNativeImport(selected, runtime, threshold.context, threshold.native.transport, journal, new AbortController().signal));
    assert.equal(threshold.native.postCount, 0); assert.equal(journal.events.at(-1).kind, 'held');
    assert.equal([...threshold.native.records.values()].filter(row => ['asset', 'geometry'].includes(row.target.recordType)).length, 0);
  } finally { await files.cleanup(); }
});
test('UNKNOWN custody stops after one POST; passive inspection keeps retry safety unestablished', async () => {
  const files = await fixture(['Only']), native = fakeNative({ unknownAt: 1 }), context = localContext();
  try {
    const selected = await files.selected(), journal = await openImportJournal(join(files.directory, 'held'), { create: true });
    await assert.rejects(applyNativeImport(selected, runtime, context, journalTransport(native.transport, journal), journal, new AbortController().signal));
    assert.equal(native.postCount, 1); assert.equal(journal.events.at(-1).kind, 'held');
    const inspection = await inspectImportJournal(journal, runtime, context, native.transport, new AbortController().signal);
    assert.equal(inspection.status, 'held'); assert.equal(inspection.retrySafety, 'not-established'); assert.equal(native.postCount, 1);
    assert.equal(inspection.unresolvedCustody.length, 1);
    assert.equal(inspection.unresolvedCustody[0].status, 'unresolved-server-issued-asset-intent-unavailable');
    await assert.rejects(openImportJournal(join(files.directory, 'held'), { create: true }));
  } finally { await files.cleanup(); }
});
test('license correction saves a guarded successor; restart rejects changed retained license', async () => {
  const files = await fixture(['Only']), native = fakeNative(), context = localContext(); let reader;
  try {
    const first = await applyNativeImport(await files.selected(), runtime, context, native.transport,
      await openImportJournal(join(files.directory, 'first'), { create: true }), new AbortController().signal);
    const priorId = first.mappings[0].geometryId; first.reader.dispose();
    files.manifest.expectedCurrentGeometryIds = [priorId];
    files.manifest.floors[0].previousGeometryId = priorId;
    files.manifest.sourceLicense = { status: 'restricted', reference: 'Synthetic owner restriction' };
    const selected = await files.selected('corrected-license.json');
    const journal = await openImportJournal(join(files.directory, 'correction'), { create: true });
    const corrected = await applyNativeImport(selected, runtime, context, native.transport, journal, new AbortController().signal);
    reader = corrected.reader;
    assert.equal(native.postCount, 6); assert.notEqual(corrected.mappings[0].geometryId, priorId);
    assert.deepEqual(corrected.frame.floors[0].originalLicense, files.manifest.sourceLicense);
    assert.deepEqual(corrected.frame.floors[0].derivativeLicense, files.manifest.sourceLicense);
    assert.equal(native.records.get(`geometry:${corrected.mappings[0].geometryId}`).payload.previousGeometryId, priorId);
    const verified = await inspectImportJournal(journal, runtime, context, native.transport, new AbortController().signal);
    assert.equal(verified.status, 'current-geometry-verified');
    const asset = native.records.get(`asset:${corrected.mappings[0].originalAssetId}`);
    asset.payload.sourceLicense = license;
    const held = await inspectImportJournal(journal, runtime, context, native.transport, new AbortController().signal);
    assert.equal(held.status, 'held'); assert.equal(native.postCount, 6);
  } finally { reader?.dispose(); await files.cleanup(); }
});
test('explicit predecessor selects each distinct native floor with identical bytes', async () => {
  const files = await fixture(), native = fakeNative(), context = localContext(); let reader;
  try {
    const firstFloor = files.manifest.floors[0], secondFloor = files.manifest.floors[1];
    Object.assign(secondFloor, { original: firstFloor.original, derivative: firstFloor.derivative, exportLabel: firstFloor.exportLabel });
    const first = await applyNativeImport(await files.selected(), runtime, context, native.transport,
      await openImportJournal(join(files.directory, 'first'), { create: true }), new AbortController().signal);
    const ids = first.mappings.map(f => f.geometryId); first.reader.dispose();
    assert.equal(new Set(ids).size, 2); assert.equal(native.postCount, 6);
    files.manifest.expectedCurrentGeometryIds = ids;
    files.manifest.floors[0].previousGeometryId = ids[1]; files.manifest.floors[1].previousGeometryId = ids[0];
    const reused = await applyNativeImport(await files.selected('selected-predecessors.json'), runtime, context, native.transport,
      await openImportJournal(join(files.directory, 'reuse'), { create: true }), new AbortController().signal);
    reader = reused.reader; assert.deepEqual(reused.mappings.map(f => f.geometryId), [ids[1], ids[0]]);
    assert.equal(native.postCount, 6);
  } finally { reader?.dispose(); await files.cleanup(); }
});
test('host captures the same scene owner before the first geometry custody POST', async () => {
  const files = await fixture(['Only']), native = fakeNative(), context = localContext(); let reader;
  try {
    let captured = false, calls = 0;
    const owner = { async capturePriorScene(id, signal) {
      signal.throwIfAborted(); assert.equal(id, buildingId); assert.equal(native.postCount, 0);
      captured = true; calls++; return { status: 'unavailable', reason: 'no-current-association' };
    } };
    const transport = (input, init) => { if (init?.method === 'POST') assert(captured); return native.transport(input, init); };
    const journal = await openImportJournal(join(files.directory, 'captured'), { create: true });
    const saved = await applyNativeImport(await files.selected(), runtime, context, transport, journal, new AbortController().signal, owner);
    reader = saved.reader; assert.equal(calls, 1); assert.equal(native.postCount, 3);
    assert.deepEqual(journal.events.find(e => e.kind === 'scene-predecessor').data,
      { buildingId, status: 'unavailable', recordId: null });
  } finally { reader?.dispose(); await files.cleanup(); }
});
test('host composes scene reuse and restart inspection without a scene mutation or manufactured receipt', async () => {
  const files = await fixture(), native = fakeNative(), context = localContext(); let geometry;
  try {
    files.manifest.scene = { selected: 'generated orchestration marker' };
    // Geometry selection remains the actual generated file/decoder path. The
    // scene owner is an explicit protocol stub; its real readers are separately
    // qualified by the named scene-reuse production-factory case.
    const scene = { buildingId, sourceFloors: files.manifest.floors.map(f => ({ sourceFloorKey: f.sourceFloorKey,
      sourceOriginalSha256: f.sourceOriginalSha256 })), primary: { sha256: 'a'.repeat(64) }, historical: { sha256: 'b'.repeat(64) } };
    const geometryManifest = { ...files.manifest, scene: null };
    const bytes = Buffer.from(JSON.stringify(geometryManifest)), path = join(files.directory, 'geometry.json');
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const selected = await validateImportManifest({ path, filename: 'geometry.json', bytes: bytes.length, sha256: sha256(bytes) }, runtime);
    selected.manifest.scene = files.manifest.scene; selected.scene = scene;
    const journal = await openImportJournal(join(files.directory, 'reused-scene'), { create: true });
    geometry = await applyNativeImport(selected, runtime, context, journalTransport(native.transport, journal), journal, new AbortController().signal);
    const current = { recordId: U(888), payload: { buildingId, sourceFloors: scene.sourceFloors.map((source, index) => {
      const floor = geometry.frame.floors.find(row => row.geometryId === geometry.mappings[index].geometryId);
      return { ...source, nativeGeometryId: floor.geometryId, nativeGeometryRevision: floor.geometryRevision.toSafeInteger(),
        nativeFloorKey: floor.key, nativeOriginalAssetId: floor.originalAssetId, nativeOriginalSha256: floor.originalSHA256 };
    }), sourceDocuments: [
      { role: 'primary-scene', originalAssetId: U(889), evidenceId: U(890) },
      { role: 'documentary-sheet', originalAssetId: U(891), evidenceId: U(892) }] } };
    let inspections = 0, disposed = 0, unreadable = false;
    const composed = { ...runtime, scene: { createNativeScanSceneImporter: () => ({
      async inspectCurrentScene(input, signal, expected) {
        signal.throwIfAborted(); inspections++;
        if (unreadable) throw new Error('Explicit synthetic current-source-unavailable');
        assert.deepEqual(input.sourceFloors.map(f => f.nativeGeometryId), geometry.mappings.map(f => f.geometryId));
        if (expected) { assert.equal(expected.recordId, current.recordId);
          assert.equal(runtime.numeric.stringifyLosslessJson(expected.payload), JSON.stringify(current.payload)); }
        return current;
      },
      async importScene() { throw new Error('Matching scene must never dispatch a second import'); },
      dispose() { disposed++; },
    }) } };
    const result = await applyNativeScene(selected, geometry, composed, context, native.transport, journal, new AbortController().signal);
    assert.equal(result.recordId, current.recordId); assert.equal(result.reused, true); assert.equal(native.postCount, 6);
    assert.equal(journal.events.filter(e => e.kind === 'scene-reused').length, 1);
    assert.equal(journal.events.filter(e => ['adapter-claim', 'adapter-result', 'scene-complete'].includes(e.kind)).length, 0);
    const inspection = await inspectImportJournal(await openImportJournal(join(files.directory, 'reused-scene')),
      composed, context, native.transport, new AbortController().signal, selected);
    assert.equal(inspection.sceneStatus, 'exact-current-scene-verified'); assert.equal(inspection.sceneRecordId, current.recordId);
    assert.equal(inspection.retrySafety, 'not-established'); assert.equal(native.postCount, 6);
    assert.equal(inspections, 3); assert.equal(disposed, 3);
    unreadable = true;
    const held = await openImportJournal(join(files.directory, 'unreadable-scene'), { create: true });
    await assert.rejects(applyNativeScene(selected, geometry, composed, context, native.transport, held, new AbortController().signal));
    assert.equal(held.events.at(-1).kind, 'scene-held'); assert.equal(native.postCount, 6);
    assert.equal(inspections, 4); assert.equal(disposed, 4);
    unreadable = false;
    const competing = await openImportJournal(join(files.directory, 'competing-head'), { create: true });
    let finalOwnerDisposed = false;
    const changed = { ...composed, scene: { createNativeScanSceneImporter: options => ({
      async inspectCurrentScene(_input, _signal, expected) {
        assert.equal(expected.recordId, current.recordId);
        await assert.rejects(options.beforeDispatch('scene-association', {}), /cannot claim a mutation/);
        return null; // A different valid head does not authorize another write.
      }, dispose() { finalOwnerDisposed = true; },
    }) } };
    await assert.rejects(applyNativeScene(selected, geometry, changed, context, native.transport, competing,
      new AbortController().signal, { inspectCurrentScene: async () => current }), /no longer the exact current head/);
    assert(finalOwnerDisposed); assert.equal(native.postCount, 6); assert.equal(competing.events.at(-1).kind, 'scene-held');
    assert.equal(competing.events.filter(e => ['scene-reused', 'scene-complete'].includes(e.kind)).length, 0);
  } finally { geometry?.reader.dispose(); await files.cleanup(); }
});
test('final scene completion and reuse withhold a stale binding after an unrelated evidence append', async () => {
  for (const reused of [true, false]) {
    const files = await fixture(), native = fakeNative(), context = localContext(); let geometry;
    try {
      const selected = await files.selected();
      const journal = await openImportJournal(join(files.directory, 'final-binding'), { create: true });
      geometry = await applyNativeImport(selected, runtime, context, native.transport, journal, new AbortController().signal);
      selected.scene = { buildingId, sourceFloors: files.manifest.floors.map(f => ({ sourceFloorKey: f.sourceFloorKey,
        sourceOriginalSha256: f.sourceOriginalSha256 })), primary: { sha256: 'a'.repeat(64) }, historical: { sha256: 'b'.repeat(64) } };
      const current = { recordId: U(888), payload: { buildingId, sourceFloors: selected.scene.sourceFloors.map((source, index) => {
        const floor = geometry.frame.floors.find(row => row.geometryId === geometry.mappings[index].geometryId);
        return { ...source, nativeGeometryId: floor.geometryId, nativeGeometryRevision: floor.geometryRevision.toSafeInteger(),
          nativeFloorKey: floor.key, nativeOriginalAssetId: floor.originalAssetId, nativeOriginalSha256: floor.originalSHA256 };
      }), sourceDocuments: [{ role: 'primary-scene', originalAssetId: U(889), evidenceId: U(890) },
        { role: 'documentary-sheet', originalAssetId: U(891), evidenceId: U(892) }] } };
      let imports = 0;
      const append = () => {
        addSyntheticEvidence(native, 1); native.records.get(`identity:${buildingId}`).revision++;
      };
      const owner = { async inspectCurrentScene() { if (!reused) return null; append(); return current; },
        async importScene() { imports++; append(); return { outcome: 'committed', current }; } };
      // The orchestrator stub represents the already returned result; only the
      // unrelated writer changes synthetic local records. No provider is called.
      await assert.rejects(applyNativeScene(selected, geometry, runtime, context, native.transport, journal,
        new AbortController().signal, owner), /floor binding is no longer current/);
      assert.equal(native.postCount, 6); assert.equal(imports, reused ? 0 : 1);
      assert.equal(journal.events.at(-1).kind, 'scene-held');
      assert.equal(journal.events.filter(e => ['scene-complete', 'scene-reused', 'complete'].includes(e.kind)).length, 0);
      const final = await geometry.reader.loadBuilding(buildingId, new AbortController().signal);
      assert.deepEqual(final.floors.map(f => f.geometryId), geometry.frame.floors.map(f => f.geometryId));
      assert(final.floors.every(f => !current.payload.sourceFloors.some(row => row.nativeFloorKey === f.key)));
    } finally { geometry?.reader.dispose(); await files.cleanup(); }
  }
});
test('one explicit successor preserves the other native identity and refreshes ALL floor keys', async () => {
  const files = await fixture(), next = await fixture(['Changed']), native = fakeNative(), context = localContext();
  let reader;
  try {
    const first = await applyNativeImport(await files.selected(), runtime, context, native.transport,
      await openImportJournal(join(files.directory, 'first'), { create: true }), new AbortController().signal);
    const before = first.frame.floors.map(f => ({ id: f.geometryId, key: f.key })); first.reader.dispose();
    files.manifest.expectedCurrentGeometryIds = before.map(f => f.id);
    files.manifest.floors = [{ ...next.manifest.floors[0], sourceFloorKey: files.manifest.floors[0].sourceFloorKey,
      sourceOriginalSha256: files.manifest.floors[0].sourceOriginalSha256, previousGeometryId: before[0].id }, files.manifest.floors[1]];
    const successor = await applyNativeImport(await files.selected('successor.json'), runtime, context, native.transport,
      await openImportJournal(join(files.directory, 'next'), { create: true }), new AbortController().signal);
    reader = successor.reader;
    assert.equal(native.postCount, 9); assert.equal(successor.frame.floors.length, 2);
    assert.equal(successor.mappings[1].geometryId, before[1].id);
    assert.notEqual(successor.mappings[0].geometryId, before[0].id);
    assert(successor.frame.floors.every(f => !before.some(old => old.key === f.key)));
    const created = native.records.get(`geometry:${successor.mappings[0].geometryId}`);
    assert.equal(created.payload.previousGeometryId, before[0].id); assert.equal(created.payload.geometryVersion, 2);
    assert(native.records.has(`geometry:${before[0].id}`)); successor.reader.dispose();
  } finally { reader?.dispose(); await files.cleanup(); await next.cleanup(); }
});
test('UNKNOWN association uses its exact original batch for passive retained lookup, no second mutation', async () => {
  const files = await fixture(['Only']), native = fakeNative({ unknownAt: 3 }), context = localContext();
  try {
    const selected = await files.selected(), journal = await openImportJournal(join(files.directory, 'held'), { create: true });
    await assert.rejects(applyNativeImport(selected, runtime, context, journalTransport(native.transport, journal), journal, new AbortController().signal));
    const inspected = await inspectImportJournal(journal, runtime, context, native.transport, new AbortController().signal);
    assert.equal(native.postCount, 3); assert(inspected.inspections.some(row => JSON.parse(row.receipt).inspection.outcome === 'retained-commit'));
    assert.equal(inspected.status, 'held'); assert.equal(inspected.retrySafety, 'not-established');
  } finally { await files.cleanup(); }
});
test('selected-file mismatch and symlink refuse before any native request', async () => {
  const files = await fixture(['Only']);
  try {
    await assert.rejects(readPinnedFile({ ...files.manifest.floors[0].original, sha256: 'a'.repeat(64) }, 1000));
    const alias = join(files.directory, 'alias.usdz'); await symlink(files.manifest.floors[0].original.path, alias);
    await assert.rejects(readPinnedFile({ ...files.manifest.floors[0].original, path: alias }, 1000));
  } finally { await files.cleanup(); }
});
test('actual CLI parses its SHA-256 selector and validates generated files without a network path', async () => {
  const files = await fixture(['CLI']);
  try {
    await files.selected(); const path = join(files.directory, 'selection.json'), bytes = await readFile(path);
    const output = await promisify(execFile)(process.execPath, ['tools/geometry/native-scan-import.mjs', 'validate',
      '--manifest', path, '--sha256', sha256(bytes)], { timeout: 20000, maxBuffer: 65536 });
    const result = JSON.parse(output.stdout);
    assert.equal(result.status, 'validated'); assert.equal(result.manifestSha256, sha256(bytes));
    assert.equal(result.nativeMutation, false); assert.equal(result.sceneRequested, false);
  } finally { await files.cleanup(); }
});
test('normal sign-in observations form one owned current session/admission; logout contains no credential output', async () => {
  const calls = [], session = { schemaVersion: 1, actorId: U(9), csrfToken: 'synthetic-no-live-account', expiresAt: '2099-01-01T00:00:00Z' };
  const fake = async (path, init = {}) => { calls.push({ path, init });
    if (path.endsWith('/mode')) return json({ schemaVersion: 1, mode: 'trusted-proxy' });
    if (path.endsWith('/proxy') || path.endsWith('/session')) return json(session);
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    return json({ schemaVersion: 3, scope, commandIds: commands.filter(id => !['atlas.asset.create', 'atlas.scene-association.create'].includes(id)),
      nativeCommandIds: ['atlas.asset.create', 'atlas.scene-association.create'], revision: 'synthetic', maximumReasonCodePoints: 1024 }); };
  const owner = await createAgentContext({ scope }, fake, runtime, new AbortController().signal);
  assert.equal(owner.getBinding(), owner.getBinding()); assert.equal(owner.getContext().session.actorId, U(9));
  assert(owner.getContext().admission.nativeCommandIds.includes('atlas.asset.create'));
  assert(!owner.getContext().admission.genericCommandIds.includes('atlas.asset.create'));
  await owner.close(); assert.equal(owner.getContext(), null);
  assert.equal(calls.filter(row => row.path.endsWith('/proxy')).length, 1);
});
test('HTTPS framing retains body and cookie separately; transport selection refuses bypass options', () => {
  const response = parseCurlResponse(Buffer.from('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: synthetic=x; Secure; HttpOnly; SameSite=Strict\r\n\r\n{}'));
  assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 1);
  assert.throws(() => createNativeCurlTransport({ origin: 'http://synthetic.invalid', proxy: 'socks5h://127.0.0.1:11080', scope }));
  assert.throws(() => createNativeCurlTransport({ origin, proxy: 'http://new-proxy.invalid', scope }));
});
test('actual transport admits only the scoped compact scene-head GET before its aborted network boundary', async () => {
  const transport = createNativeCurlTransport({ origin, proxy: 'socks5h://127.0.0.1:11080', scope });
  const path = `/api/atlas/scene/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}/head`;
  const stopped = new Error('Synthetic stop before curl spawn');
  const signal = AbortSignal.abort(stopped);
  await assert.rejects(transport.exchange(path, { signal }), error => error === stopped);
  await assert.rejects(transport.exchange(`/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/invoke?request=synthetic`, { signal }),
    error => error === stopped);
  for (const query of ['?pageSize=101&includeArchived=true', '?pageSize=100&includeArchived=false',
    '?pageSize=100&includeArchived=true&cursor=synthetic', '?pageSize=100&includeArchived=true&q=synthetic',
    '?pageSize=100&includeArchived=true&pageSize=100', '?includeArchived=true&pageSize=100',
    '?pageSize=%31%30%30&includeArchived=true']) {
    await assert.rejects(transport.exchange(path + query, { signal }), /Unexpected native URL selector/);
  }
  await assert.rejects(transport.exchange(path, { method: 'POST', signal }), /Scene head is a read-only route/);
  await assert.rejects(transport.exchange(path.replace('/scene/v1/', '/stock/v3/'), { signal }),
    /Native route is not in the import closure/);
  await assert.rejects(transport.exchange(path.replace(scope.homeId, U(999)), { signal }),
    /Native route is not in the import closure/);
  transport.forget();
});
test('setup failure retires its own issued session and never performs an application mutation', async () => {
  const calls = [], session = { schemaVersion: 1, actorId: U(9), csrfToken: 'synthetic-no-live-account', expiresAt: '2099-01-01T00:00:00Z' };
  const fake = async (path, init = {}) => {
    calls.push({ path, init });
    if (path.endsWith('/mode')) return json({ schemaVersion: 1, mode: 'trusted-proxy' });
    if (path.endsWith('/proxy')) return json(session);
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    throw new Error('Synthetic canonical session read unavailable');
  };
  await assert.rejects(createAgentContext({ scope }, fake, runtime, new AbortController().signal));
  assert.equal(calls.filter(c => c.path.endsWith('/logout')).length, 1);
  assert(calls.every(c => c.path.startsWith('/api/atlas/auth/')));
});
