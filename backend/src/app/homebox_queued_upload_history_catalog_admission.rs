//! Typed semantic admission of one independently authenticated archive frame.
//! Signature/image approval alone is not an original owner; all three genuine
//! decoders and their exact allocation/data joins must succeed first. This
//! preparation-only entry creates no current, dispatch, end or body permission.
use crate::{
    app::homebox_queued_upload_history_catalog::equal_bytes,
    domain::stock::{NativeStockContract, StockContractPort, ValidatedRequest},
    lifecycle::recovery::upload_history_intake::AuthenticatedQueuedUploadOriginalFrame,
    media::{
        WorkBudget,
        native_queued_upload_archived::{
            ArchivedQueuedUploadMediaFacts, ArchivedQueuedUploadMediaFactsIdentity,
        },
    },
    providers::homebox::write::stock::{
        ArchivedQueuedUploadSourceFacts, ArchivedQueuedUploadSourceFactsIdentity,
    },
    storage::{
        self, ArchivedQueuedUploadOriginalFacts, ArchivedQueuedUploadOriginalFactsIdentity,
        ArchivedQueuedUploadOriginalProof,
    },
};
use std::sync::Arc;

/// Pure identity, privately minted after the complete three-owner join. No
/// public constructor, Clone, serde or copied digest can recreate this seal.
pub(crate) struct AdmittedQueuedUploadOriginalCatalogIdentity {
    _seal: (),
}

pub struct AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes> {
    frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
    storage: Arc<ArchivedQueuedUploadOriginalFactsIdentity>,
    source: Arc<ArchivedQueuedUploadSourceFactsIdentity>,
    media: Arc<ArchivedQueuedUploadMediaFactsIdentity>,
    identity: Arc<AdmittedQueuedUploadOriginalCatalogIdentity>,
}
impl<'permit, 'bytes> AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes> {
    pub fn admit(
        frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
        storage: &ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>,
        source: &ArchivedQueuedUploadSourceFacts<'permit, 'bytes>,
        media: &ArchivedQueuedUploadMediaFacts<'permit, 'bytes>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        // Real decoder allocation predicates precede every candidate fact.
        if !std::ptr::eq(storage.frame(), frame)
            || !std::ptr::eq(source.frame(), frame)
            || !std::ptr::eq(media.frame(), frame)
            || !source.matches_storage_facts(storage)
            || !media.matches_storage_facts(storage)
            || !media.matches_source_facts(source)
        {
            return Err(unavailable());
        }
        let original = storage.original();
        NativeStockContract::new()
            .map_err(|_| unavailable())?
            .validate(original.operation().input_schema, original.raw())
            .map_err(|_| unavailable())?;
        let snapshot = source.snapshot();
        if frame.registry().get(frame.queue_index()) != Some(storage.config())
            || frame.job_id() != storage.initial_claim().lease.job_id.0
            || !same_request(original, source.original())
            || !same_request(original, media.original())
            || storage.config() != media.queue_config()
            || storage.request() != media.enqueue_request()
            || storage.scope() != media.canonical_scope()
            || storage.prepared() != media.prepared()
            || storage.request().pending_byte_liability != media.pending_byte_liability()
            || storage.initial_claim().pending_byte_liability != media.pending_byte_liability()
            || media.command() != source.command()
            || media.authority() != source.authority()
            || media.plan() != source.plan()
            || media.preflight() != source.preflight()
            || media.owner_preflight() != source.owner_preflight()
            || media.capture_digest() != source.capture_digest()
            || media.source_reference() != source.source_reference()
            || !equal_bytes(media.owner_original_bytes(), snapshot.original(), budget)?
            || media.owner_scope() != snapshot.scope()
            || media.owner_target() != snapshot.target()
            || media.owner_path() != snapshot.path()
            || media.owner_query() != snapshot.query()
            || media.owner_observed_at() != snapshot.observed_at()
            || media.owner_digest() != snapshot.digest()
            || media.measured_byte_size() == 0
            || media.measured_byte_size() != media.staged_upload().byte_size
            || media.pending_byte_liability().reserved_bytes != Some(media.measured_byte_size())
        {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(Self {
            frame,
            storage: Arc::clone(storage.identity()),
            source: Arc::clone(source.identity()),
            media: Arc::clone(media.identity()),
            identity: Arc::new(AdmittedQueuedUploadOriginalCatalogIdentity { _seal: () }),
        })
    }
    pub fn matches_storage_facts(&self, facts: &ArchivedQueuedUploadOriginalFacts<'_, '_>) -> bool {
        facts.matches_authenticated(self.frame) && Arc::ptr_eq(&self.storage, facts.identity())
    }
    pub fn matches_source_facts(&self, facts: &ArchivedQueuedUploadSourceFacts<'_, '_>) -> bool {
        facts.matches_authenticated(self.frame) && Arc::ptr_eq(&self.source, facts.identity())
    }
    pub fn matches_media_facts(&self, facts: &ArchivedQueuedUploadMediaFacts<'_, '_>) -> bool {
        facts.matches_authenticated(self.frame) && Arc::ptr_eq(&self.media, facts.identity())
    }
    pub fn matches_proof(&self, proof: &ArchivedQueuedUploadOriginalProof<'_, '_>) -> bool {
        proof.matches_authenticated(self.frame)
            && Arc::ptr_eq(&self.identity, proof.admitted_identity())
    }
    pub(crate) fn identity(&self) -> &Arc<AdmittedQueuedUploadOriginalCatalogIdentity> {
        &self.identity
    }
}
fn same_request(a: &ValidatedRequest, b: &ValidatedRequest) -> bool {
    a.raw() == b.raw()
        && a.id() == b.id()
        && a.context() == b.context()
        && a.request_id() == b.request_id()
        && a.intent_digest() == b.intent_digest()
        && a.route() == b.route()
        && a.is_mutation() == b.is_mutation()
        && a.children().is_empty()
        && b.children().is_empty()
}
fn check(b: &WorkBudget) -> storage::Result<()> {
    b.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Archived original upload semantic admission unavailable",
    )
}
