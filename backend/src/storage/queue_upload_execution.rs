//! Current transaction bridge for the SAME original installed upload admission.
//! This context is synchronous, private, and never retained across provider I/O.
use super::*;
use crate::providers::homebox::write::stock::{
    self as native, queued_upload_dispatch::CapturedQueuedUploadEffects,
};
use crate::{
    access,
    app::{
        homebox_queued_upload::{OriginalQueuedUploadPhysical, OriginalQueuedUploadPrincipal},
        homebox_queued_upload_admission::OriginalQueuedUploadAdmission,
        homebox_queued_upload_execution::QueuedUploadExecutionPhase,
    },
    media::WorkBudget,
};
use quantity_original::OwnedQuantityContext;
use upload_execution_custody::{
    OriginalQueuedUploadExecution, QueueUploadFinishCapture, QueueUploadFinishCommittedObservation,
};

fn unavailable() -> Error {
    Error::new("owner-unavailable", "Original upload execution unavailable")
}

// Only the actual sealed Source owner and held custody are borrowed. Every
// current check obtains a fresh Source view; no phase view is retained here.
struct UploadFinishSource<'phase, 'native, 'owner, 'captured, 'p> {
    effects: &'phase CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
    capture: &'phase QueueUploadFinishCapture<'phase, 'native, 'owner, 'captured, 'p>,
}

/// Reuses only the private engine context SHAPE, never quantity authority.
struct UploadExecutionContext<'phase, 'tx, 'bundle, 'native, 'owner, 'captured, 'p> {
    admission: &'phase OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
    guard: &'phase access::TransactionAuthorization<'tx>,
    identity: crate::storage::QuantityInstallationStoreIdentity,
    execution: &'phase Arc<OriginalQueuedUploadExecution>,
    finish: Option<(&'phase FinishReport, &'phase [QueueStepEvidence])>,
    finish_source: Option<UploadFinishSource<'phase, 'native, 'owner, 'captured, 'p>>,
    deadline: std::time::Instant,
    budget: &'phase WorkBudget,
}

