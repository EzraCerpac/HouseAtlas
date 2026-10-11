//! Immutable original request custody for a future HomeBox stock binding.
//! Captured grants and the actual Access allocation remain opaque handles.
//! Command and authority data do not qualify provider I/O or activity admission.
use super::{OriginalPrincipal, RequestPrincipal};
use crate::{
    access,
    providers::homebox::{
        recovery::NativeWriterContracts,
        write::stock::{ResourceKind, StockAuthority, StockCommand, StockContractPort},
    },
    storage::StockActivityPrincipal,
};

/// Carries only the unchanged request's original allocation and captured grants.
/// No serde, public fields, authority constructor or request interior mutability.
/// A separate original owner policy must qualify all activity and I/O phases.
pub struct OriginalStockActivityPrincipal {
    original: OriginalPrincipal,
    source: access::SourceGrant,
    partition: access::PartitionGrant,
    command: StockCommand,
    captured_authority: StockAuthority,
}

impl OriginalStockActivityPrincipal {
    /// Retain a validated existing entity/owned-resource intent. The caller must
    /// already have captured both grants on this request and resolved the real
    /// entity owner; missing entity identities and collection scope are held.
    /// This seals request source capture even if a later grant check fails.
    /// It neither captures new grants nor establishes source/dispatcher epochs,
    /// physical configuration, route, observation or approval evidence.
    pub fn from_captured_request(
        request: &RequestPrincipal,
        access: &mut access::AccessBoundary,
        contracts: &NativeWriterContracts,
        command: StockCommand,
        captured_authority: StockAuthority,
        owner: &access::SourceRef,
    ) -> access::AccessResult<Self> {
        let validated = contracts
            .validate_request(&command.original_wire)
            .map_err(|_| access::AccessError::InvalidInput)?;
        if validated != command {
            return Err(access::AccessError::InvalidInput);
        }
        // This narrow carrier requires an existing concrete target and entity
        // owner. It supplies no collection/created-target resolution policy.
        if command.target.resource_kind == ResourceKind::Collection
            || command.target.resource_id.is_none()
        {
            return Err(access::AccessError::Unavailable);
        }
        let entity_id = match command.target.resource_kind {
            ResourceKind::Entity => command.target.resource_id,
            _ => command.target.entity_id,
        }
        .ok_or(access::AccessError::Unavailable)?;
        let scope = request.principal.scope();
        if command.context.workspace_id.to_string() != scope.workspace_id.as_str()
            || command.context.home_id.to_string() != scope.home_id.as_str()
            || captured_authority.actor_id.to_string() != request.principal.actor_id().as_str()
            || owner.workspace_id != scope.workspace_id
            || owner.home_id != scope.home_id
            || owner.key.source_kind != access::SourceKind::HomeboxEntity
            || owner.key.source_instance_id.as_str()
                != command.target.source_instance_id.to_string()
            || owner.key.collection_id != command.target.collection_id.to_string()
            || owner.key.external_id != entity_id.to_string()
        {
            return Err(access::AccessError::Forbidden);
        }
        request.seal_source_capture();
        let source = request.captured_source(owner)?;
        let partition = request.captured_partition(&owner.partition())?;
        let original = request.principal.clone();
        access.with_mutation_authorization(
            original.principal(),
            |guard| -> access::AccessResult<()> {
                if !std::ptr::eq(guard.principal(), request.principal.principal()) {
                    return Err(access::AccessError::Unavailable);
                }
                guard.assert_mutation()?;
                guard.revalidate_source(&source)?;
                guard.revalidate_source_partition(&partition)?;
                Ok(())
            },
        )?;
        Ok(Self {
            original,
            source,
            partition,
            command,
            captured_authority,
        })
    }

    /// Original schema-validated intent, never a replacement wire projection.
    pub fn command(&self) -> &StockCommand {
        &self.command
    }

    /// Exact supplied owner data; this getter establishes no authority policy.
    pub fn captured_authority(&self) -> &StockAuthority {
        &self.captured_authority
    }
}

impl StockActivityPrincipal for OriginalStockActivityPrincipal {
    fn original_activity_principal(&self) -> &access::Principal {
        self.original.principal()
    }

    fn original_activity_source(&self) -> &access::SourceGrant {
        &self.source
    }

    fn original_activity_partition(&self) -> &access::PartitionGrant {
        &self.partition
    }
}

// Type checks only: no synthetic capability or activity execution.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<OriginalStockActivityPrincipal>();
};
