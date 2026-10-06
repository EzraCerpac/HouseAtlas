import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  CONTRACT_VERSION, ContractError, canonicalJson, recordDigest, validateShape,
  validateSnapshot, assertTransition, assertGuards, assertFinalMutation, validateResult,
} from '../../contracts/src/index.mjs';
import { DATABASE_VERSION, migrate } from './migrations.mjs';
import { mutationAuthorizationContext } from './mutation-context.mjs';
export { DATABASE_VERSION } from './migrations.mjs';
export { MUTATION_AUTHORIZATION_CONTEXT_FORMAT } from './mutation-context.mjs';

const fail = (code, message) => { throw new ContractError(code, message); };
const clone = structuredClone;
const json = canonicalJson;
const sameScope = (a, b) => a.workspaceId === b.workspaceId && a.homeId === b.homeId;
const recordKey = r => json([r.workspaceId, r.homeId, r.recordType, r.recordId]);
const sourceKey = s => json([s.workspaceId, s.homeId, s.sourceInstanceId, s.collectionId]);
const scopeArgs = s => [s.workspaceId, s.homeId];
const sourceArgs = s => [...scopeArgs(s), s.sourceInstanceId, s.collectionId];
const partitionOf = s => ({ workspaceId: s.workspaceId, homeId: s.homeId, sourceInstanceId: s.sourceInstanceId, collectionId: s.collectionId });
const validatePartition = partition => {
  if (!partition || Object.keys(partition).sort().join(',') !== 'collectionId,homeId,sourceInstanceId,workspaceId')
    fail('invalid-contract', 'Exact source partition selectors are required');
  validateShape('scope', { workspaceId: partition.workspaceId, homeId: partition.homeId });
  validateShape('recordRef', { recordType: 'identity', recordId: partition.sourceInstanceId });
  if (typeof partition.collectionId !== 'string' || !partition.collectionId.length || [...partition.collectionId].length > 4096)
    fail('invalid-contract', 'Invalid source collection selector');
  return partition;
};
const emptySnapshot = () => ({ contractVersion: CONTRACT_VERSION, synthetic: true, sources: [], records: [], homeboxEntities: [], caches: [], networkRelations: [] });
const errorMessages = {
  timeout: 'Source request timed out', auth: 'Source access is unavailable', 'wrong-scope': 'Source scope validation failed',
  'invalid-schema': 'Source contract validation failed', pagination: 'Source generation is incomplete',
  'size-limit': 'Source limit exceeded', transport: 'Source transport unavailable', upstream: 'Source unavailable',
};

/** Owns one SQLite connection. Authentication and immutable staged-asset verification
 * are mandatory server seams, never request-body claims. All callbacks are synchronous.
 */
