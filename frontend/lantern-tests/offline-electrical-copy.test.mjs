// Pure synthetic transactional/leased-reader contracts. No browser, native service or transport.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const ownerCode = stripTypeScriptTypes(readFileSync(new URL('../src/offline/live-copy-owner.ts', import.meta.url), 'utf8'));
assert(!/^\s*import(?:\s|['"])/m.test(ownerCode));
const backendCode = stripTypeScriptTypes(readFileSync(new URL('../src/offline/live-copy-indexeddb.ts', import.meta.url), 'utf8'));
const adapterCode = stripTypeScriptTypes(readFileSync(new URL('../integration/live-copy-retention.ts', import.meta.url), 'utf8'))
  .replace(/(['"])\.\.\/src\/offline\/live-copy-owner\1/g, JSON.stringify(dataModule(ownerCode)))
  .replace(/(['"])\.\.\/src\/offline\/live-copy-indexeddb\1/g, JSON.stringify(dataModule(backendCode)));
assert(!/^\s*import(?:\s|['"])/m.test(adapterCode.replace(/^import .* from .*;$/gm, '')));
const { createLiveCopyOwner, validElectricalPin } = await import(dataModule(ownerCode));
const { createLiveCopyRetention } = await import(dataModule(adapterCode));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { workspaceId: uuid(1), homeId: uuid(2) };
const signal = () => new AbortController().signal;
const original = new Uint8Array([37, 80, 68, 70]);
const sha256 = createHash('sha256').update(original).digest('hex');
const view = { status: 'ready', scope, homeLabel: 'Generated home', now: '2026-11-08T00:00:00Z', entries: [], caches: [] };
function memory() {
  let tables = new Map(['control', 'metadata', 'bytes'].map(key => [key, new Map()])), tail = Promise.resolve();
  return {
    tables: () => tables,
    transaction(write, work) {
      const pending = tail.then(async () => {
        const next = structuredClone(tables);
        const result = await work({
          get: async (table, key) => structuredClone(next.get(table).get(key)),
          list: async table => [...next.get(table)].map(([key, value]) => ({ key, value: structuredClone(value) })),
          put: async (table, key, value) => { next.get(table).set(key, structuredClone(value)); },
          remove: async (table, key) => { next.get(table).delete(key); },
          empty: async table => { next.get(table).clear(); },
        });
        if (write) tables = next;
        return result;
      });
      tail = pending.catch(() => undefined); return pending;
    }, close() {},
  };
}
function drawing(buildingId = uuid(3), evidenceId = uuid(4)) {
  const pin = { source: 'electrical-evidence', buildingId, evidenceId, evidenceRevision: 2, assetId: uuid(5),
    assetRevision: '9007199254740993', byteSize: '4.0e0', sha256, contentType: 'application/pdf' };
  const page = { sheet: { id: 'sheet-1', title: 'Generated historical drawing', pdfPage: 1,
    sourceDate: null, originalPhotoSha256: 'b'.repeat(64), renderedPhotoSha256: 'c'.repeat(64), originalPhoto: 'never-retain-this-url' },
    reference: { ...scope, buildingId, evidenceId, evidenceRevision: 2, assetId: uuid(5), assetRevision: { token: pin.assetRevision },
      byteSize: { token: pin.byteSize }, assetSha256: sha256, sheetId: 'sheet-1', pdfPage: 1,
      correlationId: 'generated-correlation', correlationSha256: 'd'.repeat(64), originalPhotoSha256: 'b'.repeat(64), renderedPhotoSha256: 'c'.repeat(64) },
    rooms: [], documentary: null };
  const frame = { status: 'available', lease: {}, scope, buildingId, documents: [{ key: 'ignored', evidenceId, evidenceRevision: 2,
    assetId: uuid(5), assetRevision: { token: pin.assetRevision }, byteSize: { token: pin.byteSize }, sha256, pages: [page] }],
    unlinkedSheets: [], provenance: null };
  const asset = { assetId: uuid(5), revision: { token: pin.assetRevision }, byteSize: { token: pin.byteSize }, sha256,
    contentType: 'application/pdf', purpose: 'evidence-original', previewPolicy: 'download-only', sourceLicense: { status: 'unknown', reference: null }, evidenceIds: [] };
  return { pin, frame, asset };
}
async function setup(nativeDocuments = null) {
  const backend = memory(), session = { actorId: 'generated-actor-a', expiresAt: '2099-01-01T00:00:00Z' };
  let state = { session, view }, current = true, opens = 0, releases = 0, disposals = 0, duringBytes = () => {};
  const owner = createLiveCopyRetention({ factory: undefined, backend, state: () => state,
    documents: () => {
      if (!nativeDocuments) throw new Error('Synthetic native Document v2 transport trap');
      return { async createReader() { const identity = {}; return { owner: () => identity,
        async list() { return { documents: nativeDocuments, nextCursor: null }; }, dispose() {} }; } };
    } });
  assert.equal((await owner.observe(session, () => state.session === session)).status, 'ok');
  assert.equal((await owner.capture(view, signal())).status, 'ok');
  const makeReader = d => {
    const identity = {}, opened = { lease: {}, evidenceId: d.pin.evidenceId, evidenceRevision: d.pin.evidenceRevision, asset: d.asset, mode: 'original-download' };
    return { owner: () => identity, isCurrent: frame => current && frame === d.frame,
      createDrawingClient: frame => { assert.equal(frame, d.frame); return {
        async open(id, selected) { selected.throwIfAborted(); assert.equal(id, d.pin.evidenceId); opens++; return opened; },
        isCurrent: candidate => current && candidate === opened,
        getBlob: () => ({ size: 4, type: 'application/pdf', async arrayBuffer() { duringBytes(); return original.slice().buffer; } }),
        release(candidate) { assert.equal(candidate, opened); releases++; }, dispose() { disposals++; },
      }; } };
  };
  return { owner, backend, makeReader, setCurrent: value => { current = value; },
    replaceSession() { state = { session: { ...session }, view }; }, duringBytes: value => { duringBytes = value; },
    counts: () => ({ opens, releases, disposals }) };
}
async function readCopy(owner) { const result = await owner.read.readLast(signal()); assert.equal(result.status, 'ok'); return result.value.handle; }

test('exact electrical catalog and originals remain separate from native Document v2 identity', async () => {
  const f = await setup(), d = drawing();
  try {
    assert.deepEqual(await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal()), { status: 'ok', value: { held: 1, unavailable: 0, bytes: 4 } });
    const handle = await readCopy(f.owner), catalog = await f.owner.read.readElectricalCatalog(handle, signal());
    assert.equal(catalog.status, 'ok'); const held = catalog.value.buildings[0].documents[0];
    assert.deepEqual(held.pin, d.pin); assert.equal(held.pages[0].sourceDate, null);
    assert(!JSON.stringify(catalog).includes('lease')); assert(!JSON.stringify(catalog).includes('never-retain-this-url'));
    const bytes = await f.owner.read.readElectricalDocument(handle, d.pin, signal()); assert.equal(bytes.status, 'ok');
    assert.deepEqual(new Uint8Array(await bytes.value.arrayBuffer()), original);
    assert.equal((await f.owner.read.readDocument(handle, { documentId: d.pin.evidenceId, documentRevision: 2,
      assetId: d.pin.assetId, assetRevision: 1, bytes: 4, sha256, contentType: 'application/pdf' }, signal())).status, 'missing');
    assert.deepEqual(f.counts(), { opens: 1, releases: 1, disposals: 1 });
  } finally { f.owner.close(); }
});

test('metadata-only and disabled passes never open native bytes; independent building captures survive', async () => {
  const f = await setup(), a = drawing(), b = drawing(uuid(6), uuid(7));
  try {
    assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(a), a.frame, signal(), { includeBytes: false })).status, 'ok');
    assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(b), b.frame, signal(), { enabled: () => false })).status, 'ok');
    const catalog = await f.owner.read.readElectricalCatalog(await readCopy(f.owner), signal());
    assert.equal(catalog.status, 'ok'); assert.equal(catalog.value.buildings.length, 2); assert.equal(f.counts().opens, 0);
    const status = await f.owner.read.electricalStatus(await readCopy(f.owner), a.pin, signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'not-held');
  } finally { f.owner.close(); }
});

test('changed evidence/asset correlation and lexical revision mismatch refuse without keeping bytes', async () => {
  for (const mutate of [d => { d.frame.documents[0].pages[0].reference.evidenceId = uuid(9); },
    d => { d.asset.revision.token = '9007199254740992'; }, d => { d.asset.byteSize.token = '4'; }]) {
    const f = await setup(), d = drawing(); mutate(d);
    try {
      assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal())).status, 'integrity');
      const status = await f.owner.read.electricalStatus(await readCopy(f.owner), d.pin, signal());
      assert(status.status === 'ok' && status.value.availability === 'not-held');
      assert.equal(f.counts().opens, f.counts().releases);
    } finally { f.owner.close(); }
  }
});

test('byte corruption fails integrity; tombstone retires old handles and prevents historical fallback', async () => {
  const f = await setup(), d = drawing();
  try {
    assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal())).status, 'ok');
    const handle = await readCopy(f.owner);
    for (const [key, value] of f.backend.tables().get('metadata')) if (value.kind === 'electrical-document')
      f.backend.tables().get('bytes').set(key, new Uint8Array([0, 0, 0, 0]).buffer);
    const status = await f.owner.read.electricalStatus(handle, d.pin, signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'failed-integrity');
    assert.equal((await f.owner.storage.clear()).status, 'ok');
    assert.equal((await f.owner.read.readElectricalDocument(handle, d.pin, signal())).status, 'retired');
    assert.equal((await f.owner.read.readLast(signal())).status, 'retired');
    assert.equal(f.backend.tables().get('bytes').size, 0);
  } finally { f.owner.close(); }
});

