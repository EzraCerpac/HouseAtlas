//! Generated structural checks only: no classification quality, model, source
//! owner, access issuer, native dispatcher, provider, network or device runs.
use super::*;
use crate::{contracts::stock::{StockContext, StockTarget, AtlasTarget, AtlasRecordKind}, domain::{RecordRef, RecordType}};
use serde_json::{Value, json};

fn id(n: u32) -> String { format!("00000000-0000-4000-8000-{n:012}") }
fn input() -> SnapshotInput {
    let sources = (1..=3).map(|n| SourceInput {
        input_ref: format!("input{n}"),
        target: StockTarget::Atlas { target: AtlasTarget::Record { record_type: AtlasRecordKind::Identity, record_id: Some(id(n)) } },
        version: "revision-1".into(), source_date: None, retrieved_at: "2026-11-08T12:00:00Z".into(),
        availability: Availability::Available,
        role: if n == 1 { InputRole::Subject } else { InputRole::Candidate },
        kind: if n == 3 { CandidateKind::Container } else { CandidateKind::InventoryItem },
        evidence: vec![AdmittedEvidence {
            evidence_ref: format!("e{n}"),
            record: Some(RecordRef { record_type: RecordType::Evidence, record_id: id(100+n) }),
            location: EvidenceLocation::Page { page: 2, page_count: 3 },
            basis: EvidenceBasis::Content,
            excerpt: format!("Generated source {n}: replace filter every six months; instance {n}."),
        }],
    }).collect();
    SnapshotInput { feature: SuggestionFeature::Inventory, scope: StockContext { workspace_id: id(90), home_id: id(91) }, actor_id: id(92), authority_epoch: "epoch-1".into(), sources }
}
fn claims() -> Value {
    json!((1..=3).map(|n| json!({"claimRef":format!("c{n}"),"sourceRef":format!("input{n}"),"evidenceRefs":[format!("e{n}")],"text":format!("Generated extracted claim {n}"),"uncertainty":"tentative"})).collect::<Vec<_>>())
}
fn support(ids: &[&str]) -> Value { json!({"claimRefs":ids,"rationale":"Generated review rationale","uncertainty":"ambiguous"}) }
fn output(snapshot: &AdmittedSnapshot, result: Value) -> Value {
    json!({"schemaVersion":1,"contextPin":snapshot.context_pin(),"subjectRef":"input1","claims":claims(),"missingEvidence":["Actual physical correspondence is unknown"],"result":result})
}
fn inventory() -> Value { json!({"kind":"inventory","changes":[{"field":"category","value":"filter","support":support(&["c1"])},{"field":"tags","values":["spare","generated"],"support":support(&["c1"])},{"field":"container","candidateRef":"input3","support":support(&["c1","c3"])}],"duplicates":[{"candidateRef":"input2","relationship":"same-product-distinct-item","supporting":support(&["c1","c2"]),"contradictingClaimRefs":["c2"]}]}) }
fn document() -> Value { json!({"kind":"document","classification":{"category":"mixed","support":support(&["c1"])},"links":[{"candidateRef":"input2","support":support(&["c1","c2"])}]}) }
fn validate(value: &Value, snapshot: &AdmittedSnapshot) -> std::result::Result<ReviewProposal, SuggestionError> {
    validate_generated(&serde_json::to_vec(value).unwrap(), snapshot, snapshot)
}

#[test]
fn inventory_document_and_abstention_keep_exact_sources_and_unknowns() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let review = validate(&output(&snapshot, inventory()), &snapshot).unwrap();
    assert_eq!(review.input().sources[0].source_date, None);
    assert_eq!(review.input().sources[0].version, "revision-1");
    assert_eq!(review.input().sources[0].evidence[0].excerpt, input().sources[0].evidence[0].excerpt);
    assert_eq!(review.proposal().missing_evidence.len(), 1);
    for category in ["manual","warranty","invoice","electrical-drawing","mixed","other","unknown"] {
        let mut admitted = input(); admitted.feature = SuggestionFeature::Document; admitted.sources[0].kind = CandidateKind::Document;
        let snapshot = AdmittedSnapshot::new(admitted).unwrap();
        let mut result = document(); result["classification"]["category"] = category.into();
        validate(&output(&snapshot, result), &snapshot).unwrap();
    }
    let mut empty = output(&snapshot, json!({"kind":"inventory","changes":[],"duplicates":[]}));
    empty["claims"] = json!([]);
    validate(&empty, &snapshot).unwrap();
    empty["missingEvidence"] = json!([]);
    assert_eq!(validate(&empty, &snapshot).unwrap_err(), SuggestionError::MissingSupport);
}

