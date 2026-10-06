import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHomeBoxAdapter } from '../src/index.mjs';
import { reg, baseline, fakeTransport, options, assertPriorUnchanged } from './support.mjs';

const previous = () => ({ cache: structuredClone(baseline.caches[0]), homeboxEntities: structuredClone(baseline.homeboxEntities.filter(p => p.homeId === reg.homeId)) });
async function assertTimeout(transport, extra = {}) {
  const p = previous(), before = structuredClone(p);
  const result = await createHomeBoxAdapter({ ...options(transport), limits: { requestTimeoutMs: 5, generationTimeoutMs: 1000 }, ...extra }).fetchGeneration({ previous: p });
  assertPriorUnchanged(assert, before, result, p);
  assert.equal(result.cache.error.code, 'timeout');
  assert.equal(result.replaceCache, false);
  return result;
}

test('request deadline rejects timer-starving valid stream completion', async () => {
  const normal = fakeTransport().transport;
  let first = true, elapsed = 0, requestSignal;
  const transport = async request => {
    const response = await normal(request);
    if (!first) return response;
    first = false; requestSignal = request.signal;
    return { ...response, body: (async function* () {
      const began = performance.now();
      yield new TextEncoder().encode(response.body);
      const deadline = performance.now() + 40;
      while (performance.now() < deadline) await Promise.resolve();
      elapsed = performance.now() - began;
    })() };
  };
  await assertTimeout(transport);
  assert.ok(elapsed >= 40);
  assert.equal(requestSignal.aborted, true);
  // The unchanged byte content succeeds when it is delivered within the deadline.
  assert.equal((await createHomeBoxAdapter(options(normal)).fetchGeneration()).ok, true);
});

test('request deadline covers transport resolution when timers have not fired', async () => {
  let elapsed = 0, signal;
  const normal = fakeTransport().transport;
  const transport = async request => { signal = request.signal; const response = await normal(request); elapsed += 6; return response; };
  await assertTimeout(transport, { monotonicClock: () => elapsed });
  assert.equal(signal.aborted, true);
});

test('request deadline covers UTF-8 decoding before successful return', async () => {
  let elapsed = 0;
  const original = globalThis.TextDecoder;
  globalThis.TextDecoder = class extends original {
    decode(...args) { const text = super.decode(...args); elapsed += 6; return text; }
  };
  try { await assertTimeout(fakeTransport().transport, { monotonicClock: () => elapsed }); }
  finally { globalThis.TextDecoder = original; }
});

test('request deadline covers retrieval bookkeeping before successful return', async () => {
  let elapsed = 0, calls = 0;
  await assertTimeout(fakeTransport().transport, {
    monotonicClock: () => elapsed,
    clock: () => { if (calls++ > 0) elapsed += 6; return '2026-10-06T10:00:00.000Z'; }
  });
});

async function assertSameGeneration(transport) {
  const control = await createHomeBoxAdapter(options(fakeTransport().transport)).fetchGeneration();
  const result = await createHomeBoxAdapter(options(transport)).fetchGeneration();
  assert.equal(control.ok, true); assert.equal(result.ok, true);
  assert.deepEqual(result.homeboxEntities, control.homeboxEntities);
  assert.deepEqual(result.cache, control.cache);
  assert.deepEqual(result.stats, control.stats);
}

test('reused Uint8Array chunks preserve successful generation bytes', async () => {
  const normal = fakeTransport().transport;
  await assertSameGeneration(async request => {
    const response = await normal(request);
    return { ...response, body: (function* () {
      const scratch = new Uint8Array(1);
      for (const byte of new TextEncoder().encode(response.body)) { scratch[0] = byte; yield scratch; }
      scratch.fill(0);
    })() };
  });
});

test('reused Buffer chunks preserve successful generation bytes', async () => {
  const normal = fakeTransport().transport;
  await assertSameGeneration(async request => {
    const response = await normal(request);
    return { ...response, body: (async function* () {
      const scratch = Buffer.alloc(8), bytes = new TextEncoder().encode(response.body);
      for (let offset = 0; offset < bytes.length; offset += scratch.length) {
        const count = Math.min(scratch.length, bytes.length - offset);
        scratch.set(bytes.subarray(offset, offset + count));
        yield scratch.subarray(0, count);
        scratch.fill(0);
      }
    })() };
  });
});
