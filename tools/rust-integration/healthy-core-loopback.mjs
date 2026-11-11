// Positive core auth, canonical/page reads, fresh local writes and actual UI.
// No rejection/replay/expiry/revocation/fault/crash/concurrency control or provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium, 'A real Chromium executable is required');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-at52-healthy-'));
const data = join(scratch, 'data');
const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(50); }
  throw new Error('Timed out: ' + label);
}
const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
assert.equal(openssl.status, 0, 'Disposable certificate creation');
let service, browser, cdp, serviceOutput = '', serviceError = '';
const observedUrls = [], responses = [], runtimeErrors = [], nativeListResponses = [];
let phase = 'initial-view';
const requestPhases = new Map();
const nativeReads = new Map();
// Diagnostic only: bounded transfer metadata of generated fixture reads for failure messages.
// No assertion or wait reads it. Byte counts are CDP's decoded/encoded transfer counts and
// Content-Length is the wire header, so they need not be equal for an encoded response.
// Diagnostic only: a passive page-side record of what the page itself did with each generated
// /invoke GET (headers seen, body read to done, page-issued cancel or abort). Wrappers return the
// original values and hold entries weakly by Response/stream/reader; no assertion or wait reads it.
// It observes this test browser only and establishes nothing about production behavior.
const pageReadObserver = `(() => { try {
  // Settlement evidence, not only diagnostics: terminal flags are uncapped; the event list stays bounded.
  const state = { document: String(performance.timeOrigin) + ':' + Math.random().toString(36).slice(2), phase: null, overflow: false, unsupported: 0, entries: [] };
  const responses = new WeakMap(), streams = new WeakMap(), readers = new WeakMap();
  let sequence = 0;
  globalThis.__houseatlasReadLog = {
    begin(phase) { state.phase = String(phase); state.overflow = false; state.unsupported = 0; state.entries = []; return { document: state.document, phase: state.phase }; },
    snapshot() { return { document: state.document, phase: state.phase, overflow: state.overflow, unsupported: state.unsupported, entries: state.entries.map(entry => ({ ...entry, events: entry.events.slice() })) }; },
  };
  const note = (entry, name) => { try { if (entry && entry.events.length < 14) entry.events.push(++sequence + ':' + name + '@' + Math.round(performance.now())); } catch {} };
  // A cancellation or abort after positive EOF cannot undo a completed read; before EOF it is terminal.
  const interrupt = (entry, flag) => { try { if (entry && !entry.done) entry[flag] = true; } catch {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (...args) {
    const result = originalFetch.apply(this, args);
    try {
      const plain = typeof args[0] === 'string' || args[0] instanceof URL;
      const url = new URL(plain ? String(args[0]) : args[0].url, location.href);
      const method = String(args[1]?.method ?? (plain ? 'GET' : args[0].method)).toUpperCase();
      if (method === 'GET' && url.pathname.endsWith('/invoke')) {
        if (state.entries.length >= 48) state.overflow = true;
        else {
          let commandId = null, requestId = null;
          try {
            const envelope = JSON.parse(url.searchParams.get('request'));
            commandId = String(envelope.commandId).slice(0, 64);
            if (typeof envelope.requestId === 'string' && envelope.requestId.length > 0 && envelope.requestId.length <= 64) requestId = envelope.requestId;
          } catch {}
          const entry = { phase: state.phase, commandId, requestId, status: null, readers: 0, bytes: 0, done: false, abort: false, cancel: false, reject: false, events: [] };
          state.entries.push(entry); note(entry, 'fetch');
          const signal = args[1]?.signal ?? (plain ? undefined : args[0].signal);
          if (signal) signal.addEventListener('abort', () => { interrupt(entry, 'abort'); note(entry, 'signal-abort:' + String(signal.reason?.status ?? signal.reason?.name ?? 'unknown').slice(0, 24)); }, { once: true });
          result.then(response => { responses.set(response, entry); entry.status = response.status; note(entry, 'headers:' + response.status); },
            error => { interrupt(entry, 'reject'); note(entry, 'fetch-reject:' + String(error?.name).slice(0, 24)); });
        }
      }
    } catch { state.unsupported += 1; }
    return result;
  };
  const body = Object.getOwnPropertyDescriptor(Response.prototype, 'body');
  Object.defineProperty(Response.prototype, 'body', { ...body, get() { const stream = body.get.call(this); try { const entry = responses.get(this); if (entry && stream) streams.set(stream, entry); } catch {} return stream; } });
  const getReader = ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader = function (...args) { const reader = getReader.apply(this, args); try { const entry = streams.get(this); if (entry) { readers.set(reader, entry); entry.readers += 1; note(entry, 'reader'); } } catch {} return reader; };
  const streamCancel = ReadableStream.prototype.cancel;
  ReadableStream.prototype.cancel = function (...args) { try { const entry = streams.get(this); interrupt(entry, 'cancel'); note(entry, 'stream-cancel'); } catch {} return streamCancel.apply(this, args); };
  const read = ReadableStreamDefaultReader.prototype.read;
  ReadableStreamDefaultReader.prototype.read = function (...args) {
    const result = read.apply(this, args);
    try {
      const entry = readers.get(this);
      if (entry) result.then(part => {
        if (part.done) { entry.done = true; note(entry, 'read-done'); }
        else { entry.bytes += Number(part.value?.byteLength ?? 0); note(entry, 'read-bytes:' + part.value?.byteLength); }
      }, error => { interrupt(entry, 'reject'); note(entry, 'read-reject:' + String(error?.name).slice(0, 24)); });
    } catch {}
    return result;
  };
  const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
  ReadableStreamDefaultReader.prototype.cancel = function (...args) { try { const entry = readers.get(this); interrupt(entry, 'cancel'); note(entry, 'reader-cancel'); } catch {} return readerCancel.apply(this, args); };
} catch {} })()`;
const viewerCommands = ['atlas.binding.list', 'atlas.identity.list', 'atlas.location-semantics.list', 'atlas.relation.list'];
const viewerReadyExpression = "document.querySelector('.atlas-section .topology-scope [role=status]')?.textContent === 'No reviewed buildings in this home.'";
const applicationRequestId = url => {
  try { const id = JSON.parse(url.searchParams.get('request')).requestId; return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null; } catch { return null; }
};
const noteResponseHeaders = (read, response) => {
  const header = name => { const found = Object.entries(response?.headers ?? {}).find(([key]) => key.toLowerCase() === name); return found ? String(found[1]) : null; };
  read.contentLength = header('content-length'); read.contentEncoding = header('content-encoding');
};
// Pure settlement oracle. Network rows and page entries are joined one-to-one by
// the application requestId the production client already places in each read
// envelope. A read counts as consumed only on positive page EOF with matching
// bytes; a browser-reported ERR_ABORTED is tolerated solely for such a read.
// Byte equality or a missing cancellation alone never passes. `fatal` verdicts
// cannot recover; other refusals may still resolve before the unchanged timeout.
const judgeViewerReads = (rows, snap, expected, current) => {
  const fatal = reason => ({ ok: false, fatal: true, reason }), wait = reason => ({ ok: false, fatal: false, reason });
  if (!snap || !Array.isArray(snap.entries)) return fatal('page read record unavailable');
  if (typeof expected.document !== 'string' || snap.document !== expected.document) return fatal('document replaced');
  if (typeof expected.phase !== 'string' || snap.phase !== expected.phase || snap.entries.some(entry => entry.phase !== expected.phase)) return fatal('page read record from another phase');
  if (snap.overflow) return fatal('page read record overflow');
  if (snap.unsupported) return fatal('unsupported page read input');
  const known = id => typeof id === 'string' && id.length > 0;
  if (!rows.every(row => known(row.requestId)) || !snap.entries.every(entry => known(entry.requestId))) return fatal('missing application requestId');
  const pages = new Map(snap.entries.map(entry => [entry.requestId, entry]));
  if (pages.size !== snap.entries.length || new Set(rows.map(row => row.requestId)).size !== rows.length) return fatal('duplicate application requestId');
  if (rows.length !== pages.size || !rows.every(row => pages.has(row.requestId))) return wait('page and network requestId sets differ');
  if (rows.some(row => pages.get(row.requestId).commandId !== row.commandId)) return fatal('requestId maps to another command');
  if (rows.some(row => !viewerCommands.includes(row.commandId))) return fatal('unexpected viewer command');
  if (rows.length < 4) return wait('fewer than four viewer reads');
  if (!rows.every(row => row.finished)) return wait('network read not terminal');
  if (!snap.entries.every(entry => entry.done || entry.abort || entry.cancel || entry.reject)) return wait('page read without EOF or terminal failure');
  // Unchanged protection: every row has authorized 200 headers, and an old row
  // may fail only by cancellation after those headers.
  if (!rows.every(row => row.status === 200 && (!row.failed || (row.canceled && row.authorizedBeforeCancellation)))) return fatal('read without authorized 200 headers or with a non-cancel failure');
  const consumed = row => {
    const entry = pages.get(row.requestId);
    return entry.status === 200 && entry.readers === 1 && entry.done === true && !entry.abort && !entry.cancel && !entry.reject
      && Number.isSafeInteger(entry.bytes) && entry.bytes === row.bodyBytes
      && (row.contentEncoding !== null || row.contentLength === null || Number(row.contentLength) === entry.bytes)
      && (!row.failed || row.errorText === 'net::ERR_ABORTED');
  };
  const counts = viewerCommands.map(commandId => rows.filter(row => row.commandId === commandId).length);
  if (counts.some(count => count === 0)) return wait('expected viewer command not yet read');
  if (counts.some(count => count !== counts[0])) return wait('viewer command counts not balanced');
  for (const commandId of viewerCommands) {
    const reads = rows.filter(row => row.commandId === commandId);
    if (!(current ? consumed(reads[reads.length - 1]) : reads.some(consumed))) return wait('no successfully consumed ' + (current ? 'current ' : '') + 'read of ' + commandId);
  }
  if (current && snap.ready !== true) return wait('validated ready status absent');
  return { ok: true, fatal: false, reason: 'settled' };
};
// Deterministic controls for the oracle above, run in process before any
// browser work. They exercise the verdicts on synthetic records; they do not
// induce real browser aborts and do not exercise the page observer itself.
const verifyViewerReadOracle = () => {
  const expected = { document: 'control-document', phase: 'control-phase' };
  const round = (prefix, rows, entries) => viewerCommands.forEach((commandId, index) => {
    const requestId = prefix + index, bytes = 100 + index;
    rows.push({ commandId, requestId, status: 200, finished: true, failed: false, canceled: false, authorizedBeforeCancellation: false,
      bodyBytes: bytes, contentLength: String(bytes), contentEncoding: null, errorText: null });
    entries.push({ phase: expected.phase, commandId, requestId, status: 200, readers: 1, bytes, done: true, abort: false, cancel: false, reject: false });
  });
  const check = (label, mutate, outcome, current = true) => {
    const rows = [], entries = []; round('control-', rows, entries);
    const snap = { ...expected, overflow: false, unsupported: 0, ready: true, entries };
    mutate(rows, entries, snap);
    const verdict = judgeViewerReads(rows, snap, expected, current);
    assert.deepEqual([verdict.ok, verdict.fatal, verdict.reason], outcome, 'Viewer read oracle control: ' + label);
  };
  const aborted = row => Object.assign(row, { failed: true, canceled: true, authorizedBeforeCancellation: true, errorText: 'net::ERR_ABORTED' });
  const unconsumed = [false, false, 'no successfully consumed current read of atlas.identity.list'];
  const oldRule = [false, true, 'read without authorized 200 headers or with a non-cancel failure'];
  check('healthy', () => {}, [true, false, 'settled']);
  check('reported abort after correlated EOF', rows => aborted(rows[1]), [true, false, 'settled']);
  check('superseded cancelled round before a consumed round', (rows, entries) => {
    const oldRows = [], oldEntries = []; round('old-', oldRows, oldEntries);
    oldRows.forEach(row => { aborted(row); row.bodyBytes = 10; });
    oldEntries.forEach(entry => Object.assign(entry, { done: false, cancel: true, bytes: 10 }));
    rows.unshift(...oldRows); entries.unshift(...oldEntries);
  }, [true, false, 'settled']);
  check('pre-header abort', (rows, entries) => {
    Object.assign(rows[1], { status: null, failed: true, canceled: true, authorizedBeforeCancellation: false, bodyBytes: 0, contentLength: null, errorText: 'net::ERR_ABORTED' });
    Object.assign(entries[1], { status: null, readers: 0, bytes: 0, done: false, abort: true, reject: true });
  }, oldRule);
  check('mid-body cancel with matching partial bytes', (rows, entries) => {
    aborted(rows[1]); rows[1].bodyBytes = 40; Object.assign(entries[1], { bytes: 40, done: false, cancel: true });
  }, unconsumed);
  check('mid-body abort with full bytes and no EOF', (rows, entries) => {
    aborted(rows[1]); Object.assign(entries[1], { done: false, abort: true, reject: true });
  }, unconsumed);
  check('missing EOF', (rows, entries) => { entries[1].done = false; }, [false, false, 'page read without EOF or terminal failure']);
  check('missing EOF behind a reported abort with matching bytes', (rows, entries) => { aborted(rows[1]); entries[1].done = false; },
    [false, false, 'page read without EOF or terminal failure']);
  check('page bytes short of network bytes', (rows, entries) => { entries[1].bytes -= 1; }, unconsumed);
  check('body short of its Content-Length', (rows, entries) => { rows[1].bodyBytes -= 1; entries[1].bytes -= 1; }, unconsumed);
  check('second reader on one body', (rows, entries) => { entries[1].readers = 2; }, unconsumed);
  check('page entry from another phase', (rows, entries) => { entries[1].phase = 'earlier-phase'; }, [false, true, 'page read record from another phase']);
  check('page record reset by another phase', (rows, entries, snap) => { snap.phase = 'later-phase'; }, [false, true, 'page read record from another phase']);
  check('network read absent from the page record', (rows, entries) => { entries.splice(1, 1); }, [false, false, 'page and network requestId sets differ']);
  check('page read absent from the network record', rows => { rows.splice(1, 1); }, [false, false, 'page and network requestId sets differ']);
  check('duplicate requestId', (rows, entries) => { entries[1].requestId = entries[0].requestId; }, [false, true, 'duplicate application requestId']);
  check('mismatched requestId', (rows, entries) => { entries[1].requestId = 'control-other'; }, [false, false, 'page and network requestId sets differ']);
  check('missing requestId', (rows, entries) => { entries[1].requestId = null; }, [false, true, 'missing application requestId']);
  check('requestId joined to another command', (rows, entries) => {
    const first = entries[0].requestId; entries[0].requestId = entries[1].requestId; entries[1].requestId = first;
  }, [false, true, 'requestId maps to another command']);
  check('document replacement', (rows, entries, snap) => { snap.document = 'replacement-document'; }, [false, true, 'document replaced']);
  check('page record unavailable', (rows, entries, snap) => { snap.entries = null; }, [false, true, 'page read record unavailable']);
  check('non-200 response', (rows, entries) => { rows[1].status = 403; entries[1].status = 403; }, oldRule);
  check('transport failure after EOF', rows => Object.assign(rows[1], { failed: true, canceled: false, errorText: 'net::ERR_FAILED' }), oldRule);
  check('cancelled with another error after EOF', rows => { aborted(rows[1]); rows[1].errorText = 'net::ERR_CONNECTION_RESET'; }, unconsumed);
  check('network read not terminal', rows => { rows[1].finished = false; }, [false, false, 'network read not terminal']);
  check('unbalanced command counts', (rows, entries) => {
    rows.push({ ...rows[1], requestId: 'control-extra' }); entries.push({ ...entries[1], requestId: 'control-extra' });
  }, [false, false, 'viewer command counts not balanced']);
  check('unexpected command', (rows, entries) => { rows[1].commandId = 'atlas.other.list'; entries[1].commandId = 'atlas.other.list'; }, [false, true, 'unexpected viewer command']);
  check('ready status absent', (rows, entries, snap) => { snap.ready = false; }, [false, false, 'validated ready status absent']);
  check('page record overflow', (rows, entries, snap) => { snap.overflow = true; }, [false, true, 'page read record overflow']);
  check('unsupported page read input', (rows, entries, snap) => { snap.unsupported = 1; }, [false, true, 'unsupported page read input']);
  check('current read cancelled while an older one was consumed', (rows, entries) => {
    const newRows = [], newEntries = []; round('new-', newRows, newEntries);
    aborted(newRows[1]); newRows[1].bodyBytes = 40; Object.assign(newEntries[1], { bytes: 40, done: false, cancel: true });
    rows.push(...newRows); entries.push(...newEntries);
  }, unconsumed);
  check('later cancelled round after navigation keeps an earlier consumed read', (rows, entries) => {
    const newRows = [], newEntries = []; round('new-', newRows, newEntries);
    aborted(newRows[1]); newRows[1].bodyBytes = 40; Object.assign(newEntries[1], { bytes: 40, done: false, cancel: true });
    rows.push(...newRows); entries.push(...newEntries);
  }, [true, false, 'settled'], false);
};
verifyViewerReadOracle();
let readEventSequence = 0;
const observeRead = (read, event, params) => {
  if (!read?.diagnostic) return;
  try {
    const d = read.diagnostic, sequence = ++readEventSequence;
    if (event === 'response') {
      const header = name => String(Object.entries(params.response?.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? '').slice(0, 32) || null;
      d.contentLength = header('content-length'); d.contentEncoding = header('content-encoding');
    } else if (event === 'data') {
      d.chunks = (d.chunks ?? 0) + 1; d.decodedBytes = (d.decodedBytes ?? 0) + Number(params.dataLength);
      d.encodedBytes = (d.encodedBytes ?? 0) + Number(params.encodedDataLength);
    } else if (event === 'finished') d.finishedEncodedBytes = Number(params.encodedDataLength);
    else { d.errorText = String(params.errorText ?? '').slice(0, 80); d.canceledFlag = params.canceled ?? null; d.blockedReason = params.blockedReason ?? null; }
    if ((event !== 'data' || d.chunks === 1) && d.order.length < 8) d.order.push(sequence + ':' + event);
  } catch { /* diagnostics never affect the flow */ }
};
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0);
  constructor(process) {
    this.process = process;
    process.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.id) {
          const pending = this.pending.get(message.id); if (!pending) continue;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        } else if (message.method === 'Network.requestWillBeSent') {
          observedUrls.push(message.params.request.url);
          requestPhases.set(message.params.requestId, phase);
          const url = new URL(message.params.request.url);
          if (phase === 'viewer-login' && message.params.request.method === 'GET' && url.pathname.endsWith('/invoke')) nativeReads.set(message.params.requestId, {
            phase, commandId: JSON.parse(url.searchParams.get('request')).commandId,
            requestId: applicationRequestId(url), bodyBytes: 0, contentLength: null, contentEncoding: null, errorText: null,
            status: null, finished: false, failed: false, canceled: false, authorizedBeforeCancellation: false,
            diagnostic: { order: [++readEventSequence + ':request'] },
          });
        }
        else if (message.method === 'Network.responseReceived') {
          const response = message.params.response;
          const read = nativeReads.get(message.params.requestId);
          if (read) { read.status = response.status; observeRead(read, 'response', message.params); noteResponseHeaders(read, message.params.response); }
          responses.push({ url: response.url, status: response.status,
            requestPhase: requestPhases.get(message.params.requestId) ?? 'unknown', responsePhase: phase });
          requestPhases.delete(message.params.requestId);
          // Earlier UI lifetimes must not exhaust observation before the two
          // measured topology lifetimes below; retain every actual response.
          if (new URL(response.url).pathname.endsWith('/invoke'))
            nativeListResponses.push({ id: message.params.requestId, path: new URL(response.url).pathname, status: response.status,
              snapshot: Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'x-atlas-snapshot-sha256')?.[1] ?? null });
        }
        else if (message.method === 'Network.dataReceived') {
          const read = nativeReads.get(message.params.requestId);
          if (read) read.bodyBytes += Number(message.params.dataLength);
          observeRead(read, 'data', message.params);
        }
        else if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
          const read = nativeReads.get(message.params.requestId);
          if (read) {
            observeRead(read, message.method === 'Network.loadingFailed' ? 'failed' : 'finished', message.params);
            read.finished = true;
            if (message.method === 'Network.loadingFailed') {
              read.failed = true;
              read.canceled = message.params.canceled === true;
              read.authorizedBeforeCancellation = read.status === 200;
              read.errorText = String(message.params.errorText ?? '');
            }
          }
        }
        else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
