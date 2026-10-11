// Positive real native building membership, source-bound room and explicit saved Network UI.
// Six fresh local creates only. No provider, injected client results, replay or held control.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.version, 'v26.10.0');
assert.equal(process.env.SOURCE_SHA, '7e450a12037a4be19b2fa0553a6cde3e08b3cdcf', 'Approved unchanged production source pin');
assert(!process.env.HOUSEATLAS_FIXTURE_PROFILE || process.env.HOUSEATLAS_FIXTURE_PROFILE === 'standard', 'Original standard disposable fixture only');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the exact compiled HOUSEATLAS_BINARY with Root build provenance');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Supply the inspected Chrome executable explicitly');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const source = { productionHead: process.env.SOURCE_SHA, binarySha256: hash(binary),
  frontendIndexSha256: hash(join(root, 'frontend/dist/index.html')),
  scriptSha256: hash(fileURLToPath(import.meta.url)), manifestSha256: hash(join(root, 'docs/publication/source-manifest.json')) };
const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { workspaceId: U(1), homeId: U(2) };
// Original proposed source envelopes, unchanged. Only the supported HTTP route is /commands.
const commands = [{"schemaVersion":3,"commandId":"atlas.identity.create","requestId":"00000000-0000-4000-8000-000000009801","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009701"},"payload":{"kind":"location","evidenceIds":["00000000-0000-4000-8000-000000000100"]},"idempotencyKey":"00000000-0000-4000-8000-000000009901","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null},{"schemaVersion":3,"commandId":"atlas.identity.create","requestId":"00000000-0000-4000-8000-000000009802","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"},"payload":{"kind":"location","evidenceIds":["00000000-0000-4000-8000-000000000100"]},"idempotencyKey":"00000000-0000-4000-8000-000000009902","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null},{"schemaVersion":3,"commandId":"atlas.location-semantics.create","requestId":"00000000-0000-4000-8000-000000009803","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"location-semantics","recordId":"00000000-0000-4000-8000-000000009711"},"payload":{"atlasId":"00000000-0000-4000-8000-000000009701","semanticKind":"building","reviewStatus":"accepted","evidenceIds":["00000000-0000-4000-8000-000000000100"]},"idempotencyKey":"00000000-0000-4000-8000-000000009903","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009701"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null},{"schemaVersion":3,"commandId":"atlas.location-semantics.create","requestId":"00000000-0000-4000-8000-000000009804","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"location-semantics","recordId":"00000000-0000-4000-8000-000000009712"},"payload":{"atlasId":"00000000-0000-4000-8000-000000009702","semanticKind":"floor","reviewStatus":"accepted","evidenceIds":["00000000-0000-4000-8000-000000000100"],"elevation":{"status":"unknown"}},"idempotencyKey":"00000000-0000-4000-8000-000000009904","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null},{"schemaVersion":3,"commandId":"atlas.relation.create","requestId":"00000000-0000-4000-8000-000000009805","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"relation","recordId":"00000000-0000-4000-8000-000000009721"},"payload":{"kind":"location-membership","membershipKind":"building","from":{"kind":"atlas-record","ref":{"recordType":"identity","recordId":"00000000-0000-4000-8000-000000009701"}},"to":{"kind":"atlas-record","ref":{"recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"}},"reviewStatus":"accepted","uncertainty":{"status":"unknown","explanation":null},"evidenceIds":["00000000-0000-4000-8000-000000000100"]},"idempotencyKey":"00000000-0000-4000-8000-000000009905","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009701"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null},{"schemaVersion":3,"commandId":"atlas.relation.create","requestId":"00000000-0000-4000-8000-000000009806","context":{"workspaceId":"00000000-0000-4000-8000-000000000001","homeId":"00000000-0000-4000-8000-000000000002"},"target":{"authority":"atlas","recordType":"relation","recordId":"00000000-0000-4000-8000-000000009722"},"payload":{"kind":"location-membership","membershipKind":"level","from":{"kind":"atlas-record","ref":{"recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"}},"to":{"kind":"atlas-record","ref":{"recordType":"identity","recordId":"00000000-0000-4000-8000-000000000200"}},"reviewStatus":"accepted","uncertainty":{"status":"unknown","explanation":null},"evidenceIds":["00000000-0000-4000-8000-000000000100"]},"idempotencyKey":"00000000-0000-4000-8000-000000009906","reason":"Healthy disposable building UI qualification","preconditions":{"target":null,"guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":"00000000-0000-4000-8000-000000000100"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000009702"},"revision":{"kind":"atlas","value":1}},{"target":{"authority":"atlas","recordType":"identity","recordId":"00000000-0000-4000-8000-000000000200"},"revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null}];
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-building-ui-healthy-'));
const data = join(scratch, 'data'), cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const beganAt = Date.now(), hardLimitMs = 20 * 60 * 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, browser, cdp, serviceOutput = '', serviceError = '', timedOut = false, origin = null;
const requests = [], responses = [], runtimeErrors = [], inputEvidence = [], domEvidence = [], snapshots = [];
const completed = new Set();
let phase = 'startup';
async function until(check, label, ms = 20000, cleanup = false) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!cleanup && timedOut) throw new Error('Overall native UI budget exhausted');
    const value = await check(); if (value) return value;
    await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0);
  constructor(child) {
    this.child = child;
    child.stdio[4].on('data', bytes => {
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
          const request = message.params.request, url = new URL(request.url);
          // Never retain request headers, auth bodies, passwords, cookies or CSRF.
          const row = { id: message.params.requestId, phase, url: request.url, method: request.method };
          if (url.pathname.endsWith('/invoke')) row.command = JSON.parse(url.searchParams.get('request'));
          if (url.pathname.endsWith('/commands')) row.command = JSON.parse(request.postData);
          requests.push(row);
        } else if (message.method === 'Network.responseReceived') {
          const response = message.params.response;
          responses.push({ id: message.params.requestId, phase, url: response.url, status: response.status,
            snapshot: Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'x-atlas-snapshot-sha256')?.[1] ?? null });
        } else if (message.method === 'Network.loadingFinished') completed.add(message.params.requestId);
        else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      }
    });
    child.on('exit', () => this.rejectPending(new Error('Owned Chrome exited')));
    child.on('error', error => this.rejectPending(error));
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
// Reserve 60 seconds for owned cleanup within Root's hard 20-minute ceiling.
const budget = setTimeout(() => {
  timedOut = true; cdp?.rejectPending(new Error('Overall native UI budget exhausted'));
  browser?.kill('SIGTERM'); service?.kill('SIGINT');
}, hardLimitMs - 60000);
async function stopOwned(child, signal, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  try { await until(() => child.exitCode !== null || child.signalCode !== null, label, 8000, true); }
  catch {
    child.kill('SIGKILL');
    await until(() => child.exitCode !== null || child.signalCode !== null, label + ' final shutdown', 3000, true);
  }
}
let evidence, failure, failedPhase, cleanupFailure;
let privateValues = [];
const safeError = error => ({ name: error?.name ?? 'Error',
  message: privateValues.reduce((message, value) => message.replaceAll(value, '[redacted]'), String(error?.message ?? error)) });
