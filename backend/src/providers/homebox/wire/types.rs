use crate::providers::homebox::read::{
    Attachment, Entity, EntityType, NativeLink, Parent, SourceKey, SourceScope, Timestamp, Uuid,
};
use chrono::NaiveDate;
use serde::{Deserialize, Deserializer, Serialize, de::Error};
use serde_json::{Number, Value};
use std::fmt;

/// Sanitized diagnostics; never include source content or driver errors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireError {
    Invalid,
    Limit,
    WrongEntity,
    Pagination,
}
impl fmt::Display for WireError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Invalid => "HomeBox metadata failed the pinned stock wire contract.",
            Self::Limit => "HomeBox metadata exceeded its configured decoding limit.",
            Self::WrongEntity => "HomeBox metadata belongs to a different entity.",
            Self::Pagination => "HomeBox page does not match the requested bounded page.",
        })
    }
}
impl std::error::Error for WireError {}

/// The reader continues to own aggregate bytes, deadlines and page count.
#[derive(Clone, Copy, Debug)]
pub struct DecodeLimits {
    pub max_response_bytes: usize,
    pub max_entries: usize,
    pub max_text_chars: usize,
}
impl Default for DecodeLimits {
    fn default() -> Self {
        Self {
            max_response_bytes: 10_485_760,
            max_entries: 100_000,
            max_text_chars: 16_384,
        }
    }
}
impl DecodeLimits {
    pub(super) fn validate(self) -> Result<(), WireError> {
        let cap = Self::default();
        if self.max_response_bytes == 0
            || self.max_response_bytes > cap.max_response_bytes
            || self.max_entries == 0
            || self.max_entries > cap.max_entries
            || self.max_text_chars == 0
            || self.max_text_chars > cap.max_text_chars
        {
            return Err(WireError::Limit);
        }
        Ok(())
    }
}

/// Original bytes and parsed source survive normalization. These may contain
/// private inventory: the host must retain them privately, never in publication.
#[derive(Clone, Debug)]
pub struct Decoded<T> {
    pub value: T,
    pub original: Vec<u8>,
    pub source: Value,
}

/// Exact common list/detail comparison fields used by the accepted reader.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: Uuid,
    pub name: String,
    pub archived: bool,
    pub updated_at: Timestamp,
    pub entity_type: Option<EntityType>,
    pub parent: Option<Parent>,
}

#[derive(Clone, Debug)]
pub struct Page {
    pub items: Vec<Summary>,
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
}

/// Fixed native list query; parent IDs are direct source parents, not placement.
#[derive(Clone, Debug)]
pub struct PageRequest {
    pub page: u64,
    pub page_size: u64,
    pub is_location: bool,
    pub parent_ids: Vec<Uuid>,
}
impl PageRequest {
    pub fn query(&self) -> Result<Vec<(String, String)>, WireError> {
        if self.page == 0
            || self.page > 1000
            || self.page_size == 0
            || self.page_size > 100
            || self.parent_ids.len() > 100
        {
            return Err(WireError::Pagination);
        }
        let mut query = vec![
            ("isLocation".into(), self.is_location.to_string()),
            ("includeArchived".into(), "true".into()),
            ("page".into(), self.page.to_string()),
            ("pageSize".into(), self.page_size.to_string()),
        ];
        query.extend(
            self.parent_ids
                .iter()
                .map(|id| ("parentIds".into(), id.as_str().into())),
        );
        Ok(query)
    }
}

#[derive(Clone, Debug)]
pub struct Detail {
    pub summary: Summary,
    pub entity: Entity,
    pub attachments: Vec<Attachment>,
}

