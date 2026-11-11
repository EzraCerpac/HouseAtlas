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
assert(args.length === 0 || (args.length === 1 && ['--build-only', '--electrical', '--stored-dialog-currentness'].includes(args[0])));
const buildOnly = args.includes('--build-only');
const electricalOnly = args.includes('--electrical');
const storedDialogOnly = args.includes('--stored-dialog-currentness');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-interaction-browser-'));
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frontend, encoding: 'utf8' }).trim(),
  node: process.version, status: 'running', fixture: 'generated host; publication overlays and optional generated documentary owner',
  browser: null, launchFlags: null, webgl: null, checks: [], applicationRequests: [], errors: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, server, cdp, phase = 'build', exitCode = 0, stderr = '';
const childEvents = { exit: false, close: false };

class CDP {
  constructor(child) {
    this.next = 0; this.pending = new Map(); this.buffer = ''; this.requests = []; this.errors = []; this.paused = [];
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
        } else if (event.method === 'Runtime.exceptionThrown') this.errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
        else if (event.method === 'Network.requestWillBeSent') this.requests.push(event.params.request.url);
        else if (event.method === 'Fetch.requestPaused') this.paused.push(event.params);
      }
    });
    const stop = error => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    child.stdio[3].on('error', stop);
    child.stdio[4].on('error', stop);
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

