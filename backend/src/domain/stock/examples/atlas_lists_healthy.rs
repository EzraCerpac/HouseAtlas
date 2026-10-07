//! Positive local list examples using actual AT11 sessions and grants, AT07
//! SQLite, AT51 schemas and native semantics. The exact fixture graph authority
//! below is synthetic qualification, not the production transport authority.
//! No listeners, providers, denial/replay/fault/concurrency or held controls.
use houseatlas_backend::{
    access as a,
    domain::{
        self as d, native_semantics::NativeSemantics, native_storage::NativeStorage, stock as st,
    },
    storage as s,
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::{Path, PathBuf},
};
type Check<T = ()> = Result<T, Box<dyn std::error::Error>>;
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn evidence(cookie: Option<&str>) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method: a::Method::Get,
        url: "https://atlas.synthetic.invalid/api/atlas/stock/v3/list",
        origin: None,
        sec_fetch_site: Some("same-origin"),
        referer: Some("https://atlas.synthetic.invalid/"),
        cookie,
        authorization: None,
        csrf: None,
    }
}
fn validate_access(
    access: &a::AccessBoundary,
    captured: &st::CapturedAccess<'_>,
    principal: &a::Principal,
) -> a::AccessResult<()> {
    assert!(std::ptr::eq(principal, captured.principal()));
    access.revalidate(principal)?;
    for grant in captured.source_grants() {
        access.revalidate_source(grant)?;
    }
    for grant in captured.partition_grants() {
        access.revalidate_source_partition(grant)?;
    }
    Ok(())
}
struct AuthorizedStore<'a, 'p> {
    access: &'a a::AccessBoundary,
    captured: &'a st::CapturedAccess<'p>,
}
impl s::Authorization for AuthorizedStore<'_, '_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let check = || -> a::AccessResult<()> {
            validate_access(self.access, self.captured, principal)?;
            let scope = serde_json::from_value(
                serde_json::to_value(request.scope).map_err(|_| a::AccessError::Unavailable)?,
            )
            .map_err(|_| a::AccessError::Unavailable)?;
            self.access
                .authorize_storage(principal, &scope, a::Capability::Read)?;
            assert!(matches!(
                request.capability,
                s::Capability::Read | s::Capability::ReadCache
            ));
            assert!(request.mutation.is_none());
            if let Some(reference) = request.source {
                let reference: a::SourceRef = serde_json::from_value(reference.clone())
                    .map_err(|_| a::AccessError::Unavailable)?;
                assert!(
                    self.captured
                        .source_grants()
                        .iter()
                        .any(|g| g.reference() == &reference)
                );
            }
            if let Some(partition) = request.source_partition {
                let partition: a::SourcePartition = serde_json::from_value(
                    serde_json::to_value(partition).map_err(|_| a::AccessError::Unavailable)?,
                )
                .map_err(|_| a::AccessError::Unavailable)?;
                assert!(
                    self.captured
                        .partition_grants()
                        .iter()
                        .any(|g| g.partition() == &partition)
                );
            }
            Ok(())
        };
        check().map_err(|e| s::Error::new(e.code(), "Synthetic list access check"))?;
        Ok(s::VerifiedActor {
            actor_id: principal.actor_id().as_str().into(),
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
        })
    }
}
struct FixtureRuntime;
impl s::Runtime for FixtureRuntime {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-07T12:00:00Z".into())
    }
    fn new_id(&self) -> s::Result<String> {
        Err(s::Error::new(
            "upstream-unavailable",
            "Read-only fixture runtime",
        ))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "Published missing asset, no byte peer",
        ))
    }
}
type Store<'a, 'p> =
    s::AtlasStore<s::NativeContract<NativeSemantics>, AuthorizedStore<'a, 'p>, FixtureRuntime>;
