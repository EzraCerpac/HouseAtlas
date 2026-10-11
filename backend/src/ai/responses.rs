//! Credential-free subset of the official SIWC HTTP Responses contract.
use super::{AiError, InferenceOutcome, ToolCall, ToolDescriptor, Usage};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const TOOL_NAMESPACE: &str = "houseatlas";

/// Fields are private so callers cannot enable storage/background mode or
/// accidentally add unsupported SIWC parameters. The model comes from the host's
/// verified selected-account model catalog, never a hard-coded consumer tier.
#[derive(Debug, Clone, Serialize)]
pub struct ResponsesRequest {
    model: String,
    input: Vec<Value>,
    tools: Vec<Value>,
    store: bool,
    stream: bool,
}

impl ResponsesRequest {
    pub fn new(model: &str, input: Vec<Value>, tools: &[ToolDescriptor]) -> Result<Self, AiError> {
        if model.trim().is_empty()
            || model.len() > 256
            || input.is_empty()
            || input.iter().any(|item| {
                !item.is_object() || item.get("role").and_then(Value::as_str) == Some("system")
            })
        {
            return Err(AiError::InvalidInput);
        }
        let functions = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function", "name": tool.name, "description": tool.description,
                    // Preserve canonical optional/nullable fields. The catalog performs
                    // full validation; do not rewrite a domain schema to force strictness.
                    "parameters": tool.parameters, "strict": false
                })
            })
            .collect::<Vec<_>>();
        let tools = if functions.is_empty() {
            vec![]
        } else {
            vec![json!({
                "type": "namespace", "name": TOOL_NAMESPACE,
                "description": "Authorized HouseAtlas operations", "tools": functions
            })]
        };
        Ok(Self {
            model: model.to_owned(),
            input,
            tools,
            store: false,
            stream: true,
        })
    }
    pub fn input(&self) -> &[Value] {
        &self.input
    }
}

/// Decode only a complete terminal event, after the transport has enforced its
/// byte/deadline limits. Deltas and tool-argument done events are insufficient.
pub fn completed_event(event: &Value) -> Result<InferenceOutcome, AiError> {
    if event.get("type").and_then(Value::as_str) != Some("response.completed") {
        return Err(AiError::InvalidProviderOutput);
    }
    let response = event
        .get("response")
        .ok_or(AiError::InvalidProviderOutput)?;
    if response.get("status").and_then(Value::as_str) != Some("completed") {
        return Err(AiError::InvalidProviderOutput);
    }
    let output = response
        .get("output")
        .and_then(Value::as_array)
        .ok_or(AiError::InvalidProviderOutput)?
        .clone();
    if output.iter().any(|item| !item.is_object()) {
        return Err(AiError::InvalidProviderOutput);
    }
    let usage = match response.get("usage").filter(|value| !value.is_null()) {
        Some(value) => {
            #[derive(Deserialize)]
            struct WireUsage {
                input_tokens: Option<u64>,
                output_tokens: Option<u64>,
                total_tokens: Option<u64>,
            }
            let wire: WireUsage = serde_json::from_value(value.clone())
                .map_err(|_| AiError::InvalidProviderOutput)?;
            Usage {
                input_tokens: wire.input_tokens,
                output_tokens: wire.output_tokens,
                total_tokens: wire.total_tokens,
            }
        }
        None => Usage::default(),
    };
    Ok(InferenceOutcome::Completed { output, usage })
}

pub(crate) fn tool_calls(output: &[Value]) -> Result<Vec<ToolCall>, AiError> {
    output
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .map(|item| {
            if item.get("namespace").and_then(Value::as_str) != Some(TOOL_NAMESPACE) {
                return Err(AiError::UnknownTool);
            }
            let required = |key| {
                item.get(key)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .ok_or(AiError::InvalidProviderOutput)
            };
            Ok(ToolCall {
                call_id: required("call_id")?.to_owned(),
                name: required("name")?.to_owned(),
                arguments: serde_json::from_str(required("arguments")?)
                    .map_err(|_| AiError::InvalidProviderOutput)?,
            })
        })
        .collect()
}

pub(crate) fn output_text(output: &[Value]) -> String {
    output
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter_map(|part| match part.get("type").and_then(Value::as_str) {
            Some("output_text") => part.get("text").and_then(Value::as_str),
            Some("refusal") => part.get("refusal").and_then(Value::as_str),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn tool_output(call: &ToolCall, value: Value) -> Result<Value, AiError> {
    let output = serde_json::to_string(&value).map_err(|_| AiError::DomainUnavailable)?;
    Ok(json!({ "type": "function_call_output", "call_id": call.call_id, "output": output }))
}
