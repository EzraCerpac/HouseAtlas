use crate::{domain::stock::ValidatedRequest, jobs::*, storage};

/// Independently issued recovery/discovery authority. The opaque grant must
/// survive the host's session reset and be revalidated against the complete
/// trusted registry. Ordinary source read/write capabilities do not imply this
/// permission. Neither the image nor queued actor IDs can issue the grant.
pub trait RecoveryDiscoveryAuthority {
    type Grant;
    fn revalidate(
        &self,
        grant: &Self::Grant,
        registry: &[QueueConfig],
        registration: &QueueRegistration,
    ) -> storage::Result<()>;
}

/// Facts derived by the original enqueue owner from its retained provenance,
/// including original actor, approval-bound ordered impact and media admission.
/// This carrier is not an authority token and is deliberately not serializable.
pub struct OriginalEnqueue<P> {
    pub physical_identity: PhysicalQueueIdentity,
    pub original: ValidatedRequest,
    pub expected: EnqueueRequest,
    pub proof: P,
}

/// Lookup is keyed by the full physical identity, actor-scoped receipt and
/// immutable original. Receipt fields are lookup data, not authority. It
/// must verify preexisting original authority/approval provenance, not mirror
/// queued DTO fields or reuse an expired original session as current authority.
/// Share the same derivation with live QueueAuthorization::validate_enqueue.
pub trait OriginalEnqueueOwner {
    type Proof;
    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> storage::Result<OriginalEnqueue<Self::Proof>>;
    /// Return the independently retained exact admitted/claimed attempt. The
    /// lookup keys are inert data; no lease or original witness is reconstructed
    /// from a row. Includes job ID, fence, expiry, owner, scope and reservation.
    fn retained_attempt(
        &self,
        registration: &QueueRegistration,
        original_proof: &Self::Proof,
        job_id: &JobId,
        fence: u64,
        attempt: u32,
    ) -> storage::Result<LeasedJob>;
}

/// Correlated data only; construction does not authorize dispatch or recovery.
pub struct RetainedEnqueue<'a, P> {
    pub config: &'a QueueConfig,
    pub original: &'a ValidatedRequest,
    pub request: &'a EnqueueRequest,
    pub scope: &'a CanonicalScope,
    pub original_proof: &'a P,
}

pub struct RetainedAttempt<'a, P> {
    pub enqueue: RetainedEnqueue<'a, P>,
    pub job: &'a LeasedJob,
    pub prepared: Option<&'a storage::PreparedNativeIntent>,
    pub journal: Option<&'a storage::JournalEvidenceView>,
    pub steps: &'a [storage::QueueStepEvidence],
    pub liabilities: &'a [(String, StorageLiability)],
    pub outcomes: &'a [storage::QueueRecoveryOutcome<'a>],
}

/// Only this outcome's retained prefixes are available as outcome evidence.
/// Later response/readback or termination steps cannot qualify an earlier cut.
pub struct RetainedOutcome<'a, 'frame, P> {
    pub enqueue: &'a RetainedEnqueue<'frame, P>,
    pub job: &'frame LeasedJob,
    pub prepared: Option<&'frame storage::PreparedNativeIntent>,
    pub journal: Option<&'frame storage::JournalEvidenceView>,
    pub index: usize,
    pub outcome: &'a storage::QueueRecoveryOutcome<'frame>,
    pub previous: Option<&'a storage::QueueRecoveryOutcome<'frame>>,
    pub added_steps: &'a [storage::QueueStepEvidence],
}

/// Actual queued-original/staging owner. Missing evidence is unavailable,
/// including an unknown byte reservation; zero bytes must be positively proved.
/// These pure checks validate exact physical/receipt/original/approval/media
/// bindings and liability progression without accessing a live vault/provider.
pub trait QueuedMediaRecovery<P> {
    fn validate_original(&self, enqueue: &RetainedEnqueue<'_, P>) -> storage::Result<()>;
    fn validate_attempt(&self, attempt: &RetainedAttempt<'_, P>) -> storage::Result<()>;
    fn validate_outcome(&self, outcome: &RetainedOutcome<'_, '_, P>) -> storage::Result<()>;
}

/// Actual native owner decodes its retained method/path/body and evidence bytes
/// and reuses its qualified route/response/readback/no-effect/end/reconciliation
/// semantics. Digest labels are not substitutes for those facts. Supported
/// codec names are selected by the trusted owner, never the recovery image.
pub trait NativeRetainedEvidence<P> {
    fn native_codec(&self) -> &str;
    fn step_codec(&self, kind: &storage::StepKind) -> Option<&str>;
    fn validate_prepared(&self, attempt: &RetainedAttempt<'_, P>) -> storage::Result<()>;
    fn validate_step(
        &self,
        attempt: &RetainedAttempt<'_, P>,
        index: usize,
        step: &storage::QueueStepEvidence,
    ) -> storage::Result<()>;
    fn validate_outcome(&self, outcome: &RetainedOutcome<'_, '_, P>) -> storage::Result<()>;
}
