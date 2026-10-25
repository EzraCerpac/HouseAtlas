/** Real-browser offline launch of the built public shell. Serves the existing
 * production `dist/` on an owned loopback listener, opens the Saved entry once
 * online so both service workers install, then reopens `/` with the network
 * gone. Generated build output only: no backend, session, household data,
 * provider or native state.
 *
 *   --case offline-launch  listener closed (connection refused) before reopen
 *   --case hung-network    listener accepts `/` but never answers ("lie-fi")
 *
 * Requires `npm --prefix frontend run build` first, Node 26.10.0 and an
 * inspected HOUSEATLAS_CHROMIUM executable. Prints launch timings. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CASES = { 'offline-launch': 2_000, 'hung-network': 3_000 };
assert.equal(process.argv.length, 4, 'Select --case offline-launch or --case hung-network');
assert.equal(process.argv[2], '--case');
const selected = process.argv[3], budgetMs = CASES[selected];
assert(budgetMs, 'Select --case offline-launch or --case hung-network');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
for (const path of ['index.html', 'offline-entry-worker.js', 'saved/index.html', 'saved/service-worker.js'])
  assert(existsSync(join(dist, path)), `Build the frontend first: missing dist/${path}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
let mode = 'online', served = 0, stalled = 0;
const sockets = new Set(), held = new Set();
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (mode === 'hung' && (path === '/' || path === '/index.html')) { stalled++; held.add(response); return; }
  served++;
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
const cdp = new Pipe(browser);
const timeout = (ms, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms).unref());
try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
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

  // 1. Online: the Saved entry verifies the public shell and prepares the root worker.
  await send('Page.navigate', { url: origin + '/saved/index.html' });
  await poll(`(async () => {
    const root = await navigator.serviceWorker.getRegistration('/'), saved = await navigator.serviceWorker.getRegistration('/saved/');
    return root?.active?.state === 'activated' && saved?.active?.state === 'activated'
      && (await caches.keys()).some(name => name.startsWith('houseatlas-saved-public-'));
  })()`, 60_000, 'Root and Saved workers did not activate online');
  const installed = served;

  // 2. Network gone. Reopen the installed start URL.
  if (selected === 'offline-launch') {
    await new Promise(done => { server.close(done); for (const socket of sockets) socket.destroy(); });
  } else mode = 'hung';
  served = 0;
  await send('Page.navigate', { url: 'about:blank' });
  const started = Date.now();
  send('Page.navigate', { url: origin + '/' }).catch(() => {});
  const shown = await Promise.race([
    poll(`location.pathname === '/saved/index.html' && document.readyState !== 'loading'
      && document.getElementById('root')?.childElementCount > 0`, budgetMs + 5_000, 'no shell'),
    timeout(budgetMs + 5_000, 'no shell'),
  ]).catch(() => null);
  const launchMs = shown === null ? null : shown - started;
  console.log(JSON.stringify({ case: selected, installRequests: installed, launchMs, budgetMs,
    reopenRequestsServed: served, stalledRootRequests: stalled }));
  assert.notEqual(launchMs, null, `Offline reopen never showed the Saved shell within ${budgetMs + 5_000} ms`);
  assert(launchMs <= budgetMs, `Offline reopen took ${launchMs} ms; budget ${budgetMs} ms`);
  assert.equal(served, 0, 'Offline reopen fetched public shell bytes from the network');
  console.log(`PASS ${selected}: Saved shell shown ${launchMs} ms after reopening /; generated build only, not iOS or installed-PWA proof`);
} finally {
  for (const response of held) response.destroy();
  await cdp.send('Browser.close').catch(() => {});
  browser.kill();
  if (server.listening) server.close();
  for (const socket of sockets) socket.destroy();
  rmSync(scratch, { recursive: true, force: true });
}
