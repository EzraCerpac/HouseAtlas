//! Private, local filesystem ciphertext storage. Locking coordinates cooperating
//! processes on a local filesystem; it is not a distributed/NAS lock protocol.
//! All names are internally derived hex identifiers, never caller path segments.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustix::fs::{self as rfs, AtFlags, FlockOperation, Mode, OFlags};
use sha2::{Digest, Sha256};

use crate::ai::types::AiError;

const MAX_CIPHERTEXT: usize = 4 * 1024 * 1024 + 128;
const PRIVATE_FILE: Mode = Mode::from_raw_mode(0o600);
const UNAVAILABLE: AiError = AiError::DomainUnavailable;

type Result<T> = std::result::Result<T, AiError>;

pub(crate) struct FileStore {
    path: PathBuf,
    directory: File,
    device: u64,
    inode: u64,
    uid: u32,
}

/// The held file descriptor owns the cross-process advisory lock until Drop.
/// A lease cannot be cloned; callers must retain it across read and replace.
pub(crate) struct FileLease {
    store: Arc<FileStore>,
    name: String,
    lock: File,
    lock_device: u64,
    lock_inode: u64,
}

impl FileStore {
    pub(crate) fn open(path: &Path) -> Result<Arc<Self>> {
        if !path.is_absolute() || fs::canonicalize(path).map_err(|_| UNAVAILABLE)? != path {
            return Err(UNAVAILABLE);
        }
        let uid = rustix::process::geteuid().as_raw();
        let directory = File::from(
            rfs::open(
                path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| UNAVAILABLE)?,
        );
        let meta = directory.metadata().map_err(|_| UNAVAILABLE)?;
        if !meta.is_dir() || meta.mode() & 0o7777 != 0o700 || meta.uid() != uid {
            return Err(UNAVAILABLE);
        }
        let result = Arc::new(Self {
            path: path.to_owned(),
            directory,
            device: meta.dev(),
            inode: meta.ino(),
            uid,
        });
        result.check()?;
        Ok(result)
    }

    fn check(&self) -> Result<()> {
        if rustix::process::geteuid().as_raw() != self.uid {
            return Err(UNAVAILABLE);
        }
        let fd = self.directory.metadata().map_err(|_| UNAVAILABLE)?;
        let path = fs::symlink_metadata(&self.path).map_err(|_| UNAVAILABLE)?;
        if !fd.is_dir()
            || !path.is_dir()
            || path.file_type().is_symlink()
            || fd.mode() & 0o7777 != 0o700
            || path.mode() & 0o7777 != 0o700
            || fd.uid() != self.uid
            || path.uid() != self.uid
            || fd.dev() != self.device
            || fd.ino() != self.inode
            || path.dev() != self.device
            || path.ino() != self.inode
            || fs::canonicalize(&self.path).map_err(|_| UNAVAILABLE)? != self.path
        {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }

    pub(crate) fn acquire(self: &Arc<Self>, name: &str) -> Result<FileLease> {
        if !valid_name(name) {
            return Err(UNAVAILABLE);
        }
        self.check()?;
        let lock_name = format!("{name}.lock");
        let lock = File::from(
            rfs::openat(
                &self.directory,
                lock_name.as_str(),
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                PRIVATE_FILE,
            )
            .map_err(|_| UNAVAILABLE)?,
        );
        let meta = lock.metadata().map_err(|_| UNAVAILABLE)?;
        private_regular(&meta, self.uid)?;
        rfs::flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|_| UNAVAILABLE)?;
        let lease = FileLease {
            store: Arc::clone(self),
            name: name.to_owned(),
            lock,
            lock_device: meta.dev(),
            lock_inode: meta.ino(),
        };
        lease.check()?;
        Ok(lease)
    }
}

impl FileLease {
    pub(crate) fn check(&self) -> Result<()> {
        self.store.check()?;
        let fd = self.lock.metadata().map_err(|_| UNAVAILABLE)?;
        private_regular(&fd, self.store.uid)?;
        let path = rfs::statat(
            &self.store.directory,
            format!("{}.lock", self.name).as_str(),
            AtFlags::SYMLINK_NOFOLLOW,
        )
        .map_err(|_| UNAVAILABLE)?;
        if fd.dev() != self.lock_device
            || fd.ino() != self.lock_inode
            || path.st_dev != self.lock_device
            || path.st_ino != self.lock_inode
            || path.st_uid != self.store.uid
            || path.st_mode & 0o7777 != 0o600
            || path.st_nlink != 1
            || rfs::FileType::from_raw_mode(path.st_mode) != rfs::FileType::RegularFile
        {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }

    pub(crate) fn read(&self) -> Result<Option<Vec<u8>>> {
        self.check()?;
        let name = format!("{}.bin", self.name);
        let mut file = match rfs::openat(
            &self.store.directory,
            name.as_str(),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) => {
                self.check()?;
                return Ok(None);
            }
            Err(_) => return Err(UNAVAILABLE),
        };
        let before = file.metadata().map_err(|_| UNAVAILABLE)?;
        private_regular(&before, self.store.uid)?;
        if before.len() > MAX_CIPHERTEXT as u64 {
            return Err(UNAVAILABLE);
        }
        self.check_member(&name, &before)?;
        let mut bytes = Vec::with_capacity(before.len() as usize);
        let mut limited = Read::by_ref(&mut file).take(MAX_CIPHERTEXT as u64 + 1);
        limited.read_to_end(&mut bytes).map_err(|_| UNAVAILABLE)?;
        if bytes.len() > MAX_CIPHERTEXT || bytes.len() as u64 != before.len() {
            return Err(UNAVAILABLE);
        }
        let after = file.metadata().map_err(|_| UNAVAILABLE)?;
        if after.dev() != before.dev()
            || after.ino() != before.ino()
            || after.len() != before.len()
            || after.mtime() != before.mtime()
            || after.mtime_nsec() != before.mtime_nsec()
            || after.ctime() != before.ctime()
            || after.ctime_nsec() != before.ctime_nsec()
        {
            return Err(UNAVAILABLE);
        }
        self.check_member(&name, &after)?;
        self.check()?;
        Ok(Some(bytes))
    }

