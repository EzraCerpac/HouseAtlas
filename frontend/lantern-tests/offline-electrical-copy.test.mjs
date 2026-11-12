// Pure synthetic transactional/leased-reader contracts. No browser, native service or transport.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { transformWithOxc } from 'vite';
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
const decimalModule = dataModule(stripTypeScriptTypes(readFileSync(new URL('../src/numeric/decimal.ts', import.meta.url), 'utf8')));
const hintModule = dataModule(stripTypeScriptTypes(readFileSync(new URL('../src/offline/homebox-size-hints.ts', import.meta.url), 'utf8'))
  .replace(/(['"])\.\.\/numeric\/decimal\1/g, JSON.stringify(decimalModule)));
const { summarizeHomeboxSizeHints } = await import(hintModule);
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
const hintView = tokens => homeboxView(tokens.map((byteSize, i) => ({ attachmentId: uuid(100 + i), byteSize })));
test('HomeBox hint summary distinguishes exact zero, known over-limit hints and unknown metadata', () => {
  assert.deepEqual(summarizeHomeboxSizeHints(hintView(['0', '4096', '10485761', null, 'malformed'])), {
    files: 5, knownSizes: 3, unknownSizes: 2, hintBytes: 10_489_857, aboveAutomaticLimit: 1,
  });
  assert.deepEqual(summarizeHomeboxSizeHints(hintView([])), {
    files: 0, knownSizes: 0, unknownSizes: 0, hintBytes: 0, aboveAutomaticLimit: 0,
  });
  assert.deepEqual(summarizeHomeboxSizeHints(hintView(['0'])), {
    files: 1, knownSizes: 1, unknownSizes: 0, hintBytes: 0, aboveAutomaticLimit: 0,
  });
  assert.equal(summarizeHomeboxSizeHints(hintView(['10485760'])).aboveAutomaticLimit, 0);
  const unknown = summarizeHomeboxSizeHints(hintView([undefined, null, '', '-1', '0.5', 'NaN', '9007199254740992']));
  assert.equal(unknown.files, 7); assert.equal(unknown.knownSizes, 0); assert.equal(unknown.unknownSizes, 7);
});
test('HomeBox hint duplicates use numeric equality and sticky unknown/conflict independent of order', () => {
  for (const tokens of [['4096', '4.096e3', '4096.0'], ['4096.0', '4.096e3', '4096']]) {
    const data = homeboxView(tokens.map(byteSize => ({ attachmentId: uuid(42), byteSize })));
    assert.deepEqual(summarizeHomeboxSizeHints(data), { files: 1, knownSizes: 1, unknownSizes: 0, hintBytes: 4096, aboveAutomaticLimit: 0 });
  }
  for (const tokens of [['4096', '4097', '4096'], ['4097', '4096', '4096'], ['4096', null, '4096'], [null, '4096', '4096']]) {
    const data = hintView(['0', '4096', '10485761', null, 'malformed']);
    data.entries[0].attachments.splice(1, 1, ...tokens.map(byteSize => ({ attachmentId: uuid(101), kind: 'stored-file', byteSize })));
    assert.deepEqual(summarizeHomeboxSizeHints(data), { files: 5, knownSizes: 2, unknownSizes: 3, hintBytes: 10_485_761, aboveAutomaticLimit: 1 });
  }
});
test('HomeBox hint identity is collision-safe, source-specific and excludes links and other sources', () => {
  const data = hintView(['0', '4096', '10485761', null, 'malformed']);
  const duplicate = structuredClone(data.entries[0]); data.entries.push(duplicate);
  data.entries[0].attachments.push({ attachmentId: uuid(110), kind: 'external-link', byteSize: '99999' });
  const other = structuredClone(duplicate); other.source.sourceKind = 'atlas-native'; data.entries.push(other);
  assert.deepEqual(summarizeHomeboxSizeHints(data), { files: 5, knownSizes: 3, unknownSizes: 2, hintBytes: 10_489_857, aboveAutomaticLimit: 1 });
  const separate = structuredClone(duplicate); separate.source.collectionId = 'different-opaque-collection';
  separate.attachments = [separate.attachments[1]]; data.entries.push(separate);
  assert.deepEqual(summarizeHomeboxSizeHints(data), { files: 6, knownSizes: 4, unknownSizes: 2, hintBytes: 10_493_953, aboveAutomaticLimit: 1 });
  const a = homeboxView([{ attachmentId: uuid(42), byteSize: '1' }]).entries[0], b = structuredClone(a);
  a.source.collectionId = 'a\nb'; a.source.externalId = 'c';
  b.source.collectionId = 'a'; b.source.externalId = 'b\nc';
  assert.equal(summarizeHomeboxSizeHints({ ...data, entries: [a, b] }).files, 2, 'tuple delimiters cannot merge distinct associations');
  b.source = { ...a.source, sourceInstanceId: uuid(99) };
  assert.equal(summarizeHomeboxSizeHints({ ...data, entries: [a, b] }).files, 2);
});
test('HomeBox hint sums refuse overflow without converting known file hints to unknown', () => {
  for (const tokens of [['9007199254740991', '1'], ['1', '9007199254740991']]) {
    assert.deepEqual(summarizeHomeboxSizeHints(hintView(tokens)), { files: 2, knownSizes: 2, unknownSizes: 0, hintBytes: null, aboveAutomaticLimit: 1 });
  }
  assert.equal(summarizeHomeboxSizeHints(hintView(['9007199254740990', '1'])).hintBytes, Number.MAX_SAFE_INTEGER);
});

// Actual Settings source with synthetic hook/JSX boundaries: no React mount, DOM or browser.
const settingsRuntimeKey = Symbol.for('houseatlas.settings-hints.generated');
const settingsHooks = dataModule(`
const runtime = () => globalThis[Symbol.for('houseatlas.settings-hints.generated')];
export const useState = initial => runtime().useState(initial);
export const useEffect = (fn, deps) => runtime().useEffect(fn, deps);
export const useSyncExternalStore = () => true;
`);
const settingsJSX = dataModule(`export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;`);
const settingsPreference = dataModule(`export const keepLibrary = () => true; export const setKeepLibrary = () => { throw Error('Unexpected preference write'); }; export const subscribeKeepLibrary = () => () => {};`);
const settingsPath = new URL('../src/offline/OfflineStorageSettings.tsx', import.meta.url);
let settingsCode = (await transformWithOxc(readFileSync(settingsPath, 'utf8'), settingsPath.pathname,
  { lang: 'tsx', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false })).code;
for (const [specifier, module] of Object.entries({ react: settingsHooks, 'react/jsx-runtime': settingsJSX,
  '../numeric/decimal': decimalModule, './library-preference': settingsPreference, './homebox-size-hints': hintModule })) {
  assert(settingsCode.includes(JSON.stringify(specifier)), `Missing Settings import ${specifier}`);
  settingsCode = settingsCode.replaceAll(JSON.stringify(specifier), JSON.stringify(module));
}
assert(!/^\s*import.*from\s+["'](?!data:)/m.test(settingsCode));
const { OfflineStorageSettings } = await import(dataModule(settingsCode));
const settingsText = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(settingsText).join('')
  : typeof node === 'object' ? settingsText(node.props?.children) : String(node);
function settingsHarness() {
  const slots = [], effects = []; let stateIndex = 0, effectIndex = 0, pending = [];
  const runtime = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
    useEffect(fn, deps) {
      const index = effectIndex++, before = effects[index];
      if (!before || deps.some((value, i) => value !== before.deps[i])) pending.push(() => {
        before?.cleanup?.(); effects[index] = { deps, cleanup: fn() };
      });
    },
    render(controls) { stateIndex = 0; effectIndex = 0; pending = []; globalThis[settingsRuntimeKey] = runtime; return settingsText(OfflineStorageSettings({ controls })); },
    commit() { const work = pending; pending = []; for (const fn of work) fn(); },
    close() { for (const effect of effects) effect.cleanup?.(); delete globalThis[settingsRuntimeKey]; },
  };
  return runtime;
}
function generatedSettingsControls() {
  const requests = [], listeners = new Set();
  const controls = { read: {
    readLast(signal) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ signal, resolve, reject }); return promise; },
    readCatalog: async () => ({ status: 'missing' }), readElectricalCatalog: async () => ({ status: 'missing' }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  }, storage: {
    status: async () => ({ status: 'unavailable' }),
    requestPersistence() { throw Error('Unexpected persistence request'); },
  } };
  return { controls, requests, listeners, refresh() { for (const fn of listeners) fn(); } };
}
const hintCopy = data => ({ status: 'ok', value: { handle: {}, snapshot: { data } } });
const settleSettings = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('Settings hint coverage refuses replaced requests, owners, failures and cleanup without new reads', async () => {
  const harness = settingsHarness(), a = generatedSettingsControls(), b = generatedSettingsControls();
  const text = controls => harness.render(controls);
  try {
    assert.match(text(a.controls), /HomeBox size hints are unavailable/); harness.commit();
    a.requests[0].resolve(hintCopy(hintView(['0']))); await settleSettings();
    assert.match(text(a.controls), /Size hints: 0 bytes across 1 file; 0 sizes unknown/); harness.commit();
    a.refresh(); assert(a.requests[0].signal.aborted);
    assert.match(text(a.controls), /HomeBox size hints are unavailable/); harness.commit();
    a.refresh(); assert(a.requests[1].signal.aborted);
    a.requests[2].resolve(hintCopy(hintView(['8192']))); await settleSettings();
    a.requests[1].resolve(hintCopy(hintView(['4096']))); await settleSettings();
    assert.match(text(a.controls), /Size hints: 8192 bytes/); harness.commit();
    a.refresh(); a.requests[3].reject(Error('Generated read failure')); await settleSettings();
    assert.match(text(a.controls), /HomeBox size hints are unavailable/); harness.commit();
    a.refresh(); a.requests[4].resolve({ status: 'retired' }); await settleSettings();
    assert.match(text(a.controls), /HomeBox size hints are unavailable/); harness.commit();
    a.refresh(); a.requests[5].resolve(hintCopy(hintView(['10485761']))); await settleSettings();
    assert.match(text(a.controls), /10485761 bytes across 1 file; 0 sizes unknown. 1 above/); harness.commit();
    assert.match(text(b.controls), /HomeBox size hints are unavailable/, 'new props hide the still-populated old owner before cleanup');
    // Discard that uncommitted render, then exercise a pending old-owner result too.
    assert.match(text(a.controls), /10485761 bytes/); harness.commit();
    a.refresh(); const staleCallback = [...a.listeners][0];
    assert.match(text(b.controls), /HomeBox size hints are unavailable/, 'new owner is hidden before effects clean up'); harness.commit();
    assert(a.requests[6].signal.aborted); assert.equal(a.listeners.size, 0);
    b.requests[0].resolve(hintCopy(hintView([]))); await settleSettings();
    a.requests[6].resolve(hintCopy(hintView(['4096']))); await settleSettings();
    assert.match(text(b.controls), /No HomeBox files listed in this held view/); harness.commit();
    staleCallback(); assert.equal(a.requests.length, 7, 'late unsubscribed callback cannot start a read');
    b.refresh(); harness.close(); assert(b.requests[1].signal.aborted);
    b.requests[1].resolve(hintCopy(hintView(['4096']))); await settleSettings();
    assert.equal(b.listeners.size, 0);
  } finally { harness.close(); }
});
// Synthetic authenticated discovery port: installed-source DATA is selected
// only from this generated view; it never grants the original transport access.
function currentPinnedFiles(view, discover = null) {
  const binding = {}, calls = [];
  const sources = view.entries.filter(entry => entry.source.sourceKind === 'homebox-entity')
    .map(entry => ({ ...view.scope, key: { ...entry.source } }));
  let current = binding;
  const port = {
    getBindingIdentity: () => current,
    getBindingScope: identity => identity === current && identity === binding ? view.scope : null,
    async discover(identity, signal) {
      assert.equal(identity, binding); assert.equal(signal.aborted, false); calls.push(identity);
      return discover ? discover(identity, signal) : { schemaVersion: 1, scope: view.scope,
        revision: 'generated-discovery-only', installedSources: sources };
    },
  };
  return { ...port, calls, retire() { current = null; } };
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

test('HomeBox registration supersession preserves independent workspace and home histories', async () => {
  const backend = memory(), owner = createLiveCopyOwner(backend);
  try {
    const actor = await owner.observeActor('generated-actor', () => true);
    assert.equal(actor.status, 'ok');
    const scopes = [scope, { ...scope, homeId: uuid(3) }, { ...scope, workspaceId: uuid(4) }];
    const homes = scopes.map(selected => {
      const home = owner.bindHome(actor.value, selected, () => true);
      assert.equal(home.status, 'ok'); return home.value;
    });
    const pin = { ...ref(), observationId: uuid(70), sourceRegistrationVersion: 3,
      sourceRegistrationSha256: 'e'.repeat(64), sha256: pdfSha, bytes: pdf.length,
      contentType: 'application/pdf', sourceContentType: 'application/pdf',
      beforeRetrievedAt: '2026-11-10T00:00:01Z', bodyRetrievedAt: '2026-11-10T00:00:02Z', afterRetrievedAt: '2026-11-10T00:00:03Z' };
    assert(validHomeboxPin(pin));
    const keep = (home, selected) => owner.keepHomeboxDocument(home, selected, pdf.slice().buffer, signal());
    for (const home of homes) assert.equal((await keep(home, pin)).status, 'ok');
    const before = structuredClone([...backend.tables().get('metadata')].filter(([, row]) => row.kind === 'homebox-document' && row.scope.homeId === scope.homeId));
    const newer = { ...pin, attachmentId: uuid(43), observationId: uuid(71), sourceRegistrationVersion: 4 };
    assert.equal((await keep(homes[1], newer)).status, 'ok');
    const rows = [...backend.tables().get('metadata')].filter(([, row]) => row.kind === 'homebox-document');
    assert.deepEqual(rows.filter(([, row]) => row.scope.homeId === scope.homeId), before, 'other scopes stay byte-for-byte unchanged');
    assert.equal(rows.length, 3, 'only the superseded home row leaves');
    assert.deepEqual(rows.filter(([, row]) => row.scope.homeId === uuid(3)).map(([, row]) => row.pin), [newer]);
    assert.equal((await keep(homes[0], { ...pin, attachmentId: uuid(44) })).status, 'ok', 'another home keeps its own lower registration');
    assert.equal((await keep(homes[1], { ...pin, attachmentId: uuid(44) })).status, 'retired', 'the advanced home still refuses stale registration');
  } finally { owner.close(); }
});

test('automatic HomeBox pass rechecks enablement, view retirement and abort after pending status', async () => {
  for (const stop of ['disabled', 'retired', 'aborted']) {
    const f = await homeboxSetup(), controller = new AbortController();
    let enabled = true, current = true, retains = 0, resolveStatus, startedStatus;
    const pending = new Promise(resolve => { resolveStatus = resolve; });
    const started = new Promise(resolve => { startedStatus = resolve; });
    const owner = { ...f.owner, read: { ...f.owner.read, homeboxStatus: async () => { startedStatus(); return pending; } },
      retainHomeboxOriginal: async () => { retains++; return { status: 'ok' }; } };
    try {
      const pass = fillOfflineHomeboxOriginals({ owner, view: f.state.view, pinnedFiles: currentPinnedFiles(f.state.view), current: () => current, enabled: () => enabled, signal: controller.signal });
      await started;
      if (stop === 'disabled') enabled = false;
      else if (stop === 'retired') current = false;
      else controller.abort();
      resolveStatus({ status: 'ok', value: { availability: 'not-held', bytes: null } });
      const result = await pass;
      assert.equal(result.complete, false, stop);
      assert.equal(retains, 0, stop);
      assert.equal(f.server.calls.length, 0, stop);
      assert.match(result.message, /stopped/);
    } finally { f.owner.close(); }
  }
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
    const pass = () => fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles: currentPinnedFiles(view), current: () => true, enabled: () => true, signal: signal() });
    const first = await pass();
    assert.equal(first.complete, false); assert.match(first.message, /uncertain/);
    assert.deepEqual(f.server.calls.map(call => call.target.resourceId), [uuid(42), uuid(44)]);
    const second = await pass();
    assert.deepEqual(f.server.calls.map(call => call.target.resourceId), [uuid(42), uuid(44), uuid(45)], 'held and sent files are not read again');
    assert.match(second.message, /2 HomeBox files on this device; 1 unavailable; 1 without a usable size/);
    const disabled = await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles: currentPinnedFiles(view), current: () => true, enabled: () => false, signal: signal() });
    assert.equal(disabled.complete, false); assert.equal(f.server.calls.length, 3);
  } finally { f.owner.close(); }
  const big = homeboxView([{ attachmentId: uuid(42), byteSize: String(10_485_760) }]);
  const g = await homeboxSetup(transport(), big);
  try {
    const budget = (await g.owner.storage.status(signal())).value.budgetBytes;
    assert(budget > 10_485_760 / 0.8, 'default budget leaves room; refusal below uses an oversized hint set');
    const many = homeboxView(Array.from({ length: 25 }, (_, i) => ({ attachmentId: uuid(100 + i), byteSize: String(10_485_760) })));
    g.state = { ...g.state, view: many };
    const refused = await fillOfflineHomeboxOriginals({ owner: g.owner, view: many, pinnedFiles: currentPinnedFiles(many), current: () => true, enabled: () => true, signal: signal() });
    assert.match(refused.message, /exceed the automatic storage budget/); assert.equal(g.server.calls.length, 0);
  } finally { g.owner.close(); }
});

