//! Read-only semantic validation of the captured selected database image.
//! The retained results are integrity/semantic DATA, never reopen, restore,
//! disclosure, dispatch or mutation authority. The configuration owner must
//! keep the selected files closed to writers throughout this operation.

use sha2::{Digest, Sha256};
use std::os::unix::fs::FileExt;

use super::upload_history_intake::SelectedQueuedUploadHistoryImage;
use crate::{
    app::{ReadAuthority, ServerRuntime},
    config::recovery::RecoveryPeers,
    domain::stock::NativeStockContract,
    http::contracts::NativeContracts,
    media::{
        WorkBudget,
        native::NativeMediaRuntime,
        native_recovery::NativeMediaRecovery,
        recovery::{MAX_DATABASE, RecoveryDatabasePort, ValidatedDatabase},
    },
    storage,
};

const CHUNK: usize = 64 * 1024;

fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Selected queued upload image validation unavailable",
    )
}

fn checkpoint(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}

/// Actual native and projected validator returns, bound to the captured image
/// bytes. Private construction and shared getters expose no configuration,
/// authority, consuming conversion or strict-open token.
pub struct ValidatedQueuedUploadHistoryImage {
    native_image: storage::RecoveryImage,
    validated_database: ValidatedDatabase,
    sha256: [u8; 32],
    byte_size: u64,
}

impl ValidatedQueuedUploadHistoryImage {
    pub fn native_image(&self) -> &storage::RecoveryImage {
        &self.native_image
    }

    pub fn validated_database(&self) -> &ValidatedDatabase {
        &self.validated_database
    }

    pub fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }

    pub fn byte_size(&self) -> &u64 {
        &self.byte_size
    }
}

// Hash the SAME captured descriptor positionally; never move its shared cursor
// or substitute a reopened file. Metadata revalidation also checks its pinned
// path identity and the complete configuration before and after every hash.
fn check_image(
    image: &SelectedQueuedUploadHistoryImage<'_>,
    budget: &WorkBudget,
) -> storage::Result<()> {
    image.revalidate(budget)?;
    let byte_size = image.byte_size();
    if byte_size == 0 || byte_size > MAX_DATABASE as u64 {
        return Err(unavailable());
    }
    // The database bound precedes buffer allocation and all semantic decoding.
    let mut buffer = [0u8; CHUNK];
    let mut digest = Sha256::new();
    let file = image.configuration().database.file();
    let mut offset = 0u64;
    while offset < byte_size {
        checkpoint(budget)?;
        let remaining =
            usize::try_from((byte_size - offset).min(CHUNK as u64)).map_err(|_| unavailable())?;
        let read = file
            .read_at(&mut buffer[..remaining], offset)
            .map_err(|_| unavailable())?;
        if read == 0 {
            return Err(unavailable());
        }
        digest.update(&buffer[..read]);
        offset = offset.checked_add(read as u64).ok_or_else(unavailable)?;
    }
    checkpoint(budget)?;
    if file
        .read_at(&mut buffer[..1], offset)
        .map_err(|_| unavailable())?
        != 0
    {
        return Err(unavailable());
    }
    image.revalidate(budget)?;
    let actual: [u8; 32] = digest.finalize().into();
    if actual != image.sha256() {
        return Err(unavailable());
    }
    if let Some(expected) = &image.configuration().expected_database {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        if expected.byte_size != byte_size
            || expected.sha256.len() != 64
            || actual.iter().enumerate().any(|(index, byte)| {
                expected.sha256.as_bytes()[2 * index] != HEX[(byte >> 4) as usize]
                    || expected.sha256.as_bytes()[2 * index + 1] != HEX[(byte & 15) as usize]
            })
        {
            return Err(unavailable());
        }
    }
    checkpoint(budget)
}

/// Borrow the original captured configuration and actual caller-selected
/// validation peers. The existing detached validator opens SQLite read-only;
/// this function performs no strict open, restore, session reset or copying.
pub fn validate_selected_image<D: storage::QueueDiscovery, E: storage::QueueRecoveryEvidence>(
    image: &SelectedQueuedUploadHistoryImage<'_>,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
) -> storage::Result<ValidatedQueuedUploadHistoryImage> {
    check_image(image, budget)?;
    let port = NativeMediaRecovery::<
        NativeContracts,
        ReadAuthority,
        NativeMediaRuntime<ServerRuntime>,
        NativeStockContract,
        D,
        E,
    >::validator(&NativeContracts, peers.storage());
    let native_image = port
        .validate_image(image.configuration().database.path(), budget)
        .map_err(|_| unavailable())?;
    check_image(image, budget)?;
    let validated_database = port
        .validate_recovery_database(image.configuration().database.path(), budget)
        .map_err(|_| unavailable())?;
    check_image(image, budget)?;
    Ok(ValidatedQueuedUploadHistoryImage {
        native_image,
        validated_database,
        sha256: image.sha256(),
        byte_size: image.byte_size(),
    })
}
