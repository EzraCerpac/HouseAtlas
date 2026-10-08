//! Process-local custody of a genuine fresh quantity enqueue and initial claim.
//! Commit observations are DATA. Only the original producer's successful
//! Release can qualify the same captured cut; rows cannot recreate custody.
use super::*;
use crate::{
    app::homebox_queued_quantity::OriginalQueuedQuantityPreparation,
    domain::queue_recovery::{OriginalEnqueue, OriginalEnqueueOwner},
    media::native_queued_quantity::NativeQueuedMediaOriginal,
    providers::homebox::{
        read, write::stock::quantity_queue_original::NativeQueuedQuantityOriginal,
    },
};
use std::cell::RefCell;

/// The actual durable cut observed before the original Release checks.
/// Taking this DATA does not issue enqueue, claim or recovery qualification.
pub enum QueueOriginalCommittedData {
    Enqueue(JobSnapshot),
    InitialClaim(LeasedJob),
}

#[derive(Default)]
pub struct QueueOriginalCommittedObservation(RefCell<Option<QueueOriginalCommittedData>>);
impl QueueOriginalCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueOriginalCommittedData> {
        self.0.borrow_mut().take()
    }
}

// Neither ledger is exposed as proof. A failed Release leaves CommittedData
// occupied, so another session, row lookup or copied DTO cannot retry issuance.
enum EnqueueLedger {
    Empty,
    CommittedData(JobSnapshot),
    ReleaseQualified(JobSnapshot),
}
enum InitialClaimLedger {
    Empty,
    CommittedData(LeasedJob),
    ReleaseQualified(LeasedJob),
}

// An allocation brand is minted only by this leaf's original fresh producer.
// It is distinct from job identifiers and from the Store's instance pin.
struct OriginalCustodyBrand;

pub(super) struct QueueOriginalEnqueueCapture<'a> {
    request: &'a EnqueueRequest,
    scope: &'a CanonicalScope,
    config: &'a QueueConfig,
    ledger: &'a RefCell<EnqueueLedger>,
    observation: &'a QueueOriginalCommittedObservation,
}
impl QueueOriginalEnqueueCapture<'_> {
    pub(super) fn validate_fresh(
        &self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()> {
        if input != self.request
            || scope != self.scope
            || config != self.config
            || !matches!(*self.ledger.borrow(), EnqueueLedger::Empty)
            || self.observation.0.borrow().is_some()
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn record_committed(&self, snapshot: &JobSnapshot) -> Result<()> {
        self.validate_fresh(self.request, self.scope, self.config)?;
        if snapshot.receipt != self.request.receipt
            || snapshot.partition != self.request.partition
            || snapshot.status != JobStatus::Queued
            || snapshot.attempts != 0
            || snapshot.body_accepted
            || snapshot.remote_activity != RemoteActivity::NotDispatched
            || snapshot.unknown_scope_fence_retained
            || snapshot.applied.is_some()
            || snapshot.failure.is_some()
            || snapshot.next_attempt_at != Some(snapshot.created_at)
            || snapshot.updated_at != snapshot.created_at
        {
            return Err(conflict());
        }
        *self.ledger.borrow_mut() = EnqueueLedger::CommittedData(snapshot.clone());
        self.observation
            .0
            .replace(Some(QueueOriginalCommittedData::Enqueue(snapshot.clone())));
        Ok(())
    }
    pub(super) fn record_released(&self, snapshot: &JobSnapshot) -> Result<()> {
        let mut ledger = self.ledger.borrow_mut();
        match &*ledger {
            EnqueueLedger::CommittedData(committed) if committed == snapshot => {
                *ledger = EnqueueLedger::ReleaseQualified(committed.clone());
                Ok(())
            }
            _ => Err(conflict()),
        }
    }
}

pub(super) struct QueueOriginalClaimCapture<'a> {
    snapshot: &'a JobSnapshot,
    request: &'a EnqueueRequest,
    scope: &'a CanonicalScope,
    config: &'a QueueConfig,
    ledger: &'a Mutex<InitialClaimLedger>,
    observation: &'a QueueOriginalCommittedObservation,
}
impl QueueOriginalClaimCapture<'_> {
    pub(super) fn validate_initial(&self, row: &StoredJob, config: &QueueConfig) -> Result<()> {
        if config != self.config
            || row.snapshot() != *self.snapshot
            || row.request != *self.request
            || row.scope != *self.scope
            || row.deployment != config.registration.identity.deployment_id
            || row.physical != config.registration.identity.physical_database_id
            || row.status != JobStatus::Queued
            || row.attempts != 0
            || row.body_accepted
            || row.remote != RemoteActivity::NotDispatched
            || row.logical
            || row.lease_fence.is_some()
            || row.lease_owner.is_some()
            || row.lease_expires.is_some()
            || !matches!(
                *self.ledger.lock().map_err(|_| bad())?,
                InitialClaimLedger::Empty
            )
            || self.observation.0.borrow().is_some()
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub(super) fn record_committed(&self, job: &LeasedJob) -> Result<()> {
        let mut ledger = self.ledger.lock().map_err(|_| bad())?;
        if !matches!(*ledger, InitialClaimLedger::Empty)
            || job.lease.job_id != self.snapshot.job_id
            || job.request != *self.request
            || job.canonical_scope != *self.scope
            || job.attempt != 1
            || job.lease.fence == 0
            || job.lease.physical_identity != self.config.registration.identity
            || job.lease.owner_id != self.config.registration.dispatcher_owner_id
            || job.pending_byte_liability != self.request.pending_byte_liability
        {
            return Err(conflict());
        }
        *ledger = InitialClaimLedger::CommittedData(job.clone());
        self.observation
            .0
            .replace(Some(QueueOriginalCommittedData::InitialClaim(job.clone())));
        Ok(())
    }
    pub(super) fn record_released(&self, job: &LeasedJob) -> Result<()> {
        let mut ledger = self.ledger.lock().map_err(|_| bad())?;
        match &*ledger {
            InitialClaimLedger::CommittedData(committed) if committed == job => {
                *ledger = InitialClaimLedger::ReleaseQualified(committed.clone());
                Ok(())
            }
            _ => Err(conflict()),
        }
    }
}

