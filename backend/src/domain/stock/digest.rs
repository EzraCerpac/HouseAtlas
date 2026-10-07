use super::{StockError, StockResult};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// RFC8785 canonical JSON with SHA256. No sorting of submitted arrays.
pub fn canonical_digest(value: &Value) -> StockResult<String> {
    let bytes = canonical_bytes(value)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// Published Atlas canonicalJson: ECMAScript number/string encoding and raw
/// UTF16 key ordering. serde_jcs 0.1.0's object key sorting is not that ordering;
/// only its ECMAScript float formatter is used. Rust strings already exclude
/// unpaired surrogates. Schema validation retains each field's integer bounds.
pub fn canonical_bytes(value: &Value) -> StockResult<Vec<u8>> {
    let mut output = Vec::new();
    write_canonical(value, &mut output)?;
    Ok(output)
}

fn write_canonical(value: &Value, output: &mut Vec<u8>) -> StockResult<()> {
    match value {
        Value::Array(values) => {
            output.push(b'[');
            for (i, item) in values.iter().enumerate() {
                if i != 0 {
                    output.push(b',');
                }
                write_canonical(item, output)?;
            }
            output.push(b']');
        }
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            output.push(b'{');
            for (i, key) in keys.iter().enumerate() {
                if i != 0 {
                    output.push(b',');
                }
                output.extend(serde_json::to_vec(key).map_err(|_| StockError::InvalidContract)?);
                output.push(b':');
                write_canonical(&object[*key], output)?;
            }
            output.push(b'}');
        }
        Value::Number(number) => {
            let value = number
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or(StockError::InvalidContract)?;
            output.extend(serde_jcs::to_vec(&value).map_err(|_| StockError::InvalidContract)?);
        }
        _ => output.extend(serde_json::to_vec(value).map_err(|_| StockError::InvalidContract)?),
    }
    Ok(())
}

/// Stock.2 SEMANTICS root-only intent exclusions. Child transport IDs, child
/// receipts, ordered commands, guards and all submitted values remain present.
pub fn request_digest(request: &Value) -> StockResult<String> {
    let mut intent = request.clone();
    let root = intent.as_object_mut().ok_or(StockError::InvalidContract)?;
    root.remove("requestId");
    root.remove("approvalReceiptId");
    if root
        .get("target")
        .and_then(|v| v.get("authority"))
        .and_then(Value::as_str)
        == Some("homebox")
        && let Some(preconditions) = root.get_mut("preconditions").and_then(Value::as_object_mut)
    {
        preconditions.remove("providerObservation");
    }
    canonical_digest(&intent)
}

/// Finite owner-parsed milliseconds, never a comparison of timestamp strings.
pub fn operational_time(value: &str) -> StockResult<i64> {
    crate::contracts::semantics::timestamp_millis(value).ok_or(StockError::InvalidClock)
}
