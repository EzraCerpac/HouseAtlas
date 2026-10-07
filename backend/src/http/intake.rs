//! Bounded transport JSON intake, preserving numbers and literal object keys.
use super::{HttpFailure, failure, headers};
use axum::{extract::Request, http::StatusCode};
use serde::{
    Deserializer,
    de::{Error as _, MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use std::{collections::BTreeSet, fmt};

pub(super) fn metadata(request: &Request, maximum: u64) -> Result<(), HttpFailure> {
    let oversized = || failure(StatusCode::PAYLOAD_TOO_LARGE);
    if let Some(length) =
        headers::single(request.headers(), "content-length").map_err(|_| oversized())?
        && (length.is_empty()
            || !length.bytes().all(|byte| byte.is_ascii_digit())
            || length.parse::<u64>().map_err(|_| oversized())? > maximum)
    {
        return Err(oversized());
    }
    let unsupported = || failure(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let content_type = headers::single(request.headers(), "content-type")
        .map_err(|_| unsupported())?
        .ok_or_else(unsupported)?;
    let supported = match content_type.split_once(';') {
        None => content_type.eq_ignore_ascii_case("application/json"),
        Some((kind, charset)) => {
            kind.trim_end().eq_ignore_ascii_case("application/json")
                && charset.trim_start().eq_ignore_ascii_case("charset=utf-8")
        }
    };
    if !supported {
        return Err(unsupported());
    }
    Ok(())
}
struct Entries;
impl<'de> Visitor<'de> for Entries {
    type Value = Vec<(String, &'de RawValue)>;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON object with unique properties")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entries = Vec::new();
        let mut seen = BTreeSet::new();
        while let Some((key, value)) = map.next_entry::<String, &'de RawValue>()? {
            if !seen.insert(key.clone()) {
                return Err(M::Error::custom("duplicate object property"));
            }
            entries.push((key, value));
        }
        Ok(entries)
    }
}
fn raw_value(raw: &RawValue, depth: usize) -> Result<Value, serde_json::Error> {
    if depth > 64 {
        return Err(serde_json::Error::custom("JSON nesting limit exceeded"));
    }
    let text = raw.get().trim_start();
    match text.as_bytes().first().copied() {
        Some(b'{') => {
            let mut deserializer = serde_json::Deserializer::from_str(text);
            let entries = deserializer.deserialize_map(Entries)?;
            let mut object = serde_json::Map::new();
            for (key, value) in entries {
                object.insert(key, raw_value(value, depth + 1)?);
            }
            Ok(Value::Object(object))
        }
        Some(b'[') => serde_json::from_str::<Vec<&RawValue>>(text)?
            .into_iter()
            .map(|value| raw_value(value, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Some(b'"') => serde_json::from_str(text).map(Value::String),
        Some(b't' | b'f') => serde_json::from_str(text).map(Value::Bool),
        Some(b'n') => serde_json::from_str::<()>(text).map(|()| Value::Null),
        _ => serde_json::from_str(text).map(Value::Number),
    }
}
pub(super) fn json(bytes: &[u8]) -> Result<Value, HttpFailure> {
    let invalid = || failure(StatusCode::UNPROCESSABLE_ENTITY);
    let raw = serde_json::from_slice::<&RawValue>(bytes).map_err(|_| invalid())?;
    raw_value(raw, 0).map_err(|_| invalid())
}
