//! Native HomeBox stock reads bound to the original Access, Store, and GET owner.
//! Called synchronously inside an existing spawn_blocking request task.
use crate::{
    access as a,
    app::{ReadAuthority, RequestPrincipal, Store},
    config::providers::homebox::TrustedHomeBoxSource,
    contracts::stock::StockTarget,
    domain::stock as st,
    http::Host,
    providers::homebox::{
        read::{self as r, query as q},
        wire,
    },
    storage as s,
};
use serde_json::Value;
use std::{
    cell::OnceCell,
    sync::{Arc, Mutex},
};

pub(crate) const OPERATIONS: [st::OperationId; 5] = [
    st::OperationId::HomeboxEntityTagsGet,
    st::OperationId::HomeboxFieldList,
    st::OperationId::HomeboxFieldGet,
    st::OperationId::HomeboxMaintenanceList,
    st::OperationId::HomeboxMaintenanceGet,
];

/// Trusted immutable endpoint/credential configuration. This admits no account,
/// source grant, installed build or writable provider capability.
#[derive(Clone)]
pub struct NativeHomeBoxReadBinding {
    source: Arc<TrustedHomeBoxSource>,
    credentials: Arc<r::NativeReadCredentialConfig>,
    pages: Arc<r::NativeListPages>,
}
impl NativeHomeBoxReadBinding {
    pub fn new(
        source: TrustedHomeBoxSource,
        credentials: Arc<r::NativeReadCredentialConfig>,
    ) -> s::Result<Self> {
        let endpoint = source.endpoint().map_err(|_| invalid_binding())?;
        let partition = source.partition();
        let collection = r::Uuid::parse(&partition.collection_id).map_err(|_| invalid_binding())?;
        if collection.as_str() != partition.collection_id
            || source.metadata_dialect() != wire::DIALECT
            || !credentials.matches_endpoint(&endpoint)
        {
            return Err(invalid_binding());
        }
        Ok(Self {
            source: Arc::new(source),
            credentials,
            pages: Arc::new(r::NativeListPages::new()),
        })
    }
    pub(crate) fn source(&self) -> &TrustedHomeBoxSource {
        self.source.as_ref()
    }
    pub(crate) fn source_arc(&self) -> &Arc<TrustedHomeBoxSource> {
        &self.source
    }
    pub(crate) fn bind_pages(&mut self, pages: Arc<r::NativeListPages>) {
        self.pages = pages;
    }
    fn matches(&self, request: &st::ValidatedRequest) -> bool {
        let partition = self.source.partition();
        request.context().workspace_id == partition.workspace_id
            && request.context().home_id == partition.home_id
            && request.target()["sourceInstanceId"] == partition.source_instance_id
            && request.target()["collectionId"] == partition.collection_id
    }
}
fn invalid_binding() -> s::Error {
    s::Error::new(
        "invalid-contract",
        "Native HomeBox read binding is unavailable",
    )
}
struct NativeClock;
impl r::Clock for NativeClock {
    fn now(&self) -> r::Timestamp {
        // The native clock's RFC3339 formatter produces validated syntax.
        r::Timestamp::parse(&crate::app::now().expect("native RFC3339 clock"))
            .expect("native RFC3339 timestamp")
    }
}

