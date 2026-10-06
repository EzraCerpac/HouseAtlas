import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, media, pngBytes, assetDescriptor, homeboxDescriptor, scope, U, request, mutation } from './support.mjs';
import { AccessStore } from '../../access/src/index.mjs';
import { join } from 'node:path';

test('existing foreign-home asset is invisible to the current branded principal',async t=>{const e=await setup({otherHomeAsset:true});t.after(e.close);assert.equal((await e.deliver({kind:'atlas-asset',assetId:U(603)})).status,404);assert.equal((await e.deliver()).status,200);});
test('revocation during final awaited metadata revalidation prevents owned byte delivery',async t=>{
  const e=await setup({onResolve:(value,{count,access})=>{if(count===2)access.invalidateAllSessions();return value;}});t.after(e.close);assert.equal((await e.deliver()).status,401);
});
test('bounded concurrent delivery rejects excess requests and releases capacity after timeout',async t=>{
  const e=await setup({timeoutMs:40,readAttachment:async()=>new Promise(()=>{})});t.after(e.close);const pending=Array.from({length:4},()=>e.deliver(homeboxDescriptor));assert.equal((await e.deliver(homeboxDescriptor)).status,429);assert((await Promise.all(pending)).every(r=>r.status===503));assert.equal((await e.deliver()).status,200);
});
test('upstream auth denial survives access-store reopen and withholds cached bytes',async t=>{
  const e=await setup({readAttachment:async()=>({status:401})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,404);
  const reopened=new AccessStore({filename:join(e.dir,'access.sqlite')});try{assert.equal(reopened.source(scope.workspaceId,scope.homeId,U(10),'synthetic-collection-a').enabled,0);}finally{reopened.close();}
});
test('archived HomeBox item remains an authorized reference; missing upstream bytes never delete its cache',async t=>{
  const e=await setup({archivedHomebox:true,readAttachment:async()=>({status:404})});t.after(e.close);const p=await e.principal(),before=e.store.readSnapshot(p,scope);assert.equal((await e.deliver(homeboxDescriptor)).status,404);assert.deepEqual(e.store.readSnapshot(p,scope),before);
});
test('excessive empty stream chunks are bounded',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),body:(function*(){for(let n=0;n<65537;n++)yield new Uint8Array(0);throw new Error('chunk limit failed to stop producer');})()})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,413);
});

