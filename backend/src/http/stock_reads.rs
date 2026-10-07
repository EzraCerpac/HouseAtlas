//! Stock record/history reads bound to the original AT11 principal and SQLite graph.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, domain_error, failure, json_response,
};
use crate::{
    access as a,
    app::{Access, ReadAuthority, Reads, RequestPrincipal, Store},
    contracts as c,
    domain::{self as d, stock as st},
    storage as s,
};
use axum::{
    extract::{Extension, Path, Query, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, OnceCell},
    sync::{Arc, Mutex},
};

struct Witness<'p> {
    principal: &'p RequestPrincipal,
    request: Value,
    digest: OnceCell<String>,
    graph: OnceCell<s::Snapshot>,
    history: OnceCell<Value>,
    history_committed: Cell<bool>,
}
struct Graph(s::Snapshot);
struct Authority<'p, 'store> {
    principal: &'p RequestPrincipal,
    access: &'store Access,
    store: &'store Mutex<Store>,
}
fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn scope(request: &st::ValidatedRequest) -> d::Scope {
    d::Scope {
        workspace_id: request.context().workspace_id.clone(),
        home_id: request.context().home_id.clone(),
    }
}
pub(super) fn snapshot(
    store: &Mutex<Store>,
    p: &RequestPrincipal,
    request: &st::ValidatedRequest,
) -> st::StockResult<s::Snapshot> {
    let mut store = store.lock().map_err(|_| unavailable())?;
    let scope: s::Scope =
        serde_json::from_value(serde_json::to_value(scope(request)).map_err(|_| unavailable())?)
            .map_err(|_| unavailable())?;
    let snapshot = store
        .read_snapshot(p, &scope)
        .map_err(|e| st::StockError::Domain(crate::app::storage_error(e)))?;
    s::Contract::validate_snapshot(&super::contracts::NativeContracts, &snapshot)
        .map_err(|_| unavailable())?;
    Ok(snapshot)
}
fn digest(snapshot: &s::Snapshot) -> st::StockResult<String> {
    c::semantics::canonical_digest(&serde_json::to_value(snapshot).map_err(|_| unavailable())?)
        .map_err(|_| unavailable())
}
fn read_operation(request: &st::ValidatedRequest) -> st::StockResult<()> {
    if request.is_mutation()
        || request.operation().authority != st::Authority::Atlas
        || !(request.id().as_str().ends_with(".get") || request.id().as_str().ends_with(".history"))
    {
        return Err(unavailable());
    }
    Ok(())
}
impl Authority<'_, '_> {
    fn original(
        &self,
        p: &RequestPrincipal,
        witness: &Witness<'_>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        read_operation(request)?;
        if !std::ptr::eq(p, self.principal)
            || !std::ptr::eq(p, witness.principal)
            || witness.request != *request.raw()
        {
            return Err(changed());
        }
        let access = self.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        let scope = crate::app::access_scope(&scope(request)).map_err(|_| changed())?;
        let capability = if request.id().as_str().ends_with(".history") {
            a::Capability::ReadHistory
        } else {
            a::Capability::Read
        };
        access
            .authorize_storage(&p.principal, &scope, capability)
            .map_err(|_| changed())?;
        Ok(())
    }
}
pub(super) fn capture_graph(
    access: &Access,
    p: &RequestPrincipal,
    snapshot: &s::Snapshot,
) -> st::StockResult<()> {
    // Parse only real already-validated snapshot data, never authority.
    let typed: c::Snapshot = c::decode(&serde_json::to_vec(snapshot).map_err(|_| unavailable())?)
        .map_err(|_| unavailable())?;
    let access = access.lock().map_err(|_| unavailable())?;
    let source = |reference: c::SourceRef| -> st::StockResult<()> {
        let native: a::SourceRef =
            serde_json::from_value(serde_json::to_value(reference).map_err(|_| unavailable())?)
                .map_err(|_| unavailable())?;
        p.capture_source(&access, &native).map_err(|_| changed())
    };
    let partition = |workspace_id: &str,
                     home_id: &str,
                     source_instance_id: &str,
                     collection_id: &str|
     -> st::StockResult<()> {
        let native: a::SourcePartition = serde_json::from_value(json!({"workspaceId":workspace_id,"homeId":home_id,"sourceInstanceId":source_instance_id,"collectionId":collection_id})).map_err(|_| unavailable())?;
        p.capture_partition(&access, &native).map_err(|_| changed())
    };
    for registration in &typed.sources {
        partition(
            &registration.workspace_id,
            &registration.home_id,
            &registration.source_instance_id,
            &registration.collection_id,
        )?;
    }
    for cache in &typed.caches {
        partition(
            &cache.workspace_id,
            &cache.home_id,
            &cache.source_instance_id,
            &cache.collection_id,
        )?;
    }
    for record in typed.records {
        match record {
            c::AtlasRecord::BindingRecord(record) => source(c::SourceRef {
                workspace_id: record.workspace_id,
                home_id: record.home_id,
                key: record.payload.source,
            })?,
            c::AtlasRecord::EvidenceRecord(record) => {
                if let Some(reference) = record.payload.provenance.source {
                    source(reference)?;
                }
                for reference in record.payload.references {
                    if let c::EvidencePayloadReferencesItem::HomeboxAttachment(reference) =
                        reference
                    {
                        source(reference.entity)?;
                    }
                }
            }
            c::AtlasRecord::GeometryRecord(record) => {
                for mapping in record.payload.mappings {
                    if let Some(reference) = mapping.homebox_entity {
                        source(reference)?;
                    }
                }
            }
            _ => {}
        }
    }
    for row in typed.homebox_entities {
        source(c::SourceRef {
            workspace_id: row.workspace_id.clone(),
            home_id: row.home_id.clone(),
            key: row.source.clone(),
        })?;
        for link in row.native_links {
            source(link.entity)?;
        }
        if let Some(parent) = row.entity.parent {
            let mut key = row.source;
            key.source_kind = c::SourceKeySourceKind::HomeboxEntity;
            key.external_id = parent.id;
            source(c::SourceRef {
                workspace_id: row.workspace_id,
                home_id: row.home_id,
                key,
            })?;
        }
    }
    for row in typed.network_relations {
        let key = c::SourceKey {
            source_instance_id: row.source_instance_id,
            collection_id: row.collection_id,
            source_kind: c::SourceKeySourceKind::NetworkSegment,
            external_id: row.external_id,
        };
        source(c::SourceRef {
            workspace_id: row.workspace_id.clone(),
            home_id: row.home_id.clone(),
            key: key.clone(),
        })?;
        for endpoint in [row.r#from, row.to] {
            let kind = match endpoint.kind {
                c::NetworkEndpointKind::Device => c::SourceKeySourceKind::NetworkDevice,
                c::NetworkEndpointKind::Interface => c::SourceKeySourceKind::NetworkInterface,
                c::NetworkEndpointKind::Segment => c::SourceKeySourceKind::NetworkSegment,
                c::NetworkEndpointKind::Unresolved => continue,
            };
            let mut key = key.clone();
            key.source_kind = kind;
            key.external_id = endpoint.id.ok_or_else(unavailable)?;
            source(c::SourceRef {
                workspace_id: row.workspace_id.clone(),
                home_id: row.home_id.clone(),
                key,
            })?;
        }
    }
    p.release(&access).map_err(|_| changed())
}
impl<'p> st::StockAuthorityPort<RequestPrincipal> for Authority<'p, '_> {
    type Witness = Witness<'p>;
    type Graph = Graph;
    fn capture(
        &self,
        p: &RequestPrincipal,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Self::Witness> {
        let witness = Witness {
            principal: self.principal,
            request: request.raw().clone(),
            digest: OnceCell::new(),
            graph: OnceCell::new(),
            history: OnceCell::new(),
            history_committed: Cell::new(false),
        };
        self.original(p, &witness, request)?;
        Ok(witness)
    }
    fn authorize_graph(
        &self,
        p: &RequestPrincipal,
        witness: &Self::Witness,
        request: &st::ValidatedRequest,
        graph: &Graph,
    ) -> st::StockResult<()> {
        self.original(p, witness, request)?;
        capture_graph(self.access, p, &graph.0)?;
        witness
            .digest
            .set(digest(&graph.0)?)
            .map_err(|_| changed())?;
        witness.graph.set(graph.0.clone()).map_err(|_| changed())?;
        p.seal_source_capture();
        self.original(p, witness, request)
    }
    fn revalidate(
        &self,
        p: &RequestPrincipal,
        witness: &Self::Witness,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.original(p, witness, request)?;
        let original = witness.digest.get().ok_or_else(changed)?;
        let current = snapshot(self.store, p, request)?;
        if digest(&current)? != *original || witness.graph.get() != Some(&current) {
            return Err(changed());
        }
        self.original(p, witness, request)
    }
    fn authorize_result(
        &self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        if request.id().as_str().ends_with(".history") {
            if !prepared.witness().history_committed.get()
                || prepared.witness().history.get() != Some(result)
            {
                return Err(changed());
            }
            return self.revalidate(p, prepared.witness(), request);
        }
        let expected = st::StockQueryPort::query(
            &mut st::AtlasReads::new(LockedReads(self.store), st::NativeStockContract::new()?),
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
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Self::Witness, Graph>,
        request: &st::ValidatedRequest,
        target: &Value,
        _row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        if purpose != st::DisclosurePurpose::ExactTarget || target != request.target() {
            return Err(changed());
        }
        if !prepared.graph().0.records.iter().any(|record| {
            record.scope()
                == s::Scope {
                    workspace_id: request.context().workspace_id.clone(),
                    home_id: request.context().home_id.clone(),
                }
                && target["recordId"] == record.record_id
                && serde_json::to_value(record.record_type)
                    .is_ok_and(|kind| target["recordType"] == kind)
        }) {
            return Err(changed());
        }
        Ok(())
    }
}
struct Preparer<'a>(&'a Mutex<Store>);
impl<'p> st::StockPreparerPort<RequestPrincipal, Witness<'p>> for Preparer<'_> {
    type Graph = Graph;
    fn resolve(
        &mut self,
        p: &RequestPrincipal,
        witness: &Witness<'p>,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<Graph> {
        if !std::ptr::eq(p, witness.principal) || witness.request != *request.raw() {
            return Err(changed());
        }
        snapshot(self.0, p, request).map(Graph)
    }
}
struct LockedReads<'a>(&'a Mutex<Store>);
impl d::ReadPort<RequestPrincipal> for LockedReads<'_> {
    fn snapshot(&mut self, p: &RequestPrincipal, scope: &d::Scope) -> d::DomainResult<d::Snapshot> {
        let mut store = self
            .0
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        Reads(&mut store).snapshot(p, scope)
    }
    fn record(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<d::Record> {
        let mut store = self
            .0
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        Reads(&mut store).record(p, scope, target)
    }
    fn history(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<Vec<d::Audit>> {
        let mut store = self
            .0
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        Reads(&mut store).history(p, scope, target)
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
struct HistoryAuthorization<'a, 'p> {
    witness: &'a Witness<'p>,
    access: &'a Access,
    request: &'a st::ValidatedRequest,
    scope: s::Scope,
    target: s::RecordRef,
    read_calls: Cell<u8>,
    phase: Cell<u8>,
}
impl HistoryAuthorization<'_, '_> {
    fn actor(&self, p: &RequestPrincipal) -> s::Result<s::VerifiedActor> {
        self.verify(
            p,
            s::AuthorizationRequest {
                scope: &self.scope,
                capability: s::Capability::ReadHistory,
                targets: std::slice::from_ref(&self.target),
                source: None,
                source_partition: None,
                mutation: None,
            },
        )
    }
    fn verify(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        if !std::ptr::eq(p, self.witness.principal)
            || self.witness.request != *self.request.raw()
            || request.scope != &self.scope
            || request.capability != s::Capability::ReadHistory
            || request.targets != std::slice::from_ref(&self.target)
            || request.source.is_some()
            || request.source_partition.is_some()
            || request.mutation.is_some()
        {
            return Err(s::Error::new(
                "forbidden",
                "Original stock history authority changed",
            ));
        }
        s::Authorization::authorize(&ReadAuthority(Arc::clone(self.access)), p, request)
    }
}
impl s::Authorization for HistoryAuthorization<'_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let actor = self.verify(p, request)?;
        let calls = self.read_calls.get();
        if calls >= 2 {
            return Err(s::Error::new(
                "unavailable",
                "Stock history callback changed",
            ));
        }
        self.read_calls.set(calls + 1);
        Ok(actor)
    }
}
impl s::StockAuthorization for HistoryAuthorization<'_, '_> {
    fn authorize_stock_mutation(
        &self,
        _: &RequestPrincipal,
        _: s::StockMutationFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        Err(s::Error::new(
            "unavailable",
            "Read authority cannot execute stock mutations",
        ))
    }
    fn authorize_stock_history(
        &self,
        p: &RequestPrincipal,
        frame: s::StockHistoryFrame<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let actor = self.actor(p)?;
        if frame.request != self.request.raw()
            || frame.scope != &self.scope
            || frame.target != &self.target
            || frame.audits.iter().any(|audit| {
                audit.workspace_id != self.scope.workspace_id
                    || audit.home_id != self.scope.home_id
                    || audit.record != self.target
            })
        {
            return Err(s::Error::new(
                "forbidden",
                "Original stock history frame changed",
            ));
        }
        match frame.result {
            None if self.phase.get() == 0
                && self.read_calls.get() == 1
                && frame.audits.is_empty() =>
            {
                self.phase.set(1)
            }
            Some(result)
                if self.phase.get() == 1
                    && self.read_calls.get() == 2
                    && result.children.is_empty() =>
            {
                self.witness
                    .history
                    .set(result.wire.clone())
                    .map_err(|_| s::Error::new("unavailable", "Stock history output changed"))?;
                self.phase.set(2);
            }
            _ => {
                return Err(s::Error::new(
                    "unavailable",
                    "Stock history callback changed",
                ));
            }
        }
        Ok(actor)
    }
}
struct NativeQueries<'a> {
    store: &'a Mutex<Store>,
    access: &'a Access,
    contracts: st::NativeStockContract,
}
impl<'p> st::StockQueryPort<RequestPrincipal, Witness<'p>, Graph> for NativeQueries<'_> {
    fn query(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        if !prepared.request().id().as_str().ends_with(".history") {
            return st::StockQueryPort::query(
                &mut st::AtlasReads::new(LockedReads(self.store), self.contracts.clone()),
                p,
                prepared,
            );
        }
        let request = prepared.request();
        let scope = serde_json::from_value(
            serde_json::to_value(request.context()).map_err(|_| unavailable())?,
        )
        .map_err(|_| unavailable())?;
        let target=serde_json::from_value(json!({"recordType":request.target()["recordType"],"recordId":request.target()["recordId"]})).map_err(|_|unavailable())?;
        let authorization = HistoryAuthorization {
            witness: prepared.witness(),
            access: self.access,
            request,
            scope,
            target,
            read_calls: Cell::new(0),
            phase: Cell::new(0),
        };
        let mut store = self.store.lock().map_err(|_| unavailable())?;
        let result = store
            .stock_history_json_with_authorization(
                &authorization,
                p,
                &self.contracts,
                request.raw(),
            )
            .map_err(|e| st::StockError::Domain(crate::app::storage_error(e)))?;
        if authorization.read_calls.get() != 2
            || authorization.phase.get() != 2
            || !result.children.is_empty()
            || prepared.witness().history.get() != Some(&result.wire)
        {
            return Err(changed());
        }
        // Mark only after the actual cursor/history transaction has committed.
        prepared.witness().history_committed.set(true);
        Ok(result)
    }
}
pub(super) fn http_error(error: st::StockError) -> super::HttpFailure {
    match error {
        st::StockError::Domain(error) => domain_error(error),
        st::StockError::InvalidContract => domain_error(d::DomainError::InvalidContract),
        st::StockError::AuthorityChanged => domain_error(d::DomainError::Forbidden),
        _ => failure(StatusCode::SERVICE_UNAVAILABLE),
    }
}
pub(super) async fn record(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<(String, String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    s::Contract::validate_shape(
        &super::contracts::NativeContracts,
        "recordRef",
        &json!({"recordType":kind,"recordId":id}),
    )
    .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    tokio::task::spawn_blocking(move || {
        let _admitted=headers.admission_permit()?;
        authorized_read(&host,&headers,&uri,&method,Some(d::Scope{workspace_id,home_id}),false,|core,p,home| {
            let contracts=st::NativeStockContract::new().map_err(http_error)?;
            let raw=json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.get"),"requestId":crate::app::new_id().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,"context":home.scope,"target":{"authority":"atlas","recordType":kind,"recordId":id},"payload":{}});
            let authority=Authority{principal:p,access:&core.access,store:&core.store};
            let prepared=st::prepare(p,raw,&contracts,&authority,&mut Preparer(&core.store)).map_err(http_error)?;
            let result=st::dispatch(p,prepared,&contracts,&authority,&mut NativeQueries{store:&core.store,access:&core.access,contracts:contracts.clone()},&mut CommandsUnavailable).map_err(http_error)?;
            Ok(json_response(result.wire))
        })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HistoryQuery {
    #[serde(default = "history_page_size")]
    page_size: u64,
    cursor: Option<String>,
    q: Option<String>,
}
fn history_page_size() -> u64 {
    50
}
pub(super) async fn history(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<(String, String, String, String)>,
    Query(query): Query<HistoryQuery>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    s::Contract::validate_shape(
        &super::contracts::NativeContracts,
        "recordRef",
        &json!({"recordType":kind,"recordId":id}),
    )
    .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    tokio::task::spawn_blocking(move||{
        let _admitted=headers.admission_permit()?;
        authorized_read(&host,&headers,&uri,&method,Some(d::Scope{workspace_id,home_id}),false,|core,p,home|{
            let contracts=st::NativeStockContract::new().map_err(http_error)?;
            let mut payload=json!({"pageSize":query.page_size,"cursor":query.cursor,"includeArchived":false});
            if let Some(q)=query.q {payload["q"]=Value::String(q);}
            let raw=json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.history"),"requestId":crate::app::new_id().map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?,"context":home.scope,"target":{"authority":"atlas","recordType":kind,"recordId":id},"payload":payload});
            let authority=Authority{principal:p,access:&core.access,store:&core.store};
            let prepared=st::prepare(p,raw,&contracts,&authority,&mut Preparer(&core.store)).map_err(http_error)?;
            let result=st::dispatch(p,prepared,&contracts,&authority,&mut NativeQueries{store:&core.store,access:&core.access,contracts:contracts.clone()},&mut CommandsUnavailable).map_err(http_error)?;
            Ok(json_response(result.wire))
        })
    }).await.map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?
}
