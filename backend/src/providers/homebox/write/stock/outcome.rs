use super::types::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutcomeState {
    Prepared,
    Queued,
    Dispatching,
    ConfirmedObserved,
    RejectedBeforeDispatch,
    Partial,
    UnknownHeld,
    ResolvedObserved,
    ResolvedByHuman,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verification {
    Unresolved,
    NoDispatch,
    ObservedAfterWrite,
    CurrentStateObservedOnly,
    HumanReconciliation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum RemoteActivity {
    NotDispatched {
        #[serde(rename = "terminationEvidenceDigest")]
        termination_evidence_digest: Option<Digest>,
    },
    Active {
        #[serde(rename = "terminationEvidenceDigest")]
        termination_evidence_digest: Option<Digest>,
    },
    EndUnproven {
        #[serde(rename = "terminationEvidenceDigest")]
        termination_evidence_digest: Option<Digest>,
    },
    EndedProven {
        #[serde(rename = "terminationEvidenceDigest")]
        termination_evidence_digest: Digest,
    },
}
impl RemoteActivity {
    pub fn not_dispatched() -> Self {
        Self::NotDispatched {
            termination_evidence_digest: None,
        }
    }
    pub fn end_unproven() -> Self {
        Self::EndUnproven {
            termination_evidence_digest: None,
        }
    }
    pub fn invoked(&self) -> bool {
        !matches!(self, Self::NotDispatched { .. })
    }
    pub fn well_formed(&self) -> bool {
        match self {
            Self::NotDispatched {
                termination_evidence_digest,
            }
            | Self::Active {
                termination_evidence_digest,
            }
            | Self::EndUnproven {
                termination_evidence_digest,
            } => termination_evidence_digest.is_none(),
            Self::EndedProven { .. } => true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Effect {
    Created,
    Updated,
    Deleted,
    Preserved,
    NativeChildPropagation,
    PrinterRequestObserved,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectEvidence {
    pub target: WireTarget,
    pub effect: Effect,
    pub digest: Digest,
}

/// Wire target always contains the exact authority and a concrete ID.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireTarget {
    pub authority: HomeBoxAuthority,
    pub source_instance_id: Uuid,
    pub collection_id: Uuid,
    pub resource_kind: ResourceKind,
    pub resource_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<Uuid>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum HomeBoxAuthority {
    #[serde(rename = "homebox")]
    HomeBox,
}
impl TryFrom<&StockTarget> for WireTarget {
    type Error = StockMappingError;
    fn try_from(t: &StockTarget) -> Result<Self, Self::Error> {
        if t.resource_kind == ResourceKind::Collection {
            return Err(StockMappingError::InvalidNativeInput);
        }
        let nested = matches!(
            t.resource_kind,
            ResourceKind::Field | ResourceKind::Attachment | ResourceKind::Maintenance
        );
        if nested != t.entity_id.is_some() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        Ok(Self {
            authority: HomeBoxAuthority::HomeBox,
            source_instance_id: t.source_instance_id,
            collection_id: t.collection_id,
            resource_kind: t.resource_kind,
            resource_id: t.id()?,
            entity_id: t.entity_id,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MetadataEvidence {
    NotDispatched,
    ObservedNotCommitted,
    ObservedCommitted,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ByteDisposition {
    None,
    RetainedUnbound,
    RetainedBound,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceClosure {
    Unassessed,
    Incomplete,
    OperatorEvidenced,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageLiability {
    pub accounting_complete: bool,
    pub metadata_commit_evidence: MetadataEvidence,
    pub byte_disposition: ByteDisposition,
    pub reference_closure_evidence: ReferenceClosure,
    pub orphan_candidate_id: Option<Uuid>,
    pub unresolved_attempts: u64,
    pub known_bytes: u64,
    pub reserved_bytes: Option<u64>,
}
impl StorageLiability {
    pub fn well_formed(&self) -> bool {
        self.accounting_complete == self.reserved_bytes.is_some()
            && self.known_bytes <= 9_007_199_254_740_991
            && self
                .reserved_bytes
                .is_none_or(|b| b <= 9_007_199_254_740_991)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockOutcome {
    pub schema_version: u8,
    pub command_id: String,
    pub request_id: Uuid,
    pub operation_id: Uuid,
    pub resolved_scope: Context,
    pub request_digest: Digest,
    pub causality_proven: bool,
    #[serde(rename = "atomicProviderCAS")]
    pub atomic_provider_cas: bool,
    pub native_editor_race_possible: bool,
    pub known_effects: Vec<EffectEvidence>,
    pub observed_at: String,
    pub response_digest: Option<Digest>,
    pub readback_digest: Option<Digest>,
    pub generated_identity_resolved: bool,
    pub unknown_scope_fence_retained: bool,
    pub remote_activity: RemoteActivity,
    pub storage_liability: StorageLiability,
    pub state: OutcomeState,
    pub verification: Verification,
    pub response_success: bool,
    pub readback_agrees: bool,
    pub resolution_evidence_digest: Option<Digest>,
    pub resolution_actor_id: Option<Uuid>,
}
impl StockOutcome {
    /// Pure state reducer used inside AT07's durable evidence transaction.
    /// The activity journal retains each observation separately. Dispatch does
    /// not turn an earlier observation into an observed-after-write result.
    pub fn with_dispatch(&self, facts: &super::DispatchFacts) -> Option<Self> {
        if !facts.remote_activity.invoked()
            || !facts.remote_activity.well_formed()
            || matches!(
                self.state,
                OutcomeState::ConfirmedObserved
                    | OutcomeState::ResolvedObserved
                    | OutcomeState::ResolvedByHuman
                    | OutcomeState::RejectedBeforeDispatch
            )
        {
            return None;
        }
        if self.response_success && !facts.response_success
            || self.response_digest.is_some() && self.response_digest != facts.response_digest
            || matches!(self.remote_activity, RemoteActivity::EndedProven { .. })
                && self.remote_activity != facts.remote_activity
        {
            return None;
        }
        let mut next = self.clone();
        next.response_success = facts.response_success;
        next.response_digest = facts.response_digest.clone();
        next.generated_identity_resolved =
            self.generated_identity_resolved || facts.generated_identity_resolved;
        next.remote_activity = facts.remote_activity.clone();
        next.state = OutcomeState::UnknownHeld;
        next.verification = Verification::Unresolved;
        next.unknown_scope_fence_retained = true;
        next.resolution_evidence_digest = None;
        next.resolution_actor_id = None;
        next.well_formed().then_some(next)
    }

    /// Apply only a qualified post-dispatch/reconciliation observation. This
    /// reducer never sets causality/CAS or releases physical invocation holds.
    pub fn with_observation(&self, facts: &super::ObservationFacts) -> Option<Self> {
        if !self.remote_activity.invoked()
            || matches!(
                self.state,
                OutcomeState::ConfirmedObserved
                    | OutcomeState::ResolvedObserved
                    | OutcomeState::ResolvedByHuman
            )
        {
            return None;
        }
        let mut next = self.clone();
        next.readback_digest = Some(facts.readback_digest.clone());
        next.readback_agrees = facts.agrees;
        next.generated_identity_resolved =
            self.generated_identity_resolved || facts.generated_identity_resolved;
        next.known_effects = facts.known_effects.clone();
        next.observed_at = facts.observed_at.clone();
        if next.response_success
            && next.response_digest.is_some()
            && next.readback_agrees
            && next.generated_identity_resolved
        {
            next.state = OutcomeState::ConfirmedObserved;
            next.verification = Verification::ObservedAfterWrite;
            next.unknown_scope_fence_retained = false;
        } else {
            next.state = if next.known_effects.is_empty() {
                OutcomeState::UnknownHeld
            } else {
                OutcomeState::Partial
            };
            next.verification = Verification::Unresolved;
            next.unknown_scope_fence_retained = true;
        }
        next.well_formed().then_some(next)
    }

    /// Trusted explicit resolution only; native remote end remains unchanged.
    /// These are not automatic consequences of a matching readback or timeout.
    pub fn with_resolution(
        &self,
        evidence: Digest,
        actor: Option<Uuid>,
        human: bool,
    ) -> Option<Self> {
        if !self.remote_activity.invoked() || human && actor.is_none() {
            return None;
        }
        let mut next = self.clone();
        next.state = if human {
            OutcomeState::ResolvedByHuman
        } else {
            OutcomeState::ResolvedObserved
        };
        next.verification = if human {
            Verification::HumanReconciliation
        } else {
            Verification::CurrentStateObservedOnly
        };
        next.resolution_evidence_digest = Some(evidence);
        next.resolution_actor_id = actor;
        next.unknown_scope_fence_retained = false;
        next.well_formed().then_some(next)
    }

    pub fn well_formed(&self) -> bool {
        if self.schema_version != 3
            || self.causality_proven
            || self.atomic_provider_cas
            || !self.native_editor_race_possible
            || self.known_effects.len() > 1000
            || !self.remote_activity.well_formed()
            || !self.storage_liability.well_formed()
        {
            return false;
        }
        match self.state {
            OutcomeState::Prepared
            | OutcomeState::Queued
            | OutcomeState::RejectedBeforeDispatch => {
                !self.remote_activity.invoked()
                    && self.known_effects.is_empty()
                    && self.response_digest.is_none()
                    && self.readback_digest.is_none()
                    && !self.response_success
                    && !self.readback_agrees
                    && !self.unknown_scope_fence_retained
                    && self.resolution_evidence_digest.is_none()
                    && self.resolution_actor_id.is_none()
                    && self.verification
                        == if self.state == OutcomeState::RejectedBeforeDispatch {
                            Verification::NoDispatch
                        } else {
                            Verification::Unresolved
                        }
            }
            OutcomeState::Dispatching | OutcomeState::Partial | OutcomeState::UnknownHeld => {
                self.remote_activity.invoked()
                    && self.unknown_scope_fence_retained
                    && self.verification == Verification::Unresolved
                    && self.resolution_evidence_digest.is_none()
                    && self.resolution_actor_id.is_none()
            }
            OutcomeState::ConfirmedObserved => {
                self.remote_activity.invoked()
                    && !self.unknown_scope_fence_retained
                    && self.verification == Verification::ObservedAfterWrite
                    && self.response_success
                    && self.readback_agrees
                    && self.generated_identity_resolved
                    && self.response_digest.is_some()
                    && self.readback_digest.is_some()
                    && self.resolution_evidence_digest.is_none()
                    && self.resolution_actor_id.is_none()
            }
            OutcomeState::ResolvedObserved => {
                self.remote_activity.invoked()
                    && !self.unknown_scope_fence_retained
                    && self.verification == Verification::CurrentStateObservedOnly
                    && self.resolution_evidence_digest.is_some()
            }
            OutcomeState::ResolvedByHuman => {
                self.remote_activity.invoked()
                    && !self.unknown_scope_fence_retained
                    && self.verification == Verification::HumanReconciliation
                    && self.resolution_evidence_digest.is_some()
                    && self.resolution_actor_id.is_some()
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StockErrorCode {
    #[serde(rename = "unsupported-capability")]
    UnsupportedCapability,
    #[serde(rename = "capability-held")]
    CapabilityHeld,
    #[serde(rename = "preflight-conflict")]
    PreflightConflict,
    #[serde(rename = "provider-unqualified")]
    ProviderUnqualified,
    #[serde(rename = "unknown-held")]
    UnknownHeld,
    #[serde(rename = "admission-backpressure")]
    AdmissionBackpressure,
    #[serde(rename = "UNAUTHENTICATED")]
    Unauthenticated,
    #[serde(rename = "CAPABILITY_DENIED")]
    CapabilityDenied,
    #[serde(rename = "RESOURCE_UNAVAILABLE")]
    ResourceUnavailable,
    #[serde(rename = "INVALID_ARGUMENT")]
    InvalidArgument,
    #[serde(rename = "IDEMPOTENCY_MISMATCH")]
    IdempotencyMismatch,
    #[serde(rename = "APPROVAL_REQUIRED")]
    ApprovalRequired,
    #[serde(rename = "APPROVAL_INVALID")]
    ApprovalInvalid,
    #[serde(rename = "CONFLICT")]
    Conflict,
    #[serde(rename = "PRECONDITION_REQUIRED")]
    PreconditionRequired,
    #[serde(rename = "SOURCE_UNAVAILABLE")]
    SourceUnavailable,
    #[serde(rename = "INTERNAL_ERROR")]
    InternalError,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetryAdvice {
    None,
    RefreshAndReview,
    PollOperation,
    HumanReconciliation,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockError {
    pub schema_version: u8,
    pub request_id: Uuid,
    pub code: StockErrorCode,
    pub message: String,
    pub retry: RetryAdvice,
    pub operation_id: Option<Uuid>,
}
impl StockError {
    pub(super) fn new(request_id: Uuid, operation_id: Option<Uuid>, code: StockErrorCode) -> Self {
        let (message, retry) = match code {
            StockErrorCode::UnsupportedCapability => (
                "The native operation or variant is unsupported.",
                RetryAdvice::None,
            ),
            StockErrorCode::PreflightConflict => (
                "The native observation must be refreshed and reviewed.",
                RetryAdvice::RefreshAndReview,
            ),
            StockErrorCode::UnknownHeld => (
                "Provider effects remain unresolved; inspect the retained operation.",
                RetryAdvice::PollOperation,
            ),
            StockErrorCode::CapabilityDenied => (
                "Current authority does not permit this operation or disclosure.",
                RetryAdvice::None,
            ),
            StockErrorCode::AdmissionBackpressure => (
                "The physical provider dispatcher has not admitted this intent.",
                RetryAdvice::PollOperation,
            ),
            _ => (
                "The operation could not proceed under its qualified contract.",
                RetryAdvice::None,
            ),
        };
        Self {
            schema_version: 3,
            request_id,
            code,
            message: message.into(),
            retry,
            operation_id,
        }
    }
}

/// Wire3 stock outputs are top-level outcome/error objects, with no data wrapper.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StockResult {
    Outcome(Box<StockOutcome>),
    Error(StockError),
}
