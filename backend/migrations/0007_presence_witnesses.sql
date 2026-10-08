CREATE TABLE presence_witnesses(
  workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, binding_record_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK(binding_revision BETWEEN 1 AND 9007199254740991),
  audit_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(workspace_id,binding_record_id,binding_revision),
  UNIQUE(workspace_id,home_id,actor_id,mutation_id),
  FOREIGN KEY(workspace_id,binding_record_id) REFERENCES records(workspace_id,record_id),
  FOREIGN KEY(audit_id) REFERENCES audits(audit_id),
  FOREIGN KEY(workspace_id,home_id,actor_id,mutation_id)
    REFERENCES receipts(workspace_id,home_id,actor_id,mutation_id)
) STRICT;
CREATE INDEX presence_witnesses_scope ON presence_witnesses(workspace_id,home_id,binding_record_id,binding_revision);
CREATE TRIGGER presence_witnesses_no_update BEFORE UPDATE ON presence_witnesses
  BEGIN SELECT RAISE(ABORT,'immutable presence witness'); END;
CREATE TRIGGER presence_witnesses_no_delete BEFORE DELETE ON presence_witnesses
  BEGIN SELECT RAISE(ABORT,'immutable presence witness'); END;

-- Fresh-only definition; no existing profile is upgraded.
UPDATE atlas_rust_metadata SET value='houseatlas-rust-storage/presence/1' WHERE key='lineage';
