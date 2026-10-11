//! Server-only Network disclosure permissions, separate from frozen SourceKind.
//! References are matching data, never evidence of accepted-generation membership.

use super::{
    AccessBoundary, AccessError, AccessResult, PartitionGrant, PartitionMode, Principal,
    SourceGrant, SourceKind, SourceOwner, SourcePartition, SourceRef, TransactionAuthorization,
    boundary::CurrentAuthority, types::opaque_text,
};

/// Qualified raw link selector. Retain BOTH original endpoints, including the
/// original hidden endpoint when a reviewed relation projects it as unresolved.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkLinkRef {
    partition: SourcePartition,
    external_id: String,
    from: SourceRef,
    to: SourceRef,
}

impl NetworkLinkRef {
    pub fn new(
        partition: SourcePartition,
        external_id: impl Into<String>,
        from: SourceRef,
        to: SourceRef,
    ) -> AccessResult<Self> {
        partition.validate()?;
        let external_id = external_id.into();
        opaque_text(&external_id)?;
        for reference in [&from, &to] {
            reference.validate()?;
            if reference.partition() != partition
                || !matches!(
                    reference.key.source_kind,
                    SourceKind::NetworkDevice
                        | SourceKind::NetworkInterface
                        | SourceKind::NetworkSegment
                )
            {
                return Err(AccessError::InvalidInput);
            }
        }
        Ok(Self {
            partition,
            external_id,
            from,
            to,
        })
    }

    pub fn partition(&self) -> &SourcePartition {
        &self.partition
    }
    pub fn external_id(&self) -> &str {
        &self.external_id
    }
    pub fn from(&self) -> &SourceRef {
        &self.from
    }
    pub fn to(&self) -> &SourceRef {
        &self.to
    }
}

/// Observation IDs occupy their OWN namespace, even when an inventory/link ID
/// has the same spelling. collector_id is scoped matching/provenance data, not
/// an issuer or independent collector permission. Keep both declared members.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkObservationRef {
    partition: SourcePartition,
    external_id: String,
    collector_id: String,
    device: Option<SourceRef>,
    interface: Option<SourceRef>,
}

impl NetworkObservationRef {
    pub fn new(
        partition: SourcePartition,
        external_id: impl Into<String>,
        collector_id: impl Into<String>,
        device: Option<SourceRef>,
        interface: Option<SourceRef>,
    ) -> AccessResult<Self> {
        partition.validate()?;
        let external_id = external_id.into();
        let collector_id = collector_id.into();
        opaque_text(&external_id)?;
        opaque_text(&collector_id)?;
        for (member, expected) in [
            (&device, SourceKind::NetworkDevice),
            (&interface, SourceKind::NetworkInterface),
        ] {
            if let Some(member) = member {
                member.validate()?;
                if member.partition() != partition || member.key.source_kind != expected {
                    return Err(AccessError::InvalidInput);
                }
            }
        }
        Ok(Self {
            partition,
            external_id,
            collector_id,
            device,
            interface,
        })
    }

    pub fn partition(&self) -> &SourcePartition {
        &self.partition
    }
    pub fn external_id(&self) -> &str {
        &self.external_id
    }
    pub fn collector_id(&self) -> &str {
        &self.collector_id
    }
    pub fn device(&self) -> Option<&SourceRef> {
        self.device.as_ref()
    }
    pub fn interface(&self) -> Option<&SourceRef> {
        self.interface.as_ref()
    }
}

/// Opaque original link permission, including genuine principal/source version
/// and retained endpoint grants. No serde, DTO issuer, raw DB or lifecycle power.
pub struct NetworkLinkGrant {
    reference: NetworkLinkRef,
    partition: PartitionGrant,
    from: SourceGrant,
    to: SourceGrant,
}
impl NetworkLinkGrant {
    pub fn reference(&self) -> &NetworkLinkRef {
        &self.reference
    }
}

/// Opaque original observation permission. Its typed preimage binds the exact
/// collector/observation/member tuple; collector strings issue no capability.
pub struct NetworkObservationGrant {
    reference: NetworkObservationRef,
    partition: PartitionGrant,
    device: Option<SourceGrant>,
    interface: Option<SourceGrant>,
}
impl NetworkObservationGrant {
    pub fn reference(&self) -> &NetworkObservationRef {
        &self.reference
    }
}

