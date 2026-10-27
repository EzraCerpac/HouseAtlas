//! Pure online proposal, immutable result and history contracts.
//! Store/access/HTTP owners enforce transactional authority; these types alone
//! issue no grant, native verification or geometry closure.
use super::*;
use crate::contracts::{
    semantics,
    v2::{self, RecordRef, RecordRefRecordType, Scope},
};
use serde_json::{Value, json};

pub const PROPOSAL_DOMAIN: &str = "houseatlas.measurement-assertions.online-proposal/1";
const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_LINKS: usize = 64;

/// Comparison preconditions only: no native custody, physical registration,
/// node/mesh ordinals, actor, time, allocated identity or persisted revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetExpectation {
    pub building_id: String,
    pub room_id: String,
    pub level_id: String,
    pub occurrence_id: String,
    pub publication_id: String,
    pub source_revision_id: String,
    pub source_sha256: String,
    pub semantics_sha256: String,
    pub overview_manifest_sha256: String,
    pub selection_revision: String,
    pub artifact_sha256: String,
    pub artifact_bytes: u64,
    pub target_feature_sha256: String,
    /// If known, source-owned semantic object IDs, never topology ordinals.
    /// An empty list claims no object export; occurrence semantics still apply.
    pub source_object_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NativeExpectation {
    pub record: RecordRef,
    pub expected_revision: u64,
    pub expected_payload_sha256: String,
}
#[derive(Debug, Clone, PartialEq)]
pub struct EvidenceProposal {
    pub reference: NativeExpectation,
    pub role: EvidenceRole,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AssertionExpectation {
    pub assertion_id: String,
    pub expected_revision: u64,
    pub expected_payload_sha256: String,
}
impl AssertionExpectation {
    fn pin(&self) -> AssertionVersion {
        AssertionVersion {
            assertion_id: self.assertion_id.clone(),
            revision: self.expected_revision,
            payload_sha256: self.expected_payload_sha256.clone(),
        }
    }
}
#[derive(Debug, Clone, PartialEq)]
pub enum InputExpectation {
    SelectedModel,
    Native(NativeExpectation),
    Assertion(AssertionExpectation),
}
#[derive(Debug, Clone, PartialEq)]
pub enum PersonalMeasurementAttestation {
    PersonallyMeasured,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AreaProposal {
    pub decimal_token: String,
    pub unit: Unit,
    pub quantity_kind: QuantityKind,
    pub method: MeasurementMethod,
    /// Explicit new user action; absent for every previously supported origin.
    pub attestation: Option<PersonalMeasurementAttestation>,
    pub evidence: Vec<EvidenceProposal>,
    pub inputs: Vec<InputExpectation>,
    pub operation: Option<String>,
    pub contradicts: Vec<AssertionExpectation>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OnlineOperation {
    /// No caller assertion ID. Allocate only after authorized receipt miss,
    /// target admission and preconditions inside the eventual transaction.
    Create,
    Correct {
        assertion_id: String,
        expected_revision: u64,
        expected_payload_sha256: String,
    },
}
#[derive(Debug, Clone, PartialEq)]
pub struct OnlineProposal {
    pub scope: Scope,
    pub mutation_id: String,
    pub operation: OnlineOperation,
    pub target: TargetExpectation,
    pub area: AreaProposal,
    pub reason: String,
}

/// Server-captured documentary facts; these Rust values confer no authority.
/// A native adapter must establish current identity, accepted room semantics,
/// reviewed occurrence mapping and original-grant continuity independently.
#[derive(Debug, Clone, PartialEq)]
pub enum TargetAdmission {
    Unresolved,
    ReviewRequired,
    Resolved {
        room_identity: NativeRevision,
        room_semantics: NativeRevision,
        mapping_review: Box<NativeRevision>,
        source_object_ids: Vec<String>,
    },
}
#[derive(Debug, Clone, PartialEq)]
pub enum AcquisitionFacts {
    Unqualified,
    ImageInformedEstimate,
    DirectMeasurement {
        review: NativeRevision,
    },
    PhotoFit {
        review: NativeRevision,
    },
    UserReportedMeasurement {
        attestation: PersonalMeasurementAttestation,
        actor_id: String,
        recorded_at: String,
    },
}
#[derive(Debug, Clone, PartialEq)]
pub struct AuditAnchor {
    pub audit_id: String,
    pub actor_id: String,
    pub mutation_id: String,
    pub server_recorded_at: String,
    pub previous_revision: Option<u64>,
    pub result_revision: u64,
}
#[derive(Debug, Clone, PartialEq)]
pub struct ReceiptKey {
    pub scope: Scope,
    pub actor_id: String,
    pub mutation_id: String,
}
/// Immutable COMMIT-TIME work snapshot. It is not a current conflict projection.
/// No closed, verified, completed or closure-eligible variant exists.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingWork {
    pub assertion: AssertionVersion,
    pub model: ModelPin,
    pub target_feature_sha256: String,
    pub unresolved_conflicts: Vec<ContradictionRef>,
}
/// Separate from proposals. All envelope fields come from native commit facts.
/// Body/digest authenticity, audited-create completeness and transaction custody
/// cannot be proved by constructing or validating this documentary carrier.
#[derive(Debug, Clone, PartialEq)]
pub struct CommittedVersion {
    pub assertion: MeasurementAssertion,
    pub proposal: OnlineProposal,
    pub proposal_sha256: String,
    pub receipt_key: ReceiptKey,
    pub audit: AuditAnchor,
    pub target_admission: TargetAdmission,
    pub acquisition: AcquisitionFacts,
    pub pending: PendingWork,
}
#[derive(Debug, Clone, PartialEq)]
pub struct FullHistory {
    pub scope: Scope,
    pub assertion_id: String,
    /// Exact head captured from the actual current record in the same read cut.
    pub expected_current_head: AssertionVersion,
    pub read_point: ReadPoint,
    /// Complete ordered create-through-head stream, never an audit-only array.
    pub versions: Vec<CommittedVersion>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Current {
    /// The original immutable outcome, including its commit-time pending work.
    pub head: CommittedVersion,
    pub read_point: ReadPoint,
    pub current_conflicts: CurrentConflictProjection,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadPoint {
    /// Opaque server-owned observation marker, not a client timestamp/grant.
    pub marker: String,
}
/// Documentary input from the native read owner, not a proof minted by this
/// enum. The native owner must establish complete authorized enumeration at
/// this SAME read point. A history page, dependency-only subset, old closure or
/// unknown source cannot be labeled complete. Unavailable input is refused.
pub enum CurrentClosure<'a> {
    CompleteAtReadPoint {
        read_point: ReadPoint,
        assertions: &'a [MeasurementAssertion],
    },
    Unavailable,
}
#[derive(Debug, Clone, PartialEq)]
pub struct CurrentConflict {
    pub contradiction: ContradictionRef,
    /// All exact active successor heads affected at this current read point.
    pub affected_heads: Vec<AssertionVersion>,
}
/// Separate from all immutable receipts and work obligations. Later claims can
/// change this projection without revising the selected assertion's head.
/// Documentary resolution records alone cannot remove a conflict here.
#[derive(Debug, Clone, PartialEq)]
pub struct CurrentConflictProjection {
    pub assertion: AssertionVersion,
    pub read_point: ReadPoint,
    pub conflicts: Vec<CurrentConflict>,
}
pub enum MutationOutcome<'a> {
    Committed(&'a CommittedVersion),
    /// No receipt visible at this read point; not proof of nonexecution,
    /// definite failure, cleanup authority or absence of an in-flight writer.
    NotRecordedAtReadPoint(ReadPoint),
}
pub enum RetryDecision<'a> {
    Retained(&'a CommittedVersion),
    NeedsAdmissionBeforeAllocation,
}

fn need(ok: bool, why: &'static str) -> ValidationResult<()> {
    if ok {
        Ok(())
    } else {
        Err(ValidationError(why))
    }
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|id| id.to_string() == s)
}
fn hash(s: &str) -> bool {
    super::validation::digest(s)
}
fn revision(n: u64) -> bool {
    (1..=MAX_REVISION).contains(&n)
}
fn text(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control)
}
fn opaque(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
}
fn object_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:$".contains(&c))
}
fn native(pin: &NativeRevision, kind: RecordRefRecordType) -> bool {
    pin.record.record_type == kind
        && v2::validate(&pin.record).is_ok()
        && revision(pin.revision)
        && hash(&pin.payload_sha256)
}
fn expectation(pin: &NativeExpectation) -> ValidationResult<()> {
    need(
        v2::validate(&pin.record).is_ok()
            && revision(pin.expected_revision)
            && hash(&pin.expected_payload_sha256),
        "invalid native comparison precondition",
    )
}
fn native_matches(expected: &NativeExpectation, actual: &NativeRevision) -> bool {
    expected.record == actual.record
        && expected.expected_revision == actual.revision
        && expected.expected_payload_sha256 == actual.payload_sha256
}
fn assertion_pin(pin: &AssertionVersion) -> bool {
    uuid(&pin.assertion_id) && revision(pin.revision) && hash(&pin.payload_sha256)
}
fn conflict_pin(pin: &ContradictionRef) -> bool {
    match pin {
        ContradictionRef::Assertions { raised_by, against } => {
            assertion_pin(raised_by) && assertion_pin(against)
        }
        ContradictionRef::Evidence {
            raised_by,
            evidence,
        } => assertion_pin(raised_by) && native(evidence, RecordRefRecordType::Evidence),
    }
}

