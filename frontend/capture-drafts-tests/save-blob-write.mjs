import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createCaptureDrafts } from '../src/capture-drafts/controller.ts';
import { validateRows } from '../src/capture-drafts/validation.ts';

// Synthetic Files and an in-memory store whose `change` is one transaction per call: a failure injected after the
// edit discards it, as an aborted IndexedDB transaction does. No browser, real IndexedDB or network.
const uuid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const workspaceId = uuid('1'), homeId = uuid('2');
const bytes = new Uint8Array([72, 65, 1, 254, 7]);
const boundary = { actorId: 'synthetic-actor', workspaceId, homeId, sessionEpoch: {} };
const blobFailure = () => new DOMException('Failed to write blobs (Error)', 'DataError');

function earlier() {
  const body = 'Earlier draft';
  return { format: 'houseatlas-local-capture-draft/1', id: uuid('3'), owner: { actorId: boundary.actorId, workspaceId, homeId },
    targetSourceRef: null, recordId: uuid('5'), original: new Blob([body], { type: 'text/plain' }), contentType: 'text/plain', lastModified: 42,
    sha256: '0'.repeat(64),
    capture: { schemaVersion: 1, selectionMethod: 'file-picker', selectedAt: '2026-10-30T12:00:00.000Z', filename: 'earlier.txt', reportedContentType: 'text/plain', byteOrigin: 'browser-returned-unmodified' },
    form: { statement: 'Synthetic statement', reason: 'Synthetic test', sourceLicense: { status: 'unknown', reference: null } },
    createdAt: '2026-10-30T12:00:00.000Z', expiresAt: '2026-11-06T12:00:00.000Z', state: 'unsent', attempt: null };
}
function fixture(failures) {
  let rows = [earlier()], attempts = 0; const staged = [];
  const store = {
    async read() { return structuredClone(rows); },
    async change(edit) {
      attempts++; const result = edit(rows); staged.push(result.rows);
      if (failures.length) throw failures.shift();
      rows = [...result.rows]; return result.value;
    },
    close() {},
  };
  const drafts = createCaptureDrafts(store, { current: () => boundary, foreground: () => true, placeTarget: {} });
  const file = new File([bytes], 'picked.txt', { type: 'text/plain', lastModified: 43 });
  const save = () => drafts.save({ localId: uuid('8'), optedIn: true, recordId: uuid('5'), targetSourceRef: null,
    selection: { original: file, file, capture: { schemaVersion: 1, selectionMethod: 'file-picker', selectedAt: '2026-10-30T12:00:00.000Z',
      filename: 'picked.txt', reportedContentType: 'text/plain', byteOrigin: 'browser-returned-unmodified' } },
    form: { statement: 'Synthetic statement', reason: 'Synthetic test', sourceLicense: { status: 'unknown', reference: null } } });
  return { file, save, rows: () => rows, attempts: () => attempts, staged };
}

it('healthy-blob-write-retry-once', async () => {
  const f = fixture([blobFailure()]);
  assert.equal(await f.save(), uuid('8'));
  assert.equal(f.attempts(), 2, 'One fresh transaction after the abort');
  assert.equal(f.rows().length, 2); assert.equal(f.rows().filter(row => row.id === uuid('8')).length, 1);
  assert.equal(f.staged[0][1].original, f.staged[1][1].original, 'The retry stores the same Blob');
  validateRows(f.rows());
});

it('blob-write-twice-reports-specific-failure', async () => {
  const f = fixture([blobFailure(), blobFailure()]);
  await assert.rejects(f.save(), error => error.name === 'DraftWriteError' && /could not be stored/.test(error.message));
  assert.equal(f.attempts(), 2, 'One bounded retry only');
  assert.deepEqual(f.rows().map(row => row.id), [uuid('3')]);
  assert.equal(await f.rows()[0].original.text(), 'Earlier draft');
});

it('other-store-failures-are-not-retried', async () => {
  const quota = new DOMException('Synthetic quota', 'QuotaExceededError');
  const f = fixture([quota]);
  await assert.rejects(f.save(), error => error === quota);
  assert.equal(f.attempts(), 1); assert.deepEqual(f.rows().map(row => row.id), [uuid('3')]);
});

it('stored-original-is-a-fresh-blob-not-the-picked-file', async () => {
  const f = fixture([]);
  await f.save();
  const stored = f.rows().find(row => row.id === uuid('8')).original;
  assert(stored instanceof Blob); assert(!(stored instanceof File)); assert.notEqual(stored, f.file);
  assert.equal(stored.type, 'text/plain'); assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
});
console.log('PASS draft save blob-write cases: synthetic in-memory store evidence only');
