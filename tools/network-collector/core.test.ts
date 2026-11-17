import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, chmodSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, readPrivate, loadConfig, parseJson } from './config.ts';
import { canonical, validateInventory, targets } from './inventory.ts';
import { Store } from './store.ts';
import { collect, parsePing, homeGuard, unmeasured, createRunner } from './collect.ts';
import type { Runner } from './collect.ts';
import { reply, requestReply } from './http.ts';
import { Scheduler } from './scheduler.ts';

const config = () => validateConfig({ listen: { address: '127.0.0.1', port: 42001 }, home: { gateway: '192.0.2.1', routerMac: '02:00:00:00:00:01', interface: 'en0', subnet: '192.0.2.0/24' }, storePath: '/example/store.sqlite', inventoryPath: '/example/inventory.json' });
const inventory = () => validateInventory({ revision: 1, inventory: { rooms: [{ id: 'room', name: 'Example room' }], devices: [{ id: 'device', name: 'Example device', kind: 'computer', roomId: 'room' }], interfaces: [{ id: 'iface', deviceId: 'device', name: 'Example interface', addresses: ['192.0.2.10'] }], segments: [], links: [], positions: {} } });
function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'collector-test-')); chmodSync(dir, 0o700);
  const path = join(dir, 'store.sqlite');
  const store = new Store(path);
  return { dir, path, store, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const at = Date.parse('2026-01-01T00:00:00Z');
const success = (ms: number) => ({ stdout: `1 packets transmitted, 1 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = ${ms}/${ms}/${ms}/0.0 ms`, code: 0 });
const fake: Runner = async (file) => file === '/sbin/route' ? { stdout: 'gateway: 192.0.2.1\ninterface: en0', code: 0 } : file === '/usr/sbin/arp' ? { stdout: '? (192.0.2.1) at 2:0:0:0:0:1 on en0', code: 0 } : success(2);
const local = () => ['192.0.2.20'];

test('config refuses non-loopback, invalid bounds, paths and unknown fields', () => {
  for (const address of ['0.0.0.0', 'localhost', '192.0.2.1', '::', '127.0.0.2']) assert.throws(() => validateConfig({ ...config(), listen: { address, port: 42001 } }), /Listen address/);
  for (const patch of [{ intervalMs: 0 }, { intervalMs: 59999 }, { rawDays: 31 }, { hourlyMonths: 14 }, { storePath: 'relative' }, { extra: true }]) assert.throws(() => validateConfig({ ...config(), ...patch }));
  assert.equal(config().intervalMs, 60_000);
  assert.equal(validateConfig({ ...config(), listen: { address: '::1', port: 1 } }).listen.address, '::1');
});

test('private config enforces owner modes and refuses symlinks', () => {
  const f = fixture();
  try {
    const path = join(f.dir, 'config.json');
    writeFileSync(path, JSON.stringify(config()), { mode: 0o600 });
    assert.equal(loadConfig(path).rawDays, 30);
    chmodSync(path, 0o644); assert.throws(() => readPrivate(path, 16384), /0600/);
    chmodSync(path, 0o600); chmodSync(f.dir, 0o755); assert.throws(() => loadConfig(path), /0700/);
    chmodSync(f.dir, 0o700); symlinkSync(path, join(f.dir, 'link')); assert.throws(() => readPrivate(join(f.dir, 'link'), 16384));
  } finally { f.close(); }
});

test('inventory validates closed shape, global IDs, joins, positions and finite rates', () => {
  const changes = [
    (d: any) => d.inventory.devices.push({ ...d.inventory.devices[0] }),
    (d: any) => d.inventory.devices[0].roomId = 'missing',
    (d: any) => d.inventory.devices[0].role = null,
    (d: any) => d.inventory.interfaces[0].deviceId = 'missing',
    (d: any) => d.inventory.positions.device = { x: Infinity, y: 0 },
    (d: any) => d.inventory.links.push({ id: 'link', from: 'iface', to: 'missing', medium: 'ethernet', confidence: 'confirmed' }),
    (d: any) => d.inventory.devices[0].extra = 1,
    (d: any) => d.revision = -1,
    (d: any) => d.inventory.devices = Array.from({ length: 65 }, (_, i) => ({ id: `d${i}`, name: '', kind: '' })),
  ];
  for (const change of changes) { const d = structuredClone(inventory()); change(d); assert.throws(() => validateInventory(d)); }
  const doc = inventory(); doc.inventory.links.push({ id: 'link', from: 'iface', to: 'device', medium: 'ethernet', confidence: 'reported', reportedRate: { kind: 'negotiated-port', mbps: 100, source: 'example', observedAt: '2026-01-01T00:00:00Z' } });
  assert.equal(validateInventory(doc).inventory.links.length, 1);
});

test('inventory revisions persist and remain byte-stable across reopen', () => {
  const f = fixture(); let store = f.store;
  try {
    store.accept(inventory()); const body = reply(store, 'GET', '/api/inventory').body;
    store.accept(JSON.parse(body)); assert.equal(reply(store, 'GET', '/api/inventory').body, body);
    const changed = inventory(); changed.inventory.devices[0].name = 'Changed example';
    assert.throws(() => store.accept(changed), /Repeated/);
    assert.throws(() => store.accept({ ...inventory(), revision: 2 }), /without content/);
    changed.revision = 2; store.accept(changed); store.close(); store = new Store(f.path);
    assert.throws(() => store.accept(inventory()), /regressed/);
    assert.equal(store.inventory()!.revision, 2);
  } finally { store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('store rejects a second writer and unsupported schema', () => {
  const f = fixture();
  try {
    assert.throws(() => new Store(f.path));
    f.store.db.exec('UPDATE schema_version SET version=999');
    f.store.close(); assert.throws(() => new Store(f.path), /Unsupported/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('targets come only from reviewed addresses in the guarded subnet', () => {
  const doc = inventory(); doc.inventory.interfaces[0].addresses = ['example.test', '198.51.100.10', '192.0.2.10'];
  assert.equal(targets(doc, config().home).get('device'), '192.0.2.10');
  doc.inventory.interfaces[0].addresses = ['example.test']; assert.equal(targets(doc, config().home).get('device'), null);
});

test('guard checks route, interface, subnet and router identity before any ping', async () => {
  const signal = new AbortController().signal;
  assert.equal(await homeGuard(config().home, fake, local, signal), 'home');
  assert.equal(await homeGuard(config().home, fake, () => ['198.51.100.10'], signal), 'not-at-home');
  assert.equal(await homeGuard({ ...config().home, routerMac: '02:00:00:00:00:02' }, fake, local, signal), 'not-at-home');
  assert.equal(await homeGuard(config().home, async () => ({ stdout: '', code: 1 }), local, signal), 'unknown');
  const f = fixture();
  try {
    f.store.accept(inventory()); let pings = 0;
    const result = await collect(inventory(), config(), async file => { if (file === '/sbin/ping') pings++; return { stdout: '', code: 1 }; }, local, signal, () => at);
    f.store.record(at, result.guard, result.facts, config());
    assert.equal(pings, 0); const latest = f.store.measurements(at, inventory()).devices.device.latest;
    assert.equal(latest.state, 'not-measured'); assert.equal(latest.loss, null); assert.equal(latest.reason, 'not-at-home');
    assert.equal(f.store.status().guardOutcome, 'unknown');
  } finally { f.close(); }
});

test('ping parser distinguishes reply, valid loss, timeout and malformed output', () => {
  assert.equal(parsePing(success(2.5), at).latencyMs, 2.5);
  const loss = parsePing({ stdout: '1 packets transmitted, 0 received, 100% packet loss', code: 1 }, at);
  assert.equal(loss.state, 'no-reply'); assert.equal(loss.loss, 1);
  for (const r of [{ stdout: '', code: 1 }, { ...success(1), interrupted: true }, { stdout: '1 packets transmitted, 1 received', code: 0 }, { ...success(2), code: 3 }, { stdout: '1 packets transmitted, 0 received', code: 127 }]) {
    const fact = parsePing(r, at); assert.equal(fact.state, 'not-measured'); assert.equal(fact.measuredAt, null); assert.equal(fact.loss, null);
  }
});

test('routine cycle records reachable and no-target without inventing loss', async () => {
  const doc = inventory(); doc.inventory.devices.push({ id: 'offline', name: 'Unaddressed example', kind: 'unknown' });
  const result = await collect(doc, config(), fake, local, new AbortController().signal, () => at);
  assert.equal(result.facts.get('device')!.state, 'reachable'); assert.equal(result.facts.get('offline')!.state, 'not-measured');
});

test('hourly aggregates preserve unknown counts, numeric statistics and retention', () => {
  const f = fixture();
  try {
    f.store.accept(inventory());
    for (const [offset, fact] of [[0, parsePing(success(2), at)], [60_000, parsePing(success(4), at + 60_000)], [120_000, parsePing({ stdout: '1 packets transmitted, 0 received', code: 1 }, at + 120_000)], [180_000, unmeasured(at + 180_000, 'not-at-home')]] as const) f.store.record(at + offset, 'home', new Map([['device', fact]]), config());
    const r = f.store.measurements(at + 200_000, inventory()).devices.device.hourly7d[0];
    assert.equal(r.minMs, 2); assert.equal(r.meanMs, 3); assert.equal(r.maxMs, 4); assert.equal(r.loss, 1 / 3); assert.equal(r.notMeasured, 1);
    f.store.record(at + 31 * 86400_000, 'unknown', new Map(), config());
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM ping_samples').get()!.n, 0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM ping_hourly').get()!.n, 1);
    f.store.record(Date.parse('2027-03-01T00:00:00Z'), 'unknown', new Map(), config());
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM ping_hourly').get()!.n, 0);
  } finally { f.close(); }
});

test('measurements contract and GET routes are bounded pure reads', () => {
  const f = fixture();
  try {
    f.store.accept(inventory()); const before = f.store.db.prepare('SELECT total_changes() AS n').get()!.n;
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) assert.equal(reply(f.store, method, '/api/inventory').status, 405);
    assert.equal(reply(f.store, 'GET', '/api/inventory?x=1').status, 404);
    const m = JSON.parse(reply(f.store, 'GET', '/api/measurements', at).body);
    assert.equal(m.version, 1); assert.equal(m.collector.schemaVersion, 1); assert.equal(m.inventoryRevision, 1);
    assert.deepEqual(Object.keys(m.devices.device).sort(), ['hourly7d', 'hourly90d', 'latest', 'series24h', 'series24hTruncated']);
    assert.equal(m.devices.device.latest.state, 'not-measured'); assert.equal(m.devices.device.latest.measuredAt, null);
    assert.deepEqual(m.devices.device.hourly90d, []);
    assert.equal(JSON.parse(reply(f.store, 'GET', '/api/health').body).ok, true);
    assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n, before);
    assert.equal(canonical(f.store.inventory()), reply(f.store, 'GET', '/api/inventory').body);
  } finally { f.close(); }
});

test('scheduler refuses overlap and shutdown cancels and drains active work', async () => {
  let calls = 0, release!: () => void;
  const scheduler = new Scheduler(async signal => { calls++; await new Promise<void>(resolve => { release = resolve; signal.addEventListener('abort', resolve as () => void, { once: true }); }); });
  const active = scheduler.tick(); await Promise.resolve(); await scheduler.tick(); assert.equal(calls, 1);
  const stopped = scheduler.shutdown(); release(); await stopped; await active; await scheduler.tick(); assert.equal(calls, 1);
});

test('scheduler uses monotonic slots, skips missed cycles and restarts without catch-up', async () => {
  let clock = 0, count = 0;
  const waits: number[] = [];
  const scheduler = new Scheduler(async () => { count++; clock += 150; if (count === 3) void scheduler.shutdown(); });
  await scheduler.run(100, () => clock, async ms => { waits.push(ms); clock += ms; });
  assert.deepEqual(waits, [0, 50, 50]); assert.equal(count, 3);
});


test('strict private JSON refuses duplicate keys, excess depth and nonfinite numbers', () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[1,]', '1e999', '[true] false', '['.repeat(102) + '0' + ']'.repeat(102)]) assert.throws(() => parseJson(input));
  assert.deepEqual(parseJson('{"a":[1,true,null,"example"]}'), { a: [1, true, null, 'example'] });
});


const request = (host = '127.0.0.1:42001', origin?: string) => ({
  method: 'GET', url: '/api/inventory', headers: { host, ...(origin === undefined ? {} : { origin }) },
  socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' },
});
const unreadable = new Proxy({} as Store, { get() { throw new Error('Refused request touched the store'); } });

test('foreign or absent Host is refused before store access', () => {
  assert.equal(requestReply(unreadable, config().listen, { ...request(), headers: {} }).status, 403);
  for (const host of ['example.test:42001', 'localhost:42001', '127.0.0.1', '127.0.0.1:42002', '']) {
    assert.deepEqual(requestReply(unreadable, config().listen, request(host)), { status: 403, body: '{"error":"request-refused"}' });
  }
});

test('foreign Origin is refused before store access', () => {
  for (const origin of ['https://example.test', 'null', 'http://localhost:42001', 'http://127.0.0.1:42002', '']) {
    assert.equal(requestReply(unreadable, config().listen, request('127.0.0.1:42001', origin)).status, 403);
  }
});

test('literal loopback authority accepts absent or matching Origin including IPv6', () => {
  const f = fixture();
  try {
    f.store.accept(inventory());
    for (const origin of [undefined, 'http://127.0.0.1:42001']) assert.equal(requestReply(f.store, config().listen, request('127.0.0.1:42001', origin)).body, canonical(inventory()));
    const ipv6 = { ...request('[::1]:42001', 'http://[::1]:42001'), socket: { localAddress: '::1', remoteAddress: '::1' } };
    assert.equal(requestReply(f.store, { address: '::1', port: 42001 }, ipv6).status, 200);
    assert.equal(requestReply(unreadable, config().listen, { ...request(), socket: { localAddress: '127.0.0.1', remoteAddress: '192.0.2.10' } }).status, 403);
  } finally { f.close(); }
});

class FakePipe extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; return this; }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe();
  stderr = new FakePipe();
  kills: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals) { this.kills.push(signal); return true; }
}
function assertClean(child: FakeChild) {
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
}