/// HomeBox types.Date serializes an absent date as "" and a known date as
/// YYYY-MM-DD. No timezone, time of day or source revision is invented.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct CalendarDate(String);
impl CalendarDate {
    pub fn parse(value: &str) -> Result<Self, WireError> {
        if value.len() != 10
            || value.as_bytes()[4] != b'-'
            || value.as_bytes()[7] != b'-'
            || value
                .bytes()
                .enumerate()
                .any(|(i, b)| !matches!(i, 4 | 7) && !b.is_ascii_digit())
            || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err()
        {
            return Err(WireError::Invalid);
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Additive reader type: retains existing timestamp spelling and admits native
/// calendar dates. Intended only for maintenance, not source/retrieval timestamps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct MaintenanceDate(String);
impl MaintenanceDate {
    pub fn parse(value: &str) -> Result<Self, WireError> {
        if value.len() == 10 {
            CalendarDate::parse(value)?;
        } else {
            Timestamp::parse(value).map_err(|_| WireError::Invalid)?;
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl<'de> Deserialize<'de> for MaintenanceDate {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(d)?).map_err(D::Error::custom)
    }
}
impl From<Timestamp> for MaintenanceDate {
    fn from(value: Timestamp) -> Self {
        Self(value.as_str().to_owned())
    }
}
impl From<CalendarDate> for MaintenanceDate {
    fn from(value: CalendarDate) -> Self {
        Self(value.0)
    }
}

/// The source cost string remains available verbatim in Decoded.source/original.
/// Number retains its decimal/exponent spelling without an intermediate f64 cast.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Maintenance {
    pub entry_id: Uuid,
    pub name: String,
    pub description: String,
    pub scheduled_date: Option<CalendarDate>,
    pub completed_date: Option<CalendarDate>,
    pub cost: Number,
}

#[derive(Clone, Debug)]
pub struct MaintenanceLog {
    pub(super) entity_id: Uuid,
    pub(super) entries: Vec<Maintenance>,
}
impl MaintenanceLog {
    pub fn entity_id(&self) -> &Uuid {
        &self.entity_id
    }
    pub fn entries(&self) -> &[Maintenance] {
        &self.entries
    }
}

/// Shape for the integrator's date-preserving reader bridge. This is an
/// unvalidated candidate, not a CompleteGeneration or publication capability.
/// The current frozen Atlas maintenance date-time schema cannot admit date-only
/// values; its owner must adopt the additive date alternative described in README.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionCandidate {
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
impl Detail {
    pub fn projection_candidate(
        &self,
        scope: &SourceScope,
        retrieved_at: Timestamp,
        log: &MaintenanceLog,
    ) -> Result<ProjectionCandidate, WireError> {
        if log.entity_id != self.summary.id {
            return Err(WireError::WrongEntity);
        }
        Ok(ProjectionCandidate {
            schema_version: 1,
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            source: SourceKey {
                source_instance_id: scope.source_instance_id.clone(),
                collection_id: scope.collection_id.clone(),
                source_kind: "homebox-entity",
                external_id: self.summary.id.clone(),
            },
            source_updated_at: Some(self.summary.updated_at.clone()),
            retrieved_at,
            entity: self.entity.clone(),
            attachments: self.attachments.clone(),
            maintenance: log.entries.clone(),
            native_links: Vec::new(),
        })
    }
}

/// Describes evidence, not permission or proof of a deployed provider.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceKind {
    SourceDerivedSynthetic,
    CapturedTarget,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireProvenance {
    pub dialect: &'static str,
    pub reference_release: &'static str,
    pub reference_source_commit: &'static str,
    pub reference_swagger_sha256: &'static str,
    /// Host-supplied observations; never inferred from reference source pins.
    pub observed_target_version: Option<String>,
    pub observed_target_build: Option<String>,
    pub source_revision: Option<String>,
    pub evidence_kind: EvidenceKind,
}
impl WireProvenance {
    pub fn source_derived_synthetic() -> Self {
        Self {
            dialect: super::DIALECT,
            reference_release: super::RELEASE,
            reference_source_commit: super::SOURCE_COMMIT,
            reference_swagger_sha256: super::SWAGGER_SHA256,
            observed_target_version: None,
            observed_target_build: None,
            source_revision: None,
            evidence_kind: EvidenceKind::SourceDerivedSynthetic,
        }
    }
}