/// Fresh enqueue custody. The original live preparation remains borrowed.
pub struct OriginalQueuedQuantityOwner<
    'bundle,
    'native,
    'p,
    'owner,
    T: read::Transport,
    K: read::Clock + Send + Sync,
> {
    preparation: &'bundle OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
    record: Arc<OriginalEnqueueRecord>,
}
pub enum OriginalQueuedQuantityEnqueue<
    'bundle,
    'native,
    'p,
    'owner,
    T: read::Transport,
    K: read::Clock + Send + Sync,
> {
    Enqueued(OriginalQueuedQuantityOwner<'bundle, 'native, 'p, 'owner, T, K>),
    RejectedBeforeDispatch { reason: AdmissionRejection },
}
pub enum OriginalQueuedQuantityClaim {
    Claimed(OriginalQueuedQuantityAttempt),
    Unclaimed(ClaimOutcome),
}
/// One release-qualified initial attempt, with no public proof constructor.
pub struct OriginalQueuedQuantityAttempt {
    job: LeasedJob,
    _custody: Arc<OriginalCustodyBrand>,
}
impl OriginalQueuedQuantityAttempt {
    pub fn job(&self) -> &LeasedJob {
        &self.job
    }
}

struct OriginalEnqueueRecord {
    source: Arc<NativeQueuedQuantityOriginal>,
    media: Arc<NativeQueuedMediaOriginal>,
    store: crate::storage::QuantityInstallationStoreIdentity,
    custody: Arc<OriginalCustodyBrand>,
    original: ValidatedRequest,
    snapshot: JobSnapshot,
    // This is the actual postcommit capture, qualified by the current original
    // Claim Release. It is independent of later SQL lookup and retains no
    // prepared, journal, outcome or liability-prefix qualification.
    claim: Mutex<InitialClaimLedger>,
}
/// Detached process-local history; no live Root bundle, Access or provider.
pub struct RecordedOriginalEnqueue(Arc<OriginalEnqueueRecord>);
pub struct RecordedOriginalEnqueueProof {
    record: Arc<OriginalEnqueueRecord>,
}
impl RecordedOriginalEnqueue {
    pub fn source_cut(&self) -> &Arc<NativeQueuedQuantityOriginal> {
        &self.0.source
    }
    pub fn media_cut(&self) -> &Arc<NativeQueuedMediaOriginal> {
        &self.0.media
    }
}
impl RecordedOriginalEnqueueProof {
    pub fn source_cut(&self) -> &Arc<NativeQueuedQuantityOriginal> {
        &self.record.source
    }
    pub fn media_cut(&self) -> &Arc<NativeQueuedMediaOriginal> {
        &self.record.media
    }
    pub fn matches_released_attempt(&self, job: &LeasedJob) -> bool {
        self.record.claim.lock().is_ok_and(|ledger| {
            matches!(&*ledger, InitialClaimLedger::ReleaseQualified(cut) if cut == job)
                && job.lease.job_id == self.record.snapshot.job_id
                && job.attempt == 1
        })
    }
}

