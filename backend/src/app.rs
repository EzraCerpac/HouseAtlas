//! The actual access/storage/domain composition and original request authority.
pub mod homebox_quantity_startup;
pub mod homebox_stock_host;
pub mod media_policy_recovery;
pub mod stock_activity_principal;
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
    pub store: Arc<Mutex<Store>>,
    /// One process-local owner cache shared by every request and transport.
    /// A reopened application starts with fresh continuation state.
    pub atlas_list_pages: d::stock::AtlasListPages,
    /// Actual renderer provenance captured by this host after successful commits.
    /// Process restart starts empty; it cannot reconstruct historical authority.
    pub media_policy_evidence: Mutex<crate::media::recovery_policy::MediaPolicyEvidence>,
    pub vault: Arc<crate::media::AssetVault>,
    pub home: d::HomeSummary,
    /// Trusted configured summaries; no labels or membership come from a request.
    pub homes: Vec<d::HomeSummary>,
}
pub struct CapturedHome {
    pub summary: d::HomeSummary,
    pub principal: a::Principal,
}
/// One actual AT11 issuance shared with native media without copying its handle.
/// Cloning the retained wrapper preserves the exact inner principal allocation.
#[derive(Clone)]
pub struct OriginalPrincipal(crate::media::native::RetainedPrincipal);
impl OriginalPrincipal {
    pub fn principal(&self) -> &a::Principal {
        self.0.principal()
    }
    pub fn retained(&self) -> &crate::media::native::RetainedPrincipal {
        &self.0
    }
}
impl std::ops::Deref for OriginalPrincipal {
    type Target = a::Principal;
    fn deref(&self) -> &Self::Target {
        self.principal()
    }
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
    pub principal: OriginalPrincipal,
    partitions: RefCell<Vec<a::PartitionGrant>>,
    sources: RefCell<Vec<a::SourceGrant>>,
    network_links: RefCell<Vec<a::NetworkLinkGrant>>,
    source_capture_sealed: Cell<bool>,
    pub home_choices: Vec<CapturedHome>,
}
impl d::stock::AtlasListPrincipal for RequestPrincipal {
    fn atlas_list_principal(&self) -> &a::Principal {
        self.principal.principal()
    }
}
impl s::StagedUploadPrincipal for RequestPrincipal {
    fn original_upload_principal(&self) -> &a::Principal {
        self.principal.principal()
    }
}
impl RequestPrincipal {
    pub fn new(principal: a::Principal) -> Self {
        Self::from_retained(crate::media::native::RetainedPrincipal::new(principal))
    }
    pub fn from_retained(principal: crate::media::native::RetainedPrincipal) -> Self {
        Self {
            principal: OriginalPrincipal(principal),
            partitions: RefCell::new(Vec::new()),
            sources: RefCell::new(Vec::new()),
            network_links: RefCell::new(Vec::new()),
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
        for grant in self.network_links.borrow().iter() {
            access.revalidate_network_link(grant)?;
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
    /// Clone only a handle captured by this original request before sealing.
    pub(crate) fn captured_partition(
        &self,
        partition: &a::SourcePartition,
    ) -> a::AccessResult<a::PartitionGrant> {
        self.partitions
            .borrow()
            .iter()
            .find(|grant| grant.partition() == partition)
            .cloned()
            .ok_or(a::AccessError::Unavailable)
    }
    pub(crate) fn captured_source(&self, source: &a::SourceRef) -> a::AccessResult<a::SourceGrant> {
        self.sources
            .borrow()
            .iter()
            .find(|grant| grant.reference() == source)
            .cloned()
            .ok_or(a::AccessError::Unavailable)
    }
    pub(crate) fn capture_network_link(
        &self,
        access: &a::AccessBoundary,
        reference: &a::NetworkLinkRef,
    ) -> a::AccessResult<()> {
        self.release(access)?;
        if self
            .network_links
            .borrow()
            .iter()
            .any(|grant| grant.reference() == reference)
        {
            return Ok(());
        }
        if self.source_capture_sealed.get() {
            return Err(a::AccessError::Unavailable);
        }
        // Stage both original endpoint grants without mutating the request.
        // A denied second endpoint or typed link must not leave a stray first
        // grant that can suppress unrelated qualified relations at release.
        let sources = self.sources.borrow();
        let member = |member_ref: &a::SourceRef| {
            sources
                .iter()
                .find(|grant| grant.reference() == member_ref)
                .cloned()
                .map(Ok)
                .unwrap_or_else(|| access.authorize_source(&self.principal, member_ref))
        };
        let from = member(reference.from())?;
        let to = if reference.from() == reference.to() {
            from.clone()
        } else {
            member(reference.to())?
        };
        let grant = access.authorize_network_link(&self.principal, reference, &from, &to)?;
        drop(sources);
        let mut sources = self.sources.borrow_mut();
        for staged in [from, to] {
            if !sources
                .iter()
                .any(|existing| existing.reference() == staged.reference())
            {
                sources.push(staged);
            }
        }
        drop(sources);
        self.network_links.borrow_mut().push(grant);
        Ok(())
    }
    pub(crate) fn has_captured_network_link(&self, reference: &a::NetworkLinkRef) -> bool {
        self.network_links
            .borrow()
            .iter()
            .any(|grant| grant.reference() == reference)
    }
    pub(crate) fn captured_network_members(
        &self,
        partition: &a::SourcePartition,
    ) -> Vec<a::SourceGrant> {
        self.sources
            .borrow()
            .iter()
            .filter(|grant| grant.reference().partition() == *partition)
            .cloned()
            .collect()
    }
    /// Recheck the original partition, complete configured member set and
    /// captured raw links under the canonical Access read transaction.
    pub(crate) fn revalidate_network_snapshot(
        &self,
        access: &mut a::AccessBoundary,
        partition: &a::PartitionGrant,
        members: &[a::SourceGrant],
    ) -> a::AccessResult<()> {
        access.with_source_read_authorization(
            self.principal.principal(),
            partition,
            members,
            |guard| {
                if !std::ptr::eq(guard.principal(), self.principal.principal()) {
                    return Err(a::AccessError::Forbidden);
                }
                for grant in self.network_links.borrow().iter() {
                    guard.revalidate_network_link(grant)?;
                }
                Ok(())
            },
        )
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
        if !std::ptr::eq(guard.principal(), self.principal.principal()) {
            return Err(a::AccessError::Unavailable);
        }
        guard.revalidate()?;
        for grant in self.sources.borrow().iter() {
            guard.revalidate_source(grant)?;
        }
        for grant in self.partitions.borrow().iter() {
            guard.revalidate_source_partition(grant)?;
        }
        for grant in self.network_links.borrow().iter() {
            guard.revalidate_network_link(grant)?;
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

/// Private Storage selector, distinct from the frozen public SourceRef carrier.
/// Endpoint values select data; only actual AT11 member/link issuance grants use.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CachedNetworkLink {
    workspace_id: a::CanonicalId,
    home_id: a::CanonicalId,
    key: CachedNetworkLinkKey,
    from: serde_json::Value,
    to: serde_json::Value,
    #[serde(default)]
    relation: Option<serde_json::Value>,
}
/// Per-call selectors from the actual retained generation. The map is data;
/// each link must also have an original grant on the same RequestPrincipal.
pub(crate) struct VerifiedNetworkSnapshotLink {
    pub relation: serde_json::Value,
    pub reference: a::NetworkLinkRef,
}
pub(crate) struct NetworkSnapshotAuthority<'a> {
    pub base: &'a ReadAuthority,
    pub links: &'a [VerifiedNetworkSnapshotLink],
}
impl s::Authorization for NetworkSnapshotAuthority<'_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if request.capability == s::Capability::ReadCache
            && request
                .source
                .is_some_and(|source| source["key"]["sourceKind"] == "network-link")
        {
            let selected: CachedNetworkLink = serde_json::from_value(
                request
                    .source
                    .ok_or_else(|| s::Error::new("not-found", "Network link unavailable"))?
                    .clone(),
            )
            .map_err(|_| s::Error::new("invalid-contract", "Invalid Network link selector"))?;
            let relation = selected
                .relation
                .as_ref()
                .ok_or_else(|| s::Error::new("not-found", "Network link unavailable"))?;
            let selected_partition = a::SourcePartition {
                workspace_id: selected.workspace_id,
                home_id: selected.home_id,
                source_instance_id: selected.key.source_instance_id,
                collection_id: selected.key.collection_id,
            };
            let matched = self
                .links
                .iter()
                .find(|link| {
                    link.relation == *relation
                        && selected.from == relation["from"]
                        && selected.to == relation["to"]
                        && link.reference.partition() == &selected_partition
                        && link.reference.external_id() == selected.key.external_id
                        && p.has_captured_network_link(&link.reference)
                })
                .ok_or_else(|| s::Error::new("not-found", "Network link unavailable"))?;
            let access = self
                .base
                .0
                .try_lock()
                .map_err(|_| s::Error::new("unavailable", "Access unavailable"))?;
            p.release(&access).map_err(storage_access)?;
            access
                .authorize_storage(&p.principal, p.principal.scope(), a::Capability::Read)
                .map_err(storage_access)?;
            if !p.has_captured_network_link(&matched.reference) {
                return Err(s::Error::new("not-found", "Network link unavailable"));
            }
            return Ok(s::VerifiedActor {
                workspace_id: p.principal.scope().workspace_id.as_str().into(),
                home_id: p.principal.scope().home_id.as_str().into(),
                actor_id: p.principal.actor_id().as_str().into(),
            });
        }
        self.base.authorize(p, request)
    }
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CachedNetworkLinkKey {
    source_instance_id: a::CanonicalId,
    collection_id: String,
    source_kind: String,
    external_id: String,
}
impl CachedNetworkLink {
    fn reference(self) -> a::AccessResult<a::NetworkLinkRef> {
        if self.key.source_kind != "network-link" {
            return Err(a::AccessError::NotFound);
        }
        let partition = a::SourcePartition {
            workspace_id: self.workspace_id,
            home_id: self.home_id,
            source_instance_id: self.key.source_instance_id,
            collection_id: self.key.collection_id,
        };
        let endpoint = |value: &serde_json::Value| -> a::AccessResult<a::SourceRef> {
            let source_kind = match value["kind"].as_str() {
                Some("group") => a::SourceKind::NetworkGroup,
                Some("device") => a::SourceKind::NetworkDevice,
                Some("interface") => a::SourceKind::NetworkInterface,
                Some("segment") => a::SourceKind::NetworkSegment,
                // Projected unresolved ends require original raw-member evidence.
                // This snapshot adapter has none and issues no substitute grant.
                _ => return Err(a::AccessError::NotFound),
            };
            Ok(a::SourceRef {
                workspace_id: partition.workspace_id.clone(),
                home_id: partition.home_id.clone(),
                key: a::SourceKey {
                    source_instance_id: partition.source_instance_id.clone(),
                    collection_id: partition.collection_id.clone(),
                    source_kind,
                    external_id: value["id"].as_str().ok_or(a::AccessError::NotFound)?.into(),
                },
            })
        };
        let from = endpoint(&self.from)?;
        let to = endpoint(&self.to)?;
        a::NetworkLinkRef::new(partition, self.key.external_id, from, to)
    }
}
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
                    if source["key"]["sourceKind"] == "network-link" {
                        let selected: CachedNetworkLink = serde_json::from_value(source.clone())
                            .map_err(|_| {
                                s::Error::new("invalid-contract", "Invalid Network link selector")
                            })?;
                        p.capture_network_link(
                            &access,
                            &selected.reference().map_err(storage_access)?,
                        )
                        .map_err(storage_access)?;
                    } else {
                        let source: a::SourceRef =
                            serde_json::from_value(source.clone()).map_err(|_| {
                                s::Error::new("invalid-contract", "Invalid source reference")
                            })?;
                        p.capture_source(&access, &source).map_err(storage_access)?;
                    }
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
