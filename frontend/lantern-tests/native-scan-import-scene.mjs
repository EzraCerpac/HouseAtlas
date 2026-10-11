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
const names=new Set(['committed','asset-unknown','evidence-unknown','association-unknown','floor-selection','literal-labels','scene-reuse']);
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
      else{const target=[base,base+'.ts',base+'.tsx',base+'.js'].find(existsSync);assert(target,'Resolve actual source '+specifier);replacement=await source(target);}
    }else replacement=pathToFileURL(require.resolve(specifier)).href;
    code=code.replaceAll(JSON.stringify(specifier),JSON.stringify(replacement));
  }
  for(const m of code.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g))assert((m[1]??m[2]).startsWith('data:')||(m[1]??m[2]).startsWith('file:'));
  const url=data(code);loaded.set(file,url);return url;
}
const {createNativeScanSceneImporter,preflightNativeScanScene}=await import(await source(resolve(frontend,'integration/native-scan-import-scene.ts')));
async function runLiteralLabels(){
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
  try{assert.equal(await preflightNativeScanScene(input,AbortSignal.timeout(15000)),undefined);assert.equal(transportCalls,0);
    assert.equal(await input.primary.file.text(),primary,'Immutable primary bytes are not normalized');
    assert.deepEqual(JSON.parse(await input.primary.file.text()).electricalFixtures.documentaryFixtures.fixtures[0].source.literalLabels,['','F1']);
  }finally{globalThis.fetch=originalFetch;}
  return {variant:'literal-labels',posts:0,transportCalls,literalLabels:['','F1'],outcome:'validated-before-writes'};
}
async function runFixture(mode=name){
const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope={workspaceId:U(1),homeId:U(2)},buildingId=U(3),geometryId=U(4),geomEvidenceId=U(5),originalId=U(6),derivativeId=U(7);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const history='{"profile":"synthetic-documentary-receipt","observation":"generated only"}',historySha=hash(history),sourceSha='a'.repeat(64);
const anchors=[{id:'synthetic-source-anchor',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,targets:[{packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8)}],unresolvedLabels:[]}];
const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'synthetic-room-review',sourceReceiptSha256:historySha,anchors}),receiptSha=hash(receipt);
const entries=[{id:'synthetic-room',label:'Synthetic room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,sourceAnchorIds:[anchors[0].id],packagePlaceKey:'synthetic-room',packagePlaceUuid:U(8),xFraction:0.5,yFraction:0.5}];
const primary=JSON.stringify({schema:'houseatlas.native-scene-source.v1',receiptCanonicalJson:receipt,rooms:{status:'available',reason:null,receiptId:'synthetic-room-review',receiptSha256:receiptSha,entries,regions:[]},
  network:{status:'unavailable',reason:'not-retained',source:null,devices:null,endpoints:null,links:null},
  electricity:{status:'unavailable',reason:'not-retained',documentarySource:null,roomRegistry:null,buildingPackageKey:null,retrievedAt:null}});
const textInput=(text,filename)=>({buildingId,file:new Blob([text],{type:'text/plain'}),filename,sha256:hash(text),byteSize:Buffer.byteLength(text),statement:'Reviewed generated documentary source',reason:'Generated-only agent intake check',sourceLicense:{status:'unknown',reference:null}});
const input={buildingId,primary:textInput(primary,'scene.txt'),historical:textInput(history,'review.txt'),sourceFloors:[{sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,nativeGeometryId:geometryId}],
  roomMappings:[{sourceRoomId:'synthetic-room',sourceFloorKey:'source-floor',sourceOriginalSha256:sourceSha,sourceAnchorIds:[anchors[0].id],targets:anchors[0].targets,unresolvedLabels:[]}],statement:'Deliberately reviewed synthetic room association',reason:'Generated scene save',confirmDrawingSupport:false};
const context={sessionIdentity:{},session:{schemaVersion:1,actorId:U(9),csrfToken:'synthetic-not-a-credential',expiresAt:new Date(Date.now()+120000).toISOString()},
  view:{scope,canEdit:true},admission:{scope,revision:'synthetic-admission',commandIds:['atlas.asset.create','atlas.evidence.create','atlas.identity.replace','atlas.batch.execute','atlas.scene-association.create']}};
const listeners=new Set(),records=new Map(),blobs=new Map(),media=new Map(),calls=[],journal=[];let counter=100,current=null,savedScene=null,currentUnavailableReason=null;
const target=(kind,id)=>({authority:'atlas',recordType:kind,recordId:id});
const set=(kind,id,payload,revision=1)=>{const r={target:target(kind,id),revision,lifecycle:'active',payload};records.set(kind+':'+id,r);return r;};
const provenance={source:null,sourceRevision:null,sourceConfidence:null,evidenceBasis:'unknown',factAt:null,retrievedAt:'2026-10-11T00:00:00Z',vantage:null,uncertainty:{status:'unknown',explanation:null}};
set('identity',buildingId,{kind:'location',evidenceIds:[geomEvidenceId]});
set('evidence',geomEvidenceId,{statement:'Synthetic geometry',provenance,supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId:originalId},{kind:'atlas-asset',assetId:derivativeId}]});
const assetPayload=(sha,bytes,type,purpose)=>({owner:'atlas',purpose,sha256:sha,byteSize:bytes,contentType:type,sourceLicense:{status:'unknown',reference:null},availability:'available',previewPolicy:'download-only',evidenceIds:[]});
set('asset',originalId,assetPayload('b'.repeat(64),1,'model/vnd.usdz+zip','geometry-original'));
set('asset',derivativeId,assetPayload('c'.repeat(64),1,'application/vnd.houseatlas.magicplan-authored-mesh+json','derived-preview'));
set('geometry',geometryId,{producer:'magicplan',producerVersion:null,exportFormat:'usdz',originalAssetId:originalId,importedAt:'2026-10-11T00:00:00Z',coordinateUnits:'unknown',scale:null,transform:null,geometryVersion:1,previousGeometryId:null,mappings:[],evidenceIds:[geomEvidenceId]});
const identity=()=>records.get('identity:'+buildingId),viewKey=()=>hash('current-view:'+identity().revision),floorKey=()=>hash('current-floor:'+identity().revision);
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
    assert.equal(request.commandId,'atlas.scene-association.create');assert.equal(identity().revision,3);
    assert.equal(request.payload.sourceFloors[0].nativeFloorKey,floorKey(),'Uses post-text fresh native floor key');
    savedScene={schemaVersion:1,recordType:'scene-association',recordId:request.target.recordId,...scope,revision:1,lifecycle:'active',createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z',lastAuditId:U(++counter),payload:request.payload};
    if(mode==='association-unknown')throw Error('Synthetic absent association response');
    current=savedScene;return json(result(request.commandId,request.requestId,[{target:request.target,revision:1,lifecycle:'active',payload:request.payload}],digest));
  }
  assert.equal(init.method,'GET');
  if(path.endsWith('/buildings/'+buildingId)){
    const nativeFloor={key:floorKey(),exportLabel:'Generated floor',originalSha256:'b'.repeat(64),derivativeSha256:'c'.repeat(64),geometryId,geometryRevision:1,evidenceId:geomEvidenceId,evidenceRevision:1,originalAssetId:originalId,originalRevision:1,derivativeAssetId:derivativeId,derivativeRevision:1,originalLicense:{status:'unknown',reference:null},derivativeLicense:{status:'unknown',reference:null}};
    const buildingPath=`/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
    const descriptor={schemaVersion:1,profile:'houseatlas.magicplan-authored-mesh.v1',scope,buildingId,viewKey:viewKey(),floors:[{floor:nativeFloor,readPath:`${buildingPath}/frames/${viewKey()}/meshes/${floorKey()}`}],physicalScale:'unknown',floorAlignment:'unknown',stageToHouseTransform:null};
    return new Response(JSON.stringify(descriptor),{headers:{'content-type':'application/json','x-atlas-geometry-view':viewKey()}});
  }
  if(path.endsWith('/current'))return json(currentUnavailableReason?{status:'unavailable',reason:currentUnavailableReason,association:null}:current?{status:'available',association:current}:{status:'unavailable',reason:'no-current-association',association:null});
  const m=path.match(/\/records\/([^/]+)\/([^/]+)$/);
  if(m){if(mode==='evidence-not-dispatched'&&m[1]==='identity'&&calls.some(c=>c.method==='POST'))throw Error('Synthetic next-step read unavailable');const r=records.get(m[1]+':'+m[2]);assert(r,'Existing generated record');return json({schemaVersion:3,commandId:`atlas.${m[1]}.get`,requestId:U(++counter),resolvedScope:scope,status:'read',replayed:false,data:{sourceStatus:'current',nextCursor:null,records:[r]}});}
  if(path.endsWith('/download')){const digest=path.split('/').at(-2),assetId=media.get(digest);assert(assetId);const bytes=blobs.get(assetId);return new Response(bytes,{headers:{'content-type':'text/plain','content-length':String(bytes.length),'content-disposition':'attachment; filename="generated.txt"'}});}
  throw Error('Unexpected generated route '+path);
}
const options={getContext:()=>context,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},origin:'https://synthetic.invalid',transport,
  async beforeDispatch(kind,request){journal.push({kind,requestId:request.requestId,state:'before'});assert(!JSON.stringify(request).includes(context.session.csrfToken));},
  async afterResult(kind,result){journal.push({kind,requestId:result.requestId,state:result.outcome});if((mode==='asset-journal-incomplete'&&kind==='text-asset'||mode==='evidence-journal-incomplete'&&kind==='text-evidence'||mode==='scene-journal-incomplete'&&kind==='scene-association'&&journal.filter(row=>row.kind===kind&&row.state==='committed').length===1)&&result.outcome==='committed')throw Error('Synthetic journal completion unavailable');}};
const client=createNativeScanSceneImporter(options);
let outcome;const budget=AbortSignal.timeout(15000);
try{
  if(name==='floor-selection'){
    const pure={...input,sourceFloors:input.sourceFloors.map(({sourceFloorKey,sourceOriginalSha256})=>({sourceFloorKey,sourceOriginalSha256}))};
    assert.equal(await preflightNativeScanScene(pure,budget),undefined,'Pure validation returns no synthetic native frame');
    assert.equal(calls.length,0,'Pure preflight has no HTTP or authentication');
    for(const field of ['rooms','network','electricity','electricalFixtures']){
      const malformed=JSON.parse(primary);if(field==='electricalFixtures'){malformed.schema='houseatlas.native-scene-source.v2';malformed.electricalFixtures={status:'available',reason:null,documentaryFixtures:{unexpected:true}};}
      else malformed[field].unexpected=true;
      await assert.rejects(preflightNativeScanScene({...pure,primary:textInput(JSON.stringify(malformed),'malformed.txt')},budget),'Closed '+field+' grammar refuses before writes');
      assert.equal(calls.length,0,'Malformed source has zero transport calls');
    }
    await assert.rejects(preflightNativeScanScene({...pure,roomMappings:[{...pure.roomMappings[0],extra:'unreviewed'}]},budget));
    assert.equal(calls.length,0);
    await assert.rejects(client.importScene({...input,sourceFloors:[]},budget));assert.equal(calls.filter(c=>c.method==='POST').length,0);
    outcome={outcome:'refused-before-writes'};
  }else{
    outcome=await client.importScene(input,budget);
    if(['asset-journal-incomplete','evidence-not-dispatched','evidence-journal-incomplete'].includes(mode)){
      const posts=mode==='evidence-journal-incomplete'?2:1;
      assert.equal(outcome.outcome,'partial');assert.equal(calls.filter(c=>c.method==='POST').length,posts);assert(client.isHeld());
      assert.equal(journal.filter(row=>row.kind==='text-asset'&&row.state==='committed').length,1);
      assert.equal(journal.filter(row=>row.kind==='text-asset'&&row.state==='unknown').length,0,'Terminal asset is never downgraded');
      assert.equal(outcome.assetRequestId,journal.find(row=>row.kind==='text-asset'&&row.state==='before').requestId);
      if(mode==='evidence-not-dispatched')assert.equal(outcome.requestId,null,'No evidence request was dispatched');
      if(mode==='evidence-journal-incomplete'){assert(outcome.evidenceId&&outcome.evidenceReceipt);assert.equal(journal.filter(row=>row.kind==='text-evidence'&&row.state==='unknown').length,0,'Terminal evidence is never downgraded');}
      await assert.rejects(client.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,posts);
    }else if(mode==='scene-journal-incomplete'){
      assert.equal(outcome.outcome,'partial');assert.equal(outcome.phase,'scene-association');assert(client.isHeld());
      assert.equal(journal.filter(row=>row.kind==='scene-association'&&row.state==='committed').length,1);
      assert.equal(journal.filter(row=>row.kind==='scene-association'&&row.state==='unknown').length,0,'Terminal association is never downgraded');
      await assert.rejects(client.importScene(input,budget));assert.equal(calls.filter(c=>c.method==='POST').length,5);
      outcome=await client.reconcileScene(budget);assert.equal(outcome.outcome,'committed');assert.equal(client.isHeld(),false);
      assert.equal(calls.filter(c=>c.method==='POST').length,5,'Acknowledged partial reconciles through fresh GET, never resolve/resend');
    }else if(name==='committed'||name==='scene-reuse'){
      assert.equal(outcome.outcome,'committed');assert.equal(calls.filter(c=>c.method==='POST').length,5);
      assert.equal(outcome.current.selection.sceneEvidenceId,outcome.primary.evidenceId);assert.equal(identity().revision,3);
      assert.deepEqual(identity().payload.evidenceIds,[geomEvidenceId,outcome.primary.evidenceId,outcome.historical.evidenceId]);
      assert.equal(outcome.current.selection.sourceFloorBindings[0].nativeFloorKey,floorKey());assert.equal(client.isHeld(),false);
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
return {variant:mode,posts:calls.filter(c=>c.method==='POST').length,ownerSubscriptionsAfterDispose:listeners.size,outcome:outcome.outcome};
}
const results=[];if(name==='literal-labels')results.push(await runLiteralLabels());else for(const variant of name==='evidence-unknown'?['evidence-unknown','asset-journal-incomplete','evidence-not-dispatched','evidence-journal-incomplete']:
  name==='association-unknown'?['association-unknown','scene-journal-incomplete']:[name])results.push(await runFixture(variant));
console.log(JSON.stringify({case:name,status:'PASS',qualification:'generated-only actual source factories; fake transport; no native persistence',results,sourcePins}));
