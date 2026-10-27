import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { localTransport } from './transport.mjs';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const asset = Buffer.alloc(256 * 1024, 120);
export const assetPath = '/assets/generated-12345678.js';

export async function fixture(binary, rate = 10) {
  assert.equal(process.version, 'v26.10.0', 'Use the existing pinned Node');
  binary = resolve(binary);
  assert(existsSync(binary), 'Explicit compiled Rust binary required');
  // Rust disposable mode itself requires a new absolute /tmp path.
  const scratch = mkdtempSync('/tmp/houseatlas-host-client-');
  const frontend = join(scratch, 'frontend');
  const data = join(scratch, 'data');
  let service, transport, spawnError, output = '', stopPromise;
  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      transport?.close();
      if (service && service.exitCode === null && service.signalCode === null) {
        service.kill('SIGINT');
        const until = performance.now() + 6000;
        while (service.exitCode === null && service.signalCode === null && performance.now() < until) await delay(25);
        if (service.exitCode === null && service.signalCode === null) {
          service.kill('SIGKILL');
          await new Promise(resolve => service.once('exit', resolve));
        }
      }
      process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
      rmSync(scratch, { recursive: true, force: true });
    })();
    return stopPromise;
  }
  const interrupted = () => { void stop().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    mkdirSync(join(frontend, 'assets'), { recursive: true });
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    assert(asset.length + Buffer.byteLength(html) <= 8 << 20);
    writeFileSync(join(frontend, 'index.html'), html);
    writeFileSync(join(frontend, 'assets', 'generated-12345678.js'), asset);
    const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
    const certificate = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
    assert.equal(certificate.status, 0, 'Disposable TLS creation failed');
    const { build } = await import(pathToFileURL(join(root, 'frontend/node_modules/vite/dist/node/index.js')).href);
    const built = await build({
      root: join(root, 'frontend'), configFile: false, logLevel: 'silent',
      build: { write: false, target: 'node26', minify: false,
        lib: { entry: join(root, 'frontend/src/api/client.ts'), formats: ['es'] },
        rolldownOptions: { output: { codeSplitting: false } } },
    });
    const chunks = (Array.isArray(built) ? built[0] : built).output.filter(row => row.type === 'chunk');
    assert.equal(chunks.length, 1, 'One current production adapter bundle');
    const modulePath = join(scratch, 'clients.mjs');
    writeFileSync(modulePath, chunks[0].code);
    const clients = await import(pathToFileURL(modulePath).href);
    const sourceSha256 = sha256(chunks[0].code);
    service = spawn(binary, [
      '--disposable-dir', data, '--frontend-dist', frontend, '--tls-cert', cert, '--tls-key', key,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C', RUST_BACKTRACE: '0' } });
    service.on('error', error => { spawnError = error; });
    service.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-65536); });
    // Drain without publishing output, paths or fixture credentials.
    service.stderr.on('data', () => {});
    const deadline = performance.now() + 30000;
    while (!(output.includes('listening at') && existsSync(join(data, 'smoke-session.json')))) {
      assert(!spawnError && service.exitCode === null && service.signalCode === null, 'Disposable Rust startup failed');
      assert(performance.now() < deadline, 'Disposable startup deadline');
      await delay(25);
    }
    const generated = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
    assert.match(generated.origin, /^https:\/\/127\.0\.0\.1:[0-9]+$/);
    transport = localTransport({ origin: generated.origin, ca: readFileSync(cert), cookie: generated.cookie, rate });
    return { clients, generated, transport, data, pid: service.pid, sourceSha256, stop,
      binarySha256: sha256(readFileSync(binary)), generatedAssetBytes: asset.length + Buffer.byteLength(html) };
  } catch (error) { await stop(); throw error; }
}

export function databaseCounts(data) {
  const script = "import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(json.dumps({t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['records','audits']}));c.close()";
  const result = spawnSync('python3', ['-c', script, join(data, 'atlas.sqlite')], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 4096,
  });
  assert.equal(result.status, 0, 'Read-only disposable SQLite inspection');
  return JSON.parse(result.stdout);
}
