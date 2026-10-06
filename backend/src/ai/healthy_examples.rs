//! Only healthy, offline synthetic examples. No stopped control categories.
use super::*;
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

const SNAPSHOT: &str = include_str!("../../../packages/contracts/fixtures/plan-free.snapshot.json");
const HISTORY: &str =
    include_str!("../../../packages/contracts/history/fixtures/recorded.audit-array.json");
const HISTORY_CONTEXT: &str =
    include_str!("../../../packages/contracts/history/fixtures/contexts.json");
const SCHEMA: &str = include_str!("../../../packages/contracts/schemas/atlas.schema.json");

/// This is a stub peer, not an AT11 principal or catalog adapter.
struct SyntheticContext {
    workspace: String,
    home: String,
}
struct HealthyConnection;
impl ConnectionPort<SyntheticContext> for HealthyConnection {
    fn check<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a str,
        _: &'a Cancellation,
    ) -> PortFuture<'a, ConnectionSnapshot> {
        Box::pin(async {
            Ok(ConnectionSnapshot {
                method: ConnectionMethod::SignInWithChatgpt,
                permission: InferencePermission::Granted,
                eligibility: Eligibility::Unknown,
                authorization: AuthorizationState::Connected,
                account: Some(AccountDisplay {
                    account_id: "synthetic-account".into(),
                    workspace_id: "synthetic-workspace".into(),
                    label: "Synthetic account".into(),
                }),
                paid_use_admission: PaidUseAdmission::VerifiedZeroPaidUse,
                usage_supported: true,
                runtime: RuntimeSnapshot {
                    kind: RuntimeKind::Hosted,
                    route: RuntimeRoute::IssuedWebsiteClient,
                    qualification: RuntimeQualification::Qualified,
                    availability: RuntimeAvailability::Ready,
                    checked_at: Some("2026-10-06T00:00:00Z".into()),
                },
            })
        })
    }
}

