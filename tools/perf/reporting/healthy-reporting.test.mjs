// Automatic lane: healthy numeric examples and valid metadata/archives only.
// Held adversarial, mutation/omission and failure-control files are not imported.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { compareMetric, renderTable, summarize } from './compare.mjs';
import { parseAvailabilityZip } from './availability.mjs';
import { publishOrigin } from './origin.mjs';
import { HARNESS_SHA, SCHEMA_SHA256 } from './measurement.mjs';
import { context, fakeOriginApi, identity, zipFixture } from './test-fixtures.mjs';

const policy = { id: 'example.cpu', label: 'Synthetic CPU duration', unit: 'ms', kind: 'timing', direction: 'lower' };
test('healthy samples retain medians, nearest-rank p95 and matching-direction deltas', () => {
  const samples = Array.from({ length: 20 }, (_, i) => i + 1);
  const summary = summarize(samples);
  assert.equal(summary.value, 10.5); assert.equal(summary.p95, 19); assert.equal(summary.count, 20);
  const row = compareMetric(policy, { samples: Array(9).fill(100) }, { samples: Array(9).fill(80) });
  assert.equal(row.deltaAbsolute, -20); assert.equal(row.deltaPercent, -20); assert.equal(row.status, 'improved');
  assert(renderTable([policy], [row]).includes('informational'));
});
test('healthy deterministic decimal boundary meets its configured relative budget', () => {
  const row = compareMetric({ ...policy, kind: 'deterministic', maxRegressionPercent: 10 }, { samples: [0.3] }, { samples: [0.33] });
  assert.equal(row.failed, false);
});
test('accepted finite values retain distinct zero-baseline and percentage-overflow evidence', () => {
  const overflow = compareMetric(policy, { samples: [Number.MIN_VALUE] }, { samples: [1] });
  const zero = compareMetric(policy, { samples: [0] }, { samples: [1] });
  assert.equal(overflow.deltaPercent, null); assert.equal(overflow.deltaPercentStatus, 'overflow');
  assert.equal(zero.deltaPercent, null); assert.equal(zero.deltaPercentStatus, 'zero-baseline');
  assert.equal(JSON.parse(JSON.stringify(overflow)).deltaPercentStatus, 'overflow');
  assert(renderTable([policy], [overflow]).includes('unavailable (overflow)'));
});
test('healthy unavailable states preserve both sides without inventing observations', () => {
  const row = compareMetric(policy, { skipReason: 'base-unsupported' }, { skipReason: 'head-unsupported' });
  assert.equal(row.reason, 'base-unsupported; head-unsupported');
  assert.equal(row.deltaPercentStatus, 'unavailable');
  assert.equal(row.base, null); assert.equal(row.head, null);
});
test('healthy closed availability archive and exact API origin create then update one comment', async () => {
  assert.equal(parseAvailabilityZip(zipFixture(), identity).reason, 'measurement-harness-unavailable');
  const { api, state } = fakeOriginApi(), input = { api, context, expectedPrNumber: 7 };
  assert.equal((await publishOrigin(input)).status, 'created');
  assert.equal((await publishOrigin(input)).status, 'updated');
  assert.equal(state.comments.length, 1);
});

const ownerRoot = process.env.HOUSEATLAS_PERF_CONTRACT_ROOT;
if (!ownerRoot) {
  test('healthy canonical owner contract integration', { skip: 'Pinned owner checkout is not supplied in this job' }, () => {});
} else {
  const git = args => execFileSync('git', args, { cwd: ownerRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), HARNESS_SHA); assert.equal(git(['status', '--porcelain']), '');
  const contract = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/contract/index.mjs')));
  const { exampleRun } = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/contract/test-fixture.mjs')));
  const { harnessDigest } = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/harness/source.mjs')));
  assert.equal(contract.schemaSha256, SCHEMA_SHA256);
  test('healthy canonical pair publishes actual-schema rows with explicit browser/GPU unsupported states', async () => {
    const { api, state } = fakeOriginApi(), baseRun = exampleRun(), headRun = exampleRun();
    const digest = harnessDigest(ownerRoot), tree = git(['rev-parse', 'HEAD^{tree}']);
    for (const [side, value] of [['base', baseRun], ['head', headRun]]) {
      const source = { commit: identity[`${side}Sha`], tree: identity[`${side}Tree`], dirty: false };
      value.source = { ...source, after: { ...source }, files: [] };
      const harness = { commit: HARNESS_SHA, tree, dirty: false, filesSha256: digest };
      value.harness = { ...harness, schemaSha256: SCHEMA_SHA256, after: { ...harness } };
    }
    assert(baseRun.metrics.filter(row => row.id.startsWith('browser.')).every(row => row.status === 'unsupported' && row.samples === undefined));
    state.zip = zipFixture([{ name: 'base.json', content: JSON.stringify(baseRun) }, { name: 'head.json', content: JSON.stringify(headRun) }]);
    state.artifacts[0].size_in_bytes = state.zip.length;
    const sourceCommit = api.getCommit;
    api.getCommit = async sha => sha === HARNESS_SHA ? { sha, commit: { tree: { sha: tree } } } : sourceCommit(sha);
    const result = await publishOrigin({ api, context, expectedPrNumber: 7,
      contractLoader: async () => ({ contract, harnessFilesSha256: digest }) });
    assert.equal(result.status, 'created'); assert.equal(result.failed, false);
    assert(result.markdown.includes(SCHEMA_SHA256));
    assert(result.markdown.includes('base-unsupported; head-unsupported'));
  });
}
