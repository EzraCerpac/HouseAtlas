import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { transformWithOxc } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const maxRunMs = 25_000;
const cleanupBudgetMs = 750;
const sourceRoutes = new Map([
  ['/src/capture-drafts/types.ts', resolve(frontend, 'src/capture-drafts/types.ts')],
  ['/src/capture-drafts/validation.ts', resolve(frontend, 'src/capture-drafts/validation.ts')],
  ['/src/capture-drafts/indexeddb.ts', resolve(frontend, 'src/capture-drafts/indexeddb.ts')],
  ['/src/capture-drafts/controller.ts', resolve(frontend, 'src/capture-drafts/controller.ts')],
]);
const cases = new Set([
  'retained-original-after-reopen',
  'unknown-attempt-locked-after-reopen',
  'concurrent-handoff-single-winner',
  'change-callback-abort-preserves-row',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function startServer(caseName) {
  const caseModule = await readFile(resolve(here, 'browser-cases.mjs'), 'utf8');
  const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body data-status="running"><script type="module" src="/browser-cases.mjs?case=${caseName}"></script></body>`;
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      requests.push({ method: request.method, path: url.pathname });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; img-src data:; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'");
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      if (url.pathname === '/' && url.searchParams.size === 1 && url.searchParams.get('case') === caseName) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        return;
      }
      if (url.pathname === '/browser-cases.mjs' && url.searchParams.size === 1 && url.searchParams.get('case') === caseName) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(caseModule);
        return;
      }
      if (sourceRoutes.has(url.pathname) && url.search === '') {
        const filename = sourceRoutes.get(url.pathname);
        const source = await readFile(filename, 'utf8');
        const transformed = await transformWithOxc(source, filename, { lang: 'ts' });
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(transformed.code);
        return;
      }
      // This server has no proxy, dev-server fallback, or filesystem fallback.
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    } catch {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Synthetic harness route failed');
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolveListen, reject) => {
    server.once('listening', resolveListen);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'Loopback server did not receive a TCP port');
  return { server, requests, origin: `http://127.0.0.1:${address.port}` };
}

function connectCdp(url, deadline) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const eventListeners = new Map();
    let nextId = 0;
    let connected = false;
    const connectTimer = setTimeout(() => {
      socket.close();
      reject(new Error('Chrome DevTools WebSocket connection timed out'));
    }, Math.max(1, Math.min(2_000, deadline - Date.now())));
    const rejectPending = error => {
      for (const [id, waiter] of pending) {
        clearTimeout(waiter.timer);
        pending.delete(id);
        waiter.reject(error);
      }
    };
    socket.addEventListener('open', () => {
      connected = true;
      clearTimeout(connectTimer);
      resolveSocket({
      send(method, params = {}, sessionId) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return Promise.reject(new Error('Browser runner reached its 25-second deadline'));
        const id = ++nextId;
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        return new Promise((resolveResponse, rejectResponse) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectResponse(new Error(`Chrome DevTools ${method} timed out`));
          }, Math.min(2_000, remaining));
          pending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer });
          try { socket.send(JSON.stringify(message)); }
          catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            rejectResponse(error);
          }
        });
      },
      on(method, listener) {
        const listeners = eventListeners.get(method) ?? new Set();
        listeners.add(listener);
        eventListeners.set(method, listeners);
        return () => listeners.delete(listener);
      },
      close() { socket.close(); rejectPending(new Error('Chrome DevTools WebSocket closed')); },
    });
    });
    socket.addEventListener('error', () => {
      clearTimeout(connectTimer);
      const error = new Error('Chrome DevTools WebSocket connection failed');
      rejectPending(error);
      if (!connected) reject(error);
    });
    socket.addEventListener('close', () => {
      clearTimeout(connectTimer);
      const error = new Error('Chrome DevTools WebSocket closed');
      rejectPending(error);
      if (!connected) reject(error);
    });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`Chrome DevTools ${message.error.message}`));
        else waiter.resolve(message.result ?? {});
      } else if (message.method) {
        for (const listener of eventListeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      }
    });
  });
}

