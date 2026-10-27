import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const source = new URL('./run.mjs', import.meta.url);
const pin = new URL('../../rust-toolchain.toml', import.meta.url);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cargo-modes-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runner = join(root, 'tools/cargo-modes/run.mjs');
  const bin = join(root, 'bin');
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(dirname(runner), { recursive: true });
  mkdirSync(bin); mkdirSync(elsewhere);
  copyFileSync(source, runner);
  copyFileSync(pin, join(root, 'rust-toolchain.toml'));
  const channel = readFileSync(pin, 'utf8').match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)[1];
  const receipt = join(root, 'receipt.json');
  const stub = join(root, 'record.mjs');
  writeFileSync(stub, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CARGO_MODES_TEST_RECEIPT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n");
  const executable = join(bin, 'rustup');
  writeFileSync(executable, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(stub) + ' "$@"\n');
  chmodSync(executable, 0o755);
  return {
    root, receipt, channel,
    invoke(mode, args) {
      return spawnSync(process.execPath, [runner, mode, ...args], {
        cwd: elsewhere, encoding: 'utf8',
        env: { ...process.env, PATH: bin, CARGO_MODES_TEST_RECEIPT: receipt },
      });
    },
  };
}

const mappings = { check: ['check', 'dev-check'], dev: ['build', 'dev-incremental'],
  profiling: ['build', 'profiling'], bench: ['build', 'benchmark'] };

for (const [mode, [command, profile]] of Object.entries(mappings)) {
  test(mode + ': forwards exact targets/features from the workspace root', t => {
    const f = fixture(t);
    const args = ['--example', 'synthetic-example', '-pcrate-rm', '-Ffeature-rm',
      '-j2', '--target-dir', 'target with spaces', '--offline', '--help'];
    const result = f.invoke(mode, args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(f.receipt, 'utf8')), {
      args: ['run', f.channel, 'cargo', command, '--locked', '-p',
        'houseatlas-backend', '--profile', profile, ...args],
      cwd: f.root,
    });
  });

  for (const args of [
    ['-r'], ['-vr'], ['-rv'], ['-qr'], ['-rj2'], ['-vrj2'], ['-hr'],
    ['-m', 'other/Cargo.toml'], ['-mother/Cargo.toml'],
    ['-vm', 'other/Cargo.toml'], ['-qmother/Cargo.toml'], ['-vvmother/Cargo.toml'],
    ['--release'], ['--profile', 'release'], ['--profile=release'],
    ['--manifest-path', 'other/Cargo.toml'], ['--manifest-path=other/Cargo.toml'],
    ['--config', 'profile.dev.opt-level=3'], ['--config=profile.dev.opt-level=3'],
  ]) {
    test(mode + ': rejects override ' + args.join(' ') + ' before child/help', t => {
      const f = fixture(t);
      const result = f.invoke(mode, [...args, '--help']);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /task selects its profile and workspace/);
      assert.equal(existsSync(f.receipt), false);
    });
  }
}
