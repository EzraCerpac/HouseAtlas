//! Original descriptor ownership shared by every Network constructor. These
//! leases confer no Store/Access grant or reference-coverage completeness.
use super::{ErrorCode, NetworkError};
use crate::media::PrivateDir;
use rustix::fs::{self as rfs, AtFlags, FlockOperation, Mode, OFlags, RenameFlags};
use std::{
    fs::File,
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, NetworkError>;
fn unavailable() -> NetworkError {
    NetworkError::new(ErrorCode::Upstream)
}
fn member(name: &str) -> Result<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\0']) {
        return Err(unavailable());
    }
    Ok(())
}

/// Own the actual private database inode, not a separately replaceable lockfile.
/// Independent open descriptions compete for this same nonblocking OS lock,
/// including other processes using these constructors. No Clone/public issuer.
pub(super) struct DatabaseOwner {
    directory: PrivateDir,
    file: File,
    name: String,
    device: u64,
    inode: u64,
}
impl DatabaseOwner {
    pub(super) fn open(path: &Path) -> Result<Self> {
        if !path.is_absolute() {
            return Err(unavailable());
        }
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(unavailable)?
            .to_owned();
        member(&name)?;
        let directory = PrivateDir::open(path.parent().ok_or_else(unavailable)?, false)
            .map_err(|_| unavailable())?;
        let file = File::from(
            rfs::openat(
                &directory.file,
                &name,
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::from_raw_mode(0o600),
            )
            .map_err(|_| unavailable())?,
        );
        let metadata = file.metadata().map_err(|_| unavailable())?;
        if !metadata.is_file() || metadata.mode() & 0o077 != 0 || metadata.nlink() != 1 {
            return Err(unavailable());
        }
        rfs::flock(&file, FlockOperation::NonBlockingLockExclusive).map_err(|_| unavailable())?;
        let owner = Self {
            directory,
            file,
            name,
            device: metadata.dev(),
            inode: metadata.ino(),
        };
        owner.check()?;
        // Close the descriptor-relative member creation barrier. Existing file
        // permissions are checked, never repaired by changing process settings.
        owner.directory.sync().map_err(|_| unavailable())?;
        Ok(owner)
    }
    pub(super) fn path(&self) -> PathBuf {
        self.directory.path.join(&self.name)
    }
    pub(super) fn check(&self) -> Result<()> {
        self.directory.check().map_err(|_| unavailable())?;
        let opened = self.file.metadata().map_err(|_| unavailable())?;
        let named = rfs::statat(&self.directory.file, &self.name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| unavailable())?;
        if !opened.is_file()
            || opened.mode() & 0o077 != 0
            || opened.nlink() != 1
            || opened.dev() != self.device
            || opened.ino() != self.inode
            || rfs::FileType::from_raw_mode(named.st_mode) != rfs::FileType::RegularFile
            || named.st_mode & 0o077 != 0
            || named.st_nlink != 1
            || named.st_dev as u64 != self.device
            || named.st_ino as u64 != self.inode
        {
            return Err(unavailable());
        }
        Ok(())
    }
    pub(super) fn segments(&self) -> Result<SegmentOwner> {
        self.check()?;
        let name = self
            .path()
            .with_extension("segments")
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(unavailable)?
            .to_owned();
        let directory = self
            .directory
            .child(&name, true)
            .map_err(|_| unavailable())?;
        rfs::flock(&directory.file, FlockOperation::NonBlockingLockExclusive)
            .map_err(|_| unavailable())?;
        directory.sync().map_err(|_| unavailable())?;
        self.directory.sync().map_err(|_| unavailable())?;
        Ok(SegmentOwner { directory })
    }
}

/// Lock and use the actual segment directory descriptor. Segment operations
/// stay relative to it and verify the bound hierarchy on both sides of IO.
pub(super) struct SegmentOwner {
    directory: PrivateDir,
}
impl SegmentOwner {
    pub(super) fn check(&self) -> Result<()> {
        self.directory.check().map_err(|_| unavailable())
    }
    pub(super) fn read(&self, name: &str, ceiling: usize) -> Result<Vec<u8>> {
        member(name)?;
        self.check()?;
        let file = File::from(
            rfs::openat(
                &self.directory.file,
                name,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| unavailable())?,
        );
        let opened = file.metadata().map_err(|_| unavailable())?;
        if !opened.is_file() || opened.nlink() != 1 || opened.len() > ceiling as u64 {
            return Err(unavailable());
        }
        let mut bytes = Vec::with_capacity(opened.len() as usize);
        (&file)
            .take(ceiling as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable())?;
        let after = file.metadata().map_err(|_| unavailable())?;
        let named = rfs::statat(&self.directory.file, name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| unavailable())?;
        if bytes.len() as u64 != opened.len()
            || bytes.len() > ceiling
            || after.len() != opened.len()
            || after.mtime() != opened.mtime()
            || after.mtime_nsec() != opened.mtime_nsec()
            || after.ctime() != opened.ctime()
            || after.ctime_nsec() != opened.ctime_nsec()
            || after.nlink() != 1
            || rfs::FileType::from_raw_mode(named.st_mode) != rfs::FileType::RegularFile
            || named.st_dev as u64 != opened.dev()
            || named.st_ino as u64 != opened.ino()
        {
            return Err(unavailable());
        }
        self.check()?;
        Ok(bytes)
    }
    pub(super) fn write_new(&self, name: &str, bytes: &[u8]) -> Result<()> {
        member(name)?;
        self.directory
            .write_new(name, bytes, Mode::from_raw_mode(0o600))
            .map_err(|_| unavailable())
    }
    pub(super) fn seal(&self, active: &str, sealed: &str) -> Result<()> {
        member(active)?;
        member(sealed)?;
        self.check()?;
        rfs::renameat_with(
            &self.directory.file,
            active,
            &self.directory.file,
            sealed,
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| unavailable())?;
        self.directory.sync().map_err(|_| unavailable())
    }
    pub(super) fn members(&self) -> Result<Vec<String>> {
        self.directory.members().map_err(|_| unavailable())
    }
}