test('automatic HomeBox pass leaves absent installed sources unsent and unspent', async () => {
  const f = await homeboxSetup(), view = f.state.view;
  const pinnedFiles = currentPinnedFiles(view, async () => ({ schemaVersion: 1, scope: view.scope,
    revision: 'generated-no-installed-source', installedSources: [] }));
  try {
    const result = await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles,
      current: () => true, enabled: () => true, signal: signal() });
    assert.equal(result.complete, false); assert.match(result.message, /No current enumerable/);
    assert.equal(pinnedFiles.calls.length, 1); assert.equal(f.server.calls.length, 0);
    assert.equal(f.owner.homeboxSent(ref()), false);
    assert.equal((await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles: currentPinnedFiles(view),
      current: () => true, enabled: () => true, signal: signal() })).complete, true);
    assert.equal(f.server.calls.length, 1, 'later exact installed source can still send its first original');
  } finally { f.owner.close(); }
});

test('automatic HomeBox pass requires every installed-source selector field to match', async () => {
  for (const change of [source => ({ ...source, workspaceId: uuid(90) }), source => ({ ...source, homeId: uuid(90) }),
    source => ({ ...source, key: { ...source.key, sourceInstanceId: uuid(90) } }),
    source => ({ ...source, key: { ...source.key, collectionId: 'other-collection' } }),
    source => ({ ...source, key: { ...source.key, sourceKind: 'network-entity' } }),
    source => ({ ...source, key: { ...source.key, externalId: uuid(90) } })]) {
    const f = await homeboxSetup(), view = f.state.view;
    try {
      const source = { ...view.scope, key: { ...view.entries[0].source } };
      const pinnedFiles = currentPinnedFiles(view, async () => ({ schemaVersion: 1, scope: view.scope,
        revision: 'generated-mismatched-source', installedSources: [change(source)] }));
      const result = await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles,
        current: () => true, enabled: () => true, signal: signal() });
      assert.equal(result.complete, false); assert.equal(f.server.calls.length, 0);
      assert.equal(f.owner.homeboxSent(ref()), false);
    } finally { f.owner.close(); }
  }
});

