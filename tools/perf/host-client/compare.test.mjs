import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare } from './compare.mjs';

function report(sourceSha) {
  return { format: 'houseatlas-host-client/1', mode: 'measure', binarySha256: 'a'.repeat(64),
    clientBundleSha256: 'b'.repeat(64), measurementDriverSha256: 'c'.repeat(64), provenance: { profile: 'release', sourceSha, runnerId: 'same-allocation' },
    runner: { node: 'v26.10.0' }, limits: { rate: 10 }, generatedAssetBytes: 100,
    cohorts: [{ name: 'warm', context: { cache: 'no-store' }, samples: [{}],
      summary: { attempted: 1, completed: 1, errors: 0, timeouts: 0, cancelled: 0,
        p50Ms: null, p95Ms: null, p99Ms: null, requestsPerSecond: 1, successfulBytesPerSecond: 100,
        generator: { saturation: false } } }] };
}
test('comparison rejects unequal runner, adapter, load, contexts and empty results', () => {
  const base = report('1'.repeat(40)), candidate = report('2'.repeat(40));
  assert.equal(compare(base, candidate).cohorts[0].qualified, true);
  for (const mutate of [
    row => { row.provenance.runnerId = 'other-allocation'; },
    row => { row.clientBundleSha256 = 'c'.repeat(64); },
    row => { row.limits.rate = 9; },
    row => { row.cohorts[0].context.cache = 'cached'; },
    row => { row.cohorts = []; },
    row => { row.cohorts[0].summary.attempted = 0; },
  ]) {
    const changed = structuredClone(candidate); mutate(changed);
    assert.throws(() => compare(base, changed));
  }
});
test('same adapter cannot qualify unequal or missing measurement driver identity', () => {
  const base = report('1'.repeat(40)), candidate = report('2'.repeat(40));
  assert.equal(base.clientBundleSha256, candidate.clientBundleSha256);
  candidate.measurementDriverSha256 = 'd'.repeat(64);
  assert.throws(() => compare(base, candidate), /complete measurement driver/);
  delete candidate.measurementDriverSha256;
  assert.throws(() => compare(base, candidate), /Measurement driver identity required/);
});

test('saturation and errors prevent a qualified comparison; sparse tails stay null', () => {
  const base = report('1'.repeat(40)), candidate = report('2'.repeat(40));
  candidate.cohorts[0].summary.generator.saturation = true;
  const result = compare(base, candidate).cohorts[0];
  assert.equal(result.qualified, false); assert.equal(result.deltas.p99Ms, null);
  candidate.cohorts[0].summary.generator.saturation = false;
  candidate.cohorts[0].summary.errors = 1;
  assert.equal(compare(base, candidate).cohorts[0].qualified, false);
});

test('comparison CLI executes from a path containing spaces and rejects missing arguments', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas compare path '));
  try {
    const script = join(scratch, 'compare with spaces.mjs');
    writeFileSync(script, readFileSync(new URL('./compare.mjs', import.meta.url)));
    const base = join(scratch, 'base report.json'), candidate = join(scratch, 'candidate report.json');
    writeFileSync(base, JSON.stringify(report('1'.repeat(40))));
    writeFileSync(candidate, JSON.stringify(report('2'.repeat(40))));
    const execute = args => spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    const compared = execute([base, candidate]);
    assert.equal(compared.error, undefined); assert.equal(compared.status, 0, compared.stderr);
    const result = JSON.parse(compared.stdout);
    assert.equal(result.format, 'houseatlas-host-client-comparison/1');
    assert.equal(result.cohorts[0].qualified, true);
    const missing = execute([]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Supply base.json candidate.json/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
