/** Proposed bounded healthy fictional browser check. Register this exact
 * command before execution. No screenshots or live native/provider fallback. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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
let server, browser, cdp;
class CDP {
  constructor(child) {
    this.child = child; this.id = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString(); if (this.buffer.length > 8 * 1024 * 1024) { controller.abort(); return; }
      let end;
      while ((end = this.buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
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
  browser.stderr.on('data', () => {});
  cdp = new CDP(browser);
  controller.signal.addEventListener('abort', () => { cdp.close(controller.signal.reason ?? new Error('Stopped')); try { process.kill(-browser.pid, 'SIGTERM'); } catch {} }, { once: true });
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
  const results = [];
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
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ check: 'electrical-library-browser', results, screenshots: false }, null, 2));
  console.log(JSON.stringify({ result: join(evidence, 'result.json'), results }));
} finally {
  clearTimeout(deadline); controller.abort();
  if (browser?.pid) { try { process.kill(-browser.pid, 'SIGTERM'); } catch {} }
  cdp?.close(new Error('Fixture ended'));
  if (server) await new Promise(resolve => server.close(resolve));
  if (browser && browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
  if (browser?.pid) { try { process.kill(-browser.pid, 'SIGKILL'); } catch {} }
  rmSync(scratch, { recursive: true, force: true });
}
