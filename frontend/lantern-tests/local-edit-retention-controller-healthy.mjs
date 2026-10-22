// PROPOSED named generated positive; source-owner inspection/registration is
// required before its first invocation. Serial healthy paths only. Actual
// controller + unchanged store/helper; no browser, transport or native service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalEditRetentionController } from '../src/local-edit-retention/controller.ts';
import { createLocalEditRetentionStore, LOCAL_EDIT_RETENTION_DATABASE } from '../src/local-edit-retention/store.ts';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const encode = value => new TextEncoder().encode(value).buffer;
const hash = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
const clone = value => structuredClone(value);
const disk = createSyntheticDisk(), transactions = [];

/** Observe ordinary completion events without pausing or changing commit,
 * requests, hash verification, failures or transaction ordering. */
function observedFactory() {
  const factory = createSyntheticIndexedDB(disk);
  return { open(name, version) {
    assert.equal(name, LOCAL_EDIT_RETENTION_DATABASE); assert.equal(version, 1);
    const request = factory.open(name, version); let success;
    Object.defineProperty(request, 'onsuccess', {
      set(callback) { success = callback; },
      get() { return event => {
        const db = request.result, transact = db.transaction.bind(db);
        db.transaction = (names, mode) => {
          assert.deepEqual(names, ['drafts']);
          const tx = transact(names, mode), observation = { mode, completed: false };
          transactions.push(observation); let complete;
          Object.defineProperty(tx, 'oncomplete', {
            set(callback) { complete = callback; },
            get() { return event => { observation.completed = true; complete?.(event); }; },
          });
          return tx;
        };
        success?.(event);
      }; },
    });
    return request;
  } };
}
const partition = 'generated-controller-partition-a';
const revision = '184467440737095516290000000000000000003';
const original = encode('{\r\n "id":"generated-place", "revision":' + revision + ', "label":"Kitchen 🧭"\r\n}\n');
const resource = encode('{"records":[' + new TextDecoder().decode(original) + ']}');
const manifest = encode('{\r\n  "profile":"generated.controller-positive.v1", "resource":"' + hash(resource) + '"\r\n}\n');
const input = {
  scope: { workspaceId: '00000000-0000-4000-8000-000000000601', homeId: '00000000-0000-4000-8000-000000000602' },
  savedKey: '00000000-0000-4000-8000-000000000601/00000000-0000-4000-8000-000000000602',
  snapshotId: 'c'.repeat(64), localRevision: '00000000-0000-4000-8000-000000000603',
  selectedResource: { id: 'generated-records', role: 'atlas', label: 'Generated records',
    contentType: 'application/json', bytes: resource.byteLength, sha256: hash(resource),
    record: { recordType: 'place', recordId: 'generated-place', revision } },
  recordIdentity: { recordType: 'place', recordId: 'generated-place' },
  manifest: { bytes: manifest, sha256: hash(manifest) },
  original: { bytes: original, sha256: hash(original), revision },
};
const selection = value => ({ scope: clone(value.scope), savedKey: value.savedKey,
  snapshotId: value.snapshotId, localRevision: value.localRevision,
  selectedResource: clone(value.selectedResource), recordIdentity: clone(value.recordIdentity) });
