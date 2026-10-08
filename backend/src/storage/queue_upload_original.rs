//! Private genuine installed upload phases. The shared queue engine receives a
//! distinct upload context, never quantity source evidence or copied custody.
use super::*;
use crate::{
    access,
    app::{
        homebox_queued_upload::{OriginalQueuedUploadPhysical, OriginalQueuedUploadPrincipal},
        homebox_queued_upload_admission::{
            OriginalQueuedUploadAdmission, QueuedUploadAdmissionPhase,
        },
    },
};
use quantity_original::{OwnedQuantityContext, UploadCommitContext};
use std::cell::{Cell, RefCell};
use upload_original_owner::{QueueUploadClaimCapture, QueueUploadEnqueueCapture};

fn unavailable() -> Error {
    Error::new(
        "owner-unavailable",
        "Current original upload phase unavailable",
    )
}
enum PhaseFailure {
    Access(access::AccessError),
    Storage(Error),
}
impl From<access::AccessError> for PhaseFailure {
    fn from(e: access::AccessError) -> Self {
        Self::Access(e)
    }
}
impl From<Error> for PhaseFailure {
    fn from(e: Error) -> Self {
        Self::Storage(e)
    }
}
impl From<rusqlite::Error> for PhaseFailure {
    fn from(e: rusqlite::Error) -> Self {
        Self::Storage(e.into())
    }
}
impl PhaseFailure {
    fn storage(self) -> Error {
        match self {
            Self::Storage(e) => e,
            Self::Access(e) => Error::new(e.code(), "Original upload Access fence unavailable"),
        }
    }
}
enum Capture<'phase, 'capture> {
    Enqueue(&'phase QueueUploadEnqueueCapture<'capture>),
    Claim(&'phase QueueUploadClaimCapture<'capture>),
}
enum ExpectedCommit {
    Enqueue(JobSnapshot),
    Claim(LeasedJob),
}
struct UploadContext<'phase, 'capture, 'tx, 'bundle, 'native, 'owner, 'captured, 'p> {
    preparation: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    identity: crate::storage::QuantityInstallationStoreIdentity,
    capture: Capture<'phase, 'capture>,
    initial: Option<&'phase JobSnapshot>,
    expected: RefCell<Option<ExpectedCommit>>,
    committed: Cell<bool>,
}
impl UploadContext<'_, '_, '_, '_, '_, '_, '_, '_> {
    fn active(&self, db: &Connection) -> Result<()> {
        let prepared = self.preparation.preparation();
        let configured = prepared.configured();
        let source = prepared.native().source();
        let original = OriginalQueuedUploadPrincipal::from_captured(
            configured,
            prepared.captured(),
            source.original_source(),
            source.original_partition(),
        )?;
        let transaction = crate::storage::observe_quantity_installation_in_transaction(
            db,
            &self.identity,
            &original,
            self.guard,
            configured.queue(),
            configured.physical(),
        )?;
        let physical = OriginalQueuedUploadPhysical::from_activity_transaction(
            configured,
            &transaction,
            self.guard,
        )?;
        self.preparation.revalidate_phase(self.guard, &physical)?;
        if self.committed.get() {
            self.validate_successor(db)?;
        }
        Ok(())
    }
    // The remembered cut is staged before COMMIT and becomes observable only
    // after the engine's actual COMMIT. Release reads the same SQL successor,
    // including the physical active slot for the first claim.
    fn validate_successor(&self, db: &Connection) -> Result<()> {
        let expected = self.expected.borrow();
        let config = self.preparation.config();
        let row = match expected.as_ref().ok_or_else(conflict)? {
            ExpectedCommit::Enqueue(snapshot) => {
                let row = load(db, &snapshot.job_id.0)?;
                if row.snapshot() != *snapshot
                    || row.lease_fence.is_some()
                    || row.lease_owner.is_some()
                    || row.lease_expires.is_some()
                    || row.liability != zero_liability()
                {
                    return Err(stale());
                }
                let count: i64 = db.query_row(
                    "SELECT COUNT(*) FROM queue_attempts WHERE job_id=?1",
                    [&row.id],
                    |r| r.get(0),
                )?;
                if count != 0 {
                    return Err(stale());
                }
                row
            }
            ExpectedCommit::Claim(job) => {
                let row = validate_job(db, config, job)?;
                let initial = self.initial.ok_or_else(conflict)?;
                let (_, id, fence, expires) = active(db, config)?;
                let claimed_at = job
                    .lease
                    .expires_at
                    .checked_sub(config.lease_duration_ms)
                    .ok_or_else(stale)?;
                let reservation =
                    reservation_liability(job.pending_byte_liability)?.ok_or_else(stale)?;
                if id.as_deref() != Some(job.lease.job_id.0.as_str())
                    || fence != Some(job.lease.fence)
                    || expires != Some(job.lease.expires_at)
                    || current_now()? >= job.lease.expires_at
                    || row.status != JobStatus::Running
                    || row.attempts != 1
                    || row.created != initial.created_at
                    || row.updated != claimed_at.max(initial.updated_at)
                    || row.next.is_some()
                    || !row.body_accepted
                    || !row.logical
                    || row.remote != RemoteActivity::Invoked(InvokedRemoteActivity::Active)
                    || row.applied.is_some()
                    || row.failure.is_some()
                    || row.reconciliation.is_some()
                    || row.liability != reservation
                    || load_journal_view(db, job)?.is_some()
                    || !retained_outcomes(db, job)?.is_empty()
                    || !retained_steps(db, job)?.is_empty()
                    || retained_liabilities(db, job)? != vec![("claim".into(), reservation)]
                {
                    return Err(stale());
                }
                row
            }
        };
        assert_physical(&row, config)?;
        if row.request != *self.preparation.request()
            || row.scope != *self.preparation.scope()
            || row.original_json != encoded(self.preparation.original().raw())?
        {
            return Err(stale());
        }
        Ok(())
    }
}
impl UploadCommitContext for UploadContext<'_, '_, '_, '_, '_, '_, '_, '_> {
    fn prepare_enqueue_commit(&self, snapshot: &JobSnapshot) -> Result<()> {
        match self.capture {
            Capture::Enqueue(c) => {
                if self.expected.borrow().is_some() || self.committed.get() {
                    return Err(conflict());
                }
                let expected = ExpectedCommit::Enqueue(snapshot.clone());
                c.prepare_enqueue_commit(snapshot)?;
                *self.expected.borrow_mut() = Some(expected);
                Ok(())
            }
            Capture::Claim(_) => Err(conflict()),
        }
    }
    fn record_enqueue_committed(&self) {
        if let Capture::Enqueue(c) = self.capture {
            c.record_enqueue_committed();
            self.committed.set(true);
        }
    }
    fn prepare_claim_commit(&self, job: &LeasedJob) -> Result<()> {
        match self.capture {
            Capture::Claim(c) => {
                if self.expected.borrow().is_some() || self.committed.get() {
                    return Err(conflict());
                }
                let expected = ExpectedCommit::Claim(job.clone());
                c.prepare_claim_commit(job)?;
                *self.expected.borrow_mut() = Some(expected);
                Ok(())
            }
            Capture::Enqueue(_) => Err(conflict()),
        }
    }
    fn record_claim_committed(&self) {
        if let Capture::Claim(c) = self.capture {
            c.record_claim_committed();
            self.committed.set(true);
        }
    }
}
impl OwnedQuantityContext for UploadContext<'_, '_, '_, '_, '_, '_, '_, '_> {
    fn upload_commit_context(&self) -> Option<&dyn UploadCommitContext> {
        Some(self)
    }
    fn revalidate(&self, db: &Connection) -> Result<()> {
        if db.is_autocommit() {
            let tx = db.unchecked_transaction()?;
            self.active(&tx)?;
            tx.commit()?;
            Ok(())
        } else {
            self.active(db)
        }
    }
    fn validate_fresh(
        &self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()> {
        match self.capture {
            Capture::Enqueue(c) => c.validate_fresh(request, scope, config),
            Capture::Claim(_) => Err(conflict()),
        }
    }
    fn validate_initial(
        &self,
        row: &StoredJob,
        config: &QueueConfig,
        _now: Timestamp,
    ) -> Result<()> {
        let now = current_now()?;
        if now < row.created
            || config
                .admission_profile
                .never_dispatched_wait_expired(row.created, now, 0)
        {
            return Err(stale());
        }
        match self.capture {
            Capture::Claim(c) => c.validate_initial(row, config, now),
            Capture::Enqueue(_) => Err(conflict()),
        }
    }
    // Upload always selects the prebuilt infallible seam; the legacy quantity
    // observer is intentionally unavailable for this concrete implementation.
    fn enqueue_committed(&self, _: &JobSnapshot) -> Result<()> {
        Err(conflict())
    }
    fn claim_committed(&self, _: &LeasedJob) -> Result<()> {
        Err(conflict())
    }
}
fn current_now() -> Result<Timestamp> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| unavailable())?;
    u64::try_from(now.as_millis()).map_err(|_| unavailable())
}
impl crate::app::Store {
    pub(super) fn enqueue_original_upload_inner<'bundle, 'native, 'owner, 'captured, 'p>(
        &mut self,
        preparation: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        _now: Timestamp,
        capture: &QueueUploadEnqueueCapture<'_>,
    ) -> Result<EnqueueOutcome> {
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(&boundary, preparation.preparation().configured().access()) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(preparation.principal().principal.principal(), |guard| {
                let context = UploadContext {
                    preparation,
                    guard,
                    identity,
                    capture: Capture::Enqueue(capture),
                    initial: None,
                    expected: RefCell::new(None),
                    committed: Cell::new(false),
                };
                context.revalidate(&self.db)?;
                let authority = QueuedUploadAdmissionPhase::new(preparation, guard, None)?;
                let config = preparation.config().clone();
                let mut session = self.queue_session(
                    config.clone(),
                    QueueSessionBinding {
                        receipt: &preparation.request().receipt,
                        original: preparation.original(),
                        principal: preparation.principal(),
                        witness: preparation,
                    },
                    &authority,
                    QueueEvidenceInbox::default(),
                )?;
                output = Some(session.enqueue_inner_with_owned(
                    preparation.request(),
                    preparation.scope(),
                    &config,
                    current_now()?,
                    Some(&context),
                )?);
                Ok::<(), PhaseFailure>(())
            })
            .map_err(PhaseFailure::storage)?;
        let output = output.ok_or_else(unavailable)?;
        if let EnqueueOutcome::Enqueued(snapshot) = &output {
            capture.record_released(snapshot)?;
        }
        Ok(output)
    }
    pub(super) fn claim_original_upload_initial_inner<'bundle, 'native, 'owner, 'captured, 'p>(
        &mut self,
        preparation: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        expected: &JobSnapshot,
        _now: Timestamp,
        capture: &QueueUploadClaimCapture<'_>,
    ) -> Result<ClaimOutcome> {
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(&boundary, preparation.preparation().configured().access()) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(preparation.principal().principal.principal(), |guard| {
                let context = UploadContext {
                    preparation,
                    guard,
                    identity,
                    capture: Capture::Claim(capture),
                    initial: Some(expected),
                    expected: RefCell::new(None),
                    committed: Cell::new(false),
                };
                context.revalidate(&self.db)?;
                let tx = self
                    .db
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                context.revalidate(&tx)?;
                let row = load(&tx, &expected.job_id.0)?;
                context.validate_initial(&row, preparation.config(), current_now()?)?;
                tx.commit()?;
                let authority =
                    QueuedUploadAdmissionPhase::new(preparation, guard, Some(expected))?;
                let config = preparation.config().clone();
                let mut session = self.queue_session(
                    config.clone(),
                    QueueSessionBinding {
                        receipt: &preparation.request().receipt,
                        original: preparation.original(),
                        principal: preparation.principal(),
                        witness: preparation,
                    },
                    &authority,
                    QueueEvidenceInbox::default(),
                )?;
                output = Some(session.claim_next_inner_with_owned(
                    current_now()?,
                    &config,
                    Some((&context, expected)),
                )?);
                Ok::<(), PhaseFailure>(())
            })
            .map_err(PhaseFailure::storage)?;
        let output = output.ok_or_else(unavailable)?;
        if let ClaimOutcome::Claimed(job) = &output {
            if current_now()? >= job.lease.expires_at {
                return Err(stale());
            }
            capture.record_released(job)?;
        }
        Ok(output)
    }
}
