//! The real access/storage/domain composition. Application routes are read-only.
use crate::{access as a, domain as d, http::contracts::ReadContracts, storage as s};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    cell::RefCell,
    sync::{Arc, Mutex},
};

pub type Access = Arc<Mutex<a::AccessBoundary>>;
pub type Store = s::AtlasStore<ReadContracts, ReadAuthority, ServerRuntime>;
pub struct Core {
    pub access: Access,
    pub store: Store,
    pub home: d::HomeSummary,
}
pub struct RequestPrincipal {
    pub principal: a::Principal,
    partitions: RefCell<Vec<a::PartitionGrant>>,
    sources: RefCell<Vec<a::SourceGrant>>,
}
impl RequestPrincipal {
    pub fn new(principal: a::Principal) -> Self {
        Self {
            principal,
            partitions: RefCell::new(Vec::new()),
            sources: RefCell::new(Vec::new()),
        }
    }
    fn release(&self, access: &a::AccessBoundary) -> a::AccessResult<()> {
        access.revalidate(&self.principal)?;
        for grant in self.partitions.borrow().iter() {
            access.revalidate_source_partition(grant)?;
        }
        for grant in self.sources.borrow().iter() {
            access.revalidate_source(grant)?;
        }
        Ok(())
    }
}
fn convert<T: Serialize, U: DeserializeOwned>(value: &T) -> d::DomainResult<U> {
    serde_json::to_value(value)
        .and_then(serde_json::from_value)
        .map_err(|_| d::DomainError::InvalidContract)
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
            .lock()
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
                return Err(s::Error::new(
                    "unavailable",
                    "Asset integration unavailable",
                ));
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
                    p.partitions.borrow_mut().push(
                        access
                            .authorize_source_partition(principal, &partition)
                            .map_err(storage_access)?,
                    );
                } else if let Some(source) = request.source {
                    let source: a::SourceRef =
                        serde_json::from_value(source.clone()).map_err(|_| {
                            s::Error::new("invalid-contract", "Invalid source reference")
                        })?;
                    p.sources.borrow_mut().push(
                        access
                            .authorize_source(principal, &source)
                            .map_err(storage_access)?,
                    );
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
        let capability = match capability {
            d::Capability::Read => a::Capability::Read,
            d::Capability::ReadHistory => a::Capability::ReadHistory,
            d::Capability::Mutate => return Err(d::DomainError::UpstreamUnavailable),
        };
        access
            .authorize_storage(&p.principal, &scope, capability)
            .map_err(domain_access)?;
        Ok(d::AuthorizedHome {
            home: self.home.clone(),
            other_homes: vec![],
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
fn storage_error(error: s::Error) -> d::DomainError {
    match error.code {
        "unauthenticated" => d::DomainError::Unauthenticated,
        "not-found" => d::DomainError::NotFound,
        "forbidden" => d::DomainError::Forbidden,
        "invalid-contract" => d::DomainError::InvalidContract,
        _ => d::DomainError::UpstreamUnavailable,
    }
}
impl d::ReadPort<RequestPrincipal> for Reads<'_> {
    fn snapshot(&mut self, p: &RequestPrincipal, scope: &d::Scope) -> d::DomainResult<d::Snapshot> {
        let snapshot = self
            .0
            .read_snapshot(p, &convert(scope)?)
            .map_err(storage_error)?;
        s::Contract::validate_snapshot(&ReadContracts, &snapshot).map_err(storage_error)?;
        convert(&snapshot)
    }
    fn record(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<d::Record> {
        let record = self
            .0
            .read_record(p, &convert(scope)?, &convert(target)?)
            .map_err(storage_error)?;
        ReadContracts
            .shape(
                "record",
                &serde_json::to_value(&record).map_err(|_| d::DomainError::InvalidContract)?,
            )
            .map_err(storage_error)?;
        convert(&record)
    }
    fn history(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<Vec<d::Audit>> {
        let audits = self
            .0
            .history(p, &convert(scope)?, &convert(target)?)
            .map_err(storage_error)?;
        for audit in &audits {
            ReadContracts
                .shape(
                    "audit",
                    &serde_json::to_value(audit).map_err(|_| d::DomainError::InvalidContract)?,
                )
                .map_err(storage_error)?;
        }
        convert(&audits)
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
