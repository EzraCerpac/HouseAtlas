//! Narrow domain read models. Full JSON Schema/graph validation is a port
//! obligation; these models are not a replacement for AT51 generated contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONTRACT_VERSION: &str = "1.0.0";

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub workspace_id: String,
    pub home_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceKey {
    pub source_instance_id: String,
    pub collection_id: String,
    pub source_kind: SourceKind,
    pub external_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    HomeboxEntity,
    NetworkDevice,
    NetworkGroup,
    NetworkInterface,
    NetworkSegment,
    MagicplanRoom,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    #[serde(flatten)]
    pub scope: Scope,
    pub key: SourceKey,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct SourcePartition {
    #[serde(flatten)]
    pub scope: Scope,
    pub source_instance_id: String,
    pub collection_id: String,
}

impl SourcePartition {
    pub fn contains(&self, scope: &Scope, source: &SourceKey) -> bool {
        &self.scope == scope
            && self.source_instance_id == source.source_instance_id
            && self.collection_id == source.collection_id
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceOwner {
    Homebox,
    Network,
    Magicplan,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRegistration {
    #[serde(flatten)]
    pub partition: SourcePartition,
    pub owner: SourceOwner,
    pub partition_mode: String,
    pub allowed_external_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RecordType {
    Identity,
    Binding,
    Evidence,
    LocationSemantics,
    Circuit,
    Valve,
    Relation,
    Geometry,
    Asset,
    Reconciliation,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRef {
    pub record_type: RecordType,
    pub record_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Active,
    Tombstoned,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    #[serde(flatten)]
    pub target: RecordRef,
    #[serde(flatten)]
    pub scope: Scope,
    #[serde(deserialize_with = "super::integer::deserialize_safe_integer")]
    pub revision: u64,
    pub lifecycle: Lifecycle,
    pub created_at: String,
    pub updated_at: String,
    pub last_audit_id: String,
    pub payload: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReviewStatus {
    Proposed,
    Accepted,
    Rejected,
    Retired,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BindingSourceState {
    Present,
    Archived,
    Unresolved,
    ConfirmedDeleted,
    AccessRevoked,
    /// Projection-only value; never a canonical binding payload value.
    Unreviewed,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindingPayload {
    pub atlas_id: String,
    pub source: SourceKey,
    pub review_status: ReviewStatus,
    pub source_state: BindingSourceState,
    pub evidence_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SemanticKind {
    Unclassified,
    Site,
    Building,
    Floor,
    Room,
    Other,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticsPayload {
    pub atlas_id: String,
    pub semantic_kind: SemanticKind,
    pub review_status: ReviewStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CacheState {
    Empty,
    Fresh,
    Stale,
    Error,
    AccessRevoked,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheError {
    pub code: String,
    pub at: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    #[serde(flatten)]
    pub partition: SourcePartition,
    pub status: CacheState,
    pub last_successful_fetch_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub generation_id: Option<String>,
    pub consistency: String,
    pub error: Option<CacheError>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomeboxEntityType {
    pub id: String,
    pub name: String,
    pub is_location: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EntityParent {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeboxEntity {
    pub id: String,
    pub name: String,
    pub description: String,
    pub entity_type: Option<HomeboxEntityType>,
    pub parent: Option<EntityParent>,
    pub archived: bool,
    pub quantity: Option<serde_json::Number>,
    pub manufacturer: Option<String>,
    pub model_number: Option<String>,
    pub serial_number: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Attachment {
    StoredFile {
        attachment_id: String,
        title: String,
        content_type: Option<String>,
        #[serde(deserialize_with = "super::integer::deserialize_nullable_integer")]
        byte_size: Option<crate::contracts::JsonInteger>,
        proxy_ref: Option<String>,
    },
    ExternalLink {
        attachment_id: String,
        title: String,
        url: String,
        archived: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Maintenance {
    pub entry_id: String,
    pub name: String,
    pub description: String,
    pub scheduled_date: Option<String>,
    pub completed_date: Option<String>,
    pub cost: Option<serde_json::Number>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLink {
    pub kind: String,
    pub intent: String,
    pub entity: SourceRef,
    pub href: String,
    pub verified_route: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeboxProjection {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: Scope,
    pub source: SourceKey,
    pub source_updated_at: Option<String>,
    pub retrieved_at: String,
    pub entity: HomeboxEntity,
    pub attachments: Vec<Attachment>,
    pub maintenance: Vec<Maintenance>,
    pub native_links: Vec<NativeLink>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub contract_version: String,
    pub synthetic: bool,
    pub sources: Vec<SourceRegistration>,
    pub records: Vec<Record>,
    pub homebox_entities: Vec<HomeboxProjection>,
    pub caches: Vec<CacheStatus>,
    pub network_relations: Vec<Value>,
}

/// Deliberately contains only the three public home fields.
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HomeSummary {
    #[serde(flatten)]
    pub scope: Scope,
    pub label: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MutationOperation {
    Create,
    Replace,
    Tombstone,
    Restore,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    pub audit_id: String,
    #[serde(flatten)]
    pub scope: Scope,
    pub record: RecordRef,
    pub operation: MutationOperation,
    #[serde(deserialize_with = "super::integer::deserialize_nullable_safe_integer")]
    pub previous_revision: Option<u64>,
    #[serde(deserialize_with = "super::integer::deserialize_safe_integer")]
    pub result_revision: u64,
    pub actor_id: String,
    pub at: String,
    pub reason: String,
    pub mutation_id: String,
    pub before_digest: Option<String>,
    pub after_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    pub record: Record,
    pub audit: Audit,
    pub replayed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    #[serde(deserialize_with = "super::integer::deserialize_u8")]
    pub schema_version: u8,
    pub batch_id: String,
    pub results: Vec<MutationResult>,
    pub replayed: bool,
}
