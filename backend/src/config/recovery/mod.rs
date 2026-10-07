//! Trusted offline settings for an existing native recovery image.
//!
//! Nothing here is decoded from the recovery manifest or a request. Access
//! persistence and configuration are separate operator-selected inputs. The
//! caller owns and drains the selected directories throughout recovery.
use crate::{
    access::AccessConfig,
    app::access_scope,
    domain::{HomeSummary, Scope, stock::NativeStockContract},
    jobs::QueueConfig,
    media::recovery::{DatabaseMember, MAX_DATABASE, RestoredRecovery},
    storage::{QueueDiscovery, QueueRecoveryEvidence, RecoveryValidationPeers},
};
use rustix::fs::{Mode, OFlags, open};
use std::{
    collections::HashSet,
    fmt,
    fs::{self, File, Metadata},
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Copy)]
pub struct InvalidRecoveryConfig;
impl fmt::Display for InvalidRecoveryConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Trusted existing recovery settings are unavailable")
    }
}
impl std::error::Error for InvalidRecoveryConfig {}
type Result<T> = std::result::Result<T, InvalidRecoveryConfig>;

/// A pinned existing path, never a permission or a substitute image validator.
/// Pins detect ordinary replacement; they do not qualify hostile same-owner
/// interference across the storage owner's subsequent path-based open.
pub(crate) struct ExistingPath {
    path: PathBuf,
    file: File,
    directory: bool,
    device: u64,
    inode: u64,
}
impl ExistingPath {
    fn open(path: &Path, directory: bool) -> Result<Self> {
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
            || fs::canonicalize(path).map_err(|_| InvalidRecoveryConfig)? != path
        {
            return Err(InvalidRecoveryConfig);
        }
        let mut flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
        if directory {
            flags |= OFlags::DIRECTORY;
        }
        let file = File::from(open(path, flags, Mode::empty()).map_err(|_| InvalidRecoveryConfig)?);
        let metadata = file.metadata().map_err(|_| InvalidRecoveryConfig)?;
        let result = Self {
            path: path.into(),
            file,
            directory,
            device: metadata.dev(),
            inode: metadata.ino(),
        };
        result.check()?;
        Ok(result)
    }
    pub(crate) fn check(&self) -> Result<()> {
        let matches = |metadata: &Metadata| {
            !metadata.file_type().is_symlink()
                && (if self.directory {
                    metadata.is_dir()
                } else {
                    metadata.is_file()
                })
                && metadata.mode() & 0o077 == 0
                && metadata.dev() == self.device
                && metadata.ino() == self.inode
        };
        if !matches(&fs::symlink_metadata(&self.path).map_err(|_| InvalidRecoveryConfig)?)
            || !matches(&self.file.metadata().map_err(|_| InvalidRecoveryConfig)?)
            || fs::canonicalize(&self.path).map_err(|_| InvalidRecoveryConfig)? != self.path
        {
            return Err(InvalidRecoveryConfig);
        }
        Ok(())
    }
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn file(&self) -> &File {
        &self.file
    }
    fn same_file(&self, other: &Self) -> bool {
        self.device == other.device && self.inode == other.inode
    }
}

