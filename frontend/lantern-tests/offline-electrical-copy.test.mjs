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
const { admitJson } = await import(dataModule(ownerCode));
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
          async scan(table, maxRows, visit) {
            let count = 0;
            for (const key of [...next.get(table).keys()].sort()) {
              if (++count > maxRows) throw Object.assign(Error('Generated scan capacity'), { name: 'OfflineResourceLimit' });
              await visit(key, structuredClone(next.get(table).get(key)));
            }
          },
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
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'ok', 'the exact held observation reopens without a new read/write');
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

test('explicit HomeBox frame saves and retains identical immutable bytes with one shared acquisition', async () => {
  const f = await homeboxSetup();
  const made = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view));
  assert.equal(made.status, 'ok'); const reader = made.value;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    const blob = reader.getBlob(opened.frame); assert(blob instanceof Blob);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pdf);
    const buffer = new Uint8Array(await blob.arrayBuffer()); buffer.fill(0);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pdf, 'caller cannot mutate the verified Blob');
    const retained = reader.retain(opened.frame); assert.equal(retained.status, 'ok');
    assert.equal(reader.retain(opened.frame).value, retained.value, 'one attempt per frame');
    const result = await retained.value.result; assert.equal(result.status, 'ok');
    const stored = await f.owner.read.readHomeboxDocument(await readCopy(f.owner), result.value, signal());
    assert.equal(stored.status, 'ok'); assert.deepEqual(new Uint8Array(await stored.value.arrayBuffer()), pdf);
    assert.equal(f.server.calls.length, 1);
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'retired', 'an unbound legacy caller cannot adopt this source witness');
    const again = await reader.open(ref(), signal()); assert.equal(again.status, 'ok');
    assert.notEqual(again.frame, opened.frame); assert.equal(reader.getBlob(again.frame), blob); reader.release(again.frame);
    assert.equal(reader.getBlob({}), null); assert.equal(reader.retain({}).status, 'retired');
    const foreign = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view));
    assert.equal(foreign.status, 'ok'); assert.equal(foreign.value.getBlob(opened.frame), null); foreign.value.dispose();
    reader.release(opened.frame); assert.equal(reader.getBlob(opened.frame), null);
    assert.equal(reader.retain(opened.frame).status, 'retired'); assert.equal(f.server.calls.length, 1);
  } finally { reader.dispose(); f.owner.close(); }
});

test('explicit opens and automatic fill cannot duplicate in-flight, unknown or refused acquisitions', async () => {
  let finish, started;
  const gate = new Promise(resolve => { finish = resolve; }), sent = new Promise(resolve => { started = resolve; });
  const f = await homeboxSetup(transport(async request => { started(); await gate; return { facts: facts(request) }; }));
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
  try {
    const pending = reader.open(ref(), signal()); await sent;
    const joined = reader.open(ref(), signal());
    assert.equal((await f.owner.retainHomeboxOriginal(ref(), signal())).status, 'retired', 'cross-witness work is not attached');
    finish(); const opened = await pending, other = await joined; assert.equal(opened.status, 'ok'); assert.equal(other.status, 'ok');
    assert.equal(reader.getBlob(opened.frame), reader.getBlob(other.frame));
    reader.release(opened.frame); reader.release(other.frame);
    assert.deepEqual(await reader.open(ref(), signal()), { status: 'unavailable', reason: 'held-missing' });
    assert.equal(f.server.calls.length, 1);
  } finally { finish(); reader.dispose(); f.owner.close(); }
  for (const [respond, outcome, first] of [
    [() => { throw Error('Generated lost response'); }, 'unknown', 'unknown'],
    [() => new Response('generated refusal', { status: 503 }), 'definitive-refusal', 'unavailable'],
  ]) {
    const g = await homeboxSetup(transport(respond));
    const r = g.owner.createHomeboxOriginalReader(g.state.view, currentPinnedFiles(g.state.view)).value;
    try {
      assert.equal((await r.open(ref(), signal())).status, first);
      assert.deepEqual(await r.open(ref(), signal()), { status: 'spent', outcome });
      r.dispose();
      const again = g.owner.createHomeboxOriginalReader(g.state.view, currentPinnedFiles(g.state.view)).value;
      assert.deepEqual(await again.open(ref(), signal()), { status: 'spent', outcome }); again.dispose();
      assert.equal(g.server.calls.length, 1);
    } finally { r.dispose(); g.owner.close(); }
  }
});

test('HomeBox quota failure leaves the same-byte save usable but never releases its sent claim', async () => {
  const f = await homeboxSetup(), reader = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
  const transaction = f.backend.transaction.bind(f.backend);
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    f.backend.transaction = (write, work) => transaction(write, tx => work({ ...tx, put(table, key, value) {
      if (table === 'bytes') throw Object.assign(Error('Generated quota'), { name: 'QuotaExceededError' });
      return tx.put(table, key, value);
    } }));
    const attempt = reader.retain(opened.frame); assert.equal(attempt.status, 'ok');
    assert.equal((await attempt.value.result).status, 'quota');
    assert.deepEqual(new Uint8Array(await reader.getBlob(opened.frame).arrayBuffer()), pdf);
    const again = await reader.open(ref(), signal()); assert.equal(again.status, 'ok');
    assert.equal(reader.retain(again.frame).value, attempt.value, 'quota never creates a second storage attempt'); reader.release(again.frame);
    assert.equal(f.server.calls.length, 1);
  } finally { reader.dispose(); f.owner.close(); }
});