pub fn validate_proposal(p: &OnlineProposal) -> ValidationResult<()> {
    need(
        v2::validate(&p.scope).is_ok() && uuid(&p.mutation_id) && text(&p.reason),
        "invalid proposal scope, mutation or reason",
    )?;
    if let OnlineOperation::Correct {
        assertion_id,
        expected_revision,
        expected_payload_sha256,
    } = &p.operation
    {
        need(
            uuid(assertion_id)
                && revision(*expected_revision)
                && *expected_revision < MAX_REVISION
                && hash(expected_payload_sha256),
            "invalid correction precondition",
        )?;
    }
    let t = &p.target;
    need(
        [
            &t.building_id,
            &t.room_id,
            &t.level_id,
            &t.occurrence_id,
            &t.source_revision_id,
        ]
        .iter()
        .all(|s| opaque(s))
            && uuid(&t.publication_id)
            && t.artifact_bytes > 0
            && t.artifact_bytes <= MAX_REVISION
            && [
                &t.source_sha256,
                &t.semantics_sha256,
                &t.overview_manifest_sha256,
                &t.selection_revision,
                &t.artifact_sha256,
                &t.target_feature_sha256,
            ]
            .iter()
            .all(|s| hash(s)),
        "invalid publication or semantic comparison preconditions",
    )?;
    need(
        t.source_object_ids.len() <= MAX_LINKS
            && t.source_object_ids.iter().all(|s| object_id(s))
            && t.source_object_ids
                .iter()
                .enumerate()
                .all(|(i, s)| !t.source_object_ids[..i].contains(s)),
        "invalid source object keys",
    )?;
    let a = &p.area;
    ExactQuantity {
        entered: DecimalToken::parse(&a.decimal_token)?,
        unit: a.unit,
        kind: a.quantity_kind,
    }
    .validate()?;
    need(
        a.quantity_kind == QuantityKind::Area
            && a.method != MeasurementMethod::LegacyUserReportedMethodUnspecified,
        "online slice requires area and a specified new acquisition method",
    )?;
    need(
        (a.method == MeasurementMethod::UserReportedMeasured)
            == (a.attestation == Some(PersonalMeasurementAttestation::PersonallyMeasured)),
        "personal measurement requires an explicit attestation and no other method accepts one",
    )?;
    need(
        a.evidence.len() <= MAX_LINKS
            && a.inputs.len() <= MAX_LINKS
            && a.contradicts.len() <= MAX_LINKS,
        "proposal link bound exceeded",
    )?;
    for (i, e) in a.evidence.iter().enumerate() {
        expectation(&e.reference)?;
        need(
            e.reference.record.record_type == RecordRefRecordType::Evidence
                && !a.evidence[..i]
                    .iter()
                    .any(|old| old.reference.record == e.reference.record),
            "invalid or duplicate evidence proposal",
        )?;
    }
    for (i, input) in a.inputs.iter().enumerate() {
        need(!a.inputs[..i].contains(input), "duplicate input comparison")?;
        match input {
            InputExpectation::SelectedModel => {}
            InputExpectation::Native(e) => {
                expectation(e)?;
                need(
                    matches!(
                        e.record.record_type,
                        RecordRefRecordType::Evidence
                            | RecordRefRecordType::Asset
                            | RecordRefRecordType::GeodataDocument
                    ),
                    "unsupported native input kind",
                )?;
            }
            InputExpectation::Assertion(e) => {
                need(assertion_pin(&e.pin()), "invalid assertion comparison")?;
            }
        }
    }
    for (i, pin) in a.contradicts.iter().enumerate() {
        need(
            assertion_pin(&pin.pin()) && !a.contradicts[..i].contains(pin),
            "invalid contradiction comparison",
        )?;
    }
    let transformed = matches!(
        a.method,
        MeasurementMethod::Derived | MeasurementMethod::Imported
    );
    need(
        if transformed {
            !a.inputs.is_empty() && a.operation.as_ref().is_some_and(|s| text(s))
        } else {
            a.inputs.is_empty() && a.operation.is_none()
        },
        "transformation requires explicit pinned inputs and operation",
    )
}

