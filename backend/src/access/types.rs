use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

use super::{AccessError, AccessResult};

/// Canonical spelling from atlas.schema.json, with no normalization.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize)]
#[serde(transparent)]
pub struct CanonicalId(String);

impl CanonicalId {
    pub fn parse(value: impl Into<String>) -> AccessResult<Self> {
        let value = value.into();
        if value.len() != 36
            || !value.bytes().enumerate().all(|(i, c)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    c == b'-'
                } else {
                    c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
                }
            })
        {
            return Err(AccessError::InvalidInput);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for CanonicalId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub workspace_id: CanonicalId,
    pub home_id: CanonicalId,
}

/// Trusted native-only identity selected at startup. It is never request input.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoopbackLocalIdentity {
    pub user_id: CanonicalId,
    pub actor_id: CanonicalId,
    pub username: String,
    pub scope: Scope,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Editor,
}

impl Role {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Editor => "editor",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    Read,
    History,
    Media,
    Mutate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Method {
    Get,
    Head,
    Post,
    Other,
}

/// Transport provides the actual URL and headers, never forwarded guesses.
/// This is request evidence to validate, not an authenticated capability.
pub struct RequestEvidence<'a> {
    pub method: Method,
    pub url: &'a str,
    pub origin: Option<&'a str>,
    pub sec_fetch_site: Option<&'a str>,
    pub referer: Option<&'a str>,
    pub cookie: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub csrf: Option<&'a str>,
}

/// Safe DTO only. Deserializing a DTO never creates a Principal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalView {
    pub actor_id: CanonicalId,
    pub workspace_id: CanonicalId,
    pub home_id: CanonicalId,
    pub role: Role,
}

/// Issued only after session, scope, role, method and (for mutation) CSRF checks.
/// Private provenance has no serde implementation. A clone retains its authority.
#[derive(Clone)]
pub struct Principal {
    pub(super) instance: [u8; 32],
    pub(super) token_hash: String,
    pub(super) origin: String,
    pub(super) user_id: CanonicalId,
    pub(super) actor_id: CanonicalId,
    pub(super) scope: Scope,
    pub(super) role: Role,
    pub(super) membership_version: AuthorityVersion,
    pub(super) action: Action,
}

impl Principal {
    pub fn actor_id(&self) -> &CanonicalId {
        &self.actor_id
    }

    pub fn scope(&self) -> &Scope {
        &self.scope
    }

    pub fn role(&self) -> Role {
        self.role
    }

    pub fn view(&self) -> PrincipalView {
        PrincipalView {
            actor_id: self.actor_id.clone(),
            workspace_id: self.scope.workspace_id.clone(),
            home_id: self.scope.home_id.clone(),
            role: self.role,
        }
    }
}

impl fmt::Debug for Principal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.view().fmt(f)
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(super) struct RestoreEpoch(pub(super) String);

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) struct AuthorityVersion(pub(super) i64);

/// Session response seam: transport formats expiresAt as an ISO date and emits
/// the cookie/CSRF only to the authenticated same-origin browser, never logs them.
pub struct SessionReceipt {
    pub(super) info: SessionInfo,
    pub(super) cookie: String,
}

impl SessionReceipt {
    pub fn info(&self) -> &SessionInfo {
        &self.info
    }

    pub fn set_cookie(&self) -> &str {
        &self.cookie
    }
}

pub struct SessionInfo {
    pub(super) actor_id: CanonicalId,
    pub(super) csrf_token: String,
    pub(super) expires_at_ms: i64,
}

impl SessionInfo {
    pub fn actor_id(&self) -> &CanonicalId {
        &self.actor_id
    }

    pub fn csrf_token(&self) -> &str {
        &self.csrf_token
    }

    pub fn expires_at_ms(&self) -> i64 {
        self.expires_at_ms
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceOwner {
    Homebox,
    Network,
    Magicplan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    HomeboxEntity,
    NetworkDevice,
    NetworkGroup,
    NetworkInterface,
    NetworkSegment,
    MagicplanRoom,
}

impl SourceKind {
    pub(super) fn owner(self) -> SourceOwner {
        match self {
            Self::HomeboxEntity => SourceOwner::Homebox,
            Self::MagicplanRoom => SourceOwner::Magicplan,
            _ => SourceOwner::Network,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceKey {
    pub source_instance_id: CanonicalId,
    pub collection_id: String,
    pub source_kind: SourceKind,
    pub external_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRef {
    pub workspace_id: CanonicalId,
    pub home_id: CanonicalId,
    pub key: SourceKey,
}

impl SourceRef {
    pub fn partition(&self) -> SourcePartition {
        SourcePartition {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.key.source_instance_id.clone(),
            collection_id: self.key.collection_id.clone(),
        }
    }

    pub(super) fn validate(&self) -> AccessResult<()> {
        opaque_text(&self.key.collection_id)?;
        opaque_text(&self.key.external_id)?;
        if self.key.source_kind == SourceKind::HomeboxEntity {
            CanonicalId::parse(&self.key.external_id)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePartition {
    pub workspace_id: CanonicalId,
    pub home_id: CanonicalId,
    pub source_instance_id: CanonicalId,
    pub collection_id: String,
}

impl SourcePartition {
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }

    pub(super) fn validate(&self) -> AccessResult<()> {
        opaque_text(&self.collection_id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartitionMode {
    ExclusiveHome,
    ReviewedEntityAllowlist,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRegistration {
    pub workspace_id: CanonicalId,
    pub home_id: CanonicalId,
    pub source_instance_id: CanonicalId,
    pub collection_id: String,
    pub owner: SourceOwner,
    pub partition_mode: PartitionMode,
    pub allowed_external_ids: Vec<String>,
}

impl SourceRegistration {
    pub fn partition(&self) -> SourcePartition {
        SourcePartition {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
            source_instance_id: self.source_instance_id.clone(),
            collection_id: self.collection_id.clone(),
        }
    }

    pub(super) fn validate(&self) -> AccessResult<()> {
        self.partition().validate()?;
        let mut ids = std::collections::HashSet::new();
        for id in &self.allowed_external_ids {
            opaque_text(id)?;
            if !ids.insert(id) {
                return Err(AccessError::InvalidInput);
            }
        }
        if self.partition_mode == PartitionMode::ExclusiveHome && !ids.is_empty() {
            return Err(AccessError::InvalidInput);
        }
        Ok(())
    }
}

pub(super) fn opaque_text(value: &str) -> AccessResult<()> {
    if value.is_empty() || value.chars().count() > 4096 {
        Err(AccessError::InvalidInput)
    } else {
        Ok(())
    }
}

/// Partition grants cover availability metadata, including empty generations.
#[derive(Clone)]
pub struct PartitionGrant {
    pub(super) principal: Principal,
    pub(super) partition: SourcePartition,
    pub(super) version: AuthorityVersion,
}

impl PartitionGrant {
    pub fn partition(&self) -> &SourcePartition {
        &self.partition
    }
}

/// Entity grants never replace partition checks or grant source administration.
#[derive(Clone)]
pub struct SourceGrant {
    pub(super) principal: Principal,
    pub(super) reference: SourceRef,
    pub(super) version: AuthorityVersion,
}

impl SourceGrant {
    pub fn reference(&self) -> &SourceRef {
        &self.reference
    }
}

/// Ordinary storage checks. There is deliberately no cache publication or
/// source configuration variant; those require a separate trusted internal seam.
pub enum Capability<'a> {
    Read,
    ReadHistory,
    ReadAssetManifest,
    Mutate,
    ReadCacheEntity(&'a SourceRef),
    ReadCachePartition(&'a SourcePartition),
}
