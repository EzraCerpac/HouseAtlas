// Named generated positive only. Actual production store, disposable synthetic
// IDB, no browser, listener, network, fault/crash/replay cases or native service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createLocalEditRetentionStore, LOCAL_EDIT_RETENTION_DATABASE, LOCAL_EDIT_RETENTION_LIMITS,
} from '../src/local-edit-retention/store.ts';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
assert.equal(LOCAL_EDIT_RETENTION_DATABASE, 'houseatlas-local-edit-retention-v1');
assert.deepEqual(LOCAL_EDIT_RETENTION_LIMITS, {
  drafts: 32, recordBytes: 1048576, manifestBytes: 16777216, metadataBytes: 65536, totalBytes: 67108864,
});
const encode = text => new TextEncoder().encode(text).buffer;
const hash = data => createHash('sha256').update(Buffer.from(data)).digest('hex');
const clone = value => structuredClone(value);
const disk = createSyntheticDisk();
let completed = 0;

/** Transparent completion observation, without pausing, injecting failures or
 * changing commit behavior. The shared helper remains unchanged. */
function observedFactory() {
  const factory = createSyntheticIndexedDB(disk);
  return { open(name, version) {
    assert.equal(name, LOCAL_EDIT_RETENTION_DATABASE); assert.equal(version, 1);
    const request = factory.open(name, version);
    let success;
    Object.defineProperty(request, 'onsuccess', {
      set(callback) { success = callback; },
      get() { return event => {
        const db = request.result, transact = db.transaction.bind(db);
        db.transaction = (names, mode) => {
          assert.deepEqual(names, ['drafts']);
          const tx = transact(names, mode); let complete;
          Object.defineProperty(tx, 'oncomplete', {
            set(callback) { complete = callback; },
            get() { return event => { completed++; complete?.(event); }; },
          });
          return tx;
        };
        success?.(event);
      }; },
    });
    return request;
  } };
}
const context = {
  scope: { workspaceId: '00000000-0000-4000-8000-000000000501', homeId: '00000000-0000-4000-8000-000000000502' },
  savedKey: '00000000-0000-4000-8000-000000000501/00000000-0000-4000-8000-000000000502',
  snapshotId: 'a'.repeat(64), localRevision: '00000000-0000-4000-8000-000000000503',
};
const revision = '184467440737095516290000000000000000001';
const record = encode('{\n "id": "generated-room", "revision": ' + revision + ', "label": "Kitchen 🧭"\n}\n');
const resource = encode('{"records":[' + new TextDecoder().decode(record) + ']}');
const manifest = encode('{\r\n  "profile": "generated.local-edit-retention.v1", "revision": ' + revision + '\r\n}\r\n');
const input = {
  ...clone(context),
  selectedResource: { id: 'generated-atlas', role: 'atlas', label: 'Generated atlas',
    contentType: 'application/json', sha256: hash(resource), bytes: resource.byteLength,
    record: { recordType: 'place', recordId: 'generated-room', revision } },
  recordIdentity: { recordType: 'place', recordId: 'generated-room' },
  manifest: { bytes: manifest, sha256: hash(manifest) },
  original: { bytes: record, sha256: hash(record), revision },
};
const selection = value => ({
  scope: clone(value.scope), savedKey: value.savedKey, snapshotId: value.snapshotId, localRevision: value.localRevision,
  selectedResource: clone(value.selectedResource), recordIdentity: clone(value.recordIdentity),
});
const rows = () => syntheticRecords(disk, LOCAL_EDIT_RETENTION_DATABASE, 'drafts');
async function finished(action, writes = false) {
  const before = completed, commits = disk.commits;
  const result = await action();
  assert.equal(completed, before + 1, 'only transaction completion may settle a store result');
  assert.equal(disk.commits, commits + (writes ? 1 : 0));
  return result;
}
let store = createLocalEditRetentionStore('generated-local-partition-a', observedFactory());
let other = createLocalEditRetentionStore('generated-local-partition-b', observedFactory());
try {
  const supplied = clone(input), before = clone(supplied);
  const retaining = finished(() => store.retain(supplied), true);
  // Ordinary caller reuse after invoking retain must not alter retained bytes.
  new Uint8Array(supplied.manifest.bytes).fill(0);
  new Uint8Array(supplied.original.bytes).fill(0);
  supplied.original.revision = '2'; supplied.scope.homeId = 'caller-reused-input';
  const first = await retaining;
  assert.deepEqual(first, { ...before, localPartitionId: 'generated-local-partition-a',
    nativeAuthority: 'not-established', currentBase: 'not-checked', proposal: null });
  assert.equal(first.original.revision, revision);
  assert.equal(typeof first.original.revision, 'string');
  assert.deepEqual(first.manifest.bytes, manifest); assert.deepEqual(first.original.bytes, record);
  // Returned nested objects and buffers must also be detached from persistence.
  first.selectedResource.label = 'caller annotation'; new Uint8Array(first.original.bytes).fill(8);
  new Uint8Array(first.manifest.bytes).fill(9); first.original.revision = '3';
  const baseline = await finished(() => store.get(selection(input)));
  assert.deepEqual(baseline.original, before.original); assert.deepEqual(baseline.manifest, before.manifest);
  assert.deepEqual(baseline.selectedResource, before.selectedResource);
  assert.notEqual(baseline.selectedResource.sha256, baseline.original.sha256,
    'the selected multi-record resource and individual record keep independent pins');
  await store.close();
  store = createLocalEditRetentionStore('generated-local-partition-a', observedFactory());
  assert.deepEqual(await finished(() => store.get(selection(input))), baseline);
  console.log('PASS reopen and round-trip: exact manifest/original bytes and hashes, large revision, detached inputs/results');

  const partitionRow = await finished(() => other.retain(clone(input)), true);
  assert.equal(partitionRow.localPartitionId, 'generated-local-partition-b');
  const variants = [
    { ...clone(input), scope: { ...context.scope, homeId: '00000000-0000-4000-8000-000000000504' },
      savedKey: context.scope.workspaceId + '/00000000-0000-4000-8000-000000000504' },
    { ...clone(input), scope: { ...context.scope, workspaceId: '00000000-0000-4000-8000-000000000505' },
      savedKey: '00000000-0000-4000-8000-000000000505/' + context.scope.homeId },
    { ...clone(input), snapshotId: 'b'.repeat(64) },
    { ...clone(input), localRevision: '00000000-0000-4000-8000-000000000506' },
    { ...clone(input), selectedResource: { ...clone(input.selectedResource), id: 'generated-atlas-alias' } },
    { ...clone(input), recordIdentity: { recordType: 'place', recordId: 'another-generated-room' } },
  ];
  for (const variant of variants) await finished(() => store.retain(variant), true);
  assert.equal((await finished(() => store.list(context))).length, 3);
  assert.deepEqual(await finished(() => other.list(context)), [partitionRow]);
  for (const variant of variants) {
    const retained = await finished(() => store.get(selection(variant)));
    assert.deepEqual(selection(retained), selection(variant));
    assert.deepEqual(retained.original, before.original);
  }
  console.log('PASS valid partition, workspace/home, snapshot, local revision, resource and record isolation');

  const protectedRows = rows().filter(row => row.draft.localPartitionId !== baseline.localPartitionId
    || JSON.stringify(selection(row.draft)) !== JSON.stringify(selection(input)));
  for (const text of ['{ "label": "Proposed dining room" }\n', '{"label":"Kitchen again 🧭"}\r\n']) {
    const proposed = encode(text), exact = proposed.slice(0);
    const pending = finished(() => store.setProposal(selection(input), proposed), true);
    new Uint8Array(proposed).fill(0);
    const changed = await pending;
    assert.deepEqual(changed.original, before.original); assert.deepEqual(changed.manifest, before.manifest);
    assert.deepEqual(changed.proposal, { bytes: exact, sha256: hash(exact) });
    assert.equal(changed.nativeAuthority, 'not-established'); assert.equal(changed.currentBase, 'not-checked');
    new Uint8Array(changed.proposal.bytes).fill(7);
    await store.close(); store = createLocalEditRetentionStore('generated-local-partition-a', observedFactory());
    const reopened = await finished(() => store.get(selection(input)));
    assert.deepEqual(reopened.proposal, { bytes: exact, sha256: hash(exact) });
    const reset = await finished(() => store.resetProposal(selection(input)), true);
    assert.deepEqual(reset, baseline);
  }
  const listed = await finished(() => store.list(context));
  for (const draft of listed) { draft.original.revision = 'caller-only'; new Uint8Array(draft.manifest.bytes).fill(5); }
  assert.deepEqual(await finished(() => store.get(selection(input))), baseline);
  assert.deepEqual(rows().filter(row => JSON.stringify(selection(row.draft)) !== JSON.stringify(selection(input))
    || row.draft.localPartitionId !== baseline.localPartitionId), protectedRows);
  console.log('PASS reversible proposals and reset: immutable original/revision/manifest and unchanged unrelated rows');

  // Documentary pins alone supply neither original bytes nor a current revision.
  const unavailable = { ...clone(input), recordIdentity: { recordType: 'place', recordId: 'unavailable-generated-room' },
    original: { bytes: null, sha256: null, revision: null } };
  await finished(() => store.retain(unavailable), true);
  const unavailableChanged = await finished(() => store.setProposal(selection(unavailable), encode('{"label":"Draft only"}')), true);
  assert.deepEqual(unavailableChanged.original, unavailable.original);
  const unavailableReset = await finished(() => store.resetProposal(selection(unavailable)), true);
  assert.deepEqual(unavailableReset.original, unavailable.original); assert.equal(unavailableReset.proposal, null);
  await store.close(); store = createLocalEditRetentionStore('generated-local-partition-a', observedFactory());
  assert.deepEqual((await finished(() => store.get(selection(unavailable)))).original, unavailable.original);
  // Independently unavailable revision and bytes must also remain independent.
  const bytesOnly = { ...clone(input), recordIdentity: { recordType: 'place', recordId: 'generated-bytes-only' },
    original: { ...clone(input.original), revision: null } };
  const revisionOnly = { ...clone(input), recordIdentity: { recordType: 'place', recordId: 'generated-revision-only' },
    original: { bytes: null, sha256: input.original.sha256, revision } };
  for (const partial of [bytesOnly, revisionOnly]) {
    await finished(() => store.retain(partial), true);
    assert.deepEqual((await finished(() => store.setProposal(selection(partial), encode('{}')),
      true)).original, partial.original);
  }
  console.log('PASS missing original bytes/revision stay unavailable through proposal, reset and reopen');

  const retainedBeforeDiscard = rows();
  const removed = retainedBeforeDiscard.find(row => row.draft.localPartitionId === baseline.localPartitionId
    && JSON.stringify(selection(row.draft)) === JSON.stringify(selection(input)));
  assert(removed);
  assert.equal(await finished(() => store.discard(selection(input)), true), true);
  assert.deepEqual(rows(), retainedBeforeDiscard.filter(row => row.id !== removed.id));
  assert.deepEqual(baseline.original, before.original, 'discard does not mutate detached evidence');
  await store.close(); store = createLocalEditRetentionStore('generated-local-partition-a', observedFactory());
  assert.equal(await finished(() => store.get(selection(input))), null);
  assert.deepEqual(await finished(() => other.get(selection(input))), partitionRow);
  for (const variant of variants) assert(await finished(() => store.get(selection(variant))));
  assert.deepEqual([...disk.databases.keys()], [LOCAL_EDIT_RETENTION_DATABASE]);
  console.log('PASS explicit discard: only the selected row removed; other partitions/homes/snapshots/records preserved');
  console.log(`PASS local edit retention healthy: ${completed} completed synthetic transactions. No browser/device durability, backup, live authorization or native acceptance established.`);
} finally {
  await store.close(); await other.close();
}