#[test]
fn inventory_refuses_unadmitted_candidates_and_unsupported_changes() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    for (pointer, value) in [
        ("/result/changes/2/candidateRef", json!("not-admitted")),
        ("/result/changes/2/candidateRef", json!("input2")),
        ("/result/duplicates/0/candidateRef", json!("input1")),
        ("/result/duplicates/0/relationship", json!("definitely-same-item")),
        ("/claims/0/evidenceRefs", json!(["e2"])),
        ("/claims/0/evidenceRefs", json!(["invented-page"])),
        ("/result/changes/0/support/claimRefs", json!([])),
        ("/result/changes/2/support/claimRefs", json!(["c1"])),
        ("/result/changes/0/value", json!(null)),
    ] {
        let mut proposal = output(&snapshot, inventory());
        *proposal.pointer_mut(pointer).unwrap() = value;
        assert!(validate(&proposal, &snapshot).is_err(), "{pointer}");
    }
    let mut proposal = output(&snapshot, inventory());
    proposal["result"]["changes"][0]["tool"] = json!("merge-records");
    assert_eq!(validate(&proposal, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
}

#[test]
fn document_requires_selected_content_and_candidate_evidence() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Document; admitted.sources[0].kind = CandidateKind::Document;
    let snapshot = AdmittedSnapshot::new(admitted.clone()).unwrap();
    let mut unknown = output(&snapshot, json!({"kind":"document","classification":null,"links":[]}));
    unknown["claims"] = json!([]);
    validate(&unknown, &snapshot).unwrap();
    unknown["result"].as_object_mut().unwrap().remove("classification");
    assert_eq!(validate(&unknown, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    for ids in [vec!["c1"], vec!["c2"], vec![]] {
        let mut result = document(); result["links"][0]["support"]["claimRefs"] = json!(ids);
        assert_eq!(validate(&output(&snapshot, result), &snapshot).unwrap_err(), SuggestionError::MissingSupport);
    }
    admitted.sources[0].evidence[0].basis = EvidenceBasis::MetadataOnly;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    assert_eq!(validate(&output(&snapshot, document()), &snapshot).unwrap_err(), SuggestionError::MissingSupport);
}

#[test]
fn fresh_context_fences_scope_versions_availability_and_disclosure() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let proposal = output(&snapshot, inventory());
    let bytes = serde_json::to_vec(&proposal).unwrap();
    let validated = validate(&proposal, &snapshot).unwrap();
    for change in 0..7 {
        let mut current = input();
        match change {
            0 => current.scope.home_id = id(500),
            1 => current.actor_id = id(501),
            2 => current.authority_epoch = "epoch-2".into(),
            3 => current.sources[0].version = "revision-2".into(),
            4 => current.sources[0].evidence[0].excerpt = "Corrected generated source".into(),
            5 => current.sources[0].availability = Availability::Unavailable,
            _ => current.sources[1].availability = Availability::Withdrawn,
        }
        let current = AdmittedSnapshot::new(current).unwrap();
        assert!(validate_generated(&bytes, &snapshot, &current).is_err());
        assert!(validated.revalidate(&current).is_err());
    }
}

#[test]
fn snapshot_rejects_invalid_canonical_targets_dates_and_locators() {
    for change in 0..7 {
        let mut admitted = input();
        match change {
            0 => admitted.scope.workspace_id = "not-canonical".into(),
            1 => admitted.sources[0].version.clear(),
            2 => admitted.sources[0].source_date = Some("yesterday".into()),
            3 => admitted.sources[0].retrieved_at = "unknown".into(),
            4 => admitted.sources[0].evidence[0].location = EvidenceLocation::Page { page: 4, page_count: 3 },
            5 => admitted.sources[0].evidence[0].record.as_mut().unwrap().record_type = RecordType::Identity,
            _ => admitted.sources[0].target = admitted.sources[1].target.clone(),
        }
        assert!(AdmittedSnapshot::new(admitted).is_err(), "case {change}");
    }
}

#[test]
fn homebox_child_collections_are_not_individual_candidates() {
    use crate::contracts::stock::HomeboxResourceKind;
    for kind in [HomeboxResourceKind::Attachment, HomeboxResourceKind::Field, HomeboxResourceKind::Maintenance] {
        let mut admitted = input();
        admitted.sources[1].target = StockTarget::Homebox {
            source_instance_id: id(200), collection_id: id(201), resource_kind: kind.clone(),
            entity_id: Some(id(202)), resource_id: None,
        };
        assert_eq!(AdmittedSnapshot::new(admitted.clone()).unwrap_err(), SuggestionError::InvalidSnapshot);
        if let StockTarget::Homebox { resource_id, .. } = &mut admitted.sources[1].target { *resource_id = Some(id(203)); }
        AdmittedSnapshot::new(admitted).unwrap();
    }
}

#[test]
fn maintenance_is_interval_only_and_never_an_execution_intent() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Maintenance;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    for interval in [json!({"kind":"periodic","every":6,"unit":"months"}), json!({"kind":"conditional","condition":"After the documented usage condition"}), json!({"kind":"unknown"})] {
        let result = json!({"kind":"maintenance","tasks":[{"candidateRef":"input2","title":"Review filter service","interval":interval,"conditions":["Last service date unknown"],"urgency":"unknown","support":support(&["c1","c2"])}]});
        let mut proposal = output(&snapshot, result);
        validate(&proposal, &snapshot).unwrap();
        proposal["result"]["tasks"][0]["dueDate"] = json!("2027-01-01");
        assert_eq!(validate(&proposal, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    }
}

#[test]
fn answers_require_citations_and_cannot_claim_exhaustive_retrieval() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Answer;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let result = json!({"kind":"answer","route":"inventory","rankedRefs":["input2"],"coverage":"partial","statements":[{"text":"The generated record documents an association; actual placement is unknown.","support":support(&["c2"])}]});
    let mut proposal = output(&snapshot, result);
    validate(&proposal, &snapshot).unwrap();
    proposal["result"]["coverage"] = "exhaustive".into();
    assert!(validate(&proposal, &snapshot).is_err());
    let result = json!({"kind":"answer","route":"clarify","rankedRefs":[],"coverage":"no-answer","statements":[]});
    validate(&output(&snapshot, result), &snapshot).unwrap();
}

#[test]
fn contradiction_keys_retain_both_sides_and_change_only_with_relevant_evidence() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Contradictions;
    let snapshot = AdmittedSnapshot::new(admitted.clone()).unwrap();
    let result = json!({"kind":"contradictions","findings":[{"pattern":"incompatible-location","claimRefs":["c1","c2"],"rationale":"Potentially incompatible generated claims, fact dates unknown","uncertainty":"ambiguous"}]});
    let first = validate(&output(&snapshot, result.clone()), &snapshot).unwrap();
    let mut reretrieved = admitted.clone(); reretrieved.sources[0].retrieved_at = "2026-11-09T12:00:00Z".into();
    let current = AdmittedSnapshot::new(reretrieved).unwrap();
    let mut reversed = result.clone(); reversed["findings"][0]["claimRefs"] = json!(["c2","c1"]);
    let second = validate(&output(&current, reversed), &current).unwrap();
    assert_eq!(first.finding_keys(), second.finding_keys());
    let mut corrected = admitted; corrected.sources[0].version = "revision-2".into();
    let current = AdmittedSnapshot::new(corrected).unwrap();
    let changed = validate(&output(&current, result.clone()), &current).unwrap();
    assert_ne!(first.finding_keys(), changed.finding_keys());
    let mut winner = output(&snapshot, result); winner["result"]["findings"][0]["winnerRef"] = json!("c1");
    assert!(validate(&winner, &snapshot).is_err());
}

