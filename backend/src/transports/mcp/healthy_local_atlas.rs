//! Ordinary positive cases over real Access, native stock and fresh SQLite.
//! All MCP frames run in process. No listener, provider, fake command service,
//! retry/replay, denial, failure injection or other held control is executed.

use crate::{
    access as a,
    app::{Core, ReadAuthority, ServerRuntime, Store, access_scope},
    contracts::stock as wire,
    domain::stock::AtlasListPages,
    http::contracts::NativeContracts,
    lifecycle::{self, Failure},
    media::native::NativeMediaRuntime,
    storage,
};
use serde_json::{Value, json};
use std::{fs, sync::Arc, sync::Mutex};

use super::{
    LocalAtlasSession, PROTOCOL_VERSION, SessionState, bind_local_atlas,
    lifecycle::{AuthenticatedIdentity, Delivery},
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";

#[path = "healthy_evidence_lifecycle.rs"]
mod evidence_lifecycle;

#[path = "healthy_identity.rs"]
mod identity;

#[path = "healthy_infrastructure.rs"]
mod infrastructure;

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn target(kind: &str, n: u32) -> Value {
    json!({"authority":"atlas", "recordType":kind, "recordId":id(n)})
}

fn guard(kind: &str, n: u32) -> Value {
    json!({"target":target(kind,n), "revision":{"kind":"atlas", "value":1}})
}

struct Client<'a> {
    core: &'a Core,
    scope: &'a a::Scope,
    url: &'a str,
    cookie: &'a str,
    csrf: &'a str,
}

