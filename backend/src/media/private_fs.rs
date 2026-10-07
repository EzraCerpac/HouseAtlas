//! Trusted local configuration only. All member names are derived internally.
//! Bound directory descriptors keep member opens/links relative to their owner;
//! inode checks also detect replaced configured hierarchies between operations.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use rustix::fs::{self as rfs, AtFlags, Dir, Mode, OFlags};

use super::{MediaError, MediaResult, WorkBudget, platform_fs};

impl From<rustix::io::Errno> for MediaError {
    fn from(error: rustix::io::Errno) -> Self {
        std::io::Error::from(error).into()
    }
}

pub(crate) struct PrivateDir {
    pub path: PathBuf,
    pub file: File,
    device: u64,
    inode: u64,
}

impl PrivateDir {
    pub fn open(path: &Path, create: bool) -> MediaResult<Self> {
        let path = std::path::absolute(path)?;
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(MediaError::InvalidInput);
        }
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let parent = if create {
            let parent_path = path.parent().ok_or(MediaError::InvalidInput)?.to_owned();
            let name = path.file_name().ok_or(MediaError::InvalidInput)?;
            let parent_file = File::from(rfs::open(&parent_path, flags, Mode::empty())?);
            // The trusted existing parent can legitimately be 0755. Bind its
            // identity without imposing the child vault's private mode on it.
            check_existing_parent(&parent_path, &parent_file)?;
            match rfs::mkdirat(&parent_file, name, Mode::from_raw_mode(0o700)) {
                Ok(()) | Err(rustix::io::Errno::EXIST) => (),
                Err(e) => return Err(e.into()),
            }
            Some((parent_path, parent_file))
        } else {
            None
        };
        if fs::canonicalize(&path)? != path {
            return Err(MediaError::Unavailable);
        }
        let file = File::from(match &parent {
            Some((_, parent_file)) => rfs::openat(
                parent_file,
                path.file_name().ok_or(MediaError::InvalidInput)?,
                flags,
                Mode::empty(),
            )?,
            None => rfs::open(&path, flags, Mode::empty())?,
        });
        let meta = file.metadata()?;
        if !meta.is_dir() || meta.mode() & 0o077 != 0 {
            return Err(MediaError::Unavailable);
        }
        let result = Self {
            path,
            file,
            device: meta.dev(),
            inode: meta.ino(),
        };
        result.check()?;
        if let Some((parent_path, parent_file)) = parent {
            // Include EXIST: a previous attempt can create the child and fail
            // its barrier. A retry must establish both barriers before success.
            result.sync()?;
            check_existing_parent(&parent_path, &parent_file)?;
            platform_fs::sync(&parent_file)?;
            check_existing_parent(&parent_path, &parent_file)?;
            result.check()?;
        }
        Ok(result)
    }

    pub fn check(&self) -> MediaResult<()> {
        let meta = fs::symlink_metadata(&self.path)?;
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta.mode() & 0o077 != 0
            || meta.dev() != self.device
            || meta.ino() != self.inode
            || fs::canonicalize(&self.path)? != self.path
        {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }

    pub fn child(&self, name: &str, create: bool) -> MediaResult<Self> {
        member(name)?;
        self.check()?;
        if create {
            match rfs::mkdirat(&self.file, name, Mode::from_raw_mode(0o700)) {
                Ok(()) => (),
                Err(rustix::io::Errno::EXIST) => (),
                Err(e) => return Err(e.into()),
            }
        }
        let file = File::from(rfs::openat(
            &self.file,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?);
        let meta = file.metadata()?;
        if !meta.is_dir() || meta.mode() & 0o077 != 0 {
            return Err(MediaError::Unavailable);
        }
        let child = Self {
            path: self.path.join(name),
            file,
            device: meta.dev(),
            inode: meta.ino(),
        };
        self.check()?;
        child.check()?;
        if create {
            child.sync()?;
            self.sync()?;
        }
        Ok(child)
    }

    pub fn members(&self) -> MediaResult<Vec<String>> {
        self.check()?;
        let mut names = Vec::new();
        for entry in Dir::read_from(&self.file)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .to_str()
                .map_err(|_| MediaError::Unavailable)?;
            if name != "." && name != ".." {
                member(name)?;
                names.push(name.to_owned());
            }
            if names.len() > 10_003 {
                return Err(MediaError::TooLarge);
            }
        }
        self.check()?;
        names.sort();
        Ok(names)
    }

    pub fn read(&self, name: &str, max_bytes: usize, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
        member(name)?;
        self.check()?;
        let mut file = File::from(rfs::openat(
            &self.file,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )?);
        let before = file.metadata()?;
        if !before.is_file() || before.mode() & 0o077 != 0 {
            return Err(MediaError::Unavailable);
        }
        if before.len() > max_bytes as u64 {
            return Err(MediaError::TooLarge);
        }
        let mut bytes = Vec::new();
        let mut scratch = [0u8; 65536];
        loop {
            budget.check()?;
            let n = file.read(&mut scratch)?;
            if n == 0 {
                break;
            }
            if n > max_bytes.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&scratch[..n]);
        }
        let after = file.metadata()?;
        if bytes.len() as u64 != before.len()
            || after.len() != before.len()
            || after.mtime() != before.mtime()
            || after.mtime_nsec() != before.mtime_nsec()
            || after.ctime() != before.ctime()
            || after.ctime_nsec() != before.ctime_nsec()
        {
            return Err(MediaError::Unavailable);
        }
        self.check()?;
        budget.check()?;
        Ok(bytes)
    }

    pub fn write_new(&self, name: &str, bytes: &[u8], mode: Mode) -> MediaResult<()> {
        member(name)?;
        self.check()?;
        let mut file = File::from(rfs::openat(
            &self.file,
            name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            mode,
        )?);
        file.write_all(bytes)?;
        platform_fs::sync(&file)?;
        self.sync()?;
        Ok(())
    }

    /// Close the durability obligation for a peer-created database or a
    /// retained file reused after an uncertain earlier installation.
    pub fn sync_member(&self, name: &str) -> MediaResult<()> {
        member(name)?;
        self.check()?;
        let file = File::from(rfs::openat(
            &self.file,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )?);
        let meta = file.metadata()?;
        if !meta.is_file() || meta.mode() & 0o077 != 0 {
            return Err(MediaError::Unavailable);
        }
        platform_fs::sync(&file)?;
        self.check()
    }

    pub fn sync(&self) -> MediaResult<()> {
        self.check()?;
        platform_fs::sync(&self.file)?;
        self.check()
    }

    pub fn temporary(&self, prefix: &str) -> MediaResult<StagedDirectory> {
        self.check()?;
        let temp = tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&self.path)?;
        let path = temp.keep();
        let directory = Self::open(&path, false)?;
        let parent = Self {
            path: self.path.clone(),
            file: self.file.try_clone()?,
            device: self.device,
            inode: self.inode,
        };
        parent.check()?;
        let staged = StagedDirectory {
            parent,
            directory,
            published: false,
        };
        // Construct the owner first so a barrier error retains normal cleanup.
        staged.directory.sync()?;
        staged.parent.sync()?;
        Ok(staged)
    }

    pub fn require_absent(&self, name: &str) -> MediaResult<()> {
        member(name)?;
        self.check()?;
        match rfs::statat(&self.file, name, AtFlags::SYMLINK_NOFOLLOW) {
            Err(rustix::io::Errno::NOENT) => Ok(()),
            Ok(_) => Err(MediaError::Conflict),
            Err(e) => Err(e.into()),
        }
    }
}

