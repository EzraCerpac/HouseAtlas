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
    inventory: Option<Arc<refresh::InventoryPeer>>,
}
async fn fixture() -> Result<Fixture> {
    fixture_with_source(true).await
}
async fn fixture_with_source(register_source: bool) -> Result<Fixture> {
    fixture_options(register_source, false, true).await
}
#[derive(Default)]
struct FixtureSetup {
    second_partition: bool,
    revalidation: bool,
    second_editor: bool,
    clock: Option<Arc<std::sync::atomic::AtomicI64>>,
}
async fn fixture_options(register_source: bool, refresh: bool, seed: bool) -> Result<Fixture> {
    fixture_setup(register_source, refresh, seed, FixtureSetup::default()).await
}
async fn fixture_setup(
    register_source: bool,
    refresh: bool,
    seed: bool,
    setup: FixtureSetup,
) -> Result<Fixture> {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let root = fs::canonicalize(temporary.path())?;
    let vault = Arc::new(AssetVault::open(&root.join("media"))?);
    let registration: s::SourceRegistration = serde_json::from_value(
        json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}),
    )?;
    let mut registrations = vec![registration.clone()];
    if setup.second_partition {
        let mut second = registration.clone();
        second.source_instance_id = id(13);
        registrations.push(second);
    }
    let registry = ProviderRegistry::from_trusted_configuration(registrations.clone())?;
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
    .with_collector_measurements(true)?;
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
    if seed {
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
    }
    let mut snapshot: s::Snapshot = serde_json::from_value(
        json!({"contractVersion":s::CONTRACT_VERSION,"synthetic":true,"sources":[registration],"records":[],
        "homeboxEntities":[],"caches":[state.cache],"networkRelations":generation.network_relations}),
    )?;
    if !seed {
        snapshot.sources.clear();
        snapshot.caches.clear();
        snapshot.network_relations.clear();
    }
    let mut rules = Vec::new();
    if refresh {
        let mut capabilities = vec![
            a::LifecycleCapability::ConfigureSource,
            a::LifecycleCapability::PublishCache,
        ];
        if setup.revalidation {
            capabilities.push(a::LifecycleCapability::RevalidateSource);
        }
        for registration in &registrations {
            for capability in &capabilities {
                rules.push(a::LifecycleRule::new(
                    a::CanonicalId::parse(&id(4))?,
                    a::CanonicalId::parse(&id(5))?,
                    serde_json::from_value(serde_json::to_value(registration)?)?,
                    *capability,
                    a::Action::Mutate,
                )?);
            }
        }
    }
    if setup.second_editor {
        for registration in &registrations {
            for capability in [
                a::LifecycleCapability::ConfigureSource,
                a::LifecycleCapability::PublishCache,
            ] {
                rules.push(a::LifecycleRule::new(
                    a::CanonicalId::parse(&id(8))?,
                    a::CanonicalId::parse(&id(9))?,
                    serde_json::from_value(serde_json::to_value(registration)?)?,
                    capability,
                    a::Action::Mutate,
                )?);
            }
        }
    }
    let mut access_config = a::AccessConfig::new(vec![ORIGIN.into()])?
        .with_lifecycle_policy(a::LifecyclePolicy::from_trusted_configuration(rules));
    if let Some(clock) = setup.clock {
        access_config = access_config.with_clock(move || clock.load(Ordering::SeqCst));
    }
    let access = Arc::new(Mutex::new(a::AccessBoundary::open(
        root.join("access.sqlite"),
        access_config,
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
    let peer = Arc::new(FakePeer::default());
    let second_wire = wire.clone();
    let inventory = refresh.then(|| {
        Arc::new(refresh::InventoryPeer::new(
            settings.transport(),
            peer.clone(),
            wire,
        ))
    });
    let settings = if let Some(peer) = &inventory {
        settings.with_test_peer(peer.clone())
    } else {
        settings.for_existing_cached_storage()
    };
    let mut binding = NetworkBinding::from_trusted_configuration(&core, settings, refs)?;

    if refresh {
        binding.refresh_editors = vec![a::CanonicalId::parse(&id(5))?];
        if setup.second_editor {
            binding.refresh_editors.push(a::CanonicalId::parse(&id(9))?);
        }
    }
    let holder = Arc::new(Holder::default());
    holder
        .poll(peer.as_ref(), &|| crate::app::now().unwrap())
        .await;
    binding.observations = Some(holder.clone());
    binding.collector_peer = Some(peer.clone());
    let native = serde_json::from_value(serde_json::to_value(&registration)?)?;
    if register_source {
        access.lock().unwrap().put_source(&native, Some(true))?;
    }
    let mut bindings = vec![binding];
    if setup.second_partition {
        let settings = NetworkSettings::new(
            registry.sources()[1].clone(),
            "http://127.0.0.1:42002",
            serde_json::from_str(include_str!(
                "../../../../adapters/network/fixtures/link-review.json"
            ))?,
            n::Limits::default(),
            2000,
            2000,
            60000,
            &root,
        )?
        .with_collector_measurements(true)?;
        let generation = n::project_capture(
            settings.source(),
            n::NetworkCapture {
                source: &settings.source().scope,
                document: &serde_json::to_vec(&second_wire)?,
                retrieved_at: &now,
                source_snapshot_at: None,
            },
            settings.review(),
            n::Limits::default(),
        )?;
        let refs = n::host_runtime::generation_references(settings.source(), &generation)?;
        let inventory = Arc::new(refresh::InventoryPeer::new(
            settings.transport(),
            peer.clone(),
            second_wire,
        ));
        let mut binding = NetworkBinding::from_trusted_configuration(
            &core,
            settings.with_test_peer(inventory),
            refs,
        )?;
        binding.refresh_editors = vec![a::CanonicalId::parse(&id(5))?];
        if setup.second_editor {
            binding.refresh_editors.push(a::CanonicalId::parse(&id(9))?);
        }
        binding.observations = Some(holder.clone());
        binding.collector_peer = Some(peer.clone());
        bindings.push(binding);
    }
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_network_bindings(bindings)?;
    Ok(Fixture {
        _root: temporary,
        host,
        cookie,
        csrf,
        peer,
        holder,
        inventory,
    })
}

#[path = "network_refresh_healthy.rs"]
mod refresh;
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
    request_path(f, post, body, csrf, &path, Some(&f.cookie)).await
}
async fn request_path(
    f: &Fixture,
    post: bool,
    body: Value,
    csrf: Option<&str>,
    path: &str,
    cookie: Option<&str>,
) -> Result<(StatusCode, Value)> {
    let mut req = Request::builder()
        .uri(path)
        .method(if post { "POST" } else { "GET" })
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json");
    if let Some(cookie) = cookie {
        req = req.header("cookie", cookie);
    }
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

fn editor(f: &Fixture) -> Result<()> {
    f.host
        .core
        .lock()
        .unwrap()
        .access
        .lock()
        .unwrap()
        .set_membership(
            &a::CanonicalId::parse(&id(4))?,
            &a::Scope {
                workspace_id: a::CanonicalId::parse(&id(1))?,
                home_id: a::CanonicalId::parse(&id(2))?,
            },
            a::Role::Editor,
            true,
        )?;
    Ok(())
}
fn route(post: bool, workspace: u32, home: u32, collection: &str) -> String {
    format!(
        "/api/atlas/providers/network/workspaces/{}/homes/{}/sources/{}/{}?collection={collection}",
        id(workspace),
        id(home),
        id(12),
        if post { "actions" } else { "results" }
    )
}
async fn refused_without_collector(
    f: &Fixture,
    cookie: Option<&str>,
    workspace: u32,
    home: u32,
    collection: &str,
    expected: StatusCode,
) -> Result<()> {
    for post in [false, true] {
        let before = (
            f.peer.calls.lock().unwrap().len(),
            f.peer.posts.load(Ordering::SeqCst),
        );
        let (status, value) = request_path(
            f,
            post,
            json!({"kind":"ping","deviceId":"device-a"}),
            post.then_some(f.csrf.as_str()),
            &route(post, workspace, home, collection),
            cookie,
        )
        .await?;
        assert_eq!(status, expected, "{value}");
        if expected == StatusCode::OK {
            assert_eq!(value, json!({"status":"unavailable"}));
        }
        assert_eq!(
            (
                f.peer.calls.lock().unwrap().len(),
                f.peer.posts.load(Ordering::SeqCst)
            ),
            before,
            "Refusal must perform neither collector GET nor POST"
        );
    }
    Ok(())
}
#[tokio::test]
async fn healthy_collector_routes_refuse_without_current_access() -> Result<()> {
    let f = fixture_with_source(false).await?;
    editor(&f)?;
    // Genuine Editor session and retained inventory, but no Access source/partition.
    refused_without_collector(
        &f,
        Some(&f.cookie),
        1,
        2,
        "inventory",
        StatusCode::NOT_FOUND,
    )
    .await?;
    let source = f.host.network_bindings[0]
        .runtime()
        .settings()
        .configured_source()
        .access_registration()
        .clone();
    let access = f.host.core.lock().unwrap().access.clone();
    access.lock().unwrap().put_source(&source, Some(true))?;
    // Positive controls make later refusals distinguishable from fixture failure.
    assert_eq!(
        request(&f, false, Value::Null, None).await?.0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &f,
            true,
            json!({"kind":"ping","deviceId":"device-a"}),
            Some(&f.csrf)
        )
        .await?
        .1["status"],
        "completed"
    );
    refused_without_collector(&f, None, 1, 2, "inventory", StatusCode::UNAUTHORIZED).await?;
    let user = a::CanonicalId::parse(&id(4))?;
    let own = a::Scope {
        workspace_id: a::CanonicalId::parse(&id(1))?,
        home_id: a::CanonicalId::parse(&id(2))?,
    };
    for (workspace, home) in [(91, 2), (1, 92)] {
        let foreign = a::Scope {
            workspace_id: a::CanonicalId::parse(&id(workspace))?,
            home_id: a::CanonicalId::parse(&id(home))?,
        };
        {
            let mut issuer = access.lock().unwrap();
            issuer.set_membership(&user, &own, a::Role::Editor, false)?;
            issuer.set_membership(&user, &foreign, a::Role::Editor, true)?;
        }
        // Membership exists only in a different workspace or a different home.
        refused_without_collector(
            &f,
            Some(&f.cookie),
            1,
            2,
            "inventory",
            StatusCode::NOT_FOUND,
        )
        .await?;
        refused_without_collector(
            &f,
            Some(&f.cookie),
            workspace,
            home,
            "inventory",
            StatusCode::NOT_FOUND,
        )
        .await?;
        {
            let mut issuer = access.lock().unwrap();
            issuer.set_membership(&user, &foreign, a::Role::Editor, false)?;
            issuer.set_membership(&user, &own, a::Role::Editor, true)?;
        }
    }
    access
        .lock()
        .unwrap()
        .set_source_enabled(&source.partition(), false)?;
    refused_without_collector(
        &f,
        Some(&f.cookie),
        1,
        2,
        "inventory",
        StatusCode::NOT_FOUND,
    )
    .await?;
    access
        .lock()
        .unwrap()
        .set_source_enabled(&source.partition(), true)?;
    let mut restricted = source.clone();
    restricted.partition_mode = a::PartitionMode::ReviewedEntityAllowlist;
    restricted.allowed_external_ids = f.host.network_bindings[0]
        .entities()
        .iter()
        .map(|r| r.key.external_id.clone())
        .filter(|id| id != "device-a")
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    access.lock().unwrap().put_source(&restricted, Some(true))?;
    // The partition is enabled, but the served device has no current source grant.
    refused_without_collector(
        &f,
        Some(&f.cookie),
        1,
        2,
        "inventory",
        StatusCode::NOT_FOUND,
    )
    .await?;
    access.lock().unwrap().put_source(&source, Some(true))?;
    refused_without_collector(&f, Some(&f.cookie), 1, 2, "other-inventory", StatusCode::OK).await?;
    Ok(())
}
#[tokio::test]
async fn healthy_collector_routes_refuse_changed_collector_inventory() -> Result<()> {
    let mut f = fixture().await?;
    editor(&f)?;
    let observations = f.holder.snapshot()?;
    assert_eq!(observations.revision(), Some(42));
    // No backend poll: the collector changes independently after the read.
    f.peer.revision.store(43, Ordering::SeqCst);
    for action in [
        json!({"kind":"ping","deviceId":"device-a"}),
        json!({"kind":"port","deviceId":"device-a","port":443}),
    ] {
        f.host.network_action_gate = Arc::new(Default::default());
        let (status, value) = request(&f, true, action, Some(&f.csrf)).await?;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            value,
            json!({"status":"refused","collectorStatus":409,"reason":"inventory-revision-mismatch"})
        );
        assert!(Arc::ptr_eq(&observations, &f.holder.snapshot()?));
        assert_eq!(f.peer.executions.load(Ordering::SeqCst), 0);
    }
    assert_eq!(f.peer.posts.load(Ordering::SeqCst), 2);
    assert_eq!(
        f.peer.calls.lock().unwrap().len(),
        3,
        "Only the fixture's original poll occurred"
    );
    Ok(())
}

