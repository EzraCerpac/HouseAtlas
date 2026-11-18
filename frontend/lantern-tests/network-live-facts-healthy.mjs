/** Generated decoder contracts, card wording and static markup only; no browser, source, network or native authority. */
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
  // Refresh and device/speed contracts share this existing healthy selection.
  writeFileSync(entry,`export * from ${JSON.stringify(join(root,'frontend/integration/network-overlay-live-facts.ts'))};\nexport * from ${JSON.stringify(join(root,'frontend/integration/network-collector.ts'))};\nexport {parseLosslessJson} from ${JSON.stringify(join(root,'frontend/src/numeric/lossless-json.ts'))}\nexport * from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/network-reachability.ts'))};\nexport * from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/network-tests.ts'))};\nexport {InternetSpeed,InternetSpeeds} from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/NetworkTests.tsx'))};\nexport {networkCardContent} from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/NetworkCard.tsx'))};\nexport * from ${JSON.stringify(join(root,'frontend/integration/network-inventory-refresh.ts'))};`);
  // React stays external so the components share the one React that renders them.
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},rolldownOptions:{external:['react','react/jsx-runtime'],output:{codeSplitting:false}},minify:false}});
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk'&&o.isEntry).code
    .replaceAll(JSON.stringify('react'),JSON.stringify(new URL('../node_modules/react/index.js',import.meta.url).href))
    .replaceAll(JSON.stringify('react/jsx-runtime'),JSON.stringify(new URL('../node_modules/react/jsx-runtime.js',import.meta.url).href)));
  const {decodeNetworkLiveFacts,applyNetworkLiveFacts,parseLosslessJson,decodeNetworkCollectorResults,decodeNetworkCollectorAction,readNetworkCollectorResults,requestNetworkCollectorAction,reachability,reachabilityObservation,sparkline,REACHABILITY_KIND,
    createCollectorStore,outcomeText,rateText,speedText,speedSparkline,speedWithTests,latestSpeed,InternetSpeed,InternetSpeeds,networkCardContent,NOT_MEASURED_MISMATCH,refreshOutcomeText}=await import(pathToFileURL(modulePath).href);
  const {createElement}=await import(new URL('../node_modules/react/index.js',import.meta.url).href);
  const {renderToStaticMarkup}=await import(new URL('../node_modules/react-dom/server.node.js',import.meta.url).href);
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
  const result={status:'available',retrievedAt:at,inventoryRevision:1,servedInventoryRevision:1,measurementReason:null,mayRefresh:false,reviewedInventoryRevision:1,needsReview:false,results:{version:1,speed:{latest:speed,recent:[speed]},wifi:{latest:{state:'unavailable',recordedAt:at,networks:null,reason:'no-dependable-unprivileged-scanner'}},actions:[]}};
  const resultDecode=v=>decodeNetworkCollectorResults(parseLosslessJson(JSON.stringify(v)));
  assert.equal(resultDecode(result).results.speed.latest.downloadBitsPerSecond,12000000);
  assert.equal(resultDecode(result).results.wifi.latest.networks,null);
  assert.equal(resultDecode({...result,mayRefresh:true}).mayRefresh,true);
  assert.equal(resultDecode({...result,inventoryRevision:43,reviewedInventoryRevision:42,needsReview:true}).needsReview,true);
  assert.throws(()=>resultDecode({...result,inventoryRevision:43,reviewedInventoryRevision:42,needsReview:false}));
  assert.throws(()=>resultDecode({...result,reviewedInventoryRevision:null}));
  assert.throws(()=>resultDecode({...result,mayRefresh:'yes'}));
  const {decodeNetworkInventoryRefresh,requestNetworkInventoryRefresh,requestNetworkInventoryRevalidation}=await import(pathToFileURL(modulePath).href);
  const refreshCache={status:'fresh',lastSuccessfulFetchAt:at,lastAttemptAt:at,errorCode:null};
  const refreshed={status:'refreshed',inventoryRevision:43,cache:refreshCache};
  const refreshDecode=v=>decodeNetworkInventoryRefresh(parseLosslessJson(JSON.stringify(v)));
  const needsReview={status:'needs-review',reviewedInventoryRevision:42,collectorInventoryRevision:43};
  assert.deepEqual(refreshDecode(needsReview),needsReview);
  assert.throws(()=>refreshDecode({...needsReview,collectorInventoryRevision:42}));
  assert.throws(()=>refreshDecode({...needsReview,reviewedInventoryRevision:null}));
  for(const field of ['reviewedInventoryRevision','collectorInventoryRevision']) {
    const raw=JSON.stringify(needsReview).replace(`"${field}":${needsReview[field]}`,`"${field}":1.0000000000000001`);
    assert.throws(()=>decodeNetworkInventoryRefresh(parseLosslessJson(raw)));
  }
  for(const status of ['refreshed','unchanged']) assert.equal(refreshDecode({...refreshed,status}).inventoryRevision,43);
  for(const v of [{status:'running'},{status:'not-configured'},{status:'refused',reason:'not-approved'},{status:'failed',reason:'transport',quarantined:false},{status:'failed',reason:'auth',quarantined:true,cache:{...refreshCache,status:'access-revoked',errorCode:'auth'}}]) assert.equal(refreshDecode(v).status,v.status);
  for(const v of [{...refreshed,inventoryRevision:-1},{...refreshed,inventoryRevision:null},{...refreshed,extra:true},{status:'failed',reason:'transport'},{status:'running',inventoryRevision:1},{...refreshed,cache:{...refreshCache,lastAttemptAt:'bad'}}]) assert.throws(()=>refreshDecode(v));
  for(const token of ['1.0000000000000001','9007199254740992']) assert.throws(()=>decodeNetworkInventoryRefresh(parseLosslessJson(JSON.stringify(refreshed).replace('"inventoryRevision":43',`"inventoryRevision":${token}`))));
  const refreshCalls=[];
  const refreshScope={workspaceId:U(1),homeId:U(2),sourceInstanceId:U(3),collectionId:'inventory / ?'};
  const refreshedResult=await requestNetworkInventoryRefresh(refreshScope,'synthetic-csrf',async (url,init)=>{refreshCalls.push([url,init]);return new Response(JSON.stringify(refreshed));});
  assert.equal(refreshedResult.status,'refreshed');assert.equal(refreshCalls.length,1);
  assert.equal(refreshCalls[0][0],`/api/atlas/providers/network/workspaces/${U(1)}/homes/${U(2)}/sources/${U(3)}/refresh?collection=inventory%20%2F%20%3F`);
  assert.equal(refreshCalls[0][1].method,'POST');assert.equal(refreshCalls[0][1].headers['X-Atlas-CSRF'],'synthetic-csrf');assert.equal(refreshCalls[0][1].credentials,'same-origin');assert.equal(refreshCalls[0][1].body,undefined);
  const recoveryCalls=[];
  assert.equal((await requestNetworkInventoryRevalidation(refreshScope,'synthetic-csrf',async (url,init)=>{recoveryCalls.push([url,init]);return new Response(JSON.stringify(refreshed));})).status,'refreshed');
  assert.equal(recoveryCalls.length,1);assert.equal(recoveryCalls[0][0],refreshCalls[0][0]+'&revalidate=true');
  assert.equal(recoveryCalls[0][1].method,'POST');assert.equal(recoveryCalls[0][1].headers['X-Atlas-CSRF'],'synthetic-csrf');assert.equal(recoveryCalls[0][1].body,undefined);
  let refusedCalls=0;
  await assert.rejects(()=>requestNetworkInventoryRefresh(refreshScope,'synthetic-csrf',async()=>{refusedCalls++;return new Response('',{status:403});}));assert.equal(refusedCalls,1);
  for(const field of ['inventoryRevision','servedInventoryRevision']) {
    for(const token of ['1.0000000000000001','9007199254740991.1','9007199254740992','-0.00000000000000001']) {
      const raw=JSON.stringify(result).replace(`"${field}":1`, `"${field}":${token}`);
      assert.throws(()=>decodeNetworkCollectorResults(parseLosslessJson(raw)));
    }
    assert.equal(decodeNetworkCollectorResults(parseLosslessJson(JSON.stringify(result).replace(`"${field}":1`, `"${field}":1.0`)))[field],1);
  }

  const corrected=structuredClone(result);corrected.results.speed.recent.push({...speed,recordedAt:'2026-01-01T00:01:00Z'});
  assert.equal(resultDecode(corrected).results.speed.recent[1].recordedAt,'2026-01-01T00:01:00Z');

  assert.equal(resultDecode({...result,status:'unknown',results:null,retrievedAt:null}).status,'unknown');
  for(const mutate of [v=>v.results.version=2,v=>v.results.speed.latest.downloadBitsPerSecond=-1,v=>v.results.speed.recent=Array(31).fill(speed),v=>v.results.wifi.latest.state='measured',v=>v.inventoryRevision=1.5]) {const bad=structuredClone(result);mutate(bad);assert.throws(()=>resultDecode(bad));}
  const complete={status:'completed',collectorStatus:200,result:{version:1,kind:'speed',recordedAt:at,result:speed}};
  const actionDecode=v=>decodeNetworkCollectorAction(parseLosslessJson(JSON.stringify(v)));
  assert.equal(actionDecode(complete).result.result.uploadBitsPerSecond,3000000);
  for(const v of [{status:'busy',collectorStatus:409,reason:'busy'},{status:'refused',collectorStatus:409,reason:'inventory-revision-mismatch'},{status:'timeout',reason:'outcome-unknown'},{status:'unavailable'},{status:'unknown',reason:'invalid-collector-response'}]) assert.equal(actionDecode(v).status,v.status);
  assert.throws(()=>actionDecode({...complete,collectorStatus:201}));
  const pingEntry={kind:'ping',deviceId:'device-example',inventoryRevision:1,recordedAt:at,result:{state:'reachable',latencyMs:2,loss:0,measuredAt:at,recordedAt:at,reason:null}};
  assert.equal(actionDecode({...complete,result:{version:1,...pingEntry}}).result.inventoryRevision,1);
  const history=structuredClone(result);history.results.actions=[pingEntry];
  assert.equal(resultDecode(history).results.actions[0].inventoryRevision,1);
  assert.throws(()=>decodeNetworkCollectorResults(parseLosslessJson(JSON.stringify(history).replace(/"inventoryRevision":1/g,'"inventoryRevision":1.0000000000000001'))));

  const scope={workspaceId:U(1),homeId:U(2),sourceInstanceId:U(3),collectionId:'inventory / example'};
  let reads=0,posts=0;
  const transport=async(url,init)=>{assert(url.endsWith('?collection=inventory%20%2F%20example'));assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');if(init.method==='POST'){posts++;assert.equal(init.headers['X-Atlas-CSRF'],'generated-csrf');assert.deepEqual(JSON.parse(init.body),{kind:'speed'});return new Response(JSON.stringify(complete));} reads++;return new Response(JSON.stringify(result));};
  assert.equal((await readNetworkCollectorResults(scope,transport)).status,'available');
  assert.equal((await requestNetworkCollectorAction(scope,{kind:'speed'},'generated-csrf',transport)).status,'completed');
  assert.deepEqual([reads,posts],[1,1]);
  console.log('PASS collector results GET and explicit action POST: strict typed decoders and fake transport, no network');
  // Reachability row: wording, absent/null values, freshness and series gaps, from decoded frames.
  const reach=(state,freshness='recent',extra={})=>{const v=structuredClone(measured);Object.assign(v.devices[0].liveFacts,extra);
    if(state)v.devices[0].liveFacts.observedState.push({id:'reach',kind:REACHABILITY_KIND,value:{state},factAt:'2026-01-01T00:30:00Z',sourceSnapshotAt:at,retrievedAt:at,vantage:'synthetic',invalidatedAt:null,freshness});
    if(freshness!=='recent'){v.devices[0].liveFacts.status='stale';v.devices[0].liveFacts.freshness=freshness==='invalidated'?'invalidated':'stale';v.devices[0].liveFacts.observedState[0].freshness='stale';}
    return reachability(decode(v).devices[0].liveFacts);};
  assert.equal(reachability(decode(raw).devices[0].liveFacts),null,'no collector fields: no row');
  const up=reach('reachable');
  assert.equal(up.state,'Reachable');assert.deepEqual(up.metrics,['2.5 ms','0% loss']);assert.equal(up.measuredAt,'2026-01-01T00:30:00Z');assert.equal(up.old,false);
  const down=reach('no-reply','recent',{latencyMs:null,loss:1});
  assert.equal(down.state,'No reply');assert.deepEqual(down.metrics,['100% loss'],'null latency is left out, not 0 ms');
  const none=reach(null,'recent',{latencyMs:null,loss:null});
  assert.equal(none.state,'Not measured');assert.deepEqual(none.metrics,[],'null loss is left out, not 0%');assert.equal(none.measuredAt,null);
  assert.equal(reach('reachable','stale').state,'Reachable · stale');assert.equal(reach('no-reply','invalidated').state,'No reply · invalidated');
  assert.equal(reach('reachable','stale').measuredAt,'2026-01-01T00:30:00Z','a stale reading keeps its date');
  const unknownFresh=structuredClone(measured);Object.assign(unknownFresh.devices[0].liveFacts,{status:'stale',freshness:'unknown'});
  unknownFresh.devices[0].liveFacts.observedState=[{...unknownFresh.devices[0].liveFacts.observedState[0],kind:REACHABILITY_KIND,value:{state:'reachable'}}];
  assert.equal(reachability(decode(unknownFresh).devices[0].liveFacts).state,'Reachable · freshness unknown');
  assert.equal(reach('reachable','recent',{loss:0.004}).metrics[1],'<1% loss');
  const H=i=>new Date(Date.parse(at)+i*3600000).toISOString().replace('.000Z','Z');
  const gappy=reach('reachable','recent',{recentSeries:[0,1,2,5,6,7,9].map(i=>({hour:H(i),latencyMs:i===6?null:2+i,loss:i===6?1:i===1?0.5:0})).concat([{hour:H(10),latencyMs:null,loss:null},{hour:H(11),latencyMs:3,loss:0}])});
  const spark=sparkline(gappy.series);
  assert.equal(spark.line.match(/M/g).length,1,'only hours 0-2 join; 3-4 missing, 6 no reply, 8 missing and 10 unmeasured break the line');
  assert.equal(spark.line.match(/L/g).length,2);
  assert.equal(spark.dots.length,4,'hours 5, 7, 9 and 11 stand alone');
  assert.deepEqual(spark.ticks.map(t=>t[1]<24),[true,true],'loss ticks for hours 1 and 6 only');
  assert.match(spark.label,/^Hourly latency, 1 Jan 2026, 00:00 UTC to 1 Jan 2026, 11:00 UTC: 8 of 12 hours measured, 2 with loss$/);
  assert.equal(sparkline([]),null);
  // A measured state without the collector trio still shows the row, with no series to draw.
  const stateOnly=structuredClone(raw);stateOnly.devices[0].liveFacts.observedState.push({id:'reach',kind:REACHABILITY_KIND,value:{state:'no-reply'},factAt:at,sourceSnapshotAt:at,retrievedAt:at,vantage:'synthetic',invalidatedAt:null,freshness:'recent'});
  const lone=reachability(decode(stateOnly).devices[0].liveFacts);
  assert.equal(lone.state,'No reply');assert.deepEqual(lone.metrics,[]);assert.equal(sparkline(lone.series),null);
  // Worded observation lines: reachability in words, any other observation unchanged.
  const [other,measuredObs]=decode(stateOnly).devices[0].liveFacts.observedState;
  assert.equal(reachabilityObservation(measuredObs),'Reachability: No reply');assert.equal(reachabilityObservation(other),null);
  // One measured hour is one dot, never a line.
  const one=sparkline([{hour:at,latencyMs:3,loss:0}]);assert.equal(one.line,'');assert.equal(one.dots.length,1);assert.equal(one.ticks.length,0);
  assert.match(sparkline([{hour:at,latencyMs:null,loss:null}]).label,/: 0 of 1 hour measured$/);
  console.log('PASS Network live-facts v2: joined, unjoined/legacy, stale, absent, ambiguity, digest/scope and bounds; reachability wording, nulls, freshness and series gaps');
  // Withheld for a changed device list: the row says why, never a bare "Not measured".
  assert.equal(reachability(decode(withheld).devices[0].liveFacts).state,NOT_MEASURED_MISMATCH);
  // The reason without any measurement field (a shape the decoder admits) keeps the row and its reason.
  { const {recentSeries,latencyMs,loss,...bare}=decode(withheld).devices[0].liveFacts,only=reachability({...bare,observedState:null});
    assert.equal(only.state,NOT_MEASURED_MISMATCH);assert.deepEqual([only.metrics,only.series,only.measuredAt],[[],[],null]);
    assert.equal(reachability({...bare,observedState:null,measurementReason:null}),null,'no reason and no measurement: no row'); }
  assert.equal(NOT_MEASURED_MISMATCH,'Not measured: the device list changed and needs a refresh');

  // Network tests on the device card and internet speed in the Network key: a fake collector port only.
  const facts=decode(measured).devices[0].liveFacts,scopeOf=facts.source,tick=()=>new Promise(r=>setTimeout(r,0));
  const deviceCard=(liveFacts,collector,storedAt)=>{
    const device={id:'documentary-a',label:'Generated device',kind:'router',mobility:'fixed',confidence:'recorded',notes:'',place:null,liveFacts};
    const content=networkCardContent({focus:{kind:'device',key:'d'},connections:{nodes:[{key:'d',graphKey:'g',kind:'device',id:device.id,label:device.label,device,endpoint:null,anchors:[],placementReason:'no-reviewed-room'}],connections:[]},
      graphs:[{key:'g',data:{source:{label:'Generated network',revision:'1',recordedAt:null,retrievedAt:null,status:'recorded',notes:''}},qualification:'Generated',...(storedAt?{storedAt}:{})}],
      roomName:()=>({room:'',floor:''}),choose:()=>{},showInGraph:()=>{},collector});
    return renderToStaticMarkup(createElement('div',null,content.body));
  };
  const fakePort=(answer,role={editor:true})=>{const port={reads:0,posts:[],pending:[],canTest:()=>role.editor,
    read:async(scope,signal)=>{port.reads++;assert(signal instanceof AbortSignal);assert.deepEqual([scope.workspaceId,scope.homeId,scope.sourceInstanceId,scope.collectionId],[U(1),U(2),U(3),'synthetic']);if(answer instanceof Error)throw answer;return answer;},
    act:(scope,action)=>{port.posts.push(action);return new Promise((resolve,reject)=>port.pending.push({resolve,reject}));}};return port;};
  const plain=deviceCard(facts,null);
  assert(!plain.includes('<dt>Test</dt>'),'no collector: the card is unchanged');
  const role={editor:false},port=fakePort(resultDecode(result),role),store=createCollectorStore(port,()=>'2026-01-01T02:00:00Z'),collector={port,store};
  assert.equal(port.reads,0,'creating the store reads nothing; plain browsing sends no request');
  assert.equal(deviceCard(facts,collector),plain,'a viewer sees no test control');
  store.ensure(scopeOf);store.ensure({...scopeOf});await tick();await tick();
  assert.equal(port.reads,1,'one results GET per scope, reused by later cards and the key');
  assert.equal(deviceCard(facts,collector),plain,'a viewer still sees no test control after results are read');
  role.editor=true;
  const editorCard=deviceCard(facts,collector);
  for(const text of ['<dt>Test</dt>','>Ping</button>','aria-label="Port"','<option value="443" selected="">443</option>','>Check port</button>','role="status"']) assert(editorCard.includes(text),`editor card shows ${text}`);
  assert.equal(deviceCard(facts,collector,'2026-01-01T00:05:00Z'),deviceCard(facts,null,'2026-01-01T00:05:00Z'),'a stored copy offers no test');
  const listedNot={...facts,status:'absent'};assert.equal(deviceCard(listedNot,collector),deviceCard(listedNot,null),'a device the source no longer lists offers no test');
  for(const answer of [{status:'unavailable'},{...result,status:'unknown',results:null,retrievedAt:null},new Error('refused')]){
    const other=fakePort(answer instanceof Error?answer:resultDecode(answer)),owned=createCollectorStore(other);owned.ensure(scopeOf);await tick();await tick();
    assert.equal(deviceCard(facts,{port:other,store:owned}),plain,'no collector results: the card is exactly as without the collector');
    assert.equal(renderToStaticMarkup(createElement(InternetSpeed,{collector:{port:other,store:owned},scope:scopeOf,label:null})),'','no collector results: no speed block');
    owned.dispose();
  }
  // One request at a time; never retried; the answer replaces "running" with its own time.
  assert.equal(store.run(scopeOf,{kind:'ping',deviceId:'source-a'}),true);
  assert.equal(store.run(scopeOf,{kind:'port',deviceId:'source-a',port:443}),false,'a second press while one runs sends nothing');
  assert.equal(store.run(scopeOf,{kind:'speed'}),false);
  assert.deepEqual(port.posts,[{kind:'ping',deviceId:'source-a'}]);
  const runningCard=deviceCard(facts,collector);
  assert(runningCard.includes('Running ping…')&&runningCard.match(/aria-disabled="true"/g).length===2,'running: said, and both buttons unavailable');
  assert(renderToStaticMarkup(createElement(InternetSpeed,{collector,scope:scopeOf,label:null})).includes('Another test is running'));
  port.pending[0].resolve(actionDecode({...complete,result:{version:1,...pingEntry}}));await tick();await tick();
  const answered=deviceCard(facts,collector);
  assert(answered.includes('Ping: Reachable, 2.0 ms')&&answered.includes('recorded <time'),'completed ping reads its result and recorded time');
  assert(!answered.includes('aria-disabled="true"'));
  assert.equal(store.run(scopeOf,{kind:'port',deviceId:'source-a',port:22}),true);port.pending[1].reject(new Error('lost'));await tick();await tick();
  assert(deviceCard(facts,collector).includes('Port 22: Outcome unknown, no readable answer'),'a failed request is unknown, never success');
  assert.equal(port.posts.length,2,'no automatic retry');
  // Every answer in words.
  const say=(response,action={kind:'ping',deviceId:'source-a'})=>outcomeText({action,response:response&&actionDecode(response),answeredAt:'2026-01-01T03:00:00Z'});
  const ping=result=>({...complete,result:{version:1,...pingEntry,result}});
  assert.deepEqual(say(ping({state:'no-reply',latencyMs:null,loss:1,measuredAt:at,recordedAt:at,reason:null})),{text:'Ping: No reply',at,recorded:true});
  assert.equal(say(ping({state:'not-measured',latencyMs:null,loss:null,measuredAt:null,recordedAt:at,reason:'not-at-home'})).text,'Ping: Not measured, the collector is not on the home network');
  const port443={kind:'port',deviceId:'source-a',port:443},portEntry=state=>({...complete,result:{version:1,kind:'port',deviceId:'source-a',port:443,inventoryRevision:1,recordedAt:at,result:state}});
  assert.equal(say(portEntry({state:'open',reason:null}),port443).text,'Port 443: Open');
  assert.equal(say(portEntry({state:'unknown',reason:'command-unavailable'}),port443).text,'Port 443: Unknown, the test command is unavailable');
  assert.equal(say(complete,{kind:'speed'}).text,'Speed test: 12 Mbit/s down · 3.0 Mbit/s up · 4.0 ms');
  const failedSpeed={...complete,result:{...complete.result,result:{...speed,state:'failed',downloadBitsPerSecond:null,uploadBitsPerSecond:null,latencyMs:null,reason:'tool-error'}}};
  assert.equal(say(failedSpeed,{kind:'speed'}).text,'Speed test: Failed, the speed tool reported an error');
  const partial={...complete,result:{...complete.result,result:{...speed,state:'unknown',uploadBitsPerSecond:null,reason:'missing-fields'}}};
  assert.equal(say(partial,{kind:'speed'}).text,'Speed test: Unknown, the speed tool left out values · 12 Mbit/s down · 4.0 ms','null upload left out, not 0');
  for(const [response,text] of [[{status:'busy',collectorStatus:409,reason:'busy'},'Ping: Busy, another test is running or just finished'],
    [{status:'refused',collectorStatus:409,reason:'inventory-revision-mismatch'},'Ping: Refused, the device list changed and needs a refresh'],
    [{status:'refused',reason:'port-not-allowed'},'Ping: Refused, this port is not allowed on this collector'],
    [{status:'timeout',reason:'outcome-unknown'},'Ping: Timed out, outcome unknown'],
    [{status:'unknown',reason:'collector-unavailable'},'Ping: Outcome unknown, the collector did not answer'],
    [{status:'unavailable'},'Ping: Unavailable, no collector for this source'],[null,'Ping: Outcome unknown, no readable answer']]) {
    assert.deepEqual(say(response),{text,at:'2026-01-01T03:00:00Z',recorded:false},`${response?.status} keeps the browser's answer time and never reads as a result`);
  }
  // Speeds: Mbit/s, Gbit/s from 1000 Mbit/s; null is never zero.
  assert.deepEqual([12e6,8.44e6,999.6e6,1.04e9,12.5e9,5e4,0].map(rateText),['12 Mbit/s','8.4 Mbit/s','1.00 Gbit/s','1.04 Gbit/s','12.5 Gbit/s','<0.1 Mbit/s','0.0 Mbit/s']);
  const night=(i,down=300e6)=>({...speed,recordedAt:new Date(Date.parse(at)+i*86400000).toISOString().replace('.000Z','Z'),downloadBitsPerSecond:down,...(down===null?{state:'failed',uploadBitsPerSecond:null,latencyMs:null,reason:'command-unavailable'}:{})});
  const runs=speedSparkline([night(5),night(0),night(1),night(3),night(4,null)]);
  assert.equal(runs.line.match(/M/g).length,1,'nights 0-1 join; the missed night 2 and the failed night 4 break the line');
  assert.equal(runs.dots.length,2,'nights 3 and 5 stand alone');
  assert.match(runs.label,/^Download per run, 1 Jan 2026, 00:00 UTC to 6 Jan 2026, 00:00 UTC: 4 of 5 runs measured$/);
  assert.equal(speedSparkline([]),null);
  // A failed or unknown run that kept a parsed download is still a gap, counted in M but not in N.
  const kept=(i,state,reason)=>({...night(i),state,reason});
  const unsure=speedSparkline([night(0),kept(1,'failed','tool-error'),night(2),kept(3,'unknown','missing-fields'),night(4)]);
  assert.equal(unsure.line,'','no two measured runs are adjacent, so nothing joins');assert.equal(unsure.dots.length,3);
  assert.match(unsure.label,/: 3 of 5 runs measured$/);
  // Latest is the newest measured run; a newer failed run is said in words, its value not shown as good.
  const failedNewest=kept(2,'failed','tool-error'),olderGood=night(1,250e6);
  assert.deepEqual(latestSpeed(failedNewest,[night(0),olderGood,failedNewest]),{measured:olderGood,unmeasured:failedNewest});
  assert.deepEqual(latestSpeed(olderGood,[night(0),olderGood]),{measured:olderGood,unmeasured:null});
  assert.deepEqual(latestSpeed(failedNewest,[failedNewest]),{measured:null,unmeasured:failedNewest});
  const failedBody=structuredClone(result);failedBody.results.speed={latest:failedNewest,recent:[night(0),olderGood,failedNewest]};
  const failedPort=fakePort(resultDecode(failedBody)),failedStore=createCollectorStore(failedPort);failedStore.ensure(scopeOf);await tick();await tick();
  const failedBlock=renderToStaticMarkup(createElement(InternetSpeed,{collector:{port:failedPort,store:failedStore},scope:scopeOf,label:null}));
  assert(failedBlock.includes('<dt>Last measured</dt><dd>250 Mbit/s down')&&failedBlock.includes('Newest run: Failed, the speed tool reported an error · recorded <time'),'last measured run, and the failed newest run in words');
  assert(!failedBlock.includes('300 Mbit/s'),'the failed run\'s retained value is not shown');failedStore.dispose();
  // The key's speed block: latest with its recorded time, retrieval, the Wi-Fi line, and the test for Editors only.
  const block=()=>renderToStaticMarkup(createElement(InternetSpeed,{collector,scope:scopeOf,label:null}));
  const editorBlock=block();
  for(const text of ['aria-label="Internet speed"','12 Mbit/s down · 3.0 Mbit/s up · 4.0 ms','recorded <time','<dt>Retrieved</dt>','>Test speed now</button>','<p class="ua-net-wifi">Wi-Fi scan unavailable on this collector</p>','role="img"']) assert(editorBlock.includes(text),`speed block shows ${text}`);
  // A completed measured speed test is the latest run, from its own answer: no second GET.
  assert.equal(store.run(scopeOf,{kind:'speed'}),true);
  const fresh={...speed,recordedAt:'2026-01-02T00:00:00Z',downloadBitsPerSecond:1.04e9};
  port.pending[2].resolve(actionDecode({...complete,result:{...complete.result,recordedAt:fresh.recordedAt,result:fresh}}));await tick();await tick();
  const testedBlock=block();
  assert(testedBlock.includes('1.04 Gbit/s down · 3.0 Mbit/s up · 4.0 ms')&&!testedBlock.includes('12 Mbit/s down'),'Latest shows the tested run');
  assert(testedBlock.includes('Speed test: Completed<span')&&testedBlock.match(/Gbit\/s/g).length===1,'the answer line does not repeat the values');
  assert.equal(port.reads,1,'no second results GET');
  // Later tests never erase an earlier run: a timeout adds nothing, a failed run is kept as a gap, another measured run adds a point.
  const speedAnswer=run=>actionDecode({...complete,result:{...complete.result,recordedAt:run.recordedAt,result:run}});
  const answerSpeed=async response=>{assert.equal(store.run(scopeOf,{kind:'speed'}),true);port.pending.at(-1).resolve(actionDecode(response));await tick();await tick();return block();};
  let later=await answerSpeed({status:'timeout',reason:'outcome-unknown'});
  assert(later.includes('<dt>Last measured</dt><dd>1.04 Gbit/s down')&&later.includes('Speed test: Timed out, outcome unknown'),'a timeout keeps the earlier tested run as Last measured');
  for(const response of [{status:'busy',collectorStatus:409,reason:'busy'},{status:'refused',reason:'observations-expired'},{status:'unavailable'}]) assert((await answerSpeed(response)).includes('<dt>Last measured</dt><dd>1.04 Gbit/s down'));
  const second={...speed,recordedAt:'2026-01-03T00:00:00Z',downloadBitsPerSecond:2e9};
  later=await answerSpeed(speedAnswer(second));
  assert(later.includes('<dt>Last measured</dt><dd>2.00 Gbit/s down')&&later.includes(': 3 of 3 runs measured'),'a second test keeps the first test\'s run in the history');
  const failedRun={...speed,state:'failed',recordedAt:'2026-01-04T00:00:00Z',downloadBitsPerSecond:9e8,reason:'tool-error'};
  later=await answerSpeed(speedAnswer(failedRun));
  assert(later.includes('<dt>Last measured</dt><dd>2.00 Gbit/s down')&&later.includes('Newest run: Failed, the speed tool reported an error')&&later.includes(': 3 of 4 runs measured'),'a failed tested run stays a gap and never becomes Last measured');
  assert(later.includes('Speed test: Failed, the speed tool reported an error · 900 Mbit/s down'),'its answer line still states the failure');
  assert.deepEqual(store.snapshot().speedRuns.get(JSON.stringify([U(1),U(2),U(3),'synthetic'])).map(run=>run.recordedAt),[fresh.recordedAt,second.recordedAt,failedRun.recordedAt]);
  assert.equal(port.reads,1,'still one results GET');
  // A full newest-first stored history keeps the 30 newest runs in time order when a test adds one.
  const full=Array.from({length:30},(_,i)=>night(29-i)),added=night(30),merged=speedWithTests({latest:full[0],recent:full},[added]).recent;
  assert.equal(merged.length,30);assert.equal(merged.at(-1),added);assert.equal(merged.at(-2),full[0],'the newest stored run is kept');
  assert(!merged.includes(full[29]),'the oldest stored run is dropped');assert.deepEqual(merged.map(run=>run.recordedAt),[...merged.map(run=>run.recordedAt)].sort());
  assert.equal(speedWithTests({latest:speed,recent:[speed]},[]).recent.length,1,'no tested runs: the stored runs as read');
  { const testedRun={...speed,recordedAt:'2026-01-05T00:00:00Z'},both=speedWithTests({latest:testedRun,recent:[speed,testedRun]},[{...testedRun}]);
    assert.equal(both.recent.length,2,'a tested run the re-read history already holds counts once');assert(both.recent.includes(testedRun),'the stored copy is kept'); }
  // A measured run followed by 30 failed ones leaves the chart's window but stays the last measured run.
  { const old=night(-1,200e6),good=night(0),fails=Array.from({length:30},(_,i)=>night(i+1,null)),after=speedWithTests({latest:old,recent:[old]},[good,...fails]);
    assert.equal(after.recent.length,30);assert(!after.recent.includes(good)&&!after.recent.includes(old));
    assert.deepEqual(latestSpeed(after.latest,after.recent),{measured:good,unmeasured:fails[29]});
    assert.match(speedSparkline(after.recent).label,/0 of 30 runs measured/); }
  // Several collector sources stay told apart, by collection where their source names repeat; one answering source needs no name.
  const otherScope={...scopeOf,collectionId:'second'},blocks=answers=>{const two={canTest:()=>false,read:async scope=>answers[scope.collectionId],act:()=>new Promise(()=>{})},owned=createCollectorStore(two);
    owned.ensure(scopeOf);owned.ensure(otherScope);return tick().then(tick).then(()=>renderToStaticMarkup(createElement(InternetSpeeds,{collector:{port:two,store:owned},rows:[{scope:scopeOf,label:'Generated network'},{scope:otherScope,label:'Generated network'}]})));};
  const both=await blocks({synthetic:resultDecode(result),second:resultDecode(result)});
  assert(both.includes('aria-label="Internet speed, Generated network · synthetic"')&&both.includes('aria-label="Internet speed, Generated network · second"'),'colliding source names keep their collection');
  const oneSource=await blocks({synthetic:resultDecode(result),second:{status:'unavailable'}});
  assert(oneSource.includes('aria-label="Internet speed"')&&!oneSource.includes('· second'),'one answering source: the short heading');
  // Two source instances with the same name and collection are numbered by source identity order; the identity is never shown.
  { const twinScope={...scopeOf,sourceInstanceId:scopeOf.sourceInstanceId.replace(/.$/,c=>c==='f'?'e':'f')},port={canTest:()=>false,read:async()=>resultDecode(result),act:()=>new Promise(()=>{})},owned=createCollectorStore(port);
    owned.ensure(scopeOf);owned.ensure(twinScope);await tick();await tick();
    const twinBlocks=renderToStaticMarkup(createElement(InternetSpeeds,{collector:{port,store:owned},rows:[{scope:twinScope,label:'Generated network'},{scope:scopeOf,label:'Generated network'}]}));
    const [first,second]=[scopeOf,twinScope].sort((a,b)=>a.sourceInstanceId<b.sourceInstanceId?-1:1);
    assert(twinBlocks.includes('aria-label="Internet speed, Generated network · synthetic · 1"')&&twinBlocks.includes('aria-label="Internet speed, Generated network · synthetic · 2"'),'same name and collection: numbered');
    assert(!twinBlocks.includes(first.sourceInstanceId)&&!twinBlocks.includes(second.sourceInstanceId),'no source identity in the markup'); }
  role.editor=false;const viewerBlock=block();
  assert(!viewerBlock.includes('Test speed now')&&!viewerBlock.includes('role="status"')&&viewerBlock.includes('Wi-Fi scan unavailable on this collector'),'a viewer reads speed without the test');
  const noWifi=structuredClone(result);noWifi.results.wifi.latest=null;noWifi.results.speed={latest:null,recent:[]};
  const quiet=fakePort(resultDecode(noWifi)),quietStore=createCollectorStore(quiet);quietStore.ensure(scopeOf);await tick();await tick();
  const quietBlock=renderToStaticMarkup(createElement(InternetSpeed,{collector:{port:quiet,store:quietStore},scope:scopeOf,label:null}));
  assert(quietBlock.includes('No speed run supplied')&&!quietBlock.includes('Wi-Fi')&&!quietBlock.includes('<svg'),'no runs supplied: said, no chart or Wi-Fi frame');
  store.dispose();assert.equal(store.run(scopeOf,{kind:'speed'}),false,'a dropped store sends nothing');assert.equal(port.posts.length,9);
  // A viewer's card says why reachability is withheld (from the frame's own facts) and reads no collector results.
  const viewerPort=fakePort(resultDecode(result),{editor:false}),viewerStore=createCollectorStore(viewerPort);
  const viewerCard=deviceCard(decode(withheld).devices[0].liveFacts,{port:viewerPort,store:viewerStore});
  assert(viewerCard.includes(NOT_MEASURED_MISMATCH)&&!viewerCard.includes('<dt>Test</dt>'),'viewer: withheld wording, no controls');
  assert.equal(viewerPort.reads,0,'viewer card: no collector GET needed for the wording');viewerStore.dispose();
  console.log('PASS Network tests and internet speed: viewer and absent collector show nothing, one GET per scope, one POST per press, every answer in words with its time, Mbit/Gbit and run gaps, Wi-Fi line, withheld wording for viewers too, a tested speed run as Latest');

  // Device-list refresh in the key's collector block: a fake port only, no browser or route.
  { const differ={...result,inventoryRevision:2,servedInventoryRevision:1,measurementReason:'inventory-revision-mismatch',mayRefresh:true,reviewedInventoryRevision:2,needsReview:false};
    const agreed={...differ,servedInventoryRevision:2,measurementReason:null},withheldFacts=decode(withheld).devices[0].liveFacts;
    const T0='2026-01-01T05:00:00Z',fetched='2026-01-01T04:59:00Z';
    // Results answer in turn (the last repeats); a read that is an Error fails.
    const mount=(reads,{refresh=true,editor=true}={})=>{
      const port={reads:0,posts:0,pending:[],canTest:()=>editor,act:()=>new Promise(()=>{}),
        read:async()=>{const v=reads[Math.min(port.reads++,reads.length-1)];if(v instanceof Error)throw v;return resultDecode(v);},
        ...(refresh?{refresh:()=>{port.posts++;return new Promise((resolve,reject)=>port.pending.push({resolve,reject}));}}:{})};
      const store=createCollectorStore(port,()=>T0),collector={port,store};
      return {port,store,collector,block:mismatches=>renderToStaticMarkup(createElement(InternetSpeed,{collector,scope:scopeOf,label:null,mismatches})),card:(storedAt,facts=withheldFacts)=>deviceCard(facts,collector,storedAt)};
    };
    const settle=async()=>{for(let i=0;i<4;i++)await tick();};
    const BUTTON='>Refresh device list</button>';
    // Who and when: only a refresh Editor named by the results, only while the lists differ, only with the route.
    for(const [reads,options,why] of [[[{...differ,mayRefresh:false}],{},'not a named refresh Editor (an ordinary Editor)'],[[{...differ,mayRefresh:false}],{editor:false},'a viewer'],
      [[{...result,mayRefresh:true}],{},'lists agree'],[[differ],{refresh:false},'no refresh route (stored or saved copy)']]) {
      const m=mount(reads,options);m.store.ensure(scopeOf);await settle();const html=m.block();
      assert(html.includes('<dt>Retrieved</dt>')&&!html.includes('Device list')&&!html.includes('Refresh device list'),`no refresh row: ${why}`);
      assert.equal(m.port.posts,0);m.store.dispose();
    }
    // Plain browsing sends nothing: the store, card and block read at most the existing one results GET.
    const m=mount([differ,agreed]);
    assert.equal(m.card().includes(NOT_MEASURED_MISMATCH),true);assert.deepEqual([m.port.reads,m.port.posts],[0,0],'a card sends no request');
    m.store.ensure(scopeOf);await settle();
    let html=m.block();
    for(const text of ['<dt>Device list</dt>','Changed, needs a refresh',BUTTON,'<dt>Retrieved</dt>','>Test speed now</button>','Wi-Fi scan unavailable on this collector']) assert(html.includes(text),`mismatch block shows ${text}`);
    assert(html.indexOf('<dt>Retrieved</dt>')<html.indexOf('<dt>Device list</dt>'),'beside the retrieval it refreshes');
    assert.deepEqual([m.port.reads,m.port.posts],[1,0],'rendering the control sends nothing');
    // One POST per press; pending says so and blocks a second press.
    assert.equal(m.store.refresh(scopeOf),true);assert.equal(m.store.refresh(scopeOf),false,'a second press while pending sends nothing');
    assert.equal(m.port.posts,1);html=m.block();
    assert(html.includes('>Refreshing device list…</button>')&&html.includes('aria-disabled="true">Refreshing'),'pending: said, and the control stays mounted but unavailable');
    // A refreshed answer re-reads once; the lists agree, so the control and the card's changed-list wording go.
    m.port.pending[0].resolve(refreshDecode({status:'refreshed',inventoryRevision:2,cache:{status:'fresh',lastSuccessfulFetchAt:fetched,lastAttemptAt:fetched,errorCode:null}}));await settle();
    assert.deepEqual([m.port.reads,m.port.posts],[2,1],'exactly one re-read after the success, and no retry');
    html=m.block();
    assert(!html.includes(BUTTON)&&!html.includes('Changed')&&html.includes('<dt>Device list</dt>')&&html.includes(`Refreshed<span class="ua-note">recorded <time`)&&html.includes(fetched),'after agreement: the answer with its recorded time, no control');
    const cleared=m.card();assert(!cleared.includes(NOT_MEASURED_MISMATCH)&&cleared.includes('<span class="ua-net-reach-state">Not measured</span>'),'the card drops the changed-list wording once the re-read agrees');
    assert(m.card('2026-01-01T00:05:00Z').includes(NOT_MEASURED_MISMATCH),'a stored copy keeps its own wording');
    // The suppression covers only facts read before the refresh's own fetch; a later frame's changed list is said again, and the control returns.
    assert(!m.block([withheldFacts.retrievedAt]).includes(BUTTON),'the reconciled frame brings nothing back');
    for(const later of ['2026-01-01T06:00:00Z',fetched,null]) {
      assert(m.card(undefined,{...withheldFacts,retrievedAt:later}).includes(NOT_MEASURED_MISMATCH),`a frame retrieved ${later??'at an unknown time'} keeps its changed-list wording`);
      const back=m.block([withheldFacts.retrievedAt,later]);assert(back.includes('Changed, needs a refresh')&&back.includes(BUTTON)&&back.includes('Refreshed<span'),'and the control comes back beside the earlier answer');
    }
    await settle();assert.deepEqual([m.port.reads,m.port.posts],[2,1],'no timer, poll or further read');m.store.dispose();
    // The re-read still differs (the list changed again) or fails: the control and the wording stay.
    // A re-read without results (failed, unknown during a poll, unavailable) keeps the earlier results, the control and the answer, unconfirmed.
    for(const [reread,text] of [[differ,'Refreshed, unchanged'],[new Error('lost'),'Refreshed, unchanged, state not confirmed'],
      [{...differ,status:'unknown',retrievedAt:null,results:null},'Refreshed, unchanged, state not confirmed'],[{status:'unavailable'},'Refreshed, unchanged, state not confirmed']]) {
      const k=mount([differ,reread]);k.store.ensure(scopeOf);await settle();k.store.refresh(scopeOf);
      k.port.pending[0].resolve(refreshDecode({status:'unchanged',inventoryRevision:1,cache:{status:'fresh',lastSuccessfulFetchAt:fetched,lastAttemptAt:fetched,errorCode:null}}));await settle();
      const out=k.block();assert(out.includes(BUTTON)&&out.includes('Changed, needs a refresh')&&out.includes(`${text}<span`),`${text}: control stays`);
      assert(!out.includes('aria-disabled="true">Refresh'),'available again after the re-read settles');
      assert(k.card().includes(NOT_MEASURED_MISMATCH));assert.deepEqual([k.port.reads,k.port.posts],[2,1],'exactly one re-read after unchanged, and no retry');k.store.dispose();
    }
    // Needs review: from the results, no control at all; from an answer, the control goes and nothing is re-read.
    { const r=mount([{...differ,reviewedInventoryRevision:1,needsReview:true}]);r.store.ensure(scopeOf);await settle();const out=r.block();
      assert(out.includes('Changed; it needs review before it can be refreshed')&&!out.includes('<button type="button" class="btn btn-small" aria-disabled="false">Refresh'),'review needed: said, no dead control');
      assert(!out.includes(BUTTON));r.store.dispose(); }
    { const r=mount([differ]);r.store.ensure(scopeOf);await settle();r.store.refresh(scopeOf);
      r.port.pending[0].resolve(refreshDecode({status:'needs-review',reviewedInventoryRevision:2,collectorInventoryRevision:3}));await settle();const out=r.block();
      assert(out.includes('Changed; it needs review before it can be refreshed')&&out.includes('Not refreshed, needs review<span class="ua-note">answered <time')&&!out.includes(BUTTON),'a needs-review answer removes the control');
      assert.deepEqual([r.port.reads,r.port.posts],[1,1],'no re-read for an answer that published nothing');assert(r.card().includes(NOT_MEASURED_MISMATCH));r.store.dispose(); }
    // Agreement needs positive evidence: results with equal known revisions, not only a missing reason.
    { const u=mount([differ,{...differ,inventoryRevision:3,servedInventoryRevision:2,reviewedInventoryRevision:3,measurementReason:null}]);u.store.ensure(scopeOf);await settle();u.store.refresh(scopeOf);
      u.port.pending[0].resolve(refreshDecode({status:'refreshed',inventoryRevision:2,cache:{status:'fresh',lastSuccessfulFetchAt:fetched,lastAttemptAt:fetched,errorCode:null}}));await settle();
      assert(u.card().includes(NOT_MEASURED_MISMATCH),'unequal revisions without a reason do not clear the wording');u.store.dispose(); }
    // A quarantined failure withholds the results read earlier: only its answer shows, with no speed, state, control or device test from them.
    { const q=mount([differ]);q.store.ensure(scopeOf);await settle();const plainTest=q.card().includes('<dt>Test</dt>');q.store.refresh(scopeOf);
      q.port.pending[0].resolve(refreshDecode({status:'failed',reason:'auth',quarantined:true,cache:{status:'access-revoked',lastSuccessfulFetchAt:'2026-01-01T01:00:00Z',lastAttemptAt:fetched,errorCode:'auth'}}));await settle();
      const out=q.block();
      assert(out.includes('<dt>Device list</dt>')&&out.includes('Failed, the collector refused the credential; stored Network data is withheld<span class="ua-note">recorded <time'),'the quarantine answer stays');
      for(const text of ['Last measured','<dt>Retrieved</dt>','Changed',BUTTON,'Test speed now','Wi-Fi']) assert(!out.includes(text),`nothing beside it reads as current: ${text}`);
      assert(plainTest&&!q.card().includes('<dt>Test</dt>'),'the device card offers no test from withheld results');
      assert.deepEqual([q.port.reads,q.port.posts],[1,1]);q.store.dispose(); }
    // Failures stay failures: the control stays, nothing is retried or re-read, and the wording keeps the mismatch.
    for(const [answer,text] of [[new Error('Network refresh refused or outcome unknown'),'Outcome unknown, no readable answer'],[new DOMException('slow','TimeoutError'),'Timed out, outcome unknown'],
      [{status:'running'},'Busy, a refresh is already running'],[{status:'failed',reason:'transport',quarantined:false},'Failed, the collector could not be reached; the previous device list is kept']]) {
      const f=mount([differ]);f.store.ensure(scopeOf);await settle();f.store.refresh(scopeOf);
      if(answer instanceof Error)f.port.pending[0].reject(answer);else f.port.pending[0].resolve(refreshDecode(answer));await settle();
      const out=f.block();assert(out.includes(`${text}<span class="ua-note">answered <time`)&&out.includes(BUTTON)&&!out.includes('aria-disabled="true"'),`${text}: stated with its time, control available`);
      assert.deepEqual([f.port.reads,f.port.posts],[1,1]);assert(f.card().includes(NOT_MEASURED_MISMATCH));f.store.dispose();
    }
    // Every answer in words, with the server's recorded time where it gives one.
    const said=(response,lost=null,reread=null)=>refreshOutcomeText({response:response&&refreshDecode(response),lost,answeredAt:T0,reread});
    const cache=(status,errorCode)=>({status,lastSuccessfulFetchAt:'2026-01-01T01:00:00Z',lastAttemptAt:fetched,errorCode});
    for(const [response,lost,reread,expected] of [
      [{status:'refreshed',inventoryRevision:2,cache:cache('fresh',null)},null,'read',{text:'Refreshed',at:'2026-01-01T01:00:00Z',recorded:true}],
      [{status:'unchanged',inventoryRevision:2,cache:{...cache('fresh',null),lastSuccessfulFetchAt:null}},null,'read',{text:'Refreshed, unchanged',at:T0,recorded:false}],
      [{status:'refreshed',inventoryRevision:2,cache:cache('fresh',null)},null,'unconfirmed',{text:'Refreshed, state not confirmed',at:'2026-01-01T01:00:00Z',recorded:true}],
      [{status:'needs-review',reviewedInventoryRevision:2,collectorInventoryRevision:3},null,null,{text:'Not refreshed, needs review',at:T0,recorded:false}],
      [{status:'running'},null,null,{text:'Busy, a refresh is already running',at:T0,recorded:false}],
      [{status:'not-configured'},null,null,{text:'Not refreshed, refresh is not set up for this source',at:T0,recorded:false}],
      [{status:'refused',reason:'not-approved'},null,null,{text:'Refused, this account is not approved to refresh this source',at:T0,recorded:false}],
      [{status:'refused',reason:'some-new-reason'},null,null,{text:'Refused, some new reason',at:T0,recorded:false}],
      [{status:'failed',reason:'transport',quarantined:false,cache:cache('stale','transport')},null,null,{text:'Failed, the collector could not be reached; the previous device list is kept',at:fetched,recorded:true}],
      [{status:'failed',reason:'auth',quarantined:true},null,null,{text:'Failed, the collector refused the credential; stored Network data is withheld',at:T0,recorded:false}],
      [{status:'failed',reason:'access-revoked',quarantined:true,cache:cache('access-revoked','auth')},null,null,{text:'Failed, access to this source is revoked; stored Network data is withheld',at:fetched,recorded:true}],
      [null,'timeout',null,{text:'Timed out, outcome unknown',at:T0,recorded:false}],[null,'unknown',null,{text:'Outcome unknown, no readable answer',at:T0,recorded:false}],
    ]) assert.deepEqual(said(response,lost,reread),expected,`${response?.status??lost} in words`);
    assert.equal(NOT_MEASURED_MISMATCH,'Not measured: the device list changed and needs a refresh','#718 wording unchanged');
    const dropped=mount([differ]);dropped.store.dispose();assert.equal(dropped.store.refresh(scopeOf),false,'a dropped store sends nothing');assert.equal(dropped.port.posts,0);
  }
  console.log('PASS Network device-list refresh: only named refresh Editors while lists differ, nothing on browsing, one POST per press, pending blocks, one re-read after success clears the control and card wording only when the lists agree and only for facts read before the refresh, an unconfirmed re-read keeps the answer, a quarantine withholds the earlier results, needs-review offers no control, every answer in words with its time');
} finally {rmSync(scratch,{recursive:true,force:true});}
