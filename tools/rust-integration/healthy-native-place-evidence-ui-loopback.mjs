// One ordinary successful source-free React/native PDF evidence flow.
// Root must review the full source and exact private artifact packet, register
// the named command, and release execution. The author has not run this helper.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0', 'Pinned Node runtime');
assert.equal(process.platform, 'darwin', 'Explicit local Mac positive');
assert.equal(process.argv.length, 3, 'Exactly one private Root artifact packet');
const SHA = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const origin = 'https://127.0.0.1:48743', maximumBody = 1024 * 1024;
const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { workspaceId: U(2), homeId: U(3) }, actorId = U(5);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function selected(path, maximum, privateFile = false, systemFile = false) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path);
  assert.equal(realpathSync(path), path, 'Canonical selected regular file');
  const before = lstatSync(path);
  assert(before.isFile() && before.nlink === 1 && before.size <= maximum);
  assert(before.uid === process.getuid() || systemFile && before.uid === 0);
  assert.equal(before.mode & 0o022, 0, 'Selected file is not group/world writable');
  if (privateFile) assert.equal(before.mode & 0o777, 0o600);
  const bytes = readFileSync(path), after = lstatSync(path);
  assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(bytes.length, before.size); return bytes;
}
const packetBytes = selected(process.argv[2], 256 * 1024, true), selection = JSON.parse(packetBytes);
assert.equal(selection.format, 'houseatlas-native-place-evidence-ui-artifacts/1');
const runnerSha256 = sha(selected(fileURLToPath(import.meta.url), 128 * 1024));
assert.equal(selection.runnerSha256, runnerSha256, 'Root selected the exact reviewed helper');
const binary = selection.binary, frontend = selection.frontend, chromium = selection.chromium, openssl = selection.openssl;
assert.match(binary.sha256, SHA); assert.match(binary.sourceCommit, COMMIT); assert.match(binary.sourceTree, COMMIT);
assert.match(binary.buildRecord.sha256, SHA);
const buildBytes = selected(binary.buildRecord.path, 1024 * 1024, true);
assert.equal(sha(buildBytes), binary.buildRecord.sha256);
const build = JSON.parse(buildBytes);
assert.equal(build.sourceCommit, binary.sourceCommit); assert.equal(build.sourceTree, binary.sourceTree);
assert.equal(build.binaryPath, binary.path); assert.equal(build.binarySha256, binary.sha256);
assert.equal(build.bytes, binary.bytes); assert.equal(build.buildCheck.exit, 0, 'Actual compiled artifact receipt');
assert.equal(sha(selected(binary.path, 512 * 1024 * 1024)), binary.sha256);
assert.equal(lstatSync(binary.path).size, binary.bytes);
function enumerate(directory, prefix = '', depth = 0, state = { entries: 0, files: 0 }) {
  assert(depth <= 16, 'Bounded selected frontend directory depth');
  const metadata = lstatSync(directory);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink() && metadata.uid === process.getuid());
  assert.equal(metadata.mode & 0o022, 0);
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(++state.entries <= 256); assert(!entry.isSymbolicLink());
    const name = prefix + entry.name;
    if (entry.isDirectory()) return enumerate(join(directory, entry.name), name + '/', depth + 1, state);
    assert(entry.isFile() && ++state.files <= 128); return [name];
  }).sort();
}
assert.match(frontend.sourceCommit, COMMIT); assert.match(frontend.sourceTree, COMMIT);
assert.equal(frontend.sourceCommit, binary.sourceCommit); assert.equal(frontend.sourceTree, binary.sourceTree);
assert.match(frontend.buildRecord.sha256, SHA);
assert.equal(sha(selected(frontend.buildRecord.path, 1024 * 1024, true)), frontend.buildRecord.sha256);
// Root independently reviews the actual frontend build receipt or exact unchanged
// compile-input reuse proof. This helper measures the complete selected output.
assert(isAbsolute(frontend.directory) && realpathSync(frontend.directory) === frontend.directory);
assert(Array.isArray(frontend.files) && frontend.files.length > 0 && frontend.files.length <= 128);
assert.deepEqual(enumerate(frontend.directory), frontend.files.map(file => file.path).sort());
let frontendBytes = 0;
for (const file of frontend.files) {
  assert(typeof file.path === 'string' && !isAbsolute(file.path) && !file.path.split('/').some(p => !p || p === '.' || p === '..'));
  assert.match(file.sha256, SHA);
  const bytes = selected(join(frontend.directory, file.path), 4_000_000);
  assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256); frontendBytes += bytes.length;
}
assert(frontendBytes <= 64 * 1024 * 1024); assert(frontend.files.some(file => file.path === 'index.html'));
assert.equal(chromium.version, 'Chrome/154.0.8037.98'); assert.match(chromium.sha256, SHA);
assert.equal(sha(selected(chromium.path, 512 * 1024 * 1024, false, true)), chromium.sha256);
assert.match(openssl.sha256, SHA);
assert.equal(sha(selected(openssl.path, 32 * 1024 * 1024, false, true)), openssl.sha256);
const output = selection.evidenceDirectory;
assert(isAbsolute(output) && realpathSync(output) === output);
const outputMeta = lstatSync(output);
assert(outputMeta.isDirectory() && outputMeta.uid === process.getuid() && (outputMeta.mode & 0o777) === 0o700);
for (const file of ['result.json', ...['selected-document', 'saved-native-evidence'].flatMap(label => [1440, 390].map(width => `${label}-${width}.png`))])
  assert(!existsSync(join(output, file)), 'Never overwrite prior UI evidence');
