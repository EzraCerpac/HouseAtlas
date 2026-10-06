//! Healthy protocol examples with explicitly stubbed application/access peers.
//! Published fixtures are returned verbatim: no domain mutation, authorization
//! evaluator, database, transport listener or upstream provider is exercised.

use std::{
    future::Future,
    pin::pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::*;

const SCHEMA: &str = include_str!("../../../../packages/contracts/schemas/atlas.schema.json");
const COMMAND: &str =
    include_str!("../../../../packages/contracts/fixtures/create-circuit.mutation.json");
const MUTATION_RESULT: &str =
    include_str!("../../../../packages/contracts/fixtures/create-circuit.result.json");
const EMPTY_HISTORY: &str =
    include_str!("../../../../packages/contracts/history/fixtures/empty.audit-array.json");
const RECORDED_HISTORY: &str =
    include_str!("../../../../packages/contracts/history/fixtures/recorded.audit-array.json");
const TOMBSTONE_HISTORY: &str =
    include_str!("../../../../packages/contracts/history/fixtures/tombstone.audit-array.json");
const HISTORY_SCHEMA: &str =
    include_str!("../../../../packages/contracts/history/http-history.v1.1.0.schema.json");

fn fixture(bytes: &str) -> Value {
    serde_json::from_str(bytes).unwrap()
}
fn object(value: Value) -> JsonObject {
    value.as_object().unwrap().clone()
}
fn scope() -> Scope {
    Scope {
        workspace_id: "00000000-0000-4000-8000-000000000001".into(),
        home_id: "00000000-0000-4000-8000-000000000002".into(),
    }
}
fn target() -> Target {
    Target {
        record_type: "circuit".into(),
        record_id: "00000000-0000-4000-8000-000000000406".into(),
    }
}
fn arguments(command: Option<Value>) -> Value {
    let mut args = json!({
        "scope": {"workspaceId": scope().workspace_id, "homeId": scope().home_id},
        "target": {"recordType": target().record_type, "recordId": target().record_id},
    });
    if let Some(command) = command {
        args.as_object_mut()
            .unwrap()
            .insert("command".into(), command);
    }
    args
}

// These are fixture-only typed peer inputs; AT51 owns canonical generated DTOs.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Scope {
    workspace_id: String,
    home_id: String,
}
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Target {
    record_type: String,
    record_id: String,
}
#[derive(Debug, Deserialize)]
struct Arguments {
    scope: Scope,
    target: Target,
    command: Option<Value>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Catalog,
    Read,
    History,
    Mutate,
}
#[derive(Debug)]
struct Requirement {
    scope: Scope,
    action: Action,
}
struct TrustedContext {
    actor: &'static str,
}
struct FixturePrincipal {
    actor: &'static str,
    action: Action,
}
#[derive(Debug, PartialEq)]
enum Operation {
    Record(Target),
    History(Target),
    Mutation { target: Target, command: Value },
}
enum Output {
    Record(Value),
    History(Value),
    Mutation(Value),
}
type Trace = Arc<Mutex<Vec<Action>>>;
type Calls = Arc<Mutex<Vec<Operation>>>;

struct FixtureAccess {
    trace: Trace,
}
impl PrincipalPort for FixtureAccess {
    type Context = TrustedContext;
    type Principal = FixturePrincipal;
    type Requirement = Requirement;

    fn resolve<'a>(&'a self, context: &'a TrustedContext) -> PortFuture<'a, FixturePrincipal> {
        Box::pin(async move {
            self.trace.lock().unwrap().push(Action::Catalog);
            Ok(FixturePrincipal {
                actor: context.actor,
                action: Action::Catalog,
            })
        })
    }
    fn authorize<'a>(
        &'a self,
        context: &'a TrustedContext,
        requirement: &'a Requirement,
    ) -> PortFuture<'a, FixturePrincipal> {
        Box::pin(async move {
            assert_eq!(requirement.scope, scope());
            self.trace.lock().unwrap().push(requirement.action);
            Ok(FixturePrincipal {
                actor: context.actor,
                action: requirement.action,
            })
        })
    }
    fn revalidate<'a>(
        &'a self,
        context: &'a TrustedContext,
        principal: &'a FixturePrincipal,
    ) -> PortFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(principal.actor, context.actor);
            self.trace.lock().unwrap().push(principal.action);
            Ok(())
        })
    }
}

