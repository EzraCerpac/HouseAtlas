//! Healthy synthetic quantity HTTP flow with exact per-client loopback TLS trust.
//! Retains end-unproven native activity and its physical hold; no retry or release.
use crate::providers::homebox::write::stock::*;
use crate::{
    access as a,
    app::RequestPrincipal,
    config::providers::quantity_installation::{
        OriginalQuantityConfigured, QuantityInstallationArtifacts, QuantityInstallationInput,
    },
    http::contracts::NativeContracts,
    jobs as j,
    providers::homebox::read,
    storage as s,
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

fn id(n: u64) -> Uuid {
    Uuid::parse_str(&format!("00000000-0000-4000-8000-{n:012}")).unwrap()
}
fn aid(n: u64) -> a::CanonicalId {
    a::CanonicalId::parse(id(n).to_string()).unwrap()
}
const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-test-password-only!";
fn digest_bytes(bytes: &[u8]) -> Digest {
    use sha2::{Digest as _, Sha256};
    Digest::parse(format!("{:x}", Sha256::digest(bytes))).unwrap()
}
fn digest_value(value: &Value) -> Digest {
    Digest::parse(crate::contracts::semantics::canonical_digest(value).unwrap()).unwrap()
}
const REPO_PATH: &str = "backend/internal/data/repo/repo_entities.go";
const HANDLER_PATH: &str = "backend/app/api/handlers/v1/v1_ctrl_entities.go";
const SWAGGER_PATH: &str = "backend/app/api/static/docs/swagger.json";

// The caller explicitly supplies downloaded public source references. This
// helper never downloads anything and absence fails the named positive test.
fn reference_artifacts(root: &Path) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let bytes = ["repo_entities.go", "v1_ctrl_entities.go", "swagger.json"]
        .map(|name| std::fs::read(root.join(name)).unwrap());
    assert_eq!(bytes[0].len(), 87660);
    assert_eq!(
        digest_bytes(&bytes[0]).as_str(),
        "56758719661cf36f2799879656519589a7a89b5dcc66341f1abcb7a43cf353d8"
    );
    assert_eq!(bytes[1].len(), 19776);
    assert_eq!(
        digest_bytes(&bytes[1]).as_str(),
        "4e8064b6dd63fdbdd65e466a470aaef44838d7e23fb10ba3fe0764a2a65d29d4"
    );
    assert_eq!(bytes[2].len(), 216647);
    assert_eq!(
        digest_bytes(&bytes[2]).as_str(),
        "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493"
    );
    let [repository, handler, swagger] = bytes;
    (repository, handler, swagger)
}
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::BTreeMap,
    net::{Ipv4Addr, SocketAddr},
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

