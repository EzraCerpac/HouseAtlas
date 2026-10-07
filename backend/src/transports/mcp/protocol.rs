use std::fmt;

use serde::{
    Deserialize, Serialize,
    de::{self, MapAccess, Visitor},
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
        match failure.data {
            Some(data) => {
                let mut result = Self::json(Value::Object(data));
                result.is_error = true;
                result
            }
            None => Self {
                content: vec![TextContent::new(format!(
                    "{}: {}",
                    failure.code, failure.message
                ))],
                structured_content: None,
                is_error: true,
            },
        }
    }
}

/// Decode JSON syntax without serde_json's private arbitrary-precision map
/// representation. Actual number tokens remain Numbers; literal similarly named
/// object keys remain object keys. Duplicate keys and nesting are checked before
/// a domain value becomes a map.
struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = <&serde_json::value::RawValue>::deserialize(deserializer)?;
        parse_unique(raw, 0).map(Self).map_err(de::Error::custom)
    }
}

struct RawObject<'a>(Vec<(String, &'a serde_json::value::RawValue)>);
impl<'de> Deserialize<'de> for RawObject<'de> {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = RawObject<'de>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("JSON object")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut object: M) -> Result<Self::Value, M::Error> {
                let mut fields = Vec::new();
                while let Some(entry) = object.next_entry()? {
                    fields.push(entry);
                }
                Ok(RawObject(fields))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}

fn parse_unique(
    raw: &serde_json::value::RawValue,
    depth: usize,
) -> Result<Value, serde_json::Error> {
    if depth >= 128 {
        return Err(de::Error::custom("JSON nesting limit"));
    }
    let json = raw.get().trim();
    match json.as_bytes().first() {
        Some(b'{') => {
            let RawObject(fields) = serde_json::from_str(json)?;
            let mut object = Map::new();
            for (key, value) in fields {
                if object.contains_key(&key) {
                    return Err(de::Error::custom("Duplicate JSON key"));
                }
                object.insert(key, parse_unique(value, depth + 1)?);
            }
            Ok(Value::Object(object))
        }
        Some(b'[') => {
            let items: Vec<&serde_json::value::RawValue> = serde_json::from_str(json)?;
            items
                .into_iter()
                .map(|item| parse_unique(item, depth + 1))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        Some(b'-' | b'0'..=b'9') => serde_json::from_str(json).map(Value::Number),
        _ => serde_json::from_str(json),
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

pub(crate) struct InitializeParams {
    pub protocol_version: String,
    pub capabilities: JsonObject,
    pub client_info: Implementation,
}

pub(crate) struct ListParams {
    pub cursor: Option<String>,
}

pub(crate) struct CallParams {
    pub name: String,
    pub arguments: JsonObject,
}

impl InitializeParams {
    pub fn parse(params: &JsonObject) -> Option<Self> {
        let client = params.get("clientInfo")?.as_object()?;
        Some(Self {
            protocol_version: params.get("protocolVersion")?.as_str()?.into(),
            capabilities: params.get("capabilities")?.as_object()?.clone(),
            client_info: Implementation {
                name: client.get("name")?.as_str()?.into(),
                version: client.get("version")?.as_str()?.into(),
            },
        })
    }
}

impl ListParams {
    pub fn parse(params: &JsonObject) -> Option<Self> {
        let cursor = match params.get("cursor") {
            None | Some(Value::Null) => None,
            Some(Value::String(cursor)) => Some(cursor.clone()),
            _ => return None,
        };
        Some(Self { cursor })
    }
}

impl CallParams {
    pub fn parse(params: &JsonObject) -> Option<Self> {
        let arguments = match params.get("arguments") {
            None => JsonObject::new(),
            Some(Value::Object(arguments)) => arguments.clone(),
            _ => return None,
        };
        Some(Self {
            name: params.get("name")?.as_str()?.into(),
            arguments,
        })
    }
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
