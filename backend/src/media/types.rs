//! Provisional media projections of the public frozen schema, not a generator
//! or a replacement for storage's whole-graph contract validation.
use std::collections::BTreeSet;
use std::{fmt, io};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type MediaResult<T> = Result<T, MediaError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaError {
    Unauthenticated,
    Forbidden,
    NotFound,
    Conflict,
    TooLarge,
    Unsupported,
    InvalidInput,
    Busy,
    Unavailable,
}

impl MediaError {
    pub fn status(self) -> u16 {
        match self {
            Self::Unauthenticated => 401,
            Self::Forbidden => 403,
            Self::NotFound => 404,
            Self::Conflict => 409,
            Self::TooLarge => 413,
            Self::Unsupported => 415,
            Self::InvalidInput => 422,
            Self::Busy => 429,
            Self::Unavailable => 503,
        }
    }
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Media unavailable")
    }
}

impl std::error::Error for MediaError {}

impl From<io::Error> for MediaError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::NotFound {
            Self::NotFound
        } else {
            Self::Unavailable
        }
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
}

pub(crate) fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

pub(crate) fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn bounded_string(value: &str) -> bool {
    let len = value.chars().count();
    (1..=4096).contains(&len)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub workspace_id: String,
    pub home_id: String,
}

impl Scope {
    pub fn validate(&self) -> MediaResult<()> {
        if !is_uuid(&self.workspace_id) || !is_uuid(&self.home_id) {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }

    /// The two ASCII UUID values make this identical to published canonicalJson.
    pub fn storage_partition(&self) -> MediaResult<String> {
        self.validate()?;
        Ok(sha256(
            format!(
                "{{\"homeId\":\"{}\",\"workspaceId\":\"{}\"}}",
                self.home_id, self.workspace_id
            )
            .as_bytes(),
        ))
    }

    pub fn storage_key(&self, digest: &str) -> MediaResult<String> {
        if !is_digest(digest) {
            return Err(MediaError::InvalidInput);
        }
        Ok(format!("atlas-v1:{}:{digest}", self.storage_partition()?))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetPurpose {
    GeometryOriginal,
    EvidenceOriginal,
    DerivedPreview,
}

impl AssetPurpose {
    pub fn is_original(self) -> bool {
        self != Self::DerivedPreview
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Availability {
    Available,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewPolicy {
    Unreviewed,
    Blocked,
    SafeRendered,
    DownloadOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Lifecycle {
    Active,
    Tombstoned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LicenseStatus {
    Unknown,
    Permitted,
    Restricted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceLicense {
    pub status: LicenseStatus,
    #[serde(deserialize_with = "required_nullable")]
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssetOwner {
    #[serde(rename = "atlas")]
    Atlas,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetPayload {
    pub owner: AssetOwner,
    pub purpose: AssetPurpose,
    pub storage_key: String,
    pub sha256: String,
    pub byte_size: u64,
    pub content_type: String,
    pub source_license: SourceLicense,
    pub availability: Availability,
    pub preview_policy: PreviewPolicy,
    pub evidence_ids: Vec<String>,
}

impl AssetPayload {
    pub fn validate(&self) -> MediaResult<()> {
        let ids: BTreeSet<_> = self.evidence_ids.iter().collect();
        if !bounded_string(&self.storage_key)
            || !is_digest(&self.sha256)
            || self.byte_size > 9_007_199_254_740_991
            || !bounded_string(&self.content_type)
            || self
                .source_license
                .reference
                .as_ref()
                .is_some_and(|s| !bounded_string(s))
            || ids.len() != self.evidence_ids.len()
            || !ids.iter().all(|id| is_uuid(id))
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssetRecordType {
    #[serde(rename = "asset")]
    Asset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRecord {
    pub schema_version: u32,
    pub record_type: AssetRecordType,
    pub record_id: String,
    pub workspace_id: String,
    pub home_id: String,
    pub revision: u64,
    pub lifecycle: Lifecycle,
    pub created_at: String,
    pub updated_at: String,
    pub last_audit_id: String,
    pub payload: AssetPayload,
}

impl AssetRecord {
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }

    /// Safety checks for the media projection. Storage additionally validates
    /// timestamps and all frozen graph relations using the published contract.
    pub fn validate(&self) -> MediaResult<()> {
        self.scope().validate()?;
        self.payload.validate()?;
        if self.schema_version != 1
            || !is_uuid(&self.record_id)
            || !is_uuid(&self.last_audit_id)
            || !(1..=9_007_199_254_740_991).contains(&self.revision)
            || self.created_at.is_empty()
            || self.updated_at.is_empty()
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentType {
    Png,
    Pdf,
    Text,
}

impl ContentType {
    pub fn parse(value: &str) -> MediaResult<Self> {
        match value {
            "image/png" => Ok(Self::Png),
            "application/pdf" => Ok(Self::Pdf),
            "text/plain" => Ok(Self::Text),
            _ => Err(MediaError::Unsupported),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Pdf => "application/pdf",
            Self::Text => "text/plain",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Pdf => "pdf",
            Self::Text => "txt",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobIdentity {
    pub sha256: String,
    pub byte_size: u64,
}
