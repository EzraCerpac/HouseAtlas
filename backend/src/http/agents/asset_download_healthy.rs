//! Real mounted MCP issuance and same-Host authenticated original redemption.
//! One generated text upload, no socket/TLS/browser/provider or expiry control.

use crate::{
    contracts::stock as wire,
    http::{Host, router},
    lifecycle::{self, Failure},
    transports::mcp,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Method, Request, StatusCode},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, net::SocketAddr, os::unix::fs::PermissionsExt, sync::Arc};
use tower::ServiceExt;

const ORIGIN: &str = "https://127.0.0.1:48743";
const ORIGINAL: &str = "Synthetic mounted MCP original α.\n";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn request(
    method: Method,
    path: &str,
    bytes: Vec<u8>,
    content_type: Option<&str>,
    cookie: Option<&str>,
    csrf: Option<&str>,
    session: Option<&str>,
) -> Result<Request<Body>, Failure> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-length", bytes.len());
    if path.starts_with("/api/atlas/mcp/") {
        builder = builder.header("accept", "application/json, text/event-stream");
    }
    if let Some(content_type) = content_type {
        builder = builder.header("content-type", content_type);
    }
    if let Some(cookie) = cookie {
        builder = builder.header("cookie", cookie);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-atlas-csrf", csrf);
    }
    if let Some(session) = session {
        builder = builder
            .header("mcp-session-id", session)
            .header("mcp-protocol-version", mcp::PROTOCOL_VERSION);
    }
    let mut request = builder.body(Body::from(bytes))?;
    // Observed synthetic in-process peer metadata, never a real listener.
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:50123".parse::<SocketAddr>()?));
    Ok(request)
}

struct Client<'a> {
    app: &'a Router,
    endpoint: String,
    cookie: String,
    csrf: String,
    session: Option<String>,
}

impl Client<'_> {
    async fn frame(&mut self, message: Value) -> Result<Option<Value>, Failure> {
        let response = self
            .app
            .clone()
            .oneshot(request(
                Method::POST,
                &self.endpoint,
                serde_json::to_vec(&message)?,
                Some("application/json"),
                Some(&self.cookie),
                Some(&self.csrf),
                self.session.as_deref(),
            )?)
            .await?;
        if message.get("id").is_none() {
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            assert!(
                to_bytes(response.into_body(), MAX_RESPONSE)
                    .await?
                    .is_empty()
            );
            return Ok(None);
        }
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], "application/json");
        if message["method"] == "initialize" {
            self.session = Some(
                response
                    .headers()
                    .get("mcp-session-id")
                    .ok_or("Missing actual MCP session")?
                    .to_str()?
                    .to_owned(),
            );
        }
        let reply: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), MAX_RESPONSE).await?)?;
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], message["id"]);
        assert!(reply.get("error").is_none());
        Ok(Some(reply))
    }

    async fn call(
        &mut self,
        raw: Value,
        validation: &wire::StockValidation,
    ) -> Result<Value, Failure> {
        let parsed = wire::StockRequest::parse(validation, raw.clone())?;
        let family = wire::operation(parsed.id())?.tool_family.as_str();
        let reply = self
            .frame(json!({"jsonrpc":"2.0","id":raw["requestId"],
            "method":"tools/call","params":{"name":family,"arguments":raw}}))
            .await?
            .ok_or("Missing actual MCP result")?;
        let result = &reply["result"];
        assert_eq!(result["isError"], false);
        let structured = result
            .get("structuredContent")
            .ok_or("Missing structured result")?;
        let content = result["content"].as_array().ok_or("Missing text result")?;
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(
            serde_json::from_str::<Value>(
                content[0]["text"]
                    .as_str()
                    .ok_or("Missing actual result text")?
            )?,
            *structured
        );
        assert_eq!(structured["schemaVersion"], 3);
        assert_eq!(structured["commandId"], parsed.raw()["commandId"]);
        assert_eq!(structured["requestId"], parsed.raw()["requestId"]);
        assert_eq!(structured["resolvedScope"], parsed.raw()["context"]);
        assert_eq!(structured["status"], "read");
        assert_eq!(structured["replayed"], false);
        wire::StockResponse::parse(validation, &parsed, structured.clone(), &[])?;
        Ok(structured.clone())
    }
}

