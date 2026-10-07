//! One explicitly selected healthy executable, mounted only in the disposable
//! compiler harness. Actual native Access and root StockService; no fake peer,
//! HTTP listener, held control, provider request or original household data.
use houseatlas_backend::{
    access as a,
    app::access_scope,
    contracts::stock as wire,
    http::agents::mcp::StockService,
    lifecycle::{self, Failure},
    transports::mcp::{
        self as m,
        lifecycle::{
            AuthenticatedIdentity, Delivery, NativeSession, mount_adapter, rotate_confirmed,
        },
    },
};
use serde_json::{Value, json};
use std::fs;

const ORIGIN: &str = "https://atlas.synthetic.invalid";

fn main() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-mcp-lifecycle-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    let scope = access_scope(&core.home.scope)?;
    let scratch_receipt: Value =
        serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(
        scratch_receipt
            .get("editorLogin")
            .ok_or("Missing disposable login")?,
    )?;
    drop(scratch_receipt);
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let receipt = core
        .access
        .lock()
        .map_err(|_| "Access unavailable")?
        .login(
            &observed(&login_url, None, None),
            &login_body,
            "healthy-mcp-lifecycle",
        )?;
    drop(login_body);
    let cookie = receipt
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing cookie")?
        .to_owned();
    let csrf = receipt.info().csrf_token().to_owned();
    drop(receipt);
    let endpoint = format!(
        "{ORIGIN}/api/atlas/mcp/workspaces/{}/homes/{}",
        scope.workspace_id.as_str(),
        scope.home_id.as_str()
    );
    let identity = AuthenticatedIdentity::authenticate_post(
        core.access.clone(),
        &observed(&endpoint, Some(&cookie), Some(&csrf)),
        &scope,
    )?;
    assert_eq!(identity.original().role(), a::Role::Editor);
    assert_eq!(identity.original().scope(), &scope);
    let mut session = mount_adapter::bind(identity.clone(), StockService { core: &core })
        .await
        .map_err(|_| "Lifecycle unavailable")?;
    let control = session.control();
    initialize(&mut session, &identity).await?;
    let first = read(
        &mut session,
        &identity,
        &core.home.scope,
        json!(u64::MAX),
        "00000000-0000-4000-8000-000000001901",
    )
    .await?;
    assert_eq!(first["status"], "read");
    assert_eq!(
        first["data"]["records"]
            .as_array()
            .ok_or("Missing records")?
            .len(),
        1
    );

    // A genuine healthy rotation, not a forged event or an expired/revoked
    // credential probe. No attempt uses the old credential after rotation.
    let rotation_url = format!("{ORIGIN}/api/atlas/auth/rotate");
    let (rotated, event) = rotate_confirmed(
        core.access.clone(),
        &observed(&rotation_url, Some(&cookie), Some(&csrf)),
    )?;
    assert!(control.on_rotation(&event));
    assert!(control.is_closed());
    assert_eq!(session.state(), m::SessionState::Closed);
    drop(session);
    drop(control);
    drop(identity);
    drop(cookie);
    drop(csrf);
    let current_cookie = rotated
        .set_cookie()
        .split(';')
        .next()
        .ok_or("Missing rotated cookie")?
        .to_owned();
    let current_csrf = rotated.info().csrf_token().to_owned();
    drop(rotated);
    drop(event);
    let current = AuthenticatedIdentity::authenticate_post(
        core.access.clone(),
        &observed(&endpoint, Some(&current_cookie), Some(&current_csrf)),
        &scope,
    )?;
    let mut fresh = mount_adapter::bind(current.clone(), StockService { core: &core })
        .await
        .map_err(|_| "Fresh lifecycle unavailable")?;
    initialize(&mut fresh, &current).await?;
    let second = read(
        &mut fresh,
        &current,
        &core.home.scope,
        json!(i64::MIN),
        "00000000-0000-4000-8000-000000001902",
    )
    .await?;
    assert_eq!(first["data"], second["data"]);
    fresh.close();
    assert_eq!(fresh.state(), m::SessionState::Closed);
    drop(fresh);
    drop(current);
    drop(current_cookie);
    drop(current_csrf);
    drop(core);
    scratch.close()?;
    println!(
        "PASS healthy native MCP lifecycle: two init/list/get sessions; exact text, integer and canonical correlation; confirmed Access rotation and fresh issuance; no listener or held controls"
    );
    Ok(())
}

