//! Fresh synthetic native Stock building plus actual owned PDF capture.
//! No listener, providers, queue, source fixture, real data or held controls.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use houseatlas_backend::{
    config::server::ServerConfig,
    contracts::stock as wire,
    http::{self, Host, McpCommandProfile, router},
    lifecycle::{Failure, persistent},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;
const ORIGIN: &str = "https://127.0.0.1:48743";
const MAX_RESPONSE: usize = 1024 * 1024;
fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn target(kind: &str, n: u32) -> Value {
    json!({"authority":"atlas","recordType":kind,"recordId":id(n)})
}
fn evidence(statement: &str) -> Value {
    json!({"statement":statement,"provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"owner-report","factAt":null,"retrievedAt":"2026-10-10T00:00:00Z","vantage":null,"uncertainty":{"status":"unknown","explanation":null}},"supersedesEvidenceIds":[],"references":[]})
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
        .header("content-type", "application/json")
        .header("accept", "application/json");
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
struct Client {
    app: Router,
    core: Arc<std::sync::Mutex<houseatlas_backend::app::Core>>,
    scope: Value,
    cookie: String,
    csrf: String,
    serial: u32,
    posts: u32,
}
impl Client {
    async fn open(config: &ServerConfig) -> Result<(Self, persistent::ServerLease), Failure> {
        let (core, lease) = persistent::reopen(config)?;
        let host = Host::new(
            core,
            config.origin.clone(),
            Arc::new(BTreeMap::new()),
            vec![],
        )?
        .with_loopback_local()?
        .with_mcp_command_profile(McpCommandProfile::ReadOnly);
        let core = Arc::clone(&host.core);
        let app = router(host);
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/atlas/auth/local",
                b"{}".to_vec(),
                None,
                None,
            )?)
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get("set-cookie")
            .ok_or("Missing native cookie")?
            .to_str()?
            .split(';')
            .next()
            .ok_or("Missing cookie pair")?
            .to_owned();
        let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
        assert_eq!(info["schemaVersion"], 1);
        assert_eq!(info["actorId"], id(5));
        let csrf = info["csrfToken"]
            .as_str()
            .ok_or("Missing native CSRF")?
            .to_owned();
        Ok((
            Self {
                app,
                core,
                scope: json!({"workspaceId":id(2),"homeId":id(3)}),
                cookie,
                csrf,
                serial: 5000,
                posts: 0,
            },
            lease,
        ))
    }
    fn command(
        &mut self,
        kind: &str,
        verb: &str,
        n: u32,
        payload: Value,
        revision: Option<u32>,
        guards: Vec<Value>,
    ) -> Value {
        self.serial += 2;
        json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":target(kind,n),"payload":payload,
            "idempotencyKey":id(self.serial+1),"reason":"Synthetic offline backup building","approvalReceiptId":null,
            "preconditions":{"target":revision.map(|v|json!({"kind":"atlas","value":v})),"guards":guards}})
    }
    async fn call(&mut self, command: Value) -> Result<Value, Failure> {
        let validator = wire::StockValidation::new()?;
        let parsed = wire::StockRequest::parse(&validator, command.clone())?;
        let base = format!("/api/atlas/stock/v3/workspaces/{}/homes/{}", id(2), id(3));
        let writing = command.get("idempotencyKey").is_some();
        let (method, path, body) = if writing {
            self.posts += 1;
            (
                "POST",
                format!("{base}/commands"),
                serde_json::to_vec(&command)?,
            )
        } else {
            (
                "GET",
                format!(
                    "{base}/invoke?request={}",
                    url::form_urlencoded::byte_serialize(&serde_json::to_vec(&command)?)
                        .collect::<String>()
                ),
                Vec::new(),
            )
        };
        // Keep the exact submitted batch selector for passive retained disclosure.
        let original_body = body.clone();
        if parsed.id().as_str() == "atlas.batch.execute" {
            assert!(original_body.len() <= 16 * 1024);
        }
        let response = self
            .app
            .clone()
            .oneshot(request(
                method,
                &path,
                body,
                Some(&self.cookie),
                writing.then_some(self.csrf.as_str()),
            )?)
            .await?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        let result: Value = serde_json::from_slice(&bytes)?;
        let children = if parsed.id().as_str() == "atlas.batch.execute" {
            // This existing POST reads genuine durable wire envelopes; it never
            // resubmits the command or establishes original delivery/retry safety.
            let response = self
                .app
                .clone()
                .oneshot(request(
                    "POST",
                    "/api/atlas/retained-intent",
                    original_body,
                    Some(&self.cookie),
                    Some(&self.csrf),
                )?)
                .await?;
            let status = response.status();
            let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
            assert_eq!(
                status,
                StatusCode::OK,
                "{}",
                String::from_utf8_lossy(&bytes)
            );
            let retained: Value = serde_json::from_slice(&bytes)?;
            assert_eq!(retained["format"], "atlas-retained-reconciliation/1");
            assert_eq!(retained["lookupRequestId"], command["requestId"]);
            let inspection = &retained["inspection"];
            assert_eq!(inspection["format"], "atlas-retained-intent-inspection/1");
            assert_eq!(inspection["resolvedScope"], self.scope);
            assert_eq!(inspection["coverage"], "retained-atlas-stock-only");
            assert_eq!(inspection["outcome"], "retained-commit");
            assert_eq!(inspection["retrySafety"], "not-established");
            assert_eq!(inspection["commandId"], command["commandId"]);
            assert_eq!(inspection["requestDigest"], parsed.intent_digest());
            assert_eq!(inspection["rootOperationId"], result["operationId"]);
            assert_eq!(inspection["operationId"], result["operationId"]);
            let saved = &retained["committedResult"];
            assert_eq!(saved["originalRequestId"], command["requestId"]);
            assert_eq!(saved["wire"], result);
            assert_eq!(saved["originalMediaRelease"], "not-established");
            assert_eq!(saved["originalHttpDelivery"], "not-established");
            saved["children"]
                .as_array()
                .ok_or("Missing genuine retained batch child envelopes")?
                .clone()
        } else {
            Vec::new()
        };
        wire::StockResponse::parse(&validator, &parsed, result.clone(), &children)?;
        assert_eq!(result["requestId"], command["requestId"]);
        assert_eq!(result["commandId"], command["commandId"]);
        assert_eq!(result["resolvedScope"], self.scope);
        if writing {
            assert_eq!(result["status"], "committed");
            assert_eq!(result["replayed"], false);
            assert_eq!(result["data"]["requestDigest"], parsed.intent_digest());
        } else {
            assert_eq!(result["status"], "read");
        }
        Ok(result)
    }
    async fn batch(&mut self, commands: Vec<Value>, guards: Vec<Value>) -> Result<Value, Failure> {
        self.serial += 3;
        let root = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(self.serial),"context":self.scope,
            "target":{"authority":"atlas","kind":"batch","batchId":id(self.serial+1)},"payload":{"commands":commands},
            "idempotencyKey":id(self.serial+2),"reason":"Synthetic offline backup building","approvalReceiptId":null,"preconditions":{"target":null,"guards":guards}});
        self.call(root).await
    }
    async fn read(
        &mut self,
        kind: &str,
        verb: &str,
        n: u32,
        payload: Value,
    ) -> Result<Value, Failure> {
        self.serial += 1;
        let command = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":if verb == "list" { json!({"authority":"atlas","recordType":kind}) } else { target(kind,n) },"payload":payload});
        self.call(command).await
    }
    async fn native_asset(
        &self,
    ) -> Result<
        (
            houseatlas_backend::storage::Record,
            Vec<houseatlas_backend::storage::Audit>,
        ),
        Failure,
    > {
        // Actual frozen native GETs retain the full record and durable audit
        // sequence under the original session/ReadAuthority; Stock's public
        // record disclosure intentionally has a different closed DTO.
        let base = format!(
            "/api/atlas/v1/workspaces/{}/homes/{}/records/asset/{}",
            id(2),
            id(3),
            id(610)
        );
        let mut values = Vec::new();
        for path in [base.clone(), format!("{base}/history")] {
            let response = self
                .app
                .clone()
                .oneshot(request("GET", &path, Vec::new(), Some(&self.cookie), None)?)
                .await?;
            assert_eq!(response.status(), StatusCode::OK);
            values.push(serde_json::from_slice::<Value>(
                &to_bytes(response.into_body(), MAX_RESPONSE).await?,
            )?);
        }
        let record = serde_json::from_value(values.remove(0))?;
        let audits = serde_json::from_value(values.remove(0))?;
        Ok((record, audits))
    }
}

