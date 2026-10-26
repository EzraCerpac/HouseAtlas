// One named generated root/Saved lifecycle check. VM-local transports only:
// no global fetch replacement, socket, browser, native state or real private data.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { offlineShellPlugin } from '../build/offline-shell-plugin.mjs';
assert.equal(process.version, 'v26.10.0'); assert.deepEqual(process.argv.slice(2), []);
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://generated.example', prefix = 'houseatlas-saved-public-';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(frontend, path), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-root-entry-generated-'));
const cases = [];
function cacheStorage() {
  const stores = new Map();
  const key = input => new URL(typeof input === 'string' ? input : input.url ?? input.href, origin).href;
  return { stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const rows = stores.get(name);
      return { match: async input => rows.get(key(input))?.clone(),
        async put(input, response) { rows.set(key(input), response.clone()); } };
    },
    keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
  };
}
function generatedBuild(version) {
  const directory = join(scratch, version); mkdirSync(join(directory, 'saved'), { recursive: true }); mkdirSync(join(directory, 'assets/pdfjs'), { recursive: true });
  const html = '<!doctype html><html><head></head><body><div id="root"></div><script src="/assets/saved.js"></script></body></html>';
  const assets = { '/saved/index.html': html, '/assets/saved.js': `/* generated public Saved entry ${version} */`, '/assets/saved.css': 'body{color:black}',
    '/assets/pdfjs/openjpeg_nowasm_fallback.js': `/* generated public JPEG decoder ${version} */`,
    '/assets/pdfjs/jbig2_nowasm_fallback.js': `/* generated public JBIG decoder ${version} */` };
  for (const [path, bytes] of Object.entries(assets)) writeFileSync(join(directory, path), bytes);
  // Root/auth responses are deliberately outside the public cache closure.
  writeFileSync(join(directory, 'index.html'), '<div id="root">generated native bootstrap</div>');
  const plugin = offlineShellPlugin(); plugin.configResolved({ root: frontend, build: { outDir: directory } }); plugin.closeBundle();
  const saved = readFileSync(join(directory, 'saved/service-worker.js'), 'utf8');
  const root = readFileSync(join(directory, 'offline-entry-worker.js'), 'utf8');
  const buildId = JSON.parse(saved.match(/^const BUILD=("[a-f0-9]{64}")/)[1]);
  const table = JSON.parse(saved.match(/, TABLE=(\[[^\n]*\]);/)[1]);
  const unmarked = table.map(pin => pin.path === '/saved/index.html' ? { ...pin, bytes: Buffer.byteLength(html), sha256: hash(html) } : pin);
  assert.equal(buildId, hash(hash(JSON.stringify(unmarked) + read('build/offline-worker-source.js')) + read('build/root-offline-worker-source.js')));
  assert(root.startsWith(`const ROOT_BUILD="${buildId}";`));
  assert.deepEqual(table.map(pin => pin.path), ['/assets/pdfjs/jbig2_nowasm_fallback.js', '/assets/pdfjs/openjpeg_nowasm_fallback.js', '/assets/saved.css', '/assets/saved.js', '/saved/index.html']);
  const responses = new Map(table.map(pin => {
    const bytes = readFileSync(join(directory, pin.path)); assert.equal(bytes.length, pin.bytes); assert.equal(hash(bytes), pin.sha256);
    return [pin.path, new Response(bytes, { headers: { 'content-type': pin.mime } })];
  }));
  return { saved, root, buildId, table, responses };
}
function workerRuntime(build, kind, storage, wire) {
  const listeners = new Map(), calls = [], imports = [];
  let skipped = 0, claimed = 0;
  const context = vm.createContext({ URL, Response, Map, Uint8Array, crypto: webcrypto, caches: storage, setTimeout, clearTimeout,
    fetch: async (input, init) => { calls.push({ input, init }); return wire(input, init); },
    self: { location: { origin }, skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; } },
      addEventListener(type, listener) { const rows = listeners.get(type) ?? []; rows.push(listener); listeners.set(type, rows); } },
    importScripts(path) { assert.equal(path, '/saved/service-worker.js'); imports.push(path); vm.runInContext(build.saved, context); },
  });
  vm.runInContext(kind === 'root' ? build.root : build.saved, context);
  async function lifecycle(type) {
    const promises = []; for (const listener of listeners.get(type) ?? []) listener({ waitUntil: value => promises.push(value) });
    await Promise.all(promises);
  }
  async function message(data, port) {
    const promises = []; for (const listener of listeners.get('message') ?? []) listener({ data, ports: [port], waitUntil: value => promises.push(value) });
    await Promise.all(promises);
  }
  function fetchEvent(request) {
    let response = null, handled = 0;
    for (const listener of listeners.get('fetch') ?? []) listener({ request, respondWith(value) { response = value; handled++; } });
    assert(handled <= 1, 'Root and Saved fetch handlers must not both own a request');
    return response;
  }
  return { calls, imports, lifecycle, message, fetchEvent, skipped: () => skipped, claimed: () => claimed };
}
const request = (path, options = {}) => ({ url: new URL(path, origin).href, method: 'GET', mode: 'navigate', ...options });
function serviceWorkers() {
  const registrations = new Map(), calls = [], events = [];
  let target, storage, online = true;
  function publicWire(input, init) {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'reload');
    const path = new URL(input).pathname; assert(target.responses.has(path), `Unexpected public fetch ${path}`);
    return Promise.resolve(target.responses.get(path).clone());
  }
  async function install(registration, build, kind) {
    const runtime = workerRuntime(build, kind, storage, publicWire), listeners = new Set();
    const worker = { scriptURL: new URL(kind === 'root' ? '/offline-entry-worker.js' : '/saved/service-worker.js', origin).href,
      state: 'installing', buildId: build.buildId, runtime,
      addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback),
      postMessage(data, ports) { events.push(data); void runtime.message(data, ports[0]); } };
    registration.installing = worker;
    await runtime.lifecycle('install'); worker.state = 'installed'; registration.installing = null; registration.waiting = worker;
    assert.equal(runtime.skipped(), 1); await runtime.lifecycle('activate');
    const previous = registration.active; if (previous) previous.state = 'redundant';
    worker.state = 'activated'; registration.waiting = null; registration.active = worker;
    for (const listener of listeners) listener(); assert.equal(runtime.claimed(), 1);
    return worker;
  }
  return { registrations, calls, events, setTarget(build, cache) { target = build; storage = cache; }, setOnline(value) { online = value; },
    async getRegistration(path) {
      const url = new URL(path, origin).href;
      return [...registrations.values()].filter(item => url.startsWith(item.scope)).sort((a, b) => b.scope.length - a.scope.length)[0];
    },
    async register(script, options) {
      calls.push({ script, options }); assert.equal(options.updateViaCache, 'none');
      const kind = options.scope === '/' ? 'root' : 'saved'; assert.equal(script, kind === 'root' ? '/offline-entry-worker.js' : '/saved/service-worker.js');
      const scope = new URL(options.scope, origin).href;
      let registration = registrations.get(scope);
      if (!registration) {
        registration = { scope, active: null, installing: null, waiting: null,
          async update() { if (online && registration.active?.buildId !== target.buildId) await install(registration, target, kind); },
          async unregister() { registrations.delete(scope); return true; } };
        registrations.set(scope, registration);
      }
      await registration.update(); return registration;
    },
  };
}
function shellPage(api, storage, build, marked = false) {
  const fetches = [];
  const context = vm.createContext({ URL, Set, Promise, MessageChannel, TextDecoder, setTimeout, clearTimeout,
    navigator: { serviceWorker: api }, caches: storage, location: { origin },
    document: { querySelector: () => marked ? { content: build.buildId } : null },
    fetch: async (path, init) => {
      fetches.push({ path, init }); assert.equal(path, '/saved/index.html');
      assert.deepEqual(JSON.parse(JSON.stringify(init)), { credentials: 'omit', redirect: 'error', cache: 'no-store' });
      return build.responses.get(path).clone();
    },
  });
  const source = stripTypeScriptTypes(read('src/offline/shell.ts')).replaceAll('export ', '');
  vm.runInContext(source + '\nglobalThis.api = { verifySavedShell, removeSavedShell };', context);
  return { ...context.api, fetches };
}
try {
  const first = generatedBuild('first'), second = generatedBuild('second'); assert.notEqual(first.buildId, second.buildId);
  const storage = cacheStorage(), api = serviceWorkers(); api.setTarget(first, storage);
  const page = shellPage(api, storage, first);
  // The explicit caller first verifies Saved, then registers root. Its receipt
  // retains the Saved-only identity; root is an independently checked facility.
  const status = await page.verifySavedShell(); assert.equal(status.ready, true); assert.equal(status.buildId, first.buildId);
  assert.deepEqual(api.calls.map(item => item.script), ['/saved/service-worker.js', '/offline-entry-worker.js']);
  assert(api.events.indexOf('saved-shell-status') < api.events.indexOf('root-entry-status'));
  const rootRegistration = api.registrations.get(origin + '/'), savedRegistration = api.registrations.get(origin + '/saved/');
  assert.equal(rootRegistration.scope, origin + '/'); assert.equal(savedRegistration.scope, origin + '/saved/');
  assert.deepEqual(rootRegistration.active.runtime.imports, ['/saved/service-worker.js']);
  assert.equal(rootRegistration.active.runtime.calls.length, 0, 'Root install reuses already verified closure');
  assert.deepEqual([...storage.stores.get(prefix + first.buildId).keys()].sort(),
    [...first.table.map(pin => origin + pin.path), origin + '/saved/.verified-shell'].sort());
  cases.push('explicit-prepare-saved-before-root-exact-build-public-bytes');

  // Existing installed apps retain start_url /. Normal online root requests
  // keep their original Request and exact native response, including headers.
  const networkCalls = [], online = new Response(`generated newer native root ${second.buildId}`, { headers: { 'cache-control': 'private, no-store' } });
  const live = workerRuntime(first, 'root', storage, async (input, init) => { networkCalls.push({ input, init }); return online; });
  const rootRequest = request('/'); assert.equal(await live.fetchEvent(rootRequest), online); assert.equal(networkCalls[0].input, rootRequest);
  assert.deepEqual(JSON.parse(JSON.stringify(networkCalls[0].init)), { cache: 'no-store' });
  const authResponse = new Response('generated authentication response', { status: 401 });
  const auth = workerRuntime(first, 'root', storage, async () => authResponse);
  assert.equal(await auth.fetchEvent(request('/index.html')), authResponse);
  const serverResponse = new Response('generated host response', { status: 503 });
  const server = workerRuntime(first, 'root', storage, async () => serverResponse);
  assert.equal(await server.fetchEvent(request('/')), serverResponse);
  cases.push('online-root-authentication-and-http-response-pass-through');

  // A normal unavailable network read hands off only to the existing Saved
  // entry. The narrower Saved worker supplies exact public bytes, never root.
  const offline = workerRuntime(first, 'root', storage, async () => { throw new TypeError('Generated network unavailable'); });
  for (const path of ['/', '/index.html']) {
    const redirect = await offline.fetchEvent(request(path)); assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), origin + '/saved/index.html');
  }
  assert.equal(offline.calls.length, 2);
  for (const call of offline.calls) assert.deepEqual(JSON.parse(JSON.stringify(call.init)), { cache: 'no-store' });
  // A host that accepts the connection but never answers is unavailable too.
  const hung = workerRuntime(first, 'root', storage, () => new Promise(() => {}));
  const started = Date.now(), handoff = await hung.fetchEvent(request('/'));
  assert.equal(handoff.status, 302); assert.equal(handoff.headers.get('location'), origin + '/saved/index.html');
  assert.ok(Date.now() - started < 3_000, 'a silent host hands off within the navigation budget');
  cases.push('silent-root-host-hands-off-to-saved');
  // Saved verification that throws is no handoff: a slow host's answer still arrives.
  const slowAnswer = new Response('generated slow native root');
  const unverifiable = workerRuntime(first, 'root', { open: async () => { throw new Error('Generated storage failure'); } },
    () => new Promise(resolve => setTimeout(resolve, 2_500, slowAnswer)));
  assert.equal(await unverifiable.fetchEvent(request('/')), slowAnswer);
  cases.push('slow-root-host-without-verified-saved-keeps-network-answer');
  const savedRuntime = savedRegistration.active.runtime;
  const savedResponse = await savedRuntime.fetchEvent(request('/saved/index.html'));
  assert.equal(await savedResponse.text(), await first.responses.get('/saved/index.html').clone().text());
  assert.equal(savedRuntime.fetchEvent(request('/')), null);
  assert.equal(offline.fetchEvent(request('/saved/index.html')), null, 'Only narrower Saved registration owns its navigation');
  // A retained root worker A must leave fixed-name subresources untouched
  // after passing newer online native HTML B through. Saved A still owns
  // its exact public bytes for its separately controlled Saved context.
  for (const pin of first.table.filter(pin => pin.path.startsWith('/assets/'))) {
    assert.equal(live.fetchEvent(request(pin.path, { mode: 'cors' })), null);
    assert.equal(offline.fetchEvent(request(pin.path, { mode: 'cors' })), null);
    const asset = await savedRuntime.fetchEvent(request(pin.path, { mode: 'cors' }));
    assert.equal(await asset.text(), await first.responses.get(pin.path).clone().text());
  }
  for (const path of ['/assets/pdfjs/openjpeg_nowasm_fallback.js', '/assets/pdfjs/jbig2_nowasm_fallback.js'])
    assert.notEqual(await first.responses.get(path).clone().text(), await second.responses.get(path).clone().text());
  assert.equal(live.calls.length, 1, 'Root dispatch must not fetch or cache native subresources');
  assert.equal(offline.calls.length, 2, 'Only exact root navigations reach the root transport');
  cases.push('root-navigation-only-live-fixed-assets-remain-network-owned');
  // Capture labels remain owned by the existing retained-store presentation.
  // These are source-seam checks, not a fabricated private copy or browser render.
  const manager = read('src/offline/SavedHouseManager.tsx'), host = read('src/offline/SavedAtlasHost.tsx');
  assert(manager.includes('store.list()')); assert(manager.includes('Captured <time dateTime={house.capturedAt}>{house.capturedAt}</time>'));
  assert(manager.includes('Open saved Atlas')); assert(host.includes('Historical records are not current native authorization.'));
  assert(read('integration/saved-main.tsx').includes('createRoot(element).render(<SavedAtlasHost openLastCopy={openLastCopy} />)'));
  // Every live launch keeps the public shell and root entry on its build.
  assert(read('integration/main.tsx').includes('module.verifySavedShell()'));
  cases.push('unavailable-root-to-existing-saved-exact-bytes-and-capture-label-seams');

  for (const path of ['/api/atlas/auth/session', '/api/atlas/view', '/api/atlas/models/v1/generated', '/?home=generated', '/index.html?home=generated', '/other', 'https://elsewhere.example/'])
    assert.equal(offline.fetchEvent(request(path)), null);
  assert.equal(offline.fetchEvent(request('/', { method: 'POST' })), null);
  assert.equal(offline.fetchEvent(request('/', { mode: 'cors' })), null);
  assert.deepEqual([...storage.stores.get(prefix + first.buildId).keys()].sort(),
    [...first.table.map(pin => origin + pin.path), origin + '/saved/.verified-shell'].sort());
  cases.push('public-whitelist-no-private-api-session-model-or-root-cache');

  // An intentional normal Saved entry with its existing marker also prepares
  // root launch, with no native acquisition, new Save/Replace or store access.
  const entryStorage = cacheStorage(), entryAPI = serviceWorkers(); entryAPI.setTarget(first, entryStorage);
  const entryPage = shellPage(entryAPI, entryStorage, first, true);
  const entryStatus = await entryPage.verifySavedShell();
  assert.equal(entryStatus.ready, true); assert.equal(entryStatus.buildId, first.buildId);
  assert.equal(entryPage.fetches.length, 0, 'Marked Saved entry needs no discovery or native read');
  assert.deepEqual(entryAPI.calls.map(item => item.script), ['/saved/service-worker.js', '/offline-entry-worker.js']);
  assert(entryAPI.events.indexOf('saved-shell-status') < entryAPI.events.indexOf('root-entry-status'));
  const entryRoot = entryAPI.registrations.get(origin + '/').active.runtime;
  assert.equal(entryRoot.calls.length, 0, 'Existing verified public bytes are reused');
  cases.push('normal-marked-saved-entry-prepares-root-without-private-reacquisition');
  // A pre-existing foreign root owner remains registered and untouched while
  // the independently scoped Saved facility is still usable.
  const foreignStorage = cacheStorage(), foreignAPI = serviceWorkers(); foreignAPI.setTarget(first, foreignStorage);
  const foreign = { scope: origin + '/', installing: null, waiting: null,
    active: { scriptURL: origin + '/foreign-worker.js', state: 'activated' } };
  foreignAPI.registrations.set(origin + '/', foreign);
  const foreignPage = shellPage(foreignAPI, foreignStorage, first);
  assert.equal((await foreignPage.verifySavedShell()).ready, true);
  assert.equal(foreignAPI.registrations.get(origin + '/'), foreign);
  assert.deepEqual(foreignAPI.calls.map(item => item.script), ['/saved/service-worker.js']);
  cases.push('existing-foreign-root-owner-preserved');

  // Ordinary source update (every deploy, from every live launch): both
  // workers move to the new build, copying the public bytes an earlier build
  // already verified and downloading only what changed. Once both answer for
  // the new build, earlier builds' public caches go; unrelated caches stay.
  // Old displayed cleanup cannot unregister either newer worker.
  await storage.open('foreign-public-cache'); await storage.open(prefix + 'c'.repeat(64));
  api.setTarget(second, storage);
  const newer = shellPage(api, storage, second); assert.equal((await newer.verifySavedShell()).buildId, second.buildId);
  assert.equal(rootRegistration.active.buildId, second.buildId); assert.equal(savedRegistration.active.buildId, second.buildId);
  const changed = second.table.filter(pin => first.table.find(row => row.path === pin.path)?.sha256 !== pin.sha256).map(pin => pin.path);
  // The marked Saved entry names its build, so it always changes.
  assert.deepEqual(changed, ['/assets/pdfjs/jbig2_nowasm_fallback.js', '/assets/pdfjs/openjpeg_nowasm_fallback.js', '/assets/saved.js', '/saved/index.html']);
  assert.deepEqual(savedRegistration.active.runtime.calls.map(call => new URL(call.input).pathname), changed, 'Only changed public bytes are downloaded');
  assert.equal(rootRegistration.active.runtime.calls.length, 0);
  assert(!storage.stores.has(prefix + first.buildId)); assert(!storage.stores.has(prefix + 'c'.repeat(64)));
  assert(storage.stores.has(prefix + second.buildId)); assert(storage.stores.has('foreign-public-cache'));
  for (const pin of second.table) assert.equal(await (await savedRegistration.active.runtime.fetchEvent(request(pin.path, { mode: pin.path.endsWith('.html') ? 'navigate' : 'cors' }))).text(),
    await second.responses.get(pin.path).clone().text());
  await page.removeSavedShell(first.buildId);
  assert.equal(api.registrations.get(origin + '/'), rootRegistration); assert.equal(api.registrations.get(origin + '/saved/'), savedRegistration);
  assert(storage.stores.has(prefix + second.buildId));
  await newer.removeSavedShell(second.buildId);
  assert.equal(api.registrations.size, 0); assert(!storage.stores.has(prefix + second.buildId));
  assert(storage.stores.has('foreign-public-cache'));
  await foreignPage.removeSavedShell(first.buildId); assert.equal(foreignAPI.registrations.get(origin + '/'), foreign);
  cases.push('ordinary-worker-upgrade-reuses-verified-bytes-and-drops-earlier-builds');
  console.log(JSON.stringify({ result: 'healthy', cases, generatedBuilds: [first.buildId, second.buildId],
    evidence: 'source/generated VM cache and worker lifecycle; capture labeling inspected at existing component seams; no browser/device claim' }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
