use super::error::invalid;
use super::{CONSISTENCY, ErrorCode, ReadError};
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Deserializer, Serialize, de::Error};
use std::collections::BTreeSet;

/// JSON Schema integer describes a value, not a particular numeric spelling.
/// Accept integral floats without Rust's saturating out-of-range float casts.
pub(super) fn deserialize_integral_u64<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    // Reuse AT51's lexical classification before any bounded conversion.
    let integer = crate::contracts::JsonInteger::deserialize(d)?;
    let number = integer.as_number();
    if let Some(v) = number.as_u64() {
        return Ok(v);
    }
    if let Some(v) = number.as_i64() {
        return u64::try_from(v).map_err(D::Error::custom);
    }
    let v = number
        .as_f64()
        .ok_or_else(|| D::Error::custom("number outside range"))?;
    const EXCLUSIVE_LIMIT: f64 = 18_446_744_073_709_551_616.0;
    if v.is_finite() && (0.0..EXCLUSIVE_LIMIT).contains(&v) && v.fract() == 0.0 {
        Ok(v as u64)
    } else {
        Err(D::Error::custom("integral number outside the u64 range"))
    }
}

fn deserialize_optional_integral_u64<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<u64>, D::Error> {
    struct Integral(u64);
    impl<'de> Deserialize<'de> for Integral {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            deserialize_integral_u64(d).map(Self)
        }
    }
    Option::<Integral>::deserialize(d).map(|n| n.map(|v| v.0))
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Uuid(String);

impl Uuid {
    pub fn parse(value: &str) -> Result<Self, ReadError> {
        let bytes = value.as_bytes();
        if bytes.len() != 36
            || bytes.iter().enumerate().any(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    *b != b'-'
                } else {
                    !b.is_ascii_hexdigit()
                }
            })
        {
            return Err(invalid());
        }
        Ok(Self(value.to_ascii_lowercase()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl<'de> Deserialize<'de> for Uuid {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(d)?).map_err(D::Error::custom)
    }
}

