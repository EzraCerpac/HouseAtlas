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

fn question_input() -> SnapshotInput {
    let mut value = input();
    value.feature = SuggestionFeature::Answer;
    value.sources.clear();
    value
}
fn question_binding() -> QuestionBinding {
    use sha2::{Digest, Sha256};
    QuestionBinding { request_id: "generated-question-a".into(),
        query_sha256: format!("{:x}", Sha256::digest(b"Generated question A: where are the replacement parts?")),
        registration_id: "generated-registration".into(), cancellation_epoch: "cancel-1".into() }
}
fn question_proposal(snapshot: &AdmittedSnapshot) -> Value {
    json!({"schemaVersion":2,"contextPin":snapshot.context_pin(),"subjectRef":null,"claims":[],
        "missingEvidence":["Retrieval coverage is missing; no conclusion about whether parts exist."],
        "result":{"kind":"answer","route":"clarify","coverage":"no-answer","rankedRefs":[],"statements":[]}})
}

#[test]
fn source_free_answer_requires_null_and_discloses_no_fabricated_record_or_capability() {
    let snapshot = AdmittedSnapshot::source_free_answer(question_input(), question_binding()).unwrap();
    assert!(snapshot.input().sources.is_empty());
    for route in ["clarify", "unknown"] {
        let mut supplied = question_proposal(&snapshot); supplied["result"]["route"] = json!(route);
        let review = validate(&supplied, &snapshot).unwrap();
        assert!(review.proposal().subject_ref.is_none());
        assert_eq!(serde_json::to_value(review.proposal()).unwrap()["subjectRef"], Value::Null);
        assert!(review.finding_keys().is_empty());
        let wire = disclose_review(&review, &snapshot, &Default::default()).unwrap();
        let wire = wire.value();
        assert_eq!(wire["schemaVersion"], 1); // Display DTO version is independent.
        assert_eq!(wire["contextPin"], snapshot.context_pin());
        for key in ["sources", "fields", "candidates"] { assert_eq!(wire["view"][key], json!([])); }
        for key in ["inspections", "selections", "rankings"] { assert_eq!(wire[key], json!({})); }
        assert_eq!(wire["view"]["answer"]["route"], route);
        assert_eq!(wire["view"]["answer"]["coverage"], "no-answer");
        assert_eq!(wire["view"]["answer"]["rankedCandidates"], json!([]));
        assert_eq!(wire["view"]["answer"]["statements"], json!([]));
        assert_eq!(wire["view"]["answer"]["missingEvidence"], supplied["missingEvidence"]);
        let invented = std::collections::BTreeSet::from(["invented-original".into()]);
        assert_eq!(disclose_review(&review, &snapshot, &invented).unwrap_err(), SuggestionError::UnadmittedReference);
    }
}

#[test]
fn source_free_answer_escaped_gaps_keep_the_final_disclosure_byte_fence() {
    let snapshot = AdmittedSnapshot::source_free_answer(question_input(), question_binding()).unwrap();
    let gap = "g".to_owned() + &"\n".repeat(1023);
    for count in [15, 16] {
        let mut supplied = question_proposal(&snapshot);
        supplied["missingEvidence"] = json!(vec![gap.clone(); count]);
        assert!(serde_json::to_vec(&supplied).unwrap().len() <= MAX_OUTPUT_BYTES);
        let review = validate(&supplied, &snapshot).unwrap();
        let result = disclose_review(&review, &snapshot, &Default::default());
        if count == 15 {
            assert!(serde_json::to_vec(result.unwrap().value()).unwrap().len() <= MAX_OUTPUT_BYTES);
        } else {
            // Valid proposal gaps are duplicated in the display; escaping can
            // exceed the receiving session's byte cap without exceeding the
            // proposal or per-string limits. Never return that oversized DTO.
            assert_eq!(result.unwrap_err(), SuggestionError::LimitExceeded);
        }
    }
}