fn method(m: MeasurementMethod) -> &'static str {
    match m {
        MeasurementMethod::Guessed => "guessed",
        MeasurementMethod::Estimated => "estimated",
        MeasurementMethod::UserReportedMeasured => "user-reported-measured",
        MeasurementMethod::DirectlyMeasured => "directly-measured",
        MeasurementMethod::PhotoFitted => "photo-fitted",
        MeasurementMethod::Derived => "derived",
        MeasurementMethod::Imported => "imported",
        MeasurementMethod::LegacyUserReportedMethodUnspecified => {
            "legacy-user-reported-method-unspecified"
        }
    }
}
fn unit(u: Unit) -> &'static str {
    match u {
        Unit::Millimetre => "mm",
        Unit::Centimetre => "cm",
        Unit::Metre => "m",
        Unit::SquareMillimetre => "mm2",
        Unit::SquareCentimetre => "cm2",
        Unit::SquareMetre => "m2",
    }
}
fn native_json(e: &NativeExpectation) -> Value {
    json!({"record": e.record, "expectedRevision": e.expected_revision, "expectedPayloadSha256": e.expected_payload_sha256})
}
/// Explicit complete projection; no Debug serialization or caller digest field.
/// Arrays are ordered and significant. Null operation remains explicit. All
/// integers are safe-range; exact decimal entry remains a JSON STRING.
pub fn canonical_proposal(p: &OnlineProposal) -> ValidationResult<String> {
    validate_proposal(p)?;
    let op = match &p.operation {
        OnlineOperation::Create => json!({"kind":"create"}),
        OnlineOperation::Correct {
            assertion_id,
            expected_revision,
            expected_payload_sha256,
        } => {
            json!({"kind":"correct","assertionId":assertion_id,"expectedRevision":expected_revision,"expectedPayloadSha256":expected_payload_sha256})
        }
    };
    let t = &p.target;
    let evidence: Vec<_> = p.area.evidence.iter().map(|e| json!({"reference":native_json(&e.reference),"role":match e.role {
        EvidenceRole::Supports=>"supports", EvidenceRole::Contradicts=>"contradicts", EvidenceRole::Context=>"context" }})).collect();
    let inputs: Vec<_> = p.area.inputs.iter().map(|e| match e {
        InputExpectation::SelectedModel => json!({"kind":"selected-model"}),
        InputExpectation::Native(e) => json!({"kind":"native","reference":native_json(e)}),
        InputExpectation::Assertion(e) =>
            json!({"kind":"assertion","assertionId":e.assertion_id,"expectedRevision":e.expected_revision,"expectedPayloadSha256":e.expected_payload_sha256}),
    }).collect();
    let contradicts: Vec<_> = p.area.contradicts.iter().map(|e| json!({"assertionId":e.assertion_id,"expectedRevision":e.expected_revision,"expectedPayloadSha256":e.expected_payload_sha256})).collect();
    let mut projection = json!({"domain":PROPOSAL_DOMAIN,"scope":p.scope,"mutationId":p.mutation_id,"operation":op,
        "target":{"buildingId":t.building_id,"roomId":t.room_id,"levelId":t.level_id,"occurrenceId":t.occurrence_id,
            "publicationId":t.publication_id,"sourceRevisionId":t.source_revision_id,"sourceSha256":t.source_sha256,
            "semanticsSha256":t.semantics_sha256,"overviewManifestSha256":t.overview_manifest_sha256,
            "selectionRevision":t.selection_revision,"artifactId":"model","artifactSha256":t.artifact_sha256,
            "artifactBytes":t.artifact_bytes,"targetFeatureSha256":t.target_feature_sha256,"sourceObjectIds":t.source_object_ids},
        "property":"occurrence-area","area":{"decimalToken":p.area.decimal_token,"unit":unit(p.area.unit),"quantityKind":"area",
            "method":method(p.area.method),"evidence":evidence,"inputs":inputs,"operation":p.area.operation,"contradicts":contradicts},"reason":p.reason});
    if p.area.attestation.is_some() {
        projection["area"]["attestation"] = json!({"kind":"personally-measured"});
    }
    semantics::canonical_json(&projection)
        .map_err(|_| ValidationError("canonical proposal unavailable"))
}
pub fn proposal_digest(p: &OnlineProposal) -> ValidationResult<String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_proposal(p)?.as_bytes())
    ))
}

