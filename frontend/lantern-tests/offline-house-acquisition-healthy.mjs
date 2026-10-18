// Named ordinary generated explicit-action acquisition and lifecycle positives.
// No global fetch replacement, listener, browser, native service or real storage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.equal(process.argv.length, 3, 'Pass the retained generated handoff directory');
const fixtureRoot = resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buffer = bytes => Uint8Array.from(bytes).buffer;
async function source(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: file.pathname.endsWith('.tsx') ? 'tsx' : 'ts', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:') || (match[1].startsWith('file:') && Object.values(replacements).includes(match[1])), `Unexpected import ${match[1]}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const decimal = await source('../src/numeric/decimal.ts');
const lossless = await source('../src/numeric/lossless-json.ts', { './decimal': decimal });
const storage = await source('../src/offline/store.ts');
const manifestURL = await source('../src/offline/manifest.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, './store': storage });
const geometry = await source('../src/lantern/canonical-ifc/geometry.ts');
const types = await source('../src/lantern/unified-atlas/types.ts');
const sceneURL = await source('../src/lantern/unified-atlas/scene.ts', { '../canonical-ifc/geometry': geometry, './types': types });
const modelURL = await source('../src/offline/model-v2.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, '../lantern/unified-atlas/scene': sceneURL, './manifest': manifestURL });
const acquireURL = await source('../src/offline/acquire-house.ts', { './manifest': manifestURL,
  '../numeric/lossless-json': lossless, './model-v2': modelURL, './store': storage });
const serviceURL = await source('../integration/offline-house-acquisition.ts');
const { createHouseAcquisition } = await import(acquireURL);
const { createOfflineHouseAcquisition } = await import(serviceURL);
const { readPackManifest, packPrefix } = await import(manifestURL);
const { readSavedAtlasModel } = await import(modelURL);
const { validateSavedHouse, savedDigest } = await import(storage);
const { createElement } = await import(new URL('../node_modules/react/index.js', import.meta.url).href);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
const copyURL = await source('../src/offline/SaveHouseCopy.tsx', {
  react: new URL('../node_modules/react/index.js', import.meta.url).href,
  'react/jsx-runtime': new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href,
});
const { SaveHouseCopy } = await import(copyURL);
const pins = { records: 'de82fe13d91ba79cc195deb2e9b8c871bd200455d9e0062633c4b41ddf1f6f03',
  partial: 'b78f542a2070f91f34b8e273907e9d411b1eb6e932946bf56bbd2d553be7ff2b',
  unified: '53de1b25f27284acc343f450c8ff649317d105973a32b113d11f1631ce2c38ba',
  documents: '3c5d89cadeb51ff21c87134ca5164b2824aa954d2dde3af985f77e4bc53db297' };
assert.equal(JSON.parse(readFileSync(`${fixtureRoot}/QUALIFICATION.json`)).head, '052a9ef8537354e789f4e69255a0d84ef6b1c0a7');
const fixtures = new Map();
for (const [name, pin] of Object.entries(pins)) {
  const raw = readFileSync(`${fixtureRoot}/fixtures/${name}/manifest.json`); assert.equal(hash(raw), pin);
  const manifest = await readPackManifest(buffer(raw), JSON.parse(raw).scope), resources = new Map();
  for (const resource of manifest.resources) {
    const bytes = readFileSync(`${fixtureRoot}/fixtures/${name}/${resource.sha256}`);
    assert.equal(hash(bytes), resource.sha256); assert.equal(bytes.length, resource.bytes); resources.set(resource.sha256, bytes);
  }
  fixtures.set(name, { raw, manifest, resources });
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function memoryStore(prior = null, hooks = {}) {
  let committed = prior, pending = null, closes = 0, begins = 0, activations = 0;
  const assets = new Map(), ranges = new Map(), discarded = [];
  return { assets, discarded, committed: () => committed, closes: () => closes, begins: () => begins, activations: () => activations,
    list: async () => { await hooks.list?.(); return committed ? [structuredClone(committed)] : []; },
    async begin(input) {
      begins++; const stage = { ...structuredClone(input), localRevision: randomUUID(), token: randomUUID(), epoch: randomUUID() };
      validateSavedHouse(stage); pending = stage; await hooks.begin?.(stage); return stage;
    },
    retained: async (_stage, resource) => assets.get(resource.sha256) ?? null,
    range: async (_stage, resource, start) => ranges.get(resource.sha256 + '@' + start) ?? null,
    async putRange(stage, resource, start, bytes) { assert.equal(stage.token, pending.token); ranges.set(resource.sha256 + '@' + start, bytes); await hooks.range?.(); },
    async put(stage, resource, bytes) {
      assert.equal(stage.token, pending.token); assert.equal(bytes.byteLength, resource.bytes);
      assert.equal(await savedDigest(bytes), resource.sha256); assets.set(resource.sha256, bytes);
    },
    async activate(stage, options) {
      options.signal.throwIfAborted(); assert(options.current()); assert.equal(stage.token, pending.token);
      for (const resource of stage.resources) { assert.equal(assets.get(resource.sha256)?.byteLength, resource.bytes); }
      const { token: _token, epoch: _epoch, ...house } = stage;
      committed = house; pending = null; activations++; await hooks.committed?.(); return house;
    },
    async discardStage(stage) {
      discarded.push(stage);
      if (pending?.token === stage.token && pending.epoch === stage.epoch) pending = null;
    },
    async close() { closes++; await hooks.close?.(); },
  };
}
function transportFor(fixture, hooks = {}) {
  const calls = [], prefix = packPrefix(fixture.manifest.scope);
  return { calls, async get(input, init) {
    const url = new URL(input, 'https://generated.example'); assert.equal(url.origin, 'https://generated.example');
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    calls.push({ path: url.pathname, init });
    const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
    if (url.pathname === prefix + '/manifest') {
      assert.equal(init.headers.Accept, 'application/json'); await hooks.manifest?.();
      return new Response(fixture.raw, { headers: { ...headers, 'content-type': 'application/json', 'content-length': String(fixture.raw.length) } });
    }
    const resource = fixture.manifest.resources.find(row => url.pathname === `${prefix}/snapshots/${fixture.manifest.snapshotId}/resources/${row.sha256}`); assert(resource);
    const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(init.headers.Range); assert(match);
    const start = Number(match[1]), end = Number(match[2]); assert.equal(start % 4194304, 0); assert(end - start < 4194304);
    const bytes = fixture.resources.get(resource.sha256).subarray(start, end + 1); assert.equal(bytes.length, end - start + 1);
    assert.equal(init.headers.Accept, resource.contentType);
    return new Response(bytes, { status: 206, headers: { ...headers, 'content-type': resource.contentType,
      'content-length': String(bytes.length), 'content-range': `bytes ${start}-${end}/${resource.bytes}`,
      'x-atlas-offline-resource-sha256': resource.sha256,
      'content-digest': `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:` } });
  } };
}
const shellBuildId = 'a'.repeat(64);
let resources = 0, ranges = 0;
const captures = new Map();
for (const [name, fixture] of fixtures) {
  const store = memoryStore(), transport = transportFor(fixture), progress = [];
  const core = createHouseAcquisition({ scope: fixture.manifest.scope, label: 'Generated whole house', store,
    signal: new AbortController().signal, current: () => true, onProgress: value => progress.push(value),
    transport: transport.get, verifyShell: async () => ({ ready: true, buildId: shellBuildId }) });
  assert.equal(transport.calls.length, 0); assert.equal(store.begins(), 0);
  const preparation = await core.prepare(); assert.equal(preparation.prior, null); assert.equal(store.begins(), 0);
  const receipt = await core.save(preparation); validateSavedHouse(receipt.house);
  captures.set(name, { preparation, receipt });
  assert.equal(receipt.house.shellBuildId, shellBuildId); assert.equal(receipt.house.snapshotId, fixture.manifest.snapshotId);
  assert.equal(receipt.completeness, fixture.manifest.completeness); assert.deepEqual(receipt.exclusions, fixture.manifest.exclusions);
  const local = await readPackManifest(receipt.house.manifest, fixture.manifest.scope, true);
  assert.equal(local.snapshotId, fixture.manifest.snapshotId); assert(!Buffer.from(receipt.house.manifest).toString().includes('"href"'));
  for (const resource of fixture.manifest.resources) assert.deepEqual(Buffer.from(store.assets.get(resource.sha256)), fixture.resources.get(resource.sha256));
  assert.equal(store.activations(), 1); assert.equal(store.discarded.length, 0);
  assert.equal(progress.at(-1).done, fixture.manifest.totalBytes);
  if (name === 'partial') assert.equal(readSavedAtlasModel(store.assets.get(local.sections.model.resourceSha256), local).unified, null);
  if (name === 'records') assert.equal(local.sections.model.resourceSha256, null);
  if (name === 'unified' || name === 'documents') {
    const model = readSavedAtlasModel(store.assets.get(local.sections.model.resourceSha256), local);
    assert.equal(model.unified.companion.bytes, 8388625); assert.equal(model.unified.companion.role, 'model/model');
  }
  resources += store.assets.size; ranges += transport.calls.length - 1; await core.close(); assert.equal(store.closes(), 1);
}
assert.equal(resources, 42); assert.equal(ranges, 46);

// Actual static React presentation of valid ordinary states. Rendering must
// remain passive; byte counts, capture dates and source exclusions stay intact.
function renderCopy(state) {
  let actions = 0;
  const port = { getState: () => state, subscribe: () => () => {},
    async prepare() { actions++; }, async save() { actions++; }, cancel() { actions++; } };
  const html = renderToStaticMarkup(createElement(SaveHouseCopy, { port }));
  assert.equal(actions, 0);
  assert(html.includes('<summary tabindex="0">Saved house copy</summary>'));
  assert(html.includes('unencrypted in this browser profile and remains after sign-out'));
  assert(html.includes('browser persistence is not guaranteed'));
  assert(html.includes('href="/saved/index.html"'));
  return html;
}
const idleHTML = renderCopy({ status: 'idle' });
assert(idleHTML.includes('>Prepare house copy</button>'));
const { preparation: newCapture, receipt: priorCapture } = captures.get('records');
const readyHTML = renderCopy({ status: 'ready', preparation: newCapture });
assert(readyHTML.includes(`New capture: ${newCapture.capturedAt}`));
assert(readyHTML.includes(`Coverage: ${newCapture.completeness}`));
assert(readyHTML.includes('>Save house copy</button>'));
const replaceHTML = renderCopy({ status: 'ready', preparation: { ...newCapture, prior: priorCapture.house } });
assert(replaceHTML.includes(`Currently saved: captured ${priorCapture.house.capturedAt} · revision ${priorCapture.house.localRevision}. Saving will replace it.`));
assert(replaceHTML.includes('>Replace saved copy</button>'));
assert(replaceHTML.indexOf('Currently saved:') < replaceHTML.indexOf('>Replace saved copy</button>'));
assert(replaceHTML.includes('>Cancel</button>'));
const partialCapture = [...captures.values()].find(value => value.preparation.exclusions.length > 0);
assert(partialCapture);
const partialHTML = renderCopy({ status: 'ready', preparation: partialCapture.preparation });
assert(partialHTML.includes('Not included in this copy:'));
assert(partialHTML.indexOf('Not included in this copy:') < partialHTML.indexOf('>Save house copy</button>'));
assert(partialHTML.includes(`Coverage: ${partialCapture.preparation.completeness}`));
for (const item of partialCapture.preparation.exclusions)
  assert(partialHTML.includes(renderToStaticMarkup(createElement('li', null, `${item.section}: ${item.label} (${item.code})`))));
const preparingHTML = renderCopy({ status: 'preparing', progress: { phase: 'app', done: 0, total: 0 } });
assert(preparingHTML.includes('Preparing house copy…')); assert(preparingHTML.includes('>Cancel</button>'));
const savingHTML = renderCopy({ status: 'saving', preparation: newCapture,
  progress: { phase: 'house', done: 1, total: newCapture.totalBytes } });
assert(savingHTML.includes('>Stop saving</button>'));
const savedHTML = renderCopy({ status: 'saved', receipt: partialCapture.receipt });
assert(savedHTML.includes('Not included in this copy:'));
assert(savedHTML.includes(`Coverage: ${partialCapture.receipt.completeness}`));
for (const item of partialCapture.receipt.exclusions)
  assert(savedHTML.includes(renderToStaticMarkup(createElement('li', null, `${item.section}: ${item.label} (${item.code})`))));
for (const value of [partialCapture.receipt.house.snapshotId, partialCapture.receipt.house.localRevision,
  partialCapture.receipt.house.shellBuildId]) assert(savedHTML.includes(value));

// Actual native owner service: passive observation, unchanged refresh, explicit
// Save/Replace, ordinary view replacement, Cancel and a late committed receipt.
const fixture = fixtures.get('records');
function serviceWith(store, hooks = {}) {
  const scope = { ...fixture.manifest.scope }, session = { expiresAt: new Date(Date.now() + 3600000).toISOString() };
  let state = { scope, session, view: { status: 'ready', scope, homeLabel: 'Actual generated home label' } };
  let loads = 0, shells = 0;
  const transport = transportFor(fixture, hooks);
  const service = createOfflineHouseAcquisition({ state: () => state, origin: 'https://generated.example', transport: transport.get,
    load: async () => { loads++; await hooks.load?.(); return { createHouseAcquisition,
      createSavedHouseStore: () => store, verifySavedShell: async () => { shells++; await hooks.shell?.(); return { ready: true, buildId: shellBuildId }; } }; } });
  return { service, transport, loads: () => loads, shells: () => shells,
    replaceView() { state = { ...state, view: { ...state.view } }; service.refresh(); },
    retire() { state = { scope: null, session: null, view: null }; service.refresh(); } };
}
{
  const shellEntered = deferred(), shellRelease = deferred(), store = memoryStore();
  const owner = serviceWith(store, { shell: async () => { shellEntered.resolve(); await shellRelease.promise; } });
  owner.service.refresh(); const unsubscribe = owner.service.port.subscribe(() => undefined); owner.service.port.getState();
  assert.equal(owner.loads(), 0); assert.equal(owner.transport.calls.length, 0); assert.equal(store.begins(), 0);
  const preparing = owner.service.port.prepare(); await shellEntered.promise;
  owner.service.refresh(); assert.equal(owner.service.port.getState().status, 'preparing'); shellRelease.resolve(); await preparing;
  assert.equal(owner.service.port.getState().status, 'ready'); assert.equal(owner.shells(), 1);
  await owner.service.port.save(); const first = owner.service.port.getState().receipt;
  assert.equal(first.house.label, 'Actual generated home label'); assert.equal(store.closes(), 1);
  await owner.service.port.prepare(); const prior = owner.service.port.getState().preparation.prior;
  assert.equal(prior.localRevision, first.house.localRevision);
  await owner.service.port.save(prior.localRevision); const replaced = owner.service.port.getState().receipt;
  assert.notEqual(replaced.house.localRevision, first.house.localRevision); assert.equal(store.activations(), 2);
  unsubscribe(); owner.retire(); assert.equal(owner.service.port.getState().receipt.house.localRevision, replaced.house.localRevision);
}
{
  const entered = deferred(), release = deferred(), store = memoryStore();
  const owner = serviceWith(store, { load: async () => { entered.resolve(); await release.promise; } });
  const preparing = owner.service.port.prepare(); await entered.promise; owner.replaceView(); release.resolve(); await preparing;
  assert.equal(owner.service.port.getState().status, 'retired'); assert.equal(owner.transport.calls.length, 0); assert.equal(store.begins(), 0); owner.retire();
}
{
  const entered = deferred(), release = deferred(), store = memoryStore();
  const owner = serviceWith(store, { manifest: async () => { entered.resolve(); await release.promise; } });
  const preparing = owner.service.port.prepare(); await entered.promise; owner.replaceView();
  assert(owner.transport.calls[0].init.signal.aborted); release.resolve(); await preparing;
  assert.equal(store.begins(), 0); assert.equal(store.closes(), 1); owner.retire();
}
{
  const seed = memoryStore(), wire = transportFor(fixture);
  const core = createHouseAcquisition({ scope: fixture.manifest.scope, label: 'Prior capture', store: seed,
    signal: new AbortController().signal, current: () => true, onProgress() {}, transport: wire.get,
    verifyShell: async () => ({ ready: true, buildId: shellBuildId }) });
  const prior = (await core.save(await core.prepare())).house; await core.close();
  const entered = deferred(), release = deferred();
  const store = memoryStore(prior, { begin: async () => { entered.resolve(); await release.promise; } });
  const owner = serviceWith(store); await owner.service.port.prepare();
  const saving = owner.service.port.save(prior.localRevision); await entered.promise;
  owner.service.port.cancel(); assert.equal(store.closes(), 0); release.resolve(); await saving;
  assert.equal(owner.service.port.getState().status, 'canceled'); assert.equal(store.discarded.length, 1);
  assert.equal(store.discarded[0].key, prior.key); assert.equal(store.activations(), 0);
  assert.equal(store.committed().localRevision, prior.localRevision); assert.equal(store.closes(), 1); owner.retire();
}
{
  let owner;
  const store = memoryStore(null, { committed: async () => { owner.service.port.cancel(); owner.replaceView(); } });
  owner = serviceWith(store); await owner.service.port.prepare(); await owner.service.port.save();
  assert.equal(owner.service.port.getState().status, 'saved'); assert.equal(store.discarded.length, 0);
  assert.equal(owner.service.port.getState().receipt.house.localRevision, store.committed().localRevision); assert.equal(store.closes(), 1); owner.retire();
}
{
  const entered = deferred(), release = deferred();
  const store = memoryStore(null, { range: async () => { entered.resolve(); await release.promise; } });
  const owner = serviceWith(store); await owner.service.port.prepare(); const saving = owner.service.port.save(); await entered.promise;
  owner.service.port.cancel(); assert.equal(store.closes(), 0); release.resolve(); await saving;
  assert.equal(store.activations(), 0); assert.equal(store.discarded.length, 1); assert.equal(store.closes(), 1); owner.retire();
}
{
  const closing = deferred(), release = deferred();
  const store = memoryStore(null, { close: async () => { closing.resolve(); await release.promise; } });
  const owner = serviceWith(store); await owner.service.port.prepare();
  const saving = owner.service.port.save(); await closing.promise;
  const committed = owner.service.port.getState(); assert.equal(committed.status, 'saved');
  owner.service.port.cancel();
  assert.equal(owner.service.port.getState().status, 'saved');
  assert.equal(owner.service.port.getState().receipt, committed.receipt);
  assert.equal(store.discarded.length, 0); release.resolve(); await saving;
  assert.equal(owner.service.port.getState().status, 'saved'); owner.retire();
}
console.log(JSON.stringify({ result: 'healthy', variants: 4, resources, ranges,
  presentation: ['idle-prepare', 'ready-new', 'ready-replace', 'ready-partial', 'preparing', 'saving', 'saved-partial'],
  lifecycle: ['passive', 'unchanged-owner', 'explicit-save', 'explicit-replace', 'view-replacement', 'cancel-after-begin', 'cancel-range', 'late-commit', 'cancel-during-committed-close'] }));
