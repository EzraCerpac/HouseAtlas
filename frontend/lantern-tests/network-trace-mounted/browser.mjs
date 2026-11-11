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
const pending = new Map(); let serial = 0, buffer = '';
try {
  const previous = process.cwd();
  try { process.chdir(frontend); await build({ root: join(frontend, 'lantern-tests/network-trace-mounted'), configFile: join(frontend, 'vite.config.ts'), logLevel: 'error', publicDir: false, build: { target: 'esnext', outDir: join(scratch, 'dist'), emptyOutDir: true } }); }
  finally { process.chdir(previous); }
  const chrome = process.env.HOUSEATLAS_CHROMIUM;
  assert(chrome && existsSync(chrome));
  assert.equal(spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 5000 }).stdout.trim(), 'Google Chrome for Testing 156.0.8078.47');
  browser = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browser.stdio[4].on('data', chunk => { buffer += chunk.toString(); let at; while ((at = buffer.indexOf('\0')) >= 0) { const msg = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); } } });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 8000); pending.set(id, { resolve, reject, timer }); browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
  const files = new Map();
  const collect = (dir, prefix = '') => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name), url = `${prefix}/${entry.name}`; if (entry.isDirectory()) collect(path, url); else files.set(url, readFileSync(path)); } }; collect(join(scratch, 'dist'));
  server = createServer((req, res) => { const path = new URL(req.url, 'http://127.0.0.1').pathname; const bytes = files.get(path === '/' ? '/index.html' : path); if (!bytes) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' }).end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { const due = Date.now() + 10000; while (Date.now() < due) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error(`Timed out: ${expression}`); };
  const click = async text => { await evaluate(`([...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}) ?? (()=>{throw Error('missing button')})()).click()`); };
  await command('Runtime.enable', {}); await command('Page.enable', {});
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`Boolean([...document.querySelectorAll('button')].find(x=>x.textContent.includes('Client')))`);
  await evaluate(`[...document.querySelectorAll('.ung-item')].find(x=>x.textContent.includes('Client')).click()`);
  await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  assert.match(await evaluate(`document.querySelector('.ung-trace').textContent`), /Client.*wifi.*accepted.*Middle.*ethernet.*accepted.*Root/s);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ua-net-tracing path')).transitionProperty`), 'none');
  await click('Toggle plan'); await until(`document.querySelectorAll('.ua-net-trace').length === 2`);
  await click('Clear graph selection'); await until(`!document.querySelector('.ua-net-tracing')`);
  await evaluate(`[...document.querySelectorAll('.ung-item')].find(x=>x.textContent.includes('Client')).click()`); await until(`!!document.querySelector('.ua-net-tracing')`);
  await click('Replace data'); await until(`!!document.querySelector('.ua-net-tracing')`);
  await click('Toggle layer'); await until(`!document.querySelector('.ua-net-tracing')`);
  await click('Toggle layer'); await until(`!!document.querySelector('.ung')`);
  await click('Close or reopen'); await until(`!document.querySelector('.ung')`);
  await click('Close or reopen'); await until(`!!document.querySelector('.ung')`);
  assert.equal(await evaluate(`!!document.querySelector('.ua-net-tracing')`), false);
  console.log('mounted generated network trace controls passed');
} finally {
  if (browser) { const exited = browser.exitCode !== null ? Promise.resolve() : new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM'); await exited; }
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
