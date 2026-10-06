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

/// Reviewed immutable waiting metadata. Request digest comes from the domain's
/// exact stock.2 canonical intent; renewable observations are not new intents.
///
/// No upload bytes or accepted/staged body is represented by this type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentMetadata {
    pub contract_id: String,
    /// Reviewed command/operation key, distinct from the store-issued JobId.
    pub operation_id: String,
    pub target_external_id: Option<String>,
    pub request_digest: super::Digest,
}

/// Complete durable idempotency content. Storage binds it atomically to the key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnqueueRequest {
    pub receipt: ReceiptKey,
    pub partition: SourcePartition,
    pub intent: IntentMetadata,
    pub write_scope: super::WriteScope,
    pub pending_byte_liability: super::PendingByteLiability,
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
            &self.intent.contract_id,
            &self.intent.operation_id,
        ];
        if required.iter().any(|value| value.is_empty())
            || self.intent.target_external_id.as_deref() == Some("")
        {
            return Err(InvalidRequest::MissingIdentifier);
        }
        // Frozen opaque source strings allow 4096 code points; wire3 command
        // IDs allow 255. Do not replace Unicode scalar counts with byte lengths.
        if required.iter().any(|value| value.chars().count() > 4096)
            || self.intent.operation_id.chars().count() > 255
            || self
                .intent
                .target_external_id
                .as_ref()
                .is_some_and(|value| value.chars().count() > 4096)
        {
            return Err(InvalidRequest::MetadataTooLarge);
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
    MetadataTooLarge,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Prepared,
    Queued,
    Running,
    RetryScheduled,
    Succeeded,
    Failed,
    NeedsReconciliation,
    Partial,
    ResolvedObserved,
    ResolvedByHuman,
}

/// Typed sanitized acknowledgement; this never refreshes a read projection.
/// Original source date spelling is preserved and may be explicitly unknown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedWrite {
    pub external_id: Option<String>,
    pub source_updated_at: Option<String>,
    pub observation: ObservedWriteEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedWriteEvidence {
    pub response_digest: super::Digest,
    pub readback_digest: super::Digest,
    pub observed_at: Timestamp,
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
    AdmissionWaitExpired,
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
    pub remote_activity: super::RemoteActivity,
    pub unknown_scope_fence_retained: bool,
    pub storage_liability: super::StorageLiability,
    pub body_accepted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Enqueued(JobSnapshot),
    /// The current original job is returned, without scheduling another write.
    Replayed(JobSnapshot),
    RejectedBeforeDispatch {
        reason: super::AdmissionRejection,
    },
}

/// Persistent global capability. Fences never reset across process restarts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lease {
    pub job_id: JobId,
    pub fence: u64,
    pub expires_at: Timestamp,
    pub owner_id: String,
    pub physical_identity: super::PhysicalQueueIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeasedJob {
    pub lease: Lease,
    pub request: EnqueueRequest,
    /// One-based count; the claim transaction increments it exactly once.
    pub attempt: u32,
    pub canonical_scope: super::CanonicalScope,
    /// Reserved atomically before the writer may accept or stage bytes.
    pub pending_byte_liability: super::PendingByteLiability,
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
    Waiting {
        reason: super::QueueWaitReason,
    },
    RejectedBeforeDispatch {
        reason: super::AdmissionRejection,
    },
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
    Partial {
        reason: FailureCode,
    },
}

/// An invoked outcome cannot contain not-dispatched activity. Effects and bytes
/// do not determine whether a remote request has terminated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvocationReport {
    pub outcome: WriteOutcome,
    pub remote_activity: super::InvokedRemoteActivity,
    pub storage_liability: super::StorageLiability,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchReport {
    NotInvoked {
        reason: FailureCode,
        storage_liability: super::StorageLiability,
    },
    Invoked(InvocationReport),
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
    /// Retain the logical overlap fence for effect reconciliation. Physical
    /// reservation independently follows qualified remote termination evidence.
    Hold(FailureCode),
    Partial(FailureCode),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FinishReport {
    pub disposition: FinishDisposition,
    pub remote_activity: super::RemoteActivity,
    pub storage_liability: super::StorageLiability,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldJob {
    pub lease: Lease,
    pub request: EnqueueRequest,
    pub attempt: u32,
    pub remote_activity: super::InvokedRemoteActivity,
}

/// Logical effect evidence, retained privately. It cannot establish remote end
/// or release bytes/orphans. Qualified current read-back and explicit audited
/// human effect resolution preserve their different evidence meanings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReconciliationEvidence {
    pub private_evidence_reference: String,
    pub evidence_digest: super::Digest,
    pub kind: ReconciliationKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReconciliationKind {
    CurrentStateObserved,
    Human { actor_id: String },
}

/// Separate correlated termination capability from a qualified peer. Owner,
/// epoch, physical identity and operation are bound by the full original lease.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteEndEvidence {
    pub lease: Lease,
    pub termination_evidence_digest: super::Digest,
}

/// Resolve logical effects only. No variant proves remote end or releases the
/// physical invocation reservation, storage liability or orphan bytes itself.
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
