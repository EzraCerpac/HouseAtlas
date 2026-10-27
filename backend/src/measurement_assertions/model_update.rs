use std::cmp::Ordering;

use crate::contracts::v2::{self, RecordRefRecordType};

use super::validation::{
    affected_heads, digest, historical_contradictions, raised_by, resolution_heads,
    same_measurement, same_scope, same_versions, validate_model, validate_target,
};
use super::*;

#[derive(Debug, Clone, PartialEq)]
pub struct ModelObservation {
    pub target: SemanticTarget,
    pub property: MeasurementProperty,
    pub model: ModelPin,
    pub value: ExactQuantity,
    /// Exact resolved semantic feature/geometry binding, not an ordinal selector.
    pub feature_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryReview {
    Unreviewed,
    ExistingShapeVerified,
    ConstrainedChangeReviewed,
}

/// Documentary input only. Constructing/decoding a record grants no authority.
/// The server-owned authority must independently qualify it from native bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct CorrespondenceRecord {
    pub assertion: AssertionVersion,
    pub observation: ModelObservation,
    pub geometry_review: GeometryReview,
    pub verification_evidence: NativeRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorrespondenceVerdict {
    Verified,
    NotVerified,
    Unavailable,
}

/// Documentary review inputs, not a proof token. These are exact borrowed
/// components from the evaluated assertion/history, never a rounded summary.
pub struct SupportQualificationRequest<'a> {
    pub assertion: &'a MeasurementAssertion,
    pub retained_support: &'a MeasurementSupport,
    pub inherited_inputs: &'a [ProvenanceInput],
    pub evidence_roles_and_revisions: &'a [EvidenceLink],
    pub history: &'a [MeasurementAssertion],
    pub reviewed_dispositions: &'a [ReviewedDisputeDisposition<'a>],
}

/// An explicit disposition already checked through verify_resolution during
/// this evaluation. The native support/correspondence review must also examine
/// its content and current applicability, not just the presence of a receipt.
pub struct ReviewedDisputeDisposition<'a> {
    pub resolving_assertion: &'a MeasurementAssertion,
    pub resolution: &'a ReviewedContradictionResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportQualificationVerdict {
    Qualified,
    UnresolvedDispute,
    Refused,
    Unavailable,
}

/// Trusted future native integration port. Never implement this from a JSON
/// boolean or from successful assertion storage. There is no production adapter
/// in this foundation. An implementation must read actual retained artifacts,
/// verify source/semantic/geometry/association correspondence and the native
/// receipt's exact assertion revision, value, artifact and reviewed constraints.
pub trait ModelCorrespondenceAuthority {
    /// Read and qualify the exact retained support components, explanations,
    /// limitations, input lineage and pinned evidence roles/revisions, including
    /// disputed, withdrawn and superseded evidence and reviewed dispositions.
    /// Qualified requires every material dispute resolved and the claimed basis
    /// valid under native review. Retired contextual evidence need not invalidate
    /// a claim supported independently; evidence retirement never retires the
    /// assertion. Missing/ambiguous mappings or unavailable native qualification
    /// cannot return Qualified. No confidence/status ordering is implied.
    fn qualify_support(
        &self,
        _request: &SupportQualificationRequest<'_>,
    ) -> SupportQualificationVerdict {
        SupportQualificationVerdict::Unavailable
    }

    /// Independently check the native review's exact contradiction, reviewed
    /// successor heads, reason, evidence and audit. Documentary resolutions
    /// cannot clear a dispute without this separate trusted qualification.
    fn verify_resolution(
        &self,
        _resolving_assertion: &MeasurementAssertion,
        _resolution: &ReviewedContradictionResolution,
        _history: &[MeasurementAssertion],
    ) -> CorrespondenceVerdict {
        CorrespondenceVerdict::Unavailable
    }

