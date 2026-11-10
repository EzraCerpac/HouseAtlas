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

// HomeBox borrowed originals (#372/#560): a separate source-native namespace beside native and electrical
// originals. Generated responses through an injected transport only; no backend, provider or network.
const readerCode = stripTypeScriptTypes(readFileSync(new URL('../src/offline/homebox-original-reader.ts', import.meta.url), 'utf8'));
assert(!/^\s*import(?:\s|['"])/m.test(readerCode));
const homeboxAdapterCode = adapterCode.replace(/(['"])\.\.\/src\/offline\/homebox-original-reader\1/g, JSON.stringify(dataModule(readerCode)));
const policyCode = stripTypeScriptTypes(readFileSync(new URL('../integration/offline-homebox-policy.ts', import.meta.url), 'utf8'))
  .replace(/(['"])\.\.\/src\/offline\/live-copy-owner\1/g, JSON.stringify(dataModule(ownerCode)));
const reader = await import(dataModule(readerCode));
const { createLiveCopyRetention: createHomeboxRetention } = await import(dataModule(homeboxAdapterCode));
const { fillOfflineHomeboxOriginals } = await import(dataModule(policyCode));
const { validHomeboxPin } = await import(dataModule(ownerCode));
const pdf = new TextEncoder().encode('%PDF-1.7\ngenerated\0original');
const pdfSha = createHash('sha256').update(pdf).digest('hex');
const ref = (attachmentId = uuid(42), collectionId = 'generated-opaque-collection') => ({ source: 'homebox-attachment',
  sourceInstanceId: uuid(40), collectionId, entityId: uuid(41), attachmentId });
function homeboxView(attachments = [{ attachmentId: uuid(42), byteSize: String(pdf.length) }], collectionId = 'generated-opaque-collection') {
  return { status: 'ready', scope, homeLabel: 'Generated home', now: '2026-11-10T00:00:00Z', caches: [], entries: [{
    ...scope, key: 'generated-homebox-entry', source: { sourceInstanceId: uuid(40), collectionId, sourceKind: 'homebox-entity', externalId: uuid(41) },
    entity: { id: uuid(41), name: 'Generated item', description: '', entityType: null, parent: null, archived: false,
      quantity: '1', manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
    kind: 'item', semanticKind: 'unclassified', sourceState: 'present', cacheStatus: 'fresh', sourceUpdatedAt: null,
    retrievedAt: '2026-11-10T00:00:00Z', aliases: [], mobility: 'unknown', maintenance: [], nativeLinks: [], networkBound: false,
    networkStates: [], networkRelations: [],
    attachments: attachments.map(row => ({ attachmentId: row.attachmentId, title: 'Generated manual', kind: 'stored-file',
      contentType: 'application/pdf', byteSize: row.byteSize ?? null, downloadHref: null, previewHref: null })),
  }] };
}
function facts(request, bytes = pdf, overrides = {}) {
  return { schemaVersion: 1, requestId: request.requestId, observationId: crypto.randomUUID(),
    scope: { ...request.context, sourceInstanceId: request.target.sourceInstanceId, collectionId: request.target.collectionId },
    target: { ...request.target }, sourceRegistrationVersion: 3, sourceRegistrationSha256: 'e'.repeat(64),
    sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length, contentType: 'application/pdf',
    localCapture: { semantics: 'process-local-pinned-snapshot', beforeRetrievedAt: '2026-11-10T00:00:01Z',
      bodyRetrievedAt: '2026-11-10T00:00:02.5Z', afterRetrievedAt: '2026-11-10T00:00:03+01:00', statuses: [200, 200, 200] }, ...overrides };
}
/** Generated server: answers with the exact facts for the received request unless a case mutates them. */
function transport(respond = (request) => ({ facts: facts(request) })) {
  const calls = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url, 'https://generated.invalid');
    assert.equal(parsed.pathname, `/api/atlas/stock/v4/workspaces/${scope.workspaceId}/homes/${scope.homeId}/homebox-offline-original`);
    assert.deepEqual([...parsed.searchParams.keys()], ['request']);
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const request = JSON.parse(parsed.searchParams.get('request')); calls.push(request);
    const answer = await respond(request, init);
    if (answer instanceof Response) return answer;
    const body = answer.body ?? pdf;
    return new Response(body, { status: answer.status ?? 200, headers: { 'content-type': 'application/octet-stream',
      'x-houseatlas-original': Buffer.from(JSON.stringify(answer.facts)).toString('base64'), ...answer.headers } });
  };
  return { fetch, calls };
}
async function homeboxSetup(server = transport(), initial = homeboxView()) {
  const backend = memory(), session = { actorId: 'generated-actor-h', expiresAt: '2099-01-01T00:00:00Z' };
  let state = { session, view: initial };
  const owner = createHomeboxRetention({ factory: undefined, backend, state: () => state, homeboxTransport: server.fetch,
    documents: () => { throw new Error('Synthetic native Document v2 transport trap'); } });
  assert.equal((await owner.observe(session, () => state.session === session)).status, 'ok');
  assert.equal((await owner.capture(initial, signal())).status, 'ok');
  return { owner, backend, server, session, get state() { return state; }, set state(value) { state = value; } };
}

test('HomeBox reader sends the exact v4 wire with a fresh request ID and measures returned bytes', async () => {
  for (const collectionId of ['generated-opaque-collection', uuid(43)]) {
    const server = transport(), first = await reader.readHomeboxOriginal({ scope, ref: ref(uuid(42), collectionId), signal: signal(), transport: server.fetch });
    const second = await reader.readHomeboxOriginal({ scope, ref: ref(uuid(42), collectionId), signal: signal(), transport: server.fetch });
    assert.equal(first.status, 'ok'); assert.equal(second.status, 'ok');
    assert.deepEqual(Object.keys(server.calls[0]).sort(), ['commandId', 'context', 'payload', 'requestId', 'schemaVersion', 'target']);
    assert.deepEqual({ ...server.calls[0], requestId: null }, { schemaVersion: 4, commandId: 'homebox.file.download', context: scope,
      target: { authority: 'homebox', sourceInstanceId: uuid(40), collectionId, resourceKind: 'attachment', entityId: uuid(41), resourceId: uuid(42) },
      payload: {}, requestId: null });
    assert.notEqual(server.calls[0].requestId, server.calls[1].requestId);
    assert(validHomeboxPin(first.pin)); assert.equal(first.pin.collectionId, collectionId);
    assert.equal(first.pin.sha256, pdfSha); assert.equal(first.pin.bytes, pdf.length); assert.equal(first.pin.contentType, 'application/pdf');
    assert.equal(first.pin.bodyRetrievedAt, '2026-11-10T00:00:02.5Z', 'lexical retrieval facts are preserved');
    assert.notEqual(first.pin.observationId, second.pin.observationId);
    assert.deepEqual(new Uint8Array(first.bytes), pdf);
  }
  const text = new TextEncoder().encode('generated plain text');
  const described = await reader.readHomeboxOriginal({ scope, ref: ref(), signal: signal(),
    transport: transport(request => ({ body: text, facts: facts(request, text) })).fetch });
  assert.equal(described.status, 'ok');
  assert.equal(described.pin.contentType, null, 'source MIME alone does not qualify the PDF viewer');
  assert.equal(described.pin.sourceContentType, 'application/pdf');
});

test('HomeBox reader keeps definitive, unknown and integrity outcomes distinct and never retries', async () => {
  const cases = [
    [() => ({ status: 404, facts: {} }), { status: 'unavailable', sent: true, httpStatus: 404 }],
    [() => { throw new TypeError('generated network failure'); }, { status: 'unknown', httpStatus: null }],
    [request => ({ facts: facts(request, pdf, { requestId: uuid(99) }) }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: { ...facts(request), target: { ...facts(request).target, resourceId: uuid(98) } } }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: { ...facts(request), scope: { ...facts(request).scope, collectionId: 'other' } } }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request, pdf, { extra: true }) }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request, pdf, { contentType: 'x'.repeat(4097) }) }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request), headers: { 'content-type': 'application/pdf' } }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request), headers: { 'content-length': String(10_485_761) } }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request), headers: { 'x-houseatlas-original': 'A'.repeat(16_388) } }), { status: 'unknown', httpStatus: 200 }],
    [request => ({ facts: facts(request, pdf, { sha256: 'f'.repeat(64) }) }), { status: 'integrity' }],
    [request => ({ facts: facts(request, pdf, { byteSize: pdf.length + 1 }) }), { status: 'integrity' }],
  ];
  for (const [respond, expected] of cases) {
    const server = transport(respond);
    assert.deepEqual(await reader.readHomeboxOriginal({ scope, ref: ref(), signal: signal(), transport: server.fetch }), expected);
    assert.equal(server.calls.length, 1);
  }
  const aborted = new AbortController(); aborted.abort();
  const idle = transport();
  assert.deepEqual(await reader.readHomeboxOriginal({ scope, ref: ref(), signal: aborted.signal, transport: idle.fetch }),
    { status: 'unavailable', sent: false, httpStatus: null });
  assert.deepEqual(await reader.readHomeboxOriginal({ scope, ref: { ...ref(), entityId: 'not-a-uuid' }, signal: signal(), transport: idle.fetch }),
    { status: 'unavailable', sent: false, httpStatus: null });
  assert.equal(idle.calls.length, 0);
});

