//! Native MCP execution over the same root stock authority and store.
use crate::{
    app::{Core, RequestPrincipal},
    transports::mcp as m,
};
use std::{
    future::ready,
    sync::{Arc, Mutex},
};

pub type Adapter<'a> = m::McpAdapter<m::NativePrincipalPort, m::NativeCatalog, StockService<'a>>;
pub(crate) type OwnedAdapter =
    m::McpAdapter<m::NativePrincipalPort, m::NativeCatalog, OwnedStockService>;

fn read_catalog(principal: &m::NativePrincipal) -> Result<m::NativeCatalog, m::PortError> {
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    m::NativeCatalog::with_admitted_operations(&schemas, principal, super::capabilities::reads())
}

/// Preserve the existing in-process binding and its original opaque authority.
pub async fn bind_read(
    core: &Core,
    original: crate::access::Principal,
) -> Result<(Adapter<'_>, m::Session<m::NativeContext>), m::PortError> {
    use m::PrincipalPort;
    let context = m::NativeContext::from_principal(original);
    let principal_port = m::NativePrincipalPort::new(core.access.clone());
    let principal = principal_port.resolve(&context).await?;
    let catalog = read_catalog(&principal)?;
    let adapter = m::McpAdapter::new(
        principal_port,
        catalog,
        StockService { core },
        m::AdapterConfig::default(),
    )
    .map_err(|_| m::PortError::Unavailable)?;
    let session = adapter.open(context);
    Ok((adapter, session))
}

/// Own the core handle for a persistent HTTP session. The original is a genuine
/// AT11 POST+CSRF Editor principal; the catalogue admits read/history only.
pub(crate) async fn bind_owned(
    core: Arc<Mutex<Core>>,
    original: crate::access::Principal,
) -> Result<(OwnedAdapter, m::Session<m::NativeContext>), m::PortError> {
    use m::PrincipalPort;
    let access = core
        .lock()
        .map_err(|_| m::PortError::Unavailable)?
        .access
        .clone();
    let context = m::NativeContext::from_principal(original);
    let principal_port = m::NativePrincipalPort::new(access);
    let principal = principal_port.resolve(&context).await?;
    let catalog = read_catalog(&principal)?;
    let adapter = m::McpAdapter::new(
        principal_port,
        catalog,
        OwnedStockService { core },
        m::AdapterConfig {
            max_session_requests: 256,
            max_session_id_bytes: 64 * 1024,
            ..m::AdapterConfig::default()
        },
    )
    .map_err(|_| m::PortError::Unavailable)?;
    // NativeContext is constructed exactly once. Both the catalogue's principal
    // and this Session retain that same Arc, including across later HTTP POSTs.
    let session = adapter.open(context);
    Ok((adapter, session))
}

/// One exact execution/error conversion for both borrowed and mounted services.
fn execute_output(
    core: &Core,
    principal: &m::NativePrincipal,
    operation: m::NativeOperation,
) -> Result<m::NativeOutput, m::PortError> {
    let p = RequestPrincipal::new(principal.original().clone());
    let request_id = operation.request.raw()["requestId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    super::stock_dispatch::execute(core, &p, operation.request.raw().clone())
        .map(|result| m::NativeOutput {
            request: operation.request,
            result,
        })
        .map_err(|error| {
            let body = super::errors::wire(error, &request_id);
            if crate::contracts::stock::StockValidation::new()
                .and_then(|c| c.validate("#/$defs/stockError", &body))
                .is_err()
            {
                return m::PortError::Unavailable;
            }
            m::PortError::ToolFailure(m::PublicToolFailure {
                code: "stock-operation-failed",
                message: "Stock operation could not complete",
                data: body.as_object().cloned(),
            })
        })
}

pub struct StockService<'a> {
    pub core: &'a Core,
}
impl m::ServicePort<m::NativePrincipal, m::NativeOperation> for StockService<'_> {
    type Output = m::NativeOutput;
    fn execute<'a>(
        &'a self,
        principal: &'a m::NativePrincipal,
        operation: m::NativeOperation,
    ) -> m::PortFuture<'a, Self::Output> {
        Box::pin(ready(execute_output(self.core, principal, operation)))
    }
}

pub(crate) struct OwnedStockService {
    core: Arc<Mutex<Core>>,
}
impl m::ServicePort<m::NativePrincipal, m::NativeOperation> for OwnedStockService {
    type Output = m::NativeOutput;
    fn execute<'a>(
        &'a self,
        principal: &'a m::NativePrincipal,
        operation: m::NativeOperation,
    ) -> m::PortFuture<'a, Self::Output> {
        // Finish synchronous native work and release Core before making a Send
        // ready future. No RefCell capture carrier survives across an await.
        let result = self
            .core
            .lock()
            .map_err(|_| m::PortError::Unavailable)
            .and_then(|core| execute_output(&core, principal, operation));
        Box::pin(ready(result))
    }
}
