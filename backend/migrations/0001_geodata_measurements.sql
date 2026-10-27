-- Explicit NEW outer catalog only; never run by an old-profile opener/upgrade.
-- Existing inner v5 and Document2.0.0 ledgers/metadata retain their exact meaning.
CREATE TABLE atlas_measurement_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
INSERT INTO atlas_measurement_metadata VALUES('lineage','houseatlas-rust-storage/geodata-measurements/1');
INSERT INTO atlas_measurement_metadata VALUES('catalogVersion','1');
INSERT INTO atlas_measurement_metadata VALUES('measurementContractVersion','1.0.0');
INSERT INTO atlas_measurement_metadata VALUES('nativeContractVersion','1.0.0');
INSERT INTO atlas_measurement_metadata VALUES('documentContractVersion','2.0.0');
INSERT INTO atlas_measurement_metadata VALUES('capabilities','native-v1,stock-v3,queue-v5,geodata-original-v2,png-display-v1,measurement-occurrence-area-v1');
-- catalogSha256 is inserted from the frozen ordered seven-input closure by the
-- separately admitted fresh synthetic installer; it is not a self-hash literal.
CREATE TABLE atlas_measurement_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL CHECK(length(sha256)=64)) STRICT;
CREATE TABLE measurement_mutation_receipts(
 workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,actor_id TEXT NOT NULL,mutation_id TEXT NOT NULL,
 assertion_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),audit_id TEXT NOT NULL,
 proposal_sha256 TEXT NOT NULL CHECK(length(proposal_sha256)=64),body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),
 body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(workspace_id,home_id,actor_id,mutation_id),
 FOREIGN KEY(workspace_id,assertion_id) REFERENCES measurement_heads(workspace_id,assertion_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(audit_id) REFERENCES measurement_audits(audit_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE UNIQUE INDEX measurement_receipt_versions ON measurement_mutation_receipts(workspace_id,assertion_id,revision);
CREATE UNIQUE INDEX measurement_receipt_audit ON measurement_mutation_receipts(audit_id);
CREATE TABLE measurement_heads(
 workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,assertion_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),actor_id TEXT NOT NULL,mutation_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,assertion_id),
 FOREIGN KEY(workspace_id,home_id,actor_id,mutation_id) REFERENCES measurement_mutation_receipts(workspace_id,home_id,actor_id,mutation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX measurement_head_scope ON measurement_heads(workspace_id,home_id,assertion_id);
CREATE TABLE measurement_audits(
 seq INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL,home_id TEXT NOT NULL,assertion_id TEXT NOT NULL,
 audit_id TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,mutation_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),
 FOREIGN KEY(workspace_id,home_id,actor_id,mutation_id) REFERENCES measurement_mutation_receipts(workspace_id,home_id,actor_id,mutation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX measurement_audit_scope ON measurement_audits(workspace_id,home_id,assertion_id,seq);
CREATE TRIGGER measurement_unique_native BEFORE INSERT ON measurement_heads WHEN EXISTS(SELECT 1 FROM records WHERE workspace_id=NEW.workspace_id AND record_id=NEW.assertion_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER measurement_unique_geodata BEFORE INSERT ON measurement_heads WHEN EXISTS(SELECT 1 FROM geodata_records WHERE workspace_id=NEW.workspace_id AND record_id=NEW.assertion_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER native_unique_measurement BEFORE INSERT ON records WHEN EXISTS(SELECT 1 FROM measurement_heads WHERE workspace_id=NEW.workspace_id AND assertion_id=NEW.record_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER geodata_unique_measurement BEFORE INSERT ON geodata_records WHEN EXISTS(SELECT 1 FROM measurement_heads WHERE workspace_id=NEW.workspace_id AND assertion_id=NEW.record_id) BEGIN SELECT RAISE(ABORT,'workspace record identity'); END;
CREATE TRIGGER measurement_head_scope_immutable BEFORE UPDATE ON measurement_heads WHEN NEW.workspace_id!=OLD.workspace_id OR NEW.home_id!=OLD.home_id OR NEW.assertion_id!=OLD.assertion_id BEGIN SELECT RAISE(ABORT,'immutable measurement scope'); END;
CREATE TRIGGER measurement_heads_no_delete BEFORE DELETE ON measurement_heads BEGIN SELECT RAISE(ABORT,'permanent measurement identity'); END;
CREATE TRIGGER measurement_receipts_no_update BEFORE UPDATE ON measurement_mutation_receipts BEGIN SELECT RAISE(ABORT,'immutable measurement receipt'); END;
CREATE TRIGGER measurement_receipts_no_delete BEFORE DELETE ON measurement_mutation_receipts BEGIN SELECT RAISE(ABORT,'immutable measurement receipt'); END;
CREATE TRIGGER measurement_audits_no_update BEFORE UPDATE ON measurement_audits BEGIN SELECT RAISE(ABORT,'immutable measurement audit'); END;
CREATE TRIGGER measurement_audits_no_delete BEFORE DELETE ON measurement_audits BEGIN SELECT RAISE(ABORT,'immutable measurement audit'); END;
