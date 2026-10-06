import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { validateShape } from '../../contracts/src/index.mjs';
import { validVerifier } from './credentials.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function assertUuid(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new TypeError('Canonical UUID required'); }
export function usernameKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.@+-]{1,254}$/.test(value)) throw new TypeError('Invalid login name');
  return value.toLowerCase();
}
const randomEpoch = () => randomBytes(32).toString('hex');

/** Server-only persistence and administrative configuration. Never expose these methods as tools/routes. */
export class AccessStore {
  #db;
  constructor({ filename = ':memory:' } = {}) {
    if (filename !== ':memory:' && existsSync(filename) && lstatSync(filename).isSymbolicLink()) throw new TypeError('Auth DB must not be a symlink');
    this.#db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    const existingMeta=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='access_meta'").get();
    if(existingMeta && this.#db.prepare('SELECT version FROM access_meta WHERE id=1').get()?.version!==1) {
      this.#db.close(); throw new Error('Unsupported access database version');
    }
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS access_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, epoch TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS access_users (user_id TEXT PRIMARY KEY, actor_id TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, verifier TEXT NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS access_memberships (user_id TEXT NOT NULL REFERENCES access_users(user_id), workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor')), enabled INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(user_id,workspace_id,home_id));
      CREATE TABLE IF NOT EXISTS access_sessions (token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES access_users(user_id), user_version INTEGER NOT NULL, epoch TEXT NOT NULL, origin TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS access_sources (workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, instance_id TEXT NOT NULL, collection_id TEXT NOT NULL, registration TEXT NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(workspace_id,home_id,instance_id,collection_id));
      CREATE TABLE IF NOT EXISTS access_rates (bucket TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, count INTEGER NOT NULL);
    `);
    this.#db.prepare('INSERT OR IGNORE INTO access_meta VALUES(1,1,?)').run(randomEpoch());
    if (this.#db.prepare('SELECT version FROM access_meta WHERE id=1').get().version !== 1) throw new Error('Unsupported access database version');
  }
  close() { this.#db.close(); }
  transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); if (result?.then) throw new TypeError('Access transactions must be synchronous'); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  get epoch() { return this.#db.prepare('SELECT epoch FROM access_meta WHERE id=1').get().epoch; }
  putUser({ userId, actorId, username, passwordVerifier, enabled }) {
    assertUuid(userId); assertUuid(actorId);
    if (!validVerifier(passwordVerifier) || (enabled!==undefined && typeof enabled !== 'boolean')) throw new TypeError('Invalid credential record');
    const old = this.user(userId);
    if (old && old.actor_id !== actorId) throw new TypeError('Actor identity is immutable');
    enabled ??= old ? Boolean(old.enabled) : true;
    this.#db.prepare(`INSERT INTO access_users VALUES(?,?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,verifier=excluded.verifier,enabled=excluded.enabled,version=access_users.version+1`).run(userId, actorId, usernameKey(username), passwordVerifier, +enabled);
  }
  user(userId) { return this.#db.prepare('SELECT * FROM access_users WHERE user_id=?').get(userId); }
  userByName(username) { return this.#db.prepare('SELECT * FROM access_users WHERE username=?').get(username); }
  setUserEnabled(userId, enabled) {
    assertUuid(userId); if (typeof enabled !== 'boolean') throw new TypeError('Boolean required');
    this.#db.prepare('UPDATE access_users SET enabled=?,version=version+1 WHERE user_id=?').run(+enabled,userId);
  }
  setMembership({ userId, workspaceId, homeId, role, enabled = true }) {
    [userId,workspaceId,homeId].forEach(assertUuid);
    if (!['viewer','editor'].includes(role) || typeof enabled !== 'boolean') throw new TypeError('Invalid membership');
    this.#db.prepare(`INSERT INTO access_memberships VALUES(?,?,?,?,?,1) ON CONFLICT(user_id,workspace_id,home_id) DO UPDATE SET role=excluded.role,enabled=excluded.enabled,version=access_memberships.version+1`).run(userId,workspaceId,homeId,role,+enabled);
  }
  membership(userId,workspaceId,homeId) { return this.#db.prepare('SELECT * FROM access_memberships WHERE user_id=? AND workspace_id=? AND home_id=?').get(userId,workspaceId,homeId); }
  putSource(registration, { enabled } = {}) {
    validateShape('sourceRegistration', registration);
    if (enabled!==undefined && typeof enabled !== 'boolean') throw new TypeError('Boolean required');
    // Full registration-set validation and replacement share one serialized transaction.
    this.transaction(() => {
      const existing=this.source(registration.workspaceId,registration.homeId,registration.sourceInstanceId,registration.collectionId);
      const effectiveEnabled=enabled ?? (existing ? Boolean(existing.enabled) : true);
      const all = this.#db.prepare('SELECT registration FROM access_sources').all().map(r=>JSON.parse(r.registration));
      if(registration.partitionMode==='exclusive-home' && registration.allowedExternalIds.length) throw new TypeError('Exclusive source has no entity allowlist');
      for(const other of all) {
        if(other.workspaceId!==registration.workspaceId || other.sourceInstanceId!==registration.sourceInstanceId || other.collectionId!==registration.collectionId) continue;
        if(other.owner!==registration.owner) throw new TypeError('Source owner is immutable');
        if(other.homeId===registration.homeId) continue;
        if(other.partitionMode==='exclusive-home' || registration.partitionMode==='exclusive-home' || other.allowedExternalIds.some(id=>registration.allowedExternalIds.includes(id))) throw new TypeError('Source partitions must be disjoint across homes');
      }
      this.#db.prepare(`INSERT INTO access_sources VALUES(?,?,?,?,?,?,1) ON CONFLICT(workspace_id,home_id,instance_id,collection_id) DO UPDATE SET registration=excluded.registration,enabled=excluded.enabled,version=access_sources.version+1`).run(registration.workspaceId,registration.homeId,registration.sourceInstanceId,registration.collectionId,JSON.stringify(registration),+effectiveEnabled);
    });
  }
  source(workspaceId,homeId,instanceId,collectionId) { return this.#db.prepare('SELECT * FROM access_sources WHERE workspace_id=? AND home_id=? AND instance_id=? AND collection_id=?').get(workspaceId,homeId,instanceId,collectionId); }
  setSourceEnabled(workspaceId,homeId,instanceId,collectionId,enabled) {
    [workspaceId,homeId,instanceId].forEach(assertUuid); if (typeof enabled !== 'boolean') throw new TypeError('Boolean required');
    this.#db.prepare('UPDATE access_sources SET enabled=?,version=version+1 WHERE workspace_id=? AND home_id=? AND instance_id=? AND collection_id=?').run(+enabled,workspaceId,homeId,instanceId,collectionId);
  }
  session(tokenHash) { return this.#db.prepare('SELECT * FROM access_sessions WHERE token_hash=?').get(tokenHash); }
  insertSession(s, maxPerUser, now) {
    this.#db.prepare('DELETE FROM access_sessions WHERE expires_at<=?').run(now);
    // Bound live sessions and storage even when repeated logins are legitimate.
    this.#db.prepare(`DELETE FROM access_sessions WHERE token_hash IN (SELECT token_hash FROM access_sessions WHERE user_id=? ORDER BY created_at DESC,token_hash DESC LIMIT -1 OFFSET ?)`).run(s.userId,maxPerUser-1);
    this.#db.prepare('INSERT INTO access_sessions VALUES(?,?,?,?,?,?,?,?,?)').run(s.tokenHash,s.csrfHash,s.userId,s.userVersion,s.epoch,s.origin,s.createdAt,s.lastSeen,s.expiresAt);
  }
  touchSession(tokenHash, now) { this.#db.prepare('UPDATE access_sessions SET last_seen=MAX(last_seen,?) WHERE token_hash=?').run(now,tokenHash); }
  replaceCsrf(tokenHash, csrfHash) { this.#db.prepare('UPDATE access_sessions SET csrf_hash=? WHERE token_hash=?').run(csrfHash,tokenHash); }
  revokeSession(tokenHash) { this.#db.prepare('DELETE FROM access_sessions WHERE token_hash=?').run(tokenHash); }
  revokeUserSessions(userId) { assertUuid(userId); this.#db.prepare('DELETE FROM access_sessions WHERE user_id=?').run(userId); }
  invalidateAllSessions() {
    this.transaction(()=>{ this.#db.prepare('UPDATE access_meta SET epoch=? WHERE id=1').run(randomEpoch()); this.#db.exec('DELETE FROM access_sessions; DELETE FROM access_rates;'); });
  }
  consumeRate(bucket, now, { windowMs, limit, maxBuckets = 4096 }) {
    return this.transaction(()=>{
      this.#db.prepare('DELETE FROM access_rates WHERE expires_at<=?').run(now);
      const row=this.#db.prepare('SELECT * FROM access_rates WHERE bucket=?').get(bucket);
      if (!row && this.#db.prepare('SELECT count(*) AS n FROM access_rates').get().n >= maxBuckets) return false;
      if (row && (now<row.starts_at || row.count>=limit)) return false;
      this.#db.prepare(`INSERT INTO access_rates VALUES(?,?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1`).run(bucket,now,now+windowMs);
      return true;
    });
  }
}
