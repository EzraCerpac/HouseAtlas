//! Projection of a validated proposal into #569's local presentation seam.
//! No route, original-open capability, human approval or native action is issued.
use super::*;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Only this fresh-source projection constructs the serializable display DTO.
/// The receiving owner still authenticates/revalidates every inspect/intent.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct ReviewDisclosure(Value);
impl ReviewDisclosure {
    pub fn value(&self) -> &Value { &self.0 }
}

/// `inspectable` is supplied by the current original owner, never the model.
/// Its IDs only label availability; they confer no original-open authority.
/// Non-inventory/document variants are deliberately refused by this consumer.
pub fn disclose_review(
    review: &ReviewProposal,
    current: &AdmittedSnapshot,
    inspectable: &BTreeSet<String>,
) -> Result<ReviewDisclosure, SuggestionError> {
    review.revalidate(current)?;
    let p = review.proposal();
    let input = review.input();
    let subject = input.sources.iter().find(|s| s.input_ref == p.subject_ref)
        .ok_or(SuggestionError::UnadmittedReference)?;
    let revision = format!("{:x}", Sha256::digest(serde_jcs::to_vec(p)
        .map_err(|_| SuggestionError::InvalidOutput)?));
    let mut fields = Vec::new();
    let mut candidates = Vec::new();
    let mut selections = BTreeMap::new();
    let mut used = BTreeSet::new();
    let source = |id: &str| input.sources.iter().find(|s| s.input_ref == id)
        .ok_or(SuggestionError::UnadmittedReference);
    let support = |support: &Support, contrary: &[String]| -> Result<(String, Vec<String>), SuggestionError> {
        let mut reason = support.rationale.clone();
        let mut citations = BTreeSet::new();
        for (ids, label) in [(&support.claim_refs[..], "Extracted claim"), (contrary, "Contradicting extracted claim")] {
            for id in ids {
                let claim = p.claims.iter().find(|c| &c.claim_ref == id)
                    .ok_or(SuggestionError::UnadmittedReference)?;
                reason.push_str(&format!("\n{label} ({:?}): {}", claim.uncertainty, claim.text));
                citations.extend(claim.evidence_refs.iter().cloned());
            }
        }
        if reason.len() > 4096 || citations.len() > 16 { return Err(SuggestionError::LimitExceeded); }
        Ok((reason, citations.into_iter().collect()))
    };
    let kind = match &p.result {
        ProposalResult::Inventory { changes, duplicates } => {
            for change in changes {
                let (key, label, value, s) = match change {
                    InventoryChange::Category { value, support } => ("category", "Category", value.clone(), support),
                    InventoryChange::Tags { values, support } => ("tags", "Tags (JSON list)", serde_json::to_string(values).map_err(|_| SuggestionError::InvalidOutput)?, support),
                    InventoryChange::Container { candidate_ref, support: s } => {
                        let (reason, evidence) = support(s, &[])?;
                        used.extend(evidence.iter().cloned());
                        let key = format!("container:{candidate_ref}");
                        candidates.push(json!({"key":key,"label":format!("Container candidate {}", source(candidate_ref)?.input_ref),"relation":"proposed-association","reason":reason,"uncertainty":format!("{:?}",s.uncertainty),"evidenceKeys":evidence}));
                        selections.insert(key, json!({"kind":"inventory-container","inputRef":candidate_ref}));
                        continue;
                    }
                };
                let (reason, evidence) = support(s, &[])?;
                used.extend(evidence.iter().cloned());
                fields.push(json!({"key":key,"label":label,"current":null,"proposed":value,"reason":reason,"uncertainty":format!("{:?}",s.uncertainty),"evidenceKeys":evidence}));
                selections.insert(key.into(), json!({"kind":format!("inventory-{key}"),"inputRef":p.subject_ref}));
            }
            for duplicate in duplicates {
                let (mut reason, evidence) = support(&duplicate.supporting, &duplicate.contradicting_claim_refs)?;
                reason.push_str(&format!("\nProposed relationship: {:?}. Identity remains subject to review.", duplicate.relationship));
                if reason.len() > 4096 { return Err(SuggestionError::LimitExceeded); }
                used.extend(evidence.iter().cloned());
                let key = format!("duplicate:{}", duplicate.candidate_ref);
                let relation = match duplicate.relationship {
                    DuplicateRelationship::SameProductDistinctItem => "same-product",
                    _ => "possible-duplicate",
                };
                candidates.push(json!({"key":key,"label":format!("Inventory candidate {}",source(&duplicate.candidate_ref)?.input_ref),"relation":relation,"reason":reason,"uncertainty":format!("{:?}",duplicate.supporting.uncertainty),"evidenceKeys":evidence}));
                selections.insert(key, json!({"kind":"inventory-duplicate","inputRef":duplicate.candidate_ref}));
            }
            "inventory"
        }
        ProposalResult::Document { classification, links } => {
            if let Some(classification) = classification {
                let (reason, evidence) = support(&classification.support, &[])?;
                used.extend(evidence.iter().cloned());
                let category = serde_json::to_value(classification.category).map_err(|_| SuggestionError::InvalidOutput)?;
                fields.push(json!({"key":"document-class","label":"Document category","current":null,"proposed":category,"reason":reason,"uncertainty":format!("{:?}",classification.support.uncertainty),"evidenceKeys":evidence}));
                selections.insert("document-class".into(), json!({"kind":"document-class","inputRef":p.subject_ref}));
            }
            for link in links {
                let (reason, evidence) = support(&link.support, &[])?;
                used.extend(evidence.iter().cloned());
                let key = format!("document-link:{}", link.candidate_ref);
                candidates.push(json!({"key":key,"label":format!("Association candidate {}",source(&link.candidate_ref)?.input_ref),"relation":"proposed-association","reason":reason,"uncertainty":format!("{:?}",link.support.uncertainty),"evidenceKeys":evidence}));
                selections.insert(key, json!({"kind":"document-link","inputRef":link.candidate_ref}));
            }
            "document"
        }
        _ => return Err(SuggestionError::InvalidOutput),
    };
    let all_evidence: BTreeSet<_> = input.sources.iter().flat_map(|s| s.evidence.iter().map(|e| e.evidence_ref.clone())).collect();
    if !inspectable.is_subset(&all_evidence) { return Err(SuggestionError::UnadmittedReference); }
    let mut sources = Vec::new();
    let mut inspections = BTreeMap::new();
    for s in &input.sources {
        for e in &s.evidence {
            if !used.contains(&e.evidence_ref) { continue; }
            let (page, section) = match e.location {
                EvidenceLocation::Page { page, .. } => (Some(page), None),
                EvidenceLocation::TextRange { start, end, text_length } => (None, Some(format!("Text characters {start}–{end} of {text_length}"))),
                EvidenceLocation::Record => (None, None),
            };
            sources.push(json!({"key":e.evidence_ref,"label":format!("{} · {}",s.input_ref,s.version),"recordVersion":s.version,"sourceDate":s.source_date,"retrievedAt":s.retrieved_at,"page":page,"section":section,"excerpt":e.excerpt,"freshness":"snapshot-current","original":if inspectable.contains(&e.evidence_ref) {"available"} else {"unavailable"}}));
            inspections.insert(e.evidence_ref.clone(), json!({"inputRef":s.input_ref,"version":s.version,"evidenceRef":e.evidence_ref,"location":e.location}));
        }
    }
    if sources.is_empty() {
        let key = format!("subject:{}",p.subject_ref);
        sources.push(json!({"key":key,"label":p.subject_ref,"recordVersion":subject.version,"sourceDate":subject.source_date,"retrievedAt":subject.retrieved_at,"page":null,"section":null,"excerpt":"","freshness":"snapshot-current","original":"unavailable"}));
        inspections.insert(key, json!({"inputRef":subject.input_ref,"version":subject.version,"evidenceRef":null,"location":null}));
    }
    let mut uncertainty = p.missing_evidence.clone();
    uncertainty.push("Extracted claims and associations are proposals, not verified identity, physical placement or tested wiring.".into());
    if sources.len() > 16 || fields.len() > 16 || candidates.len() > 16 || uncertainty.len() > 16 { return Err(SuggestionError::LimitExceeded); }
    let disclosure = json!({"schemaVersion":1,"contextPin":p.context_pin,"view":{
        "key":format!("review:{revision}"),"revision":revision,"sourceSetRevision":p.context_pin,"kind":kind,
        "title":if kind=="inventory" {"Inventory suggestions"} else {"Document suggestions"},
        "sources":sources,"fields":fields,"candidates":candidates,"uncertainty":uncertainty,"uncalibratedScore":null
    },"inspections":inspections,"selections":selections});
    if serde_json::to_vec(&disclosure).map_err(|_| SuggestionError::InvalidOutput)?.len() > MAX_OUTPUT_BYTES { return Err(SuggestionError::LimitExceeded); }
    Ok(ReviewDisclosure(disclosure))
}
