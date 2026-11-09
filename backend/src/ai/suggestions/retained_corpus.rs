//! Test-only bridge from the unchanged November 8 annotations to the supplied
//! proposal scorer. This module is never imported into a production runtime.
//! Only two cases have mapped dimensions; all other cases remain unscored.
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
        let (position, source) = data["sources"].as_array().unwrap().iter().enumerate()
            .find(|(_, s)| s["id"] == name && s["version"] == version).unwrap();
        assert_eq!(source["readable"], true);
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

#[test]
fn retained_corpus_mapping_keeps_thirty_cases_explicitly_unscored() {
    let data = corpus();
    assert_eq!(data["cases"].as_array().unwrap().len(), 32);
    assert_eq!(data["sources"].as_array().unwrap().len(), 20);
    let mapped: Vec<_> = data["cases"].as_array().unwrap().iter().filter_map(|c| adapt(c["id"].as_str().unwrap())).collect();
    assert_eq!(mapped.len(), 2);
    assert!(mapped.iter().all(|c| !c.unscored.is_empty() && c.labels.classification.required.is_empty()));
    let inventory = adapt("inv-identity").unwrap();
    let retained = inventory.snapshot.input().sources.iter().find(|s| s.input_ref == "capture-a").unwrap();
    assert_eq!(retained.version, "1");
    assert_eq!(retained.source_date, None);
    assert_eq!(retained.retrieved_at, "2030-04-01T12:00:00Z");
    assert!(adapt("inv-model-only").is_none()); // Product match does not imply physical identity.
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
