//! Generated native scan custody/association for the home read-pack positive.
//! Reuses the inspected closed framing fixture; no converter or provider runs.
use super::*;
type OutcomeError = Box<dyn std::error::Error + Send + Sync>;
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
fn mesh_fixture(original: &[u8]) -> Result<Vec<u8>, OutcomeError> {
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

async fn post(
    app: &axum::Router,
    cookie: &str,
    csrf: &str,
    path: &str,
    bytes: Vec<u8>,
    mime: &str,
) -> Outcome<Value> {
    let mut req = request("POST", path, "");
    *req.body_mut() = Body::from(bytes);
    req.headers_mut().insert("cookie", cookie.parse()?);
    req.headers_mut().insert("x-atlas-csrf", csrf.parse()?);
    req.headers_mut().insert("content-type", mime.parse()?);
    let response = app.clone().oneshot(req).await?;
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024 * 1024).await?;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    Ok(serde_json::from_slice(&body)?)
}
async fn custody(
    app: &axum::Router,
    cookie: &str,
    csrf: &str,
    path: &str,
    n: u32,
    source: (&str, &str, &[u8]),
) -> Outcome<String> {
    let (filename, mime, bytes) = source;
    let boundary = "SyntheticReadPackGeometry";
    let metadata = json!({"schemaVersion":1,"requestId":id(n),"idempotencyKey":id(n+1),"context":{"workspaceId":id(2),"homeId":id(3)},
        "filename":filename,"contentType":mime,"reason":"Generated read-pack scan custody","sourceLicense":{"status":"unknown","reference":null}});
    let mut body=format!("--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n",metadata).into_bytes();
    body.extend(bytes);
    body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
    let saved = post(
        app,
        cookie,
        csrf,
        path,
        body,
        &format!("multipart/form-data; boundary={boundary}"),
    )
    .await?;
    assert_eq!(saved["association"], "not-associated");
    assert_eq!(saved["result"]["status"], "committed");
    assert_eq!(saved["result"]["replayed"], false);
    assert_eq!(
        saved["result"]["data"]["records"][0]["payload"]["sha256"],
        sha(bytes)
    );
    Ok(saved["originalRequest"]["target"]["recordId"]
        .as_str()
        .unwrap()
        .to_owned())
}
fn guard(kind: &str, key: &str) -> Value {
    json!({"target":{"authority":"atlas","recordType":kind,"recordId":key},"revision":{"kind":"atlas","value":1}})
}
fn command(
    kind: &str,
    verb: &str,
    n: u32,
    request_id: u32,
    payload: Value,
    revision: Option<u32>,
    guards: Vec<Value>,
) -> Value {
    json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(request_id),"context":{"workspaceId":id(2),"homeId":id(3)},
        "target":{"authority":"atlas","recordType":kind,"recordId":id(n)},"payload":payload,"idempotencyKey":id(request_id+1),
        "reason":"Generated read-pack scan association","approvalReceiptId":null,"preconditions":{"target":revision.map(|v|json!({"kind":"atlas","value":v})),"guards":guards}})
}
pub async fn seed(app: &axum::Router, cookie: &str, csrf: &str) -> Outcome<()> {
    use houseatlas_backend::media::mesh_derivative as mesh;
    let base = format!(
        "/api/atlas/geometry/v1/workspaces/{}/homes/{}",
        id(2),
        id(3)
    );
    let original = synthetic_usdz();
    let derivative = mesh_fixture(&original)?;
    let original_id = custody(
        app,
        cookie,
        csrf,
        &format!("{base}/originals"),
        5600,
        ("SYNTHETIC.usdz", "model/vnd.usdz+zip", &original),
    )
    .await?;
    let derivative_id = custody(
        app,
        cookie,
        csrf,
        &format!("{base}/originals/{original_id}/derivative"),
        5602,
        ("synthetic-mesh.json", mesh::MIME, &derivative),
    )
    .await?;
    let e = command(
        "evidence",
        "create",
        600,
        6000,
        json!({"statement":"Generated scan association; scale/alignment unknown",
        "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"owner-report","factAt":null,"retrievedAt":"2026-10-16T00:00:00Z","vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
        "supersedesEvidenceIds":[],"references":[{"kind":"atlas-asset","assetId":original_id},{"kind":"atlas-asset","assetId":derivative_id}]}),
        None,
        vec![guard("asset", &original_id), guard("asset", &derivative_id)],
    );
    let g = command(
        "geometry",
        "create",
        601,
        6002,
        json!({"producer":"magicplan","producerVersion":null,"exportFormat":"usdz","originalAssetId":original_id,
        "coordinateUnits":"unknown","scale":null,"transform":null,"mappings":[],"geometryVersion":1,"previousGeometryId":null,"evidenceIds":[id(600)]}),
        None,
        vec![guard("asset", &original_id)],
    );
    let i = command(
        "identity",
        "replace",
        101,
        6004,
        json!({"kind":"location","evidenceIds":[id(100),id(600)]}),
        Some(1),
        vec![guard("evidence", &id(100))],
    );
    let batch = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(6010),"context":{"workspaceId":id(2),"homeId":id(3)},
        "target":{"authority":"atlas","kind":"batch","batchId":id(6011)},"payload":{"commands":[e,g,i]},"idempotencyKey":id(6012),
        "reason":"Generated reviewed read-pack scan","approvalReceiptId":null,"preconditions":{"target":null,"guards":[guard("identity",&id(101)),guard("location-semantics",&id(201)),guard("evidence",&id(100)),guard("asset",&original_id),guard("asset",&derivative_id)]}});
    let result = post(
        app,
        cookie,
        csrf,
        &format!("{base}/buildings/{}/associations", id(101)),
        serde_json::to_vec(&batch)?,
        "application/json",
    )
    .await?;
    assert_eq!(result["status"], "committed");
    assert_eq!(result["replayed"], false);
    Ok(())
}
const SYNTHETIC_MESH: &str = r####"{"profile":"houseatlas.magicplan-authored-mesh.v1","source":{"fileName":"SYNTHETIC.usdz","floorLabel":"Synthetic export label","originalSHA256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","originalBytes":1,"primaryLayerName":"synthetic.usdc","primaryLayerSHA256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","primaryLayerBytes":1,"serializedUSDASHA256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","serializedUSDABytes":1},"converter":{"codeSHA256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","schemaSHA256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","profileSHA256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","usdcatExecutableSHA256":"0000000000000000000000000000000000000000000000000000000000000000","usdcatVersion":"synthetic example; no actual conversion claim","invocation":"usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network"},"authoredCoordinates":{"upAxis":"Y","metersPerUnitToken":"1","defaultPrim":"Synthetic","matrixConvention":"row-major storage; row vector p_local * M_mesh * M_parent * ...","numericTokenProvenance":"exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes"},"qualification":{"physicalScale":"unknown","floorAlignment":"unknown","stageToHouseTransform":null,"semanticRoomObjects":0},"nodes":[{"path":"/Synthetic","primType":"Xform","parentPath":null,"authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]}],"localMatrixTokens":["1","0","0","0","0","1","0","0","0","0","1","0","5","0","0","1"]},{"path":"/Synthetic/Triangle","primType":"Mesh","parentPath":"/Synthetic","authoredOpOrder":["xformOp:transform"],"rawOpOrderLiteral":"[\"xformOp:transform\"]","resetXformStack":false,"operations":[{"name":"xformOp:transform","type":"matrix4d","matrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"localMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","0","0","0","1"]}],"meshes":[{"sourceObjectId":"/Synthetic/Triangle","sourceName":"Triangle","positionsLocalTokens":["-0","0","0","1","0","0","0","1","0"],"triangleIndicesTokens":["0","1","2"],"faceVertexCounts":{"repeatedToken":"3","count":1},"ancestorChain":["/Synthetic/Triangle","/Synthetic"],"appliedChain":["/Synthetic/Triangle","/Synthetic"],"composedLocalToStageMatrixTokens":["2","0","0","0","0","2","0","0","0","0","2","0","5","0","0","1"],"authoredOrientation":null,"resolvedOrientation":"rightHanded","orientationQualification":"USD schema default; not physically verified","authoredDoubleSided":null,"vertexCount":3,"triangleCount":1,"authoredDoubleSidedToken":null}],"counts":{"meshes":1,"vertices":3,"triangles":1,"nodes":2}}
"####;
