// One positive read slice with the actual compiled Rust and React app.
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
const observedUrls = [], responses = [], runtimeErrors = [];
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
        } else if (message.method === 'Network.requestWillBeSent') observedUrls.push(message.params.request.url);
        else if (message.method === 'Network.responseReceived') responses.push({ url: message.params.response.url, status: message.params.response.status });
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
  const { origin, cookie } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Browser receives the actual issued Secure cookie');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, 'Healthy browser evaluation'); return result.result.value;
  };
  await send('Page.navigate', { url: origin });
  try {
    await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'React authorized home rendering');
  } catch (error) {
    console.error(JSON.stringify({healthyBootstrapResponses: responses, runtimeErrors, renderedText: await evaluate('document.body?.innerText ?? ""'), healthyView: await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))")}));
    throw error;
  }
  const api = await evaluate("(async () => { const results=[]; for (const path of ['/api/atlas/view','/api/atlas/rooms','/api/atlas/items','/api/atlas/homes','/api/atlas/auth/session']) { const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error'}); results.push({path,status:response.status,cache:response.headers.get('cache-control'),body:await response.json()}); } return results; })()");
  assert(api.every(r => r.status === 200 && r.cache === 'no-store'), 'Actual authorized API GETs');
  const view = api[0].body;
  assert.equal(view.status, 'ready'); assert.equal(view.entries.length, 2); assert.equal(view.canEdit, false);
  assert.equal(api[1].body.length, 1); assert.equal(api[2].body.length, 1);
  assert.equal(api[3].body.length, 1); assert.equal(Object.keys(api[3].body[0]).length, 3);
  assert.equal(api[4].body.schemaVersion, 1); assert.equal(typeof api[4].body.expiresAt, 'string');
  const room = view.entries.find(e => e.semanticKind === 'room'), item = view.entries.find(e => e.kind === 'item');
  assert(room && item, 'Explicit reviewed room and actual saved item');
  assert.equal(item.entity.parent, null); assert.equal(item.mobility, 'unknown');
  assert(view.entries.every(e => e.nativeLinks.length === 0 && e.networkRelations.length === 0), 'No unissued capabilities');
  assert(item.attachments.filter(a => a.kind === 'stored-file').every(a => a.downloadHref === null && a.previewHref === null));
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
  const sql = [
    'import sqlite3,json,sys', 'from pathlib import Path', 'root=Path(sys.argv[1])',
    'def count(db,table):',
    " c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)",
    " try: return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]",
    ' finally: c.close()',
    "print(json.dumps({'records':count(root/'atlas.sqlite','records'),'projections':count(root/'atlas.sqlite','projections'),'audits':count(root/'atlas.sqlite','audits'),'sessions':count(root/'access.sqlite','access_sessions')}))"
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, data], { encoding: 'utf8' });
  assert.equal(rows.status, 0); assert.deepEqual(JSON.parse(rows.stdout), {records:6,projections:2,audits:0,sessions:1});
  const evidence = { rust:serviceOutput.trim(), browser:version.product, apiReads:api.map(({path,status})=>({path,status})), scopedRead:result.status, rooms:1, items:1, persisted:JSON.parse(rows.stdout), observedRequests:observedUrls.length, scope:'Actual Rust/SQLite/access/domain/React positive loopback TLS reads. Stopped controls and external providers remain unrun.' };
  if (process.env.HOUSEATLAS_EVIDENCE) writeFileSync(process.env.HOUSEATLAS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (cdp && browser?.exitCode === null) await cdp.send('Browser.close').catch(() => {});
  if (service?.exitCode === null) {
    service.kill('SIGINT');
    await until(() => service.exitCode !== null, 'graceful Rust shutdown', 10000);
    assert.equal(service.exitCode, 0, 'Graceful ordinary shutdown');
  }
  rmSync(scratch, { recursive: true, force: true });
}
