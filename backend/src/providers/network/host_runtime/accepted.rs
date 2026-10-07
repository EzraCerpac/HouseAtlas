//! Exact callback ABI for accepted PR36 NetworkRuntime.refresh. The factory is
//! the only constructor, tying its accepted lease to the actual private memory
//! issuer. A caller cannot substitute a file-backed or mirrored access store.
use super::{
    OwnedNetworkAccess, SessionMaterial,
    authority::{access_error, wrong_scope},
    generation_references,
};
use crate::{
    access as a,
    config::providers::registry::ConfiguredSource,
    lifecycle::providers::{
        authority::{NativeLifecycleAuthority, ProviderLease},
        network::NetworkAuthorityLease,
    },
    providers::network as n,
};
use std::sync::Arc;

pub struct AcceptedNetworkAuthority {
    lease: Arc<NetworkAuthorityLease>,
    registration: n::SourceRegistration,
    origin: String,
    session: Option<SessionMaterial>,
    // Keep the actual memory authority owner alive, not just a detached proof.
    _issuer: Arc<OwnedNetworkAccess>,
}
impl OwnedNetworkAccess {
    /// Retain original handles directly through the accepted closed authority.
    /// This is the exact PR36 lease, not a replacement principal/DTO/witness.
    #[allow(clippy::too_many_arguments)]
    pub fn bind_accepted_original(
        self: &Arc<Self>,
        principal: a::Principal,
        source: Arc<ConfiguredSource>,
        partition: a::PartitionGrant,
        sources: Vec<a::SourceGrant>,
        config: &n::NetworkHttpConfig,
        session: Option<SessionMaterial>,
    ) -> Result<Arc<AcceptedNetworkAuthority>, n::NetworkError> {
        if source.registration().allowed_external_ids.len() > 10_000 || sources.len() > 10_000 {
            return Err(n::NetworkError::new(n::ErrorCode::SizeLimit));
        }
        let registration: n::SourceRegistration = serde_json::from_value(
            serde_json::to_value(source.registration()).map_err(|_| wrong_scope())?,
        )
        .map_err(|_| wrong_scope())?;
        if &registration != config.source() {
            return Err(wrong_scope());
        }
        if let Some(session) = &session {
            session.header()?;
        }
        let lease = Arc::new(
            ProviderLease::retain_original(
                &self.boundary,
                &NativeLifecycleAuthority,
                principal,
                source,
                partition,
                sources,
            )
            .map_err(access_error)?,
        );
        Ok(Arc::new(AcceptedNetworkAuthority {
            lease,
            registration,
            origin: config.reviewed_origin().origin(),
            session,
            _issuer: self.clone(),
        }))
    }
}
impl AcceptedNetworkAuthority {
    pub fn lease(&self) -> &Arc<NetworkAuthorityLease> {
        &self.lease
    }
    fn check(&self, lease: &Arc<NetworkAuthorityLease>) -> Result<(), n::NetworkError> {
        if !Arc::ptr_eq(lease, &self.lease) {
            return Err(wrong_scope());
        }
        lease
            .revalidate(&NativeLifecycleAuthority)
            .map_err(access_error)
    }
}
impl n::NetworkReadAuthority for AcceptedNetworkAuthority {
    type Lease = Arc<NetworkAuthorityLease>;
    fn authorize_inventory(
        &self,
        source: &n::SourceRegistration,
        origin: &n::ReviewedNetworkOrigin,
    ) -> Result<Self::Lease, n::NetworkError> {
        self.revalidate_inventory(&self.lease, source, origin)?;
        Ok(self.lease.clone())
    }
    fn revalidate_inventory(
        &self,
        lease: &Self::Lease,
        source: &n::SourceRegistration,
        origin: &n::ReviewedNetworkOrigin,
    ) -> Result<(), n::NetworkError> {
        if source != &self.registration || origin.origin() != self.origin {
            return Err(wrong_scope());
        }
        self.check(lease)
    }
    fn existing_session(
        &self,
        lease: &Self::Lease,
    ) -> Result<Option<n::ExistingNetworkSession>, n::NetworkError> {
        self.check(lease)?;
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
        if source != &self.registration {
            return Err(wrong_scope());
        }
        self.check(lease)?;
        let references = generation_references(source, generation)?;
        lease
            .revalidate_disclosure(&NativeLifecycleAuthority, &references)
            .map_err(access_error)
    }
}
