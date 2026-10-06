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
                usage_supported: true,
                runtime: RuntimeSnapshot {
                    kind: RuntimeKind::Hosted,
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
    fn tools(&self, _: &SyntheticContext) -> Result<Vec<ToolDescriptor>, AiError> {
        let schema: Value = serde_json::from_str(SCHEMA).expect("published schema");
        Ok(vec![
            ToolDescriptor {
                name: "getAtlasRecordHistory".into(),
                description: "Read recorded Atlas audit history".into(),
                parameters: schema["$defs"]["recordRef"].clone(),
                effect: ToolEffect::Read,
            },
            ToolDescriptor {
                name: "listRecords".into(),
                description: "Read scoped records".into(),
                parameters: json!({"type":"object","properties":{},"additionalProperties":false}),
                effect: ToolEffect::Read,
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
    let runner = AiRunner {
        connection: &connection,
        inference: &inference,
        catalog: &catalog,
        usage: &usage,
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