fn setup_native(
    directory: &Path,
    provider_origin: &str,
) -> (
    crate::app::Core,
    Arc<OriginalQuantityConfigured>,
    PathBuf,
    a::SourceRef,
    Arc<Mutex<a::AccessBoundary>>,
) {
    let access_scope = a::Scope {
        workspace_id: aid(1),
        home_id: aid(2),
    };
    let registration = a::SourceRegistration {
        workspace_id: aid(1),
        home_id: aid(2),
        source_instance_id: aid(10),
        collection_id: id(4).to_string(),
        owner: a::SourceOwner::Homebox,
        partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(2).to_string(), id(1).to_string()],
    };
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    boundary
        .provision_user(
            &aid(6),
            &aid(7),
            "synthetic-editor",
            &a::hash_password(PASSWORD).unwrap(),
            None,
        )
        .unwrap();
    boundary
        .set_membership(&aid(6), &access_scope, a::Role::Editor, true)
        .unwrap();
    boundary.put_source(&registration, None).unwrap();
    let mut request_evidence = a::RequestEvidence {
        method: a::Method::Post,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie: None,
        csrf: None,
        authorization: None,
    };
    let session = boundary
        .login(
            &request_evidence,
            &serde_json::to_vec(&json!({"username":"synthetic-editor","password":PASSWORD}))
                .unwrap(),
            "synthetic-quantity",
        )
        .unwrap();
    request_evidence.cookie = Some(session.set_cookie().split(';').next().unwrap());
    request_evidence.csrf = Some(session.info().csrf_token());
    let request = RequestPrincipal::new(
        boundary
            .authorize(&request_evidence, &access_scope, a::Action::Mutate)
            .unwrap(),
    );
    let source_ref = a::SourceRef {
        workspace_id: aid(1),
        home_id: aid(2),
        key: a::SourceKey {
            source_instance_id: aid(10),
            collection_id: id(4).to_string(),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: id(2).to_string(),
        },
    };
    request.capture_source(&boundary, &source_ref).unwrap();
    request
        .capture_partition(&boundary, &registration.partition())
        .unwrap();
    request.captured_source(&source_ref).unwrap();
    let partition_grant = request
        .captured_partition(&registration.partition())
        .unwrap();
    // Setup exports persisted source metadata only. The actual HTTP preview
    // below issues and retains its own original mutation principal and grants.
    let original = request.principal.clone();
    let principal = original.principal();
    let mut exported_metadata = None;
    boundary
        .with_mutation_authorization(principal, |guard| -> a::AccessResult<()> {
            assert!(std::ptr::eq(guard.principal(), principal));
            exported_metadata = Some(guard.persisted_source_metadata(&partition_grant)?);
            Ok(())
        })
        .unwrap();
    let metadata = exported_metadata.unwrap();
    assert_eq!(metadata.registration(), &registration);
    assert_eq!(metadata.source_registration_version(), 1);
    let reference_root = PathBuf::from(
        std::env::var_os("HOUSEATLAS_QUANTITY_REFERENCE_DIR")
            .expect("explicit public pinned reference directory is required"),
    );
    assert!(reference_root.is_absolute());
    let (repository_bytes, handler_bytes, swagger_bytes) = reference_artifacts(&reference_root);
    let fixture_root = std::fs::canonicalize(directory).unwrap();
    let artifact_root = fixture_root.join("artifacts");
    std::fs::create_dir(&artifact_root).unwrap();
    std::fs::set_permissions(&artifact_root, std::fs::Permissions::from_mode(0o700)).unwrap();
    // Deliberately supplied synthetic executable bytes; never executed. Public
    // pinned Go and Swagger bytes are actual files captured by the normal owner.
    let executable_bytes = b"Synthetic quantity executable fixture bytes, never executed.\n";
    let executable_path = artifact_root.join("homebox.fixture");
    let provenance_path = artifact_root.join("build-provenance.json");
    let repository_path = artifact_root.join("repo_entities.go");
    let handler_path = artifact_root.join("v1_ctrl_entities.go");
    let swagger_path = artifact_root.join("swagger.json");
    std::fs::write(&executable_path, executable_bytes).unwrap();
    std::fs::write(&repository_path, &repository_bytes).unwrap();
    std::fs::write(&handler_path, &handler_bytes).unwrap();
    std::fs::write(&swagger_path, &swagger_bytes).unwrap();
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../contracts/stock-wire3/agent/operation-catalog.json"
    ))
    .unwrap();
    let routes: Value = serde_json::from_slice(&swagger_bytes).unwrap();
    let catalog_digest = digest_value(&catalog);
    let route_digest = digest_value(&routes);
    let build_digest = digest_bytes(executable_bytes);
    let configuration_digest = digest_value(&json!({"syntheticPhysicalConfiguration":id(4)}));
    let physical_binding = PhysicalBinding {
        deployment_id: id(104),
        physical_database_id: id(105),
        configuration_digest: configuration_digest.clone(),
    };
    let target = StockTarget {
        source_instance_id: id(10),
        collection_id: id(4),
        resource_kind: ResourceKind::Entity,
        resource_id: Some(id(2)),
        entity_id: None,
    };
    let context = Context {
        workspace_id: id(1),
        home_id: id(2),
    };
    let reviewed_policy = json!({"policyId":"synthetic-explicit-quantity-policy", "policyVersion":1,"policyEpoch":1,
        "actorId":id(7),"context":context,"target":target,"accountId":"synthetic-account","groupId":"synthetic-group",
        "physicalBinding":{"deploymentId":id(104),"physicalDatabaseId":id(105),"configurationDigest":configuration_digest},
        "dispatcherOwnerId":id(106),"dispatcherEpoch":1,"sourceEpoch":1,"approvalRequirement":"human-required",
        "maximum":2,"freshnessMillis":60000});
    let policy_digest = digest_value(&reviewed_policy);
    let authority = StockAuthority {
        actor_id: id(7),
        source_epoch: 1,
        authority_digest: policy_digest.clone(),
        physical_binding: physical_binding.clone(),
        qualification: NativeQualification::Qualified {
            catalog_digest: catalog_digest.clone(),
            registered_build_digest: build_digest.clone(),
            route_qualification_digest: route_digest.clone(),
        },
    };
    let descriptor = QuantityProfileDescriptor {
        source_commit: NATIVE_SOURCE_COMMIT.into(),
        version: read::HOMEBOX_REFERENCE_VERSION.into(),
        build_digest: build_digest.clone(),
        catalog_digest,
        route_digest,
        group_id: "synthetic-group".into(),
        account_id: "synthetic-account".into(),
        scope: context.clone(),
        target: target.clone(),
        metadata: metadata.clone(),
        authority: authority.clone(),
        dispatcher_epoch: 1,
        policy_digest,
        policy: QuantityPolicy::HumanRequired,
        freshness: Duration::from_secs(60),
    };
    let provenance = json!({"schemaVersion":1,"release":read::HOMEBOX_REFERENCE_VERSION,"sourceCommit":NATIVE_SOURCE_COMMIT,
        "executableSha256":build_digest,"sourceArtifacts":[
            {"path":REPO_PATH,"sha256":digest_bytes(&repository_bytes),"bytes":repository_bytes.len()},
            {"path":HANDLER_PATH,"sha256":digest_bytes(&handler_bytes),"bytes":handler_bytes.len()},
            {"path":SWAGGER_PATH,"sha256":digest_bytes(&swagger_bytes),"bytes":swagger_bytes.len()}],
        "customPatches":[],"reviewedQuantityPolicy":reviewed_policy});
    let provenance_bytes = serde_json::to_vec(&provenance).unwrap();
    std::fs::write(&provenance_path, &provenance_bytes).unwrap();
    let queue = j::QueueConfig {
        lease_duration_ms: 1000,
        retry: j::RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 1,
            max_delay_ms: 1,
        },
        registration: j::QueueRegistration {
            identity: j::PhysicalQueueIdentity {
                deployment_id: id(104).to_string(),
                physical_database_id: id(105).to_string(),
                configuration_digest: j::Digest::from_hex(configuration_digest.as_str().into())
                    .unwrap(),
            },
            dispatcher_owner_id: id(106).to_string(),
            aliases: vec![j::SourceAlias {
                partition: j::SourcePartition {
                    workspace_id: id(1).to_string(),
                    home_id: id(2).to_string(),
                    source_instance_id: id(10).to_string(),
                    collection_id: id(4).to_string(),
                },
                canonical_collection_id: id(4).to_string(),
            }],
        },
        admission_profile: j::AdmissionProfile::stock_engineering_fixture(),
    };
    queue.validate().unwrap();
    let physical = s::StockActivityPhysicalRegistration {
        physical_binding: physical_binding.clone(),
        owner_id: id(106),
        dispatcher_epoch: 1,
    };
    let access = Arc::new(Mutex::new(boundary));
    let vault =
        Arc::new(crate::media::AssetVault::open(&fixture_root.join("empty-vault")).unwrap());
    let database = fixture_root.join("native-store.sqlite");
    let store = s::AtlasStore::open(
        &database,
        NativeContracts,
        crate::app::ReadAuthority(Arc::clone(&access)),
        crate::media::native::NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: crate::app::ServerRuntime,
        },
        s::StoreOptions {
            stock_activity_profile: true,
            ..s::StoreOptions::default()
        },
    )
    .unwrap();
    // Explicit trusted synthetic startup rows on this disposable empty native
    // Store. This is setup data, before observations; it invokes no registration
    // callback, queue session, admission, reservation or activity transition.
    install_startup_rows(&database, &queue, &physical);
    let home = crate::domain::HomeSummary {
        scope: crate::domain::Scope {
            workspace_id: id(1).to_string(),
            home_id: id(2).to_string(),
        },
        label: "Synthetic home".into(),
    };
    let core = crate::app::Core {
        access: Arc::clone(&access),
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: crate::domain::stock::AtlasListPages::default(),
        media_policy_evidence: Mutex::new(
            crate::media::recovery_policy::MediaPolicyEvidence::default(),
        ),
        vault,
        home: home.clone(),
        homes: vec![home],
    };
    let durable_registration: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let registry_config =
        crate::config::providers::registry::ProviderRegistry::from_trusted_configuration(vec![
            durable_registration.clone(),
        ])
        .unwrap();
    let configured_source = Arc::clone(registry_config.find(&registration.partition()).unwrap());
    let homebox = Arc::new(
        crate::config::providers::homebox::TrustedHomeBoxSource::new_stock(
            provider_origin,
            durable_registration,
            read::Limits::default(),
            None,
        )
        .unwrap(),
    );
    let credentials = Arc::new(
        read::NativeReadCredentialConfig::from_trusted_header(
            &homebox.endpoint().unwrap(),
            b"Bearer synthetic-fixture-only".to_vec(),
        )
        .unwrap(),
    );
    let configured = core
        .quantity_installation_configuration(
            configured_source,
            homebox,
            credentials,
            QuantityInstallationInput {
                descriptor,
                artifacts: QuantityInstallationArtifacts::new(
                    executable_path,
                    provenance_path,
                    repository_path,
                    handler_path,
                    swagger_path,
                )
                .unwrap(),
                reviewed_policy: reviewed_policy.clone(),
                queue: queue.clone(),
                physical: physical.clone(),
            },
        )
        .unwrap();
    (core, configured, database, source_ref, access)
}
fn install_startup_rows(
    database: &Path,
    queue: &j::QueueConfig,
    physical: &s::StockActivityPhysicalRegistration,
) {
    let profile = &queue.admission_profile;
    let registration = &queue.registration;
    let config = json!({"lease":queue.lease_duration_ms.to_string(),"retry":{"maxAttempts":queue.retry.max_attempts,
        "initial":queue.retry.initial_delay_ms.to_string(),"max":queue.retry.max_delay_ms.to_string()},
        "identity":{"deployment":registration.identity.deployment_id,"physical":registration.identity.physical_database_id,
        "digest":registration.identity.configuration_digest.as_hex()},"owner":registration.dispatcher_owner_id,
        "aliases":registration.aliases.iter().map(|alias| json!({"workspace":alias.partition.workspace_id,
            "home":alias.partition.home_id,"source":alias.partition.source_instance_id,"collection":alias.partition.collection_id,
            "canonical":alias.canonical_collection_id})).collect::<Vec<_>>(),
        "profile":{"version":profile.profile_version,"qualification":{"kind":"offline"},"waiting":profile.max_waiting_intents,
            "waitMs":profile.max_admission_wait_ms.to_string(),"attempts":profile.max_unresolved_storage_attempts,
            "bytes":profile.max_unresolved_storage_bytes.to_string()}});
    let mut db = rusqlite::Connection::open(database).unwrap();
    let tx = db.transaction().unwrap();
    tx.execute("INSERT INTO queue_physical(deployment_id,physical_database_id,configuration_digest,configuration_json,owner_id,next_sequence,fence) VALUES(?1,?2,?3,?4,?5,'0','0')",
        rusqlite::params![registration.identity.deployment_id,registration.identity.physical_database_id,
            registration.identity.configuration_digest.as_hex(),serde_json::to_string(&config).unwrap(),registration.dispatcher_owner_id]).unwrap();
    for alias in &registration.aliases {
        tx.execute(
            "INSERT INTO queue_aliases VALUES(?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                registration.identity.deployment_id,
                registration.identity.physical_database_id,
                alias.partition.workspace_id,
                alias.partition.home_id,
                alias.partition.source_instance_id,
                alias.partition.collection_id,
                alias.canonical_collection_id
            ],
        )
        .unwrap();
    }
    tx.execute(
        "INSERT INTO stock_activity_physical VALUES(?1,?2,?3,?4,?5,NULL)",
        rusqlite::params![
            physical.physical_binding.physical_database_id.to_string(),
            physical.physical_binding.deployment_id.to_string(),
            physical.physical_binding.configuration_digest.as_str(),
            physical.owner_id.to_string(),
            physical.dispatcher_epoch.to_string()
        ],
    )
    .unwrap();
    tx.commit().unwrap();
}

