// Independent reviewer regressions for R1-R5, copied unchanged except local import paths.
// Retained contract regression source; excluded from ordinary CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSnapshot, validateResult } from '../src/index.mjs';
import { SyntheticHarness, U, context } from './oracle.mjs';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const base = () => load('plan-free.snapshot.json');
const remap = () => {
  const batch = load('import-remap.batch.json');
  const commands = batch.commands.map(c => ({ target: { workspaceId: U(1), homeId: U(2), ...c.target }, command: c.command }));
  return { batch, commands };
};
const rejects = fn => assert.throws(fn, e => typeof e.code === 'string');

test('control: the frozen plan-free fixture validates', () => validateSnapshot(base()));
test('control: exact remap retry is replayed without additional audit', () => {
  const h = new SyntheticHarness(base()), { batch, commands } = remap();
  h.batch(commands, context, false, batch.batchId);
  assert.equal(h.batch(commands, context, false, batch.batchId)[0].replayed, true);
  assert.equal(h.audits.length, 3);
});
test('R1: same batch ID with a subset must conflict', () => {
  const h = new SyntheticHarness(base()), { batch, commands } = remap();
  h.batch(commands, context, false, batch.batchId);
  rejects(() => h.batch(commands.slice(0, 1), context, false, batch.batchId));
});
test('R1: same batch ID with reversed command order must conflict', () => {
  const h = new SyntheticHarness(base()), { batch, commands } = remap();
  h.batch(commands, context, false, batch.batchId);
  rejects(() => h.batch([...commands].reverse(), context, false, batch.batchId));
});
test('R1: reusing a committed batch ID for fresh command IDs must conflict', () => {
  const h = new SyntheticHarness(base()), { batch, commands } = remap();
  h.batch(commands, context, false, batch.batchId);
  const c = load('create-circuit.mutation.json');
  rejects(() => h.batch([{ target: { workspaceId: U(1), homeId: U(2), recordType: 'circuit', recordId: U(406) }, command: c }], context, false, batch.batchId));
});
test('R2: one HomeBox UUID cannot reserve two physical identities through letter case', () => {
  const s = base();
  const old = s.records.find(r => r.recordId === U(300));
  old.payload.source.externalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const duplicate = structuredClone(old);
  duplicate.recordId = U(399);
  duplicate.payload.atlasId = U(201);
  duplicate.payload.source.externalId = old.payload.source.externalId.toUpperCase();
  s.records.push(duplicate);
  rejects(() => validateSnapshot(s));
});
test('R2: one permanent record UUID cannot be duplicated through letter case', () => {
  const s = base(), old = structuredClone(s.records.find(r => r.recordId === U(201)));
  old.recordId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const duplicate = structuredClone(old);
  duplicate.recordId = old.recordId.toUpperCase();
  duplicate.homeId = U(3);
  duplicate.payload.evidenceIds = [U(103)];
  s.records.push(old, duplicate);
  rejects(() => validateSnapshot(s));
});
test('R3: accepted room mapping must not claim a different bound HomeBox item', () => {
  const s = load('optional-geometry.snapshot.json');
  const m = s.records.find(r => r.recordType === 'geometry').payload.mappings[0];
  m.reviewStatus = 'accepted';
  m.homeboxEntity.key.externalId = U(501); // Explicit item, already bound to Atlas item 201.
  rejects(() => validateSnapshot(s));
});
test('R3: accepted room mapping must not claim an unbound HomeBox entity', () => {
  const s = load('optional-geometry.snapshot.json');
  const m = s.records.find(r => r.recordType === 'geometry').payload.mappings[0];
  m.reviewStatus = 'accepted';
  m.homeboxEntity.key.externalId = U(999);
  rejects(() => validateSnapshot(s));
});
test('R4: create audit cannot label the committed operation as tombstone', () => {
  const r = load('create-circuit.result.json');
  r.audit.operation = 'tombstone';
  rejects(() => validateResult(r));
});
test('R4: create audit cannot contain a nonnull before digest', () => {
  const r = load('create-circuit.result.json');
  r.audit.beforeDigest = 'b'.repeat(64);
  rejects(() => validateResult(r));
});
test('R4: audit after digest must match the committed record', () => {
  const r = load('create-circuit.result.json');
  r.audit.afterDigest = 'c'.repeat(64);
  rejects(() => validateResult(r));
});
test('R5: cached HomeBox projections cannot exist without a cache generation', () => {
  const s = base();
  s.caches = [];
  rejects(() => validateSnapshot(s));
});
test('R5: cached HomeBox projections cannot accompany a never-successful empty cache', () => {
  const s = base(), c = s.caches[0];
  c.status = 'empty'; c.generationId = null; c.lastSuccessfulFetchAt = null;
  rejects(() => validateSnapshot(s));
});
test('control: first-run empty HomeBox cache is valid when there are no projections', () => {
  const s = base(), c = s.caches[0];
  s.homeboxEntities = [];
  c.status = 'empty'; c.generationId = null; c.lastSuccessfulFetchAt = null;
  validateSnapshot(s);
});
