// Healthy actual native WebMCP classification + React completion + mounted MCP.
// This flow does not submit a human form, upload or provider operation.
// Stopped controls and deployment remain outside its scope.
// Healthy actual browser WebMCP registration and correlated native stock read.
// No rejection/replay/expiry/revocation/fault/crash/concurrency control or provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')), 'Supply inspected source root and actual React bundle');
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium, 'A real Chromium executable is required');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-at52-healthy-'));
const data = join(scratch, 'data');
const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(50); }
  throw new Error('Timed out: ' + label);
}
const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
assert.equal(openssl.status, 0, 'Disposable certificate creation');
let service, browser, cdp, serviceOutput = '', serviceError = '';
const observedUrls = [], responses = [], runtimeErrors = [];
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0);
  constructor(process) {
    this.process = process;
    process.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.id) {
          const pending = this.pending.get(message.id); if (!pending) continue;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        } else if (message.method === 'Network.requestWillBeSent') observedUrls.push(message.params.request.url);
        else if (message.method === 'Network.responseReceived') responses.push({ url: message.params.response.url, status: message.params.response.status });
        else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
try {
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, editorLogin } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  // Both inspected release IDLs take DOMString input_arguments. A browser
  // version change requires source inspection before this ordinary flow runs.
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97'].includes(version.product), 'Inspected native WebMCP browser version');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Browser receives the actual issued Secure cookie');
  const contextCookie = await send('Network.setCookie', { name:'houseatlas-smoke-context', value:'ordinary', url:origin, path:'/', secure:true, sameSite:'Strict' });
  assert.equal(contextCookie.success, true, 'Ordinary additional cookie retains actual session authority');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) console.error(JSON.stringify({healthyException:result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,responses,runtimeErrors}));
    assert(!result.exceptionDetails, 'Healthy browser evaluation'); return result.result.value;
  };
  await send('Page.navigate', { url: origin });
  try {
    await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'React authorized home rendering');
  } catch (error) {
    console.error(JSON.stringify({healthyBootstrapResponses: responses, runtimeErrors, renderedText: await evaluate('document.body?.innerText ?? ""'), healthyView: await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))")}));
    throw error;
  }
  const bootstrap = await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(bootstrap.status,200);
  const view=bootstrap.body;
  const native=await evaluate("({modelContext:typeof document.modelContext,registerTool:typeof document.modelContext?.registerTool,getTools:typeof document.modelContext?.getTools,executeTool:typeof document.modelContext?.executeTool})");
  console.log(JSON.stringify({nativeWebMcp:native}));
  assert.equal(native.registerTool,'function','Actual document WebMCP registration exists');
  assert.equal(native.getTools,'function','Actual document WebMCP discovery exists');
  const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  // The inspected Chromium 151/154 IDLs take DOMString input arguments. Supply the
  // complete JSON request through that native API without a modelContext shim.
  const invoke=async(request)=>evaluate(`(async()=>{const tools=await document.modelContext.getTools();const tool=tools.find(t=>t.name==='atlas_records');if(!tool)throw new Error('Actual atlas_records registration missing');const value=await document.modelContext.executeTool(tool,${JSON.stringify(JSON.stringify(request))});const wire=typeof value==='string'?JSON.parse(value):value;return {wire,visible:document.querySelector('.stock-completion pre')?.textContent,tools:tools.map(t=>t.name)};})()`);
  await until(async()=> (await evaluate("document.modelContext.getTools().then(t=>t.some(x=>x.name==='atlas_records'))")), 'Real admitted stock registration');
  const read={schemaVersion:3,commandId:'atlas.identity.get',requestId:U(1600),context:view.scope,target:{authority:'atlas',recordType:'identity',recordId:U(200)},payload:{}};
  const first=await invoke(read);
  assert.equal(first.wire.requestId,read.requestId);assert.equal(first.wire.commandId,read.commandId);assert.equal(first.wire.status,'read');
  assert.deepEqual(JSON.parse(first.visible),first.wire,'Canonical result already committed to React when native tool returns');
  await evaluate("location.hash='#settings'");
  await until(async()=> (await evaluate('document.body?.innerText ?? ""')).includes('Sign out'),'Actual session Settings');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()");
  await until(async()=>await evaluate("Boolean(document.getElementById('atlas-username'))"),'Ordinary successful logout form');
  await evaluate(`document.getElementById('atlas-username').value=${JSON.stringify(editorLogin.username)};document.getElementById('atlas-password').value=${JSON.stringify(editorLogin.password)};document.querySelector('.session-form').requestSubmit()`);
  await until(async()=> (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'),'Actual editor React session');
  await until(async()=> (await evaluate("document.modelContext.getTools().then(t=>t.some(x=>x.name==='atlas_records'))")), 'Actual editor registration');
  const getJson = path => evaluate(`fetch(${JSON.stringify(path)},{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.scope, { workspaceId: U(1), homeId: U(2) });
  const room = view.entries.find(entry => entry.kind === 'place' && entry.semanticKind === 'room');
  assert(room, 'Actual reviewed Room entry');
  const source = { workspaceId: room.workspaceId, homeId: room.homeId, key: room.source };
  const scopePath = `workspaces/${view.scope.workspaceId}/homes/${view.scope.homeId}`;
  const cachedPath = `/api/atlas/providers/homebox/${scopePath}/sources/${room.source.sourceInstanceId}/collections/${encodeURIComponent(room.source.collectionId)}/cached`;
  const cachedResponse = await getJson(cachedPath);
  assert.equal(cachedResponse.status, 200, 'Original authorized cached-only HomeBox read');
  const publishedFixture = JSON.parse(readFileSync(join(root, 'packages/contracts/fixtures/plan-free.snapshot.json'), 'utf8'));
  assert.deepEqual(cachedResponse.body.homeboxEntities, publishedFixture.homeboxEntities.slice(0, 2), 'Canonical cached source projections retain original facts, dates and unverified links');
  const expectedCache = publishedFixture.caches.find(cache => cache.workspaceId === view.scope.workspaceId && cache.homeId === view.scope.homeId && cache.sourceInstanceId === room.source.sourceInstanceId && cache.collectionId === room.source.collectionId);
  assert(expectedCache, 'Published fixture retains an exact matching cache row');
  assert.deepEqual(cachedResponse.body.cache, expectedCache, 'Original cache status, dates and generation are preserved without a provider fetch');
  const admissionPath = `/api/atlas/editing/v1/${scopePath}/place?source=${encodeURIComponent(JSON.stringify(source))}`;
  const recordPath = `/api/atlas/v1/${scopePath}/records/location-semantics/${U(400)}`;
  const beforeAdmissionResponse = await getJson(admissionPath);
  assert.equal(beforeAdmissionResponse.status, 200);
  const beforeAdmission = beforeAdmissionResponse.body;
  assert.equal(beforeAdmission.canReplaceClassification, true);
  assert.equal(beforeAdmission.maximumReasonCodePoints, 1024);
  assert.equal(beforeAdmission.record.recordId, U(400));
  assert.equal(beforeAdmission.record.revision, 1);
  assert.equal(beforeAdmission.record.payload.semanticKind, 'room');
  assert.equal(beforeAdmission.record.payload.atlasId, U(200));
  assert.deepEqual(beforeAdmission.record.payload.evidenceIds, [U(100)]);
  assert.deepEqual(beforeAdmission.guards, [
    { record: { recordType: 'binding', recordId: U(300) }, expectedRevision: 1 },
    { record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 },
    { record: { recordType: 'identity', recordId: U(200) }, expectedRevision: 1 },
  ]);
  const beforeRecordResponse = await getJson(recordPath);
  assert.equal(beforeRecordResponse.status, 200);
  assert.deepEqual(beforeRecordResponse.body, beforeAdmission.record, 'Admission is the actual full canonical record');

  const target = { authority: 'atlas', recordType: 'location-semantics', recordId: U(400) };
  const expectedPayload = { ...beforeAdmission.record.payload, semanticKind: 'floor' };
  const reason = 'Healthy disposable Room to Floor classification; preserve evidence.';
  assert(Array.from(reason).length <= beforeAdmission.maximumReasonCodePoints);
  // One real native-tool submission; full admitted payload and all three guards.
  // This flow uses native WebMCP; the separately named human runner uses the form.
  const submitted = {
    schemaVersion: 3, commandId: 'atlas.location-semantics.replace', requestId: U(1801),
    context: view.scope, target, payload: expectedPayload, idempotencyKey: U(1802), reason,
    preconditions: {
      target: { kind: 'atlas', value: beforeAdmission.record.revision },
      guards: beforeAdmission.guards.map(guard => ({
        target: { authority: 'atlas', ...guard.record },
        revision: { kind: 'atlas', value: guard.expectedRevision },
      })),
    },
    approvalReceiptId: null,
  };
  const replaced = await invoke(submitted), receipt = replaced.wire;
  assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.commandId, submitted.commandId);
  assert.equal(receipt.requestId, submitted.requestId); assert.deepEqual(receipt.resolvedScope, submitted.context);
  assert.equal(receipt.status, 'committed'); assert.equal(receipt.replayed, false);
  assert.deepEqual(receipt.data.records, [{ target, revision: 2, lifecycle: 'active', payload: expectedPayload }]);
  assert.equal(receipt.data.auditIds.length, 1);
  assert.deepEqual(JSON.parse(replaced.visible), receipt, 'Canonical classification receipt displayed by React before native tool return');
  const get = { schemaVersion: 3, commandId: 'atlas.location-semantics.get', requestId: U(1803), context: view.scope, target, payload: {} };
  const record = await invoke(get);
  assert.equal(record.wire.requestId, get.requestId); assert.equal(record.wire.commandId, get.commandId);
  assert.equal(record.wire.status, 'read'); assert.equal(record.wire.replayed, false);
  assert.deepEqual(record.wire.data.records, receipt.data.records);
  assert.deepEqual(JSON.parse(record.visible), record.wire, 'Native record displayed before tool return');
  const history = { schemaVersion: 3, commandId: 'atlas.location-semantics.history', requestId: U(1804), context: view.scope, target, payload: { pageSize: 1, cursor: null, includeArchived: false, q: submitted.commandId } };
  const events = await invoke(history);
  assert.equal(events.wire.requestId, history.requestId); assert.equal(events.wire.commandId, history.commandId);
  assert.equal(events.wire.status, 'read'); assert.equal(events.wire.replayed, false);
  assert.equal(events.wire.data.entries.length, 1); assert.equal(events.wire.data.nextCursor, null);
  assert.equal(events.wire.data.entries[0].eventId, receipt.data.auditIds[0]);
  assert.equal(events.wire.data.entries[0].requestDigest, receipt.data.requestDigest);
  assert.equal(events.wire.data.entries[0].actorId, U(7));
  assert.deepEqual(JSON.parse(events.visible), events.wire, 'Native history displayed before tool return');
  const afterRecordResponse = await getJson(recordPath);
  assert.equal(afterRecordResponse.status, 200);
  const afterRecord = afterRecordResponse.body;
  assert.equal(afterRecord.revision, 2); assert.equal(afterRecord.recordId, U(400));
  assert.deepEqual(afterRecord.payload, expectedPayload);
  assert.equal(afterRecord.lastAuditId, receipt.data.auditIds[0]);
  const afterAdmissionResponse = await getJson(admissionPath);
  assert.equal(afterAdmissionResponse.status, 200);
  const afterAdmission = afterAdmissionResponse.body;
  assert.equal(afterAdmission.canReplaceClassification, true);
  assert.equal(afterAdmission.maximumReasonCodePoints, 1024);
  assert.deepEqual(afterAdmission.record, afterRecord, 'New admission contains the real saved revision2 record');
  assert.deepEqual(afterAdmission.guards, beforeAdmission.guards, 'Original references retain their actual revisions');
  const refreshed = await getJson('/api/atlas/view');
  assert.equal(refreshed.status, 200);
  const floor = refreshed.body.entries.find(entry => entry.key === room.key);
  assert(floor); assert.equal(floor.semanticKind, 'floor');
  assert.deepEqual(floor.source, room.source, 'The refreshed classification retains the exact qualified source');
  assert.deepEqual(floor.entity, room.entity, 'Source-owned HomeBox payload is unchanged');

  // Only after native classification has completed, obtain one current CSRF nonce. Keep it
  // and the protocol-session header inside this evaluation, never in evidence.
  // Browser credentials remain the actual editor cookie issued by UI login.
  // Every MCP POST still authenticates genuine AT11 Action::Mutate; this
  // catalogue only admits reads/history. No read-only principal is fabricated.
  const getRequest = { schemaVersion: 3, commandId: 'atlas.location-semantics.get', requestId: U(1703), context: view.scope, target, payload: {} };
  const historyRequest = { schemaVersion: 3, commandId: 'atlas.location-semantics.history', requestId: U(1704), context: view.scope, target, payload: { pageSize: 1, cursor: null, includeArchived: false, q: 'atlas.location-semantics.replace' } };
  const mcpPath = `/api/atlas/mcp/${scopePath}`;
  const rpc = await evaluate(`(async()=>{
    const sessionResponse=await fetch('/api/atlas/auth/session',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}});
    if(sessionResponse.status!==200)throw new Error('Actual editor session lookup did not complete');
    const actual=await sessionResponse.json();
    if(actual.schemaVersion!==1||typeof actual.csrfToken!=='string'||!actual.csrfToken)throw new Error('Actual session DTO is incompatible');
    const protocol='2025-11-25'; let protocolSession;
    const post=async(message)=>{
      const headers={Accept:'application/json, text/event-stream','Content-Type':'application/json','X-Atlas-CSRF':actual.csrfToken,'MCP-Protocol-Version':protocol};
      if(protocolSession)headers['MCP-Session-Id']=protocolSession;
      const response=await fetch(${JSON.stringify(mcpPath)},{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers,body:JSON.stringify(message)});
      const text=await response.text(); const body=text?JSON.parse(text):null;
      if(message.method==='initialize'){
        protocolSession=response.headers.get('mcp-session-id');
        if(!protocolSession)throw new Error('Actual protocol session receipt missing');
      }
      return {status:response.status,body,empty:text.length===0};
    };
    const initialized=await post({jsonrpc:'2.0',id:'healthy-host-initialize',method:'initialize',params:{protocolVersion:protocol,capabilities:{},clientInfo:{name:'HouseAtlas healthy browser smoke',version:'0.1.0'}}});
    if(initialized.status!==200||initialized.body?.error||initialized.body?.result?.protocolVersion!==protocol)throw new Error('Actual MCP initialization did not complete');
    const ready=await post({jsonrpc:'2.0',method:'notifications/initialized'});
    if(ready.status!==202||!ready.empty)throw new Error('Actual MCP initialized notification did not complete');
    const listed=await post({jsonrpc:'2.0',id:'healthy-host-list',method:'tools/list',params:{}});
    if(listed.status!==200||listed.body?.error)throw new Error('Actual MCP discovery did not complete');
    const get=await post({jsonrpc:'2.0',id:'healthy-host-location-get',method:'tools/call',params:{name:'atlas_records',arguments:${JSON.stringify(getRequest)}}});
    if(get.status!==200||get.body?.error||get.body?.result?.isError!==false)throw new Error('Actual MCP location read did not complete');
    const history=await post({jsonrpc:'2.0',id:'healthy-host-location-history',method:'tools/call',params:{name:'atlas_records',arguments:${JSON.stringify(historyRequest)}}});
    if(history.status!==200||history.body?.error||history.body?.result?.isError!==false)throw new Error('Actual MCP first history page did not complete');
    return {initialized,ready,listed,get,history};
  })()`);
  const assertRpc = (response, id) => {
    assert.equal(response.status, 200); assert.equal(response.body.jsonrpc, '2.0');
    assert.equal(response.body.id, id); assert.equal(response.body.error, undefined);
    return response.body.result;
  };
  const initializeResult = assertRpc(rpc.initialized, 'healthy-host-initialize');
  assert.equal(initializeResult.protocolVersion, '2025-11-25');
  assert.deepEqual(initializeResult.capabilities, { tools: {} });
  assert.deepEqual(initializeResult.serverInfo, { name: 'HouseAtlas', version: '0.1.0' });
  assert.equal(rpc.ready.status, 202); assert.equal(rpc.ready.empty, true); assert.equal(rpc.ready.body, null);
  const listed = assertRpc(rpc.listed, 'healthy-host-list');
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ['atlas_bindings', 'atlas_media_geometry', 'atlas_records']);
  assert(listed.tools.every(tool => tool.annotations?.readOnlyHint === true));
  assert.equal(listed.nextCursor, undefined);
  const assertCanonicalCall = (response, id, request) => {
    const result = assertRpc(response, id);
    assert.equal(result.isError, false); assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    const wire = result.structuredContent;
    assert.deepEqual(JSON.parse(result.content[0].text), wire, 'MCP text retains the exact canonical structured result');
    assert.equal(wire.schemaVersion, 3); assert.equal(wire.commandId, request.commandId);
    assert.equal(wire.requestId, request.requestId); assert.deepEqual(wire.resolvedScope, request.context);
    assert.equal(wire.status, 'read'); assert.equal(wire.replayed, false);
    return wire;
  };
  const getWire = assertCanonicalCall(rpc.get, 'healthy-host-location-get', getRequest);
  assert.deepEqual(getWire.data.records, receipt.data.records, 'Mounted MCP rereads the actual saved full record');
  assert.equal(getWire.data.nextCursor, null); assert.equal(getWire.data.sourceStatus, 'current');
  const historyWire = assertCanonicalCall(rpc.history, 'healthy-host-location-history', historyRequest);
  assert.equal(historyWire.data.entries.length, 1); assert.equal(historyWire.data.nextCursor, null);
  assert.equal(historyWire.data.completeness, 'atlas-owned-audit');
  const event = historyWire.data.entries[0];
  assert.equal(event.eventId, receipt.data.auditIds[0]);
  assert.equal(event.commandId, submitted.commandId); assert.equal(event.state, 'committed');
  assert.deepEqual(event.target, target);
  assert.equal(event.requestDigest, receipt.data.requestDigest, 'History retains the actual durable submitted intent digest');
  assert.equal(event.actorId, U(7), 'Durable history belongs to the actual disposable editor actor');

  assert.equal(runtimeErrors.length, 0, 'No browser runtime exceptions in the healthy flow');
  assert(observedUrls.every(url => url.startsWith(origin + '/')), 'Observed page requests stay on the actual loopback origin');
  assert(responses.every(response => response.status === 200 || (response.status === 202 && response.url === origin + mcpPath) || (response.status === 204 && response.url === origin + '/favicon.ico')), 'Only the inspected ordinary successful response statuses occurred');
  // Ordinary persistence observation only: query the actual synthetic database
  // read-only after successful native WebMCP/MCP operations, without mutating its guards.
  const sql = [
    'import sqlite3,json,sys',
    "c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)",
    "tables=['records','audits','stock_operations','stock_groups','stock_keys','stock_audit_links','stock_history_cursors']",
    "counts={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}",
    "record=json.loads(c.execute('SELECT body FROM records WHERE workspace_id=? AND home_id=? AND record_type=? AND record_id=?',sys.argv[2:6]).fetchone()[0])",
    "audit=json.loads(c.execute('SELECT body FROM audits WHERE workspace_id=? AND home_id=? AND record_id=?',(sys.argv[2],sys.argv[3],sys.argv[5])).fetchone()[0])",
    "print(json.dumps({'counts':counts,'record':record,'audit':audit}))",
    'c.close()',
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, join(data, 'atlas.sqlite'), view.scope.workspaceId, view.scope.homeId, target.recordType, target.recordId], { encoding: 'utf8' });
  assert.equal(rows.status, 0, 'Actual read-only persistence observation');
  const persisted = JSON.parse(rows.stdout);
  assert.deepEqual(persisted.counts, { records: 6, audits: 1, stock_operations: 1, stock_groups: 1, stock_keys: 1, stock_audit_links: 1, stock_history_cursors: 0 });
  assert.deepEqual(persisted.record, afterRecord);
  assert.equal(persisted.audit.reason, reason, 'The complete reason is durable, without clipping');
  assert.equal(persisted.audit.auditId, event.eventId);
  assert.equal(persisted.audit.actorId, event.actorId);
  assert.equal(persisted.audit.beforeDigest, event.beforeDigest);
  assert.equal(persisted.audit.afterDigest, event.afterDigest);
  const evidence = {
    flow: 'HEALTHY Rust TLS cached-only HomeBox read native WebMCP classification React completion and mounted MCP',
    rust: serviceOutput.trim(), binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    browser: version.product, native, tools: first.tools,
    requests: [read, submitted, get, history].map(request => ({ commandId: request.commandId, requestId: request.requestId })),
    classification: { source, beforeRevision: 1, afterRevision: 2, beforeSemanticKind: 'room', afterSemanticKind: 'floor', nativeReasonMaximumCodePoints: beforeAdmission.maximumReasonCodePoints, submitted, receipt, canonicalReceiptDisplayed: true, readback: afterRecord, newAdmission: afterAdmission },
    cachedHomebox: { status: cachedResponse.status, entities: cachedResponse.body.homeboxEntities.length, sourceFactsPreserved: true, cache: cachedResponse.body.cache, providerCalls: 0, nativeNavigation: 'None; stored unverified links preserved' },
    nativeWebMcp: { correlation: true, visibleBeforeReturn: true, record: record.wire, history: events.wire },
    mcp: { protocolVersion: initializeResult.protocolVersion, initialize: { id: rpc.initialized.body.id, status: rpc.initialized.status }, initialized: { status: rpc.ready.status, empty: rpc.ready.empty }, tools: listed.tools.map(tool => ({ name: tool.name, readOnlyHint: tool.annotations.readOnlyHint })), requests: [{ rpcId: rpc.get.body.id, commandId: getRequest.commandId, requestId: getRequest.requestId }, { rpcId: rpc.history.body.id, commandId: historyRequest.commandId, requestId: historyRequest.requestId }], get: getWire, history: historyWire, correlation: true, textEqualsStructuredContent: true, transportAuthority: 'Observed POST with actual editor cookie/current CSRF; AT11 Action::Mutate, read/history-only catalogue' },
    persisted: persisted.counts, durableReasonPreserved: true, observedRequests: observedUrls.length,
    limitations: ['This flow covers native WebMCP classification and React canonical completion; the separately named human runner covers the actual PlaceEditor form.', 'Only one ordinary classification replacement, exact record readbacks and first matching history pages are covered.', 'No stopped controls, fresh media upload, provider calls, real household configuration or deployment are exercised.'],
  };
  if (process.env.HOUSEATLAS_EVIDENCE) writeFileSync(process.env.HOUSEATLAS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    if (cdp && browser?.exitCode === null) await cdp.send('Browser.close').catch(() => {});
    if (browser?.exitCode === null) await until(() => browser.exitCode !== null, 'ordinary Chromium shutdown', 10000);
  } finally {
    try {
      if (service?.exitCode === null) {
        service.kill('SIGINT');
        await until(() => service.exitCode !== null, 'graceful Rust shutdown', 10000);
        assert.equal(service.exitCode, 0, 'Graceful ordinary shutdown');
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
