//! Disposable synthetic state only. A persistent loopback-local server writes
//! generated records and one original through its real HTTP routes, an offline
//! `backup` bundle is captured, and `initialize --restore-bundle` adopts it into
//! a new data directory that the strict reopen path then serves. Refusals and
//! injected failures keep the bundle untouched and leave no data directory or
//! staging behind, and a rerun then succeeds.
use super::{initialize_from_backup, initialize_without_password, reopen};
use crate::{
    config::server::{ServerCommand, ServerConfig},
    http::{Host, router},
    lifecycle::{Failure, backup},
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Method, Request, StatusCode},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    net::SocketAddr,
    os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
};
use tower::ServiceExt;

const ORIGIN: &str = "https://127.0.0.1:48743";
const ORIGINAL: &[u8] = b"Synthetic recovery original \xce\xb1.\n";

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn config(root: &Path, data: &str) -> ServerConfig {
    serde_json::from_value(json!({
        "schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join(data),
        "logDirectory":root.join(data).join("logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused-certificate.pem"),"tlsPrivateKey":root.join("unused-key.pem"),
        "listen":"127.0.0.1:48743","origin":ORIGIN,
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{
            "userId":id(4),"actorId":id(5),"username":"synthetic-local",
            "scope":{"workspaceId":id(2),"homeId":id(3)}}}
    }))
    .unwrap()
}

fn request(
    method: Method,
    path: &str,
    body: Vec<u8>,
    kind: Option<&str>,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-length", body.len());
    for (name, value) in [
        ("content-type", kind),
        ("cookie", cookie),
        ("x-atlas-csrf", csrf),
    ] {
        if let Some(value) = value {
            builder = builder.header(name, value);
        }
    }
    let mut request = builder.body(Body::from(body)).unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50123".parse::<SocketAddr>().unwrap(),
    ));
    request
}

async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Vec<u8>) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    (
        status,
        to_bytes(response.into_body(), 4 << 20)
            .await
            .unwrap()
            .to_vec(),
    )
}

async fn json(
    app: &Router,
    method: Method,
    path: &str,
    body: Vec<u8>,
    kind: Option<&str>,
    session: &(String, String),
) -> Value {
    let csrf = (method == Method::POST).then_some(session.1.as_str());
    let (status, bytes) = send(
        app,
        request(method, path, body, kind, Some(&session.0), csrf),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{path}: {}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}

/// Fresh loopback-local sign-in: cookie pair and CSRF token.
async fn login(app: &Router) -> (String, String) {
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            "/api/atlas/auth/local",
            b"{}".to_vec(),
            Some("application/json"),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let session: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    (cookie, session["csrfToken"].as_str().unwrap().to_owned())
}

fn app(config: &ServerConfig) -> (Router, super::ServerLease) {
    let (core, lease) = reopen(config).unwrap();
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])
        .unwrap()
        .with_loopback_local()
        .unwrap();
    (router(host), lease)
}

fn scope() -> String {
    format!("workspaces/{}/homes/{}", id(2), id(3))
}

