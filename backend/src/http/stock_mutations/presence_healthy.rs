//! One fresh synthetic configured Presence command and strict same-file reopen.
//! The exact body is source-only until its ordinary healthy scope is reviewed.
use super::{ConfiguredPresenceInput, execute_configured_presence};
use crate::{
    access as a,
    app::{
        Core, ReadAuthority, RequestPrincipal, ServerRuntime, Store, homebox_presence,
        homebox_presence_history,
    },
    config::providers::homebox::TrustedHomeBoxSource,
    domain::{self as d, stock as st},
    http::contracts::NativeContracts,
    jobs as j, media,
    providers::homebox::{read as hb, recovery::NativeWriterContracts},
    storage as s,
};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{self, pki_types::PrivatePkcs8KeyDer},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-presence-only-password!";
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn aid(n: u32) -> a::CanonicalId {
    a::CanonicalId::parse(id(n)).unwrap()
}
fn scope() -> a::Scope {
    a::Scope {
        workspace_id: aid(1),
        home_id: aid(2),
    }
}
fn evidence<'a>(
    method: a::Method,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf,
        authorization: None,
    }
}
fn login(boundary: &mut a::AccessBoundary, username: &str) -> (String, String) {
    let receipt = boundary
        .login(
            &evidence(a::Method::Post, None, None),
            &serde_json::to_vec(&json!({"username":username,"password":PASSWORD})).unwrap(),
            "synthetic-presence",
        )
        .unwrap();
    (
        receipt.set_cookie().split(';').next().unwrap().to_owned(),
        receipt.info().csrf_token().to_owned(),
    )
}

/// These peers claim only the *empty* registries selected for this one command.
/// Every callback for a retained queue or activity event fails closed.
struct NoQueueOwner;
impl s::QueueDiscovery for NoQueueOwner {
    fn authorize_discovery(&self, _: &j::QueueRegistration) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No queued owner selected",
        ))
    }
    fn validate_retained_enqueue(
        &self,
        _: &st::ValidatedRequest,
        _: &j::EnqueueRequest,
        _: &j::CanonicalScope,
        _: &j::QueueConfig,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No queued owner selected",
        ))
    }
}
impl s::QueueRecoveryEvidence for NoQueueOwner {
    fn validate_attempt(
        &self,
        _: &j::QueueConfig,
        _: s::QueueRecoveryAttempt<'_>,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No queued attempt selected",
        ))
    }
}
struct NoActivityOwner;
impl s::StockActivityRecoveryDiscovery for NoActivityOwner {
    fn revalidate_registry(
        &self,
        registry: &[s::StockActivityPhysicalRegistration],
    ) -> s::Result<()> {
        if registry.is_empty() {
            Ok(())
        } else {
            Err(s::Error::new(
                "owner-unavailable",
                "No activity registry selected",
            ))
        }
    }
    fn revalidate_registration(
        &self,
        _: &[s::StockActivityPhysicalRegistration],
        _: &s::StockActivityPhysicalRegistration,
    ) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No activity registration selected",
        ))
    }
}
impl s::StockActivityRecoveryEvidence for NoActivityOwner {
    fn validate_record(&self, _: &s::RetainedStockActivity) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No activity record selected",
        ))
    }
    fn validate_event(&self, _: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        Err(s::Error::new(
            "owner-unavailable",
            "No activity event selected",
        ))
    }
    fn queued_reservation_jobs(
        &self,
        _: &s::StockActivityRegistration,
        _: &s::RetainedStockActivityEvent,
    ) -> s::Result<j::LeasedJob> {
        Err(s::Error::new(
            "owner-unavailable",
            "No activity reservation selected",
        ))
    }
}

