//! Offline explicit provisioning and normal persistent reopen. No fixture data,
//! login/session receipt, provider, archive admission or recovery is created.
use super::Failure;
use crate::{
    access as a,
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::server::{ServerConfig, read_selected_file},
    http::contracts::NativeContracts,
    storage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use zeroize::Zeroizing;

/// Held until all HTTP requests finish. The lock is never removed/replaced.
pub struct ServerLease {
    root: PathBuf,
    directory: File,
    _lock: File,
    log: Mutex<File>,
}

impl ServerLease {
    fn acquire(config: &ServerConfig, initialize: bool) -> Result<Self, Failure> {
        if initialize {
            let parent = config
                .data_directory
                .parent()
                .ok_or("Missing data parent")?;
            if fs::canonicalize(parent)? != parent {
                return Err("Data parent must use its canonical path".into());
            }
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&config.data_directory)?;
        }
        let directory = private_directory(&config.data_directory)?;
        let lock_path = config.data_directory.join("server.lock");
        let lock = open_private(&lock_path, initialize, false)?;
        rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive)
            .map_err(|_| "Another server owns the selected data directory")?;
        if initialize {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&config.log_directory)?;
        }
        let logs = private_directory(&config.log_directory)?;
        let log = open_private(
            &config.log_directory.join("server.events.jsonl"),
            initialize,
            true,
        )?;
        sync(&logs)?;
        sync(&directory)?;
        Ok(Self {
            root: config.data_directory.clone(),
            directory,
            _lock: lock,
            log: Mutex::new(log),
        })
    }

    /// Fixed lifecycle event names only; request bodies/credentials never enter logs.
    pub fn event(&self, event: ServerEvent) -> Result<(), Failure> {
        self.check()?;
        let name = match event {
            ServerEvent::Initialized => "initialized",
            ServerEvent::Listening => "listening",
            ServerEvent::Shutdown => "graceful-shutdown",
        };
        let bytes = serde_json::to_vec(
            &serde_json::json!({"format":"houseatlas-server-event/1", "at":crate::app::now()?, "event":name}),
        )?;
        let mut log = self.log.lock().map_err(|_| "Server log unavailable")?;
        log.write_all(&bytes)?;
        log.write_all(b"\n")?;
        sync(&log)?;
        Ok(())
    }

    fn check(&self) -> Result<(), Failure> {
        let current = private_directory(&self.root)?;
        let original = self.directory.metadata()?;
        let named = current.metadata()?;
        if original.dev() != named.dev() || original.ino() != named.ino() {
            return Err("Server data directory changed".into());
        }
        Ok(())
    }
}

