// Automatic lane: healthy numeric examples and valid metadata/archives only.
// Held adversarial, mutation/omission and failure-control files are not imported.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { compareMetric, formatPercent, formatValue, renderTable, summarize } from './compare.mjs';
import { makeAvailabilityReport, parseAvailabilityZip } from './availability.mjs';
import { makeReport } from './report.mjs';
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
  assert(renderTable([policy], [row]).includes('➖ Shift (informational)'));
  assert(renderTable([policy], [row]).includes('-20.0%'));
});
test('healthy deterministic decimal boundary meets its configured relative budget', () => {
  const row = compareMetric({ ...policy, kind: 'deterministic', maxRegressionPercent: 10 }, { samples: [0.3] }, { samples: [0.33] });
  assert.equal(row.failed, false);
  assert(renderTable([{ ...policy, kind: 'deterministic', maxRegressionPercent: 10 }], [row]).includes('❌ Regressed; budget passed'));
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

test('compact display uses one decimal for deltas and readable nonzero timing/size precision', () => {
  assert.equal(formatPercent(12.345, 'measured'), '+12.3%');
  assert.equal(formatPercent(-12.345, 'measured'), '-12.3%');
  assert.equal(formatPercent(-0.001, 'measured'), '0.0%');
  assert.equal(formatPercent(1e21, 'measured'), '+1.0E21%');
  assert.equal(formatValue(1.234567, 'ms'), '1.23 ms');
  assert.equal(formatValue(0.0002, 'ms'), '0.0002 ms');
  assert.equal(formatValue(1023, 'bytes'), '1023 B');
  assert.equal(formatValue(6048, 'bytes'), '5.91 KiB');
  assert.equal(formatValue(446177, 'bytes'), '435.7 KiB');
  assert.equal(formatValue(4194304, 'bytes'), '4 MiB');
});

test('compact statuses retain direction, noise and sample semantics before display rounding', () => {
  const policies = ['improved', 'degraded', 'within', 'same', 'higher', 'short'].map(id => ({ ...policy, id }));
  policies[4].direction = 'higher';
  const heads = [80, 120, 99, 100, 120, 90];
  const rows = policies.map((p, i) => compareMetric(p, { samples: Array(i === 5 ? 1 : 9).fill(100) }, { samples: Array(i === 5 ? 1 : 9).fill(heads[i]) }));
  assert.deepEqual(rows.map(row => row.status), ['improved', 'degraded', 'within-noise', 'unchanged', 'improved', 'insufficient-samples']);
  const table = renderTable(policies, rows);
  for (const text of ['➖ Shift (informational)', '➖ Within noise', '➖ Unchanged', '⚪ Too few samples', '↑', '+20.0%']) assert(table.includes(text));
  assert(!table.includes('✅') && !table.includes('❌'));
  assert.equal(table.split('Shift (informational)').length - 1, 3);
  assert(rows.every(row => row.failed === false));
  const report = makeReport({ identity: { ...identity, harnessSha: HARNESS_SHA }, policies,
    base: new Map(policies.map((p, i) => [p.id, { samples: Array(i === 5 ? 1 : 9).fill(100) }])),
    head: new Map(policies.map((p, i) => [p.id, { samples: Array(i === 5 ? 1 : 9).fill(heads[i]) }])) });
  assert(report.markdown.includes('➖ 3 timing shifts (informational)'));
  assert(!report.markdown.includes('✅') && !report.markdown.includes('❌'));
  assert.deepEqual(report.comparisons, rows);
  const size = { ...policy, kind: 'deterministic', unit: 'bytes' };
  const unbudgeted = compareMetric(size, { samples: [100] }, { samples: [120] });
  assert.equal(unbudgeted.failed, false);
  assert(renderTable([size], [unbudgeted]).includes('❌ Regressed; no budget'));
  const budgeted = { ...size, maximum: 200 };
  assert(renderTable([budgeted], [compareMetric(budgeted, { samples: [100] }, { samples: [120] })]).includes('❌ Regressed; budget passed'));
});

test('concise report groups only unsupported browser coverage and links essential provenance', () => {
  const policies = [policy, { ...policy, id: 'browser.draw_ms', label: 'Browser draw' }, { ...policy, id: 'browser.other_ms', label: 'Available browser work' }];
  const unsupported = side => ({ skipReason: `${side}-unsupported` });
  const result = makeReport({ identity: { ...identity, harnessSha: HARNESS_SHA }, policies,
    base: new Map([[policy.id, { samples: Array(9).fill(100) }], ['browser.draw_ms', unsupported('base')], ['browser.other_ms', { samples: Array(9).fill(10) }]]),
    head: new Map([[policy.id, { samples: Array(9).fill(80) }], ['browser.draw_ms', unsupported('head')], ['browser.other_ms', { samples: Array(9).fill(10) }]]) });
  const [primary, details] = result.markdown.split('<details>');
  assert(primary.includes('➖ 1 timing shifts (informational)'));
  assert(!primary.includes('✅') && !primary.includes('❌'));
  assert.equal(result.comparisons[0].status, 'improved');
  assert.equal(result.comparisons[0].deltaPercent, -20);
  assert.equal(result.failed, false);
  assert(primary.includes('⚪ Browser/GPU: 1 metric unsupported.'));
  assert(!primary.includes('| Browser draw'));
  assert(primary.includes('| Available browser work'));
  assert(!primary.includes(identity.baseSha));
  assert(details.includes(`/commit/${identity.baseSha}`));
  assert(details.includes(`/commit/${identity.headSha}`));
  assert(details.includes('Measurement run 2, attempt 1'));
  assert(details.includes('Method / noise thresholds'));
  assert.equal((result.markdown.match(/<details>/g) ?? []).length, 1);
  assert(details.length < 1000);
  const cliIdentity = { ...identity, harnessSha: HARNESS_SHA };
  delete cliIdentity.reporterSha;
  const cliReport = makeReport({ identity: cliIdentity, policies: [policy],
    base: new Map([[policy.id, { samples: Array(9).fill(100) }]]), head: new Map([[policy.id, { samples: Array(9).fill(80) }]]) });
  assert(cliReport.markdown.includes('[Collection method]'));
  assert(!cliReport.markdown.includes('[Method / noise thresholds]'));
  assert(cliReport.markdown.includes('within-noise ≤ max(5%, 2 × summed noise)'));
  assert(cliReport.markdown.includes('timings need ≥5 samples'));
});

test('display rounding preserves exact budget outcomes, limits and machine comparisons', () => {
  const p = { ...policy, kind: 'deterministic', maximum: 100.00000001, maxRegressionPercent: 0.00000001 };
  const result = makeReport({ identity: { ...identity, harnessSha: HARNESS_SHA }, policies: [p],
    base: new Map([[p.id, { samples: [100] }]]), head: new Map([[p.id, { samples: [100.0000001] }]]) });
  assert.equal(result.failed, true);
  assert(result.markdown.includes('❌ 1 regressed'));
  assert(result.markdown.includes('❌ Budget failed'));
  assert(result.markdown.includes('| 0.0% |'));
  assert(result.markdown.includes('regression ≤ 1e-8%'));
  assert(result.markdown.includes('max 100.00000001 ms'));
  assert.equal(result.comparisons[0].head.value, 100.0000001);
  assert(result.comparisons[0].deltaPercent > p.maxRegressionPercent);
});

test('availability keeps an explicit reason and all provenance inside a short collapsed section', async () => {
  const report = makeAvailabilityReport({ identity, availability: { reason: 'measurement-bootstrap-unavailable', artifactId: 9, artifactSha256: 'f'.repeat(64) } });
  const [primary, details] = report.markdown.split('<details>');
  assert(primary.includes('⚪ Measurement setup unavailable'));
  assert(!primary.includes('0.0%'));
  assert(!primary.includes(identity.baseSha));
  assert(details.includes(identity.baseSha));
  assert(details.includes('/artifacts/9'));
  assert(details.includes('f'.repeat(64)));
  const { api, state } = fakeOriginApi();
  const result = await publishOrigin({ api, context, expectedPrNumber: 7 });
  assert.equal(result.status, 'created');
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
    assert(result.markdown.includes(`/commit/${HARNESS_SHA}`));
    assert(result.markdown.includes('⚪ Browser/GPU: 5 metrics unsupported.'));
    assert(result.markdown.includes('Raw measurements / p95 / noise'));
    const [primary, details] = result.markdown.split('<details>');
    assert(!primary.includes('SHA-256'));
    assert(details.includes('archive SHA-256'));
    assert(details.includes('/artifacts/9'));
    assert(result.markdown.endsWith('</details>'));
  });
}
