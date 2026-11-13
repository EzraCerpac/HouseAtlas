//! Disposable synthetic state only. A receipt issued under another `st_dev`
//! numbering (as after a macOS reboot) still reopens, backs up and rebinds;
//! a replaced or swapped database is refused by inode alone, and rollback
//! never restores a legacy receipt with stale device numbers.
use super::{State, initialize_without_password, rebind_origin, reopen};
use crate::{
    config::server::ServerConfig,
    lifecycle::{
        backup,
        receipt_compatibility::{self, Selection},
    },
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

const BINDING: &str = "Persistent deployment/state binding changed; no automatic adoption";

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

struct Fixture {
    _temporary: tempfile::TempDir,
    root: PathBuf,
    config: ServerConfig,
}
impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let config: ServerConfig = serde_json::from_value(json!({
            "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),
            "logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
            "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
            "listen":"127.0.0.1:48743","origin":"https://127.0.0.1:48743",
            "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
            "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
                "userId":id(4),"actorId":id(5),"username":"synthetic-local",
                "scope":{"workspaceId":id(2),"homeId":id(3)}}}
        }))
        .unwrap();
        initialize_without_password(&config).unwrap();
        Self {
            _temporary: temporary,
            root,
            config,
        }
    }
    fn data(&self, name: &str) -> PathBuf {
        self.root.join("data").join(name)
    }
    fn receipt(&self) -> Vec<u8> {
        fs::read(self.data("server-state.json")).unwrap()
    }
    /// Reissue the receipt as if both databases had another device number when
    /// it was written. Inodes, digest and schemas stay exact.
    fn renumber_receipt(&self) -> Vec<u8> {
        let mut state: State = serde_json::from_slice(&self.receipt()).unwrap();
        let actual = fs::metadata(self.data("atlas.sqlite")).unwrap().dev();
        assert_eq!(state.atlas_device, actual);
        assert_eq!(state.access_device, actual);
        state.access_device = actual ^ 1;
        state.atlas_device = actual ^ 1;
        let bytes = serde_json::to_vec(&state).unwrap();
        replace_private(&self.data("server-state.json"), &bytes);
        bytes
    }
}

/// Atomically replace a file with a new private inode (0600, single link).
fn replace_private(path: &Path, bytes: &[u8]) {
    let staged = path.with_extension("staged");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staged)
        .unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
    fs::rename(staged, path).unwrap();
}

fn error<T>(result: Result<T, super::Failure>) -> String {
    match result {
        Ok(_) => panic!("expected refusal"),
        Err(error) => error.to_string(),
    }
}

#[test]
fn binding_ignores_only_device_fields() {
    let base = State {
        format: "houseatlas-persistent-server/1".into(),
        configuration_digest: "a".repeat(64),
        atlas_schema: 5,
        access_schema: 1,
        access_device: 10,
        access_inode: 20,
        atlas_device: 10,
        atlas_inode: 30,
    };
    let renumbered = State {
        access_device: 11,
        atlas_device: 12,
        ..base.clone()
    };
    assert!(base.binds(&renumbered) && renumbered.binds(&base));
    for changed in [
        State {
            format: "houseatlas-persistent-full-geodata-server/1".into(),
            ..renumbered.clone()
        },
        State {
            configuration_digest: "b".repeat(64),
            ..renumbered.clone()
        },
        State {
            atlas_schema: 6,
            ..renumbered.clone()
        },
        State {
            access_schema: 2,
            ..renumbered.clone()
        },
        State {
            access_inode: 21,
            ..renumbered.clone()
        },
        State {
            atlas_inode: 31,
            ..renumbered.clone()
        },
        State {
            access_inode: 30,
            atlas_inode: 20,
            ..renumbered.clone()
        },
    ] {
        assert!(!base.binds(&changed) && !changed.binds(&base));
    }
}

#[test]
fn renumbered_device_reopens_without_rewriting_the_receipt() {
    let fixture = Fixture::new();
    let renumbered = fixture.renumber_receipt();
    let (core, lease) = reopen(&fixture.config).unwrap();
    drop((core, lease));
    assert_eq!(fixture.receipt(), renumbered);
    // A second ordinary restart is equally unaffected.
    drop(reopen(&fixture.config).unwrap());
    assert_eq!(fixture.receipt(), renumbered);
}

#[test]
fn renumbered_device_still_allows_offline_backup() {
    let fixture = Fixture::new();
    fixture.renumber_receipt();
    let config_path = fixture.root.join("server-config.json");
    replace_private(&config_path, &serde_json::to_vec(&fixture.config).unwrap());
    let destination = fixture.root.join("backup-bundle");
    let selection = backup::Selection::from_arguments(&[
        "--server-config".into(),
        config_path.to_str().unwrap().into(),
        "--destination".into(),
        destination.to_str().unwrap().into(),
        "--profile".into(),
        backup::PROFILE.into(),
    ])
    .unwrap();
    backup::capture(&selection).unwrap();
    assert!(destination.join("manifest.json").is_file());
}