fn observed<'a>(
    url: &'a str,
    cookie: Option<&'a str>,
    csrf: Option<&'a str>,
) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url,
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

async fn initialize(
    session: &mut NativeSession<StockService<'_>>,
    identity: &AuthenticatedIdentity,
) -> Result<(), Failure> {
    assert_eq!(session.state(), m::SessionState::New);
    let initialized = rpc(
        session,
        identity,
        json!({
            "jsonrpc":"2.0", "id":"1", "method":"initialize", "params":{
                "protocolVersion":m::PROTOCOL_VERSION, "capabilities":{},
                "clientInfo":{"name":"HouseAtlas healthy lifecycle", "version":"0.1.0"}
            }
        }),
    )
    .await?;
    assert_eq!(
        initialized["result"]["protocolVersion"],
        m::PROTOCOL_VERSION
    );
    assert_eq!(initialized["result"]["capabilities"], json!({"tools":{}}));
    assert_eq!(session.state(), m::SessionState::AwaitingInitialized);
    assert_eq!(
        session
            .handle(
                identity,
                br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
            )
            .await
            .map_err(|_| "Initialization unavailable")?,
        Delivery::Accepted
    );
    assert_eq!(session.state(), m::SessionState::Ready);
    let listed = rpc(
        session,
        identity,
        json!({"jsonrpc":"2.0", "id":1, "method":"tools/list"}),
    )
    .await?;
    let tools = listed["result"]["tools"]
        .as_array()
        .ok_or("Missing catalog")?;
    assert_eq!(tools.len(), 3);
    assert!(
        tools
            .iter()
            .all(|tool| tool["annotations"]["readOnlyHint"] == true)
    );
    assert!(tools.iter().any(|tool| tool["name"] == "atlas_records"));
    assert!(listed["result"].get("nextCursor").is_none());
    Ok(())
}

async fn read(
    session: &mut NativeSession<StockService<'_>>,
    identity: &AuthenticatedIdentity,
    scope: &houseatlas_backend::domain::Scope,
    rpc_id: Value,
    canonical_id: &str,
) -> Result<Value, Failure> {
    let request = json!({
        "schemaVersion":3, "commandId":"atlas.identity.get", "requestId":canonical_id,
        "context":{"workspaceId":scope.workspace_id, "homeId":scope.home_id},
        "target":{"authority":"atlas", "recordType":"identity", "recordId":"00000000-0000-4000-8000-000000000200"},
        "payload":{}
    });
    let reply = rpc(session, identity, json!({"jsonrpc":"2.0", "id":rpc_id, "method":"tools/call", "params":{"name":"atlas_records", "arguments":request.clone()}})).await?;
    let result = &reply["result"];
    assert_eq!(result["isError"], false);
    let structured = result
        .get("structuredContent")
        .filter(|value| value.is_object())
        .ok_or("Missing owner result")?;
    let text: Value = serde_json::from_str(
        result["content"][0]["text"]
            .as_str()
            .ok_or("Missing text")?,
    )?;
    assert_eq!(&text, structured);
    assert_eq!(structured["requestId"], request["requestId"]);
    assert_eq!(structured["commandId"], request["commandId"]);
    assert_eq!(structured["resolvedScope"], request["context"]);
    let validator = wire::StockValidation::new()?;
    let parsed = wire::StockRequest::parse(&validator, request)?;
    wire::StockResponse::parse(&validator, &parsed, structured.clone(), &[])?;
    Ok(structured.clone())
}

async fn rpc(
    session: &mut NativeSession<StockService<'_>>,
    identity: &AuthenticatedIdentity,
    message: Value,
) -> Result<Value, Failure> {
    let bytes = serde_json::to_vec(&message)?;
    let Delivery::Reply(reply) = session
        .handle(identity, &bytes)
        .await
        .map_err(|_| "Native reply unavailable")?
    else {
        return Err("Missing native reply".into());
    };
    let reply: Value = serde_json::from_slice(&reply)?;
    assert_eq!(reply["jsonrpc"], "2.0");
    assert_eq!(reply["id"], message["id"]);
    assert!(reply.get("error").is_none());
    Ok(reply)
}
