// Formatting only; no compilation, lint fixes, staging or publication.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const flags = process.argv.slice(2);
assert(flags.length === 0 || (flags.length === 1 && flags[0] === '--check'),
  'Usage: node tools/rust-integration/format.mjs [--check]');
assert(process.env.RUSTFMT === undefined,
  'Unset RUSTFMT to use the formatter pinned in rust-toolchain.toml');
const toolchain = readFileSync(new URL('rust-toolchain.toml', root), 'utf8');
const channel = toolchain.match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
assert(channel, 'Expected an exact Rust version in rust-toolchain.toml');
// Bypass Cargo fmt aliases and an inherited metadata-helper executable.
const formatterEnv = { ...process.env };
delete formatterEnv.CARGO;
const result = spawnSync('rustup', ['run', channel, 'cargo-fmt', '--all', ...flags], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
  env: formatterEnv,
});
if (result.error) throw result.error;
if (result.signal) throw new Error('Formatter interrupted by ' + result.signal);
process.exitCode = result.status ?? 1;