impl Client<'_> {
    fn evidence(&self) -> a::RequestEvidence<'_> {
        a::RequestEvidence {
            method: a::Method::Post,
            url: self.url,
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(self.cookie),
            authorization: None,
            csrf: Some(self.csrf),
        }
    }

    async fn frame(&self, session: &mut LocalAtlasSession<'_>, message: Value) -> Value {
        // Actual current POST issuance for every frame, retaining the initial
        // identity through the unchanged lifecycle owner. No credential logs.
        let current = AuthenticatedIdentity::authenticate_post(
            Arc::clone(&self.core.access),
            &self.evidence(),
            self.scope,
        )
        .expect("healthy actual POST issuance");
        assert_eq!(current.original().actor_id().as_str(), id(7));
        assert_eq!(current.original().scope(), self.scope);
        assert_eq!(current.original().role(), a::Role::Editor);
        let delivery = session
            .handle(&current, &serde_json::to_vec(&message).unwrap())
            .await
            .expect("healthy lifecycle delivery");
        if message.get("id").is_none() {
            assert_eq!(delivery, Delivery::Accepted);
            return Value::Null;
        }
        let Delivery::Reply(bytes) = delivery else {
            panic!("healthy request needs a reply");
        };
        let reply: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], message["id"]);
        assert!(reply.get("error").is_none(), "healthy protocol reply");
        reply
    }

    async fn open(&self) -> LocalAtlasSession<'_> {
        let mut session = bind_local_atlas(self.core, &self.evidence(), self.scope)
            .await
            .expect("healthy real local Atlas binding");
        let initialized = self
            .frame(
                &mut session,
                json!({"jsonrpc":"2.0", "id":"initialize", "method":"initialize",
                    "params":{"protocolVersion":PROTOCOL_VERSION, "capabilities":{},
                        "clientInfo":{"name":"AT38 local Atlas positive", "version":"0.1.0"}}}),
            )
            .await;
        assert_eq!(initialized["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(session.state(), SessionState::AwaitingInitialized);
        self.frame(
            &mut session,
            json!({"jsonrpc":"2.0", "method":"notifications/initialized"}),
        )
        .await;
        assert_eq!(session.state(), SessionState::Ready);
        session
    }

    async fn call(&self, session: &mut LocalAtlasSession<'_>, request: &Value) -> Value {
        let operation = wire::OperationId::parse(request["commandId"].as_str().unwrap()).unwrap();
        let family = wire::operation(operation).unwrap().tool_family.as_str();
        let reply = self
            .frame(
                session,
                json!({"jsonrpc":"2.0", "id":request["requestId"], "method":"tools/call",
                    "params":{"name":family, "arguments":request}}),
            )
            .await;
        assert_eq!(
            reply["result"]["isError"], false,
            "healthy native commit/read"
        );
        let raw = reply["result"]["structuredContent"].clone();
        let content = reply["result"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(
            serde_json::from_str::<Value>(content[0]["text"].as_str().unwrap()).unwrap(),
            raw
        );
        assert_eq!(raw["commandId"], request["commandId"]);
        assert_eq!(raw["schemaVersion"], 3);
        assert_eq!(raw["requestId"], request["requestId"]);
        assert_eq!(raw["resolvedScope"], request["context"]);
        assert_eq!(raw["replayed"], false);
        let validation = wire::StockValidation::new().unwrap();
        let parsed = wire::StockRequest::parse(&validation, request.clone()).unwrap();
        if parsed.is_batch() {
            // NativeCatalog already validates the real owner's ordered child
            // envelopes before rendering this root. No child DTO is fabricated.
            validation
                .validate(&parsed.operation().unwrap().output_schema, &raw)
                .unwrap();
        } else {
            wire::StockResponse::parse(&validation, &parsed, raw.clone(), &[]).unwrap();
        }
        if raw["status"] == "committed" {
            assert_eq!(raw["data"]["requestDigest"], parsed.intent_digest());
        }
        raw
    }
}

fn command(
    context: &Value,
    command_id: &str,
    target: Value,
    payload: Value,
    revision: Option<u64>,
    guards: Vec<Value>,
    serial: u32,
) -> Value {
    json!({"schemaVersion":3, "commandId":command_id, "requestId":id(1200+serial),
        "context":context, "target":target, "payload":payload,
        "idempotencyKey":id(1300+serial), "reason":"Healthy in-process local Atlas intent α",
        "approvalReceiptId":null,
        "preconditions":{"target":revision.map(|value|json!({"kind":"atlas", "value":value})),
            "guards":guards}})
}

#[test]
fn healthy_local_atlas_native_mutations_batch_and_reopened_history() -> Result<(), Failure> {
    // This exact single-thread positive runs alone in its test process.
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-at38-local-atlas-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    let scope = access_scope(&core.home.scope)?;
    let context = json!({"workspaceId":core.home.scope.workspace_id,
        "homeId":core.home.scope.home_id});
    let url = format!(
        "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    // Only this disposable fixture's private login receipt is read.
    let (cookie, csrf) = {
        let receipt: Value =
            serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
        let login_body = serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing login")?)?;
        let login_url = format!("{ORIGIN}/api/atlas/auth/login");
        let login = core
            .access
            .lock()
            .map_err(|_| "Access unavailable")?
            .login(
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
                "at38-local-positive",
            )?;
        (
            login
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing cookie")?
                .to_owned(),
            login.info().csrf_token().to_owned(),
        )
    };
    let circuit_payload = json!({"label":null, "panel":null, "evidenceIds":[id(100)]});
    let create = command(
        &context,
        "atlas.circuit.create",
        target("circuit", 920),
        circuit_payload.clone(),
        None,
        vec![guard("evidence", 100)],
        1,
    );
    let binding_payload = json!({"atlasId":id(200),
        "source":{"sourceInstanceId":id(10), "collectionId":"synthetic-collection-a",
            "sourceKind":"homebox-entity", "externalId":id(505)},
        "reviewStatus":"proposed", "evidenceIds":[id(100)]});
    let binding = command(
        &context,
        "atlas.binding.create",
        target("binding", 930),
        binding_payload.clone(),
        None,
        vec![guard("identity", 200), guard("evidence", 100)],
        2,
    );
    // 'rejected' is an ordinary committed review decision, not a denial control.
    let review = command(
        &context,
        "atlas.binding.review",
        target("binding", 930),
        json!({"reviewStatus":"rejected", "evidenceIds":[id(100)]}),
        Some(1),
        vec![guard("identity", 200), guard("evidence", 100)],
        3,
    );
    let child_a = command(
        &context,
        "atlas.circuit.create",
        target("circuit", 921),
        circuit_payload.clone(),
        None,
        vec![guard("evidence", 100)],
        4,
    );
    let child_b = command(
        &context,
        "atlas.circuit.create",
        target("circuit", 922),
        json!({"label":"Synthetic second child", "panel":null, "evidenceIds":[id(100)]}),
        None,
        vec![guard("evidence", 100)],
        5,
    );
    let batch = command(
        &context,
        "atlas.batch.execute",
        json!({"authority":"atlas", "kind":"batch", "batchId":id(1400)}),
        json!({"commands":[child_a.clone(),child_b.clone()]}),
        None,
        vec![guard("evidence", 100)],
        6,
    );
    let outcomes =
        {
            let client = Client {
                core: &core,
                scope: &scope,
                url: &url,
                cookie: &cookie,
                csrf: &csrf,
            };
            let mut session = client.open().await;
            let list = client
                .frame(
                    &mut session,
                    json!({"jsonrpc":"2.0", "id":"list", "method":"tools/list", "params":{}}),
                )
                .await;
            let tools = list["result"]["tools"].as_array().ok_or("Missing tools")?;
            assert!(tools.iter().any(|tool| tool["name"] == "atlas_records"
                && tool["annotations"]["readOnlyHint"] == false));
            let created = client.call(&mut session, &create).await;
            assert_eq!(created["status"], "committed");
            assert_eq!(
                created["data"]["records"][0],
                json!({"target":create["target"],
            "revision":1, "lifecycle":"active", "payload":circuit_payload})
            );
            let bound = client.call(&mut session, &binding).await;
            let mut expected_binding = binding_payload;
            expected_binding["sourceState"] = json!("unresolved");
            assert_eq!(bound["data"]["records"][0]["payload"], expected_binding);
            let reviewed = client.call(&mut session, &review).await;
            expected_binding["reviewStatus"] = json!("rejected");
            assert_eq!(reviewed["data"]["records"][0]["payload"], expected_binding);
            assert_eq!(reviewed["data"]["records"][0]["revision"], 2);
            let batched = client.call(&mut session, &batch).await;
            assert_eq!(batched["status"], "committed");
            let records = batched["data"]["records"]
                .as_array()
                .ok_or("Missing batch records")?;
            assert_eq!(records.len(), 2);
            for (record, child) in records.iter().zip([&child_a, &child_b]) {
                assert_eq!(record["target"], child["target"]);
                assert_eq!(record["payload"], child["payload"]);
                assert_eq!(record["revision"], 1);
            }
            assert_eq!(batched["data"]["auditIds"].as_array().unwrap().len(), 2);
            session.close();
            assert_eq!(session.state(), SessionState::Closed);
            vec![created, bound, reviewed, batched]
        };
    // Close the real native Store, then reopen that same SQLite file strictly.
    // This is ordinary readback of the healthy commits, not restore or replay.
    let Core {
        access,
        store,
        vault,
        home,
        homes,
        ..
    } = core;
    Arc::try_unwrap(store)
        .map_err(|_| "Store retained")?
        .into_inner()
        .map_err(|_| "Store unavailable")?
        .close()?;
    let reopened = Store::open(
        directory.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )?;
    let core = Core {
        access,
        store: Arc::new(Mutex::new(reopened)),
        vault,
        home,
        homes,
        atlas_list_pages: AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
    };
    {
        let client = Client {
            core: &core,
            scope: &scope,
            url: &url,
            cookie: &cookie,
            csrf: &csrf,
        };
        let mut session = client.open().await;
        for (serial, kind, record_id, expected) in [
            (1, "circuit", 920, &outcomes[0]["data"]["records"][0]),
            (2, "binding", 930, &outcomes[2]["data"]["records"][0]),
            (3, "circuit", 921, &outcomes[3]["data"]["records"][0]),
            (4, "circuit", 922, &outcomes[3]["data"]["records"][1]),
        ] {
            let read = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.get"),
                "requestId":id(1500+serial),"context":context,"target":target(kind,record_id),"payload":{}});
            let got = client.call(&mut session, &read).await;
            assert_eq!(got["status"], "read");
            assert_eq!(&got["data"]["records"][0], expected);
        }
        for (serial, kind, record_id, intent, audit_id) in [
            (
                11,
                "circuit",
                920,
                &create,
                &outcomes[0]["data"]["auditIds"][0],
            ),
            (
                12,
                "binding",
                930,
                &binding,
                &outcomes[1]["data"]["auditIds"][0],
            ),
            (
                13,
                "binding",
                930,
                &review,
                &outcomes[2]["data"]["auditIds"][0],
            ),
            (
                14,
                "circuit",
                921,
                &child_a,
                &outcomes[3]["data"]["auditIds"][0],
            ),
            (
                15,
                "circuit",
                922,
                &child_b,
                &outcomes[3]["data"]["auditIds"][1],
            ),
        ] {
            let history = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.history"),
                "requestId":id(1500+serial),"context":context,"target":target(kind,record_id),
                "payload":{"pageSize":10,"cursor":null,"includeArchived":false,
                    "q":intent["commandId"]}});
            let got = client.call(&mut session, &history).await;
            assert_eq!(got["data"]["completeness"], "atlas-owned-audit");
            let entries = got["data"]["entries"].as_array().ok_or("Missing history")?;
            assert_eq!(entries.len(), 1);
            let parsed = wire::StockRequest::parse(&wire::StockValidation::new()?, intent.clone())?;
            assert_eq!(&entries[0]["eventId"], audit_id);
            assert_eq!(entries[0]["commandId"], intent["commandId"]);
            assert_eq!(entries[0]["requestDigest"], parsed.intent_digest());
            assert_eq!(entries[0]["actorId"], id(7));
            assert_eq!(entries[0]["state"], "committed");
            assert_eq!(entries[0]["target"], intent["target"]);
        }
        // Page the two already committed binding events through the actual
        // authenticated MCP owner. The second frame carries its returned opaque
        // cursor with the same target and query; no event or cursor is fabricated.
        let first_history = json!({"schemaVersion":3,"commandId":"atlas.binding.history",
            "requestId":id(1521),"context":context,"target":target("binding",930),
            "payload":{"pageSize":1,"cursor":null,"includeArchived":false,
                "q":"atlas.binding."}});
        let first = client.call(&mut session, &first_history).await;
        let cursor = first["data"]["nextCursor"]
            .as_str()
            .ok_or("Healthy MCP history continuation required")?
            .to_owned();
        let mut second_history = first_history.clone();
        second_history["requestId"] = json!(id(1522));
        second_history["payload"]["cursor"] = json!(cursor);
        let second = client.call(&mut session, &second_history).await;
        for (page, intent, audit_id) in [
            (&first, &binding, &outcomes[1]["data"]["auditIds"][0]),
            (&second, &review, &outcomes[2]["data"]["auditIds"][0]),
        ] {
            assert_eq!(page["status"], "read");
            assert_eq!(page["data"]["completeness"], "atlas-owned-audit");
            let entries = page["data"]["entries"]
                .as_array()
                .ok_or("Missing paged MCP history")?;
            assert_eq!(entries.len(), 1);
            let parsed = wire::StockRequest::parse(&wire::StockValidation::new()?, intent.clone())?;
            assert_eq!(&entries[0]["eventId"], audit_id);
            assert_eq!(entries[0]["commandId"], intent["commandId"]);
            assert_eq!(entries[0]["requestDigest"], parsed.intent_digest());
            assert_eq!(entries[0]["actorId"], id(7));
            assert_eq!(entries[0]["state"], "committed");
            assert_eq!(entries[0]["target"], intent["target"]);
        }
        assert_eq!(second["data"]["nextCursor"], Value::Null);
        session.close();
    }
    drop(core);
    scratch.close()?;
    Ok(())
}

