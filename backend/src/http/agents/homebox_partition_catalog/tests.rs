//! Generated in-process admission fixtures; no listener or provider calls.
use super::*;
use crate::{
    access as a,
    app::{Core, ReadAuthority, ServerRuntime},
    http::{contracts::NativeContracts, router},
    media::{AssetVault, native::NativeMediaRuntime},
    storage as s,
};
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::Request,
    response::Response,
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    net::SocketAddr,
    os::unix::fs::PermissionsExt,
    sync::{Arc, Mutex, atomic::{AtomicBool, AtomicI64, Ordering}},
};
use tower::ServiceExt;

const ORIGIN: &str = "https://catalog.synthetic.invalid";
const NOW: i64 = 1_800_000_000_000;
fn id(n: u32) -> a::CanonicalId {
    a::CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
}

struct Fixture {
    _temporary: tempfile::TempDir,
    host: Host,
    cookie: String,
    access_path: std::path::PathBuf,
    native_path: std::path::PathBuf,
    clock: Arc<AtomicI64>,
    path: String,
}

impl Fixture {
    fn new() -> Self { Self::with_request_limit(300) }

    fn with_request_limit(request_limit: u32) -> Self {
        let temporary = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700)).tempdir().unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap();
        let access_path = root.join("access.sqlite");
        let native_path = root.join("atlas.sqlite");
        let clock = Arc::new(AtomicI64::new(NOW));
        let observed_clock = clock.clone();
        let mut access = a::AccessBoundary::open(
            &access_path,
            a::AccessConfig::new(vec![ORIGIN.into()]).unwrap()
                .with_limits(a::AccessLimits { request_limit, ..a::AccessLimits::default() }).unwrap()
                .with_clock(move || observed_clock.load(Ordering::Relaxed)),
        ).unwrap();
        let scope = a::Scope { workspace_id: id(1), home_id: id(2) };
        access.provision_user(
            &id(3), &id(4), "synthetic-reader",
            &a::hash_password("Synthetic-catalog-password-only!").unwrap(), None,
        ).unwrap();
        access.set_membership(&id(3), &scope, a::Role::Viewer, true).unwrap();
        let receipt = access.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: "https://catalog.synthetic.invalid/api/atlas/auth/login",
                origin: Some(ORIGIN), sec_fetch_site: Some("same-origin"),
                referer: None, cookie: None, authorization: None, csrf: None,
            },
            &serde_json::to_vec(&json!({
                "username":"synthetic-reader","password":"Synthetic-catalog-password-only!"
            })).unwrap(),
            "synthetic-catalog",
        ).unwrap();
        let cookie = receipt.set_cookie().split(';').next().unwrap().to_owned();
        let access = Arc::new(Mutex::new(access));
        let vault = Arc::new(AssetVault::open(&root.join("vault")).unwrap());
        let store = s::AtlasStore::open(
            &native_path, NativeContracts, ReadAuthority(access.clone()),
            NativeMediaRuntime { vault: vault.clone(), server: ServerRuntime },
            s::StoreOptions::default(),
        ).unwrap();
        let home = d::HomeSummary {
            scope: d::Scope {
                workspace_id: scope.workspace_id.as_str().into(),
                home_id: scope.home_id.as_str().into(),
            },
            label: "Synthetic home".into(),
        };
        let host = Host::new(Core {
            access, store: Arc::new(Mutex::new(store)),
            atlas_list_pages: d::stock::AtlasListPages::default(),
            media_policy_evidence: Mutex::default(), vault,
            home: home.clone(), homes: vec![home],
        }, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![]).unwrap();
        Self {
            _temporary: temporary, host, cookie, access_path, native_path, clock,
            path: format!("/api/atlas/stock/v3/workspaces/{}/homes/{}/admission", id(1).as_str(), id(2).as_str()),
        }
    }

    fn register(&self, n: u32, collection: &str) {
        let registration = a::SourceRegistration {
            workspace_id: id(1), home_id: id(2), source_instance_id: id(n),
            collection_id: collection.into(), owner: a::SourceOwner::Homebox,
            partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
            allowed_external_ids: vec![id(99).as_str().into()],
        };
        let core = self.host.core.try_lock().unwrap();
        core.access.try_lock().unwrap().put_source(&registration, None).unwrap();
        // Explicit fixture preparation in this disposable database only.
        // No generation, inventory, projection or provider binding is created.
        Connection::open(&self.native_path).unwrap().execute(
            "INSERT INTO sources VALUES(?1,?2,?3,?4,?5)",
            params![registration.workspace_id.as_str(), registration.home_id.as_str(),
                registration.source_instance_id.as_str(), collection,
                serde_json::to_string(&registration).unwrap()],
        ).unwrap();
    }

    fn bookkeeping(&self) -> (i64, i64) {
        let db = Connection::open(&self.access_path).unwrap();
        (db.query_row("SELECT coalesce(sum(count),0) FROM access_rates", [], |r| r.get(0)).unwrap(),
         db.query_row("SELECT max(last_seen) FROM access_sessions", [], |r| r.get(0)).unwrap())
    }

    async fn get(&self, query: &str, cookie: bool) -> Response {
        let mut request = Request::builder().method("GET")
            .uri(format!("{}{}", self.path, query))
            .header("host", "catalog.synthetic.invalid")
            .header("origin", ORIGIN).header("sec-fetch-site", "same-origin");
        if cookie { request = request.header("cookie", &self.cookie); }
        let mut request = request.body(Body::empty()).unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
        ));
        router(self.host.clone()).oneshot(request).await.unwrap()
    }
}

