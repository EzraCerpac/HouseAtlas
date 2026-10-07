//! Concrete adapter for PR39's actual root read/history admission and service.
//! Root passes its OwnedStockService or borrowed StockService unchanged.
use super::super::{
    AdapterConfig, NativeOperation, NativeOutput, NativePrincipal, NativeSchemas, PortError,
    ServicePort,
};
use super::{AuthenticatedIdentity, NativeSession};

pub async fn bind<S>(
    identity: AuthenticatedIdentity,
    service: S,
) -> Result<NativeSession<S>, PortError>
where
    S: ServicePort<NativePrincipal, NativeOperation, Output = NativeOutput>,
{
    let schemas = NativeSchemas::from_bytes(
        include_bytes!("../../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../../packages/contracts/schemas/atlas.schema.json"),
    )?;
    NativeSession::new(
        identity,
        &schemas,
        crate::http::agents::capabilities::reads(),
        service,
        AdapterConfig {
            max_session_requests: 256,
            max_session_id_bytes: 64 * 1024,
            ..AdapterConfig::default()
        },
    )
    .await
}
