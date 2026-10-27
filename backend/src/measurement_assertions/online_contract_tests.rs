//! FROZEN / UNREGISTERED / UNEXECUTED. In-memory generated contract examples.
//! Fake server envelopes demonstrate structural branches, not native admission,
//! committed storage, identity allocation, authorization or model verification.
use super::*;
use crate::contracts::v2::{Uncertainty, UncertaintyStatus};

fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}
fn sha(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}
fn scope() -> Scope {
    Scope {
        workspace_id: id(701),
        home_id: id(702),
    }
}
fn native(n: u64, kind: RecordRefRecordType) -> NativeRevision {
    NativeRevision {
        record: RecordRef {
            record_type: kind,
            record_id: id(n),
        },
        revision: 1,
        payload_sha256: sha(1),
    }
}
fn proposal() -> OnlineProposal {
    OnlineProposal {
        scope: scope(),
        mutation_id: id(710),
        operation: OnlineOperation::Create,
        target: TargetExpectation {
            building_id: "generated-building".into(),
            room_id: id(703),
            level_id: "generated-level".into(),
            occurrence_id: "generated-occurrence".into(),
            publication_id: id(704),
            source_revision_id: "generated-revision-a".into(),
            source_sha256: sha(2),
            semantics_sha256: sha(3),
            overview_manifest_sha256: sha(4),
            selection_revision: sha(5),
            artifact_sha256: sha(6),
            artifact_bytes: 256,
            target_feature_sha256: sha(7),
            source_object_ids: vec!["owner:generated-object".into()],
        },
        area: AreaProposal {
            decimal_token: "0012.5000".into(),
            unit: Unit::SquareMetre,
            quantity_kind: QuantityKind::Area,
            method: MeasurementMethod::Estimated,
            attestation: None,
            evidence: vec![],
            inputs: vec![],
            operation: None,
            contradicts: vec![],
        },
        reason: "Generated online contract claim".into(),
    }
}
fn committed(p: OnlineProposal) -> CommittedVersion {
    let t = &p.target;
    let model = ModelPin {
        scope: p.scope.clone(),
        building_id: t.building_id.clone(),
        publication_id: t.publication_id.clone(),
        artifact_id: "model".into(),
        artifact_sha256: t.artifact_sha256.clone(),
        artifact_bytes: t.artifact_bytes,
        lineage: ModelLineage::UnifiedAtlasPublication {
            source_revision_id: t.source_revision_id.clone(),
            source_sha256: t.source_sha256.clone(),
            semantics_sha256: t.semantics_sha256.clone(),
            overview_manifest_sha256: t.overview_manifest_sha256.clone(),
            selection_revision: t.selection_revision.clone(),
        },
        custody: ModelCustody::Unknown,
        physical_registration: PhysicalRegistration::Unknown,
    };
    let (assertion_id, revision, previous) = match &p.operation {
        OnlineOperation::Create => (id(720), 1, None),
        OnlineOperation::Correct {
            assertion_id,
            expected_revision,
            expected_payload_sha256,
        } => (
            assertion_id.clone(),
            expected_revision + 1,
            Some(AssertionVersion {
                assertion_id: assertion_id.clone(),
                revision: *expected_revision,
                payload_sha256: expected_payload_sha256.clone(),
            }),
        ),
    };
    let version = AssertionVersion {
        assertion_id,
        revision,
        payload_sha256: sha(20 + revision as u8),
    };
    let assertion = MeasurementAssertion {
        version: version.clone(),
        previous,
        target: SemanticTarget {
            scope: p.scope.clone(),
            namespace: SemanticNamespace::ProducerPublication {
                publication_id: t.publication_id.clone(),
            },
            building_id: t.building_id.clone(),
            room_id: t.room_id.clone(),
            floor_id: t.level_id.clone(),
            occurrence_id: t.occurrence_id.clone(),
            feature: SemanticFeature::Room,
        },
        property: MeasurementProperty::OccurrenceArea,
        value: ExactQuantity {
            entered: DecimalToken::parse(&p.area.decimal_token).unwrap(),
            unit: p.area.unit,
            kind: p.area.quantity_kind,
        },
        entered_against: model.clone(),
        target_feature_sha256: t.target_feature_sha256.clone(),
        method: p.area.method,
        support: MeasurementSupport {
            corroboration: Corroboration::NotEstablished,
            uncertainties: vec![Uncertainty {
                status: UncertaintyStatus::Inferred,
                explanation: Some("Generated estimate, no physical verification".into()),
            }],
            limitations: vec![SupportLimitation::Estimated],
        },
        inputs: vec![],
        operation: p.area.operation.clone(),
        evidence: p
            .area
            .evidence
            .iter()
            .map(|e| EvidenceLink {
                role: e.role,
                evidence: NativeRevision {
                    record: e.reference.record.clone(),
                    revision: e.reference.expected_revision,
                    payload_sha256: e.reference.expected_payload_sha256.clone(),
                },
            })
            .collect(),
        supersedes: vec![],
        contradicts: p
            .area
            .contradicts
            .iter()
            .map(AssertionExpectation::pin)
            .collect(),
        resolutions: vec![],
        review: ClaimReview::NoKnownIssue,
        change_reason: p.reason.clone(),
        native_audit_id: id(730 + revision),
    };
    CommittedVersion {
        proposal_sha256: proposal_digest(&p).unwrap(),
        receipt_key: ReceiptKey {
            scope: p.scope.clone(),
            actor_id: id(740),
            mutation_id: p.mutation_id.clone(),
        },
        audit: AuditAnchor {
            audit_id: assertion.native_audit_id.clone(),
            actor_id: id(740),
            mutation_id: p.mutation_id.clone(),
            server_recorded_at: "2026-01-02T03:04:05Z".into(),
            previous_revision: assertion.previous.as_ref().map(|pin| pin.revision),
            result_revision: revision,
        },
        target_admission: TargetAdmission::Resolved {
            room_identity: native(750, RecordRefRecordType::Identity),
            room_semantics: native(751, RecordRefRecordType::LocationSemantics),
            mapping_review: Box::new(native(752, RecordRefRecordType::Evidence)),
            source_object_ids: t.source_object_ids.clone(),
        },
        acquisition: AcquisitionFacts::ImageInformedEstimate,
        pending: PendingWork {
            assertion: version,
            model,
            target_feature_sha256: t.target_feature_sha256.clone(),
            unresolved_conflicts: vec![],
        },
        assertion,
        proposal: p,
    }
}
fn corrected(old: &CommittedVersion) -> CommittedVersion {
    let mut p = old.proposal.clone();
    p.mutation_id = id(711);
    p.operation = OnlineOperation::Correct {
        assertion_id: old.assertion.version.assertion_id.clone(),
        expected_revision: old.assertion.version.revision,
        expected_payload_sha256: old.assertion.version.payload_sha256.clone(),
    };
    p.area.decimal_token = "13.2500".into();
    committed(p)
}
fn history(rows: &[CommittedVersion]) -> (FullHistory, Vec<MeasurementAssertion>) {
    (
        FullHistory {
            scope: scope(),
            assertion_id: rows[0].assertion.version.assertion_id.clone(),
            expected_current_head: rows.last().unwrap().assertion.version.clone(),
            read_point: ReadPoint {
                marker: "generated-read-cut".into(),
            },
            versions: rows.to_vec(),
        },
        rows.iter().map(|row| row.assertion.clone()).collect(),
    )
}
fn current_at(h: &FullHistory, all: &[MeasurementAssertion]) -> ValidationResult<Current> {
    current(
        h,
        CurrentClosure::CompleteAtReadPoint {
            read_point: h.read_point.clone(),
            assertions: all,
        },
    )
}

