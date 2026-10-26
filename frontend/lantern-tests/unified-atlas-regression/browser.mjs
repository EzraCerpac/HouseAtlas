// Actual mounted React host + synthetic ports, on a fresh owned loopback page.
// No security/network/GPU switches, private preview, supplied files, provider or deployment.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { frontend } from './api.mjs';

assert.equal(process.version, 'v26.10.0', 'Use the pinned runtime');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--build-only'));
const buildOnly = args.includes('--build-only');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-interaction-browser-'));
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frontend, encoding: 'utf8' }).trim(),
  node: process.version, status: 'running', fixture: 'generated host; immutable publication overlays',
  browser: null, launchFlags: null, webgl: null, checks: [], applicationRequests: [], errors: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, server, cdp, phase = 'build', exitCode = 0, stderr = '';

class CDP {
  constructor(child) {
    this.next = 0; this.pending = new Map(); this.buffer = ''; this.requests = []; this.errors = [];
    this.child = child;
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString();
      let at;
      while ((at = this.buffer.indexOf('\0')) >= 0) {
        const event = JSON.parse(this.buffer.slice(0, at)); this.buffer = this.buffer.slice(at + 1);
        if (event.id) {
          const p = this.pending.get(event.id); if (!p) continue;
          clearTimeout(p.timer); this.pending.delete(event.id);
          event.error ? p.reject(new Error(event.error.message)) : p.resolve(event.result);
        } else if (event.method === 'Runtime.exceptionThrown') this.errors.push(event.params.exceptionDetails.text);
        else if (event.method === 'Network.requestWillBeSent') this.requests.push(event.params.request.url);
      }
    });
    const stop = error => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    child.on('exit', () => stop(new Error('Chromium exited before completion')));
    child.on('error', stop);
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}

