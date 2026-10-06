import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShape, validateSnapshot, validateResult, boundaries } from '../src/index.mjs';
import { SyntheticHarness, U, context } from './oracle.mjs';
const load = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const base = () => load('plan-free.snapshot.json');
const create = () => load('create-circuit.mutation.json');
const replace = () => load('missing-binding.mutation.json');
const target = (recordType = 'circuit', n = 406, homeId = U(2)) => ({ workspaceId: U(1), homeId, recordType, recordId: U(n) });
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code);
const changed = (name, change, code = 'invalid-contract') => test(name, () => { const s = base(); change(s); expectCode(() => validateSnapshot(s), code); });

for (const file of ['plan-free', 'outage', 'import-remap', 'optional-geometry']) test(`positive synthetic fixture: ${file}`, () => validateSnapshot(load(`${file}.snapshot.json`)));
test('positive tagged HomeBox minimum page including null type', () => validateShape('homeboxPageWire', load('homebox-page.wire.json')));
test('minimum raw wire accepts additive upstream fields without promoting them into Atlas mutations', () => { const p = load('homebox-page.wire.json'); p.items[0].futureSourceField = 42; validateShape('homeboxPageWire', p); });
test('native mutation shapes reject HomeBox metadata and client actor', () => {
  for (const [key, value] of [['actorId', U(51)], ['homeboxPut', {}], ['updatedAt', context.now]]) { const c = create(); c[key] = value; expectCode(() => validateShape('mutation', c), 'invalid-contract'); }
  const c = create(); c.value.payload.name = 'Competing inventory editor'; expectCode(() => validateShape('mutation', c), 'invalid-contract');
});
test('noncreate mutation always requires a positive expected revision', () => { const c = replace(); delete c.expectedRevision; expectCode(() => validateShape('mutation', c), 'invalid-contract'); c.expectedRevision = null; expectCode(() => validateShape('mutation', c), 'invalid-contract'); });
test('exact timestamp and UUID formats are validated', () => { const c = create(); c.mutationId = 'name-derived-id'; expectCode(() => validateShape('mutation', c), 'invalid-contract'); const p = load('homebox-page.wire.json'); p.items[0].updatedAt = 'yesterday'; expectCode(() => validateShape('homeboxPageWire', p), 'invalid-contract'); });
changed('cross-home identity reference denied', s => { s.records.find(r => r.recordType === 'binding').payload.atlasId = U(202); }, 'not-found');
changed('cross-home evidence denied', s => { s.records.find(r => r.recordType === 'identity').payload.evidenceIds = [U(103)]; }, 'not-found');
changed('cross-home provenance denied', s => { s.records.find(r => r.recordId === U(101)).payload.provenance.source.homeId = U(3); }, 'forbidden');
changed('wrong collection denied', s => { s.records.find(r => r.recordType === 'binding').payload.source.collectionId = 'foreign'; }, 'forbidden');
changed('qualified source collision rejected even for retired binding', s => { const r = structuredClone(s.records.find(r => r.recordId === U(300))); r.recordId = U(399); r.payload.reviewStatus = 'retired'; s.records.push(r); }, 'identity-conflict');
test('many sources bind to one permanent physical identity', () => { const s = base(); assert.equal(s.records.filter(r => r.recordType === 'binding' && r.payload.atlasId === U(201)).length, 2); validateSnapshot(s); });
changed('abstract powerline segment cannot become physical binding', s => { s.records.find(r => r.recordId === U(302)).payload.source.sourceKind = 'network-segment'; });
changed('network interface cannot become another inventory item', s => { s.records.find(r => r.recordId === U(302)).payload.source.sourceKind = 'network-interface'; });
changed('explicit HomeBox item/location flag mismatch rejected', s => { s.homeboxEntities.find(e => e.entity.id === U(500)).entity.entityType.isLocation = false; });
changed('source partition cannot overlap another home', s => { const other = structuredClone(s.sources[0]); other.homeId = U(3); s.sources.push(other); }, 'identity-conflict');
changed('reviewed entity allowlist is enforced', s => { s.sources[0].partitionMode = 'reviewed-entity-allowlist'; s.sources[0].allowedExternalIds = [U(501)]; }, 'forbidden');
test('arbitrary cabinet/drawer types and null types remain unclassified; mobiles stay unplaced', () => {
  const s = base(); assert.equal(s.homeboxEntities[0].entity.entityType.name, 'Cabinet'); assert.equal(s.homeboxEntities[2].entity.archived, true); assert.equal(s.homeboxEntities[3].entity.entityType, null); assert.equal(s.homeboxEntities[1].entity.parent, null); assert.equal(s.records.find(r => r.recordType === 'location-semantics').payload.semanticKind, 'unclassified');
});
changed('HomeBox parent cycle rejected', s => { s.homeboxEntities[0].entity.parent = { id: U(502) }; });
changed('source inferred claim never becomes supported', s => { s.records[0].payload.provenance.evidenceBasis = 'inference'; });
test('source confirmed plus owner-report retained without fresh physical survey claim', () => { const e = base().records.find(r => r.recordId === U(101)); assert.equal(e.payload.provenance.sourceConfidence, 'confirmed'); assert.equal(e.payload.provenance.evidenceBasis, 'owner-report'); assert.notEqual(e.payload.provenance.factAt, e.payload.provenance.retrievedAt); });
changed('powerline membership cannot assert a circuit', s => { s.records.find(r => r.recordType === 'relation').payload.evidenceIds = [U(101)]; });
changed('unresolved physical endpoint cannot be silently invented', s => { s.records.find(r => r.recordType === 'relation').payload.to = { kind: 'atlas-record', ref: { recordType: 'identity', recordId: U(999) } }; }, 'not-found');
changed('segment membership must point to abstract segment rather than daisy chain', s => { s.networkRelations[0].to.kind = 'device'; });
changed('historical disputed association cannot become current connection', s => { s.networkRelations[1].temporalStatus = 'current-claim'; });
changed('native editor link cannot expose bearer query', s => { s.homeboxEntities[0].nativeLinks[0].href += '?token=synthetic-test'; });
test('HomeBox outage retains cached records, identity and truthful successful timestamp', () => {
  const a = base(), b = load('outage.snapshot.json'); assert.deepEqual(b.records, a.records); assert.deepEqual(b.homeboxEntities, a.homeboxEntities); assert.equal(b.caches[0].lastSuccessfulFetchAt, a.caches[0].lastSuccessfulFetchAt); assert.equal(b.caches[0].generationId, a.caches[0].generationId); assert.notEqual(b.caches[0].lastAttemptAt, b.caches[0].lastSuccessfulFetchAt);
});
changed('fresh cache cannot hide an error', s => { s.caches[0].error = { code: 'auth', at: context.now, message: 'Synthetic' }; });
changed('empty status cannot discard previous successful generation', s => { s.caches[0].status = 'empty'; });
test('restore/import remap keeps permanent identity and explicit retired history', () => {
  const s = load('import-remap.snapshot.json'); const old = s.records.find(r => r.recordId === U(301)), next = s.records.find(r => r.recordId === U(304)); assert.equal(old.payload.atlasId, next.payload.atlasId); assert.notEqual(old.payload.source.externalId, next.payload.source.externalId); assert.equal(old.payload.reviewStatus, 'retired'); assert.equal(s.records.find(r => r.recordType === 'reconciliation').payload.atlasId, U(201));
});
test('unknown geometry units do not invent scale', () => { const s = load('optional-geometry.snapshot.json'); s.records.find(r => r.recordType === 'geometry').payload.scale = 1; expectCode(() => validateSnapshot(s), 'invalid-contract'); });
test('geometry mapping enforces home', () => { const s = load('optional-geometry.snapshot.json'); s.records.find(r => r.recordType === 'geometry').payload.mappings[0].atlasId = U(202); expectCode(() => validateSnapshot(s), 'not-found'); });
test('geometry and circuit features are optional to plan-free browsing', () => { const s = base(); s.records = s.records.filter(r => !['circuit', 'valve', 'relation'].includes(r.recordType)); validateSnapshot(s); assert.equal(s.records.some(r => r.recordType === 'geometry'), false); });
test('mutations commit one record, audit and receipt together', () => { const h = new SyntheticHarness(base()); const r = h.mutate(target(), create()); assert.equal(r.record.revision, 1); assert.equal(r.audit.actorId, U(50)); assert.equal(h.audits.length, 1); assert.equal(h.receipts.size, 1); validateResult(r); });
test('receipt replay returns original result and does not write twice', () => { const h = new SyntheticHarness(base()); const first = h.mutate(target(), create()); const second = h.mutate(target(), create()); assert.equal(second.replayed, true); assert.deepEqual(second.record, first.record); assert.equal(h.audits.length, 1); });
test('same idempotency key with changed body is a conflict', () => { const h = new SyntheticHarness(base()); h.mutate(target(), create()); const c = create(); c.reason = 'Changed'; expectCode(() => h.mutate(target(), c), 'idempotency-conflict'); assert.equal(h.audits.length, 1); });
test('viewer denied before receipt replay', () => { const h = new SyntheticHarness(base()); h.mutate(target(), create()); expectCode(() => h.mutate(target(), create(), { ...context, role: 'viewer' }), 'forbidden'); });
test('foreign-home mutations do not disclose record revisions', () => { const h = new SyntheticHarness(base()); expectCode(() => h.mutate(target('circuit', 406, U(3)), create()), 'not-found'); assert.equal(h.audits.length, 0); });
test('stale same-record revision conflicts without overwrite', () => {
  const h = new SyntheticHarness(base()); const first = h.mutate(target('binding', 301), replace()); assert.equal(first.record.revision, 2); const stale = replace(); stale.mutationId = U(1002); expectCode(() => h.mutate(target('binding', 301), stale), 'revision-conflict'); assert.equal(h.audits.length, 1);
});
test('unrelated records can change independently', () => { const h = new SyntheticHarness(base()); h.mutate(target(), create()); const r = h.mutate(target('binding', 301), replace()); assert.equal(r.record.revision, 2); assert.equal(h.audits.length, 2); });
test('missing reference guard is rejected', () => { const c = create(); c.guards = []; expectCode(() => new SyntheticHarness(base()).mutate(target(), c), 'guard-conflict'); });
test('stale referenced record guard is rejected', () => { const s = base(); s.records.find(r => r.recordId === U(100)).revision = 2; expectCode(() => new SyntheticHarness(s).mutate(target(), create()), 'guard-conflict'); });
test('failed atomic commit preserves all state including audit and receipts', () => { const h = new SyntheticHarness(base()), before = structuredClone(h.snapshot); expectCode(() => h.mutate(target(), create(), context, true), 'synthetic-fault'); assert.deepEqual(h.snapshot, before); assert.equal(h.audits.length, 0); assert.equal(h.receipts.size, 0); });
test('tombstone and restore preserve record identity and payload', () => {
  const h = new SyntheticHarness(base()), t = target('valve', 403); const old = h.snapshot.records.find(r => r.recordId === U(403)); const c = { schemaVersion: 1, mutationId: U(1003), operation: 'tombstone', expectedRevision: 1, reason: 'Synthetic retirement', guards: [{ record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }] };
  const gone = h.mutate(t, c); assert.equal(gone.record.lifecycle, 'tombstoned'); const back = h.mutate(t, { ...c, mutationId: U(1004), operation: 'restore', expectedRevision: 2 }); assert.equal(back.record.recordId, old.recordId); assert.deepEqual(back.record.payload, old.payload); assert.equal(back.record.revision, 3);
});
test('binding source key is immutable even with a matching revision', () => { const c = replace(); c.value.payload.source.externalId = U(777); expectCode(() => new SyntheticHarness(base()).mutate(target('binding', 301), c), 'invalid-transition'); });
test('evidence provenance is append-only', () => { const s = base(), e = s.records[0]; const c = { ...replace(), value: { recordType: 'evidence', payload: structuredClone(e.payload) } }; c.value.payload.provenance.factAt = context.now; expectCode(() => new SyntheticHarness(s).mutate(target('evidence', 100), c), 'invalid-transition'); });
test('mutations cannot turn geometry original assets into new bytes', () => { const s = load('optional-geometry.snapshot.json'), a = s.records.find(r => r.recordType === 'asset'); const c = { ...replace(), value: { recordType: 'asset', payload: structuredClone(a.payload) } }; c.value.payload.sha256 = 'b'.repeat(64); expectCode(() => new SyntheticHarness(s).mutate(target('asset', 600), c), 'invalid-transition'); });
test('audit/record revision mismatch is rejected', () => { const r = load('create-circuit.result.json'); r.audit.resultRevision = 2; expectCode(() => validateResult(r), 'invalid-contract'); });
test('read adapters have no writable upstream capability', () => { assert.deepEqual(boundaries.homebox.methods, ['GET']); assert.deepEqual(boundaries.network.methods, ['GET']); assert.equal(boundaries.mutations.upstreamCASClaim, false); assert.equal(boundaries.homebox.writeMode, 'homebox-native-links-only'); assert.equal(boundaries.media.maxRedirects, 0); assert.equal(boundaries.geometry.producer, 'magicplan'); });
changed('circuit panel cannot refer to another home', s => { s.records.find(r => r.recordType === 'circuit').payload.panel = { kind: 'atlas-record', ref: { recordType: 'identity', recordId: U(202) } }; }, 'not-found');
changed('circuit panel must be a physical item', s => { s.records.find(r => r.recordType === 'circuit').payload.panel = { kind: 'atlas-record', ref: { recordType: 'identity', recordId: U(200) } }; });
changed('accepted semantic classifications cannot compete', s => { const r = structuredClone(s.records.find(r => r.recordType === 'location-semantics')); r.recordId = U(450); r.payload.semanticKind = 'floor'; s.records.push(r); }, 'identity-conflict');
changed('evidence supersession cannot cycle', s => { s.records[0].payload.supersedesEvidenceIds = [U(101)]; s.records[1].payload.supersedesEvidenceIds = [U(100)]; });
test('no automatic identity tombstone while accepted binding exists', () => { const h = new SyntheticHarness(base()); const c = { ...create(), operation: 'tombstone', expectedRevision: 1 }; delete c.value; expectCode(() => h.mutate(target('identity', 201), c), 'invalid-transition'); assert.equal(h.audits.length, 0); });
test('atomic remap preserves Atlas identity and commits old/new binding and journal together', () => {
  const h = new SyntheticHarness(base()), batch = load('import-remap.batch.json');
  const commands = batch.commands.map(c => ({ target: { ...target(), ...c.target }, command: c.command }));
  const results = h.batch(commands, context, false, batch.batchId);
  assert.equal(results.length, 3); assert.equal(h.audits.length, 3);
  assert.equal(h.snapshot.records.find(r => r.recordId === U(301)).payload.reviewStatus, 'retired');
  assert.equal(h.snapshot.records.find(r => r.recordId === U(304)).payload.atlasId, U(201));
  assert.equal(h.batch(commands, context, false, batch.batchId)[0].replayed, true); assert.equal(h.audits.length, 3);
});
test('partial or altered batch replay is rejected', () => {
  const h = new SyntheticHarness(base()), batch = load('import-remap.batch.json'); const commands = batch.commands.map(c => ({ target: { ...target(), ...c.target }, command: c.command }));
  h.batch(commands, context, false, batch.batchId);
  expectCode(() => h.batch(commands.slice(0, 1), context, false, U(1099)), 'idempotency-conflict');
});
test('failed remap batch leaves all original identities and bindings intact', () => {
  const h = new SyntheticHarness(base()), before = structuredClone(h.snapshot), batch = load('import-remap.batch.json'); const commands = batch.commands.map(c => ({ target: { ...target(), ...c.target }, command: c.command }));
  expectCode(() => h.batch(commands, context, true, batch.batchId), 'synthetic-fault'); assert.deepEqual(h.snapshot, before); assert.equal(h.audits.length, 0);
});
test('OpenAPI references resolve and source routes offer only GET', () => {
  const path = fileURLToPath(new URL('../../../docs/contracts/atlas.openapi.json', import.meta.url)); const api = JSON.parse(readFileSync(path));
  const visit = value => {
    if (value && typeof value === 'object') {
      if (value.$ref) { const [file, pointer] = value.$ref.split('#'); let doc = JSON.parse(readFileSync(resolve(dirname(path), file))); for (const segment of pointer.slice(1).split('/')) doc = doc[segment.replaceAll('~1', '/').replaceAll('~0', '~')]; assert.ok(doc); }
      for (const child of Object.values(value)) visit(child);
    }
  }; visit(api);
  for (const [route, operations] of Object.entries(api.paths)) if (/homebox|network/.test(route)) assert.deepEqual(Object.keys(operations), ['get']);
});