#[test]
fn create_identity_and_exact_entry_are_separate_from_proposal() {
    let p = proposal();
    let canonical = canonical_proposal(&p).unwrap();
    assert!(canonical.contains("\"decimalToken\":\"0012.5000\""));
    assert!(canonical.contains("\"operation\":{\"kind\":\"create\"}"));
    assert!(!canonical.contains("assertionId"));
    assert!(!canonical.contains("actorId"));
    assert!(!canonical.contains("serverRecordedAt"));
    let row = committed(p);
    validate_committed(&row).unwrap();
    assert_eq!(row.assertion.value.entered.token(), "0012.5000");
    assert_ne!(row.assertion.version.assertion_id, row.proposal.mutation_id);
    assert_eq!(row.assertion.entered_against.custody, ModelCustody::Unknown);
    assert_eq!(
        row.assertion.entered_against.physical_registration,
        PhysicalRegistration::Unknown
    );
}

#[test]
fn digest_binds_complete_typed_proposal_without_self_reference() {
    let p = proposal();
    let first = proposal_digest(&p).unwrap();
    assert_eq!(first.len(), 64);
    assert_eq!(proposal_digest(&p.clone()).unwrap(), first);
    let mut variants = vec![];
    let mut q = p.clone();
    q.mutation_id = id(712);
    variants.push(q);
    let mut q = p.clone();
    q.scope.home_id = id(713);
    variants.push(q);
    let mut q = p.clone();
    q.reason.push('!');
    variants.push(q);
    let mut q = p.clone();
    q.area.decimal_token = "12.5".into();
    variants.push(q);
    let mut q = p.clone();
    q.area.unit = Unit::SquareCentimetre;
    variants.push(q);
    let mut q = p.clone();
    q.area.method = MeasurementMethod::Guessed;
    variants.push(q);
    let mut q = p.clone();
    q.target.source_revision_id.push('b');
    variants.push(q);
    let mut q = p.clone();
    q.target.artifact_sha256 = sha(8);
    variants.push(q);
    let mut q = p.clone();
    q.target
        .source_object_ids
        .push("owner:second-object".into());
    variants.push(q);
    let mut q = p.clone();
    q.area.evidence.push(EvidenceProposal {
        reference: NativeExpectation {
            record: native(760, RecordRefRecordType::Evidence).record,
            expected_revision: 2,
            expected_payload_sha256: sha(9),
        },
        role: EvidenceRole::Context,
    });
    variants.push(q);
    for q in variants {
        assert_ne!(proposal_digest(&q).unwrap(), first);
    }
    assert!(!canonical_proposal(&p).unwrap().contains("proposalSha256"));
}

