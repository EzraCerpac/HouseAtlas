//! Closed native provider authority across phased Network work. No issuing-store
//! fence, live authorizer or access transaction escapes into the host leaf.
use crate::{
    access as a,
    app::{Core, Store},
    config::providers::network::NetworkSettings,
    lifecycle::providers::authority::{
        NativeLifecycleAuthority, PreparedProviderPublication, ProviderLease,
    },
    providers::network as n,
    storage as s,
};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

/// Actual owner lease retaining the original opaque principal, lifecycle grant,
/// partition and entity handles. Root uses retain_original for existing request
/// captures; no RequestPrincipal or replacement authority is constructed here.
pub type NetworkAuthorityLease = ProviderLease<a::LifecycleGrant>;
pub type PreparedNetworkPublication = PreparedProviderPublication<a::LifecycleGrant>;

/// Concrete closed delegates borrow the SAME open app::Store. The authority
/// owner alone loans its scoped authorizer inside the held access transaction.
/// ReadAuthority stays unchanged; no raw fence or caller authorizer escapes.
pub struct NativeNetworkPublication;
impl NativeNetworkPublication {
    pub fn prepare(
        store: &mut Store,
        lease: &Arc<NetworkAuthorityLease>,
    ) -> s::Result<PreparedNetworkPublication> {
        lease.prepare_publication(&NativeLifecycleAuthority, store)
    }
    pub fn publish(
        store: &mut Store,
        prepared: PreparedNetworkPublication,
        staged: n::StagedNetworkPublication<n::DurableNetworkReceipt>,
    ) -> s::Result<s::CacheStatus> {
        prepared.publish_network(&NativeLifecycleAuthority, store, staged)
    }
    pub fn publish_failure(
        store: &mut Store,
        prepared: PreparedNetworkPublication,
        code: n::ErrorCode,
    ) -> s::Result<s::CacheStatus> {
        // Actual consuming generation/epoch CAS; no baseline reread/rebase or
        // call to the legacy unfenced record_cache_failure method.
        let failure = s::CacheFailure {
            code: serde_json::from_value(serde_json::to_value(code)?)?,
            status: None,
        };
        prepared.record_failure(&NativeLifecycleAuthority, store, &failure)
    }
}