fn work() -> houseatlas_backend::media::WorkBudget {
    use houseatlas_backend::media::{Cancellation, WorkBudget};
    WorkBudget::new(std::time::Duration::from_secs(10), Cancellation::default()).unwrap()
}
struct FencedAsset<'g, 'a> {
    guard: &'g houseatlas_backend::access::TransactionAuthorization<'a>,
    original: &'g houseatlas_backend::app::RequestPrincipal,
}
impl houseatlas_backend::storage::Authorization for FencedAsset<'_, '_> {
    type Principal = houseatlas_backend::app::RequestPrincipal;
    fn authorize(
        &self,
        principal: &Self::Principal,
        request: houseatlas_backend::storage::AuthorizationRequest<'_>,
    ) -> houseatlas_backend::storage::Result<houseatlas_backend::storage::VerifiedActor> {
        use houseatlas_backend::{access as a, storage as s};
        if !std::ptr::eq(principal, self.original)
            || request.capability != s::Capability::Mutate
            || request.targets.iter().any(|target| {
                target.record_type != s::RecordType::Asset || target.record_id != id(610)
            })
        {
            return Err(s::Error::new(
                "forbidden",
                "Original synthetic asset mutation required",
            ));
        }
        let scope: a::Scope = serde_json::from_value(serde_json::to_value(request.scope)?)?;
        let actual = self
            .guard
            .authorize(&scope, a::Capability::Mutate)
            .map_err(|e| {
                s::Error::new(e.code(), "Original synthetic mutation fence unavailable")
            })?;
        if !std::ptr::eq(actual, principal.principal.principal()) {
            return Err(s::Error::new(
                "forbidden",
                "Original synthetic principal changed",
            ));
        }
        Ok(s::VerifiedActor {
            workspace_id: actual.scope().workspace_id.as_str().into(),
            home_id: actual.scope().home_id.as_str().into(),
            actor_id: actual.actor_id().as_str().into(),
        })
    }
}
fn evidence_request<'a>(
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> houseatlas_backend::access::RequestEvidence<'a> {
    use houseatlas_backend::access as a;
    a::RequestEvidence {
        method: a::Method::Post,
        url: "https://127.0.0.1:48743/api/atlas/v1/workspaces/00000000-0000-4000-8000-000000000002/homes/00000000-0000-4000-8000-000000000003/records/asset/00000000-0000-4000-8000-000000000610/mutations",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}
