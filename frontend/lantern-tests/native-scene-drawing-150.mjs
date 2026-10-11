/** Synthetic bounded-browser acceptance for NativeSceneDrawing issue 150.
 * Actual component; fake native evidence client; no credentials or providers. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const frontend = join(root, 'frontend');
const cases = new Set(['first-match', 'middle-match', 'last-match', 'missing-match', 'page-bound',
  'close-cleanup', 'selection-during-open', 'selection-after-show', 'blob-read-failure']);
const args = process.argv.slice(2);
assert.equal(args.length, 2); assert.equal(args[0], '--case'); assert(cases.has(args[1]), 'Select one explicitly named case');
const selectedCase = args[1];
assert.equal(process.version, 'v26.10.0', 'Use pinned Node 26.10.0');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to an inspected executable');
const evidenceDirectory = process.env.HOUSEATLAS_FIXTURE_EVIDENCE;
if (evidenceDirectory) {
  const destination = resolve(evidenceDirectory);
  assert(destination !== root && !destination.startsWith(root + '/'), 'Evidence must remain outside checkout');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
}
const hash = value => createHash('sha256').update(value).digest('hex');
const syntheticId = (prefix, index = 0) => {
  let seed = 0;
  for (const character of prefix) seed = (seed * 33 + character.charCodeAt(0)) % 900000;
  return `00000000-0000-4000-8000-${String(seed * 5000 + index).padStart(12, '0')}`;
};
const componentPath = 'frontend/src/lantern/scans/native-ui/NativeSceneDrawing.tsx';
const typePaths = ['frontend/src/lantern/scans/native-evidence-document-types.ts', 'frontend/src/lantern/scans/native-document-types.ts'];
const pngPath = join(frontend, 'capture-evidence-tests/fixtures/synthetic-image.png');
const png = readFileSync(pngPath), pngSha = hash(png), pngBase64 = png.toString('base64');
const sourceDigests = Object.fromEntries([componentPath, ...typePaths].map(path => [path, hash(readFileSync(join(root, path)))]));
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain', '--', componentPath, ...typePaths], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-drawing-150-'));
const generated = mkdtempSync(join(frontend, 'node_modules/.drawing-150-'));
const budgetMs = 120_000;
let browser, server, cdp, session, origin, failure;
const results = [], screenshots = [];
const report = { case: selectedCase, node: process.version, sourceHead, sourceDirty, sourceDigests, pngSha256: pngSha,
  runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), results, screenshots };

class CDP {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString(); let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        if (message.id) { const item = this.pending.get(message.id); if (!item) continue; clearTimeout(item.timer); this.pending.delete(message.id);
          message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params.request.url);
      }
    });
    child.on('exit', () => this.reject(new Error('Owned Chromium exited')));
    child.on('error', error => this.reject(error));
  }
  reject(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) { if (await read()) return; await pause(35); }
  throw new Error(`Timed out: ${label}`);
}

function appSource() {
  return `import { createElement as h, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSceneDrawing } from ${JSON.stringify(join(frontend, 'src/lantern/scans/native-ui/NativeSceneDrawing.tsx'))};
const selectedCase=${JSON.stringify(selectedCase)}, pngBytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}), c=>c.charCodeAt(0));
const blob=new Blob([pngBytes],{type:'image/png'}), stats={opens:[],releases:[],creates:[],revokes:[],subscriptions:[],unsubscriptions:[],maxConcurrent:0,inFlight:0,active:[],resolveDeferred:null,deferredAborted:false};
const realCreate=URL.createObjectURL.bind(URL), realRevoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=value=>{const url=realCreate(value);stats.creates.push(url);return url};
URL.revokeObjectURL=url=>{stats.revokes.push(url);realRevoke(url)};
window.__stats=stats;
const uuid=(prefix,index=0)=>{let seed=0;for(const c of prefix)seed=(seed*33+c.charCodeAt(0))%900000;return '00000000-0000-4000-8000-'+String(seed*5000+index).padStart(12,'0')};
const idList=(prefix,n)=>Array.from({length:n},(_,i)=>uuid(prefix,i));
function config(which, version=0){
 if(which==='selection-during-open') return version===0?{ids:[uuid('deferred-old')],matches:[]}:{ids:[uuid('replacement')],matches:[uuid('replacement')]};
 if(which==='selection-after-show') return version===0?{ids:idList('old',129),matches:[uuid('old',70)]}:{ids:[uuid('new-match')],matches:[uuid('new-match')]};
 const n=which==='page-bound'?5000:129, ids=idList(which,n), matches=[];
 const ix=which==='first-match'||which==='close-cleanup'||which==='blob-read-failure'?0:which==='middle-match'?64:which==='last-match'?128:-1;
 if(ix>=0) matches.push(ids[ix]);
 return {ids,matches};
}
function makeClient(){
 const live=new Set(), listeners=new Map(); let sequence=0;
 const frame=(id,matching)=>({lease:{n:++sequence},evidenceId:id,evidenceRevision:1,mode:'inline-png',asset:{assetId:id,contentType:'image/png',sha256:matching?${JSON.stringify(pngSha)}:'b'.repeat(64),byteSize:pngBytes.length,revision:1}});
 return {async open(id,signal){stats.opens.push(id);stats.inFlight++;stats.maxConcurrent=Math.max(stats.maxConcurrent,stats.inFlight);
  const finish=f=>{stats.inFlight--;live.add(f);stats.active.push(id);return f};
  if(selectedCase==='selection-during-open'&&id===uuid('deferred-old')) return await new Promise(resolve=>{signal.addEventListener('abort',()=>{stats.deferredAborted=true},{once:true});stats.resolveDeferred=()=>resolve(finish(frame(id,false)));});
  await Promise.resolve();return finish(frame(id,window.__matches.includes(id)));
 },isCurrent:f=>live.has(f),getBlob:f=>{if(selectedCase==='blob-read-failure')throw Error('Synthetic blob read failure');return live.has(f)?blob:null},
 subscribeInvalidation(f,changed){if(!live.has(f))throw Error('subscribe requires live frame');listeners.set(f,changed);stats.subscriptions.push(f.evidenceId);return()=>{if(listeners.delete(f))stats.unsubscriptions.push(f.evidenceId)}},
 release(f){if(live.delete(f)){stats.releases.push(f.evidenceId);stats.active=stats.active.filter(id=>id!==f.evidenceId)}},dispose(){}};
}
function App(){const [which,setWhich]=useState(selectedCase),[version,setVersion]=useState(0),[visible,setVisible]=useState(true),[selection,setSelection]=useState(config(selectedCase)),prior=useRef(null),sheets=useRef(new WeakMap());
 const client=window.__client||(window.__client=makeClient()); window.__matches=selection.matches;
 if(!sheets.current.has(selection))sheets.current.set(selection,{id:'synthetic-sheet-'+version,title:'Synthetic drawing '+version,pdfPage:2,renderedPhotoSha256:${JSON.stringify(pngSha)}});
 const sheet=sheets.current.get(selection);
 const change=()=>{prior.current={version,selection};setWhich(selectedCase);setVersion(v=>v+1);setSelection(config(selectedCase,1));setVisible(true)};
 const component=visible?h(NativeSceneDrawing,{key:'drawing',client,sheet,evidenceIds:selection.ids,current:()=>true,onClose:()=>setVisible(false)}):null;
 return h('main',null,h('button',{id:'change-selection',onClick:change},'Change selection'),h('button',{id:'return-old',onClick:()=>{if(prior.current){setVersion(prior.current.version);setSelection(prior.current.selection);setVisible(true)}}},'Return to prior selection'),h('button',{id:'resolve-deferred',onClick:()=>stats.resolveDeferred?.()},'Resolve deferred read'),h('button',{id:'reopen',onClick:()=>setVisible(true)},'Open drawing'),component);
}
createRoot(document.getElementById('root')).render(h(App));`;
}

async function run() {
  const appPath = join(generated, 'app.ts');
  writeFileSync(appPath, appSource());
  const indexPath = join(generated, 'index.html');
  writeFileSync(indexPath, '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic native drawing</title><div id="root"></div><script type="module" src="/app.ts"></script></html>');
  const dist = join(scratch, 'dist');
  await build({ configFile: false, root: generated, logLevel: 'error', build: { target: 'esnext', outDir: dist, emptyOutDir: true, minify: false, rollupOptions: { input: indexPath } } });
  const files = new Map();
  function collect(dir, prefix='') { for (const entry of readdirSync(dir,{withFileTypes:true})) { const path=join(dir,entry.name), url=prefix+'/'+entry.name; if(entry.isDirectory())collect(path,url);else files.set(url,readFileSync(path)); } }
  collect(dist);
  server=createServer((request,response)=>{assert.equal(request.method,'GET');const path=request.url==='/'?'/index.html':request.url;if(path==='/favicon.ico'){response.writeHead(204);response.end();return}const bytes=files.get(path);if(!bytes){response.writeHead(404);response.end();return}const mime=path.endsWith('.js')||path.endsWith('.ts')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';response.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Content-Length':bytes.length});response.end(bytes)});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)}); origin=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-features=MediaRouter,OptimizationHints',`--user-data-dir=${join(scratch,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  cdp=new CDP(browser); report.browser=(await cdp.send('Browser.getVersion')).product;
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});({sessionId:session}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
  const send=(method,params)=>cdp.send(method,params,session); await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.text??'Browser evaluation failed');return r.result.value};
  const click=async selector=>{const b=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);assert(b.w>0&&b.h>0);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:b.x,y:b.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:b.x,y:b.y});};
  const clickText=async text=>{const b=await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button '+${JSON.stringify(text)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);assert(b.w>0&&b.h>0);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:b.x,y:b.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:b.x,y:b.y});};
  await send('Page.navigate',{url:origin+'/'});
  await until(()=>evaluate('Boolean(window.__stats && document.querySelector(".native-scene-drawing"))'),'component mount');
  const stats=()=>evaluate('({opens:window.__stats.opens.slice(),releases:window.__stats.releases.slice(),creates:window.__stats.creates.slice(),revokes:window.__stats.revokes.slice(),subscriptions:window.__stats.subscriptions.slice(),unsubscriptions:window.__stats.unsubscriptions.slice(),maxConcurrent:window.__stats.maxConcurrent,inFlight:window.__stats.inFlight,active:window.__stats.active.slice()})');
  const status=()=>evaluate('document.querySelector("[role=status]")?.textContent ?? ""');
  const assertSerialized=async()=>{const s=await stats();assert.equal(s.maxConcurrent,1,'Candidate reads are serial');assert.equal(s.inFlight,0,'No in-flight read remains');assert(s.active.length<=1,'At most one accepted frame is held');assert.equal(s.creates.length-s.revokes.length,s.active.length,'Object URL lifetime matches active lease');assert.equal(s.subscriptions.length-s.unsubscriptions.length,s.active.length,'Subscription lifetime matches active lease');return s;};
  const targetIndex={ 'first-match':0,'middle-match':64,'last-match':128 }[selectedCase];
  if(targetIndex!==undefined){
    const firstPage=Math.min(targetIndex+1,64);await until(async()=>(await stats()).opens.length===firstPage,'first candidate page');
    if(targetIndex>=64){assert.match(await status(),/checked/i);assert.match(await status(),/remain(?:s)? to check/i);assert.match(await status(),new RegExp(String(129-64)));assert(!await evaluate('Boolean(document.querySelector("img"))'));await clickText('Check next references');await until(async()=>(await stats()).opens.length===Math.min(targetIndex+1,128),'second page');}
    if(targetIndex>=128){assert.match(await status(),/remain(?:s)? to check/i);assert.match(await status(),/1/);await clickText('Check next references');await until(async()=>(await stats()).opens.length===129,'third page');}
    await until(()=>evaluate('Boolean(document.querySelector("img")?.naturalWidth)'),'matching synthetic PNG render');
    const s=await assertSerialized();assert.equal(s.opens.at(-1),syntheticId(selectedCase,targetIndex));assert.equal(s.creates.length,1);assert.equal(s.active.length,1);
    results.push({case:selectedCase,status:'passed',checked:s.opens.length,matchedIndex:targetIndex,leases:s.active.length,objectUrls:s.creates.length});
  } else if(selectedCase==='missing-match'||selectedCase==='page-bound') {
    const size=selectedCase==='missing-match'?129:5000;
    await until(async()=>(await stats()).opens.length===64,'first bounded page');
    assert.match(await status(),/checked/i);assert.match(await status(),/remain(?:s)? to check/i);assert.match(await status(),new RegExp(String(size-64)));
    assert.equal(await evaluate('Boolean(document.querySelector("img"))'),false);
    const pageCount=selectedCase==='missing-match'?3:2;
    for(let page=1;page<pageCount;page++){
      await clickText('Check next references');
      await until(async()=>(await stats()).opens.length===Math.min(page*64+64,size),'next bounded page');
      if(page<pageCount-1){assert.match(await status(),/checked/i);assert.match(await status(),/remain(?:s)? to check/i);assert.equal(await evaluate('Boolean(document.querySelector("img"))'),false);}
    }
    const s=await stats();assert.equal(s.opens.length,selectedCase==='missing-match'?129:128);assert.equal(s.creates.length,0);assert.equal(s.active.length,0);
    if(selectedCase==='missing-match') assert.equal(await status(),'No current saved PNG matches this drawing. Add its reading copy to this building and reload scans.');
    else {assert.match(await status(),/checked/i);assert.match(await status(),/remain(?:s)? to check/i);assert.equal((await evaluate('window.__stats.opens.length')),128);}
    await assertSerialized();results.push({case:selectedCase,status:'passed',listSize:size,checked:s.opens.length,remaining:size-s.opens.length,explicitPages:pageCount});
  } else if(selectedCase==='blob-read-failure') {
    await until(async()=>(await status()).includes('could not be read'),'settled blob read failure');
    const s=await stats();assert.equal(s.opens.length,1);assert.equal(s.releases.length,1);assert.equal(s.active.length,0);assert.equal(s.creates.length,0);
    results.push({case:selectedCase,status:'passed',openedFrameReleased:true,objectUrls:0});
  } else if(selectedCase==='close-cleanup') {
    await until(()=>evaluate('Boolean(document.querySelector("img")?.naturalWidth)'),'PNG before close');
    const before=await stats();assert.equal(before.active.length,1);await click('.native-scene-drawing button');
    await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'dialog close');
    const after=await stats();assert.equal(after.active.length,0);assert.equal(after.revokes.length,1);assert.equal(after.releases.length,1);assert.equal(after.unsubscriptions.length,1);
    results.push({case:selectedCase,status:'passed',cleanup:{revoked:after.revokes.length,released:after.releases.length,unsubscribed:after.unsubscriptions.length}});
  } else if(selectedCase==='selection-during-open') {
    await until(()=>evaluate(`window.__stats.opens.includes(${JSON.stringify(syntheticId('deferred-old'))})`),'deferred initial read');
    await click('#change-selection');await until(()=>evaluate('Boolean(document.querySelector("img")?.naturalWidth)'),'replacement image');
    assert.equal(await evaluate(`window.__stats.opens.includes(${JSON.stringify(syntheticId('replacement'))})`),true);
    await click('#resolve-deferred');await until(()=>evaluate(`window.__stats.releases.includes(${JSON.stringify(syntheticId('deferred-old'))})`),'late stale frame release');
    assert.equal(await evaluate('window.__stats.deferredAborted'),true,'The old signal was aborted on selection change');
    const s=await stats();assert.equal(s.active.length,1);assert.equal(s.active[0],syntheticId('replacement'));assert.equal(s.creates.length,1);assert.equal(s.revokes.length,0);
    results.push({case:selectedCase,status:'passed',oldSignalAborted:true,lateFrameReleased:true,visible:'replacement'});
  } else if(selectedCase==='selection-after-show') {
    await until(async()=>(await stats()).opens.length===64,'first old selection page');
    assert.match(await status(),/65 references remain to check/i);
    await clickText('Check next references');
    await until(()=>evaluate('Boolean(document.querySelector("img")?.naturalWidth)'),'initial image after page advance');
    const old=await stats();assert.equal(old.creates.length,1);await click('#change-selection');
    await until(()=>evaluate('Boolean(document.querySelector("img")?.naturalWidth && document.querySelector(".native-scene-drawing h3")?.textContent.includes("1"))'),'new selection image');
    const s=await stats();assert.equal(s.revokes.length,1);assert.equal(s.releases.length,old.releases.length+1);assert.equal(s.unsubscriptions.length,1);assert.equal(s.active.length,1);
    assert(s.revokes[0]===old.creates[0],'Old URL revoked on selection change');assert.equal(s.creates.length,2);
    assert.equal(s.opens.at(-1),syntheticId('new-match'),'Changed selection starts from its first reference after the prior page cursor advanced');
    await click('#return-old');await until(async()=>{const live=await stats();return live.opens.length===old.opens.length+1+64&&live.opens.at(-64)===old.opens[0]},'exact old selection returns to page one');
    assert.match(await status(),/65 references remain to check/i,'Returning to the exact earlier sheet/list resets its cursor to the first page');
    const reset=await stats();assert.deepEqual(reset.opens.slice(-64),old.opens.slice(0,64));
    results.push({case:selectedCase,status:'passed',oldLeaseReleased:true,oldUrlRevokedBeforeReplacement:true,oldCursorHadAdvanced:true,newSelectionStartsAtFirstReference:true,returningToExactOldSelectionStartsAtFirstPage:true,newLease:s.active[0]});
  }
  assert.deepEqual(cdp.errors,[],'No browser runtime exceptions');
  const ownedBlobUrls=await evaluate('window.__stats.creates.slice()');
  assert(cdp.requests.every(url=>url.startsWith(origin+'/')||(url.startsWith('blob:')&&ownedBlobUrls.includes(url))),'Browser requests stay on owned loopback or use generated object URLs');
  report.requests=cdp.requests.map(url=>url.startsWith(origin+'/')?new URL(url).pathname:url);
  if(evidenceDirectory){const pngShot=Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64');const path=join(evidenceDirectory,selectedCase+'.png');writeFileSync(path,pngShot,{mode:0o600});screenshots.push({path,sha256:hash(pngShot)});}
  if(await evaluate('Boolean(document.querySelector(".native-scene-drawing"))'))await click('.native-scene-drawing button');
  await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'normal drawing close');
  const cleaned=await stats();assert.equal(cleaned.active.length,0,'Close releases every retained frame');assert.equal(cleaned.creates.length,cleaned.revokes.length,'Close revokes every created object URL');
  assert.equal(cleaned.subscriptions.length,cleaned.unsubscriptions.length,'Close removes every invalidation subscription');assert.equal(cleaned.inFlight,0,'Close leaves no pending synthetic opens');
  results.push({case:`${selectedCase}-final-close`,status:'passed',activeFrames:cleaned.active.length,objectUrls:cleaned.creates.length-cleaned.revokes.length,subscriptions:cleaned.subscriptions.length-cleaned.unsubscriptions.length,inFlight:cleaned.inFlight});
}

const budget=setTimeout(()=>{cdp?.reject(new Error('120-second bounded fixture budget exhausted'));browser?.kill('SIGTERM');server?.close();},budgetMs);
try { await run(); } catch(error){failure=error;report.error={name:error.name,message:error.message};}
finally {
  if(browser&&browser.exitCode===null&&browser.signalCode===null){await cdp?.send('Browser.close').catch(()=>{});if(browser.exitCode===null&&browser.signalCode===null)browser.kill('SIGTERM');try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chromium exit')}catch(error){browser.kill('SIGKILL');failure??=error;}}
  if(server)await new Promise(resolve=>server.close(resolve));clearTimeout(budget);rmSync(generated,{recursive:true,force:true});
  if(!browser||browser.exitCode!==null||browser.signalCode!==null)rmSync(scratch,{recursive:true,force:true});
  report.cleanup={browserStopped:!browser||browser.exitCode!==null||browser.signalCode!==null,listenerStopped:!server?.listening,generatedRemoved:!existsSync(generated),scratchRemoved:!existsSync(scratch)};
  if(!Object.values(report.cleanup).every(Boolean))failure??=new Error('Owned fixture cleanup incomplete');report.status=failure?'failed':'passed';
  if(evidenceDirectory)writeFileSync(join(evidenceDirectory,selectedCase+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(report,null,2));if(failure)throw failure;