/// Called only by the actual request's spawn_blocking worker. Credential
/// delivery and capture share the original request's opaque grant allocations.
pub(crate) fn execute_configured(
    host: &Host,
    p: &RequestPrincipal,
    raw: Value,
    handle: &tokio::runtime::Handle,
) -> st::StockResult<st::OwnerResult> {
    execute_configured_with_bindings(&host.core, &host.native_homebox_reads, p, raw, handle)
}
pub(crate) fn execute_configured_with_bindings(
    core: &Arc<Mutex<crate::app::Core>>,
    bindings: &[NativeHomeBoxReadBinding],
    p: &RequestPrincipal,
    raw: Value,
    handle: &tokio::runtime::Handle,
) -> st::StockResult<st::OwnerResult> {
    let contracts = st::NativeStockContract::new()?;
    let request = st::ValidatedRequest::parse(&contracts, raw.clone())?;
    if !OPERATIONS.contains(&request.id()) || request.is_mutation() {
        return Err(unavailable());
    }
    let binding = bindings
        .iter()
        .find(|b| b.matches(&request))
        .ok_or_else(unavailable)?;
    let access = {
        let core = core.lock().map_err(|_| unavailable())?;
        Arc::clone(&core.access)
    };
    let partition = binding.source.partition();
    let access_partition: a::SourcePartition =
        serde_json::from_value(serde_json::to_value(&partition).map_err(|_| changed())?)
            .map_err(|_| changed())?;
    let owner_key = if request.id() == st::OperationId::HomeboxEntityTagsGet {
        "resourceId"
    } else {
        "entityId"
    };
    let source = a::SourceRef {
        workspace_id: p.principal.scope().workspace_id.clone(),
        home_id: p.principal.scope().home_id.clone(),
        key: a::SourceKey {
            source_instance_id: a::CanonicalId::parse(&partition.source_instance_id)
                .map_err(|_| changed())?,
            collection_id: partition.collection_id,
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: request.target()[owner_key]
                .as_str()
                .ok_or_else(changed)?
                .to_owned(),
        },
    };
    let (source_grant, partition_grant) = {
        let guard = access.lock().map_err(|_| unavailable())?;
        p.capture_partition(&guard, &access_partition)
            .map_err(|_| changed())?;
        p.capture_source(&guard, &source).map_err(|_| changed())?;
        (
            p.captured_source(&source).map_err(|_| changed())?,
            p.captured_partition(&access_partition)
                .map_err(|_| changed())?,
        )
    };
    let credentials = binding
        .credentials
        .bind_original(
            access,
            p.principal.principal(),
            source_grant,
            partition_grant,
        )
        .map_err(|_| unavailable())?;
    let mut reader = binding
        .source
        .reader(credentials, NativeClock)
        .map_err(|_| unavailable())?;
    execute_with_core_reader(core, p, raw, &binding.source, &mut reader, Some(binding), handle)
}
fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
fn store_error(error: s::Error) -> st::StockError {
    st::StockError::Domain(crate::app::storage_error(error))
}
fn denied() -> s::Error {
    s::Error::new("not-found", "Native read authority unavailable")
}

