// Finite ordinary generated mounting/ownership positives, CPU + React SSR only.
// No browser, native transport, persistence, listener, provider or fault injection.
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'saved-catalog-mounting-'));
let h;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export * from ${JSON.stringify(join(root, 'lantern-tests/offline-catalog-fixture.ts'))};`,
    `export { mountSavedSelection } from ${JSON.stringify(join(root, 'src/offline/SavedAtlasHost.tsx'))};`,
    `export { SavedCatalogView, createSavedOriginalOwner } from ${JSON.stringify(join(root, 'src/offline/SavedCatalogView.tsx'))};`,
  ].join('\n'));
  const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, target: 'node26',
    lib: { entry, formats: ['es'] }, minify: false,
    // Keep the entire React family on the same locked Node module graph.
    // Bundled react-dom CJS would otherwise require the external React from ESM.
    rolldownOptions: { external: id => /^(react|react-dom)(\/|$)/.test(id),
      output: { codeSplitting: false, paths: id => pathToFileURL(require.resolve(id)).href } } } });
  const output = Array.isArray(built) ? built[0] : built;
  const code = output.output.find(row => row.type === 'chunk' && row.isEntry).code;
  assert(!code.includes('__require("react")'), 'React CJS must stay outside the ESM harness');
  const modulePath = join(scratch, 'mounting.mjs'); writeFileSync(modulePath, code);
  h = await import(pathToFileURL(modulePath).href);
} finally { rmSync(scratch, { recursive: true, force: true }); }
const { createElement } = await import(new URL('../node_modules/react/index.js', import.meta.url).href);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
const until = async (predicate, label) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert(Date.now() < deadline, label); await new Promise(resolve => setImmediate(resolve)); }
};
function localStore(fixture) {
  const generated = h.createCatalogFakeStore(fixture), listeners = new Set(), events = [];
  const store = { ...generated.port,
    async list() { events.push('list'); return generated.port.list(); },
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
  };
  return { generated, store, events, listeners, notify() { events.push('notice'); for (const changed of [...listeners]) changed(); } };
}
function observe(local) {
  const state = { selection: null, house: null, catalogs: 0, atlasNull: false, missing: false, errors: [] };
  const mount = h.mountSavedSelection(local.store, local.generatedFixture.house.key, {
    clear() { local.events.push('clear'); state.selection = null; state.house = null; },
    house(house) { state.house = house; },
    catalog(selection) { state.selection = selection; state.catalogs++; },
    atlas(port) { assert.equal(port, null, 'Ordinary fixture has model not-configured'); state.atlasNull = true; },
    catalogError() { state.errors.push('catalog'); }, atlasError() { state.errors.push('atlas'); },
    missing() { state.missing = true; },
  });
  return { state, mount };
}
for (const mode of ['complete', 'partial']) {
  const fixture = await h.generateCatalogFixture(mode), local = localStore(fixture);
  local.generatedFixture = fixture;
  const { state, mount } = observe(local);
  await until(() => state.selection && state.atlasNull, 'Catalog/optional Atlas admission');
  assert.deepEqual(state.errors, []);
  const first = state.selection, catalog = first.read.catalog;
  assert.equal(first.signal.aborted, false); assert(first.isCurrent());
  assert.equal(catalog.inventory.state, mode); assert.equal(catalog.documents.state, mode);
  assert.equal(catalog.inventory.items.length, 2); assert.equal(catalog.documents.items.length, 2);
  assert.equal(new Set(catalog.inventory.items.map(item => item.key)).size, 2);
  assert.equal(first.read.inventoryDetail(catalog.inventory.items[0].key).raw.entity.quantity.token, h.LARGE_QUANTITY);
  assert.equal(h.canonicalPack(first.read.inventoryDetail(catalog.inventory.items[0].key).raw), h.canonicalPack(fixture.entities[0]));
  for (const section of ['inventory', 'documents']) {
    const html = renderToStaticMarkup(createElement(h.SavedCatalogView, { selection: first, section }));
    assert(html.includes(`Saved ${section}`)); assert(html.includes(fixture.house.capturedAt));
    assert(html.includes('Historical, read-only')); assert(html.includes(`Captured coverage: ${mode}`));
    assert(html.includes(fixture.house.localRevision)); assert(html.includes(fixture.house.snapshotId));
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2, 'Both exact-identity records are selectable');
    assert(!html.includes('<a '), 'Listing never opens a provenance URL or original');
    if (section === 'inventory') { assert(html.includes('non-transactional-offset-pages')); assert(html.includes('2024-03-04T05:06:07Z')); }
    if (section === 'documents') {
      assert(html.includes('Original retained; verification required'));
      if (mode === 'partial') assert(html.includes('Original unavailable'));
    }
    if (mode === 'partial') assert(html.includes('retained-bytes-unavailable'), 'Pack omissions remain visible in both views');
  }
  const originals = h.createSavedOriginalOwner(first), disconnect = originals.connect();
  const document = catalog.documents.items[0];
  assert.equal(originals.current().state, 'idle');
  await originals.open(document.key);
  const opened = originals.current(); assert.equal(opened.state, 'verified');
  assert.equal(opened.original.documentId, fixture.docIds[0]); assert.equal(opened.original.documentRevision, h.MAX_REVISION);
  assert.equal(opened.original.assetId, fixture.assetIds[0]); assert.equal(opened.original.sha256, fixture.originalSha);
  assert.equal(opened.original.snapshotId, catalog.snapshotId); assert.equal(opened.original.localRevision, catalog.localRevision);
  assert.equal(Object.hasOwn(opened.original, 'bytes'), false, 'UI metadata owns no duplicate original buffer');
  assert.deepEqual(new Uint8Array(await resolveObjectURL(opened.url).arrayBuffer()), new Uint8Array(fixture.originalBytes));
  originals.close(); assert.equal(resolveObjectURL(opened.url), undefined, 'Explicit Close revokes owned URL');
  await originals.open(document.key); const secondUrl = originals.current().url;
  local.events.length = 0;
  local.notify();
  assert.equal(first.signal.aborted, true); assert.equal(first.isCurrent(), false);
  assert.equal(state.selection, null, 'Store notice clears immediately');
  assert.equal(originals.current().state, 'idle'); assert.equal(resolveObjectURL(secondUrl), undefined, 'Store notice revokes before awaiting re-list');
  assert(local.events.indexOf('clear') < local.events.indexOf('list'));
  await until(() => state.catalogs === 2, 'Catalog re-read after ordinary notice');
  assert.notEqual(state.selection, first); assert.equal(state.selection.read.catalog.localRevision, fixture.house.localRevision);
  disconnect();
  const replacementOwner = h.createSavedOriginalOwner(state.selection), disconnectReplacement = replacementOwner.connect();
  const release = local.generated.pauseAsset(fixture.originalSha);
  const before = local.generated.calls.filter(call => call === `asset:${fixture.originalSha}`).length;
  const pendingOpen = replacementOwner.open(document.key);
  await until(() => local.generated.calls.filter(call => call === `asset:${fixture.originalSha}`).length > before, 'Ordinary asynchronous original read started');
  const prior = state.selection;
  const replacement = structuredClone(fixture.house); replacement.localRevision = '00000000-0000-4000-8000-000000000499';
  local.generated.replace(replacement); local.notify();
  assert.equal(prior.signal.aborted, true); assert.equal(replacementOwner.current().state, 'idle');
  release(); await pendingOpen;
  assert.equal(replacementOwner.current().state, 'idle', 'Retired original request cannot publish a file');
  await until(() => state.catalogs === 3, 'Normal selected-key replacement re-read');
  assert.equal(state.selection.read.catalog.localRevision, replacement.localRevision); assert.equal(state.house.localRevision, replacement.localRevision);
  disconnectReplacement();
  const final = state.selection, finalOwner = h.createSavedOriginalOwner(final), disconnectFinal = finalOwner.connect();
  await finalOwner.open(document.key); const finalUrl = finalOwner.current().url;
  mount.dispose(); mount.dispose();
  assert.equal(final.signal.aborted, true); assert.equal(final.isCurrent(), false);
  assert.equal(finalOwner.current().state, 'idle'); assert.equal(resolveObjectURL(finalUrl), undefined, 'Unmount revokes verified file');
  assert.equal(state.selection, null); assert.equal(local.listeners.size, 0);
  disconnectFinal();
  console.log(`PASS ${mode}: independent model-free catalog, React SSR coverage/lists, exact identity, explicit byte-faithful original, Close/notice/replacement/unmount ownership`);
}
{
  const fixture = await h.generateCatalogFixture(), local = localStore(fixture); local.generatedFixture = fixture;
  const release = local.generated.pauseList(), { state, mount } = observe(local);
  mount.dispose(); release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.catalogs, 0); assert.equal(state.selection, null); assert.equal(local.listeners.size, 0);
  const next = observe(local); await until(() => next.state.selection, 'Fresh normal selection after closed mount');
  local.generated.replace(null); local.notify();
  assert.equal(next.state.selection, null); await until(() => next.state.missing, 'Removed selected house');
  assert.equal(next.state.catalogs, 1); next.mount.dispose();
  console.log('PASS normal opening/close/removal: closed pending read cannot publish; no retained selection after removal');
}
const viewSource = readFileSync(new URL('../src/offline/SavedCatalogView.tsx', import.meta.url), 'utf8');
assert(viewSource.includes('canonicalPack(value)')); assert(viewSource.includes('<Raw value={detail.raw} />'));
assert(!viewSource.includes('dangerouslySetInnerHTML')); assert(!viewSource.includes('window.open'));
console.log('CPU ownership + React SSR only; actual browser controls/focus/downloads, IndexedDB, native/offline, iOS/PWA/device acceptance remain open.');
