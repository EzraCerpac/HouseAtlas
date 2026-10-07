//! Private queue queries operations.
use super::*;

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub(super) fn snapshot_inner(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>> {
        if receipt != self.receipt {
            return Err(invalid());
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Snapshot(receipt),
        )?;
        let tx = self.store.db.transaction()?;
        let id:Option<String>=tx.query_row("SELECT job_id FROM queue_jobs WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",params![receipt.workspace_id,receipt.home_id,receipt.actor_id,receipt.mutation_id],|r|r.get(0)).optional()?;
        let out = id
            .map(|id| -> Result<_> {
                let row = load(&tx, &id)?;
                matches_original(self.receipt, self.original, &row, &self.config)?;
                Ok(row.snapshot())
            })
            .transpose()?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Snapshot(receipt),
        )?;
        tx.commit()?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Release,
            QueueAction::Snapshot(receipt),
        )?;
        Ok(out)
    }
    pub(super) fn held_job_inner(&mut self) -> Result<Option<HeldJob>> {
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Snapshot(self.receipt),
        )?;
        let tx = self.store.db.transaction()?;
        let mut out = None;
        for id in all_ids(&tx, &self.config)? {
            let row = load(&tx, &id)?;
            if row.request.receipt == *self.receipt
                && row.logical
                && matches!(
                    row.status,
                    JobStatus::NeedsReconciliation | JobStatus::Partial
                )
            {
                matches_original(self.receipt, self.original, &row, &self.config)?;
                let RemoteActivity::Invoked(remote_activity) = row.remote.clone() else {
                    return Err(bad());
                };
                let job = HeldJob {
                    lease: row.lease(&self.config)?,
                    request: row.request,
                    attempt: row.attempts,
                    remote_activity,
                };
                authorize_session(
                    self.authority,
                    self.principal,
                    self.witness,
                    self.original,
                    self.receipt,
                    QueuePhase::Entry,
                    QueueAction::Held(&job),
                )?;
                out = Some(job);
                break;
            }
        }
        if let Some(job) = out.as_ref() {
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Precommit,
                QueueAction::Held(job),
            )?;
        }
        tx.commit()?;
        if let Some(job) = out.as_ref() {
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Held(job),
            )?;
        }
        Ok(out)
    }
}
