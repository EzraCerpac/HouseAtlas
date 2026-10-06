import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { migrate, DATABASE_VERSION, MIGRATIONS } from '../src/migrations.mjs';
import { AtlasStore, options, seeded, fixture, temporary, scope, principal, ref, guard, createCircuit, circuitTarget, U } from './helpers.mjs';
const worker = fileURLToPath(new URL('./process-worker.mjs', import.meta.url));
function killWriter(args) {
  const result = spawnSync(process.execPath, [worker, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, 'SIGKILL', result.stderr); return result;
}
test('real process interruption before commit rolls back records/audit/receipts/WAL across reopen', () => {
  for (const phase of ['after-record','after-audit','after-receipt','before-commit']) {
    const { path, store } = seeded(), before = store.readSnapshot(principal, scope); store.close();
    killWriter(['interrupt', path, phase]);
    const reopened = new AtlasStore(options(path)); assert.deepEqual(reopened.readSnapshot(principal, scope), before);
    const result = reopened.execute(principal, scope, circuitTarget, createCircuit());
    assert.equal(result.replayed, false); assert.equal(reopened.history(principal, scope, circuitTarget).length, 1); reopened.close();
  }
});
test('lost process response after commit replays the durable single and batch receipts without new audit', () => {
  for (const batched of [false, true]) {
    const { path, dir, store } = seeded(); store.close();
    const envelope = JSON.parse(readFileSync(new URL('../../contracts/fixtures/import-remap.batch.json', import.meta.url)));
    const payloadFile = `${dir}/batch.json`; writeFileSync(payloadFile, JSON.stringify(envelope));
    killWriter(['lost-response', path, '', ...(batched ? [payloadFile] : [])]);
    const reopened = new AtlasStore(options(path));
    const result = batched ? reopened.executeBatch(principal, scope, envelope) : reopened.execute(principal, scope, circuitTarget, createCircuit());
    assert.equal(result.replayed, true);
    const targets = batched ? envelope.commands.map(c => c.target) : [circuitTarget];
    for (const target of targets) assert.equal(reopened.history(principal, scope, target).length, 1);
    reopened.close();
  }
});
function legacy(path) {
  const db = new DatabaseSync(path); migrate(db, { targetVersion: 1 });
  const input = fixture('optional-geometry');
  for (const r of input.sources) db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(r.workspaceId, r.homeId, r.sourceInstanceId, r.collectionId, JSON.stringify(r));
  for (const r of input.records) db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(r.workspaceId, r.homeId, r.recordId, r.recordType, r.revision, JSON.stringify(r));
  for (const r of input.records.filter(r => r.recordType === 'binding')) {
    const s = r.payload.source;
    db.prepare('INSERT INTO binding_reservations VALUES(?,?,?,?,?,?,?,?)').run(r.workspaceId, r.homeId, r.recordId, s.sourceInstanceId, s.collectionId, s.sourceKind, s.externalId, r.payload.atlasId);
  }
  db.close(); return input;
}
test('version 1 migrates retained identities/reservations and original asset manifests to the current schema', () => {
  const { path } = temporary(), input = legacy(path);
  const store = new AtlasStore(options(path)); assert.equal(store.databaseVersion, DATABASE_VERSION);
  const before = input.records.find(r => r.recordId === U(600));
  assert.deepEqual(store.readRecord(principal, scope, ref('asset', 600)), before);
  assert.deepEqual(store.readAssetManifest(principal, scope, ref('asset', 600)), before.payload); store.close();
  const db = new DatabaseSync(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_VERSION);
  assert.equal(db.prepare('SELECT count(*) n FROM binding_reservations').get().n, 3);
  assert.deepEqual(db.prepare('SELECT sha256 FROM atlas_migrations ORDER BY version').all().map(r => r.sha256), MIGRATIONS.map(m => m.sha256)); db.close();
});
test('interrupted migration rolls back schema, backfill and version together, then reopens successfully', () => {
  const { path } = temporary(); legacy(path);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {AtlasStore} from ${JSON.stringify(fileURLToPath(new URL('../src/index.mjs', import.meta.url)))};
    new AtlasStore({path:${JSON.stringify(path)}, authorize:()=>({}), fault:(phase)=>{
      if(phase==='migration-before-commit') process.kill(process.pid,'SIGKILL');
    }});`], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  const db = new DatabaseSync(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='receipts'").get(), undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM records').get().n, fixture('optional-geometry').records.length); db.close();
  const store = new AtlasStore(options(path)); assert.equal(store.databaseVersion, DATABASE_VERSION); store.close();
});
test('thrown migration fault permits old code rollback without a partially upgraded schema', () => {
  const { path } = temporary(); legacy(path); const db = new DatabaseSync(path);
  assert.throws(() => migrate(db, { fault: () => { throw new Error('DDL backfill fault'); } }), /DDL/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  migrate(db, { targetVersion: 1 }); db.close();
  const store = new AtlasStore(options(path)); store.close();
});
test('unknown schema, altered migration history and incompatible rollback fail closed', () => {
  for (const kind of ['future','history','unknown','contract']) {
    const { path } = temporary(); const db = new DatabaseSync(path);
    if (kind !== 'unknown') migrate(db);
    if (kind === 'future') db.exec('PRAGMA user_version=99');
    if (kind === 'history') db.exec("UPDATE atlas_migrations SET sha256='tampered' WHERE version=1");
    if (kind === 'unknown') db.exec('CREATE TABLE somebody_elses_state(id INTEGER)');
    if (kind === 'contract') db.exec("UPDATE atlas_metadata SET value='2.0.0' WHERE key='contractVersion'");
    db.close(); assert.throws(() => new AtlasStore(options(path)), e => e.code === 'schema-incompatible');
  }
  const { path } = temporary(); const db = new DatabaseSync(path); migrate(db);
  assert.throws(() => migrate(db, { targetVersion: 1 }), e => e.code === 'schema-incompatible');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_VERSION); db.close();
});
async function racing(path, payloads, dir) {
  const children = payloads.map((payload, i) => {
    const file = `${dir}/race-${i}.json`; writeFileSync(file, JSON.stringify(payload));
    const child = spawn(process.execPath, [worker, 'race', path, '', file], { stdio: ['pipe','pipe','pipe'] });
    let output = '', errors = '';
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready\n')) resolve(); });
      child.on('error', reject);
    });
    child.stderr.on('data', chunk => { errors += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on('exit', code => code === 0 ? resolve(JSON.parse(output.trim().split('\n').at(-1))) : reject(new Error(errors)));
      child.on('error', reject);
    });
    return { child, ready, done };
  });
  await Promise.all(children.map(c => c.ready)); children.forEach(c => c.child.stdin.end('go\n'));
  return Promise.all(children.map(c => c.done));
}
test('concurrent process uniqueness races reserve a source key and permanent record ID once', { timeout: 15000 }, async () => {
  for (const kind of ['source','record']) {
    const { store, path, dir } = seeded(); const source = fixture('plan-free').records.find(r => r.recordId === U(302)).payload;
    source.source.externalId = 'synthetic-new-device'; store.close();
    const payloads = [0,1].map(i => kind === 'source' ? {
      target: ref('binding', 990 + i), command: { ...createCircuit(1200 + i), guards: [guard('identity', 201), guard('evidence', 100)], value: { recordType: 'binding', payload: source } },
    } : { target: circuitTarget, command: createCircuit(1200 + i) });
    const outcomes = await racing(path, payloads, dir);
    assert.equal(outcomes.filter(r => r.result).length, 1); assert.equal(outcomes.filter(r => r.code === 'identity-conflict').length, 1);
    const reopened = new AtlasStore(options(path)), s = reopened.readSnapshot(principal, scope);
    const records = kind === 'source' ? s.records.filter(r => r.recordType === 'binding' && r.payload.source.externalId === 'synthetic-new-device') : s.records.filter(r => r.recordId === circuitTarget.recordId);
    assert.equal(records.length, 1); assert.equal(reopened.history(principal, scope, { recordType: records[0].recordType, recordId: records[0].recordId }).length, 1); reopened.close();
  }
});