test('HomeBox backend unknown quarantines work; exact held reads compare observation and bytes independently', async () => {
  const f = await homeboxSetup(), reader = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
  const transaction = f.backend.transaction.bind(f.backend); let uncertain = true;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    f.backend.transaction = async (write, work) => {
      let original = false;
      const result = await transaction(write, tx => work({ ...tx, put(table, key, value) {
        if (table === 'bytes') original = true; return tx.put(table, key, value);
      } }));
      if (original && uncertain) { uncertain = false; throw Object.assign(Error('Generated unknown acknowledgment'), { name: 'OfflineCommitUnknown' }); }
      return result;
    };
    const attempt = reader.retain(opened.frame).value;
    const unknown = await attempt.result; assert.equal(unknown.status, 'uncertain');
    assert.deepEqual(await attempt.reconcile(signal()), { status: 'unavailable' }, 'unproven native settlement keeps the pipeline charged');
    const row = [...f.backend.tables().get('metadata')].find(([, row]) => row.kind === 'homebox-document');
    const exact = structuredClone(row[1]);
    const verifier = createLiveCopyOwner(f.backend);
    const admitted = await verifier.observeActor(f.session.actorId, () => true); assert.equal(admitted.status, 'ok');
    const bound = verifier.bindHome(admitted.value, scope, () => true); assert.equal(bound.status, 'ok');
    try {
    f.backend.tables().get('metadata').set(row[0], { ...exact, pin: { ...exact.pin, observationId: uuid(99) } });
    assert.equal((await verifier.readHomeboxObservation(bound.value, exact.pin, signal())).status, 'integrity', 'another observation is not this write');
    f.backend.tables().get('metadata').delete(row[0]);
    assert.equal((await verifier.readHomeboxObservation(bound.value, exact.pin, signal())).status, 'missing');
    assert.deepEqual(await attempt.reconcile(signal()), { status: 'unavailable' }, 'missing does not prove rollback or release quarantine');
    f.backend.tables().get('metadata').set(row[0], exact);
    const held = await verifier.readHomeboxObservation(bound.value, exact.pin, signal()); assert.equal(held.status, 'ok');
    assert.deepEqual(new Uint8Array(await held.value.arrayBuffer()), pdf);
    assert.equal(f.server.calls.length, 1); assert.equal(reader.retain(opened.frame).value, attempt);
    const bytes = f.backend.tables().get('bytes').get(row[0]); new Uint8Array(bytes)[0] ^= 1;
    assert.equal((await verifier.readHomeboxObservation(bound.value, exact.pin, signal())).status, 'integrity');
    assert.equal(await attempt.result, unknown, 'late/local observations never change the settled public outcome');
    } finally { verifier.close(); }
  } finally { reader.dispose(); f.owner.close(); }
});

test('HomeBox public storage timeout stays unknown until late work settles without replay or a hidden pipeline release', async () => {
  for (const mode of ['explicit', 'bulk']) {
    const f = await homeboxSetup(transport(), homeboxView([42, 43].map(n => ({ attachmentId: uuid(n), byteSize: String(pdf.length) }))));
    const source = currentPinnedFiles(f.state.view), reader = f.owner.createHomeboxOriginalReader(f.state.view, source).value;
    const transaction = f.backend.transaction.bind(f.backend), realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
    let resume, reached, deadline, attempt;
    const gate = new Promise(resolve => { resume = resolve; }), boundary = new Promise(resolve => { reached = resolve; });
    try {
      globalThis.setTimeout = (callback, milliseconds, ...args) => milliseconds === 10000
        ? (deadline = () => callback(...args), -1) : realSet(callback, milliseconds, ...args);
      globalThis.clearTimeout = token => { if (token !== -1) realClear(token); };
      f.backend.transaction = (write, work) => transaction(write, async tx => {
        if (write) return work({ ...tx, async put(table, key, value) {
          if (table === 'bytes' && key.includes('homebox-document')) { reached(); await gate; }
          return tx.put(table, key, value);
        } });
        return work(tx);
      });
      let pending;
      if (mode === 'explicit') {
        const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
        attempt = reader.retain(opened.frame).value; pending = attempt.result;
      } else pending = fillOfflineHomeboxOriginals({ owner: f.owner, view: f.state.view, pinnedFiles: source,
        current: () => true, enabled: () => true, signal: signal() });
      await boundary; assert.equal(typeof deadline, 'function'); deadline();
      const unknown = await pending;
      if (mode === 'explicit') assert.equal(unknown.status, 'uncertain');
      else { assert.equal(unknown.complete, false); assert.match(unknown.message, /uncertain/); }
      assert.equal((await reader.open(ref(uuid(43)), signal())).status, 'resource', 'public timeout alone never frees underlying work');
      resume(); await new Promise(resolve => setImmediate(resolve));
      const next = await reader.open(ref(uuid(43)), signal()); assert.equal(next.status, 'ok');
      reader.release(next.frame); assert.equal(f.server.calls.length, 2);
      if (attempt) {
        assert.equal(await attempt.result, unknown, 'late conclusive settlement cannot mutate the public unknown');
        assert.equal((await attempt.reconcile(signal())).status, 'unresolved');
      }
      assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0);
    } finally { resume(); reader.dispose(); f.owner.close(); globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
  }
});

