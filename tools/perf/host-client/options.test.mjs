import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { measurementDriverIdentity, measurementDriverPaths } from './driver-identity.mjs';
import { beginCohort, createPacer, options, summarize } from './options.mjs';
import { mcpContract } from './mcp-contract.mjs';

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
  for (const filename of ['run.mjs', 'options.mjs', 'transport.mjs', 'fixture.mjs', 'driver-identity.mjs', 'compare.mjs', 'mcp-contract.mjs']) {
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

test('cohort epoch waits for carried pacing cooldown without resetting the global rate', async () => {
  let now = 0;
  const starts = [], clientLatencies = [];
  const pacer = createPacer(2, () => now, async ms => { now += ms; });
  await pacer.wait(); starts.push(now);
  now += 2; // preceding cohort's fast synthetic exchange
  let connectionAt;
  const transport = { ready: pacer.ready, connection() { connectionAt = now; } };
  const epoch = await beginCohort(transport, true, () => now);
  assert.equal(epoch, 500); assert.equal(connectionAt, 500);
  for (let index = 0; index < 3; index++) {
    now = Math.max(now, epoch + index * 500);
    const begin = now;
    await pacer.wait(); starts.push(now);
    now += 2;
    clientLatencies.push(now - begin);
  }
  assert.deepEqual(starts, [0, 500, 1000, 1500]);
  assert.deepEqual(clientLatencies, [2, 2, 2]);
  // Alignment itself consumes no reservation, including repeated readiness.
  now += 1;
  await pacer.ready(); const aligned = now;
  await pacer.ready(); assert.equal(now, aligned);
  await pacer.wait(); assert.equal(now, aligned);
});

test('MCP contract signs in the generated editor and sends current CSRF on every POST', async () => {
  const credentials = { username: 'synthetic-editor', password: 'synthetic-only' };
  const scope = { workspaceId: 'synthetic-workspace', homeId: 'synthetic-home' };
  const signal = new AbortController().signal, calls = [];
  let signedIn = false, canonicalSessionRead = false;
  const session = {
    async signIn(input, receivedSignal) {
      assert.equal(input, credentials); assert.equal(receivedSignal, signal);
      signedIn = true;
      return { csrfToken: 'earlier-token' };
    },
    async session(receivedSignal) {
      assert(signedIn); assert.equal(receivedSignal, signal);
      canonicalSessionRead = true;
      return { csrfToken: 'current-token' };
    },
  };
  const transport = { async fetch(path, init) {
    assert(signedIn && canonicalSessionRead);
    assert.equal(path, '/api/atlas/mcp/workspaces/synthetic-workspace/homes/synthetic-home');
    assert.equal(init.method, 'POST'); assert.equal(init.signal, signal);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-Atlas-CSRF'), 'current-token');
    const message = JSON.parse(init.body); calls.push(message.method);
    if (message.method === 'initialize') {
      assert.equal(headers.get('MCP-Session-Id'), null);
      return new Response(JSON.stringify({ result: { protocolVersion: '2025-11-25' } }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'synthetic-session' },
      });
    }
    assert.equal(headers.get('MCP-Session-Id'), 'synthetic-session');
    if (message.method === 'notifications/initialized') return new Response('', { status: 202 });
    assert.equal(message.method, 'tools/list');
    const names = ['atlas_bindings', 'atlas_media_geometry', 'atlas_records', 'homebox_entities_locations'];
    return new Response(JSON.stringify({ result: { tools: names.map(name => ({ name })) } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } };
  await mcpContract({ transport, session, editorLogin: credentials, scope, signal });
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/list']);
});
