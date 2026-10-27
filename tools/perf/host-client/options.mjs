import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export function options(args) {
  const [mode, ...rest] = args;
  assert(['contract', 'faults', 'measure'].includes(mode), 'Select contract, faults or measure');
  assert.equal(rest.length % 2, 0, 'Options require values');
  const values = new Map();
  const allowed = new Set(['--binary', '--provenance', '--samples', '--rate', '--concurrency', '--deadline-ms']);
  for (let i = 0; i < rest.length; i += 2) {
    assert(allowed.has(rest[i]) && !values.has(rest[i]), 'Unknown or repeated option');
    values.set(rest[i], rest[i + 1]);
  }
  const integer = (key, fallback, max) => {
    const value = values.get(key) ?? String(fallback);
    assert(/^[1-9][0-9]*$/.test(value), 'Expected positive integer: ' + key);
    const number = Number(value);
    assert(Number.isSafeInteger(number) && number <= max, 'Limit exceeded: ' + key);
    return number;
  };
  const result = {
    mode, binary: values.get('--binary'), provenance: values.get('--provenance'),
    samples: integer('--samples', 30, 200), rate: integer('--rate', 10, 10),
    concurrency: integer('--concurrency', 1, 4), deadlineMs: integer('--deadline-ms', 45000, 60000),
  };
  assert(result.binary, 'Supply --binary; no build or external fallback');
  if (mode === 'measure') assert(result.provenance, 'Measurements require --provenance');
  return result;
}

export function summarize(samples, elapsedMs, generator) {
  const complete = samples.filter(row => row.outcome === 'ok');
  const values = complete.map(row => row.elapsedMs).sort((a, b) => a - b);
  // Nearest-rank empirical quantiles. Sparse tails stay explicitly unestimated.
  const quantile = (p, minimum) => values.length >= minimum
    ? values[Math.ceil(values.length * p) - 1] : null;
  return {
    attempted: samples.length, completed: values.length,
    errors: samples.filter(row => row.outcome === 'error').length,
    timeouts: samples.filter(row => row.outcome === 'timeout').length,
    cancelled: samples.filter(row => row.outcome === 'cancelled').length,
    p50Ms: quantile(0.50, 2), p95Ms: quantile(0.95, 20), p99Ms: quantile(0.99, 100),
    quantileMethod: 'empirical nearest-rank; p50 n>=2, p95 n>=20, p99 n>=100; descriptive, no confidence claim',
    elapsedMs, requestsPerSecond: values.length * 1000 / elapsedMs,
    transferredBytesPerSecond: samples.reduce((sum, row) => sum + row.bytes, 0) * 1000 / elapsedMs,
    successfulBytesPerSecond: complete.reduce((sum, row) => sum + row.bytes, 0) * 1000 / elapsedMs,
    generator,
  };
}

// One global reservation clock survives cohort changes. ready() waits out an
// existing cooldown without consuming a request slot or resetting the bound.
// Injectable clocks exercise this scheduler with no listener or real sleeps.
export function createPacer(rate, now = () => performance.now(),
  sleep = (ms, signal) => delay(ms, undefined, { signal })) {
  assert(Number.isInteger(rate) && rate >= 1 && rate <= 10);
  let nextStart = 0, tail = Promise.resolve();
  function schedule(reserve, signal) {
    const turn = tail.then(async () => {
      signal?.throwIfAborted();
      while (now() < nextStart) {
        await sleep(nextStart - now(), signal);
        signal?.throwIfAborted();
      }
      const at = now();
      if (reserve) nextStart = at + 1000 / rate;
      return at;
    });
    tail = turn.catch(() => {});
    return turn;
  }
  return { wait: signal => schedule(true, signal), ready: signal => schedule(false, signal) };
}
export async function beginCohort(transport, reuse, now = () => performance.now()) {
  // Establish the cohort epoch only after the transport's carried cooldown.
  await transport.ready();
  transport.connection(reuse);
  return now();
}
