import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export async function checkOfflineLibraryPolicy() {
  const code = stripTypeScriptTypes(readFileSync(new URL('../integration/offline-library-policy.ts', import.meta.url), 'utf8'));
  const { fillOfflineLibrary } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  function fixture() {
    const calls = [], docs = [{ documentId: 'held', documentRevision: 1, lifecycle: 'active', bytes: 10, recordedAvailability: 'available' },
      { documentId: 'new', documentRevision: 2, lifecycle: 'active', bytes: 20, recordedAvailability: 'available' },
      { documentId: 'unavailable', documentRevision: 1, lifecycle: 'active', bytes: 30, recordedAvailability: 'unavailable' }];
    let revision = 'initial';
    const owner = { retainCatalog: async () => ({ status: 'ok', value: { documents: docs } }),
      storage: { status: async () => ({ status: 'ok', value: { budgetBytes: 100 } }) },
      read: { readElectricalCatalog: async () => ({ status: 'missing' }), readLast: async () => ({ status: 'ok', value: { handle: {}, snapshot: { snapshotRevision: revision } } }),
        documentStatus: async (_copy, row) => ({ status: 'ok', value: { availability: row.documentId === 'held' ? 'held' : 'not-held' } }) },
      retainDocument: async (id, rev) => { calls.push([id, rev]); return { status: 'ok' }; } };
    return { owner, docs, calls, replace() { revision = 'replaced'; } };
  }
  const cases = [], signal = () => new AbortController().signal;
  {
    const { owner, calls } = fixture();
    assert.equal(await fillOfflineLibrary(owner, signal()), '2 files on this device; 1 unavailable.');
    assert.deepEqual(calls, [['new', 2]]);
    cases.push('offline-library-policy-held-skip-and-exact-revision');
  }
  {
    const { owner, docs, calls } = fixture(); docs[1].bytes = 100;
    assert.match(await fillOfflineLibrary(owner, signal()), /exceed/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-budget-before-byte-reads');
    const mixed = fixture();
    mixed.owner.read.readElectricalCatalog = async () => ({ status: 'ok', value: { buildings: [{ documents: [{ pin: { byteSize: '30' } }] }] } });
    assert.match(await fillOfflineLibrary(mixed.owner, signal()), /exceed/);
    assert.deepEqual(mixed.calls, [], 'native 60 + electrical 30 refuses an 80-byte automatic limit before eviction');
    mixed.owner.read.readElectricalCatalog = async () => ({ status: 'unavailable' });
    assert.match(await fillOfflineLibrary(mixed.owner, signal()), /sizes could not be checked/);
    assert.deepEqual(mixed.calls, [], 'unknown electrical size does not admit native byte reads');

  }
  {
    const { owner, docs, calls } = fixture(); docs[0].documentId = 'first'; docs[2].recordedAvailability = 'available';
    owner.retainDocument = async id => { calls.push(id); return { status: 'uncertain' }; };
    let stopped = 0;
    assert.match(await fillOfflineLibrary(owner, signal(), () => true, () => { stopped++; }), /uncertain/); assert.deepEqual(calls, ['first']);
    assert.equal(stopped, 1, 'composed source scheduling stops after uncertain storage');
    cases.push('offline-library-policy-uncertain-stops-without-retry');
  }
  {
    const { owner, calls } = fixture(); let enabled = true;
    owner.read.documentStatus = async () => { enabled = false; return { status: 'ok', value: { availability: 'not-held' } }; };
    assert.match(await fillOfflineLibrary(owner, signal(), () => enabled), /stopped/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-preference-off-before-next-download');
  }
  {
    const { owner, calls, replace } = fixture(); let reads = 0;
    const read = owner.read.readLast;
    owner.read.readLast = async () => { if (++reads === 2) replace(); return read(); };
    assert.match(await fillOfflineLibrary(owner, signal()), /changed/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-snapshot-replacement-stops');
  }
  return cases;
}
