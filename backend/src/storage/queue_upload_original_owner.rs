//! Process-local custody for the installed original queued upload.
//! A durable queue row is DATA. Only the original producer's successful
//! postcommit Release qualifies the exact enqueue or first claim captured here.
use super::*;
use crate::{
    app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission,
    domain::queue_recovery::{OriginalEnqueue, OriginalEnqueueOwner},
    media::native_queued_upload::NativeQueuedUploadOriginal,
};
use std::cell::Cell;
use std::sync::MutexGuard;
use std::time::{SystemTime, UNIX_EPOCH};

fn current_now() -> Result<Timestamp> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::new("owner-unavailable", "Original upload clock unavailable"))?;
    u64::try_from(elapsed.as_millis())
        .map_err(|_| Error::new("owner-unavailable", "Original upload clock unavailable"))
}

/// Observed durable data, never an enqueue or recovery authority.
pub enum QueueUploadCommittedData {
    Enqueue(JobSnapshot),
    InitialClaim(LeasedJob),
}

/// Taking the observation does not reset the private custody ledger.
#[derive(Default)]
pub struct QueueUploadCommittedObservation {
    data: Cell<Option<QueueUploadCommittedData>>,
    occupied: Cell<bool>,
}
impl QueueUploadCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<QueueUploadCommittedData> {
        self.data.take()
    }
    fn is_unused(&self) -> bool {
        !self.occupied.get()
    }
}

#[derive(Default)]
enum EnqueueLedger {
    #[default]
    Empty,
    CommittedData(JobSnapshot),
    ReleaseQualified(JobSnapshot),
}
#[derive(Default)]
enum InitialClaimLedger {
    #[default]
    Empty,
    CommittedData(LeasedJob),
    ReleaseQualified(LeasedJob),
}
struct PreparedEnqueueCommit {
    ledger: JobSnapshot,
    observation: QueueUploadCommittedData,
}
struct PreparedClaimCommit {
    ledger: LeasedJob,
    observation: QueueUploadCommittedData,
}
struct OriginalUploadCustodyBrand;

/// Private engine sink. The exact output is checked and all copies are staged
/// before COMMIT. The postcommit method only moves owned values into Cells.
pub(super) struct QueueUploadEnqueueCapture<'a> {
    request: &'a EnqueueRequest,
    scope: &'a CanonicalScope,
    config: &'a QueueConfig,
    ledger: &'a Cell<EnqueueLedger>,
    prepared: Cell<Option<PreparedEnqueueCommit>>,
    observation: &'a QueueUploadCommittedObservation,
}
impl QueueUploadEnqueueCapture<'_> {
    pub(super) fn validate_fresh(
        &self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()> {
        if request != self.request
            || scope != self.scope
            || config != self.config
            || !self.observation.is_unused()
        {
            return Err(conflict());
        }
        let current = self.ledger.take();
        let empty = matches!(current, EnqueueLedger::Empty);
        self.ledger.set(current);
        if !empty {
            return Err(conflict());
        }
        Ok(())
    }

    pub(super) fn prepare_enqueue_commit(&self, snapshot: &JobSnapshot) -> Result<()> {
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
            || snapshot.job_id.0.is_empty()
        {
            return Err(conflict());
        }
        let previous = self.prepared.take();
        if let Some(previous) = previous {
            self.prepared.set(Some(previous));
            return Err(conflict());
        }
        self.prepared.set(Some(PreparedEnqueueCommit {
            ledger: snapshot.clone(),
            observation: QueueUploadCommittedData::Enqueue(snapshot.clone()),
        }));
        Ok(())
    }

    pub(super) fn record_enqueue_committed(&self) {
        let prepared = self
            .prepared
            .take()
            .expect("original upload enqueue commit must be prepared before COMMIT");
        self.ledger
            .set(EnqueueLedger::CommittedData(prepared.ledger));
        self.observation.data.set(Some(prepared.observation));
        self.observation.occupied.set(true);
    }

    pub(super) fn record_released(&self, snapshot: &JobSnapshot) -> Result<()> {
        let current = self.ledger.take();
        match current {
            EnqueueLedger::CommittedData(committed) if &committed == snapshot => {
                self.ledger.set(EnqueueLedger::ReleaseQualified(committed));
                Ok(())
            }
            other => {
                self.ledger.set(other);
                Err(conflict())
            }
        }
    }

    fn release_qualified(&self, snapshot: &JobSnapshot) -> bool {
        let current = self.ledger.take();
        let qualified = matches!(&current, EnqueueLedger::ReleaseQualified(cut) if cut == snapshot);
        self.ledger.set(current);
        qualified
    }
}

