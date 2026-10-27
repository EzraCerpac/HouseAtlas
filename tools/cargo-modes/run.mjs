// Optional build modes only: never installs a toolchain or launches the server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const [mode, ...args] = process.argv.slice(2);
const modes = {
  check: ['check', 'dev-check'],
  dev: ['build', 'dev-incremental'],
  profiling: ['build', 'profiling'],
  bench: ['build', 'benchmark'],
};
assert(mode === 'diagnostic' || Object.hasOwn(modes, mode),
  'Usage: node tools/cargo-modes/run.mjs check|dev|profiling|bench|diagnostic [Cargo options]');
const channel = readFileSync(new URL('rust-toolchain.toml', root), 'utf8')
  .match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
assert(channel, 'Expected an exact Rust version in rust-toolchain.toml');

function isModeOverride(arg) {
  if (/^(--profile|--release|--manifest-path|--config)(=|$)/.test(arg)) return true;
  if (!/^-[^-]/.test(arg)) return false;
  // Cargo 1.99 accepts -r (release) and -m (manifest-path) in short
  // clusters. Stop at value-taking options: -pcrate-rm/-Ffeature-rm are values.
  for (const flag of arg.slice(1)) {
    if (flag === 'r' || flag === 'm') return true;
    if ('pjFZ'.includes(flag)) return false;
  }
  return false;
}

function run(command) {
  const result = spawnSync('rustup', ['run', channel, ...command], {
    cwd: fileURLToPath(root),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error('Command interrupted by ' + result.signal);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'diagnostic') {
  assert.equal(args.length, 0, 'Diagnostic takes no arguments');
  console.log('Selected Rust: ' + channel);
  console.log('Host: ' + process.platform + '/' + process.arch + '; Node: ' + process.version);
  run(['rustc', '-vV']);
  run(['cargo', '-V']);
} else {
  // Keep the selected mode/workspace fixed; target, feature, offline and timing
  // options pass to Cargo unchanged, without a shell.
  assert(!args.some(isModeOverride),
    'The task selects its profile and workspace; use Cargo directly for overrides');
  const [command, profile] = modes[mode];
  run(['cargo', command, '--locked', '-p', 'houseatlas-backend', '--profile', profile, ...args]);
}
