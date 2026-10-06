import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,rmSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessStore,createAccessBoundary,SESSION_COOKIE,errorResponse,hashPassword,readBoundedJson } from '../src/index.mjs';
import { validateShape } from '../../contracts/src/index.mjs';
import { setup,ids,origin,password,request,source,descriptor,resource,registration } from './fixtures.mjs';
const denied=async(fn,status)=>assert.rejects(fn,e=>e.status===status);
const syncDenied=(fn,status)=>assert.throws(fn,e=>e.status===status);
const digest=value=>createHash('sha256').update(value).digest('hex');

test('login authenticates server credential only; unknown/disabled/wrong passwords share sanitized denial',async t=>{
  const f=await setup();t.after(()=>f.store.close());
  for(const [username,pw] of [['no-user',password],['synthetic-viewer','wrong-password-synthetic']]) await denied(()=>f.boundary.login(request('/',{method:'POST',body:{username,password:pw}}),{clientKey:'test'}),401);
  f.store.setUserEnabled(ids.user,false);
  await denied(()=>f.login(),401);
  await denied(()=>f.boundary.login(request('/',{method:'POST',body:{username:'synthetic-editor',password,actorId:ids.actor,role:'editor'}}),{clientKey:'test'}),422);
  const s=await f.login('synthetic-editor');assert.equal(s.json.actorId,ids.editorActor);
  assert.match(s.response.headers.get('set-cookie'),/^__Host-houseatlas-session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.equal(s.response.headers.get('cache-control'),'private, no-store');
  assert.equal(s.response.headers.get('access-control-allow-origin'),null);
});

test('viewer reads history/cache/media but cannot mutate or replay; editor requires mutation authorization',async t=>{
  const f=await setup();t.after(()=>f.store.close()); const v=await f.login(),e=await f.login('synthetic-editor');
  for(const action of ['read','history','media']) assert.equal((await f.authorize(v,action)).principal.role,'viewer');
  await denied(()=>f.authorize(v,'mutate'),403);
  const read=(await f.authorize(e)).principal;syncDenied(()=>f.boundary.assertMutation(read),403);
  const write=(await f.authorize(e,'mutate')).principal; assert.equal(f.boundary.assertMutation(write).actorId,ids.editorActor);
  await denied(()=>f.authorize(e,'network-write'),403);
});

test('forged/copied/model principals never authorize and payload actor/home claims do not select scope',async t=>{
  const f=await setup();t.after(()=>f.store.close()); const s=await f.login('synthetic-editor');
  const {principal,payload}=await f.boundary.authorize(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf,body:{actorId:ids.actor,workspaceId:ids.otherWorkspace,homeId:ids.otherHome,role:'editor'}}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'});
  assert.equal(principal.actorId,ids.editorActor);assert.equal(principal.homeId,ids.home);assert.equal(payload.homeId,ids.otherHome);
  for(const forged of [{...principal},JSON.parse(JSON.stringify(principal)),{actorId:ids.editorActor,homeId:ids.home,role:'editor'}]) syncDenied(()=>f.boundary.assertMutation(forged),401);
  const other=createAccessBoundary(f.config);syncDenied(()=>other.revalidate(principal),401);
  assert.throws(()=>{principal.homeId=ids.otherHome;},TypeError);
});

test('cross-home/workspace membership denial returns no foreign resource/revision',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login();
  for(const route of [{homeId:ids.otherHome},{workspaceId:ids.otherWorkspace},{homeId:'noncanonical'}]) await denied(()=>f.authorize(s,'read',route),404);
  let err;try{await f.authorize(s,'read',{homeId:ids.otherHome});}catch(e){err=e;}
  const response=errorResponse(err),json=await response.json();validateShape('apiError',json);assert.equal(json.currentRevision,null);assert.equal(json.message,'Resource unavailable');
});