impl UploadExecutionContext<'_, '_, '_, '_, '_, '_, '_> {
    fn clock(&self) -> Result<Timestamp> {
        self.budget.check().map_err(|_| unavailable())?;
        if std::time::Instant::now() >= self.deadline {
            return Err(unavailable());
        }
        let now = current_now()?;
        if now >= self.execution.attempt().job().lease.expires_at {
            return Err(stale());
        }
        Ok(now)
    }

    fn active(&self, db: &Connection) -> Result<()> {
        self.clock()?;
        let admission = self.admission;
        let attempt = self.execution.attempt();
        let journal = self.execution.journal();
        let native = self.execution.native_preparation();
        if !attempt.matches_original_upload(&self.identity, admission)
            || !journal.matches_attempt(attempt)
            || journal.job() != attempt.job()
            || !Arc::ptr_eq(journal.native_preparation(), native)
            || !Arc::ptr_eq(journal.upload_cut(), admission.upload_cut())
            || !Arc::ptr_eq(native.upload_cut(), admission.upload_cut())
            || !native.matches_original(admission.upload_cut())
        {
            return Err(conflict());
        }
        self.validate_queue(db)?;
        let prepared = admission.preparation();
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
        native
            .revalidate_original_phase(admission, self.guard, &physical, self.budget)
            .map_err(|_| unavailable())?;
        if let Some(source) = &self.finish_source {
            if !source.effects.matches_execution(self.execution)
                || !source.effects.matches_native(prepared.native())
            {
                return Err(conflict());
            }
            let qualification = native::FreshQualification::with_queued_upload_installation(
                self.guard,
                prepared.captured(),
                &physical,
            )
            .map_err(|_| unavailable())?;
            let view = source
                .effects
                .finish_evidence_in_guard(&qualification)
                .map_err(|_| unavailable())?;
            source.capture.validate_source_view(&view)?;
            if self.finish.is_some_and(|(report, steps)| {
                !std::ptr::eq(view.report(), report) || !std::ptr::eq(view.steps(), steps)
            }) {
                return Err(conflict());
            }
        } else if self.finish.is_some() {
            return Err(conflict());
        }
        self.validate_queue(db)?;
        self.clock()?;
        Ok(())
    }

    fn validate_queue(&self, db: &Connection) -> Result<()> {
        self.clock()?;
        let job = self.execution.attempt().job();
        let config = self.admission.config();
        let journal = self.execution.journal();
        assert_registered(db, config)?;
        let row = validate_lease(db, config, &job.lease, false)?;
        matches_original(
            &self.admission.request().receipt,
            self.admission.original(),
            &row,
            config,
        )?;
        if row.leased(config)? != *job
            || row.attempts != 1
            || !row.body_accepted
            || row.reconciliation.is_some()
        {
            return Err(stale());
        }
        let prepared = journal.prepared();
        let view = load_journal_view(db, job)?.ok_or_else(stale)?;
        type Payload = (String, Vec<u8>, Vec<u8>);
        let stored: Payload = db.query_row(
            "SELECT native_codec,native_payload,prepared_media FROM queue_journal WHERE job_id=?1 AND fence=?2",
            params![job.lease.job_id.0, decimal(job.lease.fence)],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        if stored.0 != prepared.codec
            || stored.1 != prepared.native_payload
            || stored.2 != prepared.prepared_media_evidence
            || view.native_codec != prepared.codec
            || view.native_payload_digest != journal.receipt().native_payload_digest
            || view.native_payload_digest.as_hex() != digest(&prepared.native_payload)
            || view.prepared_media_digest.as_hex() != digest(&prepared.prepared_media_evidence)
            || view.prepared_liability != prepared.storage_liability
            || view.journal_evidence_digest != journal.receipt().journal_evidence_digest
        {
            return Err(stale());
        }
        let reservation = reservation_liability(job.pending_byte_liability)?.ok_or_else(stale)?;
        let mut expected_liabilities = vec![
            ("claim".into(), reservation),
            ("journal".into(), prepared.storage_liability.clone()),
        ];
        let outcomes = retained_outcomes(db, job)?;
        let steps = retained_steps(db, job)?;
        let requires_slot = if outcomes.is_empty() {
            let claimed_at = job
                .lease
                .expires_at
                .checked_sub(config.lease_duration_ms)
                .ok_or_else(stale)?;
            if row.status != JobStatus::Running
                || row.updated != claimed_at.max(row.created)
                || row.next.is_some()
                || !row.logical
                || row.remote != RemoteActivity::Invoked(InvokedRemoteActivity::Active)
                || row.applied.is_some()
                || row.failure.is_some()
                || !steps.is_empty()
            {
                return Err(stale());
            }
            true
        } else {
            let (report, expected_steps) = self.finish.ok_or_else(stale)?;
            let outcome = &outcomes[0];
            if outcomes.len() != 1
                || outcome.kind != "finish"
                || outcome.report != *report
                || outcome.steps != expected_steps
                || steps != expected_steps
                || outcome.reconciliation.is_some()
                || row.updated != outcome.at
                || row.remote != report.remote_activity
                || !matches_finish_successor(&row, report)
            {
                return Err(stale());
            }
            expected_liabilities.push(("finish".into(), report.storage_liability.clone()));
            if outcome.liabilities != expected_liabilities {
                return Err(stale());
            }
            report.remote_activity.blocks_invocation()
        };
        if retained_liabilities(db, job)? != expected_liabilities
            || row.liability != aggregate_liability(db, &row.id)?
        {
            return Err(stale());
        }
        let (current_fence, id, fence, expires) = active(db, config)?;
        if current_fence != job.lease.fence
            || if requires_slot {
                id.as_deref() != Some(job.lease.job_id.0.as_str())
                    || fence != Some(job.lease.fence)
                    || expires != Some(job.lease.expires_at)
            } else {
                id.is_some() || fence.is_some() || expires.is_some()
            }
        {
            return Err(stale());
        }
        self.clock()?;
        Ok(())
    }
}

fn matches_finish_successor(row: &StoredJob, report: &FinishReport) -> bool {
    match &report.disposition {
        FinishDisposition::Succeeded(applied) => {
            row.status == JobStatus::Succeeded
                && row.applied.as_ref() == Some(applied)
                && row.failure.is_none()
                && row.next.is_none()
                && !row.logical
        }
        FinishDisposition::Failed(reason) => {
            row.status == JobStatus::Failed
                && row.failure.as_ref() == Some(reason)
                && row.applied.is_none()
                && row.next.is_none()
                && !row.logical
        }
        FinishDisposition::Hold(reason) => {
            row.status == JobStatus::NeedsReconciliation
                && row.failure.as_ref() == Some(reason)
                && row.applied.is_none()
                && row.next.is_none()
                && row.logical
        }
        FinishDisposition::Partial(reason) => {
            row.status == JobStatus::Partial
                && row.failure.as_ref() == Some(reason)
                && row.applied.is_none()
                && row.next.is_none()
                && row.logical
        }
        // Retry requires separately qualified remote termination and is outside
        // this one-invocation original continuation.
        FinishDisposition::RetryAt { .. } => false,
    }
}

