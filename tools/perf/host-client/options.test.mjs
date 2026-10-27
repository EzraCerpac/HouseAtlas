import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { measurementDriverIdentity, measurementDriverPaths } from './driver-identity.mjs';
import { options, summarize } from './options.mjs';

test('explicit cohort selection and resource limits fail closed', () => {
  for (const args of [[], ['anything'], ['contract'], ['contract', '--binary'],
    ['contract', '--binary', 'x', '--wat', '1'], ['contract', '--binary', 'x', '--samples', '0'],
    ['contract', '--binary', 'x', '--rate', '11'], ['contract', '--binary', 'x', '--concurrency', '5'],
    ['contract', '--binary', 'x', '--deadline-ms', '60001'], ['measure', '--binary', 'x'],
    ['contract', '--binary', 'x', '--rate', '1', '--rate', '2']]) {
    assert.throws(() => options(args), undefined, args.join(' '));
  }
  const selected = options(['measure', '--binary', 'x', '--provenance', 'p', '--concurrency', '4']);
  assert.equal(selected.rate, 10); assert.equal(selected.samples, 30); assert.equal(selected.deadlineMs, 45000);
});

test('raw sample counts qualify empirical tails and retain errors', () => {
  const sample = (n, outcome = 'ok') => ({ elapsedMs: n, bytes: 10, outcome });
  const short = summarize([sample(2), sample(4), sample(5, 'timeout'), sample(6, 'error')], 1000, {});
  assert.equal(short.p50Ms, 2); assert.equal(short.p95Ms, null); assert.equal(short.p99Ms, null);
  assert.equal(short.errors, 1); assert.equal(short.timeouts, 1);
  assert.equal(short.successfulBytesPerSecond, 20); assert.equal(short.transferredBytesPerSecond, 40);
  const full = summarize(Array.from({ length: 100 }, (_, i) => sample(i + 1)), 1000, {});
  assert.equal(full.p50Ms, 50); assert.equal(full.p95Ms, 95); assert.equal(full.p99Ms, 99);
  assert.equal(summarize([], 1000, {}).p50Ms, null);
});

test('fingerprint covers every runtime source, including pacing, timing, fixture and launcher', () => {
  for (const filename of ['run.mjs', 'options.mjs', 'transport.mjs', 'fixture.mjs', 'driver-identity.mjs', 'compare.mjs']) {
    assert(measurementDriverPaths.includes('tools/perf/host-client/' + filename));
  }
  assert(measurementDriverPaths.includes('.mise/tasks/perf-host-client'));
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-driver-identity-'));
  try {
    for (const path of measurementDriverPaths) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), 'synthetic source\n');
    }
    const baseline = measurementDriverIdentity(scratch);
    assert.deepEqual(measurementDriverIdentity(scratch), baseline);
    for (const path of measurementDriverPaths) {
      const original = readFileSync(join(scratch, path));
      writeFileSync(join(scratch, path), Buffer.concat([original, Buffer.from('changed\n')]));
      assert.notEqual(measurementDriverIdentity(scratch).sha256, baseline.sha256, path);
      writeFileSync(join(scratch, path), original);
    }
    assert.deepEqual(measurementDriverIdentity(scratch), baseline);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
