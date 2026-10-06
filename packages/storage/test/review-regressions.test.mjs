import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ContractError, recordDigest, validateResult, validateSnapshot } from '../../contracts/src/index.mjs';
import { AtlasStore, options, seeded, temporary, scope, principal, authorize, nextGeneration, partitionOf, commandFixture, fixture, U } from './helpers.mjs';
import { migrate, MIGRATIONS, DATABASE_VERSION } from '../src/migrations.mjs';

for (const operation of ['cache', 'cache-failure', 'source-registration']) {
  test(`R1 precommit authority control: ${operation} rolls back data and epoch on grant loss`, () => {
    let active = true, armed = false, checks = 0;
    const capability = operation === 'source-registration' ? 'configure-source' : 'publish-cache';
    const { store, path } = seeded('plan-free', {
      authorize: (p, request) => {
        if (request.capability === capability) {
          checks++;
          if (!active) throw new ContractError('forbidden', 'Trusted grant revoked');
        }
        return authorize(p, request);
      },
      fault: (phase, detail) => { if (armed && phase === 'before-commit' && detail.operation === operation) active = false; },
    });
    const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
    const prior = store.readCacheForPublication(principal, scope, key);
    const generation = nextGeneration(before, 960, prior.cacheEpoch);
    const registration = { ...before.sources[0], sourceInstanceId: U(70), collectionId: 'new-reviewed-source' };
    const write = () => operation === 'cache' ? store.replaceCacheGeneration(principal, scope, generation)
      : operation === 'cache-failure' ? store.recordCacheFailure(principal, scope, key, { code: 'auth' })
      : store.registerSource(principal, registration);
    checks = 0; armed = true;
    assert.throws(write, e => e.code === 'forbidden');
    assert.equal(checks, 2); active = true; armed = false;
    assert.deepEqual(store.readSnapshot(principal, scope), before);
    assert.deepEqual(store.readCacheForPublication(principal, scope, key), prior);
    store.close();
    const reopened = new AtlasStore(options(path));
    assert.deepEqual(reopened.readSnapshot(principal, scope), before);
    assert.deepEqual(reopened.readCacheForPublication(principal, scope, key), prior);
    // The rejected generation ID and epoch are still available for one valid retry.
    if (operation === 'cache') reopened.replaceCacheGeneration(principal, scope, generation);
    if (operation === 'cache-failure') reopened.recordCacheFailure(principal, scope, key, { code: 'auth' });
    if (operation === 'source-registration') reopened.registerSource(principal, registration);
    assert.equal(reopened.readCacheForPublication(principal, scope, key).cacheEpoch, operation === 'source-registration' ? 0 : 1);
    reopened.close();
  });
}
test('R1 trusted write authority retains actor and scope at final commit', () => {
  for (const change of ['actor','scope']) {
    let altered = false;
    const { store } = seeded('plan-free', {
      authorize: (p, request) => {
        const verified = authorize(p, request);
        return altered && request.capability === 'publish-cache'
          ? { ...verified, ...(change === 'actor' ? { actorId: U(51) } : { homeId: U(3) }) } : verified;
      },
      fault: (phase, detail) => { if (phase === 'before-commit' && detail.operation === 'cache') altered = true; },
    });
    const before = store.readSnapshot(principal, scope);
    assert.throws(() => store.replaceCacheGeneration(principal, scope, nextGeneration(before)),
      e => e.code === (change === 'actor' ? 'unauthenticated' : 'not-found'));
    altered = false; assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
  }
});

