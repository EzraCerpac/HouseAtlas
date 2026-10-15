-- Explicit fresh geodata profile; stock and presence are disabled. Never migrate a predecessor.
-- New Rust lineage. Never apply to a JavaScript Atlas database.
CREATE TABLE atlas_rust_migrations(version INTEGER PRIMARY KEY, sha256 TEXT NOT NULL) STRICT;
CREATE TABLE atlas_rust_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO atlas_rust_metadata VALUES('lineage', 'houseatlas-rust-storage/geodata/2');
INSERT INTO atlas_rust_metadata VALUES('contractVersion', '2.0.0');
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


-- Additive Rust-lineage stock journal. No adoption/backfill of native-only rows.
CREATE TABLE stock_operations (
 operation_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 original_json TEXT NOT NULL, commit_json TEXT NOT NULL,
 codec_version INTEGER NOT NULL CHECK(codec_version=1),
 UNIQUE(workspace_id,home_id,actor_id,operation_id)
) STRICT;
CREATE TABLE stock_groups (
 root_operation_id TEXT NOT NULL REFERENCES stock_operations(operation_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 child_index INTEGER CHECK(child_index>=0), operation_id TEXT NOT NULL UNIQUE,
 idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 original_json TEXT NOT NULL, entries_json TEXT NOT NULL,
 PRIMARY KEY(root_operation_id,ordinal)
) STRICT;
CREATE TABLE stock_keys (
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, root_operation_id TEXT NOT NULL,
 group_ordinal INTEGER CHECK(group_ordinal>=0),
 PRIMARY KEY(workspace_id,home_id,actor_id,idempotency_key),
 FOREIGN KEY(workspace_id,home_id,actor_id,root_operation_id)
 REFERENCES stock_operations(workspace_id,home_id,actor_id,operation_id),
 FOREIGN KEY(root_operation_id,group_ordinal) REFERENCES stock_groups(root_operation_id,ordinal)
) STRICT;
CREATE TABLE stock_audit_links (
 audit_id TEXT PRIMARY KEY REFERENCES audits(audit_id),
 root_operation_id TEXT NOT NULL, group_ordinal INTEGER NOT NULL,
 entry_ordinal INTEGER NOT NULL CHECK(entry_ordinal>=0),
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 mutation_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 command_id TEXT NOT NULL, request_digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state='committed'), event_json TEXT NOT NULL,
 UNIQUE(root_operation_id,group_ordinal,entry_ordinal),
 FOREIGN KEY(root_operation_id,group_ordinal) REFERENCES stock_groups(root_operation_id,ordinal),
 FOREIGN KEY(workspace_id,home_id,actor_id,root_operation_id)
 REFERENCES stock_operations(workspace_id,home_id,actor_id,operation_id),
 FOREIGN KEY(workspace_id,home_id,actor_id,mutation_id)
 REFERENCES receipts(workspace_id,home_id,actor_id,mutation_id)
) STRICT;
CREATE TABLE stock_history_cursors (
 cursor_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 query_json TEXT NOT NULL, watermark INTEGER NOT NULL CHECK(watermark>=0),
 after_seq INTEGER NOT NULL CHECK(after_seq>=0 AND after_seq<=watermark),
 codec_version INTEGER NOT NULL CHECK(codec_version=1)
) STRICT;
CREATE TRIGGER stock_root_id_unique BEFORE INSERT ON stock_operations
 WHEN EXISTS(SELECT 1 FROM stock_groups WHERE operation_id=NEW.operation_id)
 BEGIN SELECT RAISE(ABORT,'stock operation ID already allocated'); END;
CREATE TRIGGER stock_child_id_unique BEFORE INSERT ON stock_groups
 WHEN (NEW.child_index IS NOT NULL AND EXISTS(SELECT 1 FROM stock_operations WHERE operation_id=NEW.operation_id))
 OR (NEW.child_index IS NULL AND (NEW.ordinal<>0 OR NEW.operation_id<>NEW.root_operation_id))
 BEGIN SELECT RAISE(ABORT,'stock operation ID or single group is incompatible'); END;
