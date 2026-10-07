// Healthy actual browser WebMCP registration and correlated native stock read.
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
  const { origin, cookie, editorLogin } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  // Both inspected release IDLs take DOMString input_arguments. A browser
  // version change requires source inspection before this ordinary flow runs.
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97'].includes(version.product), 'Inspected native WebMCP browser version');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
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
  await send('Page.navigate', { url: origin });
  try {
    await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'React authorized home rendering');
  } catch (error) {
    console.error(JSON.stringify({healthyBootstrapResponses: responses, runtimeErrors, renderedText: await evaluate('document.body?.innerText ?? ""'), healthyView: await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))")}));
    throw error;
  }
  const bootstrap = await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(bootstrap.status,200);
  const view=bootstrap.body;
  const native=await evaluate("({modelContext:typeof document.modelContext,registerTool:typeof document.modelContext?.registerTool,getTools:typeof document.modelContext?.getTools,executeTool:typeof document.modelContext?.executeTool})");
  console.log(JSON.stringify({nativeWebMcp:native}));
  assert.equal(native.registerTool,'function','Actual document WebMCP registration exists');
  assert.equal(native.getTools,'function','Actual document WebMCP discovery exists');
  const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  // The inspected Chromium 151/154 IDLs take DOMString input arguments. Supply the
  // complete JSON request through that native API without a modelContext shim.
  const invoke=async(request)=>evaluate(`(async()=>{const tools=await document.modelContext.getTools();const tool=tools.find(t=>t.name==='atlas_records');if(!tool)throw new Error('Actual atlas_records registration missing');const value=await document.modelContext.executeTool(tool,${JSON.stringify(JSON.stringify(request))});const wire=typeof value==='string'?JSON.parse(value):value;return {wire,visible:document.querySelector('.stock-completion pre')?.textContent,tools:tools.map(t=>t.name)};})()`);
  await until(async()=> (await evaluate("document.modelContext.getTools().then(t=>t.some(x=>x.name==='atlas_records'))")), 'Real admitted stock registration');
  const read={schemaVersion:3,commandId:'atlas.identity.get',requestId:U(1600),context:view.scope,target:{authority:'atlas',recordType:'identity',recordId:U(200)},payload:{}};
  const first=await invoke(read);
  assert.equal(first.wire.requestId,read.requestId);assert.equal(first.wire.commandId,read.commandId);assert.equal(first.wire.status,'read');
  assert.deepEqual(JSON.parse(first.visible),first.wire,'Canonical result already committed to React when native tool returns');
  await evaluate("location.hash='#settings'");
  await until(async()=> (await evaluate('document.body?.innerText ?? ""')).includes('Sign out'),'Actual session Settings');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()");
  await until(async()=>await evaluate("Boolean(document.getElementById('atlas-username'))"),'Ordinary successful logout form');
  await evaluate(`document.getElementById('atlas-username').value=${JSON.stringify(editorLogin.username)};document.getElementById('atlas-password').value=${JSON.stringify(editorLogin.password)};document.querySelector('.session-form').requestSubmit()`);
  await until(async()=> (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'),'Actual editor React session');
  await until(async()=> (await evaluate("document.modelContext.getTools().then(t=>t.some(x=>x.name==='atlas_records'))")), 'Actual editor registration');
  const createdRequest={schemaVersion:3,commandId:'atlas.circuit.create',requestId:U(1601),context:view.scope,target:{authority:'atlas',recordType:'circuit',recordId:U(960)},payload:{label:null,panel:null,evidenceIds:[U(100)]},idempotencyKey:U(1602),reason:'Healthy disposable agent circuit',preconditions:{target:null,guards:[{target:{authority:'atlas',recordType:'evidence',recordId:U(100)},revision:{kind:'atlas',value:1}}]},approvalReceiptId:null};
  const created=await invoke(createdRequest);
  assert.equal(created.wire.status,'committed');assert.equal(created.wire.replayed,false);assert.equal(created.wire.requestId,createdRequest.requestId);
  assert.deepEqual(JSON.parse(created.visible),created.wire,'Actual native stock receipt displayed before tool return');
  const get={schemaVersion:3,commandId:'atlas.circuit.get',requestId:U(1603),context:view.scope,target:createdRequest.target,payload:{}};
  const record=await invoke(get);assert.deepEqual(record.wire.data.records,created.wire.data.records);
  const history={schemaVersion:3,commandId:'atlas.circuit.history',requestId:U(1604),context:view.scope,target:createdRequest.target,payload:{pageSize:1,cursor:null,includeArchived:false,q:'atlas.circuit.create'}};
  const events=await invoke(history);assert.equal(events.wire.requestId,history.requestId);assert.equal(events.wire.data.entries.length,1);assert.equal(events.wire.data.entries[0].eventId,created.wire.data.auditIds[0]);assert.equal(events.wire.data.entries[0].requestDigest,created.wire.data.requestDigest);
  assert.deepEqual(JSON.parse(events.visible),events.wire,'Actual native history committed before tool return');
  assert.equal(runtimeErrors.length, 0, 'No browser runtime exceptions in healthy flow');
  assert(observedUrls.every(url => url.startsWith(origin + '/')), 'Observed page requests stay on loopback');
  assert(responses.every(r => r.status === 200 || (r.status === 204 && r.url === origin + '/favicon.ico')), 'Observed healthy page responses');
  const sql="import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps({t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['records','audits','stock_operations','stock_groups','stock_keys','stock_audit_links','stock_history_cursors']})); c.close()";
  const rows=spawnSync('python3',['-c',sql,join(data,'atlas.sqlite')],{encoding:'utf8'});assert.equal(rows.status,0);const persisted=JSON.parse(rows.stdout);
  assert.deepEqual(persisted,{records:7,audits:1,stock_operations:1,stock_groups:1,stock_keys:1,stock_audit_links:1,stock_history_cursors:0});
  const evidence={rust:serviceOutput.trim(),browser:version.product,native,tools:first.tools,requests:[read,createdRequest,get,history].map(r=>({commandId:r.commandId,requestId:r.requestId})),correlation:true,visibleBeforeReturn:true,persisted,observedRequests:observedUrls.length,scope:'Actual native document WebMCP registration, shared offline schema, real Rust/AT11/SQLite stock read, one fresh circuit create, record readback and first history page. No synthetic peer, stopped control or provider.'};
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
