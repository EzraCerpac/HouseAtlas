//! Phased native Network binding. The root supplies scoped publication authority
//! on the same open Atlas store; browsing and GET hold no Atlas transaction.
use crate::{
    app::RequestPrincipal, config::providers::network::NetworkSettings, providers::network as n,
    storage as s,
};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

/// Original principal and captured branded grants, moved intact and sealed.
/// The mutex accommodates RequestPrincipal's RefCell without making it Sync or
/// reconstructing authority from its public actor/scope. No mutable loan exists.
pub struct NetworkAuthorityLease<M> {
    principal: Mutex<RequestPrincipal>,
    source: n::SourceRegistration,
    origin: n::ReviewedNetworkOrigin,
    membership: M,
}
impl<M> NetworkAuthorityLease<M> {
    /// The authority owner must first capture the full original source authority
    /// and membership. This container grants no ConfigureSource/PublishCache.
    pub fn from_captured(
        principal: RequestPrincipal,
        source: n::SourceRegistration,
        origin: n::ReviewedNetworkOrigin,
        membership: M,
    ) -> Self {
        principal.seal_source_capture();
        Self {
            principal: Mutex::new(principal),
            source,
            origin,
            membership,
        }
    }
    pub fn source(&self) -> &n::SourceRegistration {
        &self.source
    }
    pub fn origin(&self) -> &n::ReviewedNetworkOrigin {
        &self.origin
    }
    /// Original opaque whole-collection witness, retained without replacement.
    pub fn membership(&self) -> &M {
        &self.membership
    }
    /// Bounded nonblocking loan of that exact retained principal. Callback must
    /// not perform I/O or wait on a lock when called by transport authority.
    pub fn with_principal<T>(
        &self,
        operation: impl FnOnce(&RequestPrincipal) -> s::Result<T>,
    ) -> s::Result<T> {
        let principal = self.principal.try_lock().map_err(|_| unavailable())?;
        operation(&principal)
    }
}

