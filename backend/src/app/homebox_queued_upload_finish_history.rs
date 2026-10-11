//! Handle-free history of one actually released upload Finish.
//! Original preparation and accepted effects retain separate opaque owner cuts;
//! copied outcomes cannot establish release, remote end or restart authority.
use crate::{
    app::homebox_queued_upload_history::RecordedQueuedUploadOriginalHistory,
    media::WorkBudget,
    providers::homebox::{recovery::NativeWriterContracts, write::stock as native},
    storage,
};
use native::queued_upload_dispatch::CapturedQueuedUploadEffects;
use std::sync::Arc;

type UploadNative<'owner, 'captured, 'p> = native::RetainedFreshPreparation<
    'owner,
    NativeWriterContracts,
    native::QueuedUploadSource<'captured, 'p>,
>;

/// The original owner record plus the exact full-Access-released Finish cuts.
/// No Clone, serde or DATA constructor can recreate the process-local seals.
pub struct RecordedQueuedUploadFinishHistory {
    original: RecordedQueuedUploadOriginalHistory,
    storage: storage::ReleasedQueuedUploadFinishHistory,
    source: native::NativeQueuedUploadHistoricalEffects,
}

impl RecordedQueuedUploadFinishHistory {
    pub fn capture_released_finish<'owner, 'captured, 'p>(
        original: RecordedQueuedUploadOriginalHistory,
        native: &UploadNative<'owner, 'captured, 'p>,
        recorded: &storage::RecordedOriginalUploadEnqueue,
        execution: &Arc<storage::OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'_, 'owner, 'captured, 'p>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        // Existing owner seals must match while every original live allocation
        // is still borrowed, before either new transfer copies its facts.
        if !original.storage().matches_live(recorded, execution)
            || !original.media().matches_original(execution.upload_cut())
            || !original
                .media()
                .matches_prepared(execution.native_preparation())
            || !original.source().matches_live(native)
            || !effects.matches_execution(execution)
            || !effects.matches_native(native)
        {
            return Err(unavailable());
        }
        let storage = storage::ReleasedQueuedUploadFinishHistory::capture_released_finish(
            recorded,
            execution,
            effects,
            original.storage(),
            budget,
        )?;
        let source = native::NativeQueuedUploadHistoricalEffects::capture_released_finish(
            original.source(),
            native,
            recorded,
            execution,
            effects,
            &storage,
            budget,
        )
        .map_err(|_| unavailable())?;
        if !storage.matches_live(recorded, execution, effects)
            || !source.matches_storage(&storage)
            || !source.matches_live(native, execution, effects, &storage)
        {
            return Err(unavailable());
        }
        // Facts supplement the allocation joins; equal DATA cannot replace one.
        if storage.job() != execution.attempt().job()
            || storage.job() != original.storage().initial_claim()
            || !same_receipt(storage.journal_receipt(), execution.journal().receipt())
            || !same_receipt(
                storage.journal_receipt(),
                original.storage().journal_receipt(),
            )
            || storage.report() != source.report()
            || storage.steps() != source.steps()
        {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(Self {
            original,
            storage,
            source,
        })
    }

    pub fn original(&self) -> &RecordedQueuedUploadOriginalHistory {
        &self.original
    }
    pub fn storage(&self) -> &storage::ReleasedQueuedUploadFinishHistory {
        &self.storage
    }
    pub fn source(&self) -> &native::NativeQueuedUploadHistoricalEffects {
        &self.source
    }
}

fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn same_receipt(a: &storage::NativeJournalReceipt, b: &storage::NativeJournalReceipt) -> bool {
    a.native_payload_digest == b.native_payload_digest
        && a.journal_evidence_digest == b.journal_evidence_digest
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Released upload Finish history unavailable",
    )
}
