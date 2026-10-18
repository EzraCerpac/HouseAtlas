// Named ordinary generated positive: actual production store, simulated IDB.
// Store-shaped records only; no parser/exporter qualification, browser-IDB/
// offline/native acceptance, listener, network or held controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const source = new URL('../src/offline/store.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(source, 'utf8'), source.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
const { createSavedHouseStore, savedHouseKey, validateSavedHouse, SAVED_RANGE_BYTES } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
const bytes = values => Uint8Array.from(values).buffer;
const turn = callback => setImmediate(callback);

// Minimal ordinary IDB API memory harness. Requests are queued asynchronous
// tasks, transactions are serialized, and writes reach durable maps atomically
// before oncomplete. This models only the production APIs used by these cases;
// it is deliberately not a browser IndexedDB implementation or dependency.
function simulatedIDB() {
  const durable = new Map(), transactions = [], waiting = [];
  let running = false, nextBoundary = null;
  const snapshot = () => Object.fromEntries([...durable].map(([name, rows]) =>
    [name, [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => [id,
      name === 'assets' ? { id: row.id, bytes: row.data.byteLength, sha256: digest(row.data) } : clone(row)])]));
  const launch = () => {
    if (running || !waiting.length) return;
    running = true; waiting.shift()();
  };
  const database = {
    objectStoreNames: { contains: name => durable.has(name) },
    createObjectStore(name, options) {
      assert.equal(options.keyPath, 'id'); assert(!durable.has(name)); durable.set(name, new Map());
    },
    close() {},
    transaction(names, mode) {
      assert(names.every(name => durable.has(name))); assert(['readonly', 'readwrite'].includes(mode));
      const log = { names: [...names], mode, operations: [], committed: false, completed: false };
      transactions.push(log);
      const boundary = nextBoundary; nextBoundary = null;
      const queue = []; let local, active = true, started = false, scheduled = false;
      const tx = {
        objectStore(name) {
          assert(names.includes(name));
          const request = (kind, id, value) => {
            assert(active, 'request must belong to an active transaction');
            assert(mode === 'readwrite' || kind === 'get' || kind === 'getAll');
            const result = {}; const copied = clone(value);
            log.operations.push({ name, kind, ...(id === undefined ? {} : { id }) });
            queue.push(() => {
              const rows = local.get(name);
              if (kind === 'get') result.result = clone(rows.get(id));
              if (kind === 'getAll') result.result = clone([...rows.values()]);
              if (kind === 'put') rows.set(copied.id, copied);
              if (kind === 'delete') rows.delete(id);
              if (kind === 'clear') rows.clear();
              result.onsuccess?.({ target: result });
            });
            schedule(); return result;
          };
          return { get: id => request('get', id), getAll: () => request('getAll'),
            put: value => request('put', value.id, value), delete: id => request('delete', id), clear: () => request('clear') };
        },
        abort() { assert.fail('No ordinary positive should abort a transaction'); },
      };
      const complete = () => {
        assert(log.committed); log.completed = true; tx.oncomplete?.(); running = false; launch();
      };
      const commit = () => {
        assert(active); active = false;
        if (mode === 'readwrite') for (const name of names) durable.set(name, local.get(name));
        log.committed = true;
        if (boundary) boundary.committed({ log, complete: () => turn(complete) });
        else turn(complete);
      };
      const pump = () => {
        scheduled = false;
        if (queue.length) { queue.shift()(); schedule(); }
        else if (boundary) boundary.drained({ log, commit: () => turn(commit) });
        else commit();
      };
      function schedule() { if (started && !scheduled) { scheduled = true; turn(pump); } }
      waiting.push(() => {
        local = new Map(names.map(name => [name, clone(durable.get(name))])); started = true; schedule();
      });
      turn(launch); return tx;
    },
  };
  return {
    factory: { open(name, version) {
      assert.equal(name, 'houseatlas-explicit-saved-houses-v1'); assert.equal(version, 1);
      const request = {};
      turn(() => { request.result = database;
        if (!durable.size) request.onupgradeneeded?.();
        turn(() => request.onsuccess?.());
      }); return request;
    } },
    transactions, snapshot,
    row: (name, id) => clone(durable.get(name)?.get(id)),
    observeNextCompletion() {
      assert.equal(nextBoundary, null);
      let drained, committed;
      const ready = new Promise(resolve => { drained = resolve; });
      const published = new Promise(resolve => { committed = resolve; });
      nextBoundary = { drained, committed }; return { ready, published };
    },
  };
}

