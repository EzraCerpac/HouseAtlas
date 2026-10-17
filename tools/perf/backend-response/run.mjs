import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, realpathSync, existsSync, copyFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIdentity, sourceRoot } from '../harness/source.mjs';

const BASE = '968a17f78979b7827387af0984333fb64c55a9f6';
const PR200 = '7174252a67c85f8417f3646cf82a49c058f3d8d6';
const root = sourceRoot(fileURLToPath(new URL('../../../', import.meta.url)));
const own = fileURLToPath(new URL('./', import.meta.url));
assert.equal(process.version, 'v26.10.0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const oldFile = path => git(['show', `${BASE}:${path}`]);
const sourcePath = 'backend/src/http/mod.rs';
const code = readFileSync(join(root, sourcePath), 'utf8');
const baselineCode = oldFile(sourcePath);
const args = process.argv.slice(2);
assert.equal(args.length, 2, 'Expected --output /absolute/new.json');
assert.equal(args[0], '--output');
assert(isAbsolute(args[1]));
const output = join(realpathSync(dirname(args[1])), args[1].split('/').at(-1));
assert(!existsSync(output));
assert(relative(root, output).startsWith('../'), 'Keep observations outside Git');
const identity = gitIdentity(root);
const observed = ['backend/src/http/mod.rs', 'backend/src/domain/model.rs', 'backend/src/domain/projection.rs',
  'backend/src/lifecycle/mod.rs', 'packages/contracts/fixtures/plan-free.snapshot.json', 'Cargo.lock',
  'tools/perf/harness/source.mjs', 'tools/perf/harness/fixtures.mjs',
  'tools/perf/backend-response/run.mjs', 'tools/perf/backend-response/worker.rs', 'tools/perf/backend-response/README.md'];
const hashes = () => Object.fromEntries(observed.map(path => [path, hash(readFileSync(join(root, path)))]));
const beforeHashes = hashes();
// The actual PR200 fixture module supplies its sizes and repetition policy.
// Geometry generation remains unused in this supplemental Rust lane.
const profileSource = git(['show', `${PR200}:tools/perf/model-interaction/fixtures.mjs`]);
const { PROFILE } = await import(`data:text/javascript;base64,${Buffer.from(profileSource).toString('base64')}`);
const profile = { sizes: PROFILE.sizes, warmups: PROFILE.warmups, repetitions: PROFILE.repetitions,
  allocationRepetitions: PROFILE.allocationRepetitions };
// Fail if the shared domain/fixture code diverges from the baseline: both
// extracted functions are intentionally linked against one identical peer.
for (const path of observed.filter(path => path.startsWith('backend/') && path !== sourcePath))
  assert.equal(readFileSync(join(root, path), 'utf8'), oldFile(path));

function extract(text) {
  const start = text.indexOf('fn browser_view('), end = text.indexOf('fn json_response(', start);
  assert(start >= 0 && end > start);
  return `use houseatlas_backend::domain as d;\nuse axum::http::StatusCode;\nuse serde_json::{Value,json};\n#[derive(Debug)] pub(super) struct HttpFailure;\nfn failure(_:StatusCode)->HttpFailure{HttpFailure}\n` +
    text.slice(start, end).replaceAll('fn browser_view(', 'pub(super) fn browser_view(')
      .replaceAll('fn browser_entries(', 'pub(super) fn browser_entries(');
}
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-response-cpu-'));
try {
  mkdirSync(join(scratch, 'src'));
  writeFileSync(join(scratch, 'src/baseline.rs'), extract(baselineCode));
  writeFileSync(join(scratch, 'src/candidate.rs'), extract(code));
  writeFileSync(join(scratch, 'src/main.rs'), readFileSync(join(own, 'worker.rs')));
  writeFileSync(join(scratch, 'Cargo.toml'), `[package]\nname="houseatlas-response-observer"\nversion="0.0.0"\nedition="2024"\n[workspace]\n[features]\nallocation-counts=[]\n[dependencies]\nhouseatlas-backend={path=${JSON.stringify(join(root,'backend'))}}\nserde_json={version="=1.0.151",features=["arbitrary_precision","float_roundtrip","raw_value"]}\nsha2="=0.10.9"\naxum={version="=0.8.9",default-features=false,features=["json"]}\n[profile.dev]\nopt-level=1\ndebug=0\nstrip="none"\n`);
  writeFileSync(join(scratch, 'Cargo.lock'), readFileSync(join(root, 'Cargo.lock')));
  // Explicit compiler directory prevents PATH shims mixing patch releases.
  const rustc = process.env.RUSTC;
  assert(rustc && isAbsolute(rustc), 'Set RUSTC to the absolute pinned rustc');
  assert.match(execFileSync(rustc, ['-V'], { encoding: 'utf8' }), /^rustc 1\.99\.0 /);
  if (process.env.CARGO_TARGET_DIR) assert(isAbsolute(process.env.CARGO_TARGET_DIR));
  const toolchain = dirname(rustc), cargo = join(toolchain, 'cargo');
  const environment = { PATH: `${toolchain}:/usr/bin:/bin`, HOME: process.env.HOME,
    RUSTC: rustc, RUSTDOC: join(toolchain, 'rustdoc'), LANG: 'C.UTF-8', TZ: 'UTC', TMPDIR: scratch,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(scratch, 'target'),
    ...(process.platform === 'darwin' ? { MACOSX_DEPLOYMENT_TARGET: '15.0' } : {}) };
  // Resolve only the observer's package entry offline; retain source dependency
  // versions byte-for-byte and then require --locked for the actual build.
  execFileSync(cargo, ['metadata', '--offline', '--format-version=1', '--manifest-path', join(scratch, 'Cargo.toml')], { env: environment, stdio: ['ignore', 'ignore', 'inherit'] });
  const lock = readFileSync(join(scratch, 'Cargo.lock'), 'utf8');
  const sourcePackages = readFileSync(join(root, 'Cargo.lock'), 'utf8').split('[[package]]').slice(1);
  for (const block of lock.split('[[package]]').slice(1)) {
    if (block.includes('source = "registry+')) {
      const [name, version] = [block.match(/\nname = "([^"]+)"/)[1], block.match(/\nversion = "([^"]+)"/)[1]];
      assert(sourcePackages.some(original => original.includes(`name = "${name}"\nversion = "${version}"`)), `Dependency drift: ${name}`);
    }
  }
  execFileSync(cargo, ['build', '--offline', '--locked', '--manifest-path', join(scratch, 'Cargo.toml')], { env: environment, stdio: 'inherit', timeout: 900_000 });
  const binary = join(environment.CARGO_TARGET_DIR, 'debug/houseatlas-response-observer');
  const timingBinary = join(scratch, 'timing-observer');
  copyFileSync(binary, timingBinary);
  const runs = Array.from({ length: 3 }, () => JSON.parse(execFileSync(binary, [JSON.stringify(profile)],
    { env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })));
  execFileSync(cargo, ['build', '--offline', '--locked', '--features', 'allocation-counts', '--manifest-path', join(scratch, 'Cargo.toml')], { env: environment, stdio: 'inherit', timeout: 900_000 });
  const allocationRuns = Array.from({ length: 3 }, () => JSON.parse(execFileSync(binary, [JSON.stringify(profile)],
    { env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })));
  for (const run of [...runs, ...allocationRuns]) for (const [i, result] of run.results.entries()) {
    assert.equal(result.fixtureSha256, runs[0].results[i].fixtureSha256);
    assert.equal(result.outputSha256, runs[0].results[i].outputSha256);
  }
  assert.deepEqual(gitIdentity(root), identity);
  assert.deepEqual(hashes(), beforeHashes);
  const document = { format: 'houseatlas.perf.backend-response/1', synthetic: true, observedAt: new Date().toISOString(),
    baseline: { commit: BASE, tree: git(['rev-parse', `${BASE}^{tree}`]).trim(), sourceSha256: hash(baselineCode) }, source: identity, files: beforeHashes,
    harnessReuse: { commit: PR200, profileSourceSha256: hash(profileSource), profile },
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
      rustc: execFileSync(rustc, ['-Vv'], { env: environment, encoding: 'utf8' }),
      optimization: 'dev opt-level=1 debug=0 strip=none', deploymentTarget: environment.MACOSX_DEPLOYMENT_TARGET ?? null,
      timingBinarySha256: hash(readFileSync(timingBinary)), allocationBinarySha256: hash(readFileSync(binary)),
      observerLockSha256: hash(lock) }, runs, allocationRuns,
    limitations: ['Synthetic browser DTOs; no live HTTP/storage/auth/provider work',
      'Extracted exact production preparation bodies; visibility and failure type adapted for standalone invocation',
      'Allocation calls include realloc; bytes are requested sizes including realloc replacement sizes, not peak/live/RSS',
      'Timing binary uses the normal allocator; separate allocation-counting binary is never used for timings',
      'Timing includes input disposal; prepare-only also drops the prepared Value; input cloning excluded',
      'Warm process CPU observations; no cold-cache or whole-application speedup claim'] };
  writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${runs.length} timing and ${allocationRuns.length} allocation processes to ${output}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
