// visual-01: generated source host only. SOURCE FOR REVIEW; registration belongs to the source owner.
// Direct CDP follows unified-atlas-regression/browser.mjs. No added driver, launch bypass or private input.
// Reachability and a minimum reading window are separate results; neither establishes device acceptance.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0', 'Use Node 26.10.0 and the locked npm 11.19.1 dependency setup');
assert.deepEqual(process.argv.slice(2), [], 'This runner has no alternate fixtures or arguments');
const frontend = resolve(fileURLToPath(new URL('../', import.meta.url)));
const root = resolve(frontend, '..');
const fixtureRoot = join(frontend, 'lantern-tests/source-host-visual');
const fixturePath = '/lantern-tests/source-host-visual/?atlas=generated&atlas-entry-building=syn-building-house';
const pins = {
  'frontend/lantern-tests/source-host-visual/main.tsx': '147134d21aacf8900e5d558ed954af53b97775ccc74439368297c6de50982f06',
  'frontend/lantern-tests/unified-atlas/synthetic-atlas.ts': '098cda0194627bfe9a3cb8727c88eea39a5267721eb9094b94f5e2b2021aad84',
  'frontend/src/lantern/unified-atlas/unified-atlas.css': '6df973059a741e747683b4862a7abef483877791a390d3252aa8446510746db5',
  'frontend/package-lock.json': '62a282e363831f234774b6964a49beb3e71c6a5374b9717d83ed4207e909505d',
};
for (const [path, expected] of Object.entries(pins)) {
  assert.equal(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), expected, `Input pin: ${path}`);
}
const executable = process.env.HOUSEATLAS_CHROMIUM;
assert(executable && isAbsolute(executable) && existsSync(executable), 'Set HOUSEATLAS_CHROMIUM to the inspected local browser binary');
const browserPath = realpathSync(executable);
// Refuse wrappers which can add unreviewed switches or touch an existing user profile.
const header = Buffer.alloc(4), descriptor = openSync(browserPath, 'r');
try { assert.equal(readSync(descriptor, header, 0, 4, 0), 4, 'Browser executable header'); }
finally { closeSync(descriptor); }
assert(['7f454c46', 'cffaedfe', 'cefaedfe', 'cafebabe'].includes(header.toString('hex')), 'Use an inspected ELF/Mach-O browser binary, not a launcher script');
const version = spawnSync(browserPath, ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
assert.equal(version.status, 0, version.error?.message ?? version.stderr);
assert.match(version.stdout.trim(), /^(Chromium|Google Chrome) \d+\.\d+\.\d+\.\d+\b/, 'Unrecognized browser version');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  status: 'running', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, browser: { path: browserPath, version: version.stdout.trim() }, pins, fixturePath,
  readingPolicy: 'Proposed minimum: full legend width; min(content height, max(96px, tallest heading + three body lines + 12px)) height; each body exposes up to three complete first-paragraph lines at once during normal scrolling; every rendered legend text line is fully visible and hit-testable in a recorded window. Scrolling never waives the viewport minimum. Passing is not visual/device acceptance.',
  controlPolicy: 'Keyboard targets must expose their whole client rectangle within 1px, be at least 24px by 24px, and hit their own subtree at all five inset probe points.',
  requestAuditPolicy: 'After-the-fact audit of Network events observed on the attached page session only. This does not prevent egress or cover browser background requests, workers or other targets; no network-containment or zero-egress claim.',
  cleanupPolicy: 'Cleanup success means owned child close events and all owned pipe closures, not absence of detached descendants. Numeric group operations require the original live leader before every operation; uncertain ownership stops signalling, records HOLD and retains scratch.',
  cleanupHolds: [],
  cases: [], requests: [], errors: [],
};
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-compact-legend-'));
let browser, server, cdp, contextId, failure, buildChild, buildTermination, browserTermination, stderr = '';
const buildAbort = new AbortController();
let phase = 'build';
const due = Date.now() + 240_000;
const children = new WeakMap();
const trackChild = (child, label) => {
  const state = { label, pid: child.pid, spawned: false, exited: false, closed: false, hold: null };
  children.set(child, state);
  child.once('spawn', () => { state.spawned = true; });
  child.once('exit', () => { state.exited = true; });
  child.once('close', () => { state.closed = true; });
  return child;
};
const childClosed = child => !child || children.get(child)?.closed === true
  && child.stdio.every(stream => !stream || stream.closed === true);