/// Every stored record as the native read route returns it, and the original.
async fn observe(
    app: &Router,
    session: &(String, String),
    targets: &[(String, String)],
    asset: &str,
) -> (Vec<Value>, Vec<u8>) {
    let mut records = Vec::new();
    for (kind, record) in targets {
        let read = json(
            app,
            Method::GET,
            &format!("/api/atlas/stock/v3/{}/records/{kind}/{record}", scope()),
            vec![],
            None,
            session,
        )
        .await;
        assert_eq!(read["status"], "read");
        records.push(read["data"]["records"].clone());
    }
    let digest = crate::contracts::semantics::canonical_digest(
        &json!({"assetId":asset,"kind":"atlas-asset"}),
    )
    .unwrap();
    let path = format!("/api/atlas/media/{}/{}/{digest}/download", id(2), id(3));
    let (status, original) = send(
        app,
        request(Method::GET, &path, vec![], None, Some(&session.0), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (records, original)
}

/// Generated records and one original written through the real routes.
async fn populate(app: &Router, session: &(String, String)) -> (Vec<(String, String)>, String) {
    let context = json!({"workspaceId":id(2),"homeId":id(3)});
    let (evidence, identity, place) = (id(27001), id(27002), id(27003));
    let create = |kind: &str, record: &str, payload: Value, serial: u32| {
        json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.create"),"requestId":id(serial),
            "idempotencyKey":id(serial + 100),"context":context,
            "target":{"authority":"atlas","recordType":kind,"recordId":record},"payload":payload,
            "reason":"Synthetic recovery fixture","approvalReceiptId":null,
            "preconditions":{"target":null,"guards":[]}})
    };
    let batch = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(27100),
        "idempotencyKey":id(27200),"context":context,
        "target":{"authority":"atlas","kind":"batch","batchId":id(27300)},
        "payload":{"commands":[
            create("evidence", &evidence, json!({"statement":"Synthetic recovery evidence",
                "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
                    "evidenceBasis":"unknown","factAt":null,"retrievedAt":"2026-01-01T00:00:00Z",
                    "vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
                "supersedesEvidenceIds":[],"references":[]}), 27101),
            create("identity", &identity, json!({"kind":"location","evidenceIds":[evidence]}), 27102),
            create("location-semantics", &place, json!({"atlasId":identity,"semanticKind":"other",
                "reviewStatus":"accepted","evidenceIds":[evidence],"label":"Synthetic recovery place"}), 27103)
        ]},"reason":"Synthetic recovery fixture","approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[]}});
    let committed = json(
        app,
        Method::POST,
        &format!("/api/atlas/stock/v3/{}/commands", scope()),
        serde_json::to_vec(&batch).unwrap(),
        Some("application/json"),
        session,
    )
    .await;
    assert_eq!(committed["status"], "committed");
    let place_path = format!("/api/atlas/editing/v1/{}/native-places/{place}", scope());
    let admission = json(app, Method::GET, &place_path, vec![], None, session).await;
    let metadata = json!({"schemaVersion":2,"requestId":id(27400),"idempotencyKey":id(27500),
        "context":context,"recordId":place,"expectedRevision":admission["record"]["revision"],
        "guards":admission["guards"],"statement":"Synthetic recovery original",
        "sourceLicense":{"status":"unknown","reference":null},"reason":"Synthetic recovery fixture",
        "filename":"synthetic-recovery.txt","contentType":"text/plain",
        "capture":{"schemaVersion":1,"selectionMethod":"file-picker","selectedAt":"2026-01-01T00:00:00Z",
            "filename":"synthetic-recovery.txt","reportedContentType":"text/plain",
            "byteOrigin":"browser-returned-unmodified"}});
    let boundary = "houseatlas-recovery-fixture";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic-recovery.txt\"\r\nContent-Type: text/plain\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(ORIGINAL);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut upload = request(
        Method::POST,
        &format!("{place_path}/evidence"),
        body,
        Some(&format!("multipart/form-data; boundary={boundary}")),
        Some(&session.0),
        Some(&session.1),
    );
    upload
        .headers_mut()
        .insert("x-atlas-upload-request-id", id(27400).parse().unwrap());
    let (status, bytes) = send(app, upload).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let result: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(result["status"], "committed");
    let mut targets = vec![
        ("evidence".to_owned(), evidence),
        ("identity".to_owned(), identity),
        ("location-semantics".to_owned(), place),
    ];
    let mut asset = String::new();
    for record in result["data"]["records"].as_array().unwrap() {
        let kind = record["target"]["recordType"].as_str().unwrap().to_owned();
        let id = record["target"]["recordId"].as_str().unwrap().to_owned();
        if kind == "asset" {
            asset = id.clone();
        }
        if !targets.iter().any(|(_, known)| *known == id) {
            targets.push((kind, id));
        }
    }
    assert!(!asset.is_empty());
    (targets, asset)
}

/// Every file under a folder with its bytes, to prove the bundle is only read.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_owned()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    files
}

fn no_staging(root: &Path) -> bool {
    fs::read_dir(root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".houseatlas-restore-")
    })
}

struct Fixture {
    _temporary: tempfile::TempDir,
    root: PathBuf,
    bundle: PathBuf,
    targets: Vec<(String, String)>,
    asset: String,
    before: (Vec<Value>, Vec<u8>),
    session: (String, String),
}

