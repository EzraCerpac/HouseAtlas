//! Explicit successor schema boundary. Frozen v1 validation is unchanged.
use super::{
    ConstBool, ConstInt, JsonInteger, JsonNumber, Optional, required_field,
    serialize_additional_properties,
};
use super::{ContractError, ensure_numbers_supported, json_value, semantics};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
// Preserve the generated wire union layout across v1 and v2 record arms.
#[allow(clippy::large_enum_variant)]
#[path = "generated_v2.rs"]
mod generated;
pub use generated::*;
pub trait Contract: DeserializeOwned + Serialize {
    const SCHEMA_KEY: &'static str;
}
static VALIDATORS: OnceLock<Mutex<BTreeMap<String, jsonschema::Validator>>> = OnceLock::new();
pub fn validate_value(name: &str, value: &Value) -> Result<(), ContractError> {
    ensure_numbers_supported(value).map_err(ContractError::UnsupportedNumber)?;
    let mut validators = VALIDATORS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| ContractError::Setup("v2 schema unavailable".into()))?;
    if !validators.contains_key(name) {
        let atlas = json_value::parse(include_bytes!(
            "../../../packages/contracts/schemas/atlas.v2.schema.json"
        ))?;
        if name != "$atlas"
            && name != "$history"
            && (!generated::SCHEMA_DEFINITIONS.contains(&name)
                || atlas["$defs"].get(name).is_none())
        {
            return Err(ContractError::Setup("unknown v2 shape".into()));
        }
        let schema = if name == "$atlas" {
            atlas
        } else if name == "$history" {
            let mut history = json_value::parse(include_bytes!(
                "../../../packages/contracts/history/http-history.v2.schema.json"
            ))?;
            if history["items"]["$ref"]
                != "https://houseatlas.invalid/contracts/2.0.0/atlas.schema.json#/$defs/audit"
            {
                return Err(ContractError::Setup(
                    "unsupported v2 history reference".into(),
                ));
            }
            history["items"]["$ref"] = json!("#/$defs/audit");
            history["$defs"] = atlas["$defs"].clone();
            history
        } else {
            json!({"$schema":atlas["$schema"],"$defs":atlas["$defs"],"$ref":format!("#/$defs/{name}")})
        };
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .with_format("date", semantics::published_date_format)
            .with_format("date-time", semantics::published_date_time_format)
            .with_format("uri", semantics::published_uri_format)
            .should_validate_formats(true)
            .should_ignore_unknown_formats(false)
            .build(&schema)
            .map_err(|e| ContractError::Setup(e.to_string()))?;
        validators.insert(name.into(), validator);
    }
    validators[name]
        .validate(value)
        .map_err(|e| ContractError::Schema(e.to_string()))
}
pub fn decode<T: Contract>(bytes: &[u8]) -> Result<T, ContractError> {
    let value = parse_value(bytes)?;
    validate_value(T::SCHEMA_KEY, &value)?;
    Ok(serde_json::from_value(value)?)
}
pub fn validate<T: Contract>(value: &T) -> Result<(), ContractError> {
    validate_value(T::SCHEMA_KEY, &serde_json::to_value(value)?)
}
pub fn parse_value(bytes: &[u8]) -> Result<Value, ContractError> {
    super::v2_json::parse(bytes)
}
