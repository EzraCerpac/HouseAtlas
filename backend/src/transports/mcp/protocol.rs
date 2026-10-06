use std::fmt;

use serde::{
    Deserialize, Serialize,
    de::{self, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Map, Value};

pub const PROTOCOL_VERSION: &str = "2025-11-25";
pub type JsonObject = Map<String, Value>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Implementation {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    /// A schema object from the canonical catalog; the adapter never fetches refs.
    pub input_schema: JsonObject,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<JsonObject>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<ToolAnnotations>,
}

/// Descriptive MCP hints only; they never grant mutation or provider authority.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotations {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_world_hint: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPage {
    pub tools: Vec<ToolDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TextContent {
    #[serde(rename = "type")]
    kind: &'static str,
    pub text: String,
}

impl TextContent {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            kind: "text",
            text: text.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub content: Vec<TextContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<JsonObject>,
    pub is_error: bool,
}

impl ToolResult {
    /// Object DTOs remain intact. MCP requires structuredContent to be an object,
    /// so a bare array/scalar becomes {"data": value}. TextContent serializes
    /// the same object. A catalog outputSchema must describe that MCP wrapper.
    pub fn json(value: Value) -> Self {
        let structured_content = match value {
            Value::Object(object) => object,
            other => Map::from_iter([("data".into(), other)]),
        };
        let text = TextContent::new(Value::Object(structured_content.clone()).to_string());
        Self {
            content: vec![text],
            structured_content: Some(structured_content),
            is_error: false,
        }
    }

    pub(crate) fn failure(failure: super::PublicToolFailure) -> Self {
        let data = failure.data.map(Value::Object).unwrap_or_else(|| {
            serde_json::json!({
                "code": failure.code, "message": failure.message
            })
        });
        let mut result = Self::json(data);
        result.is_error = true;
        result
    }
}

/// Preserve the canonical contract's syntactic duplicate-key rule before any
/// MCP/domain value becomes a map. serde_json::Value otherwise keeps the last
/// occurrence, which canonical peers could no longer detect. No domain policy
/// is implemented here. serde_json's default nesting bound still applies.
struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueValue;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("JSON with unique object keys")
            }
            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Bool(value)))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueValue(Value::Number(number)))
                    .ok_or_else(|| E::custom("Invalid JSON number"))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::String(value.into())))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::String(value)))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }
            fn visit_seq<S: SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element::<UniqueValue>()? {
                    values.push(value.0);
                }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_map<M: MapAccess<'de>>(self, mut object: M) -> Result<Self::Value, M::Error> {
                let mut values = Map::new();
                while let Some(key) = object.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(de::Error::custom("Duplicate JSON key"));
                    }
                    values.insert(key, object.next_value::<UniqueValue>()?.0);
                }
                Ok(UniqueValue(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(untagged)]
pub(crate) enum RequestId {
    Text(String),
    Integer(i128),
}

pub(crate) struct Message {
    pub id: Option<RequestId>,
    pub method: String,
    pub params: JsonObject,
}

pub(crate) struct ProtocolError {
    pub id: Option<RequestId>,
    pub code: i32,
    pub message: &'static str,
    pub notification: bool,
}

impl ProtocolError {
    pub fn new(id: Option<RequestId>, code: i32, message: &'static str) -> Self {
        Self {
            id,
            code,
            message,
            notification: false,
        }
    }
}

pub(crate) fn decode(bytes: &[u8]) -> Result<Message, ProtocolError> {
    let value = serde_json::from_slice::<UniqueValue>(bytes)
        .map_err(|_| ProtocolError::new(None, -32700, "Parse error"))?
        .0;
    let Value::Object(mut envelope) = value else {
        return Err(ProtocolError::new(
            None,
            -32600,
            "Expected one MCP message object",
        ));
    };
    let has_id = envelope.contains_key("id");
    let id = match envelope.remove("id") {
        None => None,
        Some(Value::String(id)) => Some(RequestId::Text(id)),
        Some(Value::Number(id)) if id.is_i64() || id.is_u64() => Some(RequestId::Integer(
            id.as_i64()
                .map(i128::from)
                .unwrap_or_else(|| i128::from(id.as_u64().unwrap())),
        )),
        Some(_) => return Err(ProtocolError::new(None, -32600, "Invalid MCP request ID")),
    };
    if envelope.remove("jsonrpc") != Some(Value::String("2.0".into())) {
        return Err(ProtocolError::new(id, -32600, "Invalid JSON-RPC version"));
    }
    let Some(Value::String(method)) = envelope.remove("method") else {
        return Err(ProtocolError::new(
            id,
            -32600,
            "Expected an MCP request or notification",
        ));
    };
    let params = match envelope.remove("params") {
        None => Map::new(),
        Some(Value::Object(params)) => params,
        Some(_) => {
            let mut error = ProtocolError::new(id, -32602, "Expected object parameters");
            error.notification = !has_id;
            return Err(error);
        }
    };
    if params.get("_meta").is_some_and(|value| !value.is_object()) {
        let mut error = ProtocolError::new(id, -32602, "Expected object metadata");
        error.notification = !has_id;
        return Err(error);
    }
    Ok(Message { id, method, params })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeParams {
    pub protocol_version: String,
    pub capabilities: JsonObject,
    pub client_info: Implementation,
}

#[derive(Deserialize)]
pub(crate) struct ListParams {
    pub cursor: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct CallParams {
    pub name: String,
    #[serde(default)]
    pub arguments: JsonObject,
}

pub(crate) fn result(id: &RequestId, result: Value) -> Value {
    serde_json::json!({"jsonrpc": "2.0", "id": id, "result": result})
}

pub(crate) fn error(id: Option<&RequestId>, code: i32, message: &'static str) -> Value {
    let mut response =
        serde_json::json!({"jsonrpc": "2.0", "error": {"code": code, "message": message}});
    if let Some(id) = id {
        response
            .as_object_mut()
            .unwrap()
            .insert("id".into(), serde_json::to_value(id).unwrap());
    }
    response
}
