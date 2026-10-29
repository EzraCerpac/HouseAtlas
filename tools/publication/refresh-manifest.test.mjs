// Synthetic cases for refresh-manifest.mjs: tiny generated trees and manifests in
// disposable temporary folders only; the repository's own manifest is never read
// or written. The last case runs a temporary copy of verify-source.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const script = new URL('./refresh-manifest.mjs', import.meta.url).pathname;
const repo = new URL('../../', import.meta.url);
const manifestPath = 'docs/publication/source-manifest.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const owners = ['alpha', 'beta'];
// "src-a.txt" sorts before "src/..." by full path, after it in a per-directory walk.
const initial = { 'README.md': 'alpha', 'src-a.txt': 'beta', 'src/run.sh': 'beta', 'src/z.json': 'alpha' };

// Independent of the script: rows and digest as verify-source.mjs checks them.
function expectedManifest(root, ownerOf) {
  const files = Object.keys(ownerOf).sort().map(path => {
    const bytes = readFileSync(join(root, path));
    const mode = (statSync(join(root, path)).mode & 0o111) ? '100755' : '100644';
    return { path, mode, bytes: bytes.length, sha256: sha(bytes), owner: ownerOf[path] };
  });
  const digest = sha(Buffer.from(files.map(r => `${r.path}\t${r.mode}\t${r.bytes}\t${r.sha256}\n`).join('')));
  return JSON.stringify({
    format: 'houseatlas-publication-source/1',
    status: 'synthetic-test-tree',
    self: { path: manifestPath, mode: '100644', digest: 'anchored-by-reviewed-tree' },
    owners,
    sourceDigestAlgorithm: 'SHA256 of UTF-8 sorted path TAB Git-mode TAB bytes TAB file-SHA256 LF; excludes this manifest',
    sourceDigestSha256: digest,
    files,
  }, null, 2) + '\n';
}

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'refresh-manifest-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'tree');
  const write = (path, text, mode = 0o644) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), mode);
  };
  write('README.md', 'Synthetic tree\n');
  write('src-a.txt', 'a\n');
  write('src/run.sh', '#!/bin/sh\nexit 0\n', 0o755);
  write('src/z.json', '{"synthetic": true}\n');
  write('node_modules/pkg/index.js', 'ignored\n');
  write('dist/out.js', 'ignored\n');
  write(manifestPath, expectedManifest(root, initial));
  return {
    base, root, write,
    manifest: () => readFileSync(join(root, manifestPath), 'utf8'),
    run: (...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' }),
  };
}

test('unchanged tree is a byte-for-byte no-op and --check passes', t => {
  const f = fixture(t);
  const before = f.manifest();
  for (const args of [[], ['--check']]) {
    const result = f.run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /is current \(4 rows\)/);
    assert.equal(f.manifest(), before);
  }
});

test('edited file updates bytes, sha256 and the aggregate digest', t => {
  const f = fixture(t);
  const before = JSON.parse(f.manifest());
  f.write('src/z.json', '{"synthetic": false, "edited": true}\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /changed 1:\n {2}src\/z\.json/);
  assert.equal(f.manifest(), expectedManifest(f.root, initial));
  assert.notEqual(JSON.parse(f.manifest()).sourceDigestSha256, before.sourceDigestSha256);
});

test('deleted file drops its row', t => {
  const f = fixture(t);
  unlinkSync(join(f.root, 'src-a.txt'));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const { 'src-a.txt': _, ...rest } = initial;
  assert.equal(f.manifest(), expectedManifest(f.root, rest));
  assert.match(result.stdout, /removed 1:\n {2}src-a\.txt/);
});

test('new file without an owner is refused and nothing is written', t => {
  const f = fixture(t);
  const before = f.manifest();
  f.write('target/debug/build-output.bin', 'stray\n');
  for (const args of [[], ['--check']]) {
    const result = f.run(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /1 path\(s\) have no manifest row and no owner:\n {2}target\/debug\/build-output\.bin/);
    assert.match(result.stderr, /--owner PATH=OWNER/);
    assert.match(result.stderr, /run from a clean checkout or remove them/);
    assert.equal(f.manifest(), before);
  }
});

test('new file with --owner is added in sorted path order', t => {
  const f = fixture(t);
  f.write('src-0.txt', 'zero\n');
  const result = f.run('--owner', 'src-0.txt=alpha');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.manifest(), expectedManifest(f.root, { ...initial, 'src-0.txt': 'alpha' }));
  assert.deepEqual(JSON.parse(f.manifest()).files.map(r => r.path), ['README.md', 'src-0.txt', 'src-a.txt', 'src/run.sh', 'src/z.json']);
  // Repeating the same --owner after the row exists is a no-op.
  const again = f.run('--owner', 'src-0.txt=alpha', '--check');
  assert.equal(again.status, 0, again.stderr);
});

