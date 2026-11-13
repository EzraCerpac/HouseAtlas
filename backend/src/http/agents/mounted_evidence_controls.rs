//! Unapplied #288 draft pinned to main 632168283a85c046f7ae5c0aabb93486e64c34a2.
//! Intended test-only home: http::agents::mounted_evidence_controls.
//! Actual default Host/router/Access/StockService/SQLite; generated evidence only.
//! No mounted Viewer admission, browser, listener, expiry, reopen or provider proof.

use super::stock_dispatch;
use crate::{
    access as a,
    app::{RequestPrincipal, access_scope},
    contracts::stock as wire,
    http::{Host, McpCommandProfile, router},
    lifecycle::{self, Failure},
    transports::mcp,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{HeaderMap, Method, Request, StatusCode},
};
use rusqlite::{Connection, OpenFlags, types::Value as SqlValue};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    net::SocketAddr,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::Arc,
};
use tower::ServiceExt;

const ORIGIN: &str = "https://127.0.0.1:48743";
const QUERY: &str = "Synthetic mounted evidence read controls";
const PRIMARY: u32 = 41_002;
const MAX_RESPONSE: usize = 2 * 1024 * 1024;
type Steps = Vec<(Value, Value)>;
type Facts = BTreeMap<&'static str, Vec<Vec<SqlValue>>>;

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn target(number: u32) -> Value {
    json!({"authority":"atlas","recordType":"evidence","recordId":id(number)})
}

fn payload(number: u32) -> Value {
    json!({"statement":format!("{QUERY} {number} α"),
        "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
            "evidenceBasis":"unknown","factAt":null,"retrievedAt":"2026-01-01T12:00:00Z",
            "vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
        "supersedesEvidenceIds":[],"references":[]})
}

fn record(number: u32, revision: u64, lifecycle: &str) -> Value {
    json!({"target":target(number),"revision":revision,
        "lifecycle":lifecycle,"payload":payload(number)})
}

fn mutation(
    context: &Value,
    number: u32,
    operation: &str,
    revision: Option<u64>,
    serial: u32,
) -> Value {
    let value = if operation == "create" {
        payload(number)
    } else {
        json!({})
    };
    json!({"schemaVersion":3,"commandId":format!("atlas.evidence.{operation}"),
        "requestId":id(serial),"context":context,"target":target(number),
        "payload":value,"idempotencyKey":id(serial + 1),
        "reason":"Generated mounted evidence read setup α","approvalReceiptId":null,
        "preconditions":{"target":revision.map(|value|json!({"kind":"atlas","value":value})),
            "guards":[]}})
}

fn get(context: &Value, number: u32, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.get","requestId":id(serial),
        "context":context,"target":target(number),"payload":{}})
}

fn list(context: &Value, archived: bool, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.list","requestId":id(serial),
        "context":context,"target":{"authority":"atlas","recordType":"evidence"},
        "payload":{"cursor":null,"pageSize":1,"includeArchived":archived,"q":QUERY}})
}

fn history(context: &Value, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.history","requestId":id(serial),
        "context":context,"target":target(PRIMARY),
        "payload":{"cursor":null,"pageSize":1,"includeArchived":false,"q":"atlas.evidence."}})
}

fn validate_response(
    validation: &wire::StockValidation,
    request: &Value,
    response: &Value,
    status: &str,
) -> Result<(), Failure> {
    let parsed = wire::StockRequest::parse(validation, request.clone())?;
    wire::StockResponse::parse(validation, &parsed, response.clone(), &[])?;
    assert_eq!(response["schemaVersion"], 3);
    assert_eq!(response["requestId"], request["requestId"]);
    assert_eq!(response["commandId"], request["commandId"]);
    assert_eq!(response["resolvedScope"], request["context"]);
    assert_eq!(response["status"], status);
    assert_eq!(response["replayed"], false);
    if status == "committed" {
        assert_eq!(response["data"]["requestDigest"], parsed.intent_digest());
    }
    Ok(())
}

