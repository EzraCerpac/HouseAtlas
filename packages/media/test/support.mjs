import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { AccessStore, createAccessBoundary, hashPassword } from '../../access/src/index.mjs';
import { AtlasStore } from '../../storage/src/index.mjs';
import { ContractError, canonicalJson } from '../../contracts/src/index.mjs';
const moduleURL = process.env.ATLAS_MEDIA_MODULE ? pathToFileURL(process.env.ATLAS_MEDIA_MODULE) : new URL('../src/index.mjs',import.meta.url);
export const media = await import(moduleURL);
export const content = await import(new URL('content.mjs',moduleURL));
export const U = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const scope = {workspaceId:U(1),homeId:U(2)}, origin = 'https://atlas.synthetic.invalid', providerOrigin = 'https://hb.synthetic.invalid';
export const password = 'Synthetic-media-password-only!', verifier = await hashPassword(password);
export const assetDescriptor = {kind:'atlas-asset',assetId:U(600)};
export const homeboxDescriptor = {kind:'homebox-attachment',entity:{...scope,key:{sourceInstanceId:U(10),collectionId:'synthetic-collection-a',sourceKind:'homebox-entity',externalId:U(500)}},attachmentId:U(7001)};
// Independently built 2x2 RGB fixture; ancillary text must never reach preview.
export function png({width=2,height=2,color=2,filter=0,metadata=true} = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width,0); header.writeUInt32BE(height,4); header[8]=8;header[9]=color;
  const raw = Buffer.alloc(height*(width*(color===6?4:3)+1));
  for (let y=0;y<height;y++) {raw[y*(width*(color===6?4:3)+1)]=filter;for(let x=1;x<width*(color===6?4:3)+1;x++)raw[y*(width*(color===6?4:3)+1)+x]=(x+y)*7;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),content.pngChunk('IHDR',header),...(metadata?[content.pngChunk('tEXt',Buffer.from('private-note\0synthetic secret marker'))]:[]),content.pngChunk('IDAT',deflateSync(raw)),content.pngChunk('IEND',Buffer.alloc(0))]);
}
export const pngBytes = png();
export const request = (session,path='/media',options={}) => new Request(origin+path,{method:options.method??'GET',headers:{origin,cookie:session.cookie,...options.headers},signal:options.signal});
export const recordFor = payload => ({schemaVersion:1,recordType:'asset',recordId:U(600),...scope,revision:1,lifecycle:'active',createdAt:'2026-01-02T12:00:00Z',updatedAt:'2026-01-02T12:00:00Z',lastAuditId:U(10600),payload:{...payload,sourceLicense:{status:'unknown',reference:null},evidenceIds:[U(100)]}});
export const mutation = (operation,id,expectedRevision=1) => ({schemaVersion:1,mutationId:U(id),operation,expectedRevision,reason:'Synthetic media lifecycle',guards:[{record:{recordType:'evidence',recordId:U(100)},expectedRevision:1}]});

