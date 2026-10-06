import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../../contracts/src/index.mjs';
import { seeded, scope, principal, fixture, ref, guard, createCircuit, replace, U } from './helpers.mjs';

test('final guard control: new accepted geometry with retired exact binding is rejected atomically', () => {
  const { store } = seeded('optional-geometry');
  const before = store.readSnapshot(principal, scope), geometry = before.records.find(r => r.recordType === 'geometry');
  const binding = before.records.find(r => r.recordId === U(300));
  const nextPayload = { ...geometry.payload, geometryVersion: geometry.payload.geometryVersion + 1, previousGeometryId: geometry.recordId,
    mappings: geometry.payload.mappings.map(m => ({ ...m, reviewStatus: 'accepted' })) };
  const envelope = { schemaVersion: 1, batchId: U(1100), reason: 'Review final graph', commands: [
    { target: ref('binding', 300), command: replace(binding, 1000, { reviewStatus: 'retired' }, [guard('identity', 200), guard('evidence', 100)]) },
    { target: ref('geometry', 990), command: { ...createCircuit(1001), guards: [guard('identity', 200), guard('evidence', 100),
      guard('binding', 300), guard('asset', Number(geometry.payload.originalAssetId.slice(-12))), guard('geometry', Number(geometry.recordId.slice(-12)))],
      value: { recordType: 'geometry', payload: nextPayload } } },
  ] };
  // This historical graph is valid; only assertFinalMutation distinguishes the new assertion.
  const historical = structuredClone(before); historical.records.find(r => r.recordId === U(300)).payload.reviewStatus = 'retired';
  historical.records.push({ ...geometry, recordId: U(990), payload: nextPayload }); validateSnapshot(historical);
  assert.throws(() => store.executeBatch(principal, scope, envelope), e => e.code === 'invalid-transition');
  assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
});
test('final guard control: new remap to retired destination is rejected though historical journal graph validates', () => {
  const { store } = seeded('import-remap');
  const before = store.readSnapshot(principal, scope), binding = before.records.find(r => r.recordId === U(304));
  const journal = before.records.find(r => r.recordType === 'reconciliation');
  const envelope = { schemaVersion: 1, batchId: U(1100), reason: 'Review final remap', commands: [
    { target: ref('binding', 304), command: replace(binding, 1000, { reviewStatus: 'retired' }, [guard('identity', 201), guard('evidence', 100)]) },
    { target: ref('reconciliation', 991), command: { ...createCircuit(1001), guards: [guard('identity', 201), guard('evidence', 100), guard('binding', 301, 2), guard('binding', 304)],
      value: { recordType: 'reconciliation', payload: journal.payload } } },
  ] };
  const historical = structuredClone(before); historical.records.find(r => r.recordId === U(304)).payload.reviewStatus = 'retired';
  historical.records.push({ ...journal, recordId: U(991) }); validateSnapshot(historical);
  assert.throws(() => store.executeBatch(principal, scope, envelope), e => e.code === 'invalid-transition');
  assert.deepEqual(store.readSnapshot(principal, scope), before); store.close();
});
