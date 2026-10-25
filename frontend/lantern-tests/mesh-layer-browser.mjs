/** Real-browser MeshLayer draw. Builds the generated frame benchmark and the
 * generated embedded-material samples, serves them on an owned loopback
 * listener and draws them through three.js in Chromium's software GPU.
 * Generated geometry only: no backend, session, household data or device.
 *
 *   --case webgl2   no WebGPU adapter, so three.js uses its WebGL2 backend
 *   --case webgpu   WebGPU on SwiftShader Vulkan (needs a Chromium that offers it)
 *   --case bench    prints CPU time and GPU API calls per frame; asserts nothing
 *
 * Requires Node 26.10.0 and an inspected HOUSEATLAS_CHROMIUM executable. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const CASES = ['webgl2', 'webgpu', 'bench'];
assert.equal(process.argv.length, 4, `Select --case ${CASES.join(' | ')}`);
assert.equal(process.argv[2], '--case');
const selected = process.argv[3];
assert(CASES.includes(selected), `Select --case ${CASES.join(' | ')}`);
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');

const frontend = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-mesh-layer-'));
const dist = join(scratch, 'dist');
await build({ root: frontend, configFile: false, logLevel: 'silent', plugins: [react()], base: './', publicDir: false,
  build: { outDir: dist, rolldownOptions: { input: ['render-bench', 'embedded-png-material-visual'].map(page => join(frontend, `lantern-tests/${page}/index.html`)) } } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((request, response) => {
  const file = normalize(join(dist, new URL(request.url, 'http://127.0.0.1').pathname));
  if (!file.startsWith(dist + '/') || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

class Pipe {
  next = 0; pending = new Map(); waiters = new Set(); buffer = Buffer.alloc(0);
  constructor(child) {
    child.on('exit', code => { for (const entry of this.pending.values()) entry.reject(new Error('Chromium exited: ' + code)); this.pending.clear(); });
    child.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        const message = raw ? JSON.parse(raw) : {};
        if (!message.id) { for (const waiter of this.waiters) if (waiter.method === message.method) { this.waiters.delete(waiter); waiter.resolve(); } continue; }
        const entry = this.pending.get(message.id); if (!entry) continue;
        this.pending.delete(message.id);
        message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
      }
    });
    this.child = child;
  }
  /** Every call and awaited event has a deadline, so a stuck page fails the case instead of the runner's timeout. */
  deadline(promise, label, ms = 30_000) {
    let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    const answer = new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0'); });
    return this.deadline(answer, method).finally(() => this.pending.delete(id));
  }
  event(method) { return this.deadline(new Promise(resolve => this.waiters.add({ method, resolve })), method, 60_000); }
}

/** Decodes Chromium's own 8-bit RGB/RGBA, non-interlaced screenshot PNG. */
function decodePng(png) {
  let at = 8, width = 0, height = 0, channels = 0; const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8); assert.equal(body[12], 0); channels = { 2: 3, 6: 4 }[body[9]]; assert(channels); }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, out = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < 3; k++) out[(y * width + x) * 3 + k] = line[x * channels + k];
    previous = line;
  }
  return { width, height, pixels: out };
}

