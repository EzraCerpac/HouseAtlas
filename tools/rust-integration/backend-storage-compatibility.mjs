// PREPARED ONLY. No default execution; see the adjacent cases/review contract.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants, closeSync, fstatSync, ftruncateSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  writeFileSync, writeSync,
} from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINS = {
  old: { source: '20acc832919f4d5b7ec93e6d6641660f999e7688', bytes: 40994600,
    sha256: '2699f230c03084b1ecb1f86b577615a25a51470fe2c2bd994d0fdcb0452db7d0' },
  new: { source: 'd36a48546a92b58cb3c515d8034272dfa1d92e5a', bytes: 41093032,
    sha256: '107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941' },
};
const CASES = ['empty', 'populated', 'committed-wal'];
const MAX_FILE = 64 * 1024 * 1024, MAX_OUTPUT = 4 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const prefix = `/api/atlas/v1/workspaces/${id(1)}/homes/${id(2)}`;
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(['--case', '--old-binary', '--new-binary', '--old-sha256', '--new-sha256',
    '--python', '--openssl', '--acknowledge'].includes(key) && value && !options.has(key),
  'Select one documented healthy case and all exact options; no default or broad suite');
  options.set(key, value);
}
assert.equal(options.size, 8, 'All eight documented options are required');
assert(CASES.includes(options.get('--case')), 'Explicit healthy case required');
assert.equal(options.get('--acknowledge'), 'generated-only-after-independent-review');
assert.equal(process.platform, 'darwin', 'Exact delivered artifacts require a separately released Intel Mac executor');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v26.10.0');
for (const role of ['old', 'new']) assert.equal(options.get(`--${role}-sha256`), PINS[role].sha256);
process.umask(0o077);

// Canonical names, no symlink component, no writable ancestry except system sticky tmp.
function checked(path, executable = false) {
  assert(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'Canonical absolute path required');
  let current = path;
  while (true) {
    const s = lstatSync(current);
    assert(!s.isSymbolicLink(), 'Symlink component refused');
    assert([0, process.getuid()].includes(s.uid), 'Unexpected path owner');
    assert(!(s.mode & 0o022) || (s.isDirectory() && (s.mode & 0o1000) && s.uid === 0), 'Writable path ancestry refused');
    if (current === '/') break;
    current = dirname(current);
  }
  const s = lstatSync(path);
  assert(s.isFile() && s.nlink === 1 && s.size <= MAX_FILE, 'Regular single-link bounded file required');
  if (executable) assert(s.mode & 0o111, 'Existing executable required');
  return s;
}
function bytes(path) {
  const named = checked(path), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    assert.equal(before.ino, named.ino); assert.equal(before.dev, named.dev);
    const data = readFileSync(fd), after = fstatSync(fd), end = lstatSync(path);
    assert.equal(data.length, before.size);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      assert.equal(before[key], after[key]); assert.equal(before[key], end[key]);
    }
    return data;
  } finally { closeSync(fd); }
}
const selected = {};
for (const role of ['old', 'new']) {
  const path = options.get(`--${role}-binary`), metadata = checked(path, true), data = bytes(path);
  assert.equal(metadata.size, PINS[role].bytes); assert.equal(hash(data), PINS[role].sha256);
  selected[role] = { path, metadata, data };
}
assert(selected.old.metadata.dev !== selected.new.metadata.dev || selected.old.metadata.ino !== selected.new.metadata.ino,
  'Artifact aliases refused');
const python = options.get('--python'), openssl = options.get('--openssl');
checked(python, true); checked(openssl, true);
assert.equal(realpathSync('/private/tmp'), '/private/tmp');
const root = mkdtempSync('/private/tmp/houseatlas-generated-storage-');
const rootStat = lstatSync(root);
assert.equal(rootStat.mode & 0o777, 0o700);
const receipt = { format: 'houseatlas-generated-storage-compatibility/1', status: 'in-progress',
  case: options.get('--case'), pins: PINS, root, startedAt: new Date().toISOString(),
  harnessSha256: hash(bytes(realpathSync(fileURLToPath(import.meta.url)))),
  artifacts: Object.fromEntries(Object.entries(selected).map(([role, value]) => [role, {
    path: value.path, dev: value.metadata.dev, ino: value.metadata.ino,
  }])), tools: { python, openssl, nodeVersion: process.version },
  processes: [], observations: [], exclusions: 'See backend-storage-compatibility-cases.md' };