impl crate::app::Store {
    pub fn enqueue_original_quantity_owned<
        'bundle,
        'native,
        'p,
        'owner,
        T: read::Transport,
        K: read::Clock + Send + Sync,
    >(
        &mut self,
        preparation: &'bundle OriginalQueuedQuantityPreparation<'bundle, 'native, 'p, 'owner, T, K>,
        now: Timestamp,
        observation: &QueueOriginalCommittedObservation,
    ) -> Result<OriginalQueuedQuantityEnqueue<'bundle, 'native, 'p, 'owner, T, K>> {
        let ledger = RefCell::new(EnqueueLedger::Empty);
        let capture = QueueOriginalEnqueueCapture {
            request: preparation.request(),
            scope: preparation.scope(),
            config: preparation.config(),
            ledger: &ledger,
            observation,
        };
        capture.validate_fresh(
            preparation.request(),
            preparation.scope(),
            preparation.config(),
        )?;
        let store = self.quantity_installation_store_identity();
        let outcome = self.enqueue_original_quantity_inner(preparation, now, &capture)?;
        match outcome {
            EnqueueOutcome::Enqueued(snapshot) => {
                if !matches!(&*ledger.borrow(), EnqueueLedger::ReleaseQualified(cut) if cut == &snapshot)
                {
                    return Err(conflict());
                }
                let record = Arc::new(OriginalEnqueueRecord {
                    source: Arc::clone(preparation.source_cut()),
                    media: Arc::clone(preparation.media_cut()),
                    store,
                    custody: Arc::new(OriginalCustodyBrand),
                    original: preparation.original().clone(),
                    snapshot,
                    claim: Mutex::new(InitialClaimLedger::Empty),
                });
                Ok(OriginalQueuedQuantityEnqueue::Enqueued(
                    OriginalQueuedQuantityOwner {
                        preparation,
                        record,
                    },
                ))
            }
            EnqueueOutcome::RejectedBeforeDispatch { reason } => {
                Ok(OriginalQueuedQuantityEnqueue::RejectedBeforeDispatch { reason })
            }
            EnqueueOutcome::Replayed(_) => Err(conflict()),
        }
    }
}