/// Preparation helper only: call BEFORE freezing/hashing a request. The wire
/// reason remains required and the server never supplies a post-hash default.
pub fn personal_measurement_reason(
    operation: &OnlineOperation,
    note: Option<&str>,
) -> ValidationResult<String> {
    if let Some(note) = note.filter(|s| !s.is_empty()) {
        need(text(note), "invalid optional personal measurement note")?;
        return Ok(note.into());
    }
    Ok(match operation {
        OnlineOperation::Create => "Record user-reported measurement",
        OnlineOperation::Correct { .. } => "Correct user-reported measurement",
    }
    .into())
}

fn target_matches(p: &OnlineProposal, a: &MeasurementAssertion) -> bool {
    let t = &p.target;
    let m = &a.entered_against;
    a.target.scope == p.scope
        && a.target.building_id == t.building_id
        && a.target.room_id == t.room_id
        && a.target.floor_id == t.level_id
        && a.target.occurrence_id == t.occurrence_id
        && a.target.feature == SemanticFeature::Room
        && a.target.namespace
            == (SemanticNamespace::ProducerPublication {
                publication_id: t.publication_id.clone(),
            })
        && m.publication_id == t.publication_id
        && m.artifact_id == "model"
        && m.artifact_sha256 == t.artifact_sha256
        && m.artifact_bytes == t.artifact_bytes
        && a.target_feature_sha256 == t.target_feature_sha256
        && matches!(&m.lineage, ModelLineage::UnifiedAtlasPublication { source_revision_id, source_sha256,
            semantics_sha256, overview_manifest_sha256, selection_revision }
            if source_revision_id == &t.source_revision_id && source_sha256 == &t.source_sha256
                && semantics_sha256 == &t.semantics_sha256 && overview_manifest_sha256 == &t.overview_manifest_sha256
                && selection_revision == &t.selection_revision)
}

