//! Saved entity/location stock reads over the original Access and SQLite owners.
//! No GET client, refresh, credential, artifact broker or write queue is created.
use crate::{
    access as a,
    app::{Core, ReadAuthority, RequestPrincipal},
    domain::stock as st,
    providers::homebox::read::{self as r, query as q},
    storage as s,
};
use serde_json::Value;
use st::{StockAuthorityPort, StockQueryPort};
use std::{cell::OnceCell, sync::Arc};

/// These four forms have genuine retained observations. The typed query donor's
/// other selections require their real producer/artifact/history owners.
pub const CACHED_READ_OPERATIONS: [st::OperationId; 4] = [
    st::OperationId::HomeboxEntityGet,
    st::OperationId::HomeboxEntityList,
    st::OperationId::HomeboxLocationGet,
    st::OperationId::HomeboxLocationList,
];
// An explicit conservative display-age bound, not a provider qualification.
const STALE_AFTER_MS: u64 = 300_000;

fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
struct Graph(s::RegisteredCacheRead);
struct Witness<'p> {
    principal: &'p RequestPrincipal,
    request: Value,
    graph: OnceCell<s::RegisteredCacheRead>,
}
struct Authority<'a> {
    core: &'a Core,
    principal: &'a RequestPrincipal,
    now: r::Timestamp,
}
fn partition(request: &st::ValidatedRequest) -> st::StockResult<s::SourcePartition> {
    let scope = q::HomeBoxReadQuery::from_request(request)?;
    serde_json::from_value(serde_json::to_value(scope.scope()).map_err(|_| changed())?)
        .map_err(|_| changed())
}
impl Authority<'_> {
    fn original(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        if !std::ptr::eq(p, self.principal)
            || request.is_mutation()
            || !CACHED_READ_OPERATIONS.contains(&request.id())
            || request.operation().authority != st::Authority::Homebox
            || request.context().workspace_id != p.principal.scope().workspace_id.as_str()
            || request.context().home_id != p.principal.scope().home_id.as_str()
            || !self.core.homes.iter().any(|home| {
                home.scope.workspace_id == request.context().workspace_id
                    && home.scope.home_id == request.context().home_id
            })
        {
            return Err(changed());
        }
        let access = self.core.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        access
            .authorize_storage(&p.principal, p.principal.scope(), a::Capability::Read)
            .map_err(|_| changed())?;
        Ok(())
    }
    fn witness(
        &self,
        p: &RequestPrincipal,
        w: &Witness<'_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        if !std::ptr::eq(p, w.principal) || w.request != *request.raw() {
            return Err(changed());
        }
        self.original(p, request)
    }
    fn read(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<s::RegisteredCacheRead> {
        self.original(p, request)?;
        let partition = partition(request)?;
        let mut store = self.core.store.lock().map_err(|_| unavailable())?;
        let read = store
            .read_cache_partition_with_authorization(
                &ReadAuthority(Arc::clone(&self.core.access)),
                p,
                &partition.scope(),
                &partition,
            )
            .map_err(|e| st::StockError::Domain(crate::app::storage_error(e)))?;
        if read.registration.owner != s::SourceOwner::Homebox
            || read.registration.partition() != partition
            || (read.registration.partition_mode == s::PartitionMode::ReviewedEntityAllowlist
                && read.state.homebox_entities.iter().any(|row| {
                    !read
                        .registration
                        .allowed_external_ids
                        .iter()
                        .any(|id| row["source"]["externalId"] == *id)
                }))
        {
            return Err(changed());
        }
        Ok(read)
    }
    fn result(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'_>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        let contracts = st::NativeStockContract::new()?;
        q::HomeBoxQueries::new(&contracts, &mut Reader(self), &mut HistoryUnavailable)
            .query(p, prepared)
    }
}
impl<'a> StockAuthorityPort<RequestPrincipal> for Authority<'a> {
    type Witness = Witness<'a>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        self.original(p, request)?;
        Ok(Witness {
            principal: self.principal,
            request: request.raw().clone(),
            graph: OnceCell::new(),
        })
    }
    fn authorize_graph(
        &self,
        p: &RequestPrincipal,
        w: &Self::Witness,
        request: &st::ValidatedRequest,
        graph: &Graph,
    ) -> st::StockResult<()> {
        self.witness(p, w, request)?;
        // The issuing store already checked the original partition grant. Capture
        // every original entity/parent reference before sealing; never renew it.
        let query = q::HomeBoxReadQuery::from_request(request)?;
        let previous = r::PreviousGeneration::from_retained(graph.0.state.clone(), query.scope())
            .map_err(|_| unavailable())?;
        let source_instance_id = a::CanonicalId::parse(query.scope().source_instance_id.as_str())
            .map_err(|_| changed())?;
        let access = self.core.access.lock().map_err(|_| unavailable())?;
        for row in previous.entities() {
            let reference = |id: &r::Uuid| a::SourceRef {
                workspace_id: p.principal.scope().workspace_id.clone(),
                home_id: p.principal.scope().home_id.clone(),
                key: a::SourceKey {
                    source_instance_id: source_instance_id.clone(),
                    collection_id: query.scope().collection_id.clone(),
                    source_kind: a::SourceKind::HomeboxEntity,
                    external_id: id.as_str().into(),
                },
            };
            p.capture_source(&access, &reference(&row.entity.id))
                .map_err(|_| changed())?;
            if let Some(parent) = &row.entity.parent {
                p.capture_source(&access, &reference(&parent.id))
                    .map_err(|_| changed())?;
            }
        }
        p.release(&access).map_err(|_| changed())?;
        w.graph.set(graph.0.clone()).map_err(|_| changed())?;
        p.seal_source_capture();
        drop(access);
        self.revalidate(p, w, request)
    }
    fn revalidate(
        &self,
        p: &RequestPrincipal,
        w: &Self::Witness,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.witness(p, w, request)?;
        if w.graph.get() != Some(&self.read(p, request)?) {
            return Err(changed());
        }
        self.witness(p, w, request)
    }
    fn authorize_result(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        let expected = self.result(p, prepared)?;
        if !expected.children.is_empty() || expected.wire != *result {
            return Err(changed());
        }
        self.revalidate(p, prepared.witness(), request)
    }
    fn disclose(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        let expected_purpose = if target == request.target() {
            st::DisclosurePurpose::ExactTarget
        } else {
            st::DisclosurePurpose::ScopedPage
        };
        let expected = self.result(p, prepared)?;
        if purpose != expected_purpose
            || !expected.wire["data"]["resources"]
                .as_array()
                .is_some_and(|rows| {
                    rows.iter()
                        .any(|candidate| candidate == row && candidate["target"] == *target)
                })
        {
            return Err(changed());
        }
        self.revalidate(p, prepared.witness(), request)
    }
}
struct Preparer<'a>(&'a Authority<'a>);
impl<'p> st::StockPreparerPort<RequestPrincipal, Witness<'p>> for Preparer<'_> {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &RequestPrincipal,
        w: &Witness<'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        self.0.witness(p, w, request)?;
        self.0.read(p, request).map(Graph)
    }
}
struct Reader<'a>(&'a Authority<'a>);
impl<'p> q::HomeBoxReadOwner<RequestPrincipal, Witness<'p>, Graph> for Reader<'_> {
    fn read(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
        query: &q::HomeBoxReadQuery,
    ) -> st::StockResult<q::HomeBoxReadResult> {
        self.0.witness(p, prepared.witness(), prepared.request())?;
        let previous =
            r::PreviousGeneration::from_retained(prepared.graph().0.state.clone(), query.scope())
                .map_err(|_| unavailable())?;
        q::cached_entity_page(query, &previous, &self.0.now, STALE_AFTER_MS)
            .map(q::HomeBoxReadResult::Resources)
    }
}
struct HistoryUnavailable;
impl st::StockHistoryPort<RequestPrincipal> for HistoryUnavailable {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &RequestPrincipal,
        _: &C,
        _: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        Err(unavailable())
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

/// Shared HTTP/MCP stock dispatcher arm. The exact original envelope and
/// principal survive prepare, query, output recomputation and final release.
pub fn execute(core: &Core, p: &RequestPrincipal, raw: Value) -> st::StockResult<st::OwnerResult> {
    let contracts = st::NativeStockContract::new()?;
    let authority = Authority {
        core,
        principal: p,
        now: r::Timestamp::parse(&crate::app::now().map_err(|_| unavailable())?)
            .map_err(|_| unavailable())?,
    };
    let prepared = st::prepare(p, raw, &contracts, &authority, &mut Preparer(&authority))?;
    let mut reader = Reader(&authority);
    let mut history = HistoryUnavailable;
    let mut queries = q::HomeBoxQueries::new(&contracts, &mut reader, &mut history);
    st::dispatch(
        p,
        prepared,
        &contracts,
        &authority,
        &mut queries,
        &mut CommandsUnavailable,
    )
}
