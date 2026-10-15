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
    http::{Host, McpCommandProfile, router},
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
fn fixture_license(n: usize) -> Value {
    match n % 4 {
        0 => json!({"status":"permitted","reference":"CC-BY-4.0"}),
        1 => json!({"status":"permitted","reference":"CC0-1.0"}),
        2 => json!({"status":"permitted","reference":"PDM-1.0"}),
        _ => json!({"status":"unknown","reference":null}),
    }
}
fn generated_sources() -> Result<Vec<(&'static str, Vec<u8>)>, Failure> {
    let mut tiff = b"II\x2a\x00\x08\x00\x00\x00\x02\x00".to_vec();
    for tag in [256u16, 257] {
        tiff.extend(tag.to_le_bytes());
        tiff.extend(3u16.to_le_bytes());
        tiff.extend(1u32.to_le_bytes());
        tiff.extend([1, 0, 0, 0]);
    }
    tiff.extend([0, 0, 0, 0]);
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&[20, 40, 60, 255])?;
    }
    Ok(vec![
        (
            "application/json",
            br#"{"agency":"Generated metadata","layers":["sample"]}"#.to_vec(),
        ),
        (
            "application/city+json",
            br#"{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}"#.to_vec(),
        ),
        ("image/tiff", tiff),
        ("image/png", png_bytes),
        (
            "application/pdf",
            b"%PDF-1.7\nGenerated catalogue framing example\n%%EOF\n".to_vec(),
        ),
    ])
}

