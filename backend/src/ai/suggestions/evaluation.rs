//! Generated-data evaluation of deliberately SUPPLIED proposals, not a model.
//! Uses the canonical validator; no inference, prompt, API, threshold, calibrated
//! probability, host, write or corpus publication is installed here.
use super::*;
use crate::contracts::stock::StockTarget;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize)]
pub struct AnnotationBasis {
    pub evidence_refs: Vec<String>,
    pub rationale: String,
}
/// Required labels are a subset of allowed labels. Ambiguous alternatives can
/// be allowed without requiring every alternative. Forbidden labels are unsafe
/// proposals according to this fictional annotation, not native action outcomes.
#[derive(Clone, Debug, Default, Serialize)]
pub struct ExpectedSet {
    pub required: BTreeSet<String>,
    pub allowed: BTreeSet<String>,
    pub forbidden: BTreeSet<String>,
    pub basis: BTreeMap<String, AnnotationBasis>,
}
#[derive(Clone, Copy, Debug, Serialize)]
pub enum ExpectedValidation {
    Accept,
    Refuse,
}
#[derive(Clone, Copy, Debug, Serialize)]
pub enum ExpectedAbstention {
    Required,
    Allowed,
    Forbidden,
}
#[derive(Clone, Debug, Serialize)]
pub struct Labels {
    pub case_id: String,
    pub source_context_pin: String,
    pub validation: ExpectedValidation,
    pub classification: ExpectedSet,
    /// Keys use duplicate_label(), retaining all four distinct relationships.
    pub duplicate_relationships: ExpectedSet,
    pub document_associations: ExpectedSet,
    pub abstention: ExpectedAbstention,
    pub abstention_basis: AnnotationBasis,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvaluationError {
    UnsupportedFeature,
    InvalidLabels,
    SourcePinMismatch,
}
impl std::fmt::Display for EvaluationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Synthetic proposal evaluation: {self:?}")
    }
}
impl std::error::Error for EvaluationError {}
type Result<T> = std::result::Result<T, EvaluationError>;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SetCounts {
    pub allowed_predictions: usize,
    pub unexpected_predictions: usize,
    pub missing_required: usize,
    pub forbidden_proposals: usize,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ValidationCounts {
    pub correct_acceptance: usize,
    pub correct_refusal: usize,
    /// Expected-refused supplied output passed the structural validator. This
    /// is NOT a native approval/dispatch, nor proof the validator checks truth.
    pub unsafe_acceptance: usize,
    pub unexpected_refusal: usize,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AbstentionCounts {
    pub observed: bool,
    pub required_missing: usize,
    pub unexpected: usize,
}
#[derive(Debug, Serialize)]
pub struct SourceStamp {
    pub input_ref: String,
    pub target: StockTarget,
    pub version: String,
    pub source_date: Option<String>,
    pub retrieved_at: String,
    pub availability: Availability,
}
#[derive(Debug, Serialize)]
pub struct CaseReport {
    pub provenance: &'static str,
    pub model_executed: bool,
    pub case_id: String,
    pub feature: SuggestionFeature,
    pub labels_sha256: String,
    pub supplied_output_sha256: String,
    pub admitted_context_pin: String,
    pub current_context_pin: String,
    pub admitted_sources: Vec<SourceStamp>,
    pub current_sources: Vec<SourceStamp>,
    pub validation: ValidationCounts,
    pub refusal_reason: Option<String>,
    /// None means unscored (validator refused or dimension not applicable), not
    /// a zero-error quality result. No combined accuracy/probability is emitted.
    pub classification: Option<SetCounts>,
    pub duplicate_relationships: Option<SetCounts>,
    pub document_associations: Option<SetCounts>,
    pub duplicate_abstained: Option<bool>,
    pub document_association_abstained: Option<bool>,
    pub classification_unknown: Option<bool>,
    pub abstention: Option<AbstentionCounts>,
}

pub fn duplicate_label(candidate_ref: &str, relationship: DuplicateRelationship) -> String {
    let relationship = match relationship {
        DuplicateRelationship::PossibleSameItem => "possible-same-item",
        DuplicateRelationship::SameProductDistinctItem => "same-product-distinct-item",
        DuplicateRelationship::SameProductIdentityUnknown => "same-product-identity-unknown",
        DuplicateRelationship::Ambiguous => "ambiguous",
    };
    format!("{candidate_ref}:{relationship}")
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn nonempty(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.len() <= max
}
fn empty(set: &ExpectedSet) -> bool {
    set.required.is_empty()
        && set.allowed.is_empty()
        && set.forbidden.is_empty()
        && set.basis.is_empty()
}
fn check_labels(labels: &Labels, admitted: &AdmittedSnapshot) -> Result<()> {
    if !matches!(
        admitted.input().feature,
        SuggestionFeature::Inventory | SuggestionFeature::Document
    ) {
        return Err(EvaluationError::UnsupportedFeature);
    }
    if labels.source_context_pin != admitted.context_pin() {
        return Err(EvaluationError::SourcePinMismatch);
    }
    if !nonempty(&labels.case_id, 128) {
        return Err(EvaluationError::InvalidLabels);
    }
    let inventory = admitted.input().feature == SuggestionFeature::Inventory;
    if (inventory && !empty(&labels.document_associations))
        || (!inventory && !empty(&labels.duplicate_relationships))
    {
        return Err(EvaluationError::InvalidLabels);
    }
    if matches!(labels.abstention, ExpectedAbstention::Required)
        && [
            &labels.classification,
            &labels.duplicate_relationships,
            &labels.document_associations,
        ]
        .iter()
        .any(|set| !set.required.is_empty())
    {
        return Err(EvaluationError::InvalidLabels);
    }
    let subject = admitted
        .input()
        .sources
        .iter()
        .find(|s| s.role == InputRole::Subject)
        .ok_or(EvaluationError::InvalidLabels)?;
    let abstention = &labels.abstention_basis;
    if !nonempty(&abstention.rationale, 1024)
        || abstention.evidence_refs.len() > 16
        || abstention
            .evidence_refs
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != abstention.evidence_refs.len()
    {
        return Err(EvaluationError::InvalidLabels);
    }
    if abstention.evidence_refs.is_empty() {
        if !subject.evidence.is_empty()
            || matches!(labels.abstention, ExpectedAbstention::Forbidden)
        {
            return Err(EvaluationError::InvalidLabels);
        }
    } else {
        let mut cites_subject = false;
        for id in &abstention.evidence_refs {
            let source = admitted
                .input()
                .sources
                .iter()
                .find(|s| s.evidence.iter().any(|e| &e.evidence_ref == id))
                .ok_or(EvaluationError::InvalidLabels)?;
            cites_subject |= source.input_ref == subject.input_ref;
        }
        if !cites_subject {
            return Err(EvaluationError::InvalidLabels);
        }
    }
    for (dimension, set) in [
        (0, &labels.classification),
        (1, &labels.duplicate_relationships),
        (2, &labels.document_associations),
    ] {
        if set.allowed.len() > 32
            || set.forbidden.len() > 32
            || !set.required.is_subset(&set.allowed)
            || !set.allowed.is_disjoint(&set.forbidden)
        {
            return Err(EvaluationError::InvalidLabels);
        }
        let keys: BTreeSet<_> = set.allowed.union(&set.forbidden).cloned().collect();
        if keys != set.basis.keys().cloned().collect() {
            return Err(EvaluationError::InvalidLabels);
        }
        for value in keys {
            if !nonempty(&value, 256) {
                return Err(EvaluationError::InvalidLabels);
            }
            let basis = &set.basis[&value];
            if basis.evidence_refs.is_empty()
                || basis.evidence_refs.len() > 16
                || !nonempty(&basis.rationale, 1024)
                || basis.evidence_refs.iter().collect::<BTreeSet<_>>().len()
                    != basis.evidence_refs.len()
            {
                return Err(EvaluationError::InvalidLabels);
            }
            let mut source_refs = BTreeSet::new();
            let mut subject_content = false;
            for evidence in &basis.evidence_refs {
                let (source, e) = admitted
                    .input()
                    .sources
                    .iter()
                    .find_map(|s| {
                        s.evidence
                            .iter()
                            .find(|e| &e.evidence_ref == evidence)
                            .map(|e| (s, e))
                    })
                    .ok_or(EvaluationError::InvalidLabels)?;
                source_refs.insert(source.input_ref.as_str());
                subject_content |=
                    source.input_ref == subject.input_ref && e.basis == EvidenceBasis::Content;
            }
            if !source_refs.contains(subject.input_ref.as_str()) {
                return Err(EvaluationError::InvalidLabels);
            }
            if dimension == 0 {
                if !inventory {
                    let class: DocumentClass =
                        serde_json::from_value(serde_json::Value::String(value))
                            .map_err(|_| EvaluationError::InvalidLabels)?;
                    if matches!(class, DocumentClass::Unknown) || !subject_content {
                        return Err(EvaluationError::InvalidLabels);
                    }
                } else if value.len() > 128 {
                    return Err(EvaluationError::InvalidLabels);
                }
            } else {
                let candidate_ref = if dimension == 1 {
                    let (candidate, relation) = value
                        .split_once(':')
                        .ok_or(EvaluationError::InvalidLabels)?;
                    let _: DuplicateRelationship =
                        serde_json::from_value(serde_json::Value::String(relation.into()))
                            .map_err(|_| EvaluationError::InvalidLabels)?;
                    candidate
                } else {
                    value.as_str()
                };
                let candidate = admitted
                    .input()
                    .sources
                    .iter()
                    .find(|s| s.input_ref == candidate_ref)
                    .ok_or(EvaluationError::InvalidLabels)?;
                if candidate.role != InputRole::Candidate
                    || !source_refs.contains(candidate_ref)
                    || (dimension == 1 && candidate.kind != CandidateKind::InventoryItem)
                    || (dimension == 2
                        && (!matches!(
                            candidate.kind,
                            CandidateKind::InventoryItem | CandidateKind::Container
                        ) || !subject_content))
                {
                    return Err(EvaluationError::InvalidLabels);
                }
            }
        }
    }
    Ok(())
}
fn counts(actual: &BTreeSet<String>, expected: &ExpectedSet) -> SetCounts {
    SetCounts {
        allowed_predictions: actual.intersection(&expected.allowed).count(),
        unexpected_predictions: actual.difference(&expected.allowed).count(),
        missing_required: expected.required.difference(actual).count(),
        forbidden_proposals: actual.intersection(&expected.forbidden).count(),
    }
}
fn stamps(snapshot: &AdmittedSnapshot) -> Vec<SourceStamp> {
    snapshot
        .input()
        .sources
        .iter()
        .map(|s| SourceStamp {
            input_ref: s.input_ref.clone(),
            target: s.target.clone(),
            version: s.version.clone(),
            source_date: s.source_date.clone(),
            retrieved_at: s.retrieved_at.clone(),
            availability: s.availability,
        })
        .collect()
}

/// Scores one explicitly supplied synthetic output against fictional annotations.
/// Annotation references/pins are checked, but semantic truth of rationale must
/// be reviewed against fictional evidence. No model or corpus is executed.
pub fn evaluate_supplied(
    labels: &Labels,
    bytes: &[u8],
    admitted: &AdmittedSnapshot,
    current: &AdmittedSnapshot,
) -> Result<CaseReport> {
    check_labels(labels, admitted)?;
    let outcome = validate_generated(bytes, admitted, current);
    let accepted = outcome.is_ok();
    let validation = match (labels.validation, accepted) {
        (ExpectedValidation::Accept, true) => ValidationCounts {
            correct_acceptance: 1,
            correct_refusal: 0,
            unsafe_acceptance: 0,
            unexpected_refusal: 0,
        },
        (ExpectedValidation::Refuse, false) => ValidationCounts {
            correct_acceptance: 0,
            correct_refusal: 1,
            unsafe_acceptance: 0,
            unexpected_refusal: 0,
        },
        (ExpectedValidation::Refuse, true) => ValidationCounts {
            correct_acceptance: 0,
            correct_refusal: 0,
            unsafe_acceptance: 1,
            unexpected_refusal: 0,
        },
        (ExpectedValidation::Accept, false) => ValidationCounts {
            correct_acceptance: 0,
            correct_refusal: 0,
            unsafe_acceptance: 0,
            unexpected_refusal: 1,
        },
    };
    let mut report = CaseReport {
        provenance: "supplied-synthetic-proposal-only",
        model_executed: false,
        case_id: labels.case_id.clone(),
        feature: admitted.input().feature,
        labels_sha256: hash(
            &serde_jcs::to_vec(labels).map_err(|_| EvaluationError::InvalidLabels)?,
        ),
        supplied_output_sha256: hash(bytes),
        admitted_context_pin: admitted.context_pin().into(),
        current_context_pin: current.context_pin().into(),
        admitted_sources: stamps(admitted),
        current_sources: stamps(current),
        validation,
        refusal_reason: None,
        classification: None,
        duplicate_relationships: None,
        document_associations: None,
        duplicate_abstained: None,
        document_association_abstained: None,
        classification_unknown: None,
        abstention: None,
    };
    let review = match outcome {
        Ok(review) => review,
        Err(error) => {
            report.refusal_reason = Some(format!("{error:?}"));
            return Ok(report);
        }
    };
    let mut classification = BTreeSet::new();
    let mut relationships = BTreeSet::new();
    let mut associations = BTreeSet::new();
    let abstained = match &review.proposal().result {
        ProposalResult::Inventory {
            changes,
            duplicates,
        } => {
            for change in changes {
                if let InventoryChange::Category { value, .. } = change {
                    classification.insert(value.clone());
                }
            }
            for duplicate in duplicates {
                relationships.insert(duplicate_label(
                    &duplicate.candidate_ref,
                    duplicate.relationship,
                ));
            }
            report.duplicate_relationships =
                Some(counts(&relationships, &labels.duplicate_relationships));
            report.duplicate_abstained = Some(relationships.is_empty());
            changes.is_empty() && duplicates.is_empty()
        }
        ProposalResult::Document {
            classification: class,
            links,
        } => {
            if let Some(class) = class {
                if !matches!(class.category, DocumentClass::Unknown) {
                    let value = serde_json::to_value(class.category)
                        .map_err(|_| EvaluationError::InvalidLabels)?;
                    classification
                        .insert(value.as_str().ok_or(EvaluationError::InvalidLabels)?.into());
                }
            }
            associations.extend(links.iter().map(|link| link.candidate_ref.clone()));
            report.document_associations =
                Some(counts(&associations, &labels.document_associations));
            report.document_association_abstained = Some(associations.is_empty());
            classification.is_empty() && links.is_empty()
        }
        _ => return Err(EvaluationError::UnsupportedFeature),
    };
    report.classification = Some(counts(&classification, &labels.classification));
    report.classification_unknown = Some(classification.is_empty());
    report.abstention = Some(AbstentionCounts {
        observed: abstained,
        required_missing: usize::from(
            matches!(labels.abstention, ExpectedAbstention::Required) && !abstained,
        ),
        unexpected: usize::from(
            matches!(labels.abstention, ExpectedAbstention::Forbidden) && abstained,
        ),
    });
    Ok(report)
}

#[cfg(test)]
#[path = "evaluation_healthy.rs"]
mod healthy;

#[cfg(test)]
#[path = "retained_corpus.rs"]
mod retained_corpus;