test('lease/session withdrawal during byte materialization prevents persistence and releases every lease', async () => {
  for (const withdraw of [f => f.setCurrent(false), f => f.replaceSession()]) {
    const f = await setup(), d = drawing(); f.duringBytes(() => withdraw(f));
    try {
      assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal())).status, 'retired');
      assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'electrical-document').length, 0);
      assert.deepEqual(f.counts(), { opens: 1, releases: 1, disposals: 1 });
    } finally { f.owner.close(); }
  }
});

test('pristine storage alone allows missing; malformed control and observed actors never imply pristine', async () => {
  const backend = memory(), owner = createLiveCopyOwner(backend);
  assert.equal((await owner.readLast(signal())).status, 'missing');
  backend.tables().get('control').set('witness', { bad: true });
  assert.equal((await owner.readLast(signal())).status, 'integrity');
  backend.tables().get('control').clear();
  assert.equal((await owner.observeActor('generated-actor', () => true)).status, 'ok');
  assert.equal((await owner.readLast(signal())).status, 'retired');
  await owner.clear(); assert.equal((await owner.readLast(signal())).status, 'retired'); owner.close();
  const pristine = memory();
  const failedClear = createLiveCopyOwner({ ...pristine, transaction(write, work) {
    if (write) return Promise.reject(new Error('Generated tombstone commit failure'));
    return pristine.transaction(write, work);
  } });
  assert.equal((await failedClear.readLast(signal())).status, 'missing');
  assert.equal((await failedClear.clear()).status, 'unavailable');
  assert.equal((await failedClear.readLast(signal())).status, 'retired', 'known clear cannot rediscover pristine legacy fallback');
  failedClear.close();
  const pin = drawing().pin;
  assert(validElectricalPin(pin));
  for (const assetRevision of ['0', '-1', '1.5', '1e99999']) assert(!validElectricalPin({ ...pin, assetRevision }));
});


