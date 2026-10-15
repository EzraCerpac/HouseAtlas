//! Successful synthetic IFC/GLB custody, association, descriptor and reopen.
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
fn synthetic_ifc() -> Vec<u8> {
    b"ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;ENDSEC;\nEND-ISO-10303-21;".to_vec()
}
fn glb_fixture(original: &[u8]) -> Result<Vec<u8>, Failure> {
    use houseatlas_backend::media::{ifc_glb, types::sha256};
    let mut binary = vec![0u8; 44];
    for (i, v) in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.].iter().enumerate() {
        binary[4 * i..4 * i + 4].copy_from_slice(&v.to_le_bytes());
    }
    for (i, v) in [0u16, 1, 2].iter().enumerate() {
        binary[36 + 2 * i..38 + 2 * i].copy_from_slice(&v.to_le_bytes());
    }
    let doc = json!({
        "asset":{"version":"2.0","extras":{"houseatlasIfcDerivative":{
            "profile":ifc_glb::PROFILE,"originalSha256":sha256(original),"originalBytes":original.len(),
            "floorLabel":"Synthetic IFC floor","sourceUnits":"mm","sourceUpAxis":"Z",
            "glbUnits":"m","glbUpAxis":"Y","sourceToGlb":{"axisMap":["x","z","-y"],"scale":0.001},
            "converter":{"name":"synthetic-review-only","version":"1","configSha256":"a".repeat(64)}
        }}},
        "scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"name":"synthetic-mesh","mesh":0}],
        "meshes":[{"name":"synthetic-mesh","primitives":[{"attributes":{"POSITION":0},"indices":1,"mode":4}]}],
        "buffers":[{"byteLength":42}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":6}],
        "accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
                     {"bufferView":1,"componentType":5123,"count":3,"type":"SCALAR"}]
    });
    let mut document = serde_json::to_vec(&doc)?;
    while document.len() % 4 != 0 {
        document.push(b' ');
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"glTF");
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&((28 + document.len() + binary.len()) as u32).to_le_bytes());
    bytes.extend_from_slice(&(document.len() as u32).to_le_bytes());
    bytes.extend_from_slice(b"JSON");
    bytes.extend_from_slice(&document);
    bytes.extend_from_slice(&(binary.len() as u32).to_le_bytes());
    bytes.extend_from_slice(b"BIN\0");
    bytes.extend_from_slice(&binary);
    Ok(bytes)
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

#[tokio::main]
async fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::time::timeout(std::time::Duration::from_secs(180), healthy()).await??;
    Ok(())
}
async fn healthy() -> Result<(), Failure> {
    use houseatlas_backend::media::ifc_glb as glb;
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
    let original = synthetic_ifc();
    let derivative = glb_fixture(&original)?;
    let saved_original = custody(
        &mut client,
        &format!("{base}/originals"),
        5600,
        "SYNTHETIC.ifc",
        "application/x-step",
        &original,
        json!({"status":"unknown","reference":null}),
    )
    .await?;
    let original_id = saved_original["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing actual original asset id")?
        .to_owned();
    let saved_derivative=custody(&mut client,&format!("{base}/originals/{original_id}/derivative"),5602,"synthetic-mesh.glb",glb::MIME,&derivative,json!({"status":"permitted","reference":"Synthetic fixture authored here; no provider license assertion"})).await?;
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
    let g=client.command("geometry","create",601,json!({"producer":"ifc","producerVersion":null,"exportFormat":"ifc","originalAssetId":original_id,
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
    let (_descriptor_headers, descriptor_bytes) = get(&client, &descriptor_path).await?;
    let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
    assert_eq!(descriptor["profile"], "houseatlas.native-geometry.v2");
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
    assert_eq!(floor["profile"], glb::PROFILE);
    assert_eq!(floor["originalContentType"], "application/x-step");
    assert_eq!(floor["derivativeContentType"], glb::MIME);
    assert_eq!(floor["sourceUnits"], "unknown");
    assert_eq!(floor["declaredSourceUnits"], "mm");
    assert_eq!(floor["sourceUpAxis"], "unknown");
    assert_eq!(floor["declaredSourceUpAxis"], "Z");
    assert_eq!(floor["glbUnits"], "m");
    assert_eq!(floor["glbUpAxis"], "Y");
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
    assert_eq!(headers["content-type"], glb::MIME);
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
    println!(
        "PASS synthetic IFC/GLB custody: scoped Editor, IFC original and GLB derivative, association, typed descriptor and exact frame, persistent reopen/history, owned cleanup; no converter/IFC-unit/physical-placement claim"
    );
    Ok(())
}