async fn native_provider(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    entity: Value,
    maintenance: Value,
    access: Arc<Mutex<a::AccessBoundary>>,
    store: Arc<Mutex<Store>>,
) -> Vec<String> {
    let mut requests = Vec::new();
    for _ in 0..4 {
        let (socket, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut stream = acceptor.accept(socket).await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).await.unwrap();
            head.push(byte[0]);
            assert!(head.len() <= 8192);
        }
        assert!(access.try_lock().is_ok(), "Access crossed a native GET");
        assert!(store.try_lock().is_ok(), "Store crossed a native GET");
        let text = String::from_utf8(head).unwrap();
        let first = text.lines().next().unwrap();
        let target = first.split_whitespace().nth(1).unwrap();
        assert!(first.starts_with("GET ") && first.ends_with(" HTTP/1.1"));
        assert!(
            text.to_ascii_lowercase()
                .contains("accept-encoding: identity\r\n")
        );
        assert!(
            text.to_ascii_lowercase()
                .contains("authorization: bearer synthetic-presence-only\r\n")
        );
        assert!(
            text.to_ascii_lowercase()
                .contains(&format!("x-tenant: {}\r\n", id(11)))
        );
        let url = url::Url::parse(&format!("https://127.0.0.1{target}")).unwrap();
        let body = if url.path() == "/api/v1/entities" {
            let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(query["page"], "1");
            assert_eq!(query["includeArchived"], "true");
            assert_eq!(
                query["pageSize"],
                hb::Limits::default().max_page_size.to_string()
            );
            let rows = if query["isLocation"] == "false" {
                let mut listed = serde_json::Map::new();
                for key in [
                    "id",
                    "name",
                    "archived",
                    "updatedAt",
                    "entityType",
                    "parent",
                ] {
                    listed.insert(key.into(), entity[key].clone());
                }
                vec![Value::Object(listed)]
            } else {
                assert_eq!(query["isLocation"], "true");
                Vec::new()
            };
            json!({"items":rows,"page":1,"pageSize":hb::Limits::default().max_page_size,"total":rows.len()})
        } else if url.path() == format!("/api/v1/entities/{}/maintenance", id(2)) {
            assert_eq!(url.query(), Some("status=both"));
            maintenance.clone()
        } else {
            assert_eq!(url.path(), format!("/api/v1/entities/{}", id(2)));
            assert!(url.query().is_none());
            entity.clone()
        };
        let bytes = serde_json::to_vec(&body).unwrap();
        stream.write_all(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len(),
        ).as_bytes()).await.unwrap();
        stream.write_all(&bytes).await.unwrap();
        stream.shutdown().await.unwrap();
        requests.push(target.to_owned());
    }
    requests
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn healthy_configured_presence_binding_single() {
    tokio::time::timeout(Duration::from_secs(30), healthy_body())
        .await
        .unwrap();
}

