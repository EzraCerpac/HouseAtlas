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
