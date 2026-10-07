//! Original provider authority captured before I/O and rechecked at publication.
//! Access/storage owners must implement the explicit seams below. There is no
//! permissive adapter, second SQLite connection or RequestPrincipal in an Arc.
use crate::{
    access as a, app::Access, config::providers::registry::ConfiguredSource, storage as s,
};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleCapability {
    ConfigureSource,
    PublishCache,
}

/// Requested access-owner contract. Grant must be opaque, nonserializable and
/// bound to the issuing boundary, genuine principal, full registration and
/// named capability. Read/entity permissions cannot issue either capability.
/// No implementation is supplied until the original access owner approves it.
pub trait TrustedLifecycleAuthority: Send + Sync {
    type Grant: Send + Sync;
    fn capture(
        &self,
        access: &a::AccessBoundary,
        principal: &a::Principal,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<Self::Grant>;
    fn revalidate(
        &self,
        access: &a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()>;
    fn revalidate_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()>;
    /// Access-owner registration write. Revalidate ConfigureSource, the genuine
    /// principal and full registration INSIDE the same access write transaction.
    /// Preserve existing enabled/quarantine state as put_source(..., None) does.
    /// A check followed by the old standalone put_source call is insufficient.
    fn install_source(
        &self,
        access: &mut a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
    ) -> a::AccessResult<()>;
    /// Hold the owner's access transaction through the synchronous callback.
    /// Guard.principal() must borrow this exact principal; do not reacquire a
    /// session or manufacture a DTO principal. Release before provider I/O.
    /// This is a distinct owner extension: with_mutation_authorization alone
    /// does not grant source administration or publication to a read principal.
    fn with_authorization<E: From<a::AccessError>>(
        &self,
        access: &mut a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
        operation: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E>;
}

/// Requested storage-owner seam. Every method must use the SAME AtlasStore's
/// connection, transaction engine and issuer identity. B::Principal deliberately
/// need not equal its persistent ReadAuthority's RequestPrincipal. Retain all
/// existing registration checks, precommit checks and consuming fence/CAS checks.
pub trait ScopedProviderStore {
    fn register_source_with_authorization<B: s::Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        registration: &s::SourceRegistration,
    ) -> s::Result<s::SourceRegistration>;
    fn prepare_cache_publication_with_authorization<B: s::Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        scope: &s::Scope,
        partition: &s::SourcePartition,
    ) -> s::Result<s::PreparedCachePublication>;
    /// Caller supplies the provider owner's opaque complete-generation result.
    /// These raw rows are only the storage handoff, never completeness evidence.
    fn publish_prepared_generation_with_authorization<B: s::Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        fence: s::CachePublicationFence,
        cache: &s::CacheStatus,
        homebox_entities: &[serde_json::Value],
        network_relations: &[serde_json::Value],
    ) -> s::Result<s::CacheStatus>;
    fn record_prepared_cache_failure_with_authorization<B: s::Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        fence: s::CachePublicationFence,
        failure: &s::CacheFailure,
    ) -> s::Result<s::CacheStatus>;
}

