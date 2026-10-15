//! Rebuild JSON values without treating object keys as serde_json metadata.

use serde::{
    Deserializer,
    de::{Error as _, MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use std::fmt;

// RawValue checks syntax without serde_json's usual container-depth budget.
const RECURSION_LIMIT: usize = 128;

pub(super) fn parse(bytes: &[u8]) -> Result<Value, super::ContractError> {
    let raw = serde_json::from_slice::<&RawValue>(bytes)?;
    parse_raw(raw, RECURSION_LIMIT)
}

fn container_depth(remaining: usize) -> Result<usize, serde_json::Error> {
    match remaining.checked_sub(1) {
        Some(depth) if depth > 0 => Ok(depth),
        _ => Err(serde_json::Error::custom("recursion limit exceeded")),
    }
}

struct ObjectEntries;

impl<'de> Visitor<'de> for ObjectEntries {
    type Value = Vec<(String, &'de RawValue)>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON object")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entries = Vec::new();
        while let Some(entry) = map.next_entry()? {
            entries.push(entry);
        }
        Ok(entries)
    }
}

fn parse_raw(raw: &RawValue, remaining_depth: usize) -> Result<Value, super::ContractError> {
    let json = raw.get().trim_start();
    match json.as_bytes().first().copied() {
        Some(b'{') => {
            let depth = container_depth(remaining_depth)?;
            let mut deserializer = serde_json::Deserializer::from_str(json);
            let entries = deserializer.deserialize_map(ObjectEntries)?;
            let mut object = serde_json::Map::new();
            // Validate each value before a later duplicate key can replace it.
            for (key, raw) in entries {
                if object.contains_key(&key) {
                    return Err(serde_json::Error::custom("duplicate JSON key").into());
                }
                object.insert(key, parse_raw(raw, depth)?);
            }
            Ok(Value::Object(object))
        }
        Some(b'[') => {
            let depth = container_depth(remaining_depth)?;
            let values: Vec<&RawValue> = serde_json::from_str(json)?;
            values
                .into_iter()
                .map(|raw| parse_raw(raw, depth))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        Some(b'"') => serde_json::from_str::<String>(json)
            .map(Value::String)
            .map_err(Into::into),
        Some(b't' | b'f') => serde_json::from_str::<bool>(json)
            .map(Value::Bool)
            .map_err(Into::into),
        Some(b'n') => serde_json::from_str::<()>(json)
            .map(|()| Value::Null)
            .map_err(Into::into),
        // RawValue already checked the grammar; only an actual numeric token
        // reaches Number's deserializer, never an object with a private key.
        _ => {
            let number: serde_json::Number = serde_json::from_str(json)?;
            super::numeric::analyze_number(&number)
                .map_err(super::ContractError::UnsupportedNumber)?;
            Ok(Value::Number(number))
        }
    }
}
