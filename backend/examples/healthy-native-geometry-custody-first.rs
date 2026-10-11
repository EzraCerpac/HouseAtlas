//! Successful synthetic native geometry custody and association on empty local state.
//! Actual password-disabled Editor session, canonical HTTP commands, SQLite and reopen.
//! No listener, provider, supplied principal/grant, household data or control case.
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
fn guard(kind: &str, n: u32) -> Value {
    json!({"target":target(kind,n),"revision":{"kind":"atlas","value":1}})
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
            "idempotencyKey":id(self.serial+1),"reason":"Synthetic reviewed native place naming","approvalReceiptId":null,
            "preconditions":{"target":revision.map(|v|json!({"kind":"atlas","value":v})),"guards":guards}})
    }
    async fn call(&mut self, command: Value) -> Result<Value, Failure> {
        self.call_at(command, None).await
    }
    async fn call_at(
        &mut self,
        command: Value,
        selected_path: Option<String>,
    ) -> Result<Value, Failure> {
        let validator = wire::StockValidation::new()?;
        let parsed = wire::StockRequest::parse(&validator, command.clone())?;
        let base = format!("/api/atlas/stock/v3/workspaces/{}/homes/{}", id(2), id(3));
        let writing = command.get("idempotencyKey").is_some();
        let (method, path, body) = if writing {
            self.posts += 1;
            (
                "POST",
                selected_path.unwrap_or_else(|| format!("{base}/commands")),
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
            "idempotencyKey":id(self.serial+2),"reason":"Synthetic reviewed native place naming","approvalReceiptId":null,"preconditions":{"target":null,"guards":guards}});
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
}
fn revision_guard(kind: &str, key: &str, value: u64) -> Value {
    json!({"target":{"authority":"atlas","recordType":kind,"recordId":key},"revision":{"kind":"atlas","value":value}})
}
fn synthetic_usdz() -> Vec<u8> {
    // Stored ZIP/USDC-signature framing fixture only; no usdcat execution or
    // actual USD scene semantic parsing is claimed by this successful case.
    let name = b"synthetic.usdc";
    let data = b"PXR-USDCSynthetic private framing fixture";
    let crc = crc32fast::hash(data);
    let pad = (64 - (30 + name.len()) % 64) % 64;
    let mut b = Vec::new();
    b.extend(b"PK\x03\x04");
    for n in [20u16, 0, 0, 0, 0] {
        b.extend(n.to_le_bytes());
    }
    for n in [crc, data.len() as u32, data.len() as u32] {
        b.extend(n.to_le_bytes());
    }
    b.extend((name.len() as u16).to_le_bytes());
    b.extend((pad as u16).to_le_bytes());
    b.extend(name);
    b.extend(vec![0; pad]);
    b.extend(data);
    let central = b.len() as u32;
    b.extend(b"PK\x01\x02");
    for n in [20u16, 20, 0, 0, 0, 0] {
        b.extend(n.to_le_bytes());
    }
    for n in [crc, data.len() as u32, data.len() as u32] {
        b.extend(n.to_le_bytes());
    }
    for n in [name.len() as u16, 0, 0, 0, 0] {
        b.extend(n.to_le_bytes());
    }
    for n in [0u32, 0] {
        b.extend(n.to_le_bytes());
    }
    b.extend(name);
    let central_size = b.len() as u32 - central;
    b.extend(b"PK\x05\x06");
    for n in [0u16, 0, 1, 1] {
        b.extend(n.to_le_bytes());
    }
    b.extend(central_size.to_le_bytes());
    b.extend(central.to_le_bytes());
    b.extend(0u16.to_le_bytes());
    b
}
fn mesh_fixture(original: &[u8]) -> Result<Vec<u8>, Failure> {
    use houseatlas_backend::media::{self as m, mesh_derivative as mesh};
    let mut profile: Value = serde_json::from_str(SYNTHETIC_MESH)?;
    let work = m::WorkBudget::new(
        std::time::Duration::from_secs(10),
        m::Cancellation::default(),
    )?;
    let layer = m::geometry_original::inspect_usdz(original, &work)?;
    profile["source"]["originalSHA256"] = json!(m::types::sha256(original));
    profile["source"]["originalBytes"] = json!(original.len());
    profile["source"]["primaryLayerName"] = json!(layer.name);
    profile["source"]["primaryLayerSHA256"] = json!(layer.sha256);
    profile["source"]["primaryLayerBytes"] = json!(layer.byte_size);
    // Synthetic metadata explicitly says it did not execute the converter.
    // Pinned protocol identities are data, never a conversion attestation.
    profile["converter"]["codeSHA256"] = json!(mesh::CONVERTER_SHA256);
    profile["converter"]["schemaSHA256"] = json!(mesh::SCHEMA_SHA256);
    profile["converter"]["profileSHA256"] = json!(mesh::PROFILE_SHA256);
    Ok(serde_json::to_vec(&profile)?)
}
async fn custody(
    client: &mut Client,
    path: &str,
    n: u32,
    filename: &str,
    mime: &str,
    bytes: &[u8],
    license: Value,
) -> Result<Value, Failure> {
    let boundary = "HouseAtlasSyntheticGeometryBoundary";
    let metadata = json!({"schemaVersion":1,"requestId":id(n),"idempotencyKey":id(n+1),"context":client.scope,
        "filename":filename,"contentType":mime,"reason":"Synthetic original and immutable derivative custody","sourceLicense":license});
    let mut body=format!("--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n",serde_json::to_string(&metadata)?).into_bytes();
    body.extend(bytes);
    body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut req = request("POST", path, body, Some(&client.cookie), Some(&client.csrf))?;
    req.headers_mut().insert(
        "content-type",
        format!("multipart/form-data; boundary={boundary}").parse()?,
    );
    let response = client.app.clone().oneshot(req).await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let output: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), MAX_RESPONSE).await?)?;
    assert_eq!(output["association"], "not-associated");
    let validation = wire::StockValidation::new()?;
    let parsed = wire::StockRequest::parse(&validation, output["originalRequest"].clone())?;
    wire::StockResponse::parse(&validation, &parsed, output["result"].clone(), &[])?;
    assert_eq!(output["originalRequest"]["requestId"], id(n));
    assert_eq!(output["result"]["status"], "committed");
    assert_eq!(output["result"]["replayed"], false);
    assert_eq!(
        output["result"]["data"]["requestDigest"],
        parsed.intent_digest()
    );
    assert_eq!(
        output["result"]["data"]["records"][0]["payload"]["sha256"],
        houseatlas_backend::media::types::sha256(bytes)
    );
    assert_eq!(
        output["result"]["data"]["records"][0]["payload"]["byteSize"],
        bytes.len()
    );
    assert_eq!(
        output["result"]["data"]["records"][0]["payload"]["contentType"],
        mime
    );
    assert!(
        output["result"]["data"]["records"][0]["payload"]
            .get("storageKey")
            .is_none()
    );
    Ok(output)
}
async fn get(client: &Client, path: &str) -> Result<(axum::http::HeaderMap, Vec<u8>), Failure> {
    let response = client
        .app
        .clone()
        .oneshot(request("GET", path, vec![], Some(&client.cookie), None)?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers().clone();
    assert_eq!(headers["cache-control"], "private, no-store");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    Ok((
        headers,
        to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await?
            .to_vec(),
    ))
}

// Optional evidence for ONE separately released healthy cross-language reader.
// This can only receive the bytes generated by healthy() below. No auth headers.
fn emit_produced_read(
    scope: &Value,
    descriptor_path: &str,
    descriptor_headers: &axum::http::HeaderMap,
    descriptor_bytes: &[u8],
    mesh_path: &str,
    mesh_headers: &axum::http::HeaderMap,
    mesh_bytes: &[u8],
) -> Result<(), Failure> {
    use houseatlas_backend::media::{mesh_derivative as mesh, types::sha256};
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let Some(path) = std::env::var_os("HOUSEATLAS_GEOMETRY_SEAM_EVIDENCE") else {
        return Ok(());
    };
    let dir = std::path::PathBuf::from(path);
    if !dir.is_absolute() || dir.file_name().is_none() {
        return Err("Evidence target must be a new absolute directory".into());
    }
    let parent = dir.parent().ok_or("Missing evidence parent")?;
    if fs::canonicalize(parent)? != parent {
        return Err("Evidence parent must be canonical and already owned".into());
    }
    // Existing targets fail: no overwrite, resume, append or adoption of a directory.
    fs::DirBuilder::new().mode(0o700).create(&dir)?;
    let emit = || -> Result<(), Failure> {
        let capture = |filename: &str,
                       path: &str,
                       headers: &axum::http::HeaderMap,
                       bytes: &[u8],
                       max: usize|
         -> Result<Value, Failure> {
            if bytes.is_empty() || bytes.len() > max {
                return Err("Synthetic response exceeds evidence bound".into());
            }
            let mut selected = BTreeMap::new();
            // Exact observed values; absent optional headers are not manufactured.
            for name in [
                "content-type",
                "content-length",
                "cache-control",
                "x-content-type-options",
                "content-security-policy",
                "x-atlas-geometry-view",
            ] {
                if let Some(value) = headers.get(name) {
                    selected.insert(name, value.to_str()?);
                }
            }
            if serde_json::to_vec(&selected)?.len() > 8192 {
                return Err("Synthetic response header bound exceeded".into());
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(dir.join(filename))?;
            file.write_all(bytes)?;
            file.sync_all()?;
            Ok(
                json!({"file":filename,"path":path,"status":200,"headers":selected,
                      "bytes":bytes.len(),"sha256":sha256(bytes)}),
            )
        };
        let descriptor = capture(
            "descriptor.json",
            descriptor_path,
            descriptor_headers,
            descriptor_bytes,
            1024 * 1024,
        )?;
        let derivative = capture(
            "mesh.json",
            mesh_path,
            mesh_headers,
            mesh_bytes,
            mesh::MAX_MESH_BYTES,
        )?;
        let manifest = serde_json::to_vec_pretty(&json!({
            "schema":"houseatlas.synthetic-native-produced-read.v1",
            "basis":"generated native healthy example; no converter or household data",
            "origin":ORIGIN,"scope":scope,"buildingId":id(101),
            "descriptor":descriptor,"mesh":derivative,
            "producer":{"profile":mesh::PROFILE,"codeSHA256":mesh::CONVERTER_SHA256,
                        "schemaSHA256":mesh::SCHEMA_SHA256,"profileSHA256":mesh::PROFILE_SHA256},
            "cleanup":{"nativeClientsAndLeasesDropped":true,"nativeScratchRemoved":true,
                       "sameDescriptorAndMeshAfterStrictReopen":true}
        }))?;
        if manifest.len() > 16384 {
            return Err("Evidence manifest bound exceeded".into());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(dir.join("produced-read.json"))?;
        file.write_all(&manifest)?;
        file.sync_all()?;
        Ok(())
    };
    if let Err(error) = emit() {
        // Remove only the directory this call just created; never an existing target.
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }
    println!("Synthetic native GET evidence retained; consumer execution remains separate");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::time::timeout(std::time::Duration::from_secs(180), healthy()).await??;
    Ok(())
}
async fn healthy() -> Result<(), Failure> {
    use houseatlas_backend::media::mesh_derivative as mesh;
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-native-geometry-")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir_in("/tmp")?;
    let root = fs::canonicalize(scratch.path())?;
    let config: ServerConfig = serde_json::from_value(
        json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),"frontendDirectory":root.join("frontend"),
        "tlsCertificate":root.join("unused.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,"homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}}}),
    )?;
    persistent::initialize_without_password(&config)?;
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
    let e = client.command(
        "evidence",
        "create",
        100,
        evidence("Synthetic building classification, not a physical survey."),
        None,
        vec![],
    );
    let i = client.command(
        "identity",
        "create",
        101,
        json!({"kind":"location","evidenceIds":[id(100)]}),
        None,
        vec![],
    );
    let s=client.command("location-semantics","create",201,json!({"atlasId":id(101),"semanticKind":"building","label":"Synthetic geometry building","reviewStatus":"accepted","evidenceIds":[id(100)]}),None,vec![]);
    let building = client.batch(vec![e, i, s], vec![]).await?;
    assert_eq!(
        building["data"]["records"]
            .as_array()
            .ok_or("Missing building records")?
            .len(),
        3
    );
    let base = format!(
        "/api/atlas/geometry/v1/workspaces/{}/homes/{}",
        id(2),
        id(3)
    );
    let original = synthetic_usdz();
    let derivative = mesh_fixture(&original)?;
    let saved_original = custody(
        &mut client,
        &format!("{base}/originals"),
        5600,
        "SYNTHETIC.usdz",
        "model/vnd.usdz+zip",
        &original,
        json!({"status":"unknown","reference":null}),
    )
    .await?;
    let original_id = saved_original["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing actual original asset id")?
        .to_owned();
    let saved_derivative=custody(&mut client,&format!("{base}/originals/{original_id}/derivative"),5602,"synthetic-mesh.json",mesh::MIME,&derivative,json!({"status":"permitted","reference":"Synthetic fixture authored here; no provider license assertion"})).await?;
    let derivative_id = saved_derivative["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing actual derivative asset id")?
        .to_owned();
    assert_eq!(
        saved_original["result"]["data"]["records"][0]["payload"]["purpose"],
        "geometry-original"
    );
    assert_eq!(
        saved_derivative["result"]["data"]["records"][0]["payload"]["purpose"],
        "derived-preview"
    );
    for result in [&saved_original, &saved_derivative] {
        assert_eq!(
            result["result"]["data"]["records"][0]["payload"]["previewPolicy"],
            "download-only"
        );
    }
    // Available native assets exist before the final association. This pass
    // deliberately makes no assertion of a five-record all-or-none mutation.
    let original_guard = revision_guard("asset", &original_id, 1);
    let derivative_guard = revision_guard("asset", &derivative_id, 1);
    let mut association_evidence = evidence(
        "I associate this synthetic export and immutable closed derivative with this building; physical scale/alignment remain unknown.",
    );
    association_evidence["references"] = json!([{"kind":"atlas-asset","assetId":original_id},{"kind":"atlas-asset","assetId":derivative_id}]);
    let e = client.command(
        "evidence",
        "create",
        600,
        association_evidence,
        None,
        vec![original_guard.clone(), derivative_guard.clone()],
    );
    let g=client.command("geometry","create",601,json!({"producer":"magicplan","producerVersion":null,"exportFormat":"usdz","originalAssetId":original_id,
        "coordinateUnits":"unknown","scale":null,"transform":null,"mappings":[],"geometryVersion":1,"previousGeometryId":null,"evidenceIds":[id(600)]}),None,vec![original_guard.clone()]);
    let i = client.command(
        "identity",
        "replace",
        101,
        json!({"kind":"location","evidenceIds":[id(100),id(600)]}),
        Some(1),
        vec![guard("evidence", 100)],
    );
    client.serial += 3;
    let root_request = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(client.serial),"context":client.scope,
        "target":{"authority":"atlas","kind":"batch","batchId":id(client.serial+1)},"payload":{"commands":[e,g,i]},"idempotencyKey":id(client.serial+2),
        "reason":"Synthetic reviewed geometry association","approvalReceiptId":null,"preconditions":{"target":null,"guards":[guard("identity",101),guard("location-semantics",201),guard("evidence",100),original_guard,derivative_guard]}});
    let before = time::OffsetDateTime::now_utc();
    let committed = client
        .call_at(
            root_request,
            Some(format!("{base}/buildings/{}/associations", id(101))),
        )
        .await?;
    let imported = committed["data"]["records"]
        .as_array()
        .ok_or("Missing association records")?
        .iter()
        .find(|r| r["target"]["recordType"] == "geometry")
        .ok_or("Missing actual geometry")?["payload"]["importedAt"]
        .as_str()
        .ok_or("Missing server importedAt")?;
    let imported =
        time::OffsetDateTime::parse(imported, &time::format_description::well_known::Rfc3339)?;
    assert!(imported >= before && imported <= time::OffsetDateTime::now_utc());
    let descriptor_path = format!("{base}/buildings/{}", id(101));
    let (descriptor_headers, descriptor_bytes) = get(&client, &descriptor_path).await?;
    let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
    assert_eq!(
        descriptor["floors"]
            .as_array()
            .ok_or("Missing descriptor floors")?
            .len(),
        1
    );
    assert_eq!(descriptor["physicalScale"], "unknown");
    assert_eq!(descriptor["floorAlignment"], "unknown");
    assert_eq!(descriptor["stageToHouseTransform"], Value::Null);
    let floor = &descriptor["floors"][0]["floor"];
    assert_eq!(
        floor["originalSha256"],
        houseatlas_backend::media::types::sha256(&original)
    );
    assert_eq!(
        floor["derivativeSha256"],
        houseatlas_backend::media::types::sha256(&derivative)
    );
    let path = descriptor["floors"][0]["readPath"]
        .as_str()
        .ok_or("Missing owner-provided read path")?;
    let (headers, read) = get(&client, path).await?;
    assert_eq!(headers["content-type"], mesh::MIME);
    assert_eq!(read, derivative);
    let history = client
        .read(
            "geometry",
            "history",
            601,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(
        history["data"]["entries"]
            .as_array()
            .ok_or("Missing history")?
            .len(),
        1
    );
    drop(client);
    drop(lease);
    let (mut reopened, reopened_lease) = Client::open(&config).await?;
    let (_, again) = get(&reopened, &descriptor_path).await?;
    assert_eq!(again, descriptor_bytes);
    let (_, again) = get(&reopened, path).await?;
    assert_eq!(again, derivative);
    let reopened_history = reopened
        .read(
            "geometry",
            "history",
            601,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    assert_eq!(
        reopened_history["data"]["entries"],
        history["data"]["entries"]
    );
    drop(reopened);
    drop(reopened_lease);
    scratch.close()?;
    emit_produced_read(
        &descriptor["scope"],
        &descriptor_path,
        &descriptor_headers,
        &descriptor_bytes,
        path,
        &headers,
        &read,
    )?;
    println!(
        "PASS synthetic native geometry custody: real scoped Editor, two sealed asset roots, three-child association, server timestamp, distinct MIME/purpose/license, complete retained correlation, exact closed-chain delivery, persistent reopen/history, owned cleanup; no converter/listener/provider/physical placement claim"
    );
    Ok(())
}

// Original synthetic example sha4e7e21e9, updated only measured lineage and protocol identity fields above.
const SYNTHETIC_MESH: &str = r####"{"profile":"houseatlas.magicplan-authored-mesh.v1","source":{"fileName":"SYNTHETIC.usdz","floorLabel":"Synthetic export label","originalSHA256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","originalBytes":1,"primaryLayerName":"synthetic.usdc","primaryLayerSHA256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","primaryLayerBytes":1,"serializedUSDASHA256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","serializedUSDABytes":1},"converter":{"codeSHA256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","schemaSHA256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","profileSHA256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","usdcatExecutableSHA256":"0000000000000000000000000000000000000000000000000000000000000000","usdcatVersion":"synthetic example; no actual conversion claim","invocation":"usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network"},"authoredCoordinates":{"upAxis":"Y","metersPerUnitToken":"1","defaultPrim":"Synthetic","matrixConvention":"row-major storage; row vector p_local * M_mesh * M_parent * ...","numericTokenProvenance":"exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes"},"qualification":{"physicalScale":"unknown","floorAlignment":"unknown","stageToHouseTransform":null,"semanticRoomObjects":0},"nodes":[{"path":"/Synthetic","primType":"Xform","parentPath":null,"authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]}],"localMatrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]},{"path":"/Synthetic/Triangle","primType":"Mesh","parentPath":"/Synthetic","authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"localMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"meshes":[{"sourceObjectId":"/Synthetic/Triangle","sourceName":"Triangle","positionsLocalTokens":["-0","0","0","1","0","0","0","1","0"],"triangleIndicesTokens":["0","1","2"],"faceVertexCounts":{"repeatedToken":"3","count":1},"ancestorChain":["/Synthetic/Triangle","/Synthetic"],"appliedChain":["/Synthetic/Triangle","/Synthetic"],"composedLocalToStageMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","5","0","0","1"],"authoredOrientation":null,"resolvedOrientation":"rightHanded","orientationQualification":"USD schema default; not physically verified","authoredDoubleSided":null,"vertexCount":3,"triangleCount":1,"authoredDoubleSidedToken":null}],"counts":{"meshes":1,"vertices":3,"triangles":1,"nodes":2}}
"####;
