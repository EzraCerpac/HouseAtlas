use rusqlite::{Connection, TransactionBehavior, params};

use super::{
    AccessBoundary, AccessError, AccessResult, PartitionGrant, PartitionMode, Principal,
    SourceGrant, SourcePartition, SourceRef, SourceRegistration, boundary::CurrentAuthority, store,
};

impl AccessBoundary {
    /// Trusted source registration seam. A normal principal has no configuration
    /// capability. Replacement preserves quarantine unless enabled is explicit.
    pub fn put_source(
        &mut self,
        registration: &SourceRegistration,
        enabled: Option<bool>,
    ) -> AccessResult<()> {
        registration.validate()?;
        let tx = self
            .store
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        write_source(&tx, registration, enabled)?;
        tx.commit()?;
        Ok(())
    }

    /// Explicit trusted administrative update, never derived from cache status,
    /// a client claim, or an editor's ordinary principal.
    pub fn set_source_enabled(
        &mut self,
        partition: &SourcePartition,
        enabled: bool,
    ) -> AccessResult<()> {
        partition.validate()?;
        self.store.db.execute(
            "UPDATE access_sources SET enabled=?1,version=version+1
             WHERE workspace_id=?2 AND home_id=?3 AND instance_id=?4 AND collection_id=?5",
            params![
                enabled,
                partition.workspace_id.as_str(),
                partition.home_id.as_str(),
                partition.source_instance_id.as_str(),
                partition.collection_id
            ],
        )?;
        Ok(())
    }

    pub fn authorize_source_partition(
        &self,
        principal: &Principal,
        partition: &SourcePartition,
    ) -> AccessResult<PartitionGrant> {
        self.current().partition_grant(principal, partition)
    }

    pub fn authorize_source(
        &self,
        principal: &Principal,
        reference: &SourceRef,
    ) -> AccessResult<SourceGrant> {
        self.current().source_grant(principal, reference)
    }

    pub fn revalidate_source_partition<'g>(
        &self,
        grant: &'g PartitionGrant,
    ) -> AccessResult<&'g PartitionGrant> {
        self.current()
            .revalidate_source_partition(&grant.principal, grant)
    }

    pub fn revalidate_source<'g>(&self, grant: &'g SourceGrant) -> AccessResult<&'g SourceGrant> {
        self.current().revalidate_source(&grant.principal, grant)
    }
}

/// Caller owns the access write transaction. Used by both trusted provisioning
/// and the separately authorized ConfigureSource operation without reentry.
pub(super) fn write_source(
    db: &Connection,
    registration: &SourceRegistration,
    enabled: Option<bool>,
) -> AccessResult<()> {
    registration.validate()?;
    let partition = registration.partition();
    let existing = store::source(db, &partition)?;
    let enabled = enabled.unwrap_or_else(|| existing.is_none_or(|s| s.enabled));
    {
        let mut query = db.prepare("SELECT registration FROM access_sources")?;
        let rows = query.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows {
            let other: SourceRegistration =
                serde_json::from_str(&row?).map_err(|_| AccessError::Unavailable)?;
            other.validate().map_err(|_| AccessError::Unavailable)?;
            if other.workspace_id != registration.workspace_id
                || other.source_instance_id != registration.source_instance_id
                || other.collection_id != registration.collection_id
            {
                continue;
            }
            if other.owner != registration.owner {
                return Err(AccessError::InvalidInput);
            }
            if other.home_id == registration.home_id {
                continue;
            }
            if other.partition_mode == PartitionMode::ExclusiveHome
                || registration.partition_mode == PartitionMode::ExclusiveHome
                || other
                    .allowed_external_ids
                    .iter()
                    .any(|id| registration.allowed_external_ids.contains(id))
            {
                return Err(AccessError::InvalidInput);
            }
        }
    }
    let encoded = serde_json::to_string(registration).map_err(|_| AccessError::InvalidInput)?;
    db.execute(
            "INSERT INTO access_sources VALUES(?1,?2,?3,?4,?5,?6,1)
             ON CONFLICT(workspace_id,home_id,instance_id,collection_id)
             DO UPDATE SET registration=excluded.registration,enabled=excluded.enabled,version=access_sources.version+1",
            params![registration.workspace_id.as_str(), registration.home_id.as_str(),
                registration.source_instance_id.as_str(), registration.collection_id, encoded, enabled],
        )?;
    Ok(())
}

