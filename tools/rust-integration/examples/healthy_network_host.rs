//! One healthy loopback upstream GET, actual native publication and two cached
//! root-router reads through a real disposable TLS listener. No browser or
//! stopped-control branch is included.
use axum::http::StatusCode;
use houseatlas_backend::{
    access as a,
    app::{self, Core, ReadAuthority, ServerRuntime, Store},
    config::providers::{
        network::NetworkSettings, network_host::NetworkBinding, registry::ProviderRegistry,
    },
    domain as d,
    http::contracts::NativeContracts,
    http::{self, Host},
    media::{AssetVault, native::NativeMediaRuntime},
    providers::network::{self as n, host_runtime::*},
    storage as s,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

type Failure = Box<dyn std::error::Error + Send + Sync>;
fn evidence<'a>(
    url: &'a str,
    origin: &'a str,
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url,
        origin: Some(origin),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Failure> {
    // Create private fixture files regardless of the CI runner's inherited mask.
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        return Err(
            "Expected disposable upstream origin, CA, server certificate and key paths".into(),
        );
    }
    let upstream_origin = &args[1];
    let parsed = url::Url::parse(upstream_origin)?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none()
        || parsed.origin().ascii_serialization() != *upstream_origin
    {
        return Err("Fixture requires canonical IPv4 loopback HTTPS".into());
    }
    let ca = std::fs::read(&args[2])?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let origin = &format!("https://{}", listener.local_addr()?);
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(&args[3], &args[4]).await?;
    let directory = tempfile::tempdir()?;
    let directory_path = std::fs::canonicalize(directory.path())?;
    let mut snapshot: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let mut registration: s::SourceRegistration =
        serde_json::from_value(snapshot["sources"][2].clone())?;
    registration.partition_mode = s::PartitionMode::ReviewedEntityAllowlist;
    registration.allowed_external_ids = [
        "group-a",
        "device-a",
        "device-b",
        "interface-a",
        "segment-a",
        "member-a",
        "association-a",
        "connection-a",
        "gap-a",
    ]
    .map(String::from)
    .to_vec();
    snapshot["sources"][2] = serde_json::to_value(&registration)?;
    snapshot["networkRelations"] = json!([]);
    let registry = ProviderRegistry::from_trusted_configuration(vec![registration.clone()])?;
    let source = registry.sources()[0].clone();
    let scope = source.partition().scope();
    let user = a::CanonicalId::parse("00000000-0000-4000-8000-000000000004")?;
    let actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000005")?;
    let policy = vec![
        a::LifecycleRule::new(
            user.clone(),
            actor.clone(),
            source.access_registration().clone(),
            a::LifecycleCapability::ConfigureSource,
            a::Action::Mutate,
        )?,
        a::LifecycleRule::new(
            user.clone(),
            actor.clone(),
            source.access_registration().clone(),
            a::LifecycleCapability::PublishCache,
            a::Action::Read,
        )?,
    ];
    // Root's genuine canonical issuer exists before the Network bridge. Its
    // original policy, principal and sessions are not recreated by injection.
    let canonical = Arc::new(Mutex::new(a::AccessBoundary::open(
        directory_path.join("access.sqlite"),
        a::AccessConfig::new(vec![origin.clone()])?
            .with_lifecycle_policy(a::LifecyclePolicy::from_trusted_configuration(policy)),
    )?));
    let (configure_principal, principal) = {
        let mut issuer = canonical
            .try_lock()
            .map_err(|_| "Canonical access unexpectedly locked")?;
        let password = format!("Disposable-{}", app::new_id()?);
        issuer.provision_user(
            &user,
            &actor,
            "synthetic-network-editor",
            &a::hash_password(&password)?,
            None,
        )?;
        issuer.set_membership(&user, &scope, a::Role::Editor, true)?;
        let login_url = format!("{origin}/api/atlas/auth/login");
        let receipt = issuer.login(
            &evidence(&login_url, origin, a::Method::Post, None, None),
            &serde_json::to_vec(
                &json!({"username":"synthetic-network-editor", "password":password}),
            )?,
            "disposable-loopback",
        )?;
        let cookie = receipt
            .set_cookie()
            .split(';')
            .next()
            .ok_or("Missing session cookie")?;
        let csrf = receipt.info().csrf_token();
        let configure_url = format!("{origin}/api/atlas/configure");
        let configure_principal = issuer.authorize(
            &evidence(
                &configure_url,
                origin,
                a::Method::Post,
                Some(cookie),
                Some(csrf),
            ),
            &scope,
            a::Action::Mutate,
        )?;
        let read_url = format!("{origin}/api/atlas/network");
        let principal = issuer.authorize(
            &evidence(&read_url, origin, a::Method::Get, Some(cookie), None),
            &scope,
            a::Action::Read,
        )?;
        (configure_principal, principal)
    };
    // Store/Core and the bridge share this exact canonical allocation. Held
    // callbacks must use borrowed authority rather than reenter ReadAuthority.
    let vault = Arc::new(AssetVault::open(&directory_path.join("media"))?);
    let atlas_path = directory_path.join("atlas.sqlite");
    let mut store = Store::open(
        &atlas_path,
        NativeContracts,
        ReadAuthority(canonical.clone()),
        NativeMediaRuntime {
            vault: vault.clone(),
            server: ServerRuntime,
        },
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    store.initialize_synthetic(&serde_json::from_value(snapshot)?)?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: registration.workspace_id.clone(),
            home_id: registration.home_id.clone(),
        },
        label: "Synthetic Network home".into(),
    };
    let host = Host::new(
        Core {
            access: canonical.clone(),
            store: Mutex::new(store),
            vault,
            homes: vec![home.clone()],
            home,
        },
        origin.clone(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?;
    let core = host.core.clone();
    let canonical_from_core = core
        .try_lock()
        .map_err(|_| "Core unexpectedly locked")?
        .access
        .clone();
    assert!(Arc::ptr_eq(&canonical_from_core, &canonical));
    let settings = NetworkSettings::new(
        source.clone(),
        upstream_origin,
        serde_json::from_str(include_str!(
            "../../../adapters/network/fixtures/link-review.json"
        ))?,
        n::Limits::default(),
        2000,
        2000,
        300_000,
        &directory_path,
    )?
    .with_reviewed_ca_pem(&ca)?;
    let entities = [
        (a::SourceKind::NetworkGroup, "group-a"),
        (a::SourceKind::NetworkDevice, "device-a"),
        (a::SourceKind::NetworkDevice, "device-b"),
        (a::SourceKind::NetworkInterface, "interface-a"),
        (a::SourceKind::NetworkSegment, "segment-a"),
    ]
    .map(|(kind, id)| a::SourceRef {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
        key: a::SourceKey {
            source_instance_id: source.partition().source_instance_id,
            collection_id: registration.collection_id.clone(),
            source_kind: kind,
            external_id: id.into(),
        },
    })
    .to_vec();
    let binding = {
        let locked = core.try_lock().map_err(|_| "Core unexpectedly locked")?;
        NetworkBinding::from_trusted_configuration(&locked, settings.clone(), entities)?
    };
    let access = binding.access().clone();
    let runtime = binding.runtime().clone();
    let host = host.with_network_bindings(vec![binding])?;
    assert!(Arc::ptr_eq(access.shared().as_existing(), &canonical));
    access.configure(&core, &configure_principal, &source)?;
    let (partition, grants) = {
        let issuer = canonical
            .try_lock()
            .map_err(|_| "Canonical access unexpectedly locked")?;
        issuer.revalidate(&principal)?;
        let partition = issuer.authorize_source_partition(&principal, &source.partition())?;
        let mut grants = Vec::new();
        for (kind, id) in [
            (a::SourceKind::NetworkGroup, "group-a"),
            (a::SourceKind::NetworkDevice, "device-a"),
            (a::SourceKind::NetworkDevice, "device-b"),
            (a::SourceKind::NetworkInterface, "interface-a"),
            (a::SourceKind::NetworkSegment, "segment-a"),
        ] {
            grants.push(issuer.authorize_source(
                &principal,
                &a::SourceRef {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                    key: a::SourceKey {
                        source_instance_id: source.partition().source_instance_id,
                        collection_id: registration.collection_id.clone(),
                        source_kind: kind,
                        external_id: id.into(),
                    },
                },
            )?);
        }
        (partition, grants)
    };
    let accepted = access.bind_accepted_original(
        principal.clone(),
        source.clone(),
        partition.clone(),
        grants.clone(),
        &settings.transport(),
        None,
    )?;
    use n::NetworkReadAuthority;
    let accepted_original =
        accepted.authorize_inventory(settings.source(), settings.transport().reviewed_origin())?;
    assert!(Arc::ptr_eq(&accepted_original, accepted.lease()));
    accepted.revalidate_inventory(
        &accepted_original,
        settings.source(),
        settings.transport().reviewed_origin(),
    )?;
    let lease = access.retain_original(principal, source, partition, grants)?;
    let authority = NetworkAuthority::new(lease.clone(), &settings.transport(), None)?;
    let outcome = runtime
        .refresh(
            &core,
            authority,
            lease.clone(),
            CancellationToken::new(),
            || "2026-01-02T12:00:00Z".into(),
        )
        .await;
    let cache = match outcome {
        Ok(RefreshResult::Published(cache)) => cache,
        Ok(RefreshResult::SourceFailure(cache)) => {
            return Err(format!(
                "Healthy fixture returned sanitized source failure: {:?}",
                cache.error.as_ref().map(|e| &e.code)
            )
            .into());
        }
        Ok(RefreshResult::AlreadyRunning) => return Err("Unexpected in-progress result".into()),
        Err(n::NetworkPublicationError::Network(e)) => return Err(e.into()),
        Err(n::NetworkPublicationError::Storage(e)) => return Err(e.into()),
    };
    lease.revalidate()?;
    let db = rusqlite::Connection::open_with_flags(
        &atlas_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let epoch: i64 = db.query_row(
        "SELECT epoch FROM cache_epochs WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(epoch, 1);
    let body: String = db.query_row(
        "SELECT body FROM caches WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(serde_json::from_str::<s::CacheStatus>(&body)?, cache);
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM network_relations WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    assert_eq!(count, 4);
    let reservations: i64 =
        db.query_row("SELECT COUNT(*) FROM cache_generations", [], |r| r.get(0))?;
    let schema: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    assert_eq!(schema, 5);
    // A distinct genuine viewer has no lifecycle policy. Browse uses only its
    // current Read authority and original typed resource grants on the same Store.
    let viewer = a::CanonicalId::parse("00000000-0000-4000-8000-000000000006")?;
    let viewer_actor = a::CanonicalId::parse("00000000-0000-4000-8000-000000000007")?;
    let viewer_password = format!("Disposable-{}", app::new_id()?);
    access.provision_user(
        &viewer,
        &viewer_actor,
        "synthetic-network-viewer",
        &a::hash_password(&viewer_password)?,
        None,
    )?;
    access.set_membership(&viewer, &scope, a::Role::Viewer, true)?;
    let handle = axum_server::Handle::new();
    let server = tokio::spawn(
        axum_server::from_tcp_rustls(listener, tls)?
            .handle(handle.clone())
            .serve(http::router(host).into_make_service_with_connect_info::<SocketAddr>()),
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(10))
        .add_root_certificate(reqwest::Certificate::from_pem(&ca)?)
        .build()?;
    let response = client
        .post(format!("{origin}/api/atlas/auth/login"))
        .header("origin", origin)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .body(serde_json::to_vec(
            &json!({"username": "synthetic-network-viewer", "password": viewer_password}),
        )?)
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let viewer_cookie = response
        .headers()
        .get("set-cookie")
        .ok_or("Missing genuine viewer session")?
        .to_str()?
        .split(';')
        .next()
        .ok_or("Missing viewer cookie")?
        .to_owned();
    let _: Value = serde_json::from_slice(&response.bytes().await?)?;
    let collection: String =
        url::form_urlencoded::byte_serialize(registration.collection_id.as_bytes()).collect();
    let path = format!(
        "/api/atlas/providers/network/workspaces/{}/homes/{}/sources/{}/cached?collection={collection}",
        registration.workspace_id, registration.home_id, registration.source_instance_id,
    );
    for _ in 0..2 {
        let response = client
            .get(format!("{origin}{path}"))
            .header("origin", origin)
            .header("sec-fetch-site", "same-origin")
            .header("cookie", &viewer_cookie)
            .send()
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        let facet: Value = serde_json::from_slice(&response.bytes().await?)?;
        assert_eq!(facet["workspaceId"], registration.workspace_id);
        assert_eq!(facet["homeId"], registration.home_id);
        assert_eq!(facet["sourceInstanceId"], registration.source_instance_id);
        assert_eq!(facet["collectionId"], registration.collection_id);
        assert_eq!(facet["readOnly"], true);
        for (key, expected) in [
            ("groups", 1),
            ("devices", 2),
            ("interfaces", 1),
            ("segments", 1),
            ("currentClaims", 3),
            ("history", 1),
            ("observations", 1),
        ] {
            assert_eq!(
                facet[key]
                    .as_array()
                    .ok_or("Missing native facet rows")?
                    .len(),
                expected
            );
        }
        assert_eq!(
            facet["capabilities"],
            json!({"demand": false, "diagnostics": false,
            "writes": false, "physicalPlacement": false, "electricalCircuits": false})
        );
        assert_eq!(facet["observations"][0]["factAt"], "2026-01-01T01:02:03Z");
        assert_eq!(
            facet["observations"][0]["retrievedAt"],
            "2026-01-02T12:00:00Z"
        );
        assert_eq!(
            facet["observations"][0]["value"]["value"]["note"],
            "Original synthetic source text"
        );
    }
    let epoch_after: i64 = db.query_row(
        "SELECT epoch FROM cache_epochs WHERE source_instance_id=?1",
        [&registration.source_instance_id],
        |r| r.get(0),
    )?;
    let reservations_after: i64 =
        db.query_row("SELECT COUNT(*) FROM cache_generations", [], |r| r.get(0))?;
    assert_eq!(epoch_after, epoch);
    assert_eq!(reservations_after, reservations);
    drop(db);
    drop(client);
    handle.graceful_shutdown(Some(Duration::from_secs(2)));
    tokio::time::timeout(Duration::from_secs(10), server).await???;
    Arc::try_unwrap(runtime)
        .map_err(|_| "Runtime unexpectedly retained")?
        .close()?;
    drop(core);
    println!(
        "PASS healthy root Network router: one actual TLS inventory GET/native publication; genuine viewer HTTP login; two cached root GETs on same canonical Core/Access/Store, original entity/link/observation disclosure; epoch/reservations unchanged; no provider request from browsing. Root HTTP uses its real TLS loopback listener and actual connection metadata; no browser qualification."
    );
    Ok(())
}
