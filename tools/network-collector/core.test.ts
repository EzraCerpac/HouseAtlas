import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, readPrivate, loadConfig, parseJson } from './config.ts';
import { canonical, validateInventory, targets } from './inventory.ts';
import { Store } from './store.ts';
import { collect, parsePing, homeGuard, unmeasured } from './collect.ts';
import type { Runner } from './collect.ts';
import { reply } from './http.ts';
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
    for (const [offset, fact] of [[0, parsePing(success(2), at)], [60_000, parsePing(success(4), at)], [120_000, parsePing({ stdout: '1 packets transmitted, 0 received', code: 1 }, at)], [180_000, unmeasured(at, 'not-at-home')]] as const) f.store.record(at + offset, 'home', new Map([['device', fact]]), config());
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
