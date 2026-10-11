/** Focused synthetic browser acceptance for issue #148.
 * Uses the production scene association UI, injected client methods and an
 * owned Chromium process. A temporary static loopback server serves the built
 * test UI; no application service, account, household data or provider. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const frontend = join(root, 'frontend');
assert.equal(process.version, 'v26.10.0', 'Use the retained pinned Node runtime');
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Supply an inspected HOUSEATLAS_CHROMIUM executable');
const generated = mkdtempSync(join(frontend, 'node_modules/.issue-148-ui-'));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-issue-148-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

class CDP {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.buffer = ''; this.errors = []; this.requests = [];
    child.stdio[4].on('data', bytes => {
      this.buffer += bytes.toString(); let end;
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
  reject(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}

let browser, server, cdp, session, failure;
const report = { case: 'native-scene-readonly-and-unknown-readback', status: 'running', node: process.version,
  runtimeErrors: [], requests: [], assertions: [] };
try {
  const appPath = join(generated, 'app.tsx');
  writeFileSync(appPath, `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSceneCandidate } from ${JSON.stringify(join(frontend, 'src/lantern/scans/native-ui/NativeSceneCandidate.tsx'))};

const buildingId = '00000000-0000-4000-8000-000000000003';
const listeners = new Set();
const ledger = { canCreate: false, unknown: false, reads: 0, prepares: 0, submits: 0, submitAborts: 0,
  submitSettled: false, resolves: 0, sceneRefreshes: 0, resolved: false };
let binding = Object.freeze({ synthetic: true });
const client = {
  getBinding: () => binding,
  canCreate: () => ledger.canCreate && !ledger.unknown,
  subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
  pending() { return ledger.unknown ? [{ prepared: { targetId: 'synthetic-target' }, outcome: 'unknown' }] : []; },
  isPreparedCurrent: () => ledger.canCreate && !ledger.unknown,
  async readCurrent() { ledger.reads++; return ledger.resolved
    ? { status: 'available', recordId: 'synthetic-target' } : { status: 'unavailable', reason: 'no-current-association' }; },
  async prepare() { ledger.prepares++; return { buildingId, requestId: 'synthetic-request', targetId: 'synthetic-target',
    body: '{}', requestDigest: 'a'.repeat(64), payload: {} }; },
  releasePrepared() {},
  async submit(_prepared, _geometry, signal) { ledger.submits++; ledger.unknown = true;
    await new Promise((resolve, reject) => {
      const abort = () => { ledger.submitAborts++; reject(new Error('Synthetic submission was aborted')); };
      signal.addEventListener('abort', abort, { once: true });
      ledger.finishSubmit = () => { signal.removeEventListener('abort', abort); ledger.submitSettled = true;
        reject(new Error('Synthetic transport failure')); };
      for (const fn of listeners) fn();
    });
    return { status: 'unavailable', reason: 'current-source-unavailable' }; },
  async resolve() { ledger.resolves++; ledger.unknown = false; ledger.resolved = true;
    return { status: 'available', recordId: 'synthetic-target' }; },
  dispose() {},
};
const host = { associations: client };
const geometry = { viewKey: 'synthetic-view', descriptor: { buildingId,
  scope: { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002' } } };
window.__test = { ledger, grantAdmission() { ledger.canCreate = true; binding = Object.freeze({ synthetic: true }); for (const fn of listeners) fn(); },
  withdrawAdmission() { ledger.canCreate = false; binding = Object.freeze({ synthetic: true }); for (const fn of listeners) fn(); } };
function TestHost() {
  const [generation, setGeneration] = useState(0);
  return <main><NativeSceneCandidate key={generation} host={host} geometry={geometry}
    onSaved={() => { ledger.sceneRefreshes++; setGeneration(value => value + 1); }} /></main>;
}
createRoot(document.getElementById('root')).render(<TestHost />);
`);
  const html = join(generated, 'index.html');
  writeFileSync(html, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Issue 148 synthetic readback</title><div id="root"></div><script type="module" src="./app.tsx"></script></html>');
  const dist = join(scratch, 'dist');
  await build({ configFile: false, root: generated, logLevel: 'error', build: { target: 'esnext', outDir: dist, emptyOutDir: true, minify: false, rollupOptions: { input: html } } });
  const files = new Map();
  function collect(dir, prefix = '') { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), url = prefix + '/' + entry.name;
    if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path));
  } }
  collect(dist);
  server = createServer((request, response) => {
    assert.equal(request.method, 'GET'); const path = request.url === '/' ? '/index.html' : request.url;
    const bytes = files.get(path); if (!bytes) { response.writeHead(path === '/favicon.ico' ? 204 : 404); response.end(); return; }
    const mime = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Content-Length': bytes.length }); response.end(bytes);
  });
  await new Promise((resolve, reject) => {
    const fail = error => reject(error);
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.off('error', fail); resolve(); });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-features=MediaRouter,OptimizationHints', `--user-data-dir=${join(scratch, 'browser')}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  cdp = new CDP(browser);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  const send = (method, params) => cdp.send(method, params, session);
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, result.exceptionDetails?.text ?? 'Browser evaluation'); return result.result.value;
  };
  const until = async (read, label) => { const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) { if (await read()) return; await pause(40); } throw new Error(`Timed out: ${label}`); };
  await send('Page.navigate', { url: origin + '/' });
  await until(() => evaluate('Boolean(window.__test && document.querySelector("summary"))'), 'Production candidate mounted');
  await until(() => evaluate('window.__test.ledger.reads === 1'), 'Current association read on read-only mount');
  await evaluate('document.querySelector("summary").click()');
  assert.equal(await evaluate('document.querySelector("summary").textContent.trim()'), 'Scene association');
  assert.equal(await evaluate('document.body.innerText.includes("Preparation is unavailable.")'), true);
  assert.equal(await evaluate('document.body.innerText.includes("A submitted outcome is unknown and can be checked below.")'), false);
  assert.equal(await evaluate('document.body.innerText.includes("No current retained scene candidate is available for review.")'), false);
  assert.equal(await evaluate('document.body.innerText.includes("No reviewed association is current.")'), true);
  assert.equal(await evaluate('Boolean(Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Reload current association"))'), true);
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => /Review retained originals|Submit reviewed association/.test(b.textContent))'), false);
  assert.equal(await evaluate('document.querySelectorAll("input,textarea").length'), 0, 'No preparation inputs for readers');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Reload current association").click()');
  await until(() => evaluate('window.__test.ledger.reads >= 2'), 'Read-only reload');
  await until(() => evaluate('window.__test.ledger.sceneRefreshes === 1'), 'Reload the displayed scene after association read');
  await until(() => evaluate('window.__test.ledger.reads >= 3'), 'Refreshed scene mounts a new association reader');
  await evaluate('if (!document.querySelector("details").open) document.querySelector("summary").click()');
  assert.equal(await evaluate('window.__test.ledger.prepares === 0 && window.__test.ledger.submits === 0'), true);
  report.assertions.push('read-only mount/reload perform current GETs and reload the displayed scene; preparation and submission are absent');

  await evaluate('window.__test.grantAdmission()');
  await until(() => evaluate('document.querySelectorAll("input").length === 2 && document.querySelectorAll("textarea").length === 3'), 'Authorized source inputs');
  await evaluate(`(()=>{
    const set = (element, value) => {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = Array.from(document.querySelectorAll('input'));
    set(inputs[0], '00000000-0000-4000-8000-000000000004');
    set(inputs[1], '00000000-0000-4000-8000-000000000005');
    const areas = Array.from(document.querySelectorAll('textarea'));
    for (const area of areas.slice(0, 3)) set(area, '[]');
  })()`);
  await until(() => evaluate('document.body.innerText.includes("Primary scene evidence 00000000-0000-4000-8000-000000000004")'), 'Candidate evidence appears while admitted');
  const readsBeforeDraftReload = await evaluate('window.__test.ledger.reads');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Reload current association").click()');
  await until(() => evaluate('document.querySelector("[role=alertdialog]")?.innerText.includes("discard this unfinished review draft")'), 'Warn before reload discards candidate draft');
  assert.equal(await evaluate('window.__test.ledger.reads'), readsBeforeDraftReload, 'Reload waits for confirmation while a draft exists');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Keep editing").click()');
  assert.equal(await evaluate('document.querySelectorAll("[role=alertdialog]").length === 0 && document.querySelectorAll("input")[0].value === "00000000-0000-4000-8000-000000000004"'), true,
    'Canceling reload confirmation preserves the draft');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Reload current association").click()');
  await until(() => evaluate('document.querySelector("[role=alertdialog]") !== null'), 'Repeat explicit reload confirmation');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Discard draft and reload").click()');
  await until(() => evaluate(`window.__test.ledger.reads === ${readsBeforeDraftReload + 2} && window.__test.ledger.sceneRefreshes === 2
    && Array.from(document.querySelectorAll('input,textarea')).every(field => field.value === '')`), 'Confirmed reload refreshes scene and discards the warned draft');
  await evaluate('if (!document.querySelector("details").open) document.querySelector("summary").click()');
  await evaluate('window.__test.withdrawAdmission()');
  await until(() => evaluate('document.querySelectorAll("input,textarea").length === 0'), 'Draft inputs cleared after admission withdrawal');
  assert.equal(await evaluate('document.body.innerText.includes("Primary scene evidence 00000000-0000-4000-8000-000000000004")'), false);
  assert.equal(await evaluate('document.body.innerText.includes("Historical receipt evidence 00000000-0000-4000-8000-000000000005")'), false);
  assert.equal(await evaluate('document.body.innerText.includes("Preparation is unavailable.")'), true);
  await evaluate('window.__test.grantAdmission()');
  await evaluate('if (!document.querySelector("details").open) document.querySelector("summary").click()');
  await until(() => evaluate('document.querySelectorAll("input").length === 2 && document.querySelectorAll("textarea").length === 3'), 'Fresh authorized source inputs');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("input,textarea")).every(field => field.value === "")'), true,
    'No stale draft is restored when create access returns');
  report.assertions.push('withdrawn create admission clears candidate evidence and editor draft');
  await evaluate(`(()=>{
    const set = (element, value) => {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = Array.from(document.querySelectorAll('input'));
    set(inputs[0], '00000000-0000-4000-8000-000000000004');
    set(inputs[1], '00000000-0000-4000-8000-000000000005');
    for (const area of Array.from(document.querySelectorAll('textarea'))) set(area, '[]');
  })()`);
  await until(() => evaluate('document.querySelectorAll("textarea").length === 5'), 'Candidate review statement and reason');
  await evaluate(`(()=>{
    const areas = Array.from(document.querySelectorAll('textarea'));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    for (const [index, value] of [[3, 'Synthetic review'], [4, 'Synthetic reason']]) {
      setter.call(areas[index], value); areas[index].dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await until(() => evaluate('Boolean(Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Review retained originals" && !b.disabled))'), 'Review enabled while admitted');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Review retained originals").click()');
  await until(() => evaluate('window.__test.ledger.prepares === 1'), 'Prepare synthetic reviewed request');
  await until(() => evaluate('Boolean(Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Submit reviewed association" && !b.disabled))'), 'Submit enabled for prepared request');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Submit reviewed association").click()');
  await until(() => evaluate('window.__test.ledger.submits === 1'), 'Synthetic unknown submission');
  assert.equal(await evaluate('window.__test.ledger.submitAborts === 0'), true,
    'The client pending notification does not abort the active submission');
  await until(() => evaluate('document.body.innerText.includes("A submitted association has an unknown outcome.")'), 'Unknown outcome remains visible');
  assert.equal(await evaluate('document.body.innerText.includes("A submitted outcome is unknown and can be checked below.")'), true);
  await until(() => evaluate('!document.body.innerText.includes("Primary scene evidence 00000000-0000-4000-8000-000000000004")'), 'Candidate evidence is hidden after write access is lost');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => /Review retained originals|Submit reviewed association/.test(b.textContent))'), false,
    'Preparation and submission controls are absent as soon as the pending notification withdraws admission');
  await evaluate('window.__test.ledger.finishSubmit()');
  await until(() => evaluate('window.__test.ledger.submitSettled && !document.body.innerText.includes("Saving reviewed association…")'), 'Synthetic submission settles without abort');
  await evaluate('window.__test.withdrawAdmission()');
  await until(() => evaluate('document.body.innerText.includes("A submitted association has an unknown outcome.")'), 'Unknown outcome after admission withdrawal');
  assert.equal(await evaluate('Boolean(Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Check saved outcome" && !b.disabled))'), true);
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => /Review retained originals|Submit reviewed association/.test(b.textContent))'), false);
  const readsBeforeResolution = await evaluate('window.__test.ledger.reads');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Check saved outcome").click()');
  await until(() => evaluate('window.__test.ledger.resolves === 1'), 'Resolve remains available without create permission');
  assert.equal(await evaluate('window.__test.ledger.prepares === 1 && window.__test.ledger.submits === 1'), true);
  await until(() => evaluate(`window.__test.ledger.sceneRefreshes === 3 && window.__test.ledger.reads > ${readsBeforeResolution}`),
    'Successful outcome resolution refreshes the displayed scene and reads the current head');
  await until(() => evaluate('document.querySelector("[aria-label=\\"Native scene association review\\"]")?.textContent.includes("Current association synthetic-target")'),
    'Resolved association is present on the reloaded scene');
  assert.equal(await evaluate('window.__test.ledger.canCreate === false'), true, 'Readback and scene refresh do not restore create admission');
  report.assertions.push('UNKNOWN remains visible after admission withdrawal; successful resolution refreshes scene/current head without create permission or another write');
  assert.deepEqual(cdp.errors, [], 'No browser runtime exceptions');
  assert(cdp.requests.length >= 1 && cdp.requests.every(url => url.startsWith(origin + '/')), 'Only owned loopback browser requests');
  report.requests = cdp.requests.map(url => new URL(url).pathname);
} catch (error) {
  failure = error; report.error = { name: error.name, message: error.message };
  if (cdp && session && browser?.exitCode === null) {
    try { report.failureObservation = await cdp.send('Runtime.evaluate', { returnByValue: true,
      expression: '({body:document.body.innerText, html:document.querySelector("main")?.innerHTML, ledger:window.__test?.ledger})' }, session).then(value => value.result.value); }
    catch { /* Keep the original assertion failure. */ }
  }
}
finally {
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await cdp?.send('Browser.close', {}, session).catch(() => {});
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGTERM');
    const deadline = Date.now() + 8_000; while (Date.now() < deadline && browser.exitCode === null && browser.signalCode === null) await pause(40);
    if (browser.exitCode === null && browser.signalCode === null) { browser.kill('SIGKILL'); await pause(100); }
  }
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(generated, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  report.cleanup = { browserStopped: !browser || browser.exitCode !== null || browser.signalCode !== null,
    listenerStopped: !server?.listening, generatedRemoved: !existsSync(generated), scratchRemoved: !existsSync(scratch) };
  if (!Object.values(report.cleanup).every(Boolean)) failure ??= new Error('Issue 148 browser cleanup incomplete');
}
report.status = failure ? 'failed' : 'passed';
console.log(JSON.stringify(report, null, 2));
if (failure) throw failure;