struct CapturedLifecycle<G: Send + Sync> {
    access: Access,
    principal: a::Principal,
    source: Arc<ConfiguredSource>,
    grant: G,
}
impl<G: Send + Sync> CapturedLifecycle<G> {
    fn revalidate<A: TrustedLifecycleAuthority<Grant = G>>(
        &self,
        access: &a::AccessBoundary,
        authority: &A,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()> {
        access.revalidate(&self.principal)?;
        authority.revalidate(
            access,
            &self.principal,
            &self.grant,
            self.source.access_registration(),
            capability,
        )
    }
    fn revalidate_guard<A: TrustedLifecycleAuthority<Grant = G>>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        authority: &A,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()> {
        if !std::ptr::eq(guard.principal(), &self.principal) {
            return Err(a::AccessError::Unavailable);
        }
        guard.revalidate()?;
        authority.revalidate_guard(
            guard,
            &self.grant,
            self.source.access_registration(),
            capability,
        )
    }
}

/// ConfigureSource authority is independent of a readable source's existence.
pub struct ConfigurationLease<G: Send + Sync>(CapturedLifecycle<G>);
impl<G: Send + Sync> ConfigurationLease<G> {
    pub fn capture<A: TrustedLifecycleAuthority<Grant = G>>(
        access: &Access,
        authority: &A,
        principal: &a::Principal,
        source: Arc<ConfiguredSource>,
    ) -> a::AccessResult<Self> {
        let guard = access.try_lock().map_err(|_| a::AccessError::Unavailable)?;
        guard.revalidate(principal)?;
        let grant = authority.capture(
            &guard,
            principal,
            source.access_registration(),
            LifecycleCapability::ConfigureSource,
        )?;
        Ok(Self(CapturedLifecycle {
            access: Arc::clone(access),
            principal: principal.clone(),
            source,
            grant,
        }))
    }
    /// Durable registration first; access registration only after that succeeds.
    /// Existing quarantine is preserved with enabled=None. Two databases are
    /// ordered here, not atomically committed: an access error may leave only a
    /// durable registration. Return that error; never claim configuration success.
    pub fn register<A: TrustedLifecycleAuthority<Grant = G>, S: ScopedProviderStore>(
        &self,
        authority: &A,
        store: &mut S,
    ) -> s::Result<s::SourceRegistration> {
        let captured = &self.0;
        let mut access = captured.access.try_lock().map_err(|_| unavailable())?;
        captured
            .revalidate(&access, authority, LifecycleCapability::ConfigureSource)
            .map_err(storage_access)?;
        let mut output = None;
        authority
            .with_authorization(
                &mut access,
                &captured.principal,
                &captured.grant,
                captured.source.access_registration(),
                LifecycleCapability::ConfigureSource,
                |guard| -> Result<(), PhaseError> {
                    captured.revalidate_guard(
                        guard,
                        authority,
                        LifecycleCapability::ConfigureSource,
                    )?;
                    let authorization = ConfigurationAuthorization {
                        guard,
                        authority,
                        lease: self,
                    };
                    output = Some(store.register_source_with_authorization(
                        &authorization,
                        self,
                        captured.source.registration(),
                    )?);
                    captured.revalidate_guard(
                        guard,
                        authority,
                        LifecycleCapability::ConfigureSource,
                    )?;
                    Ok(())
                },
            )
            .map_err(|error: PhaseError| error.0)?;
        let output = output.ok_or_else(unavailable)?;
        if output != *captured.source.registration() {
            return Err(unavailable());
        }
        authority
            .install_source(
                &mut access,
                &captured.principal,
                &captured.grant,
                captured.source.access_registration(),
            )
            .map_err(storage_access)?;
        Ok(output)
    }
}

/// Immutable original handles; use Arc<ProviderLease<_>> across provider awaits.
/// Captured grants are never serialized, refreshed or added after capture.
pub struct ProviderLease<G: Send + Sync> {
    captured: CapturedLifecycle<G>,
    partition: a::PartitionGrant,
    sources: Vec<a::SourceGrant>,
}
impl<G: Send + Sync> ProviderLease<G> {
    /// Root can move an existing request's private grant captures into this
    /// lease. Those ORIGINAL handles are checked against the genuine principal
    /// through the owner's held guard; this never reacquires source authority.
    /// The RequestPrincipal extraction helper belongs to the app owner.
    pub fn retain_original<A: TrustedLifecycleAuthority<Grant = G>>(
        access: &Access,
        authority: &A,
        principal: a::Principal,
        source: Arc<ConfiguredSource>,
        partition: a::PartitionGrant,
        sources: Vec<a::SourceGrant>,
    ) -> a::AccessResult<Self> {
        if partition.partition() != &source.partition()
            || sources
                .iter()
                .any(|grant| !source.contains(grant.reference()))
        {
            return Err(a::AccessError::NotFound);
        }
        let mut access_guard = access.try_lock().map_err(|_| a::AccessError::Unavailable)?;
        access_guard.revalidate(&principal)?;
        let grant = authority.capture(
            &access_guard,
            &principal,
            source.access_registration(),
            LifecycleCapability::PublishCache,
        )?;
        let lease = Self {
            captured: CapturedLifecycle {
                access: Arc::clone(access),
                principal,
                source,
                grant,
            },
            partition,
            sources,
        };
        authority.with_authorization(
            &mut access_guard,
            lease.principal(),
            &lease.captured.grant,
            lease.source().access_registration(),
            LifecycleCapability::PublishCache,
            |guard| -> a::AccessResult<()> {
                ProviderAuthorization {
                    guard,
                    authority,
                    lease: &lease,
                }
                .revalidate()
            },
        )?;
        Ok(lease)
    }
    /// Capture once at the workflow entry when there are no earlier request
    /// grants to hand off. Use retain_original for already captured authority.
    pub fn capture<A: TrustedLifecycleAuthority<Grant = G>>(
        access: &Access,
        authority: &A,
        principal: &a::Principal,
        source: Arc<ConfiguredSource>,
        references: &[a::SourceRef],
    ) -> a::AccessResult<Self> {
        let guard = access.try_lock().map_err(|_| a::AccessError::Unavailable)?;
        guard.revalidate(principal)?;
        let grant = authority.capture(
            &guard,
            principal,
            source.access_registration(),
            LifecycleCapability::PublishCache,
        )?;
        let partition = guard.authorize_source_partition(principal, &source.partition())?;
        let mut sources: Vec<a::SourceGrant> = Vec::new();
        for reference in references {
            if !source.contains(reference) {
                return Err(a::AccessError::NotFound);
            }
            if !sources.iter().any(|grant| grant.reference() == reference) {
                sources.push(guard.authorize_source(principal, reference)?);
            }
        }
        Ok(Self {
            captured: CapturedLifecycle {
                access: Arc::clone(access),
                principal: principal.clone(),
                source,
                grant,
            },
            partition,
            sources,
        })
    }
    pub fn principal(&self) -> &a::Principal {
        &self.captured.principal
    }
    pub fn source(&self) -> &ConfiguredSource {
        &self.captured.source
    }
    pub fn partition_grant(&self) -> &a::PartitionGrant {
        &self.partition
    }
    pub fn source_grants(&self) -> &[a::SourceGrant] {
        &self.sources
    }
    /// Recheck immediately before provider work or disclosure. The host
    /// mutex is released on return; no access/store guard survives network I/O.
    pub fn revalidate<A: TrustedLifecycleAuthority<Grant = G>>(
        &self,
        authority: &A,
    ) -> a::AccessResult<()> {
        let access = self
            .captured
            .access
            .try_lock()
            .map_err(|_| a::AccessError::Unavailable)?;
        self.captured
            .revalidate(&access, authority, LifecycleCapability::PublishCache)?;
        access.revalidate_source_partition(&self.partition)?;
        for grant in &self.sources {
            access.revalidate_source(grant)?;
        }
        Ok(())
    }
    /// New entity disclosures require their own initial capture. An empty list
    /// covers partition metadata only; a publication grant never grants entities.
    pub fn revalidate_disclosure<A: TrustedLifecycleAuthority<Grant = G>>(
        &self,
        authority: &A,
        references: &[a::SourceRef],
    ) -> a::AccessResult<()> {
        for reference in references {
            if !self
                .sources
                .iter()
                .any(|grant| grant.reference() == reference)
            {
                return Err(a::AccessError::NotFound);
            }
        }
        self.revalidate(authority)
    }
    pub fn prepare_publication<A: TrustedLifecycleAuthority<Grant = G>, S: ScopedProviderStore>(
        self: &Arc<Self>,
        authority: &A,
        store: &mut S,
    ) -> s::Result<PreparedProviderPublication<G>> {
        self.with_publication(authority, |authorization| {
            let registration = self.source().registration();
            let prepared = store.prepare_cache_publication_with_authorization(
                authorization,
                self.as_ref(),
                &registration.scope(),
                &registration.partition(),
            )?;
            self.check_fence(prepared.fence())?;
            Ok(PreparedProviderPublication {
                lease: Arc::clone(self),
                prepared,
            })
        })
    }
    fn check_fence(&self, fence: &s::CachePublicationFence) -> s::Result<()> {
        if fence.registration() != self.source().registration()
            || *fence.partition() != self.source().registration().partition()
        {
            return Err(s::Error::new(
                "guard-conflict",
                "Provider registration does not match its fence",
            ));
        }
        Ok(())
    }
    /// Root borrows the SAME store for synchronous prepare/consume work here.
    /// The typed authorizer repeats original-handle checks at every storage phase.
    pub fn with_publication<A: TrustedLifecycleAuthority<Grant = G>, T>(
        &self,
        authority: &A,
        operation: impl FnOnce(&ProviderAuthorization<'_, A>) -> s::Result<T>,
    ) -> s::Result<T> {
        let captured = &self.captured;
        let mut access = captured.access.try_lock().map_err(|_| unavailable())?;
        let mut output = None;
        authority
            .with_authorization(
                &mut access,
                &captured.principal,
                &captured.grant,
                captured.source.access_registration(),
                LifecycleCapability::PublishCache,
                |guard| -> Result<(), PhaseError> {
                    let authorization = ProviderAuthorization {
                        guard,
                        authority,
                        lease: self,
                    };
                    authorization.revalidate().map_err(storage_access)?;
                    output = Some(operation(&authorization)?);
                    authorization.revalidate().map_err(storage_access)?;
                    Ok(())
                },
            )
            .map_err(|error: PhaseError| error.0)?;
        output.ok_or_else(unavailable)
    }
}

/// No Clone, Deserialize or raw constructor. Keeps the exact original lease
/// beside the actual issuing-store fence throughout provider I/O and failures.
pub struct PreparedProviderPublication<G: Send + Sync> {
    lease: Arc<ProviderLease<G>>,
    prepared: s::PreparedCachePublication,
}
impl<G: Send + Sync> PreparedProviderPublication<G> {
    pub fn lease(&self) -> &Arc<ProviderLease<G>> {
        &self.lease
    }
    pub fn state(&self) -> &s::CachePublicationState {
        self.prepared.state()
    }
    pub fn fence(&self) -> &s::CachePublicationFence {
        self.prepared.fence()
    }
    /// Consume the ORIGINAL lease/fence handoff. Storage still checks its actual
    /// instance and durable CAS; the callback must use the provider owner's
    /// opaque complete-generation result or the separately typed failure path.
    pub fn with_publication<A: TrustedLifecycleAuthority<Grant = G>, T>(
        self,
        authority: &A,
        operation: impl FnOnce(&ProviderAuthorization<'_, A>, s::CachePublicationFence) -> s::Result<T>,
    ) -> s::Result<T> {
        let (_, fence) = self.prepared.into_parts();
        self.lease.check_fence(&fence)?;
        self.lease
            .with_publication(authority, |authorization| operation(authorization, fence))
    }
}

/// Exists only during an owner-held access transaction; it is never persistent
/// ReadAuthority and exposes neither administration nor a SQLite handle.
pub struct ProviderAuthorization<'a, A: TrustedLifecycleAuthority> {
    guard: &'a a::TransactionAuthorization<'a>,
    authority: &'a A,
    lease: &'a ProviderLease<A::Grant>,
}
impl<A: TrustedLifecycleAuthority> ProviderAuthorization<'_, A> {
    pub fn lease(&self) -> &ProviderLease<A::Grant> {
        self.lease
    }
    fn revalidate(&self) -> a::AccessResult<()> {
        self.lease.captured.revalidate_guard(
            self.guard,
            self.authority,
            LifecycleCapability::PublishCache,
        )?;
        self.guard
            .revalidate_source_partition(&self.lease.partition)?;
        for grant in &self.lease.sources {
            self.guard.revalidate_source(grant)?;
        }
        Ok(())
    }
}
impl<A: TrustedLifecycleAuthority> s::Authorization for ProviderAuthorization<'_, A> {
    type Principal = ProviderLease<A::Grant>;
    fn authorize(
        &self,
        lease: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(lease, self.lease) || request.capability != s::Capability::PublishCache {
            return Err(unavailable());
        }
        check_request(lease.source(), &request)?;
        self.revalidate().map_err(storage_access)?;
        Ok(actor(lease.principal()))
    }
}
struct ConfigurationAuthorization<'a, A: TrustedLifecycleAuthority> {
    guard: &'a a::TransactionAuthorization<'a>,
    authority: &'a A,
    lease: &'a ConfigurationLease<A::Grant>,
}
impl<A: TrustedLifecycleAuthority> s::Authorization for ConfigurationAuthorization<'_, A> {
    type Principal = ConfigurationLease<A::Grant>;
    fn authorize(
        &self,
        lease: &Self::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(lease, self.lease) || request.capability != s::Capability::ConfigureSource
        {
            return Err(unavailable());
        }
        check_request(&lease.0.source, &request)?;
        if request.source != Some(&serde_json::to_value(lease.0.source.registration())?) {
            return Err(unavailable());
        }
        lease
            .0
            .revalidate_guard(
                self.guard,
                self.authority,
                LifecycleCapability::ConfigureSource,
            )
            .map_err(storage_access)?;
        Ok(actor(&lease.0.principal))
    }
}
fn check_request(
    source: &ConfiguredSource,
    request: &s::AuthorizationRequest<'_>,
) -> s::Result<()> {
    let registration = source.registration();
    if *request.scope != registration.scope()
        || !request.targets.is_empty()
        || request.mutation.is_some()
    {
        return Err(unavailable());
    }
    if request
        .source_partition
        .is_some_and(|partition| *partition != registration.partition())
    {
        return Err(unavailable());
    }
    // Storage sends a registration, partition or cache status as this selector.
    // Only metadata is decoded; opaque principals/grants never cross serde.
    let selector = request.source.ok_or_else(unavailable)?;
    let matches =
        if let Ok(value) = serde_json::from_value::<s::SourceRegistration>(selector.clone()) {
            value == *registration
        } else if let Ok(value) = serde_json::from_value::<s::SourcePartition>(selector.clone()) {
            value == registration.partition()
        } else if let Ok(value) = serde_json::from_value::<s::CacheStatus>(selector.clone()) {
            value.partition() == registration.partition()
        } else {
            false
        };
    if matches { Ok(()) } else { Err(unavailable()) }
}
fn actor(principal: &a::Principal) -> s::VerifiedActor {
    s::VerifiedActor {
        workspace_id: principal.scope().workspace_id.as_str().into(),
        home_id: principal.scope().home_id.as_str().into(),
        actor_id: principal.actor_id().as_str().into(),
    }
}
fn storage_access(error: a::AccessError) -> s::Error {
    s::Error::new(error.code(), "Provider authority unavailable")
}
struct PhaseError(s::Error);
impl From<a::AccessError> for PhaseError {
    fn from(error: a::AccessError) -> Self {
        Self(storage_access(error))
    }
}
impl From<s::Error> for PhaseError {
    fn from(error: s::Error) -> Self {
        Self(error)
    }
}
fn unavailable() -> s::Error {
    s::Error::new("upstream-unavailable", "Provider authority unavailable")
}