test('runner forwards exact executable arguments and controlled spawn options, then cleans up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new FakeChild();
  const signal = new AbortController();
  const runner = createRunner((file, args, options) => {
    assert.equal(file, '/example/ping'); assert.deepEqual(args, ['-n', '192.0.2.10']);
    assert.deepEqual(options, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' } });
    return child;
  });
  const pending = runner('/example/ping', ['-n', '192.0.2.10'], 2500, signal.signal);
  child.stdout.emit('data', Buffer.from('reply')); child.emit('close', 0);
  assert.deepEqual(await pending, { stdout: 'reply', code: 0, interrupted: false });
  signal.abort(); t.mock.timers.tick(3000); assert.deepEqual(child.kills, []); assertClean(child);
});

test('runner bounds combined output, escalates once and drains the fake child', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new FakeChild(); const signal = new AbortController();
  const pending = createRunner(() => child)('/example/ping', [], 2500, signal.signal);
  let settled = false; void pending.then(() => { settled = true; });
  child.stdout.emit('data', Buffer.alloc(65_536, 'x')); child.stderr.emit('data', Buffer.from('overflow'));
  child.stdout.emit('data', Buffer.from('discard')); signal.abort();
  assert.deepEqual(child.kills, ['SIGTERM']);
  t.mock.timers.tick(249); assert.deepEqual(child.kills, ['SIGTERM']);
  t.mock.timers.tick(1); assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
  await Promise.resolve(); assert.equal(settled, false);
  child.emit('close', null); const result = await pending;
  assert.equal(result.stdout.length, 65_536); assert.equal(result.interrupted, true);
  t.mock.timers.tick(3000); assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']); assertClean(child);
});