#[test]
fn source_free_answer_rejects_nonempty_or_malformed_admission_and_generated_content() {
    assert!(AdmittedSnapshot::source_free_answer(input(), question_binding()).is_err());
    let mut nonempty = input(); nonempty.feature = SuggestionFeature::Answer;
    assert!(AdmittedSnapshot::source_free_answer(nonempty, question_binding()).is_err());
    for feature in [SuggestionFeature::Inventory, SuggestionFeature::Document, SuggestionFeature::Maintenance, SuggestionFeature::Contradictions] {
        let mut supplied = question_input(); supplied.feature = feature;
        assert!(AdmittedSnapshot::source_free_answer(supplied, question_binding()).is_err());
    }
    for change in 0..8 {
        let mut input = question_input(); let mut binding = question_binding();
        match change {
            0 => binding.request_id.clear(),
            1 => binding.registration_id.clear(),
            2 => binding.cancellation_epoch.clear(),
            3 => binding.query_sha256 = "a".repeat(63),
            4 => binding.query_sha256 = "A".repeat(64),
            5 => binding.query_sha256 = "z".repeat(64),
            6 => input.actor_id = "not-an-actor".into(),
            _ => input.scope.home_id = "not-a-home".into(),
        }
        assert!(AdmittedSnapshot::source_free_answer(input, binding).is_err());
    }
    let snapshot = AdmittedSnapshot::source_free_answer(question_input(), question_binding()).unwrap();
    for change in 0..16 {
        let mut supplied = question_proposal(&snapshot);
        match change {
            0 => supplied["subjectRef"] = json!("invented-subject"),
            1 => { supplied.as_object_mut().unwrap().remove("subjectRef"); },
            2 => supplied["schemaVersion"] = json!(1),
            3 => supplied["schemaVersion"] = json!(3),
            4 => supplied["claims"] = json!([{"claimRef":"c1","sourceRef":"invented","evidenceRefs":["e1"],"text":"invented fact","uncertainty":"unknown"}]),
            5 => supplied["result"]["rankedRefs"] = json!(["invented"]),
            6 => supplied["result"]["statements"] = json!([{"text":"invented fact","support":support(&["c1"])}]),
            7 => supplied["result"]["coverage"] = json!("partial"),
            8 => supplied["result"]["route"] = json!("inventory"),
            9 => supplied["missingEvidence"] = json!([]),
            10 => supplied["missingEvidence"] = json!(["x".repeat(1025)]),
            11 => supplied["missingEvidence"] = json!(vec!["gap"; 17]),
            12 => supplied["result"]["findings"] = json!([]),
            13 => supplied["approval"] = json!("invented"),
            14 => supplied["result"]["tool"] = json!("write"),
            _ => supplied["result"] = json!({"kind":"maintenance","tasks":[]}),
        }
        assert!(validate(&supplied, &snapshot).is_err(), "mutation {change}");
    }
    let duplicate = serde_json::to_string(&question_proposal(&snapshot)).unwrap().replacen("\"subjectRef\":null", "\"subjectRef\":null,\"subjectRef\":null", 1);
    assert!(validate_generated(duplicate.as_bytes(), &snapshot, &snapshot).is_err());
}

#[test]
fn source_free_answer_replacement_pins_question_scope_registration_and_both_epochs() {
    let admitted = AdmittedSnapshot::source_free_answer(question_input(), question_binding()).unwrap();
    let supplied = question_proposal(&admitted);
    let review = validate(&supplied, &admitted).unwrap();
    for change in 0..8 {
        let mut input = question_input(); let mut binding = question_binding();
        match change {
            0 => binding.request_id = "generated-question-b".into(), // Even identical question bytes get a new request identity.
            1 => binding.query_sha256 = "b".repeat(64), // A reused ID with replaced prompt cannot reuse the pin.
            2 => binding.registration_id = "other-registration".into(),
            3 => binding.cancellation_epoch = "cancel-2".into(),
            4 => input.authority_epoch = "authority-2".into(),
            5 => input.actor_id = id(500),
            6 => input.scope.home_id = id(501),
            _ => input.scope.workspace_id = id(502),
        }
        let current = AdmittedSnapshot::source_free_answer(input, binding).unwrap();
        assert_ne!(admitted.context_pin(), current.context_pin());
        assert_eq!(validate_generated(&serde_json::to_vec(&supplied).unwrap(), &admitted, &current).unwrap_err(), SuggestionError::ContextChanged);
        assert_eq!(disclose_review(&review, &current, &Default::default()).unwrap_err(), SuggestionError::ContextChanged);
    }
    // These are supplied correlation comparisons, not a live request owner,
    // real cancellation/Access observation or proof an old clone is current.
}

