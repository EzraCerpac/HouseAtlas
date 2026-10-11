//! Named issue-149 synthetic acceptance lane for durable scene room anchors.
//! Actual Editor session, retained Media originals, Stock routes, SQLite and reopen.
//! No listener, provider, supplied principal/grant or household data.
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
            "idempotencyKey":id(self.serial+1),"reason":"Synthetic reviewed native scene evidence","approvalReceiptId":null,
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
            "command {}: {}",
            parsed.id().as_str(),
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
    async fn reject(&mut self, command: Value) -> Result<(), Failure> {
        let validator = wire::StockValidation::new()?;
        let parsed = wire::StockRequest::parse(&validator, command.clone())?;
        let path = format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
            id(2),
            id(3)
        );
        self.posts += 1;
        let response = self
            .app
            .clone()
            .oneshot(request(
                "POST",
                &path,
                serde_json::to_vec(&command)?,
                Some(&self.cookie),
                Some(&self.csrf),
            )?)
            .await?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
        assert!(
            status.is_client_error(),
            "invalid room mapping unexpectedly accepted: {}",
            String::from_utf8_lossy(&bytes)
        );
        let error: Value = serde_json::from_slice(&bytes)?;
        assert_eq!(
            error["code"],
            "invalid-contract",
            "unexpected rejection for {}: {error}",
            parsed.id().as_str()
        );
        Ok(())
    }
    async fn batch(&mut self, commands: Vec<Value>, guards: Vec<Value>) -> Result<Value, Failure> {
        self.serial += 3;
        let root = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(self.serial),"context":self.scope,
            "target":{"authority":"atlas","kind":"batch","batchId":id(self.serial+1)},"payload":{"commands":commands},
            "idempotencyKey":id(self.serial+2),"reason":"Synthetic reviewed native scene evidence","approvalReceiptId":null,"preconditions":{"target":null,"guards":guards}});
        self.call(root).await
    }
    async fn read(
        &mut self,
        kind: &str,
        verb: &str,
        n: u32,
        payload: Value,
    ) -> Result<Value, Failure> {
        self.read_key(kind, verb, &id(n), payload).await
    }
    async fn read_key(
        &mut self,
        kind: &str,
        verb: &str,
        record_id: &str,
        payload: Value,
    ) -> Result<Value, Failure> {
        self.serial += 1;
        let command = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":if verb == "list" { json!({"authority":"atlas","recordType":kind}) } else { json!({"authority":"atlas","recordType":kind,"recordId":record_id}) },"payload":payload});
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

// The existing synthetic geometry frame is locally authored; no converter runs.
const SYNTHETIC_MESH: &str = r####"{"profile":"houseatlas.magicplan-authored-mesh.v1","source":{"fileName":"SYNTHETIC.usdz","floorLabel":"Synthetic export label","originalSHA256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","originalBytes":1,"primaryLayerName":"synthetic.usdc","primaryLayerSHA256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","primaryLayerBytes":1,"serializedUSDASHA256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","serializedUSDABytes":1},"converter":{"codeSHA256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","schemaSHA256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","profileSHA256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","usdcatExecutableSHA256":"0000000000000000000000000000000000000000000000000000000000000000","usdcatVersion":"synthetic example; no actual conversion claim","invocation":"usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network"},"authoredCoordinates":{"upAxis":"Y","metersPerUnitToken":"1","defaultPrim":"Synthetic","matrixConvention":"row-major storage; row vector p_local * M_mesh * M_parent * ...","numericTokenProvenance":"exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes"},"qualification":{"physicalScale":"unknown","floorAlignment":"unknown","stageToHouseTransform":null,"semanticRoomObjects":0},"nodes":[{"path":"/Synthetic","primType":"Xform","parentPath":null,"authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]}],"localMatrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]},{"path":"/Synthetic/Triangle","primType":"Mesh","parentPath":"/Synthetic","authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"localMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"meshes":[{"sourceObjectId":"/Synthetic/Triangle","sourceName":"Triangle","positionsLocalTokens":["-0","0","0","1","0","0","0","1","0"],"triangleIndicesTokens":["0","1","2"],"faceVertexCounts":{"repeatedToken":"3","count":1},"ancestorChain":["/Synthetic/Triangle","/Synthetic"],"appliedChain":["/Synthetic/Triangle","/Synthetic"],"composedLocalToStageMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","5","0","0","1"],"authoredOrientation":null,"resolvedOrientation":"rightHanded","orientationQualification":"USD schema default; not physically verified","authoredDoubleSided":null,"vertexCount":3,"triangleCount":1,"authoredDoubleSidedToken":null}],"counts":{"meshes":1,"vertices":3,"triangles":1,"nodes":2}}
"####;

fn endpoint(n: u32) -> Value {
    json!({"kind":"atlas-record","ref":{"recordType":"identity","recordId":id(n)}})
}
fn referenced_evidence(statement: &str, asset_id: &str) -> Value {
    let mut item = evidence(statement);
    item["references"] = json!([{"kind":"atlas-asset","assetId":asset_id}]);
    item
}
fn sha(bytes: &[u8]) -> String {
    houseatlas_backend::media::types::sha256(bytes)
}

// This is the standalone native Media/Stock owner, not an invented asset row.
async fn custody_text(
    client: &mut Client,
    n: u32,
    text: &[u8],
) -> Result<(String, Value), Failure> {
    let boundary = "HouseAtlasSyntheticSceneBoundary";
    let metadata = json!({"schemaVersion":1,"requestId":id(n),"idempotencyKey":id(n+1),"context":client.scope,
        "filename":format!("synthetic-{n}.txt"),"contentType":"text/plain",
        "reason":"Synthetic reviewed scene source custody",
        "sourceLicense":{"status":"unknown","reference":null}});
    let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic-{n}.txt\"\r\nContent-Type: text/plain\r\n\r\n", serde_json::to_string(&metadata)?).into_bytes();
    body.extend(text);
    body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut req = request(
        "POST",
        &format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}/assets",
            id(2),
            id(3)
        ),
        body,
        Some(&client.cookie),
        Some(&client.csrf),
    )?;
    req.headers_mut().insert(
        "content-type",
        format!("multipart/form-data; boundary={boundary}").parse()?,
    );
    let response = client.app.clone().oneshot(req).await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let result: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(result["status"], "committed");
    assert_eq!(result["replayed"], false);
    assert_eq!(result["commandId"], "atlas.asset.create");
    let records = result["data"]["records"]
        .as_array()
        .ok_or("Missing retained asset record")?;
    assert_eq!(records.len(), 1);
    let record = &records[0];
    let asset_id = record["target"]["recordId"]
        .as_str()
        .ok_or("Missing owner asset ID")?
        .to_owned();
    assert_eq!(record["payload"]["sha256"], sha(text));
    assert_eq!(record["payload"]["byteSize"], text.len());
    assert_eq!(record["payload"]["purpose"], "evidence-original");
    assert_eq!(record["payload"]["contentType"], "text/plain");
    assert_eq!(record["payload"]["availability"], "available");
    assert_eq!(record["revision"], 1);
    Ok((asset_id, result))
}