test('automatic HomeBox pass retires a discovery result from a replaced binding before claiming originals', async () => {
  const f = await homeboxSetup(), view = f.state.view;
  let resolveDiscovery, startedDiscovery;
  const pending = new Promise(resolve => { resolveDiscovery = resolve; });
  const started = new Promise(resolve => { startedDiscovery = resolve; });
  const pinnedFiles = currentPinnedFiles(view, async () => { startedDiscovery(); return pending; });
  try {
    const pass = fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles,
      current: () => true, enabled: () => true, signal: signal() });
    await started; pinnedFiles.retire();
    resolveDiscovery({ schemaVersion: 1, scope: view.scope, revision: 'generated-late-discovery',
      installedSources: [{ ...view.scope, key: { ...view.entries[0].source } }] });
    const result = await pass;
    assert.equal(result.complete, false); assert.match(result.message, /retired/);
    assert.equal(f.server.calls.length, 0); assert.equal(f.owner.homeboxSent(ref()), false);
  } finally { f.owner.close(); }
});

test('automatic HomeBox discovery errors stop without original transport or a spent claim', async () => {
  const f = await homeboxSetup(), view = f.state.view;
  const pinnedFiles = currentPinnedFiles(view, async () => { throw new TypeError('Generated discovery failure'); });
  try {
    const result = await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles,
      current: () => true, enabled: () => true, signal: signal() });
    assert.equal(result.complete, false); assert.match(result.message, /source-unavailable/);
    assert.equal(pinnedFiles.calls.length, 1); assert.equal(f.server.calls.length, 0);
    assert.equal(f.owner.homeboxSent(ref()), false);
  } finally { f.owner.close(); }
});

