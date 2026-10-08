// Two fresh healthy React attachment intents for the same original, actual native
// WebMCP reads, successful owned-media GET and read-only SQLite linkage.
// Requires the actual inspected root upload route/admission/client to be mounted.
// No provider, rejection, replay, expiry, revocation, fault, crash, recovery,
// concurrency or denial control; no imports or calls to aggregate runners.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(process.env.HOUSEATLAS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')), 'Supply inspected source root and actual React bundle');
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const git = args => spawnSync('git', args, {cwd:root, encoding:'utf8'});
const head = git(['rev-parse','HEAD']); assert.equal(head.status,0);
const status = git(['status','--porcelain']); assert.equal(status.status,0);
const source = {head:head.stdout.trim(),clean:status.stdout.trim()==='',
  binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),
  frontendIndexSha256:createHash('sha256').update(readFileSync(join(root,'frontend/dist/index.html'))).digest('hex'),
  scriptSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
if(process.env.HOUSEATLAS_SOURCE_SHA) {
  assert.equal(source.head,process.env.HOUSEATLAS_SOURCE_SHA);
  assert.equal(source.clean,true,'Exact candidate verification requires a clean source tree');
}
const fixtureProfile=process.env.HOUSEATLAS_FIXTURE_PROFILE;
assert(!fixtureProfile || fixtureProfile==='native-media-archive','Only the inspected positive archive profile is accepted');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium && existsSync(chromium), 'A real Chromium executable is required');
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
const observedUrls = [], responses = [], runtimeErrors = [], uploadRequests = [];
const loaded = new Set();
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
        } else if (message.method === 'Network.requestWillBeSent') {
          const { request, requestId } = message.params;
          observedUrls.push(request.url);
          // Observe only correlation and URL; never retain multipart bodies,
          // credentials, cookie/CSRF headers or any private stage/token fields.
          if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/evidence'))
            uploadRequests.push({ requestId, url: request.url });
        } else if (message.method === 'Network.responseReceived') responses.push({ requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status });
        else if (message.method === 'Network.loadingFinished') loaded.add(message.params.requestId);
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
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key,
    ...(fixtureProfile ? ['--fixture-profile',fixtureProfile] : [])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie, editorLogin, preparedMedia } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--enable-experimental-web-platform-features', '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  // Both inspected release IDLs take DOMString input_arguments. A browser
  // version change requires source inspection before this ordinary flow runs.
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97', 'Chrome/154.0.8037.98'].includes(version.product), 'Inspected native WebMCP browser version');
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
  // Open the retained native Atlas surface through Lantern's visible controls.
  const openAtlasTools = async () => {
    await until(async () => await evaluate(`(() => {
      const button = [...document.querySelectorAll('nav[aria-label="Sections"] button')]
        .find(button => button.textContent?.trim() === 'Changes' && button.getClientRects().length);
      if (!button) return false;
      button.click();
      return true;
    })()`), 'Visible Changes navigation');
    await until(async () => await evaluate("document.querySelector('main#main h1')?.textContent === 'Changes'"), 'Changes view');
    await until(async () => await evaluate(`(() => {
      const button = [...document.querySelectorAll('main#main button')]
        .find(button => button.textContent?.trim() === 'Atlas tools' && button.getClientRects().length);
      if (!button) return false;
      button.click();
      return true;
    })()`), 'Visible Atlas tools action');
    await until(async () => await evaluate("Boolean(document.querySelector('[role=region][aria-label=\"Atlas tools\"]:not([hidden])'))"), 'Visible Atlas tools region');
  };
  await send('Page.navigate', { url: origin });
  await openAtlasTools();
  try {
    await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'React authorized home rendering');
  } catch (error) {
    console.error(JSON.stringify({healthyBootstrapResponses: responses, runtimeErrors, renderedText: await evaluate('document.body?.innerText ?? ""'), healthyView: await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))")}));
    throw error;
  }
  const bootstrap = await evaluate("fetch('/api/atlas/view',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(bootstrap.status,200);
  const view=bootstrap.body;
  assert.equal(view.canEdit, false, 'Passive HomeBox edit capability remains false');
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
  await openAtlasTools();
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

  // The fixture remains untouched until this one genuine attachment submission.
  assert.equal(preparedMedia.length, 2, 'Two fixture originals exist without asset rows');
  const nativePrefix = `/api/atlas/v1/${scopePath}/records`;
  const stockPrefix = `/api/atlas/stock/v3/${scopePath}/records`;
  const identityBeforeResponse = await getJson(`${nativePrefix}/identity/${U(200)}`);
  assert.equal(identityBeforeResponse.status, 200);
  const identityBefore = identityBeforeResponse.body;
  assert.equal(identityBefore.revision, 1);
  assert.equal(identityBefore.payload.kind, 'location');
  const expectedStockGuards = [...beforeAdmission.guards.map(guard => ({
    target: { authority: 'atlas', ...guard.record },
    revision: { kind: 'atlas', value: guard.expectedRevision },
  })), { target: { authority: 'atlas', recordType: 'location-semantics', recordId: U(400) }, revision: { kind: 'atlas', value: 1 } }];

  // Generate only public synthetic 2x2 RGBA PNG bytes. This is fixture setup,
  // without a product import, staged token, grant or fabricated media proof.
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, body) => {
    const type = Buffer.from(kind, 'ascii'), result = Buffer.alloc(body.length + 12);
    result.writeUInt32BE(body.length, 0); type.copy(result, 4); body.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([type, body])), body.length + 8);
    return result;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.from([0, 40, 110, 200, 255, 190, 90, 50, 255, 0, 80, 170, 120, 255, 220, 190, 60, 255]);
  const uploadBytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  const filename = 'synthetic-evidence.png', uploadFile = join(scratch, filename);
  writeFileSync(uploadFile, uploadBytes);
  const uploadSha256 = createHash('sha256').update(uploadBytes).digest('hex');
  const statement = 'Generated public two by two PNG for this synthetic place.';
  const reason = 'Attach one generated public synthetic original to the existing Atlas place.';

  const countSql = [
    'import sqlite3,json,sys,pathlib',
    "c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)",
    "tables=['records','audits','receipts','batch_receipts','asset_manifests','stock_operations','stock_groups','stock_keys','stock_audit_links','stock_history_lookup','stock_history_cursors','upload_consumptions']",
    "counts={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}",
    "print(json.dumps({'schema':c.execute('PRAGMA user_version').fetchone()[0],'counts':counts}))",
    'c.close()',
  ].join('\n');
  const beforeRows = spawnSync('python3', ['-c', countSql, join(data, 'atlas.sqlite')], { encoding: 'utf8' });
  assert.equal(beforeRows.status, 0, 'Actual read-only fresh persistence observation');
  const beforePersisted = JSON.parse(beforeRows.stdout);
  assert.equal(beforePersisted.schema, 5);
  const beforeCounts = Object.fromEntries(Object.keys(beforePersisted.counts).map(name => [name, name === 'records' ? 6 : 0]));
  assert.deepEqual(beforePersisted.counts, beforeCounts, 'No classification or fixture asset metadata is committed before upload');

  // Actual admission must offer the policy and real transport. The proposal
  // cannot manufacture an upload capability while root wiring is incomplete.
  const policy = beforeAdmission.attachmentPolicy;
  assert(policy && policy.maximumBytes === 10 * 1024 * 1024 && policy.contentTypes.includes('image/png') && policy.licenses.length > 0, 'Actual root attachment admission is mounted');
  const license = policy.licenses[0].value;
  assert(Array.from(reason).length <= beforeAdmission.maximumReasonCodePoints);
  await evaluate('location.hash=' + JSON.stringify('#place?key=' + encodeURIComponent(room.key)));
  await until(async () => (await evaluate('document.querySelector(".record-head")?.innerText ?? ""')).includes(room.entity.name), 'React Room detail');
  await until(async () => await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Edit Atlas place')"), 'Actual Atlas place action');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Edit Atlas place').click()");
  await until(async () => await evaluate("Boolean(document.querySelector('form[aria-label=\"Atlas attachment\"] input[name=file]:not(:disabled)'))"), 'Actual admitted attachment form');
  const formPolicy = await evaluate("(()=>{const form=document.querySelector('form[aria-label=\"Atlas attachment\"]');const field=form.querySelector('input[name=reason]');return {accept:form.querySelector('input[name=file]').accept,reasonMaxLength:field.maxLength,reasonName:field.getAttribute('aria-label'),reasonDescription:field.getAttribute('aria-description'),licenseLabels:[...form.querySelectorAll('select[name=license] option')].slice(1).map(x=>x.textContent)};})()");
  assert.deepEqual(formPolicy.accept.split(','), policy.contentTypes);
  assert.equal(formPolicy.reasonMaxLength, -1); assert.equal(formPolicy.reasonName, 'Reason');
  assert.equal(formPolicy.reasonDescription, 'Maximum 1024 characters.');
  assert.deepEqual(formPolicy.licenseLabels, policy.licenses.map(choice => choice.label));
  const documentNode = await send('DOM.getDocument', { depth: 0 });
  const fileNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'form[aria-label="Atlas attachment"] input[name=file]' });
  assert(fileNode.nodeId > 0, 'Actual rendered file input');
  await send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [uploadFile] });
  const selectedFile = await evaluate("(()=>{const file=document.querySelector('form[aria-label=\"Atlas attachment\"] input[name=file]').files[0];return {name:file.name,type:file.type,size:file.size};})()");
  assert.deepEqual(selectedFile, { name: filename, type: 'image/png', size: uploadBytes.length });
  await evaluate(`(()=>{const form=document.querySelector('form[aria-label="Atlas attachment"]');for(const [name,value] of Object.entries(${JSON.stringify({ statement, reason })})){const field=form.querySelector('input[name='+name+']');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}const select=form.querySelector('select[name=license]');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(async () => await evaluate("document.querySelector('form[aria-label=\"Atlas attachment\"] select[name=license]').value==='0'"), 'Actual offered source licence selected');
  assert.equal(await evaluate("document.querySelector('form[aria-label=\"Atlas attachment\"]').checkValidity()"), true);
  await evaluate("document.querySelector('form[aria-label=\"Atlas attachment\"]').requestSubmit()");
  await until(async () => await evaluate("document.querySelector('section[aria-label=\"Atlas place editing\"] [role=status]')?.textContent==='Saved. Information refreshed.' && document.querySelector('section[aria-label=\"Atlas place editing\"]')?.getAttribute('aria-busy')==='false'"), 'Canonical upload commit and actual React refresh');
  assert.equal(uploadRequests.length, 1, 'The actual form submits one fresh upload once');
  const captured = uploadRequests[0];
  assert.equal(captured.url, origin + `/api/atlas/editing/v1/${scopePath}/places/${U(400)}/evidence`);
  await until(() => loaded.has(captured.requestId), 'Successful upload response body completed');
  assert.equal(responses.find(response => response.requestId === captured.requestId)?.status, 200);
  const completionBody = await send('Network.getResponseBody', { requestId: captured.requestId });
  const receipt = JSON.parse(completionBody.base64Encoded ? Buffer.from(completionBody.body, 'base64').toString('utf8') : completionBody.body);
  const renderedReceipt = await evaluate("document.querySelector('section[aria-label=\"Atlas place editing\"] details pre')?.textContent");
  assert.deepEqual(JSON.parse(renderedReceipt), receipt, 'The real canonical batch receipt remains visible after refresh');
  const receiptLayouts = [];
  const checkReceiptLayout = async expected => {
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const layout = await evaluate("(async()=>{const details=document.querySelector('section[aria-label=\"Atlas place editing\"] details');details.open=true;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const pre=details.querySelector('pre');return {viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,preClient:pre.clientWidth,preScroll:pre.scrollWidth,text:pre.textContent};})()");
      assert.equal(layout.text, JSON.stringify(expected, null, 2), 'Expanded receipt preserves the complete canonical JSON');
      assert.equal(layout.viewport, width);
      assert(layout.document <= width && layout.body <= width && layout.preScroll <= layout.preClient, 'Expanded receipt stays within the healthy phone/desktop viewport');
      const { text, ...metrics } = layout;
      receiptLayouts.push(metrics);
    }
    await evaluate("document.querySelector('section[aria-label=\"Atlas place editing\"] details').open=false");
    await send('Emulation.clearDeviceMetricsOverride');
  };
  await checkReceiptLayout(receipt);
  assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.commandId, 'atlas.batch.execute');
  assert.match(receipt.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(receipt.status, 'committed'); assert.equal(receipt.replayed, false);
  assert.deepEqual(receipt.resolvedScope, view.scope);
  assert.equal(receipt.data.records.length, 3); assert.equal(receipt.data.auditIds.length, 3);
  const [asset, evidenceRecord, identity] = receipt.data.records;
  assert.deepEqual(receipt.data.records.map(row => row.target.recordType), ['asset', 'evidence', 'identity']);
  assert.deepEqual(receipt.data.records.map(row => row.revision), [1, 1, 2]);
  assert(receipt.data.records.every(row => row.lifecycle === 'active' && row.target.authority === 'atlas'));
  assert.equal(identity.target.recordId, U(200));
  assert.deepEqual(identity.payload, { ...identityBefore.payload, evidenceIds: [...identityBefore.payload.evidenceIds, evidenceRecord.target.recordId] }, 'Full original identity payload and existing evidence order survive');
  assert.equal(evidenceRecord.payload.statement, statement);
  assert(evidenceRecord.payload.references.some(reference => reference.kind === 'atlas-asset' && reference.assetId === asset.target.recordId));
  assert.equal(asset.payload.purpose, 'evidence-original'); assert.equal(asset.payload.contentType, 'image/png');
  assert.equal(asset.payload.sha256, uploadSha256); assert.equal(asset.payload.byteSize, uploadBytes.length);
  assert.equal(asset.payload.availability, 'available'); assert.deepEqual(asset.payload.sourceLicense, license);
  assert.equal(Object.hasOwn(asset.payload, 'storageKey'), false, 'Public stock asset omits internal storage key');

  const publicRecord = record => {
    const payload = { ...record.payload }; if (record.recordType === 'asset') delete payload.storageKey;
    return { target: { authority: 'atlas', recordType: record.recordType, recordId: record.recordId }, revision: record.revision, lifecycle: record.lifecycle, payload };
  };
  const readbacks = [];
  for (const [index, row] of receipt.data.records.entries()) {
    const suffix = `/${row.target.recordType}/${row.target.recordId}`;
    const nativeRecord = await getJson(nativePrefix + suffix), nativeHistory = await getJson(nativePrefix + suffix + '/history');
    assert.equal(nativeRecord.status, 200); assert.equal(nativeHistory.status, 200);
    assert.deepEqual(publicRecord(nativeRecord.body), row);
    assert.equal(nativeRecord.body.lastAuditId, receipt.data.auditIds[index]);
    assert.equal(nativeHistory.body.length, 1);
    const audit = nativeHistory.body[0];
    assert.equal(audit.auditId, receipt.data.auditIds[index]); assert.equal(audit.actorId, U(7));
    assert.equal(audit.reason, reason); assert.equal(audit.resultRevision, row.revision);
    const stockRecord = await getJson(stockPrefix + suffix), stockHistory = await getJson(stockPrefix + suffix + '/history?pageSize=1');
    assert.equal(stockRecord.status, 200); assert.equal(stockHistory.status, 200);
    assert.equal(stockRecord.body.status, 'read'); assert.equal(stockRecord.body.replayed, false);
    assert.deepEqual(stockRecord.body.data.records, [row]);
    assert.equal(stockHistory.body.status, 'read'); assert.equal(stockHistory.body.replayed, false);
    assert.equal(stockHistory.body.data.entries.length, 1); assert.equal(stockHistory.body.data.nextCursor, null);
    const event = stockHistory.body.data.entries[0];
    assert.equal(event.eventId, audit.auditId); assert.equal(event.actorId, audit.actorId);
    assert.equal(event.commandId, ['atlas.asset.create', 'atlas.evidence.create', 'atlas.identity.replace'][index]);
    assert.equal(event.state, 'committed'); assert.deepEqual(event.target, row.target);
    assert.equal(event.beforeDigest, audit.beforeDigest); assert.equal(event.afterDigest, audit.afterDigest);
    readbacks.push({ target: row.target, revision: row.revision, nativeHistory: audit, stockHistory: event });
  }
  const afterSemanticsResponse = await getJson(recordPath), semanticsHistory = await getJson(recordPath + '/history');
  assert.equal(afterSemanticsResponse.status, 200); assert.equal(semanticsHistory.status, 200);
  assert.deepEqual(afterSemanticsResponse.body, beforeAdmission.record, 'Immutable provenance selection retains complete semantics revision1');
  assert.deepEqual(semanticsHistory.body, []);
  const afterAdmissionResponse = await getJson(admissionPath);
  assert.equal(afterAdmissionResponse.status, 200);
  const afterAdmission = afterAdmissionResponse.body;
  assert.deepEqual(afterAdmission.record, beforeAdmission.record);
  const expectedRefreshedGuards = [...beforeAdmission.guards.map(guard => guard.record.recordType === 'identity' ? { ...guard, expectedRevision: 2 } : guard), { record: { recordType: 'evidence', recordId: evidenceRecord.target.recordId }, expectedRevision: 1 }].sort((a, b) => { const left=a.record.recordType+'\0'+a.record.recordId,right=b.record.recordType+'\0'+b.record.recordId;return left < right ? -1 : left > right ? 1 : 0; });
  assert.deepEqual(afterAdmission.guards, expectedRefreshedGuards, 'Refresh rereads identity revision2 and its newly linked evidence while retaining the exact original qualified binding');
  const refreshed = await getJson('/api/atlas/view');
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.canEdit, false);
  const refreshedRoom = refreshed.body.entries.find(entry => entry.key === room.key);
  assert(refreshedRoom); assert.equal(refreshedRoom.semanticKind, 'room');
  assert.deepEqual(refreshedRoom.source, room.source); assert.deepEqual(refreshedRoom.entity, room.entity);

  // Reuse the inspected native read API, without another mutation or replay.
  const get = { schemaVersion: 3, commandId: 'atlas.identity.get', requestId: U(1803), context: view.scope, target: identity.target, payload: {} };
  const history = { schemaVersion: 3, commandId: 'atlas.identity.history', requestId: U(1804), context: view.scope, target: identity.target, payload: { pageSize: 1, cursor: null, includeArchived: false } };
  const nativeRecord = await invoke(get), nativeHistory = await invoke(history);
  assert.equal(nativeRecord.wire.requestId, get.requestId); assert.equal(nativeRecord.wire.commandId, get.commandId);
  assert.equal(nativeRecord.wire.status, 'read'); assert.equal(nativeRecord.wire.replayed, false);
  assert.deepEqual(nativeRecord.wire.data.records, [identity]);
  assert.deepEqual(JSON.parse(nativeRecord.visible), nativeRecord.wire);
  assert.equal(nativeHistory.wire.requestId, history.requestId); assert.equal(nativeHistory.wire.commandId, history.commandId);
  assert.equal(nativeHistory.wire.status, 'read'); assert.equal(nativeHistory.wire.replayed, false);
  assert.equal(nativeHistory.wire.data.entries.length, 1); assert.equal(nativeHistory.wire.data.nextCursor, null);
  assert.equal(nativeHistory.wire.data.entries[0].eventId, receipt.data.auditIds[2]);
  assert.deepEqual(JSON.parse(nativeHistory.visible), nativeHistory.wire);

  // The data-only descriptor comes from the actual committed asset ID. This
  // matches the existing inspected native owned-media URL contract.
  const descriptorDigest = createHash('sha256').update(JSON.stringify({ assetId: asset.target.recordId, kind: 'atlas-asset' })).digest('hex');
  const mediaPath = `/api/atlas/media/${view.scope.workspaceId}/${view.scope.homeId}/${descriptorDigest}/download`;
  const delivered = await evaluate(`fetch(${JSON.stringify(mediaPath)},{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async response=>({status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer())),type:response.headers.get('content-type'),length:response.headers.get('content-length'),cache:response.headers.get('cache-control'),csp:response.headers.get('content-security-policy'),resource:response.headers.get('cross-origin-resource-policy'),nosniff:response.headers.get('x-content-type-options')}))`);
  assert.equal(delivered.status, 200); assert.deepEqual(Buffer.from(delivered.bytes), uploadBytes);
  assert.equal(delivered.type, 'image/png'); assert.equal(Number(delivered.length), uploadBytes.length);
  assert.equal(delivered.cache, 'private, no-store'); assert.equal(delivered.csp, "default-src 'none'; sandbox");
  assert.equal(delivered.resource, 'same-origin'); assert.equal(delivered.nosniff, 'nosniff');

  // Read the completed real database only. Parse private originals locally for
  // equality checks, and emit public results/booleans rather than upload tokens,
  // binding JSON, journal original envelopes or pending file paths.
  const linkageSql = String.raw`
