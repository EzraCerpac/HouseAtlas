import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../demo/server.mjs';
// Exercise the actual handler without sockets. Production access/media stays AT11/12.
function request(path,method='GET') {
  const server=createDemoServer();let body,status,headers={};
  const response={setHeader:(k,v)=>{headers[k]=v;},writeHead:(code,extra)=>{status=code;Object.assign(headers,extra);},end:value=>{body=value;}};
  server.emit('request',{url:path,method},response);server.close();return {body,status,headers};
}
test('disposable demo exposes only declared bundled assets and synthetic GET data',()=>{
  for(const path of ['/','/assets/app.mjs','/assets/demo.mjs','/assets/styles.css','/api/demo/view']) assert.equal(request(path).status,200);
  for(const path of ['/packages/contracts/src/index.mjs','/../../private/inputs','/assets/prepare.mjs','/assets/../demo/server.mjs','/api/v1/entities']) assert.equal(request(path).status,404);
  assert.equal(request('/api/demo/view','POST').status,405);
});
test('demo denies/revokes private projections and emits restrictive content policy',()=>{
  for(const scenario of ['denied','expired','revoked']) {const result=request('/api/demo/view?scenario='+scenario);assert.doesNotMatch(result.body,/Portable radio|Example home/);assert.match(result.headers['Content-Security-Policy'],/default-src 'none'/);assert.equal(result.headers['Cache-Control'],'private, no-store');}
});
test('synthetic native destination is explicitly a fixture, not a claimed HomeBox editor',()=>{
  assert.match(request('/synthetic-homebox/edit/example').body,/Synthetic native-link destination only/);
  assert.equal(request('/api/demo/view?scenario=refresh-failure&refresh=1').status,503);
});
test('synthetic source quarantine retains independent home browsing and suppresses denied evidence',()=>{
  const network=JSON.parse(request('/api/demo/view?scenario=network-quarantine').body);assert.equal(network.status,'ready');assert.ok(network.entries.some(p=>p.entity.name==='Portable radio'));
  assert.doesNotMatch(JSON.stringify(network),/device-a|member-a|Synthetic source denial/);
  const homebox=JSON.parse(request('/api/demo/view?scenario=homebox-quarantine').body);assert.equal(homebox.status,'ready');assert.equal(homebox.entries.length,0);assert.equal(homebox.homes.length,1);
});
test('synthetic refresh transitions exercise missing and archived Back targets',()=>{
  for(const scenario of ['focus-removed','focus-archived']) {
    const before=JSON.parse(request('/api/demo/view?scenario='+scenario).body),after=JSON.parse(request('/api/demo/view?scenario='+scenario+'&refresh=1').body);
    assert.ok(before.entries.some(p=>p.entity.name==='Portable radio' && !p.entity.archived));
    assert.equal(after.entries.some(p=>p.entity.name==='Portable radio' && !p.entity.archived),false);
  }
});
