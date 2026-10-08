/** Ordinary synthetic projection examples; no HTTP listener or write. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectView } from '../src/lantern/adapters/read.ts';
import { createGeometryClient } from '../src/api/geometry-client.ts';
import { createOperationHistoryClient } from '../src/api/operation-history-client.ts';
import { demoSnapshot, demoOptions } from '../../web/demo/fixtures.mjs';
import { prepareAtlasView } from '../../web/src/prepare.mjs';

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
console.log('PASS synthetic scoped projection, geometry and operation history reads, opaque sequential pagination, arbitrary place kinds, unknown placement, retained source metadata, actual document handles, source dates, maintenance, and 44 unchanged authored reference hashes');