impl OwnedQuantityContext for UploadExecutionContext<'_, '_, '_, '_, '_, '_, '_> {
    fn upload_commit_context(&self) -> Option<&dyn quantity_original::UploadCommitContext> {
        None
    }
    fn revalidate(&self, db: &Connection) -> Result<()> {
        if db.is_autocommit() {
            let tx = db.unchecked_transaction()?;
            self.active(&tx)?;
            tx.commit()?;
            self.clock()?;
            Ok(())
        } else {
            self.active(db)
        }
    }
    fn validate_fresh(
        &self,
        _: &EnqueueRequest,
        _: &CanonicalScope,
        _: &QueueConfig,
    ) -> Result<()> {
        Err(conflict())
    }
    fn validate_initial(&self, _: &StoredJob, _: &QueueConfig, _: Timestamp) -> Result<()> {
        Err(conflict())
    }
    fn enqueue_committed(&self, _: &JobSnapshot) -> Result<()> {
        Err(conflict())
    }
    fn claim_committed(&self, _: &LeasedJob) -> Result<()> {
        Err(conflict())
    }
}

pub(crate) fn current_now() -> Result<Timestamp> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| unavailable())?;
    u64::try_from(now.as_millis()).map_err(|_| unavailable())
}

struct PhaseFailure(Error);
impl From<access::AccessError> for PhaseFailure {
    fn from(error: access::AccessError) -> Self {
        Self(Error::new(
            error.code(),
            "Original upload Access unavailable",
        ))
    }
}
impl From<Error> for PhaseFailure {
    fn from(error: Error) -> Self {
        Self(error)
    }
}
impl From<rusqlite::Error> for PhaseFailure {
    fn from(error: rusqlite::Error) -> Self {
        Self(error.into())
    }
}

impl crate::app::Store {
    /// Header-only corridor. Its original execution ledger is entered before
    /// Access and remains held until the whole native wrapper has committed.
    pub(crate) fn with_original_upload_dispatch_header<
        'bundle,
        'native,
        'owner,
        'captured,
        'p,
        T,
    >(
        &mut self,
        admission: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &Arc<OriginalQueuedUploadExecution>,
        deadline: std::time::Instant,
        budget: &WorkBudget,
        operation: impl FnOnce(
            &access::TransactionAuthorization<'_>,
            &OriginalQueuedUploadPhysical<'_, 'p>,
        ) -> Result<T>,
    ) -> Result<T> {
        let capture = execution.enter_dispatch(self, admission)?;
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(&boundary, admission.preparation().configured().access()) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        let mut receipt = None;
        boundary
            .with_mutation_authorization(admission.principal().principal.principal(), |guard| {
                let context = UploadExecutionContext {
                    admission,
                    guard,
                    identity,
                    execution,
                    finish: None,
                    finish_source: None,
                    deadline,
                    budget,
                };
                context.revalidate(&self.db)?;
                let authority = QueuedUploadExecutionPhase::new(admission, execution, guard, None)?;
                let config = admission.config().clone();
                config.validate().map_err(|_| invalid())?;
                let mut session = QueueSession {
                    store: self,
                    config,
                    receipt: &admission.request().receipt,
                    original: admission.original(),
                    principal: admission.principal(),
                    witness: admission,
                    authority: &authority,
                    inbox: QueueEvidenceInbox::default(),
                };
                receipt = Some(session.authorize_dispatch_inner_with_upload_owned(
                    execution.attempt().job(),
                    current_now()?,
                    &capture,
                    &context,
                )?);
                drop(session);
                let phase = self.db.unchecked_transaction()?;
                context.active(&phase)?;
                let prepared = admission.preparation();
                let configured = prepared.configured();
                let source = prepared.native().source();
                let original = OriginalQueuedUploadPrincipal::from_captured(
                    configured,
                    prepared.captured(),
                    source.original_source(),
                    source.original_partition(),
                )?;
                {
                    let transaction = crate::storage::observe_quantity_installation_in_transaction(
                        &phase,
                        &context.identity,
                        &original,
                        guard,
                        configured.queue(),
                        configured.physical(),
                    )?;
                    let physical = OriginalQueuedUploadPhysical::from_activity_transaction(
                        configured,
                        &transaction,
                        guard,
                    )?;
                    admission.revalidate_phase(guard, &physical)?;
                    output = Some(operation(guard, &physical)?);
                    admission.revalidate_phase(guard, &physical)?;
                }
                context.active(&phase)?;
                phase.commit()?;
                let release = self.db.unchecked_transaction()?;
                context.active(&release)?;
                release.commit()?;
                Ok::<(), PhaseFailure>(())
            })
            .map_err(|error| error.0)?;
        if std::time::Instant::now() >= deadline
            || current_now()? >= execution.attempt().job().lease.expires_at
        {
            return Err(stale());
        }
        budget.check().map_err(|_| unavailable())?;
        capture.record_dispatch_released(&receipt.ok_or_else(unavailable)?)?;
        output.ok_or_else(unavailable)
    }

