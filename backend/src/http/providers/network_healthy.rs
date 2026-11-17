//! Generated originals, genuine Access/Store grants and in-process router only.
use super::*;
use crate::{
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::providers::{
        network::NetworkSettings, network_host::NetworkBinding, registry::ProviderRegistry,
    },
    http::{contracts::NativeContracts, router},
    media::{AssetVault, native::NativeMediaRuntime},
    providers::network::observations::{
        Holder,
        tests::{AT, FakePeer},
    },
};
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::Request,
};
use n::{DurableNetworkSidecar, InventoryTransport};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::PermissionsExt,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tower::ServiceExt;
type Result<T> = std::result::Result<T, crate::lifecycle::Failure>;
const ORIGIN: &str = "https://127.0.0.1:48743";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
struct Capture {
    config: n::NetworkHttpConfig,
    bytes: Vec<u8>,
    calls: AtomicUsize,
}
impl InventoryTransport for Capture {
    fn get_inventory(
        &self,
        _: n::InventoryGet,
        _: n::Limits,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = n::Result<n::InventoryResponse>> + Send + '_>,
    > {
        panic!("Only the generated custodied setup capture is allowed")
    }
    fn get_inventory_with_custody(
        &self,
        _: n::InventoryGet,
        _: n::Limits,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = n::Result<n::CustodiedInventoryResponse>> + Send + '_>,
    > {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(n::CustodiedInventoryResponse::synthetic(
                &self.config,
                n::InventoryResponse {
                    status: 200,
                    source: Some(self.config.source().scope.clone()),
                    body: self.bytes.clone(),
                    source_snapshot_at: Some(AT.into()),
                    redirected: false,
                    location: None,
                    url: None,
                },
            ))
        })
    }
}
struct Fixture {
    _root: tempfile::TempDir,
    host: Host,
    cookie: String,
    csrf: String,
    peer: Arc<FakePeer>,
    holder: Arc<Holder>,
}
async fn fixture() -> Result<Fixture> {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let vault = Arc::new(AssetVault::open(&root.join("media"))?);
    let registration: s::SourceRegistration = serde_json::from_value(
        json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}),
    )?;
    let registry = ProviderRegistry::from_trusted_configuration(vec![registration.clone()])?;
    let settings = NetworkSettings::new(
        registry.sources()[0].clone(),
        "http://127.0.0.1:42001",
        serde_json::from_str(include_str!(
            "../../../../adapters/network/fixtures/link-review.json"
        ))?,
        n::Limits::default(),
        2000,
        2000,
        60000,
        &root,
    )?
    .with_collector_measurements(true);
    let mut wire: Value = serde_json::from_str(include_str!(
        "../../../../adapters/network/fixtures/inventory.wire.json"
    ))?;
    wire["inventory"]["interfaces"][0]["addresses"] = json!(["", "192.0.2.1"]);
    let capture = Capture {
        config: settings.transport(),
        bytes: serde_json::to_vec(&wire)?,
        calls: AtomicUsize::new(0),
    };
    let now = s::Runtime::now(&ServerRuntime)?;
    let mut provider = settings.provider()?;
    let n::RefreshOutcome::Complete(proposal) = provider
        .prepare_refresh(
            &n::RetainedState::empty(settings.source().scope.clone()),
            0,
            &id(90),
            &capture,
            || now.clone(),
        )
        .await?
    else {
        return Err("Generated capture failed".into());
    };
    let state = proposal.state();
    let generation = state
        .generation
        .as_ref()
        .ok_or("Missing synthetic generation")?;
    let refs = n::host_runtime::generation_references(settings.source(), generation)?;
    let mut sidecar = settings.open_sidecar()?;
    let reservation = sidecar.reserve_original_capture(
        settings.source(),
        settings.review(),
        &id(90),
        n::Limits::default(),
    )?;
    let projected = sidecar.stage(
        settings.source(),
        &n::stage_row(settings.source(), &proposal)?,
    )?;
    sidecar.stage_original_capture(reservation, &proposal, &projected)?;
    sidecar.close()?;
    let snapshot: s::Snapshot = serde_json::from_value(
        json!({"contractVersion":s::CONTRACT_VERSION,"synthetic":true,"sources":[registration],"records":[],
        "homeboxEntities":[],"caches":[state.cache],"networkRelations":generation.network_relations}),
    )?;
    let access = Arc::new(Mutex::new(a::AccessBoundary::open(
        root.join("access.sqlite"),
        a::AccessConfig::new(vec![ORIGIN.into()])?,
    )?));
    let access_scope = a::Scope {
        workspace_id: a::CanonicalId::parse(&id(1))?,
        home_id: a::CanonicalId::parse(&id(2))?,
    };
    let (cookie, csrf) = {
        let mut access = access.lock().unwrap();
        let user = a::CanonicalId::parse(&id(4))?;
        let actor = a::CanonicalId::parse(&id(5))?;
        access.provision_user(
            &user,
            &actor,
            "synthetic-viewer",
            &a::hash_password("Generated-only-fixture-password")?,
            None,
        )?;
        access.set_membership(&user, &access_scope, a::Role::Viewer, true)?;
        let login=access.login(&a::RequestEvidence{method:a::Method::Post,url:&format!("{ORIGIN}/api/atlas/auth/login"),origin:Some(ORIGIN),sec_fetch_site:Some("same-origin"),referer:None,cookie:None,authorization:None,csrf:None},
            &serde_json::to_vec(&json!({"username":"synthetic-viewer","password":"Generated-only-fixture-password"}))?,"synthetic-test")?;
        (
            login
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing generated cookie")?
                .to_owned(),
            login.info().csrf_token().to_owned(),
        )
    };
    let database = root.join("atlas.sqlite");
    let mut store = Store::open(
        &database,
        NativeContracts,
        ReadAuthority(access.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&snapshot)?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    let core = Core {
        access: access.clone(),
        store: Arc::new(Mutex::new(store)),
        vault,
        home: home.clone(),
        homes: vec![home],
        atlas_list_pages: Default::default(),
        media_policy_evidence: Mutex::default(),
    };
    let mut binding = NetworkBinding::from_trusted_configuration(
        &core,
        settings.for_existing_cached_storage(),
        refs,
    )?;

    let peer = Arc::new(FakePeer::default());
    let holder = Arc::new(Holder::default());
    holder
        .poll(peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    binding.observations = Some(holder.clone());
    binding.collector_peer = Some(peer.clone());
    let native = serde_json::from_value(serde_json::to_value(&registration)?)?;
    access.lock().unwrap().put_source(&native, Some(true))?;
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_network_bindings(vec![binding])?;
    Ok(Fixture {
        _root: temporary,
        host,
        cookie,
        csrf,
        peer,
        holder,
    })
}
async fn request(
    f: &Fixture,
    post: bool,
    body: Value,
    csrf: Option<&str>,
) -> Result<(StatusCode, Value)> {
    let path = format!(
        "/api/atlas/providers/network/workspaces/{}/homes/{}/sources/{}/{}?collection=inventory",
        id(1),
        id(2),
        id(12),
        if post { "actions" } else { "results" }
    );
    let mut req = Request::builder()
        .uri(path)
        .method(if post { "POST" } else { "GET" })
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("cookie", &f.cookie)
        .header("content-type", "application/json");
    if let Some(csrf) = csrf {
        req = req.header("x-atlas-csrf", csrf);
    }
    let mut req = req.body(if post {
        Body::from(serde_json::to_vec(&body)?)
    } else {
        Body::empty()
    })?;
    req.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<std::net::SocketAddr>()?,
    ));
    let response = router(f.host.clone()).oneshot(req).await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await?;
    Ok((status, serde_json::from_slice(&bytes)?))
}
#[tokio::test]
async fn healthy_collector_routes_auth_revision_and_outcomes() -> Result<()> {
    let mut f = fixture().await?;
    let (status, value) = request(&f, false, Value::Null, None).await?;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["status"], "available");
    assert_eq!(value["results"]["wifi"]["latest"]["state"], "unavailable");
    assert_eq!(
        request(&f, true, json!({"kind":"speed"}), Some(&f.csrf))
            .await?
            .0,
        StatusCode::FORBIDDEN
    );
    f.peer.bad_results.store(true, Ordering::SeqCst);
    f.holder
        .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    let (status, unknown_results) = request(&f, false, Value::Null, None).await?;
    assert_eq!(status, StatusCode::OK, "{unknown_results}");
    assert_eq!(unknown_results["status"], "unknown");
    assert!(unknown_results["results"].is_null());
    assert_eq!(unknown_results["inventoryRevision"], 42);
    f.peer.bad_results.store(false, Ordering::SeqCst);
    let access = f.host.core.lock().unwrap().access.clone();
    access.lock().unwrap().set_membership(
        &a::CanonicalId::parse(&id(4))?,
        &a::Scope {
            workspace_id: a::CanonicalId::parse(&id(1))?,
            home_id: a::CanonicalId::parse(&id(2))?,
        },
        a::Role::Editor,
        true,
    )?;
    // Membership changes retire the old principal, but the same live session may
    // freshly authorize the Editor as ordinary routes do.
    for csrf in [None, Some("invalid-generated-token")] {
        assert_eq!(
            request(&f, true, json!({"kind":"speed"}), csrf).await?.0,
            StatusCode::FORBIDDEN
        );
    }
    let (_, unknown) = request(
        &f,
        true,
        json!({"kind":"ping","deviceId":"not-in-inventory"}),
        Some(&f.csrf),
    )
    .await?;
    assert_eq!(unknown["reason"], "unknown-device");
    let (_, port) = request(
        &f,
        true,
        json!({"kind":"port","deviceId":"device-a","port":1234}),
        Some(&f.csrf),
    )
    .await?;
    assert_eq!(port["reason"], "port-not-allowed");
    f.peer.revision.store(43, Ordering::SeqCst);
    f.holder
        .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    let (_, mismatch) = request(&f, true, json!({"kind":"speed"}), Some(&f.csrf)).await?;
    assert_eq!(mismatch["reason"], "inventory-revision-mismatch");
    assert_eq!(f.peer.posts.load(Ordering::SeqCst), 0);
    f.peer.revision.store(42, Ordering::SeqCst);
    f.holder
        .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    for (mode, expected) in [
        (1, "busy"),
        (2, "timeout"),
        (3, "refused"),
        (0, "completed"),
    ] {
        f.host.network_action_gate = Arc::new(Default::default());
        f.peer.mode.store(mode, Ordering::SeqCst);
        let (status, value) = request(&f, true, json!({"kind":"speed"}), Some(&f.csrf)).await?;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["status"], expected, "{value}");
        if mode == 0 {
            assert_eq!(value["result"]["result"]["downloadBitsPerSecond"], 12000000);
        }
    }
    // A second admission within the process window never calls the collector.
    assert_eq!(
        request(&f, true, json!({"kind":"speed"}), Some(&f.csrf))
            .await?
            .1["status"],
        "busy"
    );
    assert_eq!(f.peer.posts.load(Ordering::SeqCst), 4);
    for action in [
        json!({"kind":"ping","deviceId":"device-a"}),
        json!({"kind":"port","deviceId":"device-a","port":443}),
    ] {
        f.host.network_action_gate = Arc::new(Default::default());
        let (status, result) = request(&f, true, action, Some(&f.csrf)).await?;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["status"], "completed", "{result}");
    }
    f.host.network_bindings = Arc::new(vec![]);
    assert_eq!(
        request(&f, true, json!({"kind":"speed"}), Some(&f.csrf))
            .await?
            .1["status"],
        "unavailable"
    );
    assert_eq!(
        request(&f, false, Value::Null, None).await?.1["status"],
        "unavailable"
    );
    assert_eq!(f.peer.posts.load(Ordering::SeqCst), 6);
    let before = f.peer.calls.lock().unwrap().len();
    let absent = f.host.start_collector_observations();
    tokio::task::yield_now().await;
    absent.shutdown().await;
    assert_eq!(f.peer.calls.lock().unwrap().len(), before);
    Ok(())
}
