//! Explicit offline native-stock capture. No Access open, restore, dispatch,
//! provider enrollment, schema migration or recovered authority is performed.
use super::{
    Failure,
    persistent::{self, ServerLease, State},
};
use crate::{
    access,
    app::{ReadAuthority, ServerRuntime},
    config::{
        recovery::RecoveryPeers,
        server::{ServerConfig, read_selected_file},
    },
    domain::{
        queue_recovery::TrustedQueueRegistry,
        stock::{NativeStockContract, ValidatedRequest},
    },
    http::contracts::NativeContracts,
    jobs::{CanonicalScope, EnqueueRequest, QueueConfig, QueueRegistration},
    media::{
        self, AssetVault, Cancellation, WorkBudget, native::NativeMediaRuntime,
        native_recovery::NativeMediaRecovery, recovery::MAX_DATABASE,
    },
    storage::{self, QueueDiscovery, QueueRecoveryAttempt, QueueRecoveryEvidence},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
    time::Duration,
};

pub const PROFILE: &str = "native-stock-queue-free";

/// Selected only by the explicit offline CLI. Configuration stays outside the
/// recovery bundle and selects the original existing-state lease/receipt.
pub struct Selection {
    config: ServerConfig,
    config_path: PathBuf,
    destination: PathBuf,
}
impl Selection {
    pub fn from_arguments(arguments: &[String]) -> Result<Self, String> {
        let mut options = BTreeMap::new();
        let mut remaining = arguments.iter();
        while let Some(name) = remaining.next() {
            if !matches!(
                name.as_str(),
                "--server-config" | "--destination" | "--profile"
            ) || options
                .insert(
                    name.as_str(),
                    remaining.next().ok_or("Missing backup option value")?,
                )
                .is_some()
            {
                return Err("Unsupported or repeated offline backup option".into());
            }
        }
        if options.get("--profile").map(|v| v.as_str()) != Some(PROFILE) {
            return Err("Required explicit --profile native-stock-queue-free".into());
        }
        let config_path = PathBuf::from(
            options
                .get("--server-config")
                .ok_or("Required --server-config")?
                .as_str(),
        );
        let config = ServerConfig::read(&config_path)?;
        let destination = PathBuf::from(
            options
                .get("--destination")
                .ok_or("Required --destination")?
                .as_str(),
        );
        if !destination.is_absolute()
            || destination
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err("Backup destination must be an explicit absolute path".into());
        }
        Ok(Self {
            config,
            config_path,
            destination,
        })
    }
}

/// Actual full native Stock/schema validation with an explicitly complete empty
/// queue registry. Storage proves that physical queues are exactly this set.
/// Any unexpected queue codec or independent SafeRendered policy is unavailable;
/// the selected profile confers no restore or current dispatch authority.
pub struct QueueFreeNativeOwners {
    registry: TrustedQueueRegistry,
}
impl QueueFreeNativeOwners {
    pub fn for_queue_free_profile() -> storage::Result<Self> {
        Ok(Self {
            registry: TrustedQueueRegistry::new(&[])?,
        })
    }
    pub fn peers(&self) -> Result<RecoveryPeers<'_, Self, Self>, Failure> {
        Ok(RecoveryPeers::new(self.registry.configs(), self, self)?)
    }
}
fn unsupported_owner() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Queue-free capture supplies no queue or independent Media policy owner",
    )
}
impl QueueDiscovery for QueueFreeNativeOwners {
    fn authorize_discovery(&self, _: &QueueRegistration) -> storage::Result<()> {
        Err(unsupported_owner())
    }
    fn validate_retained_enqueue(
        &self,
        _: &ValidatedRequest,
        _: &EnqueueRequest,
        _: &CanonicalScope,
        _: &QueueConfig,
    ) -> storage::Result<()> {
        Err(unsupported_owner())
    }
}
impl QueueRecoveryEvidence for QueueFreeNativeOwners {
    fn validate_attempt(
        &self,
        _: &QueueConfig,
        _: QueueRecoveryAttempt<'_>,
    ) -> storage::Result<()> {
        Err(unsupported_owner())
    }
    fn validate_media_policy(
        &self,
        _: storage::MediaPolicyRecoveryFrame<'_>,
    ) -> storage::Result<()> {
        Err(unsupported_owner())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub format: &'static str,
    pub profile: &'static str,
    pub source_database_sha256: String,
    pub database_sha256: String,
    pub database_bytes: u64,
    pub manifest_sha256: String,
    pub asset_record_count: usize,
    pub exclusions: Vec<String>,
}

/// This private marker authorizes only the requested capture under the acquired
/// original lease and strict receipt binding. It is never an Access grant and
/// cannot be used for restore, reconcile, execute, enrollment or session reads.
struct OfflineBackupAuthority<'a> {
    lease: &'a ServerLease,
    cut: SourceCut,
}
impl OfflineBackupAuthority<'_> {
    fn check(&self, config: &ServerConfig, budget: &WorkBudget) -> Result<(), Failure> {
        budget.check()?;
        self.lease.check()?;
        self.cut.check(config, budget)
    }
}