test('automatic measured budget refuses byte churn while preserving metadata; explicit target stays bounded', async () => {
  const row = id => ({ documentId: uuid(id), revision: 1, title: 'Generated large metadata only', lifecycle: 'active',
    original: { assetId: uuid(id + 1), revision: 1, sha256: 'a'.repeat(64), bytes: 110 * 1024 * 1024 },
    availability: { original: 'available' } });
  const f = await setup([row(20), row(30)]), d = drawing();
  try {
    assert.equal((await f.owner.retainCatalog(signal())).status, 'ok');
    assert.deepEqual(await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal()),
      { status: 'ok', value: { held: 0, unavailable: 0, bytes: 4 } });
    assert.equal(f.counts().opens, 0);
    assert.equal((await f.owner.read.readElectricalCatalog(await readCopy(f.owner), signal())).status, 'ok');
    assert.deepEqual(await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal(), { evidenceId: d.pin.evidenceId }),
      { status: 'ok', value: { held: 1, unavailable: 0, bytes: 4 } });
  } finally { f.owner.close(); }
});

test('shared document LRU enforces one bound across disjoint native and electrical identity namespaces', async () => {
  const backend = memory(), owner = createLiveCopyOwner(backend, { limits: { documents: 1 } }), d = drawing();
  try {
    const actor = await owner.observeActor('generated-actor', () => true), home = owner.bindHome(actor.value, scope, () => true);
    assert.equal((await owner.keepView(home.value, view, signal())).status, 'ok');
    const pin = d.pin;
    const building = { buildingId: pin.buildingId, capturedAt: view.now, provenance: null, documents: [{ pin,
      pages: [{ sheetId: 'sheet', title: 'Generated', pdfPage: 1, sourceDate: null, correlationId: 'correlation',
        correlationSha256: 'a'.repeat(64), originalPhotoSha256: 'b'.repeat(64), renderedPhotoSha256: 'c'.repeat(64) }] }] };
    assert.equal((await owner.keepElectricalCatalog(home.value, building, signal())).status, 'ok');
    assert.equal((await owner.keepElectricalDocument(home.value, pin, original.slice().buffer, signal())).status, 'ok');
    const copy = await owner.readLast(signal()); assert.equal(copy.status, 'ok');
    assert.equal((await owner.electricalStatus(copy.value.handle, pin, signal())).value.availability, 'held');
    const nativePin = { documentId: pin.evidenceId, documentRevision: pin.evidenceRevision, assetId: pin.assetId,
      assetRevision: 1, bytes: 4, sha256, contentType: 'application/pdf' };
    assert.equal((await owner.keepCatalog(home.value, { version: 1, capturedAt: view.now, completeness: 'captured-complete',
      documents: [{ ...nativePin, title: 'Distinct native document', lifecycle: 'active', recordedAvailability: 'available' }].map(({ contentType, ...row }) => row) }, signal())).status, 'ok');
    assert.equal((await owner.keepDocument(home.value, nativePin, original.slice().buffer, signal())).status, 'ok');
    assert.equal((await owner.electricalStatus(copy.value.handle, pin, signal())).value.availability, 'not-held');
    assert.equal((await owner.readDocument(copy.value.handle, nativePin, signal())).status, 'ok');
    assert.equal((await owner.status(signal())).value.documents, 1);
    assert.equal((await owner.readElectricalCatalog(copy.value.handle, signal())).status, 'ok', 'LRU evicts bytes before catalogs');
  } finally { owner.close(); }
});