#[test]
fn source_free_answer_leaves_record_admission_v1_pins_and_subject_rules_unchanged() {
    use sha2::{Digest, Sha256};
    for (feature, result) in [
        (SuggestionFeature::Inventory, inventory()),
        (SuggestionFeature::Document, document()),
        (SuggestionFeature::Maintenance, json!({"kind":"maintenance","tasks":[]})),
        (SuggestionFeature::Answer, json!({"kind":"answer","route":"clarify","coverage":"no-answer","rankedRefs":[],"statements":[]})),
        (SuggestionFeature::Contradictions, json!({"kind":"contradictions","findings":[]})),
    ] {
        let mut original = input(); original.feature = feature;
        if feature == SuggestionFeature::Document { original.sources[0].kind = CandidateKind::Document; }
        let expected_pin = format!("{:x}", Sha256::digest(serde_jcs::to_vec(&original).unwrap()));
        let snapshot = AdmittedSnapshot::new(original.clone()).unwrap();
        assert_eq!(snapshot.context_pin(), expected_pin);
        let supplied = output(&snapshot, result);
        assert!(validate(&supplied, &snapshot).is_ok());
        for change in 0..3 {
            let mut bad = supplied.clone();
            match change {
                0 => bad["subjectRef"] = Value::Null,
                1 => { bad.as_object_mut().unwrap().remove("subjectRef"); },
                _ => bad["schemaVersion"] = json!(2),
            }
            assert!(validate(&bad, &snapshot).is_err());
        }
        original.sources.clear();
        assert!(AdmittedSnapshot::new(original).is_err());
    }
}

#[test]
fn source_free_answer_composes_terminal_completion_without_changing_usage_or_refusal_fences() {
    use crate::ai::{InferenceOutcome, Usage, responses::completed_event};
    let snapshot = AdmittedSnapshot::source_free_answer(question_input(), question_binding()).unwrap();
    let text = serde_json::to_string(&question_proposal(&snapshot)).unwrap();
    for wire_usage in [Value::Null, json!({"input_tokens":7})] {
        let event = json!({"type":"response.completed","response":{"status":"completed","usage":wire_usage,
            "output":[{"type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":text}]}]}});
        let outcome = completed_event(&event).unwrap();
        let expected = Usage { input_tokens: wire_usage["input_tokens"].as_u64(), output_tokens: None, total_tokens: None };
        let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
        assert_eq!(result.usage, expected); assert!(result.review.is_ok());
        let mut binding = question_binding(); binding.request_id = "question-b".into();
        let current = AdmittedSnapshot::source_free_answer(question_input(), binding).unwrap();
        assert_eq!(disclose_completed(&outcome, &snapshot, &current, &Default::default()).review.unwrap_err(), CompletionRejection::Validation(SuggestionError::ContextChanged));
        for refused in [true, false] {
            let mut bad = event.clone();
            bad["response"]["output"][0]["content"] = if refused { json!([{"type":"refusal","refusal":text}]) }
                else { json!([{"type":"output_text","text":text}]) };
            if !refused { bad["response"]["output"].as_array_mut().unwrap().push(json!({"type":"function_call","name":"write","arguments":"{}"})); }
            let outcome = completed_event(&bad).unwrap();
            let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
            assert_eq!(result.usage, expected);
            assert_eq!(result.review.unwrap_err(), if refused { CompletionRejection::Refused } else { CompletionRejection::InvalidEnvelope });
        }
        for outcome in [InferenceOutcome::Cancelled { usage: expected }, InferenceOutcome::Stopped { usage: expected }] {
            let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
            assert_eq!(result.usage, expected); assert!(result.review.is_err());
        }
    }
}

fn completed_proposal(snapshot: &AdmittedSnapshot) -> crate::ai::InferenceOutcome {
    crate::ai::InferenceOutcome::Completed {
        output: vec![json!({"type":"reasoning","summary":[]}), json!({
            "type":"message","role":"assistant","status":"completed",
            "content":[{"type":"output_text","text":serde_json::to_string(&output(snapshot, inventory())).unwrap()}]
        })],
        usage: crate::ai::Usage::default(),
    }
}

