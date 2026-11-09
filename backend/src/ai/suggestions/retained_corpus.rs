//! Test-only bridge from the unchanged November 8 annotations to the supplied
//! proposal scorer. This module is never imported into a production runtime.
//! Two cases map allowed labels; three map structural context refusal only.
//! All other cases and unsupported dimensions remain explicitly unscored.
use super::*;
use crate::contracts::stock::{AtlasRecordKind, AtlasTarget, StockContext};
use serde_json::{Value, json};

const CORPUS: &str = include_str!("../../../../tools/ai-feature-evaluation/corpus.json");
const CORPUS_HASH: &str = "d4f4d4c8c66a10c0debe7004ff7e187345af7e4d4305a1774e9bb286c4678291";

fn corpus() -> Value {
    assert_eq!(hash(CORPUS.as_bytes()), CORPUS_HASH);
    serde_json::from_str(CORPUS).unwrap()
}

fn id(n: usize) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

/// Stable evidence identity retains the original source/version/section tuple.
fn evidence_id(source: &str, version: &str, section: &str) -> String {
    format!("{source}-v{version}-{section}")
}

// Exact retained excerpts only. Caller-selected synthetic roles are not grants.
fn source_input(data: &Value, name: &str, version: &str, subject: &str, document: bool) -> SourceInput {
    let source = data["sources"].as_array().unwrap().iter()
        .find(|s| s["id"] == name && s["version"] == version).unwrap();
    assert_eq!(source["readable"], true);
    // First occurrence pins the same fictional target across source versions.
    let position = data["sources"].as_array().unwrap().iter().position(|s| s["id"] == name).unwrap();
    let is_subject = name == subject;
    let evidence = source["sections"].as_object().unwrap().iter().map(|(section, quote)| AdmittedEvidence {
        evidence_ref: evidence_id(name, version, section), record: None,
        // Sections are retained excerpt labels, NOT page/OCR/custody proof.
        location: EvidenceLocation::Record, basis: EvidenceBasis::Content,
        excerpt: quote.as_str().unwrap().into(),
    }).collect();
    SourceInput {
        input_ref: name.into(),
        // Synthetic target join only; source identity/version/date retained.
        target: StockTarget::Atlas { target: AtlasTarget::Record {
            record_type: if document && is_subject { AtlasRecordKind::Asset } else { AtlasRecordKind::Identity },
            record_id: Some(id(position + 1)),
        } },
        version: version.into(),
        source_date: source["source_date"].as_str().map(String::from),
        retrieved_at: source["retrieved_at"].as_str().unwrap().into(),
        availability: Availability::Available,
        role: if is_subject { InputRole::Subject } else { InputRole::Candidate },
        kind: if document && is_subject { CandidateKind::Document } else { CandidateKind::InventoryItem },
        evidence,
    }
}

struct Adapted {
    snapshot: AdmittedSnapshot,
    labels: Labels,
    /// Preserved annotations are not silently converted into scored outcomes.
    unscored: Vec<&'static str>,
}

