/** One explicitly selected healthy synthetic retained-reader/browser example.
 * Actual production reader, diagram, viewer and CSS; fake document/geometry ports.
 * No native store, household source, credentials, provider, deployment or controls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const frontend = join(root, 'frontend');
const readerOnly = process.argv.slice(2).includes('--reader-only');
assert(process.argv.slice(2).every(arg => arg === '--reader-only'), 'Only --reader-only is supported');
assert.equal(process.version, 'v26.10.0', 'Use the retained pinned Node runtime');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
if (!readerOnly) assert(chromium && existsSync(chromium), 'Supply an inspected HOUSEATLAS_CHROMIUM executable, or explicitly select --reader-only');
const evidenceDirectory = process.env.HOUSEATLAS_FIXTURE_EVIDENCE;
if (evidenceDirectory) {
  const destination = resolve(evidenceDirectory);
  assert(destination !== root && !destination.startsWith(root + '/'), 'Evidence must stay outside the source checkout');
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
}
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-fixture-reader-'));
// Vite resolves React from the locked local installation, with no added dependency.
const generated = mkdtempSync(join(frontend, 'node_modules/.fixture-reader-'));
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceBase = '12044d16f80a65050392d34b15c93a955adba4b2';
const hash = value => createHash('sha256').update(value).digest('hex');
const productionPaths = [
  'frontend/integration/native-scene-source-client.ts',
  'frontend/src/numeric/decimal.ts', 'frontend/src/numeric/lossless-json.ts',
  'frontend/src/lantern/scans/presentation/room-region-model.ts',
  'frontend/src/lantern/overlays/electricity/documentary-adapter.ts',
  'frontend/src/lantern/overlays/electricity/ElectricityFixtureDiagram.tsx',
  'frontend/src/lantern/overlays/electricity/ElectricityDrawingViewer.tsx',
  'frontend/src/lantern/overlays/electricity/fixture.css',
  'frontend/src/lantern/overlays/electricity/drawing-viewer.css',
];
const productionDigests = Object.fromEntries(productionPaths.map(path => [path, hash(readFileSync(join(root, path)))]));

// This function is compiled together with the actual reader in Node and Chromium.
// It creates fresh positive inputs; neither documentary paths nor hashes are URLs.
async function readHealthyFixture(createNativeSceneSourceClient, ExactDecimal) {
  const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const viewKey = '9'.repeat(64), sourceFloorKey = 'source:synthetic-floor', sourceFloorHash = 'a'.repeat(64);
  const receiptCanonicalJson = '{"id":"synthetic-room-receipt","profile":"synthetic-only"}';
  const roomReceipt = { id: 'synthetic-room-receipt', sha256: await sha(receiptCanonicalJson) };
  const rooms = ['Alpha', 'Beta', 'Unmatched'].map((label, index) => ({ id: `room-${label.toLowerCase()}`, label,
    sourceFloorKey, sourceOriginalSha256: sourceFloorHash, sourceAnchorIds: [`anchor:${label}`],
    packagePlaceKey: `package:${label}`, packagePlaceUuid: U(20 + index), xFraction: .2 + index * .2, yFraction: .5 }));
  const media = [];
  for (const [index, label] of ['Alpha', 'Beta'].entries()) {
    const id = `drawing-${label.toLowerCase()}`, title = `Synthetic ${label} electrical drawing`, page = index === 0 ? 2 : 7;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="${index ? '#f6eadb' : '#e4edf9'}"/><text x="30" y="65" font-size="30">${label} · page ${page}</text><path d="M60 130H540V680H60Z M300 130V680 M60 400H540" fill="none" stroke="#23354d" stroke-width="4"/><circle cx="210" cy="300" r="18" fill="none" stroke="#23354d" stroke-width="4"/><text x="30" y="750" font-size="22">Generated synthetic source only</text></svg>`;
    media.push({ id, title, page, svg, sha256: await sha(svg), path: `/drawing-${label.toLowerCase()}.svg` });
  }
  const fixtureData = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'documentary-source-key', interpretationDate: '2026-10-10',
    symbolLegend: { xMeansSocket: true, socketsPerX: 1, receiptId: 'synthetic-symbol-receipt' },
    roomMappingReceipt: roomReceipt, registrationReceipts: [],
    sheets: media.map((m, index) => ({ id: m.id, title: m.title, pdfPage: m.page,
      originalPhoto: `originals/synthetic-${index}.svg`, originalPhotoSha256: m.sha256,
      renderedPhotoSha256: m.sha256, sourceDate: null, regionIds: [`region-${index}`] })),
    groups: media.map((_, index) => ({ id: `group-${index}`, label: `L${index + 1}`, fixtureIds: [`socket-${index}`],
      evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false })),
    regions: media.map((m, index) => ({ id: `region-${index}`, sheetId: m.id, label: rooms[index].label,
      sourceOutline: [], outlineClosed: false, sourceBounds: [.1, .1, .9, .9], outlineBasis: 'untraced',
      places: [{ packagePlaceKey: rooms[index].packagePlaceKey, packagePlaceUuid: rooms[index].packagePlaceUuid,
        label: rooms[index].label, basis: 'owner-reported' }], orientation: 'unregistered', physicalTransform: null })),
    fixtures: media.map((m, index) => ({ id: `socket-${index}`, sheetId: m.id, regionId: `region-${index}`,
      clusterId: null, kind: 'socket', label: `${rooms[index].label} socket`, glyph: 'X',
      source: { symbolKey: `symbol-${index}`, originalPhotoSha256: m.sha256, renderedPhotoSha256: m.sha256,
        normalizedBox: [.3, .3, .4, .4], normalizedPoint: [.35, .35], literalLabels: [`L${index + 1}`],
        placementDescription: 'Generated synthetic glyph.' },
      group: { id: `group-${index}`, label: `L${index + 1}`, basis: 'label-adjacent', note: 'Historical synthetic label.' },
      glyphCount: 1, fixtureCount: 1, uncertainty: null, currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null })),
  };
  const original = JSON.stringify({ schema: 'houseatlas.native-scene-source.v2', receiptCanonicalJson,
    rooms: { status: 'available', reason: null, receiptId: roomReceipt.id, receiptSha256: roomReceipt.sha256, entries: rooms, regions: [] },
    network: { status: 'unavailable', reason: 'not-retained', source: null, devices: null, endpoints: null, links: null },
    electricity: { status: 'unavailable', reason: 'not-retained', documentarySource: null, roomRegistry: null, buildingPackageKey: null, retrievedAt: null },
    electricalFixtures: { status: 'available', reason: null, documentaryFixtures: fixtureData },
  });
  const revision = ExactDecimal.parse('9007199254740993');
  const originalHash = await sha(original);
  const selection = { sessionIdentity: Object.freeze({}), workspaceId: U(1), homeId: U(2), buildingId: U(3), viewKey,
    expiresAt: new Date(Date.now() + 300_000).toISOString(), sceneEvidenceId: U(4), sceneAssetId: U(5),
    sceneOriginalSha256: originalHash, sceneEvidenceRevision: 7, sceneAssetRevision: revision,
    acceptedRoomReceiptId: roomReceipt.id, acceptedRoomReceiptSha256: roomReceipt.sha256,
    acceptedRoomAnchors: rooms.map(room => ({ id: room.sourceAnchorIds[0], sourceFloorKey, sourceOriginalSha256: sourceFloorHash,
      targets: [{ packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid }], unresolvedLabels: [] })),
    sourceFloorBindings: [{ sourceFloorKey, sourceOriginalSha256: sourceFloorHash, nativeFloorKey: 'native:floor',
      nativeOriginalAssetId: U(6), nativeOriginalSha256: sourceFloorHash, nativeGeometryId: U(7), nativeGeometryRevision: revision }],
  };
  const geometry = { viewKey, descriptor: { viewKey, buildingId: U(3), scope: { workspaceId: U(1), homeId: U(2) },
    floors: [{ floor: { key: 'native:floor', originalAssetId: U(6), originalSha256: sourceFloorHash, geometryId: U(7), geometryRevision: revision } }] } };
  const document = { lease: Object.freeze({}), evidenceId: U(4), evidenceRevision: 7, mode: 'original-download',
    asset: { assetId: U(5), sha256: originalHash, contentType: 'text/plain', revision } };
  const blob = new Blob([original], { type: 'text/plain' });
  let opens = 0, releases = 0, subscriptions = 0;
  const check = (condition, label) => { if (!condition) throw new Error(label); };
  const subscribe = () => { subscriptions++; return () => { subscriptions--; }; };
  const client = createNativeSceneSourceClient({
    getSelection: () => selection, subscribeSelection: subscribe,
    documents: {
      async open(id, signal) { check(id === selection.sceneEvidenceId && !signal.aborted, 'Exact healthy evidence open'); opens++; return document; },
      isCurrent: frame => frame === document && releases === 0, getBlob: frame => frame === document ? blob : null,
      subscribeInvalidation: subscribe, release(frame) { check(frame === document, 'Release exact document'); releases++; },
    },
    geometry: { isCurrent: frame => frame === geometry, subscribeInvalidation: subscribe },
  });
  try {
    const frame = await client.open(selection, geometry, new AbortController().signal);
    check(client.isCurrent(frame), 'Current reader frame');
    check(frame.electricalFixtures.status === 'available' && frame.rooms.status === 'available', 'Available source subsets');
    check(frame.sourceOriginalSha256 === originalHash && frame.sourceAssetId === U(5) && frame.sourceEvidenceId === U(4), 'Exact source identity');
    const data = frame.electricalFixtures.data;
    check(data.viewKey === viewKey && data.viewKey !== fixtureData.viewKey, 'Host supplies current view key');
    check(data.sheets.length === 2 && data.regions.length === 2 && data.fixtures.length === 2 && frame.roomSelections.length === 3, 'Complete synthetic memberships');
    check(Object.isFrozen(frame) && Object.isFrozen(data) && Object.isFrozen(data.sheets) && Object.isFrozen(data.fixtures[0].source), 'Immutable decoded source');
    const historicalOnly = data.registrationReceipts.length === 0
      && data.fixtures.every(f => f.currentState === 'historic-unverified' && f.physicalCoordinate === null && f.wireRoute === null)
      && data.groups.every(g => g.currentCircuitId === null && g.verifiedWiring === false)
      && data.regions.every(r => r.orientation === 'unregistered' && r.physicalTransform === null);
    check(historicalOnly, 'No invented current wiring or physical placement');
    for (const [index, room] of rooms.entries()) {
      const selected = frame.roomSelections.find(row => row.roomId === room.id)?.selection;
      check(selected?.status === 'accepted' && selected.viewKey === viewKey && selected.receiptId === roomReceipt.id
        && selected.sourceAnchorIds.length === 1 && selected.sourceAnchorIds[0] === room.sourceAnchorIds[0]
        && selected.unresolvedLabels.length === 0 && selected.targets.length === 1
        && selected.targets[0].packagePlaceKey === room.packagePlaceKey
        && selected.targets[0].packagePlaceUuid === room.packagePlaceUuid && selected.receiptSha256 === roomReceipt.sha256, 'Exact returned room selection');
      if (index < 2) check(data.fixtures[index].source.originalPhotoSha256 === media[index].sha256
        && data.sheets[index].pdfPage === media[index].page && data.sheets[index].regionIds[0] === `region-${index}`
        && data.regions[index].sheetId === media[index].id && data.fixtures[index].regionId === data.regions[index].id
        && data.fixtures[index].id === `socket-${index}` && data.groups[index].fixtureIds[0] === data.fixtures[index].id
        && data.regions[index].places[0].packagePlaceUuid === room.packagePlaceUuid, 'Exact associated source facts');
    }
    const proof = { sourceOriginalSha256: originalHash, assetRevision: document.asset.revision.token,
      receiptSha256: roomReceipt.sha256, opens, sheets: data.sheets.map(s => ({ id: s.id, page: s.pdfPage })),
      rooms: frame.roomSelections.map(r => ({ roomId: r.roomId, targets: r.selection.targets })), historicalOnly };
    return { frame, media, proof, dispose() { client.dispose(); check(releases === 1 && subscriptions === 0, 'Release one original lease and all subscriptions'); } };
  } catch (error) { client.dispose(); throw error; }
}

class CDP {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString();
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        if (message.id) {
          const pending = this.pending.get(message.id); if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params.request.url);
      }
    });
    child.on('exit', () => this.reject(new Error('Owned Chromium exited')));
    child.on('error', error => this.reject(error));
  }
  reject(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) { if (await read()) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}

let browser, server, cdp, session, origin, failure;
const results = [];
const screenshots = [];
const report = { sourceBase, sourceHead, productionDigests, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  node: process.version, mode: readerOnly ? 'reader-only' : 'reader-and-browser', results, screenshots };
const budget = setTimeout(() => { cdp?.reject(new Error('120-second fixture budget exhausted')); browser?.kill('SIGTERM'); server?.close(); }, 120_000);
try {
  const readerPath = join(generated, 'reader.ts');
  writeFileSync(readerPath, `import { createNativeSceneSourceClient } from ${JSON.stringify(join(frontend, 'integration/native-scene-source-client.ts'))};\nimport { ExactDecimal } from ${JSON.stringify(join(frontend, 'src/numeric/decimal.ts'))};\n${readHealthyFixture.toString()}\nexport const read = () => readHealthyFixture(createNativeSceneSourceClient, ExactDecimal);\n`);
  const bundled = await build({ configFile: false, root: frontend, logLevel: 'error', build: { ssr: readerPath, write: false, minify: false, target: 'esnext' } });
  const readerModule = await import(`data:text/javascript;base64,${Buffer.from(bundled.output.find(c => c.type === 'chunk').code).toString('base64')}`);
  const state = await readerModule.read();
  try { report.reader = state.proof; } finally { state.dispose(); }
  results.push({ case: 'retained-v2-reader-positive', status: 'passed', cleanup: 'one original released; subscriptions removed' });
  if (!readerOnly) {
    const appPath = join(generated, 'app.tsx');
    writeFileSync(appPath, `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { read } from './reader';
import { ElectricityFixtureDiagram } from ${JSON.stringify(join(frontend, 'src/lantern/overlays/electricity/ElectricityFixtureDiagram.tsx'))};
import { ElectricityDrawingViewer } from ${JSON.stringify(join(frontend, 'src/lantern/overlays/electricity/ElectricityDrawingViewer.tsx'))};
const state = await read();
window.__readerProof = state.proof;
window.__sourceOpens = [];
window.addEventListener('beforeunload', () => state.dispose(), { once: true });
function App() {
  const [roomId, setRoomId] = useState('room-alpha');
  const [region, setRegion] = useState(null);
  const [fixture, setFixture] = useState(null);
  const [group, setGroup] = useState(null);
  const [source, setSource] = useState(null);
  return <main><label>Fixture host room<select id="host-room" value={roomId} onChange={event => {
    setRoomId(event.target.value); setRegion(null); setFixture(null); setGroup(null);
  }}>{state.frame.rooms.data.rooms.map(room => <option key={room.id} value={room.id}>{room.label}</option>)}</select></label>
  <ElectricityFixtureDiagram active viewKey={state.frame.viewKey} data={state.frame.electricalFixtures.data}
    selectedPackagePlaces={state.frame.roomSelections.find(row => row.roomId === roomId).selection}
    selectedRegionId={region} selectedFixtureId={fixture} selectedGroup={group}
    onRegionChange={setRegion} onFixtureChange={setFixture} onGroupChange={setGroup}
    onOpenSource={(sheetId, page) => {
      const match = state.media.find(m => m.id === sheetId && m.page === page);
      if (!match) throw new Error('No exact synthetic host media mapping');
      window.__sourceOpens.push({ sheetId, page, roomId });
      setSource({ sheetId, title: match.title, pdfPage: page, kind: 'image', url: match.path,
        sha256: match.sha256, custody: 'native-retained-asset' });
    }} />
  <ElectricityDrawingViewer source={source} onClose={() => setSource(null)} /></main>;
}
createRoot(document.getElementById('root')).render(<App />);
`);
    const indexPath = join(generated, 'index.html');
    // Only harness framing is added; production component styles are bundled unchanged.
    writeFileSync(indexPath, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic fixture reader</title><style>body{margin:0;font:14px system-ui;background:#fff}main{padding:8px;box-sizing:border-box}main>label{display:grid;gap:4px;margin-bottom:12px}#host-room{max-width:100%;height:36px;font:inherit}</style><div id="root"></div><script type="module" src="./app.tsx"></script></html>');
    const dist = join(scratch, 'dist');
    await build({ configFile: false, root: generated, logLevel: 'error', build: { target: 'esnext', outDir: dist, emptyOutDir: true, minify: false, rollupOptions: { input: indexPath } } });
    const files = new Map();
    function collect(dir, prefix = '') { for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), url = prefix + '/' + entry.name;
      if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path));
    } }
    collect(dist);
    for (const m of state.media) files.set(m.path, Buffer.from(m.svg));
    server = createServer((request, response) => {
      assert.equal(request.method, 'GET');
      const path = request.url === '/' ? '/index.html' : request.url;
      if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const bytes = files.get(path);
      if (!bytes) { response.writeHead(404); response.end(); return; }
      const mime = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Content-Length': bytes.length }); response.end(bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-features=MediaRouter,OptimizationHints', `--user-data-dir=${join(scratch, 'browser')}`, 'about:blank'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    cdp = new CDP(browser);
    report.browser = (await cdp.send('Browser.getVersion')).product;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    const send = (method, params) => cdp.send(method, params, session);
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert(!result.exceptionDetails, result.exceptionDetails?.text ?? 'Browser evaluation'); return result.result.value;
    };
    const selector = text => `Array.from(document.querySelectorAll('button,a')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
    const click = async expression => {
      const box = await evaluate(`(()=>{const e=${expression};if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
      assert(box.width > 0 && box.height > 0);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: box.x, y: box.y });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: box.x, y: box.y });
    };
    const key = async (name, modifiers = 0) => {
      const code = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ' ': 32 }[name];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name,
        windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers,
        ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : name === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, modifiers });
    };
    const focus = expression => evaluate(`(${expression}).focus()`);
    const screenshot = async name => {
      if (!evidenceDirectory) return;
      const dialog = await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`);
      const content = (await send('Page.getLayoutMetrics')).cssContentSize;
      const viewportWidth = await evaluate('innerWidth');
      const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !dialog,
        ...(!dialog ? { clip: { x: 0, y: 0, width: viewportWidth, height: Math.min(content.height, 3000), scale: 1 } } : {}) })).data, 'base64');
      const path = join(evidenceDirectory, name + '.png'); writeFileSync(path, png, { mode: 0o600 }); screenshots.push({ name, path, sha256: hash(png) });
    };
    const layout = async expressions => {
      const actual = await evaluate(`(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
        dialog:(()=>{const d=document.querySelector('[role="dialog"]');if(!d)return null;const r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:d.scrollWidth>d.clientWidth+1}})(),
        boxes:[${expressions.join(',')}].map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})}))()`);
      assert.equal(actual.overflow, false, 'No horizontal document overflow');
      for (const box of actual.boxes) assert(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= actual.width + 1, `Reachable control: ${box.text}`);
      if (actual.dialog) {
        assert.equal(actual.dialog.overflow, false, 'No unintended horizontal dialog overflow');
        for (const box of actual.boxes) assert(box.left >= actual.dialog.left && box.right <= actual.dialog.right + 1
          && box.top >= actual.dialog.top && box.bottom <= actual.dialog.bottom + 1, `Control inside viewer: ${box.text}`);
      }
      return actual;
    };
    for (const width of [1280, 390, 312]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: origin + '/' });
      await until(() => evaluate(`Boolean(window.__readerProof && document.querySelector('.ef-source-button'))`), 'Parsed reader and rendered Alpha');
      assert.deepEqual(await evaluate('window.__readerProof'), report.reader, 'Browser and Node decode identical source facts');
      assert.equal(await evaluate(`document.querySelector('.ef-region-control select').value`), 'region-0', 'Alpha room selects associated region');
      assert.equal(await evaluate(`document.querySelector('.ef-source-bar').textContent.includes('Synthetic Alpha electrical drawing · p. 2')`), true);
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-fixture-id]')).map(e=>e.dataset.fixtureId)`), ['socket-0']);
      // Keyboard operates the actual select: Alpha -> Beta. The harness does not preselect a drawing region.
      await focus(`document.querySelector('#host-room')`); await key('ArrowDown'); await key('Enter');
      await until(() => evaluate(`document.querySelector('#host-room').value==='room-beta' && document.querySelector('.ef-region-control select').value==='region-1'`), 'Exact Beta room auto-selection');
      assert.equal(await evaluate(`document.querySelector('.ef-source-bar').textContent.includes('Synthetic Beta electrical drawing · p. 7')`), true);
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-fixture-id]')).map(e=>e.dataset.fixtureId)`), ['socket-1']);
      // Select a real SVG fixture by keyboard and exercise diagram selection zoom.
      await focus(`document.querySelector('[data-fixture-id="socket-1"]')`); await key('Enter');
      await until(() => evaluate(`Boolean(${selector('Zoom to selection')})`), 'Fixture selected');
      const initialViewBox = await evaluate(`document.querySelector('.ef-canvas svg').getAttribute('viewBox')`);
      await click(selector('Zoom to selection'));
      await until(() => evaluate(`document.querySelector('.ef-canvas svg').getAttribute('viewBox')!==${JSON.stringify(initialViewBox)}`), 'Diagram zoom changes viewBox');
      await click(selector('Fit region'));
      assert.equal(await evaluate(`document.querySelector('.ef-canvas svg').getAttribute('viewBox')`), initialViewBox);
      const diagramLayout = await layout([`document.querySelector('#host-room')`, `document.querySelector('.ef-region-control select')`, selector('Open source page')]);
      await screenshot(`fixture-${width}-beta`);
      await focus(selector('Open source page')); await key('Enter');
      await until(() => evaluate(`Boolean(document.querySelector('[role="dialog"] img')?.complete && document.querySelector('[role="dialog"] img')?.naturalWidth)`), 'Actual generated Beta image loaded');
      assert.equal(await evaluate(`document.querySelector('[role="dialog"] h2').textContent`), 'Synthetic Beta electrical drawing');
      assert.equal(await evaluate(`new URL(document.querySelector('[role="dialog"] img').src).pathname`), '/drawing-beta.svg');
      assert.deepEqual(await evaluate('window.__sourceOpens.at(-1)'), { sheetId: 'drawing-beta', page: 7, roomId: 'room-beta' });
      assert.equal(await evaluate(`document.activeElement.textContent`), 'Close drawing');
      const viewerLayout = await layout([selector('Close drawing'), selector('Zoom in'), selector('Zoom out'), selector('Fit')]);
      await key('Tab', 8); assert.equal(await evaluate('document.activeElement.textContent'), 'Open file', 'Shift+Tab wraps to last viewer control');
      await key('Tab'); assert.equal(await evaluate('document.activeElement.textContent'), 'Close drawing', 'Tab wraps to first viewer control');
      await focus(selector('Zoom in')); await key('Enter');
      await until(() => evaluate(`document.querySelector('.edv-tools [aria-live]').textContent==='150%'`), 'Viewer zoom in');
      assert.equal(await evaluate(`document.querySelector('.edv-image-stage').style.width`), '150%');
      await focus(selector('Zoom out')); await key(' ');
      await until(() => evaluate(`document.querySelector('.edv-tools [aria-live]').textContent==='100%'`), 'Viewer keyboard zoom out');
      await click(selector('Zoom in')); await click(selector('Fit'));
      assert.equal(await evaluate(`document.querySelector('.edv-image-stage').style.width`), '100%');
      await screenshot(`fixture-${width}-viewer-beta`);
      await key('Escape');
      await until(() => evaluate(`!document.querySelector('[role="dialog"]') && document.activeElement.textContent==='Open source page'`), 'Escape close and exact opener focus return');
      assert.equal(await evaluate('document.body.style.overflow'), '', 'Body scroll restored');
      // Deliberate documentary browsing uses the production region selector.
      await click(`document.querySelector('.ef-region-control select')`);
      await focus(`document.querySelector('.ef-region-control select')`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await key('Enter');
      await until(() => evaluate(`document.querySelector('.ef-region-control select').value==='region-0'`), 'Explicit Alpha region selection');
      await click(selector('Open source page'));
      await until(() => evaluate(`Boolean(document.querySelector('[role="dialog"] img')?.naturalWidth)`), 'Actual Alpha image loaded');
      assert.equal(await evaluate(`new URL(document.querySelector('[role="dialog"] img').src).pathname`), '/drawing-alpha.svg');
      assert.deepEqual(await evaluate('window.__sourceOpens.at(-1)'), { sheetId: 'drawing-alpha', page: 2, roomId: 'room-beta' });
      await click(selector('Close drawing'));
      await until(() => evaluate(`!document.querySelector('[role="dialog"]') && document.activeElement.textContent==='Open source page'`), 'Pointer close and focus return');
      // Normal unmatched source selection after both drawings; no negative transport/control injection.
      await focus(`document.querySelector('#host-room')`); await key('ArrowDown'); await key('Enter');
      await until(() => evaluate(`document.querySelector('#host-room').value==='room-unmatched'`), 'Select unmatched room');
      assert.equal(await evaluate(`document.querySelector('.ef-empty').textContent`), 'No drawing region is associated with this room.');
      assert.equal(await evaluate(`document.querySelectorAll('[data-fixture-id],.ef-source-button,[role="dialog"]').length`), 0, 'Unmatched room has no stale or first drawing');
      assert.equal(await evaluate(`document.querySelector('.ef-region-control select').value`), '');
      await key('Escape'); // Dismiss only the owned native select popup before capturing its empty state.
      await screenshot(`fixture-${width}-unmatched`);
      results.push({ case: `reader-room-fixture-viewer-${width}px`, status: 'passed', diagramLayout, viewerLayout,
        sourceOpens: await evaluate('window.__sourceOpens'), keyboard: 'room and region select, SVG fixture, open, zoom, Tab/Shift+Tab trap, Escape', focusReturn: 'keyboard and pointer close', unmatched: 'no default drawing' });
    }
    assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
    assert(cdp.requests.every(url => url.startsWith(origin + '/')), 'Every observed application request stays on owned loopback');
    report.applicationRequests = cdp.requests.map(url => new URL(url).pathname);
  }
} catch (error) {
  failure = error; report.error = { name: error.name, message: error.message };
  if (cdp && session && browser?.exitCode === null) {
    try {
      const observed = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `({
        text:document.body.innerText, focus:document.activeElement?.outerHTML,
        opens:window.__sourceOpens, images:Array.from(document.images).map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth}))})` }, session);
      report.failureObservation = observed.result.value;
      report.applicationRequests = cdp.requests.map(url => new URL(url).pathname);
      report.runtimeErrors = cdp.errors;
      if (evidenceDirectory) {
        const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' }, session)).data, 'base64');
        const path = join(evidenceDirectory, 'failure.png'); writeFileSync(path, png, { mode: 0o600 });
        screenshots.push({ name: 'failure', path, sha256: hash(png) });
      }
    } catch { /* Preserve the original test error if the browser is already gone. */ }
  }
}
finally {
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await cdp?.send('Browser.close').catch(() => {});
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGTERM');
    try { await until(() => browser.exitCode !== null || browser.signalCode !== null, 'Owned browser exit'); }
    catch (error) { browser.kill('SIGKILL'); try { await until(() => browser.exitCode !== null || browser.signalCode !== null, 'Owned browser final exit'); } catch { failure ??= error; } }
  }
  if (server) await new Promise(resolve => server.close(resolve));
  clearTimeout(budget);
  rmSync(generated, { recursive: true, force: true });
  if (!browser || browser.exitCode !== null || browser.signalCode !== null) rmSync(scratch, { recursive: true, force: true });
  report.cleanup = { browserStopped: !browser || browser.exitCode !== null || browser.signalCode !== null,
    listenerStopped: !server?.listening, generatedRemoved: !existsSync(generated), scratchRemoved: !existsSync(scratch) };
  if (!Object.values(report.cleanup).every(Boolean)) failure ??= new Error('Owned fixture cleanup incomplete');
  report.status = failure ? 'failed' : 'passed';
  if (evidenceDirectory) writeFileSync(join(evidenceDirectory, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify(report, null, 2));
if (failure) throw failure;