    /// Private bounded phase implementation. Only closed Body/Header/Readback
    /// methods call this; the callback cannot supply an authority decision.
    pub(crate) fn with_original_upload_execution_phase<
        'bundle,
        'native,
        'owner,
        'captured,
        'p,
        T,
    >(
        &mut self,
        admission: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &Arc<OriginalQueuedUploadExecution>,
        deadline: std::time::Instant,
        budget: &WorkBudget,
        operation: impl FnOnce(
            &access::TransactionAuthorization<'_>,
            &OriginalQueuedUploadPhysical<'_, 'p>,
        ) -> Result<T>,
    ) -> Result<T> {
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(&boundary, admission.preparation().configured().access()) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(admission.principal().principal.principal(), |guard| {
                let context = UploadExecutionContext {
                    admission,
                    guard,
                    identity,
                    execution,
                    finish: None,
                    finish_source: None,
                    deadline,
                    budget,
                };
                let authority = QueuedUploadExecutionPhase::new(admission, execution, guard, None)?;
                let phase = self.db.unchecked_transaction()?;
                context.active(&phase)?;
                let job = execution.attempt().job();
                let journal = load_journal_view(&phase, job)?.ok_or_else(stale)?;
                authorize_session(
                    &authority,
                    admission.principal(),
                    admission,
                    admission.original(),
                    &admission.request().receipt,
                    QueuePhase::Entry,
                    QueueAction::Dispatch {
                        job,
                        journal: &journal,
                        now: current_now()?,
                    },
                )?;
                let prepared = admission.preparation();
                let configured = prepared.configured();
                let source = prepared.native().source();
                let original = OriginalQueuedUploadPrincipal::from_captured(
                    configured,
                    prepared.captured(),
                    source.original_source(),
                    source.original_partition(),
                )?;
                {
                    let transaction = crate::storage::observe_quantity_installation_in_transaction(
                        &phase,
                        &context.identity,
                        &original,
                        guard,
                        configured.queue(),
                        configured.physical(),
                    )?;
                    let physical = OriginalQueuedUploadPhysical::from_activity_transaction(
                        configured,
                        &transaction,
                        guard,
                    )?;
                    admission.revalidate_phase(guard, &physical)?;
                    output = Some(operation(guard, &physical)?);
                    admission.revalidate_phase(guard, &physical)?;
                }
                context.active(&phase)?;
                authorize_session(
                    &authority,
                    admission.principal(),
                    admission,
                    admission.original(),
                    &admission.request().receipt,
                    QueuePhase::Precommit,
                    QueueAction::Dispatch {
                        job,
                        journal: &journal,
                        now: current_now()?,
                    },
                )?;
                context.active(&phase)?;
                phase.commit()?;
                let release = self.db.unchecked_transaction()?;
                context.active(&release)?;
                let released_journal = load_journal_view(&release, job)?.ok_or_else(stale)?;
                authorize_session(
                    &authority,
                    admission.principal(),
                    admission,
                    admission.original(),
                    &admission.request().receipt,
                    QueuePhase::Release,
                    QueueAction::Dispatch {
                        job,
                        journal: &released_journal,
                        now: current_now()?,
                    },
                )?;
                context.active(&release)?;
                release.commit()?;
                Ok::<(), PhaseFailure>(())
            })
            .map_err(|error| error.0)?;
        if std::time::Instant::now() >= deadline
            || current_now()? >= execution.attempt().job().lease.expires_at
        {
            return Err(stale());
        }
        budget.check().map_err(|_| unavailable())?;
        output.ok_or_else(unavailable)
    }