#[test]
fn healthy_native_evidence_create_pages_get_and_reopened_history() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy_evidence_pages())
}

async fn evidence_pages(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.evidence.list",
        "requestId":id(first_request_id),"context":context,
        "target":{"authority":"atlas","recordType":"evidence"},
        "payload":{"pageSize":2,"cursor":null,"includeArchived":false,
            "q":"Synthetic MCP evidence traversal"}});
    let mut records = Vec::new();
    // Exactly three matching fictional records: two pages, then owner EOF.
    // No cursor is decoded, synthesized, reused after reopen or inferred.
    let first = client.call(session, &request).await;
    assert_eq!(first["status"], "read");
    assert_eq!(first["data"]["sourceStatus"], "current");
    let page = first["data"]["records"]
        .as_array()
        .ok_or("Missing first evidence page")?;
    assert_eq!(page.len(), 2);
    records.extend(page.iter().cloned());
    let cursor = first["data"]["nextCursor"]
        .as_str()
        .ok_or("Native evidence continuation required")?;
    assert!(!cursor.is_empty());
    request["requestId"] = json!(id(first_request_id + 1));
    request["payload"]["cursor"] = json!(cursor);
    let second = client.call(session, &request).await;
    assert_eq!(second["status"], "read");
    assert_eq!(second["data"]["sourceStatus"], "current");
    let page = second["data"]["records"]
        .as_array()
        .ok_or("Missing final evidence page")?;
    assert_eq!(page.len(), 1);
    records.extend(page.iter().cloned());
    assert_eq!(second["data"]["nextCursor"], Value::Null);
    assert_eq!(
        records
            .iter()
            .map(|record| record["target"]["recordId"].clone())
            .collect::<Vec<_>>(),
        vec![json!(id(940)), json!(id(950)), json!(id(960))]
    );
    Ok(records)
}

