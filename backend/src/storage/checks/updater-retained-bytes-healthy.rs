//! Prepared generated positive only. Freeze/review and separate execution
//! release precede registration or running. No listener, provider or target.
use super::*;
use crate::{
    access as a,
    app::{ReadAuthority, RequestPrincipal, ServerRuntime},
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    lifecycle::backup::QueueFreeNativeOwners,
    media::{
        AssetVault, Cancellation, WorkBudget,
        native::NativeMediaRuntime,
        types::{
            AssetPayload, AssetPurpose, Availability, ContentType, LicenseStatus, SourceLicense,
        },
    },
};
use rusqlite::types::Value as SqlValue;
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
};

type Store = AtlasStore<NativeContracts, ReadAuthority, NativeMediaRuntime<ServerRuntime>>;
type Rows = Vec<Vec<SqlValue>>;

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn budget() -> WorkBudget {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default()).unwrap()
}
fn request<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1/commands",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

// Setup only: exact original AT11 editor and held guard. No synthetic grant,
// source qualification, replay owner or successful default is supplied.
struct SetupMutation<'a, 'tx> {
    guard: &'a a::TransactionAuthorization<'tx>,
    original: &'a RequestPrincipal,
}
impl Authorization for SetupMutation<'_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        frame: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        if !std::ptr::eq(principal, self.original)
            || !std::ptr::eq(self.guard.principal(), principal.principal.principal())
            || frame.capability != Capability::Mutate
            || frame.source.is_some()
            || frame.source_partition.is_some()
            || frame.mutation.is_none()
        {
            return Err(Error::new("forbidden", "Generated setup guard differs"));
        }
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(frame.scope)?)?;
        self.guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(|_| Error::new("forbidden", "Original editor guard unavailable"))?;
        Ok(VerifiedActor {
            workspace_id: principal.principal.principal().scope().workspace_id.as_str().into(),
            home_id: principal.principal.principal().scope().home_id.as_str().into(),
            actor_id: principal.principal.principal().actor_id().as_str().into(),
        })
    }
}
fn mutate(
    store: &mut Store,
    access: &crate::app::Access,
    principal: &RequestPrincipal,
    scope: &Scope,
    target: &RecordRef,
    command: Value,
) -> MutationResult {
    // Store is already exclusively borrowed before entering Access.
    let mut committed = None;
    access
        .lock()
        .unwrap()
        .with_mutation_authorization(
            principal.principal.principal(),
            |guard| -> a::AccessResult<()> {
                let authorization = SetupMutation { guard, original: principal };
                committed = Some(
                    store
                        .execute_json_with_authorization(
                            &authorization, principal, scope, target, &command,
                        )
                        .map_err(|_| a::AccessError::Unavailable)?,
                );
                Ok(())
            },
        )
        .unwrap();
    let result = committed.unwrap();
    assert!(!result.replayed);
    result
}
fn payload(vault: &AssetVault, scope: &Scope, bytes: &[u8]) -> AssetPayload {
    let native_scope = crate::media::types::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    };
    let mut body = bytes;
    vault
        .prepare_original(
            &native_scope,
            AssetPurpose::EvidenceOriginal,
            ContentType::Text,
            &mut body,
            &budget(),
        )
        .unwrap()
        .with_provenance(
            SourceLicense { status: LicenseStatus::Unknown, reference: None },
            vec![id(100)],
        )
        .unwrap()
}
fn create(n: u32, value: AssetPayload) -> Value {
    json!({
        "schemaVersion":1,"mutationId":id(n),"operation":"create",
        "expectedRevision":null,"reason":"Generated retained original",
        "guards":[{"record":{"recordType":"evidence","recordId":id(100)},"expectedRevision":1}],
        "value":{"recordType":"asset","payload":value}
    })
}
fn rows(db: &Connection, sql: &str) -> Rows {
    let mut statement = db.prepare(sql).unwrap();
    let count = statement.column_count();
    statement
        .query_map([], |row| (0..count).map(|n| row.get(n)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}
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
        rows(db, "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"),
    );
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        state.insert(table, rows(db, &format!("SELECT * FROM \"{quoted}\" ORDER BY rowid")));
    }
    state
}
fn connection_state(db: &Connection) -> (u64, u64, i64, Vec<Rows>) {
    (
        db.total_changes(),
        db.changes(),
        db.last_insert_rowid(),
        [
            "PRAGMA database_list","PRAGMA user_version","PRAGMA journal_mode",
            "PRAGMA query_only","PRAGMA foreign_keys","PRAGMA synchronous",
            "PRAGMA busy_timeout","PRAGMA data_version",
        ]
        .iter()
        .map(|sql| rows(db, sql))
        .collect(),
    )
}
fn file_state(path: &Path) -> Option<(u64, u64, u32, Vec<u8>)> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            assert!(meta.is_file() && !meta.file_type().is_symlink());
            Some((meta.dev(), meta.ino(), meta.mode(), fs::read(path).unwrap()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => panic!("Generated file observation failed: {error}"),
    }
}
fn vault_state(root: &Path) -> BTreeMap<PathBuf, (u64, u64, u32, Vec<u8>)> {
    let mut pending = vec![root.to_owned()];
    let mut files = BTreeMap::new();
    while let Some(path) = pending.pop() {
        let meta = fs::symlink_metadata(&path).unwrap();
        assert!(!meta.file_type().is_symlink());
        if meta.is_dir() {
            for entry in fs::read_dir(&path).unwrap() {
                pending.push(entry.unwrap().path());
            }
        } else {
            files.insert(path.strip_prefix(root).unwrap().to_owned(), file_state(&path).unwrap());
        }
    }
    files
}

