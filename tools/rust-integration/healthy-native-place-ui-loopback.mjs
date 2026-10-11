// Separately reviewed successful native naming and compatible-code fallback.
// Do not execute until Root registers the exact source and artifact packet in README.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0', 'Pinned Node runtime');
assert.equal(process.argv.length, 3, 'Exactly one Root artifact selection JSON');
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const origin = 'https://127.0.0.1:48743';
const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { workspaceId: U(2), homeId: U(3) }, actorId = U(5);
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
function selected(path, maximum, privateFile = false, systemExecutable = false) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'Explicit absolute path');
  assert.equal(realpathSync(path), path, 'Canonical selected path');
  const before = lstatSync(path);
  assert(before.isFile() && before.nlink === 1 && before.size <= maximum, 'Bounded regular selected file');
  assert(before.uid === process.getuid() || (systemExecutable && before.uid === 0), 'Selected owner is current user, or root for a pinned system executable');
  assert.equal(before.mode & 0o022, 0, 'Selected file is not group/world writable');
  if (privateFile) assert.equal(before.mode & 0o777, 0o600, 'Private artifact selection/receipt');
  const bytes = readFileSync(path), after = lstatSync(path);
  assert.equal(before.dev, after.dev); assert.equal(before.ino, after.ino);
  assert.equal(before.size, after.size); assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(bytes.length, before.size); return bytes;
}
function artifact(value, label) {
  assert(value && typeof value === 'object'); assert.match(value.sha256, SHA);
  assert.match(value.sourceCommit, COMMIT); assert.match(value.sourceTree, COMMIT);
  assert.match(value.buildRecord.sha256, SHA);
  assert.equal(hashBytes(selected(value.buildRecord.path, 1024 * 1024, true)), value.buildRecord.sha256, label + ' exact Root build record');
  assert.equal(hashBytes(selected(value.path, 512 * 1024 * 1024)), value.sha256, label + ' exact compiled artifact');
  return value;
}
assert(isAbsolute(process.argv[2]), 'Artifact selection path is absolute');
const selectionPath = process.argv[2], selectionBytes = selected(selectionPath, 256 * 1024, true);
const selection = JSON.parse(selectionBytes);
assert.equal(selection.format, 'houseatlas-native-place-ui-artifacts/2');
const candidate = artifact(selection.candidate, 'candidate'), fallback = artifact(selection.fallback, 'fallback');
assert.notEqual(candidate.sha256, fallback.sha256, 'Distinct explicitly compatible fallback artifact');
assert.equal(fallback.compatibility, 'location-semantics-label-and-v2-receipt', 'Root reviewed fallback contract');
const frontend = selection.frontend, fallbackFrontend = selection.fallbackFrontend;
function enumerate(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name; assert(!entry.isSymbolicLink(), 'No frontend symlinks');
    if (entry.isDirectory()) return enumerate(join(directory, entry.name), name + '/');
    assert(entry.isFile(), 'Regular frontend files only'); return [name];
  }).sort();
}
function verifyFrontend(frontend) {
  assert.match(frontend.sourceCommit, COMMIT); assert.match(frontend.sourceTree, COMMIT);
  assert.match(frontend.buildRecord.sha256, SHA);
  assert.equal(hashBytes(selected(frontend.buildRecord.path, 1024 * 1024, true)), frontend.buildRecord.sha256, 'Frontend exact build record');
  assert(isAbsolute(frontend.directory) && realpathSync(frontend.directory) === frontend.directory);
  assert(Array.isArray(frontend.files) && frontend.files.length > 0 && frontend.files.length <= 128);
  assert.deepEqual(enumerate(frontend.directory), frontend.files.map(file => file.path).sort(), 'Complete selected dist file set');
  let distBytes = 0;
  for (const file of frontend.files) {
    assert(typeof file.path === 'string' && !isAbsolute(file.path) && !file.path.split('/').some(part => !part || part === '.' || part === '..'));
    assert.match(file.sha256, SHA); const bytes = selected(join(frontend.directory, file.path), 8 * 1024 * 1024);
    assert.equal(bytes.length, file.bytes); assert.equal(hashBytes(bytes), file.sha256); distBytes += bytes.length;
  }
  assert(distBytes <= 64 * 1024 * 1024); assert(frontend.files.some(file => file.path === 'index.html'));
}
verifyFrontend(frontend); verifyFrontend(fallbackFrontend);
assert.equal(frontend.sourceCommit, candidate.sourceCommit); assert.equal(frontend.sourceTree, candidate.sourceTree);
assert.notEqual(frontend.directory, fallbackFrontend.directory, 'Distinct selected frontend directories');
assert.equal(fallbackFrontend.sourceCommit, fallback.frontendSourceCommit); assert.equal(fallbackFrontend.sourceTree, fallback.frontendSourceTree);
const chromium = selection.chromium;
assert.equal(chromium.version, 'Chrome/154.0.8037.98'); assert.match(chromium.sha256, SHA);
assert.equal(hashBytes(selected(chromium.path, 512 * 1024 * 1024, false, true)), chromium.sha256, 'Selected Chrome artifact');
assert.match(selection.openssl.sha256, SHA);
assert.equal(hashBytes(selected(selection.openssl.path, 32 * 1024 * 1024, false, true)), selection.openssl.sha256, 'Pinned system OpenSSL');
const output = selection.evidenceDirectory;
assert(isAbsolute(output) && realpathSync(output) === output);
const outputMeta = lstatSync(output);
assert(outputMeta.isDirectory() && outputMeta.uid === process.getuid() && (outputMeta.mode & 0o777) === 0o700, 'Existing private Root evidence directory');
for (const file of ['result.json', ...['candidate-named-building', 'compatible-fallback-named-rooms'].flatMap(label => [1440, 390].map(width => `${label}-${width}.png`))])
  assert(!existsSync(join(output, file)), 'Never overwrite prior result/evidence');
