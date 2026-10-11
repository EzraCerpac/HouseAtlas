//! Append-only durable data archive, independent of the recoverable SQL image.
//! No loader here can reconstruct a principal, producer or invocation authority.
use crate::config::provider_dispatch::archive::TrustedStockArchiveConfig;
use rustix::fs::{AtFlags, Mode, OFlags};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArchiveError {
    Configuration,
    Unavailable,
    TooLarge,
    Conflict,
}
impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Configuration => "Private stock archive configuration is invalid",
            Self::Unavailable => "Private stock archive is unavailable",
            Self::TooLarge => "Stock archive frame exceeds the configured limit",
            Self::Conflict => "An immutable stock archive frame differs",
        })
    }
}
impl std::error::Error for ArchiveError {}

/// Identity of the actual opened directory, supplied to original archive policy.
/// This describes a destination; it conveys no grant or invocation authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveDestination {
    directory: std::path::PathBuf,
    device: u64,
    inode: u64,
    owner: u32,
}
impl ArchiveDestination {
    pub fn directory(&self) -> &std::path::Path {
        &self.directory
    }
    pub fn device(&self) -> u64 {
        self.device
    }
    pub fn inode(&self) -> u64 {
        self.inode
    }
    pub fn owner(&self) -> u32 {
        self.owner
    }
}

/// Genuine completion of file and directory sync. This is DATA, not a grant.
#[derive(Clone, Debug)]
pub struct ArchiveReceipt {
    name: String,
    sha256: String,
}
impl ArchiveReceipt {
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

pub struct PrivateStockArchive {
    directory: File,
    destination: ArchiveDestination,
    max_frame_bytes: usize,
    custody: Mutex<()>,
}
impl PrivateStockArchive {
    /// Open the already-provisioned trusted directory without creating a path.
    /// Relative operations stay anchored to this directory descriptor.
    pub fn open(config: TrustedStockArchiveConfig) -> Result<Arc<Self>, ArchiveError> {
        let path = config.directory();
        if path
            .canonicalize()
            .map_err(|_| ArchiveError::Configuration)?
            != path
        {
            return Err(ArchiveError::Configuration);
        }
        let directory = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags((OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC).bits() as i32)
            .open(path)
            .map_err(|_| ArchiveError::Configuration)?;
        let metadata = directory
            .metadata()
            .map_err(|_| ArchiveError::Configuration)?;
        if !metadata.is_dir()
            || metadata.mode() & 0o777 != 0o700
            || metadata.uid() != rustix::process::geteuid().as_raw()
        {
            return Err(ArchiveError::Configuration);
        }
        Ok(Arc::new(Self {
            directory,
            destination: ArchiveDestination {
                directory: path.to_path_buf(),
                device: metadata.dev(),
                inode: metadata.ino(),
                owner: metadata.uid(),
            },
            max_frame_bytes: config.max_frame_bytes(),
            custody: Mutex::new(()),
        }))
    }
    pub fn destination(&self) -> &ArchiveDestination {
        &self.destination
    }
    pub fn max_frame_bytes(&self) -> usize {
        self.max_frame_bytes
    }