const artifacts = { runnerSha256, selectionSha256: sha(packetBytes), binary, frontend, chromium, openssl,
  qualification: 'Exact measured compiled files and complete dist; source/build provenance requires the separately reviewed Root packet.' };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'houseatlas-native-evidence-ui-'))); chmodSync(scratch, 0o700);
const data = join(scratch, 'data'), configPath = join(scratch, 'server.json'), cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const began = Date.now(), hardLimitMs = 300000, workLimitMs = hardLimitMs - 60000;
const delay = ms => new Promise(yes => setTimeout(yes, ms));
const owned = [], requests = [], responses = [], completed = new Set(), failedLoads = new Set(), captures = [], inputEvidence = [], readProofs = [];
let browser, service, cdp, sessionId, phase = 'preparation', eventFailure = null, timedOut = false, cleanupDeadline = Infinity;
const startup = { stdout: [], stderr: [], observed: 0, retained: 0 }, startupLimit = 8192;
const publicStartupLines = new Set([
  'HouseAtlas persistent server listening on 127.0.0.1:48743 for https://127.0.0.1:48743',
  'HomeBox, Network and AI providers unconfigured; historical Media admission unavailable',
  'Error: "Expected one React root"', 'Error: "Missing compiled React application"',
]);
function safeCode(error) { return ['ERR_ASSERTION', 'ENOENT', 'EACCES', 'EPIPE', 'ESRCH', 'EPERM', 'EADDRINUSE'].includes(error?.code) ? error.code : null; }
function live() { assert(!timedOut && !eventFailure && Date.now() - began < workLimitMs, 'Bounded successful UI work'); }
function stopped(handle) { return !handle || handle.failedToStart || handle.exitCode !== null || handle.signalCode !== null; }
function groupGone(handle) {
  if (handle?.groupAbsenceObserved === true) return true;
  if (!handle?.pid) return handle?.failedToStart === true;
  try { process.kill(-handle.pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') { handle.groupAbsenceObserved = true; return true; } handle.groupProbeFailed = true; handle.groupProbeCode = safeCode(error); eventFailure = 'owned-group-probe'; return false; }
}
function released(handle) { return stopped(handle) && handle.stdioClosed === true && groupGone(handle); }
function signalOwnedGroup(handle, signal) {
  if (!handle?.pid || groupGone(handle)) return;
  // Detached spawn makes this newly owned child's PID its process-group ID.
  // No descriptor/environment PID, pre-existing browser or other group is used.
  try { process.kill(-handle.pid, signal); }
  catch (error) { if (error.code === 'ESRCH') handle.groupAbsenceObserved = true; else throw error; }
}
function child(label, path, args, stdio = ['ignore', 'pipe', 'pipe']) {
  live(); const handle = spawn(path, args, { cwd: scratch, detached: true, stdio });
  handle.label = label; handle.stdioClosed = false; handle.pipeError = false; owned.push(handle);
  handle.on('error', error => { handle.failedToStart = true; handle.spawnCode = safeCode(error); eventFailure = 'owned-process-start'; });
  handle.once('close', () => { handle.stdioClosed = true; });
  for (const stream of handle.stdio) if (stream) stream.on('error', () => { handle.pipeError = true; eventFailure = 'owned-pipe'; cdp?.rejectPending(); });
  handle.stdout?.resume(); handle.stderr?.resume(); return handle;
}
async function until(check, label, milliseconds = 30000, cleanup = false) {
  const end = Math.min(Date.now() + milliseconds, cleanup ? cleanupDeadline : began + workLimitMs);
  while (Date.now() < end) {
    if (!cleanup) live(); const value = await check(); if (value) return value; await delay(25);
  }
  throw new Error('Bounded phase: ' + label);
}
async function stopOwned(handle, graceful = false) {
  if (!handle) return;
  let forced = false;
  if (!released(handle)) {
    signalOwnedGroup(handle, 'SIGTERM');
    try { await until(() => released(handle), 'owned group and stdio close', 12000, true); }
    catch { forced = true; signalOwnedGroup(handle, 'SIGKILL'); await until(() => released(handle), 'owned forced group close', 3000, true); }
  }
  assert(stopped(handle)); assert.equal(handle.stdioClosed, true); assert(groupGone(handle));
  if (graceful) { assert.equal(forced, false); assert.equal(handle.exitCode, 0, 'Native graceful lease release'); }
}
function captureStartup(stream, bytes) {
  if (phase !== 'server-starting') return;
  startup.observed += bytes.length; const count = Math.min(bytes.length, startupLimit - startup.retained);
  if (count > 0) { startup[stream].push(Buffer.from(bytes.subarray(0, count))); startup.retained += count; }
}
function publicStartup() {
  return { maximumCombinedBytes: startupLimit, capturedCombinedBytes: startup.retained, truncated: startup.observed > startup.retained,
    streams: Object.fromEntries(['stdout', 'stderr'].map(name => {
      const bytes = Buffer.concat(startup[name]), lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
      return [name, { capturedPrefixSha256: sha(bytes), publicText: lines.filter(line => publicStartupLines.has(line)).join('\n'),
        withheldLines: lines.filter(line => !publicStartupLines.has(line)).length }];
    })) };
}
async function unusedPort() {
  live(); const probe = createServer();
  try { await new Promise((yes, no) => { probe.once('error', no); probe.listen({ host: '127.0.0.1', port: 48743, exclusive: true }, yes); }); }
  finally { if (probe.listening) await new Promise((yes, no) => probe.close(error => error ? no(error) : yes())); }
}
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0);
  constructor(handle) {
    this.handle = handle;
    handle.stdio[4].on('data', bytes => {
      if (bytes.length > 8 * 1024 * 1024 - this.buffer.length) { eventFailure = 'cdp-byte-limit'; this.rejectPending(); return; }
      this.buffer = Buffer.concat([this.buffer, bytes]); let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1); if (!raw.length) continue;
        try {
          const message = JSON.parse(raw.toString('utf8'));
          if (message.id) {
            const pending = this.pending.get(message.id); if (!pending) continue;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            message.error ? pending.no(new Error('CDP command did not succeed')) : pending.yes(message.result);
          } else this.event(message);
        } catch { eventFailure = 'cdp-decode'; this.rejectPending(); }
      }
    });
    handle.on('exit', () => this.rejectPending()); handle.on('close', () => this.rejectPending());
  }
  rejectPending() { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.no(new Error('Owned CDP ended')); } this.pending.clear(); }
  event(message) {
    const params = message.params;
    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request, url = new URL(request.url);
      if (url.origin !== origin || url.username || url.password) {
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) { eventFailure = 'application-origin'; this.rejectPending(); }
        return;
      }
      const item = { id: params.requestId, phase, path: url.pathname, method: request.method };
      // Retain only synthetic creation/read descriptors. Never multipart,
      // auth bodies, headers, cookies, CSRF or browser evaluation payloads.
      if (url.pathname === stock() + '/commands') { assert(request.postData); item.command = JSON.parse(request.postData); }
      else if (url.pathname === stock() + '/invoke') item.command = JSON.parse(url.searchParams.get('request'));
      requests.push(item); assert(requests.length <= 500);
    } else if (message.method === 'Network.responseReceived') {
      const response = params.response, url = new URL(response.url); if (url.origin !== origin) return;
      responses.push({ id: params.requestId, phase, path: url.pathname, status: response.status }); assert(responses.length <= 500);
    } else if (message.method === 'Network.loadingFinished') { completed.add(params.requestId); assert(completed.size <= 500); }
    else if (message.method === 'Network.loadingFailed') { failedLoads.add(params.requestId); assert(failedLoads.size <= 500); }
    else if (message.method === 'Runtime.exceptionThrown') eventFailure = 'application-runtime';
  }
  send(method, params = {}, attached = sessionId, timeout = 15000) {
    const id = ++this.next;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => { this.pending.delete(id); no(new Error('Bounded CDP deadline')); }, timeout);
      this.pending.set(id, { yes, no, timer });
      try { this.handle.stdio[3].write(JSON.stringify({ id, method, params, ...(attached ? { sessionId: attached } : {}) }) + '\0'); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); no(error); }
    });
  }
}
const send = (method, params, timeout) => cdp.send(method, params, sessionId, timeout);
async function evaluate(expression, timeout = 15000) {
  live(); const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
  assert(!reply.exceptionDetails, 'Successful bounded browser evaluation'); return reply.result.value;
}
async function click(selector, label) {
  await until(async () => evaluate(`(() => {const el=${selector};if(!el||!el.getClientRects().length||el.disabled)return false;el.scrollIntoView({block:'center',behavior:'instant'});return true;})()`), label);
  await evaluate('new Promise(yes=>requestAnimationFrame(()=>requestAnimationFrame(yes)))');
  const point = await evaluate(`(() => {const el=${selector},r=el.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(p.x,p.y);return {point:p,hit:hit===el||el.contains(hit)};})()`);
  assert.equal(point.hit, true); inputEvidence.push({ phase, action: label, point: point.point }); assert(inputEvidence.length <= 40);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, ...point.point, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
}
async function enter(selector, value, label) {
  await click(selector, label);
  // Explicit Mac select-all commands replace the initial input value.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
  await send('Input.insertText', { text: value }); assert.equal(await evaluate(`(${selector}).value`), value);
}
async function option(selector, value) {
  await click(selector, 'Select offered license');
  assert.equal(await evaluate(`(() => {const el=${selector},option=Array.from(el.options).find(o=>o.value===${JSON.stringify(value)});if(!option||option.disabled)return false;el.value=option.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value===option.value;})()`), true);
}
const byText = (container, text, tag = 'button') => `Array.from((${container})?.querySelectorAll(${JSON.stringify(tag)}) ?? []).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
const stock = () => `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
const row = id => `Array.from(document.querySelectorAll('.topology-scope li.ledger-row')).find(el=>el.querySelector('.ledger-name')?.title===${JSON.stringify(id)})`;
async function terminal(response, label) {
  await until(() => { assert(!failedLoads.has(response.id), 'Required native transport completed successfully'); return completed.has(response.id); }, label);
}
async function responseBody(response, allowedPaths) {
  assert(allowedPaths.includes(response.path), 'Only explicitly selected non-auth native bodies');
  await terminal(response, 'Native body complete');
  const raw = await send('Network.getResponseBody', { requestId: response.id });
  const bytes = raw.base64Encoded ? Buffer.from(raw.body, 'base64') : Buffer.from(raw.body);
  assert(bytes.length <= maximumBody); return JSON.parse(bytes.toString('utf8'));
}
function correlated(wire, requestId, status, commandId = 'atlas.batch.execute') {
  assert.equal(wire.schemaVersion, 3); assert.equal(wire.commandId, commandId);
  assert.equal(wire.requestId, requestId); assert.deepEqual(wire.resolvedScope, scope); assert.equal(wire.status, status); assert.equal(wire.replayed, false);
}
async function read(kind, verb, recordId = null, payload = {}) {
  const request = { schemaVersion: 3, commandId: `atlas.${kind}.${verb}`, requestId: randomUUID(), context: scope,
    target: { authority: 'atlas', recordType: kind, ...(recordId ? { recordId } : {}) }, payload };
  const path = stock() + '/invoke?request=' + encodeURIComponent(JSON.stringify(request));
  const result = await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(path)},{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});const reader=r.body.getReader(),bytes=new Uint8Array(${maximumBody});let size=0;try{for(;;){const part=await reader.read();if(part.done)break;if(part.value.length>bytes.length-size)throw new Error('Native read exceeds bound');bytes.set(part.value,size);size+=part.value.length;}return {status:r.status,wire:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)))};}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}})()`);
  assert.equal(result.status, 200); correlated(result.wire, request.requestId, 'read', request.commandId);
  const observed = await until(() => requests.find(item => item.command?.requestId === request.requestId), 'Correlated supplemental native request');
  assert.equal(observed.method, 'GET'); assert.equal(observed.path, stock() + '/invoke'); assert.deepEqual(observed.command, request);
  const response = await until(() => responses.find(item => item.id === observed.id), 'Supplemental native response'); assert.equal(response.status, 200);
  await terminal(response, 'Successful supplemental native terminal completion');
  readProofs.push({ request, responseId: response.id, terminal: 'loadingFinished', wire: result.wire }); assert(readProofs.length <= 25); return result.wire;
}
async function capture(label) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await until(async () => evaluate(`innerWidth===${width}`), 'Selected viewport');
    await evaluate('new Promise(yes=>requestAnimationFrame(()=>requestAnimationFrame(yes)))');
    const dom = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:document.querySelector("main#main")?.outerHTML})');
    assert(dom.scrollWidth <= width + 1); assert(typeof dom.main === 'string' && Buffer.byteLength(dom.main) <= 128 * 1024);
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    assert(image.data.length <= 8 * 1024 * 1024); const bytes = Buffer.from(image.data, 'base64'); assert(bytes.length <= 4 * 1024 * 1024);
    const path = join(output, `${label}-${width}.png`); writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
    captures.push({ label, width, height, path, sha256: sha(bytes), dom });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}
function pdfBytes() {
  // Valid generated one-page synthetic PDF with real object/xref offsets. No
  // household document or PDF safety/preview claim is embedded in this example.
  const stream = 'BT /F1 12 Tf 20 60 Td (Synthetic electricity document) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let text = '%PDF-1.7\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`; return Buffer.from(text);
}