try {
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(openssl.status, 0, 'Disposable loopback certificate creation');
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', bytes => { serviceOutput += bytes; }); service.stderr.on('data', bytes => { serviceError += bytes; });
  await until(() => {
    if (service.exitCode !== null || service.signalCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const issued = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  privateValues = [issued.cookie, issued.cookie?.slice(issued.cookie.indexOf('=') + 1), issued.login?.username, issued.login?.password, issued.editorLogin?.username, issued.editorLogin?.password].filter(value => typeof value === 'string' && value.length > 0);
  origin = issued.origin;
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  assert.equal(version.product, 'Chrome/154.0.8037.98', 'Exact inspected installed Chrome');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params, timeoutMs) => cdp.send(method, params, sessionId, timeoutMs);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const split = issued.cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: issued.cookie.slice(0, split), value: issued.cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Actual issued native viewer session cookie');
  const evaluate = async (expression, timeoutMs) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    assert(!result.exceptionDetails, 'Healthy browser evaluation');
    return result.result.value;
  };
  const nativeBody = async response => {
    await until(() => completed.has(response.id), 'native response body completion');
    const raw = await send('Network.getResponseBody', { requestId: response.id });
    return JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body);
  };
  const click = async (selector, label) => {
    const expression = `(() => { const button = ${selector}; if (!button || !button.getClientRects().length || button.disabled || button.getAttribute('aria-disabled') === 'true') return false; button.scrollIntoView({block:'center',behavior:'instant'}); return true; })()`;
    await until(async () => await evaluate(expression), 'visible ' + label);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const point = await evaluate(`(() => { const button = ${selector}; const rect = button.getBoundingClientRect(); const point = { x: rect.x + rect.width/2, y: rect.y + rect.height/2 }; const target = document.elementFromPoint(point.x,point.y); return { point, hit: target === button || button.contains(target), text: button.textContent.trim(), ariaLabel: button.getAttribute('aria-label') }; })()`);
    assert.equal(point.hit, true, 'Native mouse hit reaches ' + label);
    inputEvidence.push({ phase, action: label, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point.point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point.point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point.point, button: 'left', clickCount: 1 });
  };
  const nav = label => `Array.from(document.querySelectorAll('nav[aria-label="Sections"] button')).find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
  const capture = async label => {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await until(async () => await evaluate(`innerWidth === ${width}`), 'actual viewport');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      if (label === 'saved-network' && width === 390 && await evaluate("document.getElementById('detail-sheet-handle')?.getAttribute('aria-expanded') === 'true'")) {
        await click(`document.getElementById('detail-sheet-handle')`, 'Hide overview for narrow Network view');
        await until(async () => await evaluate("document.getElementById('detail-sheet-handle')?.getAttribute('aria-expanded') === 'false'"), 'overview sheet closed');
      }
      const animationWaitBegan = Date.now();
      const animationSettlement = await until(async () => await evaluate(`(() => {
        const all = document.getAnimations();
        const finite = all.filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
        if (finite.some(animation => animation.pending || animation.playState === 'running')) return false;
        return { finite: finite.map(animation => ({ playState: animation.playState, pending: animation.pending,
          endTime: animation.effect.getComputedTiming().endTime })), ignoredNonFinite: all.length - finite.length };
      })()`), 'finite UI animations settled before capture');
      animationSettlement.waitedMs = Date.now() - animationWaitBegan;
      const dom = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.querySelector('main#main h1')?.textContent,detail:document.getElementById('detail-title')?.textContent,bodyText:document.body.innerText,main:document.querySelector('main#main')?.outerHTML,details:document.querySelector('aside[aria-label="Details"]')?.outerHTML})`);
      assert(dom.scrollWidth <= width + 1, 'Actual UI fits viewport');
      domEvidence.push({ label, width, height, animationSettlement, ...dom });
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (process.env.HOUSEATLAS_SCREENSHOT_PREFIX) {
        const path = process.env.HOUSEATLAS_SCREENSHOT_PREFIX + '-' + label + '-' + width + '.png';
        writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
        snapshots.push({ label, width, height, path, sha256: hash(path) });
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  phase = 'original-view';
  await send('Page.navigate', { url: origin });
  await until(async () => await evaluate("document.querySelector('.house-name')?.textContent === 'Synthetic home'"), 'actual initial Home');
  await until(async () => await evaluate("document.querySelector('.topology-scope [role=status]')?.textContent === 'No reviewed buildings in this home.'"), 'initial actual topology reads settled before Editor login');
  const initial = await evaluate(`fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async response => ({status:response.status,body:await response.json()}))`);
  assert.equal(initial.status, 200); assert.equal(initial.body.status, 'ready'); assert.deepEqual(initial.body.scope, scope);
  assert.equal(initial.body.entries.length, 2);
  const room = initial.body.entries.find(entry => entry.kind === 'place' && entry.semanticKind === 'room');
  assert(room); assert.equal(room.entity.name, 'Synthetic cabinet');
  const prefix = '/api/atlas/stock/v3/workspaces/' + scope.workspaceId + '/homes/' + scope.homeId;
  phase = 'seed';
  const seeded = await evaluate(`(async () => {
    const commands=${JSON.stringify(commands)}, prefix=${JSON.stringify(prefix)}, scope=${JSON.stringify(scope)}, login=${JSON.stringify(issued.editorLogin)};
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const exchanges=[];
    const sameScope=value=>value?.workspaceId===scope.workspaceId && value?.homeId===scope.homeId;
    const call=async(path,body,csrf)=>{
      const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'content-type':'application/json',...(csrf?{'x-atlas-csrf':csrf}:{})}:{Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const value=await response.json(); exchanges.push({path,status:response.status});
      if(response.status!==200)throw new Error('Positive native seed exchange failed');
      return value;
    };
    // Genuine fixture-issued Editor login. Session/CSRF stay lexical and are never returned.
    const editor=await call('/api/atlas/auth/login',login);
    if(editor.actorId!==U(7))throw new Error('Actual issued Editor actor unavailable');
    const admission=await call(prefix+'/admission');
    if(admission.schemaVersion!==3||!sameScope(admission.scope))throw new Error('Actual scoped admission unavailable');
    for(const id of ['atlas.identity.create','atlas.location-semantics.create','atlas.relation.create'])
      if(!admission.commandIds.includes(id))throw new Error('Actual native create not admitted');
    const get=async(kind,id)=>{
      const wire=await call(prefix+'/records/'+kind+'/'+id);
      if(wire.status!=='read'||wire.commandId!=='atlas.'+kind+'.get'||wire.data.records.length!==1||!sameScope(wire.resolvedScope))throw new Error('Original canonical record read incompatible');
      return wire.data.records[0];
    };
    const before={evidence:await get('evidence',U(100)),room:await get('identity',U(200)),binding:await get('binding',U(300)),semantics:await get('location-semantics',U(400))};
    if(before.room.payload.kind!=='location'||before.binding.payload.atlasId!==U(200)||before.binding.payload.reviewStatus!=='accepted'||before.binding.payload.sourceState!=='present'||before.semantics.payload.atlasId!==U(200)||before.semantics.payload.semanticKind!=='room'||before.semantics.payload.reviewStatus!=='accepted')throw new Error('Original accepted bound room unavailable');
    for(const original of Object.values(before))if(original.revision!==1||original.lifecycle!=='active')throw new Error('Exact retained original preimage changed');
    const receipts=[],readbacks=[];
    for(const command of commands){
      for(const guard of command.preconditions.guards){
        const record=await get(guard.target.recordType,guard.target.recordId);
        if(record.revision!==guard.revision.value||record.lifecycle!=='active')throw new Error('Actual retained revision guard changed');
      }
      const session=await call('/api/atlas/auth/session');
      if(session.actorId!==editor.actorId||typeof session.csrfToken!=='string'||!session.csrfToken)throw new Error('Current issued session unavailable');
      const receipt=await call(prefix+'/commands',command,session.csrfToken);
      receipts.push(receipt);
      readbacks.push(await get(command.target.recordType,command.target.recordId));
    }
    const after={evidence:await get('evidence',U(100)),room:await get('identity',U(200)),binding:await get('binding',U(300)),semantics:await get('location-semantics',U(400))};
    return {actorId:editor.actorId,admission:{schemaVersion:admission.schemaVersion,scope:admission.scope,commandIds:admission.commandIds},commands,receipts,readbacks,before,after,exchanges};
  })()`, 120000);
  assert.deepEqual(seeded.commands, commands, 'Six complete original request envelopes');
  assert.deepEqual(seeded.before, seeded.after, 'Original evidence, room identity, binding and classification preserved');
  const reference = seeded.before.binding.payload.source;
  assert.deepEqual(room.source, reference, 'Original accepted binding joins the complete source key');
  assert.equal(room.workspaceId, scope.workspaceId); assert.equal(room.homeId, scope.homeId);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const [index, receipt] of seeded.receipts.entries()) {
    const command = commands[index], record = seeded.readbacks[index];
    assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.commandId, command.commandId); assert.equal(receipt.requestId, command.requestId);
    assert.deepEqual(receipt.resolvedScope, scope); assert.equal(receipt.status, 'committed'); assert.equal(receipt.replayed, false);
    assert.match(receipt.operationId, UUID); assert.match(receipt.data.requestDigest, /^[0-9a-f]{64}$/);
    assert.equal(receipt.data.auditIds.length, 1); assert.match(receipt.data.auditIds[0], UUID);
    assert.deepEqual(receipt.data.records, [record], 'Native receipt equals authorized canonical readback');
    assert.deepEqual(record.target, command.target); assert.equal(record.revision, 1); assert.equal(record.lifecycle, 'active');
    assert.deepEqual(record.payload, command.payload, 'Native canonical producer retains complete intended payload');
  }
  const commandRequests = requests.filter(row => new URL(row.url).pathname.endsWith('/commands'));
  assert.equal(commandRequests.length, 6, 'Each fresh command submitted exactly once');
  assert.deepEqual(commandRequests.map(row => row.command), commands);
  assert.equal(new Set(seeded.receipts.map(receipt => receipt.operationId)).size, 6);
  // All writes finish before a fresh real React session/view/frame; no shared state is injected.
  phase = 'current-ui';
  const uiResponseStart = responses.length;
  await send('Page.reload');
  await until(async () => await evaluate("document.querySelector('.house-name')?.textContent === 'Synthetic home' && document.querySelector('nav[aria-label=\"Sections\"] button[aria-current=page]')?.textContent.trim() === 'Atlas'"), 'fresh actual Home');
  const homeText = await evaluate("document.querySelector('main#main')?.innerText ?? ''");
  assert(homeText.includes('Synthetic home: no reviewed shape projection'));
  assert(homeText.includes('Plan, 3D and measured positions require reviewed geometry.'));
  await click(nav('Rooms & places'), 'Rooms & places navigation');
  await until(async () => await evaluate("document.querySelector('main#main h1')?.textContent === 'Rooms & places'"), 'actual Rooms view');
  const buildingSelector = `document.querySelector('.topology-scope [role="group"][aria-label="Building"] button[title="${U(9701)}"]')`;
  await click(buildingSelector, 'original unnamed building chip');
  await until(async () => await evaluate(`Boolean(document.querySelector('.topology-scope [role="status"]')?.textContent.endsWith(': 2 locations in reviewed membership') && document.querySelector('.topology-building'))`), 'actual selected native building membership');
  const selected = await evaluate(`({label:document.querySelector('.topology-building h2')?.textContent,status:document.querySelector('.topology-scope [role="status"]')?.textContent,pressed:${buildingSelector}?.getAttribute('aria-pressed'),levels:document.querySelectorAll('.topology-level').length,glyph:document.querySelector('.topology-level .topology-glyph')?.textContent,levelText:document.querySelector('.topology-level')?.innerText})`);
  assert.equal(selected.pressed, 'true'); assert.equal(selected.levels, 1); assert.equal(selected.glyph, '?');
  assert(selected.label.startsWith('Unnamed Atlas location'));
  assert(selected.levelText.includes('Elevation recorded as unknown')); assert(selected.levelText.includes(room.entity.name));
  await capture('selected-building');
  const roomSelector = `Array.from(document.querySelectorAll('.topology-level button.topology-row')).find(button => button.getAttribute('aria-label') === ${JSON.stringify(room.entity.name + ', Atlas identity ' + U(200))})`;
  await click(roomSelector, 'original source-bound room');
  await until(async () => await evaluate(`Boolean(document.getElementById('detail-title')?.textContent === ${JSON.stringify(room.entity.name)} && document.querySelector('.source-details'))`), 'actual room detail');
  assert.equal(await evaluate("document.activeElement?.id"), 'detail-title', 'Original detail focus behavior');
  const sourceFacts = await evaluate(`Object.fromEntries(Array.from(document.querySelector('.source-details dl.facts').children).map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]))`);
  assert.equal(sourceFacts.Classification, 'room'); assert.equal(sourceFacts['Source identifier'], reference.externalId);
  assert.equal(sourceFacts['Source instance'], reference.sourceInstanceId); assert.equal(sourceFacts.Collection, reference.collectionId);
  assert((await evaluate("document.querySelector('.source-details')?.innerText")).includes('Source hierarchy does not establish physical placement.'));
  await capture('source-bound-room');
  await click(`document.querySelector('button[aria-label="Close details"]')`, 'Close details');
  await until(async () => await evaluate("!document.getElementById('detail-title')"), 'detail selection closed');
  const networkPath = '/api/atlas/v1/workspaces/' + scope.workspaceId + '/homes/' + scope.homeId + '/network/relations';
  assert.equal(requests.filter(row => new URL(row.url).pathname === networkPath).length, 0, 'No automatic saved Network read');
  await click(nav('Network'), 'Network navigation');
  await until(async () => await evaluate("document.querySelector('main#main h1')?.textContent === 'Network'"), 'actual Network view');
  assert.equal(requests.filter(row => new URL(row.url).pathname === networkPath).length, 0, 'Network mount does not collect or load');
  await click(`Array.from(document.querySelectorAll('section[aria-labelledby="network-relations-heading"] button')).find(button=>button.textContent.trim()==='Load Network relations')`, 'Load Network relations');
  await until(async () => await evaluate(`document.querySelector('section[aria-labelledby="network-relations-heading"] [role="status"]')?.textContent==='No Network relations saved for this home.'`), 'actual saved empty Network result');
  await capture('saved-network');
  const networkResponses = responses.filter(row => new URL(row.url).pathname === networkPath);
  assert.equal(networkResponses.length, 1, 'One explicit actual Network read'); assert.equal(networkResponses[0].status, 200);
  const network = await nativeBody(networkResponses[0]);
  assert.equal(network.contractVersion, '1.0.0'); assert.deepEqual(network.items, []); assert.equal(network.nextCursor, null);
  assert(Array.isArray(network.sourceStatuses));
  const topologyResponses = responses.slice(uiResponseStart).filter(row => new URL(row.url).pathname === prefix + '/invoke');
  const topology = [];
  for (const response of topologyResponses) {
    assert.equal(response.status, 200);
    const request = requests.find(row => row.id === response.id)?.command, wire = await nativeBody(response);
    assert(request, 'Actual production client canonical request recorded');
    assert.equal(wire.schemaVersion, 3); assert.equal(wire.requestId, request.requestId); assert.equal(wire.commandId, request.commandId);
    assert.deepEqual(wire.resolvedScope, scope); assert.deepEqual(request.context, scope);
    assert.equal(wire.status, 'read'); assert.equal(wire.replayed, false); assert.equal(wire.data.sourceStatus, 'current');
    assert.equal(wire.data.nextCursor, null); assert.match(response.snapshot, /^[0-9a-f]{64}$/);
    topology.push({request,wire,snapshot:response.snapshot});
  }
  assert(topology.length >= 5, 'Actual production R1–R4 plus selected R5 results');
  assert(topology.every(row => row.snapshot === topology[0].snapshot), 'One retained content identity across actual current UI topology reads');
  const expectedCounts = {'atlas.identity.list':4,'atlas.binding.list':2,'atlas.location-semantics.list':3,'atlas.relation.list':2};
  for(const [commandId,count] of Object.entries(expectedCounts)) {
    const rows=topology.filter(row=>row.request.commandId===commandId && !row.request.payload.buildingId);
    assert(rows.length>=1, 'Actual '+commandId+' production read');
    assert(rows.every(row=>row.wire.data.records.length===count));
  }
  const memberReads=topology.filter(row=>row.request.payload.buildingId===U(9701));
  assert.equal(memberReads.length,1,'One real selected-building R5 result');
  assert.deepEqual(memberReads[0].wire.data.records.map(record=>record.target.recordId).sort(),[U(200),U(9701),U(9702)].sort());
  const originalBinding=topology.find(row=>row.request.commandId==='atlas.binding.list').wire.data.records.find(record=>record.target.recordId===U(300));
  assert.deepEqual(originalBinding,seeded.before.binding,'Native UI frame keeps original complete binding');
  assert.equal(runtimeErrors.length,0,'No healthy actual application runtime exception');
  assert(requests.every(row=>row.url.startsWith(origin+'/')), 'Every observed application request remains same-origin loopback');
  assert(responses.every(row=>row.status===200 || (row.status===204 && row.url===origin+'/favicon.ico')), 'Healthy actual application responses');
  evidence={source,browser:version.product,origin,scope,homeText,seed:seeded,selected,sourceFacts,topology,network,
    requests:requests.map(({url,...row})=>({...row,path:new URL(url).pathname,...(new URL(url).search?{query:new URL(url).search}: {})})),
    responses:responses.map(({url,...row})=>({...row,path:new URL(url).pathname})),inputEvidence,domEvidence,screenshots:snapshots,
    qualification:'Real compiled React and native TLS/SQLite/current issued Editor session. Six fresh local canonical stock creates, actual matched R1–R5, source-bound room selection and one explicit saved empty Network read. Original source dates, unknown elevation and source/physical placement distinctions retained. No populated Network, actual household, provider, import, recovery, security, operator or deployment acceptance.'};
} catch (error) {
  failure = error; failedPhase = phase;
} finally {
  phase='cleanup';
  try {
    try {
      if(cdp && browser?.exitCode===null && browser?.signalCode===null)
        await cdp.send('Browser.close').catch(()=>{});
      await stopOwned(browser,'SIGTERM','owned Chromium shutdown');
    } finally {
      try { await stopOwned(service,'SIGINT','owned native service shutdown'); }
      finally {
        clearTimeout(budget);
        if((!browser || browser.exitCode!==null || browser.signalCode!==null) && (!service || service.exitCode!==null || service.signalCode!==null))
          rmSync(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
      }
    }
  } catch (error) { cleanupFailure = error; }
}
const cleanup = { ownedBrowserPid: browser?.pid ?? null, ownedNativePid: service?.pid ?? null,
  browserExit: browser?.exitCode ?? null, browserSignal: browser?.signalCode ?? null,
  nativeExit: service?.exitCode ?? null, nativeSignal: service?.signalCode ?? null,
  browserStopped: !browser || browser.exitCode !== null || browser.signalCode !== null,
  serviceStopped: !service || service.exitCode !== null || service.signalCode !== null,
  scratchRemoved: !existsSync(scratch), elapsedMs: Date.now()-beganAt, hardLimitMs };
if (!failure && !cleanupFailure) {
  try {
    assert(!timedOut && Date.now()-beganAt < hardLimitMs,'Entire owned run including cleanup stays below 20 minutes');
    assert.equal(service.exitCode,0,'Native service graceful shutdown');
    assert(!existsSync(scratch),'Owned browser/service stopped before disposable fixture cleanup');
  } catch (error) { failure = error; failedPhase = 'post-cleanup-assertions'; }
}
if (failure || cleanupFailure) {
  const report = { status: 'failed', source, failedPhase: failedPhase ?? 'cleanup',
    error: safeError(failure ?? cleanupFailure), ...(failure && cleanupFailure ? { cleanupError: safeError(cleanupFailure) } : {}),
    lastInputAction: inputEvidence.at(-1)?.action ?? null,
    counters: { requests: requests.length, responses: responses.length, nativeCommandRequests: requests.filter(row => new URL(row.url).pathname.endsWith('/commands')).length,
      mouseActions: inputEvidence.length, domCaptures: domEvidence.length, screenshots: snapshots.length, runtimeExceptions: runtimeErrors.length }, cleanup };
  // No raw evaluation expression, params, exceptionDetails, auth body or headers.
  const text = JSON.stringify(report,null,2);
  console.error(text);
  if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,text+'\n');
  throw new Error(safeError(failure ?? cleanupFailure).message);
}
evidence.cleanup=cleanup;
if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