    pub(super) fn retain(
        &self,
        operation: Uuid,
        version: u64,
        bytes: &[u8],
    ) -> Result<ArchiveReceipt, ArchiveError> {
        if bytes.len() > self.max_frame_bytes {
            return Err(ArchiveError::TooLarge);
        }
        // Every typed native writer shares the actual descriptor custody. In
        // particular an independently opened HomeBox writer cannot race a
        // Media catalog read if configuration accidentally selects one path.
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| ArchiveError::Unavailable)?;
        let _lock = self.custody_lock()?;
        let name = format!("{operation}.{version}.producer.json");
        self.retain_named(&name, bytes)
    }
    fn retain_named(&self, name: &str, bytes: &[u8]) -> Result<ArchiveReceipt, ArchiveError> {
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| ArchiveError::Unavailable)?;
        let pending = format!("pending-{}", Uuid::from_bytes(nonce));
        let fd = rustix::fs::openat(
            &self.directory,
            &pending,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ArchiveError::Unavailable)?;
        let mut file = File::from(fd);
        let result = (|| {
            // Set the exact owner-only mode on this newly created descriptor;
            // an inherited umask must not remove the owner's archive read bit.
            rustix::fs::fchmod(&file, Mode::RUSR | Mode::WUSR)
                .map_err(|_| ArchiveError::Unavailable)?;
            file.write_all(bytes)
                .map_err(|_| ArchiveError::Unavailable)?;
            file.sync_all().map_err(|_| ArchiveError::Unavailable)?;
            match rustix::fs::linkat(
                &self.directory,
                &pending,
                &self.directory,
                name,
                AtFlags::empty(),
            ) {
                Ok(()) => {}
                Err(rustix::io::Errno::EXIST) => self.matches(name, bytes)?,
                Err(_) => return Err(ArchiveError::Unavailable),
            }
            rustix::fs::unlinkat(&self.directory, &pending, AtFlags::empty())
                .map_err(|_| ArchiveError::Unavailable)?;
            self.directory
                .sync_all()
                .map_err(|_| ArchiveError::Unavailable)?;
            Ok(ArchiveReceipt {
                name: name.to_owned(),
                sha256: format!("{:x}", Sha256::digest(bytes)),
            })
        })();
        // Best-effort removal of this call's private temporary only. No archive
        // scan, replacement, pruning, state cleanup or SQL hold release.
        if result.is_err() {
            let _ = rustix::fs::unlinkat(&self.directory, &pending, AtFlags::empty());
        }
        result
    }
    fn matches(&self, name: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        let fd = rustix::fs::openat(
            &self.directory,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ArchiveError::Conflict)?;
        let mut file = File::from(fd);
        let metadata = file.metadata().map_err(|_| ArchiveError::Conflict)?;
        if !metadata.is_file()
            || metadata.mode() & 0o777 != 0o600
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.len() != bytes.len() as u64
        {
            return Err(ArchiveError::Conflict);
        }
        let mut existing = Vec::new();
        (&mut file)
            .take((self.max_frame_bytes as u64).saturating_add(1))
            .read_to_end(&mut existing)
            .map_err(|_| ArchiveError::Conflict)?;
        if existing != bytes {
            return Err(ArchiveError::Conflict);
        }
        file.sync_all().map_err(|_| ArchiveError::Unavailable)
    }
}

