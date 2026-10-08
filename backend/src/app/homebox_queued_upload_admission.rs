//! Closed installed nonzero upload admission. Stage custody is consumed once by
//! the genuine native/Media bind; no detached DATA constructor admits an upload.
use super::{
    RequestPrincipal, homebox_queued_upload::OriginalQueuedUploadPhysical,
    homebox_queued_upload_graph::OriginalQueuedUploadPreparation,
};
use crate::{
    access,
    domain::stock as domain,
    jobs,
    media::{
        WorkBudget,
        native_queued_upload::{
            NativeQueuedUploadOriginal, NativeQueuedUploadStage, NativeQueuedUploadStages,
        },
    },
    storage,
};
use std::sync::Arc;

pub struct OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p> {
    preparation: &'bundle OriginalQueuedUploadPreparation<'native, 'owner, 'captured, 'p>,
    principal: &'bundle RequestPrincipal,
    upload: Arc<NativeQueuedUploadOriginal>,
}
fn unavailable() -> storage::Error {
    storage::Error::new("owner-unavailable", "Original upload admission unavailable")
}
impl<'bundle, 'native, 'owner, 'captured, 'p>
    OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>
{
    #[allow(clippy::too_many_arguments)]
    pub fn bind_stage_in_phase<'phase>(
        preparation: &'bundle OriginalQueuedUploadPreparation<'native, 'owner, 'captured, 'p>,
        principal: &'bundle RequestPrincipal,
        stages: &NativeQueuedUploadStages,
        stage: NativeQueuedUploadStage<'_>,
        guard: &'phase access::TransactionAuthorization<'_>,
        physical: &'phase OriginalQueuedUploadPhysical<'phase, 'p>,
        budget: &WorkBudget,
    ) -> storage::Result<Self>
    where
        'native: 'phase,
    {
        if !std::ptr::eq(
            principal.principal.principal(),
            preparation.captured().principal(),
        ) || !std::ptr::eq(guard.principal(), preparation.captured().principal())
        {
            return Err(unavailable());
        }
        let upload = Arc::new(
            preparation
                .bind_stage_in_phase(stages, stage, guard, physical, budget)
                .map_err(|_| unavailable())?,
        );
        let result = Self {
            preparation,
            principal,
            upload,
        };
        result.revalidate_phase(guard, physical)?;
        Ok(result)
    }
    pub fn preparation(&self) -> &OriginalQueuedUploadPreparation<'native, 'owner, 'captured, 'p> {
        self.preparation
    }
    pub fn principal(&self) -> &RequestPrincipal {
        self.principal
    }
    pub fn original(&self) -> &domain::ValidatedRequest {
        self.preparation.prepared().request()
    }
    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        &self.upload
    }
    pub fn config(&self) -> &jobs::QueueConfig {
        self.upload.queue_config()
    }
    pub fn request(&self) -> &jobs::EnqueueRequest {
        self.upload.enqueue_request()
    }
    pub fn scope(&self) -> &jobs::CanonicalScope {
        self.upload.canonical_scope()
    }
    pub(crate) fn revalidate_guard(
        &self,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<()> {
        let native = self.preparation.native();
        let source = native.source();
        let captured = self.preparation.captured();
        let proof = native.capture().evidence().source_preparation();
        let pending = self
            .upload
            .known_nonzero_admission()
            .pending_byte_liability();
        if !std::ptr::eq(guard.principal(), captured.principal())
            || !std::ptr::eq(self.principal.principal.principal(), captured.principal())
            || !std::ptr::eq(source.captured(), captured)
            || !std::ptr::eq(source.original().principal(), captured.principal())
            || !self
                .upload
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(&self.upload))
            || !self.upload.matches_source_preparation(proof)
            || !self
                .upload
                .known_nonzero_admission()
                .matches_original(&self.upload)
            || !pending.required
            || pending.reserved_bytes != Some(self.upload.staged_upload().byte_size)
            || self.upload.staged_upload().byte_size == 0
            || self.request().pending_byte_liability != pending
            || self.upload.command() != native.command()
            || self.upload.plan() != native.plan()
            || self.upload.authority() != native.authority()
            || self.upload.preflight() != native.preflight()
            || self.upload.owner_preflight() != native.owner_preflight()
            || self.upload.original().raw() != self.original().raw()
            || self.upload.original().intent_digest() != self.original().intent_digest()
            || self.config() != self.preparation.configured().queue()
            || self.upload.source_reference() != source.original_source().reference()
        {
            return Err(unavailable());
        }
        guard.assert_mutation().map_err(|_| unavailable())?;
        guard
            .revalidate_source(source.original_source())
            .map_err(|_| unavailable())?;
        guard
            .revalidate_source_partition(source.original_partition())
            .map_err(|_| unavailable())?;
        if guard
            .persisted_source_metadata(source.original_partition())
            .map_err(|_| unavailable())?
            != *self.preparation.configured().metadata()
        {
            return Err(unavailable());
        }
        Ok(())
    }
    pub(crate) fn revalidate_phase<'phase>(
        &self,
        guard: &'phase access::TransactionAuthorization<'_>,
        physical: &'phase OriginalQueuedUploadPhysical<'phase, 'p>,
    ) -> storage::Result<()>
    where
        'native: 'phase,
    {
        self.revalidate_guard(guard)?;
        self.preparation
            .revalidate_original_phase(guard, physical)
            .map_err(|_| unavailable())?;
        self.revalidate_guard(guard)
    }
}

