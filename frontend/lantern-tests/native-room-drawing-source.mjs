/** Exact named, generated-only room drawing download/preview checks.
 * Actual source reader and React drawing surface; fake document/geometry ports.
 * Fresh bounded sandboxed browser + owned loopback. No native API or credentials. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const names = new Set(['pdf-download', 'png-legacy', 'missing-correlation', 'stale-correlation', 'wrong-correlation', 'lifecycle']);
assert.equal(process.argv.length, 3); const name = process.argv[2]; assert(names.has(name), 'Select one registered named case');
assert.equal(process.version, 'v26.10.0');
const browserPath = process.env.HOUSEATLAS_CHROMIUM;
assert(browserPath && existsSync(browserPath), 'Select an inspected Chromium executable');
const evidence = process.env.HOUSEATLAS_FIXTURE_EVIDENCE;
assert(evidence && resolve(evidence) === evidence, 'Select an absolute private evidence directory');
const root = resolve(fileURLToPath(new URL('../../', import.meta.url))), frontend = join(root, 'frontend');
assert(evidence !== root && !evidence.startsWith(root + '/'));
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const png = readFileSync(join(frontend, 'capture-evidence-tests/fixtures/synthetic-image.png'));
const pdf = readFileSync(join(frontend, 'capture-evidence-tests/fixtures/synthetic-document.pdf'));
const input = { name, png: png.toString('base64'), pdf: pdf.toString('base64'), pngSha: hash(png), pdfSha: hash(pdf) };
const production = ['frontend/integration/native-scene-source-client.ts', 'frontend/src/lantern/scans/native-scene-source-types.ts',
  'frontend/src/lantern/scans/native-ui/NativeSceneDrawing.tsx', 'frontend/src/lantern/scans/native-ui/NativeSceneLayers.tsx'];
const report = { name, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding:'utf8'}).trim(),
  sourcePins: Object.fromEntries(production.map(p => [p, hash(readFileSync(join(root,p)))])), node: process.version, results: [] };
let scratch, generated, browser, server, cdp, failure, childClosed = false, groupGone = false, stopReason;
const lifetime = new AbortController();
const budget = setTimeout(() => { stopReason = new Error('120-second named fixture bound'); lifetime.abort(stopReason); cdp?.reject(stopReason); }, 120000);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, milliseconds = 7000) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) { lifetime.signal.throwIfAborted(); if (await check()) return; await wait(25); }
  throw Error('Fixture timeout: ' + label);
}
class CDP {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString();
      if (this.buffer.length > 8 * 1024 * 1024) { this.reject(Error('Bounded CDP buffer exceeded')); return; }
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        let row; try { row = JSON.parse(this.buffer.slice(0,end)); } catch(error) { this.reject(error); return; }
        this.buffer = this.buffer.slice(end+1);
        if (row.id) { const p = this.pending.get(row.id); if(!p) continue; clearTimeout(p.timer); this.pending.delete(row.id); row.error ? p.no(Error('CDP command failed: '+p.method)) : p.yes(row.result); }
        else if(row.method === 'Runtime.exceptionThrown') this.errors.push(row.params.exceptionDetails.text);
        else if(row.method === 'Network.requestWillBeSent') this.requests.push(row.params.request.url);
      }
    });
    const failed = e => { stopReason ??= e; lifetime.abort(e); this.reject(e); };
    child.on('error', failed); child.stdio[3].on('error', failed); child.stdio[4].on('error', failed);
    child.on('close', () => { childClosed = true; this.reject(Error('Owned browser closed')); });
  }
  reject(error) { for(const p of this.pending.values()){clearTimeout(p.timer);p.no(error);} this.pending.clear(); }
  send(method,params={},sessionId) { return new Promise((yes,no) => {
    const id = ++this.next, timer=setTimeout(()=>{this.pending.delete(id);no(Error('CDP deadline: '+method));},5000);
    this.pending.set(id,{yes,no,timer,method});
    this.child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){clearTimeout(timer);this.pending.delete(id);no(error);}});
  }); }
}
async function fixture(ExactDecimal) {
  const U = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const bytes = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const pdf = new Blob([bytes(window.__input.pdf)],{type:'application/pdf'}), png = new Blob([bytes(window.__input.png)],{type:'image/png'});
  const sheet = { id:'synthetic-sheet',title:'Synthetic room drawing',pdfPage:1,originalPhoto:'originals/synthetic.jpg',
    originalPhotoSha256:'c'.repeat(64),renderedPhotoSha256:window.__input.name==='png-legacy'?window.__input.pngSha:'d'.repeat(64),sourceDate:null,regionIds:[] };
  const canonical='{"id":"synthetic-room-receipt"}', receipt={id:'synthetic-room-receipt',sha256:await sha(new TextEncoder().encode(canonical))};
  const stored={schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:canonical,
    rooms:{status:'unavailable',reason:'not-retained',receiptId:receipt.id,receiptSha256:receipt.sha256,entries:null,regions:null},
    network:{status:'unavailable',reason:'not-retained',source:null,devices:null,endpoints:null,links:null},
    electricity:{status:'unavailable',reason:'not-retained',documentarySource:null,roomRegistry:null,buildingPackageKey:null,retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:{schema:'houseatlas.documentary-electrical-fixtures.v1',
      viewKey:'documentary-only',interpretationDate:'2026-10-11',symbolLegend:{xMeansSocket:null,socketsPerX:null,receiptId:null},
      roomMappingReceipt:receipt,registrationReceipts:[],sheets:[sheet],groups:[],regions:[],fixtures:[]}}};
  const text=JSON.stringify(stored), sceneSha=await sha(new TextEncoder().encode(text)), one=ExactDecimal.parse('1');
  const selection={sessionIdentity:{},workspaceId:U(1),homeId:U(2),buildingId:U(3),viewKey:'9'.repeat(64),
    expiresAt:new Date(Date.now()+300000).toISOString(),sceneEvidenceId:U(4),sceneAssetId:U(5),
    sceneOriginalSha256:sceneSha,sceneEvidenceRevision:1,sceneAssetRevision:one,
    acceptedRoomReceiptId:receipt.id,acceptedRoomReceiptSha256:receipt.sha256,
    acceptedRoomAnchors:[{id:'source-anchor',sourceFloorKey:'synthetic-floor',sourceOriginalSha256:'a'.repeat(64),targets:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(6)}],unresolvedLabels:[]}],sourceFloorBindings:[]};
  const reference={correlationId:'synthetic-reviewed-correlation',correlationSha256:'e'.repeat(64),
    workspaceId:selection.workspaceId,homeId:selection.homeId,buildingId:selection.buildingId,viewKey:selection.viewKey,
    sceneOriginalSha256:sceneSha,sceneEvidenceId:U(4),sceneEvidenceRevision:1,sceneAssetId:U(5),sceneAssetRevision:one,
    sheetId:sheet.id,pdfPage:sheet.pdfPage,originalPhotoSha256:sheet.originalPhotoSha256,renderedPhotoSha256:sheet.renderedPhotoSha256,
    evidenceId:U(7),evidenceRevision:1,assetId:U(8),assetRevision:one,assetSha256:window.__input.pdfSha,byteSize:ExactDecimal.parse(String(pdf.size))};
  if(!['png-legacy','missing-correlation'].includes(window.__input.name))selection.drawingReferences=[reference];
  if(window.__input.name==='stale-correlation')reference.sceneAssetId=U(99);
  const sourceDocument={lease:{},evidenceId:U(4),evidenceRevision:1,mode:'original-download',
    asset:{assetId:U(5),revision:one,sha256:sceneSha,contentType:'text/plain'}};
  const geometry={viewKey:selection.viewKey,descriptor:{viewKey:selection.viewKey,buildingId:U(3),scope:{workspaceId:U(1),homeId:U(2)},floors:[]}};
  return {selection,reference,sheet,geometry,sourceDocument,sourceBlob:new Blob([text],{type:'text/plain'}),pdf,png,one,U};
}
async function app(createElement,useState,useLayoutEffect,createRoot,NativeSceneDrawing,createNativeSceneSourceClient,ExactDecimal) {
  const h=createElement, f=await fixture(ExactDecimal), stats={opens:[],released:0,created:[],revoked:[],subscribed:0,unsubscribed:0,hiddenBeforeRelease:[],sourceWithdrawals:0};
  window.__stats=stats;
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);stats.created.push(url);return url;};
  URL.revokeObjectURL=url=>{stats.revoked.push(url);revoke(url);};
  let selectionChanged=()=>{};
  const sourceClient=createNativeSceneSourceClient({getSelection:()=>f.selection,subscribeSelection:changed=>{selectionChanged=changed;return()=>{selectionChanged=()=>{};};},
    geometry:{isCurrent:g=>g===f.geometry,subscribeInvalidation:()=>()=>{}},
    documents:{async open(id,signal){if(id!==f.selection.sceneEvidenceId||signal.aborted)throw Error('Synthetic source scope');return f.sourceDocument;},
      isCurrent:d=>d===f.sourceDocument,getBlob:()=>f.sourceBlob,subscribeInvalidation:()=>()=>{},release(){}}});
  const source=await sourceClient.open(f.selection,f.geometry,new AbortController().signal);
  stats.projected=source.drawingReferences.length;
  const alive=new Set(),released=new Set(),listeners=new Map();
  const drawings={async open(id,signal){
    stats.opens.push(id);if(signal.aborted)throw signal.reason;
    const isPng=window.__input.name==='png-legacy',blob=isPng?f.png:f.pdf;
    const asset={assetId:f.U(8),revision:f.one,sha256:isPng?window.__input.pngSha:window.__input.pdfSha,byteSize:ExactDecimal.parse(String(blob.size)),
      contentType:blob.type,purpose:'evidence-original',previewPolicy:isPng?'safe-rendered':'download-only',sourceLicense:{status:'unknown',reference:null},evidenceIds:[f.U(7)]};
    if(window.__input.name==='wrong-correlation')asset.sha256='f'.repeat(64);
    const frame={lease:{},evidenceId:id,evidenceRevision:1,mode:isPng?'inline-png':'original-download',asset};alive.add(frame);return frame;
  },isCurrent:frame=>alive.has(frame),getBlob:frame=>alive.has(frame)?(window.__input.name==='png-legacy'?f.png:f.pdf):null,
    subscribeInvalidation(frame,changed){listeners.set(frame,changed);stats.subscribed++;return()=>{if(listeners.delete(frame))stats.unsubscribed++;};},
    release(frame){if(!released.has(frame)){released.add(frame);alive.delete(frame);stats.released++;const a=document.querySelector('.native-scene-drawing a[href]');stats.hiddenBeforeRelease.push(!a||!!a.closest('[hidden]'));}},
    dispose(){}};
  window.__invalidate=()=>{for(const [frame,changed]of [...listeners]){alive.delete(frame);changed();}};
  function App(){
    const [opened,setOpened]=useState(false),[available,setAvailable]=useState(true);
    useLayoutEffect(()=>sourceClient.subscribeInvalidation(source,()=>{stats.sourceWithdrawals++;setAvailable(false);setOpened(false);}),[]);
    window.__withdrawSource=()=>{f.reference.correlationSha256='a'.repeat(64);selectionChanged();};
    window.__shutdown=()=>{setOpened(false);sourceClient.dispose();};
    return h('main',null,h('button',{id:'room-open',disabled:!available,onClick:()=>setOpened(true)},'Open room drawing'),
      opened&&h(NativeSceneDrawing,{client:drawings,sheet:source.electricalFixtures.data.sheets[0],evidenceIds:[f.U(7)],
        reference:source.drawingReferences[0],current:()=>available&&sourceClient.isCurrent(source),onClose:()=>setOpened(false)}));
  }
  createRoot(document.getElementById('root')).render(h(App));
}
function groupAbsent() {
  if(!browser||groupGone)return true;
  if(!childClosed)return false;
  // A complete numeric snapshot avoids treating a denied group probe as absence.
  // No discovered PID is signalled; the snapshot only checks this owned leader/group.
  const text=execFileSync('/bin/ps',['-axo','pid=,pgid='],{encoding:'utf8',timeout:1000,maxBuffer:1024*1024});
  const rows=text.trim().split('\n').map(line=>{assert(/^\s*\d+\s+\d+\s*$/.test(line),'Complete numeric process snapshot required');return line.trim().split(/\s+/).map(Number);});
  if(rows.some(([pid,pgid])=>pid===browser.pid||pgid===browser.pid))return false;
  groupGone=true;report.groupProof={method:'complete-numeric-ps-after-child-close',leader:browser.pid,group:browser.pid,rows:rows.length};return true;
}
function signalGroup(signal) {
  if(groupAbsent())return;
  try{process.kill(-browser.pid,signal);}catch(error){if(error.code==='ESRCH')groupGone=true;else throw error;}
}
async function cleanup() {
  if(browser&&!groupAbsent())await cdp?.send('Browser.close').catch(()=>{});
  // Wait for direct-child close and a complete absence snapshot after graceful exit.
  const gracefulDue=performance.now()+2000;
  while(browser&&performance.now()<gracefulDue&&!(childClosed&&groupAbsent()))await wait(25);
  for(const [signal,bound]of [['SIGTERM',2000],['SIGKILL',2000]]){
    if(childClosed&&groupAbsent())break;
    signalGroup(signal);const due=performance.now()+bound;
    while(performance.now()<due&&!(childClosed&&groupAbsent()))await wait(25);
  }
  const confirmed=!browser||childClosed&&groupAbsent();
  if(server?.listening)await new Promise((yes,no)=>{const t=setTimeout(()=>no(Error('Owned listener close deadline')),2000);server.close(error=>{clearTimeout(t);error?no(error):yes();});server.closeAllConnections();});
  cdp?.reject(Error('Fixture complete'));clearTimeout(budget);
  if(!confirmed)throw Error('Owned browser exit/group absence unconfirmed; scratch retained');
  if(generated)rmSync(generated,{recursive:true,force:true});if(scratch)rmSync(scratch,{recursive:true,force:true});
  report.cleanup={browserClosed:!browser||childClosed,groupGone:!browser||groupGone,listenerStopped:!server?.listening,
    generatedRemoved:!generated||!existsSync(generated),scratchRemoved:!scratch||!existsSync(scratch)};
}
try {
  scratch=mkdtempSync(join(tmpdir(),'houseatlas-room-drawing-'));generated=mkdtempSync(join(frontend,'node_modules/.room-drawing-'));
  report.owned={scratch,generated};
  const module=join(generated,'app.js'),index=join(generated,'index.html');
  const component=join(frontend,'src/lantern/scans/native-ui/NativeSceneDrawing.tsx');
  const reader=join(frontend,'integration/native-scene-source-client.ts'),decimal=join(frontend,'src/numeric/decimal.ts');
  writeFileSync(module,'import {createElement,useState,useLayoutEffect} from "react";import {createRoot} from "react-dom/client";\n'+
    'import {NativeSceneDrawing} from '+JSON.stringify(component)+';import {createNativeSceneSourceClient} from '+JSON.stringify(reader)+';\n'+
    'import {ExactDecimal} from '+JSON.stringify(decimal)+';import '+JSON.stringify(join(frontend,'src/lantern/scans/native-ui/native-scene.css'))+';\n'+
    'window.__input='+JSON.stringify(input)+';\n'+fixture.toString()+'\n'+app.toString()+'\n'+
    'app(createElement,useState,useLayoutEffect,createRoot,NativeSceneDrawing,createNativeSceneSourceClient,ExactDecimal).catch(e=>{window.__failed=e.message;});');
  writeFileSync(index,'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}main{padding:8px}button,a{font-size:16px}.native-scene-drawing{box-sizing:border-box}h3,p{overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  const dist=join(scratch,'dist');
  await build({configFile:false,root:generated,logLevel:'error',build:{outDir:dist,emptyOutDir:true,minify:false,rollupOptions:{input:index}}});
  const files=new Map();function collect(dir,prefix=''){for(const x of readdirSync(dir,{withFileTypes:true})){const path=join(dir,x.name),url=prefix+'/'+x.name;x.isDirectory()?collect(path,url):files.set(url,readFileSync(path));}}collect(dist);
  server=createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}const path=req.url==='/'?'/index.html':req.url;if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}const bytes=files.get(path);if(!bytes){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=spawn(browserPath,['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-features=MediaRouter,OptimizationHints','--user-data-dir='+join(scratch,'profile'),'about:blank'],{detached:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  report.owned.browserPid=browser.pid;
  cdp=new CDP(browser);report.browser=(await cdp.send('Browser.getVersion')).product;
  mkdirSync(join(scratch,'downloads'),{mode:0o700});
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(scratch,'downloads')});
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>cdp.send(method,params,sessionId);await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,'Fixture JavaScript exception');return r.result.value;};
  const click=async selector=>{const r=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Fixture element missing");const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()');assert(r.w>0&&r.h>0);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:r.x,y:r.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:r.x,y:r.y});};
  const key=async(key,code,number)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:number});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:number});};
  await send('Page.navigate',{url:origin+'/'});
  await until(async()=>{const failed=await evaluate('window.__failed');assert(!failed,failed);return evaluate('Boolean(document.querySelector("#room-open"))');},'source projection and room action');
  const wantProjection=['pdf-download','wrong-correlation','lifecycle'].includes(name)?1:0;
  assert.equal(await evaluate('window.__stats.projected'),wantProjection);
  for(const width of [1280,312]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===312});
    await click('#room-open');
    if(['missing-correlation','stale-correlation','wrong-correlation'].includes(name)){
      await until(()=>evaluate('Boolean(document.querySelector("[role=status]")?.textContent.includes("available"))'),'explicit unavailable');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing a[href], .native-scene-drawing img"))'),false);
      assert.equal(await evaluate('window.__stats.created.length'),0);
    }else if(name==='png-legacy'){
      await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing img")?.naturalWidth)'),'legacy PNG paint');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing a[href]"))'),false);
    }else{
      await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing a[download]"))'),'correlated PDF action');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing img, embed, iframe"))'),false);
      assert.match(await evaluate('document.querySelector(".native-scene-drawing").textContent'),/Reference PDF page 1/);
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Download reference PDF');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Close drawing');
      if(name==='pdf-download'){
        await click('.native-scene-drawing a[download]');
        const expected=join(scratch,'downloads','atlas-original-00000000-0000-4000-8000-000000000008.pdf');
        await until(()=>existsSync(expected),'ordinary blob PDF download');
        assert.deepEqual(readFileSync(expected),pdf,'Downloaded source bytes remain exact');
        report.results.push({width,downloadedBytes:pdf.length,sha256:hash(pdf),referencePage:1});
        rmSync(expected);
      }
    }
    if(width===312)assert.equal(await evaluate('document.documentElement.scrollWidth'),312,'Mobile dialog does not overflow horizontally');
    await key('Escape','Escape',27);
    await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'Escape closes');
    assert.equal(await evaluate('document.activeElement.id'),'room-open','Original room action focus restored');
  }
  if(name==='lifecycle'){
    await click('#room-open');await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing a[download]"))'),'PDF before withdrawal');
    await evaluate('window.__invalidate()');await until(()=>evaluate('!document.querySelector(".native-scene-drawing a[href]")'),'document withdrawal removes action');
    assert.equal(await evaluate('window.__stats.created.length'),await evaluate('window.__stats.revoked.length'));
    await key('Escape','Escape',27);await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'close unavailable dialog');
    await click('#room-open');await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing a[download]"))'),'fresh reopened PDF');
    await evaluate('window.__withdrawSource()');await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'changed correlation withdraws source');
    assert.equal(await evaluate('window.__stats.sourceWithdrawals'),1);
  }
  const stats=await evaluate('window.__stats');assert.equal(stats.created.length,stats.revoked.length,'All URLs retired');
  assert.equal(stats.subscribed,stats.unsubscribed,'All document subscriptions retired');
  assert(stats.hiddenBeforeRelease.every(Boolean),'Action is hidden before native frame release');
  assert.equal(stats.opens.length,['pdf-download','png-legacy','missing-correlation','stale-correlation','wrong-correlation'].includes(name)?2:4);
  assert.deepEqual(cdp.errors,[]);
  assert(cdp.requests.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:'+origin+'/')),'Only owned loopback/blob requests');
  await evaluate('window.__shutdown()');report.results.push({case:name,status:'passed',stats});
}catch(error){failure=error;report.failure={name:error.name,message:error.message};}
finally{
  try{await cleanup();}catch(error){failure??=error;report.cleanupFailure={name:error.name,message:error.message};clearTimeout(budget);}
  if(stopReason)failure??=stopReason;
  report.status=failure?'failed':'passed';writeFileSync(join(evidence,name+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(report,null,2));if(failure)throw failure;