test('origin guard rejects sibling/cross-site/null/missing unsafe origins and unconfigured request origins',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login('synthetic-editor');
  for(const headers of [{origin:'https://evil.synthetic.invalid'},{origin:'null'},{origin:origin, 'sec-fetch-site':'cross-site'},{origin:origin+', https://evil.synthetic.invalid'}]) await denied(()=>f.boundary.authorize(request('/',{cookie:s.cookie,headers}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),403);
  await denied(()=>f.boundary.authorize(request('/',{cookie:s.cookie,noOrigin:true}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),403);
  await denied(()=>f.boundary.authorize(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf,body:{},noOrigin:true,headers:{'sec-fetch-site':'same-origin',referer:origin+'/'}}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'}),403);
  await denied(()=>f.boundary.authorize(request('/',{cookie:s.cookie,requestOrigin:'https://other.synthetic.invalid'}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),403);
  assert.ok((await f.boundary.authorize(request('/',{cookie:s.cookie,noOrigin:true,headers:{'sec-fetch-site':'same-origin',referer:origin+'/room'}}),{workspaceId:ids.workspace,homeId:ids.home,action:'media'})).principal);
});

test('CSRF token is session-bound and unsafe GET/query tokens cannot bypass it',async t=>{
  const f=await setup();t.after(()=>f.store.close());const a=await f.login('synthetic-editor'),b=await f.login('synthetic-editor');
  for(const csrf of [undefined,'bad-token',b.csrf]) await denied(()=>f.boundary.authorize(request('/?csrf='+a.csrf,{method:'POST',cookie:a.cookie,csrf,body:{}}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'}),403);
  await denied(()=>f.boundary.authorize(request('/',{cookie:a.cookie,csrf:a.csrf}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'}),405);
  await denied(()=>Promise.resolve().then(()=>f.boundary.logout(request('/',{method:'POST',cookie:a.cookie}))),403);
});

test('session cookies reject duplicates/forgeries/bearer/query tokens; fixation cookie is replaced',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login();
  for(const cookie of [s.cookie+'; '+s.cookie,SESSION_COOKIE+'=fake',SESSION_COOKIE+'='+'A'.repeat(43),undefined]) await denied(()=>f.boundary.authorize(request('/?session='+s.cookie,{cookie}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),401);
  await denied(()=>f.boundary.authorize(request('/',{cookie:s.cookie,headers:{authorization:'Bearer synthetic-model-claim'}}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),401);
  const fixed=await f.login('synthetic-viewer',{cookie:SESSION_COOKIE+'='+'A'.repeat(43)});assert.notEqual(fixed.cookie,SESSION_COOKIE+'='+'A'.repeat(43));
});

test('idle and absolute expiry are independent and fail at exact boundary; backward clock denies',async t=>{
  for(const kind of ['idle','absolute','backward']) {
    const f=await setup({limits:{idleMs:1000,absoluteMs:3000}});t.after(()=>f.store.close());const s=await f.login();
    if(kind==='idle') f.advance(1000);
    if(kind==='absolute') {for(let i=0;i<3;i++){f.advance(750);await f.authorize(s);}f.advance(750);}
    if(kind==='backward') f.advance(-1);
    await denied(()=>f.authorize(s),401);
  }
});

test('logout, token rotation and CSRF recovery invalidate prior capabilities without extending absolute lifetime',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login('synthetic-editor'),p=(await f.authorize(s)).principal;
  f.advance(1000);const rotated=f.boundary.rotateSession(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf})); const json=await rotated.json();
  assert.equal(json.expiresAt,s.json.expiresAt);await denied(()=>f.authorize(s),401);syncDenied(()=>f.boundary.revalidate(p),401);
  const newSession={cookie:rotated.headers.get('set-cookie').split(';')[0],csrf:json.csrfToken};
  const info=await f.boundary.sessionInfo(request('/',{cookie:newSession.cookie})).json();
  await denied(()=>f.authorize(newSession,'mutate'),403);newSession.csrf=info.csrfToken;await f.authorize(newSession,'mutate');
  const out=f.boundary.logout(request('/',{method:'POST',cookie:newSession.cookie,csrf:newSession.csrf}));assert.match(out.headers.get('set-cookie'),/Max-Age=0$/);await denied(()=>f.authorize(newSession),401);
});

test('membership downgrade/revoke and user disable invalidate issued contexts and cached reads immediately',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login('synthetic-editor'),p=(await f.authorize(s,'mutate')).principal;
  f.store.setMembership({userId:ids.editor,workspaceId:ids.workspace,homeId:ids.home,role:'viewer'});syncDenied(()=>f.boundary.assertMutation(p),403);await denied(()=>f.authorize(s,'mutate'),403);assert.equal((await f.authorize(s)).principal.role,'viewer');
  f.store.setMembership({userId:ids.editor,workspaceId:ids.workspace,homeId:ids.home,role:'viewer',enabled:false});await denied(()=>f.authorize(s),404);
  f.store.setUserEnabled(ids.editor,false);await denied(()=>f.authorize(s),401);
});

test('credential change and administrator session revocation invalidate sessions',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login();
  f.store.putUser({userId:ids.user,actorId:ids.actor,username:'synthetic-viewer',passwordVerifier:await hashPassword('Another-synthetic-password-only')});await denied(()=>f.authorize(s),401);
  const e=await f.login('synthetic-editor');f.store.revokeUserSessions(ids.editor);await denied(()=>f.authorize(e),401);
});

test('source partition denies other entity/home/collection/instance/owner; revocation denies retained cached capability',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login(),p=(await f.authorize(s)).principal;
  const g=f.boundary.authorizeSource(p,source());
  for(const r of [source(ids.otherHome),source(ids.home,ids.otherEntity),{...source(),key:{...source().key,collectionId:'wrong'}},{...source(),key:{...source().key,sourceInstanceId:ids.asset}},{...source(),key:{...source().key,sourceKind:'network-device'}}]) syncDenied(()=>f.boundary.authorizeSource(p,r),404);
  syncDenied(()=>f.boundary.revalidateSource({...g}),401);
  f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',false);syncDenied(()=>f.boundary.revalidateSource(g),404);syncDenied(()=>f.boundary.authorizeSource(p,source()),404);
  f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',true);syncDenied(()=>f.boundary.revalidateSource(g),404);
});

test('source administration enforces disjoint home partitions transactionally',async t=>{
  const f=await setup();t.after(()=>f.store.close());
  assert.throws(()=>f.store.putSource(registration(ids.otherHome)),/disjoint/);
  assert.equal(JSON.parse(f.store.source(ids.workspace,ids.otherHome,ids.instance,'synthetic-shared').registration).allowedExternalIds[0],ids.otherEntity);
  assert.throws(()=>f.store.putSource({...registration(),partitionMode:'exclusive-home',allowedExternalIds:[]}),/disjoint/);
  assert.throws(()=>f.store.putSource({...registration(),password:'synthetic'}));
});

test('media grants bind authoritative entity/attachment/home and never expose path, URL or credentials',async t=>{
  let current=resource();const f=await setup({resolveMedia:async()=>current});t.after(()=>f.store.close());const s=await f.login(),p=(await f.authorize(s,'media')).principal;
  const grant=await f.boundary.authorizeMedia(p,descriptor());assert.deepEqual(Object.keys(grant).sort(),['byteSize','contentType','kind','mode']);
  for(const wrong of [{homeId:ids.otherHome},{workspaceId:ids.otherWorkspace},{attachmentId:ids.asset},{entity:source(ids.home,ids.otherEntity)}]) {current={...resource(),...wrong};await denied(()=>f.boundary.authorizeMedia(p,descriptor()),404);}
  await denied(()=>f.boundary.revalidateMedia({...grant}),401);
  current=resource();f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',false);await denied(()=>f.boundary.revalidateMedia(grant),404);
});

test('media policy rejects unreviewed/blocked/SVG/html/oversize/missing and external links',async t=>{
  let current=resource();const f=await setup({resolveMedia:async()=>current});t.after(()=>f.store.close());const p=(await f.authorize(await f.login(),'media')).principal;
  for(const wrong of [{previewPolicy:'unreviewed'},{previewPolicy:'blocked'},{contentType:'image/svg+xml'},{contentType:'text/html'},{byteSize:10485761},{byteSize:-1},{byteSize:null},{availability:'missing'}]) {current={...resource(),...wrong};await denied(()=>f.boundary.authorizeMedia(p,descriptor()),404);}
  current={...resource(),contentType:'application/pdf',previewPolicy:'download-only'};await denied(()=>f.boundary.authorizeMedia(p,descriptor()),404);assert.equal((await f.boundary.authorizeMedia(p,descriptor(),{mode:'download'})).contentType,'application/pdf');
  await denied(()=>f.boundary.authorizeMedia(p,{kind:'external-link',url:'https://evil.synthetic.invalid'}),404);
});

test('owned assets require a scoped available manifest and bounded reviewed policy',async t=>{
  let current={kind:'atlas-asset',assetId:ids.asset,workspaceId:ids.workspace,homeId:ids.home,contentType:'image/png',byteSize:3,previewPolicy:'safe-rendered',availability:'available',storageKey:'/private/synthetic/path'};
  const f=await setup({resolveMedia:async()=>current});t.after(()=>f.store.close());const p=(await f.authorize(await f.login(),'media')).principal;
  const grant=await f.boundary.authorizeMedia(p,{kind:'atlas-asset',assetId:ids.asset});assert.equal(JSON.stringify(grant).includes('/private'),false);
  current={...current,assetId:ids.entity};await denied(()=>f.boundary.authorizeMedia(p,{kind:'atlas-asset',assetId:ids.asset}),404);
});

test('revocation during asynchronous media resolution prevents delivery; resolver errors are sanitized',async t=>{
  let release;const f=await setup({resolveMedia:()=>new Promise(r=>{release=r;})});t.after(()=>f.store.close());const s=await f.login(),p=(await f.authorize(s,'media')).principal;
  const pending=f.boundary.authorizeMedia(p,descriptor());f.store.revokeUserSessions(ids.user);release(resource());await denied(()=>pending,401);
  const other=createAccessBoundary({...f.config,resolveMedia:async()=>{throw Error('/private/secret?token=synthetic');}});const q=(await other.authorize(request('/',{cookie:(await f.login()).cookie}),{workspaceId:ids.workspace,homeId:ids.home,action:'media'})).principal;
  let error;try{await other.authorizeMedia(q,descriptor());}catch(e){error=e;}const result=await errorResponse(error).json();assert.equal(JSON.stringify(result).includes('token'),false);assert.equal(result.code,'upstream-unavailable');
});

test('actual unsafe body bytes are bounded even when Content-Length lies; denied body never reaches command work',async t=>{
  const f=await setup({limits:{maxBodyBytes:64}});t.after(()=>f.store.close());const s=await f.login('synthetic-editor');
  for(const [body,headers,status] of [['x'.repeat(65),{'content-length':'1'},413],['{}',{'content-length':'100'},413],['{',{},422],['{}',{'content-type':'text/plain'},415]]) await denied(()=>f.boundary.authorize(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf,body,headers}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'}),status);
});

test('JSON parser rejects duplicate/escaped duplicate keys and excessive nesting before canonical command validation',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login('synthetic-editor');
  for(const body of ['{"operation":"create","operation":"tombstone"}','{"nested":{"homeId":"a","\\u0068omeId":"b"}}','['.repeat(66)+'0'+']'.repeat(66)]) await denied(()=>f.boundary.authorize(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf,body}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'}),422);
  const body={nested:[{reason:'Synthetic }, escaped " string',value:null}],same:{x:1},other:{x:2}};
  assert.deepEqual((await f.boundary.authorize(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf,body}),{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'})).payload,body);
});

test('persistent login/request rate limits precede credential work and prevent unlimited session issuance',async t=>{
  const f=await setup({limits:{loginLimit:1}});t.after(()=>f.store.close());await f.login();await denied(()=>f.login('synthetic-editor'),429);
  f.advance(300000);await f.login('synthetic-editor');
  const g=await setup({limits:{requestLimit:1}});t.after(()=>g.store.close());const s=await g.login();await g.authorize(s);await denied(()=>g.authorize(s),429);
  assert.equal(g.store.consumeRate('one',g.time(),{limit:1,windowMs:1000,maxBuckets:1}),false);
});

test('bounded session count removes oldest active token',async t=>{
  const f=await setup({limits:{maxSessions:2}});t.after(()=>f.store.close());const first=await f.login();f.advance(1);const second=await f.login();f.advance(1);const third=await f.login();
  await denied(()=>f.authorize(first),401);await f.authorize(second);await f.authorize(third);
});

test('SQLite reopen persists hashed sessions, grants/revocation and restore invalidation epoch',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-access-synthetic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=join(dir,'access.sqlite');
  const f=await setup({filename});const s=await f.login(),token=s.cookie.split('=')[1];const epoch=f.store.epoch;f.store.close();
  assert.equal(statSync(filename).mode&0o777,0o600);
  const db=new DatabaseSync(filename);const row=db.prepare('SELECT * FROM access_sessions').get();assert.equal(row.token_hash,digest(token));assert.equal(row.csrf_hash,digest(s.csrf));db.close();
  const bytes=readFileSync(filename);assert.equal(bytes.includes(Buffer.from(token)),false);assert.equal(bytes.includes(Buffer.from(s.csrf)),false);assert.equal(bytes.includes(Buffer.from(password)),false);
  const reopened=new AccessStore({filename});const boundary=createAccessBoundary({...f.config,store:reopened});
  const p=(await boundary.authorize(request('/',{cookie:s.cookie}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'})).principal;
  reopened.setMembership({userId:ids.user,workspaceId:ids.workspace,homeId:ids.home,role:'viewer',enabled:false});syncDenied(()=>boundary.revalidate(p),403);
  reopened.invalidateAllSessions();assert.notEqual(reopened.epoch,epoch);await denied(()=>boundary.authorize(request('/',{cookie:s.cookie}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'}),401);reopened.close();
  const after=new AccessStore({filename});assert.notEqual(after.epoch,epoch);assert.equal(after.session(digest(token)),undefined);after.close();
});

test('configuration fails closed for HTTP/wildcard origins, weak limits and unrecognized roles',async t=>{
  const f=await setup();t.after(()=>f.store.close());
  for(const origins of [['http://localhost'],['*'],[origin+'/'],[]]) assert.throws(()=>createAccessBoundary({...f.config,origins}));
  for(const limits of [{idleMs:NaN},{absoluteMs:0},{maxBodyBytes:Infinity},{loginLimit:-1}]) assert.throws(()=>createAccessBoundary({...f.config,limits}));
  assert.throws(()=>f.store.setMembership({userId:ids.user,workspaceId:ids.workspace,homeId:ids.home,role:'operator'}));
  const unknown=await errorResponse(Error('secret synthetic path')).json();validateShape('apiError',unknown);assert.equal(unknown.message,'Service unavailable');
});

test('mixed rate windows retain login throttling across shorter read-rate garbage collection',async t=>{
  const f=await setup();t.after(()=>f.store.close());
  assert.equal(f.store.consumeRate('long',f.time(),{limit:1,windowMs:300000}),true);
  f.advance(60001);assert.equal(f.store.consumeRate('short',f.time(),{limit:1,windowMs:60000}),true);
  assert.equal(f.store.consumeRate('long',f.time(),{limit:1,windowMs:300000}),false);
});

test('revocation while a mutation body is in flight denies before handing payload to storage',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login('synthetic-editor');let controller;
  const stream=new ReadableStream({start:c=>{controller=c;c.enqueue(new TextEncoder().encode('{'));}});
  const req=new Request(origin+'/',{method:'POST',duplex:'half',headers:{origin,cookie:s.cookie,'x-atlas-csrf':s.csrf,'content-type':'application/json'},body:stream});
  const pending=f.boundary.authorize(req,{workspaceId:ids.workspace,homeId:ids.home,action:'mutate'});
  f.store.setMembership({userId:ids.editor,workspaceId:ids.workspace,homeId:ids.home,role:'viewer',enabled:false});
  controller.enqueue(new TextEncoder().encode('}'));controller.close();await denied(()=>pending,404);
});

test('synchronous mutation fence serializes independent connection revocation and precommit expiry rollback',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-access-fence-synthetic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=join(dir,'access.sqlite');
  const f=await setup({filename,limits:{idleMs:1000,absoluteMs:2000}});t.after(()=>f.store.close());const p=(await f.authorize(await f.login('synthetic-editor'),'mutate')).principal;
  const independent=new DatabaseSync(filename);t.after(()=>independent.close());independent.exec('PRAGMA busy_timeout=1');
  let committed=false;
  f.boundary.withMutationAuthorization(p,()=>{
    assert.throws(()=>independent.prepare('UPDATE access_memberships SET enabled=0,version=version+1 WHERE user_id=?').run(ids.editor),/locked/);
    f.boundary.assertMutation(p);committed=true;
  });assert.equal(committed,true);
  independent.prepare('UPDATE access_memberships SET enabled=0,version=version+1 WHERE user_id=?').run(ids.editor);
  syncDenied(()=>f.boundary.assertMutation(p),403);
  assert.throws(()=>f.boundary.withMutationAuthorization(p,async()=>{}),/Synchronous/);
});

test('precommit access check rolls back a separate synthetic storage transaction on expiry',async t=>{
  const f=await setup({limits:{idleMs:1000,absoluteMs:2000}});t.after(()=>f.store.close());const p=(await f.authorize(await f.login('synthetic-editor'),'mutate')).principal;
  const records=new DatabaseSync(':memory:');t.after(()=>records.close());records.exec('CREATE TABLE synthetic_records(id INTEGER);');
  syncDenied(()=>f.boundary.withMutationAuthorization(p,()=>{
    records.exec('BEGIN IMMEDIATE');
    try {records.exec('INSERT INTO synthetic_records VALUES(1)');f.advance(1000);f.boundary.assertMutation(p);records.exec('COMMIT');}
    catch(error){records.exec('ROLLBACK');throw error;}
  }),401);
  assert.equal(records.prepare('SELECT count(*) AS n FROM synthetic_records').get().n,0);
});

test('account disabled during password derivation cannot receive a session; concurrent derivations are bounded',async t=>{
  const f=await setup();t.after(()=>f.store.close());
  const pending=f.login();const timer=setTimeout(()=>f.store.setUserEnabled(ids.user,false),1);t.after(()=>clearTimeout(timer));await denied(()=>pending,401);
  const g=await setup();t.after(()=>g.store.close());const results=await Promise.allSettled(Array.from({length:8},()=>g.login()));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,4);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.status===429).length,4);
});

test('restore epoch rejects old session rows even if retained rows are reintroduced; rate buckets survive reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-access-epoch-synthetic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=join(dir,'access.sqlite');
  const f=await setup({filename});const s=await f.login();const db=new DatabaseSync(filename);const row=db.prepare('SELECT * FROM access_sessions').get();
  f.store.invalidateAllSessions();db.prepare('INSERT INTO access_sessions VALUES(?,?,?,?,?,?,?,?,?)').run(row.token_hash,row.csrf_hash,row.user_id,row.user_version,row.epoch,row.origin,row.created_at,row.last_seen,row.expires_at);db.close();
  await denied(()=>f.authorize(s),401);assert.equal(f.store.consumeRate('durable',f.time(),{limit:1,windowMs:300000}),true);f.store.close();
  const store=new AccessStore({filename});assert.equal(store.consumeRate('durable',f.time(),{limit:1,windowMs:300000}),false);store.close();
});

test('unknown future access DB version fails before changing its table set',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-access-version-synthetic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=join(dir,'access.sqlite');
  const db=new DatabaseSync(filename);db.exec("CREATE TABLE access_meta(id INTEGER PRIMARY KEY,version INTEGER,epoch TEXT);INSERT INTO access_meta VALUES(1,999,'synthetic');");
  const tables=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();const before=tables();
  assert.throws(()=>new AccessStore({filename}),/Unsupported/);assert.deepEqual(tables(),before);db.close();
});

test('credential/registration replacement preserves disabled state until explicit server reenable',async t=>{
  const f=await setup();t.after(()=>f.store.close());const s=await f.login(),p=(await f.authorize(s)).principal;
  f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',false);f.store.putSource(registration());
  syncDenied(()=>f.boundary.authorizeSource(p,source()),404);
  f.store.setUserEnabled(ids.user,false);f.store.putUser({userId:ids.user,actorId:ids.actor,username:'synthetic-viewer',passwordVerifier:await hashPassword(password)});
  await denied(()=>f.login(),401);
});

const partition=()=>({workspaceId:ids.workspace,homeId:ids.home,sourceInstanceId:ids.instance,collectionId:'synthetic-shared'});

test('empty source partition availability is authorized without inventing any external entity ID',async t=>{
  const f=await setup();t.after(()=>f.store.close());const p=(await f.authorize(await f.login())).principal;
  f.store.putSource({...registration(),allowedExternalIds:[]});
  const grant=f.boundary.authorizeSourcePartition(p,partition());assert.deepEqual(grant,partition());assert.ok(Object.isFrozen(grant));
  syncDenied(()=>f.boundary.authorizeSource(p,source()),404);
  f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',false);
  syncDenied(()=>f.boundary.authorizeSourcePartition(p,partition()),404);
  syncDenied(()=>f.boundary.revalidateSourcePartition(grant),404);
  assert.equal(f.store.source(ids.workspace,ids.home,ids.instance,'synthetic-shared').enabled,0);
});

test('partition check denies foreign/unregistered/malformed selectors and caller enable or entity claims',async t=>{
  const f=await setup();t.after(()=>f.store.close());const p=(await f.authorize(await f.login())).principal;
  for(const wrong of [{homeId:ids.otherHome},{workspaceId:ids.otherWorkspace},{sourceInstanceId:ids.asset},{collectionId:'unknown'},{collectionId:''},{sourceInstanceId:'noncanonical'},{enabled:true},{externalId:ids.entity},{owner:'homebox'}]) syncDenied(()=>f.boundary.authorizeSourcePartition(p,{...partition(),...wrong}),404);
  syncDenied(()=>f.boundary.authorizeSourcePartition({...p},partition()),401);
  syncDenied(()=>f.boundary.authorizeSourcePartition(p,{workspaceId:ids.workspace,homeId:ids.home}),404);
});

test('partition grants are instance-branded, version-bound and cannot authorize entities, media or mutation',async t=>{
  const f=await setup();t.after(()=>f.store.close());const p=(await f.authorize(await f.login())).principal,g=f.boundary.authorizeSourcePartition(p,partition());
  assert.equal(f.boundary.revalidateSourcePartition(g),g);
  for(const forged of [{...g},JSON.parse(JSON.stringify(g))]) syncDenied(()=>f.boundary.revalidateSourcePartition(forged),401);
  syncDenied(()=>createAccessBoundary(f.config).revalidateSourcePartition(g),401);
  syncDenied(()=>f.boundary.revalidate(g),401);syncDenied(()=>f.boundary.revalidateSource(g),401);syncDenied(()=>f.boundary.assertMutation(g),401);
  await denied(()=>f.boundary.authorizeMedia(g,descriptor()),401);
  f.store.putSource(registration());syncDenied(()=>f.boundary.revalidateSourcePartition(g),404);
  const current=f.boundary.authorizeSourcePartition(p,partition());f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',false);f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,'synthetic-shared',true);
  syncDenied(()=>f.boundary.revalidateSourcePartition(current),404);
});

test('partition rechecks revoked membership/session and exact expiry before exposing even empty-cache metadata',async t=>{
  const f=await setup({limits:{idleMs:1000,absoluteMs:2000}});t.after(()=>f.store.close());const s=await f.login(),p=(await f.authorize(s)).principal,g=f.boundary.authorizeSourcePartition(p,partition());
  f.advance(1000);syncDenied(()=>f.boundary.authorizeSourcePartition(p,partition()),401);syncDenied(()=>f.boundary.revalidateSourcePartition(g),401);
  const q=(await f.authorize(await f.login())).principal,other=f.boundary.authorizeSourcePartition(q,partition());f.store.setMembership({userId:ids.user,workspaceId:ids.workspace,homeId:ids.home,role:'viewer',enabled:false});
  syncDenied(()=>f.boundary.revalidateSourcePartition(other),403);
  f.store.revokeUserSessions(ids.user);syncDenied(()=>f.boundary.revalidateSourcePartition(other),401);
});

test('token rotation preserves stable request budget at unchanged clock and absolute expiry',async t=>{
  const f=await setup({limits:{requestLimit:2}});t.after(()=>f.store.close());let s=await f.login('synthetic-editor');const expiry=s.json.expiresAt,clock=f.time();let accepted=0;
  for(let pair=0;pair<4;pair++) {
    try {
      await f.authorize(s);accepted++;
      const response=f.boundary.rotateSession(request('/',{method:'POST',cookie:s.cookie,csrf:s.csrf}));accepted++;
      const json=await response.json();assert.equal(json.expiresAt,expiry);assert.equal(f.time(),clock);
      s={cookie:response.headers.get('set-cookie').split(';')[0],csrf:json.csrfToken};
    } catch(error) {assert.equal(error.status,429);break;}
  }
  assert.equal(accepted,2);await denied(()=>f.authorize(s),429);
  f.advance(60000);assert.ok((await f.authorize(s)).principal);
});

test('per-user request and simultaneous-session limits aggregate across boundary instances and relogin',async t=>{
  const f=await setup({limits:{requestLimit:2,maxSessions:2}});t.after(()=>f.store.close());const first=await f.login();f.advance(1);const second=await f.login();
  await f.authorize(first);const other=createAccessBoundary(f.config);await other.authorize(request('/',{cookie:second.cookie}),{workspaceId:ids.workspace,homeId:ids.home,action:'read'});
  syncDenied(()=>f.boundary.sessionInfo(request('/',{cookie:first.cookie})),429);
  f.advance(1);const third=await f.login();await denied(()=>f.authorize(first),401);await denied(()=>f.authorize(second),429);await denied(()=>f.authorize(third),429);
  const editor=await f.login('synthetic-editor');assert.equal((await f.authorize(editor)).principal.actorId,ids.editorActor);
});

test('body reader snapshots reused scratch buffers before producer advances and preserves actual UTF-8 byte limit',async()=>{
  const payload={syntheticCommand:true,reason:'Synthetic café and 💡'};const bytes=new TextEncoder().encode(JSON.stringify(payload));
  function bodyRequest(copy) {
    const scratch=new Uint8Array(1);let index=0;
    const stream=new ReadableStream({pull(controller){if(index===bytes.length){controller.close();return;}scratch[0]=bytes[index++];controller.enqueue(copy?scratch.slice():scratch);}},{highWaterMark:0});
    return new Request(origin+'/',{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:stream});
  }
  assert.deepEqual(await readBoundedJson(bodyRequest(false),bytes.length),payload);
  assert.deepEqual(await readBoundedJson(bodyRequest(true),bytes.length),payload);
  await denied(()=>readBoundedJson(bodyRequest(false),bytes.length-1),413);
});

test('partition collection selectors use frozen Unicode code-point limits, including astral IDs',async t=>{
  const f=await setup();t.after(()=>f.store.close());const p=(await f.authorize(await f.login())).principal;
  for(const count of [2049,4096]) {
    const collectionId='🧪'.repeat(count),registered={...registration(),collectionId};
    assert.ok(collectionId.length>4096);validateShape('sourceRegistration',registered);f.store.putSource(registered);
    const selectors={...partition(),collectionId},grant=f.boundary.authorizeSourcePartition(p,selectors);
    assert.equal(grant.collectionId,collectionId);assert.equal(f.boundary.revalidateSourcePartition(grant),grant);
    assert.equal(f.boundary.authorizeSource(p,{...source(),key:{...source().key,collectionId}}).key.collectionId,collectionId);
    f.store.setSourceEnabled(ids.workspace,ids.home,ids.instance,collectionId,false);
    syncDenied(()=>f.boundary.authorizeSourcePartition(p,selectors),404);syncDenied(()=>f.boundary.revalidateSourcePartition(grant),404);
  }
  const collectionId='🧪'.repeat(4097);assert.throws(()=>validateShape('sourceRegistration',{...registration(),collectionId}));
  syncDenied(()=>f.boundary.authorizeSourcePartition(p,{...partition(),collectionId}),404);
});