    fn check_member(&self, name: &str, meta: &fs::Metadata) -> Result<()> {
        let path = rfs::statat(&self.store.directory, name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| UNAVAILABLE)?;
        if path.st_dev != meta.dev()
            || path.st_ino != meta.ino()
            || path.st_uid != self.store.uid
            || path.st_mode & 0o7777 != 0o600
            || path.st_nlink != 1
            || rfs::FileType::from_raw_mode(path.st_mode) != rfs::FileType::RegularFile
        {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }

    pub(crate) fn replace_atomic(&self, expected: Option<[u8; 32]>, bytes: &[u8]) -> Result<()> {
        if bytes.len() > MAX_CIPHERTEXT {
            return Err(UNAVAILABLE);
        }
        self.check()?;
        // Check the preimage before staging, then again immediately before rename.
        self.check_preimage(expected)?;
        let staged = Staged::new(self)?;
        staged.write(bytes)?;
        self.check()?;
        self.check_preimage(expected)?;
        rfs::renameat(
            &self.store.directory,
            staged.name.as_str(),
            &self.store.directory,
            format!("{}.bin", self.name).as_str(),
        )
        .map_err(|_| UNAVAILABLE)?;
        // Rename is the commit point. A failed barrier is still unavailable;
        // callers must inspect the original lease rather than assume rollback.
        staged.disarm();
        sync(&self.store.directory)?;
        self.check()?;
        Ok(())
    }

    fn check_preimage(&self, expected: Option<[u8; 32]>) -> Result<()> {
        match (expected, self.read()?) {
            (None, None) => Ok(()),
            (Some(digest), Some(current))
                if <[u8; 32]>::from(Sha256::digest(&current)) == digest =>
            {
                Ok(())
            }
            _ => Err(UNAVAILABLE),
        }
    }
}

struct Staged<'a> {
    lease: &'a FileLease,
    name: String,
    file: File,
    armed: std::cell::Cell<bool>,
}

impl<'a> Staged<'a> {
    fn new(lease: &'a FileLease) -> Result<Self> {
        for _ in 0..8 {
            let mut entropy = [0u8; 16];
            getrandom::fill(&mut entropy).map_err(|_| UNAVAILABLE)?;
            let suffix: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
            let name = format!(".{}.{}.tmp", lease.name, suffix);
            match rfs::openat(
                &lease.store.directory,
                name.as_str(),
                OFlags::WRONLY
                    | OFlags::CREATE
                    | OFlags::EXCL
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                PRIVATE_FILE,
            ) {
                Ok(fd) => {
                    let file = File::from(fd);
                    let staged = Self {
                        lease,
                        name,
                        file,
                        armed: std::cell::Cell::new(true),
                    };
                    let meta = staged.file.metadata().map_err(|_| UNAVAILABLE)?;
                    private_regular(&meta, lease.store.uid)?;
                    lease.check_member(&staged.name, &meta)?;
                    return Ok(staged);
                }
                Err(rustix::io::Errno::EXIST) => continue,
                Err(_) => return Err(UNAVAILABLE),
            }
        }
        Err(UNAVAILABLE)
    }

    fn write(&self, bytes: &[u8]) -> Result<()> {
        (&self.file).write_all(bytes).map_err(|_| UNAVAILABLE)?;
        sync(&self.file)?;
        let meta = self.file.metadata().map_err(|_| UNAVAILABLE)?;
        private_regular(&meta, self.lease.store.uid)?;
        if meta.len() != bytes.len() as u64 {
            return Err(UNAVAILABLE);
        }
        self.lease.check_member(&self.name, &meta)
    }

    fn disarm(&self) {
        self.armed.set(false);
    }
}

impl Drop for Staged<'_> {
    fn drop(&mut self) {
        if self.armed.get()
            && self.lease.check().is_ok()
            && let Ok(meta) = self.file.metadata()
            && let Ok(path) = rfs::statat(
                &self.lease.store.directory,
                self.name.as_str(),
                AtFlags::SYMLINK_NOFOLLOW,
            )
            && path.st_dev == meta.dev()
            && path.st_ino == meta.ino()
        {
            let _ = rfs::unlinkat(
                &self.lease.store.directory,
                self.name.as_str(),
                AtFlags::empty(),
            );
        }
    }
}

fn private_regular(meta: &fs::Metadata, uid: u32) -> Result<()> {
    if !meta.is_file() || meta.uid() != uid || meta.mode() & 0o7777 != 0o600 || meta.nlink() != 1 {
        return Err(UNAVAILABLE);
    }
    Ok(())
}

fn valid_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn sync(file: &File) -> Result<()> {
    rfs::fsync(file).map_err(|_| UNAVAILABLE)?;
    #[cfg(target_os = "macos")]
    rfs::fcntl_fullfsync(file).map_err(|_| UNAVAILABLE)?;
    Ok(())
}