test('runner deadline sends TERM then KILL and cancels escalation on early close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const earlyClose of [false, true]) {
    const child = new FakeChild();
    const pending = createRunner(() => child)('/example/ping', [], 2500, new AbortController().signal);
    t.mock.timers.tick(2499); assert.deepEqual(child.kills, []);
    t.mock.timers.tick(1); assert.deepEqual(child.kills, ['SIGTERM']);
    if (earlyClose) child.emit('close', null);
    t.mock.timers.tick(250);
    assert.deepEqual(child.kills, earlyClose ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
    if (!earlyClose) child.emit('close', null);
    assert.equal((await pending).interrupted, true); assertClean(child);
  }
});

test('runner skips pre-aborted spawn and cleans up spawn error and active abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped = AbortSignal.abort();
  assert.equal((await createRunner(() => { throw new Error('Unexpected spawn'); })('/example/ping', [], 2500, stopped)).interrupted, true);
  for (const failure of ['error', 'abort']) {
    const child = new FakeChild(); const signal = new AbortController();
    const pending = createRunner(() => child)('/example/ping', [], 2500, signal.signal);
    if (failure === 'error') child.emit('error', new Error('Synthetic spawn failure'));
    else { signal.abort(); child.emit('close', null); }
    const result = await pending; assert.equal(result.code, null);
    t.mock.timers.tick(3000); assert.deepEqual(child.kills, failure === 'error' ? [] : ['SIGTERM']); assertClean(child);
  }
});