#[test]
fn product_match_unknown_identity_has_distinct_wire_and_disclosure_without_changing_old_relationships() {
    let mut admitted = input();
    admitted.sources[0].evidence[0].excerpt = "Generated Aurora-Q product label; physical item identity unknown.".into();
    admitted.sources[1].evidence[0].excerpt = "Generated second Aurora-Q product label; serial and same/distinct physical identity unknown.".into();
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    for (raw, display) in [
        ("possible-same-item", "possible-duplicate"),
        ("same-product-distinct-item", "same-product"),
        ("same-product-identity-unknown", "same-product-identity-unknown"),
        ("ambiguous", "possible-duplicate"),
    ] {
        let relationship: DuplicateRelationship = serde_json::from_value(json!(raw)).unwrap();
        assert_eq!(serde_json::to_value(relationship).unwrap(), raw);
        let mut proposal = output(&snapshot, json!({"kind":"inventory","changes":[],"duplicates":[{
            "candidateRef":"input2","relationship":raw,"supporting":support(&["c1","c2"]),"contradictingClaimRefs":[]}]}));
        for index in 0..2 { proposal["claims"][index]["text"] = json!(snapshot.input().sources[index].evidence[0].excerpt); }
        proposal["result"]["duplicates"][0]["supporting"]["uncertainty"] = json!("unknown");
        let review = validate(&proposal, &snapshot).unwrap();
        assert_eq!(serde_json::to_value(review.proposal()).unwrap()["result"]["duplicates"][0]["relationship"], raw);
        assert_eq!(serde_json::to_value(review.input()).unwrap(), serde_json::to_value(snapshot.input()).unwrap());
        let wire = disclose_review(&review, &snapshot, &Default::default()).unwrap();
        assert_eq!(wire.value()["contextPin"], snapshot.context_pin());
        assert_eq!(wire.value()["view"]["candidates"][0]["relation"], display);
        assert_eq!(wire.value()["view"]["candidates"][0]["uncertainty"], "Unknown");
        assert_eq!(wire.value()["view"]["candidates"][0]["evidenceKeys"], json!(["e1", "e2"]));
        assert_eq!(wire.value()["inspections"]["e1"]["inputRef"], "input1");
        assert_eq!(wire.value()["inspections"]["e2"]["inputRef"], "input2");
        assert_eq!(wire.value()["inspections"]["e2"]["version"], "revision-1");
        assert_eq!(wire.value()["selections"], json!({"duplicate:input2":{"kind":"inventory-duplicate","inputRef":"input2"}}));
        // Both cited sides remain mandatory for every relationship. Acceptance
        // above is structural, not semantic verification of any hypothesis.
        proposal["result"]["duplicates"][0]["supporting"]["claimRefs"] = json!(["c1"]);
        assert_eq!(validate(&proposal, &snapshot).unwrap_err(), SuggestionError::MissingSupport);
    }
    assert!(serde_json::from_value::<DuplicateRelationship>(json!("same-product-authorized-merge")).is_err());
    // Do not adapt original inv-model-only by relabeling its Document subject.
    let mut document_subject = input();
    document_subject.sources[0].kind = CandidateKind::Document;
    let snapshot = AdmittedSnapshot::new(document_subject).unwrap();
    let mut proposal = output(&snapshot, inventory());
    proposal["result"]["duplicates"][0]["relationship"] = json!("same-product-identity-unknown");
    assert_eq!(validate(&proposal, &snapshot).unwrap_err(), SuggestionError::InvalidOutput);
}

#[test]
fn completed_proposal_envelope_accepts_exact_limit_and_refuses_next_byte() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let mut outcome = completed_proposal(&snapshot);
    if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
        items[0]["summary"] = json!(["é\n\"\\\u{0001}", ""]);
        // A small fixture encoding determines only fixed overhead. No complete
        // padded encoding is constructed by the production counting sink.
        let overhead = serde_json::to_vec(items).unwrap().len();
        items[0]["summary"][1] = json!("x".repeat(1_048_576 - overhead));
        assert_eq!(serde_json::to_vec(items).unwrap().len(), 1_048_576);
    }
    let exact = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
    assert!(exact.review.is_ok());
    assert_eq!(exact.usage, crate::ai::Usage::default());
    if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
        let padded = items[0]["summary"][1].as_str().unwrap().to_owned() + "x";
        items[0]["summary"][1] = json!(padded);
        assert_eq!(serde_json::to_vec(items).unwrap().len(), 1_048_577);
    }
    let over = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
    assert_eq!(over.review.unwrap_err(), CompletionRejection::InvalidEnvelope);
    assert_eq!(over.usage, crate::ai::Usage::default());
}

