//! Handle-free, same-process history of one released upload preparation.
//! The three original owners issue their cuts before this closed join. Neither
//! copied facts nor this record supply current permission or restart authority.
use crate::{
    domain::stock::ValidatedRequest,
    media::{WorkBudget, native_queued_upload::NativeQueuedUploadHistoricalMedia},
    providers::homebox::{recovery::NativeWriterContracts, write::stock as native},
    storage,
};
use std::sync::Arc;

type UploadNative<'owner, 'captured, 'p> = native::RetainedFreshPreparation<
    'owner,
    NativeWriterContracts,
    native::QueuedUploadSource<'captured, 'p>,
>;

/// An original enqueue, first claim and journal joined before live custody is
/// dropped. No Clone, serde or DATA constructor can reissue its owner seals.
/// Journal-only history makes no claim about invocation, Finish or remote end.
pub struct RecordedQueuedUploadOriginalHistory {
    storage: storage::ReleasedQueuedUploadOriginalHistory,
    media: NativeQueuedUploadHistoricalMedia,
    source: native::NativeQueuedUploadHistoricalPreparation,
}

impl RecordedQueuedUploadOriginalHistory {
    pub fn capture_released_original(
        native: &UploadNative<'_, '_, '_>,
        recorded: &storage::RecordedOriginalUploadEnqueue,
        execution: &Arc<storage::OriginalQueuedUploadExecution>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        let storage = storage::ReleasedQueuedUploadOriginalHistory::capture_released_original(
            recorded, execution, budget,
        )?;
        let media = NativeQueuedUploadHistoricalMedia::capture_released_original(
            recorded, execution, budget,
        )
        .map_err(|_| unavailable())?;
        let source = native::NativeQueuedUploadHistoricalPreparation::capture_released_original(
            native, recorded, execution, &storage, &media, budget,
        )
        .map_err(|_| unavailable())?;

        // All live originals are still borrowed here. These opaque allocation
        // predicates precede every DATA comparison; equal rows cannot join.
        if !storage.matches_live(recorded, execution)
            || !media.matches_original(execution.upload_cut())
            || !media.matches_prepared(execution.native_preparation())
            || !source.matches_live(native)
        {
            return Err(unavailable());
        }
        let original = storage.original();
        if !same_request(original, media.original())
            || !same_request(original, source.original())
            || storage.config() != media.queue_config()
            || storage.request() != media.enqueue_request()
            || storage.scope() != media.canonical_scope()
            || storage.prepared() != media.prepared()
            || storage.prepared() != execution.native_preparation().prepared()
            || storage.initial_claim() != execution.attempt().job()
            || storage.request().pending_byte_liability != media.pending_byte_liability()
            || source.command() != native.command()
            || source.authority() != native.authority()
            || source.plan() != native.plan()
            || source.preflight() != native.preflight()
            || source.owner_preflight() != native.owner_preflight()
            || source.capture_digest() != native.capture().capture_digest()
            || media.command() != source.command()
            || media.authority() != source.authority()
            || media.plan() != source.plan()
            || media.preflight() != source.preflight()
            || media.owner_preflight() != source.owner_preflight()
            || media.capture_digest() != source.capture_digest()
        {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(Self {
            storage,
            media,
            source,
        })
    }

    pub fn original(&self) -> &ValidatedRequest {
        self.storage.original()
    }
    pub fn storage(&self) -> &storage::ReleasedQueuedUploadOriginalHistory {
        &self.storage
    }
    pub fn media(&self) -> &NativeQueuedUploadHistoricalMedia {
        &self.media
    }
    pub fn source(&self) -> &native::NativeQueuedUploadHistoricalPreparation {
        &self.source
    }
}

fn same_request(a: &ValidatedRequest, b: &ValidatedRequest) -> bool {
    a.raw() == b.raw()
        && a.id() == b.id()
        && a.context() == b.context()
        && a.request_id() == b.request_id()
        && a.intent_digest() == b.intent_digest()
        && a.route() == b.route()
        && a.children().is_empty()
        && b.children().is_empty()
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new("owner-unavailable", "Original upload history unavailable")
}