/// Exact frozen corpus only, not an arbitrary JSON parser or access owner.
/// Both candidate links in doc-ambiguous are allowed alternatives, never
/// required winners. Recall/unique-winner and native action abstentions have
/// no equivalent in this scorer and are explicitly left unscored.
fn adapt(case_id: &str) -> Option<Adapted> {
    let subject = match case_id {
        "inv-identity" => "capture-a",
        "doc-ambiguous" => "manual",
        _ => return None,
    };
    let data = corpus();
    let case = data["cases"].as_array().unwrap().iter().find(|c| c["id"] == case_id).unwrap();
    assert_eq!(case["effects_allowed"], json!([]));
    assert_eq!(case["review_required"], true);
    assert_eq!(case["changed_versions"], json!([]));
    assert_eq!(case["disclosure_revoked"], json!([]));
    let document = case["feature"] == "documents";
    let sources = case["input_sources"].as_array().unwrap().iter().map(|selected| {
        let name = selected["source_id"].as_str().unwrap();
        let version = selected["version"].as_str().unwrap();
        source_input(&data, name, version, subject, document)
    }).collect();
    let snapshot = AdmittedSnapshot::new(SnapshotInput {
        feature: if document { SuggestionFeature::Document } else { SuggestionFeature::Inventory },
        scope: StockContext { workspace_id: id(90), home_id: id(91) },
        actor_id: id(92), authority_epoch: "retained-fictional-corpus-only".into(), sources,
    }).unwrap();
    let subject_evidence = snapshot.input().sources.iter().find(|s| s.input_ref == subject).unwrap()
        .evidence.iter().map(|e| e.evidence_ref.clone()).collect();
    let mut labels = Labels {
        case_id: case_id.into(), source_context_pin: snapshot.context_pin().into(),
        validation: ExpectedValidation::Accept,
        classification: ExpectedSet::default(), duplicate_relationships: ExpectedSet::default(),
        document_associations: ExpectedSet::default(), abstention: ExpectedAbstention::Allowed,
        abstention_basis: AnnotationBasis { evidence_refs: subject_evidence,
            rationale: case["explanation"].as_str().unwrap().into() },
    };
    for claim in case["expected_claims"].as_array().unwrap() {
        let (dimension, value) = match claim["label"].as_str().unwrap() {
            "fan_category" => (0, "fan".to_string()),
            "manual_category" => (0, "manual".to_string()),
            "same_physical_item_candidate" => (1, duplicate_label(claim["candidate_id"].as_str().unwrap(), DuplicateRelationship::PossibleSameItem)),
            "possible_document_link" => (2, claim["candidate_id"].as_str().unwrap().to_string()),
            _ => panic!("unmapped annotation in a mapped case"),
        };
        let evidence_refs = claim["evidence"].as_array().unwrap().iter().map(|citation| {
            let source = citation["source_id"].as_str().unwrap();
            let version = citation["version"].as_str().unwrap();
            let section = citation["section"].as_str().unwrap();
            let evidence = evidence_id(source, version, section);
            let admitted = snapshot.input().sources.iter().find(|s| s.input_ref == source && s.version == version).unwrap();
            assert_eq!(admitted.evidence.iter().find(|e| e.evidence_ref == evidence).unwrap().excerpt, citation["quote"].as_str().unwrap());
            evidence
        }).collect();
        let set = match dimension { 0 => &mut labels.classification, 1 => &mut labels.duplicate_relationships, _ => &mut labels.document_associations };
        set.allowed.insert(value.clone());
        set.basis.insert(value, AnnotationBasis { evidence_refs, rationale: case["explanation"].as_str().unwrap().into() });
    }
    Some(Adapted { snapshot, labels, unscored: vec![
        "positive recall: allowed alternatives are not mandatory winners",
        "candidate-negative labels without claim-specific citation mapping",
        "field-specific abstentions, unknown text, unique-winner selection and native effects",
    ] })
}

fn supplied(case: &Adapted, result: Value) -> Vec<u8> {
    let subject = case.snapshot.input().sources.iter().find(|s| s.role == InputRole::Subject).unwrap();
    let claims: Vec<_> = case.snapshot.input().sources.iter().flat_map(|s| s.evidence.iter().map(move |e| json!({
        "claimRef":e.evidence_ref,"sourceRef":s.input_ref,"evidenceRefs":[e.evidence_ref],
        "text":e.excerpt,"uncertainty":"ambiguous"
    }))).collect();
    serde_json::to_vec(&json!({"schemaVersion":1,"contextPin":case.snapshot.context_pin(),
        "subjectRef":subject.input_ref,"claims":claims,"missingEvidence":["Current physical correspondence unknown"],"result":result})).unwrap()
}

fn support(refs: &[&str]) -> Value {
    json!({"claimRefs":refs,"rationale":"Deliberately supplied fictional proposal; no unique winner or model result","uncertainty":"ambiguous"})
}

struct RefusalAdapted {
    observed: Adapted,
    current: AdmittedSnapshot,
    expected_error: SuggestionError,
}

