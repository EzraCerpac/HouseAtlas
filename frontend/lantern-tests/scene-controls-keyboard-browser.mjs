// Synthetic SceneControls keyboard and pointer check. Uses an owned, fresh headless Chromium profile.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

assert.equal(process.version, 'v26.10.0', 'Use the pinned Node runtime');
assert.deepEqual(process.argv.slice(2), [], 'No extra arguments are supported');
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const frontend = join(root, 'frontend');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');
const version = spawnSyncVersion(chromium);
assert.match(version, /Google Chrome 154\.0\.8037\.98$/, 'Use the repository-reviewed Chromium build');

function spawnSyncVersion(executable) {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || 'Cannot inspect Chromium version');
  return result.stdout.trim();
}

class CDP {
  constructor(child) {
    this.child = child;
    this.next = 0;
    this.pending = new Map();
    this.buffer = '';
    this.errors = [];
    this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString();
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        if (message.id) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') {
          this.errors.push(message.params.exceptionDetails.text);
        } else if (message.method === 'Network.requestWillBeSent') {
          this.requests.push(message.params.request.url);
        }
      }
    });
    child.on('exit', () => this.reject(new Error('Owned Chromium exited')));
    child.on('error', error => this.reject(error));
  }

  reject(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, label) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await wait(40);
  }
  throw new Error(`Timed out: ${label}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-scene-controls-'));
const output = join(scratch, 'dist');
const files = new Map();
let browser, server, cdp, sessionId, origin, failure;
const result = { status: 'running', node: process.version, chromium: version, keyboard: [], pointer: null, requests: [] };
const budget = setTimeout(() => {
  failure ??= new Error('120-second browser check budget exhausted');
  browser?.kill('SIGTERM');
  server?.close();
}, 120_000);

try {
  await build({
    configFile: join(frontend, 'vite.config.ts'),
    root: frontend,
    logLevel: 'error',
    build: {
      target: 'esnext', outDir: output, emptyOutDir: true,
      rollupOptions: { input: join(frontend, 'lantern-tests/scene-controls-keyboard/index.html') },
    },
  });
  function collect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(path, url);
      else files.set(url, readFileSync(path));
    }
  }
  collect(output);
  const entry = '/lantern-tests/scene-controls-keyboard/index.html';
  assert(files.has(entry), 'Built test entry');

  server = createServer((request, response) => {
    assert.equal(request.method, 'GET', 'Fixture server accepts only GET');
    assert.equal(request.socket.remoteAddress, '127.0.0.1', 'Requests stay on owned loopback');
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const bytes = files.get(path);
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-extensions', '--disable-features=MediaRouter,OptimizationHints',
    `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  cdp = new CDP(browser);
  assert.equal((await cdp.send('Browser.getVersion')).product, 'Chrome/154.0.8037.98');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Network.enable', {});
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!value.exceptionDetails, value.exceptionDetails?.text ?? 'Browser expression failed');
    return value.result.value;
  };
  const key = async name => {
    const keys = { Tab: { code: 9 }, Enter: { code: 13, text: '\r' }, Space: { code: 32, key: ' ', text: ' ' } };
    const value = keys[name];
    assert(value, `Unexpected test key ${name}`);
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: value.key ?? name, code: name === 'Space' ? 'Space' : name,
      windowsVirtualKeyCode: value.code, nativeVirtualKeyCode: value.code,
      ...(value.text ? { text: value.text, unmodifiedText: value.text } : {}),
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: value.key ?? name, code: name === 'Space' ? 'Space' : name,
      windowsVirtualKeyCode: value.code,
    });
    await wait(50);
  };
  const state = () => evaluate(`(() => {
    const group = document.querySelector('.layer-bar');
    const buttons = Array.from(group.querySelectorAll('button'));
    return { role: group.getAttribute('role'), label: group.getAttribute('aria-label'),
      invalidRadioSemantics: group.querySelector('[role="radio"], [aria-checked]') !== null,
      buttons: buttons.map(button => ({label: button.getAttribute('aria-label'), text: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'), type: button.type, tabindex: button.getAttribute('tabindex'),
        background: button.style.background, borderColor: button.style.borderColor, color: button.style.color})),
      focus: document.activeElement?.getAttribute('aria-label')};
  })()`);
  await send('Page.navigate', { url: `${origin}${entry}` });
  await until(async () => (await evaluate(`Boolean(document.querySelector('.layer-bar button'))`)), 'fixture render');
  const initial = await state();
  assert.equal(initial.role, 'group');
  assert.equal(initial.label, 'Overlay');
  assert.equal(initial.invalidRadioSemantics, false);
  assert.deepEqual(initial.buttons.map(button => button.label), ['Rooms only', 'Electrical', 'Network']);
  assert.deepEqual(initial.buttons.map(button => button.pressed), ['true', 'false', 'false']);
  assert(initial.buttons.every(button => button.type === 'button' && button.tabindex === null));
  assert(initial.buttons[0].background.includes('color-mix') && initial.buttons[0].borderColor.includes('color-mix')
    && initial.buttons[0].color === 'var(--ink)', 'Selected overlay retains its selected appearance');

  // Four enabled native buttons precede the overlays (Zoom out is disabled at the initial zoom).
  for (let index = 0; index < 5; index++) await key('Tab');
  assert.equal((await state()).focus, 'Rooms only', 'Tab reaches the first overlay button');
  await key('Space');
  let current = await state();
  assert.deepEqual(current.buttons.map(button => button.pressed), ['true', 'false', 'false']);
  assert.equal(current.focus, 'Rooms only', 'Space leaves focus on the activated button');
  result.keyboard.push('Tab + Space: focus retained and state accurate');

  await key('Tab');
  assert.equal((await state()).focus, 'Electrical');
  await key('Enter');
  current = await state();
  assert.deepEqual(current.buttons.map(button => button.pressed), ['false', 'true', 'false']);
  assert.equal(current.focus, 'Electrical', 'Enter leaves focus on the activated button');
  result.keyboard.push('Tab + Enter: focus retained and state moves');

  await key('Tab');
  assert.equal((await state()).focus, 'Network');
  await key('Space');
  current = await state();
  assert.deepEqual(current.buttons.map(button => button.pressed), ['false', 'false', 'true']);
  assert.equal(current.focus, 'Network', 'Space leaves focus on the activated button');
  result.keyboard.push('Tab + Space: third overlay is selectable');

  const point = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.layer-bar button')).find(item => item.textContent.trim() === 'Rooms');
    button.scrollIntoView({ block: 'center' }); const rect = button.getBoundingClientRect();
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height};
  })()`);
  assert(point.width > 0 && point.height > 0, 'Pointer target is visible');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
  await until(async () => (await state()).buttons[0].pressed === 'true', 'pointer changes selected overlay');
  current = await state();
  assert.deepEqual(current.buttons.map(button => button.pressed), ['true', 'false', 'false']);
  result.pointer = 'CDP mouse click changed the selected overlay';
  await wait(100);
  assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
  assert(cdp.requests.length > 0 && cdp.requests.every(url => url.startsWith(`${origin}/`)),
    'All browser application requests stay on the owned loopback origin');
  result.requests = cdp.requests.map(url => new URL(url).pathname);
  result.status = 'passed';
} catch (error) {
  failure = error;
  result.status = 'failed';
  result.error = { name: error.name, message: error.message };
} finally {
  clearTimeout(budget);
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await cdp?.send('Browser.close').catch(() => {});
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => browser.once('exit', resolve)),
      wait(5000).then(() => { if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL'); }),
    ]);
  }
  if (server) await new Promise(resolve => server.close(resolve));
  const browserStopped = !browser || browser.exitCode !== null || browser.signalCode !== null;
  const listenerStopped = !server?.listening;
  if (browserStopped && listenerStopped) rmSync(scratch, { recursive: true, force: true });
  result.cleanup = { browserStopped, listenerStopped, scratchRemoved: !existsSync(scratch) };
  if (!Object.values(result.cleanup).every(Boolean)) failure ??= new Error('Owned browser cleanup incomplete');
  console.log(JSON.stringify(result, null, 2));
}

if (failure) throw failure;
