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
    let admitted = context
        .core
        .try_lock()
        .ok()
        .map_or_else(super::capabilities::reads, |core| {
            super::capabilities::reads_for(&core)
        });
    bind_owned_admission(context, identity, admitted).await
}

/// Explicit Editor startup composition. The default transport continues to
/// bind read admission. A trusted application caller must select this variant;
/// metadata creates no approval, original principal or execution authority.
pub(crate) async fn bind_owned_editor_lifecycle(
    context: McpStockContext,
    identity: m::lifecycle::AuthenticatedIdentity,
) -> Result<OwnedLifecycle, m::PortError> {
    if identity.original().role() != crate::access::Role::Editor {
        return Err(m::PortError::Forbidden);
    }
    let admitted = {
        let core = context
            .core
            .try_lock()
            .map_err(|_| m::PortError::Unavailable)?;
        super::capabilities::admitted(&core, identity.original())
    };
    bind_owned_admission(context, identity, admitted).await
}

async fn bind_owned_admission(
    context: McpStockContext,
    identity: m::lifecycle::AuthenticatedIdentity,
    mut admitted: Vec<crate::contracts::stock::OperationId>,
) -> Result<OwnedLifecycle, m::PortError> {
    let schemas = m::NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    if !admitted.contains(&crate::contracts::stock::OperationId::AtlasAssetDownload) {
        admitted.push(crate::contracts::stock::OperationId::AtlasAssetDownload);
    }
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
    if context.native_homebox_reads.iter().any(|binding| {
        let partition = binding.source().partition();
        partition.workspace_id.as_str() == identity.original().scope().workspace_id.as_str()
            && partition.home_id.as_str() == identity.original().scope().home_id.as_str()
    }) {
        admitted.extend(
            super::super::providers::homebox_native::OPERATIONS
                .into_iter()
                .filter_map(|id| crate::contracts::stock::OperationId::parse(id.as_str())),
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
    native_homebox_reads:
        Arc<Vec<super::super::providers::homebox_native::NativeHomeBoxReadBinding>>,
}

impl McpStockContext {
    pub(crate) fn from_host(host: &super::super::Host) -> Self {
        Self {
            core: host.core.clone(),
            download_handles: host.atlas_download_handles.clone(),
            network_bindings: host.network_bindings.clone(),
            native_homebox_reads: host.native_homebox_reads.clone(),
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

pub(crate) fn stock_failure(error: st::StockError, request_id: &str) -> m::PortError {
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
        if st::OperationId::parse(operation.request.id().as_str())
            .is_some_and(|id| super::super::providers::homebox_native::OPERATIONS.contains(&id))
        {
            let original = principal.original().clone();
            let core = Arc::clone(&self.context.core);
            let bindings = Arc::clone(&self.context.native_homebox_reads);
            let handle = tokio::runtime::Handle::current();
            return Box::pin(async move {
                tokio::task::spawn_blocking(move || {
                    let p = RequestPrincipal::new(original);
                    let request_id = operation.request.raw()["requestId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    super::super::providers::homebox_native::execute_configured_with_bindings(
                        &core,
                        &bindings,
                        &p,
                        operation.request.raw().clone(),
                        &handle,
                    )
                    .map(|result| m::NativeOutput {
                        request: operation.request,
                        result,
                    })
                    .map_err(|error| stock_failure(error, &request_id))
                })
                .await
                .map_err(|_| m::PortError::Unavailable)?
            });
        }
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
