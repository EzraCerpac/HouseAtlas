import { createHash } from 'node:crypto';
import { ContractError } from '../../contracts/src/index.mjs';

// Migration versions are independent of contract 1.0.0 and record schema 1.
export const DATABASE_VERSION = 3;
export const MIGRATIONS = Object.freeze([
  { version: 1, sql: `
    CREATE TABLE atlas_migrations(version INTEGER PRIMARY KEY, sha256 TEXT NOT NULL) STRICT;
    CREATE TABLE atlas_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO atlas_metadata VALUES('contractVersion', '1.0.0');
    CREATE TABLE records(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, record_id TEXT NOT NULL,
      record_type TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(workspace_id, record_id)
    ) STRICT;
    CREATE INDEX records_scope ON records(workspace_id, home_id, record_type);
    CREATE TABLE binding_reservations(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, record_id TEXT NOT NULL,
      source_instance_id TEXT NOT NULL, collection_id TEXT NOT NULL,
      source_kind TEXT NOT NULL, external_id TEXT NOT NULL, atlas_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id, source_instance_id, collection_id, source_kind, external_id),
      UNIQUE(workspace_id, record_id),
      FOREIGN KEY(workspace_id, record_id) REFERENCES records(workspace_id, record_id),
      FOREIGN KEY(workspace_id, atlas_id) REFERENCES records(workspace_id, record_id) DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TABLE sources(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id)
    ) STRICT;
    CREATE TABLE caches(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id),
      FOREIGN KEY(workspace_id, home_id, source_instance_id, collection_id)
        REFERENCES sources(workspace_id, home_id, source_instance_id, collection_id)
    ) STRICT;
    CREATE TABLE projections(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, external_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id, external_id),
      FOREIGN KEY(workspace_id, home_id, source_instance_id, collection_id)
        REFERENCES sources(workspace_id, home_id, source_instance_id, collection_id)
    ) STRICT;
    CREATE TABLE network_relations(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, external_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id, external_id),
      FOREIGN KEY(workspace_id, home_id, source_instance_id, collection_id)
        REFERENCES sources(workspace_id, home_id, source_instance_id, collection_id)
    ) STRICT;
    CREATE TABLE audits(
      seq INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
      record_id TEXT NOT NULL, audit_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL CHECK(json_valid(body)),
      FOREIGN KEY(workspace_id, record_id) REFERENCES records(workspace_id, record_id)
    ) STRICT;
    CREATE INDEX audits_scope ON audits(workspace_id, home_id, record_id, seq);
    CREATE TRIGGER audits_no_update BEFORE UPDATE ON audits BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
    CREATE TRIGGER audits_no_delete BEFORE DELETE ON audits BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
    CREATE TRIGGER records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'permanent record'); END;
    CREATE TRIGGER reservations_no_update BEFORE UPDATE ON binding_reservations BEGIN SELECT RAISE(ABORT, 'permanent reservation'); END;
    CREATE TRIGGER reservations_no_delete BEFORE DELETE ON binding_reservations BEGIN SELECT RAISE(ABORT, 'permanent reservation'); END;
  ` },
  { version: 2, sql: `
    CREATE TABLE receipts(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, actor_id, mutation_id)
    ) STRICT;
    CREATE TABLE batch_receipts(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, home_id, actor_id, batch_id)
    ) STRICT;
    CREATE TABLE asset_manifests(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, record_id TEXT NOT NULL,
      storage_key TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(workspace_id, record_id), UNIQUE(workspace_id, home_id, storage_key),
      FOREIGN KEY(workspace_id, record_id) REFERENCES records(workspace_id, record_id)
    ) STRICT;
    INSERT INTO asset_manifests SELECT workspace_id, home_id, record_id,
      json_extract(body, '$.payload.storageKey'), json_extract(body, '$.payload') FROM records WHERE record_type='asset';
    CREATE TABLE cache_generations(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id, generation_id)
    ) STRICT;
    INSERT INTO cache_generations SELECT workspace_id,home_id,source_instance_id,collection_id,
      json_extract(body, '$.generationId') FROM caches WHERE json_extract(body, '$.generationId') IS NOT NULL;
    CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
    CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
    CREATE TRIGGER batches_no_update BEFORE UPDATE ON batch_receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
    CREATE TRIGGER batches_no_delete BEFORE DELETE ON batch_receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
  ` },
  { version: 3, sql: `
    CREATE TABLE cache_epochs(
      workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id),
      FOREIGN KEY(workspace_id, home_id, source_instance_id, collection_id)
        REFERENCES sources(workspace_id, home_id, source_instance_id, collection_id)
    ) STRICT;
    INSERT INTO cache_epochs SELECT workspace_id, home_id, source_instance_id, collection_id, 0 FROM sources;
  ` },
].map(m => Object.freeze({ ...m, sha256: createHash('sha256').update(m.sql).digest('hex') })));

export function migrate(db, { targetVersion = DATABASE_VERSION, fault = () => {} } = {}) {
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > DATABASE_VERSION)
    throw new ContractError('schema-incompatible', 'Unsupported database target version');
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > targetVersion) throw new ContractError('schema-incompatible', 'Database requires a newer release; use compatible code rollback');
    if (!version && db.prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").get())
      throw new ContractError('schema-incompatible', 'Unrecognized database; refusing to adopt existing schema objects');
    if (version) {
      const applied = db.prepare('SELECT version,sha256 FROM atlas_migrations ORDER BY version').all();
      if (applied.length !== version || applied.some((m, i) => m.version !== i + 1 || m.sha256 !== MIGRATIONS[i]?.sha256))
        throw new ContractError('schema-incompatible', 'Migration history does not match this release');
      if (db.prepare("SELECT value FROM atlas_metadata WHERE key='contractVersion'").get()?.value !== '1.0.0')
        throw new ContractError('schema-incompatible', 'Stored contract version is incompatible');
    }
    for (const m of MIGRATIONS.filter(m => m.version > version && m.version <= targetVersion)) {
      db.exec(m.sql);
      db.prepare('INSERT INTO atlas_migrations VALUES(?,?)').run(m.version, m.sha256);
      db.exec(`PRAGMA user_version=${m.version}`);
      fault('migration-before-commit', { version: m.version });
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
