//! Closed retained-generation browse. Initial capture and release use the real
//! AT11 read fence, with durable sidecar loading outside the authority lock.
use super::{
    authority::{NetworkAccess, wrong_scope},
    disclosure::{GenerationMembership, generation_membership},
    grant_index::GrantIndex,
};
use crate::app::Core;
use crate::{
    access as a, config::providers::registry::ConfiguredSource, providers::network as n,
    storage as s,
};
use std::sync::{Arc, Mutex, Weak};

/// No DTO issuer, raw constructor or grant replacement. Every resource handle
/// was issued by AT11 with this genuine principal and original member grants.
pub struct OriginalNetworkDisclosure {
    owner: Weak<Mutex<Core>>,
    pub(super) access: Arc<NetworkAccess>,
    pub(super) principal: a::Principal,
    pub(super) source: Arc<ConfiguredSource>,
    pub(super) partition: a::PartitionGrant,
    pub(super) entities: Vec<a::SourceGrant>,
    pub(super) links: Vec<a::NetworkLinkGrant>,
    pub(super) observations: Vec<a::NetworkObservationGrant>,
    pub(super) retained: n::RetainedState,
    pub(super) baseline: s::RegisteredCacheRead,
}
impl OriginalNetworkDisclosure {
    pub fn source(&self) -> &ConfiguredSource {
        &self.source
    }
    pub fn link_grants(&self) -> &[a::NetworkLinkGrant] {
        &self.links
    }
    pub fn observation_grants(&self) -> &[a::NetworkObservationGrant] {
        &self.observations
    }
    pub fn generation_id(&self) -> Option<&str> {
        self.retained.cache.generation_id.as_deref()
    }
    pub(super) fn belongs_to(&self, core: &Arc<Mutex<Core>>) -> bool {
        self.owner.ptr_eq(&Arc::downgrade(core))
    }
    pub fn revalidate(&self) -> a::AccessResult<()> {
        let core = self.owner.upgrade().ok_or(a::AccessError::Unavailable)?;
        let owner = core.try_lock().map_err(|_| a::AccessError::Unavailable)?;
        if !Arc::ptr_eq(self.access.shared().as_existing(), &owner.access) {
            return Err(a::AccessError::Forbidden);
        }
        self.access
            .lock()?
            .with_read_authorization(&self.principal, |guard| self.check_guard(guard))
    }
    pub(super) fn check_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
    ) -> a::AccessResult<()> {
        if !std::ptr::eq(guard.principal(), &self.principal) {
            return Err(a::AccessError::Forbidden);
        }
        guard.authorize(self.principal.scope(), a::Capability::Read)?;
        guard.revalidate_source_partition(&self.partition)?;
        for grant in &self.entities {
            guard.revalidate_source(grant)?;
        }
        for grant in &self.links {
            guard.revalidate_network_link(grant)?;
        }
        for grant in &self.observations {
            guard.revalidate_network_observation(grant)?;
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn capture(
        owner: Weak<Mutex<Core>>,
        access: Arc<NetworkAccess>,
        principal: a::Principal,
        source: Arc<ConfiguredSource>,
        partition: a::PartitionGrant,
        entities: Vec<a::SourceGrant>,
        retained: n::RetainedState,
        baseline: s::RegisteredCacheRead,
    ) -> Result<Arc<Self>, n::NetworkError> {
        if partition.partition() != &source.partition()
            || entities.len() > 10_000
            || entities.iter().any(|g| !source.contains(g.reference()))
        {
            return Err(wrong_scope());
        }
        let membership = if let Some(generation) = retained.public_read().generation.as_ref() {
            generation_membership(
                &serde_json::from_value(
                    serde_json::to_value(source.registration()).map_err(|_| wrong_scope())?,
                )
                .map_err(|_| wrong_scope())?,
                generation,
            )?
        } else {
            GenerationMembership {
                entities: vec![],
                links: vec![],
                observations: vec![],
            }
        };
        // This only matches authenticated original handles to proven generation
        // members; it never treats a SourceRef selector as a membership issuer.
        let member_index = GrantIndex::new(&entities);
        let member = |reference: &a::SourceRef| -> Result<&a::SourceGrant, n::NetworkError> {
            member_index
                .position(reference)
                .map(|i| &entities[i])
                .ok_or_else(wrong_scope)
        };
        for reference in &membership.entities {
            member(reference)?;
        }
        let boundary = access.lock().map_err(super::authority::access_error)?;
        boundary
            .revalidate(&principal)
            .map_err(super::authority::access_error)?;
        boundary
            .revalidate_source_partition(&partition)
            .map_err(super::authority::access_error)?;
        let links = membership
            .links
            .iter()
            .map(|reference| {
                boundary
                    .authorize_network_link(
                        &principal,
                        reference,
                        member(reference.from())?,
                        member(reference.to())?,
                    )
                    .map_err(super::authority::access_error)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let observations = membership
            .observations
            .iter()
            .map(|reference| {
                boundary
                    .authorize_network_observation(
                        &principal,
                        reference,
                        reference.device().map(member).transpose()?,
                        reference.interface().map(member).transpose()?,
                    )
                    .map_err(super::authority::access_error)
            })
            .collect::<Result<Vec<_>, _>>()?;
        drop(boundary);
        Ok(Arc::new(Self {
            owner,
            access,
            principal,
            source,
            partition,
            entities,
            links,
            observations,
            retained,
            baseline,
        }))
    }
}

use crate::app::Store;

/// Borrowed read authorization verifies the actual stored registration selector
/// and genuine original handles. No configured authorizer is reentered.
struct PartitionRead<'a> {
    guard: &'a a::TransactionAuthorization<'a>,
    source: &'a ConfiguredSource,
    partition: &'a a::PartitionGrant,
    entities: &'a [a::SourceGrant],
    disclosure: Option<&'a OriginalNetworkDisclosure>,
}
impl s::Authorization for PartitionRead<'_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let registration = self.source.registration();
        if !std::ptr::eq(principal, self.guard.principal())
            || request.capability != s::Capability::ReadCache
            || request.scope != &registration.scope()
            || request.source_partition != Some(&registration.partition())
            || request.source != Some(&serde_json::to_value(registration)?)
            || !request.targets.is_empty()
            || request.mutation.is_some()
        {
            return Err(conflict());
        }
        self.guard
            .authorize(principal.scope(), a::Capability::Read)
            .map_err(storage_access)?;
        self.guard
            .revalidate_source_partition(self.partition)
            .map_err(storage_access)?;
        for grant in self.entities {
            self.guard
                .revalidate_source(grant)
                .map_err(storage_access)?;
        }
        if let Some(lease) = self.disclosure {
            lease.check_guard(self.guard).map_err(storage_access)?;
        }
        Ok(s::VerifiedActor {
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            actor_id: principal.actor_id().as_str().into(),
        })
    }
}
pub(super) fn read_partition(
    store: &mut Store,
    access: &NetworkAccess,
    principal: &a::Principal,
    source: &ConfiguredSource,
    partition: &a::PartitionGrant,
    entities: &[a::SourceGrant],
) -> s::Result<s::RegisteredCacheRead> {
    let mut boundary = access.lock().map_err(storage_access)?;
    let mut output = None;
    boundary
        .with_read_authorization(principal, |guard| -> Result<(), PhaseError> {
            let authorization = PartitionRead {
                guard,
                source,
                partition,
                entities,
                disclosure: None,
            };
            output = Some(store.read_cache_partition_with_authorization(
                &authorization,
                principal,
                &source.registration().scope(),
                &source.registration().partition(),
            )?);
            guard.revalidate_source_partition(partition)?;
            for grant in entities {
                guard.revalidate_source(grant)?;
            }
            Ok(())
        })
        .map_err(|e: PhaseError| e.0)?;
    output.ok_or_else(conflict)
}
pub(super) fn release(
    store: &mut Store,
    lease: &OriginalNetworkDisclosure,
    now: &str,
    stale_after_ms: i64,
) -> s::Result<n::NetworkFacet> {
    let mut boundary = lease.access.lock().map_err(storage_access)?;
    let mut output = None;
    boundary
        .with_read_authorization(&lease.principal, |guard| -> Result<(), PhaseError> {
            lease.check_guard(guard)?;
            let authorization = PartitionRead {
                guard,
                source: &lease.source,
                partition: &lease.partition,
                entities: &lease.entities,
                disclosure: Some(lease),
            };
            let current = store.read_cache_partition_with_authorization(
                &authorization,
                &lease.principal,
                &lease.source.registration().scope(),
                &lease.source.registration().partition(),
            )?;
            // Full native read comparison includes registration, integer cache epoch,
            // pointer/status/timestamps and all retained rows, not merely a DTO scope.
            if current != lease.baseline {
                return Err(PhaseError(conflict()));
            }
            let source: n::SourceRegistration =
                serde_json::from_value(serde_json::to_value(lease.source.registration())?)?;
            let facet = n::build_facet(&source, &lease.retained, now, stale_after_ms)
                .map_err(|_| PhaseError(conflict()))?;
            lease.check_guard(guard)?;
            output = Some(facet);
            Ok(())
        })
        .map_err(|e: PhaseError| e.0)?;
    output.ok_or_else(conflict)
}
fn storage_access(error: a::AccessError) -> s::Error {
    s::Error::new(
        error.code(),
        "Original Network disclosure authority unavailable",
    )
}
fn conflict() -> s::Error {
    s::Error::new(
        "guard-conflict",
        "Original Network disclosure binding rejected",
    )
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
impl From<serde_json::Error> for PhaseError {
    fn from(e: serde_json::Error) -> Self {
        Self(s::Error::from(e))
    }
}
