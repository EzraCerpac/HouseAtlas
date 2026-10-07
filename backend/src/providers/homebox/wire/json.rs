use super::{DecodeLimits, WireError};
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use std::fmt;

// serde_json::Value alone silently replaces duplicate keys. Inspect every map,
// including unknown extension fields, before decoding the stock wire fields.
struct JsonSeed(usize);
impl<'de> DeserializeSeed<'de> for JsonSeed {
    type Value = Value;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        if self.0 > 64 {
            return Err(serde::de::Error::custom("nesting limit"));
        }
        // Read lexical containers explicitly: arbitrary_precision numbers use a
        // private Serde map representation, which must never be confused with an
        // actual JSON extension object. RawValue retains that distinction.
        let raw = <&serde_json::value::RawValue>::deserialize(d)?;
        let token = raw.get();
        let mut decoder = serde_json::Deserializer::from_str(token);
        let value = match token.as_bytes().first() {
            Some(b'{') => decoder.deserialize_map(self),
            Some(b'[') => decoder.deserialize_seq(self),
            _ => serde_json::from_str::<Value>(token),
        }
        .map_err(serde::de::Error::custom)?;
        if let Value::Number(n) = &value
            && n.as_f64().is_none_or(|n| !n.is_finite())
        {
            return Err(serde::de::Error::custom("nonfinite number"));
        }
        Ok(value)
    }
}
impl<'de> Visitor<'de> for JsonSeed {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded JSON metadata")
    }
    fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
        serde_json::Number::from_f64(v)
            .map(Value::Number)
            .ok_or_else(|| E::custom("nonfinite number"))
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.into()))
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        Ok(Value::String(v))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut rows = Vec::new();
        while let Some(v) = a.next_element_seed(JsonSeed(self.0 + 1))? {
            rows.push(v);
        }
        Ok(Value::Array(rows))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut map = Map::new();
        while let Some(k) = a.next_key::<String>()? {
            if map.contains_key(&k) {
                return Err(serde::de::Error::custom("duplicate key"));
            }
            map.insert(k, a.next_value_seed(JsonSeed(self.0 + 1))?);
        }
        Ok(Value::Object(map))
    }
}
pub(super) fn parse(bytes: &[u8], limits: DecodeLimits) -> Result<Value, WireError> {
    limits.validate()?;
    if bytes.len() > limits.max_response_bytes {
        return Err(WireError::Limit);
    }
    std::str::from_utf8(bytes).map_err(|_| WireError::Invalid)?;
    let mut d = serde_json::Deserializer::from_slice(bytes);
    let value = JsonSeed(0)
        .deserialize(&mut d)
        .map_err(|_| WireError::Invalid)?;
    d.end().map_err(|_| WireError::Invalid)?;
    Ok(value)
}