CREATE TRIGGER stock_operations_no_update BEFORE UPDATE ON stock_operations BEGIN SELECT RAISE(ABORT,'immutable stock operation'); END;
CREATE TRIGGER stock_operations_no_delete BEFORE DELETE ON stock_operations BEGIN SELECT RAISE(ABORT,'immutable stock operation'); END;
CREATE TRIGGER stock_groups_no_update BEFORE UPDATE ON stock_groups BEGIN SELECT RAISE(ABORT,'immutable stock group'); END;
CREATE TRIGGER stock_groups_no_delete BEFORE DELETE ON stock_groups BEGIN SELECT RAISE(ABORT,'immutable stock group'); END;
CREATE TRIGGER stock_keys_no_update BEFORE UPDATE ON stock_keys BEGIN SELECT RAISE(ABORT,'permanent stock key'); END;
CREATE TRIGGER stock_keys_no_delete BEFORE DELETE ON stock_keys BEGIN SELECT RAISE(ABORT,'permanent stock key'); END;
CREATE TRIGGER stock_audit_links_no_update BEFORE UPDATE ON stock_audit_links BEGIN SELECT RAISE(ABORT,'immutable stock audit link'); END;
CREATE TRIGGER stock_audit_links_no_delete BEFORE DELETE ON stock_audit_links BEGIN SELECT RAISE(ABORT,'immutable stock audit link'); END;
CREATE TRIGGER stock_history_cursors_no_update BEFORE UPDATE ON stock_history_cursors BEGIN SELECT RAISE(ABORT,'immutable history cursor'); END;
CREATE TRIGGER stock_history_cursors_no_delete BEFORE DELETE ON stock_history_cursors BEGIN SELECT RAISE(ABORT,'immutable history cursor'); END;

