//! Private queue journal operations.
use super::*;

impl<C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>>
    QueueSession<'_, C, A, R, Q>
{
    pub fn evidence_inbox(&self) -> QueueEvidenceInbox {
        self.inbox.clone()
    }
    /// Recheck current original authority immediately before the native owner
    /// creates a qualified invocation. This does not invoke the provider.
    pub fn authorize_dispatch(
        &mut self,
        job: &LeasedJob,
        now: Timestamp,
    ) -> Result<NativeJournalReceipt> {
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Entry,
            QueueAction::Lease(&job.lease),
        )?;
        let tx = self.store.db.transaction()?;
        let row = validate_job(&tx, &self.config, job)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        if row.status != JobStatus::Running || now >= job.lease.expires_at {
            return Err(stale());
        }
        let journal = load_journal_view(&tx, job)?.ok_or_else(invalid)?;
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Dispatch {
                job,
                journal: &journal,
                now,
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
            QueueAction::Dispatch {
                job,
                journal: &journal,
                now,
            },
        )?;
        Ok(NativeJournalReceipt {
            native_payload_digest: journal.native_payload_digest,
            journal_evidence_digest: journal.journal_evidence_digest,
        })
    }
    pub fn commit_native(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
    ) -> Result<NativeJournalReceipt> {
        self.commit_native_inner_with_owned(job, prepared, None, None)
    }

    pub(super) fn commit_native_inner_with_owned(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        capture: Option<&super::journal_custody::QueueOriginalJournalCapture<'_>>,
        owned: Option<&dyn super::quantity_original::OwnedQuantityContext>,
    ) -> Result<NativeJournalReceipt> {
        self.commit_native_inner_with_custody(job, prepared, capture, None, owned)
    }

    pub(super) fn commit_native_inner_with_upload_owned(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        capture: &super::upload_journal_custody::QueueUploadJournalCapture<'_>,
        owned: &dyn super::quantity_original::OwnedQuantityContext,
    ) -> Result<NativeJournalReceipt> {
        self.commit_native_inner_with_custody(job, prepared, None, Some(capture), Some(owned))
    }

    fn commit_native_inner_with_custody(
        &mut self,
        job: &LeasedJob,
        prepared: &PreparedNativeIntent,
        capture: Option<&super::journal_custody::QueueOriginalJournalCapture<'_>>,
        upload_capture: Option<&super::upload_journal_custody::QueueUploadJournalCapture<'_>>,
        owned: Option<&dyn super::quantity_original::OwnedQuantityContext>,
    ) -> Result<NativeJournalReceipt> {
        if (capture.is_some() as u8 + upload_capture.is_some() as u8) != owned.is_some() as u8 {
            return Err(conflict());
        }
        if let Some(capture) = capture {
            capture.validate_session(self, job, prepared)?;
        }
        if let Some(capture) = upload_capture {
            capture.validate_session(self, job, prepared)?;
        }
        if prepared.codec.is_empty()
            || prepared.codec.len() > 128
            || prepared.native_payload.is_empty()
            || prepared.native_payload.len() > MAX_METADATA_BYTES
            || prepared.prepared_media_evidence.len() > MAX_METADATA_BYTES
        {
            return Err(invalid());
        }
        if owned.is_none() {
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Entry,
                QueueAction::Journal(job, prepared),
            )?;
        }
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(owned) = owned {
            owned.revalidate(&tx)?;
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Entry,
                QueueAction::Journal(job, prepared),
            )?;
            owned.revalidate(&tx)?;
        }
        let row = validate_job(&tx, &self.config, job)?;
        matches_original(self.receipt, self.original, &row, &self.config)?;
        validate_prepared_liability(job, &prepared.storage_liability)?;
        if row.status != JobStatus::Running {
            return Err(stale());
        }
        let native = digest(&prepared.native_payload);
        let media = digest(&prepared.prepared_media_evidence);
        let journal = journal_digest(
            job,
            &prepared.codec,
            &native,
            &media,
            &prepared.storage_liability,
        )?;
        type JournalRow = (String, String, String, String, String, Vec<u8>, Vec<u8>);
        let existing:Option<JournalRow>=tx.query_row(
            "SELECT native_codec,native_payload_digest,prepared_media_digest,prepared_liability_json,journal_evidence_digest,native_payload,prepared_media FROM queue_journal WHERE job_id=?1 AND fence=?2",
            params![job.lease.job_id.0,decimal(job.lease.fence)],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
        let new_journal = existing.is_none();
        if (capture.is_some() || upload_capture.is_some()) && !new_journal {
            return Err(conflict());
        }
        if let Some((codec, n, m, l, j, np, pm)) = existing {
            if (codec, n, m, l, j, np, pm)
                != (
                    prepared.codec.clone(),
                    native.clone(),
                    media.clone(),
                    encoded(&liability_value(&prepared.storage_liability))?,
                    journal.clone(),
                    prepared.native_payload.clone(),
                    prepared.prepared_media_evidence.clone(),
                )
            {
                return Err(conflict());
            }
        } else {
            tx.execute(
                "INSERT INTO queue_journal VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    job.lease.job_id.0,
                    decimal(job.lease.fence),
                    prepared.codec,
                    prepared.native_payload,
                    native,
                    prepared.prepared_media_evidence,
                    media,
                    encoded(&liability_value(&prepared.storage_liability))?,
                    journal
                ],
            )?;
        }
        if new_journal {
            append_liability(
                &tx,
                &row,
                job.lease.fence,
                "journal",
                &prepared.storage_liability,
            )?;
        }
        let receipt = if capture.is_some() || upload_capture.is_some() {
            Some(NativeJournalReceipt {
                native_payload_digest: Digest::from_hex(native.clone()).map_err(|_| bad())?,
                journal_evidence_digest: Digest::from_hex(journal.clone()).map_err(|_| bad())?,
            })
        } else {
            None
        };
        if let Some(owned) = owned {
            owned.revalidate(&tx)?;
        }
        authorize_session(
            self.authority,
            self.principal,
            self.witness,
            self.original,
            self.receipt,
            QueuePhase::Precommit,
            QueueAction::Journal(job, prepared),
        )?;
        if let Some(owned) = owned {
            owned.revalidate(&tx)?;
        }
        if let Some(capture) = upload_capture {
            capture.prepare_committed(job, prepared, receipt.as_ref().ok_or_else(bad)?)?;
        }
        tx.commit()?;
        if let Some(capture) = upload_capture {
            capture.record_committed();
        }
        if let Some(capture) = capture {
            capture.record_committed(job, prepared, receipt.as_ref().ok_or_else(bad)?)?;
        }
        if let Some(owned) = owned {
            let release = self
                .store
                .db
                .transaction_with_behavior(TransactionBehavior::Deferred)?;
            owned.revalidate(&release)?;
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Journal(job, prepared),
            )?;
            owned.revalidate(&release)?;
            release.commit()?;
        } else {
            authorize_session(
                self.authority,
                self.principal,
                self.witness,
                self.original,
                self.receipt,
                QueuePhase::Release,
                QueueAction::Journal(job, prepared),
            )?;
        }
        match receipt {
            Some(receipt) => Ok(receipt),
            None => Ok(NativeJournalReceipt {
                native_payload_digest: Digest::from_hex(native).map_err(|_| bad())?,
                journal_evidence_digest: Digest::from_hex(journal).map_err(|_| bad())?,
            }),
        }
    }
}
