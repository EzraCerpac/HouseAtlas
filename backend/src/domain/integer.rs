//! Published integer carriers use their exact numeric value, independently of
//! decimal/exponent spelling. Raw request envelopes are never rewritten here.

use serde::{Deserialize, Deserializer, de::Error};
use serde_json::Value;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Classify with AT51's checked lexical envelope before bounded conversion.
/// This matches AT07's revision/epoch conversion without letting a fractional
/// or underflow token acquire integer meaning through a float conversion.
pub(crate) fn safe_integer(value: &Value) -> Option<u64> {
    value.as_number()?;
    let integer: crate::contracts::JsonInteger = serde_json::from_value(value.clone()).ok()?;
    let number = integer.as_number();
    if let Some(integer) = number.as_u64() {
        return (integer <= MAX_SAFE_INTEGER).then_some(integer);
    }
    if let Some(integer) = number.as_i64() {
        return u64::try_from(integer)
            .ok()
            .filter(|integer| *integer <= MAX_SAFE_INTEGER);
    }
    let number = number.as_f64()?;
    (number.is_finite()
        && number >= 0.0
        && number <= MAX_SAFE_INTEGER as f64
        && number.fract() == 0.0)
        .then_some(number as u64)
}

pub(crate) fn deserialize_safe_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<u64, D::Error> {
    safe_integer(&Value::deserialize(deserializer)?)
        .ok_or_else(|| D::Error::custom("Published nonnegative safe integer required"))
}

/// No serde default: a required nullable field distinguishes absence from null.
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

pub(crate) fn deserialize_u8<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    u8::try_from(deserialize_safe_integer(deserializer)?)
        .map_err(|_| D::Error::custom("Published u8 integer required"))
}

/// HomeBox attachment sizes have no schema maximum. Preserve their checked
/// integer token; the canonical schema owns the field's minimum and null arm.
pub(crate) fn deserialize_nullable_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<crate::contracts::JsonInteger>, D::Error> {
    Option::<crate::contracts::JsonInteger>::deserialize(deserializer)
}