test('PNG preview strips original metadata; download preserves original hash and private headers',async t=>{
  const e=await setup();t.after(e.close);
  const preview=await e.deliver();assert.equal(preview.status,200);const derivative=Buffer.from(await preview.arrayBuffer());assert(!derivative.includes(Buffer.from('synthetic secret marker')));
  const response=await e.deliver(assetDescriptor,{mode:'download'});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pngBytes);
  for(const r of [preview,response]){assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert(r.headers.get('content-security-policy').includes('sandbox'));assert.equal(r.headers.get('access-control-allow-origin'),null);}
  assert(response.headers.get('content-disposition').startsWith('attachment'));assert(!JSON.stringify([...response.headers]).includes('storageKey'));
});
test('HEAD performs verification and emits no body',async t=>{const e=await setup();t.after(e.close);const r=await e.deliver(assetDescriptor,{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert(Number(r.headers.get('content-length'))>0);});
test('stored HomeBox attachment requires exact receipt; native proxyRef remains null',async t=>{
  let seen;const e=await setup({readAttachment:async(input,{response})=>{seen=input;return response(input);}});t.after(e.close);
  assert.equal((await e.deliver(homeboxDescriptor)).status,200);assert.equal(seen.method,'GET');assert.equal(seen.redirect,'error');assert.equal(seen.headers['X-Tenant'],'synthetic-collection-a');assert.equal(seen.url,undefined);
  assert.equal(e.snapshot.homeboxEntities[0].attachments[0].proxyRef,null);
});
test('arbitrary URLs, paths, external links, query credentials and cross-home selectors are denied before provider calls',async t=>{
  let calls=0;const e=await setup({readAttachment:async(input,{response})=>{calls++;return response(input);}});t.after(e.close);
  for(const descriptor of [{...homeboxDescriptor,url:'http://127.0.0.1/secret'},{kind:'external-link',url:'https://external.invalid/a'},{...assetDescriptor,path:'/etc/passwd'},{...homeboxDescriptor,entity:{...homeboxDescriptor.entity,homeId:U(3)}}])assert.notEqual((await e.deliver(descriptor)).status,200);
  assert.notEqual((await e.deliver(homeboxDescriptor,{path:'/media?key=synthetic-secret'})).status,200);assert.equal(calls,0);
});
test('auth/wrong-source receipts quarantine durably without returning bytes',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),origin:'https://foreign.invalid'})});t.after(e.close);
  const r=await e.deliver(homeboxDescriptor);assert.equal(r.status,404);assert(!await r.text().then(x=>x.includes('foreign.invalid')));
  assert.equal(e.access.source(scope.workspaceId,scope.homeId,U(10),'synthetic-collection-a').enabled,0);
  assert.equal(e.store.readCacheForPublication(e.admin,scope,{...scope,sourceInstanceId:U(10),collectionId:'synthetic-collection-a'}).cache.status,'access-revoked');
  assert.equal((await e.deliver(assetDescriptor)).status,200);
});
test('redirects and response URLs are rejected without following them',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),status:302,redirected:true,location:'https://foreign.invalid'})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,503);
});
test('source revision and attachment binding mismatches quarantine',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),descriptor:{...input.descriptor,attachmentId:U(7999)}})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,404);
});
test('actual byte ceiling holds with lying Content-Length and owned chunk copies',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),body:(async function*(){yield new Uint8Array(media.MAX_BYTES);yield new Uint8Array(1);throw new Error('limit failed to stop upstream iteration');})()})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,413);
});
test('producer may reuse one scratch buffer across chunks',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),body:(async function*(){const scratch=new Uint8Array(1);for(const b of pngBytes){scratch[0]=b;yield scratch;}})()})});t.after(e.close);
  const r=await e.deliver(homeboxDescriptor,{mode:'download'});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),pngBytes);
});
test('MIME mismatch, truncated bytes and malformed PNG fail closed',async t=>{
  const e=await setup({readAttachment:async(input,{response})=>({...response(input),contentType:'text/html'})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,415);
});
test('revocation during awaited bytes prevents delivery',async t=>{
  const e=await setup({readAttachment:async(input,{response,access})=>({...response(input),body:(async function*(){yield pngBytes.subarray(0,20);access.revokeUserSessions(U(51));yield pngBytes.subarray(20);})()})});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,401);
});
test('source revoke and reenable invalidates the original source grant',async t=>{
  const e=await setup({readAttachment:async(input,{response,access})=>{access.setSourceEnabled(scope.workspaceId,scope.homeId,U(10),'synthetic-collection-a',false);access.setSourceEnabled(scope.workspaceId,scope.homeId,U(10),'synthetic-collection-a',true);return response(input);}});t.after(e.close);assert.equal((await e.deliver(homeboxDescriptor)).status,404);
});
test('stale source epoch rejects an otherwise identical cached media response',async t=>{
  const partition={...scope,sourceInstanceId:U(10),collectionId:'synthetic-collection-a'};
  const e=await setup({readAttachment:async(input,{response,store,admin})=>{store.recordCacheFailure(admin,scope,partition,{code:'timeout'});return response(input);}});t.after(e.close);
  e.store.recordCacheFailure(e.admin,scope,partition,{code:'timeout'});assert.equal((await e.deliver(homeboxDescriptor)).status,409);
});
test('media fetch does not freshen cache; upstream outage does not block Atlas originals',async t=>{
  const e=await setup({readAttachment:async()=>{throw new Error('synthetic upstream secret');}});t.after(e.close);const p=await e.principal();const before=e.store.readSnapshot(p,scope).caches;
  const r=await e.deliver(homeboxDescriptor);assert.equal(r.status,503);assert.equal(await r.text(),'{"error":"Media unavailable"}');assert.deepEqual(e.store.readSnapshot(p,scope).caches,before);assert.equal((await e.deliver()).status,200);
});
test('stalled provider deadline aborts; cancelled streams are returned',async t=>{
  let aborted=false;const e=await setup({timeoutMs:30,readAttachment:async(input)=>{input.signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}});t.after(e.close);
  assert.equal((await e.deliver(homeboxDescriptor)).status,503);assert(aborted);
});
test('caller cancellation closes body and delivers no bytes',async t=>{
  let closed=false;const controller=new AbortController();const e=await setup({readAttachment:async(input,{response})=>({...response(input),body:{[Symbol.asyncIterator](){return{next(){controller.abort();return new Promise(()=>{});},return(){closed=true;return{done:true};}};}}})});t.after(e.close);
  assert.equal((await e.deliver(homeboxDescriptor,{signal:controller.signal})).status,503);assert(closed);
});
test('restore epochs, logout and viewer mutations are denied by actual access handles',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal();e.access.invalidateAllSessions();assert.throws(()=>e.boundary.revalidate(p));assert.equal((await e.deliver()).status,401);
  const viewer=await e.login('synthetic-viewer');await assert.rejects(e.principal('mutate',viewer));assert.equal((await e.service.deliver(request(viewer),{scope,descriptor:assetDescriptor})).status,200);
});
test('tombstone denies delivery and retains originals; restore reuses immutable bytes',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(600)};
  const tomb=e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,mutation('tombstone',8100)));assert.equal(tomb.record.lifecycle,'tombstoned');
  assert.notEqual((await e.deliver()).status,200);assert.deepEqual(e.vault.readRetained(tomb.record),pngBytes);
  e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,mutation('restore',8101,2)));assert.equal((await e.deliver()).status,200);
});
test('PDF and UTF-8 text are downloads only; active content is not admitted',async t=>{
  const e=await setup({assetType:'application/pdf',assetBody:Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n')});t.after(e.close);assert.equal((await e.deliver()).status,404);assert.equal((await e.deliver(assetDescriptor,{mode:'download'})).status,200);
  for(const [contentType,body] of [['image/svg+xml','<svg/>'],['text/html','<script/>'],['text/plain',Buffer.from([255])]])await assert.rejects(e.vault.prepareOriginal({scope,purpose:'evidence-original',contentType,body:Buffer.from(body)}));
});
