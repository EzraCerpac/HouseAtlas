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
