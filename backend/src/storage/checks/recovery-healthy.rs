//! accepted synthetic capture/validate/native reopen.
//! No tests,
//! fault controls, receipt replay, providers or physical staged originals.
#[allow(dead_code)]
#[path = "stock-support.rs"]
mod support;
use houseatlas_at07_checkpoint::storage::*;
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    rc::Rc,
};
use support::*;

// Constant storage-owned table names for check evidence only. This is not an
// application SQL/connection/callback interface.
const TABLES: [&str; 19] = [
    "atlas_rust_migrations",
    "atlas_rust_metadata",
    "records",
    "binding_reservations",
    "sources",
    "caches",
    "projections",
    "network_relations",
    "audits",
    "receipts",
    "batch_receipts",
    "asset_manifests",
    "cache_generations",
    "cache_epochs",
    "stock_operations",
    "stock_groups",
    "stock_keys",
    "stock_audit_links",
    "stock_history_cursors",
];
fn all_rows(path: &Path) -> CheckResult<BTreeMap<String, Vec<Vec<Value>>>> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut output = BTreeMap::new();
    for table in TABLES {
        let mut statement = db.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let columns = statement.column_count();
        let mut rows = statement.query([])?;
        let mut values = Vec::new();
        while let Some(row) = rows.next()? {
            let mut value = Vec::new();
            for column in 0..columns {
                value.push(match row.get_ref(column)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Text(bytes) => json!(std::str::from_utf8(bytes)?),
                    _ => return Err("unexpected type in owned recovery schema".into()),
                });
            }
            values.push(value);
        }
        output.insert(table.into(), values);
    }
    db.close().map_err(|(_, error)| error)?;
    Ok(output)
}

fn reference(record_type: RecordType, n: u64) -> RecordRef {
    RecordRef {
        record_type,
        record_id: id(n),
    }
}
fn healthy_command(
    n: u64,
    operation: Operation,
    revision: Option<u64>,
    value: Option<RecordValue>,
) -> Mutation {
    Mutation {
        schema_version: 1,
        mutation_id: id(n),
        operation,
        expected_revision: revision,
        reason: "Healthy synthetic room/item recovery".into(),
        guards: vec![Guard {
            record: reference(RecordType::Evidence, 100),
            expected_revision: 1,
        }],
        value,
    }
}

fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("fresh private synthetic output directory required")?,
    );
    fs::create_dir(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    }
    let live = directory.join("owned.sqlite");
    let image_path = directory.join("recovery.sqlite");
    let semantics = PureRustSemantics::default();
    let authorization = SyntheticAuthorization::default();
    let runtime = SyntheticRuntime {
        next: Rc::new(Cell::new(95_000)),
    };
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let principal = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let mut store = AtlasStore::open(
        &live,
        semantics.storage_contract(),
        authorization.clone(),
        runtime.clone(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    let initial: Snapshot = load(&root, "packages/contracts/fixtures/plan-free.snapshot.json")?;
    store.initialize_synthetic(&initial)?;
    let target = reference(RecordType::Circuit, 406);
    let command: Mutation = load(
        &root,
        "packages/contracts/fixtures/create-circuit.mutation.json",
    )?;
    let circuit = store.execute(&principal, &scope, &target, &command)?;
    let batch = BatchMutation {
        schema_version: 1,
        batch_id: id(95_010),
        reason: "Healthy recovery synthetic room and item".into(),
        commands: vec![
            MutationEntry {
                target: reference(RecordType::Identity, 95_011),
                command: healthy_command(
                    95_013,
                    Operation::Create,
                    None,
                    Some(RecordValue {
                        record_type: RecordType::Identity,
                        payload: json!({"kind":"location","evidenceIds":[id(100)]}),
                    }),
                ),
            },
            MutationEntry {
                target: reference(RecordType::Identity, 95_012),
                command: healthy_command(
                    95_014,
                    Operation::Create,
                    None,
                    Some(RecordValue {
                        record_type: RecordType::Identity,
                        payload: json!({"kind":"item","evidenceIds":[id(100)]}),
                    }),
                ),
            },
        ],
    };
    let committed = store.execute_batch(&principal, &scope, &batch)?;
    let expected_snapshot = store.read_snapshot(&principal, &scope)?;
    let expected_history = store.history(&principal, &scope, &target)?;
    let mut authorization_checks = 0_usize;
    let mut check = || {
        authorization_checks += 1;
        Ok(())
    }; // Accepted synthetic closure only.
    let image = store.backup_recovery_to(&image_path, &mut check)?;
    let verified = store.validate_recovery_image(&image_path, &mut check)?;
    assert_eq!(image, verified);
    assert_eq!(image.database_schema, DATABASE_VERSION);
    assert_eq!(image.database_lineage, DATABASE_LINEAGE);
    assert_eq!(image.contract_version, CONTRACT_VERSION);
    assert_eq!(
        image.assets,
        initial
            .records
            .iter()
            .filter(|record| record.record_type == RecordType::Asset)
            .cloned()
            .collect::<Vec<_>>()
    );
    store.close()?;
    let source_rows = all_rows(&live)?;
    let image_rows = all_rows(&image_path)?;
    assert_eq!(source_rows, image_rows); // Every persisted row, including other-home rows.
    assert_eq!(image_rows["audits"].len(), 3);
    assert_eq!(image_rows["receipts"].len(), 3);
    assert_eq!(image_rows["batch_receipts"].len(), 1);
    let mut reopened = AtlasStore::open(
        &image_path,
        semantics.storage_contract(),
        authorization,
        runtime,
        StoreOptions::default(),
    )?;
    assert_eq!(
        reopened.read_snapshot(&principal, &scope)?,
        expected_snapshot
    );
    assert_eq!(
        reopened.read_record(&principal, &scope, &target)?,
        circuit.record
    );
    assert_eq!(
        reopened.history(&principal, &scope, &target)?,
        expected_history
    );
    for result in committed.results {
        assert_eq!(
            reopened.read_record(&principal, &scope, &result.record.reference())?,
            result.record
        );
    }
    reopened.close()?;
    fs::write(
        directory.join("evidence.json"),
        serde_json::to_vec_pretty(&json!({
            "scope":"accepted synthetic native capture/validation/native reopen; no stock journal or physical originals",
            "image":image,"authorizationChecks":authorization_checks,
            "tableCounts":image_rows.iter().map(|(name,rows)|(name.clone(),rows.len())).collect::<BTreeMap<_,_>>(),
            "allPersistedRowsEqual":true,"nativeReopenEqual":true,
        }))?,
    )?;
    println!(
        "healthy recovery evidence: {}",
        directory.join("evidence.json").display()
    );
    Ok(())
}
