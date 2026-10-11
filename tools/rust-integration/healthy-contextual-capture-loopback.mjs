// Scoped actual React/native synthetic capture acceptance.
// Optional exact picker cancellation regression has no upload or rejected HTTP.
// No provider, real camera, private file, recovery, replay, expiry or revocation.
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
const pickerRegression=args.length===2 && args[0]==='--case' && args[1]==='picker-cancel-and-repeat';
assert(args.length===0 || pickerRegression, 'Only healthy or the exact picker regression entrypoint');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium && existsSync(chromium), 'A real Chromium executable is required');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-contextual-capture-'));
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
          const allowed=message.params.request.url.startsWith(this.allowedOrigin+'/');
          if(!allowed)this.blocked++;
          void this.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:message.params.requestId}:{requestId:message.params.requestId,errorReason:'BlockedByClient'},message.sessionId).catch(error=>{this.transportError=error.message;});
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
  if(pickerRegression){
    await selectFile('photos',join(fixtures,'synthetic-photo.jpg'));
    const before=await evaluate(`document.querySelector(${JSON.stringify(form)}).textContent`);
    await evaluate(`document.querySelector(${JSON.stringify(form+' input[name=photos]')}).dispatchEvent(new Event('cancel',{bubbles:true}))`);
    const cancel=await evaluate(`document.querySelector(${JSON.stringify(form)}).textContent`);
    assert(cancel.includes('Selection cancelled.')&&cancel.includes('Selected: synthetic-photo.jpg'));
    await selectFile('photos',join(fixtures,'synthetic-photo.jpg'));
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(form+' input[name=photos]')}).value`),'');
    assert.equal(uploadRequests.length,0);
    await evaluate(`[...document.querySelectorAll(${JSON.stringify(form+' button')})].find(b=>b.textContent==='Remove file').click()`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(form)}).textContent.includes('Selected:')`),false);
    const unknown=await readJson('/api/atlas/view');assert.deepEqual(unknown.scope,view.scope);
    rows.push({case:'picker-cancel-and-repeat',preservedSelection:before.includes('Selected:'),unchangedOnCancel:true,sameFileSelectableAgain:true,uploads:0,mobileEmulationOnly:true});
  }else{
    const inputs=[['synthetic-photo.jpg','image/jpeg','camera','camera-request'],['synthetic-photo-progressive.jpg','image/jpeg','photos','photo-picker'],['synthetic-image.png','image/png','photos','photo-picker'],['synthetic-document.pdf','application/pdf','file','file-picker'],['synthetic-note.txt','text/plain','file','file-picker'],['synthetic-photo.jpg','image/jpeg','file','file-picker']];
    for(const [name,type,picker,method] of inputs){
      const input=readFileSync(join(fixtures,name));
      await selectFile(picker,join(fixtures,name));
      await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});f.querySelector('[name=statement]').value=${JSON.stringify('Synthetic '+name+' evidence')};f.querySelector('[name=reason]').value='Attach generated synthetic evidence';const l=f.querySelector('[name=license]');l.value='0';l.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const count=uploadRequests.length;
      await evaluate(`document.querySelector(${JSON.stringify(form)}).requestSubmit()`);
      await until(async()=>await evaluate('document.querySelector("section[aria-label=\\"Atlas place editing\\"] [role=status]")?.textContent==="Saved. Information refreshed." && document.querySelector("section[aria-label=\\"Atlas place editing\\"]")?.getAttribute("aria-busy")==="false"'),'Confirmed capture upload');
      assert.equal(uploadRequests.length,count+1,'Exactly one fresh explicit POST');
      const request=uploadRequests.at(-1); await until(()=>loaded.has(request.requestId),'Upload body settled');
      assert.equal(responses.find(r=>r.requestId===request.requestId)?.status,200);
      const receipt=JSON.parse(await evaluate('document.querySelector("section[aria-label=\\"Atlas place editing\\"] details pre").textContent'));
      assert.equal(receipt.status,'committed');assert.equal(receipt.commandId,'atlas.batch.execute');
      const committedEvidence=receipt.data.records.find(r=>r.target.recordType==='evidence');assert(committedEvidence);
      const evidence=await readJson(nativePrefix+'/evidence/'+committedEvidence.target.recordId);
      validateShape('record',evidence);
      assert.equal(evidence.payload.statement,'Synthetic '+name+' evidence');
      assert.equal(evidence.payload.provenance.factAt,null);assert.equal(evidence.payload.provenance.evidenceBasis,'unknown');
      assert(evidence.payload.provenance.vantage.startsWith('Browser selection claim v1: '));
      const claim=JSON.parse(evidence.payload.provenance.vantage.slice('Browser selection claim v1: '.length));
      assert.equal(claim.filename,name);assert.equal(claim.reportedContentType,type);assert.equal(claim.selectionMethod,method);assert.equal(claim.byteOrigin,'browser-returned-unmodified');
      const assetId=evidence.payload.references[0].assetId;
      const asset=await readJson(nativePrefix+'/asset/'+assetId);
      validateShape('record',asset);
      assert.equal(asset.payload.sha256,createHash('sha256').update(input).digest('hex'));assert.equal(asset.payload.byteSize,input.length);assert.equal(asset.payload.contentType,type);
      if(type!=='image/png')assert.equal(asset.payload.previewPolicy,'download-only');
      const digest=createHash('sha256').update(JSON.stringify({assetId,kind:'atlas-asset'})).digest('hex');
      const download=await evaluate(`fetch(${JSON.stringify('/api/atlas/media/'+view.scope.workspaceId+'/'+view.scope.homeId+'/'+digest+'/download')},{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),body:Array.from(new Uint8Array(await r.arrayBuffer()))}))`);
      assert.equal(download.status,200);assert.equal(download.type,type);assert(download.disposition.startsWith('attachment;'));assert.deepEqual(download.body,Array.from(input));
      const jpeg=rows.find(r=>r.name===name);if(jpeg){assert.equal(assetId,jpeg.assetId,'Fresh repeated selection reuses the same measured original with new evidence');assert.notEqual(evidence.recordId,jpeg.evidenceId);assert.deepEqual(receipt.data.records.map(r=>r.target.recordType),['evidence','identity']);}
      rows.push({name,type,method,assetId,evidenceId:evidence.recordId,sha256:asset.payload.sha256,byteSize:input.length,previewPolicy:asset.payload.previewPolicy,returnedBytesMatch:true,frozenOldReaderAccepted:true});
    }
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(process.env.HOUSEATLAS_SCREENSHOT)writeFileSync(process.env.HOUSEATLAS_SCREENSHOT,Buffer.from(screenshot.data,'base64'));
  }
  assert(observedUrls.every(url=>url.startsWith(origin+'/')),'Observed page requests remain loopback');
  assert.equal(runtimeErrors.length,0); assert.equal(cdp.blocked,0);assert.equal(cdp.transportError,undefined);
  const result={source,browser:version.product,rows,controls,observedRequests:observedUrls.length,scope:'Actual React/native loopback TLS; synthetic Files only; no camera permission or iPhone claim'};
  if(process.env.HOUSEATLAS_EVIDENCE)writeFileSync(process.env.HOUSEATLAS_EVIDENCE,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{
  try{if(cdp&&browser?.exitCode===null)await cdp.send('Browser.close').catch(()=>{});if(browser?.exitCode===null)await until(()=>browser.exitCode!==null,'Browser shutdown',10000);}
  finally{try{if(service?.exitCode===null){service.kill('SIGINT');await until(()=>service.exitCode!==null,'Service shutdown',10000);assert.equal(service.exitCode,0);}}
    finally{rmSync(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}}
}
