//! Native mapping seams. AT51 owns wire3 validation and canonical intent hashing.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

pub const CONTRACT_VERSION: &str = "0.3.0-at34.stock.2";
pub const NATIVE_SOURCE_COMMIT: &str = "e01dd737238a3fa7e1a6454b37de6c6fc88c86e4";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind {
    Entity,
    Tag,
    Field,
    Attachment,
    Maintenance,
    EntityType,
    Template,
    Collection,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockTarget {
    pub source_instance_id: Uuid,
    pub collection_id: Uuid,
    pub resource_kind: ResourceKind,
    pub resource_id: Option<Uuid>,
    pub entity_id: Option<Uuid>,
}

impl StockTarget {
    pub fn id(&self) -> Result<Uuid, StockMappingError> {
        self.resource_id
            .ok_or(StockMappingError::InvalidNativeInput)
    }
    pub fn owner(&self) -> Result<Uuid, StockMappingError> {
        self.entity_id.ok_or(StockMappingError::InvalidNativeInput)
    }
    pub fn owner_target(&self) -> Result<Self, StockMappingError> {
        Ok(Self {
            resource_kind: ResourceKind::Entity,
            resource_id: Some(self.owner()?),
            entity_id: None,
            ..self.clone()
        })
    }
    pub fn same_partition(&self, other: &Self) -> bool {
        self.source_instance_id == other.source_instance_id
            && self.collection_id == other.collection_id
    }
}

/// Produced only after AT51 validates the exact closed request schema and
/// computes the accepted immutable intent digest. Payload stays the original
/// schema-validated JSON to avoid a second owner of wire3 domain rules.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockCommand {
    pub command_id: String,
    pub request_id: Uuid,
    pub idempotency_key: Uuid,
    pub context: Context,
    pub target: StockTarget,
    pub payload: Value,
    pub native_sync_behavior: Option<bool>,
    pub provider_observation: Uuid,
    pub approval_receipt_id: Option<Uuid>,
    pub original_wire: Value,
    pub request_digest: Digest,
}

/// Lowercase SHA-256 supplied by the shared canonicalization owner, not by
/// arbitrary upstream response fields. This module does not invent a digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Digest(String);
impl Digest {
    pub fn parse(value: String) -> Result<Self, StockMappingError> {
        if value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            Ok(Self(value))
        } else {
            Err(StockMappingError::InvalidNativeInput)
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for Digest {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value).map_err(|_| "invalid lowercase SHA-256")
    }
}
impl From<Digest> for String {
    fn from(value: Digest) -> Self {
        value.0
    }
}