struct HealthyCatalog {
    dispatched: Mutex<Vec<String>>,
}
impl DomainCatalog<SyntheticContext> for HealthyCatalog {
    type Prepared = ToolCall;
    fn prepare(&self, _: &SyntheticContext, call: &ToolCall) -> Result<ToolCall, AiError> {
        Ok(call.clone())
    }
    fn effect(&self, _: &ToolCall) -> ToolEffect {
        ToolEffect::Read
    }
    fn review<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a ToolCall,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>> {
        Box::pin(async { Ok(None) })
    }
    fn execute_reviewed<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a ToolCall,
        _: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
    fn tools(&self, _: &SyntheticContext) -> Result<Vec<ToolDescriptor>, AiError> {
        let schema: Value = serde_json::from_str(SCHEMA).expect("published schema");
        Ok(vec![
            ToolDescriptor {
                name: "getAtlasRecordHistory".into(),
                description: "Read recorded Atlas audit history".into(),
                parameters: schema["$defs"]["recordRef"].clone(),
            },
            ToolDescriptor {
                name: "listRecords".into(),
                description: "Read scoped records".into(),
                parameters: json!({"type":"object","properties":{},"additionalProperties":false}),
            },
        ])
    }
    fn execute_read<'a>(
        &'a self,
        context: &'a SyntheticContext,
        call: &'a ToolCall,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Value> {
        Box::pin(async move {
            self.dispatched
                .lock()
                .expect("synthetic catalog")
                .push(call.name.clone());
            let history_context: Value =
                serde_json::from_str(HISTORY_CONTEXT).expect("published fixture");
            assert_eq!(context.workspace, history_context["workspaceId"]);
            assert_eq!(context.home, history_context["homeId"]);
            if call.name == "getAtlasRecordHistory" {
                assert_eq!(call.arguments, history_context["record"]);
                Ok(serde_json::from_str(HISTORY).expect("published history"))
            } else {
                let snapshot: Value =
                    serde_json::from_str(SNAPSHOT).expect("published synthetic snapshot");
                let records = snapshot["records"]
                    .as_array()
                    .expect("records")
                    .iter()
                    .filter(|record| {
                        record["workspaceId"] == context.workspace
                            && record["homeId"] == context.home
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(
                    json!({"contractVersion": snapshot["contractVersion"], "items": records,
                    "nextCursor": null, "sourceStatuses": snapshot["caches"]}),
                )
            }
        })
    }
}

#[derive(Default)]
struct HealthyUsage(Mutex<Vec<Usage>>);
impl UsagePort<SyntheticContext> for HealthyUsage {
    fn observed(&self, _: &SyntheticContext, _: &str, usage: Usage) {
        self.0.lock().expect("synthetic usage").push(usage);
    }
    fn provider_failed(&self, _: &SyntheticContext, _: &str, _: &ProviderDiagnostic) {}
    fn domain_observed(
        &self,
        _: &SyntheticContext,
        _: &str,
        _: &DomainDispatch,
    ) -> Result<(), AiError> {
        Ok(())
    }
}

struct HealthyInference {
    requests: Mutex<Vec<Value>>,
}
impl InferencePort<SyntheticContext> for HealthyInference {
    fn infer<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a str,
        request: &'a ResponsesRequest,
        _: &'a Cancellation,
    ) -> PortFuture<'a, InferenceOutcome> {
        Box::pin(async move {
            let wire = serde_json::to_value(request).expect("request JSON");
            assert_eq!(wire["store"], false);
            assert_eq!(wire["stream"], true);
            assert_eq!(wire["tools"][0]["type"], "namespace");
            assert_eq!(wire["tools"][0]["name"], "houseatlas");
            assert_eq!(
                wire["tools"][0]["tools"][0]["parameters"],
                serde_json::from_str::<Value>(SCHEMA).expect("schema")["$defs"]["recordRef"]
            );
            let mut requests = self.requests.lock().expect("synthetic inference");
            requests.push(wire);
            let output = if requests.len() == 1 {
                let target: Value = serde_json::from_str(HISTORY_CONTEXT).expect("context");
                vec![
                    json!({"type":"reasoning","id":"synthetic-reasoning","encrypted_content":"opaque-synthetic"}),
                    json!({"type":"function_call","namespace":"houseatlas","id":"synthetic-fc1","call_id":"synthetic-call1",
                        "name":"getAtlasRecordHistory","arguments":target["record"].to_string()}),
                    json!({"type":"function_call","namespace":"houseatlas","id":"synthetic-fc2","call_id":"synthetic-call2",
                        "name":"listRecords","arguments":"{}"}),
                ]
            } else {
                let items = request.input();
                assert_eq!(items[1]["encrypted_content"], "opaque-synthetic");
                let history: Value =
                    serde_json::from_str(items[4]["output"].as_str().expect("tool output"))
                        .expect("history JSON");
                assert_eq!(
                    history,
                    serde_json::from_str::<Value>(HISTORY).expect("history")
                );
                assert!(history.is_array());
                let list: Value =
                    serde_json::from_str(items[5]["output"].as_str().expect("list output"))
                        .expect("list JSON");
                assert_eq!(list["contractVersion"], "1.0.0");
                assert!(
                    list["items"]
                        .as_array()
                        .expect("record list")
                        .iter()
                        .all(|r| r["homeId"] == "00000000-0000-4000-8000-000000000002")
                );
                vec![
                    json!({"type":"message","role":"assistant","phase":"final_answer","content":[
                    {"type":"output_text","text":"Recorded circuit history; label remains unknown."} ]}),
                ]
            };
            super::responses::completed_event(&json!({"type":"response.completed","response":{
                "status":"completed","output":output,"usage":{"input_tokens":12,"output_tokens":7,"total_tokens":19}
            }}))
        })
    }
}

// All stub ports above complete immediately. No executor, timers or listeners.
fn ready<F: Future>(future: F) -> F::Output {
    match pin!(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("healthy synthetic ports must complete immediately"),
    }
}

#[test]
fn healthy_published_reads_and_explicit_history() {
    let connection = HealthyConnection;
    let inference = HealthyInference {
        requests: Mutex::new(vec![]),
    };
    let catalog = HealthyCatalog {
        dispatched: Mutex::new(vec![]),
    };
    let usage = HealthyUsage::default();
    let store = HealthyStore;
    let runner = AiRunner {
        connection: &connection,
        inference: &inference,
        catalog: &catalog,
        usage: &usage,
        continuations: &store,
    };
    let context = SyntheticContext {
        workspace: "00000000-0000-4000-8000-000000000001".into(),
        home: "00000000-0000-4000-8000-000000000002".into(),
    };
    let result = ready(runner.run(
        &context,
        "synthetic-selected-model",
        RunInput {
            request_id: "synthetic-request".into(),
            prompt: "Read the recorded circuit history and scoped records.".into(),
        },
        &Cancellation::default(),
        RunLimits::default(),
    ))
    .expect("healthy run");
    assert_eq!(
        result,
        RunOutcome::Completed {
            text: "Recorded circuit history; label remains unknown.".into(),
            usage: Usage {
                input_tokens: Some(24),
                output_tokens: Some(14),
                total_tokens: Some(38)
            }
        }
    );
    assert_eq!(
        *catalog.dispatched.lock().expect("dispatches"),
        ["getAtlasRecordHistory", "listRecords"]
    );
    assert_eq!(usage.0.lock().expect("observations").len(), 2);
}

