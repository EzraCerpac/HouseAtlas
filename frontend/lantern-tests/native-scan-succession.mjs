/** Successful synthetic two-floor succession through actual production clients.
 * Local fake transports only; no listener, native data, household input or controls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';
import { loadIfcGlbProfileSource, loadScanProfileSource } from './scan-mesh-read.mjs';
import { loadSessionExpirySource } from './native-geometry-read.mjs';
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function compile(path, replacements) {
  const file = new URL(path, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [name, destination] of Object.entries(replacements)) {
    const literal = JSON.stringify(name); assert(code.includes(literal), name);
    code = code.replaceAll(literal, JSON.stringify(destination));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:'), `Unlisted production import ${match[1]}`);
  return dataUrl(code);
}
const numeric = Object.fromEntries(await Promise.all(['decimal', 'lossless-json', 'schema-validator'].map(async name =>
  [`../src/numeric/${name}`, await loadNumericSource(`numeric/${name}.ts`)])));
const readerUrl = await compile('../integration/native-geometry-read-client.ts', {
  './session-expiry': await loadSessionExpirySource(),
  '../src/numeric/decimal': numeric['../src/numeric/decimal'],
  '../src/lantern/scans/mesh-profile': await loadScanProfileSource(),
  '../src/lantern/scans/ifc-glb-profile': await loadIfcGlbProfileSource(),
});
const associationUrl = await compile('../integration/native-geometry-association-client.ts', {
  ...numeric, './native-geometry-read-client': readerUrl,
});
const { createNativeGeometryAssociationClient } = await import(associationUrl);
const { createNativeGeometryReadClient } = await import(readerUrl);
const { isExactDecimal } = await import(numeric['../src/numeric/decimal']);
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({ workspaceId: uid(2), homeId: uid(3) });
const origin = 'https://synthetic.invalid', buildingId = uid(101), semanticsId = uid(201);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => hash(Buffer.from(JSON.stringify(value)));
const target = (recordType, recordId) => ({ authority: 'atlas', recordType, recordId });
const row = (kind, n, payload) => ({ target: target(kind, uid(n)), revision: 1, lifecycle: 'active', payload });
const evidence = statement => ({ statement, provenance: { source: null, sourceRevision: null, sourceConfidence: null,
  evidenceBasis: 'owner-report', factAt: null, retrievedAt: '2026-10-11T00:00:00Z', vantage: null,
  uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [] });
const rows = new Map();
const save = record => rows.set(`${record.target.recordType}:${record.target.recordId}`, record);
save(row('evidence', 100, evidence('Synthetic building naming only')));
save(row('identity', 101, { kind: 'location', evidenceIds: [uid(100)] }));
save(row('location-semantics', 201, { atlasId: buildingId, semanticKind: 'building', label: 'Synthetic building',
  reviewStatus: 'accepted', evidenceIds: [uid(100)] }));
const license = { status: 'unknown', reference: null };
for (const [original, derived] of [[701, 702], [711, 712], [721, 722]]) {
  const ifc = original === 721;
  save(row('asset', original, { owner: 'atlas', purpose: 'geometry-original', sha256: sha(original), byteSize: 1,
    contentType: ifc ? 'application/x-step' : 'model/vnd.usdz+zip', sourceLicense: license, availability: 'available', previewPolicy: 'download-only', evidenceIds: [] }));
  save(row('asset', derived, { owner: 'atlas', purpose: 'derived-preview', sha256: sha(derived), byteSize: 1,
    contentType: ifc ? 'model/gltf-binary' : 'application/vnd.houseatlas.magicplan-authored-mesh+json', sourceLicense: license,
    availability: 'available', previewPolicy: 'download-only', evidenceIds: [] }));
}
const sessionIdentity = Object.freeze({});
const session = { schemaVersion: 1, actorId: 'synthetic-editor', csrfToken: 'synthetic-csrf',
  expiresAt: new Date(Date.now() + 3600000).toISOString() };
const commandIds = ['atlas.identity.get', 'atlas.location-semantics.get', 'atlas.evidence.get', 'atlas.asset.get',
  'atlas.geometry.get', 'atlas.batch.execute', 'atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace'];
const admission = { scope, commandIds, revision: 'synthetic-current' };
const listeners = new Set(), calls = [], batches = [], descriptors = [];
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
function digest(root) { const copy = { ...root }; delete copy.requestId; delete copy.approvalReceiptId; return hash(Buffer.from(canonical(copy))); }
function response(value, viewKey = null) {
  let body = JSON.stringify(value);
  // Preserve a real JSON exponent token at a schema-bounded integer leaf.
  body = body.replaceAll('"geometryVersion":1', '"geometryVersion":1e0');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)), 'Cache-Control': 'private, no-store',
    ...(viewKey ? { 'X-Atlas-Geometry-View': viewKey } : {}) } });
}
function descriptor() {
  const geometry = [...rows.values()].filter(record => record.target.recordType === 'geometry');
  const previous = new Set(geometry.map(record => record.payload.previousGeometryId).filter(Boolean));
  const identity = rows.get(`identity:${buildingId}`), semantics = rows.get(`location-semantics:${semanticsId}`);
  const viewKey = sha([...rows.values()]);
  const floors = geometry.filter(record => !previous.has(record.target.recordId)).map(record => {
    const evidence = rows.get(`evidence:${record.payload.evidenceIds[0]}`);
    const original = rows.get(`asset:${record.payload.originalAssetId}`);
    const derivative = rows.get(`asset:${evidence.payload.references[1].assetId}`);
    const key = sha([identity, semantics, record, evidence, original, derivative]);
    const ifc = record.payload.producer === 'ifc';
    const floor = { key, exportLabel: 'Synthetic repeated label; never identity',
      originalSha256: original.payload.sha256, derivativeSha256: derivative.payload.sha256,
      geometryId: record.target.recordId, geometryRevision: record.revision,
      evidenceId: evidence.target.recordId, evidenceRevision: evidence.revision,
      originalAssetId: original.target.recordId, originalRevision: original.revision,
      derivativeAssetId: derivative.target.recordId, derivativeRevision: derivative.revision,
      originalLicense: license, derivativeLicense: license,
      profile: ifc ? 'houseatlas.ifc-derived-glb.v1' : 'houseatlas.magicplan-authored-mesh.v1',
      originalContentType: ifc ? 'application/x-step' : 'model/vnd.usdz+zip',
      derivativeContentType: ifc ? 'model/gltf-binary' : 'application/vnd.houseatlas.magicplan-authored-mesh+json',
      ...(ifc ? { sourceUnits: 'unknown', declaredSourceUnits: 'mm', sourceUpAxis: 'unknown', declaredSourceUpAxis: 'Z',
        glbUnits: 'm', glbUpAxis: 'Y', sourceToGlb: { axisMap: ['x', 'z', '-y'], scale: 0.001 },
        converter: { name: 'synthetic-test-converter', version: '1', configSha256: 'b'.repeat(64) } } : {}) };
    return { floor, readPath: `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}/frames/${viewKey}/meshes/${key}` };
  });
  return { schemaVersion: 1, profile: 'houseatlas.native-geometry.v2', scope, buildingId, viewKey, floors,
    physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null };
}
let client, binding;
const transport = async (path, init) => {
  assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  assert.equal(init.signal.aborted, false); calls.push([String(path), init.method]);
  const url = new URL(path, origin);
  if (url.pathname.endsWith(`/buildings/${buildingId}`)) {
    assert.equal(init.method, 'GET'); const value = descriptor(); descriptors.push(value); return response(value, value.viewKey);
  }
  if (init.method === 'GET') {
    const request = JSON.parse(url.searchParams.get('request'));
    assert.equal(request.commandId, `atlas.${request.target.recordType}.get`);
    const record = rows.get(`${request.target.recordType}:${request.target.recordId}`); assert(record);
    return response({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId,
      resolvedScope: scope, status: 'read', replayed: false, data: { records: [record], nextCursor: null, sourceStatus: 'current' } });
  }
  assert.equal(init.method, 'POST'); assert(url.pathname.endsWith(`/buildings/${buildingId}/associations`));
  assert.equal(init.headers['X-Atlas-CSRF'], session.csrfToken);
  const request = JSON.parse(init.body); batches.push(request);
  assert.equal(client.pending(binding).at(-1).outcome, 'unknown');
  assert.deepEqual(request.payload.commands.map(part => part.commandId), ['atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace']);
  const records = request.payload.commands.map(part => {
    const key = `${part.target.recordType}:${part.target.recordId}`, prior = rows.get(key);
    const payload = { ...part.payload, ...(part.target.recordType === 'geometry' ? { importedAt: '2026-10-11T00:00:01Z' } : {}) };
    const record = { target: part.target, lifecycle: 'active', revision: prior ? prior.revision + 1 : 1, payload };
    save(record); return record;
  });
  return response({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId, resolvedScope: scope,
    status: 'committed', replayed: false, operationId: crypto.randomUUID(), data: { records,
      auditIds: records.map(() => crypto.randomUUID()), requestDigest: digest(request) } });
};
client = createNativeGeometryAssociationClient({ origin, transport, getContext: () => ({ sessionIdentity, session: { ...session },
  scope: { ...scope }, admission: { ...admission, scope: { ...scope }, commandIds: [...commandIds] } }),
  subscribe: changed => { listeners.add(changed); return () => listeners.delete(changed); } });
binding = client.getBinding(); assert(binding);
const signal = new AbortController().signal, selected = [];
for (const [originalAssetId, derivativeAssetId] of [[uid(701), uid(702)], [uid(711), uid(712)]]) {
  const current = await client.load(binding, { buildingId, semanticsId, originalAssetId, derivativeAssetId }, signal);
  const prepared = client.prepare(current, { statement: 'Synthetic floor custody association', reason: 'Synthetic initial floor' });
  await client.commit(prepared, signal);
  const body = batches.at(-1); assert.equal(body.payload.commands[1].payload.geometryVersion, 1);
  assert.equal(body.payload.commands[1].payload.previousGeometryId, null);
  selected.push(body.payload.commands[1].target.recordId);
}
const readBinding = Object.freeze({ sessionIdentity, expiresAt: session.expiresAt, scope });
const reader = createNativeGeometryReadClient({ origin, transport, getBinding: () => readBinding,
  subscribeBinding: changed => { listeners.add(changed); return () => listeners.delete(changed); } });
try {
  const before = await reader.loadBuilding(buildingId, signal); assert.equal(before.floors.length, 2);
  const prior = rows.get(`geometry:${selected[0]}`), priorCopy = structuredClone(prior);
  const current = await client.load(binding, { buildingId, semanticsId, originalAssetId: uid(721), derivativeAssetId: uid(722),
    previousGeometryId: selected[0] }, signal);
  const previous = current.records.find(record => record.target.recordType === 'geometry');
  assert(isExactDecimal(previous.revision)); assert.equal(previous.payload.geometryVersion.token, '1e0');
  const prepared = client.prepare(current, { statement: 'Synthetic partial update', reason: 'Replace only explicitly selected predecessor' });
  const body = JSON.parse(prepared.body), successor = body.payload.commands[1];
  assert.equal(successor.payload.geometryVersion, 2); assert.equal(successor.payload.previousGeometryId, selected[0]);
  assert.equal(successor.payload.producer, 'ifc'); assert.equal(successor.payload.exportFormat, 'ifc');
  assert.equal(successor.payload.coordinateUnits, 'unknown');
  const oldEvidence = rows.get(`evidence:${prior.payload.evidenceIds[0]}`);
  const required = [target('geometry', selected[0]), target('evidence', oldEvidence.target.recordId),
    ...oldEvidence.payload.references.map(ref => target('asset', ref.assetId))];
  for (const expected of required) for (const guards of [body.preconditions.guards, successor.preconditions.guards])
    assert(guards.some(guard => canonical(guard.target) === canonical(expected) && guard.revision.value === 1));
  await client.commit(prepared, signal);
  const after = await reader.loadBuilding(buildingId, signal); assert.equal(after.floors.length, 2);
  assert(after.floors.some(floor => floor.geometryId === successor.target.recordId));
  assert(after.floors.some(floor => floor.geometryId === selected[1]));
  assert.equal(after.floors.find(floor => floor.geometryId === successor.target.recordId).profile, 'houseatlas.ifc-derived-glb.v1');
  assert(after.floors.every(floor => !before.floors.some(old => old.key === floor.key)));
  assert.deepEqual(rows.get(`geometry:${selected[0]}`), priorCopy);
  assert.equal(rows.size, 15); // Three immutable geometry + evidence rows; existing roots retained.
  assert.equal(client.pending(binding).at(-1).outcome, 'committed');
  assert.equal(batches.length, 3);
  assert(calls.some(([path]) => path.includes('atlas.geometry.get')));
  console.log('PASS native scan succession production TS clients/schema: two Magicplan roots -> explicit IFC successor with unknown source units, mixed descriptor, exact guards and retained history; local fake transports only');
} finally { reader.dispose(); }