/// Root-owned synchronous access/store seam. Implement using the actual scoped
/// authorizer, original lease and SAME issuing store at every phase. There are
/// no permissive defaults and no connection/reconstructed-principal fallback.
pub trait NetworkPublicationHost<M>: Send + Sync {
    fn prepare(
        &self,
        source: &n::SourceRegistration,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<n::PreparedNetworkCache<s::CachePublicationFence>>;
    fn publish(
        &self,
        fence: s::CachePublicationFence,
        staged: n::StagedNetworkPublication<n::DurableNetworkReceipt>,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<s::CacheStatus>;
    fn publish_failure(
        &self,
        fence: s::CachePublicationFence,
        code: n::ErrorCode,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<s::CacheStatus>;
}

struct BorrowedNativeLease<'p>(&'p RequestPrincipal);
impl<A: s::Authorization<Principal = RequestPrincipal>> n::NativeNetworkLease<A>
    for BorrowedNativeLease<'_>
{
    fn storage_principal(&self) -> &RequestPrincipal {
        self.0
    }
}
/// Concrete delegates for a store with an owner-approved publication authorizer.
/// The current app::ReadAuthority intentionally rejects these operations; the
/// root must provide its scoped authorizer seam before mounting refresh.
pub struct NativeNetworkPublication;
impl NativeNetworkPublication {
    pub fn prepare<C, A, R, M>(
        store: &mut s::AtlasStore<C, A, R>,
        source: &n::SourceRegistration,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<n::PreparedNetworkCache<s::CachePublicationFence>>
    where
        C: s::Contract,
        A: s::Authorization<Principal = RequestPrincipal>,
        R: s::Runtime,
    {
        use n::NetworkCachePublisher;
        if source != lease.source() {
            return Err(unavailable());
        }
        lease.with_principal(|principal| {
            n::NativeNetworkPublisher::new(store)
                .prepare_cache_publication(source, &BorrowedNativeLease(principal))
        })
    }
    pub fn publish<C, A, R, M>(
        store: &mut s::AtlasStore<C, A, R>,
        fence: s::CachePublicationFence,
        staged: n::StagedNetworkPublication<n::DurableNetworkReceipt>,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<s::CacheStatus>
    where
        C: s::Contract,
        A: s::Authorization<Principal = RequestPrincipal>,
        R: s::Runtime,
    {
        use n::NetworkCachePublisher;
        check_source(&fence, lease)?;
        lease.with_principal(|principal| {
            n::NativeNetworkPublisher::new(store).publish_prepared_generation(
                fence,
                staged,
                &BorrowedNativeLease(principal),
            )
        })
    }
    pub fn publish_failure<C, A, R, M>(
        store: &mut s::AtlasStore<C, A, R>,
        fence: s::CachePublicationFence,
        code: n::ErrorCode,
        lease: &NetworkAuthorityLease<M>,
    ) -> s::Result<s::CacheStatus>
    where
        C: s::Contract,
        A: s::Authorization<Principal = RequestPrincipal>,
        R: s::Runtime,
    {
        check_source(&fence, lease)?;
        lease.with_principal(|principal| {
            n::NativeNetworkPublisher::new(store).record_prepared_cache_failure(
                fence,
                code,
                &BorrowedNativeLease(principal),
            )
        })
    }
}
fn check_source<M>(
    fence: &s::CachePublicationFence,
    lease: &NetworkAuthorityLease<M>,
) -> s::Result<()> {
    let source: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(lease.source())?)?;
    if fence.registration() != &source {
        return Err(unavailable());
    }
    Ok(())
}
fn unavailable() -> s::Error {
    s::Error::new("unavailable", "Network authority unavailable")
}
fn network_error(code: n::ErrorCode) -> n::NetworkError {
    n::NetworkError::new(code)
}
fn cancelled(token: &CancellationToken) -> Result<(), n::NetworkError> {
    if token.is_cancelled() {
        Err(network_error(n::ErrorCode::Timeout))
    } else {
        Ok(())
    }
}
/// Internal lifecycle status. Public reads use the held retained facet binding;
/// these receipts do not grant browser disclosure or replace its release checks.
pub enum NetworkRefreshResult {
    Published(s::CacheStatus),
    SourceFailure(s::CacheStatus),
    AlreadyRunning,
}
pub struct NetworkRuntime {
    settings: NetworkSettings,
    sidecar: Mutex<n::SqliteNetworkSidecar>,
    flight: tokio::sync::Mutex<()>,
}
impl NetworkRuntime {
    pub fn open(settings: NetworkSettings) -> Result<Self, n::NetworkError> {
        let sidecar = settings.open_sidecar()?;
        Ok(Self {
            settings,
            sidecar: Mutex::new(sidecar),
            flight: tokio::sync::Mutex::new(()),
        })
    }
    pub fn settings(&self) -> &NetworkSettings {
        &self.settings
    }
    pub fn close(self) -> Result<(), n::NetworkError> {
        self.sidecar
            .into_inner()
            .map_err(|_| network_error(n::ErrorCode::Upstream))?
            .close()
    }
    pub(crate) fn retained(
        &self,
        cache: &n::CacheMetadata,
        relations: &[n::NetworkRelation],
    ) -> Result<n::RetainedState, n::NetworkError> {
        let state = if let Some(generation_id) = &cache.generation_id {
            use n::DurableNetworkSidecar;
            let sidecar = self
                .sidecar
                .try_lock()
                .map_err(|_| network_error(n::ErrorCode::Upstream))?;
            let row = sidecar.load(self.settings.source(), generation_id)?;
            n::reopen_sidecar(
                self.settings.source(),
                cache,
                relations,
                &row,
                Some(self.settings.review()),
            )?
        } else {
            n::RetainedState {
                cache: cache.clone(),
                generation: None,
            }
        };
        n::validate_state(self.settings.source(), &state, Some(self.settings.review()))?;
        Ok(state)
    }
    pub async fn refresh<A, P, C, M>(
        &self,
        authority: Arc<A>,
        publication: &P,
        cancellation: CancellationToken,
        clock: C,
    ) -> Result<NetworkRefreshResult, n::NetworkPublicationError<s::Error>>
    where
        M: Send + Sync,
        A: n::NetworkReadAuthority<Lease = NetworkAuthorityLease<M>>,
        P: NetworkPublicationHost<M>,
        C: FnMut() -> String,
    {
        cancelled(&cancellation)?;
        let config = self.settings.transport();
        let source = self.settings.source();
        let origin = config.reviewed_origin().clone();
        let lease = Arc::new(authority.authorize_inventory(source, &origin)?);
        if lease.source() != source || lease.origin().origin() != origin.origin() {
            return Err(network_error(n::ErrorCode::WrongScope).into());
        }
        authority.revalidate_inventory(&lease, source, &origin)?;
        cancelled(&cancellation)?;
        // Each caller checks its own original authority before learning that
        // this partition has work in progress. No second GET/detached task or
        // fabricated success receipt is supplied to an overlapping caller.
        let Ok(_flight) = self.flight.try_lock() else {
            return Ok(NetworkRefreshResult::AlreadyRunning);
        };
        let n::PreparedNetworkCache { baseline, fence } = publication
            .prepare(source, &lease)
            .map_err(n::NetworkPublicationError::Storage)?;
        check_source(&fence, &lease).map_err(n::NetworkPublicationError::Storage)?;
        if baseline.cache_epoch > 9_007_199_254_740_991
            || baseline.cache_epoch != fence.baseline_cache_epoch().value()
            || baseline
                .cache
                .as_ref()
                .and_then(|cache| cache.generation_id.as_deref())
                != fence.baseline_generation_id()
            || !baseline.homebox_entities.is_empty()
        {
            return Err(network_error(n::ErrorCode::InvalidSchema).into());
        }
        let cache = baseline
            .cache
            .unwrap_or_else(|| n::RetainedState::empty(source.scope.clone()).cache);
        let prior = self.retained(&cache, &baseline.network_relations)?;
        let transport = n::HttpInventoryTransport::new(
            config,
            authority.clone(),
            lease.clone(),
            cancellation.clone(),
        )?;
        // Store and sidecar borrows have ended before this real HTTPS await.
        let outcome = self
            .settings
            .provider()?
            .prepare_refresh(
                &prior,
                baseline.cache_epoch,
                fence.reserved_generation_id(),
                &transport,
                clock,
            )
            .await?;
        cancelled(&cancellation)?;
        authority.revalidate_inventory(&lease, source, &origin)?;
        cancelled(&cancellation)?;
        match outcome {
            n::RefreshOutcome::Complete(proposal) => {
                let generation = proposal
                    .state()
                    .generation
                    .as_ref()
                    .ok_or_else(|| network_error(n::ErrorCode::InvalidSchema))?;
                authority.authorize_generation(&lease, source, generation)?;
                cancelled(&cancellation)?;
                let staged = {
                    let mut sidecar = self
                        .sidecar
                        .try_lock()
                        .map_err(|_| network_error(n::ErrorCode::Upstream))?;
                    n::stage_complete_generation(source, *proposal, &mut *sidecar)?
                };
                cancelled(&cancellation)?;
                authority.revalidate_inventory(&lease, source, &origin)?;
                cancelled(&cancellation)?;
                let receipt = publication
                    .publish(fence, staged, &lease)
                    .map_err(n::NetworkPublicationError::Storage)?;
                authority.revalidate_inventory(&lease, source, &origin)?;
                cancelled(&cancellation)?;
                Ok(NetworkRefreshResult::Published(receipt))
            }
            n::RefreshOutcome::Failed(failure) => {
                let receipt = publication
                    .publish_failure(fence, failure.error.code, &lease)
                    .map_err(n::NetworkPublicationError::Storage)?;
                authority.revalidate_inventory(&lease, source, &origin)?;
                cancelled(&cancellation)?;
                Ok(NetworkRefreshResult::SourceFailure(receipt))
            }
        }
    }
}
