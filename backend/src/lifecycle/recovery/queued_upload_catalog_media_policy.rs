//! Borrow independently authenticated native Media policy evidence alongside
//! actual catalog Jobs evidence. This composition grants no recovery action or
//! authority and performs no archive creation, readback or provider work.

use super::{
    upload_history_intake::PreparedQueuedUploadHistoryIntake,
    upload_history_validation::{self, ValidatedQueuedUploadHistoryImage},
};
use crate::{
    app::{
        homebox_queued_upload_history_catalog::{MAX_CATALOG_MEMBERS, MAX_CATALOG_QUEUES},
        homebox_queued_upload_history_catalog_recovery::with_authenticated_catalog_peers,
    },
    config::recovery::RecoveryPeers,
    jobs::QueueConfig,
    media::{
        WorkBudget, native_policy_archive::NativeMediaArchiveReadOwner,
        recovery_policy_archive::AuthenticatedMediaPolicyArchive,
    },
    storage::{self, QueueDiscovery, QueueRecoveryEvidence},
};

fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Catalog Media policy validation unavailable",
    )
}

fn checkpoint(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}

// Private composition restricts Media to the actual native archive read owner.
// Both delegates match immutable owner evidence; no filesystem, Storage,
// Access or vault reentry occurs under the validation read transaction.
pub(super) struct CatalogMediaEvidence<'borrow, 'origin, E> {
    jobs: &'borrow E,
    archive: &'borrow AuthenticatedMediaPolicyArchive<'origin, NativeMediaArchiveReadOwner>,
}

impl<E: QueueRecoveryEvidence> QueueRecoveryEvidence for CatalogMediaEvidence<'_, '_, E> {
    fn validate_attempt(
        &self,
        config: &QueueConfig,
        frame: storage::QueueRecoveryAttempt<'_>,
    ) -> storage::Result<()> {
        self.jobs.validate_attempt(config, frame)
    }

    fn validate_media_policy(
        &self,
        frame: storage::MediaPolicyRecoveryFrame<'_>,
    ) -> storage::Result<()> {
        self.archive.validate_frame(frame)
    }
}

// Borrow the exact actual catalog Jobs/discovery references. The native
// archive is independently authenticated beforehand; no generic Media auth
// port, grant refresh or archive construction enters this factory.
pub(super) fn with_native_media_policy_peers<D, E, R>(
    peers: &RecoveryPeers<'_, D, E>,
    archive: &AuthenticatedMediaPolicyArchive<'_, NativeMediaArchiveReadOwner>,
    budget: &WorkBudget,
    operation: impl FnOnce(&RecoveryPeers<'_, D, CatalogMediaEvidence<'_, '_, E>>) -> storage::Result<R>,
) -> storage::Result<R>
where
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
{
    checkpoint(budget)?;
    let actual = peers.storage();
    let evidence = CatalogMediaEvidence {
        jobs: actual.evidence,
        archive,
    };
    let composed = RecoveryPeers::new(actual.queues, actual.discovery, &evidence)
        .map_err(|_| unavailable())?;
    let result = operation(&composed)?;
    checkpoint(budget)?;
    Ok(result)
}

/// Validate the original selected image with all authenticated catalog frames
/// and independent native Media policy evidence. The archive must already have
/// been authenticated as a complete archive against its actual independent
/// historical authority, grant and reference, using the native read owner.
/// Its Storage callback matches the immutable complete approved map without
/// I/O. Catalog approval, image rows and current sessions cannot substitute.
pub fn validate_catalog_image_with_media_policy(
    intake: &PreparedQueuedUploadHistoryIntake<'_, '_, '_>,
    archive: &AuthenticatedMediaPolicyArchive<'_, NativeMediaArchiveReadOwner>,
    budget: &WorkBudget,
) -> storage::Result<ValidatedQueuedUploadHistoryImage> {
    checkpoint(budget)?;
    let members = intake.origin().catalog().members();
    if intake.registry().len() > MAX_CATALOG_QUEUES
        || members.len() > MAX_CATALOG_MEMBERS
        || members.len() != intake.archive().members().len()
    {
        return Err(unavailable());
    }
    // Freeze every actual full-intake permit before creating decoder borrows.
    // No subset, truncation or permit reconstruction from image rows exists.
    let mut frames = Vec::new();
    frames
        .try_reserve_exact(members.len())
        .map_err(|_| unavailable())?;
    for slot in 0..members.len() {
        checkpoint(budget)?;
        frames.push(intake.frame(slot, budget)?);
    }
    with_authenticated_catalog_peers(
        &frames,
        intake.registry(),
        intake.authority(),
        intake.grant(),
        budget,
        |peers| {
            with_native_media_policy_peers(peers, archive, budget, |composed| {
                upload_history_validation::validate_selected_image(intake.image(), composed, budget)
            })
        },
    )
}
