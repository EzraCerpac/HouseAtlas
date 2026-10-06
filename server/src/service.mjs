import { AtlasStore } from '../../packages/storage/src/index.mjs';
import { createAccessBoundary, AccessError } from '../../packages/access/src/index.mjs';
import { AssetVault, createMediaService } from '../../packages/media/src/index.mjs';
import { createHomeBoxAdapter } from '../../adapters/homebox/src/index.mjs';
import { createNetworkReadAdapter, buildNetworkFacet, assertNetworkReadRequest, NetworkReadError } from '../../adapters/network/src/index.mjs';
import { prepareAtlasView } from '../../web/src/prepare.mjs';
import { validateShape, canonicalJson } from '../../packages/contracts/src/index.mjs';
import { NetworkSidecar } from './network-sidecar.mjs';
import { scopeOf, partitionOf, keyOf, same, fail, reference, sha256 } from './common.mjs';
import { captureCoreRecovery } from './recovery.mjs';
import { publicHome, publicAtlasView } from './public-dto.mjs';
import { authorizeMutationContext } from './mutation-authority.mjs';
import { checkMutationPreconditions } from './mutation-preconditions.mjs';
import { requireMutationPreconditions, requireBatchPreconditions } from './http-contract.mjs';
import { holdNewSourcePresence } from './source-presence.mjs';

const MAX_NETWORK_BYTES=1024*1024;
const approvedOrigin=value => {
  const u=new URL(value);
  if (u.protocol!=='https:' || u.origin!==value || u.username || u.password) throw new TypeError('Exact HTTPS origin required');
  return value;
};
function checkAbort(signal) { if(signal?.aborted) throw new NetworkReadError('timeout','Source request interrupted'); }
async function networkBytes(body,signal) {
  if (body && Object.getPrototypeOf(body)===Object.prototype) body=JSON.stringify(body);
  const input=typeof body==='string'?[Buffer.from(body)]:body instanceof Uint8Array?[body]:body;
  if (!input?.[Symbol.iterator] && !input?.[Symbol.asyncIterator]) throw new NetworkReadError('invalid-schema','Network response rejected');
  let size=0;const chunks=[];
  for await(const chunk of input) {
    checkAbort(signal);if(!(chunk instanceof Uint8Array)) throw new NetworkReadError('invalid-schema','Network response rejected');
    size+=chunk.byteLength;if(size>MAX_NETWORK_BYTES) throw new NetworkReadError('size-limit','Network response exceeded limit');
    chunks.push(Buffer.from(chunk));
  }
  checkAbort(signal);
  try {return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));}
  catch {throw new NetworkReadError('invalid-schema','Network response rejected');}
}

/** Embeddable offline core. No listener, upstream HTTP client, provider writer, credential
 * provisioning, administrative enable route, agent service or approval seam. */