pub fn validate_committed(v: &CommittedVersion) -> ValidationResult<()> {
    validate_proposal(&v.proposal)?;
    validate_assertion(&v.assertion)?;
    let a = &v.assertion;
    let p = &v.proposal;
    need(
        v.proposal_sha256 == proposal_digest(p)? && target_matches(p, a),
        "retained proposal or resolved target mismatch",
    )?;
    need(
        a.property == MeasurementProperty::OccurrenceArea
            && a.value.entered.token() == p.area.decimal_token
            && a.value.unit == p.area.unit
            && a.value.kind == p.area.quantity_kind
            && a.method == p.area.method
            && a.operation == p.area.operation
            && a.contradicts
                == p.area
                    .contradicts
                    .iter()
                    .map(AssertionExpectation::pin)
                    .collect::<Vec<_>>()
            && a.change_reason == p.reason
            && a.supersedes.is_empty()
            && a.resolutions.is_empty(),
        "result differs from proposal or exceeds online scope",
    )?;
    match &p.operation {
        OnlineOperation::Create => need(
            a.previous.is_none() && a.version.revision == 1,
            "new streams require audited create",
        )?,
        OnlineOperation::Correct {
            assertion_id,
            expected_revision,
            expected_payload_sha256,
        } => {
            need(
                a.version.assertion_id == *assertion_id
                    && a.version.revision == expected_revision + 1
                    && a.previous.as_ref()
                        == Some(&AssertionVersion {
                            assertion_id: assertion_id.clone(),
                            revision: *expected_revision,
                            payload_sha256: expected_payload_sha256.clone(),
                        }),
                "correction lost exact predecessor",
            )?;
        }
    }
    need(
        v.receipt_key.scope == p.scope
            && v.receipt_key.mutation_id == p.mutation_id
            && uuid(&v.receipt_key.actor_id)
            && v.audit.actor_id == v.receipt_key.actor_id
            && v.audit.mutation_id == p.mutation_id
            && v.audit.audit_id == a.native_audit_id
            && uuid(&v.audit.audit_id)
            && text(&v.audit.server_recorded_at)
            && v.audit.result_revision == a.version.revision
            && v.audit.previous_revision == a.previous.as_ref().map(|pin| pin.revision),
        "receipt/audit/result correlation mismatch",
    )?;
    match &v.target_admission {
        TargetAdmission::Resolved {
            room_identity,
            room_semantics,
            mapping_review,
            source_object_ids,
        } => {
            need(
                native(room_identity, RecordRefRecordType::Identity)
                    && native(room_semantics, RecordRefRecordType::LocationSemantics)
                    && native(mapping_review, RecordRefRecordType::Evidence)
                    && source_object_ids == &p.target.source_object_ids,
                "resolved mapping requires exact native references and semantic object comparison",
            )?;
        }
        _ => return Err(ValidationError("unresolved target cannot be committed")),
    }
    match &v.acquisition {
        AcquisitionFacts::UserReportedMeasurement {
            attestation,
            actor_id,
            recorded_at,
        } => need(
            a.method == MeasurementMethod::UserReportedMeasured
                && p.area.attestation.as_ref() == Some(attestation)
                && actor_id == &v.audit.actor_id
                && recorded_at == &v.audit.server_recorded_at
                && a.support.corroboration == Corroboration::NotEstablished
                && a.support.uncertainties
                    == vec![v2::Uncertainty {
                        status: v2::UncertaintyStatus::Unknown,
                        explanation: None,
                    }]
                && a.support.limitations == vec![SupportLimitation::UserReportedMeasurement],
            "personal attestation attribution/support must match the actual recording audit",
        )?,
        AcquisitionFacts::ImageInformedEstimate => need(
            a.method == MeasurementMethod::Estimated,
            "image-informed estimate must remain estimated",
        )?,
        AcquisitionFacts::DirectMeasurement { review } => need(
            a.method == MeasurementMethod::DirectlyMeasured
                && native(review, RecordRefRecordType::Evidence),
            "direct measurement needs independent method review",
        )?,
        AcquisitionFacts::PhotoFit { review } => need(
            a.method == MeasurementMethod::PhotoFitted
                && native(review, RecordRefRecordType::Evidence),
            "photo fit needs independent method review",
        )?,
        AcquisitionFacts::Unqualified => need(
            !matches!(
                a.method,
                MeasurementMethod::DirectlyMeasured
                    | MeasurementMethod::PhotoFitted
                    | MeasurementMethod::UserReportedMeasured
            ),
            "photo evidence or entry alone does not qualify measurement or fit",
        )?,
    }
    need(
        a.evidence.len() == p.area.evidence.len()
            && a.evidence
                .iter()
                .zip(&p.area.evidence)
                .all(|(actual, expected)| {
                    actual.role == expected.role
                        && native_matches(&expected.reference, &actual.evidence)
                }),
        "retained evidence roles/revisions differ from proposal",
    )?;
    need(
        a.inputs.len() == p.area.inputs.len()
            && a.inputs
                .iter()
                .zip(&p.area.inputs)
                .all(|(actual, expected)| match (expected, &actual.pin) {
                    (InputExpectation::SelectedModel, InputPin::Model(model)) => {
                        **model == a.entered_against
                    }
                    (InputExpectation::Native(e), InputPin::Native(pin)) => native_matches(e, pin),
                    (InputExpectation::Assertion(e), InputPin::Assertion(pin)) => pin == &e.pin(),
                    _ => false,
                }),
        "retained input lineage differs from proposal",
    )?;
    need(
        v.pending.assertion == a.version
            && v.pending.model == a.entered_against
            && v.pending.target_feature_sha256 == a.target_feature_sha256
            && v.pending.unresolved_conflicts.len() <= super::validation::MAX_HISTORY
            && v.pending.unresolved_conflicts.iter().all(conflict_pin),
        "pending work must pin exact version, artifact and bounded valid conflicts",
    )
}

