//! Append-only durable data archive, independent of the recoverable SQL image.
//! No loader here can reconstruct a principal, producer or invocation authority.
use crate::config::provider_dispatch::archive::TrustedStockArchiveConfig;
use rustix::fs::{AtFlags, Mode, OFlags};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    sync::Arc,
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
        let name = format!("{operation}.{version}.producer.json");
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
                &name,
                AtFlags::empty(),
            ) {
                Ok(()) => {}
                Err(rustix::io::Errno::EXIST) => self.matches(&name, bytes)?,
                Err(_) => return Err(ArchiveError::Unavailable),
            }
            rustix::fs::unlinkat(&self.directory, &pending, AtFlags::empty())
                .map_err(|_| ArchiveError::Unavailable)?;
            self.directory
                .sync_all()
                .map_err(|_| ArchiveError::Unavailable)?;
            Ok(ArchiveReceipt {
                name,
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
