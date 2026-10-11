//! Descriptor-free facts of one original upload Finish after full Access Release.
//! Private marker correlation does not authorize transport, replay or cold start.
use super::upload_journal_custody::JournalHistoryIdentity;
use super::upload_original_owner::OriginalUploadHistoryIdentity;
use super::*;
use crate::media::WorkBudget;
use crate::providers::homebox::write::stock::queued_upload_dispatch::{
    CapturedQueuedUploadEffects, PendingReadbackIdentity, QueuedUploadEffectsIdentity,
};
use std::mem::size_of;

const MAX_FINISH_HISTORY_BYTES: usize = 8 * 1024 * 1024;

/// Pure identity minted only by the actual precommit Finish capture.
pub(crate) struct QueuedUploadFinishHistoryIdentity {
    _private: (),
}
impl QueuedUploadFinishHistoryIdentity {
    pub(super) fn new() -> Self {
        Self { _private: () }
    }
}

/// Owned bounded DATA and pure accepted identities. No live owner is retained.
pub struct ReleasedQueuedUploadFinishHistory {
    original_identity: OriginalUploadHistoryIdentity,
    journal_identity: JournalHistoryIdentity,
    finish_identity: Arc<QueuedUploadFinishHistoryIdentity>,
    effects_identity: Arc<QueuedUploadEffectsIdentity>,
    qualified_readback_identity: Option<Arc<PendingReadbackIdentity>>,
    job: LeasedJob,
    report: FinishReport,
    steps: Vec<QueueStepEvidence>,
    snapshot: JobSnapshot,
    journal_receipt: NativeJournalReceipt,
    outcome_event_id: i64,
    outcome_body: String,
    outcome_digest: String,
    outcome_at: Timestamp,
    outcome_codec_version: u32,
}

fn unavailable() -> Error {
    Error::new(
        "owner-unavailable",
        "Released original upload Finish history unavailable",
    )
}
fn check(budget: &WorkBudget) -> Result<()> {
    budget.check().map_err(|_| unavailable())
}