#[test]
fn healthy_current_native_retained_bytes() {
    let temporary = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let database = root.join("atlas.sqlite");
    let media_root = root.join("media");
    let vault = Arc::new(AssetVault::open(&media_root).unwrap());
    let scope = Scope { workspace_id: id(1), home_id: id(2) };
    let access_scope: a::Scope = serde_json::from_value(serde_json::to_value(&scope).unwrap()).unwrap();
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()]).unwrap(),
    )
    .unwrap();
    let user = a::CanonicalId::parse(id(50)).unwrap();
    boundary
        .provision_user(
            &user, &a::CanonicalId::parse(id(51)).unwrap(), "generated-editor",
            &a::hash_password("Synthetic-retained-byte-password-only!").unwrap(), None,
        )
        .unwrap();
    boundary.set_membership(&user, &access_scope, a::Role::Editor, true).unwrap();
    let session = boundary
        .login(
            &request(None, None),
            &serde_json::to_vec(&json!({
                "username":"generated-editor","password":"Synthetic-retained-byte-password-only!"
            }))
            .unwrap(),
            "synthetic-loopback",
        )
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap().to_owned();
    let principal = RequestPrincipal::new(
        boundary
            .authorize(
                &request(Some(&cookie), Some(session.info().csrf_token())),
                &access_scope, a::Action::Mutate,
            )
            .unwrap(),
    );
    let access = Arc::new(Mutex::new(boundary));
    let mut store = Store::open(
        &database, NativeContracts, ReadAuthority(access.clone()),
        NativeMediaRuntime { vault: vault.clone(), server: ServerRuntime },
        StoreOptions { allow_synthetic_bootstrap: true, ..StoreOptions::default() },
    )
    .unwrap();
    let mut initial: Snapshot = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))
    .unwrap();
    initial.records.retain(|r| r.record_type == RecordType::Evidence && r.record_id == id(100));
    initial.sources.clear();
    initial.homebox_entities.clear();
    initial.caches.clear();
    initial.network_relations.clear();
    store.initialize_synthetic(&initial).unwrap();

    let past_bytes = b"Historical generated original.\n";
    let current_bytes = b"Current generated original.\n";
    let past_target = RecordRef { record_type: RecordType::Asset, record_id: id(900) };
    let current_target = RecordRef { record_type: RecordType::Asset, record_id: id(901) };
    let past = mutate(
        &mut store, &access, &principal, &scope, &past_target,
        create(1000, payload(&vault, &scope, past_bytes)),
    );
    let retired = mutate(
        &mut store, &access, &principal, &scope, &past_target,
        json!({
            "schemaVersion":1,"mutationId":id(1001),"operation":"tombstone",
            "expectedRevision":1,"reason":"Retain generated historical original",
            "guards":[{"record":{"recordType":"evidence","recordId":id(100)},"expectedRevision":1}]
        }),
    );
    let current = mutate(
        &mut store, &access, &principal, &scope, &current_target,
        create(1002, payload(&vault, &scope, current_bytes)),
    );
    assert_eq!(past.record.revision, 1);
    assert_eq!(retired.record.revision, 2);
    assert_eq!(retired.record.lifecycle, Lifecycle::Tombstoned);
    assert_eq!(current.record.revision, 1);
    assert_eq!(current.record.lifecycle, Lifecycle::Active);
    assert_ne!(past.record.payload["sha256"], current.record.payload["sha256"]);

    let retained = super::super::super::geodata_full::legacy_assets(&store.db).unwrap();
    assert_eq!(retained.len(), 3);
    assert!(retained.iter().all(|r| r.payload.availability == Availability::Available));
    // Revision 1 of the retired asset survives in its actual mutation receipt;
    // revision 2 is the tombstoned current record. Both retain original bytes.
    assert!(retained.iter().any(|r| r.record_id == id(900) && r.revision == 1));
    assert!(retained.iter().any(|r| r.record_id == id(900) && r.revision == 2));
    assert!(retained.iter().any(|r| r.record_id == id(901) && r.revision == 1));
    for record in &retained {
        let expected = if record.record_id == id(900) { &past_bytes[..] } else { &current_bytes[..] };
        assert_eq!(vault.read_retained(record, &budget()).unwrap(), expected);
    }

    let stock = NativeStockContract::new().unwrap();
    let queue_free = QueueFreeNativeOwners::for_queue_free_profile().unwrap();
    let peers = RecoveryValidationPeers {
        stock: &stock, queues: &[], discovery: &queue_free, evidence: &queue_free,
    };
    let mut sql_checks = 0;
    let expected = store
        .validate_current_profile_read_only_with_peers(&peers, &mut || {
            sql_checks += 1;
            Ok(())
        })
        .unwrap();

    let original_store = store.instance.clone();
    let original_vault = store.runtime.vault.clone();
    let original_connection = std::ptr::from_ref(&store.db);
    let logical = logical_state(&store.db);
    let connection = connection_state(&store.db);
    let main_file = file_state(&database);
    let wal_file = file_state(&root.join("atlas.sqlite-wal"));
    let vault_files = vault_state(&media_root);
    assert!(store.db.is_autocommit());
    let mut native_checks = 0;
    let actual = store
        .validate_current_native_profile_read_only_with_peers(&peers, &mut || {
            native_checks += 1;
            Ok(())
        })
        .unwrap();

    assert_eq!(actual, expected);
    assert_eq!(native_checks, sql_checks + retained.len());
    assert_eq!(logical_state(&store.db), logical);
    assert_eq!(connection_state(&store.db), connection);
    assert_eq!(file_state(&database), main_file);
    assert_eq!(file_state(&root.join("atlas.sqlite-wal")), wal_file);
    assert_eq!(vault_state(&media_root), vault_files);
    assert_eq!(std::ptr::from_ref(&store.db), original_connection);
    assert!(Arc::ptr_eq(&store.instance, &original_store));
    assert!(Arc::ptr_eq(&store.runtime.vault, &original_vault));
    assert!(Arc::ptr_eq(&store.runtime.vault, &vault));
    assert!(Arc::ptr_eq(&store.authorization.0, &access));
    assert!(store.db.is_autocommit());
    store.close().unwrap();
    // This generated observation does not establish general live SHM no-write,
    // whole-Core custody, filesystem fencing or a hard deadline guarantee.
}