/// Exact scoped, complete native object from the preparation peer. A cached
/// projection or provider omission cannot establish completeness. The peer
/// validates the source/observation, full native schema and raw source dates.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeSnapshot {
    pub target: StockTarget,
    pub value: Value,
    pub digest: Digest,
    pub complete: bool,
    /// Evidence that fields hidden by the native output schema will not be lost.
    pub hidden_fields_preserved: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Preparation {
    pub snapshots: Vec<NativeSnapshot>,
    /// Qualified stage metadata only; bytes remain outside the waiting intent.
    pub staged_upload: Option<StagedUpload>,
    /// Exact registered-build route qualification, never caller-controlled.
    /// Only used for a wire-null clear whose native decoder semantics require
    /// a qualified representation. Does not establish CAS or erase races.
    pub native_clear_values: Vec<NativeClear>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeClear {
    pub command_id: String,
    pub field: String,
    pub native_value: Value,
    /// Exact qualified native readback representation; input/output date
    /// spellings may differ. Never substitute one for the other by inference.
    pub native_readback_value: Value,
}
impl Preparation {
    pub fn snapshot(&self, target: &StockTarget) -> Result<&NativeSnapshot, StockMappingError> {
        let mut matching = self
            .snapshots
            .iter()
            .filter(|snapshot| &snapshot.target == target);
        let snapshot = matching
            .next()
            .ok_or(StockMappingError::CompleteNativeObservationRequired)?;
        // Do not choose an observation by vector order or discard a competing
        // incomplete capture. Fresh decoding also checks uniqueness, but other
        // preparation ports reach the shared mapper through this boundary.
        if matching.next().is_some() {
            return Err(StockMappingError::ObservationConflict);
        }
        if !snapshot.complete {
            return Err(StockMappingError::CompleteNativeObservationRequired);
        }
        Ok(snapshot)
    }
    pub fn clear(&self, command_id: &str, field: &str) -> Result<&Value, StockMappingError> {
        let mut found = self
            .native_clear_values
            .iter()
            .filter(|v| v.command_id == command_id && v.field == field);
        let value = found.next().ok_or(StockMappingError::NativeLimitation(
            "native clear requires exact registered-build route qualification",
        ))?;
        if found.next().is_some() {
            return Err(StockMappingError::InvalidNativeInput);
        }
        Ok(&value.native_value)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedUpload {
    pub upload_token: Uuid,
    pub sha256: Digest,
    pub byte_size: u64,
    pub content_type: String,
    pub filename: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum NativeMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeBody {
    None,
    Json(Value),
    Multipart {
        file_field: String,
        stage: StagedUpload,
        fields: Vec<(String, String)>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeRequest {
    pub method: NativeMethod,
    /// Constructed only from fixed native routes and canonical IDs.
    pub path: String,
    pub query: Vec<(String, String)>,
    pub body: NativeBody,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResponseKind {
    Entity,
    Tag,
    Maintenance,
    EntityType,
    Template,
    NoContent,
    Bulk,
    Printer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReadbackSelector {
    Whole,
    RootList,
    Member { field: String },
    CompleteImpact,
    Printer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadbackPlan {
    /// Internal {generatedId} placeholder is resolved only with qualified ID.
    pub path: String,
    pub query: Vec<(String, String)>,
    pub target: StockTarget,
    pub selector: ReadbackSelector,
    /// Native writable-value subset; no local impact/approval fields sent.
    pub expected: Value,
    pub absence: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeneratedIdentity {
    None,
    DirectResponse,
    /// Requires exact scoped response delta AND subsequent exact readback.
    EntityMember {
        field: String,
        before_ids: Vec<Uuid>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativePlan {
    pub request: NativeRequest,
    pub response: ResponseKind,
    pub success_status: u16,
    /// Local response bound, never an invented native query parameter.
    pub max_response_bytes: Option<u64>,
    pub readback: ReadbackPlan,
    pub generated: GeneratedIdentity,
    pub requires_complete_impact: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StockMappingError {
    UnsupportedOperation,
    NativeLimitation(&'static str),
    InvalidNativeInput,
    CompleteNativeObservationRequired,
    ObservationConflict,
    StageMismatch,
}

pub(super) fn object(value: &Value) -> Result<&Map<String, Value>, StockMappingError> {
    value
        .as_object()
        .ok_or(StockMappingError::InvalidNativeInput)
}
pub(super) fn required<'a>(value: &'a Value, key: &str) -> Result<&'a Value, StockMappingError> {
    object(value)?
        .get(key)
        .ok_or(StockMappingError::InvalidNativeInput)
}
pub(super) fn uuid(value: &Value) -> Result<Uuid, StockMappingError> {
    value
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StockMappingError::InvalidNativeInput)
}
pub(super) fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, StockMappingError> {
    required(value, key)?
        .as_str()
        .ok_or(StockMappingError::InvalidNativeInput)
}
pub(super) fn copy_fields(
    value: &Value,
    fields: &[&str],
) -> Result<Map<String, Value>, StockMappingError> {
    let source = object(value)?;
    Ok(fields
        .iter()
        .filter_map(|k| source.get(*k).map(|v| ((*k).to_owned(), v.clone())))
        .collect())
}
pub(super) fn plan(
    command: &StockCommand,
    method: NativeMethod,
    path: String,
    body: NativeBody,
    response: ResponseKind,
    readback: ReadbackPlan,
    generated: GeneratedIdentity,
) -> NativePlan {
    let success_status = if response == ResponseKind::NoContent {
        204
    } else if method == NativeMethod::Post && !matches!(response, ResponseKind::Bulk) {
        201
    } else {
        200
    };
    NativePlan {
        request: NativeRequest {
            method,
            path,
            query: vec![],
            body,
        },
        response,
        success_status,
        max_response_bytes: None,
        readback,
        generated,
        requires_complete_impact: command.payload.get("impactId").is_some(),
    }
}
pub(super) fn readback(
    command: &StockCommand,
    path: String,
    selector: ReadbackSelector,
    expected: Value,
    absence: bool,
) -> ReadbackPlan {
    ReadbackPlan {
        path,
        query: vec![],
        target: command.target.clone(),
        selector,
        expected,
        absence,
    }
}

#[cfg(test)]
mod preparation_tests {
    use super::super::{
        healthy_examples::{healthy_cases, healthy_command},
        map_stock,
    };
    use super::*;
    use serde_json::json;

    fn fixture_id(value: u128) -> Uuid {
        Uuid::from_u128(0x00000000_0000_4000_8000_000000000000 | value)
    }

    fn target() -> StockTarget {
        StockTarget {
            source_instance_id: fixture_id(0x10),
            collection_id: fixture_id(0x11),
            resource_kind: ResourceKind::Entity,
            resource_id: Some(fixture_id(0x500)),
            entity_id: None,
        }
    }

    fn snapshot(target: StockTarget, quantity: u64, complete: bool) -> NativeSnapshot {
        NativeSnapshot {
            value: json!({"id":target.resource_id.unwrap(),"quantity":quantity}),
            target,
            // Typed synthetic placeholder; not a claimed digest of these bytes.
            digest: Digest::parse("a".repeat(64)).unwrap(),
            complete,
            hidden_fields_preserved: false,
        }
    }

    fn command() -> StockCommand {
        healthy_command(
            "homebox.entity.quantity.set",
            target(),
            json!({"quantity":2}),
        )
    }

    #[test]
    fn duplicate_complete_observations_block_native_plan() {
        let (command, base) = healthy_cases()
            .into_iter()
            .find(|(command, _)| command.command_id == "homebox.entity.archive")
            .unwrap();
        assert_eq!(
            map_stock(&command, &base).unwrap().request.method,
            NativeMethod::Put
        );
        for other_quantity in [1, 3] {
            let first = base.snapshot(&command.target).unwrap().clone();
            let mut second = first.clone();
            second.value["quantity"] = json!(other_quantity);
            for snapshots in [vec![first.clone(), second.clone()], vec![second, first]] {
                let preparation = Preparation {
                    snapshots,
                    ..Preparation::default()
                };
                let original = preparation.clone();
                assert_eq!(
                    map_stock(&command, &preparation),
                    Err(StockMappingError::ObservationConflict)
                );
                assert_eq!(preparation, original);
            }
        }
    }

    #[test]
    fn incomplete_duplicate_is_not_discarded_during_preparation() {
        for (first_complete, second_complete) in [(true, false), (false, true), (false, false)] {
            let preparation = Preparation {
                snapshots: vec![
                    snapshot(target(), 1, first_complete),
                    snapshot(target(), 3, second_complete),
                ],
                ..Preparation::default()
            };
            assert_eq!(
                map_stock(&command(), &preparation),
                Err(StockMappingError::ObservationConflict)
            );
        }
    }

    #[test]
    fn missing_or_incomplete_observation_cannot_prepare_native_plan() {
        for snapshots in [Vec::new(), vec![snapshot(target(), 1, false)]] {
            let preparation = Preparation {
                snapshots,
                ..Preparation::default()
            };
            assert_eq!(
                map_stock(&command(), &preparation),
                Err(StockMappingError::CompleteNativeObservationRequired)
            );
        }
    }

    #[test]
    fn exact_target_observation_keeps_quantity_patch_narrow() {
        let wanted = snapshot(target(), 1, true);
        let other_source = snapshot(
            StockTarget {
                source_instance_id: fixture_id(0x12),
                ..target()
            },
            3,
            true,
        );
        let other_collection = snapshot(
            StockTarget {
                collection_id: fixture_id(0x13),
                ..target()
            },
            4,
            false,
        );
        for snapshots in [
            vec![wanted.clone(), other_source.clone(), other_collection.clone()],
            vec![other_collection, other_source, wanted.clone()],
        ] {
            let preparation = Preparation {
                snapshots,
                ..Preparation::default()
            };
            assert_eq!(preparation.snapshot(&target()), Ok(&wanted));
            let plan = map_stock(&command(), &preparation).unwrap();
            assert_eq!(plan.request.method, NativeMethod::Patch);
            assert_eq!(
                plan.request.path,
                format!("/api/v1/entities/{}", target().resource_id.unwrap())
            );
            assert!(plan.request.query.is_empty());
            assert_eq!(plan.request.body, NativeBody::Json(json!({"quantity":2})));
            assert_eq!(plan.readback.expected, json!({"quantity":2}));
        }
    }
}
