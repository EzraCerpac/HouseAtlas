// One ordinary valid-config assembly. Run explicitly; no stock/negative suites,
// guard controls, code mutation, sockets, upstream HTTP or live inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AccessStore, hashPassword } from '../../packages/access/src/index.mjs';
import { createHomeBoxAdapter } from '../../adapters/homebox/src/index.mjs';
import { renderAtlas } from '../../web/src/render.mjs';
import { createCoreService } from '../src/service.mjs';
import { createCoreRouter } from '../src/router.mjs';
import { partitionOf } from '../src/common.mjs';
const load=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scope={workspaceId:U(1),homeId:U(2)},other={workspaceId:U(1),homeId:U(3)};
const origin='https://atlas.synthetic.invalid',clock=()=> '2026-10-06T19:30:00Z';

test('AT13-R1 valid trusted navigation persists through refresh/reopen and reaches editor view; optional absence stays empty',async t=> {
  const snapshot=load('packages/contracts/fixtures/plan-free.snapshot.json');
  snapshot.networkRelations=[];snapshot.caches=snapshot.caches.filter(c=>c.sourceInstanceId!==U(12));
  const metadata=load('adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json');
  const wire=load('adapters/network/fixtures/inventory.wire.json'),review=load('adapters/network/fixtures/link-review.json');
  const calls=[],sources=snapshot.sources.map(registration=> {
    const providerOrigin=registration.owner==='network'?'https://network.synthetic.invalid':'https://homebox.synthetic.invalid';
    const nativeNavigation=registration.owner==='homebox'&&registration.homeId===scope.homeId?{...registration,origin:providerOrigin,routes:{edit:{verified:true,path:'/entities/{entityId}'},maintenance:{verified:true,path:'/entities/{entityId}/maintenance'}}}:undefined;
    const transport=async req=> {
      calls.push({method:req.method,path:req.path});
      if(registration.owner==='network')return {status:200,origin:providerOrigin,redirected:false,source:registration,body:structuredClone(wire),sourceSnapshotAt:null};
      const entities=registration.homeId===scope.homeId?metadata.entities:[{...metadata.entities[0],name:'Second synthetic home'}];let body;
      if(req.path==='/api/v1/entities') {
        const q=new URLSearchParams(req.query),rows=entities.filter(e=>(e.entityType?.isLocation??false)===(q.get('isLocation')==='true')),page=Number(q.get('page')),pageSize=Number(q.get('pageSize'));
        body={items:rows.slice((page-1)*pageSize,page*pageSize).map(e=>Object.fromEntries(['id','name','archived','updatedAt','entityType','parent'].map(k=>[k,e[k]]))),page,pageSize,total:rows.length};
      } else if(req.path.endsWith('/maintenance'))body=metadata.maintenance;
      else body=entities.find(e=>e.id===req.path.split('/')[4]);
      return {status:200,origin:providerOrigin,redirected:false,scope:partitionOf(registration),body:JSON.stringify(body)};
    };
    return {registration,origin:providerOrigin,nativeNavigation,review:registration.owner==='network'?review:undefined,transport};
  });
  const dir=mkdtempSync('/tmp/atlas-native-positive-'),access=new AccessStore({filename:join(dir,'access.sqlite')});let service;
  try {
    access.putUser({userId:U(51),actorId:U(50),username:'native-positive-editor',passwordVerifier:await hashPassword('Disposable native-navigation example')});
    for(const selected of [scope,other])access.setMembership({userId:U(51),...selected,role:'editor'});
    for(const source of snapshot.sources)access.putSource(source);
    const config={databasePath:join(dir,'atlas.sqlite'),sidecarPath:join(dir,'network.sqlite'),vaultRoot:join(dir,'media'),accessStore:access,origins:[origin],homes:[{...scope,label:'Example home'},{...other,label:'Second home'}],sources,clock,now:()=>Date.parse(clock())};
    service=createCoreService({...config,initialSnapshot:snapshot});let router=createCoreRouter({service,origins:[origin]});
    const req=(path,cookie,body)=>new Request(origin+path,{method:body?'POST':'GET',headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=await router(req('/api/atlas/auth/login',null,{username:'native-positive-editor',password:'Disposable native-navigation example'}),{clientKey:'native-positive-example'});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],prefix=selected=>'/api/atlas/'+selected.workspaceId+'/'+selected.homeId;
    const principal=async selected=>(await service.boundary.authorize(req(prefix(selected)+'/view',cookie),{...selected,action:'read'})).principal;
    const homebox=sources.filter(s=>s.registration.owner==='homebox'),configured=homebox.find(s=>s.registration.homeId===scope.homeId);
    const direct=await createHomeBoxAdapter({...configured,clock}).fetchGeneration();assert.equal(direct.ok,true);
    const expected=direct.homeboxEntities.find(p=>p.entity.id===U(501)).nativeLinks;assert.deepEqual(expected.map(l=>l.intent),['edit','maintenance']);
    for(const source of homebox)await service.refreshSource(await principal(source.registration),partitionOf(source.registration));
    const saved=service.snapshot(await principal(scope)).homeboxEntities.find(p=>p.entity.id===U(501));assert.deepEqual(saved.nativeLinks,expected);
    const read=async selected=> {const response=await router(req(prefix(selected)+'/view',cookie));assert.equal(response.status,200);return response.json();};
    const view=await read(scope),item=view.entries.find(p=>p.entity.id===U(501));assert.equal(view.canEdit,true);assert.deepEqual(item.nativeLinks,expected);
    const html=renderAtlas(view,{page:'item',key:item.key,archived:false});for(const link of expected)assert(html.includes('href="'+link.href+'"'));
    const optional=await read(other);assert.equal(optional.entries.length,1);assert.deepEqual(optional.entries[0].nativeLinks,[]);
    service.close();service=createCoreService(config);router=createCoreRouter({service,origins:[origin]});
    const reopened=await read(scope);assert.deepEqual(reopened.entries.find(p=>p.entity.id===U(501)).nativeLinks,expected);
    assert.deepEqual(service.snapshot(await principal(scope)).homeboxEntities.find(p=>p.entity.id===U(501)).nativeLinks,expected);
    const absentReopened=await read(other);assert.deepEqual(absentReopened.entries[0].nativeLinks,[]);
    assert(calls.every(c=>c.method==='GET'));
    t.diagnostic(JSON.stringify({finding:'AT13-R1',configuredLinks:expected,persistedLinks:saved.nativeLinks,editorViewLinks:item.nativeLinks,reopenedEditorViewLinks:reopened.entries.find(p=>p.entity.id===U(501)).nativeLinks,renderedNativeActions:expected.map(l=>l.intent),optionalAbsentLinks:absentReopened.entries[0].nativeLinks,transportRequests:calls.length,transportMethods:['GET']}));
  } finally {service?.close();access.close();rmSync(dir,{recursive:true,force:true});}
});
