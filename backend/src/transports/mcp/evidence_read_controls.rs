//! Borrowed Viewer evidence reads over real Access, StockService and SQLite.
//! Generated records only. No mounted Viewer admission, provider, listener,
//! replacement authority/DTO/cursor, process restart or recovery qualification.

use super::{command, id, identity::Fixture, target};
use crate::{
    access as a,
    app::{Core, RequestPrincipal},
    contracts::stock as wire,
    domain::stock::StockError,
    http::agents::{mcp as root, stock_dispatch},
    lifecycle::Failure,
    transports::mcp::{self as m, SessionState},
};
use rusqlite::{Connection, OpenFlags, types::Value as SqlValue};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Arc,
};

const QUERY: &str = "Synthetic borrowed Viewer evidence controls";
const PRIMARY: u32 = 31_002;
type Steps = Vec<(Value, Value)>;
type Facts = BTreeMap<&'static str, Vec<Vec<SqlValue>>>;

/// The actual borrowed root binding, separate from Client's Editor POST path.
struct Reader<'a> {
    core: &'a Core,
    original: a::Principal,
    adapter: root::Adapter<'a>,
    session: m::Session<m::NativeContext>,
    next_rpc: u64,
    validation: wire::StockValidation,
}

impl<'a> Reader<'a> {
    async fn open(core: &'a Core, original: a::Principal) -> Result<Self, Failure> {
        let (adapter, session) = root::bind_read(core, original.clone())
            .await
            .map_err(|_| "Borrowed read binding unavailable")?;
        let mut reader = Self {
            core,
            original,
            adapter,
            session,
            next_rpc: 1,
            validation: wire::StockValidation::new()?,
        };
        let init = reader
            .rpc(
                "initialize",
                json!({"protocolVersion":m::PROTOCOL_VERSION,"capabilities":{},
                    "clientInfo":{"name":"Synthetic evidence read controls","version":"1"}}),
            )
            .await?;
        assert!(init.get("error").is_none());
        assert_eq!(init["result"]["protocolVersion"], m::PROTOCOL_VERSION);
        assert_eq!(reader.session.state(), SessionState::AwaitingInitialized);
        assert!(
            reader
                .adapter
                .handle(
                    &mut reader.session,
                    br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                )
                .await
                .is_none()
        );
        assert_eq!(reader.session.state(), SessionState::Ready);
        Ok(reader)
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, Failure> {
        let rpc_id = self.next_rpc;
        self.next_rpc += 1;
        let bytes = serde_json::to_vec(&json!({
            "jsonrpc":"2.0","id":rpc_id,"method":method,"params":params
        }))?;
        let reply = self
            .adapter
            .handle(&mut self.session, &bytes)
            .await
            .ok_or("Missing correlated MCP response")?;
        let reply: Value = serde_json::from_slice(&reply)?;
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], rpc_id);
        Ok(reply)
    }

    async fn invoke(&mut self, request: &Value) -> Result<Value, Failure> {
        wire::StockRequest::parse(&self.validation, request.clone())?;
        let reply = self
            .rpc(
                "tools/call",
                json!({"name":"atlas_records","arguments":request}),
            )
            .await?;
        // Initialization/duplicate-RPC errors cannot satisfy a cursor control.
        assert_eq!(self.session.state(), SessionState::Ready);
        assert!(reply.get("error").is_none());
        Ok(reply["result"].clone())
    }

    fn structured(result: &Value) -> Result<Value, Failure> {
        let content = result["content"].as_array().ok_or("Missing MCP content")?;
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        let text: Value =
            serde_json::from_str(content[0]["text"].as_str().ok_or("Missing canonical text")?)?;
        assert!(result["structuredContent"].is_object());
        assert_eq!(text, result["structuredContent"]);
        Ok(text)
    }

    async fn read(&mut self, request: &Value) -> Result<Value, Failure> {
        let result = self.invoke(request).await?;
        assert_eq!(result["isError"], false);
        let raw = Self::structured(&result)?;
        let parsed = wire::StockRequest::parse(&self.validation, request.clone())?;
        wire::StockResponse::parse(&self.validation, &parsed, raw.clone(), &[])?;
        assert_eq!(raw["schemaVersion"], 3);
        assert_eq!(raw["requestId"], request["requestId"]);
        assert_eq!(raw["commandId"], request["commandId"]);
        assert_eq!(raw["resolvedScope"], request["context"]);
        assert_eq!(raw["status"], "read");
        assert_eq!(raw["replayed"], false);
        Ok(raw)
    }

    fn native(&self, request: &Value) -> Result<Value, Failure> {
        let result = stock_dispatch::execute(
            self.core,
            &RequestPrincipal::new(self.original.clone()),
            request.clone(),
        )?;
        assert!(result.children.is_empty());
        let parsed = wire::StockRequest::parse(&self.validation, request.clone())?;
        wire::StockResponse::parse(&self.validation, &parsed, result.wire.clone(), &[])?;
        Ok(result.wire)
    }

    async fn deterministic(&mut self, request: &Value) -> Result<Value, Failure> {
        let raw = self.read(request).await?;
        let native = self.native(request)?;
        // Gets/terminal history are deterministic. The same live list cache
        // reuses its exact continuation tokens; neither result is normalized.
        assert_eq!(raw, native);
        Ok(raw)
    }

    async fn invalid_cursor(&mut self, request: &Value) -> Result<(), Failure> {
        // Fresh wire and RPC IDs; neither transport duplicate rejection nor a
        // previously correlated error can satisfy this owner-mismatch check.
        let mut request = request.clone();
        request["requestId"] = json!(id(90_000 + u32::try_from(self.next_rpc)?));
        let result = self.invoke(&request).await?;
        assert_eq!(result["isError"], true);
        let error = Self::structured(&result)?;
        self.validation.validate("#/$defs/stockError", &error)?;
        assert_eq!(error["requestId"], request["requestId"]);
        assert_eq!(error["code"], "INVALID_ARGUMENT");
        assert_eq!(error["retry"], "none");
        assert_eq!(error["operationId"], Value::Null);
        assert!(error.get("records").is_none());
        let native = stock_dispatch::execute(
            self.core,
            &RequestPrincipal::new(self.original.clone()),
            request.clone(),
        );
        assert!(matches!(
            native,
            Err(StockError::InvalidContract)
                | Err(StockError::Domain(crate::domain::DomainError::InvalidContract))
        ));
        Ok(())
    }

    async fn foreign_scope(&mut self, request: &Value) -> Result<(), Failure> {
        let result = self.invoke(request).await?;
        assert_eq!(result["isError"], true);
        assert!(result.get("structuredContent").is_none());
        assert_eq!(result["content"].as_array().unwrap().len(), 1);
        assert_eq!(result["content"][0]["type"], "text");
        assert_eq!(result["content"][0]["text"], "not-found: Resource unavailable");
        // This is NativePrincipalPort's scope authorization refusal, not proof
        // that the list-cursor owner was invoked with a foreign scope.
        Ok(())
    }

    fn close(mut self) {
        self.session.close();
    }
}

