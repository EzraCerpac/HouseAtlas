//! Explicit private archive settings; not request data or recovery authority.
use std::path::{Path, PathBuf};

pub struct TrustedStockArchiveConfig {
    directory: PathBuf,
    max_frame_bytes: usize,
}
impl TrustedStockArchiveConfig {
    /// The original retention policy must qualify this exact server destination.
    /// It must be an existing private directory outside the recoverable database.
    pub fn new(directory: PathBuf, max_frame_bytes: usize) -> Result<Self, &'static str> {
        if !directory.is_absolute() || max_frame_bytes == 0 {
            return Err("Absolute private archive directory and explicit byte limit required");
        }
        Ok(Self {
            directory,
            max_frame_bytes,
        })
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn max_frame_bytes(&self) -> usize {
        self.max_frame_bytes
    }
}