#[test]
fn retained_retry_precedes_allocation_and_rematerialization() {
    let p = proposal();
    assert!(matches!(
        classify_retry(&p, &id(740), None).unwrap(),
        RetryDecision::NeedsAdmissionBeforeAllocation
    ));
    let row = committed(p.clone());
    match classify_retry(&p, &id(740), Some(&row)).unwrap() {
        RetryDecision::Retained(actual) => assert!(std::ptr::eq(actual, &row)),
        _ => panic!("must return original retained server allocation"),
    }
    let mut changed = p;
    changed.target.selection_revision = sha(10);
    assert!(classify_retry(&changed, &id(740), Some(&row)).is_err());
    assert!(classify_retry(&row.proposal, &id(741), Some(&row)).is_err());
}

#[test]
fn current_and_full_history_keep_prior_values_and_pending_versions() {
    let old = committed(proposal());
    let next = corrected(&old);
    let (h, all) = history(&[old.clone(), next.clone()]);
    validate_full_history(&h, &all).unwrap();
    assert_eq!(current_at(&h, &all).unwrap().head, next);
    assert_eq!(h.versions[0].assertion.value.entered.token(), "0012.5000");
    assert_eq!(h.versions[1].assertion.value.entered.token(), "13.2500");
    assert_ne!(
        h.versions[0].pending.assertion,
        h.versions[1].pending.assertion
    );
    assert_eq!(h.versions[0].proposal, old.proposal);
    let mut incomplete = h.clone();
    incomplete.versions.remove(0);
    assert!(validate_full_history(&incomplete, &all).is_err());
    let mut missing_tail = h;
    missing_tail.versions.pop();
    assert!(validate_full_history(&missing_tail, &all[..1]).is_err());
}

#[test]
fn correction_rejects_stale_predecessor_and_publication_retarget() {
    let old = committed(proposal());
    let mut next = corrected(&old);
    next.assertion.previous.as_mut().unwrap().payload_sha256 = sha(31);
    assert!(validate_committed(&next).is_err());
    let mut p = corrected(&old).proposal;
    p.target.publication_id = id(705);
    let retarget = committed(p);
    let (h, all) = history(&[old, retarget]);
    assert!(validate_full_history(&h, &all).is_err());
}