#[test]
fn healthy_mounted_mcp_asset_download_redeems_original() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-mcp288-owned-download-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    assert_eq!(
        fs::metadata(&directory)?.permissions().mode() & 0o777,
        0o700
    );
    let context =
        json!({"workspaceId":core.home.scope.workspace_id,"homeId":core.home.scope.home_id});
    let prefix = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let endpoint = format!(
        "/api/atlas/mcp/workspaces/{}/homes/{}",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login = receipt
        .get("editorLogin")
        .ok_or("Missing disposable login")?
        .clone();
    drop(receipt);
    // Keep the default ReadOnly MCP profile. The same Host allocates both the
    // genuine mounted issuer and the authenticated native redemption manager.
    let app = router(Host::new(
        core,
        ORIGIN.into(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?);
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            "/api/atlas/auth/login",
            serde_json::to_vec(&login)?,
            Some("application/json"),
            None,
            None,
            None,
        )?)
        .await?;
    drop(login);
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .ok_or("Missing actual cookie")?
        .to_str()?
        .split(';')
        .next()
        .ok_or("Missing cookie pair")?
        .to_owned();
    let info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    assert_eq!(info["schemaVersion"], 1);
    let csrf = info["csrfToken"]
        .as_str()
        .ok_or("Missing current CSRF")?
        .to_owned();
    drop(info);
    let validation = wire::StockValidation::new()?;
    let license = json!({"status":"unknown","reference":null});
    let metadata = json!({"schemaVersion":1,"requestId":id(25001),"idempotencyKey":id(25002),
        "context":context,"reason":"One generated owned original for mounted MCP redemption",
        "filename":"mcp-owned.txt","contentType":"text/plain","sourceLicense":license});
    let boundary = "houseatlas-mcp-owned-text";
    let multipart = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"mcp-owned.txt\"\r\nContent-Type: text/plain\r\n\r\n{ORIGINAL}\r\n--{boundary}--\r\n",
        serde_json::to_string(&metadata)?
    );
    let content_type = format!("multipart/form-data; boundary={boundary}");
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            &format!("{prefix}/assets"),
            multipart.into_bytes(),
            Some(&content_type),
            Some(&cookie),
            Some(&csrf),
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let uploaded: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), MAX_RESPONSE).await?)?;
    assert_eq!(uploaded["schemaVersion"], 3);
    assert_eq!(uploaded["commandId"], "atlas.asset.create");
    assert_eq!(uploaded["requestId"], metadata["requestId"]);
    assert_eq!(uploaded["resolvedScope"], context);
    assert_eq!(uploaded["status"], "committed");
    assert_eq!(uploaded["replayed"], false);
    assert_eq!(uploaded["data"]["auditIds"].as_array().unwrap().len(), 1);
    let records = uploaded["data"]["records"]
        .as_array()
        .ok_or("Missing committed asset")?;
    assert_eq!(records.len(), 1);
    let asset = records[0].clone();
    let target = asset["target"].clone();
    assert_eq!(target["authority"], "atlas");
    assert_eq!(target["recordType"], "asset");
    assert!(
        !target["recordId"]
            .as_str()
            .ok_or("Missing owner-chosen identity")?
            .is_empty()
    );
    let digest = format!("{:x}", Sha256::digest(ORIGINAL.as_bytes()));
    assert_eq!(
        asset,
        json!({"target":target,"revision":1,"lifecycle":"active","payload":{
        "owner":"atlas","purpose":"evidence-original","sha256":digest,"byteSize":ORIGINAL.len(),
        "contentType":"text/plain","sourceLicense":license,"availability":"available",
        "previewPolicy":"download-only","evidenceIds":[]}})
    );
    // Observe the real owner's saved request; never reconstruct a stage token,
    // fabricate a receipt or deserialize data into upload authority.
    let original_request: Value = {
        let database = rusqlite::Connection::open_with_flags(
            directory.join("atlas.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let saved: String = database.query_row(
            "SELECT original_json FROM stock_operations WHERE operation_id=?1",
            [uploaded["operationId"]
                .as_str()
                .ok_or("Missing actual operation")?],
            |row| row.get(0),
        )?;
        serde_json::from_str(&saved)?
    };
    let parsed_upload = wire::StockRequest::parse(&validation, original_request)?;
    wire::StockResponse::parse(&validation, &parsed_upload, uploaded.clone(), &[])?;
    assert_eq!(
        uploaded["data"]["requestDigest"],
        parsed_upload.intent_digest()
    );
    assert_eq!(parsed_upload.raw()["target"], target);
    let mut client = Client {
        app: &app,
        endpoint,
        cookie,
        csrf,
        session: None,
    };
    let initialized = client
        .frame(
            json!({"jsonrpc":"2.0","id":"initialize","method":"initialize",
        "params":{"protocolVersion":mcp::PROTOCOL_VERSION,"capabilities":{},
            "clientInfo":{"name":"Synthetic owned download","version":"0.1.0"}}}),
        )
        .await?
        .ok_or("Missing mounted initialization")?;
    assert_eq!(
        initialized["result"]["protocolVersion"],
        mcp::PROTOCOL_VERSION
    );
    client
        .frame(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .await?;
    let read = |serial| {
        json!({"schemaVersion":3,"commandId":"atlas.asset.get","requestId":id(serial),
        "context":context,"target":target,"payload":{}})
    };
    let before = client.call(read(25003), &validation).await?;
    assert_eq!(before["data"]["records"], json!([asset.clone()]));
    let download = json!({"schemaVersion":3,"commandId":"atlas.asset.download","requestId":id(25004),
        "context":context,"target":target,"payload":{}});
    let listed = client
        .frame(json!({"jsonrpc":"2.0","id":"download-tools","method":"tools/list","params":{}}))
        .await?
        .ok_or("Missing actual tool discovery")?;
    let family = wire::operation(wire::OperationId::AtlasAssetDownload)?
        .tool_family
        .as_str();
    let tool = listed["result"]["tools"]
        .as_array()
        .ok_or("Missing actual tools")?
        .iter()
        .find(|tool| tool["name"] == family)
        .ok_or("Missing admitted download family")?;
    let advertised = jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .offline()
        .build(&tool["inputSchema"])
        .map_err(|_| "Invalid actual input schema")?;
    assert!(advertised.is_valid(&download));
    let issued = client.call(download, &validation).await?;
    let token = issued["data"]["downloadToken"]
        .as_str()
        .ok_or("Missing actual opaque handle")?;
    assert!(!token.is_empty());
    assert_eq!(
        issued["data"],
        json!({"target":target,"downloadToken":token,"sha256":digest,
        "byteSize":ORIGINAL.len(),"contentType":"text/plain","disposition":"attachment"})
    );
    let path = format!(
        "/api/atlas/media/downloads/{}/{}/{token}",
        context["workspaceId"].as_str().unwrap(),
        context["homeId"].as_str().unwrap()
    );
    let response = app
        .clone()
        .oneshot(request(
            Method::GET,
            &path,
            vec![],
            None,
            Some(&client.cookie),
            None,
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    for (name, expected) in [
        ("content-type", "text/plain"),
        (
            "content-disposition",
            "attachment; filename=\"original.txt\"",
        ),
        ("cache-control", "private, no-store"),
        ("x-content-type-options", "nosniff"),
        ("content-security-policy", "default-src 'none'; sandbox"),
    ] {
        assert_eq!(response.headers()[name], expected);
    }
    assert_eq!(
        response.headers()["content-length"]
            .to_str()?
            .parse::<usize>()?,
        ORIGINAL.len()
    );
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?;
    assert_eq!(bytes.as_ref(), ORIGINAL.as_bytes());
    assert_eq!(format!("{:x}", Sha256::digest(&bytes)), digest);
    let after = client.call(read(25005), &validation).await?;
    assert_eq!(after["data"]["records"], before["data"]["records"]);
    drop(client);
    drop(app);
    scratch.close()?;
    Ok(())
}

// One positive native lifetime. Setup is a real HTTP stock batch, followed by
// five contextual uploads through this same Host; no plain asset-create substitute.
#[test]
fn healthy_contextual_five_format_native_post_receipt_original_readback() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(contextual_five_originals())
}

async fn capture_json(
    app: &Router,
    method: Method,
    path: &str,
    bytes: Vec<u8>,
    content_type: Option<&str>,
    cookie: &str,
    csrf: Option<&str>,
) -> Result<Value, Failure> {
    let response = app
        .clone()
        .oneshot(request(
            method,
            path,
            bytes,
            content_type,
            Some(cookie),
            csrf,
            None,
        )?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json");
    Ok(serde_json::from_slice(
        &to_bytes(response.into_body(), MAX_RESPONSE).await?,
    )?)
}

fn capture_journal(
    directory: &std::path::Path,
    result: &Value,
    validation: &wire::StockValidation,
) -> Result<u64, Failure> {
    let database = rusqlite::Connection::open_with_flags(
        directory.join("atlas.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let (original, committed): (String, String) = database.query_row(
        "SELECT original_json,commit_json FROM stock_operations WHERE operation_id=?1",
        [result["operationId"].as_str().ok_or("Missing actual operation")?],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let original: Value = serde_json::from_str(&original)?;
    let committed: Value = serde_json::from_str(&committed)?;
    assert_eq!(committed["originalRequest"], original);
    assert_eq!(committed["wire"], *result);
    let parsed = wire::StockRequest::parse(validation, original)?;
    let children = committed["children"]
        .as_array()
        .ok_or("Missing actual durable child envelopes")?;
    wire::StockResponse::parse(validation, &parsed, result.clone(), children)?;
    assert_eq!(result["data"]["requestDigest"], parsed.intent_digest());
    Ok(database.query_row("SELECT count(*) FROM stock_operations", [], |row| row.get(0))?)
}

async fn contextual_five_originals() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-contextual296-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    assert_eq!(
        fs::metadata(&directory)?.permissions().mode() & 0o777,
        0o700
    );
    let context =
        json!({"workspaceId":core.home.scope.workspace_id,"homeId":core.home.scope.home_id});
    let scope_path = format!(
        "workspaces/{}/homes/{}",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let prefix = format!("/api/atlas/stock/v3/{scope_path}");
    let place = id(26003);
    let identity = id(26002);
    let seed_evidence = id(26001);
    let place_path = format!("/api/atlas/editing/v1/{scope_path}/native-places/{place}");
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login = receipt["editorLogin"].clone();
    drop(receipt);
    let app = router(Host::new(
        core,
        ORIGIN.into(),
        Arc::new(BTreeMap::new()),
        vec![],
    )?);
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            "/api/atlas/auth/login",
            serde_json::to_vec(&login)?,
            Some("application/json"),
            None,
            None,
            None,
        )?)
        .await?;
    drop(login);
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()?
        .split(';')
        .next()
        .ok_or("Missing cookie pair")?
        .to_owned();
    let session: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    let csrf = session["csrfToken"].as_str().ok_or("Missing current CSRF")?;
    let validation = wire::StockValidation::new()?;
    let license = json!({"status":"unknown","reference":null});
    let reason = "Synthetic contextual original round trip";
    let create = |kind: &str, record_id: &str, payload: Value, serial| {
        json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.create"),
            "requestId":id(serial),"idempotencyKey":id(serial+100),"context":context,
            "target":{"authority":"atlas","recordType":kind,"recordId":record_id},
            "payload":payload,"reason":reason,"approvalReceiptId":null,
            "preconditions":{"target":null,"guards":[]}})
    };
    let setup = json!({"schemaVersion":3,"commandId":"atlas.batch.execute",
        "requestId":id(26100),"idempotencyKey":id(26200),"context":context,
        "target":{"authority":"atlas","kind":"batch","batchId":id(26300)},
        "payload":{"commands":[
            create("evidence", &seed_evidence, json!({"statement":"Synthetic native capture target",
                "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
                    "evidenceBasis":"unknown","factAt":null,"retrievedAt":"2026-01-01T00:00:00Z",
                    "vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
                "supersedesEvidenceIds":[],"references":[]}), 26101),
            create("identity", &identity, json!({"kind":"location","evidenceIds":[seed_evidence]}), 26102),
            create("location-semantics", &place, json!({"atlasId":identity,"semanticKind":"other",
                "reviewStatus":"accepted","evidenceIds":[seed_evidence],"label":"Synthetic capture target"}), 26103)
        ]},"reason":reason,"approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}});
    let setup_result = capture_json(
        &app,
        Method::POST,
        &format!("{prefix}/commands"),
        serde_json::to_vec(&setup)?,
        Some("application/json"),
        &cookie,
        Some(csrf),
    )
    .await?;
    assert_eq!(setup_result["status"], "committed");
    assert_eq!(setup_result["requestId"], setup["requestId"]);
    let baseline_operations = capture_journal(&directory, &setup_result, &validation)?;
    let mut evidence_ids = vec![json!(seed_evidence)];
    let mut asset_ids = std::collections::BTreeSet::new();
    let mut upload_posts = 0_u64;
    let originals: [(&str, &str, &str, &[u8]); 5] = [
        ("synthetic-photo.jpg", "image/jpeg", "camera-request",
            include_bytes!("../../../../frontend/capture-evidence-tests/fixtures/synthetic-photo.jpg")),
        ("synthetic-photo-progressive.jpg", "image/jpeg", "photo-picker",
            include_bytes!("../../../../frontend/capture-evidence-tests/fixtures/synthetic-photo-progressive.jpg")),
        ("synthetic-image.png", "image/png", "photo-picker",
            include_bytes!("../../../../frontend/capture-evidence-tests/fixtures/synthetic-image.png")),
        ("synthetic-document.pdf", "application/pdf", "file-picker",
            include_bytes!("../../../../frontend/capture-evidence-tests/fixtures/synthetic-document.pdf")),
        ("synthetic-note.txt", "text/plain", "file-picker",
            include_bytes!("../../../../frontend/capture-evidence-tests/fixtures/synthetic-note.txt")),
    ];
    for (index, (filename, content_type, method, original)) in originals.into_iter().enumerate() {
        let admission = capture_json(
            &app,
            Method::GET,
            &place_path,
            vec![],
            None,
            &cookie,
            None,
        )
        .await?;
        assert_eq!(admission["admissionKind"], "native-location");
        assert_eq!(admission["scope"], context);
        assert_eq!(admission["record"]["recordId"], place);
        assert_eq!(admission["identity"]["recordId"], identity);
        assert_eq!(admission["identity"]["revision"], index + 1);
        assert_eq!(admission["identity"]["payload"]["evidenceIds"], json!(evidence_ids));
        assert_eq!(admission["canAttachEvidence"], true);
        assert_eq!(admission["attachmentPolicy"]["maximumBytes"], 10 * 1024 * 1024);
        assert!(original.len() <= 10 * 1024 * 1024);
        let capture = json!({"schemaVersion":1,"selectionMethod":method,
            "selectedAt":"2026-01-01T00:00:00Z","filename":filename,
            "reportedContentType":content_type,"byteOrigin":"browser-returned-unmodified"});
        let metadata = json!({"schemaVersion":2,"requestId":id(26400+index as u32),
            "idempotencyKey":id(26500+index as u32),"context":context,"recordId":place,
            "expectedRevision":admission["record"]["revision"],"guards":admission["guards"],
            "statement":format!("Generated {filename} contextual evidence"),"sourceLicense":license,
            "reason":reason,"filename":filename,"contentType":content_type,"capture":capture});
        let boundary = "houseatlas-contextual-five-originals";
        let mut body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n",
            serde_json::to_string(&metadata)?
        ).into_bytes();
        body.extend_from_slice(original);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut upload = request(
            Method::POST,
            &format!("{place_path}/evidence"),
            body,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Some(&cookie),
            Some(csrf),
            None,
        )?;
        upload.headers_mut().insert(
            "x-atlas-upload-request-id",
            metadata["requestId"].as_str().ok_or("Missing fixture request ID")?.parse()?,
        );
        let started = time::OffsetDateTime::now_utc();
        upload_posts += 1;
        let response = app.clone().oneshot(upload).await?;
        let finished = time::OffsetDateTime::now_utc();
        assert_eq!(response.status(), StatusCode::OK);
        let result: Value = serde_json::from_slice(&to_bytes(response.into_body(), MAX_RESPONSE).await?)?;
        assert_eq!(result["commandId"], "atlas.batch.execute");
        assert_eq!(result["requestId"], metadata["requestId"]);
        assert_eq!(result["resolvedScope"], context);
        assert_eq!(result["status"], "committed");
        assert_eq!(result["replayed"], false);
        assert_eq!(result["data"]["auditIds"].as_array().unwrap().len(), 3);
        assert_eq!(
            capture_journal(&directory, &result, &validation)?,
            baseline_operations + upload_posts
        );
        let records = result["data"]["records"]
            .as_array()
            .ok_or("Missing native receipt records")?;
        assert_eq!(records.len(), 3);
        let asset = &records[0];
        let evidence = &records[1];
        let updated_identity = &records[2];
        assert_eq!(asset["target"]["recordType"], "asset");
        assert_eq!(evidence["target"]["recordType"], "evidence");
        assert_eq!(updated_identity["target"]["recordType"], "identity");
        assert_eq!(updated_identity["target"]["recordId"], identity);
        let asset_id = asset["target"]["recordId"]
            .as_str()
            .ok_or("Missing native asset ID")?;
        let evidence_id = evidence["target"]["recordId"]
            .as_str()
            .ok_or("Missing native evidence ID")?;
        assert!(asset_ids.insert(asset_id.to_owned()));
        evidence_ids.push(json!(evidence_id));
        assert_eq!(updated_identity["revision"], index + 2);
        assert_eq!(updated_identity["payload"]["evidenceIds"], json!(evidence_ids));
        assert_eq!(evidence["payload"]["statement"], metadata["statement"]);
        assert_eq!(
            evidence["payload"]["references"],
            json!([{"kind":"atlas-asset","assetId":asset_id}])
        );
        let provenance = &evidence["payload"]["provenance"];
        assert_eq!(provenance["factAt"], Value::Null);
        assert_eq!(provenance["evidenceBasis"], "unknown");
        assert_eq!(provenance["source"], Value::Null);
        assert_eq!(provenance["sourceRevision"], Value::Null);
        assert_eq!(provenance["sourceConfidence"], Value::Null);
        assert_eq!(
            provenance["uncertainty"],
            json!({"status":"unknown","explanation":null})
        );
        let claim = provenance["vantage"]
            .as_str()
            .ok_or("Missing opaque selection claim")?
            .strip_prefix("Browser selection claim v1: ")
            .ok_or("Missing claim prefix")?;
        assert_eq!(serde_json::from_str::<Value>(claim)?, capture);
        let retrieved = time::OffsetDateTime::parse(
            provenance["retrievedAt"].as_str().ok_or("Missing actual intake time")?,
            &time::format_description::well_known::Rfc3339,
        )?;
        assert!(retrieved >= started && retrieved <= finished);
        let digest = format!("{:x}", Sha256::digest(original));
        assert_eq!(asset["payload"]["sha256"], digest);
        assert_eq!(asset["payload"]["byteSize"], original.len());
        assert_eq!(asset["payload"]["contentType"], content_type);
        assert_eq!(asset["payload"]["owner"], "atlas");
        assert_eq!(asset["payload"]["purpose"], "evidence-original");
        assert_eq!(asset["payload"]["sourceLicense"], license);
        assert_eq!(asset["payload"]["availability"], "available");
        if content_type == "image/jpeg" {
            assert_eq!(asset["payload"]["previewPolicy"], "download-only");
        }
        for record in records {
            let path = format!(
                "{prefix}/records/{}/{}",
                record["target"]["recordType"].as_str().unwrap(),
                record["target"]["recordId"].as_str().unwrap()
            );
            let read =
                capture_json(&app, Method::GET, &path, vec![], None, &cookie, None).await?;
            assert_eq!(read["status"], "read");
            assert_eq!(read["resolvedScope"], context);
            assert_eq!(read["data"]["sourceStatus"], "current");
            assert_eq!(read["data"]["nextCursor"], Value::Null);
            assert_eq!(read["data"]["records"], json!([record]));
        }
        let descriptor = json!({"assetId":asset_id,"kind":"atlas-asset"});
        let descriptor_digest = crate::contracts::semantics::canonical_digest(&descriptor)?;
        let path = format!(
            "/api/atlas/media/{}/{}/{descriptor_digest}/download",
            context["workspaceId"].as_str().unwrap(),
            context["homeId"].as_str().unwrap()
        );
        for method in [Method::GET, Method::HEAD] {
            let head = method == Method::HEAD;
            let response = app
                .clone()
                .oneshot(request(
                    method,
                    &path,
                    vec![],
                    None,
                    Some(&cookie),
                    None,
                    None,
                )?)
                .await?;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["content-type"], content_type);
            assert_eq!(
                response.headers()["content-length"]
                    .to_str()?
                    .parse::<usize>()?,
                original.len()
            );
            assert!(
                response.headers()["content-disposition"]
                    .to_str()?
                    .starts_with("attachment;")
            );
            assert_eq!(response.headers()["cache-control"], "private, no-store");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(
                response.headers()["content-security-policy"],
                "default-src 'none'; sandbox"
            );
            let downloaded = to_bytes(response.into_body(), MAX_RESPONSE).await?;
            if head {
                assert!(downloaded.is_empty());
            } else {
                assert_eq!(downloaded.as_ref(), original);
                assert_eq!(format!("{:x}", Sha256::digest(&downloaded)), digest);
            }
        }
        let observed = capture_json(
            &app,
            Method::GET,
            &format!(
                "{place_path}/evidence/requests/{}",
                metadata["requestId"].as_str().unwrap()
            ),
            vec![],
            None,
            &cookie,
            None,
        )
        .await?;
        assert_eq!(observed["kind"], "native-evidence-reconciliation");
        assert_eq!(observed["requestId"], metadata["requestId"]);
        assert_eq!(observed["recordId"], place);
        assert_eq!(observed["scope"], context);
        assert_eq!(observed["outcome"], "committed");
        assert_eq!(observed["result"], result);
        assert_eq!(
            capture_journal(&directory, &result, &validation)?,
            baseline_operations + upload_posts
        );
    }
    assert_eq!(upload_posts, 5);
    assert_eq!(asset_ids.len(), 5);
    assert_eq!(evidence_ids.len(), 6);
    drop(session);
    drop(app);
    scratch.close()?;
    Ok(())
}
