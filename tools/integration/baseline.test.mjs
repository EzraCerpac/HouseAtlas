import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSnapshot, CONTRACT_VERSION, boundaries } from '../../packages/contracts/src/index.mjs';
const load = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const snapshot = name => load(`fixtures/integration/${name}.snapshot.json`);
const catalog = load('fixtures/integration/catalog.json');
const policy = load('packages/operations-policy/policy.json');
for (const entry of catalog.fixtures) test(`frozen application fixture validates: ${entry.path}`,()=>validateSnapshot(load(entry.path)));
test('contract, record and fixture versions are coherent',()=>{
 assert.equal(catalog.contractVersion,CONTRACT_VERSION);assert.equal(catalog.recordSchemaVersion,boundaries.schemaVersion);assert.equal(policy.contract.version,CONTRACT_VERSION);assert.equal(policy.contract.recordSchemaVersion,catalog.recordSchemaVersion);assert.equal(policy.contract.homeboxReferenceVersion,boundaries.homebox.testedVersion);
});
test('two same-name places retain different home/source identity',()=>{
 const s=snapshot('multi-home-unplaced');const places=s.homeboxEntities.filter(p=>p.entity.name==='Synthetic custom storage container');assert.equal(places.length,2);assert.notEqual(places[0].homeId,places[1].homeId);assert.notEqual(places[0].source.sourceInstanceId,places[1].source.sourceInstanceId);
 const wrong=structuredClone(s);wrong.homeboxEntities.at(-1).homeId=places[0].homeId;assert.throws(()=>validateSnapshot(wrong),e=>e.code==='forbidden');
});
test('arbitrary container and archive preserved with no required floorplan',()=>{
 const s=snapshot('multi-home-unplaced');assert.ok(s.homeboxEntities.some(p=>p.entity.entityType?.name==='Custom storage container'&&p.entity.entityType.isLocation&&p.entity.parent));assert.ok(s.homeboxEntities.some(p=>p.entity.archived));assert.ok(!s.records.some(r=>r.recordType==='geometry'));
});
test('mobile and fixed unplaced items remain projections with unknown material',()=>{
 const s=snapshot('multi-home-unplaced');const items=s.homeboxEntities.filter(p=>p.entity.name.includes('unplaced item'));assert.equal(items.length,2);assert.ok(items.every(p=>p.entity.parent===null&&p.entity.modelNumber===null&&p.attachments.length===0));assert.notEqual(items[0].entity.notes,items[1].entity.notes);
});
test('first-run, failed first fetch and successful empty generation are distinct',()=>{
 const first=snapshot('first-run'),out=snapshot('no-cache-outage'),empty=snapshot('empty-collection');assert.equal(first.caches[0].status,'empty');assert.equal(first.caches[0].lastSuccessfulFetchAt,null);assert.equal(out.caches[0].status,'error');assert.equal(out.caches[0].generationId,null);assert.equal(empty.caches[0].status,'fresh');assert.ok(empty.caches[0].generationId);assert.equal(empty.homeboxEntities.length,0);
});
test('HomeBox failure retains exact successful generation and projection age',()=>{
 const base=load('packages/contracts/fixtures/plan-free.snapshot.json'),failed=snapshot('homebox-outage');assert.deepEqual(failed.homeboxEntities,base.homeboxEntities);assert.equal(failed.caches[0].lastSuccessfulFetchAt,base.caches[0].lastSuccessfulFetchAt);assert.equal(failed.caches[0].generationId,base.caches[0].generationId);assert.notEqual(failed.caches[0].lastAttemptAt,failed.caches[0].lastSuccessfulFetchAt);
 const wrong=structuredClone(failed);wrong.caches[0].generationId=null;assert.throws(()=>validateSnapshot(wrong),e=>e.code==='invalid-contract');
});
test('Network outage keeps HomeBox content and historical qualifiers',()=>{
 const base=load('packages/contracts/fixtures/plan-free.snapshot.json'),s=snapshot('network-outage');assert.deepEqual(s.homeboxEntities,base.homeboxEntities);assert.equal(s.caches[0].status,'fresh');assert.equal(s.caches[1].status,'error');assert.deepEqual(s.networkRelations,base.networkRelations);assert.ok(s.networkRelations.some(r=>r.sourceConfidence==='confirmed'&&r.evidenceBasis==='owner-report'));assert.ok(s.networkRelations.some(r=>r.temporalStatus==='disputed'));
});
test('revoked cache is retained storage requiring permission enforcement',()=>{
 const s=snapshot('access-revoked');assert.equal(s.caches[0].status,'access-revoked');assert.ok(s.homeboxEntities.length);assert.equal(policy.access.denyRevokedCacheAndMedia,true);assert.equal(policy.access.upstreamDeniedPartition,'quarantine-pending-scope-revalidation');
});
test('operations proposals cannot release live gates or agent access',()=>{
 assert.equal(policy.target.readiness,'unknown-unqualified');assert.equal(policy.recovery.objectivesStatus,'proposed-unmeasured');assert.deepEqual(policy.gates.releasedByThisPackage,[]);assert.equal(policy.futureAgentAccess.enabled,false);assert.equal(policy.futureAgentAccess.requiresNewAiServiceForMvp,false);assert.equal(policy.offline.disconnectedEditing,false);
});
test('GET-only and media policies agree across packages',()=>{
 assert.deepEqual(policy.integration.homeboxMethods,boundaries.homebox.methods);assert.deepEqual(policy.integration.networkMethods,boundaries.network.methods);assert.deepEqual(policy.integration.networkForbidden,boundaries.network.forbiddenCapabilities);assert.equal(policy.media.maxRedirects,boundaries.media.maxRedirects);assert.equal(policy.media.externalLinksServerFetched,boundaries.media.externalLinksServerFetched);assert.equal(policy.media.svgPreview,'blocked');
});