/// Holds the actual claim ledger guard from before Store/Access entry until
/// after the bridge's Release. No mutex acquisition follows claim COMMIT.
pub(super) struct QueueUploadClaimCapture<'a> {
    snapshot: &'a JobSnapshot,
    request: &'a EnqueueRequest,
    scope: &'a CanonicalScope,
    config: &'a QueueConfig,
    ledger: MutexGuard<'a, Cell<InitialClaimLedger>>,
    prepared: Cell<Option<PreparedClaimCommit>>,
    observation: &'a QueueUploadCommittedObservation,
}
impl QueueUploadClaimCapture<'_> {
    fn ledger_empty(&self) -> bool {
        let current = self.ledger.take();
        let empty = matches!(current, InitialClaimLedger::Empty);
        self.ledger.set(current);
        empty
    }

    pub(super) fn validate_initial(
        &self,
        row: &StoredJob,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<()> {
        if now < row.created
            || config
                .admission_profile
                .never_dispatched_wait_expired(row.created, now, 0)
            || config != self.config
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
            || !self.ledger_empty()
            || !self.observation.is_unused()
        {
            return Err(conflict());
        }
        Ok(())
    }

    pub(super) fn prepare_claim_commit(&self, job: &LeasedJob) -> Result<()> {
        let now = current_now()?;
        if !self.ledger_empty()
            || !self.observation.is_unused()
            || job.lease.job_id != self.snapshot.job_id
            || job.request != *self.request
            || job.canonical_scope != *self.scope
            || job.attempt != 1
            || job.lease.fence == 0
            || job.lease.physical_identity != self.config.registration.identity
            || job.lease.owner_id != self.config.registration.dispatcher_owner_id
            || job.pending_byte_liability != self.request.pending_byte_liability
            || job.lease.expires_at <= now
        {
            return Err(conflict());
        }
        let previous = self.prepared.take();
        if let Some(previous) = previous {
            self.prepared.set(Some(previous));
            return Err(conflict());
        }
        self.prepared.set(Some(PreparedClaimCommit {
            ledger: job.clone(),
            observation: QueueUploadCommittedData::InitialClaim(job.clone()),
        }));
        Ok(())
    }

    pub(super) fn record_claim_committed(&self) {
        let prepared = self
            .prepared
            .take()
            .expect("original upload claim commit must be prepared before COMMIT");
        self.ledger
            .set(InitialClaimLedger::CommittedData(prepared.ledger));
        self.observation.data.set(Some(prepared.observation));
        self.observation.occupied.set(true);
    }

    pub(super) fn record_released(&self, job: &LeasedJob) -> Result<()> {
        let current = self.ledger.take();
        match current {
            InitialClaimLedger::CommittedData(committed) if &committed == job => {
                self.ledger
                    .set(InitialClaimLedger::ReleaseQualified(committed));
                Ok(())
            }
            other => {
                self.ledger.set(other);
                Err(conflict())
            }
        }
    }

    fn release_qualified(&self, job: &LeasedJob) -> bool {
        let current = self.ledger.take();
        let qualified = matches!(&current, InitialClaimLedger::ReleaseQualified(cut) if cut == job);
        self.ledger.set(current);
        qualified
    }
}

struct OriginalUploadEnqueueRecord {
    upload: Arc<NativeQueuedUploadOriginal>,
    store: crate::storage::QuantityInstallationStoreIdentity,
    custody: Arc<OriginalUploadCustodyBrand>,
    original: ValidatedRequest,
    config: QueueConfig,
    request: EnqueueRequest,
    scope: CanonicalScope,
    snapshot: JobSnapshot,
    claim: Mutex<Cell<InitialClaimLedger>>,
}

/// The live original admission remains borrowed while it issues its first
/// claim. An ordinary copy of its request, row or installed Media facts cannot
/// create this owner.
pub struct OriginalQueuedUploadOwner<'bundle, 'native, 'owner, 'captured, 'p> {
    preparation: &'bundle OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    record: Arc<OriginalUploadEnqueueRecord>,
}
pub enum OriginalQueuedUploadEnqueue<'bundle, 'native, 'owner, 'captured, 'p> {
    Enqueued(OriginalQueuedUploadOwner<'bundle, 'native, 'owner, 'captured, 'p>),
    RejectedBeforeDispatch { reason: AdmissionRejection },
}
pub enum OriginalQueuedUploadClaim {
    Claimed(OriginalQueuedUploadAttempt),
    Unclaimed(ClaimOutcome),
}

/// Exactly the initial claim returned through the same successful Release.
pub struct OriginalQueuedUploadAttempt {
    job: LeasedJob,
    custody: Arc<OriginalUploadCustodyBrand>,
    record: Arc<OriginalUploadEnqueueRecord>,
}
impl OriginalQueuedUploadAttempt {
    pub fn job(&self) -> &LeasedJob {
        &self.job
    }
    pub fn matches_released_upload(&self, proof: &RecordedOriginalUploadEnqueueProof) -> bool {
        Arc::ptr_eq(&self.record, &proof.record)
            && Arc::ptr_eq(&self.custody, &proof.record.custody)
            && proof.matches_released_attempt(&self.job)
    }
}

