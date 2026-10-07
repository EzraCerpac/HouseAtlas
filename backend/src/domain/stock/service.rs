use super::{
    OwnerResult, StockAuthorityPort, StockCommandPort, StockContractPort, StockPreparerPort,
    StockQueryPort, StockResult, ValidatedRequest, validate_result,
};
use serde_json::Value;

#[derive(Debug)]
pub struct PreparedRequest<W, G> {
    request: ValidatedRequest,
    witness: W,
    graph: G,
}

impl<W, G> PreparedRequest<W, G> {
    pub fn request(&self) -> &ValidatedRequest {
        &self.request
    }
    pub fn witness(&self) -> &W {
        &self.witness
    }
    pub fn graph(&self) -> &G {
        &self.graph
    }
}

pub fn prepare<P, C, A, R>(
    principal: &P,
    raw: Value,
    contracts: &C,
    authority: &A,
    preparer: &mut R,
) -> StockResult<PreparedRequest<A::Witness, A::Graph>>
where
    C: StockContractPort,
    A: StockAuthorityPort<P>,
    R: StockPreparerPort<P, A::Witness, Graph = A::Graph>,
{
    let request = ValidatedRequest::parse(contracts, raw)?;
    let witness = authority.capture(principal, &request)?;
    let graph = preparer.resolve(principal, &witness, &request)?;
    authority.authorize_graph(principal, &witness, &request, &graph)?;
    authority.revalidate(principal, &witness, &request)?;
    Ok(PreparedRequest {
        request,
        witness,
        graph,
    })
}

/// One dispatch boundary for human UI, MCP, WebMCP, in-app AI and jobs.
/// Concrete production owner composition remains external to this module.
pub fn dispatch<P, C, A, Q, M>(
    principal: &P,
    prepared: PreparedRequest<A::Witness, A::Graph>,
    contracts: &C,
    authority: &A,
    queries: &mut Q,
    commands: &mut M,
) -> StockResult<OwnerResult>
where
    C: StockContractPort,
    A: StockAuthorityPort<P>,
    Q: StockQueryPort<P, A::Witness, A::Graph>,
    M: StockCommandPort<P, A::Witness, A::Graph>,
{
    dispatch_prepared(
        principal, &prepared, contracts, authority, queries, commands,
    )
}

/// Borrow the same prepared value retained by a scoped native authorizer.
/// This preserves its original witness/graph without cloning or rebasing them;
/// result disclosure and final captured-authority checks are identical to the
/// consuming dispatch boundary.
pub fn dispatch_prepared<P, C, A, Q, M>(
    principal: &P,
    prepared: &PreparedRequest<A::Witness, A::Graph>,
    contracts: &C,
    authority: &A,
    queries: &mut Q,
    commands: &mut M,
) -> StockResult<OwnerResult>
where
    C: StockContractPort,
    A: StockAuthorityPort<P>,
    Q: StockQueryPort<P, A::Witness, A::Graph>,
    M: StockCommandPort<P, A::Witness, A::Graph>,
{
    authority.revalidate(principal, prepared.witness(), prepared.request())?;
    let result = if prepared.request().is_mutation() {
        commands.execute(principal, prepared)?
    } else {
        queries.query(principal, prepared)?
    };
    validate_result(principal, prepared, &result, contracts, authority)?;
    authority.revalidate(principal, prepared.witness(), prepared.request())?;
    Ok(result)
}
