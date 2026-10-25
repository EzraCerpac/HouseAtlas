/** Runs every named healthy frontend check, one process each, and reports
 * timings. Explicit list only: regression, control, intake and handoff-directory
 * commands stay with their documented lanes in docs/contributing/verification.md.
 * Browser checks run only when HOUSEATLAS_CHROMIUM is set; checks that read the
 * production build need `npm --prefix frontend run build` first. Not listed:
 * session-bootstrap (external jsdom path) and scene-controls-keyboard-browser
 * (pinned Chrome build). Session-expiry regressions and capture-draft
 * controller controls and the native-place-levels-intake concurrency case stay
 * in their held lanes per AGENTS.md.
 *
 *   node frontend/lantern-tests/run-healthy.mjs [--only <substring>] */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const node = (file, ...args) => ['frontend/lantern-tests/' + file, ...args];
const cases = (file, flag, names) => names.map(name => node(file, ...(flag ? [flag, name] : [name])));

const SOURCE = [
  node('healthy-read.mjs'),
  node('canonical-ifc-viewer.test.mjs', '--healthy'),
  node('electricity-fixture-read.mjs'), node('electricity-overlay-read.mjs'),
  node('embedded-material-react.mjs'), node('exact-numeric-read.mjs'),
  node('ifc-glb-read.mjs'), node('load-numeric-source.mjs'),
  node('local-edit-panel-presentation.mjs'), node('local-edit-retention-controller-healthy.mjs'),
  node('local-edit-retention-healthy.mjs'), node('model-overview-read-healthy.mjs'),
  node('model-review-logic.test.mjs'), node('native-geometry-read.mjs'),
  node('native-geometry-retention.mjs'), node('native-geometry-persistence.mjs'), node('native-geometry-write.mjs'), node('native-place-search-healthy.mjs'),
  node('native-place-write.mjs'), node('native-scan-succession.mjs'),
  node('network-overlay-read.mjs'), node('pdf-fixture-resources.mjs'),
  node('pinned-capture-read.mjs'), node('scan-mesh-read.mjs'),
  node('scan-mesh-view-visual.mjs'), node('scan-plan-orientation.mjs'),
  node('scene-controls-keyboard.test.mjs'), node('source-documents-reader.test.mjs'),
  node('source-time-display.mjs'),
  node('topology-read.mjs'),
  // Offline / saved copy
  node('offline-atlas-mounting-healthy.mjs'), node('offline-atlas-overlays-healthy.mjs'),
  node('offline-atlas-presentation-healthy.mjs'), node('offline-catalog-mounting-healthy.mjs'),
  ...cases('offline-catalog-healthy.mjs', '--case', ['complete', 'partial']),
  node('offline-local-edit-mounting-healthy.mjs'), node('offline-retained-identity-healthy.mjs'),
  node('offline-root-entry-healthy.mjs'), node('offline-connection-probe-healthy.mjs'), node('offline-stage-discard-healthy.mjs'),
  // Unified Atlas
  node('unified-atlas-healthy.mjs'), node('unified-atlas-cache-healthy.mjs'), node('unified-atlas-network-connections-healthy.mjs'),
  node('unified-atlas-overlay-source-healthy.mjs'), node('unified-atlas-room-links-healthy.mjs'),
  node('unified-atlas-compact-layer-details.mjs'), node('unified-atlas-control-names-healthy.mjs'),
  // Named healthy cases
  ...cases('embedded-png-material-healthy.mjs', '--case', ['slots', 'image-sharing', 'png-filters',
    'png-adam7', 'accounting-1024', 'legacy-geometry', 'gpu-owner', 'precedence']),
  ...cases('native-evidence-request-read.mjs', '', ['healthy-committed-observation', 'healthy-unknown-observation']),
];
const BUILD = [node('check-backend-frontend-compat.mjs')];
const BROWSER = [
  ...cases('offline-launch-browser.mjs', '--case', ['offline-launch', 'hung-network']),
];

const only = process.argv[2] === '--only' ? process.argv[3] : null;
const selected = [...SOURCE, ...BUILD, ...(process.env.HOUSEATLAS_CHROMIUM ? BROWSER : [])]
  .filter(args => !only || args.join(' ').includes(only));
const results = [];
for (const args of selected) {
  const started = performance.now();
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 << 20 });
  const ms = Math.round(performance.now() - started), ok = run.status === 0;
  results.push({ command: args.join(' '), ok, ms });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${String(ms).padStart(6)} ms  node ${args.join(' ')}`);
  if (!ok) process.stdout.write((run.stdout + run.stderr).split('\n').slice(-25).map(line => '    ' + line).join('\n') + '\n');
}
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} healthy frontend checks passed`
  + (process.env.HOUSEATLAS_CHROMIUM ? '' : ' (browser checks skipped: HOUSEATLAS_CHROMIUM unset)'));
if (failed.length) process.exitCode = 1;