/// Structural correlation only. The caller must supply a complete authorized
/// append-ordered dependency closure from one native read point, not a page.
pub fn validate_full_history(
    h: &FullHistory,
    authoritative_history: &[MeasurementAssertion],
) -> ValidationResult<()> {
    need(
        v2::validate(&h.scope).is_ok()
            && uuid(&h.assertion_id)
            && !h.versions.is_empty()
            && text(&h.read_point.marker)
            && assertion_pin(&h.expected_current_head)
            && h.expected_current_head.assertion_id == h.assertion_id
            && h.versions
                .last()
                .is_some_and(|v| v.assertion.version == h.expected_current_head),
        "complete audited-create stream and actual current-head pin required",
    )?;
    validate_history(authoritative_history)?;
    let stream: Vec<_> = authoritative_history
        .iter()
        .filter(|a| a.version.assertion_id == h.assertion_id)
        .collect();
    need(
        stream.len() == h.versions.len(),
        "history cannot omit retained versions",
    )?;
    let mut seen_receipt_keys = Vec::new();
    for (index, v) in h.versions.iter().enumerate() {
        validate_committed(v)?;
        need(
            v.assertion == *stream[index]
                && v.assertion.target.scope == h.scope
                && v.assertion.version.revision == index as u64 + 1
                && !seen_receipt_keys.contains(&v.receipt_key),
            "history stream/revision/receipt-key mismatch",
        )?;
        seen_receipt_keys.push(v.receipt_key.clone());
        if index == 0 {
            need(
                v.proposal.operation == OnlineOperation::Create,
                "legacy adoption and unaudited seeds excluded",
            )?;
        } else {
            let old = &h.versions[index - 1];
            need(
                matches!(v.proposal.operation, OnlineOperation::Correct { .. })
                    && v.assertion.previous.as_ref() == Some(&old.assertion.version)
                    && v.proposal.target == old.proposal.target
                    && v.assertion.entered_against == old.assertion.entered_against
                    && old
                        .pending
                        .unresolved_conflicts
                        .iter()
                        .all(|c| v.pending.unresolved_conflicts.contains(c)),
                "correction retargeted or dropped inherited conflict obligations",
            )?;
        }
        let at = authoritative_history
            .iter()
            .position(|a| a.version == v.assertion.version)
            .ok_or(ValidationError("missing exact history row"))?;
        let prefix = &authoritative_history[..=at];
        let relevant: Vec<_> = super::validation::historical_contradictions(prefix)
            .into_iter()
            .filter(|c| {
                super::validation::affected_heads(prefix, c)
                    .iter()
                    .any(|head| head.assertion_id == h.assertion_id)
            })
            .collect();
        need(
            v.pending.unresolved_conflicts == relevant,
            "complete inherited conflict lineage required; no resolution endpoint exists",
        )?;
    }
    Ok(())
}
pub fn current(h: &FullHistory, closure: CurrentClosure<'_>) -> ValidationResult<Current> {
    let (read_point, assertions) = match closure {
        CurrentClosure::CompleteAtReadPoint {
            read_point,
            assertions,
        } => (read_point, assertions),
        CurrentClosure::Unavailable => {
            return Err(ValidationError(
                "current conflict closure unavailable; no empty inference permitted",
            ));
        }
    };
    need(
        read_point == h.read_point && assertions.iter().all(|a| a.target.scope == h.scope),
        "current conflict closure belongs to another read point or scope",
    )?;
    validate_full_history(h, assertions)?;
    let head = h.versions.last().ok_or(ValidationError("missing head"))?;
    need(
        active_assertions(assertions)?
            .iter()
            .any(|a| a.version == head.assertion.version),
        "current conflict projection requires the exact active head",
    )?;
    let conflicts: Vec<_> = super::validation::historical_contradictions(assertions)
        .into_iter()
        .filter_map(|contradiction| {
            let affected_heads = super::validation::affected_heads(assertions, &contradiction);
            affected_heads
                .contains(&head.assertion.version)
                .then_some(CurrentConflict {
                    contradiction,
                    affected_heads,
                })
        })
        .collect();
    need(
        conflicts.len() <= super::validation::MAX_HISTORY,
        "current conflict bound exceeded; do not truncate or infer no conflicts",
    )?;
    Ok(Current {
        head: head.clone(),
        read_point: read_point.clone(),
        current_conflicts: CurrentConflictProjection {
            assertion: head.assertion.version.clone(),
            read_point,
            conflicts,
        },
    })
}