const MEDIA_MEMBER_LIMIT: usize = 10_000;
const MEDIA_BYTE_LIMIT: usize = 16 * 1024 * 1024;
const MEDIA_MEMBER_BYTES: usize = 1024 * 1024;
#[derive(PartialEq)]
pub(super) struct MediaArchiveMember {
    pub(super) name: String,
    pub(super) bytes: Vec<u8>,
    identity: MemberIdentity,
}
#[derive(PartialEq)]
struct MemberIdentity {
    device: u64,
    inode: u64,
    size: u64,
    modified: i64,
    modified_ns: i64,
    changed: i64,
    changed_ns: i64,
}
impl MemberIdentity {
    fn checked(metadata: &std::fs::Metadata, maximum: usize) -> Result<Self, ArchiveError> {
        if !metadata.is_file()
            || metadata.mode() & 0o7777 != 0o600
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.len() > maximum as u64
        {
            return Err(ArchiveError::Unavailable);
        }
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            size: metadata.len(),
            modified: metadata.mtime(),
            modified_ns: metadata.mtime_nsec(),
            changed: metadata.ctime(),
            changed_ns: metadata.ctime_nsec(),
        })
    }
}
#[derive(PartialEq)]
struct DirectoryIdentity {
    device: u64,
    inode: u64,
    size: u64,
    modified: i64,
    modified_ns: i64,
    changed: i64,
    changed_ns: i64,
}
struct DirectoryLock<'a>(&'a File);
impl Drop for DirectoryLock<'_> {
    fn drop(&mut self) {
        let _ = rustix::fs::flock(self.0, rustix::fs::FlockOperation::Unlock);
    }
}
fn media_name(name: &str) -> bool {
    name.strip_suffix(".media-policy.json")
        .and_then(|id| Uuid::parse_str(id).ok().map(|uuid| uuid.to_string() == id))
        .unwrap_or(false)
}
impl PrivateStockArchive {
    fn destination_current(&self) -> Result<(), ArchiveError> {
        let descriptor = self
            .directory
            .metadata()
            .map_err(|_| ArchiveError::Unavailable)?;
        let named = std::fs::symlink_metadata(self.destination.directory())
            .map_err(|_| ArchiveError::Unavailable)?;
        for metadata in [descriptor, named] {
            if !metadata.is_dir()
                || metadata.mode() & 0o7777 != 0o700
                || metadata.uid() != self.destination.owner
                || metadata.uid() != rustix::process::geteuid().as_raw()
                || metadata.dev() != self.destination.device
                || metadata.ino() != self.destination.inode
            {
                return Err(ArchiveError::Unavailable);
            }
        }
        Ok(())
    }
    fn media_directory_identity(&self) -> Result<DirectoryIdentity, ArchiveError> {
        let metadata = self
            .directory
            .metadata()
            .map_err(|_| ArchiveError::Unavailable)?;
        Ok(DirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
            size: metadata.len(),
            modified: metadata.mtime(),
            modified_ns: metadata.mtime_nsec(),
            changed: metadata.ctime(),
            changed_ns: metadata.ctime_nsec(),
        })
    }
    fn custody_lock(&self) -> Result<DirectoryLock<'_>, ArchiveError> {
        self.destination_current()?;
        rustix::fs::flock(
            &self.directory,
            rustix::fs::FlockOperation::NonBlockingLockExclusive,
        )
        .map_err(|_| ArchiveError::Unavailable)?;
        Ok(DirectoryLock(&self.directory))
    }
    fn media_scan(
        &self,
        budget: &crate::media::WorkBudget,
    ) -> Result<Vec<MediaArchiveMember>, ArchiveError> {
        self.destination_current()?;
        let directory_identity = self.media_directory_identity()?;
        let maximum = self.max_frame_bytes.min(MEDIA_MEMBER_BYTES);
        let mut directory =
            rustix::fs::Dir::read_from(&self.directory).map_err(|_| ArchiveError::Unavailable)?;
        let mut members = Vec::new();
        let mut total = 0usize;
        while let Some(entry) = directory.read() {
            budget.check().map_err(|_| ArchiveError::Unavailable)?;
            let entry = entry.map_err(|_| ArchiveError::Unavailable)?;
            let name = entry
                .file_name()
                .to_str()
                .map_err(|_| ArchiveError::Unavailable)?;
            if name == "." || name == ".." {
                continue;
            }
            if !media_name(name) || members.len() >= MEDIA_MEMBER_LIMIT {
                return Err(ArchiveError::Unavailable);
            }
            let fd = rustix::fs::openat(
                &self.directory,
                name,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ArchiveError::Unavailable)?;
            let mut file = File::from(fd);
            let identity = MemberIdentity::checked(
                &file.metadata().map_err(|_| ArchiveError::Unavailable)?,
                maximum,
            )?;
            total = total
                .checked_add(identity.size as usize)
                .ok_or(ArchiveError::TooLarge)?;
            if total > MEDIA_BYTE_LIMIT {
                return Err(ArchiveError::TooLarge);
            }
            let mut bytes = Vec::with_capacity(identity.size as usize);
            (&mut file)
                .take(maximum as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ArchiveError::Unavailable)?;
            if bytes.len() as u64 != identity.size
                || MemberIdentity::checked(
                    &file.metadata().map_err(|_| ArchiveError::Unavailable)?,
                    maximum,
                )? != identity
            {
                return Err(ArchiveError::Unavailable);
            }
            members.push(MediaArchiveMember {
                name: name.to_owned(),
                bytes,
                identity,
            });
        }
        members.sort_by(|a, b| a.name.cmp(&b.name));
        if members.windows(2).any(|pair| pair[0].name == pair[1].name) {
            return Err(ArchiveError::Unavailable);
        }
        budget.check().map_err(|_| ArchiveError::Unavailable)?;
        self.destination_current()?;
        if directory_identity != self.media_directory_identity()? {
            return Err(ArchiveError::Unavailable);
        }
        Ok(members)
    }
    pub(super) fn retain_media<
        A: crate::media::recovery_policy_archive::MediaPolicyArchiveWriteAuthorization,
    >(
        &self,
        packet: &crate::media::recovery_policy_archive::MediaPolicyArchivePacket,
        owner: &A,
        budget: &crate::media::WorkBudget,
    ) -> crate::media::MediaResult<ArchiveReceipt> {
        use crate::media::MediaError;
        budget.check()?;
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let _lock = self.custody_lock().map_err(|_| MediaError::Unavailable)?;
        owner.authorize_archive(self.destination(), packet)?;
        let name = packet.member_name();
        let bytes = packet.bytes();
        if !media_name(name) || bytes.len() > self.max_frame_bytes.min(MEDIA_MEMBER_BYTES) {
            return Err(MediaError::TooLarge);
        }
        let before = self
            .media_scan(budget)
            .map_err(|_| MediaError::Unavailable)?;
        let existing = before.iter().find(|member| member.name == name);
        if existing.is_none() && before.len() >= MEDIA_MEMBER_LIMIT {
            return Err(MediaError::TooLarge);
        }
        let total: usize = before.iter().map(|member| member.bytes.len()).sum();
        if existing.is_none()
            && total
                .checked_add(bytes.len())
                .is_none_or(|total| total > MEDIA_BYTE_LIMIT)
        {
            return Err(MediaError::TooLarge);
        }
        budget.check()?;
        let receipt = self
            .retain_named(name, bytes)
            .map_err(|_| MediaError::Unavailable)?;
        let after = self
            .media_scan(budget)
            .map_err(|_| MediaError::Unavailable)?;
        if before.iter().any(|old| !after.iter().any(|new| old == new))
            || after.len() != before.len() + usize::from(existing.is_none())
            || !after
                .iter()
                .any(|member| member.name == name && member.bytes == bytes)
        {
            return Err(MediaError::Unavailable);
        }
        Ok(receipt)
    }
    pub(super) fn with_media_catalog<T>(
        &self,
        budget: &crate::media::WorkBudget,
        qualify: impl FnOnce(&[MediaArchiveMember]) -> crate::storage::Result<T>,
    ) -> crate::storage::Result<T> {
        let unavailable =
            || crate::storage::Error::new("unavailable", "Private Media archive unavailable");
        budget.check().map_err(|_| unavailable())?;
        let _local = self.custody.try_lock().map_err(|_| unavailable())?;
        let _lock = self.custody_lock().map_err(|_| unavailable())?;
        let directory_identity = self.media_directory_identity().map_err(|_| unavailable())?;
        let before = self.media_scan(budget).map_err(|_| unavailable())?;
        let result = qualify(&before)?;
        let after = self.media_scan(budget).map_err(|_| unavailable())?;
        if before != after
            || directory_identity != self.media_directory_identity().map_err(|_| unavailable())?
        {
            return Err(unavailable());
        }
        Ok(result)
    }
}

