//! Closed original-owner archive wire data; these rows are never grants.
use super::{activity_capture::*, incompatible, unavailable};
use crate::{providers::homebox::write::stock as n, storage as s};
use s::retained_native_codec_bridge as peer;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PacketRow {
    pub format: String,
    pub writer_commit: String,
    pub storage_commit: String,
    pub registration: RegistrationRow,
    pub original: String,
    pub operation: String,
    pub permit: Option<String>,
    pub body_accepted: bool,
    pub physical_hold: bool,
    pub events: Vec<EventRow>,
    pub native: Vec<NativeRow>,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PhysicalRow {
    deployment_id: Uuid,
    physical_database_id: Uuid,
    configuration_digest: n::Digest,
}
impl From<&n::PhysicalBinding> for PhysicalRow {
    fn from(v: &n::PhysicalBinding) -> Self {
        Self {
            deployment_id: v.deployment_id,
            physical_database_id: v.physical_database_id,
            configuration_digest: v.configuration_digest.clone(),
        }
    }
}
impl From<PhysicalRow> for n::PhysicalBinding {
    fn from(v: PhysicalRow) -> Self {
        Self {
            deployment_id: v.deployment_id,
            physical_database_id: v.physical_database_id,
            configuration_digest: v.configuration_digest,
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum QualificationRow {
    SyntheticFixture,
    Qualified {
        catalog_digest: n::Digest,
        registered_build_digest: n::Digest,
        route_qualification_digest: n::Digest,
    },
}
impl From<&n::NativeQualification> for QualificationRow {
    fn from(v: &n::NativeQualification) -> Self {
        match v {
            n::NativeQualification::SyntheticFixture => Self::SyntheticFixture,
            n::NativeQualification::Qualified {
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
impl From<QualificationRow> for n::NativeQualification {
    fn from(v: QualificationRow) -> Self {
        match v {
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
pub(super) struct RegistrationRow {
    physical_binding: PhysicalRow,
    owner_id: Uuid,
    #[serde(with = "decimal")]
    dispatcher_epoch: u64,
    #[serde(with = "decimal")]
    source_epoch: u64,
    qualification: QualificationRow,
}
impl From<&s::StockActivityRegistration> for RegistrationRow {
    fn from(v: &s::StockActivityRegistration) -> Self {
        Self {
            physical_binding: (&v.physical_binding).into(),
            owner_id: v.owner_id,
            dispatcher_epoch: v.dispatcher_epoch,
            source_epoch: v.source_epoch,
            qualification: (&v.qualification).into(),
        }
    }
}
impl From<RegistrationRow> for s::StockActivityRegistration {
    fn from(v: RegistrationRow) -> Self {
        Self {
            physical_binding: v.physical_binding.into(),
            owner_id: v.owner_id,
            dispatcher_epoch: v.dispatcher_epoch,
            source_epoch: v.source_epoch,
            qualification: v.qualification.into(),
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AuthorityRow {
    actor_id: Uuid,
    #[serde(with = "decimal")]
    source_epoch: u64,
    authority_digest: n::Digest,
    physical_binding: PhysicalRow,
    qualification: QualificationRow,
}
impl From<&n::StockAuthority> for AuthorityRow {
    fn from(v: &n::StockAuthority) -> Self {
        Self {
            actor_id: v.actor_id,
            source_epoch: v.source_epoch,
            authority_digest: v.authority_digest.clone(),
            physical_binding: (&v.physical_binding).into(),
            qualification: (&v.qualification).into(),
        }
    }
}
impl From<AuthorityRow> for n::StockAuthority {
    fn from(v: AuthorityRow) -> Self {
        Self {
            actor_id: v.actor_id,
            source_epoch: v.source_epoch,
            authority_digest: v.authority_digest,
            physical_binding: v.physical_binding.into(),
            qualification: v.qualification.into(),
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EventRow {
    #[serde(with = "decimal")]
    pub sequence: u64,
    pub operation: String,
    pub facts: FactRow,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "kebab-case",
    deny_unknown_fields
)]
pub(super) enum FactRow {
    Reserve,
    Queued,
    Admit(String),
    NeverInvoked,
    Dispatch(String),
    Observation(String),
}
impl FactRow {
    pub fn encode(v: &s::StockActivityEventFacts) -> s::Result<Self> {
        Ok(match v {
            s::StockActivityEventFacts::Reserve => Self::Reserve,
            s::StockActivityEventFacts::Queued => Self::Queued,
            s::StockActivityEventFacts::Admit(v) => Self::Admit(peer::encode_admission(v)?),
            s::StockActivityEventFacts::NeverInvoked => Self::NeverInvoked,
            s::StockActivityEventFacts::Dispatch(v) => Self::Dispatch(peer::encode_dispatch(v)?),
            s::StockActivityEventFacts::Observation(v) => {
                Self::Observation(peer::encode_observation(v)?)
            }
            s::StockActivityEventFacts::Reject(_) => return Err(super::unavailable()),
        })
    }
    pub fn decode(self) -> s::Result<s::StockActivityEventFacts> {
        Ok(match self {
            Self::Reserve => s::StockActivityEventFacts::Reserve,
            Self::Queued => s::StockActivityEventFacts::Queued,
            Self::Admit(v) => {
                s::StockActivityEventFacts::Admit(Box::new(peer::decode_admission(&v)?))
            }
            Self::NeverInvoked => s::StockActivityEventFacts::NeverInvoked,
            Self::Dispatch(v) => s::StockActivityEventFacts::Dispatch(peer::decode_dispatch(&v)?),
            Self::Observation(v) => {
                s::StockActivityEventFacts::Observation(peer::decode_observation(&v)?)
            }
        })
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NativeRow {
    #[serde(with = "decimal")]
    pub sequence: u64,
    pub before: String,
    pub raw: RawRow,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum RawRow {
    Dispatch {
        permit: String,
        plan: Box<n::NativePlan>,
        authority: AuthorityRow,
        result: DispatchRow,
    },
    Observation {
        plan: n::ReadbackPlan,
        authority: AuthorityRow,
        result: ObservationRow,
    },
}
impl NativeRow {
    pub fn encode(v: &RetainedStockNativeEvent) -> s::Result<Self> {
        let raw = match &v.raw {
            RawNativeCut::Dispatch {
                permit,
                plan,
                authority,
                result,
            } => RawRow::Dispatch {
                permit: peer::encode_permit(permit)?,
                plan: plan.clone(),
                authority: authority.into(),
                result: DispatchRow::try_from(result)?,
            },
            RawNativeCut::Observation {
                plan,
                authority,
                result,
            } => RawRow::Observation {
                plan: plan.clone(),
                authority: authority.into(),
                result: result.into(),
            },
        };
        Ok(Self {
            sequence: v.sequence,
            before: peer::encode_operation(&v.before)?,
            raw,
        })
    }
    pub fn decode(self) -> s::Result<RetainedStockNativeEvent> {
        let raw = match self.raw {
            RawRow::Dispatch {
                permit,
                plan,
                authority,
                result,
            } => RawNativeCut::Dispatch {
                permit: peer::decode_permit(&permit)?,
                plan,
                authority: authority.into(),
                result: result.into(),
            },
            RawRow::Observation {
                plan,
                authority,
                result,
            } => RawNativeCut::Observation {
                plan,
                authority: authority.into(),
                result: result.into(),
            },
        };
        Ok(RetainedStockNativeEvent {
            sequence: self.sequence,
            before: peer::decode_operation(&self.before)?,
            raw,
        })
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    content = "receipt",
    rename_all = "kebab-case",
    deny_unknown_fields
)]
pub(super) enum DispatchRow {
    NeverInvoked,
    Invoked(ReceiptRow),
}
impl TryFrom<&n::NativeDispatch> for DispatchRow {
    type Error = s::Error;
    fn try_from(v: &n::NativeDispatch) -> s::Result<Self> {
        match v {
            n::NativeDispatch::Unavailable => Err(unavailable()),
            n::NativeDispatch::NeverInvoked => Ok(Self::NeverInvoked),
            n::NativeDispatch::Invoked(v) => Ok(Self::Invoked(v.into())),
        }
    }
}
impl From<DispatchRow> for n::NativeDispatch {
    fn from(v: DispatchRow) -> Self {
        match v {
            DispatchRow::NeverInvoked => Self::NeverInvoked,
            DispatchRow::Invoked(v) => Self::Invoked(v.into()),
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReceiptRow {
    operation_id: Uuid,
    plan_digest: n::Digest,
    context: n::Context,
    source_instance_id: Uuid,
    collection_id: Uuid,
    response: Option<ResponseRow>,
    remote_activity: n::RemoteActivity,
}
impl From<&n::DispatchReceipt> for ReceiptRow {
    fn from(v: &n::DispatchReceipt) -> Self {
        Self {
            operation_id: v.operation_id,
            plan_digest: v.plan_digest.clone(),
            context: v.context.clone(),
            source_instance_id: v.source_instance_id,
            collection_id: v.collection_id,
            response: v.response.as_ref().map(|r| ResponseRow {
                status: r.status,
                value: r.value.clone(),
                body_digest: r.body_digest.clone(),
            }),
            remote_activity: v.remote_activity.clone(),
        }
    }
}
impl From<ReceiptRow> for n::DispatchReceipt {
    fn from(v: ReceiptRow) -> Self {
        Self {
            operation_id: v.operation_id,
            plan_digest: v.plan_digest,
            context: v.context,
            source_instance_id: v.source_instance_id,
            collection_id: v.collection_id,
            response: v.response.map(|r| n::NativeResponse {
                status: r.status,
                value: r.value,
                body_digest: r.body_digest,
            }),
            remote_activity: v.remote_activity,
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ResponseRow {
    status: u16,
    value: serde_json::Value,
    body_digest: n::Digest,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ImpactRow {
    effects: Vec<n::EffectEvidence>,
    complete: bool,
    evidence_digest: n::Digest,
}
impl From<&n::ImpactObservation> for ImpactRow {
    fn from(v: &n::ImpactObservation) -> Self {
        Self {
            effects: v.effects.clone(),
            complete: v.complete,
            evidence_digest: v.evidence_digest.clone(),
        }
    }
}
impl From<ImpactRow> for n::ImpactObservation {
    fn from(v: ImpactRow) -> Self {
        Self {
            effects: v.effects,
            complete: v.complete,
            evidence_digest: v.evidence_digest,
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum ObservationRow {
    Present {
        context: n::Context,
        target: n::StockTarget,
        value: serde_json::Value,
        observed_at: String,
        complete: bool,
        impact: Option<ImpactRow>,
    },
    Absent {
        context: n::Context,
        target: n::StockTarget,
        evidence_digest: n::Digest,
        observed_at: String,
        impact: Option<ImpactRow>,
    },
    Effects {
        context: n::Context,
        source_instance_id: Uuid,
        collection_id: Uuid,
        effects: Vec<n::EffectEvidence>,
        complete: bool,
        evidence_digest: n::Digest,
        observed_at: String,
    },
    Unavailable,
}
impl From<&n::NativeObservation> for ObservationRow {
    fn from(v: &n::NativeObservation) -> Self {
        match v {
            n::NativeObservation::Present {
                context,
                target,
                value,
                observed_at,
                complete,
                impact,
            } => Self::Present {
                context: context.clone(),
                target: target.clone(),
                value: value.clone(),
                observed_at: observed_at.clone(),
                complete: *complete,
                impact: impact.as_ref().map(Into::into),
            },
            n::NativeObservation::Absent {
                context,
                target,
                evidence_digest,
                observed_at,
                impact,
            } => Self::Absent {
                context: context.clone(),
                target: target.clone(),
                evidence_digest: evidence_digest.clone(),
                observed_at: observed_at.clone(),
                impact: impact.as_ref().map(Into::into),
            },
            n::NativeObservation::Effects {
                context,
                source_instance_id,
                collection_id,
                effects,
                complete,
                evidence_digest,
                observed_at,
            } => Self::Effects {
                context: context.clone(),
                source_instance_id: *source_instance_id,
                collection_id: *collection_id,
                effects: effects.clone(),
                complete: *complete,
                evidence_digest: evidence_digest.clone(),
                observed_at: observed_at.clone(),
            },
            n::NativeObservation::Unavailable => Self::Unavailable,
        }
    }
}
impl From<ObservationRow> for n::NativeObservation {
    fn from(v: ObservationRow) -> Self {
        match v {
            ObservationRow::Present {
                context,
                target,
                value,
                observed_at,
                complete,
                impact,
            } => Self::Present {
                context,
                target,
                value,
                observed_at,
                complete,
                impact: impact.map(Into::into),
            },
            ObservationRow::Absent {
                context,
                target,
                evidence_digest,
                observed_at,
                impact,
            } => Self::Absent {
                context,
                target,
                evidence_digest,
                observed_at,
                impact: impact.map(Into::into),
            },
            ObservationRow::Effects {
                context,
                source_instance_id,
                collection_id,
                effects,
                complete,
                evidence_digest,
                observed_at,
            } => Self::Effects {
                context,
                source_instance_id,
                collection_id,
                effects,
                complete,
                evidence_digest,
                observed_at,
            },
            ObservationRow::Unavailable => Self::Unavailable,
        }
    }
}
mod decimal {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let text = String::deserialize(d)?;
        let value = text.parse::<u64>().map_err(serde::de::Error::custom)?;
        if value.to_string() != text {
            return Err(serde::de::Error::custom("noncanonical archive counter"));
        }
        Ok(value)
    }
}
pub(super) fn parse(bytes: &[u8]) -> s::Result<PacketRow> {
    let value: PacketRow = serde_json::from_slice(bytes).map_err(|_| incompatible())?;
    if serde_json::to_vec(&value).map_err(|_| incompatible())? != bytes {
        return Err(incompatible());
    }
    Ok(value)
}
