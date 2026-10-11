-- Fresh-only source definition: schema 1..6 plus this additive cut, excluding 7.
-- This schema is held and is not part of the runtime migration catalog.
CREATE TABLE queue_original_preparations(
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES queue_jobs(job_id),
 data_codec_version INTEGER NOT NULL CHECK(data_codec_version=1),
 packet BLOB NOT NULL CHECK(length(packet) BETWEEN 1 AND 1048576),
 packet_sha256 TEXT NOT NULL CHECK(length(packet_sha256)=64 AND packet_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;
CREATE TRIGGER queue_original_preparation_no_update BEFORE UPDATE ON queue_original_preparations BEGIN SELECT RAISE(ABORT,'immutable original preparation'); END;
CREATE TRIGGER queue_original_preparation_no_delete BEFORE DELETE ON queue_original_preparations BEGIN SELECT RAISE(ABORT,'permanent original preparation'); END;

-- Fresh-only definition identity; never applied to an existing profile.
UPDATE atlas_rust_metadata SET value='houseatlas-rust-storage/queue-original-preparation/1' WHERE key='lineage';
