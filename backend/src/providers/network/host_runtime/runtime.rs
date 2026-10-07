use super::{
    NetworkAccess, NetworkAuthority, OriginalNetworkDisclosure, OriginalNetworkLease,
    PreparedPublication, authority::wrong_scope,
};
use crate::{
    app::{Core, Store},
    config::providers::network::NetworkSettings,
    providers::network as n,
    storage as s,
};
use n::{DurableNetworkSidecar, NetworkReadAuthority};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

type Result<T> = std::result::Result<T, n::NetworkPublicationError<s::Error>>;
pub enum RefreshResult {
    Published(s::CacheStatus),
    SourceFailure(s::CacheStatus),
    AlreadyRunning,
}

/// Uses PR36's ordering and quarantine predicate. This concrete successor owns
/// authority callbacks and delegates actual native publication, without changing
/// that accepted input. Root mounts this module and calls explicit methods; no
/// listener, scheduler, browse-triggered refresh or provider settings are created.
pub struct HostNetworkRuntime {
    settings: NetworkSettings,
    sidecar: Mutex<n::SqliteNetworkSidecar>,
    flight: tokio::sync::Mutex<()>,
}
impl HostNetworkRuntime {
    pub fn open(settings: NetworkSettings) -> std::result::Result<Self, n::NetworkError> {
        Ok(Self {
            sidecar: Mutex::new(settings.open_sidecar()?),
            settings,
            flight: tokio::sync::Mutex::new(()),
        })
    }
    pub fn settings(&self) -> &NetworkSettings {
        &self.settings
    }
    pub fn close(self) -> std::result::Result<(), n::NetworkError> {
        self.sidecar
            .into_inner()
            .map_err(|_| unavailable())?
            .close()
    }
    pub async fn refresh<C: FnMut() -> String>(
        &self,
        core: &Arc<Mutex<Core>>,
        authority: Arc<NetworkAuthority>,
        lease: Arc<OriginalNetworkLease>,
        cancellation: CancellationToken,
        clock: C,
    ) -> Result<RefreshResult> {
        cancelled(&cancellation)?;
        if lease.source().registration() != self.settings.configured_source().registration() {
            return Err(wrong_scope().into());
        }
        let config = self.settings.transport();
        let captured =
            authority.authorize_inventory(self.settings.source(), config.reviewed_origin())?;
        if !Arc::ptr_eq(&captured, &lease) {
            return Err(wrong_scope().into());
        }
        let Ok(_flight) = self.flight.try_lock() else {
            return Ok(RefreshResult::AlreadyRunning);
        };
        cancelled(&cancellation)?;
        let prepared = with_store(core, &lease.access, |store| {
            PreparedPublication::prepare(store, lease.clone(), self.settings.source())
        })?;
        let baseline = prepared.baseline();
        if !Arc::ptr_eq(prepared.lease(), &lease)
            || baseline.cache_epoch > 9_007_199_254_740_991
            || !baseline.homebox_entities.is_empty()
        {
            return Err(wrong_scope().into());
        }
        // Exact PR36 ordering: quarantine blocks retained loading, transport
        // construction, credentials and sidecar stage. Native CAS stays closed.
        if baseline.cache.as_ref().is_some_and(|cache| {
            cache.status == n::CacheStatus::AccessRevoked
                || cache.error.as_ref().is_some_and(|e| {
                    matches!(e.code, n::ErrorCode::Auth | n::ErrorCode::WrongScope)
                })
        }) {
            return Err(n::NetworkPublicationError::Storage(s::Error::new(
                "guard-conflict",
                "Network cache is quarantined",
            )));
        }
        let cache = baseline
            .cache
            .clone()
            .unwrap_or_else(|| n::RetainedState::empty(self.settings.source().scope.clone()).cache);
        let prior = self.retained(&cache, &baseline.network_relations)?;
        cancelled(&cancellation)?;
        authority.revalidate_inventory(&lease, self.settings.source(), config.reviewed_origin())?;
        let transport = n::HttpInventoryTransport::new(
            config.clone(),
            authority.clone(),
            Arc::new(lease.clone()),
            cancellation.clone(),
        )?;
        let outcome = self
            .settings
            .provider()?
            .prepare_refresh(
                &prior,
                baseline.cache_epoch,
                prepared.reserved_generation_id(),
                &transport,
                clock,
            )
            .await?;
        cancelled(&cancellation)?;
        authority.revalidate_inventory(&lease, self.settings.source(), config.reviewed_origin())?;
        let result = match outcome {
            n::RefreshOutcome::Complete(proposal) => {
                let generation = proposal
                    .state()
                    .generation
                    .as_ref()
                    .ok_or_else(wrong_scope)?;
                authority.authorize_generation(&lease, self.settings.source(), generation)?;
                cancelled(&cancellation)?;
                let staged = {
                    let mut sidecar = self.sidecar.try_lock().map_err(|_| unavailable())?;
                    n::stage_complete_generation(self.settings.source(), *proposal, &mut *sidecar)?
                };
                // The immutable sidecar row is now durable. Late request
                // cancellation must not abandon it and consume the bounded
                // sidecar quota; finish native publication with the SAME
                // original authority and fence, including current/precommit
                // checks. Authority/storage failures still propagate.
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    config.reviewed_origin(),
                )?;
                RefreshResult::Published(with_store(core, &lease.access, |store| {
                    prepared.publish(store, staged)
                })?)
            }
            n::RefreshOutcome::Failed(failure) => {
                cancelled(&cancellation)?;
                authority.revalidate_inventory(
                    &lease,
                    self.settings.source(),
                    config.reviewed_origin(),
                )?;
                RefreshResult::SourceFailure(with_store(core, &lease.access, |store| {
                    prepared.failure(store, failure.error.code)
                })?)
            }
        };
        // Native Store checked the original authorizer immediately before COMMIT.
        // Report its committed receipt even if subsequent Access finalization or
        // cancellation fails; disclosure still requires its own original grants.
        Ok(result)
    }
    fn retained(
        &self,
        cache: &n::CacheMetadata,
        relations: &[n::NetworkRelation],
    ) -> std::result::Result<n::RetainedState, n::NetworkError> {
        let state = if let Some(id) = &cache.generation_id {
            let row = self
                .sidecar
                .try_lock()
                .map_err(|_| unavailable())?
                .load(self.settings.source(), id)?;
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
    /// Initial genuine read capture from the owning canonical Core. No caller
    /// Store can be paired with an independently supplied access issuer. Core
    /// stays borrowed through all synchronous phases; access is released before
    /// sidecar I/O and the held callbacks never reacquire the canonical mutex.
    pub fn read(
        &self,
        core: &Arc<Mutex<Core>>,
        access: Arc<NetworkAccess>,
        principal: crate::access::Principal,
        partition: crate::access::PartitionGrant,
        entities: Vec<crate::access::SourceGrant>,
        now: &str,
    ) -> Result<(n::NetworkFacet, Arc<OriginalNetworkDisclosure>)> {
        with_core_store(core, &access, |store| {
            let source = self.settings.configured_source().clone();
            if partition.partition() != &source.partition()
                || entities.len() > 10_000
                || entities
                    .iter()
                    .any(|grant| !source.contains(grant.reference()))
            {
                return Err(wrong_scope().into());
            }
            let baseline = super::reads::read_partition(
                store, &access, &principal, &source, &partition, &entities,
            )
            .map_err(n::NetworkPublicationError::Storage)?;
            let cache: n::CacheMetadata = match &baseline.state.cache {
                Some(cache) => serde_json::from_value(
                    serde_json::to_value(cache)
                        .map_err(s::Error::from)
                        .map_err(n::NetworkPublicationError::Storage)?,
                )
                .map_err(s::Error::from)
                .map_err(n::NetworkPublicationError::Storage)?,
                None => n::RetainedState::empty(self.settings.source().scope.clone()).cache,
            };
            let relations: Vec<n::NetworkRelation> = serde_json::from_value(
                serde_json::Value::Array(baseline.state.network_relations.clone()),
            )
            .map_err(s::Error::from)
            .map_err(n::NetworkPublicationError::Storage)?;
            if !baseline.state.homebox_entities.is_empty() {
                return Err(wrong_scope().into());
            }
            // Explicit filesystem phase outside every access borrow. The same
            // Core/Store remains owned; canonical issuer replacement cannot race
            // initial read, accepted generation capture and original release.
            let retained = self.retained(&cache, &relations)?;
            let lease = OriginalNetworkDisclosure::capture(
                Arc::downgrade(core),
                access.clone(),
                principal,
                source,
                partition,
                entities,
                retained,
                baseline,
            )?;
            // Stay inside this validated Core borrow; calling the public method
            // here would reenter its mutex. Only supplied AT11 guards reach Store.
            let facet = self.release_disclosure(store, &lease, now)?;
            Ok((facet, lease))
        })
    }
    /// Release from the exact owning Core and canonical issuer, using original
    /// grants. This sends no transport request and captures no replacement grant.
    pub fn disclose(
        &self,
        core: &Arc<Mutex<Core>>,
        lease: &OriginalNetworkDisclosure,
        now: &str,
    ) -> Result<n::NetworkFacet> {
        if !lease.belongs_to(core) {
            return Err(wrong_scope().into());
        }
        with_core_store(core, &lease.access, |store| {
            self.release_disclosure(store, lease, now)
        })
    }
    fn release_disclosure(
        &self,
        store: &mut Store,
        lease: &OriginalNetworkDisclosure,
        now: &str,
    ) -> Result<n::NetworkFacet> {
        if lease.source().registration() != self.settings.configured_source().registration() {
            return Err(wrong_scope().into());
        }
        super::reads::release(store, lease, now, self.settings.stale_after_ms())
            .map_err(n::NetworkPublicationError::Storage)
    }
}
fn with_store<T>(
    core: &Arc<Mutex<Core>>,
    access: &NetworkAccess,
    operation: impl FnOnce(&mut Store) -> s::Result<T>,
) -> Result<T> {
    with_core_store(core, access, |store| {
        operation(store).map_err(n::NetworkPublicationError::Storage)
    })
}
/// Check canonical identity before entering the supplied native Store operation.
/// This guard owns the same Core/Store for the entire synchronous call.
fn with_core_store<T>(
    core: &Arc<Mutex<Core>>,
    access: &NetworkAccess,
    operation: impl FnOnce(&mut Store) -> Result<T>,
) -> Result<T> {
    let mut owner = core.try_lock().map_err(|_| storage_unavailable())?;
    if !Arc::ptr_eq(access.shared().as_existing(), &owner.access) {
        return Err(wrong_scope().into());
    }
    let store = owner.store.get_mut().map_err(|_| storage_unavailable())?;
    operation(store)
}
fn unavailable() -> n::NetworkError {
    n::NetworkError::new(n::ErrorCode::Upstream)
}
fn storage_unavailable() -> n::NetworkPublicationError<s::Error> {
    n::NetworkPublicationError::Storage(s::Error::new(
        "upstream-unavailable",
        "Network store unavailable",
    ))
}
fn cancelled(token: &CancellationToken) -> std::result::Result<(), n::NetworkError> {
    if token.is_cancelled() {
        Err(n::NetworkError::new(n::ErrorCode::Timeout))
    } else {
        Ok(())
    }
}