#[test]
fn healthy_connection_and_browser_dto() {
    let context = SyntheticContext {
        workspace: String::new(),
        home: String::new(),
    };
    let snapshot = ready(HealthyConnection.check(
        &context,
        "synthetic-selected-model",
        &Cancellation::default(),
    ))
    .expect("connection");
    assert!(snapshot.can_infer());
    let wire = serde_json::to_value(snapshot).expect("snapshot JSON");
    assert_eq!(wire["method"], "sign-in-with-chatgpt");
    assert_eq!(wire["runtime"]["checkedAt"], "2026-10-06T00:00:00Z");
    assert_eq!(
        serde_json::to_value(Usage::default()).expect("usage JSON"),
        json!({"inputTokens":null,"outputTokens":null,"totalTokens":null})
    );
    let event = json!({"type":"response.completed","response":{"status":"completed","output":[
        {"type":"message","content":[{"type":"output_text","text":"Synthetic answer"}]} ]}});
    let outcome = super::responses::completed_event(&event).expect("complete event");
    assert!(matches!(
        outcome,
        InferenceOutcome::Completed {
            usage: Usage {
                total_tokens: None,
                ..
            },
            ..
        }
    ));
}

// Historical fixture peer only. Production uses StockCatalog with exact wire3.
// This healthy read path never retains/claims a review or dispatches a mutation.
struct HealthyStore;
impl ReviewContinuationPort<SyntheticContext, ToolCall> for HealthyStore {
    fn retain<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: runner::AiCheckpoint<ToolCall>,
        _: &'a Cancellation,
    ) -> PortFuture<'a, String> {
        Box::pin(async { Err(AiError::InvalidCatalog) })
    }
    fn claim<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a str,
        _: &'a str,
        _: &'a Cancellation,
    ) -> PortFuture<'a, runner::AiCheckpoint<ToolCall>> {
        Box::pin(async { Err(AiError::InvalidCatalog) })
    }
}

/// Exact stock request/result boundary; the synthetic peer is deliberately not
/// a generated validator, authorization service, canonicalizer or database.
struct HealthyStockPeer;
impl stock::SharedStockPort<SyntheticContext> for HealthyStockPeer {
    type Prepared = Value;
    fn projection(&self, _: &SyntheticContext) -> Result<stock::StockCatalogProjection, AiError> {
        // AT51 supplies the production full catalog projection. This example
        // exercises prepare/dispatch only, without inventing 164 metadata arms.
        Err(AiError::InvalidCatalog)
    }
    fn prepare(
        &self,
        context: &SyntheticContext,
        family: stock::StockToolFamily,
        arguments: &Value,
    ) -> Result<stock::AcceptedStockCommand<Value>, AiError> {
        assert_eq!(family, stock::StockToolFamily::AtlasRecords);
        assert_eq!(arguments["commandId"], "atlas.circuit.list");
        assert_eq!(arguments["context"]["workspaceId"], context.workspace);
        assert_eq!(arguments["context"]["homeId"], context.home);
        Ok(stock::AcceptedStockCommand::from_shared(
            stock::StockRequestMetadata {
                family,
                command_id: "atlas.circuit.list".into(),
                request_id: arguments["requestId"]
                    .as_str()
                    .expect("synthetic UUID")
                    .into(),
                // Explicit synthetic peer evidence; not a computed intent/witness.
                request_digest: "synthetic-shared-digest".into(),
                resolved_scope: stock::StockScope {
                    workspace_id: context.workspace.clone(),
                    home_id: context.home.clone(),
                },
                effect: ToolEffect::Read,
            },
            arguments.clone(),
        ))
    }
    fn review<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a Value,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Option<ReviewChallenge>> {
        Box::pin(async { Ok(None) })
    }
    fn execute_read<'a>(
        &'a self,
        context: &'a SyntheticContext,
        request: &'a Value,
        _: &'a Cancellation,
    ) -> PortFuture<'a, Value> {
        Box::pin(async move {
            let snapshot: Value = serde_json::from_str(SNAPSHOT).expect("published snapshot");
            let records: Vec<Value> = snapshot["records"].as_array().expect("records").iter()
                .filter(|r| r["workspaceId"] == context.workspace && r["homeId"] == context.home
                    && r["recordType"] == "circuit")
                .map(|r| json!({"target":{"authority":"atlas","recordType":"circuit","recordId":r["recordId"]},
                    "revision":r["revision"],"lifecycle":r["lifecycle"],"payload":r["payload"]})).collect();
            Ok(
                json!({"schemaVersion":3,"commandId":request["commandId"],"requestId":request["requestId"],
                "resolvedScope":request["context"],"status":"read","replayed":false,
                "data":{"records":records,"nextCursor":null,"sourceStatus":"current"}}),
            )
        })
    }
    fn execute_reviewed<'a>(
        &'a self,
        _: &'a SyntheticContext,
        _: &'a Value,
        _: &'a Cancellation,
    ) -> PortFuture<'a, DomainDispatch> {
        Box::pin(async { Err(AiError::DomainUnavailable) })
    }
}