#[tokio::test]
async fn healthy_collector_results_keep_only_revision_qualified_device_actions() -> Result<()> {
    let f = fixture().await?;
    let ping = json!({"kind":"ping","deviceId":"device-a","inventoryRevision":42,"recordedAt":AT,"result":crate::providers::network::observations::tests::measurements(42)["devices"]["device-a"]["latest"]});
    let mut later = ping.clone();
    later["inventoryRevision"] = json!(43);
    let mut legacy = ping.clone();
    legacy.as_object_mut().unwrap().remove("inventoryRevision");
    let speed = json!({"kind":"speed","recordedAt":AT,"result":crate::providers::network::observations::tests::speed()});
    *f.peer.actions.lock().unwrap() = vec![later, ping.clone(), legacy, speed.clone()];
    // Results change to include a revision-43 action, while a failed measurement
    // read retains the revision-42 snapshot. No new attribution may be inferred.
    f.peer.revision.store(43, Ordering::SeqCst);
    f.peer.bad_measurements.store(true, Ordering::SeqCst);
    assert!(
        !f.holder
            .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
            .await
    );
    assert_eq!(f.holder.snapshot()?.revision(), Some(42));
    let (status, value) = request(&f, false, Value::Null, None).await?;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(
        value["results"]["actions"],
        json!([ping.clone(), speed.clone()])
    );
    f.peer.bad_measurements.store(false, Ordering::SeqCst);
    assert!(
        f.holder
            .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
            .await
    );
    let (_, value) = request(&f, false, Value::Null, None).await?;
    assert_eq!(value["measurementReason"], "inventory-revision-mismatch");
    assert_eq!(value["results"]["actions"], json!([speed.clone()]));
    // A results read at revision 42 still contains mixed historical revisions;
    // even same-poll measurement pairing alone would not qualify those rows.
    f.peer.revision.store(42, Ordering::SeqCst);
    assert!(
        f.holder
            .poll(f.peer.as_ref(), &|| crate::app::now().unwrap())
            .await
    );
    assert_eq!(
        request(&f, false, Value::Null, None).await?.1["results"]["actions"],
        json!([ping, speed])
    );
    Ok(())
}
