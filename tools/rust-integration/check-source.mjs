// Actual source compilation and four explicitly named healthy native examples.
// No cargo test aggregate, checkpoint oracle, jobs replay, or stopped control.
// CI jobs that compile the binary or the React app themselves pass
// --skip-binary or --skip-frontend; with no flags everything runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runCargo } from '../ci/cargo-timings.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const flags = new Set(process.argv.slice(2));
for (const flag of flags) assert(['--skip-binary', '--skip-frontend'].includes(flag), 'Unknown flag ' + flag);
assert.equal(process.version, 'v26.10.0');
assert(process.env.CARGO_TARGET_DIR, 'Set CARGO_TARGET_DIR outside the source checkout');
const run = (command, args) => {
  const r = command === 'cargo'
    ? runCargo(args, { cwd: root, stdio: 'inherit' })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, command + ' ' + args.join(' '));
};
run('node', ['tools/rust-baseline/generate-contracts.mjs', '--check']);
run('node', ['tools/rust-baseline/generate-contracts.mjs', '--measurements', '--check']);
run('node', ['backend/src/contracts/stock/generate-catalog.mjs', '--check']);
run('node', ['tools/rust-baseline/check-contracts.mjs']);
run('node', ['packages/contracts/history/check-history.mjs']);
run('cargo', ['fmt', '--all', '--check']);
// clippy runs every check that cargo check would, so a separate check is not needed.
run('cargo', ['clippy', '--locked', '-p', 'houseatlas-backend', '--lib', '--bins', '--examples']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-contracts']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-dependencies']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-native-semantics']);
run('cargo', ['run', '--locked', '-p', 'houseatlas-backend', '--example', 'healthy-maintenance-calendar']);
if (!flags.has('--skip-binary')) run('cargo', ['build', '--locked', '-p', 'houseatlas-backend', '--bin', 'houseatlas']);
if (!flags.has('--skip-frontend')) {
  run('npm', ['--prefix', 'frontend', 'run', 'typecheck']);
  run('npm', ['--prefix', 'frontend', 'run', 'build']);
}
console.log('PASS actual Rust library/binary/module source, strict TS React app, and four named healthy native examples' + (flags.size ? ' (' + [...flags].join(' ') + ')' : ''));