/// Current queue phase only. The private upload engine pairs this with its
/// actual same-transaction native/physical context at every phase.
pub(crate) struct QueuedUploadAdmissionPhase<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p> {
    preparation: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    initial: Option<&'phase jobs::JobSnapshot>,
}
impl<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p>
    QueuedUploadAdmissionPhase<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p>
{
    pub(crate) fn new(
        preparation: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        guard: &'phase access::TransactionAuthorization<'tx>,
        initial: Option<&'phase jobs::JobSnapshot>,
    ) -> storage::Result<Self> {
        preparation.revalidate_guard(guard)?;
        Ok(Self {
            preparation,
            guard,
            initial,
        })
    }
    fn check(
        &self,
        principal: &RequestPrincipal,
        witness: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        original: &domain::ValidatedRequest,
    ) -> storage::Result<()> {
        if !std::ptr::eq(principal, self.preparation.principal())
            || !std::ptr::eq(witness, self.preparation)
            || !std::ptr::eq(original, self.preparation.original())
        {
            return Err(unavailable());
        }
        self.preparation.revalidate_guard(self.guard)
    }
}
impl<'bundle, 'native, 'owner, 'captured, 'p> storage::QueueAuthorization
    for QueuedUploadAdmissionPhase<'_, '_, 'bundle, 'native, 'owner, 'captured, 'p>
{
    type Principal = RequestPrincipal;
    type Witness = OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>;
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        witness: &Self::Witness,
        original: &domain::ValidatedRequest,
        _phase: storage::QueuePhase,
        action: storage::QueueAction<'_>,
    ) -> storage::Result<storage::VerifiedActor> {
        self.check(principal, witness, original)?;
        let config = self.preparation.config();
        let request = self.preparation.request();
        let exact = match action {
            storage::QueueAction::Register(selected) => selected == config,
            storage::QueueAction::Enqueue(selected) => selected == request,
            storage::QueueAction::Snapshot(receipt) => receipt == &request.receipt,
            storage::QueueAction::Reject {
                request: selected, ..
            } => selected == request,
            storage::QueueAction::Claim(job) => self.initial.is_some_and(|initial| {
                job.lease.job_id == initial.job_id
                    && job.attempt == 1
                    && job.lease.fence > 0
                    && std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .and_then(|n| u64::try_from(n.as_millis()).ok())
                        .is_some_and(|now| now < job.lease.expires_at)
                    && job.lease.owner_id == config.registration.dispatcher_owner_id
                    && job.lease.physical_identity == config.registration.identity
                    && job.request == *request
                    && job.canonical_scope == *self.preparation.scope()
                    && job.pending_byte_liability == request.pending_byte_liability
            }),
            _ => false,
        };
        if !exact {
            return Err(unavailable());
        }
        let actual = self
            .guard
            .authorize(self.guard.principal().scope(), access::Capability::Mutate)
            .map_err(|_| unavailable())?;
        Ok(storage::VerifiedActor {
            workspace_id: actual.scope().workspace_id.as_str().into(),
            home_id: actual.scope().home_id.as_str().into(),
            actor_id: actual.actor_id().as_str().into(),
        })
    }
    fn validate_enqueue(
        &self,
        principal: &RequestPrincipal,
        witness: &Self::Witness,
        original: &domain::ValidatedRequest,
        request: &jobs::EnqueueRequest,
        scope: &jobs::CanonicalScope,
    ) -> storage::Result<()> {
        self.check(principal, witness, original)?;
        if request != self.preparation.request() || scope != self.preparation.scope() {
            return Err(unavailable());
        }
        Ok(())
    }
    fn parse_retained_original(
        &self,
        value: serde_json::Value,
    ) -> storage::Result<domain::ValidatedRequest> {
        let contracts = domain::NativeStockContract::new().map_err(|_| unavailable())?;
        domain::ValidatedRequest::parse(&contracts, value).map_err(|_| unavailable())
    }
    fn remote_end_step(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &domain::ValidatedRequest,
        _: &jobs::RemoteEndEvidence,
        _: &jobs::LeasedJob,
        _: &storage::JournalEvidenceView,
    ) -> storage::Result<storage::QueueStepEvidence> {
        Err(unavailable())
    }
    fn reconciliation_steps(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &domain::ValidatedRequest,
        _: &jobs::HeldJob,
        _: &jobs::ReconciliationEvidence,
        _: &jobs::FinishDisposition,
    ) -> storage::Result<Vec<storage::QueueStepEvidence>> {
        Err(unavailable())
    }
}
