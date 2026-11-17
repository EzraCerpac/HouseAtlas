import { DatabaseSync } from 'node:sqlite';
import { existsSync, openSync, closeSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { need, privateDirectory } from './config.ts';
import type { Config } from './config.ts';
import { canonical, validateInventory } from './inventory.ts';
import type { Inventory } from './inventory.ts';

export type State = 'reachable' | 'no-reply' | 'not-measured';
export type Fact = { state: State; latencyMs: number | null; loss: number | null; measuredAt: string | null; recordedAt: string; reason: string | null };
export type Guard = 'home' | 'not-at-home' | 'unknown';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    privateDirectory(dirname(path));
    if (existsSync(path)) {
      const s = lstatSync(path);
      need(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && (s.mode & 0o7777) === 0o600 && s.uid === process.geteuid?.(), 'Store must be an owned regular 0600 file');
    }
    else closeSync(openSync(path, 'wx', 0o600));
    this.db = new DatabaseSync(path);
    try {
      // A process-lifetime SQLite exclusive lock, including between cycles.
      // A second collector refuses rather than sharing writer ownership.
      this.db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; COMMIT;');
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      if (tables.length === 0) this.db.exec(`BEGIN EXCLUSIVE;
        CREATE TABLE schema_version(version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES(1);
        CREATE TABLE inventory(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE collector(id INTEGER PRIMARY KEY CHECK(id=1), last_cycle TEXT NOT NULL, guard TEXT NOT NULL);
        CREATE TABLE ping_samples(device TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(device,at));
        CREATE INDEX ping_time ON ping_samples(at);
        CREATE TABLE ping_hourly(device TEXT NOT NULL, hour INTEGER NOT NULL, reachable INTEGER NOT NULL, no_reply INTEGER NOT NULL, not_measured INTEGER NOT NULL, sum REAL NOT NULL, min REAL, max REAL, loss_sum REAL NOT NULL, PRIMARY KEY(device,hour));
        COMMIT;`);
      // Add future forward-only migrations here, inside transactions. Never
      // reinterpret an old application's store or silently open a newer schema.
      const versions = this.db.prepare('SELECT version FROM schema_version').all();
      need(versions.length === 1 && [1, 2, 3].includes(Number(versions[0]!.version)), 'Unsupported collector schema version');
      if (versions[0]!.version === 1) this.db.exec(`BEGIN EXCLUSIVE;
        CREATE TABLE extra(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX extra_kind ON extra(kind,id);
        CREATE TABLE nightly(id INTEGER PRIMARY KEY CHECK(id=1), date TEXT NOT NULL);
        UPDATE schema_version SET version=2; COMMIT;`);
      if (Number(versions[0]!.version) < 3) this.transaction(() => {
        for (const row of this.db.prepare("SELECT id,kind,data FROM extra WHERE kind IN ('speed','action')").all()) {
          const data = JSON.parse(String(row.data));
          const speed = row.kind === 'speed' ? data : data.kind === 'speed' ? data.result : null;
          if (!speed) continue;
          for (const [old, name] of [['downloadBps', 'downloadBitsPerSecond'], ['uploadBps', 'uploadBitsPerSecond']] as const) {
            if (Object.hasOwn(speed, old)) { speed[name] = speed[old]; delete speed[old]; }
          }
          this.db.prepare('UPDATE extra SET data=? WHERE id=?').run(JSON.stringify(data), Number(row.id));
        }
        this.db.exec('UPDATE schema_version SET version=3');
      });
    } catch (e) { this.db.close(); throw e; }
  }
  transaction(fn: () => void) {
    this.db.exec('BEGIN EXCLUSIVE');
    try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  inventory(): Inventory | null {
    const r = this.db.prepare('SELECT data FROM inventory WHERE id=1').get();
    return r ? validateInventory(JSON.parse(String(r.data))) : null;
  }
  accept(doc: Inventory) {
    doc = validateInventory(doc);
    this.transaction(() => {
      const previous = this.inventory();
      if (previous) {
        need(doc.revision >= previous.revision, 'Inventory revision regressed');
        const same = canonical(doc.inventory) === canonical(previous.inventory);
        need(doc.revision !== previous.revision || same, 'Repeated inventory revision changed content');
        need(doc.revision === previous.revision || !same, 'Inventory revision increased without content change');
      }
      this.db.prepare('INSERT INTO inventory VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(doc.revision, canonical(doc));
    });
  }
  record(at: number, guard: Guard, facts: Map<string, Fact>, config: Pick<Config, 'rawDays' | 'hourlyMonths'>) {
    this.transaction(() => {
      this.db.prepare('INSERT INTO collector VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET last_cycle=excluded.last_cycle,guard=excluded.guard').run(new Date(at).toISOString(), guard);
      for (const [device, fact] of facts) {
        // Index by this fact's observation time, not the cycle start.
        // Repeated observation timestamps must not overwrite or double-count.
        const observedAt = Date.parse(fact.recordedAt);
        need(Number.isFinite(observedAt), 'Invalid sample observation timestamp');
        const inserted = this.db.prepare('INSERT OR IGNORE INTO ping_samples VALUES(?,?,?)').run(device, observedAt, JSON.stringify(fact));
        if (!inserted.changes) continue;
        const n = fact.state === 'reachable' ? 1 : 0;
        this.db.prepare(`INSERT INTO ping_hourly VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(device,hour) DO UPDATE SET
          reachable=reachable+excluded.reachable,no_reply=no_reply+excluded.no_reply,not_measured=not_measured+excluded.not_measured,
          sum=sum+excluded.sum,min=CASE WHEN min IS NULL THEN excluded.min WHEN excluded.min IS NULL THEN min ELSE MIN(min,excluded.min) END,
          max=CASE WHEN max IS NULL THEN excluded.max WHEN excluded.max IS NULL THEN max ELSE MAX(max,excluded.max) END,loss_sum=loss_sum+excluded.loss_sum`).run(
          device, Math.floor(observedAt / HOUR) * HOUR, n, fact.state === 'no-reply' ? 1 : 0, fact.state === 'not-measured' ? 1 : 0,
          fact.latencyMs ?? 0, fact.latencyMs, fact.latencyMs, fact.loss ?? 0);
      }
      this.db.prepare('DELETE FROM ping_samples WHERE at<?').run(at - config.rawDays * DAY);
      const cutoff = new Date(at); cutoff.setUTCMonth(cutoff.getUTCMonth() - config.hourlyMonths);
      this.db.prepare('DELETE FROM ping_hourly WHERE hour<?').run(cutoff.getTime());
    });
  }
  status() {
    const r = this.db.prepare('SELECT last_cycle,guard FROM collector WHERE id=1').get();
    return { lastCycleAt: r?.last_cycle ?? null, guardOutcome: r?.guard ?? 'unknown', schemaVersion: 1 };
  }
  measurements(now: number, doc: Inventory) {
    const devices = Object.create(null);
    for (const d of doc.inventory.devices) {
      const latest = this.db.prepare('SELECT data FROM ping_samples WHERE device=? ORDER BY at DESC LIMIT 1').get(d.id);
      const hourly = (days: number) => this.db.prepare('SELECT * FROM ping_hourly WHERE device=? AND hour>=? AND hour<=? ORDER BY hour LIMIT 2161').all(d.id, now - days * DAY, now).map(r => {
        const measured = Number(r.reachable) + Number(r.no_reply);
        return { hour: new Date(Number(r.hour)).toISOString(), state: measured ? 'measured' : 'not-measured', reachable: r.reachable, noReply: r.no_reply, notMeasured: r.not_measured,
          minMs: r.min, meanMs: Number(r.reachable) ? Number(r.sum) / Number(r.reachable) : null, maxMs: r.max, loss: measured ? Number(r.loss_sum) / measured : null };
      });
      devices[d.id] = {
        latest: latest ? JSON.parse(String(latest.data)) : { state: 'not-measured', latencyMs: null, loss: null, measuredAt: null, recordedAt: null, reason: 'no-history' },
        series24h: this.db.prepare('SELECT data FROM ping_samples WHERE device=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 1441').all(d.id, now - DAY, now).reverse().map(r => JSON.parse(String(r.data))),
        series24hTruncated: Number(this.db.prepare('SELECT count(*) AS n FROM ping_samples WHERE device=? AND at>=? AND at<=?').get(d.id, now - DAY, now)!.n) > 1441,
        hourly7d: hourly(7), hourly90d: hourly(90),
      };
    }
    return { version: 1, inventoryRevision: doc.revision, generatedAt: new Date(now).toISOString(), collector: this.status(), devices };
  }
  recordExtra(kind: 'speed' | 'wifi' | 'action', data: unknown) {
    const limit = kind === 'speed' ? 400 : kind === 'wifi' ? 24 : 200;
    this.transaction(() => {
      this.db.prepare('INSERT INTO extra(kind,data) VALUES(?,?)').run(kind, JSON.stringify(data));
      this.db.prepare('DELETE FROM extra WHERE kind=? AND id NOT IN (SELECT id FROM extra WHERE kind=? ORDER BY id DESC LIMIT ?)').run(kind, kind, limit);
    });
  }
  recentExtra(kind: string, limit: number): any[] {
    return this.db.prepare('SELECT data FROM extra WHERE kind=? ORDER BY id DESC LIMIT ?').all(kind, limit).map(r => JSON.parse(String(r.data)));
  }
  lastNight(): string | null { return this.db.prepare('SELECT date FROM nightly WHERE id=1').get()?.date as string ?? null; }
  claimNight(date: string) { this.db.prepare('INSERT INTO nightly VALUES(1,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date').run(date); }
  extras() {
    const speed = this.recentExtra('speed', 400);
    return { version: 1, speed: { latest: speed[0] ?? null, recent: speed }, wifi: { latest: this.recentExtra('wifi', 1)[0] ?? null }, actions: this.recentExtra('action', 200) };
  }
  close() { this.db.close(); }
}