test('cross-hour cycle indexes facts by observation time for hourly and 24-hour reads', () => {
  const f = fixture();
  try {
    f.store.accept(inventory());
    const cycleAt = at + 3_599_000, observedAt = at + 3_601_000;
    const fact = parsePing(success(2), observedAt);
    f.store.record(cycleAt, 'home', new Map([['device', fact]]), config());
    assert.equal(f.store.status().lastCycleAt, new Date(cycleAt).toISOString());
    assert.equal(f.store.db.prepare('SELECT at FROM ping_samples').get()!.at, observedAt);
    const current = f.store.measurements(observedAt, inventory()).devices.device;
    assert.equal(current.hourly7d.length, 1); assert.equal(current.hourly7d[0].hour, '2026-01-01T01:00:00.000Z');
    assert.deepEqual(current.series24h, [fact]);
    assert.deepEqual(f.store.measurements(observedAt + 86_400_000, inventory()).devices.device.series24h, [fact]);
    assert.deepEqual(f.store.measurements(observedAt + 86_400_001, inventory()).devices.device.series24h, []);
  } finally { f.close(); }
});

// Stage 1 remains synthetic: no socket, command or live radio access.
import { Actions, parseAction, parseSpeed, periodic, wifiUnavailable } from './actions.ts';
import { actionReply } from './http.ts';

