// One explicitly reviewed positive root Atlas ten-list flow; actual peers only.
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
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-atlas-list-healthy-'));
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
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97', 'Chrome/154.0.8037.98'].includes(version.product), 'Inspected native WebMCP browser version');
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

  const prefix = '/api/atlas/stock/v3/workspaces/' + view.scope.workspaceId + '/homes/' + view.scope.homeId;
  const kinds = ['identity','binding','evidence','location-semantics','circuit','valve','relation','geometry','asset','reconciliation'];
  const result = await evaluate(`(async()=>{
    const prefix=${JSON.stringify(prefix)}, kinds=${JSON.stringify(kinds)}, scope=${JSON.stringify(view.scope)};
    const read=async(path)=>{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error'});const body=await response.json();if(response.status!==200)throw new Error('Healthy list '+path+' status '+response.status+' '+JSON.stringify(body));if(response.headers.get('cache-control')!=='private, no-store')throw new Error('Private result');return body;};
    const admission=await read(prefix+'/admission');
    const collections=[], invokes=[];
    for(let i=0;i<kinds.length;i++){
      const kind=kinds[i],commandId='atlas.'+kind+'.list';
      if(!admission.commandIds.includes(commandId))throw new Error('List admission missing');
      const direct=await read(prefix+'/records/'+kind+'?pageSize=100&includeArchived=false');
      if(direct.commandId!==commandId||direct.status!=='read'||direct.data.sourceStatus!=='current'||direct.data.nextCursor!==null)throw new Error('Healthy full list envelope');
      const request={schemaVersion:3,commandId,requestId:'00000000-0000-4000-8000-'+String(2100+i).padStart(12,'0'),context:scope,target:{authority:'atlas',recordType:kind},payload:{pageSize:100,cursor:null,includeArchived:false}};
      const invoked=await read(prefix+'/invoke?request='+encodeURIComponent(JSON.stringify(request)));
      if(invoked.requestId!==request.requestId||invoked.commandId!==request.commandId||JSON.stringify(invoked.data)!==JSON.stringify(direct.data))throw new Error('Exact invoke/list parity');
      collections.push({kind,wire:direct});invokes.push({commandId,requestId:invoked.requestId});
    }
    const first=await read(prefix+'/records/identity?pageSize=1&includeArchived=false');
    if(first.data.records.length!==1||typeof first.data.nextCursor!=='string'||first.data.nextCursor.length!==43)throw new Error('Fresh nonnull first cursor');
    window.healthyListFirst=first;
    const filtered=await read(prefix+'/records/identity?pageSize=100&includeArchived=true&q='+encodeURIComponent('ITEM'));
    if(filtered.data.records.length!==1||filtered.data.records[0].payload.kind!=='item')throw new Error('Literal case-insensitive filter');
    return {admission,collections,invokes,first,filtered};
  })()`);
  assert.equal(result.admission.commandIds.length,35,'HTTP viewer admits 30 Atlas reads, four cached HomeBox reads and managed download');
  assert.deepEqual(result.admission.commandIds.filter(id=>id.startsWith('homebox.')).sort(), ['homebox.entity.get','homebox.entity.list','homebox.location.get','homebox.location.list']);
  assert(result.admission.commandIds.every(id=>!id.startsWith('network.')));
  assert.equal(result.collections.reduce((sum,item)=>sum+item.wire.data.records.length,0),6);
  const native=await evaluate("({modelContext:typeof document.modelContext,registerTool:typeof document.modelContext?.registerTool,getTools:typeof document.modelContext?.getTools,executeTool:typeof document.modelContext?.executeTool})");
  assert.equal(native.getTools,'function','Actual document WebMCP discovery');
  await until(async()=>await evaluate("document.modelContext.getTools().then(tools=>tools.some(tool=>tool.name==='atlas_records'))"),'Actual admitted list registration');
  const request={schemaVersion:3,commandId:'atlas.identity.list',requestId:'00000000-0000-4000-8000-000000002200',context:view.scope,target:{authority:'atlas',recordType:'identity'},payload:{pageSize:1,cursor:result.first.data.nextCursor,includeArchived:false}};
  const second=await evaluate(`(async()=>{const tools=await document.modelContext.getTools();const tool=tools.find(tool=>tool.name==='atlas_records');const value=await document.modelContext.executeTool(tool,${JSON.stringify(JSON.stringify(request))});const wire=typeof value==='string'?JSON.parse(value):value;return {wire,visible:document.querySelector('.stock-completion pre')?.textContent,tools:tools.map(tool=>tool.name)};})()`);
  assert.equal(second.wire.requestId,request.requestId);
  assert.equal(second.wire.commandId,request.commandId);
  assert.equal(second.wire.status,'read');
  assert.equal(second.wire.data.nextCursor,null);
  assert.equal(second.wire.data.records.length,1);
  assert.deepEqual(JSON.parse(second.visible),second.wire,'React commits exact continuation before native tool returns');
  const full=result.collections.find(item=>item.kind==='identity').wire.data.records;
  assert.deepEqual([...result.first.data.records,...second.wire.data.records],full,'One fresh chain crosses genuine REST and native WebMCP');
  assert.notEqual(result.first.data.records[0].target.recordId,second.wire.data.records[0].target.recordId);
  const sql="import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(json.dumps({'counts':{t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['records','audits','stock_operations','stock_history_cursors']},'records':[json.loads(r[0]) for r in c.execute('SELECT body FROM records ORDER BY record_id')]}));c.close()";
  const rows=spawnSync('python3',['-c',sql,join(data,'atlas.sqlite')],{encoding:'utf8'});assert.equal(rows.status,0);
  const persisted=JSON.parse(rows.stdout);assert.deepEqual(persisted.counts,{records:6,audits:0,stock_operations:0,stock_history_cursors:0});
  for(const collection of result.collections){
    const expected=persisted.records.filter(record=>record.recordType===collection.kind&&record.lifecycle!=='tombstoned').map(record=>{const payload=structuredClone(record.payload);if(collection.kind==='asset')delete payload.storageKey;return {target:{authority:'atlas',recordType:record.recordType,recordId:record.recordId},revision:record.revision,lifecycle:record.lifecycle,payload};});
    assert.deepEqual(collection.wire.data.records,expected,'Exact stored rows disclosed for '+collection.kind);
  }
  assert.equal(runtimeErrors.length,0);
  assert(observedUrls.every(url=>url.startsWith(origin+'/')),'All observed page requests stay on loopback');
  assert(responses.every(response=>response.status===200||(response.status===204&&response.url===origin+'/favicon.ico')),'Only healthy successful responses');
  const evidence={browser:version.product,native,admittedReads:result.admission.commandIds.length,listHandlers:result.collections.map(item=>({kind:item.kind,count:item.wire.data.records.length,commandId:item.wire.commandId})),exactEnvelopeInvokes:result.invokes,continuation:{freshFirstNonNull:true,nextNull:true,pageSize:1,distinctRecords:2,restToNativeWebMcp:true,exactVisibleBeforeReturn:true},filtered:{q:'ITEM',includeArchived:true,records:1},persisted:persisted.counts,observedRequests:observedUrls.length,scope:'Actual Rust/Access/SQLite/React healthy synthetic loopback TLS: all ten REST lists, exact ten invoke envelopes, one fresh nonnull cursor continuation through native WebMCP, one literal positive filter. No login/logout/write/MCP/provider/stopped control. Populated asset and archived rows remain unqualified.'};
  if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));

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