export async function setup({readAttachment,timeoutMs=10000,fault,assetType='image/png',assetBody=pngBytes,attachmentType='image/png',attachmentBody=pngBytes,otherHomeAsset=false,archivedHomebox=false,onResolve}={}) {
  const dir = mkdtempSync('/tmp/atlas-media-'), vault = new media.AssetVault({root:join(dir,'media'),fault});
  const payload = await vault.prepareOriginal({scope,purpose:'evidence-original',contentType:assetType,body:assetBody});
  const snapshot = JSON.parse(readFileSync(new URL('../../contracts/fixtures/plan-free.snapshot.json',import.meta.url)));
  snapshot.records.push(recordFor(payload));
  if(otherHomeAsset){const other=await vault.prepareOriginal({scope:{...scope,homeId:U(3)},purpose:'evidence-original',contentType:'image/png',body:pngBytes});snapshot.records.push({...recordFor(other),homeId:U(3),recordId:U(603),lastAuditId:U(10603),payload:{...recordFor(other).payload,evidenceIds:[]}});}
  snapshot.homeboxEntities[0].entity.archived=archivedHomebox;
  snapshot.homeboxEntities[0].attachments = [{attachmentId:U(7001),kind:'stored-file',title:'Synthetic photo',contentType:attachmentType,byteSize:attachmentBody.length,proxyRef:null}];
  const access = new AccessStore({filename:join(dir,'access.sqlite')}), admin = Symbol('trusted-publication-only'); let service, clock = 1800000000000;
  access.putUser({userId:U(51),actorId:U(50),username:'synthetic-editor',passwordVerifier:verifier});
  access.putUser({userId:U(53),actorId:U(52),username:'synthetic-viewer',passwordVerifier:verifier});
  for (const [userId,role] of [[U(51),'editor'],[U(53),'viewer']]) access.setMembership({userId,...scope,role});
  for (const r of snapshot.sources) access.putSource(r);
  let resolutions=0;
  const boundary = createAccessBoundary({store:access,origins:[origin],now:()=>clock,resolveMedia:(p,d)=>{const value=service.resolveMetadata(p,d);resolutions++;return onResolve?onResolve(value,{count:resolutions,access,store:()=>store}):value;}});
  const authorize = (p,r) => {
    if (p === admin) {
      if (!['publish-cache','configure-source'].includes(r.capability)) throw new ContractError('forbidden','Internal scope');
      return {...r.scope,actorId:U(50)};
    }
    boundary.revalidate(p);
    if (p.workspaceId !== r.scope.workspaceId || p.homeId !== r.scope.homeId) throw new ContractError('not-found','Unavailable');
    if (r.capability === 'mutate') boundary.assertMutation(p);
    if (r.capability === 'read-cache') {
      if (r.sourcePartition) boundary.authorizeSourcePartition(p,r.sourcePartition);
      else if (r.source) boundary.authorizeSource(p,r.source);
      else throw new ContractError('forbidden','Source selectors required');
    }
    if (['publish-cache','configure-source'].includes(r.capability)) throw new ContractError('forbidden','Internal scope');
    return {...r.scope,actorId:p.actorId};
  };
  const databasePath=join(dir,'atlas.sqlite'), store = new AtlasStore({path:databasePath,authorize,clock:()=> '2026-02-01T12:00:00Z',verifyAvailableAsset:vault.verifyAvailableAsset,allowSyntheticBootstrap:true});
  store.initializeSynthetic(snapshot);
  const response = input => ({status:200,redirected:false,origin:providerOrigin,descriptor:structuredClone(input.descriptor),sourceUpdatedAt:input.sourceUpdatedAt,contentType:attachmentType,contentLength:attachmentBody.length,body:attachmentBody});
  const epoch = (p,partition) => {boundary.authorizeSourcePartition(p,partition);return store.readCacheForPublication(admin,scope,partition).cacheEpoch;};
  service = media.createMediaService({boundary,store,vault,timeoutMs,providers:[{registration:snapshot.sources[0],origin:providerOrigin,readAttachment:readAttachment?input=>readAttachment(input,{response,access,store,boundary,admin}):async input=>response(input)}],sourceEpoch:epoch,quarantineSource:(p,partition,code)=>{access.setSourceEnabled(partition.workspaceId,partition.homeId,partition.sourceInstanceId,partition.collectionId,false);store.recordCacheFailure(admin,scope,partition,{code});}});
  const login = async (username='synthetic-editor') => {
    const result = await boundary.login(new Request(origin+'/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password})}),{clientKey:'synthetic-loopback'});
    const data = await result.json(); return {cookie:result.headers.get('set-cookie').split(';')[0],csrf:data.csrfToken};
  };
  const session = await login();
  const principal = (action='media',selectedSession=session) => boundary.authorize(new Request(origin+'/command',{method:action==='mutate'?'POST':'GET',headers:{origin,cookie:selectedSession.cookie,...(action==='mutate'?{'x-atlas-csrf':selectedSession.csrf,'content-type':'application/json'}:{})},...(action==='mutate'?{body:'{}'}:{})}),{...scope,action}).then(r=>r.principal);
  const deliver = (descriptor=assetDescriptor,options={}) => service.deliver(request(session,options.path??'/media',options),{scope,descriptor,mode:options.mode??'preview'});
  return {dir,vault,databasePath,store,access,boundary,service,snapshot,admin,session,login,principal,deliver,response,setClock:v=>{clock=v;},close:()=>{store.close();access.close();rmSync(dir,{recursive:true,force:true});}};
}