async fn healthy_body() {
    // Complete source is for parent review. Do not execute this named case yet.
    let temporary = tempfile::Builder::new()
        .prefix("presence-single-")
        .tempdir_in("/tmp")
        .unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let leaf_der = certificate.cert.der().to_vec();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
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

    let mut entity: Value = serde_json::from_str(include_str!(
        "../../providers/homebox/wire/fixtures/item.detail.json"
    ))
    .unwrap();
    entity["parent"] = Value::Null;
    entity["archived"] = json!(false);
    let maintenance: Value = serde_json::from_str(include_str!(
        "../../providers/homebox/wire/fixtures/maintenance.json"
    ))
    .unwrap();
    assert_eq!(entity["id"], id(2));
    let registration = a::SourceRegistration {
        workspace_id: aid(1),
        home_id: aid(2),
        source_instance_id: aid(10),
        collection_id: id(11),
        owner: a::SourceOwner::Homebox,
        partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(2)],
    };
    let source = a::SourceRef {
        workspace_id: aid(1),
        home_id: aid(2),
        key: a::SourceKey {
            source_instance_id: aid(10),
            collection_id: id(11),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: id(2),
        },
    };
    let lifecycle = a::LifecyclePolicy::from_trusted_configuration(vec![
        a::LifecycleRule::new(
            aid(4),
            aid(5),
            registration.clone(),
            a::LifecycleCapability::PublishCache,
            a::Action::Mutate,
        )
        .unwrap(),
    ]);
    let clock = || {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    };
    let mut boundary = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_clock(clock)
            .with_lifecycle_policy(lifecycle),
    )
    .unwrap();
    for (user, actor, name, role) in [
        (4, 5, "presence-publisher", a::Role::Editor),
        (6, 7, "presence-editor", a::Role::Editor),
    ] {
        boundary
            .provision_user(
                &aid(user),
                &aid(actor),
                name,
                &a::hash_password(PASSWORD).unwrap(),
                None,
            )
            .unwrap();
        boundary
            .set_membership(&aid(user), &scope(), role, true)
            .unwrap();
    }
    boundary.put_source(&registration, None).unwrap();
    let (publisher_cookie, publisher_csrf) = login(&mut boundary, "presence-publisher");
    let provider_principal = boundary
        .authorize(
            &evidence(
                a::Method::Post,
                Some(&publisher_cookie),
                Some(&publisher_csrf),
            ),
            &scope(),
            a::Action::Mutate,
        )
        .unwrap();
    let source_grant = boundary
        .authorize_source(&provider_principal, &source)
        .unwrap();
    let partition_grant = boundary
        .authorize_source_partition(&provider_principal, &registration.partition())
        .unwrap();
    let lifecycle_grant = boundary
        .capture_lifecycle(
            &provider_principal,
            &registration,
            a::LifecycleCapability::PublishCache,
        )
        .unwrap();
    let (editor_cookie, editor_csrf) = login(&mut boundary, "presence-editor");
    let editor_principal = boundary
        .authorize(
            &evidence(a::Method::Post, Some(&editor_cookie), Some(&editor_csrf)),
            &scope(),
            a::Action::Mutate,
        )
        .unwrap();
    let command_principal = RequestPrincipal::new(editor_principal);
    command_principal
        .capture_source(&boundary, &source)
        .unwrap();
    command_principal
        .capture_partition(&boundary, &registration.partition())
        .unwrap();
    let access = Arc::new(Mutex::new(boundary));

    let mut published: s::Snapshot = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))
    .unwrap();
    let binding = published
        .records
        .iter()
        .find(|r| r.record_id == id(301))
        .unwrap()
        .clone();
    published
        .records
        .retain(|r| r.record_id == id(100) || r.record_id == id(201));
    published.sources = vec![serde_json::to_value(&registration).unwrap()];
    published.caches.clear();
    published.homebox_entities.clear();
    published.network_relations.clear();
    let vault = Arc::new(media::AssetVault::open(&root.join("vault")).unwrap());
    let database = root.join("atlas-presence.sqlite");
    let runtime = || media::native::NativeMediaRuntime {
        vault: Arc::clone(&vault),
        server: ServerRuntime,
    };
    let options = s::StoreOptions {
        allow_synthetic_bootstrap: true,
        stock_activity_profile: true,
        presence_profile: s::PresenceProfileSelection::FreshV7,
        ..s::StoreOptions::default()
    };
    let mut store = Store::open_presence(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        options,
        &s::PresenceHistoryCatalog::empty(),
    )
    .unwrap();
    store.initialize_synthetic(&published).unwrap();
    let core = Core {
        access: Arc::clone(&access),
        store: Arc::new(Mutex::new(store)),
        atlas_list_pages: st::AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
        vault: Arc::clone(&vault),
        home: d::HomeSummary {
            scope: d::Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
            label: "Synthetic presence".into(),
        },
        homes: vec![d::HomeSummary {
            scope: d::Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
            label: "Synthetic presence".into(),
        }],
    };
    let store = Arc::clone(&core.store);
    let provider = tokio::spawn(native_provider(
        listener,
        TlsAcceptor::from(Arc::new(tls)),
        entity,
        maintenance,
        Arc::clone(&access),
        Arc::clone(&store),
    ));
    let durable_registration: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let configured = Arc::new(
        TrustedHomeBoxSource::new_stock(
            &provider_origin,
            durable_registration,
            hb::Limits::default(),
            None,
        )
        .unwrap(),
    );
    let credentials = Arc::new(
        hb::NativeReadCredentialConfig::from_trusted_header(
            &configured.endpoint().unwrap(),
            b"Bearer synthetic-presence-only".to_vec(),
        )
        .unwrap(),
    );
    let prepared = homebox_presence::prepare_configured_with_loopback_certificate(
        &core,
        &provider_principal,
        &source_grant,
        &partition_grant,
        &lifecycle_grant,
        homebox_presence::LoopbackPresenceSource {
            configured: &configured,
            credentials: &credentials,
            certificate_der: &leaf_der,
        },
    )
    .unwrap();
    let captured = prepared.capture().await.unwrap();
    let (native_capture, origin) = captured.into_parts();
    let origin = Arc::new(origin);
    let cache_observation = s::CachePresenceCommittedObservation::new();
    let released = homebox_presence::publish_configured(
        &core,
        &configured,
        &origin,
        native_capture,
        &lifecycle_grant,
        &cache_observation,
    )
    .unwrap();
    assert!(released.committed().baseline_generation_id().is_none());
    assert_eq!(released.committed().baseline_cache_epoch(), 0);
    let native_requests = provider.await.unwrap();
    assert_eq!(native_requests.len(), 4);

    let mut payload = binding.payload.clone();
    payload.as_object_mut().unwrap().remove("sourceState");
    payload["source"]["collectionId"] = json!(id(11));
    payload["source"]["externalId"] = json!(id(2));
    let identity = published
        .records
        .iter()
        .find(|record| record.record_type == s::RecordType::Identity && record.record_id == id(201))
        .expect("seeded Binding atlasId identity");
    assert_eq!(payload["atlasId"], identity.record_id);
    let raw = json!({
        "schemaVersion":3,"commandId":"atlas.binding.create","requestId":id(900),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"binding","recordId":id(901)},
        "payload":payload,"idempotencyKey":id(902),"reason":"One synthetic original Presence binding",
        "preconditions":{"target":null,"guards":[{
            "target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
            "revision":{"kind":"atlas","value":1}
        },{
            "target":{"authority":"atlas","recordType":"identity","recordId":identity.record_id},
            "revision":{"kind":"atlas","value":identity.revision}
        }]},"approvalReceiptId":null,
    });
    let committed = s::StockPresenceCommittedObservation::new();
    let history = RefCell::new(None);
    let age = d::qualified::ConfiguredCacheAge::Homebox {
        stale_after_ms: 300_000,
    };
    let stock_contract = st::NativeStockContract::new().unwrap();
    let result = execute_configured_presence(
        &core,
        &command_principal,
        raw,
        ConfiguredPresenceInput {
            publications: &[&released],
            age: &age,
            observation: &committed,
            history: &history,
        },
        &stock_contract,
    )
    .unwrap_or_else(|error| {
        panic!(
            "configured presence failed: {error:?}; committed_data={}; accepted_history={}",
            !committed.is_empty(),
            history.borrow().is_some()
        )
    });
    assert_eq!(result.wire["replayed"], false);
    let committed_data = committed.take().expect("same original committed DATA");
    assert_eq!(committed_data.witnesses().len(), 1);
    assert_eq!(committed_data.witnesses()[0].binding_record_id, id(901));
    assert_eq!(
        committed_data.witnesses()[0].trigger,
        crate::contracts::stock::PresenceTrigger::CreatePresent,
    );
    assert_eq!(committed_data.witnesses()[0].source.external_id, id(2));
    let accepted = history
        .borrow_mut()
        .take()
        .expect("full Access accepted archive");
    assert_eq!(accepted.frame().witnesses(), committed_data.witnesses());
    let catalog = homebox_presence_history::catalog_from_accepted(vec![accepted]).unwrap();
    drop(released);
    drop(origin);
    drop(store);
    let store = Arc::try_unwrap(core.store)
        .ok()
        .unwrap()
        .into_inner()
        .unwrap();
    store.close().unwrap();

    let stock = st::NativeStockContract::new().unwrap();
    let no_jobs = NoQueueOwner;
    let base = s::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &no_jobs,
        evidence: &no_jobs,
    };
    let native_writer = NativeWriterContracts::new().unwrap();
    let no_activity = NoActivityOwner;
    let activity = s::StockActivityRecoveryPeers {
        contracts: &native_writer,
        registry: &[],
        discovery: &no_activity,
        evidence: &no_activity,
    };
    let peers = s::PresenceOpenPeers {
        base: &base,
        activity: &activity,
        history: &catalog,
    };
    let mut reopened = Store::open_existing_presence(
        &database,
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        runtime(),
        s::StoreOptions {
            stock_activity_profile: true,
            presence_profile: s::PresenceProfileSelection::FreshV7,
            ..s::StoreOptions::default()
        },
        &peers,
        &mut || Ok(()),
    )
    .unwrap();
    assert_eq!(reopened.database_version(), 7);
    let after = reopened
        .read_snapshot_with_authorization(
            &ReadAuthority(Arc::clone(&access)),
            &command_principal,
            &s::Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
        )
        .unwrap();
    let binding = after
        .records
        .iter()
        .find(|row| row.record_id == id(901))
        .unwrap();
    assert_eq!(binding.record_type, s::RecordType::Binding);
    assert_eq!(binding.payload["sourceState"], "present");
    reopened.close().unwrap();
}