struct FixtureCatalog;
impl FixtureCatalog {
    fn definition(name: &str, output: &str, mutation: bool) -> ToolDefinition {
        let definitions = fixture(SCHEMA)["$defs"].clone();
        let mut input_schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$defs": definitions,
            "type": "object",
            "properties": {"scope": {"$ref": "#/$defs/scope"}, "target": {"$ref": "#/$defs/recordRef"}},
            "required": ["scope", "target"],
            "additionalProperties": false,
        });
        if mutation {
            input_schema["properties"]["command"] = json!({"$ref": "#/$defs/mutation"});
            input_schema["required"]
                .as_array_mut()
                .unwrap()
                .push(json!("command"));
        }
        let output_schema = if output == "history" {
            let mut history = fixture(HISTORY_SCHEMA);
            history["items"] = json!({"$ref": "#/$defs/audit"});
            json!({"$defs": definitions, "type": "object", "properties": {"data": history}, "required": ["data"], "additionalProperties": false})
        } else {
            json!({"type": "object", "$defs": definitions, "$ref": format!("#/$defs/{output}")})
        };
        ToolDefinition {
            name: name.into(),
            title: None,
            description:
                "Synthetic fixture peer; integration catalog is supplied by the application.".into(),
            input_schema: object(input_schema),
            output_schema: Some(object(output_schema)),
            annotations: Some(ToolAnnotations {
                read_only_hint: Some(!mutation),
                open_world_hint: Some(false),
                ..Default::default()
            }),
        }
    }
}
impl CatalogPort<FixturePrincipal> for FixtureCatalog {
    type Operation = Operation;
    type Output = Output;
    type Requirement = Requirement;

    fn list(
        &self,
        principal: &FixturePrincipal,
        cursor: Option<&str>,
    ) -> Result<ToolPage, PortError> {
        assert_eq!(principal.action, Action::Catalog);
        match cursor {
            None => Ok(ToolPage {
                tools: vec![
                    Self::definition("atlas_get_record", "record", false),
                    Self::definition("atlas_record_history", "history", false),
                ],
                next_cursor: Some("synthetic-catalog-page-2".into()),
            }),
            Some("synthetic-catalog-page-2") => Ok(ToolPage {
                tools: vec![Self::definition(
                    "atlas_mutate_record",
                    "mutationResult",
                    true,
                )],
                next_cursor: None,
            }),
            Some(_) => Err(PortError::InvalidCursor),
        }
    }
    fn prepare(
        &self,
        principal: &FixturePrincipal,
        name: &str,
        arguments: JsonObject,
    ) -> Result<PreparedOperation<Operation, Requirement>, PortError> {
        assert_eq!(principal.action, Action::Catalog);
        // Only fixture deserialization, not canonical schema/semantic validation.
        let args: Arguments =
            serde_json::from_value(Value::Object(arguments)).map_err(|_| PortError::Unavailable)?;
        let (operation, action) = match name {
            "atlas_get_record" => (Operation::Record(args.target), Action::Read),
            "atlas_record_history" => (Operation::History(args.target), Action::History),
            "atlas_mutate_record" => (
                Operation::Mutation {
                    target: args.target,
                    command: args.command.ok_or(PortError::Unavailable)?,
                },
                Action::Mutate,
            ),
            _ => return Err(PortError::UnknownTool),
        };
        Ok(PreparedOperation {
            operation,
            requirement: Requirement {
                scope: args.scope,
                action,
            },
        })
    }
    fn render(&self, _name: &str, output: Output) -> Result<ToolResult, PortError> {
        let value = match output {
            Output::Record(value) | Output::History(value) | Output::Mutation(value) => value,
        };
        Ok(ToolResult::json(value))
    }
}

