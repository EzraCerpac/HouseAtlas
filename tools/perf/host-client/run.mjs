import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { options, summarize } from './options.mjs';
import { asset, assetPath, databaseCounts, fixture, sha256 } from './fixture.mjs';

const config = options(process.argv.slice(2));
// Any accidental unbound production transport fails instead of reaching out.
globalThis.fetch = () => { throw new Error('Unbound fetch forbidden'); };
const owned = await fixture(config.binary, config.rate);
const { clients, transport, generated } = owned;
const endpoints = { bootstrap: '/api/atlas/view',
  home: scope => '/api/atlas/homes/' + scope.workspaceId + '/' + scope.homeId + '/view' };
const client = clients.createAtlasClient(endpoints, transport.fetch);
const session = clients.createAtlasSessionClient({
  session: '/api/atlas/auth/session', login: '/api/atlas/auth/login',
}, transport.fetch);
const U = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const scope = { workspaceId: U(1), homeId: U(2) };
const scopePath = '/api/atlas/v1/workspaces/' + scope.workspaceId + '/homes/' + scope.homeId;
const report = { format: 'houseatlas-host-client/1', mode: config.mode,
  binarySha256: owned.binarySha256, clientBundleSha256: owned.sourceSha256,
  generatedAssetBytes: owned.generatedAssetBytes,
  limits: { deadlineMs: config.deadlineMs, concurrency: config.concurrency, startsPerSecond: config.rate,
    responseBytes: 8 << 20, perRequestMs: 5000 },
  contexts: { browser: false, transport: 'Node HTTPS HTTP/1.1; verified disposable CA; no redirects',
    fixture: 'actual Rust --disposable-dir; generated SQLite; no external source',
    caches: 'No browser/cache storage; API no-store. OS/filesystem cache is not flushed.',
    percentiles: 'Empirical descriptive samples, no confidence interval or population-tail claim' },
};
function bounded() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Cohort deadline', 'TimeoutError')), config.deadlineMs);
  return { signal: controller.signal, close: () => clearTimeout(timer) };
}
async function body(path, init = {}, fault) {
  const response = await transport.fetch(path, init, fault);
  return { status: response.status, headers: response.headers, data: await response.json() };
}
async function contract() {
  const bound = bounded();
  try {
    const view = await client.load(bound.signal);
    assert.equal(view.status, 'ready'); assert.equal(view.entries.length, 2);
    const selected = await client.loadHome(scope, bound.signal);
    assert.equal(selected.status, 'ready'); assert.deepEqual(selected.scope, scope);
    assert.deepEqual(selected.entries, view.entries);
    const info = await session.session(bound.signal);
    assert.equal(typeof info.csrfToken, 'string');
    const response = await transport.fetch(assetPath, { signal: bound.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), sha256(asset));
    const path = '/api/atlas/mcp/workspaces/' + scope.workspaceId + '/homes/' + scope.homeId;
    let mcpSession;
    const post = async message => {
      const result = await transport.fetch(path, {
        method: 'POST', signal: bound.signal, body: JSON.stringify(message),
        headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25', ...(mcpSession ? { 'MCP-Session-Id': mcpSession } : {}) },
      });
      mcpSession = result.headers.get('mcp-session-id') ?? mcpSession;
      return result;
    };
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'Synthetic host-client contract', version: '1' } } });
    assert.equal(init.status, 200); assert.match(init.headers.get('content-type'), /application\/json/);
    assert.equal((await init.json()).result.protocolVersion, '2025-11-25'); assert(mcpSession);
    const ready = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(ready.status, 202); assert.equal(await ready.text(), '');
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(listed.status, 200); assert.match(listed.headers.get('content-type'), /application\/json/);
    assert.deepEqual((await listed.json()).result.tools.map(row => row.name).sort(),
      ['atlas_bindings', 'atlas_media_geometry', 'atlas_records', 'homebox_entities_locations']);
    const counts = databaseCounts(owned.data);
    assert.deepEqual(counts, { records: 6, audits: 0 });
    return { productionAdapters: 'Atlas load/loadHome and session', viewEntries: 2,
      exactGeneratedAsset: true, immutableAssetPolicy: true,
      mcp: 'JSON initialize, initialized notification and tools/list only; no SSE', persisted: counts };
  } finally { bound.close(); }
}
async function faults() {
  const bound = bounded();
  try {
    const delayed = clients.createAtlasClient(endpoints, (path, init) => transport.fetch(path, init, { kind: 'delay', ms: 150 }));
    const start = performance.now();
    assert.equal((await delayed.load(bound.signal)).status, 'ready');
    assert(performance.now() - start >= 150);
    const truncated = clients.createAtlasClient(endpoints, (path, init) => transport.fetch(path, init, { kind: 'truncate' }));
    await assert.rejects(truncated.load(bound.signal), /TruncatedResponse/);
    const cancelled = clients.createAtlasClient(endpoints, (path, init) => transport.fetch(path, init, { kind: 'delay', ms: 500 }));
    const controller = new AbortController();
    const signal = AbortSignal.any([bound.signal, controller.signal]);
    // The abort is tied to the request starting, so rate-limit waits cannot
    // turn the case into cancellation before dispatch.
    const pending = cancelled.load(signal);
    const before = transport.rows.length;
    while (transport.rows.length === before) {
      bound.signal.throwIfAborted(); await delay(5, undefined, { signal: bound.signal });
    }
    const timer = setTimeout(() => controller.abort(new DOMException('Synthetic cancellation', 'AbortError')), 50);
    try { await assert.rejects(pending, { name: 'AbortError' }); }
    finally { clearTimeout(timer); }
    assert.equal(transport.active, 0, 'Client delivery settled after cancellation');

    await session.signIn(generated.editorLogin, bound.signal);
    const current = await session.session(bound.signal);
    const target = scopePath + '/records/circuit/' + U(900);
    const command = { schemaVersion: 1, mutationId: U(1000), operation: 'create', expectedRevision: null,
      reason: 'Synthetic withheld acknowledgement',
      guards: [{ record: { recordType: 'evidence', recordId: U(100) }, expectedRevision: 1 }],
      value: { recordType: 'circuit', payload: { label: 'Synthetic circuit', panel: null, evidenceIds: [U(100)] } } };
    const firstWriteIndex = transport.rows.length;
    await assert.rejects(body(target + '/mutations', {
      method: 'POST', signal: bound.signal,
      headers: { 'Content-Type': 'application/json', 'X-Atlas-CSRF': current.csrfToken },
      body: JSON.stringify(command),
    }, { kind: 'lost-ack' }), /AcknowledgementWithheld/);
    // Never retry. Inspect the native record and history through passive GETs.
    const record = await body(target, { signal: bound.signal });
    const history = await body(target + '/history', { signal: bound.signal });
    assert.equal(record.status, 200); assert.equal(record.data.revision, 1);
    assert.equal(history.status, 200); assert.equal(history.data.length, 1);
    assert.equal(history.data[0].resultRevision, 1);
    const writes = transport.rows.slice(firstWriteIndex).filter(row => row.method === 'POST');
    const posts = writes.length;
    assert.equal(posts, 1); assert.equal(writes[0].status, 200, 'Successful native reply withheld');
    const counts = databaseCounts(owned.data);
    assert.deepEqual(counts, { records: 7, audits: 1 });
    return { boundary: 'Response delivery in this Node adapter after local HTTPS; not a host/network fault',
      delayedRead: 'ready after >=150ms', truncatedRead: 'rejected without partial DTO',
      cancelledRead: 'locally settled; no server-cancellation claim',
      lostAcknowledgement: { callerOutcome: 'unknown at withheld acknowledgement', submissions: posts,
        passiveReadback: 'revision 1 and one history entry present', automaticRetry: false },
      persisted: counts };
  } finally { bound.close(); }
}
let clockTicks = null;
if (config.mode === 'measure' && platform() === 'linux') {
  const result = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 });
  if (result.status === 0 && /^[1-9][0-9]*\s*$/.test(result.stdout)) clockTicks = Number(result.stdout.trim());
}
function hostResources() {
  try {
    const status = readFileSync('/proc/' + owned.pid + '/status', 'utf8');
    const rss = /VmRSS:\s+([0-9]+) kB/.exec(status);
    const stat = readFileSync('/proc/' + owned.pid + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const cpuTicks = Number(fields[11]) + Number(fields[12]);
    return { observedRssBytes: rss ? Number(rss[1]) * 1024 : null,
      cpuTicks: Number.isFinite(cpuTicks) ? cpuTicks : null };
  } catch { return { observedRssBytes: null, cpuTicks: null }; }
}
async function measureCohort(name, count, reuse, operation, context) {
  transport.connection(reuse);
  const bound = bounded(), samples = [], started = performance.now(), cpu = process.cpuUsage();
  const eventLoop = monitorEventLoopDelay({ resolution: 10 }); eventLoop.enable();
  const hostBefore = hostResources();
  let peakRssBytes = process.memoryUsage().rss, hostPeakRssBytes = hostBefore.observedRssBytes;
  const observations = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const hostRss = hostResources().observedRssBytes;
    if (hostRss !== null) hostPeakRssBytes = Math.max(hostPeakRssBytes ?? 0, hostRss);
  }, 100);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, count) }, async () => {
      while (!bound.signal.aborted && next < count) {
        const index = next++;
        const planned = started + index * 1000 / config.rate;
        await delay(Math.max(0, planned - performance.now()), undefined, { signal: bound.signal }).catch(() => {});
        if (bound.signal.aborted) break;
        let row;
        const begin = performance.now();
        let outcome = 'ok', errorName;
        try { await operation(bound.signal, value => { row = value; }); }
        catch (error) {
          outcome = error.name === 'TimeoutError' ? 'timeout' : error.name === 'AbortError' ? 'cancelled' : 'error';
          errorName = error.name;
        }
        samples.push({ index, plannedStartMs: planned - started, clientStartMs: begin - started,
          actualStartMs: row ? row.startedMs - started : null,
          scheduleLagMs: row ? Math.max(0, row.startedMs - planned) : null,
          queueWaitMs: row ? Math.max(0, row.startedMs - begin) : null,
          elapsedMs: performance.now() - begin, networkElapsedMs: row?.elapsedMs ?? null,
          outcome, ...(errorName ? { errorName } : {}),
          bytes: row?.bytes ?? 0, status: row?.status ?? null, reusedSocket: row?.reusedSocket ?? false });
      }
    }));
  } finally {
    clearInterval(observations); eventLoop.disable(); bound.close();
  }
  const elapsedMs = performance.now() - started, cpuDelta = process.cpuUsage(cpu);
  const hostAfter = hostResources();
  const generator = { cpuMs: (cpuDelta.user + cpuDelta.system) / 1000, peakObservedRssBytes: peakRssBytes,
    eventLoopP95Ms: Number.isFinite(eventLoop.percentile(95)) ? eventLoop.percentile(95) / 1e6 : null,
    hostPeakObservedRssBytes: hostPeakRssBytes,
    hostCpuMs: clockTicks && hostBefore.cpuTicks !== null && hostAfter.cpuTicks !== null
      ? (hostAfter.cpuTicks - hostBefore.cpuTicks) * 1000 / clockTicks : null,
    hostCpuNote: 'Linux /proc user+system ticks when available; same-machine contention and OS cache uncontrolled',
    planned: count, scheduled: samples.length, deadlineHit: bound.signal.aborted,
    maxScheduleLagMs: Math.max(0, ...samples.map(row => row.scheduleLagMs ?? 0)),
    lateStarts: samples.filter(row => (row.scheduleLagMs ?? 0) > 1000 / config.rate).length,
    saturation: samples.length < count || samples.some(row => (row.scheduleLagMs ?? 0) > 1000 / config.rate),
    saturationRule: 'deadline or start lag above one offered request interval; no capacity ceiling inferred' };
  return { name, context, samples, summary: summarize(samples, elapsedMs, generator) };
}
try {
  if (config.mode === 'contract') report.contract = await contract();
  if (config.mode === 'faults') report.faults = await faults();
  if (config.mode === 'measure') {
    const provenance = JSON.parse(readFileSync(config.provenance, 'utf8'));
    assert.equal(provenance.profile, 'release');
    assert.equal(provenance.binarySha256, owned.binarySha256, 'Provenance must identify this binary');
    assert.match(provenance.sourceSha, /^[a-f0-9]{40}$/);
    assert.match(provenance.runnerId, /^[a-zA-Z0-9_.-]{1,80}$/);
    report.provenance = { sourceSha: provenance.sourceSha, profile: 'release', runnerId: provenance.runnerId,
      qualification: 'Operator-supplied build provenance; hash checked, build flags not independently inferred' };
    report.runner = { node: process.version, platform: platform(), architecture: arch(), osRelease: release(),
      logicalCpus: cpus().length, clockTicks, cpuModel: cpus()[0]?.model ?? 'unknown' };
    report.cohorts = [];
    const load = async (signal, observe) => {
      const measuredClient = clients.createAtlasClient(endpoints,
        (path, init) => transport.fetch(path, init, null, observe));
      assert.equal((await measuredClient.load(signal)).status, 'ready');
    };
    report.cohorts.push(await measureCohort('first-api-read', 1, false, load,
      { host: 'fresh process/SQLite fixture; no previous API request', osCache: 'uncontrolled', connection: 'new TLS', cache: 'no-store' }));
    report.cohorts.push(await measureCohort('warm-api-new-tls', config.samples, false, load,
      { host: 'same process; prior read', connection: 'new TLS per request; TLS sessions disabled', cache: 'no-store' }));
    report.cohorts.push(await measureCohort('warm-api-keep-alive', config.samples, true, load,
      { host: 'same process', connection: 'keep-alive enabled; actual reuse in samples', cache: 'no-store' }));
    const download = async (signal, observe) => {
      const response = await transport.fetch(assetPath, { signal }, null, observe);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(bytes), sha256(asset));
    };
    report.cohorts.push(await measureCohort('generated-asset-keep-alive', config.samples, true, download,
      { host: 'same process; generated 256KiB static asset', connection: 'keep-alive enabled',
        cache: 'server immutable policy recorded separately; driver always transfers, no browser cache' }));
    report.measurementComplete = report.cohorts.every(row => row.summary.completed === row.summary.generator.planned
      && row.summary.errors === 0 && row.summary.timeouts === 0 && row.summary.cancelled === 0);
    if (!report.measurementComplete) process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await owned.stop();
}