#[test]
fn healthy_stock_wire3_read_boundary() {
    let context = SyntheticContext {
        workspace: "00000000-0000-4000-8000-000000000001".into(),
        home: "00000000-0000-4000-8000-000000000002".into(),
    };
    let schema: Value = serde_json::from_str(include_str!("fixtures/stock-read-tools.json"))
        .expect("exact narrow schema");
    assert_eq!(
        schema["$defs"]["request_atlas_circuit_list"]["properties"]["schemaVersion"]["const"],
        3
    );
    assert_eq!(stock::STOCK_TOOL_FAMILIES.len(), 10);
    let catalog = stock::StockCatalog::new(HealthyStockPeer);
    let call = ToolCall {
        call_id: "synthetic-stock-call".into(),
        name: "atlas_records".into(),
        arguments: json!({
            "schemaVersion":3,"commandId":"atlas.circuit.list",
            "context":{"workspaceId":context.workspace,"homeId":context.home},
            "target":{"authority":"atlas","recordType":"circuit"},
            "payload":{"cursor":null,"pageSize":100,"includeArchived":false},
            "requestId":"00000000-0000-4000-8000-000000010042"
        }),
    };
    let prepared = catalog
        .prepare(&context, &call)
        .expect("synthetic prepared read");
    assert_eq!(catalog.effect(&prepared), ToolEffect::Read);
    let result = ready(catalog.execute_read(&context, &prepared, &Cancellation::default()))
        .expect("synthetic wire read");
    assert_eq!(result["commandId"], call.arguments["commandId"]);
    assert_eq!(result["requestId"], call.arguments["requestId"]);
    assert_eq!(result["resolvedScope"], call.arguments["context"]);
    assert!(
        result["data"]["records"]
            .as_array()
            .expect("records")
            .iter()
            .all(|r| r["payload"]["label"].is_null())
    );
}

/// Export actual serde DTO bytes for the external TypeScript lifecycle binding.
/// This serializes positive synthetic data; no review, action or grant executes.
#[test]
fn healthy_runtime_wire_projection() {
    let context = SyntheticContext {
        workspace: String::new(),
        home: String::new(),
    };
    let snapshot = ready(HealthyConnection.check(
        &context,
        "synthetic-selected-model",
        &Cancellation::default(),
    ))
    .expect("healthy snapshot");
    let action_id = "00000000-0000-4000-8000-000000020042".to_owned();
    let request = runtime::ConnectionActionRequest {
        action_id: action_id.clone(),
        command: runtime::ConnectionAction::Connect {
            route: RuntimeRoute::IssuedWebsiteClient,
        },
    };
    let pending = runtime::ConnectionActionResult {
        action_id: action_id.clone(),
        status: runtime::ConnectionActionStatus::Pending,
        snapshot: snapshot.clone(),
    };
    let completed = runtime::ConnectionActionResult {
        action_id,
        status: runtime::ConnectionActionStatus::Completed,
        snapshot,
    };
    let review = runtime::HumanReviewResult {
        status: runtime::HumanReviewStatus::ReadyToResume,
    };
    let wire = json!({ "actionRequest": request, "pendingAction": pending, "completedAction": completed, "humanReview": review });
    println!(
        "HOUSEATLAS_AI_HEALTHY_WIRE={}",
        serde_json::to_string(&wire).expect("actual serde wire")
    );
}
