import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeBoxAdapter } from '../src/index.mjs';
import { reg, ids, baseline, detail, fakeTransport, options, response } from './support.mjs';

test('shared collection publishes only reviewed IDs and never requests unauthorized details', async () => {
  const registration = { ...reg, partitionMode: 'reviewed-entity-allowlist', allowedExternalIds: [ids.item] };
  const other = '00000000-0000-4000-8000-000000000599';
  const f = fakeTransport({ registration, entities: [detail(ids.item), detail(other)] });
  const result = await createHomeBoxAdapter({ ...options(f.transport), registration }).fetchGeneration();
  assert.equal(result.ok, true); assert.deepEqual(result.homeboxEntities.map(p => p.entity.id), [ids.item]);
  assert.ok(!f.calls.some(c => c.path.includes(other)));
  assert.ok(!JSON.stringify(result).includes(other));
});
test('foreign parent reference does not escape a reviewed home partition', async () => {
  const registration = { ...reg, partitionMode: 'reviewed-entity-allowlist', allowedExternalIds: [ids.item] };
  const f = fakeTransport({ registration, entities: [detail(ids.item, false, { parent: { id: ids.location } })] });
  const result = await createHomeBoxAdapter({ ...options(f.transport), registration }).fetchGeneration();
  assert.equal(result.ok, false); assert.equal(result.cache.error.code, 'wrong-scope');
  assert.equal(result.homeboxEntities, null); assert.equal(result.quarantine, true);
  assert.equal(f.calls.length, 2);
});
test('empty reviewed partition emits no unauthorized records or detail requests', async () => {
  const registration = { ...reg, partitionMode: 'reviewed-entity-allowlist', allowedExternalIds: [] };
  const f = fakeTransport({ registration, entities: [detail(ids.item)] });
  const result = await createHomeBoxAdapter({ ...options(f.transport), registration }).fetchGeneration();
  assert.equal(result.ok, true); assert.deepEqual(result.homeboxEntities, []); assert.equal(f.calls.length, 2);
});
test('same UUID and labels in another registered collection retain distinct qualified keys', async () => {
  const a = await createHomeBoxAdapter(options(fakeTransport().transport)).fetchGeneration();
  const registration = baseline.sources[1];
  const b = await createHomeBoxAdapter({ ...options(fakeTransport({ registration }).transport), registration }).fetchGeneration();
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.homeboxEntities[0].entity.id, b.homeboxEntities[0].entity.id);
  assert.notDeepEqual(a.homeboxEntities[0].source, b.homeboxEntities[0].source);
  assert.notEqual(a.homeboxEntities[0].homeId, b.homeboxEntities[0].homeId);
});
test('registration and query inputs fail before transport if malformed or out of scope', async () => {
  let calls = 0; const transport = async () => { calls++; return response({}); };
  assert.throws(() => createHomeBoxAdapter({ ...options(transport), registration: { ...reg, owner: 'network' } }));
  assert.throws(() => createHomeBoxAdapter({ ...options(transport), registration: { ...reg, allowedExternalIds: [ids.item] } }));
  assert.throws(() => createHomeBoxAdapter({ ...options(transport), limits: { maxPageSize: 101 } }));
  assert.throws(() => createHomeBoxAdapter({ ...options(transport), limits: { arbitrary: 10 } }));
  const a = createHomeBoxAdapter(options(transport));
  await assert.rejects(a.fetchGeneration({ parentIds: ['../../wrong'] }));
  await assert.rejects(a.fetchGeneration({ parentIds: [ids.location] }), e => e.code === 'pagination');
  await assert.rejects(a.fetchGeneration({ previous: { cache: { ...baseline.caches[0], homeId: baseline.sources[1].homeId }, homeboxEntities: [] } }));
  assert.equal(calls, 0);
});

test('parent-filtered view uses repeated IDs and cannot replace or freshen full cache', async () => {
  const entities = [detail(ids.item, false, { parent: { id: ids.location } }), detail(ids.unknown, false)];
  const f = fakeTransport({ entities });
  const previous = { cache: baseline.caches[0], homeboxEntities: baseline.homeboxEntities };
  const before = structuredClone(previous);
  const result = await createHomeBoxAdapter(options(f.transport)).fetchView({ previous, parentIds: [ids.location, ids.item] });
  assert.equal(result.ok, true); assert.equal(result.replaceCache, false);
  assert.equal(result.completeness, 'filtered-view'); assert.equal(result.cache, null);
  assert.equal(result.quarantine, null); assert.equal(result.quarantineTransition, 'preserve');
  assert.deepEqual(result.missingExternalIds, []);
  assert.deepEqual(result.homeboxEntities.map(p => p.entity.id), [ids.item]);
  assert.deepEqual(previous, before);
  const q = new URLSearchParams(f.calls[0].query);
  assert.deepEqual(q.getAll('parentIds'), [ids.location, ids.item]);
});
test('unauthorized filter and unexpected parent-filtered rows are rejected', async () => {
  const registration = { ...reg, partitionMode: 'reviewed-entity-allowlist', allowedExternalIds: [ids.item] };
  let calls = 0;
  const a = createHomeBoxAdapter({ ...options(async () => { calls++; }), registration });
  await assert.rejects(a.fetchView({ parentIds: [ids.location] }), e => e.code === 'wrong-scope');
  assert.equal(calls, 0);
  const f = fakeTransport({ pageMutator: v => ({ ...v, items: [detail(ids.item, true)], total: 1 }) });
  const r = await createHomeBoxAdapter(options(f.transport)).fetchView({ parentIds: [ids.location] });
  assert.equal(r.ok, false); assert.equal(r.cache, null); assert.equal(r.error.code, 'pagination');
  assert.equal(r.replaceCache, false);
});

test('filtered successes and unrelated failures cannot lift whole-generation quarantine', async () => {
  const a = createHomeBoxAdapter(options(fakeTransport({ entities: [] }).transport));
  const success = await a.fetchView({ parentIds: [ids.location] });
  assert.equal(success.ok, true); assert.equal(success.quarantine, null);
  assert.equal(success.quarantineTransition, 'preserve'); assert.equal(success.cache, null);
  const failure = await createHomeBoxAdapter(options(async () => { throw new Error('offline'); })).fetchView({ parentIds: [ids.location] });
  assert.equal(failure.ok, false); assert.equal(failure.quarantine, null);
  assert.equal(failure.quarantineTransition, 'preserve'); assert.equal(failure.cache, null);
  const denied = await createHomeBoxAdapter(options(async () => response(null, reg, 403))).fetchView({ parentIds: [ids.location] });
  assert.equal(denied.quarantine, true); assert.equal(denied.quarantineTransition, 'quarantine');
});