#[test]
fn unresolved_mapping_cannot_admit_a_claim() {
    let row = committed(proposal());
    for admission in [TargetAdmission::Unresolved, TargetAdmission::ReviewRequired] {
        let mut bad = row.clone();
        bad.target_admission = admission;
        assert!(validate_committed(&bad).is_err());
    }
    let mut bad = row;
    if let TargetAdmission::Resolved {
        source_object_ids, ..
    } = &mut bad.target_admission
    {
        source_object_ids.clear();
    }
    assert!(validate_committed(&bad).is_err());
}

#[test]
fn photo_evidence_does_not_promote_image_informed_estimate() {
    let mut p = proposal();
    p.area.evidence.push(EvidenceProposal {
        reference: NativeExpectation {
            record: native(761, RecordRefRecordType::Evidence).record,
            expected_revision: 1,
            expected_payload_sha256: sha(1),
        },
        role: EvidenceRole::Supports,
    });
    let row = committed(p.clone());
    validate_committed(&row).unwrap();
    assert_eq!(row.assertion.method, MeasurementMethod::Estimated);
    for promoted in [
        MeasurementMethod::DirectlyMeasured,
        MeasurementMethod::PhotoFitted,
    ] {
        let mut bad = row.clone();
        bad.proposal.area.method = promoted;
        bad.assertion.method = promoted;
        bad.proposal_sha256 = proposal_digest(&bad.proposal).unwrap();
        bad.assertion
            .support
            .limitations
            .push(SupportLimitation::PhotoFitted);
        assert!(validate_committed(&bad).is_err());
        bad.acquisition = AcquisitionFacts::Unqualified;
        assert!(validate_committed(&bad).is_err());
    }
}

#[test]
fn derived_support_keeps_inherited_estimate_and_photo_limits() {
    let mut p = proposal();
    p.area.method = MeasurementMethod::Derived;
    p.area.inputs = vec![InputExpectation::SelectedModel];
    p.area.operation = Some("generated projected floor-area derivation".into());
    let mut row = committed(p);
    row.acquisition = AcquisitionFacts::Unqualified;
    let inherited = MeasurementSupport {
        corroboration: Corroboration::Corroborated,
        uncertainties: vec![Uncertainty {
            status: UncertaintyStatus::Unknown,
            explanation: Some("Generated unknown physical registration".into()),
        }],
        limitations: vec![SupportLimitation::Estimated, SupportLimitation::PhotoFitted],
    };
    row.assertion.inputs.push(ProvenanceInput {
        pin: InputPin::Model(Box::new(row.assertion.entered_against.clone())),
        methods: vec![MeasurementMethod::Estimated],
        support: inherited.clone(),
    });
    row.assertion
        .support
        .uncertainties
        .extend(inherited.uncertainties);
    row.assertion
        .support
        .limitations
        .push(SupportLimitation::PhotoFitted);
    validate_committed(&row).unwrap();
    row.assertion
        .support
        .limitations
        .retain(|limit| *limit != SupportLimitation::PhotoFitted);
    assert!(validate_committed(&row).is_err());
}

#[test]
fn inherited_conflicts_survive_equal_value_correction() {
    let mut p = proposal();
    p.area.evidence.push(EvidenceProposal {
        reference: NativeExpectation {
            record: native(762, RecordRefRecordType::Evidence).record,
            expected_revision: 1,
            expected_payload_sha256: sha(1),
        },
        role: EvidenceRole::Contradicts,
    });
    let mut old = committed(p);
    let conflict = ContradictionRef::Evidence {
        raised_by: old.assertion.version.clone(),
        evidence: old.assertion.evidence[0].evidence.clone(),
    };
    old.pending.unresolved_conflicts.push(conflict.clone());
    let mut next = corrected(&old);
    next.proposal.area.evidence.clear();
    next.assertion.evidence.clear();
    next.proposal.area.decimal_token = old.proposal.area.decimal_token.clone();
    next.assertion.value = old.assertion.value.clone();
    next.proposal_sha256 = proposal_digest(&next.proposal).unwrap();
    next.pending.unresolved_conflicts.push(conflict);
    let (h, all) = history(&[old, next]);
    validate_full_history(&h, &all).unwrap();
    let mut omitted = h;
    omitted.versions[1].pending.unresolved_conflicts.clear();
    assert!(validate_full_history(&omitted, &all).is_err());
}

