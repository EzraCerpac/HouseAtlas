//! Retained-only facet binding for the root's checked/authorized GET adapter.
//! This function accepts no transport, refresh, demand or diagnostic capability.
use crate::{
    access as a,
    app::{Core, RequestPrincipal},
    config::providers::registry::ConfiguredSource,
    http::contracts::NativeContracts,
    lifecycle::providers::network::NetworkRuntime,
    providers::network as n,
    storage as s,
};
use s::Contract;

/// Required authority-owner seam for the original whole-collection membership
/// and full current registration. PartitionGrant alone exposes neither. Link
/// and observation IDs must be covered explicitly by this grant; endpoint
/// grants below cannot substitute for it. No default authorization is supplied.
pub trait NetworkDisclosureAuthority {
    type Membership;
    fn capture_membership(
        &self,
        access: &a::AccessBoundary,
        principal: &RequestPrincipal,
        source: &ConfiguredSource,
    ) -> a::AccessResult<Self::Membership>;
    fn authorize_facet(
        &self,
        access: &a::AccessBoundary,
        principal: &RequestPrincipal,
        membership: &Self::Membership,
        facet: &n::NetworkFacet,
    ) -> a::AccessResult<()>;
    fn release_membership(
        &self,
        access: &a::AccessBoundary,
        principal: &RequestPrincipal,
        membership: &Self::Membership,
    ) -> a::AccessResult<()>;
}
/// Keep the captured membership until the final serialized response is checked.
/// No unchecked raw facet accessor or serialization implementation is exposed.
pub struct HeldNetworkFacet<'p, 'a, A: NetworkDisclosureAuthority> {
    facet: n::NetworkFacet,
    membership: A::Membership,
    authority: &'a A,
    principal: &'p RequestPrincipal,
}
impl<A: NetworkDisclosureAuthority> HeldNetworkFacet<'_, '_, A> {
    pub fn serialize_for_release(self, core: &Core) -> s::Result<Vec<u8>> {
        let bytes = serde_json::to_vec(&self.facet)?;
        let access = core.access.try_lock().map_err(|_| unavailable())?;
        self.authority
            .authorize_facet(&access, self.principal, &self.membership, &self.facet)
            .map_err(access_error)?;
        self.authority
            .release_membership(&access, self.principal, &self.membership)
            .map_err(access_error)?;
        self.principal.release(&access).map_err(access_error)?;
        Ok(bytes)
    }
}

pub fn retained_facet<'p, 'a, A: NetworkDisclosureAuthority>(
    core: &mut Core,
    principal: &'p RequestPrincipal,
    runtime: &NetworkRuntime,
    authority: &'a A,
    now: &str,
) -> s::Result<HeldNetworkFacet<'p, 'a, A>> {
    let source = runtime.settings().source();
    let scope: s::Scope = serde_json::from_value(serde_json::json!({
        "workspaceId": source.scope.workspace_id, "homeId": source.scope.home_id,
    }))?;
    let snapshot = core
        .store
        .get_mut()
        .map_err(|_| unavailable())?
        .read_snapshot(principal, &scope)?;
    NativeContracts.validate_snapshot(&snapshot)?;
    // Compare the FULL durable registration, including partition mode/allowlist.
    // An entity-filtered snapshot is never a substitute for retained membership.
    let expected = serde_json::to_value(source)?;
    if !snapshot
        .sources
        .iter()
        .any(|registered| registered == &expected)
    {
        return Err(unavailable());
    }
    let partition: a::SourcePartition =
        serde_json::from_value(serde_json::to_value(&source.scope)?)?;
    let membership = {
        let access = core.access.try_lock().map_err(|_| unavailable())?;
        principal
            .capture_partition(&access, &partition)
            .map_err(access_error)?;
        authority
            .capture_membership(&access, principal, runtime.settings().configured_source())
            .map_err(access_error)?
    };
    let mut caches = snapshot
        .caches
        .iter()
        .filter(|cache| same_partition(cache, &source.scope));
    let cache: n::CacheMetadata = match caches.next() {
        Some(cache) => serde_json::from_value(cache.clone())?,
        None => n::RetainedState::empty(source.scope.clone()).cache,
    };
    if caches.next().is_some() {
        return Err(unavailable());
    }
    let facet = if cache.status == n::CacheStatus::AccessRevoked {
        // Do not load a retained payload through a denied/filtered relation set.
        // The native snapshot keeps recovery metadata; public generation is empty.
        n::build_facet(
            source,
            &n::RetainedState {
                cache,
                generation: None,
            },
            now,
            runtime.settings().stale_after_ms(),
        )
    } else {
        let relations = snapshot
            .network_relations
            .iter()
            .filter(|relation| same_partition(relation, &source.scope))
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<Vec<n::NetworkRelation>, _>>()?;
        let retained = runtime
            .retained(&cache, &relations)
            .map_err(network_error)?;
        // Reopening compares the entire current native relation set with the
        // immutable retained row. No filtered partial generation is released.
        let public = runtime
            .settings()
            .provider()
            .map_err(network_error)?
            .read(&retained)
            .map_err(network_error)?;
        n::build_facet(source, &public, now, runtime.settings().stale_after_ms())
    }
    .map_err(network_error)?;
    // Native snapshot reads capture relation-ID and endpoint grants. Sidecar
    // records also require ORIGINAL source grants for every disclosed record.
    let access = core.access.try_lock().map_err(|_| unavailable())?;
    for record in facet
        .groups
        .iter()
        .chain(&facet.devices)
        .chain(&facet.interfaces)
        .chain(&facet.segments)
    {
        let source_kind = match record.source_kind {
            n::SourceKind::Group => a::SourceKind::NetworkGroup,
            n::SourceKind::Device => a::SourceKind::NetworkDevice,
            n::SourceKind::Interface => a::SourceKind::NetworkInterface,
            n::SourceKind::Segment => a::SourceKind::NetworkSegment,
            n::SourceKind::Link => return Err(unavailable()),
        };
        let reference = a::SourceRef {
            workspace_id: partition.workspace_id.clone(),
            home_id: partition.home_id.clone(),
            key: a::SourceKey {
                source_instance_id: partition.source_instance_id.clone(),
                collection_id: partition.collection_id.clone(),
                source_kind,
                external_id: record.external_id.clone(),
            },
        };
        principal
            .capture_source(&access, &reference)
            .map_err(access_error)?;
    }
    authority
        .authorize_facet(&access, principal, &membership, &facet)
        .map_err(access_error)?;
    principal.release(&access).map_err(access_error)?;
    Ok(HeldNetworkFacet {
        facet,
        membership,
        authority,
        principal,
    })
}
fn same_partition(value: &serde_json::Value, scope: &n::SourceScope) -> bool {
    value["workspaceId"] == scope.workspace_id
        && value["homeId"] == scope.home_id
        && value["sourceInstanceId"] == scope.source_instance_id
        && value["collectionId"] == scope.collection_id
}
fn unavailable() -> s::Error {
    s::Error::new("unavailable", "Network data unavailable")
}
fn access_error(error: a::AccessError) -> s::Error {
    s::Error::new(error.code(), "Network access unavailable")
}
fn network_error(error: n::NetworkError) -> s::Error {
    s::Error::new("upstream-unavailable", error.message())
}