const rows = () => syntheticRecords(disk, LOCAL_EDIT_RETENTION_DATABASE, 'drafts');
let store = createLocalEditRetentionStore(partition, observedFactory());
let controller = createLocalEditRetentionController(partition, store);
const otherStore = createLocalEditRetentionStore('generated-controller-partition-b', observedFactory());
const otherController = createLocalEditRetentionController('generated-controller-partition-b', otherStore);
let notices = [], observations = [], unsubscribe;
function observe() {
  notices = []; observations = [];
  unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot(); notices.push(state.status);
    observations.push({ state, transactionsCompleted: transactions.every(tx => tx.completed) });
  });
}
async function verified(action, expectedAction, transactionCount, writeCount = 0) {
  const count = transactions.length, commits = disk.commits;
  const pending = action();
  assert.equal(controller.getSnapshot().status, 'pending');
  const value = await pending;
  assert.equal(value.action, expectedAction); assert.equal(value.completion, 'verified');
  assert.equal(value.published, true); assert.equal(value.localPartitionId, partition);
  assert.equal(transactions.length, count + transactionCount);
  assert(transactions.slice(count).every(tx => tx.completed));
  assert.equal(disk.commits, commits + writeCount);
  assert.equal(controller.getSnapshot().status, 'ready');
  for (const observation of observations) {
    assert.equal(observation.state.nativeAuthority, 'not-established');
    assert.equal(observation.state.currentBase, 'not-checked');
    if (observation.state.status === 'ready') assert(observation.transactionsCompleted,
      'successful publication follows the actual transaction completion events');
  }
  return value;
}
function sameBase(draft, expected = input) {
  assert.deepEqual(selection(draft), selection(expected));
  assert.deepEqual(draft.manifest, expected.manifest); assert.deepEqual(draft.original, expected.original);
  assert.equal(draft.original.revision, expected.original.revision);
  assert.equal(draft.nativeAuthority, 'not-established'); assert.equal(draft.currentBase, 'not-checked');
}
try {
  observe();
  const callerInput = clone(input), chosen = controller.select(callerInput);
  assert.equal(controller.getSnapshot().status, 'selected');
  assert.equal(disk.databases.size, 0, 'selection/subscription performs no storage work');
  const attribution = controller.getSnapshot().attribution;
  new Uint8Array(callerInput.original.bytes).fill(0); new Uint8Array(callerInput.manifest.bytes).fill(0);
  callerInput.original.revision = '1'; callerInput.selectedResource.label = 'caller-only annotation';
  const absent = await verified(() => chosen.read(), 'read', 1);
  assert.equal(absent.draft, null); assert.deepEqual(rows(), []);
  const retained = await verified(() => chosen.retain(), 'retain', 2, 1);
  sameBase(retained.draft); assert.equal(typeof retained.draft.original.revision, 'string');
  assert.notEqual(retained.draft.selectedResource.sha256, retained.draft.original.sha256);
  assert.deepEqual(retained.selection, selection(input)); assert.equal(retained.selectionGeneration, attribution.selectionGeneration);
  assert.equal(controller.getSnapshot().originalAvailability, 'available');
  new Uint8Array(retained.draft.original.bytes).fill(7); retained.draft.original.revision = 'caller-only';
  const detached = controller.getSnapshot(); new Uint8Array(detached.draft.manifest.bytes).fill(8);
  detached.attribution.selection.scope.homeId = 'caller-only';
  sameBase((await verified(() => chosen.read(), 'read', 1)).draft);
  console.log('PASS explicit select/read/retain: no implicit draft, exact bytes/pins/large revision, detached snapshots/results');

  const proposed = encode('{\n "label":"Proposed dining room 🧭"\n}\n'), exactProposal = proposed.slice(0);
  const proposing = verified(() => chosen.setProposal(proposed), 'set-proposal', 1, 1);
  new Uint8Array(proposed).fill(0);
  const proposalResult = await proposing;
  sameBase(proposalResult.draft);
  assert.deepEqual(proposalResult.draft.proposal, { bytes: exactProposal, sha256: hash(exactProposal) });
  new Uint8Array(proposalResult.draft.proposal.bytes).fill(9);
  assert.deepEqual(controller.getSnapshot().draft.proposal.bytes, exactProposal);

  const other = otherController.select(clone(input));
  const otherRetained = await other.retain();
  assert.equal(otherRetained.completion, 'verified');
  assert.equal(otherRetained.localPartitionId, 'generated-controller-partition-b');
  assert.equal(otherRetained.draft.proposal, null);
  const variants = [
    { ...clone(input), scope: { ...input.scope, homeId: '00000000-0000-4000-8000-000000000604' },
      savedKey: input.scope.workspaceId + '/00000000-0000-4000-8000-000000000604' },
    { ...clone(input), snapshotId: 'd'.repeat(64) },
  ];
  for (const variant of variants) {
    const allocation = controller.select(variant);
    sameBase((await verified(() => allocation.retain(), 'retain', 2, 1)).draft, variant);
  }
  console.log('PASS serial explicit proposal and independent partition/home/snapshot retention');

  // Ordinary completed-allocation retirement/reopen only. Pending retirement,
  // reentrant observers and stale-completion guards require static source review;
  // this runner does not execute concurrency, denial, fault or replay controls.
  controller.retire(); assert.equal(controller.getSnapshot().status, 'retired');
  assert.equal(controller.getSnapshot().attribution, null); assert.equal(controller.getSnapshot().draft, null);
  unsubscribe(); await store.close();
  store = createLocalEditRetentionStore(partition, observedFactory());
  controller = createLocalEditRetentionController(partition, store); observe();
  // Caller currently lacks exact original bytes/revision. Reading restores the
  // retained exact base, without using the caller's parsed-record projection.
  const reopened = controller.select({ ...clone(input), original: { bytes: null, sha256: null, revision: null } });
  const restored = await verified(() => reopened.read(), 'read', 1);
  sameBase(restored.draft); assert.deepEqual(restored.draft.proposal.bytes, exactProposal);
  const reset = await verified(() => reopened.resetProposal(), 'reset-proposal', 1, 1);
  sameBase(reset.draft); assert.equal(reset.draft.proposal, null);
  const replacement = encode('{"label":"Kitchen again"}\r\n');
  sameBase((await verified(() => reopened.setProposal(replacement), 'set-proposal', 1, 1)).draft);
  console.log('PASS read-only reopen restores exact documentary base and separate proposal; explicit reset is reversible');

  const missingVariants = [
    { bytes: null, sha256: null, revision: null },
    { bytes: null, sha256: input.original.sha256, revision },
    { bytes: original.slice(0), sha256: input.original.sha256, revision: null },
  ];
  for (const [index, missing] of missingVariants.entries()) {
    const unavailable = { ...clone(input), recordIdentity: { recordType: 'place', recordId: `generated-missing-${index}` },
      original: missing };
    const allocation = controller.select(unavailable);
    const documentary = await verified(() => allocation.retain(), 'retain', 2, 1);
    sameBase(documentary.draft, unavailable);
    assert.equal(controller.getSnapshot().originalAvailability, 'unavailable');
    const read = await verified(() => allocation.read(), 'read', 1);
    assert.deepEqual(read.draft.original, missing); assert.equal(read.draft.proposal, null);
  }
  console.log('PASS unavailable original bytes/hash/revision remain nullable; resource pins never supply missing provenance');

  const discardAllocation = controller.select(input);
  sameBase((await verified(() => discardAllocation.read(), 'read', 1)).draft);
  const beforeDiscard = rows(), selectedRow = beforeDiscard.find(row => row.draft.localPartitionId === partition
    && JSON.stringify(selection(row.draft)) === JSON.stringify(selection(input)));
  assert(selectedRow);
  const discarded = await verified(() => discardAllocation.discard(), 'discard', 2, 1);
  assert.equal(discarded.discarded, true); assert.equal(discarded.draft, null);
  assert.deepEqual(rows(), beforeDiscard.filter(row => row.id !== selectedRow.id));
  assert.equal((await verified(() => discardAllocation.read(), 'read', 1)).draft, null);
  sameBase((await other.read()).draft);
  assert.deepEqual([...disk.databases.keys()], [LOCAL_EDIT_RETENTION_DATABASE]);
  assert(notices.includes('pending') && notices.includes('ready'));
  console.log('PASS targeted verified discard preserves every unrelated row and local partition');
  console.log(`PASS local edit controller healthy: ${transactions.length} completed synthetic transactions. Source evidence only; no browser/device durability, native authority or live-base qualification.`);
} finally {
  unsubscribe?.(); controller.retire(); otherController.retire();
  await store.close(); await otherStore.close();
}
