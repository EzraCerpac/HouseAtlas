use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueConfig {
    pub lease_duration_ms: u64,
    pub retry: RetryPolicy,
    pub registration: QueueRegistration,
    pub admission_profile: AdmissionProfile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvalidConfig {
    ZeroLease,
    ZeroAttempts,
    InvalidBackoff,
    QueuePolicy(InvalidQueuePolicy),
}

impl QueueConfig {
    pub fn validate(&self) -> Result<(), InvalidConfig> {
        self.registration
            .validate()
            .map_err(InvalidConfig::QueuePolicy)?;
        self.admission_profile
            .validate()
            .map_err(InvalidConfig::QueuePolicy)?;
        if self.lease_duration_ms == 0 {
            return Err(InvalidConfig::ZeroLease);
        }
        if self.retry.max_attempts == 0 {
            return Err(InvalidConfig::ZeroAttempts);
        }
        if self.retry.initial_delay_ms == 0 || self.retry.initial_delay_ms > self.retry.max_delay_ms
        {
            return Err(InvalidConfig::InvalidBackoff);
        }
        Ok(())
    }
}

impl RetryPolicy {
    /// Retry only a positively known NotApplied outcome. Overflow or the attempt
    /// budget ends in a terminal failure rather than scheduling unsafe work.
    pub fn classify(
        &self,
        attempt: u32,
        now: Timestamp,
        outcome: WriteOutcome,
    ) -> FinishDisposition {
        match outcome {
            WriteOutcome::Applied(applied) => FinishDisposition::Succeeded(applied),
            WriteOutcome::Uncertain { reason } => FinishDisposition::Hold(reason),
            WriteOutcome::Partial { reason } => FinishDisposition::Partial(reason),
            WriteOutcome::NotApplied { reason, replay } => {
                if replay != ReplayPermission::AfterBackoff || attempt >= self.max_attempts {
                    return FinishDisposition::Failed(reason);
                }
                let exponent = attempt.saturating_sub(1).min(63);
                let delay = self
                    .initial_delay_ms
                    .saturating_mul(1_u64 << exponent)
                    .min(self.max_delay_ms);
                match now.checked_add(delay) {
                    Some(at) => FinishDisposition::RetryAt { at, reason },
                    None => FinishDisposition::Failed(reason),
                }
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum QueueError<E> {
    InvalidRequest(InvalidRequest),
    InvalidTime,
    InvalidReconciliationEvidence,
    QueuePolicy(InvalidQueuePolicy),
    Store(E),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchOutcome {
    Idle,
    Busy { expires_at: Timestamp },
    HeldForReconciliation(JobSnapshot),
    Finished(JobSnapshot),
    Waiting { reason: QueueWaitReason },
    RejectedBeforeDispatch { reason: AdmissionRejection },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReconcileOutcome {
    NothingHeld,
    StillHeld,
    Resolved(Box<JobSnapshot>),
}

/// Owns mutable ports. A synchronous &mut borrow covers claim, physical dispatch
/// and finish; a caller cannot dispatch twice through this component at once.
/// Different instances still require the store's one atomic durable global slot.
pub struct WriteQueue<S, W> {
    store: S,
    writer: W,
    config: QueueConfig,
}

impl<S: QueueStore, W: HomeBoxWriter> WriteQueue<S, W> {
    pub fn new(store: S, writer: W, config: QueueConfig) -> Result<Self, InvalidConfig> {
        config.validate()?;
        Ok(Self {
            store,
            writer,
            config,
        })
    }

    /// Call only after domain authorization and full prepared-contract checks.
    pub fn enqueue(
        &mut self,
        request: &EnqueueRequest,
        now: Timestamp,
    ) -> Result<EnqueueOutcome, QueueError<S::Error>> {
        request.validate().map_err(QueueError::InvalidRequest)?;
        let scope = self
            .config
            .registration
            .resolve(&request.partition, &request.write_scope)
            .map_err(QueueError::QueuePolicy)?;
        self.store
            .enqueue(request, &scope, &self.config, now)
            .map_err(QueueError::Store)
    }

    /// Authorization is required before this receipt lookup and any replay.
    pub fn snapshot(
        &mut self,
        receipt: &ReceiptKey,
    ) -> Result<Option<JobSnapshot>, QueueError<S::Error>> {
        self.store.snapshot(receipt).map_err(QueueError::Store)
    }

    /// Trusted caller supplies both clocks. The completion clock is read only
    /// after the synchronous writer returns; no listener or scheduler is started.
    pub fn dispatch_next(
        &mut self,
        now: Timestamp,
        completed_at: impl FnOnce() -> Timestamp,
    ) -> Result<DispatchOutcome, QueueError<S::Error>> {
        now.checked_add(self.config.lease_duration_ms)
            .ok_or(QueueError::InvalidTime)?;
        let claim = self
            .store
            .claim_next(now, &self.config)
            .map_err(QueueError::Store)?;
        let job = match claim {
            ClaimOutcome::Idle => return Ok(DispatchOutcome::Idle),
            ClaimOutcome::Busy { expires_at } => {
                return Ok(DispatchOutcome::Busy { expires_at });
            }
            ClaimOutcome::HeldForReconciliation(snapshot) => {
                return Ok(DispatchOutcome::HeldForReconciliation(snapshot));
            }
            ClaimOutcome::Claimed(job) => job,
            ClaimOutcome::Waiting { reason } => return Ok(DispatchOutcome::Waiting { reason }),
            ClaimOutcome::RejectedBeforeDispatch { reason } => {
                return Ok(DispatchOutcome::RejectedBeforeDispatch { reason });
            }
        };
        let result = self.writer.write(&job);
        // An invalid clock cannot release a running row or cause a blind retry.
        let finish_at = completed_at();
        if finish_at < now {
            return Err(QueueError::InvalidTime);
        }
        let report = match result {
            DispatchReport::NotInvoked {
                reason,
                storage_liability,
            } => FinishReport {
                disposition: FinishDisposition::Failed(reason),
                remote_activity: RemoteActivity::NotDispatched,
                storage_liability,
            },
            DispatchReport::Invoked(InvocationReport {
                outcome,
                remote_activity,
                storage_liability,
            }) => {
                let disposition = if matches!(outcome, WriteOutcome::NotApplied { .. })
                    && !matches!(remote_activity, InvokedRemoteActivity::EndedProven { .. })
                {
                    FinishDisposition::Hold(FailureCode::OutcomeUnknown)
                } else {
                    self.config.retry.classify(job.attempt, finish_at, outcome)
                };
                FinishReport {
                    disposition,
                    remote_activity: RemoteActivity::Invoked(remote_activity),
                    storage_liability,
                }
            }
        };
        self.store
            .finish(&job.lease, finish_at, &report)
            .map(DispatchOutcome::Finished)
            .map_err(QueueError::Store)
    }

    /// Explicit qualified recovery. This never calls the writer. Missing or
    /// uncertain evidence retains logical scope fences. Physical remote activity
    /// and storage liabilities are preserved regardless of logical resolution.
    pub fn reconcile_held<R: HomeBoxReconciler>(
        &mut self,
        reconciler: &mut R,
        now: Timestamp,
        completed_at: impl FnOnce() -> Timestamp,
    ) -> Result<ReconcileOutcome, QueueError<S::Error>> {
        let Some(job) = self.store.held_job().map_err(QueueError::Store)? else {
            return Ok(ReconcileOutcome::NothingHeld);
        };
        let outcome = reconciler.reconcile(&job);
        let finish_at = completed_at();
        if finish_at < now {
            return Err(QueueError::InvalidTime);
        }
        let (evidence, outcome) = match outcome {
            ReconciliationOutcome::StillUncertain => return Ok(ReconcileOutcome::StillHeld),
            ReconciliationOutcome::Applied { evidence, applied } => {
                (evidence, WriteOutcome::Applied(applied))
            }
            ReconciliationOutcome::NotApplied {
                evidence,
                reason,
                replay,
            } => {
                let replay = if matches!(
                    job.remote_activity,
                    InvokedRemoteActivity::EndedProven { .. }
                ) {
                    replay
                } else {
                    ReplayPermission::Never
                };
                (evidence, WriteOutcome::NotApplied { reason, replay })
            }
        };
        if evidence.private_evidence_reference.is_empty() {
            return Err(QueueError::InvalidReconciliationEvidence);
        }
        let disposition = self.config.retry.classify(job.attempt, finish_at, outcome);
        self.store
            .reconcile(&job.lease, finish_at, &evidence, &disposition)
            .map(|snapshot| ReconcileOutcome::Resolved(Box::new(snapshot)))
            .map_err(QueueError::Store)
    }

    /// Correlated termination changes only remote activity and physical admission.
    /// It does not reconcile effects, release orphan liability or resend work.
    pub fn prove_remote_end(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: Timestamp,
    ) -> Result<JobSnapshot, QueueError<S::Error>> {
        if evidence.lease.physical_identity != self.config.registration.identity {
            return Err(QueueError::QueuePolicy(InvalidQueuePolicy::WrongQueue));
        }
        self.store
            .prove_remote_end(evidence, now)
            .map_err(QueueError::Store)
    }

    /// Return owned ports for controlled shutdown or application composition.
    pub fn into_parts(self) -> (S, W) {
        (self.store, self.writer)
    }
}