let report = null, primaryFailure = null, failurePhase = null, cleanupFailure = null;
const budget = setTimeout(() => {
  timedOut = true; cdp?.rejectPending();
  for (const handle of owned) { try { signalOwnedGroup(handle, 'SIGTERM'); } catch { eventFailure = 'owned-budget-signal'; } }
}, workLimitMs);
try {
  await unusedPort();
  const opensslConfig = join(scratch, 'openssl.cnf');
  writeFileSync(opensslConfig, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\n', { mode: 0o600, flag: 'wx' });
  const certificate = child('openssl', openssl.path, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', opensslConfig]);
  await until(() => released(certificate), 'Synthetic certificate', 15000); assert.equal(certificate.exitCode, 0); chmodSync(cert, 0o600); chmodSync(key, 0o600);
  const config = { schemaVersion: 1, deploymentId: U(1), dataDirectory: data, logDirectory: join(data, 'logs'), frontendDirectory: frontend.directory,
    tlsCertificate: cert, tlsPrivateKey: key, listen: '127.0.0.1:48743', origin, homes: [{ ...scope, label: 'Synthetic home' }], mcpCommands: 'read-only',
    authentication: { mode: 'loopback-local', identity: { userId: U(4), actorId, username: 'synthetic-local', scope } } };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  const initialization = child('initialize', binary.path, ['initialize', '--server-config', configPath]);
  await until(() => released(initialization), 'Fresh native initialization', 30000); assert.equal(initialization.exitCode, 0);
  for (const marker of ['server-state.rebind.pending', 'server-state.receipt-compatibility.pending', 'server-state.receipt-compatibility.next'])
    assert(!existsSync(join(data, marker)), 'No incomplete native transition');
  phase = 'server-starting';
  service = child('serve', binary.path, ['serve', '--server-config', configPath]);
  service.stdout.on('data', bytes => captureStartup('stdout', bytes)); service.stderr.on('data', bytes => captureStartup('stderr', bytes));
  await until(() => { assert(!stopped(service)); return Buffer.concat(startup.stdout).toString('utf8').includes('HouseAtlas persistent server listening on 127.0.0.1:48743'); }, 'Actual native TLS listener', 30000);
  phase = 'browser-starting';
  browser = child('fresh-browser', chromium.path, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--disable-breakpad', '--disable-crash-reporter',
    '--no-proxy-server', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  cdp = new Pipe(browser); const version = await cdp.send('Browser.getVersion', {}, null); assert.equal(version.product, chromium.version);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Network.enable', { maxPostDataSize: 65536 }); await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  phase = 'native-sign-in';
  await send('Page.navigate', { url: origin }); await click(byText('document', 'Open Home'), 'Open Home');
  await until(async () => evaluate("document.querySelector('.house-name')?.textContent==='Synthetic home'"), 'Actual local Editor home');
  const signInRequests = requests.filter(item => item.path === '/api/atlas/auth/local' && item.method === 'POST'); assert.equal(signInRequests.length, 1);
  const signInResponse = await until(() => responses.find(item => item.id === signInRequests[0].id), 'Actual local sign-in response'); assert.equal(signInResponse.status, 200);
  await terminal(signInResponse, 'Successful local sign-in terminal completion');
  await click(byText('document.querySelector(\'nav[aria-label="Sections"]\')', 'Rooms & places'), 'Rooms & places');
  await until(async () => evaluate("document.querySelector('main#main h1')?.textContent==='Rooms & places' && document.querySelector('.topology-scope > p[role=status]')?.textContent==='No reviewed buildings in this home.'"), 'Fresh empty topology');
  const empty = { pageSize: 100, cursor: null, includeArchived: false };
  assert.deepEqual((await read('identity', 'list', null, empty)).data.records, []);
  assert.deepEqual((await read('binding', 'list', null, empty)).data.records, []);
  phase = 'create-one-building';
  const add = `document.querySelector('.topology-scope > section[aria-label="Add Atlas place"]')`;
  await click(byText("document.querySelector('.topology-scope')", 'Add Atlas place'), 'Add Atlas place');
  await until(async () => evaluate(`!!(${add})?.querySelector('form')`), 'Actual create form');
  await enter(`(${add}).querySelector('input[name="label"]')`, 'Main house', 'Atlas name');
  await enter(`(${add}).querySelector('textarea[name="statement"]')`, 'I report Main house as one synthetic native building; physical elevation and access are not supplied.', 'Naming statement');
  await enter(`(${add}).querySelector('input[name="reason"]')`, 'Create one synthetic building for the evidence UI positive.', 'Naming reason');
  assert.equal(await evaluate(`(${add}).querySelector('select[name="kind"]').value`), 'building');
  await click(byText(add, 'Create Atlas place'), 'Create Atlas place once');
  const creationRequest = await until(() => requests.find(item => item.path === stock() + '/commands'), 'Single actual creation POST');
  assert.equal(creationRequest.method, 'POST'); assert.equal(creationRequest.command.commandId, 'atlas.batch.execute');
  assert.deepEqual(creationRequest.command.context, scope); assert.equal(creationRequest.command.payload.commands.length, 3);
  const creationResponse = await until(() => responses.find(item => item.id === creationRequest.id), 'Creation response'); assert.equal(creationResponse.status, 200);
  const created = await responseBody(creationResponse, [stock() + '/commands']); correlated(created, creationRequest.command.requestId, 'committed');
  assert.match(created.operationId, UUID); assert.match(created.data.requestDigest, SHA); assert.equal(created.data.records.length, 3); assert.equal(created.data.auditIds.length, 3);
  assert.deepEqual(created.data.records.map(record => record.target.recordType).sort(), ['evidence', 'identity', 'location-semantics']);
  for (const command of creationRequest.command.payload.commands) {
    const record = created.data.records.find(record => record.target.recordId === command.target.recordId); assert(record);
    assert.deepEqual(record.target, command.target); assert.deepEqual(record.payload, command.payload); assert.equal(record.lifecycle, 'active'); assert.equal(record.revision, 1);
  }
  const initialIdentity = created.data.records.find(record => record.target.recordType === 'identity');
  const semantics = created.data.records.find(record => record.target.recordType === 'location-semantics');
  const initialEvidence = created.data.records.find(record => record.target.recordType === 'evidence');
  assert.equal(semantics.payload.atlasId, initialIdentity.target.recordId); assert.equal(semantics.payload.semanticKind, 'building'); assert.equal(semantics.payload.label, 'Main house');
  assert.equal(semantics.payload.reviewStatus, 'accepted'); assert.deepEqual(initialIdentity.payload.evidenceIds, [initialEvidence.target.recordId]);
  const place = row(initialIdentity.target.recordId), evidenceRoot = `(${place})?.querySelector(':scope > .topology-evidence')`;
  await until(async () => evaluate(`(${place})?.querySelector('.ledger-name')?.textContent==='Main house'`), 'Real created native row');
  assert((await evaluate(`(${place}).innerText`)).includes('No bound HomeBox record in this view'));
  phase = 'native-admission';
  const nativePath = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${semantics.target.recordId}`;
  await click(byText(evidenceRoot, 'Add native evidence'), 'Add native evidence');
  const formSection = `(${evidenceRoot})?.querySelector('section[aria-label="Native evidence for Main house"]')`;
  const form = `(${formSection})?.querySelector('form')`;
  await until(async () => evaluate(`!!(${form})?.querySelector('input[name="file"]:not(:disabled)')`), 'Actual admitted evidence form');
  const admissionResponse = await until(() => responses.find(item => item.path === nativePath && item.status === 200), 'Native-only admission GET');
  const admission = await responseBody(admissionResponse, [nativePath]);
  assert.equal(admission.schemaVersion, 1); assert.equal(admission.admissionKind, 'native-location'); assert.deepEqual(admission.scope, scope);
  assert.equal(admission.record.recordId, semantics.target.recordId); assert.equal(admission.record.revision, 1); assert.deepEqual(admission.record.payload, semantics.payload);
  assert.equal(admission.identity.recordId, initialIdentity.target.recordId); assert.deepEqual(admission.identity.payload, initialIdentity.payload); assert.equal(admission.canAttachEvidence, true);
  assert.deepEqual(admission.guards, [{ record: { recordType: 'evidence', recordId: initialEvidence.target.recordId }, expectedRevision: 1 }, { record: { recordType: 'identity', recordId: initialIdentity.target.recordId }, expectedRevision: 1 }]);
  assert(admission.attachmentPolicy.contentTypes.includes('application/pdf')); assert.equal(admission.attachmentPolicy.licenses.length, 1);
  assert.deepEqual(admission.attachmentPolicy.licenses[0].value, { status: 'unknown', reference: null });
  phase = 'select-one-generated-pdf';
  const pdf = pdfBytes(), filename = 'synthetic-electricity.pdf', pdfPath = join(scratch, filename), pdfSha256 = sha(pdf);
  assert(pdf.length < 16384); writeFileSync(pdfPath, pdf, { mode: 0o600, flag: 'wx' });
  const doc = await send('DOM.getDocument', { depth: 0 });
  // The existing native DOM file-input port delivers a real File to onChange.
  // No app draft, selection object, transport or synthetic React state is injected.
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'section[aria-label="Native evidence for Main house"] input[name="file"]' }); assert(node.nodeId > 0);
  inputEvidence.push({ phase, action: 'Choose file or PDF', filename, bytes: pdf.length, sha256: pdfSha256 });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [pdfPath] });
  await until(async () => evaluate(`(${form})?.textContent.includes(${JSON.stringify(`Selected: ${filename} · PDF · ${pdf.length} bytes`)}) && (${form})?.textContent.includes('File selected. Review the evidence statement before uploading.')`), 'Actual checked browser selection');
  const statement = 'Synthetic uploaded electricity evidence; document truth and fact date are unknown.';
  const reason = 'Attach one generated PDF through the native evidence React form.';
  await enter(`(${form}).querySelector('textarea[name="statement"]')`, statement, 'Evidence statement');
  await enter(`(${form}).querySelector('input[name="reason"]')`, reason, 'Evidence reason');
  await option(`(${form}).querySelector('select[name="license"]')`, '0');
  assert.deepEqual(await evaluate(`Array.from((${form}).querySelector('select[name="license"]').options).slice(1).map(option=>option.textContent)`), admission.attachmentPolicy.licenses.map(choice => choice.label));
  assert.equal(await evaluate(`(${form}).checkValidity()`), true); await capture('selected-document');
  phase = 'upload-once';
  await click(byText(form, 'Upload native evidence'), 'Upload native evidence once');
  const uploadedRequest = await until(() => requests.find(item => item.path === nativePath + '/evidence'), 'One real multipart upload');
  assert.equal(uploadedRequest.method, 'POST');
  const fresh = requests.filter(item => item.path === nativePath && item.method === 'GET' && item.phase === 'upload-once'); assert.equal(fresh.length, 1);
  const freshResponse = await until(() => responses.find(item => item.id === fresh[0].id), 'Final fresh native admission'); assert.equal(freshResponse.status, 200);
  assert.deepEqual(await responseBody(freshResponse, [nativePath]), admission);
  const uploadResponse = await until(() => responses.find(item => item.id === uploadedRequest.id), 'Actual committed upload response'); assert.equal(uploadResponse.status, 200);
  const uploaded = await responseBody(uploadResponse, [nativePath + '/evidence']);
  assert.match(uploaded.requestId, UUID); correlated(uploaded, uploaded.requestId, 'committed'); assert.match(uploaded.operationId, UUID); assert.match(uploaded.data.requestDigest, SHA);
  assert.equal(uploaded.data.records.length, 3); assert.equal(uploaded.data.auditIds.length, 3);
  assert.deepEqual(uploaded.data.records.map(record => record.target.recordType).sort(), ['asset', 'evidence', 'identity']);
  const savedIdentity = uploaded.data.records.find(record => record.target.recordType === 'identity');
  const savedEvidence = uploaded.data.records.find(record => record.target.recordType === 'evidence');
  const asset = uploaded.data.records.find(record => record.target.recordType === 'asset');
  assert.equal(savedIdentity.target.recordId, initialIdentity.target.recordId); assert.equal(savedIdentity.revision, 2);
  assert.deepEqual(savedIdentity.payload, { ...initialIdentity.payload, evidenceIds: [...initialIdentity.payload.evidenceIds, savedEvidence.target.recordId] });
  assert.equal(savedEvidence.payload.statement, statement); assert.deepEqual(savedEvidence.payload.references, [{ kind: 'atlas-asset', assetId: asset.target.recordId }]);
  const provenance = savedEvidence.payload.provenance;
  assert.equal(provenance.source, null); assert.equal(provenance.sourceRevision, null); assert.equal(provenance.sourceConfidence, null); assert.equal(provenance.factAt, null);
  assert.equal(provenance.evidenceBasis, 'unknown'); assert.deepEqual(provenance.uncertainty, { status: 'unknown', explanation: null });
  assert(provenance.vantage.startsWith('Browser selection claim v1: '));
  const captureClaim = JSON.parse(provenance.vantage.slice('Browser selection claim v1: '.length));
  assert.deepEqual(Object.keys(captureClaim).sort(), ['byteOrigin', 'filename', 'reportedContentType', 'schemaVersion', 'selectedAt', 'selectionMethod']);
  assert.equal(captureClaim.schemaVersion, 1); assert.equal(captureClaim.selectionMethod, 'file-picker'); assert.equal(captureClaim.filename, filename);
  assert.equal(captureClaim.reportedContentType, 'application/pdf'); assert.equal(captureClaim.byteOrigin, 'browser-returned-unmodified'); assert(Number.isFinite(Date.parse(captureClaim.selectedAt)));
  assert.equal(asset.payload.sha256, pdfSha256); assert.equal(asset.payload.byteSize, pdf.length); assert.equal(asset.payload.contentType, 'application/pdf');
  assert.equal(asset.payload.owner, 'atlas'); assert.equal(asset.payload.purpose, 'evidence-original'); assert.equal(asset.payload.availability, 'available'); assert.equal(asset.payload.previewPolicy, 'download-only');
  assert.deepEqual(asset.payload.sourceLicense, { status: 'unknown', reference: null });
  phase = 'visible-receipt-and-readback';
  const committedSummary = `Array.from((${evidenceRoot})?.querySelectorAll(':scope > details > summary') ?? []).find(el=>el.textContent.trim()===${JSON.stringify('Native evidence saved · ' + uploaded.requestId)})`;
  await until(async () => evaluate(`!!(${committedSummary})`), 'Visible committed attempt after real topology refresh');
  await click(committedSummary, 'Open native saved evidence');
  const attempt = `(${committedSummary})?.parentElement`;
  await click(byText(attempt, 'Native command receipt', 'summary'), 'Open native command receipt');
  assert.deepEqual(JSON.parse(await evaluate(`(${attempt}).querySelector('pre').textContent`)), uploaded, 'Exact complete canonical receipt rendered');
  await click(`Array.from((${evidenceRoot})?.querySelectorAll(':scope > details > summary') ?? []).find(el=>el.textContent.startsWith('Native identity evidence ('))`, 'Open native identity evidence');
  const linked = `(${evidenceRoot})?.querySelector('.linked-evidence[data-evidence-id="${savedEvidence.target.recordId}"]')`;
  await click(`(${linked})?.querySelector('button')`, 'View newly saved evidence');
  await until(async () => evaluate(`!!(${linked})?.querySelector('details[open]')`), 'Actual linked evidence read');
  const shown = await evaluate(`(() => {const el=${linked};return {text:el.innerText,facts:Object.fromEntries(Array.from(el.querySelectorAll('dl.facts > div')).map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]))};})()`);
  assert.equal(shown.facts['Statement'], statement); assert.equal(shown.facts['Evidence basis'], 'unknown'); assert.equal(shown.facts['Original fact date'], 'Not supplied');
  assert.equal(shown.facts['Source reference'], 'Not supplied'); assert.equal(shown.facts['Browser selection claim (unverified)'], provenance.vantage);
  assert(shown.text.includes('Atlas asset ID: ' + asset.target.recordId));
  const linkedPath = stock() + '/records/evidence/' + savedEvidence.target.recordId;
  const linkedRequest = await until(() => requests.find(item => item.path === linkedPath && item.method === 'GET'), 'Actual evidence read request');
  const linkedResponse = await until(() => responses.find(item => item.id === linkedRequest.id), 'Evidence read response'); assert.equal(linkedResponse.status, 200);
  const linkedWire = await responseBody(linkedResponse, [linkedPath]);
  assert.equal(linkedWire.commandId, 'atlas.evidence.get'); assert.equal(linkedWire.status, 'read'); assert.deepEqual(linkedWire.resolvedScope, scope);
  assert.deepEqual(linkedWire.data.records, [savedEvidence]);

  phase = 'original-availability-and-delivery';
  await click(byText(attempt, 'Check original download'), 'Check original download');
  const descriptorDigest = sha(Buffer.from(JSON.stringify({ assetId: asset.target.recordId, kind: 'atlas-asset' })));
  const mediaPath = `/api/atlas/media/${scope.workspaceId}/${scope.homeId}/${descriptorDigest}/download`;
  await until(async () => evaluate(`(${attempt}).querySelector('a[download]')?.getAttribute('href')===${JSON.stringify(mediaPath)}`), 'Actual current original offer');
  assert.equal(requests.filter(item => item.path === mediaPath && item.method === 'HEAD').length, 1);
  const headRequest = requests.find(item => item.path === mediaPath && item.method === 'HEAD');
  const headResponse = await until(() => responses.find(item => item.id === headRequest.id), 'Native availability HEAD'); assert.equal(headResponse.status, 200);
  await terminal(headResponse, 'Successful HEAD terminal completion');
  // Redeem the actual UI href with the existing bounded browser GET pattern.
  // This proves real native delivery, not an OS file chooser/download manager.
  const delivery = await evaluate(`(async()=>{const anchor=(${attempt}).querySelector('a[download]');if(!anchor||anchor.textContent!=='Download original')throw new Error('Original link unavailable');const url=new URL(anchor.href);if(url.origin!==${JSON.stringify(origin)}||url.pathname!==${JSON.stringify(mediaPath)}||url.search||url.hash)throw new Error('Original href changed');const r=await fetch(anchor.href,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});const reader=r.body.getReader();const bytes=new Uint8Array(${pdf.length});let size=0;try{for(;;){const part=await reader.read();if(part.done)break;if(part.value.length>bytes.length-size)throw new Error('Original byte bound');bytes.set(part.value,size);size+=part.value.length;}return {status:r.status,bytes:Array.from(bytes.subarray(0,size)),type:r.headers.get('content-type'),length:r.headers.get('content-length'),cache:r.headers.get('cache-control'),disposition:r.headers.get('content-disposition'),nosniff:r.headers.get('x-content-type-options')};}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}})()`);
  assert.equal(delivery.status, 200); assert.deepEqual(Buffer.from(delivery.bytes), pdf); assert.equal(sha(Buffer.from(delivery.bytes)), pdfSha256);
  assert.equal(delivery.type, 'application/pdf'); assert.equal(delivery.length, String(pdf.length)); assert.equal(delivery.cache, 'private, no-store');
  assert(delivery.disposition.startsWith('attachment;')); assert.equal(delivery.nosniff, 'nosniff');
  const originalRequest = await until(() => requests.find(item => item.path === mediaPath && item.method === 'GET'), 'Original native delivery GET');
  const originalResponse = await until(() => responses.find(item => item.id === originalRequest.id), 'Original native delivery response'); assert.equal(originalResponse.status, 200);
  await terminal(originalResponse, 'Successful original terminal completion');

  await capture('saved-native-evidence');
  phase = 'native-receipt-and-history-joins';
  const saved = [initialEvidence, savedIdentity, semantics, asset, savedEvidence], auditIds = [...created.data.auditIds, ...uploaded.data.auditIds];
  assert.equal(new Set(saved.map(record => record.target.recordId)).size, 5); assert.equal(new Set(auditIds).size, 6);
  const histories = [];
  for (const record of saved) {
    assert.equal(record.lifecycle, 'active'); assert.equal(record.target.authority, 'atlas'); assert.match(record.target.recordId, UUID);
    const got = await read(record.target.recordType, 'get', record.target.recordId); assert.deepEqual(got.data.records, [record]);
    const history = await read(record.target.recordType, 'history', record.target.recordId, empty);
    assert.equal(history.data.nextCursor, null); assert.equal(history.data.completeness, 'atlas-owned-audit'); assert.equal(history.data.entries.length, record.revision);
    for (const entry of history.data.entries) { assert.equal(entry.actorId, actorId); assert.equal(entry.state, 'committed'); assert.deepEqual(entry.target, record.target); assert(auditIds.includes(entry.eventId)); }
    histories.push(history.data);
  }
  assert.deepEqual(histories.flatMap(history => history.entries.map(entry => entry.eventId)).sort(), auditIds.sort());
  assert.deepEqual((await read('binding', 'list', null, empty)).data.records, [], 'No provider binding fabricated');
  assert.equal(requests.filter(item => item.path === stock() + '/commands').length, 1); assert.equal(requests.filter(item => item.path === nativePath + '/evidence').length, 1);
  assert.deepEqual(requests.filter(item => item.method === 'POST').map(item => item.path).sort(), ['/api/atlas/auth/local', stock() + '/commands', nativePath + '/evidence'].sort());
  assert(owned.every(handle => !handle.pipeError)); live();
  report = { format: 'houseatlas-native-place-evidence-ui-positive/1', status: 'passed', artifacts, origin, scope, actorId,
    counts: { sourceFreeCreations: 1, uploads: 1, uniqueNativeRecords: 5, nativeAuditChanges: 6 },
    creation: { request: creationRequest.command, receipt: created }, admission, upload: { receipt: uploaded, pdfSha256, bytes: pdf.length, filename, captureClaim },
    visibleReceiptMatches: true, displayedEvidence: shown, original: { route: mediaPath, sha256: pdfSha256, bytes: pdf.length, headers: { type: delivery.type, cache: delivery.cache, disposition: delivery.disposition } },
    readProofs, requests, responses, requiredTerminals: [signInResponse, creationResponse, admissionResponse, freshResponse, uploadResponse, linkedResponse, headResponse, originalResponse].map(response=>({id:response.id,path:response.path,status:response.status,terminal:'loadingFinished'})), inputEvidence, screenshots: captures,
    qualification: 'One successful fresh real React/native TLS/local Editor creation and generated PDF selection/upload/visible canonical receipt/linked evidence/read-history/exact original browser GET. Browser selection claims remain unverified; evidence basis/fact date unknown. Narrow viewport is synthetic. No OS picker/download-manager, actual household/PDF safety/device, provider, repeated intent/retry/unknown-loss/failure-control, security, fallback, NAS or installation acceptance.' };
} catch (error) { primaryFailure = { error }; failurePhase = phase; }
finally {
  clearTimeout(budget);
  phase = 'cleanup'; cleanupDeadline = Math.min(began + hardLimitMs, Date.now() + 45000);
  if (cdp && !stopped(browser)) { try { await cdp.send('Browser.close', {}, null, 5000); } catch { /* Actual owned group/stdio closure remains mandatory below. */ } }
  cdp?.rejectPending();
  for (const handle of [...owned].reverse()) {
    try { await stopOwned(handle, handle === service && primaryFailure === null); }
    catch (error) { cleanupFailure ??= { error }; }
  }
  if (owned.every(handle => released(handle))) {
    try { rmSync(scratch, { recursive: true }); assert(!existsSync(scratch)); }
    catch (error) { cleanupFailure ??= { error }; }
  }
}
const cleanup = { elapsedMs: Date.now() - began, hardLimitMs, scratchRemoved: !existsSync(scratch),
  processes: owned.map(handle => ({ label: handle.label, pid: handle.pid ?? null, processGroupId: handle.pid ?? null,
    exitCode: handle.exitCode, signalCode: handle.signalCode, stopped: stopped(handle), stdioClosed: handle.stdioClosed === true,
    groupAbsent: groupGone(handle), groupProbeFailed: handle.groupProbeFailed === true, groupProbeCode: handle.groupProbeCode ?? null, pipeError: handle.pipeError, failedToStart: handle.failedToStart === true, spawnCode: handle.spawnCode ?? null })) };
if (!primaryFailure && !cleanupFailure) {
  try { assert(report); assert(!timedOut && !eventFailure && cleanup.elapsedMs < hardLimitMs); assert(cleanup.scratchRemoved); assert(owned.every(handle => released(handle) && !handle.pipeError && !handle.groupProbeFailed)); }
  catch (error) { primaryFailure = { error }; failurePhase = 'final-cleanup-fence'; }
}
if (primaryFailure || cleanupFailure) {
  report = { format: 'houseatlas-native-place-evidence-ui-positive/1', status: 'failed', artifacts,
    phase: failurePhase ?? 'cleanup', errorCode: safeCode(primaryFailure?.error ?? cleanupFailure?.error), cleanupFailed: cleanupFailure !== null,
    eventFailure, startup: publicStartup(), signIn: requests.filter(item=>item.path==='/api/atlas/auth/local'&&item.method==='POST').map(item=>({id:item.id,path:item.path,method:item.method,status:responses.find(response=>response.id===item.id)?.status??null,terminal:failedLoads.has(item.id)?'loadingFailed':completed.has(item.id)?'loadingFinished':'not-observed'})), counters: { creationPosts: requests.filter(item => item.path === stock() + '/commands').length,
      uploadPosts: requests.filter(item => item.path.endsWith('/evidence') && item.method === 'POST').length, inputActions: inputEvidence.length }, cleanup,
    qualification: 'Ordinary observed failure only. No runtime error, auth/headers/multipart/evaluation payload or non-allowlisted startup text retained. No success or retry inferred.' };
  process.exitCode = 1;
} else report.cleanup = cleanup;
writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ status: report.status, phase: report.phase ?? 'complete', resultPath: join(output, 'result.json'),
  resultSha256: sha(selected(join(output, 'result.json'), 4 * 1024 * 1024, true)), cleanup }, null, 2));