-- Additive queue schema on the same Rust Atlas connection and migration lineage.
-- Every u64 is canonical decimal TEXT. Rust validates the full u64 domain on read.
-- SQLite ordering of these values is always length, then BINARY text.
CREATE TABLE queue_physical(
 deployment_id TEXT NOT NULL, physical_database_id TEXT NOT NULL,
 configuration_digest TEXT NOT NULL, configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
 owner_id TEXT NOT NULL, next_sequence TEXT NOT NULL, fence TEXT NOT NULL,
 active_job_id TEXT, active_fence TEXT, expires_at TEXT,
 PRIMARY KEY(deployment_id,physical_database_id), UNIQUE(physical_database_id),
 CHECK(length(next_sequence) BETWEEN 1 AND 20 AND next_sequence NOT GLOB '*[^0-9]*' AND (next_sequence='0' OR substr(next_sequence,1,1)!='0') AND (length(next_sequence)<20 OR next_sequence<='18446744073709551615')),
 CHECK(length(fence) BETWEEN 1 AND 20 AND fence NOT GLOB '*[^0-9]*' AND (fence='0' OR substr(fence,1,1)!='0') AND (length(fence)<20 OR fence<='18446744073709551615')),
 CHECK((active_job_id IS NULL AND active_fence IS NULL AND expires_at IS NULL) OR (active_job_id IS NOT NULL AND active_fence IS NOT NULL AND expires_at IS NOT NULL))
,
 CHECK((active_fence IS NULL OR (length(active_fence) BETWEEN 1 AND 20 AND active_fence NOT GLOB '*[^0-9]*' AND (active_fence='0' OR substr(active_fence,1,1)!='0') AND (length(active_fence)<20 OR active_fence<='18446744073709551615')))),
 CHECK((expires_at IS NULL OR (length(expires_at) BETWEEN 1 AND 20 AND expires_at NOT GLOB '*[^0-9]*' AND (expires_at='0' OR substr(expires_at,1,1)!='0') AND (length(expires_at)<20 OR expires_at<='18446744073709551615'))))
) STRICT;
CREATE TABLE queue_aliases(
 deployment_id TEXT NOT NULL, physical_database_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
 source_instance_id TEXT NOT NULL, collection_id TEXT NOT NULL,
 canonical_collection_id TEXT NOT NULL,
 PRIMARY KEY(deployment_id,workspace_id,home_id,source_instance_id,collection_id),
 FOREIGN KEY(deployment_id,physical_database_id) REFERENCES queue_physical
) STRICT;
CREATE TABLE queue_jobs(
 job_id TEXT PRIMARY KEY,
 deployment_id TEXT NOT NULL, physical_database_id TEXT NOT NULL,
 sequence TEXT NOT NULL,
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL, original_json TEXT NOT NULL CHECK(json_valid(original_json)), request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 canonical_scope_json TEXT NOT NULL CHECK(json_valid(canonical_scope_json)),
 status TEXT NOT NULL, attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 4294967295),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT,
 lease_fence TEXT, lease_owner TEXT, lease_expires TEXT,
 body_accepted INTEGER NOT NULL CHECK(body_accepted IN (0,1)),
 activity TEXT NOT NULL, termination_digest TEXT,
 logical_fence INTEGER NOT NULL CHECK(logical_fence IN (0,1)),
 applied_json TEXT CHECK(applied_json IS NULL OR json_valid(applied_json)), failure TEXT, reconciliation_json TEXT CHECK(reconciliation_json IS NULL OR json_valid(reconciliation_json)),
 liability_json TEXT NOT NULL CHECK(json_valid(liability_json)),
 codec_version INTEGER NOT NULL CHECK(codec_version=1),
 UNIQUE(deployment_id,physical_database_id,sequence),
 UNIQUE(workspace_id,home_id,actor_id,mutation_id),
 FOREIGN KEY(deployment_id,physical_database_id) REFERENCES queue_physical,
 CHECK(length(sequence) BETWEEN 1 AND 20 AND sequence NOT GLOB '*[^0-9]*' AND (sequence='0' OR substr(sequence,1,1)!='0') AND (length(sequence)<20 OR sequence<='18446744073709551615'))
,
 CHECK((length(created_at) BETWEEN 1 AND 20 AND created_at NOT GLOB '*[^0-9]*' AND (created_at='0' OR substr(created_at,1,1)!='0') AND (length(created_at)<20 OR created_at<='18446744073709551615'))),
 CHECK((length(updated_at) BETWEEN 1 AND 20 AND updated_at NOT GLOB '*[^0-9]*' AND (updated_at='0' OR substr(updated_at,1,1)!='0') AND (length(updated_at)<20 OR updated_at<='18446744073709551615'))),
 CHECK((next_attempt_at IS NULL OR (length(next_attempt_at) BETWEEN 1 AND 20 AND next_attempt_at NOT GLOB '*[^0-9]*' AND (next_attempt_at='0' OR substr(next_attempt_at,1,1)!='0') AND (length(next_attempt_at)<20 OR next_attempt_at<='18446744073709551615')))),
 CHECK((lease_fence IS NULL OR (length(lease_fence) BETWEEN 1 AND 20 AND lease_fence NOT GLOB '*[^0-9]*' AND (lease_fence='0' OR substr(lease_fence,1,1)!='0') AND (length(lease_fence)<20 OR lease_fence<='18446744073709551615')))),
 CHECK((lease_expires IS NULL OR (length(lease_expires) BETWEEN 1 AND 20 AND lease_expires NOT GLOB '*[^0-9]*' AND (lease_expires='0' OR substr(lease_expires,1,1)!='0') AND (length(lease_expires)<20 OR lease_expires<='18446744073709551615'))))
) STRICT;
CREATE INDEX queue_due ON queue_jobs(deployment_id,physical_database_id,status,next_attempt_at);
CREATE TABLE queue_attempts(
 job_id TEXT NOT NULL REFERENCES queue_jobs(job_id), fence TEXT NOT NULL,
 original_leased_job_json TEXT NOT NULL CHECK(json_valid(original_leased_job_json)),
 PRIMARY KEY(job_id,fence)
,
 CHECK((length(fence) BETWEEN 1 AND 20 AND fence NOT GLOB '*[^0-9]*' AND (fence='0' OR substr(fence,1,1)!='0') AND (length(fence)<20 OR fence<='18446744073709551615')))
) STRICT;
CREATE TABLE queue_journal(
 job_id TEXT NOT NULL, fence TEXT NOT NULL,
 native_codec TEXT NOT NULL, native_payload BLOB NOT NULL, native_payload_digest TEXT NOT NULL,
 prepared_media BLOB NOT NULL, prepared_media_digest TEXT NOT NULL,
 prepared_liability_json TEXT NOT NULL CHECK(json_valid(prepared_liability_json)), journal_evidence_digest TEXT NOT NULL,
 PRIMARY KEY(job_id,fence),
 FOREIGN KEY(job_id,fence) REFERENCES queue_attempts
) STRICT;
CREATE TABLE queue_evidence(
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL, fence TEXT NOT NULL,
 kind TEXT NOT NULL, codec TEXT NOT NULL, payload BLOB NOT NULL, envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json)), digest TEXT NOT NULL,
 FOREIGN KEY(job_id,fence) REFERENCES queue_attempts