test('HomeBox storage survives UI close but original source/view predicates reach the actual transaction', async () => {
  for (const retire of [false, true]) {
    const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
    const reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
    const transaction = f.backend.transaction.bind(f.backend); let reached;
    const boundary = new Promise(resolve => { reached = resolve; }); let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    try {
      const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
      const before = structuredClone(f.backend.tables());
      f.backend.transaction = (write, work) => transaction(write, async tx => {
        if (write) { reached(); await gate; } return work(tx);
      });
      const attempt = reader.retain(opened.frame).value; await boundary;
      reader.dispose(); assert.equal(reader.getBlob(opened.frame), null);
      if (retire) { sources.retire(); f.owner.refreshHomeboxOriginals(); }
      resume(); const stored = await attempt.result;
      if (retire) { assert.equal(stored.status, 'retired'); assert.deepEqual(f.backend.tables(), before); }
      else { assert.equal(stored.status, 'ok'); assert.equal((await attempt.reconcile(signal())).status, 'held'); }
      assert.equal(f.server.calls.length, 1);
    } finally { resume(); reader.dispose(); f.owner.close(); }
  }
});

test('HomeBox clear synchronously withdraws reader/UI authority and cancels storage without replay', async () => {
  const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
  const transaction = f.backend.transaction.bind(f.backend); let reached, resume, replacement;
  const boundary = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const viewer = new AbortController(), notifications = []; let originalWrites = 0, clearSettled = false;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    reader.subscribe(() => {
      const current = reader.isCurrent(opened.frame), blob = reader.getBlob(opened.frame);
      notifications.push({ current, blob }); if (!current) viewer.abort();
    });
    f.backend.transaction = (write, work) => transaction(write, async tx => {
      if (write) { reached(); await gate; }
      return work({ ...tx, put(table, key, value) {
        if (table === 'metadata' && value.kind === 'homebox-document') originalWrites++;
        return tx.put(table, key, value);
      } });
    });
    const attempt = reader.retain(opened.frame).value;
    assert.equal(reader.retain(opened.frame).value, attempt, 'one storage attempt before retirement');
    await boundary;
    const clearing = f.owner.storage.clear().then(result => { clearSettled = true; return result; });
    assert.equal(clearSettled, false, 'durable clear is still behind the paused storage transaction');
    assert(notifications.length > 0, 'private reader subscribers are notified in the clear call');
    assert(notifications.every(row => !row.current && row.blob === null));
    assert.equal(viewer.signal.aborted, true, 'viewer-facing signal is cancelled before clear settles');
    assert.equal(reader.isCurrent(opened.frame), false); assert.equal(reader.getBlob(opened.frame), null);
    assert.equal(reader.retain(opened.frame).status, 'retired');
    assert.equal((await reader.open(ref(), signal())).status, 'retired');
    resume();
    assert.equal((await attempt.result).status, 'retired', 'late storage cannot publish success');
    assert.equal((await clearing).status, 'ok', 'successful clear still completes');
    assert.equal(originalWrites, 0, 'retired original never reaches a metadata publication');
    assert.equal(f.backend.tables().get('metadata').size, 0); assert.equal(f.backend.tables().get('bytes').size, 0);
    assert.equal(reader.getBlob(opened.frame), null); assert.equal(viewer.signal.aborted, true);
    assert.equal((await attempt.reconcile(signal())).status, 'retired');
    assert.equal((await f.owner.observe(f.session, () => f.state.session === f.session)).status, 'ok');
    assert.equal((await f.owner.capture(f.state.view, signal())).status, 'ok');
    replacement = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
    assert.equal((await replacement.open(ref(), signal())).status, 'retired', 'clear does not release or freshen a sent claim');
    assert.equal(f.server.calls.length, 1, 'neither clear nor a replacement reader re-acquires');
  } finally { resume(); replacement?.dispose(); reader.dispose(); f.owner.close(); }
});

test('HomeBox frame refuses over-limit hints, keeps unsupported bytes inert and observes replacement/expiry', async () => {
  const large = await homeboxSetup(transport(), homeboxView([{ attachmentId: uuid(42), byteSize: '10485761' }]));
  try {
    const r = large.owner.createHomeboxOriginalReader(large.state.view, currentPinnedFiles(large.state.view)).value;
    assert.equal((await r.open(ref(), signal())).status, 'limit'); assert.equal(large.server.calls.length, 0); r.dispose();
  } finally { large.owner.close(); }
  const text = new TextEncoder().encode('generated inert bytes');
  const f = await homeboxSetup(transport(request => ({ body: text, facts: facts(request, text, { contentType: 'text/html' }) })));
  const r = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
  try {
    const opened = await r.open(ref(), signal()); assert.equal(opened.status, 'ok');
    assert.equal(r.getBlob(opened.frame).type, 'application/octet-stream');
    f.state = { ...f.state, view: { ...f.state.view } }; f.owner.refreshHomeboxOriginals();
    assert.equal(r.getBlob(opened.frame), null); assert.equal(r.retain(opened.frame).status, 'retired');
    f.state = { ...f.state, session: { ...f.session, expiresAt: '2000-01-01T00:00:00Z' } };
    assert.equal(f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).status, 'retired');
    assert.equal(f.server.calls.length, 1);
  } finally { r.dispose(); f.owner.close(); }
});

