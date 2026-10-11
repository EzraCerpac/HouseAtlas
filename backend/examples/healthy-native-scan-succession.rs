//! Successful synthetic two-floor native scan succession on empty local state.
//! Actual Editor session, retained Media originals, Stock commands, SQLite and reopen.
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
        self.serial += 1;
        let command = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(self.serial),"context":self.scope,"target":if verb == "list" { json!({"authority":"atlas","recordType":kind}) } else { target(kind,n) },"payload":payload});
        self.call(command).await
    }
}
fn revision_guard(kind: &str, key: &str, value: u64) -> Value {
    json!({"target":{"authority":"atlas","recordType":kind,"recordId":key},"revision":{"kind":"atlas","value":value}})
}
fn synthetic_usdz(variant: &str) -> Vec<u8> {
    // Stored ZIP/USDC-signature framing fixture only; no usdcat execution or
    // actual USD scene semantic parsing is claimed by this successful case.
    let name = b"synthetic.usdc";
    let data = format!("PXR-USDCSynthetic private framing fixture {variant}").into_bytes();
    let crc = crc32fast::hash(&data);
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
    b.extend(&data);
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
fn mesh_fixture(original: &[u8], label: &str) -> Result<Vec<u8>, Failure> {
    use houseatlas_backend::media::{self as m, mesh_derivative as mesh};
    let mut profile: Value = serde_json::from_str(SYNTHETIC_MESH)?;
    let work = m::WorkBudget::new(
        std::time::Duration::from_secs(10),
        m::Cancellation::default(),
    )?;
    let layer = m::geometry_original::inspect_usdz(original, &work)?;
    profile["source"]["floorLabel"] = json!(label);
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
    let value = json!({"profile":"houseatlas.native-scene-room-review.v1",
        "receiptId":id(800+u32::from(version)),"sourceReceiptSha256":historical_sha,"anchors":[anchor]});
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
            "entries":[{"id":"synthetic-room".to_owned(),"label":"Synthetic room",
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
    untouched: &'a Value,
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
        untouched,
        evidence_id,
    } = input;
    let receipt_sha = sha(canonical.as_bytes());
    let anchor = format!("synthetic-anchor-{version}");
    let room = "synthetic-room".to_owned();
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
            "nativeOriginalSha256":floor["originalSha256"]},
            {"sourceFloorKey":"synthetic-untouched-floor","sourceOriginalSha256":historical_sha,
            "nativeFloorKey":untouched["key"],"nativeGeometryId":untouched["geometryId"],
            "nativeGeometryRevision":untouched["geometryRevision"],
            "nativeOriginalAssetId":untouched["originalAssetId"],
            "nativeOriginalSha256":untouched["originalSha256"]}],
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

async fn append_geometry(
    client: &mut Client,
    evidence_id: u32,
    geometry_id: u32,
    previous: Option<u32>,
    variant: &str,
) -> Result<(String, String, Vec<u8>, Vec<u8>), Failure> {
    use houseatlas_backend::media::mesh_derivative as mesh;
    let base = format!(
        "/api/atlas/geometry/v1/workspaces/{}/homes/{}",
        id(2),
        id(3)
    );
    let original = synthetic_usdz(variant);
    let derivative = mesh_fixture(&original, variant)?;
    let saved = custody(
        client,
        &format!("{base}/originals"),
        5600 + evidence_id,
        "SYNTHETIC.usdz",
        "model/vnd.usdz+zip",
        &original,
        json!({"status":"unknown","reference":null}),
    )
    .await?;
    let original_id = saved["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing original")?
        .to_owned();
    let saved = custody(
        client,
        &format!("{base}/originals/{original_id}/derivative"),
        5602 + evidence_id,
        "synthetic-mesh.json",
        mesh::MIME,
        &derivative,
        json!({"status":"unknown","reference":null}),
    )
    .await?;
    let derivative_id = saved["originalRequest"]["target"]["recordId"]
        .as_str()
        .ok_or("Missing derivative")?
        .to_owned();
    let building =
        client.read("identity", "get", 101, json!({})).await?["data"]["records"][0].clone();
    let mut evidence_ids = building["payload"]["evidenceIds"]
        .as_array()
        .ok_or("Missing building evidence")?
        .clone();
    let evidence_guards: Vec<_> = evidence_ids
        .iter()
        .map(|value| revision_guard("evidence", value.as_str().unwrap(), 1))
        .collect();
    let mut root_guards = evidence_guards.clone();
    root_guards.extend([
        revision_guard("identity", &id(101), building["revision"].as_u64().unwrap()),
        guard("location-semantics", 201),
        revision_guard("asset", &original_id, 1),
        revision_guard("asset", &derivative_id, 1),
    ]);
    let mut geometry_guards = vec![revision_guard("asset", &original_id, 1)];
    let mut version = 1;
    if let Some(previous) = previous {
        let row = client.read("geometry", "get", previous, json!({})).await?["data"]["records"][0]
            .clone();
        version = row["payload"]["geometryVersion"].as_u64().unwrap() + 1;
        let previous_evidence = row["payload"]["evidenceIds"][0].as_str().unwrap();
        let e = client
            .read(
                "evidence",
                "get",
                previous_evidence[24..].parse()?,
                json!({}),
            )
            .await?["data"]["records"][0]
            .clone();
        for item in [
            revision_guard("geometry", &id(previous), row["revision"].as_u64().unwrap()),
            revision_guard(
                "evidence",
                previous_evidence,
                e["revision"].as_u64().unwrap(),
            ),
            revision_guard(
                "asset",
                e["payload"]["references"][0]["assetId"].as_str().unwrap(),
                1,
            ),
            revision_guard(
                "asset",
                e["payload"]["references"][1]["assetId"].as_str().unwrap(),
                1,
            ),
        ] {
            geometry_guards.push(item.clone());
            if !root_guards.contains(&item) {
                root_guards.push(item);
            }
        }
    }
    let mut e = evidence(
        "Synthetic explicit building scan succession; physical placement remains unknown.",
    );
    e["references"] = json!([{"kind":"atlas-asset","assetId":original_id},{"kind":"atlas-asset","assetId":derivative_id}]);
    evidence_ids.push(json!(id(evidence_id)));
    let children = vec![client.command("evidence", "create", evidence_id, e, None, vec![revision_guard("asset", &original_id, 1), revision_guard("asset", &derivative_id, 1)]), client.command("geometry", "create", geometry_id, json!({"producer":"magicplan","producerVersion":null,"exportFormat":"usdz","originalAssetId":original_id,"coordinateUnits":"unknown","scale":null,"transform":null,"mappings":[],"geometryVersion":version,"previousGeometryId":previous.map(id),"evidenceIds":[id(evidence_id)]}), None, geometry_guards), client.command("identity", "replace", 101, json!({"kind":"location","evidenceIds":evidence_ids}), Some(building["revision"].as_u64().unwrap() as u32), evidence_guards)];
    client.serial += 3;
    let root = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(client.serial),"context":client.scope,"target":{"authority":"atlas","kind":"batch","batchId":id(client.serial+1)},"payload":{"commands":children},"idempotencyKey":id(client.serial+2),"reason":"Synthetic explicit partial floor update","approvalReceiptId":null,"preconditions":{"target":null,"guards":root_guards}});
    let result = client
        .call_at(
            root,
            Some(format!("{base}/buildings/{}/associations", id(101))),
        )
        .await?;
    assert_eq!(result["data"]["records"].as_array().unwrap().len(), 3);
    assert_eq!(
        result["data"]["records"][1]["payload"]["geometryVersion"],
        version
    );
    Ok((original_id, derivative_id, original, derivative))
}