struct Login {
    cookie: String,
    csrf: String,
    actor: String,
}

struct Exchange {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Vec<u8>,
}

impl Exchange {
    fn json(&self) -> Result<Value, Failure> {
        Ok(serde_json::from_slice(&self.bytes)?)
    }
}

struct Fixture {
    // Field drop order retires the router and final Host before its private files.
    app: Router,
    host: Host,
    directory: PathBuf,
    scope: a::Scope,
    context: Value,
    endpoint: String,
    prefix: String,
    validation: wire::StockValidation,
    _scratch: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Result<Self, Failure> {
        let scratch = tempfile::Builder::new()
            .prefix("houseatlas-mcp288-mounted-evidence-")
            .tempdir_in("/tmp")?;
        let directory = scratch.path().join("fixture");
        let core = lifecycle::prepare(&directory, ORIGIN)?;
        assert_eq!(fs::metadata(&directory)?.permissions().mode() & 0o777, 0o700);
        let scope = access_scope(&core.home.scope)?;
        let context = json!({"workspaceId":core.home.scope.workspace_id,
            "homeId":core.home.scope.home_id});
        let endpoint = format!(
            "/api/atlas/mcp/workspaces/{}/homes/{}",
            scope.workspace_id.as_str(), scope.home_id.as_str()
        );
        let prefix = format!(
            "/api/atlas/stock/v3/workspaces/{}/homes/{}",
            scope.workspace_id.as_str(), scope.home_id.as_str()
        );
        // Ordinary default only. Setup uses actual HTTP stock commands, never
        // ExistingEditorCommands or a mutation-enabled MCP binding.
        let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
        assert!(matches!(host.mcp_command_profile, McpCommandProfile::ReadOnly));
        let app = router(host.clone());
        Ok(Self {
            app,
            host,
            directory,
            scope,
            context,
            endpoint,
            prefix,
            validation: wire::StockValidation::new()?,
            _scratch: scratch,
        })
    }