import json
import pathlib
import re
import sqlite3
import sys

connection = None
try:
    connection = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    c = connection
    tables = [
        'records', 'audits', 'receipts', 'batch_receipts', 'asset_manifests',
        'stock_operations', 'stock_groups', 'stock_keys', 'stock_audit_links',
        'stock_history_lookup', 'stock_history_cursors', 'upload_consumptions',
    ]
    counts = {table: c.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in tables}
    workspace, home, operation, asset, evidence, identity, reason = sys.argv[2:9]
    op = c.execute(
        'SELECT original_json,commit_json,request_digest FROM stock_operations '
        'WHERE operation_id=? AND workspace_id=? AND home_id=?',
        (operation, workspace, home),
    ).fetchone()
    root = json.loads(op['original_json'])
    commit = json.loads(op['commit_json'])
    u = c.execute(
        'SELECT group_ordinal,group_operation_id,asset_audit_id,request_id,asset_id,'
        'binding_json,root_request_json FROM upload_consumptions WHERE root_operation_id=?',
        (operation,),
    ).fetchone()
    binding = json.loads(u['binding_json'])
    stage = binding['stage']
    children = root['payload']['commands']
    # Triple quotes keep SQL JSON-path strings intact across JS/Python layers.
    groups = [dict(row) for row in c.execute("""
        SELECT g.ordinal,g.child_index,l.entry_ordinal,l.command_id,l.state,a.record_id,
          json_extract(a.body,'$.operation') AS operation,
          json_extract(a.body,'$.previousRevision') AS previousRevision,
          json_extract(a.body,'$.resultRevision') AS resultRevision,
          r.revision,
          p.payload_hash=l.payload_hash AS receiptHashMatches,
          json_extract(p.body,'$.audit.auditId')=a.audit_id AS receiptAuditMatches,
          h.command_id=l.command_id AS historyCommandMatches,
          l.request_digest=json_extract(l.event_json,'$.requestDigest') AS eventDigestMatches
        FROM stock_groups g
        JOIN stock_audit_links l ON l.root_operation_id=g.root_operation_id AND l.group_ordinal=g.ordinal
        JOIN audits a ON a.audit_id=l.audit_id AND a.workspace_id=l.workspace_id AND a.home_id=l.home_id
        JOIN receipts p ON p.workspace_id=l.workspace_id AND p.home_id=l.home_id
          AND p.actor_id=l.actor_id AND p.mutation_id=l.mutation_id
        JOIN records r ON r.workspace_id=a.workspace_id AND r.home_id=a.home_id AND r.record_id=a.record_id
        JOIN stock_history_lookup h ON h.seq=a.seq AND h.audit_id=a.audit_id
          AND h.workspace_id=a.workspace_id AND h.home_id=a.home_id AND h.record_id=a.record_id
        WHERE g.root_operation_id=? ORDER BY g.ordinal,l.entry_ordinal
    """, (operation,))]
    asset_group = c.execute(
        'SELECT operation_id,request_digest,original_json FROM stock_groups '
        'WHERE root_operation_id=? AND ordinal=0', (operation,),
    ).fetchone()
    manifest = c.execute(
        'SELECT storage_key FROM asset_manifests WHERE workspace_id=? AND home_id=? AND record_id=?',
        (workspace, home, asset),
    ).fetchone()
    batch = c.execute(
        'SELECT body FROM batch_receipts WHERE workspace_id=? AND home_id=? AND batch_id=?',
        (workspace, home, root['target']['batchId']),
    ).fetchone()
    native_batch = json.loads(batch['body'])
    keys = [{'ordinal': row['group_ordinal'], 'count': row['n']} for row in c.execute(
        'SELECT group_ordinal,COUNT(*) AS n FROM stock_keys '
        'WHERE root_operation_id=? GROUP BY group_ordinal ORDER BY group_ordinal', (operation,),
    )]
    summary = {
        'schema': c.execute('PRAGMA user_version').fetchone()[0],
        'counts': counts,
        'commitWire': commit['wire'],
        'childWires': commit['children'],
        'rootRequestId': root['requestId'],
        'rootGuards': root['preconditions']['guards'],
        'identityChildGuards': children[2]['preconditions']['guards'],
        'identityExpectedRevision': children[2]['preconditions']['target'],
        'groupLinkage': groups,
        'keys': keys,
        'reasonsMatch': root['reason'] == reason
            and all(child['reason'] == reason for child in children)
            and all(json.loads(row[0])['reason'] == reason for row in c.execute('SELECT body FROM audits')),
        'consumption': {
            'count': counts['upload_consumptions'],
            'assetId': u['asset_id'],
            'groupOrdinal': u['group_ordinal'],
            'rootRequestMatches': json.loads(u['root_request_json']) == root,
            'assetRequestMatches': u['request_id'] == children[0]['requestId']
                and json.loads(asset_group['original_json']) == children[0],
            'assetIntentMatches': binding['requestDigest'] == asset_group['request_digest'],
            'groupMatches': u['group_operation_id'] == asset_group['operation_id'],
            'auditMatches': u['asset_audit_id'] == commit['wire']['data']['auditIds'][0],
            'assetMatches': stage['assetId'] == asset == children[0]['target']['recordId'],
            'manifestMatches': manifest['storage_key'] == stage['payload']['storageKey'],
            'purpose': stage['payload']['purpose'],
            'sourceLicense': stage['payload']['sourceLicense'],
            'filename': stage['staged']['filename'],
            'contentType': stage['staged']['contentType'],
            'sha256': stage['staged']['sha256'],
            'byteSize': stage['staged']['byteSize'],
        },
        'nativeBatch': {
            # Storage retains the flattened native result array in this table.
            'results': len(native_batch),
            'replayed': any(row['replayed'] for row in native_batch),
            'auditIds': [row['audit']['auditId'] for row in native_batch],
        },
    }
    print(json.dumps(summary))
