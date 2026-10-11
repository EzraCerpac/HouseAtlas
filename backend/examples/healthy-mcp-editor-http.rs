//! One healthy in-process Axum HTTP Editor MCP commit and get/history readback.
//! Real native fixture/session/StockService/SQLite; no listener, provider, direct
//! principal/grant construction, replay, denial or other control is exercised.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use houseatlas_backend::{
    contracts::stock as wire,
    http::{Host, McpCommandProfile, router},
    lifecycle::{self, Failure},
    transports::mcp,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, net::SocketAddr, sync::Arc};
use tower::ServiceExt;

const ORIGIN: &str = "https://127.0.0.1:48743";
const MAX_RESPONSE: usize = 1024 * 1024;
fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}
fn request(
    path: &str,
    value: &Value,
    cookie: Option<&str>,
    csrf: Option<&str>,
    session: Option<&str>,
) -> Result<Request<Body>, Failure> {
    let bytes = serde_json::to_vec(value)?;
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "127.0.0.1:48743")
        .header("origin", ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("content-type", "application/json")
        .header("content-length", bytes.len())
        .header("accept", "application/json, text/event-stream");
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
    // Explicit synthetic in-process transport metadata, never an HTTP listener.
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
    posts: usize,
}
impl Client<'_> {
    async fn frame(&mut self, message: Value) -> Result<Option<Value>, Failure> {
        let response = self
            .app
            .clone()
            .oneshot(request(
                &self.endpoint,
                &message,
                Some(&self.cookie),
                Some(&self.csrf),
                self.session.as_deref(),
            )?)
            .await?;
        self.posts += 1;
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
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .ok_or("Missing JSON content type")?,
            "application/json"
        );
        if message["method"] == "initialize" {
            self.session = Some(
                response
                    .headers()
                    .get("mcp-session-id")
                    .ok_or("Missing native HTTP MCP session")?
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
        rpc_id: Value,
        command: &Value,
        validator: &wire::StockValidation,
    ) -> Result<Value, Failure> {
        let reply = self
            .frame(json!({"jsonrpc":"2.0", "id":rpc_id, "method":"tools/call",
            "params":{"name":"atlas_records", "arguments":command}}))
            .await?
            .ok_or("Missing tool reply")?;
        let result = &reply["result"];
        assert_eq!(result["isError"], false);
        let structured = result
            .get("structuredContent")
            .filter(|v| v.is_object())
            .ok_or("Missing native structured result")?;
        let content = result["content"].as_array().ok_or("Missing text content")?;
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(
            serde_json::from_str::<Value>(content[0]["text"].as_str().ok_or("Missing text")?)?,
            *structured
        );
        assert_eq!(structured["requestId"], command["requestId"]);
        assert_eq!(structured["commandId"], command["commandId"]);
        assert_eq!(structured["resolvedScope"], command["context"]);
        assert_eq!(structured["replayed"], false);
        let parsed = wire::StockRequest::parse(validator, command.clone())?;
        wire::StockResponse::parse(validator, &parsed, structured.clone(), &[])?;
        Ok(structured.clone())
    }
}
fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(healthy())
}
async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-mcp-editor-http-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    // Existing public healthy setup creates previously absent native databases,
    // provisions synthetic users and strictly reopens the actual fixture Store.
    // Its genuine evidence 100/revision 1 supplies the circuit's required guard.
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    let context =
        json!({"workspaceId":core.home.scope.workspace_id, "homeId":core.home.scope.home_id});
    let endpoint = format!(
        "/api/atlas/mcp/workspaces/{}/homes/{}",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let receipt: Value = serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login = receipt
        .get("editorLogin")
        .ok_or("Missing generated disposable login")?
        .clone();
    drop(receipt);
    let app = router(
        Host::new(core, ORIGIN.to_owned(), Arc::new(BTreeMap::new()), vec![])?
            .with_mcp_command_profile(McpCommandProfile::ExistingEditorCommands),
    );
    let response = app
        .clone()
        .oneshot(request("/api/atlas/auth/login", &login, None, None, None)?)
        .await?;
    drop(login);
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
    let session_info: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
    let actor = session_info["actorId"]
        .as_str()
        .ok_or("Missing native actor")?
        .to_owned();
    let csrf = session_info["csrfToken"]
        .as_str()
        .ok_or("Missing native lexical CSRF")?
        .to_owned();
    assert_eq!(session_info["schemaVersion"], 1);
    let mut client = Client {
        app: &app,
        endpoint,
        cookie,
        csrf,
        session: None,
        posts: 0,
    };
    let initialized = client
        .frame(
            json!({"jsonrpc":"2.0", "id":"initialize", "method":"initialize",
        "params":{"protocolVersion":mcp::PROTOCOL_VERSION, "capabilities":{},
            "clientInfo":{"name":"Healthy Editor HTTP", "version":"0.1.0"}}}),
        )
        .await?
        .ok_or("Missing initialization")?;
    assert_eq!(
        initialized["result"]["protocolVersion"],
        mcp::PROTOCOL_VERSION
    );
    assert_eq!(initialized["result"]["capabilities"], json!({"tools":{}}));
    client
        .frame(json!({"jsonrpc":"2.0", "method":"notifications/initialized"}))
        .await?;
    let listed = client
        .frame(json!({"jsonrpc":"2.0", "id":1, "method":"tools/list", "params":{}}))
        .await?
        .ok_or("Missing tools")?;
    let tools = listed["result"]["tools"]
        .as_array()
        .ok_or("Missing native catalog")?;
    let records = tools
        .iter()
        .find(|tool| tool["name"] == "atlas_records")
        .ok_or("Missing records tool")?;
    assert_eq!(records["annotations"]["readOnlyHint"], false);
    assert_eq!(records["inputSchema"]["type"], "object");
    assert_eq!(records["outputSchema"]["type"], "object");
    assert!(listed["result"].get("nextCursor").is_none());
    let target = json!({"authority":"atlas", "recordType":"circuit", "recordId":id(920)});
    let payload = json!({"label":null, "panel":null, "evidenceIds":[id(100)]});
    let create = json!({"schemaVersion":3, "commandId":"atlas.circuit.create", "requestId":id(2810),
        "context":context, "target":target, "payload":payload, "idempotencyKey":id(2811),
        "reason":"Healthy disposable HTTP MCP circuit create", "approvalReceiptId":null,
        "preconditions":{"target":null, "guards":[{"target":{"authority":"atlas", "recordType":"evidence", "recordId":id(100)},
            "revision":{"kind":"atlas", "value":1}}]}});
    let validator = wire::StockValidation::new()?;
    let canonical = wire::StockRequest::parse(&validator, create.clone())?;
    let created = client.call(json!(2), &create, &validator).await?;
    assert_eq!(created["status"], "committed");
    assert_eq!(created["data"]["requestDigest"], canonical.intent_digest());
    assert_eq!(
        created["data"]["records"],
        json!([{"target":target, "revision":1, "lifecycle":"active", "payload":payload}])
    );
    let audit = created["data"]["auditIds"]
        .as_array()
        .ok_or("Missing committed audit ID")?;
    assert_eq!(audit.len(), 1);
    let get = json!({"schemaVersion":3, "commandId":"atlas.circuit.get", "requestId":id(2812),
        "context":context, "target":target, "payload":{}});
    let got = client.call(json!("get"), &get, &validator).await?;
    assert_eq!(got["status"], "read");
    assert_eq!(got["data"]["records"], created["data"]["records"]);
    assert_eq!(got["data"]["sourceStatus"], "current");
    assert_eq!(got["data"]["nextCursor"], Value::Null);
    let history = json!({"schemaVersion":3, "commandId":"atlas.circuit.history", "requestId":id(2813),
        "context":context, "target":target, "payload":{"pageSize":1, "cursor":null, "includeArchived":false, "q":"atlas.circuit.create"}});
    let readback = client.call(json!("history"), &history, &validator).await?;
    assert_eq!(readback["status"], "read");
    assert_eq!(readback["data"]["completeness"], "atlas-owned-audit");
    assert_eq!(readback["data"]["nextCursor"], Value::Null);
    let entries = readback["data"]["entries"]
        .as_array()
        .ok_or("Missing actual history")?;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["eventId"], audit[0]);
    assert_eq!(entries[0]["actorId"], actor);
    assert_eq!(entries[0]["commandId"], create["commandId"]);
    assert_eq!(entries[0]["requestDigest"], canonical.intent_digest());
    assert_eq!(entries[0]["target"], target);
    assert_eq!(entries[0]["state"], "committed");
    assert_eq!(client.posts, 6); // One login plus six MCP POSTs: seven total.
    drop(client);
    // Normal Host teardown closes the genuine native MCP session and drops its
    // owned Core/SQLite handles; there is no unsupported DELETE or control call.
    drop(app);
    scratch.close()?;
    println!(
        "PASS one healthy in-process Editor HTTP MCP session: seven POSTs, one native circuit commit, canonical ID/intent and get/history audit readback; normal teardown and private fixture cleanup"
    );
    Ok(())
}