fn receipt(version: u8, historical_sha: &str) -> Result<(Value, String), Failure> {
    let anchor = json!({"id":format!("synthetic-anchor-{version}"),
        "sourceFloorKey":"synthetic-source-floor","sourceOriginalSha256":historical_sha,
        "targets":[{"packagePlaceKey":"synthetic-room","packagePlaceUuid":id(802)}],
        "unresolvedLabels":[]});
    // This generic, unreferenced anchor may legitimately have multiple targets.
    let unrelated = json!({"id":format!("synthetic-generic-multi-target-{version}"),
        "sourceFloorKey":"synthetic-source-floor","sourceOriginalSha256":historical_sha,
        "targets":[{"packagePlaceKey":"generic-place-a","packagePlaceUuid":id(802)},
            {"packagePlaceKey":"generic-place-b","packagePlaceUuid":id(803)}],
        "unresolvedLabels":[]});
    let value = json!({"profile":"houseatlas.native-scene-room-review.v1",
        "receiptId":id(800+u32::from(version)),"sourceReceiptSha256":historical_sha,"anchors":[anchor,unrelated]});
    let canonical = houseatlas_backend::contracts::semantics::canonical_json(&value)?;
    Ok((value, canonical))
}
fn canonical_review(value: Value) -> Result<(Value, String), Failure> {
    let canonical = houseatlas_backend::contracts::semantics::canonical_json(&value)?;
    Ok((value, canonical))
}
fn scene_text(
    version: u8,
    canonical: &str,
    receipt_id: &str,
    receipt_sha: &str,
    historical_sha: &str,
) -> Result<Vec<u8>, Failure> {
    let mut scene = json!({"schema":"houseatlas.native-scene-source.v1","receiptCanonicalJson":canonical,
        "rooms":{"status":"available","reason":null,"receiptId":receipt_id,"receiptSha256":receipt_sha,
            "entries":[{"id":format!("synthetic-room-{version}"),"label":"Synthetic room",
                "sourceFloorKey":"synthetic-source-floor","sourceOriginalSha256":historical_sha,
                "sourceAnchorIds":[format!("synthetic-anchor-{version}")],
                "packagePlaceKey":"synthetic-room","packagePlaceUuid":id(802),
                "xFraction":0.5,"yFraction":0.5}],"regions":[]},
        "network":{"status":"unavailable","reason":"not-retained","source":null,
            "devices":null,"endpoints":null,"links":null},
        "electricity":{"status":"unavailable","reason":"not-retained","documentarySource":null,
            "roomRegistry":null,"buildingPackageKey":null,"retrievedAt":null}});
    if version == 2 {
        scene["schema"] = json!("houseatlas.native-scene-source.v2");
        scene["electricalFixtures"] = json!({"status":"unavailable","reason":"not-retained",
            "documentaryFixtures":null});
    }
    Ok(serde_json::to_vec(&scene)?)
}
struct ScenePayload<'a> {
    version: u8,
    previous: Option<&'a str>,
    historical_asset: &'a str,
    primary_asset: &'a str,
    historical_sha: &'a str,
    primary_sha: &'a str,
    canonical: &'a str,
    receipt: &'a Value,
    floor: &'a Value,
    evidence_id: u32,
}

