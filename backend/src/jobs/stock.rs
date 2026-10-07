//! Stock.2 queue policy values. This is internal typed composition, not a schema
//! replacement or a claim of live provider/production qualification.

use super::{JobId, JobStatus, SourcePartition, Timestamp};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Digest(String);

impl Digest {
    pub fn from_hex(value: String) -> Result<Self, InvalidQueuePolicy> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(InvalidQueuePolicy::InvalidDigest);
        }
        Ok(Self(value))
    }

    pub fn as_hex(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PhysicalQueueIdentity {
    pub deployment_id: String,
    pub physical_database_id: String,
    pub configuration_digest: Digest,
}

/// Trusted registration maps every configured transport/collection alias to its
/// actual physical database and canonical physical collection identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceAlias {
    pub partition: SourcePartition,
    pub canonical_collection_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueRegistration {
    pub identity: PhysicalQueueIdentity,
    pub dispatcher_owner_id: String,
    pub aliases: Vec<SourceAlias>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Entity,
    Location,
    Tag,
    Template,
    EntityType,
    Field,
    File,
    Maintenance,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceRef {
    pub kind: ResourceKind,
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScopeSelection {
    Collection,
    Resources(Vec<ResourceRef>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteScope {
    pub source_instance_id: String,
    pub collection_id: String,
    pub selection: ScopeSelection,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonicalScope {
    pub collection_id: String,
    pub selection: ScopeSelection,
}

impl CanonicalScope {
    pub fn overlaps(&self, other: &Self) -> bool {
        if self.collection_id != other.collection_id {
            return false;
        }
        match (&self.selection, &other.selection) {
            (ScopeSelection::Collection, _) | (_, ScopeSelection::Collection) => true,
            (ScopeSelection::Resources(left), ScopeSelection::Resources(right)) => {
                left.iter().any(|resource| right.contains(resource))
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvalidQueuePolicy {
    InvalidDigest,
    InvalidRegistration,
    UnknownAlias,
    InvalidScope,
    InvalidLimits,
    WrongQueue,
}

impl QueueRegistration {
    pub fn validate(&self) -> Result<(), InvalidQueuePolicy> {
        if self.identity.deployment_id.is_empty()
            || self.identity.physical_database_id.is_empty()
            || self.dispatcher_owner_id.is_empty()
            || self.aliases.is_empty()
        {
            return Err(InvalidQueuePolicy::InvalidRegistration);
        }
        for (index, alias) in self.aliases.iter().enumerate() {
            if alias.canonical_collection_id.is_empty()
                || alias.partition.workspace_id.is_empty()
                || alias.partition.home_id.is_empty()
                || alias.partition.source_instance_id.is_empty()
                || alias.partition.collection_id.is_empty()
            {
                return Err(InvalidQueuePolicy::InvalidRegistration);
            }
            for other in &self.aliases[..index] {
                if other.partition == alias.partition
                    || (other.partition.source_instance_id == alias.partition.source_instance_id
                        && other.partition.collection_id == alias.partition.collection_id
                        && other.canonical_collection_id != alias.canonical_collection_id)
                {
                    return Err(InvalidQueuePolicy::InvalidRegistration);
                }
            }
        }
        Ok(())
    }

    pub fn resolve(
        &self,
        partition: &SourcePartition,
        scope: &WriteScope,
    ) -> Result<CanonicalScope, InvalidQueuePolicy> {
        if scope.source_instance_id != partition.source_instance_id
            || scope.collection_id != partition.collection_id
        {
            return Err(InvalidQueuePolicy::InvalidScope);
        }
        let alias = self
            .aliases
            .iter()
            .find(|alias| alias.partition == *partition)
            .ok_or(InvalidQueuePolicy::UnknownAlias)?;
        if let ScopeSelection::Resources(resources) = &scope.selection
            && (resources.is_empty()
                || resources.len() > 1000
                || resources
                    .iter()
                    .any(|resource| resource.id.is_empty() || resource.id.chars().count() > 4096))
        {
            return Err(InvalidQueuePolicy::InvalidScope);
        }
        Ok(CanonicalScope {
            collection_id: alias.canonical_collection_id.clone(),
            selection: scope.selection.clone(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InvokedRemoteActivity {
    Active,
    EndUnproven,
    /// Supplied by a qualified correlation boundary, never inferred from age,
    /// acknowledgement, local cancellation or human effect reconciliation.
    EndedProven {
        termination_evidence_digest: Digest,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemoteActivity {
    NotDispatched,
    Invoked(InvokedRemoteActivity),
}

impl RemoteActivity {
    pub fn blocks_invocation(&self) -> bool {
        matches!(
            self,
            Self::Invoked(InvokedRemoteActivity::Active | InvokedRemoteActivity::EndUnproven)
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetadataCommitEvidence {
    NotDispatched,
    ObservedNotCommitted,
    ObservedCommitted,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ByteDisposition {
    None,
    RetainedUnbound,
    RetainedBound,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceClosureEvidence {
    Unassessed,
    Incomplete,
    OperatorEvidenced,
}

/// Complete accounting carries exact reserved bytes. Incomplete accounting has
/// no reserved byte value; it cannot be coerced into a fabricated zero.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ByteAccounting {
    Complete {
        known_bytes: u64,
        reserved_bytes: u64,
    },
    Incomplete {
        known_bytes: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageLiability {
    pub accounting: ByteAccounting,
    pub metadata_commit_evidence: MetadataCommitEvidence,
    pub byte_disposition: ByteDisposition,
    pub reference_closure_evidence: ReferenceClosureEvidence,
    pub orphan_candidate_id: Option<String>,
    pub unresolved_attempts: u32,
}

impl StorageLiability {
    pub fn reserved_bytes(&self) -> Option<u64> {
        match self.accounting {
            ByteAccounting::Complete { reserved_bytes, .. } => Some(reserved_bytes),
            ByteAccounting::Incomplete { .. } => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingByteLiability {
    pub required: bool,
    pub reserved_bytes: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProfileQualification {
    OfflineEngineeringFixture,
    /// An injected trusted deployment qualification, not user/client input.
    QualifiedDeployment {
        evidence_digest: Digest,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdmissionProfile {
    pub profile_version: String,
    pub qualification: ProfileQualification,
    pub max_waiting_intents: u32,
    pub max_admission_wait_ms: u64,
    pub max_unresolved_storage_attempts: u32,
    pub max_unresolved_storage_bytes: u64,
}

impl AdmissionProfile {
    /// Explicitly offline, unmeasured and not user-selected. Never a default.
    pub fn stock_engineering_fixture() -> Self {
        Self {
            profile_version: "single-dispatch-engineering-1".into(),
            qualification: ProfileQualification::OfflineEngineeringFixture,
            max_waiting_intents: 4,
            max_admission_wait_ms: 10_000,
            max_unresolved_storage_attempts: 4,
            max_unresolved_storage_bytes: 67_108_864,
        }
    }

    pub fn validate(&self) -> Result<(), InvalidQueuePolicy> {
        if self.profile_version.chars().count() == 0
            || self.profile_version.chars().count() > 100
            || self.max_waiting_intents > 1000
            || self.max_admission_wait_ms == 0
            || self.max_admission_wait_ms > 3_600_000
            || self.max_unresolved_storage_attempts == 0
            || self.max_unresolved_storage_attempts > 1000
            || self.max_unresolved_storage_bytes == 0
            || self.max_unresolved_storage_bytes > MAX_SAFE_INTEGER
        {
            return Err(InvalidQueuePolicy::InvalidLimits);
        }
        Ok(())
    }

    pub const fn max_active_mutations(&self) -> u32 {
        1
    }

    /// Expire metadata for a never-dispatched attempt only. A backwards clock
    /// retains the waiter; it cannot expire an invocation or release a hold.
    pub fn never_dispatched_wait_expired(
        &self,
        enqueued_at: Timestamp,
        now: Timestamp,
        attempts: u32,
    ) -> bool {
        attempts == 0
            && now
                .checked_sub(enqueued_at)
                .is_some_and(|elapsed| elapsed >= self.max_admission_wait_ms)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WaitingIntent {
    pub operation_id: JobId,
    pub request_digest: Digest,
    pub enqueued_at: Timestamp,
}
impl WaitingIntent {
    pub const fn body_accepted(&self) -> bool {
        false
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatcherState {
    pub owner_id: Option<String>,
    pub epoch: u64,
    pub active_operation_id: Option<JobId>,
    pub activity: RemoteActivity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogicalFence {
    pub operation_id: JobId,
    pub scope: CanonicalScope,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownOperation {
    pub operation_id: JobId,
    pub state: JobStatus,
    pub request_digest: Digest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueSnapshot {
    pub identity: PhysicalQueueIdentity,
    pub dispatcher: DispatcherState,
    pub waiting: Vec<WaitingIntent>,
    pub existing_operation: Option<KnownOperation>,
    pub logical_fences: Vec<LogicalFence>,
    pub storage_liability: StorageLiability,
    pub pending_byte_liability: PendingByteLiability,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueueWaitReason {
    PhysicalActivityHeld,
    LogicalOutcomeHeld,
    EarlierWaiter,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdmissionRejection {
    AdmissionBackpressure,
    StorageLiabilityUnqualified,
    StorageLiabilityBudget,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QueueDecision {
    NotProviderMutation,
    ExistingOperation {
        operation_id: JobId,
        state: JobStatus,
    },
    ReadyForExclusiveDispatch,
    QueueMetadata {
        reason: QueueWaitReason,
    },
    RejectedBeforeDispatch {
        reason: AdmissionRejection,
    },
}

impl QueueDecision {
    pub fn body_accepted(&self) -> Option<bool> {
        match self {
            Self::NotProviderMutation | Self::ExistingOperation { .. } => None,
            _ => Some(false),
        }
    }
}

/// Pure classification only. Storage must recompute atomically at admission.
/// Existing intent lookup has already been authorized and digest-correlated.
/// A provider GET with a physical effect (for example print) is a mutation here.
pub fn decide_admission(
    registration: &QueueRegistration,
    profile: &AdmissionProfile,
    snapshot: &QueueSnapshot,
    candidate_scope: &CanonicalScope,
    candidate_operation_id: Option<&JobId>,
    provider_mutation: bool,
) -> Result<QueueDecision, InvalidQueuePolicy> {
    registration.validate()?;
    profile.validate()?;
    if snapshot.identity != registration.identity {
        return Err(InvalidQueuePolicy::WrongQueue);
    }
    if !provider_mutation {
        return Ok(QueueDecision::NotProviderMutation);
    }
    if let Some(existing) = &snapshot.existing_operation {
        return Ok(QueueDecision::ExistingOperation {
            operation_id: existing.operation_id.clone(),
            state: existing.state,
        });
    }
    let wait = if snapshot.dispatcher.activity.blocks_invocation()
        || (matches!(snapshot.dispatcher.activity, RemoteActivity::NotDispatched)
            && snapshot.dispatcher.active_operation_id.is_some())
    {
        Some(QueueWaitReason::PhysicalActivityHeld)
    } else if snapshot
        .logical_fences
        .iter()
        .any(|fence| fence.scope.overlaps(candidate_scope))
    {
        Some(QueueWaitReason::LogicalOutcomeHeld)
    } else if snapshot
        .waiting
        .first()
        .is_some_and(|first| Some(&first.operation_id) != candidate_operation_id)
    {
        Some(QueueWaitReason::EarlierWaiter)
    } else {
        None
    };
    if let Some(reason) = wait {
        // Existing waiting metadata does not consume another slot. No bytes are
        // accepted here, so unknown byte accounting can remain queued metadata.
        if candidate_operation_id.is_none()
            && snapshot.waiting.len() >= profile.max_waiting_intents as usize
        {
            return Ok(QueueDecision::RejectedBeforeDispatch {
                reason: AdmissionRejection::AdmissionBackpressure,
            });
        }
        return Ok(QueueDecision::QueueMetadata { reason });
    }
    let pending = snapshot.pending_byte_liability;
    if pending.required {
        let Some(reserved) = snapshot.storage_liability.reserved_bytes() else {
            return Ok(QueueDecision::RejectedBeforeDispatch {
                reason: AdmissionRejection::StorageLiabilityUnqualified,
            });
        };
        let Some(requested) = pending.reserved_bytes else {
            return Ok(QueueDecision::RejectedBeforeDispatch {
                reason: AdmissionRejection::StorageLiabilityUnqualified,
            });
        };
        if snapshot.storage_liability.unresolved_attempts >= profile.max_unresolved_storage_attempts
            || reserved
                .checked_add(requested)
                .is_none_or(|total| total > profile.max_unresolved_storage_bytes)
        {
            return Ok(QueueDecision::RejectedBeforeDispatch {
                reason: AdmissionRejection::StorageLiabilityBudget,
            });
        }
    }
    Ok(QueueDecision::ReadyForExclusiveDispatch)
}