#[tokio::main]
async fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::time::timeout(std::time::Duration::from_secs(180), healthy()).await??;
    Ok(())
}
async fn healthy() -> Result<(), Failure> {
    use houseatlas_backend::{
        access as a, app,
        config::recovery::RecoveryConfig,
        lifecycle::{
            backup,
            recovery::{host, reopen},
        },
        media::types as m,
        storage as s,
    };
    use sha2::{Digest, Sha256};
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-native-offline-backup-")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir_in("/tmp")?;
    let root = fs::canonicalize(scratch.path())?;
    let config: ServerConfig = serde_json::from_value(
        json!({"schemaVersion":1,"deploymentId":id(1),
        "dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],"mcpCommands":"read-only",
        "authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local",
        "scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    persistent::initialize_without_password(&config)?;
    let config_path = root.join("source-config.json");
    fs::write(&config_path, serde_json::to_vec(&config)?)?;
    let (mut client, lease) = Client::open(&config).await?;
    let empty = client
        .read(
            "identity",
            "list",
            0,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(empty["data"]["records"], json!([]));
    let building_evidence = client.command(
        "evidence",
        "create",
        100,
        evidence("Synthetic native building and owned PDF for offline backup."),
        None,
        vec![],
    );
    let identity_request = client.command(
        "identity",
        "create",
        101,
        json!({"kind":"location","evidenceIds":[id(100)]}),
        None,
        vec![],
    );
    let building_payload = json!({"atlasId":id(101),"semanticKind":"building","label":"Synthetic backup building",
        "reviewStatus":"accepted","evidenceIds":[id(100)]});
    let semantics_request = client.command(
        "location-semantics",
        "create",
        201,
        building_payload.clone(),
        None,
        vec![],
    );
    let created = client
        .batch(
            vec![building_evidence, identity_request, semantics_request],
            vec![],
        )
        .await?;
    assert_eq!(
        created["data"]["records"]
            .as_array()
            .ok_or("Missing native batch records")?
            .len(),
        3
    );
    let building_history = client
        .read(
            "location-semantics",
            "history",
            201,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(
        building_history["data"]["entries"]
            .as_array()
            .ok_or("Missing genuine Stock history")?
            .len(),
        1
    );
    let pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n";
    let asset_result = {
        let core = client
            .core
            .lock()
            .map_err(|_| "Synthetic core unavailable")?;
        let media_scope = m::Scope {
            workspace_id: id(2),
            home_id: id(3),
        };
        let prepared = core.vault.prepare_original(
            &media_scope,
            m::AssetPurpose::EvidenceOriginal,
            m::ContentType::Pdf,
            &mut pdf.as_slice(),
            &work(),
        )?;
        let payload = prepared.with_provenance(
            m::SourceLicense {
                status: m::LicenseStatus::Unknown,
                reference: None,
            },
            vec![id(100)],
        )?;
        assert_eq!(payload.preview_policy, m::PreviewPolicy::DownloadOnly);
        assert_eq!(payload.sha256, format!("{:x}", Sha256::digest(pdf)));
        let mut access = core
            .access
            .lock()
            .map_err(|_| "Synthetic access unavailable")?;
        let scope: a::Scope = serde_json::from_value(client.scope.clone())?;
        let original = app::RequestPrincipal::new(access.authorize(
            &evidence_request(Some(&client.cookie), Some(&client.csrf)),
            &scope,
            a::Action::Mutate,
        )?);
        let command = json!({"schemaVersion":1,"mutationId":id(6100),"operation":"create","expectedRevision":null,
            "reason":"Synthetic actual owned PDF original","guards":[{"record":{"recordType":"evidence","recordId":id(100)},"expectedRevision":1}],
            "value":{"recordType":"asset","payload":payload}});
        let mut result = None;
        access.with_mutation_authorization(
            original.principal.principal(),
            |guard| -> Result<(), Failure> {
                result = Some(
                    core.store
                        .lock()
                        .map_err(|_| "Synthetic storage unavailable")?
                        .execute_json_with_authorization(
                            &FencedAsset {
                                guard,
                                original: &original,
                            },
                            &original,
                            &s::Scope {
                                workspace_id: id(2),
                                home_id: id(3),
                            },
                            &s::RecordRef {
                                record_type: s::RecordType::Asset,
                                record_id: id(610),
                            },
                            &command,
                        )?,
                );
                Ok(())
            },
        )?;
        result.ok_or("Missing genuine native asset commit")?
    };
    assert!(!asset_result.replayed);
    assert_eq!(asset_result.record.revision, 1);
    assert_eq!(asset_result.audit.actor_id, id(5));
    let mut public_payload = asset_result.record.payload.clone();
    assert!(
        public_payload
            .as_object_mut()
            .ok_or("Missing native asset payload object")?
            .remove("storageKey")
            .is_some()
    );
    // Match the actual Stock owner disclosure: only these four fields, with
    // the single private storageKey omitted from the otherwise exact payload.
    let public_asset = json!({"target":target("asset",610),
        "revision":asset_result.record.revision,"lifecycle":asset_result.record.lifecycle,
        "payload":public_payload});
    let actual_asset = client.read("asset", "get", 610, json!({})).await?;
    assert_eq!(
        actual_asset["data"]["records"],
        json!([public_asset.clone()])
    );
    let (native_asset, native_audits) = client.native_asset().await?;
    assert_eq!(native_asset, asset_result.record);
    assert_eq!(native_audits, vec![asset_result.audit.clone()]);
    drop(client);
    drop(lease);
    // Source is now genuinely closed. No source checkpoint/Access opener is
    // part of capture; even WAL-header state must retain absent sidecars.
    let atlas_before = fs::read(root.join("data/atlas.sqlite"))?;
    let access_before = fs::read(root.join("data/access.sqlite"))?;
    let receipt_before = fs::read(root.join("data/server-state.json"))?;
    let bundle = root.join("bundle");
    let selection = backup::Selection::from_arguments(&[
        "--server-config".into(),
        config_path.to_str().ok_or("Invalid synthetic path")?.into(),
        "--destination".into(),
        bundle.to_str().ok_or("Invalid synthetic path")?.into(),
        "--profile".into(),
        backup::PROFILE.into(),
    ])?;
    let report = backup::capture(&selection)?;
    assert_eq!(report.asset_record_count, 1);
    assert_eq!(
        report.source_database_sha256,
        format!("{:x}", Sha256::digest(&atlas_before))
    );
    assert_eq!(fs::read(root.join("data/atlas.sqlite"))?, atlas_before);
    assert_eq!(fs::read(root.join("data/access.sqlite"))?, access_before);
    assert_eq!(
        fs::read(root.join("data/server-state.json"))?,
        receipt_before
    );
    let owners = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
    let peers = owners.peers()?;
    let verified = host::validate_closed(&bundle, &peers, &work())?;
    assert_eq!(verified.manifest.database.sha256, report.database_sha256);
    assert_eq!(verified.manifest.assets.len(), 1);
    let original = verified.manifest.assets[0]
        .blob
        .as_ref()
        .ok_or("Missing retained original member")?;
    assert_eq!(fs::read(bundle.join("originals").join(original))?, pdf);
    let restored = host::restore_closed(&bundle, &root.join("restored"), &peers, &work())?;
    // Only this fresh disposable verification creates a separately provisioned
    // Access database. Capture itself opened none and never grants restore.
    let access_config = config.access_config()?;
    let access_path = root.join("verification-access.sqlite");
    let mut boundary = a::AccessBoundary::open(&access_path, config.access_config()?)?;
    boundary.provision_loopback_local_user()?;
    drop(boundary);
    let homes = config.home_summaries();
    let primary = homes.first().ok_or("Missing synthetic home")?.scope.clone();
    let recovery =
        RecoveryConfig::restored(&restored, &access_path, access_config, homes, &primary)?;
    let core = reopen::reopen_closed(recovery, &peers, &work())?;
    let home = core.home.clone();
    let host = http::Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_loopback_local()?
        .with_mcp_command_profile(McpCommandProfile::ReadOnly);
    let verification_core = Arc::clone(&host.core);
    let app = http::router(host);
    let session = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/atlas/auth/local",
            b"{}".to_vec(),
            None,
            None,
        )?)
        .await?;
    assert_eq!(session.status(), StatusCode::OK);
    let cookie = session.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .ok_or("Missing fresh verification session")?
        .to_owned();
    let value: Value = serde_json::from_slice(&to_bytes(session.into_body(), 4096).await?)?;
    let mut reopened = Client {
        app,
        core: verification_core,
        cookie,
        csrf: value["csrfToken"]
            .as_str()
            .ok_or("Missing fresh verification CSRF")?
            .into(),
        scope: serde_json::to_value(home.scope)?,
        serial: 9000,
        posts: 0,
    };
    let actual = reopened
        .read("location-semantics", "get", 201, json!({}))
        .await?;
    assert_eq!(actual["data"]["records"][0]["payload"], building_payload);
    let history = reopened
        .read(
            "location-semantics",
            "history",
            201,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(history["data"], building_history["data"]);
    let actual = reopened.read("asset", "get", 610, json!({})).await?;
    assert_eq!(actual["data"]["records"], json!([public_asset]));
    let (reopened_asset, reopened_audits) = reopened.native_asset().await?;
    assert_eq!(reopened_asset, native_asset);
    assert_eq!(reopened_audits, native_audits);
    println!(
        "healthy native offline backup: actual Stock building/history and owned PDF; full owner-peer image validation and isolated strict reopen; source bytes unchanged"
    );
    Ok(())
}
