// Positive native core plus actual local owned PNG/text availability and delivery.
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
  const { origin, cookie, login, editorLogin, preparedMedia } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
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
  const contextCookie = await send('Network.setCookie', { name:'houseatlas-smoke-context', value:'ordinary', url:origin, path:'/', secure:true, sameSite:'Strict' });
  assert.equal(contextCookie.success, true, 'Ordinary additional cookie retains actual session authority');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, 'Healthy browser evaluation'); return result.result.value;
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
  await until(async () => await evaluate("Boolean(document.getElementById('atlas-username'))"), 'Ordinary successful logout form');
  assert.equal(await evaluate('document.activeElement?.id'), 'atlas-username');
  // The component stays mounted while signed out. No unauthenticated session
  // request or rejected request is made between successful logout and login.
  await evaluate(`document.getElementById('atlas-username').value=${JSON.stringify(login.username)}; document.getElementById('atlas-password').value=${JSON.stringify(login.password)}; document.querySelector('.session-form').requestSubmit()`);
  assert.equal(await evaluate("document.getElementById('atlas-password')?.value ?? ''"), '');
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'Actual successful HTTP login and React home');
  await openAtlasTools();
  const refreshedCookies = await send('Network.getCookies', {urls:[origin]});
  const actualSessionCookie = refreshedCookies.cookies.find(c=>c.name===cookie.slice(0,split));
  assert(actualSessionCookie?.secure && actualSessionCookie.httpOnly && actualSessionCookie.sameSite==='Strict', 'Actual login issues protected browser cookie');
  const authResponses = responses.filter(r=>r.url.startsWith(origin+'/api/atlas/auth/'));
  assert(authResponses.some(r=>r.url===origin+'/api/atlas/auth/login' && r.status===200));
  assert(authResponses.some(r=>r.url===origin+'/api/atlas/auth/logout' && r.status===200));
  // Fresh local-only commands, each submitted once. The browser's real editor
  // login replaces its viewer session; every write carries freshly issued CSRF.
  // This is not a provider operation, replay, stale guard or rejected request.
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
  // Two public synthetic originals were prepared in the actual immutable
  // vault. Only these fresh HTTP commands commit availability and manifests;
  // the actual NativeMediaRuntime reopens bytes and proves durability at commit.
  const media = await evaluate(`(async () => {
    const prefix=${JSON.stringify(prefix)}, rows=${JSON.stringify(preparedMedia)}, scope=${JSON.stringify(view.scope)}, results=[],assets=[];
    const json=async(path,body,csrf)=>{const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'content-type':'application/json','x-atlas-csrf':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});results.push({path,status:r.status});const value=await r.json();if(r.status!==200)throw new Error('Ordinary owned asset command/read failed');return value;};
    const bytes=async(path,method='GET')=>{const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error'});const body=Array.from(new Uint8Array(await r.arrayBuffer()));results.push({path,method,status:r.status});if(r.status!==200)throw new Error('Ordinary owned media delivery failed');return {body,length:Number(r.headers.get('content-length')),type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),cache:r.headers.get('cache-control'),csp:r.headers.get('content-security-policy'),resource:r.headers.get('cross-origin-resource-policy'),nosniff:r.headers.get('x-content-type-options')};};
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    for(const [index,row] of rows.entries()){
      const session=await json('/api/atlas/auth/session');
      const target=prefix+'/records/asset/'+row.assetId;
      const created=await json(target+'/mutations',{schemaVersion:1,mutationId:U(1050+index),operation:'create',expectedRevision:null,reason:'Healthy public synthetic owned original',guards:[{record:{recordType:'evidence',recordId:U(100)},expectedRevision:1}],value:{recordType:'asset',payload:row.payload}},session.csrfToken);
      const record=await json(target),history=await json(target+'/history');
      const descriptor=JSON.stringify({assetId:row.assetId,kind:'atlas-asset'});
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(descriptor)))).map(b=>b.toString(16).padStart(2,'0')).join('');
      const path='/api/atlas/media/'+scope.workspaceId+'/'+scope.homeId+'/'+digest;
      const original=Array.from(atob(row.originalBase64),c=>c.charCodeAt(0));
      const download=await bytes(path+'/download'),head=await bytes(path+'/download','HEAD');
      let preview=null;
      if(row.payload.contentType==='image/png'){
        const response=await bytes(path+'/preview');const data=new Uint8Array(response.body),view=new DataView(data.buffer),kinds=[];let pos=8;
        while(pos<data.length){const size=view.getUint32(pos);kinds.push(String.fromCharCode(...data.slice(pos+4,pos+8)));pos+=size+12;}
        preview={length:response.length,actualLength:response.body.length,signature:response.body.slice(0,8),kinds,type:response.type,disposition:response.disposition,csp:response.csp};
      }
      assets.push({type:row.payload.contentType,previewPolicy:row.payload.previewPolicy,revision:created.record.revision,replayed:created.replayed,recordMatches:JSON.stringify(created.record)===JSON.stringify(record),historyCount:history.length,auditActor:history[0]?.actorId,availability:record.payload.availability,downloadMatches:JSON.stringify(download.body)===JSON.stringify(original),downloadLength:download.length,actualDownloadLength:download.body.length,headLength:head.length,headBodyLength:head.body.length,disposition:download.disposition,cache:download.cache,csp:download.csp,resource:download.resource,nosniff:download.nosniff,preview});
    }
    return {results,assets};
  })()`);
  assert.equal(media.assets.length,2);
  for(const asset of media.assets){
    assert.equal(asset.revision,1);assert.equal(asset.replayed,false);assert.equal(asset.recordMatches,true);assert.equal(asset.historyCount,1);assert.equal(asset.auditActor,writes.actorId);
    assert.equal(asset.availability,'available');assert.equal(asset.downloadMatches,true);assert.equal(asset.downloadLength,asset.actualDownloadLength);assert.equal(asset.headLength,asset.downloadLength);assert.equal(asset.headBodyLength,0);
    assert.equal(asset.cache,'private, no-store');assert.equal(asset.csp,"default-src 'none'; sandbox");assert.equal(asset.resource,'same-origin');assert.equal(asset.nosniff,'nosniff');assert.match(asset.disposition,/^attachment; filename="original\.(png|txt)"$/);
  }
  const png=media.assets.find(a=>a.type==='image/png'),text=media.assets.find(a=>a.type==='text/plain');
  assert.equal(png.previewPolicy,'safe-rendered');assert.equal(text.previewPolicy,'download-only');assert.equal(text.preview,null);
  assert.deepEqual(png.preview.signature,[137,80,78,71,13,10,26,10]);assert.deepEqual(png.preview.kinds,['IHDR','IDAT','IEND']);assert.equal(png.preview.length,png.preview.actualLength);assert.equal(png.preview.type,'image/png');assert.equal(png.preview.disposition,'inline; filename="preview.png"');assert.equal(png.preview.csp,"default-src 'none'; sandbox");
  // Four ordinary GETs compare genuine stock dispatch with actual frozen SQLite reads.
  const stock=await evaluate(`(async()=>{
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const context={workspaceId:U(1),homeId:U(2)},rows=[];
    for(const [kind,id] of [['circuit',900],['asset',950]]){
      const path='/api/atlas/stock/v3/workspaces/'+U(1)+'/homes/'+U(2)+'/records/'+kind+'/'+U(id);
      const response=await fetch(path,{cache:'no-store'}),wire=await response.json();
      const frozenPath='/api/atlas/v1/workspaces/'+U(1)+'/homes/'+U(2)+'/records/'+kind+'/'+U(id);
      const frozenResponse=await fetch(frozenPath,{cache:'no-store'}),frozen=await frozenResponse.json();
      const payload={...frozen.payload};if(kind==='asset')delete payload.storageKey;
      rows.push({path,status:response.status,frozenStatus:frozenResponse.status,wire,
        expected:{target:{authority:'atlas',recordType:kind,recordId:U(id)},revision:frozen.revision,lifecycle:frozen.lifecycle,payload},
        cache:response.headers.get('cache-control'),context});
    }
    return rows;
  })()`);
  for(const row of stock){
    assert.equal(row.status,200);assert.equal(row.frozenStatus,200);assert.equal(row.cache,'private, no-store');
    assert.equal(row.wire.schemaVersion,3);assert.equal(row.wire.status,'read');assert.equal(row.wire.replayed,false);
    assert.match(row.wire.requestId,/^[a-f0-9-]{36}$/);assert.deepEqual(row.wire.resolvedScope,row.context);
    assert.equal(row.wire.commandId,'atlas.'+row.expected.target.recordType+'.get');
    assert.deepEqual(row.wire.data.records,[row.expected]);assert.equal(row.wire.data.nextCursor,null);assert.equal(row.wire.data.sourceStatus,'current');
  }
  assert(observedUrls.every(url=>url.startsWith(origin+'/')), 'All ordinary core/media/stock requests stay on loopback');
  assert(responses.every(r=>r.status===200 || (r.status===204 && r.url===origin+'/favicon.ico')), 'All observed core flows remain successful ordinary responses');
  assert.equal(runtimeErrors.length,0);
  const sql = [
    'import sqlite3,json,sys', 'from pathlib import Path', 'root=Path(sys.argv[1])',
    'def count(db,table):',
    " c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)",
    " try: return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]",
    ' finally: c.close()',
    "print(json.dumps({'records':count(root/'atlas.sqlite','records'),'projections':count(root/'atlas.sqlite','projections'),'audits':count(root/'atlas.sqlite','audits'),'receipts':count(root/'atlas.sqlite','receipts'),'batchReceipts':count(root/'atlas.sqlite','batch_receipts'),'assetManifests':count(root/'atlas.sqlite','asset_manifests'),'sessions':count(root/'access.sqlite','access_sessions')}))"
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, data], { encoding: 'utf8' });
  assert.equal(rows.status, 0); assert.deepEqual(JSON.parse(rows.stdout), {records:11,projections:2,audits:5,receipts:5,batchReceipts:1,assetManifests:2,sessions:1});
  const evidence = { rust:serviceOutput.trim(), browser:version.product, apiReads:api.map(({path,status})=>({path,status})), coreReads, writes, media, stock:stock.map(row=>({path:row.path,status:row.status,frozenStatus:row.frozenStatus,commandId:row.wire.commandId,revision:row.expected.revision,matchesFrozen:true})), authResponses:responses.filter(r=>r.url.startsWith(origin+'/api/atlas/auth/')).map(r=>({path:new URL(r.url).pathname,status:r.status})), scopedRead:result.status, rooms:1, items:1, persisted:JSON.parse(rows.stdout), observedRequests:observedUrls.length, scope:'Actual native schema/graph/JCS, Rust/SQLite/access/domain/React positive loopback TLS session/login/logout, canonical paged reads, fresh circuit create, atomic local identity batch, native owned PNG/text availability and actual GET/HEAD download plus safe PNG preview, and genuine stock circuit/asset reads compared with actual frozen SQLite rows. No rejected request, stopped control, recovery or external provider.' };
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
