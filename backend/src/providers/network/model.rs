use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $value)] $variant),+ }
    };
}
string_enum!(PartitionMode { ExclusiveHome => "exclusive-home", ReviewedEntityAllowlist => "reviewed-entity-allowlist" });
string_enum!(RelationKind { Connection => "network-connection", Membership => "network-segment-membership", Association => "network-association" });
string_enum!(EndpointKind { Device => "device", Interface => "interface", Segment => "segment", Unresolved => "unresolved" });
string_enum!(EvidenceBasis { OwnerReport => "owner-report", SourceReport => "source-report", PhysicalSurvey => "physical-survey", Inference => "inference", Unknown => "unknown" });
string_enum!(TemporalStatus { CurrentClaim => "current-claim", Historical => "historical", Withdrawn => "withdrawn", Disputed => "disputed" });
string_enum!(Medium { Ethernet => "ethernet", Wifi => "wifi", Powerline => "powerline", Wan => "wan", Other => "other", Unknown => "unknown" });
string_enum!(SourceKind { Group => "network-group", Device => "network-device", Interface => "network-interface", Segment => "network-segment", Link => "network-link" });
string_enum!(CacheStatus { Empty => "empty", Fresh => "fresh", Stale => "stale", Error => "error", AccessRevoked => "access-revoked" });
string_enum!(ErrorCode { Timeout => "timeout", Auth => "auth", WrongScope => "wrong-scope", InvalidSchema => "invalid-schema", SizeLimit => "size-limit", Transport => "transport", Upstream => "upstream" });

/// Local mirror of the published four-field source partition. Shared contract
/// generation and any replacement with AT51 types remain integration work.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceScope {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRegistration {
    #[serde(flatten)]
    pub scope: SourceScope,
    pub owner: String,
    pub partition_mode: PartitionMode,
    pub allowed_external_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkEvidence {
    pub kind: RelationKind,
    pub evidence_basis: EvidenceBasis,
    pub temporal_status: TemporalStatus,
    #[serde(deserialize_with = "nullable")]
    pub fact_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub vantage: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub unresolved_to: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkReview {
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub revision: u64,
    pub links: BTreeMap<String, LinkEvidence>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkEndpoint {
    pub kind: EndpointKind,
    #[serde(deserialize_with = "nullable")]
    pub id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub description: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRelation {
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: SourceScope,
    pub external_id: String,
    pub kind: RelationKind,
    pub from: NetworkEndpoint,
    pub to: NetworkEndpoint,
    pub medium: Medium,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub source_revision: u64,
    #[serde(deserialize_with = "nullable")]
    pub source_snapshot_at: Option<String>,
    pub retrieved_at: String,
    #[serde(deserialize_with = "nullable")]
    pub vantage: Option<String>,
    pub source_confidence: String,
    pub evidence_basis: EvidenceBasis,
    pub temporal_status: TemporalStatus,
    #[serde(deserialize_with = "nullable")]
    pub fact_at: Option<String>,
    pub notes: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualifiedRecord {
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: SourceScope,
    pub source_kind: SourceKind,
    pub external_id: String,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub source_revision: u64,
    #[serde(deserialize_with = "nullable")]
    pub source_snapshot_at: Option<String>,
    pub retrieved_at: String,
    /// Original source object; optional fields and text are retained verbatim.
    pub value: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectedInventory {
    pub groups: Vec<QualifiedRecord>,
    pub devices: Vec<QualifiedRecord>,
    pub interfaces: Vec<QualifiedRecord>,
    pub segments: Vec<QualifiedRecord>,
    pub links: Vec<QualifiedRecord>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedObservation {
    #[serde(flatten)]
    pub scope: SourceScope,
    pub external_id: String,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub source_revision: u64,
    #[serde(deserialize_with = "nullable")]
    pub source_snapshot_at: Option<String>,
    pub retrieved_at: String,
    pub fact_at: String,
    pub vantage: String,
    pub value: Value,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub input: String,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub link_review_revision: u64,
    pub graph_positions_establish_geometry: bool,
    pub groups_establish_placement: bool,
    pub segments_establish_circuits: bool,
    pub source_history_is_complete: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkGeneration {
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: SourceScope,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    pub source_revision: u64,
    #[serde(deserialize_with = "nullable")]
    pub source_snapshot_at: Option<String>,
    pub retrieved_at: String,
    pub inventory: ProjectedInventory,
    pub network_relations: Vec<NetworkRelation>,
    pub observations: Vec<RetainedObservation>,
    pub link_review: LinkReview,
    pub provenance: Provenance,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheError {
    pub code: ErrorCode,
    pub at: String,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheMetadata {
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: SourceScope,
    pub status: CacheStatus,
    #[serde(deserialize_with = "nullable")]
    pub last_successful_fetch_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub last_attempt_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub generation_id: Option<String>,
    pub consistency: String,
    #[serde(deserialize_with = "nullable")]
    pub error: Option<CacheError>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetainedState {
    pub cache: CacheMetadata,
    #[serde(deserialize_with = "nullable")]
    pub generation: Option<NetworkGeneration>,
}
impl RetainedState {
    pub fn empty(scope: SourceScope) -> Self {
        Self {
            cache: CacheMetadata {
                schema_version: 1,
                scope,
                status: CacheStatus::Empty,
                last_successful_fetch_at: None,
                last_attempt_at: None,
                generation_id: None,
                consistency: "non-transactional-offset-pages".into(),
                error: None,
            },
            generation: None,
        }
    }
    /// Public reads withhold records when access was revoked, preserving metadata.
    pub fn public_read(&self) -> Self {
        let mut result = self.clone();
        if result.cache.status == CacheStatus::AccessRevoked {
            result.generation = None;
        }
        result
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_response_bytes: usize,
    pub max_records: usize,
    pub request_timeout_ms: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_response_bytes: 10 * 1024 * 1024,
            max_records: 10_000,
            request_timeout_ms: 10_000,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NetworkError {
    pub code: ErrorCode,
}
impl NetworkError {
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
    pub const fn message(self) -> &'static str {
        match self.code {
            ErrorCode::Timeout => "Network read timed out",
            ErrorCode::Auth => "Network access is unavailable",
            ErrorCode::WrongScope => "Network source scope was rejected",
            ErrorCode::InvalidSchema => "Network response was rejected",
            ErrorCode::SizeLimit => "Network response exceeded limits",
            ErrorCode::Transport => "Network is unavailable",
            ErrorCode::Upstream => "Network source returned an error",
        }
    }
}
impl std::fmt::Display for NetworkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for NetworkError {}
pub(crate) type Result<T> = std::result::Result<T, NetworkError>;
pub(crate) fn guard(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(NetworkError::new(ErrorCode::InvalidSchema))
    }
}
// Required nullable fields must be present. Optional source fields must be
// absent or a concrete value; explicit null must not silently mean absent.
pub(crate) fn nullable<'de, D, T>(de: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(de)
}
pub(crate) fn present<'de, D, T>(de: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(de).map(Some)
}