/// Internal status. Public reads use held facets and original disclosure grants,
/// independently of publication approval.
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
    /// Release every store/access borrow during HTTPS. Only the opaque prepared
    /// carrier with its exact original lease and private fence survives I/O.
    /// The transport owner must supply genuine bounded, nonblocking callbacks
    /// with NO file I/O; the native lease's SQLite revalidation is performed in
    /// the outer phases and cannot substitute for those callbacks. Existing
    /// session material remains private to that owner, never acquired here.
    pub async fn refresh<A, C>(
        &self,
        core: &Arc<Mutex<Core>>,
        authority: Arc<A>,
        lease: Arc<NetworkAuthorityLease>,
        cancellation: CancellationToken,
        clock: C,
    ) -> Result<NetworkRefreshResult, n::NetworkPublicationError<s::Error>>
    where
        A: n::NetworkReadAuthority<Lease = Arc<NetworkAuthorityLease>>,
        C: FnMut() -> String,
    {
        cancelled(&cancellation)?;
        if lease.source().registration() != self.settings.configured_source().registration() {
            return Err(network_error(n::ErrorCode::WrongScope).into());
        }
        lease
            .revalidate(&NativeLifecycleAuthority)
            .map_err(access_error)?;
        cancelled(&cancellation)?;
        let captured = authority.authorize_inventory(
            self.settings.source(),
            self.settings.transport().reviewed_origin(),
        )?;
        if !Arc::ptr_eq(&captured, &lease) {
            return Err(network_error(n::ErrorCode::WrongScope).into());
        }
        let lease = captured;
        cancelled(&cancellation)?;
        // Validate each caller before revealing in-progress state.
        let Ok(_flight) = self.flight.try_lock() else {
            return Ok(NetworkRefreshResult::AlreadyRunning);
        };
        cancelled(&cancellation)?;
        let prepared = with_store(core, |store| {
            NativeNetworkPublication::prepare(store, &lease)
        })
        .map_err(n::NetworkPublicationError::Storage)?;
        cancelled(&cancellation)?;
        if !Arc::ptr_eq(prepared.lease(), &lease) {
            return Err(network_error(n::ErrorCode::WrongScope).into());
        }
        let baseline: n::NetworkCacheBaseline = serde_json::from_value(
            serde_json::to_value(prepared.state())
                .map_err(s::Error::from)
                .map_err(n::NetworkPublicationError::Storage)?,
        )
        .map_err(s::Error::from)
        .map_err(n::NetworkPublicationError::Storage)?;
        if baseline.cache_epoch > 9_007_199_254_740_991
            || baseline.cache_epoch != prepared.baseline_cache_epoch()
            || baseline
                .cache
                .as_ref()
                .and_then(|cache| cache.generation_id.as_deref())
                != prepared.baseline_generation_id()
            || !baseline.homebox_entities.is_empty()
        {
            return Err(network_error(n::ErrorCode::InvalidSchema).into());
        }
        if baseline.cache.as_ref().is_some_and(|cache| {
            cache.status == n::CacheStatus::AccessRevoked
                || cache.error.as_ref().is_some_and(|error| {
                    matches!(error.code, n::ErrorCode::Auth | n::ErrorCode::WrongScope)
                })
        }) {
            return Err(n::NetworkPublicationError::Storage(s::Error::new(
                "guard-conflict",
                "Network cache is quarantined",
            )));
        }
        let cache = baseline
            .cache
            .unwrap_or_else(|| n::RetainedState::empty(self.settings.source().scope.clone()).cache);
        let prior = self.retained(&cache, &baseline.network_relations)?;
        cancelled(&cancellation)?;
        lease
            .revalidate(&NativeLifecycleAuthority)
            .map_err(access_error)?;
        cancelled(&cancellation)?;
        let transport = n::HttpInventoryTransport::new(
            self.settings.transport(),
            authority.clone(),
            Arc::new(lease.clone()),
            cancellation.clone(),
        )?;
        let outcome = self
            .settings
            .provider()?
            .prepare_refresh(
                &prior,
                prepared.baseline_cache_epoch(),
                prepared.reserved_generation_id(),
                &transport,
                clock,
            )
            .await?;
        cancelled(&cancellation)?;
        lease
            .revalidate(&NativeLifecycleAuthority)
            .map_err(access_error)?;
        cancelled(&cancellation)?;
        match outcome {
            n::RefreshOutcome::Complete(proposal) => {
                let generation = proposal
                    .state()
                    .generation
                    .as_ref()
                    .ok_or_else(|| network_error(n::ErrorCode::InvalidSchema))?;
                authority.authorize_generation(&lease, self.settings.source(), generation)?;
                cancelled(&cancellation)?;
                let staged = {
                    let mut sidecar = self
                        .sidecar
                        .try_lock()
                        .map_err(|_| network_error(n::ErrorCode::Upstream))?;
                    n::stage_complete_generation(self.settings.source(), *proposal, &mut *sidecar)?
                };
                cancelled(&cancellation)?;
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    self.settings.transport().reviewed_origin(),
                )?;
                cancelled(&cancellation)?;
                let receipt = with_store(core, |store| {
                    NativeNetworkPublication::publish(store, prepared, staged)
                })
                .map_err(n::NetworkPublicationError::Storage)?;
                lease
                    .revalidate(&NativeLifecycleAuthority)
                    .map_err(access_error)?;
                cancelled(&cancellation)?;
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    self.settings.transport().reviewed_origin(),
                )?;
                cancelled(&cancellation)?;
                Ok(NetworkRefreshResult::Published(receipt))
            }
            n::RefreshOutcome::Failed(failure) => {
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    self.settings.transport().reviewed_origin(),
                )?;
                cancelled(&cancellation)?;
                let receipt = with_store(core, |store| {
                    NativeNetworkPublication::publish_failure(store, prepared, failure.error.code)
                })
                .map_err(n::NetworkPublicationError::Storage)?;
                lease
                    .revalidate(&NativeLifecycleAuthority)
                    .map_err(access_error)?;
                cancelled(&cancellation)?;
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    self.settings.transport().reviewed_origin(),
                )?;
                cancelled(&cancellation)?;
                Ok(NetworkRefreshResult::SourceFailure(receipt))
            }
        }
    }
}
fn with_store<T>(
    core: &Arc<Mutex<Core>>,
    operation: impl FnOnce(&mut Store) -> s::Result<T>,
) -> s::Result<T> {
    let mut core = core.try_lock().map_err(|_| storage_error())?;
    operation(core.store.get_mut().map_err(|_| storage_error())?)
}
fn network_error(code: n::ErrorCode) -> n::NetworkError {
    n::NetworkError::new(code)
}
fn access_error(error: a::AccessError) -> n::NetworkError {
    network_error(match error {
        a::AccessError::Unavailable => n::ErrorCode::Upstream,
        _ => n::ErrorCode::Auth,
    })
}
fn storage_error() -> s::Error {
    s::Error::new("upstream-unavailable", "Network store unavailable")
}
fn cancelled(token: &CancellationToken) -> Result<(), n::NetworkError> {
    if token.is_cancelled() {
        Err(network_error(n::ErrorCode::Timeout))
    } else {
        Ok(())
    }
}
