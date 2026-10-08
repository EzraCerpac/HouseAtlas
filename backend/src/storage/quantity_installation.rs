//! Read-only observation of the installed quantity path on the actual Store.
//! The retained original and guard are rechecked; these facts grant no write.

use super::super::{
    Authorization, Contract, Error, QuantityInstallationObservation,
    QuantityInstallationStoreIdentity, QuantityInstallationTransaction, Result, Runtime,
    StockActivityPhysicalRegistration, StockActivityPrincipal,
};
use super::AtlasStore;
use crate::providers::homebox::write::stock::{Digest, PhysicalBinding};
use crate::{
    access,
    jobs::{self, QueueConfig},
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use std::sync::Arc;
use uuid::Uuid;

fn unavailable() -> Error {
    Error::new(
        "storage-unavailable",
        "Quantity installation is unavailable",
    )
}

fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Quantity installation is incompatible",
    )
}

fn forbidden() -> Error {
    Error::new("forbidden", "Original quantity authority is required")
}

fn canonical_uuid(text: &str) -> bool {
    Uuid::parse_str(text).is_ok_and(|value| value.to_string() == text)
}

fn canonical_u64(text: &str) -> bool {
    text.parse::<u64>()
        .is_ok_and(|value| value.to_string() == text)
}

fn bounded_scalar(text: &str) -> bool {
    !text.is_empty() && text.len() <= 4096
}

fn check_original<P: StockActivityPrincipal>(
    original: &P,
    guard: &access::TransactionAuthorization<'_>,
) -> Result<access::SourceAuthorityMetadata> {
    if !std::ptr::eq(original.original_activity_principal(), guard.principal()) {
        return Err(forbidden());
    }
    guard.assert_mutation().map_err(|_| forbidden())?;
    guard
        .authorize(guard.principal().scope(), access::Capability::Mutate)
        .map_err(|_| forbidden())?;
    let source = original.original_activity_source();
    let partition = original.original_activity_partition();
    guard.revalidate_source(source).map_err(|_| forbidden())?;
    guard
        .revalidate_source_partition(partition)
        .map_err(|_| forbidden())?;
    let reference = source.reference();
    if reference.key.source_kind != access::SourceKind::HomeboxEntity
        || reference.partition() != *partition.partition()
        || partition.partition().scope() != *guard.principal().scope()
    {
        return Err(forbidden());
    }
    let metadata = guard
        .persisted_source_metadata(partition)
        .map_err(|_| unavailable())?;
    if metadata.registration().owner != access::SourceOwner::Homebox
        || metadata.registration().partition() != *partition.partition()
    {
        return Err(incompatible());
    }
    Ok(metadata)
}

fn check_config_bounds(config: &QueueConfig) -> Result<()> {
    let registration = &config.registration;
    if registration.aliases.len() > 1000
        || !canonical_uuid(&registration.identity.deployment_id)
        || !canonical_uuid(&registration.identity.physical_database_id)
        || !canonical_uuid(&registration.dispatcher_owner_id)
        || registration.aliases.iter().any(|alias| {
            !canonical_uuid(&alias.partition.workspace_id)
                || !canonical_uuid(&alias.partition.home_id)
                || !canonical_uuid(&alias.partition.source_instance_id)
                || !bounded_scalar(&alias.partition.collection_id)
                || !bounded_scalar(&alias.canonical_collection_id)
        })
    {
        return Err(incompatible());
    }
    config.validate().map_err(|_| incompatible())?;
    Ok(())
}

fn check_queue_source<P: StockActivityPrincipal>(original: &P, config: &QueueConfig) -> Result<()> {
    let partition = original.original_activity_partition().partition();
    let source = original.original_activity_source().reference();
    let selected = jobs::SourcePartition {
        workspace_id: partition.workspace_id.as_str().into(),
        home_id: partition.home_id.as_str().into(),
        source_instance_id: partition.source_instance_id.as_str().into(),
        collection_id: partition.collection_id.clone(),
    };
    if source.partition() != *partition
        || config
            .registration
            .aliases
            .iter()
            .filter(|alias| alias.partition == selected)
            .count()
            != 1
    {
        return Err(incompatible());
    }
    Ok(())
}