#[test]
fn strict_json_and_resource_bounds_refuse_extra_authority_and_malformed_output() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let original = output(&snapshot, inventory());
    for field in ["approval", "scope", "toolCalls", "confidence", "originalUrl"] {
        let mut proposal = original.clone(); proposal[field] = json!("generated");
        assert_eq!(validate(&proposal, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    }
    for bytes in [b"{} {}".as_slice(), b"{\"schemaVersion\":1,\"schemaVersion\":1}".as_slice(), b"null".as_slice()] {
        assert_eq!(validate_generated(bytes, &snapshot, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    }
    let valid = serde_json::to_string(&original).unwrap();
    let duplicate = format!("{{\"schemaVersion\":1,{}", &valid[1..]);
    assert_eq!(validate_generated(duplicate.as_bytes(), &snapshot, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    let mut switched = output(&snapshot, json!({"kind":"answer","route":"unknown","rankedRefs":[],"coverage":"no-answer","statements":[]}));
    assert_eq!(validate(&switched, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    switched["schemaVersion"] = json!(2);
    assert_eq!(validate(&switched, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
    assert_eq!(validate_generated(&vec![b' '; MAX_OUTPUT_BYTES + 1], &snapshot, &snapshot).unwrap_err(), SuggestionError::LimitExceeded);
}

#[test]
fn review_disclosure_preserves_contradicting_claims_exact_sources_and_selection_bindings() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let review = validate(&output(&snapshot, inventory()), &snapshot).unwrap();
    let inspectable = ["e1".to_owned()].into_iter().collect();
    let disclosure = disclose_review(&review, &snapshot, &inspectable).unwrap();
    let wire = disclosure.value();
    assert_eq!(wire["schemaVersion"], 1);
    assert_eq!(wire["contextPin"], snapshot.context_pin());
    assert_eq!(wire["view"]["fields"][0]["current"], Value::Null);
    assert_eq!(wire["view"]["sources"][0]["sourceDate"], Value::Null);
    assert_eq!(wire["view"]["sources"][0]["excerpt"], input().sources[0].evidence[0].excerpt);
    assert_eq!(wire["view"]["sources"][0]["page"], 2);
    assert_eq!(wire["view"]["sources"][0]["original"], "available");
    assert_eq!(wire["view"]["sources"][1]["original"], "unavailable");
    assert_eq!(wire["view"]["uncalibratedScore"], Value::Null);
    let duplicate = wire["view"]["candidates"].as_array().unwrap().iter()
        .find(|c| c["key"] == "duplicate:input2").unwrap();
    assert!(duplicate["reason"].as_str().unwrap().contains("Contradicting extracted claim"));
    assert!(duplicate["evidenceKeys"].as_array().unwrap().contains(&json!("e2")));
    assert_eq!(wire["selections"]["container:input3"]["inputRef"], "input3");
    assert_eq!(wire["inspections"]["e1"]["version"], "revision-1");
    assert_eq!(wire["inspections"]["e1"]["location"], json!({"kind":"page","page":2,"pageCount":3}));
}

#[test]
fn review_disclosure_rechecks_current_sources_and_refuses_unadmitted_inspection() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let review = validate(&output(&snapshot, inventory()), &snapshot).unwrap();
    let mut changed = input(); changed.sources[0].version = "revision-2".into();
    let current = AdmittedSnapshot::new(changed).unwrap();
    assert_eq!(disclose_review(&review, &current, &Default::default()).unwrap_err(), SuggestionError::ContextChanged);
    let invented = ["invented-original".to_owned()].into_iter().collect();
    assert_eq!(disclose_review(&review, &snapshot, &invented).unwrap_err(), SuggestionError::UnadmittedReference);
}

#[test]
fn document_disclosure_separates_classification_from_links_and_abstention_keeps_unknowns() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Document; admitted.sources[0].kind = CandidateKind::Document;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let review = validate(&output(&snapshot, document()), &snapshot).unwrap();
    let wire = disclose_review(&review, &snapshot, &Default::default()).unwrap();
    assert_eq!(wire.value()["view"]["fields"][0]["key"], "document-class");
    assert_eq!(wire.value()["view"]["candidates"][0]["key"], "document-link:input2");
    let mut empty = output(&snapshot, json!({"kind":"document","classification":null,"links":[]})); empty["claims"] = json!([]);
    let review = validate(&empty, &snapshot).unwrap();
    let wire = disclose_review(&review, &snapshot, &Default::default()).unwrap();
    assert_eq!(wire.value()["view"]["sources"][0]["original"], "unavailable");
    assert_eq!(wire.value()["inspections"]["subject:input1"]["evidenceRef"], Value::Null);
    assert!(wire.value()["view"]["fields"].as_array().unwrap().is_empty());
}

#[test]
fn maintenance_disclosure_binds_canonical_tasks_and_keeps_baseline_unknown() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Maintenance;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let intervals = [json!({"kind":"periodic","every":6,"unit":"months"}),
        json!({"kind":"conditional","condition":"Only after the documented condition"}), json!({"kind":"unknown"})];
    let tasks: Vec<_> = intervals.iter().map(|interval| json!({"candidateRef":"input2","title":"Review filter service",
        "interval":interval,"conditions":["Service baseline unknown"],"urgency":"review-soon","support":support(&["c1","c2"])})).collect();
    let review = validate(&output(&snapshot, json!({"kind":"maintenance","tasks":tasks})), &snapshot).unwrap();
    let disclosure = disclose_review(&review, &snapshot, &Default::default()).unwrap();
    let wire = disclosure.value();
    assert_eq!(wire["view"]["kind"], "maintenance");
    assert!(wire["view"]["fields"].as_array().unwrap().is_empty());
    assert!(wire["view"]["candidates"].as_array().unwrap().is_empty());
    for (index, interval) in intervals.iter().enumerate() {
        let task = &wire["view"]["maintenance"][index];
        assert_eq!(task["interval"], *interval);
        assert_eq!(task["baselineDate"], Value::Null);
        assert_eq!(task["targetKey"], "input2");
        assert_eq!(task["urgency"], "review-soon");
        let key = format!("maintenance:{index}:input2");
        assert_eq!(task["key"], key);
        assert_eq!(wire["selections"][&key], json!({"kind":"maintenance-task","inputRef":"input2","taskIndex":index}));
        assert!(task["evidenceKeys"].as_array().unwrap().contains(&json!("e1")));
        assert!(task["evidenceKeys"].as_array().unwrap().contains(&json!("e2")));
        assert!(task.get("dueDate").is_none());
    }
    assert_eq!(wire["view"]["sources"][0]["recordVersion"], "revision-1");
    assert_eq!(wire["view"]["sources"][0]["page"], 2);
}

#[test]
fn maintenance_disclosure_refuses_changed_and_withdrawn_current_sources() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Maintenance;
    let snapshot = AdmittedSnapshot::new(admitted.clone()).unwrap();
    let tasks = json!([{"candidateRef":"input2","title":"Review service","interval":{"kind":"unknown"},
        "conditions":[],"urgency":"unknown","support":support(&["c1","c2"])}]);
    let review = validate(&output(&snapshot, json!({"kind":"maintenance","tasks":tasks})), &snapshot).unwrap();
    for withdrawn in [false, true] {
        let mut current = admitted.clone();
        if withdrawn { current.sources[1].availability = Availability::Withdrawn; }
        else { current.sources[1].version = "revision-2".into(); }
        let current = AdmittedSnapshot::new(current).unwrap();
        let expected = if withdrawn { SuggestionError::ContextWithdrawn } else { SuggestionError::ContextChanged };
        assert_eq!(disclose_review(&review, &current, &Default::default()).unwrap_err(), expected);
    }
}
