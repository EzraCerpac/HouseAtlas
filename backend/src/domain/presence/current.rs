//! Map exact AT07 cache rows and the Network owner's verified retained row.
use super::{carrier, digest, shape};
use crate::{
    contracts::{self, stock as wire},
    domain::{DomainError, DomainResult, native_storage::native_error},
    providers::{homebox::read as hb, network as net},
    storage as s,
};
use serde_json::Value;

/// Actual current-store carriers, never a filtered view or relation endpoint.
/// The atomic owner must read registration and publication in its own active
/// transaction. The standalone reader below is only a development/preflight read.
pub struct CurrentPresenceRead {
    pub registration: s::SourceRegistration,
    pub publication: s::CachePublicationState,
    pub network_row: Option<net::SidecarRow>,
    pub network_review: Option<net::LinkReview>,
}

/// The host's existing configured age policy; this module supplies no default.
pub enum ConfiguredCacheAge {
    Homebox { stale_after_ms: u64 },
    Network { stale_after_ms: i64 },
}

/// Borrow the actual store and original trusted principal. This uses the owner's
/// PublishCache read capability and issues neither access grants nor a fetch.
/// It is NOT an in-mutation snapshot and must not be used to enable admission.
pub fn read_current_store<C, A, R, N>(
    store: &mut s::AtlasStore<C, A, R>,
    principal: &A::Principal,
    registration: &s::SourceRegistration,
    network: Option<(&N, &net::LinkReview)>,
) -> DomainResult<CurrentPresenceRead>
where
    C: s::Contract,
    A: s::Authorization,
    R: s::Runtime,
    N: net::DurableNetworkSidecar,
{
    let publication = store
        .read_cache_for_publication(principal, &registration.scope(), &registration.partition())
        .map_err(native_error)?;
    let (network_row, network_review) = match registration.owner {
        s::SourceOwner::Network => {
            let (sidecar, review) = network.ok_or(DomainError::UpstreamUnavailable)?;
            let source: net::SourceRegistration = carrier(registration)?;
            let generation = publication
                .cache
                .as_ref()
                .and_then(|cache| cache.generation_id.as_deref())
                .ok_or(DomainError::UpstreamUnavailable)?;
            (
                Some(
                    sidecar
                        .load(&source, generation)
                        .map_err(|_| DomainError::UpstreamIncomplete)?,
                ),
                Some(review.clone()),
            )
        }
        s::SourceOwner::Homebox if network.is_none() => (None, None),
        _ => return Err(DomainError::UpstreamUnavailable),
    };
    Ok(CurrentPresenceRead {
        registration: registration.clone(),
        publication,
        network_row,
        network_review,
    })
}