test('HomeBox frame owns a timer for actual captured session expiry, not a producer lease', async () => {
  const f = await homeboxSetup();
  const realNow = Date.now, realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let now = realNow(), next = 0; const timers = new Map(); let reader;
  try {
    Date.now = () => now;
    globalThis.setTimeout = callback => { const id = ++next; timers.set(id, callback); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    f.session.expiresAt = new Date(now + 1000).toISOString();
    reader = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
    let notifications = 0; reader.subscribe(() => { notifications++; });
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok'); assert(reader.getBlob(opened.frame));
    now += 1001;
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    assert.equal(reader.getBlob(opened.frame), null); assert.equal(reader.retain(opened.frame).status, 'retired');
    assert(notifications > 0); assert.equal(f.server.calls.length, 1);
  } finally { reader?.dispose(); f.owner.close(); Date.now = realNow; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

test('HomeBox preflight counts escaped keys, UTF-16, UTF-8 and canonical numeric spellings before allocation', () => {
  for (const value of [{ 'quoted"key': '\0\n/ +%😀é', n: 1e20, zero: -0 }, ['\ud800', '\udfff', 1e-7, null, true],
    { nested: { 'é': ['α', 4096, '4.096e3'] } }]) {
    const measured = admitJson(value, 65536), canonical = JSON.stringify(value);
    assert.equal(measured.utf16, canonical.length); assert.equal(measured.utf8, new TextEncoder().encode(canonical).length);
  }
  let getterReads = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { getterReads++; return 'never-copy'; } });
  assert.throws(() => admitJson(accessor, 65536)); assert.equal(getterReads, 0);
  for (const collection of [' /+%*=~', 'étage/α', '😀', '\ud800']) {
    const built = reader.homeboxOriginalRequest(scope, ref(uuid(42), collection), uuid(999)); assert(built);
    const parsed = new URL(built.url, 'https://generated.invalid');
    assert.equal(parsed.searchParams.get('request'), JSON.stringify(built.request));
    assert(built.url.length <= 32904); assert(parsed.search.length - 1 <= 32768);
  }
  assert.equal(reader.homeboxOriginalRequest(scope, ref(uuid(42), '\0'.repeat(4096)), uuid(999)), null);
});

test('HomeBox bulk-only cancellation is not promoted by an explicit join; explicit storage still survives close', async () => {
  for (const mode of ['bulk', 'explicit']) {
    const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
    const ui = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
    const transaction = f.backend.transaction.bind(f.backend); let resume, reached, enabled = true;
    const gate = new Promise(resolve => { resume = resolve; }), boundary = new Promise(resolve => { reached = resolve; });
    let pending;
    try {
      f.backend.transaction = (write, work) => transaction(write, async tx => {
        if (write) {
          // Gate only original writes, not preparation's view LRU touches.
          return work({ ...tx, async put(table, key, value) {
            if (table === 'bytes' && key.includes('homebox-document')) { reached(); await gate; }
            return tx.put(table, key, value);
          } });
        }
        return work(tx);
      });
      if (mode === 'bulk') pending = fillOfflineHomeboxOriginals({ owner: f.owner, view: f.state.view, pinnedFiles: sources,
        current: () => true, enabled: () => enabled, signal: signal() });
      else {
        const opened = await ui.open(ref(), signal()); assert.equal(opened.status, 'ok');
        pending = ui.retain(opened.frame).value.result;
      }
      await boundary;
      if (mode === 'bulk') {
        assert.deepEqual(await ui.join(ref(), signal()), { status: 'unavailable', reason: 'cancellation-ownership' });
      } else {
        ui.dispose();
        const bulk = await fillOfflineHomeboxOriginals({ owner: f.owner, view: f.state.view, pinnedFiles: sources,
          current: () => true, enabled: () => true, signal: signal() });
        assert.equal(bulk.complete, false); assert.match(bulk.message, /resource/);
      }
      enabled = false; resume();
      const result = await pending;
      if (mode === 'bulk') {
        assert.equal(result.complete, false);
        assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0);
      } else assert.equal(result.status, 'ok');
      assert.equal(f.server.calls.length, 1, mode);
    } finally { resume(); ui.dispose(); f.owner.close(); }
  }
});

test('HomeBox completed fill and concurrent exact-held reborrow share one observation and one storage attempt', async () => {
  const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
  let first, second;
  try {
    const filled = await fillOfflineHomeboxOriginals({ owner: f.owner, view: f.state.view, pinnedFiles: sources,
      current: () => true, enabled: () => true, signal: signal() });
    assert.equal(filled.complete, true); assert.equal(f.server.calls.length, 1);
    first = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
    second = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
    const [a, b] = await Promise.all([first.join(ref(), signal()), second.open(ref(), signal())]);
    assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok');
    assert.notEqual(a.frame, b.frame); assert.equal(first.getBlob(b.frame), null);
    assert.equal(first.getBlob(a.frame), second.getBlob(b.frame));
    const attempt = first.retain(a.frame); assert.equal(attempt.status, 'ok');
    assert.equal(second.retain(b.frame).value, attempt.value); assert.equal((await attempt.value.result).status, 'ok');
    first.release(a.frame); assert.equal(first.getBlob(a.frame), null); assert(second.getBlob(b.frame));
    second.release(b.frame);
    const reopened = await first.join(ref(), signal()); assert.equal(reopened.status, 'ok'); assert.equal(reopened.backing, 'exact-held');
    assert.equal(first.retain(reopened.frame).value, attempt.value); assert.equal(f.server.calls.length, 1);
    first.release(reopened.frame);
  } finally { first?.dispose(); second?.dispose(); f.owner.close(); }
});

test('HomeBox exact-held final transaction refuses same bytes replaced by another full pin during hashing', async () => {
  const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
  const transaction = f.backend.transaction.bind(f.backend); let replaced = false;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    assert.equal((await reader.retain(opened.frame).value.result).status, 'ok'); reader.release(opened.frame);
    f.backend.transaction = async (write, work) => {
      let selected = null;
      const result = await transaction(write, tx => work({ ...tx, get(table, key) {
        if (table === 'bytes' && key.includes('homebox-document')) selected = key;
        return tx.get(table, key);
      } }));
      if (selected && !replaced) {
        replaced = true; const row = f.backend.tables().get('metadata').get(selected);
        f.backend.tables().get('metadata').set(selected, { ...row, pin: { ...row.pin, observationId: uuid(99) } });
      }
      return result;
    };
    assert.equal((await reader.join(ref(), signal())).status, 'integrity');
    assert.equal(replaced, true); assert.equal(f.server.calls.length, 1);
    assert.equal(reader.getBlob(opened.frame), null);
  } finally { reader.dispose(); f.owner.close(); }
});

