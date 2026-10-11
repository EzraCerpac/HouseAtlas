/** Issue 149: bounded synthetic room-anchor preflight acceptance.
 * Exercises the production association prepare path and retained scene reader
 * with fake original-document, geometry, current-head, and admission ports.
 * The browser page is a self-contained file URL driven over owned Chrome CDP;
 * it uses no listener, external source, credential, or provider. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const frontend = join(root, 'frontend');
assert.equal(process.version, 'v26.10.0', 'Use the retained pinned Node runtime');
const chrome = process.env.HOUSEATLAS_CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert(existsSync(chrome), 'The pinned local Chromium executable must exist');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-issue149-'));
const generated = mkdtempSync(join(frontend, 'node_modules/.issue149-anchor-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const productionPaths = ['frontend/integration/native-scene-association-client.ts',
  'frontend/integration/native-scene-source-client.ts', 'frontend/src/numeric/schema-validator.ts'];
const productionDigests = Object.fromEntries(productionPaths.map(path => [path, hash(readFileSync(join(root, path)))]));

async function anchorFixture(createNativeSceneAssociationClient, ExactDecimal) {
  const assert = (condition, message = 'Synthetic assertion failed') => { if (!condition) throw new Error(message); };
  assert.equal = (actual, expected, message = 'Synthetic values differ') => {
    if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  };
  assert.match = (actual, pattern, message = 'Synthetic string did not match') => {
    if (!pattern.test(actual)) throw new Error(message);
  };
  const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const floorKey = 'synthetic-source-floor', roomId = 'synthetic-room-1';
  const roomKey = 'synthetic-package-room', roomUuid = U(31), wrongKey = 'other-package-room', wrongUuid = U(32);
  const historicalText = 'synthetic historical room receipt original';
  const historicalSha = await sha(historicalText);
  const baseAnchor = { id: 'anchor-room-1', sourceFloorKey: floorKey, sourceOriginalSha256: historicalSha,
    targets: [{ packagePlaceKey: roomKey, packagePlaceUuid: roomUuid }], unresolvedLabels: [] };
  const unrelated = { id: 'generic-unrelated-anchor', sourceFloorKey: floorKey,
    sourceOriginalSha256: historicalSha, targets: [
      { packagePlaceKey: 'generic-a', packagePlaceUuid: U(41) },
      { packagePlaceKey: 'generic-b', packagePlaceUuid: U(42) },
    ], unresolvedLabels: [] };
  const scenarios = {
    'two-target-room-anchor': [ { ...baseAnchor, targets: [...baseAnchor.targets,
      { packagePlaceKey: wrongKey, packagePlaceUuid: wrongUuid }] } ],
    'missing-room-anchor': [ { ...baseAnchor, id: 'different-anchor' } ],
    'missing-room-target': [ { ...baseAnchor, targets: [] } ],
    'mismatched-room-target': [ { ...baseAnchor, targets: [{ packagePlaceKey: wrongKey, packagePlaceUuid: wrongUuid }] } ],
    'room-anchor-floor-mismatch': [ { ...baseAnchor, sourceFloorKey: 'different-floor' } ],
    'room-anchor-hash-mismatch': [ { ...baseAnchor, sourceOriginalSha256: 'e'.repeat(64) } ],
    'singleton-room-anchor': [ baseAnchor ],
    'generic-unrelated-multi-target': [ baseAnchor, unrelated ],
  };
  const makeSource = async anchors => {
    const receipt = { anchors, profile: 'houseatlas.native-scene-room-review.v1',
      receiptId: U(50), sourceReceiptSha256: historicalSha };
    // Property order is RFC 8785 order for this closed synthetic receipt.
    const receiptCanonicalJson = JSON.stringify(receipt);
    const receiptSha = await sha(receiptCanonicalJson);
    const source = { schema: 'houseatlas.native-scene-source.v1', receiptCanonicalJson,
      rooms: { status: 'available', reason: null, receiptId: receipt.receiptId, receiptSha256: receiptSha,
        entries: [{ id: roomId, label: 'Synthetic room', sourceFloorKey: floorKey,
          sourceOriginalSha256: historicalSha, sourceAnchorIds: ['anchor-room-1'], packagePlaceKey: roomKey,
          packagePlaceUuid: roomUuid, xFraction: 0.5, yFraction: 0.5 }], regions: [] },
      network: { status: 'unavailable', reason: 'not-retained', source: null, devices: null, endpoints: null, links: null },
      electricity: { status: 'unavailable', reason: 'not-retained', documentarySource: null,
        roomRegistry: null, buildingPackageKey: null, retrievedAt: null } };
    return { sourceText: JSON.stringify(source), receipt, receiptCanonicalJson, receiptSha };
  };
  const geometryRevision = ExactDecimal.parse('1');
  const geometry = { lease: Object.freeze({}), viewKey: '9'.repeat(64), descriptor: {
    viewKey: '9'.repeat(64), buildingId: U(3), scope: { workspaceId: U(1), homeId: U(2) },
    floors: [{ floor: { key: 'native-floor', originalAssetId: U(61), originalSha256: 'a'.repeat(64),
      geometryId: U(62), geometryRevision } }],
  }, floors: [{ key: 'native-floor', geometryId: U(62), geometryRevision, originalAssetId: U(61),
    originalSHA256: 'a'.repeat(64) }], readPort: {} };
  const map = () => [{ sourceRoomId: roomId, sourceFloorKey: floorKey, sourceOriginalSha256: historicalSha,
    sourceAnchorIds: ['anchor-room-1'], targets: [{ packagePlaceKey: roomKey, packagePlaceUuid: roomUuid,
      atlasPlaceId: U(70) }], unresolvedLabels: [], evidenceIds: [U(10)] }];
  const sourceFloors = [{ sourceFloorKey: floorKey, sourceOriginalSha256: historicalSha,
    nativeFloorKey: 'native-floor', nativeGeometryId: U(62), nativeGeometryRevision: 1,
    nativeOriginalAssetId: U(61), nativeOriginalSha256: 'a'.repeat(64) }];
  const makeDocumentClient = (role, content, evidenceId, assetId, assetSha) => {
    const frame = { lease: Object.freeze({}), evidenceId, evidenceRevision: 1, mode: 'original-download',
      asset: { assetId, sha256: assetSha, contentType: 'text/plain', revision: geometryRevision } };
    let openCount = 0, releaseCount = 0;
    return { client: { async open(id, signal) { assert.equal(id, evidenceId); assert(!signal.aborted); openCount++; return frame; },
      isCurrent: value => value === frame, getBlob: value => value === frame ? new Blob([content], { type: 'text/plain' }) : null,
      subscribeInvalidation: () => () => {}, release(value) { assert.equal(value, frame); releaseCount++; }, dispose() {} },
      counters: () => ({ openCount, releaseCount }) };
  };

  async function run(name) {
    const { sourceText, receipt } = await makeSource(scenarios[name]);
    const primarySha = await sha(sourceText), historicalDoc = makeDocumentClient('historical', historicalText, U(11), U(21), historicalSha);
    const primaryDoc = makeDocumentClient('primary', sourceText, U(10), U(20), primarySha);
    const sessionIdentity = Object.freeze({}), scope = { workspaceId: U(1), homeId: U(2) };
    const context = { sessionIdentity, session: { schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-csrf',
      expiresAt: new Date(Date.now() + 120_000).toISOString() }, view: { scope, canEdit: true },
      admission: { scope, revision: 1, commandIds: ['atlas.scene-association.create'] } };
    let posts = 0, gets = 0;
    const client = createNativeSceneAssociationClient({ getContext: () => context, subscribe: () => () => {},
      primaryReview: primaryDoc.client, historicalReview: historicalDoc.client, geometryCurrent: value => value === geometry,
      async transport(url, init = {}) {
        if (init.method === 'POST') { posts++; throw new Error('POST forbidden in synthetic preflight fixture'); }
        assert.equal(init.method, 'GET'); assert.match(url, /\/buildings\/[0-9a-f-]+\/current$/); gets++;
        return new Response(JSON.stringify({ status: 'unavailable', reason: 'no-current-association', association: null }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      } });
    const candidate = { buildingId: U(3), primaryEvidenceId: U(10), historicalEvidenceId: U(11),
      sourceFloors, roomMappings: map(), guards: [{ target: { authority: 'atlas', recordType: 'identity', recordId: U(70) },
        revision: { kind: 'atlas', value: 1 } }] };
    try {
      let prepared = null, rejected = false, failure = '';
      try { prepared = await client.prepare(candidate, geometry, 'Reviewed synthetic association', 'Synthetic acceptance fixture', new AbortController().signal); }
      catch (error) { rejected = true; failure = String(error?.stack || error); }
      const expectedReject = name !== 'singleton-room-anchor' && name !== 'generic-unrelated-multi-target';
      assert.equal(rejected, expectedReject, `${name} expected ${expectedReject ? 'preflight rejection' : 'acceptance'} (${failure})`);
      assert.equal(posts, 0, `${name} must reject or prepare without POST`);
      assert.equal(gets, 1, `${name} performs exactly one fake current-head GET before preflight (${failure})`);
      if (prepared) {
        assert.equal(prepared.payload.acceptedReceipt.anchors.length, receipt.anchors.length);
        client.releasePrepared(prepared);
      }
      return { case: name, result: expectedReject ? 'rejected-before-post' : 'prepared', posts, gets };
    } finally { client.dispose(); primaryDoc.client.dispose(); historicalDoc.client.dispose(); }
  }
  return { run };
}

async function readSuccessfulSelection(createNativeSceneSourceClient, ExactDecimal) {
  const assert = (condition, message = 'Synthetic reader assertion failed') => { if (!condition) throw new Error(message); };
  assert.equal = (actual, expected, message = 'Synthetic reader values differ') => {
    if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  };
  const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const hashText = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const floorKey = 'synthetic-source-floor', sourceHash = 'b'.repeat(64), placeKey = 'synthetic-package-room', placeUuid = U(31);
  const historicalText = 'synthetic historical original';
  const historicalSha = await hashText(historicalText);
  const anchor = { id: 'anchor-room-1', sourceFloorKey: floorKey, sourceOriginalSha256: historicalSha,
    targets: [{ packagePlaceKey: placeKey, packagePlaceUuid: placeUuid }], unresolvedLabels: [] };
  const unrelated = { id: 'generic-unrelated-anchor', sourceFloorKey: floorKey, sourceOriginalSha256: historicalSha,
    targets: [{ packagePlaceKey: 'generic-a', packagePlaceUuid: U(41) },
      { packagePlaceKey: 'generic-b', packagePlaceUuid: U(42) }], unresolvedLabels: [] };
  const receipt = { anchors: [anchor, unrelated], profile: 'houseatlas.native-scene-room-review.v1',
    receiptId: U(50), sourceReceiptSha256: historicalSha };
  const literal = JSON.stringify(receipt), receiptSha = await hashText(literal);
  const source = JSON.stringify({ schema: 'houseatlas.native-scene-source.v1', receiptCanonicalJson: literal,
    rooms: { status: 'available', reason: null, receiptId: receipt.receiptId, receiptSha256: receiptSha,
      entries: [{ id: 'synthetic-room-1', label: 'Synthetic room', sourceFloorKey: floorKey,
        sourceOriginalSha256: historicalSha, sourceAnchorIds: [anchor.id], packagePlaceKey: placeKey,
        packagePlaceUuid: placeUuid, xFraction: 0.5, yFraction: 0.5 }], regions: [] },
    network: { status: 'unavailable', reason: 'not-retained', source: null, devices: null, endpoints: null, links: null },
    electricity: { status: 'unavailable', reason: 'not-retained', documentarySource: null,
      roomRegistry: null, buildingPackageKey: null, retrievedAt: null } });
  const sourceSha = await hashText(source), sessionIdentity = Object.freeze({}), revision = ExactDecimal.parse('1');
  const geometry = { lease: Object.freeze({}), viewKey: '9'.repeat(64), descriptor: { viewKey: '9'.repeat(64),
    buildingId: U(3), scope: { workspaceId: U(1), homeId: U(2) }, floors: [{ floor: { key: 'native-floor',
      originalAssetId: U(61), originalSha256: 'a'.repeat(64), geometryId: U(62), geometryRevision: revision } }] },
    floors: [], readPort: {} };
  const selection = { sessionIdentity, workspaceId: U(1), homeId: U(2), buildingId: U(3), viewKey: geometry.viewKey,
    expiresAt: new Date(Date.now() + 120_000).toISOString(), sceneEvidenceId: U(10), sceneAssetId: U(20),
    sceneOriginalSha256: sourceSha, sceneEvidenceRevision: 1, sceneAssetRevision: revision,
    acceptedRoomReceiptId: receipt.receiptId, acceptedRoomReceiptSha256: receiptSha,
    acceptedRoomAnchors: [anchor, unrelated], sourceFloorBindings: [{ sourceFloorKey: floorKey,
      sourceOriginalSha256: historicalSha, nativeFloorKey: 'native-floor', nativeOriginalAssetId: U(61),
      nativeOriginalSha256: 'a'.repeat(64), nativeGeometryId: U(62), nativeGeometryRevision: revision }] };
  const frame = { lease: Object.freeze({}), evidenceId: U(10), evidenceRevision: 1, mode: 'original-download',
    asset: { assetId: U(20), sha256: sourceSha, contentType: 'text/plain', revision } };
  let releases = 0;
  const documents = { async open(id) { assert.equal(id, U(10)); return frame; }, isCurrent: value => value === frame,
    getBlob: value => value === frame ? new Blob([source], { type: 'text/plain' }) : null,
    subscribeInvalidation: () => () => {}, release(value) { assert.equal(value, frame); releases++; }, dispose() {} };
  const client = createNativeSceneSourceClient({ getSelection: () => selection, subscribeSelection: () => () => {},
    documents, geometry: { isCurrent: value => value === geometry, subscribeInvalidation: () => () => {} } });
  try {
    const read = await client.open(selection, geometry, new AbortController().signal);
    assert.equal(read.rooms.status, 'available');
    assert.equal(read.rooms.data.rooms.length, 1);
    assert.equal(read.roomSelections[0].selection.targets.length, 1);
    assert.equal(read.roomSelections[0].selection.targets[0].packagePlaceUuid, placeUuid);
    assert.equal(selection.acceptedRoomAnchors.find(row => row.id === unrelated.id).targets.length, 2,
      'reader selection retains an unrelated generic multi-target anchor');
    assert(client.isCurrent(read));
    return { case: 'reader-opens-singleton-room-with-unrelated-generic-multi-target', status: 'passed',
      roomId: read.rooms.data.rooms[0].id, selectedTarget: placeUuid };
  } finally { client.dispose(); assert.equal(releases, 1); }
}

class CDP {
  constructor(child) { this.child = child; this.next = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => { this.buffer += bytes.toString(); let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) { const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        if (message.id) { const pending = this.pending.get(message.id); if (!pending) continue; clearTimeout(pending.timer); this.pending.delete(message.id);
          message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
        else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params.request.url); } });
    child.on('exit', (code, signal) => this.reject(new Error(`Owned Chromium exited (code=${code}, signal=${signal})`)));
    child.on('error', error => this.reject(error)); }
  reject(error) { for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(error); } this.pending.clear(); }
  send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++this.next;
    const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
    this.pending.set(id, { resolve, reject, timer }); this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); }); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) { const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) { if (await read()) return; await wait(40); } throw new Error(`Timed out: ${label}`); }

let browser, cdp, chromeErrors = '', browserStage = 'not-started', reader, browserMatrix = 'not-run';
const results = [];
const deadline = setTimeout(() => { cdp?.reject(new Error('120-second fixture budget exhausted')); browser?.kill('SIGTERM'); }, 120_000);
try {
  const fixturePath = join(generated, 'fixture.ts');
  writeFileSync(fixturePath, `import { createNativeSceneAssociationClient } from ${JSON.stringify(join(frontend, 'integration/native-scene-association-client.ts'))};\nimport { createNativeSceneSourceClient } from ${JSON.stringify(join(frontend, 'integration/native-scene-source-client.ts'))};\nimport { ExactDecimal } from ${JSON.stringify(join(frontend, 'src/numeric/decimal.ts'))};\n${anchorFixture.toString()}\n${readSuccessfulSelection.toString()}\nexport const fixture = anchorFixture(createNativeSceneAssociationClient, ExactDecimal);\nexport const readSelection = () => readSuccessfulSelection(createNativeSceneSourceClient, ExactDecimal);\n`);
  const ssrBuild = await build({ configFile: false, root: frontend, logLevel: 'error', build: { ssr: fixturePath, write: false, minify: false, target: 'esnext' } });
  const ssrCode = ssrBuild.output.find(chunk => chunk.type === 'chunk').code;
  const runnerPath = join(generated, 'runner.mjs'); writeFileSync(runnerPath, ssrCode);
  const module = await import(pathToFileURL(runnerPath).href);
  const names = ['two-target-room-anchor','missing-room-anchor','missing-room-target','mismatched-room-target','room-anchor-floor-mismatch',
    'room-anchor-hash-mismatch','singleton-room-anchor','generic-unrelated-multi-target'];
  const fixture = await module.fixture;
  for (const name of names) results.push(await fixture.run(name));
  reader = await module.readSelection();

  const appPath = join(generated, 'app.ts');
  writeFileSync(appPath, `import { fixture as fixturePromise } from './fixture';\nconst names = ${JSON.stringify(names)};\nwindow.__results = [];\nwindow.__done = false;\nasync function runAll(){ try { const fixture = await fixturePromise; for (const name of names) { window.__results.push(await fixture.run(name)); } window.__done = true; } catch (e) { window.__error = String(e?.stack || e); window.__done = true; } }\nwindow.runAll = runAll;\ndocument.getElementById('run').addEventListener('click', runAll);\n`);
  const browserBuild = await build({ configFile: false, root: frontend, logLevel: 'error', build: {
    write: false, minify: true, target: 'es2022', cssCodeSplit: false,
    rollupOptions: { input: appPath, output: { inlineDynamicImports: true } },
  } });
  const bundle = browserBuild.output.find(chunk => chunk.type === 'chunk').code;
  const htmlPath = join(scratch, 'issue149.html');
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><title>Issue 149 synthetic acceptance</title><button id="run">Run synthetic cases</button><pre id="out"></pre><script>${bundle}\nwindow.addEventListener('click',()=>{setTimeout(()=>document.getElementById('out').textContent=JSON.stringify({results:window.__results,error:window.__error,done:window.__done},null,2),0)});</script>`);
  browser = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
    '--disable-features=MediaRouter,OptimizationHints',
    '--remote-debugging-pipe',`--user-data-dir=${join(scratch,'profile')}`,
    'about:blank'], { stdio: ['ignore','ignore','ignore','pipe','pipe'] });
  cdp = new CDP(browser);
  browserStage = 'Browser.getVersion';
  await cdp.send('Browser.getVersion');
  browserStage = 'Target.createTarget';
  const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
  browserStage = 'Target.attachToTarget';
  const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const session = attached.sessionId;
  browserStage = 'enable domains';
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Network.enable', {}, session);
  await cdp.send('Page.navigate', { url: `file://${htmlPath}` }, session);
  browserStage = 'file page ready';
  await until(async () => (await cdp.send('Runtime.evaluate', { expression: 'document.readyState === "complete"', returnByValue: true }, session)).result.value, 'inline file page ready');
  const bounds = await cdp.send('Runtime.evaluate', { expression: '(()=>{const r=document.getElementById("run").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()', returnByValue: true }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.result.value.x, y: bounds.result.value.y }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.result.value.x, y: bounds.result.value.y, button: 'left', clickCount: 1 }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.result.value.x, y: bounds.result.value.y, button: 'left', clickCount: 1 }, session);
  browserStage = 'browser preflight matrix';
  await until(async () => (await cdp.send('Runtime.evaluate', { expression: 'window.__done === true', returnByValue: true }, session)).result.value, 'browser preflight matrix');
  const browserState = await cdp.send('Runtime.evaluate', { expression: '({results:window.__results,error:window.__error})', returnByValue: true }, session);
  assert.equal(browserState.result.value.error, undefined, browserState.result.value.error);
  assert.deepEqual(browserState.result.value.results, results, 'CDP browser exercised real prepare with same fake ports');
  assert.deepEqual(cdp.errors, []);
  assert(cdp.requests.every(url => url.startsWith('file://')), `Unexpected browser request: ${cdp.requests.join(', ')}`);
  browserMatrix = 'passed';
  console.log(JSON.stringify({ sourceHead, productionDigests, node: process.version, browser: 'owned headless Chrome via CDP pipe; inline file URL',
    browserRequests: cdp.requests, results, reader, browserMatrix }, null, 2));
} catch (error) {
  throw new Error(`${error?.stack || error}\nBrowser stage: ${browserStage}\nChrome stderr: ${chromeErrors || 'empty'}`);
} finally {
  clearTimeout(deadline);
  cdp?.reject(new Error('fixture cleanup'));
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGTERM');
    let exited = await Promise.race([new Promise(resolve => browser.once('exit', () => resolve(true))), wait(2500).then(() => false)]);
    if (!exited) {
      browser.kill('SIGKILL');
      exited = await Promise.race([new Promise(resolve => browser.once('exit', () => resolve(true))), wait(3000).then(() => false)]);
    }
    assert(exited || browser.exitCode !== null || browser.signalCode !== null,
      'Owned Chrome must exit before scratch cleanup');
  }
  rmSync(scratch, { recursive: true, force: true }); rmSync(generated, { recursive: true, force: true });
}
