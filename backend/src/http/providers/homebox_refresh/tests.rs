//! Disposable synthetic refresh and recheck over a generated loopback HomeBox;
//! no live provider, real credential or user data. Every observed request is a
//! GET.
use super::*;
use crate::{
    app::{Core, ReadAuthority, ServerRuntime, Store},
    config::providers::registry::ProviderRegistry,
    http::{PinnedHomeBoxFileBinding, contracts::NativeContracts, router},
    providers::homebox::read as hb,
};
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::Request,
};
use std::{
    collections::BTreeMap,
    net::{Ipv4Addr, SocketAddr},
    sync::{Mutex, atomic::AtomicU8},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{self, pki_types::PrivatePkcs8KeyDer},
};
use tower::ServiceExt;

type Failure = crate::lifecycle::Failure;
const ORIGIN: &str = "https://127.0.0.1:48743";
const ORIGINAL: &[u8] = b"%PDF-1.7\nfictional refreshed original\n%%EOF\n";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn request(
    method: &str,
    path: &str,
    body: Vec<u8>,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> Result<Request<Body>, Failure> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-length", body.len());
    if !body.is_empty() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(cookie) = cookie {
        builder = builder.header("cookie", cookie);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-atlas-csrf", csrf);
    }
    let mut request = builder.body(Body::from(body))?;
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:50123".parse::<SocketAddr>()?));
    Ok(request)
}
async fn login(app: &axum::Router, login: &Value) -> Result<(String, String), Failure> {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/atlas/auth/login",
            serde_json::to_vec(login)?,
            None,
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .ok_or("cookie")?
        .to_owned();
    let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    Ok((cookie, info["csrfToken"].as_str().ok_or("csrf")?.to_owned()))
}
async fn post(
    app: &axum::Router,
    session: &(String, String),
) -> Result<(StatusCode, Value), Failure> {
    send(app, session, "refresh").await
}
async fn recheck(
    app: &axum::Router,
    session: &(String, String),
) -> Result<(StatusCode, Value), Failure> {
    send(app, session, "recheck").await
}
async fn send(
    app: &axum::Router,
    session: &(String, String),
    action: &str,
) -> Result<(StatusCode, Value), Failure> {
    let path = format!(
        "/api/atlas/providers/homebox/workspaces/{}/homes/{}/{action}",
        id(1),
        id(2)
    );
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &path,
            Vec::new(),
            Some(&session.0),
            Some(&session.1),
        )?)
        .await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4096).await?;
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)?
    };
    Ok((status, body))
}
async fn available(app: &axum::Router, session: &(String, String)) -> Result<String, Failure> {
    Ok(admission(app, session).await?["status"]
        .as_str()
        .ok_or("status")?
        .to_owned())
}
async fn admission(app: &axum::Router, session: &(String, String)) -> Result<Value, Failure> {
    let path = format!(
        "/api/atlas/providers/homebox/workspaces/{}/homes/{}/refresh",
        id(1),
        id(2)
    );
    let response = app
        .clone()
        .oneshot(request("GET", &path, Vec::new(), Some(&session.0), None)?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(serde_json::from_slice(
        &to_bytes(response.into_body(), 4096).await?,
    )?)
}
/// The ordinary cached read a browsing caller makes; it never reaches HomeBox.
async fn cached_read(app: &axum::Router, session: &(String, String)) -> Result<String, Failure> {
    let path = format!(
        "/api/atlas/providers/homebox/workspaces/{}/homes/{}/sources/{}/collections/{}/cached",
        id(1),
        id(2),
        id(300),
        id(301)
    );
    let response = app
        .clone()
        .oneshot(request("GET", &path, Vec::new(), Some(&session.0), None)?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(String::from_utf8(
        to_bytes(response.into_body(), 1 << 20).await?.to_vec(),
    )?)
}
/// What the generated HomeBox does next.
const ANSWER: u8 = 0;
const UNAUTHORIZED: u8 = 1;
const FORBIDDEN: u8 = 2;
const WRONG_RECORD: u8 = 3;
const STOPS_MID_READ: u8 = 4;
const TOO_SLOW: u8 = 5;
fn fixture(name: &str) -> &'static [u8] {
    match name {
        "locations" => {
            include_bytes!("../../../providers/homebox/wire/fixtures/locations.page.json")
        }
        "items" => include_bytes!("../../../providers/homebox/wire/fixtures/items.page.json"),
        "items-second" => {
            include_bytes!("../../../providers/homebox/wire/fixtures/items-second.page.json")
        }
        "location" => {
            include_bytes!("../../../providers/homebox/wire/fixtures/location.detail.json")
        }
        "item" => include_bytes!("../../../providers/homebox/wire/fixtures/item.detail.json"),
        "maintenance" => {
            include_bytes!("../../../providers/homebox/wire/fixtures/maintenance.json")
        }
        _ => include_bytes!("../../../providers/homebox/wire/fixtures/empty-maintenance.json"),
    }
}
fn respond(target: &str) -> &'static [u8] {
    let url = url::Url::parse(&format!("https://127.0.0.1{target}")).unwrap();
    let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
    let path = url.path();
    if path == "/api/v1/entities" {
        return match (query["isLocation"].as_str(), query["page"].as_str()) {
            ("true", _) => fixture("locations"),
            (_, "1") => fixture("items"),
            _ => fixture("items-second"),
        };
    }
    if path.ends_with(&format!("/attachments/{}", id(201))) {
        ORIGINAL
    } else if path.ends_with("/maintenance") {
        fixture(if path.contains(&id(2)) {
            "maintenance"
        } else {
            "empty"
        })
    } else if path.ends_with(&id(2)) {
        fixture("item")
    } else {
        fixture("location")
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn healthy_editor_refresh_fills_cache_then_opens_original_and_recheck_lifts_quarantine()
-> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("homebox-refresh-")
        .tempdir()?;
    let directory = std::fs::canonicalize(scratch.path())?.join("fixture");
    drop(crate::lifecycle::prepare(&directory, ORIGIN)?);
    let receipt: Value =
        serde_json::from_slice(&std::fs::read(directory.join("smoke-session.json"))?)?;
    let registration: a::SourceRegistration = serde_json::from_value(json!({
        "workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(300),"collectionId":id(301),
        "owner":"homebox","partitionMode":"reviewed-entity-allowlist","allowedExternalIds":[id(1),id(2)]
    }))?;
    // Reopen the disposable files with one approved synthetic Editor (id 6/7).
    let mut rules = Vec::new();
    for capability in [
        a::LifecycleCapability::ConfigureSource,
        a::LifecycleCapability::PublishCache,
        a::LifecycleCapability::RevalidateSource,
    ] {
        rules.push(a::LifecycleRule::new(
            a::CanonicalId::parse(id(6))?,
            a::CanonicalId::parse(id(7))?,
            registration.clone(),
            capability,
            a::Action::Mutate,
        )?);
    }
    // A second approved Editor (id 10/11) whose rules omit RevalidateSource.
    for capability in [
        a::LifecycleCapability::ConfigureSource,
        a::LifecycleCapability::PublishCache,
    ] {
        rules.push(a::LifecycleRule::new(
            a::CanonicalId::parse(id(10))?,
            a::CanonicalId::parse(id(11))?,
            registration.clone(),
            capability,
            a::Action::Mutate,
        )?);
    }
    let access = Arc::new(Mutex::new(a::AccessBoundary::open_existing(
        &directory.join("access.sqlite"),
        a::AccessConfig::new(vec![ORIGIN.into()])?
            .with_lifecycle_policy(a::LifecyclePolicy::from_trusted_configuration(rules)),
    )?));
    let vault = Arc::new(crate::media::AssetVault::open(&directory.join("media"))?);
    let store = Store::open(
        &directory.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        s::StoreOptions::default(),
    )?;
    let home = d::HomeSummary {
        scope: d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        },
        label: "Synthetic home".into(),
    };
    // A second Editor whom the profile does not name.
    let unlisted =
        json!({"username":"synthetic-unlisted-editor","password":"Disposable-unlisted-editor"});
    let refresh_only =
        json!({"username":"synthetic-refresh-editor","password":"Disposable-refresh-editor"});
    {
        let mut boundary = access.lock().unwrap();
        for (user, actor, name, password) in [
            (
                8,
                9,
                "synthetic-unlisted-editor",
                "Disposable-unlisted-editor",
            ),
            (
                10,
                11,
                "synthetic-refresh-editor",
                "Disposable-refresh-editor",
            ),
        ] {
            boundary.provision_user(
                &a::CanonicalId::parse(id(user))?,
                &a::CanonicalId::parse(id(actor))?,
                name,
                &a::hash_password(password)?,
                None,
            )?;
            boundary.set_membership(
                &a::CanonicalId::parse(id(user))?,
                &a::Scope {
                    workspace_id: a::CanonicalId::parse(id(1))?,
                    home_id: a::CanonicalId::parse(id(2))?,
                },
                a::Role::Editor,
                true,
            )?;
        }
    }
    let core = Core {
        access,
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: crate::domain::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault,
        homes: vec![home.clone()],
        home,
    };

    let cert = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()])?;
    let leaf = cert.cert.der().to_vec();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_no_client_auth()
    .with_single_cert(
        vec![cert.cert.der().clone()],
        PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der()).into(),
    )?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let provider_origin = format!("https://{}", listener.local_addr()?);
    let durable: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration)?)?;
    let limits = hb::Limits {
        max_page_size: 2,
        request_timeout_ms: 1_000,
        ..hb::Limits::default()
    };
    let source = Arc::new(TrustedHomeBoxSource::new_stock(
        &provider_origin,
        durable.clone(),
        limits,
        None,
    )?);
    let credentials = Arc::new(NativeReadCredentialConfig::from_trusted_header(
        &source.endpoint()?,
        b"Bearer generated-test-only".to_vec(),
    )?);
    let configured = ProviderRegistry::from_trusted_configuration(vec![durable])?
        .sources()
        .first()
        .cloned()
        .ok_or("configured source")?;
    let mut file = PinnedHomeBoxFileBinding::new(Arc::clone(&source), Arc::clone(&credentials))?;
    file.certificate = Some(leaf.clone());
    let mut refresh = HomeBoxRefreshBinding::new(
        Arc::clone(&source),
        configured,
        credentials,
        vec![
            a::CanonicalId::parse(id(7))?,
            a::CanonicalId::parse(id(11))?,
        ],
        true,
    )?;
    refresh.certificate = Some(leaf);
    // The same approval without the profile naming the recheck.
    let mut plain = refresh.clone();
    plain.recheck = false;
    // Without a selected credential the same Host answers "not configured".
    let unconfigured = Host::new(
        core,
        ORIGIN.into(),
        Arc::new(BTreeMap::new()),
        vec![(*source).clone()],
    )?;
    let host = unconfigured
        .clone()
        .with_pinned_homebox_files(vec![file])?
        .with_homebox_refresh(vec![refresh])?;
    let running = Arc::clone(&host.homebox_refresh_running);
    let plain = router(unconfigured.clone().with_homebox_refresh(vec![plain])?);
    let (bare, app) = (router(unconfigured), router(host));

    let acceptor = TlsAcceptor::from(Arc::new(tls));
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let observed = Arc::clone(&seen);
    let mode = Arc::new(AtomicU8::new(ANSWER));
    let next = Arc::clone(&mode);
    let (stop, mut shutdown) = tokio::sync::oneshot::channel::<()>();
    let mut server = tokio::spawn(async move {
        loop {
            let (socket, peer) = tokio::select! {
                _ = &mut shutdown => break,
                accepted = listener.accept() => accepted.unwrap(),
            };
            assert!(peer.ip().is_loopback());
            let mut stream = acceptor.accept(socket).await.unwrap();
            let mut raw = Vec::new();
            while !raw.ends_with(b"\r\n\r\n") {
                let mut b = [0];
                stream.read_exact(&mut b).await.unwrap();
                raw.push(b[0]);
                assert!(raw.len() < 16384);
            }
            let head = String::from_utf8(raw).unwrap();
            assert!(
                head.to_ascii_lowercase()
                    .contains("authorization: bearer generated-test-only\r\n")
            );
            let mut line = head.lines().next().unwrap().split_whitespace();
            assert_eq!(line.next(), Some("GET"));
            let target = line.next().unwrap().to_owned();
            let path = target.split('?').next().unwrap().to_owned();
            observed.lock().unwrap().push(target.clone());
            let (status, body) = match next.load(Ordering::SeqCst) {
                UNAUTHORIZED => ("401 Unauthorized", &b""[..]),
                FORBIDDEN => ("403 Forbidden", &b""[..]),
                // A detail answered with a different record than requested.
                WRONG_RECORD if path.ends_with(&id(2)) => ("200 OK", fixture("location")),
                // The second item page fails after the first one succeeded.
                STOPS_MID_READ if target.contains("page=2") => {
                    ("500 Internal Server Error", &b""[..])
                }
                TOO_SLOW => {
                    tokio::time::sleep(Duration::from_millis(1_500)).await;
                    ("200 OK", respond(&target))
                }
                _ => ("200 OK", respond(&target)),
            };
            // The reader may already have given up on a slow answer.
            let _ = stream
                .write_all(
                    format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await;
            let _ = stream.write_all(body).await;
            let _ = stream.shutdown().await;
        }
    });
    let count = || seen.lock().unwrap().len();

    let viewer = login(&app, &receipt["login"]).await?;
    let editor = login(&app, &receipt["editorLogin"]).await?;
    let unlisted = login(&app, &unlisted).await?;
    let refresh_only = login(&app, &refresh_only).await?;
    // The button's admission read: only the approved Editor of a configured
    // source sees it, before any cache exists for that source.
    assert_eq!(available(&app, &editor).await?, "available");
    // Every other caller gets one answer, with or without a configured source.
    for target in [&app, &bare] {
        for session in [&viewer, &unlisted] {
            assert_eq!(available(target, session).await?, "unavailable");
        }
    }
    assert_eq!(available(&bare, &editor).await?, "unavailable");
    // An unlisted Editor's POST is refused by the Access lifecycle rules.
    assert_eq!(
        post(&app, &unlisted).await?,
        (
            StatusCode::OK,
            json!({"status":"failed","reason":"registration-unavailable"})
        )
    );
    // A Viewer is refused before any registration or upstream request.
    assert_eq!(post(&app, &viewer).await?.0, StatusCode::FORBIDDEN);
    // No credential selected: plain answer and nothing sent upstream.
    assert_eq!(
        post(&bare, &editor).await?,
        (StatusCode::OK, json!({"status":"not-configured"}))
    );
    // A refresh already in flight is answered, not queued.
    running.store(true, Ordering::SeqCst);
    assert_eq!(
        post(&app, &editor).await?,
        (StatusCode::OK, json!({"status":"running"}))
    );
    running.store(false, Ordering::SeqCst);
    assert_eq!(count(), 0);

    let (status, body) = post(&app, &editor).await?;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "refreshed", "{body}");
    assert_eq!(body["cache"]["status"], "fresh");
    assert!(body["cache"]["lastSuccessfulFetchAt"].is_string());
    assert_eq!(body["cache"]["errorCode"], Value::Null);
    assert_eq!(count(), 7, "{:?}", seen.lock().unwrap());
    assert!(!running.load(Ordering::SeqCst));

    // The ordinary cached read now serves the published generation.
    let cached = format!(
        "/api/atlas/providers/homebox/workspaces/{}/homes/{}/sources/{}/collections/{}/cached",
        id(1),
        id(2),
        id(300),
        id(301)
    );
    let response = app
        .clone()
        .oneshot(request("GET", &cached, Vec::new(), Some(&editor.0), None)?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cached = String::from_utf8(to_bytes(response.into_body(), 1 << 20).await?.to_vec())?;
    assert!(cached.contains("\"fresh\""), "{cached}");
    assert!(
        cached.contains(&format!("\"externalId\":\"{}\"", id(2))),
        "{cached}"
    );
    assert_eq!(count(), 7);

    // Open file: one explicit capture returns the exact original bytes.
    let wire = json!({"schemaVersion":4,"commandId":"homebox.file.download","requestId":id(700),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(300),"collectionId":id(301),
            "resourceKind":"attachment","entityId":id(2),"resourceId":id(201)},"payload":{}});
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("request", &wire.to_string())
        .finish();
    let original = format!(
        "/api/atlas/stock/v4/workspaces/{}/homes/{}/homebox-offline-original?{query}",
        id(1),
        id(2)
    );
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &original,
            Vec::new(),
            Some(&editor.0),
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(&to_bytes(response.into_body(), 4096).await?[..], ORIGINAL);
    assert_eq!(count(), 10);

    // A later 401 is recorded as quarantine, and the cached read withholds rows.
    mode.store(UNAUTHORIZED, Ordering::SeqCst);
    let (status, body) = post(&app, &editor).await?;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "failed", "{body}");
    assert_eq!(body["reason"], "auth", "{body}");
    assert_eq!(body["cache"]["status"], "access-revoked", "{body}");
    assert_eq!(count(), 11);
    // Quarantine holds: a later press stops before contacting HomeBox, even
    // once HomeBox would answer again.
    mode.store(ANSWER, Ordering::SeqCst);
    assert_eq!(
        post(&app, &editor).await?,
        (
            StatusCode::OK,
            json!({"status":"failed","reason":"access-revoked"})
        )
    );
    assert_eq!(count(), 11);
    let withheld = cached_read(&app, &editor).await?;
    assert!(withheld.contains("\"access-revoked\""), "{withheld}");
    assert!(
        !withheld.contains(&format!("\"externalId\":\"{}\"", id(2))),
        "{withheld}"
    );
    assert_eq!(count(), 11, "Browsing sends nothing upstream");

    // Recheck admission: named only where the profile names it, and only to
    // the approved Editor; every other caller's answer is unchanged.
    assert_eq!(
        admission(&app, &editor).await?,
        json!({"status":"available","recheck":true})
    );
    assert_eq!(
        admission(&plain, &editor).await?,
        json!({"status":"available","recheck":false})
    );
    for session in [&viewer, &unlisted] {
        assert_eq!(
            admission(&app, session).await?,
            json!({"status":"unavailable"})
        );
    }
    // Refusals before any upstream request.
    for target in [&plain, &bare] {
        assert_eq!(
            recheck(target, &editor).await?,
            (StatusCode::OK, json!({"status":"not-configured"}))
        );
    }
    assert_eq!(recheck(&app, &viewer).await?.0, StatusCode::FORBIDDEN);
    // The Access rule, not the admission hint, decides: an Editor approved
    // for refresh whose rules omit RevalidateSource is refused.
    for session in [&unlisted, &refresh_only] {
        assert_eq!(
            recheck(&app, session).await?,
            (
                StatusCode::OK,
                json!({"status":"failed","reason":"not-approved"})
            )
        );
    }
    running.store(true, Ordering::SeqCst);
    assert_eq!(
        recheck(&app, &editor).await?,
        (StatusCode::OK, json!({"status":"running"}))
    );
    running.store(false, Ordering::SeqCst);
    assert_eq!(count(), 11);

    // Each failed recheck reaches HomeBox with GETs only, writes nothing, and
    // leaves the quarantine and the stored state byte-for-byte as they were.
    for (next, reason) in [
        (UNAUTHORIZED, "auth"),
        (FORBIDDEN, "auth"),
        (WRONG_RECORD, "wrong-scope"),
        (STOPS_MID_READ, "upstream"),
        (TOO_SLOW, "timeout"),
    ] {
        mode.store(next, Ordering::SeqCst);
        let before = count();
        assert_eq!(
            recheck(&app, &editor).await?,
            (StatusCode::OK, json!({"status":"failed","reason":reason})),
            "{reason}"
        );
        assert!(count() > before, "{reason}");
        mode.store(ANSWER, Ordering::SeqCst);
        let after = count();
        assert_eq!(cached_read(&app, &editor).await?, withheld, "{reason}");
        // Refresh still stops before contacting HomeBox.
        assert_eq!(
            post(&app, &editor).await?,
            (
                StatusCode::OK,
                json!({"status":"failed","reason":"access-revoked"})
            )
        );
        assert_eq!(count(), after, "{reason}");
    }
    // Let a slow answer finish before counting again.
    tokio::time::sleep(Duration::from_millis(600)).await;

    // A complete read of exactly the configured source lifts the quarantine in
    // the same commit that publishes the fresh generation.
    let before = count();
    let (status, body) = recheck(&app, &editor).await?;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "rechecked", "{body}");
    assert_eq!(body["cache"]["status"], "fresh", "{body}");
    assert_eq!(body["cache"]["errorCode"], Value::Null, "{body}");
    assert_eq!(count(), before + 7);
    let restored = cached_read(&app, &editor).await?;
    assert!(restored.contains("\"fresh\""), "{restored}");
    assert!(!restored.contains("\"access-revoked\""), "{restored}");
    assert!(
        restored.contains(&format!("\"externalId\":\"{}\"", id(2))),
        "{restored}"
    );
    assert_eq!(count(), before + 7);
    // A source that is not quarantined needs no recheck; nothing is sent.
    assert_eq!(
        recheck(&app, &editor).await?,
        (StatusCode::OK, json!({"status":"not-needed"}))
    );
    assert_eq!(count(), before + 7);
    // Ordinary refresh works again.
    assert_eq!(post(&app, &editor).await?.1["status"], "refreshed");
    assert_eq!(count(), before + 14);

    let _ = stop.send(());
    match tokio::time::timeout(Duration::from_secs(2), &mut server).await {
        Ok(result) => result?,
        Err(_) => {
            server.abort();
            return Err("synthetic provider cleanup timed out".into());
        }
    }
    Ok(())
}