test('HomeBox reader, interest, subscriber and resident capacity refusals precede further dispatch', async () => {
  const f = await homeboxSetup(transport(), homeboxView([42, 43, 44].map(n => ({ attachmentId: uuid(n), byteSize: String(pdf.length) }))));
  const sources = currentPinnedFiles(f.state.view), readers = [];
  try {
    for (let i = 0; i < 8; i++) { const made = f.owner.createHomeboxOriginalReader(f.state.view, sources); assert.equal(made.status, 'ok'); readers.push(made.value); }
    assert.equal(f.owner.createHomeboxOriginalReader(f.state.view, sources).status, 'resource');
    const reader = readers[0], unsubscribe = reader.subscribe(() => {});
    assert.throws(() => reader.subscribe(() => {}), error => error.status === 'resource' && error.resource === 'subscribers'); unsubscribe();
    const first = await reader.open(ref(), signal()), second = await reader.open(ref(uuid(43)), signal());
    assert.equal(first.status, 'ok'); assert.equal(second.status, 'ok');
    assert.equal((await reader.open(ref(uuid(44)), signal())).status, 'resource'); assert.equal(f.server.calls.length, 2);
    const same = await reader.join(ref(), signal()); assert.equal(same.status, 'ok');
    const fourth = await reader.join(ref(), signal()); assert.equal(fourth.status, 'ok');
    assert.equal((await reader.join(ref(), signal())).status, 'resource', 'four interests per reader');
    assert.equal(reader.getBlob(first.frame), reader.getBlob(same.frame));
    reader.release(first.frame); reader.release(same.frame); reader.release(fourth.frame);
    const third = await reader.open(ref(uuid(44)), signal()); assert.equal(third.status, 'ok'); assert.equal(f.server.calls.length, 3);
    reader.release(third.frame);
    assert.deepEqual(await reader.join(ref(), signal()), { status: 'unavailable', reason: 'held-missing' });
    assert.equal(f.server.calls.length, 3, 'missing local bytes never acquire again');
    reader.release(second.frame);
  } finally { for (const reader of readers) reader.dispose(); f.owner.close(); }
});

test('HomeBox claim/key capacity is finite and spent refusals are never evicted', async () => {
  const f = await homeboxSetup(transport(() => new Response('generated refusal', { status: 503 })),
    homeboxView(Array.from({ length: 257 }, (_, i) => ({ attachmentId: uuid(1000 + i), byteSize: String(pdf.length) }))));
  const sources = currentPinnedFiles(f.state.view), reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
  try {
    for (let i = 0; i < 255; i++) assert.equal((await reader.open(ref(uuid(1000 + i)), signal())).status, 'unavailable');
    assert.equal((await reader.open(ref(uuid(1255)), signal())).status, 'resource', 'reader scope is also charged against the full 16 MiB');
    assert.equal(f.server.calls.length, 255);
    assert.deepEqual(await reader.join(ref(uuid(1000)), signal()), { status: 'spent', outcome: 'definitive-refusal' });
    reader.dispose();
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(1255)), signal())).status, 'unavailable');
    assert.equal(f.server.calls.length, 256, 'the final claim fits only after reader scope release');
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(1256)), signal())).status, 'resource');
  } finally { reader.dispose(); f.owner.close(); }
  const collection = 'x'.repeat(4096), g = await homeboxSetup(transport(), homeboxView(undefined, collection));
  const source = currentPinnedFiles(g.state.view), other = g.owner.createHomeboxOriginalReader(g.state.view, source).value;
  try {
    assert.equal((await other.open(ref(uuid(42), collection), signal())).status, 'resource');
    assert.equal(source.calls.length, 0, 'full duplicated key/ref budget precedes discovery/encoding'); assert.equal(g.server.calls.length, 0);
  } finally { other.dispose(); g.owner.close(); }
});