impl<'bundle, 'native, 'p, 'owner, T: read::Transport, K: read::Clock + Send + Sync>
    OriginalQueuedQuantityOwner<'bundle, 'native, 'p, 'owner, T, K>
{
    pub fn snapshot(&self) -> &JobSnapshot {
        &self.record.snapshot
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.record.original
    }
    pub fn recorded(&self) -> RecordedOriginalEnqueue {
        RecordedOriginalEnqueue(Arc::clone(&self.record))
    }
    pub fn claim_initial(
        &mut self,
        store: &mut crate::app::Store,
        now: Timestamp,
        observation: &QueueOriginalCommittedObservation,
    ) -> Result<OriginalQueuedQuantityClaim> {
        let identity = store.quantity_installation_store_identity();
        if !Arc::ptr_eq(&identity.0, &self.record.store.0)
            || !Arc::ptr_eq(self.preparation.source_cut(), &self.record.source)
            || !Arc::ptr_eq(self.preparation.media_cut(), &self.record.media)
            || !matches!(
                *self.record.claim.lock().map_err(|_| bad())?,
                InitialClaimLedger::Empty
            )
            || observation.0.borrow().is_some()
        {
            return Err(conflict());
        }
        let capture = QueueOriginalClaimCapture {
            snapshot: &self.record.snapshot,
            request: self.preparation.request(),
            scope: self.preparation.scope(),
            config: self.preparation.config(),
            ledger: &self.record.claim,
            observation,
        };
        match store.claim_original_quantity_initial_inner(
            self.preparation,
            &self.record.snapshot,
            now,
            &capture,
        )? {
            ClaimOutcome::Claimed(job) => {
                if !matches!(&*self.record.claim.lock().map_err(|_| bad())?, InitialClaimLedger::ReleaseQualified(cut) if cut == &job)
                {
                    return Err(conflict());
                }
                Ok(OriginalQueuedQuantityClaim::Claimed(
                    OriginalQueuedQuantityAttempt {
                        job,
                        _custody: Arc::clone(&self.record.custody),
                    },
                ))
            }
            other => Ok(OriginalQueuedQuantityClaim::Unclaimed(other)),
        }
    }
}

impl OriginalEnqueueOwner for RecordedOriginalEnqueue {
    type Proof = RecordedOriginalEnqueueProof;
    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> Result<OriginalEnqueue<Self::Proof>> {
        let source = &self.0.source;
        if registration != &source.queue_config().registration
            || receipt != &self.0.snapshot.receipt
            || receipt != &source.enqueue_request().receipt
            || original.raw() != self.0.original.raw()
            || original.intent_digest() != self.0.original.intent_digest()
            || original.id() != self.0.original.id()
            || original.request_id() != self.0.original.request_id()
            || original.context() != self.0.original.context()
            || original.route() != self.0.original.route()
            || original.is_mutation() != self.0.original.is_mutation()
            || !original.children().is_empty()
            || !self.0.original.children().is_empty()
            || original.raw() != &source.command().original_wire
        {
            return Err(conflict());
        }
        let proof = RecordedOriginalEnqueueProof {
            record: Arc::clone(&self.0),
        };
        self.0.media.validate_original(
            &proof,
            source,
            registration,
            &self.0.original,
            source.enqueue_request(),
            source.canonical_scope(),
        )?;
        Ok(OriginalEnqueue {
            physical_identity: registration.identity.clone(),
            original: self.0.original.clone(),
            expected: source.enqueue_request().clone(),
            proof,
        })
    }
    fn retained_attempt(
        &self,
        registration: &QueueRegistration,
        proof: &Self::Proof,
        job_id: &JobId,
        fence: u64,
        attempt: u32,
    ) -> Result<LeasedJob> {
        if registration != &self.0.source.queue_config().registration
            || !Arc::ptr_eq(&proof.record, &self.0)
            || !Arc::ptr_eq(&proof.record.custody, &self.0.custody)
        {
            return Err(conflict());
        }
        let ledger = self.0.claim.lock().map_err(|_| bad())?;
        let InitialClaimLedger::ReleaseQualified(job) = &*ledger else {
            return Err(Error::new(
                "owner-unavailable",
                "Original initial claim is not release qualified",
            ));
        };
        if &job.lease.job_id != job_id
            || job.lease.fence != fence
            || job.attempt != attempt
            || attempt != 1
        {
            return Err(conflict());
        }
        let job = job.clone();
        drop(ledger);
        self.0.media.validate_unprepared_attempt(
            proof,
            &self.0.source,
            registration,
            &self.0.original,
            self.0.source.enqueue_request(),
            self.0.source.canonical_scope(),
            &job,
        )?;
        Ok(job)
    }
}