#[derive(Clone)]
struct Graph {
    identity: Arc<()>,
    baseline: s::RegisteredCacheRead,
    request: Value,
    original_bytes: Vec<u8>,
    retrieved_at: String,
    targets: Vec<StockTarget>,
    parent_relations: Vec<(StockTarget, StockTarget)>,
    list: Option<Arc<r::NativeListSnapshot>>,
}
struct Witness<'a, 'p> {
    captured: &'a st::CapturedAccess<'p>,
    request: Value,
}
struct Authority<'a, 'p> {
    outer: &'a RequestPrincipal,
    principal: &'p a::Principal,
    captured: &'a st::CapturedAccess<'p>,
    access: Arc<Mutex<a::AccessBoundary>>,
    store: Arc<Mutex<Store>>,
    scope: s::Scope,
    partition: s::SourcePartition,
    graph: Graph,
    result: OnceCell<st::OwnerResult>,
}
impl Authority<'_, '_> {
    fn original(&self, p: &a::Principal, request: &st::ValidatedRequest) -> st::StockResult<()> {
        if !std::ptr::eq(p, self.principal)
            || !OPERATIONS.contains(&request.id())
            || request.is_mutation()
            || request.raw() != &self.graph.request
            || request.context().workspace_id != self.scope.workspace_id
            || request.context().home_id != self.scope.home_id
            || self.captured.source_grants().len() != 1
            || self.captured.partition_grants().len() != 1
        {
            return Err(changed());
        }
        let mut access = self.access.lock().map_err(|_| unavailable())?;
        access.revalidate(p).map_err(|_| changed())?;
        for grant in self.captured.source_grants() {
            access.revalidate_source(grant).map_err(|_| changed())?;
        }
        for grant in self.captured.partition_grants() {
            access
                .revalidate_source_partition(grant)
                .map_err(|_| changed())?;
        }
        if let Some(snapshot) = &self.graph.list {
            snapshot.revalidate_captured(&mut access, self.captured)?;
        }
        drop(access);
        let mut store = self.store.lock().map_err(|_| unavailable())?;
        let current = store
            .read_cache_partition_with_authorization(
                &ReadAuthority(Arc::clone(&self.access)),
                self.outer,
                &self.scope,
                &self.partition,
            )
            .map_err(store_error)?;
        if current != self.graph.baseline {
            return Err(changed());
        }
        Ok(())
    }
    fn witness(
        &self,
        p: &a::Principal,
        witness: &Witness<'_, '_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        if !std::ptr::eq(witness.captured, self.captured)
            || !std::ptr::eq(witness.captured.principal(), p)
            || witness.request != *request.raw()
        {
            return Err(changed());
        }
        self.original(p, request)
    }
    fn graph(&self, graph: &Graph) -> st::StockResult<()> {
        if !Arc::ptr_eq(&graph.identity, &self.graph.identity)
            || graph.baseline != self.graph.baseline
            || graph.request != self.graph.request
            || graph.original_bytes != self.graph.original_bytes
            || graph.retrieved_at != self.graph.retrieved_at
            || graph.targets != self.graph.targets
            || graph.parent_relations != self.graph.parent_relations
            || !same_list(self.graph.list.as_ref(), graph.list.as_ref())
        {
            return Err(changed());
        }
        Ok(())
    }
}
fn same_list(
    expected: Option<&Arc<r::NativeListSnapshot>>,
    actual: Option<&Arc<r::NativeListSnapshot>>,
) -> bool {
    match (expected, actual) {
        (None, None) => true,
        (Some(expected), Some(actual)) => {
            Arc::ptr_eq(expected, actual)
                && expected.same_capture(actual)
                && expected.original_bytes() == actual.original_bytes()
                && expected.retrieved_at().as_str() == actual.retrieved_at().as_str()
                && expected.references() == actual.references()
                && expected.parent_relations() == actual.parent_relations()
                && expected.baseline() == actual.baseline()
        }
        _ => false,
    }
}
impl<'a, 'p> st::StockAuthorityPort<a::Principal> for Authority<'a, 'p> {
    type Witness = Witness<'a, 'p>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &a::Principal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        self.original(p, request)?;
        Ok(Witness {
            captured: self.captured,
            request: request.raw().clone(),
        })
    }
    fn authorize_graph(
        &self,
        p: &a::Principal,
        w: &Self::Witness,
        request: &st::ValidatedRequest,
        graph: &Graph,
    ) -> st::StockResult<()> {
        self.witness(p, w, request)?;
        self.graph(graph)
    }
    fn revalidate(
        &self,
        p: &a::Principal,
        w: &Self::Witness,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.witness(p, w, request)
    }
    fn authorize_result(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        self.witness(p, prepared.witness(), request)?;
        self.graph(prepared.graph())?;
        let expected = self.result.get().ok_or_else(changed)?;
        if !expected.children.is_empty()
            || expected.wire != *result
            || result["data"]["sourceStatus"] != "unresolved"
        {
            return Err(changed());
        }
        Ok(())
    }
    fn disclose(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.authorize_result(
            p,
            prepared,
            request,
            &self.result.get().ok_or_else(changed)?.wire,
        )?;
        let member: StockTarget = serde_json::from_value(target.clone()).map_err(|_| changed())?;
        let expected = self.result.get().ok_or_else(changed)?;
        if !prepared.graph().targets.contains(&member)
            || !matches!(
                purpose,
                st::DisclosurePurpose::ExactTarget | st::DisclosurePurpose::ScopedPage
            )
            || !expected.wire["data"]["resources"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(|r| r == row && r["target"] == *target))
        {
            return Err(changed());
        }
        Ok(())
    }
}
impl<'a, 'p> st::GraphAuthorization<Witness<'a, 'p>, Graph> for Authority<'a, 'p> {
    fn revalidate_prepared(
        &self,
        p: &a::Principal,
        captured: &st::CapturedAccess<'_>,
        prepared: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
    ) -> s::Result<()> {
        if !std::ptr::eq(captured, self.captured)
            || self
                .witness(p, prepared.witness(), prepared.request())
                .is_err()
            || self.graph(prepared.graph()).is_err()
        {
            return Err(denied());
        }
        Ok(())
    }
    fn authorize_native(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::AuthorizationRequest<'_>,
    ) -> s::Result<()> {
        Err(denied())
    }
    fn authorize_stock_mutation(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::StockMutationFrame<'_>,
    ) -> s::Result<()> {
        Err(denied())
    }
    fn authorize_stock_history(
        &self,
        _: &a::Principal,
        _: &st::PreparedRequest<Witness<'a, 'p>, Graph>,
        _: &s::StockHistoryFrame<'_>,
    ) -> s::Result<()> {
        Err(denied())
    }
}
struct Preparer<'a>(&'a Graph);
impl<'a, 'p> st::StockPreparerPort<a::Principal, Witness<'a, 'p>> for Preparer<'_> {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &a::Principal,
        w: &Witness<'a, 'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        if !std::ptr::eq(p, w.captured.principal())
            || w.request != *request.raw()
            || self.0.request != *request.raw()
        {
            return Err(changed());
        }
        Ok(self.0.clone())
    }
}
struct NoOtherOwner;
impl st::StockHistoryPort<a::Principal> for NoOtherOwner {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &a::Principal,
        _: &C,
        _: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        Err(unavailable())
    }
}
impl<W, G> st::StockCommandPort<a::Principal, W, G> for NoOtherOwner {
    fn execute(
        &mut self,
        _: &a::Principal,
        _: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(unavailable())
    }
}
struct ExactOwner<'a, Q> {
    inner: Q,
    result: &'a OnceCell<st::OwnerResult>,
}
impl<P, W, G, Q: st::StockQueryPort<P, W, G>> st::StockQueryPort<P, W, G> for ExactOwner<'_, Q> {
    fn query(
        &mut self,
        p: &P,
        prepared: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        let result = self.inner.query(p, prepared)?;
        self.result.set(result.clone()).map_err(|_| changed())?;
        Ok(result)
    }
}

