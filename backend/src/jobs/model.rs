//! Internal typed queue values; these are not a new published HTTP contract.

/// UTC milliseconds supplied by the trusted application clock.
pub type Timestamp = u64;

/// Preserve the complete registered partition, including opaque collection case.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourcePartition {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
}

/// Server-derived actor scope. Authorization must precede lookup and replay.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptKey {
    pub workspace_id: String,
    pub home_id: String,
    pub actor_id: String,
    pub mutation_id: String,
}

/// Owned, already reviewed payload supplied by the future wire3 preparation port.
///
/// Contract and operation identifiers are exact reviewed identifiers, not URLs or
/// an invented provider dialect. Equality includes every payload byte. Payloads
/// must contain no credentials. No generic JSON parsing or merge occurs here.
#[derive(Clone, PartialEq, Eq)]
pub struct PreparedWrite {
    pub contract_id: String,
    pub operation_id: String,
    pub target_external_id: Option<String>,
    pub payload: Vec<u8>,
}

impl std::fmt::Debug for PreparedWrite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedWrite")
            .field("contract_id", &self.contract_id)
            .field("operation_id", &self.operation_id)
            .field("target_external_id", &self.target_external_id)
            .field("payload_bytes", &self.payload.len())
            .finish()
    }
}

/// Complete durable idempotency content. Storage binds it atomically to the key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnqueueRequest {
    pub receipt: ReceiptKey,
    pub partition: SourcePartition,
    pub prepared: PreparedWrite,
}

impl EnqueueRequest {
    /// Local completeness checks only; published contract validation belongs to
    /// the preparing domain command and verified access/storage boundaries.
    pub fn validate(&self) -> Result<(), InvalidRequest> {
        let required = [
            &self.receipt.workspace_id,
            &self.receipt.home_id,
            &self.receipt.actor_id,
            &self.receipt.mutation_id,
            &self.partition.workspace_id,
            &self.partition.home_id,
            &self.partition.source_instance_id,
            &self.partition.collection_id,
            &self.prepared.contract_id,
            &self.prepared.operation_id,
        ];
        if required.iter().any(|value| value.is_empty())
            || self.prepared.target_external_id.as_deref() == Some("")
        {
            return Err(InvalidRequest::MissingIdentifier);
        }
        if self.receipt.workspace_id != self.partition.workspace_id
            || self.receipt.home_id != self.partition.home_id
        {
            return Err(InvalidRequest::ScopeMismatch);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvalidRequest {
    MissingIdentifier,
    ScopeMismatch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Queued,
    Running,
    RetryScheduled,
    Succeeded,
    Failed,
    NeedsReconciliation,
}

/// Typed sanitized acknowledgement; this never refreshes a read projection.
/// Original source date spelling is preserved and may be explicitly unknown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedWrite {
    pub external_id: Option<String>,
    pub source_updated_at: Option<String>,
}

/// Fixed internal failure categories; never persist an upstream body or secret.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureCode {
    Unavailable,
    RateLimited,
    Rejected,
    AccessDenied,
    InvalidPreparedPayload,
    OutcomeUnknown,
    LeaseExpired,
}

/// Caller-visible current output excludes prepared bytes and lease capabilities.
/// This remains an internal DTO until the shared HTTP contract is approved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobSnapshot {
    pub job_id: JobId,
    pub receipt: ReceiptKey,
    pub partition: SourcePartition,
    pub status: JobStatus,
    pub attempts: u32,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub next_attempt_at: Option<Timestamp>,
    pub applied: Option<AppliedWrite>,
    pub failure: Option<FailureCode>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Enqueued(JobSnapshot),
    /// The current original job is returned, without scheduling another write.
    Replayed(JobSnapshot),
}

/// Persistent global capability. Fences never reset across process restarts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lease {
    pub job_id: JobId,
    pub fence: u64,
    pub expires_at: Timestamp,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeasedJob {
    pub lease: Lease,
    pub request: EnqueueRequest,
    /// One-based count; the claim transaction increments it exactly once.
    pub attempt: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClaimOutcome {
    Idle,
    /// A different caller still owns the one physical writer slot.
    Busy {
        expires_at: Timestamp,
    },
    Claimed(LeasedJob),
    /// Expiry moves an active row here; it never grants a replacement lease.
    HeldForReconciliation(JobSnapshot),
}

/// Permission requires positive knowledge that the write was not applied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplayPermission {
    Never,
    AfterBackoff,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Applied(AppliedWrite),
    NotApplied {
        reason: FailureCode,
        replay: ReplayPermission,
    },
    Uncertain {
        reason: FailureCode,
    },
}

/// Atomic persistence disposition chosen after the synchronous writer returns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FinishDisposition {
    Succeeded(AppliedWrite),
    Failed(FailureCode),
    RetryAt {
        at: Timestamp,
        reason: FailureCode,
    },
    /// Preserve the active global lease/reservation for read-back reconciliation.
    Hold(FailureCode),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldJob {
    pub lease: Lease,
    pub request: EnqueueRequest,
    pub attempt: u32,
}

/// A qualified reconciler must supply both worker-quiescence evidence and a
/// complete scoped read-back. The reference is retained privately by storage.
/// This opaque reference is not proof by itself or a user-provided boolean.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReconciliationEvidence {
    pub private_evidence_reference: String,
}

/// Only definite outcomes may release the writer reservation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReconciliationOutcome {
    StillUncertain,
    Applied {
        evidence: ReconciliationEvidence,
        applied: AppliedWrite,
    },
    NotApplied {
        evidence: ReconciliationEvidence,
        reason: FailureCode,
        replay: ReplayPermission,
    },
}
