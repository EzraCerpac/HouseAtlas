// Diagnostic wrapper for the existing Cargo invocations; no extra build or cache.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const timedCommands = new Set(['build', 'clippy', 'run', 'test']);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const directory = env => env.HOUSEATLAS_CARGO_TIMINGS_DIR;
const cacheState = (hit, restored) => hit === 'true' ? 'exact-hit' : restored === 'true' ? 'fallback-hit' : restored === 'false' ? 'miss' : 'unknown';

export function initialize(path) {
  if (!isAbsolute(path)) throw new Error('Use an absolute timing output directory');
  mkdirSync(path, { recursive: true });
  const version = command => {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : 'unavailable';
  };
  const env = process.env;
  writeJson(join(path, 'context.json'), {
    format: 'houseatlas-cargo-timings/1',
    sourceSha: env.SOURCE_SHA ?? 'unknown',
    runnerOs: env.RUNNER_OS ?? 'unknown',
    runnerArch: env.RUNNER_ARCH ?? 'unknown',
    runnerImage: env.ImageOS ?? 'unknown',
    runnerImageVersion: env.ImageVersion ?? 'unknown',
    availableCpus: availableParallelism(),
    memoryBytes: totalmem(),
    cargoVersion: version('cargo'),
    rustcVersion: version('rustc'),
    incremental: env.CARGO_INCREMENTAL ?? 'default',
    devDebug: env.CARGO_PROFILE_DEV_DEBUG ?? 'default',
    registryCache: cacheState(env.TIMING_REGISTRY_HIT, env.TIMING_REGISTRY_RESTORED),
    dependencyBuildCache: cacheState(env.TIMING_TARGET_HIT, env.TIMING_TARGET_RESTORED),
    cachePolicy: 'PR restore only; main saves dependencies with workspace outputs pruned',
  });
}

export function runCargo(args, options = {}) {
  const env = { ...process.env, ...options.env };
  // The repository pins Cargo >=1.97. Denial here preserves the existing Clippy
  // target/feature selection without adding a fingerprint-changing rustc flag.
  if (args[0] === 'clippy') env.CARGO_BUILD_WARNINGS = 'deny';
  const output = directory(env);
  const enabled = output && timedCommands.has(args[0]);
  const actualArgs = [...args];
  if (enabled && !actualArgs.includes('--timings')) {
    const separator = actualArgs.indexOf('--');
    actualArgs.splice(separator < 0 ? actualArgs.length : separator, 0, '--timings');
  }
  const reportPath = env.CARGO_TARGET_DIR ? join(env.CARGO_TARGET_DIR, 'cargo-timings', 'cargo-timing.html') : undefined;
  let diagnosticReady = false;
  if (enabled) {
    try {
      if (!isAbsolute(output) || !env.CARGO_TARGET_DIR || !isAbsolute(env.CARGO_TARGET_DIR)) throw new Error('Timing paths must be absolute');
      mkdirSync(output, { recursive: true });
      // A failed Cargo command must never retain an earlier command's report.
      rmSync(reportPath, { force: true });
      diagnosticReady = true;
    } catch {
      console.warn('Cargo timing setup unavailable; Cargo outcome remains authoritative');
    }
  }
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync('cargo', actualArgs, { ...options, env });
  const wallSeconds = (performance.now() - start) / 1000;
  if (diagnosticReady) {
    try {
      const id = args[0] + '-' + randomUUID();
      const html = existsSync(reportPath) ? id + '.html' : null;
      if (html) copyFileSync(reportPath, join(output, html));
      writeJson(join(output, id + '.json'), {
        format: 'houseatlas-cargo-command/1',
        command: ['cargo', ...actualArgs],
        startedAt,
        wallSeconds,
        status: result.status,
        signal: result.signal,
        spawnError: result.error?.code ?? null,
        html,
        mayIncludeExecution: args[0] === 'run' || args[0] === 'test',
      });
    } catch {
      console.warn('Cargo timing report unavailable; Cargo outcome remains authoritative');
    } finally {
      // Retain diagnostics only in the artifact directory, outside the dependency cache.
      try { rmSync(join(env.CARGO_TARGET_DIR, 'cargo-timings'), { recursive: true, force: true }); }
      catch { console.warn('Cargo timing scratch cleanup unavailable'); }
    }
  }
  return result;
}

export function summarize(path, summaryPath) {
  if (!existsSync(path)) return;
  const contextPath = join(path, 'context.json');
  const context = existsSync(contextPath) ? JSON.parse(readFileSync(contextPath, 'utf8')) : {};
  const rows = readdirSync(path).filter(name => name.endsWith('.json') && name !== 'context.json')
    .map(name => JSON.parse(readFileSync(join(path, name), 'utf8')))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const clean = value => String(value ?? 'unknown').replace(/[|\r\n]/g, ' ');
  const text = [
    '### Cargo timing diagnostics',
    '',
    'Source: ' + clean(context.sourceSha) + '; runner: ' + clean(context.runnerOs) + '/' + clean(context.runnerArch) + '.',
    'Registry cache: ' + clean(context.registryCache) + '; dependency build cache: ' + clean(context.dependencyBuildCache) + '.',
    'Dependency cache hits still rebuild workspace crates. A miss is not an entirely cold machine. These are observed invocations, not paired speedup measurements.',
    '',
    '| Invocation | Wall seconds | Exit | Compilation report |',
    '| --- | ---: | --- | --- |',
    ...rows.map(row => '| ' + clean(row.command.join(' ')) + (row.mayIncludeExecution ? ' (may include execution)' : '') + ' | ' + row.wallSeconds.toFixed(3) + ' | ' + clean(row.signal ?? row.status) + ' | ' + (row.html ? 'retained' : 'unavailable') + ' |'),
    '',
    'HTML reports describe compilation only; wall time also includes Cargo overhead and any selected example/test execution. Missing reports remain explicit. Raw JSON and HTML are in the per-job Cargo timing artifact (14-day retention).',
    '',
  ].join('\n');
  writeFileSync(join(path, 'summary.md'), text);
  if (summaryPath) appendFileSync(summaryPath, text);
  console.log(text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'init' && args.length === 1) initialize(args[0]);
  else if (command === 'summary' && args.length === 0 && directory(process.env)) summarize(directory(process.env), process.env.GITHUB_STEP_SUMMARY);
  else if (timedCommands.has(command)) {
    const result = runCargo([command, ...args], { stdio: 'inherit' });
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exit(result.status ?? 1);
  } else throw new Error('Use init <directory>, summary, or an existing Cargo build/clippy/run/test command');
}
