//! One native executor shared by HTTP and the embeddable MCP service.
use crate::{
    app::{Core, RequestPrincipal},
    domain::stock as st,
};
use serde_json::Value;

pub fn execute(
    core: &Core,
    principal: &RequestPrincipal,
    raw: Value,
) -> st::StockResult<st::OwnerResult> {
    execute_qualified(core, principal, raw, None, false).map(|result| result.owner)
}

pub(super) fn execute_with_downloads(
    core: &Core,
    principal: &RequestPrincipal,
    raw: Value,
    handles: &st::AtlasDownloadHandles,
) -> st::StockResult<st::OwnerResult> {
    execute_qualified(core, principal, raw, Some(handles), false).map(|result| result.owner)
}

pub(super) fn execute_http_with_downloads(
    core: &Core,
    principal: &RequestPrincipal,
    raw: Value,
    handles: &st::AtlasDownloadHandles,
) -> st::StockResult<super::super::stock_reads::QualifiedResult> {
    execute_qualified(core, principal, raw, Some(handles), true)
}

fn execute_qualified(
    core: &Core,
    principal: &RequestPrincipal,
    raw: Value,
    handles: Option<&st::AtlasDownloadHandles>,
    http_snapshot: bool,
) -> st::StockResult<super::super::stock_reads::QualifiedResult> {
    let contracts = st::NativeStockContract::new()?;
    let request = st::ValidatedRequest::parse(&contracts, raw.clone())?;
    let scope = principal.principal.scope();
    if request.context().workspace_id != scope.workspace_id.as_str()
        || request.context().home_id != scope.home_id.as_str()
        || !core.homes.iter().any(|home| {
            home.scope.workspace_id == request.context().workspace_id
                && home.scope.home_id == request.context().home_id
        })
    {
        return Err(st::StockError::AuthorityChanged);
    }
    if request.is_mutation() {
        super::super::stock_mutations::execute_raw(core, principal, raw, &contracts).map(Into::into)
    } else if super::super::providers::homebox_stock::CACHED_READ_OPERATIONS.contains(&request.id())
        || super::super::providers::homebox_stock::HISTORY_READ_OPERATIONS.contains(&request.id())
    {
        super::super::providers::homebox_stock::execute(core, principal, raw).map(Into::into)
    } else {
        super::super::stock_reads::execute_raw_with_snapshot(
            core,
            principal,
            raw,
            &contracts,
            handles,
            http_snapshot,
        )
    }
}
