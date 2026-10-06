import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AtlasStore, scope, principal, fixture, ref, guard, at, options, seeded,
  createCircuit, circuitTarget, replace, lifecycle, nextGeneration, partitionOf, authorize, U } from './helpers.mjs';
import { ContractError, recordDigest, validateResult } from '../../contracts/src/index.mjs';

const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
test('durable single receipt replays its original audit and revision after reopen and later edits', () => {
  const { path, store } = seeded();
  const result = store.execute(principal, scope, circuitTarget, createCircuit());
  validateResult(result, null); assert.equal(result.audit.actorId, principal.actorId);
  store.execute(principal, scope, circuitTarget, replace(result.record, 1001, { label: 'Reviewed label' }));
  store.close();
  const reopened = new AtlasStore(options(path));
  const replay = reopened.execute(principal, scope, circuitTarget, createCircuit());
  assert.equal(replay.replayed, true); assert.deepEqual(replay.record, result.record); assert.deepEqual(replay.audit, result.audit);
  assert.equal(reopened.readRecord(principal, scope, circuitTarget).revision, 2);
  assert.equal(reopened.history(principal, scope, circuitTarget).length, 2);
  rejects(() => reopened.execute(principal, scope, circuitTarget, { ...createCircuit(), reason: 'Changed reason' }), 'idempotency-conflict');
  reopened.close();
});
test('authorization runs before replay, derives actor, and denies revoked/viewer/foreign access', () => {
  const { store } = seeded(); store.execute(principal, scope, circuitTarget, createCircuit());
  rejects(() => store.execute({ ...principal, role: 'viewer' }, scope, circuitTarget, createCircuit()), 'forbidden');
  rejects(() => store.execute({ ...principal, active: false }, scope, circuitTarget, createCircuit()), 'unauthenticated');
  rejects(() => store.execute(principal, { ...scope, homeId: U(3) }, circuitTarget, createCircuit()), 'not-found');
  rejects(() => store.readRecord(principal, scope, ref('identity', 202)), 'not-found');
  rejects(() => store.execute(principal, scope, ref('circuit', 901), { ...createCircuit(1002), actorId: U(66) }), 'invalid-contract');
  const p2 = { ...principal, actorId: U(51) };
  const result = store.execute(p2, scope, ref('circuit', 901), createCircuit());
  assert.equal(result.audit.actorId, U(51)); store.close();
});
test('scope control: cached projections and records from another home are never returned', () => {
  const { store } = seeded(); const s = store.readSnapshot(principal, scope);
  for (const field of ['sources','records','homeboxEntities','caches','networkRelations']) assert(s[field].every(r => r.homeId === scope.homeId));
  const other = { ...principal, homeId: U(3) }; const s2 = store.readSnapshot(other, { ...scope, homeId: U(3) });
  assert(s2.records.length > 0); assert(s2.records.every(r => r.homeId === U(3))); store.close();
});
test('two open connections use per-record CAS; unrelated edits retain their own revisions', () => {
  const { store, path } = seeded(); const second = new AtlasStore(options(path));
  const a = store.readRecord(principal, scope, ref('circuit', 401));
  const b = second.readRecord(principal, scope, ref('valve', 403));
  store.execute(principal, scope, ref('circuit', 401), replace(a, 1000, { label: 'A' }));
  const result = second.execute(principal, scope, ref('valve', 403), replace(b, 1001, { label: 'B' })); assert.equal(result.record.revision, 2);
  rejects(() => second.execute(principal, scope, ref('circuit', 401), replace(a, 1002, { label: 'Stale' })), 'revision-conflict');
  assert.equal(store.readRecord(principal, scope, ref('circuit', 401)).payload.label, 'A');
  second.close(); store.close();
});
test('missing and stale guards, duplicates and maximum revision reject whole batch', () => {
  const { store, path } = seeded(); const before = store.readSnapshot(principal, scope);
  rejects(() => store.execute(principal, scope, circuitTarget, { ...createCircuit(), guards: [] }), 'guard-conflict');
  rejects(() => store.execute(principal, scope, circuitTarget, { ...createCircuit(), guards: [guard('evidence', 100, 2)] }), 'guard-conflict');
  const envelope = { schemaVersion: 1, batchId: U(1100), reason: 'Review', commands: [
    { target: circuitTarget, command: createCircuit() }, { target: ref('valve', 903), command: { ...createCircuit(1001), guards: [] } },
  ] };
  rejects(() => store.executeBatch(principal, scope, envelope), 'invalid-contract');
  envelope.commands[1] = { target: circuitTarget, command: createCircuit(1001) };
  rejects(() => store.executeBatch(principal, scope, envelope), 'invalid-contract');
  assert.deepEqual(store.readSnapshot(principal, scope), before);
  store.close();
  const db = new DatabaseSync(path); const row = db.prepare('SELECT body FROM records WHERE record_id=?').get(U(401));
  const record = JSON.parse(row.body); record.revision = Number.MAX_SAFE_INTEGER;
  db.prepare('UPDATE records SET revision=?,body=? WHERE record_id=?').run(record.revision, JSON.stringify(record), record.recordId); db.close();
  const reopened = new AtlasStore(options(path));
  rejects(() => reopened.execute(principal, scope, ref('circuit', 401), replace(record, 1004)), 'invalid-transition'); reopened.close();
});
test('atomic remap binds ordered batch reason and each child receipt durably', () => {
  const { store, path } = seeded();
  const envelope = JSON.parse((awaitImportRemap()));
  const result = store.executeBatch(principal, scope, envelope); assert.equal(result.results.length, 3);
  assert.equal(store.readRecord(principal, scope, ref('binding', 301)).payload.reviewStatus, 'retired');
  store.close(); const reopened = new AtlasStore(options(path));
  assert.equal(reopened.executeBatch(principal, scope, envelope).replayed, true);
  const variants = [ { ...envelope, reason: 'Changed' }, { ...envelope, commands: envelope.commands.slice(0, 1) },
    { ...envelope, commands: [...envelope.commands].reverse() }, { ...envelope, batchId: U(1199) } ];
  for (const changed of variants) rejects(() => reopened.executeBatch(principal, scope, changed), 'idempotency-conflict');
  const child = envelope.commands[0]; rejects(() => reopened.execute(principal, scope, child.target, child.command), 'idempotency-conflict');
  for (const r of result.results) assert.equal(reopened.history(principal, scope, { recordType: r.record.recordType, recordId: r.record.recordId }).length, 1);
  reopened.close();
});
import { readFileSync } from 'node:fs';
function awaitImportRemap() { return readFileSync(new URL('../../contracts/fixtures/import-remap.batch.json', import.meta.url), 'utf8'); }
test('permanent identities and qualified binding keys survive tombstones and retirement', () => {
  const { store } = seeded();
  const binding = store.readRecord(principal, scope, ref('binding', 301));
  store.execute(principal, scope, ref('binding', 301), replace(binding, 1000, { reviewStatus: 'retired' }, [guard('identity', 201), guard('evidence', 100)]));
  store.execute(principal, scope, ref('binding', 301), lifecycle('tombstone', 1001, 2, [guard('identity', 201), guard('evidence', 100)]));
  rejects(() => store.execute(principal, scope, ref('binding', 999), { ...createCircuit(1002), guards: [guard('identity', 201), guard('evidence', 100)],
    value: { recordType: 'binding', payload: binding.payload } }), 'identity-conflict');
  rejects(() => store.execute(principal, scope, ref('valve', 301), { ...createCircuit(1003), value: { recordType: 'valve', payload: { label: null, medium: 'unknown', evidenceIds: [U(100)] } } }), 'identity-conflict');
  const record = store.readRecord(principal, scope, ref('circuit', 401));
  const dead = store.execute(principal, scope, ref('circuit', 401), lifecycle('tombstone', 1004));
  const live = store.execute(principal, scope, ref('circuit', 401), lifecycle('restore', 1005, 2));
  assert.deepEqual(dead.record.payload, record.payload); assert.deepEqual(live.record.payload, record.payload); assert.equal(live.record.revision, 3); store.close();
});
test('rollback control: faults after records, audit, receipts and before commit leave no durable fragment', () => {
  for (const phase of ['after-final-validation','after-record','after-audit','after-receipt','before-commit']) {
    let enabled = false;
    const { store, path } = seeded('plan-free', { fault: p => { if (enabled && p === phase) throw new Error('Injected interruption'); } });
    const before = store.readSnapshot(principal, scope); enabled = true;
    assert.throws(() => store.execute(principal, scope, circuitTarget, createCircuit()), /Injected/);
    enabled = false; assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
    const reopened = new AtlasStore(options(path));
    const result = reopened.execute(principal, scope, circuitTarget, createCircuit());
    assert.equal(result.replayed, false); assert.equal(result.record.revision, 1); assert.equal(reopened.history(principal, scope, circuitTarget).length, 1); reopened.close();
  }
});
test('receipt control: exact retries create one audit and cannot disappear after reopen', () => {
  const { path, store } = seeded(); const first = store.execute(principal, scope, circuitTarget, createCircuit()); store.close();
  const reopened = new AtlasStore(options(path)); let again;
  assert.doesNotThrow(() => { again = reopened.execute(principal, scope, circuitTarget, createCircuit()); });
  assert(again.replayed); assert.equal(recordDigest(first.record), recordDigest(again.record)); assert.equal(reopened.history(principal, scope, circuitTarget).length, 1); reopened.close();
});
test('cache generation replaces one qualified source atomically; incomplete or racing publication is rejected', () => {
  let enabled = false;
  const { store, path } = seeded('plan-free', { fault: phase => { if (enabled && phase === 'after-cache-projections') throw new Error('Cache fault'); } });
  const before = store.readSnapshot(principal, scope), input = nextGeneration(before);
  input.homeboxEntities[0].entity.name = 'Updated arbitrary cabinet';
  rejects(() => store.replaceCacheGeneration(principal, scope, { ...input, complete: false }), 'invalid-contract');
  const cross = structuredClone(input); cross.homeboxEntities[0].homeId = U(3);
  rejects(() => store.replaceCacheGeneration(principal, scope, cross), 'forbidden');
  enabled = true; assert.throws(() => store.replaceCacheGeneration(principal, scope, input), /Cache fault/); enabled = false;
  assert.deepEqual(store.readSnapshot(principal, scope), before);
  store.replaceCacheGeneration(principal, scope, input);
  rejects(() => store.replaceCacheGeneration(principal, scope, { ...input, cache: { ...input.cache, generationId: U(951) } }), 'guard-conflict');
  const preflight = store.readCacheForPublication(principal, scope, partitionOf(before.caches[0]));
  const empty = { ...nextGeneration(store.readSnapshot(principal, scope), 952, preflight.cacheEpoch), homeboxEntities: [] };
  store.replaceCacheGeneration(principal, scope, empty);
  assert.equal(store.readSnapshot(principal, scope).homeboxEntities.length, 0);
  assert.deepEqual(store.readRecord(principal, scope, ref('binding', 300)), before.records.find(r => r.recordId === U(300)));
  store.close(); const reopened = new AtlasStore(options(path));
  assert.equal(reopened.readSnapshot(principal, scope).caches[0].generationId, U(952)); reopened.close();
});
test('cache timestamp control: outages preserve successful fetch age, raw errors stay private and revoked data is denied', () => {
  const { store, path } = seeded(); const before = store.readSnapshot(principal, scope), key = before.caches[0];
  const failed = store.recordCacheFailure(principal, scope, key, { code: 'timeout' });
  assert.equal(failed.lastSuccessfulFetchAt, key.lastSuccessfulFetchAt); assert.equal(failed.generationId, key.generationId);
  assert.equal(failed.lastAttemptAt, at); assert.deepEqual(store.readSnapshot(principal, scope).homeboxEntities, before.homeboxEntities);
  const revoked = store.recordCacheFailure(principal, scope, key, { code: 'auth' });
  assert.equal(revoked.status, 'access-revoked'); assert.equal(store.readSnapshot(principal, scope).homeboxEntities.length, 0);
  const laterTimeout = store.recordCacheFailure(principal, scope, key, { code: 'timeout', status: 'error' });
  assert.equal(laterTimeout.status, 'access-revoked'); assert.equal(store.readSnapshot(principal, scope).homeboxEntities.length, 0);
  assert(store.readSnapshot(principal, scope).networkRelations.length > 0); store.close();
  const reopened = new AtlasStore(options(path)); assert.equal(reopened.readSnapshot(principal, scope).homeboxEntities.length, 0); reopened.close();
});
test('source policy partitions are registered by server capability; caller cannot relabel source owner', () => {
  const { store } = seeded(); const source = fixture('plan-free').sources[0];
  rejects(() => store.registerSource({ ...principal, role: 'viewer' }, source), 'forbidden');
  rejects(() => store.registerSource(principal, { ...source, owner: 'network' }), 'identity-conflict');
  const other = { ...principal, homeId: U(3) };
  rejects(() => store.registerSource(other, { ...source, homeId: U(3) }), 'identity-conflict');
  const denied = store.readSnapshot({ ...principal, deniedSource: U(10) }, scope);
  assert.equal(denied.homeboxEntities.length, 0); assert(denied.networkRelations.length > 0); store.close();
});
test('available asset requires server verification; manifest failure rolls back record, audit and receipt', () => {
  const { store, path } = seeded(); const asset = fixture('optional-geometry').records.find(r => r.recordType === 'asset');
  asset.payload.availability = 'available';
  const command = { schemaVersion: 1, mutationId: U(1000), operation: 'create', expectedRevision: null,
    reason: 'Synthetic original', guards: [guard('evidence', 100)], value: { recordType: 'asset', payload: asset.payload } };
  store.close();
  const noVerifier = new AtlasStore({ ...options(path), verifyAvailableAsset: undefined });
  rejects(() => noVerifier.execute(principal, scope, ref('asset', 998), command), 'invalid-transition'); noVerifier.close();
  const broken = new AtlasStore({ ...options(path), fault: p => { if (p === 'after-asset-manifest') throw new Error('Manifest write fault'); } });
  assert.throws(() => broken.execute(principal, scope, ref('asset', 998), command), /Manifest/); broken.close();
  const reopened = new AtlasStore(options(path));
  rejects(() => reopened.readAssetManifest(principal, scope, ref('asset', 998)), 'not-found');
  const committed = reopened.execute(principal, scope, ref('asset', 998), command);
  assert.equal(committed.replayed, false); assert.deepEqual(reopened.readAssetManifest(principal, scope, ref('asset', 998)), asset.payload); reopened.close();
});
test('commit authorization control: loss of authority after receipt write rolls back the complete mutation', () => {
  let mutationChecks = 0;
  const { path, store } = seeded('plan-free', { authorize: (p, request) => {
    if (request.capability === 'mutate' && ++mutationChecks === 2) throw new ContractError('forbidden', 'Authority revoked');
    assert(!request.targets || request.targets.every(t => Object.keys(t).length === 2));
    return authorize(p, request);
  } });
  const before = store.readSnapshot(principal, scope);
  assert.throws(() => store.execute(principal, scope, circuitTarget, createCircuit()), e => e.code === 'forbidden');
  assert.equal(mutationChecks, 2); assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
  const reopened = new AtlasStore(options(path)); const result = reopened.execute(principal, scope, circuitTarget, createCircuit());
  assert.equal(result.replayed, false); assert.equal(reopened.history(principal, scope, circuitTarget).length, 1); reopened.close();
});
test('batch fault after its first receipt preserves every preimage and permits one complete retry', () => {
  let enabled = false;
  const { path, store } = seeded('plan-free', { fault: (phase, detail) => {
    if (enabled && phase === 'after-receipt' && detail.index === 0) throw new Error('Partial batch fault');
  } });
  const envelope = JSON.parse(awaitImportRemap()), before = store.readSnapshot(principal, scope); enabled = true;
  assert.throws(() => store.executeBatch(principal, scope, envelope), /Partial batch/); enabled = false;
  assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
  const reopened = new AtlasStore(options(path)); assert.equal(reopened.executeBatch(principal, scope, envelope).replayed, false);
  for (const c of envelope.commands) assert.equal(reopened.history(principal, scope, c.target).length, 1); reopened.close();
});
test('batch creates can reference new records in arbitrary order while guards retain original preimages', () => {
  const { store } = seeded(); const original = store.readRecord(principal, scope, ref('identity', 201));
  const binding = fixture('plan-free').records.find(r => r.recordId === U(302)).payload;
  const envelope = { schemaVersion: 1, batchId: U(1150), reason: 'Synthetic reviewed new identity', commands: [
    { target: ref('binding', 990), command: { ...createCircuit(1000), value: { recordType: 'binding', payload: {
      ...binding, atlasId: U(991), source: { ...binding.source, externalId: 'synthetic-new' } } } } },
    { target: ref('identity', 991), command: { ...createCircuit(1001), value: { recordType: 'identity', payload: original.payload } } },
  ] };
  const result = store.executeBatch(principal, scope, envelope); assert.equal(result.results.length, 2);
  assert.equal(store.readRecord(principal, scope, ref('binding', 990)).payload.atlasId, U(991)); store.close();
});
test('late complete cache response cannot undo a newer quarantine and generation IDs stay reserved', () => {
  const { store, path } = seeded(); const before = store.readSnapshot(principal, scope), oldGeneration = nextGeneration(before);
  store.close();
  const later = new AtlasStore({ ...options(path), clock: () => '2026-01-04T12:00:00Z' });
  later.recordCacheFailure(principal, scope, before.caches[0], { code: 'wrong-scope' });
  rejects(() => later.replaceCacheGeneration(principal, scope, oldGeneration), 'guard-conflict');
  assert.equal(later.readSnapshot(principal, scope).homeboxEntities.length, 0);
  const preflight = later.readCacheForPublication(principal, scope, partitionOf(before.caches[0]));
  const newer = { ...oldGeneration, expectedCacheEpoch: preflight.cacheEpoch,
    cache: { ...oldGeneration.cache, lastSuccessfulFetchAt: '2026-01-05T12:00:00Z', lastAttemptAt: '2026-01-05T12:00:00Z' } };
  later.replaceCacheGeneration(principal, scope, newer); assert(later.readSnapshot(principal, scope).homeboxEntities.length > 0);
  const reused = { ...newer, expectedCacheEpoch: preflight.cacheEpoch + 1, expectedGenerationId: newer.cache.generationId,
    cache: { ...newer.cache, generationId: before.caches[0].generationId } };
  rejects(() => later.replaceCacheGeneration(principal, scope, reused), 'idempotency-conflict'); later.close();
});
test('each cached projection uses an exact qualified source grant and a fresh cache cannot grant access', () => {
  let denied = true; const seen = [];
  const { store } = seeded('plan-free', { authorize: (p, request) => {
    if (request.capability === 'read-cache' && request.source) {
      seen.push(request.source);
      assert.equal(request.source.workspaceId, scope.workspaceId);
      assert.equal(request.source.homeId, scope.homeId);
      assert.equal(Object.keys(request.source.key).length, 4);
      if (denied && request.source.key.sourceInstanceId === U(10)) throw new ContractError('not-found', 'Source disabled');
    }
    return authorize(p, request);
  } });
  const blocked = store.readSnapshot(principal, scope); assert.equal(blocked.homeboxEntities.length, 0);
  assert.equal(blocked.caches[0].status, 'access-revoked'); assert(blocked.networkRelations.length > 0);
  assert(seen.some(s => s.key.sourceKind === 'network-device')); denied = false;
  assert(store.readSnapshot(principal, scope).homeboxEntities.length > 0); store.close();
});
test('Network relation cache preserves attempt-start/completion times and qualifiers independently across reopen', () => {
  const { store, path } = seeded(), before = store.readSnapshot(principal, scope);
  const network = before.sources.find(s => s.owner === 'network');
  const cache = { ...before.caches[0], sourceInstanceId: network.sourceInstanceId, collectionId: network.collectionId,
    generationId: U(970), lastAttemptAt: '2026-01-03T11:59:00Z', lastSuccessfulFetchAt: at };
  store.replaceCacheGeneration(principal, scope, { cache, homeboxEntities: [], networkRelations: before.networkRelations,
    expectedGenerationId: null, expectedCacheEpoch: 0, complete: true }); store.close();
  const reopened = new AtlasStore(options(path));
  const s = reopened.readSnapshot(principal, scope); assert.deepEqual(s.networkRelations, before.networkRelations);
  assert.deepEqual(s.homeboxEntities, before.homeboxEntities);
  assert.equal(s.caches.find(c => c.sourceInstanceId === network.sourceInstanceId).lastAttemptAt, cache.lastAttemptAt);
  reopened.recordCacheFailure(principal, scope, { ...scope, ...network }, { code: 'transport' });
  assert.deepEqual(reopened.readSnapshot(principal, scope).networkRelations, before.networkRelations);
  reopened.recordCacheFailure(principal, scope, { ...scope, ...network }, { code: 'auth' });
  const denied = reopened.readSnapshot(principal, scope); assert.equal(denied.networkRelations.length, 0);
  assert.deepEqual(denied.homeboxEntities, before.homeboxEntities); reopened.close();
});
