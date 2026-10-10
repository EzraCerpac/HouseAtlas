//! One healthy in-process stock/MCP flow over the real root owner composition.
//!
//! RequestEvidence below is constructed directly for the actual native access
//! owner. This example opens no HTTP listener and proves no HTTP transport.
//! Credentials and media originals stay in the disposable private fixture.
//! No rejection, replay, expiry, revocation, failure, crash, concurrency,
//! provider, recovery, or cursor-continuation flows are included.

use houseatlas_backend::{
    access as a,
    app::{RequestPrincipal, access_scope},
    contracts::stock as wire,
    http::agents::{mcp as host_mcp, stock_dispatch},
    lifecycle::{self, Failure},
    transports::mcp,
};
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt};

#[path = "healthy_specialized_atlas.rs"]
mod healthy_specialized_atlas;

const ORIGIN: &str = "https://atlas.synthetic.invalid";

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn main() -> Result<(), Failure> {
    // Set the process-wide mask before constructing any runtime or fixture.
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(async {
            healthy().await?;
            healthy_specialized_atlas::healthy()?;
            Ok(())
        })
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-agent-stock-")
        .tempdir_in("/tmp")?;
    // prepare creates this previously absent child and opens real SQLite stores.
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    assert_eq!(
        fs::metadata(&directory)?.permissions().mode() & 0o777,
        0o700
    );
    let scope = access_scope(&core.home.scope)?;
    let context = json!({
        "workspaceId": core.home.scope.workspace_id.clone(),
        "homeId": core.home.scope.home_id.clone(),
    });

    // Read only the private scratch receipt; never print passwords or tokens.
    let scratch_receipt: Value =
        serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(
        scratch_receipt
            .get("editorLogin")
            .ok_or("Missing disposable editor login")?,
    )?;
    drop(scratch_receipt);
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let (cookie, csrf, actor_id) = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        let receipt = access.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &login_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            &login_body,
            "healthy-agent-stock",
        )?;
        (
            receipt
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing native session cookie")?
                .to_owned(),
            receipt.info().csrf_token().to_owned(),
            receipt.info().actor_id().as_str().to_owned(),
        )
    };
    drop(login_body);
    assert_eq!(actor_id, id(7));

    // Real AT11 issuance checks POST, the actual session, CSRF and editor role.
    // These are native owner calls with constructed evidence, not HTTP requests.
    let command_url = format!(
        "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id,
    );
    let mutation_principal = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        access.authorize(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &command_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: Some(&csrf),
            },
            &scope,
            a::Action::Mutate,
        )?
    };
    assert_eq!(mutation_principal.actor_id().as_str(), actor_id);
    assert_eq!(mutation_principal.scope(), &scope);
    assert_eq!(mutation_principal.role(), a::Role::Editor);

    let target = json!({
        "authority": "atlas", "recordType": "circuit", "recordId": id(920),
    });
    let payload = json!({"label": null, "panel": null, "evidenceIds": [id(100)]});
    let create = json!({
        "schemaVersion": 3,
        "commandId": "atlas.circuit.create",
        "requestId": id(1200),
        "context": context.clone(),
        "target": target.clone(),
        "payload": payload.clone(),
        "idempotencyKey": id(1300),
        "reason": "Healthy disposable native stock create",
        "preconditions": {
            "target": null,
            "guards": [{
                "target": {
                    "authority": "atlas", "recordType": "evidence", "recordId": id(100),
                },
                "revision": {"kind": "atlas", "value": 1},
            }],
        },
        "approvalReceiptId": null,
    });
    // Evidence 100 revision 1 is in the actual prepared fixture. The shared
    // executor validates this retained guard inside its real native commit.
    let validator = wire::StockValidation::new()?;
    let create_request = wire::StockRequest::parse(&validator, create.clone())?;
    let mutation_capture = RequestPrincipal::new(mutation_principal);
    let created = stock_dispatch::execute(&core, &mutation_capture, create.clone())?;
    wire::StockResponse::parse(
        &validator,
        &create_request,
        created.wire.clone(),
        &created.children,
    )?;
    assert!(created.children.is_empty());
    assert_eq!(created.wire["commandId"], create["commandId"]);
    assert_eq!(created.wire["requestId"], create["requestId"]);
    assert_eq!(created.wire["resolvedScope"], context);
    assert_eq!(created.wire["status"], "committed");
    assert_eq!(created.wire["replayed"], false);
    let records = created.wire["data"]["records"]
        .as_array()
        .ok_or("Missing native create records")?;
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0],
        json!({
            "target": target.clone(), "revision": 1, "lifecycle": "active",
            "payload": payload,
        })
    );
    let audit_ids = created.wire["data"]["auditIds"]
        .as_array()
        .ok_or("Missing native create audit IDs")?;
    assert_eq!(audit_ids.len(), 1);
    let audit_id = audit_ids[0].clone();
    let request_digest = created.wire["data"]["requestDigest"].clone();
    drop(mutation_capture);

    // Issue a separate genuine GET principal; do not relabel mutation authority.
    let get_url = format!(
        "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/records/circuit/{}",
        core.home.scope.workspace_id,
        core.home.scope.home_id,
        id(920),
    );
    let read_principal = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        access.authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &get_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            },
            &scope,
            a::Action::Read,
        )?
    };
    assert_eq!(read_principal.actor_id().as_str(), actor_id);
    assert_eq!(read_principal.scope(), &scope);
    drop(cookie);
    drop(csrf);
    let (adapter, mut session) = host_mcp::bind_read(&core, read_principal.clone())
        .await
        .map_err(|_| "Native MCP read binding unavailable")?;
    drop(read_principal);

    let initialized = rpc(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": mcp::PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "HouseAtlas healthy stock example", "version": "0.1.0"},
            },
        }),
    )
    .await?;
    assert_eq!(
        initialized["result"]["protocolVersion"],
        mcp::PROTOCOL_VERSION
    );
    assert_eq!(initialized["result"]["capabilities"], json!({"tools": {}}));
    assert_eq!(session.state(), mcp::SessionState::AwaitingInitialized);
    let notification = serde_json::to_vec(&json!({
        "jsonrpc": "2.0", "method": "notifications/initialized",
    }))?;
    assert!(adapter.handle(&mut session, &notification).await.is_none());
    assert_eq!(session.state(), mcp::SessionState::Ready);

    let listed = rpc(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
        }),
    )
    .await?;
    let tools = listed["result"]["tools"]
        .as_array()
        .ok_or("Missing native tools")?;
    let records_tool = tools
        .iter()
        .find(|tool| tool["name"] == "atlas_records")
        .ok_or("Missing admitted atlas_records tool")?;
    assert_eq!(records_tool["inputSchema"]["type"], "object");
    assert_eq!(records_tool["outputSchema"]["type"], "object");
    assert_eq!(records_tool["annotations"]["readOnlyHint"], true);
    assert!(listed["result"].get("nextCursor").is_none());

    let get = json!({
        "schemaVersion": 3, "commandId": "atlas.circuit.get", "requestId": id(1201),
        "context": context.clone(), "target": target.clone(), "payload": {},
    });
    let get_reply = rpc(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "atlas_records", "arguments": get.clone()},
        }),
    )
    .await?;
    let got = tool_wire(&get_reply)?;
    let get_request = wire::StockRequest::parse(&validator, get.clone())?;
    wire::StockResponse::parse(&validator, &get_request, got.clone(), &[])?;
    assert_eq!(got["status"], "read");
    assert_eq!(got["replayed"], false);
    assert_eq!(got["data"]["records"], created.wire["data"]["records"]);
    assert_eq!(got["data"]["nextCursor"], Value::Null);
    assert_eq!(got["data"]["sourceStatus"], "current");

    let history = json!({
        "schemaVersion": 3, "commandId": "atlas.circuit.history", "requestId": id(1202),
        "context": context, "target": target.clone(),
        "payload": {"pageSize": 1, "cursor": null, "includeArchived": false,
            "q": "atlas.circuit.create"},
    });
    let history_reply = rpc(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "atlas_records", "arguments": history.clone()},
        }),
    )
    .await?;
    let history_wire = tool_wire(&history_reply)?;
    let history_request = wire::StockRequest::parse(&validator, history)?;
    wire::StockResponse::parse(&validator, &history_request, history_wire.clone(), &[])?;
    assert_eq!(history_wire["status"], "read");
    assert_eq!(history_wire["replayed"], false);
    assert_eq!(history_wire["data"]["completeness"], "atlas-owned-audit");
    assert_eq!(history_wire["data"]["nextCursor"], Value::Null);
    let events = history_wire["data"]["entries"]
        .as_array()
        .ok_or("Missing native history entries")?;
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event["eventId"], audit_id);
    assert_eq!(event["commandId"], create["commandId"]);
    assert_eq!(event["requestDigest"], request_digest);
    assert_eq!(event["actorId"], actor_id);
    assert_eq!(event["state"], "committed");
    assert_eq!(event["target"], target);

    session.close();
    assert_eq!(session.state(), mcp::SessionState::Closed);
    drop(session);
    drop(adapter);
    drop(core);
    scratch.close()?;
    println!(
        "PASS healthy in-process native stock/MCP: one circuit commit, native get/history, actual audit linkage; no HTTP listener"
    );
    Ok(())
}

// Transport serialization only: each successful request is supplied explicitly.
async fn rpc(
    adapter: &host_mcp::Adapter<'_>,
    session: &mut mcp::Session<mcp::NativeContext>,
    message: Value,
) -> Result<Value, Failure> {
    let bytes = serde_json::to_vec(&message)?;
    let response = adapter
        .handle(session, &bytes)
        .await
        .ok_or("Missing healthy MCP response")?;
    let response: Value = serde_json::from_slice(&response)?;
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], message["id"]);
    assert!(response.get("error").is_none());
    Ok(response)
}

fn tool_wire(response: &Value) -> Result<Value, Failure> {
    let result = &response["result"];
    assert_eq!(result["isError"], false);
    let structured = result
        .get("structuredContent")
        .filter(|value| value.is_object())
        .ok_or("Missing native structured content")?;
    let content = result["content"]
        .as_array()
        .ok_or("Missing native text content")?;
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "text");
    let text = content[0]["text"]
        .as_str()
        .ok_or("Missing native text JSON")?;
    let text: Value = serde_json::from_str(text)?;
    assert_eq!(&text, structured);
    Ok(structured.clone())
}