,
 CHECK((length(fence) BETWEEN 1 AND 20 AND fence NOT GLOB '*[^0-9]*' AND (fence='0' OR substr(fence,1,1)!='0') AND (length(fence)<20 OR fence<='18446744073709551615')))
) STRICT;
CREATE TABLE queue_liability_evidence(
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL, fence TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('claim','journal','finish')),
 liability_json TEXT NOT NULL CHECK(json_valid(liability_json)), codec_version INTEGER NOT NULL CHECK(codec_version=1),
 FOREIGN KEY(job_id,fence) REFERENCES queue_attempts
,
 CHECK((length(fence) BETWEEN 1 AND 20 AND fence NOT GLOB '*[^0-9]*' AND (fence='0' OR substr(fence,1,1)!='0') AND (length(fence)<20 OR fence<='18446744073709551615')))
) STRICT;
CREATE TABLE queue_outcomes(
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL, fence TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 codec_version INTEGER NOT NULL CHECK(codec_version=1),
 FOREIGN KEY(job_id,fence) REFERENCES queue_attempts
) STRICT;
CREATE TRIGGER queue_outcome_no_update BEFORE UPDATE ON queue_outcomes BEGIN SELECT RAISE(ABORT,'immutable queue outcome'); END;
CREATE TRIGGER queue_outcome_no_delete BEFORE DELETE ON queue_outcomes BEGIN SELECT RAISE(ABORT,'immutable queue outcome'); END;
CREATE TRIGGER queue_alias_no_update BEFORE UPDATE ON queue_aliases BEGIN SELECT RAISE(ABORT,'immutable queue alias'); END;
CREATE TRIGGER queue_alias_no_delete BEFORE DELETE ON queue_aliases BEGIN SELECT RAISE(ABORT,'immutable queue alias'); END;
CREATE TRIGGER queue_attempt_no_update BEFORE UPDATE ON queue_attempts BEGIN SELECT RAISE(ABORT,'immutable queue attempt'); END;
CREATE TRIGGER queue_attempt_no_delete BEFORE DELETE ON queue_attempts BEGIN SELECT RAISE(ABORT,'immutable queue attempt'); END;
CREATE TRIGGER queue_journal_no_update BEFORE UPDATE ON queue_journal BEGIN SELECT RAISE(ABORT,'immutable queue journal'); END;
CREATE TRIGGER queue_journal_no_delete BEFORE DELETE ON queue_journal BEGIN SELECT RAISE(ABORT,'immutable queue journal'); END;
CREATE TRIGGER queue_evidence_no_update BEFORE UPDATE ON queue_evidence BEGIN SELECT RAISE(ABORT,'immutable queue evidence'); END;
CREATE TRIGGER queue_evidence_no_delete BEFORE DELETE ON queue_evidence BEGIN SELECT RAISE(ABORT,'immutable queue evidence'); END;
CREATE TRIGGER queue_liability_no_update BEFORE UPDATE ON queue_liability_evidence BEGIN SELECT RAISE(ABORT,'immutable queue liability'); END;
CREATE TRIGGER queue_liability_no_delete BEFORE DELETE ON queue_liability_evidence BEGIN SELECT RAISE(ABORT,'immutable queue liability'); END;
CREATE TRIGGER queue_jobs_identity_immutable BEFORE UPDATE OF job_id,deployment_id,physical_database_id,sequence,workspace_id,home_id,actor_id,mutation_id,intent_digest,original_json,request_json,canonical_scope_json,created_at,codec_version ON queue_jobs BEGIN SELECT RAISE(ABORT,'immutable queue intent'); END;
CREATE TRIGGER queue_jobs_no_delete BEFORE DELETE ON queue_jobs BEGIN SELECT RAISE(ABORT,'permanent queue receipt'); END;
CREATE TRIGGER queue_physical_identity_immutable BEFORE UPDATE OF deployment_id,physical_database_id,configuration_digest,configuration_json,owner_id ON queue_physical BEGIN SELECT RAISE(ABORT,'immutable queue configuration'); END;
CREATE TRIGGER queue_physical_no_delete BEFORE DELETE ON queue_physical BEGIN SELECT RAISE(ABORT,'permanent queue physical identity'); END;

