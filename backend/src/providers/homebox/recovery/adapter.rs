use super::{codec::*, *};
use crate::{
    domain::queue_recovery::{NativeRetainedEvidence, RetainedAttempt, RetainedOutcome},
    storage,
};

/// Borrow the native shared contracts and independently retained original writer
/// records. There is no provider/storage handle, dispatch/recovery grant, image
/// fallback, SQL reentry or reconstructed access principal in this adapter.
pub struct HomeboxRetainedEvidence<'a> {
    contracts: &'a NativeWriterContracts,
    archive: &'a RetainedWriterArchive,
    version: CodecVersion,
}
impl<'a> HomeboxRetainedEvidence<'a> {
    pub fn new(contracts: &'a NativeWriterContracts, archive: &'a RetainedWriterArchive) -> Self {
        Self {
            contracts,
            archive,
            version: CodecVersion::V1,
        }
    }
    /// Trusted host selection, never a codec version taken from image data.
    pub fn new_v2(
        contracts: &'a NativeWriterContracts,
        archive: &'a RetainedWriterArchive,
    ) -> Self {
        Self {
            contracts,
            archive,
            version: CodecVersion::V2,
        }
    }
    fn attempt<P>(
        &self,
        attempt: &RetainedAttempt<'_, P>,
    ) -> storage::Result<&RetainedWriterAttempt> {
        let record = self.archive.find(attempt.job)?;
        if record.version != self.version {
            return Err(unavailable());
        }
        if record.config != *attempt.enqueue.config
            || record.job.request != *attempt.enqueue.request
            || record.job.canonical_scope != *attempt.enqueue.scope
            || encode(&record.baseline.command.original_wire)?
                != encode(attempt.enqueue.original.raw())?
        {
            return Err(incompatible());
        }
        record.validate_origin(self.contracts)?;
        let prepared = attempt.prepared.ok_or_else(unavailable)?;
        let journal = attempt.journal.ok_or_else(unavailable)?;
        let _: PreparedPacket = decode(&prepared.native_payload)?;
        if prepared != &record.prepared
            || prepared.codec != self.version.native()
            || journal.native_codec != self.version.native()
            || journal.native_payload_digest.as_hex() != raw_digest(&prepared.native_payload)
            || journal.prepared_media_digest.as_hex()
                != raw_digest(&prepared.prepared_media_evidence)
            || journal.prepared_liability != prepared.storage_liability
        {
            return Err(incompatible());
        }
        Ok(record)
    }
}
impl<P> NativeRetainedEvidence<P> for HomeboxRetainedEvidence<'_> {
    fn native_codec(&self) -> &str {
        self.version.native()
    }
    fn step_codec(&self, kind: &storage::StepKind) -> Option<&str> {
        match kind {
            storage::StepKind::ResponseReadback => Some(self.version.readback()),
            storage::StepKind::RemoteEnd => Some(self.version.remote_end()),
            storage::StepKind::PositiveNoEffect => Some(self.version.never_invoked()),
            storage::StepKind::Reconciliation | storage::StepKind::Other => None,
        }
    }
    fn validate_prepared(&self, attempt: &RetainedAttempt<'_, P>) -> storage::Result<()> {
        let record = self.attempt(attempt)?;
        // Independent records cover the complete attempt, not just the latest
        // response or outcome. Storage/domain call us once for every attempt.
        if attempt.steps != record.steps
            || attempt.outcomes.len() != record.outcomes.len()
            || attempt
                .outcomes
                .last()
                .is_some_and(|last| last.liabilities != attempt.liabilities)
        {
            return Err(incompatible());
        }
        record.reconstruct(self.contracts, record.steps.len())?;
        Ok(())
    }
    fn validate_step(
        &self,
        attempt: &RetainedAttempt<'_, P>,
        index: usize,
        step: &storage::QueueStepEvidence,
    ) -> storage::Result<()> {
        let record = self.attempt(attempt)?;
        let packet: StepPacket = decode(&step.payload)?;
        if attempt.steps.get(index) != Some(step)
            || record.steps.get(index) != Some(step)
            || packet.prepared_sha256 != raw_digest(&record.prepared.native_payload)
            || packet.sequence != index.to_string()
            || <Self as NativeRetainedEvidence<P>>::step_codec(self, &step.kind)
                != Some(step.codec.as_str())
            || packet.format != step.codec
        {
            return Err(incompatible());
        }
        record.reconstruct(
            self.contracts,
            index.checked_add(1).ok_or_else(incompatible)?,
        )?;
        Ok(())
    }
    fn validate_outcome(&self, frame: &RetainedOutcome<'_, '_, P>) -> storage::Result<()> {
        let record = self.archive.find(frame.job)?;
        if record.version != self.version {
            return Err(unavailable());
        }
        let retained = record.outcomes.get(frame.index).ok_or_else(unavailable)?;
        let cut = frame.outcome;
        let prepared = frame.prepared.ok_or_else(unavailable)?;
        let journal = frame.journal.ok_or_else(unavailable)?;
        if record.config != *frame.enqueue.config
            || record.job.request != *frame.enqueue.request
            || record.job.canonical_scope != *frame.enqueue.scope
            || encode(&record.baseline.command.original_wire)?
                != encode(frame.enqueue.original.raw())?
            || prepared != &record.prepared
            || prepared.codec != self.version.native()
            || journal.native_codec != self.version.native()
            || journal.native_payload_digest.as_hex() != raw_digest(&prepared.native_payload)
            || journal.prepared_media_digest.as_hex()
                != raw_digest(&prepared.prepared_media_evidence)
            || journal.prepared_liability != prepared.storage_liability
        {
            return Err(incompatible());
        }
        if cut.kind != "finish" || cut.reconciliation.is_some() {
            return Err(unavailable());
        }
        if cut.at != retained.at
            || cut.report != &retained.report
            || cut.steps.len() != retained.step_count
            || record.steps.get(..cut.steps.len()) != Some(cut.steps)
            || cut.liabilities != retained.liabilities
            || frame.index != 0
            || frame.previous.is_some()
            || frame.added_steps != cut.steps
        {
            return Err(incompatible());
        }
        // Reconstruct from this cut alone. A later remote-end tail in the
        // complete record must never qualify this earlier finish report.
        record.validate_report(self.contracts, cut.report, cut.steps.len())
    }
}
