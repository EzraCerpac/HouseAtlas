//! Native MCP execution over the same root stock authority and store.
use crate::{
    app::{Core, RequestPrincipal},
    config::providers::network_host::NetworkBinding,
    domain::stock as st,
    transports::mcp as m,
};
use std::{
    future::ready,
    sync::{Arc, Mutex},
};

pub type Adapter<'a> = m::McpAdapter<m::NativePrincipalPort, m::NativeCatalog, StockService<'a>>;
pub(crate) type OwnedLifecycle = m::lifecycle::NativeSession<OwnedStockService>;

fn read_catalog(
    core: &Core,
    principal: &m::NativePrincipal,
) -> Result<m::NativeCatalog, m::PortError> {
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    m::NativeCatalog::with_admitted_operations(
        &schemas,
        principal,
        super::capabilities::reads_for(core),
    )
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
    let catalog = read_catalog(core, &principal)?;
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

/// Bind the lifecycle successor to the actual owned root stock service.
pub(crate) async fn bind_owned_lifecycle(
    context: McpStockContext,
    identity: m::lifecycle::AuthenticatedIdentity,
) -> Result<OwnedLifecycle, m::PortError> {
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    let mut admitted = context
        .core
        .try_lock()
        .ok()
        .map_or_else(super::capabilities::reads, |core| {
            super::capabilities::reads_for(&core)
        });
    admitted.push(crate::contracts::stock::OperationId::AtlasAssetDownload);
    if context.network_bindings.iter().any(|binding| {
        binding
            .runtime()
            .settings()
            .configured_source()
            .partition()
            .scope()
            == *identity.original().scope()
    }) {
        admitted.extend(
            crate::providers::network::SAVED_NETWORK_QUERY_SUPPORT
                .iter()
                .map(|support| support.agent_operation),
        );
    }
    m::lifecycle::NativeSession::new(
        identity,
        &schemas,
        admitted,
        OwnedStockService { context },
        m::AdapterConfig {
            max_session_requests: 256,
            max_session_id_bytes: 64 * 1024,
            ..m::AdapterConfig::default()
        },
    )
    .await
}

/// Owned root components only; retaining Host here would cycle through its
/// session registry. The handle manager is the same one used by HTTP redemption.
pub(crate) struct McpStockContext {
    pub(crate) core: Arc<Mutex<Core>>,
    pub(crate) download_handles: st::AtlasDownloadHandles,
    pub(crate) network_bindings: Arc<Vec<NetworkBinding>>,
}

impl McpStockContext {
    pub(crate) fn from_host(host: &super::super::Host) -> Self {
        Self {
            core: host.core.clone(),
            download_handles: host.atlas_download_handles.clone(),
            network_bindings: host.network_bindings.clone(),
        }
    }
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
        .map_err(|error| stock_failure(error, &request_id))
}

fn stock_failure(error: st::StockError, request_id: &str) -> m::PortError {
    let body = super::errors::wire(error, request_id);
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
    context: McpStockContext,
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
        let request_id = operation.request.raw()["requestId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let p = RequestPrincipal::new(principal.original().clone());
        let raw = operation.request.raw().clone();
        let result = if st::OperationId::parse(operation.request.id().as_str())
            .and_then(crate::providers::network::saved_network_query_support)
            .is_some()
        {
            st::NativeStockContract::new().and_then(|contracts| {
                super::super::stock_network_reads::execute_with_bindings(
                    &self.context.core,
                    &self.context.network_bindings,
                    &p,
                    raw,
                    &contracts,
                )
            })
        } else {
            self.context
                .core
                .lock()
                .map_err(|_| st::StockError::OwnerUnavailable)
                .and_then(|core| {
                    super::stock_dispatch::execute_with_downloads(
                        &core,
                        &p,
                        raw,
                        &self.context.download_handles,
                    )
                })
        };
        let result = result
            .map(|result| m::NativeOutput {
                request: operation.request,
                result,
            })
            .map_err(|error| stock_failure(error, &request_id));
        Box::pin(ready(result))
    }
}
