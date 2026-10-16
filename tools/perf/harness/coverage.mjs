// Coverage describes observed evidence. It is not another run schema or a PR
// comparison input, and does not execute benchmark or producer code.
import { constants, closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { policies, reportView, schemaSha256, summarize, validateRun } from '../contract/index.mjs';

export const COVERAGE = Object.freeze([
  { id: 'startup', label: 'Load and startup', lane: 'harness', evidence: 'static-build',
    metrics: ['frontend.startup_js.bytes', 'frontend.startup_js.gzip_bytes', 'frontend.bundle.largest_asset_bytes'],
    missing: ['actual browser navigation, network transfer, parse/evaluation and first visible content'],
    limitation: 'Emitted eager JavaScript and offline gzip sizes are not observed transfer or startup time.' },
  { id: 'model-cpu', label: 'Asset parsing and model preparation', lane: 'model', evidence: 'synthetic-cpu',
    metrics: ['frontend.scan.parse_ms', 'frontend.scan.prepare_ms', 'frontend.scan.edges_ms', 'frontend.standard_glb.load_ms'],
    missing: ['per-stage native descriptor/read/hash and browser commit/draw observations'],
    limitation: 'Warm Node CPU timings use public generated inputs; no browser or device execution is implied.' },
  { id: 'room-plan', label: 'Room and plan interaction', lane: 'model', evidence: 'synthetic-cpu',
    metrics: ['frontend.mesh.pick_ms', 'frontend.navigation.index_ms', 'frontend.navigator.ssr_ms'],
    missing: ['canonical room/plan hit testing, selection state, actual DOM commits and input-to-visible latency'],
    limitation: 'Mesh picking, product navigation and static React markup are partial proxies, not room/plan interaction latency.' },
  { id: 'render', label: 'Render and frame cost', lane: 'browser-device', evidence: 'browser-gpu',
    metrics: ['browser.first_mesh_draw_ms', 'browser.transition_frame_ms', 'browser.draw_calls'], missing: [],
    limitation: 'Unsupported without an attached supported browser that actually draws. A null WebGL context supplies no 3D timing evidence.' },
  { id: 'backend-read', label: 'Backend read latency', lane: 'backend', evidence: 'native-backend',
    metrics: [], missing: ['isolated native read latency with explicit auth/session/cache conditions'],
    limitation: 'Owned by the independent backend lane; frontend CPU or bundle timings cannot substitute for backend reads.' },
  { id: 'cache-reopen', label: 'Cold, warm and offline reopen', lane: 'model-and-browser', evidence: 'cache-lifecycle',
    metrics: [], missing: ['fresh-process load, authorized warm reuse, durable-cache reopen and actual offline reopen'],
    limitation: 'The existing profile warms CPU functions. That is not proof of application cache reuse, durable cache, offline availability or device reopen.' },
  { id: 'size-memory', label: 'Size and memory', lane: 'harness-and-model', evidence: 'static-and-cpu-size',
    metrics: ['frontend.scan.prepared_bytes', 'frontend.standard_glb.prepared_bytes', 'frontend.startup_js.bytes', 'browser.live_gpu_bytes'],
    missing: ['JS heap, external ArrayBuffers, process RSS, retained memory after reopen and actual GPU allocation'],
    limitation: 'Prepared vertex bytes are CPU array sizes, not JS heap, process footprint or GPU memory.' },
  { id: 'device-interaction', label: 'Actual browser and device interaction', lane: 'browser-device', evidence: 'browser-device',
    metrics: ['browser.selection_commit_ms'], missing: ['2D device interaction, scrolling, background/foreground and reopen'],
    limitation: 'A separate 2D browser observation may exist without WebGL; it must be retained as its own method and fixture, never upgraded to 3D evidence.' },
]);

/** Validate a recorded run and summarize only its measured facts. No coverage percentage. */
export function coverageReport(run) {
  if (!validateRun(run)) throw new Error('Invalid coverage input');
  const view = reportView(run);
  if (view.dirty) throw new Error('Coverage input source changed or is dirty');
  const rows = new Map(run.metrics.map(row => [row.id, row]));
  return { format: 'houseatlas.perf.coverage/1', observation: 'coverage-only-not-a-measurement-or-comparison-input', synthetic: true,
    sourceCommit: view.sourceCommit, sourceTree: view.sourceTree, harnessCommit: view.harnessCommit, schemaSha256,
    coverageTool: { method: 'recorded-run-coverage', revision: 1,
      sourceSha256: createHash('sha256').update(readFileSync(new URL('./coverage.mjs',import.meta.url))).digest('hex') },
    fixtureFingerprint: view.fixtureFingerprint, comparisonFingerprint: view.comparisonFingerprint,
    fixtures: structuredClone(run.fixtures), method: structuredClone(run.method), profile: structuredClone(run.profile),
    metrics: policies.map(policy => {
      const row = rows.get(policy.id);
      return { id: policy.id, label: policy.label, unit: policy.unit, kind: policy.kind, status: row?.status ?? 'missing',
        ...(row?.status === 'measured' ? { summary: summarize(row.samples) } : {}) };
    }),
    areas: COVERAGE.map(area => {
      const measured = area.metrics.filter(id => rows.get(id)?.status === 'measured');
      const unavailable = area.metrics.filter(id => rows.get(id)?.status !== 'measured')
        .map(id => ({ id, status: rows.get(id)?.status ?? 'missing' }));
      const status = measured.length ? (area.missing.length || unavailable.length ? 'partial' : 'measured')
        : unavailable.length && unavailable.every(row => row.status === 'unsupported') && !area.missing.length ? 'unsupported' : 'not-measured';
      return { ...structuredClone(area), status, measured, unavailable };
    }),
  };
}

export function renderCoverage(report) {
  const lines = ['Synthetic measurement coverage', '',
    `Source: ${report.sourceCommit} (tree ${report.sourceTree})`, `Harness: ${report.harnessCommit}`,
    `Schema SHA-256: ${report.schemaSha256}`, '',
    'This is a coverage summary of one recorded run, not proof that every requested scenario was measured.', '',
    '| Area | Coverage | Measured evidence | Missing evidence | Lane |', '| --- | --- | --- | --- | --- |'];
  for (const area of report.areas) lines.push(`| ${area.label} | ${area.status} | ${area.measured.join(', ') || 'None'} | ${[...area.missing,...area.unavailable.map(row => `${row.id}: ${row.status}`)].join('; ') || 'None'} | ${area.lane} |`);
  lines.push('', '| Recorded metric | Status | Median | p95 | Samples |', '| --- | --- | ---: | ---: | ---: |');
  for (const row of report.metrics) lines.push(`| ${row.label} | ${row.status} | ${row.summary ? row.summary.median + ' ' + row.unit : 'unavailable'} | ${row.summary ? row.summary.p95 + ' ' + row.unit : 'unavailable'} | ${row.summary?.count ?? 'none'} |`);
  lines.push('', ...report.areas.map(area => `${area.label}: ${area.limitation}`), '',
    'Independent producer observations must retain their exact source, harness, fixture, method, environment, cache/scenario, warmups/repetitions and raw samples. The current run schema and reporter fingerprints must not be bypassed to concatenate unlike producers or invent a hosted run identity.');
  return lines.join('\n') + '\n';
}

function readRun(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error();
    const bytes = Buffer.alloc(stat.size + 1); let length = 0, count;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    if (length !== stat.size || fstatSync(fd).size !== stat.size) throw new Error();
    return { value: JSON.parse(bytes.subarray(0, length).toString('utf8')), sha256: createHash('sha256').update(bytes.subarray(0, length)).digest('hex') };
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function runCoverage(args) {
  const names = ['--run','--json','--markdown'], options = new Map();
  if (args.length !== 6) throw new Error('Invalid coverage arguments');
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || options.has(args[i]) || !args[i+1]) throw new Error('Invalid coverage arguments');
    options.set(args[i],args[i+1]);
  }
  const input = readRun(options.get('--run')), report = { ...coverageReport(input.value), inputSha256: input.sha256 };
  writeFileSync(options.get('--json'), JSON.stringify(report,null,2)+'\n', {flag:'wx',mode:0o600});
  writeFileSync(options.get('--markdown'),renderCoverage(report),{flag:'wx',mode:0o600});
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runCoverage(process.argv.slice(2)); }
  catch { console.error('Performance coverage unavailable: input, identity or output invalid.'); process.exitCode = 1; }
}