    /// Bind correspondence to this same exact support/disposition review and
    /// native evidence state within the same fenced read point.
    fn verify(
        &self,
        assertion: &MeasurementAssertion,
        observation: &ModelObservation,
        record: &CorrespondenceRecord,
        support: &SupportQualificationRequest<'_>,
    ) -> CorrespondenceVerdict;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PendingReason {
    ModelObservationMissing,
    ObservationStale,
    ActualValueDiffers,
    CorrespondenceMissing,
    CorrespondenceStale,
    CorrespondenceNotVerified,
    VerificationUnavailable,
    NativeCustodyUnknown,
    PhysicalRegistrationUnknown,
    SupportQualificationRefused,
    SupportQualificationUnavailable,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReviewReason {
    AssertionNoLongerActive,
    ClaimAmbiguousOrInconsistent,
    UnresolvedContradictions(Vec<ContradictionRef>),
    ConflictingAssertions(Vec<AssertionVersion>),
    SemanticTargetUnresolved,
    AreaNeedsShapeReview,
    GeometryNeedsReview,
    SupportDisputeUnresolved,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ModelUpdateState {
    Pending(PendingReason),
    ReviewRequired(ReviewReason),
    /// Only an eligibility assessment at this read point. No durable work is
    /// closed here. Future native code must fence/CAS the entire obligation key.
    ClosureEligible {
        verification_evidence: NativeRevision,
        resolution_evidence: Vec<NativeRevision>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelUpdateAssessment {
    pub assertion: AssertionVersion,
    pub model: ModelPin,
    pub state: ModelUpdateState,
}

/// Pure evaluation; never writes assertions, geometry, model selection or work
/// state. Saving an assertion cannot clear an obligation. Callers must supply
/// a complete authoritative history and current model from one fenced read.
pub fn evaluate_model_update(
    assertion: &MeasurementAssertion,
    history: &[MeasurementAssertion],
    current_model: &ModelPin,
    observation: Option<&ModelObservation>,
    correspondence: Option<&CorrespondenceRecord>,
    authority: &impl ModelCorrespondenceAuthority,
) -> ValidationResult<ModelUpdateAssessment> {
    let active = active_assertions(history)?;
    validate_assertion(assertion)?;
    validate_model(current_model)?;
    if !history.contains(assertion) {
        return Err(ValidationError(
            "assertion is absent from exact supplied history",
        ));
    }
    if !same_scope(&assertion.target, current_model) {
        return Err(ValidationError(
            "current model belongs to a different scope",
        ));
    }
    let assess = |state| {
        Ok(ModelUpdateAssessment {
            assertion: assertion.version.clone(),
            model: current_model.clone(),
            state,
        })
    };
    let pending = |reason| assess(ModelUpdateState::Pending(reason));
    let review = |reason| assess(ModelUpdateState::ReviewRequired(reason));

    if !active.contains(&assertion) {
        return review(ReviewReason::AssertionNoLongerActive);
    }
    if assertion.review != ClaimReview::NoKnownIssue {
        return review(ReviewReason::ClaimAmbiguousOrInconsistent);
    }
    let mut unresolved = Vec::new();
    let mut resolution_evidence = Vec::new();
    let mut reviewed_dispositions = Vec::new();
    for contradiction in historical_contradictions(history) {
        let origin = history
            .iter()
            .find(|row| &row.version == raised_by(&contradiction))
            .ok_or(ValidationError("missing historical dispute origin"))?;
        if !same_measurement(origin, assertion) {
            continue;
        }
        let heads = affected_heads(history, &contradiction);
        let mut verified = false;
        for resolver in history {
            for resolution in &resolver.resolutions {
                if resolution.contradiction == contradiction
                    && same_versions(&resolution_heads(resolver, resolution), &heads)
                    && authority.verify_resolution(resolver, resolution, history)
                        == CorrespondenceVerdict::Verified
                {
                    resolution_evidence.push(resolution.review_evidence.clone());
                    reviewed_dispositions.push(ReviewedDisputeDisposition {
                        resolving_assertion: resolver,
                        resolution,
                    });
                    verified = true;
                    break;
                }
            }
            if verified {
                break;
            }
        }
        if !verified {
            unresolved.push(contradiction);
        }
    }
    if !unresolved.is_empty() {
        return review(ReviewReason::UnresolvedContradictions(unresolved));
    }
    let mut conflicts = Vec::new();
    for other in active {
        if other.version != assertion.version
            && other.target == assertion.target
            && other.property == assertion.property
            && other.value.compare(&assertion.value)? != Ordering::Equal
        {
            conflicts.push(other.version.clone());
        }
    }
    if !conflicts.is_empty() {
        return review(ReviewReason::ConflictingAssertions(conflicts));
    }
    let Some(observation) = observation else {
        return pending(PendingReason::ModelObservationMissing);
    };
    validate_model(&observation.model)?;
    validate_target(&observation.target, observation.property)?;
    observation.value.validate()?;
    if observation.model != *current_model {
        return pending(PendingReason::ObservationStale);
    }
    if observation.target != assertion.target
        || observation.property != assertion.property
        || !digest(&observation.feature_sha256)
    {
        return review(ReviewReason::SemanticTargetUnresolved);
    }
    if observation.value.compare(&assertion.value)? != Ordering::Equal {
        return pending(PendingReason::ActualValueDiffers);
    }
    let Some(correspondence) = correspondence else {
        return if assertion.value.kind == QuantityKind::Area {
            review(ReviewReason::AreaNeedsShapeReview)
        } else {
            pending(PendingReason::CorrespondenceMissing)
        };
    };
    // Exact lexical observation equality also binds the receipt to the native
    // reader's original numeric token/unit. Equal display values are irrelevant.
    if correspondence.assertion != assertion.version || correspondence.observation != *observation {
        return pending(PendingReason::CorrespondenceStale);
    }
    if correspondence.geometry_review == GeometryReview::Unreviewed {
        return review(if assertion.value.kind == QuantityKind::Area {
            ReviewReason::AreaNeedsShapeReview
        } else {
            ReviewReason::GeometryNeedsReview
        });
    }
    if current_model.custody == ModelCustody::Unknown {
        return pending(PendingReason::NativeCustodyUnknown);
    }
    if current_model.physical_registration == PhysicalRegistration::Unknown {
        return pending(PendingReason::PhysicalRegistrationUnknown);
    }
    let evidence = &correspondence.verification_evidence;
    if evidence.record.record_type != RecordRefRecordType::Evidence
        || v2::validate(&evidence.record).is_err()
        || !(1..=9_007_199_254_740_991).contains(&evidence.revision)
        || !digest(&evidence.payload_sha256)
    {
        return Err(ValidationError("invalid native verification evidence pin"));
    }
    let support = SupportQualificationRequest {
        assertion,
        retained_support: &assertion.support,
        inherited_inputs: &assertion.inputs,
        evidence_roles_and_revisions: &assertion.evidence,
        history,
        reviewed_dispositions: &reviewed_dispositions,
    };
    match authority.qualify_support(&support) {
        SupportQualificationVerdict::Qualified => {}
        SupportQualificationVerdict::UnresolvedDispute => {
            return review(ReviewReason::SupportDisputeUnresolved);
        }
        SupportQualificationVerdict::Refused => {
            return pending(PendingReason::SupportQualificationRefused);
        }
        SupportQualificationVerdict::Unavailable => {
            return pending(PendingReason::SupportQualificationUnavailable);
        }
    }
    match authority.verify(assertion, observation, correspondence, &support) {
        CorrespondenceVerdict::Verified => assess(ModelUpdateState::ClosureEligible {
            verification_evidence: evidence.clone(),
            resolution_evidence,
        }),
        CorrespondenceVerdict::NotVerified => pending(PendingReason::CorrespondenceNotVerified),
        CorrespondenceVerdict::Unavailable => pending(PendingReason::VerificationUnavailable),
    }
}
