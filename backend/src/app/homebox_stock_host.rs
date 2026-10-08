//! Trusted startup composition using the application's existing Store owner.
//! This neither opens profile6 nor supplies authority, credential or I/O peers.
use super::{Core, ReadAuthority, ServerRuntime};
use crate::{
    config::provider_dispatch::TrustedDispatcherConfig,
    http::contracts::NativeContracts,
    lifecycle::provider_dispatch::{
        archive::PrivateStockArchive,
        durable_stock::{DurableStockHost, HostError},
    },
    media::native::NativeMediaRuntime,
    providers::homebox::write::stock::StockPortFault,
};
use std::sync::Arc;

pub type NativeHomeBoxStockHost =
    DurableStockHost<NativeContracts, ReadAuthority, NativeMediaRuntime<ServerRuntime>>;

impl Core {
    /// Bind the actual canonical Store and Access allocations. The durable
    /// host requires an already-open opt-in profile6 and independently supplied
    /// trusted queue/archive configuration. Construction performs no provider
    /// request, grants no capability and starts no background dispatcher.
    /// Stop and drop every bound owner before consuming Core for close/recovery.
    pub fn durable_homebox_stock_host(
        &self,
        queue: TrustedDispatcherConfig,
        archive: Arc<PrivateStockArchive>,
    ) -> Result<NativeHomeBoxStockHost, HostError> {
        {
            let store = self
                .store
                .try_lock()
                .map_err(|_| HostError::Activity(StockPortFault::Unavailable))?;
            if !Arc::ptr_eq(&store.configured_authorization().0, &self.access) {
                return Err(HostError::Activity(StockPortFault::EvidenceConflict));
            }
        }
        DurableStockHost::new(
            Arc::clone(&self.store),
            Arc::clone(&self.access),
            queue,
            archive,
        )
    }
}
