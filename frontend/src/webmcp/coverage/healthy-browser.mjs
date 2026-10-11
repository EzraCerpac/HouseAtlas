// Actual native WebMCP with healthy synthetic service ports only. No new
// credentials, provider/storage writes, denial, replay, race or fault controls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

assert.equal(process.version, 'v26.10.0');
const source = dirname(fileURLToPath(import.meta.url));
const repository = join(source, '../../../..');
// Read-only comparison with actual root admission, not a second operation list.
const capabilities = readFileSync(join(repository, 'backend/src/http/agents/capabilities.rs'), 'utf8');
const admittedSymbols = new Set(capabilities.match(/\bAtlas[A-Z]\w+/g));
const catalog = JSON.parse(readFileSync(join(repository, 'contracts/stock-wire3/agent/operation-catalog.json')));
const admittedCommands = catalog.commands.filter(row => admittedSymbols.has(
  row.commandId.split(/[.-]/).map(part=>part[0].toUpperCase()+part.slice(1)).join(''),
)).map(row=>row.commandId).sort();
assert.equal(admittedCommands.length, 22, 'Reinspect the profile if root admission changes');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-coverage-healthy-'));
const browserPath = process.env.HOUSEATLAS_CHROMIUM ?? '/usr/bin/chromium';
let browser, server;
class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0); errors = [];
  constructor(process) {
    this.process = process;
    process.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString();
        this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails);
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
}
try {
  writeFileSync(join(scratch, 'index.html'), `<div id="root"></div><script type="module" src="${relative(scratch, join(source, 'healthy.tsx'))}"></script>`);
  await build({ configFile: false, root: scratch, plugins: [react()], logLevel: 'warn',
    build: { outDir: join(scratch, 'dist'), emptyOutDir: true } });
  const files = new Map();
  function collect(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const key = prefix + '/' + entry.name;
      if (entry.isDirectory()) collect(join(path, entry.name), key);
      else files.set(key, readFileSync(join(path, entry.name)));
    }
  }
  collect(join(scratch, 'dist'));
  server = createServer((request, response) => {
    const path = request.url === '/' ? '/index.html' : request.url;
    const bytes = files.get(path);
    if (request.method !== 'GET' || !bytes) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(bytes);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = spawn(browserPath, ['--headless=new', '--enable-experimental-web-platform-features',
    '--enable-features=WebMCP', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints',
    '--user-data-dir=' + join(scratch, 'browser'), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  // Reuse the release IDLs inspected by the existing ordinary native runner;
  // executeTool takes a DOMString of the entire JSON envelope.
  assert(['Chrome/151.0.7922.173', 'Chrome/154.0.8037.57', 'Chrome/154.0.8037.97'].includes(version.product));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Runtime.enable'); await send('Page.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const deadline = Date.now() + 15000;
  let registered = false;
  while (Date.now() < deadline) {
    registered = await evaluate('Boolean(window.healthyCoverage) && document.modelContext.getTools().then(t=>t.length===3)');
    if (registered) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(registered, 'Healthy canonical family registrations are ready');
  const evidence = await evaluate(`(async () => {
    const fixture = window.healthyCoverage;
    const tools = await document.modelContext.getTools();
    const checked = [];
    if (fixture.coverage.length !== 164 || fixture.coverage.filter(row=>row.state==='admitted-and-bound').length !== 22)
      throw new Error('Coverage must distinguish 22 fixture-bound arms from the catalog');
    const names = tools.map(tool=>tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(['atlas_bindings','atlas_media_geometry','atlas_records'])) throw new Error('Canonical families changed');
    for (const tool of tools) {
      if (JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }).includes('synthetic-port-marker-no-credential')) throw new Error('Session marker leaked to metadata');
      if (!tool.annotations) throw new Error('WebMCP annotations are absent');
      if (tool.annotations.readOnlyHint !== (tool.name !== 'atlas_records')) throw new Error('Effect hint changed');
    }
    for (const [index, request] of fixture.requests.entries()) {
      const row = fixture.coverage.find(row => row.commandId === request.commandId);
      if (row.state !== 'admitted-and-bound') throw new Error('Healthy family is not bound');
      const tool = tools.find(tool => tool.name === row.toolName);
      const schema = typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema;
      fixture.validateInput(schema, request);
      const value = await document.modelContext.executeTool(tool, JSON.stringify(request));
      const wire = typeof value === 'string' ? JSON.parse(value) : value;
      const displayed = JSON.parse(document.querySelector('.stock-completion pre').textContent);
      if (JSON.stringify(wire) !== JSON.stringify(fixture.responses[index])) throw new Error('Full result changed');
      if (JSON.stringify(displayed) !== JSON.stringify(wire)) throw new Error('Result was not committed before return');
      if (JSON.stringify(fixture.calls[index]) !== JSON.stringify(request)) throw new Error('Full request changed');
      fixture.events.push('returned:' + request.requestId);
      const order = fixture.events.filter(event => event.endsWith(request.requestId));
      if (!(order.indexOf('dispatch:' + request.requestId) < order.indexOf('visible:' + request.requestId)
        && order.indexOf('visible:' + request.requestId) < order.indexOf('returned:' + request.requestId))) throw new Error('Commit ordering changed');
      checked.push({ toolName: tool.name, commandId: request.commandId, requestId: request.requestId, status: wire.status });
    }
    fixture.unmount();
    const remaining = await document.modelContext.getTools();
    if (remaining.length) throw new Error('Unmount did not unregister tools');
    return { tools: tools.map(tool => tool.name), annotationsObservable: tools.every(tool=>Boolean(tool.annotations)), checked, cleanup: true, completeEnvelopes: true, visibleBeforeReturn: true,
      admittedAndBound: fixture.coverage.filter(row=>row.state==='admitted-and-bound').length };
  })()`);
  assert.equal(cdp.errors.length, 0, JSON.stringify(cdp.errors));
  assert.equal(evidence.annotationsObservable, true, 'Every registered WebMCP tool exposes annotations');
  assert.equal(evidence.checked.length, 22);
  assert.deepEqual(evidence.checked.map(row=>row.commandId).sort(), admittedCommands, 'Every currently host-admitted command was exercised');
  console.log(JSON.stringify({ browser: version.product, ...evidence,
    scope: 'Actual document.modelContext and React; 22 healthy synthetic service calls, three canonical Atlas families; no provider/storage writes or held controls.' }, null, 2));
  const exited = once(browser, 'exit');
  await cdp.send('Browser.close'); await exited;
} finally {
  if (browser && browser.exitCode === null) { const exited = once(browser, 'exit'); browser.kill(); await exited; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  rmSync(scratch, { recursive: true, force: true });
}