async fn evidence_readback(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &[(Value, Value)],
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut histories = Vec::new();
    let validation = wire::StockValidation::new()?;
    for (index, (intent, outcome)) in expected.iter().enumerate() {
        let request_id = first_request_id + 2 * index as u32;
        let get = json!({"schemaVersion":3,"commandId":"atlas.evidence.get",
            "requestId":id(request_id),"context":context,
            "target":intent["target"],"payload":{}});
        let got = client.call(session, &get).await;
        assert_eq!(got["status"], "read");
        assert_eq!(got["data"]["records"].as_array().unwrap().len(), 1);
        assert_eq!(got["data"]["records"][0], outcome["data"]["records"][0]);
        // Full payload equality distinguishes explicit null from missing keys.
        assert_eq!(got["data"]["records"][0]["payload"], intent["payload"]);
        assert_eq!(
            got["data"]["records"][0]["payload"]["provenance"]["uncertainty"]["status"],
            "unknown"
        );
        let history = json!({"schemaVersion":3,"commandId":"atlas.evidence.history",
            "requestId":id(request_id + 1),"context":context,"target":intent["target"],
            "payload":{"pageSize":1,"cursor":null,"includeArchived":false,
                "q":"atlas.evidence.create"}});
        let got = client.call(session, &history).await;
        assert_eq!(got["status"], "read");
        assert_eq!(got["data"]["completeness"], "atlas-owned-audit");
        let entries = got["data"]["entries"]
            .as_array()
            .ok_or("Missing native evidence history")?;
        assert_eq!(entries.len(), 1);
        assert_eq!(got["data"]["nextCursor"], Value::Null);
        let parsed = wire::StockRequest::parse(&validation, intent.clone())?;
        assert_eq!(entries[0]["eventId"], outcome["data"]["auditIds"][0]);
        assert_eq!(entries[0]["commandId"], intent["commandId"]);
        assert_eq!(entries[0]["requestDigest"], parsed.intent_digest());
        assert_eq!(entries[0]["actorId"], id(7));
        assert_eq!(entries[0]["state"], "committed");
        assert_eq!(entries[0]["target"], intent["target"]);
        histories.push(got["data"].clone());
    }
    Ok(histories)
}

