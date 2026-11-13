//! Disposable synthetic state only. A receipt issued under another `st_dev`
//! numbering (as after a macOS reboot) still reopens, backs up and rebinds;
//! a replaced or swapped database is still refused.
use super::{State, initialize_without_password, rebind_origin, reopen};
use crate::{config::server::ServerConfig, lifecycle::backup};
use serde_json::json;
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

#[test]
fn replaced_database_is_refused_after_renumbering() {
    let fixture = Fixture::new();
    fixture.renumber_receipt();
    // Same bytes, same directory and device, new inode: still a replacement.
    let atlas = fixture.data("atlas.sqlite");
    let before = fs::metadata(&atlas).unwrap().ino();
    replace_private(&atlas, &fs::read(&atlas).unwrap());
    assert_ne!(fs::metadata(&atlas).unwrap().ino(), before);
    assert_eq!(error(reopen(&fixture.config)), BINDING);
}

#[test]
fn swapped_databases_are_refused_after_renumbering() {
    let fixture = Fixture::new();
    fixture.renumber_receipt();
    let (access, atlas, aside) = (
        fixture.data("access.sqlite"),
        fixture.data("atlas.sqlite"),
        fixture.data("swap.sqlite"),
    );
    fs::rename(&access, &aside).unwrap();
    fs::rename(&atlas, &access).unwrap();
    fs::rename(&aside, &atlas).unwrap();
    assert_eq!(error(reopen(&fixture.config)), BINDING);
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
