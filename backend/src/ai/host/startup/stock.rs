//! Owned bridge to the existing native stock executor, with no alternate domain.
use super::authority::StartupAuthority;
use crate::{
    ai::{
        AiError,
        host::native::{NativePreparedRead, NativeReadStock},
    },
    app::Core,
    transports::mcp as m,
};
use std::{
    future::ready,
    sync::{Arc, Mutex},
};

pub struct NativeStockConsumer {
    core: Arc<Mutex<Core>>,
}
impl m::ServicePort<m::NativePrincipal, m::NativeOperation> for NativeStockConsumer {
    type Output = m::NativeOutput;
    fn execute<'a>(
        &'a self,
        principal: &'a m::NativePrincipal,
        operation: m::NativeOperation,
    ) -> m::PortFuture<'a, Self::Output> {
        // The actual synchronous stock owner completes while Core is retained;
        // no Core guard or borrowed RequestPrincipal escapes into the future.
        let result = self
            .core
            .lock()
            .map_err(|_| m::PortError::Unavailable)
            .and_then(|core| {
                let p = crate::app::RequestPrincipal::new(principal.original().clone());
                let request = operation.request;
                let request_id = request.raw()["requestId"].as_str().unwrap_or_default();
                let result =
                    crate::http::agents::stock_dispatch::execute(&core, &p, request.raw().clone())
                        .map_err(|error| {
                            crate::http::agents::mcp::stock_failure(error, request_id)
                        })?;
                Ok(m::NativeOutput { request, result })
            });
        Box::pin(ready(result))
    }
}
pub type NativeReadDomain = NativeReadStock<NativeStockConsumer, StartupAuthority>;
pub type NativeReadCatalog = crate::ai::stock::StockCatalog<NativeReadDomain>;
pub type NativeReadPrepared = crate::ai::stock::AcceptedStockCommand<NativePreparedRead>;

pub fn native_read_catalog(
    host: &crate::http::Host,
    authority: StartupAuthority,
) -> Result<NativeReadCatalog, AiError> {
    let admitted = {
        let core = host.core.lock().map_err(|_| AiError::DomainUnavailable)?;
        crate::http::agents::capabilities::reads_for(&core)
            .into_iter()
            .filter(|id| {
                crate::contracts::stock::operation(*id).is_ok_and(|op| {
                    op.effect == crate::contracts::stock::Effect::Read
                        && op.authority == crate::contracts::stock::Authority::Atlas
                })
            })
            .collect::<Vec<_>>()
    };
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../../packages/contracts/schemas/atlas.schema.json"),
    )
    .map_err(|_| AiError::InvalidCatalog)?;
    Ok(crate::ai::stock::StockCatalog::new(NativeReadStock::new(
        NativeStockConsumer {
            core: Arc::clone(&host.core),
        },
        authority.clone(),
        m::NativePrincipalPort::new(Arc::clone(&authority.access)),
        schemas,
        admitted,
    )?))
}
