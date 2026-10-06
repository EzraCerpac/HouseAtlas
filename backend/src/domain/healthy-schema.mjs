/** Only fixed healthy schema/graph examples. No existing package test alias,
 * mutation oracle, access evaluator, provider, listener or control is invoked. */
import { readFileSync } from 'node:fs';
import { validateShape, validateSnapshot } from '../../../packages/contracts/src/index.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(
  `../../../packages/contracts/fixtures/${name}`, import.meta.url), 'utf8'));
const planFree = fixture('plan-free.snapshot.json');
validateSnapshot(planFree);
const reviewedRoom = structuredClone(planFree);
reviewedRoom.records.find(r => r.recordType === 'location-semantics').payload.semanticKind = 'room';
validateSnapshot(reviewedRoom);
const command = fixture('create-circuit.mutation.json');
const result = fixture('create-circuit.result.json');
validateShape('mutation', command);
validateShape('mutationResult', result);
validateShape('recordRef', result.audit.record);
const batch = {
  schemaVersion: 1,
  batchId: '00000000-0000-4000-8000-000000001100',
  reason: 'Synthetic batch delegation',
  commands: [{ target: result.audit.record, command }],
};
validateShape('batchMutation', batch);
validateShape('batchResult', {
  schemaVersion: 1, batchId: batch.batchId, results: [result], replayed: false,
});
for (const name of ['empty', 'recorded', 'tombstone']) {
  const audits = JSON.parse(readFileSync(new URL(
    `../../../packages/contracts/history/fixtures/${name}.audit-array.json`, import.meta.url), 'utf8'));
  for (const audit of audits) validateShape('audit', audit);
}
console.log('AT36 healthy schemas: 2 validated snapshots, canonical single/batch inputs/results, 3 recorded-history arrays');