struct FixtureService {
    calls: Calls,
    history: Value,
}
impl ServicePort<FixturePrincipal, Operation> for FixtureService {
    type Output = Output;
    fn execute<'a>(
        &'a self,
        principal: &'a FixturePrincipal,
        operation: Operation,
    ) -> PortFuture<'a, Output> {
        Box::pin(async move {
            let output = match &operation {
                Operation::Record(requested) => {
                    assert_eq!(*requested, target());
                    assert_eq!(principal.action, Action::Read);
                    Output::Record(fixture(MUTATION_RESULT)["record"].clone())
                }
                Operation::History(requested) => {
                    assert_eq!(*requested, target());
                    assert_eq!(principal.action, Action::History);
                    Output::History(self.history.clone())
                }
                Operation::Mutation {
                    target: requested,
                    command,
                } => {
                    assert_eq!(*requested, target());
                    assert_eq!(principal.action, Action::Mutate);
                    assert_eq!(*command, fixture(COMMAND));
                    Output::Mutation(fixture(MUTATION_RESULT))
                }
            };
            self.calls.lock().unwrap().push(operation);
            Ok(output)
        })
    }
}

type FixtureAdapter = McpAdapter<FixtureAccess, FixtureCatalog, FixtureService>;
fn harness(history: &str) -> (FixtureAdapter, Trace, Calls) {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let adapter = McpAdapter::new(
        FixtureAccess {
            trace: trace.clone(),
        },
        FixtureCatalog,
        FixtureService {
            calls: calls.clone(),
            history: fixture(history),
        },
        AdapterConfig::default(),
    )
    .unwrap();
    (adapter, trace, calls)
}

// Minimal single-thread executor for these ready synthetic peers; no runtime
// dependency, thread spawn, socket, timer or concurrency qualification.
struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}
fn run<T>(future: impl Future<Output = T>) -> T {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => std::thread::park(),
        }
    }
}
fn handle(
    adapter: &FixtureAdapter,
    session: &mut Session<TrustedContext>,
    message: Value,
) -> Option<Value> {
    run(adapter.handle(session, &serde_json::to_vec(&message).unwrap()))
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
}
fn ready(adapter: &FixtureAdapter) -> Session<TrustedContext> {
    let mut session = adapter.open(TrustedContext {
        actor: "verified-synthetic-actor",
    });
    let initialized = handle(adapter, &mut session, json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "synthetic-client", "version": "1"}},
    })).unwrap();
    assert_eq!(initialized["result"]["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(session.state(), SessionState::AwaitingInitialized);
    assert!(
        handle(
            adapter,
            &mut session,
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
        )
        .is_none()
    );
    assert_eq!(session.state(), SessionState::Ready);
    session
}

#[test]
fn healthy_lifecycle_and_host_close() {
    let (adapter, trace, calls) = harness(EMPTY_HISTORY);
    let mut session = adapter.open(TrustedContext {
        actor: "verified-synthetic-actor",
    });
    let pong = handle(
        &adapter,
        &mut session,
        json!({"jsonrpc": "2.0", "id": "pre-init-ping", "method": "ping"}),
    )
    .unwrap();
    assert_eq!(
        pong,
        json!({"jsonrpc": "2.0", "id": "pre-init-ping", "result": {}})
    );
    assert_eq!(session.state(), SessionState::New);
    let initialization = handle(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": "initialize", "method": "initialize", "params": {
                "protocolVersion": PROTOCOL_VERSION, "capabilities": {"roots": {}},
                "clientInfo": {"name": "synthetic-client", "version": "1"},
            },
        }),
    )
    .unwrap();
    assert_eq!(
        initialization["result"]["capabilities"],
        json!({"tools": {}})
    );
    assert_eq!(session.client_info().unwrap().name, "synthetic-client");
    assert_eq!(
        session.client_capabilities().unwrap(),
        &object(json!({"roots": {}}))
    );
    assert!(
        handle(
            &adapter,
            &mut session,
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
        )
        .is_none()
    );
    let pong = handle(
        &adapter,
        &mut session,
        json!({"jsonrpc": "2.0", "id": 9, "method": "ping"}),
    )
    .unwrap();
    assert_eq!(pong["result"], json!({}));
    assert!(trace.lock().unwrap().is_empty());
    assert!(calls.lock().unwrap().is_empty());
    session.close();
    assert_eq!(session.state(), SessionState::Closed);
    assert!(session.client_info().is_none());
}

