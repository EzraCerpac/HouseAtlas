//! Pure process-local validation of the exact released prepared upload cut.
//! This borrows original execution/body descriptor custody; it supplies no
//! cold-start origin, dispatch, discovery, restore or current authority. It
//! performs no filesystem/provider I/O or Access/Store callbacks and does not
//! infer that dispatch never started, remote end, or retry/resume permission.
use std::sync::Arc;

use super::{WorkBudget, native_queued_upload::NATIVE_QUEUED_UPLOAD_PREPARED_CODEC, types::sha256};
use crate::{
    domain::queue_recovery::{
        NativeRetainedEvidence, QueuedMediaRecovery, RetainedAttempt, RetainedEnqueue,
        RetainedOutcome,
    },
    storage::{self as s, OriginalQueuedUploadExecution, RecordedOriginalUploadEnqueueProof},
};

fn unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Retained prepared upload provenance is unavailable",
    )
}

/// Borrows the actual released execution and bounded work input. No Clone,
/// serde, Default, public fields or constructor from rows/bytes/digests. Root
/// must independently supply discovery authority and the full trusted registry.
pub struct NativeQueuedUploadRetainedRecovery<'a> {
    execution: &'a OriginalQueuedUploadExecution,
    budget: &'a WorkBudget,
}
impl<'a> NativeQueuedUploadRetainedRecovery<'a> {
    pub fn new(
        execution: &'a OriginalQueuedUploadExecution,
        budget: &'a WorkBudget,
    ) -> s::Result<Self> {
        let retained = Self { execution, budget };
        retained.validate_cut()?;
        Ok(retained)
    }

    fn check_budget(&self) -> s::Result<()> {
        self.budget.check().map_err(|_| unavailable())
    }

    fn validate_cut(&self) -> s::Result<()> {
        self.check_budget()?;
        let journal = self.execution.journal();
        let attempt = self.execution.attempt();
        let native = self.execution.native_preparation();
        let upload = self.execution.upload_cut();
        if !journal.matches_attempt(attempt)
            || journal.job() != attempt.job()
            || !Arc::ptr_eq(journal.native_preparation(), native)
            || !Arc::ptr_eq(journal.upload_cut(), upload)
            || !Arc::ptr_eq(native.upload_cut(), upload)
            || !native.matches_original(upload)
        {
            return Err(unavailable());
        }
        native
            .validate_prepared_journal(journal, attempt, native.prepared(), self.budget)
            .map_err(|_| unavailable())?;
        self.check_budget()
    }

    fn check_original_allocation(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        if !self
            .execution
            .attempt()
            .matches_released_upload(enqueue.original_proof)
            || !Arc::ptr_eq(
                enqueue.original_proof.upload_cut(),
                self.execution.upload_cut(),
            )
        {
            return Err(unavailable());
        }
        Ok(())
    }

    fn validate_enqueue(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.check_budget()?;
        self.check_original_allocation(enqueue)?;
        self.validate_cut()?;
        let upload = self.execution.upload_cut();
        upload.validate_original(
            enqueue.original_proof,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
        )?;
        if enqueue.config != upload.queue_config() {
            return Err(unavailable());
        }
        self.check_budget()
    }

    fn validate_frame(
        &self,
        frame: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.check_budget()?;
        // Actual original proof/cut/full-job correlation precedes all candidate
        // prepared bytes and digest comparisons. None can qualify an issuer.
        self.check_original_allocation(&frame.enqueue)?;
        let journal = self.execution.journal();
        let attempt = self.execution.attempt();
        let native = self.execution.native_preparation();
        if !journal.matches_attempt(attempt)
            || frame.job != attempt.job()
            || frame.job != journal.job()
            || !Arc::ptr_eq(journal.native_preparation(), native)
            || !Arc::ptr_eq(journal.upload_cut(), native.upload_cut())
        {
            return Err(unavailable());
        }
        self.validate_enqueue(&frame.enqueue)?;
        let (Some(prepared), Some(view)) = (frame.prepared, frame.journal) else {
            return Err(unavailable());
        };
        native
            .validate_prepared_journal(journal, attempt, prepared, self.budget)
            .map_err(|_| unavailable())?;
        self.check_budget()?;
        if view.native_codec != prepared.codec
            || view.native_payload_digest != journal.receipt().native_payload_digest
            || view.native_payload_digest.as_hex() != sha256(&prepared.native_payload)
            || view.journal_evidence_digest != journal.receipt().journal_evidence_digest
            || view.prepared_media_digest.as_hex() != sha256(&prepared.prepared_media_evidence)
            || view.prepared_liability != prepared.storage_liability
        {
            return Err(unavailable());
        }
        self.check_budget()?;
        let upload = self.execution.upload_cut();
        let admission = upload.known_nonzero_admission();
        let pending = admission.pending_byte_liability();
        if !admission.matches_original(upload)
            || !pending.required
            || pending.reserved_bytes != Some(upload.staged_upload().byte_size)
            || upload.staged_upload().byte_size == 0
            || frame.job.pending_byte_liability != pending
            || frame.enqueue.request.pending_byte_liability != pending
            || frame.liabilities.len() != 2
            || frame.liabilities[0].0 != "claim"
            || frame.liabilities[1].0 != "journal"
            || frame.liabilities[0].1 != prepared.storage_liability
            || frame.liabilities[1].1 != prepared.storage_liability
            || !frame.steps.is_empty()
            || !frame.outcomes.is_empty()
        {
            return Err(unavailable());
        }
        // The genuine decoder qualifies Complete known0/reservedN and the
        // exact NotDispatched/None/Unassessed/orphanNone/unresolved1 shape.
        // These two entries describe the same attempt reservation, not 2N.
        self.check_budget()
    }

    fn unsupported(&self) -> s::Result<()> {
        self.check_budget()?;
        self.check_budget()?;
        Err(unavailable())
    }
}

impl QueuedMediaRecovery<RecordedOriginalUploadEnqueueProof>
    for NativeQueuedUploadRetainedRecovery<'_>
{
    fn validate_original(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.validate_enqueue(enqueue)
    }

    fn validate_attempt(
        &self,
        attempt: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.validate_frame(attempt)
    }

    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.unsupported()
    }
}

impl NativeRetainedEvidence<RecordedOriginalUploadEnqueueProof>
    for NativeQueuedUploadRetainedRecovery<'_>
{
    fn native_codec(&self) -> &str {
        NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
    }

    fn step_codec(&self, _: &s::StepKind) -> Option<&str> {
        None
    }

    fn validate_prepared(
        &self,
        attempt: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.validate_frame(attempt)
    }

    fn validate_step(
        &self,
        _: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
        _: usize,
        _: &s::QueueStepEvidence,
    ) -> s::Result<()> {
        self.unsupported()
    }

    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        self.unsupported()
    }
}
