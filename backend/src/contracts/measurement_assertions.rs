//! Explicit measurement 1.0.0 schema boundary; no frozen v1/v2 reinterpretation.
//! The sibling carriers were produced by the separately released named generator.
use super::{ConstBool, ConstInt, JsonInteger, JsonNumber, Optional, required_field};
use super::{ContractError, ensure_numbers_supported, json_value, semantics};
use crate::measurement_assertions::{self as m, online_contract as online};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
#[allow(clippy::large_enum_variant)]
#[path = "generated_measurement_assertions.rs"]
mod generated;
pub use generated::*;
pub const SCHEMA_URI: &str =
    "https://houseatlas.invalid/contracts/measurement-assertions/1.0.0/atlas.schema.json";
pub const VERSION: &str = "1.0.0";
pub trait Contract: DeserializeOwned + Serialize {
    const SCHEMA_KEY: &'static str;
}
static VALIDATORS: OnceLock<Mutex<BTreeMap<String, jsonschema::Validator>>> = OnceLock::new();
fn invalid(why: &'static str) -> ContractError {
    ContractError::Schema(why.into())
}
pub fn parse(bytes: &[u8]) -> Result<Value, ContractError> {
    json_value::parse(bytes)
}
pub fn validate_value(name: &str, value: &Value) -> Result<(), ContractError> {
    ensure_numbers_supported(value).map_err(ContractError::UnsupportedNumber)?;
    let mut validators = VALIDATORS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| ContractError::Setup("Measurement schema unavailable".into()))?;
    if !validators.contains_key(name) {
        let atlas = parse(include_bytes!(
            "../../../packages/contracts/schemas/atlas.measurement-assertions.schema.json"
        ))?;
        if atlas["$id"] != SCHEMA_URI {
            return Err(ContractError::Setup(
                "Measurement schema identity mismatch".into(),
            ));
        }
        let schema = if name == "$measurement" {
            atlas
        } else {
            if !generated::SCHEMA_DEFINITIONS.contains(&name) || atlas["$defs"].get(name).is_none()
            {
                return Err(ContractError::Setup("Unknown measurement shape".into()));
            }
            json!({"$schema":atlas["$schema"],"$defs":atlas["$defs"],"$ref":format!("#/$defs/{name}")})
        };
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .with_format("date", semantics::published_date_format)
            .with_format("date-time", semantics::published_date_time_format)
            .with_format("uri", semantics::published_uri_format)
            .should_validate_formats(true)
            .should_ignore_unknown_formats(false)
            .build(&schema)
            .map_err(|e| ContractError::Setup(e.to_string()))?;
        validators.insert(name.into(), validator);
    }
    validators[name]
        .validate(value)
        .map_err(|e| ContractError::Schema(e.to_string()))
}
pub fn decode<T: Contract>(bytes: &[u8]) -> Result<T, ContractError> {
    let v = parse(bytes)?;
    validate_value(T::SCHEMA_KEY, &v)?;
    Ok(serde_json::from_value(v)?)
}
pub fn encode<T: Contract>(v: &T) -> Result<Vec<u8>, ContractError> {
    let v = serde_json::to_value(v)?;
    validate_value(T::SCHEMA_KEY, &v)?;
    Ok(serde_json::to_vec(&v)?)
}
pub fn canonical(v: &Value) -> Result<String, ContractError> {
    ensure_numbers_supported(v).map_err(ContractError::UnsupportedNumber)?;
    semantics::canonical_json(v).map_err(|_| invalid("Canonical measurement encoding unavailable"))
}
pub fn digest(v: &Value) -> Result<String, ContractError> {
    semantics::canonical_digest(v).map_err(|_| invalid("Measurement digest unavailable"))
}
/// Exact bounded integral conversion; binary64 is only a candidate, compared
/// back against the original decimal parts before any conversion is accepted.
pub(crate) fn integer(v: &Value) -> Result<u64, ContractError> {
    let n = v
        .as_number()
        .ok_or_else(|| invalid("Integral field required"))?;
    let parts = super::numeric::analyze_number(n).map_err(ContractError::UnsupportedNumber)?;
    let f = n
        .as_f64()
        .ok_or_else(|| invalid("Bounded integer required"))?;
    if !f.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&f) || f.fract() != 0.0 {
        return Err(invalid("Bounded integer required"));
    }
    let candidate = f as u64;
    if !parts.equals_i64(candidate as i64) {
        return Err(invalid("Exact bounded integer required"));
    }
    Ok(candidate)
}
fn string(v: &Value) -> Result<String, ContractError> {
    v.as_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid("String field required"))
}
fn array(v: &Value) -> Result<&[Value], ContractError> {
    v.as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("Array field required"))
}
fn native_expectation(v: &Value) -> Result<online::NativeExpectation, ContractError> {
    Ok(online::NativeExpectation {
        record: serde_json::from_value(v["record"].clone())?,
        expected_revision: integer(&v["expectedRevision"])?,
        expected_payload_sha256: string(&v["expectedPayloadSha256"])?,
    })
}
fn assertion_expectation(v: &Value) -> Result<online::AssertionExpectation, ContractError> {
    Ok(online::AssertionExpectation {
        assertion_id: string(&v["assertionId"])?,
        expected_revision: integer(&v["expectedRevision"])?,
        expected_payload_sha256: string(&v["expectedPayloadSha256"])?,
    })
}
pub fn proposal(v: &Value) -> Result<online::OnlineProposal, ContractError> {
    validate_value("proposal", v)?;
    let op = &v["operation"];
    let operation = match op["kind"].as_str() {
        Some("create") => online::OnlineOperation::Create,
        Some("correct") => online::OnlineOperation::Correct {
            assertion_id: string(&op["assertionId"])?,
            expected_revision: integer(&op["expectedRevision"])?,
            expected_payload_sha256: string(&op["expectedPayloadSha256"])?,
        },
        _ => return Err(invalid("Unsupported measurement operation")),
    };
    let t = &v["target"];
    let a = &v["area"];
    let target = online::TargetExpectation {
        building_id: string(&t["buildingId"])?,
        room_id: string(&t["roomId"])?,
        level_id: string(&t["levelId"])?,
        occurrence_id: string(&t["occurrenceId"])?,
        publication_id: string(&t["publicationId"])?,
        source_revision_id: string(&t["sourceRevisionId"])?,
        source_sha256: string(&t["sourceSha256"])?,
        semantics_sha256: string(&t["semanticsSha256"])?,
        overview_manifest_sha256: string(&t["overviewManifestSha256"])?,
        selection_revision: string(&t["selectionRevision"])?,
        artifact_sha256: string(&t["artifactSha256"])?,
        artifact_bytes: integer(&t["artifactBytes"])?,
        target_feature_sha256: string(&t["targetFeatureSha256"])?,
        source_object_ids: array(&t["sourceObjectIds"])?
            .iter()
            .map(string)
            .collect::<Result<_, _>>()?,
    };
    let method = match a["method"].as_str() {
        Some("guessed") => m::MeasurementMethod::Guessed,
        Some("estimated") => m::MeasurementMethod::Estimated,
        Some("user-reported-measured") => m::MeasurementMethod::UserReportedMeasured,
        Some("directly-measured") => m::MeasurementMethod::DirectlyMeasured,
        Some("photo-fitted") => m::MeasurementMethod::PhotoFitted,
        Some("derived") => m::MeasurementMethod::Derived,
        Some("imported") => m::MeasurementMethod::Imported,
        _ => return Err(invalid("Unsupported acquisition method")),
    };
    let unit = match a["unit"].as_str() {
        Some("m2") => m::Unit::SquareMetre,
        Some("cm2") => m::Unit::SquareCentimetre,
        Some("mm2") => m::Unit::SquareMillimetre,
        _ => return Err(invalid("Area unit required")),
    };
    let evidence = array(&a["evidence"])?
        .iter()
        .map(|e| {
            Ok(online::EvidenceProposal {
                reference: native_expectation(&e["reference"])?,
                role: match e["role"].as_str() {
                    Some("supports") => m::EvidenceRole::Supports,
                    Some("contradicts") => m::EvidenceRole::Contradicts,
                    Some("context") => m::EvidenceRole::Context,
                    _ => return Err(invalid("Evidence role required")),
                },
            })
        })
        .collect::<Result<_, ContractError>>()?;
    let inputs = array(&a["inputs"])?
        .iter()
        .map(|e| match e["kind"].as_str() {
            Some("selected-model") => Ok(online::InputExpectation::SelectedModel),
            Some("native") => Ok(online::InputExpectation::Native(native_expectation(
                &e["reference"],
            )?)),
            Some("assertion") => Ok(online::InputExpectation::Assertion(assertion_expectation(
                e,
            )?)),
            _ => Err(invalid("Input comparison required")),
        })
        .collect::<Result<_, _>>()?;
    let p = online::OnlineProposal {
        scope: serde_json::from_value(v["scope"].clone())?,
        mutation_id: string(&v["mutationId"])?,
        operation,
        target,
        area: online::AreaProposal {
            decimal_token: string(&a["decimalToken"])?,
            unit,
            quantity_kind: m::QuantityKind::Area,
            method,
            attestation: if a.get("attestation").is_some() {
                Some(online::PersonalMeasurementAttestation::PersonallyMeasured)
            } else {
                None
            },
            evidence,
            inputs,
            operation: if a["operation"].is_null() {
                None
            } else {
                Some(string(&a["operation"])?)
            },
            contradicts: array(&a["contradicts"])?
                .iter()
                .map(assertion_expectation)
                .collect::<Result<_, _>>()?,
        },
        reason: string(&v["reason"])?,
    };
    let expected =
        online::canonical_proposal(&p).map_err(|_| invalid("Invalid online proposal semantics"))?;
    if canonical(v)? != expected {
        return Err(invalid("Proposal projection mismatch"));
    }
    Ok(p)
}
/// Excludes ONLY the enclosing version's own payloadSha256. Nested prior/input
/// digests and preallocated nativeAuditId remain inside the hashed projection.
pub fn assertion_payload_digest(assertion: &Value) -> Result<String, ContractError> {
    let mut value = assertion.clone();
    let version = value
        .get_mut("version")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("Assertion version required"))?;
    if version.remove("payloadSha256").is_none() {
        return Err(invalid("Self digest slot required"));
    }
    digest(&value)
}
pub fn full_assertion_digest(assertion: &Value) -> Result<String, ContractError> {
    validate_value("record", assertion)?;
    if assertion["version"]["payloadSha256"] != assertion_payload_digest(assertion)? {
        return Err(invalid("Assertion payload digest mismatch"));
    }
    digest(assertion)
}
pub fn receipt_digest(body: &Value) -> Result<String, ContractError> {
    validate_value("receiptBody", body)?;
    full_assertion_digest(&body["committed"]["assertion"])?;
    digest(body)
}
/// Read metadata is outside immutable bodies. Preserve the exact SQL receipt
/// digest for each pinned version; no body self-hash/circular field is added.
pub fn validate_external_receipts(value: &Value) -> Result<(), ContractError> {
    let check = |body: &Value, metadata: &Value| -> Result<(), ContractError> {
        if metadata["assertion"] != body["committed"]["assertion"]["version"]
            || metadata["receiptSha256"] != receipt_digest(body)?
        {
            return Err(invalid("External retained receipt digest mismatch"));
        }
        Ok(())
    };
    match value["profile"].as_str() {
        Some("houseatlas.measurement-current.v1") => check(&value["head"], &value["receiptDigest"]),
        Some("houseatlas.measurement-history.v1") => {
            let bodies = array(&value["versions"])?;
            let metadata = array(&value["receiptDigests"])?;
            if bodies.len() != metadata.len() {
                return Err(invalid("Incomplete external receipt digest history"));
            }
            let mut seen = std::collections::BTreeSet::new();
            for (body, m) in bodies.iter().zip(metadata) {
                check(body, m)?;
                if !seen.insert(canonical(&m["assertion"])?) {
                    return Err(invalid("Duplicate external receipt version"));
                }
            }
            Ok(())
        }
        _ => Err(invalid("Retained receipt read profile required")),
    }
}

