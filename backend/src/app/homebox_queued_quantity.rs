//! Live original quantity custody for a bounded native queue admission.
//! Detached provenance has no current authority. Each queue operation rebuilds
//! its phase adapter under the actual Store and original mutation guard.
use super::{RequestPrincipal, homebox_quantity_graph::OriginalQuantityPreparation};
use crate::{
    access,
    domain::stock::{self as domain, ValidatedRequest},
    jobs,
    media::native_queued_quantity::NativeQueuedMediaOriginal,
    providers::homebox::{
        read,
        write::stock::{
            FreshQualification, quantity_queue_original::NativeQueuedQuantityOriginal,
            quantity_queue_prepared::NativeQueuedQuantityPrepared,
        },
    },
    storage::{self, StockActivityPrincipal as _},
};
use std::sync::Arc;

/// Holds the same live preparation and its genuine detached producers. This
/// bundle is neither the historical enqueue record nor a phase authority.
pub struct OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    quantity: &'bundle OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
    principal: &'bundle RequestPrincipal,
    source: Arc<NativeQueuedQuantityOriginal>,
    media: Arc<NativeQueuedMediaOriginal>,
}

fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Original queued quantity custody unavailable",
    )
}

impl<'bundle, 'native, 'p, 'owner, T, K>
    OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    pub fn bind<'phase, 'tx>(
        quantity: &'bundle OriginalQuantityPreparation<'native, 'p, 'owner, T, K>,
        principal: &'bundle RequestPrincipal,
        source: Arc<NativeQueuedQuantityOriginal>,
        media: Arc<NativeQueuedMediaOriginal>,
        qualification: &FreshQualification<'phase, 'tx, 'p>,
    ) -> storage::Result<Self>
    where
        'native: 'phase,
    {
        let physical = qualification
            .quantity_installation()
            .ok_or_else(unavailable)?;
        if !std::ptr::eq(qualification.captured(), quantity.captured())
            || !std::ptr::eq(
                principal.principal.principal(),
                quantity.original().original_activity_principal(),
            )
            || !Arc::ptr_eq(physical.configured(), quantity.configured())
            || !media.matches_source(&source)
        {
            return Err(unavailable());
        }
        quantity
            .revalidate_original_phase(qualification.guard(), physical)
            .map_err(|_| unavailable())?;
        let bound = Self {
            quantity,
            principal,
            source,
            media,
        };
        bound.revalidate_guard(qualification.guard())?;
        Ok(bound)
    }

    pub fn quantity_preparation(&self) -> &OriginalQuantityPreparation<'native, 'p, 'owner, T, K> {
        self.quantity
    }
    pub fn principal(&self) -> &RequestPrincipal {
        self.principal
    }
    pub fn source_cut(&self) -> &Arc<NativeQueuedQuantityOriginal> {
        &self.source
    }
    pub fn media_cut(&self) -> &Arc<NativeQueuedMediaOriginal> {
        &self.media
    }
    pub fn config(&self) -> &jobs::QueueConfig {
        self.source.queue_config()
    }
    pub fn request(&self) -> &jobs::EnqueueRequest {
        self.source.enqueue_request()
    }
    pub fn scope(&self) -> &jobs::CanonicalScope {
        self.source.canonical_scope()
    }
    pub fn original(&self) -> &ValidatedRequest {
        self.quantity.prepared().request()
    }

    /// Guard-only current source check. Full physical qualification remains
    /// mandatory through the separate actual transaction method below.
    pub(crate) fn revalidate_guard(
        &self,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<()> {
        if !std::ptr::eq(guard.principal(), self.principal.principal.principal())
            || !self.media.matches_source(&self.source)
            || self.config() != self.quantity.configured().queue()
            || self.original().raw() != &self.source.command().original_wire
        {
            return Err(unavailable());
        }
        self.source
            .revalidate_original_guard(self.quantity, guard)
            .map_err(|_| unavailable())?;
        Ok(())
    }

    pub(crate) fn revalidate_queue_transaction<'phase>(
        &self,
        guard: &'phase access::TransactionAuthorization<'_>,
        transaction: &'phase storage::QuantityInstallationTransaction<
            'phase,
            'p,
            super::stock_activity_principal::OriginalStockActivityPrincipal,
        >,
    ) -> storage::Result<()>
    where
        'native: 'phase,
    {
        self.quantity
            .revalidate_activity_transaction(guard, transaction)
            .map_err(|_| unavailable())?;
        self.revalidate_guard(guard)
    }
}

