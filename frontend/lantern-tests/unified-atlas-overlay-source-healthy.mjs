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
const paths=['frontend/integration/unified-atlas-overlay-source.ts','frontend/integration/native-scene-association-client.ts','frontend/integration/native-scene-source-client.ts','frontend/src/lantern/unified-atlas/runtime-overlays.ts','frontend/integration/unified-atlas-room-links-host.ts','frontend/integration/unified-atlas-room-links-reader.ts','frontend/integration/unified-atlas-room-links-owner.ts','frontend/integration/saved-documentary-preview.ts'];
const hash=v=>createHash('sha256').update(v).digest('hex');
const sourcePins=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(join(root,p)))]));
try {
  const entry=join(scratch,'entry.ts');
  writeFileSync(entry,`export {createUnifiedAtlasReviewedOverlays} from ${JSON.stringify(join(root,paths[4]))};\nexport {ExactDecimal} from ${JSON.stringify(join(root,'frontend/src/numeric/decimal.ts'))};\nexport {documentaryNetworkIndex,documentaryRoomRecords,documentaryOverlayIndex,matchesOverlayScene,projectDocumentaryFacts,mergeRuntimeRecords} from ${JSON.stringify(join(root,paths[3]))};\nexport {readSavedDocumentaryPreview} from ${JSON.stringify(join(root,'frontend/integration/saved-documentary-preview.ts'))};\n`);
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},minify:false}});
  const output=Array.isArray(built)?built[0]:built;
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,output.output.find(o=>o.type==='chunk'&&o.isEntry).code);
  const {createUnifiedAtlasReviewedOverlays,ExactDecimal,documentaryNetworkIndex,documentaryRoomRecords,documentaryOverlayIndex,matchesOverlayScene,projectDocumentaryFacts,mergeRuntimeRecords,readSavedDocumentaryPreview}=await import(pathToFileURL(modulePath).href);
  const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const canonical=v=>JSON.stringify(v,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const floor='generated:floor',floorHash='a'.repeat(64),packageKey='generated:room',packageUuid=U(21),photoHash='b'.repeat(64);
  const historical=Buffer.from('Generated historical documentary original.');
  const anchors=[{id:'generated:anchor',sourceFloorKey:floor,sourceOriginalSha256:floorHash,targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid}],unresolvedLabels:[]},
    {id:'generated:other-anchor',sourceFloorKey:floor,sourceOriginalSha256:floorHash,targets:[{packagePlaceKey:'generated:other-room',packagePlaceUuid:U(23)}],unresolvedLabels:[]}];
  const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'generated:receipt',sourceReceiptSha256:hash(historical),anchors});
  const receiptSha=hash(receipt);
  const fixtures={schema:'houseatlas.documentary-electrical-fixtures.v1',viewKey:'documentary-source',interpretationDate:'2026-10-10',
    symbolLegend:{xMeansSocket:true,socketsPerX:1,receiptId:'generated:symbol-review'},roomMappingReceipt:{id:'generated:receipt',sha256:receiptSha},registrationReceipts:[],
    sheets:[{id:'sheet',title:'Generated sheet',pdfPage:2,originalPhoto:'originals/generated.svg',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,sourceDate:null,regionIds:['region']}],
    groups:[{id:'group',label:'L1',fixtureIds:['socket'],evidenceBasis:'historic-drawing-label',currentCircuitId:null,verifiedWiring:false}],
    regions:[{id:'region',sheetId:'sheet',label:'Generated room',sourceOutline:[],outlineClosed:false,sourceBounds:[.1,.1,.9,.9],outlineBasis:'untraced',places:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,label:'Generated room',basis:'owner-reported'}],orientation:'unregistered',physicalTransform:null}],
    fixtures:[{id:'socket',sheetId:'sheet',regionId:'region',clusterId:null,kind:'socket',label:'Generated socket',glyph:'X',source:{symbolKey:'generated:symbol',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,normalizedBox:[.3,.3,.4,.4],normalizedPoint:[.35,.35],literalLabels:['L1'],placementDescription:'Generated symbol'},group:{id:'group',label:'L1',basis:'label-adjacent',note:'Historical label'},glyphCount:1,fixtureCount:1,uncertainty:null,currentState:'historic-unverified',physicalCoordinate:null,wireRoute:null}]};
  const statement=basis=>({statement:'Generated documentary statement',evidenceBasis:basis,uncertainty:{status:'unmeasured',explanation:'Documentary only'}});
  const sheet={document_id:'generated:sheet',bundle_id:'generated:bundle',title_as_read:'Generated sheet',source_photo:'originals/generated.svg',source_sha256:photoHash,rendered_photo:'rendered/generated.svg',pdf_page:2,factAt:'2026-10-09',interpretation_date:'2026-10-10',documentary_group_labels:['L1'],direct_reading:statement('document'),drawing_association:statement('inference'),open_uncertainty:'Historical only',native_atlas_identity_ids:[],owner_confirmed_room_mapping:null,owner_confirmed_layout_mapping:null,
    provisional_diagram:{coordinate_space:'normalized-upright-photo',geometry_status:'unmeasured',metric_units:null,scale:null,transform:null,region_xyxy:[.1,.1,.9,.9],source_date:null},
    package_room_associations:[{package_room_id:packageKey,stable_package_uuid:packageUuid,current_circuit_binding:null,native_atlas_identity_id:null,status:'inferred-name-or-context-match',evidenceBasis:'inference'}]};
  const primary=Buffer.from(JSON.stringify({schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:receipt,
    rooms:{status:'available',reason:null,receiptId:'generated:receipt',receiptSha256:receiptSha,entries:[],regions:[]},
    network:{status:'available',reason:null,source:{label:'Generated recorded network',revision:'source-1',recordedAt:'2026-10-10',retrievedAt:null,status:'recorded',acceptedAt:null,coverage:'partial',notes:''},
      devices:[{id:'device:generated',label:'Generated device',kind:'switch',mobility:'fixed',confidence:'recorded',notes:'',place:{sourceRoomId:'source:room',sourcePlaceId:packageKey,sourcePlaceUUID:packageUuid,planAssociations:[{sourceAnchorId:'generated:anchor',sourceFloorKey:floor,sourceFloorLabel:'Generated floor',sourceReference:'Generated documentary reference',sourceHandle:'generated:handle',sourceSHA256:floorHash}],roomLabel:'Generated room',detail:'',confidence:'recorded',basis:'Reviewed source association',sourceFloorKey:floor,mappingStatus:'accepted',coordinate:null}},{id:'device:mobile',label:'Generated phone',kind:'phone',mobility:'mobile',confidence:'recorded',notes:'Moves between rooms',place:null}],endpoints:[{id:'endpoint:segment',label:'Generated shared segment',kind:'segment',ownerDeviceId:null,notes:'No physical location'}],links:[{id:'link:generated',fromEndpointId:'device:generated',toEndpointId:'device:mobile',kind:'connection',medium:'wireless',confidence:'recorded',sourceConfidence:'uncertain source note',temporalStatus:'recorded-past',recordedAtPrecision:'day',basis:'Generated documentary connection',recordedAt:'2026-10-09',notes:'No physical route',path:null}]},
    electricity:{status:'available',reason:null,documentarySource:{schema:'private-documentary-records/v1',status:'documentary',native_import_receipt:null,records:[sheet]},roomRegistry:{schema:'private-houseatlas-room-registry/v1',entities:[{id:'generated:building',stable_uuid:U(22),display_name:'Generated building',aliases:[],source_refs:['generated']},{id:packageKey,stable_uuid:packageUuid,display_name:'Generated room',aliases:[],source_refs:['generated']}]},buildingPackageKey:'generated:building',retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:fixtures}}));
  const revision=ExactDecimal.parse('9007199254740991');
  const documents=[{role:'primary-scene',evidenceId:U(4),evidenceRevision:7,originalAssetId:U(5),originalAssetRevision:9007199254740991n,originalSha256:hash(primary),contentType:'text/plain'},
    {role:'documentary-sheet',evidenceId:U(6),evidenceRevision:8,originalAssetId:U(7),originalAssetRevision:9007199254740991n,originalSha256:hash(historical),contentType:'text/plain'}];
  const payload={profile:'houseatlas.native-scene-association.v1',buildingId:U(3),associationVersion:1,previousAssociationId:null,reviewStatus:'accepted',reviewStatement:'Generated reviewed association',sourceDocuments:documents,
    acceptedReceipt:{receiptId:'generated:receipt',canonicalJson:receipt,canonicalSha256:receiptSha,anchors},
    sourceFloors:[{sourceFloorKey:floor,sourceOriginalSha256:floorHash,nativeFloorKey:'native:floor',nativeGeometryId:U(10),nativeGeometryRevision:1,nativeOriginalAssetId:U(11),nativeOriginalSha256:floorHash}],
    roomMappings:[{sourceRoomId:'source:room',sourceFloorKey:floor,sourceOriginalSha256:floorHash,sourceAnchorIds:['generated:anchor','generated:other-anchor'],targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,atlasPlaceId:U(40)},{packagePlaceKey:'generated:other-room',packagePlaceUuid:U(23),atlasPlaceId:U(41)}],unresolvedLabels:[],evidenceIds:[U(4),U(6)]}]};
  const record={schemaVersion:1,recordType:'scene-association',recordId:U(12),workspaceId:U(1),homeId:U(2),revision:1,lifecycle:'active',createdAt:'2026-10-10T12:00:00Z',updatedAt:'2026-10-10T12:00:00Z',lastAuditId:U(13),payload};
  const raw=JSON.stringify({status:'available',association:record},(_,v)=>typeof v==='bigint'?'EXACT-'+v:v).replaceAll('"EXACT-9007199254740991"','9007199254740991');
  const headRaw=JSON.stringify({schema:'houseatlas.native-scene-head.v1',scope:{workspaceId:U(1),homeId:U(2)},buildingId:U(3),status:'available',reason:null,head:{recordId:U(12),revision:1,payloadSha256:hash(canonical(JSON.parse(raw).association.payload))}});
  const sceneSelection=Object.freeze({workspaceId:U(1),homeId:U(2),revision:'generated-selection',publicationId:U(14),semanticsSha256:'c'.repeat(64)});
  const publicationRooms=Object.freeze([{roomId:'publication:room',buildingId:'publication:building',nativePlaceId:U(40),occurrenceIds:['occurrence:one','occurrence:two']}]);
  const reviewedRoomLinks=Object.freeze({profile:'houseatlas.unified-atlas-room-links.v1',workspaceId:U(1),homeId:U(2),publicationId:U(14),semanticsSha256:'c'.repeat(64),links:[{roomId:'publication:room',nativePlaceId:U(40),packagePlaceKey:packageKey,packagePlaceUuid:packageUuid},{roomId:'publication:other-room',nativePlaceId:U(41),packagePlaceKey:'generated:other-room',packagePlaceUuid:U(23)}]});
  const context={sceneSelection,publicationRooms,reviewedRoomLinks,nativeBuildingId:U(3),native:{sessionIdentity:{},session:{schemaVersion:1,actorId:U(15),csrfToken:'generated-csrf',expiresAt:new Date(Date.now()+300000).toISOString()},view:{scope:{workspaceId:U(1),homeId:U(2)}},admission:null}};
  const counts={gets:0,currentGets:0,headGets:0,mapGets:0,opens:0,releases:0,disposes:0,subscriptions:0};
  const owners=[];
  const publishedRoom={...publicationRooms[0],label:'Generated room',nativeBinding:{status:'historical',receiptSha256:null}};
  const building=Object.freeze({buildingId:'publication:building',nativePlaceId:U(3)});
  const scene={scope:{workspaceId:U(1),homeId:U(2)},selection:{revision:sceneSelection.revision,publicationId:U(14)},
    publication:{publicationId:U(14),semanticsSha256:sceneSelection.semanticsSha256},buildings:[building,{buildingId:'publication:other-building',nativePlaceId:U(30)}],
    rooms:[publishedRoom,{roomId:'publication:other-room',buildingId:'publication:other-building',nativePlaceId:U(41),occurrenceIds:[],nativeBinding:{status:'unmapped',receiptSha256:null}}]};
  const origin='https://atlas.generated.invalid';
  const mapBytes=Buffer.from(JSON.stringify(reviewedRoomLinks)),mapSha=hash(mapBytes),hostListeners=new Set(),mapSignals=[];let headSignal=null;
  const mapURL=`${origin}/api/atlas/models/v1/workspaces/${U(1)}/homes/${U(2)}/atlas/${U(14)}/room-links?expectedSemanticsSha256=${sceneSelection.semanticsSha256}&expectedSelectionRevision=${sceneSelection.revision}`;
  const handle=await createUnifiedAtlasReviewedOverlays({selection:{owner:{},scope:scene.scope,publicationId:U(14),manifestSha256:'d'.repeat(64),expiresAt:context.native.session.expiresAt},
    scene,building,native:context.native,origin,signal:new AbortController().signal,isCurrent:()=>true,
    subscribe:changed=>{hostListeners.add(changed);return()=>hostListeners.delete(changed);},transport:async(url,init)=>{
    assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal.aborted,false);
    if(url===mapURL){counts.mapGets++;mapSignals.push(init.signal);return new Response(mapBytes,{headers:{'content-type':'application/json','content-length':String(mapBytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-atlas-selection-revision':sceneSelection.revision,'content-digest':`sha-256=:${Buffer.from(mapSha,'hex').toString('base64')}:`}});}
    const prefix=`/api/atlas/scene/v1/workspaces/${U(1)}/homes/${U(2)}/buildings/${U(3)}`;
    assert([`${prefix}/current`,`${prefix}/head`].includes(url));counts.gets++;
    const isHead=url===`${prefix}/head`;counts[isHead?'headGets':'currentGets']++;if(isHead)headSignal=init.signal;
    return new Response(isHead?headRaw:raw,{headers:{'Content-Type':'application/json'}});
  },createDocuments:()=>{let held=null;const owner={async open(id,signal){assert.equal(signal.aborted,false);const i=id===U(4)?0:1;assert.equal(id,documents[i].evidenceId);counts.opens++;held={lease:{},mode:'original-download',evidenceId:id,evidenceRevision:documents[i].evidenceRevision,asset:{assetId:documents[i].originalAssetId,revision,sha256:documents[i].originalSha256,contentType:'text/plain',byteSize:ExactDecimal.parse(String([primary,historical][i].length))}};return held;},isCurrent:f=>f===held,getBlob:f=>{assert.equal(f,held);return new Blob([f.evidenceId===U(4)?primary:historical],{type:'text/plain'});},subscribeInvalidation(f){assert.equal(f,held);counts.subscriptions++;return()=>counts.subscriptions--;},release(f){assert.equal(f,held);held=null;counts.releases++;},dispose(){assert.equal(held,null);counts.disposes++;}};owners.push(owner);return owner;}});
  assert.ok(handle);const {source,request}=handle;assert.equal(request.publicationRooms.length,1);
  try {
    const frame=await source.open(request,new AbortController().signal);
    assert.equal(frame.status,'available',frame.status==='unavailable'?frame.reason:'available');assert.equal(source.isCurrent(frame),true);assert.equal(counts.gets,2);assert.equal(counts.currentGets,2);assert.equal(counts.headGets,0);assert.equal(counts.mapGets,1);assert.equal(counts.opens,2);assert.equal(counts.subscriptions,2);
    assert.equal(frame.sourceSelection.sceneAssetRevision.toString(),'9007199254740991');
    assert.deepEqual(frame.roomBindings,[{roomId:'publication:room',nativePlaceId:U(40),spaceOccurrenceId:null,sourceRoomIds:['source:room'],targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,sourceAnchorIds:['generated:anchor']}],qualification:'current-native-room-join',anchor:{kind:'room-summary'}}]);
    assert.equal(frame.network.status,'available');assert.equal(frame.network.data.devices[0].id,'device:generated');assert.equal(frame.network.data.devices[0].place.coordinate,null);assert.equal(frame.network.data.source.status,'recorded');
    assert.equal(frame.electricity.status,'available');assert.equal(frame.electricity.data.sheets[0].roomAssociations[0].packagePlaceKey,packageKey);assert.equal(frame.electricity.data.sheets[0].roomAssociations[0].nativePlaceId,null);
    assert.equal(frame.electricalFixtures.status,'available');assert.equal(frame.electricalFixtures.data.fixtures[0].id,'socket');assert.equal(frame.electricalFixtures.data.groups[0].currentCircuitId,null);assert.equal(frame.electricalFixtures.data.groups[0].verifiedWiring,false);
    // The consumer uses current independently qualified joins without changing
    // historical producer status or converting documentary IDs to native IDs.
    assert.equal(matchesOverlayScene(frame,scene,'publication:building'),true);
    const records=documentaryRoomRecords(scene,frame,new Set(['occurrence:one','occurrence:two'])), roomRecords=records.rooms.get('publication:room');
    assert.deepEqual([records.network,records.electrical],['available','available']);
    assert.equal(roomRecords.network.length,1);assert.equal(roomRecords.electrical.length,2);
    assert.equal(roomRecords.network[0].id,'device:generated');
    assert.equal(roomRecords.network[0].sourceFacts.find(f=>f.label==='Source revision').value,'source-1');
    const sourceLink=JSON.parse(roomRecords.network[0].sourceFacts.find(f=>f.label==='Connection source facts').value)[0];
    assert.deepEqual([sourceLink.sourceConfidence,sourceLink.recordedAt,sourceLink.recordedAtPrecision],['uncertain source note','2026-10-09','day']);
    assert.equal(roomRecords.electrical[0].sourceFacts.find(f=>f.label==='Source fact date').value,'2026-10-09');
    assert.equal(roomRecords.electrical[1].sourceFacts.find(f=>f.label==='Interpretation date').value,'2026-10-10');
    assert.equal(records.sourceFacts.find(f=>f.label==='Native association revision').value,'1');
    assert.deepEqual(roomRecords.electrical.map(r=>r.category),['Electrical drawing','Historical symbol']);
    assert.match(roomRecords.electrical[1].qualification,/no current circuit/);
    assert.equal(publishedRoom.nativeBinding.status,'historical');
    assert.deepEqual(records.unplaced.network.map(r=>r.id),['device:mobile','link:generated','endpoint:segment']);
    assert.equal(records.unplaced.electrical.length,0);
    // Positive presentation graph: original source records and reviewed placement
    // remain intact while incidence is built once, including both self-link forms.
    const sourceData = frame.network.data;
    const owned = ['one', 'two'].map(id => ({ ...sourceData.endpoints[0], id: `endpoint:${id}`, label: `Interface ${id}`, ownerDeviceId: 'device:generated' }));
    const ends = [
      ['direct', 'device:generated', 'device:mobile'],
      ['owned', 'endpoint:one', 'device:mobile'],
      ['self', 'device:generated', 'device:generated'],
      ['same-owner', 'endpoint:one', 'endpoint:two'],
      ['parallel', 'device:generated', 'device:mobile'],
      ['ownerless', 'endpoint:segment', 'device:mobile'],
    ];
    const graph = { ...sourceData, endpoints: [...sourceData.endpoints, ...owned],
      links: ends.map(([id, fromEndpointId, toEndpointId], i) => ({ ...sourceData.links[0], id: `link:${id}`, fromEndpointId, toEndpointId,
        sourceConfidence: `Generated confidence ${i}`, recordedAtPrecision: 'day', notes: `Generated note ${i}` })) };
    const indexed = documentaryNetworkIndex(graph);
    const expected = new Map([
      ['device:generated', graph.links.slice(0, 5)],
      ['device:mobile', [graph.links[0], graph.links[1], graph.links[4], graph.links[5]]],
    ]);
    const labels = ['Generated device ↔ Generated phone', 'Generated device (Interface one) ↔ Generated phone',
      'Generated device ↔ Generated device', 'Generated device (Interface one) ↔ Generated device (Interface two)',
      'Generated device ↔ Generated phone', 'Generated shared segment ↔ Generated phone'];
    graph.links.forEach((link, i) => assert.equal(indexed.labels.get(link), labels[i]));
    for (const [id, links] of expected) {
      assert.deepEqual(indexed.incident.get(id), links);
      indexed.incident.get(id).forEach((link, i) => assert.equal(link, links[i], 'Retain the original provenance object'));
      assert.equal(indexed.facts.get(id), JSON.stringify(links));
      assert.deepEqual(indexed.connections.get(id), links.map(link => [labels[graph.links.indexOf(link)], link.medium,
        `Curated confidence: ${link.confidence}`, `Source confidence: ${link.sourceConfidence}`,
        `Recorded: ${link.recordedAt} (${link.recordedAtPrecision})`, link.temporalStatus, link.basis, link.notes].join(' · ')));
    }
    const projected = documentaryRoomRecords(scene, { ...frame, network: { ...frame.network, data: graph } }, new Set(['occurrence:one', 'occurrence:two']));
    const placedDevice = projected.rooms.get('publication:room').network[0];
    assert.equal(placedDevice.sourceFacts.find(f => f.label === 'Connection source facts').value, indexed.facts.get('device:generated'));
    assert.deepEqual(placedDevice.connections, indexed.connections.get('device:generated'));
    assert.deepEqual(projected.unplaced.network.map(row => row.id), ['device:mobile', ...graph.links.map(link => link.id), ...graph.endpoints.map(endpoint => endpoint.id)]);
    assert.equal(projected.unplaced.network[0].sourceFacts.find(f => f.label === 'Connection source facts').value, indexed.facts.get('device:mobile'));
    const consumerModel={roomsById:new Map([[publishedRoom.roomId,publishedRoom]]),selectable:new Set(['occurrence:one','occurrence:two'])};
    for(const kind of ['network','electrical']){
      const index=documentaryOverlayIndex(consumerModel,records,kind);
      assert.deepEqual([...index.placed.keys()],['occurrence:one','occurrence:two']);
      assert.deepEqual(index.placed.get('occurrence:one').positions,[]);
      assert.equal(index.records,kind==='network'?4:2);assert.equal(index.unplacedRecords,kind==='network'?3:0);
    }
    // The same generated factual source is read as a saved snapshot WITHOUT a
    // native selection/frame/lease. Its exact captured joins remain documentary.
    const ownedPins = frame.sourceSelection;
    const pins = Object.fromEntries(['workspaceId','homeId','buildingId','viewKey','sceneEvidenceId','sceneAssetId',
      'sceneOriginalSha256','sceneEvidenceRevision','acceptedRoomReceiptId','acceptedRoomReceiptSha256',
      'acceptedRoomAnchors','acceptedRoomMappings'].filter(key => ownedPins[key] !== undefined).map(key => [key, ownedPins[key]]));
    pins.sceneAssetRevision = ownedPins.sceneAssetRevision.toString();
    pins.sourceFloorBindings = ownedPins.sourceFloorBindings.map(binding => ({ ...binding, nativeGeometryRevision: binding.nativeGeometryRevision.toString() }));
    const file = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
    const snapshotManifest = { profile: 'houseatlas.saved-documentary-preview.v1', observedAt: '2026-10-10T12:00:00Z',
      publicationId: U(14), semanticsSha256: scene.publication.semanticsSha256, modelSha256: 'e'.repeat(64),
      entryBuildingId: building.buildingId, pins, primary: file('/review-input/primary.json', primary),
      support: file('/review-input/support.txt', historical), roomLinks: file('/review-input/links.json', mapBytes) };
    const savedFiles = new Map([[snapshotManifest.primary.path, primary], [snapshotManifest.support.path, historical], [snapshotManifest.roomLinks.path, mapBytes]]);
    let savedReads = 0;
    const saved = await readSavedDocumentaryPreview(Buffer.from(JSON.stringify(snapshotManifest)), async (path, maximum) => {
      savedReads++; const bytes = savedFiles.get(path); assert.ok(bytes && bytes.length <= maximum); return bytes;
    }, () => {});
    const savedScene = { ...scene, model: { sha256: snapshotManifest.modelSha256 },
      buildings: scene.buildings.map((row, at) => ({ ...row, label: `Generated building ${at}`, levelIds: [`generated:level:${at}`] })) };
    const savedSelectable = new Set(['occurrence:one','occurrence:two']);
    const savedRecords = saved.records(savedScene, savedSelectable);
    assert.equal(savedReads, 3); assert.equal(saved.observedAt, snapshotManifest.observedAt);
    assert.equal(saved.entryBuildingId, building.buildingId);
    assert.deepEqual([documentaryOverlayIndex(consumerModel, savedRecords, 'network').records,
      documentaryOverlayIndex(consumerModel, savedRecords, 'electrical').records], [4, 2]);
    assert.equal(documentaryOverlayIndex(consumerModel, savedRecords, 'network').unplacedRecords, 3);
    const coverage = records => new Map(records.buildings.map(row => [row.buildingId, [row.network, row.electrical, row.reason]]));
    assert.deepEqual(coverage(savedRecords).get(building.buildingId), ['available', 'available', 'saved room identity links; no metric positions']);
    assert.deepEqual(coverage(savedRecords).get('publication:other-building'), ['unavailable', 'unavailable', 'no captured source for this building']);
    assert.deepEqual([savedRecords.network, savedRecords.electrical], ['partial', 'partial']);
    const reversed = saved.records({ ...savedScene, buildings: [...savedScene.buildings].reverse() }, savedSelectable);
    assert.deepEqual(coverage(reversed), coverage(savedRecords), 'source ownership is independent of building array order');
    assert.deepEqual([reversed.network, reversed.electrical], ['partial', 'partial']);
    const unlinked = saved.records({ ...savedScene, buildings: [...savedScene.buildings, { ...savedScene.buildings[1],
      buildingId: 'publication:unlinked-building', label: 'Generated unlinked building', nativePlaceId: null, levelIds: ['generated:unlinked-level'] }] }, savedSelectable);
    assert.deepEqual(coverage(unlinked).get('publication:unlinked-building'), ['unavailable', 'unavailable', 'no captured source for this building']);
    assert.deepEqual([unlinked.network, unlinked.electrical], ['partial', 'partial']);
    assert.deepEqual(unlinked.networkGraphs, savedRecords.networkGraphs);
    assert.deepEqual(savedRecords.rooms.get('publication:room').network.map(row => row.id), ['device:generated']);
    assert.equal(savedRecords.networkGraphs.length, 1);
    assert.deepEqual(savedRecords.networkGraphs[0].data.devices.map(row => row.id), sourceData.devices.map(row => row.id));
    assert.deepEqual(savedRecords.networkGraphs[0].data.endpoints.map(row => row.id), sourceData.endpoints.map(row => row.id));
    assert.deepEqual(savedRecords.networkGraphs[0].data.links.map(row => row.id), sourceData.links.map(row => row.id));
    assert.equal(savedRecords.unplaced.network.find(row => row.id === 'device:mobile').sourceDate, sourceData.source.recordedAt);
    assert.ok(savedRecords.sourceFacts.some(fact => fact.label === 'Presentation' && fact.value.startsWith('Saved documentary')));
    assert.equal('lease' in saved, false); assert.equal('isCurrent' in saved, false); assert.equal('sessionIdentity' in saved, false);
    assert.ok(!JSON.stringify(savedRecords.sourceFacts).includes('currentNativeRoomReview'));
    // Repeated building views of one primary evidence retain one inventory.
    const propertyModel = { ...consumerModel, buildingsById: new Map([[building.buildingId, { label: 'Generated A' }], ['publication:other-building', { label: 'Generated B' }]]) };
    const union = mergeRuntimeRecords(propertyModel, [{ buildingId: building.buildingId, reason: 'available', records },
      { buildingId: 'publication:other-building', reason: 'available', records }]);
    assert.equal(documentaryOverlayIndex(consumerModel, union, 'network').records, 4);
    assert.equal(union.rooms.get('publication:room').network[0].observations, undefined);
    const refreshDeadline=Date.now()+15_000;
    while(Date.now()<refreshDeadline&&!(counts.mapGets===2&&mapSignals[1]?.aborted&&counts.headGets===1&&headSignal?.aborted))
      await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(mapSignals[1]?.aborted,true,'Normal map refresh completed');assert.equal(headSignal?.aborted,true,'Normal native head refresh completed');
    assert.equal(counts.gets,3,'One sequential bounded positive head refresh');assert.equal(counts.currentGets,2);assert.equal(counts.headGets,1);assert.equal(counts.mapGets,2);assert.equal(source.isCurrent(frame),true);
    assert.equal(Object.isFrozen(frame.roomBindings[0].targets),true);let notifications=0;source.subscribeInvalidation(frame,()=>notifications++);
    source.release(frame);assert.equal(notifications,1);assert.equal(counts.releases,2);assert.equal(counts.disposes,2);assert.equal(counts.subscriptions,0);assert.equal(hostListeners.size,0);
    console.log(JSON.stringify({status:'passed',profile:'healthy-unified-atlas-overlay-source.v1',sourcePins,counts,roomBindings:1,networkDevices:2,networkLinks:1,networkEndpoints:1,electricitySheets:1,documentaryFixtures:1,arbitraryPrecisionRevision:'9007199254740991',nativeWrites:0,realSourceRequests:0}));
  } finally {source.dispose();}
} finally {rmSync(scratch,{recursive:true,force:true});}
