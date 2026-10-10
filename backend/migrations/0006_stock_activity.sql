-- Fresh profile 6 only. Migrations 1..5 and profile-5 recovery stay frozen.
-- StockActivity and Jobs share physical exclusion, never permits/epochs.
CREATE TABLE stock_activity_physical(
 physical_database_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL,
 configuration_digest TEXT NOT NULL, owner_id TEXT NOT NULL,
 dispatcher_epoch TEXT NOT NULL, active_operation_id TEXT,
 FOREIGN KEY(active_operation_id) REFERENCES stock_activity_operations(operation_id)
) STRICT;
CREATE TABLE stock_activity_operations(
 operation_id TEXT PRIMARY KEY, physical_database_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, intent_digest TEXT NOT NULL,
 activity_version TEXT NOT NULL, operation_json TEXT NOT NULL CHECK(json_valid(operation_json)),
 permit_json TEXT CHECK(permit_json IS NULL OR json_valid(permit_json)),
 body_accepted INTEGER NOT NULL CHECK(body_accepted IN (0,1)),
 logical_hold INTEGER NOT NULL CHECK(logical_hold IN (0,1)),
 liability_hold INTEGER NOT NULL CHECK(liability_hold IN (0,1)),
 UNIQUE(actor_id,workspace_id,home_id,idempotency_key),
 FOREIGN KEY(physical_database_id) REFERENCES stock_activity_physical
) STRICT;
CREATE TABLE stock_activity_events(
 sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES stock_activity_operations,
 kind TEXT NOT NULL CHECK(kind IN ('reserve','queued','admit','reject','never-invoked','dispatch','observation')),
 activity_version TEXT NOT NULL, facts_json TEXT NOT NULL CHECK(json_valid(facts_json)),
 operation_json TEXT NOT NULL CHECK(json_valid(operation_json)),
 UNIQUE(operation_id,activity_version)
) STRICT;
CREATE TABLE stock_activity_approvals(
 approval_receipt_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES stock_activity_operations,
 evidence_digest TEXT NOT NULL
) STRICT;
CREATE TRIGGER stock_activity_events_no_update BEFORE UPDATE ON stock_activity_events BEGIN SELECT RAISE(ABORT,'activity journal is append-only'); END;
CREATE TRIGGER stock_activity_events_no_delete BEFORE DELETE ON stock_activity_events BEGIN SELECT RAISE(ABORT,'activity journal is append-only'); END;
CREATE TRIGGER stock_activity_approvals_no_update BEFORE UPDATE ON stock_activity_approvals BEGIN SELECT RAISE(ABORT,'approval is immutable'); END;
CREATE TRIGGER stock_activity_approvals_no_delete BEFORE DELETE ON stock_activity_approvals BEGIN SELECT RAISE(ABORT,'approval is consumed'); END;
CREATE TRIGGER stock_activity_exclusion BEFORE UPDATE OF active_operation_id ON stock_activity_physical
 WHEN NEW.active_operation_id IS NOT NULL AND EXISTS(SELECT 1 FROM queue_physical WHERE physical_database_id=NEW.physical_database_id AND active_job_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'physical activity occupied'); END;
CREATE TRIGGER queue_stock_activity_exclusion BEFORE UPDATE OF active_job_id ON queue_physical
 WHEN NEW.active_job_id IS NOT NULL AND EXISTS(SELECT 1 FROM stock_activity_physical WHERE physical_database_id=NEW.physical_database_id AND active_operation_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'physical activity occupied'); END;
CREATE TRIGGER stock_activity_operations_identity BEFORE UPDATE OF operation_id,physical_database_id,actor_id,workspace_id,home_id,idempotency_key,intent_digest ON stock_activity_operations
 BEGIN SELECT RAISE(ABORT,'activity identity is immutable'); END;
CREATE TRIGGER stock_activity_operations_no_delete BEFORE DELETE ON stock_activity_operations
 BEGIN SELECT RAISE(ABORT,'activity intent is permanent'); END;
CREATE TRIGGER stock_activity_physical_identity BEFORE UPDATE OF physical_database_id,deployment_id,configuration_digest,owner_id,dispatcher_epoch ON stock_activity_physical
 BEGIN SELECT RAISE(ABORT,'activity registration is immutable'); END;
CREATE TRIGGER stock_activity_physical_no_delete BEFORE DELETE ON stock_activity_physical
 BEGIN SELECT RAISE(ABORT,'activity registration is retained'); END;