/** @typedef {import('../src/offline/store.ts').SavedResource} SavedResource */
/** @typedef {import('../src/offline/store.ts').SavedHouse} SavedHouse */
function resource(id, data) {
  /** @type {SavedResource} */
  const pin = { id, role: 'generated', label: id, sha256: digest(data), bytes: data.byteLength, contentType: 'application/octet-stream' };
  return { pin, data };
}
const scope = { workspaceId: '00000000-0000-4000-8000-000000000810', homeId: '00000000-0000-4000-8000-000000000811' };
function house(label, resources, selectedScope = scope) {
  const manifest = new TextEncoder().encode(JSON.stringify({ profile: 'generated.saved-house-store-fixture.v1', label })).buffer;
  /** @type {Omit<SavedHouse, 'localRevision'>} */
  const input = { version: 1, key: savedHouseKey(selectedScope), scope: selectedScope,
    snapshotId: digest(Buffer.from(label)), label, capturedAt: '2026-10-18T00:00:00.000Z',
    shellBuildId: '1'.repeat(64), resources: resources.map(row => row.pin), manifest };
  return input;
}
const fullId = (stage, row) => `${stage.key}/${row.pin.sha256}`;
const rangeId = (stage, row, start = 0) => `${fullId(stage, row)}@${start}`;
const assertData = (harness, id, data) => assert.deepEqual(harness.row('assets', id)?.data, data);
async function withStore(run) {
  const harness = simulatedIDB(), store = createSavedHouseStore(harness.factory);
  let notices = 0; store.subscribe(() => notices++);
  try { await run(store, harness, () => notices); }
  finally { await store.close(); }
}
async function begin(store, input) {
  const stage = await store.begin(input); validateSavedHouse(stage); return stage;
}
async function commit(store, input, resources) {
  const stage = await begin(store, input);
  for (const row of resources) await store.put(stage, row.pin, row.data);
  return { stage, saved: await store.activate(stage) };
}
async function discard(store, harness, stage, expectChange) {
  const before = harness.snapshot(), count = harness.transactions.length, boundary = harness.observeNextCompletion();
  let resolved = false;
  const pending = store.discardStage(stage).then(() => { resolved = true; });
  const queued = await boundary.ready;
  assert.equal(resolved, false, 'request callbacks must not settle cleanup');
  assert.deepEqual(harness.snapshot(), before, 'queued deletes do not publish partial durable state');
  assert.equal(harness.transactions.length, count + 1, 'cleanup owns exactly one transaction');
  assert.deepEqual(queued.log.names, ['houses', 'stages', 'assets', 'control']);
  assert.equal(queued.log.mode, 'readwrite');
  queued.commit(); const published = await boundary.published;
  assert.equal(resolved, false, 'committed writes still await the actual oncomplete event');
  assert.equal(published.log.completed, false);
  if (expectChange) assert.notDeepEqual(harness.snapshot(), before);
  else assert.deepEqual(harness.snapshot(), before, 'obsolete cleanup is a durable no-op');
  assert(published.log.operations.every(op => op.kind !== 'put' && op.kind !== 'clear'));
  assert(published.log.operations.filter(op => op.kind === 'delete').every(op =>
    op.name === 'assets' || op.name === 'stages' && op.id === stage.key));
  published.complete(); await pending; assert.equal(published.log.completed, true);
}

await withStore(async (store, harness, notices) => {
  const full = resource('new-full', bytes([4, 5, 6]));
  const ranged = resource('new-range', new Uint8Array(SAVED_RANGE_BYTES + 3).fill(7).buffer);
  const stage = await begin(store, house('Canceled new Save', [full, ranged]));
  await store.put(stage, full.pin, full.data);
  await store.putRange(stage, ranged.pin, 0, ranged.data.slice(0, SAVED_RANGE_BYTES));
  await store.putRange(stage, ranged.pin, SAVED_RANGE_BYTES, ranged.data.slice(SAVED_RANGE_BYTES));
  assertData(harness, fullId(stage, full), full.data);
  assertData(harness, rangeId(stage, ranged), ranged.data.slice(0, SAVED_RANGE_BYTES));
  assertData(harness, rangeId(stage, ranged, SAVED_RANGE_BYTES), ranged.data.slice(SAVED_RANGE_BYTES));
  const control = harness.snapshot().control;
  await discard(store, harness, stage, true);
  assert.deepEqual(await store.list(), []); assert.deepEqual(harness.snapshot().stages, []);
  assert.deepEqual(harness.snapshot().assets, []); assert.deepEqual(harness.snapshot().control, control);
  assert.equal(notices(), 0);
  await discard(store, harness, stage, false);
  console.log('PASS 1 canceled new Save: full and both range chunks removed, no active copy, idempotent cleanup');
});

