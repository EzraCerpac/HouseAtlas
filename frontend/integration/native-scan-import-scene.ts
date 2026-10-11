import { createNativeScanTextImporter, verifyNativeScanText, nativeScanImportDigest, nativeScanImportResponseJson, nativeScanImportWait,
  type NativeScanImportOptions, type NativeScanTextInput, type NativeScanTextResult } from './native-scan-import-text';
import { createNativeGeometryReadClient } from './native-geometry-read-client';
import { createNativeEvidenceDocumentClient } from './native-evidence-document-client';
import { createNativeSceneAssociationClient, type SceneAssociationPrepared, type SceneAssociationCurrent } from './native-scene-association-client';
import { createNativeSceneSourceClient } from './native-scene-source-client';
import { readDocumentarySupport, documentaryReferences } from './native-scene-documentary-support';
import type { NativeDocumentBinding } from '../src/lantern/scans/native-document-types';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { NativeGeometryFrame, NativeGeometryReadClient, NativeGeometryFloor } from '../src/lantern/scans/native-read-types';
import type { NativeSceneSourceSelection, NativeSceneAcceptedAnchor } from '../src/lantern/scans/native-scene-source-types';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type JsonForSerialization, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator } from '../src/numeric/schema-validator';

export interface NativeScanSceneFloorSelection {
  readonly sourceFloorKey: string;
  readonly sourceOriginalSha256: string;
  /** Exact supplied selected native geometry identity; never a guessed floor key. */
  readonly nativeGeometryId: string;
}
export interface NativeScanSceneRoomMapping {
  readonly sourceRoomId:string; readonly sourceFloorKey:string; readonly sourceOriginalSha256:string;
  readonly sourceAnchorIds:readonly string[];
  readonly targets:readonly {readonly packagePlaceKey:string;readonly packagePlaceUuid:string}[];
  readonly unresolvedLabels:readonly string[];
}
export interface NativeScanSceneInput {
  readonly buildingId: string;
  readonly primary: NativeScanTextInput;
  readonly historical: NativeScanTextInput;
  readonly sourceFloors: readonly NativeScanSceneFloorSelection[];
  readonly roomMappings: readonly NativeScanSceneRoomMapping[];
  readonly statement: string;
  readonly reason: string;
  /** Deliberate reviewed support confirmation, checked by the production client. */
  readonly confirmDrawingSupport: boolean;
}
/** Pure preflight has no native floor identities yet. The invoking host joins
 * these explicit source pairs to verified geometry results only after custody. */
export type NativeScanScenePreflightInput = Omit<NativeScanSceneInput, 'sourceFloors'> & {
  readonly sourceFloors: readonly Pick<NativeScanSceneFloorSelection, 'sourceFloorKey' | 'sourceOriginalSha256'>[];
};
export interface NativeScanSceneExpected {
  readonly recordId:string;
  /** Exact original claim/current payload; ordinary safe numbers are parsed losslessly. */
  readonly payload:JsonForSerialization;
}
export type NativeScanSceneResult = {readonly outcome:'committed'; readonly current:SceneAssociationCurrent;
  readonly primary:Extract<NativeScanTextResult,{outcome:'committed'}>; readonly historical:Extract<NativeScanTextResult,{outcome:'committed'}>}
  | Exclude<NativeScanTextResult,{outcome:'committed'}>
  | {readonly outcome:'unknown';readonly phase:'scene-association';readonly requestId:string}
  | {readonly outcome:'partial';readonly phase:'scene-association';readonly requestId:string;readonly current:SceneAssociationCurrent;
    readonly primary:Extract<NativeScanTextResult,{outcome:'committed'}>;readonly historical:Extract<NativeScanTextResult,{outcome:'committed'}>};
type Row = {[key:string]:LosslessJson};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
function need(value:unknown):asserts value {if(!value)throw new TypeError('Native scan scene inputs or current owners differ');}
function row(value:LosslessJson|undefined):Row {need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&!isExactDecimal(value));return value;}
function canonical(value:LosslessJson):string {
  if(isExactDecimal(value)){const n=value.toSafeInteger();need(n!==undefined);return JSON.stringify(n);}
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
function closed(value:Row,keys:readonly string[]):void {need(Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k)));}
/** Local grammar validation only. These ephemeral ports expose supplied Blobs
 * to the real closed source parser; no HTTP/auth/custody or native authority is
 * manufactured, and no validation frame/identity escapes this function. */
