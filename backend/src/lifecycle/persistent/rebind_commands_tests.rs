//! Disposable synthetic state only: the offline MCP command-policy rebind flips
//! `mcpCommands` both ways, refuses every other change and a no-op, revokes
//! sessions, and leaves a receipt that serves the new configuration only.
use super::{State, initialize, initialize_without_password, rebind_commands, reopen};
use crate::{access as a, config::server::ServerConfig};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

const BINDING: &str = "Persistent deployment/state binding changed; no automatic adoption";
const ORIGIN: &str = "https://127.0.0.1:48743";

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

struct Fixture {
    _temporary: tempfile::TempDir,
    root: PathBuf,
    config: ServerConfig,
}
impl Fixture {
    fn new(password: bool) -> Self {
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let mut wire = json!({
            "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),
            "logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
            "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
            "listen":"127.0.0.1:48743","origin":ORIGIN,
            "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
            "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
                "userId":id(4),"actorId":id(5),"username":"synthetic-local",
                "scope":{"workspaceId":id(2),"homeId":id(3)}}}
        });
        if password {
            wire.as_object_mut().unwrap().remove("authentication");
        }
        let config: ServerConfig = serde_json::from_value(wire).unwrap();
        if password {
            let packet = root.join("provisioning.json");
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&packet)
                .unwrap();
            file.write_all(
                &serde_json::to_vec(&json!({"schemaVersion":1,"users":[{
                "userId":id(4),"actorId":id(5),"username":"synthetic-editor",
                "password":"synthetic disposable password",
                "memberships":[{"workspaceId":id(2),"homeId":id(3),"role":"editor"}]}]}))
                .unwrap(),
            )
            .unwrap();
            file.sync_all().unwrap();
            initialize(&config, &packet).unwrap();
        } else {
            initialize_without_password(&config).unwrap();
        }
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
    fn with(&self, change: impl FnOnce(&mut Value)) -> ServerConfig {
        let mut wire = serde_json::to_value(&self.config).unwrap();
        change(&mut wire);
        serde_json::from_value(wire).unwrap()
    }
    fn editor_commands(&self) -> ServerConfig {
        self.with(|wire| wire["mcpCommands"] = json!("existing-editor-commands"))
    }
    /// Names of every file in the data directory except the stable set.
    fn extra_files(&self) -> Vec<String> {
        let mut names = fs::read_dir(self.root.join("data"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| {
                !matches!(
                    name.as_str(),
                    "access.sqlite"
                        | "atlas.sqlite"
                        | "media"
                        | "server-state.json"
                        | "server.lock"
                        | "logs"
                ) && !name.ends_with("-wal")
                    && !name.ends_with("-shm")
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    }
}

fn error<T>(result: Result<T, super::Failure>) -> String {
    match result {
        Ok(_) => panic!("expected refusal"),
        Err(error) => error.to_string(),
    }
}

fn access_counts(path: &Path) -> (String, i64, i64) {
    let db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    db.query_row(
        "SELECT (SELECT epoch FROM access_meta WHERE id=1),
            (SELECT count(*) FROM access_sessions),(SELECT count(*) FROM access_users)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .unwrap()
}

/// One actual native loopback-local session on the selected configuration.
fn open_local_session(config: &ServerConfig) {
    let (core, lease) = reopen(config).unwrap();
    let url = format!("{ORIGIN}/api/atlas/auth/login");
    core.access
        .lock()
        .unwrap()
        .login_loopback_local(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            "127.0.0.1".parse().unwrap(),
        )
        .unwrap();
    drop((core, lease));
}

#[test]
fn command_policy_flips_both_ways_and_serves_only_the_selected_config() {
    let fixture = Fixture::new(false);
    let read_only = fixture.config.clone();
    let editor = fixture.editor_commands();
    let original = fixture.receipt();
    let access = fixture.data("access.sqlite");
    open_local_session(&read_only);
    let (epoch, sessions, users) = access_counts(&access);
    assert_eq!((sessions, users), (1, 1));

    rebind_commands(&read_only, &editor).unwrap();
    let published: State = serde_json::from_slice(&fixture.receipt()).unwrap();
    let previous: State = serde_json::from_slice(&original).unwrap();
    assert!(
        published
            == State {
                configuration_digest: editor.state_digest().unwrap(),
                ..previous.clone()
            }
    );
    // Strict old receipt kept verbatim; no pending fence remains.
    let backup = format!(
        "server-state.previous.{}.json",
        read_only.state_digest().unwrap()
    );
    assert_eq!(fs::read(fixture.data(&backup)).unwrap(), original);
    assert_eq!(fixture.extra_files(), vec![backup.clone()]);
    // Native sessions and rates revoked; accounts unchanged; epoch rotated.
    let (rotated, sessions, users) = access_counts(&access);
    assert_ne!(rotated, epoch);
    assert_eq!((sessions, users), (0, 1));
    // Serve's receipt check: the new configuration opens, the old one cannot.
    assert_eq!(error(reopen(&read_only)), BINDING);
    open_local_session(&editor);

    // Rollback is the reverse rebind and restores the original receipt bytes.
    rebind_commands(&editor, &read_only).unwrap();
    assert_eq!(fixture.receipt(), original);
    assert_eq!(access_counts(&access).1, 0);
    assert_eq!(error(reopen(&editor)), BINDING);
    drop(reopen(&read_only).unwrap());
    // A second flip reuses the identical retained backup.
    rebind_commands(&read_only, &editor).unwrap();
    drop(reopen(&editor).unwrap());
}

#[test]
fn password_mode_flips_without_a_local_identity() {
    let fixture = Fixture::new(true);
    assert!(fixture.config.authentication.is_password());
    let editor = fixture.editor_commands();
    // Origin and listen move together (a valid password-mode candidate).
    let moved = fixture.with(|wire| {
        wire["mcpCommands"] = json!("existing-editor-commands");
        wire["origin"] = json!("https://127.0.0.1:48744");
        wire["listen"] = json!("127.0.0.1:48744");
    });
    assert_eq!(
        error(rebind_commands(&fixture.config, &moved)),
        "Command rebind accepts only an mcpCommands change; every other field must be unchanged"
    );
    rebind_commands(&fixture.config, &editor).unwrap();
    assert_eq!(error(reopen(&fixture.config)), BINDING);
    drop(reopen(&editor).unwrap());
}

#[test]
fn every_other_change_and_a_noop_are_refused_without_writes() {
    let fixture = Fixture::new(false);
    let original = fixture.receipt();
    let access = fixture.data("access.sqlite");
    open_local_session(&fixture.config);
    let before = access_counts(&access);
    let only =
        "Command rebind accepts only an mcpCommands change; every other field must be unchanged";
    let root = fixture.root.clone();
    let changes: Vec<Box<dyn Fn(&mut Value)>> = vec![
        Box::new(|w| w["deploymentId"] = json!(id(9))),
        Box::new(|w| w["homes"][0]["label"] = json!("Other Synthetic Home")),
        Box::new(move |w| w["frontendDirectory"] = json!(root.join("other-frontend"))),
        Box::new(|w| w["authentication"]["identity"]["username"] = json!("other-local")),
        Box::new(|w| {
            w.as_object_mut().unwrap().remove("authentication");
        }),
    ];
    for change in changes {
        let candidate = fixture.with(|wire| {
            wire["mcpCommands"] = json!("existing-editor-commands");
            change(wire);
        });
        assert_eq!(error(rebind_commands(&fixture.config, &candidate)), only);
    }
    assert_eq!(
        error(rebind_commands(&fixture.config, &fixture.config)),
        "Command policy is unchanged; nothing to rebind"
    );
    // Nothing was written: receipt, backup/pending files and sessions unchanged.
    assert_eq!(fixture.receipt(), original);
    assert!(fixture.extra_files().is_empty());
    assert_eq!(access_counts(&access), before);
    drop(reopen(&fixture.config).unwrap());
}

const FENCED: &str =
    "Incomplete explicit rebind requires reviewed recovery; no automatic receipt adoption";
const MISMATCH: &str =
    "Pending rebind receipt does not match this command-policy change; reviewed recovery required";

#[test]
fn foreign_pending_fence_blocks_both_configurations_and_is_never_removed() {
    let fixture = Fixture::new(false);
    let editor = fixture.editor_commands();
    // A pending receipt this pair did not write (and no retained backup).
    let pending = fixture.data("server-state.rebind.pending");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&pending)
        .unwrap()
        .write_all(b"{}")
        .unwrap();
    assert_eq!(error(reopen(&fixture.config)), FENCED);
    assert_eq!(error(reopen(&editor)), FENCED);
    assert_eq!(error(rebind_commands(&fixture.config, &editor)), MISMATCH);
    assert_eq!(error(rebind_commands(&editor, &fixture.config)), MISMATCH);
    assert_eq!(fs::read(&pending).unwrap(), b"{}");
}

#[test]
fn rerunning_the_same_pair_recovers_every_interruption_point() {
    for point in [
        "rebind-staged",
        "rebind-linked",
        "rebind-pending",
        "rebind-revoked",
        "rebind-published",
    ] {
        let fixture = Fixture::new(false);
        let read_only = fixture.config.clone();
        let editor = fixture.editor_commands();
        let original = fixture.receipt();
        let access = fixture.data("access.sqlite");
        open_local_session(&read_only);
        super::ADOPTION_FAULT.with(|fault| fault.set(Some(point)));
        let interrupted = error(rebind_commands(&read_only, &editor));
        super::ADOPTION_FAULT.with(|fault| fault.set(None));
        assert!(interrupted.contains(point), "{point}: {interrupted}");
        let sessions = access_counts(&access).1;
        let staged = fixture.data("server-state.rebind.staged");
        assert_eq!(
            staged.exists(),
            matches!(point, "rebind-staged" | "rebind-linked")
        );
        if point == "rebind-staged" {
            // The fence was never published: the old configuration still serves.
            assert_eq!(fixture.receipt(), original);
            assert!(!fixture.data("server-state.rebind.pending").exists());
            drop(reopen(&read_only).unwrap());
            assert_eq!(access_counts(&access).1, 1);
        } else if point == "rebind-published" {
            assert_eq!(sessions, 0, "{point}");
            assert_eq!(error(reopen(&read_only)), BINDING, "{point}");
        } else {
            // Both configurations are fenced; the old receipt is still published.
            assert_eq!(sessions, i64::from(point != "rebind-revoked"), "{point}");
            assert_eq!(fixture.receipt(), original, "{point}");
            assert_eq!(error(reopen(&read_only)), FENCED, "{point}");
            assert_eq!(error(reopen(&editor)), FENCED, "{point}");
            // The reverse pair does not match this pending receipt.
            assert_eq!(
                error(rebind_commands(&editor, &read_only)),
                MISMATCH,
                "{point}"
            );
            assert!(
                fixture.data("server-state.rebind.pending").exists(),
                "{point}"
            );
        }
        // The same command finishes; only the new configuration serves.
        rebind_commands(&read_only, &editor).unwrap();
        assert_eq!(access_counts(&access).1, 0, "{point}");
        let backup = format!(
            "server-state.previous.{}.json",
            read_only.state_digest().unwrap()
        );
        assert_eq!(fixture.extra_files(), vec![backup], "{point}");
        assert_eq!(error(reopen(&read_only)), BINDING, "{point}");
        open_local_session(&editor);
        // Rerunning a completed pair is a no-op that keeps the session.
        rebind_commands(&read_only, &editor).unwrap();
        assert_eq!(access_counts(&access).1, 1, "{point}");
    }
}

#[test]
fn published_receipt_without_this_pairs_backup_is_refused() {
    let fixture = Fixture::new(false);
    let editor = fixture.editor_commands();
    rebind_commands(&fixture.config, &editor).unwrap();
    let backup = fixture.data(&format!(
        "server-state.previous.{}.json",
        fixture.config.state_digest().unwrap()
    ));
    fs::remove_file(backup).unwrap();
    assert_eq!(
        error(rebind_commands(&fixture.config, &editor)),
        "Published receipt was not issued by this command rebind"
    );
    drop(reopen(&editor).unwrap());
}

#[test]
fn running_server_lease_refuses_the_rebind() {
    let fixture = Fixture::new(false);
    let editor = fixture.editor_commands();
    let original = fixture.receipt();
    let serving = reopen(&fixture.config).unwrap();
    assert!(rebind_commands(&fixture.config, &editor).is_err());
    drop(serving);
    assert_eq!(fixture.receipt(), original);
    assert!(fixture.extra_files().is_empty());
}