#[test]
fn terminal_decoder_composes_review_usage_refusal_and_tool_withholding() {
    use crate::ai::{InferenceOutcome, Usage, responses::completed_event};
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let InferenceOutcome::Completed { output: items, .. } = completed_proposal(&snapshot) else { panic!("fixture must be completed") };
    for (wire_usage, expected) in [
        (None, Usage::default()),
        (Some(Value::Null), Usage::default()),
        (Some(json!({"input_tokens":3,"output_tokens":4,"total_tokens":7})), Usage { input_tokens: Some(3), output_tokens: Some(4), total_tokens: Some(7) }),
        (Some(json!({"input_tokens":3})), Usage { input_tokens: Some(3), output_tokens: None, total_tokens: None }),
    ] {
        let mut event = json!({"type":"response.completed","response":{"status":"completed","output":items}});
        if let Some(wire_usage) = wire_usage { event["response"]["usage"] = wire_usage; }
        let outcome = completed_event(&event).unwrap();
        let review = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
        assert!(review.review.is_ok());
        assert_eq!(review.usage, expected);
        for refused in [true, false] {
            let mut supplied = event.clone();
            if refused {
                // Valid JSON proposal bytes remain inert inside refusal text.
                let text = supplied["response"]["output"][1]["content"][0]["text"].clone();
                supplied["response"]["output"][1]["content"] = json!([{"type":"refusal","refusal":text}]);
            } else {
                supplied["response"]["output"].as_array_mut().unwrap().push(json!({"type":"function_call","name":"houseatlas.write","arguments":"{}"}));
            }
            let outcome = completed_event(&supplied).unwrap();
            let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
            assert_eq!(result.usage, expected);
            assert_eq!(result.review.unwrap_err(), if refused { CompletionRejection::Refused } else { CompletionRejection::InvalidEnvelope });
        }
        event["type"] = json!("response.output_text.delta");
        assert!(completed_event(&event).is_err());
        event["type"] = json!("response.completed");
        event["response"]["status"] = json!("incomplete");
        assert!(completed_event(&event).is_err());
    }
}

#[test]
fn completed_proposal_projects_exact_disclosure_and_preserves_observed_usage() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let expected = disclose_review(&validate(&output(&snapshot, inventory()), &snapshot).unwrap(), &snapshot, &Default::default()).unwrap();
    let mut outcome = completed_proposal(&snapshot);
    let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
    assert_eq!(result.usage, crate::ai::Usage::default());
    assert_eq!(result.review.unwrap().value(), expected.value());
    let observed = crate::ai::Usage { input_tokens: Some(7), output_tokens: None, total_tokens: None };
    if let crate::ai::InferenceOutcome::Completed { usage, .. } = &mut outcome { *usage = observed; }
    assert_eq!(disclose_completed(&outcome, &snapshot, &snapshot, &Default::default()).usage, observed);
    let mut document_input = input();
    document_input.feature = SuggestionFeature::Document;
    document_input.sources[0].kind = CandidateKind::Document;
    let snapshot = AdmittedSnapshot::new(document_input).unwrap();
    let proposal = output(&snapshot, document());
    let expected = disclose_review(&validate(&proposal, &snapshot).unwrap(), &snapshot, &Default::default()).unwrap();
    let mut outcome = completed_proposal(&snapshot);
    if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
        items[1]["content"][0]["text"] = json!(serde_json::to_string(&proposal).unwrap());
    }
    assert_eq!(disclose_completed(&outcome, &snapshot, &snapshot, &Default::default()).review.unwrap().value(), expected.value());
}

#[test]
fn completed_proposal_never_promotes_refusal_text_or_dispatches_tools() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let mut outcome = completed_proposal(&snapshot);
    if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
        // Even valid proposal JSON inside a refusal is not a proposal.
        let text = items[1]["content"][0]["text"].clone();
        items[1]["content"] = json!([{"type":"refusal","refusal":text}]);
    }
    assert_eq!(disclose_completed(&outcome, &snapshot, &snapshot, &Default::default()).review.unwrap_err(), CompletionRejection::Refused);
    let mut outcome = completed_proposal(&snapshot);
    if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
        items.push(json!({"type":"function_call","name":"houseatlas.write","arguments":"{}"}));
    }
    let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
    assert_eq!(result.review.unwrap_err(), CompletionRejection::InvalidEnvelope);
    assert_eq!(result.usage, crate::ai::Usage::default());
}

