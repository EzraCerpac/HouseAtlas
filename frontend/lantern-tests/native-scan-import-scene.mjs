/** Named generated-only agent scene save through actual production factories.
 * Offline compiler + fake transport; no listener/browser/native DB or real file. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { transformWithOxc } from 'vite';
assert.equal(process.version,'v26.10.0');
process.on('uncaughtException',error=>{const frames=[...(error.stack??'').matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+):(\d+):(\d+)/g)].slice(0,8).map(m=>({line:Number(m[2]),sourceLine:Buffer.from(m[1],'base64').toString().split('\n')[Number(m[2])-1]?.slice(0,300)}));console.error(JSON.stringify({case:process.argv[2],status:'FAILED',error:error.name,message:error.message.slice(0,500),frames}));process.exitCode=1;});
const names=new Set(['committed','asset-unknown','evidence-unknown','association-unknown','floor-selection','literal-labels','scene-reuse','scene-replacement','stale-current-scene','changed-frame-current-scene','supplementary-unicode','compact-scene-head','viewer-inspect','native-room-target','native-room-target-explicit-null','native-room-target-other','native-room-target-floor-direct','native-room-target-many-to-one','native-room-target-invalid','native-room-target-wrong-classification','native-room-target-duplicate-classification','native-room-target-wrong-scope','native-room-target-owner-withdrawal','scene-import-before-dispatch','scene-import-prepare-refresh','scene-import-hook-refusal','retained-documents','retained-documents-unknown','retained-documents-before-dispatch']);
assert.equal(process.argv.length,3);const name=process.argv[2];assert(names.has(name),'Choose one registered case');
const frontend=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=dirname(frontend);
const require=createRequire(pathToFileURL(resolve(frontend,'package.json'))),loaded=new Map(),sourcePins={};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),data=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function source(file){
  if(loaded.has(file))return loaded.get(file);
  assert(file.startsWith(root+'/'),'Only selected repository modules');
  const original=readFileSync(file);sourcePins[file.slice(root.length+1)]=hash(original);
  let {code}=await transformWithOxc(original.toString(),file,{lang:file.endsWith('.tsx')?'tsx':'ts',target:'esnext',tsconfig:false,sourcemap:false});
  const imports=[...code.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map(m=>m[1]??m[2]);
  for(const specifier of new Set(imports)){
    let replacement;
    if(specifier.startsWith('.')){
      const raw=specifier.endsWith('?raw'),base=resolve(dirname(file),raw?specifier.slice(0,-4):specifier);
      if(raw){assert(base.startsWith(root+'/'));const bytes=readFileSync(base);sourcePins[base.slice(root.length+1)]=hash(bytes);replacement=data('export default '+JSON.stringify(bytes.toString())+';');}
      else if(base.endsWith('.json')){assert(base.startsWith(root+'/'));const bytes=readFileSync(base);sourcePins[base.slice(root.length+1)]=hash(bytes);replacement=data('export default '+bytes.toString()+';');}
      else{const target=[base,base+'.ts',base+'.tsx',base+'.js'].find(existsSync);assert(target,'Resolve actual source '+specifier);replacement=await source(target);}
    }else replacement=pathToFileURL(require.resolve(specifier)).href;
    code=code.replaceAll(JSON.stringify(specifier),JSON.stringify(replacement));
  }
  for(const m of code.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g))assert((m[1]??m[2]).startsWith('data:')||(m[1]??m[2]).startsWith('file:'));
  const url=data(code);loaded.set(file,url);return url;
}
const {createNativeScanSceneImporter,preflightNativeScanScene}=await import(await source(resolve(frontend,'integration/native-scan-import-scene.ts')));
let unicodeSupport=null;
async function runLiteralLabels(supplementary=false){
  const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),buildingId=U(3),sourceSha='a'.repeat(64);
  const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  const historical='{"profile":"synthetic-literal-label-review","observation":"generated only"}';
  const anchor={id:'synthetic-fixture-anchor',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,targets:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8)}],unresolvedLabels:[]};
  const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-literal-review',sourceReceiptSha256:hash(historical),anchors:[anchor]});
  const fixtures={schema:'houseatlas.documentary-electrical-fixtures.v1',viewKey:'synthetic-documentary-view',interpretationDate:'2026-10-11',
    symbolLegend:{xMeansSocket:null,socketsPerX:null,receiptId:null},roomMappingReceipt:{id:'synthetic-literal-review',sha256:hash(receipt)},registrationReceipts:[],
    sheets:[{id:'synthetic-sheet',title:'Generated drawing',pdfPage:1,originalPhoto:'generated/photo.jpg',originalPhotoSha256:'b'.repeat(64),renderedPhotoSha256:'c'.repeat(64),sourceDate:null,regionIds:['synthetic-region']}],
    groups:[{id:'synthetic-group',label:'F1',fixtureIds:['synthetic-fixture'],evidenceBasis:'historic-drawing-label',currentCircuitId:null,verifiedWiring:false}],
    regions:[{id:'synthetic-region',sheetId:'synthetic-sheet',label:'Generated region',sourceOutline:[],outlineClosed:false,sourceBounds:[0,0,1,1],outlineBasis:'untraced',
      places:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8),label:'Generated room',basis:'owner-reported'}],orientation:'unregistered',physicalTransform:null}],
    fixtures:[{id:'synthetic-fixture',sheetId:'synthetic-sheet',regionId:'synthetic-region',clusterId:null,kind:'socket',label:'Generated socket mark',glyph:'X',
      source:{symbolKey:'synthetic-symbol',originalPhotoSha256:'b'.repeat(64),renderedPhotoSha256:'c'.repeat(64),normalizedBox:[.3,.3,.4,.4],normalizedPoint:[.35,.35],literalLabels:['','F1'],placementDescription:''},
      group:{id:'synthetic-group',label:'F1',basis:'label-adjacent',note:''},glyphCount:1,fixtureCount:null,uncertainty:null,currentState:'historic-unverified',physicalCoordinate:null,wireRoute:null}]};
  const primary=JSON.stringify({schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:receipt,
    rooms:{status:'available',reason:null,receiptId:'synthetic-literal-review',receiptSha256:hash(receipt),entries:[{id:'synthetic-room',label:'Generated room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,
      sourceAnchorIds:[anchor.id],packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8),xFraction:.5,yFraction:.5}],regions:[]},
    network:{status:'unavailable',reason:'not-retained',source:null,devices:null,endpoints:null,links:null},
    electricity:{status:'unavailable',reason:'not-retained',documentarySource:null,roomRegistry:null,buildingPackageKey:null,retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:fixtures}});
  const file=(text,filename)=>({buildingId,file:new Blob([text],{type:'text/plain'}),filename,sha256:hash(text),byteSize:Buffer.byteLength(text),statement:'Reviewed generated documentary original',reason:'Generated literal evidence check',sourceLicense:{status:'unknown',reference:null}});
  const input={buildingId,primary:file(primary,'literal-scene.txt'),historical:file(historical,'literal-review.txt'),sourceFloors:[{sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha}],
    roomMappings:[{sourceRoomId:'synthetic-room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,sourceAnchorIds:[anchor.id],targets:anchor.targets,unresolvedLabels:[]}],
    statement:'Deliberately reviewed generated fixture source',reason:'Preserve literal evidence',confirmDrawingSupport:false};
  const originalFetch=globalThis.fetch;let transportCalls=0;
  globalThis.fetch=async()=>{transportCalls++;throw Error('Pure preflight must not perform HTTP');};
  try{assert.equal(await preflightNativeScanScene(input,AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),undefined);assert.equal(transportCalls,0);
    assert.equal(await input.primary.file.text(),primary,'Immutable primary bytes are not normalized');
    assert.deepEqual(JSON.parse(await input.primary.file.text()).electricalFixtures.documentaryFixtures.fixtures[0].source.literalLabels,['','F1']);
    const mappingJson=JSON.stringify({receiptId:'synthetic-historical-mapping'}),ledger=JSON.parse(JSON.stringify(fixtures));ledger.roomMappingReceipt={id:'synthetic-historical-mapping',sha256:hash(mappingJson)};
    const pdfBytes=new TextEncoder().encode('%PDF-1.7\nGenerated-only opaque download fixture\n%%EOF\n');
    const ledgerJson=JSON.stringify(ledger),crosswalk=canonical({profile:'houseatlas.documentary-sheet-pdf-correlation.v1',correlationId:'synthetic-crosswalk',fixtureLedgerSha256:hash(ledgerJson),
      pdf:{workspaceId:U(1),homeId:U(2),buildingId,evidenceId:U(20),evidenceRevision:1,assetId:U(21),assetRevision:1,sha256:supplementary?hash(pdfBytes):'f'.repeat(64),byteSize:supplementary?pdfBytes.length:1},
      references:[{sheetId:'synthetic-sheet',pdfPage:1,originalPhotoSha256:'b'.repeat(64),renderedPhotoSha256:'c'.repeat(64),pdfEmbeddedImageSha256:'d'.repeat(64)}]}),sourceReview='{"observation":"Generated reviewed source example"}';
    const review=canonical({profile:'houseatlas.documentary-sheet-pdf-review.v1',reviewId:'synthetic-review',crosswalkSha256:hash(crosswalk),roomMappingSha256:hash(mappingJson),sourceReviewJson:sourceReview,sourceReviewSha256:hash(sourceReview)});
    const retained=json=>({json,sha256:hash(json)}),support=JSON.stringify({schema:'houseatlas.documentary-scene-support.v1',roomMapping:retained(mappingJson),fixtureLedger:retained(ledgerJson),crosswalk:retained(crosswalk),review:retained(review)});
    const supported=JSON.parse(primary);supported.receiptCanonicalJson=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-literal-review',sourceReceiptSha256:hash(support),anchors:[anchor]});
    supported.rooms.receiptSha256=hash(supported.receiptCanonicalJson);supported.electricalFixtures.documentaryFixtures=ledger;
    const supportInput={...input,primary:file(JSON.stringify(supported),'supported-scene.txt'),historical:file(support,'support.txt'),confirmDrawingSupport:true};
    assert.equal(await preflightNativeScanScene(supportInput,AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),undefined,'Matching manifest scope permits reviewed support grammar');
    for(const selectedScope of [{workspaceId:U(90),homeId:U(2)},{workspaceId:U(1),homeId:U(91)}])
      await assert.rejects(preflightNativeScanScene(supportInput,AbortSignal.timeout(15000),selectedScope),'Cross-scope PDF support must refuse before custody');
    if(supplementary){
      const {readDocumentarySupport}=await import(await source(resolve(frontend,'integration/native-scene-documentary-support.ts')));
      const verified=await readDocumentarySupport(new TextEncoder().encode(support),()=>undefined);assert(verified);
      const markerPoints=[...verified.reviewMarker].length,statement='😀'.repeat(4096-markerPoints),reason='🧭'.repeat(1024);
      const selected={...supportInput,statement,reason};
      assert(statement.length>4096&&reason.length>1024,'Generated supplementary scalar text exposes UTF-16/code-point difference');
      assert.equal([...statement+verified.reviewMarker].length,4096);assert.equal([...reason].length,1024);
      assert.equal(await preflightNativeScanScene(selected,AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),undefined,'Support suffix is included in the 4096-code-point preflight limit');
      await assert.rejects(preflightNativeScanScene({...selected,statement:statement+'😀'},AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),'One extra scalar over the support-inclusive limit refuses');
      await assert.rejects(preflightNativeScanScene({...selected,reason:reason+'🧭'},AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),'One extra reason scalar refuses');
      await assert.rejects(preflightNativeScanScene({...selected,statement:'\ud800'},AbortSignal.timeout(15000),{workspaceId:U(1),homeId:U(2)}),'Unpaired surrogate remains invalid');
      unicodeSupport={primary:JSON.stringify(supported),history:support,anchors:[anchor],entries:supported.rooms.entries,pdfBytes,statement,reason,marker:verified.reviewMarker};
    }
    assert.equal(transportCalls,0,'Scope validation has zero HTTP or mutation');
  }finally{globalThis.fetch=originalFetch;}
  return {variant:'literal-labels',posts:0,transportCalls,literalLabels:['','F1'],outcome:'validated-before-writes'};
}
async function runFixture(mode=name){
const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope={workspaceId:U(1),homeId:U(2)},buildingId=U(3),geometryId=U(4),geomEvidenceId=U(5),originalId=U(6),derivativeId=U(7);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const supported=mode==='supplementary-unicode'?unicodeSupport:null;
const history=supported?.history??'{"profile":"synthetic-documentary-receipt","observation":"generated only"}',historySha=hash(history),sourceSha='a'.repeat(64);
const manyToOne=mode==='native-room-target-many-to-one';
const anchors=supported?.anchors??(manyToOne?[
  {id:'synthetic-source-anchor-a',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,targets:[{packagePlaceKey:'synthetic-room-a',packagePlaceUuid:U(8)}],unresolvedLabels:[]},
  {id:'synthetic-source-anchor-b',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,targets:[{packagePlaceKey:'synthetic-room-b',packagePlaceUuid:U(81)}],unresolvedLabels:[]},
]:[{id:'synthetic-source-anchor',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,targets:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8)}],unresolvedLabels:[]}]);
const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-room-review',sourceReceiptSha256:historySha,anchors}),receiptSha=hash(receipt);
const entries=supported?.entries??(manyToOne?anchors.map((anchor,n)=>({id:`synthetic-room-${n?'b':'a'}`,label:'Synthetic room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,
  sourceAnchorIds:[anchor.id],packagePlaceKey:anchor.targets[0].packagePlaceKey,packagePlaceUuid:anchor.targets[0].packagePlaceUuid,xFraction:0.5,yFraction:0.5})):
  [{id:'synthetic-room',label:'Synthetic room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,sourceAnchorIds:[anchors[0].id],packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8),xFraction:0.5,yFraction:0.5}]);
const primary=supported?.primary??JSON.stringify({schema:'houseatlas.native-scene-source.v1',receiptCanonicalJson:receipt,rooms:{status:'available',reason:null,receiptId:'synthetic-room-review',receiptSha256:receiptSha,entries,regions:[]},
  network:{status:'unavailable',reason:'not-retained',source:null,devices:null,endpoints:null,links:null},
  electricity:{status:'unavailable',reason:'not-retained',documentarySource:null,roomRegistry:null,buildingPackageKey:null,retrievedAt:null}});
const textInput=(text,filename)=>({buildingId,file:new Blob([text],{type:'text/plain'}),filename,sha256:hash(text),byteSize:Buffer.byteLength(text),statement:'Reviewed generated documentary source',reason:'Generated-only agent intake check',sourceLicense:{status:'unknown',reference:null}});
const nativeRoomTarget=mode.startsWith('native-room-target')||mode.startsWith('scene-import-')||mode.startsWith('retained-documents'),nativePlaceId=U(80);
const explicitAtlasPlaceId=mode==='native-room-target-explicit-null'?null:nativePlaceId;
const selectedTargets=nativeRoomTarget?anchors[0].targets.map(t=>({...t,atlasPlaceId:explicitAtlasPlaceId})):anchors[0].targets;
const input={buildingId,primary:textInput(primary,'scene.txt'),historical:textInput(history,'review.txt'),sourceFloors:[{sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,nativeGeometryId:geometryId}],
  roomMappings:manyToOne?entries.map((entry,n)=>({sourceRoomId:entry.id,sourceFloorKey:entry.sourceFloorKey,sourceOriginalSha256:entry.sourceOriginalSha256,
    sourceAnchorIds:entry.sourceAnchorIds,targets:anchors[n].targets.map(t=>({...t,atlasPlaceId:explicitAtlasPlaceId})),unresolvedLabels:[]})):
    [{sourceRoomId:'synthetic-room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,sourceAnchorIds:[anchors[0].id],targets:selectedTargets,unresolvedLabels:[]}],
  statement:supported?.statement??'Deliberately reviewed synthetic room association',reason:supported?.reason??'Generated scene save',confirmDrawingSupport:!!supported};
const context={sessionIdentity:{},session:{schemaVersion:1,actorId:U(9),csrfToken:'synthetic-not-a-credential',expiresAt:new Date(Date.now()+120000).toISOString()},
  view:{scope,canEdit:true},admission:{scope,revision:'synthetic-admission',commandIds:['atlas.asset.create','atlas.evidence.create','atlas.identity.replace','atlas.batch.execute','atlas.scene-association.create']}};
const listeners=new Set(),records=new Map(),blobs=new Map(),media=new Map(),calls=[],journal=[];let counter=100,current=null,savedScene=null,lastSceneRequest=null,currentUnavailableReason=null,geometryEpoch=0,headOverride=null,headHttpStatus=200,qualified409Responses=0;const headResponseBytes=[];
let observeReservationReads=false,activeEvidenceReads=0,maxEvidenceReads=0,rejectSceneBeforeDispatchOnce=mode==='retained-documents-before-dispatch'||mode==='scene-import-hook-refusal',
  refreshSceneAdmissionDuringDispatchOnce=mode==='retained-documents-before-dispatch'||mode==='scene-import-before-dispatch';
let refreshAdmissionDuringFreshGeometryOnce=mode==='scene-import-prepare-refresh';
const initialAdmissionRevision=context.admission.revision,initialSessionIdentity=context.sessionIdentity;
const target=(kind,id)=>({authority:'atlas',recordType:kind,recordId:id});
const set=(kind,id,payload,revision=1)=>{const r={target:target(kind,id),revision,lifecycle:'active',payload};records.set(kind+':'+id,r);return r;};
const provenance={source:null,sourceRevision:null,sourceConfidence:null,evidenceBasis:'unknown',factAt:null,retrievedAt:'2026-10-11T00:00:00Z',vantage:null,uncertainty:{status:'unknown',explanation:null}};
set('identity',buildingId,{kind:'location',evidenceIds:[geomEvidenceId]});
set('evidence',geomEvidenceId,{statement:'Synthetic geometry',provenance,supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId:originalId},{kind:'atlas-asset',assetId:derivativeId}]});
const assetPayload=(sha,bytes,type,purpose)=>({owner:'atlas',purpose,sha256:sha,byteSize:bytes,contentType:type,sourceLicense:{status:'unknown',reference:null},availability:'available',previewPolicy:'download-only',evidenceIds:[]});
const retainedReferences={primary:{evidenceId:U(40),originalAssetId:U(42),sha256:input.primary.sha256,evidenceRevision:1,originalAssetRevision:1},
  historical:{evidenceId:U(41),originalAssetId:U(43),sha256:input.historical.sha256,evidenceRevision:1,originalAssetRevision:1}};
if(mode.startsWith('retained-documents')){
  for(const [role,reference,file] of [['primary-scene',retainedReferences.primary,input.primary],['documentary-sheet',retainedReferences.historical,input.historical]]){
    const bytes=new Uint8Array(await file.file.arrayBuffer());
    set('asset',reference.originalAssetId,assetPayload(hash(bytes),bytes.length,'text/plain','evidence-original'));
    set('evidence',reference.evidenceId,{statement:'Generated retained '+role,provenance,supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId:reference.originalAssetId}]});
    blobs.set(reference.originalAssetId,bytes);media.set(hash(canonical({assetId:reference.originalAssetId,kind:'atlas-asset'})),reference.originalAssetId);
  }
  set('identity',buildingId,{kind:'location',evidenceIds:[geomEvidenceId,retainedReferences.primary.evidenceId,retainedReferences.historical.evidenceId]},3);
}
set('asset',originalId,assetPayload('b'.repeat(64),1,'model/vnd.usdz+zip','geometry-original'));
set('asset',derivativeId,assetPayload('c'.repeat(64),1,'application/vnd.houseatlas.magicplan-authored-mesh+json','derived-preview'));
set('geometry',geometryId,{producer:'magicplan',producerVersion:null,exportFormat:'usdz',originalAssetId:originalId,importedAt:'2026-10-11T00:00:00Z',coordinateUnits:'unknown',scale:null,transform:null,geometryVersion:1,previousGeometryId:null,mappings:[],evidenceIds:[geomEvidenceId]});
const topoIdentity=(id)=>({target:target('identity',id),revision:records.get('identity:'+id)?.revision??1,lifecycle:'active',payload:{kind:'location',evidenceIds:[geomEvidenceId]}});
const topoSemantics=(id,semanticKind)=>({target:target('location-semantics',U(83+Number(id.slice(-2)))),revision:1,lifecycle:'active',payload:{atlasId:id,semanticKind,reviewStatus:'accepted',evidenceIds:[geomEvidenceId]}});
const topoRelation={target:target('relation',U(85)),revision:1,lifecycle:'active',payload:{kind:'location-membership',membershipKind:'building',from:{kind:'atlas-record',ref:{recordType:'identity',recordId:buildingId}},to:{kind:'atlas-record',ref:{recordType:'identity',recordId:nativePlaceId}},reviewStatus:'accepted',uncertainty:{status:'unknown',explanation:null},evidenceIds:[geomEvidenceId]}};
if(supported){set('identity',buildingId,{kind:'location',evidenceIds:[geomEvidenceId,U(20)]});
  set('evidence',U(20),{statement:'Generated reviewed PDF',provenance,supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId:U(21)}]});
  set('asset',U(21),{...assetPayload(hash(supported.pdfBytes),supported.pdfBytes.length,'application/pdf','evidence-original'),evidenceIds:[U(20)]});
  blobs.set(U(21),supported.pdfBytes);media.set(hash(canonical({assetId:U(21),kind:'atlas-asset'})),U(21));}
const identity=()=>records.get('identity:'+buildingId),viewKey=()=>hash('current-view:'+identity().revision+':'+geometryEpoch),floorKey=()=>hash('current-floor:'+identity().revision+':'+geometryEpoch);
const buildingSemanticsId=U(86),nativePlaceSemanticsId=U(163),nativeSemanticKind=mode==='native-room-target-wrong-classification'?'building':mode==='native-room-target-other'?'other':mode==='native-room-target-floor-direct'?'floor':'room';
set('identity',nativePlaceId,{kind:'location',evidenceIds:[geomEvidenceId]});
set('location-semantics',buildingSemanticsId,{atlasId:buildingId,semanticKind:'building',reviewStatus:'accepted',evidenceIds:[geomEvidenceId]});
set('location-semantics',nativePlaceSemanticsId,{atlasId:nativePlaceId,semanticKind:nativeSemanticKind,reviewStatus:'accepted',evidenceIds:[geomEvidenceId]});
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function result(commandId,requestId,produced,digest){return {schemaVersion:3,commandId,requestId,resolvedScope:scope,status:'committed',replayed:false,operationId:U(++counter),data:{records:produced,auditIds:produced.map(()=>U(++counter)),requestDigest:digest}};}
async function transport(url,init){
  init.signal?.throwIfAborted();const path=new URL(url,'https://synthetic.invalid').pathname;calls.push({method:init.method,path});
  if(init.method==='POST'&&path.endsWith('/assets')){
    assert(init.body instanceof FormData);const metadata=JSON.parse(init.body.get('metadata')),file=init.body.get('file');
    assert.equal(file.type,'text/plain');assert.equal(file.name,metadata.filename);assert(!('capture' in metadata));
    if(mode==='asset-unknown')throw Error('Synthetic absent asset response');
    const assetId=U(++counter),bytes=new Uint8Array(await file.arrayBuffer()),p=assetPayload(hash(bytes),bytes.length,'text/plain','evidence-original');
    blobs.set(assetId,bytes);media.set(hash(canonical({assetId,kind:'atlas-asset'})),assetId);
    return json(result('atlas.asset.create',metadata.requestId,[set('asset',assetId,p)],'d'.repeat(64)));
  }
  if(init.method==='POST'&&path.endsWith('/commands')){
    const request=JSON.parse(init.body),intent={...request};delete intent.requestId;delete intent.approvalReceiptId;
    const digest=hash(canonical(intent));
    if(request.commandId==='atlas.batch.execute'){
      if(mode==='evidence-unknown')throw Error('Synthetic absent evidence response');
      assert.deepEqual(request.payload.commands.map(c=>c.commandId),['atlas.evidence.create','atlas.identity.replace']);
      assert(request.preconditions.guards.some(g=>g.target.recordType==='identity'));
      assert(request.preconditions.guards.some(g=>g.target.recordId===geomEvidenceId));
      const produced=request.payload.commands.map(c=>set(c.target.recordType,c.target.recordId,c.payload,(records.get(c.target.recordType+':'+c.target.recordId)?.revision??0)+1));
      return json(result(request.commandId,request.requestId,produced,digest));
    }
    assert.equal(request.commandId,'atlas.scene-association.create');assert([3,5].includes(identity().revision));
    lastSceneRequest=request;
    const actualGuard=(recordType,recordId)=>request.preconditions.guards.find(g=>g.target.recordType===recordType&&g.target.recordId===recordId);
    const hasGuard=(recordType,recordId)=>!!actualGuard(recordType,recordId);
    const assertCurrentGuard=(recordType,recordId)=>{const guard=actualGuard(recordType,recordId),record=records.get(recordType+':'+recordId);assert(guard&&record);
      assert.equal(guard.revision.kind,'atlas');assert.equal(guard.revision.value,record.revision,'Guard revision matches the existing current record GET');};
    assert(hasGuard('identity',buildingId),'Scene request guards the current building identity');
    assert(hasGuard('location-semantics',buildingSemanticsId),'Scene request guards its current accepted building classification, including null-target mappings');
    assertCurrentGuard('identity',buildingId);assertCurrentGuard('location-semantics',buildingSemanticsId);
    for(const mapped of request.payload.roomMappings.flatMap(m=>m.targets).filter(t=>t.atlasPlaceId!==null)){
      assert(hasGuard('identity',mapped.atlasPlaceId),'Scene request guards each selected native place identity');
      assert(hasGuard('location-semantics',nativePlaceSemanticsId),'Scene request guards each selected native accepted classification');
      assertCurrentGuard('identity',mapped.atlasPlaceId);assertCurrentGuard('location-semantics',nativePlaceSemanticsId);
    }
    if(supported){assert.equal(request.payload.reviewStatement,input.statement+supported.marker,'Actual production prepare preserves supplementary statement and exact support suffix');
      assert.equal([...request.payload.reviewStatement].length,4096);assert.equal([...request.reason].length,1024);assert.equal(request.reason,input.reason);}
    if(identity().revision===5){assert.equal(request.payload.previousAssociationId,current.recordId);assert.equal(request.payload.associationVersion,2);
      assert(request.preconditions.guards.some(g=>g.target.recordType==='scene-association'&&g.target.recordId===current.recordId&&g.revision.value===current.revision));}
    assert.equal(request.payload.sourceFloors[0].nativeFloorKey,floorKey(),'Uses post-text fresh native floor key');
    savedScene={schemaVersion:1,recordType:'scene-association',recordId:request.target.recordId,...scope,revision:1,lifecycle:'active',createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z',lastAuditId:U(++counter),payload:request.payload};
    if(mode==='association-unknown'||mode==='retained-documents-unknown')throw Error('Synthetic absent association response');
    current=savedScene;set('scene-association',current.recordId,current.payload);return json(result(request.commandId,request.requestId,[{target:request.target,revision:1,lifecycle:'active',payload:request.payload}],digest));
  }
  assert.equal(init.method,'GET');
  if(path.endsWith('/invoke')){
    const request=JSON.parse(new URL(url,'https://synthetic.invalid').searchParams.get('request'));
    assert.equal(request.context.workspaceId,scope.workspaceId);assert.equal(request.context.homeId,scope.homeId);
    assert.equal(request.payload.includeArchived,false);assert.equal(request.payload.pageSize,100);
    const topIdentities=[topoIdentity(buildingId),topoIdentity(nativePlaceId)];
    const topSemantics=[topoSemantics(buildingId,'building'),topoSemantics(nativePlaceId,mode==='native-room-target-wrong-classification'?'building':mode==='native-room-target-other'?'other':mode==='native-room-target-floor-direct'?'floor':'room')];
    if(mode==='native-room-target-duplicate-classification')topSemantics.push({...topoSemantics(nativePlaceId,'room'),target:target('location-semantics',U(164))});
    const records=request.commandId==='atlas.identity.list'
      ?request.payload.buildingId===buildingId?mode==='native-room-target-invalid'||mode==='native-room-target-wrong-scope'?topIdentities.filter(r=>r.target.recordId===buildingId):topIdentities:topIdentities
      :request.commandId==='atlas.location-semantics.list'?topSemantics
      :request.commandId==='atlas.relation.list'&&!['native-room-target-invalid','native-room-target-wrong-scope'].includes(mode)?[topoRelation]:[];
    if(mode==='native-room-target-floor-direct'&&request.commandId==='atlas.relation.list')topoRelation.payload.membershipKind='building';
    assert(['atlas.identity.list','atlas.location-semantics.list','atlas.relation.list'].includes(request.commandId));
    if(mode==='native-room-target-owner-withdrawal'&&!globalThis.__withdrawn){globalThis.__withdrawn=true;context.admission={...context.admission,revision:'synthetic-withdrawn'};setTimeout(()=>{for(const changed of [...listeners])changed();},25);}
    const resolvedScope=mode==='native-room-target-wrong-scope'?{...scope,homeId:U(9998)}:scope;
    return new Response(JSON.stringify({schemaVersion:3,commandId:request.commandId,requestId:request.requestId,resolvedScope,status:'read',replayed:false,
      data:{records,nextCursor:null,sourceStatus:'current'}}),{headers:{'content-type':'application/json','x-atlas-snapshot-sha256':'d'.repeat(64)}});
  }
  if(path.endsWith('/buildings/'+buildingId)){
    if(refreshAdmissionDuringFreshGeometryOnce&&identity().revision===3){
      refreshAdmissionDuringFreshGeometryOnce=false;await Promise.resolve();context.admission={...context.admission,revision:'synthetic-refreshed'};
    }
    const nativeFloor={key:floorKey(),exportLabel:'Generated floor',originalSha256:'b'.repeat(64),derivativeSha256:'c'.repeat(64),geometryId,geometryRevision:records.get('geometry:'+geometryId).revision,evidenceId:geomEvidenceId,evidenceRevision:1,originalAssetId:originalId,originalRevision:1,derivativeAssetId:derivativeId,derivativeRevision:1,originalLicense:{status:'unknown',reference:null},derivativeLicense:{status:'unknown',reference:null}};
    const buildingPath=`/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
    const descriptor={schemaVersion:1,profile:'houseatlas.magicplan-authored-mesh.v1',scope,buildingId,viewKey:viewKey(),floors:[{floor:nativeFloor,readPath:`${buildingPath}/frames/${viewKey()}/meshes/${floorKey()}`}],physicalScale:'unknown',floorAlignment:'unknown',stageToHouseTransform:null};
    return new Response(JSON.stringify(descriptor),{headers:{'content-type':'application/json','x-atlas-geometry-view':viewKey()}});
  }
  if(path.endsWith('/current')){
    if(currentUnavailableReason)return json({status:'unavailable',reason:currentUnavailableReason,association:null});
    if(current&&current.payload.sourceFloors[0].nativeGeometryRevision!==records.get('geometry:'+geometryId).revision)return json({status:'unavailable',reason:'current-source-unavailable',association:null});
    if(current&&current.payload.sourceFloors[0].nativeFloorKey!==floorKey()){qualified409Responses++;return new Response(null,{status:409});}
    return json(current?{status:'available',association:current}:{status:'unavailable',reason:'no-current-association',association:null});
  }
  if(path.endsWith('/head')){
    assert.equal(path,`/api/atlas/scene/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}/head`);
    assert.equal(new URL(url,'https://synthetic.invalid').search,'');assert.equal(init.method,'GET');
    assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
    if(headHttpStatus!==200)return new Response(null,{status:headHttpStatus});
    const unavailable=currentUnavailableReason||(current&&current.payload.sourceFloors.some(f=>f.nativeGeometryRevision!==records.get('geometry:'+f.nativeGeometryId)?.revision)?'current-source-unavailable':null);
    const response=headOverride??{schema:'houseatlas.native-scene-head.v1',scope,buildingId,
      status:unavailable||!current?'unavailable':'available',reason:unavailable||(!current?'no-current-association':null),
      head:unavailable||!current?null:{recordId:current.recordId,revision:current.revision,payloadSha256:hash(canonical(current.payload))}};
    headResponseBytes.push(Buffer.byteLength(JSON.stringify(response)));return json(response);
  }
  const m=path.match(/\/records\/([^/]+)\/([^/]+)$/);
  if(m){if(mode==='evidence-not-dispatched'&&m[1]==='identity'&&calls.some(c=>c.method==='POST'))throw Error('Synthetic next-step read unavailable');
    if(observeReservationReads&&m[1]==='evidence'){activeEvidenceReads++;maxEvidenceReads=Math.max(maxEvidenceReads,activeEvidenceReads);await Promise.resolve();activeEvidenceReads--;}
    const r=records.get(m[1]+':'+m[2]);assert(r,'Existing generated record '+m[1]+':'+m[2]);return json({schemaVersion:3,commandId:`atlas.${m[1]}.get`,requestId:U(++counter),resolvedScope:scope,status:'read',replayed:false,data:{sourceStatus:'current',nextCursor:null,records:[r]}});}
  if(path.endsWith('/download')){const digest=path.split('/').at(-2),assetId=media.get(digest);assert(assetId);const bytes=blobs.get(assetId);return new Response(bytes,{headers:{'content-type':assetId===U(21)?'application/pdf':'text/plain','content-length':String(bytes.length),'content-disposition':'attachment; filename="generated.txt"'}});}
  throw Error('Unexpected generated route '+path);
}
const options={getContext:()=>context,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},origin:'https://synthetic.invalid',transport,
  async beforeDispatch(kind,request){if(rejectSceneBeforeDispatchOnce&&kind==='scene-association'){rejectSceneBeforeDispatchOnce=false;throw Error('Synthetic local before-dispatch hook refusal');}
    if(refreshSceneAdmissionDuringDispatchOnce&&kind==='scene-association'){
      refreshSceneAdmissionDuringDispatchOnce=false;await Promise.resolve();
      context.admission={...context.admission,revision:'synthetic-refreshed'};
    }
    journal.push({kind,requestId:request.requestId,state:'before'});assert(!JSON.stringify(request).includes(context.session.csrfToken));},
  async afterResult(kind,result){journal.push({kind,requestId:result.requestId,state:result.outcome});if((mode==='asset-journal-incomplete'&&kind==='text-asset'||mode==='evidence-journal-incomplete'&&kind==='text-evidence'||mode==='scene-journal-incomplete'&&kind==='scene-association'&&journal.filter(row=>row.kind===kind&&row.state==='committed').length===1)&&result.outcome==='committed')throw Error('Synthetic journal completion unavailable');}};
const client=createNativeScanSceneImporter(options);
let outcome,continuationOutcome=null;const budget=AbortSignal.timeout(15000);
try{
  if(name.startsWith('retained-documents')){
    await assert.rejects(client.associateRetainedScene(input,{...retainedReferences,primary:{...retainedReferences.primary,sha256:'e'.repeat(64)}},budget),
      'A mismatched retained-source digest refuses before native writes');
    assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(journal.length,0);assert.equal(client.isConsumed(),false);
    await assert.rejects(client.associateRetainedScene(input,{...retainedReferences,primary:{...retainedReferences.primary,evidenceRevision:2}},budget),
      'A stale retained evidence revision refuses after its genuine read lease and before writes');
    assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(journal.length,0);assert.equal(client.isConsumed(),false);
    if(name==='retained-documents-before-dispatch'){
      const hookRefusal=await client.associateRetainedScene(input,retainedReferences,budget);
      assert.equal(hookRefusal.outcome,'not-dispatched','A rejected local hook reports no scene request');
      assert.equal(calls.filter(c=>c.method==='POST').length,0,'Rejected pre-dispatch hook sends no scene request');
      assert.equal(journal.length,0,'Rejected local hook creates no before/unknown journal rows');
      assert.equal(client.isConsumed(),false,'Rejected local hook does not consume the retained continuation');
      assert.equal(client.isHeld(),false,'Rejected local hook creates no reconciliation hold');
      const refreshed=await client.associateRetainedScene(input,retainedReferences,budget);
      assert.equal(refreshed.outcome,'not-dispatched','A successful awaited hook followed by current admission refresh is a known pre-dispatch refusal');
      assert.equal(calls.filter(c=>c.method==='POST').length,0,'Admission refresh before pending registration sends no scene request');
      assert.deepEqual(journal.map(entry=>entry.state),['before'],'No unknown result is journaled without a pending request');
      assert.equal(client.isConsumed(),false,'Pre-pending source invalidation leaves retained continuation reusable');
      assert.equal(client.isHeld(),false,'Pre-pending source invalidation creates no unusable reconciliation hold');
      assert.equal(context.admission.revision,'synthetic-refreshed','The refreshed synthetic admission tuple stays current');
      assert.equal(initialAdmissionRevision,'synthetic-admission','The source captured the original admission revision before the hook');
      assert.equal(context.admission.scope,scope,'The synthetic refresh preserves workspace/home scope');
      assert.deepEqual(context.admission.commandIds,['atlas.asset.create','atlas.evidence.create','atlas.identity.replace','atlas.batch.execute','atlas.scene-association.create'],
        'The synthetic refresh preserves every command grant');
      assert.equal(context.view.canEdit,true,'The synthetic refresh preserves editability');
      assert.equal(context.sessionIdentity,initialSessionIdentity,'The same synthetic session remains active');
      const freshHead=await client.capturePriorScene(buildingId,budget);
      assert.equal(freshHead.status,'unavailable','A deliberately fresh selection captures the current absent scene head');
    }
    outcome=await client.associateRetainedScene(input,retainedReferences,budget);
    assert.equal(calls.filter(c=>c.method==='POST').length,1,'Retained association uses exactly one scene POST');
    assert(calls.filter(c=>c.method==='POST').every(c=>c.path.endsWith('/commands')),'No asset/evidence custody endpoint is used');
    assert.equal(lastSceneRequest.payload.roomMappings[0].targets[0].atlasPlaceId,nativePlaceId,
      'The retained-document continuation preserves the selected current Atlas identity');
    assert.equal(identity().revision,3);assert.deepEqual(identity().payload.evidenceIds,
      [geomEvidenceId,retainedReferences.primary.evidenceId,retainedReferences.historical.evidenceId]);
    assert(lastSceneRequest.preconditions.guards.some(g=>g.target.recordType==='location-semantics'&&g.target.recordId===buildingSemanticsId),
      'Retained request includes the current building classification guard');
    if(name==='retained-documents-unknown'){
      assert.equal(outcome.outcome,'unknown');assert(client.isHeld());
      assert.deepEqual(journal.map(entry=>entry.state),['before','unknown']);
      await assert.rejects(client.associateRetainedScene(input,retainedReferences,budget),'Unknown retained request cannot be resent');
      assert.equal(calls.filter(c=>c.method==='POST').length,1);
      current=savedScene;set('scene-association',current.recordId,current.payload);
      outcome=await client.reconcileRetainedScene(budget);assert.equal(outcome.outcome,'committed');
      assert.equal(calls.filter(c=>c.method==='POST').length,1,'Retained reconciliation performs GET-only resolution');
      assert.equal(client.isHeld(),false);
    }else{
      assert.equal(outcome.outcome,'committed');
      assert.equal(outcome.current.payload.sourceDocuments[0].evidenceId,retainedReferences.primary.evidenceId);
      assert.equal(outcome.current.payload.sourceDocuments[0].originalAssetId,retainedReferences.primary.originalAssetId);
      assert.equal(outcome.current.payload.sourceDocuments[1].evidenceId,retainedReferences.historical.evidenceId);
      assert.equal(outcome.current.payload.sourceDocuments[1].originalAssetId,retainedReferences.historical.originalAssetId);
      const expectedJournal=name==='retained-documents-before-dispatch'?['before','before','committed']:['before','committed'];
      assert(journal.every(entry=>entry.kind==='scene-association'));
      assert.deepEqual(journal.map(entry=>entry.state),expectedJournal);assert.equal(client.isHeld(),false);
    }
    assert.equal(client.isConsumed(),true);
  }else if(name==='floor-selection'){
    const pure={...input,sourceFloors:input.sourceFloors.map(({sourceFloorKey,sourceOriginalSha256})=>({sourceFloorKey,sourceOriginalSha256}))};
    assert.equal(await preflightNativeScanScene(pure,budget,scope),undefined,'Pure validation returns no synthetic native frame');
    assert.equal(await preflightNativeScanScene({...pure,roomMappings:pure.roomMappings.map(m=>({...m,targets:m.targets.map(t=>({...t,atlasPlaceId:null}))}))},budget,scope),undefined,
      'Explicit null remains compatible with the omitted native identity');
    for(const glyph of ['x','😀']){
      const boundary=glyph.repeat(512),boundaryTarget={...anchors[0].targets[0],packagePlaceKey:boundary};
      const boundaryAnchors=anchors.map(a=>({...a,id:boundary,sourceFloorKey:boundary,targets:[boundaryTarget]}));
      const boundaryPrimary=JSON.parse(primary);boundaryPrimary.receiptCanonicalJson=canonical({profile:'houseatlas.native-scene-room-review.v1',
        receiptId:'synthetic-room-review',sourceReceiptSha256:historySha,anchors:boundaryAnchors});
      boundaryPrimary.rooms.receiptSha256=hash(boundaryPrimary.receiptCanonicalJson);
      boundaryPrimary.rooms.entries=boundaryPrimary.rooms.entries.map(e=>({...e,id:boundary,sourceFloorKey:boundary,sourceAnchorIds:[boundary],packagePlaceKey:boundary}));
      const boundaryInput={...pure,primary:textInput(JSON.stringify(boundaryPrimary),'schema-boundary.txt'),
        sourceFloors:pure.sourceFloors.map(f=>({...f,sourceFloorKey:boundary})),roomMappings:pure.roomMappings.map(m=>({...m,
          sourceRoomId:boundary,sourceFloorKey:boundary,sourceAnchorIds:[boundary],targets:[boundaryTarget]}))};
      assert.equal(await preflightNativeScanScene(boundaryInput,budget,scope),undefined,'Published 512-code-point source identifiers preserve ASCII and supplementary characters');
    }
    assert.equal(calls.length,0,'Pure preflight has no HTTP or authentication');
    for(const field of ['rooms','network','electricity','electricalFixtures']){
      const malformed=JSON.parse(primary);if(field==='electricalFixtures'){malformed.schema='houseatlas.native-scene-source.v2';malformed.electricalFixtures={status:'available',reason:null,documentaryFixtures:{unexpected:true}};}
      else malformed[field].unexpected=true;
      await assert.rejects(preflightNativeScanScene({...pure,primary:textInput(JSON.stringify(malformed),'malformed.txt')},budget,scope),'Closed '+field+' grammar refuses before writes');
      assert.equal(calls.length,0,'Malformed source has zero transport calls');
    }
    await assert.rejects(preflightNativeScanScene({...pure,roomMappings:[{...pure.roomMappings[0],extra:'unreviewed'}]},budget,scope));
    assert.equal(calls.length,0);
    for(const mapping of [{...input.roomMappings[0],targets:[...input.roomMappings[0].targets,{packagePlaceKey:'foreign-room',packagePlaceUuid:U(99)}]},
      {...input.roomMappings[0],targets:[]},{...input.roomMappings[0],unresolvedLabels:['invented unresolved label']}]){
      await assert.rejects(preflightNativeScanScene({...pure,roomMappings:[mapping]},budget,scope));assert.equal(calls.length,0,'Exact target/unresolved unions refuse before HTTP');}
    await assert.rejects(preflightNativeScanScene({...pure,roomMappings:[{...pure.roomMappings[0],targets:pure.roomMappings[0].targets.map(t=>({...t,atlasPlaceId:'not-a-uuid'}))}]},budget,scope),'Malformed Atlas identity is refused before reads');
    await assert.rejects(preflightNativeScanScene({...pure,roomMappings:[{...pure.roomMappings[0],targets:[
      {...pure.roomMappings[0].targets[0],atlasPlaceId:U(81)},
      {...pure.roomMappings[0].targets[0],packagePlaceKey:'foreign-package-target',atlasPlaceId:U(81)}]}]},budget,scope),'A foreign package target is refused even when its native identity is valid');
    assert.equal(calls.length,0,'Malformed and duplicate target examples make no transport calls');
    const joinedAnchors=[{...anchors[0],unresolvedLabels:['Reviewed first span']},{...anchors[0],id:'synthetic-second-anchor',unresolvedLabels:['Reviewed second span']}];
    const joinedPrimary=JSON.parse(primary);joinedPrimary.receiptCanonicalJson=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-room-review',sourceReceiptSha256:historySha,anchors:joinedAnchors});
    joinedPrimary.rooms.receiptSha256=hash(joinedPrimary.receiptCanonicalJson);joinedPrimary.rooms.entries[0].sourceAnchorIds=joinedAnchors.map(a=>a.id);
    const joinedMapping={...input.roomMappings[0],sourceAnchorIds:joinedAnchors.map(a=>a.id),targets:anchors[0].targets,unresolvedLabels:joinedAnchors.flatMap(a=>a.unresolvedLabels)},
      joinedInput={...pure,primary:textInput(JSON.stringify(joinedPrimary),'joined-anchors.txt'),roomMappings:[joinedMapping]};
    assert.equal(await preflightNativeScanScene(joinedInput,budget,scope),undefined,'All reviewed targets and unresolved labels from multiple anchors qualify');
    for(const mapping of [{...joinedMapping,targets:[]},{...joinedMapping,unresolvedLabels:joinedMapping.unresolvedLabels.slice(0,1)}])
      await assert.rejects(preflightNativeScanScene({...joinedInput,roomMappings:[mapping]},budget,scope),'Omitting a second reviewed anchor member refuses before HTTP');
    assert.equal(calls.length,0);
    assert.equal(await preflightNativeScanScene({...pure,statement:'☃'.repeat(4096),reason:'☃'.repeat(1024)},budget,scope),undefined,'Scene uses its existing 1MiB command limit, not the text retained-lookup cap');assert.equal(calls.length,0);
    const wideScene=JSON.parse(primary),wideEntries=Array.from({length:11},(_,n)=>({...wideScene.rooms.entries[0],id:'synthetic-capacity-room-'+n}));
    wideScene.rooms.entries=wideEntries;
    const wideInput={...pure,primary:textInput(JSON.stringify(wideScene),'wide-guard-capacity.txt'),roomMappings:wideEntries.map((entry,n)=>({...input.roomMappings[0],
      sourceRoomId:entry.id,targets:input.roomMappings[0].targets.map(target=>({...target,atlasPlaceId:U(8100+n)}))}))};
    assert.equal(await preflightNativeScanScene(wideInput,budget,scope),undefined,
      'Eleven explicit Atlas targets reserve identity and classification guard width while retaining the scene request ceiling');
    assert.equal(calls.length,0,'Worst-width guard reservation remains pure preflight');
    await assert.rejects(client.importScene({...input,sourceFloors:[]},budget));assert.equal(calls.filter(c=>c.method==='POST').length,0);
    for(const count of [98,60]){const ids=[geomEvidenceId,...Array.from({length:count-1},(_,i)=>U(1000+i))];
      for(const id of ids.slice(1))set('evidence',id,{statement:'Generated prior evidence',provenance,supersedesEvidenceIds:[],references:[]});
      set('identity',buildingId,{kind:'location',evidenceIds:ids});
      observeReservationReads=true;
      try{await assert.rejects(client.importScene(input,budget),'Both text reservations reject capacity before any asset');}finally{observeReservationReads=false;}
      assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(client.isConsumed(),false);}
    assert.equal(maxEvidenceReads,1,'Prior evidence reads settle sequentially within the shared reservation budget');assert.equal(activeEvidenceReads,0);
    set('identity',buildingId,{kind:'location',evidenceIds:[geomEvidenceId]});
    const readsBeforeRace=calls.length,journalBeforeRace=journal.length;let contextReads=0,raceArmed=false;
    const switchedContext={...context,view:{...context.view,scope:{...scope,homeId:U(9998)}},admission:{...context.admission,scope:{...scope,homeId:U(9998)}}};
    const raced=createNativeScanSceneImporter({...options,getContext:()=>!raceArmed||++contextReads===1?context:switchedContext});raceArmed=true;
    try{await assert.rejects(raced.importScene(input,budget),'Owner changed after pure scope validation must refuse before custody');
      assert.equal(calls.length,readsBeforeRace,'Changed preflight owner is detected before first native read');
      assert.equal(journal.length,journalBeforeRace,'Changed owner never claims custody');assert.equal(raced.isConsumed(),false);
    }finally{raced.dispose();}
    outcome={outcome:'refused-before-writes'};
  }else if(['native-room-target-invalid','native-room-target-wrong-classification','native-room-target-duplicate-classification',
    'native-room-target-wrong-scope','native-room-target-owner-withdrawal'].includes(name)){
    await assert.rejects(client.importScene(input,budget),'An invalid, ambiguous, stale-scope, or withdrawn native target refuses before documentary custody');
    assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(journal.length,0);assert.equal(client.isConsumed(),false);
    assert(calls.some(c=>c.path.endsWith('/invoke')),'The real bounded topology list owner was exercised');
    outcome={outcome:'refused-before-custody'};
  }else{
    outcome=await client.importScene(input,budget);
    if(name==='native-room-target'||name==='native-room-target-explicit-null'||name==='native-room-target-other'||name==='native-room-target-floor-direct'||name==='native-room-target-many-to-one'){
      assert.equal(outcome.outcome,'committed');
      assert.equal(outcome.current.payload.roomMappings[0].targets[0].atlasPlaceId,explicitAtlasPlaceId,
        'Explicit Atlas identity survives preflight, prepare and submit');
      if(name==='native-room-target-many-to-one'){
        assert.equal(outcome.current.payload.roomMappings.length,2,'Both independently reviewed package rooms reach scene preparation');
        assert.deepEqual(outcome.current.payload.roomMappings.map(m=>m.targets[0].atlasPlaceId),[nativePlaceId,nativePlaceId],
          'Many-to-one package targets retain the shared selected native place');
      }
      assert(lastSceneRequest.preconditions.guards.some(g=>g.target.recordType==='location-semantics'&&g.target.recordId===buildingSemanticsId),
        'Current building classification guard is present in the bounded scene request');
      if(typeof explicitAtlasPlaceId==='string')assert(lastSceneRequest.preconditions.guards.some(g=>g.target.recordType==='identity'&&g.target.recordId===nativePlaceId)
        &&lastSceneRequest.preconditions.guards.some(g=>g.target.recordType==='location-semantics'&&g.target.recordId===nativePlaceSemanticsId),
        'Explicit Atlas target reserves and carries identity plus accepted-classification guards');
      assert(Buffer.byteLength(JSON.stringify(lastSceneRequest))<=1024*1024,'Positive guarded request remains within the existing 1 MiB ceiling');
      const posts=calls.filter(c=>c.method==='POST').length,fresh=createNativeScanSceneImporter(options);
      try{
        const exact=await fresh.inspectCurrentScene(input,budget,{recordId:outcome.current.recordId,payload:outcome.current.payload});
        assert.equal(exact.recordId,outcome.current.recordId,'Exact current selection reuses the same native target');
        const changed={...input,roomMappings:input.roomMappings.map(m=>({...m,targets:m.targets.map(t=>({...t,atlasPlaceId:U(81)}))}))};
        assert.equal(await fresh.inspectCurrentScene(changed,budget),null,'A different native identity cannot reuse the prepared selection');
      }finally{fresh.dispose();}
      assert.equal(calls.filter(c=>c.method==='POST').length,posts,'Native target comparison stays GET-only');
    }
    if(name==='scene-import-before-dispatch'||name==='scene-import-prepare-refresh'||name==='scene-import-hook-refusal'){
      assert.equal(outcome.outcome,'not-dispatched','Post-custody owner refresh is reported as a known non-dispatch');
      assert.equal(outcome.phase,'scene-association');assert.equal(client.isConsumed(),true,'Committed documentary custody remains claimed');
      assert.equal(client.isHeld(),true,'The original importer remains consumed while its docs need the returned continuation');
      assert.deepEqual(outcome.references,{primary:{evidenceId:outcome.primary.evidenceId,originalAssetId:outcome.primary.assetId,sha256:input.primary.sha256},
        historical:{evidenceId:outcome.historical.evidenceId,originalAssetId:outcome.historical.assetId,sha256:input.historical.sha256}},
        'The typed result closes the existing source identities and original hashes');
      assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/assets')).length,2,'Both original text assets were committed once');
      assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/commands')).length,2,'Both text evidence custody batches were committed once');
      assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/commands')).length+calls.filter(c=>c.method==='POST'&&c.path.endsWith('/assets')).length,4);
      assert.equal(lastSceneRequest,null,'No scene request was prepared for transmission after the admission refresh');
      assert.deepEqual(journal.filter(entry=>entry.kind==='scene-association').map(entry=>entry.state),
        name==='scene-import-before-dispatch'?['before']:[],
        'The scene has no unknown journal result because no pending request was registered');
      const continuation=createNativeScanSceneImporter(options),beforeContinuationPosts=calls.filter(c=>c.method==='POST').length;
      try{
        continuationOutcome=await continuation.associateRetainedScene(input,outcome.references,budget);
        assert.equal(continuationOutcome.outcome,'committed','The documented retained-document path deliberately completes the scene');
        assert.equal(continuationOutcome.current.payload.sourceDocuments[0].evidenceId,outcome.primary.evidenceId);
        assert.equal(continuationOutcome.current.payload.sourceDocuments[1].evidenceId,outcome.historical.evidenceId);
        assert.equal(calls.filter(c=>c.method==='POST').length,beforeContinuationPosts+1,'Continuation submits only one scene command');
        assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/assets')).length,2,'Continuation does not recreate either text asset');
        assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/commands')).length,3,'Continuation adds no text evidence batch');
        assert.equal(continuation.isHeld(),false);
      }finally{continuation.dispose();}
    }
    if(['asset-journal-incomplete','evidence-not-dispatched','evidence-journal-incomplete'].includes(mode)){
      const posts=mode==='evidence-journal-incomplete'?2:1;
      assert.equal(outcome.outcome,'partial');assert.equal(calls.filter(c=>c.method==='POST').length,posts);assert(client.isHeld());
      assert.equal(journal.filter(row=>row.kind==='text-asset'&&row.state==='committed').length,1);
      assert.equal(journal.filter(row=>row.kind==='text-asset'&&row.state==='unknown').length,0,'Terminal asset is never downgraded');
      assert.equal(outcome.assetRequestId,journal.find(row=>row.kind==='text-asset'&&row.state==='before').requestId);
      if(mode==='evidence-not-dispatched')assert.equal(outcome.requestId,null,'No evidence request was dispatched');
      if(mode==='evidence-journal-incomplete'){assert(outcome.evidenceId&&outcome.evidenceReceipt);assert.equal(journal.filter(row=>row.kind==='text-evidence'&&row.state==='unknown').length,0,'Terminal evidence is never downgraded');}
      await assert.rejects(client.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,posts);
    }else if(mode==='scene-import-before-dispatch'||mode==='scene-import-prepare-refresh'||mode==='scene-import-hook-refusal'){
      assert.equal(outcome.outcome,'not-dispatched');assert.equal(client.isConsumed(),true);assert.equal(client.isHeld(),true);
      assert.equal(continuationOutcome?.outcome,'committed');assert.equal(calls.filter(c=>c.method==='POST').length,5);
      assert.equal(client.isHeld(),true,'The original custody owner remains claimed after continuation runs elsewhere');
    }else if(mode==='scene-journal-incomplete'){
      assert.equal(outcome.outcome,'partial');assert.equal(outcome.phase,'scene-association');assert(client.isHeld());
      assert.equal(journal.filter(row=>row.kind==='scene-association'&&row.state==='committed').length,1);
      assert.equal(journal.filter(row=>row.kind==='scene-association'&&row.state==='unknown').length,0,'Terminal association is never downgraded');
      await assert.rejects(client.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,5);
      outcome=await client.reconcileScene(budget);assert.equal(outcome.outcome,'committed');assert.equal(client.isHeld(),false);
      assert.equal(calls.filter(c=>c.method==='POST').length,5,'Acknowledged partial reconciles through fresh GET, never resolve/resend');
  }else if(name==='committed'||name==='scene-reuse'||name==='scene-replacement'||name==='stale-current-scene'||name==='changed-frame-current-scene'||name==='supplementary-unicode'||name==='compact-scene-head'||name==='viewer-inspect'||name==='native-room-target'||name==='native-room-target-explicit-null'||name==='native-room-target-other'||name==='native-room-target-floor-direct'||name==='native-room-target-many-to-one'){
      assert.equal(outcome.outcome,'committed');assert.equal(calls.filter(c=>c.method==='POST').length,5);
      if(name==='committed')assert.equal(outcome.current.payload.roomMappings[0].targets[0].atlasPlaceId,null,
        'Omitting the optional target preserves the existing native null value');
      assert.equal(outcome.current.selection.sceneEvidenceId,outcome.primary.evidenceId);assert.equal(identity().revision,3);
      assert.deepEqual(identity().payload.evidenceIds,[geomEvidenceId,...(supported?[U(20)]:[]),outcome.primary.evidenceId,outcome.historical.evidenceId]);
      assert.equal(outcome.current.selection.sourceFloorBindings[0].nativeFloorKey,floorKey());assert.equal(client.isHeld(),false);
      if(supported){
        const {createNativeGeometryReadClient}=await import(await source(resolve(frontend,'integration/native-geometry-read-client.ts')));
        const {createNativeEvidenceDocumentClient}=await import(await source(resolve(frontend,'integration/native-evidence-document-client.ts')));
        const {createNativeSceneAssociationClient}=await import(await source(resolve(frontend,'integration/native-scene-association-client.ts')));
        const owner=Object.freeze({sessionIdentity:context.sessionIdentity,expiresAt:context.session.expiresAt,scope}),ports={getBinding:()=>owner,subscribeBinding:options.subscribe,origin:options.origin,transport};
        const geometry=createNativeGeometryReadClient(ports),document=()=>createNativeEvidenceDocumentClient(ports),pReview=document(),hReview=document();
        const association=createNativeSceneAssociationClient({getContext:options.getContext,subscribe:options.subscribe,primaryReview:pReview,historicalReview:hReview,createDrawingReview:document,geometryCurrent:geometry.isCurrent,transport});
        let prepared=null;
        try{const frame=await geometry.loadBuilding(buildingId,budget),candidate={buildingId,primaryEvidenceId:outcome.primary.evidenceId,historicalEvidenceId:outcome.historical.evidenceId,
          sourceFloors:savedScene.payload.sourceFloors,roomMappings:savedScene.payload.roomMappings,guards:lastSceneRequest.preconditions.guards},reason='🧭'.repeat(4096),posts=calls.filter(c=>c.method==='POST').length;
          prepared=await association.prepare(candidate,frame,input.statement,reason,budget);
          const body=JSON.parse(prepared.body);assert.equal([...body.reason].length,4096);assert.equal(body.reason.length,8192);assert.equal(body.reason,reason);
          assert.equal([...body.payload.reviewStatement].length,4096);assert.equal(body.payload.reviewStatement,input.statement+supported.marker);
          association.releasePrepared(prepared);prepared=null;
          await assert.rejects(association.prepare(candidate,frame,input.statement+'😀',reason,budget),'Actual prepare includes support suffix in the code-point bound');
          await assert.rejects(association.prepare(candidate,frame,input.statement,reason+'🧭',budget),'Actual prepare rejects 4097 reason code points');
          assert.equal(calls.filter(c=>c.method==='POST').length,posts,'Additional production preparation has no dispatch');
        }finally{if(prepared)association.releasePrepared(prepared);association.dispose();pReview.dispose();hReview.dispose();geometry.dispose();}
      }
      if(name==='compact-scene-head'){
        client.dispose();assert.equal(listeners.size,0);
        // Separately seeded generated retained records. Both records pass the
        // production closed native schema; this does not assert backend custody.
        const base=current,largeAnchors=Array.from({length:128},(_,n)=>({...anchors[0],id:'anchor-'+String(n).padStart(3,'0')+'-'+('x'.repeat(500))}));
        const largeReceipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-large-room-review',sourceReceiptSha256:historySha,anchors:largeAnchors});
        assert(Buffer.byteLength(largeReceipt)<131072);
        const largeEntries=Array.from({length:7},(_,n)=>({...entries[0],id:'large-room-'+n,sourceAnchorIds:largeAnchors.map(a=>a.id)}));
        const largePrimary=JSON.stringify({...JSON.parse(primary),receiptCanonicalJson:largeReceipt,
          rooms:{...JSON.parse(primary).rooms,receiptId:'synthetic-large-room-review',receiptSha256:hash(largeReceipt),entries:largeEntries}});
        const largeAssetId=U(7000),largeEvidenceId=U(7001),largeBytes=new TextEncoder().encode(largePrimary);
        set('asset',largeAssetId,{...assetPayload(hash(largeBytes),largeBytes.length,'text/plain','evidence-original'),evidenceIds:[largeEvidenceId]});
        set('evidence',largeEvidenceId,{statement:'Generated large documentary source',provenance,supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId:largeAssetId}]});
        blobs.set(largeAssetId,largeBytes);media.set(hash(canonical({assetId:largeAssetId,kind:'atlas-asset'})),largeAssetId);
        set('identity',buildingId,{...identity().payload,evidenceIds:[...identity().payload.evidenceIds,largeEvidenceId]},identity().revision+1);
        const largePayload={...base.payload,acceptedReceipt:{receiptId:'synthetic-large-room-review',canonicalJson:largeReceipt,canonicalSha256:hash(largeReceipt),anchors:largeAnchors},
          sourceDocuments:base.payload.sourceDocuments.map(d=>d.role==='primary-scene'?{...d,evidenceId:largeEvidenceId,evidenceRevision:1,originalAssetId:largeAssetId,originalAssetRevision:1,originalSha256:hash(largeBytes)}:d),
          sourceFloors:base.payload.sourceFloors.map(f=>({...f,nativeFloorKey:floorKey()})),
          roomMappings:largeEntries.map(e=>({...base.payload.roomMappings[0],sourceRoomId:e.id,sourceAnchorIds:e.sourceAnchorIds,
            evidenceIds:[largeEvidenceId,base.payload.sourceDocuments.find(d=>d.role==='documentary-sheet').evidenceId]}))};
        const first={...base,payload:largePayload},second={...base,recordId:U(7002),lastAuditId:U(7003),payload:{...largePayload,associationVersion:2,previousAssociationId:first.recordId}};
        const {createExactStockResultValidator}=await import(await source(resolve(frontend,'src/numeric/schema-validator.ts')));
        const {parseLosslessJson,stringifyLosslessJson}=await import(await source(resolve(frontend,'src/numeric/lossless-json.ts')));
        const validator=createExactStockResultValidator(),sizes=[first,second].map(record=>{
          assert.equal(validator.validateNativeEvidenceShape('scene-association',parseLosslessJson(JSON.stringify(record))),true,'Actual closed native record schema accepts generated large version');
          const bytes=Buffer.byteLength(JSON.stringify(record));assert(bytes>600*1024&&bytes<1024*1024);return bytes;
        });assert(Buffer.byteLength(JSON.stringify([first,second]))>1024*1024,'Two valid retained versions exceed metadata limit together');
        set('scene-association',first.recordId,first.payload);set('scene-association',second.recordId,second.payload);current=second;
        const {createNativeGeometryReadClient}=await import(await source(resolve(frontend,'integration/native-geometry-read-client.ts')));
        const {createNativeEvidenceDocumentClient}=await import(await source(resolve(frontend,'integration/native-evidence-document-client.ts')));
        const {createNativeSceneAssociationClient}=await import(await source(resolve(frontend,'integration/native-scene-association-client.ts')));
        const owner=Object.freeze({sessionIdentity:context.sessionIdentity,expiresAt:context.session.expiresAt,scope}),ports={getBinding:()=>owner,subscribeBinding:options.subscribe,origin:options.origin,transport};
        const geometry=createNativeGeometryReadClient(ports),pReview=createNativeEvidenceDocumentClient(ports),hReview=createNativeEvidenceDocumentClient(ports);
        const association=createNativeSceneAssociationClient({getContext:options.getContext,subscribe:options.subscribe,primaryReview:pReview,historicalReview:hReview,geometryCurrent:geometry.isCurrent,transport});
        const posts=calls.filter(c=>c.method==='POST').length,claims=journal.length;
        try{const frame=await geometry.loadBuilding(buildingId,budget),captured=await association.capturePrevious(buildingId,frame,budget);
          assert.equal(captured.current.status,'available');assert.equal(captured.current.recordId,second.recordId);
          const checked=await association.validatePrevious(captured.token,frame,budget);
          assert.equal(checked.recordId,second.recordId);assert.equal(checked.revision.compare(captured.current.revision),0);
          assert.equal(hash(canonical(JSON.parse(stringifyLosslessJson(checked.payload)))),hash(canonical(second.payload)),'Captured exact payload digest is preserved');
          assert.equal(calls.filter(c=>c.path.includes('/records/scene-association')).length,0,'No full history get/list is downloaded');
          assert(headResponseBytes.length>0&&headResponseBytes.every(bytes=>bytes<1024),'Atomic response remains sub-KiB regardless of retained payloads');
          assert.equal(calls.filter(c=>c.method==='POST').length,posts);assert.equal(journal.length,claims);
          outcome={...outcome,compactHead:{recordBytes:sizes,maximumHeadResponseBytes:Math.max(...headResponseBytes)}};
        }finally{association.dispose();pReview.dispose();hReview.dispose();geometry.dispose();}
      }
      if(name==='stale-current-scene'||name==='changed-frame-current-scene'){
        client.dispose();assert.equal(listeners.size,0);const successor=createNativeScanSceneImporter(options),prior=current,descriptorKey=viewKey();
        try{const captured=await successor.capturePriorScene(buildingId,budget);assert.equal(captured.status,'available');assert.equal(captured.recordId,prior.recordId);
          // A different writer creates a genuine generated current head; the
          // retained old row stays active/unchanged. The changed-frame case gives
          // that successor actual fresh descriptor keys and geometry revision.
          if(name==='changed-frame-current-scene'){
            geometryEpoch++;
            const {createNativeGeometryReadClient}=await import(await source(resolve(frontend,'integration/native-geometry-read-client.ts')));
            const {createNativeEvidenceDocumentClient}=await import(await source(resolve(frontend,'integration/native-evidence-document-client.ts')));
            const {createNativeSceneAssociationClient}=await import(await source(resolve(frontend,'integration/native-scene-association-client.ts')));
            const owner=Object.freeze({sessionIdentity:context.sessionIdentity,expiresAt:context.session.expiresAt,scope}),ports={getBinding:()=>owner,subscribeBinding:options.subscribe,origin:options.origin,transport};
            const geometry=createNativeGeometryReadClient(ports),document=()=>createNativeEvidenceDocumentClient(ports),pReview=document(),hReview=document();
            const qualified=createNativeSceneAssociationClient({getContext:options.getContext,subscribe:options.subscribe,primaryReview:pReview,historicalReview:hReview,geometryCurrent:geometry.isCurrent,transport});
            try{const frame=await geometry.loadBuilding(buildingId,budget);await assert.rejects(qualified.readCurrent(buildingId,frame,budget),'Real qualified route behavior is409 for stale nativeFloorKey with unchanged geometry revision');assert.equal(qualified409Responses,1);}
            finally{qualified.dispose();pReview.dispose();hReview.dispose();geometry.dispose();}
            const claims=journal.length,reads=calls.filter(c=>c.path.endsWith('/current')).length;
            assert.equal(await successor.inspectCurrentScene(input,budget),null,'Atomic retained-head pins permit successor input despite qualified route409');
            assert.equal(calls.filter(c=>c.path.endsWith('/current')).length,reads,'Changed-frame atomic proof does not reinterpret the qualified route');assert.equal(journal.length,claims);
            const valid={schema:'houseatlas.native-scene-head.v1',scope,buildingId,status:'available',reason:null,
              head:{recordId:prior.recordId,revision:prior.revision,payloadSha256:hash(canonical(prior.payload))}};
            for(const invalid of ['schema','scope','building','record','revision','digest','unavailable','extra','oversize','conflict']){
              headOverride=structuredClone(valid);headHttpStatus=200;
              if(invalid==='schema')headOverride.schema='other-profile';
              if(invalid==='scope')headOverride.scope.homeId=U(9997);
              if(invalid==='building')headOverride.buildingId=U(9997);
              if(invalid==='record')headOverride.head.recordId=U(9997);
              if(invalid==='revision')headOverride.head.revision++;
              if(invalid==='digest')headOverride.head.payloadSha256='f'.repeat(64);
              if(invalid==='unavailable')headOverride={...valid,status:'unavailable',reason:'current-source-unavailable',head:null};
              if(invalid==='extra')headOverride.unreviewed=true;
              if(invalid==='oversize')headOverride.padding='x'.repeat(4096);
              if(invalid==='conflict')headHttpStatus=409;
              await assert.rejects(successor.inspectCurrentScene(input,budget),'Unqualified atomic head refuses: '+invalid);
              await assert.rejects(successor.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,5);assert.equal(journal.length,claims);
            }
            headOverride=null;headHttpStatus=200;
          }
          current={...prior,recordId:U(++counter),lastAuditId:U(++counter),payload:{...prior.payload,associationVersion:2,previousAssociationId:prior.recordId,reviewStatement:'Another reviewed writer advanced this head',
            sourceFloors:prior.payload.sourceFloors.map(f=>({...f,nativeFloorKey:floorKey(),nativeGeometryRevision:records.get('geometry:'+geometryId).revision}))}};
          set('scene-association',current.recordId,current.payload);assert.equal(viewKey()===descriptorKey,name!=='changed-frame-current-scene');assert.equal(records.get('scene-association:'+prior.recordId).payload,prior.payload);
          const selected={...input,statement:'Reviewed candidate after competing head'};const claims=journal.length;
          const currentReads=calls.filter(c=>c.path.endsWith('/current')).length;
          await assert.rejects(successor.inspectCurrentScene(selected,budget),/prior scene head changed; custody remains held/,'A valid competing current head cannot become a mismatch/reuse null');
          await assert.rejects(successor.importScene(selected,budget),/prior scene head changed; custody remains held/,'Retained predecessor authentication cannot authorize new documentary custody');
          assert.equal(calls.filter(c=>c.method==='POST').length,5,'Competing-head refusal performs zero extra POSTs');assert.equal(journal.length,claims,'No new custody claim or fabricated receipt');
          assert(calls.some(c=>c.method==='GET'&&c.path.endsWith('/head')),'Actual compact head endpoint was exercised before the distinct head refusal');
          assert.equal(calls.filter(c=>c.path.includes('/records/scene-association')).length,0,'No full historical scene get/list is needed for predecessor validation');
          assert.equal(successor.isConsumed(),false);assert.equal(records.get('scene-association:'+prior.recordId).revision,1);
          assert.equal(calls.filter(c=>c.path.endsWith('/current')).length,currentReads,'Atomic head proof refuses a distinct tail before qualified current reads');
          if(name==='changed-frame-current-scene'){
            currentUnavailableReason='current-source-unavailable';
            await assert.rejects(successor.inspectCurrentScene(selected,budget),/prior scene head changed; custody remains held/,'Unavailable competing successor cannot masquerade as the captured old head');
            await assert.rejects(successor.importScene(selected,budget),/prior scene head changed; custody remains held/);
            currentUnavailableReason=null;assert.equal(calls.filter(c=>c.method==='POST').length,5);assert.equal(journal.length,claims);
          }
        }finally{successor.dispose();}
      }
      if(name==='scene-replacement'){
        client.dispose();assert.equal(listeners.size,0);const successor=createNativeScanSceneImporter(options),prior=current;
        try{const captured=await successor.capturePriorScene(buildingId,budget);assert.equal(captured.status,'available');assert.equal(captured.recordId,prior.recordId);
          geometryEpoch++; // Descriptor-key refresh preserves immutable geometry ID/revision; not geometry succession.
          const updated=JSON.parse(primary);updated.rooms.entries[0].label='Reviewed successor room';const replacement={...input,primary:textInput(JSON.stringify(updated),'successor.txt'),statement:'Reviewed successor room source'};
          assert.equal(await successor.inspectCurrentScene(replacement,budget),null,'Qualified stale-key prior is successor provenance, not a reusable or missing head');
          assert.equal(calls.filter(c=>c.method==='POST').length,5,'Prior revalidation and refresh are GET-only');
          const next=await successor.importScene(replacement,budget);assert.equal(next.outcome,'committed');
          assert.equal(next.current.payload.previousAssociationId,prior.recordId);assert.equal(next.current.payload.associationVersion.toSafeInteger(),2);
          assert.equal(next.current.selection.sourceFloorBindings[0].nativeFloorKey,floorKey());assert.equal(calls.filter(c=>c.method==='POST').length,10);
          assert.equal(successor.isHeld(),false);
        }finally{successor.dispose();}
      }
      if(name==='viewer-inspect'){
        const editor=context.view,writeAdmission=context.admission,posts=calls.filter(c=>c.method==='POST').length,claims=journal.length;
        context.view={...editor,canEdit:false};context.admission={scope,revision:'synthetic-viewer-read',commandIds:['atlas.identity.get','atlas.evidence.get','atlas.asset.get','atlas.scene-association.list']};
        for(const changed of [...listeners])changed();
        // An authority downgrade invalidates the previously captured Editor
        // lease. It never silently adopts that lease for a read or a mutation.
        await assert.rejects(client.inspectCurrentScene(input,budget),'Authority change retires the prior Editor capture');
        client.dispose();assert.equal(listeners.size,0);
        for(const admission of [context.admission,null]){
          context.admission=admission;const viewer=createNativeScanSceneImporter(options),reads=calls.length;
          try{const inspected=await viewer.inspectCurrentScene(input,budget,{recordId:savedScene.recordId,payload:savedScene.payload});
            assert(inspected&&inspected.status==='available');assert.equal(inspected.recordId,savedScene.recordId);
            assert.equal(inspected.selection.sceneEvidenceId,outcome.primary.evidenceId);assert.equal(inspected.selection.sceneAssetId,outcome.primary.assetId);
            assert(calls.slice(reads).some(call=>call.path.endsWith('/current')),'Viewer uses genuine current scene read');
            assert(calls.slice(reads).filter(call=>call.path.endsWith('/download')).length>=3,'Viewer opens both retained documents and actual closed source');
            assert(calls.slice(reads).every(call=>call.method==='GET'),'Passive Viewer inspection is GET-only');
            const beforeImport=calls.length;
            await assert.rejects(viewer.importScene(input,budget),'Viewer cannot import even with a valid read binding');
            assert.equal(calls.length,beforeImport,'Viewer refuses import before transport');assert.equal(viewer.isConsumed(),false);
            assert.equal(calls.filter(call=>call.method==='POST').length,posts);assert.equal(journal.length,claims);
          }finally{viewer.dispose();assert.equal(listeners.size,0);}
        }
        // A same-scope admission change during a read withdraws the owner lease.
        context.admission={scope,revision:'synthetic-viewer-before-read',commandIds:['atlas.identity.get']};let changedDuringRead=false;
        const invalidated=createNativeScanSceneImporter({...options,transport:async(url,init)=>{
          const response=await transport(url,init);
          if(!changedDuringRead&&new URL(url,'https://synthetic.invalid').pathname.endsWith('/buildings/'+buildingId)){
            changedDuringRead=true;context.admission={...context.admission,revision:'synthetic-viewer-after-read'};
            for(const changed of [...listeners])changed();
          }
          return response;
        }});
        try{await assert.rejects(invalidated.inspectCurrentScene(input,budget),'Authority-sensitive admission revision change withdraws in-flight read');
          assert(changedDuringRead);assert.equal(calls.filter(call=>call.method==='POST').length,posts);assert.equal(journal.length,claims);
        }finally{invalidated.dispose();assert.equal(listeners.size,0);}
        // Editor canEdit alone is insufficient when any required command was revoked.
        context.view=editor;
        for(const missing of writeAdmission.commandIds){context.admission={...writeAdmission,revision:'synthetic-missing-'+missing,commandIds:writeAdmission.commandIds.filter(id=>id!==missing)};
          const partial=createNativeScanSceneImporter(options),beforeImport=calls.length;
          try{await assert.rejects(partial.importScene(input,budget));assert.equal(calls.length,beforeImport,'Incomplete write command set refuses before transport');}
          finally{partial.dispose();assert.equal(listeners.size,0);}}
        context.admission=writeAdmission;assert.equal(calls.filter(call=>call.method==='POST').length,posts);assert.equal(journal.length,claims);
      }
      if(name==='scene-reuse'){
        client.dispose();assert.equal(listeners.size,0);const fresh=createNativeScanSceneImporter(options),claimedBefore=journal.length;
        try{
          const reused=await fresh.inspectCurrentScene(input,budget,{recordId:savedScene.recordId,payload:savedScene.payload});
          assert(reused&&reused.status==='available');assert.equal(reused.recordId,outcome.current.recordId);
          assert.equal(reused.selection.sceneAssetId,outcome.primary.assetId);assert.equal(reused.selection.sceneEvidenceId,outcome.primary.evidenceId);
          const readsBefore=calls.length;
          await assert.rejects(fresh.inspectCurrentScene({...input,roomMappings:[{...input.roomMappings[0],extra:'not-reviewed'}]},budget),'Invalid selected input throws before matching current');
          assert.equal(calls.length,readsBefore,'Malformed selected scene has zero inspection HTTP calls');
          const changedSha='e'.repeat(64),changed=JSON.parse(primary),changedAnchors=anchors.map(a=>({...a,sourceOriginalSha256:changedSha}));
          changed.receiptCanonicalJson=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-room-review',sourceReceiptSha256:historySha,anchors:changedAnchors});
          changed.rooms.receiptSha256=hash(changed.receiptCanonicalJson);changed.rooms.entries=entries.map(e=>({...e,sourceOriginalSha256:changedSha}));
          const changedInput={...input,primary:textInput(JSON.stringify(changed),'changed-scene.txt'),sourceFloors:[{...input.sourceFloors[0],sourceOriginalSha256:changedSha}],
            roomMappings:input.roomMappings.map(m=>({...m,sourceOriginalSha256:changedSha}))};
          assert.equal(await fresh.inspectCurrentScene(changedInput,budget),null,'Valid changed source pair cannot reuse current');
          assert.equal(await fresh.inspectCurrentScene(input,budget,{recordId:U(9999),payload:savedScene.payload}),null,'Wrong exact expected record cannot reconcile');
          currentUnavailableReason='no-current-association';
          assert.equal(await fresh.inspectCurrentScene(input,budget),null,'Valid association absence permits empty result');
          currentUnavailableReason='current-source-unavailable';
          await assert.rejects(fresh.inspectCurrentScene(input,budget),/current scene source is unavailable; mutation remains held/,'Unreadable current source must stop before further writes');
          currentUnavailableReason=null;
          assert.equal(calls.filter(c=>c.method==='POST').length,5,'Fresh-factory inspection including unavailable source makes zero extra POSTs');
          assert.equal(journal.length,claimedBefore,'No fabricated claims, receipts or commit events');
          assert.equal(fresh.isConsumed(),false);assert.equal(fresh.isHeld(),false);
        }finally{fresh.dispose();}
      }
    }else{
      assert.equal(outcome.outcome,'unknown');const count=calls.filter(c=>c.method==='POST').length;
      assert.equal(count,name==='asset-unknown'?1:name==='evidence-unknown'?2:5);assert(client.isHeld());
      await assert.rejects(client.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,count,'No resend');
      if(name==='association-unknown'){current=savedScene;outcome=await client.reconcileScene(budget);assert.equal(outcome.outcome,'committed');assert.equal(calls.filter(c=>c.method==='POST').length,5,'GET-only reconciliation');}
    }
  }
}finally{client.dispose();assert.equal(listeners.size,0,'All actual owner subscriptions disposed');}
return {variant:mode,posts:calls.filter(c=>c.method==='POST').length,ownerSubscriptionsAfterDispose:listeners.size,outcome:outcome.outcome,
  ...(outcome.compactHead?{compactHead:outcome.compactHead}:{}),
  ...(supported?{statementCodePoints:[...savedScene.payload.reviewStatement].length,reasonCodePoints:[...input.reason].length,supportMarkerCodePoints:[...supported.marker].length}:{} )};
}
const results=[];if(name==='supplementary-unicode'){results.push(await runLiteralLabels(true),await runFixture());}else if(name==='literal-labels')results.push(await runLiteralLabels());else for(const variant of name==='evidence-unknown'?['evidence-unknown','asset-journal-incomplete','evidence-not-dispatched','evidence-journal-incomplete']:
  name==='association-unknown'?['association-unknown','scene-journal-incomplete']:[name])results.push(await runFixture(variant));
console.log(JSON.stringify({case:name,status:'PASS',qualification:'generated-only actual source factories; fake transport; no native persistence',results,sourcePins}));