except sqlite3.Error as error:
    # Only SQLite's fixed error code and a checked identifier may be reported.
    # Never emit its arbitrary message, SQL values, bindings or traceback.
    code = getattr(error, 'sqlite_errorname', 'SQLiteError')
    if not re.fullmatch(r'[A-Z_]{1,80}', code):
        code = 'SQLiteError'
    diagnostic = {'code': code}
    missing = re.fullmatch(r'no such (column|table): ([a-z_][a-z0-9_.]{0,79})', str(error))
    if missing:
        diagnostic['missingKind'] = missing.group(1)
        diagnostic['identifier'] = missing.group(2)
    print(json.dumps(diagnostic), file=sys.stderr)
    sys.exit(1)
except (KeyError, TypeError, ValueError, IndexError) as error:
    # Report only the observer's fixed exception class and source line.
    trace = error.__traceback__
    while trace.tb_next is not None:
        trace = trace.tb_next
    print(json.dumps({'code': 'OBSERVER_' + type(error).__name__.upper(),
        'line': trace.tb_lineno}), file=sys.stderr)
    sys.exit(1)
finally:
    if connection is not None:
        connection.close()
`;
  const rows = spawnSync('python3', ['-c', linkageSql, join(data, 'atlas.sqlite'), view.scope.workspaceId, view.scope.homeId, receipt.operationId, asset.target.recordId, evidenceRecord.target.recordId, U(200), reason], { encoding: 'utf8' });
  if (rows.status !== 0) {
    let diagnostic = { code: 'ObserverFailedBeforeSQLiteDiagnostic' };
    try {
      const raw = JSON.parse(rows.stderr.trim());
      if (raw && typeof raw.code === 'string' && /^(?:[A-Z_]{1,80}|SQLiteError)$/.test(raw.code)) {
        diagnostic = { code: raw.code };
        if (Number.isSafeInteger(raw.line) && raw.line > 0) diagnostic.line = raw.line;
        if (/^(?:column|table)$/.test(raw.missingKind) && /^[a-z_][a-z0-9_.]{0,79}$/.test(raw.identifier))
          diagnostic = { ...diagnostic, missingKind: raw.missingKind, identifier: raw.identifier };
      }
    } catch { /* Unstructured stderr stays private. */ }
    console.error(JSON.stringify({ healthySqliteObservation: diagnostic }));
  }
  assert.equal(rows.status, 0, 'Actual read-only native/stock/consumption linkage observation');
  const persisted = JSON.parse(rows.stdout);
  assert.equal(persisted.schema, 5);
  assert.deepEqual(persisted.counts, { records: 8, audits: 3, receipts: 3, batch_receipts: 1, asset_manifests: 1, stock_operations: 1, stock_groups: 3, stock_keys: 4, stock_audit_links: 3, stock_history_lookup: 3, stock_history_cursors: 0, upload_consumptions: 1 });
  assert.deepEqual(persisted.commitWire, receipt); assert.equal(persisted.rootRequestId, receipt.requestId);
  assert.deepEqual(persisted.rootGuards, expectedStockGuards); assert.deepEqual(persisted.identityChildGuards, expectedStockGuards);
  assert.deepEqual(persisted.identityExpectedRevision, { kind: 'atlas', value: 1 });
  assert.equal(persisted.reasonsMatch, true);
  assert.deepEqual(persisted.keys, [{ ordinal: null, count: 1 }, { ordinal: 0, count: 1 }, { ordinal: 1, count: 1 }, { ordinal: 2, count: 1 }]);
  assert.equal(persisted.childWires.length, 3);
  for (const [index, child] of persisted.childWires.entries()) {
    assert.equal(child.status, 'committed'); assert.equal(child.replayed, false);
    assert.deepEqual(child.data.records, [receipt.data.records[index]]);
    assert.deepEqual(child.data.auditIds, [receipt.data.auditIds[index]]);
    assert.equal(child.commandId, ['atlas.asset.create', 'atlas.evidence.create', 'atlas.identity.replace'][index]);
    assert.equal(child.data.requestDigest, readbacks[index].stockHistory.requestDigest);
  }
  assert.equal(persisted.groupLinkage.length, 3);
  for (const [index, group] of persisted.groupLinkage.entries()) {
    assert.equal(group.ordinal, index); assert.equal(group.child_index, index); assert.equal(group.entry_ordinal, 0);
    assert.equal(group.command_id, persisted.childWires[index].commandId); assert.equal(group.state, 'committed');
    assert.equal(group.record_id, receipt.data.records[index].target.recordId);
    assert.equal(group.operation, index === 2 ? 'replace' : 'create');
    assert.equal(group.previousRevision, index === 2 ? 1 : null);
    assert.equal(group.resultRevision, index === 2 ? 2 : 1); assert.equal(group.revision, group.resultRevision);
    for (const fact of ['receiptHashMatches', 'receiptAuditMatches', 'historyCommandMatches', 'eventDigestMatches']) assert.equal(group[fact], 1);
  }
  assert.deepEqual(persisted.nativeBatch, { results: 3, replayed: false, auditIds: receipt.data.auditIds });
  assert.deepEqual(persisted.consumption, { count: 1, assetId: asset.target.recordId, groupOrdinal: 0, rootRequestMatches: true, assetRequestMatches: true, assetIntentMatches: true, groupMatches: true, auditMatches: true, assetMatches: true, manifestMatches: true, purpose: 'evidence-original', sourceLicense: license, filename, contentType: 'image/png', sha256: uploadSha256, byteSize: uploadBytes.length });
  // A second distinct user intent for identical bytes is ordinary attachment,
  // not a retry or replay: React issues fresh request and idempotency IDs.
  const originalRecord = await getJson(nativePrefix + '/asset/' + asset.target.recordId);
  assert.equal(originalRecord.status, 200);
  const secondStatement = 'Second fresh evidence intent referencing the same generated original.';
  const secondReason = 'Attach the same generated original with a separate fresh evidence intent.';
  await until(async () => await evaluate("Boolean(document.querySelector('form[aria-label=\"Atlas attachment\"] input[name=file]:not(:disabled)'))"), 'Refreshed actual attachment form');
  const secondDocument = await send('DOM.getDocument', { depth: 0 });
  const secondInput = await send('DOM.querySelector', { nodeId: secondDocument.root.nodeId, selector: 'form[aria-label="Atlas attachment"] input[name=file]' });
  await send('DOM.setFileInputFiles', { nodeId: secondInput.nodeId, files: [uploadFile] });
  await evaluate(`(()=>{const form=document.querySelector('form[aria-label="Atlas attachment"]');for(const [name,value] of Object.entries(${JSON.stringify({ statement:secondStatement, reason:secondReason })})){const field=form.querySelector('input[name='+name+']');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}const select=form.querySelector('select[name=license]');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate("document.querySelector('form[aria-label=\"Atlas attachment\"]').requestSubmit()");
  await until(() => uploadRequests.length === 2, 'Second fresh actual multipart POST');
  const secondCaptured = uploadRequests[1];
  await until(() => loaded.has(secondCaptured.requestId), 'Second fresh successful response completed');
  assert.equal(responses.find(response => response.requestId === secondCaptured.requestId)?.status, 200);
  const secondBody = await send('Network.getResponseBody', { requestId: secondCaptured.requestId });
  const secondReceipt = JSON.parse(secondBody.base64Encoded ? Buffer.from(secondBody.body,'base64').toString('utf8') : secondBody.body);
  await until(async () => await evaluate("document.querySelector('section[aria-label=\"Atlas place editing\"] [role=status]')?.textContent==='Saved. Information refreshed.' && document.querySelector('section[aria-label=\"Atlas place editing\"]')?.getAttribute('aria-busy')==='false'"), 'Second committed receipt and actual refresh');
  assert.notEqual(secondReceipt.requestId, receipt.requestId);
  assert.notEqual(secondReceipt.operationId, receipt.operationId);
  assert.equal(secondReceipt.status,'committed'); assert.equal(secondReceipt.replayed,false);
  assert.deepEqual(secondReceipt.data.records.map(row=>row.target.recordType),['evidence','identity']);
  const [secondEvidence, secondIdentity] = secondReceipt.data.records;
  assert.equal(secondIdentity.revision,3); assert.equal(secondEvidence.revision,1);
  assert.equal(secondEvidence.payload.statement,secondStatement);
  assert.deepEqual(secondEvidence.payload.references,[{kind:'atlas-asset',assetId:asset.target.recordId}]);
  assert.deepEqual(secondIdentity.payload,{...identity.payload,evidenceIds:[...identity.payload.evidenceIds,secondEvidence.target.recordId]});
  assert.deepEqual(JSON.parse(await evaluate("document.querySelector('section[aria-label=\"Atlas place editing\"] details pre')?.textContent")),secondReceipt);
  await checkReceiptLayout(secondReceipt);
  const unchangedAsset = await getJson(nativePrefix + '/asset/' + asset.target.recordId);
  assert.equal(unchangedAsset.status,200); assert.deepEqual(unchangedAsset.body,originalRecord.body);
  const originalHistory = await getJson(nativePrefix + '/asset/' + asset.target.recordId + '/history');
  assert.equal(originalHistory.status,200); assert.equal(originalHistory.body.length,1);
  assert.equal(originalHistory.body[0].auditId,receipt.data.auditIds[0]);
  const repeatedSql = String.raw`
import json,pathlib,sqlite3,sys
c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)
op=c.execute('SELECT original_json,commit_json FROM stock_operations WHERE operation_id=?',(sys.argv[2],)).fetchone()
root,commit=map(json.loads,op)
asset=sys.argv[3]
guard={'target':{'authority':'atlas','recordType':'asset','recordId':asset},'revision':{'kind':'atlas','value':1}}
children=root['payload']['commands']
counts={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['records','audits','receipts','batch_receipts','asset_manifests','stock_operations','stock_groups','stock_keys','upload_consumptions']}
print(json.dumps({'counts':counts,'commitWire':commit['wire'],'commands':[v['commandId'] for v in children],'freshKey':root['idempotencyKey']!=json.loads(c.execute('SELECT original_json FROM stock_operations WHERE operation_id=?',(sys.argv[4],)).fetchone()[0])['idempotencyKey'],'assetGuardBound':all(v['preconditions']['guards'].count(guard)==1 for v in [root,*children]),'noNewStageConsumption':c.execute('SELECT COUNT(*) FROM upload_consumptions WHERE root_operation_id=?',(sys.argv[2],)).fetchone()[0]==0}))
c.close()
`;
  const repeatedRows = spawnSync('python3',['-c',repeatedSql,join(data,'atlas.sqlite'),secondReceipt.operationId,asset.target.recordId,receipt.operationId],{encoding:'utf8'});
  assert.equal(repeatedRows.status,0,'Actual read-only second attachment observation');
  const repeated = JSON.parse(repeatedRows.stdout);
  assert.deepEqual(repeated.counts,{records:9,audits:5,receipts:5,batch_receipts:2,asset_manifests:1,stock_operations:2,stock_groups:5,stock_keys:7,upload_consumptions:1});
  assert.deepEqual(repeated.commitWire,secondReceipt);
  assert.deepEqual(repeated.commands,['atlas.evidence.create','atlas.identity.replace']);
  assert.equal(repeated.freshKey,true); assert.equal(repeated.assetGuardBound,true); assert.equal(repeated.noNewStageConsumption,true);
  let nativeMediaPublication=null;
  if(fixtureProfile==='native-media-archive') {
    const directory=join(data,'media-policy-archive'), members=readdirSync(directory);
    assert.deepEqual(members,[receipt.data.auditIds[0]+'.media-policy.json']);
    const file=join(directory,members[0]); assert.equal(statSync(file).mode&0o777,0o600);
    const packet=JSON.parse(readFileSync(file,'utf8'));
    assert.deepEqual(packet.entry.commit.wire,receipt);
    assert.equal(packet.entry.commit.operationId,receipt.operationId);
    nativeMediaPublication={member:members[0],mode:'0600',operationId:receipt.operationId,
      qualifiedRootAndThreeChildReceipts:true,unchangedAfterSecondFreshIntent:true};
  }
  // Observe only directory count; never record paths, stage tokens or bindings.
  const pendingStages = readdirSync(join(data,'media','uploads')).length;
  assert.equal(pendingStages,0,'Genuine committed stage metadata retired; reuse issued no stage');
  assert.equal(runtimeErrors.length, 0);
  assert(observedUrls.every(url => url.startsWith(origin + '/')), 'Every page request remains on the real loopback origin');
  assert(responses.every(response => response.status === 200 || (response.status === 204 && response.url === origin + '/favicon.ico')), 'Only ordinary successful responses occur');
  assert(responses.some(response => response.url === origin + '/api/atlas/auth/logout' && response.status === 200));
  assert(responses.some(response => response.url === origin + '/api/atlas/auth/login' && response.status === 200));
  const evidence = {
    source,nativeMediaPublication,
    flow: 'Two fresh healthy React attachment intents sharing one genuine original through Rust/SQLite/access/media/domain/stock peers',
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), browser: version.product,
    fixture: { initialRecords: 6, initialAudits: 0, preparedOriginals: preparedMedia.length, semanticsRecordId: U(400), identityRecordId: U(200) },
    upload: { filename, contentType: 'image/png', byteSize: uploadBytes.length, sha256: uploadSha256, reason, statement, sourceLicense: license, submissions: uploadRequests.length, formPolicy, receipt, canonicalReceiptDisplayed: true, actualRefresh: true },
    media: { status: delivered.status, bytesMatch: true, byteSize: uploadBytes.length, contentType: delivered.type, cache: delivered.cache, resource: delivered.resource, nosniff: delivered.nosniff },
    nativeWebMcp: { actualRegistration: true, visibleBeforeReturn: true, get: nativeRecord.wire, history: nativeHistory.wire },
    persisted: { counts: persisted.counts, orderedNativeStockHistoryLinkage: true, nativeBatchMatches: true, consumption: persisted.consumption, exactOriginalGuards: true, fullReasonPreserved: true, identityRevision: 2, semanticsRevision: 1 },
    repeatedAttachment: { receipt:secondReceipt, counts:repeated.counts, originalAssetUnchanged:true, originalAuditUnchanged:true, exactAssetRevisionGuard:true, noNewStageConsumption:true, pendingStages },
    observedRequests: observedUrls.length,
    receiptLayouts,
    limitations: ['One small generated PNG is attached through two separate fresh actual React intents; no text/PDF, large-file or maximum-range qualification.', 'The fresh schema-5 disposable database is observed read-only after success; no existing-database upgrade, retry, replay, recovery, crash, fault, expiry, revocation, denial or concurrency control.', 'No provider, remote listener, private household data, operational grant or deployment.'],
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
