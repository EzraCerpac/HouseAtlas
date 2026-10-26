//! Issue #289: deterministic in-process lifecycle controls over real Access,
//! stock dispatch and disposable SQLite. The only test peer delays delivery of
//! an already completed native result; it invents no principal, DTO or receipt.
//! No listener, provider, live credential, runtime configuration or CI setup.
//! These bodies supply evidence only when executed on the exact candidate.

use std::{
    fs,
    future::{Future, poll_fn},
    pin::{Pin, pin},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    task::{Context, Poll, Waker},
};

use serde_json::{Value, json};

use crate::{
    access as a,
    app::{Core, access_scope},
    contracts::stock as wire,
    http::agents::mcp::StockService,
    lifecycle::{self, Failure},
    transports::mcp::{
        AdapterConfig, NativeOperation, NativeOutput, NativePrincipal, NativeSchemas, PortError,
        PortFuture, ServicePort, SessionState,
    },
};

use super::{
    AuthenticatedIdentity, Delivery, NativeSession, NotificationDisposition, rotate_confirmed,
};

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const URL: &str = "https://atlas.synthetic.invalid/api/atlas/v1";

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn observed<'a>(cookie: Option<&'a str>, csrf: Option<&'a str>) -> a::RequestEvidence<'a> {
    a::RequestEvidence {
        method: a::Method::Post,
        url: URL,
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf,
    }
}

struct Fixture {
    // Close the native owners before the disposable directory is removed.
    core: Core,
    _scratch: tempfile::TempDir,
    scope: a::Scope,
    cookie: String,
    csrf: String,
}

impl Fixture {
    fn new() -> Result<Self, Failure> {
        let scratch = tempfile::Builder::new()
            .prefix("houseatlas-agent289-synthetic-")
            .tempdir()?;
        let directory = scratch.path().join("fixture");
        let core = lifecycle::prepare(&directory, ORIGIN)?;
        let scope = access_scope(&core.home.scope)?;
        let receipt: Value =
            serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
        let login_body = serde_json::to_vec(receipt.get("editorLogin").ok_or("Missing login")?)?;
        let login = core.access.lock().unwrap().login(
            &observed(None, None),
            &login_body,
            "agent289-synthetic",
        )?;
        let cookie = login.set_cookie().split(';').next().unwrap().to_owned();
        let csrf = login.info().csrf_token().to_owned();
        // None of the generated credential material is printed or published.
        Ok(Self {
            core,
            _scratch: scratch,
            scope,
            cookie,
            csrf,
        })
    }

    fn authenticate(&self) -> Result<AuthenticatedIdentity, a::AccessError> {
        self.authenticate_with(&self.cookie, &self.csrf)
    }

    fn authenticate_with(
        &self,
        cookie: &str,
        csrf: &str,
    ) -> Result<AuthenticatedIdentity, a::AccessError> {
        AuthenticatedIdentity::authenticate_post(
            Arc::clone(&self.core.access),
            &observed(Some(cookie), Some(csrf)),
            &self.scope,
        )
    }