test('concurrent HomeBox retains for one session and association send exactly once', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await homeboxSetup(transport(async request => { await gate; return { facts: facts(request) }; }));
  try {
    const both = Promise.all([f.owner.retainHomeboxOriginal(ref(), signal()), f.owner.retainHomeboxOriginal(ref(), signal())]);
    await new Promise(resolve => setTimeout(resolve, 10)); release();
    assert.deepEqual((await both).map(result => result.status).sort(), ['ok', 'uncertain']);
    assert.equal(f.server.calls.length, 1);
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(60)), aborted.signal)).status, 'missing');
  } finally { f.owner.close(); }
  const g = await homeboxSetup(transport(), homeboxView([{ attachmentId: uuid(42), byteSize: '30' }]));
  try {
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await g.owner.retainHomeboxOriginal(ref(), aborted.signal)).status, 'aborted');
    assert.equal(g.server.calls.length, 0);
    assert.equal((await g.owner.retainHomeboxOriginal(ref(), signal())).status, 'ok', 'an unsent claim is released');
  } finally { g.owner.close(); }
});

test('late lower or conflicting equal source registrations are refused and never delete newer originals', async () => {
  let version = 4, registration = 'e'.repeat(64);
  const f = await homeboxSetup(transport(request => ({ facts: facts(request, pdf, { sourceRegistrationVersion: version, sourceRegistrationSha256: registration }) })),
    homeboxView([{ attachmentId: uuid(42), byteSize: '30' }, { attachmentId: uuid(43), byteSize: '30' }, { attachmentId: uuid(44), byteSize: '30' }]));
  try {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(42)), signal())).status, 'ok');
    version = 3;
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(43)), signal())).status, 'retired');
    version = 4; registration = 'd'.repeat(64);
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(44)), signal())).status, 'integrity');
    const handle = await readCopy(f.owner);
    assert.equal((await f.owner.read.homeboxStatus(handle, ref(uuid(42)), signal())).value.availability, 'held');
    assert.equal((await f.owner.read.homeboxStatus(handle, ref(uuid(43)), signal())).value.availability, 'not-held');
    // The high-water survives eviction of every original row in the partition.
    for (const [key, row] of [...f.backend.tables().get('metadata')]) if (row.kind === 'homebox-document') {
      f.backend.tables().get('metadata').delete(key); f.backend.tables().get('bytes').delete(key);
    }
    const marks = () => [...f.backend.tables().get('control').keys()].filter(key => key.includes('homebox-registration'));
    assert.equal(marks().length, 1);
    const other = { actorId: 'generated-actor-other', expiresAt: '2099-01-01T00:00:00Z' };
    assert.equal((await f.owner.observe(other, () => true)).status, 'ok');
    assert.equal(marks().length, 0, 'account change removes registration marks with the data');
  } finally { f.owner.close(); }
});