export async function preflightNativeScanScene(input:NativeScanScenePreflightInput,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();need(UUID.test(input.buildingId)&&input.primary.buildingId===input.buildingId&&input.historical.buildingId===input.buildingId
    &&typeof input.confirmDrawingSupport==='boolean'&&typeof input.statement==='string'&&input.statement.trim()&&input.statement.length<=4096
    &&typeof input.reason==='string'&&input.reason.trim()&&input.reason.length<=1024);
  for(const text of [input.statement,input.reason])for(const char of text){const point=char.codePointAt(0)!;need(point<0xd800||point>0xdfff);}
  need(Array.isArray(input.sourceFloors)&&input.sourceFloors.length>0&&input.sourceFloors.length<=3&&Array.isArray(input.roomMappings)&&input.roomMappings.length<=256);
  const selected=new Set<string>();
  for(const f of input.sourceFloors){closed(f as unknown as Row,['sourceFloorKey','sourceOriginalSha256']);need(typeof f.sourceFloorKey==='string'&&f.sourceFloorKey.trim()===f.sourceFloorKey
    &&f.sourceFloorKey.length>0&&f.sourceFloorKey.length<=256&&SHA.test(f.sourceOriginalSha256)&&!selected.has(f.sourceFloorKey));selected.add(f.sourceFloorKey);}
  const pText=await nativeScanImportWait(verifyNativeScanText(input.primary,signal),signal);
  const hText=await nativeScanImportWait(verifyNativeScanText(input.historical,signal),signal);
  const stored=row(parseLosslessJson(pText));need(typeof stored.receiptCanonicalJson==='string'&&stored.receiptCanonicalJson.length<=131072);
  const receipt=row(parseLosslessJson(stored.receiptCanonicalJson));closed(receipt,['profile','receiptId','sourceReceiptSha256','anchors']);
  need(receipt.profile==='houseatlas.native-scene-room-review.v1'&&receipt.sourceReceiptSha256===input.historical.sha256&&canonical(receipt)===stored.receiptCanonicalJson
    &&typeof receipt.receiptId==='string'&&receipt.receiptId.length>0&&receipt.receiptId.length<=256&&Array.isArray(receipt.anchors));
  const receiptSha=await nativeScanImportDigest(new TextEncoder().encode(stored.receiptCanonicalJson));signal.throwIfAborted();
  const support=await readDocumentarySupport(new TextEncoder().encode(hText),()=>signal.throwIfAborted());
  if(support)need(input.confirmDrawingSupport&&input.statement.length+support.reviewMarker.length<=4096&&support.pdf.buildingId===input.buildingId);
  // Local identifiers distinguish parser leases only. They are never returned
  // as native mappings, guards, admission, receipts, or a persisted scene.
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,one=ExactDecimal.parse('1');
  const scope=support?{workspaceId:support.pdf.workspaceId,homeId:support.pdf.homeId}:{workspaceId:id(1),homeId:id(2)};
  const viewKey=await nativeScanImportDigest(new TextEncoder().encode('local-scene-grammar:'+input.primary.sha256));signal.throwIfAborted();
  const floorRows:NativeGeometryFloor[]=input.sourceFloors.map((f,n)=>({key:(n+1).toString(16).padStart(64,'0'),exportLabel:f.sourceFloorKey,
    originalSha256:f.sourceOriginalSha256,derivativeSha256:f.sourceOriginalSha256,geometryId:id(100+n),geometryRevision:one,
    evidenceId:id(200+n),evidenceRevision:one,originalAssetId:id(300+n),originalRevision:one,derivativeAssetId:id(400+n),derivativeRevision:one,
    originalLicense:{status:'unknown',reference:null},derivativeLicense:{status:'unknown',reference:null}}));
  let active=true;
  const unavailable=()=>{throw new TypeError('Local scene preflight has no geometry read transport');};
  const geometryFrame:NativeGeometryFrame={lease:{},viewKey,descriptor:{schemaVersion:one,profile:'houseatlas.magicplan-authored-mesh.v1',scope,buildingId:input.buildingId,viewKey,
    floors:floorRows.map(floor=>({floor,readPath:''})),physicalScale:'unknown',floorAlignment:'unknown',stageToHouseTransform:null},
    floors:floorRows.map(f=>{const {originalSha256,derivativeSha256,...rest}=f;return {...rest,originalSHA256:originalSha256,derivativeSHA256:derivativeSha256};}),
    readPort:{isCurrent:()=>active,subscribeInvalidation:()=>()=>undefined,read:async()=>unavailable()}};
  const geometry:NativeGeometryReadClient={loadBuilding:async()=>unavailable(),isCurrent:f=>active&&f===geometryFrame,
    subscribeInvalidation:(f,fn)=>{if(!active||f!==geometryFrame)fn();return()=>undefined;},dispose:()=>{active=false;}};
  const documents=(file:NativeScanTextInput,evidenceId:string,assetId:string):NativeEvidenceDocumentClient=>{
    let current:NativeEvidenceDocumentFrame|null=null,disposed=false;const listeners=new Set<()=>void>();
    const retire=()=>{current=null;for(const fn of listeners){try{fn();}catch{/* Retire all local leases. */}}listeners.clear();};
    return {open:async(request,abort)=>{abort.throwIfAborted();need(active&&!disposed&&request===evidenceId);retire();
      current={lease:{},evidenceId,evidenceRevision:1,mode:'original-download',asset:{assetId,revision:one,contentType:'text/plain',sha256:file.sha256,
        byteSize:ExactDecimal.parse(String(file.byteSize)),purpose:'evidence-original',previewPolicy:'download-only',sourceLicense:file.sourceLicense,evidenceIds:[evidenceId]}};return current;},
      isCurrent:f=>active&&!disposed&&current===f,getBlob:f=>active&&!disposed&&current===f?file.file:null,
      subscribeInvalidation:(f,fn)=>{if(!active||disposed||current!==f){fn();return()=>undefined;}listeners.add(fn);return()=>{listeners.delete(fn);};},
      release:f=>{if(current===f)retire();},dispose:()=>{disposed=true;retire();}};
  };
  const primary=documents(input.primary,id(10),id(11));
  let selection:NativeSceneSourceSelection={sessionIdentity:{},...scope,expiresAt:new Date(Date.now()+75000).toISOString(),buildingId:input.buildingId,viewKey,
    sceneEvidenceId:id(10),sceneEvidenceRevision:1,sceneAssetId:id(11),sceneAssetRevision:one,sceneOriginalSha256:input.primary.sha256,
    acceptedRoomReceiptId:receipt.receiptId,acceptedRoomReceiptSha256:receiptSha,acceptedRoomAnchors:receipt.anchors as unknown as NativeSceneAcceptedAnchor[],
    sourceFloorBindings:input.sourceFloors.map((f,n)=>({sourceFloorKey:f.sourceFloorKey,sourceOriginalSha256:f.sourceOriginalSha256,nativeFloorKey:floorRows[n]!.key,
      nativeOriginalAssetId:floorRows[n]!.originalAssetId,nativeOriginalSha256:f.sourceOriginalSha256,nativeGeometryId:floorRows[n]!.geometryId,nativeGeometryRevision:one}))};
  if(support)selection={...selection,drawingSupport:{evidenceId:id(12),evidenceRevision:1,assetId:id(13),assetRevision:one,originalSha256:input.historical.sha256,reviewMarker:support.reviewMarker},
    drawingReferences:documentaryReferences(support,selection)};
  const parser=createNativeSceneSourceClient({documents:primary,createDrawingReview:()=>documents(input.historical,id(12),id(13)),geometry,
    getSelection:()=>active?selection:null,subscribeSelection:()=>()=>undefined});
  try{
    const frame=await parser.open(selection,geometryFrame,signal);need(parser.isCurrent(frame)&&frame.rooms.status==='available');
    for(const field of ['network','electricity','electricalFixtures'] as const){const requested=stored[field];
      if(requested!==undefined)need(frame[field].status===row(requested).status);}
    const rooms=frame.rooms.data.rooms;need(rooms.length===input.roomMappings.length);
    const seen=new Set<string>();
    for(const m of input.roomMappings as readonly NativeScanSceneRoomMapping[]){closed(m as unknown as Row,['sourceRoomId','sourceFloorKey','sourceOriginalSha256','sourceAnchorIds','targets','unresolvedLabels']);
      need(!seen.has(m.sourceRoomId));seen.add(m.sourceRoomId);const entry=rooms.find(r=>r.id===m.sourceRoomId);need(entry);
      const floor=input.sourceFloors.find(f=>f.sourceFloorKey===m.sourceFloorKey);need(floor&&floor.sourceOriginalSha256===m.sourceOriginalSha256
        &&entry.floorKey===selection.sourceFloorBindings.find(f=>f.sourceFloorKey===m.sourceFloorKey)?.nativeFloorKey
        &&canonical(parseLosslessJson(stringifyLosslessJson(m.sourceAnchorIds)))===canonical(parseLosslessJson(stringifyLosslessJson(entry.sourceAnchorIds)))
        &&m.targets.some(t=>t.packagePlaceKey===entry.packagePlaceKey&&t.packagePlaceUuid===entry.packagePlaceUuid));}
    // The real production request schema validates the complete closed mapping
    // grammar. The validation envelope is never dispatched or returned.
    const sourceDocuments=[{role:'primary-scene',evidenceId:id(10),evidenceRevision:1,originalAssetId:id(11),originalAssetRevision:one,originalSha256:input.primary.sha256,contentType:'text/plain'},
      {role:'documentary-sheet',evidenceId:id(12),evidenceRevision:1,originalAssetId:id(13),originalAssetRevision:one,originalSha256:input.historical.sha256,contentType:'text/plain'}];
    const payload={profile:'houseatlas.native-scene-association.v1',buildingId:input.buildingId,associationVersion:one,previousAssociationId:null,reviewStatus:'accepted',
      reviewStatement:input.statement+(support?.reviewMarker??''),sourceDocuments,acceptedReceipt:{receiptId:receipt.receiptId,canonicalJson:stored.receiptCanonicalJson,canonicalSha256:receiptSha,anchors:receipt.anchors},
      sourceFloors:selection.sourceFloorBindings,roomMappings:input.roomMappings.map(m=>({...m,targets:m.targets.map((t:NativeScanSceneRoomMapping['targets'][number])=>({...t,atlasPlaceId:null})),evidenceIds:[id(10),id(12)]}))};
    const request={schemaVersion:3,commandId:'atlas.scene-association.create',requestId:id(20),context:scope,target:{authority:'atlas',recordType:'scene-association',recordId:id(21)},
      payload,idempotencyKey:id(22),reason:input.reason,approvalReceiptId:null,preconditions:{target:null,guards:[{target:{authority:'atlas',recordType:'identity',recordId:input.buildingId},revision:{kind:'atlas',value:one}}]}};
    const body=stringifyLosslessJson(request as unknown as JsonForSerialization);need(new TextEncoder().encode(body).length<=1024*1024&&createExactStockResultValidator().validateNativeRequest('atlas.scene-association.create',parseLosslessJson(body)));
    signal.throwIfAborted();
  }finally{parser.dispose();primary.dispose();geometry.dispose();active=false;}
}
/** Owns only the documentary/scene phase. Authentication, private journaling and
 * original geometry custody belong to the invoking agent host. No UI mounting. */
