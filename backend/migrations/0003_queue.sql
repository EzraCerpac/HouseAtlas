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