#[test]
fn completed_proposal_withholds_each_noncompleted_outcome_without_losing_usage() {
    use crate::ai::{AiError, InferenceOutcome, ProviderDiagnostic, Usage};
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let usage = Usage { input_tokens: Some(5), output_tokens: None, total_tokens: None };
    let diagnostic = ProviderDiagnostic { http_status: Some(429), code: Some("synthetic-limit".into()), parameter: None, request_id: None };
    for (outcome, rejection) in [
        (InferenceOutcome::Cancelled { usage }, CompletionRejection::Cancelled),
        (InferenceOutcome::Stopped { usage }, CompletionRejection::Stopped),
        (InferenceOutcome::Unresolved { usage, reason: AiError::ProviderUnavailable, diagnostic: diagnostic.clone() }, CompletionRejection::Unresolved),
        (InferenceOutcome::Failed { usage, reason: AiError::UsageLimitReached, diagnostic: diagnostic.clone() }, CompletionRejection::Failed),
    ] {
        let result = disclose_completed(&outcome, &snapshot, &snapshot, &Default::default());
        assert_eq!(result.usage, usage);
        assert_eq!(result.review.unwrap_err(), rejection);
        // The original reason and diagnostic remain owned by the caller.
        match outcome {
            InferenceOutcome::Unresolved { reason, diagnostic, .. } => {
                assert_eq!(reason, AiError::ProviderUnavailable);
                assert_eq!(diagnostic.code.as_deref(), Some("synthetic-limit"));
            },
            InferenceOutcome::Failed { reason, diagnostic, .. } => {
                assert_eq!(reason, AiError::UsageLimitReached);
                assert_eq!(diagnostic.http_status, Some(429));
            },
            _ => {},
        }
    }
}

#[test]
fn completed_proposal_reuses_context_and_original_inspection_fences() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    let outcome = completed_proposal(&snapshot);
    for (change, expected) in [(0, SuggestionError::ContextChanged), (1, SuggestionError::ContextWithdrawn), (2, SuggestionError::ContextUnavailable)] {
        let mut current = input();
        match change {
            0 => current.sources[0].version = "revision-2".into(),
            1 => current.sources[1].availability = Availability::Withdrawn,
            _ => current.sources[0].availability = Availability::Unavailable,
        }
        let current = AdmittedSnapshot::new(current).unwrap();
        assert_eq!(disclose_completed(&outcome, &snapshot, &current, &Default::default()).review.unwrap_err(), CompletionRejection::Validation(expected));
    }
    let invented = std::collections::BTreeSet::from(["not-admitted".into()]);
    assert_eq!(disclose_completed(&outcome, &snapshot, &snapshot, &invented).review.unwrap_err(), CompletionRejection::Validation(SuggestionError::UnadmittedReference));
}