#[test]
fn healthy_catalog_pages_use_current_principal() {
    let (adapter, trace, calls) = harness(EMPTY_HISTORY);
    let mut session = ready(&adapter);
    let first = handle(
        &adapter,
        &mut session,
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
    )
    .unwrap();
    assert_eq!(first["result"]["tools"][0]["name"], "atlas_get_record");
    assert_eq!(
        first["result"]["tools"][0]["inputSchema"]["$defs"],
        fixture(SCHEMA)["$defs"]
    );
    let second = handle(&adapter, &mut session, json!({
        "jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {"cursor": first["result"]["nextCursor"]},
    })).unwrap();
    assert_eq!(second["result"]["tools"][0]["name"], "atlas_mutate_record");
    assert_eq!(
        second["result"]["tools"][0]["annotations"]["readOnlyHint"],
        false
    );
    assert!(second["result"].get("nextCursor").is_none());
    assert_eq!(*trace.lock().unwrap(), vec![Action::Catalog; 4]);
    assert!(calls.lock().unwrap().is_empty());
}

#[test]
fn healthy_record_and_mutation_fixture_mapping() {
    let (adapter, trace, calls) = harness(EMPTY_HISTORY);
    let mut session = ready(&adapter);
    let record = handle(
        &adapter,
        &mut session,
        json!({
            "jsonrpc": "2.0", "id": "record", "method": "tools/call",
            "params": {"name": "atlas_get_record", "arguments": arguments(None)},
        }),
    )
    .unwrap();
    assert_eq!(
        record["result"]["structuredContent"],
        fixture(MUTATION_RESULT)["record"]
    );
    assert!(record["result"]["structuredContent"]["payload"]["label"].is_null());
    let mutation = handle(&adapter, &mut session, json!({
        "jsonrpc": "2.0", "id": "mutation", "method": "tools/call",
        "params": {"name": "atlas_mutate_record", "arguments": arguments(Some(fixture(COMMAND)))},
    })).unwrap();
    assert_eq!(
        mutation["result"]["structuredContent"],
        fixture(MUTATION_RESULT)
    );
    assert_eq!(mutation["result"]["isError"], false);
    assert_eq!(
        fixture(mutation["result"]["content"][0]["text"].as_str().unwrap()),
        fixture(MUTATION_RESULT)
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Operation::Record(target()),
            Operation::Mutation {
                target: target(),
                command: fixture(COMMAND)
            }
        ]
    );
    assert_eq!(
        *trace.lock().unwrap(),
        vec![
            Action::Catalog,
            Action::Read,
            Action::Read,
            Action::Catalog,
            Action::Mutate,
            Action::Mutate
        ]
    );
}

#[test]
fn healthy_history_fixtures_preserve_bare_array_and_order() {
    for history in [EMPTY_HISTORY, RECORDED_HISTORY, TOMBSTONE_HISTORY] {
        let (adapter, trace, calls) = harness(history);
        let mut session = ready(&adapter);
        let response = handle(
            &adapter,
            &mut session,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "atlas_record_history", "arguments": arguments(None)},
            }),
        )
        .unwrap();
        assert_eq!(
            response["result"]["structuredContent"],
            json!({"data": fixture(history)})
        );
        assert_eq!(
            fixture(response["result"]["content"][0]["text"].as_str().unwrap()),
            json!({"data": fixture(history)})
        );
        assert_eq!(*calls.lock().unwrap(), vec![Operation::History(target())]);
        assert_eq!(
            *trace.lock().unwrap(),
            vec![Action::Catalog, Action::History, Action::History]
        );
    }
}