fn version(v: &Value) -> Result<m::AssertionVersion, ContractError> {
    Ok(m::AssertionVersion {
        assertion_id: string(&v["assertionId"])?,
        revision: integer(&v["revision"])?,
        payload_sha256: string(&v["payloadSha256"])?,
    })
}
fn native(v: &Value) -> Result<m::NativeRevision, ContractError> {
    Ok(m::NativeRevision {
        record: serde_json::from_value(v["record"].clone())?,
        revision: integer(&v["revision"])?,
        payload_sha256: string(&v["payloadSha256"])?,
    })
}
fn method(v: &Value) -> Result<m::MeasurementMethod, ContractError> {
    match v.as_str() {
        Some("guessed") => Ok(m::MeasurementMethod::Guessed),
        Some("estimated") => Ok(m::MeasurementMethod::Estimated),
        Some("user-reported-measured") => Ok(m::MeasurementMethod::UserReportedMeasured),
        Some("directly-measured") => Ok(m::MeasurementMethod::DirectlyMeasured),
        Some("photo-fitted") => Ok(m::MeasurementMethod::PhotoFitted),
        Some("derived") => Ok(m::MeasurementMethod::Derived),
        Some("imported") => Ok(m::MeasurementMethod::Imported),
        Some("legacy-user-reported-method-unspecified") => {
            Ok(m::MeasurementMethod::LegacyUserReportedMethodUnspecified)
        }
        _ => Err(invalid("Invalid retained method")),
    }
}
fn model(v: &Value) -> Result<m::ModelPin, ContractError> {
    let lineage = &v["lineage"];
    let custody = match v["custody"]["kind"].as_str() {
        Some("unknown") => m::ModelCustody::Unknown,
        Some("native-records") => m::ModelCustody::NativeRecords {
            geometry: native(&v["custody"]["geometry"])?,
            association: native(&v["custody"]["association"])?,
        },
        _ => return Err(invalid("Invalid native custody")),
    };
    let physical_registration = match v["physicalRegistration"]["kind"].as_str() {
        Some("unknown") => m::PhysicalRegistration::Unknown,
        Some("reviewed") => m::PhysicalRegistration::Reviewed {
            evidence: native(&v["physicalRegistration"]["evidence"])?,
        },
        _ => return Err(invalid("Invalid physical registration")),
    };
    Ok(m::ModelPin {
        scope: serde_json::from_value(v["scope"].clone())?,
        building_id: string(&v["buildingId"])?,
        publication_id: string(&v["publicationId"])?,
        artifact_id: string(&v["artifactId"])?,
        artifact_sha256: string(&v["artifactSha256"])?,
        artifact_bytes: integer(&v["artifactBytes"])?,
        lineage: m::ModelLineage::UnifiedAtlasPublication {
            source_revision_id: string(&lineage["sourceRevisionId"])?,
            source_sha256: string(&lineage["sourceSha256"])?,
            semantics_sha256: string(&lineage["semanticsSha256"])?,
            overview_manifest_sha256: string(&lineage["overviewManifestSha256"])?,
            selection_revision: string(&lineage["selectionRevision"])?,
        },
        custody,
        physical_registration,
    })
}
fn support(v: &Value) -> Result<m::MeasurementSupport, ContractError> {
    let corroboration = match v["corroboration"].as_str() {
        Some("not-established") => m::Corroboration::NotEstablished,
        Some("corroborated") => m::Corroboration::Corroborated,
        _ => return Err(invalid("Invalid corroboration")),
    };
    let limitations = array(&v["limitations"])?
        .iter()
        .map(|x| match x.as_str() {
            Some("guessed") => Ok(m::SupportLimitation::Guessed),
            Some("estimated") => Ok(m::SupportLimitation::Estimated),
            Some("photo-fitted") => Ok(m::SupportLimitation::PhotoFitted),
            Some("inferred-mesh") => Ok(m::SupportLimitation::InferredMesh),
            Some("method-unspecified") => Ok(m::SupportLimitation::MethodUnspecified),
            Some("imported-unqualified") => Ok(m::SupportLimitation::ImportedUnqualified),
            Some("user-reported-measurement") => Ok(m::SupportLimitation::UserReportedMeasurement),
            _ => Err(invalid("Invalid retained limitation")),
        })
        .collect::<Result<_, _>>()?;
    Ok(m::MeasurementSupport {
        corroboration,
        uncertainties: serde_json::from_value(v["uncertainties"].clone())?,
        limitations,
    })
}
fn conflict(v: &Value) -> Result<m::ContradictionRef, ContractError> {
    match v["kind"].as_str() {
        Some("assertions") => Ok(m::ContradictionRef::Assertions {
            raised_by: version(&v["raisedBy"])?,
            against: version(&v["against"])?,
        }),
        Some("evidence") => Ok(m::ContradictionRef::Evidence {
            raised_by: version(&v["raisedBy"])?,
            evidence: native(&v["evidence"])?,
        }),
        _ => Err(invalid("Invalid retained contradiction")),
    }
}
pub fn assertion(v: &Value) -> Result<m::MeasurementAssertion, ContractError> {
    validate_value("record", v)?;
    let target = &v["target"];
    let quantity = &v["value"];
    let unit = match quantity["unit"].as_str() {
        Some("m2") => m::Unit::SquareMetre,
        Some("cm2") => m::Unit::SquareCentimetre,
        Some("mm2") => m::Unit::SquareMillimetre,
        _ => return Err(invalid("Retained area unit required")),
    };
    let inputs = array(&v["inputs"])?
        .iter()
        .map(|input| {
            let pin = match input["pin"]["kind"].as_str() {
                Some("model") => m::InputPin::Model(Box::new(model(&input["pin"]["model"])?)),
                Some("native") => m::InputPin::Native(native(&input["pin"]["native"])?),
                Some("assertion") => m::InputPin::Assertion(version(&input["pin"]["assertion"])?),
                _ => return Err(invalid("Invalid retained input")),
            };
            Ok(m::ProvenanceInput {
                pin,
                methods: array(&input["methods"])?
                    .iter()
                    .map(method)
                    .collect::<Result<_, _>>()?,
                support: support(&input["support"])?,
            })
        })
        .collect::<Result<_, ContractError>>()?;
    let evidence = array(&v["evidence"])?
        .iter()
        .map(|e| {
            let role = match e["role"].as_str() {
                Some("supports") => m::EvidenceRole::Supports,
                Some("contradicts") => m::EvidenceRole::Contradicts,
                Some("context") => m::EvidenceRole::Context,
                _ => return Err(invalid("Invalid retained evidence role")),
            };
            Ok(m::EvidenceLink {
                evidence: native(&e["evidence"])?,
                role,
            })
        })
        .collect::<Result<_, ContractError>>()?;
    let review = match v["review"]["kind"].as_str() {
        Some("no-known-issue") => m::ClaimReview::NoKnownIssue,
        Some("ambiguous") => m::ClaimReview::Ambiguous(string(&v["review"]["reason"])?),
        Some("inconsistent") => m::ClaimReview::Inconsistent(string(&v["review"]["reason"])?),
        _ => return Err(invalid("Invalid retained review")),
    };
    let a = m::MeasurementAssertion {
        version: version(&v["version"])?,
        previous: if v["previous"].is_null() {
            None
        } else {
            Some(version(&v["previous"])?)
        },
        target: m::SemanticTarget {
            scope: serde_json::from_value(target["scope"].clone())?,
            namespace: m::SemanticNamespace::ProducerPublication {
                publication_id: string(&target["namespace"]["publicationId"])?,
            },
            building_id: string(&target["buildingId"])?,
            room_id: string(&target["roomId"])?,
            floor_id: string(&target["floorId"])?,
            occurrence_id: string(&target["occurrenceId"])?,
            feature: m::SemanticFeature::Room,
        },
        property: m::MeasurementProperty::OccurrenceArea,
        value: m::ExactQuantity {
            entered: m::DecimalToken::parse(&string(&quantity["decimalToken"])?)
                .map_err(|_| invalid("Invalid retained decimal"))?,
            unit,
            kind: m::QuantityKind::Area,
        },
        entered_against: model(&v["enteredAgainst"])?,
        target_feature_sha256: string(&v["targetFeatureSha256"])?,
        method: method(&v["method"])?,
        support: support(&v["support"])?,
        inputs,
        operation: if v["operation"].is_null() {
            None
        } else {
            Some(string(&v["operation"])?)
        },
        evidence,
        supersedes: vec![],
        contradicts: array(&v["contradicts"])?
            .iter()
            .map(version)
            .collect::<Result<_, _>>()?,
        resolutions: vec![],
        review,
        change_reason: string(&v["changeReason"])?,
        native_audit_id: string(&v["nativeAuditId"])?,
    };
    m::validate_assertion(&a).map_err(|_| invalid("Invalid retained assertion semantics"))?;
    Ok(a)
}
pub fn committed(v: &Value) -> Result<online::CommittedVersion, ContractError> {
    validate_value("committedVersion", v)?;
    let audit = &v["audit"];
    let admission = &v["targetAdmission"];
    let acquisition = match v["acquisition"]["kind"].as_str() {
        Some("user-reported-measurement") => online::AcquisitionFacts::UserReportedMeasurement {
            attestation: online::PersonalMeasurementAttestation::PersonallyMeasured,
            actor_id: string(&v["acquisition"]["actorId"])?,
            recorded_at: string(&v["acquisition"]["recordedAt"])?,
        },
        Some("unqualified") => online::AcquisitionFacts::Unqualified,
        Some("image-informed-estimate") => online::AcquisitionFacts::ImageInformedEstimate,
        Some("direct-measurement") => online::AcquisitionFacts::DirectMeasurement {
            review: native(&v["acquisition"]["review"])?,
        },
        Some("photo-fit") => online::AcquisitionFacts::PhotoFit {
            review: native(&v["acquisition"]["review"])?,
        },
        _ => return Err(invalid("Invalid retained acquisition")),
    };
    let result = online::CommittedVersion {
        assertion: assertion(&v["assertion"])?,
        proposal: proposal(&v["proposal"])?,
        proposal_sha256: string(&v["proposalSha256"])?,
        receipt_key: online::ReceiptKey {
            scope: serde_json::from_value(v["receiptKey"]["scope"].clone())?,
            actor_id: string(&v["receiptKey"]["actorId"])?,
            mutation_id: string(&v["receiptKey"]["mutationId"])?,
        },
        audit: online::AuditAnchor {
            audit_id: string(&audit["auditId"])?,
            actor_id: string(&audit["actorId"])?,
            mutation_id: string(&audit["mutationId"])?,
            server_recorded_at: string(&audit["serverRecordedAt"])?,
            previous_revision: if audit["previousRevision"].is_null() {
                None
            } else {
                Some(integer(&audit["previousRevision"])?)
            },
            result_revision: integer(&audit["resultRevision"])?,
        },
        target_admission: online::TargetAdmission::Resolved {
            room_identity: native(&admission["roomIdentity"])?,
            room_semantics: native(&admission["roomSemantics"])?,
            mapping_review: Box::new(native(&admission["mappingReview"])?),
            source_object_ids: array(&admission["sourceObjectIds"])?
                .iter()
                .map(string)
                .collect::<Result<_, _>>()?,
        },
        acquisition,
        pending: online::PendingWork {
            assertion: version(&v["pending"]["assertion"])?,
            model: model(&v["pending"]["model"])?,
            target_feature_sha256: string(&v["pending"]["targetFeatureSha256"])?,
            unresolved_conflicts: array(&v["pending"]["unresolvedConflicts"])?
                .iter()
                .map(conflict)
                .collect::<Result<_, _>>()?,
        },
    };
    online::validate_committed(&result)
        .map_err(|_| invalid("Invalid committed online correlations"))?;
    Ok(result)
}

