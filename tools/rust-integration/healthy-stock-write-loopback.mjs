// Positive native core plus actual local owned PNG/text availability and delivery.
// No rejection/replay/expiry/revocation/fault/crash/concurrency control or provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium, 'A real Chromium executable is required');
const gitHead=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
assert.equal(gitHead.status,0);
const sourceHead=gitHead.stdout.trim();
if(process.env.SOURCE_SHA)assert.equal(sourceHead,process.env.SOURCE_SHA,'Exact approved source head');
const sourceStatus=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
assert.equal(sourceStatus.status,0);
if(process.env.SOURCE_SHA)assert.equal(sourceStatus.stdout.trim(),'','Exact source checkout must be clean');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const source={head:sourceHead,clean:!sourceStatus.stdout.trim(),binarySha256:hash(binary),frontendIndexSha256:hash(join(root,'frontend/dist/index.html')),scriptSha256:hash(fileURLToPath(import.meta.url))};
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
  const fixtureProfile=process.env.HOUSEATLAS_FIXTURE_PROFILE;
  assert(!fixtureProfile||fixtureProfile==='native-media-archive','Only inspected native Media fixture profile');
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key, ...(fixtureProfile?['--fixture-profile',fixtureProfile]:[])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, login, editorLogin, preparedMedia } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
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
    assert(!result.exceptionDetails, 'Healthy browser evaluation: ' + (result.exceptionDetails?.exception?.description ?? '')); return result.result.value;
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
  // Review the existing PNG through the actual server-held renderer proof.
  // Receipt facts are observed data; only the HTTP owner retains the original
  // Access allocation, vault proof and same-Store consumer through commit.
  const assetReview=await evaluate(`(async()=>{
    const scope=${JSON.stringify(view.scope)}, prefix=${JSON.stringify(prefix)}, results=[];
    const original=${JSON.stringify(preparedMedia.find(row=>row.payload.contentType==='image/png'))};
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const stockPrefix='/api/atlas/stock/v3/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId;
    const targetPath=prefix+'/records/asset/'+original.assetId;
    const json=async(path,method='GET',body,csrf)=>{
      const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:method==='POST'?{'x-atlas-csrf':csrf,...(body?{'content-type':'application/json'}:{})}:{},...(body?{body:JSON.stringify(body)}:{})});
      results.push({path,status:response.status});const value=await response.json();
      if(response.status!==200)throw new Error('Ordinary existing PNG renderer review failed');return value;
    };
    const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'
      ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
    const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const digest=value=>sha(new TextEncoder().encode(canonical(value)));
    const before=await json(targetPath), session=await json('/api/atlas/auth/session');
    const proof=await json(stockPrefix+'/assets/'+original.assetId+'/review-proof','POST',undefined,session.csrfToken);
    const request={schemaVersion:3,commandId:'atlas.asset.review',requestId:U(1600),context:scope,
      target:{authority:'atlas',recordType:'asset',recordId:original.assetId},
      payload:{treatment:'request-preview',rendererReceiptId:proof.receipt.receiptId,evidenceIds:[U(100)]},
      idempotencyKey:U(1601),reason:'Healthy disposable existing PNG renderer review',
      preconditions:{target:{kind:'atlas',value:1},guards:[{target:{authority:'atlas',recordType:'evidence',recordId:U(100)},revision:{kind:'atlas',value:1}}]},approvalReceiptId:null};
    const wire=await json(stockPrefix+'/commands','POST',request,session.csrfToken);
    const record=await json(targetPath), history=await json(targetPath+'/history');
    const descriptor=JSON.stringify({assetId:original.assetId,kind:'atlas-asset'});
    const previewPath='/api/atlas/media/'+scope.workspaceId+'/'+scope.homeId+'/'+await sha(new TextEncoder().encode(descriptor))+'/preview';
    const response=await fetch(previewPath,{credentials:'same-origin',cache:'no-store',redirect:'error'});
    results.push({path:previewPath,status:response.status});if(response.status!==200)throw new Error('Ordinary reviewed PNG preview failed');
    const bytes=new Uint8Array(await response.arrayBuffer()), data=new DataView(bytes.buffer),kinds=[];let pos=8;
    while(pos<bytes.length){const size=data.getUint32(pos);kinds.push(String.fromCharCode(...bytes.slice(pos+4,pos+8)));pos+=size+12;}
    const preview={sha256:await sha(bytes),byteSize:bytes.length,signature:Array.from(bytes.slice(0,8)),kinds,width:data.getUint32(16),height:data.getUint32(20),bitDepth:bytes[24],colorType:bytes[25],contentType:response.headers.get('content-type'),cache:response.headers.get('cache-control'),disposition:response.headers.get('content-disposition')};
    const originalBytes=Uint8Array.from(atob(original.originalBase64),c=>c.charCodeAt(0));
    // Media binds the complete envelope; Stock.2 excludes only root transport
    // requestId and approvalReceiptId from the durable intent digest.
    const intent={...request};delete intent.requestId;delete intent.approvalReceiptId;
    return {results,proof,request,wire,before,record,history,preview,originalSha256:await sha(originalBytes),originalByteSize:originalBytes.length,beforeDigest:await digest(before),afterDigest:await digest(record),requestDigest:await digest(request),intentDigest:await digest(intent)};
  })()`);
  assert.equal(assetReview.results.length,7);
  const reviewFacts=assetReview.proof.receipt,reviewWire=assetReview.wire,reviewRecord=assetReview.record;
  assert.equal(reviewFacts.format,'houseatlas-existing-asset-renderer-review/1');assert.equal(reviewFacts.renderer,'houseatlas-stripped-rgba8-png/1');
  assert.match(reviewFacts.receiptId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(reviewFacts.scope,view.scope);assert.equal(reviewFacts.assetId,assetReview.request.target.recordId);assert.equal(reviewFacts.revision,1);assert.equal(reviewFacts.actorId,writes.actorId);
  assert.equal(reviewFacts.originalRecordDigest,assetReview.beforeDigest);assert.equal(reviewFacts.originalSha256,assetReview.originalSha256);assert.equal(reviewFacts.originalByteSize,assetReview.originalByteSize);
  assert.equal(reviewFacts.originalSha256,assetReview.before.payload.sha256);assert.equal(reviewFacts.originalByteSize,assetReview.before.payload.byteSize);
  assert.equal(reviewFacts.renderedSha256,assetReview.preview.sha256);assert.equal(reviewFacts.renderedByteSize,assetReview.preview.byteSize);
  assert.deepEqual(assetReview.preview.signature,[137,80,78,71,13,10,26,10]);assert.deepEqual(assetReview.preview.kinds,['IHDR','IDAT','IEND']);
  assert.equal(assetReview.preview.width,2);assert.equal(assetReview.preview.height,2);assert.equal(assetReview.preview.bitDepth,8);assert.equal(assetReview.preview.colorType,6);
  assert.equal(assetReview.preview.contentType,'image/png');assert.equal(assetReview.preview.cache,'private, no-store');assert.equal(assetReview.preview.disposition,'inline; filename="preview.png"');
  assert.equal(reviewWire.schemaVersion,3);assert.equal(reviewWire.commandId,assetReview.request.commandId);assert.equal(reviewWire.requestId,assetReview.request.requestId);
  assert.deepEqual(reviewWire.resolvedScope,view.scope);assert.equal(reviewWire.status,'committed');assert.equal(reviewWire.replayed,false);
  assert.match(reviewWire.operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(reviewWire.data.requestDigest,assetReview.intentDigest);
  assert.equal(assetReview.before.revision,1);assert.equal(reviewRecord.revision,2);assert.equal(reviewRecord.lifecycle,'active');
  assert.equal(reviewRecord.recordId,assetReview.before.recordId);assert.equal(reviewRecord.recordType,'asset');assert.equal(reviewRecord.workspaceId,assetReview.before.workspaceId);assert.equal(reviewRecord.homeId,assetReview.before.homeId);assert.equal(reviewRecord.createdAt,assetReview.before.createdAt);
  assert.deepEqual(reviewRecord.payload,{...assetReview.before.payload,previewPolicy:'safe-rendered',evidenceIds:assetReview.request.payload.evidenceIds},'Original byte attributes, storage custody and provenance survive review');
  const reviewPayload={...reviewRecord.payload};delete reviewPayload.storageKey;
  assert.deepEqual(reviewWire.data.records,[{target:assetReview.request.target,revision:2,lifecycle:reviewRecord.lifecycle,payload:reviewPayload}]);
  assert.equal(assetReview.history.length,2);
  const reviewAudit=assetReview.history.at(-1);
  assert.deepEqual(reviewWire.data.auditIds,[reviewAudit.auditId]);assert.equal(reviewRecord.lastAuditId,reviewAudit.auditId);assert.equal(reviewAudit.actorId,writes.actorId);assert.equal(reviewAudit.resultRevision,2);
  assert.deepEqual(reviewAudit.record,{recordType:'asset',recordId:reviewRecord.recordId});assert.equal(reviewAudit.beforeDigest,assetReview.beforeDigest);assert.equal(reviewAudit.afterDigest,assetReview.afterDigest);
  // Issue genuine stock handles, then redeem current authorized original bytes.
  // PNG issuance uses real native WebMCP and observes React before tool return;
  // text issuance uses the exact HTTP stock envelope. No shim or provider.
  await until(async()=>await evaluate("document.modelContext.getTools().then(tools=>tools.some(tool=>tool.name==='atlas_media_geometry'))"),'Actual admitted managed-media registration');
  const stockDownloads=await evaluate(`(async()=>{
    const scope=${JSON.stringify(view.scope)}, originals=${JSON.stringify(preparedMedia)}, rows=[];
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    for(const [index,original] of originals.entries()){
      const request={schemaVersion:3,commandId:'atlas.asset.download',requestId:U(1500+index),context:scope,target:{authority:'atlas',recordType:'asset',recordId:original.assetId},payload:{}};
      let wire,visible=null,visibleLink=null;
      if(index===0){
        const tools=await document.modelContext.getTools(),tool=tools.find(tool=>tool.name==='atlas_media_geometry');
        const result=await document.modelContext.executeTool(tool,JSON.stringify(request));
        wire=typeof result==='string'?JSON.parse(result):result;
        visible=document.querySelector('.stock-completion pre')?.textContent;
        const link=document.querySelector('.stock-completion a');visibleLink=link?{href:link.getAttribute('href'),label:link.textContent}:null;
      }else{
        const endpoint='/api/atlas/stock/v3/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId+'/invoke?request='+encodeURIComponent(JSON.stringify(request));
        const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',redirect:'error'});
        if(response.status!==200)throw new Error('Healthy stock download issuance failed');
        wire=await response.json();
      }
      const path='/api/atlas/media/downloads/'+scope.workspaceId+'/'+scope.homeId+'/'+wire.data.downloadToken;
      const availabilityResponse=await fetch(path+'/availability',{credentials:'same-origin',cache:'no-store',redirect:'error'});
      if(availabilityResponse.status!==200)throw new Error('Healthy actual owner availability failed');
      const availability=await availabilityResponse.json();
      const deliveries=[];
      for(const method of ['GET','HEAD']){
        const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error'});
        if(response.status!==200)throw new Error('Healthy stock handle redemption failed');
        deliveries.push({method,status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer())),length:Number(response.headers.get('content-length')),contentType:response.headers.get('content-type'),disposition:response.headers.get('content-disposition'),cache:response.headers.get('cache-control'),csp:response.headers.get('content-security-policy')});
      }
      rows.push({request,wire,visible,visibleLink,path,availability,deliveries,original:Array.from(atob(original.originalBase64),c=>c.charCodeAt(0)),payload:original.payload});
    }
    return rows;
  })()`);
  assert.equal(stockDownloads.length,2);
  for(const [index,row] of stockDownloads.entries()){
    assert.equal(row.wire.commandId,row.request.commandId);assert.equal(row.wire.requestId,row.request.requestId);
    assert.equal(row.wire.status,'read');assert.equal(row.wire.replayed,false);assert.deepEqual(row.wire.resolvedScope,view.scope);
    assert.deepEqual(row.wire.data.target,row.request.target);assert.match(row.wire.data.downloadToken,/^[a-f0-9-]{36}$/);
    assert.equal(row.wire.data.sha256,row.payload.sha256);assert.equal(row.wire.data.byteSize,row.original.length);
    assert.equal(row.wire.data.contentType,row.payload.contentType);assert.equal(row.wire.data.disposition,'attachment');
    assert.equal(row.availability.state,'available');assert.ok(Number.isSafeInteger(row.availability.lifetime.remainingMs));assert.ok(row.availability.lifetime.remainingMs>0&&row.availability.lifetime.remainingMs<=300000);
    if(index===0){assert.deepEqual(JSON.parse(row.visible),row.wire,'Canonical issued metadata visible before native WebMCP returns');assert.deepEqual(row.visibleLink,{href:row.path,label:'Download original'},'Actual owner-qualified link visible before native WebMCP returns');}
    assert.deepEqual(row.deliveries[0].bytes,row.original);assert.deepEqual(row.deliveries[1].bytes,[]);
    for(const delivery of row.deliveries){
      assert.equal(delivery.length,row.original.length);assert.equal(delivery.contentType,row.payload.contentType);
      assert.match(delivery.disposition,/^attachment; filename="original\.(png|txt)"$/);
      assert.equal(delivery.cache,'private, no-store');assert.equal(delivery.csp,"default-src 'none'; sandbox");
    }
  }
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
  // Fresh circuit and identity singles plus identity-only and a mixed derived batch.
  // All inputs are the healthy owner's public fixtures with real retained guards.
  // Mount a fresh actual UI-owned session before native mutation. Raw helper
  // session GETs rotate CSRF and must occur only after this native invocation.
  await send('Page.reload');
  await until(async()=>await evaluate("document.modelContext?.getTools().then(tools=>tools.some(tool=>tool.name==='atlas_records'))"),'Fresh UI-owned Atlas registration');
  const stockWrites = await evaluate(`(async () => {
    const prefix=${JSON.stringify(prefix)}, scope=${JSON.stringify(view.scope)}, results=[];
    const endpoint='/api/atlas/stock/v3/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId+'/commands';
    const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const guard={target:{authority:'atlas',recordType:'evidence',recordId:U(100)},revision:{kind:'atlas',value:1}};
    const command=(kind,id,request,key,payload)=>({schemaVersion:3,commandId:'atlas.'+kind+'.create',requestId:U(request),context:scope,target:{authority:'atlas',recordType:kind,recordId:U(id)},payload,idempotencyKey:U(key),reason:'Healthy disposable native stock create',preconditions:{target:null,guards:[guard]},approvalReceiptId:null});
    const call=async(path,body,csrf)=>{const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'content-type':'application/json','x-atlas-csrf':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();results.push({path,status:r.status});if(r.status!==200)throw new Error('Ordinary fresh native stock command/read failed');return value;};
    const single=command('circuit',920,1200,1300,{label:null,panel:null,evidenceIds:[U(100)]});
    const children=[command('identity',921,1201,1301,{kind:'item',evidenceIds:[U(100)]}),command('identity',922,1202,1302,{kind:'item',evidenceIds:[U(100)]})];
    const batch={schemaVersion:3,commandId:'atlas.batch.execute',requestId:U(1203),context:scope,target:{authority:'atlas',kind:'batch',batchId:U(1400)},payload:{commands:children},idempotencyKey:U(1303),reason:'Healthy disposable ordered native stock identity batch',preconditions:{target:null,guards:[guard]},approvalReceiptId:null};
    const tool=(await document.modelContext.getTools()).find(tool=>tool.name==='atlas_records');
    if(!tool)throw new Error('Actual admitted native Atlas record tool unavailable');
    const nativeResult=await document.modelContext.executeTool(tool,JSON.stringify(single));
    const first=typeof nativeResult==='string'?JSON.parse(nativeResult):nativeResult;
    const firstVisible=document.querySelector('.stock-completion pre')?.textContent;
    const firstSession=await call('/api/atlas/auth/session');
    const firstPath=prefix+'/records/circuit/'+U(920);
    const firstRecord=await call(firstPath), firstHistory=await call(firstPath+'/history');
    const nextSession=await call('/api/atlas/auth/session');
    const second=await call(endpoint,batch,nextSession.csrfToken);
    const records=[],histories=[];
    for(const child of children){const path=prefix+'/records/identity/'+child.target.recordId;records.push(await call(path));histories.push(await call(path+'/history'));}
    const admission=await call('/api/atlas/stock/v3/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId+'/admission');
    const direct=command('identity',923,1204,1304,{kind:'item',evidenceIds:[U(100)]});
    const unresolvedSource={sourceInstanceId:U(10),collectionId:'synthetic-collection-a',sourceKind:'homebox-entity',externalId:U(599)};
    const derivedBinding=command('binding',926,1208,1308,{atlasId:U(200),source:unresolvedSource,reviewStatus:'proposed',evidenceIds:[U(100)]});
    derivedBinding.preconditions.guards.push({target:{authority:'atlas',recordType:'identity',recordId:U(200)},revision:{kind:'atlas',value:1}});
    const mixedChildren=[command('identity',924,1205,1305,{kind:'item',evidenceIds:[U(100)]}),command('circuit',925,1206,1306,{label:null,panel:null,evidenceIds:[U(100)]}),derivedBinding];
    const mixed={...batch,requestId:U(1207),target:{authority:'atlas',kind:'batch',batchId:U(1401)},payload:{commands:mixedChildren},idempotencyKey:U(1307),reason:'Healthy disposable ordered mixed native stock batch'};
    const third=await call(endpoint,direct,nextSession.csrfToken);
    const directPath=prefix+'/records/identity/'+U(923);
    const directRecord=await call(directPath),directHistory=await call(directPath+'/history');
    const fourth=await call(endpoint,mixed,nextSession.csrfToken);
    const mixedRecords=[],mixedHistories=[];
    for(const child of mixedChildren){const path=prefix+'/records/'+child.target.recordType+'/'+child.target.recordId;mixedRecords.push(await call(path));mixedHistories.push(await call(path+'/history'));}
    const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'
      ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
    const measured=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(mixedRecords.at(-1))));
    const bindingDigest=Array.from(new Uint8Array(measured),byte=>byte.toString(16).padStart(2,'0')).join('');
    return {results,admission,intents:[single,batch,direct,mixed],receipts:[first,second,third,fourth],firstVisible,records:[firstRecord,...records,directRecord,...mixedRecords],histories:[firstHistory,...histories,directHistory,...mixedHistories],bindingDigest};
  })()`);
  assert.equal(stockWrites.results.length,20);
  assert.deepEqual(JSON.parse(stockWrites.firstVisible),stockWrites.receipts[0],'Genuine circuit result visible before native WebMCP returns');
  assert.equal(stockWrites.admission.commandIds.length,73);
  assert.equal(new Set(stockWrites.admission.commandIds).size,73);
  const derived=['binding.create','binding.review','binding.restore','binding.remap','geometry.create','asset.review'];
  assert(derived.every(id=>stockWrites.admission.commandIds.includes('atlas.'+id)), 'Bounded derived forms are advertised');
  assert(!stockWrites.admission.commandIds.includes('atlas.asset.create'), 'Standalone asset creation still requires genuine staged Media intake');
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for(const [index,receipt] of stockWrites.receipts.entries()){
    const intent=stockWrites.intents[index];
    assert.equal(receipt.schemaVersion,3);assert.equal(receipt.commandId,intent.commandId);assert.equal(receipt.requestId,intent.requestId);
    assert.deepEqual(receipt.resolvedScope,view.scope);assert.equal(receipt.status,'committed');assert.equal(receipt.replayed,false);
    assert.match(receipt.operationId,UUID);assert.match(receipt.data.requestDigest,/^[0-9a-f]{64}$/);
    const count=intent.payload.commands?.length??1;
    assert.equal(receipt.data.records.length,count);assert.equal(receipt.data.auditIds.length,count);
    assert(receipt.data.auditIds.every(id=>UUID.test(id)));
  }
  // Fresh read-only reconciliation; saved wire IDs remain unchanged. No command retry.
  const reconciliations = await evaluate(`(async()=>{
    const originals=${JSON.stringify(stockWrites.intents)}, rows=[];
    // The current session CSRF stays lexical in this evaluation; it is never returned.
    const sessionResponse=await fetch('/api/atlas/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});
    if(sessionResponse.status!==200)throw new Error('Healthy retained reconciliation session failed: '+sessionResponse.status);
    const csrf=(await sessionResponse.json()).csrfToken;
    if(typeof csrf!=='string'||!csrf)throw new Error('Healthy retained reconciliation session is incompatible');
    for(const [index,original] of originals.entries()){
      const lookup={...original,requestId:'00000000-0000-4000-8000-'+String(1800+index).padStart(12,'0')};
      const response=await fetch('/api/atlas/retained-intent',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json','x-atlas-csrf':csrf},body:JSON.stringify(lookup)});
      if(response.status!==200)throw new Error('Healthy retained reconciliation failed: '+response.status);
      rows.push({lookup,value:await response.json()});
    }
    return rows;
  })()`);
  assert.equal(reconciliations.length,4);
  assert.deepEqual(observedUrls.filter(url=>url.startsWith(origin+'/api/atlas/retained-intent')),Array(4).fill(origin+'/api/atlas/retained-intent'),'Fixed no-query reconciliation path');
  for(const [index,{lookup,value}] of reconciliations.entries()){
    assert.equal(value.format,'atlas-retained-reconciliation/1');
    assert.equal(value.lookupRequestId,lookup.requestId);
    assert.deepEqual(value.inspection.resolvedScope,view.scope);
    assert.equal(value.inspection.outcome,'retained-commit');
    assert.equal(value.inspection.retrySafety,'not-established');
    assert.deepEqual(value.committedResult.wire,stockWrites.receipts[index]);
    assert.equal(value.committedResult.originalRequestId,stockWrites.intents[index].requestId);
    assert.equal(value.committedResult.originalMediaRelease,'not-established');
    assert.equal(value.committedResult.originalHttpDelivery,'not-established');
    assert.equal(value.committedResult.children.length,stockWrites.intents[index].payload.commands?.length??0);
  }
  await until(async()=>await evaluate(`(() => {
    const button=document.querySelector('.stock-completion section[aria-label="Saved receipt"] button');
    if(!button||button.disabled||!button.getClientRects().length)return false;
    button.click();return true;
  })()`),'Actual visible Saved receipt action');
  await until(async()=>await evaluate('Boolean(document.querySelector(\'.stock-completion pre[aria-label="Saved receipt response"]\'))'),'Actual native saved receipt visible');
  const savedReceipt=await evaluate(`(() => ({
    response:JSON.parse(document.querySelector('.stock-completion pre[aria-label="Saved receipt response"]').textContent),
    text:document.querySelector('.stock-completion section[aria-label="Saved receipt"]').textContent
  }))()`);
  assert.equal(savedReceipt.response.lookupRequestId,stockWrites.intents[0].requestId);
  assert.deepEqual(savedReceipt.response.committedResult.wire,stockWrites.receipts[0]);
  assert.equal(savedReceipt.response.committedResult.children.length,0);
  assert.equal(savedReceipt.response.inspection.retrySafety,'not-established');
  assert.match(savedReceipt.text,/Original media release and HTTP delivery are not established/);
  const receiptRows=stockWrites.receipts.flatMap(receipt=>receipt.data.records);
  const auditIds=stockWrites.receipts.flatMap(receipt=>receipt.data.auditIds);
  const intents=stockWrites.intents.flatMap(intent=>intent.payload.commands??[intent]);
  for(const [index,row] of receiptRows.entries()){
    const record=stockWrites.records[index],history=stockWrites.histories[index];
    assert.deepEqual(row,{target:intents[index].target,revision:record.revision,lifecycle:record.lifecycle,payload:record.payload});
    const expectedPayload=intents[index].commandId==='atlas.binding.create'
      ? {...intents[index].payload,sourceState:'unresolved'} : intents[index].payload;
    assert.deepEqual(row.payload,expectedPayload);assert.equal(record.recordId,intents[index].target.recordId);
    assert.equal(record.revision,1);assert.equal(history.length,1);assert.equal(history[0].actorId,writes.actorId);
    assert.equal(history[0].auditId,auditIds[index]);assert.equal(history[0].resultRevision,1);
  }
  const binding=stockWrites.records.at(-1), bindingHistory=stockWrites.histories.at(-1);
  assert.equal(binding.recordType,'binding');assert.equal(binding.payload.sourceState,'unresolved');
  assert.equal(binding.payload.reviewStatus,'proposed');assert.equal(binding.payload.source.externalId,'00000000-0000-4000-8000-000000000599');
  assert.equal(bindingHistory[0].record.recordId,binding.recordId);
  assert.equal(bindingHistory[0].beforeDigest,null);assert.equal(bindingHistory[0].afterDigest,stockWrites.bindingDigest);
  assert.equal(binding.lastAuditId,bindingHistory[0].auditId);
  assert(observedUrls.every(url=>url.startsWith(origin+'/')), 'All ordinary core/media/stock requests stay on loopback');
  assert(responses.every(r=>r.status===200 || (r.status===204 && r.url===origin+'/favicon.ico')), 'All observed core flows remain successful ordinary responses');
  assert.equal(runtimeErrors.length,0);
  const sql = [
    'import sqlite3,json,sys', 'from pathlib import Path', 'root=Path(sys.argv[1])',
    'def count(db,table):',
    " c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)",
    " try: return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]",
    ' finally: c.close()',
    "print(json.dumps({'records':count(root/'atlas.sqlite','records'),'projections':count(root/'atlas.sqlite','projections'),'audits':count(root/'atlas.sqlite','audits'),'receipts':count(root/'atlas.sqlite','receipts'),'batchReceipts':count(root/'atlas.sqlite','batch_receipts'),'assetManifests':count(root/'atlas.sqlite','asset_manifests'),'stockOperations':count(root/'atlas.sqlite','stock_operations'),'stockGroups':count(root/'atlas.sqlite','stock_groups'),'stockKeys':count(root/'atlas.sqlite','stock_keys'),'stockAuditLinks':count(root/'atlas.sqlite','stock_audit_links'),'stockHistoryCursors':count(root/'atlas.sqlite','stock_history_cursors'),'sessions':count(root/'access.sqlite','access_sessions')}))"
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, data], { encoding: 'utf8' });
  assert.equal(rows.status, 0); assert.deepEqual(JSON.parse(rows.stdout), {records:18,projections:2,audits:13,receipts:13,batchReceipts:3,assetManifests:2,stockOperations:5,stockGroups:8,stockKeys:10,stockAuditLinks:8,stockHistoryCursors:0,sessions:1});
  // Inspect the committed receipt/linkage using only a read-only SQLite URI.
  const reviewSql=[
    'import sqlite3,json,sys', 'from pathlib import Path',
    "db=sqlite3.connect((Path(sys.argv[1])/'atlas.sqlite').as_uri()+'?mode=ro',uri=True)",
    'try:',
    " rows=db.execute('SELECT o.original_json,o.commit_json,o.request_digest,g.request_digest,l.command_id,l.request_digest,l.event_json,a.body,r.body,r.payload_hash,l.payload_hash,h.command_id,k.idempotency_key FROM stock_operations o JOIN stock_groups g ON g.root_operation_id=o.operation_id JOIN stock_audit_links l ON l.root_operation_id=o.operation_id AND l.group_ordinal=g.ordinal JOIN audits a ON a.audit_id=l.audit_id AND a.workspace_id=l.workspace_id AND a.home_id=l.home_id AND json_extract(a.body,\"$.actorId\")=l.actor_id AND json_extract(a.body,\"$.mutationId\")=l.mutation_id JOIN receipts r ON r.workspace_id=l.workspace_id AND r.home_id=l.home_id AND r.actor_id=l.actor_id AND r.mutation_id=l.mutation_id JOIN stock_history_lookup h ON h.seq=a.seq AND h.audit_id=a.audit_id JOIN stock_keys k ON k.root_operation_id=o.operation_id AND k.idempotency_key=o.idempotency_key WHERE o.operation_id=? AND o.workspace_id=? AND o.home_id=? AND o.actor_id=?',sys.argv[2:6]).fetchall()",
    " print(json.dumps([dict(zip(['original','commit','operationDigest','groupDigest','commandId','linkDigest','event','audit','nativeReceipt','receiptHash','linkHash','historyCommandId','idempotencyKey'],[json.loads(v) if i in [0,1,6,7,8] else v for i,v in enumerate(row)])) for row in rows]))",
    'finally: db.close()'
  ].join('\n');
  const journalRows=spawnSync('python3',['-c',reviewSql,data,reviewWire.operationId,view.scope.workspaceId,view.scope.homeId,writes.actorId],{encoding:'utf8'});
  assert.equal(journalRows.status,0);
  const reviewJournal=JSON.parse(journalRows.stdout);assert.equal(reviewJournal.length,1);
  const linkedReview=reviewJournal[0];
  assert.deepEqual(linkedReview.original,assetReview.request);assert.deepEqual(linkedReview.commit.originalRequest,assetReview.request);assert.deepEqual(linkedReview.commit.wire,reviewWire);
  assert.equal(linkedReview.commit.replayed,false);assert.equal(linkedReview.commit.operationId,reviewWire.operationId);assert.equal(linkedReview.commit.actorId,writes.actorId);
  assert.equal(linkedReview.commit.derivationFormat,'atlas-verified-asset-review/1');
  assert.deepEqual(linkedReview.commit.assetReview,{format:'houseatlas-bound-asset-renderer-review/1',rendererReceipt:reviewFacts,requestDigest:assetReview.requestDigest},'Persisted renderer measurements are the exact issued Media facts bound to this request');
  assert.deepEqual(linkedReview.commit.derivation,{kind:'asset-review',original:assetReview.before,preview_policy:'safe-rendered',renderer_receipt_id:reviewFacts.receiptId});
  for(const digest of [linkedReview.operationDigest,linkedReview.groupDigest,linkedReview.linkDigest,linkedReview.commit.requestDigest])assert.equal(digest,assetReview.intentDigest);
  assert.equal(linkedReview.commandId,'atlas.asset.review');assert.equal(linkedReview.historyCommandId,'atlas.asset.review');assert.equal(linkedReview.idempotencyKey,assetReview.request.idempotencyKey);
  assert.equal(linkedReview.receiptHash,linkedReview.linkHash);assert.deepEqual(linkedReview.audit,reviewAudit);assert.deepEqual(linkedReview.nativeReceipt.record,reviewRecord);assert.deepEqual(linkedReview.nativeReceipt.audit,reviewAudit);assert.equal(linkedReview.nativeReceipt.replayed,false);
  assert.deepEqual(linkedReview.event,{eventId:reviewAudit.auditId,commandId:'atlas.asset.review',at:reviewAudit.at,actorId:writes.actorId,requestDigest:assetReview.intentDigest,state:'committed',target:assetReview.request.target,beforeDigest:assetReview.beforeDigest,afterDigest:assetReview.afterDigest});
  let nativeMediaPublication=null;
  if(fixtureProfile==='native-media-archive') {
    const directory=join(data,'media-policy-archive'), members=readdirSync(directory);
    assert.equal(members.length,1,'One genuine HTTP review publication');
    assert.equal(members[0],reviewWire.data.auditIds[0]+'.media-policy.json');
    const file=join(directory,members[0]);
    assert.equal(statSync(file).mode&0o777,0o600);
    const packet=JSON.parse(readFileSync(file,'utf8'));
    assert.equal(packet.entry.commit.operationId,reviewWire.operationId);
    assert.deepEqual(packet.entry.commit.wire,reviewWire);
    nativeMediaPublication={member:members[0],mode:'0600',operationId:reviewWire.operationId,packet};
  }
  const evidence = { source, nativeMediaPublication, rust:serviceOutput.trim(), browser:version.product, apiReads:api.map(({path,status})=>({path,status})), coreReads, writes, media, assetReview, reviewJournal, stockDownloads, stockWrites, reconciliations, savedReceipt, stock:stock.map(row=>({path:row.path,status:row.status,frozenStatus:row.frozenStatus,commandId:row.wire.commandId,revision:row.expected.revision,matchesFrozen:true})), authResponses:responses.filter(r=>r.url.startsWith(origin+'/api/atlas/auth/')).map(r=>({path:new URL(r.url).pathname,status:r.status})), scopedRead:result.status, rooms:1, items:1, persisted:JSON.parse(rows.stdout), observedRequests:observedUrls.length, scope:'Actual native schema/graph/JCS, Rust/SQLite/access/domain/React positive loopback TLS session/login/logout, canonical paged reads, fresh circuit create, atomic local identity batch, native owned PNG/text availability and actual GET/HEAD download plus safe PNG preview, and genuine stock circuit/asset reads compared with actual frozen SQLite rows. Fresh stock circuit and identity singles plus identity-only and mixed circuit/identity/unresolved binding batches use the actual original AT11 fence and native atomic stock journal. The mixed derived binding has a genuine configured same-scope source partition, no source-presence assertion, and a measured canonical record digest linked to its native history. Genuine stock PNG/text handles issue through native WebMCP/HTTP and redeem current originals with GET/HEAD. Native issued metadata and the actual owner-qualified PNG link are visible before return. Fresh authenticated owner availability for both handles reports the retained positive lifetime, capped at five minutes; no expiry control is exercised. The editor HTTP catalog advertises 73 stock operations, including six specialized mappings; this flow qualifies only the exercised creates and one existing PNG request-preview review. The review uses actual Media-measured renderer receipt facts and the server-held original Access allocation and same-Store consumer; the fixture supplies no proof carrier. Revision 2 preserves original byte attributes/provenance, matches the frozen record, and links its measured record/request digests to the native audit and read-only SQLite stock journal. Four fresh read-only exact-intent reconciliation POSTs to the fixed no-query path, each carrying the complete lookup envelope body and current session CSRF, return unchanged saved single/batch wire and original IDs. The fresh circuit single executes once through actual native WebMCP with its genuine canonical result visible before return. Its visible Saved receipt button performs one additional authenticated no-query POST of the original complete envelope and displays the original canonical circuit wire and unknown Media/HTTP delivery, with no replay/retry. No rejected request, stopped control, retry/replay, stock history request, recovery or external provider.' };
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
