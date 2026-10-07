//! Thin binding to AT07's actual consuming AtlasStore cache transactions.
//! No grants, connection handles, fallback writers or provider I/O are supplied.
use super::*;
use crate::storage;
use serde::{Serialize, de::DeserializeOwned};

/// Borrow the principal that retains this ORIGINAL inventory authority lease.
/// Host implementations must not reacquire authority or discard branded handles.
/// AtlasStore's authorizer revalidates it inside each transaction at precommit.
pub trait NativeNetworkLease<A: storage::Authorization> {
    fn storage_principal(&self) -> &A::Principal;
}

/// Borrow only for synchronous prepare/commit phases; release this wrapper while
/// provider work is pending. Recreate it over the SAME open store for commit.
pub struct NativeNetworkPublisher<'s, C, A, R> {
    store: &'s mut storage::AtlasStore<C, A, R>,
}
impl<'s, C, A, R> NativeNetworkPublisher<'s, C, A, R>
where
    C: storage::Contract,
    A: storage::Authorization,
    R: storage::Runtime,
{
    pub fn new(store: &'s mut storage::AtlasStore<C, A, R>) -> Self {
        Self { store }
    }
    /// Explicit valid status publication with the original issuing-store fence.
    /// This calls ONLY the fenced AT07 method published at 9b13f1e97635a3f531e8c14642cd3c5e94401fef.
    pub fn record_prepared_cache_failure<L: NativeNetworkLease<A>>(
        &mut self,
        fence: storage::CachePublicationFence,
        code: ErrorCode,
        lease: &L,
    ) -> storage::Result<storage::CacheStatus> {
        ensure(fence.registration().owner == storage::SourceOwner::Network)?;
        let failure = storage::CacheFailure {
            code: convert(&code)?,
            status: None,
        };
        self.store
            .record_prepared_cache_failure(lease.storage_principal(), fence, &failure)
    }
    /// Consume the retained failed-read proposal with its original fence and
    /// original lease. Storage repeats the baseline comparisons IN its write
    /// transaction; checking these local carriers is never a CAS substitute.
    pub fn publish_pending_failure<L: NativeNetworkLease<A>>(
        &mut self,
        pending: PendingNetworkFailure<storage::CachePublicationFence, L>,
    ) -> storage::Result<storage::CacheStatus> {
        let (fence, expected, failure, lease) = pending.into_parts();
        matches_precondition(&fence, &expected)?;
        ensure(failure.state.cache.scope == NetworkPublicationFence::partition(&fence))?;
        self.record_prepared_cache_failure(fence, failure.error.code, lease.as_ref())
    }
}
impl NetworkPublicationFence for storage::CachePublicationFence {
    fn partition(&self) -> SourceScope {
        let partition = storage::CachePublicationFence::partition(self);
        SourceScope {
            workspace_id: partition.workspace_id.clone(),
            home_id: partition.home_id.clone(),
            source_instance_id: partition.source_instance_id.clone(),
            collection_id: partition.collection_id.clone(),
        }
    }
    fn baseline_generation_id(&self) -> Option<&str> {
        storage::CachePublicationFence::baseline_generation_id(self)
    }
    fn baseline_cache_epoch(&self) -> u64 {
        storage::CachePublicationFence::baseline_cache_epoch(self).value()
    }
    fn reserved_generation_id(&self) -> &str {
        storage::CachePublicationFence::reserved_generation_id(self)
    }
}
impl<C, A, R, L> NetworkCachePublisher<L> for NativeNetworkPublisher<'_, C, A, R>
where
    C: storage::Contract,
    A: storage::Authorization,
    R: storage::Runtime,
    L: NativeNetworkLease<A>,
{
    type Fence = storage::CachePublicationFence;
    type Receipt = storage::CacheStatus;
    type Error = storage::Error;
    fn prepare_cache_publication(
        &mut self,
        source: &SourceRegistration,
        lease: &L,
    ) -> storage::Result<PreparedNetworkCache<Self::Fence>> {
        super::projection::validate_registration(source).map_err(|_| {
            storage::Error::new("invalid-contract", "Network source registration is invalid")
        })?;
        let registration: storage::SourceRegistration = convert(source)?;
        let (state, fence) = self
            .store
            .prepare_cache_publication(
                lease.storage_principal(),
                &registration.scope(),
                &registration.partition(),
            )?
            .into_parts();
        ensure(fence.registration() == &registration)?;
        Ok(PreparedNetworkCache {
            baseline: convert(&state)?,
            fence,
        })
    }
    fn publish_prepared_generation<S>(
        &mut self,
        fence: Self::Fence,
        staged: StagedNetworkPublication<S>,
        lease: &L,
    ) -> storage::Result<Self::Receipt> {
        ensure(fence.registration().owner == storage::SourceOwner::Network)?;
        let (proposal, _durable_receipt) = staged.into_parts();
        matches_precondition(&fence, proposal.precondition())?;
        ensure(
            proposal.state().cache.scope == NetworkPublicationFence::partition(&fence)
                && proposal.state().cache.generation_id.as_deref()
                    == Some(fence.reserved_generation_id()),
        )?;
        let generation = proposal.state().generation.as_ref().ok_or_else(conflict)?;
        let cache: storage::CacheStatus = convert(&proposal.state().cache)?;
        let rows = generation
            .network_relations
            .iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        self.store
            .publish_prepared_generation(lease.storage_principal(), fence, &cache, &[], &rows)
    }
}
fn matches_precondition(
    fence: &storage::CachePublicationFence,
    expected: &PublicationPrecondition,
) -> storage::Result<()> {
    ensure(
        expected.expected_generation_id.as_deref() == fence.baseline_generation_id()
            && expected.expected_cache_epoch == fence.baseline_cache_epoch().value(),
    )
}
fn convert<T: Serialize, U: DeserializeOwned>(value: &T) -> storage::Result<U> {
    Ok(serde_json::from_value(serde_json::to_value(value)?)?)
}
fn conflict() -> storage::Error {
    storage::Error::new(
        "guard-conflict",
        "Network proposal does not match its pre-fetch fence",
    )
}
fn ensure(condition: bool) -> storage::Result<()> {
    if condition { Ok(()) } else { Err(conflict()) }
}
