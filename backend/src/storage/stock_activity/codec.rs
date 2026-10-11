//! Private AT07 storage codec for retained HomeBox stock activity facts.
//! These rows reconstruct data only. Loading them never reissues access,
//! source, physical route, dispatch, approval, or readback authority.
use crate::{
    providers::homebox::write::stock as homebox,
    storage::{Error, Result},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

const VERSION: u8 = 1;
fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Stored HomeBox activity codec is incompatible",
    )
}
fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| incompatible())
}
fn decode<T: DeserializeOwned + Serialize>(json: &str) -> Result<T> {
    let value: T = serde_json::from_str(json).map_err(|_| incompatible())?;
    // Deterministic lossless JSON preserves original Value number tokens.
    // Reencoding rejects duplicate keys, skipped fields and aliases.
    if encode(&value)? != json {
        return Err(incompatible());
    }
    Ok(value)
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope<T> {
    codec_version: u8,
    payload: T,
}
fn put<T: Serialize + DeserializeOwned + PartialEq>(payload: T) -> Result<String> {
    let envelope = Envelope {
        codec_version: VERSION,
        payload,
    };
    let json = encode(&envelope)?;
    // Refuse an encoding that changes any retained typed or original field.
    let roundtrip: Envelope<T> = decode(&json)?;
    if roundtrip != envelope {
        return Err(incompatible());
    }
    Ok(json)
}
fn get<T: DeserializeOwned + Serialize>(json: &str) -> Result<T> {
    let envelope: Envelope<T> = decode(json)?;
    if envelope.codec_version != VERSION {
        return Err(incompatible());
    }
    Ok(envelope.payload)
}

/// DATA encoding through the same lossless retained activity wrappers.
/// No authority, source handle or historical qualifier is reconstructed.
pub(crate) fn encode_original_authority(
    value: &homebox::StockAuthority,
) -> Result<serde_json::Value> {
    serde_json::from_str(&put(AuthorityRow::from(value))?).map_err(|_| incompatible())
}

/// DATA encoding only; preserves existing decimal and snapshot semantics.
pub(crate) fn encode_original_preflight(
    value: &homebox::StockPreflight,
) -> Result<serde_json::Value> {
    serde_json::from_str(&put(PreflightRow::from(value))?).map_err(|_| incompatible())
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PhysicalBindingRow {
    deployment_id: Uuid,
    physical_database_id: Uuid,
    configuration_digest: homebox::Digest,
}
impl From<&homebox::PhysicalBinding> for PhysicalBindingRow {
    fn from(value: &homebox::PhysicalBinding) -> Self {
        Self {
            deployment_id: value.deployment_id,
            physical_database_id: value.physical_database_id,
            configuration_digest: value.configuration_digest.clone(),
        }
    }
}
impl From<PhysicalBindingRow> for homebox::PhysicalBinding {
    fn from(value: PhysicalBindingRow) -> Self {
        Self {
            deployment_id: value.deployment_id,
            physical_database_id: value.physical_database_id,
            configuration_digest: value.configuration_digest,
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum QualificationRow {
    SyntheticFixture,
    Qualified {
        catalog_digest: homebox::Digest,
        registered_build_digest: homebox::Digest,
        route_qualification_digest: homebox::Digest,
    },
}
impl From<&homebox::NativeQualification> for QualificationRow {
    fn from(value: &homebox::NativeQualification) -> Self {
        match value {
            homebox::NativeQualification::SyntheticFixture => Self::SyntheticFixture,
            homebox::NativeQualification::Qualified {
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            } => Self::Qualified {
                catalog_digest: catalog_digest.clone(),
                registered_build_digest: registered_build_digest.clone(),
                route_qualification_digest: route_qualification_digest.clone(),
            },
        }
    }
}
impl From<QualificationRow> for homebox::NativeQualification {
    fn from(value: QualificationRow) -> Self {
        match value {
            QualificationRow::SyntheticFixture => Self::SyntheticFixture,
            QualificationRow::Qualified {
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            } => Self::Qualified {
                catalog_digest,
                registered_build_digest,
                route_qualification_digest,
            },
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityRow {
    actor_id: Uuid,
    #[serde(with = "decimal")]
    source_epoch: u64,
    authority_digest: homebox::Digest,
    physical_binding: PhysicalBindingRow,
    qualification: QualificationRow,
}
impl From<&homebox::StockAuthority> for AuthorityRow {
    fn from(value: &homebox::StockAuthority) -> Self {
        Self {
            actor_id: value.actor_id,
            source_epoch: value.source_epoch,
            authority_digest: value.authority_digest.clone(),
            physical_binding: (&value.physical_binding).into(),
            qualification: (&value.qualification).into(),
        }
    }
}
impl From<AuthorityRow> for homebox::StockAuthority {
    fn from(value: AuthorityRow) -> Self {
        Self {
            actor_id: value.actor_id,
            source_epoch: value.source_epoch,
            authority_digest: value.authority_digest,
            physical_binding: value.physical_binding.into(),
            qualification: value.qualification.into(),
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationRow {
    actor_id: Uuid,
    captured_authority: AuthorityRow,
    operation_id: Uuid,
    #[serde(with = "decimal")]
    activity_version: u64,
    command: homebox::StockCommand,
    plan: Option<homebox::NativePlan>,
    actual_target: Option<homebox::StockTarget>,
    generated_members: Vec<(String, Vec<Uuid>)>,
    outcome: homebox::StockOutcome,
}
impl From<&homebox::StoredOperation> for OperationRow {
    fn from(value: &homebox::StoredOperation) -> Self {
        Self {
            actor_id: value.actor_id,
            captured_authority: (&value.captured_authority).into(),
            operation_id: value.operation_id,
            activity_version: value.activity_version,
            command: value.command.clone(),
            plan: value.plan.clone(),
            actual_target: value.actual_target.clone(),
            generated_members: value.generated_members.clone(),
            outcome: value.outcome.clone(),
        }
    }
}
impl From<OperationRow> for homebox::StoredOperation {
    fn from(value: OperationRow) -> Self {
        Self {
            actor_id: value.actor_id,
            captured_authority: value.captured_authority.into(),
            operation_id: value.operation_id,
            activity_version: value.activity_version,
            command: value.command,
            plan: value.plan,
            actual_target: value.actual_target,
            generated_members: value.generated_members,
            outcome: value.outcome,
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermitRow {
    operation_id: Uuid,
    actor_id: Uuid,
    physical_binding: PhysicalBindingRow,
    owner_id: Uuid,
    #[serde(with = "decimal")]
    dispatcher_epoch: u64,
    #[serde(with = "decimal")]
    source_epoch: u64,
    plan_digest: homebox::Digest,
    qualification: QualificationRow,
}
impl From<&homebox::InvocationPermit> for PermitRow {
    fn from(value: &homebox::InvocationPermit) -> Self {
        Self {
            operation_id: value.operation_id,
            actor_id: value.actor_id,
            physical_binding: (&value.physical_binding).into(),
            owner_id: value.owner_id,
            dispatcher_epoch: value.dispatcher_epoch,
            source_epoch: value.source_epoch,
            plan_digest: value.plan_digest.clone(),
            qualification: (&value.qualification).into(),
        }
    }
}
impl From<PermitRow> for homebox::InvocationPermit {
    fn from(value: PermitRow) -> Self {
        Self {
            operation_id: value.operation_id,
            actor_id: value.actor_id,
            physical_binding: value.physical_binding.into(),
            owner_id: value.owner_id,
            dispatcher_epoch: value.dispatcher_epoch,
            source_epoch: value.source_epoch,
            plan_digest: value.plan_digest,
            qualification: value.qualification.into(),
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DispatchRow {
    response_success: bool,
    response_digest: Option<homebox::Digest>,
    generated_target: Option<homebox::StockTarget>,
    generated_identity_resolved: bool,
    generated_members: Vec<(String, Vec<Uuid>)>,
    remote_activity: homebox::RemoteActivity,
}
impl From<&homebox::DispatchFacts> for DispatchRow {
    fn from(value: &homebox::DispatchFacts) -> Self {
        Self {
            response_success: value.response_success,
            response_digest: value.response_digest.clone(),
            generated_target: value.generated_target.clone(),
            generated_identity_resolved: value.generated_identity_resolved,
            generated_members: value.generated_members.clone(),
            remote_activity: value.remote_activity.clone(),
        }
    }
}
impl From<DispatchRow> for homebox::DispatchFacts {
    fn from(value: DispatchRow) -> Self {
        Self {
            response_success: value.response_success,
            response_digest: value.response_digest,
            generated_target: value.generated_target,
            generated_identity_resolved: value.generated_identity_resolved,
            generated_members: value.generated_members,
            remote_activity: value.remote_activity,
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ObservationRow {
    readback_digest: homebox::Digest,
    agrees: bool,
    known_effects: Vec<homebox::EffectEvidence>,
    generated_identity_resolved: bool,
    observed_at: String,
    impact_evidence_digest: Option<homebox::Digest>,
}
impl From<&homebox::ObservationFacts> for ObservationRow {
    fn from(value: &homebox::ObservationFacts) -> Self {
        Self {
            readback_digest: value.readback_digest.clone(),
            agrees: value.agrees,
            known_effects: value.known_effects.clone(),
            generated_identity_resolved: value.generated_identity_resolved,
            observed_at: value.observed_at.clone(),
            impact_evidence_digest: value.impact_evidence_digest.clone(),
        }
    }
}
impl From<ObservationRow> for homebox::ObservationFacts {
    fn from(value: ObservationRow) -> Self {
        Self {
            readback_digest: value.readback_digest,
            agrees: value.agrees,
            known_effects: value.known_effects,
            generated_identity_resolved: value.generated_identity_resolved,
            observed_at: value.observed_at,
            impact_evidence_digest: value.impact_evidence_digest,
        }
    }
}

pub(super) fn encode_operation(value: &homebox::StoredOperation) -> Result<String> {
    put(OperationRow::from(value))
}
pub(super) fn decode_operation(json: &str) -> Result<homebox::StoredOperation> {
    get::<OperationRow>(json).map(Into::into)
}
pub(super) fn encode_permit(value: &homebox::InvocationPermit) -> Result<String> {
    put(PermitRow::from(value))
}
pub(super) fn decode_permit(json: &str) -> Result<homebox::InvocationPermit> {
    get::<PermitRow>(json).map(Into::into)
}
pub(super) fn encode_dispatch(value: &homebox::DispatchFacts) -> Result<String> {
    put(DispatchRow::from(value))
}
pub(super) fn decode_dispatch(json: &str) -> Result<homebox::DispatchFacts> {
    get::<DispatchRow>(json).map(Into::into)
}
pub(super) fn encode_observation(value: &homebox::ObservationFacts) -> Result<String> {
    put(ObservationRow::from(value))
}
pub(super) fn decode_observation(json: &str) -> Result<homebox::ObservationFacts> {
    get::<ObservationRow>(json).map(Into::into)
}

mod decimal {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        let text = String::deserialize(deserializer)?;
        let value = text.parse::<u64>().map_err(serde::de::Error::custom)?;
        if value.to_string() != text {
            return Err(serde::de::Error::custom("noncanonical counter"));
        }
        Ok(value)
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdmissionRow {
    permit: PermitRow,
    preflight: PreflightRow,
    evidence: super::StockActivityAdmissionEvidence,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreflightRow {
    provider_observation: Uuid,
    request_digest: homebox::Digest,
    #[serde(with = "decimal")]
    source_epoch: u64,
    preflight_digest: homebox::Digest,
    snapshots: Vec<SnapshotRow>,
    staged_upload: Option<homebox::StagedUpload>,
    native_clear_values: Vec<ClearRow>,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotRow {
    target: homebox::StockTarget,
    value: serde_json::Value,
    digest: homebox::Digest,
    complete: bool,
    hidden_fields_preserved: bool,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClearRow {
    command_id: String,
    field: String,
    native_value: serde_json::Value,
    native_readback_value: serde_json::Value,
}
impl From<&homebox::StockPreflight> for PreflightRow {
    fn from(v: &homebox::StockPreflight) -> Self {
        Self {
            provider_observation: v.provider_observation,
            request_digest: v.request_digest.clone(),
            source_epoch: v.source_epoch,
            preflight_digest: v.preflight_digest.clone(),
            staged_upload: v.preparation.staged_upload.clone(),
            snapshots: v
                .preparation
                .snapshots
                .iter()
                .map(|s| SnapshotRow {
                    target: s.target.clone(),
                    value: s.value.clone(),
                    digest: s.digest.clone(),
                    complete: s.complete,
                    hidden_fields_preserved: s.hidden_fields_preserved,
                })
                .collect(),
            native_clear_values: v
                .preparation
                .native_clear_values
                .iter()
                .map(|c| ClearRow {
                    command_id: c.command_id.clone(),
                    field: c.field.clone(),
                    native_value: c.native_value.clone(),
                    native_readback_value: c.native_readback_value.clone(),
                })
                .collect(),
        }
    }
}
impl From<PreflightRow> for homebox::StockPreflight {
    fn from(v: PreflightRow) -> Self {
        Self {
            provider_observation: v.provider_observation,
            request_digest: v.request_digest,
            source_epoch: v.source_epoch,
            preflight_digest: v.preflight_digest,
            preparation: homebox::Preparation {
                staged_upload: v.staged_upload,
                snapshots: v
                    .snapshots
                    .into_iter()
                    .map(|s| homebox::NativeSnapshot {
                        target: s.target,
                        value: s.value,
                        digest: s.digest,
                        complete: s.complete,
                        hidden_fields_preserved: s.hidden_fields_preserved,
                    })
                    .collect(),
                native_clear_values: v
                    .native_clear_values
                    .into_iter()
                    .map(|c| homebox::NativeClear {
                        command_id: c.command_id,
                        field: c.field,
                        native_value: c.native_value,
                        native_readback_value: c.native_readback_value,
                    })
                    .collect(),
            },
        }
    }
}
pub(super) fn encode_admission(
    permit: &homebox::InvocationPermit,
    preflight: &homebox::StockPreflight,
    evidence: &super::StockActivityAdmissionEvidence,
) -> Result<String> {
    put(AdmissionRow {
        permit: permit.into(),
        preflight: preflight.into(),
        evidence: evidence.clone(),
    })
}
pub(super) fn decode_admission(
    json: &str,
) -> Result<(
    homebox::InvocationPermit,
    homebox::StockPreflight,
    super::StockActivityAdmissionEvidence,
)> {
    let row: AdmissionRow = get(json)?;
    Ok((row.permit.into(), row.preflight.into(), row.evidence))
}