test('unknown owner is refused', t => {
  const f = fixture(t);
  const before = f.manifest();
  f.write('new.txt', 'new\n');
  const result = f.run('--owner', 'new.txt=gamma');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /new\.txt: owner "gamma" is not in .* owners \(alpha, beta\)/);
  assert.equal(f.manifest(), before);
});

test('executable bit change is detected', t => {
  const f = fixture(t);
  chmodSync(join(f.root, 'src/run.sh'), 0o644);
  chmodSync(join(f.root, 'README.md'), 0o755);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const modes = Object.fromEntries(JSON.parse(f.manifest()).files.map(r => [r.path, r.mode]));
  assert.equal(modes['src/run.sh'], '100644');
  assert.equal(modes['README.md'], '100755');
  assert.equal(f.manifest(), expectedManifest(f.root, initial));
});

test('--check exits 1 on drift without writing, then 0 after a refresh', t => {
  const f = fixture(t);
  const before = f.manifest();
  f.write('README.md', 'Synthetic tree, edited\n');
  const check = f.run('--check');
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /is stale; a refresh would change it\nchanged 1:\n {2}README\.md/);
  assert.equal(f.manifest(), before);
  assert.equal(f.run().status, 0);
  assert.equal(f.run('--check').status, 0);
});

test('symlink is refused', t => {
  const f = fixture(t);
  const before = f.manifest();
  symlinkSync('README.md', join(f.root, 'src/link.md'));
  const result = f.run('--check');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /src\/link\.md is a symlink/);
  assert.equal(f.manifest(), before);
});

test('conflict markers, misdirected --owner and unsafe paths are refused', t => {
  const f = fixture(t);
  const clean = f.manifest();
  const conflicted = clean.replace(/( {2}"sourceDigestSha256": .*\n)/, '<<<<<<< ours\n$1=======\n  "sourceDigestSha256": "0",\n>>>>>>> theirs\n');
  writeFileSync(join(f.root, manifestPath), conflicted);
  let result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /contains merge conflict markers; take one side first/);
  assert.equal(f.manifest(), conflicted);
  writeFileSync(join(f.root, manifestPath), clean);
  for (const [args, message] of [
    [['--owner', 'README.md=beta'], /README\.md already has a row owned by alpha/],
    [['--owner', 'missing.txt=alpha'], /missing\.txt is not a regular file/],
    [['--owner', 'README.md'], /expected PATH=OWNER/],
    [['--unknown'], /Unknown option '--unknown'/],
  ]) {
    result = f.run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, message);
  }
  f.write('has space.txt', 'x\n');
  result = f.run('--owner', 'has space.txt=alpha');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /paths outside .*\n {2}has space\.txt/);
  assert.equal(f.manifest(), clean);
});

test('--owners-from supplies owners for paths added on the other side of a merge', t => {
  const f = fixture(t);
  f.write('docs/other-side.md', 'added on the base branch\n');
  const other = join(f.base, 'other-side-manifest.json');
  writeFileSync(other, JSON.stringify({ files: [{ path: 'docs/other-side.md', owner: 'beta' }, { path: 'README.md', owner: 'beta' }] }));
  const result = f.run('--owners-from', other);
  assert.equal(result.status, 0, result.stderr);
  // The existing README.md row keeps its owner; only the missing row is filled.
  assert.equal(f.manifest(), expectedManifest(f.root, { ...initial, 'docs/other-side.md': 'beta' }));
});

test('output passes a temporary copy of the actual publication verifier', t => {
  const f = fixture(t);
  const copied = ['tools/publication/verify-source.mjs', 'packages/operations-policy/policy.json', 'config/deployment.example.json'];
  for (const path of copied) {
    mkdirSync(dirname(join(f.root, path)), { recursive: true });
    copyFileSync(new URL(path, repo), join(f.root, path));
  }
  f.write('src/z.json', '{"synthetic": "edited before verification"}\n');
  const refreshed = f.run(...copied.flatMap(path => ['--owner', `${path}=alpha`]));
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const verified = spawnSync(process.execPath, [join(f.root, 'tools/publication/verify-source.mjs')], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /7 digests/);
  assert.equal(f.manifest(), expectedManifest(f.root, { ...initial, ...Object.fromEntries(copied.map(path => [path, 'alpha'])) }));
});
