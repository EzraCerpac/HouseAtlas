//! Accessors for schema-checked JSON in the published JavaScript numeric model.

use serde_json::Value;

use super::SemanticError;
pub(super) use super::timestamps::{date_greater, date_less};

pub(super) fn text(value: &Value) -> Result<&str, SemanticError> {
    value
        .as_str()
        .ok_or_else(|| SemanticError::invalid("Expected schema string"))
}

pub(super) fn items(value: &Value) -> Result<&[Value], SemanticError> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| SemanticError::invalid("Expected schema array"))
}

pub(super) fn number(value: &Value) -> Result<f64, SemanticError> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| SemanticError::invalid("Expected finite schema number"))
}

pub(super) fn same_scope(left: &Value, right: &Value) -> Result<bool, SemanticError> {
    Ok(text(&left["workspaceId"])? == text(&right["workspaceId"])?
        && text(&left["homeId"])? == text(&right["homeId"])?)
}

pub(super) fn record_ref_key(
    scope: &Value,
    kind: &str,
    id: &str,
) -> Result<[String; 4], SemanticError> {
    Ok([
        text(&scope["workspaceId"])?.to_owned(),
        text(&scope["homeId"])?.to_owned(),
        kind.to_owned(),
        id.to_owned(),
    ])
}

pub(super) fn record_key(record: &Value) -> Result<[String; 4], SemanticError> {
    record_ref_key(
        record,
        text(&record["recordType"])?,
        text(&record["recordId"])?,
    )
}

pub(super) fn source_scope_key(source: &Value) -> Result<[String; 4], SemanticError> {
    Ok([
        text(&source["workspaceId"])?.to_owned(),
        text(&source["homeId"])?.to_owned(),
        text(&source["sourceInstanceId"])?.to_owned(),
        text(&source["collectionId"])?.to_owned(),
    ])
}

pub(super) fn qualified_source_key(
    record: &Value,
    source: &Value,
) -> Result<[String; 5], SemanticError> {
    Ok([
        text(&record["workspaceId"])?.to_owned(),
        text(&source["sourceInstanceId"])?.to_owned(),
        text(&source["collectionId"])?.to_owned(),
        text(&source["sourceKind"])?.to_owned(),
        text(&source["externalId"])?.to_owned(),
    ])
}

/// Node's isDeepStrictEqual for finite JSON data: object order is irrelevant;
/// numeric Object.is distinguishes negative zero from positive zero.
pub(super) fn js_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => match (left.as_f64(), right.as_f64()) {
            (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
            _ => false,
        },
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| js_equal(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .all(|(key, left)| right.get(key).is_some_and(|right| js_equal(left, right)))
        }
        _ => left == right,
    }
}