test('a HomeBox row stored under another association key never reports or opens as that association', async () => {
  const f = await homeboxSetup(transport(), homeboxView([{ attachmentId: uuid(42), byteSize: '30' }, { attachmentId: uuid(43), byteSize: '30' }]));
  try {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(43)), signal())).status, 'ok');
    const metadata = f.backend.tables().get('metadata'), bytes = f.backend.tables().get('bytes');
    const [key, row] = [...metadata].find(([, value]) => value.kind === 'homebox-document');
    const forged = key.replace(uuid(43), uuid(42));
    metadata.set(forged, structuredClone(row)); bytes.set(forged, bytes.get(key).slice(0));
    const status = await f.owner.read.homeboxStatus(await readCopy(f.owner), ref(uuid(42)), signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'failed-integrity');
  } finally { f.owner.close(); }
});

// Borrowed native Document originals: an existing verified lease is the only byte source.
async function borrowedDocumentSetup({ catalog = true } = {}) {
  const base = memory(), session = { actorId: 'generated-borrower', expiresAt: '2099-01-01T00:00:00Z' };
  let current = true, identity = {}, beforeBytes = () => {}, beforeWrite = () => {};
  const counts = { catalogs: 0, lists: 0, opens: 0, releases: 0, disposals: 0 };
  const document = { scope, documentId: uuid(71), revision: 3, title: 'Generated native original', lifecycle: 'active',
    original: { assetId: uuid(72), revision: 4, sha256, bytes: original.length }, availability: { original: 'available' } };
  const other = { ...document, documentId: uuid(73), title: 'Another generated catalog entry' };
  const frame = { lease: {}, documentId: document.documentId, documentRevision: document.revision, mode: 'original',
    asset: document.original, measuredContentType: 'application/pdf' };
  const blob = new Blob([original], { type: 'application/pdf' });
  blob.arrayBuffer = async () => { beforeBytes(); return original.slice().buffer; };
  const reader = { owner: () => identity, isCurrent: selected => current && selected === frame,
    getBlob: selected => current && selected === frame ? blob : null,
    async openOriginal() { counts.opens++; throw new Error('Borrowed original must never reopen'); },
    release() { counts.releases++; }, dispose() { counts.disposals++; } };
  const backend = { ...base, transaction(write, work) {
    return base.transaction(write, tx => work({ ...tx, async put(table, key, value) {
      if (write && table === 'metadata' && value.kind === 'document') beforeWrite();
      return tx.put(table, key, value);
    } }));
  } };
  const owner = createLiveCopyRetention({ factory: undefined, backend, state: () => ({ session, view }),
    documents: () => ({ async createReader() { counts.catalogs++; const catalogIdentity = {}; return {
      owner: () => catalogIdentity, async list() { counts.lists++; return { documents: [document, other], nextCursor: null }; },
      dispose() {}, async openOriginal() { throw new Error('Catalog reader cannot download'); },
    }; } }) });
  assert.equal((await owner.observe(session, () => true)).status, 'ok');
  assert.equal((await owner.capture(view, signal())).status, 'ok');
  if (catalog) assert.equal((await owner.retainCatalog(signal())).status, 'ok');
  return { owner, backend: base, document, frame, reader, counts,
    retire() { current = false; identity = {}; },
    duringBytes(fn) { beforeBytes = fn; }, duringWrite(fn) { beforeWrite = fn; } };
}

