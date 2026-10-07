use super::generation_references;
use crate::{access as a, config::providers::registry::ConfiguredSource, providers::network as n};
use std::sync::{Arc, Mutex, MutexGuard};

const MAX_GRANTS: usize = 10_000;

/// Sole authority database, not a mirror of a disk-backed boundary. It cannot
/// be replaced or opened from a path. Sessions are deliberately process-local.
/// Startup/admin methods are trusted host APIs, never provider or HTTP input.
pub struct OwnedNetworkAccess {
    pub(super) boundary: Arc<Mutex<a::AccessBoundary>>,
}
impl OwnedNetworkAccess {
    pub fn new(
        origins: Vec<String>,
        limits: a::AccessLimits,
        rules: Vec<a::LifecycleRule>,
    ) -> a::AccessResult<Arc<Self>> {
        if rules.len() > 256 {
            return Err(a::AccessError::InvalidInput);
        }
        let policy = a::LifecyclePolicy::from_trusted_configuration(rules);
        let config = a::AccessConfig::new(origins)?
            .with_limits(limits)?
            .with_lifecycle_policy(policy);
        Ok(Arc::new(Self {
            boundary: Arc::new(Mutex::new(a::AccessBoundary::in_memory(config)?)),
        }))
    }
    pub(super) fn lock(&self) -> a::AccessResult<MutexGuard<'_, a::AccessBoundary>> {
        self.boundary
            .try_lock()
            .map_err(|_| a::AccessError::Unavailable)
    }
    pub fn provision_user(
        &self,
        user: &a::CanonicalId,
        actor: &a::CanonicalId,
        username: &str,
        verifier: &a::PasswordVerifier,
        enabled: Option<bool>,
    ) -> a::AccessResult<()> {
        self.lock()?
            .provision_user(user, actor, username, verifier, enabled)
    }
    pub fn set_membership(
        &self,
        user: &a::CanonicalId,
        scope: &a::Scope,
        role: a::Role,
        enabled: bool,
    ) -> a::AccessResult<()> {
        self.lock()?.set_membership(user, scope, role, enabled)
    }
    pub fn set_user_enabled(&self, user: &a::CanonicalId, enabled: bool) -> a::AccessResult<()> {
        self.lock()?.set_user_enabled(user, enabled)
    }
    pub fn revoke_user_sessions(&self, user: &a::CanonicalId) -> a::AccessResult<()> {
        self.lock()?.revoke_user_sessions(user)
    }
    pub fn set_source_enabled(
        &self,
        partition: &a::SourcePartition,
        enabled: bool,
    ) -> a::AccessResult<()> {
        self.lock()?.set_source_enabled(partition, enabled)
    }
    pub fn login(
        &self,
        request: &a::RequestEvidence<'_>,
        body: &[u8],
        client_key: &str,
    ) -> a::AccessResult<a::SessionReceipt> {
        self.lock()?.login(request, body, client_key)
    }
    pub fn authorize(
        &self,
        request: &a::RequestEvidence<'_>,
        scope: &a::Scope,
        action: a::Action,
    ) -> a::AccessResult<a::Principal> {
        self.lock()?.authorize(request, scope, action)
    }
    pub fn logout(&self, request: &a::RequestEvidence<'_>) -> a::AccessResult<String> {
        self.lock()?.logout(request)
    }
    pub fn partition_grant(
        &self,
        principal: &a::Principal,
        partition: &a::SourcePartition,
    ) -> a::AccessResult<a::PartitionGrant> {
        self.lock()?
            .authorize_source_partition(principal, partition)
    }
    pub fn source_grant(
        &self,
        principal: &a::Principal,
        reference: &a::SourceRef,
    ) -> a::AccessResult<a::SourceGrant> {
        self.lock()?.authorize_source(principal, reference)
    }
    /// Moves the caller's original disclosure handles. Lifecycle authority is
    /// captured exactly once through the actual default-deny startup policy.
    pub fn retain_original(
        self: &Arc<Self>,
        principal: a::Principal,
        source: Arc<ConfiguredSource>,
        partition: a::PartitionGrant,
        sources: Vec<a::SourceGrant>,
    ) -> a::AccessResult<Arc<OriginalNetworkLease>> {
        if source.registration().allowed_external_ids.len() > MAX_GRANTS
            || sources.len() > MAX_GRANTS
            || partition.partition() != &source.partition()
            || source.access_registration().owner != a::SourceOwner::Network
            || sources.iter().any(|g| !source.contains(g.reference()))
        {
            return Err(a::AccessError::NotFound);
        }
        let boundary = self.lock()?;
        let lifecycle = boundary.capture_lifecycle(
            &principal,
            source.access_registration(),
            a::LifecycleCapability::PublishCache,
        )?;
        let lease = Arc::new(OriginalNetworkLease {
            access: self.clone(),
            principal,
            source,
            lifecycle,
            partition,
            sources,
        });
        lease.check(&boundary)?;
        Ok(lease)
    }
}