const source = { runnerSha256: hashBytes(selected(fileURLToPath(import.meta.url), 128 * 1024)),
  selectionSha256: hashBytes(selectionBytes), candidate, fallback, frontend, fallbackFrontend, chromium, openssl: selection.openssl,
  provenanceQualification: 'Source/build identities are supplied in exact hashed Root build records; this runner independently measures selected compiled files.' };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'houseatlas-native-place-ui-'))); chmodSync(scratch, 0o700);
const data = join(scratch, 'data'), configPath = join(scratch, 'server.json');
const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const beganAt = Date.now(), hardLimitMs = 20 * 60 * 1000;
const delay = ms => new Promise(yes => setTimeout(yes, ms));
const owned = [], requests = [], responses = [], completed = new Set(), runtimeErrors = [], inputEvidence = [], captures = [], readProofs = [], configurations = [], startupChecks = [];
let service, browser, cdp, sessionId, currentConfiguration, originalConfigurationBytes, phase = 'preparation', timedOut = false, eventFailure = null;
const isStopped = child => !child || child.failedToStart || child.exitCode !== null || child.signalCode !== null;
async function until(check, label, milliseconds = 30000, cleanup = false) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!cleanup && (timedOut || eventFailure)) throw new Error(timedOut ? 'Overall qualification budget exhausted' : eventFailure);
    const value = await check(); if (value) return value; await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
