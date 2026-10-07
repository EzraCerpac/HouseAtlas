// Actual source compilation and three explicitly named healthy native examples.
// No cargo test aggregate, checkpoint oracle, jobs replay, or stopped control.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.version, 'v26.10.0');
assert(process.env.CARGO_TARGET_DIR, 'Set CARGO_TARGET_DIR outside the source checkout');
const run = (command, args) => {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, command + ' ' + args.join(' '));
};
run('node', ['tools/rust-baseline/generate-contracts.mjs', '--check']);
run('node', ['tools/rust-baseline/check-contracts.mjs']);
run('node', ['packages/contracts/history/check-history.mjs']);
run('cargo', ['fmt', '--all', '--check']);
run('cargo', ['check', '--locked', '-p', 'houseatlas-backend', '--lib', '--bins', '--examples']);
run('cargo', ['clippy', '--locked', '-p', 'houseatlas-backend', '--lib', '--bins', '--examples', '--', '-D', 'warnings']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-contracts']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-dependencies']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-native-semantics']);
run('cargo', ['build', '--locked', '-p', 'houseatlas-backend', '--bin', 'houseatlas']);
run('npm', ['--prefix', 'frontend', 'run', 'typecheck']);
run('npm', ['--prefix', 'frontend', 'run', 'build']);
console.log('PASS actual Rust library/binary/module source, strict TS React app, and three named healthy native examples');
