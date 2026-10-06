//! Small platform boundary shared by original and recovery publication.
//! Unsupported barriers fail; no weaker sync or replacing rename fallback.
use std::ffi::OsStr;
use std::fs::File;

use rustix::fs::{self as rfs, RenameFlags};

use super::{MediaError, MediaResult};

/// Sync data/metadata, including directory entries. macOS additionally asks
/// the drive to flush its cache. Native filesystem support remains a target
/// check; a rejected F_FULLFSYNC is propagated rather than ignored.
pub(super) fn sync(file: &File) -> MediaResult<()> {
    rfs::fsync(file)?;
    #[cfg(target_os = "macos")]
    rfs::fcntl_fullfsync(file)?;
    Ok(())
}

/// rustix maps NOREPLACE to Linux RENAME_NOREPLACE and macOS RENAME_EXCL.
/// macOS uses renameatx_np; an unavailable operation fails without overwriting.
pub(super) fn rename_new(parent: &File, staged: &OsStr, destination: &str) -> MediaResult<()> {
    rfs::renameat_with(parent, staged, parent, destination, RenameFlags::NOREPLACE).map_err(|e| {
        if e == rustix::io::Errno::EXIST {
            MediaError::Conflict
        } else {
            e.into()
        }
    })
}
