//! Private queue finish operations.
use super::*;

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub(super) fn expire_own_waiter(&mut self, now: u64) -> Result<()> {
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Snapshot(self.receipt),
        )?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let receipt = self.receipt;
        let id:Option<String>=tx.query_row("SELECT job_id FROM queue_jobs WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",params![receipt.workspace_id,receipt.home_id,receipt.actor_id,receipt.mutation_id],|r|r.get(0)).optional()?;
        let mut expired = None;
        if let Some(id) = id {
            let row = load(&tx, &id)?;
            assert_physical(&row, &self.config)?;
            if row.attempts == 0
                && row.status == JobStatus::Queued
                && self
                    .config
                    .admission_profile
                    .never_dispatched_wait_expired(row.created, now, 0)
            {
                matches_original(self.receipt, self.original, &row, &self.config)?;
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Entry,
                    QueueAction::ExpireWaiter(&row.request),
                )?;
                tx.execute("UPDATE queue_jobs SET status='failed',updated_at=?1,next_attempt_at=NULL,failure='AdmissionWaitExpired' WHERE job_id=?2",params![decimal(now.max(row.updated)),id])?;
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Precommit,
                    QueueAction::ExpireWaiter(&row.request),
                )?;
                expired = Some(row.request);
            }
        }
        tx.commit()?;
        if let Some(request) = expired.as_ref() {
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::ExpireWaiter(request),
            )?;
        }
        Ok(())
    }
    pub(super) fn finish_evidence(
        &mut self,
        lease: &Lease,
        now: u64,
        report: &FinishReport,
        evidence: &[QueueStepEvidence],
        original_job: Option<&LeasedJob>,
    ) -> Result<JobSnapshot> {
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Snapshot(self.receipt),
        )?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = validate_lease(&tx, &self.config, lease, true)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        let job = row.leased(&self.config)?;
        let journal = load_journal_view(&tx, &job)?;
        if original_job.is_some_and(|original| original != &job) {
            return Err(stale());
        }
        if matches!(report.remote_activity, RemoteActivity::Invoked(_)) && original_job.is_none() {
            return Err(invalid());
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Finish {
                job: &job,
                report,
                journal: journal.as_ref(),
                steps: evidence,
            },
        )?;
        if !matches!(
            row.status,
            JobStatus::Running | JobStatus::NeedsReconciliation
        ) {
            return Err(stale());
        }
        if row.status == JobStatus::NeedsReconciliation
            && matches!(report.remote_activity, RemoteActivity::NotDispatched)
        {
            return Err(stale());
        }
        // Expiry can precede a first completion. After a persisted finish,
        // later observations use reconciliation instead of finishing again.
        if retained_outcomes(&tx, &job)?
            .iter()
            .any(|outcome| outcome.kind == "finish")
        {
            return Err(stale());
        }
        check_finish_evidence(report, evidence)?;
        if matches!(report.remote_activity, RemoteActivity::Invoked(_)) && journal.is_none() {
            return Err(invalid());
        }
        insert_evidence(&tx, &job, evidence)?;
        disposition(&tx, &row, now, &report.disposition, None)?;
        store_activity(&tx, &row.id, &report.remote_activity)?;
        append_liability(&tx, &row, lease.fence, "finish", &report.storage_liability)?;
        append_outcome(&tx, &job, now.max(row.updated), report, "finish", None)?;
        if matches!(
            report.remote_activity,
            RemoteActivity::NotDispatched
                | RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
        ) {
            update_active(&tx, &self.config, None, None, None)?;
        }
        let output = load(&tx, &row.id)?.snapshot();
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Finish {
                job: &job,
                report,
                journal: journal.as_ref(),
                steps: evidence,
            },
        )?;
        tx.commit()?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Release,
            QueueAction::Finish {
                job: &job,
                report,
                journal: journal.as_ref(),
                steps: evidence,
            },
        )?;
        Ok(output)
    }
    /// Explicit direct finish for a native owner that cannot share the inbox.
    /// Evidence and state still commit atomically on the same Atlas connection.
    pub fn finish_with_evidence(
        &mut self,
        job: &LeasedJob,
        now: u64,
        report: &FinishReport,
        evidence: &[QueueStepEvidence],
    ) -> Result<JobSnapshot> {
        self.finish_evidence(&job.lease, now, report, evidence, Some(job))
    }

    /// Closed upload finish engine. The input and capture can only be formed
    /// by the sealed original Source-effect adapter, never a copied report.
    pub(super) fn finish_evidence_inner_with_upload_owned(
        &mut self,
        input: &super::upload_execution_custody::QueueUploadFinishInput<'_>,
        capture: &super::upload_execution_custody::QueueUploadFinishCapture<'_, '_, '_, '_, '_>,
        owned: &dyn super::quantity_original::OwnedQuantityContext,
    ) -> Result<JobSnapshot> {
        capture.validate_session(self, input)?;
        let job = input.job();
        let report = input.report();
        let evidence = input.steps();
        let now = input.now();
        if evidence.len() > 64
            || evidence.iter().any(|step| {
                step.codec.is_empty()
                    || step.codec.len() > 128
                    || step.payload.is_empty()
                    || step.payload.len() > MAX_METADATA_BYTES
            })
        {
            return Err(invalid());
        }
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        owned.revalidate(&tx)?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Snapshot(self.receipt),
        )?;
        owned.revalidate(&tx)?;
        let row = validate_lease(&tx, &self.config, &job.lease, true)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        if row.leased(&self.config)? != *job {
            return Err(stale());
        }
        let journal = load_journal_view(&tx, job)?.ok_or_else(invalid)?;
        capture.validate_journal(job, &journal)?;
        owned.revalidate(&tx)?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Finish {
                job,
                report,
                journal: Some(&journal),
                steps: evidence,
            },
        )?;
        owned.revalidate(&tx)?;
        if !matches!(
            row.status,
            JobStatus::Running | JobStatus::NeedsReconciliation
        ) {
            return Err(stale());
        }
        let prior_finish: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM queue_outcomes WHERE job_id=?1 AND fence=?2 AND json_extract(body,'$.kind')='finish')",
            params![job.lease.job_id.0, decimal(job.lease.fence)],
            |r| r.get(0),
        )?;
        if prior_finish != 0 {
            return Err(stale());
        }
        let prior_event_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(event_id),0) FROM queue_outcomes WHERE job_id=?1 AND fence=?2",
            params![job.lease.job_id.0, decimal(job.lease.fence)],
            |r| r.get(0),
        )?;
        check_finish_evidence(report, evidence)?;
        insert_evidence(&tx, job, evidence)?;
        disposition(&tx, &row, now, &report.disposition, None)?;
        store_activity(&tx, &row.id, &report.remote_activity)?;
        append_liability(
            &tx,
            &row,
            job.lease.fence,
            "finish",
            &report.storage_liability,
        )?;
        let outcome_at = now.max(row.updated);
        append_outcome(&tx, job, outcome_at, report, "finish", None)?;
        let outcome = super::upload_execution_custody::load_new_finish_outcome(
            &tx,
            job,
            prior_event_id,
            report,
            outcome_at,
        )?;
        if matches!(
            report.remote_activity,
            RemoteActivity::NotDispatched
                | RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
        ) {
            update_active(&tx, &self.config, None, None, None)?;
        }
        let output = load(&tx, &row.id)?.snapshot();
        owned.revalidate(&tx)?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Finish {
                job,
                report,
                journal: Some(&journal),
                steps: evidence,
            },
        )?;
        owned.revalidate(&tx)?;
        capture.prepare_committed(
            input,
            &output,
            &NativeJournalReceipt {
                native_payload_digest: journal.native_payload_digest.clone(),
                journal_evidence_digest: journal.journal_evidence_digest.clone(),
            },
            outcome_at,
            outcome,
        )?;
        tx.commit()?;
        capture.record_committed();
        let release = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        owned.revalidate(&release)?;
        let successor = load(&release, &row.id)?.snapshot();
        if successor != output {
            return Err(stale());
        }
        capture.validate_successor_outcome(&release)?;
        let current_journal = load_journal_view(&release, job)?.ok_or_else(invalid)?;
        capture.validate_journal(job, &current_journal)?;
        owned.revalidate(&release)?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Release,
            QueueAction::Finish {
                job,
                report,
                journal: Some(&current_journal),
                steps: evidence,
            },
        )?;
        owned.revalidate(&release)?;
        release.commit()?;
        Ok(output)
    }
}

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub(super) fn finish_inner(
        &mut self,
        lease: &Lease,
        now: u64,
        report: &FinishReport,
    ) -> Result<JobSnapshot> {
        let evidence = {
            let pending = self.inbox.0.lock().map_err(|_| bad())?;
            pending.get(&(lease.job_id.0.clone(), lease.fence)).cloned()
        };
        let result = self.finish_evidence(
            lease,
            now,
            report,
            evidence.as_ref().map(|x| x.1.as_slice()).unwrap_or(&[]),
            evidence.as_ref().map(|x| &x.0),
        )?;
        self.inbox.consume_prefix(
            lease,
            evidence.as_ref().map(|x| x.1.as_slice()).unwrap_or(&[]),
        )?;
        Ok(result)
    }
}