#[test]
fn completed_proposal_refuses_ambiguous_malformed_and_oversized_payloads() {
    let snapshot = AdmittedSnapshot::new(input()).unwrap();
    for change in 0..11 {
        let mut outcome = completed_proposal(&snapshot);
        if let crate::ai::InferenceOutcome::Completed { output: items, .. } = &mut outcome {
            match change {
                0 => { let duplicate = items[1].clone(); items.push(duplicate); },
                1 => items[1]["status"] = json!("in_progress"),
                2 => items[1]["role"] = json!("user"),
                3 => items[1]["content"][0]["text"] = json!("not JSON"),
                4 => items[1]["content"][0]["text"] = json!("x".repeat(MAX_OUTPUT_BYTES + 1)),
                5 => { items.remove(1); },
                6 => items[1]["content"] = json!([]),
                7 => { let part = items[1]["content"][0].clone(); items[1]["content"].as_array_mut().unwrap().push(part); },
                8 => items[0] = json!({"type":"unknown"}),
                9 => items[0]["summary"] = json!("x".repeat(1_048_577)),
                _ => *items = vec![json!({"type":"reasoning"}); 65],
            }
        }
        assert!(disclose_completed(&outcome, &snapshot, &snapshot, &Default::default()).review.is_err(), "change {change}");
    }
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

#[test]
fn answer_disclosure_preserves_rank_order_citations_and_read_only_bindings() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Answer;
    admitted.sources[0].source_date = Some("2020-01-01".into());
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let result = json!({"kind":"answer","route":"electrical","rankedRefs":["input3","input2"],"coverage":"partial",
        "statements":[{"text":"Generated documentary association; tested wiring remains unknown.","support":support(&["c1","c2"])}]});
    let review = validate(&output(&snapshot, result), &snapshot).unwrap();
    let wire = disclose_review(&review, &snapshot, &["e1".to_string()].into_iter().collect()).unwrap();
    let wire = wire.value();
    assert_eq!(wire["view"]["kind"], "answer");
    assert_eq!(wire["view"]["answer"]["route"], "electrical");
    assert_eq!(wire["view"]["answer"]["coverage"], "partial");
    assert_eq!(wire["view"]["answer"]["rankedCandidates"][0]["key"], "rank:input3");
    assert_eq!(wire["view"]["answer"]["rankedCandidates"][1]["key"], "rank:input2");
    assert_eq!(wire["rankings"]["rank:input3"], json!({"inputRef":"input3","version":"revision-1","rankIndex":0}));
    assert_eq!(wire["view"]["answer"]["statements"][0]["evidenceKeys"], json!(["e1","e2"]));
    assert_eq!(wire["view"]["answer"]["statements"][0]["reason"], "Generated review rationale");
    assert_eq!(wire["inspections"]["e1"]["location"], json!({"kind":"page","page":2,"pageCount":3}));
    assert_eq!(wire["view"]["sources"][0]["sourceDate"], "2020-01-01");
    assert_eq!(wire["view"]["sources"][0]["retrievedAt"], "2026-11-08T12:00:00Z");
    assert_eq!(wire["view"]["sources"][0]["original"], "available");
    assert_eq!(wire["selections"], json!({}));
    assert!(wire["view"]["fields"].as_array().unwrap().is_empty());
    assert!(wire["view"]["candidates"].as_array().unwrap().is_empty());
    assert!(wire["view"].get("maintenance").is_none());
    assert!(wire["inspections"].get("e3").is_none()); // Rank order is not an inspect capability.
}

#[test]
fn answer_disclosure_preserves_clarify_unknown_and_no_answer_gaps() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Answer;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    for route in ["clarify", "unknown"] {
        let review = validate(&output(&snapshot, json!({"kind":"answer","route":route,"rankedRefs":[],
            "coverage":"no-answer","statements":[]})), &snapshot).unwrap();
        let wire = disclose_review(&review, &snapshot, &Default::default()).unwrap();
        let wire = wire.value();
        assert_eq!(wire["view"]["answer"]["route"], route);
        assert_eq!(wire["view"]["answer"]["coverage"], "no-answer");
        assert_eq!(wire["view"]["answer"]["missingEvidence"], json!(["Actual physical correspondence is unknown"]));
        assert_eq!(wire["rankings"], json!({}));
        assert_eq!(wire["selections"], json!({}));
        assert_eq!(wire["view"]["sources"][0]["original"], "unavailable");
    }
}

#[test]
fn answer_disclosure_refuses_changed_or_withdrawn_current_context() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Answer;
    let snapshot = AdmittedSnapshot::new(admitted.clone()).unwrap();
    let review = validate(&output(&snapshot, json!({"kind":"answer","route":"documents","rankedRefs":["input2"],
        "coverage":"partial","statements":[{"text":"Generated cited record only.","support":support(&["c2"])}]})), &snapshot).unwrap();
    for withdrawn in [false, true] {
        let mut current = admitted.clone();
        if withdrawn { current.sources[1].availability = Availability::Withdrawn; }
        else { current.sources[1].version = "revision-2".into(); }
        let current = AdmittedSnapshot::new(current).unwrap();
        let expected = if withdrawn { SuggestionError::ContextWithdrawn } else { SuggestionError::ContextChanged };
        assert_eq!(disclose_review(&review, &current, &Default::default()).unwrap_err(), expected);
    }
}

