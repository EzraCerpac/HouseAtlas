/** Current native documentary details for one selected unified publication.
 * Producer overlay hints are not authority; no rendered old geometry is used. */
import { nativeSceneAssociationPayloadDigest, readNativeOverlayAssociationHead, readNativeOverlayAssociation, readNativeOverlayBuildingEvidence, type SceneAssociationContext, type SceneAssociationCurrent } from './native-scene-association-client';
import type { NativeSceneSourceFrame, NativeSceneSourceSelection } from '../src/lantern/scans/native-scene-source-types';
import { readNativeOverlayDetails } from './native-scene-source-client';
import { readDocumentarySupport, documentaryReferences } from './native-scene-documentary-support';
import { isExactDecimal, type ExactDecimal } from '../src/numeric/decimal';
import { stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import type { NativeEvidenceDocumentFrame, NativeEvidenceDocumentClient } from '../src/lantern/scans/native-evidence-document-types';
export interface UnifiedAtlasOverlaySceneSelection {
  readonly workspaceId:string; readonly homeId:string; readonly revision:string;
  readonly publicationId:string; readonly semanticsSha256:string;
}
export interface UnifiedAtlasOverlayPublicationRoom {
  readonly roomId:string; readonly buildingId:string; readonly nativePlaceId:string|null;
  readonly occurrenceIds:readonly string[];
}
/** Independently reviewed host input, never derived from producer nativeBinding
 * or publicationRooms. Missing review keeps runtime joins unavailable. This is
 * documentary linkage, not an authorization capability. */
export interface UnifiedAtlasOverlayReviewedRoomLinks {
  readonly profile:'houseatlas.unified-atlas-room-links.v1';
  readonly workspaceId:string; readonly homeId:string; readonly publicationId:string;
  readonly semanticsSha256:string;
  readonly links:readonly Readonly<{roomId:string;nativePlaceId:string;packagePlaceKey:string;packagePlaceUuid:string}>[];
}
/** Runtime qualification is independent of producer nativeBinding status. Use only
 * while source.isCurrent(frame) and the exact publication selection remains owned.
 * Source device/fixture IDs remain documentary IDs, never native record UUIDs. */
export interface UnifiedAtlasOverlayRoomBinding {
  readonly roomId:string; readonly nativePlaceId:string; readonly spaceOccurrenceId:null;
  readonly sourceRoomIds:readonly string[];
  readonly targets:readonly Readonly<{packagePlaceKey:string;packagePlaceUuid:string;sourceAnchorIds:readonly string[]}>[];
  readonly qualification:'current-native-room-join'; readonly anchor:Readonly<{kind:'room-summary'}>;
}
export interface UnifiedAtlasOverlayAvailableFrame {
  readonly status:'available'; readonly lease:object;
  readonly sceneSelection:UnifiedAtlasOverlaySceneSelection; readonly nativeBuildingId:string;
  readonly currentSource:Pick<SceneAssociationCurrent,'recordId'|'revision'|'payload'>;
  readonly sourceSelection:NativeSceneSourceSelection;
  readonly roomBindings:readonly UnifiedAtlasOverlayRoomBinding[];
  readonly network:NativeSceneSourceFrame['network'];
  readonly electricity:NativeSceneSourceFrame['electricity'];
  readonly electricalFixtures:NativeSceneSourceFrame['electricalFixtures'];
  readonly drawingReferences?:NativeSceneSourceFrame['drawingReferences'];
  readonly drawingProvenance?:NativeSceneSourceFrame['drawingProvenance'];
}
export type UnifiedAtlasOverlayFrame = UnifiedAtlasOverlayAvailableFrame | Readonly<{
  status:'unavailable';reason:'current-head-unread'|'no-native-building-link'|'no-current-association'|
    'current-source-unavailable'|'room-link-not-qualified'|'selection-changed';
}>;
export interface UnifiedAtlasOverlayOpen {
  readonly sceneSelection:UnifiedAtlasOverlaySceneSelection; readonly nativeBuildingId:string;
  readonly publicationRooms:readonly UnifiedAtlasOverlayPublicationRoom[];
}
/** Stable canonical observation supplied by the actual host, never retained JSON. */
export interface UnifiedAtlasOverlayContext {
  readonly native:SceneAssociationContext;
  readonly sceneSelection:UnifiedAtlasOverlaySceneSelection;
  readonly nativeBuildingId:string|null;
  readonly publicationRooms:readonly UnifiedAtlasOverlayPublicationRoom[];
  readonly reviewedRoomLinks?:UnifiedAtlasOverlayReviewedRoomLinks|null;
}
export interface UnifiedAtlasOverlaySourceOptions {
  getContext():UnifiedAtlasOverlayContext|null;
  subscribeContext(changed:()=>void):()=>void;
  /** New dedicated owner per original; one owner must not withdraw another. */
  createDocuments():NativeEvidenceDocumentClient;
  readonly fetch?:typeof fetch;
}
export interface UnifiedAtlasOverlaySource {
  open(input:UnifiedAtlasOverlayOpen,signal:AbortSignal):Promise<UnifiedAtlasOverlayFrame>;
  isCurrent(frame:UnifiedAtlasOverlayAvailableFrame):boolean;
  subscribeInvalidation(frame:UnifiedAtlasOverlayAvailableFrame,changed:()=>void):()=>void;
  release(frame:UnifiedAtlasOverlayAvailableFrame):void;
  dispose():void;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
// Bounded passive read-point freshness: no instantaneous external-write claim.
const HEAD_INTERVAL_MS=10_000, HEAD_READ_MS=8_000, HEAD_MAX_AGE_MS=20_000;
function need(value:unknown):asserts value{if(!value)throw new Error('Current native overlay source is unavailable');}
function row(value:LosslessJson|undefined):Record<string,LosslessJson>{need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&!isExactDecimal(value));return value;}
function text(value:LosslessJson|undefined):string{need(typeof value==='string');return value;}
function integer(value:LosslessJson|undefined):ExactDecimal{need(isExactDecimal(value)&&value.isInteger);return value;}
async function hash(bytes:Uint8Array):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
  const stop=()=>{signal.removeEventListener('abort',stop);reject(signal.reason??new Error('Overlay read stopped'));};
  signal.addEventListener('abort',stop,{once:true});work.then(v=>{signal.removeEventListener('abort',stop);resolve(v);},e=>{signal.removeEventListener('abort',stop);reject(e);});if(signal.aborted)stop();
});}
function stamp(context:UnifiedAtlasOverlayContext):string{return JSON.stringify([context.native.session.actorId,context.native.session.csrfToken,context.native.session.expiresAt,
  context.native.view.scope.workspaceId,context.native.view.scope.homeId,context.sceneSelection,context.nativeBuildingId,context.reviewedRoomLinks,
  context.publicationRooms.map(r=>[r.roomId,r.buildingId,r.nativePlaceId,[...r.occurrenceIds]])]);}