    fn open(
        &self,
        identity: &AuthenticatedIdentity,
        gate: &Arc<Gate>,
    ) -> NativeSession<HeldStock<'_>> {
        self.open_configured(
            identity,
            gate,
            AdapterConfig::default(),
            &[
                wire::OperationId::AtlasIdentityGet,
                wire::OperationId::AtlasCircuitCreate,
                wire::OperationId::AtlasCircuitHistory,
            ],
        )
    }

    fn open_configured(
        &self,
        identity: &AuthenticatedIdentity,
        gate: &Arc<Gate>,
        config: AdapterConfig,
        admitted: &[wire::OperationId],
    ) -> NativeSession<HeldStock<'_>> {
        let schemas = NativeSchemas::from_bytes(
            include_bytes!("../../../../../contracts/stock-wire3/agent/agent.schema.json"),
            include_bytes!("../../../../../packages/contracts/schemas/atlas.schema.json"),
        )
        .unwrap();
        let mut session = ready(NativeSession::new(
            identity.clone(),
            &schemas,
            admitted.iter().copied(),
            HeldStock {
                stock: StockService { core: &self.core },
                gate: Arc::clone(gate),
            },
            config,
        ))
        .unwrap();
        let init = frame(
            &mut session,
            identity,
            json!({"jsonrpc":"2.0", "id":"init", "method":"initialize", "params":{
                "protocolVersion":super::super::PROTOCOL_VERSION, "capabilities":{},
                "clientInfo":{"name":"Synthetic lifecycle controls", "version":"1"}}}),
        );
        assert_eq!(init["result"]["capabilities"], json!({"tools":{}}));
        assert_eq!(
            ready(session.handle(
                identity,
                br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            ))
            .unwrap(),
            Delivery::Accepted
        );
        session
    }

    fn read(&self) -> Value {
        json!({"schemaVersion":3, "commandId":"atlas.identity.get", "requestId":id(28901),
            "context":self.core.home.scope,
            "target":{"authority":"atlas", "recordType":"identity", "recordId":id(200)},
            "payload":{}})
    }

    fn create(&self, serial: u32) -> Value {
        json!({"schemaVersion":3, "commandId":"atlas.circuit.create", "requestId":id(29000+serial),
            "context":self.core.home.scope,
            "target":{"authority":"atlas", "recordType":"circuit", "recordId":id(29100+serial)},
            "payload":{"label":"Synthetic lifecycle circuit", "panel":null, "evidenceIds":[id(100)]},
            "idempotencyKey":id(29200+serial), "reason":"Synthetic lifecycle attribution",
            "approvalReceiptId":null, "preconditions":{"target":null, "guards":[{
                "target":{"authority":"atlas", "recordType":"evidence", "recordId":id(100)},
                "revision":{"kind":"atlas", "value":1}}]}})
    }
}

#[derive(Default)]
struct Gate {
    dispatches: AtomicUsize,
    reached: AtomicBool,
    released: AtomicBool,
    drained: AtomicBool,
    original_actor: Mutex<Option<String>>,
    owner_wire: Mutex<Option<Value>>,
}

impl Gate {
    fn release(&self) {
        self.released.store(true, Ordering::SeqCst);
    }
}

struct HeldStock<'a> {
    stock: StockService<'a>,
    gate: Arc<Gate>,
}

impl ServicePort<NativePrincipal, NativeOperation> for HeldStock<'_> {
    type Output = NativeOutput;

    fn execute<'a>(
        &'a self,
        principal: &'a NativePrincipal,
        operation: NativeOperation,
    ) -> PortFuture<'a, NativeOutput> {
        Box::pin(async move {
            self.gate.dispatches.fetch_add(1, Ordering::SeqCst);
            *self.gate.original_actor.lock().unwrap() =
                Some(principal.original().actor_id().as_str().to_owned());
            let result = self.stock.execute(principal, operation).await?;
            *self.gate.owner_wire.lock().unwrap() = Some(result.result.wire.clone());
            self.gate.reached.store(true, Ordering::SeqCst);
            // The test polls explicitly on one thread; no timer, thread, IO or
            // executor is needed to expose this exact post-owner/pre-release seam.
            poll_fn(|_| {
                if self.gate.released.load(Ordering::SeqCst) {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            })
            .await;
            self.gate.drained.store(true, Ordering::SeqCst);
            Ok(result)
        })
    }
}

fn poll_once<F: Future>(future: Pin<&mut F>) -> Poll<F::Output> {
    future.poll(&mut Context::from_waker(Waker::noop()))
}

fn ready<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    match poll_once(future.as_mut()) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("Synthetic native operation unexpectedly pending"),
    }
}

fn call(request: Value, rpc_id: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":rpc_id, "method":"tools/call",
        "params":{"name":"atlas_records", "arguments":request}}))
    .unwrap()
}

fn cancellation(rpc_id: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"jsonrpc":"2.0", "method":"notifications/cancelled",
        "params":{"requestId":rpc_id}}))
    .unwrap()
}

fn frame<S>(
    session: &mut NativeSession<S>,
    identity: &AuthenticatedIdentity,
    message: Value,
) -> Value
where
    S: ServicePort<NativePrincipal, NativeOperation, Output = NativeOutput>,
{
    let Delivery::Reply(bytes) =
        ready(session.handle(identity, &serde_json::to_vec(&message).unwrap())).unwrap()
    else {
        panic!("Expected correlated reply");
    };
    let reply: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reply["id"], message["id"]);
    reply
}