struct Reads<'q, 'a, 'p> {
    store: &'q RefCell<Store<'a, 'p>>,
    native: &'q s::NativeContract<NativeSemantics>,
}
impl d::ReadPort<a::Principal> for Reads<'_, '_, '_> {
    fn snapshot(&mut self, p: &a::Principal, scope: &d::Scope) -> d::DomainResult<d::Snapshot> {
        NativeStorage::from_store(&mut self.store.borrow_mut(), self.native).snapshot(p, scope)
    }
    fn record(
        &mut self,
        p: &a::Principal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<d::Record> {
        NativeStorage::from_store(&mut self.store.borrow_mut(), self.native)
            .record(p, scope, target)
    }
    fn history(
        &mut self,
        p: &a::Principal,
        scope: &d::Scope,
        target: &d::RecordRef,
    ) -> d::DomainResult<Vec<d::Audit>> {
        NativeStorage::from_store(&mut self.store.borrow_mut(), self.native)
            .history(p, scope, target)
    }
}
impl st::StockHistoryPort<a::Principal> for Reads<'_, '_, '_> {
    fn stock_history<C: st::StockContractPort>(
        &mut self,
        _: &a::Principal,
        _: &C,
        _: &st::ValidatedRequest,
    ) -> st::StockResult<st::OwnerResult> {
        Err(st::StockError::OwnerUnavailable)
    }
}
struct Witness {
    raw: Value,
    digest: String,
}
struct Authority<'q, 'a, 'p> {
    access: &'a a::AccessBoundary,
    captured: &'a st::CapturedAccess<'p>,
    store: &'q RefCell<Store<'a, 'p>>,
    native: &'q s::NativeContract<NativeSemantics>,
    pages: st::AtlasListPages,
    binding: st::AtlasListBinding,
    released_rows: Cell<usize>,
    released_results: Cell<usize>,
}
fn scope(request: &st::ValidatedRequest) -> d::Scope {
    d::Scope {
        workspace_id: request.context().workspace_id.clone(),
        home_id: request.context().home_id.clone(),
    }
}
impl Authority<'_, '_, '_> {
    fn original(&self, p: &a::Principal, request: &st::ValidatedRequest) -> st::StockResult<()> {
        validate_access(self.access, self.captured, p)
            .map_err(|_| st::StockError::AuthorityChanged)?;
        let scope: a::Scope = serde_json::from_value(
            serde_json::to_value(scope(request)).map_err(|_| st::StockError::InvalidContract)?,
        )
        .map_err(|_| st::StockError::InvalidContract)?;
        self.access
            .authorize_storage(p, &scope, a::Capability::Read)
            .map_err(|_| st::StockError::AuthorityChanged)?;
        assert!(st::atlas_list_record_type(request.id()).is_some());
        Ok(())
    }
}
impl st::StockAuthorityPort<a::Principal> for Authority<'_, '_, '_> {
    type Witness = Witness;
    type Graph = d::Snapshot;
    fn capture(&self, p: &a::Principal, r: &st::ValidatedRequest) -> st::StockResult<Witness> {
        self.original(p, r)?;
        Ok(Witness {
            raw: r.raw().clone(),
            digest: r.intent_digest().into(),
        })
    }
    fn authorize_graph(
        &self,
        p: &a::Principal,
        w: &Witness,
        r: &st::ValidatedRequest,
        graph: &d::Snapshot,
    ) -> st::StockResult<()> {
        self.revalidate(p, w, r)?;
        assert!(graph.records.iter().all(|record| record.scope == scope(r)));
        Ok(())
    }
    fn revalidate(
        &self,
        p: &a::Principal,
        w: &Witness,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        self.original(p, r)?;
        assert_eq!(w.raw, *r.raw());
        assert_eq!(w.digest, r.intent_digest());
        Ok(())
    }
    fn authorize_result(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Witness, d::Snapshot>,
        r: &st::ValidatedRequest,
        result: &Value,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), r)?;
        let current = d::ReadPort::snapshot(
            &mut Reads {
                store: self.store,
                native: self.native,
            },
            p,
            &scope(r),
        )
        .map_err(st::StockError::Domain)?;
        assert_eq!(
            serde_json::to_value(&current).unwrap(),
            serde_json::to_value(prepared.graph()).unwrap()
        );
        let mut owner = st::AtlasReads::new(
            Reads {
                store: self.store,
                native: self.native,
            },
            st::NativeStockContract::new()?,
        )
        .with_list_pages(self.pages.clone(), self.binding.clone(), p);
        let expected = st::StockQueryPort::query(&mut owner, p, prepared)?;
        assert_eq!(&expected.wire, result);
        self.released_results.set(self.released_results.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        p: &a::Principal,
        prepared: &st::PreparedRequest<Witness, d::Snapshot>,
        r: &st::ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), r)?;
        assert_eq!(purpose, st::DisclosurePurpose::ScopedPage);
        assert_eq!(target["authority"], "atlas");
        assert_eq!(target["recordType"], r.target()["recordType"]);
        let record = prepared
            .graph()
            .records
            .iter()
            .find(|record| {
                record.scope == scope(r)
                    && target["recordId"] == record.target.record_id
                    && serde_json::to_value(record.target.record_type).unwrap()
                        == target["recordType"]
            })
            .unwrap();
        assert_eq!(row["revision"], record.revision);
        assert_eq!(
            row["lifecycle"],
            serde_json::to_value(record.lifecycle).unwrap()
        );
        let mut payload = record.payload.clone();
        if record.target.record_type == d::RecordType::Asset {
            payload.as_object_mut().unwrap().remove("storageKey");
        }
        assert_eq!(row["payload"], payload);
        self.released_rows.set(self.released_rows.get() + 1);
        Ok(())
    }
}
struct Preparer<'q, 'a, 'p> {
    reads: Reads<'q, 'a, 'p>,
}
impl st::StockPreparerPort<a::Principal, Witness> for Preparer<'_, '_, '_> {
    type Graph = d::Snapshot;
    fn resolve(
        &mut self,
        p: &a::Principal,
        w: &Witness,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<d::Snapshot> {
        assert_eq!(w.raw, *r.raw());
        d::ReadPort::snapshot(&mut self.reads, p, &scope(r)).map_err(st::StockError::Domain)
    }
}
struct NoCommands;
impl<W, G> st::StockCommandPort<a::Principal, W, G> for NoCommands {
    fn execute(
        &mut self,
        _: &a::Principal,
        _: &st::PreparedRequest<W, G>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(st::StockError::OwnerUnavailable)
    }
}
fn query(authority: &Authority<'_, '_, '_>, kind: &str, n: u64, payload: Value) -> Check<Value> {
    let p = authority.captured.principal();
    let contracts = st::NativeStockContract::new()?;
    let raw = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.list"),"requestId":id(n),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":kind},"payload":payload});
    let prepared = st::prepare(
        p,
        raw,
        &contracts,
        authority,
        &mut Preparer {
            reads: Reads {
                store: authority.store,
                native: authority.native,
            },
        },
    )?;
    let mut reads = st::AtlasReads::new(
        Reads {
            store: authority.store,
            native: authority.native,
        },
        contracts.clone(),
    )
    .with_list_pages(authority.pages.clone(), authority.binding.clone(), p);
    Ok(st::dispatch(
        p,
        prepared,
        &contracts,
        authority,
        &mut reads,
        &mut NoCommands,
    )?
    .wire)
}
// Gather only this published fixture's exact source references, never grants.
fn refs(snapshot: &s::Snapshot) -> Check<(Vec<a::SourceRef>, Vec<a::SourcePartition>)> {
    let mut references = Vec::new();
    fn scan(value: &Value, references: &mut Vec<a::SourceRef>) -> Check {
        if value.get("workspaceId").is_some()
            && value.get("homeId").is_some()
            && value.get("key").is_some()
        {
            let reference: a::SourceRef = serde_json::from_value(value.clone())?;
            if !references.contains(&reference) {
                references.push(reference);
            }
        }
        match value {
            Value::Array(values) => {
                for value in values {
                    scan(value, references)?;
                }
            }
            Value::Object(values) => {
                for value in values.values() {
                    scan(value, references)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    for record in &snapshot.records {
        scan(&record.payload, &mut references)?;
        if record.record_type == s::RecordType::Binding {
            scan(
                &json!({"workspaceId":record.workspace_id,"homeId":record.home_id,"key":record.payload["source"]}),
                &mut references,
            )?;
        }
    }
    for row in &snapshot.homebox_entities {
        scan(
            &json!({"workspaceId":row["workspaceId"],"homeId":row["homeId"],"key":row["source"]}),
            &mut references,
        )?;
        scan(row, &mut references)?;
        if let Some(parent) = row["entity"]["parent"]["id"].as_str() {
            let mut key = row["source"].clone();
            key["externalId"] = json!(parent);
            scan(
                &json!({"workspaceId":row["workspaceId"],"homeId":row["homeId"],"key":key}),
                &mut references,
            )?;
        }
    }
    for row in &snapshot.network_relations {
        let base = json!({"sourceInstanceId":row["sourceInstanceId"],"collectionId":row["collectionId"],
            "sourceKind":"network-segment","externalId":row["externalId"]});
        scan(
            &json!({"workspaceId":row["workspaceId"],"homeId":row["homeId"],"key":base}),
            &mut references,
        )?;
        for endpoint in [&row["from"], &row["to"]] {
            if endpoint["kind"] != "unresolved" {
                let mut key = base.clone();
                key["sourceKind"] =
                    json!(format!("network-{}", endpoint["kind"].as_str().unwrap()));
                key["externalId"] = endpoint["id"].clone();
                scan(
                    &json!({"workspaceId":row["workspaceId"],"homeId":row["homeId"],"key":key}),
                    &mut references,
                )?;
            }
        }
    }
    let partitions = snapshot
        .sources
        .iter()
        .map(|source| {
            serde_json::from_value(json!({
                "workspaceId":source["workspaceId"], "homeId":source["homeId"],
                "sourceInstanceId":source["sourceInstanceId"], "collectionId":source["collectionId"]
            }))
        })
        .collect::<Result<_, _>>()?;
    Ok((references, partitions))
}
fn run(root: &Path, out: &Path, name: &str, extra_circuits: bool) -> Check<Value> {
    let mut snapshot: s::Snapshot = serde_json::from_slice(&fs::read(
        root.join(format!("packages/contracts/fixtures/{name}.snapshot.json")),
    )?)?;
    snapshot.records.retain(|r| r.home_id == id(2));
    snapshot.sources.retain(|r| r["homeId"] == id(2));
    snapshot.homebox_entities.retain(|r| r["homeId"] == id(2));
    snapshot.caches.retain(|r| r["homeId"] == id(2));
    snapshot.network_relations.retain(|r| r["homeId"] == id(2));
    if extra_circuits {
        let circuit = snapshot
            .records
            .iter()
            .find(|r| r.record_type == s::RecordType::Circuit)
            .unwrap()
            .clone();
        for (n, lifecycle) in [(410, s::Lifecycle::Active), (411, s::Lifecycle::Tombstoned)] {
            let mut extra = circuit.clone();
            extra.record_id = id(n);
            extra.last_audit_id = id(10_000 + n);
            extra.lifecycle = lifecycle;
            extra.payload["label"] = json!(format!("Synthetic additional circuit {n}"));
            snapshot.records.push(extra);
        }
    }
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
            .with_clock(|| 1_800_000_000_000),
    )?;
    for source in &snapshot.sources {
        access.put_source(&serde_json::from_value(source.clone())?, Some(true))?;
    }
    let canonical = |n| a::CanonicalId::parse(id(n));
    let password = "Synthetic-list-password-only!";
    access.provision_user(
        &canonical(50)?,
        &canonical(51)?,
        "synthetic-reader",
        &a::hash_password(password)?,
        None,
    )?;
    let scope: a::Scope = serde_json::from_value(json!({"workspaceId":id(1),"homeId":id(2)}))?;
    access.set_membership(&canonical(50)?, &scope, a::Role::Viewer, true)?;
    let session = access.login(
        &a::RequestEvidence {
            method: a::Method::Post,
            origin: Some("https://atlas.synthetic.invalid"),
            ..evidence(None)
        },
        &serde_json::to_vec(&json!({"username":"synthetic-reader","password":password}))?,
        "synthetic-local",
    )?;
    let cookie = session.set_cookie().split(';').next().unwrap().to_owned();
    let principal = access.authorize(&evidence(Some(&cookie)), &scope, a::Action::Read)?;
    let (references, partitions) = refs(&snapshot)?;
    let captured = st::CapturedAccess::capture(&access, &principal, &references, &partitions)?;
    let native = s::NativeContract::new(NativeSemantics::native());
    let mut store = s::AtlasStore::open(
        out.join(format!("{name}.sqlite")),
        native.clone(),
        AuthorizedStore {
            access: &access,
            captured: &captured,
        },
        FixtureRuntime,
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..s::StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&snapshot)?;
    let store = RefCell::new(store);
    let authority = Authority {
        access: &access,
        captured: &captured,
        store: &store,
        native: &native,
        pages: st::AtlasListPages::default(),
        binding: st::AtlasListBinding::capture(&access, &principal, &cookie)?,
        released_rows: Cell::new(0),
        released_results: Cell::new(0),
    };
    let kinds = [
        "identity",
        "binding",
        "evidence",
        "location-semantics",
        "circuit",
        "valve",
        "relation",
        "geometry",
        "asset",
        "reconciliation",
    ];
    let mut lists = Vec::new();
    for (n, kind) in kinds.iter().enumerate() {
        let result = query(
            &authority,
            kind,
            220_000 + n as u64,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )?;
        let rows = result["data"]["records"].as_array().unwrap();
        let expected = snapshot
            .records
            .iter()
            .filter(|r| r.record_type.as_str() == *kind && r.lifecycle == s::Lifecycle::Active)
            .count();
        assert_eq!(rows.len(), expected);
        assert_eq!(result["data"]["nextCursor"], Value::Null);
        for row in rows {
            assert_eq!(row["target"]["recordType"], *kind);
            assert!(row["payload"].get("storageKey").is_none());
        }
        lists.push(result);
    }
    let mut extra = Vec::new();
    if extra_circuits {
        let first = query(
            &authority,
            "circuit",
            221_000,
            json!({"cursor":null,"pageSize":1.0,"includeArchived":false}),
        )?;
        assert_eq!(first["data"]["records"][0]["target"]["recordId"], id(401));
        let cursor = first["data"]["nextCursor"].as_str().unwrap();
        assert_eq!(cursor.len(), 43);
        let second = query(
            &authority,
            "circuit",
            221_001,
            json!({"cursor":cursor,"pageSize":1e0,"includeArchived":false}),
        )?;
        assert_eq!(second["data"]["records"][0]["target"]["recordId"], id(410));
        assert_eq!(second["data"]["nextCursor"], Value::Null);
        let archived = query(
            &authority,
            "circuit",
            221_002,
            json!({"cursor":null,"pageSize":100,"includeArchived":true}),
        )?;
        assert_eq!(archived["data"]["records"].as_array().unwrap().len(), 3);
        assert_eq!(archived["data"]["records"][2]["lifecycle"], "tombstoned");
        let search = query(
            &authority,
            "circuit",
            221_003,
            json!({"cursor":null,"pageSize":100,"includeArchived":false,"q":"ADDITIONAL 410"}),
        )?;
        assert_eq!(search["data"]["records"].as_array().unwrap().len(), 1);
        assert_eq!(search["data"]["records"][0]["target"]["recordId"], id(410));
        extra = vec![first, second, archived, search];
    }
    assert_eq!(authority.released_results.get(), lists.len() + extra.len());
    let proof = json!({"fixture":name,"lists":lists,"extraPositivePages":extra,
        "resultReleaseChecks":authority.released_results.get(),"rowReleaseChecks":authority.released_rows.get(),
        "capturedSourceGrants":captured.source_grants().len(),"capturedPartitionGrants":captured.partition_grants().len(),
        "principalRole":"viewer","nativeSchema":store.borrow().database_version()});
    drop(authority);
    store.into_inner().close()?;
    Ok(proof)
}
fn main() -> Check {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Published repository root required")?,
    );
    let out = PathBuf::from(
        std::env::args()
            .nth(2)
            .ok_or("NEW output directory required")?,
    );
    fs::create_dir(&out)?;
    let proofs = vec![
        run(&root, &out, "optional-geometry", true)?,
        run(&root, &out, "import-remap", false)?,
    ];
    fs::write(
        out.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&json!({"proofs":proofs,
        "actualPeers":["AT11 AccessBoundary sessions/Principal/source/partition grants","AT07 AtlasStore schema5",
            "AT51 NativeStockContract/frozen schema","NativeSemantics","NativeStorage","AtlasReads"],
        "fixturePeers":["exact synthetic snapshot StockAuthorityPort/StockPreparerPort","read-only fixture Runtime"],
        "unusedPeers":["stock history owner","commands","media bytes"],"tenListFamilies":true,
        "heldControlsExecuted":0,"providerCalls":0,"listeners":0,"mountedTransports":false,"productionAcceptance":false}))?,
    )?;
    println!(
        "PASS twenty catalog list reads; healthy continuation, archived inclusion and public search; actual SQLite/Access peers"
    );
    Ok(())
}