export function createCoreService({databasePath,sidecarPath,vaultRoot,accessStore,origins,homes,sources=[],clock=()=>new Date().toISOString(),now=Date.now,storageFault=()=>{},fault=()=>{},initialSnapshot}) {
  if (!accessStore || !Array.isArray(homes) || !Array.isArray(sources)) throw new TypeError('Trusted core configuration required');
  origins.forEach(approvedOrigin);
  const configured=sources.map(s=> {
    validateShape('sourceRegistration',s.registration);approvedOrigin(s.origin);
    if (!['homebox','network'].includes(s.registration.owner) || typeof s.transport!=='function') throw new TypeError('Passive source transport required');
    return {...s,registration:structuredClone(s.registration),review:structuredClone(s.review)};
  });
  if(new Set(configured.map(s=>keyOf(s.registration))).size!==configured.length) throw new TypeError('Duplicate source configuration');
  homes=homes.map(h=> {validateShape('scope',scopeOf(h));if(typeof h.label!=='string'||!h.label.length||h.label.length>200)throw new TypeError('Home label required');return {...h};}); // Private configuration; only publicHome crosses the output boundary.
  if(new Set(homes.map(h=>canonicalJson(scopeOf(h)))).size!==homes.length) throw new TypeError('Duplicate home configuration');
  const authority=new WeakMap(), mutations=new WeakMap(), vault=new AssetVault({root:vaultRoot}), sidecar=new NetworkSidecar({path:sidecarPath});
  let media,active=0,draining=false,closed=false;
  const boundary=createAccessBoundary({store:accessStore,origins,now,resolveMedia:(p,d)=>media.resolveMetadata(p,d)});
  const assertScope=(p,s)=> {if(closed||draining)throw new AccessError(503,'upstream-unavailable');boundary.revalidate(p);if(p.workspaceId!==s.workspaceId||p.homeId!==s.homeId)fail('not-found');};
  function internal(principal,registration,purpose='publication') {
    assertScope(principal,registration);
    const row=accessStore.source(registration.workspaceId,registration.homeId,registration.sourceInstanceId,registration.collectionId);
    if(!row || !same(JSON.parse(row.registration),registration)) fail('not-found');
    const grant=boundary.authorizeSourcePartition(principal,partitionOf(registration)), token=Object.freeze({});
    authority.set(token,{principal,registration,grant,purpose});return token;
  }
  const authorize=(p,r)=> {
    const h=authority.get(p);
    if(h) {
      if(r.capability!=='publish-cache' || !same(scopeOf(h.registration),r.scope) || !r.source || keyOf(r.source)!==keyOf(h.registration)) fail('forbidden');
      assertScope(h.principal,r.scope);
      if(h.purpose!=='failure') boundary.revalidateSourcePartition(h.grant);
      return {...r.scope,actorId:h.principal.actorId};
    }
    assertScope(p,r.scope);
    if(['publish-cache','configure-source'].includes(r.capability)) fail('forbidden');
    if(r.capability==='mutate') {
      boundary.assertMutation(p);
      const state=mutations.get(p);if(!state)fail('upstream-unavailable');
      const context=authorizeMutationContext(boundary,p,r.mutation,state);
      if(context.phase==='validate')checkMutationPreconditions(context);
      holdNewSourcePresence(context);
    }
    if(r.capability==='read-cache') {
      if(r.sourcePartition && !r.source) boundary.authorizeSourcePartition(p,r.sourcePartition);
      else if(r.source && !r.sourcePartition) boundary.authorizeSource(p,r.source);
      else fail('forbidden');
    }
    return {...r.scope,actorId:p.actorId};
  };
  const store=new AtlasStore({path:databasePath,authorize,clock,verifyAvailableAsset:vault.verifyAvailableAsset,fault:storageFault,allowSyntheticBootstrap:initialSnapshot!==undefined});
  if(initialSnapshot!==undefined) store.initializeSynthetic(initialSnapshot);
  const sourceFor=partition=> {
    const s=configured.find(s=>keyOf(s.registration)===keyOf(partition));
    if(!s) fail('not-found');return s;
  };
  function failure(principal,registration,code) {
    const token=internal(principal,registration,'failure'), scope=scopeOf(registration);
    // Disable commits first. An interrupted subsequent cache write is still
    // hidden by current access policy; recovery cannot silently clear denial.
    if(['auth','wrong-scope'].includes(code)) accessStore.setSourceEnabled(scope.workspaceId,scope.homeId,registration.sourceInstanceId,registration.collectionId,false);
    return accessStore.transaction(()=>store.recordCacheFailure(token,scope,partitionOf(registration),{code}));
  }
  function sourceEpoch(principal,partition) {
    const s=sourceFor(partition),token=internal(principal,s.registration);
    return store.readCacheForPublication(token,scopeOf(partition),partition).cacheEpoch;
  }
  media=createMediaService({boundary,store,vault,providers:configured.filter(s=>s.registration.owner==='homebox'&&s.readAttachment).map(s=>({registration:s.registration,origin:s.origin,readAttachment:s.readAttachment})),sourceEpoch,quarantineSource:(p,partition,code)=>failure(p,sourceFor(partition).registration,code)});
  async function run(fn) {
    if(closed||draining) throw new AccessError(503,'upstream-unavailable');
    active++;try{return await fn();}finally{active--;}
  }
  const fenced=(principal,fn)=>boundary.withMutationAuthorization(principal,()=>fn());
  const mutate=(principal,entries,fn)=>fenced(principal,()=> {
    if(mutations.has(principal))fail('invalid-transition');
    mutations.set(principal,{entries:structuredClone(entries),contextId:null,grants:new Map()});
    try{return fn();}finally{mutations.delete(principal);}
  });
  function validateNetworkAuthority(principal,registration,generation) {
    boundary.authorizeSourcePartition(principal,partitionOf(registration));
    for(const [field,kind] of [['groups','network-group'],['devices','network-device'],['interfaces','network-interface'],['segments','network-segment'],['links','network-segment']])
      for(const row of generation.inventory[field]) boundary.authorizeSource(principal,reference(registration,kind,row.externalId));
    // Frozen sourceRef has no observation/link kind. These internal policy-only
    // selectors use the Network ownership family; retained sourceKind is intact.
    for(const row of generation.observations) boundary.authorizeSource(principal,reference(registration,'network-segment',row.externalId));
  }
  function networkState(principal,registration,snapshot) {
    const cache=snapshot.caches.find(c=>keyOf(c)===keyOf(registration));
    if(!cache) return null;
    if(cache.status==='access-revoked') return {cache,generation:null};
    const state=sidecar.read(registration,cache,snapshot.networkRelations.filter(r=>keyOf(r)===keyOf(registration)),sourceFor(registration).review);
    if(state.generation) validateNetworkAuthority(principal,registration,state.generation);
    return state;
  }
  function snapshot(principal) {
    const result=store.readSnapshot(principal,scopeOf(principal));
    for(const registration of result.sources.filter(s=>s.owner==='network')) {
      try {networkState(principal,registration,result);}
      catch(error) {
        boundary.revalidate(principal);
        result.networkRelations=result.networkRelations.filter(r=>keyOf(r)!==keyOf(registration));
        result.caches=result.caches.map(c=>keyOf(c)!==keyOf(registration)?c:{...c,status:['forbidden','not-found'].includes(error.code)?'access-revoked':'error'});
      }
    }
    return result;
  }
  async function refreshSource(principal,partition,{signal}={}) {
    return run(async()=> {
      const s=sourceFor(partition),r=s.registration,token=internal(principal,r),scope=scopeOf(r);
      if(signal?.aborted) throw new AccessError(503,'upstream-unavailable');
      const prior=store.readCacheForPublication(token,scope,partitionOf(r));
      let cache,entities=[],relations=[],state;
      if(r.owner==='homebox') {
        const transport=async req=> {
          const response=await s.transport(req);
          if(response?.status!==401&&response?.status!==403&&response?.origin!==s.origin) return {...response,scope:{}};
          return response;
        };
        const adapter=createHomeBoxAdapter({registration:r,transport,clock,limits:s.limits,nativeNavigation:s.nativeNavigation});
        const result=await adapter.fetchGeneration({previous:prior.cache?{cache:prior.cache,homeboxEntities:prior.homeboxEntities}:null,signal});
        if(!result.ok || result.completeness!=='complete-generation' || !result.replaceCache) return failure(principal,r,result.cache.error.code);
        cache=result.cache;entities=result.homeboxEntities;
      } else {
        let initialState=null;
        if(prior.cache) {
          try {initialState=sidecar.read(r,prior.cache,prior.networkRelations,s.review);}
          catch(error) {if(error.code!=='invalid-contract')throw error;}
        }
        const adapter=createNetworkReadAdapter({registration:r,review:s.review,clock,limits:s.limits,initialState,transport:async(req,options)=> {
          assertNetworkReadRequest(req);const combined=signal?AbortSignal.any([options.signal,signal]):options.signal;
          checkAbort(combined);
          const response=await s.transport(req,{signal:combined,redirect:'error',maxBytes:MAX_NETWORK_BYTES});
          checkAbort(combined);
          if(response?.status===401||response?.status===403) return response;
          if(response?.origin!==s.origin) throw new NetworkReadError('wrong-scope','Source scope rejected');
          if(response?.redirected || response?.url || response?.location || response?.status!==200) return response;
          return {...response,body:await networkBytes(response.body,combined)};
        }});
        state=await adapter.refresh();
        if(state.cache.status!=='fresh' || !state.generation) return failure(principal,r,state.cache.error?.code??'transport');
        validateNetworkAuthority(principal,r,state.generation);
        sidecar.stage(r,state);fault('after-network-stage');
        cache=state.cache;relations=state.generation.networkRelations;
      }
      if(signal?.aborted) throw new AccessError(503,'upstream-unavailable');
      // The captured epoch is never reread/rebased. Access writers are fenced
      // only during this synchronous Atlas publication, never during transport.
      return accessStore.transaction(()=> {
        boundary.revalidateSourcePartition(authority.get(token).grant);
        return store.replaceCacheGeneration(token,scope,{cache,homeboxEntities:entities,networkRelations:relations,complete:true,expectedGenerationId:prior.cache?.generationId??null,expectedCacheEpoch:prior.cacheEpoch});
      });
    });
  }
  async function choices(request) {
    const allowed=[];
    for(const h of homes) {
      try {await boundary.authorize(request,{...scopeOf(h),action:'read'});allowed.push(publicHome(h));}
      catch(e) {if(e.code!=='not-found')throw e;}
    }
    return allowed;
  }
  const mediaPath=(scope,descriptor,mode)=>'/api/atlas/media/'+scope.workspaceId+'/'+scope.homeId+'/'+sha256(canonicalJson(descriptor))+'/'+mode;
  async function view(principal,allowedHomes) {
    const scoped=snapshot(principal),home=homes.find(h=>same(scopeOf(h),scopeOf(principal)));if(!home)fail('not-found');
    const capabilities=[];
    for(const p of scoped.homeboxEntities) for(const a of p.attachments.filter(a=>a.kind==='stored-file')) {
      const descriptor={kind:'homebox-attachment',entity:{...scopeOf(p),key:p.source},attachmentId:a.attachmentId};
      try {
        await boundary.authorizeMedia(principal,descriptor,{mode:'download'});
        const cap={entity:descriptor.entity,attachmentId:a.attachmentId,authorized:true,downloadHref:mediaPath(principal,descriptor,'download')};
        if(a.contentType==='image/png') {await boundary.authorizeMedia(principal,descriptor);cap.previewHref=mediaPath(principal,descriptor,'preview');cap.previewValidated=true;}
        capabilities.push(cap);
      } catch(e) {boundary.revalidate(principal);}
    }
    boundary.revalidate(principal);
    // Awaited media lookups can race a partition denial or publication. Assemble
    // current storage again before releasing any protected browser projection.
    return publicAtlasView(prepareAtlasView(snapshot(principal),{authorization:{allowed:true,...scopeOf(principal),allowedHomeIds:allowedHomes.map(h=>h.homeId),canEditHomebox:principal.role==='editor'},homeLabel:home.label,homes:allowedHomes.map(publicHome),now:clock(),media:capabilities}));
  }
  function descriptorFor(principal,digest) {
    const s=snapshot(principal),descriptors=s.records.filter(r=>r.recordType==='asset').map(r=>({kind:'atlas-asset',assetId:r.recordId}));
    for(const p of s.homeboxEntities) for(const a of p.attachments.filter(a=>a.kind==='stored-file')) descriptors.push({kind:'homebox-attachment',entity:{...scopeOf(p),key:p.source},attachmentId:a.attachmentId});
    const d=descriptors.find(d=>sha256(canonicalJson(d))===digest);if(!d)fail('not-found');return d;
  }
  return Object.freeze({boundary,run,choices,view,snapshot,refreshSource,
    execute:(p,target,command)=>mutate(p,[{target,command}],()=>store.execute(p,scopeOf(p),target,requireMutationPreconditions(command))),
    executeBatch:(p,batch)=>mutate(p,batch?.commands??[],()=>store.executeBatch(p,scopeOf(p),requireBatchPreconditions(batch))),
    readRecord:(p,target)=>store.readRecord(p,scopeOf(p),target),history:(p,target)=>store.history(p,scopeOf(p),target),
    network:p=> {const s=snapshot(p);return s.sources.filter(r=>r.owner==='network').map(r=> {try {const state=networkState(p,r,s);if(state?.cache.status==='access-revoked')return {readOnly:true,status:'revoked',message:'Network access is unavailable'};return state?buildNetworkFacet({registration:r,state,now:clock()}):{readOnly:true,status:'unavailable'};}catch(e){boundary.revalidate(p);return {readOnly:true,status:'unavailable'};}});},
    deliverMedia:(request,scope,digest,mode)=>run(async()=> {const {principal}=await boundary.authorize(request,{...scope,action:'media'});return media.deliver(request,{scope,descriptor:descriptorFor(principal,digest),mode});}),
    captureRecovery:async(destination)=> {
      if(active||draining||closed) throw new AccessError(409,'forbidden');
      draining=true;try {return await captureCoreRecovery({databasePath,vault,sidecar,destination});}finally{draining=false;}
    },
    close:()=> {if(active||draining)throw new TypeError('Drain core operations before close');closed=true;store.close();sidecar.close();},
  });
}