    async fn exchange(
        &self,
        method: Method,
        path: &str,
        value: Option<&Value>,
        login: Option<&Login>,
        session: Option<&str>,
    ) -> Result<Exchange, Failure> {
        let bytes = value.map(serde_json::to_vec).transpose()?.unwrap_or_default();
        let mut builder = Request::builder()
            .method(method.clone())
            .uri(path)
            .header("host", "127.0.0.1:48743")
            .header("origin", ORIGIN)
            .header("sec-fetch-site", "same-origin")
            .header("content-length", bytes.len());
        if value.is_some() {
            builder = builder.header("content-type", "application/json");
        }
        if path.starts_with("/api/atlas/mcp/") {
            builder = builder.header("accept", "application/json, text/event-stream");
        }
        if let Some(login) = login {
            builder = builder.header("cookie", &login.cookie);
            if method == Method::POST {
                builder = builder.header("x-atlas-csrf", &login.csrf);
            }
        }
        if let Some(session) = session {
            builder = builder
                .header("mcp-session-id", session)
                .header("mcp-protocol-version", mcp::PROTOCOL_VERSION);
        }
        let mut request = builder.body(Body::from(bytes))?;
        // Observed in-process fixture peer only; no listener is started.
        request.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:50123".parse::<SocketAddr>()?,
        ));
        // No Core/Access/Store guard is held across this actual router await.
        let response = self.app.clone().oneshot(request).await?;
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = to_bytes(response.into_body(), MAX_RESPONSE).await?.to_vec();
        Ok(Exchange { status, headers, bytes })
    }

    async fn login(&self, key: &str) -> Result<Login, Failure> {
        let expected_actor = match key {
            "editorLogin" => id(7),
            "login" => id(5),
            _ => return Err("Expected an existing generated fixture login".into()),
        };
        let receipt: Value = serde_json::from_slice(&fs::read(
            self.directory.join("smoke-session.json"),
        )?)?;
        let body = receipt.get(key).ok_or("Missing generated login")?;
        let response = self.exchange(
            Method::POST, "/api/atlas/auth/login", Some(body), None, None,
        ).await?;
        assert_eq!(response.status, StatusCode::OK);
        let cookie = response.headers.get("set-cookie")
            .ok_or("Missing actual cookie")?.to_str()?
            .split(';').next().ok_or("Missing cookie pair")?.to_owned();
        let info = response.json()?;
        assert_eq!(info["schemaVersion"], 1);
        assert_eq!(info["actorId"], expected_actor);
        Ok(Login {
            cookie,
            csrf: info["csrfToken"].as_str().ok_or("Missing current CSRF")?.to_owned(),
            actor: expected_actor,
        })
    }

    fn principal(&self, login: &Login, role: a::Role) -> Result<a::Principal, Failure> {
        let url = format!("{ORIGIN}{}/records/evidence/{}", self.prefix, id(PRIMARY));
        let core = self.host.core.lock().map_err(|_| "Core unavailable")?;
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        let principal = access.authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&login.cookie),
                authorization: None,
                csrf: None,
            },
            &self.scope,
            a::Action::Read,
        )?;
        assert_eq!(principal.role(), role);
        assert_eq!(principal.actor_id().as_str(), login.actor);
        assert_eq!(principal.scope(), &self.scope);
        Ok(principal)
    }

    async fn refuse_viewer_initialization(&self, viewer: &Login) -> Result<(), Failure> {
        // Separate from the unadmitted-operation helper: genuine Viewer cookie
        // and current CSRF fail POST authentication before body/session parsing.
        let init = initialize(json!("viewer-init"));
        let refused = self.exchange(
            Method::POST, &self.endpoint, Some(&init), Some(viewer), None,
        ).await?;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert!(!refused.headers.contains_key("mcp-session-id"));
        let body = refused.json()?;
        assert_eq!(body["jsonrpc"], "2.0");
        assert_eq!(body["error"]["code"], -32003);
        assert_eq!(body["error"]["message"], "Request not permitted");
        assert!(body.get("result").is_none());
        // No requirement that the pre-body refusal echoes viewer-init.
        Ok(())
    }

    async fn commit(&self, editor: &Login, intent: &Value) -> Result<Value, Failure> {
        wire::StockRequest::parse(&self.validation, intent.clone())?;
        let response = self.exchange(
            Method::POST, &format!("{}/commands", self.prefix),
            Some(intent), Some(editor), None,
        ).await?;
        assert_eq!(response.status, StatusCode::OK);
        let outcome = response.json()?;
        validate_response(&self.validation, intent, &outcome, "committed")?;
        assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
        Ok(outcome)
    }

    fn native_read(&self, principal: &a::Principal, request: &Value) -> Result<Value, Failure> {
        // This helper must NEVER be used for parity on an unadmitted mutation:
        // the genuine Editor could commit that mutation through native dispatch.
        assert!(matches!(request["commandId"].as_str(),
            Some("atlas.evidence.get" | "atlas.evidence.list" | "atlas.evidence.history")));
        let core = self.host.core.lock().map_err(|_| "Core unavailable")?;
        let result = stock_dispatch::execute(
            &core, &RequestPrincipal::new(principal.clone()), request.clone(),
        )?;
        assert!(result.children.is_empty());
        validate_response(&self.validation, request, &result.wire, "read")?;
        Ok(result.wire)
    }

    fn facts(&self) -> Result<Facts, Failure> {
        let database = Connection::open_with_flags(
            self.directory.join("atlas.sqlite"), OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let mut result = BTreeMap::new();
        // Full selected factual/audit/commit contents. Cursor metadata is
        // expected to be inserted by history. Access session/rate DATA is not
        // included and this is not a whole-database no-write claim.
        for table in [
            "records", "binding_reservations", "audits", "receipts", "batch_receipts",
            "stock_operations", "stock_groups", "stock_keys", "stock_audit_links",
            "stock_history_lookup",
        ] {
            let mut query = database.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
            let columns = query.column_count();
            let rows = query.query_map([], |row| {
                (0..columns).map(|column| row.get(column))
                    .collect::<Result<Vec<SqlValue>, _>>()
            })?.collect::<Result<Vec<_>, _>>()?;
            result.insert(table, rows);
        }
        Ok(result)
    }

    fn committed_events(&self, steps: &[(Value, Value)]) -> Result<Vec<Value>, Failure> {
        let database = Connection::open_with_flags(
            self.directory.join("atlas.sqlite"), OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let mut events: Vec<Value> = Vec::new();
        for (intent, outcome) in steps {
            let audit_id = outcome["data"]["auditIds"][0].as_str()
                .ok_or("Missing committed audit ID")?;
            let event: String = database.query_row(
                "SELECT event_json FROM stock_audit_links WHERE audit_id=?1",
                [audit_id], |row| row.get(0),
            )?;
            let audit: String = database.query_row(
                "SELECT body FROM audits WHERE audit_id=?1",
                [audit_id], |row| row.get(0),
            )?;
            let event: Value = serde_json::from_str(&event)?;
            let audit: Value = serde_json::from_str(&audit)?;
            let parsed = wire::StockRequest::parse(&self.validation, intent.clone())?;
            assert_eq!(event["eventId"], audit_id);
            assert_eq!(event["commandId"], intent["commandId"]);
            assert_eq!(event["requestDigest"], parsed.intent_digest());
            assert_eq!(event["actorId"], id(7));
            assert_eq!(event["actorId"], audit["actorId"]);
            assert_eq!(event["at"], audit["at"]);
            assert_eq!(event["target"], intent["target"]);
            assert_eq!(event["state"], "committed");
            assert_eq!(event["beforeDigest"], audit["beforeDigest"]);
            assert_eq!(event["afterDigest"], audit["afterDigest"]);
            if let Some(previous) = events.last() {
                assert_eq!(event["beforeDigest"], previous["afterDigest"]);
            } else {
                assert_eq!(event["beforeDigest"], Value::Null);
            }
            assert_eq!(event["afterDigest"].as_str().unwrap().len(), 64);
            events.push(event);
        }
        Ok(events)
    }
}

fn initialize(rpc_id: Value) -> Value {
    json!({"jsonrpc":"2.0","id":rpc_id,"method":"initialize","params":{
        "protocolVersion":mcp::PROTOCOL_VERSION,"capabilities":{},
        "clientInfo":{"name":"Generated mounted evidence controls","version":"1"}}})
}

struct Mounted<'a> {
    fixture: &'a Fixture,
    login: &'a Login,
    session: Option<String>,
    next_rpc: u64,
}