test('borrowed Document original reuses matching catalog and bytes without reopening or taking ownership', async () => {
  const f = await borrowedDocumentSetup();
  try {
    const lists = f.counts.lists;
    const result = await f.owner.retainDocumentFrame(f.reader, f.frame, f.document, signal());
    assert.equal(result.status, 'ok'); assert.equal(f.counts.lists, lists);
    assert.equal(f.counts.opens, 0); assert.equal(f.counts.releases, 0); assert.equal(f.counts.disposals, 0);
    const read = await f.owner.read.readDocument(await readCopy(f.owner), result.value, signal());
    assert.equal(read.status, 'ok'); assert.deepEqual(new Uint8Array(await read.value.arrayBuffer()), original);
  } finally { f.owner.close(); }
});

test('borrowed Document original refreshes a real full catalog instead of fabricating a single-entry catalog', async () => {
  const f = await borrowedDocumentSetup({ catalog: false });
  try {
    assert.equal((await f.owner.retainDocumentFrame(f.reader, f.frame, f.document, signal())).status, 'ok');
    assert.equal(f.counts.catalogs, 1); assert.equal(f.counts.lists, 1); assert.equal(f.counts.opens, 0);
    const catalog = await f.owner.read.readCatalog(await readCopy(f.owner), signal());
    assert.equal(catalog.status, 'ok'); assert.equal(catalog.value.completeness, 'captured-complete');
    assert.deepEqual(catalog.value.documents.map(row => row.documentId), [uuid(71), uuid(73)]);
  } finally { f.owner.close(); }
});

