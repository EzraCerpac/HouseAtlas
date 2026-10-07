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