fn payload(record_id: u32) -> Value {
    json!({"statement":format!("{QUERY} {record_id} α"),
        "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
            "evidenceBasis":"unknown","factAt":null,"retrievedAt":"2026-01-01T12:00:00Z",
            "vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
        "supersedesEvidenceIds":[],"references":[]})
}

fn public_record(record_id: u32, revision: u64, lifecycle: &str, payload: &Value) -> Value {
    json!({"target":target("evidence",record_id),"revision":revision,
        "lifecycle":lifecycle,"payload":payload})
}

async fn cycle(fixture: &Fixture, previous_revision: u64, serial: u32) -> Result<Steps, Failure> {
    let client = fixture.client();
    let mut editor = client.open().await;
    let mut steps = Vec::new();
    for (index, operation, lifecycle) in [(0, "tombstone", "tombstoned"), (1, "restore", "active")]
    {
        let revision = previous_revision + index + 1;
        let intent = command(
            &fixture.context,
            &format!("atlas.evidence.{operation}"),
            target("evidence", PRIMARY),
            json!({}),
            Some(revision - 1),
            vec![],
            serial + index as u32,
        );
        let outcome = client.call(&mut editor, &intent).await;
        assert_eq!(outcome["status"], "committed");
        assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
        assert_eq!(
            outcome["data"]["records"],
            json!([public_record(PRIMARY, revision, lifecycle, &payload(PRIMARY))])
        );
        steps.push((intent, outcome));
    }
    editor.close();
    Ok(steps)
}

