//! Published integer values are numeric values, independent of JSON decimal or
//! exponent spelling. These conversions do not rewrite payloads or JCS hashes.
use super::MAX_REVISION;
use serde::{Deserialize, Deserializer, de::Error};
use serde_json::Value;

pub(crate) fn safe_integer(value: &Value) -> Option<u64> {
    value.as_number()?;
    // Reuse AT51's checked lexical envelope and exact integral classification
    // before the bounded conversion. Retained fractional/underflow tokens must
    // not acquire integer meaning through an f64 conversion.
    let integer: crate::contracts::JsonInteger = serde_json::from_value(value.clone()).ok()?;
    let number = integer.as_number();
    if let Some(integer) = number.as_u64() {
        return (integer <= MAX_REVISION).then_some(integer);
    }
    if let Some(integer) = number.as_i64() {
        return u64::try_from(integer)
            .ok()
            .filter(|integer| *integer <= MAX_REVISION);
    }
    let number = number.as_f64()?;
    (number.is_finite() && number >= 0.0 && number <= MAX_REVISION as f64 && number.fract() == 0.0)
        .then_some(number as u64)
}

pub(crate) fn deserialize_safe_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<u64, D::Error> {
    safe_integer(&Value::deserialize(deserializer)?)
        .ok_or_else(|| D::Error::custom("Published nonnegative safe integer required"))
}

/// This required nullable decoder deliberately has no serde default: omission
/// remains distinct from a supplied null, as required by the published schema.
pub(crate) fn deserialize_nullable_safe_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    Option::<Value>::deserialize(deserializer)?
        .map(|value| {
            safe_integer(&value)
                .ok_or_else(|| D::Error::custom("Published nonnegative safe integer required"))
        })
        .transpose()
}

pub(crate) fn deserialize_u32<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    u32::try_from(deserialize_safe_integer(deserializer)?)
        .map_err(|_| D::Error::custom("Published u32 integer required"))
}