function roomBindings(selection:NativeSceneSourceSelection,rooms:readonly UnifiedAtlasOverlayPublicationRoom[],review:UnifiedAtlasOverlayReviewedRoomLinks):readonly UnifiedAtlasOverlayRoomBinding[]{
  need(rooms.length<=2048&&new Set(rooms.map(r=>r.roomId)).size===rooms.length);
  need(review.links.length<=2048);
  const reviewed=new Map<string,UnifiedAtlasOverlayReviewedRoomLinks['links'][number]>();
  for(const link of review.links){need(typeof link.roomId==='string'&&link.roomId.length>0&&link.roomId.length<=512
    &&UUID.test(link.nativePlaceId)&&UUID.test(link.packagePlaceUuid)&&typeof link.packagePlaceKey==='string'
    &&link.packagePlaceKey.length>0&&link.packagePlaceKey.length<=512&&!reviewed.has(link.roomId));
    reviewed.set(link.roomId,link);}
  const result:UnifiedAtlasOverlayRoomBinding[]=[];
  for(const room of rooms){const link=reviewed.get(room.roomId);
    if(!link||room.nativePlaceId===null||room.nativePlaceId!==link.nativePlaceId)continue;need(UUID.test(room.nativePlaceId));
    const matching=(selection.acceptedRoomMappings??[]).flatMap(mapping=>mapping.targets.filter(target=>target.atlasPlaceId===link.nativePlaceId&&target.packagePlaceKey===link.packagePlaceKey&&target.packagePlaceUuid===link.packagePlaceUuid).map(target=>({mapping,target})));
    if(!matching.length)continue;
    const targets=new Map<string,{packagePlaceKey:string;packagePlaceUuid:string;sourceAnchorIds:Set<string>}>();
    for(const {mapping,target}of matching){const key=`${target.packagePlaceKey}\0${target.packagePlaceUuid}`;let value=targets.get(key);
      if(!value){value={packagePlaceKey:target.packagePlaceKey,packagePlaceUuid:target.packagePlaceUuid,sourceAnchorIds:new Set()};targets.set(key,value);}
      for(const id of mapping.sourceAnchorIds){const anchor=selection.acceptedRoomAnchors.find(a=>a.id===id);need(anchor&&anchor.targets.some(t=>t.packagePlaceKey===target.packagePlaceKey&&t.packagePlaceUuid===target.packagePlaceUuid));value.sourceAnchorIds.add(id);}}
    result.push(Object.freeze({roomId:room.roomId,nativePlaceId:room.nativePlaceId,spaceOccurrenceId:null,sourceRoomIds:Object.freeze([...new Set(matching.map(m=>m.mapping.sourceRoomId))]),
      targets:Object.freeze([...targets.values()].map(t=>Object.freeze({packagePlaceKey:t.packagePlaceKey,packagePlaceUuid:t.packagePlaceUuid,sourceAnchorIds:Object.freeze([...t.sourceAnchorIds])}))),
      qualification:'current-native-room-join',anchor:Object.freeze({kind:'room-summary'})}));
  }return Object.freeze(result);
}
/** One owner per selected native building. No upstream collection, import or registration occurs. */
export function createUnifiedAtlasOverlaySource(options:UnifiedAtlasOverlaySourceOptions):UnifiedAtlasOverlaySource{
  type Owned={owner:NativeEvidenceDocumentClient;frame:NativeEvidenceDocumentFrame|null;stop:(()=>void)|null;disposed:boolean;released:WeakSet<object>};
  type Attempt={generation:number;context:UnifiedAtlasOverlayContext;stamp:string;controller:AbortController;owners:Owned[];listeners:Set<()=>void>;
    frame:UnifiedAtlasOverlayAvailableFrame|null;headCheckedAt:number;drawingProof:{evidenceId:string;checkedAt:number}|null;
    headTimer:ReturnType<typeof setTimeout>|null;stopAbort:(()=>void)|null;timer:ReturnType<typeof setTimeout>|null;retired:boolean};
  let active:Attempt|null=null,generation=0,disposed=false;
  const transport=options.fetch??((...args:Parameters<typeof fetch>)=>fetch(...args));
  const observe=()=>{try{return options.getContext();}catch{return null;}};
  const releaseOwned=(owned:Owned,frame:NativeEvidenceDocumentFrame)=>{if(owned.released.has(frame))return;owned.released.add(frame);owned.owner.release(frame);};
  const retire=(attempt:Attempt)=>{
    if(attempt.retired)return;attempt.retired=true;if(active===attempt)active=null;
    const callbacks=[...attempt.listeners];attempt.listeners.clear();attempt.controller.abort();attempt.stopAbort?.();if(attempt.timer)clearTimeout(attempt.timer);if(attempt.headTimer)clearTimeout(attempt.headTimer);
    for(const owned of attempt.owners){owned.stop?.();owned.stop=null;if(owned.frame)releaseOwned(owned,owned.frame);if(!owned.disposed){owned.disposed=true;owned.owner.dispose();}}
    for(const changed of callbacks){try{changed();}catch{/* notify every subscriber */}}
  };
  const withdraw=()=>{generation++;const previous=active;if(previous)retire(previous);};
  const current=(attempt:Attempt):boolean=>{try{const next=observe();return !disposed&&!attempt.retired&&active===attempt&&generation===attempt.generation
    &&next!==null&&next.native.sessionIdentity===attempt.context.native.sessionIdentity&&next.sceneSelection===attempt.context.sceneSelection
    &&next.publicationRooms===attempt.context.publicationRooms&&next.reviewedRoomLinks===attempt.context.reviewedRoomLinks
    &&(!attempt.frame||(Date.now()-attempt.headCheckedAt<=HEAD_MAX_AGE_MS
      &&(!attempt.drawingProof||Date.now()-attempt.drawingProof.checkedAt<=HEAD_MAX_AGE_MS)))
    &&stamp(next)===attempt.stamp&&Date.parse(next.native.session.expiresAt)>Date.now()
    &&attempt.owners.every(o=>!o.disposed&&(!o.frame||o.owner.isCurrent(o.frame)))&&!attempt.controller.signal.aborted;}catch{return false;}};
  const guard=(attempt:Attempt)=>{attempt.controller.signal.throwIfAborted();need(current(attempt));};
  const offHost=options.subscribeContext(withdraw);
  const open:UnifiedAtlasOverlaySource['open']=async(input,signal)=>{
    const reserved=++generation;const previous=active;if(previous)retire(previous);
    if(disposed||signal.aborted||generation!==reserved){signal.throwIfAborted();return Object.freeze({status:'unavailable',reason:'selection-changed'});}
    const context=observe();if(!context)return Object.freeze({status:'unavailable',reason:'current-head-unread'});
    if(context.nativeBuildingId===null)return Object.freeze({status:'unavailable',reason:'no-native-building-link'});
    if(input.sceneSelection!==context.sceneSelection||input.publicationRooms!==context.publicationRooms||input.nativeBuildingId!==context.nativeBuildingId)return Object.freeze({status:'unavailable',reason:'selection-changed'});
    const s=context.sceneSelection,review=context.reviewedRoomLinks;
    if(!review||review.profile!=='houseatlas.unified-atlas-room-links.v1'||review.workspaceId!==s.workspaceId||review.homeId!==s.homeId
      ||review.publicationId!==s.publicationId||review.semanticsSha256!==s.semanticsSha256)return Object.freeze({status:'unavailable',reason:'room-link-not-qualified'});
    need(UUID.test(s.workspaceId)&&UUID.test(s.homeId)&&UUID.test(s.publicationId)&&SHA.test(s.semanticsSha256)&&s.revision.length>0&&s.revision.length<=128
      &&context.native.view.scope.workspaceId===s.workspaceId&&context.native.view.scope.homeId===s.homeId&&UUID.test(input.nativeBuildingId));
    const attempt:Attempt={generation:reserved,context,stamp:stamp(context),controller:new AbortController(),owners:[],listeners:new Set(),frame:null,headCheckedAt:0,drawingProof:null,headTimer:null,stopAbort:null,timer:null,retired:false};active=attempt;
    const stop=()=>{if(active===attempt)withdraw();};signal.addEventListener('abort',stop,{once:true});attempt.stopAbort=()=>signal.removeEventListener('abort',stop);if(signal.aborted)stop();
    attempt.timer=setTimeout(stop,75_000);
    const pin=()=>guard(attempt);
    const sourceViewKey=`unified-overlay:${s.revision}:${input.nativeBuildingId}`;
    const readBuildingEvidence=async(evidenceId:string,readSignal:AbortSignal)=>{
      pin();const present=await abortable(readNativeOverlayBuildingEvidence(context.native,input.nativeBuildingId,evidenceId,readSignal,pin,transport),readSignal);
      pin();return present;
    };
    const retain=async(doc:Record<string,LosslessJson>):Promise<{bytes:Uint8Array;frame:NativeEvidenceDocumentFrame}>=>{
      pin();const owner=options.createDocuments();need(!attempt.owners.some(o=>o.owner===owner));
      const owned:Owned={owner,frame:null,stop:null,disposed:false,released:new WeakSet()};attempt.owners.push(owned);
      const work=owner.open(text(doc.evidenceId),attempt.controller.signal);
      void work.then(late=>{if(attempt.retired||active!==attempt||attempt.controller.signal.aborted)releaseOwned(owned,late);},()=>undefined);
      const frame=await abortable(work,attempt.controller.signal);owned.frame=frame;pin();
      const off=owner.subscribeInvalidation(frame,stop);if(!current(attempt)){off();pin();}owned.stop=off;
      need(frame.mode==='original-download'&&frame.evidenceId===doc.evidenceId&&frame.evidenceRevision===integer(doc.evidenceRevision).toSafeInteger()
        &&frame.asset.assetId===doc.originalAssetId&&frame.asset.revision.compare(integer(doc.originalAssetRevision))===0&&frame.asset.sha256===doc.originalSha256&&frame.asset.contentType==='text/plain');
      const blob=owner.getBlob(frame);need(blob?.type==='text/plain'&&blob.size>0&&blob.size<=8*1024*1024&&frame.asset.byteSize.toSafeInteger()===blob.size);
      const bytes=new Uint8Array(await abortable(blob.arrayBuffer(),attempt.controller.signal));pin();need(await hash(bytes)===doc.originalSha256);pin();return{bytes,frame};
    };
    try{
      pin();const association=await readNativeOverlayAssociation(context.native,input.nativeBuildingId,sourceViewKey,attempt.controller.signal,pin,transport);pin();
      if(association.status!=='available'){retire(attempt);return association;}
      const payload=row(association.payload);need(Array.isArray(payload.sourceDocuments));
      const documents=payload.sourceDocuments.map(row);const primaryPin=documents.find(d=>d.role==='primary-scene')!,historicalPin=documents.find(d=>d.role==='documentary-sheet')!;
      const primary=await retain(primaryPin),historical=await retain(historicalPin);pin();const baseSelection=association.selection;let selection=baseSelection;
      const support=await readDocumentarySupport(historical.bytes,pin);pin();
      if(support&&text(payload.reviewStatement).endsWith(support.reviewMarker)&&support.originalSha256===historicalPin.originalSha256
        &&support.pdf.workspaceId===s.workspaceId&&support.pdf.homeId===s.homeId&&support.pdf.buildingId===input.nativeBuildingId){
        // During open, an unavailable optional correlation leaves the base
        // documentary sources intact. An advertised proof is monitored below.
        let buildingEvidence=false;
        const read=new AbortController(),forward=()=>read.abort();
        attempt.controller.signal.addEventListener('abort',forward,{once:true});
        const deadline=setTimeout(()=>read.abort(),HEAD_READ_MS);
        try{buildingEvidence=await readBuildingEvidence(support.pdf.evidenceId,read.signal);
          if(buildingEvidence)attempt.drawingProof={evidenceId:support.pdf.evidenceId,checkedAt:Date.now()};}
        catch{pin();}
        finally{clearTimeout(deadline);attempt.controller.signal.removeEventListener('abort',forward);read.abort();}
        pin();if(buildingEvidence)selection=Object.freeze({...selection,drawingReferences:documentaryReferences(support,selection),drawingSupport:Object.freeze({evidenceId:historical.frame.evidenceId,evidenceRevision:historical.frame.evidenceRevision,
          assetId:historical.frame.asset.assetId,assetRevision:historical.frame.asset.revision,originalSha256:support.originalSha256,reviewMarker:support.reviewMarker})});
      }
      let details=await readNativeOverlayDetails(selection,primary.bytes,historical.bytes,pin);pin();
      const bindings=roomBindings(selection,input.publicationRooms,review);if(!bindings.length){retire(attempt);return Object.freeze({status:'unavailable',reason:'room-link-not-qualified'});}
      const final=await readNativeOverlayAssociation(context.native,input.nativeBuildingId,sourceViewKey,attempt.controller.signal,pin,transport);pin();
      need(final.status==='available'&&final.recordId===association.recordId&&final.revision.compare(association.revision)===0&&stringifyLosslessJson(final.payload)===stringifyLosslessJson(association.payload));
      const headCheckedAt=Date.now();
      if(attempt.drawingProof&&Date.now()-attempt.drawingProof.checkedAt>HEAD_MAX_AGE_MS){
        attempt.drawingProof=null;selection=baseSelection;
        details=await readNativeOverlayDetails(selection,primary.bytes,historical.bytes,pin);pin();
      }
      const frame:UnifiedAtlasOverlayAvailableFrame=Object.freeze({status:'available',lease:Object.freeze({}),sceneSelection:Object.freeze({...s}),nativeBuildingId:input.nativeBuildingId,
        currentSource:Object.freeze({recordId:association.recordId,revision:association.revision,payload:association.payload}),sourceSelection:selection,roomBindings:bindings,...details});
      const expectedPayloadSha256=await abortable(nativeSceneAssociationPayloadDigest(association.payload),attempt.controller.signal);pin();
      // Only one passive read at a time, no retry after an error or changed head.
      // A successful reread refreshes this read-point proof, not an access grant.
      const checkHead=async()=>{
        const read=new AbortController(),forward=()=>read.abort();
        attempt.controller.signal.addEventListener('abort',forward,{once:true});
        const deadline=setTimeout(()=>read.abort(),HEAD_READ_MS);
        try{
          pin();const observed=await readNativeOverlayAssociationHead(context.native,input.nativeBuildingId,read.signal,pin,transport);
          pin();need(observed.status==='available'&&observed.recordId===association.recordId&&observed.revision.compare(association.revision)===0
            &&observed.payloadSha256===expectedPayloadSha256);
          const checkedAt=Date.now();
          if(attempt.drawingProof){const proof=attempt.drawingProof;
            need(await readBuildingEvidence(proof.evidenceId,read.signal));pin();proof.checkedAt=Date.now();}
          attempt.headCheckedAt=checkedAt;pin();attempt.headTimer=setTimeout(()=>{void checkHead();},HEAD_INTERVAL_MS);
        }catch{retire(attempt);}
        finally{clearTimeout(deadline);attempt.controller.signal.removeEventListener('abort',forward);read.abort();}
      };
      pin();attempt.headCheckedAt=headCheckedAt;attempt.frame=frame;
      if(attempt.timer)clearTimeout(attempt.timer);
      attempt.timer=setTimeout(stop,Math.min(Date.parse(context.native.session.expiresAt)-Date.now()+1,2_147_483_647));
      attempt.headTimer=setTimeout(()=>{void checkHead();},HEAD_INTERVAL_MS);pin();return frame;
    }catch{const changed=!current(attempt);retire(attempt);signal.throwIfAborted();return Object.freeze({status:'unavailable',reason:changed?'selection-changed':'current-source-unavailable'});}
  };
  const isCurrent=(frame:UnifiedAtlasOverlayAvailableFrame)=>{const attempt=active;return attempt!==null&&attempt.frame===frame&&current(attempt);};
  return Object.freeze({open,isCurrent,subscribeInvalidation(frame:UnifiedAtlasOverlayAvailableFrame,changed:()=>void){if(!isCurrent(frame)){changed();return()=>undefined;}const listeners=active!.listeners;listeners.add(changed);return()=>{listeners.delete(changed);};},
    release(frame:UnifiedAtlasOverlayAvailableFrame){if(active?.frame===frame)withdraw();},dispose(){if(disposed)return;disposed=true;withdraw();offHost();}});
}