/// Existing, closed Atlas image and retained vault plus separately selected
/// existing, separately provisioned access DB. Construction creates no files,
/// homes, accounts or grants. The strict access opener validates its compiled
/// schema and opaque epoch without initialization or session reset. Access
/// schema compatibility supplies no historical database-instance provenance;
/// selection of separately provisioned trusted state remains caller-owned.
/// Home labels and primary-home selection come only from trusted configuration.
pub struct RecoveryConfig {
    pub(crate) directory: ExistingPath,
    pub(crate) database: ExistingPath,
    pub(crate) vault: ExistingPath,
    pub(crate) blobs: ExistingPath,
    pub(crate) staging: ExistingPath,
    pub(crate) access_database: ExistingPath,
    pub(crate) access: AccessConfig,
    pub(crate) homes: Vec<HomeSummary>,
    pub(crate) home: HomeSummary,
    pub(crate) expected_database: Option<DatabaseMember>,
}
impl RecoveryConfig {
    pub fn existing(
        directory: &Path,
        access_database: &Path,
        access: AccessConfig,
        homes: Vec<HomeSummary>,
        primary: &Scope,
    ) -> Result<Self> {
        let mut scopes = HashSet::new();
        for home in &homes {
            access_scope(&home.scope).map_err(|_| InvalidRecoveryConfig)?;
            if !scopes.insert(home.scope.clone()) {
                return Err(InvalidRecoveryConfig);
            }
        }
        let home = homes
            .iter()
            .find(|home| &home.scope == primary)
            .ok_or(InvalidRecoveryConfig)?
            .clone();
        let directory = ExistingPath::open(directory, true)?;
        let database = ExistingPath::open(&directory.path().join("atlas.sqlite"), false)?;
        let vault = ExistingPath::open(&directory.path().join("media"), true)?;
        let blobs = ExistingPath::open(&vault.path().join("blobs"), true)?;
        let staging = ExistingPath::open(&vault.path().join("staging"), true)?;
        let access_database = ExistingPath::open(access_database, false)?;
        if database.same_file(&access_database) || access_database.path().starts_with(vault.path())
        {
            return Err(InvalidRecoveryConfig);
        }
        Ok(Self {
            directory,
            database,
            vault,
            blobs,
            staging,
            access_database,
            access,
            homes,
            home,
            expected_database: None,
        })
    }
    /// Bind the selected restored paths to the media result's declared image
    /// bytes. The result is integrity evidence, never authenticity or authority.
    pub fn restored(
        restored: &RestoredRecovery,
        access_database: &Path,
        access: AccessConfig,
        homes: Vec<HomeSummary>,
        primary: &Scope,
    ) -> Result<Self> {
        let directory = restored
            .database_path
            .parent()
            .ok_or(InvalidRecoveryConfig)?;
        let mut config = Self::existing(directory, access_database, access, homes, primary)?;
        let member = &restored.manifest.database;
        if config.database.path() != restored.database_path
            || config.vault.path() != restored.vault_root
            || member.file != "atlas.sqlite"
            || member.byte_size > MAX_DATABASE as u64
            || member.sha256.len() != 64
            || !member
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(InvalidRecoveryConfig);
        }
        config.expected_database = Some(member.clone());
        Ok(config)
    }
    pub(crate) fn check(&self) -> Result<()> {
        for path in [
            &self.directory,
            &self.database,
            &self.vault,
            &self.blobs,
            &self.staging,
            &self.access_database,
        ] {
            path.check()?;
        }
        Ok(())
    }
}

/// Independently trusted offline owners, retained across capture/validation and
/// strict opening. Supply EVERY physical queue, including empty registrations;
/// storage checks exact registry/configuration/alias equality against the image.
/// Neither the registry nor its configuration digests are derived from the DB.
/// The native stock port validates the exact embedded resource paths/hashes.
///
/// Discovery/evidence must qualify actual original enqueue derivation and codec
/// facts, fail unavailable proofs, and confer no recovered dispatch authority.
/// Callbacks run under storage's lock/read transaction: no storage reentry or
/// opposing access/vault lock order. Source-close handoff requires peers that do
/// not retain source Core access/vault clones; no source authority is refreshed.
pub struct RecoveryPeers<'a, D, E> {
    stock: NativeStockContract,
    queues: &'a [QueueConfig],
    discovery: &'a D,
    evidence: &'a E,
}
impl<'a, D: QueueDiscovery, E: QueueRecoveryEvidence> RecoveryPeers<'a, D, E> {
    pub fn new(queues: &'a [QueueConfig], discovery: &'a D, evidence: &'a E) -> Result<Self> {
        for queue in queues {
            queue.validate().map_err(|_| InvalidRecoveryConfig)?;
        }
        Ok(Self {
            stock: NativeStockContract::new().map_err(|_| InvalidRecoveryConfig)?,
            queues,
            discovery,
            evidence,
        })
    }
    pub(crate) fn storage(&self) -> RecoveryValidationPeers<'_, NativeStockContract, D, E> {
        RecoveryValidationPeers {
            stock: &self.stock,
            queues: self.queues,
            discovery: self.discovery,
            evidence: self.evidence,
        }
    }
}
