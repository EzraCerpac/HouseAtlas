import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function compare(base, candidate) {
  for (const report of [base, candidate]) {
    assert.equal(report.format, 'houseatlas-host-client/1');
    assert.equal(report.mode, 'measure');
    assert.equal(report.provenance.profile, 'release');
    assert.match(report.provenance.sourceSha, /^[a-f0-9]{40}$/);
    assert.match(report.binarySha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof report.measurementDriverSha256, 'string', 'Measurement driver identity required');
    assert.match(report.measurementDriverSha256, /^[a-f0-9]{64}$/, 'Measurement driver identity required');
    assert(report.cohorts.length > 0, 'Missing cohorts');
    for (const row of report.cohorts) {
      assert(row.summary.attempted > 0, 'Empty cohort');
      assert.equal(row.samples.length, row.summary.attempted, 'Raw sample count differs');
    }
  }
  assert.notEqual(base.provenance.sourceSha, candidate.provenance.sourceSha, 'Different source commits required');
  assert.equal(base.provenance.runnerId, candidate.provenance.runnerId, 'Use the same runner allocation');
  assert.deepEqual(base.runner, candidate.runner, 'Runner and runtime context differ');
  assert.equal(base.clientBundleSha256, candidate.clientBundleSha256, 'Use identical production adapter bundle bytes');
  assert.equal(base.measurementDriverSha256, candidate.measurementDriverSha256, 'Use identical complete measurement driver bytes');
  assert.deepEqual(base.limits, candidate.limits, 'Offered load differs');
  assert.equal(base.generatedAssetBytes, candidate.generatedAssetBytes);
  assert.deepEqual(base.cohorts.map(row => row.name), candidate.cohorts.map(row => row.name));
  return {
    format: 'houseatlas-host-client-comparison/1',
    base: base.provenance.sourceSha, candidate: candidate.provenance.sourceSha,
    qualification: 'Same-runner descriptive release comparison; no significance, device or production claim',
    cohorts: base.cohorts.map((left, index) => {
      const right = candidate.cohorts[index];
      assert.deepEqual(left.context, right.context, 'Cohort context differs');
      assert.equal(left.summary.attempted, right.summary.attempted, 'Sample counts differ');
      return { name: left.name, base: left.summary, candidate: right.summary,
        qualified: !left.summary.generator.saturation && !right.summary.generator.saturation
          && left.summary.errors === 0 && right.summary.errors === 0
          && left.summary.timeouts === 0 && right.summary.timeouts === 0
          && left.summary.cancelled === 0 && right.summary.cancelled === 0,
        deltas: Object.fromEntries(['p50Ms', 'p95Ms', 'p99Ms', 'requestsPerSecond', 'successfulBytesPerSecond'].map(key => {
          const a = left.summary[key], b = right.summary[key];
          return [key, a === null || b === null || a === 0 ? null : (b - a) / a * 100];
        })) };
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  assert.equal(process.argv.length, 4, 'Supply base.json candidate.json');
  const reports = process.argv.slice(2).map(path => {
    const bytes = readFileSync(path);
    assert(bytes.length <= 4 << 20, 'Report byte limit');
    return JSON.parse(bytes);
  });
  console.log(JSON.stringify(compare(...reports), null, 2));
}
