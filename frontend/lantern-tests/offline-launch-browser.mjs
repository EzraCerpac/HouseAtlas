/** Real-browser offline launch of the built public shell. Serves the existing
 * production `dist/` on an owned loopback listener, opens the Saved entry once
 * online so both service workers install, then reopens `/` with the network
 * gone. Generated build output only: no backend, session, household data,
 * provider or native state.
 *
 *   --case offline-launch  listener closed (connection refused) before reopen
 *   --case hung-network    listener accepts `/` but never answers ("lie-fi")
 *   --case live-launch     live entry `/`, generated cached Atlas and a waiting
 *                          outbox entry survive closing and reopening the tab
 *
 * Requires `npm --prefix frontend run build` first, Node 26.10.0 and an
 * inspected HOUSEATLAS_CHROMIUM executable. Prints launch timings. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { trackOfflineBrowser, removeOfflineScratch, finishOfflineCleanup } from './offline-launch-cleanup.mjs';

const CASES = { 'offline-launch': 2_000, 'hung-network': 3_000, 'live-launch': 2_000 };
assert.equal(process.argv.length, 4, 'Select --case offline-launch, hung-network or live-launch');
assert.equal(process.argv[2], '--case');
const selected = process.argv[3], budgetMs = CASES[selected];
assert(budgetMs, 'Select --case offline-launch, hung-network or live-launch');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
for (const path of ['index.html', 'offline-entry-worker.js', 'saved/index.html', 'saved/service-worker.js'])
  assert(existsSync(join(dist, path)), `Build the frontend first: missing dist/${path}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
let mode = 'online', served = 0, stalled = 0, servedPaths = [];
const sockets = new Set(), held = new Set();
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (mode === 'hung' && (path === '/' || path === '/index.html')) { stalled++; held.add(response); return; }
  served++; servedPaths.push(path);
  const relative = path === '/' ? 'index.html' : path === '/saved/' ? 'saved/index.html' : path.slice(1);
  const file = normalize(join(dist, relative));
  if (!file.startsWith(dist + '/') || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return;
  }
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  response.end(readFileSync(file));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

// Reuse the public generated publication and the production storage APIs. Only
// the live-launch case seeds device data; neither a session nor a DOM result is
// fabricated. These data modules are test setup, not additional served assets.
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, {
    lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false,
  });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:'), `Unexpected setup import ${match[1]}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
async function liveLaunchSeed() {
  const { buildSyntheticAtlas, composeAtlasEnvelope, SYNTHETIC_ATLAS, sha256Hex } = await import('./unified-atlas/synthetic-atlas.ts');
  const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
  const { glb, companionBytes } = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
  const byteStoreURL = await sourceURL('../integration/native-geometry-scan-cache.ts');
  const cacheURL = await sourceURL('../integration/unified-atlas-cache.ts', { './native-geometry-scan-cache': byteStoreURL });
  const outboxURL = await sourceURL('../src/outbox/store.ts');
  const owner = { actorId: 'synthetic-offline-launch-actor', ...scope };
  const requestId = 'synthetic-offline-launch-request';
  // Same persisted entry shape as the existing generated outbox examples. It
  // is deliberately never sent: this static fixture has no canonical session
  // or stock command server and cannot establish reconnect authorization.
  const entry = { id: 'synthetic-offline-launch-edit', seq: 1, owner, kind: 'place-name',
    label: 'Rename generated room after offline launch',
    target: { recordType: 'location-semantics', recordId: 'synthetic-room' },
    intent: { label: 'Generated renamed room' }, commandId: 'atlas.batch.execute', requestId,
    body: JSON.stringify({ commandId: 'atlas.batch.execute', requestId,
      idempotencyKey: 'synthetic-offline-launch-key', target: 'synthetic-room', base: 1 }),
    createdAt: '2026-01-03T10:15:00.000Z', state: 'waiting', sent: false, problem: null, settledAt: null };
  return { cacheURL, outboxURL, owner, entry, publicationId: SYNTHETIC_ATLAS.publicationId,
    manifestSha256: composed.manifestSha256, modelSha256: composed.sha256,
    envelopeSha256: await sha256Hex(composed.envelopeBytes), envelope: [...composed.envelopeBytes], model: [...glb] };
}

class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0); listeners = new Set();
  constructor(child) {
    const stop = error => { for (const entry of this.pending.values()) entry.reject(error); this.pending.clear(); };
    child.on('exit', code => stop(new Error('Chromium exited: ' + code)));
    child.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.id) {
          const entry = this.pending.get(message.id); if (!entry) continue;
          this.pending.delete(message.id);
          message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
        } else for (const listener of this.listeners) listener(message);
      }
    });
    this.child = child;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-offline-launch-'));
const browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--user-data-dir=' + join(scratch, 'profile'), 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const stopBrowser = trackOfflineBrowser(browser);
const cdp = new Pipe(browser);
const timeout = (ms, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms).unref());
let primaryFailure = null;
try {
  let { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  let { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!exceptionDetails, exceptionDetails?.exception?.description ?? exceptionDetails?.text);
    return result.value;
  };
  const poll = async (expression, ms, label) => {
    const until = Date.now() + ms;
    for (;;) {
      if (await evaluate(expression).catch(() => false)) return Date.now();
      if (Date.now() > until) throw new Error(label);
      await new Promise(done => setTimeout(done, 25));
    }
  };

  // 1. Online: the Saved entry, or after its load any live launch, verifies the
  // public shell and prepares the root worker. Here the live entry finds no
  // backend, which changes nothing: the shell is public build files only.
  await send('Page.navigate', { url: origin + (selected === 'live-launch' ? '/' : '/saved/index.html') });
  await poll(`(async () => {
    const root = await navigator.serviceWorker.getRegistration('/'), saved = await navigator.serviceWorker.getRegistration('/saved/');
    return root?.active?.state === 'activated' && saved?.active?.state === 'activated'
      && (await caches.keys()).some(name => name.startsWith('houseatlas-saved-public-'));
  })()`, 60_000, 'Root and Saved workers did not activate online');
  const installed = served;

  // 2. Network gone. Reopen the installed start URL.
  if (selected !== 'hung-network') {
    await new Promise(done => { server.close(done); for (const socket of sockets) socket.destroy(); });
  } else mode = 'hung';
  served = 0; servedPaths = [];
  let seeded = null;
  const reopenWrites = [];
  if (selected === 'live-launch') {
    seeded = await liveLaunchSeed();
    const { cacheURL, outboxURL, owner, entry, publicationId, manifestSha256, modelSha256,
      envelopeSha256, envelope, model } = seeded;
    assert.deepEqual(await evaluate(`(async () => {
      const { openUnifiedAtlasStore, observeUnifiedAtlasActor, createUnifiedAtlasCache } = await import(${JSON.stringify(cacheURL)});
      const { openOutboxStore } = await import(${JSON.stringify(outboxURL)});
      const store = openUnifiedAtlasStore(indexedDB); await store.ready();
      try {
        // A synthetic display-only actor observation publishes the pointer;
        // this is not a canonical live session or authority to send the edit.
        const owner = ${JSON.stringify(owner)};
        const actor = await observeUnifiedAtlasActor(store, owner.actorId);
        if (!actor) throw new Error('Synthetic Atlas actor observation was not retained');
        const cache = createUnifiedAtlasCache(store, owner, actor);
        cache.keepModel(${JSON.stringify(modelSha256)}, new Uint8Array(${JSON.stringify(model)}));
        cache.keepScene(${JSON.stringify(publicationId)}, ${JSON.stringify(manifestSha256)},
          new Uint8Array(${JSON.stringify(envelope)}), ${JSON.stringify(envelopeSha256)}, null);
      } finally { await store.close(); }
      const outbox = openOutboxStore(indexedDB);
      try { await outbox.put(${JSON.stringify(entry)}); return await outbox.list(); }
      finally { outbox.close(); }
    })()`), [entry], 'the complete generated queue record is durable before close');
    // Close the application target, rather than merely reloading its React
    // tree. The new target shares only the device profile and retained stores.
    assert.equal((await cdp.send('Target.closeTarget', { targetId })).success, true);
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable'); await send('Runtime.enable');
    cdp.listeners.add(message => {
      if (message.sessionId === sessionId && message.method === 'Network.requestWillBeSent'
        && !['GET', 'HEAD'].includes(message.params.request.method))
        reopenWrites.push({ method: message.params.request.method, url: message.params.request.url });
    });
    await send('Network.enable');
  } else await send('Page.navigate', { url: 'about:blank' });
  const started = Date.now();
  send('Page.navigate', { url: origin + '/' }).catch(() => {});
  const shown = await Promise.race([
    poll(`location.pathname === '/saved/index.html' && document.readyState !== 'loading'
      && document.getElementById('root')?.childElementCount > 0`, budgetMs + 5_000, 'no shell'),
    timeout(budgetMs + 5_000, 'no shell'),
  ]).catch(() => null);
  const launchMs = shown === null ? null : shown - started;
  console.log(JSON.stringify({ case: selected, installRequests: installed, launchMs, budgetMs,
    reopenRequestsServed: served, reopenPaths: servedPaths, stalledRootRequests: stalled }));
  assert.notEqual(launchMs, null, `Offline reopen never showed the Saved shell within ${budgetMs + 5_000} ms`);
  assert(launchMs <= budgetMs, `Offline reopen took ${launchMs} ms; budget ${budgetMs} ms`);
  // A page in a worker's scope may ask for that worker's script (registration.update(),
  // updateViaCache 'none'); in hung-network the listener answers it. That is an update
  // check, not shell bytes: the shell itself must still come from the cache.
  const updateChecks = new Set(['/offline-entry-worker.js', '/saved/service-worker.js']);
  assert.deepEqual(servedPaths.filter(path => !updateChecks.has(path)), [], 'Offline reopen fetched public shell bytes from the network');
  if (seeded) {
    // Assert actual application output from the retained generated publication,
    // not just a shell, a cache record, or an injected waiting-count element.
    await poll(`(() => {
      const atlas = document.querySelector('.saved-stage .ua-shell.is-stage');
      const buildings = atlas?.querySelector('[aria-label="Buildings"]')?.textContent ?? '';
      const status = atlas?.querySelector('.ua-stored-note')?.textContent ?? '';
      const offline = document.querySelector('.saved-header .saved-live')?.textContent ?? '';
      return buildings.includes('Synthetic house') && buildings.includes('Synthetic studio')
        && status.includes('Stored copy') && status.includes('not updated')
        && offline.includes('Offline') && offline.includes('1 change waiting');
    })()`, 15_000, 'Reopened app did not show the generated cached Atlas and its waiting outbox count');
    // Above the Atlas only the one connection pill; the page itself is locked like the live app's.
    assert.deepEqual(await evaluate(`(() => {
      const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
      return { header: [...document.querySelector('.saved-header').children].map(child => child.className),
        chrome: [...document.querySelectorAll('.saved-header h1, .saved-header details, .saved-manager, .saved-message')].length,
        overflow: [root.overflow, body.overflow], overscroll: [root.overscrollBehaviorY, body.overscrollBehaviorY] };
    })()`), { header: ['saved-live'], chrome: 0, overflow: ['hidden', 'hidden'], overscroll: ['none', 'none'] },
    'the offline reopen shows one pill above the Atlas and the page does not scroll');
    // Opened on purpose from the live app (its link marks the tab session), the
    // same page keeps the full Saved view with Saved scope and shell removal.
    await evaluate(`sessionStorage.setItem('houseatlas.saved-entry.v1', '1')`);
    await send('Page.reload', {});
    await poll(`(() => document.querySelector('.saved-header h1')?.textContent === 'Saved Atlas'
      && document.querySelector('.saved-header details summary')?.textContent === 'Saved scope'
      && document.querySelector('.saved-message[role="note"]') !== null
      && document.querySelector('.saved-stage .ua-shell.is-stage') !== null)()`, 15_000,
      'the explicit Saved entry lost its full view');
    assert.deepEqual(await evaluate(`(async () => {
      const { openOutboxStore } = await import(${JSON.stringify(seeded.outboxURL)});
      const store = openOutboxStore(indexedDB);
      try { return await store.list(); } finally { store.close(); }
    })()`), [seeded.entry], 'closing and reopening offline retains the exact owner, intent, command bytes and waiting state');
    assert.deepEqual(reopenWrites, [], 'the read-only offline reopen does not dispatch the queued edit or another write');
    console.log('PASS live-launch: generated cached Atlas and 1 waiting edit shown after actual tab close/reopen; exact queue bytes retained; reconnect sync not exercised');
  }
  console.log(`PASS ${selected}: Saved shell shown ${launchMs} ms after reopening /; generated build only, not iOS or installed-PWA proof`);
} catch (error) {
  primaryFailure = { error }; throw error;
} finally {
  await finishOfflineCleanup({
    primaryFailure,
    beforeShutdown: [...held].map(response => () => response.destroy()),
    stopBrowser: () => stopBrowser(() => cdp.send('Browser.close')),
    releaseTransport: [() => { if (server.listening) server.close(); }, ...[...sockets].map(socket => () => socket.destroy())],
    removeScratch: () => removeOfflineScratch(scratch),
  });
}