async fn seed(fixture: &Fixture, archived: bool) -> Result<(Vec<Value>, Steps), Failure> {
    let client = fixture.client();
    let mut editor = client.open().await;
    let mut records = Vec::new();
    let mut steps = Vec::new();
    for (index, record_id) in [31_003, 31_001, PRIMARY].into_iter().enumerate() {
        let intent = command(
            &fixture.context,
            "atlas.evidence.create",
            target("evidence", record_id),
            payload(record_id),
            None,
            vec![],
            20_000 + index as u32,
        );
        let outcome = client.call(&mut editor, &intent).await;
        let record = public_record(record_id, 1, "active", &payload(record_id));
        assert_eq!(outcome["status"], "committed");
        assert_eq!(outcome["data"]["records"], json!([record]));
        assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
        records.push(record);
        if record_id == PRIMARY {
            steps.push((intent, outcome));
        }
    }
    if archived {
        let intent = command(
            &fixture.context,
            "atlas.evidence.tombstone",
            target("evidence", 31_003),
            json!({}),
            Some(1),
            vec![],
            20_020,
        );
        let outcome = client.call(&mut editor, &intent).await;
        records[0] = public_record(31_003, 2, "tombstoned", &payload(31_003));
        assert_eq!(outcome["data"]["records"], json!([records[0]]));
    }
    editor.close();
    steps.extend(cycle(fixture, 1, 20_010).await?);
    records
        .iter_mut()
        .find(|row| row["target"] == target("evidence", PRIMARY))
        .unwrap()["revision"] = json!(3);
    records.sort_by(|left, right| {
        left["target"]["recordId"]
            .as_str()
            .cmp(&right["target"]["recordId"].as_str())
    });
    Ok((records, steps))
}

fn get(context: &Value, record_id: u32, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.get","requestId":id(serial),
        "context":context,"target":target("evidence",record_id),"payload":{}})
}

fn list(context: &Value, archived: bool, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.list","requestId":id(serial),
        "context":context,"target":{"authority":"atlas","recordType":"evidence"},
        "payload":{"cursor":null,"pageSize":1,"includeArchived":archived,"q":QUERY}})
}

fn history(context: &Value, serial: u32) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.evidence.history","requestId":id(serial),
        "context":context,"target":target("evidence",PRIMARY),
        "payload":{"cursor":null,"pageSize":1,"includeArchived":false,"q":"atlas.evidence."}})
}

fn facts(path: &Path) -> Result<Facts, Failure> {
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut result = BTreeMap::new();
    // Complete factual/commit contents, not counts. History cursor rows are
    // intentionally excluded: successful nonterminal history reads insert them.
    for table in [
        "records",
        "binding_reservations",
        "audits",
        "receipts",
        "batch_receipts",
        "stock_operations",
        "stock_groups",
        "stock_keys",
        "stock_audit_links",
        "stock_history_lookup",
    ] {
        let mut query = database.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let columns = query.column_count();
        let rows = query
            .query_map([], |row| {
                (0..columns)
                    .map(|column| row.get(column))
                    .collect::<Result<Vec<SqlValue>, _>>()
            })?
            .collect::<Result<Vec<_>, _>>()?;
        result.insert(table, rows);
    }
    Ok(result)
}

