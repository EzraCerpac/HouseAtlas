//! Private queue resolution operations.
use super::*;

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub(super) fn reconcile_inner(
        &mut self,
        lease: &Lease,
        now: u64,
        evidence: &ReconciliationEvidence,
        value: &FinishDisposition,
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
        let row = validate_lease(&tx, &self.config, lease, false)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        let RemoteActivity::Invoked(remote_activity) = row.remote.clone() else {
            return Err(invalid());
        };
        let held = HeldJob {
            lease: lease.clone(),
            request: row.request.clone(),
            attempt: row.attempts,
            remote_activity,
        };
        let steps = self.authority.reconciliation_steps(
            self.principal,
            self.witness,
            self.original,
            &held,
            evidence,
            value,
        )?;
        check_disposition_evidence(value, &steps)?;
        if matches!(value, FinishDisposition::Failed(_))
            && !steps.iter().any(|e| e.kind == StepKind::PositiveNoEffect)
        {
            return Err(invalid());
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Reconcile {
                job: &held,
                evidence,
                disposition: value,
                steps: &steps,
            },
        )?;
        if !row.logical
            || !matches!(
                row.status,
                JobStatus::NeedsReconciliation | JobStatus::Partial
            )
            || evidence.private_evidence_reference.is_empty()
            || matches!(
                value,
                FinishDisposition::Hold(_) | FinishDisposition::Partial(_)
            )
        {
            return Err(invalid());
        }
        if matches!(value, FinishDisposition::RetryAt { .. })
            && (!matches!(
                row.remote,
                RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
            ) || !matches!(evidence.kind, ReconciliationKind::CurrentStateObserved))
        {
            return Err(invalid());
        }
        insert_evidence(&tx, &row.leased(&self.config)?, &steps)?;
        let reconciliation = json!({"reference":evidence.private_evidence_reference,
            "digest":evidence.evidence_digest.as_hex(),"kind":format!("{:?}",evidence.kind)});
        let marker = QueueStepEvidence {
            kind: StepKind::Reconciliation,
            codec: "houseatlas-reconciliation/1".into(),
            payload: encoded(&reconciliation)?.into_bytes(),
            response_digest: None,
            readback_digest: None,
            termination_digest: None,
        };
        insert_evidence(
            &tx,
            &row.leased(&self.config)?,
            std::slice::from_ref(&marker),
        )?;
        let resolved_report = FinishReport {
            disposition: value.clone(),
            remote_activity: row.remote.clone(),
            storage_liability: row.liability.clone(),
        };
        append_outcome(
            &tx,
            &row.leased(&self.config)?,
            now.max(row.updated),
            &resolved_report,
            "reconcile",
            Some(reconciliation),
        )?;
        disposition(&tx, &row, now, value, Some(evidence))?;
        let out = load(&tx, &row.id)?.snapshot();
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Reconcile {
                job: &held,
                evidence,
                disposition: value,
                steps: &steps,
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
            QueueAction::Reconcile {
                job: &held,
                evidence,
                disposition: value,
                steps: &steps,
            },
        )?;
        Ok(out)
    }
    pub(super) fn prove_remote_end_inner(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: u64,
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
        let row = validate_lease(&tx, &self.config, &evidence.lease, false)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        let job = row.leased(&self.config)?;
        let journal = load_journal_view(&tx, &job)?.ok_or_else(invalid)?;
        let step = self.authority.remote_end_step(
            self.principal,
            self.witness,
            self.original,
            evidence,
            &job,
            &journal,
        )?;
        if step.kind != StepKind::RemoteEnd
            || step.termination_digest.as_ref() != Some(&evidence.termination_evidence_digest)
        {
            return Err(invalid());
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::RemoteEnd {
                evidence,
                job: &job,
                journal: &journal,
                step: &step,
            },
        )?;
        if row.status == JobStatus::Running || !matches!(row.remote, RemoteActivity::Invoked(_)) {
            return Err(invalid());
        }
        if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) = &row.remote
        {
            if termination_evidence_digest != &evidence.termination_evidence_digest {
                return Err(conflict());
            }
            let out = row.snapshot();
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Precommit,
                QueueAction::RemoteEnd {
                    evidence,
                    job: &job,
                    journal: &journal,
                    step: &step,
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
                QueueAction::RemoteEnd {
                    evidence,
                    job: &job,
                    journal: &journal,
                    step: &step,
                },
            )?;
            return Ok(out);
        }
        insert_evidence(&tx, &job, std::slice::from_ref(&step))?;
        store_activity(
            &tx,
            &row.id,
            &RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
                termination_evidence_digest: evidence.termination_evidence_digest.clone(),
            }),
        )?;
        tx.execute(
            "UPDATE queue_jobs SET updated_at=?1 WHERE job_id=?2",
            params![decimal(now.max(row.updated)), row.id],
        )?;
        let (_, active_id, active_fence, _) = active(&tx, &self.config)?;
        if active_id.as_deref() == Some(&row.id) && active_fence == Some(evidence.lease.fence) {
            update_active(&tx, &self.config, None, None, None)?;
        }
        let out = load(&tx, &row.id)?.snapshot();
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::RemoteEnd {
                evidence,
                job: &job,
                journal: &journal,
                step: &step,
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
            QueueAction::RemoteEnd {
                evidence,
                job: &job,
                journal: &journal,
                step: &step,
            },
        )?;
        Ok(out)
    }
}