    pub(crate) fn queued_upload_check_readback<'bundle, 'native, 'owner, 'captured, 'p>(
        &mut self,
        admission: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &Arc<OriginalQueuedUploadExecution>,
        deadline: std::time::Instant,
        budget: &WorkBudget,
    ) -> Result<()> {
        self.with_original_upload_execution_phase(admission, execution, deadline, budget, |_, _| {
            Ok(())
        })
    }
    pub(crate) fn queued_upload_finish_owned<'bundle, 'native, 'owner, 'captured, 'p>(
        &mut self,
        admission: &OriginalQueuedUploadAdmission<'bundle, 'native, 'owner, 'captured, 'p>,
        execution: &Arc<OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'native, 'owner, 'captured, 'p>,
        observation: &QueueUploadFinishCommittedObservation,
        deadline: std::time::Instant,
        budget: &WorkBudget,
    ) -> Result<JobSnapshot> {
        // The custody gate and ledger are held before Access is acquired.
        let capture =
            QueueUploadFinishCapture::new(self, admission, execution, effects, observation)?;
        let boundary = Arc::clone(&self.configured_authorization().0);
        if !Arc::ptr_eq(&boundary, admission.preparation().configured().access()) {
            return Err(unavailable());
        }
        let identity = self.quantity_installation_store_identity();
        let mut boundary = boundary.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        boundary
            .with_mutation_authorization(admission.principal().principal.principal(), |guard| {
                let initial = UploadExecutionContext {
                    admission,
                    guard,
                    identity: identity.clone(),
                    execution,
                    finish: None,
                    finish_source: Some(UploadFinishSource {
                        effects,
                        capture: &capture,
                    }),
                    deadline,
                    budget,
                };
                let phase = self.db.unchecked_transaction()?;
                initial.active(&phase)?;
                let prepared = admission.preparation();
                let configured = prepared.configured();
                let source = prepared.native().source();
                let original = OriginalQueuedUploadPrincipal::from_captured(
                    configured,
                    prepared.captured(),
                    source.original_source(),
                    source.original_partition(),
                )?;
                let view = {
                    let transaction = crate::storage::observe_quantity_installation_in_transaction(
                        &phase,
                        &identity,
                        &original,
                        guard,
                        configured.queue(),
                        configured.physical(),
                    )?;
                    let physical = OriginalQueuedUploadPhysical::from_activity_transaction(
                        configured,
                        &transaction,
                        guard,
                    )?;
                    admission.revalidate_phase(guard, &physical)?;
                    let qualification =
                        native::FreshQualification::with_queued_upload_installation(
                            guard,
                            prepared.captured(),
                            &physical,
                        )
                        .map_err(|_| unavailable())?;
                    let view = effects
                        .finish_evidence_in_guard(&qualification)
                        .map_err(|_| unavailable())?;
                    capture.validate_source_view(&view)?;
                    admission.revalidate_phase(guard, &physical)?;
                    view
                };
                initial.active(&phase)?;
                phase.commit()?;
                let finish = Some((view.report(), view.steps()));
                let context = UploadExecutionContext {
                    admission,
                    guard,
                    identity,
                    execution,
                    finish,
                    finish_source: Some(UploadFinishSource {
                        effects,
                        capture: &capture,
                    }),
                    deadline,
                    budget,
                };
                context.revalidate(&self.db)?;
                let authority =
                    QueuedUploadExecutionPhase::new(admission, execution, guard, finish)?;
                let config = admission.config().clone();
                config.validate().map_err(|_| invalid())?;
                let mut session = QueueSession {
                    store: self,
                    config,
                    receipt: &admission.request().receipt,
                    original: admission.original(),
                    principal: admission.principal(),
                    witness: admission,
                    authority: &authority,
                    inbox: QueueEvidenceInbox::default(),
                };
                let input = capture.input(current_now()?);
                output = Some(
                    session.finish_evidence_inner_with_upload_owned(&input, &capture, &context)?,
                );
                drop(session);
                let release = self.db.unchecked_transaction()?;
                context.active(&release)?;
                capture.validate_successor_outcome(&release)?;
                release.commit()?;
                Ok::<(), PhaseFailure>(())
            })
            .map_err(|error| error.0)?;
        if std::time::Instant::now() >= deadline
            || current_now()? >= execution.attempt().job().lease.expires_at
        {
            return Err(stale());
        }
        budget.check().map_err(|_| unavailable())?;
        let output = output.ok_or_else(unavailable)?;
        capture.record_released(&output)?;
        Ok(output)
    }
}