#[test]
fn rotation_fences_late_result_old_credentials_and_replacement_identity() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let original = fixture.authenticate()?;
    let current = fixture.authenticate()?;
    let gate = Arc::new(Gate::default());
    let mut session = fixture.open(&original, &gate);
    let control = session.control();
    let bytes = call(fixture.read(), json!("late-read"));
    {
        let mut pending = Box::pin(session.handle(&current, &bytes));
        assert!(poll_once(pending.as_mut()).is_pending());
        assert!(gate.reached.load(Ordering::SeqCst));
        let (replacement, event) = rotate_confirmed(
            Arc::clone(&fixture.core.access),
            &observed(Some(&fixture.cookie), Some(&fixture.csrf)),
        )?;
        assert!(matches!(
            fixture.authenticate(),
            Err(a::AccessError::Unauthenticated)
        ));
        let new_cookie = replacement.set_cookie().split(';').next().unwrap();
        let new_identity =
            fixture.authenticate_with(new_cookie, replacement.info().csrf_token())?;
        assert_eq!(
            original.release_with(&new_identity),
            Err(PortError::Forbidden)
        );
        // Intentionally delay rotation-event delivery: current Access alone must
        // withhold the old result, even though a new session can initialize.
        let fresh_gate = Arc::new(Gate::default());
        fresh_gate.release();
        let mut fresh = fixture.open(&new_identity, &fresh_gate);
        assert!(!fresh.control().on_rotation(&event));
        gate.release();
        assert_eq!(
            poll_once(pending.as_mut()),
            Poll::Ready(Err(PortError::Unauthenticated))
        );
        assert!(gate.drained.load(Ordering::SeqCst));
        drop(pending);
        assert_eq!(
            ready(session.handle(
                &new_identity,
                br#"{"jsonrpc":"2.0","id":"replacement","method":"ping"}"#,
            )),
            Err(PortError::Forbidden)
        );
        let fresh_read: Value = serde_json::from_slice(&call(fixture.read(), json!("new-read")))?;
        assert_eq!(
            frame(&mut fresh, &new_identity, fresh_read)["result"]["structuredContent"]["status"],
            "read"
        );
        assert!(control.on_rotation(&event));
    }
    assert_eq!(session.state(), SessionState::Closed);
    Ok(())
}

#[test]
fn revocation_and_membership_change_withhold_completed_native_reads() -> Result<(), Failure> {
    for revoke_session in [true, false] {
        let fixture = Fixture::new()?;
        let original = fixture.authenticate()?;
        let gate = Arc::new(Gate::default());
        let mut session = fixture.open(&original, &gate);
        let bytes = call(fixture.read(), json!("authority-changed"));
        let mut pending = pin!(session.handle(&original, &bytes));
        assert!(poll_once(pending.as_mut()).is_pending());
        assert!(gate.reached.load(Ordering::SeqCst));
        let expected = {
            let mut boundary = fixture.core.access.lock().unwrap();
            let user = a::CanonicalId::parse(id(6))?;
            if revoke_session {
                boundary.revoke_user_sessions(&user)?;
                PortError::Unauthenticated
            } else {
                boundary.set_membership(&user, &fixture.scope, a::Role::Editor, false)?;
                PortError::Forbidden
            }
        };
        gate.release();
        assert_eq!(poll_once(pending.as_mut()), Poll::Ready(Err(expected)));
        assert!(gate.drained.load(Ordering::SeqCst));
    }
    Ok(())
}