/// Detached process-local history. No live bundle, principal, grant, Access,
/// provider, Store borrow or SQL handle survives here.
pub struct RecordedOriginalUploadEnqueue(Arc<OriginalUploadEnqueueRecord>);
pub struct RecordedOriginalUploadEnqueueProof {
    record: Arc<OriginalUploadEnqueueRecord>,
}
impl RecordedOriginalUploadEnqueue {
    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        &self.0.upload
    }
    pub fn proof(&self) -> RecordedOriginalUploadEnqueueProof {
        RecordedOriginalUploadEnqueueProof {
            record: Arc::clone(&self.0),
        }
    }
}
impl RecordedOriginalUploadEnqueueProof {
    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        &self.record.upload
    }
    pub fn matches_released_attempt(&self, job: &LeasedJob) -> bool {
        let Ok(ledger) = self.record.claim.try_lock() else {
            return false;
        };
        let current = ledger.take();
        let qualified = matches!(&current, InitialClaimLedger::ReleaseQualified(cut)
            if cut == job
                && job.lease.job_id == self.record.snapshot.job_id
                && job.attempt == 1
                && job.request == self.record.request
                && job.canonical_scope == self.record.scope
                && job.lease.physical_identity == self.record.config.registration.identity);
        ledger.set(current);
        qualified
    }
}

impl OriginalEnqueueOwner for RecordedOriginalUploadEnqueue {
    type Proof = RecordedOriginalUploadEnqueueProof;

    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> Result<OriginalEnqueue<Self::Proof>> {
        let record = &self.0;
        if registration != &record.config.registration
            || receipt != &record.snapshot.receipt
            || receipt != &record.request.receipt
            || record.snapshot.partition != record.request.partition
            || original.raw() != record.original.raw()
            || original.intent_digest() != record.original.intent_digest()
            || original.id() != record.original.id()
            || original.request_id() != record.original.request_id()
            || original.context() != record.original.context()
            || original.route() != record.original.route()
            || original.is_mutation() != record.original.is_mutation()
            || !original.children().is_empty()
            || !record.original.children().is_empty()
            || record.original.raw() != record.upload.original().raw()
            || record.request != *record.upload.enqueue_request()
            || record.scope != *record.upload.canonical_scope()
            || record.config != *record.upload.queue_config()
        {
            return Err(conflict());
        }
        let proof = RecordedOriginalUploadEnqueueProof {
            record: Arc::clone(record),
        };
        record.upload.validate_original(
            &proof,
            registration,
            &record.original,
            &record.request,
            &record.scope,
        )?;
        Ok(OriginalEnqueue {
            physical_identity: registration.identity.clone(),
            original: record.original.clone(),
            expected: record.request.clone(),
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
        let record = &self.0;
        if registration != &record.config.registration
            || !Arc::ptr_eq(&proof.record, record)
            || !Arc::ptr_eq(&proof.record.custody, &record.custody)
        {
            return Err(conflict());
        }
        let ledger = record.claim.try_lock().map_err(|_| bad())?;
        let current = ledger.take();
        let qualified = match &current {
            InitialClaimLedger::ReleaseQualified(job)
                if &job.lease.job_id == job_id
                    && job.lease.fence == fence
                    && job.attempt == attempt
                    && attempt == 1
                    && job.lease.job_id == record.snapshot.job_id =>
            {
                Some(job.clone())
            }
            _ => None,
        };
        ledger.set(current);
        drop(ledger);
        let job = qualified.ok_or_else(|| {
            Error::new(
                "owner-unavailable",
                "Original upload initial claim is not release qualified",
            )
        })?;
        record.upload.validate_unprepared_attempt(
            proof,
            registration,
            &record.original,
            &record.request,
            &record.scope,
            &job,
        )?;
        Ok(job)
    }
}

fn matches_original_admission(
    preparation: &OriginalQueuedUploadAdmission<'_, '_, '_, '_, '_>,
) -> bool {
    let upload = preparation.upload_cut();
    let admission = upload.known_nonzero_admission();
    upload
        .installed_origin()
        .is_some_and(|origin| origin.matches_original(upload))
        && admission.matches_original(upload)
        && admission.pending_byte_liability() == preparation.request().pending_byte_liability
        && preparation.request().pending_byte_liability.required
        && preparation.request().pending_byte_liability.reserved_bytes
            == Some(upload.staged_upload().byte_size)
        && upload.staged_upload().byte_size > 0
        && upload.queue_config() == preparation.config()
        && upload.enqueue_request() == preparation.request()
        && upload.canonical_scope() == preparation.scope()
        && upload.original().raw() == preparation.original().raw()
        && upload.original().intent_digest() == preparation.original().intent_digest()
        && preparation.request().intent.request_digest.as_hex()
            == preparation.original().intent_digest()
        && preparation.request().receipt.actor_id
            == preparation
                .principal()
                .principal
                .principal()
                .actor_id()
                .as_str()
        && preparation.config().registration.identity == upload.queue_config().registration.identity
}

impl crate::app::Store {
    pub fn enqueue_original_upload_owned<'bundle, 'native, 'owner, 'captured, 'p>(
        &mut self,
        preparation: &'bundle OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        now: Timestamp,
        observation: &QueueUploadCommittedObservation,
    ) -> Result<OriginalQueuedUploadEnqueue<'bundle, 'native, 'owner, 'captured, 'p>> {
        if !matches_original_admission(preparation) || !observation.is_unused() {
            return Err(conflict());
        }
        let ledger = Cell::new(EnqueueLedger::Empty);
        let capture = QueueUploadEnqueueCapture {
            request: preparation.request(),
            scope: preparation.scope(),
            config: preparation.config(),
            ledger: &ledger,
            prepared: Cell::new(None),
            observation,
        };
        capture.validate_fresh(
            preparation.request(),
            preparation.scope(),
            preparation.config(),
        )?;
        let store = self.quantity_installation_store_identity();
        let outcome = self.enqueue_original_upload_inner(preparation, now, &capture)?;
        match outcome {
            EnqueueOutcome::Enqueued(snapshot) => {
                if !capture.release_qualified(&snapshot) {
                    return Err(conflict());
                }
                let record = Arc::new(OriginalUploadEnqueueRecord {
                    upload: Arc::clone(preparation.upload_cut()),
                    store,
                    custody: Arc::new(OriginalUploadCustodyBrand),
                    original: preparation.original().clone(),
                    config: preparation.config().clone(),
                    request: preparation.request().clone(),
                    scope: preparation.scope().clone(),
                    snapshot,
                    claim: Mutex::new(Cell::new(InitialClaimLedger::Empty)),
                });
                Ok(OriginalQueuedUploadEnqueue::Enqueued(
                    OriginalQueuedUploadOwner {
                        preparation,
                        record,
                    },
                ))
            }
            EnqueueOutcome::RejectedBeforeDispatch { reason } => {
                Ok(OriginalQueuedUploadEnqueue::RejectedBeforeDispatch { reason })
            }
            EnqueueOutcome::Replayed(_) => Err(conflict()),
        }
    }
}

