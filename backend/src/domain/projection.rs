use super::{
    Attachment, AuthorizedHome, BindingPayload, BindingSourceState, CONTRACT_VERSION, CacheState,
    CacheStatus, DomainError, DomainResult, HomeSummary, HomeboxEntity, Lifecycle, Maintenance,
    NativeLink, RecordType, ReviewStatus, Scope, SemanticKind, SemanticsPayload, Snapshot,
    SourceKey, SourceKind, SourceOwner, SourceRef,
};
use serde::Serialize;
use std::collections::HashMap;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use url::Url;

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Place,
    Item,
    Unknown,
}

/// Internal capabilities from the media adapter, scoped to exact source/entity.
/// No source URL or proxy reference is accepted as a media capability.
#[derive(Clone, Debug)]
pub struct MediaCapability {
    pub entity: SourceRef,
    pub attachment_id: String,
    pub download_href: Option<String>,
    pub preview_href: Option<String>,
    pub preview_validated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CurrentAttachment {
    StoredFile {
        attachment_id: String,
        title: String,
        content_type: Option<String>,
        byte_size: Option<u64>,
        download_href: Option<String>,
        preview_href: Option<String>,
    },
    ExternalLink {
        attachment_id: String,
        title: String,
        url: Option<String>,
        archived: bool,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentEntry {
    pub schema_version: u8,
    #[serde(flatten)]
    pub scope: Scope,
    pub source: SourceKey,
    pub source_updated_at: Option<String>,
    pub retrieved_at: String,
    pub entity: HomeboxEntity,
    pub attachments: Vec<CurrentAttachment>,
    pub maintenance: Vec<Maintenance>,
    pub native_links: Vec<NativeLink>,
    /// Exact qualified reference for browser routing; never just an external ID.
    pub key: SourceRef,
    pub kind: EntryKind,
    pub semantic_kind: SemanticKind,
    pub source_state: BindingSourceState,
    pub cache_status: CacheState,
    pub atlas_id: Option<String>,
    pub binding_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum CurrentSourceStatus {
    Visible {
        #[serde(flatten)]
        cache: Box<PublicCacheStatus>,
    },
    Revoked {
        owner: Option<SourceOwner>,
        status: CacheState,
        #[serde(rename = "displayStatus")]
        display_status: CacheState,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCacheStatus {
    pub schema_version: u8,
    #[serde(flatten)]
    pub partition: super::SourcePartition,
    pub status: CacheState,
    pub last_successful_fetch_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub generation_id: Option<String>,
    pub consistency: String,
    pub error: Option<PublicCacheError>,
    pub owner: Option<SourceOwner>,
    pub display_status: CacheState,
}

#[derive(Clone, Debug, Serialize)]
pub struct PublicCacheError {
    pub code: String,
    pub at: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStatus {
    Ready,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentOutput {
    pub status: OutputStatus,
    pub scope: Scope,
    pub home_label: String,
    pub now: String,
    pub can_edit: bool,
    pub homes: Vec<HomeSummary>,
    pub entries: Vec<CurrentEntry>,
    pub caches: Vec<CurrentSourceStatus>,
}

/// Pure assembly over a validated, authorized snapshot. Host/queries must obtain
/// `authority` from AccessPort and revalidate before releasing the result.
/// Network, geometry, aliases and mobility extensions await their typed peers;
/// current output does not invent those claims from source hierarchy.
pub fn project_current(
    snapshot: &Snapshot,
    authority: &AuthorizedHome,
    now: &str,
    media: &[MediaCapability],
) -> DomainResult<CurrentOutput> {
    if snapshot.contract_version != CONTRACT_VERSION {
        return Err(DomainError::InvalidContract);
    }
    let scope = &authority.home.scope;
    let now_date = parse_date(now)?;
    let caches: HashMap<_, _> = snapshot
        .caches
        .iter()
        .filter(|cache| &cache.partition.scope == scope)
        .map(|cache| (cache.partition.clone(), cache))
        .collect();
    let mut bindings = HashMap::new();
    let mut semantics = HashMap::new();
    for record in snapshot
        .records
        .iter()
        .filter(|record| &record.scope == scope && record.lifecycle == Lifecycle::Active)
    {
        match record.target.record_type {
            RecordType::Binding => {
                let payload: BindingPayload = serde_json::from_value(record.payload.clone())
                    .map_err(|_| DomainError::InvalidContract)?;
                if payload.review_status == ReviewStatus::Accepted {
                    // Validation guarantees one active accepted binding per key.
                    bindings.insert(payload.source.clone(), (record, payload));
                }
            }
            RecordType::LocationSemantics => {
                let payload: SemanticsPayload = serde_json::from_value(record.payload.clone())
                    .map_err(|_| DomainError::InvalidContract)?;
                if payload.review_status == ReviewStatus::Accepted {
                    semantics.insert(payload.atlas_id, payload.semantic_kind);
                }
            }
            _ => {}
        }
    }
    let mut entries = Vec::new();
    for projection in snapshot
        .homebox_entities
        .iter()
        .filter(|p| &p.scope == scope)
    {
        let cache = caches
            .values()
            .find(|cache| cache.partition.contains(scope, &projection.source));
        let Some(cache) = cache else { continue };
        if cache.status == CacheState::AccessRevoked
            || cache.generation_id.is_none()
            || cache.last_successful_fetch_at.is_none()
        {
            continue;
        }
        let binding = bindings.get(&projection.source);
        let source_state = binding.map_or(BindingSourceState::Unreviewed, |(_, b)| b.source_state);
        if source_state == BindingSourceState::AccessRevoked {
            continue;
        }
        let key = SourceRef {
            scope: scope.clone(),
            key: projection.source.clone(),
        };
        let kind = projection
            .entity
            .entity_type
            .as_ref()
            .map_or(EntryKind::Unknown, |t| {
                if t.is_location {
                    EntryKind::Place
                } else {
                    EntryKind::Item
                }
            });
        let semantic_kind = binding
            .and_then(|(_, binding)| semantics.get(&binding.atlas_id).copied())
            .unwrap_or(SemanticKind::Unclassified);
        let cache_status = display_cache(cache, now_date)?;
        let attachments = projection
            .attachments
            .iter()
            .map(|attachment| project_attachment(attachment, &key, media))
            .collect();
        let native_links = if authority.can_edit_homebox
            && source_state == BindingSourceState::Present
            && cache_status == CacheState::Fresh
        {
            projection
                .native_links
                .iter()
                .filter(|link| {
                    link.kind == "homebox-native"
                        && link.verified_route
                        && link.entity == key
                        && safe_web_url(&link.href, true)
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        entries.push(CurrentEntry {
            schema_version: projection.schema_version,
            scope: scope.clone(),
            source: projection.source.clone(),
            source_updated_at: projection.source_updated_at.clone(),
            retrieved_at: projection.retrieved_at.clone(),
            entity: projection.entity.clone(),
            attachments,
            maintenance: projection.maintenance.clone(),
            native_links,
            key,
            kind,
            semantic_kind,
            source_state,
            cache_status,
            atlas_id: binding.map(|(_, binding)| binding.atlas_id.clone()),
            binding_id: binding.map(|(record, _)| record.target.record_id.clone()),
        });
    }
    let statuses = snapshot
        .caches
        .iter()
        .filter(|c| &c.partition.scope == scope)
        .map(|cache| {
            let owner = snapshot
                .sources
                .iter()
                .find(|s| s.partition == cache.partition)
                .map(|s| s.owner);
            if cache.status == CacheState::AccessRevoked {
                Ok(CurrentSourceStatus::Revoked {
                    owner,
                    status: CacheState::AccessRevoked,
                    display_status: CacheState::AccessRevoked,
                })
            } else {
                Ok(CurrentSourceStatus::Visible {
                    cache: Box::new(PublicCacheStatus {
                        schema_version: cache.schema_version,
                        partition: cache.partition.clone(),
                        status: cache.status,
                        last_successful_fetch_at: cache.last_successful_fetch_at.clone(),
                        last_attempt_at: cache.last_attempt_at.clone(),
                        generation_id: cache.generation_id.clone(),
                        consistency: cache.consistency.clone(),
                        error: cache.error.as_ref().map(|e| PublicCacheError {
                            code: e.code.clone(),
                            at: e.at.clone(),
                        }),
                        owner,
                        display_status: display_cache(cache, now_date)?,
                    }),
                })
            }
        })
        .collect::<DomainResult<Vec<_>>>()?;
    let mut homes = vec![authority.home.clone()];
    for home in &authority.other_homes {
        if home.scope.workspace_id == scope.workspace_id
            && !homes.iter().any(|h| h.scope == home.scope)
        {
            homes.push(home.clone());
        }
    }
    Ok(CurrentOutput {
        status: OutputStatus::Ready,
        scope: scope.clone(),
        home_label: authority.home.label.clone(),
        now: now.to_owned(),
        can_edit: authority.can_edit_homebox,
        homes,
        entries,
        caches: statuses,
    })
}

fn project_attachment(
    attachment: &Attachment,
    key: &SourceRef,
    media: &[MediaCapability],
) -> CurrentAttachment {
    match attachment {
        Attachment::StoredFile {
            attachment_id,
            title,
            content_type,
            byte_size,
            ..
        } => {
            let capability = media
                .iter()
                .find(|m| &m.entity == key && &m.attachment_id == attachment_id);
            let download_href = capability
                .and_then(|m| m.download_href.as_deref())
                .filter(|h| safe_media_href(h))
                .map(str::to_owned);
            let preview_href = capability
                .filter(|m| {
                    m.preview_validated
                        && matches!(
                            content_type.as_deref(),
                            Some("image/png" | "image/jpeg" | "image/webp")
                        )
                })
                .and_then(|m| m.preview_href.as_deref())
                .filter(|h| safe_media_href(h))
                .map(str::to_owned);
            CurrentAttachment::StoredFile {
                attachment_id: attachment_id.clone(),
                title: title.clone(),
                content_type: content_type.clone(),
                byte_size: *byte_size,
                download_href,
                preview_href,
            }
        }
        Attachment::ExternalLink {
            attachment_id,
            title,
            url,
            archived,
        } => CurrentAttachment::ExternalLink {
            attachment_id: attachment_id.clone(),
            title: title.clone(),
            url: safe_web_url(url, false).then(|| url.clone()),
            archived: *archived,
        },
    }
}

fn parse_date(value: &str) -> DomainResult<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| DomainError::InvalidContract)
}

fn display_cache(cache: &CacheStatus, now: OffsetDateTime) -> DomainResult<CacheState> {
    if cache.status != CacheState::Fresh {
        return Ok(cache.status);
    }
    let fetched = cache
        .last_successful_fetch_at
        .as_deref()
        .ok_or(DomainError::InvalidContract)?;
    Ok(if now - parse_date(fetched)? > Duration::minutes(15) {
        CacheState::Stale
    } else {
        CacheState::Fresh
    })
}

/// Preserve the accepted destination bytes; parsing is only a predicate. This
/// retains the published credential-key heuristic, not a new URL guarantee.
pub fn safe_web_url(value: &str, native: bool) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || (native && (url.query().is_some() || url.fragment().is_some()))
    {
        return false;
    }
    !url.query_pairs().any(|(key, _)| {
        let key = key.to_ascii_lowercase();
        [
            "token",
            "key",
            "secret",
            "password",
            "authorization",
            "credential",
        ]
        .iter()
        .any(|needle| key.contains(needle))
    })
}

fn safe_media_href(value: &str) -> bool {
    value
        .strip_prefix("/api/atlas/media/")
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'/'))
        })
}

/// Parent edges are qualified source hierarchy, not a physical placement claim.
pub fn parent_ref(entry: &CurrentEntry) -> Option<SourceRef> {
    let mut parent = entry.key.clone();
    parent.key.external_id = entry.entity.parent.as_ref()?.id.clone();
    parent.key.source_kind = SourceKind::HomeboxEntity;
    Some(parent)
}