pub(crate) struct StagedDirectory {
    parent: PrivateDir,
    pub directory: PrivateDir,
    published: bool,
}

impl StagedDirectory {
    pub fn publish(mut self, name: &str) -> MediaResult<PathBuf> {
        self.parent.require_absent(name)?;
        self.directory.sync()?;
        let staged_name = self
            .directory
            .path
            .file_name()
            .ok_or(MediaError::InvalidInput)?;
        platform_fs::rename_new(&self.parent.file, staged_name, name)?;
        self.published = true;
        self.parent.sync()?;
        Ok(self.parent.path.join(name))
    }
}

impl Drop for StagedDirectory {
    fn drop(&mut self) {
        // Only this operation's private staging, while hierarchy identities match.
        // Interrupted/replaced staging remains for a drained offline owner.
        if !self.published && self.parent.check().is_ok() && self.directory.check().is_ok() {
            let _ = fs::remove_dir_all(&self.directory.path);
        }
    }
}

pub(crate) fn destination_parent(destination: &Path) -> MediaResult<(PrivateDir, String)> {
    let absolute = std::path::absolute(destination)?;
    let name = absolute
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(MediaError::InvalidInput)?
        .to_owned();
    member(&name)?;
    let parent = PrivateDir::open(absolute.parent().ok_or(MediaError::InvalidInput)?, false)?;
    parent.require_absent(&name)?;
    Ok((parent, name))
}

fn member(name: &str) -> MediaResult<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err(MediaError::InvalidInput);
    }
    Ok(())
}

fn check_existing_parent(path: &Path, file: &File) -> MediaResult<()> {
    let expected = file.metadata()?;
    let current = fs::symlink_metadata(path)?;
    if !current.is_dir()
        || current.file_type().is_symlink()
        || current.dev() != expected.dev()
        || current.ino() != expected.ino()
        || fs::canonicalize(path)? != path
    {
        return Err(MediaError::Unavailable);
    }
    Ok(())
}
