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
  writeFileSync(entry,`export * from ${JSON.stringify(join(root,'frontend/integration/network-overlay-live-facts.ts'))};\nexport * from ${JSON.stringify(join(root,'frontend/integration/network-collector.ts'))};\nexport {parseLosslessJson} from ${JSON.stringify(join(root,'frontend/src/numeric/lossless-json.ts'))}\nexport * from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/network-reachability.ts'))};\nexport * from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/network-tests.ts'))};\nexport {InternetSpeed,InternetSpeeds} from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/NetworkTests.tsx'))};\nexport {networkCardContent} from ${JSON.stringify(join(root,'frontend/src/lantern/unified-atlas/NetworkCard.tsx'))};`);
  // React stays external so the components share the one React that renders them.
  const built=await build({root:join(root,'frontend'),configFile:false,logLevel:'silent',build:{write:false,target:'node26',lib:{entry,formats:['es']},rolldownOptions:{external:['react','react/jsx-runtime'],output:{codeSplitting:false}},minify:false}});
  const modulePath=join(scratch,'adapter.mjs');writeFileSync(modulePath,(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk'&&o.isEntry).code
    .replaceAll(JSON.stringify('react'),JSON.stringify(new URL('../node_modules/react/index.js',import.meta.url).href))
    .replaceAll(JSON.stringify('react/jsx-runtime'),JSON.stringify(new URL('../node_modules/react/jsx-runtime.js',import.meta.url).href)));
  const {decodeNetworkLiveFacts,applyNetworkLiveFacts,parseLosslessJson,decodeNetworkCollectorResults,decodeNetworkCollectorAction,readNetworkCollectorResults,requestNetworkCollectorAction,reachability,reachabilityObservation,sparkline,REACHABILITY_KIND,
    createCollectorStore,outcomeText,rateText,speedText,speedSparkline,speedWithTests,latestSpeed,InternetSpeed,InternetSpeeds,networkCardContent,NOT_MEASURED_MISMATCH}=await import(pathToFileURL(modulePath).href);
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
  const result={status:'available',retrievedAt:at,inventoryRevision:1,servedInventoryRevision:1,measurementReason:null,results:{version:1,speed:{latest:speed,recent:[speed]},wifi:{latest:{state:'unavailable',recordedAt:at,networks:null,reason:'no-dependable-unprivileged-scanner'}},actions:[]}};
  const resultDecode=v=>decodeNetworkCollectorResults(parseLosslessJson(JSON.stringify(v)));
  assert.equal(resultDecode(result).results.speed.latest.downloadBitsPerSecond,12000000);
  assert.equal(resultDecode(result).results.wifi.latest.networks,null);
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
  // Several collector sources stay told apart, by collection where their source names repeat; one answering source needs no name.
  const otherScope={...scopeOf,collectionId:'second'},blocks=answers=>{const two={canTest:()=>false,read:async scope=>answers[scope.collectionId],act:()=>new Promise(()=>{})},owned=createCollectorStore(two);
    owned.ensure(scopeOf);owned.ensure(otherScope);return tick().then(tick).then(()=>renderToStaticMarkup(createElement(InternetSpeeds,{collector:{port:two,store:owned},rows:[{scope:scopeOf,label:'Generated network'},{scope:otherScope,label:'Generated network'}]})));};
  const both=await blocks({synthetic:resultDecode(result),second:resultDecode(result)});
  assert(both.includes('aria-label="Internet speed, Generated network · synthetic"')&&both.includes('aria-label="Internet speed, Generated network · second"'),'colliding source names keep their collection');
  const oneSource=await blocks({synthetic:resultDecode(result),second:{status:'unavailable'}});
  assert(oneSource.includes('aria-label="Internet speed"')&&!oneSource.includes('· second'),'one answering source: the short heading');
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
} finally {rmSync(scratch,{recursive:true,force:true});}