/// Native commit/current composition uses the same historical successor logic
/// as this contract. The caller owns complete authenticated enumeration; this
/// helper only validates and projects an exact active version in that cut.
pub fn conflict_projection(
    assertion: &AssertionVersion,
    read_point: ReadPoint,
    assertions: &[MeasurementAssertion],
) -> ValidationResult<CurrentConflictProjection> {
    need(
        text(&read_point.marker)
            && active_assertions(assertions)?
                .iter()
                .any(|a| &a.version == assertion),
        "conflict projection requires exact active head and read point",
    )?;
    let conflicts: Vec<_> = super::validation::historical_contradictions(assertions)
        .into_iter()
        .filter_map(|contradiction| {
            let affected_heads = super::validation::affected_heads(assertions, &contradiction);
            affected_heads
                .contains(assertion)
                .then_some(CurrentConflict {
                    contradiction,
                    affected_heads,
                })
        })
        .collect();
    need(
        conflicts.len() <= super::validation::MAX_HISTORY,
        "complete conflict projection exceeds bound",
    )?;
    Ok(CurrentConflictProjection {
        assertion: assertion.clone(),
        read_point,
        conflicts,
    })
}

/// Structural outcome projection after a currently authorized same-store read.
/// Unavailable/denied reads are errors upstream, never an absent outcome here.
pub fn classify_outcome<'a>(
    key: &ReceiptKey,
    read_point: ReadPoint,
    retained: Option<&'a CommittedVersion>,
) -> ValidationResult<MutationOutcome<'a>> {
    need(
        v2::validate(&key.scope).is_ok()
            && uuid(&key.actor_id)
            && uuid(&key.mutation_id)
            && text(&read_point.marker),
        "invalid server outcome lookup context",
    )?;
    match retained {
        None => Ok(MutationOutcome::NotRecordedAtReadPoint(read_point)),
        Some(v) => {
            validate_committed(v)?;
            need(
                &v.receipt_key == key,
                "outcome receipt belongs to another scope, actor or mutation",
            )?;
            Ok(MutationOutcome::Committed(v))
        }
    }
}

/// Called only AFTER native authorization and actor-scoped lookup. A miss is
/// an ordering directive, not permission to allocate, mutate or close work.
pub fn classify_retry<'a>(
    p: &OnlineProposal,
    actor_id: &str,
    retained: Option<&'a CommittedVersion>,
) -> ValidationResult<RetryDecision<'a>> {
    validate_proposal(p)?;
    need(uuid(actor_id), "server actor required")?;
    match retained {
        None => Ok(RetryDecision::NeedsAdmissionBeforeAllocation),
        Some(v) => {
            validate_committed(v)?;
            need(
                v.receipt_key.actor_id == actor_id
                    && v.proposal == *p
                    && v.proposal_sha256 == proposal_digest(p)?,
                "idempotency conflict or wrong scoped receipt",
            )?;
            Ok(RetryDecision::Retained(v))
        }
    }
}

#[cfg(test)]
#[path = "online_contract_tests.rs"]
mod tests;