#[test]
fn read_cancellation_preserves_exact_id_and_drains_owner_completion() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let original = fixture.authenticate()?;
    let gate = Arc::new(Gate::default());
    let mut session = fixture.open(&original, &gate);
    let control = session.control();
    let bytes = call(fixture.read(), json!("9"));
    {
        let mut pending = pin!(session.handle(&original, &bytes));
        assert!(poll_once(pending.as_mut()).is_pending());
        assert!(gate.reached.load(Ordering::SeqCst));
        assert_eq!(
            control
                .notification(&original, &cancellation(json!(9)))
                .unwrap(),
            NotificationDisposition::Ignored
        );
        assert_eq!(
            control
                .notification(&original, &cancellation(json!("9")))
                .unwrap(),
            NotificationDisposition::Cancelled
        );
        assert!(poll_once(pending.as_mut()).is_pending());
        assert!(!gate.drained.load(Ordering::SeqCst));
        gate.release();
        assert_eq!(
            poll_once(pending.as_mut()),
            Poll::Ready(Ok(Delivery::Cancelled))
        );
        assert!(gate.drained.load(Ordering::SeqCst));
    }
    assert_eq!(session.state(), SessionState::Ready);
    let duplicate = frame(
        &mut session,
        &original,
        json!({"jsonrpc":"2.0", "id":"9", "method":"ping"}),
    );
    assert_eq!(duplicate["error"]["code"], -32600);
    assert_eq!(
        control
            .notification(&original, &cancellation(json!("9")))
            .unwrap(),
        NotificationDisposition::Ignored
    );
    assert_eq!(
        frame(
            &mut session,
            &original,
            json!({"jsonrpc":"2.0", "id":9, "method":"ping"})
        )["result"],
        json!({})
    );
    Ok(())
}

#[test]
fn cancellation_close_and_future_drop_preserve_committed_audit() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let original = fixture.authenticate()?;
    for (serial, mode) in [(1, "cancel"), (2, "close"), (3, "drop")] {
        let gate = Arc::new(Gate::default());
        let mut session = fixture.open(&original, &gate);
        let control = session.control();
        let request = fixture.create(serial);
        let bytes = call(request.clone(), json!(mode));
        let committed;
        {
            let mut pending = Box::pin(session.handle(&original, &bytes));
            assert!(poll_once(pending.as_mut()).is_pending());
            assert!(gate.reached.load(Ordering::SeqCst));
            committed = gate.owner_wire.lock().unwrap().clone().unwrap();
            assert_eq!(committed["status"], "committed");
            assert_eq!(*gate.original_actor.lock().unwrap(), Some(id(7)));
            assert_eq!(
                control
                    .notification(&original, &cancellation(json!(mode)))
                    .unwrap(),
                NotificationDisposition::Ignored,
                "A write must never become a cancelled read"
            );
            if mode == "close" {
                control.close();
            }
            if mode == "drop" {
                drop(pending);
                assert!(control.is_closed());
                assert!(!gate.drained.load(Ordering::SeqCst));
            } else {
                assert!(poll_once(pending.as_mut()).is_pending());
                gate.release();
                let delivery = match poll_once(pending.as_mut()) {
                    Poll::Ready(Ok(delivery)) => delivery,
                    _ => panic!("Expected completed owner delivery"),
                };
                if mode == "close" {
                    assert_eq!(delivery, Delivery::Closed);
                } else {
                    let Delivery::Reply(reply) = delivery else {
                        panic!("Uncancelled mutation needs its real receipt");
                    };
                    let reply: Value = serde_json::from_slice(&reply)?;
                    assert_eq!(reply["result"]["structuredContent"], committed);
                }
                assert!(gate.drained.load(Ordering::SeqCst));
            }
        }
        assert_eq!(session.state() == SessionState::Closed, mode != "cancel");
        // A fresh protocol session reads the actual durable history. No retry of
        // the mutation is made, and no cancellation/disconnect implies rollback.
        let history_gate = Arc::new(Gate::default());
        history_gate.release();
        let mut fresh = fixture.open(&fixture.authenticate()?, &history_gate);
        let history = json!({"schemaVersion":3, "commandId":"atlas.circuit.history",
            "requestId":id(29300+serial), "context":fixture.core.home.scope,
            "target":request["target"], "payload":{"pageSize":10, "cursor":null,
                "includeArchived":false}});
        let message: Value = serde_json::from_slice(&call(history, json!("history")))?;
        let reply = frame(&mut fresh, &original, message);
        let entries = reply["result"]["structuredContent"]["data"]["entries"]
            .as_array()
            .ok_or("Missing committed history")?;
        assert_eq!(entries.len(), 1);
        let parsed = wire::StockRequest::parse(&wire::StockValidation::new()?, request.clone())?;
        assert_eq!(entries[0]["eventId"], committed["data"]["auditIds"][0]);
        assert_eq!(entries[0]["actorId"], id(7));
        assert_eq!(entries[0]["target"], request["target"]);
        assert_eq!(entries[0]["commandId"], request["commandId"]);
        assert_eq!(entries[0]["requestDigest"], parsed.intent_digest());
        assert_eq!(entries[0]["state"], "committed");
    }
    Ok(())
}