const budget = setTimeout(() => { browser?.kill('SIGTERM'); server?.close(); }, electricalOnly || storedDialogOnly ? 180_000 : 360_000);
try {
  // The real frontend plugins require their cwd to be the frontend root.
  const previous = process.cwd();
  try {
    process.chdir(frontend);
    // A fixture root keeps the public offline-shell plugin from replacing this
    // explicit fixture input with the production live/saved shell entries.
    await build({ root: join(frontend, 'lantern-tests/unified-atlas-regression'), configFile: join(frontend, 'vite.config.ts'), logLevel: 'error',
      plugins: [{ name: 'generated-mounted-electrical-entry', apply: 'build', transformIndexHtml: {
        order: 'pre', handler(html, context) {
          if (context.filename !== join(frontend, 'lantern-tests/unified-atlas-regression/electrical-trace.html')) return html;
          // Only this explicit test build reaches the actual projector's
          // package-local dependencies; unrelated dev HTML scans stay inert.
          return { html, tags: [{ tag: 'script', attrs: { type: 'module', src: './mounted-electrical-trace.tsx' }, injectTo: 'body' }] };
        },
      } }],
      publicDir: false, build: { target: 'esnext', outDir: join(scratch, 'dist'), emptyOutDir: true,
        rolldownOptions: { input: [join(frontend, 'lantern-tests/unified-atlas-regression/index.html'),
          ...(storedDialogOnly ? [] : [join(frontend, 'lantern-tests/unified-atlas-regression/electrical-trace.html')])] } } });
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
    assert.equal(report.browser, 'Google Chrome for Testing 156.0.8078.47', 'Use the inspected pinned browser for native input');
    // Do not add --no-sandbox, --disable-web-security, software-GPU overrides,
    // network bypasses, certificate exceptions or a reused browser profile.
    const flags = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'];
    report.launchFlags = flags.map(flag => flag.startsWith('--user-data-dir=') ? '--user-data-dir=<fresh scratch>' : flag);
    browser = spawn(executable, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    browser.once('exit', () => { childEvents.exit = true; });
    browser.once('close', () => { childEvents.close = true; });
    browser.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
    cdp = new CDP(browser);
    await cdp.send('Browser.getVersion');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    await send('Page.bringToFront', {});
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, label) => {
      const due = Date.now() + 10_000;
      while (Date.now() < due) { if (await evaluate(expression)) return; await wait(40); }
      throw new Error(`Timed out: ${label}; page: ${await evaluate('document.body.innerText.slice(0,2000)')}`);
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
      const bytes = files.get(path === '/lantern-tests/unified-atlas-regression/index.html' ? '/index.html'
        : path === '/lantern-tests/unified-atlas-regression/electrical-trace.html' ? '/electrical-trace.html' : path);
      if (req.method !== 'GET' || !bytes) { res.writeHead(path === '/favicon.ico' ? 204 : 404); res.end(); return; }
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.wasm') ? 'application/wasm' : 'text/html';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable']) await send(method, {});
    // Passive observation only; does not change WebGL or browser settings.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__atlasFrames={draws:0};window.__atlasContexts=new WeakMap();
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){const value=getContext.call(this,type,...args);
        if(value)window.__atlasContexts.set(this,{type,value});return value;};
      for(const type of [WebGLRenderingContext,WebGL2RenderingContext])for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
        const original=type.prototype[method];if(!original)continue;
        type.prototype[method]=function(...args){window.__atlasFrames.draws++;return original.apply(this,args);};}` });
    phase = 'interactions';
    if (storedDialogOnly) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const storedQuery = storedDialogOnly ? '&atlas-cache=stored-pending' : '';
    await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?atlas=generated${storedQuery}` });
    await until('Boolean(document.querySelector(".ua-room-btn"))', 'actual host and Atlas ready');
    const button = (selector, text) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    // Floor Stack rows carry a visual mark beside their name; match the name alone.
    const stackRow = (list, text) => `Array.from(document.querySelectorAll(${JSON.stringify(`${list} button`)})).find(b=>b.querySelector('.ua-rung-name')?.textContent.trim()===${JSON.stringify(text)})`;
    const roomButton = (floor, label) => `(()=>{const section=Array.from(document.querySelectorAll('.ua-rooms section')).find(s=>s.getAttribute('aria-label')===${JSON.stringify(floor)});
      return section&&Array.from(section.querySelectorAll('button')).find(b=>b.querySelector('span').textContent===${JSON.stringify(label)});})()`;
    const presentation = `(()=>{
      const dt=Array.from(document.querySelectorAll('dt')).find(row=>row.textContent.trim()==='Overlay source');
      const value=dt?.nextElementSibling?.tagName==='DD'?dt.nextElementSibling.textContent.trim():null;
      const allowed=['available','stored-copy','loading','not-loaded','saved-documentary-snapshot','source-unavailable','current-source-unavailable','selection-changed','no-native-building-link'];
      const stored=document.querySelector('[aria-label="Electrical layer"] .ua-key-stored');
      const busy=stored?.getAttribute('aria-busy');
      return {reason:value===null?'missing':allowed.includes(value)?value:'other',stored:!!stored,busy:busy==='true'?true:busy==='false'?false:null};
    })()`;
    const click = async (expression, observe = false) => {
      const point = await evaluate(`(()=>{const b=(${expression});if(!b||b.disabled)throw Error('Missing/enabled target: '+${JSON.stringify(expression)});
        b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height${observe ? `,presentation:${presentation}` : ''}};})()`);
      assert(point.w > 0 && point.h > 0, `Visible click target: ${expression}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await wait(50);
      return point.presentation;
    };
    const key = async (key, code, number, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: number, modifiers,
        ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: number, modifiers });
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
    const check = async (name, run) => { phase = name; await run(); report.checks.push(name); };

    if (!electricalOnly && !storedDialogOnly) {
    await check('one Atlas in the production host', async () => {
      assert.equal(await evaluate('document.querySelectorAll(".ua-shell").length'), 1);
      assert.equal(await evaluate('document.querySelectorAll("[aria-label=\'Atlas source\']").length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(".ua-room-btn").length'), 10);
    });
    await wait(500);
    report.webgl = await evaluate(`(()=>{const canvas=document.querySelector('.ua-viewport canvas');const context=window.__atlasContexts.get(canvas);
      const gl=context?.type.startsWith('webgl')?context.value:null;
      const debug=gl?.getExtension('WEBGL_debug_renderer_info');return {available:!!gl,lost:gl?.isContextLost()??null,
        renderer:gl?(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null,
        backend:canvas?.dataset.renderer??null,context:context?.type??null,version:gl?.getParameter(gl.VERSION)??null,width:canvas?.width,height:canvas?.height,
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
      const before = await evaluate(`(${spread})?.getAttribute('aria-pressed')`);
      assert(['true', 'false'].includes(before));
      await click(spread);
      assert.equal(await evaluate(`(${spread})?.getAttribute('aria-pressed')`), String(before !== 'true'));
      await click(spread);
      assert.equal(await evaluate(`(${spread})?.getAttribute('aria-pressed')`), before);
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
    }
    if (storedDialogOnly) {
      await check('stored-dialog-currentness: identical refresh retains mounted modal and uninterrupted focus; denial retires it', async () => {
        const pendingCopy = 'document.documentElement.dataset.syntheticAtlasRefresh==="pending"&&document.querySelector(".ua-stored-note")?.getAttribute("aria-busy")==="true"';
        const openPendingDialog = async () => {
          await until('Boolean(document.querySelector(".ua-room-btn"))', 'generated stored Atlas ready');
          await until(pendingCopy, 'verified stored copy mounted while fresh port read is pending');
          assert.match(await evaluate('document.querySelector(".ua-stored-note").textContent'), /Stored copy.*updating/s);
          await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
          await sheet(true); await click(roomButton('Ground floor, Synthetic house', 'Hall'));
          await sheet(false); await click(button('.layer-bar button', 'Electrical'));
          await click(button('[aria-label="Atlas view"] button', 'Plan'));
          await until('document.querySelectorAll(".ua-plan path").length>0', 'stored Plan drawn');
          // Compact follows the measured stage width (<=720), not viewport
          // height. 844px leaves a tablet host whose stage can exceed that
          // boundary; use a phone-width landscape viewport and verify both.
          await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 390, deviceScaleFactor: 1, mobile: false });
          await until(`(()=>{const width=document.querySelector('.ua-viewport')?.getBoundingClientRect().width;
            return matchMedia('(max-height: 480px)').matches&&matchMedia('(orientation: landscape)').matches
              &&width>0&&width<=720&&document.querySelector('.ua-shell')?.classList.contains('is-compact');})()`, 'short landscape compact stage');
          report.storedDialogViewport = await evaluate(`(()=>({width:innerWidth,height:innerHeight,
            short:matchMedia('(max-height: 480px)').matches,landscape:matchMedia('(orientation: landscape)').matches,
            stageWidth:document.querySelector('.ua-viewport').getBoundingClientRect().width,
            compact:document.querySelector('.ua-shell').classList.contains('is-compact')}))()`);
          // The short-layout fold lives in a clipped horizontal rail. A
          // positive bounding box alone does not prove its centre receives a
          // pointer event. Reach the actual control with native Tab instead;
          // never focus/click it through DOM APIs or bypass a hidden control.
          const foldFocused = 'document.activeElement===document.querySelector(".ua-fold-layers")';
          for (const due = Date.now() + 10_000; !await evaluate(foldFocused) && Date.now() < due;)
            await key('Tab', 'Tab', 9);
          assert.equal(await evaluate(foldFocused), true, 'Native Tab reaches the Layer details opener');
          const opener = await evaluate(`(()=>{const b=document.querySelector('.ua-fold-layers'),r=b.getBoundingClientRect(),s=getComputedStyle(b);
            return {connected:b.isConnected,enabled:!b.disabled,visible:r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none',
              inert:!!b.closest('[inert],[hidden],[aria-hidden="true"]'),popup:b.getAttribute('aria-haspopup'),expanded:b.getAttribute('aria-expanded')};})()`);
          assert.deepEqual(opener, { connected: true, enabled: true, visible: true, inert: false, popup: 'dialog', expanded: 'false' });
          await key('Enter', 'Enter', 13);
          await until('document.querySelector(".ua-layer-dialog")?.matches(":modal")', 'actual Layer details native modal');
          assert.equal(await evaluate('document.querySelector(".ua-fold-layers").getAttribute("aria-expanded")'), 'true');
          await key('Tab', 'Tab', 9);
          assert.equal(await evaluate('document.activeElement===document.querySelector(".ua-layer-dialog .ua-key-head")'), true,
            'Native Tab focuses the existing layer control inside the modal');
        };
        await openPendingDialog();
        // Reduced motion snaps the camera; layout can still adjust its fit.
        // Require the existing Plan matrix to settle before comparing it.
        const settledPlan = async () => {
          let last = null, still = 0;
          for (const due = Date.now() + 10_000; Date.now() < due; await wait(100)) {
            // Read every SVG transform in order, including the source-origin
            // translate after planMatrix. multiply returns a new matrix;
            // never consolidate or otherwise mutate React's transform list.
            const matrix = await evaluate(`(()=>{
              const transforms=document.querySelector('.ua-plan')?.transform.baseVal;
              if(!transforms?.numberOfItems)return null;
              let composed=new DOMMatrix();
              for(let i=0;i<transforms.numberOfItems;i++){
                const m=transforms.getItem(i).matrix;
                composed=composed.multiply(new DOMMatrix([m.a,m.b,m.c,m.d,m.e,m.f]));
              }
              return [composed.a,composed.b,composed.c,composed.d,composed.e,composed.f];
            })()`);
            if (!matrix || matrix.length !== 6 || !matrix.every(Number.isFinite)) { last = null; still = 0; continue; }
            still = last && matrix.every((n, i) => Math.abs(n - last[i]) < (i < 4 ? 1e-3 : .05)) ? still + 1 : 0;
            if (still >= 4) return matrix;
            last = matrix;
          }
          throw new Error('Stored-copy Plan transform did not settle');
        };
        const beforePlan = await settledPlan();
        assert.equal(await selectedRoom(), 'Hall');
        assert.equal(await evaluate('document.querySelector(".ua-room-floor").textContent'), 'Ground floor, Synthetic house');
        assert.equal(await evaluate(pendingCopy), true, 'Fresh read remains held through room, Plan and modal setup');
        // Retain actual nodes, not selectors which could silently find replacements.
        // Observe removals and all focus transitions, including loss followed by
        // restoration between the final assertions. No focus setter runs here.
        await evaluate(`(()=>{
          const shell=document.querySelector('.ua-shell'), stage=document.querySelector('.ua-stage'), viewport=document.querySelector('.ua-viewport');
          const dialog=document.querySelector('.ua-layer-dialog'), control=document.activeElement;
          const heading=document.querySelector('.ua-inspector.is-room h2'), note=document.querySelector('.ua-stored-note');
          const nodes={shell,stage,viewport,dialog,control,heading}, removed=[], focus=[], losses=[];
          const focusChange=event=>focus.push({type:event.type,onControl:event.target===control});
          for(const type of ['blur','focusout','focusin']) document.addEventListener(type,focusChange,true);
          const closed=()=>losses.push('dialog-close'); dialog.addEventListener('close',closed);
          const observe=records=>{for(const record of records)for(const node of record.removedNodes)
            for(const [name,held] of Object.entries(nodes))if(node===held||node.contains(held))removed.push(name);};
          const observer=new MutationObserver(observe);observer.observe(document.body,{childList:true,subtree:true});
          let frame;const sample=()=>{if(document.activeElement!==control||!dialog.matches(':modal')||Object.values(nodes).some(node=>!node.isConnected))losses.push('frame-lifetime-or-focus');frame=requestAnimationFrame(sample);};
          frame=requestAnimationFrame(sample);
          window.__storedDialogCurrentness={nodes,note,removed,focus,losses,stop(){observe(observer.takeRecords());observer.disconnect();cancelAnimationFrame(frame);
            for(const type of ['blur','focusout','focusin'])document.removeEventListener(type,focusChange,true);dialog.removeEventListener('close',closed);}};
        })()`);
        await evaluate('window.dispatchEvent(new CustomEvent("synthetic-atlas-refresh-release",{detail:"identical"}))');
        await until('document.documentElement.dataset.syntheticAtlasRefresh==="identical"&&!document.querySelector(".ua-stored-note")', 'identical fresh read settles stored/pending indicator');
        const afterPlan = await settledPlan();
        assert(beforePlan.every((n, i) => Math.abs(n - afterPlan[i]) < (i < 4 ? 1e-3 : .05)),
          `Settled Plan transform retained: ${JSON.stringify({ beforePlan, afterPlan })}`);
        const lifetime = await evaluate(`(()=>{const held=window.__storedDialogCurrentness;held.stop();const n=held.nodes;
          return {sameShell:document.querySelector('.ua-shell')===n.shell,sameStage:document.querySelector('.ua-stage')===n.stage,
            sameViewport:document.querySelector('.ua-viewport')===n.viewport,sameDialog:document.querySelector('.ua-layer-dialog')===n.dialog,
            sameHeading:document.querySelector('.ua-inspector.is-room h2')===n.heading,connected:Object.values(n).every(node=>node.isConnected),
            modal:n.dialog.matches(':modal'),focused:document.activeElement===n.control,storedIndicatorRemoved:!held.note.isConnected,
            removed:held.removed,focus:held.focus,losses:held.losses};})()`);
        assert.deepEqual(lifetime, { sameShell: true, sameStage: true, sameViewport: true, sameDialog: true, sameHeading: true,
          connected: true, modal: true, focused: true, storedIndicatorRemoved: true, removed: [], focus: [], losses: [] });
        assert.equal(await selectedRoom(), 'Hall');
        assert.equal(await evaluate('document.querySelector(".ua-room-floor").textContent'), 'Ground floor, Synthetic house');
        // The stable-stage assertion must never preserve content after denial.
        // A separate generated page sends 403 through the production reader.
        await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?atlas=generated&atlas-cache=stored-pending` });
        await openPendingDialog();
        assert.equal(await evaluate(pendingCopy), true, 'Denied read remains held until its stored modal is open');
        await evaluate('window.__deniedStoredStage=document.querySelector(".ua-stage");window.__deniedStoredDialog=document.querySelector(".ua-layer-dialog");window.dispatchEvent(new CustomEvent("synthetic-atlas-refresh-release",{detail:"denied"}))');
        await until('Boolean(document.querySelector(".ua-shell [role=alert]"))&&!document.querySelector(".ua-stage")', 'denied read retires the stored stage');
        assert.equal(await evaluate('window.__deniedStoredStage.isConnected'), false);
        assert.equal(await evaluate('window.__deniedStoredDialog.isConnected'), false);
        assert.equal(await evaluate('document.querySelectorAll(".ua-room-btn,.ua-layer-dialog,.ua-stored-note").length'), 0,
          'Denied content and its layer dialog are removed, never stabilized');
        report.storedDialogCurrentness = { lifetime, beforePlan, afterPlan, deniedStageRetired: true };
        report.webgl = { available: false, diagnostic: 'Named DOM currentness case; GPU rendering not measured' };
      });
    } else {
    await check('historic drawing group uses projected room badges and retains unknown placement', async () => {
      await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?atlas=generated&atlas-drawing-groups=generated&drawing-group-control=generated-reopen-v1` });
      await until('Boolean(document.querySelector(".ua-room-btn"))', 'generated documentary host ready');
      await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
      await sheet(false); await click(button('.layer-bar button', 'Electrical'));
      await until('document.querySelectorAll(".ua-marker").length===2', 'projected documentary markers');
      await sheet(true); await click(roomButton('Ground floor, Synthetic house', 'Hall'));
      const symbol = `Array.from(document.querySelectorAll('.ua-doc')).find(row=>row.querySelector('.ua-doc-label')?.textContent==='Generated hall symbol')`;
      await click(`(${symbol}).querySelector('summary')`);
      const groupButton = button('.ua-doc button', 'Show drawing group');
      assert.equal(await evaluate(`(()=>{const b=(${groupButton});b.focus();return document.activeElement===b;})()`), true, 'Drawing group action accepts keyboard focus');
      await key('Enter', 'Enter', 13);
      await until('Boolean(document.querySelector("[aria-label=\'Historic drawing group\']"))', 'drawing group inspector');
      assert.match(await evaluate('document.querySelector("[aria-label=\'Historic drawing group\']").textContent'), /Historic drawing group, unverified/);
      assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[aria-label=\'Historic drawing group\'] li")).map(row=>row.textContent)'),
        ['Generated hall symbol — Hall', 'Generated living symbol — Living room', 'Generated unplaced symbol — room unknown']);
      const highlights = await evaluate('Array.from(document.querySelectorAll(".ua-marker.is-electrical-group")).map(row=>row.getAttribute("aria-label")).sort()');
      assert.equal(highlights.length, 2); assert.match(highlights[0], /^Hall:/); assert.match(highlights[1], /^Living room:/);
      assert.equal(await evaluate('document.querySelectorAll(".ua-positions > *").length'), 0, 'Room membership supplies no fixture coordinates');
      assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".ua-marker.is-electrical-group")).boxShadow'), 'none');
      if (electricalOnly) report.webgl = await evaluate(`(()=>{const canvas=document.querySelector('.ua-viewport canvas');const context=window.__atlasContexts.get(canvas);
        const gl=context?.type.startsWith('webgl')?context.value:null;
        const debug=gl?.getExtension('WEBGL_debug_renderer_info');return {available:!!gl,lost:gl?.isContextLost()??null,
          renderer:gl?(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null,
          backend:canvas?.dataset.renderer??null,context:context?.type??null,version:gl?.getParameter(gl.VERSION)??null,width:canvas?.width,height:canvas?.height,drawCalls:window.__atlasFrames.draws};})()`);
      await sheet(false); await click('document.querySelector(".ua-marker[aria-label^=\'Living room:\']")');
      assert.equal(await selectedRoom(), 'Living room');
      assert.equal(await evaluate('document.querySelectorAll(".ua-marker.is-electrical-group").length'), 2, 'Whole-property membership remains available while inspecting another room');
      await click(button('.ua-inspector button', 'Clear drawing group'));
      assert.equal(await evaluate('document.querySelectorAll(".ua-marker.is-electrical-group").length'), 0);
    });
    const openDrawingGroup = async invocation => {
      await clear();
      await sheet(true); await click(roomButton('Ground floor, Synthetic house', 'Hall'));
      const symbol = `Array.from(document.querySelectorAll('.ua-doc')).find(row=>row.querySelector('.ua-doc-label')?.textContent==='Generated hall symbol')`;
      if (!await evaluate(`(${symbol}).open`)) await click(`(${symbol}).querySelector('summary')`);
      const before = await click(button('.ua-doc button', 'Show drawing group'), true);
      const observed = await evaluate(`(()=>{
        const layer=Array.from(document.querySelectorAll('.layer-bar button')).find(b=>b.textContent.trim()==='Electrical');
        const key=document.querySelector('[aria-label="Electrical layer"]');
        const room=document.querySelector('.ua-inspector.is-room h2')?.textContent;
        const coverage=Array.from(key?.querySelectorAll('.ua-coverage-state') ?? []).slice(0,10).map(row=>{
          const value=row.textContent.toLowerCase();
          return value.includes('stored-copy')?'stored-copy':value.includes('unavailable')?'unavailable':value.includes('available')?'available':value.includes('loading')?'loading':'other';
        });
        return { highlights:document.querySelectorAll('.ua-marker.is-electrical-group').length,
          inspector:!!document.querySelector('[aria-label="Historic drawing group"]'),
          electricalPressed:layer?.getAttribute('aria-pressed') ?? null,
          room:room==='Hall'?'Hall':room==null?'none':'other',
          source:{ keyPresent:!!key, stored:!!key?.querySelector('.ua-key-stored'), coverage }, presentation:${presentation} };
      })()`);
      if (observed.highlights !== 2) report.drawingGroupFailure = { invocation,
        expected: { highlights: 2, inspector: true, electricalPressed: 'true', room: 'Hall', source: 'documentary records available, possibly stored' }, before, observed };
      assert.equal(observed.highlights, 2);
    };
    await check('drawing group retires on clear room, layer off, source invalidation and publication owner replacement', async () => {
      const retired = async () => {
        await until('document.querySelectorAll(".ua-marker.is-electrical-group").length===0&&!document.querySelector("[aria-label=\'Historic drawing group\']")', 'drawing group retired');
      };
      await openDrawingGroup('before clear room'); await clear(); await retired();
      await openDrawingGroup('before layer off'); await sheet(false); await click(button('.layer-bar button', 'Electrical')); await retired();
      await click(button('.layer-bar button', 'Electrical')); await openDrawingGroup('after layer on');
      const command = value => `window.dispatchEvent(new CustomEvent('synthetic-drawing-control',{detail:${JSON.stringify(value)}}))`;
      const control = value => `document.documentElement.dataset.drawingGroupControl===${JSON.stringify(value)}`;
      const studio = `Array.from(document.querySelectorAll('.ua-coverage-list li')).find(row=>row.querySelector('.ua-coverage-name')?.textContent==='Synthetic studio')?.querySelector('.ua-coverage-state')?.textContent`;
      const groupShown = `document.querySelectorAll('.ua-marker.is-electrical-group').length===2&&!!document.querySelector('[aria-label="Historic drawing group"]')`;
      const stored = `(${presentation}).reason==='stored-copy'&&(${presentation}).stored&&(${presentation}).busy===true`;
      let scenarioFailed = false;
      try {
        await evaluate(`${command('arm')};window.dispatchEvent(new Event('synthetic-atlas-source-invalidate'))`);
        assert.equal(await evaluate(control('timer-captured')), true, 'Expected one invalidation reopen timer');
        await retired();
        await evaluate(command('consume'));
        await until(`${control('both-waiting')}&&(${studio})?.includes('loading')&&${stored}`, 'both generated reads held');
        await evaluate(command('studio'));
        await until(`${control('studio-released')}&&(${studio})?.includes('no-native-building-link')&&${stored}`, 'studio unavailable and house held');
        await openDrawingGroup('after source invalidation');
        assert.equal(await evaluate(`${control('studio-released')}&&${stored}&&${groupShown}`), true, 'Stored selection precedes replacement');
        await evaluate(command('house'));
        await until(`${control('released')}&&(${presentation}).reason==='available'&&!(${presentation}).stored&&document.querySelectorAll('.ua-marker.is-electrical-group').length===0&&!document.querySelector('[aria-label="Historic drawing group"]')`, 'available replacement retires group');
        await retired();
        await openDrawingGroup('before publication replacement');
        assert.equal(await evaluate(`${control('released')}&&${groupShown}`), true, 'Fresh group selected before publication replacement');
        await evaluate('window.dispatchEvent(new Event("synthetic-atlas-selection-replace"))'); await retired();
        await until('Boolean(document.querySelector(".ua-room-btn"))', 'replacement publication ready');
      } catch (error) {
        scenarioFailed = true; throw error;
      } finally {
        let cleanupClean = false;
        try {
          cleanupClean = await evaluate(`(()=>{${command('cancel')};return document.documentElement.dataset.drawingGroupCleanup==='disposed-clean';})()`);
        } catch { /* Preserve an existing failure; otherwise fail below. */ }
        if (!cleanupClean) {
          if (scenarioFailed) console.error(JSON.stringify({ drawingGroupCleanup: 'failed' }));
          else throw new Error('Generated drawing group cleanup failed');
        }
      }
    });
    await check('drawing group remains keyboard-operable with reduced motion', async () => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?atlas=generated&atlas-drawing-groups=generated` });
      await until('Boolean(document.querySelector(".ua-room-btn"))', 'reduced-motion host ready');
      assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
      await click(stackRow('.ua-stack-buildings', 'Synthetic house'));
      await sheet(false); await click(button('.layer-bar button', 'Electrical'));
      await until('document.querySelectorAll(".ua-marker").length===2', 'reduced-motion documentary markers');
      await openDrawingGroup('reduced motion');
      await evaluate('document.querySelector(".ua-viewport").focus()'); await key('Escape', 'Escape', 27);
      assert.equal(await selectedRoom(), null);
      assert.equal(await evaluate('document.querySelectorAll(".ua-marker.is-electrical-group").length'), 0);
    });
    await check('generated breaker trace mounts actual Inspector, selects panel room and retires explicit props', async () => {
      await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/electrical-trace.html` });
      const trace = 'document.querySelector("[aria-label=\'Circuit and panel\']")';
      const text = () => evaluate(`(${trace})?.textContent ?? ''`);
      const selected = () => evaluate('document.querySelector("[aria-label=\'Selected occurrence\']").textContent');
      const noCircuitFacts = async () => {
        assert.doesNotMatch(await text(), /Generated circuit|Generated panel|Circuit association confirmed by test/);
        assert.equal(await evaluate(`(${trace})?.querySelectorAll('button').length ?? 0`), 0, 'Retired facts have no room action');
      };
      await until(`Boolean(${trace})`, 'generated actual Inspector trace');
      assert.equal(await selected(), 'syn-occ-hall');
      const owner = await text();
      for (const value of ['Generated circuit A', 'Generated panel Δ', 'A1', '16 A', 'Owner report', 'Low', 'Not confirmed by test'])
        assert.ok(owner.includes(value), value);
      assert.doesNotMatch(owner, /verified wiring|wiring verified|wire route|cable/i);
      // The real TraceRowDetail button calls Inspector.choose, then atlasReducer.
      await click(button('[aria-label="Circuit and panel"] button', 'Living room'));
      await until('document.querySelector(".ua-inspector h2")?.textContent === "Living room"', 'actual Inspector selects panel room');
      assert.equal(await selected(), 'syn-occ-living');
      assert.equal(await evaluate('document.activeElement === document.querySelector(".ua-inspector h2")'), true,
        'Inspector navigation focuses its actual new heading');
      await click(button('nav button', 'Show generated test'));
      await until(`(${trace})?.textContent.includes('Circuit association confirmed by test')`, 'generated tested-state projection');
      assert.match(await text(), /Generated circuit C/);
      assert.match(await text(), /Generated panel Δ/);
      assert.match(await text(), /observed 2026-10-01T12:00:00Z/);
      assert.match(await text(), /Generated test-result assertion; no real test performed/);
      assert.doesNotMatch(await text(), /verified wiring|wiring verified|wire route|cable/i);
      // Explicit replacement of the supplied projection, NOT an independent
      // native electrical-review withdrawal subscription or production mount.
      await click(button('nav button', 'Replace with withheld projection'));
      await until(`(${trace})?.textContent.includes('Withheld:')`, 'projector withholds replaced review context');
      assert.match(await text(), /No current review of this exact assertion/);
      await noCircuitFacts();
      await click(button('nav button', 'Show owner report'));
      await until(`(${trace})?.textContent.includes('Generated circuit A')`, 'explicit current prop restored');
      await click(button('nav button', 'Remove electrical data'));
      await until(`!(${trace})`, 'electricalData prop removed');
      assert.ok(await evaluate('Boolean(document.querySelector("[aria-label=\'Historic drawing group\']"))'),
        'Removing electrical data preserves the separate documentary group');
      assert.doesNotMatch(await evaluate('document.querySelector(".ua-inspector").textContent'), /Generated circuit|Generated panel|Circuit association confirmed by test/);
      await click(button('body > #root button', 'Remount Inspector'));
      await until(`(${trace})?.textContent.includes('Generated circuit A')`, 'fresh generated Inspector mount');
      assert.equal(await evaluate('document.querySelector("[aria-label=\'Inspector generation\']").textContent'), '1');
      assert.equal(await evaluate('document.querySelectorAll(".ua-inspector").length'), 1, 'Only the new Inspector is mounted');
      assert.equal(await selected(), 'syn-occ-hall', 'The keyed Inspector mount resets actual selection');
      await click(button('[aria-label="Circuit and panel"] button', 'Living room'));
      await until('document.querySelector(".ua-inspector h2")?.textContent === "Living room"', 'fresh room action works');
      assert.equal(await selected(), 'syn-occ-living');
      await click(button('nav button', 'Remove electrical data'));
      await until(`!(${trace})`, 'fresh mount also removes its electrical data');
    });
    const openLibrary = async mode => {
      await send('Page.navigate', { url: `${origin}/lantern-tests/unified-atlas-regression/index.html?electrical-library=${mode}` });
      await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Library")', 'library navigation');
      await click(button('button', 'Library'));
      await until('Boolean(document.querySelector("button[aria-label=\'Open Fictional kitchen, PDF page 2\']"))', 'generated electrical library');
      await click('document.querySelector("button[aria-label=\'Open Fictional kitchen, PDF page 2\']")');
    };
    const checkPendingKeyboard = async message => {
      // Suspense may retain the previous primary subtree hidden beside its
      // fallback. Only the visible dialog is an interactive focus target.
      const dialog = 'Array.from(document.querySelectorAll(".electrical-library-pending")).find(row=>row.getClientRects().length>0)';
      await until(`(${dialog})?.querySelector('[role="status"]')?.textContent===${JSON.stringify(message)}`, message);
      const focusedClose = `document.activeElement===(${dialog})?.querySelector('button')`;
      await until(focusedClose, 'The visible dialog focuses Close drawing');
      await key('Tab', 'Tab', 9); assert.equal(await evaluate(focusedClose), true);
      await key('Tab', 'Tab', 9, 8); assert.equal(await evaluate(focusedClose), true);
      await key('Escape', 'Escape', 27);
      await until('!document.querySelector(".electrical-library-backdrop")', 'drawing closes with Escape');
      assert.equal(await evaluate('document.activeElement?.getAttribute("aria-label")'), 'Open Fictional kitchen, PDF page 2');
    };
    await check('pending electrical drawing traps Tab and Shift-Tab, closes with Escape and restores opener', async () => {
      await send('Fetch.enable', { patterns: [{ urlPattern: '*NativeSceneDrawing*', resourceType: 'Script', requestStage: 'Request' }] });
      await openLibrary('generated');
      await checkPendingKeyboard('Preparing drawing…');
      assert.equal(cdp.paused.length, 1, 'The real lazy viewer request was held pending');
      // The generated lazy chunk completes only after the pending dialog is closed.
      for (const request of cdp.paused.splice(0)) await send('Fetch.continueRequest', { requestId: request.requestId });
      await send('Fetch.disable', {});
    });
    await check('unavailable electrical drawing traps Tab and Shift-Tab, closes with Escape and restores opener', async () => {
      await openLibrary('unavailable'); await checkPendingKeyboard('The drawing source is unavailable.');
    });
    }
    assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
    assert(cdp.requests.every(url => url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')),
      'Application requests remain on owned loopback or generated memory URLs');
    report.applicationRequests = cdp.requests.map(url => url.startsWith(origin) ? new URL(url).pathname : url.split(':')[0] + ':');
    report.errors = cdp.errors;
    report.status = report.webgl.available && !report.webgl.lost && report.webgl.drawCalls > 0 ? 'passed-browser-webgl' : 'passed-browser-dom-rendering-unverified';
  }
} catch (error) {
  report.status = phase === 'browser setup' ? 'blocked' : 'failed';
  report.phase = phase;
  report.error = { name: error.name, message: error.message };
  report.stderr = stderr;
  report.errors = cdp?.errors ?? [];
  report.applicationRequests = cdp?.requests.map(url => url.startsWith('http://127.0.0.1:') ? new URL(url).pathname : url.split(':')[0] + ':') ?? [];
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
  // Fixed generated labels/enums, DOM count, booleans and <=10 coverage values
  // fit within 1024 ASCII bytes, intact (no slicing). The runner tails stdout +
  // stderr, so emit last on stderr to preserve every existing snapshot field.
  if (report.drawingGroupFailure) console.error(JSON.stringify({ drawingGroupFailure: report.drawingGroupFailure }));
  if (storedDialogOnly && exitCode !== 0) {
    // Fixed categories only: do not emit page text, paths, messages or stderr.
    const status = ['running', 'blocked', 'failed', 'passed-browser-webgl', 'passed-browser-dom-rendering-unverified'].includes(report.status) ? report.status : 'other';
    const failurePhase = phase === 'build' || phase === 'browser setup' || phase === 'interactions' ? phase
      : phase.startsWith('stored-dialog-currentness:') ? 'stored-dialog-currentness' : 'other';
    const name = report.error?.name;
    const error = name == null ? null : ['AssertionError', 'Error', 'TypeError', 'RangeError'].includes(name) ? name : 'other';
    const signal = browser?.signalCode ?? null;
    const childSignal = signal === null || ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal) ? signal : 'other';
    console.error(JSON.stringify({ storedDialogFailure: { status, phase: failurePhase, error,
      fixtureExitCode: exitCode, cleanup: report.cleanup ?? null, childEvents,
      childExitCode: browser?.exitCode ?? null, childSignal } }));
  }
}
process.exitCode = exitCode;