test('borrowed Document retirement during materialization or storage refuses bytes without releasing caller ownership', async () => {
  for (const stage of ['bytes', 'transaction']) {
    const f = await borrowedDocumentSetup();
    try {
      if (stage === 'bytes') f.duringBytes(() => f.retire()); else f.duringWrite(() => f.retire());
      assert.equal((await f.owner.retainDocumentFrame(f.reader, f.frame, f.document, signal())).status, 'retired');
      assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'document').length, 0);
      assert.equal(f.counts.opens, 0); assert.equal(f.counts.releases, 0); assert.equal(f.counts.disposals, 0);
    } finally { f.owner.close(); }
  }
});

test('borrowed Document refuses preview, scope and exact asset-pin mismatches without downloading', async () => {
  const f = await borrowedDocumentSetup();
  try {
    for (const changed of [
      { ...f.document, scope: { ...scope, homeId: uuid(99) } },
      { ...f.document, original: { ...f.document.original, revision: 99 } },
    ]) assert.equal((await f.owner.retainDocumentFrame(f.reader, f.frame, changed, signal())).status, 'integrity');
    f.frame.mode = 'preview';
    assert.equal((await f.owner.retainDocumentFrame(f.reader, f.frame, f.document, signal())).status, 'integrity');
    assert.equal(f.counts.opens, 0); assert.equal(f.counts.releases, 0); assert.equal(f.counts.disposals, 0);
  } finally { f.owner.close(); }
});