/// No Serialize/Deserialize/Clone constructor. Complete genuine provenance and
/// branded grants stay in this original handle throughout the workflow.
pub struct OriginalNetworkLease {
    pub(super) access: Arc<OwnedNetworkAccess>,
    pub(super) principal: a::Principal,
    pub(super) source: Arc<ConfiguredSource>,
    pub(super) lifecycle: a::LifecycleGrant,
    partition: a::PartitionGrant,
    sources: Vec<a::SourceGrant>,
}
impl OriginalNetworkLease {
    pub(super) fn check(&self, boundary: &a::AccessBoundary) -> a::AccessResult<()> {
        boundary.revalidate(&self.principal)?;
        boundary.revalidate_lifecycle(
            &self.principal,
            &self.lifecycle,
            self.source.access_registration(),
            a::LifecycleCapability::PublishCache,
        )?;
        boundary.revalidate_source_partition(&self.partition)?;
        for grant in &self.sources {
            boundary.revalidate_source(grant)?;
        }
        Ok(())
    }
    pub(super) fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> a::AccessResult<()> {
        if !std::ptr::eq(guard.principal(), &self.principal) {
            return Err(a::AccessError::Forbidden);
        }
        guard.revalidate()?;
        guard.revalidate_lifecycle(
            &self.lifecycle,
            self.source.access_registration(),
            a::LifecycleCapability::PublishCache,
        )?;
        guard.revalidate_source_partition(&self.partition)?;
        for grant in &self.sources {
            guard.revalidate_source(grant)?;
        }
        Ok(())
    }
    pub fn revalidate(&self) -> a::AccessResult<()> {
        self.check(&*self.access.lock()?)
    }
    pub fn source(&self) -> &ConfiguredSource {
        &self.source
    }
    pub fn revalidate_disclosure(&self, references: &[a::SourceRef]) -> a::AccessResult<()> {
        if references.len() > MAX_GRANTS
            || references
                .iter()
                .any(|r| !self.sources.iter().any(|g| g.reference() == r))
        {
            return Err(a::AccessError::NotFound);
        }
        self.revalidate()
    }
}

/// Already-held private upstream material. Construction only validates bytes;
/// it acquires no provider account, cookie, credential or grant.
pub enum SessionMaterial {
    Cookie(String),
    Authorization(String),
}
impl SessionMaterial {
    pub(super) fn header(&self) -> Result<n::ExistingNetworkSession, n::NetworkError> {
        match self {
            Self::Cookie(v) => n::ExistingNetworkSession::cookie(v),
            Self::Authorization(v) => n::ExistingNetworkSession::authorization(v),
        }
    }
}
/// One callback adapter bound to an exact original lease, full registration and
/// reviewed origin. No authority cache, background mirror, permissive issuer or
/// blocking lock acquisition. All queries are to the sole private memory DB.
pub struct NetworkAuthority {
    lease: Arc<OriginalNetworkLease>,
    registration: n::SourceRegistration,
    origin: String,
    session: Option<SessionMaterial>,
}
impl NetworkAuthority {
    pub fn new(
        lease: Arc<OriginalNetworkLease>,
        config: &n::NetworkHttpConfig,
        session: Option<SessionMaterial>,
    ) -> Result<Arc<Self>, n::NetworkError> {
        let registration: n::SourceRegistration = serde_json::from_value(
            serde_json::to_value(lease.source.registration()).map_err(|_| wrong_scope())?,
        )
        .map_err(|_| wrong_scope())?;
        if &registration != config.source() {
            return Err(wrong_scope());
        }
        if let Some(session) = &session {
            session.header()?;
        }
        lease.revalidate().map_err(access_error)?;
        Ok(Arc::new(Self {
            lease,
            registration,
            origin: config.reviewed_origin().origin(),
            session,
        }))
    }
    fn check(
        &self,
        lease: &Arc<OriginalNetworkLease>,
        source: &n::SourceRegistration,
        origin: &n::ReviewedNetworkOrigin,
    ) -> Result<(), n::NetworkError> {
        if !Arc::ptr_eq(lease, &self.lease)
            || source != &self.registration
            || origin.origin() != self.origin
        {
            return Err(wrong_scope());
        }
        lease.revalidate().map_err(access_error)
    }
}
impl n::NetworkReadAuthority for NetworkAuthority {
    type Lease = Arc<OriginalNetworkLease>;
    fn authorize_inventory(
        &self,
        source: &n::SourceRegistration,
        origin: &n::ReviewedNetworkOrigin,
    ) -> Result<Self::Lease, n::NetworkError> {
        self.check(&self.lease, source, origin)?;
        Ok(self.lease.clone())
    }
    fn revalidate_inventory(
        &self,
        lease: &Self::Lease,
        source: &n::SourceRegistration,
        origin: &n::ReviewedNetworkOrigin,
    ) -> Result<(), n::NetworkError> {
        self.check(lease, source, origin)
    }
    fn existing_session(
        &self,
        lease: &Self::Lease,
    ) -> Result<Option<n::ExistingNetworkSession>, n::NetworkError> {
        if !Arc::ptr_eq(lease, &self.lease) {
            return Err(wrong_scope());
        }
        lease.revalidate().map_err(access_error)?;
        self.session
            .as_ref()
            .map(SessionMaterial::header)
            .transpose()
    }
    fn authorize_generation(
        &self,
        lease: &Self::Lease,
        source: &n::SourceRegistration,
        generation: &n::NetworkGeneration,
    ) -> Result<(), n::NetworkError> {
        if !Arc::ptr_eq(lease, &self.lease) || source != &self.registration {
            return Err(wrong_scope());
        }
        let references = generation_references(source, generation)?;
        lease
            .revalidate_disclosure(&references)
            .map_err(access_error)
    }
}
pub(super) fn access_error(error: a::AccessError) -> n::NetworkError {
    n::NetworkError::new(if error == a::AccessError::Unavailable {
        n::ErrorCode::Upstream
    } else {
        n::ErrorCode::Auth
    })
}
pub(super) fn wrong_scope() -> n::NetworkError {
    n::NetworkError::new(n::ErrorCode::WrongScope)
}