#[test]
fn configured_input_byte_ceiling_accepts_exact_and_closes_one_over() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let original = fixture.authenticate()?;
    let bytes = call(fixture.read(), json!("input-ceiling"));
    let ceiling = bytes.len();
    for extra in [0, 1] {
        let gate = Arc::new(Gate::default());
        gate.release();
        let mut session = fixture.open_configured(
            &original,
            &gate,
            AdapterConfig {
                max_message_bytes: ceiling,
                ..AdapterConfig::default()
            },
            &[
                wire::OperationId::AtlasIdentityGet,
                wire::OperationId::AtlasCircuitCreate,
                wire::OperationId::AtlasCircuitHistory,
            ],
        );
        // Trailing whitespace remains valid JSON; only byte admission differs.
        let mut input = bytes.clone();
        input.extend(std::iter::repeat_n(b' ', extra));
        assert_eq!(input.len(), ceiling + extra);
        let delivery = ready(session.handle(&original, &input)).unwrap();
        if extra == 0 {
            let Delivery::Reply(reply) = delivery else {
                panic!("Exact input ceiling must reach the real read owner");
            };
            let reply: Value = serde_json::from_slice(&reply)?;
            assert_eq!(reply["id"], "input-ceiling");
            assert_eq!(reply["result"]["structuredContent"]["status"], "read");
            assert_eq!(session.state(), SessionState::Ready);
            assert_eq!(gate.dispatches.load(Ordering::SeqCst), 1);
        } else {
            assert_eq!(delivery, Delivery::Closed);
            assert_eq!(session.state(), SessionState::Closed);
            assert_eq!(
                ready(session.handle(&original, &bytes)).unwrap(),
                Delivery::Closed
            );
            assert_eq!(gate.dispatches.load(Ordering::SeqCst), 0);
            assert!(!gate.reached.load(Ordering::SeqCst));
            assert!(gate.owner_wire.lock().unwrap().is_none());
        }
    }
    Ok(())
}

