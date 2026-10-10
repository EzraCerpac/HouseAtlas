use super::*;
use crate::{access, jobs::QueueConfig};
use std::sync::Arc;

/// Facts observed on this Store under the original access guard. Possessing an
/// observation does not authorize a later mutation or native dispatch.
pub struct QuantityInstallationObservation<'p, P: StockActivityPrincipal> {
    pub(super) instance: Arc<()>,
    pub(super) original: &'p P,
    pub(super) queue_config: QueueConfig,
    pub(super) registration: StockActivityPhysicalRegistration,
    pub(super) source_reference: access::SourceRef,
    pub(super) source_partition: access::SourcePartition,
    pub(super) source_metadata: access::SourceAuthorityMetadata,
}

impl<'p, P: StockActivityPrincipal> QuantityInstallationObservation<'p, P> {
    pub fn original(&self) -> &'p P {
        self.original
    }

    pub fn queue_config(&self) -> &QueueConfig {
        &self.queue_config
    }

    pub fn registration(&self) -> &StockActivityPhysicalRegistration {
        &self.registration
    }

    pub fn source_reference(&self) -> &access::SourceRef {
        &self.source_reference
    }

    pub fn source_partition(&self) -> &access::SourcePartition {
        &self.source_partition
    }

    pub fn source_metadata(&self) -> &access::SourceAuthorityMetadata {
        &self.source_metadata
    }
}

/// An opaque Store instance pin. Equality alone confers no access authority.
#[derive(Clone)]
pub struct QuantityInstallationStoreIdentity(pub(super) Arc<()>);

impl QuantityInstallationStoreIdentity {
    pub fn matches_observation<P: StockActivityPrincipal>(
        &self,
        observation: &QuantityInstallationObservation<'_, P>,
    ) -> bool {
        Arc::ptr_eq(&self.0, &observation.instance)
    }
}

/// A quantity observation tied to the caller's already active Store transaction.
/// The connection is deliberately private: consumers can only inspect the facts
/// validated by the quantity installation validator.
pub struct QuantityInstallationTransaction<'tx, 'p, P: StockActivityPrincipal> {
    pub(super) observation: QuantityInstallationObservation<'p, P>,
    pub(super) _connection: &'tx rusqlite::Connection,
}

impl<'tx, 'p, P: StockActivityPrincipal> QuantityInstallationTransaction<'tx, 'p, P> {
    pub fn observation(&self) -> &QuantityInstallationObservation<'p, P> {
        &self.observation
    }
}
