// Offline positive-fixture golden generation only. Never called by Rust code.
// Explicit healthy inputs; no test globs, stores, replay, listeners or providers.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// A task-owned dependency prefix permits checking the published source without
// installing dependencies or changing manifests in another worker's namespace.
if (process.env.HOUSEATLAS_REFERENCE_DEPENDENCIES) {
  const require = createRequire(`${process.env.HOUSEATLAS_REFERENCE_DEPENDENCIES}/package.json`);
  const dependencies = new Map(['ajv/dist/2020.js', 'ajv-formats'].map(specifier =>
    [specifier, pathToFileURL(require.resolve(specifier)).href]));
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (dependencies.has(specifier)) {
      return { url: dependencies.get(specifier), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
}
const root = new URL('../../../../../', import.meta.url);
const { validateSnapshot, assertTransition, assertGuards, assertFinalMutation,
  validateResult, recordDigest } = await import(new URL('packages/contracts/src/index.mjs', root));
const { mutationAuthorizationContext } = await import(new URL('packages/storage/src/mutation-context.mjs', root));
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const fixtures = 'packages/contracts/fixtures/';
const snapshots = ['plan-free.snapshot.json', 'optional-geometry.snapshot.json', 'import-remap.snapshot.json'];
const original = read(`${fixtures}${snapshots[0]}`);
const candidate = read(`${fixtures}${snapshots[2]}`);
const batch = read(`${fixtures}import-remap.batch.json`);
const command = read(`${fixtures}create-circuit.mutation.json`);
const result = read(`${fixtures}create-circuit.result.json`);
const scope = { workspaceId: result.record.workspaceId, homeId: result.record.homeId };
const refOf = record => ({ recordType: record.recordType, recordId: record.recordId });
const same = (record, ref) => record.recordType === ref.recordType && record.recordId === ref.recordId;
const createTarget = { ...scope, ...refOf(result.record) };

for (const name of snapshots) validateSnapshot(read(`${fixtures}${name}`));
validateResult(result, null);
const createTransition = assertTransition(null, command, createTarget);
assertGuards(original, null, command, createTarget);
const createdCandidate = { ...original, records: [...original.records, result.record] };
validateSnapshot(createdCandidate);
assertFinalMutation(createdCandidate, null, command, createTarget);

const created = batch.commands.filter(entry => entry.command.operation === 'create').map(entry => entry.target);
const transitions = batch.commands.map(entry => {
  const current = original.records.find(record => same(record, entry.target));
  const target = { ...scope, ...entry.target };
  const transition = assertTransition(current, entry.command, target);
  assertGuards(original, current, entry.command, target, created);
  return transition;
});
// Preserve the final-graph-first and original command order contract.
validateSnapshot(candidate);
for (const entry of batch.commands) {
  assertFinalMutation(candidate, original.records.find(record => same(record, entry.target)),
    entry.command, { ...scope, ...entry.target });
}
const batchHash = recordDigest({ scope, ...batch });
const context = mutationAuthorizationContext({ contextId: 'healthy-fixture-reference', phase: 'candidate',
  scope, original, candidate, entries: batch.commands, batch, cachePartitions: [] });
const contexts = read('packages/contracts/history/fixtures/contexts.json');
for (const entry of contexts.cases) {
  const history = read(`packages/contracts/history/fixtures/${entry.file}`);
  assert.deepEqual(history.map(audit => audit.operation), entry.expectedOperations);
  if (entry.committedRecord) validateResult({ schemaVersion: 1, record: entry.committedRecord,
    audit: history.at(-1), replayed: false }, entry.file === 'tombstone.audit-array.json' ? result.record : undefined);
}
const golden = {
  source: 'Published healthy synthetic fixtures; no held controls',
  snapshotDigests: Object.fromEntries(snapshots.map(name => [name, recordDigest(read(`${fixtures}${name}`))])),
  createTransition,
  createMutationDigest: recordDigest({ target: createTarget, command, batchId: null, batchHash: null }),
  batchDigest: batchHash,
  batchTransitions: transitions,
  batchMutationDigests: batch.commands.map(entry => recordDigest({ target: { ...scope, ...entry.target },
    command: entry.command, batchId: batch.batchId, batchHash })),
  closure: context.closure,
};
writeFileSync(new URL('./healthy.expected.json', import.meta.url), `${JSON.stringify(golden, null, 2)}\n`);
console.log('PASS published healthy graph, transition, guard, final-decision, result and closure references');