test('retained HomeBox original stays in its own namespace, opens only by its measured pin and is not replayed', async () => {
  const f = await homeboxSetup();
  try {
    const kept = await f.owner.retainHomeboxOriginal(ref(), signal());
    assert.equal(kept.status, 'ok');
    const handle = await readCopy(f.owner);
    const status = await f.owner.read.homeboxStatus(handle, ref(), signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'held'); assert.deepEqual(status.value.pin, kept.value);
    const blob = await f.owner.read.readHomeboxDocument(handle, kept.value, signal());
    assert.equal(blob.status, 'ok'); assert.equal(blob.value.type, 'application/pdf');
    assert.deepEqual(new Uint8Array(await blob.value.arrayBuffer()), pdf);
    assert.equal((await f.owner.read.readHomeboxDocument(handle, { ...kept.value, observationId: uuid(77) }, signal())).status, 'integrity');
    assert.equal((await f.owner.read.readDocument(handle, { documentId: uuid(41), documentRevision: 1, assetId: uuid(42),
      assetRevision: 1, bytes: pdf.length, sha256: pdfSha, contentType: 'application/pdf' }, signal())).status, 'missing');
    const stored = JSON.stringify([...f.backend.tables().get('metadata').values()]);
    assert(!stored.includes(f.server.calls[0].requestId), 'request IDs are not persisted');
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'uncertain', 'a sent association is not read again this session');
    assert.equal(f.server.calls.length, 1);
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(50)), signal())).status, 'missing', 'only associations listed by the live view');
    assert.equal(f.server.calls.length, 1);
  } finally { f.owner.close(); }
});