export function createNativeScanSceneImporter(options:NativeScanImportOptions) {
  const validator=createExactStockResultValidator(),texts=createNativeScanTextImporter(options);
  let binding:NativeDocumentBinding|null=null,key='',disposed=false,busy=false,claimed=false,completed=false;
  let selection:NativeSceneSourceSelection|null=null;
  const selectionListeners=new Set<()=>void>();
  const notify=()=>{for(const fn of selectionListeners){try{fn();}catch{/* Withdraw every source lease. */}}};
  const getBinding=()=>{
    let next;try{next=options.getContext();}catch{binding=null;return null;}
    if(disposed||!next||!next.sessionIdentity||next.session.schemaVersion!==1||!next.session.actorId||!next.session.csrfToken
      ||!Number.isFinite(Date.parse(next.session.expiresAt))||Date.parse(next.session.expiresAt)<=Date.now()
      ||!next.view.canEdit||!next.admission||!UUID.test(next.view.scope.workspaceId)||!UUID.test(next.view.scope.homeId)
      ||next.view.scope.workspaceId!==next.admission.scope.workspaceId||next.view.scope.homeId!==next.admission.scope.homeId){binding=null;return null;}
    const k=JSON.stringify([next.session.actorId,next.session.csrfToken,next.session.expiresAt,next.view.scope,next.admission.revision,next.admission.commandIds]);
    if(!binding||binding.sessionIdentity!==next.sessionIdentity||k!==key){key=k;binding=Object.freeze({sessionIdentity:next.sessionIdentity,expiresAt:next.session.expiresAt,scope:Object.freeze({...next.view.scope})});}
    return binding;
  };
  const geometry=createNativeGeometryReadClient({getBinding,subscribeBinding:options.subscribe,origin:options.origin,transport:options.transport});
  const document=()=>createNativeEvidenceDocumentClient({getBinding,subscribeBinding:options.subscribe,origin:options.origin,transport:options.transport});
  const primaryReview=document(),historicalReview=document(),sourceDocuments=document();
  const associations=createNativeSceneAssociationClient({getContext:options.getContext,subscribe:options.subscribe,primaryReview,historicalReview,
    createDrawingReview:document,geometryCurrent:geometry.isCurrent,transport:options.transport});
  const source=createNativeSceneSourceClient({documents:sourceDocuments,createDrawingReview:document,geometry,
    getSelection:()=>selection,subscribeSelection:fn=>{selectionListeners.add(fn);return()=>{selectionListeners.delete(fn);};}});
  let retained:{prepared:SceneAssociationPrepared;input:NativeScanSceneInput;primary:Extract<NativeScanTextResult,{outcome:'committed'}>;
    historical:Extract<NativeScanTextResult,{outcome:'committed'}>;acknowledged?:SceneAssociationCurrent}|null=null;
  const checkFloors=(input:NativeScanSceneInput,frame:NativeGeometryFrame)=>{
    need(geometry.isCurrent(frame)&&frame.descriptor.buildingId===input.buildingId&&frame.floors.length>0
      &&frame.floors.length<=3&&input.sourceFloors.length===frame.floors.length);
    const seen=new Set<string>(),sourceKeys=new Set<string>();
    return input.sourceFloors.map(item=>{
      need(UUID.test(item.nativeGeometryId)&&SHA.test(item.sourceOriginalSha256)&&item.sourceFloorKey.trim()
        &&item.sourceFloorKey.length<=256&&!seen.has(item.nativeGeometryId)&&!sourceKeys.has(item.sourceFloorKey));
      seen.add(item.nativeGeometryId);sourceKeys.add(item.sourceFloorKey);
      const floor=frame.floors.find(f=>f.geometryId===item.nativeGeometryId);need(floor);
      return {sourceFloorKey:item.sourceFloorKey,sourceOriginalSha256:item.sourceOriginalSha256,nativeFloorKey:floor.key,
        nativeOriginalAssetId:floor.originalAssetId,nativeOriginalSha256:floor.originalSHA256,
        nativeGeometryId:floor.geometryId,nativeGeometryRevision:floor.geometryRevision};
    });
  };
  const verifyReadback=async(current:SceneAssociationCurrent,frame:NativeGeometryFrame,signal:AbortSignal,input:NativeScanSceneInput)=>{
    selection=current.selection;notify();
    const observed=await source.open(current.selection,frame,signal);
    try{need(source.isCurrent(observed)&&geometry.isCurrent(frame)&&observed.sourceAssetId===current.selection.sceneAssetId
      &&observed.sourceOriginalSha256===current.selection.sceneOriginalSha256&&observed.receiptId===current.selection.acceptedRoomReceiptId
      &&observed.receiptSha256===current.selection.acceptedRoomReceiptSha256&&observed.rooms.status==='available');
      const requested=row(parseLosslessJson(await nativeScanImportWait(verifyNativeScanText(input.primary,signal),signal)));
      for(const field of ['network','electricity','electricalFixtures'] as const)if(requested[field]!==undefined)
        need(observed[field].status===row(requested[field]).status);
      signal.throwIfAborted();need(source.isCurrent(observed)&&geometry.isCurrent(frame));}
    finally{source.release(observed);selection=null;notify();}
  };
  const guards=async(input:NativeScanSceneInput,frame:NativeGeometryFrame,primary:Pick<Extract<NativeScanTextResult,{outcome:'committed'}>,'assetId'|'evidenceId'>,
    historical:Pick<Extract<NativeScanTextResult,{outcome:'committed'}>,'assetId'|'evidenceId'>,signal:AbortSignal):Promise<JsonForSerialization[]>=>{
    const pin=getBinding();need(pin);const root=`/api/atlas/stock/v3/workspaces/${pin.scope.workspaceId}/homes/${pin.scope.homeId}`;
    const ids=new Map<string,{kind:string;id:string}>();
    const add=(kind:string,id:string)=>{ids.set(`${kind}:${id}`,{kind,id});};
    add('identity',input.buildingId);for(const item of [primary,historical]){add('evidence',item.evidenceId);add('asset',item.assetId);}
    for(const floor of frame.floors){add('geometry',floor.geometryId);add('evidence',floor.evidenceId);add('asset',floor.originalAssetId);add('asset',floor.derivativeAssetId);}
    const result:JsonForSerialization[]=[];
    for(const {kind,id} of ids.values()){
      signal.throwIfAborted();need(getBinding()===pin&&geometry.isCurrent(frame));
      const response=await nativeScanImportWait(options.transport(`${root}/records/${kind}/${id}`,{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error',signal}),signal);
      const raw=await nativeScanImportResponseJson(response,signal);need(validator.validateNativeRead(`atlas.${kind}.get`,raw));
      const r=row(raw),scope=row(r.resolvedScope),data=row(r.data);need(r.commandId===`atlas.${kind}.get`&&r.status==='read'&&r.replayed===false
        &&scope.workspaceId===pin.scope.workspaceId&&scope.homeId===pin.scope.homeId&&data.sourceStatus==='current'&&data.nextCursor===null
        &&Array.isArray(data.records)&&data.records.length===1);
      const record=row(data.records[0]),target=row(record.target);need(target.authority==='atlas'&&target.recordType===kind&&target.recordId===id&&record.lifecycle==='active'&&isExactDecimal(record.revision));
      if(kind==='identity'){const p=row(record.payload);need(p.kind==='location'&&Array.isArray(p.evidenceIds)&&p.evidenceIds.includes(primary.evidenceId)&&p.evidenceIds.includes(historical.evidenceId));}
      for(const floor of frame.floors){const revision=kind==='geometry'&&id===floor.geometryId?floor.geometryRevision:
        kind==='evidence'&&id===floor.evidenceId?floor.evidenceRevision:kind==='asset'&&id===floor.originalAssetId?floor.originalRevision:
        kind==='asset'&&id===floor.derivativeAssetId?floor.derivativeRevision:null;
        if(revision)need(record.revision.compare(revision)===0);
        const p=row(record.payload);
        if(kind==='geometry'&&id===floor.geometryId)need(p.originalAssetId===floor.originalAssetId&&Array.isArray(p.evidenceIds)&&p.evidenceIds.includes(floor.evidenceId));
        if(kind==='asset'&&id===floor.originalAssetId)need(p.sha256===floor.originalSHA256&&p.purpose==='geometry-original');
        if(kind==='asset'&&id===floor.derivativeAssetId)need(p.sha256===floor.derivativeSHA256&&p.purpose==='derived-preview');}
      result.push({target:{authority:'atlas',recordType:kind,recordId:id},revision:{kind:'atlas',value:record.revision}});
    }
    signal.throwIfAborted();need(getBinding()===pin&&geometry.isCurrent(frame));return result;
  };
  return {
    /** Fresh GET-only comparison. It neither claims a request nor clears a held
     * attempt. Only valid absent/different current data returns null; read,
     * parsing, context and abort failures throw without establishing retry safety. */
    async inspectCurrentScene(supplied:NativeScanSceneInput,outer:AbortSignal,expected?:NativeScanSceneExpected):Promise<SceneAssociationCurrent|null>{
      need(!disposed&&!busy&&Array.isArray(supplied.sourceFloors)&&supplied.sourceFloors.length>0&&supplied.sourceFloors.length<=3
        &&Array.isArray(supplied.roomMappings)&&supplied.roomMappings.length<=256);
      const mappingText=stringifyLosslessJson(supplied.roomMappings as unknown as JsonForSerialization);need(new TextEncoder().encode(mappingText).length<=1024*1024);
      const input:NativeScanSceneInput=Object.freeze({...supplied,primary:Object.freeze({...supplied.primary,sourceLicense:Object.freeze({...supplied.primary.sourceLicense})}),
        historical:Object.freeze({...supplied.historical,sourceLicense:Object.freeze({...supplied.historical.sourceLicense})}),
        sourceFloors:Object.freeze(supplied.sourceFloors.map(f=>Object.freeze({...f}))),
        roomMappings:parseLosslessJson(mappingText) as unknown as NativeScanSceneRoomMapping[]});
      const expectedId=expected?.recordId,expectedText=expected?stringifyLosslessJson(expected.payload):null;
      if(expected)need(UUID.test(expectedId!)&&new TextEncoder().encode(expectedText!).length<=1024*1024);
      const expectedPayload=expectedText===null?null:parseLosslessJson(expectedText);
      const controller=new AbortController(),forward=()=>controller.abort(outer.reason);outer.addEventListener('abort',forward,{once:true});if(outer.aborted)forward();
      const timer=setTimeout(()=>controller.abort(new Error('Native scan scene inspection exceeded deadline')),60000),signal=controller.signal;busy=true;
      let pFrame:NativeEvidenceDocumentFrame|null=null,hFrame:NativeEvidenceDocumentFrame|null=null;
      try{
        await preflightNativeScanScene({...input,sourceFloors:input.sourceFloors.map(f=>({sourceFloorKey:f.sourceFloorKey,sourceOriginalSha256:f.sourceOriginalSha256}))},signal);
        const pText=await nativeScanImportWait(verifyNativeScanText(input.primary,signal),signal),hText=await nativeScanImportWait(verifyNativeScanText(input.historical,signal),signal);
        const stored=row(parseLosslessJson(pText));need(typeof stored.receiptCanonicalJson==='string');
        const frame=await geometry.loadBuilding(input.buildingId,signal),selectedFloors=checkFloors(input,frame);
        const current=await associations.readCurrent(input.buildingId,frame,signal);
        if(current.status!=='available'){
          if(current.reason==='no-current-association')return null;
          throw new TypeError('Native scan current scene source is unavailable; mutation remains held');
        }
        if(expectedId&&(current.recordId!==expectedId||canonical(current.payload)!==canonical(expectedPayload!)))return null;
        const p=row(current.payload),documents=p.sourceDocuments;need(Array.isArray(documents)&&documents.length===2);
        const docs=documents.map(row),primary=docs.find(d=>d.role==='primary-scene'),historical=docs.find(d=>d.role==='documentary-sheet');need(primary&&historical);
        if(primary.originalSha256!==input.primary.sha256||historical.originalSha256!==input.historical.sha256
          ||canonical(p.sourceFloors!)!==canonical(parseLosslessJson(stringifyLosslessJson(selectedFloors)))
          ||row(p.acceptedReceipt).canonicalJson!==stored.receiptCanonicalJson)return null;
        const mappings=(input.roomMappings as readonly NativeScanSceneRoomMapping[]).map(m=>({...m,targets:m.targets.map(t=>({...t,atlasPlaceId:null})),evidenceIds:[primary.evidenceId!,historical.evidenceId!]}));
        if(canonical(p.roomMappings!)!==canonical(parseLosslessJson(stringifyLosslessJson(mappings))))return null;
        const support=await readDocumentarySupport(new TextEncoder().encode(hText),()=>signal.throwIfAborted());
        if(p.reviewStatement!==input.statement+(support?.reviewMarker??''))return null;
        need(typeof primary.evidenceId==='string'&&typeof historical.evidenceId==='string'&&typeof primary.originalAssetId==='string'&&typeof historical.originalAssetId==='string');
        pFrame=await primaryReview.open(primary.evidenceId,signal);hFrame=await historicalReview.open(historical.evidenceId,signal);
        for(const [owner,opened,doc,file] of [[primaryReview,pFrame,primary,input.primary],[historicalReview,hFrame,historical,input.historical]] as const){
          need(owner.isCurrent(opened)&&opened.evidenceId===doc.evidenceId&&isExactDecimal(doc.evidenceRevision)&&doc.evidenceRevision.toSafeInteger()===opened.evidenceRevision
            &&opened.asset.assetId===doc.originalAssetId&&isExactDecimal(doc.originalAssetRevision)&&opened.asset.revision.compare(doc.originalAssetRevision)===0
            &&opened.asset.sha256===file.sha256&&opened.asset.contentType==='text/plain'&&opened.asset.byteSize.toSafeInteger()===file.byteSize
            &&owner.getBlob(opened)?.size===file.byteSize);
          if(opened.asset.sourceLicense.status!==file.sourceLicense.status||opened.asset.sourceLicense.reference!==file.sourceLicense.reference)return null;
        }
        // Fresh building membership and all guarded native records. These are
        // observed IDs, never fabricated custody/commit results.
        await guards(input,frame,{assetId:primary.originalAssetId,evidenceId:primary.evidenceId},{assetId:historical.originalAssetId,evidenceId:historical.evidenceId},signal);
        await verifyReadback(current,frame,signal,input);signal.throwIfAborted();need(geometry.isCurrent(frame)&&primaryReview.isCurrent(pFrame)&&historicalReview.isCurrent(hFrame));
        return current;
      }finally{if(pFrame)primaryReview.release(pFrame);if(hFrame)historicalReview.release(hFrame);
        clearTimeout(timer);outer.removeEventListener('abort',forward);controller.abort();busy=false;}
    },
    async importScene(supplied:NativeScanSceneInput,outer:AbortSignal):Promise<NativeScanSceneResult>{
      need(!disposed&&!busy&&!claimed);
      need(Array.isArray(supplied.sourceFloors)&&supplied.sourceFloors.length<=3&&Array.isArray(supplied.roomMappings)&&supplied.roomMappings.length<=256);
      const mappingText=stringifyLosslessJson(supplied.roomMappings as unknown as JsonForSerialization);need(new TextEncoder().encode(mappingText).length<=1024*1024);
      // Snapshot before allocating timers/marking busy, so invalid input cannot leak an operation.
      const input:NativeScanSceneInput=Object.freeze({...supplied,primary:Object.freeze({...supplied.primary,sourceLicense:Object.freeze({...supplied.primary.sourceLicense})}),
        historical:Object.freeze({...supplied.historical,sourceLicense:Object.freeze({...supplied.historical.sourceLicense})}),
        sourceFloors:Object.freeze(supplied.sourceFloors.map(f=>Object.freeze({...f}))),
        roomMappings:parseLosslessJson(mappingText) as unknown as NativeScanSceneRoomMapping[]});
      const controller=new AbortController(),forward=()=>controller.abort(outer.reason);outer.addEventListener('abort',forward,{once:true});if(outer.aborted)forward();
      const timer=setTimeout(()=>controller.abort(new Error('Native scan scene phase exceeded deadline')),240000),signal=controller.signal;busy=true;

      let prepared:SceneAssociationPrepared|null=null;
      try{
        await preflightNativeScanScene({...input,sourceFloors:input.sourceFloors.map(f=>({sourceFloorKey:f.sourceFloorKey,sourceOriginalSha256:f.sourceOriginalSha256}))},signal);
        const first=await geometry.loadBuilding(input.buildingId,signal);checkFloors(input,first);
        // After this lane claims text custody, it cannot be invoked anew after
        // any later failure. Root's durable journal enforces the same on restart.
        claimed=true;
        const primary=await texts.importText(input.primary,signal);if(primary.outcome!=='committed')return primary;
        const historical=await texts.importText(input.historical,signal);if(historical.outcome!=='committed')return historical;
        // Identity append changes descriptor/view keys. Never reuse first keys.
        const fresh=await geometry.loadBuilding(input.buildingId,signal),sourceFloors=checkFloors(input,fresh);
        prepared=await associations.prepare({buildingId:input.buildingId,primaryEvidenceId:primary.evidenceId,historicalEvidenceId:historical.evidenceId,
          sourceFloors,roomMappings:input.roomMappings.map(mapping=>({...mapping,targets:mapping.targets.map(target=>({...target,atlasPlaceId:null})),evidenceIds:[primary.evidenceId,historical.evidenceId]})),guards:await guards(input,fresh,primary,historical,signal)},fresh,input.statement,input.reason,signal);
        need(!prepared.drawingReview||input.confirmDrawingSupport===true);
        retained={prepared,input,primary,historical};
        await nativeScanImportWait(options.beforeDispatch('scene-association',{requestId:prepared.requestId,body:prepared.body}),signal);
        try{
          const current=await associations.submit(prepared,fresh,signal,input.confirmDrawingSupport);
          need(current.status==='available'&&current.recordId===prepared.targetId&&canonical(current.payload)===canonical(prepared.payload));
          retained.acknowledged=current;
          await nativeScanImportWait(options.afterResult('scene-association',{requestId:prepared.requestId,outcome:'committed'}),signal);
          await verifyReadback(current,fresh,signal,input);
          completed=true;retained=null;return Object.freeze({outcome:'committed',current,primary,historical});
        }catch{
          if(retained?.acknowledged)return Object.freeze({outcome:'partial',phase:'scene-association',requestId:prepared.requestId,current:retained.acknowledged,primary,historical});
          try{await nativeScanImportWait(options.afterResult('scene-association',{requestId:prepared.requestId,outcome:'unknown'}),signal);}catch{/* Retain journal hold. */}
          return Object.freeze({outcome:'unknown',phase:'scene-association',requestId:prepared.requestId});
        }
      }finally{if(prepared)associations.releasePrepared(prepared);clearTimeout(timer);outer.removeEventListener('abort',forward);controller.abort();busy=false;}
    },
    /** Same-instance, GET-only reconciliation of unknown or acknowledged partial.
     * A different current head never
     * proves rollback and never clears the original unknown claim. */
    async reconcileScene(outer:AbortSignal):Promise<NativeScanSceneResult>{
      need(!disposed&&!busy&&retained);const controller=new AbortController(),forward=()=>controller.abort(outer.reason);
      outer.addEventListener('abort',forward,{once:true});if(outer.aborted)forward();
      const timer=setTimeout(()=>controller.abort(new Error('Native scan scene inspection exceeded deadline')),60000),signal=controller.signal;busy=true;const item=retained;
      try{
        const frame=await geometry.loadBuilding(item.input.buildingId,signal);checkFloors(item.input,frame);
        const current=item.acknowledged?await associations.readCurrent(item.input.buildingId,frame,signal):await associations.resolve(item.prepared,frame,signal);
        if(current.status!=='available'||current.recordId!==item.prepared.targetId||canonical(current.payload)!==canonical(item.prepared.payload))
          return item.acknowledged?Object.freeze({outcome:'partial',phase:'scene-association',requestId:item.prepared.requestId,current:item.acknowledged,primary:item.primary,historical:item.historical})
            :Object.freeze({outcome:'unknown',phase:'scene-association',requestId:item.prepared.requestId});
        item.acknowledged=current;await nativeScanImportWait(options.afterResult('scene-association',{requestId:item.prepared.requestId,outcome:'committed'}),signal);
        await verifyReadback(current,frame,signal,item.input);
        completed=true;retained=null;return Object.freeze({outcome:'committed',current,primary:item.primary,historical:item.historical});
      }finally{clearTimeout(timer);outer.removeEventListener('abort',forward);controller.abort();busy=false;}
    },
    isHeld:()=>claimed&&!completed,
    isConsumed:()=>claimed,
    dispose(){if(disposed)return;disposed=true;selection=null;notify();if(retained)associations.releasePrepared(retained.prepared);
      source.dispose();associations.dispose();primaryReview.dispose();historicalReview.dispose();sourceDocuments.dispose();geometry.dispose();texts.dispose();binding=null;},
  };
}
