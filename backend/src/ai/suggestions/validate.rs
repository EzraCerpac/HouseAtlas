use super::types::*;
use crate::{
    contracts::stock::{AtlasTarget, HomeboxResourceKind, StockTarget, StockValidation},
    domain::RecordType,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuggestionError {
    InvalidSnapshot,
    InvalidOutput,
    LimitExceeded,
    ContextChanged,
    ContextUnavailable,
    ContextWithdrawn,
    UnadmittedReference,
    MissingSupport,
}
impl std::fmt::Display for SuggestionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "suggestion validation: {self:?}")
    }
}
impl std::error::Error for SuggestionError {}
type Result<T> = std::result::Result<T, SuggestionError>;

/// A structural admission, not authentication. The caller must obtain these
/// exact inputs from its existing current Access/source owners. No Deserialize
/// implementation lets generated output masquerade as this snapshot.
#[derive(Clone, Debug)]
pub struct AdmittedSnapshot {
    input: SnapshotInput,
    pin: String,
    question: Option<QuestionBinding>,
}
impl AdmittedSnapshot {
    pub fn new(input: SnapshotInput) -> Result<Self> {
        let invalid = || SuggestionError::InvalidSnapshot;
        if input.sources.is_empty() || input.sources.len() > 64 {
            return Err(invalid());
        }
        let validator = StockValidation::new().map_err(|_| invalid())?;
        validator.validate("#/$defs/contextSelection", &serde_json::to_value(&input.scope).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
        if uuid::Uuid::parse_str(&input.actor_id).is_err() || !text(&input.authority_epoch, 128) {
            return Err(invalid());
        }
        let mut refs = BTreeSet::new();
        let mut targets = BTreeSet::new();
        let mut evidence_refs = BTreeSet::new();
        let mut subjects = 0;
        for source in &input.sources {
            let target = serde_json::to_value(&source.target).map_err(|_| invalid())?;
            validator.validate("#/$defs/target", &target).map_err(|_| invalid())?;
            let individual = match &source.target {
                StockTarget::Atlas { target: AtlasTarget::Record { record_id: Some(_), .. } } => true,
                StockTarget::Homebox { resource_kind: HomeboxResourceKind::Entity, entity_id: Some(_), resource_id: None, .. } => true,
                StockTarget::Homebox { resource_kind, resource_id: Some(_), .. } => *resource_kind != HomeboxResourceKind::Entity,
                StockTarget::Network { resource_id: Some(_), .. } => true,
                _ => false,
            };
            if !individual || !reference(&source.input_ref) || !refs.insert(&source.input_ref)
                || !targets.insert(serde_json::to_string(&target).map_err(|_| invalid())?)
                || !text(&source.version, 256) || !timestamp(&source.retrieved_at)
                || source.source_date.as_ref().is_some_and(|d| !date(d))
                || source.evidence.len() > 64
            {
                return Err(invalid());
            }
            subjects += usize::from(source.role == InputRole::Subject);
            for evidence in &source.evidence {
                if !reference(&evidence.evidence_ref) || !evidence_refs.insert(&evidence.evidence_ref)
                    || !text(&evidence.excerpt, 4096)
                    || evidence.record.as_ref().is_some_and(|r| r.record_type != RecordType::Evidence || uuid::Uuid::parse_str(&r.record_id).is_err())
                {
                    return Err(invalid());
                }
                match evidence.location {
                    EvidenceLocation::Page { page, page_count } if page == 0 || page > page_count || page_count > 100_000 => return Err(invalid()),
                    EvidenceLocation::TextRange { start, end, text_length } if start >= end || end > text_length => return Err(invalid()),
                    _ => {}
                }
            }
        }
        if subjects != 1 { return Err(invalid()); }
        let bytes = serde_jcs::to_vec(&input).map_err(|_| invalid())?;
        if bytes.len() > 1_048_576 { return Err(SuggestionError::LimitExceeded); }
        let pin = format!("{:x}", Sha256::digest(bytes));
        Ok(Self { input, pin, question: None })
    }
    /// Explicit structural source-free admission only. Neither these metadata
    /// nor a copied pin prove an active authorized question. Host/session owners
    /// remain unbound and must supply fresh request/epoch/cancellation checks.
    pub fn source_free_answer(input: SnapshotInput, question: QuestionBinding) -> Result<Self> {
        let invalid = || SuggestionError::InvalidSnapshot;
        if input.feature != SuggestionFeature::Answer || !input.sources.is_empty()
            || uuid::Uuid::parse_str(&input.actor_id).is_err() || !text(&input.authority_epoch, 128)
            || !text(&question.request_id, 128) || !text(&question.registration_id, 128)
            || !text(&question.cancellation_epoch, 128)
            || question.query_sha256.len() != 64
            || !question.query_sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        { return Err(invalid()); }
        let validator = StockValidation::new().map_err(|_| invalid())?;
        validator.validate("#/$defs/contextSelection", &serde_json::to_value(&input.scope).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
        // Record-backed v1 pins are unchanged. Empty questions are separately
        // domain tagged and include request/query identity and both epochs.
        let bytes = serde_jcs::to_vec(&("houseatlas-source-free-answer-v2", &input, &question)).map_err(|_| invalid())?;
        let pin = format!("{:x}", Sha256::digest(bytes));
        Ok(Self { input, pin, question: Some(question) })
    }
    pub(crate) fn is_source_free_answer(&self) -> bool { self.question.is_some() }
    pub fn context_pin(&self) -> &str { &self.pin }
    pub fn input(&self) -> &SnapshotInput { &self.input }
}

/// Immutable validated presentation data only. Revalidation is also required
/// at disclosure and before a native workflow; this is never an apply receipt.
#[derive(Debug)]
pub struct ReviewProposal {
    proposal: GeneratedProposal,
    admitted: AdmittedSnapshot,
    finding_keys: Vec<String>,
}
impl ReviewProposal {
    pub fn proposal(&self) -> &GeneratedProposal { &self.proposal }
    pub fn finding_keys(&self) -> &[String] { &self.finding_keys }
    pub fn input(&self) -> &SnapshotInput { self.admitted.input() }
    pub(crate) fn is_source_free_answer(&self) -> bool { self.admitted.is_source_free_answer() }
    pub fn revalidate(&self, current: &AdmittedSnapshot) -> Result<()> {
        recheck(&self.proposal, &self.admitted, current)
    }
}

/// `current` must be freshly obtained from the same original read/access owner.
/// Passing an old clone cannot establish freshness; this pure function does no
/// IO, no account check and no runtime/credential or application activation.
pub fn validate_generated(bytes: &[u8], admitted: &AdmittedSnapshot, current: &AdmittedSnapshot) -> Result<ReviewProposal> {
    if bytes.len() > MAX_OUTPUT_BYTES { return Err(SuggestionError::LimitExceeded); }
    // Decode directly into closed types: serde rejects duplicate struct fields,
    // unknown nested fields, wrong scalar types and trailing JSON values.
    let output: GeneratedProposal = serde_json::from_slice(bytes).map_err(|_| SuggestionError::InvalidOutput)?;
    recheck(&output, admitted, current)?;
    if admitted.is_source_free_answer() {
        if output.subject_ref.is_some() || !output.claims.is_empty() { return Err(SuggestionError::InvalidOutput); }
        strings(&output.missing_evidence, 16, 1024)?;
        if output.missing_evidence.is_empty() { return Err(SuggestionError::MissingSupport); }
        match &output.result {
            ProposalResult::Answer { route, ranked_refs, coverage, statements }
                if matches!(route, QuestionRoute::Clarify | QuestionRoute::Unknown)
                    && *coverage == AnswerCoverage::NoAnswer && ranked_refs.is_empty() && statements.is_empty() => {},
            _ => return Err(SuggestionError::InvalidOutput),
        }
        return Ok(ReviewProposal { proposal: output, admitted: admitted.clone(), finding_keys: vec![] });
    }
    let subject_ref = output.subject_ref.as_deref().ok_or(SuggestionError::InvalidOutput)?;
    let sources: BTreeMap<_, _> = admitted.input.sources.iter().map(|s| (s.input_ref.as_str(), s)).collect();
    let subject = sources.get(subject_ref).ok_or(SuggestionError::UnadmittedReference)?;
    if subject.role != InputRole::Subject { return Err(SuggestionError::UnadmittedReference); }
    available(subject)?;
    bounded(&output.claims, 64)?;
    strings(&output.missing_evidence, 16, 1024)?;
    let mut claims = BTreeMap::new();
    for claim in &output.claims {
        if !reference(&claim.claim_ref) || !text(&claim.text, 2048) || claims.insert(claim.claim_ref.as_str(), claim).is_some() {
            return Err(SuggestionError::InvalidOutput);
        }
        let source = sources.get(claim.source_ref.as_str()).ok_or(SuggestionError::UnadmittedReference)?;
        available(source)?;
        nonempty_unique(&claim.evidence_refs, 16)?;
        for id in &claim.evidence_refs {
            if !source.evidence.iter().any(|e| &e.evidence_ref == id) { return Err(SuggestionError::UnadmittedReference); }
        }
    }
    let checks = Checks { sources: &sources, claims: &claims, subject: subject_ref };
    let count;
    let mut finding_keys = Vec::new();
    match &output.result {
        ProposalResult::Inventory { changes, duplicates } => {
            if subject.kind != CandidateKind::InventoryItem { return Err(SuggestionError::InvalidOutput); }
            bounded(changes, 3)?; bounded(duplicates, 16)?;
            let mut fields = BTreeSet::new();
            for change in changes {
                let (field, support) = match change {
                    InventoryChange::Category { value, support } => { required_text(value, 128)?; ("category", support) }
                    InventoryChange::Tags { values, support } => { nonempty_unique(values, 16)?; strings(values, 16, 128)?; ("tags", support) }
                    InventoryChange::Container { candidate_ref, support } => {
                        checks.candidate(candidate_ref, &[CandidateKind::Container])?;
                        checks.supports_source(support, candidate_ref, false)?;
                        ("container", support)
                    }
                };
                if !fields.insert(field) { return Err(SuggestionError::InvalidOutput); }
                checks.support(support)?;
                checks.supports_source(support, checks.subject, false)?;
            }
            let mut candidates = BTreeSet::new();
            for candidate in duplicates {
                checks.candidate(&candidate.candidate_ref, &[CandidateKind::InventoryItem])?;
                if !candidates.insert(&candidate.candidate_ref) { return Err(SuggestionError::InvalidOutput); }
                checks.support(&candidate.supporting)?;
                checks.supports_source(&candidate.supporting, checks.subject, false)?;
                checks.supports_source(&candidate.supporting, &candidate.candidate_ref, false)?;
                unique(&candidate.contradicting_claim_refs, 16)?;
                for id in &candidate.contradicting_claim_refs { checks.claim(id)?; }
            }
            count = changes.len() + duplicates.len();
        }
        ProposalResult::Document { classification, links } => {
            if subject.kind != CandidateKind::Document { return Err(SuggestionError::InvalidOutput); }
            bounded(links, 16)?;
            if let Some(classification) = classification {
                checks.support(&classification.support)?;
                checks.supports_source(&classification.support, checks.subject, true)?;
            }
            let mut candidates = BTreeSet::new();
            for link in links {
                checks.candidate(&link.candidate_ref, &[CandidateKind::InventoryItem, CandidateKind::Container])?;
                if !candidates.insert(&link.candidate_ref) { return Err(SuggestionError::InvalidOutput); }
                checks.support(&link.support)?;
                checks.supports_source(&link.support, checks.subject, true)?;
                checks.supports_source(&link.support, &link.candidate_ref, false)?;
            }
            count = links.len() + usize::from(classification.is_some());
        }
        ProposalResult::Maintenance { tasks } => {
            bounded(tasks, 16)?;
            for task in tasks {
                checks.candidate(&task.candidate_ref, &[CandidateKind::InventoryItem, CandidateKind::MaintenanceTask])?;
                required_text(&task.title, 256)?; strings(&task.conditions, 16, 512)?;
                checks.support(&task.support)?;
                checks.supports_source(&task.support, checks.subject, true)?;
                checks.supports_source(&task.support, &task.candidate_ref, false)?;
                match &task.interval {
                    MaintenanceInterval::Periodic { every, .. } if *every == 0 || *every > 100_000 => return Err(SuggestionError::InvalidOutput),
                    MaintenanceInterval::Conditional { condition } => required_text(condition, 1024)?,
                    _ => {}
                }
            }
            count = tasks.len();
        }
        ProposalResult::Answer { route, ranked_refs, coverage, statements } => {
            unique(ranked_refs, 32)?; bounded(statements, 16)?;
            for id in ranked_refs { available(sources.get(id.as_str()).ok_or(SuggestionError::UnadmittedReference)?)?; }
            if (*coverage == AnswerCoverage::NoAnswer) != statements.is_empty()
                || (matches!(route, QuestionRoute::Clarify | QuestionRoute::Unknown) && !statements.is_empty()) {
                return Err(SuggestionError::InvalidOutput);
            }
            for statement in statements { required_text(&statement.text, 2048)?; checks.support(&statement.support)?; }
            count = statements.len();
        }
        ProposalResult::Contradictions { findings } => {
            bounded(findings, 16)?;
            for finding in findings {
                required_text(&finding.rationale, 1024)?; nonempty_unique(&finding.claim_refs, 16)?;
                let mut sides = BTreeSet::new();
                let mut identities = Vec::new();
                for id in &finding.claim_refs {
                    let claim = checks.claim(id)?;
                    sides.insert(&claim.source_ref);
                    let source = sources[claim.source_ref.as_str()];
                    let mut evidence: Vec<_> = source.evidence.iter().filter(|e| claim.evidence_refs.contains(&e.evidence_ref)).collect();
                    evidence.sort_by(|a, b| a.evidence_ref.cmp(&b.evidence_ref));
                    identities.push(serde_jcs::to_string(&(source.target.clone(), &source.version, &source.source_date, evidence)).map_err(|_| SuggestionError::InvalidOutput)?);
                }
                if sides.len() < 2 { return Err(SuggestionError::MissingSupport); }
                identities.sort(); identities.dedup();
                // Stable across reretrieval, output ordering and prose changes;
                // changed exact source version/evidence produces a new key.
                let identity = serde_jcs::to_vec(&(&current.input.scope, &finding.pattern, identities)).map_err(|_| SuggestionError::InvalidOutput)?;
                finding_keys.push(format!("{:x}", Sha256::digest(identity)));
            }
            if finding_keys.iter().collect::<BTreeSet<_>>().len() != finding_keys.len() { return Err(SuggestionError::InvalidOutput); }
            count = findings.len();
        }
    }
    if count == 0 && output.missing_evidence.is_empty() { return Err(SuggestionError::MissingSupport); }
    Ok(ReviewProposal { proposal: output, admitted: admitted.clone(), finding_keys })
}

fn recheck(output: &GeneratedProposal, admitted: &AdmittedSnapshot, current: &AdmittedSnapshot) -> Result<()> {
    if current.input.sources.iter().any(|s| s.availability == Availability::Withdrawn) { return Err(SuggestionError::ContextWithdrawn); }
    if current.input.sources.iter().any(|s| s.role == InputRole::Subject && s.availability != Availability::Available) { return Err(SuggestionError::ContextUnavailable); }
    let version = if admitted.is_source_free_answer() { SOURCE_FREE_ANSWER_SCHEMA_VERSION } else { SCHEMA_VERSION };
    if output.schema_version != version || output.result.feature() != admitted.input.feature { return Err(SuggestionError::InvalidOutput); }
    if admitted.is_source_free_answer() != current.is_source_free_answer() { return Err(SuggestionError::ContextChanged); }
    if output.context_pin != admitted.pin || admitted.pin != current.pin { return Err(SuggestionError::ContextChanged); }
    Ok(())
}

struct Checks<'a> {
    sources: &'a BTreeMap<&'a str, &'a SourceInput>,
    claims: &'a BTreeMap<&'a str, &'a ExtractedClaim>,
    subject: &'a str,
}
impl Checks<'_> {
    fn claim(&self, id: &str) -> Result<&ExtractedClaim> { self.claims.get(id).copied().ok_or(SuggestionError::UnadmittedReference) }
    fn candidate(&self, id: &str, kinds: &[CandidateKind]) -> Result<()> {
        let source = self.sources.get(id).ok_or(SuggestionError::UnadmittedReference)?;
        available(source)?;
        if source.role != InputRole::Candidate || !kinds.contains(&source.kind) { return Err(SuggestionError::UnadmittedReference); }
        Ok(())
    }
    fn support(&self, support: &Support) -> Result<()> {
        nonempty_unique(&support.claim_refs, 16)?; required_text(&support.rationale, 1024)?;
        for id in &support.claim_refs { self.claim(id)?; }
        Ok(())
    }
    fn supports_source(&self, support: &Support, source: &str, content: bool) -> Result<()> {
        for id in &support.claim_refs {
            let claim = self.claim(id)?;
            if claim.source_ref == source && (!content || self.sources[source].evidence.iter().any(|e| claim.evidence_refs.contains(&e.evidence_ref) && e.basis == EvidenceBasis::Content)) { return Ok(()); }
        }
        Err(SuggestionError::MissingSupport)
    }
}
fn available(source: &SourceInput) -> Result<()> {
    match source.availability {
        Availability::Available => Ok(()),
        Availability::Unavailable => Err(SuggestionError::ContextUnavailable),
        Availability::Withdrawn => Err(SuggestionError::ContextWithdrawn),
    }
}
fn text(s: &str, max: usize) -> bool { !s.trim().is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\t')) }
fn reference(s: &str) -> bool { !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')) }
fn timestamp(s: &str) -> bool { chrono::DateTime::parse_from_rfc3339(s).is_ok() }
fn date(s: &str) -> bool { timestamp(s) || chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() }
fn required_text(s: &str, max: usize) -> Result<()> { if text(s, max) { Ok(()) } else { Err(SuggestionError::InvalidOutput) } }
fn bounded<T>(items: &[T], max: usize) -> Result<()> { if items.len() <= max { Ok(()) } else { Err(SuggestionError::LimitExceeded) } }
fn unique(items: &[String], max: usize) -> Result<()> {
    bounded(items, max)?;
    if items.iter().any(|s| !text(s, 128)) || items.iter().collect::<BTreeSet<_>>().len() != items.len() { Err(SuggestionError::InvalidOutput) } else { Ok(()) }
}
fn nonempty_unique(items: &[String], max: usize) -> Result<()> { unique(items, max)?; if items.is_empty() { Err(SuggestionError::MissingSupport) } else { Ok(()) } }
fn strings(items: &[String], max: usize, width: usize) -> Result<()> { bounded(items, max)?; for s in items { required_text(s, width)?; } Ok(()) }