impl ReleasedQueuedUploadFinishHistory {
    pub fn capture_released_finish(
        recorded: &RecordedOriginalUploadEnqueue,
        execution: &Arc<OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'_, '_, '_, '_>,
        original: &ReleasedQueuedUploadOriginalHistory,
        budget: &WorkBudget,
    ) -> Result<Self> {
        check(budget)?;
        let attempt = execution.attempt();
        let journal = execution.journal();
        if !original.matches_live(recorded, execution)
            || !effects.matches_execution(execution)
            || !attempt.matches_released_upload(&recorded.proof())
            || !journal.matches_attempt(attempt)
            || !Arc::ptr_eq(recorded.upload_cut(), execution.upload_cut())
        {
            return Err(unavailable());
        }
        journal
            .native_preparation()
            .validate_prepared_journal(journal, attempt, original.prepared(), budget)
            .map_err(|_| unavailable())?;
        // Existing helpers lend actual release-qualified identities. None of
        // their original/native facts is cloned into this Finish cut.
        recorded.with_released_history_facts(attempt, |_, _, _, _, _, claim, original_identity| {
            journal.with_released_history_facts(attempt, |_, receipt, journal_identity| {
                execution.with_released_finish_history_facts(effects, |data| {
                    if data.job() != claim
                        || data.journal_receipt().native_payload_digest
                            != receipt.native_payload_digest
                        || data.journal_receipt().journal_evidence_digest
                            != receipt.journal_evidence_digest
                    {
                        return Err(unavailable());
                    }
                    let mut tally = AllocationBudget {
                        bytes: size_of::<Self>() + 6 * 64,
                        budget,
                    };
                    tally.claim(data.job())?;
                    tally.report(data.report())?;
                    tally.snapshot(data.snapshot())?;
                    tally.steps(data.steps())?;
                    tally.string(data.journal_receipt().native_payload_digest.as_hex())?;
                    tally.string(data.journal_receipt().journal_evidence_digest.as_hex())?;
                    tally.string(data.outcome().body())?;
                    tally.string(data.outcome().digest())?;
                    // The exact outcome was captured in the original SQL
                    // transaction. Its body preserves ordered event cuts;
                    // no later row or synthesized outcome is consulted.
                    if data.outcome().event_id() <= 0
                        || data.outcome().codec_version() != 1
                        || data.outcome().digest() != digest(data.outcome().body().as_bytes())
                    {
                        return Err(unavailable());
                    }
                    check(budget)?;
                    let result = Self {
                        original_identity,
                        journal_identity,
                        finish_identity: Arc::clone(data.finish_identity()),
                        effects_identity: Arc::clone(data.effects_identity()),
                        qualified_readback_identity: data
                            .qualified_readback_identity()
                            .map(Arc::clone),
                        job: data.job().clone(),
                        report: data.report().clone(),
                        steps: data.steps().to_vec(),
                        snapshot: data.snapshot().clone(),
                        journal_receipt: data.journal_receipt().clone(),
                        outcome_event_id: data.outcome().event_id(),
                        outcome_body: data.outcome().body().to_owned(),
                        outcome_digest: data.outcome().digest().to_owned(),
                        outcome_at: data.outcome_at(),
                        outcome_codec_version: data.outcome().codec_version(),
                    };
                    check(budget)?;
                    Ok(result)
                })
            })
        })
    }
    pub fn job(&self) -> &LeasedJob {
        &self.job
    }
    pub fn report(&self) -> &FinishReport {
        &self.report
    }
    pub fn steps(&self) -> &[QueueStepEvidence] {
        &self.steps
    }
    pub fn snapshot(&self) -> &JobSnapshot {
        &self.snapshot
    }
    pub fn journal_receipt(&self) -> &NativeJournalReceipt {
        &self.journal_receipt
    }
    pub fn outcome_event_id(&self) -> i64 {
        self.outcome_event_id
    }
    pub fn outcome_body(&self) -> &str {
        &self.outcome_body
    }
    pub fn outcome_digest(&self) -> &str {
        &self.outcome_digest
    }
    pub fn outcome_at(&self) -> Timestamp {
        self.outcome_at
    }
    pub fn outcome_codec_version(&self) -> u32 {
        self.outcome_codec_version
    }
    pub(crate) fn finish_identity(&self) -> &Arc<QueuedUploadFinishHistoryIdentity> {
        &self.finish_identity
    }
    pub(crate) fn effects_identity(&self) -> &Arc<QueuedUploadEffectsIdentity> {
        &self.effects_identity
    }
    pub(crate) fn qualified_readback_identity(&self) -> Option<&Arc<PendingReadbackIdentity>> {
        self.qualified_readback_identity.as_ref()
    }
    /// Only immutable issuer correlations, never locks or current permission.
    pub fn matches_live(
        &self,
        recorded: &RecordedOriginalUploadEnqueue,
        execution: &Arc<OriginalQueuedUploadExecution>,
        effects: &CapturedQueuedUploadEffects<'_, '_, '_, '_>,
    ) -> bool {
        self.original_identity
            .matches(recorded, execution.attempt())
            && self.journal_identity.matches(execution.journal())
            && execution.matches_finish_history_identity(&self.finish_identity)
            && effects.matches_execution(execution)
            && Arc::ptr_eq(effects.historical_identity(), &self.effects_identity)
            && effects
                .matches_qualified_readback_identity(self.qualified_readback_identity.as_ref())
    }
}

