// Positive independent lifecycle check; no source files are changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SyntheticHarness, U, context } from './oracle.mjs';
const load = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const target = (recordType, recordId) => ({ workspaceId: U(1), homeId: U(2), recordType, recordId });

test('R6: a remapped identity can be tombstoned with all accepted bindings retired atomically', () => {
  const h = new SyntheticHarness(load('plan-free.snapshot.json'));
  const b = load('import-remap.batch.json');
  h.batch(b.commands.map(c => ({ target: target(c.target.recordType, c.target.recordId), command: c.command })), context, false, b.batchId, b.reason);
  const identities = h.snapshot.records.find(r => r.recordId === U(201));
  const bindings = h.snapshot.records.filter(r => r.recordType === 'binding' && r.payload.atlasId === U(201) && r.payload.reviewStatus === 'accepted');
  const commands = bindings.map((r, i) => ({
    target: target('binding', r.recordId),
    command: { schemaVersion: 1, mutationId: U(1500 + i), operation: 'replace', expectedRevision: r.revision, reason: 'Reviewed retirement while retaining identity and remap history', guards: [{ record: { recordType: 'identity', recordId: U(201) }, expectedRevision: identities.revision }, { record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }], value: { recordType: 'binding', payload: { ...r.payload, reviewStatus: 'retired' } } }
  }));
  commands.push({ target: target('identity', U(201)), command: { schemaVersion: 1, mutationId: U(1509), operation: 'tombstone', expectedRevision: identities.revision, reason: 'Reviewed retirement while retaining identity and remap history', guards: [{ record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }] } });
  h.batch(commands, context, false, U(1510), 'Retire the remapped physical identity');
  assert.equal(h.snapshot.records.find(r => r.recordId === U(201)).lifecycle, 'tombstoned');
  assert.equal(h.snapshot.records.find(r => r.recordType === 'reconciliation').recordId, U(405));
});

test('R6: retained accepted geometry can survive ordinary identity retirement without an ID remap', () => {
  const s = load('optional-geometry.snapshot.json');
  s.records.find(r => r.recordType === 'geometry').payload.mappings[0].reviewStatus = 'accepted';
  const h = new SyntheticHarness(s);
  const binding = h.snapshot.records.find(r => r.recordId === U(300));
  const commands = [{ target: target('binding', U(300)), command: { schemaVersion: 1, mutationId: U(1600), operation: 'replace', expectedRevision: 1, reason: 'Retire the physical location and retain historical geometry', guards: [{ record: { recordType: 'identity', recordId: U(200) }, expectedRevision: 1 }, { record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }], value: { recordType: 'binding', payload: { ...binding.payload, reviewStatus: 'retired' } } } }, { target: target('identity', U(200)), command: { schemaVersion: 1, mutationId: U(1601), operation: 'tombstone', expectedRevision: 1, reason: 'Retire the physical location and retain historical geometry', guards: [{ record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }] } }];
  h.batch(commands, context, false, U(1610), 'Retire location with historical geometry');
  assert.equal(h.snapshot.records.find(r => r.recordId === U(200)).lifecycle, 'tombstoned');
  assert.equal(h.snapshot.records.find(r => r.recordId === U(601)).payload.mappings[0].atlasId, U(200));
});
