/** Proposed bounded healthy fictional browser check. Register this exact
 * command before execution. No screenshots or live native/provider fallback. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { pdfjsBinaryDataPlugin } from '../build/pdfjs-binary-data-plugin.mjs';

assert.equal(process.version, 'v26.10.0'); assert.equal(process.argv.length, 2);
const browserPath = process.env.HOUSEATLAS_CHROMIUM, evidence = process.env.HOUSEATLAS_FIXTURE_EVIDENCE;
assert(browserPath && existsSync(browserPath), 'Select an inspected Chromium executable');
assert(evidence && resolve(evidence) === evidence && !existsSync(evidence), 'Select a new absolute private result directory');
const root = resolve(fileURLToPath(new URL('../../', import.meta.url))), frontend = join(root, 'frontend');
assert(!evidence.startsWith(root + sep)); mkdirSync(evidence, { mode: 0o700 });
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-electrical-library-browser-')), output = join(scratch, 'built'), downloads = join(scratch, 'downloads');
mkdirSync(downloads); const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error('120-second fictional browser bound')), 120_000);
let server, browser, cdp, failure, childClosed = false, leaderExited = false, leaderExit = null, spawnFailed = false, groupGone = false;
let ownershipHold = null;
const results = [];
let cleanupProof = { browserClosed: true, leaderExited: true, leaderExit: null, groupGone: true,
  listenerStopped: true, scratchRemoved: false, disposition: 'HOLD', holdReason: null };
class CDP {
  constructor(child) {
    this.child = child; this.id = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString(); if (this.buffer.length > 8 * 1024 * 1024) { controller.abort(); return; }
      let end;
      while ((end = this.buffer.indexOf('\0')) !== -1) {
        let message;
        try { message = JSON.parse(this.buffer.slice(0, end)); }
        catch (error) { controller.abort(error); return; }
        this.buffer = this.buffer.slice(end + 1);
        if (message.id) {
          const request = this.pending.get(message.id); if (!request) continue;
          clearTimeout(request.timer); this.pending.delete(message.id);
          message.error ? request.reject(new Error(`CDP ${request.method} failed`)) : request.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params.request.url);
      }
    });
    const ended = () => this.close(new Error('Owned browser closed'));
    child.on('error', ended); child.on('close', ended); child.stdio[3].on('error', ended); child.stdio[4].on('error', ended);
  }
  close(error) { for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear(); }
  send(method, params = {}, sessionId) {
    controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++this.id, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP deadline: ${method}`)); }, 7000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
async function until(check, label, ms = 20_000) {
  const end = performance.now() + ms;
  while (performance.now() < end) { controller.signal.throwIfAborted(); if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Fictional browser timeout: ${label}`);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const exitObserved = () => leaderExited || browser?.exitCode != null || browser?.signalCode != null;
const holdOwnership = reason => { ownershipHold ??= reason; };
function groupAbsent() {
  if (!browser || groupGone) return true;
  if (ownershipHold) return false;
  // Close can lag leader exit while descendants retain stdio. Neither an open
  // pipe nor an unreceived close event proves that a numeric group is owned.
  if (browser.pid === undefined) {
    if (!(spawnFailed && childClosed)) return false;
    groupGone = true; return true;
  }
  if (!exitObserved() && !childClosed) return false;
  const snapshot = execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 });
  const rows = snapshot.trim().split('\n').map(line => {
    assert(/^\s*\d+\s+\d+\s*$/.test(line), 'Complete numeric process snapshot required');
    return line.trim().split(/\s+/).map(Number);
  });
  if (rows.some(([pid]) => pid === browser.pid)) {
    holdOwnership('Leader PID present after observed exit; numeric reuse or identity uncertainty cannot establish ownership');
    return false;
  }
  if (rows.some(([, pgid]) => pgid === browser.pid)) return false;
  // Cache absence only after direct-child closure as well. A snapshot taken
  // while close is pending must be repeated before deleting owned scratch.
  groupGone = childClosed; return true;
}
function signalOwnedGroup(signal) {
  if (!browser || groupAbsent()) return;
  if (ownershipHold) return;
  // No post-exit ownership revalidation is implemented. Numeric PID/PGID
  // membership alone never permits signalling after the leader has exited.
  if (exitObserved() || childClosed || spawnFailed) {
    holdOwnership('Numeric group signal withheld after leader exit or loss of ownership proof');
    return;
  }
  assert(Number.isSafeInteger(browser.pid) && browser.pid > 0, 'An owned browser process group is required');
  // This synchronous check/signal path applies only to the still-owned live
  // leader. No discovered PID is a target. ESRCH does not prove child closure
  // or replace the required post-close absence snapshot.
  try { process.kill(-browser.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function waitForBrowser(bound) {
  const due = performance.now() + bound;
  while (browser && performance.now() < due) {
    const absent = groupAbsent();
    if (childClosed && absent) return true;
    if (ownershipHold) return false;
    await wait(25);
  }
  return !browser || childClosed && groupAbsent();
}
async function cleanup() {
  let browserError, listenerError, listenerStopped = !server?.listening;
  try {
    if (browser && !exitObserved() && !childClosed && !controller.signal.aborted) {
      const closing = cdp?.send('Browser.close').catch(() => {});
      await Promise.race([closing, wait(500)]);
    }
    cdp?.close(new Error('Fixture cleanup')); controller.abort();
    await waitForBrowser(1500);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (!browser || childClosed && groupAbsent()) break;
      if (ownershipHold) break;
      signalOwnedGroup(signal);
      if (ownershipHold) break;
      if (await waitForBrowser(2000)) break;
    }
    assert(!ownershipHold, ownershipHold ?? 'Browser ownership unconfirmed');
    assert(!browser || childClosed && groupAbsent(), 'Owned browser closure/group absence unconfirmed; scratch retained');
  } catch (error) { browserError = error; }
  try {
    if (server?.listening) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned listener close deadline')), 2000);
      server.close(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
      server.closeAllConnections();
    });
    listenerStopped = true;
  } catch (error) { listenerError = error; }
  cdp?.close(new Error('Fixture ended')); controller.abort();
  cleanupProof = { browserClosed: !browser || childClosed, leaderExited: !browser || exitObserved(), leaderExit,
    groupGone: !browser || groupGone, listenerStopped, scratchRemoved: false,
    disposition: browserError || listenerError || ownershipHold ? 'HOLD' : 'confirmed',
    holdReason: ownershipHold ?? browserError?.message ?? listenerError?.message ?? null };
  if (browserError || listenerError) throw browserError ?? listenerError;
  assert(cleanupProof.browserClosed && cleanupProof.groupGone && cleanupProof.listenerStopped, 'Owned resources remain unconfirmed; scratch retained');
  rmSync(scratch, { recursive: true, force: true }); cleanupProof.scratchRemoved = !existsSync(scratch);
}
try {
  await build({ root: frontend, configFile: false, logLevel: 'silent', plugins: [pdfjsBinaryDataPlugin(frontend)],
    build: { outDir: output, target: 'esnext', rolldownOptions: { input: join(frontend, 'lantern-tests/electrical-library-visual/index.html'),
      output: { assetFileNames: asset => asset.names?.includes('pdf.worker.min.mjs') ? 'assets/pdf.worker.min-[hash].js' : 'assets/[name]-[hash][extname]' } } } });
  server = createServer((request, response) => {
    try {
      const path = resolve(output, '.' + decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname));
      if (request.method !== 'GET' || !path.startsWith(output + sep) || !existsSync(path)) { response.writeHead(404).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(readFileSync(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(browserPath, ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
    `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: true });
  browser.once('error', () => { spawnFailed = true; });
  browser.once('exit', (code, signal) => { leaderExited = true; leaderExit = { code, signal }; });
  browser.once('close', () => { childClosed = true; });
  browser.stderr.on('data', () => {});
  cdp = new CDP(browser);
  // The deadline rejects pending work. All signalling, bounded waits and
  // scratch removal belong to the single cleanup owner below.
  controller.signal.addEventListener('abort', () => cdp.close(controller.signal.reason ?? new Error('Stopped')), { once: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, 'Browser expression succeeds'); return result.result.value;
  };
  const click = async expression => {
    const point = await evaluate(`(() => { const element = ${expression}; element.scrollIntoView({block:'center'}); const box=element.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  for (const width of [1280, 360]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/lantern-tests/electrical-library-visual/index.html` });
    await until(() => evaluate('document.querySelectorAll(".electrical-library-documents > li").length === 1'), 'one existing PDF discovered directly in Library');
    assert.equal(await evaluate('document.querySelectorAll(".electrical-library-documents .row-title").length'), 3);
    assert.equal(await evaluate('document.querySelector(".electrical-library").textContent.includes("No room association recorded")'), true);
    assert.equal(await evaluate('window.__electricalFixture.counts.opens.includes(window.__electricalFixture.pdfEvidenceId)'), false);
    for (const page of [2, 9]) {
      await click(`Array.from(document.querySelectorAll('.electrical-library .row-title')).find(button => button.getAttribute('aria-label').endsWith('PDF page ${page}'))`);
      await until(() => evaluate(`(() => { const canvas = document.querySelector('.native-scene-pdf-canvas'); return canvas?.width > 0 && canvas.getAttribute('aria-label').endsWith('PDF page ${page}') && getComputedStyle(canvas).visibility !== 'hidden'; })()`), `reference page ${page} rendered`);
      await until(() => evaluate('document.querySelector(".native-scene-drawing").textContent.includes("of 18")'), 'actual PDF page count');
      const painted = await evaluate('(() => { const c=document.querySelector(".native-scene-pdf-canvas"),p=c.getContext("2d").getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return p[3]>0 && (p[0]<245||p[1]<245||p[2]<245); })()');
      assert.equal(painted, true, 'generated PDF has visible page pixels');
      if (width === 1280 && page === 9) {
        await click('document.querySelector("button[aria-label=\"Next PDF page\"]")');
        await until(() => evaluate('document.querySelector(".native-scene-pdf-canvas").getAttribute("aria-label").endsWith("PDF page 10")'), 'next page');
        await click('document.querySelector("button[aria-label=\"Zoom in PDF\"]")');
        await until(() => evaluate('document.querySelector(".native-scene-pdf-zoom span").textContent === "200%"'), 'zoom');
        await click('document.querySelector(".native-scene-drawing a[download]")');
        await until(() => readdirSync(downloads).some(path => path.endsWith('.pdf')), 'original download');
        const downloaded = readFileSync(join(downloads, readdirSync(downloads).find(path => path.endsWith('.pdf'))));
        assert.equal(createHash('sha256').update(downloaded).digest('hex'), await evaluate('window.__electricalFixture.pdfSha'));
      }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
      await until(() => evaluate('document.querySelector(".native-scene-drawing") === null'), 'drawing closed');
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')?.endsWith('PDF page ${page}')`), true, 'focus returns to exact sheet opener');
    }
    await click('Array.from(document.querySelectorAll("button")).find(button=>button.textContent === "Leave Library")');
    await until(() => evaluate('window.__electricalFixture.counts.owners === window.__electricalFixture.counts.disposes'), 'normal navigation releases dedicated readers');
    results.push({ width, pages: [2, 9], fictional: true });
  }
  assert.deepEqual(cdp.errors, []);
  assert(cdp.requests.every(url => url.startsWith(origin + '/') || url.startsWith('blob:') || url === 'about:blank'));
} catch (error) { failure = error; }
finally {
  clearTimeout(deadline);
  try { await cleanup(); } catch (error) {
    failure ??= error; cleanupProof.disposition = 'HOLD'; cleanupProof.holdReason ??= error.message;
  }
  // A report cannot claim success before termination and reaping are proven.
  try {
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ check: 'electrical-library-browser', results,
      screenshots: false, success: !failure, cleanup: cleanupProof,
      ...(failure ? { error: failure.message, ...(existsSync(scratch) ? { retainedScratch: scratch } : {}) } : {}) }, null, 2));
  } finally {
    if (browser && cleanupProof.disposition === 'HOLD') {
      // The report above captures facts before local detachment. Destroying
      // parent-side pipes may emit close; it proves no browser/group exit and
      // must never promote HOLD or remove its retained scratch evidence.
      let detachError;
      for (const fd of [2, 3, 4]) {
        try { browser.stdio[fd]?.destroy(); } catch (error) { detachError ??= error; }
      }
      try { browser.unref(); } catch (error) { detachError ??= error; }
      if (detachError) throw detachError;
    }
  }
}
if (failure) throw failure;
console.log(JSON.stringify({ result: join(evidence, 'result.json'), results, cleanup: cleanupProof }));
