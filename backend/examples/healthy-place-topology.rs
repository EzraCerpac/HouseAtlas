//! Healthy reviewed multi-building topology through real native Editor HTTP MCP.
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

fn target(kind: &str, number: u32) -> Value {
    json!({"authority":"atlas", "recordType":kind, "recordId":id(number)})
}
fn location_endpoint(number: u32) -> Value {
    json!({"kind":"atlas-record", "ref":{"recordType":"identity", "recordId":id(number)}})
}
fn guard(kind: &str, number: u32) -> Value {
    json!({"target":target(kind, number), "revision":{"kind":"atlas", "value":1}})
}
struct Proof<'a, 'b> {
    client: &'a mut Client<'b>,
    validator: wire::StockValidation,
    context: Value,
    actor: String,
    serial: u32,
    // Expected audit lineage only; actual persistence/readback remains native.
    lineage: BTreeMap<String, Vec<Value>>,
}
impl Proof<'_, '_> {
    async fn read(
        &mut self,
        kind: &str,
        number: u32,
        verb: &str,
        payload: Value,
    ) -> Result<Value, Failure> {
        self.serial += 1;
        let command = json!({"schemaVersion":3, "commandId":format!("atlas.{kind}.{verb}"),
            "requestId":id(self.serial), "context":self.context, "target":target(kind, number), "payload":payload});
        let result = self
            .client
            .call(json!(self.serial), &command, &self.validator)
            .await?;
        assert_eq!(result["status"], "read");
        Ok(result)
    }
    async fn mutate(
        &mut self,
        kind: &str,
        number: u32,
        payload: Value,
        guards: Vec<Value>,
        correction: bool,
        reason: &str,
    ) -> Result<(), Failure> {
        self.serial += 2;
        let revision = if correction { 2 } else { 1 };
        let verb = if correction { "replace" } else { "create" };
        let command = json!({"schemaVersion":3, "commandId":format!("atlas.{kind}.{verb}"),
            "requestId":id(self.serial), "context":self.context, "target":target(kind, number),
            "payload":payload, "idempotencyKey":id(self.serial+1), "reason":reason, "approvalReceiptId":null,
            "preconditions":{"target":if correction { json!({"kind":"atlas", "value":1}) } else { Value::Null }, "guards":guards}});
        let canonical = wire::StockRequest::parse(&self.validator, command.clone())?;
        let committed = self
            .client
            .call(json!(self.serial), &command, &self.validator)
            .await?;
        assert_eq!(committed["status"], "committed");
        assert_eq!(
            committed["data"]["requestDigest"],
            canonical.intent_digest()
        );
        assert_eq!(
            committed["data"]["records"],
            json!([{"target":target(kind, number), "revision":revision, "lifecycle":"active", "payload":payload}])
        );
        let audits = committed["data"]["auditIds"]
            .as_array()
            .ok_or("Missing native audit IDs")?;
        assert_eq!(audits.len(), 1);
        let key = format!("{kind}/{number}");
        self.lineage.entry(key.clone()).or_default().push(json!({"eventId":audits[0], "commandId":command["commandId"], "requestDigest":canonical.intent_digest()}));
        let got = self.read(kind, number, "get", json!({})).await?;
        assert_eq!(got["data"]["records"], committed["data"]["records"]);
        assert_eq!(got["data"]["sourceStatus"], "current");
        let history = self
            .read(
                kind,
                number,
                "history",
                json!({"pageSize":100, "cursor":null, "includeArchived":false}),
            )
            .await?;
        assert_eq!(history["data"]["completeness"], "atlas-owned-audit");
        assert_eq!(history["data"]["nextCursor"], Value::Null);
        let entries = history["data"]["entries"]
            .as_array()
            .ok_or("Missing actual history")?;
        let expected = &self.lineage[&key];
        assert_eq!(entries.len(), expected.len());
        for event in expected {
            let actual = entries
                .iter()
                .find(|row| row["eventId"] == event["eventId"])
                .ok_or("Missing original audit lineage")?;
            assert_eq!(actual["actorId"], self.actor);
            assert_eq!(actual["commandId"], event["commandId"]);
            assert_eq!(actual["requestDigest"], event["requestDigest"]);
            assert_eq!(actual["target"], target(kind, number));
            assert_eq!(actual["state"], "committed");
        }
        Ok(())
    }
    async fn building(&mut self, building: u32, expected: &[u32]) -> Result<(), Failure> {
        let mut cursor = Value::Null;
        let mut identities = Vec::new();
        let mut pages = 0;
        loop {
            self.serial += 1;
            let command = json!({"schemaVersion":3, "commandId":"atlas.identity.list", "requestId":id(self.serial),
                "context":self.context, "target":{"authority":"atlas", "recordType":"identity"},
                "payload":{"buildingId":id(building), "pageSize":1, "cursor":cursor, "includeArchived":false}});
            let result = self
                .client
                .call(json!(self.serial), &command, &self.validator)
                .await?;
            assert_eq!(result["status"], "read");
            assert_eq!(result["data"]["sourceStatus"], "current");
            let records = result["data"]["records"]
                .as_array()
                .ok_or("Missing building page")?;
            assert_eq!(records.len(), 1);
            assert_eq!(records[0]["payload"]["kind"], "location");
            assert_eq!(records[0]["lifecycle"], "active");
            assert_eq!(records[0]["revision"], 1);
            identities.push(records[0]["target"]["recordId"].clone());
            pages += 1;
            assert!(pages <= expected.len());
            cursor = result["data"]["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
            assert!(cursor.is_string());
        }
        assert_eq!(
            identities,
            expected.iter().map(|n| json!(id(*n))).collect::<Vec<_>>()
        );
        assert_eq!(pages, expected.len());
        Ok(())
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
        .prefix("houseatlas-healthy-place-topology-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    // Existing public healthy setup creates previously absent native databases,
    // provisions synthetic users and strictly reopens the actual fixture Store.
    // Its genuine evidence 100/revision 1 supplies the topology evidence guards.
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
            "clientInfo":{"name":"Healthy place topology", "version":"0.1.0"}}}),
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
    let mut proof = Proof {
        client: &mut client,
        validator: wire::StockValidation::new()?,
        context,
        actor,
        serial: 5000,
        lineage: BTreeMap::new(),
    };
    // Identities deliberately carry no name-derived placement. Generic names
    // below describe only this synthetic example's explicit reviewed facts.
    // 1100 Alpha; 1101 Beta; 1102 lower; 1103 upper; 1104 lower room;
    // 1105 upper room; 1106 direct member/unknown level; 1107 unassigned;
    // 1108 Beta room. Identity 1100 is the explicitly named elevation datum.
    for number in 1100..=1108 {
        proof
            .mutate(
                "identity",
                number,
                json!({"kind":"location", "evidenceIds":[id(100)]}),
                vec![guard("evidence", 100)],
                false,
                "Create generic synthetic topology identity",
            )
            .await?;
    }
    for (number, identity, semantic) in [
        (1200, 1100, "building"),
        (1201, 1101, "building"),
        (1202, 1102, "floor"),
        (1203, 1103, "floor"),
        (1204, 1104, "room"),
        (1205, 1105, "room"),
        (1206, 1106, "other"),
        (1207, 1107, "other"),
        (1208, 1108, "room"),
    ] {
        let mut payload = json!({"atlasId":id(identity), "semanticKind":semantic,
            "reviewStatus":if number == 1203 {"proposed"} else {"accepted"}, "evidenceIds":[id(100)]});
        let mut guards = vec![guard("evidence", 100), guard("identity", identity)];
        if number == 1202 {
            payload["elevation"] = json!({"status":"known", "metres":0, "datumAtlasId":id(1100)});
            guards.push(guard("identity", 1100));
        }
        if number == 1203 {
            payload["elevation"] = json!({"status":"unknown"});
        }
        proof
            .mutate(
                "location-semantics",
                number,
                payload.clone(),
                guards.clone(),
                false,
                "Record generic synthetic location classification",
            )
            .await?;
        if number == 1203 {
            // Genuine guarded reviewed correction: retain the original identity,
            // evidence and unknown elevation; replace proposed with accepted.
            payload["reviewStatus"] = json!("accepted");
            proof
                .mutate(
                    "location-semantics",
                    number,
                    payload,
                    guards,
                    true,
                    "Reviewed correction accepting synthetic upper floor classification",
                )
                .await?;
        }
    }
    for (number, membership, parent, child) in [
        (1300, "building", 1100, 1102),
        (1301, "building", 1100, 1103),
        (1302, "level", 1102, 1104),
        (1303, "level", 1103, 1105),
        (1304, "building", 1100, 1106),
        (1305, "building", 1101, 1108),
    ] {
        let payload = json!({"kind":"location-membership", "membershipKind":membership,
            "from":location_endpoint(parent), "to":location_endpoint(child), "reviewStatus":"accepted",
            "uncertainty":{"status":"supported", "explanation":null}, "evidenceIds":[id(100)]});
        proof
            .mutate(
                "relation",
                number,
                payload,
                vec![
                    guard("evidence", 100),
                    guard("identity", parent),
                    guard("identity", child),
                ],
                false,
                "Record evidence-backed generic synthetic membership",
            )
            .await?;
    }
    for (number, access, assertion, direction, from, to) in [
        (1400, "door", "present", "bidirectional", 1104, 1106),
        (1401, "stair", "present", "from-to", 1102, 1103),
        (1402, "opening", "unknown", "from-to", 1106, 1108),
    ] {
        let payload = json!({"kind":"physical-access", "accessKind":access, "assertion":assertion,
            "direction":direction, "from":location_endpoint(from), "to":location_endpoint(to), "reviewStatus":"accepted",
            "uncertainty":{"status":if assertion == "unknown" {"unknown"} else {"supported"}, "explanation":null},
            "evidenceIds":[id(100)]});
        proof
            .mutate(
                "relation",
                number,
                payload,
                vec![
                    guard("evidence", 100),
                    guard("identity", from),
                    guard("identity", to),
                ],
                false,
                "Record synthetic physical access fact without route or safety inference",
            )
            .await?;
    }
    // Successful exact pagination proves the explicit membership sets; physical
    // access across buildings does not transfer membership. Unassigned 1107 is
    // outside both sets, and direct 1106 has no fabricated level membership.
    proof
        .building(1100, &[1100, 1102, 1103, 1104, 1105, 1106])
        .await?;
    proof.building(1101, &[1101, 1108]).await?;
    let commits: usize = proof.lineage.values().map(Vec::len).sum();
    assert_eq!(commits, 28);
    drop(proof);
    let posts = client.posts;
    drop(client);
    drop(app);
    scratch.close()?;
    println!(
        "PASS healthy native place topology: {posts} MCP POSTs, 28 native commits with exact get/history audit and intent lineage, Alpha/Beta exact one-record pagination, zero/unknown elevation, present door/stair and unknown access; private fixture cleanup"
    );
    Ok(())
}
