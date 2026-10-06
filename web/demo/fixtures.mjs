import { readFileSync } from 'node:fs';
import { entityKey } from '../src/model.mjs';

const base = JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/plan-free.snapshot.json',import.meta.url)));
export const demoScope = {workspaceId:base.sources[0].workspaceId,homeId:base.sources[0].homeId};
export const demoNow = '2026-01-02T12:05:00Z';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function demoSnapshot(scenario = 'normal') {
  const snapshot=structuredClone(base), cabinet=snapshot.homeboxEntities[0], radio=snapshot.homeboxEntities[1];
  cabinet.entity.name='Display cabinet'; cabinet.entity.description='Small things and their paperwork.';
  radio.entity.name='Portable radio'; radio.entity.description='A portable radio for use around the house.'; radio.entity.modelNumber='Audio 12';
  radio.attachments[0].title='Audio 12 manual';
  radio.attachments.push({attachmentId:id(802),kind:'stored-file',title:'Front of portable radio',contentType:'image/png',byteSize:68,proxyRef:'opaque-never-a-browser-url'});
  radio.maintenance.push({entryId:id(811),name:'Clean outer case',description:'Use a dry cloth.',scheduledDate:null,completedDate:'2026-01-01T12:00:00Z',cost:0});
  snapshot.homeboxEntities[2].entity.name='Archived drawer';
  snapshot.homeboxEntities[3].entity.name='Record with type missing';
  const add = (number,name,type,parent=null) => {
    const p=structuredClone(cabinet); p.source.externalId=p.entity.id=id(number); p.entity.name=name; p.entity.description=''; p.entity.parent=parent?{id:parent}:null;
    p.entity.entityType={id:id(type==='Room'?705:706),name:type,isLocation:type==='Room'};
    p.attachments=[];p.maintenance=[];p.nativeLinks=[]; snapshot.homeboxEntities.push(p);return p;
  };
  const room=add(510,'Sitting room','Room'); cabinet.entity.parent={id:room.entity.id};
  add(511,'Table lamp','Lighting',room.entity.id); add(512,'Camera','Equipment',cabinet.entity.id); add(513,'Spare adapter','Equipment');
  if(scenario==='unresolved') snapshot.records.find(r=>r.recordType==='binding' && r.payload.source.externalId===radio.entity.id).payload.sourceState='unresolved';
  if(scenario==='outage' || scenario==='no-cache') {
    const c=snapshot.caches[0]; c.status='error';c.lastAttemptAt='2026-01-02T12:05:00Z';c.error={code:'timeout',at:c.lastAttemptAt,message:'Synthetic unavailable source'};
    if(scenario==='no-cache') { c.generationId=null;c.lastSuccessfulFetchAt=null;snapshot.homeboxEntities=[]; }
  }
  if(scenario==='stale') snapshot.caches[0].status='stale';
  if(scenario==='homebox-quarantine') snapshot.caches[0].status='access-revoked';
  if(scenario==='network-quarantine') {
    const registration=snapshot.sources.find(s=>s.owner==='network');
    snapshot.caches.push({...snapshot.caches[0],sourceInstanceId:registration.sourceInstanceId,collectionId:registration.collectionId,status:'access-revoked',error:{code:'auth',at:demoNow,message:'Synthetic source denial'}});
  }
  if(scenario==='focus-removed-after') snapshot.homeboxEntities=snapshot.homeboxEntities.filter(p=>p.entity.id!==radio.entity.id);
  if(scenario==='focus-archived-after') radio.entity.archived=true;
  if(scenario==='empty') snapshot.homeboxEntities=[];
  return snapshot;
}
export function demoOptions(snapshot, scenario='normal') {
  const p=snapshot.homeboxEntities.find(p=>p.entity.id===id(501));
  const entity=p && {...demoScope,key:p.source};
  return {
    authorization:{...demoScope,allowed:!['denied','expired','revoked'].includes(scenario),reason:['expired','revoked'].includes(scenario)?scenario:undefined,allowedHomeIds:[demoScope.homeId],canEditHomebox:scenario==='editor'},
    homeLabel:'Example home',homes:[{...demoScope,label:'Example home'}],now:demoNow,
    hints:entity?[{entity,reviewed:true,mobility:'mobile',aliases:['travel radio']}]:[],
    // Synthetic route capabilities prove link rendering only; no real source route.
    navigation:scenario==='editor' && entity?['edit','maintenance'].map(intent=>({kind:'homebox-native',intent,entity,verifiedRoute:true,href:`http://127.0.0.1:4310/synthetic-homebox/${intent}/${p.entity.id}`})):[],
    media:entity && scenario!=='media-unavailable'?[{entity,attachmentId:id(802),authorized:true,downloadHref:'/api/atlas/media/example-photo',previewHref:'/api/atlas/media/example-photo',previewValidated:true},{entity,attachmentId:id(800),authorized:true,downloadHref:'/api/atlas/media/example-manual'}]:[]
  };
}
export const namedEntry = (view, name) => view.entries.find(p=>p.entity.name===name);
export const keyByName = (snapshot,name) => entityKey(snapshot.homeboxEntities.find(p=>p.entity.name===name));
