//! Prepared generated positive only; source-owner inspection/release precedes execution.
//! No listeners, sessions, providers, household data or control probes.
use super::*;
use crate::{
    access::{AccessBoundary, AccessConfig},
    app::{ReadAuthority, ServerRuntime},
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    lifecycle::backup::QueueFreeNativeOwners,
    media::AssetVault,
    storage::geodata::{GeodataOwners, GeodataSourcePolicy},
};
use rusqlite::types::Value as SqlValue;
use std::{collections::BTreeMap, fs, os::unix::fs::MetadataExt, sync::Mutex};

// No documents are installed in this generated profile. No policy call or
// source authorization is expected during administrative closure inspection.
struct NoDocuments;
impl GeodataSourcePolicy for NoDocuments {
    fn authorize(
        &self,
        _: &crate::access::TransactionAuthorization<'_>,
        _: &Value,
        _: bool,
    ) -> Result<()> {
        panic!("Generated document-free validation does not authorize a source")
    }
}

type SyntheticStore = AtlasStore<NativeContracts, ReadAuthority, ServerRuntime>;
type Rows = Vec<Vec<SqlValue>>;

fn rows(db: &Connection, sql: &str) -> Rows {
    let mut statement = db.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |row| (0..columns).map(|column| row.get(column)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

// Compare the entire logical persistence, including catalogue, migrations,
// receipts, native records, stock/queue state and full-profile metadata.
fn logical_state(db: &Connection) -> BTreeMap<String, Rows> {
    let tables: Vec<String> = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let mut state = BTreeMap::new();
    state.insert(
        "catalogue".into(),
        rows(
            db,
            "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name",
        ),
    );
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        state.insert(
            table,
            rows(db, &format!("SELECT * FROM \"{quoted}\" ORDER BY rowid")),
        );
    }
    state
}

fn connection_state(db: &Connection) -> (u64, u64, i64, Vec<Rows>) {
    (
        db.total_changes(),
        db.changes(),
        db.last_insert_rowid(),
        [
            "PRAGMA database_list",
            "PRAGMA user_version",
            "PRAGMA journal_mode",
            "PRAGMA query_only",
            "PRAGMA foreign_keys",
            "PRAGMA synchronous",
            "PRAGMA busy_timeout",
            "PRAGMA data_version",
        ]
        .iter()
        .map(|sql| rows(db, sql))
        .collect(),
    )
}

#[test]
fn healthy_current_profile_read_validation() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let path = root.join("atlas.sqlite");
    let access = Arc::new(Mutex::new(
        AccessBoundary::in_memory(
            AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()]).unwrap(),
        )
        .unwrap(),
    ));
    let vault = Arc::new(AssetVault::open(&root.join("media")).unwrap());
    let owners = GeodataOwners::new(access.clone(), vault.clone(), Arc::new(NoDocuments));
    let stock = NativeStockContract::new().unwrap();
    let queue_free = QueueFreeNativeOwners::for_queue_free_profile().unwrap();
    let peers = RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queue_free,
        evidence: &queue_free,
    };
    let initial: Snapshot = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))
    .unwrap();
    assert!(!initial.records.is_empty());
    let mut atlas = SyntheticStore::open(
        &path,
        NativeContracts,
        ReadAuthority(access.clone()),
        ServerRuntime,
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )
    .unwrap();
    atlas.initialize_synthetic(&initial).unwrap();

    // Existing constructors prepare a valid generated full profile from a
    // standalone native image. This setup is outside the validation operation.
    let source = root.join("closed-v5.sqlite");
    let expected_atlas = atlas
        .backup_recovery_to_with_peers(&source, &peers, &mut || Ok(()))
        .unwrap();
    assert_eq!(expected_atlas.contract_version, CONTRACT_VERSION);
    assert_eq!(expected_atlas.database_lineage, DATABASE_LINEAGE);
    assert_eq!(expected_atlas.database_schema, DATABASE_VERSION);
    assert_eq!(
        expected_atlas.assets,
        initial
            .records
            .iter()
            .filter(|record| record.record_type == RecordType::Asset)
            .cloned()
            .collect::<Vec<_>>()
    );
    assert!(!expected_atlas.assets.is_empty());
    let full_directory = root.join("full");
    crate::storage::geodata_full::copy_v5_to_full(
        &source,
        &full_directory,
        &crate::media::types::sha256(&fs::read(&source).unwrap()),
        &NativeContracts,
        &peers,
        &owners,
        &mut || Ok(()),
    )
    .unwrap();
    let full_path = full_directory.join("atlas.sqlite");
    let mut full = SyntheticStore::open_existing_geodata_full(
        &full_path,
        NativeContracts,
        ReadAuthority(access.clone()),
        ServerRuntime,
        StoreOptions::default(),
        owners,
        &peers,
        &mut || Ok(()),
    )
    .unwrap();
    let full_identity = full.full_geodata_identity().unwrap();
    let mut expected_full = expected_atlas.clone();
    expected_full.contract_version = crate::storage::geodata_full::CONTRACT.into();
    expected_full.database_lineage = crate::storage::geodata_full::LINEAGE.into();
    expected_full.database_schema = crate::storage::geodata_full::VERSION;

    for (store, database, expected) in [
        (&mut atlas, &path, expected_atlas),
        (&mut full, &full_path, expected_full),
    ] {
        let identity = store.instance.clone();
        let original_connection = std::ptr::from_ref(&store.db);
        let metadata = fs::metadata(database).unwrap();
        let physical_identity = (metadata.dev(), metadata.ino());
        let bytes = fs::read(database).unwrap();
        let before = logical_state(&store.db);
        let connection = connection_state(&store.db);
        assert!(store.db.is_autocommit());
        assert!(Arc::ptr_eq(&store.authorization.0, &access));
        let mut checkpoints = 0;
        let image = store
            .validate_current_profile_read_only_with_peers(&peers, &mut || {
                checkpoints += 1;
                Ok(())
            })
            .unwrap();
        assert!(checkpoints > 0);
        assert_eq!(image, expected);
        assert_eq!(logical_state(&store.db), before);
        assert_eq!(connection_state(&store.db), connection);
        assert_eq!(std::ptr::from_ref(&store.db), original_connection);
        assert!(Arc::ptr_eq(&store.instance, &identity));
        assert!(Arc::ptr_eq(&store.authorization.0, &access));
        assert!(store.db.is_autocommit());
        let metadata = fs::metadata(database).unwrap();
        assert_eq!((metadata.dev(), metadata.ino()), physical_identity);
        assert_eq!(fs::read(database).unwrap(), bytes);
    }
    assert!(full.matches_full_geodata_identity(&full_identity));
    assert!(full.full_geodata_belongs_to(&access, &vault));
    atlas.close().unwrap();
    full.close().unwrap();
}