const closureEvidence = child => child ? {
  pid: child.pid ?? null, exited: children.get(child).exited, closeObserved: children.get(child).closed,
  pipes: child.stdio.map((stream, index) => ({ index, closed: !stream || stream.closed === true })),
} : null;
const ownsLeader = child => {
  const state = children.get(child);
  return !!state?.pid && state.pid === child.pid && state.spawned && !state.exited && !state.closed
    && child.exitCode === null && child.signalCode === null;
};
const holdCleanup = (child, reason) => {
  const state = children.get(child);
  if (!state.hold) {
    state.hold = reason;
    report.cleanupHolds.push({ child: state.label, pid: state.pid ?? null, reason });
  }
  return false;
};
const groupAlive = child => {
  if (!ownsLeader(child)) { holdCleanup(child, 'Original group leader ownership unavailable before probe'); return null; }
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
// Natural close is checked through the original ChildProcess and its pipes, without probing a stale PGID.
// A lost leader while termination is incomplete makes further numeric group operations unsafe.
const terminateGroup = async child => {
  if (!child) return true;
  const state = children.get(child);
  if (state.hold) return false;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (childClosed(child)) return true;
    const alive = groupAlive(child);
    if (alive === null) return false;
    if (alive) {
      if (!ownsLeader(child)) return holdCleanup(child, 'Original group leader ownership changed before signal');
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const deadline = Date.now() + 2000;
    while (!childClosed(child) && Date.now() < deadline) {
      if (!ownsLeader(child)) return holdCleanup(child, 'Leader exited before child and pipe closure was confirmed');
      await wait(40);
    }
  }
  return childClosed(child) || holdCleanup(child, 'Bounded termination ended without child and pipe closure');
};
const terminateBuild = () => buildChild ? buildTermination ??= terminateGroup(buildChild) : Promise.resolve(true);
const terminateBrowser = () => browser ? browserTermination ??= terminateGroup(browser) : Promise.resolve(true);
const stop = message => {
  failure ??= new Error(message);
  buildAbort.abort(failure);
  void terminateBuild().catch(error => { failure ??= error; });
  void terminateBrowser().catch(error => { failure ??= error; });
  server?.closeAllConnections();
  server?.close();
};
const interrupted = () => stop('Interrupted; owned browser run stopped');
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
const budget = setTimeout(() => stop('240-second build/browser budget exhausted'), 240_000);

class CDP {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.buffer = '';
    this.requests = []; this.errors = []; this.closed = false; this.lifecycle = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString();
      let at;
      while ((at = this.buffer.indexOf('\0')) >= 0) {
        const event = JSON.parse(this.buffer.slice(0, at)); this.buffer = this.buffer.slice(at + 1);
        if (event.id) {
          const pending = this.pending.get(event.id); if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(event.id);
          event.error ? pending.reject(new Error(event.error.message)) : pending.resolve(event.result);
        } else if (event.method === 'Page.lifecycleEvent') this.lifecycle.push({ ...event.params, sessionId: event.sessionId });
        else if (event.method === 'Runtime.exceptionThrown') this.errors.push(event.params.exceptionDetails.text);
        else if (event.method === 'Network.requestWillBeSent') this.requests.push({
          url: event.params.request.url, method: event.params.request.method,
        });
      }
    });
    const closed = error => {
      this.closed = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
    };
    child.once('exit', () => closed(new Error('Owned browser exited')));
    child.once('error', closed);
    child.stdio[3].on('error', closed);
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('Owned browser connection closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}

// Read-only page probe: client/scroll sizes, clipping by every overflow ancestor,
// viewport intersection, and text-block visibility. It does not change DOM, CSS or scroll offsets.
function geometry() {
  const rect = r => ({ x: r.left, y: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
  const measure = element => {
    if (!element) return null;
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    let left = Math.max(0, box.left + element.clientLeft), top = Math.max(0, box.top + element.clientTop);
    let right = Math.min(innerWidth, box.left + element.clientLeft + element.clientWidth);
    let bottom = Math.min(innerHeight, box.top + element.clientTop + element.clientHeight);
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent), r = parent.getBoundingClientRect();
      const clipX = /auto|scroll|hidden|clip/.test(s.overflowX), clipY = /auto|scroll|hidden|clip/.test(s.overflowY);
      if (clipX) { left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth); }
      if (clipY) { top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight); }
      if (clipX || clipY) ancestors.push({ tag: parent.tagName, class: parent.className, clipX, clipY, box: rect(r) });
    }
    let opaque = true;
    for (let parent = element; parent; parent = parent.parentElement) if (Number(getComputedStyle(parent).opacity) === 0) opaque = false;
    const laidOut = opaque && element.getClientRects().length > 0 && style.visibility === 'visible' && !element.closest('[hidden], [inert]');
    const width = laidOut ? Math.max(0, right - left) : 0, height = laidOut ? Math.max(0, bottom - top) : 0;
    const x = left + width / 2, y = top + height / 2;
    const hit = width && height ? document.elementFromPoint(x, y) : null;
    const points = width > 6 && height > 6 ? [[x, y], [left + 3, top + 3], [right - 3, top + 3], [left + 3, bottom - 3], [right - 3, bottom - 3]] : [];
    const hits = points.map(([px, py]) => { const target = document.elementFromPoint(px, py); return !!target && (target === element || element.contains(target)); });
    const fullClientExposed = width + 1 >= element.clientWidth && height + 1 >= element.clientHeight;
    return { box: rect(box), client: { width: element.clientWidth, height: element.clientHeight },
      content: { width: element.scrollWidth, height: element.scrollHeight },
      scroll: { left: element.scrollLeft, top: element.scrollTop }, overflow: { x: style.overflowX, y: style.overflowY },
      effective: { x: left, y: top, width, height }, clipped: width + 1 < element.clientWidth || height + 1 < element.clientHeight,
      centerHitWithin: !!hit && (hit === element || element.contains(hit)), clippingAncestors: ancestors,
      fullClientExposed, hitProbes: hits,
      controlVisible: laidOut && fullClientExposed && element.clientWidth >= 24 && element.clientHeight >= 24 && hits.length === 5 && hits.every(Boolean),
      fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 };
  };
  const textLines = element => {
    const frame = measure(element), lines = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        let line = lines.find(value => Math.abs(value.y - r.top) < 1 && Math.abs(value.bottom - r.bottom) < 1);
        if (!line) { line = rect(r); lines.push(line); }
        else { line.x = Math.min(line.x, r.left); line.right = Math.max(line.right, r.right); line.width = line.right - line.x; }
      }
    }
    return lines.sort((a, b) => a.y - b.y).map(line => {
      const e = frame.effective;
      const exposed = line.x + 1 >= e.x && line.right <= e.x + e.width + 1 && line.y + 1 >= e.y && line.bottom <= e.y + e.height + 1;
      const hits = exposed ? [0.1, 0.5, 0.9].map(fraction => {
        const hit = document.elementFromPoint(line.x + line.width * fraction, line.y + line.height / 2);
        return !!hit && (hit === element || element.contains(hit));
      }) : [];
      return { ...line, hitProbes: hits, fullyVisible: exposed && hits.length === 3 && hits.every(Boolean) };
    });
  };
  const keys = document.querySelector('.ua-keys');
  const sections = [...document.querySelectorAll('.ua-keys > .ua-key')];
  const legend = measure(keys);
  const rows = sections.map(section => ({ label: section.getAttribute('aria-label'),
    expanded: section.querySelector('.ua-key-head')?.getAttribute('aria-expanded'),
    box: measure(section), head: measure(section.querySelector('.ua-key-head')),
    body: measure(section.querySelector('.ua-key-body')),
    textBlocks: [...section.querySelectorAll('.ua-key-body p, .ua-key-body summary, .ua-key-body li')]
      .filter(element => element.getClientRects().length > 0)
      .map(element => ({ text: element.textContent.trim(), geometry: measure(element), lines: textLines(element) })) }));
  for (const row of rows) {
    const first = row.textBlocks[0], body = row.body;
    const required = Math.min(3, first?.lines.length ?? 0);
    const bodyHeight = body ? Math.min(body.client.height, 3 * body.lineHeight) : 0;
    row.readingWindow = !!first && required > 0 && first.geometry.fontSize >= 12 && first.geometry.lineHeight >= 14
      && body.effective.width + 1 >= body.client.width && body.effective.height + 1 >= bodyHeight
      && first.lines.some((line, at, lines) => lines.slice(at, at + required).length === required
        && lines.slice(at, at + required).every(value => value.fullyVisible));
  }
  const tallestHeading = Math.max(0, ...rows.map(row => row.head?.box.height ?? 0));
  const bodyLine = Math.max(0, ...rows.map(row => row.body?.lineHeight ?? 0));
  const minimum = legend ? Math.min(legend.content.height, Math.max(96, tallestHeading + 3 * bodyLine + 12)) : null;
  const textOverflow = rows.some(row => row.expanded === 'true' && row.body.content.width > row.body.client.width + 1);
  return { viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
    stage: measure(document.querySelector('.ua-stage')), bottom: measure(document.querySelector('.ua-bottom')),
    legend, rows, floorRail: measure(document.querySelector('.ua-ladder')),
    reading: { minimumHeight: minimum, actualHeight: legend?.effective.height ?? 0, textOverflow,
      fullWidthExposed: !!legend && legend.effective.width + 1 >= legend.client.width,
      viewportPasses: !!legend && legend.client.width > 0 && legend.effective.width + 1 >= legend.client.width
        && legend.effective.height + 1 >= minimum && !textOverflow },
    selection: { room: document.querySelector('.ua-inspector.is-room h2')?.textContent ?? null,
      floor: document.querySelector('.ua-room-floor')?.textContent ?? null },
    layers: [...document.querySelectorAll('.layer-bar button')].map(b => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') })),
    active: { text: document.activeElement?.textContent?.trim().slice(0, 120), label: document.activeElement?.getAttribute('aria-label'), geometry: measure(document.activeElement) } };
}