pub enum ServerEvent {
    Initialized,
    Listening,
    Shutdown,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provisioning {
    schema_version: u32,
    users: Vec<User>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct User {
    user_id: a::CanonicalId,
    actor_id: a::CanonicalId,
    username: String,
    password: Secret,
    memberships: Vec<Membership>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Membership {
    workspace_id: a::CanonicalId,
    home_id: a::CanonicalId,
    role: a::Role,
}
struct Secret(Zeroizing<String>);
impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        String::deserialize(decoder).map(|value| Self(Zeroizing::new(value)))
    }
}
struct PreparedUser {
    user: User,
    verifier: a::PasswordVerifier,
}

fn provisioning(path: &Path, config: &ServerConfig) -> Result<Vec<PreparedUser>, Failure> {
    let bytes = Zeroizing::new(read_selected_file(path, 256 * 1024, true)?);
    let packet: Provisioning =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid private provisioning packet")?;
    if packet.schema_version != 1 || packet.users.is_empty() || packet.users.len() > 64 {
        return Err("Unsupported provisioning packet".into());
    }
    let configured = config
        .homes
        .iter()
        .map(|home| (home.workspace_id.as_str(), home.home_id.as_str()))
        .collect::<BTreeSet<_>>();
    let mut ids = BTreeSet::new();
    let mut actors = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut prepared = Vec::new();
    for user in packet.users {
        if !ids.insert(user.user_id.as_str().to_owned())
            || !actors.insert(user.actor_id.as_str().to_owned())
            || !names.insert(user.username.to_ascii_lowercase())
            || user.username.is_empty()
            || user.username.len() > 254
            || !user
                .username
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.@+-".contains(&byte))
            || user.memberships.is_empty()
            || user.memberships.len() > 64
        {
            return Err("Invalid explicit account selection".into());
        }
        let mut memberships = BTreeSet::new();
        for membership in &user.memberships {
            let pair = (
                membership.workspace_id.as_str(),
                membership.home_id.as_str(),
            );
            if !configured.contains(&pair) || !memberships.insert(pair) {
                return Err("Membership must select an exact configured home once".into());
            }
        }
        let verifier =
            a::hash_password(&user.password.0).map_err(|_| "Invalid supplied account password")?;
        prepared.push(PreparedUser { user, verifier });
    }
    Ok(prepared)
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    format: String,
    configuration_digest: String,
    atlas_schema: u32,
    access_schema: i64,
    access_device: u64,
    access_inode: u64,
    atlas_device: u64,
    atlas_inode: u64,
}

/// Offline only. The operator supplies every account/password/membership.
/// Failure can leave incomplete private files; serve refuses missing state.
pub fn initialize(config: &ServerConfig, provision_path: &Path) -> Result<(), Failure> {
    config.validate()?;
    let users = provisioning(provision_path, config)?;
    let lease = ServerLease::acquire(config, true)?;
    let vault = Arc::new(crate::media::AssetVault::open(
        &config.data_directory.join("media"),
    )?);
    let access_path = config.data_directory.join("access.sqlite");
    let mut access = a::AccessBoundary::open(
        &access_path,
        a::AccessConfig::new(vec![config.origin.clone()])?,
    )?;
    for prepared in users {
        let user = prepared.user;
        access.provision_user(
            &user.user_id,
            &user.actor_id,
            &user.username,
            &prepared.verifier,
            Some(true),
        )?;
        for membership in &user.memberships {
            access.set_membership(
                &user.user_id,
                &a::Scope {
                    workspace_id: membership.workspace_id.clone(),
                    home_id: membership.home_id.clone(),
                },
                membership.role,
                true,
            )?;
        }
        // Secret is zeroized when this explicitly selected account drops.
    }
    let access = Arc::new(Mutex::new(access));
    let atlas_path = config.data_directory.join("atlas.sqlite");
    drop(open_private(&atlas_path, true, false)?);
    let store = Store::open(
        &atlas_path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault,
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )?;
    store.close()?;
    drop(access);
    for path in [&access_path, &atlas_path] {
        sync(&open_private(path, false, false)?)?;
    }
    let access_meta = private_metadata(&access_path)?;
    let atlas_meta = private_metadata(&atlas_path)?;
    let state = State {
        format: "houseatlas-persistent-server/1".into(),
        configuration_digest: config.state_digest()?,
        atlas_schema: storage::DATABASE_VERSION,
        access_schema: a::ACCESS_SCHEMA_VERSION,
        access_device: access_meta.dev(),
        access_inode: access_meta.ino(),
        atlas_device: atlas_meta.dev(),
        atlas_inode: atlas_meta.ino(),
    };
    let mut receipt = open_private(
        &config.data_directory.join("server-state.json"),
        true,
        false,
    )?;
    receipt.write_all(&serde_json::to_vec(&state)?)?;
    sync(&receipt)?;
    sync(&lease.directory)?;
    lease.event(ServerEvent::Initialized)?;
    Ok(())
}

/// Normal reopen uses only existing native files and exact compiled schema.
/// No provisioning, fixtures, source enrollments, jobs or restoration occurs.
pub fn reopen(config: &ServerConfig) -> Result<(Core, ServerLease), Failure> {
    config.validate()?;
    let lease = ServerLease::acquire(config, false)?;
    let state: State = serde_json::from_slice(&read_selected_file(
        &config.data_directory.join("server-state.json"),
        16 * 1024,
        true,
    )?)
    .map_err(|_| "Persistent initialization state unavailable")?;
    let access_path = config.data_directory.join("access.sqlite");
    let atlas_path = config.data_directory.join("atlas.sqlite");
    let access_meta = private_metadata(&access_path)?;
    let atlas_meta = private_metadata(&atlas_path)?;
    if state
        != (State {
            format: "houseatlas-persistent-server/1".into(),
            configuration_digest: config.state_digest()?,
            atlas_schema: storage::DATABASE_VERSION,
            access_schema: a::ACCESS_SCHEMA_VERSION,
            access_device: access_meta.dev(),
            access_inode: access_meta.ino(),
            atlas_device: atlas_meta.dev(),
            atlas_inode: atlas_meta.ino(),
        })
    {
        return Err("Persistent deployment/state binding changed; no automatic adoption".into());
    }
    for database in [&access_path, &atlas_path] {
        for suffix in ["-wal", "-shm", "-journal"] {
            let sibling = PathBuf::from(format!(
                "{}{suffix}",
                database.to_str().ok_or("Invalid database path")?
            ));
            match fs::symlink_metadata(&sibling) {
                Ok(_) => {
                    private_metadata(&sibling)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    for directory in ["media", "media/blobs", "media/staging"] {
        private_directory(&config.data_directory.join(directory))?;
    }
    let vault = Arc::new(crate::media::AssetVault::open(
        &config.data_directory.join("media"),
    )?);
    let access = Arc::new(Mutex::new(a::AccessBoundary::open_existing(
        &access_path,
        a::AccessConfig::new(vec![config.origin.clone()])?,
    )?));
    let store = Store::open_existing(
        &atlas_path,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )?;
    lease.check()?;
    let homes = config.home_summaries();
    let core = Core {
        access,
        store: Arc::new(Mutex::new(store)),
        vault,
        home: homes[0].clone(),
        homes,
        atlas_list_pages: crate::domain::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
    };
    Ok((core, lease))
}

fn private_directory(path: &Path) -> Result<File, Failure> {
    if fs::canonicalize(path)? != path {
        return Err("Private directory must use its canonical path".into());
    }
    let file = File::from(rustix::fs::open(
        path,
        rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::DIRECTORY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )?);
    let meta = file.metadata()?;
    if !meta.is_dir()
        || meta.uid() != rustix::process::geteuid().as_raw()
        || meta.mode() & 0o777 != 0o700
    {
        return Err("Private directory owner/mode unavailable".into());
    }
    Ok(file)
}
fn private_metadata(path: &Path) -> Result<fs::Metadata, Failure> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || meta.nlink() != 1
        || meta.uid() != rustix::process::geteuid().as_raw()
        || meta.mode() & 0o777 != 0o600
    {
        return Err("Private existing file owner/mode unavailable".into());
    }
    Ok(meta)
}
fn open_private(path: &Path, create: bool, append: bool) -> Result<File, Failure> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .append(append)
        .create_new(create)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(path)?;
    let meta = private_metadata(path)?;
    let actual = file.metadata()?;
    if meta.dev() != actual.dev() || meta.ino() != actual.ino() {
        return Err("Private file identity changed".into());
    }
    Ok(file)
}
fn sync(file: &File) -> Result<(), Failure> {
    rustix::fs::fsync(file)?;
    #[cfg(target_os = "macos")]
    rustix::fs::fcntl_fullfsync(file)?;
    Ok(())
}
