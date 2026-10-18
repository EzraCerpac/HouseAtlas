import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const APPLICATION_ID = 0x48414f4c; // HAOL, a dedicated database, never an Atlas DB.
const FORMAT_VERSION = 1;
export const MAX_BYTES = 1024 * 1024;

export class LedgerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LedgerError';
    this.code = code;
  }
}
const fail = code => { throw new LedgerError(code); };

/** Allocate once when an intent is created; retain this ID for its lifetime. */
export const createOperationId = () => randomUUID();

function keyOf(value) {
  return ['workspaceId', 'homeId', 'actorId', 'operationId'].map(field => {
    const item = value?.[field];
    if (typeof item !== 'string' || !item.length || item.includes('\0') ||
        Buffer.byteLength(item, 'utf8') > 512 || !item.isWellFormed()) fail('invalid-key');
    return item;
  });
}

function bytesOf(value) {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_BYTES) fail('invalid-bytes');
  return Buffer.from(value);
}

function snapshot(row) {
  return row === undefined ? null : {
    workspaceId: row.workspace_id,
    homeId: row.home_id,
    actorId: row.actor_id,
    operationId: row.operation_id,
    state: row.outcome === null ? 'pending' : 'completed',
    payload: Uint8Array.from(row.payload),
    outcome: row.outcome === null ? null : Uint8Array.from(row.outcome),
  };
}

/**
 * Isolated durable bookkeeping, with no command executor or authorization adapter.
 * Keys are trusted caller-supplied partitions, not proof of access. Payload and
 * outcome are opaque exact bytes, not a proposed HTTP or domain write contract.
 */
export class OperationLedger {
  #db;

  constructor({ path }) {
    if (typeof path !== 'string' || !path.length || path === ':memory:') fail('invalid-path');
    this.#db = new DatabaseSync(path, { enableDoubleQuotedStringLiterals: false });
    try {
      this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      this.#transaction(() => {
        const applicationId = this.#db.prepare('PRAGMA application_id').get().application_id;
        const version = this.#db.prepare('PRAGMA user_version').get().user_version;
        if (applicationId === 0 && version === 0 &&
            this.#db.prepare('SELECT count(*) AS count FROM sqlite_schema').get().count === 0) {
          this.#db.exec(`
            CREATE TABLE offline_operations (
              workspace_id TEXT NOT NULL,
              home_id TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              operation_id TEXT NOT NULL,
              payload BLOB NOT NULL CHECK(length(payload) <= ${MAX_BYTES}),
              outcome BLOB CHECK(outcome IS NULL OR length(outcome) <= ${MAX_BYTES}),
              PRIMARY KEY (workspace_id, home_id, actor_id, operation_id)
            ) STRICT, WITHOUT ROWID;
            PRAGMA application_id=${APPLICATION_ID};
            PRAGMA user_version=${FORMAT_VERSION};
          `);
        } else if (applicationId !== APPLICATION_ID || version !== FORMAT_VERSION) {
          fail('unsupported-database');
        }
      });
      const { journal_mode: mode } = this.#db.prepare('PRAGMA journal_mode=WAL').get();
      if (mode !== 'wal') fail('durability-unavailable');
    } catch (error) {
      this.#db.close();
      this.#db = null;
      throw error;
    }
  }

  #transaction(action) {
    if (!this.#db) fail('closed');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      // Preserve the original error; a failed COMMIT is not replay authority.
      try { this.#db.exec('ROLLBACK'); } catch { /* may already have ended */ }
      throw error;
    }
  }

  #get(key) {
    if (!this.#db) fail('closed');
    return this.#db.prepare(`SELECT * FROM offline_operations
      WHERE workspace_id=? AND home_id=? AND actor_id=? AND operation_id=?`).get(...key);
  }

  /** A new reservation records intent only. Pending never grants execution/retry. */
  reserve(request) {
    const key = keyOf(request), payload = bytesOf(request?.payload);
    return this.#transaction(() => {
      let row = this.#get(key);
      if (row !== undefined) {
        if (!payload.equals(row.payload)) fail('payload-conflict');
        return { disposition: row.outcome === null ? 'pending' : 'completed', record: snapshot(row) };
      }
      this.#db.prepare(`INSERT INTO offline_operations
        (workspace_id, home_id, actor_id, operation_id, payload) VALUES (?, ?, ?, ?, ?)`).run(...key, payload);
      row = this.#get(key);
      return { disposition: 'reserved', record: snapshot(row) };
    });
  }

  /** Retain an externally established outcome once; never execute a command here. */
  complete(request, outcomeBytes) {
    const key = keyOf(request), payload = bytesOf(request?.payload), outcome = bytesOf(outcomeBytes);
    return this.#transaction(() => {
      const row = this.#get(key);
      if (row === undefined) fail('unknown-operation');
      if (!payload.equals(row.payload)) fail('payload-conflict');
      if (row.outcome !== null) {
        if (!outcome.equals(row.outcome)) fail('outcome-conflict');
        return { disposition: 'duplicate', record: snapshot(row) };
      }
      this.#db.prepare(`UPDATE offline_operations SET outcome=?
        WHERE workspace_id=? AND home_id=? AND actor_id=? AND operation_id=?`).run(outcome, ...key);
      return { disposition: 'recorded', record: snapshot(this.#get(key)) };
    });
  }

  /** Returns detached bytes, or null if the key is absent. No authorization implied. */
  inspect(key) { return snapshot(this.#get(keyOf(key))); }

  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }
}