/// Maps only the original version/withdrawal annotations, not semantic gold.
/// The synthetic projection of disclosure_revoked is not an Access operation.
fn adapt_refusal(case_id: &str) -> Option<RefusalAdapted> {
    let subject = match case_id {
        "inv-stale" | "inv-revoked" => "item-a",
        "doc-revoked" => "invoice",
        _ => return None,
    };
    let data = corpus();
    let case = data["cases"].as_array().unwrap().iter().find(|c| c["id"] == case_id).unwrap();
    assert_eq!(case["expected_claims"], json!([]));
    assert_eq!(case["effects_allowed"], json!([]));
    assert_eq!(case["review_required"], true);
    let document = case["feature"] == "documents";
    let changes = case["changed_versions"].as_array().unwrap();
    let revoked = case["disclosure_revoked"].as_array().unwrap();
    let selected = case["input_sources"].as_array().unwrap();
    let mut seen = BTreeSet::new();
    let mut observed_sources = Vec::new();
    let mut current_sources = Vec::new();
    for input in selected {
        let name = input["source_id"].as_str().unwrap();
        if !seen.insert(name) { continue; }
        let change = changes.iter().find(|c| c["source_id"] == name);
        let observed_version = change.map_or_else(|| input["version"].as_str().unwrap(), |c| c["observed"].as_str().unwrap());
        let current_version = change.map_or(observed_version, |c| c["current"].as_str().unwrap());
        // Both versions must be explicitly selected in the retained annotation.
        for version in [observed_version, current_version] {
            assert!(selected.iter().any(|s| s["source_id"] == name && s["version"] == version));
        }
        observed_sources.push(source_input(&data, name, observed_version, subject, document));
        let mut current = source_input(&data, name, current_version, subject, document);
        if revoked.iter().any(|id| id.as_str() == Some(name)) {
            current.availability = Availability::Withdrawn;
        }
        current_sources.push(current);
    }
    let snapshot = |sources| AdmittedSnapshot::new(SnapshotInput {
        feature: if document { SuggestionFeature::Document } else { SuggestionFeature::Inventory },
        scope: StockContext { workspace_id: id(90), home_id: id(91) },
        actor_id: id(92), authority_epoch: "retained-fictional-corpus-only".into(), sources,
    }).unwrap();
    let observed = snapshot(observed_sources);
    let current = snapshot(current_sources);
    let subject_evidence = observed.input().sources.iter().find(|s| s.input_ref == subject).unwrap()
        .evidence.iter().map(|e| e.evidence_ref.clone()).collect();
    let labels = Labels {
        case_id: case_id.into(), source_context_pin: observed.context_pin().into(),
        validation: ExpectedValidation::Refuse,
        classification: ExpectedSet::default(), duplicate_relationships: ExpectedSet::default(),
        document_associations: ExpectedSet::default(), abstention: ExpectedAbstention::Allowed,
        abstention_basis: AnnotationBasis { evidence_refs: subject_evidence,
            rationale: case["explanation"].as_str().unwrap().into() },
    };
    Some(RefusalAdapted {
        observed: Adapted { snapshot: observed, labels, unscored: vec![
            "all semantic quality and abstention dimensions; structural context refusal only",
            "real Access revocation, native effects, model behavior and complete case acceptance",
        ] },
        current,
        expected_error: if revoked.is_empty() { SuggestionError::ContextChanged } else { SuggestionError::ContextWithdrawn },
    })
}

#[test]
fn retained_corpus_mapping_keeps_twenty_seven_cases_explicitly_unscored() {
    let data = corpus();
    assert_eq!(data["cases"].as_array().unwrap().len(), 32);
    assert_eq!(data["sources"].as_array().unwrap().len(), 20);
    let mapped: Vec<_> = data["cases"].as_array().unwrap().iter().filter_map(|c| adapt(c["id"].as_str().unwrap())).collect();
    assert_eq!(mapped.len(), 2);
    let refused: Vec<_> = data["cases"].as_array().unwrap().iter().filter_map(|c| adapt_refusal(c["id"].as_str().unwrap())).collect();
    assert_eq!(refused.len(), 3);
    assert_eq!(32 - mapped.len() - refused.len(), 27);
    assert!(refused.iter().all(|c| !c.observed.unscored.is_empty()));
    assert!(mapped.iter().all(|c| !c.unscored.is_empty() && c.labels.classification.required.is_empty()));
    let inventory = adapt("inv-identity").unwrap();
    let retained = inventory.snapshot.input().sources.iter().find(|s| s.input_ref == "capture-a").unwrap();
    assert_eq!(retained.version, "1");
    assert_eq!(retained.source_date, None);
    assert_eq!(retained.retrieved_at, "2030-04-01T12:00:00Z");
    assert!(adapt("inv-model-only").is_none()); // Product match does not imply physical identity.
}

fn check_retained_refusal(case_id: &str) -> RefusalAdapted {
    let case = adapt_refusal(case_id).unwrap();
    let result = if case.observed.snapshot.input().feature == SuggestionFeature::Document {
        json!({"kind":"document","classification":null,"links":[]})
    } else {
        json!({"kind":"inventory","changes":[],"duplicates":[]})
    };
    // Deliberately supplied no-change envelope, not a generated answer or gold
    // semantic abstention. Validate against observation to exclude parse errors.
    let bytes = supplied(&case.observed, result);
    assert!(validate_generated(&bytes, &case.observed.snapshot, &case.observed.snapshot).is_ok());
    assert_eq!(validate_generated(&bytes, &case.observed.snapshot, &case.current).unwrap_err(), case.expected_error);
    let report = evaluate_supplied(&case.observed.labels, &bytes, &case.observed.snapshot, &case.current).unwrap();
    assert_eq!(report.validation.correct_refusal, 1);
    assert_eq!(report.validation.unsafe_acceptance, 0);
    assert_eq!(report.refusal_reason.as_deref(), Some(format!("{:?}", case.expected_error).as_str()));
    assert!(report.classification.is_none());
    assert!(report.duplicate_relationships.is_none());
    assert!(report.document_associations.is_none());
    assert!(report.classification_unknown.is_none());
    assert!(report.duplicate_abstained.is_none());
    assert!(report.document_association_abstained.is_none());
    assert!(report.abstention.is_none());
    assert!(!report.model_executed);
    case
}

