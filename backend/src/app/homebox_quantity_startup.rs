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
    observation: storage::QuantityInstallationObservation<'p, OriginalStockActivityPrincipal>,
    _store: &'store mut Store,
}
impl<'store, 'p> OriginalQuantityPhysical<'store, 'p> {
    pub fn configured(&self) -> &Arc<OriginalQuantityConfigured> {
        self.configured
    }
    pub fn observation(
        &self,
    ) -> &storage::QuantityInstallationObservation<'p, OriginalStockActivityPrincipal> {
        &self.observation
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
            observation,
            _store: store,
        })
    }
}
