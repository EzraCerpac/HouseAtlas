import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { PROFILE } from './fixtures.mjs';

export function summary(samples) {
  assert(samples.length > 0 && samples.every(value => Number.isFinite(value) && value >= 0));
  const sorted = [...samples].sort((a, b) => a - b);
  const median = values => values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  const center = median(sorted);
  return { count: samples.length, median: center, p95: sorted[Math.ceil(sorted.length * .95) - 1],
    mad: median(samples.map(value => Math.abs(value - center)).sort((a, b) => a - b)), min: sorted[0], max: sorted.at(-1) };
}
export const row = (id, unit, samples) => ({ id, status: 'measured', unit, samples, summary: summary(samples) });

/** Only fn is timed; compilation, fixtures, validation and profiling are outside. */
export async function timing(id, fn, check) {
  for (let i = 0; i < PROFILE.warmups; i++) check(await fn());
  const samples = [];
  for (let i = 0; i < PROFILE.repetitions; i++) {
    const start = performance.now(), value = await fn();
    samples.push(performance.now() - start);
    check(value);
  }
  return row(id, 'ms', samples);
}

export function sampledBytes(node) {
  return node.selfSize + node.children.reduce((sum, child) => sum + sampledBytes(child), 0);
}

/** V8's statistical JS allocation estimate, including collected objects.
 * This is not total allocated bytes, peak memory, RSS, native buffers or GPU.
 * No call stacks/source text are emitted. The inspector is local, no port. */
export async function allocations(id, fn, check) {
  const session = new Session(), samples = [], sampleCounts = [], snapshots = [];
  session.connect();
  try {
    for (let i = 0; i < PROFILE.allocationRepetitions; i++) {
      globalThis.gc();
      const before = process.memoryUsage();
      await session.post('HeapProfiler.startSampling', { samplingInterval: PROFILE.samplingInterval,
        includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      let value, profile;
      try { value = await fn(); }
      finally { ({ profile } = await session.post('HeapProfiler.stopSampling')); }
      check(value);
      samples.push(sampledBytes(profile.head)); sampleCounts.push(profile.samples.length);
      globalThis.gc();
      const after = process.memoryUsage();
      snapshots.push({ before, after, delta: Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]])) });
      value = null;
    }
  } finally { session.disconnect(); }
  return { ...row(id, 'sampled-js-bytes', samples), sampleCounts, snapshots };
}
