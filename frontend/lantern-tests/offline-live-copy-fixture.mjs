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
            async scan(table, maxRows, visit) {
              let count = 0;
              for (const key of [...draft.get(table).keys()].sort()) {
                if (++count > maxRows) throw Object.assign(Error('Generated scan capacity'), { name: 'OfflineResourceLimit' });
                await visit(key, structuredClone(draft.get(table).get(key)));
              }
            },
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
  assert.equal((await owner.readLast(signal())).status, 'retired', 'A-B-A does not restore old history');
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
  assert.equal((await reopened.readLast(signal())).status, 'retired', 'committed tombstone prevents reload exposure');
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
  assert.equal((await quotaOwner.readLast(signal())).status, 'retired', 'failed transaction publishes no pointer');
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
  let cursorRows = [], cursorValues = 0, cursorContinueError = null;
  const transactions = [], db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const tx = {
        objectStore() { return { openCursor() {
          const request = { result: null }; let index = 0;
          const deliver = () => queueMicrotask(() => {
            request.result = index >= cursorRows.length ? null : {
              key: cursorRows[index][0],
              get value() { cursorValues++; return cursorRows[index][1]; },
              continue() { if (cursorContinueError) throw cursorContinueError; index++; deliver(); },
            };
            request.onsuccess?.();
          });
          deliver(); return request;
        }, get() {
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
  const cursors = openLiveCopyBackend(factory), visited = [];
  cursorRows = [['a', { n: 1 }], ['b', { n: 2 }]]; cursorValues = 0;
  const ordered = cursors.transaction(false, async tx => {
    await tx.scan('metadata', 2, async (key, value) => { await tx.get('control', 'witness'); visited.push([key, value.n]); });
  });
  await setImmediate(); assert.deepEqual(visited, [['a', 1], ['b', 2]]); assert.equal(cursorValues, 2);
  transactions.at(-1).oncomplete(); await ordered;
  cursorRows = [['a', { n: 1 }], ['b', { n: 2 }], ['c', { oversized: 'generated-delivery' }]]; cursorValues = 0;
  await assert.rejects(cursors.transaction(false, tx => tx.scan('metadata', 2, () => {})), error => error.name === 'OfflineResourceLimit');
  assert.equal(cursorValues, 2, 'excess row value is not read/admitted; real browser delivery remains outside this guarantee');
  cursorRows = [['a', { n: 1 }]]; cursorContinueError = new Error('generated cursor continuation refusal');
  await assert.rejects(cursors.transaction(false, tx => tx.scan('metadata', 2, () => {})), /generated cursor continuation refusal/);
  cursorContinueError = null;
  cursors.close();
  cases.push('live-copy-actual-cursor-order-idb-await-and-admission-before-retention');
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
  // Generated local draft rows: only the first is bound to the held copy's actor, workspace and home.
  const draft = (actorId, owner, filename, state = 'unsent', expiresAt = '2099-01-01T00:00:00Z') => ({ owner: { actorId, ...owner },
    capture: { filename }, original: { size: filename.length }, state, expiresAt });
  const draftRows = [draft(session.actorId, scope, 'generated-held.txt'), draft('generated-other-actor', scope, 'generated-other-actor.txt'),
    draft(session.actorId, { ...scope, homeId: uuid(99) }, 'generated-other-home.txt'),
    draft(session.actorId, { ...scope, workspaceId: uuid(98) }, 'generated-other-workspace.txt'),
    draft(session.actorId, scope, 'generated-expired.txt', 'unsent', '2001-01-01T00:00:00Z'), draft(session.actorId, scope, 'generated-unknown.txt', 'outcome-unknown')];
  let draftReads = 0;
  const retention = createLiveCopyRetention({
    factory: undefined, backend: adapterStore, state: () => state,
    readDrafts: async () => { draftReads++; return structuredClone(draftRows); },
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
  const listed = await retention.heldDrafts(ar.value.handle, signal()); assert.equal(listed.status, 'ok');
  assert.deepEqual(listed.value, [{ filename: 'generated-held.txt', byteSize: 18, state: 'unsent', expired: false },
    { filename: 'generated-expired.txt', byteSize: 21, state: 'unsent', expired: true },
    { filename: 'generated-unknown.txt', byteSize: 21, state: 'outcome-unknown', expired: false }], 'only drafts bound to the held identity are listed');
  assert(!JSON.stringify(listed.value).includes('generated-other'), 'another actor, workspace or home lists nothing');
  assert.equal((await retention.storage.clear()).status, 'ok');
  const reads = draftReads;
  assert.notEqual((await retention.heldDrafts(ar.value.handle, signal())).status, 'ok', 'a cleared (tombstoned) copy lists no drafts');
  assert.notEqual((await retention.read.readLast(signal())).status, 'ok', 'no held identity remains to list drafts for');
  assert.equal(draftReads, reads, 'no draft read without a held identity');
  retention.close();
  cases.push('live-copy-actual-adapter-reader-pins-and-withdrawal');
  // A different actor observed online retires the previous copy: its handle lists nothing.
  const actorStore = memory(), sessionA = { ...session }, sessionB = { ...session, actorId: 'generated-other-actor' };
  const actorState = { session: sessionA, view };
  let duringRead = null;
  const switching = createLiveCopyRetention({ factory: undefined, backend: actorStore, state: () => actorState,
    readDrafts: async () => { const step = duringRead; duringRead = null; await step?.(); return structuredClone(draftRows); },
    documents: () => { throw new Error('Generated document trap'); } });
  assert.equal((await switching.observe(sessionA, () => actorState.session === sessionA)).status, 'ok');
  assert.equal((await switching.capture(view, signal())).status, 'ok');
  const first = await switching.read.readLast(signal()); assert.equal(first.status, 'ok');
  assert.equal((await switching.heldDrafts(first.value.handle, signal())).value.length, 3);
  // The identity is replaced while the draft rows are being read: the re-read drops the listing.
  duringRead = async () => { actorState.session = sessionB;
    assert.equal((await switching.observe(sessionB, () => actorState.session === sessionB)).status, 'ok'); };
  assert.notEqual((await switching.heldDrafts(first.value.handle, signal())).status, 'ok', 'an identity replaced during the read lists nothing');
  actorState.session = sessionA;
  assert.equal((await switching.observe(sessionA, () => actorState.session === sessionA)).status, 'ok');
  assert.equal((await switching.capture(view, signal())).status, 'ok');
  const again = await switching.read.readLast(signal()); assert.equal(again.status, 'ok');
  assert.equal((await switching.heldDrafts(again.value.handle, signal())).value.length, 3);
  // The copy is retired (cleared) while the rows are being read: nothing is listed.
  duringRead = async () => { assert.equal((await switching.storage.clear()).status, 'ok'); };
  assert.notEqual((await switching.heldDrafts(again.value.handle, signal())).status, 'ok', 'a copy retired during the read lists nothing');
  actorState.session = sessionA;
  assert.equal((await switching.observe(sessionA, () => actorState.session === sessionA)).status, 'ok');
  assert.equal((await switching.capture(view, signal())).status, 'ok');
  const third = await switching.read.readLast(signal()); assert.equal(third.status, 'ok');
  actorState.session = sessionB;
  assert.equal((await switching.observe(sessionB, () => actorState.session === sessionB)).status, 'ok');
  assert.notEqual((await switching.heldDrafts(third.value.handle, signal())).status, 'ok', 'a different actor retires the held listing');
  switching.close();
  cases.push('live-copy-held-drafts-identity-bound');

  // The production existing-only draft reader against a generated IndexedDB factory.
  const readerSource = readFileSync(new URL('../src/capture-drafts/read-existing.ts', import.meta.url), 'utf8');
  const readerCode = stripTypeScriptTypes(readerSource);
  assert(!/^\s*import(?:\s|['"])/m.test(readerCode), 'the existing-only reader has no runtime imports');
  const { readExistingStore } = await import(dataModule(readerCode));
  function generatedFactory({ leaveAbortedCreation = false, enumerate = true } = {}) {
    const dbs = new Map(), log = { opens: 0, live: 0, created: 0, upgradesCompleted: 0 };
    const state = { afterEnumerate: null, blockNext: false, versionChangeOnRead: false };
    const factory = {
      ...(enumerate ? { async databases() {
        const list = [...dbs].map(([name, db]) => ({ name, version: db.version }));
        const step = state.afterEnumerate; state.afterEnumerate = null; step?.(); return list;
      } } : {}),
      open(name) {
        log.opens++; const request = { transaction: null };
        setImmediate().then(() => {
          if (state.blockNext) { state.blockNext = false; request.onblocked?.(); }
          let db = dbs.get(name);
          if (!db) {
            db = { version: 0, stores: new Map() }; dbs.set(name, db); log.created++;
            let aborted = false; request.transaction = { abort() { aborted = true; } };
            request.onupgradeneeded?.({ oldVersion: 0, newVersion: 1 });
            if (aborted) { if (!leaveAbortedCreation) dbs.delete(name); request.error = new Error('Generated AbortError'); request.onerror?.(); return; }
            db.version = 1; log.upgradesCompleted++;
          }
          log.live++;
          const connection = { version: db.version, objectStoreNames: { contains: store => db.stores.has(store) }, closed: false,
            close() { if (!this.closed) { this.closed = true; log.live--; } },
            transaction(store) {
              const tx = {}, all = {};
              tx.objectStore = () => ({ getAll() {
                setImmediate().then(() => {
                  if (state.versionChangeOnRead) { connection.onversionchange?.(); tx.error = new Error('Generated closed'); tx.onabort?.(); return; }
                  all.result = structuredClone(db.stores.get(store)); tx.oncomplete?.();
                }); return all; } });
              return tx;
            } };
          request.result = connection; request.onsuccess?.();
        });
        return request;
      },
      deleteDatabase(name) { const removal = {}; setImmediate().then(() => { dbs.delete(name); removal.onsuccess?.(); }); return removal; },
    };
    const existing = () => dbs.set('generated-drafts', { version: 1, stores: new Map([['drafts', [{ id: 'generated-row' }]]]) });
    return { factory, dbs, log, state, existing };
  }
  const readGenerated = g => readExistingStore(g.factory, 'generated-drafts', 'drafts', 1);
  let g = generatedFactory(); g.existing();
  assert.deepEqual(await readGenerated(g), [{ id: 'generated-row' }]); assert.equal(g.log.live, 0, 'no handle outlives the read');
  g = generatedFactory();
  assert.equal(await readGenerated(g), null); assert.equal(g.log.opens, 0, 'an unlisted database is not opened');
  for (const leaveAbortedCreation of [false, true]) {
    // Deleted by another tab between enumeration and open: the open's creation is aborted, nothing remains.
    g = generatedFactory({ leaveAbortedCreation }); g.existing(); g.state.afterEnumerate = () => g.dbs.delete('generated-drafts');
    assert.equal(await readGenerated(g), null);
    assert.equal(g.dbs.has('generated-drafts'), false, 'no database exists afterwards'); assert.equal(g.log.upgradesCompleted, 0);
    assert.equal(g.log.live, 0);
  }
  g = generatedFactory({ enumerate: false });
  assert.equal(await readGenerated(g), null); assert.equal(g.dbs.size, 0, 'without enumeration the aborted creation leaves nothing');
  g = generatedFactory(); g.existing(); g.state.blockNext = true;
  assert.equal(await readGenerated(g), null); await setImmediate(); await setImmediate(); assert.equal(g.log.live, 0, 'a blocked open closes promptly');
  g = generatedFactory(); g.existing(); g.state.versionChangeOnRead = true;
  assert.equal(await readGenerated(g), null); assert.equal(g.log.live, 0, 'a version change closes and lists nothing');
  g = generatedFactory(); g.dbs.set('generated-drafts', { version: 2, stores: new Map([['drafts', []]]) });
  assert.equal(await readGenerated(g), null); assert.equal(g.log.live, 0); assert.equal(g.dbs.get('generated-drafts').version, 2);
  cases.push('held-drafts-existing-only-reader');
  return cases;
}