fn committed_events(path: &Path, steps: &[(Value, Value)]) -> Result<Vec<Value>, Failure> {
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let validation = wire::StockValidation::new()?;
    let mut events: Vec<Value> = Vec::new();
    for (intent, outcome) in steps {
        let audit_id = outcome["data"]["auditIds"][0]
            .as_str()
            .ok_or("Missing committed audit ID")?;
        let event: String = database.query_row(
            "SELECT event_json FROM stock_audit_links WHERE audit_id=?1",
            [audit_id],
            |row| row.get(0),
        )?;
        let audit: String = database.query_row(
            "SELECT body FROM audits WHERE audit_id=?1",
            [audit_id],
            |row| row.get(0),
        )?;
        let event: Value = serde_json::from_str(&event)?;
        let audit: Value = serde_json::from_str(&audit)?;
        let parsed = wire::StockRequest::parse(&validation, intent.clone())?;
        assert_eq!(event["eventId"], audit_id);
        assert_eq!(event["commandId"], intent["commandId"]);
        assert_eq!(event["requestDigest"], parsed.intent_digest());
        assert_eq!(event["actorId"], id(7));
        assert_ne!(event["actorId"], id(5));
        assert_eq!(event["target"], intent["target"]);
        assert_eq!(event["state"], "committed");
        assert_eq!(event["at"], audit["at"]);
        assert_eq!(event["actorId"], audit["actorId"]);
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

async fn list_chain(
    reader: &mut Reader<'_>,
    mut request: Value,
    expected: &[Value],
) -> Result<Vec<Value>, Failure> {
    let mut records = Vec::new();
    let mut tokens = BTreeSet::new();
    for (index, record) in expected.iter().enumerate() {
        request["requestId"] = json!(id(50_000 + index as u32));
        let result = reader.deterministic(&request).await?;
        assert_eq!(result["data"]["sourceStatus"], "current");
        assert_eq!(result["data"]["records"], json!([record]));
        records.push(result["data"]["records"][0].clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 == expected.len() {
            assert_eq!(next, &Value::Null);
        } else {
            let token = next.as_str().ok_or("Missing owner list cursor")?;
            assert!(!token.is_empty());
            assert!(tokens.insert(token.to_owned()));
            request["payload"]["cursor"] = next.clone();
        }
    }
    Ok(records)
}

fn history_equal(left: &Value, right: &Value) {
    let mut left = left.clone();
    let mut right = right.clone();
    let left_cursor = left["data"]
        .as_object_mut()
        .unwrap()
        .remove("nextCursor")
        .unwrap();
    let right_cursor = right["data"]
        .as_object_mut()
        .unwrap()
        .remove("nextCursor")
        .unwrap();
    assert_eq!(left, right);
    assert_eq!(left_cursor.is_null(), right_cursor.is_null());
    if !left_cursor.is_null() {
        assert!(!left_cursor.as_str().unwrap().is_empty());
        assert!(!right_cursor.as_str().unwrap().is_empty());
    }
}

async fn history_chain(
    reader: &mut Reader<'_>,
    mut request: Value,
    mut native_request: Value,
    expected: &[Value],
) -> Result<Vec<Value>, Failure> {
    let mut events = Vec::new();
    let mut mcp_tokens = BTreeSet::new();
    let mut native_tokens = BTreeSet::new();
    for (index, event) in expected.iter().enumerate() {
        request["requestId"] = json!(id(60_000 + index as u32));
        native_request["requestId"] = request["requestId"].clone();
        let left = reader.read(&request).await?;
        let right = reader.native(&native_request)?;
        history_equal(&left, &right);
        assert_eq!(left["data"]["completeness"], "atlas-owned-audit");
        assert_eq!(left["data"]["entries"], json!([event]));
        events.push(left["data"]["entries"][0].clone());
        if index + 1 == expected.len() {
            assert_eq!(left["data"]["nextCursor"], Value::Null);
            assert_eq!(right["data"]["nextCursor"], Value::Null);
            assert_eq!(left, right);
        } else {
            let mcp = left["data"]["nextCursor"]
                .as_str()
                .ok_or("Missing MCP history cursor")?;
            let native = right["data"]["nextCursor"]
                .as_str()
                .ok_or("Missing native history cursor")?;
            assert!(mcp_tokens.insert(mcp.to_owned()));
            assert!(native_tokens.insert(native.to_owned()));
            request["payload"]["cursor"] = json!(mcp);
            native_request["payload"]["cursor"] = json!(native);
        }
    }
    Ok(events)
}

#[tokio::test]
async fn borrowed_viewer_evidence_family_preserves_native_pages_and_audit_disclosure()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let (records, steps) = seed(&fixture, true).await?;
    let expected_events = committed_events(&fixture.database_path(), &steps)?;
    let before = facts(&fixture.database_path())?;
    let viewer = fixture.borrowed_read_principal("login")?;
    let mut reader = Reader::open(fixture.core(), viewer).await?;
    let tools = reader.rpc("tools/list", json!({})).await?;
    assert!(tools.get("error").is_none());
    assert!(tools["result"]["nextCursor"].is_null());
    let tool = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "atlas_records")
        .ok_or("Missing evidence family")?;
    let input = jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .offline()
        .build(&tool["inputSchema"])
        .map_err(|_| "Invalid actual input descriptor")?;
    for request in [
        get(&fixture.context, PRIMARY, 40_000),
        list(&fixture.context, false, 40_001),
        history(&fixture.context, 40_002),
    ] {
        input
            .validate(&request)
            .map_err(|_| "Missing admitted evidence read arm")?;
    }
    // Inspect executable input arms, not canonical output metadata containing
    // other operations. No mutation is invoked through the borrowed reader.
    for (intent, _) in &steps {
        assert!(!input.is_valid(intent));
    }
    for record in &records {
        let record_id = if record["target"] == target("evidence", PRIMARY) {
            PRIMARY
        } else if record["target"] == target("evidence", 31_001) {
            31_001
        } else {
            31_003
        };
        let result = reader
            .deterministic(&get(&fixture.context, record_id, 40_010 + record_id))
            .await?;
        assert_eq!(result["data"]["records"], json!([record]));
        assert_eq!(result["data"]["sourceStatus"], "current");
        assert_eq!(result["data"]["nextCursor"], Value::Null);
        assert_eq!(record["payload"], payload(record_id));
    }
    let active: Vec<_> = records
        .iter()
        .filter(|row| row["lifecycle"] == "active")
        .cloned()
        .collect();
    assert_eq!(active.len(), 2);
    assert_eq!(
        list_chain(&mut reader, list(&fixture.context, false, 40_100), &active).await?,
        active
    );
    assert_eq!(
        list_chain(&mut reader, list(&fixture.context, true, 40_101), &records).await?,
        records
    );
    let request = history(&fixture.context, 40_200);
    assert_eq!(
        history_chain(&mut reader, request.clone(), request, &expected_events).await?,
        expected_events
    );
    assert_eq!(facts(&fixture.database_path())?, before);
    reader.close();
    Ok(())
}

#[tokio::test]
async fn borrowed_evidence_list_cursor_fences_actor_session_query_scope_and_snapshot()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let (records, _) = seed(&fixture, false).await?;
    let before = facts(&fixture.database_path())?;
    let viewer = fixture.borrowed_read_principal("login")?;
    let original_binding = fixture
        .core()
        .access
        .lock()
        .unwrap()
        .authenticated_session_binding(&viewer)?;
    let first_request = list(&fixture.context, false, 41_000);
    let mut reader = Reader::open(fixture.core(), viewer.clone()).await?;
    let first = reader.deterministic(&first_request).await?;
    assert_eq!(first["data"]["records"], json!([records[0]]));
    let mut continuation = first_request.clone();
    continuation["payload"]["cursor"] = first["data"]["nextCursor"].clone();
    assert!(continuation["payload"]["cursor"].is_string());
    let second = reader.deterministic(&continuation).await?;
    assert_eq!(second["data"]["records"], json!([records[1]]));
    reader.close();
    // A new MCP connection with the SAME Access issuance keeps its cursor.
    let mut reader = Reader::open(fixture.core(), viewer.clone()).await?;
    assert_eq!(
        fixture.core().access.lock().unwrap().authenticated_session_binding(&viewer)?,
        original_binding
    );
    assert_eq!(reader.deterministic(&continuation).await?, second);
    // A genuine new login changes the authenticated binding, not just the MCP
    // connection. Existing generated users/grants are reused unchanged.
    let fresh = fixture.borrowed_read_principal("login")?;
    assert_eq!(fresh.actor_id(), viewer.actor_id());
    assert_ne!(
        fixture.core().access.lock().unwrap().authenticated_session_binding(&fresh)?,
        original_binding
    );
    let mut fresh_reader = Reader::open(fixture.core(), fresh).await?;
    fresh_reader.invalid_cursor(&continuation).await?;
    assert_eq!(
        fresh_reader.deterministic(&first_request).await?["data"]["records"],
        json!([records[0]])
    );
    fresh_reader.close();
    let other = fixture.borrowed_read_principal("editorLogin")?;
    assert_ne!(other.actor_id(), viewer.actor_id());
    let mut other_reader = Reader::open(fixture.core(), other).await?;
    other_reader.invalid_cursor(&continuation).await?;
    assert_eq!(
        other_reader.deterministic(&first_request).await?["data"]["records"],
        json!([records[0]])
    );
    other_reader.close();
    for (key, value) in [
        ("q", json!("Synthetic")),
        ("pageSize", json!(2)),
        ("includeArchived", json!(true)),
    ] {
        let mut changed = continuation.clone();
        changed["payload"][key] = value;
        reader.invalid_cursor(&changed).await?;
        assert_eq!(reader.deterministic(&continuation).await?, second);
    }
    let mut foreign = continuation.clone();
    foreign["context"]["homeId"] = json!(id(999_999));
    reader.foreign_scope(&foreign).await?;
    assert_eq!(reader.deterministic(&continuation).await?, second);
    assert_eq!(
        list_chain(&mut reader, first_request.clone(), &records).await?,
        records
    );
    assert_eq!(facts(&fixture.database_path())?, before);
    {
        let client = fixture.client();
        let mut editor = client.open().await;
        let mut outside_payload = payload(31_099);
        outside_payload["statement"] = json!("Outside the selected evidence filter");
        let outside = command(
            &fixture.context,
            "atlas.evidence.create",
            target("evidence", 31_099),
            outside_payload.clone(),
            None,
            vec![],
            22_001,
        );
        let outcome = client.call(&mut editor, &outside).await;
        assert_eq!(outcome["status"], "committed");
        assert_eq!(
            outcome["data"]["records"],
            json!([public_record(31_099, 1, "active", &outside_payload)])
        );
        editor.close();
    }
    let after_change = facts(&fixture.database_path())?;
    assert_ne!(after_change, before);
    // Establish equal selected contents independently of the stale cursor.
    assert_eq!(
        list_chain(&mut reader, first_request.clone(), &records).await?,
        records
    );
    reader.invalid_cursor(&continuation).await?;
    // Full snapshot changed, but the explicitly selected records did not.
    assert_eq!(
        list_chain(&mut reader, first_request, &records).await?,
        records
    );
    assert_eq!(facts(&fixture.database_path())?, after_change);
    reader.close();
    Ok(())
}

