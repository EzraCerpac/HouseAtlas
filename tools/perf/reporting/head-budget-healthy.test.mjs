// Valid normalized measurements and trusted policies only; no collection or API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMetric } from './compare.mjs';
import { makeReport } from './report.mjs';

const policy = { id: 'example.asset.bytes', label: 'Generated asset bytes', unit: 'bytes', kind: 'deterministic', direction: 'lower' };
const unavailable = { skipReason: 'base-unsupported' };
const measured = value => ({ samples: [value] });

test('valid measured head retains absolute maximum and minimum budgets with an unsupported base', () => {
  for (const [budget, value] of [[{ maximum: 100 }, 120], [{ minimum: 100 }, 80]]) {
    const row = compareMetric({ ...policy, ...budget }, unavailable, measured(value));
    assert.equal(row.failed, true);
    assert.equal(row.status, 'skipped');
    assert.equal(row.reason, 'base-unsupported');
    assert.equal(row.base, null);
    assert.equal(row.head.value, value);
    assert.equal(row.deltaAbsolute, null);
    assert.equal(row.deltaPercent, null);
    assert.equal(row.deltaPercentStatus, 'unavailable');
  }
});

test('valid measured head at its exact absolute bounds passes without a baseline', () => {
  for (const direction of ['lower', 'higher']) {
    const row = compareMetric({ ...policy, direction, maximum: 100, minimum: 100 }, unavailable, measured(100));
    assert.equal(row.failed, false);
    assert.equal(row.head.value, 100);
    assert.equal(row.deltaPercentStatus, 'unavailable');
  }
});

test('accepted unavailable states do not invent a relative budget or a head observation', () => {
  const relative = compareMetric({ ...policy, maxRegressionPercent: 5 }, unavailable, measured(120));
  assert.equal(relative.failed, false);
  assert.equal(relative.deltaPercent, null);
  const absent = compareMetric({ ...policy, maximum: 100 }, measured(120), { skipReason: 'head-unsupported' });
  assert.equal(absent.failed, false);
  assert.equal(absent.head, null);
  const timing = compareMetric({ ...policy, kind: 'timing', unit: 'ms', maximum: 100 }, unavailable, measured(120));
  assert.equal(timing.failed, false);
});

test('valid report retains an unavailable comparison and marks its absolute head-budget failure', () => {
  const identity = { repository: 'Example/Generated', prNumber: 1, runId: 1, runAttempt: 1,
    baseSha: '1'.repeat(40), headSha: '2'.repeat(40), baseTree: '3'.repeat(40), headTree: '4'.repeat(40), harnessSha: '5'.repeat(40) };
  const result = makeReport({ identity, policies: [{ ...policy, maximum: 100 }],
    base: new Map([[policy.id, unavailable]]), head: new Map([[policy.id, measured(120)]]) });
  assert.equal(result.failed, true);
  assert.equal(result.comparisons[0].status, 'skipped');
  assert.equal(result.comparisons[0].deltaPercentStatus, 'unavailable');
  assert(result.markdown.includes('**❌ Budget or measurement failed.**'));
  assert(result.markdown.includes('120 B'));
  assert(result.markdown.includes('base unsupported; ❌ failed'));
});
