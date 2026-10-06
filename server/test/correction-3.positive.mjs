// Ordinary healthy composition only. Run explicitly; this file does not import
// stock suites, failure hooks, negative inputs, sockets or live transports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AccessStore, hashPassword } from '../../packages/access/src/index.mjs';
import { validateShape } from '../../packages/contracts/src/index.mjs';
import { createCoreService } from '../src/service.mjs';
import { createCoreRouter } from '../src/router.mjs';
import { canonicalPrefix } from '../src/http-contract.mjs';
import { partitionOf } from '../src/common.mjs';

const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scope={workspaceId:U(1),homeId:U(2)},other={workspaceId:U(1),homeId:U(3)};
const origin='https://atlas.synthetic.invalid',clock=()=> '2026-10-06T19:30:00Z';
const load=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const evidenceGuard={record:{recordType:'evidence',recordId:U(100)},expectedRevision:1};
const create=(target,id,payload,guards=[])=>({target,command:{schemaVersion:1,mutationId:U(id),operation:'create',expectedRevision:null,reason:'Reviewed synthetic example',guards,value:{recordType:target.recordType,payload}}});

test('canonical v1 healthy mutations, batch, source claims, pages, history and public homes compose',async t=> {
  const dir=mkdtempSync('/tmp/atlas-correction3-positive-');
  const snapshot=load('packages/contracts/fixtures/plan-free.snapshot.json');
  snapshot.networkRelations=[];snapshot.caches=snapshot.caches.filter(c=>c.sourceInstanceId!==U(12));
  const metadata=load('adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json');
  const primaryRegistration=snapshot.sources.find(s=>s.owner==='homebox'&&s.homeId===scope.homeId);
  primaryRegistration.partitionMode='reviewed-entity-allowlist';primaryRegistration.allowedExternalIds=[...new Set([...metadata.entities.map(e=>e.id),...snapshot.homeboxEntities.filter(p=>p.homeId===scope.homeId&&p.source.sourceInstanceId===primaryRegistration.sourceInstanceId&&p.source.collectionId===primaryRegistration.collectionId).map(p=>p.source.externalId)])];
  const wire=load('adapters/network/fixtures/inventory.wire.json'),review=load('adapters/network/fixtures/link-review.json');
  const calls=[],sources=snapshot.sources.map(registration=> {
    const providerOrigin=registration.owner==='network'?'https://network.synthetic.invalid':'https://homebox.synthetic.invalid';
    const nativeNavigation=registration.owner==='homebox'&&registration.homeId===scope.homeId?{...registration,origin:providerOrigin,routes:{edit:{verified:true,path:'/entities/{entityId}'},maintenance:{verified:true,path:'/entities/{entityId}/maintenance'}}}:undefined;
    return {registration,origin:providerOrigin,nativeNavigation,review:registration.owner==='network'?review:undefined,transport:async req=> {
      calls.push({owner:registration.owner,method:req.method,path:req.path});
      if(registration.owner==='network')return {status:200,origin:providerOrigin,redirected:false,source:registration,body:structuredClone(wire),sourceSnapshotAt:null};
      const entities=registration.homeId===scope.homeId?metadata.entities:[{...metadata.entities[0],name:'Second synthetic home'}];let body;
      if(req.path==='/api/v1/entities') {
        const q=new URLSearchParams(req.query),rows=entities.filter(e=>(e.entityType?.isLocation??false)===(q.get('isLocation')==='true')),page=Number(q.get('page')),pageSize=Number(q.get('pageSize'));
        body={items:rows.slice((page-1)*pageSize,page*pageSize).map(e=>Object.fromEntries(['id','name','archived','updatedAt','entityType','parent'].map(k=>[k,e[k]]))),page,pageSize,total:rows.length};
      } else if(req.path.endsWith('/maintenance'))body=metadata.maintenance;
      else body=entities.find(e=>e.id===req.path.split('/')[4]);
      return {status:200,origin:providerOrigin,redirected:false,scope:partitionOf(registration),body:JSON.stringify(body)};
    }};
  });
  const access=new AccessStore({filename:join(dir,'access.sqlite')}),password='Disposable-correction3-example!',verifier=await hashPassword(password);
  for(const [user,actor,role] of [[51,50,'editor'],[53,52,'viewer']]) {
    access.putUser({userId:U(user),actorId:U(actor),username:'synthetic-'+role,passwordVerifier:verifier});
    for(const selected of [scope,other])access.setMembership({userId:U(user),...selected,role});
  }
  for(const r of snapshot.sources)access.putSource(r);
  let service;
  try {
    service=createCoreService({databasePath:join(dir,'atlas.sqlite'),sidecarPath:join(dir,'network.sqlite'),vaultRoot:join(dir,'media'),accessStore:access,origins:[origin],homes:[{...scope,label:'Example home',operatorNote:'Synthetic server metadata'},{...other,label:'Second home',operatorNote:'Synthetic server metadata'}],sources,clock,now:()=>Date.parse(clock()),initialSnapshot:snapshot});
    const router=createCoreRouter({service,origins:[origin],now:()=>Date.parse(clock())}),prefix=canonicalPrefix(scope);
    const request=(path,session,body)=>new Request(origin+path,{method:body?'POST':'GET',headers:{origin,...(session?{cookie:session.cookie}:{}),...(body?{'content-type':'application/json','x-atlas-csrf':session?.csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=async role=> {
      const res=await router(request('/api/atlas/auth/login',null,{username:'synthetic-'+role,password}),{clientKey:'synthetic-correction3'});assert.equal(res.status,200);
      const data=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:data.csrfToken};
    };
    const editor=await login('editor'),viewer=await login('viewer');
    const principal=(session,action='read')=>service.boundary.authorize(request(prefix+'/view',session,action==='mutate'?{}:undefined),{...scope,action}).then(r=>r.principal);
    const reader=await principal(editor);
    for(const source of sources.filter(s=>s.registration.homeId===scope.homeId)) {
      const cache=await service.refreshSource(reader,partitionOf(source.registration));assert.equal(cache.status,'fresh');
    }
    const circuit={recordType:'circuit',recordId:U(900)},first=create(circuit,1000,{label:'Synthetic circuit',panel:null,evidenceIds:[U(100)]},[evidenceGuard]);
    let res=await router(request(prefix+'/records/circuit/'+circuit.recordId+'/mutations',editor,first.command));assert.equal(res.status,200);
    const created=validateShape('mutationResult',await res.json());assert.equal(created.record.revision,1);
    const replacement={...first.command,mutationId:U(1001),operation:'replace',expectedRevision:1,value:{recordType:'circuit',payload:{...first.command.value.payload,label:'Reviewed synthetic circuit'}}};
    res=await router(request(prefix+'/records/circuit/'+circuit.recordId+'/mutations',editor,replacement));assert.equal(res.status,200);
    const replaced=validateShape('mutationResult',await res.json());assert.equal(replaced.record.revision,2);
    const hbSource={...snapshot.records.find(r=>r.recordId===U(301)).payload.source,externalId:U(503)};
    const proof=structuredClone(snapshot.records.find(r=>r.recordId===U(100)).payload);
    proof.statement='Reviewed synthetic qualified source evidence';proof.provenance.source={...scope,key:hbSource};
    const attachment=metadata.entities.find(e=>e.id===U(501)).attachments[0];
    proof.references=[{kind:'homebox-attachment',entity:{...scope,key:{...hbSource,externalId:U(501)}},attachmentId:attachment.attachmentId}];
    const entries=[create({recordType:'evidence',recordId:U(920)},1020,proof),create({recordType:'identity',recordId:U(910)},1021,{kind:'item',evidenceIds:[U(920)]}),create({recordType:'binding',recordId:U(930)},1022,{atlasId:U(910),source:hbSource,reviewStatus:'accepted',sourceState:'unresolved',evidenceIds:[U(920)]})];
    res=await router(request(prefix+'/mutations',editor,{schemaVersion:1,batchId:U(1100),reason:'Reviewed synthetic qualified claims',commands:entries}));assert.equal(res.status,200);
    const batch=validateShape('batchResult',await res.json());assert.equal(batch.results.length,3);assert.deepEqual(batch.results.map(r=>r.record.recordType),['evidence','identity','binding']);
    const indirect={...replacement,mutationId:U(1002),expectedRevision:2,guards:[evidenceGuard,{record:{recordType:'evidence',recordId:U(920)},expectedRevision:1}],value:{recordType:'circuit',payload:{label:'Reviewed source-backed circuit',panel:null,evidenceIds:[U(920)]}}};
    res=await router(request(prefix+'/records/circuit/'+circuit.recordId+'/mutations',editor,indirect));assert.equal(res.status,200);const referenced=validateShape('mutationResult',await res.json());assert.equal(referenced.record.revision,3);
    res=await router(request(prefix+'/records/circuit/'+circuit.recordId,viewer));assert.equal(res.status,200);assert.deepEqual(validateShape('record',await res.json()),referenced.record);
    res=await router(request(prefix+'/records/circuit/'+circuit.recordId+'/history',viewer));assert.equal(res.status,200);
    const history=await res.json();history.forEach(a=>validateShape('audit',a));assert.deepEqual(history.map(a=>a.resultRevision),[1,2,3]);
    const totals={};
    for(const [suffix,shape] of [['records','record'],['homebox/entities','homeboxProjection'],['network/relations','networkRelation']]) {
      const rows=[];let path=prefix+'/'+suffix+'?limit=2',pages=0;
      do {
        res=await router(request(path,viewer));assert.equal(res.status,200);const page=await res.json();assert.deepEqual(Object.keys(page).sort(),['contractVersion','items','nextCursor','sourceStatuses']);assert.equal(page.contractVersion,'1.0.0');page.items.forEach(i=>validateShape(shape,i));page.sourceStatuses.forEach(c=>validateShape('cacheStatus',c));rows.push(...page.items);pages++;
        path=page.nextCursor?prefix+'/'+suffix+'?limit=2&cursor='+page.nextCursor:null;
      } while(path);
      totals[suffix]={items:rows.length,pages};assert(rows.length>0);
    }
    res=await router(request('/api/atlas/homes',viewer));assert.equal(res.status,200);const homes=await res.json();assert.equal(homes.length,2);homes.forEach(h=>assert.deepEqual(Object.keys(h).sort(),['homeId','label','workspaceId']));
    res=await router(request(prefix+'/view',editor));assert.equal(res.status,200);const view=await res.json();view.homes.forEach(h=>assert.deepEqual(Object.keys(h).sort(),['homeId','label','workspaceId']));
    const safeLinks=view.entries.flatMap(p=>p.attachments).filter(a=>a.kind==='external-link');assert(safeLinks.length>0);safeLinks.forEach(a=>assert.match(a.url,/^https:\/\//));assert.equal(view.entries.find(p=>p.entity.id===U(501)).nativeLinks.length,2);
    assert(calls.every(c=>c.method==='GET'));
    t.diagnostic(JSON.stringify({version:'0.1.1-at13.3',canonicalSingleRevisions:[created.record.revision,replaced.record.revision,referenced.record.revision],canonicalBatchRecords:batch.results.map(r=>r.record.recordType),sourceAuthority:'current enabled reviewed HomeBox entity allowlist; direct provenance, attachment and unresolved binding plus referenced evidence',newSourcePresenceCapability:'held for reviewed atomic witness successor; not exercised',historyRevisions:history.map(a=>a.resultRevision),readPages:totals,publicHomeFields:['workspaceId','homeId','label'],safeExternalLinks:safeLinks.length,nativeLinks:2,transportCalls:calls.length,transportMethods:['GET'],input:'fresh synthetic state',stoppedChecksExecuted:false}));
  } finally {service?.close();access.close();rmSync(dir,{recursive:true,force:true});}
});