#[test]
fn configured_response_ceiling_preserves_committed_circuit_without_redispatch()
-> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let original = fixture.authenticate()?;
    let gate = Arc::new(Gate::default());
    gate.release();
    let label = "L".repeat(4096);
    let mut request = fixture.create(20);
    request["payload"]["label"] = json!(label);
    let validation = wire::StockValidation::new()?;
    let parsed = wire::StockRequest::parse(&validation, request.clone())?;
    let bytes = call(request.clone(), json!("bounded-create"));
    let input_bound = bytes.len();
    let response_bound = input_bound + 1024;
    let mut session = fixture.open_configured(
        &original,
        &gate,
        AdapterConfig {
            max_message_bytes: input_bound,
            max_response_bytes: response_bound,
            ..AdapterConfig::default()
        },
        &[
            wire::OperationId::AtlasIdentityGet,
            wire::OperationId::AtlasCircuitCreate,
            wire::OperationId::AtlasCircuitHistory,
        ],
    );
    let Delivery::Reply(reply_bytes) = ready(session.handle(&original, &bytes)).unwrap() else {
        panic!("Expected bounded correlated protocol error after owner completion");
    };
    assert!(reply_bytes.len() <= response_bound);
    let reply: Value = serde_json::from_slice(&reply_bytes)?;
    assert_eq!(reply["jsonrpc"], "2.0");
    assert_eq!(reply["id"], "bounded-create");
    assert_eq!(reply["error"]["code"], -32603);
    assert_eq!(
        reply["error"]["message"],
        "MCP response size limit exceeded"
    );
    assert!(reply.get("result").is_none());
    assert_eq!(session.state(), SessionState::Ready);
    assert_eq!(gate.dispatches.load(Ordering::SeqCst), 1);
    let committed = gate.owner_wire.lock().unwrap().clone().unwrap();
    assert_eq!(committed["status"], "committed");
    assert_eq!(committed["replayed"], false);
    assert_eq!(committed["requestId"], request["requestId"]);
    assert_eq!(committed["commandId"], request["commandId"]);
    assert_eq!(committed["resolvedScope"], request["context"]);
    assert_eq!(committed["data"]["records"].as_array().unwrap().len(), 1);
    assert_eq!(committed["data"]["auditIds"].as_array().unwrap().len(), 1);
    assert_eq!(committed["data"]["records"][0]["target"], request["target"]);
    assert_eq!(committed["data"]["requestDigest"], parsed.intent_digest());
    assert_eq!(*gate.original_actor.lock().unwrap(), Some(id(7)));
    // Use the real committed wire and the same ToolResult constructor used by
    // NativeCatalog::render. Measure its complete JSON-RPC envelope, rather than
    // assuming the label alone proves the configured response ceiling exceeded.
    let rendered = super::super::ToolResult::json(committed.clone());
    let owner_reply = json!({"jsonrpc":"2.0", "id":"bounded-create", "result":rendered});
    assert!(serde_json::to_vec(&owner_reply)?.len() > response_bound);
    assert_eq!(committed["data"]["records"][0]["payload"]["label"], label);
    let duplicate: Value = serde_json::from_slice(&call(request.clone(), json!("bounded-create")))?;
    let duplicate = frame(&mut session, &original, duplicate);
    assert_eq!(duplicate["error"]["code"], -32600);
    assert_eq!(gate.dispatches.load(Ordering::SeqCst), 1);
    assert_eq!(*gate.owner_wire.lock().unwrap(), Some(committed.clone()));

    // Independent, default-bounds readback. Only this session adds CircuitGet;
    // the default three-operation fixture profile stays unchanged.
    let readback_gate = Arc::new(Gate::default());
    readback_gate.release();
    let fresh_identity = fixture.authenticate()?;
    let mut fresh = fixture.open_configured(
        &fresh_identity,
        &readback_gate,
        AdapterConfig::default(),
        &[
            wire::OperationId::AtlasIdentityGet,
            wire::OperationId::AtlasCircuitCreate,
            wire::OperationId::AtlasCircuitHistory,
            wire::OperationId::AtlasCircuitGet,
        ],
    );
    let get = json!({"schemaVersion":3, "commandId":"atlas.circuit.get", "requestId":id(29401),
        "context":fixture.core.home.scope, "target":request["target"], "payload":{}});
    let get: Value = serde_json::from_slice(&call(get, json!("durable-get")))?;
    let got = frame(&mut fresh, &fresh_identity, get);
    let got = &got["result"]["structuredContent"];
    assert_eq!(got["resolvedScope"], request["context"]);
    assert_eq!(got["data"]["records"][0], committed["data"]["records"][0]);
    assert_eq!(got["data"]["records"][0]["payload"]["label"], label);
    assert_eq!(got["data"]["records"][0]["revision"], 1);
    let history = json!({"schemaVersion":3, "commandId":"atlas.circuit.history", "requestId":id(29402),
        "context":fixture.core.home.scope, "target":request["target"],
        "payload":{"pageSize":10,"cursor":null,"includeArchived":false}});
    let history: Value = serde_json::from_slice(&call(history, json!("durable-history")))?;
    let history = frame(&mut fresh, &fresh_identity, history);
    let entries = history["result"]["structuredContent"]["data"]["entries"]
        .as_array()
        .ok_or("Missing durable circuit history")?;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["eventId"], committed["data"]["auditIds"][0]);
    assert_eq!(entries[0]["actorId"], id(7));
    assert_eq!(entries[0]["target"], request["target"]);
    assert_eq!(entries[0]["commandId"], request["commandId"]);
    assert_eq!(entries[0]["requestDigest"], parsed.intent_digest());
    assert_eq!(entries[0]["state"], "committed");
    Ok(())
}