test('unknown HomeBox outcomes report uncertain, keep nothing and are not retried with a fresh request ID', async () => {
  const f = await homeboxSetup(transport(() => { throw new TypeError('generated reset after send'); }));
  try {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'uncertain');
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'uncertain');
    assert.equal(f.server.calls.length, 1);
    assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0);
  } finally { f.owner.close(); }
});

test('session replacement during the read, withdrawn or re-associated attachments and account change retire HomeBox bytes', async () => {
  let f;
  const server = transport(request => { f.state = { ...f.state, session: { ...f.session } }; return { facts: facts(request) }; });
  f = await homeboxSetup(server);
  try {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'retired');
    assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0);
  } finally { f.owner.close(); }
  const g = await homeboxSetup();
  try {
    const kept = await g.owner.retainHomeboxOriginal(ref(), signal()); assert.equal(kept.status, 'ok');
    const withdrawn = homeboxView([]); g.state = { ...g.state, view: withdrawn };
    assert.equal((await g.owner.capture(withdrawn, signal())).status, 'ok');
    const handle = await readCopy(g.owner);
    assert.equal((await g.owner.read.homeboxStatus(handle, ref(), signal())).value.availability, 'not-held');
    assert.equal((await g.owner.read.readHomeboxDocument(handle, kept.value, signal())).status, 'missing');
    const moved = homeboxView(undefined, 'generated-other-collection'); g.state = { ...g.state, view: moved };
    assert.equal((await g.owner.capture(moved, signal())).status, 'ok');
    assert.equal((await g.owner.read.readHomeboxDocument(await readCopy(g.owner), kept.value, signal())).status, 'missing');
    const other = { actorId: 'generated-actor-other', expiresAt: '2099-01-01T00:00:00Z' };
    assert.equal((await g.owner.observe(other, () => true)).status, 'ok');
    assert.equal(g.backend.tables().get('bytes').size, 0, 'account change deletes prior-account originals');
    assert.equal((await g.owner.read.readHomeboxDocument(handle, kept.value, signal())).status, 'retired');
  } finally { g.owner.close(); }
});

