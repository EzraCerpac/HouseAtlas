-- New Rust lineage. Never apply to a JavaScript Atlas database.
CREATE TABLE atlas_rust_migrations(version INTEGER PRIMARY KEY, sha256 TEXT NOT NULL) STRICT;
CREATE TABLE atlas_rust_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO atlas_rust_metadata VALUES('lineage', 'houseatlas-rust-storage/1');
INSERT INTO atlas_rust_metadata VALUES('contractVersion', '1.0.0');
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
CREATE TABLE cache_generations(
  workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
  collection_id TEXT NOT NULL, generation_id TEXT NOT NULL,
  PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id, generation_id)
) STRICT;
CREATE TABLE cache_epochs(
  workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, source_instance_id TEXT NOT NULL,
  collection_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(workspace_id, home_id, source_instance_id, collection_id),
  FOREIGN KEY(workspace_id, home_id, source_instance_id, collection_id)
    REFERENCES sources(workspace_id, home_id, source_instance_id, collection_id)
) STRICT;
CREATE TRIGGER audits_no_update BEFORE UPDATE ON audits BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
CREATE TRIGGER audits_no_delete BEFORE DELETE ON audits BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
CREATE TRIGGER batches_no_update BEFORE UPDATE ON batch_receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
CREATE TRIGGER batches_no_delete BEFORE DELETE ON batch_receipts BEGIN SELECT RAISE(ABORT, 'immutable receipt'); END;
CREATE TRIGGER records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'permanent record'); END;
CREATE TRIGGER reservations_no_update BEFORE UPDATE ON binding_reservations BEGIN SELECT RAISE(ABORT, 'permanent reservation'); END;
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON binding_reservations BEGIN SELECT RAISE(ABORT, 'permanent reservation'); END;
