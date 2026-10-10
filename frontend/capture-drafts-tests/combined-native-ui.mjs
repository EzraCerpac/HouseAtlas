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

const root = resolve(process.env.HOUSEATLAS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')), 'Supply inspected source root and actual React bundle');
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const git = args => spawnSync('git', args, {cwd:root, encoding:'utf8'});
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
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-combined-capture-drafts-'));
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
const observedUrls = [], responses = [], runtimeErrors = [], uploadRequests = [];
const loaded = new Set();
// A bounded harness deadline owns only the disposable children it created.
const runDeadline = setTimeout(() => { service?.kill('SIGINT'); browser?.kill('SIGTERM'); }, 90_000);
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
        } else if (message.method === 'Fetch.requestPaused') {
          const requestUrl=message.params.request.url;
          const allowed=requestUrl.startsWith(this.allowedOrigin+'/')||requestUrl.startsWith('blob:'+this.allowedOrigin+'/');
          if(!allowed)this.blocked++;
          const evidence=allowed&&message.params.request.method==='POST'&&new URL(requestUrl).pathname.endsWith('/evidence');
          const observation=evidence&&this.beforeEvidenceContinue?this.beforeEvidenceContinue():Promise.resolve();
          void observation.then(()=>this.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:message.params.requestId}:{requestId:message.params.requestId,errorReason:'BlockedByClient'},message.sessionId)).catch(error=>{this.transportError=error.message;void this.send('Fetch.failRequest',{requestId:message.params.requestId,errorReason:'BlockedByClient'},message.sessionId).catch(()=>{});});
        } else if (message.method === 'Network.requestWillBeSent') {
          const { request, requestId } = message.params;
          observedUrls.push(request.url);
          // Observe only correlation and URL; never retain multipart bodies,
          // credentials, cookie/CSRF headers or any private stage/token fields.
          if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/evidence'))
            uploadRequests.push({ requestId, url: request.url });
        } else if (message.method === 'Network.responseReceived') responses.push({ requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status });
        else if (message.method === 'Network.loadingFinished') loaded.add(message.params.requestId);
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
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key,
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, editorLogin } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
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
  await send('Page.navigate', { url: origin });
  await until(async()=>await evaluate('Boolean(document.querySelector("main#main"))'), 'React shell');
  const login = await evaluate(`fetch('/api/atlas/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(editorLogin))}}).then(r=>r.status)`);
  assert.equal(login,200);
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
  await click('Close');await send('Page.reload');await openAtlasTools();
  await evaluate('location.hash='+JSON.stringify('#place?key='+encodeURIComponent(room.key)));
  await until(async()=>await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Add evidence'&&b.getClientRects().length);if(!b)return false;b.click();return true})()`),'Reopen contextual editor');
  await until(async()=>await evaluate(`Boolean(document.querySelector(${JSON.stringify(form+' input[name=file]:not(:disabled)')}))`),'Reopened admission');
  assert.deepEqual(await localRows(),savedRows,'Normal reopen preserves exact bytes, form and original provenance');
  await click('View local drafts');
  await until(async()=>await evaluate(`Boolean([...document.querySelectorAll(${JSON.stringify(panel+' button')})].find(b=>b.textContent==='Review synthetic-photo.jpg'&&!b.disabled))`),'Matching draft list');
  const sessionReadsBefore=observedUrls.filter(url=>new URL(url).pathname==='/api/atlas/auth/session').length;
  const placeReadsBefore=observedUrls.filter(url=>new URL(url).pathname.includes('/api/atlas/editing/v1/')&&new URL(url).pathname.endsWith('/place')).length;
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
  await click('Confirm upload');
  await until(async()=>await evaluate(`document.querySelector('section[aria-label="Atlas place editing"] [role=status]')?.textContent==='Saved. Information refreshed.' && document.querySelector('section[aria-label="Atlas place editing"]')?.getAttribute('aria-busy')==='false'`),'Confirmed draft upload and view refresh');
  assert.equal(uploadRequests.length,1,'Exactly one fresh explicit evidence POST');
  const request=uploadRequests[0];await until(()=>loaded.has(request.requestId),'Upload body settled');assert.equal(responses.find(r=>r.requestId===request.requestId)?.status,200);
  const receipt=JSON.parse(await evaluate(`document.querySelector('section[aria-label="Atlas place editing"] details pre').textContent`));
  assert.equal(receipt.status,'committed');assert.equal(receipt.commandId,'atlas.batch.execute');assert.deepEqual(receipt.resolvedScope,view.scope);
  assert(dispatchMarker,'Durable marker observed before allowing the evidence POST');assert.equal(receipt.requestId,dispatchMarker.requestId);cdp.beforeEvidenceContinue=null;
  assert.deepEqual(await localRows(),[],'Local bytes removed after validated committed receipt and before ordinary view refresh');
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
  await selectFile('photos',join(fixtures,name));
  await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});f.querySelector('[name=statement]').value='Synthetic logout cleanup draft';f.querySelector('[name=reason]').value='Remove generated local file before sign out';const l=f.querySelector('[name=license]');l.value='0';l.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector(${JSON.stringify(panel+' input[type=checkbox]')}).click();})()`);
  await click('Save local draft');
  await until(async()=>await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('Unsent draft saved on this browser.')`),'Explicit logout-cleanup draft save');
  assert.equal((await localRows()).length,1);assert.equal(uploadRequests.length,1);
  await click('Close');await evaluate("location.hash='#settings'");
  await until(async()=>await evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign out'&&b.getClientRects().length&&!b.disabled))`),'Sign out action');
  await click('Sign out');
  await until(async()=>await evaluate(`Boolean(document.querySelector('[role=dialog][aria-labelledby="capture-logout-heading"]'))`),'Explicit logout choices');
  await evaluate(`document.querySelector('[role=dialog][aria-labelledby="capture-logout-heading"] input[type=checkbox]').click()`);
  await click('Delete local captures and sign out');
  await until(async()=>await evaluate(`Boolean(document.querySelector('form input[name=username]')||[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Open Home'))`),'Confirmed normal sign out');
  assert.deepEqual(await localRows(),[],'Explicit cleanup removed local captures before normal logout');assert.equal(uploadRequests.length,1,'Logout cleanup does not submit');
  rows.push({case:'healthy-save-reopen-confirm',name,type,method,assetId,evidenceId:evidence.recordId,sha256:asset.payload.sha256,byteSize:input.length,localSaveUploads:0,reviewUploads:0,confirmedUploads:1,normalReopenBytesMatch:true,localReviewBytesMatch:true,localAcknowledgedRemoved:true,durableUnknownBeforeDispatch:true,receiptMarkerCorrelated:true,explicitLogoutCleanup:true,logoutUploads:0,returnedBytesMatch:true,canonicalReads:sessionReads,freshPlaceReads:placeReads,mobileEmulationOnly:true});
  assert(observedUrls.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:'+origin+'/')),'Observed page requests remain loopback');
  assert.equal(runtimeErrors.length,0); assert.equal(cdp.blocked,0);assert.equal(cdp.transportError,undefined);
  const result={source,browser:version.product,rows,controls,observedRequests:observedUrls.length,scope:'Source-only proposed actual React/native loopback TLS; synthetic Files only; no camera permission or iPhone claim'};
  if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{
  clearTimeout(runDeadline);
  try{if(cdp&&browser?.exitCode===null)await cdp.send('Browser.close').catch(()=>{});if(browser?.exitCode===null)await until(()=>browser.exitCode!==null,'Browser shutdown',10000);}
  finally{try{if(service?.exitCode===null){service.kill('SIGINT');await until(()=>service.exitCode!==null,'Service shutdown',10000);assert.equal(service.exitCode,0);}}
    finally{rmSync(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}}
}
