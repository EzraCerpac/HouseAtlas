//! The actual access/storage/domain composition and original request authority.
use crate::{access as a, domain as d, http::contracts::NativeContracts, storage as s};
use std::{
    cell::{Cell, RefCell},
    sync::{Arc, Mutex},
};

pub type Access = Arc<Mutex<a::AccessBoundary>>;
pub type Store = s::AtlasStore<
    NativeContracts,
    ReadAuthority,
    crate::media::native::NativeMediaRuntime<ServerRuntime>,
>;
pub struct Core {
    pub access: Access,
    pub store: Mutex<Store>,
    pub vault: Arc<crate::media::AssetVault>,
    pub home: d::HomeSummary,
    /// Trusted configured summaries; no labels or membership come from a request.
    pub homes: Vec<d::HomeSummary>,
}
pub struct CapturedHome {
    pub summary: d::HomeSummary,
    pub principal: a::Principal,
}
pub fn capture_homes(
    access: &mut a::AccessBoundary,
    request: &a::RequestEvidence<'_>,
    configured: &[d::HomeSummary],
) -> a::AccessResult<Vec<CapturedHome>> {
    let mut homes = Vec::new();
    for summary in configured {
        match access.authorize(request, &access_scope(&summary.scope)?, a::Action::Read) {
            Ok(principal) => homes.push(CapturedHome {
                summary: summary.clone(),
                principal,
            }),
            Err(a::AccessError::NotFound) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(homes)
}
pub struct RequestPrincipal {
    pub principal: a::Principal,
    partitions: RefCell<Vec<a::PartitionGrant>>,
    sources: RefCell<Vec<a::SourceGrant>>,
    source_capture_sealed: Cell<bool>,
    pub home_choices: Vec<CapturedHome>,
}
impl RequestPrincipal {
    pub fn new(principal: a::Principal) -> Self {
        Self {
            principal,
            partitions: RefCell::new(Vec::new()),
            sources: RefCell::new(Vec::new()),
            source_capture_sealed: Cell::new(false),
            home_choices: Vec::new(),
        }
    }
    pub fn release(&self, access: &a::AccessBoundary) -> a::AccessResult<()> {
        access.revalidate(&self.principal)?;
        for choice in &self.home_choices {
            access.revalidate(&choice.principal)?;
        }
        for grant in self.partitions.borrow().iter() {
            access.revalidate_source_partition(grant)?;
        }
        for grant in self.sources.borrow().iter() {
            access.revalidate_source(grant)?;
        }
        Ok(())
    }
    pub(crate) fn capture_sources(
        &self,
        access: &a::AccessBoundary,
        closure: &crate::contracts::semantics::ReferenceClosure,
    ) -> a::AccessResult<()> {
        for source in &closure.source_refs {
            let source: a::SourceRef = serde_json::from_value(
                serde_json::to_value(source).map_err(|_| a::AccessError::Unavailable)?,
            )
            .map_err(|_| a::AccessError::Unavailable)?;
            self.capture_source(access, &source)?;
        }
        for partition in &closure.source_partitions {
            let partition: a::SourcePartition = serde_json::from_value(
                serde_json::to_value(partition).map_err(|_| a::AccessError::Unavailable)?,
            )
            .map_err(|_| a::AccessError::Unavailable)?;
            self.capture_partition(access, &partition)?;
        }
        Ok(())
    }
    pub(crate) fn capture_source(
        &self,
        access: &a::AccessBoundary,
        source: &a::SourceRef,
    ) -> a::AccessResult<()> {
        self.release(access)?;
        if self
            .sources
            .borrow()
            .iter()
            .any(|grant| grant.reference() == source)
        {
            return Ok(());
        }
        if self.source_capture_sealed.get() {
            return Err(a::AccessError::Unavailable);
        }
        self.sources
            .borrow_mut()
            .push(access.authorize_source(&self.principal, source)?);
        Ok(())
    }
    pub(crate) fn capture_partition(
        &self,
        access: &a::AccessBoundary,
        partition: &a::SourcePartition,
    ) -> a::AccessResult<()> {
        self.release(access)?;
        if self
            .partitions
            .borrow()
            .iter()
            .any(|grant| grant.partition() == partition)
        {
            return Ok(());
        }
        if self.source_capture_sealed.get() {
            return Err(a::AccessError::Unavailable);
        }
        self.partitions
            .borrow_mut()
            .push(access.authorize_source_partition(&self.principal, partition)?);
        Ok(())
    }
    pub(crate) fn seal_source_capture(&self) {
        self.source_capture_sealed.set(true);
    }
    pub(crate) fn release_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        closure: &crate::contracts::semantics::ReferenceClosure,
    ) -> a::AccessResult<()> {
        // The guard is bound to this actual opaque principal; no reconstructed
        // actor/scope or replacement handle can stand in for it.
        if !std::ptr::eq(guard.principal(), &self.principal) {
            return Err(a::AccessError::Unavailable);
        }
        guard.revalidate()?;
        for grant in self.sources.borrow().iter() {
            guard.revalidate_source(grant)?;
        }
        for grant in self.partitions.borrow().iter() {
            guard.revalidate_source_partition(grant)?;
        }
        for source in &closure.source_refs {
            let source: a::SourceRef = serde_json::from_value(
                serde_json::to_value(source).map_err(|_| a::AccessError::Unavailable)?,
            )
            .map_err(|_| a::AccessError::Unavailable)?;
            if !self
                .sources
                .borrow()
                .iter()
                .any(|grant| grant.reference() == &source)
            {
                return Err(a::AccessError::Unavailable);
            }
        }
        for partition in &closure.source_partitions {
            let partition: a::SourcePartition = serde_json::from_value(
                serde_json::to_value(partition).map_err(|_| a::AccessError::Unavailable)?,
            )
            .map_err(|_| a::AccessError::Unavailable)?;
            if !self
                .partitions
                .borrow()
                .iter()
                .any(|grant| grant.partition() == &partition)
            {
                return Err(a::AccessError::Unavailable);
            }
        }
        Ok(())
    }
}
fn domain_access(error: a::AccessError) -> d::DomainError {
    match error {
        a::AccessError::Unauthenticated => d::DomainError::Unauthenticated,
        a::AccessError::NotFound => d::DomainError::NotFound,
        a::AccessError::Unavailable => d::DomainError::UpstreamUnavailable,
        _ => d::DomainError::Forbidden,
    }
}
fn storage_access(error: a::AccessError) -> s::Error {
    s::Error::new(error.code(), "Access capability unavailable")
}
pub fn access_scope(scope: &d::Scope) -> a::AccessResult<a::Scope> {
    Ok(a::Scope {
        workspace_id: a::CanonicalId::parse(&scope.workspace_id)?,
        home_id: a::CanonicalId::parse(&scope.home_id)?,
    })
}
#[derive(Clone)]
pub struct ReadAuthority(pub Access);
impl s::Authorization for ReadAuthority {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let access = self
            .0
            .try_lock()
            .map_err(|_| s::Error::new("unavailable", "Access unavailable"))?;
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(request.scope)?)
            .map_err(|_| s::Error::new("invalid-contract", "Invalid scope"))?;
        let principal = &p.principal;
        p.release(&access).map_err(storage_access)?;
        match request.capability {
            s::Capability::Read => {
                access
                    .authorize_storage(principal, &scope, a::Capability::Read)
                    .map_err(storage_access)?;
            }
            s::Capability::ReadHistory => {
                access
                    .authorize_storage(principal, &scope, a::Capability::ReadHistory)
                    .map_err(storage_access)?;
            }
            s::Capability::ReadAssetManifest => {
                access
                    .authorize_storage(principal, &scope, a::Capability::ReadAssetManifest)
                    .map_err(storage_access)?;
            }
            s::Capability::Mutate => {
                return Err(s::Error::new(
                    "unavailable",
                    "Command integration unavailable",
                ));
            }
            s::Capability::ConfigureSource | s::Capability::PublishCache => {
                return Err(s::Error::new(
                    "unavailable",
                    "Source publication integration unavailable",
                ));
            }
            s::Capability::ReadCache => {
                if let Some(partition) = request.source_partition {
                    let partition: a::SourcePartition =
                        serde_json::from_value(serde_json::to_value(partition)?).map_err(|_| {
                            s::Error::new("invalid-contract", "Invalid source partition")
                        })?;
                    p.capture_partition(&access, &partition)
                        .map_err(storage_access)?;
                } else if let Some(source) = request.source {
                    let source: a::SourceRef =
                        serde_json::from_value(source.clone()).map_err(|_| {
                            s::Error::new("invalid-contract", "Invalid source reference")
                        })?;
                    p.capture_source(&access, &source).map_err(storage_access)?;
                } else {
                    return Err(s::Error::new(
                        "forbidden",
                        "Source capability requires exact scope",
                    ));
                }
            }
        }
        Ok(s::VerifiedActor {
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            actor_id: principal.actor_id().as_str().into(),
        })
    }
}
pub struct HomeAuthority {
    pub access: Access,
    pub home: d::HomeSummary,
}
impl d::AccessPort<RequestPrincipal> for HomeAuthority {
    fn authorize(
        &self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        capability: d::Capability,
    ) -> d::DomainResult<d::AuthorizedHome> {
        if self.home.scope != *scope {
            return Err(d::DomainError::NotFound);
        }
        let access = self
            .access
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        let scope = access_scope(scope).map_err(domain_access)?;
        p.release(&access).map_err(domain_access)?;
        let capability = match capability {
            d::Capability::Read => a::Capability::Read,
            d::Capability::ReadHistory => a::Capability::ReadHistory,
            d::Capability::Mutate => a::Capability::Mutate,
        };
        access
            .authorize_storage(&p.principal, &scope, capability)
            .map_err(domain_access)?;
        Ok(d::AuthorizedHome {
            home: self.home.clone(),
            other_homes: p
                .home_choices
                .iter()
                .filter(|choice| choice.summary.scope.workspace_id == self.home.scope.workspace_id)
                .map(|choice| choice.summary.clone())
                .collect(),
            can_edit_homebox: false,
        })
    }
    fn revalidate(
        &self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        capability: d::Capability,
    ) -> d::DomainResult<()> {
        self.authorize(p, scope, capability)?;
        let access = self
            .access
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        p.release(&access).map_err(domain_access)
    }
}
pub struct Reads<'a>(pub &'a mut Store);
pub fn storage_error(error: s::Error) -> d::DomainError {
    match error.code {
        "unauthenticated" => d::DomainError::Unauthenticated,
        "not-found" => d::DomainError::NotFound,
        "forbidden" => d::DomainError::Forbidden,
        "invalid-contract" => d::DomainError::InvalidContract,
        "revision-required" => d::DomainError::RevisionRequired {
            current_revision: None,
        },
        "revision-conflict" => d::DomainError::RevisionConflict {
            current_revision: None,
        },
        "guard-conflict" => d::DomainError::GuardConflict {
            current_revision: None,
        },
        "identity-conflict" => d::DomainError::IdentityConflict,
        "idempotency-conflict" => d::DomainError::IdempotencyConflict,
        "invalid-transition" => d::DomainError::InvalidTransition,
        _ => d::DomainError::UpstreamUnavailable,
    }
}
impl d::ReadPort<RequestPrincipal> for Reads<'_> {
    fn snapshot(&mut self, p: &RequestPrincipal, scope: &d::Scope) -> d::DomainResult<d::Snapshot> {
        d::native_storage::NativeStorage::from_store(self.0, &NativeContracts).snapshot(p, scope)
    }
    fn record(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<d::Record> {
        d::native_storage::NativeStorage::from_store(self.0, &NativeContracts)
            .record(p, scope, target)
    }
    fn history(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<Vec<d::Audit>> {
        d::native_storage::NativeStorage::from_store(self.0, &NativeContracts)
            .history(p, scope, target)
    }
}
pub struct ServerRuntime;
pub fn now() -> Result<String, time::error::Format> {
    time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)
}
pub fn new_id() -> s::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| s::Error::new("unavailable", "Randomness unavailable"))?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    ))
}
impl s::Runtime for ServerRuntime {
    fn now(&self) -> s::Result<String> {
        now().map_err(|_| s::Error::new("unavailable", "Clock unavailable"))
    }
    fn new_id(&self) -> s::Result<String> {
        new_id()
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "unavailable",
            "Staged media integration unavailable",
        ))
    }
}
