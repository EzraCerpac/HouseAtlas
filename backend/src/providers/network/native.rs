//! Thin binding to AT07's actual consuming AtlasStore cache transactions.
//! No grants, connection handles, fallback writers or provider I/O are supplied.
use super::*;
use crate::storage;
use serde::{Serialize, de::DeserializeOwned};
use std::sync::Arc;

/// Borrow the principal that retains this ORIGINAL inventory authority lease.
/// Host implementations must not reacquire authority or discard branded handles.
/// The selected authorizer revalidates it inside each transaction at precommit.
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
    /// Keep the same open store and borrow the original call authorizer. Its
    /// principal type may differ from the store's configured authorizer.
    pub fn with_authorization<B: storage::Authorization>(
        self,
        authorization: &B,
    ) -> BorrowedNativeNetworkPublisher<'s, '_, C, A, R, B> {
        BorrowedNativeNetworkPublisher {
            store: self.store,
            authorization,
        }
    }
    /// Explicit valid status publication with the original issuing-store fence.
    /// This consumes the actual AT07 fence inside its native transaction.
    pub fn record_prepared_cache_failure<L: NativeNetworkLease<A>>(
        &mut self,
        fence: storage::CachePublicationFence,
        code: ErrorCode,
        lease: &L,
    ) -> storage::Result<storage::CacheStatus> {
        let failure = failure_input(&fence, code)?;
        self.store
            .record_prepared_cache_failure(lease.storage_principal(), fence, &failure)
    }
    /// Publish the attempt time already captured by the original provider read.
    /// The native transaction validates it with the same fence and lease.
    pub fn record_prepared_cache_failure_at<L: NativeNetworkLease<A>>(
        &mut self,
        fence: storage::CachePublicationFence,
        code: ErrorCode,
        lease: &L,
        attempted_at: &str,
    ) -> storage::Result<storage::CacheStatus> {
        let failure = failure_input(&fence, code)?;
        self.store.record_prepared_cache_failure_at(
            lease.storage_principal(),
            fence,
            &failure,
            attempted_at,
        )
    }
    /// Consume the retained failed-read proposal with its original fence and
    /// original lease. Storage repeats the baseline comparisons IN its write
    /// transaction; checking these local carriers is never a CAS substitute.
    pub fn publish_pending_failure<L: NativeNetworkLease<A>>(
        &mut self,
        pending: PendingNetworkFailure<storage::CachePublicationFence, L>,
    ) -> storage::Result<storage::CacheStatus> {
        let (fence, code, lease, attempted_at) = pending_input(pending)?;
        self.record_prepared_cache_failure_at(fence, code, lease.as_ref(), &attempted_at)
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
        let registration = registration_input(source)?;
        let prepared = self.store.prepare_cache_publication(
            lease.storage_principal(),
            &registration.scope(),
            &registration.partition(),
        )?;
        prepared_output(&registration, prepared)
    }
    fn publish_prepared_generation<S>(
        &mut self,
        fence: Self::Fence,
        staged: StagedNetworkPublication<S>,
        lease: &L,
    ) -> storage::Result<Self::Receipt> {
        let (cache, rows) = publication_input(&fence, staged)?;
        self.store
            .publish_prepared_generation(lease.storage_principal(), fence, &cache, &[], &rows)
    }
}
/// Same-store adapter whose every cache transaction uses one borrowed call
/// authorizer. No clone, fallback, second connection or replacement fence.
pub struct BorrowedNativeNetworkPublisher<'s, 'b, C, A, R, B> {
    store: &'s mut storage::AtlasStore<C, A, R>,
    authorization: &'b B,
}
impl<C, A, R, B> BorrowedNativeNetworkPublisher<'_, '_, C, A, R, B>
where
    C: storage::Contract,
    A: storage::Authorization,
    R: storage::Runtime,
    B: storage::Authorization,
{
    /// Commit the exact original staged object through Store's custody-aware
    /// path. The Network archive guard verifies immutable raw bytes while the
    /// Store holds its own IMMEDIATE transaction and pin registry.
    pub fn publish_staged_generation_with_custody<L>(
        &mut self,
        fence: storage::CachePublicationFence,
        staged: StagedNetworkPublication<NetworkStagingReceipt<DurableNetworkReceipt>>,
        lease: &L,
        references: &mut impl storage::OriginalCacheReferences<
            Staged = StagedNetworkPublication<NetworkStagingReceipt<DurableNetworkReceipt>>,
        >,
    ) -> storage::Result<storage::CacheStatus>
    where
        L: NativeNetworkLease<B>,
    {
        let published = self
            .store
            .publish_staged_generation_with_authorization(
                self.authorization,
                lease.storage_principal(),
                fence,
                staged,
                references,
            )
            .map_err(|rejected| rejected.into_parts().0)?;
        Ok(published.cache().clone())
    }
    pub fn record_prepared_cache_failure<L: NativeNetworkLease<B>>(
        &mut self,
        fence: storage::CachePublicationFence,
        code: ErrorCode,
        lease: &L,
    ) -> storage::Result<storage::CacheStatus> {
        let failure = failure_input(&fence, code)?;
        self.store.record_prepared_cache_failure_with_authorization(
            self.authorization,
            lease.storage_principal(),
            fence,
            &failure,
        )
    }
    /// Preserve the captured attempt time through the original call authority.
    pub fn record_prepared_cache_failure_at<L: NativeNetworkLease<B>>(
        &mut self,
        fence: storage::CachePublicationFence,
        code: ErrorCode,
        lease: &L,
        attempted_at: &str,
    ) -> storage::Result<storage::CacheStatus> {
        let failure = failure_input(&fence, code)?;
        self.store
            .record_prepared_cache_failure_at_with_authorization(
                self.authorization,
                lease.storage_principal(),
                fence,
                &failure,
                attempted_at,
            )
    }
    pub fn publish_pending_failure<L: NativeNetworkLease<B>>(
        &mut self,
        pending: PendingNetworkFailure<storage::CachePublicationFence, L>,
    ) -> storage::Result<storage::CacheStatus> {
        let (fence, code, lease, attempted_at) = pending_input(pending)?;
        self.record_prepared_cache_failure_at(fence, code, lease.as_ref(), &attempted_at)
    }
}
impl<C, A, R, B, L> NetworkCachePublisher<L> for BorrowedNativeNetworkPublisher<'_, '_, C, A, R, B>
where
    C: storage::Contract,
    A: storage::Authorization,
    R: storage::Runtime,
    B: storage::Authorization,
    L: NativeNetworkLease<B>,
{
    type Fence = storage::CachePublicationFence;
    type Receipt = storage::CacheStatus;
    type Error = storage::Error;
    fn prepare_cache_publication(
        &mut self,
        source: &SourceRegistration,
        lease: &L,
    ) -> storage::Result<PreparedNetworkCache<Self::Fence>> {
        let registration = registration_input(source)?;
        let prepared = self.store.prepare_cache_publication_with_authorization(
            self.authorization,
            lease.storage_principal(),
            &registration.scope(),
            &registration.partition(),
        )?;
        prepared_output(&registration, prepared)
    }
    fn publish_prepared_generation<S>(
        &mut self,
        fence: Self::Fence,
        staged: StagedNetworkPublication<S>,
        lease: &L,
    ) -> storage::Result<Self::Receipt> {
        let (cache, rows) = publication_input(&fence, staged)?;
        self.store.publish_prepared_generation_with_authorization(
            self.authorization,
            lease.storage_principal(),
            fence,
            &cache,
            &[],
            &rows,
        )
    }
}
fn registration_input(source: &SourceRegistration) -> storage::Result<storage::SourceRegistration> {
    super::projection::validate_registration(source).map_err(|_| {
        storage::Error::new("invalid-contract", "Network source registration is invalid")
    })?;
    convert(source)
}
fn prepared_output(
    registration: &storage::SourceRegistration,
    prepared: storage::PreparedCachePublication,
) -> storage::Result<PreparedNetworkCache<storage::CachePublicationFence>> {
    let (state, fence) = prepared.into_parts();
    ensure(fence.registration() == registration)?;
    Ok(PreparedNetworkCache {
        baseline: convert(&state)?,
        fence,
    })
}
fn publication_input<S>(
    fence: &storage::CachePublicationFence,
    staged: StagedNetworkPublication<S>,
) -> storage::Result<(storage::CacheStatus, Vec<serde_json::Value>)> {
    ensure(fence.registration().owner == storage::SourceOwner::Network)?;
    let (proposal, _durable_receipt) = staged.into_parts();
    matches_precondition(fence, proposal.precondition())?;
    ensure(
        proposal.state().cache.scope == NetworkPublicationFence::partition(fence)
            && proposal.state().cache.generation_id.as_deref()
                == Some(fence.reserved_generation_id()),
    )?;
    let generation = proposal.state().generation.as_ref().ok_or_else(conflict)?;
    let cache = convert(&proposal.state().cache)?;
    let rows = generation
        .network_relations
        .iter()
        .map(serde_json::to_value)
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok((cache, rows))
}
fn failure_input(
    fence: &storage::CachePublicationFence,
    code: ErrorCode,
) -> storage::Result<storage::CacheFailure> {
    ensure(fence.registration().owner == storage::SourceOwner::Network)?;
    Ok(storage::CacheFailure {
        code: convert(&code)?,
        status: None,
    })
}
fn pending_input<L>(
    pending: PendingNetworkFailure<storage::CachePublicationFence, L>,
) -> storage::Result<(storage::CachePublicationFence, ErrorCode, Arc<L>, String)> {
    let (fence, expected, failure, lease) = pending.into_parts();
    matches_precondition(&fence, &expected)?;
    ensure(failure.state.cache.scope == NetworkPublicationFence::partition(&fence))?;
    let cache_error = failure.state.cache.error.ok_or_else(conflict)?;
    ensure(
        cache_error.code == failure.error.code
            && failure.state.cache.last_attempt_at.as_deref() == Some(cache_error.at.as_str()),
    )?;
    Ok((fence, failure.error.code, lease, cache_error.at))
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
