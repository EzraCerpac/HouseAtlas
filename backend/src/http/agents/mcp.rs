//! Native MCP execution over the same root stock authority and store.
//! The host supplies an already issued context; no listener or auth issuance.
use crate::{
    app::{Core, RequestPrincipal},
    transports::mcp as m,
};
use std::future::ready;

pub type Adapter<'a> = m::McpAdapter<m::NativePrincipalPort, m::NativeCatalog, StockService<'a>>;

/// Bind an already issued read principal to a scoped native MCP session.
/// Caller keeps the bounded blocking/admission scope alive through handling.
pub async fn bind_read(
    core: &Core,
    original: crate::access::Principal,
) -> Result<(Adapter<'_>, m::Session<m::NativeContext>), m::PortError> {
    use m::PrincipalPort;
    let context = m::NativeContext::from_principal(original);
    let principal_port = m::NativePrincipalPort::new(core.access.clone());
    let principal = principal_port.resolve(&context).await?;
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    let catalog = m::NativeCatalog::with_admitted_operations(
        &schemas,
        &principal,
        super::capabilities::reads(),
    )?;
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
        // One request-local capture carrier retains the actual opaque issuance
        // provenance. It reaches every witness and transaction callback unchanged.
        let p = RequestPrincipal::new(principal.original().clone());
        let request_id = operation.request.raw()["requestId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let result = super::stock_dispatch::execute(self.core, &p, operation.request.raw().clone())
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
            });
        Box::pin(ready(result))
    }
}