#[derive(Debug)]
struct NativeRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn entity_bodies() -> (Vec<u8>, Vec<u8>) {
    let before = include_str!("../providers/homebox/wire/fixtures/item.detail.json")
        .replacen("\"quantity\": 1.5", "\"quantity\": 1", 1)
        .replacen("\"purchasePrice\": 0", "\"purchasePrice\": 1.2300e+2", 1)
        .replacen(
            "\"fields\": null",
            "\"fields\": null, \"nativeExtension\": 9007199254740993",
            1,
        )
        .into_bytes();
    let after = String::from_utf8(before.clone())
        .unwrap()
        .replacen("\"quantity\": 1", "\"quantity\": 2", 1)
        .into_bytes();
    let before_value: Value = serde_json::from_slice(&before).unwrap();
    let after_value: Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(before_value["id"], id(2).to_string());
    assert_eq!(before_value["quantity"], 1);
    assert_eq!(after_value["quantity"], 2);
    for value in [&before_value, &after_value] {
        assert_eq!(value["purchasePrice"].to_string(), "1.2300e+2");
        assert_eq!(value["nativeExtension"].to_string(), "9007199254740993");
        assert_eq!(value["updatedAt"], "2026-01-02T03:04:05.1200+02:00");
        assert_eq!(value["attachments"][0]["path"], "private/blob-key.pdf");
    }
    (before, after)
}

