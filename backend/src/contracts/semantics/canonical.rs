//! The published contract's RFC 8785 JSON and SHA-256 representation.
//!
//! JSON numbers enter the JavaScript consumer's finite IEEE-754 model here.
//! This deliberately rounds retained arbitrary-precision tokens to `f64`; it
//! does not promise an exact digest of an unbounded decimal value. Rust strings
//! already contain Unicode scalars. Callers must reject duplicate input keys
//! before constructing a Value; a Value cannot recover discarded duplicates.
//! The semantic component does not supply the HTTP request parser.

use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

use super::SemanticError;

/// Normalize every JSON number to the published JavaScript number model.
pub fn normalize_numbers(value: Value) -> Result<Value, SemanticError> {
    match value {
        Value::Number(number) => {
            let number = Number::from_f64(finite_number(&number)?)
                .ok_or_else(|| SemanticError::invalid("Non-finite JSON number"))?;
            Ok(Value::Number(number))
        }
        Value::Array(values) => values
            .into_iter()
            .map(normalize_numbers)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => values
            .into_iter()
            .map(|(key, value)| normalize_numbers(value).map(|value| (key, value)))
            .collect::<Result<Map<String, Value>, _>>()
            .map(Value::Object),
        other => Ok(other),
    }
}

/// Serialize JSON data with ECMAScript scalars and UTF-16 object-key order.
pub fn canonical_json(value: &Value) -> Result<String, SemanticError> {
    let mut output = String::new();
    write_value(value, &mut output)?;
    Ok(output)
}

/// SHA-256 of the UTF-8 canonical JSON bytes, as lowercase hexadecimal.
pub fn digest(value: &Value) -> Result<String, SemanticError> {
    let canonical = canonical_json(value)?;
    let hash = Sha256::digest(canonical.as_bytes());
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in hash {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}

fn finite_number(number: &Number) -> Result<f64, SemanticError> {
    number
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| SemanticError::invalid("Non-finite JSON number"))
}

fn write_string(value: &str, output: &mut String) -> Result<(), SemanticError> {
    // serde_json uses JSON.stringify's quote, reverse-solidus and control-byte
    // escapes for valid Unicode, leaving the remaining Unicode scalars intact.
    let escaped = serde_json::to_string(value)
        .map_err(|_| SemanticError::invalid("Canonical digest requires JSON data"))?;
    output.push_str(&escaped);
    Ok(())
}

fn write_value(value: &Value, output: &mut String) -> Result<(), SemanticError> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(number) => {
            let value = finite_number(number)?;
            // ryu-js 1.0.2 implements ECMAScript Number::toString, including
            // negative zero, fixed/scientific cutoffs and positive exponents.
            output.push_str(ryu_js::Buffer::new().format_finite(value));
        }
        Value::String(value) => write_string(value, output)?,
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_value(value, output)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            let mut keys: Vec<&String> = values.keys().collect();
            keys.sort_unstable_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            output.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_string(key, output)?;
                output.push(':');
                write_value(&values[key], output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}
