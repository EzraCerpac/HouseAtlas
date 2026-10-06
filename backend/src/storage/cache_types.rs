//! Narrow publication carriers for the exact published source/cache contract.
use super::{Scope, SourcePartition};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceOwner {
    Homebox,
    Network,
    Magicplan,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PartitionMode {
    ExclusiveHome,
    ReviewedEntityAllowlist,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRegistration {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
    pub owner: SourceOwner,
    pub partition_mode: PartitionMode,
    pub allowed_external_ids: Vec<String>,
}
impl SourceRegistration {
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }
    pub fn partition(&self) -> SourcePartition {
        SourcePartition {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.source_instance_id.clone(),
            collection_id: self.collection_id.clone(),
        }
    }
}
impl SourcePartition {
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CacheState {
    Empty,
    Fresh,
    Stale,
    Error,
    AccessRevoked,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailureCode {
    Timeout,
    Auth,
    WrongScope,
    InvalidSchema,
    Pagination,
    SizeLimit,
    Transport,
    Upstream,
}
impl FailureCode {
    pub(crate) fn quarantines(self) -> bool {
        matches!(self, Self::Auth | Self::WrongScope)
    }
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Timeout => "Source request timed out",
            Self::Auth => "Source access is unavailable",
            Self::WrongScope => "Source scope validation failed",
            Self::InvalidSchema => "Source contract validation failed",
            Self::Pagination => "Source generation is incomplete",
            Self::SizeLimit => "Source limit exceeded",
            Self::Transport => "Source transport unavailable",
            Self::Upstream => "Source unavailable",
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailureStatus {
    Error,
    Stale,
    AccessRevoked,
}
impl From<FailureStatus> for CacheState {
    fn from(status: FailureStatus) -> Self {
        match status {
            FailureStatus::Error => Self::Error,
            FailureStatus::Stale => Self::Stale,
            FailureStatus::AccessRevoked => Self::AccessRevoked,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheError {
    pub code: FailureCode,
    pub at: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheStatus {
    pub schema_version: u32,
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
    pub status: CacheState,
    #[serde(deserialize_with = "required_nullable")]
    pub last_successful_fetch_at: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub last_attempt_at: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub generation_id: Option<String>,
    pub consistency: String,
    #[serde(deserialize_with = "required_nullable")]
    pub error: Option<CacheError>,
}
impl CacheStatus {
    pub fn partition(&self) -> SourcePartition {
        SourcePartition {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.source_instance_id.clone(),
            collection_id: self.collection_id.clone(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheGeneration {
    pub cache: CacheStatus,
    pub homebox_entities: Vec<Value>,
    pub network_relations: Vec<Value>,
    pub complete: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub expected_generation_id: Option<String>,
    pub expected_cache_epoch: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CachePublicationState {
    #[serde(deserialize_with = "required_nullable")]
    pub cache: Option<CacheStatus>,
    pub cache_epoch: u64,
    pub homebox_entities: Vec<Value>,
    pub network_relations: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheFailure {
    pub code: FailureCode,
    #[serde(
        default,
        deserialize_with = "optional_non_null_status",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<FailureStatus>,
}
/// Durable SQLite partition epoch, deliberately distinct from the access
/// boundary's opaque registry-authority epoch/handle. Constructed by storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheEpoch(pub(super) u64);
impl CacheEpoch {
    pub fn value(self) -> u64 {
        self.0
    }
}
/// An immutable server-only binding obtained before provider work. It is not
/// deserializable and carries no grant or durable source-presence witness.
#[derive(Debug)]
pub struct CachePublicationFence {
    pub(super) issuer: Arc<()>,
    pub(super) partition: SourcePartition,
    pub(super) baseline_generation_id: Option<String>,
    pub(super) baseline_cache_epoch: CacheEpoch,
    pub(super) reserved_generation_id: String,
}
impl CachePublicationFence {
    pub fn partition(&self) -> &SourcePartition {
        &self.partition
    }
    pub fn baseline_generation_id(&self) -> Option<&str> {
        self.baseline_generation_id.as_deref()
    }
    pub fn baseline_cache_epoch(&self) -> CacheEpoch {
        self.baseline_cache_epoch
    }
    pub fn reserved_generation_id(&self) -> &str {
        &self.reserved_generation_id
    }
}
#[derive(Debug)]
pub struct PreparedCachePublication {
    pub(super) state: CachePublicationState,
    pub(super) fence: CachePublicationFence,
}
impl PreparedCachePublication {
    pub fn state(&self) -> &CachePublicationState {
        &self.state
    }
    pub fn fence(&self) -> &CachePublicationFence {
        &self.fence
    }
    pub fn into_parts(self) -> (CachePublicationState, CachePublicationFence) {
        (self.state, self.fence)
    }
}
fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
fn optional_non_null_status<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<FailureStatus>, D::Error> {
    FailureStatus::deserialize(deserializer).map(Some)
}
