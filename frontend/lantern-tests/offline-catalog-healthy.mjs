// Explicit generated catalog positives; no network, browser, native port or session.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
globalThis.fetch = () => { throw new Error('External transport is forbidden in generated catalog tests'); };
export async function loadCatalogHarness() {
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-catalog-positive-'));
  try {
    const entry = fileURLToPath(new URL('./offline-catalog-fixture.ts', import.meta.url));
    const built = await build({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, logLevel: 'silent',
      build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
    const output = Array.isArray(built) ? built[0] : built;
    const modulePath = join(scratch, 'catalog.mjs');
    writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
    return await import(pathToFileURL(modulePath).href);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
async function positive(mode) {
  const h = await loadCatalogHarness();
  const fixture = await h.generateCatalogFixture(mode), store = h.createCatalogFakeStore(fixture);
  const selection = new AbortController();
  const sections = await h.readSavedPackSections(store.port, fixture.house, selection.signal);
  store.calls.length = 0;
  const read = await h.createSavedCatalogAdapter(store.port).read(sections, selection.signal);
  const { catalog } = read;
  assert.equal(catalog.kind, 'saved');
  for (const key of ['key', 'snapshotId', 'localRevision', 'capturedAt']) assert.equal(catalog[key], fixture.house[key]);
  assert.equal(catalog.completeness, mode);
  assert.equal(catalog.inventory.state, mode); assert.equal(catalog.documents.state, mode);
  assert.equal(catalog.inventory.requiredBytesComplete, mode === 'complete');
  assert.equal(catalog.documents.requiredBytesComplete, mode === 'complete');
  assert.equal(catalog.inventory.items.length, 2); assert.equal(catalog.documents.items.length, 2);
  assert.equal(new Set(catalog.inventory.items.map(row => row.key)).size, 2, 'source tuples distinguish shared external IDs across collections');
  const inventory = catalog.inventory.items.find(row => row.title === 'Storage cage');
  const archived = catalog.inventory.items.find(row => row.title === 'Archived unknown type');
  assert.equal(inventory.sourceUpdatedAt, '2011-02-03T00:00:00Z');
  assert.equal(inventory.retrievedAt, '2024-03-04T05:06:07Z');
  assert.equal(inventory.raw.entity.entityType.name, 'Movable cage');
  assert.equal(inventory.raw.entity.parent, null); assert.equal(archived.raw.entity.entityType, null);
  assert.equal(archived.raw.entity.archived, true); assert.equal(archived.sourceUpdatedAt, null);
  assert.equal(h.canonicalPack(inventory.raw), h.canonicalPack(fixture.entities[0]), 'every captured inventory field remains lossless');
  assert.equal(inventory.raw.entity.quantity.token, h.LARGE_QUANTITY);
  assert.equal(inventory.raw.maintenance[0].cost.token, '1.234567890123456789');
  assert.equal(inventory.raw.maintenance[0].completedDate, null);
  assert.equal(inventory.raw.maintenance[0].scheduledDate, '2020-02-03');
  assert.equal(inventory.raw.nativeLinks[0].href, 'https://example.invalid/homebox/generated');
  assert.equal(catalog.inventory.caches[0].lastSuccessfulFetchAt, '2024-03-04T05:06:07Z');
  assert.equal(catalog.inventory.sources[0].owner, 'homebox');
  assert.strictEqual(read.inventoryDetail(inventory.key), inventory);
  assert.equal(read.inventoryDetail('not-retained'), null); assert.equal(read.documentDetail(inventory.key), null);
  const documents = catalog.documents.items;
  const first = documents.find(row => row.raw.recordId === fixture.docIds[0]);
  const second = documents.find(row => row.raw.recordId === fixture.docIds[1]);
  assert.equal(h.canonicalPack(first.raw), h.canonicalPack(fixture.documents[0]), 'every captured document field remains lossless');
  assert.equal(first.revision, h.MAX_REVISION); assert.equal(first.raw.revision.token, h.MAX_REVISION);
  assert.equal(first.createdAt, '1998-04-05T00:00:00Z'); assert.equal(first.updatedAt, '2024-03-04T05:06:07Z');
  assert.equal(first.lifecycle, 'active'); assert.equal(first.raw.payload.provenance.published.precision, 'year');
  assert.equal(first.raw.payload.provenance.published.value, '1998');
  assert.equal(first.raw.payload.provenance.observed, null); assert.equal(first.raw.payload.provenance.license.status, 'unknown');
  assert.strictEqual(read.documentDetail(first.key), first);
  assert.equal(first.original.state, 'retained-unverified');
  assert.equal(first.original.resource.role, 'documents/original');
  assert.equal(first.original.resource.record.recordId, fixture.docIds[0], 'canonical first document descriptor is retained across SHA reuse');
  assert.equal(store.calls.filter(call => call === `asset:${fixture.originalSha}`).length, 0, 'listing does not open originals');
  const opened = await read.openOriginal(first.key, new AbortController().signal);
  assert.equal(opened.kind, 'saved-original'); assert.equal(opened.capturedAt, h.CAPTURED_AT);
  assert.equal(opened.snapshotId, fixture.house.snapshotId); assert.equal(opened.localRevision, fixture.house.localRevision);
  assert.equal(opened.documentId, fixture.docIds[0]); assert.equal(opened.documentRevision, h.MAX_REVISION);
  assert.equal(opened.assetId, fixture.assetIds[0]); assert.equal(opened.assetRevision, h.MAX_REVISION);
  assert.equal(opened.sha256, fixture.originalSha); assert.equal(opened.contentType, 'application/json');
  assert.deepEqual(new Uint8Array(opened.bytes), new Uint8Array(fixture.originalBytes), 'all original whitespace, UTF-8 and numeric bytes survive');
  new Uint8Array(opened.bytes).fill(0);
  const reopened = await read.openOriginal(first.key, new AbortController().signal);
  assert.deepEqual(new Uint8Array(reopened.bytes), new Uint8Array(fixture.originalBytes), 'caller-owned bytes cannot alter later opens');
  assert.throws(() => { inventory.raw.entity.name = 'Changed'; }, TypeError);
  assert.throws(() => { first.raw.revision = 'Changed'; }, TypeError);
  if (mode === 'complete') {
    assert.equal(catalog.inventory.exclusions.length, 0); assert.equal(catalog.documents.exclusions.length, 0);
    assert.equal(second.original.state, 'retained-unverified');
    const shared = await read.openOriginal(second.key, new AbortController().signal);
    assert.equal(shared.documentId, fixture.docIds[1]); assert.equal(shared.assetId, fixture.assetIds[1]);
    assert.equal(shared.documentRevision, '9007199254740990');
    assert.deepEqual(new Uint8Array(shared.bytes), new Uint8Array(fixture.originalBytes));
  } else {
    assert(catalog.inventory.exclusions.some(row => row.code === 'source-withheld'));
    assert(catalog.inventory.exclusions.some(row => row.code === 'external-attachments-unarchived'));
    assert(catalog.documents.exclusions.some(row => row.code === 'retained-bytes-unavailable'));
    assert.equal(inventory.raw.attachments[0].archived, false);
    assert.equal(second.original.state, 'unavailable'); assert(second.original.reason);
    assert(catalog.documents.reasons.length > 0);
  }
  read.withdraw();
  console.log(`PASS ${mode}: scoped lists/details, historical qualifiers, exact decimals, shared canonical descriptor and byte-faithful originals`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4, 'Choose exactly --case complete or --case partial');
  assert.equal(process.argv[2], '--case');
  assert(['complete', 'partial'].includes(process.argv[3]));
  await positive(process.argv[3]);
}