#[tokio::test]
async fn exact_view_discovers_never_published_opaque_partition_and_preserves_admission() {
    let f = Fixture::new();
    f.register(8, "Synthetic / α + %");
    let ordinary = f.get("", true).await;
    assert_eq!(ordinary.status(), StatusCode::OK);
    let before: Value = serde_json::from_slice(&to_bytes(ordinary.into_body(), 262_144).await.unwrap()).unwrap();
    let bookkeeping = f.bookkeeping();
    f.clock.store(NOW + 1000, Ordering::Relaxed);
    let response = f.get(&format!("?{QUERY}"), true).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    assert_eq!(response.headers()[header::CACHE_CONTROL], "private, no-store");
    let value: Value = serde_json::from_slice(&to_bytes(response.into_body(), b::MAX_RESPONSE_BYTES).await.unwrap()).unwrap();
    assert_eq!(value, json!({
        "schemaVersion":1,"scope":{"workspaceId":id(1).as_str(),"homeId":id(2).as_str()},
        "partitions":[{"owner":"homebox","sourceInstanceId":id(8).as_str(),"collectionId":"Synthetic / α + %"}]
    }));
    assert_eq!(f.bookkeeping(), (bookkeeping.0 + 1, NOW + 1000));
    let response = f.get("", true).await;
    let after: Value = serde_json::from_slice(&to_bytes(response.into_body(), 262_144).await.unwrap()).unwrap();
    assert_eq!(before, after);
}

#[tokio::test]
async fn query_aliases_and_missing_authentication_release_no_catalog() {
    let f = Fixture::new();
    let before = f.bookkeeping();
    for query in [
        "?", "?view=homebox-cached-partitions-v1&extra=1",
        "?view=homebox-cached-partitions-v1&view=homebox-cached-partitions-v1",
        "?view=homebox%2Dcached-partitions-v1", "?view=other",
    ] {
        assert_eq!(f.get(query, true).await.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(f.bookkeeping(), before);
    assert_eq!(f.get(&format!("?{QUERY}"), false).await.status(), StatusCode::UNAUTHORIZED);
    let other_scope = f.path.replace(id(2).as_str(), id(7).as_str());
    let request = Request::builder().method("GET").uri(format!("{other_scope}?{QUERY}"))
        .header("host", "catalog.synthetic.invalid").header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin").header("cookie", &f.cookie)
        .body(Body::empty()).unwrap();
    // Direct handler fixture uses the same selected-home issuer below; other
    // scope membership cannot be fabricated from a home label or caller IDs.
    let mut request = request;
    request.extensions_mut().insert(ConnectInfo("127.0.0.1:50123".parse::<SocketAddr>().unwrap()));
    assert_eq!(router(f.host.clone()).oneshot(request).await.unwrap().status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn catalog_overflow_keeps_committed_authentication_bookkeeping() {
    let f = Fixture::new();
    for n in 8..17 { f.register(n, "Synthetic collection"); }
    let before = f.bookkeeping();
    f.clock.store(NOW + 2000, Ordering::Relaxed);
    let response = f.get(&format!("?{QUERY}"), true).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 16_384).await.unwrap();
    let value: Value = serde_json::from_slice(&body).unwrap();
    assert!(value.get("partitions").is_none());
    assert_eq!(f.bookkeeping(), (before.0 + 1, NOW + 2000));
    // Cleanup left the original owners usable by ordinary admission.
    assert_eq!(f.get("", true).await.status(), StatusCode::OK);
}

#[test]
fn cancelled_worker_begins_no_authentication_and_preserves_original_owners() {
    let f = Fixture::new();
    let budget = b::Budget::start();
    budget.cancel();
    let issued = AtomicBool::new(false);
    let before = f.bookkeeping();
    let result = homebox_partition_catalog::read_with_issuance(
        f.host.core.clone(), &budget, |_, _| {
            issued.store(true, Ordering::Relaxed);
            Err(a::AccessError::Unavailable)
        },
    );
    assert!(result.is_err());
    assert!(!issued.load(Ordering::Relaxed));
    assert_eq!(f.bookkeeping(), before);
    assert!(!f.host.core.is_poisoned());
}

#[tokio::test]
async fn scoped_read_issuance_preserves_request_rate_refusal() {
    let f = Fixture::with_request_limit(1);
    assert_eq!(f.get(&format!("?{QUERY}"), true).await.status(), StatusCode::OK);
    let before = f.bookkeeping();
    let response = f.get(&format!("?{QUERY}"), true).await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let value: Value = serde_json::from_slice(&to_bytes(response.into_body(), 16_384).await.unwrap()).unwrap();
    assert!(value.get("partitions").is_none());
    assert_eq!(f.bookkeeping(), before);
}