impl CurrentPresenceRead {
    /// Derive facts from the entire exact saved member. Caller supplies an
    /// explicit identity kind from the final validated active Atlas identity.
    pub fn qualify_member(
        &self,
        binding_record_id: &str,
        source: &contracts::SourceKey,
        identity_kind: &str,
        authority: &wire::PresenceAuthority,
        now: &str,
        age: &ConfiguredCacheAge,
    ) -> DomainResult<wire::PresenceQualification> {
        shape::<contracts::SourceRegistration>(&self.registration)?;
        let cache = self
            .publication
            .cache
            .as_ref()
            .ok_or(DomainError::UpstreamUnavailable)?;
        shape::<contracts::CacheStatus>(cache)?;
        let partition = self.registration.partition();
        if cache.partition() != partition
            || source.source_instance_id != partition.source_instance_id
            || source.collection_id != partition.collection_id
            || cache.status != s::CacheState::Fresh
            || cache.error.is_some()
            || authority.source_registration_sha256 != digest(&self.registration)?
            || (self.registration.partition_mode == s::PartitionMode::ReviewedEntityAllowlist
                && !self
                    .registration
                    .allowed_external_ids
                    .contains(&source.external_id))
        {
            return Err(DomainError::UpstreamUnavailable);
        }
        let observed_at = cache
            .last_successful_fetch_at
            .clone()
            .ok_or(DomainError::UpstreamIncomplete)?;
        let generation_id = cache
            .generation_id
            .clone()
            .ok_or(DomainError::UpstreamIncomplete)?;
        let observation = match (&self.registration.owner, &source.source_kind, age) {
            (
                s::SourceOwner::Homebox,
                contracts::SourceKeySourceKind::HomeboxEntity,
                ConfiguredCacheAge::Homebox { stale_after_ms },
            ) => {
                if !self.publication.network_relations.is_empty()
                    || self.network_row.is_some()
                    || self.network_review.is_some()
                    || cache.consistency != hb::CONSISTENCY
                {
                    return Err(DomainError::UpstreamIncomplete);
                }
                let saved_cache = hb::CacheStatus {
                    schema_version: 1,
                    workspace_id: hb::Uuid::parse(&cache.workspace_id)
                        .map_err(|_| DomainError::InvalidContract)?,
                    home_id: hb::Uuid::parse(&cache.home_id)
                        .map_err(|_| DomainError::InvalidContract)?,
                    source_instance_id: hb::Uuid::parse(&cache.source_instance_id)
                        .map_err(|_| DomainError::InvalidContract)?,
                    collection_id: cache.collection_id.clone(),
                    status: hb::CacheState::Fresh,
                    last_successful_fetch_at: Some(
                        hb::Timestamp::parse(&observed_at)
                            .map_err(|_| DomainError::InvalidContract)?,
                    ),
                    last_attempt_at: cache
                        .last_attempt_at
                        .as_deref()
                        .map(hb::Timestamp::parse)
                        .transpose()
                        .map_err(|_| DomainError::InvalidContract)?,
                    generation_id: Some(
                        hb::Uuid::parse(&generation_id)
                            .map_err(|_| DomainError::InvalidContract)?,
                    ),
                    consistency: hb::CONSISTENCY,
                    error: None,
                };
                let now = hb::Timestamp::parse(now).map_err(|_| DomainError::InvalidContract)?;
                if hb::cache_freshness(&saved_cache, &now, *stale_after_ms)
                    .0
                    .status
                    != hb::CacheState::Fresh
                {
                    return Err(DomainError::UpstreamUnavailable);
                }
                let mut member = None;
                for row in &self.publication.homebox_entities {
                    // Shape-check every saved row but digest the original Value:
                    // round-tripping a narrower projection would discard fields.
                    shape::<contracts::HomeboxProjection>(row)?;
                    if row["workspaceId"] != partition.workspace_id
                        || row["homeId"] != partition.home_id
                        || row["source"]["sourceInstanceId"] != partition.source_instance_id
                        || row["source"]["collectionId"] != partition.collection_id
                    {
                        return Err(DomainError::UpstreamIncomplete);
                    }
                    if row["source"]
                        == serde_json::to_value(source).map_err(|_| DomainError::InvalidContract)?
                        && member.replace(row).is_some()
                    {
                        return Err(DomainError::UpstreamIncomplete);
                    }
                }
                let row = member.ok_or(DomainError::UpstreamUnavailable)?;
                let explicit_kind = row["entity"]["entityType"]["isLocation"]
                    .as_bool()
                    .map(|location| if location { "location" } else { "item" });
                if row["entity"]["archived"] != false
                    || row["entity"]["id"] != source.external_id
                    || explicit_kind != Some(identity_kind)
                {
                    return Err(DomainError::UpstreamUnavailable);
                }
                wire::PresenceObservation::HomeboxEntity {
                    member_sha256: digest(row)?,
                    member_retrieved_at: text(row, "retrievedAt")?,
                    source_updated_at: nullable_text(row, "sourceUpdatedAt")?,
                }
            }
            (
                s::SourceOwner::Network,
                contracts::SourceKeySourceKind::NetworkDevice
                | contracts::SourceKeySourceKind::NetworkGroup,
                ConfiguredCacheAge::Network { stale_after_ms },
            ) => {
                if !self.publication.homebox_entities.is_empty() {
                    return Err(DomainError::UpstreamIncomplete);
                }
                let registration: net::SourceRegistration = carrier(&self.registration)?;
                let saved_cache: net::CacheMetadata = carrier(cache)?;
                let relations: Vec<net::NetworkRelation> =
                    carrier(&self.publication.network_relations)?;
                let row = self
                    .network_row
                    .as_ref()
                    .ok_or(DomainError::UpstreamUnavailable)?;
                let review = self
                    .network_review
                    .as_ref()
                    .ok_or(DomainError::UpstreamUnavailable)?;
                let state =
                    net::reopen_sidecar(&registration, &saved_cache, &relations, row, Some(review))
                        .map_err(|_| DomainError::UpstreamIncomplete)?;
                if net::build_facet(&registration, &state, now, *stale_after_ms)
                    .map_err(|_| DomainError::InvalidContract)?
                    .status
                    != net::FacetStatus::Fresh
                {
                    return Err(DomainError::UpstreamUnavailable);
                }
                let generation = state
                    .generation
                    .as_ref()
                    .ok_or(DomainError::UpstreamIncomplete)?;
                let members = match source.source_kind {
                    contracts::SourceKeySourceKind::NetworkDevice => &generation.inventory.devices,
                    _ => &generation.inventory.groups,
                };
                let matches: Vec<_> = members
                    .iter()
                    .filter(|member| member.external_id == source.external_id)
                    .collect();
                if matches.len() != 1 {
                    return Err(DomainError::UpstreamUnavailable);
                }
                wire::PresenceObservation::NetworkInventory {
                    member_sha256: digest(matches[0])?,
                    verified_generation_sha256: row.sha256.clone(),
                    generation_retrieved_at: generation.retrieved_at.clone(),
                    source_snapshot_at: generation.source_snapshot_at.clone(),
                }
            }
            _ => return Err(DomainError::UpstreamUnavailable),
        };
        let qualification = wire::PresenceQualification {
            binding_record_id: binding_record_id.to_owned(),
            source: source.clone(),
            observed_at: observed_at.clone(),
            cache: wire::PresenceCache {
                generation_id,
                cache_epoch: carrier(&self.publication.cache_epoch)?,
                status: wire::PresenceCacheStatus::Fresh,
                last_successful_fetch_at: observed_at,
            },
            authority: authority.clone(),
            observation,
        };
        wire::validate_presence_qualification(&qualification)
            .map_err(|_| DomainError::InvalidContract)?;
        Ok(qualification)
    }
}

fn text(row: &Value, key: &str) -> DomainResult<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(DomainError::UpstreamIncomplete)
}
fn nullable_text(row: &Value, key: &str) -> DomainResult<Option<String>> {
    match row.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        _ => Err(DomainError::UpstreamIncomplete),
    }
}
