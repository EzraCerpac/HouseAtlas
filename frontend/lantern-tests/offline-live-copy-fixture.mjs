// Generated transactional-interface contracts; no real IndexedDB, transport or browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { setImmediate } from 'node:timers/promises';

export async function checkLiveCopyContracts() {
  const source = readFileSync(new URL('../src/offline/live-copy-owner.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source);
  assert(!/^\s*import(?:\s|['"])/m.test(code), 'actual owner has no runtime imports');
  const { createLiveCopyOwner, projectOfflineDisplay } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const cases = [], signal = () => new AbortController().signal;
  const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const scope = { workspaceId: uuid(1), homeId: uuid(2) };
  const hash = bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  function memory() {
    let data = new Map(['control', 'metadata', 'bytes'].map(k => [k, new Map()]));
    let tail = Promise.resolve(), nextFailure = null, failOnTransaction = 0, transactions = 0;
    return {
      data: () => data,
      fail(error, offset = 1) { nextFailure = error; failOnTransaction = transactions + offset; },
      transaction(write, work) {
        const run = tail.then(async () => {
          transactions++;
          const draft = structuredClone(data);
          const tx = {
            get: async (table, key) => structuredClone(draft.get(table).get(key)),
            list: async table => [...draft.get(table)].map(([key, value]) => ({ key, value: structuredClone(value) })),
            put: async (table, key, value) => { draft.get(table).set(key, structuredClone(value)); },
            remove: async (table, key) => { draft.get(table).delete(key); },
            empty: async table => { draft.get(table).clear(); },
          };
          const value = await work(tx);
          if (nextFailure && transactions === failOnTransaction) { const error = nextFailure; nextFailure = null; throw error; }
          if (write) data = draft;
          return value;
        });
        tail = run.catch(() => {}); return run;
      }, close() {},
    };
  }
  const view = {
    status: 'ready', scope, homeLabel: 'Generated home', now: '2026-01-01T00:00:00Z', canEdit: true, homes: [],
    sourceDocumentsService: { profile: 'houseatlas.geodata-document-read.v2', available: true },
    entries: [{
      ...scope, key: 'generated-entry', source: { sourceInstanceId: 'generated', collectionId: 'items', sourceKind: 'homebox-entity', externalId: 'one' },
      entity: { id: 'one', name: 'Generated item', description: '', entityType: null, parent: null, archived: false,
        quantity: '1.20', manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
      kind: 'item', semanticKind: 'unclassified', sourceState: 'present', cacheStatus: 'stale', sourceUpdatedAt: null,
      retrievedAt: '2026-01-01T00:00:00Z', aliases: [], mobility: 'unknown',
      attachments: [{ attachmentId: 'file', title: 'Generated', kind: 'stored-file', contentType: 'application/pdf', byteSize: '3',
        downloadHref: 'https://generated.example/issued', previewHref: 'https://generated.example/preview' }],
      maintenance: [], nativeLinks: [{ href: 'https://generated.example/native', verifiedRoute: true }], networkBound: false, networkStates: [], networkRelations: [],
    }], caches: [],
  };
  const projected = projectOfflineDisplay(view), text = JSON.stringify(projected);
  for (const forbidden of ['canEdit', 'sourceDocumentsService', 'nativeLinks', 'downloadHref', 'previewHref', 'https://'])
    assert(!text.includes(forbidden), forbidden);
  assert.equal(projected.entries[0].entity.quantity, '1.20');
  cases.push('live-copy-explicit-display-allowlist');

  let peer;
  const backend = memory(), owner = createLiveCopyOwner(backend, { now: () => Date.parse(view.now), changed: () => peer?.refreshCopies() });
  const actor = await owner.observeActor('generated-actor-a', () => true); assert.equal(actor.status, 'ok');
  const home = owner.bindHome(actor.value, scope, () => true); assert.equal(home.status, 'ok');
  assert.equal((await owner.keepView(home.value, view, signal())).status, 'ok');
  let read = await owner.readLast(signal()); assert.equal(read.status, 'ok');
  assert.equal(read.value.snapshot.freshness, 'stale');
  assert.equal(read.value.snapshot.coverage.history, 'unavailable');
  assert.equal(read.value.snapshot.data.entries[0].entity.quantity, '1.20');
  assert.equal((await owner.keepView(read.value.handle, view, signal())).status, 'retired', 'stored token is not online authority');
  cases.push('live-copy-stale-roundtrip-and-no-authority');

  const bytes = Uint8Array.from([1, 2, 3]).buffer;
  const pin = { documentId: uuid(3), documentRevision: 1, assetId: uuid(4), assetRevision: 2,
    sha256: hash(bytes), bytes: 3, contentType: 'application/pdf' };
  const catalog = { version: 1, capturedAt: view.now, completeness: 'captured-complete', documents: [{
    documentId: pin.documentId, documentRevision: 1, assetId: pin.assetId, assetRevision: 2,
    sha256: pin.sha256, bytes: 3, title: 'Generated original', lifecycle: 'active', recordedAvailability: 'available',
  }] };
  assert.equal((await owner.keepCatalog(home.value, catalog, signal())).status, 'ok');
  assert.equal((await owner.keepDocument(home.value, pin, bytes, signal())).status, 'ok');
  assert.equal((await owner.readCatalog(read.value.handle, signal())).status, 'ok');
  assert.equal((await owner.documentStatus(read.value.handle, pin, signal())).value.availability, 'held');
  const held = await owner.readDocument(read.value.handle, pin, signal()); assert.equal(held.status, 'ok');
  assert.deepEqual([...new Uint8Array(await held.value.arrayBuffer())], [1, 2, 3]);
  assert.equal((await owner.readDocument(read.value.handle, { ...pin, documentRevision: 2 }, signal())).status, 'missing');
  const docKey = [...backend.data().get('metadata')].find(([, row]) => row.kind === 'document')[0];
  backend.data().get('bytes').set(docKey, Uint8Array.from([9, 2, 3]).buffer);
  assert.equal((await owner.readDocument(read.value.handle, pin, signal())).status, 'integrity');
  assert.equal((await owner.documentStatus(read.value.handle, pin, signal())).value.availability, 'failed-integrity');
  assert.equal((await owner.keepDocument(home.value, pin, Uint8Array.from([9, 2, 3]).buffer, signal())).status, 'integrity');
  assert.equal((await owner.keepDocument(home.value, { ...pin, issuedUrl: 'not-retainable' }, bytes, signal())).status, 'invalid');
  cases.push('live-copy-exact-catalog-pin-and-byte-integrity');

  const other = owner.bindHome(actor.value, { ...scope, homeId: uuid(5) }, () => true);
  assert.equal((await owner.keepView(other.value, { ...view, scope: { ...scope, homeId: uuid(5) }, entries: [] }, signal())).status, 'ok');
  const otherRead = await owner.readLast(signal()); assert.equal(otherRead.status, 'ok');
  assert.equal((await owner.readDocument(otherRead.value.handle, pin, signal())).status, 'missing');
  const switched = await owner.observeActor('generated-actor-b', () => true); assert.equal(switched.status, 'ok');
  assert.equal((await owner.keepView(home.value, view, signal())).status, 'retired');
  assert.equal((await owner.readDocument(read.value.handle, pin, signal())).status, 'retired');
  const returned = await owner.observeActor('generated-actor-a', () => true); assert.equal(returned.status, 'ok');
  assert.equal((await owner.readLast(signal())).status, 'missing', 'A-B-A does not restore old history');
  cases.push('live-copy-home-and-account-revision-fences');

  const returnedHome = owner.bindHome(returned.value, scope, () => true);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await owner.keepView(returnedHome.value, view, cancelled.signal)).status, 'aborted');
  let current = true;
  const withdrawal = owner.bindHome(returned.value, scope, () => current);
  const pending = owner.keepView(withdrawal.value, view, signal()); current = false;
  assert.equal((await pending).status, 'retired');
  cases.push('live-copy-cancelled-and-withdrawn-writes');

  assert.equal((await owner.keepView(returnedHome.value, view, signal())).status, 'ok');
  peer = createLiveCopyOwner(backend);
  const peerRead = await peer.readLast(signal()); assert.equal(peerRead.status, 'ok');
  let peerVisible = true, peerNotices = 0;
  peer.subscribe(() => { peerVisible = false; peerNotices++; });
  backend.fail(new Error('generated deletion failure'), 2);
  assert.equal((await owner.clear()).status, 'unavailable');
  assert(backend.data().get('metadata').size > 0, 'failed deletion was not reported as removal');
  assert.equal(peerVisible, false, 'visible second owner withdraws on durable tombstone, not successful cleanup');
  assert.equal(peerNotices, 1, 'retirement notice is sent before failed deletion');
  assert.equal((await peer.readCatalog(peerRead.value.handle, signal())).status, 'retired');
  cases.push('live-copy-cross-tab-tombstone-notice-before-cleanup-failure');
  const reopened = createLiveCopyOwner(backend);
  assert.equal((await reopened.readLast(signal())).status, 'missing', 'committed tombstone prevents reload exposure');
  assert.equal((await owner.keepView(returnedHome.value, view, signal())).status, 'retired');
  assert.equal((await reopened.clear()).status, 'ok');
  assert.equal(backend.data().get('metadata').size, 0);
  cases.push('live-copy-wipe-tombstone-and-deletion-error');

  const quotaStore = memory(), quotaOwner = createLiveCopyOwner(quotaStore);
  const qa = await quotaOwner.observeActor('quota-actor', () => true);
  const qh = quotaOwner.bindHome(qa.value, scope, () => true);
  const quotaError = new Error('generated quota'); quotaError.name = 'QuotaExceededError';
  quotaStore.fail(quotaError);
  assert.equal((await quotaOwner.keepView(qh.value, view, signal())).status, 'quota');
  assert.equal((await quotaOwner.readLast(signal())).status, 'missing', 'failed transaction publishes no pointer');
  cases.push('live-copy-acknowledged-quota-and-atomic-failure');

  let persistenceCalls = 0;
  const persistenceOwner = createLiveCopyOwner(memory(), { storage: {
    estimate: async () => ({ usage: 123, quota: 456 }), persisted: async () => false,
    persist: async () => { persistenceCalls++; return false; },
  } });
  assert.equal((await persistenceOwner.status(signal())).value.persistence, 'not-granted');
  assert.equal(persistenceCalls, 0, 'status never asks permission');
  assert.deepEqual(await persistenceOwner.requestPersistence(signal()), { status: 'ok', value: 'not-granted' });
  assert.equal(persistenceCalls, 1);
  assert.equal((await createLiveCopyOwner(memory()).status(signal())).value.persistence, 'unsupported');
  cases.push('live-copy-explicit-persistence-outcomes');

  const small = createLiveCopyOwner(memory(), { limits: { rows: 3, documents: 2, bytes: 65536 } });
  assert.equal((await small.status(signal())).value.budgetBytes, 65536, 'status reports the enforced configured bound');
  const sa = await small.observeActor('small-actor', () => true), sh = small.bindHome(sa.value, scope, () => true);
  const secondPin = { ...pin, documentId: uuid(6), assetId: uuid(7) };
  const secondCatalog = { ...catalog, documents: [...catalog.documents,
    { ...catalog.documents[0], documentId: secondPin.documentId, assetId: secondPin.assetId }] };
  assert.equal((await small.keepView(sh.value, view, signal())).status, 'ok');
  assert.equal((await small.keepCatalog(sh.value, secondCatalog, signal())).status, 'ok');
  assert.equal((await small.keepDocument(sh.value, pin, bytes, signal())).status, 'ok');
  const evicted = await small.keepDocument(sh.value, secondPin, bytes, signal());
  assert.equal(evicted.status, 'ok'); assert.equal(evicted.value.evicted, 1);
  const sr = await small.readLast(signal()); assert.equal(sr.status, 'ok');
  assert.equal((await small.readDocument(sr.value.handle, pin, signal())).status, 'missing');
  assert.equal((await small.readDocument(sr.value.handle, secondPin, signal())).status, 'ok');
  cases.push('live-copy-bounded-lru-keeps-metadata-before-document-bytes');

  const backendSource = readFileSync(new URL('../src/offline/live-copy-indexeddb.ts', import.meta.url), 'utf8');
  const backendCode = stripTypeScriptTypes(backendSource);
  const { openLiveCopyBackend } = await import('data:text/javascript;base64,' + Buffer.from(backendCode).toString('base64'));
  const transactions = [], db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const tx = {
        objectStore() { return { get() {
          const request = { result: undefined };
          queueMicrotask(() => request.onsuccess?.()); return request;
        } }; },
        abort() { queueMicrotask(() => tx.onabort?.()); },
      };
      transactions.push(tx); return tx;
    },
  };
  const factory = { open() { const request = { result: db };
    queueMicrotask(() => request.onsuccess?.()); return request; } };
  const actualBackend = openLiveCopyBackend(factory); let settled = false;
  const acknowledged = actualBackend.transaction(false, tx => tx.get('control', 'witness')).then(() => { settled = true; });
  await setImmediate(); assert.equal(settled, false, 'request/callback success is not commit');
  transactions[0].oncomplete(); await acknowledged; assert.equal(settled, true);
  const aborted = actualBackend.transaction(false, tx => tx.get('control', 'witness'));
  await setImmediate(); transactions[1].error = new Error('generated abort'); transactions[1].onabort();
  await assert.rejects(aborted, /generated abort/); actualBackend.close();
  let opening, lateClosed = false;
  const late = openLiveCopyBackend({ open() { opening = { result: { close() { lateClosed = true; } } }; return opening; } });
  const lateRead = late.transaction(false, async () => null); late.close(); opening.onsuccess();
  await assert.rejects(lateRead, /closed/); assert.equal(lateClosed, true);
  cases.push('live-copy-actual-backend-completion-abort-and-late-close-interface');
  const timerCallbacks = new Map(); let nextTimer = 0;
  const fakeTimers = { set(callback, milliseconds) { assert.equal(milliseconds, 10000); const id = ++nextTimer; timerCallbacks.set(id, callback); return id; },
    clear(id) { timerCallbacks.delete(id); } };
  const timedBackend = openLiveCopyBackend(factory, fakeTimers), observedSettlements = [];
  const uncertain = timedBackend.transaction(true, tx => tx.get('control', 'witness'));
  void uncertain.then(() => observedSettlements.push('success'), error => observedSettlements.push(error.name));
  await setImmediate();
  const timedTx = transactions.at(-1); timedTx.abort = () => { throw new Error('generated already committing'); };
  assert.equal(timerCallbacks.size, 1);
  [...timerCallbacks.values()][0]();
  await assert.rejects(uncertain, error => error.name === 'OfflineCommitUnknown');
  timedTx.oncomplete(); await setImmediate();
  assert.deepEqual(observedSettlements, ['OfflineCommitUnknown'], 'late completion cannot turn timeout into success');
  assert.equal(timerCallbacks.size, 0); timedBackend.close();
  cases.push('live-copy-backend-timeout-late-completion-stays-uncertain');


  const adapterSource = readFileSync(new URL('../integration/live-copy-retention.ts', import.meta.url), 'utf8');
  const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const adapterCode = stripTypeScriptTypes(adapterSource)
    .replace(/(['"])\.\.\/src\/offline\/live-copy-owner\1/g, JSON.stringify(dataModule(code)))
    .replace(/(['"])\.\.\/src\/offline\/live-copy-indexeddb\1/g, JSON.stringify(dataModule(backendCode)));
  assert(!adapterCode.includes("from '../") && !adapterCode.includes('from "../'), 'all actual adapter imports are resolved to the actual modules');
  const { createLiveCopyRetention } = await import(dataModule(adapterCode));
  const session = { actorId: 'generated-reader-actor', csrfToken: 'never-retained', expiresAt: '2099-01-01T00:00:00Z' };
  const state = { session, view }; let withdrawDuringBytes = false, releases = 0;
  const nativeRow = { scope, documentId: pin.documentId, revision: pin.documentRevision, title: 'Generated original',
    lifecycle: 'active', original: { assetId: pin.assetId, revision: pin.assetRevision, sha256: pin.sha256, bytes: pin.bytes },
    availability: { original: 'available' } };
  const adapterStore = memory();
  const retention = createLiveCopyRetention({
    factory: undefined, backend: adapterStore, state: () => state,
    atlasReference: async identity => { assert.equal(identity.actorId, session.actorId); return { version: 1, scope,
      publicationId: 'generated-publication', manifestSha256: 'a'.repeat(64), atlasActorRevision: 'generated-atlas-witness' }; },
    documents: () => ({
      async createReader() {
        const identity = {}, lease = {}; let disposed = false;
        const frame = { lease, documentId: pin.documentId, documentRevision: pin.documentRevision, mode: 'original',
          asset: nativeRow.original, measuredContentType: pin.contentType };
        return {
          owner: () => disposed ? null : identity,
          async list() { return { documents: [nativeRow], nextCursor: null }; },
          async get() { return nativeRow; }, async openOriginal() { return frame; },
          isCurrent: selected => !disposed && selected === frame,
          getBlob: () => ({ async arrayBuffer() { if (withdrawDuringBytes) state.session = null; return bytes; } }),
          release() { releases++; }, dispose() { disposed = true; },
        };
      },
    }),
  });
  assert.equal((await retention.observe(session, () => state.session === session)).status, 'ok');
  assert.equal((await retention.capture(view, signal())).status, 'ok');
  assert.equal((await retention.retainCatalog(signal())).status, 'ok');
  assert.equal((await retention.retainDocument(pin.documentId, pin.documentRevision, signal())).status, 'ok');
  const ar = await retention.read.readLast(signal()); assert.equal(ar.status, 'ok');
  const atlasRef = await retention.read.atlasReference(ar.value.handle, signal()); assert.equal(atlasRef.status, 'ok');
  assert.equal(atlasRef.value.atlasActorRevision, 'generated-atlas-witness');
  assert.equal((await retention.read.readDocument(ar.value.handle, pin, signal())).status, 'ok');
  assert(!JSON.stringify([...adapterStore.data().get('metadata')]).includes('lease'));
  withdrawDuringBytes = true;
  assert.equal((await retention.retainDocument(pin.documentId, pin.documentRevision, signal())).status, 'retired');
  assert.equal(releases, 2, 'every acquired native frame is released');
  assert.equal((await retention.storage.clear()).status, 'ok'); retention.close();
  cases.push('live-copy-actual-adapter-reader-pins-and-withdrawal');
  return cases;
}
