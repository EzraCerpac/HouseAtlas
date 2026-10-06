import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCoreService } from '../src/service.mjs';
import { createCoreRouter } from '../src/router.mjs';
import { restoreCoreRecovery, verifyCoreRecovery } from '../src/recovery.mjs';
import { partitionOf, sha256 } from '../src/common.mjs';
import { setup,scope,other,U,origin,command,circuitTarget } from './support.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const send=(c,path,options={})=>c.router(c.request(c.prefix+path,c.session,options));
const counts=path=> {const db=new DatabaseSync(path,{readOnly:true});try{return ['records','audits','receipts','batch_receipts'].map(t=>db.prepare('SELECT count(*) AS n FROM '+t).get().n);}finally{db.close();}};

test('actual router integrates tree/items/documents/maintenance and complete passive Network provenance independently',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('network');
  const response=await send(c,'/view'),view=await response.json();assert.equal(response.status,200);assert.equal(view.status,'ready');
  assert.equal(view.entries.length,3);assert.equal(view.entries[0].entity.entityType.name,'Custom cupboard');
  const item=view.entries.find(e=>e.entity.id===U(501));assert.equal(item.entity.parent.id,U(500));assert.equal(item.attachments.length,3);assert.equal(item.maintenance.length,1);
  assert.match(item.attachments.find(a=>a.attachmentId===U(801)).downloadHref,/^\/api\/atlas\/media\//);assert.equal(item.attachments[0].proxyRef,undefined);
  const before=c.calls.length,network=await (await send(c,'/network')).json(),facet=network[0];
  assert.equal(facet.devices.length,2);assert.equal(facet.interfaces.length,1);assert.equal(facet.groups.length,1);assert.equal(facet.segments.length,1);assert.equal(facet.observations[0].freshness,'invalidated');
  assert.equal(facet.history[0].temporalStatus,'disputed');assert.equal(facet.currentClaims.find(r=>r.externalId==='member-a').evidenceBasis,'owner-report');assert.equal(facet.currentClaims.find(r=>r.externalId==='member-a').sourceConfidence,'confirmed');
  assert.equal(facet.currentClaims.find(r=>r.externalId==='gap-a').to.description,'Unknown peer');assert.equal(facet.geometry,undefined);assert.equal(c.calls.length,before);
  c.state.network='transport';await c.refresh('network');const after=await (await send(c,'/view')).json();assert.equal(after.entries.length,3);
  const stale=(await (await send(c,'/network')).json())[0];assert.equal(stale.status,'stale');assert.equal(stale.cache.lastSuccessfulFetchAt,facet.cache.lastSuccessfulFetchAt);assert.equal(stale.observations[0].factAt,facet.observations[0].factAt);
  assert(c.calls.filter(x=>x.owner==='network').every(x=>x.method==='GET'&&x.path==='/api/inventory'&&x.redirect==='error'));
});
test('branded authority, viewer denial, duplicate keys, origins and internal cache routes fail closed',async t=> {
  const c=await setup();t.after(c.close);const p=await c.principal();assert.throws(()=>c.service.snapshot({...p}),e=>e.code==='unauthenticated');
  const viewer=await c.login('viewer'),body={target:circuitTarget,command:command()};
  assert.equal((await c.router(c.request(c.prefix+'/commands',viewer,{method:'POST',body}))).status,403);
  assert.equal((await send(c,'/commands',{method:'POST',raw:'{"target":{},"target":{},"command":{}}'})).status,422);
  assert.equal((await send(c,'/commands',{method:'POST',body,headers:{origin:'https://sibling.synthetic.invalid'}})).status,403);
  assert.equal((await send(c,'/publish-cache',{method:'POST',body})).status,404);
  assert.equal((await send(c,'/view',{method:'POST'})).status,405);
  assert.equal((await c.router(c.request(c.prefix+'/view?actorId='+U(50),c.session))).status,403);
  assert.equal((await c.router(c.request('/assets/atlas/prepare.mjs',c.session))).status,404);
  assert.equal((await c.router(c.request('/assets/atlas/host.mjs'))).status,200);
  assert.equal((await c.router(c.request('/'))).headers.get('cache-control'),'private, no-store');
});
test('actual fenced storage command is durable/payload-bound; independent revocation waits then blocks receipt replay',async t=> {
  let competing,blocked=false;const c=await setup({storageFault:phase=> {if(phase==='after-receipt'){assert.throws(()=>competing.exec('UPDATE access_users SET enabled=0 WHERE user_id=\''+U(51)+'\''),/locked/);blocked=true;}}});t.after(c.close);
  competing=new DatabaseSync(join(c.dir,'access.sqlite'));competing.exec('PRAGMA busy_timeout=0');t.after(()=>competing.close());
  const body={target:circuitTarget,command:command()},first=await send(c,'/commands',{method:'POST',body}),result=await first.json();assert.equal(first.status,200);assert.equal(blocked,true);assert.equal(result.audit.actorId,U(50));
  const replay=await (await send(c,'/commands',{method:'POST',body})).json();assert.equal(replay.replayed,true);assert.equal((await (await send(c,'/history/circuit/'+U(900))).json()).length,1);
  assert.equal((await send(c,'/commands',{method:'POST',body:{...body,command:{...body.command,reason:'Changed payload'}}})).status,409);
  competing.exec('UPDATE access_users SET enabled=0,version=version+1 WHERE user_id=\''+U(51)+'\'');assert.equal((await send(c,'/commands',{method:'POST',body})).status,401);
});
test('expiry at real Atlas precommit rolls back record/audit/receipt; retry reserves only committed outcome',async t=> {
  let c,expire=false;c=await setup({storageFault:(phase,detail)=> {if(expire&&phase==='before-commit'&&detail.operation!=='cache')c.setTime(c.getTime()+8*24*3600000);}});t.after(c.close);
  const before=counts(c.paths.databasePath);expire=true;assert.equal((await send(c,'/commands',{method:'POST',body:{target:circuitTarget,command:command()}})).status,401);assert.deepEqual(counts(c.paths.databasePath),before);
  expire=false;c.session=await c.login();const res=await send(c,'/commands',{method:'POST',body:{target:circuitTarget,command:command()}});assert.equal(res.status,200);assert.equal((await res.json()).replayed,false);
});
test('invalid composed batch commits no record/audit/receipt fragment',async t=> {
  const c=await setup();t.after(c.close);const before=counts(c.paths.databasePath);
  const batch={schemaVersion:1,batchId:U(1200),reason:'Synthetic combined batch',commands:[{target:circuitTarget,command:command()},{target:{recordType:'circuit',recordId:U(901)},command:{...command(1001),guards:[{record:{recordType:'evidence',recordId:U(100)},expectedRevision:2}]}}]};
  assert.equal((await send(c,'/batch',{method:'POST',body:batch})).status,409);assert.deepEqual(counts(c.paths.databasePath),before);
  batch.commands[1].command.guards[0].expectedRevision=1;const result=await send(c,'/batch',{method:'POST',body:batch});assert.equal(result.status,200);assert.equal((await result.json()).results.length,2);
});
test('source-partition denial with no cache and empty allowlist remains distinct from authorized empty',async t=> {
  const c=await setup();t.after(c.close);const network=c.sources.find(s=>s.registration.owner==='network').registration;
  c.access.setSourceEnabled(scope.workspaceId,scope.homeId,network.sourceInstanceId,network.collectionId,false);
  const view=await (await send(c,'/view')).json();assert.equal(view.status,'ready');assert.equal(view.entries.length,4);assert.deepEqual(view.caches.find(c=>c.owner==='network'),{owner:'network',status:'access-revoked',displayStatus:'access-revoked'});
  assert.equal((await (await send(c,'/network')).json())[0].status,'revoked');
  const s=await c.principal();const snap=c.service.snapshot(s),cache=snap.caches.find(r=>r.sourceInstanceId===network.sourceInstanceId);assert.equal(cache.generationId,null);assert.equal(cache.lastAttemptAt,null);
  const db=new DatabaseSync(c.paths.databasePath,{readOnly:true});t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) AS n FROM caches WHERE source_instance_id=?').get(network.sourceInstanceId).n,0);
});
test('auth/wrong-scope failure commits sticky disabled source before any subsequent cached view/media',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('network');
  c.state.network='wrong-scope';await c.refresh('network');const view=await (await send(c,'/view')).json();assert.equal(view.entries.length,3);assert.doesNotMatch(JSON.stringify(view),/member-a|device-a|observation-a/);
  c.state.network='ok';await assert.rejects(c.refresh('network'),e=>e.code==='not-found');
  const network=c.sources.find(s=>s.registration.owner==='network').registration;c.access.setSourceEnabled(scope.workspaceId,scope.homeId,network.sourceInstanceId,network.collectionId,true);await c.refresh('network');assert.equal((await (await send(c,'/network')).json())[0].status,'fresh');
  c.state.hb='auth';await c.refresh();const denied=await (await send(c,'/view')).json();assert.equal(denied.status,'ready');assert.equal(denied.entries.length,0);assert.equal(denied.homes.length,2);
});
test('an intervening failure epoch prevents stale complete fetch publication with no rebase',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();let release,started;const ready=new Promise(r=>started=r);let first=true;
  c.hooks.homebox=async()=> {if(first){first=false;started();await new Promise(r=>release=r);}};
  const pending=c.refresh();await ready;c.state.hb='transport';await c.refresh();c.state.hb='ok';release();await assert.rejects(pending,e=>e.code==='guard-conflict');
  const view=await (await send(c,'/view')).json();assert.equal(view.caches.find(c=>c.owner==='homebox').status,'error');assert.equal(view.entries.length,3);
  await c.refresh();assert.equal((await (await send(c,'/view')).json()).caches.find(c=>c.owner==='homebox').status,'fresh');
});
test('Network staged orphan is invisible across reopen; complete sidecar precedes published generation pointer',async t=> {
  let stop=true;const c=await setup({fault:phase=>{if(stop&&phase==='after-network-stage')throw new Error('Synthetic interruption');}});t.after(c.close);
  await assert.rejects(c.refresh('network'),/interruption/);assert.equal((await (await send(c,'/network')).json())[0].status,'unavailable');
  const db=new DatabaseSync(c.paths.sidecarPath,{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM core_network_generations').get().n,1);db.close();
  const reopened=createCoreService({...c.paths,accessStore:c.access,origins:[origin],homes:[{...scope,label:'Example home'},{...other,label:'Second home'}],sources:c.sources,clock:()=>new Date(c.getTime()).toISOString(),now:c.getTime});
  const router=createCoreRouter({service:reopened,origins:[origin]});assert.equal((await (await router(c.request(c.prefix+'/network',c.session))).json())[0].status,'unavailable');reopened.close();
  stop=false;await c.refresh('network');assert.equal((await (await send(c,'/network')).json())[0].devices.length,2);
});
test('Network observation-only policy denial redacts the entire facet and saved source evidence',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('network');const s=c.sources.find(s=>s.registration.owner==='network').registration;
  const ids=Object.values(c.wire.inventory).filter(Array.isArray).flat().map(r=>r.id);
  c.access.putSource({...s,partitionMode:'reviewed-entity-allowlist',allowedExternalIds:ids});
  const facet=await (await send(c,'/network')).json();assert.deepEqual(facet,[{readOnly:true,status:'revoked',message:'Network access is unavailable'}]);
  assert.doesNotMatch(JSON.stringify(await (await send(c,'/view')).json()),/observation-a|device-a|member-a|2025-12-01/);
});
test('complete empty generation and denied empty partition carry distinct current authority',async t=> {
  const snapshot={contractVersion:'1.0.0',synthetic:true,sources:[{workspaceId:scope.workspaceId,homeId:scope.homeId,sourceInstanceId:U(10),collectionId:'empty-synthetic',owner:'homebox',partitionMode:'reviewed-entity-allowlist',allowedExternalIds:[]}],records:[],caches:[],homeboxEntities:[],networkRelations:[]};
  const c=await setup({snapshot});t.after(c.close);await c.refresh();const before=await (await send(c,'/view')).json();assert.equal(before.entries.length,0);assert.equal(before.caches[0].status,'fresh');assert.ok(before.caches[0].generationId);assert.equal(c.calls.length,2);assert(c.calls.every(r=>r.path==='/api/v1/entities'));
  c.access.setSourceEnabled(scope.workspaceId,scope.homeId,U(10),'empty-synthetic',false);const after=await (await send(c,'/view')).json();assert.equal(after.caches[0].status,'access-revoked');assert.equal(after.caches[0].generationId,undefined);
});
test('media mount uses authoritative descriptors/byte checks and rechecks revocation after awaited provider work',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();const view=await (await send(c,'/view')).json(),item=view.entries.find(e=>e.entity.id===U(501)),photo=item.attachments.find(a=>a.attachmentId===U(803)),manual=item.attachments.find(a=>a.attachmentId===U(801));
  const response=await c.router(c.request(photo.previewHref,c.session));assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.includes(Buffer.from('private-note')),false);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await (await c.router(c.request(manual.downloadHref,c.session))).text(),c.manual.toString());
  assert.equal((await c.router(c.request(photo.previewHref+'?token=guess',c.session))).status,403);
  c.state.media='malformed';assert.equal((await c.router(c.request(photo.previewHref,c.session))).status,415);c.state.media='ok';
  let release,ready;const started=new Promise(r=>ready=r);c.hooks.media=async()=>{ready();await new Promise(r=>release=r);};const pending=c.router(c.request(photo.previewHref,c.session));await started;c.access.setUserEnabled(U(51),false);release();assert.equal((await pending).status,401);
});
test('router multi-home reads/Settings choices enforce current memberships and clear foreign cache IDs',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('homebox',other);
  const before=await (await c.router(c.request('/api/atlas/'+other.workspaceId+'/'+other.homeId+'/view',c.session))).json();assert.equal(before.entries.length,1);assert.equal(before.entries[0].entity.name,'Second synthetic home');assert.doesNotMatch(JSON.stringify(before),/Synthetic unplaced item|device-a/);
  c.access.setMembership({userId:U(51),...other,role:'editor',enabled:false});assert.equal((await c.router(c.request('/api/atlas/'+other.workspaceId+'/'+other.homeId+'/view',c.session))).status,404);
  assert.equal((await (await c.router(c.request('/api/atlas/homes',c.session))).json()).length,1);
});
test('drained recovery restores exact committed Atlas command/media/Network inventory and rejects recomputed sidecar omission',async t=> {
  const c=await setup({ownedAsset:true});t.after(c.close);await c.refresh();await c.refresh('network');await send(c,'/commands',{method:'POST',body:{target:circuitTarget,command:command()}});
  const bundle=join(c.dir,'bundle');await c.service.captureRecovery(bundle);verifyCoreRecovery({bundle});const restored=restoreCoreRecovery({bundle,destination:join(c.dir,'restored')});
  const service=createCoreService({...restored,accessStore:c.access,origins:[origin],homes:[{...scope,label:'Example home'},{...other,label:'Second home'}],sources:c.sources,clock:()=>new Date(c.getTime()).toISOString(),now:c.getTime});t.after(service.close);
  const router=createCoreRouter({service,origins:[origin]}),network=await (await router(c.request(c.prefix+'/network',c.session))).json();assert.equal(network[0].observations.length,1);assert.equal(network[0].devices.length,2);
  assert.equal((await router(c.request(c.prefix+'/commands',c.session,{method:'POST',body:{target:circuitTarget,command:command()}}))).status,200);
  const history=await (await router(c.request(c.prefix+'/history/circuit/'+U(900),c.session))).json();assert.equal(history.length,1);
  const descriptor={kind:'atlas-asset',assetId:U(600)},path='/api/atlas/media/'+scope.workspaceId+'/'+scope.homeId+'/'+sha256(JSON.stringify(descriptor))+'/preview';
  // canonical descriptor spelling is ordered by RFC8785, not object insertion.
  const canonical=(await import('../../packages/contracts/src/index.mjs')).canonicalJson;const mediaPath=path.replace(sha256(JSON.stringify(descriptor)),sha256(canonical(descriptor)));
  assert.equal((await router(c.request(mediaPath,c.session))).status,200);
  const packet=JSON.parse(readFileSync(join(bundle,'network.json')));packet.rows=[];const raw=JSON.stringify(packet);writeFileSync(join(bundle,'network.json'),raw);const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json')));manifest.networkSha256=sha256(raw);writeFileSync(join(bundle,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>verifyCoreRecovery({bundle}));
});
test('pending source work blocks recovery capture; cancelled completion cannot publish',async t=> {
  const c=await setup();t.after(c.close);let release,ready;const started=new Promise(r=>ready=r);c.hooks.homebox=async()=>{ready();await new Promise(r=>release=r);};
  const controller=new AbortController(),r=c.sources[0].registration,pending=c.service.refreshSource(await c.principal(),partitionOf(r),{signal:controller.signal});await started;
  await assert.rejects(c.service.captureRecovery(join(c.dir,'busy-bundle')),e=>e.status===409);controller.abort();release();await pending;await tick();const view=await (await send(c,'/view')).json();assert.equal(view.caches.find(c=>c.owner==='homebox').lastSuccessfulFetchAt,'2026-01-02T12:00:00Z');
});
