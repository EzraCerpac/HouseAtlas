/** Successful synthetic source-free native naming via actual client/schema/lossless modules. No listener/provider. */
import assert from 'node:assert/strict';
import { loadNumericSource } from './load-numeric-source.mjs';
const { createNativePlaceClient } = await import(await loadNumericSource('api/native-place-client.ts'));
const { parseLosslessJson, stringifyLosslessJson } = await import(await loadNumericSource('numeric/lossless-json.ts'));
const { buildTopologyIndex } = await import(await loadNumericSource('lantern/topology/model.ts'));
const U = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const scope = { workspaceId: U(1), homeId: U(2) };
const session = { schemaVersion: 1, actorId: U(3), csrfToken: 'synthetic-local-only', expiresAt: '2099-01-01T00:00:00Z' };
const commands = ['atlas.batch.execute', 'atlas.evidence.create', 'atlas.identity.create', 'atlas.location-semantics.create', 'atlas.location-semantics.replace', 'atlas.relation.create', 'atlas.identity.get', 'atlas.evidence.get', 'atlas.location-semantics.get'];
const admission = { scope, commandIds: commands, revision: 'synthetic-current' };
const target = (kind, id) => ({ authority: 'atlas', recordType: kind, recordId: id });
const provenance = { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'owner-report', factAt: null, retrievedAt: '2026-10-10T00:00:00Z', vantage: null, uncertainty: { status: 'unknown', explanation: null } };
const evidence = { statement: 'Synthetic floor measurement report.', provenance, supersedesEvidenceIds: [], references: [] };
const records = new Map([
  [`identity/${U(10)}`, { target: target('identity', U(10)), revision: 1, lifecycle: 'active', payload: { kind: 'location', evidenceIds: [U(12)] } }],
  [`evidence/${U(12)}`, { target: target('evidence', U(12)), revision: 1, lifecycle: 'active', payload: evidence }],
  [`location-semantics/${U(11)}`, parseLosslessJson(JSON.stringify({ target: target('location-semantics', U(11)), revision: 1, lifecycle: 'active', payload: { atlasId: U(10), semanticKind: 'floor', reviewStatus: 'accepted', evidenceIds: [U(12)], elevation: { status: 'known', metres: 0, datumAtlasId: U(10) } } }).replace('"metres":0', '"metres":1e-1000'))],
]);
const posts = [], reads = [], retainedReads = [], saved = new Map();
let currentScope = scope, currentAdmission = admission;
const client = createNativePlaceClient({ getContext: () => ({ session, scope: currentScope, admission: currentAdmission }), subscribe: () => () => {}, transport: async (url, init) => {
  const path = new URL(url, 'https://atlas.invalid');
  assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  if (init.method === 'GET') {
    assert.equal(path.pathname, `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/invoke`);
    assert.deepEqual([...path.searchParams.keys()], ['request']);
    const request = JSON.parse(path.searchParams.get('request')); reads.push(request);
    assert(commands.includes(request.commandId));
    const record = records.get(`${request.target.recordType}/${request.target.recordId}`); assert(record);
    return new Response(stringifyLosslessJson({ schemaVersion: 3, requestId: request.requestId, commandId: request.commandId, status: 'read', resolvedScope: scope, replayed: false,
      data: { records: [record], nextCursor: null, sourceStatus: 'current' } }), { status: 200 });
  }
  assert.equal(init.method, 'POST'); assert.equal(path.search, '');
  if (path.pathname === '/api/atlas/retained-intent') {
    assert.equal(init.headers['x-atlas-csrf'], session.csrfToken);
    const request = parseLosslessJson(init.body), prior = saved.get(request.requestId); assert(prior);
    assert.equal(init.body, prior.body); // Exact already-submitted bytes, including the original elevation token.
    retainedReads.push(init.body);
    return new Response(stringifyLosslessJson({ format: 'atlas-retained-reconciliation/1', lookupRequestId: request.requestId,
      inspection: { format: 'atlas-retained-intent-inspection/1', resolvedScope: scope, coverage: 'retained-atlas-stock-only',
        outcome: 'retained-commit', retrySafety: 'not-established', rootOperationId: prior.wire.operationId,
        operationId: prior.wire.operationId, commandId: request.commandId, requestDigest: prior.wire.data.requestDigest },
      committedResult: { originalRequestId: request.requestId, wire: prior.wire, children: prior.children,
        originalMediaRelease: 'not-established', originalHttpDelivery: 'not-established' } }), { status: 200 });
  }
  assert.equal(path.pathname, `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/commands`);
  assert.equal(init.headers['x-atlas-csrf'], session.csrfToken);
  const request = parseLosslessJson(init.body); posts.push(request);
  assert.equal(request.commandId, 'atlas.batch.execute'); assert.deepEqual(request.context, scope);
  const produced = request.payload.commands.map(child => {
    const key = `${child.target.recordType}/${child.target.recordId}`;
    const prior = records.get(key);
    const revision = prior ? Number(String(prior.revision)) + 1 : 1;
    const record = { target: child.target, revision, lifecycle: 'active', payload: child.payload }; records.set(key, record); return record;
  });
  const wire = { schemaVersion: 3, commandId: request.commandId, requestId: request.requestId, resolvedScope: scope, status: 'committed', replayed: false,
    operationId: U(900 + posts.length), data: { records: produced, auditIds: produced.map((_, index) => U(1000 + posts.length * 10 + index)), requestDigest: 'a'.repeat(64) } };
  const children = request.payload.commands.map((child, index) => ({ schemaVersion: 3, commandId: child.commandId, requestId: child.requestId,
    resolvedScope: scope, status: 'committed', replayed: false, operationId: U(2000 + posts.length * 10 + index),
    data: { records: [produced[index]], auditIds: [wire.data.auditIds[index]], requestDigest: 'b'.repeat(64) } }));
  saved.set(request.requestId, { body: init.body, wire, children });
  return new Response(stringifyLosslessJson(wire), { status: 200 });
} });
const binding = client.getBinding(); assert(binding);
assert.equal(client.canCreate(binding, true), true); assert.equal(client.canRename(binding), true);
const created = client.prepareCreate(binding, { label: 'Synthetic building', kind: 'building', statement: 'I name this synthetic building; no physical placement is inferred.', reason: 'Synthetic naming example' });
assert.equal((await client.commit(created, new AbortController().signal)).status, 'committed');
const buildingChildren = posts[0].payload.commands;
assert.equal(buildingChildren.length, 3); assert.equal(buildingChildren[0].payload.provenance.source, null); assert.equal(buildingChildren[0].payload.provenance.factAt, null);
assert.equal(buildingChildren[0].payload.provenance.evidenceBasis, 'owner-report');
assert.equal(buildingChildren[2].payload.label, 'Synthetic building');
for (const child of buildingChildren) assert.deepEqual(child.preconditions.guards, []); // Earlier batch creates satisfy actual native reference semantics.
const buildingIdentity = records.get(`identity/${buildingChildren[1].target.recordId}`), buildingClassification = records.get(`location-semantics/${buildingChildren[2].target.recordId}`);
const room = client.prepareCreate(binding, { label: 'Synthetic room', kind: 'room', statement: 'I report this synthetic room belongs to the selected synthetic building.', reason: 'Synthetic reviewed membership', building: { identity: buildingIdentity, classification: buildingClassification } });
assert.equal((await client.commit(room, new AbortController().signal)).status, 'committed');
assert.equal(posts[1].payload.commands.length, 4); assert.equal(posts[1].payload.commands[3].payload.membershipKind, 'building');
assert.equal(posts[1].preconditions.guards.length, 2);
const loaded = await client.load(binding, U(11), new AbortController().signal);
assert.equal(loaded.record.payload.elevation.metres.token, '1e-1000'); assert.equal(loaded.record.revision, 1);
assert.equal(loaded.guards.length, 2);
const rename = client.prepareRename(loaded, { label: 'Synthetic level', statement: 'I report this synthetic level name.', reason: 'Synthetic rename' });
assert(rename.body.includes('"metres":1e-1000')); assert.equal((await client.commit(rename, new AbortController().signal)).status, 'committed');
assert.equal(posts[2].payload.commands[1].preconditions.target.value.token, '1');
assert.equal(posts[2].payload.commands[1].payload.label, 'Synthetic level');
assert.equal(posts[2].payload.commands[1].payload.evidenceIds[0], U(12));
// A coherent view reload replaces scope/admission allocations while keeping the actual session.
currentScope = { ...scope }; currentAdmission = { ...admission, scope: currentScope };
const reloadedBinding = client.getBinding(); assert(reloadedBinding); assert.notEqual(reloadedBinding, binding);
const pendingRename = client.pending(reloadedBinding).find(entry => entry.prepared === rename); assert(pendingRename);
assert.equal(pendingRename.prepared.body, rename.body); assert.equal(pendingRename.outcome, 'committed');
assert.equal(pendingRename.receipt.requestId, rename.requestId);
assert.equal(pendingRename.receipt.data.records[1].payload.elevation.metres.token, '1e-1000');
const inspection = await client.inspect(reloadedBinding, rename, new AbortController().signal);
assert.equal(inspection.status, 'ready'); assert.equal(inspection.receipt.inspection.retrySafety, 'not-established');
assert.deepEqual(inspection.receipt.committedResult.children.map(child => child.requestId), posts[2].payload.commands.map(child => child.requestId));
assert.equal(inspection.receipt.committedResult.children[1].data.records[0].payload.elevation.metres.token, '1e-1000');
assert.equal(client.pending(reloadedBinding).find(entry => entry.prepared === rename).inspection, inspection);
assert.equal(retainedReads.length, 1); assert.equal(retainedReads[0], rename.body);
const renamed = await client.load(reloadedBinding, U(11), new AbortController().signal);
const clear = client.prepareRename(renamed, { label: null, statement: 'I remove only the synthetic display name.', reason: 'Synthetic clear' });
assert(clear.body.includes('"metres":1e-1000')); assert.equal((await client.commit(clear, new AbortController().signal)).status, 'committed');
assert.equal(Object.hasOwn(posts[3].payload.commands[1].payload, 'label'), false); assert.equal(posts[3].payload.commands[1].payload.evidenceIds.length, 3);
const data = { identities: [buildingIdentity], bindings: [], semantics: [buildingClassification], relations: [], sourceStatuses: ['current'] };
const view = { scope, entries: [] };
const index = buildTopologyIndex(data, view, new Map());
assert.equal(index.buildings[0].name, 'Synthetic building'); assert.equal(index.buildings[0].labelOwner, 'atlas'); assert.equal(index.buildings[0].entry, undefined);
assert.equal(posts.length, 4); assert.equal(reads.length, 7);
console.log('PASS native place: source-free building/room and explicit membership, guarded rename/clear, original exact elevation/evidence, lexical current CSRF, canonical request/results, exact serialized passive retained inspection across coherent view reload, Atlas label without HomeBox');
