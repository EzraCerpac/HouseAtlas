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
        super::super::stock_mutations::execute_raw(core, principal, raw, &contracts)
    } else {
        super::super::stock_reads::execute_raw(core, principal, raw, &contracts)
    }
}
