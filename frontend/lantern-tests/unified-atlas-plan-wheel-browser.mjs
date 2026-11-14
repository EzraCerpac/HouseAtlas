/** Real-browser stage wheel in the unified Atlas Plan view (#369). Builds the
 * generated Atlas host, opens Plan in Chromium and sends trusted wheel input at
 * the stage centre: a plain two-finger scroll pans the plan and a ctrl-wheel
 * (the browser's trackpad pinch) zooms it. In Plan the 3D canvas is hidden yet
 * still covers the stage; it must not take the hit, or the camera ignores the
 * wheel. Then, by day and at night, the generated wide site ground is zoomed out and
 * panned in 3D, and the stage is captured with and without the board and canvas: below
 * the house the ground must fade into the stage behind it with no step, and end in it
 * (#439). Generated publication only: no backend, session, household data or device.
 *
 * Requires Node 26.10.0 and an inspected HOUSEATLAS_CHROMIUM executable. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsBinaryDataPlugin } from '../build/pdfjs-binary-data-plugin.mjs';

const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');

const frontend = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-plan-wheel-'));
const dist = join(scratch, 'dist');
await build({ root: frontend, configFile: false, logLevel: 'silent', plugins: [react(), pdfjsBinaryDataPlugin(frontend)], base: './', publicDir: false,
  build: { outDir: dist, rolldownOptions: { input: join(frontend, 'lantern-tests/unified-atlas-regression/index.html') } } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
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

/** Decodes Chromium's own 8-bit RGB/RGBA, non-interlaced screenshot PNG to RGB. */
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

const browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--user-data-dir=' + join(scratch, 'profile'),
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const cdp = new Pipe(browser);
try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!exceptionDetails, exceptionDetails?.exception?.description ?? exceptionDetails?.text);
    return result.value;
  };
  const poll = async (expression, label) => {
    for (const until = Date.now() + 20_000; ;) {
      if (await evaluate(expression).catch(() => false)) return;
      if (Date.now() > until) throw new Error(label);
      await new Promise(done => setTimeout(done, 50));
    }
  };
  const click = async (selector, text) => {
    const point = await evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)});
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
  };
  // Reduced motion (emulated below) snaps the camera, but the plan's fit to the
  // stage can still adjust after a layout pass; read the matrix once it holds still.
  const settledPlan = async () => {
    let last = null, still = 0, seen = null;
    for (const until = Date.now() + 20_000; Date.now() < until; await new Promise(done => setTimeout(done, 100))) {
      seen = await evaluate(`document.querySelector('.ua-plan')?.getAttribute('transform') ?? null`);
      const match = seen?.match(/matrix\(([^)]+)\)/);
      if (!match) { still = 0; last = null; continue; }
      const [a, , , , e, f] = match[1].split(/[ ,]+/).map(Number), now = { scale: a, x: e, y: f };
      still = last && Math.abs(now.scale - last.scale) < 1e-3 && Math.abs(now.x - last.x) < .05 && Math.abs(now.y - last.y) < .05 ? still + 1 : 0;
      if (still >= 4) return now;
      last = now;
    }
    throw new Error('Plan transform did not settle: ' + seen);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = cdp.event('Page.loadEventFired');
  await send('Page.navigate', { url: origin + '/lantern-tests/unified-atlas-regression/index.html?atlas=generated' }); await loaded;
  await poll('Boolean(document.querySelector(".ua-room-btn"))', 'Atlas did not mount');
  await click('.ua-stack-buildings .ua-rung-name', 'Synthetic house');
  await click('[aria-label="Atlas view"] button', 'Plan');
  await poll('document.querySelectorAll(".ua-plan path").length > 0', 'Plan did not draw');

  const centre = await evaluate(`(() => { const r = document.querySelector('.ua-viewport').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  const wheel = (deltaX, deltaY, modifiers = 0) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...centre, deltaX, deltaY, modifiers });

  const start = await settledPlan();
  assert.equal(await evaluate(`Boolean(document.elementFromPoint(${centre.x}, ${centre.y})?.closest('[hidden]'))`), false,
    'The stage centre in Plan resolves to a hidden element');
  await wheel(40, 60);
  const panned = await settledPlan();
  assert(Math.abs(panned.x - (start.x - 40)) < 1 && Math.abs(panned.y - (start.y - 60)) < 1,
    `Two-finger scroll pans the plan by its deltas: ${JSON.stringify({ start, panned })}`);
  assert(Math.abs(panned.scale - start.scale) < 1e-3, 'Plain scroll leaves the zoom alone');
  await wheel(0, -80, 2);
  const pinched = await settledPlan();
  assert(pinched.scale > panned.scale * 1.2, `Pinch (ctrl-wheel) zooms the plan in: ${JSON.stringify({ panned, pinched })}`);
  console.log(JSON.stringify({ start, panned, pinched }));

  // #439: the surroundings fade into the stage actually behind them, with no rim.
  const shot = async () => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  for (const [hour, minutes] of [['day', 720], ['night', 0]]) {
    await send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    const reloaded = cdp.event('Page.loadEventFired');
    await send('Page.navigate', { url: origin + '/lantern-tests/unified-atlas-regression/index.html?atlas=generated&atlas-ground=wide' }); await reloaded;
    await poll('Boolean(document.querySelector(".ua-time-strip"))', 'Atlas did not mount with the wide ground');
    await evaluate(`(() => { const input = document.querySelector('.ua-time-strip');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${minutes}'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const shaded = `document.querySelector('canvas[data-stage="shading"]') && !document.querySelector('.cifc-stage-fade')`;
    await poll(shaded, `${hour}: the 3D view did not draw`);
    for (let k = 0; k < 5; k++) await wheel(0, 600, 2);
    await wheel(0, 180);
    await new Promise(done => setTimeout(done, 1500)); await poll(shaded, `${hour}: the 3D view did not settle`);
    await new Promise(done => setTimeout(done, 1000));
    const scene = await shot();
    // The same stage with nothing of the viewport drawn: what lies behind the board and canvas.
    const columns = await evaluate(`(() => { const view = document.querySelector('.ua-viewport'), r = view.getBoundingClientRect();
      for (const child of view.children) child.style.visibility = 'hidden';
      return [.1, .3, .5, .7, .9].map(f => { const x = Math.round(r.x + f * r.width), ys = [];
        for (let y = Math.round(r.y + .55 * r.height); y < r.bottom - 2; y++) if (document.elementFromPoint(x, y) === view) ys.push(y);
        return { x, ys }; }); })()`);
    const stage = await shot();
    const at = (image, x, y) => [0, 1, 2].map(k => image.pixels[(y * image.width + x) * 3 + k]);
    let largest = 0, step = 0, rise = 0, end = 0;
    for (const { x, ys } of columns) {
      assert(ys.length > 100, `${hour}: column ${x} has stage pixels to sample`);
      let last = null;
      for (const y of ys) {
        const a = at(scene, x, y), b = at(stage, x, y), gap = a.map((v, k) => v - b[k]), size = Math.max(...gap.map(Math.abs));
        largest = Math.max(largest, size);
        if (last && last.y === y - 1) { step = Math.max(step, ...gap.map((v, k) => Math.abs(v - last.gap[k]))); rise = Math.max(rise, size - last.size); }
        last = { y, gap, size };
      }
      end = Math.max(end, last.size);
    }
    console.log(JSON.stringify({ hour, largest, step, rise, end }));
    assert(largest >= 8, `${hour}: the ground is drawn over the stage below the house (largest difference ${largest})`);
    assert(step <= 6, `${hour}: the ground fades into the stage without a step (largest step ${step})`);
    assert(rise <= 3, `${hour}: the ground only fades further from the house (largest rise ${rise})`);
    assert(end <= 4, `${hour}: the faded ground ends in the stage colour (difference ${end})`);
  }
} finally {
  // The profile is removed only once Chromium has exited and stopped writing to it.
  const exited = browser.exitCode !== null ? Promise.resolve() : new Promise(done => browser.once('exit', done));
  await cdp.send('Browser.close').catch(() => browser.kill('SIGKILL'));
  await Promise.race([exited, new Promise(done => setTimeout(done, 5_000))]);
  if (browser.exitCode === null) { browser.kill('SIGKILL'); await exited; }
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
