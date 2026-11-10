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
/// Read-only results carry no selections or review-intent authority.
pub fn disclose_review(
    review: &ReviewProposal,
    current: &AdmittedSnapshot,
    inspectable: &BTreeSet<String>,
) -> Result<ReviewDisclosure, SuggestionError> {
    review.revalidate(current)?;
    let p = review.proposal();
    let input = review.input();
    let revision = format!("{:x}", Sha256::digest(serde_jcs::to_vec(p)
        .map_err(|_| SuggestionError::InvalidOutput)?));
    if review.is_source_free_answer() {
        if !inspectable.is_empty() { return Err(SuggestionError::UnadmittedReference); }
        let ProposalResult::Answer { route, coverage, .. } = &p.result else { return Err(SuggestionError::InvalidOutput); };
        // This version-1 display DTO already supports empty sources. Do not
        // invent subject metadata, citations, inspection or selection bindings.
        return bounded_disclosure(json!({"schemaVersion":1,"contextPin":p.context_pin,"view":{
            "key":format!("review:{revision}"),"revision":revision,"sourceSetRevision":p.context_pin,
            "kind":"answer","title":"More context needed","sources":[],"fields":[],"candidates":[],
            "uncertainty":p.missing_evidence,"uncalibratedScore":null,
            "answer":{"route":route,"coverage":coverage,"rankedCandidates":[],"statements":[],"missingEvidence":p.missing_evidence}
        },"inspections":{},"selections":{},"rankings":{}}));
    }
    let subject_ref = p.subject_ref.as_deref().ok_or(SuggestionError::InvalidOutput)?;
    let subject = input.sources.iter().find(|s| s.input_ref == subject_ref)
        .ok_or(SuggestionError::UnadmittedReference)?;
    let mut fields = Vec::new();
    let mut candidates = Vec::new();
    let mut maintenance = Vec::new();
    let mut answer = None;
    let mut rankings = BTreeMap::new();
    let mut contradictions = None;
    let mut comparisons = BTreeMap::new();
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
                    DuplicateRelationship::SameProductIdentityUnknown => "same-product-identity-unknown",
                    DuplicateRelationship::PossibleSameItem | DuplicateRelationship::Ambiguous => "possible-duplicate",
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
        ProposalResult::Maintenance { tasks } => {
            for (index, task) in tasks.iter().enumerate() {
                let (reason, evidence) = support(&task.support, &[])?;
                used.extend(evidence.iter().cloned());
                let key = format!("maintenance:{index}:{}", task.candidate_ref);
                maintenance.push(json!({"key":key,"targetKey":task.candidate_ref,
                    "targetLabel":format!("Maintenance target {}", source(&task.candidate_ref)?.input_ref),
                    "title":task.title,"interval":task.interval,"conditions":task.conditions,
                    "urgency":task.urgency,"reason":reason,"uncertainty":format!("{:?}",task.support.uncertainty),
                    "evidenceKeys":evidence,"baselineDate":null}));
                selections.insert(key, json!({"kind":"maintenance-task","inputRef":task.candidate_ref,"taskIndex":index}));
            }
            "maintenance"
        }
        ProposalResult::Answer { route, ranked_refs, coverage, statements } => {
            let mut ranked = Vec::new();
            for (index, id) in ranked_refs.iter().enumerate() {
                let s = source(id)?;
                let key = format!("rank:{id}");
                ranked.push(json!({"key":key,"label":format!("{} · {}",s.input_ref,s.version)}));
                rankings.insert(key, json!({"inputRef":s.input_ref,"version":s.version,"rankIndex":index}));
            }
            let mut supported = Vec::new();
            for (index, statement) in statements.iter().enumerate() {
                let mut evidence = BTreeSet::new();
                for id in &statement.support.claim_refs {
                    let claim = p.claims.iter().find(|c| &c.claim_ref == id)
                        .ok_or(SuggestionError::UnadmittedReference)?;
                    evidence.extend(claim.evidence_refs.iter().cloned());
                }
                used.extend(evidence.iter().cloned());
                supported.push(json!({"key":format!("answer:{index}"),"text":statement.text,
                    "reason":statement.support.rationale,"uncertainty":format!("{:?}",statement.support.uncertainty),
                    "evidenceKeys":evidence}));
            }
            if supported.len() > 16 { return Err(SuggestionError::LimitExceeded); }
            answer = Some(json!({"route":route,"coverage":coverage,"rankedCandidates":ranked,
                "statements":supported,"missingEvidence":p.missing_evidence}));
            "answer"
        }
        ProposalResult::Contradictions { findings } => {
            let mut projected = Vec::new();
            for (index, finding) in findings.iter().enumerate() {
                let canonical_key = review.finding_keys().get(index).ok_or(SuggestionError::InvalidOutput)?;
                let key = format!("finding:{canonical_key}");
                let mut assertions = Vec::new();
                let mut bindings = BTreeMap::new();
                for id in &finding.claim_refs {
                    let claim = p.claims.iter().find(|c| &c.claim_ref == id)
                        .ok_or(SuggestionError::UnadmittedReference)?;
                    let s = source(&claim.source_ref)?;
                    used.extend(claim.evidence_refs.iter().cloned());
                    assertions.push(json!({"key":claim.claim_ref,"inputKey":claim.source_ref,
                        "text":claim.text,"uncertainty":claim.uncertainty,"factDate":null,
                        "evidenceKeys":claim.evidence_refs}));
                    bindings.insert(claim.claim_ref.clone(), json!({"inputRef":s.input_ref,
                        "version":s.version,"evidenceRefs":claim.evidence_refs}));
                }
                projected.push(json!({"key":key,"pattern":finding.pattern,"assertions":assertions,
                    "rationale":finding.rationale,"uncertainty":finding.uncertainty}));
                comparisons.insert(key, json!({"findingKey":canonical_key,"findingIndex":index,"assertions":bindings}));
            }
            contradictions = Some(json!({"findings":projected,"missingEvidence":p.missing_evidence}));
            "contradictions"
        }
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
        let key = format!("subject:{subject_ref}");
        sources.push(json!({"key":key,"label":subject_ref,"recordVersion":subject.version,"sourceDate":subject.source_date,"retrievedAt":subject.retrieved_at,"page":null,"section":null,"excerpt":"","freshness":"snapshot-current","original":"unavailable"}));
        inspections.insert(key, json!({"inputRef":subject.input_ref,"version":subject.version,"evidenceRef":null,"location":null}));
    }
    let mut uncertainty = p.missing_evidence.clone();
    uncertainty.push("Extracted claims and associations are proposals, not verified identity, physical placement or tested wiring.".into());
    if kind == "maintenance" {
        uncertainty.push("Service baseline unknown; no due date, task creation or scheduling is inferred.".into());
    }
    if sources.len() > 16 || fields.len() > 16 || candidates.len() > 16 || maintenance.len() > 16 || uncertainty.len() > 16 { return Err(SuggestionError::LimitExceeded); }
    let mut disclosure = json!({"schemaVersion":1,"contextPin":p.context_pin,"view":{
        "key":format!("review:{revision}"),"revision":revision,"sourceSetRevision":p.context_pin,"kind":kind,
        "title":match kind {"inventory"=>"Inventory suggestions","maintenance"=>"Maintenance suggestions","answer"=>"Cited answer","contradictions"=>"Comparison candidates",_=>"Document suggestions"},
        "sources":sources,"fields":fields,"candidates":candidates,"uncertainty":uncertainty,"uncalibratedScore":null
    },"inspections":inspections,"selections":selections});
    if kind == "maintenance" { disclosure["view"]["maintenance"] = json!(maintenance); }
    if let Some(answer) = answer {
        disclosure["view"]["answer"] = answer;
        disclosure["rankings"] = json!(rankings);
    }
    if let Some(contradictions) = contradictions {
        disclosure["view"]["contradictions"] = contradictions;
        disclosure["comparisons"] = json!(comparisons);
    }
    bounded_disclosure(disclosure)
}

fn bounded_disclosure(disclosure: Value) -> Result<ReviewDisclosure, SuggestionError> {
    if serde_json::to_vec(&disclosure).map_err(|_| SuggestionError::InvalidOutput)?.len() > MAX_OUTPUT_BYTES { return Err(SuggestionError::LimitExceeded); }
    Ok(ReviewDisclosure(disclosure))
}