impl<'a> Mounted<'a> {
    async fn open(fixture: &'a Fixture, login: &'a Login) -> Result<Self, Failure> {
        let mut client = Self { fixture, login, session: None, next_rpc: 1 };
        let init = initialize(json!(client.next_rpc));
        client.next_rpc += 1;
        let response = fixture.exchange(
            Method::POST, &fixture.endpoint, Some(&init), Some(login), None,
        ).await?;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(response.headers["content-type"], "application/json");
        let body = response.json()?;
        assert_eq!(body["jsonrpc"], "2.0");
        assert_eq!(body["id"], init["id"]);
        assert!(body.get("error").is_none());
        assert_eq!(body["result"]["protocolVersion"], mcp::PROTOCOL_VERSION);
        assert_eq!(body["result"]["capabilities"], json!({"tools":{}}));
        client.session = Some(response.headers.get("mcp-session-id")
            .ok_or("Missing actual session header")?.to_str()?.to_owned());
        let notification = json!({"jsonrpc":"2.0","method":"notifications/initialized"});
        let response = fixture.exchange(
            Method::POST, &fixture.endpoint, Some(&notification), Some(login),
            client.session.as_deref(),
        ).await?;
        assert_eq!(response.status, StatusCode::ACCEPTED);
        assert!(response.bytes.is_empty());
        Ok(client)
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, Failure> {
        let rpc_id = self.next_rpc;
        self.next_rpc += 1;
        let message = json!({"jsonrpc":"2.0","id":rpc_id,"method":method,"params":params});
        let response = self.fixture.exchange(
            Method::POST, &self.fixture.endpoint, Some(&message), Some(self.login),
            self.session.as_deref(),
        ).await?;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(response.headers["content-type"], "application/json");
        let body = response.json()?;
        assert_eq!(body["jsonrpc"], "2.0");
        assert_eq!(body["id"], rpc_id);
        Ok(body)
    }

    async fn read(&mut self, request: &Value) -> Result<Value, Failure> {
        wire::StockRequest::parse(&self.fixture.validation, request.clone())?;
        let reply = self.rpc("tools/call", json!({"name":"atlas_records","arguments":request})).await?;
        assert!(reply.get("error").is_none());
        let result = &reply["result"];
        assert_eq!(result["isError"], false);
        let content = result["content"].as_array().ok_or("Missing actual text")?;
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        let text: Value = serde_json::from_str(content[0]["text"].as_str()
            .ok_or("Missing actual text body")?)?;
        let raw = result.get("structuredContent").ok_or("Missing actual structured result")?;
        assert_eq!(&text, raw);
        validate_response(&self.fixture.validation, request, raw, "read")?;
        Ok(raw.clone())
    }

    async fn unadmitted_mutation(&mut self, request: &Value) -> Result<(), Failure> {
        // This is deliberately GLOBAL schema validation, not native invocation.
        wire::StockRequest::parse(&self.fixture.validation, request.clone())?;
        let reply = self.rpc("tools/call", json!({"name":"atlas_records","arguments":request})).await?;
        assert_eq!(reply["error"]["code"], -32603);
        assert_eq!(reply["error"]["message"], "Service unavailable");
        assert!(reply.get("result").is_none());
        // Never call native_read/stock_dispatch for this mutation as an oracle.
        Ok(())
    }
}

async fn seed(fixture: &Fixture, editor: &Login) -> Result<(Vec<Value>, Steps), Failure> {
    let mut steps = Vec::new();
    for (index, number) in [41_003, 41_001, PRIMARY].into_iter().enumerate() {
        let intent = mutation(&fixture.context, number, "create", None, 60_000 + 10 * index as u32);
        let outcome = fixture.commit(editor, &intent).await?;
        assert_eq!(outcome["data"]["records"], json!([record(number, 1, "active")]));
        if number == PRIMARY {
            steps.push((intent, outcome));
        }
    }
    let archive = mutation(&fixture.context, 41_003, "tombstone", Some(1), 60_030);
    let archived = fixture.commit(editor, &archive).await?;
    assert_eq!(archived["data"]["records"], json!([record(41_003, 2, "tombstoned")]));
    for (index, operation, revision, lifecycle) in [
        (0, "tombstone", 2, "tombstoned"),
        (1, "restore", 3, "active"),
    ] {
        let intent = mutation(&fixture.context, PRIMARY, operation, Some(revision - 1), 60_040 + 10 * index);
        let outcome = fixture.commit(editor, &intent).await?;
        assert_eq!(outcome["data"]["records"], json!([record(PRIMARY, revision, lifecycle)]));
        steps.push((intent, outcome));
    }
    Ok((vec![record(41_001, 1, "active"), record(PRIMARY, 3, "active"),
        record(41_003, 2, "tombstoned")], steps))
}

async fn list_chain(
    mounted: &mut Mounted<'_>, principal: &a::Principal,
    mut request: Value, expected: &[Value],
) -> Result<(), Failure> {
    let mut tokens = BTreeSet::new();
    let mut seen = Vec::new();
    assert!(!expected.is_empty());
    for (index, expected_record) in expected.iter().enumerate() {
        request["requestId"] = json!(id(72_000 + index as u32));
        let actual = mounted.read(&request).await?;
        let native = mounted.fixture.native_read(principal, &request)?;
        assert_eq!(actual, native);
        assert_eq!(actual["data"]["sourceStatus"], "current");
        assert_eq!(actual["data"]["records"], json!([expected_record]));
        seen.push(actual["data"]["records"][0].clone());
        let next = &actual["data"]["nextCursor"];
        if index + 1 == expected.len() {
            assert_eq!(next, &Value::Null);
        } else {
            let token = next.as_str().ok_or("Missing actual list cursor")?;
            assert!(!token.is_empty());
            assert!(tokens.insert(token.to_owned()));
            request["payload"]["cursor"] = next.clone();
        }
    }
    assert_eq!(seen, expected);
    Ok(())
}

async fn history_chain(
    mounted: &mut Mounted<'_>, principal: &a::Principal,
    mut request: Value, expected: &[Value],
) -> Result<(), Failure> {
    let mut native_request = request.clone();
    let mut mcp_tokens = BTreeSet::new();
    let mut native_tokens = BTreeSet::new();
    for (index, event) in expected.iter().enumerate() {
        request["requestId"] = json!(id(73_000 + index as u32));
        native_request["requestId"] = request["requestId"].clone();
        let mut actual = mounted.read(&request).await?;
        let mut native = mounted.fixture.native_read(principal, &native_request)?;
        assert_eq!(actual["data"]["completeness"], "atlas-owned-audit");
        assert_eq!(actual["data"]["entries"], json!([event]));
        // Independently issued history cursors legitimately have different IDs.
        // Every other field remains exact; traverse both genuine chains.
        let mcp_next = actual["data"].as_object_mut().unwrap().remove("nextCursor").unwrap();
        let native_next = native["data"].as_object_mut().unwrap().remove("nextCursor").unwrap();
        assert_eq!(actual, native);
        if index + 1 == expected.len() {
            assert_eq!(mcp_next, Value::Null);
            assert_eq!(native_next, Value::Null);
        } else {
            let mcp = mcp_next.as_str().ok_or("Missing actual MCP history cursor")?;
            let native = native_next.as_str().ok_or("Missing actual native history cursor")?;
            assert!(!mcp.is_empty() && !native.is_empty());
            assert!(mcp_tokens.insert(mcp.to_owned()));
            assert!(native_tokens.insert(native.to_owned()));
            request["payload"]["cursor"] = mcp_next;
            native_request["payload"]["cursor"] = native_next;
        }
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mounted_read_profile_evidence_family_matches_native_pages_and_admission()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let editor = fixture.login("editorLogin").await?;
    let (records, steps) = seed(&fixture, &editor).await?;
    let events = fixture.committed_events(&steps)?;
    assert_eq!(events.len(), 3);
    let principal = fixture.principal(&editor, a::Role::Editor)?;
    let before = fixture.facts()?;
    let mut mounted = Mounted::open(&fixture, &editor).await?;
    let tools = mounted.rpc("tools/list", json!({})).await?;
    assert!(tools.get("error").is_none());
    assert!(tools["result"].get("nextCursor").is_none());
    let tool = tools["result"]["tools"].as_array().ok_or("Missing actual tools")?
        .iter().find(|tool| tool["name"] == "atlas_records")
        .ok_or("Missing actual record family")?;
    let schema = &tool["inputSchema"];
    let validator = jsonschema::options().with_draft(jsonschema::Draft::Draft202012)
        .offline().build(schema).map_err(|_| "Invalid actual input schema")?;
    let mut commands = BTreeSet::new();
    for arm in schema["oneOf"].as_array().ok_or("Missing actual input arms")? {
        let pointer = arm["$ref"].as_str().and_then(|reference| reference.strip_prefix('#'))
            .ok_or("Expected actual local request reference")?;
        let request = schema.pointer(pointer).ok_or("Missing actual request definition")?;
        commands.insert(request["properties"]["commandId"]["const"].as_str()
            .ok_or("Missing actual command constant")?.to_owned());
    }
    for request in [get(&fixture.context, PRIMARY, 71_000),
        list(&fixture.context, false, 71_010), history(&fixture.context, 71_020)] {
        assert!(commands.contains(request["commandId"].as_str().unwrap()));
        assert!(validator.is_valid(&request));
    }
    for operation in ["create", "tombstone", "restore"] {
        assert!(!commands.contains(&format!("atlas.evidence.{operation}")));
    }
    for (intent, _) in &steps {
        assert!(!validator.is_valid(intent));
    }
    for (index, expected) in records.iter().enumerate() {
        let number = [41_001, PRIMARY, 41_003][index];
        let request = get(&fixture.context, number, 71_100 + index as u32);
        let actual = mounted.read(&request).await?;
        assert_eq!(actual, fixture.native_read(&principal, &request)?);
        assert_eq!(actual["data"]["records"], json!([expected]));
        assert_eq!(actual["data"]["sourceStatus"], "current");
        assert_eq!(actual["data"]["nextCursor"], Value::Null);
        assert_eq!(expected["payload"], payload(number));
    }
    let active = vec![records[0].clone(), records[1].clone()];
    list_chain(&mut mounted, &principal, list(&fixture.context, false, 72_100), &active).await?;
    list_chain(&mut mounted, &principal, list(&fixture.context, true, 72_200), &records).await?;
    history_chain(&mut mounted, &principal, history(&fixture.context, 73_100), &events).await?;
    assert_eq!(fixture.facts()?, before);
    let unadmitted = mutation(&fixture.context, 41_099, "create", None, 80_000);
    assert!(!validator.is_valid(&unadmitted));
    mounted.unadmitted_mutation(&unadmitted).await?;
    assert_eq!(fixture.facts()?, before);
    // Fresh RPC ID after refusal; the existing initialized session still reads.
    let request = get(&fixture.context, PRIMARY, 81_000);
    let actual = mounted.read(&request).await?;
    assert_eq!(actual, fixture.native_read(&principal, &request)?);
    assert_eq!(actual["data"]["records"], json!([record(PRIMARY, 3, "active")]));
    assert_eq!(fixture.facts()?, before);
    drop(mounted);
    // Normal router/Host teardown owns MCP retirement; no DELETE is invented.
    drop(fixture);
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn viewer_evidence_http_reads_do_not_create_mounted_mcp_authority() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let editor = fixture.login("editorLogin").await?;
    let intent = mutation(&fixture.context, PRIMARY, "create", None, 82_000);
    let created = fixture.commit(&editor, &intent).await?;
    let expected = record(PRIMARY, 1, "active");
    assert_eq!(created["data"]["records"], json!([expected]));
    let before = fixture.facts()?;
    let viewer = fixture.login("login").await?;
    let principal = fixture.principal(&viewer, a::Role::Viewer)?;
    assert_ne!(principal.actor_id().as_str(), editor.actor);
    let response = fixture.exchange(
        Method::GET, &format!("{}/records/evidence/{}", fixture.prefix, id(PRIMARY)),
        None, Some(&viewer), None,
    ).await?;
    assert_eq!(response.status, StatusCode::OK);
    let actual = response.json()?;
    // This route chooses its own request ID. Check its actual UUID and exact
    // route-derived request/result, without claiming a caller-supplied ID echo.
    let request = json!({"schemaVersion":3,"commandId":"atlas.evidence.get",
        "requestId":actual["requestId"],"context":fixture.context,
        "target":target(PRIMARY),"payload":{}});
    validate_response(&fixture.validation, &request, &actual, "read")?;
    assert_eq!(actual["data"]["records"], json!([expected]));
    assert_eq!(actual["data"]["sourceStatus"], "current");
    assert_eq!(actual["data"]["nextCursor"], Value::Null);
    assert_eq!(fixture.facts()?, before);
    fixture.refuse_viewer_initialization(&viewer).await?;
    assert_eq!(fixture.facts()?, before);
    drop(fixture);
    Ok(())
}