test('HomeBox one pipeline includes reader discovery and original stream fragmentation retains no chunk list', async () => {
  const f = await homeboxSetup(transport(), homeboxView([42, 43].map(n => ({ attachmentId: uuid(n), byteSize: String(pdf.length) }))));
  let resume, started;
  const gate = new Promise(resolve => { resume = resolve; }), reached = new Promise(resolve => { started = resolve; });
  const sources = currentPinnedFiles(f.state.view, async () => { started(); await gate; return { schemaVersion: 1, scope,
    revision: 'generated', installedSources: [{ ...scope, key: { ...f.state.view.entries[0].source } }] }; });
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
  try {
    const pending = reader.open(ref(), signal()); await reached;
    assert.equal((await reader.open(ref(uuid(43)), signal())).status, 'resource');
    assert.equal(sources.calls.length, 1); assert.equal(f.server.calls.length, 0);
    resume(); const opened = await pending; assert.equal(opened.status, 'ok'); reader.release(opened.frame);
    assert.equal(f.server.calls.length, 1);
  } finally { resume(); reader.dispose(); f.owner.close(); }
  const streamed = transport(request => ({ body: new ReadableStream({ start(controller) {
    for (let i = 0; i < 256; i++) controller.enqueue(new Uint8Array());
    for (const byte of pdf) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }), facts: facts(request) }));
  const originalReader = await import(dataModule(readerCode));
  const original = await originalReader.readHomeboxOriginal({ scope, ref: ref(), signal: signal(), transport: streamed.fetch });
  assert.equal(original.status, 'ok'); assert.deepEqual(new Uint8Array(original.bytes), pdf);
});

test('HomeBox cancelled waiters detach while a live join remains; final dispatched abort never resurrects delivery', async () => {
  let resume, started;
  const gate = new Promise(resolve => { resume = resolve; }), reached = new Promise(resolve => { started = resolve; });
  const f = await homeboxSetup(transport(async request => { started(); await gate; return { facts: facts(request) }; }),
    homeboxView([42, 43].map(n => ({ attachmentId: uuid(n), byteSize: String(pdf.length) }))));
  const source = currentPinnedFiles(f.state.view), reader = f.owner.createHomeboxOriginalReader(f.state.view, source).value;
  const first = new AbortController();
  try {
    const original = reader.open(ref(), first.signal); await reached;
    for (let i = 0; i < 64; i++) {
      const cancelled = new AbortController(), joined = reader.join(ref(), cancelled.signal);
      cancelled.abort(); assert.equal((await joined).status, 'aborted');
    }
    assert.equal(source.calls.length, 1); assert.equal(f.server.calls.length, 1);
    first.abort(); assert.equal((await original).status, 'aborted');
    assert.equal((await reader.join(ref(), signal())).status, 'settling');
    assert.equal((await reader.open(ref(uuid(43)), signal())).status, 'resource', 'underlying work still owns its pipeline');
    resume(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await reader.join(ref(), signal()), { status: 'spent', outcome: 'unknown' });
    assert.equal([...f.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0);
    assert.equal(f.server.calls.length, 1, 'late success delivers no frame or storage and never freshens the claim');
  } finally { resume(); reader.dispose(); f.owner.close(); }
});

test('HomeBox view and stored-row capacity refusals stop before discovery or another original', async () => {
  const view = homeboxView(Array.from({ length: 1029 }, (_, i) => ({ attachmentId: uuid(1000 + i), byteSize: String(pdf.length) })));
  view.entries.push({ ...view.entries[0], key: 'generated-second-entry',
    attachments: view.entries[0].attachments.slice(0, 1028) });
  const f = await homeboxSetup(transport(), view), source = currentPinnedFiles(view);
  const reader = f.owner.createHomeboxOriginalReader(view, source).value;
  try {
    assert.equal((await reader.open(ref(uuid(1000)), signal())).status, 'resource');
    const fill = await fillOfflineHomeboxOriginals({ owner: f.owner, view, pinnedFiles: source,
      current: () => true, enabled: () => true, signal: signal() });
    assert.equal(fill.complete, false); assert.match(fill.message, /resource/);
    assert.equal(source.calls.length, 0); assert.equal(f.server.calls.length, 0);
    const metadata = f.backend.tables().get('metadata'), row = [...metadata.values()][0];
    for (let i = 0; i < 2056; i++) metadata.set(`generated-row-${String(i).padStart(4, '0')}`, structuredClone(row));
    assert.equal((await f.owner.storage.status(signal())).status, 'resource');
    assert.equal(metadata.size, 2057, 'capacity refusal leaves pre-existing rows untouched');
  } finally { reader.dispose(); f.owner.close(); }
});

test('HomeBox owner refuses oversized timestamp payload before pin cloning or durable writes', async () => {
  const f = await homeboxSetup(), sources = currentPinnedFiles(f.state.view);
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, sources).value;
  let verifier;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    const attempt = reader.retain(opened.frame).value, kept = await attempt.result; assert.equal(kept.status, 'ok');
    verifier = createLiveCopyOwner(f.backend);
    const actor = await verifier.observeActor(f.session.actorId, () => true); assert.equal(actor.status, 'ok');
    const home = verifier.bindHome(actor.value, scope, () => true); assert.equal(home.status, 'ok');
    const before = structuredClone(f.backend.tables());
    const pin = { ...kept.value, beforeRetrievedAt: '2026-11-10T00:00:00.' + '0'.repeat(40960) + 'Z' };
    assert.equal((await verifier.keepHomeboxDocument(home.value, pin, pdf.slice().buffer, signal())).status, 'resource');
    assert.deepEqual(f.backend.tables(), before); assert.equal(f.server.calls.length, 1);
    assert.equal(reader.retain(opened.frame).value, attempt, 'a local admission refusal never grants another storage attempt');
  } finally { verifier?.close(); reader.dispose(); f.owner.close(); }
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
    const owner = { ...f.owner, withHomeboxFillPass(view, sources, signal, current, enabled, work) {
      return f.owner.withHomeboxFillPass(view, sources, signal, current, enabled, pass => work({ ...pass,
        status: async () => { startedStatus(); return pending; }, retain: async () => { retains++; return { status: 'ok' }; } }));
    } };
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
    assert.deepEqual((await both).map(result => result.status).sort(), ['ok', 'unavailable'], 'a distinct bulk cancellation owner cannot adopt the running write');
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

test('clear and account replacement remove every registration mark however many exist', async () => {
  const seed = async (f, count) => {
    assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(42)), signal())).status, 'ok');
    const control = f.backend.tables().get('control'), epoch = control.get('witness').epoch;
    for (let index = 0; index < count; index++) {
      control.set(JSON.stringify(['homebox-registration', epoch, scope.workspaceId, scope.homeId, 'generated-source', 'collection-' + index]),
        { version: 1, epoch, registrationVersion: 1, registrationSha256: 'e'.repeat(64) });
    }
    // The backend replaces its tables on every committed write, so read them fresh.
    return () => [...f.backend.tables().get('control').keys()].filter(key => key.includes('homebox-registration')).length;
  };
  const view42 = homeboxView([{ attachmentId: uuid(42), byteSize: '30' }]);
  // 2,057 distinct partitions plus the witness exceed the 2,056-row read allowance; cleanup must not depend on it.
  for (const mode of ['clear', 'account']) {
    const f = await homeboxSetup(transport(), view42);
    try {
      const marks = await seed(f, 2057);
      assert(marks() >= 2057);
      const result = mode === 'clear' ? await f.owner.storage.clear()
        : await f.owner.observe({ actorId: 'generated-actor-other', expiresAt: '2099-01-01T00:00:00Z' }, () => true);
      assert.equal(result.status, 'ok', mode);
      assert.equal(marks(), 0, mode + ' removes every registration mark');
      assert.equal(f.backend.tables().get('metadata').size, 0, mode + ' removes stored rows');
      assert.equal(f.backend.tables().get('bytes').size, 0, mode + ' removes stored bytes');
    } finally { f.owner.close(); }
  }
});