impl PrivateStockArchive {
    /// Publish only the catalog sealed by the explicit configured signing
    /// capability for this exact archive descriptor and original path pin.
    /// Files linked before an error remain immutable DATA; errors do not claim
    /// rollback, approval or a released historical recovery owner.
    pub fn publish_queued_upload_history(
        &self,
        signed: &crate::config::recovery::upload_history_origin::SignedQueuedUploadHistoryCatalog,
        budget: &crate::media::WorkBudget,
    ) -> Result<
        super::queued_upload_history_archive::PublishedQueuedUploadHistoryCatalog,
        ArchiveError,
    > {
        use super::queued_upload_history_archive as upload;
        upload::check(budget)?;
        if !signed.matches_destination(self.destination()) {
            return Err(ArchiveError::Configuration);
        }
        let catalog = signed.catalog();
        if catalog.members().len() > upload::MEMBER_LIMIT
            || catalog.catalog_bytes().len() > upload::CATALOG_LIMIT
            || signed.envelope_bytes().len() > upload::ENVELOPE_LIMIT
        {
            return Err(ArchiveError::TooLarge);
        }
        let mut total = 0usize;
        for (index, member) in catalog.members().iter().enumerate() {
            upload::check(budget)?;
            if member.name() != upload::frame_name(member.sha256())
                || catalog.members()[..index]
                    .iter()
                    .any(|old| old.name() == member.name())
                || member.byte_size() != member.frame_bytes().len() as u64
                || member.frame_bytes().len() > self.max_frame_bytes.min(upload::FRAME_LIMIT)
                || upload::digest(member.frame_bytes(), budget)? != member.sha256()
            {
                return Err(ArchiveError::Conflict);
            }
            crate::app::homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame::parse(member.frame_bytes(),budget)
                .map_err(|_| ArchiveError::Conflict)?;
            total = total
                .checked_add(member.frame_bytes().len())
                .ok_or(ArchiveError::TooLarge)?;
            if total > upload::TOTAL_LIMIT {
                return Err(ArchiveError::TooLarge);
            }
        }
        let hash = upload::digest(signed.envelope_bytes(), budget)?;
        let name = upload::catalog_name(catalog.generation(), hash);
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| ArchiveError::Unavailable)?;
        let _lock = self.custody_lock()?;
        upload::destination_current(&self.directory, self.destination())?;
        if !signed.matches_destination(self.destination()) {
            return Err(ArchiveError::Configuration);
        }
        // Immutable member data reaches durable storage before the catalog
        // becomes visible as the final publication commit marker.
        for member in catalog.members() {
            upload::retain_member(
                &self.directory,
                member.name(),
                member.frame_bytes(),
                self.max_frame_bytes.min(upload::FRAME_LIMIT),
                budget,
            )?;
        }
        upload::destination_current(&self.directory, self.destination())?;
        upload::retain_member(
            &self.directory,
            &name,
            signed.envelope_bytes(),
            upload::ENVELOPE_LIMIT,
            budget,
        )?;
        upload::check(budget)?;
        upload::destination_current(&self.directory, self.destination())?;
        Ok(upload::PublishedQueuedUploadHistoryCatalog::completed(
            name,
            hash,
            catalog.generation(),
        ))
    }
}
impl PrivateStockArchive {
    /// Read only the explicitly selected catalog and its complete declared
    /// ordered members. This constructs unadmitted DATA, never recovery grants.
    pub fn read_queued_upload_history(
        &self,
        expected: &super::queued_upload_history_archive::TrustedUploadHistoryArchiveReference<'_>,
        budget: &crate::media::WorkBudget,
    ) -> Result<
        super::queued_upload_history_archive::UnadmittedQueuedUploadHistoryArchive,
        ArchiveError,
    > {
        use super::queued_upload_history_archive as upload;
        upload::check(budget)?;
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| ArchiveError::Unavailable)?;
        let _lock = self.custody_lock()?;
        upload::read_archive(
            &self.directory,
            self.destination(),
            expected,
            self.max_frame_bytes,
            budget,
        )
    }
}