const owned = new Set();
function fence(path) {
  assert(path.startsWith(root + '/') && resolve(path) === path, 'Generated path escaped owned root');
  const s = lstatSync(root);
  assert.equal(s.dev, rootStat.dev); assert.equal(s.ino, rootStat.ino);
}
function put(path, data, mode = 0o600) {
  fence(path); writeFileSync(path, data, { flag: 'wx', mode });
}
function directory(path) { fence(path); mkdirSync(path, { mode: 0o700 }); }
let receiptNumber = 0;
function persist() {
  // Exclusive numbered receipts survive a later write failure or uncertain close.
  const path = join(root, `receipt-${String(++receiptNumber).padStart(3, '0')}.json`);
  put(path, JSON.stringify(receipt, null, 2) + '\n');
}
for (const leaf of ['home', 'tmp', 'frontend', 'bin']) directory(join(root, leaf));
const env = { HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
for (const role of ['old', 'new']) {
  put(join(root, 'bin', role), selected[role].data, 0o700);
  delete selected[role].data;
}
put(join(root, 'frontend', 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');

// Inline Python is a reviewed tool body, never evaluated by preparation checks.
// Read-only observations use disposable copies; immutable=1 would ignore WAL.
const SQLITE_TOOL = String.raw`
import json, os, sqlite3, sys
from pathlib import Path
action, directory = sys.argv[1:]
base = Path(directory)
assert base.is_absolute() and str(base.resolve()) == directory
assert directory.startswith('/private/tmp/houseatlas-generated-storage-')
connections = []
for name in ['atlas.sqlite', 'access.sqlite']:
    path = base / name
    s = path.lstat()
    assert path.is_file() and not path.is_symlink() and s.st_nlink == 1
    assert s.st_uid == os.getuid() and s.st_mode & 0o777 == 0o600
    db = sqlite3.connect(path.as_uri() + ('?mode=rw' if action == 'hold-wal' else '?mode=ro'), uri=True, timeout=2)
    connections.append((name, db))
if action == 'hold-wal':
    for name, db in connections:
        assert db.execute('PRAGMA main.journal_mode=WAL').fetchall() == [('wal',)]
        db.execute('PRAGMA wal_autocheckpoint=0')
    print('WAL_KEEPER_READY', flush=True)
    assert sys.stdin.readline() == 'close\n'
    for name, db in connections:
        db.close()
    print('WAL_KEEPER_CLOSED', flush=True)
else:
    assert action == 'observe'
    result = {'sqliteVersion': sqlite3.sqlite_version, 'stores': {}}
    def enc(v):
        return {'blobHex': v.hex()} if isinstance(v, bytes) else v
    def quote(v):
        return '"' + v.replace('"', '""') + '"'
    for name, db in connections:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        attached = db.execute('PRAGMA database_list').fetchall()
        assert len(attached) == 1 and attached[0][1] == 'main'
        integrity = db.execute('PRAGMA main.integrity_check').fetchall()
        foreign = db.execute('PRAGMA main.foreign_key_check').fetchall()
        # A successful CLI/SQL exit, absent result, or unrecognized PRAGMA is insufficient.
        assert integrity == [('ok',)], repr(integrity)
        assert foreign == [], repr(foreign)
        schema = db.execute('SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name').fetchall()
        tables = {}
        for kind, table, _, sql in schema:
            if kind != 'table':
                continue
            columns = [r[1] for r in db.execute('PRAGMA main.table_info(' + quote(table) + ')')]
            rows = [[enc(v) for v in row] for row in db.execute('SELECT * FROM main.' + quote(table))]
            rows.sort(key=lambda r: json.dumps(r, ensure_ascii=True, separators=(',', ':')))
            tables[table] = {'columns': columns, 'rows': rows,
                'foreignKeys': db.execute('PRAGMA main.foreign_key_list(' + quote(table) + ')').fetchall()}
        result['stores'][name] = {'integrity': integrity, 'foreignKeyCheck': foreign, 'schema': schema,
            'userVersion': db.execute('PRAGMA main.user_version').fetchone()[0],
            'applicationId': db.execute('PRAGMA main.application_id').fetchone()[0],
            'journalMode': db.execute('PRAGMA main.journal_mode').fetchone()[0],
            'pageCount': db.execute('PRAGMA main.page_count').fetchone()[0],
            'freelistCount': db.execute('PRAGMA main.freelist_count').fetchone()[0], 'tables': tables}
        db.rollback()
        db.close()
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
`;
const sqlitePath = join(root, 'sqlite-tool.py');
put(sqlitePath, SQLITE_TOOL);
receipt.sqliteToolSha256 = hash(SQLITE_TOOL);
function launch(executable, args, label, lifetime = 35000) {
  assert(!receipt.interruption, 'Interrupted run cannot launch more work');
  if (executable === join(root, 'bin', 'old') || executable === join(root, 'bin', 'new')) {
    const role = executable.endsWith('/old') ? 'old' : 'new';
    assert.equal(hash(bytes(executable)), PINS[role].sha256);
  } else checked(executable, true);
  const record = { label, executable, args, startedAt: new Date().toISOString(), status: 'starting' };
  receipt.processes.push(record);
  const child = spawn(executable, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const item = { child, record, out: '', err: '', closed: false, failed: null };
  owned.add(item); record.pid = child.pid ?? null;
  const timeout = setTimeout(() => {
    item.failed ??= new Error(`${label}: deadline; outcome uncertain`);
    record.status = 'uncertain'; child.kill('SIGTERM');
  }, lifetime);
  const forced = setTimeout(() => { if (!item.closed) child.kill('SIGKILL'); }, lifetime + 7000);
  for (const [stream, key] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', chunk => {
    item[key] += chunk.toString('utf8');
    if (Buffer.byteLength(item.out) + Buffer.byteLength(item.err) > MAX_OUTPUT) {
      item[key] = item[key].slice(0, MAX_OUTPUT / 2);
      item.failed ??= new Error(`${label}: output bound; outcome uncertain`);
      child.kill('SIGTERM');
    }
  });
  child.stdin.on('error', error => { item.failed ??= error; });
  child.on('error', error => { item.failed ??= error; });
  item.done = new Promise(resolveDone => child.on('close', (code, signal) => {
    clearTimeout(timeout); clearTimeout(forced); item.closed = true; owned.delete(item);
    Object.assign(record, { code, signal, status: item.failed ? 'uncertain' : code === 0 ? 'closed' : 'failed',
      stdout: item.out, stderr: item.err, endedAt: new Date().toISOString() });
    resolveDone();
  }));
  persist();
  return item;
}
async function finish(item) {
  await item.done;
  if (item.failed) throw item.failed;
  assert.equal(item.record.code, 0, `${item.record.label}: nonzero/uncertain outcome; retain root and stop`);
}
async function command(executable, args, label) {
  const item = launch(executable, args, label); item.child.stdin.end(); await finish(item); return item.out;
}
const pause = () => new Promise(r => setTimeout(r, 25));
async function ready(item, marker) {
  const deadline = Date.now() + 15000;
  while (!item.out.includes(marker)) {
    if (item.closed || item.failed) throw item.failed ?? new Error(`${item.record.label}: closed before readiness`);
    assert(Date.now() < deadline, `${item.record.label}: readiness uncertain`); await pause();
  }
  assert(!item.closed && !item.failed, 'Owned listener must still be running');
}
async function stop(item) {
  assert(!item.closed && !item.failed, 'Unexpected pre-shutdown process outcome');
  item.child.kill('SIGTERM'); await finish(item);
  assert(item.out.includes('persistent server listening on'), 'Persistent startup marker missing');
  const events = bytes(join(item.data, 'logs', 'server.events.jsonl')).toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).format, 'houseatlas-server-event/1');
  assert.equal(events.at(-1).event, 'graceful-shutdown', 'Clean owner closure event required');
}
// All copies are owned, quiescent generated trees; no arbitrary source-store argument exists.
function tree(path, target) {
  fence(path); if (target) directory(target);
  const files = []; let total = 0;
  function walk(source, destination, relative = '') {
    const s = lstatSync(source);
    assert(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
    for (const name of readdirSync(source).sort()) {
      assert(!name.includes('/') && name !== '.' && name !== '..');
      const from = join(source, name), to = destination && join(destination, name), key = relative + name;
      const metadata = lstatSync(from);
      if (metadata.isDirectory()) {
        assert(['logs', 'media', 'media/blobs', 'media/staging'].includes(key), 'Unexpected persistent directory');
        if (to) directory(to); walk(from, to, key + '/');
      }
      else {
        const data = bytes(from); total += data.length;
        assert(total <= 128 * 1024 * 1024 && files.length < 256, 'Generated tree budget');
        files.push({ path: key, bytes: data.length, sha256: hash(data), mode: metadata.mode & 0o777 });
        if (to) put(to, data);
      }
    }
  }
  walk(path, target);
  const required = ['atlas.sqlite', 'access.sqlite', 'server-state.json', 'server.lock', 'logs/server.events.jsonl'];
  for (const name of required) assert(files.some(file => file.path === name), 'Required generated member missing');
  assert(files.every(file => required.includes(file.path) || /^(atlas|access)\.sqlite-(wal|shm)$/.test(file.path)),
    'Unexpected persistent member or media byte: retain and stop');
  return files;
}
let observation = 0;
async function observe(data, label) {
  const copy = join(root, `observation-${++observation}`);
  const files = tree(data, copy);
  const result = JSON.parse(await command(python, ['-I', '-S', sqlitePath, 'observe', copy], label));
  receipt.observations.push({ label, files, result }); persist(); return result;
}
// SQL bodies overwrite only the new initializer's owned inodes. Its genuine receipt stays intact.
function installBodies(baseline, data) {
  for (const name of ['atlas.sqlite', 'access.sqlite']) {
    const destination = join(data, name), before = checked(destination), content = bytes(join(baseline, name));
    const fd = openSync(destination, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      assert.equal(fstatSync(fd).ino, before.ino); assert.equal(fstatSync(fd).dev, before.dev);
      ftruncateSync(fd, 0);
      let offset = 0;
      while (offset < content.length) offset += writeSync(fd, content, offset, content.length - offset);
    } finally { closeSync(fd); }
    assert.equal(lstatSync(destination).ino, before.ino);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      assert(!readdirSync(data).includes(name + suffix), 'Unexpected initializer companion; stop without deletion');
    }
    if (readdirSync(baseline).includes(name + '-wal')) put(destination + '-wal', bytes(join(baseline, name + '-wal')));
    // SHM is a rebuildable index; the preserved baseline retains its original bytes.
  }
}
function comparable(snapshot) {
  return structuredClone(Object.fromEntries(Object.entries(snapshot.stores).map(([name, store]) => [name, {
    schema: store.schema, userVersion: store.userVersion, applicationId: store.applicationId,
    journalMode: store.journalMode, tables: store.tables,
  }])));
}
function compare(before, after, window) {
  const a = comparable(before), b = comparable(after);
  // Every row/column remains compared. Only source-proven auth writes are admitted below.
  const sessions = store => store['access.sqlite'].tables.access_sessions;
  assert.deepEqual(sessions(a).columns, sessions(b).columns);
  assert.equal(sessions(a).rows.length, 1); assert.equal(sessions(b).rows.length, 1);
  const seen = sessions(a).columns.indexOf('last_seen');
  const previous = sessions(a).rows[0][seen], current = sessions(b).rows[0][seen];
  assert(current >= previous && current <= window.end && current >= window.start, 'Only current monotone last_seen admitted');
  sessions(b).rows[0][seen] = previous;
  const ratesA = a['access.sqlite'].tables.access_rates, ratesB = b['access.sqlite'].tables.access_rates;
  assert.deepEqual(ratesA.columns, ['bucket', 'starts_at', 'expires_at', 'count']);
  assert.deepEqual(ratesA.columns, ratesB.columns);
  const bucket = hash(`request:user:${id(4)}`), oldRates = new Map(ratesA.rows.map(r => [r[0], r]));
  for (const row of ratesB.rows) {
    const old = oldRates.get(row[0]);
    if (row[0] !== bucket) { assert(old); assert.deepEqual(row, old); }
    else {
      assert(row[1] <= window.end && row[2] === row[1] + 60000 && row[3] > 0 && row[3] <= 300);
      if (old && row[1] === old[1]) {
        assert(old[2] > window.start); assert.equal(row[3], old[3] + window.authentications);
      } else {
        assert(row[1] >= window.start);
        assert(row[3] <= window.authentications, 'New request window cannot exceed observed authentications');
      }
    }
  }
  assert(ratesB.rows.some(r => r[0] === bucket), 'Expected request rate row');
  for (const row of ratesA.rows) {
    if (!ratesB.rows.some(r => r[0] === row[0])) assert(row[2] <= window.end, 'Only expired rate rows may disappear');
  }
  // Detailed raw rate and last_seen deltas stay in the observation receipts.
  delete a['access.sqlite'].tables.access_rates; delete b['access.sqlite'].tables.access_rates;
  assert.deepEqual(b, a, 'Unexpected schema, row, reference or authority change');
}

let origin, port, cookie, csrf, activeWindow;
async function request(path, body) {
  assert(!receipt.interruption, 'Interrupted run cannot make more requests');
  assert(path.startsWith('/api/atlas/') && !path.includes('://') && !path.includes('..'));
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return await new Promise((resolveRequest, reject) => {
    const headers = { origin, 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}),
      ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length, ...(csrf ? { 'x-atlas-csrf': csrf } : {}) } : {}) };
    const req = https.request({ host: '127.0.0.1', port, path, method: payload ? 'POST' : 'GET',
      ca: bytes(join(root, 'cert.pem')), agent: false, headers }, response => {
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > MAX_OUTPUT) response.destroy(new Error('HTTP response bound')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200, `Unexpected HTTP outcome: ${path}; no retry`);
          if (activeWindow) activeWindow.authentications += path.startsWith('/api/atlas/offline/') ? 2 : 1;
          resolveRequest({ body: Buffer.concat(chunks), headers: response.headers });
        } catch (error) { reject(error); }
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error('HTTP deadline; outcome uncertain; no retry')), 5000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end(payload);
  });
}
const json = async (path, body) => JSON.parse((await request(path, body)).body.toString());
async function reads(expected) {
  const page = await json(prefix + '/records?limit=100');
  assert.equal(page.contractVersion, '1.0.0'); assert.equal(page.nextCursor, null);
  assert.deepEqual([...page.items].sort((a, b) => a.recordId.localeCompare(b.recordId)), expected);
  const histories = [];
  for (const record of expected) {
    const path = `${prefix}/records/${record.recordType}/${record.recordId}`;
    assert.deepEqual(await json(path), record);
    const history = await json(path + '/history');
    assert.equal(history.length, 1); assert.equal(history[0].auditId, record.lastAuditId);
    assert.equal(history[0].actorId, id(5)); histories.push(history);
  }
  for (const collection of ['homebox/entities', 'network/relations']) {
    const empty = await json(prefix + '/' + collection + '?limit=100');
    assert.deepEqual(empty.items, []); assert.equal(empty.nextCursor, null);
  }
  return { records: page.items, histories };
}
async function identityExport(expectedBody) {
  const base = `/api/atlas/offline/v1/workspaces/${id(1)}/homes/${id(2)}`;
  const manifest = await json(base + '/manifest');
  assert.equal(manifest.profile, 'houseatlas.home-read-pack.v1');
  assert.match(manifest.snapshotId, /^[a-f0-9]{64}$/);
  assert.equal(manifest.sections.atlas.state, 'complete');
  const get = async sha => {
    assert.match(sha, /^[a-f0-9]{64}$/);
    const resource = manifest.resources.find(r => r.sha256 === sha); assert(resource);
    const result = await request(`${base}/snapshots/${manifest.snapshotId}/resources/${sha}`);
    assert.equal(hash(result.body), sha); assert.equal(result.body.length, resource.bytes); return result.body;
  };
  const atlas = JSON.parse((await get(manifest.sections.atlas.resourceSha256)).toString());
  if (expectedBody === null) assert.equal(atlas.retainedIdentityBodies, undefined);
  else {
    const descriptor = atlas.retainedIdentityBodies;
    assert.equal(descriptor.profile, 'houseatlas.home-read-pack.retained-identity-bodies.v1');
    assert.deepEqual(descriptor.omissions, []); assert.equal(descriptor.members.length, 1);
    const body = Buffer.from(expectedBody), member = descriptor.members[0];
    assert.equal(member.recordId, id(200)); assert.equal(member.recordType, 'identity');
    assert.equal(member.workspaceId, id(1)); assert.equal(member.homeId, id(2));
    assert.equal(member.revision, 1); assert.equal(member.offset, 0);
    assert.equal(member.bytes, body.length); assert.equal(member.sha256, hash(body));
    assert.equal(descriptor.bytes, body.length); assert.equal(descriptor.resourceSha256, hash(body));
    assert.deepEqual(await get(descriptor.resourceSha256), body);
  }
  receipt.identityExport = { manifest, exactOriginalCompared: expectedBody !== null };
}
const oldBinary = join(root, 'bin', 'old'), newBinary = join(root, 'bin', 'new');
let active, keeper;
const interrupted = signal => {
  receipt.status = 'uncertain'; receipt.interruption = signal;
  for (const item of owned) { item.failed ??= new Error(`Interrupted by ${signal}`); item.child.kill('SIGTERM'); }
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => interrupted(signal));
const totalTimer = setTimeout(() => interrupted('whole-run-210-second-deadline'), 210000);
try {
  persist();
  const reservation = net.createServer();
  await new Promise((r, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', r); });
  port = reservation.address().port; origin = `https://127.0.0.1:${port}`;
  await new Promise((r, reject) => reservation.close(error => error ? reject(error) : r()));
  // Release/reserve race is a stop on bind failure; no alternate port retry.
  put(join(root, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n');
  await command(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', join(root, 'openssl.cnf'), '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], 'generated TLS');
  const provisioning = join(root, 'provisioning.json');
  const login = { username: 'generated-storage-editor', password: 'generated-only-no-real-credential-2026' };
  put(provisioning, JSON.stringify({ schemaVersion: 1, users: [{ userId: id(4), actorId: id(5), ...login,
    memberships: [{ workspaceId: id(1), homeId: id(2), role: 'editor' }] }] }));
  async function initialize(leaf) {
    const data = join(root, leaf), path = join(root, leaf + '.config.json');
    put(path, JSON.stringify({ schemaVersion: 1, deploymentId: id(6), dataDirectory: data, logDirectory: join(data, 'logs'),
      frontendDirectory: join(root, 'frontend'), tlsCertificate: join(root, 'cert.pem'), tlsPrivateKey: join(root, 'key.pem'),
      listen: `127.0.0.1:${port}`, origin, homes: [{ workspaceId: id(1), homeId: id(2), label: 'Generated storage home' }],
      mcpCommands: 'read-only', authentication: { mode: 'password' } }));
    await command(oldBinary, ['initialize', '--server-config', path, '--provisioning-file', provisioning], leaf + ' initialize');
    return { data, path };
  }
  async function serve(binary, fixture, label) {
    active = launch(binary, ['serve', '--server-config', fixture.path], label, 45000);
    active.data = fixture.data;
    active.child.stdin.end();
    await ready(active, `HouseAtlas persistent server listening on 127.0.0.1:${port} for ${origin}`);
    return active;
  }
  const generator = await initialize('generator');
  if (receipt.case === 'committed-wal') {
    keeper = launch(python, ['-I', '-S', sqlitePath, 'hold-wal', generator.data], 'owned idle WAL keeper', 90000);
    await ready(keeper, 'WAL_KEEPER_READY');
  }
  await serve(oldBinary, generator, 'old baseline');
  const logged = await request('/api/atlas/auth/login', login), session = JSON.parse(logged.body.toString());
  assert.equal(session.actorId, id(5)); csrf = session.csrfToken;
  assert.equal(logged.headers['set-cookie'].length, 1);
  cookie = logged.headers['set-cookie'][0].split(';')[0];
  put(join(root, 'generated-session.json'), JSON.stringify({ cookie, csrf }));
  const expected = [];
  if (receipt.case !== 'empty') {
    const evidence = { statement: 'Generated storage compatibility evidence only.', provenance: {
      source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'owner-report',
      factAt: '2026-01-02T12:00:00Z', retrievedAt: '2026-01-02T12:00:00Z', vantage: null,
      uncertainty: { status: 'supported', explanation: null } }, supersedesEvidenceIds: [], references: [] };
    for (const [n, type, payload, guards] of [[100, 'evidence', evidence, []],
      [200, 'identity', { kind: 'item', evidenceIds: [id(100)] }, [{ record: { recordType: 'evidence', recordId: id(100) }, expectedRevision: 1 }]]]) {
      const result = await json(`${prefix}/records/${type}/${id(n)}/mutations`, { schemaVersion: 1,
        mutationId: id(n + 1000), operation: 'create', expectedRevision: null, reason: 'Generated storage compatibility setup',
        guards, value: { recordType: type, payload } });
      assert.equal(result.replayed, false); assert.equal(result.record.revision, 1); expected.push(result.record);
    }
    assert.deepEqual(expected[1].payload.evidenceIds, [expected[0].recordId]);
  }
  expected.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const baselineReads = await reads(expected); await stop(active); active = null;
  const baseline = join(root, 'baseline'), baselineFiles = tree(generator.data, baseline);
  if (keeper) {
    // Both owners are quiescent. Nonempty WAL frames came from successful commits above.
    for (const name of ['atlas.sqlite', 'access.sqlite']) {
      const wal = baselineFiles.find(f => f.path === name + '-wal'); assert(wal && wal.bytes > 32, 'Committed WAL required in BOTH stores');
      const content = bytes(join(baseline, name + '-wal')), pageSize = content.readUInt32BE(8);
      assert([0x377f0682, 0x377f0683].includes(content.readUInt32BE(0)));
      assert(pageSize >= 512 && pageSize <= 65536 && (pageSize & (pageSize - 1)) === 0);
      assert.equal((content.length - 32) % (24 + pageSize), 0);
      let commits = 0;
      for (let offset = 32; offset < content.length; offset += 24 + pageSize) if (content.readUInt32BE(offset + 4)) commits++;
      assert(commits > 0, 'At least one committed WAL transaction marker required');
      (receipt.committedWal ??= []).push({ store: name, pageSize, frames: (content.length - 32) / (24 + pageSize), commits });
    }
    keeper.child.stdin.end('close\n'); await finish(keeper); keeper = null;
  }
  receipt.baselineFiles = baselineFiles;
  const before = await observe(baseline, 'old baseline SQL');
  assert.equal(before.stores['atlas.sqlite'].userVersion, 5);
  assert.equal(before.stores['access.sqlite'].tables.access_meta.rows[0][1], 1);
  const tables = before.stores['atlas.sqlite'].tables;
  const bodies = tables.records.rows.map(row => JSON.parse(row[tables.records.columns.indexOf('body')]));
  assert.deepEqual(bodies.sort((a, b) => a.recordId.localeCompare(b.recordId)), expected);
  assert.equal(tables.audits.rows.length, expected.length); assert.equal(tables.receipts.rows.length, expected.length);
  const transition = await initialize('transition');
  installBodies(baseline, transition.data);
  const installed = await observe(transition.data, 'transition before candidate');
  assert.deepEqual(comparable(installed), comparable(before));
  const statePin = hash(bytes(join(transition.data, 'server-state.json')));
  let prior = installed;
  for (const [binary, label] of [[newBinary, 'candidate'], [oldBinary, 'old reopen']]) {
    const window = { start: Date.now(), authentications: 0 }; activeWindow = window;
    await serve(binary, transition, label);
    assert.deepEqual(await reads(expected), baselineReads);
    if (label === 'candidate') {
      const table = before.stores['atlas.sqlite'].tables.records;
      const bodyIndex = table.columns.indexOf('body'), kindIndex = table.columns.indexOf('record_type');
      const identity = table.rows.find(row => row[kindIndex] === 'identity');
      await identityExport(identity ? identity[bodyIndex] : null);
    }
    await stop(active); active = null; activeWindow = null; window.end = Date.now();
    assert.equal(hash(bytes(join(transition.data, 'server-state.json'))), statePin, 'Startup receipt must remain byte-identical');
    const after = await observe(transition.data, label + ' SQL');
    compare(prior, after, window); prior = after;
    receipt.observations.push({ label: label + ' admitted authentication window', window });
    receipt.observations.push({ label: label + ' closed tree', files: tree(transition.data, join(root, label.replaceAll(' ', '-') + '-closed')) });
  }
  assert.deepEqual(tree(baseline), baselineFiles, 'Untouched generated baseline required');
  receipt.status = 'pass-generated-only';
} catch (error) {
  receipt.status = 'held'; receipt.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  clearTimeout(totalTimer);
  // No global process lookup, process-group kill, retry, deletion or production cleanup.
  for (const item of [...owned]) {
    item.failed ??= new Error('Incomplete operation: outcome uncertain'); item.child.kill('SIGTERM');
    const force = setTimeout(() => { if (!item.closed) item.child.kill('SIGKILL'); }, 7000);
    await item.done; clearTimeout(force);
  }
  if (receipt.interruption || receipt.processes.some(p => p.status === 'uncertain')) { receipt.status = 'uncertain'; process.exitCode = 1; }
  receipt.endedAt = new Date().toISOString(); persist();
  console.log(JSON.stringify({ status: receipt.status, retainedRoot: root, syntheticOnly: true }));
}