#[test]
fn audited_create_and_receipt_correlations_are_required() {
    let old = committed(proposal());
    let next = corrected(&old);
    let (h, all) = history(&[next]);
    assert!(validate_full_history(&h, &all).is_err());
    let mut bad = old.clone();
    bad.audit.mutation_id = id(799);
    assert!(validate_committed(&bad).is_err());
    let mut bad = old;
    bad.proposal_sha256 = sha(99);
    assert!(validate_committed(&bad).is_err());
}

#[test]
fn pending_work_rejects_other_revision_or_artifact_and_has_no_closure() {
    let row = committed(proposal());
    let mut bad = row.clone();
    bad.pending.assertion.revision += 1;
    assert!(validate_committed(&bad).is_err());
    let mut bad = row;
    bad.pending.model.artifact_sha256 = sha(100);
    assert!(validate_committed(&bad).is_err());
    let key = ReceiptKey {
        scope: scope(),
        actor_id: id(740),
        mutation_id: id(710),
    };
    let outcome = classify_outcome(
        &key,
        ReadPoint {
            marker: "generated-read-point".into(),
        },
        None,
    )
    .unwrap();
    assert!(matches!(
        outcome,
        MutationOutcome::NotRecordedAtReadPoint(_)
    ));
    let retained = committed(proposal());
    assert!(matches!(
        classify_outcome(
            &key,
            ReadPoint {
                marker: "generated-read-point".into()
            },
            Some(&retained)
        )
        .unwrap(),
        MutationOutcome::Committed(_)
    ));
    let foreign = ReceiptKey {
        actor_id: id(741),
        ..key
    };
    assert!(
        classify_outcome(
            &foreign,
            ReadPoint {
                marker: "generated-read-point".into()
            },
            Some(&retained)
        )
        .is_err()
    );
}

#[test]
fn online_scope_refuses_length_legacy_and_unbounded_preconditions() {
    let mut p = proposal();
    p.area.quantity_kind = QuantityKind::Length;
    p.area.unit = Unit::Metre;
    assert!(validate_proposal(&p).is_err());
    let mut p = proposal();
    p.area.method = MeasurementMethod::LegacyUserReportedMethodUnspecified;
    assert!(validate_proposal(&p).is_err());
    let mut p = proposal();
    p.target.artifact_bytes = MAX_REVISION + 1;
    assert!(validate_proposal(&p).is_err());
    let mut p = proposal();
    p.area.decimal_token = "1e1".into();
    assert!(validate_proposal(&p).is_err());
}

#[test]
fn receipt_key_allows_same_mutation_uuid_for_distinct_actors() {
    let old = committed(proposal());
    let mut next = corrected(&old);
    next.proposal.mutation_id = old.proposal.mutation_id.clone();
    next.proposal_sha256 = proposal_digest(&next.proposal).unwrap();
    next.receipt_key.mutation_id = old.proposal.mutation_id.clone();
    next.audit.mutation_id = old.proposal.mutation_id.clone();
    next.receipt_key.actor_id = id(741);
    next.audit.actor_id = id(741);
    let (h, all) = history(&[old.clone(), next.clone()]);
    validate_full_history(&h, &all).unwrap();
    assert_eq!(old.receipt_key.mutation_id, next.receipt_key.mutation_id);
    assert_ne!(old.receipt_key, next.receipt_key);
    assert!(matches!(
        classify_retry(&next.proposal, &id(741), Some(&next)).unwrap(),
        RetryDecision::Retained(_)
    ));
    assert!(classify_retry(&next.proposal, &id(740), Some(&next)).is_err());
}