try {
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, login, editorLogin } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  // Diagnostic only; a refused installation leaves the flow unchanged.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: pageReadObserver });
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Browser receives the actual issued Secure cookie');
  const contextCookie = await send('Network.setCookie', { name:'houseatlas-smoke-context', value:'ordinary', url:origin, path:'/', secure:true, sameSite:'Strict' });
  assert.equal(contextCookie.success, true, 'Ordinary additional cookie retains actual session authority');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, 'Healthy browser evaluation'); return result.result.value;
  };
  const viewerRead = { document: null, phase: null };
  // Reset the page record at the same boundary as network tracking, before the login is initiated.
  const beginViewerReadPhase = async () => {
    const token = 'viewer-login:' + Date.now();
    const begun = JSON.parse(await evaluate(`(() => { const log = globalThis.__houseatlasReadLog; return JSON.stringify(log && typeof log.begin === 'function' ? log.begin(${JSON.stringify(token)}) : null); })()`));
    assert(begun && typeof begun.document === 'string' && begun.phase === token, 'Page read observer installed before viewer login');
    viewerRead.document = begun.document; viewerRead.phase = token;
  };
  const settleViewerReads = async (current = false) => {
    const rows = () => [...nativeReads.values()].filter(read => read.phase === 'viewer-login');
    const describe = () => JSON.stringify({ total: rows().length, reads: rows().slice(0, 32)
      .map(({ commandId, requestId, status, finished, failed, canceled, authorizedBeforeCancellation, bodyBytes, errorText, diagnostic }) =>
        ({ commandId, requestId, status, finished, failed, canceled, authorizedBeforeCancellation, bodyBytes, errorText, diagnostic })) });
    let snap = null, verdict = { ok: false, fatal: false, reason: 'not evaluated' }, last = null;
    try {
      // Settled only when two consecutive same-document snapshots agree on an accepted
      // verdict. `current` requires the latest read of each command and the ready status.
      await until(async () => {
        snap = JSON.parse(await evaluate(`(() => { const log = globalThis.__houseatlasReadLog; return JSON.stringify(log && typeof log.snapshot === 'function' ? { ...log.snapshot(), ready: Boolean(${viewerReadyExpression}) } : null); })()`));
        verdict = judgeViewerReads(rows(), snap, viewerRead, current);
        if (verdict.fatal) throw new Error('Viewer read oracle rejected');
        const signature = verdict.ok ? JSON.stringify([snap.document, snap.phase, snap.entries.map(entry => [entry.requestId, entry.status, entry.bytes, entry.done]),
          rows().map(read => [read.requestId, read.finished, read.failed, read.bodyBytes])]) : null;
        const stable = signature !== null && signature === last; last = signature; return stable;
      }, 'Every viewer native read settled before session replacement');
    } catch (error) {
      throw new Error(error.message + ': ' + verdict.reason + ': ' + describe() + ' page=' + JSON.stringify(snap).slice(0, 6000));
    }
    // An old body may be canceled only AFTER its actual authorized200 headers.
    // That settles traffic; it does not count as successfully read content.
    assert(rows().every(read => read.status === 200 && (!read.failed
      || (read.canceled && read.authorizedBeforeCancellation))), 'Viewer native response or terminal failure: ' + describe());
    const counts = new Map();
    for (const read of rows()) counts.set(read.commandId, (counts.get(read.commandId) ?? 0) + 1);
    assert.deepEqual([...counts.keys()].sort(), ['atlas.binding.list', 'atlas.identity.list', 'atlas.location-semantics.list', 'atlas.relation.list']);
    assert([...counts.values()].every(count => count === counts.get('atlas.identity.list')), 'Observed viewer topology command counts remain balanced');
    const settled = judgeViewerReads(rows(), snap, viewerRead, current);
    assert(settled.ok, 'Each topology command has a successfully consumed read: ' + settled.reason + ': ' + describe());
  };
  // Open the retained native Atlas surface through Lantern's visible controls.
  const openAtlasTools = async () => {
    await until(async () => await evaluate(`(() => {
      const button = [...document.querySelectorAll('nav[aria-label="Sections"] button')]
        .find(button => button.textContent?.trim() === 'Changes' && button.getClientRects().length);
      if (!button) return false;
      button.click();
      return true;
    })()`), 'Visible Changes navigation');
    await until(async () => await evaluate("document.querySelector('main#main h1')?.textContent === 'Changes'"), 'Changes view');
    await until(async () => await evaluate(`(() => {
      const button = [...document.querySelectorAll('main#main button')]
        .find(button => button.textContent?.trim() === 'Atlas tools' && button.getClientRects().length);
      if (!button) return false;
      button.click();
      return true;
    })()`), 'Visible Atlas tools action');
    await until(async () => await evaluate("Boolean(document.querySelector('[role=dialog][aria-modal=true][aria-label=\"Atlas tools\"]:not([hidden])'))"), 'Visible Atlas tools dialog');
  };
  await send('Page.navigate', { url: origin });
  await openAtlasTools();
  try {
    await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'React authorized home rendering');
  } catch (error) {
    console.error(JSON.stringify({healthyBootstrapResponses: responses, runtimeErrors, renderedText: await evaluate('document.body?.innerText ?? ""'), healthyView: await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))")}));
    throw error;
  }
  const api = await evaluate("(async () => { const results=[]; for (const path of ['/api/atlas/view','/api/atlas/rooms','/api/atlas/items','/api/atlas/homes','/api/atlas/auth/session']) { const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error'}); results.push({path,status:response.status,cache:response.headers.get('cache-control'),pragma:response.headers.get('pragma'),nosniff:response.headers.get('x-content-type-options'),referrer:response.headers.get('referrer-policy'),vary:response.headers.get('vary'),body:await response.json()}); } return results; })()");
  assert(api.every(r => r.status === 200 && r.cache === 'private, no-store' && r.pragma === 'no-cache' && r.nosniff === 'nosniff' && r.referrer === 'same-origin' && r.vary === 'Cookie, Origin, Sec-Fetch-Site'), 'Actual authorized API GETs');
  const view = api[0].body;
  assert.equal(view.status, 'ready'); assert.equal(view.entries.length, 2); assert.equal(view.canEdit, false);
  assert.equal(api[1].body.length, 1); assert.equal(api[2].body.length, 1);
  assert.equal(api[3].body.length, 1); assert.equal(Object.keys(api[3].body[0]).length, 3);
  assert.equal(api[4].body.schemaVersion, 1); assert.equal(typeof api[4].body.expiresAt, 'string');
  const room = view.entries.find(e => e.semanticKind === 'room'), item = view.entries.find(e => e.kind === 'item');
  assert(room && item, 'Explicit reviewed room and actual saved item');
  assert.deepEqual(api[1].body, [room], 'Authorized rooms use the same browser entry projection');
  assert.deepEqual(api[2].body, [item], 'Authorized items use the same browser entry projection');
  assert.equal(item.entity.parent, null); assert.equal(item.mobility, 'unknown');
  assert(view.entries.every(e => e.nativeLinks.length === 0 && e.networkRelations.length === 0), 'No unissued capabilities');
  assert(item.attachments.filter(a => a.kind === 'stored-file').every(a => a.downloadHref === null && a.previewHref === null));
  // Lantern uses its visible navigation state; the retained Atlas hash route
  // remains separately exercised below.
  await until(async () => await evaluate(`(() => {
    const panel = document.querySelector('[role=dialog][aria-modal=true][aria-label="Atlas tools"]:not([hidden])');
    const button = [...(panel?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.trim() === 'Close Atlas tools' && button.getClientRects().length);
    if (!button) return false;
    button.click();
    return true;
  })()`), 'Visible Close Atlas tools action');
  await until(async () => await evaluate("!document.querySelector('[aria-label=\"Atlas tools\"]:not([hidden])')"), 'Atlas tools closed before section navigation');
  const topologyResponseStart = nativeListResponses.length;
  await until(async () => await evaluate(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="Sections"] button')]
      .find(button => button.textContent?.trim() === 'Atlas' && button.getClientRects().length);
    if (!button) return false;
    button.click();
    return true;
  })()`), 'Visible Atlas navigation');
  // With no house model the Atlas is a document over the building sections; a
  // lens replaces it and ends its reads. Atlas entry reads the topology once, and
  // Rooms & places reads it once more for its own lifetime.
  await until(async () => await evaluate("document.querySelector('.topology-scope [role=status]')?.textContent === 'No reviewed buildings in this home.'"), 'Atlas topology ready');
  await until(async () => nativeListResponses.length - topologyResponseStart >= 4, 'Atlas topology reads completed');
  const atlasReads = nativeListResponses.slice(topologyResponseStart).map(({ path, status, snapshot }) => ({ path, status, snapshot }));
  assert.equal(atlasReads.length, 4, 'Four completed actual native topology list reads on Atlas entry');
  const placesResponseStart = nativeListResponses.length;
  await until(async () => await evaluate(`(() => {
    const button = [...document.querySelectorAll('[aria-label="Atlas lens"] button')]
      .find(button => button.textContent?.trim() === 'Rooms & places' && button.getClientRects().length);
    if (!button) return false;
    button.click();
    return true;
  })()`), 'Visible Atlas Rooms & places lens');
  await until(async () => await evaluate("document.querySelector('.atlas-lens.is-places h2')?.textContent === 'Rooms & places'"), 'Lantern Rooms & places view');
  try {
    await until(async () => await evaluate("document.querySelector('.atlas-lens.is-places .topology-scope [role=status]')?.textContent === 'No reviewed buildings in this home.'"), 'Actual foreground Places topology frame after matched snapshot reads');
  } catch (error) {
    const lists = [];
    for (const response of nativeListResponses) {
      let outcome;
      try {
        const body = JSON.parse((await send('Network.getResponseBody', { requestId: response.id })).body);
        outcome = { commandId: body.commandId, status: body.status, errorCode: body.error?.code,
          recordCount: Array.isArray(body.data?.records) ? body.data.records.length : null, sourceStatus: body.data?.sourceStatus };
      } catch { outcome = { bodyUnavailable: true }; }
      lists.push({ path: response.path, status: response.status, snapshot: response.snapshot, outcome });
    }
    console.error(JSON.stringify({ topologyStatus: await evaluate("document.querySelector('.topology-scope [role=status]')?.textContent ?? null"), lists }));
    throw error;
  }
  const placesReads = nativeListResponses.slice(placesResponseStart).map(({ path, status, snapshot }) => ({ path, status, snapshot }));
  assert.equal(placesReads.length, 4, 'Four completed actual native topology list reads for Rooms & places');
  const topologyReads = [...atlasReads, ...placesReads];
  assert(topologyReads.every(read => read.status === 200 && /^[0-9a-f]{64}$/.test(read.snapshot ?? '')
    && read.snapshot === topologyReads[0].snapshot), 'Actual native topology reads carry one matched retained snapshot identity');
  await openAtlasTools();
  await evaluate("location.hash='#places'");
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes(room.entity.name), 'React Rooms & places');
  await evaluate('location.hash=' + JSON.stringify('#place?key=' + encodeURIComponent(room.key)));
  await until(async () => (await evaluate('document.querySelector(".record-head")?.innerText ?? ""')).includes(room.entity.name), 'React room detail');
  await evaluate('location.hash=' + JSON.stringify('#item?key=' + encodeURIComponent(item.key)));
  await until(async () => (await evaluate('document.querySelector(".record-head")?.innerText ?? ""')).includes(item.entity.name), 'React item detail');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (process.env.HOUSEATLAS_SCREENSHOT) writeFileSync(process.env.HOUSEATLAS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  const scoped = '/api/atlas/homes/' + view.scope.workspaceId + '/' + view.scope.homeId + '/view';
  const result = await evaluate('fetch(' + JSON.stringify(scoped) + ",{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(result.status, 200); assert.deepEqual(result.body.scope, view.scope);
  assert.equal(runtimeErrors.length, 0, 'No browser runtime exceptions in healthy flow');
  assert(observedUrls.every(url => url.startsWith(origin + '/')), 'Observed page requests stay on loopback');
  assert(responses.every(r => r.status === 200 || (r.status === 204 && r.url === origin + '/favicon.ico')), 'Observed healthy page responses');
  const prefix = '/api/atlas/v1/workspaces/' + view.scope.workspaceId + '/homes/' + view.scope.homeId;
  const coreReads = await evaluate(`(async () => {
    const prefix=${JSON.stringify(prefix)}, results=[];
    const read=async path=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error'}); const body=await r.json(); results.push({path,status:r.status}); if(r.status!==200) throw new Error('Ordinary core read failed'); return body;};
    const pages=async collection=>{const items=[]; let cursor=null; do {const page=await read(prefix+'/'+collection+'?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):'')); if(page.contractVersion!=='1.0.0'||!Array.isArray(page.sourceStatuses))throw new Error('Page shape'); items.push(...page.items);cursor=page.nextCursor;}while(cursor);return items;};
    const records=await pages('records'), entities=await pages('homebox/entities'), network=await pages('network/relations');
    const first=records[0], path=prefix+'/records/'+first.recordType+'/'+first.recordId;
    const record=await read(path), history=await read(path+'/history'), current=await read(prefix+'/view');
    return {results,recordCount:records.length,uniqueRecords:new Set(records.map(r=>r.recordId)).size,entityCount:entities.length,networkCount:network.length,recordMatches:JSON.stringify(record)===JSON.stringify(first),historyCount:history.length,viewReady:current.status==='ready'};
  })()`);
  assert.equal(coreReads.recordCount,6); assert.equal(coreReads.uniqueRecords,6);
  assert.equal(coreReads.entityCount,2); assert.equal(coreReads.networkCount,0);
  assert.equal(coreReads.recordMatches,true); assert.equal(coreReads.historyCount,0); assert.equal(coreReads.viewReady,true);
  await evaluate("location.hash='#settings'");
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Sign out'), 'Actual session Settings');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()");
  await until(async () => await evaluate("Boolean(document.querySelector('section[role=dialog][aria-modal=true][aria-labelledby=capture-logout-heading]')?.getClientRects().length)"), 'Ordinary logout confirmation dialog');
  assert.equal(await evaluate("document.querySelector('section[aria-labelledby=capture-logout-heading] input[type=checkbox]')?.checked"), false, 'Ordinary logout keeps local captures by default');
  await evaluate("[...document.querySelectorAll('section[aria-labelledby=capture-logout-heading] button')].find(b=>b.textContent==='Keep local captures and sign out'&&!b.disabled).click()");
  await until(async () => await evaluate("Boolean(document.getElementById('atlas-username'))"), 'Ordinary successful logout form');
  assert.equal(await evaluate('document.activeElement?.id'), 'atlas-username');
  // The component stays mounted while signed out. No unauthenticated session
  // request or rejected request is made between successful logout and login.
  await beginViewerReadPhase();
  phase = 'viewer-login';
  await evaluate(`document.getElementById('atlas-username').value=${JSON.stringify(login.username)}; document.getElementById('atlas-password').value=${JSON.stringify(login.password)}; document.querySelector('.session-form').requestSubmit()`);
  assert.equal(await evaluate("document.getElementById('atlas-password')?.value ?? ''"), '');
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'Actual successful HTTP login and React home');
  await until(async () => await evaluate("document.querySelector('.atlas-section .topology-scope [role=status]')?.textContent === 'No reviewed buildings in this home.'"), 'Viewer topology ready before session replacement');
  await settleViewerReads(true);
  await openAtlasTools();
  await settleViewerReads();
  const refreshedCookies = await send('Network.getCookies', {urls:[origin]});
  const actualSessionCookie = refreshedCookies.cookies.find(c=>c.name===cookie.slice(0,split));
  assert(actualSessionCookie?.secure && actualSessionCookie.httpOnly && actualSessionCookie.sameSite==='Strict', 'Actual login issues protected browser cookie');
  const authResponses = responses.filter(r=>r.url.startsWith(origin+'/api/atlas/auth/'));
  assert(authResponses.some(r=>r.url===origin+'/api/atlas/auth/login' && r.status===200));
  assert(authResponses.some(r=>r.url===origin+'/api/atlas/auth/logout' && r.status===200));
  // Fresh local-only commands, each submitted once. The browser's real editor
  // login replaces its viewer session; every write carries freshly issued CSRF.
  // This is not a provider operation, replay, stale guard or rejected request.
  phase = 'editor-writes';
  const writes = await evaluate(`(async () => {
    const prefix=${JSON.stringify(prefix)}, login=${JSON.stringify(editorLogin)}, results=[];
    const request=async(path,body,csrf)=>{const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'content-type':'application/json',...(csrf?{'x-atlas-csrf':csrf}:{})}:{},...(body?{body:JSON.stringify(body)}:{})}); const value=await response.json(); results.push({path,status:response.status});if(response.status!==200)throw new Error('Ordinary fresh local write/read failed');return value;};
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const session=await request('/api/atlas/auth/login',login);
    if(session.actorId!==U(7))throw new Error('Actual editor actor');
    const fresh=await request('/api/atlas/auth/session');
    const guard={record:{recordType:'evidence',recordId:U(100)},expectedRevision:1};
    const command=(id,type,payload)=>({schemaVersion:1,mutationId:U(id),operation:'create',expectedRevision:null,reason:'Healthy disposable native integration',guards:[guard],value:{recordType:type,payload}});
    const circuitPath=prefix+'/records/circuit/'+U(900);
    const created=await request(circuitPath+'/mutations',command(1000,'circuit',{label:'Synthetic native circuit',panel:null,evidenceIds:[U(100)]}),fresh.csrfToken);
    const record=await request(circuitPath), history=await request(circuitPath+'/history');
    const same=JSON.stringify(record)===JSON.stringify(created.record);
    const next=await request('/api/atlas/auth/session');
    const entries=[{target:{recordType:'identity',recordId:U(901)},command:command(1001,'identity',{kind:'item',evidenceIds:[U(100)]})},{target:{recordType:'identity',recordId:U(902)},command:command(1002,'identity',{kind:'location',evidenceIds:[U(100)]})}];
    const batch=await request(prefix+'/mutations',{schemaVersion:1,batchId:U(1100),reason:'Healthy disposable native identity batch',commands:entries},next.csrfToken);
    const batchRecords=[],batchHistories=[];
    for(const entry of entries){const path=prefix+'/records/'+entry.target.recordType+'/'+entry.target.recordId;batchRecords.push(await request(path));batchHistories.push(await request(path+'/history'));}
    return {results,actorId:session.actorId,single:{revision:created.record.revision,replayed:created.replayed,recordMatches:same,historyCount:history.length,auditActor:history[0]?.actorId,historyRevision:history[0]?.resultRevision},batch:{count:batch.results.length,replayed:batch.replayed,revisions:batch.results.map(r=>r.record.revision),recordsMatch:JSON.stringify(batchRecords)===JSON.stringify(batch.results.map(r=>r.record)),historyCounts:batchHistories.map(h=>h.length),auditActors:batchHistories.flatMap(h=>h.map(a=>a.actorId))}};
  })()`);
  assert.deepEqual(writes.single,{revision:1,replayed:false,recordMatches:true,historyCount:1,auditActor:'00000000-0000-4000-8000-000000000007',historyRevision:1});
  assert.deepEqual(writes.batch,{count:2,replayed:false,revisions:[1,1],recordsMatch:true,historyCounts:[1,1],auditActors:[writes.actorId,writes.actorId]});
  assert(observedUrls.every(url=>url.startsWith(origin+'/')), 'All auth, reads and fresh commands stay on loopback');
  assert(responses.every(r=>r.status===200 || (r.status===204 && r.url===origin+'/favicon.ico')), 'All observed core flows remain successful ordinary responses: ' + JSON.stringify(responses.filter(r=>!(r.status===200 || (r.status===204 && r.url===origin+'/favicon.ico'))).map(r=>({path:new URL(r.url).pathname,status:r.status,requestPhase:r.requestPhase,responsePhase:r.responsePhase,commandId:new URL(r.url).pathname.endsWith('/invoke')?JSON.parse(new URL(r.url).searchParams.get('request')).commandId:null}))));
  assert.equal(runtimeErrors.length,0);
  const sql = [
    'import sqlite3,json,sys', 'from pathlib import Path', 'root=Path(sys.argv[1])',
    'def count(db,table):',
    " c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)",
    " try: return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]",
    ' finally: c.close()',
    "print(json.dumps({'records':count(root/'atlas.sqlite','records'),'projections':count(root/'atlas.sqlite','projections'),'audits':count(root/'atlas.sqlite','audits'),'receipts':count(root/'atlas.sqlite','receipts'),'batchReceipts':count(root/'atlas.sqlite','batch_receipts'),'sessions':count(root/'access.sqlite','access_sessions')}))"
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, data], { encoding: 'utf8' });
  assert.equal(rows.status, 0); assert.deepEqual(JSON.parse(rows.stdout), {records:9,projections:2,audits:3,receipts:3,batchReceipts:1,sessions:1});
  const evidence = { rust:serviceOutput.trim(), browser:version.product, apiReads:api.map(({path,status})=>({path,status})), coreReads, writes, authResponses:responses.filter(r=>r.url.startsWith(origin+'/api/atlas/auth/')).map(r=>({path:new URL(r.url).pathname,status:r.status})), scopedRead:result.status, topologyReads, rooms:1, items:1, persisted:JSON.parse(rows.stdout), observedRequests:observedUrls.length, scope:'Actual native schema/graph/JCS, Rust/SQLite/access/domain/React positive loopback TLS session/login/logout, canonical paged reads, fresh circuit create and atomic local identity batch. No rejected request, stopped control or external provider.' };
  if (process.env.HOUSEATLAS_EVIDENCE) writeFileSync(process.env.HOUSEATLAS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    if (cdp && browser?.exitCode === null) await cdp.send('Browser.close').catch(() => {});
    if (browser?.exitCode === null) await until(() => browser.exitCode !== null, 'ordinary Chromium shutdown', 10000);
  } finally {
    try {
      if (service?.exitCode === null) {
        service.kill('SIGINT');
        await until(() => service.exitCode !== null, 'graceful Rust shutdown', 10000);
        assert.equal(service.exitCode, 0, 'Graceful ordinary shutdown');
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
