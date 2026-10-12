/** Exact named, generated-only room drawing preview/download checks.
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
import { inflateSync } from 'node:zlib';
import { build } from 'vite';

const names = new Set(['pdf-download', 'pdf-navigation', 'png-legacy', 'missing-correlation', 'stale-correlation', 'wrong-correlation', 'lifecycle']);
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
function screenshotSignature(image) {
  let width=0,height=0,bitDepth=0,colorType=0;const chunks=[];
  for(let offset=8;offset<image.length;){
    const length=image.readUInt32BE(offset),type=image.toString('ascii',offset+4,offset+8),data=image.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];}
    if(type==='IDAT')chunks.push(data);offset+=12+length;if(type==='IEND')break;
  }
  assert.equal(bitDepth,8,'Expected 8-bit Chrome screenshot PNG');
  assert([2,6].includes(colorType),'Expected RGB or RGBA Chrome screenshot PNG');
  const bytesPerPixel=colorType===6?4:3,raw=inflateSync(Buffer.concat(chunks)),rowBytes=width*bytesPerPixel,grid=32;
  const previous=Buffer.alloc(rowBytes),samples=new Float64Array(grid*grid*3),counts=new Uint32Array(grid*grid);let cursor=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[cursor++],row=Buffer.from(raw.subarray(cursor,cursor+rowBytes));cursor+=rowBytes;
    for(let i=0;i<rowBytes;i++){
      const left=i>=bytesPerPixel?row[i-bytesPerPixel]:0,above=previous[i],upperLeft=i>=bytesPerPixel?previous[i-bytesPerPixel]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):filter===4?paeth(left,above,upperLeft):NaN;
      assert(Number.isFinite(predictor),'Unsupported PNG row filter');row[i]=(row[i]+predictor)&255;
    }
    for(let x=0;x<width;x++){
      const pixel=x*bytesPerPixel,alpha=colorType===6?row[pixel+3]:255;
      const cell=Math.min(grid-1,Math.floor(y*grid/height))*grid+Math.min(grid-1,Math.floor(x*grid/width));
      for(let channel=0;channel<3;channel++)samples[cell*3+channel]+=row[pixel+channel]*alpha/255;
      counts[cell]++;
    }
    row.copy(previous);
  }
  return Buffer.from(samples.map((value,index)=>Math.round(value/counts[Math.floor(index/3)])));
}
const signatureDistance=(a,b)=>{
  let sum=0,changed=0;
  for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);sum+=delta;if(delta>=2)changed++;}
  return {mean:sum/a.length,changed};
};
const png = readFileSync(join(frontend, 'capture-evidence-tests/fixtures/synthetic-image.png'));
function makeSyntheticNavigationPdf(pageCount) {
  const objects = new Map();
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const fontId = 3 + pageCount * 2;
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pageCount + ' >>');
  for (let index = 0; index < pageCount; index++) {
    const pageId = pageIds[index], contentId = pageId + 1;
    const red=(0.65+((index*37)%30)/100).toFixed(2),green=(0.65+((index*53)%30)/100).toFixed(2),blue=(0.65+((index*29)%30)/100).toFixed(2);
    const content = 'q '+red+' '+green+' '+blue+' rg 20 20 320 260 re f Q\nBT /F1 28 Tf 40 240 Td (SYNTHETIC PAGE ' + (index + 1) + ') Tj ET\n';
    objects.set(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 300] /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    objects.set(contentId, '<< /Length ' + Buffer.byteLength(content, 'ascii') + ' >>\nstream\n' + content + 'endstream');
  }
  objects.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let document = '%PDF-1.4\n%HouseAtlas synthetic navigation fixture\n';
  const offsets = [0];
  for (let id = 1; id <= fontId; id++) {
    offsets[id] = Buffer.byteLength(document, 'ascii');
    document += id + ' 0 obj\n' + objects.get(id) + '\nendobj\n';
  }
  const xref = Buffer.byteLength(document, 'ascii');
  document += 'xref\n0 ' + (fontId + 1) + '\n0000000000 65535 f \n';
  for (let id = 1; id <= fontId; id++) document += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  document += 'trailer\n<< /Size ' + (fontId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(document, 'ascii');
}
const pdf = makeSyntheticNavigationPdf(18);
const input = { name, png: png.toString('base64'), pdf: pdf.toString('base64'), pngSha: hash(png), pdfSha: hash(pdf) };
const production = ['frontend/integration/native-scene-association-client.ts','frontend/integration/native-scene-documentary-support.ts','frontend/integration/main.tsx','frontend/src/lantern/scans/native-ui/NativeSceneAssociation.tsx','frontend/integration/native-scene-source-client.ts', 'frontend/src/lantern/scans/native-scene-source-types.ts',
  'frontend/src/lantern/scans/native-ui/NativeSceneDrawing.tsx', 'frontend/src/lantern/scans/native-ui/NativeSceneLayers.tsx',
  'frontend/src/lantern/scans/native-ui/native-scene.css', 'frontend/src/app/assets.d.ts', 'frontend/package.json', 'frontend/package-lock.json'];
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
async function fixture(ExactDecimal,createNativeSceneAssociationClient) {
  const U = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const hashText = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const canonical = v => v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  const bytes = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const pdf = new Blob([bytes(window.__input.pdf)],{type:'application/pdf'}), png = new Blob([bytes(window.__input.png)],{type:'image/png'}),one=ExactDecimal.parse('1');
  const sheet = { id:'synthetic-sheet',title:'Synthetic room drawing',pdfPage:12,originalPhoto:'originals/synthetic.jpg',
    originalPhotoSha256:'c'.repeat(64),renderedPhotoSha256:window.__input.name==='png-legacy'?window.__input.pngSha:'d'.repeat(64),sourceDate:null,regionIds:[] };
  const roomMappingJson='{"receiptId":"synthetic-old-room-receipt"}',oldSha=await hashText(roomMappingJson);
  const ledger={schema:'houseatlas.documentary-electrical-fixtures.v1',viewKey:'documentary-only',interpretationDate:'2026-10-11',
    symbolLegend:{xMeansSocket:null,socketsPerX:null,receiptId:null},roomMappingReceipt:{id:'synthetic-old-room-receipt',sha256:oldSha},registrationReceipts:[],sheets:[sheet],groups:[],regions:[],fixtures:[]};
  const ledgerJson=JSON.stringify(ledger),ledgerSha=await hashText(ledgerJson);
  const crosswalk=canonical({profile:'houseatlas.documentary-sheet-pdf-correlation.v1',correlationId:'synthetic-reviewed-correlation',fixtureLedgerSha256:ledgerSha,
    pdf:{workspaceId:U(1),homeId:U(2),buildingId:U(3),evidenceId:U(7),evidenceRevision:1,assetId:U(8),assetRevision:1,sha256:window.__input.pdfSha,byteSize:pdf.size},
    references:[{sheetId:sheet.id,pdfPage:sheet.pdfPage,originalPhotoSha256:sheet.originalPhotoSha256,renderedPhotoSha256:sheet.renderedPhotoSha256,pdfEmbeddedImageSha256:'f'.repeat(64)}]});
  const crosswalkSha=await hashText(crosswalk),sourceReview='{"observation":"generated-only photo/page review"}';
  const review=canonical({profile:'houseatlas.documentary-sheet-pdf-review.v1',reviewId:'synthetic-independent-review',crosswalkSha256:crosswalkSha,roomMappingSha256:oldSha,
    sourceReviewJson:sourceReview,sourceReviewSha256:await hashText(sourceReview)}),reviewSha=await hashText(review);
  const supportJson=JSON.stringify({schema:'houseatlas.documentary-scene-support.v1',roomMapping:{json:roomMappingJson,sha256:oldSha},fixtureLedger:{json:ledgerJson,sha256:ledgerSha},
    crosswalk:{json:crosswalk,sha256:crosswalkSha},review:{json:review,sha256:reviewSha}});
  const hasSupport=!['png-legacy','missing-correlation'].includes(window.__input.name),historicalText=hasSupport?supportJson:roomMappingJson,historicalSha=await hashText(historicalText);
  const anchors=[{id:'source-anchor',sourceFloorKey:'synthetic-floor',sourceOriginalSha256:'a'.repeat(64),targets:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(6)}],unresolvedLabels:[]}];
  const literal=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-new-native-review',sourceReceiptSha256:historicalSha,anchors}),receiptSha=await hashText(literal);
  if(!hasSupport)ledger.roomMappingReceipt={id:'synthetic-new-native-review',sha256:receiptSha};
  const stored={schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:literal,
    rooms:{status:'available',reason:null,receiptId:'synthetic-new-native-review',receiptSha256:receiptSha,entries:[],regions:[]},
    network:{status:'unavailable',reason:'not-retained',source:null,devices:null,endpoints:null,links:null},
    electricity:{status:'unavailable',reason:'not-retained',documentarySource:null,roomRegistry:null,buildingPackageKey:null,retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:ledger}};
  const text=JSON.stringify(stored),sceneSha=await hashText(text),marker='\n[HouseAtlas drawing review v1 support:'+historicalSha+' crosswalk:'+crosswalkSha+' review:'+reviewSha+']';
  const scope={workspaceId:U(1),homeId:U(2)},context={sessionIdentity:{},session:{schemaVersion:1,actorId:'synthetic-actor',csrfToken:'synthetic-only',expiresAt:new Date(Date.now()+300000).toISOString()},
    view:{scope,canEdit:true},admission:{scope,revision:1,commandIds:['atlas.scene-association.create']}};
  const geometry={viewKey:'9'.repeat(64),descriptor:{viewKey:'9'.repeat(64),buildingId:U(3),scope,floors:[]},floors:[]};
  const sourceDocument={lease:{},evidenceId:U(4),evidenceRevision:1,mode:'original-download',asset:{assetId:U(5),revision:one,sha256:sceneSha,contentType:'text/plain'}};
  const historicalFrame=()=>({lease:{},evidenceId:U(9),evidenceRevision:1,mode:'original-download',asset:{assetId:U(10),revision:one,sha256:historicalSha,contentType:'text/plain'}});
  const sourceBlob=new Blob([text],{type:'text/plain'}),historicalBlob=new Blob([historicalText],{type:'text/plain'});
  const supportOwners=[],stats={gets:0,posts:0,constructorReads:0,confirmationRefused:false,unknownPreserved:false};
  const makeReview=()=>{
    let current=null,callback=()=>{};let disposed=false;
    const client={async open(id,signal){if(signal.aborted)throw signal.reason;if(disposed)throw Error('Disposed synthetic owner');
      if(id===U(9)){current=historicalFrame();if(window.__input.name==='stale-correlation')current.evidenceRevision=2;}
      else if(id===U(7)){current={lease:{},evidenceId:id,evidenceRevision:1,mode:'original-download',asset:{assetId:U(8),revision:one,sha256:window.__input.pdfSha,byteSize:ExactDecimal.parse(String(pdf.size)),contentType:'application/pdf',purpose:'evidence-original',previewPolicy:'download-only'}};}
      else throw Error('Synthetic review target');return current;},isCurrent:f=>!disposed&&f===current,
      getBlob:f=>f===current?(f.evidenceId===U(9)?historicalBlob:pdf):null,
      subscribeInvalidation(f,changed){callback=changed;return()=>{callback=()=>{};};},release(f){if(current===f){current=null;callback();}},dispose(){disposed=true;current=null;},
      invalidate(){current=null;callback();}};supportOwners.push(client);return client;
  };
  const p={profile:'houseatlas.native-scene-association.v1',buildingId:U(3),associationVersion:1,previousAssociationId:null,reviewStatus:'accepted',reviewStatement:'Reviewed synthetic sources'+(hasSupport?marker:''),
    sourceDocuments:[{role:'primary-scene',evidenceId:U(4),evidenceRevision:1,originalAssetId:U(5),originalAssetRevision:1,originalSha256:sceneSha,contentType:'text/plain'},
      {role:'documentary-sheet',evidenceId:U(9),evidenceRevision:1,originalAssetId:U(10),originalAssetRevision:1,originalSha256:historicalSha,contentType:'text/plain'}],
    acceptedReceipt:{receiptId:'synthetic-new-native-review',canonicalJson:literal,canonicalSha256:receiptSha,anchors},sourceFloors:[],roomMappings:[]};
  const record={schemaVersion:1,recordType:'scene-association',recordId:U(11),workspaceId:U(1),homeId:U(2),revision:1,lifecycle:'active',createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z',lastAuditId:U(12),payload:p};
  const primaryReview={async open(){return sourceDocument;},isCurrent:f=>f===sourceDocument,getBlob:()=>sourceBlob,subscribeInvalidation:()=>()=>{},release(){},dispose(){}};
  const historic=historicalFrame(),historicalReview={async open(){return historic;},isCurrent:f=>f===historic,getBlob:()=>historicalBlob,subscribeInvalidation:()=>()=>{},release(){},dispose(){}};
  const associations=createNativeSceneAssociationClient({getContext:()=>context,subscribe:()=>()=>{},primaryReview,historicalReview,createDrawingReview:makeReview,geometryCurrent:g=>g===geometry,
    async transport(url,init){
      if(init.method==='POST'){stats.posts++;throw Error('Synthetic confirmed transport stop');}
      stats.gets++;if(url.endsWith('/current'))return new Response(JSON.stringify({status:'available',association:record}),{headers:{'content-type':'application/json'}});
      if(url.endsWith('/records/identity/'+U(3)))return new Response(JSON.stringify({schemaVersion:3,commandId:'atlas.identity.get',requestId:U(13),resolvedScope:scope,status:'read',replayed:false,
        data:{sourceStatus:'current',nextCursor:null,records:[{target:{authority:'atlas',recordType:'identity',recordId:U(3)},revision:1,lifecycle:'active',payload:{kind:'location',evidenceIds:[U(4),U(7)]}}]}}),{headers:{'content-type':'application/json'}});
      throw Error('Unexpected synthetic GET');}});
  if(window.__input.name==='pdf-download'){
    const old=p.reviewStatement;p.reviewStatement='Legacy room-only review';
    const unreviewed=await associations.readCurrent(U(3),geometry,new AbortController().signal);
    if(unreviewed.selection.drawingReferences!==undefined)throw Error('Unreviewed support granted references');p.reviewStatement=old;
    const candidate={buildingId:U(3),primaryEvidenceId:U(4),historicalEvidenceId:U(9),sourceFloors:[],roomMappings:[],guards:[{target:{authority:'atlas',recordType:'identity',recordId:U(3)},revision:{kind:'atlas',value:1}}]};
    const prepared=await associations.prepare(candidate,geometry,'Deliberate synthetic correlation review','Generated-only fixture',new AbortController().signal);
    if(!prepared.drawingReview||!prepared.payload.reviewStatement.endsWith(marker))throw Error('Prepared support summary missing');
    try{await associations.submit(prepared,geometry,new AbortController().signal);}catch{stats.confirmationRefused=stats.posts===0&&associations.pending(U(3)).length===0;}
    if(!stats.confirmationRefused)throw Error('Support submitted without explicit review');
    associations.releasePrepared(prepared);
  }
  const head=await associations.readCurrent(U(3),geometry,new AbortController().signal);stats.constructorReads++;
  if(head.status!=='available')throw Error('Synthetic production constructor unavailable');
  return {ledgerSha,oldSha,selection:head.selection,reference:head.selection.drawingReferences?.[0],sheet,geometry,sourceDocument,sourceBlob,pdf,png,one,U,makeReview,associations,supportOwners,stats,candidate:{buildingId:U(3),primaryEvidenceId:U(4),historicalEvidenceId:U(9),sourceFloors:[],roomMappings:[],guards:[{target:{authority:'atlas',recordType:'identity',recordId:U(3)},revision:{kind:'atlas',value:1}}]}};
}
async function app(createElement,useState,useLayoutEffect,createRoot,NativeSceneDrawing,createNativeSceneSourceClient,ExactDecimal,createNativeSceneAssociationClient,NativeSceneAssociation) {
  const h=createElement, f=await fixture(ExactDecimal,createNativeSceneAssociationClient), stats={opens:[],released:0,created:[],revoked:[],subscribed:0,unsubscribed:0,hiddenBeforeRelease:[],sourceWithdrawals:0};
  window.__stats=stats;stats.constructor=f.stats;
  window.__pendingUnknown=()=>f.associations.pending(f.U(3)).some(item=>item.outcome==='unknown');
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);stats.created.push(url);return url;};
  URL.revokeObjectURL=url=>{stats.revoked.push(url);revoke(url);};
  let selectionChanged=()=>{};
  const sourceClient=createNativeSceneSourceClient({getSelection:()=>f.selection,subscribeSelection:changed=>{selectionChanged=changed;return()=>{selectionChanged=()=>{};};},createDrawingReview:f.makeReview,
    geometry:{isCurrent:g=>g===f.geometry,subscribeInvalidation:()=>()=>{}},
    documents:{async open(id,signal){if(id!==f.selection.sceneEvidenceId||signal.aborted)throw Error('Synthetic source scope');return f.sourceDocument;},
      isCurrent:d=>d===f.sourceDocument,getBlob:()=>f.sourceBlob,subscribeInvalidation:()=>()=>{},release(){}}});
  if(window.__input.name==='lifecycle'){
    const probe=createNativeSceneSourceClient({getSelection:()=>f.selection,subscribeSelection:()=>()=>{},createDrawingReview:f.makeReview,
      geometry:{isCurrent:g=>g===f.geometry,subscribeInvalidation:()=>()=>{}},
      documents:{async open(){return f.sourceDocument;},isCurrent:d=>d===f.sourceDocument,getBlob:()=>f.sourceBlob,subscribeInvalidation:()=>()=>{},release(){}}});
    const frame=await probe.open(f.selection,f.geometry,new AbortController().signal);let withdrawn=0;
    probe.subscribeInvalidation(frame,()=>{withdrawn++;});f.supportOwners.at(-1).invalidate();
    if(probe.isCurrent(frame)||withdrawn!==1)throw Error('Support original withdrawal did not retire source frame');
    probe.dispose();stats.supportWithdrawal=true;
  }
  const source=await sourceClient.open(f.selection,f.geometry,new AbortController().signal);
  stats.projected=source.drawingReferences.length;
  if(source.drawingReferences.length){
    const data=source.electricalFixtures.data;
    if(data.roomMappingReceipt.id!==f.selection.acceptedRoomReceiptId||data.roomMappingReceipt.sha256!==f.selection.acceptedRoomReceiptSha256
      ||data.sheets[0].renderedPhotoSha256!==f.sheet.renderedPhotoSha256)throw Error('Historical ledger/current native review bridge failed');
    const proof=source.drawingProvenance;
    if(!proof||proof.historicalRoomMappingReceipt.id!=='synthetic-old-room-receipt'||proof.historicalRoomMappingReceipt.sha256!==f.oldSha
      ||proof.currentNativeRoomReview.id!==f.selection.acceptedRoomReceiptId||proof.currentNativeRoomReview.sha256!==f.selection.acceptedRoomReceiptSha256
      ||proof.historicalRoomMappingReceipt.id===proof.currentNativeRoomReview.id||proof.historicalRoomMappingReceipt.sha256===proof.currentNativeRoomReview.sha256
      ||proof.fixtureLedgerSha256!==f.ledgerSha)throw Error('Distinct historical and current provenance pins were not retained');
    stats.provenanceBridge=true;
  }
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
    window.__withdrawSource=()=>{f.selection={...f.selection,drawingReferences:f.selection.drawingReferences.map(r=>({...r,correlationSha256:'a'.repeat(64)}))};selectionChanged();};
    window.__invalidateSupport=()=>{for(const owner of f.supportOwners)owner.invalidate();};
    window.__shutdown=()=>{setOpened(false);sourceClient.dispose();f.associations.dispose();};
    return h('main',null,window.__input.name==='pdf-download'&&h('div',{id:'association-review'},h(NativeSceneAssociation,{client:f.associations,candidate:f.candidate,geometry:f.geometry,canPrepare:true,hasUnsavedDraft:false,onSubmissionStarted:()=>{},onSubmissionSettled:()=>{}})),h('button',{id:'room-open',disabled:!available,onClick:()=>setOpened(true)},'Open room drawing'),
      opened&&h(NativeSceneDrawing,{client:drawings,sheet:source.electricalFixtures.status==='available'?source.electricalFixtures.data.sheets[0]:f.sheet,evidenceIds:[f.U(7)],
        reference:source.drawingReferences[0],provenance:source.drawingProvenance,current:()=>available&&sourceClient.isCurrent(source),onClose:()=>setOpened(false)}));
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
  const association=join(frontend,'integration/native-scene-association-client.ts');
  const reader=join(frontend,'integration/native-scene-source-client.ts'),decimal=join(frontend,'src/numeric/decimal.ts');
  writeFileSync(module,'import {createElement,useState,useLayoutEffect} from "react";import {createRoot} from "react-dom/client";\n'+
    'import {NativeSceneDrawing} from '+JSON.stringify(component)+';import {createNativeSceneSourceClient} from '+JSON.stringify(reader)+';\n'+
    'import {createNativeSceneAssociationClient} from '+JSON.stringify(association)+';\n'+
    'import {NativeSceneAssociation} from '+JSON.stringify(join(frontend,'src/lantern/scans/native-ui/NativeSceneAssociation.tsx'))+';\n'+
    'import {ExactDecimal} from '+JSON.stringify(decimal)+';import '+JSON.stringify(join(frontend,'src/lantern/scans/native-ui/native-scene.css'))+';\n'+
    'window.__input='+JSON.stringify(input)+';\n'+fixture.toString()+'\n'+app.toString()+'\n'+
    'app(createElement,useState,useLayoutEffect,createRoot,NativeSceneDrawing,createNativeSceneSourceClient,ExactDecimal,createNativeSceneAssociationClient,NativeSceneAssociation).catch(e=>{window.__failed=e.message;});');
  writeFileSync(index,'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}main{padding:8px}button,a{font-size:16px}.native-scene-drawing{box-sizing:border-box}h3,p{overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  const dist=join(scratch,'dist');
  await build({configFile:false,root:generated,logLevel:'error',build:{outDir:dist,emptyOutDir:true,minify:false,rollupOptions:{input:index}}});
  const files=new Map();function collect(dir,prefix=''){for(const x of readdirSync(dir,{withFileTypes:true})){const path=join(dir,x.name),url=prefix+'/'+x.name;x.isDirectory()?collect(path,url):files.set(url,readFileSync(path));}}collect(dist);
  server=createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}const path=req.url==='/'?'/index.html':req.url;if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}const bytes=files.get(path);if(!bytes){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=spawn(browserPath,['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-features=MediaRouter,OptimizationHints','--user-data-dir='+join(scratch,'profile'),'about:blank'],{detached:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  report.owned.browserPid=browser.pid;
  cdp=new CDP(browser);report.browser=(await cdp.send('Browser.getVersion')).product;
  mkdirSync(join(scratch,'downloads'),{mode:0o700});
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(scratch,'downloads')});
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>cdp.send(method,params,sessionId);await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description??'Fixture JavaScript exception');return r.result.value;};
  const click=async selector=>{const r=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Fixture element missing");const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()');assert(r.w>0&&r.h>0);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:r.x,y:r.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:r.x,y:r.y});};
  const key=async(key,code,number)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:number});if(key==='Enter')await send('Input.dispatchKeyEvent',{type:'char',key,code,text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:number});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:number});};
  await send('Page.navigate',{url:origin+'/'});
  await until(async()=>{const failed=await evaluate('window.__failed');assert(!failed,failed);return evaluate('Boolean(document.querySelector("#room-open"))');},'source projection and room action');
  if(name==='pdf-download'){
    assert.equal(await evaluate('window.__stats.constructor.confirmationRefused'),true);
    assert.equal(await evaluate('window.__stats.constructor.posts'),0);
    for(const [index,text]of [[0,'Explicit generated drawing review'],[1,'Synthetic review only']]){
      await evaluate('document.querySelectorAll("#association-review textarea")['+index+'].focus()');
      await send('Input.insertText',{text});
    }
    await evaluate('Array.from(document.querySelectorAll("#association-review button")).find(b=>b.textContent.trim()==="Review retained originals").click()');
    await until(()=>evaluate('document.querySelector("#association-review h4")?.textContent==="Reference PDF review"'),'actual prepared support review');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#association-review button")).find(b=>b.textContent.trim()==="Submit reviewed association").disabled'),true);
    await evaluate('document.querySelector("#association-review input[type=checkbox]").scrollIntoView({block:"center"})');
    await click('#association-review input[type=checkbox]');
    await until(()=>evaluate('document.querySelector("#association-review input[type=checkbox]").checked && !Array.from(document.querySelectorAll("#association-review button")).find(b=>b.textContent.trim()==="Submit reviewed association").disabled'),'explicit confirmation enables submit');
    await evaluate('Array.from(document.querySelectorAll("#association-review button")).find(b=>b.textContent.trim()==="Submit reviewed association").click()');
    await until(()=>evaluate('window.__stats.constructor.posts===1'),'confirmed one fake POST');
    await until(()=>evaluate('document.querySelector("#association-review")?.textContent.includes("unknown outcome")'),'actual unknown preservation');
    assert.equal(await evaluate('window.__pendingUnknown()'),true);
    await evaluate('window.__stats.constructor.unknownPreserved=true');
    report.preparation={actualConstructor:true,unreviewedMarkerWithheld:true,unconfirmedNoPost:true,exactSummaryVisible:true,explicitCheckbox:true,confirmedFakePosts:1,unknownPreserved:true};
  }
  const wantProjection=['pdf-download','pdf-navigation','wrong-correlation','lifecycle'].includes(name)?1:0;
  assert.equal(await evaluate('window.__stats.projected'),wantProjection);
  const widths=[1280,768,390,312];
  for(const width of widths){
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width<=390});
    await click('#room-open');
    if(['missing-correlation','stale-correlation','wrong-correlation'].includes(name)){
      await until(()=>evaluate('Boolean(document.querySelector("[role=status]")?.textContent.includes("available"))'),'explicit unavailable');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing a[href], .native-scene-drawing img"))'),false);
      assert.equal(await evaluate('window.__stats.created.length'),0);
    }else if(name==='png-legacy'){
      await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing img")?.naturalWidth)'),'legacy PNG paint');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing a[href]"))'),false);
    }else{
      await until(()=>evaluate('Boolean(document.querySelector(".native-scene-drawing canvas.native-scene-pdf-canvas")?.width && document.querySelector(".native-scene-drawing a[download]"))'),'authenticated in-app PDF canvas and download action');
      assert.equal(await evaluate('Boolean(document.querySelector(".native-scene-drawing iframe, embed, object"))'),false);
      assert.equal(await evaluate('document.querySelector(".native-scene-pdf-canvas").width>0 && document.querySelector(".native-scene-pdf-canvas").height>0'),true,'PDF pages paint actual canvas pixels');
      const pixelProofExpression='(()=>{const c=document.querySelector(".native-scene-pdf-canvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data,colors=new Set();let nonwhite=0;for(let gy=0;gy<40;gy++)for(let gx=0;gx<40;gx++){const i=(Math.floor((gy+.5)*c.height/40)*c.width+Math.floor((gx+.5)*c.width/40))*4,p=[d[i],d[i+1],d[i+2]],key=p.join(",");colors.add(key);if(p[0]<245||p[1]<245||p[2]<245)nonwhite++}return{nonwhite,colors:colors.size}})()';
      await until(async()=>{const p=await evaluate(pixelProofExpression);return p.nonwhite>100&&p.colors>2},'nonblank rendered PDF canvas');
      const pixelProof=await evaluate(pixelProofExpression);
      assert(pixelProof.nonwhite>100&&pixelProof.colors>2,'Referenced PDF canvas contains actual rendered page pixels, not a blank frame');
      if(name==='pdf-navigation'){
        const screenshot=async()=>{
          const box=await evaluate('(()=>{const r=document.querySelector(".native-scene-pdf-canvas").getBoundingClientRect();return{x:r.x+Math.max(0,r.width*.2),y:r.y+Math.max(0,r.height*.2),width:Math.max(1,r.width*.6),height:Math.max(1,r.height*.6)}})()');
          return Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...box,scale:1}})).data,'base64');
        };
        const stableScreenshot=async(label)=>{
          const deadline=performance.now()+15000;let previous=null,count=0;
          while(performance.now()<deadline){
            const signature=screenshotSignature(await screenshot());
            const distance=previous?signatureDistance(previous,signature):null;
            // PDF rasterization and anti-aliasing can vary slightly between
            // captures. Compare downsampled RGB samples with a bounded tolerance.
            count=distance&&distance.mean<=0.5?count+1:1;
            if(count===3)return signature;
            previous=signature;await wait(250);
          }
          throw Error('In-app PDF canvas did not stabilize for '+label);
        };
        const page12Signature=await stableScreenshot('referenced page 12');
        if(width===1280){
          await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[1].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page 13 of 18")'),'rapid resize case page 13');
          await evaluate('document.querySelectorAll(".native-scene-pdf-zoom button")[1].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-pdf-zoom span")?.textContent==="200%"'),'rapid resize case zoom update');
          await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[1].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page 14 of 18")'),'rapid resize case page 14');
          await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[1].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page 15 of 18")'),'rapid resize case page 15');
          const rapid=await stableScreenshot('rapid page and zoom changes');
          const rapidPixels=await evaluate(pixelProofExpression);
          assert(rapidPixels.nonwhite>100&&rapidPixels.colors>2,'Rapidly changed PDF page and zoom finish with actual rendered page pixels');
          assert.equal(await evaluate('document.querySelector(".native-scene-drawing [role=status]")?.textContent||""'),'','Rapid PDF navigation settles without a reader error');
          report.results.push({width,rapidChangePage:15,canvasScreenshotSignatureSha256:hash(rapid)});
          for(let page=14;page>=12;page--){
            await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[0].click()');
            await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page '+page+' of 18")'),'restore rapid page '+page);
          }
          await evaluate('document.querySelectorAll(".native-scene-pdf-zoom button")[2].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-pdf-zoom span")?.textContent==="100%"'),'restore rapid test zoom');
          const restored=await stableScreenshot('page 12 after rapid zoom and navigation');
          assert(signatureDistance(page12Signature,restored).mean<=0.5,'Serialized rapid renders return to the same page 12 pixels');
        }
        let before=page12Signature;
        for(let page=13;page<=18;page++){
          await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[1].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page '+page+' of 18")'),'page '+page+' selected');
          const after=await stableScreenshot('synthetic page '+page);
          const distance=signatureDistance(before,after);
          assert(distance.mean>0.5&&distance.changed>=2,'Stable PDF.js rendered page content changes for synthetic page '+page);
          report.results.push({width,renderedSyntheticPage:page,canvasScreenshotSignatureSha256:hash(after)});
          before=after;
        }
        await evaluate('document.querySelectorAll(".native-scene-pdf-zoom button")[1].click()');
        await until(()=>evaluate('document.querySelector(".native-scene-pdf-canvas").getBoundingClientRect().width>document.querySelector(".native-scene-pdf").clientWidth'),'zoom changes canvas size');
        const zoomed=await stableScreenshot('synthetic zoom');
        const zoomDistance=signatureDistance(before,zoomed);
        assert(zoomDistance.mean>0.5&&zoomDistance.changed>=2,'Stable PDF.js rendered page content changes for synthetic zoom');
        report.results.push({width,zoomedSyntheticPage:18,canvasScreenshotSignatureSha256:hash(zoomed)});
        for(let page=17;page>=12;page--){
          await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[0].click()');
          await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page '+page+' of 18")'),'restore page '+page);
        }
        await evaluate('document.querySelectorAll(".native-scene-pdf-zoom button")[2].click()');
        await until(()=>evaluate('document.querySelector(".native-scene-pdf-canvas").getBoundingClientRect().width<=document.querySelector(".native-scene-pdf").clientWidth'),'restore referenced page and zoom');
        if(width===390){
          const closed=await stableScreenshot('page 12 after full traversal');
          assert(signatureDistance(page12Signature,closed).mean<=0.5,'Page 12 pixels return after traversing pages and zoom');
          await click('.native-scene-drawing > header button');
          await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'close before mobile reopen');
          await click('#room-open');
          await until(()=>evaluate('Boolean(document.querySelector(".native-scene-pdf-canvas")?.width)'),'reopened mobile page 12');
          const reopened=await stableScreenshot('reopened mobile page 12');
          assert(signatureDistance(page12Signature,reopened).mean<=0.5,'Reopened mobile reader renders the referenced page again');
          report.results.push({width,reopenedPage:12,canvasScreenshotSignatureSha256:hash(reopened)});
        }
      }
      assert.match(await evaluate('document.querySelector(".native-scene-drawing").textContent'),/Reference PDF · page 12/);
      assert.match(await evaluate('document.querySelector(".native-drawing-provenance").textContent'),/Historical room-mapping receipt.*synthetic-old-room-receipt.*Current native room review.*synthetic-new-native-review/s);
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Drawing source review');
      await key('Enter','Enter',13);await until(()=>evaluate('document.querySelector(".native-drawing-provenance").open'),'native Enter opens provenance disclosure');
      assert.match(await evaluate('document.querySelector(".native-drawing-provenance[open]").textContent'),/Historical room-mapping receipt.*synthetic-old-room-receipt.*Current native room review.*synthetic-new-native-review/s);
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Previous PDF page');
      await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[1].click()');
      await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page 13 of 18")'),'next page navigation');
      await evaluate('document.querySelectorAll(".native-scene-pdf-page button")[0].click()');
      await until(()=>evaluate('document.querySelector(".native-scene-drawing > div > p")?.textContent.includes("page 12 of 18")'),'previous page navigation');
      await evaluate('document.querySelectorAll(".native-scene-pdf-zoom button")[1].click()');
      await until(()=>evaluate('document.querySelector(".native-scene-pdf-canvas").getBoundingClientRect().width>document.querySelector(".native-scene-pdf").clientWidth'),'PDF zoom control');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.tagName'),'INPUT');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Next PDF page');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Zoom out PDF');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Zoom in PDF');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Reset zoom');
      await key('Tab','Tab',9);assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'),/page 12 of 18/,'Focus reaches the rendered PDF page region');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Download reference PDF');
      await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Close drawing');
      if(name==='pdf-download'){
        await click('.native-scene-drawing a[download]');
        const expected=join(scratch,'downloads','atlas-original-00000000-0000-4000-8000-000000000008.pdf');
        await until(()=>existsSync(expected),'ordinary blob PDF download');
        assert.deepEqual(readFileSync(expected),pdf,'Downloaded source bytes remain exact');
        report.results.push({width,downloadedBytes:pdf.length,sha256:hash(pdf),referencePage:12});
        rmSync(expected);
      }
    }
    assert.equal(await evaluate('document.documentElement.scrollWidth'),width,`${width}px dialog does not overflow horizontally`);
    await key('Escape','Escape',27);
    await until(()=>evaluate('!document.querySelector(".native-scene-drawing")'),'Escape closes');
    assert.equal(await evaluate('document.activeElement.id'),'room-open','Original room action focus restored');
  }
  if(name==='lifecycle'){
    assert.equal(await evaluate('window.__stats.supportWithdrawal'),true);
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
  assert.equal(stats.opens.length,widths.length+(name==='lifecycle'?2:0)+(name==='pdf-navigation'?1:0));
  assert.deepEqual(cdp.errors,[]);
  assert(cdp.requests.every(url=>url.startsWith(origin+'/')||url.startsWith('blob:'+origin+'/')),
    'Only owned loopback/blob requests; the PDF is rendered inside HouseAtlas without third-party viewers');
  await evaluate('window.__shutdown()');report.results.push({case:name,status:'passed',stats});
}catch(error){failure=error;report.failure={name:error.name,message:error.message};}
finally{
  try{await cleanup();}catch(error){failure??=error;report.cleanupFailure={name:error.name,message:error.message};clearTimeout(budget);}
  if(stopReason)failure??=stopReason;
  report.status=failure?'failed':'passed';writeFileSync(join(evidence,name+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(report,null,2));if(failure)throw failure;