/// Fresh review of implicit unequal claims, DISTINCT from historical explicit
/// contradictions and immutable pending receipts. The native caller must first
/// establish this complete authorized cut (including reverse/later claims) and
/// capture its actual head/read point; this helper cannot prove enumeration.
/// Compose before falling back to missing model observation. No geometry or
/// correspondence authority is supplied and no model obligation is closed.
pub fn current_value_review(
    selected: &m::MeasurementAssertion,
    closure: online::CurrentClosure<'_>,
) -> Result<Value, ContractError> {
    use std::cmp::Ordering;
    let (read_point, all) = match closure {
        online::CurrentClosure::CompleteAtReadPoint {
            read_point,
            assertions,
        } => (read_point, assertions),
        online::CurrentClosure::Unavailable => {
            return Err(invalid("Current value-review closure unavailable"));
        }
    };
    validate_value("readPoint", &json!({"marker":read_point.marker}))?;
    if all.iter().any(|a| a.target.scope != selected.target.scope) {
        return Err(invalid("Cross-scope current value-review cut"));
    }
    let active = m::active_assertions(all)
        .map_err(|_| invalid("Incomplete current value-review history"))?;
    if !active.contains(&selected) {
        return Err(invalid(
            "Current value review requires the actual exact active head",
        ));
    }
    let pin = |v: &m::AssertionVersion| json!({"assertionId":v.assertion_id,"revision":v.revision,"payloadSha256":v.payload_sha256});
    let mut conflicting = Vec::new();
    for other in active {
        if other.target == selected.target
            && other.property == selected.property
            && other
                .value
                .compare(&selected.value)
                .map_err(|_| invalid("Exact current quantity comparison unavailable"))?
                != Ordering::Equal
        {
            conflicting.push(pin(&other.version));
        }
    }
    let result = json!({"status":if conflicting.is_empty() {"no-unequal-active-assertions"} else {"review-required"},
        "assertion":pin(&selected.version),"readPoint":{"marker":read_point.marker},"conflictingAssertions":conflicting});
    validate_value("currentValueReview", &result)?;
    Ok(result)
}
pub fn version_value(v: &m::AssertionVersion) -> Value {
    json!({"assertionId":v.assertion_id,"revision":v.revision,"payloadSha256":v.payload_sha256})
}
pub fn conflict_value(v: &m::ContradictionRef) -> Result<Value, ContractError> {
    let native_value = |n: &m::NativeRevision| -> Result<Value, ContractError> {
        Ok(
            json!({"record":serde_json::to_value(&n.record)?,"revision":n.revision,"payloadSha256":n.payload_sha256}),
        )
    };
    Ok(match v {
        m::ContradictionRef::Assertions { raised_by, against } => {
            json!({"kind":"assertions","raisedBy":version_value(raised_by),"against":version_value(against)})
        }
        m::ContradictionRef::Evidence {
            raised_by,
            evidence,
        } => {
            json!({"kind":"evidence","raisedBy":version_value(raised_by),"evidence":native_value(evidence)?})
        }
    })
}
pub fn conflicts_value(v: &online::CurrentConflictProjection) -> Result<Value, ContractError> {
    let conflicts = v
        .conflicts
        .iter()
        .map(|c| {
            Ok(json!({"contradiction":conflict_value(&c.contradiction)?,
        "affectedHeads":c.affected_heads.iter().map(version_value).collect::<Vec<_>>()}))
        })
        .collect::<Result<Vec<_>, ContractError>>()?;
    Ok(
        json!({"assertion":version_value(&v.assertion),"readPoint":{"marker":v.read_point.marker},"conflicts":conflicts}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    // FROZEN/UNEXECUTED; registration and exact-tree release are required.
    #[test]
    fn exact_integral_comparison_does_not_round_into_revision() {
        assert_eq!(integer(&parse(b"1.0").unwrap()).unwrap(), 1);
        assert!(integer(&parse(b"1.00000000000000000001").unwrap()).is_err());
    }
    #[test]
    fn payload_self_exclusion_retains_prior_digest_and_audit_identity() {
        let a = json!({"version":{"assertionId":"generated","revision":1,"payloadSha256":"first"},"nativeAuditId":"audit-a","previous":{"payloadSha256":"prior"}});
        let mut b = a.clone();
        b["version"]["payloadSha256"] = json!("second");
        assert_eq!(
            assertion_payload_digest(&a).unwrap(),
            assertion_payload_digest(&b).unwrap()
        );
        b["nativeAuditId"] = json!("audit-b");
        assert_ne!(
            assertion_payload_digest(&a).unwrap(),
            assertion_payload_digest(&b).unwrap()
        );
        b = a.clone();
        b["previous"]["payloadSha256"] = json!("different");
        assert_ne!(
            assertion_payload_digest(&a).unwrap(),
            assertion_payload_digest(&b).unwrap()
        );
    }
    fn area_claim(id: u64, token: &str, unit: m::Unit) -> m::MeasurementAssertion {
        let uuid = |n: u64| format!("00000000-0000-4000-8000-{n:012x}");
        let hash = "ab".repeat(32);
        let scope = crate::contracts::v2::Scope {
            workspace_id: uuid(801),
            home_id: uuid(802),
        };
        m::MeasurementAssertion {
            version: m::AssertionVersion {
                assertion_id: uuid(id),
                revision: 1,
                payload_sha256: hash.clone(),
            },
            previous: None,
            target: m::SemanticTarget {
                scope: scope.clone(),
                namespace: m::SemanticNamespace::ProducerPublication {
                    publication_id: uuid(803),
                },
                building_id: "generated-building".into(),
                room_id: uuid(804),
                floor_id: "generated-level".into(),
                occurrence_id: "generated-occurrence".into(),
                feature: m::SemanticFeature::Room,
            },
            property: m::MeasurementProperty::OccurrenceArea,
            value: m::ExactQuantity {
                entered: m::DecimalToken::parse(token).unwrap(),
                unit,
                kind: m::QuantityKind::Area,
            },
            entered_against: m::ModelPin {
                scope,
                building_id: "generated-building".into(),
                publication_id: uuid(803),
                artifact_id: "model".into(),
                artifact_sha256: hash.clone(),
                artifact_bytes: 128,
                lineage: m::ModelLineage::UnifiedAtlasPublication {
                    source_revision_id: "generated-revision".into(),
                    source_sha256: hash.clone(),
                    semantics_sha256: hash.clone(),
                    overview_manifest_sha256: hash.clone(),
                    selection_revision: hash.clone(),
                },
                custody: m::ModelCustody::Unknown,
                physical_registration: m::PhysicalRegistration::Unknown,
            },
            target_feature_sha256: hash,
            method: m::MeasurementMethod::Estimated,
            support: m::MeasurementSupport {
                corroboration: m::Corroboration::NotEstablished,
                uncertainties: vec![crate::contracts::v2::Uncertainty {
                    status: crate::contracts::v2::UncertaintyStatus::Inferred,
                    explanation: Some("Generated estimate only".into()),
                }],
                limitations: vec![m::SupportLimitation::Estimated],
            },
            inputs: vec![],
            operation: None,
            evidence: vec![],
            supersedes: vec![],
            contradicts: vec![],
            resolutions: vec![],
            review: m::ClaimReview::NoKnownIssue,
            change_reason: "Generated implicit-value review case".into(),
            native_audit_id: uuid(id + 100),
        }
    }
    #[test]
    fn later_unlinked_unequal_claim_requires_review_before_missing_model() {
        let a = area_claim(810, "12.5000", m::Unit::SquareMetre);
        let b = area_claim(811, "13", m::Unit::SquareMetre);
        let original = a.clone();
        let all = vec![a.clone(), b.clone()];
        let projected = current_value_review(
            &a,
            online::CurrentClosure::CompleteAtReadPoint {
                read_point: online::ReadPoint {
                    marker: "generated-fresh-value-cut".into(),
                },
                assertions: &all,
            },
        )
        .unwrap();
        assert_eq!(projected["status"], "review-required");
        assert_eq!(
            projected["conflictingAssertions"][0]["assertionId"],
            b.version.assertion_id
        );
        assert!(a.contradicts.is_empty() && b.contradicts.is_empty());
        assert_eq!(a, original);
    }
    #[test]
    fn unit_equivalence_is_exact_and_unavailable_cut_is_not_consistency() {
        let a = area_claim(810, "0012.5000", m::Unit::SquareMetre);
        let b = area_claim(811, "125000", m::Unit::SquareCentimetre);
        let all = vec![a.clone(), b];
        let projected = current_value_review(
            &a,
            online::CurrentClosure::CompleteAtReadPoint {
                read_point: online::ReadPoint {
                    marker: "generated-equivalent-value-cut".into(),
                },
                assertions: &all,
            },
        )
        .unwrap();
        assert_eq!(projected["status"], "no-unequal-active-assertions");
        assert_eq!(a.value.entered.token(), "0012.5000");
        assert!(current_value_review(&a, online::CurrentClosure::Unavailable).is_err());
    }
}
