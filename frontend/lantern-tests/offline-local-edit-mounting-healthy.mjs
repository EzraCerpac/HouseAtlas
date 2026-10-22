// Proposed serial generated positive. Do not invoke before exact body review
// and source-owner named-command registration. Actual adapter/controller/store
// and actual panel SSR; no browser, transport, native data or fault controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'offline-local-edit-positive-'));
let h;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export * from ${JSON.stringify(join(root, 'src/local-edit-retention/saved-adapter.ts'))};`,
    `export { LocalEditPanel } from ${JSON.stringify(join(root, 'src/local-edit-retention/LocalEditPanel.tsx'))};`,
    `export { createLocalEditRetentionStore, LOCAL_EDIT_RETENTION_DATABASE } from ${JSON.stringify(join(root, 'src/local-edit-retention/store.ts'))};`,
    `export { validateSavedHouse } from ${JSON.stringify(join(root, 'src/offline/store.ts'))};`,
  ].join('\n'));
  const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, target: 'node26', minify: false,
    lib: { entry, formats: ['es'] }, rolldownOptions: { external: id => /^(react|react-dom)(\/|$)/.test(id),
      output: { codeSplitting: false, paths: id => pathToFileURL(require.resolve(id)).href } } } });
  const output = Array.isArray(built) ? built[0] : built;
  const code = output.output.find(item => item.type === 'chunk' && item.isEntry).code;
  assert(!code.includes('__require("react")'));
  const modulePath = join(scratch, 'fixture.mjs'); writeFileSync(modulePath, code);
  h = await import(pathToFileURL(modulePath).href);
} finally { rmSync(scratch, { recursive: true, force: true }); }
const { createElement } = await import(new URL('../node_modules/react/index.js', import.meta.url).href);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
const encode = text => new TextEncoder().encode(text).buffer;
const hash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const clone = value => structuredClone(value);
const disk = createSyntheticDisk(), transactions = [];
function observedFactory() {
  const factory = createSyntheticIndexedDB(disk);
  return { open(name, version) {
    assert.equal(name, h.LOCAL_EDIT_RETENTION_DATABASE); assert.equal(version, 1);
    const request = factory.open(name, version); let success;
    Object.defineProperty(request, 'onsuccess', { set(callback) { success = callback; }, get() { return event => {
      const db = request.result, transact = db.transaction.bind(db);
      db.transaction = (names, mode) => {
        assert.deepEqual(names, ['drafts']);
        const tx = transact(names, mode), observed = { completed: false, mode }; transactions.push(observed);
        let complete;
        Object.defineProperty(tx, 'oncomplete', { set(callback) { complete = callback; },
          get() { return event => { observed.completed = true; complete?.(event); }; } });
        return tx;
      };
      success?.(event);
    }; } });
    return request;
  } };
}
const revision = '184467440737095516290000000000000000007';
const original = encode('{\r\n "recordType":"place", "id":"generated-room", "revision":' + revision + ', "label":"Kitchen 🧭"\r\n}\n');
const aggregate = encode('{"records":[' + new TextDecoder().decode(original) + ']}');
const manifest = encode('{\r\n "profile":"generated.retained-draft-panel.v1", "resource":"' + hash(aggregate) + '"\r\n}\n');
const resource = { id: 'generated-atlas-records', role: 'atlas/data', label: 'Generated records',
  sha256: hash(aggregate), bytes: aggregate.byteLength, contentType: 'application/json',
  record: { recordType: 'place', recordId: 'generated-room', revision } };
const house = { version: 1, localRevision: '00000000-0000-4000-8000-000000000703',
  scope: { workspaceId: '00000000-0000-4000-8000-000000000701', homeId: '00000000-0000-4000-8000-000000000702' },
  key: '00000000-0000-4000-8000-000000000701/00000000-0000-4000-8000-000000000702',
  snapshotId: 'e'.repeat(64), label: 'Generated retained copy', capturedAt: '2026-10-22T00:00:00Z',
  shellBuildId: 'f'.repeat(64), resources: [resource], manifest };
h.validateSavedHouse(house);
function input(copy = house, id = 'generated-room', base = { bytes: original, sha256: hash(original), revision }) {
  return { scope: clone(copy.scope), savedKey: copy.key, snapshotId: copy.snapshotId, localRevision: copy.localRevision,
    selectedResource: clone(resource), recordIdentity: { recordType: 'place', recordId: id },
    manifest: { bytes: copy.manifest.slice(0), sha256: hash(copy.manifest) }, original: clone(base) };
}
function selection(copy = house) {
  const lifetime = new AbortController();
  return { house: clone(copy), signal: lifetime.signal, isCurrent: () => !lifetime.signal.aborted };
}
const rows = () => syntheticRecords(disk, h.LOCAL_EDIT_RETENTION_DATABASE, 'drafts');
const partition = 'generated-explicit-local-space-a';
let store = h.createLocalEditRetentionStore(partition, observedFactory());
const otherStore = h.createLocalEditRetentionStore('generated-explicit-local-space-b', observedFactory());
let currentSelection = selection(), adapter = h.createSavedLocalEditAdapter(currentSelection, partition, store);
let observations = [], disconnect;
function observe() {
  observations = [];
  disconnect = adapter.subscribe(() => observations.push({ state: adapter.getSnapshot(), complete: transactions.every(tx => tx.completed) }));
}
function render(selected = currentSelection, port = adapter) {
  return renderToStaticMarkup(createElement(h.LocalEditPanel, { selection: selected, ...(port === null ? {} : { adapter: port }) }));
}
async function finish(action, reads, writes = 0) {
  const count = transactions.length, commits = disk.commits;
  const result = await action();
  assert.equal(transactions.length, count + reads + writes); assert.equal(disk.commits, commits + writes);
  assert(transactions.slice(count).every(tx => tx.completed));
  for (const item of observations) if (item.state.status === 'ready' || item.state.status === 'listed') assert(item.complete);
  return result;
}
function exact(draft) { assert.deepEqual(draft.original, input().original); assert.deepEqual(draft.manifest, input().manifest); }
try {
  const choice = render(currentSelection, null);
  assert(choice.includes('Local draft space')); assert(choice.includes('Open local draft space'));
  assert(choice.includes('Local only / not submitted')); assert(!choice.includes('Save local proposal'));
  assert.equal(disk.databases.size, 0, 'Rendering/adapter construction has no automatic storage reads');
  assert.equal(typeof adapter.retain, 'function');
  assert.equal(adapter.getSnapshot().canRetain, false);
  assert.deepEqual(adapter.getSnapshot().candidates, []);
  const stable = adapter.getSnapshot(); assert.equal(adapter.getSnapshot(), stable); assert(Object.isFrozen(stable));

  // Test-only setup seeds pre-existing rows through the actual production store.
  const seeded = await store.retain(input()); exact(seeded);
  const missing = input(house, 'generated-missing', { bytes: null, sha256: null, revision: null });
  await store.retain(missing);
  const inventoryResource = { ...clone(resource), id: 'generated-inventory', role: 'inventory/data' };
  const inventoryHouse = { ...clone(house), resources: [...house.resources, inventoryResource] };
  const inventoryInput = { ...input(inventoryHouse, 'generated-inventory-record'), selectedResource: inventoryResource };
  await store.retain(inventoryInput);
  // The bound house explicitly contains each selected exact resource descriptor.
  adapter.dispose(); currentSelection = selection(inventoryHouse);
  adapter = h.createSavedLocalEditAdapter(currentSelection, partition, store); observe();
  const baseline = rows(); await finish(() => adapter.list(), 1);
  assert.deepEqual(rows(), baseline); assert.equal(adapter.getSnapshot().summaries.length, 3);
  assert(render().includes('generated-room')); assert(render().includes(house.localRevision));
  const key = adapter.getSnapshot().summaries.find(row => row.recordId === 'generated-room').key;
  const opened = await finish(() => adapter.open(key), 1); exact(opened.draft);
  assert.equal(opened.completion, 'verified'); assert.equal(opened.published, true);
  assert.equal(adapter.getSnapshot().detail.originalText, new TextDecoder().decode(original));
  const html = render(); assert(html.includes('Retained original JSON')); assert(html.includes('Local proposal JSON'));
  assert(html.includes('Save local proposal')); assert(html.includes(revision));
  assert(!html.includes('<a ')); assert.notEqual(hash(original), resource.sha256);
  const proposed = '{\n "label":"Proposed dining room 🧭", "revision":' + revision + '\n}\n';
  const saved = await finish(() => adapter.saveProposal(proposed), 0, 1); exact(saved.draft);
  assert.equal(saved.action, 'set-proposal'); assert.equal(saved.completion, 'verified');
  assert.deepEqual(saved.draft.proposal.bytes, encode(proposed));
  assert(render().includes('Local proposal saved; not submitted.'));
  new Uint8Array(saved.draft.original.bytes).fill(0); new Uint8Array(saved.draft.proposal.bytes).fill(0);
  assert.equal(adapter.getSnapshot().detail.proposalText, proposed);
  assert(Object.isFrozen(adapter.getSnapshot().detail));
  exact((await finish(() => adapter.read(), 1)).draft);
  console.log('PASS actual store/controller/adapter: exact selected-copy binding, stable detached snapshots, serial local proposal and actual panel SSR');

  const unrelatedHouse = { ...clone(inventoryHouse), scope: { ...house.scope, homeId: '00000000-0000-4000-8000-000000000704' },
    key: house.scope.workspaceId + '/00000000-0000-4000-8000-000000000704' };
  await store.retain(input(unrelatedHouse));
  const otherSnapshot = { ...clone(inventoryHouse), snapshotId: 'a'.repeat(64), localRevision: '00000000-0000-4000-8000-000000000705' };
  await store.retain(input(otherSnapshot));
  await otherStore.retain(input(inventoryHouse));
  const independent = h.createSavedLocalEditAdapter(selection(inventoryHouse), 'generated-explicit-local-space-b', otherStore);
  await finish(() => independent.list(), 1);
  assert.equal(independent.getSnapshot().summaries.length, 1); independent.dispose();
  const emptyHouse = { ...clone(inventoryHouse), snapshotId: 'b'.repeat(64) };
  const emptySelection = selection(emptyHouse), empty = h.createSavedLocalEditAdapter(emptySelection, partition, store);
  const beforeEmpty = rows(); await finish(() => empty.list(), 1);
  assert.deepEqual(empty.getSnapshot().summaries, []); assert.deepEqual(rows(), beforeEmpty);
  assert(render(emptySelection, empty).includes('No existing local drafts')); empty.dispose();

  // Completed-allocation Close/reopen only; no pending retirement or overlap.
  adapter.closeDetail(); assert.equal(adapter.getSnapshot().detail, null);
  disconnect(); adapter.dispose(); await store.close();
  store = h.createLocalEditRetentionStore(partition, observedFactory());
  currentSelection = selection(inventoryHouse); adapter = h.createSavedLocalEditAdapter(currentSelection, partition, store); observe();
  await finish(() => adapter.list(), 1);
  const reopened = await finish(() => adapter.open(key), 1); exact(reopened.draft);
  assert.deepEqual(reopened.draft.proposal.bytes, encode(proposed));
  const reset = await finish(() => adapter.resetProposal(), 0, 1); exact(reset.draft); assert.equal(reset.draft.proposal, null);
  assert.equal(adapter.getSnapshot().detail.proposalText, null);
  const replacement = '{"label":"Kitchen again"}\r\n';
  exact((await finish(() => adapter.saveProposal(replacement), 0, 1)).draft);
  console.log('PASS serial local space/home/snapshot isolation, empty read-only list, completed Close/reopen and reversible reset');

  const missingKey = adapter.getSnapshot().summaries.find(row => row.recordId === 'generated-missing').key;
  const unavailable = await finish(() => adapter.open(missingKey), 1);
  assert.deepEqual(unavailable.draft.original, missing.original);
  assert.equal(adapter.getSnapshot().detail.canEdit, false);
  assert(render().includes('Exact original bytes, hash or revision are unavailable.'));
  assert(!render().includes('Save local proposal'));
  const inventoryKey = adapter.getSnapshot().summaries.find(row => row.recordId === 'generated-inventory-record').key;
  await finish(() => adapter.open(inventoryKey), 1);
  assert.equal(adapter.getSnapshot().detail.canEdit, false); assert(render().includes('Saved inventory remains read-only.'));
  assert(!render().includes('Save local proposal'));
  console.log('PASS actual panel SSR: nullable original evidence stays unavailable; saved inventory remains read-only');

  await finish(() => adapter.open(key), 1);
  const beforeDiscard = rows(), removed = beforeDiscard.find(row => row.draft.localPartitionId === partition
    && row.draft.recordIdentity.recordId === 'generated-room' && row.draft.snapshotId === house.snapshotId
    && row.draft.savedKey === house.key);
  assert(removed);
  const discarded = await finish(() => adapter.discard(), 1, 1);
  assert.equal(discarded.action, 'discard'); assert.equal(discarded.completion, 'verified'); assert.equal(discarded.discarded, true);
  assert.deepEqual(rows(), beforeDiscard.filter(row => row.id !== removed.id));
  assert(render().includes('Local draft discarded; no native record changed.'));
  assert.equal(adapter.getSnapshot().detail, null);
  assert.deepEqual([...disk.databases.keys()], [h.LOCAL_EDIT_RETENTION_DATABASE]);
  console.log('PASS targeted local discard: exact original/revision retained through changes; all unrelated rows preserved');
  console.log(`PASS offline local edit mounting healthy: ${transactions.length} completed synthetic transactions plus actual panel React SSR. No browser/DOM events, pending retirement, stale completions, reentrancy, denial/fault/concurrency/replay or device durability qualification.`);
} finally {
  disconnect?.(); adapter.dispose(); await store.close(); await otherStore.close();
}
