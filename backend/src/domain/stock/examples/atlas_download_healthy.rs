//! Healthy local wire3 issue/disclose/redeem using genuine SQLite, Access,
//! NativeMediaStorage/NativeMediaAccess, vault and managed Media HEAD/GET.
//! Session equality uses AT11's actual normalized principal API. Stock
//! graph/disclosure peers are synthetic. No held controls execute.
use houseatlas_backend::{
    access as a,
    domain::{native_semantics::NativeSemantics, stock as st},
    media::{
        self as m,
        native::{
            NativeMediaAccess, NativeMediaRuntime, NativeMediaStorage, NativeReadAuthority,
            RetainedPrincipal,
        },
        service::{MediaService, ReadMethod},
        types::{AssetPurpose, AssetRecord, ContentType, Scope, SourceLicense},
    },
    storage as s,
};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
type Check<T = ()> = Result<T, Box<dyn std::error::Error>>;
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn budget() -> m::WorkBudget {
    m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default()).unwrap()
}
fn request(method: a::Method, cookie: Option<&str>) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock/v3/download",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}
struct Runtime;
impl s::Runtime for Runtime {
    fn now(&self) -> s::Result<String> {
        Ok("2026-02-01T12:00:00Z".into())
    }
    fn new_id(&self) -> s::Result<String> {
        Err(s::Error::new("upstream-unavailable", "Read-only fixture"))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "asset-unavailable",
            "Use actual NativeMediaRuntime",
        ))
    }
}
struct Preparer(AssetRecord);
impl st::StockPreparerPort<RetainedPrincipal, Value> for Preparer {
    type Graph = AssetRecord;
    fn resolve(
        &mut self,
        _: &RetainedPrincipal,
        w: &Value,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<AssetRecord> {
        assert_eq!(w, r.raw());
        Ok(self.0.clone())
    }
}
struct Authority<'a, V> {
    access: &'a Mutex<a::AccessBoundary>,
    original: &'a RetainedPrincipal,
    verify: V,
    results: Cell<u32>,
    rows: Cell<u32>,
}
impl<V> st::StockAuthorityPort<RetainedPrincipal> for Authority<'_, V>
where
    V: Fn(
        &RetainedPrincipal,
        &st::PreparedRequest<Value, AssetRecord>,
        &Value,
    ) -> st::StockResult<()>,
{
    type Witness = Value;
    type Graph = AssetRecord;
    fn capture(&self, p: &RetainedPrincipal, r: &st::ValidatedRequest) -> st::StockResult<Value> {
        self.revalidate(p, r.raw(), r)?;
        Ok(r.raw().clone())
    }
    fn revalidate(
        &self,
        p: &RetainedPrincipal,
        w: &Value,
        r: &st::ValidatedRequest,
    ) -> st::StockResult<()> {
        assert!(std::ptr::eq(p.principal(), self.original.principal()));
        assert_eq!(w, r.raw());
        assert_eq!(
            r.context().workspace_id,
            p.principal().scope().workspace_id.as_str()
        );
        assert_eq!(r.context().home_id, p.principal().scope().home_id.as_str());
        self.access
            .lock()
            .map_err(|_| st::StockError::OwnerUnavailable)?
            .revalidate(p.principal())
            .map_err(|_| st::StockError::AuthorityChanged)?;
        Ok(())
    }
    fn authorize_graph(
        &self,
        p: &RetainedPrincipal,
        w: &Value,
        r: &st::ValidatedRequest,
        g: &AssetRecord,
    ) -> st::StockResult<()> {
        self.revalidate(p, w, r)?;
        assert_eq!(r.target()["recordId"], g.record_id);
        Ok(())
    }
    fn authorize_result(
        &self,
        p: &RetainedPrincipal,
        prepared: &st::PreparedRequest<Value, AssetRecord>,
        r: &st::ValidatedRequest,
        wire: &Value,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), r)?;
        (self.verify)(p, prepared, &wire["data"])?;
        self.results.set(self.results.get() + 1);
        Ok(())
    }
    fn disclose(
        &self,
        p: &RetainedPrincipal,
        prepared: &st::PreparedRequest<Value, AssetRecord>,
        r: &st::ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: st::DisclosurePurpose,
    ) -> st::StockResult<()> {
        self.revalidate(p, prepared.witness(), r)?;
        assert_eq!(purpose, st::DisclosurePurpose::ExactTarget);
        assert_eq!(target, r.target());
        assert_eq!(row["target"], *target);
        assert_eq!(row["sha256"], prepared.graph().payload.sha256);
        assert_eq!(row["byteSize"], prepared.graph().payload.byte_size);
        self.rows.set(self.rows.get() + 1);
        Ok(())
    }
}
struct UnusedCommands;
impl st::StockCommandPort<RetainedPrincipal, Value, AssetRecord> for UnusedCommands {
    fn execute(
        &mut self,
        _: &RetainedPrincipal,
        _: &st::PreparedRequest<Value, AssetRecord>,
    ) -> st::StockResult<st::OwnerResult> {
        Err(st::StockError::OwnerUnavailable)
    }
}
fn main() -> Check {
    let repo = PathBuf::from(std::env::args().nth(1).ok_or("Repository root required")?);
    let out = PathBuf::from(
        std::env::args()
            .nth(2)
            .ok_or("NEW output directory required")?,
    );
    fs::create_dir(&out)?;
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let vault = Arc::new(m::AssetVault::open(&out.join("media"))?);
    let bytes = b"Healthy synthetic wire3 original download\n";
    let payload = vault
        .prepare_original(
            &scope,
            AssetPurpose::EvidenceOriginal,
            ContentType::Text,
            &mut bytes.as_slice(),
            &budget(),
        )?
        .with_provenance(
            SourceLicense {
                status: m::types::LicenseStatus::Unknown,
                reference: None,
            },
            vec![id(100)],
        )?;
    let record: AssetRecord =
        serde_json::from_value(json!({"schemaVersion":1,"recordType":"asset",
        "recordId":id(800_001),"workspaceId":id(1),"homeId":id(2),"revision":1,"lifecycle":"active",
        "createdAt":"2026-02-01T12:00:00Z","updatedAt":"2026-02-01T12:00:00Z",
        "lastAuditId":id(800_002),"payload":payload}))?;
    let mut snapshot: s::Snapshot = serde_json::from_slice(&fs::read(
        repo.join("packages/contracts/fixtures/optional-geometry.snapshot.json"),
    )?)?;
    snapshot
        .records
        .push(serde_json::from_value(json!(record))?);
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])?
            .with_clock(|| 1_800_000_000_000),
    )?;
    let canonical = |n| a::CanonicalId::parse(id(n));
    let password = "Synthetic-download-password-only!";
    access.provision_user(
        &canonical(50)?,
        &canonical(51)?,
        "synthetic-reader",
        &a::hash_password(password)?,
        None,
    )?;
    let a_scope: a::Scope = serde_json::from_value(json!(scope))?;
    access.set_membership(&canonical(50)?, &a_scope, a::Role::Viewer, true)?;
    let session = access.login(
        &request(a::Method::Post, None),
        &serde_json::to_vec(&json!({"username":"synthetic-reader","password":password}))?,
        "synthetic-local",
    )?;
    let cookie = session.set_cookie().split(';').next().unwrap();
    let access = Arc::new(Mutex::new(access));
    let native_access = NativeMediaAccess::new(access.clone());
    let principal =
        native_access.authorize_request(&request(a::Method::Get, Some(cookie)), &scope)?;
    let mut store = s::AtlasStore::open(
        out.join("atlas.sqlite"),
        s::NativeContract::new(NativeSemantics::native()),
        NativeReadAuthority(access.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: Runtime,
        },
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&snapshot)?;
    let store = Mutex::new(store);
    let storage = NativeMediaStorage::new(&store);
    let media = MediaService::new(&storage, &native_access, &vault);
    let sessions = access.as_ref();
    let contracts = st::NativeStockContract::new()?;
    let handles = st::AtlasDownloadHandles::default();
    let mut downloads =
        st::NativeAtlasAssetDownloads::new(&media, &storage, sessions, &contracts, handles.clone());
    let verifier =
        st::NativeAtlasAssetDownloads::new(&media, &storage, sessions, &contracts, handles);
    let authority = Authority {
        access: &access,
        original: &principal,
        verify: |p: &RetainedPrincipal,
                 prepared: &st::PreparedRequest<Value, AssetRecord>,
                 data: &Value| verifier.validate_issued(p, prepared, data),
        results: Cell::new(0),
        rows: Cell::new(0),
    };
    let raw = json!({"schemaVersion":3,"commandId":"atlas.asset.download","requestId":id(800_003),
        "context":scope,"target":{"authority":"atlas","recordType":"asset","recordId":record.record_id},"payload":{}});
    let prepared = st::prepare(
        &principal,
        raw.clone(),
        &contracts,
        &authority,
        &mut Preparer(record),
    )?;
    let output = st::dispatch_prepared(
        &principal,
        &prepared,
        &contracts,
        &authority,
        &mut downloads,
        &mut UnusedCommands,
    )?;
    let correlated = st::StockQueryPort::query(&mut downloads, &principal, &prepared)?;
    assert_eq!(correlated.wire, output.wire);
    let token = output.wire["data"]["downloadToken"].as_str().unwrap();
    let delivered = downloads.redeem(&principal, token, ReadMethod::Get, &budget())?;
    assert_eq!(delivered.status, 200);
    assert_eq!(delivered.body, bytes);
    assert!(
        delivered
            .headers
            .iter()
            .any(|(n, v)| *n == "content-disposition" && v.starts_with("attachment;"))
    );
    let head = downloads.redeem(&principal, token, ReadMethod::Head, &budget())?;
    assert!(head.body.is_empty());
    assert_eq!(head.status, 200);
    assert_eq!(authority.results.get(), 1);
    assert_eq!(authority.rows.get(), 1);
    let proof = json!({"result":output.wire,"samePreparedResultCorrelation":true,
        "downloadedBytes":bytes.len(),"getStatus":delivered.status,"headStatus":head.status,
        "resultReleaseChecks":authority.results.get(),"rowReleaseChecks":authority.rows.get(),
        "actualPeers":["AT11 Principal/AccessBoundary","AT07 SQLite","NativeMediaStorage","NativeMediaAccess",
            "AssetVault","MediaService HEAD/GET","AT51 exact stock/frozen contracts"],
        "fixturePeers":["stock graph/disclosure","runtime date"],
        "normalizedSessionQualified":true,"heldControlsExecuted":0,"providerCalls":0,"listeners":0,"mountedTransports":false});
    fs::write(
        out.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&proof)?,
    )?;
    println!(
        "PASS wire3 handle issue/disclose and managed GET/HEAD redemption; genuine AT11 normalized session binding"
    );
    Ok(())
}
