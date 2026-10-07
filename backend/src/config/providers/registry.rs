//! Immutable registrations supplied by trusted host configuration.
//! These values contain no endpoint, credential, grant or administration right.
use crate::{access as a, contracts, storage as s};
use std::{collections::BTreeSet, sync::Arc};

/// No Deserialize implementation: HTTP input is not a configured source.
pub struct ConfiguredSource {
    registration: s::SourceRegistration,
    access_registration: a::SourceRegistration,
}
impl ConfiguredSource {
    pub fn registration(&self) -> &s::SourceRegistration {
        &self.registration
    }
    pub fn access_registration(&self) -> &a::SourceRegistration {
        &self.access_registration
    }
    pub fn partition(&self) -> a::SourcePartition {
        self.access_registration.partition()
    }
    /// Membership in configuration is metadata, never an access decision.
    pub fn contains(&self, reference: &a::SourceRef) -> bool {
        let owner = match reference.key.source_kind {
            a::SourceKind::HomeboxEntity => a::SourceOwner::Homebox,
            a::SourceKind::MagicplanRoom => a::SourceOwner::Magicplan,
            _ => a::SourceOwner::Network,
        };
        reference.partition() == self.partition()
            && owner == self.access_registration.owner
            && (self.access_registration.partition_mode == a::PartitionMode::ExclusiveHome
                || self
                    .access_registration
                    .allowed_external_ids
                    .contains(&reference.key.external_id))
    }
}

/// Construct only from the host's reviewed configuration, before provider work.
/// Validation preserves every selector and allowlist entry without normalization.
pub struct ProviderRegistry {
    sources: Vec<Arc<ConfiguredSource>>,
}
impl ProviderRegistry {
    pub fn from_trusted_configuration(
        registrations: Vec<s::SourceRegistration>,
    ) -> a::AccessResult<Self> {
        let mut sources: Vec<Arc<ConfiguredSource>> = Vec::new();
        for registration in registrations {
            contracts::decode::<contracts::SourceRegistration>(
                &serde_json::to_vec(&registration).map_err(|_| a::AccessError::InvalidInput)?,
            )
            .map_err(|_| a::AccessError::InvalidInput)?;
            let ids: BTreeSet<_> = registration.allowed_external_ids.iter().collect();
            if ids.len() != registration.allowed_external_ids.len()
                || (registration.partition_mode == s::PartitionMode::ExclusiveHome
                    && !ids.is_empty())
            {
                return Err(a::AccessError::InvalidInput);
            }
            let owner = match registration.owner {
                s::SourceOwner::Homebox => {
                    for id in &registration.allowed_external_ids {
                        a::CanonicalId::parse(id)?;
                    }
                    a::SourceOwner::Homebox
                }
                s::SourceOwner::Network => a::SourceOwner::Network,
                s::SourceOwner::Magicplan => a::SourceOwner::Magicplan,
            };
            let access_registration = a::SourceRegistration {
                workspace_id: a::CanonicalId::parse(&registration.workspace_id)?,
                home_id: a::CanonicalId::parse(&registration.home_id)?,
                source_instance_id: a::CanonicalId::parse(&registration.source_instance_id)?,
                collection_id: registration.collection_id.clone(),
                owner,
                partition_mode: match registration.partition_mode {
                    s::PartitionMode::ExclusiveHome => a::PartitionMode::ExclusiveHome,
                    s::PartitionMode::ReviewedEntityAllowlist => {
                        a::PartitionMode::ReviewedEntityAllowlist
                    }
                },
                allowed_external_ids: registration.allowed_external_ids.clone(),
            };
            for other in &sources {
                let other = other.registration();
                if other.workspace_id == registration.workspace_id
                    && other.source_instance_id == registration.source_instance_id
                    && other.collection_id == registration.collection_id
                    && (other.home_id == registration.home_id
                        || other.owner != registration.owner
                        || other.partition_mode == s::PartitionMode::ExclusiveHome
                        || registration.partition_mode == s::PartitionMode::ExclusiveHome
                        || other.allowed_external_ids.iter().any(|id| ids.contains(id)))
                {
                    return Err(a::AccessError::InvalidInput);
                }
            }
            sources.push(Arc::new(ConfiguredSource {
                registration,
                access_registration,
            }));
        }
        Ok(Self { sources })
    }
    pub fn sources(&self) -> &[Arc<ConfiguredSource>] {
        &self.sources
    }
    pub fn find(&self, partition: &a::SourcePartition) -> Option<&Arc<ConfiguredSource>> {
        self.sources
            .iter()
            .find(|source| source.partition() == *partition)
    }
}
