import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnvironment } from '../harness/bundle.mjs';
import { gitIdentity, harnessDigest, readSource, sourceRoot } from '../harness/source.mjs';
import { PROFILE, sha256 } from './fixtures.mjs';

const ownRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extension = fileURLToPath(new URL('./', import.meta.url));
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('../'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function measurementDigest() {
  const files = readdirSync(extension).sort().map(name => {
    const path = join(extension, name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Nonregular measurement source');
    return [name, sha256(readFileSync(path))];
  });
  return sha256(JSON.stringify({ harness: harnessDigest(ownRoot), files }));
}
export function parseArgs(args) {
  if (args.length !== 4) throw new Error('Expected source root and output');
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source-root', '--output'].includes(args[i]) || values.has(args[i]) || !isAbsolute(args[i + 1] ?? '')) throw new Error('Invalid arguments');
    values.set(args[i], args[i + 1]);
  }
  if (!values.has('--source-root') || !values.has('--output')) throw new Error('Missing arguments');
  const root = sourceRoot(values.get('--source-root'));
  const requested = values.get('--output'), output = join(realpathSync(dirname(requested)), basename(requested));
  if (existsSync(output) || inside(root, output) || inside(realpathSync(ownRoot), output)) throw new Error('Output must be new and outside source');
  return { root, output };
}
function limit(name) { try { return readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim(); } catch { return null; } }

export function run({ root, output }) {
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-model-cpu-'));
  try {
    const source = gitIdentity(root), harness = gitIdentity(ownRoot), digest = measurementDigest();
    const version = name => JSON.parse(readFileSync(new URL(`../harness/node_modules/${name}/package.json`, import.meta.url))).version;
    const environment = { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
      reactMode: 'production', workerExecArgv: ['--expose-gc'], cpu: cpus()[0]?.model ?? 'unknown',
      availableParallelism: availableParallelism(), logicalCpus: cpus().length, memoryBytes: totalmem(),
      cpuQuota: limit('cpu.max'), memoryLimit: limit('memory.max'),
      dependencies: Object.fromEntries(['vite', 'react', 'react-dom', 'three'].map(name => [name, version(name)])),
      lockSha256: sha256(readFileSync(new URL('../harness/package-lock.json', import.meta.url))) };
    let worker, status = 'measured';
    if (process.version !== 'v26.10.0') { status = 'blocked'; worker = { reason: 'runtime-mismatch', results: [], sourceFiles: [] }; }
    else try {
      worker = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./worker.mjs', import.meta.url)), root],
        { env: childEnvironment(scratch), timeout: 180_000, maxBuffer: 8 * 1024 * 1024, stdio: 'pipe' }));
      if (worker.results.length !== PROFILE.sizes.length || !Array.isArray(worker.sourceFiles)) throw new Error('Invalid worker output');
    } catch { status = 'failed'; worker = { reason: 'execution-failed', results: [], sourceFiles: [] }; }
    const sourceAfter = gitIdentity(root), harnessAfter = gitIdentity(ownRoot), digestAfter = measurementDigest();
    let stable = same(source, sourceAfter) && same(harness, harnessAfter) && digest === digestAfter;
    for (const row of worker.sourceFiles) {
      try { stable &&= sha256(readSource(root, row.path, new Map())) === row.sha256; } catch { stable = false; }
    }
    if (!stable) { status = 'failed'; worker = { ...worker, reason: 'source-or-harness-changed', results: [] }; }
    const document = { format: 'houseatlas.perf.model-interaction/1', synthetic: true, status,
      source: { ...source, after: sourceAfter, files: worker.sourceFiles },
      harness: { ...harness, filesSha256: digest, after: { ...harnessAfter, filesSha256: digestAfter } },
      method: { id: 'model-interaction-cpu', revision: 1 }, profile: PROFILE, environment,
      unsupported: ['browser-rendering', 'gpu', 'iphone', 'peak-memory', 'total-allocations', 'network-load'],
      ...(worker.reason ? { reason: worker.reason } : {}), results: worker.results };
    writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return status === 'measured' ? 0 : 1;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = run(parseArgs(process.argv.slice(2))); }
  catch { console.error('Model interaction measurement unavailable: inspect runtime, dependencies, source identity and new output.'); process.exitCode = 1; }
}