// Count every copied heap component before cloning. Scalar enum fields do not
// allocate; strings/digests, containers and duplicate report/snapshot fields do.
struct AllocationBudget<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl AllocationBudget<'_> {
    fn add(&mut self, n: usize) -> Result<()> {
        check(self.budget)?;
        self.bytes = self
            .bytes
            .checked_add(n)
            .filter(|n| *n <= MAX_FINISH_HISTORY_BYTES)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn string(&mut self, s: &str) -> Result<()> {
        if s.len() > MAX_METADATA_BYTES {
            return Err(unavailable());
        }
        self.add(s.len())
    }
    fn optional(&mut self, s: &Option<String>) -> Result<()> {
        if let Some(s) = s {
            self.string(s)?;
        }
        Ok(())
    }
    fn partition(&mut self, p: &SourcePartition) -> Result<()> {
        for s in [
            &p.workspace_id,
            &p.home_id,
            &p.source_instance_id,
            &p.collection_id,
        ] {
            self.string(s)?;
        }
        Ok(())
    }
    fn receipt(&mut self, r: &ReceiptKey) -> Result<()> {
        for s in [&r.workspace_id, &r.home_id, &r.actor_id, &r.mutation_id] {
            self.string(s)?;
        }
        Ok(())
    }
    fn selection(&mut self, s: &ScopeSelection) -> Result<()> {
        if let ScopeSelection::Resources(items) = s {
            if items.len() > 1000 {
                return Err(unavailable());
            }
            for item in items {
                self.add(size_of::<ResourceRef>())?;
                self.string(&item.id)?;
            }
        }
        Ok(())
    }
    fn claim(&mut self, j: &LeasedJob) -> Result<()> {
        self.string(&j.lease.job_id.0)?;
        self.string(&j.lease.owner_id)?;
        self.string(&j.lease.physical_identity.deployment_id)?;
        self.string(&j.lease.physical_identity.physical_database_id)?;
        self.string(j.lease.physical_identity.configuration_digest.as_hex())?;
        let r = &j.request;
        self.receipt(&r.receipt)?;
        self.partition(&r.partition)?;
        self.string(&r.intent.contract_id)?;
        self.string(&r.intent.operation_id)?;
        self.optional(&r.intent.target_external_id)?;
        self.string(r.intent.request_digest.as_hex())?;
        self.string(&r.write_scope.source_instance_id)?;
        self.string(&r.write_scope.collection_id)?;
        self.selection(&r.write_scope.selection)?;
        self.string(&j.canonical_scope.collection_id)?;
        self.selection(&j.canonical_scope.selection)
    }
    fn liability(&mut self, l: &StorageLiability) -> Result<()> {
        self.optional(&l.orphan_candidate_id)
    }
    fn activity(&mut self, a: &RemoteActivity) -> Result<()> {
        if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) = a
        {
            self.string(termination_evidence_digest.as_hex())?;
        }
        Ok(())
    }
    fn applied(&mut self, a: &AppliedWrite) -> Result<()> {
        self.optional(&a.external_id)?;
        self.optional(&a.source_updated_at)?;
        self.string(a.observation.response_digest.as_hex())?;
        self.string(a.observation.readback_digest.as_hex())
    }
    fn report(&mut self, r: &FinishReport) -> Result<()> {
        if let FinishDisposition::Succeeded(a) = &r.disposition {
            self.applied(a)?;
        }
        self.activity(&r.remote_activity)?;
        self.liability(&r.storage_liability)
    }
    fn snapshot(&mut self, s: &JobSnapshot) -> Result<()> {
        self.string(&s.job_id.0)?;
        self.receipt(&s.receipt)?;
        self.partition(&s.partition)?;
        if let Some(a) = &s.applied {
            self.applied(a)?;
        }
        self.activity(&s.remote_activity)?;
        self.liability(&s.storage_liability)
    }
    fn steps(&mut self, steps: &[QueueStepEvidence]) -> Result<()> {
        if steps.len() > 64 {
            return Err(unavailable());
        }
        for s in steps {
            if s.codec.is_empty()
                || s.codec.len() > 128
                || s.payload.is_empty()
                || s.payload.len() > MAX_METADATA_BYTES
            {
                return Err(unavailable());
            }
            self.add(size_of::<QueueStepEvidence>())?;
            self.string(&s.codec)?;
            self.add(s.payload.len())?;
            for digest in [
                &s.response_digest,
                &s.readback_digest,
                &s.termination_digest,
            ]
            .into_iter()
            .flatten()
            {
                self.string(digest.as_hex())?;
            }
        }
        Ok(())
    }
}