test('R2 epoch control: a fetch begun before later quarantine cannot publish its later completion', () => {
  const { store, path } = seeded('plan-free', { clock: () => '2026-01-03T12:00:00Z' });
  const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
  const prior = store.readCacheForPublication(principal, scope, key), pending = nextGeneration(before, 961, prior.cacheEpoch);
  pending.cache.lastAttemptAt = '2026-01-03T11:59:00Z'; pending.cache.lastSuccessfulFetchAt = '2026-01-03T12:01:00Z';
  const other = new AtlasStore({ ...options(path), clock: () => '2026-01-03T12:00:00Z' });
  other.recordCacheFailure(principal, scope, key, { code: 'auth' }); other.close();
  const denied = store.readCacheForPublication(principal, scope, key);
  assert.equal(denied.cacheEpoch, prior.cacheEpoch + 1); assert.equal(denied.cache.generationId, prior.cache.generationId);
  assert.throws(() => store.replaceCacheGeneration(principal, scope, pending), e => e.code === 'guard-conflict');
  assert.deepEqual(store.readCacheForPublication(principal, scope, key), denied); store.close();
  const reopened = new AtlasStore(options(path));
  assert.equal(reopened.readSnapshot(principal, scope).caches[0].status, 'access-revoked');
  // Reauthorization, atomic pre-fetch capture and a newly fetched generation may reuse the rejected ID.
  const fresh = reopened.readCacheForPublication(principal, scope, key);
  const newFetch = { ...pending, expectedCacheEpoch: fresh.cacheEpoch,
    cache: { ...pending.cache, lastAttemptAt: '2026-01-03T12:02:00Z', lastSuccessfulFetchAt: '2026-01-03T12:03:00Z' } };
  reopened.replaceCacheGeneration(principal, scope, newFetch);
  assert.equal(reopened.readCacheForPublication(principal, scope, key).cacheEpoch, fresh.cacheEpoch + 1); reopened.close();
});
test('R2 epoch control: equal or backward-clock failure events still invalidate a captured fetch', () => {
  for (const failedAt of ['2026-01-03T11:59:00Z', '2026-01-03T11:58:00Z']) {
    const { store } = seeded('plan-free', { clock: () => failedAt });
    const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
    const prior = store.readCacheForPublication(principal, scope, key), pending = nextGeneration(before, 962, prior.cacheEpoch);
    pending.cache.lastAttemptAt = '2026-01-03T11:59:00Z'; pending.cache.lastSuccessfulFetchAt = '2026-01-03T12:01:00Z';
    store.recordCacheFailure(principal, scope, key, { code: 'wrong-scope' });
    assert.throws(() => store.replaceCacheGeneration(principal, scope, pending), e => e.code === 'guard-conflict');
    assert.equal(store.readCacheForPublication(principal, scope, key).cache.status, 'access-revoked'); store.close();
  }
});
test('R2 each failure advances one partition epoch; unrelated source failure does not invalidate fetch', () => {
  const { store } = seeded(); const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
  const prior = store.readCacheForPublication(principal, scope, key);
  const networkKey = partitionOf(before.sources.find(s => s.owner === 'network'));
  store.recordCacheFailure(principal, scope, networkKey, { code: 'auth' });
  store.recordCacheFailure(principal, scope, networkKey, { code: 'auth' });
  assert.equal(store.readCacheForPublication(principal, scope, networkKey).cacheEpoch, 2);
  assert.deepEqual(store.readCacheForPublication(principal, scope, key), prior);
  store.replaceCacheGeneration(principal, scope, nextGeneration(before, 963, prior.cacheEpoch));
  assert.equal(store.readCacheForPublication(principal, scope, key).cacheEpoch, 1); store.close();
});
test('R2 pre-fetch cache epoch is required, scoped, and captured together with prior state', () => {
  const { store } = seeded(); const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
  const input = nextGeneration(before); delete input.expectedCacheEpoch;
  assert.throws(() => store.replaceCacheGeneration(principal, scope, input), e => e.code === 'invalid-contract');
  for (const bad of [{ ...key, homeId: U(3) }, { ...key, sourceInstanceId: U(99) }, { ...key, externalId: 'invented' }])
    assert.throws(() => store.readCacheForPublication(principal, scope, bad), e => ['not-found','invalid-contract'].includes(e.code));
  const state = store.readCacheForPublication(principal, scope, key); state.cache.status = 'access-revoked'; state.homeboxEntities.length = 0;
  const actual = store.readCacheForPublication(principal, scope, key);
  assert.equal(actual.cache.status, 'fresh'); assert(actual.homeboxEntities.length > 0); assert.equal(actual.cacheEpoch, 0); store.close();
});

