use super::model::{ErrorCode, NetworkError, Result, guard};
use serde::{
    Deserialize,
    de::{DeserializeSeed, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Map, Number, Value};
use std::fmt;

pub(crate) fn bounded_json(bytes: &[u8], max_bytes: usize) -> Result<Value> {
    if bytes.len() > max_bytes {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue { depth: 0 }
        .deserialize(&mut de)
        .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
    de.end()
        .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?;
    Ok(value)
}
// Every JSON token is consumed as a finite IEEE-754 binary64 JS Number before
// retention. Use one stable Serde storage representation for that value across
// integer/decimal/exponent spellings and canonical sidecar round trips. Integer
// storage here is an encoding of the already-rounded f64, never raw precision.
fn js_number(value: f64) -> Option<Number> {
    if !value.is_finite() {
        return None;
    }
    if value == 0.0 {
        return Some(0_u64.into());
    }
    if value.fract() == 0.0 {
        if (0.0..18_446_744_073_709_551_616.0).contains(&value) {
            return Some((value as u64).into());
        }
        if (i64::MIN as f64..0.0).contains(&value) {
            return Some((value as i64).into());
        }
    }
    Number::from_f64(value)
}

pub(crate) fn safe_revision(value: &Value) -> Result<u64> {
    let number = value
        .as_f64()
        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
    guard(
        number.is_finite()
            && number.fract() == 0.0
            && (0.0..=9_007_199_254_740_991.0).contains(&number),
    )?;
    Ok(number as u64)
}

pub(crate) fn deserialize_revision<'de, D>(de: D) -> std::result::Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <Value as serde::Deserialize>::deserialize(de)?;
    safe_revision(&value).map_err(serde::de::Error::custom)
}

struct StrictValue {
    depth: usize,
}
impl<'de> DeserializeSeed<'de> for StrictValue {
    type Value = Value;
    fn deserialize<D>(self, de: D) -> std::result::Result<Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        if self.depth > 100 {
            return Err(serde::de::Error::custom("JSON nesting limit"));
        }
        // RawValue dispatch keeps object keys distinct from Serde's internal
        // arbitrary-precision number map under the host's unified features.
        let raw = <&serde_json::value::RawValue>::deserialize(de)?;
        let mut nested = serde_json::Deserializer::from_str(raw.get());
        match raw.get().as_bytes().first() {
            Some(b'{') => serde::Deserializer::deserialize_map(&mut nested, self),
            Some(b'[') => serde::Deserializer::deserialize_seq(&mut nested, self),
            Some(b'-' | b'0'..=b'9') => raw
                .get()
                .parse::<f64>()
                .ok()
                .and_then(js_number)
                .map(Value::Number)
                .ok_or_else(|| serde::de::Error::custom("nonfinite JSON number")),
            _ => Value::deserialize(&mut nested),
        }
        .map_err(serde::de::Error::custom)
    }
}
impl<'de> Visitor<'de> for StrictValue {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded JSON")
    }
    fn visit_bool<E>(self, value: bool) -> std::result::Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> std::result::Result<Value, E> {
        self.visit_f64(value as f64)
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> std::result::Result<Value, E> {
        self.visit_f64(value as f64)
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> std::result::Result<Value, E> {
        js_number(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("nonfinite number"))
    }
    fn visit_str<E>(self, value: &str) -> std::result::Result<Value, E> {
        Ok(Value::String(value.into()))
    }
    fn visit_string<E>(self, value: String) -> std::result::Result<Value, E> {
        Ok(Value::String(value))
    }
    fn visit_unit<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_none<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Value, A::Error> {
        let mut result = Vec::new();
        while let Some(value) = seq.next_element_seed(StrictValue {
            depth: self.depth + 1,
        })? {
            result.push(value);
        }
        Ok(Value::Array(result))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Value, A::Error> {
        let mut result = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if result.contains_key(&key) {
                return Err(serde::de::Error::custom("duplicate key"));
            }
            let value = map.next_value_seed(StrictValue {
                depth: self.depth + 1,
            })?;
            result.insert(key, value);
        }
        Ok(Value::Object(result))
    }
}

/// Published canonicalJson semantics: sorted UTF-16 keys and ECMAScript number
/// rendering. This is used for sidecar bodies/digests, never pretty JSON.
pub(crate) fn canonical_json(value: &Value) -> Result<String> {
    fn encode(value: &Value, out: &mut String, depth: usize) -> Result<()> {
        guard(depth <= 100)?;
        match value {
            Value::Null => out.push_str("null"),
            Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Value::Number(value) => {
                let number = value
                    .as_f64()
                    .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?;
                guard(number.is_finite())?;
                if number == 0.0 {
                    out.push('0');
                } else {
                    out.push_str(ryu_js::Buffer::new().format(number));
                }
            }
            Value::String(value) => out.push_str(
                &serde_json::to_string(value)
                    .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?,
            ),
            Value::Array(values) => {
                out.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    encode(value, out, depth + 1)?;
                }
                out.push(']');
            }
            Value::Object(values) => {
                let mut keys: Vec<_> = values.keys().collect();
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                out.push('{');
                for (index, key) in keys.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push_str(
                        &serde_json::to_string(key)
                            .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))?,
                    );
                    out.push(':');
                    encode(&values[*key], out, depth + 1)?;
                }
                out.push('}');
            }
        }
        Ok(())
    }
    let mut result = String::new();
    encode(value, &mut result, 0)?;
    Ok(result)
}
