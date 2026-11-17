/** Generated decoder contracts only; no browser, source, network or native authority. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'vite';
assert.equal(process.version,'v26.10.0');
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const scratch=mkdtempSync(join(tmpdir(),'network-live-facts-'));
try {
  const entry=join(scratch,'entry.ts');
  writeFileSync(entry,`export * from ${JSON.stringify(join(root,'frontend/integration/network-overlay-live-facts.ts'))};\nexport {parseLosslessJson} from ${JSON.stringify(join(root,'frontend/src/numeric/lossless-json.ts'))};`);
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},minify:false}});
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk'&&o.isEntry).code);
  const {decodeNetworkLiveFacts,applyNetworkLiveFacts,parseLosslessJson}=await import(pathToFileURL(modulePath).href);
  const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha='a'.repeat(64),at='2026-01-01T00:00:00Z';
  const source={workspaceId:U(1),homeId:U(2),sourceInstanceId:U(3),collectionId:'synthetic',sourceKind:'network-device',externalId:'source-a'};
  const live={status:'available',source,addresses:['192.0.2.1'],observedState:[{id:'observation',kind:'state',value:{state:'observed',count:7},factAt:at,sourceSnapshotAt:at,retrievedAt:at,vantage:'synthetic',invalidatedAt:null,freshness:'recent'}],lastSeenAt:null,sourceSnapshotAt:at,retrievedAt:at,freshness:'recent'};
  const raw={schema:'houseatlas.network-overlay-live-facts.v2',sceneOriginalSha256:sha,devices:[{id:'documentary-a',liveFacts:live}]};
  const decode=v=>decodeNetworkLiveFacts(parseLosslessJson(JSON.stringify(v)),sha,U(1),U(2));
  const data={viewKey:'synthetic',source:{},devices:[{id:'documentary-a',place:{sourceRoomId:'reviewed-room'}},{id:'unjoined'}],links:[],endpoints:[]};
  assert.equal(applyNetworkLiveFacts(data,undefined),data); // legacy frame and saved shape
  const joined=applyNetworkLiveFacts(data,decode(raw));
  assert.deepEqual(joined.devices[0].liveFacts.addresses,['192.0.2.1']);assert.equal(joined.devices[0].place,data.devices[0].place);
  assert.equal(JSON.parse(JSON.stringify(joined)).devices[0].liveFacts.observedState[0].value.count,7);
  assert.equal(joined.devices[1],data.devices[1]);assert.equal('liveFacts' in joined.devices[1],false);
  const stale=structuredClone(raw);stale.devices[0].liveFacts.status='stale';stale.devices[0].liveFacts.freshness='stale';stale.devices[0].liveFacts.observedState[0].freshness='stale';assert.equal(decode(stale).devices[0].liveFacts.status,'stale');
  const absent=structuredClone(raw);absent.devices[0].liveFacts={...live,status:'absent',addresses:null,observedState:null,freshness:'unknown'};assert.equal(decode(absent).devices[0].liveFacts.addresses,null);
  for (const mutate of [v=>v.sceneOriginalSha256='b'.repeat(64),v=>v.devices.push(v.devices[0]),v=>v.devices[0].liveFacts.source.homeId=U(99),v=>v.devices[0].liveFacts.addresses=Array.from({length:33},(_,i)=>`192.0.2.${i}`),v=>v.devices[0].liveFacts.extra=true,v=>v.devices[0].liveFacts.retrievedAt='not-a-date',v=>v.devices=Array.from({length:513},(_,i)=>({...v.devices[0],id:`d-${i}`}))]) {
    const bad=structuredClone(raw);mutate(bad);assert.throws(()=>decode(bad));
  }
  assert.throws(()=>applyNetworkLiveFacts({...data,devices:[]},decode(raw)));
  console.log('PASS Network live-facts v2: joined, unjoined/legacy, stale, absent, ambiguity, digest/scope and bounds');
} finally {rmSync(scratch,{recursive:true,force:true});}