await withStore(async (store, harness, notices) => {
  const original = [resource('original-a', bytes([8, 9])), resource('original-b', bytes([10, 11, 12]))];
  const { saved } = await commit(store, house('Original committed copy', original), original);
  const baseline = harness.snapshot(), priorNotices = notices();
  const replacement = [resource('replacement-full', bytes([13, 14])), resource('replacement-range', bytes([15, 16]))];
  const stage = await begin(store, house('Canceled replacement', replacement));
  await store.put(stage, replacement[0].pin, replacement[0].data);
  await store.putRange(stage, replacement[1].pin, 0, replacement[1].data);
  await discard(store, harness, stage, true);
  assert.deepEqual(harness.snapshot(), baseline, 'all committed rows, revision, manifest and byte pins survive exactly');
  assert.deepEqual((await store.list())[0].localRevision, saved.localRevision);
  for (const row of original) assert.deepEqual(await (await store.asset(saved, row.pin.id)).arrayBuffer(), row.data);
  assert.equal(notices(), priorNotices);
  console.log('PASS 2 canceled replacement: exact original house/revision and every referenced byte preserved');
});

await withStore(async (store, harness, notices) => {
  const rows = [resource('activated', bytes([17, 18, 19]))];
  const { stage, saved } = await commit(store, house('Successful Save', rows), rows);
  const baseline = harness.snapshot(), priorNotices = notices();
  await discard(store, harness, stage, false);
  assert.deepEqual(harness.snapshot(), baseline); assert.equal(notices(), priorNotices);
  assert.equal((await store.list())[0].localRevision, saved.localRevision);
  assert.deepEqual(await (await store.asset(saved, rows[0].pin.id)).arrayBuffer(), rows[0].data);
  console.log('PASS 3 successful activation then late cleanup: committed copy and bytes unchanged');
});

await withStore(async (store, harness) => {
  const full = resource('retained-full', bytes([20, 21])), ranged = resource('retained-range', bytes([22, 23]));
  const first = await begin(store, house('First owned stage', [full, ranged]));
  await store.put(first, full.pin, full.data); await store.putRange(first, ranged.pin, 0, ranged.data);
  const second = await begin(store, house('Normal superseding stage', [full, ranged]));
  const baseline = harness.snapshot();
  assert.notEqual(second.token, first.token); assert.equal(second.epoch, first.epoch);
  await discard(store, harness, first, false);
  assert.deepEqual(harness.snapshot(), baseline); assert.equal(harness.row('stages', second.key).token, second.token);
  assert.deepEqual(await store.retained(second, full.pin), full.data);
  assert.deepEqual(await store.range(second, ranged.pin, 0), ranged.data);
  await discard(store, harness, second, true);
  assert.deepEqual(harness.snapshot().assets, []);
  console.log('PASS 4 normal second begin: obsolete handle preserves new stage and retained full/range bytes');
});

await withStore(async (store, harness, notices) => {
  const shared = resource('active-shared', bytes([24, 25, 26]));
  const { saved } = await commit(store, house('Active shared bytes', [shared]), [shared]);
  const baseline = harness.snapshot(), priorNotices = notices();
  const alias = { ...shared, pin: { ...shared.pin, id: 'replacement-alias', role: 'other-generated-role' } };
  const stage = await begin(store, house('Replacement shares digest', [alias]));
  assert.deepEqual(await store.retained(stage, alias.pin), shared.data);
  await store.putRange(stage, alias.pin, 0, alias.data);
  assertData(harness, fullId(stage, alias), shared.data); assertData(harness, rangeId(stage, alias), shared.data);
  await discard(store, harness, stage, true);
  assert.equal(harness.row('assets', rangeId(stage, alias)), undefined, 'uncommitted range is deleted despite active full digest');
  assert.deepEqual(harness.snapshot(), baseline); assert.equal(notices(), priorNotices);
  assert.deepEqual(await (await store.asset(saved, shared.pin.id)).arrayBuffer(), shared.data);
  console.log('PASS 5 shared same-digest active full bytes retained; pending range removed');
});
console.log('PASS simulated IDB/source qualification: five ordinary generated cases and transaction completion boundaries. Browser-IDB, actual Save/persisted reopen, genuine offline and native acceptance remain unestablished.');