#[tokio::test]
async fn borrowed_evidence_history_cursor_preserves_actor_query_watermark_after_reopen()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let (_, mut steps) = seed(&fixture, false).await?;
    let original_events = committed_events(&fixture.database_path(), &steps)?;
    assert_eq!(original_events.len(), 3);
    let before = facts(&fixture.database_path())?;
    let viewer = fixture.borrowed_read_principal("login")?;
    let access = Arc::clone(&fixture.core().access);
    let original_binding = access
        .lock()
        .unwrap()
        .authenticated_session_binding(&viewer)?;
    let request = history(&fixture.context, 42_000);
    let (mcp_cursor, native_cursor) = {
        let mut reader = Reader::open(fixture.core(), viewer.clone()).await?;
        let mcp = reader.read(&request).await?;
        let native = reader.native(&request)?;
        history_equal(&mcp, &native);
        assert_eq!(mcp["data"]["entries"], json!([original_events[0]]));
        let mcp_cursor = mcp["data"]["nextCursor"]
            .as_str()
            .ok_or("Missing saved MCP cursor")?
            .to_owned();
        let native_cursor = native["data"]["nextCursor"]
            .as_str()
            .ok_or("Missing saved native cursor")?
            .to_owned();
        reader.close();
        (mcp_cursor, native_cursor)
    };
    assert_eq!(facts(&fixture.database_path())?, before);
    steps.extend(cycle(&fixture, 3, 21_010).await?);
    let all_events = committed_events(&fixture.database_path(), &steps)?;
    assert_eq!(all_events.len(), 5);
    assert_eq!(&all_events[..3], original_events.as_slice());
    let committed = facts(&fixture.database_path())?;
    assert_ne!(committed, before);
    // All borrowed adapters and Editor sessions are closed/dropped before
    // consuming the fixture. This is NOT Access/process/session restart.
    let fixture = fixture.reopen_existing()?;
    assert!(Arc::ptr_eq(&access, &fixture.core().access));
    assert_eq!(
        access.lock().unwrap().authenticated_session_binding(&viewer)?,
        original_binding
    );
    assert_eq!(facts(&fixture.database_path())?, committed);
    let mut saved = request.clone();
    saved["payload"]["cursor"] = json!(mcp_cursor);
    let mut native_saved = request.clone();
    native_saved["payload"]["cursor"] = json!(native_cursor);
    let mut reader = Reader::open(fixture.core(), viewer.clone()).await?;
    let tail = history_chain(
        &mut reader,
        saved.clone(),
        native_saved.clone(),
        &original_events[1..],
    )
    .await?;
    let mut retained_cut = vec![original_events[0].clone()];
    retained_cut.extend(tail);
    assert_eq!(retained_cut, original_events);
    assert!(
        all_events[3..]
            .iter()
            .all(|event| !retained_cut.contains(event))
    );
    let fresh = fixture.borrowed_read_principal("login")?;
    assert_eq!(fresh.actor_id(), viewer.actor_id());
    assert_ne!(
        access.lock().unwrap().authenticated_session_binding(&fresh)?,
        original_binding
    );
    let mut fresh_reader = Reader::open(fixture.core(), fresh).await?;
    let fresh_tail = history_chain(
        &mut fresh_reader,
        saved.clone(),
        native_saved,
        &original_events[1..],
    )
    .await?;
    assert_eq!(fresh_tail.as_slice(), &original_events[1..]);
    fresh_reader.close();
    let other = fixture.borrowed_read_principal("editorLogin")?;
    assert_ne!(other.actor_id(), viewer.actor_id());
    let mut other_reader = Reader::open(fixture.core(), other).await?;
    other_reader.invalid_cursor(&saved).await?;
    assert_eq!(
        history_chain(&mut other_reader, request.clone(), request.clone(), &all_events).await?,
        all_events
    );
    other_reader.close();
    let mut wrong_target = saved.clone();
    wrong_target["target"] = target("evidence", 31_001);
    reader.invalid_cursor(&wrong_target).await?;
    let mut wrong_query = saved;
    wrong_query["payload"]["q"] = json!("committed");
    reader.invalid_cursor(&wrong_query).await?;
    assert_eq!(
        history_chain(&mut reader, request.clone(), request, &all_events).await?,
        all_events
    );
    let got = reader
        .deterministic(&get(&fixture.context, PRIMARY, 42_100))
        .await?;
    assert_eq!(
        got["data"]["records"],
        json!([public_record(PRIMARY, 5, "active", &payload(PRIMARY))])
    );
    assert_eq!(facts(&fixture.database_path())?, committed);
    reader.close();
    Ok(())
}
