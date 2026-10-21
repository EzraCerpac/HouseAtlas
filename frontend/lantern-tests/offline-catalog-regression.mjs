// Named in-memory failure/concurrency cases only. No network, browser or persistence.
import assert from 'node:assert/strict';
import { loadCatalogHarness } from './offline-catalog-healthy.mjs';
assert.equal(process.version, 'v26.10.0');
const cases = ['missing-original', 'corrupt-original', 'wrong-mime', 'wrong-size', 'cancel-read', 'cancel-catalog-read', 'cancel-open', 'selection-withdrawal', 'selection-signal', 'local-revision', 'removed-copy'];
assert.equal(process.argv.length, 4, 'Choose one explicit --case from the documented allowlist');
assert.equal(process.argv[2], '--case');
const selected = process.argv[3]; assert(cases.includes(selected));
const h = await loadCatalogHarness(), fixture = await h.generateCatalogFixture(), store = h.createCatalogFakeStore(fixture);
const selection = new AbortController(), adapter = h.createSavedCatalogAdapter(store.port);
const untilRead = async id => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (store.calls.includes(`asset:${id}`)) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Generated read did not reach paused resource ${id}`);
};
if (selected === 'cancel-read') {
  const release = store.pauseAsset(fixture.pins.inventory);
  const pending = h.readSavedPackSections(store.port, fixture.house, selection.signal).then(sections => adapter.read(sections, selection.signal));
  const rejected = assert.rejects(pending);
  await untilRead(fixture.pins.inventory); selection.abort(new Error('Generated selection changed')); release();
  await rejected;
} else if (selected === 'cancel-catalog-read') {
  const sections = await h.readSavedPackSections(store.port, fixture.house, selection.signal);
  store.calls.length = 0;
  const release = store.pauseList();
  const pending = adapter.read(sections, selection.signal), rejected = assert.rejects(pending);
  assert(store.calls.includes('list'), 'the catalog owns a pending local revision check');
  selection.abort(new Error('Generated catalog selection changed')); release();
  await rejected;
} else {
  const sections = await h.readSavedPackSections(store.port, fixture.house, selection.signal);
  store.calls.length = 0;
  if (selected === 'missing-original') store.originalMode('missing');
  if (selected === 'corrupt-original') store.originalMode('corrupt');
  if (selected === 'wrong-mime') store.originalMode('mime');
  if (selected === 'wrong-size') store.originalMode('size');
  const read = await adapter.read(sections, selection.signal);
  const document = read.catalog.documents.items[0];
  assert(read.documentDetail(document.key), 'metadata remains readable independently of damaged local originals');
  assert.equal(store.calls.includes(`asset:${fixture.originalSha}`), false);
  if (['missing-original', 'corrupt-original', 'wrong-mime', 'wrong-size'].includes(selected)) {
    await assert.rejects(read.openOriginal(document.key, new AbortController().signal));
    assert(read.documentDetail(document.key));
  } else {
    const release = store.pauseAsset(fixture.originalSha), request = new AbortController();
    const pending = read.openOriginal(document.key, request.signal), rejected = assert.rejects(pending);
    await untilRead(fixture.originalSha);
    if (selected === 'cancel-open') request.abort(new Error('Generated request cancelled'));
    if (selected === 'selection-withdrawal') read.withdraw();
    if (selected === 'selection-signal') selection.abort(new Error('Generated selection changed'));
    if (selected === 'local-revision') store.replace({ ...fixture.house, localRevision: '00000000-0000-4000-8000-000000000999' });
    if (selected === 'removed-copy') store.replace(null);
    release(); await rejected;
    if (['selection-withdrawal', 'selection-signal'].includes(selected)) {
      assert.throws(() => read.documentDetail(document.key));
      assert.throws(() => read.inventoryDetail(read.catalog.inventory.items[0].key));
      await assert.rejects(read.openOriginal(document.key, new AbortController().signal));
    }
    if (selected === 'cancel-open') {
      assert(read.documentDetail(document.key), 'request cancellation leaves the selected catalog readable');
      const next = await read.openOriginal(document.key, new AbortController().signal);
      assert.deepEqual(new Uint8Array(next.bytes), new Uint8Array(fixture.originalBytes));
    }
  }
  read.withdraw();
}
console.log(`PASS ${selected}: rejected pending byte delivery with no external transport or original mutation`);
