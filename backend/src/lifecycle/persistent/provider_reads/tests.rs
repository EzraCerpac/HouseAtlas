//! Disposable synthetic startup selection; no listener, transport or live input.
use super::*;
use crate::{config::server::ServerConfig, lifecycle};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
};

fn server_config(root: &std::path::Path) -> ServerConfig {
    serde_json::from_value(json!({
        "schemaVersion":1,"deploymentId":"00000000-0000-4000-8000-000000000050",
        "dataDirectory":root,"logDirectory":root.join("logs"),
        "frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("certificate.pem"),"tlsPrivateKey":root.join("key.pem"),
        "listen":"127.0.0.1:5443","origin":"https://startup.synthetic.invalid:5443",
        "homes":[{"workspaceId":"00000000-0000-4000-8000-000000000001",
            "homeId":"00000000-0000-4000-8000-000000000002","label":"Synthetic home"}],
        "mcpCommands":"read-only"
    }))
    .unwrap()
}
fn packet(config: &ServerConfig) -> Value {
    let fixture = lifecycle::fixture().unwrap();
    json!({
        "schemaVersion":1,"serverConfigurationDigest":config.state_digest().unwrap(),
        "homeboxCached":[{"registration":fixture["sources"][0],"origin":"https://homebox.synthetic.invalid",
            "limits":{"maxPageSize":2,"maxPages":4,"maxResponseBytes":65536,
                "maxGenerationBytes":262144,"requestTimeoutMs":1000,"generationTimeoutMs":5000}}],
        "networkCached":[]
    })
}
fn write_packet(path: &std::path::Path, value: &Value) -> ProviderReadSelection {
    let bytes = serde_json::to_vec(value).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(&bytes).unwrap();
    file.sync_all().unwrap();
    ProviderReadSelection {
        path: path.into(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}
struct Fixture {
    _temp: tempfile::TempDir,
    config: ServerConfig,
    core: Core,
    lease: ServerLease,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let parent = fs::canonicalize(temp.path()).unwrap();
        let config = server_config(&parent.join("data"));
        let core = lifecycle::prepare(&config.data_directory, &config.origin).unwrap();
        fs::create_dir(&config.log_directory).unwrap();
        fs::set_permissions(&config.log_directory, fs::Permissions::from_mode(0o700)).unwrap();
        for path in [
            config.data_directory.join("server.lock"),
            config.log_directory.join("server.events.jsonl"),
        ] {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
                .unwrap();
        }
        let lease = ServerLease::acquire(&config, false).unwrap();
        Self {
            _temp: temp,
            config,
            core,
            lease,
        }
    }
    fn selection(&self, value: &Value) -> ProviderReadSelection {
        write_packet(
            &self.config.data_directory.join("provider-profile.json"),
            value,
        )
    }
}
fn counts(config: &ServerConfig) -> (i64, i64) {
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY;
    let store =
        rusqlite::Connection::open_with_flags(config.data_directory.join("atlas.sqlite"), flags)
            .unwrap();
    let access =
        rusqlite::Connection::open_with_flags(config.data_directory.join("access.sqlite"), flags)
            .unwrap();
    (
        store
            .query_row("SELECT count(*) FROM sources", [], |r| r.get(0))
            .unwrap(),
        access
            .query_row("SELECT count(*) FROM access_sources", [], |r| r.get(0))
            .unwrap(),
    )
}

#[test]
fn selection_is_explicit_paired_and_does_not_consume_other_options() {
    let args = vec![
        "serve".into(),
        "--server-config".into(),
        "/synthetic/server.json".into(),
    ];
    let (remaining, selection) = ProviderReadSelection::from_arguments(&args).unwrap();
    assert_eq!(remaining, args);
    assert!(selection.is_none());
    for args in [
        vec![
            "--provider-reads-profile".into(),
            "/synthetic/profile.json".into(),
        ],
        vec!["--provider-reads-sha256".into(), "a".repeat(64)],
        vec![
            "--provider-reads-profile".into(),
            "relative.json".into(),
            "--provider-reads-sha256".into(),
            "a".repeat(64),
        ],
        vec![
            "--provider-reads-profile".into(),
            "/synthetic/profile.json".into(),
            "--provider-reads-sha256".into(),
            "A".repeat(64),
        ],
        vec![
            "--provider-reads-profile".into(),
            "/synthetic/a".into(),
            "--provider-reads-profile".into(),
            "/synthetic/b".into(),
        ],
    ] {
        assert!(ProviderReadSelection::from_arguments(&args).is_err());
    }
    let args = vec![
        "serve".into(),
        "--provider-reads-profile".into(),
        "/synthetic/profile.json".into(),
        "--provider-reads-sha256".into(),
        "a".repeat(64),
    ];
    let (remaining, selection) = ProviderReadSelection::from_arguments(&args).unwrap();
    assert_eq!(remaining, ["serve"]);
    assert!(selection.is_some());
}

#[test]
fn closed_profile_requires_digest_scope_owner_and_unique_registration() {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let config = server_config(&root);
    let valid = packet(&config);
    let parsed: Packet = serde_json::from_value(valid.clone()).unwrap();
    parsed.validate(&config).unwrap();
    let mut changed = server_config(&root);
    changed.homes[0].label = "Changed synthetic home".into();
    assert!(parsed.validate(&changed).is_err());
    for case in [
        "scope",
        "owner",
        "duplicate",
        "digest",
        "version",
        "allowlist",
    ] {
        let mut v = valid.clone();
        match case {
            "scope" => {
                v["homeboxCached"][0]["registration"]["homeId"] =
                    json!("00000000-0000-4000-8000-000000000099")
            }
            "owner" => v["homeboxCached"][0]["registration"]["owner"] = json!("network"),
            "duplicate" => {
                let r = v["homeboxCached"][0].clone();
                v["homeboxCached"].as_array_mut().unwrap().push(r);
            }
            "digest" => v["serverConfigurationDigest"] = json!("0".repeat(64)),
            "version" => v["schemaVersion"] = json!(2),
            "allowlist" => {
                v["homeboxCached"][0]["registration"]["allowedExternalIds"] = json!(["bad-id"])
            }
            _ => unreachable!(),
        }
        assert!(
            serde_json::from_value::<Packet>(v)
                .unwrap()
                .validate(&config)
                .is_err(),
            "{case}"
        );
    }
    let mut unknown = valid.clone();
    unknown["credentials"] = json!("Synthetic forbidden field");
    assert!(serde_json::from_value::<Packet>(unknown).is_err());
    let mut huge = valid;
    huge["homeboxCached"] = Value::Array(vec![huge["homeboxCached"][0].clone(); MAX_SOURCES + 1]);
    assert!(
        serde_json::from_value::<Packet>(huge)
            .unwrap()
            .validate(&config)
            .is_err()
    );
}

#[test]
fn profile_bytes_and_current_configuration_are_pinned_on_every_reopen() {
    let f = Fixture::new();
    let value = packet(&f.config);
    let selected = f.selection(&value);
    let mut altered = value.clone();
    altered["schemaVersion"] = json!(2);
    f.selection(&altered);
    assert!(selected.capture(&f.config).is_err());
    let selected = f.selection(&value);
    let mut changed = server_config(&f.config.data_directory);
    changed.mcp_commands = crate::config::server::ServerCommands::ExistingEditorCommands;
    assert!(selected.capture(&changed).is_err());
    let selected = f.selection(&value);
    selected.capture(&f.config).unwrap();
    // A new independent selection of the same bytes/configuration remains valid.
    f.selection(&value).capture(&f.config).unwrap();
}

#[test]
fn cached_mount_retains_original_owners_without_enrollment_and_absence_is_noop() {
    let f = Fixture::new();
    let before = counts(&f.config);
    let selected = f.selection(&packet(&f.config));
    let mounts = ProviderReadMounts::prepare(&f.config, &f.core, Some(selected), &f.lease).unwrap();
    assert_eq!(mounts.homebox.len(), 1);
    assert!(mounts.network.is_empty());
    // Mutating the selected file after capture cannot replace the typed mount.
    f.selection(&json!({"schemaVersion":99}));
    let original_access = f.core.access.clone();
    let original_store = f.core.store.clone();
    let host = Host::new(
        f.core,
        f.config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )
    .unwrap();
    let host = mounts.apply(host).unwrap();
    let core = host.core.try_lock().unwrap();
    assert!(Arc::ptr_eq(&original_access, &core.access));
    assert!(Arc::ptr_eq(&original_store, &core.store));
    drop(core);
    assert_eq!(counts(&f.config), before);
    let core = host.core.try_lock().unwrap();
    let absent = ProviderReadMounts::prepare(&f.config, &core, None, &f.lease).unwrap();
    assert!(absent.original.is_none() && absent.homebox.is_empty() && absent.network.is_empty());
    drop(core);
    let owner = host.core.clone();
    let same = absent.apply(host).unwrap();
    assert!(Arc::ptr_eq(&owner, &same.core));
}

#[test]
fn prepared_mount_cannot_be_applied_to_a_replacement_core() {
    let f = Fixture::new();
    let mounts = ProviderReadMounts::prepare(
        &f.config,
        &f.core,
        Some(f.selection(&packet(&f.config))),
        &f.lease,
    )
    .unwrap();
    let other = Fixture::new();
    let host = Host::new(
        other.core,
        other.config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )
    .unwrap();
    assert!(mounts.apply(host).is_err());
}

fn network_packet(f: &Fixture, directory: &std::path::Path) -> Value {
    let mut v = packet(&f.config);
    v["homeboxCached"] = json!([]);
    v["networkCached"] = json!([{
        "registration":{"workspaceId":f.config.homes[0].workspace_id,"homeId":f.config.homes[0].home_id,
            "sourceInstanceId":"00000000-0000-4000-8000-000000000012","collectionId":"synthetic-network",
            "owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]},
        "origin":"https://network.synthetic.invalid","review":{"revision":1,"links":{}},
        "limits":{"maxResponseBytes":65536,"maxRecords":100,"requestTimeoutMs":1000},
        "connectTimeoutMs":1000,"idleTimeoutMs":1000,"staleAfterMs":1000,
        "privateDirectory":directory,"entities":[]
    }]);
    v
}

#[test]
fn network_selection_without_existing_custody_does_not_bootstrap_storage() {
    let f = Fixture::new();
    let directory = f.config.data_directory.join("provider-cache");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let v = network_packet(&f, &directory);
    let before = counts(&f.config);
    let selected = f.selection(&v);
    assert!(ProviderReadMounts::prepare(&f.config, &f.core, Some(selected), &f.lease).is_err());
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
    assert_eq!(counts(&f.config), before);
}

#[test]
fn network_mount_reuses_explicit_existing_custody_without_source_enrollment() {
    let f = Fixture::new();
    let directory = f.config.data_directory.join("provider-cache");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let v = network_packet(&f, &directory);
    let parsed: Packet = serde_json::from_value(v.clone()).unwrap();
    let selected = parsed.network_cached.into_iter().next().unwrap();
    let registry =
        ProviderRegistry::from_trusted_configuration(vec![selected.registration]).unwrap();
    let settings = NetworkSettings::new(
        registry.sources()[0].clone(),
        &selected.origin,
        selected.review,
        selected.limits,
        selected.connect_timeout_ms,
        selected.idle_timeout_ms,
        selected.stale_after_ms,
        &directory,
    )
    .unwrap();
    // Explicit disposable fixture custody preparation, never performed by serve.
    settings.open_sidecar().unwrap().close().unwrap();
    let before = counts(&f.config);
    let mounts =
        ProviderReadMounts::prepare(&f.config, &f.core, Some(f.selection(&v)), &f.lease).unwrap();
    assert_eq!(mounts.network.len(), 1);
    assert!(mounts.homebox.is_empty());
    let host = Host::new(
        f.core,
        f.config.origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )
    .unwrap();
    mounts.apply(host).unwrap();
    assert_eq!(counts(&f.config), before);
}

fn provision_network(f: &Fixture) -> (Value, std::path::PathBuf) {
    let directory = f.config.data_directory.join("provider-cache");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let v = network_packet(f, &directory);
    let parsed: Packet = serde_json::from_value(v.clone()).unwrap();
    let entry = parsed.network_cached.into_iter().next().unwrap();
    let registry = ProviderRegistry::from_trusted_configuration(vec![entry.registration]).unwrap();
    let settings = NetworkSettings::new(
        registry.sources()[0].clone(),
        &entry.origin,
        entry.review,
        entry.limits,
        entry.connect_timeout_ms,
        entry.idle_timeout_ms,
        entry.stale_after_ms,
        &directory,
    )
    .unwrap();
    settings.open_sidecar().unwrap().close().unwrap();
    let path = fs::read_dir(&directory)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.extension().is_some_and(|x| x == "sqlite")
                && !p.to_string_lossy().ends_with("raw-archive.sqlite")
        })
        .unwrap();
    (v, path)
}

