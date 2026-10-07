// Standalone healthy opaque-collection cached read, derived from the
// inspected ordinary read runner; only actual authorized loopback reads.
// Browser stderr is retained only before any page, cookie or authentication work.
// One cached GET; no HTTP login/logout/write/MCP, stopped control or provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureProfile = 'opaque-cached-homebox';
const sourceInstanceId = '00000000-0000-4000-8000-000000000010';
const collection = 'Synthetic / cache? α + %';
const expectedFixture = JSON.parse(readFileSync(join(root, 'packages/contracts/fixtures/plan-free.snapshot.json'), 'utf8'));
// Only select the published minimum fixture and rebind its exact source keys.
// No JavaScript business-rule peer or synthetic authorization is substituted.
expectedFixture.sources = expectedFixture.sources.filter(source => source.sourceInstanceId === sourceInstanceId);
const retainedIds = ['100', '200', '201', '300', '301', '400'].map(suffix => '00000000-0000-4000-8000-000000000' + suffix);
expectedFixture.records = expectedFixture.records.filter(record => retainedIds.includes(record.recordId));
expectedFixture.homeboxEntities = expectedFixture.homeboxEntities.slice(0, 2);
expectedFixture.networkRelations = [];
function rebindPublishedKeys(value) {
  if (Array.isArray(value)) return value.reduce((total, child) => total + rebindPublishedKeys(child), 0);
  if (!value || typeof value !== 'object') return 0;
  const matched = value.sourceInstanceId === sourceInstanceId && value.collectionId === 'synthetic-collection-a';
  if (matched) value.collectionId = collection;
  return Number(matched) + Object.values(value).reduce((total, child) => total + rebindPublishedKeys(child), 0);
}
assert.equal(rebindPublishedKeys(expectedFixture), 8, 'Exact eight published Source10 collection keys rebound');
assert.equal(expectedFixture.sources.length, 1);
assert.equal(expectedFixture.homeboxEntities.length, 2);
assert.equal(process.version, 'v26.10.0');
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert(chromium, 'A real Chromium executable is required');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-at52-cache-unicode-'));
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
const observedUrls = [], observedMethods = [], responses = [], runtimeErrors = [];
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0); stopped = null;
  constructor(process) {
    this.process = process;
    const stopped = error => {
      this.stopped ??= error;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(this.stopped); }
      this.pending.clear();
    };
    process.on('error', stopped);
    process.on('exit', (code, signal) => stopped(new Error('Chrome exited: code=' + code + ' signal=' + signal)));
    process.stdio[3].on('error', stopped);
    process.stdio[4].on('error', stopped);
    process.stdio[4].on('end', () => stopped(new Error('Chrome CDP output ended')));
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
          observedUrls.push(message.params.request.url);
          observedMethods.push(message.params.request.method);
        }
        else if (message.method === 'Network.responseReceived') responses.push({ url: message.params.response.url, status: message.params.response.status });
        else if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      }
    });
  }
  send(method, params = {}, sessionId) {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
try {
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key, '--fixture-profile', fixtureProfile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', b => { serviceOutput += b; }); service.stderr.on('data', b => { serviceError += b; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Rust startup failed: ' + serviceError);
    return existsSync(join(data, 'smoke-session.json')) && serviceOutput.includes('listening at');
  }, 'actual Rust TLS listener', 30000);
  const { origin, cookie } = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const startupStarted = performance.now();
  let startupFinished = false, startupStderr = Buffer.alloc(0), startupStderrTruncated = false;
  browser.stderr.on('error', () => {});
  browser.stderr.on('data', chunk => {
    if (startupFinished) return;
    const available = 65536 - startupStderr.length;
    if (chunk.length > available) startupStderrTruncated = true;
    startupStderr = Buffer.concat([startupStderr, chunk.subarray(0, available)]);
  });
  cdp = new Pipe(browser);
  let version;
  try {
    version = await cdp.send('Browser.getVersion');
    console.log(JSON.stringify({ startupOnly: true, product: version.product, milliseconds: Math.round(performance.now() - startupStarted) }));
  } catch (error) {
    console.error(JSON.stringify({ startupOnly: true, beforeAnyPageOrCookie: true,
      milliseconds: Math.round(performance.now() - startupStarted), message: error.message,
      exitCode: browser.exitCode, signalCode: browser.signalCode,
      stderr: startupStderr.toString('utf8').replaceAll(scratch, '<disposable-profile>'), startupStderrTruncated }));
    throw error;
  } finally { startupFinished = true; }

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
  assert.equal(installed.success, true, 'Browser receives the actual issued Secure cookie');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
  const api = await evaluate("(async () => { const results=[]; for (const path of ['/api/atlas/view','/api/atlas/rooms','/api/atlas/items','/api/atlas/homes','/api/atlas/auth/session']) { const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error'}); results.push({path,status:response.status,cache:response.headers.get('cache-control'),pragma:response.headers.get('pragma'),nosniff:response.headers.get('x-content-type-options'),referrer:response.headers.get('referrer-policy'),vary:response.headers.get('vary'),body:await response.json()}); } return results; })()");
  assert(api.every(r => r.status === 200 && r.cache === 'private, no-store' && r.pragma === 'no-cache' && r.nosniff === 'nosniff' && r.referrer === 'same-origin' && r.vary === 'Cookie, Origin, Sec-Fetch-Site'), 'Actual authorized API GETs');
  const view = api[0].body;
  assert.equal(view.status, 'ready'); assert.equal(view.entries.length, 2); assert.equal(view.canEdit, false);
  assert.equal(api[1].body.length, 1); assert.equal(api[2].body.length, 1);
  assert.equal(api[3].body.length, 1); assert.equal(Object.keys(api[3].body[0]).length, 3);
  assert.equal(api[4].body.schemaVersion, 1); assert.equal(typeof api[4].body.expiresAt, 'string');
  const room = view.entries.find(e => e.semanticKind === 'room'), item = view.entries.find(e => e.kind === 'item');
  assert(room && item, 'Explicit reviewed room and actual saved item');
  assert(view.entries.every(entry => entry.source.sourceInstanceId === sourceInstanceId && entry.source.collectionId === collection), 'Actual authorized entries retain the exact opaque collection');
  assert.deepEqual(api[1].body, [room], 'Authorized rooms use the same browser entry projection');
  assert.deepEqual(api[2].body, [item], 'Authorized items use the same browser entry projection');
  assert.equal(item.entity.parent, null); assert.equal(item.mobility, 'unknown');
  assert(view.entries.every(e => e.nativeLinks.length === 0 && e.networkRelations.length === 0), 'No unissued capabilities');
  assert(item.attachments.filter(a => a.kind === 'stored-file').every(a => a.downloadHref === null && a.previewHref === null));
  const cachedPath = `/api/atlas/providers/homebox/workspaces/${view.scope.workspaceId}/homes/${view.scope.homeId}/sources/${sourceInstanceId}/cached?collection=${encodeURIComponent(collection)}`;
  const cached = await evaluate(`fetch(${JSON.stringify(cachedPath)},{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}}).then(async r=>({status:r.status,cache:r.headers.get('cache-control'),pragma:r.headers.get('pragma'),nosniff:r.headers.get('x-content-type-options'),referrer:r.headers.get('referrer-policy'),vary:r.headers.get('vary'),body:await r.json()}))`);
  assert.equal(cached.status, 200, 'One actual authorized cached-only query GET');
  assert.equal(cached.cache, 'private, no-store'); assert.equal(cached.pragma, 'no-cache');
  assert.equal(cached.nosniff, 'nosniff'); assert.equal(cached.referrer, 'same-origin');
  assert.equal(cached.vary, 'Cookie, Origin, Sec-Fetch-Site');
  const expectedCache = expectedFixture.caches.find(cache => cache.workspaceId === view.scope.workspaceId && cache.homeId === view.scope.homeId && cache.sourceInstanceId === sourceInstanceId && cache.collectionId === collection);
  assert(expectedCache, 'Exact scoped published cache metadata exists');
  assert.deepEqual(cached.body, { homeboxEntities: expectedFixture.homeboxEntities, cache: expectedCache }, 'Complete original projections and cache facts survive exact Source10 rebinding');
  assert(cached.body.homeboxEntities.every(projection => projection.nativeLinks.every(link => link.verifiedRoute === false)), 'Original unverified native-link descriptors remain unverified data');
  await evaluate("location.hash='#places'");
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes(room.entity.name), 'React Rooms & places');
  await evaluate('location.hash=' + JSON.stringify('#place?key=' + encodeURIComponent(room.key)));
  await until(async () => (await evaluate('document.querySelector(".record-head")?.innerText ?? ""')).includes(room.entity.name), 'React room detail');
  await evaluate('location.hash=' + JSON.stringify('#item?key=' + encodeURIComponent(item.key)));
  await until(async () => (await evaluate('document.querySelector(".record-head")?.innerText ?? ""')).includes(item.entity.name), 'React item detail');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (process.env.HOUSEATLAS_SCREENSHOT) writeFileSync(process.env.HOUSEATLAS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  const scoped = '/api/atlas/homes/' + view.scope.workspaceId + '/' + view.scope.homeId + '/view';
  const result = await evaluate('fetch(' + JSON.stringify(scoped) + ",{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(result.status, 200); assert.deepEqual(result.body.scope, view.scope);
  assert.equal(runtimeErrors.length, 0, 'No browser runtime exceptions in healthy flow');
  assert(observedUrls.every(url => url.startsWith(origin + '/')), 'Observed page requests stay on loopback');
  assert(observedMethods.every(method => method === 'GET'), 'Every actual page request in this ordinary slice is a GET');
  assert.equal(observedUrls.filter(url => url === origin + cachedPath).length, 1, 'Exactly one actual query cached read');
  assert(observedUrls.every(url => !new URL(url).pathname.includes('/mcp/') && !new URL(url).pathname.endsWith('/auth/login') && !new URL(url).pathname.endsWith('/auth/logout')), 'Healthy read-only surface remains scoped');
  assert(responses.every(r => r.status === 200 || (r.status === 204 && r.url === origin + '/favicon.ico')), 'Observed healthy page responses');
  const sql = [
    'import sqlite3,json,sys', 'from pathlib import Path', 'root=Path(sys.argv[1])',
    "atlas=sqlite3.connect((root/'atlas.sqlite').as_uri()+'?mode=ro',uri=True)",
    "access=sqlite3.connect((root/'access.sqlite').as_uri()+'?mode=ro',uri=True)",
    'try:',
    " counts={table:atlas.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ['records','projections','audits']}",
    " counts['sessions']=access.execute('SELECT COUNT(*) FROM access_sessions').fetchone()[0]",
    " def rows(table,order='collection_id'):",
    "  return [{'partition':list(row[:4]),'body':json.loads(row[4])} for row in atlas.execute('SELECT workspace_id,home_id,source_instance_id,collection_id,body FROM '+table+' ORDER BY '+order)]",
    " print(json.dumps({'counts':counts,'sources':rows('sources'),'caches':rows('caches'),'projections':rows('projections','external_id')},ensure_ascii=False))",
    'finally:',
    ' atlas.close(); access.close()'
  ].join('\n');
  const rows = spawnSync('python3', ['-c', sql, data], { encoding: 'utf8' });
  assert.equal(rows.status, 0);
  const persisted = JSON.parse(rows.stdout);
  assert.deepEqual(persisted.counts, {records:6,projections:2,audits:0,sessions:1});
  const partition = [view.scope.workspaceId, view.scope.homeId, sourceInstanceId, collection];
  assert.deepEqual(persisted.sources, [{ partition, body: expectedFixture.sources[0] }], 'Actual SQLite source registration retains the exact opaque collection');
  assert.deepEqual(persisted.caches, [{ partition, body: expectedCache }], 'Actual SQLite cache retains original dates and generation');
  assert.deepEqual(persisted.projections, expectedFixture.homeboxEntities.map(body => ({ partition, body })), 'Actual SQLite projection keys and complete stored bodies match the public fixture');
  const evidence = { rust:serviceOutput.trim(), browser:version.product, fixtureProfile, collection,
    apiReads:api.map(({path,status})=>({path,status})), scopedRead:result.status,
    cachedRead:{status:cached.status,queryField:'collection',count:1,projections:2,cache:expectedCache,publicFixtureRebindings:8},
    rooms:1, items:1, homeboxCanEdit:view.canEdit, nativeLinks:0, persisted:persisted.counts,
    storedCollectionSelectors:persisted.sources.map(row=>row.partition), observedRequests:observedUrls.length,
    scope:'Actual Rust/SQLite/AT11 Viewer/React positive loopback TLS reads and one cached HomeBox query GET. No HTTP login/logout/write/MCP, stopped controls or external providers.' };
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
