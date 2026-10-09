//! Consuming catalog-backed cold/warm recovery through actual archived peers.
//! Reopening may reset access sessions and enable SQLite WAL. Any subsequent
//! fence failure closes the fresh Core explicitly; it claims no rollback.

use super::{
    queued_upload_catalog_media_policy::with_native_media_policy_peers,
    reopen::{self, ReopenError},
    upload_history_intake::{
        FullImagePin, OwnedQueuedUploadHistoryIntake, VerifiedUploadHistoryStartupApproval,
    },
};
use crate::{
    app::{Core, homebox_queued_upload_history_catalog_recovery::with_authenticated_catalog_peers},
    config::recovery::{
        RecoveryConfig, RecoveryPeers, upload_history_origin::VerifiedQueuedUploadHistoryCatalog,
    },
    lifecycle::provider_dispatch::queued_upload_history_archive::UnadmittedQueuedUploadHistoryArchive,
    media::{
        WorkBudget, native_policy_archive::NativeMediaArchiveReadOwner,
        recovery_policy_archive::AuthenticatedMediaPolicyArchive,
    },
    storage,
};

/// Consume the original independently configured closed image and actual
/// verified catalog inputs. No fallback registry, peer, grant or config exists.
pub fn reopen_catalog_closed(
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_catalog(None, config, approval, origin, archive, None, budget)
}

/// Consume the drained old Core on every outcome, including intake failure.
/// Archived peers must not retain aliases to its Access or vault owners.
pub fn reopen_catalog_with_source(
    source: Core,
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_catalog(
        Some(source),
        config,
        approval,
        origin,
        archive,
        None,
        budget,
    )
}

/// Cold consuming reopen with a separately authenticated complete native Media
/// policy archive. Historical authority, grant and reference remain independent
/// of catalog approval and are never reconstructed from the selected image.
pub fn reopen_catalog_closed_with_media_policy(
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
    media_policy: &AuthenticatedMediaPolicyArchive<'_, NativeMediaArchiveReadOwner>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_catalog(
        None,
        config,
        approval,
        origin,
        archive,
        Some(media_policy),
        budget,
    )
}

/// Warm consuming variant using the SAME already-authenticated native Media
/// archive. Failure cleanup closes actual old/fresh hosts without claiming
/// rollback of access-session reset or SQLite WAL changes.
pub fn reopen_catalog_with_source_and_media_policy(
    source: Core,
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
    media_policy: &AuthenticatedMediaPolicyArchive<'_, NativeMediaArchiveReadOwner>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    reopen_catalog(
        Some(source),
        config,
        approval,
        origin,
        archive,
        Some(media_policy),
        budget,
    )
}

fn reopen_catalog(
    mut source: Option<Core>,
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
    media_policy: Option<&AuthenticatedMediaPolicyArchive<'_, NativeMediaArchiveReadOwner>>,
    budget: &WorkBudget,
) -> Result<Core, ReopenError> {
    let intake =
        match OwnedQueuedUploadHistoryIntake::new(config, approval, origin, archive, budget) {
            Ok(intake) => intake,
            Err(_) => {
                if let Some(old) = source.take() {
                    // Cleanup has no work-budget fence; close failure wins.
                    reopen::close_source(old)?;
                }
                return Err(ReopenError::Configuration);
            }
        };
    let OwnedQueuedUploadHistoryIntake {
        config,
        frames,
        registry,
        authority,
        grant,
        pin,
    } = intake;
    // Freeze all permits before the callback creates decoder/peer borrows.
    // Keep the actual opener outcome OUTSIDE generic R: helper postcallback
    // fences cannot implicitly drop a successful Core or hide a phase error.
    let mut outcome = None;
    let gate =
        with_authenticated_catalog_peers(&frames, registry, &authority, &grant, budget, |peers| {
            match media_policy {
                Some(archive) => {
                    with_native_media_policy_peers(peers, archive, budget, |composed| {
                        open_with_peers(&mut source, config, &pin, composed, budget, &mut outcome)
                    })
                }
                None => open_with_peers(&mut source, config, &pin, peers, budget, &mut outcome),
            }
        });
    if let Some(old) = source.take() {
        // Pre-callback failure still consumes the original drained host.
        reopen::close_source(old)?;
    }
    match (gate, outcome) {
        (Ok(()), Some(result)) => result,
        (Err(_), Some(Ok(fresh))) => {
            reopen::close_source(fresh)?;
            Err(ReopenError::Configuration)
        }
        (_, Some(Err(phase))) => Err(phase),
        (_, None) => Err(ReopenError::Configuration),
    }
}

// The actual opener outcome remains outside BOTH callback scopes, so a Media
// or catalog postcallback fence cannot implicitly drop a successfully opened
// Core. Existing outer cleanup owns every resulting fresh/old host explicitly.
fn open_with_peers<D: storage::QueueDiscovery, E: storage::QueueRecoveryEvidence>(
    source: &mut Option<Core>,
    config: RecoveryConfig,
    pin: &FullImagePin,
    peers: &RecoveryPeers<'_, D, E>,
    budget: &WorkBudget,
    outcome: &mut Option<Result<Core, ReopenError>>,
) -> storage::Result<()> {
    pin.revalidate(&config, budget)?;
    let result = match source.take() {
        Some(old) => reopen::reopen_with_peers(old, config, peers, budget),
        None => reopen::reopen_closed(config, peers, budget),
    };
    *outcome = Some(result);
    Ok(())
}