/// Keeps original spelling, fractional precision and offset for provenance.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Timestamp(String);
impl Timestamp {
    pub fn parse(value: &str) -> Result<Self, ReadError> {
        DateTime::parse_from_rfc3339(value).map_err(|_| invalid())?;
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub(super) fn instant(&self) -> DateTime<FixedOffset> {
        // The private constructor and Deserialize both validate this value.
        DateTime::parse_from_rfc3339(&self.0).expect("validated timestamp")
    }
}
impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(d)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceScope {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub source_instance_id: Uuid,
    pub collection_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartitionMode {
    ExclusiveHome,
    ReviewedEntityAllowlist,
}

/// Constructed from the shared server registration, never from a browser request.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRegistration {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub source_instance_id: Uuid,
    pub collection_id: String,
    pub owner: String,
    pub partition_mode: PartitionMode,
    pub allowed_external_ids: Vec<Uuid>,
}
impl SourceRegistration {
    pub fn scope(&self) -> SourceScope {
        SourceScope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.source_instance_id.clone(),
            collection_id: self.collection_id.clone(),
        }
    }
    pub(super) fn validate(&self) -> Result<(), ReadError> {
        text(&self.collection_id, 1, 4096)?;
        if self.owner != "homebox"
            || (self.partition_mode == PartitionMode::ExclusiveHome
                && !self.allowed_external_ids.is_empty())
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        let ids: BTreeSet<_> = self.allowed_external_ids.iter().collect();
        if ids.len() != self.allowed_external_ids.len() {
            return Err(invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceKey {
    pub source_instance_id: Uuid,
    pub collection_id: String,
    pub source_kind: &'static str,
    pub external_id: Uuid,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityType {
    pub id: Uuid,
    pub name: String,
    pub is_location: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parent {
    pub id: Uuid,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub entity_type: Option<EntityType>,
    pub parent: Option<Parent>,
    pub archived: bool,
    pub quantity: Option<f64>,
    pub manufacturer: Option<String>,
    pub model_number: Option<String>,
    pub serial_number: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum Attachment {
    #[serde(rename = "stored-file", rename_all = "camelCase")]
    StoredFile {
        attachment_id: Uuid,
        title: String,
        content_type: Option<String>,
        #[serde(deserialize_with = "deserialize_optional_integral_u64")]
        byte_size: Option<u64>,
        proxy_ref: Option<String>,
    },
    #[serde(rename = "external-link", rename_all = "camelCase")]
    ExternalLink {
        attachment_id: Uuid,
        title: String,
        url: String,
        archived: bool,
    },
}
impl Attachment {
    pub fn id(&self) -> &Uuid {
        match self {
            Self::StoredFile { attachment_id, .. } | Self::ExternalLink { attachment_id, .. } => {
                attachment_id
            }
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Maintenance {
    pub entry_id: Uuid,
    pub name: String,
    pub description: String,
    pub scheduled_date: Option<crate::providers::homebox::wire::MaintenanceDate>,
    pub completed_date: Option<crate::providers::homebox::wire::MaintenanceDate>,
    pub cost: Option<f64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeIntent {
    View,
    Edit,
    Maintenance,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub key: SourceKey,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLink {
    pub kind: &'static str,
    pub intent: NativeIntent,
    pub entity: SourceRef,
    pub href: String,
    pub verified_route: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub schema_version: u8,
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub source: SourceKey,
    pub source_updated_at: Option<Timestamp>,
    pub retrieved_at: Timestamp,
    pub entity: Entity,
    pub attachments: Vec<Attachment>,
    pub maintenance: Vec<Maintenance>,
    pub native_links: Vec<NativeLink>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheState {
    Empty,
    Fresh,
    Stale,
    Error,
    AccessRevoked,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheError {
    pub code: ErrorCode,
    pub at: Timestamp,
    pub message: &'static str,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub schema_version: u8,
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub source_instance_id: Uuid,
    pub collection_id: String,
    pub status: CacheState,
    pub last_successful_fetch_at: Option<Timestamp>,
    pub last_attempt_at: Option<Timestamp>,
    pub generation_id: Option<Uuid>,
    pub consistency: &'static str,
    pub error: Option<CacheError>,
}
impl CacheStatus {
    pub fn empty(scope: &SourceScope) -> Self {
        Self {
            schema_version: 1,
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            source_instance_id: scope.source_instance_id.clone(),
            collection_id: scope.collection_id.clone(),
            status: CacheState::Empty,
            last_successful_fetch_at: None,
            last_attempt_at: None,
            generation_id: None,
            consistency: CONSISTENCY,
            error: None,
        }
    }
    pub fn scope(&self) -> SourceScope {
        SourceScope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.source_instance_id.clone(),
            collection_id: self.collection_id.clone(),
        }
    }
    pub fn quarantined(&self) -> bool {
        self.status == CacheState::AccessRevoked
            || self.error.as_ref().is_some_and(|e| e.code.quarantines())
    }
}
#[derive(Clone, Debug)]
pub struct PreviousGeneration {
    pub(super) cache: CacheStatus,
    pub(super) entities: Vec<Projection>,
    pub(super) quarantine: bool,
}
impl PreviousGeneration {
    /// Storage supplies a previously validated generation. Validation is repeated before GETs.
    pub fn new(cache: CacheStatus, entities: Vec<Projection>, quarantine: bool) -> Self {
        Self {
            cache,
            entities,
            quarantine,
        }
    }
    pub fn cache(&self) -> &CacheStatus {
        &self.cache
    }
    pub fn entities(&self) -> &[Projection] {
        &self.entities
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ReadStats {
    pub bytes: usize,
    pub requests: usize,
    pub pages: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuarantineTransition {
    Preserve,
    Quarantine,
    RevalidationCandidate,
}

/// Staged only. Private fields and no Deserialize keep filtered reads out of publication.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteGeneration {
    pub(super) cache: CacheStatus,
    pub(super) homebox_entities: Vec<Projection>,
    pub(super) missing_external_ids: Vec<Uuid>,
    pub(super) quarantine: bool,
    pub(super) stats: ReadStats,
}
impl CompleteGeneration {
    pub fn cache(&self) -> &CacheStatus {
        &self.cache
    }
    pub fn entities(&self) -> &[Projection] {
        &self.homebox_entities
    }
    pub fn missing_external_ids(&self) -> &[Uuid] {
        &self.missing_external_ids
    }
    pub fn quarantine(&self) -> bool {
        self.quarantine
    }
    pub fn stats(&self) -> ReadStats {
        self.stats
    }
    pub fn quarantine_transition(&self) -> QuarantineTransition {
        QuarantineTransition::RevalidationCandidate
    }
    pub fn deletion_confirmed(&self) -> bool {
        false
    }
    pub fn previous(&self) -> PreviousGeneration {
        PreviousGeneration::new(
            self.cache.clone(),
            self.homebox_entities.clone(),
            self.quarantine,
        )
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredView {
    pub homebox_entities: Vec<Projection>,
    pub stats: ReadStats,
}
impl FilteredView {
    pub fn quarantine_transition(&self) -> QuarantineTransition {
        QuarantineTransition::Preserve
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedRead {
    /// Failure-only metadata proposal. Records, generation and success time are retained.
    pub cache: Option<Box<CacheStatus>>,
    pub error: CacheError,
    pub quarantine: Option<bool>,
    pub quarantine_transition: QuarantineTransition,
    pub stats: ReadStats,
}
impl std::fmt::Display for FailedRead {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.error.message)
    }
}
impl std::error::Error for FailedRead {}

/// Pure age calculation; does not persist new times or confer cached read access.
pub fn cache_freshness(
    cache: &CacheStatus,
    now: &Timestamp,
    stale_after_ms: u64,
) -> (CacheStatus, Option<u64>) {
    let age = cache.last_successful_fetch_at.as_ref().map(|then| {
        now.instant()
            .signed_duration_since(then.instant())
            .num_milliseconds()
            .max(0) as u64
    });
    let mut result = cache.clone();
    if result.status == CacheState::Fresh && age.is_some_and(|a| a > stale_after_ms) {
        result.status = CacheState::Stale;
    }
    (result, age)
}
pub(super) fn text(s: &str, min: usize, max: usize) -> Result<(), ReadError> {
    let length = s.chars().count();
    if length < min || length > max {
        Err(invalid())
    } else {
        Ok(())
    }
}