/// The receipt's device numbers equal the current ones, so a refusal can only
/// come from an inode (or other non-device) difference.
fn assert_receipt_devices_current(fixture: &Fixture) {
    let state: State = serde_json::from_slice(&fixture.receipt()).unwrap();
    for (name, device) in [
        ("access.sqlite", state.access_device),
        ("atlas.sqlite", state.atlas_device),
    ] {
        assert_eq!(fs::metadata(fixture.data(name)).unwrap().dev(), device);
    }
}

#[test]
fn replaced_database_is_refused_by_inode_alone() {
    for name in ["access.sqlite", "atlas.sqlite"] {
        let fixture = Fixture::new();
        // Same bytes, directory and device; only the inode changes.
        let path = fixture.data(name);
        let before = fs::metadata(&path).unwrap();
        replace_private(&path, &fs::read(&path).unwrap());
        let after = fs::metadata(&path).unwrap();
        assert_eq!(after.dev(), before.dev());
        assert_ne!(after.ino(), before.ino());
        assert_receipt_devices_current(&fixture);
        assert_eq!(error(reopen(&fixture.config)), BINDING, "{name}");
    }
}

#[test]
fn swapped_databases_are_refused_by_inode_alone() {
    let fixture = Fixture::new();
    let (access, atlas, aside) = (
        fixture.data("access.sqlite"),
        fixture.data("atlas.sqlite"),
        fixture.data("swap.sqlite"),
    );
    fs::rename(&access, &aside).unwrap();
    fs::rename(&atlas, &access).unwrap();
    fs::rename(&aside, &atlas).unwrap();
    assert_receipt_devices_current(&fixture);
    assert_eq!(error(reopen(&fixture.config)), BINDING);
}

/// Upgrade tolerates a renumbered device, but rollback must not restore a
/// legacy receipt whose device numbers the legacy binary would refuse.
#[test]
fn rollback_refuses_legacy_receipt_with_renumbered_devices() {
    let sha256 = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
    // `false` is the positive control: unchanged devices round-trip.
    for renumbered in [false, true] {
        let fixture = Fixture::new();
        let mut state: State = serde_json::from_slice(&fixture.receipt()).unwrap();
        state.configuration_digest = fixture.config.legacy_state_digest().unwrap();
        if renumbered {
            state.access_device ^= 1;
            state.atlas_device ^= 1;
        }
        let legacy = serde_json::to_vec(&state).unwrap();
        replace_private(&fixture.data("server-state.json"), &legacy);
        let config = serde_json::to_vec(&fixture.config).unwrap();
        let config_path = fixture.root.join("server-config.json");
        replace_private(&config_path, &config);

        let upgrade = Selection::new(config_path.clone(), sha256(&config), sha256(&legacy), None);
        if let Err(error) = receipt_compatibility::upgrade(&upgrade.unwrap()) {
            panic!("upgrade (renumbered: {renumbered}): {error}");
        }
        let upgraded = fixture.receipt();
        assert_ne!(upgraded, legacy);

        let rollback = Selection::new(
            config_path,
            sha256(&config),
            sha256(&upgraded),
            Some(sha256(&legacy)),
        )
        .unwrap();
        match receipt_compatibility::rollback(&rollback) {
            Ok(_) if !renumbered => assert_eq!(fixture.receipt(), legacy),
            Err(error) if renumbered => {
                assert_eq!(
                    error.to_string(),
                    "Legacy receipt device numbers differ from the current databases; the legacy binary would refuse it, so rollback is unavailable"
                );
                assert_eq!(fixture.receipt(), upgraded);
            }
            Ok(_) => panic!("rollback restored a renumbered legacy receipt"),
            Err(error) => panic!("rollback control: {error}"),
        }
    }
}

#[test]
fn renumbered_device_still_allows_explicit_origin_rebind() {
    let fixture = Fixture::new();
    let renumbered = fixture.renumber_receipt();
    let mut wire = serde_json::to_value(&fixture.config).unwrap();
    let identity = wire["authentication"]["identity"].clone();
    wire["origin"] = json!("https://houseatlas.synthetic.ts.net");
    wire["authentication"] = json!({"mode":"trusted-proxy","identity":identity,
        "policy":{"userLogin":"synthetic@gateway","nodeTag":"tag:synthetic",
            "peerUid":rustix::process::geteuid().as_raw()},
        "socket":fixture.data("gateway.sock")});
    let candidate: ServerConfig = serde_json::from_value(wire).unwrap();
    rebind_origin(&fixture.config, &candidate).unwrap();
    let published: State = serde_json::from_slice(&fixture.receipt()).unwrap();
    let previous: State = serde_json::from_slice(&renumbered).unwrap();
    assert!(
        published
            == State {
                configuration_digest: candidate.state_digest().unwrap(),
                ..previous
            }
    );
    drop(reopen(&candidate).unwrap());
}