-- Derived immutable-audit coverage/search keys. No reconstructed stock events.
-- Backfill once for this additive Rust lineage; requests never scan all history.
CREATE TABLE stock_history_lookup (
 seq INTEGER PRIMARY KEY REFERENCES audits(seq),
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, record_id TEXT NOT NULL,
 audit_id TEXT NOT NULL UNIQUE REFERENCES audits(audit_id),
 command_id TEXT
) STRICT;
INSERT INTO stock_history_lookup
 SELECT a.seq,a.workspace_id,a.home_id,a.record_id,a.audit_id,l.command_id
 FROM audits a LEFT JOIN stock_audit_links l ON l.audit_id=a.audit_id
 AND l.workspace_id=a.workspace_id AND l.home_id=a.home_id
 AND l.actor_id=json_extract(a.body,'$.actorId')
 AND l.mutation_id=json_extract(a.body,'$.mutationId');
CREATE INDEX stock_history_unlinked
 ON stock_history_lookup(workspace_id,home_id,record_id,seq)
 WHERE command_id IS NULL;
CREATE INDEX stock_history_command
 ON stock_history_lookup(workspace_id,home_id,record_id,command_id,seq);
CREATE INDEX stock_keys_root
 ON stock_keys(workspace_id,home_id,actor_id,root_operation_id,idempotency_key);

CREATE TRIGGER stock_history_lookup_insert_guard BEFORE INSERT ON stock_history_lookup
 WHEN NOT EXISTS(SELECT 1 FROM audits a WHERE a.seq=NEW.seq
 AND a.audit_id=NEW.audit_id AND a.workspace_id=NEW.workspace_id
 AND a.home_id=NEW.home_id AND a.record_id=NEW.record_id)
 OR (NEW.command_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM stock_audit_links l JOIN audits a ON a.audit_id=l.audit_id
 WHERE l.audit_id=NEW.audit_id AND l.command_id=NEW.command_id
 AND l.workspace_id=a.workspace_id AND l.home_id=a.home_id
 AND l.actor_id=json_extract(a.body,'$.actorId')
 AND l.mutation_id=json_extract(a.body,'$.mutationId')))
 BEGIN SELECT RAISE(ABORT,'invalid history lookup'); END;
