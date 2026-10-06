import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AccessStore, hashPassword } from '../../packages/access/src/index.mjs';
import { AssetVault } from '../../packages/media/src/index.mjs';
import { pngChunk } from '../../packages/media/src/content.mjs';
const { createCoreService } = await import(process.env.ATLAS_CORE_MODULE ?? '../src/service.mjs');
import { createCoreRouter } from '../src/router.mjs';
import { partitionOf } from '../src/common.mjs';
export const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const scope={workspaceId:U(1),homeId:U(2)},other={workspaceId:U(1),homeId:U(3)},origin='https://atlas.synthetic.invalid';
export const load=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
export const circuitTarget={recordType:'circuit',recordId:U(900)};
export const command=id=>({...load('packages/contracts/fixtures/create-circuit.mutation.json'),mutationId:U(id??1000)});
const password='Disposable-AT13-synthetic-only!',verifier=await hashPassword(password);
export const png=()=> {
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('tEXt',Buffer.from('private-note\0synthetic metadata')),pngChunk('IDAT',deflateSync(Buffer.from([0,10,20,30,40,50,60,0,70,80,90,100,110,120]))),pngChunk('IEND',Buffer.alloc(0))]);
};
export async function setup(options={}) {
  const dir=mkdtempSync('/tmp/atlas-core-'),snapshot=options.snapshot??load('packages/contracts/fixtures/plan-free.snapshot.json');
  // Frozen relation-only fixtures are not complete AT09 sidecars. The synthetic
  // service starts that source unfetched, then publishes the actual adapter.
  snapshot.caches=snapshot.caches.filter(c=>c.sourceInstanceId!==U(12));snapshot.networkRelations=[];
  const access=new AccessStore({filename:join(dir,'access.sqlite')}),paths={databasePath:join(dir,'atlas.sqlite'),sidecarPath:join(dir,'network.sqlite'),vaultRoot:join(dir,'media')};
  const photo=png(),manual=Buffer.from('Synthetic manual\n');
  if(options.ownedAsset) {
    const vault=new AssetVault({root:paths.vaultRoot}),payload=await vault.prepareOriginal({scope,purpose:'evidence-original',contentType:'image/png',body:photo});
    snapshot.records.push({schemaVersion:1,recordType:'asset',recordId:U(600),...scope,revision:1,lifecycle:'active',createdAt:'2026-01-02T12:00:00Z',updatedAt:'2026-01-02T12:00:00Z',lastAuditId:U(10600),payload:{...payload,sourceLicense:{status:'unknown',reference:null},evidenceIds:[U(100)]}});
  }
  for(const [id,role] of [[51,'editor'],[53,'viewer']]) {
    access.putUser({userId:U(id),actorId:U(id-1),username:'synthetic-'+role,passwordVerifier:verifier});
    for(const s of [scope,other])access.setMembership({userId:U(id),...s,role});
  }
  for(const r of snapshot.sources)access.putSource(r);
  const metadata=load('adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json'),wire=load('adapters/network/fixtures/inventory.wire.json'),review=load('adapters/network/fixtures/link-review.json');
  metadata.entities[1].attachments=[{attachmentId:U(801),kind:'stored-file',title:'Synthetic manual',contentType:'text/plain',byteSize:manual.length,proxyRef:null},{attachmentId:U(803),kind:'stored-file',title:'Synthetic photograph',contentType:'image/png',byteSize:photo.length,proxyRef:null},{attachmentId:U(802),kind:'external-link',title:'Source manual link',url:'https://manual.example.invalid/reference',archived:false}];
  wire.observations=[{id:'observation-a',collectorId:'synthetic-collector',deviceId:'device-a',interfaceId:'interface-a',kind:'association',timestamp:'2025-12-01T00:00:00Z',vantagePoint:'synthetic-router',invalidatedAt:'2025-12-02T00:00:00Z',value:{status:'unreachable'}}];
  const calls=[],state={hb:'ok',network:'ok',media:'ok'},hooks={};let time=Date.parse('2026-10-06T19:30:00Z');
  const sources=snapshot.sources.map(registration=> {
    const providerOrigin=registration.owner==='network'?'https://network.synthetic.invalid':'https://hb.synthetic.invalid';
    const transport=async(request,opts={})=> {
      calls.push({owner:registration.owner,method:request.method,path:request.path,redirect:request.redirect??opts.redirect});
      if(hooks[registration.owner])await hooks[registration.owner](request,opts);
      const mode=registration.owner==='network'?state.network:state.hb;
      if(mode==='transport')throw new Error('synthetic transport key must not leak');
      if(mode==='auth')return {status:401,origin:providerOrigin};
      if(registration.owner==='network')return {status:200,origin:providerOrigin,redirected:false,source:mode==='wrong-scope'?{...registration,homeId:U(999)}:registration,body:structuredClone(wire),sourceSnapshotAt:null};
      let entities=registration.homeId===scope.homeId?metadata.entities:[{...metadata.entities[0],name:'Second synthetic home'}];
      const id=request.path.split('/')[4];let body;
      if(request.path==='/api/v1/entities') {
        const q=new URLSearchParams(request.query),rows=entities.filter(e=>(e.entityType?.isLocation??false)===(q.get('isLocation')==='true')),page=Number(q.get('page')),pageSize=Number(q.get('pageSize'));
        body={items:rows.map(e=>Object.fromEntries(['id','name','archived','updatedAt','entityType','parent'].map(k=>[k,e[k]]))),page,pageSize,total:rows.length};
      } else if(request.path.endsWith('/maintenance'))body=metadata.maintenance;
      else body=entities.find(e=>e.id===id);
      return {status:body?200:404,origin:providerOrigin,redirected:false,scope:mode==='wrong-scope'?{...partitionOf(registration),collectionId:'other'}:partitionOf(registration),body:JSON.stringify(body??null)};
    };
    return {registration,origin:providerOrigin,review:registration.owner==='network'?review:undefined,transport,readAttachment:registration.owner==='homebox'?async input=> {
      if(hooks.media)await hooks.media(input);
      const body=input.descriptor.attachmentId===U(803)?photo:manual;
      if(state.media==='auth')return {status:403};
      return {status:200,origin:providerOrigin,redirected:false,descriptor:structuredClone(input.descriptor),sourceUpdatedAt:input.sourceUpdatedAt,contentType:input.descriptor.attachmentId===U(803)?'image/png':'text/plain',contentLength:body.length,body:state.media==='malformed'?Buffer.alloc(body.length,255):body};
    }:undefined};
  });
  const service=createCoreService({...paths,accessStore:access,origins:[origin],homes:[{...scope,label:'Example home'},{...other,label:'Second home'}],sources,clock:()=>new Date(time).toISOString(),now:()=>time,initialSnapshot:snapshot,storageFault:options.storageFault,fault:options.fault}),router=createCoreRouter({service,origins:[origin]});
  const request=(path,session,{method='GET',body,raw,headers={},signal}={})=>new Request(origin+path,{method,headers:{origin,...(session?{cookie:session.cookie}:{}),...(method==='POST'?{'content-type':'application/json','x-atlas-csrf':session?.csrf??''}:{}),...headers},...(method==='POST'?{body:raw??JSON.stringify(body??{})}:{}),signal});
  const login=async(role='editor')=> {
    const res=await router(request('/api/atlas/auth/login',null,{method:'POST',body:{username:'synthetic-'+role,password}}),{clientKey:'synthetic-test'});
    if(res.status!==200)throw new Error('Synthetic login failed '+res.status);
    const data=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:data.csrfToken};
  };
  const session=await login(),prefix='/api/atlas/'+scope.workspaceId+'/'+scope.homeId;
  const principal=async(s=session,selected=scope,action='read')=> (await service.boundary.authorize(request(prefix+'/view',s,{method:action==='mutate'?'POST':'GET'}),{...selected,action})).principal;
  const refresh=async(owner='homebox',selected=scope,s=session)=> {
    const r=sources.find(s=>s.registration.owner===owner&&s.registration.homeId===selected.homeId).registration;
    return service.refreshSource(await principal(s,selected),partitionOf(r));
  };
  return {dir,paths,access,service,router,request,login,session,prefix,principal,refresh,state,hooks,calls,sources,metadata,wire,snapshot,photo,manual,setTime:value=>{time=value;},getTime:()=>time,close:()=>{service.close();access.close();rmSync(dir,{recursive:true,force:true});}};
}