fn fixture(runtime: &tokio::runtime::Runtime) -> Fixture {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()
        .unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let source = config(&root, "data");
    initialize_without_password(&source).unwrap();
    let (targets, asset, before, session) = runtime.block_on(async {
        let (app, lease) = app(&source);
        let session = login(&app).await;
        let (targets, asset) = populate(&app, &session).await;
        let before = observe(&app, &session, &targets, &asset).await;
        drop((app, lease));
        (targets, asset, before, session)
    });
    assert_eq!(before.1, ORIGINAL);
    let config_path = root.join("server-config.json");
    fs::write(&config_path, serde_json::to_vec(&source).unwrap()).unwrap();
    fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600)).unwrap();
    let bundle = root.join("bundle");
    let selection = backup::Selection::from_arguments(&[
        "--server-config".into(),
        config_path.to_str().unwrap().into(),
        "--destination".into(),
        bundle.to_str().unwrap().into(),
        "--profile".into(),
        backup::PROFILE.into(),
    ])
    .unwrap();
    assert_eq!(backup::capture(&selection).unwrap().asset_record_count, 1);
    Fixture {
        _temporary: temporary,
        root,
        bundle,
        targets,
        asset,
        before,
        session,
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn restored_bundle_is_adopted_into_a_new_data_directory_and_served() {
    let runtime = runtime();
    let fixture = fixture(&runtime);
    let bundle_before = snapshot(&fixture.bundle);
    let adopted = config(&fixture.root, "adopted");
    let report = initialize_from_backup(&adopted, None, &fixture.bundle).unwrap();
    assert_eq!(
        (report.asset_record_count, report.restored_original_count),
        (1, 1)
    );
    assert_eq!(snapshot(&fixture.bundle), bundle_before);
    assert!(no_staging(&fixture.root));
    // The receipt binds the moved files' inodes and the strict reopen accepts it.
    let receipt: super::State =
        serde_json::from_slice(&fs::read(fixture.root.join("adopted/server-state.json")).unwrap())
            .unwrap();
    assert_eq!(
        receipt.atlas_inode,
        fs::metadata(fixture.root.join("adopted/atlas.sqlite"))
            .unwrap()
            .ino()
    );
    runtime.block_on(async {
        let (app, lease) = app(&adopted);
        // Sessions are not restored: the source's cookie means nothing here.
        let (status, _) = send(
            &app,
            request(
                Method::GET,
                "/api/atlas/auth/session",
                vec![],
                None,
                Some(&fixture.session.0),
                None,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let session = login(&app).await;
        assert_eq!(
            observe(&app, &session, &fixture.targets, &fixture.asset).await,
            fixture.before
        );
        drop((app, lease));
    });
    // An ordinary restart reopens the adopted state unchanged.
    drop(reopen(&adopted).unwrap());
}

fn refused(result: Result<backup::RestoreCheckReport, Failure>) -> String {
    match result {
        Ok(_) => panic!("expected refusal"),
        Err(error) => error.to_string(),
    }
}

#[test]
fn adoption_refuses_existing_targets_and_unverified_bundles() {
    let runtime = runtime();
    let fixture = fixture(&runtime);
    let bundle_before = snapshot(&fixture.bundle);

    // An existing folder, empty or the source's own data directory (even while
    // its server holds it), is never adopted into.
    fs::create_dir(fixture.root.join("empty")).unwrap();
    assert!(
        refused(initialize_from_backup(
            &config(&fixture.root, "empty"),
            None,
            &fixture.bundle
        ))
        .contains("must not exist")
    );
    assert_eq!(fs::read_dir(fixture.root.join("empty")).unwrap().count(), 0);
    let source = config(&fixture.root, "data");
    let receipt = fs::read(fixture.root.join("data/server-state.json")).unwrap();
    let held = reopen(&source).unwrap();
    assert!(
        refused(initialize_from_backup(&source, None, &fixture.bundle)).contains("must not exist")
    );
    drop(held);
    assert_eq!(
        fs::read(fixture.root.join("data/server-state.json")).unwrap(),
        receipt
    );

    // Tampered or structurally wrong copies of the bundle fail verification.
    let original = fs::read_dir(fixture.bundle.join("originals"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .file_name();
    type Tamper = Box<dyn Fn(&Path)>;
    let tampers: [(&str, Tamper); 3] = [
        (
            "original",
            Box::new(move |b: &Path| {
                let path = b.join("originals").join(&original);
                let mut bytes = fs::read(&path).unwrap();
                bytes[0] ^= 1;
                fs::write(path, bytes).unwrap();
            }),
        ),
        (
            "database",
            Box::new(|b: &Path| {
                let path = b.join("atlas.sqlite");
                let mut bytes = fs::read(&path).unwrap();
                let last = bytes.len() - 1;
                bytes[last] ^= 1;
                fs::write(path, bytes).unwrap();
            }),
        ),
        (
            "extra member",
            Box::new(|b: &Path| fs::write(b.join("unexpected.txt"), b"x").unwrap()),
        ),
    ];
    for (index, (label, tamper)) in tampers.iter().enumerate() {
        let copy = fixture.root.join(format!("tampered-{index}"));
        fs::DirBuilder::new().mode(0o700).create(&copy).unwrap();
        for (path, bytes) in &bundle_before {
            let target = copy.join(path);
            fs::DirBuilder::new()
                .mode(0o700)
                .recursive(true)
                .create(target.parent().unwrap())
                .unwrap();
            fs::write(&target, bytes).unwrap();
        }
        tamper(&copy);
        // Keep the bundle's own read-only modes so only the tamper differs.
        for path in bundle_before.keys() {
            fs::set_permissions(
                copy.join(path),
                fs::metadata(fixture.bundle.join(path))
                    .unwrap()
                    .permissions(),
            )
            .unwrap();
        }
        let target = config(&fixture.root, &format!("refused-{index}"));
        let _ = refused(initialize_from_backup(&target, None, &copy));
        assert!(!target.data_directory.exists(), "{label}");
        assert!(no_staging(&fixture.root), "{label}");
    }
    assert_eq!(snapshot(&fixture.bundle), bundle_before);
}

fn staging(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".houseatlas-restore-"))
        .collect();
    names.sort();
    names
}

#[test]
fn interrupted_adoption_publishes_nothing_and_a_rerun_succeeds() {
    let runtime = runtime();
    let fixture = fixture(&runtime);
    let bundle_before = snapshot(&fixture.bundle);
    // A hard interruption can leave only unfinished staging beside the target;
    // it is never published and never blocks a rerun.
    let leftover = ".houseatlas-restore-interrupted";
    fs::DirBuilder::new()
        .mode(0o700)
        .recursive(true)
        .create(fixture.root.join(leftover).join("data/media"))
        .unwrap();
    for (index, point) in ["between-moves", "before-receipt", "before-publish"]
        .into_iter()
        .enumerate()
    {
        let target = config(&fixture.root, &format!("interrupted-{index}"));
        super::ADOPTION_FAULT.with(|fault| fault.set(Some(point)));
        let error = refused(initialize_from_backup(&target, None, &fixture.bundle));
        super::ADOPTION_FAULT.with(|fault| fault.set(None));
        assert!(error.contains(point), "{point}: {error}");
        assert!(!target.data_directory.exists(), "{point}");
        assert_eq!(staging(&fixture.root), [leftover], "{point}");
        // The same command then completes, and the strict reopen accepts it.
        initialize_from_backup(&target, None, &fixture.bundle).unwrap();
        drop(reopen(&target).unwrap());
    }
    // Gateway mode: the staged build uses its own socket path, while the
    // receipt is issued for the configured one.
    let mut wire = serde_json::to_value(config(&fixture.root, "gateway")).unwrap();
    let identity = wire["authentication"]["identity"].clone();
    wire["origin"] = json!("https://houseatlas.synthetic.ts.net");
    wire["authentication"] = json!({"mode":"trusted-proxy","identity":identity,
        "policy":{"userLogin":"synthetic@gateway","nodeTag":"tag:synthetic",
            "peerUid":rustix::process::geteuid().as_raw()},
        "socket":fixture.root.join("gateway/gateway.sock")});
    let gateway: ServerConfig = serde_json::from_value(wire).unwrap();
    initialize_from_backup(&gateway, None, &fixture.bundle).unwrap();
    drop(reopen(&gateway).unwrap());
    assert_eq!(staging(&fixture.root), [leftover]);
    assert_eq!(snapshot(&fixture.bundle), bundle_before);
}

#[test]
fn restore_bundle_option_is_explicit_and_initialize_only() {
    let temporary = tempfile::Builder::new()
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir()
        .unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    let path = root.join("server-config.json");
    fs::write(&path, serde_json::to_vec(&config(&root, "data")).unwrap()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let parse = |mode: &str, extra: &[&str]| {
        let mut arguments = vec![
            mode.to_owned(),
            "--server-config".into(),
            path.to_str().unwrap().into(),
        ];
        arguments.extend(extra.iter().map(|s| (*s).to_owned()));
        ServerCommand::from_arguments(&arguments)
    };
    let bundle = root.join("bundle");
    let bundle = bundle.to_str().unwrap();
    assert!(matches!(
        parse(
            "initialize",
            &["--restore-bundle", bundle, "--profile", backup::PROFILE]
        ),
        Ok(Some(ServerCommand::Initialize {
            restore_bundle: Some(_),
            ..
        }))
    ));
    for (mode, extra) in [
        ("initialize", vec!["--restore-bundle", bundle]),
        (
            "initialize",
            vec![
                "--restore-bundle",
                bundle,
                "--profile",
                "native-full-geodata-queue-free",
            ],
        ),
        ("initialize", vec!["--profile", backup::PROFILE]),
        (
            "initialize",
            vec![
                "--restore-bundle",
                "relative/bundle",
                "--profile",
                backup::PROFILE,
            ],
        ),
        (
            "serve",
            vec!["--restore-bundle", bundle, "--profile", backup::PROFILE],
        ),
    ] {
        assert!(parse(mode, &extra).is_err(), "{mode} {extra:?}");
    }
}