try {
  assert(!failure && Date.now() < due, failure?.message ?? 'Run cancelled before build');
  // The build worker uses this pinned Node and the existing Vite installation; no wrapper file or extra dependency.
  // A separate owned POSIX process group lets timeout/signals terminate a hung build and its descendants.
  const buildOptions = { root: fixtureRoot, base: '/', configFile: join(frontend, 'vite.config.ts'), publicDir: false,
    logLevel: 'error', build: { target: 'esnext', outDir: join(scratch, 'dist'), emptyOutDir: true,
      rolldownOptions: { input: join(fixtureRoot, 'index.html') } } };
  const worker = "import { build } from 'vite'; await build(JSON.parse(process.argv[1]));";
  buildChild = trackChild(spawn(process.execPath, ['--input-type=module', '--eval', worker, JSON.stringify(buildOptions)],
    { cwd: frontend, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), 'build');
  let buildOutput = '';
  for (const stream of [buildChild.stdout, buildChild.stderr]) stream.on('data', bytes => { buildOutput = (buildOutput + bytes.toString()).slice(-8000); });
  const buildFinished = new Promise((resolve, reject) => {
    buildChild.once('error', reject);
    buildChild.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Build worker stopped: code=${code}, signal=${signal}; ${buildOutput}`)));
  });
  const cancelled = new Promise((resolve, reject) => {
    if (buildAbort.signal.aborted) reject(buildAbort.signal.reason);
    else buildAbort.signal.addEventListener('abort', () => reject(buildAbort.signal.reason), { once: true });
  });
  const buildBudget = setTimeout(() => stop('120-second build budget exhausted'), 120_000);
  try {
    await Promise.race([buildFinished, cancelled]);
  } finally { clearTimeout(buildBudget); await terminateBuild(); }
  assert(!failure, failure?.message);
  assert(childClosed(buildChild) && !children.get(buildChild).hold, 'Owned build child and pipes closed without cleanup HOLD');
  report.build = 'passed';
  const files = new Map();
  function collect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path));
    }
  }
  collect(join(scratch, 'dist'));
  assert(files.has('/index.html'), 'Built unchanged source-host entry');
  assert(!failure && Date.now() < due, failure?.message ?? 'Run cancelled before listener');
  server = createServer((req, res) => {
    if (req.socket.remoteAddress !== '127.0.0.1' || req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const bytes = files.get(path === '/lantern-tests/source-host-visual/' ? '/index.html' : path);
    if (!bytes) { res.writeHead(path === '/favicon.ico' ? 204 : 404); res.end(); return; }
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
      : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.wasm') ? 'application/wasm' : 'text/html';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
  await Promise.race([cancelled, new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); })]);
  assert(!failure && Date.now() < due, failure?.message ?? 'Run cancelled during listener setup');
  const origin = `http://127.0.0.1:${server.address().port}`;
  phase = 'browser setup';
  const flags = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'];
  report.browser.flags = flags.map(flag => flag.startsWith('--user-data-dir=') ? '--user-data-dir=<owned scratch>' : flag);
  assert(!failure && Date.now() < due, failure?.message ?? 'Run cancelled before browser spawn');
  browser = trackChild(spawn(browserPath, flags, { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }), 'browser');
  browser.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
  cdp = new CDP(browser);
  report.browser.protocol = await cdp.send('Browser.getVersion');
  ({ browserContextId: contextId } = await cdp.send('Target.createBrowserContext'));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params = {}) => {
    assert(!failure && Date.now() < due, failure?.message ?? 'Browser budget exhausted');
    return cdp.send(method, params, sessionId);
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const snapshot = () => evaluate(`(${geometry.toString()})()`);
  const until = async (read, label) => {
    const deadline = Math.min(due, Date.now() + 10_000);
    while (Date.now() < deadline) { if (await read()) return; await wait(40); }
    throw new Error(`Timed out: ${label}`);
  };
  const key = async (name, shift = false) => {
    const number = { Tab: 9, Enter: 13, ' ': 32, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[name];
    assert(number, `Unsupported key: ${name}`);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
      type, key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: number, modifiers: shift ? 8 : 0,
      ...(type === 'keyDown' && ['Enter', ' '].includes(name) ? { text: name === 'Enter' ? '\r' : ' ' } : {}),
    });
    await wait(20);
  };
  // Native Tab traversal only: no .focus(), .click(), scrollIntoView(), synthetic DOM events or state injection.
  const reach = async (selector, record, shift = false) => {
    for (let at = 0; at < 180; at++) {
      if (await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`)) {
        const deadline = Date.now() + 600;
        let current;
        do {
          await wait(40); current = await snapshot();
        } while (!current.active.geometry.controlVisible && Date.now() < deadline);
        record.keyboard.push({ selector, tabs: at, reverse: shift, focus: current.active });
        assert(current.active.geometry.controlVisible, `Focused target must be fully exposed, at least 24px square and hit-testable: ${selector}`);
        return;
      }
      await key('Tab', shift);
    }
    throw new Error(`Native Tab cannot reach ${selector}`);
  };
  const activate = async (selector, record, name = 'Enter') => { await reach(selector, record); await key(name); };
  const sheet = async (open, record) => {
    const state = await evaluate(`(()=>{const t=document.querySelector('.ua-sheet-toggle');
      return t&&t.getClientRects().length&&getComputedStyle(t).visibility==='visible'?t.getAttribute('aria-expanded'):null;})()`);
    if (state !== null && state !== String(open)) await activate('.ua-sheet-toggle', record);
  };
  const scroll = async (selector, axis, record) => {
    const before = await evaluate(`(${geometry.toString()})()[${JSON.stringify(selector === '.ua-bottom' ? 'bottom' : 'legend')}]`);
    const range = before ? before.content[axis === 'x' ? 'width' : 'height'] - before.client[axis === 'x' ? 'width' : 'height'] : null;
    if (range !== null && range <= 1) {
      record.scrolling.push({ selector, axis, range, status: 'no overflow on this axis' }); return;
    }
    assert(before?.effective.width > 0 && before.effective.height > 0, `Scroll surface visible: ${selector}`);
    const point = { x: before.effective.x + before.effective.width / 2, y: before.effective.y + before.effective.height / 2 };
    assert(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),h=document.elementFromPoint(${point.x},${point.y});return !!h&&(h===e||e.contains(h));})()`), 'Wheel lands inside intended surface');
    const read = () => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {position:e.${axis === 'x' ? 'scrollLeft' : 'scrollTop'},range:e.${axis === 'x' ? 'scrollWidth-e.clientWidth' : 'scrollHeight-e.clientHeight'}};})()`);
    const wheel = async delta => {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: axis === 'x' ? delta : 0, deltaY: axis === 'y' ? delta : 0 });
      await wait(150); return read();
    };
    const start = await wheel(-10000), end = await wheel(10000), returned = await wheel(-10000);
    const result = { selector, axis, initial: before.scroll, start, end, returned,
      status: start.range <= 1 ? 'no overflow on this axis' : end.position > start.position + 1 && returned.position < end.position - 1 ? 'reachable both directions' : 'failed' };
    record.scrolling.push(result);
    assert.notEqual(result.status, 'failed', `User wheel scroll failed: ${selector} ${axis}`);
  };
  const readLegend = async record => {
    let current = await snapshot();
    const legend = current.legend;
    assert(legend?.effective.width > 6 && legend.effective.height > 6 && legend.centerHitWithin, 'Legend wheel surface must be exposed and hit-testable');
    const point = { x: legend.effective.x + legend.effective.width / 2, y: legend.effective.y + legend.effective.height / 2 };
    const wheel = async delta => {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: delta });
      await wait(100); return snapshot();
    };
    current = await wheel(-10000);
    const evidence = current.rows.map(row => ({ label: row.label, readingWindow: false, textLines: row.textBlocks.map(block => block.lines.map(() => false)) }));
    const windows = [];
    record.textWindows = windows;
    record.readability.layers = evidence;
    const collectWindow = value => {
      assert.deepEqual(value.rows.map(row => row.label), evidence.map(row => row.label), 'Legend identity remains stable while reading');
      for (const [at, row] of value.rows.entries()) {
        const found = evidence[at]; found.readingWindow ||= row.readingWindow;
        assert.deepEqual(row.textBlocks.map(block => block.lines.length), found.textLines.map(lines => lines.length), 'Legend text layout remains stable while reading');
        row.textBlocks.forEach((block, blockAt) => block.lines.forEach((line, lineAt) => { found.textLines[blockAt][lineAt] ||= line.fullyVisible; }));
      }
      windows.push({ top: value.legend.scroll.top, effective: value.legend.effective,
        rows: value.rows.map(row => ({ label: row.label, body: row.body, readingWindow: row.readingWindow,
          visibleLines: row.textBlocks.map(block => block.lines.map(line => line.fullyVisible)) })) });
    };
    const step = Math.max(16, Math.min(60, legend.effective.height / 3));
    for (let at = 0; at < 64; at++) {
      collectWindow(current);
      if (current.legend.scroll.top + current.legend.client.height >= current.legend.content.height - 1) break;
      const next = await wheel(step);
      assert(next.legend.scroll.top > current.legend.scroll.top + 0.5, 'Native legend wheel advances toward the remaining text');
      current = next;
    }
    record.textWindows = windows;
    record.readability = { ...record.readability, layers: evidence.map(row => ({ ...row,
      allTextLinesReachable: row.textLines.length > 0 && row.textLines.every(lines => lines.length > 0 && lines.every(Boolean)) })) };
    record.readability.passes = record.readability.viewportPasses
      && record.readability.layers.every(row => row.readingWindow && row.allTextLinesReachable);
    record.readability.status = 'assessed';
    record.measurements.push({ state: 'text reading sweep end', ...current });
    await wheel(-10000);
  };
  // MeshLayer selects WebGL2 for admitted materials and WebGL1 otherwise. Query existing
  // context wrappers by both prototypes: no getContext() call can create a context or choose the wrong type.
  const renderer = async () => {
    const contexts = [], group = 'compact-legend-renderer-probe';
    try {
      for (const type of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        const prototype = await send('Runtime.evaluate', {
          expression: `globalThis.${type}?.prototype ?? null`, objectGroup: group,
        });
        assert(!prototype.exceptionDetails, 'Renderer prototype inspection');
        if (!prototype.result.objectId) continue;
        const objects = await send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId, objectGroup: group });
        const values = await send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, returnByValue: true,
          functionDeclaration: `function(){return this.filter(g=>g.canvas===document.querySelector('.ua-viewport canvas')).map(g=>({
            type:typeof globalThis.WebGL2RenderingContext==='function'&&g instanceof globalThis.WebGL2RenderingContext?'webgl2':'webgl',lost:g.isContextLost(),
            width:g.drawingBufferWidth,height:g.drawingBufferHeight,version:g.getParameter(g.VERSION),
            programBound:!!g.getParameter(g.CURRENT_PROGRAM)}));}` });
        assert(!values.exceptionDetails, 'Existing renderer context inspection');
        contexts.push(...values.result.value);
      }
    } finally { await send('Runtime.releaseObjectGroup', { objectGroup: group }); }
    return { contexts, ready: contexts.some(g => !g.lost && g.width > 1 && g.height > 1 && g.programBound),
      diagnostic: await evaluate(`document.querySelector('.cifc-stage-note')?.textContent??null`),
      limitation: 'Existing context, drawing buffer and bound program only; no pixel, draw-count, hardware-GPU or device acceptance.' };
  };
  for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable']) await send(method);
  await send('Page.setLifecycleEventsEnabled', { enabled: true });
  phase = 'matrix';
  for (const viewport of [{ width: 568, height: 320 }, { width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    for (const mode of ['Plan', '3D']) {
      const current = { viewport, mode, status: 'running', keyboard: [], scrolling: [], measurements: [] };
      report.cases.push(current);
      try {
        await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
        const previousTimeOrigin = await evaluate('performance.timeOrigin');
        const navigation = await send('Page.navigate', { url: origin + fixturePath });
        assert(!navigation.errorText && navigation.loaderId && navigation.frameId, 'New-document navigation returned a loader');
        await until(async () => cdp.lifecycle.some(event => event.sessionId === sessionId && event.frameId === navigation.frameId
          && event.loaderId === navigation.loaderId && event.name === 'DOMContentLoaded'), 'new loader DOMContentLoaded');
        const { frameTree } = await send('Page.getFrameTree');
        assert.equal(frameTree.frame.loaderId, navigation.loaderId, 'Main frame belongs to this navigation');
        const documentState = await evaluate('({href:location.href,timeOrigin:performance.timeOrigin,readyState:document.readyState})');
        assert.equal(documentState.href, origin + fixturePath);
        assert(documentState.timeOrigin > previousTimeOrigin && documentState.readyState !== 'loading', 'Outgoing document cannot satisfy readiness');
        current.navigation = { ...navigation, previousTimeOrigin, ...documentState };
        await until(() => evaluate(`!!document.querySelector('.ua-ladder button')`), 'generated Atlas mounted');
        await evaluate('document.fonts.ready.then(() => true)');
        assert.equal(await evaluate('document.fonts.status'), 'loaded');
        assert.equal(await evaluate('document.querySelectorAll(".ua-shell").length'), 1);
        current.measurements.push({ state: 'mounted', ...await snapshot() });
        await activate(`[aria-label="Atlas view"] button:nth-child(${mode === 'Plan' ? 2 : 1})`, current);
        await until(() => evaluate(`document.querySelector('.ua-shell').classList.contains('is-plan')===${mode === 'Plan'}`), `${mode} selected`);
        await sheet(true, current);
        const hall = '.ua-rooms section[aria-label^="Ground floor"] > ul > li:first-child > button';
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(hall)})?.querySelector('span')?.textContent`), 'Hall');
        await activate(hall, current);
        assert.equal((await snapshot()).selection.room, 'Hall');
        await sheet(false, current);
        // Measurements, electrical and network remain independent switches.
        for (let index = 1; index <= 3; index++) {
          await activate(`.layer-bar button:nth-child(${index})`, current, index === 2 ? ' ' : 'Enter');
          assert.equal(await evaluate(`document.querySelector('.layer-bar button:nth-child(${index})').getAttribute('aria-pressed')`), 'true');
          assert.equal((await snapshot()).selection.room, 'Hall', 'Layer changes retain selected room');
        }
        const folded = await evaluate(`(()=>{const b=document.querySelector('.ua-fold-layers');return !!b&&b.getClientRects().length>0;})()`);
        if (folded) await activate('.ua-fold-layers', current);
        // All three closed headings must be reached through native Tab; expand each with Enter/Space.
        for (let index = 1; index <= 3; index++) await activate(`.ua-keys > .ua-key:nth-child(${index}) .ua-key-head`, current, index === 2 ? ' ' : 'Enter');
        await wait(350); // Let the existing 220ms drawer and stage transitions settle.
        const expanded = await snapshot();
        assert.equal(expanded.rows.length, 3);
        assert(expanded.rows.every(row => row.expanded === 'true'), 'Every legend is expanded');
        current.measurements.push({ state: 'expanded', ...expanded });
        current.readability = { ...expanded.reading, passes: false, status: 'text sweep pending' };
        // Deliberately exercise the short landscape strip's horizontal overflow as well as vertical legend content.
        await scroll('.ua-keys', 'y', current);
        current.measurements.push({ state: 'after vertical scroll', ...await snapshot() });
        await scroll('.ua-bottom', 'x', current);
        // Default Tab scrolling must bring an offscreen key back, including reverse traversal.
        await reach('.ua-keys > .ua-key:first-child .ua-key-head', current, true);
        current.measurements.push({ state: 'after horizontal scroll and reverse Tab', ...await snapshot() });
        await readLegend(current);
        // A minimum viewport test is independent of successful wheel/Tab movement.
        current.reachability = 'passed keyboard activation and both scroll axes (no-overflow axes recorded)';
        await activate(`[aria-label="Atlas view"] button:nth-child(${mode === 'Plan' ? 1 : 2})`, current);
        assert.equal((await snapshot()).selection.room, 'Hall', 'View change retains room');
        await activate(`[aria-label="Atlas view"] button:nth-child(${mode === 'Plan' ? 2 : 1})`, current);
        assert.equal((await snapshot()).selection.room, 'Hall', 'Return to requested view retains room');
        await activate('.layer-bar button:nth-child(2)', current, ' ');
        assert.deepEqual((await snapshot()).layers.map(row => row.pressed), ['true', 'false', 'true']);
        assert.equal((await snapshot()).selection.room, 'Hall', 'Disabling a layer retains room');
        await activate('.layer-bar button:nth-child(2)', current);
        assert.deepEqual((await snapshot()).layers.map(row => row.pressed), ['true', 'true', 'true']);
        // Floor navigation intentionally clears an out-of-floor room; do not assert invented retention across floors.
        await activate('.ua-ladder button[aria-label^="Upper floor:"]', current);
        assert.equal(await evaluate(`document.querySelector('.ua-ladder button[aria-label^="Upper floor:"]').getAttribute('aria-pressed')`), 'true');
        assert.equal((await snapshot()).selection.room, null, 'Different floor clears Hall per current floor semantics');
        await activate('.ua-ladder button[aria-label^="Ground floor:"]', current);
        await sheet(true, current);
        await activate(hall, current);
        await sheet(false, current);
        assert.equal((await snapshot()).selection.room, 'Hall', 'Ground-floor room can be selected again');
        current.measurements.push({ state: 'after floor round trip and room reselection', ...await snapshot() });
        current.selection = 'Hall retained across layers and views; floor navigation and reselection verified';
        current.webgl = await renderer();
        if (mode === '3D' && !current.webgl.diagnostic) await until(async () => {
          current.webgl = await renderer(); return current.webgl.ready || !!current.webgl.diagnostic;
        }, 'existing WebGL1/WebGL2 renderer ready');
        current.status = current.readability.passes ? 'passed-minimum-reading-window' : 'failed-readability';
      } catch (error) {
        current.status = 'failed-interaction'; current.error = { name: error.name, message: error.message };
        current.reachability = 'failed or incomplete; see error and recorded keyboard/scroll steps';
        current.measurements.push({ state: 'failure', ...await snapshot().catch(() => ({})) });
      }
      if (failure) break;
    }
    if (failure) break;
  }
  report.errors = cdp.errors;
  report.requests = cdp.requests.map(request => ({ ...request,
    url: request.url.startsWith(origin + '/') ? request.url.slice(origin.length) : request.url.split(':')[0] + ':' }));
  assert(cdp.requests.length > 0 && cdp.requests.every(request => request.method === 'GET'
    && (request.url.startsWith(origin + '/') || request.url.startsWith('data:') || request.url.startsWith('blob:'))), 'Observed page-session requests match generated GET URLs; post-request audit only, not egress prevention');
  assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
  assert.equal(report.cases.length, 6, 'Complete viewport/view matrix');
  assert(report.cases.every(row => row.status === 'passed-minimum-reading-window'), 'Matrix has interaction/readability failures; inspect each case, not just scroll reachability');
  // A DOM/readability result must not silently certify an unavailable 3D renderer.
  assert(report.cases.filter(row => row.mode === '3D').every(row => row.webgl?.ready && !row.webgl.diagnostic), '3D renderer unavailable; DOM results remain recorded but do not qualify 3D');
  report.status = 'passed-generated-browser-minimum';
} catch (error) {
  failure ??= error;
  report.status = phase === 'browser setup' ? 'blocked-browser' : 'failed';
  report.phase = phase;
  report.error = { name: failure.name, message: failure.message };
  report.stderr = stderr;
} finally {
  clearTimeout(budget);
  const buildStopped = await terminateBuild().catch(error => { failure ??= error; return false; });
  if (contextId && cdp && !cdp.closed) await cdp.send('Target.disposeBrowserContext', { browserContextId: contextId }).catch(() => {});
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await cdp?.send('Browser.close').catch(() => {});
  }
  const browserStopped = await terminateBrowser().catch(error => { failure ??= error; return false; });
  let listenerClosed = !server;
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      server.close(error => { listenerClosed = !error || error.code === 'ERR_SERVER_NOT_RUNNING'; clearTimeout(timer); resolve(); });
    });
  }
  report.cleanup = { buildStopped: buildStopped && childClosed(buildChild), browserStopped: browserStopped && childClosed(browser), listenerStopped: listenerClosed && !server?.listening };
  report.childClosure = { build: closureEvidence(buildChild), browser: closureEvidence(browser) };
  if (!report.cleanupHolds.length && report.cleanup.buildStopped && report.cleanup.browserStopped && report.cleanup.listenerStopped) rmSync(scratch, { recursive: true, force: true });
  report.cleanup.scratchRemoved = !existsSync(scratch);
  if (!Object.values(report.cleanup).every(Boolean)) {
    failure ??= new Error('Owned cleanup incomplete; preserve scratch for review');
    report.status = report.cleanupHolds.length ? 'hold-cleanup' : 'failed-cleanup'; report.retainedScratch = scratch;
  }
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  if (report.retainedScratch) {
    // Freeze the observed closure evidence above before releasing any controller handles.
    // Releasing handles is not child/descendant cleanup and permits no more group signals.
    const exitController = () => process.exit(2);
    setTimeout(exitController, 2000);
    report.controllerShutdown = { observedCleanupFrozen: true, forcedExitDeadlineMs: 2000,
      handleRelease: 'Only runner-owned handles; not observed child or pipe cleanup',
      evidenceFile: join(scratch, 'hold-report.json') };
    try {
      await writeFile(report.controllerShutdown.evidenceFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', flush: true });
      report.controllerShutdown.evidenceWritten = true;
    } catch (error) { report.controllerShutdown.evidenceWritten = false; report.controllerShutdown.evidenceError = error.message; }
    if (cdp) {
      cdp.closed = true;
      for (const pending of cdp.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Controller cleanup HOLD')); }
      cdp.pending.clear();
    }
    for (const child of [buildChild, browser]) {
      if (!child) continue;
      child.unref();
      for (const stream of child.stdio) stream?.destroy();
    }
    server?.unref();
    // A completed or failed stdout write exits; the deadline handles a blocked consumer.
    process.stdout.write(JSON.stringify(report, null, 2) + '\n', exitController);
  } else console.log(JSON.stringify(report, null, 2));
}
process.exitCode = failure ? (phase === 'browser setup' ? 2 : 1) : 0;
