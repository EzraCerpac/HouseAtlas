// Authorized ordinary valid examples only. No denial, malformed/stale input,
// guard reversal, rollback injection, concurrency, crash or replay controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AtlasStore, MUTATION_AUTHORIZATION_CONTEXT_FORMAT } from '../src/index.mjs';
import { AccessStore, createAccessBoundary, hashPassword } from '../../access/src/index.mjs';
import { canonicalJson } from '../../contracts/src/index.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={workspaceId:id(1),homeId:id(2)},actorId=id(50),userId=id(51),at='2026-01-03T12:00:00Z';
const origin='https://atlas.synthetic.invalid',password='synthetic-context-fixture-only';
const passwordVerifier=await hashPassword(password);
const fixture=name=>JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}.snapshot.json`,import.meta.url)));
const commandFixture=name=>JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}.json`,import.meta.url)));
const ref=(recordType,n)=>({recordType,recordId:id(n)});
const guard=(recordType,n,expectedRevision=1)=>({record:ref(recordType,n),expectedRevision});
function frozenData(value) {
  if(value&&typeof value==='object') {assert.ok(Object.isFrozen(value));for(const child of Object.values(value)) frozenData(child);}
}
async function setup(t,{name='plan-free',extend=s=>s}={}) {
  const snapshot=extend(fixture(name)),access=new AccessStore({filename:':memory:'});
  access.putUser({userId,actorId,username:'context-fixture-editor',passwordVerifier});access.setMembership({userId,...scope,role:'editor'});
  for(const source of snapshot.sources) access.putSource(source);
  const boundary=createAccessBoundary({store:access,origins:[origin],now:()=>Date.parse(at),resolveMedia:async()=>null});
  const login=await boundary.login(new Request(origin+'/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'context-fixture-editor',password})}),{clientKey:'synthetic-loopback'});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
  const {principal}=await boundary.authorize(new Request(origin+'/api/atlas',{method:'POST',headers:{origin,cookie,'x-atlas-csrf':csrf,'content-type':'application/json'},body:'{}'}),{...scope,action:'mutate'});
  const contexts=[],grantSets=new Map();
  const authorize=(p,request)=>{
    if(request.capability==='mutate') {
      boundary.assertMutation(p);const context=request.mutation;
      assert.equal(context.format,MUTATION_AUTHORIZATION_CONTEXT_FORMAT);frozenData(context);
      assert.equal(Object.getOwnPropertyDescriptor(request,'mutation').writable,false);
      for(const graph of [context.original,context.candidate].filter(Boolean)) for(const field of ['sources','records','homeboxEntities','caches','networkRelations'])
        assert.ok(graph[field].every(row=>row.workspaceId===scope.workspaceId&&row.homeId===scope.homeId));
      let grants=grantSets.get(context.contextId);
      if(context.phase==='intake') {grants={entities:new Map(),partitions:new Map()};grantSets.set(context.contextId,grants);}
      for(const source of context.closure.sourceRefs) {
        const key=canonicalJson(source),existing=grants.entities.get(key);
        if(context.phase==='precommit') assert.ok(existing);
        if(existing) boundary.revalidateSource(existing);else grants.entities.set(key,boundary.authorizeSource(p,source));
      }
      for(const partition of context.closure.sourcePartitions) {
        const key=canonicalJson(partition),existing=grants.partitions.get(key);
        if(context.phase==='precommit') assert.ok(existing);
        if(existing) boundary.revalidateSourcePartition(existing);else grants.partitions.set(key,boundary.authorizeSourcePartition(p,partition));
      }
      if(context.phase==='precommit') {
        for(const grant of grants.entities.values()) boundary.revalidateSource(grant);
        for(const grant of grants.partitions.values()) boundary.revalidateSourcePartition(grant);
      }
      contexts.push(context);
    } else boundary.revalidate(p);
    return p;
  };
  const store=new AtlasStore({path:':memory:',authorize,clock:()=>at,allowSyntheticBootstrap:true,
    verifyAvailableAsset:r=>({sha256:r.payload.sha256,byteSize:r.payload.byteSize})}); // Metadata fixture only; no byte qualification.
  store.initializeSynthetic(snapshot);t.after(()=>{store.close();access.close();});
  return {store,principal,contexts,grantSets,snapshot,run:fn=>boundary.withMutationAuthorization(principal,fn)};
}

test('valid circuit exposes immutable scoped graph/cache-epoch/precondition facts in phase order',async t=>{
  const s=await setup(t),command=commandFixture('create-circuit.mutation');
  const result=s.run(()=>s.store.execute(s.principal,scope,ref('circuit',900),command));
  assert.equal(result.record.recordId,id(900));assert.equal(s.store.databaseVersion,3);
  assert.deepEqual(s.contexts.map(c=>c.phase),['intake','validate','candidate','precommit']);
  assert.equal(new Set(s.contexts.map(c=>c.contextId)).size,1);
  const partitions=s.snapshot.sources.filter(source=>source.workspaceId===scope.workspaceId&&source.homeId===scope.homeId)
    .map(source=>({...scope,sourceInstanceId:source.sourceInstanceId,collectionId:source.collectionId,cacheEpoch:0}))
    .sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0);
  for(const context of s.contexts) assert.deepEqual(context.cachePartitions,partitions);
  assert.equal(s.contexts[0].candidate,null);assert.equal(s.contexts[0].preconditions,null);
  assert.deepEqual(s.contexts[1].preconditions.commands[0],{target:ref('circuit',900),operation:'create',expectedRevision:null,current:null,
    requiredGuards:[ref('evidence',100)],guards:[{record:ref('evidence',100),expectedRevision:1,currentRevision:1}]});
  assert.deepEqual(s.contexts[2].original,s.contexts[3].original);assert.deepEqual(s.contexts[2].candidate,s.contexts[3].candidate);
  assert.ok(s.contexts[0].original.records.every(r=>r.recordId!==id(900)));
  assert.deepEqual(s.contexts[2].candidate.records.find(r=>r.recordId===id(900)),result.record);
  assert.deepEqual(s.contexts[0].closure.sourceRefs,[]);
});

test('valid source-present binding exposes submitted and actual candidate source with current branded grants',async t=>{
  const s=await setup(t,{extend:snapshot=>{
    const row=fixture('import-remap').homeboxEntities.find(r=>r.source.externalId===id(504));
    snapshot.homeboxEntities.push(row);return snapshot;
  }});
  const payload=structuredClone(s.snapshot.records.find(r=>r.recordId===id(301)).payload);payload.source.externalId=id(504);
  const command={schemaVersion:1,mutationId:id(1200),operation:'create',expectedRevision:null,reason:'Synthetic source-associated binding',
    guards:[guard('identity',201),guard('evidence',100)],value:{recordType:'binding',payload}};
  const result=s.run(()=>s.store.execute(s.principal,scope,ref('binding',340),command));
  const source={...scope,key:payload.source};
  for(const context of s.contexts) assert.ok(context.closure.sourceRefs.some(r=>canonicalJson(r)===canonicalJson(source)));
  assert.equal(s.contexts[2].candidate.records.find(r=>r.recordId===id(340)).payload.sourceState,'present');
  assert.equal(s.contexts[0].original.homeboxEntities.find(r=>r.source.externalId===id(504)).entity.id,id(504));
  assert.deepEqual(s.contexts[0].closure.sourcePartitions,[{...scope,sourceInstanceId:id(10),collectionId:'synthetic-collection-a'}]);
  assert.equal(result.audit.actorId,actorId);
});

test('valid evidence covers provenance and attachment entity source refs',async t=>{
  const s=await setup(t),payload=structuredClone(s.snapshot.records.find(r=>r.recordType==='evidence').payload);
  const binding=n=>s.snapshot.records.find(r=>r.recordId===id(n)).payload.source;
  payload.provenance.source={...scope,key:binding(300)};
  payload.references=[{kind:'homebox-attachment',entity:{...scope,key:binding(301)},attachmentId:id(700)}];
  const command={schemaVersion:1,mutationId:id(1201),operation:'create',expectedRevision:null,reason:'Synthetic document observation',guards:[],value:{recordType:'evidence',payload}};
  const result=s.run(()=>s.store.execute(s.principal,scope,ref('evidence',341),command));
  assert.equal(result.record.recordType,'evidence');
  assert.deepEqual(s.contexts[0].closure.sourceRefs.map(r=>r.key.externalId),[id(500),id(501)]);
});

test('valid ordered remap retains original guards, same-batch exemptions and final journal graph',async t=>{
  const s=await setup(t),batch=commandFixture('import-remap.batch');
  const result=s.run(()=>s.store.executeBatch(s.principal,scope,batch));
  assert.equal(result.results.length,3);assert.deepEqual(s.contexts[0].entries,batch.commands);
  const pre=s.contexts[1].preconditions;
  assert.deepEqual(pre.createdInBatch,[ref('binding',304),ref('reconciliation',405)]);
  assert.deepEqual(pre.commands[2].requiredGuards,[ref('evidence',100),ref('identity',201),ref('binding',301)]);
  const candidate=s.contexts[2].candidate;
  assert.equal(candidate.records.find(r=>r.recordId===id(301)).payload.reviewStatus,'retired');
  assert.equal(candidate.records.find(r=>r.recordId===id(304)).payload.reviewStatus,'accepted');
  assert.equal(candidate.records.find(r=>r.recordId===id(405)).payload.toBindingId,id(304));
  assert.ok(s.contexts[3].closure.sourceRefs.some(r=>r.key.externalId===id(504)));
});

test('valid accepted geometry exposes exact compatible binding and recursively guarded original references',async t=>{
  const s=await setup(t,{name:'optional-geometry'}),payload=structuredClone(s.snapshot.records.find(r=>r.recordType==='geometry').payload);
  payload.mappings[0].reviewStatus='accepted';
  const command={schemaVersion:1,mutationId:id(1202),operation:'create',expectedRevision:null,reason:'Synthetic accepted room mapping',
    guards:[guard('asset',600),guard('identity',200),guard('evidence',100),guard('binding',300)],value:{recordType:'geometry',payload}};
  const result=s.run(()=>s.store.execute(s.principal,scope,ref('geometry',342),command));
  assert.equal(result.record.payload.mappings[0].reviewStatus,'accepted');
  assert.deepEqual(s.contexts[1].preconditions.commands[0].requiredGuards,[ref('evidence',100),ref('identity',200),ref('binding',300),ref('asset',600)]);
  assert.ok(s.contexts[2].closure.recordRefs.some(r=>r.recordType==='binding'&&r.recordId===id(300)));
  assert.equal(s.contexts[2].closure.sourceRefs[0].key.externalId,id(500));
});

test('valid legacy callback remains compatible when it ignores the additive context',()=>{
  const principal={...scope,actorId},store=new AtlasStore({path:':memory:',authorize:p=>p,clock:()=>at,allowSyntheticBootstrap:true});
  try {store.initializeSynthetic(fixture('plan-free'));const result=store.execute(principal,scope,ref('circuit',900),commandFixture('create-circuit.mutation'));assert.equal(result.record.revision,1);}
  finally {store.close();}
});
