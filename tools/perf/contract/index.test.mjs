import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { policies, reportView, schemaSha256, summarize, validateRun } from './index.mjs';
import { exampleRun, measured } from './test-fixture.mjs';

test('schema hash is exact bytes and policy ids match the measured schema', () => {
  const bytes = readFileSync(new URL('./run.schema.json', import.meta.url)), schema = JSON.parse(bytes);
  assert.equal(schemaSha256, createHash('sha256').update(bytes).digest('hex'));
  const variants = schema.properties.metrics.items.oneOf;
  assert.deepEqual(variants[1].properties.id.enum, policies.map(row => row.id));
  assert(policies.every(row => !['maximum','minimum','maxRegressionPercent'].some(key => Object.hasOwn(row, key))));
});

test('sample summaries use median, nearest rank p95 and median absolute deviation', () => {
  assert.deepEqual(summarize([9,1,8,2,7,3,6,4,5]), { count:9,median:5,p95:9,mad:2,min:1,max:9 });
  assert.equal(summarize([1,2]).median, 1.5);
  for (const samples of [[],[-1],[NaN],[Infinity],[Number.MAX_SAFE_INTEGER + 1],Array(1001).fill(1)]) assert.throws(() => summarize(samples));
});

test('closed run accepts measured/nonmeasured rows and cannot accept invented browser samples', () => {
  const run = exampleRun(); assert(validateRun(run));
  const invalid = [
    value => { value.extra = 'not part of the wire'; },
    value => { value.source.files.push({ path:'frontend/../private.bin',sha256:'0'.repeat(64) }); },
    value => { value.metrics.push(value.metrics[0]); },
    value => { value.metrics[0].id = 'invented.metric'; },
    value => { value.metrics[0].summary.p95++; },
    value => { value.metrics[0].samples.pop(); value.metrics[0].summary = summarize(value.metrics[0].samples); },
    value => { value.metrics[0].samples[0] = Infinity; },
    value => { value.metrics[0].unit = 'artifact-owned policy'; },
    value => { value.metrics[0] = { id:value.metrics[0].id,status:'failed',reason:'raw error with a source path' }; },
    value => { value.metrics[0] = { id:value.metrics[0].id,status:'blocked',reason:'dependency-unavailable',samples:[0] }; },
    value => { value.metrics[value.metrics.length-1] = measured('browser.live_gpu_bytes',[0]); },
    value => { value.harness.schemaSha256 = '0'.repeat(64); },
    value => { value.profile.warmups = 4; },
  ];
  for (const change of invalid) { const value = structuredClone(run); change(value); assert.equal(validateRun(value), false); }
  for (const status of ['unsupported','blocked','failed']) {
    const value = structuredClone(run); value.metrics[0] = { id:value.metrics[0].id,status,reason:'feature-not-present' }; assert(validateRun(value));
  }
});

test('fingerprints exclude changing product source and observations but cover method/environment and ordered fixture bytes', () => {
  const run = exampleRun(), before = reportView(run);
  const changed = structuredClone(run);
  changed.source.commit = changed.source.after.commit = '7'.repeat(40);
  changed.source.tree = changed.source.after.tree = '8'.repeat(40);
  changed.source.files = [{ path:'frontend/src/main.tsx',sha256:'9'.repeat(64) }];
  changed.metrics[0] = measured(changed.metrics[0].id,Array(9).fill(4));
  const next = reportView(changed);
  assert.notEqual(next.sourceCommit,before.sourceCommit);
  assert.equal(next.comparisonFingerprint,before.comparisonFingerprint);
  assert.equal(next.fixtureFingerprint,before.fixtureFingerprint);
  changed.environment.runtime.v8 = 'another-v8';
  assert.notEqual(reportView(changed).comparisonFingerprint,before.comparisonFingerprint);
  changed.fixtures.reverse();
  assert.notEqual(reportView(changed).fixtureFingerprint,before.fixtureFingerprint);
  changed.fixtures.reverse(); changed.fixtures[0].sha256 = '0'.repeat(64);
  assert.notEqual(reportView(changed).fixtureFingerprint,before.fixtureFingerprint);
});

test('dirty/changing source stays explicit and dirty/changing harness cannot enter reporting', () => {
  const run = exampleRun();
  for (const change of [value => { value.source.dirty = true; },value => { value.source.after.tree = '0'.repeat(40); }]) {
    const value = structuredClone(run); change(value); assert(validateRun(value)); assert.equal(reportView(value).dirty,true);
  }
  for (const change of [value => { value.harness.dirty = true; },value => { value.harness.after.commit = '0'.repeat(40); },value => { value.harness.after.filesSha256 = '0'.repeat(64); }]) {
    const value = structuredClone(run); change(value); assert(validateRun(value)); assert.throws(() => reportView(value));
  }
});

test('missing known metrics remain missing for the reporting owner to label explicitly', () => {
  const run = exampleRun(); run.metrics = [];
  assert(validateRun(run)); assert.deepEqual(reportView(run).metrics,[]);
});
