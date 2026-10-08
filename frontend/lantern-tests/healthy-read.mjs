/** Ordinary synthetic projection examples; no HTTP listener or write. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { projectView } from '../src/lantern/adapters/read.ts';
import { createGeometryClient } from '../src/api/geometry-client.ts';
import { createEvidenceClient } from '../src/api/evidence-client.ts';
import { createOperationHistoryClient } from '../src/api/operation-history-client.ts';
import { createRetainedIntentClient, canReadRetainedIntent } from '../src/api/retained-intent-client.ts';
import { demoSnapshot, demoOptions } from '../../web/demo/fixtures.mjs';
import { prepareAtlasView } from '../../web/src/prepare.mjs';

// Compile the actual binder with its unchanged frozen catalog offline. Its
// browser JSON imports have no Node import attributes; no runtime host is used.
const catalogData = JSON.parse(readFileSync(new URL('../../contracts/stock-wire3/agent/operation-catalog.json', import.meta.url)));
const familyData = JSON.parse(readFileSync(new URL('../../contracts/stock-wire3/agent/tool-families.json', import.meta.url)));
const catalogModule = 'data:text/javascript;base64,' + Buffer.from(
  `export const stockCatalog=${JSON.stringify(catalogData)};export const stockFamilies=${JSON.stringify(familyData)};`
).toString('base64');
const binderSource = readFileSync(new URL('../src/webmcp/coverage/families.ts', import.meta.url), 'utf8')
  .replace('"../stock-schema.js"', JSON.stringify(catalogModule));
const binderModule = stripTypeScriptTypes(binderSource, { mode: 'strip' });
const { bindAtlasService, bindCommandFamilies } = await import('data:text/javascript;base64,' + Buffer.from(binderModule).toString('base64'));
const nativeHomeboxReads = ['homebox.entity.tags.get', 'homebox.field.list', 'homebox.field.get',
  'homebox.maintenance.list', 'homebox.maintenance.get'];
const nativeHomeboxSession = { state: 'authenticated', revision: 'synthetic-homebox-reads' };
const nativeHomeboxScope = { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002' };
const nativeHomeboxContext = { session: { actorId: '00000000-0000-4000-8000-000000000007', csrfToken: 'synthetic-unused', expiresAt: '2026-10-08T12:00:00Z' },
  scope: nativeHomeboxScope, commandIds: nativeHomeboxReads };
const nativeHomeboxSessions = { getSnapshot: () => nativeHomeboxSession,
  subscribe: () => () => {}, getContext: () => nativeHomeboxContext };
const nativeHomeboxDispatches = [];
const nativeHomeboxService = { async dispatch(request, context) {
  nativeHomeboxDispatches.push({ request, context }); return request;
} };
const nativeHomeboxBindings = bindAtlasService(nativeHomeboxService, nativeHomeboxReads);
assert.deepEqual(nativeHomeboxBindings.filter(row => row.commandIds.length).map(row => [row.toolName, row.commandIds]), [
  ['homebox_tags_fields', nativeHomeboxReads.slice(0, 3)],
  ['homebox_maintenance', nativeHomeboxReads.slice(3)],
]);
const nativeHomeboxPorts = bindCommandFamilies(nativeHomeboxSessions, nativeHomeboxBindings);
assert.deepEqual(nativeHomeboxPorts.sessions.getContext(nativeHomeboxSession).commandIds, nativeHomeboxReads);
for (const commandId of nativeHomeboxReads) {
  const request = { commandId, context: nativeHomeboxScope };
  const context = { session: nativeHomeboxSession, signal: new AbortController().signal,
    applicationSession: nativeHomeboxContext.session };
  assert.equal(await nativeHomeboxPorts.service.dispatch(request, context), request);
  assert.equal(nativeHomeboxDispatches.at(-1).request, request);
  assert.equal(nativeHomeboxDispatches.at(-1).context, context);
}
assert(nativeHomeboxPorts.coverage().filter(row => nativeHomeboxReads.includes(row.commandId))
  .every(row => row.state === 'admitted-and-bound'));
assert(nativeHomeboxPorts.coverage().filter(row => !nativeHomeboxReads.includes(row.commandId))
  .every(row => row.state === 'not-host-admitted'));

const snapshot = demoSnapshot('normal');
const options = demoOptions(snapshot, 'normal');
options.now = '2026-10-08T00:00:00Z';
const view = prepareAtlasView(snapshot, options);
assert.equal(view.status, 'ready');
const projected = projectView(view);
assert.equal(projected.house.name, view.homeLabel);
assert.equal(projected.view, view);
assert.equal(projected.house.geometry, 'none');
assert(projected.house.floors.every(f => !f.hasPlan));
assert(projected.house.spaces.every(s => s.geometry === 'none' && !s.shape));
assert(projected.house.items.every(i => !i.pos && !i.spaceId && !i.containerId && i.locationClaim === 'unknown'));
assert.equal(projected.house.history.length, 0);
assert.equal(projected.house.writes.length, 0);
assert.equal(new Set([...projected.house.spaces, ...projected.house.items].map(e => e.id)).size, view.entries.length);
for (const entry of view.entries) {
  const source = [...projected.entries.values()].find(e => e === entry);
  assert.equal(source, entry);
}
assert(projected.house.docs.every(d => d.addedAt === '' && d.preview === 'none' && d.version === 0));
const radio = view.entries.find(e => e.entity.name === 'Portable radio');
assert(radio);
assert(projected.house.tasks.some(t => t.status === 'done' && t.completedAt === radio.maintenance.find(m => m.completedDate).completedDate));
assert(projected.house.docs.some(d => projected.docAccess.get(d.id)?.previewHref === '/api/atlas/media/example-photo'));
for (const semanticKind of ['room', 'container', 'site', 'other', 'unclassified', 'building', 'floor']) {
  const entry = view.entries.find(e => e.kind === 'place');
  const variant = projectView({ ...view, entries: [{ ...entry, semanticKind }] });
  assert.equal(variant.house.spaces.length, 1);
  assert.equal(variant.house.spaces[0].semanticKind, semanticKind);
  assert.equal(variant.entries.values().next().value.semanticKind, semanticKind);
  assert(!variant.house.spaces[0].shape);
}
const original = view.entries[0];
const unknown = projectView({ ...view, entries: [{ ...original, kind: 'unknown', semanticKind: undefined }] });
assert.equal(unknown.house.spaces.length, 0);
assert.equal(unknown.house.items.length, 1);
assert(unknown.house.items[0].id.startsWith('uk-'));
assert.equal(unknown.entries.get(unknown.house.items[0].id).kind, 'unknown');
assert.equal(projected.house.displayNow, view.now);
const geometrySnapshot = JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/optional-geometry.snapshot.json', import.meta.url)));
const geometryRecord = geometrySnapshot.records.find(record => record.recordType === 'geometry');
assert(geometryRecord);
const publicGeometry = {
  target: { authority: 'atlas', recordType: 'geometry', recordId: geometryRecord.recordId },
  revision: geometryRecord.revision,
  lifecycle: geometryRecord.lifecycle,
  payload: geometryRecord.payload,
};
const geometryScope = { workspaceId: geometryRecord.workspaceId, homeId: geometryRecord.homeId };
const geometryView = prepareAtlasView(geometrySnapshot, {
  authorization: { ...geometryScope, allowed: true, allowedHomeIds: [geometryScope.homeId], canEditHomebox: false },
  homeLabel: 'Synthetic home', homes: [], now: '2026-01-02T12:05:00Z',
});
assert.equal(geometryView.status, 'ready');
const geometryEnvelope = (records, nextCursor, sourceStatus = 'current') => ({
  schemaVersion: 3, commandId: 'atlas.geometry.list',
  requestId: '00000000-0000-4000-8000-000000000901',
  resolvedScope: geometryScope, status: 'read', replayed: false,
  data: { records, nextCursor, sourceStatus },
});
const signal = new AbortController().signal;
const geometryBase = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(geometryScope.workspaceId)}/homes/${encodeURIComponent(geometryScope.homeId)}/records/geometry`;
const assertGeometryRequest = (url, init, expectedCursor) => {
  const parsed = new URL(url, 'https://atlas.invalid');
  assert.equal(parsed.pathname, geometryBase);
  assert.equal(parsed.searchParams.get('pageSize'), '100');
  assert.equal(parsed.searchParams.get('includeArchived'), 'false');
  assert.equal(parsed.searchParams.get('cursor'), expectedCursor);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), expectedCursor === null
    ? ['includeArchived', 'pageSize'] : ['cursor', 'includeArchived', 'pageSize']);
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.signal, signal);
};
let singleCalls = 0;
const singleClient = createGeometryClient(async (url, init) => {
  singleCalls++;
  assertGeometryRequest(url, init, null);
  return { ok: true, json: async () => geometryEnvelope([publicGeometry], null, 'stale') };
});
const geometryRead = await singleClient.read(geometryScope, signal);
assert.equal(singleCalls, 1);
assert.equal(geometryRead.status, 'ready');
assert.equal(geometryRead.sourceStatus, 'stale');
assert.deepEqual(geometryRead.records, [publicGeometry]);
const geometryProjection = projectView(geometryView, geometryRead);
assert.equal(geometryProjection.geometryMetadata, geometryRead);
const cabinet = geometryProjection.house.spaces.find(space => space.name === 'Synthetic cabinet');
assert(cabinet);
assert.deepEqual(geometryProjection.geometryMappings.get(cabinet.id), [
  { record: publicGeometry, mapping: publicGeometry.payload.mappings[0] },
]);
assert.equal(geometryProjection.geometryMappings.size, 1);
assert.equal(geometryProjection.house.geometry, 'none');
assert(geometryProjection.house.floors.every(floor => !floor.hasPlan));
assert(geometryProjection.house.spaces.every(space => space.geometry === 'none' && !space.shape));
assert(geometryProjection.house.items.every(item => !item.pos && !item.spaceId && !item.containerId));

// Two schema-valid positive point reads preserve the full public evidence payload.
const evidenceRecord = geometrySnapshot.records.find(record => record.recordType === 'evidence');
assert(evidenceRecord);
const evidencePayload = {
  ...evidenceRecord.payload,
  statement: 'Synthetic survey café + original evidence statement',
  provenance: { ...evidenceRecord.payload.provenance,
    source: publicGeometry.payload.mappings[0].homeboxEntity,
    sourceRevision: 'source-revision-007', sourceConfidence: 'Owner supplied confidence',
    factAt: '2026-10-08T13:05:00.123+02:00', retrievedAt: '2026-10-08T14:15:00+02:00',
    vantage: null },
  supersedesEvidenceIds: ['00000000-0000-4000-8000-000000000981'],
  references: [
    { kind: 'atlas-asset', assetId: publicGeometry.payload.originalAssetId },
    { kind: 'homebox-attachment', entity: publicGeometry.payload.mappings[0].homeboxEntity,
      attachmentId: '00000000-0000-4000-8000-000000000982' },
    { kind: 'external-link', url: 'https://example.invalid/original?label=caf%C3%A9+survey', archived: false },
  ],
};
const evidenceOriginal = JSON.stringify(evidencePayload);
for (const lifecycle of ['active', 'tombstoned']) {
  const publicEvidence = {
    target: { authority: 'atlas', recordType: 'evidence', recordId: evidenceRecord.recordId },
    revision: lifecycle === 'active' ? evidenceRecord.revision : evidenceRecord.revision + 1,
    lifecycle, payload: evidencePayload,
  };
  let evidenceCalls = 0;
  const evidenceClient = createEvidenceClient(async (url, init) => {
    evidenceCalls++;
    assert.equal(url, `/api/atlas/stock/v3/workspaces/${geometryScope.workspaceId}/homes/${geometryScope.homeId}/records/evidence/${evidenceRecord.recordId}`);
    assert.equal(new URL(url, 'https://atlas.invalid').search, '');
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    assert.equal(init.signal, signal);
    assert.equal(init.body, undefined);
    return { ok: true, json: async () => ({
      schemaVersion: 3, commandId: 'atlas.evidence.get',
      requestId: '00000000-0000-4000-8000-000000000983', resolvedScope: geometryScope,
      status: 'read', replayed: false,
      data: { records: [publicEvidence], nextCursor: null, sourceStatus: 'current' },
    }) };
  });
  const evidenceRead = await evidenceClient.read(geometryScope, evidenceRecord.recordId, signal);
  assert.equal(evidenceCalls, 1);
  assert.deepEqual(evidenceRead, { status: 'ready', record: publicEvidence, sourceStatus: 'current' });
  assert.equal(evidenceRead.record, publicEvidence);
  assert.equal(evidenceRead.record.payload, evidencePayload);
  assert.equal(JSON.stringify(evidenceRead.record.payload), evidenceOriginal);
}

const operationScope = geometryScope;
const operationEntries = [
  {
    eventId: '00000000-0000-4000-8000-000000000911',
    rootOperationId: '00000000-0000-4000-8000-000000000921',
    operationId: '00000000-0000-4000-8000-000000000931',
    commandId: 'atlas.geometry.create',
    actorId: '00000000-0000-4000-8000-000000000941',
    at: '2026-10-08T13:05:00.123+02:00',
    target: { authority: 'atlas', recordType: 'geometry', recordId: geometryRecord.recordId },
    requestDigest: 'a'.repeat(64),
    state: 'committed',
  },
  {
    eventId: '00000000-0000-4000-8000-000000000912',
    rootOperationId: '00000000-0000-4000-8000-000000000922',
    operationId: '00000000-0000-4000-8000-000000000932',
    commandId: 'atlas.geometry.tombstone',
    actorId: '00000000-0000-4000-8000-000000000942',
    at: '2026-10-08T09:00:00Z',
    target: { authority: 'atlas', recordType: 'geometry', recordId: geometryRecord.recordId },
    requestDigest: 'b'.repeat(64),
    state: 'committed',
  },
];
const operationPage = (entries, nextCursor) => ({
  format: 'atlas-operation-events/1', resolvedScope: operationScope,
  coverage: 'retained-atlas-stock-only', completeness: 'partial',
  order: 'audit-sequence-ascending', entries, nextCursor,
});
const assertOperationRequest = (url, init, expectedCursor) => {
  const parsed = new URL(url, 'https://atlas.invalid');
  assert.equal(parsed.pathname, '/api/atlas/operation-events');
  assert.equal(parsed.searchParams.get('homeId'), operationScope.homeId);
  assert.equal(parsed.searchParams.get('pageSize'), '25');
  assert.equal(parsed.searchParams.get('cursor'), expectedCursor);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), expectedCursor === null
    ? ['homeId', 'pageSize'] : ['cursor', 'homeId', 'pageSize']);
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.signal, signal);
};
let operationSingleCalls = 0;
const operationSingleClient = createOperationHistoryClient(async (url, init) => {
  operationSingleCalls++;
  assertOperationRequest(url, init, null);
  return { ok: true, json: async () => operationPage(operationEntries, null) };
});
const operationSingleRead = await operationSingleClient.read(operationScope, signal);
assert.equal(operationSingleCalls, 1);
assert.deepEqual(operationSingleRead, { status: 'ready', page: operationPage(operationEntries, null) });
assert.deepEqual(operationSingleRead.page.entries.map(entry => entry.eventId), operationEntries.map(entry => entry.eventId));
assert.equal(operationSingleRead.page.entries[0].at, operationEntries[0].at);
const operationProjection = projectView(geometryView, geometryRead, operationSingleRead);
assert.equal(operationProjection.operationHistory, operationSingleRead);
assert.equal(operationProjection.house.history.length, 0);

const operationCursor = 'opaque+/operation==';
let operationPageCalls = 0;
const operationPagedClient = createOperationHistoryClient(async (url, init) => {
  const page = operationPageCalls++;
  assertOperationRequest(url, init, page === 0 ? null : operationCursor);
  return { ok: true, json: async () => page === 0
    ? operationPage([operationEntries[0]], operationCursor)
    : operationPage([operationEntries[1]], null) };
});
const operationFirstRead = await operationPagedClient.read(operationScope, signal);
assert.equal(operationPageCalls, 1);
assert.deepEqual(operationFirstRead, { status: 'ready', page: operationPage([operationEntries[0]], operationCursor) });
const operationPagedRead = await operationPagedClient.read(operationScope, signal, operationFirstRead.page.nextCursor);
assert.equal(operationPageCalls, 2);
assert.deepEqual(operationPagedRead, { status: 'ready', page: operationPage([operationEntries[1]], null) });
assert.deepEqual([operationFirstRead.page.entries[0], operationPagedRead.page.entries[0]], operationEntries);
const emptyOperationClient = createOperationHistoryClient(async (url, init) => {
  assertOperationRequest(url, init, null);
  return { ok: true, json: async () => operationPage([], null) };
});
assert.deepEqual(await emptyOperationClient.read(operationScope, signal),
  { status: 'ready', page: operationPage([], null) });

// A single scoped, positive retained lookup of the complete synthetic request.
const retainedRequest = {
  schemaVersion: 3, commandId: 'atlas.identity.create',
  requestId: '00000000-0000-4000-8000-000000000951', context: operationScope,
  target: { authority: 'atlas', recordType: 'identity', recordId: '00000000-0000-4000-8000-000000000952' },
  payload: { kind: 'item', evidenceIds: [] },
  idempotencyKey: '00000000-0000-4000-8000-000000000953',
  reason: 'Synthetic retained lookup café + exact intent',
  preconditions: { target: null, guards: [] }, approvalReceiptId: null,
};
const retainedOperationId = '00000000-0000-4000-8000-000000000954';
const retainedReceipt = {
  format: 'atlas-retained-reconciliation/1', lookupRequestId: retainedRequest.requestId,
  inspection: {
    format: 'atlas-retained-intent-inspection/1', resolvedScope: operationScope,
    coverage: 'retained-atlas-stock-only', outcome: 'retained-commit', retrySafety: 'not-established',
    rootOperationId: retainedOperationId, operationId: retainedOperationId,
    commandId: retainedRequest.commandId, requestDigest: 'c'.repeat(64),
  },
  committedResult: {
    originalRequestId: retainedRequest.requestId,
    wire: {
      schemaVersion: 3, commandId: retainedRequest.commandId, requestId: retainedRequest.requestId,
      resolvedScope: operationScope, status: 'committed', replayed: false, operationId: retainedOperationId,
      data: { auditIds: ['00000000-0000-4000-8000-000000000955'], records: [{
        target: retainedRequest.target, revision: 1, lifecycle: 'active', payload: retainedRequest.payload,
      }], requestDigest: 'c'.repeat(64) },
    },
    children: [], originalMediaRelease: 'not-established', originalHttpDelivery: 'not-established',
  },
};
const retainedRequestJson = JSON.stringify(retainedRequest);
let retainedCalls = 0;
const retainedClient = createRetainedIntentClient(async (url, init) => {
  retainedCalls++;
  const parsed = new URL(url, 'https://atlas.invalid');
  assert.equal(parsed.pathname, '/api/atlas/retained-intent');
  assert.equal(parsed.searchParams.get('homeId'), operationScope.homeId);
  assert.equal(parsed.searchParams.get('intent'), retainedRequestJson);
  assert.deepEqual(JSON.parse(parsed.searchParams.get('intent')), retainedRequest);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['homeId', 'intent']);
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.signal, signal);
  return { ok: true, json: async () => retainedReceipt };
});
assert.equal(canReadRetainedIntent(retainedRequest), true);
const retainedRead = await retainedClient.read(retainedRequest, operationScope, signal);
assert.equal(retainedCalls, 1);
assert.deepEqual(retainedRead, { status: 'ready', receipt: retainedReceipt });
assert.equal(JSON.stringify(retainedRequest), retainedRequestJson);

const retainedSecondRequest = {
  ...retainedRequest, requestId: '00000000-0000-4000-8000-000000000961',
  target: { ...retainedRequest.target, recordId: '00000000-0000-4000-8000-000000000962' },
  idempotencyKey: '00000000-0000-4000-8000-000000000963', payload: { kind: 'location', evidenceIds: [] },
};
const retainedBatchRequest = {
  ...retainedRequest, commandId: 'atlas.batch.execute',
  requestId: '00000000-0000-4000-8000-000000000971',
  idempotencyKey: '00000000-0000-4000-8000-000000000973',
  target: { authority: 'atlas', kind: 'batch', batchId: '00000000-0000-4000-8000-000000000972' },
  payload: { commands: [retainedRequest, retainedSecondRequest] },
};
const retainedBatchOperationId = '00000000-0000-4000-8000-000000000974';
const retainedBatchChildren = [retainedReceipt.committedResult.wire, {
  ...retainedReceipt.committedResult.wire, requestId: retainedSecondRequest.requestId,
  operationId: '00000000-0000-4000-8000-000000000964',
  data: { auditIds: ['00000000-0000-4000-8000-000000000965'], records: [{
    target: retainedSecondRequest.target, revision: 1, lifecycle: 'active', payload: retainedSecondRequest.payload,
  }], requestDigest: 'd'.repeat(64) },
}];
const retainedBatchReceipt = {
  ...retainedReceipt, lookupRequestId: retainedBatchRequest.requestId,
  inspection: { ...retainedReceipt.inspection, commandId: retainedBatchRequest.commandId,
    rootOperationId: retainedBatchOperationId, operationId: retainedBatchOperationId, requestDigest: 'e'.repeat(64) },
  committedResult: {
    ...retainedReceipt.committedResult, originalRequestId: retainedBatchRequest.requestId,
    wire: { ...retainedReceipt.committedResult.wire, commandId: retainedBatchRequest.commandId,
      requestId: retainedBatchRequest.requestId, operationId: retainedBatchOperationId,
      data: { auditIds: retainedBatchChildren.flatMap(child => child.data.auditIds),
        records: retainedBatchChildren.flatMap(child => child.data.records), requestDigest: 'e'.repeat(64) } },
    children: retainedBatchChildren,
  },
};
let retainedBatchCalls = 0;
const retainedBatchClient = createRetainedIntentClient(async (url, init) => {
  retainedBatchCalls++;
  const parsed = new URL(url, 'https://atlas.invalid');
  assert.equal(parsed.pathname, '/api/atlas/retained-intent');
  assert.equal(parsed.searchParams.get('homeId'), operationScope.homeId);
  assert.equal(parsed.searchParams.get('intent'), JSON.stringify(retainedBatchRequest));
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['homeId', 'intent']);
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.signal, signal);
  return { ok: true, json: async () => retainedBatchReceipt };
});
assert.equal(canReadRetainedIntent(retainedBatchRequest), true);
assert.deepEqual(await retainedBatchClient.read(retainedBatchRequest, operationScope, signal),
  { status: 'ready', receipt: retainedBatchReceipt });
assert.equal(retainedBatchCalls, 1);
assert.deepEqual(retainedBatchReceipt.committedResult.children.map(child => child.requestId),
  [retainedRequest.requestId, retainedSecondRequest.requestId]);

const opaqueCursor = 'opaque+/cursor==';
let pageCalls = 0;
const pagedClient = createGeometryClient(async (url, init) => {
  const page = pageCalls++;
  assertGeometryRequest(url, init, page === 0 ? null : opaqueCursor);
  return { ok: true, json: async () => page === 0
    ? geometryEnvelope([publicGeometry], opaqueCursor)
    : geometryEnvelope([], null) };
});
const pagedRead = await pagedClient.read(geometryScope, signal);
assert.equal(pageCalls, 2);
assert.deepEqual(pagedRead, { status: 'ready', records: [publicGeometry], sourceStatus: 'current' });
const undated = projectView({ ...view, entries: [{ ...original, maintenance: [{ entryId: 'unscheduled', name: 'Undated upkeep', description: '', scheduledDate: null, completedDate: null, cost: null }] }] });
assert.equal(undated.house.tasks[0].status, 'unknown');
assert.equal(undated.house.tasks[0].due, undefined);
const alternate = { ...view, scope: { ...view.scope, homeId: '00000000-0000-4000-8000-000000000099' }, entries: [] };
assert.notEqual(projectView(alternate).house.id, projected.house.id);
assert.equal(projectView(alternate).house.items.length, 0);
const archive = new URL('../lantern-reference/HouseAtlas-Lantern-B-Source.zip', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(readFileSync(archive)), '96a884bf935e6aedfa3e5b4f415cce8be295630fe052dc66c5497f8b87b1da63');
const hashes = JSON.parse(readFileSync(new URL('../lantern-reference/Claude-source-hashes.json', import.meta.url)));
assert.equal(Object.keys(hashes).length, 44);
for (const [path, expected] of Object.entries(hashes)) {
  const result = spawnSync('unzip', ['-p', archive.pathname, `HouseAtlas-Lantern-B/${path}`]);
  assert.equal(result.status, 0);
  assert.equal(digest(result.stdout), expected, path);
}
console.log('PASS synthetic scoped projection, geometry, linked active/tombstoned evidence, operation history and original retained-intent reads, opaque sequential pagination, arbitrary place kinds, unknown placement, retained source metadata, actual document handles, source dates, maintenance, and 44 unchanged authored reference hashes');