#[test]
fn receipt_key_rejects_duplicate_complete_key() {
    let old = committed(proposal());
    let mut next = corrected(&old);
    next.proposal.mutation_id = old.proposal.mutation_id.clone();
    next.proposal_sha256 = proposal_digest(&next.proposal).unwrap();
    next.receipt_key.mutation_id = old.proposal.mutation_id.clone();
    next.audit.mutation_id = old.proposal.mutation_id.clone();
    validate_committed(&next).unwrap();
    assert_eq!(old.receipt_key, next.receipt_key);
    let (h, all) = history(&[old, next]);
    assert!(validate_full_history(&h, &all).is_err());
}

#[test]
fn current_projection_includes_later_contradiction_and_successor_heads() {
    let a = committed(proposal());
    let original_receipt = a.clone();
    let (mut h, _) = history(std::slice::from_ref(&a));
    let mut p = proposal();
    p.mutation_id = id(712);
    p.area.contradicts.push(AssertionExpectation {
        assertion_id: a.assertion.version.assertion_id.clone(),
        expected_revision: a.assertion.version.revision,
        expected_payload_sha256: a.assertion.version.payload_sha256.clone(),
    });
    let mut b = committed(p);
    b.assertion.version.assertion_id = id(721);
    b.pending.assertion = b.assertion.version.clone();
    b.audit.audit_id = id(780);
    b.assertion.native_audit_id = b.audit.audit_id.clone();
    let conflict = ContradictionRef::Assertions {
        raised_by: b.assertion.version.clone(),
        against: a.assertion.version.clone(),
    };
    b.pending.unresolved_conflicts.push(conflict.clone());
    validate_committed(&b).unwrap();
    let all = vec![a.assertion.clone(), b.assertion.clone()];
    h.read_point.marker = "generated-current-cut-after-B".into();
    let fresh = current_at(&h, &all).unwrap();
    assert_eq!(fresh.head, original_receipt);
    assert!(fresh.head.pending.unresolved_conflicts.is_empty());
    assert_eq!(fresh.current_conflicts.assertion, a.assertion.version);
    assert_eq!(fresh.current_conflicts.read_point, h.read_point);
    assert_eq!(fresh.current_conflicts.conflicts.len(), 1);
    assert_eq!(fresh.current_conflicts.conflicts[0].contradiction, conflict);
    assert!(
        fresh.current_conflicts.conflicts[0]
            .affected_heads
            .contains(&b.assertion.version)
    );
    let mut b2 = corrected(&b);
    b2.proposal.area.contradicts.clear();
    b2.assertion.contradicts.clear();
    b2.proposal_sha256 = proposal_digest(&b2.proposal).unwrap();
    b2.pending.unresolved_conflicts.push(conflict);
    let all_after_correction = vec![
        a.assertion.clone(),
        b.assertion.clone(),
        b2.assertion.clone(),
    ];
    h.read_point.marker = "generated-current-cut-after-B-correction".into();
    let later = current_at(&h, &all_after_correction).unwrap();
    assert_eq!(later.head, original_receipt);
    assert_eq!(a, original_receipt);
    assert_eq!(later.current_conflicts.conflicts.len(), 1);
    let affected = &later.current_conflicts.conflicts[0].affected_heads;
    assert!(affected.contains(&a.assertion.version));
    assert!(affected.contains(&b2.assertion.version));
    assert!(!affected.contains(&b.assertion.version));
}

#[test]
fn current_projection_refuses_unavailable_or_mismatched_read_cut() {
    let a = committed(proposal());
    let (h, all) = history(&[a]);
    assert!(
        current_at(&h, &all)
            .unwrap()
            .current_conflicts
            .conflicts
            .is_empty()
    );
    assert!(current(&h, CurrentClosure::Unavailable).is_err());
    assert!(
        current(
            &h,
            CurrentClosure::CompleteAtReadPoint {
                read_point: ReadPoint {
                    marker: "generated-different-cut".into()
                },
                assertions: &all,
            }
        )
        .is_err()
    );
    assert!(
        current(
            &h,
            CurrentClosure::CompleteAtReadPoint {
                read_point: h.read_point.clone(),
                assertions: &[],
            }
        )
        .is_err()
    );
}

