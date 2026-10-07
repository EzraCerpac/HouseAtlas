//! Original provider authority captured before I/O and rechecked at publication.
//! Binds the access owner's lifecycle grants to the same AtlasStore's scoped
//! transactions. No guard survives I/O and no raw publication fence escapes.
use crate::{
    access as a, app::Access, config::providers::registry::ConfiguredSource, providers::network,
    storage as s,
};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleCapability {
    ConfigureSource,
    PublishCache,
}

/// Access-owner contract. Grant must be opaque, nonserializable and
/// bound to the issuing boundary, genuine principal, full registration and
/// named capability. Read/entity permissions cannot issue either capability.
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

/// Thin binding to the original access owner's opaque lifecycle authority.
/// Policy is supplied independently at boundary construction and defaults empty.
/// Registry membership and read grants never create lifecycle approval here.
#[derive(Clone, Copy, Default)]
pub struct NativeLifecycleAuthority;
impl TrustedLifecycleAuthority for NativeLifecycleAuthority {
    type Grant = a::LifecycleGrant;
    fn capture(
        &self,
        access: &a::AccessBoundary,
        principal: &a::Principal,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<Self::Grant> {
        access.capture_lifecycle(principal, registration, native_capability(capability))
    }
    fn revalidate(
        &self,
        access: &a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()> {
        access
            .revalidate_lifecycle(
                principal,
                grant,
                registration,
                native_capability(capability),
            )
            .map(|_| ())
    }
    fn revalidate_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
    ) -> a::AccessResult<()> {
        guard
            .revalidate_lifecycle(grant, registration, native_capability(capability))
            .map(|_| ())
    }
    fn install_source(
        &self,
        access: &mut a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
    ) -> a::AccessResult<()> {
        access.install_source_authorized(principal, grant, registration)
    }
    fn with_authorization<E: From<a::AccessError>>(
        &self,
        access: &mut a::AccessBoundary,
        principal: &a::Principal,
        grant: &Self::Grant,
        registration: &a::SourceRegistration,
        capability: LifecycleCapability,
        operation: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        access.with_lifecycle_authorization(
            principal,
            grant,
            registration,
            native_capability(capability),
            operation,
        )
    }
}
fn native_capability(capability: LifecycleCapability) -> a::LifecycleCapability {
    match capability {
        LifecycleCapability::ConfigureSource => a::LifecycleCapability::ConfigureSource,
        LifecycleCapability::PublishCache => a::LifecycleCapability::PublishCache,
    }
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
    pub fn register<A, C, B, R>(
        &self,
        authority: &A,
        store: &mut s::AtlasStore<C, B, R>,
    ) -> s::Result<s::SourceRegistration>
    where
        A: TrustedLifecycleAuthority<Grant = G>,
        C: s::Contract,
        B: s::Authorization,
        R: s::Runtime,
    {
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
    pub fn prepare_publication<A, C, B, R>(
        self: &Arc<Self>,
        authority: &A,
        store: &mut s::AtlasStore<C, B, R>,
    ) -> s::Result<PreparedProviderPublication<G>>
    where
        A: TrustedLifecycleAuthority<Grant = G>,
        C: s::Contract,
        B: s::Authorization,
        R: s::Runtime,
    {
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
    // Only closed operations in this module receive the live authorizer. Neither
    // a caller callback nor a caller-defined store can extract an extra fence.
    fn with_publication<A: TrustedLifecycleAuthority<Grant = G>, T>(
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
/// HomeBox success additionally needs its producer's full registration witness;
/// its current CompleteGeneration alone does not establish configured coverage.
pub struct PreparedProviderPublication<G: Send + Sync> {
    lease: Arc<ProviderLease<G>>,
    prepared: s::PreparedCachePublication,
}
impl<G: Send + Sync> PreparedProviderPublication<G> {
    pub fn lease(&self) -> &Arc<ProviderLease<G>> {
        &self.lease
    }
    /// Internal retained provider state. Entity disclosure still requires the
    /// original source grants; this is not a public read or a completeness proof.
    pub fn state(&self) -> &s::CachePublicationState {
        self.prepared.state()
    }
    pub fn baseline_generation_id(&self) -> Option<&str> {
        self.prepared.fence().baseline_generation_id()
    }
    pub fn baseline_cache_epoch(&self) -> u64 {
        self.prepared.fence().baseline_cache_epoch().value()
    }
    pub fn reserved_generation_id(&self) -> &str {
        self.prepared.fence().reserved_generation_id()
    }
    /// Consume the private original fence through the issuing store's actual
    /// failure engine, under the same original lease and held access authority.
    pub fn record_failure<A, C, B, R>(
        self,
        authority: &A,
        store: &mut s::AtlasStore<C, B, R>,
        failure: &s::CacheFailure,
    ) -> s::Result<s::CacheStatus>
    where
        A: TrustedLifecycleAuthority<Grant = G>,
        C: s::Contract,
        B: s::Authorization,
        R: s::Runtime,
    {
        let (_, fence) = self.prepared.into_parts();
        self.lease.check_fence(&fence)?;
        self.lease.with_publication(authority, |authorization| {
            store.record_prepared_cache_failure_with_authorization(
                authorization,
                self.lease.as_ref(),
                fence,
                failure,
            )
        })
    }
    /// Accept only the provider's opaque complete proposal with its actual
    /// durable SQLite receipt. Rows/metadata alone cannot qualify publication.
    /// The full configured registration validates the retained inventory again;
    /// the same original lease and issuing-store fence remain private throughout.
    pub fn publish_network<A, C, B, R>(
        self,
        authority: &A,
        store: &mut s::AtlasStore<C, B, R>,
        staged: network::StagedNetworkPublication<network::DurableNetworkReceipt>,
    ) -> s::Result<s::CacheStatus>
    where
        A: TrustedLifecycleAuthority<Grant = G>,
        C: s::Contract,
        B: s::Authorization,
        R: s::Runtime,
    {
        let (baseline, fence) = self.prepared.into_parts();
        self.lease.check_fence(&fence)?;
        if fence.registration().owner != s::SourceOwner::Network
            || baseline.cache.as_ref().is_some_and(|cache| {
                cache.status == s::CacheState::AccessRevoked
                    || cache.error.as_ref().is_some_and(|error| {
                        matches!(
                            error.code,
                            s::FailureCode::Auth | s::FailureCode::WrongScope
                        )
                    })
            })
        {
            return Err(publication_conflict());
        }
        // Only metadata is converted. Genuine principals and opaque grants
        // remain in the original lease and never cross a serialization boundary.
        let registration: network::SourceRegistration =
            serde_json::from_value(serde_json::to_value(self.lease.source().registration())?)?;
        let proposal = staged.proposal();
        let expected = proposal.precondition();
        if expected.expected_generation_id.as_deref() != fence.baseline_generation_id()
            || expected.expected_cache_epoch != fence.baseline_cache_epoch().value()
            || proposal.state().cache.scope != registration.scope
            || proposal.state().cache.generation_id.as_deref()
                != Some(fence.reserved_generation_id())
        {
            return Err(publication_conflict());
        }
        let row =
            network::stage_row(&registration, proposal).map_err(|_| publication_conflict())?;
        let receipt = staged.receipt();
        if receipt.partition_key() != row.partition_key
            || receipt.generation_id() != row.generation_id
            || receipt.sha256() != row.sha256
        {
            return Err(publication_conflict());
        }
        let generation = proposal
            .state()
            .generation
            .as_ref()
            .ok_or_else(publication_conflict)?;
        let cache: s::CacheStatus =
            serde_json::from_value(serde_json::to_value(&proposal.state().cache)?)?;
        let rows = generation
            .network_relations
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        self.lease.with_publication(authority, |authorization| {
            store.publish_prepared_generation_with_authorization(
                authorization,
                self.lease.as_ref(),
                fence,
                &cache,
                &[],
                &rows,
            )
        })
    }
}

/// Exists only during an owner-held access transaction; it is never persistent
/// ReadAuthority and exposes neither administration nor a SQLite handle.
struct ProviderAuthorization<'a, A: TrustedLifecycleAuthority> {
    guard: &'a a::TransactionAuthorization<'a>,
    authority: &'a A,
    lease: &'a ProviderLease<A::Grant>,
}
impl<A: TrustedLifecycleAuthority> ProviderAuthorization<'_, A> {
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
fn publication_conflict() -> s::Error {
    s::Error::new(
        "guard-conflict",
        "Provider proposal does not match its original fence",
    )
}