fn check_physical_identity(
    config: &QueueConfig,
    expected: &StockActivityPhysicalRegistration,
) -> Result<()> {
    let identity = &config.registration.identity;
    let binding = &expected.physical_binding;
    if identity.deployment_id != binding.deployment_id.to_string()
        || identity.physical_database_id != binding.physical_database_id.to_string()
        || identity.configuration_digest.as_hex() != binding.configuration_digest.as_str()
        || config.registration.dispatcher_owner_id != expected.owner_id.to_string()
    {
        return Err(incompatible());
    }
    Ok(())
}

fn check_persisted(
    db: &rusqlite::Connection,
    config: &QueueConfig,
    expected: &StockActivityPhysicalRegistration,
) -> Result<StockActivityPhysicalRegistration> {
    let identity = &config.registration.identity;
    // Bound the existing queue validator's configuration encoding and alias
    // scan before it materializes either persisted value.
    let queue_bounds: Option<(i64, i64, Option<i64>)> = db.query_row(
        "SELECT length(CAST(configuration_json AS BLOB)),
                (SELECT count(*) FROM queue_aliases WHERE deployment_id=?1 AND physical_database_id=?2),
                (SELECT max(scalar_bytes) FROM (SELECT max(length(CAST(workspace_id AS BLOB)), length(CAST(home_id AS BLOB)), length(CAST(source_instance_id AS BLOB)), length(CAST(collection_id AS BLOB)), length(CAST(canonical_collection_id AS BLOB))) AS scalar_bytes FROM queue_aliases WHERE deployment_id=?1 AND physical_database_id=?2))
         FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2
           AND length(CAST(configuration_digest AS BLOB))=64
           AND length(CAST(owner_id AS BLOB))=36",
        params![identity.deployment_id, identity.physical_database_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|_| unavailable())?;
    let (bytes, count, scalar) = queue_bounds.ok_or_else(unavailable)?;
    if !(1..=1_048_576).contains(&bytes)
        || !(1..=1000).contains(&count)
        || scalar.is_some_and(|length| !(0..=4096).contains(&length))
    {
        return Err(unavailable());
    }
    super::super::queue::validate_quantity_installation_queue(db, config)?;

    let physical = expected.physical_binding.physical_database_id.to_string();
    let row: Option<(String, String, String, String)> = db
        .query_row(
            "SELECT deployment_id, configuration_digest, owner_id, dispatcher_epoch
         FROM stock_activity_physical WHERE physical_database_id=?1
           AND length(CAST(deployment_id AS BLOB))=36
           AND length(CAST(configuration_digest AS BLOB))=64
           AND length(CAST(owner_id AS BLOB))=36
           AND length(CAST(dispatcher_epoch AS BLOB)) BETWEEN 1 AND 20",
            [&physical],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| unavailable())?;
    let row = row.ok_or_else(unavailable)?;
    if !canonical_uuid(&row.0)
        || !canonical_uuid(&row.2)
        || !canonical_u64(&row.3)
        || row
            != (
                expected.physical_binding.deployment_id.to_string(),
                expected
                    .physical_binding
                    .configuration_digest
                    .as_str()
                    .into(),
                expected.owner_id.to_string(),
                expected.dispatcher_epoch.to_string(),
            )
    {
        return Err(incompatible());
    }
    let actual = StockActivityPhysicalRegistration {
        physical_binding: PhysicalBinding {
            deployment_id: Uuid::parse_str(&row.0).map_err(|_| incompatible())?,
            physical_database_id: Uuid::parse_str(&physical).map_err(|_| incompatible())?,
            configuration_digest: Digest::parse(row.1).map_err(|_| incompatible())?,
        },
        owner_id: Uuid::parse_str(&row.2).map_err(|_| incompatible())?,
        dispatcher_epoch: row.3.parse().map_err(|_| incompatible())?,
    };
    // A physical database has one deployment owner, even if another queue
    // row was installed through a different deployment key.
    let alternate: i64 = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM queue_physical WHERE physical_database_id=?1 AND deployment_id<>?2)",
        params![physical, identity.deployment_id],
        |row| row.get(0),
    ).map_err(|_| unavailable())?;
    if alternate != 0 {
        return Err(incompatible());
    }
    Ok(actual)
}