/// One actual synchronous phase; never retained in a queued owner or across I/O.
pub(crate) struct QueuedQuantityPhase<'phase, 'tx, 'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    preparation: &'phase OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    initial: Option<&'phase jobs::JobSnapshot>,
    journal: Option<(
        &'phase jobs::LeasedJob,
        &'phase storage::PreparedNativeIntent,
    )>,
    journal_proof: Option<&'phase NativeQueuedQuantityPrepared>,
}

impl<'phase, 'tx, 'bundle, 'native, 'p, 'owner, T, K>
    QueuedQuantityPhase<'phase, 'tx, 'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    pub(crate) fn new(
        preparation: &'phase OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        guard: &'phase access::TransactionAuthorization<'tx>,
        initial: Option<&'phase jobs::JobSnapshot>,
    ) -> storage::Result<Self> {
        preparation.revalidate_guard(guard)?;
        Ok(Self {
            preparation,
            guard,
            initial,
            journal: None,
            journal_proof: None,
        })
    }

    pub(crate) fn for_journal(
        preparation: &'phase OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        guard: &'phase access::TransactionAuthorization<'tx>,
        job: &'phase jobs::LeasedJob,
        prepared: &'phase NativeQueuedQuantityPrepared,
    ) -> storage::Result<Self> {
        preparation.revalidate_guard(guard)?;
        prepared
            .revalidate_original_guard(preparation.quantity_preparation(), guard)
            .map_err(|_| unavailable())?;
        Ok(Self {
            preparation,
            guard,
            initial: None,
            journal: Some((job, prepared.prepared())),
            journal_proof: Some(prepared),
        })
    }

    fn check(
        &self,
        principal: &RequestPrincipal,
        witness: &OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        original: &ValidatedRequest,
    ) -> storage::Result<()> {
        if !std::ptr::eq(principal, self.preparation.principal())
            || !std::ptr::eq(witness, self.preparation)
            || !std::ptr::eq(original, self.preparation.original())
        {
            return Err(unavailable());
        }
        self.preparation.revalidate_guard(self.guard)?;
        if let Some(proof) = self.journal_proof {
            proof
                .revalidate_original_guard(self.preparation.quantity_preparation(), self.guard)
                .map_err(|_| unavailable())?;
        }
        Ok(())
    }
}

impl<'bundle, 'native, 'p, 'owner, T, K> storage::QueueAuthorization
    for QueuedQuantityPhase<'_, '_, 'bundle, 'native, 'p, 'owner, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    type Principal = RequestPrincipal;
    type Witness = OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>;

    fn authorize(
        &self,
        principal: &RequestPrincipal,
        witness: &Self::Witness,
        original: &ValidatedRequest,
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
                    && job.lease.owner_id == config.registration.dispatcher_owner_id
                    && job.lease.physical_identity == config.registration.identity
                    && job.request == *request
                    && job.canonical_scope == *self.preparation.scope()
                    && job.pending_byte_liability == request.pending_byte_liability
            }),
            storage::QueueAction::Journal(job, prepared) => {
                self.journal
                    .is_some_and(|(expected_job, expected_prepared)| {
                        job == expected_job && prepared == expected_prepared
                    })
            }
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
        original: &ValidatedRequest,
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
    ) -> storage::Result<ValidatedRequest> {
        let contracts = domain::NativeStockContract::new().map_err(|_| unavailable())?;
        ValidatedRequest::parse(&contracts, value).map_err(|_| unavailable())
    }

    fn remote_end_step(
        &self,
        _: &RequestPrincipal,
        _: &Self::Witness,
        _: &ValidatedRequest,
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
        _: &ValidatedRequest,
        _: &jobs::HeldJob,
        _: &jobs::ReconciliationEvidence,
        _: &jobs::FinishDisposition,
    ) -> storage::Result<Vec<storage::QueueStepEvidence>> {
        Err(unavailable())
    }
}
