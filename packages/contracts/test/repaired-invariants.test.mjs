import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson, recordDigest, validateSnapshot, validateResult } from '../src/index.mjs';
import { SyntheticHarness, context, U } from './oracle.mjs';
const load = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const remap = () => { const b = load('import-remap.batch.json'); return { ...b, commands: b.commands.map(c => ({ target: { workspaceId: U(1), homeId: U(2), ...c.target }, command: c.command })) }; };
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);

test('same batch ID binds the batch reason', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json')), b = remap();
  h.batch(b.commands, context, false, b.batchId, b.reason);
  rejects(() => h.batch(b.commands, context, false, b.batchId, 'Different reason'), 'idempotency-conflict');
  assert.equal(h.audits.length, 3);
});
test('batch receipts obey actor/home authorization before replay', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json')), b = remap(); h.batch(b.commands, context, false, b.batchId, b.reason);
  rejects(() => h.batch(b.commands, { ...context, role: 'viewer' }, false, b.batchId, b.reason), 'forbidden');
  rejects(() => h.batch(b.commands, { ...context, homeId: U(3) }, false, b.batchId, b.reason), 'not-found');
});
test('failed batch has no durable command or batch receipts', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json')), b = remap(); rejects(() => h.batch(b.commands, context, true, b.batchId, b.reason), 'synthetic-fault');
  assert.equal(h.batchReceipts.size, 0); assert.equal(h.receipts.size, 0); assert.equal(h.audits.length, 0);
});
test('canonical JSON preserves lexical UTF-16 key order and ECMAScript scalar spelling', () => {
  assert.equal(canonicalJson({ '2': 0, '10': 0, z: 1, a: [1e30, -0, '💡'] }), '{"10":0,"2":0,"a":[1e+30,0,"💡"],"z":1}');
  assert.equal(recordDigest({ b: 2, a: 1 }), '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});
test('canonical digests reject values outside JSON/I-JSON', () => {
  for (const value of [NaN, Infinity, 1n, undefined, '\ud800', { '\udc00': true }]) rejects(() => canonicalJson(value), 'invalid-contract');
});
test('fixture audit contains its exact record digest rather than a placeholder', () => {
  const r = load('create-circuit.result.json'); assert.equal(r.audit.afterDigest, '59f4de3fc73c8b2dbade7a0b14951fdf6fabf3d214838d658e6a4de903bd7962'); validateResult(r, null);
});
test('supplied prior record is verified against before digest and immutable identity', () => {
  const s = load('plan-free.snapshot.json'), h = new SyntheticHarness(s), old = s.records.find(r => r.recordId === U(301));
  const r = h.mutate({ workspaceId: U(1), homeId: U(2), recordType: 'binding', recordId: U(301) }, load('missing-binding.mutation.json'));
  validateResult(r, old);
  const changed = structuredClone(old); changed.payload.sourceState = 'unresolved'; rejects(() => validateResult(r, changed), 'invalid-contract');
  const bad = structuredClone(r); bad.audit.beforeDigest = null; rejects(() => validateResult(bad), 'invalid-contract');
});
test('projection retrieval cannot postdate successful cache generation', () => {
  const s = load('plan-free.snapshot.json'); s.homeboxEntities[0].retrievedAt = '2026-01-04T00:00:00Z'; rejects(() => validateSnapshot(s), 'invalid-contract');
});
test('accepting geometry guards the exact compatible binding revision', () => {
  const s = load('optional-geometry.snapshot.json'); s.records = s.records.filter(r => r.recordType !== 'geometry');
  const original = load('optional-geometry.snapshot.json').records.find(r => r.recordType === 'geometry'); original.payload.mappings[0].reviewStatus = 'accepted';
  const guards = [['identity', 200], ['evidence', 100], ['asset', 600]].map(([recordType, n]) => ({ record: { recordType, recordId: U(n) }, expectedRevision: 1 }));
  const c = { schemaVersion: 1, mutationId: U(1200), operation: 'create', expectedRevision: null, reason: 'Synthetic reviewed mapping', guards, value: { recordType: 'geometry', payload: original.payload } };
  const t = { workspaceId: U(1), homeId: U(2), recordType: 'geometry', recordId: U(601) };
  rejects(() => new SyntheticHarness(s).mutate(t, c), 'guard-conflict');
  c.guards.push({ record: { recordType: 'binding', recordId: U(300) }, expectedRevision: 1 });
  assert.equal(new SyntheticHarness(s).mutate(t, c).record.payload.mappings[0].reviewStatus, 'accepted');
  s.records.find(r => r.recordId === U(300)).revision = 2; rejects(() => new SyntheticHarness(s).mutate(t, c), 'guard-conflict');
});
test('repeated remaps retain prior geometry and journal history under the same Atlas identity', () => {
  const s = load('optional-geometry.snapshot.json'); const m = s.records.find(r => r.recordType === 'geometry').payload.mappings[0]; m.reviewStatus = 'accepted';
  const old = s.records.find(r => r.recordId === U(300)); old.payload.reviewStatus = 'retired';
  const middle = structuredClone(old); middle.recordId = U(305); middle.payload.source.externalId = U(509);
  const next = structuredClone(middle); next.recordId = U(306); next.payload.source.externalId = U(510); next.payload.reviewStatus = 'accepted';
  const example = load('import-remap.snapshot.json').records.find(r => r.recordType === 'reconciliation');
  const first = structuredClone(example); first.recordId = U(407); first.payload.atlasId = U(200); first.payload.fromBindingId = U(300); first.payload.toBindingId = U(305);
  const second = structuredClone(first); second.recordId = U(408); second.payload.fromBindingId = U(305); second.payload.toBindingId = U(306);
  s.records.push(middle, next, first, second); validateSnapshot(s);
  assert.equal(m.atlasId, U(200)); assert.equal(m.homeboxEntity.key.externalId, U(500));
});
test('creating a remap journal without retiring its source still fails atomically', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json')), b = remap();
  rejects(() => h.batch(b.commands.slice(1), context, false, U(1590), b.reason), 'invalid-transition');
  assert.equal(h.audits.length, 0); assert.equal(h.batchReceipts.size, 0);
});
test('historical accepted geometry survives terminal retirement of its matched location', () => {
  const s = load('optional-geometry.snapshot.json'); s.records.find(r => r.recordType === 'geometry').payload.mappings[0].reviewStatus = 'accepted';
  const old = s.records.find(r => r.recordId === U(300)); old.payload.reviewStatus = 'retired';
  const next = structuredClone(old); next.recordId = U(305); next.payload.source.externalId = U(509); next.lifecycle = 'tombstoned';
  const j = structuredClone(load('import-remap.snapshot.json').records.find(r => r.recordType === 'reconciliation')); j.recordId = U(407); j.payload.atlasId = U(200); j.payload.fromBindingId = U(300); j.payload.toBindingId = U(305);
  s.records.find(r => r.recordId === U(200)).lifecycle = 'tombstoned'; s.records.push(next, j); validateSnapshot(s);
});
test('new accepted mapping cannot use a historical retired match as current authority', () => {
  const s = load('optional-geometry.snapshot.json'); const original = s.records.find(r => r.recordType === 'geometry'); original.payload.mappings[0].reviewStatus = 'accepted';
  const old = s.records.find(r => r.recordId === U(300)); old.payload.reviewStatus = 'retired';
  const next = structuredClone(old); next.recordId = U(305); next.payload.source.externalId = U(509); next.payload.reviewStatus = 'accepted';
  const j = structuredClone(load('import-remap.snapshot.json').records.find(r => r.recordType === 'reconciliation')); j.recordId = U(407); j.payload.atlasId = U(200); j.payload.fromBindingId = U(300); j.payload.toBindingId = U(305); s.records.push(next, j);
  const payload = structuredClone(original.payload); payload.previousGeometryId = original.recordId; payload.geometryVersion = 2;
  const guards = s.records.filter(r => r.homeId === U(2)).map(r => ({ record: { recordType: r.recordType, recordId: r.recordId }, expectedRevision: r.revision }));
  const c = { schemaVersion: 1, mutationId: U(1591), operation: 'create', expectedRevision: null, reason: 'Synthetic new mapping', guards, value: { recordType: 'geometry', payload } };
  rejects(() => new SyntheticHarness(s).mutate({ workspaceId: U(1), homeId: U(2), recordType: 'geometry', recordId: U(602) }, c), 'invalid-transition');
});