#[test]
fn comparison_disclosure_joins_canonical_finding_claims_and_exact_input_evidence() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Contradictions;
    admitted.sources[0].source_date = Some("2020-01-01".into());
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let result = json!({"kind":"contradictions","findings":[{"pattern":"incompatible-location","claimRefs":["c2","c1"],
        "rationale":"Compare generated assertions; current placement remains unknown","uncertainty":"ambiguous"}]});
    let review = validate(&output(&snapshot, result), &snapshot).unwrap();
    let disclosure = disclose_review(&review, &snapshot, &["e1".to_string()].into_iter().collect()).unwrap();
    let wire = disclosure.value();
    let key = format!("finding:{}", review.finding_keys()[0]);
    let finding = &wire["view"]["contradictions"]["findings"][0];
    assert_eq!(finding["key"], key);
    assert_eq!(finding["pattern"], "incompatible-location");
    assert_eq!(finding["uncertainty"], "ambiguous");
    assert_eq!(finding["assertions"][0]["key"], "c2");
    assert_eq!(finding["assertions"][0]["inputKey"], "input2");
    assert_eq!(finding["assertions"][0]["text"], "Generated extracted claim 2");
    assert_eq!(finding["assertions"][0]["evidenceKeys"], json!(["e2"]));
    assert_eq!(finding["assertions"][1]["key"], "c1");
    assert_eq!(finding["assertions"][1]["factDate"], Value::Null); // Never copy source/retrieval time.
    assert_eq!(wire["comparisons"][&key]["findingKey"], review.finding_keys()[0]);
    assert_eq!(wire["comparisons"][&key]["findingIndex"], 0);
    assert_eq!(wire["comparisons"][&key]["assertions"]["c2"], json!({"inputRef":"input2","version":"revision-1","evidenceRefs":["e2"]}));
    assert_eq!(wire["inspections"]["e2"]["inputRef"], "input2");
    assert_eq!(wire["view"]["sources"][0]["sourceDate"], "2020-01-01");
    assert_eq!(wire["view"]["sources"][0]["retrievedAt"], "2026-11-08T12:00:00Z");
    assert_eq!(wire["selections"], json!({}));
    assert!(wire["view"]["fields"].as_array().unwrap().is_empty());
    assert!(wire["view"]["candidates"].as_array().unwrap().is_empty());
    assert!(finding.get("winner").is_none());
}

#[test]
fn comparison_disclosure_empty_findings_retain_missing_evidence_without_a_decision() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Contradictions;
    let snapshot = AdmittedSnapshot::new(admitted).unwrap();
    let review = validate(&output(&snapshot, json!({"kind":"contradictions","findings":[]})), &snapshot).unwrap();
    let disclosure = disclose_review(&review, &snapshot, &Default::default()).unwrap();
    let wire = disclosure.value();
    assert_eq!(wire["view"]["contradictions"]["findings"], json!([]));
    assert_eq!(wire["view"]["contradictions"]["missingEvidence"], json!(["Actual physical correspondence is unknown"]));
    assert_eq!(wire["comparisons"], json!({}));
    assert_eq!(wire["selections"], json!({}));
    assert_eq!(wire["view"]["sources"][0]["original"], "unavailable");
}

#[test]
fn comparison_disclosure_refuses_changed_or_withdrawn_assertion_context() {
    let mut admitted = input(); admitted.feature = SuggestionFeature::Contradictions;
    let snapshot = AdmittedSnapshot::new(admitted.clone()).unwrap();
    let result = json!({"kind":"contradictions","findings":[{"pattern":"possible-supersession","claimRefs":["c1","c2"],
        "rationale":"Generated version comparison, no selected winner","uncertainty":"unknown"}]});
    let review = validate(&output(&snapshot, result), &snapshot).unwrap();
    for withdrawn in [false, true] {
        let mut current = admitted.clone();
        if withdrawn { current.sources[1].availability = Availability::Withdrawn; }
        else { current.sources[1].version = "revision-2".into(); }
        let current = AdmittedSnapshot::new(current).unwrap();
        let expected = if withdrawn { SuggestionError::ContextWithdrawn } else { SuggestionError::ContextChanged };
        assert_eq!(disclose_review(&review, &current, &Default::default()).unwrap_err(), expected);
    }
}
