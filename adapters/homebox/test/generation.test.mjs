import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeBoxAdapter, cacheFreshness, DEFAULT_LIMITS, HOMEBOX_REFERENCE_VERSION } from '../src/index.mjs';
import { validateSnapshot, boundaries } from '../../../packages/contracts/src/index.mjs';
import { reg, ids, NOW, pinnedPage, baseline, detail, fakeTransport, response, options, metadata } from './support.mjs';

const snapshot = result => ({ contractVersion: '1.0.0', synthetic: true, sources: [reg], records: [], caches: [result.cache], homeboxEntities: result.homeboxEntities, networkRelations: [] });
test('full bounded generation uses explicit partitions, archives, GET-only scoped requests', async () => {
  const { transport, calls } = fakeTransport();
  const result = await createHomeBoxAdapter({ ...options(transport), limits: { maxPageSize: 1 } }).fetchGeneration();
  assert.equal(result.ok, true);
  assert.equal(result.cache.status, 'fresh');
  assert.equal(result.quarantineTransition, 'revalidation-candidate');
  assert.equal(result.homeboxEntities.length, 3);
  assert.equal(result.stats.pages, 3);
  assert.equal(result.stats.requests, 9);
  assert.equal(result.deletionConfirmed, false);
  validateSnapshot(snapshot(result));
  const lists = calls.filter(c => c.path === '/api/v1/entities');
  assert.deepEqual(lists.map(c => new URLSearchParams(c.query).get('isLocation')), ['true', 'false', 'false']);
  assert.ok(lists.every(c => new URLSearchParams(c.query).get('includeArchived') === 'true'));
  for (const c of calls) {
    assert.equal(c.method, 'GET'); assert.equal(c.headers['X-Tenant'], reg.collectionId);
    assert.equal(c.redirect, 'error'); assert.equal(c.scope.homeId, reg.homeId);
    assert.equal(c.body, undefined); assert.equal(c.headers.Authorization, undefined);
    assert.ok(!/attachment|diagnostic|lease|import/.test(c.path));
  }
  assert.deepEqual(DEFAULT_LIMITS, boundaries.defaults);
  assert.equal(HOMEBOX_REFERENCE_VERSION, 'v0.26.2');
});
test('pinned minimal wire page becomes explicit unknowns with arbitrary type preserved', async () => {
  const entities = pinnedPage.items.map(e => ({ ...structuredClone(e), attachments: [] }));
  const { transport } = fakeTransport({ entities });
  const result = await createHomeBoxAdapter(options(transport)).fetchGeneration();
  assert.equal(result.ok, true);
  const p = result.homeboxEntities.find(p => p.entity.id === ids.location);
  assert.deepEqual(p.entity.entityType, pinnedPage.items[0].entityType);
  assert.equal(p.entity.quantity, null); assert.equal(p.entity.manufacturer, null);
  assert.equal(result.homeboxEntities.find(p => p.entity.id === ids.unknown).entity.entityType, null);
  assert.deepEqual(p.nativeLinks, []);
});
test('UUIDs normalize at every ingress without changing opaque tenant spelling', async () => {
  const entities = [detail('ABCDEFAB-0000-4000-8000-000000000500', true, { entityType: { id: 'ABCDEFAB-0000-4000-8000-000000000700', name: 'Unusual provider container', isLocation: true }, attachments: [{ attachmentId: 'ABCDEFAB-0000-4000-8000-000000000800', kind: 'stored-file', title: '', byteSize: null, contentType: null, proxyRef: 'ignored-unqualified-capability' }] })];
  const result = await createHomeBoxAdapter(options(fakeTransport({ entities }).transport)).fetchGeneration();
  assert.equal(result.ok, true);
  const p = result.homeboxEntities[0];
  assert.equal(p.entity.id, entities[0].id.toLowerCase());
  assert.equal(p.entity.entityType.id, entities[0].entityType.id.toLowerCase());
  assert.equal(p.attachments[0].attachmentId, entities[0].attachments[0].attachmentId.toLowerCase());
  assert.equal(p.attachments[0].proxyRef, null);
});
test('metadata retains references, schedules, unknowns and source time without fetching links or bytes', async () => {
  const { transport, calls } = fakeTransport();
  const result = await createHomeBoxAdapter(options(transport)).fetchGeneration();
  assert.equal(result.ok, true);
  const item = result.homeboxEntities.find(p => p.entity.id === ids.item);
  assert.equal(item.entity.parent.id, ids.location);
  assert.equal(item.attachments.length, 2);
  assert.equal(item.attachments[0].proxyRef, null);
  assert.equal(item.attachments[1].archived, false);
  assert.equal(item.maintenance[0].completedDate, null);
  assert.equal(item.maintenance[0].cost, null);
  assert.equal(item.sourceUpdatedAt, '2026-01-01T00:00:00Z');
  assert.equal(item.retrievedAt, NOW);
  assert.ok(calls.every(c => !c.path.includes('attachments') && !c.path.startsWith('http')));
});
test('successful empty collection has generation and success time; missing rows never prove deletion', async () => {
  const prior = { cache: baseline.caches[0], homeboxEntities: baseline.homeboxEntities.filter(p => p.homeId === reg.homeId) };
  const result = await createHomeBoxAdapter(options(fakeTransport({ entities: [] }).transport)).fetchGeneration({ previous: prior });
  assert.equal(result.ok, true); assert.equal(result.cache.status, 'fresh');
  assert.equal(result.homeboxEntities.length, 0); assert.equal(result.cache.generationId, ids.generation);
  assert.equal(result.cache.lastSuccessfulFetchAt, NOW);
  assert.equal(result.missingExternalIds.length, prior.homeboxEntities.length);
  assert.equal(result.deletionConfirmed, false);
  assert.equal(prior.cache.lastSuccessfulFetchAt, baseline.caches[0].lastSuccessfulFetchAt);
});
test('native links require explicit route and matching full scope; default withheld', async () => {
  const nativeNavigation = { workspaceId: reg.workspaceId, homeId: reg.homeId, sourceInstanceId: reg.sourceInstanceId, collectionId: reg.collectionId, origin: 'https://synthetic-homebox.example.invalid', routes: { edit: { verified: true, path: '/entities/{entityId}' }, maintenance: { verified: true, path: '/entities/{entityId}/maintenance' } } };
  const result = await createHomeBoxAdapter({ ...options(fakeTransport().transport), nativeNavigation }).fetchGeneration();
  assert.equal(result.ok, true);
  for (const p of result.homeboxEntities) {
    assert.equal(p.nativeLinks.length, 2);
    assert.ok(p.nativeLinks.every(l => l.verifiedRoute && l.entity.key.externalId === p.entity.id));
    assert.equal(p.nativeLinks[0].href, nativeNavigation.origin + '/entities/' + p.entity.id);
  }
  for (const origin of ['https://user:secret@example.invalid', 'https://example.invalid?token=secret', 'https://example.invalid/path', 'javascript:secret']) {
    assert.throws(() => createHomeBoxAdapter({ ...options(fakeTransport().transport), nativeNavigation: { ...nativeNavigation, origin } }));
  }
  assert.throws(() => createHomeBoxAdapter({ ...options(fakeTransport().transport), nativeNavigation: { ...nativeNavigation, homeId: baseline.sources[1].homeId } }), e => e.code === 'wrong-scope');
  assert.throws(() => createHomeBoxAdapter({ ...options(fakeTransport().transport), nativeNavigation: { ...nativeNavigation, routes: { edit: { verified: false, path: '/entities/{entityId}' } } } }));
});
test('read-time freshness computes honest age without changing persisted times', async () => {
  const result = await createHomeBoxAdapter(options(fakeTransport().transport)).fetchGeneration();
  const original = structuredClone(result.cache);
  const f = cacheFreshness(result.cache, { now: '2026-10-06T11:00:00.000Z', staleAfterMs: 1000 });
  assert.equal(f.ageMs, 3600000); assert.equal(f.cache.status, 'stale');
  assert.deepEqual(result.cache, original);
  assert.equal(f.cache.lastSuccessfulFetchAt, NOW);
});
test('explicit archive and null parents remain provider-owned facts without floor inference', async () => {
  const result = await createHomeBoxAdapter(options(fakeTransport({ entities: [detail(ids.item, false, { archived: true, parent: null })] }).transport)).fetchGeneration();
  assert.equal(result.ok, true); assert.equal(result.homeboxEntities[0].entity.archived, true);
  assert.equal(result.homeboxEntities[0].entity.parent, null);
  assert.ok(!('floor' in result.homeboxEntities[0].entity));
});
