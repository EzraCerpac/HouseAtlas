/** One generated ordinary healthy read: actual source adapter and closed parsers,
 * in-process GET transport and dedicated fake native document owners only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'vite';
assert.equal(process.version,'v26.10.0');
assert.equal(process.argv.length,2);
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const scratch=mkdtempSync(join(tmpdir(),'houseatlas-unified-overlay-healthy-'));
const paths=['frontend/integration/unified-atlas-overlay-source.ts','frontend/integration/native-scene-association-client.ts','frontend/integration/native-scene-source-client.ts'];
const hash=v=>createHash('sha256').update(v).digest('hex');
const sourcePins=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(join(root,p)))]));
try {
  const entry=join(scratch,'entry.ts');
  writeFileSync(entry,`export {createUnifiedAtlasOverlaySource} from ${JSON.stringify(join(root,paths[0]))};\nexport {ExactDecimal} from ${JSON.stringify(join(root,'frontend/src/numeric/decimal.ts'))};\n`);
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},minify:false}});
  const output=Array.isArray(built)?built[0]:built;
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,output.output.find(o=>o.type==='chunk'&&o.isEntry).code);
  const {createUnifiedAtlasOverlaySource,ExactDecimal}=await import(pathToFileURL(modulePath).href);
  const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const canonical=v=>JSON.stringify(v,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const floor='generated:floor',floorHash='a'.repeat(64),packageKey='generated:room',packageUuid=U(21),photoHash='b'.repeat(64);
  const historical=Buffer.from('Generated historical documentary original.');
  const anchors=[{id:'generated:anchor',sourceFloorKey:floor,sourceOriginalSha256:floorHash,targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid}],unresolvedLabels:[]}];
  const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'generated:receipt',sourceReceiptSha256:hash(historical),anchors});
  const receiptSha=hash(receipt);
  const fixtures={schema:'houseatlas.documentary-electrical-fixtures.v1',viewKey:'documentary-source',interpretationDate:'2026-10-10',
    symbolLegend:{xMeansSocket:true,socketsPerX:1,receiptId:'generated:symbol-review'},roomMappingReceipt:{id:'generated:receipt',sha256:receiptSha},registrationReceipts:[],
    sheets:[{id:'sheet',title:'Generated sheet',pdfPage:2,originalPhoto:'originals/generated.svg',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,sourceDate:null,regionIds:['region']}],
    groups:[{id:'group',label:'L1',fixtureIds:['socket'],evidenceBasis:'historic-drawing-label',currentCircuitId:null,verifiedWiring:false}],
    regions:[{id:'region',sheetId:'sheet',label:'Generated room',sourceOutline:[],outlineClosed:false,sourceBounds:[.1,.1,.9,.9],outlineBasis:'untraced',places:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,label:'Generated room',basis:'owner-reported'}],orientation:'unregistered',physicalTransform:null}],
    fixtures:[{id:'socket',sheetId:'sheet',regionId:'region',clusterId:null,kind:'socket',label:'Generated socket',glyph:'X',source:{symbolKey:'generated:symbol',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,normalizedBox:[.3,.3,.4,.4],normalizedPoint:[.35,.35],literalLabels:['L1'],placementDescription:'Generated symbol'},group:{id:'group',label:'L1',basis:'label-adjacent',note:'Historical label'},glyphCount:1,fixtureCount:1,uncertainty:null,currentState:'historic-unverified',physicalCoordinate:null,wireRoute:null}]};
  const statement=basis=>({statement:'Generated documentary statement',evidenceBasis:basis,uncertainty:{status:'unmeasured',explanation:'Documentary only'}});
  const sheet={document_id:'generated:sheet',bundle_id:'generated:bundle',title_as_read:'Generated sheet',source_photo:'originals/generated.svg',source_sha256:photoHash,rendered_photo:'rendered/generated.svg',pdf_page:2,factAt:null,interpretation_date:'2026-10-10',documentary_group_labels:['L1'],direct_reading:statement('document'),drawing_association:statement('inference'),open_uncertainty:'Historical only',native_atlas_identity_ids:[],owner_confirmed_room_mapping:null,owner_confirmed_layout_mapping:null,
    provisional_diagram:{coordinate_space:'normalized-upright-photo',geometry_status:'unmeasured',metric_units:null,scale:null,transform:null,region_xyxy:[.1,.1,.9,.9],source_date:null},
    package_room_associations:[{package_room_id:packageKey,stable_package_uuid:packageUuid,current_circuit_binding:null,native_atlas_identity_id:null,status:'inferred-name-or-context-match',evidenceBasis:'inference'}]};
  const primary=Buffer.from(JSON.stringify({schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:receipt,
    rooms:{status:'available',reason:null,receiptId:'generated:receipt',receiptSha256:receiptSha,entries:[],regions:[]},
    network:{status:'available',reason:null,source:{label:'Generated recorded network',revision:'source-1',recordedAt:'2026-10-10',retrievedAt:null,status:'recorded',acceptedAt:null,coverage:'partial',notes:''},
      devices:[{id:'device:generated',label:'Generated device',kind:'switch',mobility:'fixed',confidence:'recorded',notes:'',place:{sourceRoomId:'source:room',sourcePlaceId:packageKey,sourcePlaceUUID:packageUuid,planAssociations:[{sourceAnchorId:'generated:anchor',sourceFloorKey:floor,sourceFloorLabel:'Generated floor',sourceReference:'Generated documentary reference',sourceHandle:'generated:handle',sourceSHA256:floorHash}],roomLabel:'Generated room',detail:'',confidence:'recorded',basis:'Reviewed source association',sourceFloorKey:floor,mappingStatus:'accepted',coordinate:null}}],endpoints:[],links:[]},
    electricity:{status:'available',reason:null,documentarySource:{schema:'private-documentary-records/v1',status:'documentary',native_import_receipt:null,records:[sheet]},roomRegistry:{schema:'private-houseatlas-room-registry/v1',entities:[{id:'generated:building',stable_uuid:U(22),display_name:'Generated building',aliases:[],source_refs:['generated']},{id:packageKey,stable_uuid:packageUuid,display_name:'Generated room',aliases:[],source_refs:['generated']}]},buildingPackageKey:'generated:building',retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:fixtures}}));
  const revision=ExactDecimal.parse('9007199254740991');
  const documents=[{role:'primary-scene',evidenceId:U(4),evidenceRevision:7,originalAssetId:U(5),originalAssetRevision:9007199254740991n,originalSha256:hash(primary),contentType:'text/plain'},
    {role:'documentary-sheet',evidenceId:U(6),evidenceRevision:8,originalAssetId:U(7),originalAssetRevision:9007199254740991n,originalSha256:hash(historical),contentType:'text/plain'}];
  const payload={profile:'houseatlas.native-scene-association.v1',buildingId:U(3),associationVersion:1,previousAssociationId:null,reviewStatus:'accepted',reviewStatement:'Generated reviewed association',sourceDocuments:documents,
    acceptedReceipt:{receiptId:'generated:receipt',canonicalJson:receipt,canonicalSha256:receiptSha,anchors},
    sourceFloors:[{sourceFloorKey:floor,sourceOriginalSha256:floorHash,nativeFloorKey:'native:floor',nativeGeometryId:U(10),nativeGeometryRevision:1,nativeOriginalAssetId:U(11),nativeOriginalSha256:floorHash}],
    roomMappings:[{sourceRoomId:'source:room',sourceFloorKey:floor,sourceOriginalSha256:floorHash,sourceAnchorIds:['generated:anchor'],targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,atlasPlaceId:U(40)}],unresolvedLabels:[],evidenceIds:[U(4),U(6)]}]};
  const record={schemaVersion:1,recordType:'scene-association',recordId:U(12),workspaceId:U(1),homeId:U(2),revision:1,lifecycle:'active',createdAt:'2026-10-10T12:00:00Z',updatedAt:'2026-10-10T12:00:00Z',lastAuditId:U(13),payload};
  const raw=JSON.stringify({status:'available',association:record},(_,v)=>typeof v==='bigint'?'EXACT-'+v:v).replaceAll('"EXACT-9007199254740991"','9007199254740991');
  const sceneSelection=Object.freeze({workspaceId:U(1),homeId:U(2),revision:'generated-selection',publicationId:U(14),semanticsSha256:'c'.repeat(64)});
  const publicationRooms=Object.freeze([{roomId:'publication:room',buildingId:'publication:building',nativePlaceId:U(40),occurrenceIds:['occurrence:one','occurrence:two']}]);
  const reviewedRoomLinks=Object.freeze({profile:'houseatlas.unified-atlas-room-links.v1',workspaceId:U(1),homeId:U(2),publicationId:U(14),semanticsSha256:'c'.repeat(64),links:[{roomId:'publication:room',nativePlaceId:U(40),packagePlaceKey:packageKey,packagePlaceUuid:packageUuid}]});
  const context={sceneSelection,publicationRooms,reviewedRoomLinks,nativeBuildingId:U(3),native:{sessionIdentity:{},session:{schemaVersion:1,actorId:U(15),csrfToken:'generated-csrf',expiresAt:new Date(Date.now()+300000).toISOString()},view:{scope:{workspaceId:U(1),homeId:U(2)}},admission:null}};
  const counts={gets:0,opens:0,releases:0,disposes:0,subscriptions:0};
  const owners=[];
  const source=createUnifiedAtlasOverlaySource({getContext:()=>context,subscribeContext:()=>()=>{},fetch:async(url,init)=>{
    assert.equal(url,`/api/atlas/scene/v1/workspaces/${U(1)}/homes/${U(2)}/buildings/${U(3)}/current`);assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal.aborted,false);counts.gets++;
    return new Response(raw,{headers:{'Content-Type':'application/json'}});
  },createDocuments:()=>{let held=null;const owner={async open(id,signal){assert.equal(signal.aborted,false);const i=id===U(4)?0:1;assert.equal(id,documents[i].evidenceId);counts.opens++;held={lease:{},mode:'original-download',evidenceId:id,evidenceRevision:documents[i].evidenceRevision,asset:{assetId:documents[i].originalAssetId,revision,sha256:documents[i].originalSha256,contentType:'text/plain',byteSize:ExactDecimal.parse(String([primary,historical][i].length))}};return held;},isCurrent:f=>f===held,getBlob:f=>{assert.equal(f,held);return new Blob([f.evidenceId===U(4)?primary:historical],{type:'text/plain'});},subscribeInvalidation(f){assert.equal(f,held);counts.subscriptions++;return()=>counts.subscriptions--;},release(f){assert.equal(f,held);held=null;counts.releases++;},dispose(){assert.equal(held,null);counts.disposes++;}};owners.push(owner);return owner;}});
  try {
    const frame=await source.open({sceneSelection,nativeBuildingId:U(3),publicationRooms},new AbortController().signal);
    assert.equal(frame.status,'available',frame.status==='unavailable'?frame.reason:'available');assert.equal(source.isCurrent(frame),true);assert.equal(counts.gets,2);assert.equal(counts.opens,2);assert.equal(counts.subscriptions,2);
    assert.equal(frame.sourceSelection.sceneAssetRevision.toString(),'9007199254740991');
    assert.deepEqual(frame.roomBindings,[{roomId:'publication:room',nativePlaceId:U(40),spaceOccurrenceId:null,sourceRoomIds:['source:room'],targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,sourceAnchorIds:['generated:anchor']}],qualification:'current-native-room-join',anchor:{kind:'room-summary'}}]);
    assert.equal(frame.network.status,'available');assert.equal(frame.network.data.devices[0].id,'device:generated');assert.equal(frame.network.data.devices[0].place.coordinate,null);assert.equal(frame.network.data.source.status,'recorded');
    assert.equal(frame.electricity.status,'available');assert.equal(frame.electricity.data.sheets[0].roomAssociations[0].packagePlaceKey,packageKey);assert.equal(frame.electricity.data.sheets[0].roomAssociations[0].nativePlaceId,null);
    assert.equal(frame.electricalFixtures.status,'available');assert.equal(frame.electricalFixtures.data.fixtures[0].id,'socket');assert.equal(frame.electricalFixtures.data.groups[0].currentCircuitId,null);assert.equal(frame.electricalFixtures.data.groups[0].verifiedWiring,false);
    await new Promise(resolve=>setTimeout(resolve,10_100));
    assert.equal(counts.gets,3,'One sequential bounded positive head refresh');assert.equal(source.isCurrent(frame),true);
    assert.equal(Object.isFrozen(frame.roomBindings[0].targets),true);let notifications=0;source.subscribeInvalidation(frame,()=>notifications++);
    source.release(frame);assert.equal(notifications,1);assert.equal(counts.releases,2);assert.equal(counts.disposes,2);assert.equal(counts.subscriptions,0);
    console.log(JSON.stringify({status:'passed',profile:'healthy-unified-atlas-overlay-source.v1',sourcePins,counts,roomBindings:1,networkDevices:1,electricitySheets:1,documentaryFixtures:1,arbitraryPrecisionRevision:'9007199254740991',nativeWrites:0,realSourceRequests:0}));
  } finally {source.dispose();}
} finally {rmSync(scratch,{recursive:true,force:true});}
