import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareRuns } from './adapter.mjs';
import { runCli } from './cli.mjs';

const identity = { repository: 'example/HouseAtlas', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), baseTree: 'c'.repeat(40), headTree: 'd'.repeat(40), harnessSha: 'e'.repeat(40), prNumber: 1, runId: 2, runAttempt: 1 };
// Fake normalized views only: these are not a second wire-schema fixture.
const view = side => ({ sourceCommit: identity[`${side}Sha`], sourceTree: identity[`${side}Tree`], dirty: false,
  harnessCommit: identity.harnessSha, schemaSha256: 'f'.repeat(64), fixtureFingerprint: '1'.repeat(64), comparisonFingerprint: '2'.repeat(64),
  metrics: [{ id: 'latency', status: 'measured', samples: Array(5).fill(side === 'base' ? 100 : 75) }] });
const contract = { schemaSha256: 'f'.repeat(64), validateRun: value => !!value && typeof value === 'object', reportView: value => value,
  policies: [{ id: 'latency', label: 'Synthetic latency', unit: 'ms', direction: 'lower', kind: 'timing' }] };
const run = (baseRun = view('base'), headRun = view('head')) => compareRuns({ identity, baseRun, headRun, contract });
test('adapter computes p95 and retains full identities and comparability fingerprints', () => {
  const result = run();
  assert.equal(result.comparisons[0].deltaPercent, -25);
  assert.equal(result.comparisons[0].head.p95, 75);
  for (const text of [identity.baseTree, identity.headTree, contract.schemaSha256, '1'.repeat(64), '2'.repeat(64)]) assert(result.markdown.includes(text));
});
test('new base feature is unsupported rather than a zero or speedup', () => {
  const base = view('base');
  base.metrics = [{ id: 'latency', status: 'unsupported' }];
  const row = run(base).comparisons[0];
  assert.equal(row.reason, 'base-unsupported');
  assert.equal(row.base, null);
  assert.equal(row.head.value, 75);
  assert.equal(row.deltaPercent, null);
});
test('fixture, method or environment mismatch suppresses arithmetic', () => {
  for (const field of ['fixtureFingerprint', 'comparisonFingerprint']) {
    const base = { ...view('base'), [field]: '3'.repeat(64) };
    const row = run(base).comparisons[0];
    assert.equal(row.status, 'skipped');
    assert.equal(row.deltaPercent, null);
  }
});
test('wrong commit/tree/harness/schema, dirty sources and malformed statuses fail closed', () => {
  for (const patch of [{ sourceCommit: '0'.repeat(40) }, { sourceTree: '0'.repeat(40) }, { harnessCommit: '0'.repeat(40) },
    { dirty: true }, { schemaSha256: '0'.repeat(64) }, { metrics: [{ id: 'latency', status: 'stage-marker' }] },
    { metrics: [{ id: 'latency', status: 'unsupported', samples: [0] }] }]) assert.throws(() => run({ ...view('base'), ...patch }));
});
test('failed and blocked metric statuses are explicit and absent samples are never zeros', () => {
  for (const status of ['failed', 'blocked']) {
    const head = { ...view('head'), metrics: [{ id: 'latency', status }] };
    const result = run(view('base'), head);
    assert.equal(result.comparisons[0].reason, `head-${status}`);
    assert.equal(result.comparisons[0].head, null);
    assert.equal(result.failed, status === 'failed');
    assert(result.markdown.includes(status === 'failed' ? 'head-failed; FAIL' : 'head-blocked; informational'));
  }
});
test('CLI writes new Markdown and machine comparison using the owner validator', () => {
  const directory = mkdtempSync(join(tmpdir(), 'houseatlas-report-cli-'));
  try {
    const file = name => join(directory, name);
    for (const [name, value] of [['base.json', view('base')], ['head.json', view('head')], ['identity.json', identity]]) writeFileSync(file(name), JSON.stringify(value));
    const args = ['--base', file('base.json'), '--head', file('head.json'), '--identity', file('identity.json'), '--markdown', file('report.md'), '--comparison', file('comparison.json')];
    assert.equal(runCli(args, contract), 0);
    assert.match(readFileSync(file('report.md'), 'utf8'), /-25%/);
    assert.equal(JSON.parse(readFileSync(file('comparison.json'))).comparisons[0].head.p95, 75);
    assert.throws(() => runCli(args, contract)); // Existing evidence is never overwritten.
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