CREATE TRIGGER stock_history_lookup_update_guard BEFORE UPDATE ON stock_history_lookup
 WHEN NEW.seq<>OLD.seq OR NEW.workspace_id<>OLD.workspace_id
 OR NEW.home_id<>OLD.home_id OR NEW.record_id<>OLD.record_id
 OR NEW.audit_id<>OLD.audit_id OR OLD.command_id IS NOT NULL
 OR NEW.command_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM stock_audit_links l JOIN audits a ON a.audit_id=l.audit_id
 WHERE l.audit_id=NEW.audit_id AND l.command_id=NEW.command_id
 AND l.workspace_id=a.workspace_id AND l.home_id=a.home_id
 AND l.actor_id=json_extract(a.body,'$.actorId')
 AND l.mutation_id=json_extract(a.body,'$.mutationId'))
 BEGIN SELECT RAISE(ABORT,'immutable history lookup'); END;
CREATE TRIGGER stock_history_lookup_no_delete BEFORE DELETE ON stock_history_lookup
 BEGIN SELECT RAISE(ABORT,'permanent history lookup'); END;
CREATE TRIGGER stock_history_audit_insert AFTER INSERT ON audits
 BEGIN INSERT INTO stock_history_lookup
 VALUES(NEW.seq,NEW.workspace_id,NEW.home_id,NEW.record_id,NEW.audit_id,NULL); END;
CREATE TRIGGER stock_history_link_insert AFTER INSERT ON stock_audit_links
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM audits a
 WHERE a.audit_id=NEW.audit_id AND a.workspace_id=NEW.workspace_id
 AND a.home_id=NEW.home_id AND NEW.actor_id=json_extract(a.body,'$.actorId')
 AND NEW.mutation_id=json_extract(a.body,'$.mutationId'))
 THEN RAISE(ABORT,'history audit linkage mismatch') END;
 UPDATE stock_history_lookup SET command_id=NEW.command_id
 WHERE audit_id=NEW.audit_id AND command_id IS NULL;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'history lookup missing') END;
 END;

-- Fresh-only schema-5 profile. Never upgrade an existing schema-1..4 database.
-- Pending files/authority remain media/access-owned; only committed uses live here.
CREATE TABLE upload_consumptions (
 token_hash TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 request_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 binding_digest TEXT NOT NULL, intent_digest TEXT NOT NULL,
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
 root_request_json TEXT NOT NULL CHECK(json_valid(root_request_json)),
 root_operation_id TEXT NOT NULL UNIQUE,
 group_ordinal INTEGER NOT NULL CHECK(group_ordinal>=0),
 group_operation_id TEXT NOT NULL, asset_audit_id TEXT NOT NULL UNIQUE,
 codec_version INTEGER NOT NULL CHECK(codec_version=1),
 UNIQUE(workspace_id,asset_id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES records(workspace_id,record_id),
 FOREIGN KEY(asset_audit_id) REFERENCES audits(audit_id),
 FOREIGN KEY(root_operation_id,group_ordinal)
 REFERENCES stock_groups(root_operation_id,ordinal),
 FOREIGN KEY(workspace_id,home_id,actor_id,root_operation_id)
 REFERENCES stock_operations(workspace_id,home_id,actor_id,operation_id)
) STRICT;
CREATE TRIGGER upload_consumptions_no_update BEFORE UPDATE ON upload_consumptions
 BEGIN SELECT RAISE(ABORT,'immutable upload consumption'); END;
CREATE TRIGGER upload_consumptions_no_delete BEFORE DELETE ON upload_consumptions
 BEGIN SELECT RAISE(ABORT,'permanent upload consumption'); END;

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