test('confirmed electrical absence retires only the selected building catalog and original eligibility', async () => {
  const f = await setup(), a = drawing(uuid(81), uuid(82)), b = drawing(uuid(83), uuid(84));
  try {
    for (const d of [a, b]) assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal())).status, 'ok');
    const before = await f.owner.read.readElectricalCatalog(await readCopy(f.owner), signal());
    assert.equal(before.status, 'ok');
    const other = before.value.buildings.find(row => row.buildingId === b.pin.buildingId);
    assert.equal((await f.owner.read.readElectricalDocument(await readCopy(f.owner), a.pin, signal())).status, 'ok');
    assert.equal((await f.owner.retireElectricalLibrary(a.pin.buildingId, signal(), () => true)).status, 'ok');
    const handle = await readCopy(f.owner), catalog = await f.owner.read.readElectricalCatalog(handle, signal());
    assert.equal(catalog.status, 'ok');
    assert.deepEqual(catalog.value.buildings.find(row => row.buildingId === a.pin.buildingId).documents, []);
    assert.deepEqual(catalog.value.buildings.find(row => row.buildingId === b.pin.buildingId), other);
    assert.equal((await f.owner.read.readElectricalDocument(handle, a.pin, signal())).status, 'missing');
    const retained = await f.owner.read.readElectricalDocument(handle, b.pin, signal());
    assert.equal(retained.status, 'ok'); assert.deepEqual(new Uint8Array(await retained.value.arrayBuffer()), original);
    assert.equal(f.counts().opens, 2, 'Retirement reads no additional original');
  } finally { f.owner.close(); }
});

test('stale electrical absence session or currentness refuses catalog retirement without mutating stored data', async () => {
  for (const stale of ['session', 'currentness']) {
    const f = await setup(), a = drawing(uuid(85), uuid(86)), b = drawing(uuid(87), uuid(88));
    try {
      for (const d of [a, b]) assert.equal((await f.owner.retainElectricalLibrary(f.makeReader(d), d.frame, signal())).status, 'ok');
      const before = structuredClone(f.backend.tables());
      if (stale === 'session') f.replaceSession();
      const result = await f.owner.retireElectricalLibrary(a.pin.buildingId, signal(), () => stale !== 'currentness');
      assert.equal(result.status, 'retired');
      assert.deepEqual(f.backend.tables(), before, 'Neither catalog nor original bytes change on stale retirement');
      const handle = await readCopy(f.owner), catalog = await f.owner.read.readElectricalCatalog(handle, signal());
      assert.equal(catalog.status, 'ok'); assert.equal(catalog.value.buildings.length, 2);
      for (const d of [a, b]) assert.equal((await f.owner.read.readElectricalDocument(handle, d.pin, signal())).status, 'ok');
    } finally { f.owner.close(); }
  }
});