impl CurrentAuthority<'_> {
    pub(super) fn partition_grant(
        &self,
        principal: &Principal,
        partition: &SourcePartition,
    ) -> AccessResult<PartitionGrant> {
        self.revalidate(principal)?;
        let row = self.checked_partition(principal, partition)?;
        Ok(PartitionGrant {
            principal: principal.clone(),
            partition: partition.clone(),
            version: row.version,
        })
    }

    pub(super) fn source_grant(
        &self,
        principal: &Principal,
        reference: &SourceRef,
    ) -> AccessResult<SourceGrant> {
        self.revalidate(principal)?;
        let row = self.checked_source(principal, reference)?;
        Ok(SourceGrant {
            principal: principal.clone(),
            reference: reference.clone(),
            version: row.version,
        })
    }

    pub(super) fn revalidate_source_partition<'g>(
        &self,
        principal: &Principal,
        original: &'g PartitionGrant,
    ) -> AccessResult<&'g PartitionGrant> {
        self.check_grant_principal(principal, &original.principal)?;
        let row = self.checked_partition(principal, &original.partition)?;
        if row.version != original.version {
            return Err(AccessError::NotFound);
        }
        Ok(original)
    }

    pub(super) fn revalidate_source<'g>(
        &self,
        principal: &Principal,
        original: &'g SourceGrant,
    ) -> AccessResult<&'g SourceGrant> {
        self.check_grant_principal(principal, &original.principal)?;
        let row = self.checked_source(principal, &original.reference)?;
        if row.version != original.version {
            return Err(AccessError::NotFound);
        }
        Ok(original)
    }

    pub(super) fn check_grant_principal(
        &self,
        principal: &Principal,
        captured: &Principal,
    ) -> AccessResult<()> {
        self.revalidate(principal)?;
        if captured.instance != *self.instance {
            return Err(AccessError::Unauthenticated);
        }
        // A shared actor/scope DTO is insufficient: the retained handle must
        // belong to the guard's original session, membership and issuance action.
        // Cloning a valid capability retains this complete private provenance.
        if captured.instance != principal.instance
            || captured.token_hash != principal.token_hash
            || captured.origin != principal.origin
            || captured.user_id != principal.user_id
            || captured.actor_id != principal.actor_id
            || captured.scope != principal.scope
            || captured.role != principal.role
            || captured.membership_version != principal.membership_version
            || captured.action != principal.action
        {
            return Err(AccessError::Forbidden);
        }
        Ok(())
    }

    pub(super) fn checked_partition(
        &self,
        principal: &Principal,
        partition: &SourcePartition,
    ) -> AccessResult<store::Source> {
        partition.validate().map_err(|_| AccessError::NotFound)?;
        if partition.scope() != principal.scope {
            return Err(AccessError::NotFound);
        }
        store::source(self.db, partition)?
            .filter(|s| s.enabled)
            .ok_or(AccessError::NotFound)
    }

    fn checked_source(
        &self,
        principal: &Principal,
        reference: &SourceRef,
    ) -> AccessResult<store::Source> {
        reference.validate().map_err(|_| AccessError::NotFound)?;
        let row = self.checked_partition(principal, &reference.partition())?;
        if row.registration.owner != reference.key.source_kind.owner()
            || (row.registration.partition_mode == PartitionMode::ReviewedEntityAllowlist
                && !row
                    .registration
                    .allowed_external_ids
                    .contains(&reference.key.external_id))
        {
            return Err(AccessError::NotFound);
        }
        Ok(row)
    }
}