/// Source-only composition. The caller must already be in spawn_blocking; the
/// supplied reader retains its configured credential/transport owner.
pub fn execute_with_reader<T: r::Transport, K: r::Clock>(
    host: &Host,
    p: &RequestPrincipal,
    raw: Value,
    configured: &TrustedHomeBoxSource,
    reader: &mut r::HomeBoxReader<T, K>,
    handle: &tokio::runtime::Handle,
) -> st::StockResult<st::OwnerResult> {
    execute_with_core_reader(&host.core, p, raw, configured, reader, None, handle)
}
fn execute_with_core_reader<T: r::Transport, K: r::Clock>(
    core: &Arc<Mutex<crate::app::Core>>,
    p: &RequestPrincipal,
    raw: Value,
    configured: &TrustedHomeBoxSource,
    reader: &mut r::HomeBoxReader<T, K>,
    list_binding: Option<&NativeHomeBoxReadBinding>,
    handle: &tokio::runtime::Handle,
) -> st::StockResult<st::OwnerResult> {
    let contracts = st::NativeStockContract::new()?;
    let request = st::ValidatedRequest::parse(&contracts, raw.clone())?;
    if !OPERATIONS.contains(&request.id())
        || request.is_mutation()
        || configured.metadata_dialect() != wire::DIALECT
        || reader.metadata_dialect() != wire::DIALECT
        || reader.scope() != &configured.scope()
    {
        return Err(unavailable());
    }
    let actual = reader.registration();
    let expected = configured.registration();
    if actual.workspace_id.as_str() != expected.workspace_id
        || actual.home_id.as_str() != expected.home_id
        || actual.source_instance_id.as_str() != expected.source_instance_id
        || actual.collection_id != expected.collection_id
        || actual.owner != "homebox"
        || !matches!(
            (actual.partition_mode, expected.partition_mode),
            (
                r::PartitionMode::ExclusiveHome,
                s::PartitionMode::ExclusiveHome
            ) | (
                r::PartitionMode::ReviewedEntityAllowlist,
                s::PartitionMode::ReviewedEntityAllowlist
            )
        )
        || actual.allowed_external_ids.len() != expected.allowed_external_ids.len()
        || actual
            .allowed_external_ids
            .iter()
            .zip(&expected.allowed_external_ids)
            .any(|(a, b)| a.as_str() != b)
    {
        return Err(changed());
    }
    let query = q::HomeBoxReadQuery::from_request(&request)?;
    if query.scope() != reader.scope() {
        return Err(changed());
    }
    let (access, store, home_ok) = {
        let core = core.lock().map_err(|_| unavailable())?;
        (
            Arc::clone(&core.access),
            Arc::clone(&core.store),
            core.homes.iter().any(|h| {
                h.scope.workspace_id == request.context().workspace_id
                    && h.scope.home_id == request.context().home_id
            }),
        )
    };
    let partition = configured.partition();
    let scope = partition.scope();
    if !home_ok
        || request.context().workspace_id != scope.workspace_id
        || request.context().home_id != scope.home_id
        || request.target()["sourceInstanceId"] != partition.source_instance_id
        || request.target()["collectionId"] != partition.collection_id
    {
        return Err(changed());
    }
    let baseline = {
        let mut guard = store.lock().map_err(|_| unavailable())?;
        guard
            .read_cache_partition_with_authorization(
                &ReadAuthority(Arc::clone(&access)),
                p,
                &scope,
                &partition,
            )
            .map_err(store_error)?
    };
    if baseline.registration != *configured.registration()
        || baseline.registration.owner != s::SourceOwner::Homebox
    {
        return Err(changed());
    }
    let owner_key = if request.id() == st::OperationId::HomeboxEntityTagsGet {
        "resourceId"
    } else {
        "entityId"
    };
    let owner = request.target()[owner_key].as_str().ok_or_else(changed)?;
    let original_partition: a::SourcePartition =
        serde_json::from_value(serde_json::to_value(&partition).map_err(|_| changed())?)
            .map_err(|_| changed())?;
    let source = a::SourceRef {
        workspace_id: p.principal.scope().workspace_id.clone(),
        home_id: p.principal.scope().home_id.clone(),
        key: a::SourceKey {
            source_instance_id: a::CanonicalId::parse(&partition.source_instance_id)
                .map_err(|_| changed())?,
            collection_id: partition.collection_id.clone(),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: owner.to_owned(),
        },
    };
    let original = p.principal.principal();
    let captured = {
        let mut guard = access.lock().map_err(|_| unavailable())?;
        p.capture_partition(&guard, &original_partition)
            .map_err(|_| changed())?;
        p.capture_source(&guard, &source).map_err(|_| changed())?;
        let partition_grant = p
            .captured_partition(&original_partition)
            .map_err(|_| changed())?;
        let source_grant = p.captured_source(&source).map_err(|_| changed())?;
        st::CapturedAccess::retain_original(
            &mut guard,
            original,
            &[source_grant],
            &[partition_grant],
        )
        .map_err(|_| changed())?
    };
    p.seal_source_capture();
    let list_operation = matches!(
        request.id(),
        st::OperationId::HomeboxFieldList | st::OperationId::HomeboxMaintenanceList
    );
    let intake = if let Some(binding) = list_binding.filter(|_| list_operation) {
        let selected = r::NativeListReadRequest::select(
            binding.source_arc(),
            &captured,
            &request,
            &baseline,
        )?;
        if request.payload()["cursor"].is_null() {
            handle.block_on(binding.pages.capture_configured(
                &contracts,
                &access,
                &binding.credentials,
                selected,
            ))?
        } else {
            binding
                .pages
                .continue_original(&contracts, &access, selected)?
        }
    } else {
        handle.block_on(reader.capture_native_read(&contracts, &access, &captured, &request))?
    };
    let list = intake.retained_list().cloned();
    let graph = Graph {
        identity: Arc::new(()),
        // Keep the actual input alive while the intake and its prepared owner
        // borrow it; the graph stores the same registered DATA value.
        baseline: baseline.clone(),
        request: raw,
        original_bytes: intake.original_bytes().to_vec(),
        retrieved_at: intake.retrieved_at().as_str().to_owned(),
        targets: list.as_ref().map_or_else(
            || intake.observation().references().to_vec(),
            |snapshot| snapshot.references().to_vec(),
        ),
        parent_relations: list.as_ref().map_or_else(
            || intake.observation().parent_relations().to_vec(),
            |snapshot| snapshot.parent_relations().to_vec(),
        ),
        list,
    };
    let authority = Authority {
        outer: p,
        principal: original,
        captured: &captured,
        access,
        store,
        scope,
        partition,
        graph,
        result: OnceCell::new(),
    };
    let prepared = st::prepare(
        original,
        request.raw().clone(),
        &contracts,
        &authority,
        &mut Preparer(&authority.graph),
    )?;
    let mut reads = intake.bind_prepared(&prepared, &authority)?;
    let mut history = NoOtherOwner;
    let mut commands = NoOtherOwner;
    let queries = q::HomeBoxQueries::new(&contracts, &mut reads, &mut history);
    let mut exact = ExactOwner {
        inner: queries,
        result: &authority.result,
    };
    st::dispatch_prepared(
        original,
        &prepared,
        &contracts,
        &authority,
        &mut exact,
        &mut commands,
    )
}
