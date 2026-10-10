// SOURCE ONLY until independent review and exact Root README release.
// One normal unsent save/reopen/review/confirmed upload through actual UI/native.
// No provider, real camera, private file, replay, expiry, crash or revocation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShape } from '../../packages/contracts/src/index.mjs';

const runStartedAt = Date.now();
const root = resolve(process.env.HOUSEATLAS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')), 'Supply inspected source root and actual React bundle');
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const git = args => spawnSync('git', args, {cwd:root, encoding:'utf8', timeout:5000, killSignal:'SIGKILL'});
const head = git(['rev-parse','HEAD']); assert.equal(head.status,0);
const status = git(['status','--porcelain']); assert.equal(status.status,0);
const frozenSchema=git(['show','4ca610d8a21752277beafdc03bec2e62a93a65b7:packages/contracts/schemas/atlas.schema.json']);
assert.equal(frozenSchema.status,0);
assert.equal(readFileSync(join(root,'packages/contracts/schemas/atlas.schema.json'),'utf8'),frozenSchema.stdout,'Actual record validation uses the frozen old-reader schema');
const source = {head:head.stdout.trim(),clean:status.stdout.trim()==='',
  binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),
  frontendIndexSha256:createHash('sha256').update(readFileSync(join(root,'frontend/dist/index.html'))).digest('hex'),
  scriptSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
if(process.env.HOUSEATLAS_SOURCE_SHA) {
  assert.equal(source.head,process.env.HOUSEATLAS_SOURCE_SHA);
  assert.equal(source.clean,true,'Exact candidate verification requires a clean source tree');
}
const args=process.argv.slice(2);
assert(args.length===2 && args[0]==='--case' && args[1]==='healthy-save-reopen-confirm', 'Only the exact named positive entrypoint');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium && existsSync(chromium), 'A real Chromium executable is required');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const runAbort = new AbortController();
const owned = [], lifecycle = new Map();
let scratch, service, browser, cdp, runDeadline, stopPromise;
let primaryError, cleanupError, serviceOutput = '', serviceError = '';
function spawnOwned(label, executable, arguments_, options) {
  runAbort.signal.throwIfAborted();
  // A separate group is owned by this runner, including Chromium subprocesses.
  const child = spawn(executable, arguments_, { ...options, detached: true });
  const entry = { label, child, closed: false, groupGone: false, error: undefined };
  child.once('close', () => { entry.closed = true; });
  child.on('error', error => { entry.error ??= error; });
  for (const stream of child.stdio) stream?.on('error', error => { entry.error ??= error; });
  owned.push(entry); lifecycle.set(child, entry);
  return child;
}
function groupIsGone(entry) {
  // Once absence is observed, never probe or signal a possibly reused PGID.
  if (entry.groupGone) return true;
  if (!entry.child.pid) return entry.groupGone = true;
  try { process.kill(-entry.child.pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') return entry.groupGone = true;
    entry.error ??= error;
  }
  return false;
}
async function waitForStopped(entry, ms) {
  const deadline = Date.now() + ms;
  while (true) {
    if (entry.closed && groupIsGone(entry)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(50, remaining));
  }
}
async function stopOwned(entry) {
  if (await waitForStopped(entry, 0)) return;
  if (entry.child === browser && cdp && !entry.closed) {
    // Browser.close is only a bounded graceful request; closure is separate proof.
    await cdp.send('Browser.close', {}, undefined, true, 1000).catch(() => {});
    if (await waitForStopped(entry, 0)) return;
  }
  const stages = entry.child === browser ? ['SIGTERM', 'SIGKILL'] : ['SIGINT', 'SIGTERM', 'SIGKILL'];
  let signalError;
  for (const signal of stages) {
    if (!groupIsGone(entry) && entry.child.pid) {
      try { process.kill(-entry.child.pid, signal); }
      catch (error) { if (error.code === 'ESRCH') entry.groupGone = true; else signalError = error; }
    }
    // Require leader exit/stdio close AND absence of its owned process group.
    if (await waitForStopped(entry, 2000)) return;
  }
  throw new Error('Owned child/group exit and pipe completion unconfirmed: ' + entry.label, { cause: signalError ?? entry.error });
}
function stopAll() {
  return stopPromise ??= (async () => {
    const serviceWasRunning = service && !lifecycle.get(service).closed;
    const results = await Promise.allSettled(owned.map(stopOwned));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    cdp?.dispose(new Error('Harness cleanup'));
    if (owned.every(entry => entry.closed && groupIsGone(entry))) {
      if (serviceWasRunning) {
        try { assert.equal(service.exitCode, 0, 'Healthy service shutdown'); }
        catch (error) { failures.push(error); }
      }
      if (scratch) {
        try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) { failures.push(error); }
      }
    } else {
      // Retain state if exit cannot be proved; release runner handles, never claim cleanup.
      for (const entry of owned.filter(entry => !(entry.closed && groupIsGone(entry)))) {
        for (const stream of entry.child.stdio) stream?.destroy();
        entry.child.unref();
      }
      failures.push(new Error('Scratch retained after unconfirmed child shutdown: ' + scratch));
    }
    if (failures.length) throw new AggregateError(failures, 'Harness cleanup failed');
  })();
}
async function until(check, label, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    runAbort.signal.throwIfAborted();
    const result = await check(); runAbort.signal.throwIfAborted();
    if (result) return result; await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
const observedUrls = [], responses = [], runtimeErrors = [], uploadRequests = [];
const loaded = new Set();
let completedResult;
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0); closed = false;
  phase = 'browser-setup'; sequence = 0; events = []; failures = []; overflow = false;
  pauses = new Map(); pauseTasks = new Set(); network = new Map();
  expectedClose = false; targetSessionId = null;
  constructor(process) {
    this.process = process;
    this.onData = bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.id) {
          const pending = this.pending.get(message.id); if (!pending) continue;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) {
            const error = new Error(message.error.message);
            error.cdpKind = 'protocol'; error.cdpCode = message.error.code;
            error.commandId = message.id; error.cdpMethod = pending.method;
            pending.reject(error);
          } else pending.resolve(message.result);
        } else if (message.method === 'Fetch.requestPaused') {
          this.startPause(message.params, message.sessionId);
        } else if (message.method === 'Network.requestWillBeSent') {
          this.networkEvent(message.method, message.params, message.sessionId);
          const { request, requestId } = message.params;
          observedUrls.push(request.url);
          // Observe only correlation and URL; never retain multipart bodies,
          // credentials, cookie/CSRF headers or any private stage/token fields.
          if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/evidence'))
            uploadRequests.push({ requestId, url: request.url });
        } else if (message.method === 'Network.responseReceived') {
          this.networkEvent(message.method, message.params, message.sessionId);
          responses.push({ requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status });
        } else if (message.method === 'Network.loadingFinished') {
          this.networkEvent(message.method, message.params, message.sessionId);
          loaded.add(message.params.requestId);
        } else if (message.method === 'Network.loadingFailed') this.networkEvent(message.method, message.params, message.sessionId);
        else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      }
    };
    this.onError = error => {
      const failure = Object.assign(new Error('CDP pipe error', { cause: error }), { cdpKind: 'pipe-error' });
      this.failure('pipe-error', failure, this.pipeContext()); this.cancelPending(failure);
    };
    this.onClose = () => {
      this.closed = true;
      const failure = Object.assign(new Error('CDP child closed'), { cdpKind: 'pipe-close' });
      if (!this.expectedClose) this.failure('pipe-close', failure, this.pipeContext());
      else this.note('expected-pipe-close', this.context(this.pipeContext()));
      this.cancelPending(failure);
    };
    process.stdio[4].on('data', this.onData);
    process.stdio[3].on('error', this.onError); process.stdio[4].on('error', this.onError);
    process.once('close', this.onClose);
  }
  key(sessionId, requestId) { return JSON.stringify([sessionId ?? null, requestId]); }
  safeId(value) { return typeof value === 'string' && value.length <= 128 ? value : null; }
  pipeContext() { return { cdpSessionId: this.targetSessionId, networkId: null, path: 'cdp-pipe', origin: 'transport' }; }
  safeMethod(value) { return ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(value) ? value : 'OTHER'; }
  route(url) {
    const allowed = url.startsWith(this.allowedOrigin + '/') || url.startsWith('blob:' + this.allowedOrigin + '/');
    if (!allowed) return { origin: 'blocked', path: 'blocked-origin' };
    if (url.startsWith('blob:')) return { origin: 'local-blob', path: 'local-original-blob' };
    const path = new URL(url).pathname;
    const exact = ['/', '/api/atlas/view', '/api/atlas/auth/session', '/api/atlas/auth/login', '/api/atlas/auth/logout', '/api/atlas/auth/local-access', '/manifest.webmanifest', '/favicon.ico'];
    if (exact.includes(path)) return { origin: 'loopback', path };
    if (path.startsWith('/api/atlas/editing/v1/') && path.endsWith('/evidence')) return { origin: 'loopback', path: '/api/atlas/editing/v1/:scope/places/:place/evidence' };
    if (path.startsWith('/api/atlas/editing/v1/') && path.endsWith('/place')) return { origin: 'loopback', path: '/api/atlas/editing/v1/:scope/place' };
    if (path.startsWith('/api/atlas/media/') && path.endsWith('/download')) return { origin: 'loopback', path: '/api/atlas/media/:scope/:asset/download' };
    if (/^\/api\/atlas\/v1\/.*\/records\/(asset|evidence)\//.test(path)) return { origin: 'loopback', path: '/api/atlas/v1/:scope/records/:type/:record' };
    return { origin: 'loopback', path: path.startsWith('/assets/') ? '/assets/:file' : 'other-loopback-path' };
  }
  context(record) {
    return { cdpSessionId: record.cdpSessionId, interceptionId: record.interceptionId ?? null, networkId: record.networkId,
      frameId: record.frameId ?? null, method: record.method ?? 'OTHER', path: record.path ?? 'unknown-path', origin: record.origin ?? 'unknown',
      pausedPhase: record.pausedPhase ?? null, evidence: record.evidence === true };
  }
  note(kind, fields = {}) {
    const sequence = ++this.sequence;
    if (this.events.length >= 4096) { this.overflow = true; this.transportError ??= 'Interception diagnostic event limit exceeded'; return; }
    this.events.push({ sequence, elapsedMs: Date.now() - runStartedAt, phase: this.phase, kind, ...fields });
  }
  setPhase(phase) { this.phase = phase; this.note('phase'); }
  failure(kind, error, record, fields = {}) {
    const message = kind === 'observer' ? 'Evidence observer failed before terminal command' :
      error?.cdpKind ? String(error.message).replace(/(?:https?:\/\/|blob:https?:\/\/)[^\s"'<>]+/g, '[url-omitted]').replace(/[\u0000-\u001f]/g, ' ').slice(0, 256) : 'Interception failure: ' + kind;
    this.transportError ??= message;
    if (this.failures.length >= 128) { this.overflow = true; return; }
    const failure = { kind, ...(record ? this.context(record) : {}), message,
      errorKind: error?.cdpKind ?? kind, protocolCode: Number.isInteger(error?.cdpCode) ? error.cdpCode : null,
      commandId: Number.isInteger(error?.commandId) ? error.commandId : null, ...fields };
    this.failures.push(failure); this.note('failure', failure);
  }
  limit(kind) {
    this.overflow = true; const error = new Error('Interception diagnostic ' + kind + ' limit exceeded');
    this.failure('record-limit', error); runAbort.abort(error); this.cancelPending(error);
  }
  startPause(params, sessionId) {
    const key = this.key(sessionId, params.requestId);
    if (this.pauses.has(key)) { this.failure('duplicate-pause', undefined, this.pauses.get(key)); return; }
    if (this.pauses.size >= 512) { this.limit('pause'); return; }
    const route = this.route(params.request.url), allowed = route.origin !== 'blocked';
    if (!allowed) this.blocked++;
    const record = { cdpSessionId: this.safeId(sessionId), interceptionId: this.safeId(params.requestId), networkId: this.safeId(params.networkId), frameId: this.safeId(params.frameId),
      method: this.safeMethod(params.request.method), ...route, pausedPhase: this.phase,
      resourceType: ['Document','Stylesheet','Image','Media','Font','Script','XHR','Fetch','Other'].includes(params.resourceType) ? params.resourceType : 'Other',
      stage: params.responseStatusCode !== undefined || params.responseErrorReason !== undefined ? 'response' : 'request',
      evidence: allowed && params.request.method === 'POST' && new URL(params.request.url).pathname.endsWith('/evidence'),
      observer: 'not-required', terminalMethod: null, terminalAttempts: 0, terminalState: 'not-started', commandId: null };
    this.pauses.set(key, record); this.note('paused', { ...this.context(record), stage: record.stage, resourceType: record.resourceType });
    const task = this.handlePause(record, params.requestId, sessionId, allowed)
      .catch(error => this.failure('pause-handler', error, record))
      .finally(() => { this.pauseTasks.delete(task); this.note('pause-settled', this.context(record)); });
    this.pauseTasks.add(task);
  }
  async handlePause(record, interceptionId, sessionId, allowed) {
    let terminalMethod = allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest';
    if (record.evidence) {
      record.observer = 'pending'; this.note('observer-start', this.context(record));
      try {
        assert.equal(typeof this.beforeEvidenceContinue, 'function', 'Evidence dispatch observation required');
        await this.beforeEvidenceContinue();
        record.observer = 'succeeded'; this.note('observer-succeeded', this.context(record));
      } catch (error) {
        record.observer = 'failed'; terminalMethod = 'Fetch.failRequest'; this.failure('observer', error, record);
      }
    }
    record.terminalMethod = terminalMethod; record.terminalAttempts++; record.terminalState = 'pending';
    this.note('terminal-attempt', { ...this.context(record), terminalMethod, terminalAttempts: record.terminalAttempts });
    try {
      // Ordinary requests write immediately; only the evidence observer introduces an await.
      await this.send(terminalMethod, terminalMethod === 'Fetch.continueRequest' ? { requestId: interceptionId } : { requestId: interceptionId, errorReason: 'BlockedByClient' }, sessionId, false, 15000, record);
      record.terminalState = 'succeeded'; this.note('terminal-succeeded', { ...this.context(record), terminalMethod, commandId: record.commandId });
    } catch (error) {
      record.terminalState = 'failed'; this.failure('terminal-command', error, record, { terminalMethod });
      // A terminal command's failure never causes a second command for this ID.
    }
  }
  networkEvent(kind, params, sessionId) {
    const key = this.key(sessionId, params.requestId);
    let record = this.network.get(key);
    if (!record) {
      if (this.network.size >= 512) { this.limit('network'); return; }
      record = { cdpSessionId: this.safeId(sessionId), networkId: this.safeId(params.requestId), evidence: false, finished: false, responseStatus: null, failed: null };
      this.network.set(key, record);
    }
    if (kind === 'Network.requestWillBeSent') {
      const route = this.route(params.request.url);
      Object.assign(record, route, { method: this.safeMethod(params.request.method), frameId: this.safeId(params.frameId),
        evidence: route.origin !== 'blocked' && params.request.method === 'POST' && new URL(params.request.url).pathname.endsWith('/evidence') });
      this.note(kind, { ...this.context(record), redirect: Boolean(params.redirectResponse) });
    } else if (kind === 'Network.responseReceived') {
      record.responseStatus = Number.isInteger(params.response.status) ? params.response.status : null;
      this.note(kind, { ...this.context(record), status: record.responseStatus });
    } else if (kind === 'Network.loadingFinished') { record.finished = true; this.note(kind, this.context(record)); }
    else {
      record.failed = { canceled: params.canceled === true, errorText: /^net::[A-Z_0-9]{1,64}$/.test(params.errorText) ? params.errorText : 'unclassified-network-error', blockedReasonPresent: Boolean(params.blockedReason) };
      this.note(kind, { ...this.context(record), ...record.failed });
    }
    if (record.evidence && record.failed && !record.failureReported) {
      record.failureReported = true; this.failure('evidence-loading-failed', undefined, record);
    }
  }
  terminalPending() { return [...this.pending.values()].filter(p => p.method === 'Fetch.continueRequest' || p.method === 'Fetch.failRequest').length; }
  async drain(sessionId, evidenceNetworkId) {
    const deadline = Date.now() + 2000;
    this.setPhase('final-drain');
    while (Date.now() < deadline) {
      runAbort.signal.throwIfAborted();
      if (this.pauseTasks.size || this.terminalPending()) { await delay(10); continue; }
      const watermark = this.sequence;
      await this.send('Runtime.evaluate', { expression: '0', returnByValue: true }, sessionId, false, Math.min(500, Math.max(1, deadline - Date.now())));
      await delay(25);
      if (this.sequence !== watermark || this.pauseTasks.size || this.terminalPending()) continue;
      const evidence = this.network.get(this.key(sessionId, evidenceNetworkId));
      assert(evidence?.evidence, 'Exact evidence request diagnostic correlation');
      assert.equal(evidence.responseStatus, 200, 'Exact evidence diagnostic HTTP200');
      assert.equal(evidence.finished, true, 'Exact evidence diagnostic loadingFinished');
      assert.equal(evidence.failed, null, 'Evidence request has no loadingFailed, including cancellation');
      assert([...this.pauses.values()].every(record => record.terminalAttempts === 1 && record.terminalState !== 'pending'), 'One settled terminal action for each observed pause');
      this.note('drained', { watermark, pendingPauseHandlers: 0, pendingTerminalCommands: 0 });
      return;
    }
    throw new Error('Interception observed-work drain deadline');
  }
  diagnostics(status) {
    return { status, overflow: this.overflow, phase: this.phase, pendingPauseHandlers: this.pauseTasks.size, pendingTerminalCommands: this.terminalPending(),
      events: this.events, pauses: [...this.pauses.values()], network: [...this.network.values()].map(record => ({ ...this.context(record), responseStatus: record.responseStatus, finished: record.finished, failed: record.failed })),
      failures: this.failures.map(failure => ({ ...failure, browserCancellationObserved: Boolean(failure.networkId && this.network.get(this.key(failure.cdpSessionId, failure.networkId))?.failed?.canceled) })) };
  }
  cancelPending(error) {
    for (const [commandId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error(error?.cdpKind ? error.message : 'CDP pending command canceled', { cause: error }),
        { cdpKind: error?.cdpKind ?? 'abort', commandId, cdpMethod: pending.method }));
    }
    this.pending.clear();
  }
  dispose(error) {
    this.closed = true; this.cancelPending(error);
    this.process.stdio[4].removeListener('data', this.onData);
    this.process.stdio[3].removeListener('error', this.onError); this.process.stdio[4].removeListener('error', this.onError);
    this.process.removeListener('close', this.onClose);
  }
  send(method, params = {}, sessionId, cleanup = false, timeoutMs = 15000, pauseRecord) {
    if (this.closed) return Promise.reject(Object.assign(new Error('CDP pipe closed'), { cdpKind: 'closed' }));
    if (!cleanup && runAbort.signal.aborted) return Promise.reject(Object.assign(new Error('Harness operation aborted'), { cdpKind: 'abort' }));
    if (sessionId) this.targetSessionId = this.safeId(sessionId);
    if (cleanup && method === 'Browser.close') this.expectedClose = true;
    const id = ++this.next;
    if (pauseRecord) pauseRecord.commandId = id;
    return new Promise((resolve, reject) => {
      const fail = error => { const pending = this.pending.get(id); if (!pending) return; this.pending.delete(id); clearTimeout(pending.timer); reject(error); };
      const timer = setTimeout(() => fail(Object.assign(new Error('CDP timeout: ' + method), { cdpKind: 'timeout', commandId: id })), timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => { if (error) fail(Object.assign(new Error('CDP pipe write failed'), { cdpKind: 'write', commandId: id })); }); }
      catch (error) { fail(Object.assign(new Error('CDP pipe write failed'), { cdpKind: 'write', commandId: id })); }
    });
  }
}
try {
  // Reserve seven seconds of the 90-second budget for parallel bounded teardown.
  const deadline = new Promise((_, reject) => { runDeadline = setTimeout(() => {
    const error = new Error('Harness run deadline');
    runAbort.abort(error); cdp?.cancelPending(error); reject(error);
  }, Math.max(0, 83_000 - (Date.now() - runStartedAt))); });
  await Promise.race([deadline, (async () => {
  scratch = mkdtempSync(join(tmpdir(), 'houseatlas-combined-capture-drafts-'));
  const data = join(scratch, 'data');
  const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
  const openssl = spawnOwned('OpenSSL', 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: ['ignore', 'ignore', 'ignore'] });
  assert(await waitForStopped(lifecycle.get(openssl), 10000), 'Disposable certificate creation deadline');
  runAbort.signal.throwIfAborted();
  assert.equal(openssl.exitCode, 0, 'Disposable certificate creation');
  service = spawnOwned('Rust service', resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key,
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (lifecycle.get(service).error || lifecycle.get(service).closed) throw new Error('Rust startup failed: ' + serviceError, { cause: lifecycle.get(service).error });
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, editorLogin } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawnOwned('Chromium', chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser); cdp.allowedOrigin=origin; cdp.blocked=0;
  const version = await cdp.send('Browser.getVersion');
  // Both inspected release IDLs take DOMString input_arguments. A browser
  // version change requires source inspection before this ordinary flow runs.
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97', 'Chrome/154.0.8037.98'].includes(version.product), 'Inspected native WebMCP browser version');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Browser receives the actual issued Secure cookie');
  const contextCookie = await send('Network.setCookie', { name:'houseatlas-smoke-context', value:'ordinary', url:origin, path:'/', secure:true, sameSite:'Strict' });
  assert.equal(contextCookie.success, true, 'Ordinary additional cookie retains actual session authority');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) console.error(JSON.stringify({healthyException:result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,responses,runtimeErrors}));
    assert(!result.exceptionDetails, 'Healthy browser evaluation'); return result.result.value;
  };
  // Only synthetic loopback fixture credentials are used; nothing private is emitted.
  cdp.setPhase('initial-navigation');
  await send('Page.navigate', { url: origin });
  await until(async()=>await evaluate('Boolean(document.querySelector("main#main"))'), 'React shell');
  cdp.setPhase('synthetic-login');
  const login = await evaluate(`fetch('/api/atlas/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(editorLogin))}}).then(r=>r.status)`);
  assert.equal(login,200);
  cdp.setPhase('login-reload');
  await send('Page.reload');
  const openAtlasTools = async () => {
    await until(async()=>await evaluate(`(()=>{const b=[...document.querySelectorAll('nav[aria-label="Sections"] button')].find(b=>b.textContent.trim()==='Changes'&&b.getClientRects().length);if(!b)return false;b.click();return true})()`),'Changes navigation');
    await until(async()=>await evaluate(`(()=>{const b=[...document.querySelectorAll('main#main button')].find(b=>b.textContent.trim()==='Atlas tools'&&b.getClientRects().length);if(!b)return false;b.click();return true})()`),'Atlas tools action');
    await until(async()=>await evaluate('Boolean(document.querySelector("[role=dialog][aria-label=\\"Atlas tools\\"]:not([hidden])"))'),'Atlas tools dialog');
  };
  await openAtlasTools();
  const readJson = path => evaluate(`fetch(${JSON.stringify(path)},{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>{if(r.status!==200)throw new Error('Healthy native read');return r.json()})`);
  const view = await readJson('/api/atlas/view');
  const room = view.entries.find(e=>e.kind==='place'&&e.semanticKind==='room'); assert(room);
  const scopePath=`workspaces/${view.scope.workspaceId}/homes/${view.scope.homeId}`;
  const nativePrefix=`/api/atlas/v1/${scopePath}/records`;
  await evaluate('location.hash='+JSON.stringify('#place?key='+encodeURIComponent(room.key)));
  await until(async()=>await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Add evidence'&&b.getClientRects().length);if(!b)return false;b.click();return true})()`),'Contextual Add evidence');
  const form='form[aria-label="Atlas attachment"]';
  await until(async()=>await evaluate(`Boolean(document.querySelector(${JSON.stringify(form+' input[name=file]:not(:disabled)')}))`),'Admitted capture form');
  const controls=await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});return [...f.querySelectorAll('input[type=file]')].map(i=>({name:i.name,accept:i.accept,capture:i.getAttribute('capture'),label:i.labels[0].innerText}))})()`);
  assert.equal(controls.find(c=>c.name==='camera').capture,'environment');
  assert.equal(controls.find(c=>c.name==='photos').capture,null);
  assert.equal(controls.find(c=>c.name==='file').capture,null);
  assert(controls.every(c=>!c.accept.includes('*')));
  const selectFile=async(name,path)=>{
    const doc=await send('DOM.getDocument',{depth:0});
    const node=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:form+` input[name=${name}]`});assert(node.nodeId>0);
    await send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path]});
    await until(async()=>await evaluate(`document.querySelector(${JSON.stringify(form)}).textContent.includes('Selected:')`),'Selected synthetic original');
  };
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const fixtures=join(root,'frontend/capture-evidence-tests/fixtures');
  const rows=[];
  const name='synthetic-photo.jpg', type='image/jpeg', method='photo-picker';
  const input=readFileSync(join(fixtures,name));
  const localDatabase='houseatlas-local-unsent-captures-v1';
  assert.equal(await evaluate(`indexedDB.databases().then(ds=>ds.some(d=>d.name===${JSON.stringify(localDatabase)}))`),false,'No draft database before explicit opt-in');
  cdp.setPhase('unsent-local-save');
  await selectFile('photos',join(fixtures,name));
  await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});f.querySelector('[name=statement]').value='Synthetic saved draft evidence';f.querySelector('[name=reason]').value='Attach generated synthetic saved evidence';const l=f.querySelector('[name=license]');l.value='0';l.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const panel='[aria-label="Local capture drafts"]';
  const click=async(text)=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getClientRects().length&&!b.disabled);if(!b)throw new Error('Required action unavailable');b.click();return true;})()`);
  await evaluate(`document.querySelector(${JSON.stringify(panel+' input[type=checkbox]')}).click()`);
  await click('Save local draft');
  await until(async()=>await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('Unsent draft saved on this browser.')`),'Explicit local save');
  assert.equal(uploadRequests.length,0,'Local save never submits');
  const localRows=()=>evaluate(`new Promise((resolve,reject)=>{const q=indexedDB.open(${JSON.stringify(localDatabase)},1);q.onerror=()=>reject(new Error('Synthetic database read'));q.onsuccess=()=>{const db=q.result,tx=db.transaction('drafts','readonly'),r=tx.objectStore('drafts').getAll();r.onerror=()=>reject(new Error('Synthetic row read'));r.onsuccess=()=>Promise.all(r.result.map(async row=>({id:row.id,state:row.state,recordId:row.recordId,sha256:row.sha256,capture:row.capture,form:row.form,attempt:row.attempt,bytes:Array.from(new Uint8Array(await row.original.arrayBuffer()))}))).then(resolve,reject);tx.oncomplete=()=>db.close();};})`);
  const savedRows=await localRows();assert.equal(savedRows.length,1);assert.equal(savedRows[0].state,'unsent');assert.equal(savedRows[0].attempt,null);
  assert.deepEqual(savedRows[0].bytes,Array.from(input));assert.equal(savedRows[0].capture.selectionMethod,method);
  // Normal explicit UI close and page reload; no crash or interrupted attempt.
  cdp.setPhase('normal-reopen');
  await click('Close');await send('Page.reload');await openAtlasTools();
  await evaluate('location.hash='+JSON.stringify('#place?key='+encodeURIComponent(room.key)));
  await until(async()=>await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Add evidence'&&b.getClientRects().length);if(!b)return false;b.click();return true})()`),'Reopen contextual editor');
  await until(async()=>await evaluate(`Boolean(document.querySelector(${JSON.stringify(form+' input[name=file]:not(:disabled)')}))`),'Reopened admission');
  assert.deepEqual(await localRows(),savedRows,'Normal reopen preserves exact bytes, form and original provenance');
  await click('View local drafts');
  await until(async()=>await evaluate(`Boolean([...document.querySelectorAll(${JSON.stringify(panel+' button')})].find(b=>b.textContent==='Review synthetic-photo.jpg'&&!b.disabled))`),'Matching draft list');
  const sessionReadsBefore=observedUrls.filter(url=>new URL(url).pathname==='/api/atlas/auth/session').length;
  const placeReadsBefore=observedUrls.filter(url=>new URL(url).pathname.includes('/api/atlas/editing/v1/')&&new URL(url).pathname.endsWith('/place')).length;
  cdp.setPhase('saved-review');
  await click('Review synthetic-photo.jpg');
  await until(async()=>await evaluate(`Boolean(document.querySelector('[aria-label="Saved capture review"]'))`),'Fresh saved review');
  const reviewText=await evaluate(`document.querySelector('[aria-label="Saved capture review"]').textContent`);
  assert(reviewText.includes(savedRows[0].form.statement)&&reviewText.includes(savedRows[0].form.reason));
  const reviewBytes=await evaluate(`fetch(document.querySelector('[aria-label="Saved capture review"] a[download]').href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))`);
  assert.deepEqual(reviewBytes,Array.from(input),'Review download is exact local original');
  assert.equal(uploadRequests.length,0,'Review alone never submits');
  const sessionReadsAfterReview=observedUrls.filter(url=>new URL(url).pathname==='/api/atlas/auth/session').length;
  const placeReadsAfterReview=observedUrls.filter(url=>new URL(url).pathname.includes('/api/atlas/editing/v1/')&&new URL(url).pathname.endsWith('/place')).length;
  assert(sessionReadsAfterReview>sessionReadsBefore,'Explicit review reads canonical session');
  assert(placeReadsAfterReview>placeReadsBefore,'Explicit review loads native place');
  let dispatchMarker;
  cdp.beforeEvidenceContinue=async()=>{
    const atDispatch=await localRows();assert.equal(atDispatch.length,1);assert.equal(atDispatch[0].state,'outcome-unknown');
    assert(atDispatch[0].attempt?.requestId&&atDispatch[0].attempt?.idempotencyKey);assert.deepEqual(atDispatch[0].bytes,Array.from(input));
    dispatchMarker=atDispatch[0].attempt;
  };
  await evaluate(`document.querySelector('[aria-label="Saved capture review"] input[type=checkbox]').click()`);
  cdp.setPhase('confirmed-upload');
  await click('Confirm upload');
  await until(async()=>await evaluate(`document.querySelector('section[aria-label="Atlas place editing"] [role=status]')?.textContent==='Saved. Information refreshed.' && document.querySelector('section[aria-label="Atlas place editing"]')?.getAttribute('aria-busy')==='false'`),'Confirmed draft upload and view refresh');
  assert.equal(uploadRequests.length,1,'Exactly one fresh explicit evidence POST');
  const request=uploadRequests[0];await until(()=>loaded.has(request.requestId),'Upload body settled');assert.equal(responses.find(r=>r.requestId===request.requestId)?.status,200);
  const receipt=JSON.parse(await evaluate(`document.querySelector('section[aria-label="Atlas place editing"] details pre').textContent`));
  assert.equal(receipt.status,'committed');assert.equal(receipt.commandId,'atlas.batch.execute');assert.deepEqual(receipt.resolvedScope,view.scope);
  assert(dispatchMarker,'Durable marker observed before allowing the evidence POST');assert.equal(receipt.requestId,dispatchMarker.requestId);cdp.beforeEvidenceContinue=null;
  assert.deepEqual(await localRows(),[],'Local bytes removed after validated committed receipt and before ordinary view refresh');
  cdp.setPhase('native-readback');
  const committedEvidence=receipt.data.records.find(r=>r.target.recordType==='evidence');assert(committedEvidence);
  const evidence=await readJson(nativePrefix+'/evidence/'+committedEvidence.target.recordId);validateShape('record',evidence);
  assert.equal(evidence.payload.statement,savedRows[0].form.statement);assert.equal(evidence.payload.provenance.factAt,null);assert.equal(evidence.payload.provenance.evidenceBasis,'unknown');
  const claim=JSON.parse(evidence.payload.provenance.vantage.slice('Browser selection claim v1: '.length));assert.deepEqual(claim,savedRows[0].capture);
  const assetId=evidence.payload.references[0].assetId;
  const asset=await readJson(nativePrefix+'/asset/'+assetId);validateShape('record',asset);
  assert.equal(asset.payload.sha256,createHash('sha256').update(input).digest('hex'));assert.equal(asset.payload.byteSize,input.length);assert.equal(asset.payload.contentType,type);assert.equal(asset.payload.previewPolicy,'download-only');
  const digest=createHash('sha256').update(JSON.stringify({assetId,kind:'atlas-asset'})).digest('hex');
  const download=await evaluate(`fetch(${JSON.stringify('/api/atlas/media/'+view.scope.workspaceId+'/'+view.scope.homeId+'/'+digest+'/download')},{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),body:Array.from(new Uint8Array(await r.arrayBuffer()))}))`);
  assert.equal(download.status,200);assert.equal(download.type,type);assert(download.disposition.startsWith('attachment;'));assert.deepEqual(download.body,Array.from(input));
  const sessionReads=observedUrls.filter(url=>new URL(url).pathname==='/api/atlas/auth/session').length-sessionReadsBefore;
  const placeReads=observedUrls.filter(url=>new URL(url).pathname.includes('/api/atlas/editing/v1/')&&new URL(url).pathname.endsWith('/place')).length-placeReadsBefore;
  assert(sessionReads>=2,'Review and confirmation each read canonical session');
  assert(placeReads>=2,'Review and confirmation each load fresh native place');
  assert(observedUrls.filter(url=>new URL(url).pathname==='/api/atlas/auth/session').length>sessionReadsAfterReview,'Explicit confirmation reads canonical session');
  assert(observedUrls.filter(url=>new URL(url).pathname.includes('/api/atlas/editing/v1/')&&new URL(url).pathname.endsWith('/place')).length>placeReadsAfterReview,'Explicit confirmation loads native place');
  // A second explicitly saved unsent file exercises consented logout cleanup.
  // It never invokes evidence upload and is not an interrupted/replayed attempt.
  cdp.setPhase('logout-local-save');
  await selectFile('photos',join(fixtures,name));
  await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});f.querySelector('[name=statement]').value='Synthetic logout cleanup draft';f.querySelector('[name=reason]').value='Remove generated local file before sign out';const l=f.querySelector('[name=license]');l.value='0';l.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector(${JSON.stringify(panel+' input[type=checkbox]')}).click();})()`);
  await click('Save local draft');
  await until(async()=>await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('Unsent draft saved on this browser.')`),'Explicit logout-cleanup draft save');
  assert.equal((await localRows()).length,1);assert.equal(uploadRequests.length,1);
  await click('Close');await evaluate("location.hash='#settings'");
  cdp.setPhase('consented-logout');
  await until(async()=>await evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign out'&&b.getClientRects().length&&!b.disabled))`),'Sign out action');
  await click('Sign out');
  await until(async()=>await evaluate(`Boolean(document.querySelector('[role=dialog][aria-labelledby="capture-logout-heading"]'))`),'Explicit logout choices');
  await evaluate(`document.querySelector('[role=dialog][aria-labelledby="capture-logout-heading"] input[type=checkbox]').click()`);
  await click('Delete local captures and sign out');
  await until(async()=>await evaluate(`Boolean(document.querySelector('form input[name=username]')||[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Open Home'))`),'Confirmed normal sign out');
  assert.deepEqual(await localRows(),[],'Explicit cleanup removed local captures before normal logout');assert.equal(uploadRequests.length,1,'Logout cleanup does not submit');
  rows.push({case:'healthy-save-reopen-confirm',name,type,method,assetId,evidenceId:evidence.recordId,sha256:asset.payload.sha256,byteSize:input.length,localSaveUploads:0,reviewUploads:0,confirmedUploads:1,normalReopenBytesMatch:true,localReviewBytesMatch:true,localAcknowledgedRemoved:true,durableUnknownBeforeDispatch:true,receiptMarkerCorrelated:true,explicitLogoutCleanup:true,logoutUploads:0,returnedBytesMatch:true,canonicalReads:sessionReads,freshPlaceReads:placeReads,mobileEmulationOnly:true});
  assert(observedUrls.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:'+origin+'/')),'Observed page requests remain loopback');
  await cdp.drain(sessionId, request.requestId);
  assert.equal(runtimeErrors.length,0); assert.equal(cdp.blocked,0);assert.equal(cdp.transportError,undefined);
  const result={source,browser:version.product,rows,controls,observedRequests:observedUrls.length,scope:'Source-only proposed actual React/native loopback TLS; synthetic Files only; no camera permission or iPhone claim'};
  completedResult = result;
  })()]);
} catch (error) { primaryError = error; }
finally {
  clearTimeout(runDeadline);
  const stopped = new Error('Harness run ended');
  if (!runAbort.signal.aborted) runAbort.abort(stopped);
  cdp?.cancelPending(stopped);
  try { await stopAll(); } catch (error) { cleanupError = error; }
}
if (!primaryError && cdp?.transportError) primaryError = new Error('Interception error after final assertion');
if (!primaryError && runtimeErrors.length) primaryError = new Error('Runtime error after final assertion');
if (!primaryError && cdp?.blocked) primaryError = new Error('Blocked off-origin request after final assertion');
if (!primaryError && cdp && !observedUrls.every(url => url.startsWith(cdp.allowedOrigin + '/') || url.startsWith('blob:' + cdp.allowedOrigin + '/')))
  primaryError = new Error('Observed off-origin request after final assertion');
if (primaryError || cleanupError) console.error(JSON.stringify({ kind: 'interception-diagnostics', status: 'FAILED',
  primaryFailure: Boolean(primaryError), cleanupStatus: cleanupError ? 'failed' : 'completed',
  ownedChildren: owned.map(entry => ({ label: entry.label, pid: entry.child.pid ?? null, closed: entry.closed, groupGone: entry.groupGone })),
  ...(cdp ? { interception: cdp.diagnostics('failed') } : { interception: null }) }));
if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], 'Harness run and cleanup failed');
if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;
const result = { ...completedResult, interception: cdp.diagnostics('passed') };
if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
