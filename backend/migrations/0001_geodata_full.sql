-- Explicit full capability profile. Predecessor 29 tables and inner metadata stay unchanged.
-- SQLite user_version remains the inner v5 version; outer schema is independently versioned.
CREATE TABLE atlas_full_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
INSERT INTO atlas_full_metadata VALUES('lineage','houseatlas-rust-storage/geodata-full/1');
INSERT INTO atlas_full_metadata VALUES('contractVersion','2.0.0');
INSERT INTO atlas_full_metadata VALUES('schemaVersion','1');
INSERT INTO atlas_full_metadata VALUES('capabilities','native-v1,stock-v3,queue-v5,geodata-original-v2,png-display-v1');
CREATE TABLE atlas_full_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL) STRICT;
CREATE TABLE atlas_full_conversion(id INTEGER PRIMARY KEY CHECK(id=1),sha256 TEXT NOT NULL CHECK(length(sha256)=64),body TEXT NOT NULL CHECK(json_valid(body))) STRICT;
CREATE TRIGGER atlas_full_conversion_no_update BEFORE UPDATE ON atlas_full_conversion BEGIN SELECT RAISE(ABORT,'immutable conversion ancestry'); END;
CREATE TRIGGER atlas_full_conversion_no_delete BEFORE DELETE ON atlas_full_conversion BEGIN SELECT RAISE(ABORT,'immutable conversion ancestry'); END;
CREATE TABLE geodata_records(
 workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,record_id TEXT NOT NULL,record_type TEXT NOT NULL CHECK(record_type IN ('asset','geodata-document')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(workspace_id,record_id)
) STRICT;
CREATE INDEX geodata_records_scope ON geodata_records(workspace_id,home_id,record_type,record_id);
CREATE TABLE geodata_audits(seq INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,record_id TEXT NOT NULL,audit_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL CHECK(json_valid(body)),record_body TEXT NOT NULL CHECK(json_valid(record_body)),FOREIGN KEY(workspace_id,record_id) REFERENCES geodata_records(workspace_id,record_id)) STRICT;
CREATE TABLE geodata_mutation_receipts(workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,actor_id TEXT NOT NULL,mutation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),request_body TEXT NOT NULL CHECK(json_valid(request_body)),PRIMARY KEY(workspace_id,home_id,actor_id,mutation_id)) STRICT;
CREATE TABLE geodata_asset_manifests(workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,record_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(workspace_id,record_id),FOREIGN KEY(workspace_id,record_id) REFERENCES geodata_records(workspace_id,record_id)) STRICT;
CREATE TRIGGER geodata_unique_native BEFORE INSERT ON geodata_records WHEN EXISTS(SELECT 1 FROM records WHERE workspace_id=NEW.workspace_id AND record_id=NEW.record_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER native_unique_geodata BEFORE INSERT ON records WHEN EXISTS(SELECT 1 FROM geodata_records WHERE workspace_id=NEW.workspace_id AND record_id=NEW.record_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER geodata_records_no_delete BEFORE DELETE ON geodata_records BEGIN SELECT RAISE(ABORT,'permanent record'); END;
CREATE TRIGGER geodata_audits_no_update BEFORE UPDATE ON geodata_audits BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER geodata_audits_no_delete BEFORE DELETE ON geodata_audits BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER geodata_mutation_receipts_no_update BEFORE UPDATE ON geodata_mutation_receipts BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER geodata_mutation_receipts_no_delete BEFORE DELETE ON geodata_mutation_receipts BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER geodata_asset_manifests_no_update BEFORE UPDATE ON geodata_asset_manifests BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER geodata_asset_manifests_no_delete BEFORE DELETE ON geodata_asset_manifests BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TABLE geodata_receipts(
 sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64), kind TEXT NOT NULL CHECK(kind IN ('custody','derivation')),
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
) STRICT;
CREATE TABLE geodata_document_refs(
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, document_id TEXT NOT NULL,
 asset_id TEXT NOT NULL, asset_revision INTEGER NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('original','preview')), receipt_sha256 TEXT NOT NULL,
 PRIMARY KEY(workspace_id,document_id,role),
 FOREIGN KEY(workspace_id,document_id) REFERENCES geodata_records(workspace_id,record_id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES geodata_records(workspace_id,record_id),
 FOREIGN KEY(receipt_sha256) REFERENCES geodata_receipts(sha256)
) STRICT;
CREATE INDEX geodata_document_scope ON geodata_document_refs(workspace_id,home_id,document_id);
CREATE TRIGGER geodata_receipts_no_update BEFORE UPDATE ON geodata_receipts BEGIN SELECT RAISE(ABORT,'immutable geodata receipt'); END;
CREATE TRIGGER geodata_receipts_no_delete BEFORE DELETE ON geodata_receipts BEGIN SELECT RAISE(ABORT,'immutable geodata receipt'); END;

CREATE TABLE geodata_epochs(workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,epoch INTEGER NOT NULL CHECK(epoch BETWEEN 1 AND 9007199254740991),PRIMARY KEY(workspace_id,home_id)) STRICT;
CREATE TRIGGER geodata_epoch_insert AFTER INSERT ON geodata_records BEGIN INSERT INTO geodata_epochs VALUES(NEW.workspace_id,NEW.home_id,1) ON CONFLICT(workspace_id,home_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER geodata_epoch_update AFTER UPDATE ON geodata_records BEGIN INSERT INTO geodata_epochs VALUES(NEW.workspace_id,NEW.home_id,1) ON CONFLICT(workspace_id,home_id) DO UPDATE SET epoch=epoch+1; END;
