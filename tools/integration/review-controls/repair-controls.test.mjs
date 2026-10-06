import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const revision = process.env.ATLAS_REVIEW_REVISION ?? '2';
const prefix = '../../../';
const api = await import(`${prefix}packages/contracts/src/index.mjs`);
const { SyntheticHarness, U, context } = await import(`${prefix}packages/contracts/test/oracle.mjs`);
const load = name => JSON.parse(readFileSync(new URL(`${prefix}packages/contracts/fixtures/${name}`, import.meta.url)));
const t = (recordType, n) => ({ workspaceId: U(1), homeId: U(2), recordType, recordId: U(n) });
const geometryCommand = s => {
  const value = structuredClone(s.records.find(r => r.recordType === 'geometry').payload);
  value.previousGeometryId = U(601); value.geometryVersion = 2; value.mappings[0].reviewStatus = 'accepted';
  return { schemaVersion: 1, mutationId: U(1700), operation: 'create', expectedRevision: null, reason: 'Reviewed next geometry with the existing exact location binding', guards: [{ record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }, { record: { recordType: 'asset', recordId: U(600) }, expectedRevision: 1 }, { record: { recordType: 'identity', recordId: U(200) }, expectedRevision: 1 }, { record: { recordType: 'geometry', recordId: U(601) }, expectedRevision: 1 }, { record: { recordType: 'binding', recordId: U(300) }, expectedRevision: 1 }], value: { recordType: 'geometry', payload: value } };
};
test('valid next accepted geometry commits with all dependency guards', () => {
  const s = load('optional-geometry.snapshot.json'), h = new SyntheticHarness(s);
  assert.equal(h.mutate(t('geometry', 602), geometryCommand(s)).record.revision, 1);
});
test('accepting geometry without the exact matching binding guard fails', () => {
  const s = load('optional-geometry.snapshot.json'), c = geometryCommand(s);
  c.guards = c.guards.filter(g => g.record.recordType !== 'binding');
  assert.throws(() => new SyntheticHarness(s).mutate(t('geometry', 602), c), e => e.code === 'guard-conflict');
});
test('accepting geometry with a stale matching binding guard fails', () => {
  const s = load('optional-geometry.snapshot.json'), c = geometryCommand(s);
  s.records.find(r => r.recordId === U(300)).revision = 2;
  assert.throws(() => new SyntheticHarness(s).mutate(t('geometry', 602), c), e => e.code === 'guard-conflict');
});
test('batch reason changes with the same batch ID fail', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json')), b = load('import-remap.batch.json');
  const cs = b.commands.map(c => ({ target: { ...t(c.target.recordType, 0), ...c.target }, command: c.command }));
  h.batch(cs, context, false, b.batchId, b.reason);
  assert.throws(() => h.batch(cs, context, false, b.batchId, 'Different reviewed reason'), e => e.code === 'idempotency-conflict');
});
test('canonical audit digest matches independently calculated fixture bytes', () => {
  const r = load('create-circuit.result.json');
  // This fixture contains only plain JSON strings, booleans, null and safe integers.
  const serialize = v => Array.isArray(v) ? `[${v.map(serialize).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${serialize(v[k])}`).join(',')}}` : JSON.stringify(v);
  assert.equal(r.audit.afterDigest, createHash('sha256').update(serialize(r.record)).digest('hex'));
});
test('canonicalization sorts keys and uses ECMAScript numeric spelling', () => {
  assert.equal(api.canonicalJson({ z: -0, a: 1e30, b: 0.002 }), '{"a":1e+30,"b":0.002,"z":0}');
  assert.throws(() => api.canonicalJson({ bad: '\ud800' }), e => e.code === 'invalid-contract');
  assert.throws(() => api.canonicalJson({ bad: Number.NaN }), e => e.code === 'invalid-contract');
});
test('cache timestamp cannot predate projection retrieval', () => {
  const s = load('plan-free.snapshot.json');
  s.homeboxEntities[0].retrievedAt = '2026-01-03T00:00:00Z';
  assert.throws(() => api.validateSnapshot(s), e => e.code === 'invalid-contract');
});