#[test]
fn network_empty_existing_databases_are_not_initialized_or_repaired() {
    for archive in [false, true] {
        let f = Fixture::new();
        let (v, sidecar) = provision_network(&f);
        let path = if archive {
            sidecar.with_extension("raw-archive.sqlite")
        } else {
            sidecar
        };
        // Keep the original 0600 inode and custody lock, but remove its schema.
        fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        let before = counts(&f.config);
        assert!(
            ProviderReadMounts::prepare(&f.config, &f.core, Some(f.selection(&v)), &f.lease)
                .is_err()
        );
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        assert_eq!(counts(&f.config), before);
        let db = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let tables: i64 = db
            .query_row("SELECT count(*) FROM sqlite_schema", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tables, 0);
    }
}

#[test]
fn network_empty_private_files_do_not_provision_constructor_or_segment_custody() {
    let f = Fixture::new();
    let directory = f.config.data_directory.join("provider-cache");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let v = network_packet(&f, &directory);
    let registration: n::SourceRegistration =
        serde_json::from_value(v["networkCached"][0]["registration"].clone()).unwrap();
    let partition = n::partition_key(&registration.scope).unwrap();
    let sidecar = directory.join(format!(
        "network-{:x}.sqlite",
        Sha256::digest(partition.as_bytes())
    ));
    for path in [&sidecar, &sidecar.with_extension("raw-archive.sqlite")] {
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .unwrap();
    }
    assert!(
        ProviderReadMounts::prepare(&f.config, &f.core, Some(f.selection(&v)), &f.lease).is_err()
    );
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
    assert_eq!(fs::metadata(&sidecar).unwrap().len(), 0);
    assert_eq!(
        fs::metadata(sidecar.with_extension("raw-archive.sqlite"))
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn network_existing_only_never_recreates_removed_database_or_segment_custody() {
    for member in ["sidecar", "archive", "segments"] {
        let f = Fixture::new();
        let (v, sidecar) = provision_network(&f);
        let path = match member {
            "sidecar" => sidecar,
            "archive" => sidecar.with_extension("raw-archive.sqlite"),
            "segments" => sidecar.with_extension("raw-archive.segments"),
            _ => unreachable!(),
        };
        if path.is_dir() {
            fs::remove_dir(&path).unwrap();
        } else {
            fs::remove_file(&path).unwrap();
        }
        let before = counts(&f.config);
        assert!(
            ProviderReadMounts::prepare(&f.config, &f.core, Some(f.selection(&v)), &f.lease)
                .is_err(),
            "{member}"
        );
        assert!(!path.exists(), "{member} was recreated");
        assert_eq!(counts(&f.config), before);
    }
}

#[test]
fn network_existing_schema_requires_immutable_triggers_without_repair() {
    let f = Fixture::new();
    let (v, sidecar) = provision_network(&f);
    let db = rusqlite::Connection::open(&sidecar).unwrap();
    db.execute_batch("DROP TRIGGER core_network_no_update")
        .unwrap();
    db.close().unwrap();
    assert!(
        ProviderReadMounts::prepare(&f.config, &f.core, Some(f.selection(&v)), &f.lease).is_err()
    );
    let db =
        rusqlite::Connection::open_with_flags(&sidecar, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let count: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name='core_network_no_update'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
