import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { policies, schemaSha256, validateRun } from '../contract/index.mjs';
import { fixtures, fixtureFacts, sha256 } from './fixtures.mjs';
import { METHOD, PROFILE } from './settings.mjs';
import { gitIdentity, harnessDigest, readSource, sourceRoot } from './source.mjs';
import { buildToolchain, childEnvironment, measureBundle } from './bundle.mjs';

const harnessRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cpuIds = policies.filter(policy => policy.id.startsWith('frontend.') && !policy.id.startsWith('frontend.startup_js.') && !policy.id.startsWith('frontend.bundle.')).map(policy => policy.id);
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..' + '/') && path !== '..' && !isAbsolute(path)); };
export function parseArgs(args) {
  if (args.length !== 4) throw new Error('Expected source root and new output');
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source-root', '--output'].includes(args[i]) || values.has(args[i]) || !isAbsolute(args[i + 1] ?? '')) throw new Error('Invalid measurement arguments');
    values.set(args[i], args[i + 1]);
  }
  const root = sourceRoot(values.get('--source-root'));
  const output = join(realpathSync(dirname(values.get('--output'))), basename(values.get('--output')));
  if (existsSync(output) || inside(root, output) || inside(realpathSync(harnessRoot), output)) throw new Error('Output must be a new file outside both checkouts');
  return { root, output };
}

const gitEqual = (a, b) => a.commit === b.commit && a.tree === b.tree && a.dirty === b.dirty;
const dependencyVersion = name => JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url))).version;
function npmVersion() {
  try {
    const version = execFileSync('npm', ['--version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).trim();
    return /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : null;
  } catch { return null; }
}
function resourceLimit(path, pattern) {
  try { const value = readFileSync(path, 'utf8').trim(); return pattern.test(value) ? value : null; } catch { return null; }
}

export function runMeasurement({ root, output }) {
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-perf-'));
  try {
    const source = gitIdentity(root), harness = gitIdentity(harnessRoot), filesSha256 = harnessDigest(harnessRoot);
    const observed = new Map();
    for (const path of ['frontend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.ts'])
      if (existsSync(resolve(root, path))) readSource(root, path, observed);
    const environment = {
      runtime: { node: process.version, v8: process.versions.v8, npm: npmVersion(), platform: process.platform, arch: process.arch,
        reactMode: 'production', execArgv: [] },
      host: { cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length || 1, availableParallelism: availableParallelism(), memoryBytes: totalmem(),
        cpuQuota: resourceLimit('/sys/fs/cgroup/cpu.max', /^(max|\d+) \d+$/), memoryLimit: resourceLimit('/sys/fs/cgroup/memory.max', /^(max|\d+)$/) },
      toolchain: { vite: dependencyVersion('vite'), react: dependencyVersion('react'), reactDom: dependencyVersion('react-dom'),
        three: dependencyVersion('three'), ajv: dependencyVersion('ajv'), lockSha256: sha256(readFileSync(new URL('./package-lock.json', import.meta.url))), ...buildToolchain(root) },
      browser: { status: 'unsupported', reason: 'supported-browser-tool-unavailable', version: null },
      gpu: { status: 'unsupported', reason: 'no-renderer-executed', renderer: null },
    };
    let cpu;
    try {
      const raw = execFileSync(process.execPath, [fileURLToPath(new URL('./cpu-worker.mjs', import.meta.url)), root],
        { env: childEnvironment(scratch), timeout: 90_000, maxBuffer: 1024 * 1024, stdio: 'pipe' });
      cpu = JSON.parse(raw);
      if (!Array.isArray(cpu.metrics) || !Array.isArray(cpu.files)) throw new Error('Invalid CPU worker result');
      for (const row of cpu.files) observed.set(row.path, row.sha256);
    } catch { cpu = { metrics: cpuIds.map(id => ({ id, status: 'failed', reason: 'execution-failed' })) }; }
    const bundle = process.version === 'v26.10.0' ? measureBundle(root, scratch)
      : policies.filter(policy => policy.id.startsWith('frontend.startup_js.') || policy.id.startsWith('frontend.bundle.'))
        .map(({ id }) => ({ id, status: 'blocked', reason: 'runtime-mismatch' }));
    const browser = policies.filter(policy => policy.id.startsWith('browser.')).map(({ id }) => ({ id, status: 'unsupported', reason: 'supported-browser-tool-unavailable' }));
    const sourceAfter = gitIdentity(root), harnessAfter = gitIdentity(harnessRoot), digestAfter = harnessDigest(harnessRoot);
    let stable = gitEqual(source, sourceAfter);
    for (const [path, hash] of observed) {
      try { stable &&= sha256(readSource(root, path, new Map())) === hash; } catch { stable = false; }
    }
    const currentTools = buildToolchain(root);
    stable &&= currentTools.buildVite === environment.toolchain.buildVite && currentTools.buildReact === environment.toolchain.buildReact;
    const harnessStable = gitEqual(harness, harnessAfter) && filesSha256 === digestAfter;
    const byId = new Map([...cpu.metrics, ...bundle, ...browser].map(row => [row.id, row]));
    let metrics = policies.map(({ id }) => byId.get(id) ?? { id, status: 'failed', reason: 'execution-failed' });
    if (!stable || !harnessStable) metrics = metrics.map(({ id }) => ({ id, status: 'failed', reason: stable ? 'harness-changed' : 'source-changed' }));
    const run = { format: 'houseatlas.perf.run/1', synthetic: true,
      source: { ...source, after: sourceAfter, files: [...observed].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })) },
      harness: { ...harness, schemaSha256, filesSha256, after: { ...harnessAfter, filesSha256: digestAfter } },
      method: METHOD, fixtures: fixtureFacts(fixtures()), environment, profile: PROFILE, metrics };
    if (!validateRun(run)) throw new Error('Invalid generated measurement');
    writeFileSync(output, JSON.stringify(run, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return metrics.some(row => row.status === 'failed') ? 1 : 0;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = runMeasurement(parseArgs(process.argv.slice(2))); }
  catch { console.error('Synthetic performance measurement unavailable: arguments, identity, dependencies or output invalid.'); process.exitCode = 1; }
}
