// Standalone current-source bootstrap for the synthetic adapter/lifecycle fixture.
// No browser, listener, provider, native service or mutation is supplied.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

assert.equal(process.version, 'v26.10.0', 'Use pinned Node 26.10.0');
const frontend = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('../src/webmcp/healthy.examples.mjs', import.meta.url));
const namespace = mkdtempSync(join(tmpdir(), 'houseatlas-webmcp-adapter-'));
let exitCode = 1;
let signal = null;
try {
  writeFileSync(join(namespace, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
  for (const [entry, filename] of [['index.ts', 'index.js'], ['quantity/tool.ts', 'quantity.js'],
    ['quantity/QuantityHandoff.tsx', 'quantity-custody.js']]) {
    const built = await build({ root: frontend, configFile: false, logLevel: 'warn',
      build: { write: false, target: 'node26',
        lib: { entry: fileURLToPath(new URL(`../src/webmcp/${entry}`, import.meta.url)), formats: ['es'] },
        rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
    const output = Array.isArray(built) ? built[0] : built;
    const chunks = output.output.filter(row => row.type === 'chunk');
    assert.equal(chunks.length, 1, `Expected one self-contained current-source chunk for ${entry}`);
    assert(chunks[0].isEntry, 'Namespace chunk must be the requested entry');
    writeFileSync(join(namespace, filename), chunks[0].code, { flag: 'wx' });
  }
  const result = spawnSync(process.execPath, ['--test', fixture], {
    cwd: frontend, stdio: 'inherit',
    env: { ...process.env, HOUSEATLAS_AT39_BUILD: namespace },
  });
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
  signal = result.signal;
} finally {
  rmSync(namespace, { recursive: true, force: true });
}
// Preserve abnormal child termination after owned output has been removed.
if (signal) process.kill(process.pid, signal);
else process.exitCode = exitCode;