async function stop(child, signal = 'SIGTERM', graceful = false) {
  if (isStopped(child)) { if (graceful && child) assert.equal(child.exitCode, 0, 'Native graceful completion'); return; }
  child.kill(signal); let forced = false;
  try { await until(() => isStopped(child), 'owned process shutdown', 12000, true); }
  catch { forced = true; child.kill('SIGKILL'); await until(() => isStopped(child), 'owned forced cleanup', 3000, true); }
  if (graceful) { assert.equal(forced, false, 'Native service drains gracefully'); assert.equal(child.exitCode, 0); }
}
function child(binary, args, options = {}) {
  const handle = spawn(binary, args, { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  handle.on('error', () => { handle.failedToStart = true; eventFailure = 'Owned process could not start'; }); owned.push(handle); return handle;
}
async function unusedPort() {
  const probe = createServer();
  await new Promise((yes, no) => { probe.once('error', no); probe.listen({ host: '127.0.0.1', port: 48743, exclusive: true }, yes); });
  await new Promise((yes, no) => probe.close(error => error ? no(error) : yes()));
}
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0);
  constructor(process) {
    this.process = process;
    process.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      if (this.buffer.length > 8 * 1024 * 1024) { eventFailure = 'CDP message exceeds bound'; this.rejectPending(); return; }
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
        if (!raw.length) continue;
        try {
          const message = JSON.parse(raw.toString('utf8'));
          if (message.id) {
            const pending = this.pending.get(message.id); if (!pending) continue;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            message.error ? pending.no(new Error('CDP command failed: ' + pending.method)) : pending.yes(message.result);
          } else this.event(message);
        } catch { eventFailure = 'CDP event could not be decoded'; this.rejectPending(); }
      }
    });
    process.on('exit', () => this.rejectPending());
  }
  rejectPending() { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.no(new Error('Owned CDP connection ended')); } this.pending.clear(); }
  event(message) {
    const params = message.params;
    if (message.method === 'Fetch.requestPaused') {
      const allowed = params.request.url.startsWith(origin + '/');
      if (!allowed) eventFailure = 'Application request outside selected loopback origin';
      void this.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }, message.sessionId)
        .catch(() => { if (!isStopped(browser)) eventFailure = 'Request confinement could not settle'; });
    } else if (message.method === 'Network.requestWillBeSent') {
      const request = params.request; if (!request.url.startsWith(origin + '/')) return;
      const url = new URL(request.url), row = { id: params.requestId, phase, path: url.pathname, method: request.method };
      // Never retain headers, cookie, auth request/response or CSRF.
      if (url.pathname.endsWith('/commands')) { assert(request.postData, 'Full DOM command bytes'); row.command = JSON.parse(request.postData); }
      else if (url.pathname.endsWith('/invoke')) row.command = JSON.parse(url.searchParams.get('request'));
      requests.push(row); assert(requests.length <= 1000, 'Bounded application exchanges');
    } else if (message.method === 'Network.responseReceived') {
      const response = params.response; if (!response.url.startsWith(origin + '/')) return;
      responses.push({ id: params.requestId, phase, path: new URL(response.url).pathname, status: response.status,
        snapshot: Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'x-atlas-snapshot-sha256')?.[1] ?? null });
    } else if (message.method === 'Network.loadingFinished') completed.add(params.requestId);
    else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push({ phase, type: 'application-runtime-exception' });
  }
  send(method, params = {}, attached = sessionId, timeout = 15000) {
    const id = ++this.next;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => { this.pending.delete(id); no(new Error('CDP deadline: ' + method)); }, timeout);
      this.pending.set(id, { yes, no, timer, method });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(attached ? { sessionId: attached } : {}) }) + '\0');
    });
  }
}
const send = (method, params, timeout) => cdp.send(method, params, sessionId, timeout);
async function evaluate(expression, timeout = 15000) {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
  assert(!reply.exceptionDetails, 'Successful bounded browser evaluation'); return reply.result.value;
}
async function click(selector, label) {
  await until(async () => evaluate(`(() => { const el=${selector}; if(!el||!el.getClientRects().length||el.disabled) return false; el.scrollIntoView({block:'center',behavior:'instant'}); return true; })()`), label);
  await evaluate('new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes)))');
  const point = await evaluate(`(() => { const el=${selector}, r=el.getBoundingClientRect(), p={x:r.x+r.width/2,y:r.y+r.height/2}, hit=document.elementFromPoint(p.x,p.y); return {point:p,hit:hit===el||el.contains(hit)}; })()`);
  assert.equal(point.hit, true, label + ' actual hit target'); inputEvidence.push({ phase, action: label, point: point.point });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point.point });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point.point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point.point, button: 'left', clickCount: 1 });
}
async function enter(selector, value, label) {
  await click(selector, label);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
  await send('Input.insertText', { text: value }); assert.equal(await evaluate(`(${selector}).value`), value, label + ' real browser input');
}
async function option(selector, value, label) {
  await click(selector, label);
  // Native select input/change events; no application state or transport replacement.
  assert.equal(await evaluate(`(() => { const select=${selector}; const option=Array.from(select.options).find(option=>option.value===${JSON.stringify(value)}); if(!option||option.disabled)return false; select.value=option.value; select.dispatchEvent(new Event('input',{bubbles:true})); select.dispatchEvent(new Event('change',{bubbles:true})); return select.value===option.value; })()`), true);
}
const byText = (scope, text) => `Array.from((${scope}).querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
const addSection = `document.querySelector('.topology-scope > section[aria-label="Add Atlas place"]')`;
const row = id => `Array.from(document.querySelectorAll('.topology-scope li.ledger-row')).find(row=>row.querySelector('.ledger-name')?.title===${JSON.stringify(id)})`;
const editSection = id => `(${row(id)}).querySelector('section[aria-label="Atlas name editing"]')`;
async function body(response) {
  assert(response.path.endsWith('/commands') || response.path.endsWith('/invoke'), 'Only native bodies retained');
  await until(() => completed.has(response.id), 'native body complete');
  const raw = await send('Network.getResponseBody', { requestId: response.id });
  const bytes = raw.base64Encoded ? Buffer.from(raw.body, 'base64') : Buffer.from(raw.body);
  assert(bytes.length <= 1024 * 1024); return JSON.parse(bytes.toString('utf8'));
}
function correlated(request, wire, status) {
  assert.equal(wire.schemaVersion, 3); assert.equal(wire.commandId, request.commandId); assert.equal(wire.requestId, request.requestId);
  assert.deepEqual(wire.resolvedScope, scope); assert.deepEqual(request.context, scope); assert.equal(wire.status, status); assert.equal(wire.replayed, false);
}
async function read(kind, verb, recordId, payload = {}) {
  const request = { schemaVersion: 3, commandId: `atlas.${kind}.${verb}`, requestId: randomUUID(), context: scope,
    target: { authority: 'atlas', recordType: kind, ...(recordId ? { recordId } : {}) }, payload };
  const prefix = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
  const result = await evaluate(`(async()=>{const response=await fetch(${JSON.stringify(prefix + '/invoke?request=' + encodeURIComponent(JSON.stringify(request)))},{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});return {status:response.status,wire:await response.json()};})()`, 20000);
  assert.equal(result.status, 200); correlated(request, result.wire, 'read'); readProofs.push({ phase, request, wire: result.wire }); return result.wire;
}
function census(path, tables = null) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN DEFERRED;');
    const catalog = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
    const names = tables ?? catalog.filter(row => row.type === 'table').map(row => row.name).sort();
    const data = {};
    for (const name of names) {
      assert(/^[a-z_]+$/.test(name)); const count = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n;
      assert(count <= 300, 'Fresh positive table row bound');
      const statement = db.prepare(`SELECT * FROM "${name}"`); statement.setReadBigInts(true);
      data[name] = statement.all().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
        typeof value === 'bigint' ? { integer: String(value) } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString('base64') } : value])))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    db.exec('COMMIT'); const result = { catalog, data }; assert(Buffer.byteLength(JSON.stringify(result)) <= 8 * 1024 * 1024); return result;
  } finally { db.close(); }
}
const inode = path => { const meta = lstatSync(path, { bigint: true }); return { dev: String(meta.dev), ino: String(meta.ino) }; };
function physical() { return { data: inode(data), atlas: inode(join(data, 'atlas.sqlite')), access: inode(join(data, 'access.sqlite')),
  receiptSha256: hashBytes(selected(join(data, 'server-state.json'), 16384, true)) }; }
function selectFrontend(frontend, label) {
  assert(isStopped(service), 'Frontend selection changes only with the native backend stopped');
  verifyFrontend(frontend);
  const before = JSON.parse(selected(configPath, 65536, true)); assert.deepEqual(before, currentConfiguration);
  const next = { ...currentConfiguration, frontendDirectory: frontend.directory };
  const { frontendDirectory: oldFrontend, ...oldFields } = before, { frontendDirectory: nextFrontend, ...nextFields } = next;
  assert.deepEqual(nextFields, oldFields, 'Only explicit frontend directory changes; identity/auth/home/MCP/listener remain exact');
  writeFileSync(configPath, JSON.stringify(next), { mode: 0o600 }); currentConfiguration = next;
  configurations.push({ label, frontendDirectory: nextFrontend, configurationSha256: hashBytes(selected(configPath, 65536, true)) });
}
async function start(artifact, label, frontend) {
  phase = label; await unusedPort(); assert.equal(hashBytes(selected(artifact.path, 512 * 1024 * 1024)), artifact.sha256);
  verifyFrontend(frontend); assert.deepEqual(JSON.parse(selected(configPath, 65536, true)), currentConfiguration);
  assert.equal(currentConfiguration.frontendDirectory, frontend.directory);
  const markers = ['server-state.rebind.pending', 'server-state.receipt-compatibility.pending', 'server-state.receipt-compatibility.next'];
  for (const marker of markers) {
    try { lstatSync(join(data, marker)); assert.fail('Pending startup marker requires separate reviewed recovery'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  startupChecks.push({ phase, absentMarkers: markers, binarySha256: artifact.sha256, frontendSourceCommit: frontend.sourceCommit });
  service = child(artifact.path, ['serve', '--server-config', configPath]); let log = '';
  service.stdout.on('data', bytes => { log += bytes; if (log.length > 256 * 1024) eventFailure = 'Native lifecycle output exceeds bound'; }); service.stderr.on('data', () => {});
  await until(() => { assert(!isStopped(service), 'Selected native service running'); return log.includes('HouseAtlas persistent server listening on 127.0.0.1:48743'); }, 'persistent TLS listener');
}
async function readyRooms(requireEditor) {
  await until(async () => evaluate("document.querySelector('.house-name')?.textContent==='Synthetic home'"), 'real home ready');
  await click(`Array.from(document.querySelectorAll('nav[aria-label="Sections"] button')).find(button=>button.textContent.trim()==='Rooms & places')`, 'Rooms & places');
  await until(async () => evaluate("document.querySelector('main#main h1')?.textContent==='Rooms & places' && !!document.querySelector('.topology-scope')"), 'Rooms view');
  if (requireEditor) await until(async () => evaluate("!!Array.from(document.querySelectorAll('.topology-scope > button')).find(button=>button.textContent.trim()==='Add Atlas place')"), 'current admitted native form');
}
async function selectBuilding(id) {
  await click(`document.querySelector('.topology-scope [role="group"][aria-label="Building"] button[title="${id}"]')`, 'Select actual Alpha building');
  await until(async () => evaluate("document.querySelector('.topology-building h2')?.textContent==='Alpha building' && document.querySelector('.topology-scope > p[role=status]')?.textContent==='Alpha building: 1 locations in reviewed membership'"), 'actual selected membership');
}
async function labelVisible(id, label) {
  await until(async () => evaluate(`(${row(id)})?.querySelector('.ledger-name')?.textContent===${JSON.stringify(label)}`), 'native name through real topology');
  assert((await evaluate(`(${row(id)}).innerText`)).includes('No bound HomeBox record in this view'));
}
async function capture(label) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await until(async () => evaluate(`innerWidth===${width}`), 'viewport'); await evaluate('new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes)))');
    const dom = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:document.querySelector("main#main")?.outerHTML,bodyText:document.body.innerText})');
    assert(dom.scrollWidth <= width + 1, 'Naming UI fits viewport');
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = join(output, `${label}-${width}.png`); writeFileSync(path, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 });
    captures.push({ label, width, height, path, sha256: hashBytes(readFileSync(path)), dom });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}
const batches = [], known = new Map();
async function submit(section, label) {
  const before = requests.filter(row => row.path.endsWith('/commands')).length;
  await click(byText(section, label), label);
  const request = await until(() => requests.filter(row => row.path.endsWith('/commands')).at(before), 'actual DOM batch');
  assert.equal(request.method, 'POST'); assert.equal(request.command.commandId, 'atlas.batch.execute'); assert.match(request.command.requestId, UUID);
  const response = await until(() => responses.find(row => row.id === request.id), 'batch completion'); assert.equal(response.status, 200);
  const receipt = await body(response); correlated(request.command, receipt, 'committed'); assert.match(receipt.operationId, UUID);
  assert.match(receipt.data.requestDigest, SHA); assert.equal(receipt.data.auditIds.length, request.command.payload.commands.length);
  assert.equal(receipt.data.records.length, request.command.payload.commands.length);
  for (const command of request.command.payload.commands) {
    assert.deepEqual(command.context, scope); assert.match(command.requestId, UUID); assert.match(command.idempotencyKey, UUID);
    const record = receipt.data.records.find(record => record.target.recordId === command.target.recordId);
    assert(record); assert.deepEqual(record.target, command.target); assert.deepEqual(record.payload, command.payload);
    assert.equal(record.lifecycle, 'active'); assert.equal(record.revision, command.preconditions.target ? command.preconditions.target.value + 1 : 1); known.set(record.target.recordId, record);
  }
  for (const id of receipt.data.auditIds) assert.match(id, UUID);
  batches.push({ phase, request: request.command, receipt }); return { request: request.command, receipt };
}
async function createPlace(kind, name, buildingId = null) {
  await click(`Array.from(document.querySelectorAll('.topology-scope > button')).find(button=>button.textContent.trim()==='Add Atlas place')`, 'Add Atlas place');
  await until(async () => evaluate(`!!${addSection}`), 'creation form');
  await option(`(${addSection}).querySelector('select[name="kind"]')`, kind, 'Classification');
  await enter(`(${addSection}).querySelector('input[name="label"]')`, name, 'Atlas name');
  if (buildingId) await option(`(${addSection}).querySelector('select[name="building"]')`, buildingId, 'Reviewed building membership');
  await enter(`(${addSection}).querySelector('textarea[name="statement"]')`, `I report ${name} as a synthetic ${kind}${buildingId ? ' in Alpha building' : ''}; physical elevation and access are not supplied.`, 'Human statement');
  await enter(`(${addSection}).querySelector('input[name="reason"]')`, 'Successful local native naming rehearsal', 'Reason');
  const batch = await submit(addSection, 'Create Atlas place'); assert.equal(batch.request.payload.commands.length, buildingId ? 4 : 3);
  const identity = batch.receipt.data.records.find(record => record.target.recordType === 'identity'), semantics = batch.receipt.data.records.find(record => record.target.recordType === 'location-semantics');
  assert(identity && semantics); assert.equal(semantics.payload.atlasId, identity.target.recordId); assert.equal(semantics.payload.label, name);
  assert.equal(semantics.payload.semanticKind, kind); assert.equal(semantics.payload.reviewStatus, 'accepted');
  await labelVisible(identity.target.recordId, name); return { identityId: identity.target.recordId, semanticsId: semantics.target.recordId, batch };
}
async function renamePlace(place, name) {
  const previous = known.get(place.semanticsId);
  await click(byText(row(place.identityId), 'Edit Atlas name'), 'Edit Atlas name'); const section = editSection(place.identityId);
  await until(async () => evaluate(`!!(${section})?.querySelector('form') && (${section}).getAttribute('aria-busy')==='false'`), 'current guarded edit form');
  if (name === null) await click(`(${section}).querySelector('input[name="remove"]')`, 'Remove Atlas name');
  else await enter(`(${section}).querySelector('input[name="label"]')`, name, 'Atlas name');
  await enter(`(${section}).querySelector('textarea[name="statement"]')`, name === null ? 'I remove this synthetic Atlas label; reviewed room and building membership remain.' : `I report ${name} as the corrected synthetic room name; membership remains.`, 'Human correction');
  await enter(`(${section}).querySelector('input[name="reason"]')`, 'Successful local native label correction', 'Reason');
  const batch = await submit(section, 'Save Atlas name'); assert.equal(batch.request.payload.commands.length, 2);
  const changed = known.get(place.semanticsId), { label: oldLabel, evidenceIds: oldEvidence, ...oldFields } = previous.payload;
  const { label: nextLabel, evidenceIds: nextEvidence, ...nextFields } = changed.payload;
  assert.deepEqual(nextFields, oldFields, 'Full nonlabel payload preserved'); assert.deepEqual(nextEvidence.slice(0, -1), oldEvidence);
  assert.equal(nextEvidence.length, oldEvidence.length + 1); assert.equal(changed.revision, previous.revision + 1);
  if (name === null) assert.equal(Object.hasOwn(changed.payload, 'label'), false, 'Clear by omission'); else assert.equal(nextLabel, name);
  await labelVisible(place.identityId, name ?? 'Unnamed Atlas location'); return batch;
}
async function saved() {
  const result = [];
  for (const record of [...known.values()].sort((a, b) => a.target.recordId.localeCompare(b.target.recordId))) {
    const kind = record.target.recordType, id = record.target.recordId;
    const got = await read(kind, 'get', id); assert.deepEqual(got.data.records, [record]);
    const history = await read(kind, 'history', id, { pageSize: 100, cursor: null, includeArchived: false });
    assert.equal(history.data.nextCursor, null); assert.equal(history.data.completeness, 'atlas-owned-audit'); assert.equal(history.data.entries.length, record.revision);
    for (const entry of history.data.entries) { assert.equal(entry.actorId, actorId); assert.equal(entry.state, 'committed'); assert.deepEqual(entry.target, record.target); assert.match(entry.eventId, UUID); assert.match(entry.requestDigest, SHA); }
    result.push({ record, history: history.data });
  }
  assert.deepEqual(result.flatMap(row => row.history.entries.map(entry => entry.eventId)).sort(), batches.flatMap(batch => batch.receipt.data.auditIds).sort(), 'Every batch audit retained in native history');
  return result;
}

let report = null, failure = null, failurePhase = null, cleanupFailure = null;
const budget = setTimeout(() => { timedOut = true; cdp?.rejectPending(); for (const process of owned) if (!isStopped(process)) process.kill('SIGTERM'); }, hardLimitMs - 60000);
try {
  await unusedPort();
  const certificate = spawnSync(selection.openssl.path, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { timeout: 30000, maxBuffer: 65536, stdio: ['ignore', 'ignore', 'ignore'] });
  assert.equal(certificate.status, 0, 'Synthetic loopback certificate'); chmodSync(key, 0o600);
  const config = { schemaVersion: 1, deploymentId: U(1), dataDirectory: data, logDirectory: join(data, 'logs'), frontendDirectory: frontend.directory,
    tlsCertificate: cert, tlsPrivateKey: key, listen: '127.0.0.1:48743', origin, homes: [{ ...scope, label: 'Synthetic home' }], mcpCommands: 'read-only',
    authentication: { mode: 'loopback-local', identity: { userId: U(4), actorId, username: 'synthetic-local', scope } } };
  writeFileSync(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  currentConfiguration = config; originalConfigurationBytes = selected(configPath, 65536, true);
  configurations.push({ label: 'candidate-original', frontendDirectory: frontend.directory, configurationSha256: hashBytes(originalConfigurationBytes) });
  const initialization = child(candidate.path, ['initialize', '--server-config', configPath]); initialization.stdout.resume(); initialization.stderr.resume();
  await until(() => isStopped(initialization), 'fresh offline initialization'); assert.equal(initialization.exitCode, 0);
  const initialPhysical = physical(), initialAtlas = census(join(data, 'atlas.sqlite'));
  assert.equal(initialAtlas.data.records.length, 0); assert.equal(initialAtlas.data.sources.length, 0); assert.equal(initialAtlas.data.network_relations.length, 0);
  const initialAccess = census(join(data, 'access.sqlite'), ['access_meta', 'access_users', 'access_memberships', 'access_sources']);
  assert.equal(initialAccess.data.access_users.length, 1); assert.equal(initialAccess.data.access_memberships.length, 1); assert.equal(initialAccess.data.access_sources.length, 0);
  await start(candidate, 'candidate-initial', frontend);
  browser = child(chromium.path, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion', {}, null); assert.equal(version.product, chromium.version);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Network.enable', { maxPostDataSize: 65536 }); await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin }); await click(byText('document', 'Open Home'), 'Native local sign-in'); await readyRooms(true);
  assert.equal(requests.filter(row => row.path === '/api/atlas/auth/local' && row.method === 'POST').length, 1);
  await until(async () => evaluate("document.querySelector('.topology-scope > p[role=status]')?.textContent==='No reviewed buildings in this home.'"), 'empty current topology');
  phase = 'create-building'; const building = await createPlace('building', 'Alpha building');
  phase = 'create-room'; const roomPlace = await createPlace('room', 'Alpha room', building.identityId);
  const membership = roomPlace.batch.receipt.data.records.find(record => record.target.recordType === 'relation');
  assert(membership); assert.equal(membership.payload.from.ref.recordId, building.identityId); assert.equal(membership.payload.to.ref.recordId, roomPlace.identityId); assert.equal(membership.payload.reviewStatus, 'accepted');
  phase = 'rename-room'; await renamePlace(roomPlace, 'Reviewed Alpha room');
  phase = 'clear-room-name'; await renamePlace(roomPlace, null);
  phase = 'rename-room-again'; await renamePlace(roomPlace, 'Beta room');
  assert.equal(batches.length, 5); assert.equal(batches.reduce((count, batch) => count + batch.receipt.data.auditIds.length, 0), 13); assert.equal(known.size, 10);
  assert.equal(new Set(batches.map(batch => batch.request.requestId)).size, 5);
  await selectBuilding(building.identityId);
  await labelVisible(roomPlace.identityId, 'Beta room'); await capture('candidate-named-building');
  const expectedSaved = await saved(); assert.deepEqual(known.get(membership.target.recordId), membership);
  await stop(service, 'SIGTERM', true); service = null;
  const beforeFallback = census(join(data, 'atlas.sqlite')), accessBeforeFallback = census(join(data, 'access.sqlite'), ['access_meta', 'access_users', 'access_memberships', 'access_sources']);
  assert.deepEqual(physical(), initialPhysical, 'Original receipt and physical files retained'); assert.deepEqual(selected(configPath, 65536, true), originalConfigurationBytes); assert.deepEqual(accessBeforeFallback, initialAccess, 'No new identity, epoch, membership or source authority');
  assert.equal(beforeFallback.data.sources.length, 0); assert.equal(beforeFallback.data.network_relations.length, 0);
  selectFrontend(fallbackFrontend, 'compatible-fallback');
  await start(fallback, 'compatible-fallback', fallbackFrontend); await send('Page.reload'); await readyRooms(false); await selectBuilding(building.identityId);
  await labelVisible(building.identityId, 'Alpha building'); await labelVisible(roomPlace.identityId, 'Beta room');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.topology-scope button')).some(button=>['Add Atlas place','Edit Atlas name'].includes(button.textContent.trim()))"), false, 'Reviewed fallback genuinely omits the new naming editor');
  assert.deepEqual(await saved(), expectedSaved, 'Compatible fallback serves every record and complete audit history'); await capture('compatible-fallback-named-rooms');
  await stop(service, 'SIGTERM', true); service = null;
  assert.deepEqual(census(join(data, 'atlas.sqlite')), beforeFallback, 'All Atlas tables, payload text, audits, receipts, journals and cursor rows preserved');
  assert.deepEqual(census(join(data, 'access.sqlite'), ['access_meta', 'access_users', 'access_memberships', 'access_sources']), accessBeforeFallback); assert.deepEqual(physical(), initialPhysical);
  selectFrontend(frontend, 'candidate-restored'); assert.deepEqual(selected(configPath, 65536, true), originalConfigurationBytes, 'Exact original candidate configuration restored');
  await start(candidate, 'candidate-restored', frontend); await send('Page.reload'); await readyRooms(true); await labelVisible(roomPlace.identityId, 'Beta room');
  assert.deepEqual(await saved(), expectedSaved, 'Candidate restored on same saved data');
  assert.equal(requests.filter(row => row.path.endsWith('/commands')).length, 5, 'No batch resubmission'); assert.equal(runtimeErrors.length, 0);
  const finalAtlas = census(join(data, 'atlas.sqlite')); assert.deepEqual(finalAtlas, beforeFallback); assert.equal(finalAtlas.data.records.length, 10); assert.equal(finalAtlas.data.audits.length, 13);
  report = { status: 'passed', source, origin, scope, actorId, counts: { batches: 5, auditedRecordChanges: 13, savedRecords: 10 }, building, room: roomPlace, membership,
    batches, saved: expectedSaved, readProofs, requests, responses, inputEvidence, screenshots: captures, physical: initialPhysical, configurations, startupChecks,
    savedAtlasSha256: hashBytes(JSON.stringify(finalAtlas)), accessIdentitySha256: hashBytes(JSON.stringify(initialAccess)),
    qualification: 'Successful real React/native TLS/persistent SQLite naming with native-issued Editor: empty no-source state, building, reviewed room membership, rename, clear by omission, rename again. Distinct reviewed label-compatible fallback binary AND its own frontend read saved names/membership/history without the new editing form. Only frontendDirectory changes while backend stopped; same v2 receipt, auth/home/MCP/listener and DB inodes with exact complete Atlas logical preservation; exact candidate configuration/frontend/code returns. No old3016 post-label rollback, receipt migration, DB restore, live NAS, provider/source admission, new grants, failure/control/security or actual-user acceptance.' };
} catch (error) { failure = error; failurePhase = phase; }
finally {
  phase = 'cleanup';
  try {
    if (cdp && !isStopped(browser)) await cdp.send('Browser.close', {}, null).catch(() => {});
    await stop(browser);
    for (const process of [...owned].reverse()) await stop(process, 'SIGTERM', process !== browser && !failure);
  } catch (error) { cleanupFailure = error; }
  finally {
    clearTimeout(budget); cdp?.rejectPending();
    if (owned.every(isStopped)) {
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
      catch (error) { cleanupFailure ??= error; }
    }
  }
}
const cleanup = { processes: owned.map(process => ({ pid: process.pid ?? null, exitCode: process.exitCode, signalCode: process.signalCode, stopped: isStopped(process) })),
  scratchRemoved: !existsSync(scratch), elapsedMs: Date.now() - beganAt, hardLimitMs };
if (!failure && !cleanupFailure) {
  try { assert(!timedOut && cleanup.elapsedMs < hardLimitMs); assert(owned.every(isStopped)); assert(cleanup.scratchRemoved); }
  catch (error) { failure = error; failurePhase = 'post-cleanup'; }
}
if (failure || cleanupFailure) report = { status: 'failed', source, phase: failurePhase ?? 'cleanup',
  error: 'Native naming qualification failed; named phase and counters retained without authentication/evaluation payload logging.',
  counters: { batches: batches.length, nativeCommandPosts: requests.filter(row => row.path.endsWith('/commands')).length, runtimeExceptions: runtimeErrors.length, inputActions: inputEvidence.length }, cleanup };
else report.cleanup = cleanup;
writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: report.status, phase: report.phase ?? 'complete', counts: report.counts ?? report.counters, resultPath: join(output, 'result.json'),
  resultSha256: hashBytes(readFileSync(join(output, 'result.json'))), cleanup }, null, 2));
if (failure || cleanupFailure) process.exitCode = 1;