async fn provider_request<S: tokio::io::AsyncRead + Unpin>(
    stream: &mut S,
) -> (String, BTreeMap<String, String>, Vec<u8>) {
    let mut raw = Vec::new();
    while !raw.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).await.unwrap();
        raw.push(byte[0]);
        assert!(raw.len() <= 16384);
    }
    let head = String::from_utf8(raw).unwrap();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap().to_owned();
    let mut headers = BTreeMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').unwrap();
        assert!(
            headers
                .insert(key.to_ascii_lowercase(), value.trim().to_owned())
                .is_none()
        );
    }
    let length = headers
        .get("content-length")
        .map(|text| text.parse::<usize>().unwrap())
        .unwrap_or(0);
    assert!(length <= 4096);
    let mut body = vec![0; length];
    stream.read_exact(&mut body).await.unwrap();
    (request_line, headers, body)
}

async fn native_provider(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    before: Vec<u8>,
    after: Vec<u8>,
    access: Arc<Mutex<a::AccessBoundary>>,
    store: Arc<Mutex<crate::app::Store>>,
) -> Vec<NativeRequest> {
    let path = format!("/api/v1/entities/{}", id(2));
    let mut observed = Vec::new();
    let mut quantity_changed = false;
    for expected_method in ["GET", "GET", "PATCH", "GET"] {
        let (socket, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut stream = acceptor.accept(socket).await.unwrap();
        let (request_line, headers, body) = provider_request(&mut stream).await;
        // Ordinary positive custody assertions: neither lock crosses native I/O.
        assert!(store.try_lock().is_ok());
        assert!(access.try_lock().is_ok());
        let pieces: Vec<_> = request_line.split_whitespace().collect();
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces[0], expected_method);
        assert_eq!(pieces[1], path);
        assert_eq!(pieces[2], "HTTP/1.1");
        assert_eq!(headers.get("x-tenant"), Some(&id(4).to_string()));
        assert!(
            headers
                .get("authorization")
                .is_some_and(|value| value == "Bearer synthetic-fixture-only")
        );
        assert_eq!(
            headers.get("accept-encoding").map(String::as_str),
            Some("identity")
        );
        let response = if expected_method == "PATCH" {
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap(),
                json!({"quantity":2})
            );
            assert_eq!(body.as_slice(), b"{\"quantity\":2}");
            assert!(!quantity_changed);
            quantity_changed = true;
            &after
        } else {
            assert!(body.is_empty());
            if quantity_changed { &after } else { &before }
        };
        let response_value: Value = serde_json::from_slice(response).unwrap();
        assert_eq!(
            response_value["quantity"],
            if quantity_changed { 2 } else { 1 }
        );
        // Successful native HTTP receipt, with exact body bytes preserved.
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",response.len()).as_bytes()).await.unwrap();
        stream.write_all(response).await.unwrap();
        stream.shutdown().await.unwrap();
        observed.push(NativeRequest {
            method: pieces[0].into(),
            path: pieces[1].into(),
            body,
        });
    }
    assert!(quantity_changed);
    observed
}