// #560: the ordinary file dialog opens a HomeBox file through this reader and keeps it. A second owner
// with no live session over the same storage stands in for the offline app relaunch (saved-main).
function offlineRelaunch(backend) {
  return createHomeboxRetention({ factory: undefined, backend, state: () => ({ session: null, view: null }),
    homeboxTransport: () => assert.fail('offline relaunch must not request originals'),
    documents: () => { throw new Error('No live document authority in the retained shell'); } });
}
async function openAndKeep(f) {
  const reader = f.owner.createHomeboxOriginalReader(f.state.view, currentPinnedFiles(f.state.view)).value;
  try {
    const opened = await reader.open(ref(), signal()); assert.equal(opened.status, 'ok');
    const kept = reader.retain(opened.frame); assert.equal(kept.status, 'ok');
    return await kept.value.result;
  } finally { reader.dispose(); }
}
test('a HomeBox file opened online opens from the device after an offline relaunch; sign-out and account replacement remove it', async () => {
  const f = await homeboxSetup();
  const stored = await openAndKeep(f); assert.equal(stored.status, 'ok');
  f.owner.close();
  const offline = offlineRelaunch(f.backend);
  try {
    const handle = await readCopy(offline);
    const status = await offline.read.homeboxStatus(handle, ref(), signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'held');
    const blob = await offline.read.readHomeboxDocument(handle, status.value.pin, signal());
    assert.equal(blob.status, 'ok'); assert.equal(blob.value.type, 'application/pdf');
    assert.deepEqual(new Uint8Array(await blob.value.arrayBuffer()), pdf);
    assert.equal(f.server.calls.length, 1, 'one original read online, none offline');
  } finally { offline.close(); }
  // Sign-out clears the copy through the live owner; the next offline launch holds nothing.
  const g = await homeboxSetup();
  try {
    assert.equal((await openAndKeep(g)).status, 'ok');
    assert.equal((await g.owner.storage.clear()).status, 'ok');
  } finally { g.owner.close(); }
  const afterSignOut = offlineRelaunch(g.backend);
  try {
    assert.notEqual((await afterSignOut.read.readLast(signal())).status, 'ok');
    assert.equal(g.backend.tables().get('bytes').size, 0);
  } finally { afterSignOut.close(); }
  // A different account on this device, even for the same home and file listing, never sees the first account's copy.
  const h = await homeboxSetup();
  let first;
  try {
    first = await openAndKeep(h); assert.equal(first.status, 'ok');
    const other = { actorId: 'generated-actor-other', expiresAt: '2099-01-01T00:00:00Z' };
    h.state = { session: other, view: h.state.view };
    assert.equal((await h.owner.observe(other, () => h.state.session === other)).status, 'ok');
    assert.equal((await h.owner.capture(h.state.view, signal())).status, 'ok');
  } finally { h.owner.close(); }
  const replaced = offlineRelaunch(h.backend);
  try {
    const handle = await readCopy(replaced);
    assert.equal((await replaced.read.homeboxStatus(handle, ref(), signal())).value.availability, 'not-held');
    assert.notEqual((await replaced.read.readHomeboxDocument(handle, first.value, signal())).status, 'ok');
    assert.equal([...h.backend.tables().get('metadata').values()].filter(row => row.kind === 'homebox-document').length, 0,
      'account replacement deleted the first account\'s file');
  } finally { replaced.close(); }
});

