// Explicit baseline compiler and healthy synthetic examples only. No legacy test aliases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
};
assert.equal(process.version, 'v26.10.0', 'Use the pinned Node runtime');
const npmVersion = spawnSync('npm', ['--version'], { cwd: root, encoding: 'utf8' });
assert.equal(npmVersion.status, 0);
assert.equal(npmVersion.stdout.trim(), '11.19.1', 'Use the pinned npm runtime');

// Keep compiler outputs outside the publication checkout. Explicit module integration
// may replace this temporary directory with CARGO_TARGET_DIR in a shared build cache.
const target = process.env.CARGO_TARGET_DIR ?? mkdtempSync(join(tmpdir(), 'houseatlas-at51-'));
const compilerEnv = { ...process.env, CARGO_TARGET_DIR: target };
// The integrator owns the manifests. Select the proposed paired precision
// features explicitly here until they are also selected in those manifests.
const precisionFeatures = ['--features', 'serde_json/arbitrary_precision,jsonschema/arbitrary-precision'];
try {
  run(process.execPath, ['tools/rust-baseline/generate-contracts.mjs', '--check']);
  run(process.execPath, ['tools/rust-baseline/check-contracts.mjs']);
  run(process.execPath, ['packages/contracts/history/check-history.mjs']);
  run('cargo', ['fmt', '--all', '--check'], compilerEnv);
  run('cargo', ['check', '--locked', '-p', 'houseatlas-backend', '--lib', '--examples', ...precisionFeatures], compilerEnv);
  run('cargo', ['clippy', '--locked', '-p', 'houseatlas-backend', '--lib', '--examples', ...precisionFeatures, '--', '-D', 'warnings'], compilerEnv);
  run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-contracts', ...precisionFeatures], compilerEnv);
  run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-dependencies', ...precisionFeatures], compilerEnv);
  run('npm', ['--prefix', 'frontend', 'run', 'typecheck']);
  run('npm', ['--prefix', 'frontend', 'run', 'build']);
  console.log('PASS AT51 source compilers and named healthy synthetic baseline examples');
} finally {
  if (!process.env.CARGO_TARGET_DIR) rmSync(target, { recursive: true, force: true });
}
