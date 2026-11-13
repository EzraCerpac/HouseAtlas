// Mounted generated components, using the pinned hosted Chrome without sandbox overrides.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

assert.equal(process.version, 'v26.10.0');
const frontend = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'network-trace-mounted-'));
let browser, server;
const pending = new Map(), requests = []; let serial = 0, buffer = '';
try {
  const previous = process.cwd();
  try { process.chdir(frontend); await build({ root: join(frontend, 'lantern-tests/network-trace-mounted'), configFile: join(frontend, 'vite.config.ts'), logLevel: 'error', publicDir: false, build: { target: 'esnext', outDir: join(scratch, 'dist'), emptyOutDir: true,
    rolldownOptions: { input: [join(frontend, 'lantern-tests/network-trace-mounted/index.html'), join(frontend, 'lantern-tests/network-trace-mounted/host.html')] } } }); }
  finally { process.chdir(previous); }
  const chrome = process.env.HOUSEATLAS_CHROMIUM;
  assert(chrome && existsSync(chrome));
  assert.equal(spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 5000 }).stdout.trim(), 'Google Chrome for Testing 156.0.8078.47');
  browser = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browser.stdio[4].on('data', chunk => { buffer += chunk.toString(); let at; while ((at = buffer.indexOf('\0')) >= 0) { const msg = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url); const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); } } });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 8000); pending.set(id, { resolve, reject, timer }); browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
  const files = new Map();
  const collect = (dir, prefix = '') => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name), url = `${prefix}/${entry.name}`; if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path)); } }; collect(join(scratch, 'dist'));
  server = createServer((req, res) => { const path = new URL(req.url, 'http://127.0.0.1').pathname; const bytes = files.get(path === '/' ? '/index.html' : path); if (!bytes) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' }).end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { const due = Date.now() + 10000; while (Date.now() < due) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error(`Timed out: ${expression}`); };
  const press = async expression => {
    const point = await evaluate(`(() => { const el = (${expression}); if (!el) throw Error('missing target'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2, y=r.y+r.height/2; if (!r.width || !r.height || !el.contains(document.elementFromPoint(x,y))) throw Error('target not actionable'); return {x,y}; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await command('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
  };
  const click = text => press(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)})`);
  const devices = `[...document.querySelectorAll('details.ung-list')].find(x=>x.querySelector(':scope > summary')?.textContent.startsWith('Devices ('))`;
  const client = `[...(${devices}).querySelectorAll('.ung-item')].find(x=>x.querySelector('.ung-item-name')?.textContent === 'Client')`;
  const selectClient = async () => {
    if (!await evaluate(`!!(${devices})?.open`)) await press(`(${devices})?.querySelector(':scope > summary')`);
    await press(client);
  };
  await command('Runtime.enable', {}); await command('Page.enable', {}); await command('Network.enable', {});
  await command('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`Boolean([...document.querySelectorAll('button')].find(x=>x.textContent.includes('Client')))`);
  await press(`(${devices})?.querySelector(':scope > summary')`);
  // Fixture-only witness: inspect the first animation callback following native
  // input and count browser requests during that interval, not elapsed latency.
  const beforeTap = requests.length;
  await evaluate(`window.__traceFrame = new Promise(resolve => { (${client}).addEventListener('click', () => requestAnimationFrame(() => resolve(document.querySelectorAll('.ua-net-trace').length)), {once:true}); }); true`);
  await press(client);
  const firstFrame = await evaluate(`window.__traceFrame`);
  assert.equal(firstFrame, 2, 'the fixture stage is traced at the first animation callback');
  assert.equal(requests.length, beforeTap, 'the fixture tap made no observed browser request before that callback');
  await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  assert.match(await evaluate(`document.querySelector('.ung-trace').textContent`), /Client.*wifi.*accepted.*Middle.*ethernet.*accepted.*Root/s);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ua-net-tracing path')).transitionProperty`), 'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ua-net-trace')).animationName`), 'none');
  assert.equal(await evaluate(`document.querySelector('.ua-net-trace').getAnimations().some(a => a.animationName === 'ua-net-trace-draw')`), false);
  assert.equal(await evaluate(`document.querySelector('.ua-net-tracing path:not(.ua-net-trace)').getAttribute('opacity')`), '0.14');
  await press(`[...document.querySelectorAll('.ung-trace button')].find(x=>x.textContent.trim()==='Middle')`);
  await until(`document.querySelector('.ung-trace-here')?.textContent === 'Middle'`);
  await selectClient(); await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ua-net-trace')).animationName`), 'ua-net-trace-draw');
  assert.equal(await evaluate(`document.querySelector('.ua-net-trace').getAnimations().some(a => a.animationName === 'ua-net-trace-draw')`), true);
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('Toggle plan'); await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  await click('Toggle root floor'); await until(`document.querySelectorAll('.ua-net-trace').length === 1`);
  await click('Toggle root floor'); await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  await click('Clear graph selection'); await until(`!document.querySelector('.ua-net-tracing')`);
  await selectClient(); await until(`!!document.querySelector('.ua-net-tracing')`);
  // Capture the actual A graph withdrawal, then deliver it after same-key B has published.
  await click('Delay withdrawal'); await click('Replace data');
  await until(`document.querySelector('output').dataset.queued === '1' && document.querySelector('output').dataset.traceOwner === 'b' && document.querySelectorAll('.ua-net-trace').length === 2`);
  await click('Deliver withdrawal');
  await until(`document.querySelector('output').dataset.queued === '0'`);
  assert.equal(await evaluate(`document.querySelector('output').dataset.traceOwner`), 'b');
  assert.equal(await evaluate(`document.querySelectorAll('.ua-net-trace').length`), 2);
  // A different-key owner must also survive the departing B graph's delayed cleanup.
  await click('Delay withdrawal'); await click('Replace key');
  await until(`document.querySelector('output').dataset.queued === '1' && !!document.querySelector('.ung-item')`);
  await selectClient();
  await until(`document.querySelector('output').dataset.traceOwner === 'c' && document.querySelectorAll('.ua-net-trace').length === 2`);
  await click('Deliver withdrawal'); await until(`document.querySelector('output').dataset.queued === '0'`);
  assert.equal(await evaluate(`document.querySelector('output').dataset.traceOwner`), 'c');
  assert.equal(await evaluate(`document.querySelectorAll('.ua-net-trace').length`), 2);
  // Remove the source while holding its actual cleanup: render validation must
  // hide the retained trace before the queued withdrawal is delivered.
  await click('Delay withdrawal'); await click('Remove source');
  await until(`document.querySelector('output').dataset.queued === '1' && !document.querySelector('.ung')`);
  assert.equal(await evaluate(`document.querySelector('output').dataset.traceOwner`), 'c');
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await click('Deliver withdrawal'); await until(`document.querySelector('output').dataset.traceOwner === 'none'`);
  await click('Select A'); await until(`!!document.querySelector('.ung-item')`);
  await selectClient(); await until(`!!document.querySelector('.ua-net-tracing')`);
  // Two distinct mounts with the same key and data are deliberately outside the
  // identity guarantee: an artificially delayed old withdrawal clears the new trace.
  await click('Delay withdrawal'); await click('Remount same data');
  await until(`document.querySelector('output').dataset.queued === '1' && !!document.querySelector('.ung-item')`);
  await selectClient();
  await until(`document.querySelector('output').dataset.traceOwner === 'a' && !!document.querySelector('.ua-net-tracing')`);
  await click('Deliver withdrawal'); await until(`document.querySelector('output').dataset.traceOwner === 'none'`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  // Close while a trace is active, then reopen without a selection.
  await selectClient();
  await selectClient();
  await until(`!!document.querySelector('.ua-net-tracing')`);
  await click('Delay withdrawal'); await click('Close or reopen');
  await until(`document.querySelector('output').dataset.queued === '1' && !document.querySelector('.ung')`);
  assert.equal(await evaluate(`document.querySelector('output').dataset.traceOwner`), 'a');
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await click('Deliver withdrawal'); await until(`document.querySelector('output').dataset.traceOwner === 'none'`);
  await click('Close or reopen'); await until(`!!document.querySelector('.ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await selectClient(); await until(`!!document.querySelector('.ua-net-tracing')`);
  await click('Toggle layer'); await until(`!document.querySelector('.ua-net-tracing')`);
  await click('Toggle layer'); await until(`!!document.querySelector('.ung')`);
  await click('Close or reopen'); await until(`!document.querySelector('.ung')`);
  await click('Close or reopen'); await until(`!!document.querySelector('.ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await click('Rootless source'); await until(`!!document.querySelector('.ung-item')`); await selectClient();
  await until(`document.querySelector('.ung-trace-note')?.textContent.includes('no router')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await click('Uncertain source'); await until(`!!document.querySelector('.ung-item')`); await selectClient();
  await until(`!!document.querySelector('.ung-trace-hop.is-uncertain')`);
  assert.match(await evaluate(`document.querySelector('.ung-trace').textContent`), /wifi · tentative/);
  await click('Shared medium source'); await until(`!!document.querySelector('.ung-item')`); await selectClient();
  await until(`!!document.querySelector('.ung-trace')`);
  assert.match(await evaluate(`document.querySelector('.ung-trace').textContent`), /Client.*Shared segment.*Root/s);
  assert.equal(await evaluate(`document.querySelectorAll('.ua-net-trace').length`), 1);
  // Actual UnifiedAtlas, with generated saved-documentary room associations.
  // This is not a live source owner or the production LanternHost.
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/host.html` });
  await until(`!!document.querySelector('.ua-room-btn')`);
  await press(`[...document.querySelectorAll('.layer-chip')].find(x=>x.textContent.trim().startsWith('Network'))`);
  await until(`!!document.querySelector('.ua-graph-open')`);
  // The Network key starts collapsed; its graph button exists inside a hidden body.
  const networkHeader = `document.querySelector('.ua-key[aria-label="Network layer"] .ua-key-head')`;
  const networkBody = `document.getElementById((${networkHeader}).getAttribute('aria-controls'))`;
  const hostGraphOpen = `(${networkBody})?.querySelector('.ua-graph-open')`;
  await press(networkHeader);
  assert.equal(await evaluate(`(${networkHeader}).getAttribute('aria-expanded')`), 'true');
  await until(`(() => { const body = (${networkBody}), button = (${hostGraphOpen}); if (!body || body.hidden || !button || getComputedStyle(body).display === 'none' || getComputedStyle(body).visibility !== 'visible') return false; button.scrollIntoView({block:'center'}); const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width > 0 && r.height > 0 && button.contains(hit); })()`);
  await press(hostGraphOpen); await until(`!!document.querySelector('.ua-graph .ung')`);
  const hostClient = `[...(${devices}).querySelectorAll('.ung-item')].find(x=>x.querySelector('.ung-item-name')?.textContent === 'Host client')`;
  const chooseHostClient = async () => { if (!await evaluate(`!!(${devices})?.open`)) await press(`(${devices})?.querySelector(':scope > summary')`); await press(hostClient); };
  if (!await evaluate(`!!(${devices})?.open`)) await press(`(${devices})?.querySelector(':scope > summary')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-stage .ua-net-trace')`), false, 'no trace exists before host input');
  const hostRequestsBefore = requests.length;
  // Observe the actual Atlas stage DOM, armed before trusted input. The event's
  // timestamp and performance.now() share this document's time origin. The
  // mutation callback is a conservative observation of the DOM commit, not paint.
  await evaluate(`window.__hostTraceFrame = new Promise(resolve => {
    const stage = document.querySelector('.ua-stage'), target = (${hostClient});
    if (!stage || !target || !window.__hostTraceReads) throw Error('host witness unavailable');
    let inputAt = null, observedAt = null, initialReads = null, trusted = false;
    const observer = new MutationObserver(() => { if (inputAt !== null && observedAt === null && stage.querySelector('.ua-net-trace')) observedAt = performance.now(); });
    observer.observe(stage, { subtree: true, childList: true, attributes: true });
    target.addEventListener('click', event => {
      trusted = event.isTrusted; inputAt = event.timeStamp; initialReads = { ...window.__hostTraceReads };
      requestAnimationFrame(() => { const frame = { trusted, inputAt, observedAt, paths: stage.querySelectorAll('.ua-net-trace').length,
        before: initialReads, after: { ...window.__hostTraceReads } }; observer.disconnect(); resolve(frame); });
    }, { once: true, capture: true });
  }); true`);
  await press(hostClient);
  const hostFrame = await evaluate(`window.__hostTraceFrame`);
  assert.equal(hostFrame.trusted, true, 'host input is a trusted browser click');
  assert.equal(hostFrame.paths, 1, 'actual Atlas stage has the trace at the first animation callback');
  assert(Number.isFinite(hostFrame.inputAt) && Number.isFinite(hostFrame.observedAt), 'input and stage DOM commit observation have timestamps');
  assert(hostFrame.observedAt >= hostFrame.inputAt, `stage DOM observation precedes the input: ${JSON.stringify(hostFrame)}`);
  // Informational only: a wall-clock bound on a shared software-GPU runner is not a stable
  // pass/fail signal. The required frame guarantee is the first-callback presence check above.
  console.log(`INFO input-to-stage-DOM-observation ${(hostFrame.observedAt - hostFrame.inputAt).toFixed(1)} ms (informational, not asserted; 16.7 ms is one 60 Hz frame)`);
  assert(hostFrame.before.port > 0 && hostFrame.before.transport > 0 && hostFrame.before.documentary > 0, 'fixture read counters are exercised');
  assert.deepEqual(hostFrame.after, hostFrame.before, 'no fixture source-owner or transport read through the first callback');
  assert.equal(requests.length, hostRequestsBefore, 'no observed browser request through the host first callback');
  await until(`document.querySelectorAll('.ua-net-trace').length === 1`);
  await press(`document.querySelector('.ua-graph-close')`); await until(`!document.querySelector('.ua-graph .ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await press(hostGraphOpen); await until(`!!document.querySelector('.ua-graph .ung')`);
  await chooseHostClient(); await until(`document.querySelectorAll('.ua-net-trace').length === 1`);
  await press(`document.querySelector('.ua-graph-close')`); await until(`!document.querySelector('.ua-graph .ung')`);
  await click('Switch host mode'); await click('Toggle fixture lens');
  await until(`!!document.querySelector('#generated-lens .ung')`); await chooseHostClient();
  await until(`document.querySelectorAll('.ua-net-trace').length === 1`);
  await click('Toggle fixture lens'); await until(`!document.querySelector('#generated-lens .ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  await click('Toggle fixture lens'); await until(`!!document.querySelector('#generated-lens .ung')`); await chooseHostClient();
  await until(`document.querySelectorAll('.ua-net-trace').length === 1`);
  await press(`[...document.querySelectorAll('.layer-chip')].find(x=>x.textContent.trim().startsWith('Network'))`);
  await until(`!document.querySelector('#generated-lens .ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  console.log('mounted generated network trace controls passed');
} finally {
  if (browser) { const exited = browser.exitCode !== null ? Promise.resolve() : new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM'); await exited; }
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