// FROZEN / UNREGISTERED / UNEXECUTED.
// Additive frozen source in measurement_assertions/online_contract_tests.rs.
// Existing proposal() helper only adds attestation: None to compile the new field;
// existing test FUNCTION bodies remain byte-identical. These documentary
// envelopes test structural correlation, not native authorization or storage.
fn personal_proposal() -> OnlineProposal {
    let mut p = proposal();
    p.area.method = MeasurementMethod::UserReportedMeasured;
    p.area.attestation = Some(PersonalMeasurementAttestation::PersonallyMeasured);
    p.area.evidence.clear();
    p.area.inputs.clear();
    p.area.operation = None;
    p.reason = "Record user-reported measurement".into();
    p
}
fn personal_row(p: OnlineProposal) -> CommittedVersion {
    let mut row = committed(p);
    row.assertion.support = MeasurementSupport {
        corroboration: Corroboration::NotEstablished,
        uncertainties: vec![Uncertainty {
            status: UncertaintyStatus::Unknown,
            explanation: None,
        }],
        limitations: vec![SupportLimitation::UserReportedMeasurement],
    };
    row.acquisition = AcquisitionFacts::UserReportedMeasurement {
        attestation: PersonalMeasurementAttestation::PersonallyMeasured,
        actor_id: row.audit.actor_id.clone(),
        recorded_at: row.audit.server_recorded_at.clone(),
    };
    row
}
#[test]
fn personal_measurement_requires_explicit_attestation_and_digest_binding() {
    let old = proposal();
    assert!(!canonical_proposal(&old).unwrap().contains("attestation"));
    let mut p = personal_proposal();
    validate_proposal(&p).unwrap();
    let canonical = canonical_proposal(&p).unwrap();
    assert!(canonical.contains("\"method\":\"user-reported-measured\""));
    assert!(canonical.contains("\"attestation\":{\"kind\":\"personally-measured\"}"));
    assert_ne!(proposal_digest(&old).unwrap(), proposal_digest(&p).unwrap());
    assert!(!canonical.contains("actorId") && !canonical.contains("recordedAt"));
    p.area.attestation = None;
    assert!(validate_proposal(&p).is_err());
    p.area.method = MeasurementMethod::Estimated;
    p.area.attestation = Some(PersonalMeasurementAttestation::PersonallyMeasured);
    assert!(validate_proposal(&p).is_err());
}
#[test]
fn personal_measurement_client_actor_and_time_are_refused() {
    let p = personal_proposal();
    let raw =
        crate::contracts::measurement_assertions::parse(canonical_proposal(&p).unwrap().as_bytes())
            .unwrap();
    let mut spoofed = raw.clone();
    spoofed["area"]["attestation"]["actorId"] = serde_json::json!(id(799));
    assert!(crate::contracts::measurement_assertions::proposal(&spoofed).is_err());
    let mut spoofed = raw;
    spoofed["area"]["attestation"]["recordedAt"] = serde_json::json!("2020-01-01T00:00:00Z");
    assert!(crate::contracts::measurement_assertions::proposal(&spoofed).is_err());
    let valid = personal_row(p);
    validate_committed(&valid).unwrap();
    let mut wrong_actor = valid.clone();
    if let AcquisitionFacts::UserReportedMeasurement { actor_id, .. } = &mut wrong_actor.acquisition
    {
        *actor_id = id(799);
    }
    assert!(validate_committed(&wrong_actor).is_err());
    let mut wrong_time = valid;
    if let AcquisitionFacts::UserReportedMeasurement { recorded_at, .. } =
        &mut wrong_time.acquisition
    {
        *recorded_at = "2020-01-01T00:00:00Z".into();
    }
    assert!(validate_committed(&wrong_time).is_err());
}
#[test]
fn personal_measurement_corrections_and_derived_inputs_keep_origin() {
    let first = personal_row(personal_proposal());
    validate_committed(&first).unwrap();
    let retained_first = first.clone();
    let mut correction = first.proposal.clone();
    correction.mutation_id = id(711);
    correction.operation = OnlineOperation::Correct {
        assertion_id: first.assertion.version.assertion_id.clone(),
        expected_revision: first.assertion.version.revision,
        expected_payload_sha256: first.assertion.version.payload_sha256.clone(),
    };
    correction.area.decimal_token = "13.2500".into();
    // This explicit source proposal denotes a NEW actual correcting person's
    // attestation, not a UI auto-copy. Pure envelopes confer no native authority.
    let mut second = personal_row(correction);
    second.receipt_key.actor_id = id(741);
    second.audit.actor_id = id(741);
    if let AcquisitionFacts::UserReportedMeasurement { actor_id, .. } = &mut second.acquisition {
        *actor_id = id(741);
    }
    validate_committed(&second).unwrap();
    let mut p = proposal();
    p.mutation_id = id(713);
    p.area.method = MeasurementMethod::Derived;
    p.area.attestation = None;
    p.area.inputs = vec![InputExpectation::Assertion(AssertionExpectation {
        assertion_id: first.assertion.version.assertion_id.clone(),
        expected_revision: first.assertion.version.revision,
        expected_payload_sha256: first.assertion.version.payload_sha256.clone(),
    })];
    p.area.operation = Some("generated-reference-preserving-transform".into());
    let mut derived = committed(p);
    derived.assertion.version.assertion_id = id(721);
    derived.pending.assertion = derived.assertion.version.clone();
    derived.assertion.native_audit_id = id(780);
    derived.audit.audit_id = id(780);
    derived.acquisition = AcquisitionFacts::Unqualified;
    derived.assertion.support = first.assertion.support.clone();
    derived.assertion.inputs = vec![ProvenanceInput {
        pin: InputPin::Assertion(first.assertion.version.clone()),
        methods: vec![MeasurementMethod::UserReportedMeasured],
        support: first.assertion.support.clone(),
    }];
    validate_committed(&derived).unwrap();
    let all = vec![
        first.assertion.clone(),
        second.assertion.clone(),
        derived.assertion.clone(),
    ];
    validate_history(&all).unwrap();
    let h = FullHistory {
        scope: scope(),
        assertion_id: first.assertion.version.assertion_id.clone(),
        expected_current_head: second.assertion.version.clone(),
        read_point: ReadPoint {
            marker: "generated-personal-history".into(),
        },
        versions: vec![first.clone(), second.clone()],
    };
    validate_full_history(&h, &all).unwrap();
    assert_eq!(first, retained_first);
    assert_eq!(
        derived.assertion.inputs[0].pin,
        InputPin::Assertion(first.assertion.version.clone())
    );
    assert!(
        derived
            .assertion
            .support
            .limitations
            .contains(&SupportLimitation::UserReportedMeasurement)
    );
    assert_eq!(first.pending.assertion, first.assertion.version);
    assert_eq!(second.pending.assertion, second.assertion.version);
    assert_eq!(derived.pending.assertion, derived.assertion.version);
}
#[test]
fn personal_measurement_does_not_replace_reviewed_direct_or_legacy_meanings() {
    let row = personal_row(personal_proposal());
    validate_committed(&row).unwrap();
    assert_eq!(
        row.assertion.method,
        MeasurementMethod::UserReportedMeasured
    );
    assert_eq!(
        row.assertion.support.corroboration,
        Corroboration::NotEstablished
    );
    assert_eq!(
        row.assertion.support.uncertainties,
        vec![Uncertainty {
            status: UncertaintyStatus::Unknown,
            explanation: None
        }]
    );
    assert_eq!(row.assertion.entered_against.custody, ModelCustody::Unknown);
    assert_eq!(
        row.assertion.entered_against.physical_registration,
        PhysicalRegistration::Unknown
    );
    let mut wrong = row.clone();
    wrong.assertion.method = MeasurementMethod::DirectlyMeasured;
    assert!(validate_committed(&wrong).is_err());
    let mut legacy = proposal();
    legacy.area.method = MeasurementMethod::LegacyUserReportedMethodUnspecified;
    assert!(validate_proposal(&legacy).is_err());
    assert!(matches!(
        row.acquisition,
        AcquisitionFacts::UserReportedMeasurement { .. }
    ));
    assert_eq!(row.pending.model, row.assertion.entered_against);
}
