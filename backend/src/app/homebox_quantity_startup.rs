//! Same-owner startup and borrow-bound original Store phase for quantity source.
//! No artifact/provider I/O or automatic source activation occurs here.
use super::{Core, Store, stock_activity_principal::OriginalStockActivityPrincipal};
use crate::{
    access,
    config::providers::{
        homebox::TrustedHomeBoxSource,
        quantity_installation::{
            OriginalQuantityConfigured, QuantityConfigurationError, QuantityInstallationInput,
        },
        registry::ConfiguredSource,
    },
    providers::homebox::read::NativeReadCredentialConfig,
    storage,
};
use std::sync::Arc;

impl Core {
    pub fn quantity_installation_configuration(
        &self,
        source: Arc<ConfiguredSource>,
        homebox: Arc<TrustedHomeBoxSource>,
        credentials: Arc<NativeReadCredentialConfig>,
        input: QuantityInstallationInput,
    ) -> Result<Arc<OriginalQuantityConfigured>, QuantityConfigurationError> {
        OriginalQuantityConfigured::from_trusted_startup(self, source, homebox, credentials, input)
    }
}

/// Retains the actual configured Store borrow for this synchronous phase. It
/// cannot be reconstructed from a detached observation or carried across GET.
pub struct OriginalQuantityPhysical<'store, 'p> {
    configured: &'store Arc<OriginalQuantityConfigured>,
    phase: QuantityPhysicalPhase<'store, 'p>,
}
enum QuantityPhysicalPhase<'store, 'p> {
    Store {
        observation:
            Box<storage::QuantityInstallationObservation<'p, OriginalStockActivityPrincipal>>,
        _store: &'store mut Store,
    },
    Transaction(
        &'store storage::QuantityInstallationTransaction<
            'store,
            'p,
            OriginalStockActivityPrincipal,
        >,
    ),
}
impl<'store, 'p> OriginalQuantityPhysical<'store, 'p> {
    pub fn configured(&self) -> &Arc<OriginalQuantityConfigured> {
        self.configured
    }
    pub fn observation(
        &self,
    ) -> &storage::QuantityInstallationObservation<'p, OriginalStockActivityPrincipal> {
        match &self.phase {
            QuantityPhysicalPhase::Store { observation, .. } => observation,
            QuantityPhysicalPhase::Transaction(transaction) => transaction.observation(),
        }
    }

    /// Bind only the native Store-issued current transaction carrier. No
    /// detached physical DATA or connection handle can enter this phase.
    pub(super) fn from_activity_transaction(
        configured: &'store Arc<OriginalQuantityConfigured>,
        transaction: &'store storage::QuantityInstallationTransaction<
            'store,
            'p,
            OriginalStockActivityPrincipal,
        >,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<Self> {
        use storage::StockActivityPrincipal as _;
        let observation = transaction.observation();
        let original = observation.original();
        if !configured.store_identity().matches_observation(observation)
            || !std::ptr::eq(guard.principal(), original.original_activity_principal())
            || observation.source_metadata() != configured.metadata()
            || observation.queue_config() != configured.queue()
            || observation.registration().physical_binding != configured.physical().physical_binding
            || observation.registration().owner_id != configured.physical().owner_id
            || observation.registration().dispatcher_epoch != configured.physical().dispatcher_epoch
            || observation.source_reference() != original.original_activity_source().reference()
            || observation.source_partition() != original.original_activity_partition().partition()
        {
            return Err(storage::Error::new(
                "identity-conflict",
                "Current quantity transaction unavailable",
            ));
        }
        let unavailable = |_| {
            storage::Error::new(
                "identity-conflict",
                "Current quantity authority unavailable",
            )
        };
        guard.assert_mutation().map_err(unavailable)?;
        guard
            .revalidate_source(original.original_activity_source())
            .map_err(unavailable)?;
        guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(unavailable)?;
        if guard
            .persisted_source_metadata(original.original_activity_partition())
            .map_err(unavailable)?
            != *configured.metadata()
        {
            return Err(storage::Error::new(
                "identity-conflict",
                "Current quantity source unavailable",
            ));
        }
        Ok(Self {
            configured,
            phase: QuantityPhysicalPhase::Transaction(transaction),
        })
    }
}
impl OriginalQuantityConfigured {
    /// The host already holds its actual Store lock and original mutation guard.
    /// No shared lock is acquired inside this method or the source qualifier.
    pub fn observe_original<'store, 'p>(
        self: &'store Arc<Self>,
        store: &'store mut Store,
        original: &'p OriginalStockActivityPrincipal,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<OriginalQuantityPhysical<'store, 'p>> {
        if !Arc::ptr_eq(&store.configured_authorization().0, self.access()) {
            return Err(storage::Error::new(
                "identity-conflict",
                "Original quantity Store is unavailable",
            ));
        }
        let observation = store.observe_quantity_installation_with_authorization(
            original,
            guard,
            self.queue(),
            self.physical(),
        )?;
        if !self.store_identity().matches_observation(&observation)
            || observation.source_metadata() != self.metadata()
        {
            return Err(storage::Error::new(
                "identity-conflict",
                "Original quantity installation is unavailable",
            ));
        }
        Ok(OriginalQuantityPhysical {
            configured: self,
            phase: QuantityPhysicalPhase::Store {
                observation: Box::new(observation),
                _store: store,
            },
        })
    }
}