impl<'bundle, 'native, 'owner, 'captured, 'p>
    OriginalQueuedUploadOwner<'bundle, 'native, 'owner, 'captured, 'p>
{
    pub fn snapshot(&self) -> &JobSnapshot {
        &self.record.snapshot
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.record.original
    }
    pub fn recorded(&self) -> RecordedOriginalUploadEnqueue {
        RecordedOriginalUploadEnqueue(Arc::clone(&self.record))
    }
    pub fn claim_initial(
        &mut self,
        store: &mut crate::app::Store,
        now: Timestamp,
        observation: &QueueUploadCommittedObservation,
    ) -> Result<OriginalQueuedUploadClaim> {
        let identity = store.quantity_installation_store_identity();
        if !Arc::ptr_eq(&identity.0, &self.record.store.0)
            || !Arc::ptr_eq(self.preparation.upload_cut(), &self.record.upload)
            || !matches_original_admission(self.preparation)
            || self.preparation.original().raw() != self.record.original.raw()
            || self.preparation.config() != &self.record.config
            || self.preparation.request() != &self.record.request
            || self.preparation.scope() != &self.record.scope
            || !observation.is_unused()
        {
            return Err(conflict());
        }
        let ledger = self.record.claim.try_lock().map_err(|_| bad())?;
        let capture = QueueUploadClaimCapture {
            snapshot: &self.record.snapshot,
            request: &self.record.request,
            scope: &self.record.scope,
            config: &self.record.config,
            ledger,
            prepared: Cell::new(None),
            observation,
        };
        if !capture.ledger_empty() {
            return Err(conflict());
        }
        let outcome = store.claim_original_upload_initial_inner(
            self.preparation,
            &self.record.snapshot,
            now,
            &capture,
        )?;
        match outcome {
            ClaimOutcome::Claimed(job) => {
                if !capture.release_qualified(&job) {
                    return Err(conflict());
                }
                Ok(OriginalQueuedUploadClaim::Claimed(
                    OriginalQueuedUploadAttempt {
                        job,
                        custody: Arc::clone(&self.record.custody),
                        record: Arc::clone(&self.record),
                    },
                ))
            }
            other => Ok(OriginalQueuedUploadClaim::Unclaimed(other)),
        }
    }
}