async fn router_post(
    router: &axum::Router,
    path: &str,
    body: Value,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> (Value, Option<String>) {
    let bytes = serde_json::to_vec(&body).unwrap();
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "atlas.synthetic.invalid")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .header("content-length", bytes.len());
    if let Some(cookie) = cookie {
        builder = builder.header("cookie", cookie);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-atlas-csrf", csrf);
    }
    let mut request = builder.body(Body::from(bytes)).unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 38101))));
    let response = router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers().get("set-cookie").map(|value| {
        value
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned()
    });
    let value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1_048_576).await.unwrap()).unwrap();
    (value, cookie)
}

fn cache_snapshot(database: &Path) -> BTreeMap<String, Vec<String>> {
    let db = rusqlite::Connection::open(database).unwrap();
    let mut snapshot = BTreeMap::new();
    // Actual durable cache/projection data and cache identity/freshness counters.
    // The native quantity GET source does not publish any cache generation.
    for table in ["caches", "projections", "cache_generations", "cache_epochs"] {
        let mut statement = db.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let columns = statement.column_count();
        let mut rows = statement.query_map([],|row| {
            let cells = (0..columns).map(|column| {
                use rusqlite::types::ValueRef;
                Ok(match row.get_ref(column)? {
                    ValueRef::Null => json!({"null":true}),
                    ValueRef::Integer(value) => json!({"integer":value.to_string()}),
                    ValueRef::Real(value) => json!({"realBits":format!("{:016x}",value.to_bits())}),
                    ValueRef::Text(value) => json!({"text":std::str::from_utf8(value).unwrap()}),
                    ValueRef::Blob(value) => json!({"blob":value.iter().map(|byte|format!("{byte:02x}")).collect::<String>()}),
                })
            }).collect::<rusqlite::Result<Vec<Value>>>()?;
            Ok(serde_json::to_string(&cells).unwrap())
        }).unwrap().collect::<rusqlite::Result<Vec<String>>>().unwrap();
        rows.sort();
        snapshot.insert(table.into(), rows);
    }
    snapshot
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn healthy_quantity_human_http_preview_approval_native_journal_and_readback() {
    tokio::time::timeout(Duration::from_secs(30), healthy_http())
        .await
        .unwrap();
}

async fn healthy_http() {
    // This complete body is a proposal for root review. None of its runtime
    // operations may execute until root accepts the exact helper/test source.
    let directory = tempfile::Builder::new()
        .prefix("houseatlas-quantity-human-http-")
        .tempdir_in("/tmp")
        .unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = std::fs::canonicalize(directory.path()).unwrap();
    assert!(root.is_absolute());
    let certificate = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let leaf_der = certificate.cert.der().to_vec();
    let server = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![certificate.cert.der().clone()],
        PrivatePkcs8KeyDer::from(certificate.signing_key.serialize_der()).into(),
    )
    .unwrap();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let provider_origin = format!("https://{}", listener.local_addr().unwrap());
    let (core, configured, database, source_ref, access) = setup_native(&root, &provider_origin);
    let store = Arc::clone(&core.store);
    let before_cache = cache_snapshot(&database);
    let (before, after) = entity_bodies();
    let expected_before: Value = serde_json::from_slice(&before).unwrap();
    let expected_after: Value = serde_json::from_slice(&after).unwrap();
    let provider = tokio::spawn(native_provider(
        listener,
        TlsAcceptor::from(Arc::new(server)),
        before,
        after,
        Arc::clone(&access),
        Arc::clone(&store),
    ));
    let host = crate::http::Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), Vec::new())
        .unwrap()
        .with_quantity_installations(vec![Arc::clone(&configured)])
        .unwrap()
        // Exact selected configuration and generated leaf trust only its worker paths.
        .with_quantity_tls_fixture(Arc::clone(&configured), leaf_der)
        .unwrap();
    let router = crate::http::router(host);
    let (session, cookie) = router_post(
        &router,
        "/api/atlas/auth/login",
        json!({"username":"synthetic-editor","password":PASSWORD}),
        None,
        None,
    )
    .await;
    assert_eq!(session["actorId"], id(7).to_string());
    let cookie = cookie.unwrap();
    let csrf = session["csrfToken"].as_str().unwrap();
    let (preview,_) = router_post(&router,"/api/atlas/homebox/quantity/preview",
        json!({"source":source_ref,"quantity":2,"reason":"Synthetic explicit human quantity consent"}),Some(&cookie),Some(csrf)).await;
    assert_eq!(preview["format"], "atlas-homebox-quantity-preview/1");
    assert_eq!(
        preview["source"],
        serde_json::to_value(&source_ref).unwrap()
    );
    assert_eq!(
        preview["observed"]["quantity"],
        expected_before["quantity"].to_string()
    );
    assert_eq!(
        preview["observed"]["updatedAt"],
        expected_before["updatedAt"]
    );
    read::Timestamp::parse(preview["observed"]["retrievedAt"].as_str().unwrap()).unwrap();
    assert_eq!(preview["effect"]["quantity"], 2);
    assert_eq!(preview["effect"]["method"], "PATCH");
    assert_eq!(
        preview["effect"]["path"],
        format!("/api/v1/entities/{}", id(2))
    );
    assert_eq!(preview["effect"]["body"], json!({"quantity":2}));
    assert_eq!(preview["policy"]["approval"], "human-required");
    assert_eq!(preview["policy"]["maximumQuantity"], 2);
    let immutable_request = preview["request"].clone();
    let reserved_receipt = immutable_request["approvalReceiptId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(!Uuid::parse_str(&reserved_receipt).unwrap().is_nil());
    let preview_id = preview["previewId"].clone();
    let request_digest = preview["requestDigest"].clone();
    let plan_digest = preview["planDigest"].clone();
    let (approval, _) = router_post(
        &router,
        "/api/atlas/homebox/quantity/approval",
        json!({"previewId":preview_id,"requestDigest":request_digest,"planDigest":plan_digest,
            "policyId":preview["policy"]["id"],"policyVersion":preview["policy"]["version"],
            "policyEpoch":preview["policy"]["epoch"],"acknowledgement":true}),
        Some(&cookie),
        Some(csrf),
    )
    .await;
    assert_eq!(approval["format"], "atlas-homebox-quantity-approval/1");
    assert_eq!(approval["approvalReceiptId"], reserved_receipt);
    assert_eq!(approval["requestDigest"], request_digest);
    assert_eq!(approval["planDigest"], plan_digest);
    let (result, _) = router_post(
        &router,
        "/api/atlas/homebox/quantity/dispatch",
        json!({"previewId":preview_id,"requestDigest":request_digest,"planDigest":plan_digest,
            "approvalReceiptId":reserved_receipt}),
        Some(&cookie),
        Some(csrf),
    )
    .await;
    assert_eq!(result["format"], "atlas-homebox-quantity-result/1");
    assert_eq!(result["requestDigest"], request_digest);
    assert_eq!(result["planDigest"], plan_digest);
    let outcome: &Value = &result["result"];
    assert_eq!(outcome["state"], "confirmed-observed");
    assert_eq!(outcome["verification"], "observed-after-write");
    assert_eq!(outcome["responseSuccess"], true);
    assert_eq!(outcome["readbackAgrees"], true);
    assert_eq!(outcome["generatedIdentityResolved"], true);
    assert_eq!(outcome["causalityProven"], false);
    assert_eq!(outcome["atomicProviderCAS"], false);
    assert_eq!(outcome["nativeEditorRacePossible"], true);
    assert_eq!(outcome["unknownScopeFenceRetained"], false);
    assert_eq!(outcome["remoteActivity"]["state"], "end-unproven");
    assert_eq!(
        outcome["remoteActivity"]["terminationEvidenceDigest"],
        Value::Null
    );
    Digest::parse(outcome["responseDigest"].as_str().unwrap().into()).unwrap();
    Digest::parse(outcome["readbackDigest"].as_str().unwrap().into()).unwrap();
    read::Timestamp::parse(outcome["observedAt"].as_str().unwrap()).unwrap();
    let observed = provider.await.unwrap();
    assert_eq!(observed.len(), 4);
    assert_eq!(
        observed
            .iter()
            .map(|request| request.method.as_str())
            .collect::<Vec<_>>(),
        vec!["GET", "GET", "PATCH", "GET"]
    );
    for request in &observed {
        assert_eq!(request.path, format!("/api/v1/entities/{}", id(2)));
    }
    assert_eq!(
        serde_json::from_slice::<Value>(&observed[2].body).unwrap(),
        json!({"quantity":2})
    );
    assert_eq!(expected_after["quantity"], 2);
    assert_eq!(expected_after["purchasePrice"].to_string(), "1.2300e+2");
    assert_eq!(
        expected_after["nativeExtension"].to_string(),
        "9007199254740993"
    );
    assert_eq!(cache_snapshot(&database), before_cache);
    let audit = rusqlite::Connection::open(&database).unwrap();
    let queues: i64 = audit
        .query_row("SELECT count(*) FROM queue_jobs", [], |row| row.get(0))
        .unwrap();
    assert_eq!(queues, 0);
    let (operation_id,operation_json,body_accepted,active_operation_id):(String,String,bool,Option<String>) = audit.query_row(
        "SELECT o.operation_id,o.operation_json,o.body_accepted,p.active_operation_id FROM stock_activity_operations o JOIN stock_activity_physical p USING(physical_database_id)",
        [],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap();
    assert_eq!(outcome["operationId"], operation_id);
    assert!(body_accepted);
    assert_eq!(active_operation_id, Some(operation_id.clone()));
    let operation: Value = serde_json::from_str(&operation_json).unwrap();
    assert_eq!(
        operation["payload"]["command"]["original_wire"],
        immutable_request
    );
    assert_eq!(
        operation["payload"]["command"]["approval_receipt_id"],
        reserved_receipt
    );
    assert_eq!(operation["payload"]["outcome"], *outcome);
    let approvals: Vec<(String, String, String)> = audit
        .prepare(
            "SELECT operation_id,approval_receipt_id,evidence_digest FROM stock_activity_approvals",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].0, operation_id);
    assert_eq!(approvals[0].1, reserved_receipt);
    assert_eq!(approvals[0].2, approval["evidenceDigest"].as_str().unwrap());
    let admission_facts: String = audit
        .query_row(
            "SELECT facts_json FROM stock_activity_events WHERE operation_id=?1 AND kind='admit'",
            [&operation_id],
            |row| row.get(0),
        )
        .unwrap();
    let admission: Value = serde_json::from_str(&admission_facts).unwrap();
    assert_eq!(admission["payload"]["permit"]["operationId"], operation_id);
    assert_eq!(
        admission["payload"]["preflight"]["requestDigest"],
        request_digest
    );
    assert_eq!(
        admission["payload"]["evidence"]["approval"]["receiptId"],
        reserved_receipt
    );
    assert_eq!(
        admission["payload"]["evidence"]["approval"]["evidenceDigest"],
        approval["evidenceDigest"]
    );
    let events: Vec<(String, String)> = audit
        .prepare("SELECT kind,operation_json FROM stock_activity_events ORDER BY sequence")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.0.as_str())
            .collect::<Vec<_>>(),
        vec!["reserve", "admit", "dispatch", "observation"]
    );
    for (_, wire) in &events {
        let saved: Value = serde_json::from_str(wire).unwrap();
        assert_eq!(
            saved["payload"]["command"]["original_wire"],
            immutable_request
        );
        assert_eq!(
            saved["payload"]["command"]["approval_receipt_id"],
            reserved_receipt
        );
    }
    // Successful response/readback is observational. EndUnproven remains in
    // the actual journal, and the physical slot remains held; no retry/release
    // or durable evidence is constructed from a response DTO in this fixture.
}
