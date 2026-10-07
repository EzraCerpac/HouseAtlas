//! Saved-only stock queries through the original canonical Network disclosure.
use super::Host;
use crate::{
    access as a,
    app::{RequestPrincipal, ServerRuntime},
    config::providers::network_host::NetworkBinding,
    domain::stock as st,
    providers::network::{self as n, host_runtime::OriginalNetworkDisclosure},
    storage::Runtime,
};
use serde_json::Value;
use st::StockAuthorityPort;
use std::{cell::OnceCell, sync::Arc};

fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}

struct Graph {
    facet: n::NetworkFacet,
    original: Arc<OriginalNetworkDisclosure>,
}
struct Witness<'p> {
    principal: &'p RequestPrincipal,
    request: Value,
    graph: OnceCell<Graph>,
}
struct Authority<'h, 'p> {
    host: &'h Host,
    binding: &'h NetworkBinding,
    principal: &'p RequestPrincipal,
    now: String,
}
impl Authority<'_, '_> {
    fn original(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        let source = self.binding.runtime().settings().configured_source();
        let partition = source.partition();
        if !std::ptr::eq(p, self.principal)
            || request.is_mutation()
            || n::saved_network_query_support(request.id()).is_none()
            || request.operation().authority != st::Authority::Network
            || request.context().workspace_id != partition.workspace_id.as_str()
            || request.context().home_id != partition.home_id.as_str()
            || request.target()["sourceInstanceId"] != partition.source_instance_id.as_str()
            || request.target()["collectionId"] != partition.collection_id
            || p.principal.scope() != &partition.scope()
        {
            return Err(changed());
        }
        let core = self.host.core.lock().map_err(|_| unavailable())?;
        if !Arc::ptr_eq(&core.access, self.binding.access().shared().as_existing())
            || !core.homes.iter().any(|home| {
                home.scope.workspace_id == request.context().workspace_id
                    && home.scope.home_id == request.context().home_id
            })
        {
            return Err(changed());
        }
        let access = core.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        access
            .authorize_storage(&p.principal, &partition.scope(), a::Capability::Read)
            .map_err(|_| changed())?;
        Ok(())
    }
    fn witness(
        &self,
        p: &RequestPrincipal,
        witness: &Witness<'_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        if !std::ptr::eq(p, witness.principal) || witness.request != *request.raw() {
            return Err(changed());
        }
        self.original(p, request)
    }
    fn disclose_graph(&self, graph: &Graph) -> st::StockResult<n::NetworkFacet> {
        let current = self
            .binding
            .runtime()
            .disclose(&self.host.core, &graph.original, &self.now)
            .map_err(|_| changed())?;
        if current != graph.facet {
            return Err(changed());
        }
        Ok(current)
    }
}
impl<'p> st::StockAuthorityPort<RequestPrincipal> for Authority<'_, 'p> {
    type Witness = Witness<'p>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        self.original(p, request)?;
        // Capture every trusted configured member before sealing. Returned
        // clones below are the same original grants, never replacement issuance.
        let canonical = self.binding.access().shared().as_existing();
        let access = canonical.lock().map_err(|_| unavailable())?;
        p.capture_partition(
            &access,
            &self
                .binding
                .runtime()
                .settings()
                .configured_source()
                .partition(),
        )
        .map_err(|_| changed())?;
        for reference in self.binding.entities() {
            p.capture_source(&access, reference)
                .map_err(|_| changed())?;
        }
        p.release(&access).map_err(|_| changed())?;
        Ok(Witness {
            principal: self.principal,
            request: request.raw().clone(),
            graph: OnceCell::new(),
        })
    }
    fn authorize_graph(
        &self,
        p: &RequestPrincipal,
        witness: &Self::Witness,
        request: &st::ValidatedRequest,
        graph: &Graph,
    ) -> st::StockResult<()> {
        self.witness(p, witness, request)?;
        self.disclose_graph(graph)?;
        witness
            .graph
            .set(Graph {
                facet: graph.facet.clone(),
                original: graph.original.clone(),
            })
            .map_err(|_| changed())?;
        p.seal_source_capture();
        self.revalidate(p, witness, request)
    }
    fn revalidate(
        &self,
        p: &RequestPrincipal,
        witness: &Self::Witness,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.witness(p, witness, request)?;
        self.disclose_graph(witness.graph.get().ok_or_else(changed)?)?;
        self.witness(p, witness, request)
    }
    fn authorize_result(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        let expected = st::StockQueryPort::query(
            &mut n::SavedNetworkQueries::new(Reader(self), st::NativeStockContract::new()?),
            p,
            prepared,
        )?;
        if !expected.children.is_empty() || expected.wire != *result {
            return Err(changed());
        }
        self.revalidate(p, prepared.witness(), request)
    }
    fn disclose(
        &self,
        _: &RequestPrincipal,
        _: &st::PreparedRequest<Self::Witness, Graph>,
        _: &st::ValidatedRequest,
        _: &Value,
        _: &Value,
        _: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        // The frozen Network result has no target-bearing rows. Any future
        // target-bearing arm needs explicit original-owner proof before admission.
        Err(changed())
    }
}
struct Preparer<'a, 'h, 'p>(&'a Authority<'h, 'p>);
impl<'p> st::StockPreparerPort<RequestPrincipal, Witness<'p>> for Preparer<'_, '_, 'p> {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &RequestPrincipal,
        witness: &Witness<'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        self.0.witness(p, witness, request)?;
        let partition = p
            .captured_partition(
                &self
                    .0
                    .binding
                    .runtime()
                    .settings()
                    .configured_source()
                    .partition(),
            )
            .map_err(|_| changed())?;
        let entities = self
            .0
            .binding
            .entities()
            .iter()
            .map(|reference| p.captured_source(reference))
            .collect::<a::AccessResult<Vec<_>>>()
            .map_err(|_| changed())?;
        let (facet, original) = self
            .0
            .binding
            .runtime()
            .read(
                &self.0.host.core,
                self.0.binding.access().clone(),
                p.principal.principal().clone(),
                partition,
                entities,
                &self.0.now,
            )
            .map_err(|_| unavailable())?;
        Ok(Graph { facet, original })
    }
}
struct Reader<'a, 'h, 'p>(&'a Authority<'h, 'p>);
impl<'p> n::SavedNetworkReadPort<RequestPrincipal, Witness<'p>, Graph> for Reader<'_, '_, 'p> {
    fn disclose_retained_facet(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
    ) -> st::StockResult<n::NetworkFacet> {
        self.0
            .revalidate(p, prepared.witness(), prepared.request())?;
        let retained = prepared.witness().graph.get().ok_or_else(changed)?;
        if !Arc::ptr_eq(&retained.original, &prepared.graph().original)
            || retained.facet != prepared.graph().facet
        {
            return Err(changed());
        }
        self.0.disclose_graph(prepared.graph())
    }
}
struct CommandsUnavailable;
impl<W, G> st::StockCommandPort<RequestPrincipal, W, G> for CommandsUnavailable {
    fn execute(
        &mut self,
        _: &RequestPrincipal,
        _: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(unavailable())
    }
}

pub(super) fn execute(
    host: &Host,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    let request = st::ValidatedRequest::parse(contracts, raw.clone())?;
    let binding = host
        .network_bindings
        .iter()
        .find(|binding| {
            let partition = binding.runtime().settings().configured_source().partition();
            request.context().workspace_id == partition.workspace_id.as_str()
                && request.context().home_id == partition.home_id.as_str()
                && request.target()["sourceInstanceId"] == partition.source_instance_id.as_str()
                && request.target()["collectionId"] == partition.collection_id
        })
        .ok_or_else(unavailable)?;
    let authority = Authority {
        host,
        binding,
        principal: p,
        now: ServerRuntime.now().map_err(|_| unavailable())?,
    };
    let prepared = st::prepare(p, raw, contracts, &authority, &mut Preparer(&authority))?;
    let result = st::dispatch_prepared(
        p,
        &prepared,
        contracts,
        &authority,
        &mut n::SavedNetworkQueries::new(Reader(&authority), st::NativeStockContract::new()?),
        &mut CommandsUnavailable,
    )?;
    authority.revalidate(p, prepared.witness(), prepared.request())?;
    Ok(result)
}
