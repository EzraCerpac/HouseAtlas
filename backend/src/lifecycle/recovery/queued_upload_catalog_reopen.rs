//! Consuming catalog-backed cold/warm recovery through actual archived peers.
//! Reopening may reset access sessions and enable SQLite WAL. Any subsequent
//! fence failure closes the fresh Core explicitly; it claims no rollback.

use super::{
    reopen::{self, ReopenError},
    upload_history_intake::{OwnedQueuedUploadHistoryIntake, VerifiedUploadHistoryStartupApproval},
};
use crate::{
    app::{Core, homebox_queued_upload_history_catalog_recovery::with_authenticated_catalog_peers},
    config::recovery::{RecoveryConfig, upload_history_origin::VerifiedQueuedUploadHistoryCatalog},
    lifecycle::provider_dispatch::queued_upload_history_archive::UnadmittedQueuedUploadHistoryArchive,
    media::WorkBudget,
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
    reopen_catalog(None, config, approval, origin, archive, budget)
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
    reopen_catalog(Some(source), config, approval, origin, archive, budget)
}

fn reopen_catalog(
    mut source: Option<Core>,
    config: RecoveryConfig,
    approval: &VerifiedUploadHistoryStartupApproval,
    origin: &VerifiedQueuedUploadHistoryCatalog<'_>,
    archive: &UnadmittedQueuedUploadHistoryArchive,
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
            pin.revalidate(&config, budget)?;
            let result = match source.take() {
                Some(old) => reopen::reopen_with_peers(old, config, peers, budget),
                None => reopen::reopen_closed(config, peers, budget),
            };
            outcome = Some(result);
            // The helper fences the SAME external authority/grant against
            // every registry registration and checks budget after this callback.
            Ok(())
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