test('a changed source registration supersedes older HomeBox observations from that partition in one transaction', async () => {
  let version = 3;
  const f = await homeboxSetup(transport(request => ({ facts: facts(request, pdf, { sourceRegistrationVersion: version }) })),
    homeboxView([{ attachmentId: uuid(42), byteSize: '30' }, { attachmentId: uuid(43), byteSize: '30' }]));
  try {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(42)), signal())).status, 'ok');
    version = 4;
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(43)), signal())).status, 'ok');
    const handle = await readCopy(f.owner);
    assert.equal((await f.owner.read.homeboxStatus(handle, ref(uuid(42)), signal())).value.availability, 'not-held');
    assert.equal((await f.owner.read.homeboxStatus(handle, ref(uuid(43)), signal())).value.availability, 'held');
  } finally { f.owner.close(); }
});

test('automatic HomeBox pass skips unknown sizes, keeps held files, stops on uncertain and respects the budget', async () => {
  const listed = [{ attachmentId: uuid(42), byteSize: String(pdf.length) }, { attachmentId: uuid(43), byteSize: null },
    { attachmentId: uuid(44), byteSize: String(pdf.length) }, { attachmentId: uuid(45), byteSize: String(pdf.length) }];
  const view = homeboxView(listed);
  const f = await homeboxSetup(transport(request => {
    if (request.target.resourceId === uuid(44)) throw new TypeError('generated unknown outcome');
    return { facts: facts(request) };
  }), view);
  try {
    const pass = () => fillOfflineHomeboxOriginals({ owner: f.owner, view, current: () => true, enabled: () => true, signal: signal() });
    const first = await pass();
    assert.equal(first.complete, false); assert.match(first.message, /uncertain/);
    assert.deepEqual(f.server.calls.map(call => call.target.resourceId), [uuid(42), uuid(44)]);
    const second = await pass();
    assert.deepEqual(f.server.calls.map(call => call.target.resourceId), [uuid(42), uuid(44), uuid(45)], 'held and sent files are not read again');
    assert.match(second.message, /2 HomeBox files on this device; 1 unavailable; 1 without a usable size/);
    const disabled = await fillOfflineHomeboxOriginals({ owner: f.owner, view, current: () => true, enabled: () => false, signal: signal() });
    assert.equal(disabled.complete, false); assert.equal(f.server.calls.length, 3);
  } finally { f.owner.close(); }
  const big = homeboxView([{ attachmentId: uuid(42), byteSize: String(10_485_760) }]);
  const g = await homeboxSetup(transport(), big);
  try {
    const budget = (await g.owner.storage.status(signal())).value.budgetBytes;
    assert(budget > 10_485_760 / 0.8, 'default budget leaves room; refusal below uses an oversized hint set');
    const many = homeboxView(Array.from({ length: 25 }, (_, i) => ({ attachmentId: uuid(100 + i), byteSize: String(10_485_760) })));
    g.state = { ...g.state, view: many };
    const refused = await fillOfflineHomeboxOriginals({ owner: g.owner, view: many, current: () => true, enabled: () => true, signal: signal() });
    assert.match(refused.message, /exceed the automatic storage budget/); assert.equal(g.server.calls.length, 0);
  } finally { g.owner.close(); }
});