test('R3 empty partition control: denied complete-empty generation is revoked and source-level checked', () => {
  let denied = false; const partitions = [], entities = [];
  const { store, path } = seeded('plan-free', { authorize: (p, request) => {
    if (request.capability === 'read-cache' && request.sourcePartition) {
      assert.deepEqual(Object.keys(request.sourcePartition).sort(), ['collectionId','homeId','sourceInstanceId','workspaceId']);
      assert.equal(Object.hasOwn(request.sourcePartition, 'externalId'), false);
      partitions.push(request.sourcePartition);
      if (denied && request.sourcePartition.sourceInstanceId === U(10)) throw new ContractError('not-found', 'Partition disabled');
    }
    if (request.capability === 'read-cache' && request.source) entities.push(request.source);
    return authorize(p, request);
  } });
  const before = store.readSnapshot(principal, scope), key = partitionOf(before.caches[0]);
  const prior = store.readCacheForPublication(principal, scope, key);
  store.replaceCacheGeneration(principal, scope, { ...nextGeneration(before, 964, prior.cacheEpoch), homeboxEntities: [] });
  partitions.length = 0; entities.length = 0; denied = true;
  const view = store.readSnapshot(principal, scope);
  assert.equal(view.caches[0].status, 'access-revoked'); assert.equal(view.homeboxEntities.length, 0);
  assert(partitions.some(p => p.sourceInstanceId === U(10))); assert(partitions.some(p => p.sourceInstanceId === U(12)));
  assert(!entities.some(r => r.key.sourceInstanceId === U(10))); assert(view.networkRelations.length > 0);
  store.close();
  const reopened = new AtlasStore(options(path));
  assert.equal(reopened.readCacheForPublication(principal, scope, key).cache.status, 'fresh'); reopened.close();
});
test('R3 configured partitions without cache rows are checked; expiry fails the whole read', () => {
  let expire = false; const seen = [];
  const { store } = seeded('plan-free', { authorize: (p, request) => {
    if (request.sourcePartition) {
      seen.push(request.sourcePartition);
      if (expire) throw new ContractError('unauthenticated', 'Principal expired');
    }
    return authorize(p, request);
  } });
  store.readSnapshot(principal, scope);
  assert(seen.some(p => p.sourceInstanceId === U(12))); // This fixture has Network rows but no Network cache row.
  expire = true;
  assert.throws(() => store.readSnapshot(principal, scope), e => e.code === 'unauthenticated'); store.close();
});
test('R3 no-cache denial control: first-run permission denial differs from allowed empty and stays response-only', () => {
  for (const code of ['not-found', 'forbidden']) {
    const { path } = temporary(); const source = fixture('plan-free').sources[0];
    let denied = false; const partitions = [];
    const store = new AtlasStore({ ...options(path), clock: () => { throw new Error('A read cannot invent a fetch time'); },
      authorize: (p, request) => {
        if (request.sourcePartition) {
          partitions.push(request.sourcePartition);
          if (denied) throw new ContractError(code, 'Partition unavailable');
        }
        return authorize(p, request);
      } });
    const firstRun = { contractVersion: '1.0.0', synthetic: true, sources: [source],
      records: [], homeboxEntities: [], caches: [], networkRelations: [] };
    store.initializeSynthetic(firstRun);
    const permitted = store.readSnapshot(principal, scope);
    assert.deepEqual(permitted, firstRun);
    const partition = partitionOf(source), prior = store.readCacheForPublication(principal, scope, partition);
    partitions.length = 0; denied = true;
    const blocked = store.readSnapshot(principal, scope);
    assert.deepEqual(partitions, [partition]);
    assert.notDeepEqual(blocked, permitted);
    assert.deepEqual(blocked.caches, [{ schemaVersion: 1, ...partition, status: 'access-revoked',
      lastSuccessfulFetchAt: null, lastAttemptAt: null, generationId: null,
      consistency: 'non-transactional-offset-pages', error: null }]);
    validateSnapshot(blocked);
    assert.deepEqual(blocked.records, []); assert.deepEqual(blocked.homeboxEntities, []);
    assert.deepEqual(blocked.networkRelations, []);
    assert.deepEqual(store.readCacheForPublication(principal, scope, partition), prior);
    assert.equal(prior.cache, null); assert.equal(prior.cacheEpoch, 0);
    denied = false; assert.deepEqual(store.readSnapshot(principal, scope), permitted); store.close();
    const db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM caches').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cache_generations').get().n, 0);
    assert.equal(db.prepare('SELECT epoch FROM cache_epochs').get().epoch, 0); db.close();
    const reopened = new AtlasStore(options(path));
    assert.deepEqual(reopened.readSnapshot(principal, scope), permitted);
    assert.deepEqual(reopened.readCacheForPublication(principal, scope, partition), prior); reopened.close();
  }
});
test('R3 denied no-cache partitions coexist with cached denial, permitted absence and foreign-home isolation', () => {
  const { path } = temporary(), input = fixture('plan-free');
  const homebox = input.sources.find(s => s.owner === 'homebox'), network = input.sources.find(s => s.owner === 'network');
  const allowed = { ...homebox, sourceInstanceId: U(73), collectionId: 'allowed-first-run' };
  const foreign = { ...homebox, homeId: U(3), sourceInstanceId: U(74), collectionId: 'foreign-first-run' };
  const partitions = [];
  const store = new AtlasStore({ ...options(path), authorize: (p, request) => {
    if (request.sourcePartition) {
      partitions.push(request.sourcePartition);
      if ([homebox.sourceInstanceId, network.sourceInstanceId].includes(request.sourcePartition.sourceInstanceId))
        throw new ContractError('not-found', 'Partition disabled');
    }
    return authorize(p, request);
  } });
  const priorCache = input.caches.find(c => c.sourceInstanceId === homebox.sourceInstanceId);
  store.initializeSynthetic({ contractVersion: '1.0.0', synthetic: true,
    sources: [homebox, network, allowed, foreign], records: [], homeboxEntities: [], caches: [priorCache], networkRelations: [] });
  const view = store.readSnapshot(principal, scope); validateSnapshot(view);
  assert.equal(view.caches.length, 2);
  assert.deepEqual(view.caches.find(c => c.sourceInstanceId === homebox.sourceInstanceId), { ...priorCache, status: 'access-revoked' });
  assert.deepEqual(view.caches.find(c => c.sourceInstanceId === network.sourceInstanceId), {
    schemaVersion: 1, ...partitionOf(network), status: 'access-revoked', lastSuccessfulFetchAt: null,
    lastAttemptAt: null, generationId: null, consistency: 'non-transactional-offset-pages', error: null,
  });
  assert(!view.caches.some(c => [allowed.sourceInstanceId, foreign.sourceInstanceId].includes(c.sourceInstanceId)));
  assert(!view.sources.some(s => s.homeId === foreign.homeId));
  assert.equal(partitions.length, 3); assert(partitions.every(p => p.homeId === scope.homeId));
  assert.equal(store.readCacheForPublication(principal, scope, partitionOf(network)).cache, null);
  assert.deepEqual(store.readCacheForPublication(principal, scope, partitionOf(homebox)).cache, priorCache);
  store.close();
});
test('R3 no-cache denial control: uncached Network entity denial also reports revoked availability', () => {
  let denied = false; const checked = [];
  const { store, path } = seeded('plan-free', { authorize: (p, request) => {
    if (request.capability === 'read-cache' && request.source?.key.sourceInstanceId === U(12)) {
      checked.push(request.source);
      if (denied) throw new ContractError('forbidden', 'Exact entity grant revoked');
    }
    return authorize(p, request);
  } });
  const permitted = store.readSnapshot(principal, scope);
  const network = permitted.sources.find(s => s.owner === 'network'), partition = partitionOf(network);
  const prior = store.readCacheForPublication(principal, scope, partition);
  assert.equal(prior.cache, null); assert(permitted.networkRelations.length > 0);
  checked.length = 0; denied = true;
  const blocked = store.readSnapshot(principal, scope); validateSnapshot(blocked);
  assert(checked.length > 0); assert.equal(blocked.networkRelations.length, 0);
  assert.deepEqual(blocked.homeboxEntities, permitted.homeboxEntities);
  assert.deepEqual(blocked.records, permitted.records);
  assert.deepEqual(blocked.caches.filter(c => c.sourceInstanceId !== network.sourceInstanceId), permitted.caches);
  assert.deepEqual(blocked.caches.filter(c => c.sourceInstanceId === network.sourceInstanceId), [{
    schemaVersion: 1, ...partition, status: 'access-revoked', lastSuccessfulFetchAt: null,
    lastAttemptAt: null, generationId: null, consistency: 'non-transactional-offset-pages', error: null,
  }]);
  assert.deepEqual(store.readCacheForPublication(principal, scope, partition), prior);
  denied = false; assert.deepEqual(store.readSnapshot(principal, scope), permitted); store.close();
  const reopened = new AtlasStore(options(path));
  assert.deepEqual(reopened.readSnapshot(principal, scope), permitted);
  assert.deepEqual(reopened.readCacheForPublication(principal, scope, partition), prior); reopened.close();
});
test('R3 partition selector control: frozen-valid Unicode collection names remain readable', () => {
  const { store } = seeded();
  const before = store.readSnapshot(principal, scope);
  for (const collectionId of ['🧪'.repeat(2049), '🧪'.repeat(4096)]) {
    const source = { ...before.sources[0], collectionId };
    store.registerSource(principal, source);
    const partition = partitionOf(source);
    let state, snapshot;
    assert.doesNotThrow(() => {
      state = store.readCacheForPublication(principal, scope, partition);
      snapshot = store.readSnapshot(principal, scope);
    });
    assert.equal(state.cacheEpoch, 0);
    assert(snapshot.sources.some(s => s.collectionId === collectionId));
  }
  assert.throws(() => store.readCacheForPublication(principal, scope,
    { ...partitionOf(before.sources[0]), collectionId: '🧪'.repeat(4097) }), e => e.code === 'invalid-contract');
  store.close();
});