#[test]
fn retained_stale_case_separates_observed_and_current_versions() {
    let case = check_retained_refusal("inv-stale");
    let observed = &case.observed.snapshot.input().sources;
    let current = &case.current.input().sources;
    assert_eq!((observed.len(), current.len()), (1, 1));
    assert_eq!(observed[0].input_ref, "item-a");
    assert_eq!(observed[0].version, "1");
    assert_eq!(current[0].version, "2");
    assert_eq!(serde_json::to_value(&observed[0].target).unwrap(), serde_json::to_value(&current[0].target).unwrap());
    assert_eq!(observed[0].source_date.as_deref(), Some("2030-01-01"));
    assert_eq!(current[0].source_date.as_deref(), Some("2030-03-01"));
    assert_eq!(observed[0].retrieved_at, "2030-04-01T12:00:00Z");
    assert_eq!(observed[0].retrieved_at, current[0].retrieved_at);
    let previous = observed[0].evidence.iter().find(|e| e.evidence_ref == "item-a-v1-location").unwrap();
    let corrected = current[0].evidence.iter().find(|e| e.evidence_ref == "item-a-v2-location").unwrap();
    assert_eq!(previous.excerpt, "Recorded in synthetic room Blue.");
    assert_eq!(corrected.excerpt, "Corrected to synthetic room Amber by review.");
}

#[test]
fn retained_inventory_withdrawal_has_no_quality_or_abstention_score() {
    let case = check_retained_refusal("inv-revoked");
    assert_eq!(case.observed.snapshot.input().sources[0].availability, Availability::Available);
    assert_eq!(case.current.input().sources[0].availability, Availability::Withdrawn);
}

#[test]
fn retained_document_withdrawal_preserves_the_other_selected_source() {
    let case = check_retained_refusal("doc-revoked");
    let sources = &case.current.input().sources;
    assert_eq!(sources.iter().find(|s| s.input_ref == "invoice").unwrap().availability, Availability::Withdrawn);
    assert_eq!(sources.iter().find(|s| s.input_ref == "item-a").unwrap().availability, Availability::Available);
    assert_eq!(sources.len(), 2);
}

#[test]
fn retained_inventory_scores_classification_and_identity_separately() {
    let case = adapt("inv-identity").unwrap();
    let result = json!({"kind":"inventory","changes":[{"field":"category","value":"fan","support":support(&["capture-a-v1-description"])}],
        "duplicates":[{"candidateRef":"item-a","relationship":"possible-same-item","supporting":support(&["capture-a-v1-description","item-a-v1-identity"]),"contradictingClaimRefs":[]}]});
    let bytes = supplied(&case, result.clone());
    let report = evaluate_supplied(&case.labels, &bytes, &case.snapshot, &case.snapshot).unwrap();
    assert_eq!(report.validation.correct_acceptance, 1);
    assert_eq!(report.classification.unwrap().allowed_predictions, 1);
    assert_eq!(report.duplicate_relationships.unwrap().allowed_predictions, 1);
    let mut wrong = result;
    wrong["changes"][0]["value"] = json!("pump");
    let report = evaluate_supplied(&case.labels, &supplied(&case, wrong), &case.snapshot, &case.snapshot).unwrap();
    assert_eq!(report.classification.unwrap().unexpected_predictions, 1);
    assert_eq!(report.duplicate_relationships.unwrap().unexpected_predictions, 0);
}

#[test]
fn retained_document_keeps_both_possible_links_and_refuses_changed_context() {
    let case = adapt("doc-ambiguous").unwrap();
    assert_eq!(case.labels.document_associations.allowed.len(), 2);
    assert!(case.labels.document_associations.required.is_empty());
    let bytes = supplied(&case, json!({"kind":"document","classification":{"category":"manual","support":support(&["manual-v1-p1"])},
        "links":[{"candidateRef":"item-b","support":support(&["manual-v1-p1","item-b-v1-identity"])}]}));
    let report = evaluate_supplied(&case.labels, &bytes, &case.snapshot, &case.snapshot).unwrap();
    assert_eq!(report.document_associations.unwrap().allowed_predictions, 1);
    assert!(!report.model_executed);
    for unavailable in [false, true] {
        let mut current = case.snapshot.input().clone();
        if unavailable { current.sources[0].availability = Availability::Withdrawn; }
        else { current.sources[0].version = "2".into(); }
        let current = AdmittedSnapshot::new(current).unwrap();
        let mut labels = case.labels.clone();
        labels.validation = ExpectedValidation::Refuse;
        let report = evaluate_supplied(&labels, &bytes, &case.snapshot, &current).unwrap();
        assert_eq!(report.validation.correct_refusal, 1);
        assert!(report.classification.is_none());
    }
}