/// Requires the server to be quiesced and all SQLite sidecars absent. Lease
/// contention fails before a destination is inspected/created. Failures never
/// checkpoint, adopt, migrate, retry or reset source state. An interrupted or
/// post-publication failure can leave owned destination bytes for inspection;
/// failure is not a claim that no backup exists or that retry is safe.
pub fn capture(selection: &Selection) -> Result<BackupReport, Failure> {
    let config = &selection.config;
    config.validate()?;
    let lease = ServerLease::acquire(config, false)?;
    let budget = WorkBudget::new(Duration::from_secs(10), Cancellation::default())?;
    let config_bytes = read_selected_file(&selection.config_path, 64 * 1024, true)?;
    let selected: ServerConfig = serde_json::from_slice(&config_bytes)?;
    if serde_json::to_vec(&selected)? != serde_json::to_vec(config)? {
        return Err("Selected backup configuration changed".into());
    }
    let authority = OfflineBackupAuthority {
        lease: &lease,
        cut: SourceCut::open(config, &budget)?,
    };
    authority.check(config, &budget)?;
    let destination = &selection.destination;
    let parent = destination
        .parent()
        .ok_or("Missing backup destination parent")?;
    let _parent = persistent::private_directory(parent)?;
    for source in [
        &config.data_directory,
        &config.frontend_directory,
        &selection.config_path,
        &config.tls_certificate,
        &config.tls_private_key,
    ] {
        if destination.starts_with(source) || source.starts_with(destination) {
            return Err("Backup destination overlaps selected source state".into());
        }
    }
    require_absent(destination)?;
    let vault = AssetVault::open_existing(&config.data_directory.join("media"))?;
    let owners = QueueFreeNativeOwners::for_queue_free_profile()?;
    let peers = owners.peers()?;
    let database = config.data_directory.join("atlas.sqlite");
    let port = NativeMediaRecovery::<
        NativeContracts,
        ReadAuthority,
        NativeMediaRuntime<ServerRuntime>,
        NativeStockContract,
        QueueFreeNativeOwners,
        QueueFreeNativeOwners,
    >::existing_source(&database, &NativeContracts, peers.storage());
    let manifest = media::recovery::capture_recovery(&port, &vault, destination, &budget)?;
    authority.check(config, &budget)?;
    let current_config = read_selected_file(&selection.config_path, 64 * 1024, true)?;
    if current_config != config_bytes {
        return Err("Selected backup configuration changed".into());
    }
    let manifest_bytes = read_selected_file(
        &destination.join("manifest.json"),
        media::recovery::MAX_MANIFEST as u64,
        true,
    )?;
    budget.check()?;
    Ok(BackupReport {
        format: "houseatlas-offline-backup-report/1",
        profile: PROFILE,
        source_database_sha256: authority.cut.atlas.digest.clone(),
        database_sha256: manifest.database.sha256,
        database_bytes: manifest.database.byte_size,
        manifest_sha256: format!("{:x}", Sha256::digest(&manifest_bytes)),
        asset_record_count: manifest.assets.len(),
        exclusions: manifest.exclusions,
    })
}