impl AccessBoundary {
    pub fn authorize_network_link(
        &self,
        principal: &Principal,
        reference: &NetworkLinkRef,
        from: &SourceGrant,
        to: &SourceGrant,
    ) -> AccessResult<NetworkLinkGrant> {
        let current = self.current();
        current.match_member(principal, Some(&reference.from), Some(from))?;
        current.match_member(principal, Some(&reference.to), Some(to))?;
        current.network_resource(
            principal,
            &reference.partition,
            &reference.external_id,
            false,
        )?;
        Ok(NetworkLinkGrant {
            reference: reference.clone(),
            partition: current.partition_grant(principal, &reference.partition)?,
            from: from.clone(),
            to: to.clone(),
        })
    }

    pub fn authorize_network_observation(
        &self,
        principal: &Principal,
        reference: &NetworkObservationRef,
        device: Option<&SourceGrant>,
        interface: Option<&SourceGrant>,
    ) -> AccessResult<NetworkObservationGrant> {
        let current = self.current();
        current.revalidate(principal)?;
        current.match_member(principal, reference.device.as_ref(), device)?;
        current.match_member(principal, reference.interface.as_ref(), interface)?;
        current.network_resource(
            principal,
            &reference.partition,
            &reference.external_id,
            reference.device.is_none() && reference.interface.is_none(),
        )?;
        Ok(NetworkObservationGrant {
            reference: reference.clone(),
            partition: current.partition_grant(principal, &reference.partition)?,
            device: device.cloned(),
            interface: interface.cloned(),
        })
    }

    pub fn revalidate_network_link<'g>(
        &self,
        original: &'g NetworkLinkGrant,
    ) -> AccessResult<&'g NetworkLinkGrant> {
        self.current()
            .revalidate_network_link(&original.partition.principal, original)
    }

    pub fn revalidate_network_observation<'g>(
        &self,
        original: &'g NetworkObservationGrant,
    ) -> AccessResult<&'g NetworkObservationGrant> {
        self.current()
            .revalidate_network_observation(&original.partition.principal, original)
    }
}

impl TransactionAuthorization<'_> {
    pub fn revalidate_network_link<'g>(
        &self,
        original: &'g NetworkLinkGrant,
    ) -> AccessResult<&'g NetworkLinkGrant> {
        self.authority
            .revalidate_network_link(self.principal(), original)
    }

    pub fn revalidate_network_observation<'g>(
        &self,
        original: &'g NetworkObservationGrant,
    ) -> AccessResult<&'g NetworkObservationGrant> {
        self.authority
            .revalidate_network_observation(self.principal(), original)
    }
}

impl CurrentAuthority<'_> {
    fn network_resource(
        &self,
        principal: &Principal,
        partition: &SourcePartition,
        external_id: &str,
        collection_only: bool,
    ) -> AccessResult<()> {
        let row = self.checked_partition(principal, partition)?;
        if row.registration.owner != SourceOwner::Network
            || (row.registration.partition_mode == PartitionMode::ReviewedEntityAllowlist
                && (collection_only
                    || !row
                        .registration
                        .allowed_external_ids
                        .iter()
                        .any(|id| id == external_id)))
        {
            return Err(AccessError::NotFound);
        }
        Ok(())
    }

    fn match_member(
        &self,
        principal: &Principal,
        reference: Option<&SourceRef>,
        original: Option<&SourceGrant>,
    ) -> AccessResult<()> {
        match (reference, original) {
            (None, None) => Ok(()),
            (Some(reference), Some(original)) if original.reference() == reference => {
                self.revalidate_source(principal, original)?;
                Ok(())
            }
            _ => Err(AccessError::NotFound),
        }
    }

    fn revalidate_network_link<'g>(
        &self,
        principal: &Principal,
        original: &'g NetworkLinkGrant,
    ) -> AccessResult<&'g NetworkLinkGrant> {
        self.revalidate_source_partition(principal, &original.partition)?;
        let reference = &original.reference;
        self.match_member(principal, Some(&reference.from), Some(&original.from))?;
        self.match_member(principal, Some(&reference.to), Some(&original.to))?;
        self.network_resource(
            principal,
            &reference.partition,
            &reference.external_id,
            false,
        )?;
        Ok(original)
    }

    fn revalidate_network_observation<'g>(
        &self,
        principal: &Principal,
        original: &'g NetworkObservationGrant,
    ) -> AccessResult<&'g NetworkObservationGrant> {
        self.revalidate_source_partition(principal, &original.partition)?;
        let reference = &original.reference;
        self.match_member(
            principal,
            reference.device.as_ref(),
            original.device.as_ref(),
        )?;
        self.match_member(
            principal,
            reference.interface.as_ref(),
            original.interface.as_ref(),
        )?;
        self.network_resource(
            principal,
            &reference.partition,
            &reference.external_id,
            reference.device.is_none() && reference.interface.is_none(),
        )?;
        Ok(original)
    }
}
