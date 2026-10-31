import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { openDraftStore } from '../src/capture-drafts/indexeddb.ts';

// Unregistered, source-only assertions against the production store. This
// controlled IDB interface double establishes no real IndexedDB/crash behavior.
const original = 'Synthetic draft original';
const uuid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
function row() {
  const workspaceId = uuid('1'), homeId = uuid('2');
  return { format: 'houseatlas-local-capture-draft/1', id: uuid('3'), owner: { actorId: 'synthetic-actor', workspaceId, homeId },
    targetSourceRef: { workspaceId, homeId, key: { sourceInstanceId: uuid('4'), collectionId: 'synthetic-collection', sourceKind: 'homebox-entity', externalId: 'synthetic-place' } },
    recordId: uuid('5'), original: new Blob([original], { type: 'text/plain' }), contentType: 'text/plain', lastModified: 42,
    sha256: createHash('sha256').update(original).digest('hex'),
    capture: { schemaVersion: 1, selectionMethod: 'file-picker', selectedAt: '2026-10-30T12:00:00.000Z', filename: 'synthetic.txt', reportedContentType: 'text/plain', byteOrigin: 'browser-returned-unmodified' },
    form: { statement: 'Synthetic statement', reason: 'Synthetic test', sourceLicense: { status: 'unknown', reference: null } },
    createdAt: '2026-10-30T12:00:00.000Z', expiresAt: '2026-11-06T12:00:00.000Z', state: 'unsent', attempt: null };
}
function fixture(options = {}) {
  let rows = [row()];
  if (options.unknown) rows = mark(rows).rows;
  const transactions = [], calls = [], order = [];
  const database = {
    close() {},
    transaction(...args) {
      calls.push(args); order.push('transaction');
      if (options.rejectOptions && args[1] === 'readwrite') throw new TypeError('Synthetic unsupported transaction options');
      let staged = null, aborted = false;
      const request = { result: null, onsuccess: null };
      const tx = {
        oncomplete: null, onabort: null, onerror: null, error: null,
        abortCalls: 0, objectStoreCalls: 0, readCalls: 0, clearCalls: 0, putCalls: 0, durabilityReads: 0,
        get durability() {
          tx.durabilityReads++; order.push('durability');
          if (options.getterThrows) throw new TypeError('Synthetic unreadable durability');
          return Object.hasOwn(options, 'reported') ? options.reported : 'strict';
        },
        objectStore(name) {
          assert.equal(name, 'drafts'); tx.objectStoreCalls++; order.push('objectStore');
          if (options.objectStoreThrows) throw new Error('Synthetic object-store failure');
          return {
            getAll(query, count) { assert.equal(query, undefined); assert.equal(count, 5); tx.readCalls++; return request; },
            clear() { tx.clearCalls++; staged = []; order.push('clear'); },
            put(value) { tx.putCalls++; staged.push(structuredClone(value)); order.push('put'); },
          };
        },
        abort() {
          tx.abortCalls++;
          tx.abortHadHandlers = !!tx.oncomplete && !!tx.onabort && !!tx.onerror;
          if (options.abortThrows) throw new Error('Synthetic abort unavailable');
          if (options.ignoreAbort) return;
          aborted = true; queueMicrotask(() => tx.onabort?.());
        },
        succeedRead() { request.result = structuredClone(rows); request.onsuccess?.(); },
        complete() {
          if (!aborted && staged !== null) rows = structuredClone(staged);
          order.push('complete'); tx.oncomplete?.();
        },
      };
      transactions.push(tx); return tx;
    },
  };
  const factory = { open() {
    const request = { result: database, onsuccess: null };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } };
  return { store: openDraftStore(factory), transactions, calls, order, rows: () => structuredClone(rows) };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function mark(rows) {
  return { rows: rows.map(value => ({ ...value, state: 'outcome-unknown', attempt: {
    requestId: uuid('6'), idempotencyKey: uuid('7'), startedAt: '2026-10-30T12:01:00.000Z',
  } })), value: 'synthetic-marker-complete' };
}

it('strict write requests and reported capability precede access; only transaction completion releases the result', async () => {
  const f = fixture(); let effects = 0;
  try {
    const pending = f.store.change(mark).then(value => { effects++; f.order.push('effect'); return value; });
    await flush(); const tx = f.transactions[0];
    assert.deepEqual(f.calls, [['drafts', 'readwrite', { durability: 'strict' }]]);
    assert.deepEqual(f.order.slice(0, 3), ['transaction', 'durability', 'objectStore']);
    tx.succeedRead(); await flush();
    assert.equal(effects, 0, 'Request success is not the handoff barrier');
    assert.equal(f.rows()[0].state, 'unsent', 'The double has not committed yet');
    assert.equal(tx.clearCalls, 1); assert.equal(tx.putCalls, 1);
    tx.complete(); assert.equal(await pending, 'synthetic-marker-complete');
    assert.equal(effects, 1); assert(f.order.indexOf('complete') < f.order.indexOf('effect'));
    const saved = f.rows()[0]; assert.equal(saved.state, 'outcome-unknown');
    assert.equal(saved.attempt.requestId, uuid('6')); assert.equal(saved.attempt.idempotencyKey, uuid('7'));
    assert.equal(await saved.original.text(), original); assert.equal(saved.sha256, row().sha256);
  } finally { f.store.close(); }
});

it('unsupported strict writes reject before requests, edits or writes, without a relaxed retry or successful late completion', async () => {
  const variants = [
    { rejectOptions: true }, { reported: undefined }, { reported: 'default' }, { reported: 'relaxed' },
    { getterThrows: true }, { reported: 'default', abortThrows: true }, { reported: 'relaxed', ignoreAbort: true },
    { reported: undefined, unknown: true },
  ];
  for (const options of variants) {
    const f = fixture(options); let edits = 0, effects = 0;
    try {
      const before = f.rows()[0];
      const pending = f.store.change(rows => { edits++; return mark(rows); }).then(() => { effects++; });
      const rejected = assert.rejects(pending, /strict durability is unavailable/);
      await flush(); await rejected;
      assert.deepEqual(f.calls, [['drafts', 'readwrite', { durability: 'strict' }]], 'Exactly one transaction attempt');
      for (const tx of f.transactions) {
        assert.equal(tx.abortCalls, 1); assert.equal(tx.abortHadHandlers, true);
        assert.equal(tx.objectStoreCalls, 0); assert.equal(tx.readCalls, 0);
        assert.equal(tx.clearCalls, 0); assert.equal(tx.putCalls, 0);
        tx.complete(); // A broken/late terminal event cannot authorize an effect.
      }
      await flush(); assert.equal(edits, 0); assert.equal(effects, 0);
      const retained = f.rows()[0]; assert.equal(retained.state, before.state); assert.deepEqual(retained.attempt, before.attempt);
      assert.equal(await retained.original.text(), original); assert.equal(retained.sha256, before.sha256);
    } finally { f.store.close(); }
  }
});

it('readonly access stays available without strict capability and issues no write options', async () => {
  const f = fixture({ getterThrows: true });
  try {
    const refusal = assert.rejects(f.store.change(mark), /strict durability is unavailable/);
    await flush(); await refusal;
    const pending = f.store.read(); await flush(); const tx = f.transactions[1];
    assert.deepEqual(f.calls, [['drafts', 'readwrite', { durability: 'strict' }], ['drafts', 'readonly']]);
    assert.equal(tx.durabilityReads, 0);
    tx.succeedRead(); tx.complete(); const rows = await pending;
    assert.equal(await rows[0].original.text(), original); assert.equal(rows[0].state, 'unsent');
    assert.equal(tx.clearCalls, 0); assert.equal(tx.putCalls, 0);
  } finally { f.store.close(); }
});

it('an abort after request success releases no successful result or committed marker', async () => {
  const f = fixture(); let effects = 0;
  try {
    const pending = f.store.change(mark).then(() => { effects++; });
    const rejected = assert.rejects(pending, /transaction was not saved/);
    await flush(); const tx = f.transactions[0]; tx.succeedRead(); tx.abort(); await rejected;
    assert.equal(effects, 0); assert.equal(f.rows()[0].state, 'unsent');
    assert.equal(await f.rows()[0].original.text(), original);
  } finally { f.store.close(); }
});

it('setup failure settles even if abort throws, without issuing requests or writes', async () => {
  const f = fixture({ objectStoreThrows: true, abortThrows: true }); let edits = 0;
  try {
    const pending = f.store.change(rows => { edits++; return mark(rows); });
    const rejected = assert.rejects(pending, /Synthetic object-store failure/);
    await flush(); await rejected; const tx = f.transactions[0];
    assert.equal(tx.abortHadHandlers, true); assert.equal(tx.abortCalls, 1);
    assert.equal(tx.readCalls, 0); assert.equal(tx.clearCalls, 0); assert.equal(tx.putCalls, 0); assert.equal(edits, 0);
    assert.equal(f.rows()[0].state, 'unsent');
  } finally { f.store.close(); }
});

it('a transaction error blocks subsequent read callbacks and cannot become a successful completion', async () => {
  const f = fixture(); let edits = 0, effects = 0;
  try {
    const pending = f.store.change(rows => { edits++; return mark(rows); }).then(() => { effects++; });
    const rejected = assert.rejects(pending, /Synthetic transaction failure/);
    await flush(); const tx = f.transactions[0]; tx.error = new Error('Synthetic transaction failure');
    tx.onerror(); tx.succeedRead(); tx.complete(); await rejected;
    assert.equal(edits, 0); assert.equal(effects, 0); assert.equal(tx.clearCalls, 0); assert.equal(tx.putCalls, 0);
    assert.equal(f.rows()[0].state, 'unsent');
  } finally { f.store.close(); }
});