struct SourceCut {
    atlas: FileCut,
    receipt: FileCut,
    lock: FileCut,
    access: fs::Metadata,
    state: State,
}
impl SourceCut {
    fn open(config: &ServerConfig, budget: &WorkBudget) -> Result<Self, Failure> {
        super::receipt_compatibility::require_no_pending(config)?;
        require_absent(&config.data_directory.join("server-state.rebind.pending"))?;
        let atlas = FileCut::open(
            &config.data_directory.join("atlas.sqlite"),
            MAX_DATABASE,
            budget,
        )?;
        let receipt = FileCut::open(
            &config.data_directory.join("server-state.json"),
            16 * 1024,
            budget,
        )?;
        let lock = FileCut::open(&config.data_directory.join("server.lock"), 1024, budget)?;
        let access = persistent::private_metadata(&config.data_directory.join("access.sqlite"))?;
        let state: State =
            serde_json::from_slice(&read_selected_file(&receipt.path, 16 * 1024, true)?)?;
        let expected = State {
            format: "houseatlas-persistent-server/1".into(),
            configuration_digest: config.state_digest()?,
            atlas_schema: storage::DATABASE_VERSION,
            access_schema: access::ACCESS_SCHEMA_VERSION,
            access_device: access.dev(),
            access_inode: access.ino(),
            atlas_device: atlas.metadata.dev(),
            atlas_inode: atlas.metadata.ino(),
        };
        if state != expected {
            return Err("Persistent backup state binding changed; no adoption".into());
        }
        let cut = Self {
            atlas,
            receipt,
            lock,
            access,
            state,
        };
        cut.check(config, budget)?;
        Ok(cut)
    }
    fn check(&self, config: &ServerConfig, budget: &WorkBudget) -> Result<(), Failure> {
        super::receipt_compatibility::require_no_pending(config)?;
        require_absent(&config.data_directory.join("server-state.rebind.pending"))?;
        for file in [&self.atlas, &self.receipt, &self.lock] {
            file.check(budget)?;
        }
        let access = persistent::private_metadata(&config.data_directory.join("access.sqlite"))?;
        if !same_file(&access, &self.access)
            || self.state.configuration_digest != config.state_digest()?
        {
            return Err("Persistent backup source changed".into());
        }
        for name in ["atlas.sqlite", "access.sqlite"] {
            for suffix in ["-wal", "-shm", "-journal"] {
                require_absent(&config.data_directory.join(format!("{name}{suffix}")))?;
            }
        }
        Ok(())
    }
}
fn require_absent(path: &Path) -> Result<(), Failure> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(
            "Offline backup requires absent destination, pending state and SQLite sidecars".into(),
        ),
        Err(e) => Err(e.into()),
    }
}
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.dev() == b.dev()
        && a.ino() == b.ino()
        && a.len() == b.len()
        && a.mtime() == b.mtime()
        && a.mtime_nsec() == b.mtime_nsec()
        && a.ctime() == b.ctime()
        && a.ctime_nsec() == b.ctime_nsec()
}
struct FileCut {
    path: PathBuf,
    file: File,
    metadata: fs::Metadata,
    digest: String,
}
impl FileCut {
    fn open(path: &Path, maximum: usize, budget: &WorkBudget) -> Result<Self, Failure> {
        if fs::canonicalize(path)? != path {
            return Err("Backup source must use canonical paths".into());
        }
        let metadata = persistent::private_metadata(path)?;
        if metadata.len() > maximum as u64 {
            return Err("Backup source exceeds the bounded profile".into());
        }
        let file = File::from(rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::NONBLOCK
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )?);
        let mut cut = Self {
            path: path.into(),
            file,
            metadata,
            digest: String::new(),
        };
        cut.digest = cut.hash(budget)?;
        cut.check(budget)?;
        Ok(cut)
    }
    fn hash(&self, budget: &WorkBudget) -> Result<String, Failure> {
        let mut file = &self.file;
        file.seek(SeekFrom::Start(0))?;
        let mut hash = Sha256::new();
        let mut bytes = [0u8; 64 * 1024];
        let mut length = 0u64;
        loop {
            budget.check()?;
            let n = file.read(&mut bytes)?;
            if n == 0 {
                break;
            }
            length += n as u64;
            if length > self.metadata.len() {
                return Err("Backup source bytes changed".into());
            }
            hash.update(&bytes[..n]);
        }
        if length != self.metadata.len() {
            return Err("Backup source bytes changed".into());
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    fn check(&self, budget: &WorkBudget) -> Result<(), Failure> {
        if !same_file(&persistent::private_metadata(&self.path)?, &self.metadata)
            || !same_file(&self.file.metadata()?, &self.metadata)
            || self.hash(budget)? != self.digest
        {
            return Err("Backup source identity or bytes changed".into());
        }
        Ok(())
    }
}
