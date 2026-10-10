//! Explicit in-process local Atlas composition over the existing root owners.

use crate::{
    access::{AccessError, RequestEvidence, Scope},
    app::Core,
    contracts::stock as wire,
    http::agents::{capabilities, mcp::StockService},
};

use super::{
    AdapterConfig, NativeSchemas, PortError,
    lifecycle::{AuthenticatedIdentity, NativeSession},
};

/// The real borrowed stock service is the only command/result consumer here.
pub type LocalAtlasSession<'a> = NativeSession<StockService<'a>>;

/// Keep actual Access issuance errors distinct from protocol composition errors.
#[derive(Debug)]
pub enum LocalAtlasBindError {
    Authentication(AccessError),
    Protocol(PortError),
}

/// Bind only the existing local Atlas capabilities of an actual POST issuance.
/// The host supplies observed evidence, never a principal reconstructed from a
/// DTO. Access checks the current session, Origin, CSRF, scope and Editor role.
/// Each subsequent frame still needs an AuthenticatedIdentity issued from this
/// same Core boundary, passed to NativeSession::handle by the host.
///
/// This selects no remote endpoint or startup profile. Native stock owns exact
/// requests, approval policy, transaction authorization and released outcomes.
pub async fn bind_local_atlas<'a>(
    core: &'a Core,
    observed: &RequestEvidence<'_>,
    scope: &Scope,
) -> Result<LocalAtlasSession<'a>, LocalAtlasBindError> {
    let identity = AuthenticatedIdentity::authenticate_post(core.access.clone(), observed, scope)
        .map_err(LocalAtlasBindError::Authentication)?;
    let schemas = NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )
    .map_err(LocalAtlasBindError::Protocol)?;
    // Reuse the actual host's closed native capability map; schema family
    // membership alone admits nothing. Core-only composition has no download
    // handle issuer/redemption owner or staged-media/provider command binding.
    let admitted = capabilities::admitted(core, identity.original())
        .into_iter()
        .filter(|id| {
            *id != wire::OperationId::AtlasAssetDownload
                && wire::operation(*id)
                    .is_ok_and(|operation| operation.authority == wire::Authority::Atlas)
        });
    NativeSession::new(
        identity,
        &schemas,
        admitted,
        StockService { core },
        AdapterConfig::default(),
    )
    .await
    .map_err(LocalAtlasBindError::Protocol)
}