for (const [label, sql, query] of [
  ['view-only', 'CREATE VIEW unrelated_owner_view AS SELECT 1 AS retained_data', 'SELECT * FROM unrelated_owner_view'],
  ['literal-prefix', 'CREATE TABLE sqlitefoo(id INTEGER); INSERT INTO sqlitefoo VALUES(1)', 'SELECT * FROM sqlitefoo'],
]) {
  test(`R4 schema ownership control: ${label} database is rejected with schema and data intact`, () => {
    const { path } = temporary(); const db = new DatabaseSync(path); db.exec(sql);
    const before = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
    const values = db.prepare(query).all(); const serialized = db.serialize(); db.close();
    assert.throws(() => new AtlasStore(options(path)), e => e.code === 'schema-incompatible');
    const after = new DatabaseSync(path);
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 0);
    assert.deepEqual(after.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all(), before);
    assert.deepEqual(after.prepare(query).all(), values); assert.deepEqual(after.serialize(), serialized); after.close();
  });
}
test('schema 2 preimages survive thrown and SIGKILL migration interruption before atomic upgrade to 3', () => {
  assert.deepEqual(MIGRATIONS.slice(0, 2).map(m => m.sha256), [
    'de90fb9dd4143b363db7378318f4b202870689fb72bc7ebc980fc072f8a62945',
    '506d7d562a799c687255010603ac51804632e11e337be851a063c4a81b587d26',
  ]);
  const { path } = temporary(); const db = new DatabaseSync(path); migrate(db, { targetVersion: 2 });
  const source = { ...scope, sourceInstanceId: U(10), collectionId: 'legacy-v2', owner: 'homebox', partitionMode: 'exclusive-home', allowedExternalIds: [] };
  db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(scope.workspaceId, scope.homeId, source.sourceInstanceId, source.collectionId, JSON.stringify(source));
  const result = validateResult(commandFixture('create-circuit.result'), null);
  const command = commandFixture('create-circuit.mutation');
  const payloadHash = recordDigest({ target: { ...scope, ...result.audit.record }, command, batchId: null, batchHash: null });
  db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)').run(scope.workspaceId, scope.homeId, result.audit.actorId,
    result.audit.mutationId, payloadHash, JSON.stringify(result));
  const receiptPreimage = db.prepare('SELECT * FROM receipts').get();
  assert.throws(() => migrate(db, { fault: () => { throw new Error('Epoch migration interrupted'); } }), /Epoch migration/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='cache_epochs'").get(), undefined);
  assert.deepEqual(db.prepare('SELECT * FROM receipts').get(), receiptPreimage);
  db.close();
  const interrupted = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { AtlasStore } from ${JSON.stringify(fileURLToPath(new URL('../src/index.mjs', import.meta.url)))};
    new AtlasStore({ path: ${JSON.stringify(path)}, authorize: () => ({}), fault: (phase, detail) => {
      if (phase === 'migration-before-commit' && detail.version === 3) process.kill(process.pid, 'SIGKILL');
    } });`], { encoding: 'utf8', timeout: 15000 });
  assert.equal(interrupted.error, undefined);
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  const recovered = new DatabaseSync(path);
  assert.equal(recovered.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(recovered.prepare("SELECT name FROM sqlite_master WHERE name='cache_epochs'").get(), undefined);
  assert.deepEqual(recovered.prepare('SELECT * FROM receipts').get(), receiptPreimage);
  assert.deepEqual(recovered.prepare('SELECT version FROM atlas_migrations ORDER BY version').all().map(m => m.version), [1, 2]);
  migrate(recovered); assert.equal(recovered.prepare('PRAGMA user_version').get().user_version, DATABASE_VERSION);
  assert.deepEqual(recovered.prepare('SELECT * FROM receipts').get(), receiptPreimage); recovered.close();
  const store = new AtlasStore(options(path)); const state = store.readCacheForPublication(principal, scope, partitionOf(source));
  assert.equal(state.cacheEpoch, 0); assert.equal(state.cache, null); store.close();
});
