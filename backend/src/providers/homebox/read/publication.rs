//! Consuming adapter for AT07's actual store-issued publication fence.
use super::*;
use crate::storage::{self, AtlasStore, Authorization, Contract, Runtime};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublishError {
    ScopeMismatch,
    RegistrationMismatch,
    InvalidRetainedState,
    Quarantined,
    StoreRejected,
}
impl fmt::Display for PublishError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ScopeMismatch => "Publication scope does not match the reader.",
            Self::RegistrationMismatch => "Reader does not match the durable source registration.",
            Self::InvalidRetainedState => {
                "Retained generation does not match the published contract."
            }
            Self::Quarantined => "Source requires separately authorized scope revalidation.",
            Self::StoreRejected => "Complete-generation publication was not accepted by storage.",
        })
    }
}
impl std::error::Error for PublishError {}

/// No Clone/Deserialize/construction from raw rows or a caller-supplied fence.
/// The exact borrowed principal survives preparation, GET and commit.
pub struct PreparedGeneration<'a, P> {
    principal: &'a P,
    fence: storage::CachePublicationFence,
    previous: PreviousGeneration,
}
pub struct StagedPublication<'a, P> {
    principal: &'a P,
    fence: storage::CachePublicationFence,
    generation: CompleteGeneration,
}
pub enum RefreshError<'a, P> {
    Publication(PublishError),
    Read(Box<FailedPublication<'a, P>>),
}
impl<P> fmt::Debug for RefreshError<'_, P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Publication(error) => f.debug_tuple("Publication").field(error).finish(),
            Self::Read(error) => f.debug_tuple("Read").field(error).finish(),
        }
    }
}
impl<P> fmt::Display for RefreshError<'_, P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Publication(error) => fmt::Display::fmt(error, f),
            Self::Read(error) => fmt::Display::fmt(error, f),
        }
    }
}
impl<P> std::error::Error for RefreshError<'_, P> {}
impl<T: Transport, K: Clock> HomeBoxReader<T, K> {
    pub fn prepare_publication<'a, C: Contract, A: Authorization, R: Runtime>(
        &self,
        store: &mut AtlasStore<C, A, R>,
        principal: &'a A::Principal,
    ) -> Result<PreparedGeneration<'a, A::Principal>, PublishError> {
        let partition = storage::SourcePartition {
            workspace_id: self.scope().workspace_id.as_str().into(),
            home_id: self.scope().home_id.as_str().into(),
            source_instance_id: self.scope().source_instance_id.as_str().into(),
            collection_id: self.scope().collection_id.clone(),
        };
        let prepared = store
            .prepare_cache_publication(principal, &partition.scope(), &partition)
            .map_err(|_| PublishError::StoreRejected)?;
        if !matches_registration(self.registration(), prepared.fence().registration()) {
            return Err(PublishError::RegistrationMismatch);
        }
        let (state, fence) = prepared.into_parts();
        let previous = super::retained::previous(state, self.scope())?;
        Ok(PreparedGeneration {
            principal,
            fence,
            previous,
        })
    }
}
impl<'a, P> PreparedGeneration<'a, P> {
    pub fn fence(&self) -> &storage::CachePublicationFence {
        &self.fence
    }
    pub fn previous(&self) -> &PreviousGeneration {
        &self.previous
    }
    pub async fn fetch<T: Transport, K: Clock>(
        self,
        reader: &mut HomeBoxReader<T, K>,
    ) -> Result<StagedPublication<'a, P>, RefreshError<'a, P>> {
        let partition = self.fence.partition();
        let scope = reader.scope();
        if partition.workspace_id != scope.workspace_id.as_str()
            || partition.home_id != scope.home_id.as_str()
            || partition.source_instance_id != scope.source_instance_id.as_str()
            || partition.collection_id != scope.collection_id
        {
            return Err(RefreshError::Publication(PublishError::ScopeMismatch));
        }
        // Repeat on the consuming reader: a caller may pass a different reader
        // after preparation. Scope alone does not establish complete coverage.
        if !matches_registration(reader.registration(), self.fence.registration()) {
            return Err(RefreshError::Publication(
                PublishError::RegistrationMismatch,
            ));
        }
        // An ordinary refresh cannot turn durable quarantine into fresh access.
        if self.previous.cache().quarantined() || self.previous.quarantine {
            return Err(RefreshError::Publication(PublishError::Quarantined));
        }
        let id = Uuid::parse(self.fence.reserved_generation_id())
            .map_err(|_| RefreshError::Publication(PublishError::InvalidRetainedState))?;
        let generation = match reader.fetch_generation(Some(&self.previous), id).await {
            Ok(generation) => generation,
            Err(failure) => {
                return Err(RefreshError::Read(Box::new(FailedPublication {
                    principal: self.principal,
                    fence: self.fence,
                    failure,
                })));
            }
        };
        Ok(StagedPublication {
            principal: self.principal,
            fence: self.fence,
            generation,
        })
    }
}
fn matches_registration(
    reader: &SourceRegistration,
    durable: &storage::SourceRegistration,
) -> bool {
    use std::collections::BTreeSet;
    reader.workspace_id.as_str() == durable.workspace_id
        && reader.home_id.as_str() == durable.home_id
        && reader.source_instance_id.as_str() == durable.source_instance_id
        && reader.collection_id == durable.collection_id
        && reader.owner == "homebox"
        && durable.owner == storage::SourceOwner::Homebox
        && matches!(
            (reader.partition_mode, durable.partition_mode),
            (
                PartitionMode::ExclusiveHome,
                storage::PartitionMode::ExclusiveHome
            ) | (
                PartitionMode::ReviewedEntityAllowlist,
                storage::PartitionMode::ReviewedEntityAllowlist
            )
        )
        && reader
            .allowed_external_ids
            .iter()
            .map(Uuid::as_str)
            .collect::<BTreeSet<_>>()
            == durable
                .allowed_external_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
}
impl<P> StagedPublication<'_, P> {
    pub fn generation(&self) -> &CompleteGeneration {
        &self.generation
    }
    pub fn commit<C: Contract, A: Authorization<Principal = P>, R: Runtime>(
        self,
        store: &mut AtlasStore<C, A, R>,
    ) -> Result<storage::CacheStatus, PublishError> {
        if self.generation.quarantine() {
            return Err(PublishError::Quarantined);
        }
        let cache = serde_json::from_value(
            serde_json::to_value(self.generation.cache())
                .map_err(|_| PublishError::InvalidRetainedState)?,
        )
        .map_err(|_| PublishError::InvalidRetainedState)?;
        let rows = self
            .generation
            .entities()
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| PublishError::InvalidRetainedState)?;
        store
            .publish_prepared_generation(self.principal, self.fence, &cache, &rows, &[])
            .map_err(|_| PublishError::StoreRejected)
    }
}
