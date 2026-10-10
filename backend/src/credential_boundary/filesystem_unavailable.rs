//! Unsupported platforms do not substitute a less protected filesystem store.
use crate::ai::AiError;
use std::{path::Path, sync::Arc};

pub(crate) struct FileStore;
pub(crate) struct FileLease;

impl FileStore {
    pub(crate) fn open(_: &Path) -> Result<Arc<Self>, AiError> {
        Err(AiError::DomainUnavailable)
    }
    pub(crate) fn acquire(self: &Arc<Self>, _: &str) -> Result<FileLease, AiError> {
        Err(AiError::DomainUnavailable)
    }
}
impl FileLease {
    pub(crate) fn check(&self) -> Result<(), AiError> {
        Err(AiError::DomainUnavailable)
    }
    pub(crate) fn read(&self) -> Result<Option<Vec<u8>>, AiError> {
        Err(AiError::DomainUnavailable)
    }
    pub(crate) fn replace_atomic(&self, _: Option<[u8; 32]>, _: &[u8]) -> Result<(), AiError> {
        Err(AiError::DomainUnavailable)
    }
}