const webgpu = selected === 'webgpu' || selected === 'bench';
const browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--user-data-dir=' + join(scratch, 'profile'),
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ...(webgpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-vulkan=swiftshader', '--disable-vulkan-surface', '--disable-gpu-sandbox'] : []),
  'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const cdp = new Pipe(browser);
try {
  let tab = null;
  const send = (method, params) => cdp.send(method, params, tab.sessionId);
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!exceptionDetails, exceptionDetails?.exception?.description ?? exceptionDetails?.text);
    return result.value;
  };
  const poll = async (expression, ms, label) => {
    for (const until = Date.now() + ms; ;) {
      const value = await evaluate(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > until) throw new Error(label + ': ' + await evaluate(`document.body.innerText.slice(0, 300) + ' ' + [...document.querySelectorAll('canvas')].map(c => c.dataset.renderer + ':' + c.width).join()`).catch(e => String(e)));
      await new Promise(done => setTimeout(done, 50));
    }
  };
  // Each page gets a fresh tab: navigating away from a page that holds GPU contexts
  // sometimes leaves the next page unloaded in the software GPU.
  const open = async (path, width, height, ...setup) => {
    if (tab) await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    tab = { targetId, ...await cdp.send('Target.attachToTarget', { targetId, flatten: true }) };
    await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const [method, params] of setup) await send(method, params);
    // A Runtime.evaluate sent while the page is still committing can go unanswered; evaluate only once it has loaded.
    const loaded = cdp.event('Page.loadEventFired');
    await send('Page.navigate', { url: origin + path }); await loaded;
  };
  const shot = async () => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const expected = selected === 'webgl2' ? 'webgl2' : 'webgpu';

  if (selected === 'bench') {
    await open('/lantern-tests/render-bench/index.html?frames=60', 390, 844, ['Emulation.setCPUThrottlingRate', { rate: 4 }]);
    console.log(JSON.stringify(await poll('window.benchDone', 240_000, 'Benchmark did not finish')));
  } else {
    // 1. A generated house: drawn, selection visible, a handful of GPU calls per frame however many primitives.
    await open('/lantern-tests/render-bench/index.html?frames=8&pieces=600', 480, 480);
    const result = await poll('window.benchDone', 60_000, 'Generated house frames did not finish');
    assert.equal(await evaluate(`document.querySelector('output').textContent`), '', 'MeshLayer reported a failure');
    assert.equal(result.renderer, expected);
    assert(result.frames >= 1, 'No frame was drawn while the camera turned');
    const calls = expected === 'webgl2' ? result.gl : result.gpu;
    assert(calls > 0 && calls <= 150, `Expected a handful of GPU API calls per frame for ${result.pieces} primitives, saw ${calls}`);
    const house = await shot(), paper = [0xec, 0xee, 0xe9];
    let drawn = 0, lantern = 0;
    for (let i = 0; i < house.pixels.length; i += 3) {
      const [r, g, b] = house.pixels.subarray(i, i + 3);
      if (Math.abs(r - paper[0]) + Math.abs(g - paper[1]) + Math.abs(b - paper[2]) > 12) drawn++;
      if (r > 230 && g > 180 && g < 225 && b < 140) lantern++;
    }
    assert(drawn > house.width * house.height * .05, `Only ${drawn} drawn pixels`);
    assert(lantern > 20, `The selected room's lantern tone is missing (${lantern} pixels)`);
    // A new mesh set builds behind the one on screen and replaces it only once drawn: never a blank stage.
    await evaluate('window.swapReport = window.swap(), true');
    await poll('window.swapReport.done', 60_000, 'The swapped mesh set was not shown');
    const swap = await evaluate('window.swapReport');
    assert.equal(swap.mostCanvases, 2, 'the new set builds on its own canvas');
    assert.equal(swap.fewestVisible, 1, 'a canvas stays on screen throughout the swap');
    assert.equal(await evaluate(`document.querySelector('canvas').dataset.renderer`), expected);
    assert.equal(await evaluate(`document.querySelector('output').textContent`), '', 'MeshLayer reported a failure after the swap');

    // 2. Embedded PNG materials: textured, selected, dimmed and ghost samples each draw on the same backend.
    await open('/lantern-tests/embedded-png-material-visual/index.html', 1400, 900);
    await poll(`document.querySelectorAll('canvas[data-renderer]').length === 4`, 120_000, 'Material samples did not draw');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('canvas')].map(c => c.dataset.renderer)`), Array(4).fill(expected));
    assert.equal(await evaluate(`[...document.querySelectorAll('output')].map(o => o.textContent).join('')`), '');
    await new Promise(done => setTimeout(done, 500));
    const samples = await shot(), boxes = await evaluate(`[...document.querySelectorAll('canvas')].map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })`);
    const centre = ([x, y, w, h]) => { const at = ((y + Math.round(h * .62)) * samples.width + x + Math.round(w * .38)) * 3; return [...samples.pixels.subarray(at, at + 3)]; };
    const [, selectedTone, , ghost] = boxes.map(centre);
    assert(selectedTone[0] > 200 && selectedTone[1] > 150 && selectedTone[2] < 130, `Selected sample is not lantern-toned: ${selectedTone}`);
    assert(Math.max(...ghost) - Math.min(...ghost) < 12 && ghost[0] > 200, `Ghost sample is not a faint veil: ${ghost}`);
    const [x, y, w, h] = boxes[0], tones = new Set();
    for (let dy = 0; dy < 20; dy++) for (let dx = 0; dx < 20; dx++) {
      const at = ((y + Math.round(h * .55) + dy) * samples.width + x + Math.round(w * .3) + dx) * 3; tones.add(samples.pixels.subarray(at, at + 3).join());
    }
    assert(tones.size > 20, `Textured sample shows no texture detail (${tones.size} tones)`);
    console.log(`PASS ${selected}: generated house (${result.pieces} primitives, ${calls} calls per frame, swapped to a new set without a blank frame) and material samples drawn by three.js on ${expected}; software GPU only, not device proof`);
  }
} finally {
  await cdp.send('Browser.close').catch(() => {});
  browser.kill();
  server.close();
  rmSync(scratch, { recursive: true, force: true });
}