test('a HomeBox file opened online that storage refuses reports quota and is not held after an offline relaunch', async () => {
  const f = await homeboxSetup(), transaction = f.backend.transaction.bind(f.backend);
  f.backend.transaction = (write, work) => transaction(write, tx => work({ ...tx, put(table, key, value) {
    if (table === 'bytes') throw Object.assign(Error('Generated quota'), { name: 'QuotaExceededError' });
    return tx.put(table, key, value);
  } }));
  assert.equal((await openAndKeep(f)).status, 'quota');
  f.owner.close(); f.backend.transaction = transaction;
  const offline = offlineRelaunch(f.backend);
  try {
    const status = await offline.read.homeboxStatus(await readCopy(offline), ref(), signal());
    assert.equal(status.status, 'ok'); assert.equal(status.value.availability, 'not-held');
  } finally { offline.close(); }
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

test('automatic HomeBox status binds the requested association, epoch and scope before following a valid stored pin', async () => {
  for (const defect of ['association', 'epoch', 'scope']) {
    const f = await homeboxSetup(transport(), homeboxView([42, 43].map(n => ({ attachmentId: uuid(n), byteSize: String(pdf.length) }))));
    const sources = currentPinnedFiles(f.state.view);
    try {
      assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(43)), signal())).status, 'ok');
      if (defect !== 'association') assert.equal((await f.owner.retainHomeboxOriginal(ref(uuid(42)), signal())).status, 'ok');
      let validB;
      const checked = await f.owner.withHomeboxFillPass(f.state.view, sources, signal(), () => true, () => true, async pass => {
        validB = await pass.status(ref(uuid(43)));
        return { message: 'Generated valid B status', complete: validB.status === 'ok' && validB.value.availability === 'held' };
      });
      assert.equal(checked.status, 'ok'); assert.equal(checked.value.complete, true);
      assert.equal(validB.status, 'ok'); assert.equal(validB.value.availability, 'held', 'B has valid bytes and current membership');
      const metadata = f.backend.tables().get('metadata'), bytes = f.backend.tables().get('bytes');
      const [keyB, rowB] = [...metadata].find(([, row]) => row.kind === 'homebox-document' && row.pin.attachmentId === uuid(43));
      const keyA = keyB.replace(uuid(43), uuid(42));
      const wrong = structuredClone(defect === 'association' ? rowB : metadata.get(keyA));
      if (defect === 'epoch') wrong.epoch = uuid(99);
      if (defect === 'scope') wrong.scope = { ...scope, homeId: uuid(99) };
      metadata.set(keyA, wrong); bytes.set(keyA, bytes.get(keyB).slice(0));
      const filled = await fillOfflineHomeboxOriginals({ owner: f.owner, view: f.state.view, pinnedFiles: sources,
        current: () => true, enabled: () => true, signal: signal() });
      assert.equal(filled.complete, false, defect); assert.match(filled.message, /stopped \(integrity\)/, defect);
      assert(!filled.message.includes('2 HomeBox files on this device'), defect);
      assert.equal(f.server.calls.length, defect === 'association' ? 1 : 2, 'status refusal never acquires a fallback original');
      assert.equal(f.owner.homeboxSent(ref(uuid(42))), defect !== 'association', 'status refusal never changes the existing A claim');
    } finally { f.owner.close(); }
  }
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