#[tokio::main]
async fn main() -> Result<(), Failure> {
    use houseatlas_backend::{
        access as a, app,
        domain::stock::NativeStockContract,
        http::contracts::NativeContracts,
        lifecycle::backup,
        media::{self, types as m},
        storage as s,
        storage::{
            geodata::GeodataOwners, geodata_full, geodata_policy::PinnedGeodataSourcePolicy,
        },
    };
    use sha2::{Digest, Sha256};
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-native-full-profile-")
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
        let mut payload = prepared.with_provenance(
            m::SourceLicense {
                status: m::LicenseStatus::Unknown,
                reference: None,
            },
            vec![id(100)],
        )?;
        payload.availability = m::Availability::Missing;
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

    // Real authenticated original intake retains Stock and upload-consumption history.
    let metadata = json!({"schemaVersion":1,"requestId":id(7100),"idempotencyKey":id(7101),"context":client.scope,"reason":"Retain synthetic predecessor upload","filename":"generated.pdf","contentType":"application/pdf","sourceLicense":{"status":"unknown","reference":null}});
    let mut upload=format!("--synthetic-boundary\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n--synthetic-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"generated.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").into_bytes();
    upload.extend_from_slice(b"%PDF-1.7\nGenerated independent staged upload\n%%EOF\n");
    upload.extend_from_slice(b"\r\n--synthetic-boundary--\r\n");
    let uri = format!(
        "/api/atlas/documents/v1/workspaces/{}/homes/{}/originals",
        id(2),
        id(3)
    );
    let mut req = request(
        "POST",
        &uri,
        upload,
        Some(&client.cookie),
        Some(&client.csrf),
    )?;
    req.headers_mut().insert(
        "content-type",
        "multipart/form-data; boundary=synthetic-boundary".parse()?,
    );
    let response = client.app.clone().oneshot(req).await?;
    let status = response.status();
    let output = to_bytes(response.into_body(), 128 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&output)
    );
    let access = client.core.lock().unwrap().access.clone();
    let source_vault = client.core.lock().unwrap().vault.clone();
    let cookie = client.cookie.clone();
    let csrf = client.csrf.clone();
    drop(client);
    drop(lease);
    let predecessor = root.join("data/atlas.sqlite");
    let closed = rusqlite::Connection::open(&predecessor)?;
    closed.pragma_update(None, "journal_mode", "DELETE")?;
    closed.close().map_err(|(_, e)| e)?;
    let source_bytes = fs::read(&predecessor)?;
    let source_sha = format!("{:x}", Sha256::digest(&source_bytes));
    let inspected = rusqlite::Connection::open_with_flags(
        &predecessor,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    for table in [
        "stock_operations",
        "stock_groups",
        "stock_keys",
        "stock_audit_links",
        "stock_history_lookup",
        "upload_consumptions",
        "receipts",
        "batch_receipts",
    ] {
        let count: i64 =
            inspected.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        assert!(count > 0, "missing source {table}");
    }
    drop(inspected);
    let original = b"{\"type\":\"FeatureCollection\",\"features\":[]}\n";
    let provenance = json!({"agency":"Generated full-profile source","url":"https://source.invalid/original?bbox=0,0,1,1&f=json","license":{"status":"permitted","reference":"CC-BY-4.0"},"retrievedAt":"2026-10-15T00:00:00Z","published":null,"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}});
    let mut sources = vec![("application/geo+json", original.to_vec())];
    for n in 1..=70 {
        sources.push((
            "application/json",
            format!("{{\"generated\":{}}}", if n == 70 { 1 } else { n }).into_bytes(),
        ));
    }
    sources.extend(generated_sources()?);
    assert_eq!(sources.len(), 76);
    assert_eq!(
        sources
            .iter()
            .map(|(_, b)| format!("{:x}", Sha256::digest(b)))
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        75
    );
    let approvals:Vec<Value>=sources.iter().enumerate().map(|(n,(mime,bytes))|{let mut p=provenance.clone();p["license"]=fixture_license(n);json!({"documentId":id(8101+n as u32*3),"original":{"assetId":id(8102+n as u32*3),"revision":1,"sha256":format!("{:x}",Sha256::digest(bytes)),"bytes":bytes.len()},"contentType":mime,"provenance":p})}).collect();
    let policy_value = json!({"profile":"houseatlas.reviewed-document-source-policy.v1","scope":{"workspaceId":id(2),"homeId":id(3)},"sourceManifestSha256":format!("{:x}",Sha256::digest(b"generated fixture recipe only")),"documents":approvals});
    let policy = Arc::new(PinnedGeodataSourcePolicy::decode_reviewed(
        &serde_json::to_vec(&policy_value)?,
    )?);
    let source_owners = GeodataOwners::new(access.clone(), source_vault, policy.clone());
    let queue_owners = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
    let stock = NativeStockContract::new()?;
    let peers = s::RecoveryValidationPeers {
        stock: &stock,
        queues: &[],
        discovery: &queue_owners,
        evidence: &queue_owners,
    };
    let converted = root.join("converted");
    eprintln!("CHECK COPY selected nonempty predecessor");
    let report = geodata_full::copy_v5_to_full(
        &predecessor,
        &converted,
        &source_sha,
        &NativeContracts,
        &peers,
        &source_owners,
        &mut || Ok(()),
    )?;
    assert_eq!(report.preserved_tables.len(), 29);
    assert_eq!(fs::read(&predecessor)?, source_bytes);
    let vault = Arc::new(media::AssetVault::open_existing(&converted.join("media"))?);
    let owners = GeodataOwners::new(access.clone(), vault.clone(), policy.clone());
    eprintln!("CHECK open full target");
    let store = app::Store::open_existing_geodata_full(
        &converted.join("atlas.sqlite"),
        NativeContracts,
        app::ReadAuthority(access.clone()),
        media::native::NativeMediaRuntime {
            vault: vault.clone(),
            server: app::ServerRuntime,
        },
        s::StoreOptions::default(),
        owners.clone(),
        &peers,
        &mut || Ok(()),
    )?;
    let home = houseatlas_backend::domain::HomeSummary {
        scope: houseatlas_backend::domain::Scope {
            workspace_id: id(2),
            home_id: id(3),
        },
        label: "Synthetic Home".into(),
    };
    let core = app::Core {
        access: access.clone(),
        store: Arc::new(std::sync::Mutex::new(store)),
        vault: vault.clone(),
        home: home.clone(),
        homes: vec![home],
        atlas_list_pages: Default::default(),
        media_policy_evidence: Default::default(),
    };
    let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_loopback_local()?
        .with_full_geodata()?;
    let core = host.core.clone();
    let app = router(host);
    let mut full = Client {
        app: app.clone(),
        core: core.clone(),
        scope: json!({"workspaceId":id(2),"homeId":id(3)}),
        cookie: cookie.clone(),
        csrf: csrf.clone(),
        serial: 20000,
        posts: 0,
    };
    let building = full
        .read("location-semantics", "get", 201, json!({}))
        .await?;
    assert_eq!(building["data"]["records"][0]["payload"], building_payload);
    let corrected = full.command(
        "location-semantics",
        "replace",
        201,
        json!({"label":"Synthetic full-profile retained building"}),
        Some(1),
        vec![],
    );
    let _ = corrected;
    // Continue an ordinary existing Stock write without touching Documents.
    let evidence_command = full.command(
        "evidence",
        "create",
        30000,
        evidence("Synthetic Stock write after explicit same-database selection"),
        None,
        vec![],
    );
    full.call(evidence_command).await?;
    let base = format!(
        "/api/atlas/documents/v2/workspaces/{}/homes/{}/documents",
        id(2),
        id(3)
    );
    use base64::Engine;
    let input = json!({"request":{"mutationId":id(8100),"documentId":id(8101),"assetId":id(8102),"title":"Synthetic retained original","contentType":"application/geo+json","provenance":provenance,"reason":"Create source Document on existing full dataset"},"originalBase64":base64::engine::general_purpose::STANDARD.encode(original)});
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &base,
            serde_json::to_vec(&input)?,
            Some(&cookie),
            Some(&csrf),
        )?)
        .await?;
    let status = response.status();
    let output = to_bytes(response.into_body(), 128 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&output)
    );
    let created: Value = serde_json::from_slice(&output)?;
    assert_eq!(
        created["document"]["payload"]["provenance"]["license"],
        provenance["license"]
    );
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("{base}/{}/original?expectedRevision=1", id(8101)),
            vec![],
            Some(&cookie),
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(&to_bytes(response.into_body(), 1024).await?[..], original);
    for (n, (mime, bytes)) in sources.iter().enumerate().skip(1) {
        let mut p = provenance.clone();
        p["license"] = fixture_license(n);
        let input = json!({"request":{"mutationId":id(8100+n as u32*3),"documentId":id(8101+n as u32*3),"assetId":id(8102+n as u32*3),"title":"Synthetic retained source","contentType":mime,"provenance":p,"reason":"Generated full-profile scale fixture"},"originalBase64":base64::engine::general_purpose::STANDARD.encode(bytes)});
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                &base,
                serde_json::to_vec(&input)?,
                Some(&cookie),
                Some(&csrf),
            )?)
            .await?;
        let status = response.status();
        let body = to_bytes(response.into_body(), 128 * 1024).await?;
        assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
        let result: Value = serde_json::from_slice(&body)?;
        let mut retained = result["document"]["payload"]["provenance"].clone();
        assert!(
            retained
                .as_object_mut()
                .ok_or("Invalid provenance")?
                .remove("custodyReceiptSha256")
                .is_some()
        );
        assert_eq!(retained, p);
    }
    let mut cursor = None;
    let mut listed = Vec::new();
    let mut page_sizes = Vec::new();
    loop {
        let url = match &cursor {
            Some(c) => format!("{base}?limit=50&cursor={c}"),
            None => format!("{base}?limit=50"),
        };
        let response = app
            .clone()
            .oneshot(request("GET", &url, vec![], Some(&cookie), None)?)
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let page: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 2 * 1024 * 1024).await?)?;
        let records = page["documents"].as_array().ok_or("Missing page records")?;
        page_sizes.push(records.len());
        listed.extend(records.iter().cloned());
        cursor = page["nextCursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(page_sizes, vec![50, 26]);
    assert_eq!(listed.len(), 76);
    // Same connection still exposes predecessor Asset and complete Stock history.
    assert_eq!(
        full.read("asset", "get", 610, json!({})).await?["data"]["records"],
        json!([public_asset])
    );
    eprintln!("CHECK capture full bundle");
    let bundle = root.join("full-bundle");
    {
        let store = core.lock().unwrap().store.clone();
        let store = store.lock().unwrap();
        store.validate_full_geodata(&peers, &mut || Ok(()))?;
        let manifest = store.capture_full_geodata_recovery(&bundle, &peers, &mut || Ok(()))?;
        assert!(manifest.assets.len() >= 3);
    }
    eprintln!("CHECK restore full bundle");
    let restored = root.join("restored-full");
    app::Store::restore_full_geodata_recovery(
        &bundle,
        &restored,
        &NativeContracts,
        &peers,
        &owners,
        &mut || Ok(()),
    )?;
    drop(full);
    drop(app);
    drop(core);
    let restored_vault = Arc::new(media::AssetVault::open_existing(&restored.join("media"))?);
    let restored_owners = GeodataOwners::new(access.clone(), restored_vault.clone(), policy);
    let reopened = app::Store::open_existing_geodata_full(
        &restored.join("atlas.sqlite"),
        NativeContracts,
        app::ReadAuthority(access),
        media::native::NativeMediaRuntime {
            vault: restored_vault,
            server: app::ServerRuntime,
        },
        s::StoreOptions::default(),
        restored_owners,
        &peers,
        &mut || Ok(()),
    )?;
    reopened.validate_full_geodata(&peers, &mut || Ok(()))?;
    let verify = rusqlite::Connection::open_with_flags(
        restored.join("atlas.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    for (n, (_, bytes)) in sources.iter().enumerate() {
        for (record_id, kind) in [
            (id(8101 + n as u32 * 3), "geodata-document"),
            (id(8102 + n as u32 * 3), "asset"),
        ] {
            let body: String = verify.query_row(
                "SELECT body FROM geodata_records WHERE record_id=?1",
                [&record_id],
                |r| r.get(0),
            )?;
            let record: Value = serde_json::from_str(&body)?;
            assert_eq!(record["recordType"], kind);
            if kind == "geodata-document" {
                assert_eq!(
                    record["payload"]["provenance"]["license"],
                    fixture_license(n)
                );
                assert_eq!(
                    record["payload"]["original"]["sha256"],
                    format!("{:x}", Sha256::digest(bytes))
                );
            } else {
                assert_eq!(record["payload"]["sourceLicense"], fixture_license(n));
            }
        }
    }
    drop(verify);
    drop(reopened);
    // Offline owner-controlled replacement at the unchanged configured path.
    fs::rename(
        root.join("data/atlas.sqlite"),
        root.join("preserved-predecessor.sqlite"),
    )?;
    fs::rename(
        converted.join("atlas.sqlite"),
        root.join("data/atlas.sqlite"),
    )?;
    fs::rename(
        root.join("data/media"),
        root.join("preserved-predecessor-media"),
    )?;
    fs::rename(converted.join("media"), root.join("data/media"))?;
    eprintln!("CHECK bind persistent full selection");
    persistent::bind_full_geodata(
        &config,
        Arc::new(PinnedGeodataSourcePolicy::decode_reviewed(
            &serde_json::to_vec(&policy_value)?,
        )?),
    )?;
    let policy_path = root.join("reviewed-synthetic-source-policy.json");
    fs::write(&policy_path, serde_json::to_vec(&policy_value)?)?;
    fs::set_permissions(&policy_path, fs::Permissions::from_mode(0o600))?;
    let digest = format!("{:x}", Sha256::digest(fs::read(&policy_path)?));
    let args = vec![
        "serve".into(),
        "--full-geodata-source-policy".into(),
        policy_path
            .to_str()
            .ok_or("Policy path unavailable")?
            .into(),
        "--full-geodata-source-policy-sha256".into(),
        digest,
    ];
    let (remaining, selection) =
        houseatlas_backend::config::geodata_profile::ServerGeodataSelection::from_arguments(&args)?;
    assert_eq!(remaining, vec!["serve"]);
    let (selected, selected_lease) = persistent::reopen_full_geodata(
        &config,
        selection.ok_or("Missing selection")?.into_policy(&config)?,
    )?;
    let selected = Host::new(selected, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?
        .with_loopback_local()?
        .with_full_geodata()?;
    let response = router(selected)
        .oneshot(request(
            "GET",
            &format!("{base}/{}", id(8101)),
            vec![],
            Some(&cookie),
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    drop(selected_lease);
    println!(
        "PASS synthetic nonempty Stock/batch/upload predecessor; exact all29-table/rowid/inner metadata copy without replay; current native authority; SAME Core.store connection legacy Stock read/write + v2 Document/pinned source/exact original; full native/Stock/queue/media recovery capture/verify/restore/reopen. No actual R3 data, deployment or dispatch."
    );
    Ok(())
}
