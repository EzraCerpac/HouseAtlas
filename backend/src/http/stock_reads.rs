//! Stock record/history reads bound to the original AT11 principal and SQLite graph.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, domain_error, failure, json_response,
};
use crate::{
    access as a,
    app::{Access, Core, ReadAuthority, Reads, RequestPrincipal, Store},
    contracts as c,
    domain::{self as d, stock as st},
    storage as s,
};
use axum::{
    extract::{Extension, Path, Query, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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
    list_pages: &'store st::AtlasListPages,
    list_binding: st::AtlasListBinding<'p>,
    vault: &'store crate::media::AssetVault,
    download_handles: Option<&'store st::AtlasDownloadHandles>,
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
fn snapshot_content_digest(
    context: &st::StockContext,
    snapshot: &s::Snapshot,
) -> st::StockResult<String> {
    struct HashWriter(Sha256);
    impl std::io::Write for HashWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.update(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut writer = HashWriter(Sha256::new());
    // Pinned serde_json preserves arbitrary-precision number spellings and
    // uses sorted Value object keys. Borrow the actual original scoped graph;
    // no floating-point canonicalization or full serialization buffer.
    serde_json::to_writer(&mut writer, &(context, snapshot)).map_err(|_| unavailable())?;
    let mut digest = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in writer.0.finalize() {
        digest.push(char::from(HEX[usize::from(byte >> 4)]));
        digest.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(digest)
}
fn read_operation(request: &st::ValidatedRequest) -> st::StockResult<()> {
    if request.is_mutation()
        || request.operation().authority != st::Authority::Atlas
        || !(request.id().as_str().ends_with(".get")
            || request.id().as_str().ends_with(".history")
            || request.id() == st::OperationId::AtlasAssetDownload
            || st::atlas_list_record_type(request.id()).is_some())
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
        let downloads = super::stock_downloads::Downloads {
            store: self.store,
            access: self.access,
            vault: self.vault,
            handles: self.download_handles,
        };
        if request.id() == st::OperationId::AtlasAssetDownload {
            downloads.validate_issued(p, prepared, &result["data"])?;
        }
        let expected = st::StockQueryPort::query(
            &mut crate::transports::mcp::NativeQueries::new(
                NativeQueries {
                    store: self.store,
                    access: self.access,
                    contracts: st::NativeStockContract::new()?,
                    list_pages: self.list_pages,
                    list_binding: self.list_binding.clone(),
                },
                downloads,
            )?,
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
        row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), request)?;
        let list_kind = st::atlas_list_record_type(request.id());
        if let Some(kind) = list_kind {
            if purpose != st::DisclosurePurpose::ScopedPage
                || target["authority"] != "atlas"
                || target["recordType"] != request.target()["recordType"]
                || serde_json::to_value(kind).map_err(|_| changed())? != target["recordType"]
            {
                return Err(changed());
            }
        } else if purpose != st::DisclosurePurpose::ExactTarget || target != request.target() {
            return Err(changed());
        }
        let record = prepared
            .graph()
            .0
            .records
            .iter()
            .find(|record| {
                record.scope()
                    == s::Scope {
                        workspace_id: request.context().workspace_id.clone(),
                        home_id: request.context().home_id.clone(),
                    }
                    && target["recordId"] == record.record_id
                    && serde_json::to_value(record.record_type)
                        .is_ok_and(|kind| target["recordType"] == kind)
            })
            .ok_or_else(changed)?;
        if list_kind.is_some() {
            let mut payload = record.payload.clone();
            if record.record_type == s::RecordType::Asset {
                payload
                    .as_object_mut()
                    .ok_or_else(changed)?
                    .remove("storageKey");
            }
            if *row
                != json!({"target":target,"revision":record.revision,
                "lifecycle":record.lifecycle,"payload":payload})
            {
                return Err(changed());
            }
        }
        self.revalidate(p, prepared.witness(), request)
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
struct LockedReads<'a, 'p> {
    store: &'a Mutex<Store>,
    access: &'a Access,
    witness: &'a Witness<'p>,
    request: &'a st::ValidatedRequest,
}
impl d::ReadPort<RequestPrincipal> for LockedReads<'_, '_> {
    fn snapshot(&mut self, p: &RequestPrincipal, scope: &d::Scope) -> d::DomainResult<d::Snapshot> {
        if !std::ptr::eq(p, self.witness.principal) || *scope != self::scope(self.request) {
            return Err(d::DomainError::Forbidden);
        }
        let mut store = self
            .store
            .lock()
            .map_err(|_| d::DomainError::UpstreamUnavailable)?;
        let current = Reads(&mut store).snapshot(p, scope)?;
        if st::atlas_list_record_type(self.request.id()).is_some() {
            let original = self.witness.graph.get().ok_or(d::DomainError::Forbidden)?;
            if serde_json::to_value(&current).map_err(|_| d::DomainError::UpstreamUnavailable)?
                != serde_json::to_value(original)
                    .map_err(|_| d::DomainError::UpstreamUnavailable)?
            {
                return Err(d::DomainError::Forbidden);
            }
        }
        Ok(current)
    }
    fn record(
        &mut self,
        p: &RequestPrincipal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<d::Record> {
        let mut store = self
            .store
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
            .store
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
    audits: OnceCell<Vec<s::Audit>>,
}
impl HistoryAuthorization<'_, '_> {
    fn expected_calls(&self) -> u8 {
        // Storage rechecks after the read transaction, and additionally around
        // inserting a continuation cursor. Retain each exact output frame.
        if self
            .witness
            .history
            .get()
            .is_some_and(|result| result["data"]["nextCursor"].is_string())
        {
            5
        } else {
            3
        }
    }
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
        let limit = if self.phase.get() == 2 {
            self.expected_calls()
        } else {
            2
        };
        if calls >= limit {
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
                self.audits
                    .set(frame.audits.to_vec())
                    .map_err(|_| s::Error::new("unavailable", "Stock history audits changed"))?;
                self.phase.set(2);
            }
            Some(result)
                if self.phase.get() == 2
                    && (3..=self.expected_calls()).contains(&self.read_calls.get())
                    && result.children.is_empty()
                    && self.witness.history.get() == Some(&result.wire)
                    && self.audits.get().map(Vec::as_slice) == Some(frame.audits) => {}
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
struct NativeQueries<'a, 'p> {
    store: &'a Mutex<Store>,
    access: &'a Access,
    contracts: st::NativeStockContract,
    list_pages: &'a st::AtlasListPages,
    list_binding: st::AtlasListBinding<'p>,
}
impl<'p> st::StockQueryPort<RequestPrincipal, Witness<'p>, Graph> for NativeQueries<'_, '_> {
    fn query(
        &mut self,
        p: &RequestPrincipal,
        prepared: &st::PreparedRequest<Witness<'p>, Graph>,
    ) -> st::StockResult<st::OwnerResult> {
        st::StockQueryPort::query(
            &mut st::AtlasReads::new(
                LockedReads {
                    store: self.store,
                    access: self.access,
                    witness: prepared.witness(),
                    request: prepared.request(),
                },
                self.contracts.clone(),
            )
            .with_list_pages(self.list_pages.clone(), self.list_binding.clone(), p),
            p,
            prepared,
        )
    }
}
impl st::StockHistoryPort<RequestPrincipal> for LockedReads<'_, '_> {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        p: &RequestPrincipal,
        contracts: &C,
        request: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        if request.raw() != self.request.raw() || !std::ptr::eq(p, self.witness.principal) {
            return Err(changed());
        }
        let scope = serde_json::from_value(
            serde_json::to_value(request.context()).map_err(|_| unavailable())?,
        )
        .map_err(|_| unavailable())?;
        let target=serde_json::from_value(json!({"recordType":request.target()["recordType"],"recordId":request.target()["recordId"]})).map_err(|_|unavailable())?;
        let authorization = HistoryAuthorization {
            witness: self.witness,
            access: self.access,
            request,
            scope,
            target,
            read_calls: Cell::new(0),
            phase: Cell::new(0),
            audits: OnceCell::new(),
        };
        let mut store = self.store.lock().map_err(|_| unavailable())?;
        let result = store
            .stock_history_json_with_authorization(&authorization, p, contracts, request.raw())
            .map_err(|e| st::StockError::Domain(crate::app::storage_error(e)))?;
        if authorization.read_calls.get() != authorization.expected_calls()
            || authorization.phase.get() != 2
            || !result.children.is_empty()
            || self.witness.history.get() != Some(&result.wire)
        {
            return Err(changed());
        }
        // Mark only after the actual cursor/history transaction has committed.
        self.witness.history_committed.set(true);
        Ok(result)
    }
}
pub(super) fn execute_raw(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
) -> st::StockResult<st::OwnerResult> {
    execute_raw_qualified(core, p, raw, contracts, None)
}

pub(super) fn execute_raw_qualified(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
    handles: Option<&st::AtlasDownloadHandles>,
) -> st::StockResult<st::OwnerResult> {
    execute_raw_with_snapshot(core, p, raw, contracts, handles, false).map(|result| result.owner)
}

/// HTTP-only correlation from the original prepared graph, never authority.
pub(super) struct QualifiedResult {
    pub owner: st::OwnerResult,
    pub snapshot_sha256: Option<String>,
}

impl From<st::OwnerResult> for QualifiedResult {
    fn from(owner: st::OwnerResult) -> Self {
        Self {
            owner,
            snapshot_sha256: None,
        }
    }
}

pub(super) fn qualified_response(result: QualifiedResult) -> HttpResult {
    let mut response = json_response(result.owner.wire);
    if let Some(digest) = result.snapshot_sha256 {
        response.headers_mut().insert(
            "x-atlas-snapshot-sha256",
            axum::http::HeaderValue::from_str(&digest).map_err(|_| http_error(unavailable()))?,
        );
    }
    Ok(response)
}

pub(super) fn execute_raw_with_snapshot(
    core: &Core,
    p: &RequestPrincipal,
    raw: Value,
    contracts: &st::NativeStockContract,
    handles: Option<&st::AtlasDownloadHandles>,
    http_snapshot: bool,
) -> st::StockResult<QualifiedResult> {
    let list_binding = {
        let access = core.access.lock().map_err(|_| unavailable())?;
        p.release(&access).map_err(|_| changed())?;
        st::AtlasListBinding::capture(&access, p.principal.principal())?
    };
    let authority = Authority {
        principal: p,
        access: &core.access,
        store: &core.store,
        list_pages: &core.atlas_list_pages,
        list_binding: list_binding.clone(),
        vault: &core.vault,
        download_handles: handles,
    };
    let prepared = st::prepare(p, raw, contracts, &authority, &mut Preparer(&core.store))?;
    // Only a qualified HTTP Host supplies the cache also used by redemption.
    let mut queries = crate::transports::mcp::NativeQueries::new(
        NativeQueries {
            store: &core.store,
            access: &core.access,
            contracts: contracts.clone(),
            list_pages: &core.atlas_list_pages,
            list_binding,
        },
        super::stock_downloads::Downloads::for_core(core, handles),
    )?;
    let owner = st::dispatch_prepared(
        p,
        &prepared,
        contracts,
        &authority,
        &mut queries,
        &mut CommandsUnavailable,
    )?;
    let snapshot_sha256 =
        if http_snapshot && st::atlas_list_record_type(prepared.request().id()).is_some() {
            // Hash the same complete original graph only after disclosure,
            // recomputation and final current-Storage checks have succeeded.
            Some(snapshot_content_digest(
                prepared.request().context(),
                &prepared.graph().0,
            )?)
        } else {
            None
        };
    Ok(QualifiedResult {
        owner,
        snapshot_sha256,
    })
}
pub(super) fn http_error(error: st::StockError) -> super::HttpFailure {
    match error {
        st::StockError::Domain(error) => domain_error(error),
        st::StockError::InvalidContract => domain_error(d::DomainError::InvalidContract),
        st::StockError::AuthorityChanged => domain_error(d::DomainError::Forbidden),
        _ => failure(StatusCode::SERVICE_UNAVAILABLE),
    }
}
fn list_payload(uri: &Uri) -> Result<Value, super::HttpFailure> {
    let invalid = || failure(StatusCode::UNPROCESSABLE_ENTITY);
    let mut payload = json!({"pageSize":50,"cursor":null,"includeArchived":false});
    let Some(query) = uri.query() else {
        return Ok(payload);
    };
    // Bound transport intake before decoding. Owner validation remains the
    // authority for the exact stock query and its Unicode scalar limits.
    if query.len() > 16_384 {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let mut seen = std::collections::BTreeSet::new();
    for field in query.split('&') {
        let (name, encoded) = field.split_once('=').ok_or_else(invalid)?;
        if !matches!(name, "pageSize" | "cursor" | "includeArchived" | "q") || !seen.insert(name) {
            return Err(invalid());
        }
        let bytes = encoded.as_bytes();
        for (index, byte) in bytes.iter().enumerate() {
            if *byte == b'%'
                && !bytes
                    .get(index + 1..index + 3)
                    .is_some_and(|pair| pair.iter().all(u8::is_ascii_hexdigit))
            {
                return Err(invalid());
            }
        }
        let encoded = encoded.replace('+', " ");
        let value = percent_encoding::percent_decode_str(&encoded)
            .decode_utf8()
            .map_err(|_| invalid())?;
        payload[name] = match name {
            "pageSize" => json!(value.parse::<u64>().map_err(|_| invalid())?),
            "includeArchived" => match value.as_ref() {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                _ => return Err(invalid()),
            },
            _ => Value::String(value.into_owned()),
        };
    }
    Ok(payload)
}
pub(super) async fn list(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(&host, &headers, &uri, &method,
            Some(d::Scope { workspace_id, home_id }), false, |core, p, home| {
                let contracts = st::NativeStockContract::new().map_err(http_error)?;
                let raw = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.list"),
                    "requestId":crate::app::new_id().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    "context":home.scope,"target":{"authority":"atlas","recordType":kind},
                    "payload":list_payload(&uri)?});
                let request = st::ValidatedRequest::parse(&contracts, raw.clone()).map_err(http_error)?;
                if st::atlas_list_record_type(request.id()).is_none() {
                    return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
                }
                let result = execute_raw_with_snapshot(core, p, raw, &contracts, None, true).map_err(http_error)?;
                qualified_response(result)
            })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
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
            let result=execute_raw(core,p,raw,&contracts).map_err(http_error)?;
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
            let result=execute_raw(core,p,raw,&contracts).map_err(http_error)?;
            Ok(json_response(result.wire))
        })
    }).await.map_err(|_|failure(StatusCode::SERVICE_UNAVAILABLE))?
}