const budget = setTimeout(() => { browser?.kill('SIGTERM'); server?.close(); }, 120_000);
try {
  // The real frontend plugins require their cwd to be the frontend root.
  const previous = process.cwd();
  try {
    process.chdir(frontend);
    await build({ root: frontend, configFile: join(frontend, 'vite.config.ts'), logLevel: 'error',
      publicDir: false, build: { target: 'esnext', outDir: join(scratch, 'dist'), emptyOutDir: true,
        rolldownOptions: { input: join(frontend, 'lantern-tests/unified-atlas-regression/index.html') } } });
  } finally { process.chdir(previous); }
  report.build = 'passed';
  if (buildOnly) {
    report.status = 'build-only';
    report.browser = 'not launched; no interaction or WebGL verification';
  } else {
    phase = 'browser setup';
    const executable = process.env.HOUSEATLAS_CHROMIUM;
    assert(executable && existsSync(executable), 'Set HOUSEATLAS_CHROMIUM to an inspected local browser');
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(version.status, 0, version.stderr);
    report.browser = version.stdout.trim();
    // Do not add --no-sandbox, --disable-web-security, software-GPU overrides,
    // network bypasses, certificate exceptions or a reused browser profile.
    const flags = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'];
    report.launchFlags = flags.map(flag => flag.startsWith('--user-data-dir=') ? '--user-data-dir=<fresh scratch>' : flag);
    browser = spawn(executable, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    browser.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
    cdp = new CDP(browser);
    await cdp.send('Browser.getVersion');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, label) => {
      const due = Date.now() + 10_000;
      while (Date.now() < due) { if (await evaluate(expression)) return; await wait(40); }
      throw new Error(`Timed out: ${label}`);
    };
    const files = new Map();
    const collect = (directory, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path));
      }
    };
    collect(join(scratch, 'dist'));
    server = createServer((req, res) => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const bytes = files.get(path);
      if (req.method !== 'GET' || !bytes) { res.writeHead(path === '/favicon.ico' ? 204 : 404); res.end(); return; }
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.wasm') ? 'application/wasm' : 'text/html';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable']) await send(method, {});
    // Passive observation only; does not change WebGL or browser settings.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__atlasFrames={draws:0};
      const original=WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays=function(...args){window.__atlasFrames.draws++;return original.apply(this,args);};` });
    phase = 'interactions';
    await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?atlas=generated` });
    await until('Boolean(document.querySelector(".ua-room-btn"))', 'actual host and Atlas ready');
    const button = (selector, text) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    // Floor Stack rows carry a visual mark beside their name; match the name alone.
    const stackRow = (list, text) => `Array.from(document.querySelectorAll(${JSON.stringify(`${list} button`)})).find(b=>b.querySelector('.ua-rung-name')?.textContent.trim()===${JSON.stringify(text)})`;
    const roomButton = (floor, label) => `(()=>{const section=Array.from(document.querySelectorAll('.ua-rooms section')).find(s=>s.getAttribute('aria-label')===${JSON.stringify(floor)});
      return section&&Array.from(section.querySelectorAll('button')).find(b=>b.querySelector('span').textContent===${JSON.stringify(label)});})()`;
    const click = async expression => {
      const point = await evaluate(`(()=>{const b=(${expression});if(!b||b.disabled)throw Error('Missing/enabled target: '+${JSON.stringify(expression)});
        b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()`);
      assert(point.w > 0 && point.h > 0);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await wait(50);
    };
    const key = async (key, code, number) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: number });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: number });
      await wait(50);
    };
    const selectedRoom = () => evaluate('document.querySelector(".ua-inspector.is-room h2")?.textContent ?? null');
    // Below a 1041px Atlas the room panel is a sheet with a visible toggle; its
    // body (room list, Also on) is shown only while open, and an open sheet sets
    // the overlay bar aside. Wide layouts have no visible toggle.
    const sheet = async open => {
      const toggle = await evaluate(`(()=>{const t=document.querySelector('.ua-sheet-toggle');
        return t&&getComputedStyle(t).display!=='none'?t.getAttribute('aria-expanded'):null;})()`);
      if (toggle !== null && toggle !== String(open)) await click('document.querySelector(".ua-sheet-toggle")');
    };
    const clear = async () => {
      if (await selectedRoom()) await click('document.querySelector("button[aria-label=\'Clear room\']")');
    };
    const check = async (name, run) => { await run(); report.checks.push(name); };

    await check('one Atlas in the production host', async () => {
      assert.equal(await evaluate('document.querySelectorAll(".ua-shell").length'), 1);
      assert.equal(await evaluate('document.querySelectorAll("[aria-label=\'Atlas source\']").length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(".ua-room-btn").length'), 10);
    });
    await wait(500);
    report.webgl = await evaluate(`(()=>{const canvas=document.querySelector('.ua-viewport canvas');const gl=canvas?.getContext('webgl');
      const debug=gl?.getExtension('WEBGL_debug_renderer_info');return {available:!!gl,lost:gl?.isContextLost()??null,
        renderer:gl?(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null,
        version:gl?.getParameter(gl.VERSION)??null,width:canvas?.width,height:canvas?.height,
        drawCalls:window.__atlasFrames.draws,diagnostic:document.querySelector('.cifc-stage-note')?.textContent??null};})()`);
    // DOM checks can continue on a genuine browser with unavailable WebGL.
    // A successful context/draw count is not hardware-GPU or visual pixel acceptance.
    await check('all ten room-list selections, duplicate labels, floor text and focus', async () => {
      const rows = await evaluate(`Array.from(document.querySelectorAll('.ua-rooms section')).flatMap(s=>Array.from(s.querySelectorAll('button')).map(b=>({floor:s.getAttribute('aria-label'),label:b.querySelector('span').textContent})))`);
      assert.equal(rows.length, 10);
      for (const row of rows) {
        await clear(); await click(stackRow('.ua-stack-buildings', 'All buildings'));
        await sheet(true); await click(roomButton(row.floor, row.label));
        assert.equal(await selectedRoom(), row.label);
        assert.equal(await evaluate('document.querySelector(".ua-room-floor").textContent'), row.floor);
        assert.equal(await evaluate('document.activeElement===document.querySelector(".ua-inspector h2")'), true);
      }
    });
    await check('connected plans and stairs occurrence navigation', async () => {
      await clear(); await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
      await sheet(true); await click(roomButton('Ground floor, Synthetic house', 'Stairs'));
      await click(button('[aria-label="Atlas view"] button', 'Plan'));
      await until('document.querySelectorAll(".ua-plan path").length>0', 'connected source plan');
      assert.equal(await selectedRoom(), 'Stairs');
      await sheet(true); await click(button('[aria-label="Also on"] button', 'Upper floor, Synthetic house'));
      assert.equal(await evaluate('document.querySelector(".ua-room-floor").textContent'), 'Upper floor, Synthetic house');
      await click(button('[aria-label="Atlas view"] button', '3D'));
      assert.equal(await selectedRoom(), 'Stairs');
    });
    await check('explode toggle and latest building transition', async () => {
      await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
      // One toggle, Spread floors in the Floor Stack; its pressed state carries stacked or exploded.
      const spread = stackRow('.ua-stack', 'Spread floors');
      assert.equal(await evaluate(`(${spread})?.getAttribute('aria-pressed')`), 'true');
      await click(spread);
      assert.equal(await evaluate(`(${spread})?.getAttribute('aria-pressed')`), 'false');
      await click(spread);
      for (const name of ['Synthetic studio', 'Synthetic house', 'Synthetic studio']) await click(stackRow('.ua-stack-buildings', name));
      assert.equal(await selectedRoom(), null);
      assert.equal(await evaluate(`(${stackRow('.ua-stack-buildings', 'Synthetic studio')}).getAttribute('aria-pressed')`), 'true');
      assert.equal(await evaluate('Boolean(document.querySelector(".ua-stack-spread"))'), false);
    });
    await check('overlay pointer activation, counts and two-floor network markers', async () => {
      await sheet(false);
      await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
      await click(button('.layer-bar button', 'Electrical'));
      assert.equal(await evaluate('document.querySelectorAll(".ua-marker").length'), 2);
      await click('document.querySelector(".ua-marker[aria-label^=\'Hall:\']")');
      assert.equal(await selectedRoom(), 'Hall');
      assert.match(await evaluate('document.querySelector(".ua-inspector").textContent'), /3 records/);
      await click(stackRow('.ua-stack-floors', 'All floors'));
      await click(button('.layer-bar button', 'Network'));
      assert.equal(await evaluate('document.querySelectorAll(".ua-marker").length'), 2);
      const pressed = await evaluate('Array.from(document.querySelectorAll(".layer-bar button")).map(b=>b.getAttribute("aria-pressed"))');
      assert.deepEqual(pressed, ['false', 'false', 'true']);
      assert.equal(await selectedRoom(), 'Hall');
    });
    await check('keyboard Enter selects a projected label; Escape clears', async () => {
      await click(button('.layer-bar button', 'Rooms'));
      await evaluate(`document.querySelector('button[data-atlas-occurrence="syn-occ-hall"]').focus()`);
      await key('Enter', 'Enter', 13);
      assert.equal(await selectedRoom(), 'Hall');
      await evaluate('document.querySelector(".ua-viewport").focus()');
      await key('Escape', 'Escape', 27);
      assert.equal(await selectedRoom(), null);
    });
    assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
    assert(cdp.requests.every(url => url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')),
      'Application requests remain on owned loopback or generated memory URLs');
    report.applicationRequests = cdp.requests.map(url => url.startsWith(origin) ? new URL(url).pathname : url.split(':')[0] + ':');
    report.errors = cdp.errors;
    report.status = report.webgl.available && !report.webgl.lost && report.webgl.drawCalls > 0 ? 'passed-browser-webgl' : 'passed-browser-dom-webgl-unavailable';
  }
} catch (error) {
  report.status = phase === 'browser setup' ? 'blocked' : 'failed';
  report.phase = phase;
  report.error = { name: error.name, message: error.message };
  report.stderr = stderr;
  exitCode = phase === 'browser setup' ? 2 : 1;
} finally {
  clearTimeout(budget);
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await cdp?.send('Browser.close').catch(() => {});
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), wait(3000)]);
      if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
    }
  }
  if (server) await new Promise(resolve => server.close(resolve));
  report.cleanup = { browserStopped: !browser || browser.exitCode !== null || browser.signalCode !== null, listenerStopped: !server?.listening };
  if (report.cleanup.browserStopped && report.cleanup.listenerStopped) rmSync(scratch, { recursive: true, force: true });
  report.cleanup.scratchRemoved = !existsSync(scratch);
  if (!Object.values(report.cleanup).every(Boolean)) exitCode = 1;
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = exitCode;
