import assert from 'node:assert/strict';
import test from 'node:test';
import { cell, compareMetric, median, renderTable, summarize } from './compare.mjs';

const timing = { id: 'latency', label: 'Synthetic latency', unit: 'ms', kind: 'timing', direction: 'lower' };
const values = samples => ({ samples });
test('median and MAD report all samples without claiming confidence', () => {
  assert.equal(median([10, 1, 4, 2]), 3);
  assert.deepEqual(summarize([2, 2, 2, 2, 100]), { value: 2, count: 5, noisePercent: 0 });
  assert.throws(() => summarize([NaN]));
  assert.throws(() => summarize([-1]));
  assert.throws(() => summarize([]));
});
test('both directions and zero baselines have defined comparisons', () => {
  const base = values([100, 100, 100, 100, 100]), head = values([80, 80, 80, 80, 80]);
  assert.equal(compareMetric(timing, base, head).status, 'improved');
  assert.equal(compareMetric({ ...timing, direction: 'higher' }, base, head).status, 'degraded');
  assert.equal(compareMetric(timing, values([0]), head).deltaPercent, null);
  assert.equal(compareMetric(timing, values([0]), values([0])).deltaPercent, 0);
});
test('timings never fail a budget and display noise and insufficient samples', () => {
  assert.equal(compareMetric(timing, values([100, 100, 100, 100, 100]), values([99, 99, 99, 99, 99])).status, 'within-noise');
  const result = compareMetric({ ...timing, maximum: 1 }, values([1]), values([100]));
  assert.equal(result.failed, false);
  assert.equal(result.status, 'insufficient-samples');
});
test('deterministic absolute and relative budgets fail independently', () => {
  const policy = { ...timing, kind: 'deterministic', maximum: 120, maxRegressionPercent: 10 };
  assert.equal(compareMetric(policy, values([100]), values([111])).failed, true);
  assert.equal(compareMetric({ ...policy, maxRegressionPercent: undefined }, values([100]), values([121])).failed, true);
  assert.equal(compareMetric(policy, values([100]), values([110])).failed, false);
  assert.equal(compareMetric(policy, values([100, 101]), values([100])).reason, 'deterministic-samples-disagree');
});
test('missing and skipped metrics stay visible', () => {
  assert.equal(compareMetric(timing, null, values([1])).reason, 'metric-unavailable');
  const result = compareMetric(timing, { skipReason: 'baseline-unavailable' }, values([1]));
  assert.equal(result.status, 'skipped');
  const table = renderTable([timing], [result]);
  assert.match(table, /baseline-unavailable/);
  assert.match(table, /lower is better/);
});
test('Markdown cells cannot create rows, images, links or mentions', () => {
  const external = 'x | [click](https://x) ![img](https://x) @everyone <img> `code`\nnext';
  const escaped = cell(external);
  for (const character of ['|', '[', ']', '!', '@', '<', '>', '`', '\n']) assert(!escaped.includes(character));
});