export class AtlasStore {
  #db; #authorize; #clock; #id; #fault; #verifyAsset; #bootstrap; #busy=false;
  constructor({ path, authorize, clock = () => new Date().toISOString(), id = randomUUID,
    fault = () => {}, verifyAvailableAsset, allowSyntheticBootstrap = false, busyTimeoutMs = 5000 }) {
    if (typeof authorize !== 'function') fail('unauthenticated', 'A server authorization adapter is required');
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) fail('invalid-contract', 'Invalid storage timeout');
    this.#authorize = authorize; this.#clock = clock; this.#id = id; this.#fault = fault;
    this.#verifyAsset = verifyAvailableAsset; this.#bootstrap = allowSyntheticBootstrap;
    this.#db = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
    try {
      this.#db.exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA synchronous=FULL;`);
      migrate(this.#db, { fault });
      this.#db.exec('PRAGMA journal_mode=WAL');
    } catch (error) { this.#db.close(); throw error; }
  }
  close() { if(this.#busy) fail('invalid-transition','Cannot close an active storage transaction');this.#db.close(); }
  #auth(principal, scope, capability, source = undefined, targets = undefined, sourcePartition = undefined, mutation = undefined) {
    validateShape('scope', scope);
    const request = clone({ scope, capability, ...(source ? { source } : {}), ...(targets ? { targets } : {}),
      ...(sourcePartition ? { sourcePartition: validatePartition(sourcePartition) } : {}) });
    // The context is already detached and deeply immutable; cloning it again
    // would remove its immutable property descriptors before the trusted callback.
    if(mutation) Object.defineProperty(request,'mutation',{value:mutation,enumerable:true,writable:false,configurable:false});
    const verified = this.#authorize(principal, request);
    if (!verified || typeof verified.then === 'function') fail('unauthenticated', 'Authorization must return a verified server principal synchronously');
    if (!sameScope(verified, scope)) fail('not-found', 'Authorized home unavailable');
    validateShape('recordRef', { recordType: 'identity', recordId: verified.actorId });
    return { ...scope, actorId: verified.actorId };
  }
  #writeAuthority(principal, scope, capability, source) {
    const actor = this.#auth(principal, scope, capability, source);
    return () => {
      const current = this.#auth(principal, scope, capability, source);
      if (current.actorId !== actor.actorId) fail('unauthenticated', 'Verified principal changed during transaction');
    };
  }
  #transaction(fn, write = true) {
    if(this.#busy) fail('invalid-transition','Nested storage calls cannot enter an active transaction');
    this.#busy=true;let begun=false;
    try {
      this.#db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');begun=true;
      const result = fn();this.#db.exec('COMMIT');begun=false;return result;
    }
    catch (error) {
      if(begun) this.#db.exec('ROLLBACK');
      if (error.code?.startsWith('ERR_SQLITE') && /constraint/i.test(error.message))
        fail('identity-conflict', 'Stored identity or manifest is already reserved');
      throw error;
    } finally {this.#busy=false;}
  }
  #snapshot() {
    const s = emptySnapshot();
    for (const [field, table] of [['sources','sources'], ['records','records'], ['homeboxEntities','projections'], ['caches','caches'], ['networkRelations','network_relations']])
      s[field] = this.#db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map(r => JSON.parse(r.body));
    return s;
  }
  #source(s, key) {
    const found = s.sources.find(r => sourceKey(r) === sourceKey(key));
    if (!found) fail('not-found', 'Registered source unavailable');
    return found;
  }
  #writeSource(row) {
    this.#db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(...sourceArgs(row), json(row));
    this.#db.prepare('INSERT INTO cache_epochs VALUES(?,?,?,?,0)').run(...sourceArgs(row));
  }
  #cacheEpoch(partition) {
    const row = this.#db.prepare('SELECT epoch FROM cache_epochs WHERE workspace_id=? AND home_id=? AND source_instance_id=? AND collection_id=?').get(...sourceArgs(partition));
    if (!row) fail('not-found', 'Registered cache partition unavailable');
    return row.epoch;
  }
  #advanceCacheEpoch(partition) {
    const prior = this.#cacheEpoch(partition);
    if (prior === Number.MAX_SAFE_INTEGER) fail('invalid-transition', 'Cache epoch exhausted');
    this.#db.prepare('UPDATE cache_epochs SET epoch=epoch+1 WHERE workspace_id=? AND home_id=? AND source_instance_id=? AND collection_id=?').run(...sourceArgs(partition));
  }
  #writeCache(row) {
    this.#db.prepare(`INSERT INTO caches VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,home_id,source_instance_id,collection_id)
      DO UPDATE SET body=excluded.body`).run(...sourceArgs(row), json(row));
  }
  #writeProjection(table, row) {
    const s = table === 'projections' ? { ...row, ...row.source } : row;
    this.#db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?)`).run(...sourceArgs(s), s.externalId, json(row));
  }
  #writeRecord(record, prior) {
    const args = [record.homeId, record.recordType, record.revision, json(record), record.workspaceId, record.recordId];
    if (prior) {
      const updated = this.#db.prepare(`UPDATE records SET home_id=?,record_type=?,revision=?,body=?
        WHERE workspace_id=? AND record_id=? AND home_id=? AND record_type=? AND revision=?`)
        .run(...args, prior.homeId, prior.recordType, prior.revision);
      if (updated.changes !== 1) fail('revision-conflict', 'Record changed during transaction');
    } else {
      this.#db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
        .run(record.workspaceId, record.homeId, record.recordId, record.recordType, record.revision, json(record));
      if (record.recordType === 'binding') {
        const p = record.payload, k = p.source;
        this.#db.prepare('INSERT INTO binding_reservations VALUES(?,?,?,?,?,?,?,?)')
          .run(record.workspaceId, record.homeId, record.recordId, k.sourceInstanceId, k.collectionId, k.sourceKind, k.externalId, p.atlasId);
      }
    }
    if (record.recordType === 'asset') {
      const p = record.payload;
      if (record.lifecycle === 'active' && p.availability === 'available') {
        const proof = this.#verifyAsset?.(clone(record));
        if (!proof || typeof proof.then === 'function' || proof.sha256 !== p.sha256 || proof.byteSize !== p.byteSize)
          fail('invalid-transition', 'Available asset requires verified immutable staged bytes');
      }
      this.#db.prepare(`INSERT INTO asset_manifests VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,record_id)
        DO UPDATE SET body=excluded.body`).run(record.workspaceId, record.homeId, record.recordId, p.storageKey, json(p));
      this.#fault('after-asset-manifest', { recordId: record.recordId });
    }
  }
  /** Offline fixture bootstrap only; never expose through a server route. */
  initializeSynthetic(snapshot) {
    if (!this.#bootstrap) fail('forbidden', 'Synthetic bootstrap is disabled');
    const input = clone(snapshot);
    return this.#transaction(() => {
      if (this.#db.prepare('SELECT 1 FROM records UNION SELECT 1 FROM sources').get()) fail('invalid-transition', 'Bootstrap requires an empty database');
      validateSnapshot(input);
      for (const r of input.sources) this.#writeSource(r);
      for (const r of input.records) this.#writeRecord(r, null);
      for (const r of input.caches) {
        this.#writeCache(r);
        if (r.generationId) this.#db.prepare('INSERT INTO cache_generations VALUES(?,?,?,?,?)').run(...sourceArgs(r), r.generationId);
      }
      for (const r of input.homeboxEntities) this.#writeProjection('projections', r);
      for (const r of input.networkRelations) this.#writeProjection('network_relations', r);
      this.#fault('before-commit', { operation: 'bootstrap' });
    });
  }
  registerSource(principal, registration) {
    const row = clone(validateShape('sourceRegistration', registration));
    const scope = { workspaceId: row.workspaceId, homeId: row.homeId };
    return this.#transaction(() => {
      const revalidate = this.#writeAuthority(principal, scope, 'configure-source', row);
      const s = this.#snapshot();
      const existing = s.sources.find(r => sourceKey(r) === sourceKey(row));
      if (existing) {
        if (json(existing) !== json(row)) fail('identity-conflict', 'Source registration is immutable');
        revalidate(); return clone(existing);
      }
      s.sources.push(row); validateSnapshot(s); this.#writeSource(row);
      this.#fault('before-commit', { operation: 'source-registration' });
      revalidate();
      return clone(row);
    });
  }
  execute(principal, scope, target, command) {
    validateShape('recordRef', target); validateShape('mutation', command);
    return this.#execute(principal, scope, [{ target: clone(target), command: clone(command) }], null)[0];
  }
  executeBatch(principal, scope, envelope) {
    const batch = clone(validateShape('batchMutation', envelope));
    const results = this.#execute(principal, scope, batch.commands, batch);
    return validateShape('batchResult', { schemaVersion: 1, batchId: batch.batchId, results, replayed: results.every(r => r.replayed) });
  }
  #execute(principal, scope, entries, batch) {
    scope = clone(validateShape('scope', scope));
    return this.#transaction(() => {
      const targets = entries.map(e => e.target);
      const original=this.#snapshot(),contextId=randomUUID();
      const cachePartitions=original.sources.filter(source=>sameScope(source,scope)).map(source=>({
        ...scope,sourceInstanceId:source.sourceInstanceId,collectionId:source.collectionId,cacheEpoch:this.#cacheEpoch(source),
      }));
      const context=(phase,candidate=null,replay=null)=>mutationAuthorizationContext({contextId,phase,scope,entries,batch,original,cachePartitions,candidate,replay});
      const actor = this.#auth(principal, scope, 'mutate', undefined, targets,undefined,context('intake')); // Authorization precedes every receipt lookup.
      const revalidate = (phase,candidate=null,replay=null) => {
        const stillAuthorized = this.#auth(principal, scope, 'mutate', undefined, targets,undefined,context(phase,candidate,replay));
        if (stillAuthorized.actorId !== actor.actorId) fail('unauthenticated', 'Verified principal changed during transaction');
      };
      const replayResults=rows=>{
        if(!Array.isArray(rows)||rows.length!==entries.length) fail('schema-incompatible','Ordered mutation receipt is incompatible');
        const results=rows.map(result=>({...result,replayed:true}));
        for(const [index,result] of results.entries()) {
          const {target,command}=entries[index];
          validateResult(result);
          if(!sameScope(result.record,scope)||!sameScope(result.audit,scope)||result.audit.actorId!==actor.actorId||
              result.record.recordType!==target.recordType||result.record.recordId!==target.recordId||
              result.audit.mutationId!==command.mutationId||result.audit.operation!==command.operation||
              result.audit.previousRevision!==command.expectedRevision||result.audit.reason!==command.reason||
              (command.value&&json(result.record.payload)!==json(command.value.payload)))
            fail('schema-incompatible','Scoped mutation receipt is incompatible');
        }
        const replay={results};
        revalidate('replay',null,replay);
        const response=clone(results);
        revalidate('replay-precommit',null,replay);
        return response;
      };
      const commands = entries.map(e => ({ target: { ...scope, ...e.target }, command: e.command }));
      if (new Set(commands.map(c => c.command.mutationId)).size !== commands.length || new Set(commands.map(c => recordKey(c.target))).size !== commands.length)
        fail('invalid-contract', 'Batch targets and mutation IDs must be unique');
      const batchHash = batch ? recordDigest({ scope, ...batch }) : null;
      const batchArgs = batch ? [...scopeArgs(scope), actor.actorId, batch.batchId] : null;
      if (batch) {
        const receipt = this.#db.prepare('SELECT * FROM batch_receipts WHERE workspace_id=? AND home_id=? AND actor_id=? AND batch_id=?').get(...batchArgs);
        if (receipt) {
          if (receipt.payload_hash !== batchHash) fail('idempotency-conflict', 'Batch ID already binds another ordered envelope');
          return replayResults(JSON.parse(receipt.body));
        }
      }
      const keys = commands.map(c => [...scopeArgs(scope), actor.actorId, c.command.mutationId]);
      const hashes = commands.map(c => recordDigest({ ...c, batchId: batch?.batchId ?? null, batchHash }));
      const receipts = keys.map(k => this.#db.prepare('SELECT * FROM receipts WHERE workspace_id=? AND home_id=? AND actor_id=? AND mutation_id=?').get(...k));
      if (receipts.some(Boolean)) {
        // A batch is only replayable with its original durable batch receipt.
        if (batch || receipts.some((r, i) => !r || r.payload_hash !== hashes[i])) fail('idempotency-conflict', 'Mutation receipt belongs to another payload or batch');
        return replayResults(receipts.map(r=>JSON.parse(r.body)));
      }
      revalidate('validate');
      const candidate = clone(original), results = [];
      const created = commands.filter(c => c.command.operation === 'create').map(c => c.target);
      const now = this.#clock();
      for (const { target, command } of commands) {
        const current = original.records.find(r => recordKey(r) === recordKey(target));
        const { nextRevision } = assertTransition(current, command, target);
        assertGuards(original, current, command, target, created);
        const auditId = this.#id();
        const next = { schemaVersion: 1, ...target, revision: nextRevision,
          lifecycle: command.operation === 'tombstone' ? 'tombstoned' : 'active',
          createdAt: current?.createdAt ?? now, updatedAt: now, lastAuditId: auditId,
          payload: clone(command.value?.payload ?? current.payload) };
        const audit = { schemaVersion: 1, auditId, ...scope, record: { recordType: target.recordType, recordId: target.recordId },
          operation: command.operation, previousRevision: current?.revision ?? null, resultRevision: nextRevision,
          actorId: actor.actorId, at: now, reason: command.reason, mutationId: command.mutationId,
          beforeDigest: current ? recordDigest(current) : null, afterDigest: recordDigest(next) };
        const index = candidate.records.findIndex(r => recordKey(r) === recordKey(target));
        if (index < 0) candidate.records.push(next); else candidate.records[index] = next;
        results.push(validateResult({ schemaVersion: 1, record: next, audit, replayed: false }, current ?? null));
      }
      validateSnapshot(candidate);
      // Keep every original preimage: historical snapshot validity alone is insufficient.
      for (const { target, command } of commands)
        assertFinalMutation(candidate, original.records.find(r => recordKey(r) === recordKey(target)), command, target);
      revalidate('candidate',candidate);
      this.#fault('after-final-validation', { operation: 'mutation' });
      results.forEach((r, i) => {
        this.#writeRecord(r.record, original.records.find(p => recordKey(p) === recordKey(r.record)));
        this.#fault('after-record', { index: i });
        this.#db.prepare('INSERT INTO audits(workspace_id,home_id,record_id,audit_id,body) VALUES(?,?,?,?,?)')
          .run(...scopeArgs(scope), r.record.recordId, r.audit.auditId, json(r.audit));
        this.#fault('after-audit', { index: i });
        this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)').run(...keys[i], hashes[i], json(r));
        this.#fault('after-receipt', { index: i });
      });
      if (batch) this.#db.prepare('INSERT INTO batch_receipts VALUES(?,?,?,?,?,?)').run(...batchArgs, batchHash, json(results));
      this.#fault('before-commit', { operation: 'mutation' });
      const response=clone(results);
      revalidate('precommit',candidate);
      return response;
    });
  }
  replaceCacheGeneration(principal, scope, generation) {
    const input = clone(generation);
    return this.#transaction(() => {
      const revalidate = this.#writeAuthority(principal, scope, 'publish-cache', input.cache);
      const original = this.#snapshot(), cache = validateShape('cacheStatus', input.cache);
      const source = this.#source(original, cache);
      if (!sameScope(cache, scope) || input.complete !== true || !Object.hasOwn(input, 'expectedGenerationId') || cache.status !== 'fresh' ||
          cache.lastAttemptAt === null || Date.parse(cache.lastAttemptAt) > Date.parse(cache.lastSuccessfulFetchAt))
        fail('invalid-contract', 'A complete authorized fresh generation and prior generation are required');
      const prior = original.caches.find(r => sourceKey(r) === sourceKey(cache));
      if ((prior?.generationId ?? null) !== input.expectedGenerationId) fail('guard-conflict', 'Cache generation changed during fetch');
      if (!Number.isSafeInteger(input.expectedCacheEpoch) || input.expectedCacheEpoch < 0)
        fail('invalid-contract', 'The cache epoch captured before fetching is required');
      if (this.#cacheEpoch(cache) !== input.expectedCacheEpoch)
        fail('guard-conflict', 'Cache publication or source failure changed during fetch');
      if (prior?.lastSuccessfulFetchAt && Date.parse(cache.lastSuccessfulFetchAt) < Date.parse(prior.lastSuccessfulFetchAt))
        fail('guard-conflict', 'Cache generation cannot move successful time backward');
      const candidate = clone(original);
      if (!Array.isArray(input.homeboxEntities) || !Array.isArray(input.networkRelations)) fail('invalid-contract', 'Complete projection arrays are required');
      if ((source.owner !== 'homebox' && input.homeboxEntities.length) || (source.owner !== 'network' && input.networkRelations.length))
        fail('forbidden', 'Projection owner does not match registered source');
      for (const p of input.homeboxEntities) {
        validateShape('homeboxProjection', p);
        if (sourceKey({ ...p, ...p.source }) !== sourceKey(cache)) fail('forbidden', 'Projection source does not match generation');
      }
      for (const p of input.networkRelations) {
        validateShape('networkRelation', p);
        if (sourceKey(p) !== sourceKey(cache) || Date.parse(p.retrievedAt) > Date.parse(cache.lastSuccessfulFetchAt)) fail('forbidden', 'Relation source or retrieval time does not match generation');
      }
      candidate.homeboxEntities = candidate.homeboxEntities.filter(r => sourceKey({ ...r, ...r.source }) !== sourceKey(cache)).concat(input.homeboxEntities);
      candidate.networkRelations = candidate.networkRelations.filter(r => sourceKey(r) !== sourceKey(cache)).concat(input.networkRelations);
      candidate.caches = candidate.caches.filter(r => sourceKey(r) !== sourceKey(cache)).concat(cache);
      validateSnapshot(candidate);
      const args = [...sourceArgs(cache), cache.generationId];
      if (this.#db.prepare('SELECT 1 FROM cache_generations WHERE workspace_id=? AND home_id=? AND source_instance_id=? AND collection_id=? AND generation_id=?').get(...args))
        fail('idempotency-conflict', 'Cache generation ID is already reserved');
      for (const table of ['projections','network_relations']) this.#db.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND home_id=? AND source_instance_id=? AND collection_id=?`).run(...sourceArgs(cache));
      for (const r of input.homeboxEntities) this.#writeProjection('projections', r);
      for (const r of input.networkRelations) this.#writeProjection('network_relations', r);
      this.#fault('after-cache-projections', {});
      this.#writeCache(cache);
      this.#db.prepare('INSERT INTO cache_generations VALUES(?,?,?,?,?)').run(...args);
      this.#advanceCacheEpoch(cache);
      this.#fault('before-commit', { operation: 'cache' });
      revalidate();
      return clone(cache);
    });
  }
  recordCacheFailure(principal, scope, key, { code, status = ['auth','wrong-scope'].includes(code) ? 'access-revoked' : 'error' }) {
    if (!Object.hasOwn(errorMessages, code) || !['error','stale','access-revoked'].includes(status)) fail('invalid-contract', 'Invalid cache failure code or status');
    return this.#transaction(() => {
      const revalidate = this.#writeAuthority(principal, scope, 'publish-cache', key);
      if (!sameScope(key, scope)) fail('not-found', 'Source unavailable');
      const s = this.#snapshot(); this.#source(s, key);
      const prior = s.caches.find(r => sourceKey(r) === sourceKey(key));
      const at = this.#clock();
      const row = { schemaVersion: 1, ...scope, sourceInstanceId: key.sourceInstanceId, collectionId: key.collectionId,
        status: prior?.status === 'access-revoked' || ['auth','wrong-scope'].includes(code) ? 'access-revoked' : status,
        lastSuccessfulFetchAt: prior?.lastSuccessfulFetchAt ?? null, generationId: prior?.generationId ?? null,
        lastAttemptAt: at, consistency: 'non-transactional-offset-pages', error: { code, at, message: errorMessages[code] } };
      s.caches = s.caches.filter(r => sourceKey(r) !== sourceKey(row)).concat(row);
      validateSnapshot(s); this.#writeCache(row); this.#advanceCacheEpoch(key);
      this.#fault('before-commit', { operation: 'cache-failure' });
      revalidate();
      return clone(row);
    });
  }
  /** Trusted server read captured atomically before fetching; never an end-user route. */
  readCacheForPublication(principal, scope, sourcePartition) {
    const partition = clone(validatePartition(sourcePartition));
    return this.#transaction(() => {
      this.#auth(principal, scope, 'publish-cache', partition);
      if (!sameScope(partition, scope)) fail('not-found', 'Source unavailable');
      const s = this.#snapshot(); this.#source(s, partition);
      return {
        cache: s.caches.find(c => sourceKey(c) === sourceKey(partition)) ?? null,
        cacheEpoch: this.#cacheEpoch(partition),
        homeboxEntities: s.homeboxEntities.filter(r => sourceKey({ ...r, ...r.source }) === sourceKey(partition)),
        networkRelations: s.networkRelations.filter(r => sourceKey(r) === sourceKey(partition)),
      };
    }, false);
  }
  readSnapshot(principal, scope) {
    return this.#transaction(() => {
      this.#auth(principal, scope, 'read');
      const s = this.#snapshot();
      for (const field of ['sources','records','homeboxEntities','caches','networkRelations']) s[field] = s[field].filter(r => sameScope(r, scope));
      const denied = new Set(s.caches.filter(c => c.status === 'access-revoked').map(sourceKey));
      for (const partition of s.sources) {
        try { this.#auth(principal, scope, 'read-cache', undefined, undefined, partitionOf(partition)); }
        catch (error) {
          if (!['forbidden','not-found'].includes(error.code)) throw error;
          denied.add(sourceKey(partition));
        }
      }
      const checkProjection = (source, refs) => {
        if (denied.has(sourceKey(source))) return;
        try { for (const reference of refs) this.#auth(principal, scope, 'read-cache', reference); }
        catch (error) {
          if (!['forbidden','not-found'].includes(error.code)) throw error;
          denied.add(sourceKey(source));
        }
      };
      for (const row of s.homeboxEntities) {
        const reference = { ...scope, key: row.source };
        checkProjection({ ...row, ...row.source }, [reference]);
      }
      for (const row of s.networkRelations) {
        const key = { sourceInstanceId: row.sourceInstanceId, collectionId: row.collectionId,
          sourceKind: 'network-segment', externalId: row.externalId };
        const refs = [{ ...scope, key }];
        for (const endpoint of [row.from, row.to]) if (endpoint.kind !== 'unresolved')
          refs.push({ ...scope, key: { ...key, sourceKind: `network-${endpoint.kind}`, externalId: endpoint.id } });
        checkProjection(row, refs);
      }
      s.homeboxEntities = s.homeboxEntities.filter(r => !denied.has(sourceKey({ ...r, ...r.source })));
      s.networkRelations = s.networkRelations.filter(r => !denied.has(sourceKey(r)));
      // A caller-specific policy denial cannot freshen data or turn missing access into empty inventory.
      s.caches = s.caches.map(c => denied.has(sourceKey(c)) ? { ...c, status: 'access-revoked' } : c);
      for (const source of s.sources) {
        if (!denied.has(sourceKey(source)) || s.caches.some(c => sourceKey(c) === sourceKey(source))) continue;
        s.caches.push(validateShape('cacheStatus', {
          schemaVersion: 1, ...partitionOf(source), status: 'access-revoked',
          lastSuccessfulFetchAt: null, lastAttemptAt: null, generationId: null,
          consistency: 'non-transactional-offset-pages', error: null,
        }));
      }
      return s;
    }, false);
  }
  readRecord(principal, scope, target) {
    validateShape('recordRef', target);
    return this.#transaction(() => {
      this.#auth(principal, scope, 'read', undefined, [target]);
      const row = this.#db.prepare('SELECT body FROM records WHERE workspace_id=? AND home_id=? AND record_type=? AND record_id=?').get(...scopeArgs(scope), target.recordType, target.recordId);
      if (!row) fail('not-found', 'Record unavailable in authorized home');
      return JSON.parse(row.body);
    }, false);
  }
  history(principal, scope, target) {
    validateShape('recordRef', target);
    return this.#transaction(() => {
      this.#auth(principal, scope, 'read-history', undefined, [target]);
      if (!this.#db.prepare('SELECT 1 FROM records WHERE workspace_id=? AND home_id=? AND record_type=? AND record_id=?').get(...scopeArgs(scope), target.recordType, target.recordId))
        fail('not-found', 'Record unavailable in authorized home');
      return this.#db.prepare('SELECT body FROM audits WHERE workspace_id=? AND home_id=? AND record_id=? ORDER BY seq').all(...scopeArgs(scope), target.recordId).map(r => JSON.parse(r.body));
    }, false);
  }
  readAssetManifest(principal, scope, target) {
    validateShape('recordRef', target);
    return this.#transaction(() => {
      this.#auth(principal, scope, 'read-asset-manifest', undefined, [target]);
      if (target.recordType !== 'asset') fail('not-found', 'Asset unavailable');
      const row = this.#db.prepare('SELECT body FROM asset_manifests WHERE workspace_id=? AND home_id=? AND record_id=?').get(...scopeArgs(scope), target.recordId);
      if (!row) fail('not-found', 'Asset unavailable');
      return JSON.parse(row.body);
    }, false);
  }
  get databaseVersion() { return DATABASE_VERSION; }
}