test('speed parser retains measured units and missing fields as unknown', async t => {
  const r = parseSpeed({ stdout: '{"dl_throughput":12000000,"ul_throughput":3000000,"base_rtt":12}', code: 0 }, at);
  assert.equal(r.state, 'measured'); assert.equal(r.downloadBitsPerSecond, 12000000); assert.equal(r.latencyMs, 12);
  const partial = parseSpeed({ stdout: '{"dl_throughput":0}', code: 0 }, at);
  assert.equal(partial.downloadBitsPerSecond, 0); assert.equal(partial.uploadBitsPerSecond, null); assert.equal(partial.reason, 'missing-fields');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const child = new FakeChild();
  const runner = createRunner((file, args) => {
    assert.equal(file, '/usr/bin/networkQuality'); assert.deepEqual(args, ['-c', '-M', '60']); return child;
  });
  try {
    const actions = new Actions(f.store, config(), runner, local, () => at);
    const pending = actions.execute({ kind: 'speed' }); await Promise.resolve();
    t.mock.timers.tick(64999); assert.deepEqual(child.kills, []);
    t.mock.timers.tick(1); assert.deepEqual(child.kills, ['SIGTERM']);
    t.mock.timers.tick(250); assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
    child.emit('close', null);
    assert.equal((await pending).status, 200);
    assert.equal(f.store.extras().speed.latest.state, 'failed'); assertClean(child);
  } finally { f.close(); }
});
test('speed parser refuses malformed ambiguous and invalid metrics and reports failures', () => {
  for (const stdout of ['{', 'null', '[]', '{"base_rtt":-1}', '{"dl_throughput":"12"}', '{"base_rtt":1,"base_rtt":2}', '{"base_rtt":1e999}']) assert.equal(parseSpeed({ stdout, code: 0 }, at).reason, 'malformed-output');
  assert.equal(parseSpeed({ stdout: '{}', code: 1 }, at).state, 'failed');
  assert.equal(parseSpeed({ stdout: '{}', code: 0, interrupted: true }, at).state, 'failed');
  assert.equal(parseSpeed({ stdout: '{"error_code":1,"base_rtt":2}', code: 0 }, at).reason, 'tool-error');
});
test('action config and closed bodies refuse hosts unknown kinds ports and invalid times', () => {
  for (const patch of [{ speedTime: '24:00' }, { speedTime: null }, { wifiIntervalMs: 1 }, { actionPorts: [22, 22] }, { actionPorts: [0] }, { actionPorts: Array(17).fill(22) }]) assert.throws(() => validateConfig({ ...config(), ...patch }));
  for (const a of [{ kind: 'speed', host: '192.0.2.10' }, { kind: 'port', deviceId: 'device', port: 1234, expectedInventoryRevision: 1 }, { kind: 'ping', deviceId: 'device', port: 22, expectedInventoryRevision: 1 }, { kind: 'scan' }, { kind: 'ping' }]) assert.throws(() => parseAction(a, config()));
  assert.deepEqual(parseAction({ kind: 'port', deviceId: 'device', port: 443, expectedInventoryRevision: 1 }, config()), { kind: 'port', deviceId: 'device', port: 443, expectedInventoryRevision: 1 });
});
function post(body = '{"kind":"speed"}', headers: any = {}) {
  return { method: 'POST', url: '/api/actions', headers: { host: '127.0.0.1:42001', 'content-type': 'application/json', ...headers }, socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
}
test('POST fences before body or store access and bounds strict JSON', async () => {
  const f = fixture(); let calls = 0;
  const actions = new Actions(f.store, config(), async () => { calls++; return { stdout: '{}', code: 0 }; }, local);
  try {
    for (const headers of [{ host: 'localhost:42001' }, { origin: 'http://127.0.0.1:42001' }, { origin: '' }]) {
      const req = post('', headers); req[Symbol.asyncIterator] = async function*() { throw Error('must not read'); };
      assert.equal((await actionReply(config(), actions, req)).status, 403);
    }
    assert.equal((await actionReply(config(), actions, post('', { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await actionReply(config(), actions, post(' '.repeat(8193)))).status, 413);
    for (const body of ['{}', '{"kind":"speed","kind":"ping"}', '{"kind":"ping","deviceId":"device","host":"192.0.2.1"}']) assert.equal((await actionReply(config(), actions, post(body))).status, 400);
    assert.equal(calls, 0);
  } finally { f.close(); }
});
test('one action at a time shares nightly ownership and records speed results', async () => {
  const f = fixture(); let release!: (r: any) => void; let calls = 0;
  const runner: Runner = async (file, args, timeout) => { calls++; assert.equal(file, '/usr/bin/networkQuality'); assert.deepEqual(args, ['-c', '-M', '60']); assert.equal(timeout, 65000); return new Promise(r => { release = r; }); };
  const actions = new Actions(f.store, config(), runner, local, () => at);
  try {
    const first = actionReply(config(), actions, post());
    // Allow the async body iterator to finish before the competing POST.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await actionReply(config(), actions, post())).status, 409);
    await periodic(f.store, config(), actions, new Date(2026, 0, 1, 3, 0).getTime());
    assert.equal(f.store.lastNight(), null);
    release({ stdout: '{"base_rtt":1}', code: 0 }); assert.equal((await first).status, 200);
    assert.equal(calls, 1); assert.equal(f.store.extras().actions.length, 1); assert.equal(f.store.extras().speed.latest.latencyMs, 1);
  } finally { f.close(); }
});
test('nightly civil clock claim skips early missed and repeated dates across reopen', async () => {
  const f = fixture(); let store = f.store; let calls = 0;
  const runner: Runner = async () => { calls++; return { stdout: '{}', code: 0 }; };
  try {
    let actions = new Actions(store, config(), runner, local);
    const tick = (day: number, hour: number, minute: number) => periodic(store, config(), actions, new Date(2026, 0, day, hour, minute).getTime());
    await tick(1, 2, 59); assert.equal(calls, 0);
    await tick(1, 3, 0); await tick(1, 3, 1); assert.equal(calls, 1);
    store.close(); store = new Store(f.path); actions = new Actions(store, config(), runner, local);
    await tick(1, 4, 0); await tick(1, 2, 0); assert.equal(calls, 1);
    await tick(3, 4, 0); assert.equal(calls, 2); // no catch-up for day 2
    await tick(2, 4, 0); assert.equal(calls, 2); // wall-clock rollback
  } finally { store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('Wi-Fi unavailable is explicit and periodically retained without a runner', async () => {
  const f = fixture(); const actions = new Actions(f.store, config(), async () => { throw Error('no command'); }, local);
  try {
    const time = new Date(2026, 0, 1, 1, 0).getTime();
    await periodic(f.store, config(), actions, time); await periodic(f.store, config(), actions, time + 1);
    assert.equal(f.store.recentExtra('wifi', 24).length, 1);
    await periodic(f.store, config(), actions, time + config().wifiIntervalMs);
    assert.equal(f.store.recentExtra('wifi', 24).length, 2);
    assert.equal(wifiUnavailable(at).networks, null); assert.equal(f.store.extras().wifi.latest.state, 'unavailable');
  } finally { f.close(); }
});
test('extra histories are bounded and read route preserves stage zero envelope', () => {
  const f = fixture();
  try {
    f.store.accept(inventory());
    for (let i = 0; i < 405; i++) for (const kind of ['speed', 'wifi', 'action'] as const) f.store.recordExtra(kind, { recordedAt: new Date(at + i).toISOString(), n: i });
    assert.equal(f.store.recentExtra('speed', 1000).length, 400); assert.equal(f.store.recentExtra('wifi', 1000).length, 24); assert.equal(f.store.recentExtra('action', 1000).length, 200);
    assert.equal(JSON.parse(reply(f.store, 'GET', '/api/results').body).version, 1);
    assert.equal(JSON.parse(reply(f.store, 'GET', '/api/measurements').body).version, 1);
    assert.equal(f.store.extras().speed.latest.n, 404);
  } finally { f.close(); }
});
test('diagnostics only use inventory targets after current home guard', async () => {
  const f = fixture(); const commands: any[] = [];
  const actions = new Actions(f.store, config(), async (file, args, ms, signal) => { commands.push([file, args]); return file === '/usr/bin/nc' ? { stdout: '', code: 0 } : fake(file, args, ms, signal); }, local, () => at);
  try {
    f.store.accept(inventory());
    assert.equal((await actions.execute({ kind: 'ping', deviceId: 'missing', expectedInventoryRevision: 1 })).status, 400); assert.equal(commands.length, 0);
    const ping = JSON.parse((await actions.execute({ kind: 'ping', deviceId: 'device', expectedInventoryRevision: 1 })).body); assert.equal(ping.result.state, 'reachable');
    const port = JSON.parse((await actions.execute({ kind: 'port', deviceId: 'device', port: 443, expectedInventoryRevision: 1 })).body); assert.equal(port.result.state, 'open');
    assert.deepEqual(commands.at(-1), ['/usr/bin/nc', ['-n', '-z', '-w', '2', '192.0.2.10', '443']]);
    assert.equal(f.store.extras().actions.length, 2);
  } finally { f.close(); }
});
test('action shutdown aborts fake child work and prevents later dispatch', async () => {
  const f = fixture(); let signal!: AbortSignal;
  const actions = new Actions(f.store, config(), async (_f, _a, _m, s) => { signal = s; return new Promise(resolve => s.addEventListener('abort', () => resolve({ stdout: '', code: null, interrupted: true }), { once: true })); }, local);
  try {
    const pending = actions.execute({ kind: 'speed' }); await Promise.resolve(); await actions.shutdown();
    assert.equal(signal.aborted, true); assert.equal((await pending).status, 200); assert.equal(f.store.extras().speed.latest.state, 'failed');
    assert.equal((await actions.execute({ kind: 'speed' })).status, 503);
  } finally { f.close(); }
});
test('forward migration retains stage zero inventory and ping history', () => {
  const f = fixture(); let store = f.store;
  try {
    store.accept(inventory()); store.record(at, 'home', new Map([['device', parsePing(success(2), at)]]), config());
    const before = reply(store, 'GET', '/api/measurements', at).body;
    store.db.exec('DROP TABLE extra; DROP TABLE nightly; UPDATE schema_version SET version=1'); store.close();
    store = new Store(f.path);
    assert.equal(reply(store, 'GET', '/api/measurements', at).body, before);
    assert.equal(store.db.prepare('SELECT version FROM schema_version').get()!.version, 3);
    assert.deepEqual(store.extras().actions, []);
  } finally { store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('port failures remain unknown and missing targets or home guard never dispatch', async () => {
  const f = fixture(); let connects = 0;
  try {
    f.store.accept(inventory());
    const runner: Runner = async (file, args, ms, signal) => { if (file === '/usr/bin/nc') { connects++; return { stdout: '', code: 1 }; } return fake(file, args, ms, signal); };
    const actions = new Actions(f.store, config(), runner, local);
    assert.equal(JSON.parse((await actions.execute({ kind: 'port', deviceId: 'device', port: 22, expectedInventoryRevision: 1 })).body).result.state, 'unknown');
    const away = new Actions(f.store, config(), runner, () => []);
    assert.equal(JSON.parse((await away.execute({ kind: 'port', deviceId: 'device', port: 22, expectedInventoryRevision: 1 })).body).result.reason, 'not-at-home');
    const doc = inventory(); doc.revision = 2; doc.inventory.interfaces[0].addresses = []; f.store.accept(doc);
    assert.equal(JSON.parse((await actions.execute({ kind: 'port', deviceId: 'device', port: 22, expectedInventoryRevision: 2 })).body).result.reason, 'no-target');
    assert.equal(connects, 1);
  } finally { f.close(); }
});

test('routine pings and nightly or on-demand speed commands never overlap', async () => {
  for (const nightlyDate of [null, '2026-01-01']) {
    const f = fixture(); let releasePing!: () => void; let releaseSpeed!: () => void;
    let pingActive = false; let speedActive = false; let pings = 0; let speeds = 0;
    const runner: Runner = async (file, args, ms, signal) => {
      if (file === '/sbin/ping') {
        assert.equal(speedActive, false); pings++; pingActive = true;
        await new Promise<void>(r => { releasePing = r; }); pingActive = false; return success(2);
      }
      if (file === '/usr/bin/networkQuality') {
        assert.equal(pingActive, false); speeds++; speedActive = true;
        await new Promise<void>(r => { releaseSpeed = r; }); speedActive = false;
        return { stdout: '{"dl_throughput":1000,"ul_throughput":500,"base_rtt":2}', code: 0 };
      }
      return fake(file, args, ms, signal);
    };
    try {
      f.store.accept(inventory()); const actions = new Actions(f.store, config(), runner, local, () => at);
      const cycle = actions.collectRoutine(inventory(), new AbortController().signal);
      await new Promise(r => setImmediate(r)); assert.equal(pings, 1);
      const speed = actions.execute({ kind: 'speed' }, nightlyDate);
      await new Promise(r => setImmediate(r)); assert.equal(speeds, 0);
      releasePing(); await cycle;
      await new Promise(r => setImmediate(r)); assert.equal(speeds, 1);
      const skipped = await actions.collectRoutine(inventory(), new AbortController().signal);
      f.store.record(at, skipped.guard, skipped.facts, config());
      const latest = f.store.measurements(at, inventory()).devices.device.latest;
      assert.equal(latest.state, 'not-measured'); assert.equal(latest.reason, 'speed-test-in-progress');
      assert.equal(latest.latencyMs, null); assert.equal(latest.loss, null); assert.equal(pings, 1);
      releaseSpeed(); await speed;
      const resumed = actions.collectRoutine(inventory(), new AbortController().signal);
      await new Promise(r => setImmediate(r)); assert.equal(pings, 2);
      releasePing(); assert.equal((await resumed).facts.get('device')!.state, 'reachable');
    } finally { f.close(); }
  }
});

test('nightly schedule runs after the skipped DST hour in a controlled timezone', async () => {
  const previous = process.env.TZ; process.env.TZ = 'Europe/Amsterdam';
  const f = fixture(); let calls = 0;
  try {
    const c = validateConfig({ ...config(), speedTime: '02:30' });
    const actions = new Actions(f.store, c, async () => { calls++; return { stdout: '{}', code: 0 }; }, local);
    const tick = (stamp: string) => periodic(f.store, c, actions, Date.parse(stamp));
    assert.equal(new Date('2026-03-29T00:59:00Z').getHours(), 1);
    assert.equal(new Date('2026-03-29T01:00:00Z').getHours(), 3);
    await tick('2026-03-29T00:59:00Z'); assert.equal(calls, 0);
    await tick('2026-03-29T01:00:00Z'); assert.equal(calls, 1);
    await tick('2026-03-29T01:30:00Z'); assert.equal(calls, 1);
    assert.equal(f.store.lastNight(), '2026-03-29');
  } finally { f.close(); if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('nightly schedule does not rerun during the repeated DST hour', async () => {
  const previous = process.env.TZ; process.env.TZ = 'Europe/Amsterdam';
  const f = fixture(); let calls = 0;
  try {
    const c = validateConfig({ ...config(), speedTime: '02:30' });
    const actions = new Actions(f.store, c, async () => { calls++; return { stdout: '{}', code: 0 }; }, local);
    const tick = (stamp: string) => periodic(f.store, c, actions, Date.parse(stamp));
    assert.equal(new Date('2026-10-25T00:30:00Z').getHours(), 2);
    assert.equal(new Date('2026-10-25T01:30:00Z').getHours(), 2);
    assert.notEqual(new Date('2026-10-25T00:30:00Z').getTimezoneOffset(), new Date('2026-10-25T01:30:00Z').getTimezoneOffset());
    await tick('2026-10-25T00:29:00Z'); assert.equal(calls, 0);
    await tick('2026-10-25T00:30:00Z'); assert.equal(calls, 1);
    await tick('2026-10-25T01:00:00Z'); await tick('2026-10-25T01:30:00Z'); assert.equal(calls, 1);
    assert.equal(f.store.lastNight(), '2026-10-25');
  } finally { f.close(); if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

import { handler } from './http.ts';
test('oversized POST with a detached socket cannot rewrite headers or reject the handler', async () => {
  const f = fixture();
  try {
    const actions = new Actions(f.store, config(), async () => { throw Error('no command'); }, local);
    const req: any = post();
    req[Symbol.asyncIterator] = async function*() { try { yield Buffer.alloc(8500); yield Buffer.alloc(500); } finally { req.socket = null; } };
    const statuses: number[] = []; let body = '';
    const res: any = { headersSent: false, destroyed: false, writableEnded: false,
      writeHead(status: number) { assert.equal(this.headersSent, false); this.headersSent = true; statuses.push(status); },
      end(value: string) { this.writableEnded = true; body = value; }, destroy() { this.destroyed = true; } };
    await handler(f.store, config().listen, config(), actions)(req, res);
    assert.deepEqual(statuses, [413]); assert.equal(body, '{"error":"body-limit"}');
    assert.equal(res.destroyed, false); assert.equal(f.store.extras().actions.length, 0);
    // An error after headers begin must also retire the response, not write 503.
    const broken: any = { ...res, headersSent: false, writableEnded: false,
      end() { throw Error('synthetic disconnected response'); } };
    await handler(f.store, config().listen, config(), actions)(post('', { origin: '' }) as any, broken);
    assert.deepEqual(statuses, [413, 403]); assert.equal(broken.destroyed, true);
  } finally { f.close(); }
});

test('stage one store migration renames persisted speed and action metrics', () => {
  const f = fixture(); let store = f.store;
  try {
    const old = { state: 'measured', downloadBps: 1000, uploadBps: 500, latencyMs: 2 };
    store.recordExtra('speed', old); store.recordExtra('action', { kind: 'speed', result: old });
    store.db.exec('UPDATE schema_version SET version=2'); store.close(); store = new Store(f.path);
    const result = JSON.parse(reply(store, 'GET', '/api/results').body);
    for (const speed of [result.speed.latest, result.actions[0].result]) {
      assert.equal(speed.downloadBitsPerSecond, 1000); assert.equal(speed.uploadBitsPerSecond, 500);
      assert.equal(Object.hasOwn(speed, 'downloadBps'), false); assert.equal(Object.hasOwn(speed, 'uploadBps'), false);
    }
  } finally { store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('missing child close settles after bounded teardown and releases pings and actions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const child = new FakeChild(); let speedCalls = 0; let pings = 0;
  const stalled = createRunner(() => child);
  const runner: Runner = (file, args, timeout, signal) => {
    if (file === '/usr/bin/networkQuality' && speedCalls++ === 0) return stalled(file, args, timeout, signal);
    if (file === '/sbin/ping') pings++;
    return file === '/usr/bin/networkQuality' ? Promise.resolve({ stdout: '{}', code: 0 }) : fake(file, args, timeout, signal);
  };
  try {
    f.store.accept(inventory());
    const actions = new Actions(f.store, config(), runner, local, () => at);
    const speed = actions.execute({ kind: 'speed' }); let settled = false;
    void speed.then(() => { settled = true; }); await Promise.resolve();
    assert.equal((await actions.collectRoutine(inventory(), new AbortController().signal)).facts.get('device')!.reason, 'speed-test-in-progress');
    assert.equal((await actions.execute({ kind: 'ping', deviceId: 'device', expectedInventoryRevision: 1 })).status, 409);
    t.mock.timers.tick(65000); assert.deepEqual(child.kills, ['SIGTERM']);
    t.mock.timers.tick(250); assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
    t.mock.timers.tick(249); await Promise.resolve(); assert.equal(settled, false);
    t.mock.timers.tick(1); assert.equal((await speed).status, 200);
    assert.equal(f.store.extras().speed.latest.state, 'failed');
    assert.equal(f.store.extras().speed.latest.reason, 'command-unavailable');
    assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true); assertClean(child);
    // Late events cannot overwrite the unknown result or revive old ownership.
    child.stdout.emit('data', Buffer.from('{"base_rtt":1}')); child.emit('close', 0);
    const cycle = await actions.collectRoutine(inventory(), new AbortController().signal);
    assert.equal(cycle.facts.get('device')!.state, 'reachable');
    const ping = await actions.execute({ kind: 'ping', deviceId: 'device', expectedInventoryRevision: 1 });
    assert.equal(ping.status, 200); assert.equal(JSON.parse(ping.body).result.state, 'reachable');
    assert.equal(pings, 2); assert.equal((await actions.execute({ kind: 'speed' })).status, 200);
    await actions.shutdown(); t.mock.timers.tick(100000);
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']); assertClean(child);
  } finally { f.close(); }
  // The same bound applies to output overflow and abort, not only deadlines.
  for (const mode of ['output', 'abort']) {
    const child = new FakeChild(); const stop = new AbortController();
    const pending = createRunner(() => child)('/example/ping', [], 2500, stop.signal);
    if (mode === 'output') child.stderr.emit('data', Buffer.alloc(65537)); else stop.abort();
    t.mock.timers.tick(250); t.mock.timers.tick(250);
    const result = await pending; assert.equal(result.code, null); assert.equal(result.interrupted, true);
    assert.equal(parsePing(result, at).state, 'not-measured');
    assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true); assertClean(child);
  }
});


test('device actions require a safe expected inventory revision', () => {
  for (const kind of ['ping', 'port'] as const) {
    const action = { kind, deviceId: 'device', ...(kind === 'port' ? { port: 443 } : {}) };
    assert.throws(() => parseAction(action, config()));
    for (const expectedInventoryRevision of [null, false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      assert.throws(() => parseAction({ ...action, expectedInventoryRevision }, config()));
    }
    for (const expectedInventoryRevision of [0, 1, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(parseAction({ ...action, expectedInventoryRevision }, config()), { ...action, expectedInventoryRevision });
    }
  }
  assert.throws(() => parseAction({ kind: 'speed', expectedInventoryRevision: 1 }, config()));
});

test('POST diagnostics fence inventory replacement and retain the selected target across guard awaits', async () => {
  for (const kind of ['ping', 'port'] as const) {
    const action = { kind, deviceId: 'device', ...(kind === 'port' ? { port: 443 } : {}), expectedInventoryRevision: 1 };
    const replacement = inventory(); replacement.revision = 2; replacement.inventory.interfaces[0].addresses = ['192.0.2.11'];
    const f = fixture(); const commands: any[] = [];
    try {
      f.store.accept(inventory());
      assert.equal(JSON.parse(reply(f.store, 'GET', '/api/measurements', at).body).inventoryRevision, 1);
      const actions = new Actions(f.store, config(), async (file, args, ms, signal) => { commands.push([file, args]); return fake(file, args, ms, signal); }, local, () => at);
      // The backend has polled 1; inventory changes while the POST is being read.
      const pending = actionReply(config(), actions, post(JSON.stringify(action)));
      f.store.accept(replacement);
      assert.deepEqual(await pending, { status: 409, body: '{"error":"inventory-revision-mismatch"}' });
      assert.deepEqual(commands, [], 'no home guard or diagnostic command executes');
      assert.deepEqual(f.store.extras().actions, [], 'refusal creates no completed action');
      const removed = { ...action, deviceId: 'missing' };
      assert.deepEqual(await actionReply(config(), actions, post(JSON.stringify(removed))), { status: 409, body: '{"error":"inventory-revision-mismatch"}' });
    } finally { f.close(); }

    const selected = fixture(); const selectedCommands: any[] = [];
    let entered!: () => void, release!: () => void;
    const guardStarted = new Promise<void>(resolve => { entered = resolve; });
    const guardWait = new Promise<void>(resolve => { release = resolve; });
    try {
      selected.store.accept(inventory());
      const runner: Runner = async (file, args, ms, signal) => {
        selectedCommands.push([file, args]);
        if (file === '/sbin/route') { entered(); await guardWait; }
        return file === '/usr/bin/nc' ? { stdout: '', code: 0 } : fake(file, args, ms, signal);
      };
      const actions = new Actions(selected.store, config(), runner, local, () => at);
      const pending = actions.execute(parseAction(action, config()));
      await guardStarted; // revision and target were selected synchronously.
      selected.store.accept(replacement); release();
      const response = await pending;
      assert.equal(response.status, 200);
      const result = JSON.parse(response.body);
      assert.equal('expectedInventoryRevision' in result, false, 'dispatch field is not echoed');
      assert.equal(result.inventoryRevision, 1, 'result identifies the selected snapshot, not the later reload');
      assert.equal(selected.store.extras().actions[0].inventoryRevision, 1);
      const probe = selectedCommands.find(([file]) => file === (kind === 'port' ? '/usr/bin/nc' : '/sbin/ping'));
      assert(probe[1].includes('192.0.2.10'));
      assert(!probe[1].includes('192.0.2.11'), 'a later reload cannot retarget the diagnostic');
    } finally { release?.(); selected.close(); }
  }
});