/// Recheck the complete installed quantity path under the activity journal's
/// existing transaction. This does not open a second transaction or expose SQL
/// to a caller of the returned observation.
pub(crate) fn observe_quantity_installation_in_transaction<'tx, 'p, P: StockActivityPrincipal>(
    db: &'tx rusqlite::Connection,
    identity: &QuantityInstallationStoreIdentity,
    original: &'p P,
    guard: &access::TransactionAuthorization<'_>,
    queue: &QueueConfig,
    expected: &StockActivityPhysicalRegistration,
) -> Result<QuantityInstallationTransaction<'tx, 'p, P>> {
    if db.is_autocommit() {
        return Err(unavailable());
    }
    check_config_bounds(queue)?;
    check_queue_source(original, queue)?;
    check_physical_identity(queue, expected)?;
    let before = check_original(original, guard)?;
    let registration = check_persisted(db, queue, expected)?;
    let after = check_original(original, guard)?;
    if before != after {
        return Err(forbidden());
    }
    Ok(QuantityInstallationTransaction {
        observation: QuantityInstallationObservation {
            instance: Arc::clone(&identity.0),
            original,
            queue_config: queue.clone(),
            registration,
            source_reference: original.original_activity_source().reference().clone(),
            source_partition: original.original_activity_partition().partition().clone(),
            source_metadata: after,
        },
        _connection: db,
    })
}

impl<C, A, R> AtlasStore<C, A, R> {
    pub fn quantity_installation_store_identity(&self) -> QuantityInstallationStoreIdentity {
        QuantityInstallationStoreIdentity(Arc::clone(&self.instance))
    }
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn observe_quantity_installation_with_authorization<'p, P: StockActivityPrincipal>(
        &mut self,
        original: &'p P,
        guard: &access::TransactionAuthorization<'_>,
        queue: &QueueConfig,
        expected: &StockActivityPhysicalRegistration,
    ) -> Result<QuantityInstallationObservation<'p, P>> {
        if !self.options.stock_activity_profile {
            return Err(unavailable());
        }
        check_config_bounds(queue)?;
        check_queue_source(original, queue)?;
        check_physical_identity(queue, expected)?;
        let before = check_original(original, guard)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let registration = check_persisted(&tx, queue, expected)?;
        let after = check_original(original, guard)?;
        if before != after {
            return Err(forbidden());
        }
        tx.commit()?;
        Ok(QuantityInstallationObservation {
            instance: Arc::clone(&self.instance),
            original,
            queue_config: queue.clone(),
            registration,
            source_reference: original.original_activity_source().reference().clone(),
            source_partition: original.original_activity_partition().partition().clone(),
            source_metadata: after,
        })
    }

    pub fn revalidate_quantity_installation_with_authorization<P: StockActivityPrincipal>(
        &mut self,
        observation: &QuantityInstallationObservation<'_, P>,
        guard: &access::TransactionAuthorization<'_>,
    ) -> Result<()> {
        if !self.options.stock_activity_profile {
            return Err(unavailable());
        }
        if !Arc::ptr_eq(&self.instance, &observation.instance)
            || !std::ptr::eq(
                observation.original.original_activity_principal(),
                guard.principal(),
            )
            || observation.source_reference
                != *observation.original.original_activity_source().reference()
            || observation.source_partition
                != *observation
                    .original
                    .original_activity_partition()
                    .partition()
        {
            return Err(forbidden());
        }
        check_config_bounds(&observation.queue_config)?;
        check_queue_source(observation.original, &observation.queue_config)?;
        check_physical_identity(&observation.queue_config, &observation.registration)?;
        if check_original(observation.original, guard)? != observation.source_metadata {
            return Err(forbidden());
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        if check_persisted(&tx, &observation.queue_config, &observation.registration)?
            != observation.registration
        {
            return Err(incompatible());
        }
        if check_original(observation.original, guard)? != observation.source_metadata {
            return Err(forbidden());
        }
        tx.commit()?;
        Ok(())
    }
}
