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
  writeFileSync(entry,`export * from ${JSON.stringify(join(root,'frontend/integration/network-overlay-live-facts.ts'))};\nexport * from ${JSON.stringify(join(root,'frontend/integration/network-collector.ts'))};\nexport {parseLosslessJson} from ${JSON.stringify(join(root,'frontend/src/numeric/lossless-json.ts'))};`);
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},minify:false}});
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk'&&o.isEntry).code);
  const {decodeNetworkLiveFacts,applyNetworkLiveFacts,parseLosslessJson,decodeNetworkCollectorResults,decodeNetworkCollectorAction,readNetworkCollectorResults,requestNetworkCollectorAction}=await import(pathToFileURL(modulePath).href);
  const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha='a'.repeat(64),at='2026-01-01T00:00:00Z';
  const source={workspaceId:U(1),homeId:U(2),sourceInstanceId:U(3),collectionId:'synthetic',sourceKind:'network-device',externalId:'source-a'};
  const live={status:'available',source,addresses:['','192.0.2.1'],observedState:[{id:'observation',kind:'state',value:{state:'observed',count:7},factAt:at,sourceSnapshotAt:at,retrievedAt:at,vantage:'synthetic',invalidatedAt:null,freshness:'recent'}],lastSeenAt:null,sourceSnapshotAt:at,retrievedAt:at,freshness:'recent'};
  const raw={schema:'houseatlas.network-overlay-live-facts.v2',sceneOriginalSha256:sha,devices:[{id:'documentary-a',liveFacts:live}]};
  const decode=v=>decodeNetworkLiveFacts(parseLosslessJson(JSON.stringify(v)),sha,U(1),U(2));
  const data={viewKey:'synthetic',source:{},devices:[{id:'documentary-a',place:{sourceRoomId:'reviewed-room'}},{id:'unjoined'}],links:[],endpoints:[]};
  assert.equal(applyNetworkLiveFacts(data,undefined),data); // legacy frame and saved shape
  const joined=applyNetworkLiveFacts(data,decode(raw));
  assert.deepEqual(joined.devices[0].liveFacts.addresses,['','192.0.2.1']);assert.equal(joined.devices[0].place,data.devices[0].place);
  assert.equal(JSON.parse(JSON.stringify(joined)).devices[0].liveFacts.observedState[0].value.count,7);
  assert.equal(joined.devices[1],data.devices[1]);assert.equal('liveFacts' in joined.devices[1],false);
  const measured=structuredClone(raw);Object.assign(measured.devices[0].liveFacts,{latencyMs:2.5,loss:0,recentSeries:[{hour:at,latencyMs:3,loss:0.25}]});
  assert.equal(decode(measured).devices[0].liveFacts.latencyMs,2.5);
  const withheld=structuredClone(measured);Object.assign(withheld.devices[0].liveFacts,{status:'unknown',freshness:'unknown',observedState:null,lastSeenAt:null,latencyMs:null,loss:null,recentSeries:[],measurementReason:'inventory-revision-mismatch'});
  assert.equal(decode(withheld).devices[0].liveFacts.measurementReason,'inventory-revision-mismatch');

  assert.equal(applyNetworkLiveFacts(data,decode(measured)).devices[0].liveFacts.recentSeries[0].loss,0.25);
  const noReply=structuredClone(measured);noReply.devices[0].liveFacts.latencyMs=null;noReply.devices[0].liveFacts.loss=1;noReply.devices[0].liveFacts.observedState[0].value={state:'no-reply'};
  assert.equal(decode(noReply).devices[0].liveFacts.status,'available');
  for(const mutate of [v=>v.loss=1.1,v=>v.latencyMs=-1,v=>delete v.loss,v=>v.recentSeries=Array(49).fill(v.recentSeries[0]),v=>v.recentSeries.push(v.recentSeries[0])]) {
    const bad=structuredClone(measured);mutate(bad.devices[0].liveFacts);assert.throws(()=>decode(bad));
  }
  const stale=structuredClone(raw);stale.devices[0].liveFacts.status='stale';stale.devices[0].liveFacts.freshness='stale';stale.devices[0].liveFacts.observedState[0].freshness='stale';assert.equal(decode(stale).devices[0].liveFacts.status,'stale');
  const absent=structuredClone(raw);absent.devices[0].liveFacts={...live,status:'absent',addresses:null,observedState:null,freshness:'unknown'};assert.equal(decode(absent).devices[0].liveFacts.addresses,null);
  for (const mutate of [v=>v.sceneOriginalSha256='b'.repeat(64),v=>v.devices.push(v.devices[0]),v=>v.devices[0].liveFacts.source.homeId=U(99),v=>v.devices[0].liveFacts.addresses=Array.from({length:33},(_,i)=>`192.0.2.${i}`),v=>v.devices[0].liveFacts.extra=true,v=>v.devices[0].liveFacts.retrievedAt='not-a-date',v=>v.devices=Array.from({length:513},(_,i)=>({...v.devices[0],id:`d-${i}`}))]) {
    const bad=structuredClone(raw);mutate(bad);assert.throws(()=>decode(bad));
  }
  assert.throws(()=>applyNetworkLiveFacts({...data,devices:[]},decode(raw)));
  const speed={state:'measured',recordedAt:at,downloadBitsPerSecond:12000000,uploadBitsPerSecond:3000000,latencyMs:4,reason:null};
  const result={status:'available',retrievedAt:at,inventoryRevision:1,servedInventoryRevision:1,measurementReason:null,results:{version:1,speed:{latest:speed,recent:[speed]},wifi:{latest:{state:'unavailable',recordedAt:at,networks:null,reason:'no-dependable-unprivileged-scanner'}},actions:[]}};
  const resultDecode=v=>decodeNetworkCollectorResults(parseLosslessJson(JSON.stringify(v)));
  assert.equal(resultDecode(result).results.speed.latest.downloadBitsPerSecond,12000000);
  assert.equal(resultDecode(result).results.wifi.latest.networks,null);
  const corrected=structuredClone(result);corrected.results.speed.recent.push({...speed,recordedAt:'2026-01-01T00:01:00Z'});
  assert.equal(resultDecode(corrected).results.speed.recent[1].recordedAt,'2026-01-01T00:01:00Z');

  assert.equal(resultDecode({...result,status:'unknown',results:null,retrievedAt:null}).status,'unknown');
  for(const mutate of [v=>v.results.version=2,v=>v.results.speed.latest.downloadBitsPerSecond=-1,v=>v.results.speed.recent=Array(31).fill(speed),v=>v.results.wifi.latest.state='measured',v=>v.inventoryRevision=1.5]) {const bad=structuredClone(result);mutate(bad);assert.throws(()=>resultDecode(bad));}
  const complete={status:'completed',collectorStatus:200,result:{version:1,kind:'speed',recordedAt:at,result:speed}};
  const actionDecode=v=>decodeNetworkCollectorAction(parseLosslessJson(JSON.stringify(v)));
  assert.equal(actionDecode(complete).result.result.uploadBitsPerSecond,3000000);
  for(const v of [{status:'busy',collectorStatus:409,reason:'busy'},{status:'refused',reason:'inventory-revision-mismatch'},{status:'timeout',reason:'outcome-unknown'},{status:'unavailable'},{status:'unknown',reason:'invalid-collector-response'}]) assert.equal(actionDecode(v).status,v.status);
  assert.throws(()=>actionDecode({...complete,collectorStatus:201}));
  const scope={workspaceId:U(1),homeId:U(2),sourceInstanceId:U(3),collectionId:'inventory / example'};
  let reads=0,posts=0;
  const transport=async(url,init)=>{assert(url.endsWith('?collection=inventory%20%2F%20example'));assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');if(init.method==='POST'){posts++;assert.equal(init.headers['X-Atlas-CSRF'],'generated-csrf');assert.deepEqual(JSON.parse(init.body),{kind:'speed'});return new Response(JSON.stringify(complete));} reads++;return new Response(JSON.stringify(result));};
  assert.equal((await readNetworkCollectorResults(scope,transport)).status,'available');
  assert.equal((await requestNetworkCollectorAction(scope,{kind:'speed'},'generated-csrf',transport)).status,'completed');
  assert.deepEqual([reads,posts],[1,1]);
  console.log('PASS collector results GET and explicit action POST: strict typed decoders and fake transport, no network');
  console.log('PASS Network live-facts v2: joined, unjoined/legacy, stale, absent, ambiguity, digest/scope and bounds');
} finally {rmSync(scratch,{recursive:true,force:true});}