async function waitForDevTools(profile, child, deadline, spawnFailure) {
  const activePort = resolve(profile, 'DevToolsActivePort');
  while (Date.now() < deadline) {
    if (spawnFailure()) throw new Error(`Chrome could not start: ${spawnFailure().message}`);
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${child.exitCode})`);
    try {
      const [portLine] = (await readFile(activePort, 'utf8')).split('\n');
      const port = Number(portLine);
      assert(Number.isInteger(port) && port > 0 && port < 65536, 'Chrome returned an invalid DevTools port');
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - Date.now()))),
      });
      assert(response.ok, 'Chrome DevTools endpoint was unavailable');
      const version = await response.json();
      assert(typeof version.webSocketDebuggerUrl === 'string', 'Chrome omitted its browser debugging socket');
      return version.webSocketDebuggerUrl;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Chrome exited')) throw error;
      await delay(50);
    }
  }
  throw new Error('Chrome DevTools did not become ready within the runner deadline');
}

async function runBrowser(caseName) {
  const workRunMs = maxRunMs - cleanupBudgetMs;
  const deadline = Date.now() + workRunMs;
  let server;
  let child;
  let profile;
  let cdp;
  let chromeError = null;
  let chromeStderr = '';
  let hardTimer;
  let rejectHardTimeout;
  const hardTimeout = new Promise((_, reject) => { rejectHardTimeout = reject; });
  const terminateChild = signal => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); } catch { /* The process group may already be gone. */ }
  };
  hardTimer = setTimeout(() => {
    terminateChild('SIGTERM');
    setTimeout(() => terminateChild('SIGKILL'), 500).unref();
    cdp?.close();
    rejectHardTimeout(new Error('Browser regression exceeded its hard 25-second runtime limit'));
  }, workRunMs);
  const work = async () => {
    const runningServer = await startServer(caseName);
    server = runningServer.server;
    const { requests, origin } = runningServer;
    profile = await mkdtemp('/tmp/houseatlas-capture-drafts-');
    child = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--disable-sync', '--disable-default-apps',
      '--disable-extensions', '--disable-service-worker', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--user-data-dir=${profile}`, 'about:blank',
    ], {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: profile },
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      chromeStderr = (chromeStderr + chunk).slice(-4_096);
    });
    child.once('error', error => { chromeError = error; });
    const browserUrl = await waitForDevTools(profile, child, deadline, () => chromeError);
    cdp = await connectCdp(browserUrl, deadline);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const observedRequests = [];
    cdp.on('Network.requestWillBeSent', params => observedRequests.push(params.request.url));
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `${origin}/?case=${caseName}` }, sessionId);

    let result;
    while (Date.now() < deadline) {
      const evaluation = await cdp.send('Runtime.evaluate', {
        expression: 'document.body?.dataset?.status === "complete" ? document.body.textContent : null',
        returnByValue: true,
      }, sessionId);
      const value = evaluation.result?.value;
      if (typeof value === 'string') {
        try { result = JSON.parse(value); break; } catch { /* Case module is still writing its result. */ }
      }
      await delay(50);
    }
    assert(result, 'Browser case did not finish within the runner deadline');
    assert(result.ok === true, `${caseName}: ${result.error ?? 'case failed'}`);
    const permittedPrefix = `${origin}/`;
    const externalRequests = observedRequests.filter(url => !url.startsWith(permittedPrefix));
    assert(externalRequests.length === 0, `Browser attempted a request outside its loopback origin: ${externalRequests[0]}`);
    assert(requests.every(request => request.path === '/' || request.path === '/browser-cases.mjs' || sourceRoutes.has(request.path)),
      'Loopback server observed a request outside the exact case and four TypeScript module routes');
    return { case: caseName, status: 'passed', evidence: result.evidence, externalRequests: 0 };
  };
  try {
    return await Promise.race([work(), hardTimeout]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = chromeStderr.trim();
    if (log) throw new Error(`${message}\nChrome stderr (last 4096 characters; inspect for launch or DevTools startup issues):\n${log}`);
    throw error;
  } finally {
    clearTimeout(hardTimer);
    cdp?.close();
    if (child?.pid) {
      terminateChild('SIGTERM');
      await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(300)]);
      terminateChild('SIGKILL');
    }
    if (server) {
      await Promise.race([new Promise(resolveClose => server.close(() => resolveClose())), delay(300)]);
      server.closeAllConnections();
    }
    if (profile) await rm(profile, { recursive: true, force: true });
  }
}

const caseName = process.argv[2];
if (process.argv.length !== 3 || !cases.has(caseName)) {
  console.error(`Usage: node frontend/capture-drafts-tests/browser-storage.mjs <${[...cases].join('|')}>`);
  process.exitCode = 2;
} else {
  runBrowser(caseName).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    console.error(JSON.stringify({ case: caseName, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
