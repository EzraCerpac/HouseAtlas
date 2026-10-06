import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson, validateShape } from '../../contracts/src/index.mjs';
import { AccessStore, assertUuid, usernameKey } from './store.mjs';
import { DUMMY_VERIFIER, verifyPassword } from './credentials.mjs';
export { AccessStore } from './store.mjs';
export { hashPassword } from './credentials.mjs';

export const SESSION_COOKIE = '__Host-houseatlas-session';
const hash = value => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const safeMethods = new Set(['GET','HEAD']);
const actions = new Set(['read','history','media','mutate']);
const headers = Object.freeze({ 'cache-control':'private, no-store', 'pragma':'no-cache', 'x-content-type-options':'nosniff', 'referrer-policy':'same-origin', 'vary':'Cookie, Origin, Sec-Fetch-Site' });
const messages = { unauthenticated:'Authentication required', forbidden:'Request denied', 'not-found':'Resource unavailable', 'invalid-contract':'Invalid request', 'upstream-unavailable':'Service unavailable' };
export class AccessError extends Error {
  constructor(status, code) { super(messages[code]); this.name='AccessError'; this.status=status; this.code=code; }
}
const deny = (status, code) => { throw new AccessError(status,code); };
const invalid = () => deny(422,'invalid-contract');
export function errorResponse(error) {
  const known = error instanceof AccessError;
  const code = known ? error.code : 'upstream-unavailable';
  return Response.json({schemaVersion:1,code,message:messages[code],requestId:randomUUID(),currentRevision:null}, {status:known?error.status:503,headers});
}
const success = (body, cookie) => Response.json(body,{headers:{...headers,...(cookie?{'set-cookie':cookie}:{})}});
const cookie = (token, seconds) => `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
function exact(value, fields) { if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).sort().join(',')!==[...fields].sort().join(',')) invalid(); }
function boundedInt(value,min,max) { if (!Number.isSafeInteger(value) || value<min || value>max) throw new TypeError('Invalid access limit'); return value; }
function uniqueJsonKeys(text) {
  let pos=0;
  const space=()=>{while(/\s/.test(text[pos]??'') && pos<text.length) pos++;};
  const string=()=>{
    const start=pos++;
    while(pos<text.length) {if(text[pos]==='\\') pos+=2;else if(text[pos++]==='"') break;}
    return JSON.parse(text.slice(start,pos));
  };
  function value(depth) {
    if(depth>64) invalid(); space();
    if(text[pos]==='"') {string();return;}
    if(text[pos]==='{') {
      pos++;space();const keys=new Set();if(text[pos]==='}') {pos++;return;}
      for(;;) {space();const key=string();if(keys.has(key)) invalid();keys.add(key);space();pos++;value(depth+1);space();if(text[pos++]==='}') return;}
    }
    if(text[pos]==='[') {
      pos++;space();if(text[pos]===']') {pos++;return;}
      for(;;) {value(depth+1);space();if(text[pos++]===']') return;}
    }
    while(pos<text.length && !/[,}\]\s]/.test(text[pos])) pos++;
  }
  value(0);
}

/** Reads the actual body stream. Content-Length alone never establishes a byte limit. */
export async function readBoundedJson(request, maxBytes) {
  const length=request.headers.get('content-length');
  if (length!==null && (!/^\d+$/.test(length) || Number(length)>maxBytes)) deny(413,'invalid-contract');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')) deny(415,'invalid-contract');
  const reader=request.body?.getReader(); if (!reader) invalid();
  let size=0; const chunks=[];
  try {
    for (;;) { const {done,value}=await reader.read(); if (done) break; size+=value.byteLength; if(size>maxBytes) { await reader.cancel(); deny(413,'invalid-contract'); } chunks.push(Buffer.from(value)); }
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
    const parsed=JSON.parse(text); uniqueJsonKeys(text); return parsed;
  } catch(error) { if(error instanceof AccessError) throw error; invalid(); }
  finally { reader.releaseLock(); }
}

/** No listener, network client, account bootstrap or provider-token support is installed here. */
export function createAccessBoundary({store,origins,resolveMedia,now=Date.now,limits={}}) {
  if (!(store instanceof AccessStore) || !Array.isArray(origins) || !origins.length || typeof now!=='function' || (resolveMedia!==undefined && typeof resolveMedia!=='function')) throw new TypeError('Server access configuration required');
  const allowed=new Set(origins.map(value=>{
    const url=new URL(value);
    if (url.protocol!=='https:' || url.origin!==value || url.username || url.password) throw new TypeError('Exact HTTPS origins required');
    return value;
  }));
  const absoluteMs=boundedInt(limits.absoluteMs??604800000,1,604800000);
  const idleMs=boundedInt(limits.idleMs??28800000,1,absoluteMs);
  const maxBodyBytes=boundedInt(limits.maxBodyBytes??1048576,1,10485760);
  const maxSessions=boundedInt(limits.maxSessions??5,1,100);
  const loginLimit=boundedInt(limits.loginLimit??10,1,1000);
  const globalLoginLimit=boundedInt(limits.globalLoginLimit??60,1,10000);
  const requestLimit=boundedInt(limits.requestLimit??300,1,10000);
  const handles=new WeakMap(), sourceHandles=new WeakMap(), partitionHandles=new WeakMap(), mediaHandles=new WeakMap();
  let activeLogins=0;
  const time=()=>boundedInt(now(),0,8640000000000000-absoluteMs);
  function origin(request, {unsafe=false, expected}={}) {
    const url=new URL(request.url), supplied=request.headers.get('origin'), fetchSite=request.headers.get('sec-fetch-site');
    if (!allowed.has(url.origin) || (expected && url.origin!==expected) || (fetchSite && fetchSite!=='same-origin')) deny(403,'forbidden');
    if (supplied!==null) { if(supplied!==url.origin) deny(403,'forbidden'); }
    else {
      if(unsafe || !safeMethods.has(request.method) || fetchSite!=='same-origin') deny(403,'forbidden');
      let referer; try { referer=new URL(request.headers.get('referer')); } catch { deny(403,'forbidden'); }
      if(referer.origin!==url.origin || referer.username || referer.password) deny(403,'forbidden');
    }
    return url.origin;
  }
  function tokenHash(request, required=true) {
    // Browser sessions accept exactly one host cookie. Bearer/OAuth transports are later extensions.
    if(request.headers.has('authorization')) deny(401,'unauthenticated');
    const raw=request.headers.get('cookie')??'';
    if(Buffer.byteLength(raw)>8192) deny(401,'unauthenticated');
    const values=raw.split(';').map(v=>v.trim()).filter(v=>v.split('=')[0]===SESSION_COOKIE).map(v=>v.slice(v.indexOf('=')+1));
    if(values.length===0 && !required) return null;
    if(values.length!==1 || !tokenPattern.test(values[0])) deny(401,'unauthenticated');
    return hash(values[0]);
  }
  function sessionState(tokenHashValue, expectedOrigin) {
    const s=store.session(tokenHashValue), t=time();
    if(!s || s.epoch!==store.epoch || s.origin!==expectedOrigin || t<s.created_at || t<s.last_seen || t>=s.expires_at || t-s.last_seen>=idleMs) deny(401,'unauthenticated');
    const user=store.user(s.user_id);
    if(!user?.enabled || user.version!==s.user_version) deny(401,'unauthenticated');
    return {s,user,t};
  }
  function csrf(request,s) {
    const candidate=request.headers.get('x-atlas-csrf');
    if(!candidate || !tokenPattern.test(candidate) || !timingSafeEqual(Buffer.from(hash(candidate),'hex'),Buffer.from(s.csrf_hash,'hex'))) deny(403,'forbidden');
  }
  function rate(bucket,limit,windowMs=60000) {
    if(!store.consumeRate(hash(bucket),time(),{limit,windowMs})) deny(429,'forbidden');
  }
  function authenticate(request,{unsafe=false}={}) {
    const expectedOrigin=origin(request,{unsafe});
    const token=tokenHash(request);
    const state=sessionState(token,expectedOrigin);
    if(unsafe) csrf(request,state.s);
    // Credential rotation and additional sessions share one persistent user request budget.
    rate(`request:user:${state.user.user_id}`,requestLimit);
    return {...state,token,expectedOrigin};
  }
  function issue(user,sessionOrigin,{previous,oldToken}={}) {
    return store.transaction(()=>{
      const fresh=store.user(user.user_id);
      if(!fresh?.enabled || fresh.version!==user.version) deny(401,'unauthenticated');
      const t=time(), token=nonce(), csrfToken=nonce();
      if(previous) sessionState(oldToken,sessionOrigin);
      if(oldToken) store.revokeSession(oldToken);
      const createdAt=previous?.created_at??t, expiresAt=previous?.expires_at??(t+absoluteMs);
      store.insertSession({tokenHash:hash(token),csrfHash:hash(csrfToken),userId:user.user_id,userVersion:user.version,epoch:store.epoch,origin:sessionOrigin,createdAt,lastSeen:t,expiresAt},maxSessions,t);
      return success({schemaVersion:1,actorId:user.actor_id,csrfToken,expiresAt:new Date(expiresAt).toISOString()},cookie(token,Math.max(1,Math.floor((expiresAt-t)/1000))));
    });
  }
  async function login(request,{clientKey}={}) {
    if(request.method!=='POST') deny(405,'invalid-contract');
    const sessionOrigin=origin(request,{unsafe:true});
    if(typeof clientKey!=='string' || !clientKey.length || Buffer.byteLength(clientKey)>256) throw new TypeError('Trusted transport clientKey required');
    rate('login:global',globalLoginLimit); rate(`login:client:${clientKey}`,loginLimit,300000);
    if(activeLogins>=4) deny(429,'forbidden');
    const body=await readBoundedJson(request,4096); exact(body,['username','password']);
    let name; try{name=usernameKey(body.username);} catch{deny(401,'unauthenticated');}
    rate(`login:username:${name}`,loginLimit,300000);
    const user=store.userByName(name);
    if(activeLogins>=4) deny(429,'forbidden');
    activeLogins++;
    let verified;
    try { verified=await verifyPassword(body.password,user?.enabled?user.verifier:DUMMY_VERIFIER); }
    finally { activeLogins--; }
    if(!verified || !user?.enabled) deny(401,'unauthenticated');
    // Ignore all caller-selected identities/scopes: issue only for the verified server credential record.
    const oldToken=tokenHash(request,false);
    return issue(user,sessionOrigin,{oldToken});
  }
  async function authorize(request,{workspaceId,homeId,action}) {
    try {assertUuid(workspaceId); assertUuid(homeId);} catch{deny(404,'not-found');}
    if(!actions.has(action)) deny(403,'forbidden');
    const unsafe=action==='mutate';
    if(unsafe?request.method!=='POST':!safeMethods.has(request.method)) deny(405,'invalid-contract');
    const state=authenticate(request,{unsafe});
    // Reject the viewer before parsing an unsafe payload or looking up a replay receipt.
    const initial=store.membership(state.user.user_id,workspaceId,homeId);
    if(!initial?.enabled) deny(404,'not-found');
    if(unsafe && initial.role!=='editor') deny(403,'forbidden');
    const payload=unsafe?await readBoundedJson(request,maxBodyBytes):undefined;
    const fresh=sessionState(state.token,state.expectedOrigin), member=store.membership(fresh.user.user_id,workspaceId,homeId);
    if(!member?.enabled || member.version!==initial.version) deny(404,'not-found');
    if(unsafe && member.role!=='editor') deny(403,'forbidden');
    const principal=Object.freeze({actorId:fresh.user.actor_id,workspaceId,homeId,role:member.role});
    handles.set(principal,{token:state.token,origin:state.expectedOrigin,userId:fresh.user.user_id,memberVersion:member.version,workspaceId,homeId,action});
    store.touchSession(state.token,fresh.t);
    return Object.freeze({principal,payload});
  }
  function revalidate(principal) {
    const h=handles.get(principal); if(!h) deny(401,'unauthenticated');
    const {user}=sessionState(h.token,h.origin), member=store.membership(user.user_id,h.workspaceId,h.homeId);
    if(!member?.enabled || member.version!==h.memberVersion) deny(403,'forbidden');
    if(h.action==='mutate' && member.role!=='editor') deny(403,'forbidden');
    return principal;
  }
  function assertMutation(principal) {
    revalidate(principal);
    if(handles.get(principal).action!=='mutate') deny(403,'forbidden');
    return principal;
  }
  function withMutationAuthorization(principal,commit) {
    if(typeof commit!=='function' || commit.constructor.name==='AsyncFunction') throw new TypeError('Synchronous mutation callback required');
    // A writer fence orders other access DB writers after this synchronous storage transaction.
    // Storage must still call assertMutation immediately before its own COMMIT for expiry checks.
    return store.transaction(()=>{assertMutation(principal);return commit(principal);});
  }
  function authorizeSource(principal,reference) {
    revalidate(principal);
    try{validateShape('sourceRef',reference);}catch{deny(404,'not-found');}
    if(reference.workspaceId!==principal.workspaceId || reference.homeId!==principal.homeId) deny(404,'not-found');
    const key=reference.key, row=store.source(principal.workspaceId,principal.homeId,key.sourceInstanceId,key.collectionId);
    if(!row?.enabled) deny(404,'not-found');
    const registration=JSON.parse(row.registration), owner=key.sourceKind.startsWith('homebox-')?'homebox':key.sourceKind.startsWith('network-')?'network':'magicplan';
    if(registration.owner!==owner || (registration.partitionMode==='reviewed-entity-allowlist' && !registration.allowedExternalIds.includes(key.externalId))) deny(404,'not-found');
    const grant=Object.freeze(structuredClone(reference));
    // Deep-freeze wire fields; a server handle is also bound to a separately cloned immutable preimage.
    Object.freeze(grant.key);
    sourceHandles.set(grant,{principal,reference:structuredClone(reference),version:row.version});
    return grant;
  }
  function authorizeSourcePartition(principal,reference) {
    revalidate(principal);
    const fields=['collectionId','homeId','sourceInstanceId','workspaceId'];
    if(!reference || Object.getPrototypeOf(reference)!==Object.prototype || Object.keys(reference).sort().join(',')!==fields.join(',')) deny(404,'not-found');
    try {[reference.workspaceId,reference.homeId,reference.sourceInstanceId].forEach(assertUuid);} catch {deny(404,'not-found');}
    if(typeof reference.collectionId!=='string' || !reference.collectionId.length || [...reference.collectionId].length>4096) deny(404,'not-found');
    if(reference.workspaceId!==principal.workspaceId || reference.homeId!==principal.homeId) deny(404,'not-found');
    const row=store.source(principal.workspaceId,principal.homeId,reference.sourceInstanceId,reference.collectionId);
    if(!row?.enabled) deny(404,'not-found');
    const grant=Object.freeze(structuredClone(reference));
    // A partition grant authorizes availability metadata only, never individual source entities.
    partitionHandles.set(grant,{principal,reference:structuredClone(reference),version:row.version});
    return grant;
  }
  function revalidateSourcePartition(grant) {
    const h=partitionHandles.get(grant); if(!h) deny(401,'unauthenticated');
    revalidate(h.principal);
    const r=h.reference,row=store.source(r.workspaceId,r.homeId,r.sourceInstanceId,r.collectionId);
    if(!row?.enabled || row.version!==h.version) deny(404,'not-found');
    authorizeSourcePartition(h.principal,r);
    return grant;
  }
  function revalidateSource(grant) {
    const h=sourceHandles.get(grant); if(!h) deny(401,'unauthenticated');
    revalidate(h.principal);
    const r=h.reference,row=store.source(r.workspaceId,r.homeId,r.key.sourceInstanceId,r.key.collectionId);
    if(!row?.enabled || row.version!==h.version) deny(404,'not-found');
    authorizeSource(h.principal,r);
    return grant;
  }
  async function authorizeMedia(principal,descriptor,{mode='preview'}={}) {
    revalidate(principal);
    if(!['preview','download'].includes(mode) || !resolveMedia) deny(404,'not-found');
    const target=structuredClone(descriptor); let sourceGrant;
    if(target?.kind==='homebox-attachment') {
      exact(target,['kind','entity','attachmentId']); try{assertUuid(target.attachmentId);}catch{deny(404,'not-found');}
      if(target.entity?.key?.sourceKind!=='homebox-entity') deny(404,'not-found');
      sourceGrant=authorizeSource(principal,target.entity);
    } else if(target?.kind==='atlas-asset') {
      exact(target,['kind','assetId']); try{assertUuid(target.assetId);}catch{deny(404,'not-found');}
    } else deny(404,'not-found');
    // Resolver is configured server code. It must perform a scoped authoritative metadata lookup.
    let resource; try {resource=await resolveMedia(principal,structuredClone(target));} catch{deny(503,'upstream-unavailable');}
    revalidate(principal); if(sourceGrant) revalidateSource(sourceGrant);
    if(!resource || resource.workspaceId!==principal.workspaceId || resource.homeId!==principal.homeId || resource.kind!==target.kind || resource.availability!=='available') deny(404,'not-found');
    if(target.kind==='homebox-attachment' && (resource.attachmentId!==target.attachmentId || canonicalJson(resource.entity)!==canonicalJson(target.entity))) deny(404,'not-found');
    if(target.kind==='atlas-asset' && resource.assetId!==target.assetId) deny(404,'not-found');
    if(!Number.isSafeInteger(resource.byteSize) || resource.byteSize<0 || resource.byteSize>10485760) deny(404,'not-found');
    const raster=['image/jpeg','image/png','image/webp','image/gif'];
    if(mode==='preview' ? resource.previewPolicy!=='safe-rendered' || !raster.includes(resource.contentType) : !['safe-rendered','download-only'].includes(resource.previewPolicy) || ![...raster,'application/pdf','text/plain'].includes(resource.contentType)) deny(404,'not-found');
    const grant=Object.freeze({kind:target.kind,contentType:resource.contentType,byteSize:resource.byteSize,mode});
    mediaHandles.set(grant,{principal,descriptor:target,mode});
    return grant;
  }
  async function revalidateMedia(grant) {
    const h=mediaHandles.get(grant); if(!h) deny(401,'unauthenticated');
    return authorizeMedia(h.principal,h.descriptor,{mode:h.mode});
  }
  function sessionInfo(request) {
    if(request.method!=='GET') deny(405,'invalid-contract');
    const state=authenticate(request), csrfToken=nonce();
    // Fetch a fresh CSRF nonce after reload; existing tabs must fetch again after nonce rotation.
    store.replaceCsrf(state.token,hash(csrfToken)); store.touchSession(state.token,state.t);
    return success({schemaVersion:1,actorId:state.user.actor_id,csrfToken,expiresAt:new Date(state.s.expires_at).toISOString()});
  }
  function rotateSession(request) {
    if(request.method!=='POST') deny(405,'invalid-contract');
    const state=authenticate(request,{unsafe:true});
    return issue(state.user,state.expectedOrigin,{previous:state.s,oldToken:state.token});
  }
  function logout(request) {
    if(request.method!=='POST') deny(405,'invalid-contract');
    const state=authenticate(request,{unsafe:true}); store.revokeSession(state.token);
    return success({schemaVersion:1,signedOut:true},cookie('',0));
  }
  return Object.freeze({login,authorize,revalidate,assertMutation,withMutationAuthorization,authorizeSource,revalidateSource,authorizeSourcePartition,revalidateSourcePartition,authorizeMedia,revalidateMedia,sessionInfo,rotateSession,logout});
}