#[tokio::main]
async fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::time::timeout(std::time::Duration::from_secs(180), healthy()).await??;
    Ok(())
}
async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-scan-succession-")
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
    let mut place_commands = place_commands;
    place_commands.push(client.command(
        "identity",
        "create",
        104,
        json!({"kind":"location","evidenceIds":[id(100)]}),
        None,
        vec![],
    ));
    place_commands.push(client.command("location-semantics", "create", 203, json!({"atlasId":id(104),"semanticKind":"floor","label":"Synthetic elevation floor","reviewStatus":"accepted","elevation":{"status":"known","metres":0,"datumAtlasId":id(101)},"evidenceIds":[id(100)]}), None, vec![]));
    place_commands.push(client.command("relation", "create", 302, json!({"kind":"location-membership","membershipKind":"building","from":endpoint(101),"to":endpoint(104),"reviewStatus":"accepted","uncertainty":{"status":"supported","explanation":null},"evidenceIds":[id(100)]}), None, vec![]));
    place_commands.push(client.command(
        "identity",
        "create",
        103,
        json!({"kind":"item","evidenceIds":[id(100)]}),
        None,
        vec![],
    ));
    place_commands.push(client.command(
        "circuit",
        "create",
        401,
        json!({"label":"Synthetic documentary circuit","panel":null,"evidenceIds":[id(100)]}),
        None,
        vec![],
    ));
    let place = client.batch(place_commands, vec![]).await?;
    assert_eq!(
        place["data"]["records"]
            .as_array()
            .ok_or("Missing places")?
            .len(),
        11
    );

    let geometry_base = format!(
        "/api/atlas/geometry/v1/workspaces/{}/homes/{}",
        id(2),
        id(3)
    );
    let mut saved = Vec::new();
    for (e, g, variant) in [(600, 601, "floor A v1"), (610, 611, "floor B v1")] {
        saved.push(append_geometry(&mut client, e, g, None, variant).await?);
    }
    let geometry_asset = saved[0].0.clone();
    let stable_place =
        client.read("identity", "get", 102, json!({})).await?["data"]["records"][0].clone();
    let stable_elevation = client
        .read("location-semantics", "get", 203, json!({}))
        .await?["data"]["records"][0]
        .clone();
    let stable_device =
        client.read("identity", "get", 103, json!({})).await?["data"]["records"][0].clone();
    let stable_circuit =
        client.read("circuit", "get", 401, json!({})).await?["data"]["records"][0].clone();
    let (_, descriptor_bytes) =
        get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
    let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
    assert_eq!(
        descriptor["floors"]
            .as_array()
            .ok_or("Missing floors")?
            .len(),
        2
    );
    let before_keys: Vec<Value> = descriptor["floors"]
        .as_array()
        .ok_or("Missing floors")?
        .iter()
        .map(|item| item["floor"]["key"].clone())
        .collect();
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
        if version == 2 {
            let (_, before_bytes) =
                get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
            let before_update: Value = serde_json::from_slice(&before_bytes)?;
            let before_update_keys: Vec<Value> = before_update["floors"]
                .as_array()
                .ok_or("Missing current heads")?
                .iter()
                .map(|item| item["floor"]["key"].clone())
                .collect();
            saved.push(append_geometry(&mut client, 620, 621, Some(601), "floor A v2").await?);
            let (_, bytes) =
                get(&client, &format!("{geometry_base}/buildings/{}", id(101))).await?;
            let after: Value = serde_json::from_slice(&bytes)?;
            let rows = after["floors"]
                .as_array()
                .ok_or("Missing successor heads")?;
            assert_eq!(rows.len(), 2);
            assert!(
                rows.iter()
                    .all(|item| item["floor"]["geometryId"] != id(601))
            );
            assert!(
                rows.iter()
                    .any(|item| item["floor"]["geometryId"] == id(621))
            );
            assert!(
                rows.iter()
                    .any(|item| item["floor"]["geometryId"] == id(611))
            );
            assert!(
                rows.iter()
                    .all(|item| !before_update_keys.contains(&item["floor"]["key"]))
            );
            // Original custody and immutable old native geometry remain readable.
            for g in [601, 611, 621] {
                let row = client.read("geometry", "get", g, json!({})).await?["data"]["records"][0]
                    .clone();
                assert_eq!(row["revision"], 1);
                assert_eq!(
                    row["payload"]["geometryVersion"],
                    if g == 621 { 2 } else { 1 }
                );
                assert_eq!(
                    row["payload"]["previousGeometryId"],
                    if g == 621 {
                        json!(id(601))
                    } else {
                        Value::Null
                    }
                );
                let history = client
                    .read(
                        "geometry",
                        "history",
                        g,
                        json!({"cursor":null,"pageSize":100,"includeArchived":false}),
                    )
                    .await?;
                assert_eq!(
                    history["data"]["entries"]
                        .as_array()
                        .ok_or("Missing geometry history")?
                        .len(),
                    1
                );
            }
        }
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
        let building =
            client.read("identity", "get", 101, json!({})).await?["data"]["records"][0].clone();
        let mut building_evidence = building["payload"]["evidenceIds"]
            .as_array()
            .ok_or("Missing accepted evidence")?
            .clone();
        let previous_evidence = building_evidence.clone();
        building_evidence.push(json!(id(evidence_id)));
        let i = client.command(
            "identity",
            "replace",
            101,
            json!({"kind":"location","evidenceIds":building_evidence}),
            Some(
                building["revision"]
                    .as_u64()
                    .ok_or("Missing building revision")? as u32,
            ),
            previous_evidence
                .iter()
                .map(|value| revision_guard("evidence", value.as_str().unwrap(), 1))
                .collect(),
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
        assert_eq!(fresh_floors.len(), 2);
        assert!(
            fresh_floors
                .iter()
                .all(|item| !before_keys.contains(&item["floor"]["key"]))
        );
        let number = if version == 1 { 601 } else { 621 };
        let floor = &fresh_floors
            .iter()
            .find(|item| item["floor"]["geometryId"] == id(number))
            .ok_or("Missing updated floor")?["floor"];
        let untouched = &fresh_floors
            .iter()
            .find(|item| item["floor"]["geometryId"] == id(611))
            .ok_or("Missing untouched floor")?["floor"];
        assert_eq!(floor["geometryId"], id(number));
        assert_eq!(floor["geometryRevision"], 1);
        assert_eq!(
            floor["originalAssetId"],
            if version == 1 {
                geometry_asset.as_str()
            } else {
                saved[2].0.as_str()
            }
        );
        for item in fresh_floors {
            let (_, mesh_bytes) = get(
                &client,
                item["readPath"].as_str().ok_or("Missing mesh read path")?,
            )
            .await?;
            assert_eq!(sha(&mesh_bytes), item["floor"]["derivativeSha256"]);
        }
        let previous = if version == 1 { None } else { Some(id(900)) };
        let payload = scene_payload(ScenePayload {
            version,
            previous: previous.as_deref(),
            historical_asset: &historical_asset,
            primary_asset: &primary_asset,
            historical_sha: &historical_sha,
            primary_sha: &source_sha,
            canonical: &canonical,
            receipt: &review,
            floor,
            untouched,
            evidence_id,
        });
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
                    revision_guard("geometry", &id(number), 1),
                    revision_guard("geometry", &id(611), 1),
                    revision_guard("asset", floor["originalAssetId"].as_str().unwrap(), 1),
                    revision_guard("asset", untouched["originalAssetId"].as_str().unwrap(), 1),
                    revision_guard(
                        "identity",
                        &id(101),
                        building["revision"].as_u64().unwrap() + 1,
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
    assert_eq!(
        client.read("identity", "get", 102, json!({})).await?["data"]["records"][0],
        stable_place
    );
    assert_eq!(
        client
            .read("location-semantics", "get", 203, json!({}))
            .await?["data"]["records"][0],
        stable_elevation
    );
    assert_eq!(
        client.read("identity", "get", 103, json!({})).await?["data"]["records"][0],
        stable_device
    );
    assert_eq!(
        client.read("circuit", "get", 401, json!({})).await?["data"]["records"][0],
        stable_circuit
    );
    for (original, derivative, original_bytes, derivative_bytes) in &saved {
        for (asset, expected) in [(original, original_bytes), (derivative, derivative_bytes)] {
            let descriptor = serde_json::to_vec(&json!({"assetId":asset,"kind":"atlas-asset"}))?;
            let path = format!(
                "/api/atlas/media/{}/{}/{}/download",
                id(2),
                id(3),
                sha(&descriptor)
            );
            let (_, bytes) = get(&client, &path).await?;
            assert_eq!(&bytes, expected);
        }
    }
    drop(client);
    drop(lease);
    scratch.close()?;
    println!(
        "PASS native scan succession: two floors, partial v2, exact heads and fresh two-floor scene bindings, retained custody/history, stable room/elevation/device/circuit identities, authenticated strict reopen and owned cleanup; synthetic only"
    );
    Ok(())
}
