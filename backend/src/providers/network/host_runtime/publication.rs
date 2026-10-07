use super::authority::{OriginalNetworkLease, OwnedNetworkAccess};
use crate::{
    access as a, app::Store, config::providers::registry::ConfiguredSource,
    providers::network as n, storage as s,
};
use n::NetworkCachePublisher;
use std::sync::Arc;

/// Private original issuing-store fence and original AT11 lifecycle grant.
/// No raw fence, caller authorizer or publication callback escapes this leaf.
pub struct PreparedPublication {
    lease: Arc<OriginalNetworkLease>,
    prepared: n::PreparedNetworkCache<s::CachePublicationFence>,
}
impl PreparedPublication {
    pub(super) fn prepare(
        store: &mut Store,
        lease: Arc<OriginalNetworkLease>,
        source: &n::SourceRegistration,
    ) -> s::Result<Self> {
        let prepared = held(&lease, |authorization| {
            n::NativeNetworkPublisher::new(store)
                .with_authorization(authorization)
                .prepare_cache_publication(source, lease.as_ref())
        })?;
        if prepared.fence.registration() != lease.source.registration()
            || prepared.baseline.cache_epoch != prepared.fence.baseline_cache_epoch().value()
            || prepared
                .baseline
                .cache
                .as_ref()
                .and_then(|c| c.generation_id.as_deref())
                != prepared.fence.baseline_generation_id()
            || prepared.fence.partition() != &lease.source.registration().partition()
        {
            return Err(conflict());
        }
        Ok(Self { lease, prepared })
    }
    pub fn baseline(&self) -> &n::NetworkCacheBaseline {
        &self.prepared.baseline
    }
    pub fn reserved_generation_id(&self) -> &str {
        self.prepared.fence.reserved_generation_id()
    }
    pub fn lease(&self) -> &Arc<OriginalNetworkLease> {
        &self.lease
    }
    pub(super) fn publish(
        self,
        store: &mut Store,
        staged: n::StagedNetworkPublication<n::DurableNetworkReceipt>,
    ) -> s::Result<s::CacheStatus> {
        if self.prepared.baseline.cache.as_ref().is_some_and(|cache| {
            cache.status == n::CacheStatus::AccessRevoked
                || cache.error.as_ref().is_some_and(|e| {
                    matches!(e.code, n::ErrorCode::Auth | n::ErrorCode::WrongScope)
                })
        }) {
            return Err(conflict());
        }
        let source: n::SourceRegistration =
            serde_json::from_value(serde_json::to_value(self.lease.source.registration())?)?;
        let row = n::stage_row(&source, staged.proposal()).map_err(|_| conflict())?;
        if staged.receipt().partition_key() != row.partition_key
            || staged.receipt().generation_id() != row.generation_id
            || staged.receipt().sha256() != row.sha256
        {
            return Err(conflict());
        }
        let lease = self.lease;
        held(&lease, |authorization| {
            n::NativeNetworkPublisher::new(store)
                .with_authorization(authorization)
                .publish_prepared_generation(self.prepared.fence, staged, lease.as_ref())
        })
    }
    pub(super) fn failure(
        self,
        store: &mut Store,
        code: n::ErrorCode,
    ) -> s::Result<s::CacheStatus> {
        let lease = self.lease;
        held(&lease, |authorization| {
            n::NativeNetworkPublisher::new(store)
                .with_authorization(authorization)
                .record_prepared_cache_failure(self.prepared.fence, code, lease.as_ref())
        })
    }
}
struct CallAuthorization<'a> {
    guard: &'a a::TransactionAuthorization<'a>,
    lease: &'a OriginalNetworkLease,
}
impl s::Authorization for CallAuthorization<'_> {
    type Principal = OriginalNetworkLease;
    fn authorize(
        &self,
        lease: &OriginalNetworkLease,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(lease, self.lease) || request.capability != s::Capability::PublishCache {
            return Err(conflict());
        }
        check_request(&lease.source, &request)?;
        lease.check_guard(self.guard).map_err(storage_access)?;
        Ok(actor(&lease.principal))
    }
}
impl n::NativeNetworkLease<CallAuthorization<'_>> for OriginalNetworkLease {
    fn storage_principal(&self) -> &Self {
        self
    }
}
fn held<T>(
    lease: &OriginalNetworkLease,
    operation: impl FnOnce(&CallAuthorization<'_>) -> s::Result<T>,
) -> s::Result<T> {
    let mut boundary = lease.access.lock().map_err(storage_access)?;
    let mut output = None;
    boundary
        .with_lifecycle_authorization(
            &lease.principal,
            &lease.lifecycle,
            lease.source.access_registration(),
            a::LifecycleCapability::PublishCache,
            |guard| -> Result<(), PhaseError> {
                lease.check_guard(guard)?;
                output = Some(operation(&CallAuthorization { guard, lease })?);
                lease.check_guard(guard)?;
                Ok(())
            },
        )
        .map_err(|e: PhaseError| e.0)?;
    output.ok_or_else(conflict)
}
impl OwnedNetworkAccess {
    /// Separate trusted ConfigureSource grant. This does not synthesize policy
    /// from registration metadata. Durable registration succeeds first; an AT11
    /// error afterward is returned and can leave only the durable registration.
    pub fn configure(
        &self,
        store: &mut Store,
        principal: &a::Principal,
        source: &Arc<ConfiguredSource>,
    ) -> s::Result<()> {
        let mut boundary = self.lock().map_err(storage_access)?;
        let grant = boundary
            .capture_lifecycle(
                principal,
                source.access_registration(),
                a::LifecycleCapability::ConfigureSource,
            )
            .map_err(storage_access)?;
        boundary
            .with_lifecycle_authorization(
                principal,
                &grant,
                source.access_registration(),
                a::LifecycleCapability::ConfigureSource,
                |guard| -> Result<(), PhaseError> {
                    let authorization = ConfigurationAuthorization {
                        guard,
                        principal,
                        grant: &grant,
                        source,
                    };
                    let written = store.register_source_with_authorization(
                        &authorization,
                        principal,
                        source.registration(),
                    )?;
                    if &written != source.registration() {
                        return Err(PhaseError(conflict()));
                    }
                    Ok(())
                },
            )
            .map_err(|e: PhaseError| e.0)?;
        boundary
            .install_source_authorized(principal, &grant, source.access_registration())
            .map_err(storage_access)
    }
}
struct ConfigurationAuthorization<'a> {
    guard: &'a a::TransactionAuthorization<'a>,
    principal: &'a a::Principal,
    grant: &'a a::LifecycleGrant,
    source: &'a ConfiguredSource,
}
impl s::Authorization for ConfigurationAuthorization<'_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(principal, self.principal)
            || !std::ptr::eq(self.guard.principal(), principal)
            || request.capability != s::Capability::ConfigureSource
            || request.source != Some(&serde_json::to_value(self.source.registration())?)
        {
            return Err(conflict());
        }
        check_request(self.source, &request)?;
        self.guard
            .revalidate_lifecycle(
                self.grant,
                self.source.access_registration(),
                a::LifecycleCapability::ConfigureSource,
            )
            .map_err(storage_access)?;
        Ok(actor(principal))
    }
}
fn check_request(
    source: &ConfiguredSource,
    request: &s::AuthorizationRequest<'_>,
) -> s::Result<()> {
    let registration = source.registration();
    if request.scope != &registration.scope()
        || !request.targets.is_empty()
        || request.mutation.is_some()
        || request
            .source_partition
            .is_some_and(|p| p != &registration.partition())
    {
        return Err(conflict());
    }
    let selector = request.source.ok_or_else(conflict)?;
    let matches = if let Ok(v) = serde_json::from_value::<s::SourceRegistration>(selector.clone()) {
        &v == registration
    } else if let Ok(v) = serde_json::from_value::<s::SourcePartition>(selector.clone()) {
        v == registration.partition()
    } else if let Ok(v) = serde_json::from_value::<s::CacheStatus>(selector.clone()) {
        v.partition() == registration.partition()
    } else {
        false
    };
    if matches { Ok(()) } else { Err(conflict()) }
}
fn actor(principal: &a::Principal) -> s::VerifiedActor {
    s::VerifiedActor {
        workspace_id: principal.scope().workspace_id.as_str().into(),
        home_id: principal.scope().home_id.as_str().into(),
        actor_id: principal.actor_id().as_str().into(),
    }
}
fn storage_access(error: a::AccessError) -> s::Error {
    s::Error::new(error.code(), "Network authority unavailable")
}
struct PhaseError(s::Error);
impl From<a::AccessError> for PhaseError {
    fn from(e: a::AccessError) -> Self {
        Self(storage_access(e))
    }
}
impl From<s::Error> for PhaseError {
    fn from(e: s::Error) -> Self {
        Self(e)
    }
}
fn conflict() -> s::Error {
    s::Error::new(
        "guard-conflict",
        "Network original publication binding rejected",
    )
}
