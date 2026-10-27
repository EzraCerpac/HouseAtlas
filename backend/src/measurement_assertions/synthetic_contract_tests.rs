//! FROZEN / UNEXECUTED. Generated in-memory examples only. These names and
//! bodies require source-owner review, registration and exact-head release.
//! Merely registering the parent module would make them discoverable: do not
//! run a broad suite. There is no standalone harness or manifest bypass here.

use std::{
    cell::{Cell, RefCell},
    cmp::Ordering,
};

use crate::contracts::v2::{RecordRef, RecordRefRecordType, Scope, Uncertainty, UncertaintyStatus};

use super::*;

fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

fn sha(n: u8) -> String {
    format!("{n:02x}").repeat(32)
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

fn scope() -> Scope {
    Scope {
        workspace_id: id(1),
        home_id: id(2),
    }
}

fn model() -> ModelPin {
    ModelPin {
        scope: scope(),
        building_id: id(3),
        publication_id: id(7),
        lineage: ModelLineage::NativeIfcSource(NativeIfcLineage {
            source_id: id(4),
            source_revision_id: id(5),
            source_revision_sha256: sha(2),
            source_asset_id: id(6),
            source_sha256: sha(3),
            publication_sha256: sha(4),
            semantic_map_revision_id: id(8),
            semantic_map_sha256: sha(5),
        }),
        artifact_id: "synthetic-floor-artifact".into(),
        artifact_sha256: sha(6),
        artifact_bytes: 128,
        custody: ModelCustody::NativeRecords {
            geometry: native(9, RecordRefRecordType::Geometry),
            association: native(10, RecordRefRecordType::SceneAssociation),
        },
        physical_registration: PhysicalRegistration::Reviewed {
            evidence: native(16, RecordRefRecordType::Evidence),
        },
    }
}

fn quantity(token: &str, unit: Unit) -> ExactQuantity {
    ExactQuantity {
        entered: DecimalToken::parse(token).unwrap(),
        unit,
        kind: unit.kind(),
    }
}

fn support(status: UncertaintyStatus, limitations: Vec<SupportLimitation>) -> MeasurementSupport {
    MeasurementSupport {
        corroboration: Corroboration::NotEstablished,
        uncertainties: vec![Uncertainty {
            status,
            explanation: Some("Generated contract example only".into()),
        }],
        limitations,
    }
}

fn assertion() -> MeasurementAssertion {
    MeasurementAssertion {
        version: AssertionVersion {
            assertion_id: id(20),
            revision: 1,
            payload_sha256: sha(7),
        },
        previous: None,
        target: SemanticTarget {
            scope: scope(),
            building_id: id(3),
            room_id: id(11),
            floor_id: id(12),
            namespace: SemanticNamespace::NativeSource { source_id: id(4) },
            occurrence_id: "synthetic-occurrence".into(),
            feature: SemanticFeature::Wall {
                wall_id: id(13),
                endpoint_ids: [id(14), id(15)],
            },
        },
        property: MeasurementProperty::WallLength,
        value: quantity("003.1250", Unit::Metre),
        entered_against: model(),
        target_feature_sha256: sha(8),
        method: MeasurementMethod::DirectlyMeasured,
        support: support(UncertaintyStatus::Supported, vec![]),
        inputs: vec![],
        operation: None,
        evidence: vec![],
        supersedes: vec![],
        contradicts: vec![],
        resolutions: vec![],
        review: ClaimReview::NoKnownIssue,
        change_reason: "Generated exact-entry contract example".into(),
        native_audit_id: id(30),
    }
}

fn observation(row: &MeasurementAssertion) -> ModelObservation {
    ModelObservation {
        target: row.target.clone(),
        property: row.property,
        model: row.entered_against.clone(),
        value: quantity("3125", Unit::Millimetre),
        feature_sha256: row.target_feature_sha256.clone(),
    }
}

fn record(row: &MeasurementAssertion, observation: &ModelObservation) -> CorrespondenceRecord {
    CorrespondenceRecord {
        assertion: row.version.clone(),
        observation: observation.clone(),
        geometry_review: GeometryReview::ExistingShapeVerified,
        verification_evidence: native(31, RecordRefRecordType::Evidence),
    }
}

/// Generated snapshots of qualification requests; no native proof is created.
#[derive(Debug, Clone, PartialEq)]
struct SupportSnapshot {
    assertion: AssertionVersion,
    retained_support: MeasurementSupport,
    inherited_inputs: Vec<ProvenanceInput>,
    evidence_roles_and_revisions: Vec<EvidenceLink>,
    history_versions: Vec<AssertionVersion>,
    reviewed_dispositions: Vec<(AssertionVersion, ReviewedContradictionResolution)>,
}

fn support_snapshot(request: &SupportQualificationRequest<'_>) -> SupportSnapshot {
    SupportSnapshot {
        assertion: request.assertion.version.clone(),
        retained_support: request.retained_support.clone(),
        inherited_inputs: request.inherited_inputs.to_vec(),
        evidence_roles_and_revisions: request.evidence_roles_and_revisions.to_vec(),
        history_versions: request
            .history
            .iter()
            .map(|row| row.version.clone())
            .collect(),
        reviewed_dispositions: request
            .reviewed_dispositions
            .iter()
            .map(|review| {
                (
                    review.resolving_assertion.version.clone(),
                    review.resolution.clone(),
                )
            })
            .collect(),
    }
}

/// A generated recording port, never native verification or retained-byte proof.
struct FakeAuthority {
    verdict: CorrespondenceVerdict,
    calls: Cell<usize>,
    resolution_verdict: CorrespondenceVerdict,
    resolution_calls: Cell<usize>,
    support_verdict: SupportQualificationVerdict,
    support_requests: RefCell<Vec<SupportSnapshot>>,
    correspondence_requests: RefCell<Vec<SupportSnapshot>>,
}

impl FakeAuthority {
    fn verified() -> Self {
        Self {
            verdict: CorrespondenceVerdict::Verified,
            calls: Cell::new(0),
            resolution_verdict: CorrespondenceVerdict::Unavailable,
            resolution_calls: Cell::new(0),
            support_verdict: SupportQualificationVerdict::Qualified,
            support_requests: RefCell::new(vec![]),
            correspondence_requests: RefCell::new(vec![]),
        }
    }
}

impl ModelCorrespondenceAuthority for FakeAuthority {
    fn qualify_support(
        &self,
        request: &SupportQualificationRequest<'_>,
    ) -> SupportQualificationVerdict {
        self.support_requests
            .borrow_mut()
            .push(support_snapshot(request));
        self.support_verdict
    }

    fn verify_resolution(
        &self,
        _: &MeasurementAssertion,
        _: &ReviewedContradictionResolution,
        _: &[MeasurementAssertion],
    ) -> CorrespondenceVerdict {
        self.resolution_calls.set(self.resolution_calls.get() + 1);
        self.resolution_verdict
    }

    fn verify(
        &self,
        _: &MeasurementAssertion,
        _: &ModelObservation,
        _: &CorrespondenceRecord,
        support: &SupportQualificationRequest<'_>,
    ) -> CorrespondenceVerdict {
        self.calls.set(self.calls.get() + 1);
        self.correspondence_requests
            .borrow_mut()
            .push(support_snapshot(support));
        self.verdict
    }
}

#[test]
fn exact_decimal_tokens_and_metric_equivalence() {
    let entered = quantity("003.1250", Unit::Metre);
    assert_eq!(entered.entered.token(), "003.1250");
    assert_eq!(
        entered
            .compare(&quantity("3125", Unit::Millimetre))
            .unwrap(),
        Ordering::Equal
    );
    assert_eq!(
        quantity("2.5000", Unit::SquareMetre)
            .compare(&quantity("25000", Unit::SquareCentimetre))
            .unwrap(),
        Ordering::Equal
    );
    assert_eq!(
        quantity("0.000000000000000001", Unit::Metre)
            .compare(&quantity("0.000000000000001", Unit::Millimetre))
            .unwrap(),
        Ordering::Equal
    );
    assert_eq!(
        quantity(&"9".repeat(64), Unit::SquareMetre)
            .compare(&quantity("1", Unit::SquareMetre))
            .unwrap(),
        Ordering::Greater
    );
    // These could round to the same display text; exact comparison stays unequal.
    assert_eq!(
        quantity("3.1249", Unit::Metre).compare(&entered).unwrap(),
        Ordering::Less
    );
}

#[test]
fn invalid_decimal_and_dimension_contracts() {
    for token in [
        "",
        "0",
        "00.000",
        "-1",
        "+1",
        "1e3",
        " 1",
        "1,25",
        ".5",
        "1.",
        "1.2.3",
        "NaN",
        "Infinity",
        "0.0000000000000000001",
    ] {
        assert!(DecimalToken::parse(token).is_err(), "{token}");
    }
    assert!(DecimalToken::parse(&"1".repeat(65)).is_err());
    assert!(
        quantity("1", Unit::Metre)
            .compare(&quantity("1", Unit::SquareMetre))
            .is_err()
    );
    let mut wrong = assertion();
    wrong.value.kind = QuantityKind::Area;
    assert!(validate_assertion(&wrong).is_err());
}

#[test]
fn multiple_native_evidence_sources_and_legacy_origin() {
    let mut row = assertion();
    row.evidence = vec![
        EvidenceLink {
            evidence: native(40, RecordRefRecordType::Evidence),
            role: EvidenceRole::Supports,
        },
        EvidenceLink {
            evidence: native(41, RecordRefRecordType::Evidence),
            role: EvidenceRole::Context,
        },
    ];
    validate_assertion(&row).unwrap();
    row.method = MeasurementMethod::LegacyUserReportedMethodUnspecified;
    row.support = support(
        UncertaintyStatus::Unknown,
        vec![SupportLimitation::MethodUnspecified],
    );
    validate_assertion(&row).unwrap();
    assert_eq!(row.value.entered.token(), "003.1250");
    row.support.corroboration = Corroboration::Corroborated;
    validate_assertion(&row).unwrap();
    assert_eq!(
        row.method,
        MeasurementMethod::LegacyUserReportedMethodUnspecified
    );
}

#[test]
fn photo_fitted_derivation_retains_underlying_uncertainty() {
    let mut row = assertion();
    row.method = MeasurementMethod::Derived;
    row.operation = Some("Generated mesh endpoint distance".into());
    row.support = support(
        UncertaintyStatus::Inferred,
        vec![
            SupportLimitation::PhotoFitted,
            SupportLimitation::InferredMesh,
        ],
    );
    row.inputs = vec![ProvenanceInput {
        pin: InputPin::Model(Box::new(model())),
        methods: vec![MeasurementMethod::PhotoFitted],
        support: row.support.clone(),
    }];
    validate_assertion(&row).unwrap();
    row.support.uncertainties[0].status = UncertaintyStatus::Supported;
    assert!(validate_assertion(&row).is_err()); // Lost the input's inferred component.
    row.support = support(
        UncertaintyStatus::Inferred,
        vec![SupportLimitation::PhotoFitted],
    );
    assert!(validate_assertion(&row).is_err());
}

#[test]
fn imported_and_transitive_assertion_support() {
    let mut source = assertion();
    source.method = MeasurementMethod::Estimated;
    source.support = support(
        UncertaintyStatus::Inferred,
        vec![SupportLimitation::Estimated],
    );
    let mut imported = assertion();
    imported.version.assertion_id = id(21);
    imported.method = MeasurementMethod::Imported;
    imported.operation = Some("Generated source import".into());
    imported.support = source.support.clone();
    imported.inputs = vec![ProvenanceInput {
        pin: InputPin::Assertion(source.version.clone()),
        methods: vec![source.method],
        support: source.support.clone(),
    }];
    validate_history(&[source.clone(), imported.clone()]).unwrap();
    imported.inputs[0].methods = vec![MeasurementMethod::DirectlyMeasured];
    assert!(validate_history(&[source, imported]).is_err());
}

#[test]
fn corrected_revisions_preserve_history_and_reject_retargeting() {
    let old = assertion();
    let mut corrected = old.clone();
    corrected.previous = Some(old.version.clone());
    corrected.version.revision = 2;
    corrected.version.payload_sha256 = sha(9);
    corrected.value = quantity("3.2500", Unit::Metre);
    let rows = vec![old.clone(), corrected.clone()];
    let active = active_assertions(&rows).unwrap();
    assert_eq!(active, vec![&corrected]);
    assert_eq!(rows[0].value.entered.token(), "003.1250");
    corrected.target.feature = SemanticFeature::Wall {
        wall_id: id(99),
        endpoint_ids: [id(14), id(15)],
    };
    assert!(validate_history(&[old.clone(), corrected]).is_err());
    assert!(validate_history(&[old.clone(), old]).is_err());
}

#[test]
fn contradictions_require_review_until_explicit_correction() {
    let old = assertion();
    let mut competing = old.clone();
    competing.version.assertion_id = id(22);
    competing.value = quantity("3.5", Unit::Metre);
    competing.contradicts = vec![old.version.clone()];
    let mut rows = vec![old.clone(), competing.clone()];
    let authority = FakeAuthority::verified();
    let result =
        evaluate_model_update(&competing, &rows, &model(), None, None, &authority).unwrap();
    assert!(matches!(
        result.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
    let mut correction = competing.clone();
    correction.version.assertion_id = id(23);
    correction.contradicts.clear();
    correction.supersedes = vec![old.version.clone(), competing.version.clone()];
    rows.push(correction.clone());
    assert_eq!(active_assertions(&rows).unwrap(), vec![&correction]);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[1].contradicts, vec![old.version]);
    let corrected_but_unreviewed =
        evaluate_model_update(&correction, &rows, &model(), None, None, &authority).unwrap();
    assert!(matches!(
        corrected_but_unreviewed.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
    assert_eq!(authority.calls.get(), 0);
}

#[test]
fn saving_and_equal_values_do_not_clear_model_work() {
    let row = assertion();
    let rows = vec![row.clone()];
    let authority = FakeAuthority::verified();
    let saved = evaluate_model_update(&row, &rows, &model(), None, None, &authority).unwrap();
    assert_eq!(
        saved.state,
        ModelUpdateState::Pending(PendingReason::ModelObservationMissing)
    );
    let observed = observation(&row);
    let matched =
        evaluate_model_update(&row, &rows, &model(), Some(&observed), None, &authority).unwrap();
    assert_eq!(
        matched.state,
        ModelUpdateState::Pending(PendingReason::CorrespondenceMissing)
    );
    let mut different = observed;
    different.value = quantity("3124.9", Unit::Millimetre);
    let mismatch =
        evaluate_model_update(&row, &rows, &model(), Some(&different), None, &authority).unwrap();
    assert_eq!(
        mismatch.state,
        ModelUpdateState::Pending(PendingReason::ActualValueDiffers)
    );
    assert_eq!(authority.calls.get(), 0);
}

#[test]
fn correspondence_requires_exact_revision_artifact_and_authority() {
    let old = assertion();
    let observed = observation(&old);
    let receipt = record(&old, &observed);
    let mut revised = old.clone();
    revised.previous = Some(old.version.clone());
    revised.version.revision = 2;
    revised.version.payload_sha256 = sha(9);
    let rows = vec![old, revised.clone()];
    let authority = FakeAuthority::verified();
    let stale = evaluate_model_update(
        &revised,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        stale.state,
        ModelUpdateState::Pending(PendingReason::CorrespondenceStale)
    );
    let mut new_artifact = model();
    new_artifact.artifact_sha256 = sha(10);
    let stale_artifact = evaluate_model_update(
        &revised,
        &rows,
        &new_artifact,
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        stale_artifact.state,
        ModelUpdateState::Pending(PendingReason::ObservationStale)
    );
    assert_eq!(authority.calls.get(), 0);
    let fresh = record(&revised, &observed);
    let unavailable = FakeAuthority {
        verdict: CorrespondenceVerdict::Unavailable,
        ..FakeAuthority::verified()
    };
    let held = evaluate_model_update(
        &revised,
        &rows,
        &model(),
        Some(&observed),
        Some(&fresh),
        &unavailable,
    )
    .unwrap();
    assert_eq!(
        held.state,
        ModelUpdateState::Pending(PendingReason::VerificationUnavailable)
    );
    let eligible = evaluate_model_update(
        &revised,
        &rows,
        &model(),
        Some(&observed),
        Some(&fresh),
        &authority,
    )
    .unwrap();
    assert!(matches!(
        eligible.state,
        ModelUpdateState::ClosureEligible { .. }
    ));
    assert_eq!(eligible.assertion, revised.version);
    assert_eq!(eligible.model, model());
    assert_eq!(authority.calls.get(), 1);
}

#[test]
fn exact_area_cannot_select_shape_or_bypass_review() {
    let mut row = assertion();
    row.target.feature = SemanticFeature::Room;
    row.property = MeasurementProperty::OccurrenceArea;
    row.value = quantity("12.0000", Unit::SquareMetre);
    let rows = vec![row.clone()];
    let mut observed = observation(&row);
    observed.value = row.value.clone();
    let authority = FakeAuthority::verified();
    let area_only =
        evaluate_model_update(&row, &rows, &model(), Some(&observed), None, &authority).unwrap();
    assert_eq!(
        area_only.state,
        ModelUpdateState::ReviewRequired(ReviewReason::AreaNeedsShapeReview)
    );
    let mut receipt = record(&row, &observed);
    receipt.geometry_review = GeometryReview::Unreviewed;
    let unreviewed = evaluate_model_update(
        &row,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        unreviewed.state,
        ModelUpdateState::ReviewRequired(ReviewReason::AreaNeedsShapeReview)
    );
    row.review = ClaimReview::Inconsistent("Generated constraints disagree".into());
    let review_rows = vec![row.clone()];
    let inconsistent = evaluate_model_update(
        &row,
        &review_rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        inconsistent.state,
        ModelUpdateState::ReviewRequired(ReviewReason::ClaimAmbiguousOrInconsistent)
    );
    assert_eq!(authority.calls.get(), 0);
}

#[test]
fn missing_semantics_and_changed_binding_do_not_retarget() {
    let mut row = assertion();
    row.target.feature = SemanticFeature::Wall {
        wall_id: "synthetic-occurrence/0/1".into(),
        endpoint_ids: [id(14), id(15)],
    };
    assert!(validate_assertion(&row).is_err());
    let row = assertion();
    let rows = vec![row.clone()];
    let mut observed = observation(&row);
    observed.target.occurrence_id = "different-synthetic-occurrence".into();
    let authority = FakeAuthority::verified();
    let unresolved =
        evaluate_model_update(&row, &rows, &model(), Some(&observed), None, &authority).unwrap();
    assert_eq!(
        unresolved.state,
        ModelUpdateState::ReviewRequired(ReviewReason::SemanticTargetUnresolved)
    );
    let mut changed_association = model();
    if let ModelCustody::NativeRecords { association, .. } = &mut changed_association.custody {
        association.revision = 2;
    }
    let stale = evaluate_model_update(
        &row,
        &rows,
        &changed_association,
        Some(&observation(&row)),
        None,
        &authority,
    )
    .unwrap();
    assert_eq!(
        stale.state,
        ModelUpdateState::Pending(PendingReason::ObservationStale)
    );
    assert_eq!(authority.calls.get(), 0);
}

#[test]
fn current_publication_inventory_keeps_unknown_qualification() {
    let provisional = ModelPin {
        scope: scope(),
        building_id: "synthetic-building:west".into(),
        publication_id: id(60),
        artifact_id: "model".into(),
        artifact_sha256: sha(60),
        artifact_bytes: 256,
        lineage: ModelLineage::UnifiedAtlasPublication {
            source_revision_id: "synthetic-owner:revision-01".into(),
            source_sha256: sha(61),
            semantics_sha256: sha(62),
            overview_manifest_sha256: sha(63),
            selection_revision: sha(64),
        },
        custody: ModelCustody::Unknown,
        physical_registration: PhysicalRegistration::Unknown,
    };
    validate_model_pin(&provisional).unwrap(); // No invented source/map/asset UUID or native receipt.
    let mut row = assertion();
    row.entered_against = provisional.clone();
    row.target.namespace = SemanticNamespace::ProducerPublication {
        publication_id: id(60),
    };
    row.target.building_id = provisional.building_id.clone();
    row.target.floor_id = "synthetic-level:02".into();
    row.target.occurrence_id = "synthetic-space:west-02".into();
    row.target.feature = SemanticFeature::Room;
    row.property = MeasurementProperty::OccurrenceArea;
    row.value = quantity("12.0000", Unit::SquareMetre);
    validate_assertion(&row).unwrap();
    let mut observed = observation(&row);
    observed.value = row.value.clone();
    let receipt = record(&row, &observed);
    let authority = FakeAuthority::verified();
    let held = evaluate_model_update(
        &row,
        &[row.clone()],
        &provisional,
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        held.state,
        ModelUpdateState::Pending(PendingReason::NativeCustodyUnknown)
    );
    // Qualifying custody alone still cannot promote unknown physical registration.
    let mut custody_only = provisional.clone();
    custody_only.custody = model().custody;
    observed.model = custody_only.clone();
    let receipt = record(&row, &observed);
    let held = evaluate_model_update(
        &row,
        &[row.clone()],
        &custody_only,
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        held.state,
        ModelUpdateState::Pending(PendingReason::PhysicalRegistrationUnknown)
    );
    assert_eq!(authority.calls.get(), 0);
    assert_eq!(provisional.custody, ModelCustody::Unknown);
    assert_eq!(
        provisional.physical_registration,
        PhysicalRegistration::Unknown
    );
    let mut invalid = provisional;
    if let ModelLineage::UnifiedAtlasPublication {
        source_revision_id, ..
    } = &mut invalid.lineage
    {
        *source_revision_id = "x".repeat(129);
    }
    assert!(validate_model_pin(&invalid).is_err());
}

#[test]
fn corroborated_photo_fit_retains_method_and_limits() {
    let mut fitted = assertion();
    fitted.method = MeasurementMethod::PhotoFitted;
    fitted.support = support(
        UncertaintyStatus::Supported,
        vec![SupportLimitation::PhotoFitted],
    );
    fitted.support.corroboration = Corroboration::Corroborated;
    fitted.evidence.push(EvidenceLink {
        evidence: native(70, RecordRefRecordType::Evidence),
        role: EvidenceRole::Supports,
    });
    validate_assertion(&fitted).unwrap();
    let mut derived = assertion();
    derived.version.assertion_id = id(71);
    derived.method = MeasurementMethod::Derived;
    derived.operation = Some("Generated distance from corroborated photo fit".into());
    derived.support = fitted.support.clone();
    derived.inputs.push(ProvenanceInput {
        pin: InputPin::Assertion(fitted.version.clone()),
        methods: vec![MeasurementMethod::PhotoFitted],
        support: fitted.support.clone(),
    });
    validate_history(&[fitted.clone(), derived.clone()]).unwrap();
    assert_eq!(fitted.method, MeasurementMethod::PhotoFitted);
    assert_eq!(derived.method, MeasurementMethod::Derived);
    assert!(
        derived
            .support
            .limitations
            .contains(&SupportLimitation::PhotoFitted)
    );
    derived.support.limitations.clear();
    assert!(validate_history(&[fitted, derived]).is_err());
}

#[test]
fn mixed_inherited_uncertainty_preserves_components_without_order() {
    let mut estimated = assertion();
    estimated.method = MeasurementMethod::Estimated;
    estimated.support = support(
        UncertaintyStatus::Inferred,
        vec![SupportLimitation::Estimated],
    );
    let mut legacy = assertion();
    legacy.version.assertion_id = id(72);
    legacy.method = MeasurementMethod::LegacyUserReportedMethodUnspecified;
    legacy.support = support(
        UncertaintyStatus::Unknown,
        vec![SupportLimitation::MethodUnspecified],
    );
    // Retain native evidence-state snapshots without treating them as assertion retirement.
    legacy.support.uncertainties.extend([
        Uncertainty {
            status: UncertaintyStatus::Withdrawn,
            explanation: Some("Generated withdrawn source note".into()),
        },
        Uncertainty {
            status: UncertaintyStatus::Superseded,
            explanation: Some("Generated superseded source note".into()),
        },
    ]);
    let mut derived = assertion();
    derived.version.assertion_id = id(73);
    derived.method = MeasurementMethod::Derived;
    derived.operation = Some("Generated multi-input transformation".into());
    derived.support = estimated.support.clone();
    derived.support.corroboration = Corroboration::Corroborated;
    derived
        .support
        .uncertainties
        .extend(legacy.support.uncertainties.clone());
    derived
        .support
        .limitations
        .extend(legacy.support.limitations.clone());
    derived.inputs = vec![
        ProvenanceInput {
            pin: InputPin::Assertion(estimated.version.clone()),
            methods: vec![estimated.method],
            support: estimated.support.clone(),
        },
        ProvenanceInput {
            pin: InputPin::Assertion(legacy.version.clone()),
            methods: vec![legacy.method],
            support: legacy.support.clone(),
        },
    ];
    derived.support.uncertainties.reverse();
    let rows = vec![estimated.clone(), legacy.clone(), derived.clone()];
    validate_history(&rows).unwrap();
    assert_eq!(active_assertions(&rows).unwrap().len(), 3);
    derived
        .support
        .uncertainties
        .retain(|component| component.status != UncertaintyStatus::Unknown);
    assert!(validate_history(&[estimated, legacy, derived]).is_err());
}

#[test]
fn unresolved_contradiction_follows_revisions_until_reviewed_resolution() {
    let mut b1 = assertion();
    b1.value = quantity("3.0", Unit::Metre);
    let mut a1 = assertion();
    a1.version.assertion_id = id(80);
    a1.contradicts = vec![b1.version.clone()];
    let conflict = ContradictionRef::Assertions {
        raised_by: a1.version.clone(),
        against: b1.version.clone(),
    };
    let mut b2 = b1.clone();
    b2.previous = Some(b1.version.clone());
    b2.version.revision = 2;
    b2.version.payload_sha256 = sha(81);
    b2.value = a1.value.clone(); // Equal-valued successor must not erase the dispute.
    let mut rows = vec![b1, a1.clone(), b2.clone()];
    let authority = FakeAuthority::verified();
    let observed = observation(&a1);
    let receipt = record(&a1, &observed);
    let held = evaluate_model_update(
        &a1,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert_eq!(
        held.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(vec![
            conflict.clone()
        ]))
    );
    let mut a2 = a1.clone();
    a2.previous = Some(a1.version.clone());
    a2.version.revision = 2;
    a2.version.payload_sha256 = sha(82);
    a2.contradicts.clear(); // Removing the source link also does not resolve it.
    rows.push(a2.clone());
    let observed = observation(&a2);
    let receipt = record(&a2, &observed);
    let held = evaluate_model_update(
        &a2,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert!(matches!(
        held.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
    assert_eq!(authority.calls.get(), 0);
    let mut b3 = b2.clone();
    b3.previous = Some(b2.version.clone());
    b3.version.revision = 3;
    b3.version.payload_sha256 = sha(83);
    b3.resolutions.push(ReviewedContradictionResolution {
        contradiction: conflict.clone(),
        reviewed_heads: vec![
            ReviewedHead::Existing(a2.version.clone()),
            ReviewedHead::ThisRevision,
        ],
        reason: "Generated explicit constraint reconciliation".into(),
        review_evidence: native(84, RecordRefRecordType::Evidence),
        native_audit_id: id(85),
    });
    rows.push(b3.clone());
    validate_history(&rows).unwrap();
    let unqualified = evaluate_model_update(
        &a2,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &authority,
    )
    .unwrap();
    assert!(matches!(
        unqualified.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
    assert_eq!(authority.calls.get(), 0);
    let mut trusted_review = FakeAuthority::verified();
    trusted_review.resolution_verdict = CorrespondenceVerdict::Verified;
    let reviewed = evaluate_model_update(
        &a2,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &trusted_review,
    )
    .unwrap();
    match reviewed.state {
        ModelUpdateState::ClosureEligible {
            resolution_evidence,
            ..
        } => {
            assert_eq!(
                resolution_evidence,
                vec![native(84, RecordRefRecordType::Evidence)]
            );
        }
        _ => panic!("generated reviewed resolution did not reach closure assessment"),
    }
    assert_eq!(
        trusted_review.support_requests.borrow()[0].reviewed_dispositions,
        vec![(b3.version.clone(), b3.resolutions[0].clone())]
    );
    assert_eq!(
        *trusted_review.support_requests.borrow(),
        *trusted_review.correspondence_requests.borrow()
    );
    let mut b4 = b3.clone();
    b4.previous = Some(b3.version.clone());
    b4.version.revision = 4;
    b4.version.payload_sha256 = sha(86);
    b4.resolutions.clear();
    rows.push(b4);
    let stale_review = evaluate_model_update(
        &a2,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &trusted_review,
    )
    .unwrap();
    assert!(matches!(
        stale_review.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
    assert_eq!(trusted_review.calls.get(), 1);
    assert_eq!(trusted_review.resolution_calls.get(), 1);

    // Native contradicting evidence is also retained across a revision removing its link.
    let mut old = assertion();
    old.evidence.push(EvidenceLink {
        evidence: native(87, RecordRefRecordType::Evidence),
        role: EvidenceRole::Contradicts,
    });
    let mut successor = old.clone();
    successor.previous = Some(old.version.clone());
    successor.version.revision = 2;
    successor.version.payload_sha256 = sha(88);
    successor.evidence.clear();
    let held = evaluate_model_update(
        &successor,
        &[old, successor.clone()],
        &model(),
        None,
        None,
        &authority,
    )
    .unwrap();
    assert!(matches!(
        held.state,
        ModelUpdateState::ReviewRequired(ReviewReason::UnresolvedContradictions(_))
    ));
}

#[test]
fn disputed_support_qualification_blocks_eligibility() {
    let mut row = assertion();
    row.method = MeasurementMethod::Derived;
    row.operation = Some("Generated disputed input qualification".into());
    row.support = support(
        UncertaintyStatus::Disputed,
        vec![SupportLimitation::PhotoFitted],
    );
    row.support.uncertainties.push(Uncertainty {
        status: UncertaintyStatus::Unknown,
        explanation: Some("Generated independent retained uncertainty".into()),
    });
    row.inputs.push(ProvenanceInput {
        pin: InputPin::Model(Box::new(model())),
        methods: vec![MeasurementMethod::PhotoFitted],
        support: row.support.clone(),
    });
    let mut evidence = native(90, RecordRefRecordType::Evidence);
    evidence.revision = 7;
    evidence.payload_sha256 = sha(90);
    row.evidence.push(EvidenceLink {
        evidence,
        role: EvidenceRole::Supports,
    });
    let rows = vec![row.clone()];
    let observed = observation(&row);
    let receipt = record(&row, &observed);
    for (verdict, expected) in [
        (
            SupportQualificationVerdict::UnresolvedDispute,
            ModelUpdateState::ReviewRequired(ReviewReason::SupportDisputeUnresolved),
        ),
        (
            SupportQualificationVerdict::Refused,
            ModelUpdateState::Pending(PendingReason::SupportQualificationRefused),
        ),
        (
            SupportQualificationVerdict::Unavailable,
            ModelUpdateState::Pending(PendingReason::SupportQualificationUnavailable),
        ),
    ] {
        // Geometry correspondence would succeed in this fake, but support has
        // not qualified. A retained Disputed component is not silently ignored.
        let authority = FakeAuthority {
            support_verdict: verdict,
            ..FakeAuthority::verified()
        };
        let result = evaluate_model_update(
            &row,
            &rows,
            &model(),
            Some(&observed),
            Some(&receipt),
            &authority,
        )
        .unwrap();
        assert_eq!(result.state, expected);
        assert_eq!(authority.calls.get(), 0);
        let requests = authority.support_requests.borrow();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].assertion, row.version);
        assert_eq!(requests[0].retained_support, row.support);
        assert_eq!(requests[0].inherited_inputs, row.inputs);
        assert_eq!(requests[0].evidence_roles_and_revisions, row.evidence);
        assert_eq!(requests[0].history_versions, vec![row.version.clone()]);
    }
    // An adapter implementing only geometry verification remains fail-closed
    // through the authority trait's default unavailable support qualification.
    struct GeometryOnlyAuthority {
        calls: Cell<usize>,
    }
    impl ModelCorrespondenceAuthority for GeometryOnlyAuthority {
        fn verify(
            &self,
            _: &MeasurementAssertion,
            _: &ModelObservation,
            _: &CorrespondenceRecord,
            _: &SupportQualificationRequest<'_>,
        ) -> CorrespondenceVerdict {
            self.calls.set(self.calls.get() + 1);
            CorrespondenceVerdict::Verified
        }
    }
    let geometry_only = GeometryOnlyAuthority {
        calls: Cell::new(0),
    };
    let unavailable = evaluate_model_update(
        &row,
        &rows,
        &model(),
        Some(&observed),
        Some(&receipt),
        &geometry_only,
    )
    .unwrap();
    assert_eq!(
        unavailable.state,
        ModelUpdateState::Pending(PendingReason::SupportQualificationUnavailable)
    );
    assert_eq!(geometry_only.calls.get(), 0);
}

#[test]
fn withdrawn_superseded_evidence_qualification_preserves_context() {
    for status in [UncertaintyStatus::Withdrawn, UncertaintyStatus::Superseded] {
        let mut row = assertion();
        row.support.uncertainties.push(Uncertainty {
            status,
            explanation: Some("Generated historical evidence-state component".into()),
        });
        row.evidence.push(EvidenceLink {
            evidence: native(91, RecordRefRecordType::Evidence),
            role: EvidenceRole::Supports,
        });
        let mut historical = native(92, RecordRefRecordType::Evidence);
        historical.revision = 9;
        historical.payload_sha256 = sha(92);
        row.evidence.push(EvidenceLink {
            evidence: historical,
            role: EvidenceRole::Context,
        });
        let observed = observation(&row);
        let receipt = record(&row, &observed);
        let rows = vec![row.clone()];
        // This fake models a native review establishing independent valid support
        // while retaining the old component solely as historical context.
        let qualified = FakeAuthority::verified();
        let result = evaluate_model_update(
            &row,
            &rows,
            &model(),
            Some(&observed),
            Some(&receipt),
            &qualified,
        )
        .unwrap();
        assert!(matches!(
            result.state,
            ModelUpdateState::ClosureEligible { .. }
        ));
        assert_eq!(active_assertions(&rows).unwrap(), vec![&row]);
        assert_eq!(
            qualified.support_requests.borrow()[0].retained_support,
            row.support
        );
        assert_eq!(
            qualified.support_requests.borrow()[0].evidence_roles_and_revisions,
            row.evidence
        );
        assert_eq!(
            *qualified.support_requests.borrow(),
            *qualified.correspondence_requests.borrow()
        );
        assert_eq!(row.evidence[1].role, EvidenceRole::Context);
        assert_eq!(row.evidence[1].evidence.revision, 9);
        for (verdict, expected) in [
            (
                CorrespondenceVerdict::NotVerified,
                PendingReason::CorrespondenceNotVerified,
            ),
            (
                CorrespondenceVerdict::Unavailable,
                PendingReason::VerificationUnavailable,
            ),
        ] {
            let authority = FakeAuthority {
                verdict,
                ..FakeAuthority::verified()
            };
            let result = evaluate_model_update(
                &row,
                &rows,
                &model(),
                Some(&observed),
                Some(&receipt),
                &authority,
            )
            .unwrap();
            assert_eq!(result.state, ModelUpdateState::Pending(expected));
            assert_eq!(authority.calls.get(), 1);
            assert_eq!(
                *authority.support_requests.borrow(),
                *authority.correspondence_requests.borrow()
            );
        }

        for role in [EvidenceRole::Context, EvidenceRole::Supports] {
            let mut claimed = row.clone();
            claimed.evidence[1].role = role;
            let history = vec![claimed.clone()];
            let observed = observation(&claimed);
            let receipt = record(&claimed, &observed);
            for (verdict, expected) in [
                (
                    SupportQualificationVerdict::Refused,
                    PendingReason::SupportQualificationRefused,
                ),
                (
                    SupportQualificationVerdict::Unavailable,
                    PendingReason::SupportQualificationUnavailable,
                ),
            ] {
                let authority = FakeAuthority {
                    support_verdict: verdict,
                    ..FakeAuthority::verified()
                };
                let result = evaluate_model_update(
                    &claimed,
                    &history,
                    &model(),
                    Some(&observed),
                    Some(&receipt),
                    &authority,
                )
                .unwrap();
                assert_eq!(result.state, ModelUpdateState::Pending(expected));
                assert_eq!(authority.calls.get(), 0);
                assert_eq!(
                    authority.support_requests.borrow()[0].evidence_roles_and_revisions,
                    claimed.evidence
                );
                assert_eq!(active_assertions(&history).unwrap(), vec![&claimed]);
            }
        }
    }
}
