//! Descriptor-free history of the released original enqueue, first claim and
//! native journal. This is immutable DATA and correlation, never authority.
use super::upload_journal_custody::JournalHistoryIdentity;
use super::upload_original_owner::OriginalUploadHistoryIdentity;
use super::*;
use crate::media::WorkBudget;
use std::io::Write;
use std::mem::size_of;

const MAX_HISTORY_BYTES: usize = 8 * 1024 * 1024;
const MAX_ALIASES: usize = 64;

fn unavailable() -> Error {
    Error::new(
        "owner-unavailable",
        "Released original upload history unavailable",
    )
}
fn check(budget: &WorkBudget) -> Result<()> {
    budget.check().map_err(|_| unavailable())
}

/// No constructor, Clone or serde: genuine live custody alone issues history.
pub struct ReleasedQueuedUploadOriginalHistory {
    original_identity: OriginalUploadHistoryIdentity,
    journal_identity: JournalHistoryIdentity,
    original: ValidatedRequest,
    config: QueueConfig,
    request: EnqueueRequest,
    scope: CanonicalScope,
    enqueue_snapshot: JobSnapshot,
    initial_claim: LeasedJob,
    prepared: PreparedNativeIntent,
    journal_receipt: NativeJournalReceipt,
}
impl ReleasedQueuedUploadOriginalHistory {
    pub fn capture_released_original(
        recorded: &RecordedOriginalUploadEnqueue,
        execution: &OriginalQueuedUploadExecution,
        budget: &WorkBudget,
    ) -> Result<Self> {
        check(budget)?;
        let proof = recorded.proof();
        let attempt = execution.attempt();
        let journal = execution.journal();
        if !attempt.matches_released_upload(&proof)
            || !journal.matches_attempt(attempt)
            || !Arc::ptr_eq(recorded.upload_cut(), journal.upload_cut())
            || !Arc::ptr_eq(journal.native_preparation(), execution.native_preparation())
            || journal.job() != attempt.job()
        {
            return Err(unavailable());
        }
        // This genuine token checks installed/nonzero original issuance and
        // canonical prepared DATA. It runs before either private ledger borrow:
        // its own matcher needs nonblocking access to the journal ledger.
        journal
            .native_preparation()
            .validate_prepared_journal(journal, attempt, journal.prepared(), budget)
            .map_err(|_| unavailable())?;
        check(budget)?;
        recorded.with_released_history_facts(
            attempt,
            |original, config, request, scope, snapshot, claim, original_identity| {
                journal.with_released_history_facts(
                    attempt,
                    |prepared, receipt, journal_identity| {
                        let mut tally = AllocationBudget {
                            // Three pure marker allocations, including their Arc headers.
                            bytes: size_of::<Self>() + 3 * 64,
                            budget,
                        };
                        tally.original(original)?;
                        tally.config(config)?;
                        tally.request(request)?;
                        tally.scope(scope)?;
                        tally.snapshot(snapshot)?;
                        tally.claim(claim)?;
                        tally.prepared(prepared)?;
                        tally.string(receipt.native_payload_digest.as_hex())?;
                        tally.string(receipt.journal_evidence_digest.as_hex())?;
                        // Only now may queue codecs construct bounded temporary
                        // Values. These are the existing canonical encoders.
                        config.validate().map_err(|_| unavailable())?;
                        request.validate().map_err(|_| unavailable())?;
                        if config
                            .registration
                            .resolve(&request.partition, &request.write_scope)
                            .map_err(|_| unavailable())?
                            != *scope
                            || request.intent.request_digest.as_hex() != original.intent_digest()
                            || claim.pending_byte_liability != request.pending_byte_liability
                            || prepared.storage_liability.reserved_bytes()
                                != request.pending_byte_liability.reserved_bytes
                        {
                            return Err(unavailable());
                        }
                        validate_prepared_liability(claim, &prepared.storage_liability)?;
                        bounded_json(original.raw(), budget)?;
                        bounded_json(&config_value(config), budget)?;
                        bounded_json(&request_value(request), budget)?;
                        bounded_json(&scope_value(scope), budget)?;
                        bounded_json(&leased_value(claim), budget)?;
                        let native_digest = digest(&prepared.native_payload);
                        let media_digest = digest(&prepared.prepared_media_evidence);
                        if native_digest != receipt.native_payload_digest.as_hex()
                            || journal_digest(
                                claim,
                                &prepared.codec,
                                &native_digest,
                                &media_digest,
                                &prepared.storage_liability,
                            )? != receipt.journal_evidence_digest.as_hex()
                        {
                            return Err(unavailable());
                        }
                        check(budget)?;
                        let history = Self {
                            original_identity,
                            journal_identity,
                            original: original.clone(),
                            config: config.clone(),
                            request: request.clone(),
                            scope: scope.clone(),
                            enqueue_snapshot: snapshot.clone(),
                            initial_claim: claim.clone(),
                            prepared: prepared.clone(),
                            journal_receipt: receipt.clone(),
                        };
                        check(budget)?;
                        Ok(history)
                    },
                )
            },
        )
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn config(&self) -> &QueueConfig {
        &self.config
    }
    pub fn request(&self) -> &EnqueueRequest {
        &self.request
    }
    pub fn scope(&self) -> &CanonicalScope {
        &self.scope
    }
    pub fn enqueue_snapshot(&self) -> &JobSnapshot {
        &self.enqueue_snapshot
    }
    pub fn initial_claim(&self) -> &LeasedJob {
        &self.initial_claim
    }
    pub fn prepared(&self) -> &PreparedNativeIntent {
        &self.prepared
    }
    pub fn journal_receipt(&self) -> &NativeJournalReceipt {
        &self.journal_receipt
    }
    /// Pure allocation correlation; no mutex, SQL or current permission check.
    pub fn matches_live(
        &self,
        recorded: &RecordedOriginalUploadEnqueue,
        execution: &OriginalQueuedUploadExecution,
    ) -> bool {
        self.original_identity
            .matches(recorded, execution.attempt())
            && self.journal_identity.matches(execution.journal())
    }
}

// Account for all copied heap components before cloning or constructing codec
// Values. Container overhead is conservative (including small empty members),
// and charged separately from their children. This counts allocations, never
// sums claim and journal reservations into a fabricated 2N liability.
struct AllocationBudget<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl AllocationBudget<'_> {
    fn add(&mut self, bytes: usize) -> Result<()> {
        check(self.budget)?;
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .filter(|n| *n <= MAX_HISTORY_BYTES)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<()> {
        if value.len() > MAX_METADATA_BYTES {
            return Err(unavailable());
        }
        self.add(value.len())
    }
    fn optional(&mut self, value: &Option<String>) -> Result<()> {
        if let Some(value) = value {
            self.string(value)?;
        }
        Ok(())
    }
    fn value(&mut self, value: &Value, depth: usize) -> Result<()> {
        if depth > 128 {
            return Err(unavailable());
        }
        self.add(size_of::<Value>())?;
        match value {
            Value::String(s) => self.string(s),
            Value::Number(_) => {
                // arbitrary_precision may retain a lexical numeric String.
                // Count borrowed serialization without allocating to_string().
                let mut counter = MetadataCounter {
                    bytes: 0,
                    budget: self.budget,
                };
                serde_json::to_writer(&mut counter, value).map_err(|_| unavailable())?;
                self.add(counter.bytes)
            }
            Value::Array(items) => {
                for item in items {
                    self.value(item, depth + 1)?;
                }
                Ok(())
            }
            Value::Object(items) => {
                for (key, value) in items {
                    // Generous per-entry allowance covers map nodes and keys.
                    self.add(size_of::<[usize; 8]>() + size_of::<String>())?;
                    self.string(key)?;
                    self.value(value, depth + 1)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
    fn original(&mut self, original: &ValidatedRequest) -> Result<()> {
        if !original.children().is_empty() {
            return Err(unavailable());
        }
        let start = self.bytes;
        self.value(original.raw(), 0)?;
        self.string(&original.context().workspace_id)?;
        self.string(&original.context().home_id)?;
        self.string(original.request_id())?;
        self.string(original.intent_digest())?;
        if self.bytes - start > MAX_METADATA_BYTES {
            return Err(unavailable());
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
    fn identity(&mut self, i: &PhysicalQueueIdentity) -> Result<()> {
        self.string(&i.deployment_id)?;
        self.string(&i.physical_database_id)?;
        self.string(i.configuration_digest.as_hex())
    }
    fn config(&mut self, c: &QueueConfig) -> Result<()> {
        if c.registration.aliases.len() > MAX_ALIASES {
            return Err(unavailable());
        }
        let start = self.bytes;
        self.identity(&c.registration.identity)?;
        self.string(&c.registration.dispatcher_owner_id)?;
        self.string(&c.admission_profile.profile_version)?;
        if let ProfileQualification::QualifiedDeployment { evidence_digest } =
            &c.admission_profile.qualification
        {
            self.string(evidence_digest.as_hex())?;
        }
        for a in &c.registration.aliases {
            self.add(size_of::<SourceAlias>())?;
            self.partition(&a.partition)?;
            self.string(&a.canonical_collection_id)?;
        }
        if self.bytes - start > MAX_METADATA_BYTES {
            return Err(unavailable());
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
    fn scope(&mut self, s: &CanonicalScope) -> Result<()> {
        self.string(&s.collection_id)?;
        self.selection(&s.selection)
    }
    fn request(&mut self, r: &EnqueueRequest) -> Result<()> {
        self.receipt(&r.receipt)?;
        self.partition(&r.partition)?;
        self.string(&r.intent.contract_id)?;
        self.string(&r.intent.operation_id)?;
        self.optional(&r.intent.target_external_id)?;
        self.string(r.intent.request_digest.as_hex())?;
        self.string(&r.write_scope.source_instance_id)?;
        self.string(&r.write_scope.collection_id)?;
        self.selection(&r.write_scope.selection)
    }
    fn liability(&mut self, l: &StorageLiability) -> Result<()> {
        self.optional(&l.orphan_candidate_id)
    }
    fn snapshot(&mut self, s: &JobSnapshot) -> Result<()> {
        if s.status != JobStatus::Queued
            || s.attempts != 0
            || s.body_accepted
            || s.remote_activity != RemoteActivity::NotDispatched
            || s.applied.is_some()
            || s.failure.is_some()
            || s.unknown_scope_fence_retained
        {
            return Err(unavailable());
        }
        self.string(&s.job_id.0)?;
        self.receipt(&s.receipt)?;
        self.partition(&s.partition)?;
        self.liability(&s.storage_liability)
    }
    fn claim(&mut self, j: &LeasedJob) -> Result<()> {
        self.string(&j.lease.job_id.0)?;
        self.string(&j.lease.owner_id)?;
        self.identity(&j.lease.physical_identity)?;
        self.request(&j.request)?;
        self.scope(&j.canonical_scope)
    }
    fn prepared(&mut self, p: &PreparedNativeIntent) -> Result<()> {
        if p.codec.is_empty()
            || p.codec.len() > 128
            || p.native_payload.is_empty()
            || p.native_payload.len() > MAX_METADATA_BYTES
            || p.prepared_media_evidence.len() > MAX_METADATA_BYTES
        {
            return Err(unavailable());
        }
        self.string(&p.codec)?;
        self.add(p.native_payload.len())?;
        self.add(p.prepared_media_evidence.len())?;
        self.liability(&p.storage_liability)
    }
}

// The actual WorkBudget has check(), and queue DTOs intentionally lack serde.
// Serialize only borrowed Values supplied by the genuine existing queue codecs.
struct MetadataCounter<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl Write for MetadataCounter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_METADATA_BYTES.saturating_sub(self.bytes) {
            return Err(std::io::Error::other("history metadata limit"));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn bounded_json(value: &Value, budget: &WorkBudget) -> Result<()> {
    check(budget)?;
    serde_json::to_writer(MetadataCounter { bytes: 0, budget }, value)
        .map_err(|_| unavailable())?;
    check(budget)
}