fn scene_payload(input: ScenePayload<'_>) -> Value {
    let ScenePayload {
        version,
        previous,
        historical_asset,
        primary_asset,
        historical_sha,
        primary_sha,
        canonical,
        receipt,
        floor,
        evidence_id,
    } = input;
    let receipt_sha = sha(canonical.as_bytes());
    let anchor = format!("synthetic-anchor-{version}");
    let room = format!("synthetic-room-{version}");
    json!({"profile":"houseatlas.native-scene-association.v1","buildingId":id(101),
        "associationVersion":version,"previousAssociationId":previous,
        "reviewStatus":"accepted","reviewStatement":"I reviewed this synthetic source and its complete room target membership.",
        "sourceDocuments":[
            {"role":"documentary-sheet","evidenceId":id(690),"evidenceRevision":1,
                "originalAssetId":historical_asset,"originalAssetRevision":1,"originalSha256":historical_sha,"contentType":"text/plain"},
            {"role":"primary-scene","evidenceId":id(evidence_id),"evidenceRevision":1,
                "originalAssetId":primary_asset,"originalAssetRevision":1,"originalSha256":primary_sha,"contentType":"text/plain"}],
        "acceptedReceipt":{"receiptId":receipt["receiptId"],"canonicalJson":canonical,
            "canonicalSha256":receipt_sha,"anchors":receipt["anchors"]},
        "sourceFloors":[{"sourceFloorKey":"synthetic-source-floor","sourceOriginalSha256":historical_sha,
            "nativeFloorKey":floor["key"],"nativeGeometryId":floor["geometryId"],
            "nativeGeometryRevision":floor["geometryRevision"],
            "nativeOriginalAssetId":floor["originalAssetId"],
            "nativeOriginalSha256":floor["originalSha256"]}],
        "roomMappings":[{"sourceRoomId":room,"sourceFloorKey":"synthetic-source-floor",
            "sourceOriginalSha256":historical_sha,"sourceAnchorIds":[anchor],
            "targets":[{"packagePlaceKey":"synthetic-room","packagePlaceUuid":id(802),
                "atlasPlaceId":id(102)}],"unresolvedLabels":[],"evidenceIds":[id(evidence_id)]}]})
}
async fn current(client: &Client) -> Result<Value, Failure> {
    let path = format!(
        "/api/atlas/scene/v1/workspaces/{}/homes/{}/buildings/{}/current",
        id(2),
        id(3),
        id(101)
    );
    let (headers, bytes) = get(client, &path).await?;
    assert_eq!(headers["cache-control"], "private, no-store");
    Ok(serde_json::from_slice(&bytes)?)
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
        .prefix("houseatlas-scene-association-")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempdir_in("/tmp")?;
    let root = fs::canonicalize(scratch.path())?;
    let config: ServerConfig =
        serde_json::from_value(json!({"schemaVersion":1,"deploymentId":id(1),
        "dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),
        "frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused.pem"),
        "tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,
        "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Synthetic Home"}],
        "mcpCommands":"read-only","authentication":{"mode":"loopback-local",
        "identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local",
        "scope":{"workspaceId":id(2),"homeId":id(3)}}}}))?;
    persistent::initialize_without_password(&config)?;
    let (mut client, mut lease) = Client::open(&config).await?;
    assert_eq!(
        client
            .read(
                "identity",
                "list",
                0,
                json!({"cursor":null,"pageSize":100,"includeArchived":false})
            )
            .await?["data"]["records"],
        json!([])
    );

    let place_commands = vec![
        client.command(
            "evidence",
            "create",
            100,
            evidence("Synthetic building, room and membership are my reviewed decision."),
            None,
            vec![],
        ),
        client.command(
            "identity",
            "create",
            101,
            json!({"kind":"location","evidenceIds":[id(100)]}),
            None,
            vec![],
        ),
        client.command(
            "identity",
            "create",
            102,
            json!({"kind":"location","evidenceIds":[id(100)]}),
            None,
            vec![],
        ),
        client.command(
            "location-semantics",
            "create",
            201,
            json!({"atlasId":id(101),"semanticKind":"building",
            "label":"Synthetic building","reviewStatus":"accepted","evidenceIds":[id(100)]}),
            None,
            vec![],
        ),
        client.command(
            "location-semantics",
            "create",
            202,
            json!({"atlasId":id(102),"semanticKind":"room",
            "label":"Synthetic room","reviewStatus":"accepted","evidenceIds":[id(100)]}),
            None,
            vec![],
        ),
        client.command(
            "relation",
            "create",
            301,
            json!({"kind":"location-membership","membershipKind":"building",
            "from":endpoint(101),"to":endpoint(102),"reviewStatus":"accepted",
            "uncertainty":{"status":"supported","explanation":null},"evidenceIds":[id(100)]}),
            None,
            vec![],
        ),
    ];
    let place = client.batch(place_commands, vec![]).await?;
    assert_eq!(
        place["data"]["records"]
            .as_array()
            .ok_or("Missing places")?
            .len(),
        6
    );

    let geometry_base = format!(
        "/api/atlas/geometry/v1/workspaces/{}/homes/{}",
        id(2),
        id(3)
    );
    let original = synthetic_usdz();
    let derivative = mesh_fixture(&original)?;
    let saved_original = custody(
        &mut client,
        &format!("{geometry_base}/originals"),
        5600,
        "SYNTHETIC.usdz",
        "model/vnd.usdz+zip",
        &original,
        json!({"status":"unknown","reference":null}),
    )
    .await?;
    let geometry_asset = saved_original["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing owned geometry asset ID")?
        .to_owned();
    let saved_derivative = custody(
        &mut client,
        &format!("{geometry_base}/originals/{geometry_asset}/derivative"),
        5602,
        "synthetic-mesh.json",
        mesh::MIME,
        &derivative,
        json!({"status":"permitted","reference":"Locally authored synthetic example"}),
    )
    .await?;
    let derivative_asset = saved_derivative["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing owned derivative asset ID")?
        .to_owned();
    let mut geometry_evidence = referenced_evidence(
        "I associate this synthetic export with the building; physical placement is unknown.",
        &geometry_asset,
    );
    geometry_evidence["references"] = json!([{"kind":"atlas-asset","assetId":geometry_asset},
        {"kind":"atlas-asset","assetId":derivative_asset}]);
    let children = vec![
        client.command(
            "evidence",
            "create",
            600,
            geometry_evidence,
            None,
            vec![
                revision_guard("asset", &geometry_asset, 1),
                revision_guard("asset", &derivative_asset, 1),
            ],
        ),
        client.command(
            "geometry",
            "create",
            601,
            json!({"producer":"magicplan","producerVersion":null,
            "exportFormat":"usdz","originalAssetId":geometry_asset,"coordinateUnits":"unknown",
            "scale":null,"transform":null,"mappings":[],"geometryVersion":1,
            "previousGeometryId":null,"evidenceIds":[id(600)]}),
            None,
            vec![revision_guard("asset", &geometry_asset, 1)],
        ),
        client.command(
            "identity",
            "replace",
            101,
            json!({"kind":"location","evidenceIds":[id(100),id(600)]}),
            Some(1),
            vec![guard("evidence", 100)],
        ),
    ];
    client.serial += 3;
    let association = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(client.serial),
        "context":client.scope,"target":{"authority":"atlas","kind":"batch","batchId":id(client.serial+1)},
        "payload":{"commands":children},"idempotencyKey":id(client.serial+2),
        "reason":"Synthetic reviewed native floor association","approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[guard("identity",101),guard("location-semantics",201),guard("evidence",100),
            revision_guard("asset",&geometry_asset,1),revision_guard("asset",&derivative_asset,1)]}});
    client
        .call_at(
            association,
            Some(format!(
                "{geometry_base}/buildings/{}/associations",
                id(101)
            )),
        )
        .await?;
    let (_, descriptor_bytes) =
        get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
    let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
    let offered = descriptor["floors"]
        .as_array()
        .ok_or("Missing native floors")?;
    assert_eq!(offered.len(), 1);
    let floor = &offered[0]["floor"];
    assert_eq!(floor["geometryId"], id(601));
    assert_eq!(floor["geometryRevision"], 1);
    assert_eq!(floor["originalAssetId"], geometry_asset);
    assert_eq!(floor["originalSha256"], sha(&original));
    assert_eq!(descriptor["physicalScale"], "unknown");

    let historical = b"{\"syntheticOwnerReceipt\":\"locally reviewed source only\"}";
    let historical_sha = sha(historical);
    let (historical_asset, _) = custody_text(&mut client, 6500, historical).await?;
    let e = client.command(
        "evidence",
        "create",
        690,
        referenced_evidence(
            "This synthetic historical source has one retained original.",
            &historical_asset,
        ),
        None,
        vec![revision_guard("asset", &historical_asset, 1)],
    );
    client.call(e).await?;
    let mut created_pins: Vec<(u32, Value, Value)> = Vec::new();
    for version in [1u8, 2u8] {
        let (review, canonical) = receipt(version, &historical_sha)?;
        let receipt_sha = sha(canonical.as_bytes());
        let source = scene_text(
            version,
            &canonical,
            review["receiptId"].as_str().ok_or("Missing receipt ID")?,
            &receipt_sha,
            &historical_sha,
        )?;
        let source_sha = sha(&source);
        let evidence_id = if version == 1 { 700 } else { 710 };
        let (primary_asset, _) =
            custody_text(&mut client, 6600 + 10 * u32::from(version), &source).await?;
        let e = client.command(
            "evidence",
            "create",
            evidence_id,
            referenced_evidence(
                "I reviewed this synthetic retained scene text and its complete room anchors.",
                &primary_asset,
            ),
            None,
            vec![revision_guard("asset", &primary_asset, 1)],
        );
        let mut building_evidence = vec![id(100), id(600), id(700)];
        if version == 2 {
            building_evidence.push(id(710));
        }
        let i = client.command(
            "identity",
            "replace",
            101,
            json!({"kind":"location","evidenceIds":building_evidence}),
            Some(u32::from(version) + 1),
            if version == 1 {
                vec![guard("evidence", 100), guard("evidence", 600)]
            } else {
                vec![
                    guard("evidence", 100),
                    guard("evidence", 600),
                    guard("evidence", 700),
                ]
            },
        );
        client
            .batch(vec![e, i], vec![revision_guard("asset", &primary_asset, 1)])
            .await?;
        // The descriptor's floor key includes the current building identity.
        // Refresh it after retaining this version's reviewed evidence.
        let (_, fresh_descriptor_bytes) =
            get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
        let fresh_descriptor: Value = serde_json::from_slice(&fresh_descriptor_bytes)?;
        let fresh_floors = fresh_descriptor["floors"]
            .as_array()
            .ok_or("Missing current native floors")?;
        assert_eq!(fresh_floors.len(), 1);
        let floor = &fresh_floors[0]["floor"];
        assert_eq!(floor["geometryId"], id(601));
        assert_eq!(floor["geometryRevision"], 1);
        assert_eq!(floor["originalAssetId"], geometry_asset);
        assert_eq!(floor["originalSha256"], sha(&original));
        let previous = if version == 1 { None } else { Some(id(900)) };
        let mut payload = scene_payload(ScenePayload {
            version,
            previous: previous.as_deref(),
            historical_asset: &historical_asset,
            primary_asset: &primary_asset,
            historical_sha: &historical_sha,
            primary_sha: &source_sha,
            canonical: &canonical,
            receipt: &review,
            floor,
            evidence_id,
        });
        if version == 2 {
            // Exercise the actual native route with retained, hash-pinned
            // malformed originals. Each source carries its exact canonical
            // receipt, so rejection reaches the room-anchor invariant rather
            // than failing source custody or digest checks.
            let before_head = current(&client).await?;
            assert_eq!(before_head["association"]["recordId"], id(900));
            let before_list = client
                .read(
                    "scene-association",
                    "list",
                    0,
                    json!({"cursor":null,"pageSize":100,"includeArchived":false}),
                )
                .await?["data"]["records"]
                .clone();
            let before_history = client
                .read(
                    "scene-association",
                    "history",
                    900,
                    json!({"cursor":null,"pageSize":100,"includeArchived":false}),
                )
                .await?["data"]["entries"]
                .clone();
            assert_eq!(before_list.as_array().ok_or("Missing scene list")?.len(), 1);
            assert_eq!(
                before_history
                    .as_array()
                    .ok_or("Missing scene history")?
                    .len(),
                1
            );
            for (offset, case) in [
                "two-target",
                "missing-target",
                "missing-anchor",
                "mismatched-target",
                "foreign-floor",
                "foreign-hash",
            ]
            .into_iter()
            .enumerate()
            {
                let mut bad_payload = payload.clone();
                let mut source: Value = serde_json::from_slice(&scene_text(
                    version,
                    &canonical,
                    review["receiptId"].as_str().ok_or("Missing receipt ID")?,
                    &receipt_sha,
                    &historical_sha,
                )?)?;
                if case == "two-target" || case == "missing-target" {
                    let mut multi = review.clone();
                    let targets = multi["anchors"][0]["targets"]
                        .as_array_mut()
                        .ok_or("Missing anchor targets")?;
                    if case == "two-target" {
                        targets.push(
                            json!({"packagePlaceKey":"second-room","packagePlaceUuid":id(803)}),
                        );
                    } else {
                        targets.clear();
                    }
                    let (multi, multi_canonical) = canonical_review(multi)?;
                    let multi_sha = sha(multi_canonical.as_bytes());
                    bad_payload["acceptedReceipt"]["canonicalJson"] =
                        json!(multi_canonical.clone());
                    bad_payload["acceptedReceipt"]["canonicalSha256"] = json!(multi_sha.clone());
                    bad_payload["acceptedReceipt"]["anchors"] = multi["anchors"].clone();
                    source["receiptCanonicalJson"] = json!(multi_canonical);
                    source["rooms"]["receiptSha256"] = json!(multi_sha);
                    if case == "two-target" {
                        bad_payload["roomMappings"][0]["targets"].as_array_mut().ok_or("Missing mapped targets")?
                            .push(json!({"packagePlaceKey":"second-room","packagePlaceUuid":id(803),"atlasPlaceId":id(102)}));
                    }
                } else if case == "missing-anchor" {
                    source["rooms"]["entries"][0]["sourceAnchorIds"] =
                        json!(["synthetic-anchor-absent"]);
                    bad_payload["roomMappings"][0]["sourceAnchorIds"] =
                        json!(["synthetic-anchor-absent"]);
                } else if case == "mismatched-target" {
                    source["rooms"]["entries"][0]["packagePlaceKey"] = json!("different-room");
                    source["rooms"]["entries"][0]["packagePlaceUuid"] = json!(id(803));
                    bad_payload["roomMappings"][0]["targets"] = json!([{"packagePlaceKey":"different-room",
                        "packagePlaceUuid":id(803),"atlasPlaceId":id(102)}]);
                } else if case == "foreign-floor" {
                    source["rooms"]["entries"][0]["sourceFloorKey"] = json!("foreign-source-floor");
                    bad_payload["roomMappings"][0]["sourceFloorKey"] =
                        json!("foreign-source-floor");
                    let mut floor = bad_payload["sourceFloors"][0].clone();
                    floor["sourceFloorKey"] = json!("foreign-source-floor");
                    bad_payload["sourceFloors"]
                        .as_array_mut()
                        .ok_or("Missing source floors")?
                        .push(floor);
                } else {
                    let wrong_hash = "9".repeat(64);
                    source["rooms"]["entries"][0]["sourceOriginalSha256"] =
                        json!(wrong_hash.clone());
                    bad_payload["roomMappings"][0]["sourceOriginalSha256"] =
                        json!(wrong_hash.clone());
                    let mut floor = bad_payload["sourceFloors"][0].clone();
                    floor["sourceOriginalSha256"] = json!(wrong_hash);
                    bad_payload["sourceFloors"]
                        .as_array_mut()
                        .ok_or("Missing source floors")?
                        .push(floor);
                }
                let malformed = serde_json::to_vec(&source)?;
                let malformed_sha = sha(&malformed);
                let budget = houseatlas_backend::media::WorkBudget::new(
                    std::time::Duration::from_secs(5),
                    houseatlas_backend::media::Cancellation::default(),
                )?;
                assert_eq!(
                    houseatlas_backend::media::scene_association::qualify_document(
                        &malformed,
                        &bad_payload,
                        &budget,
                    )
                    .unwrap_err(),
                    houseatlas_backend::media::MediaError::InvalidInput,
                    "{case} must fail the authoritative document qualifier",
                );
                let (malformed_asset, _) =
                    custody_text(&mut client, 6700 + 10 * offset as u32, &malformed).await?;
                let evidence_id = 720 + offset as u32;
                let evidence_command = client.command(
                    "evidence",
                    "create",
                    evidence_id,
                    referenced_evidence(
                        "Synthetic malformed room-anchor source retained for rejection coverage.",
                        &malformed_asset,
                    ),
                    None,
                    vec![revision_guard("asset", &malformed_asset, 1)],
                );
                client.call(evidence_command).await?;
                let mut evidence_ids = vec![id(100), id(600), id(700), id(710)];
                evidence_ids.push(id(evidence_id));
                let attach = client.command(
                    "identity",
                    "replace",
                    101,
                    json!({"kind":"location","evidenceIds":evidence_ids}),
                    Some(4 + offset as u32),
                    vec![
                        guard("evidence", 100),
                        guard("evidence", 600),
                        guard("evidence", 700),
                    ],
                );
                client.call(attach).await?;
                let (_, descriptor_bytes) =
                    get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
                let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
                let current_floor = descriptor["floors"]
                    .as_array()
                    .ok_or("Missing current floors")?
                    .first()
                    .ok_or("Missing current floor")?["floor"]
                    .clone();
                for floor in bad_payload["sourceFloors"]
                    .as_array_mut()
                    .ok_or("Missing source floors")?
                {
                    floor["nativeFloorKey"] = current_floor["key"].clone();
                }
                let retained_asset = client
                    .read_key("asset", "get", &malformed_asset, json!({}))
                    .await?;
                let asset_record = retained_asset["data"]["records"]
                    .as_array()
                    .ok_or("Missing retained malformed asset")?
                    .first()
                    .ok_or("Missing retained malformed asset")?;
                assert_eq!(asset_record["payload"]["sha256"], malformed_sha);
                assert_eq!(asset_record["payload"]["byteSize"], malformed.len());
                let retained_evidence = client
                    .read("evidence", "get", evidence_id, json!({}))
                    .await?;
                let evidence_record = retained_evidence["data"]["records"]
                    .as_array()
                    .ok_or("Missing retained malformed evidence")?
                    .first()
                    .ok_or("Missing retained malformed evidence")?;
                assert_eq!(
                    evidence_record["payload"]["references"][0]["assetId"],
                    malformed_asset
                );
                bad_payload["sourceDocuments"][1] = json!({"role":"primary-scene","evidenceId":id(evidence_id),
                    "evidenceRevision":1,"originalAssetId":malformed_asset,"originalAssetRevision":1,
                    "originalSha256":malformed_sha,"contentType":"text/plain"});
                let rejected = client.command(
                    "scene-association",
                    "create",
                    880 + offset as u32,
                    bad_payload,
                    None,
                    vec![
                        revision_guard("asset", &historical_asset, 1),
                        revision_guard("asset", &malformed_asset, 1),
                        revision_guard("geometry", &id(601), 1),
                        revision_guard("asset", &geometry_asset, 1),
                        revision_guard("identity", &id(101), 5 + offset as u64),
                        guard("identity", 102),
                        guard("location-semantics", 201),
                        guard("location-semantics", 202),
                        guard("evidence", 690),
                        guard("evidence", evidence_id),
                        guard("scene-association", 900),
                    ],
                );
                client.reject(rejected).await?;
                assert_eq!(
                    current(&client).await?,
                    before_head,
                    "{case} moved current head"
                );
                let after_list = client
                    .read(
                        "scene-association",
                        "list",
                        0,
                        json!({"cursor":null,"pageSize":100,"includeArchived":false}),
                    )
                    .await?["data"]["records"]
                    .clone();
                let after_history = client
                    .read(
                        "scene-association",
                        "history",
                        900,
                        json!({"cursor":null,"pageSize":100,"includeArchived":false}),
                    )
                    .await?["data"]["entries"]
                    .clone();
                assert_eq!(after_list, before_list, "{case} created a scene record");
                assert_eq!(
                    after_history, before_history,
                    "{case} changed scene history"
                );
                let retained_asset = client
                    .read_key("asset", "get", &malformed_asset, json!({}))
                    .await?;
                let retained_evidence = client
                    .read("evidence", "get", evidence_id, json!({}))
                    .await?;
                assert_eq!(
                    retained_asset["data"]["records"][0]["payload"]["sha256"],
                    malformed_sha
                );
                assert_eq!(
                    retained_asset["data"]["records"][0]["payload"]["byteSize"],
                    malformed.len()
                );
                assert_eq!(
                    retained_evidence["data"]["records"][0]["payload"]["references"][0]["assetId"],
                    malformed_asset
                );
                println!(
                    "PASS rejected {case}: retained original evidence unchanged; scene current/list/history unchanged"
                );
            }
            let (_, descriptor_bytes) =
                get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
            let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
            let current_floor = descriptor["floors"]
                .as_array()
                .ok_or("Missing current floors")?
                .first()
                .ok_or("Missing current floor")?["floor"]
                .clone();
            payload["sourceFloors"][0]["nativeFloorKey"] = current_floor["key"].clone();
        }
        // Build expected readback from the actual owner-returned asset IDs and
        // measured original bytes, before observing the scene-create result.
        let expected_documents = json!([
            {"role":"documentary-sheet","evidenceId":id(690),"evidenceRevision":1,
                "originalAssetId":historical_asset,"originalAssetRevision":1,
                "originalSha256":historical_sha,"contentType":"text/plain"},
            {"role":"primary-scene","evidenceId":id(evidence_id),"evidenceRevision":1,
                "originalAssetId":primary_asset,"originalAssetRevision":1,
                "originalSha256":source_sha,"contentType":"text/plain"}]);
        let expected_receipt = json!({"receiptId":review["receiptId"],"canonicalJson":canonical,
            "canonicalSha256":receipt_sha,"anchors":review["anchors"]});
        let scene = client.command(
            "scene-association",
            "create",
            899 + u32::from(version),
            payload,
            None,
            {
                let mut guards = vec![
                    revision_guard("asset", &historical_asset, 1),
                    revision_guard("asset", &primary_asset, 1),
                    revision_guard("geometry", &id(601), 1),
                    revision_guard("asset", &geometry_asset, 1),
                    revision_guard(
                        "identity",
                        &id(101),
                        u64::from(version) + 2 + if version == 2 { 6 } else { 0 },
                    ),
                    guard("identity", 102),
                    guard("location-semantics", 201),
                    guard("location-semantics", 202),
                    guard("evidence", 690),
                    guard("evidence", evidence_id),
                ];
                if version == 2 {
                    guards.push(guard("scene-association", 900));
                }
                guards
            },
        );
        let committed = client.call(scene).await?;
        let rows = committed["data"]["records"]
            .as_array()
            .ok_or("Missing durable scene record")?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["target"]["recordId"], id(899 + u32::from(version)));
        assert_eq!(rows[0]["payload"]["associationVersion"], version);
        assert_eq!(
            rows[0]["payload"]["acceptedReceipt"]["canonicalSha256"],
            receipt_sha
        );
        assert_eq!(
            rows[0]["payload"]["sourceDocuments"][1]["originalSha256"],
            source_sha
        );
        created_pins.push((
            899 + u32::from(version),
            expected_documents,
            expected_receipt,
        ));
        // Authentication is fresh on reopen, while synthetic request/key IDs
        // continue monotonically across the same disposable durable state.
        let issued_serial = client.serial;
        drop(client);
        drop(lease);
        let (mut reopened, reopened_lease) = Client::open(&config).await?;
        reopened.serial = issued_serial;
        client = reopened;
        lease = reopened_lease;
        let head = current(&client).await?;
        assert_eq!(head["status"], "available");
        assert_eq!(
            head["association"]["recordId"],
            id(899 + u32::from(version))
        );
        assert_eq!(
            head["association"]["payload"]["associationVersion"],
            version
        );
        if version == 1 {
            // The second reviewed source is selected only after this genuine reopen/read.
            assert_eq!(
                head["association"]["payload"]["previousAssociationId"],
                Value::Null
            );
        } else {
            assert_eq!(
                head["association"]["payload"]["previousAssociationId"],
                id(900)
            );
        }
    }
    assert_eq!(created_pins.len(), 2);
    for (number, version, predecessor) in [(900u32, 1u8, None), (901, 2, Some(id(900)))] {
        let (_, documents, receipt) = created_pins
            .iter()
            .find(|pin| pin.0 == number)
            .ok_or("Missing actual create source pins")?;
        let history = client
            .read(
                "scene-association",
                "history",
                number,
                json!({"cursor":null,"pageSize":100,"includeArchived":false}),
            )
            .await?;
        let entries = history["data"]["entries"]
            .as_array()
            .ok_or("Missing association history")?;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["target"]["recordId"], id(number));
        assert_eq!(entries[0]["commandId"], "atlas.scene-association.create");
        assert_eq!(entries[0]["state"], "committed");
        assert_eq!(history["data"]["nextCursor"], Value::Null);
        assert_eq!(history["data"]["completeness"], "atlas-owned-audit");
        let fetched = client
            .read("scene-association", "get", number, json!({}))
            .await?;
        let records = fetched["data"]["records"]
            .as_array()
            .ok_or("Missing immutable association")?;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["target"]["recordId"], id(number));
        assert_eq!(records[0]["revision"], 1);
        assert_eq!(records[0]["payload"]["associationVersion"], version);
        assert_eq!(
            records[0]["payload"]["previousAssociationId"],
            predecessor.as_ref().map_or(Value::Null, |id| json!(id))
        );
        assert_eq!(&records[0]["payload"]["sourceDocuments"], documents);
        assert_eq!(&records[0]["payload"]["acceptedReceipt"], receipt);
    }
    let listed = client
        .read(
            "scene-association",
            "list",
            0,
            json!({"cursor":null,"pageSize":100,"includeArchived":false}),
        )
        .await?;
    let rows = listed["data"]["records"]
        .as_array()
        .ok_or("Missing association rows")?;
    assert_eq!(rows.len(), 2);
    let mut rows = rows.clone();
    rows.sort_by(|left, right| {
        left["target"]["recordId"]
            .as_str()
            .cmp(&right["target"]["recordId"].as_str())
    });
    assert_eq!(rows[0]["target"]["recordId"], id(900));
    assert_eq!(rows[0]["revision"], 1);
    assert_eq!(rows[0]["payload"]["associationVersion"], 1);
    assert_eq!(rows[0]["payload"]["previousAssociationId"], Value::Null);
    assert_eq!(&rows[0]["payload"]["sourceDocuments"], &created_pins[0].1);
    assert_eq!(&rows[0]["payload"]["acceptedReceipt"], &created_pins[0].2);
    assert_eq!(rows[1]["target"]["recordId"], id(901));
    assert_eq!(rows[1]["revision"], 1);
    assert_eq!(rows[1]["payload"]["associationVersion"], 2);
    assert_eq!(rows[1]["payload"]["previousAssociationId"], id(900));
    assert_eq!(&rows[1]["payload"]["sourceDocuments"], &created_pins[1].1);
    assert_eq!(&rows[1]["payload"]["acceptedReceipt"], &created_pins[1].2);
    drop(client);
    drop(lease);
    scratch.close()?;
    println!(
        "PASS synthetic durable scene association: owned text and floor custody, reviewed Editor decision, strict reopen/current head, two immutable versions and authenticated history; no listener/provider/physical placement claim"
    );
    Ok(())
}