async fn healthy_evidence_pages() -> Result<(), Failure> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-mcp288-evidence-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let core = lifecycle::prepare(&directory, ORIGIN)?;
    let scope = access_scope(&core.home.scope)?;
    let context = json!({"workspaceId":core.home.scope.workspace_id,
        "homeId":core.home.scope.home_id});
    let url = format!(
        "{ORIGIN}/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let (cookie, csrf) = {
        let receipt: Value =
            serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
        let login_body = serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing login")?)?;
        let login_url = format!("{ORIGIN}/api/atlas/auth/login");
        let login = core
            .access
            .lock()
            .map_err(|_| "Access unavailable")?
            .login(
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
                "mcp288-evidence-positive",
            )?;
        (
            login
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing cookie")?
                .to_owned(),
            login.info().csrf_token().to_owned(),
        )
    };
    let mut expected = Vec::new();
    let (before_records, before_histories) = {
        let client = Client {
            core: &core,
            scope: &scope,
            url: &url,
            cookie: &cookie,
            csrf: &csrf,
        };
        let mut session = client.open().await;
        // Deliberately create out of order. Native list sorting must supply
        // canonical identity order independently of commit/insertion order.
        for (serial, record_id) in [960, 940, 950].into_iter().enumerate() {
            let payload = json!({"statement":format!(
                    "Synthetic MCP evidence traversal {record_id} α"),
                "provenance":{"source":null,"sourceRevision":null,
                    "sourceConfidence":null,"evidenceBasis":"unknown","factAt":null,
                    "retrievedAt":"2026-01-01T12:00:00Z","vantage":null,
                    "uncertainty":{"status":"unknown","explanation":null}},
                "supersedesEvidenceIds":[],"references":[]});
            let intent = command(
                &context,
                "atlas.evidence.create",
                target("evidence", record_id),
                payload.clone(),
                None,
                vec![],
                100 + serial as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            assert_eq!(outcome["status"], "committed");
            assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
            assert_eq!(
                outcome["data"]["records"],
                json!([{"target":intent["target"],"revision":1,
                    "lifecycle":"active","payload":payload}])
            );
            expected.push((intent, outcome));
        }
        expected.sort_by(|left, right| {
            left.0["target"]["recordId"]
                .as_str()
                .cmp(&right.0["target"]["recordId"].as_str())
        });
        let records = evidence_pages(&client, &mut session, &context, 1700).await?;
        let expected_records: Vec<_> = expected
            .iter()
            .map(|(_, outcome)| outcome["data"]["records"][0].clone())
            .collect();
        assert_eq!(records, expected_records);
        let histories = evidence_readback(&client, &mut session, &context, &expected, 1710).await?;
        session.close();
        (records, histories)
    };
    // Strictly close/reopen the real SQLite owner. Access is retained; this is
    // store readback, not a claim about process restart or installed credentials.
    let Core {
        access,
        store,
        vault,
        home,
        homes,
        ..
    } = core;
    Arc::try_unwrap(store)
        .map_err(|_| "Store retained")?
        .into_inner()
        .map_err(|_| "Store unavailable")?
        .close()?;
    let reopened = Store::open(
        directory.join("atlas.sqlite"),
        NativeContracts,
        ReadAuthority(Arc::clone(&access)),
        NativeMediaRuntime {
            vault: Arc::clone(&vault),
            server: ServerRuntime,
        },
        storage::StoreOptions::default(),
    )?;
    let core = Core {
        access,
        store: Arc::new(Mutex::new(reopened)),
        vault,
        home,
        homes,
        atlas_list_pages: AtlasListPages::default(),
        media_policy_evidence: Mutex::default(),
    };
    {
        let client = Client {
            core: &core,
            scope: &scope,
            url: &url,
            cookie: &cookie,
            csrf: &csrf,
        };
        let mut session = client.open().await;
        // Start a fresh complete cursor chain on the reopened owner.
        assert_eq!(
            evidence_pages(&client, &mut session, &context, 1800).await?,
            before_records
        );
        assert_eq!(
            evidence_readback(&client, &mut session, &context, &expected, 1810).await?,
            before_histories
        );
        session.close();
    }
    drop(core);
    scratch.close()?;
    Ok(())
}
