//! DTOs generated from the frozen Atlas schema and HTTP history sidecar.
//! Use decode/validate/encode at a JSON boundary: serde alone does not check
//! formats, numeric bounds, uniqueItems, oneOf exclusivity, or if/then rules.
mod generated;
pub use generated::*;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fmt, sync::OnceLock};

/// A generated canonical schema shape.
pub trait Contract: DeserializeOwned + Serialize {
    const SCHEMA_KEY: &'static str;
}

/// An optional field preserves omission separately from a present null value.
/// `Optional<Option<T>>` is Missing, Present(None), or Present(Some(value)).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Optional<T> {
    #[default]
    Missing,
    Present(T),
}

impl<T> Optional<T> {
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}

impl<T: Serialize> Serialize for Optional<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing => serializer.serialize_unit(),
            Self::Present(value) => value.serialize(serializer),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Optional<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Self::Present)
    }
}

// deserialize_with makes a nullable field required: serde cannot supply None
// for an absent key, while a present null still deserializes as None.
fn required_field<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<T, D::Error> {
    T::deserialize(deserializer)
}

/// Serialize open-wire extras only when no key shadows a modeled property.
/// Generated open objects call this independently, including nested objects.
pub(super) fn serialize_additional_properties<S: Serializer>(
    properties: &BTreeMap<String, Value>,
    modeled_keys: &[&str],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if let Some(key) = properties
        .keys()
        .find(|key| modeled_keys.contains(&key.as_str()))
    {
        return Err(serde::ser::Error::custom(format!(
            "additional property shadows modeled key: {key}"
        )));
    }
    properties.serialize(serializer)
}

/// A JSON number preserving the active serde_json numeric representation.
/// Construction from f64 is fallible, so a known numeric field cannot silently
/// serialize a nonfinite float as the schema's explicit unknown/null value.
/// Lossless large-number preservation requires the paired precision features
/// documented in docs/rust-baseline/numeric-semantics.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JsonNumber(serde_json::Number);

impl JsonNumber {
    pub fn as_number(&self) -> &serde_json::Number {
        &self.0
    }

    pub fn from_f64(value: f64) -> Option<Self> {
        serde_json::Number::from_f64(value).map(Self)
    }
}

impl From<i64> for JsonNumber {
    fn from(value: i64) -> Self {
        Self(value.into())
    }
}

impl From<u64> for JsonNumber {
    fn from(value: u64) -> Self {
        Self(value.into())
    }
}

/// A JSON integer using the locked schema library's numeric semantics.
/// JSON Schema also permits integral spellings such as 1.0. Per-field limits
/// are checked by the canonical schema at decode/validate/encode boundaries.
/// With the paired precision features, large integer tokens are retained without
/// conversion to f64. See the documented scientific-notation limitations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct JsonInteger(serde_json::Number);

impl JsonInteger {
    pub fn as_number(&self) -> &serde_json::Number {
        &self.0
    }
}

impl From<i64> for JsonInteger {
    fn from(value: i64) -> Self {
        Self(value.into())
    }
}

impl From<u64> for JsonInteger {
    fn from(value: u64) -> Self {
        Self(value.into())
    }
}

impl<'de> Deserialize<'de> for JsonInteger {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Number::deserialize(deserializer)?;
        if jsonschema::json::JsonNumber::is_integer(&value) {
            Ok(Self(value))
        } else {
            Err(serde::de::Error::custom("expected an integral JSON number"))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConstInt<const N: i64>;

impl<const N: i64> Serialize for ConstInt<N> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i64(N)
    }
}

impl<'de, const N: i64> Deserialize<'de> for ConstInt<N> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = JsonInteger::deserialize(deserializer)?;
        if jsonschema::json::cmp::equal_numbers(&value.0, &serde_json::Number::from(N)) {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom(format!("expected literal {N}")))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConstBool<const B: bool>;

impl<const B: bool> Serialize for ConstBool<B> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(B)
    }
}

impl<'de, const B: bool> Deserialize<'de> for ConstBool<B> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = bool::deserialize(deserializer)?;
        if value == B {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom(format!("expected literal {B}")))
        }
    }
}

#[derive(Debug)]
pub enum ContractError {
    Json(serde_json::Error),
    Schema(String),
    Setup(String),
}

impl fmt::Display for ContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(error) => write!(formatter, "contract JSON: {error}"),
            Self::Schema(error) => write!(formatter, "contract schema: {error}"),
            Self::Setup(error) => write!(formatter, "contract schema setup: {error}"),
        }
    }
}

impl std::error::Error for ContractError {}

impl From<serde_json::Error> for ContractError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

type Validators = BTreeMap<&'static str, jsonschema::Validator>;
static VALIDATORS: OnceLock<Result<Validators, String>> = OnceLock::new();

fn compile_validators() -> Result<Validators, String> {
    let atlas: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/schemas/atlas.schema.json"
    ))
    .map_err(|error| error.to_string())?;
    let mut history: Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/history/http-history.v1.1.0.schema.json"
    ))
    .map_err(|error| error.to_string())?;
    // Resolve the sole sidecar reference from the embedded frozen definitions.
    // jsonschema is built without network/file retrieval features.
    if history["items"]["$ref"] != "../schemas/atlas.schema.json#/$defs/audit" {
        return Err("unsupported HTTP history reference".to_owned());
    }
    history["items"]["$ref"] = json!("#/$defs/audit");
    history["$defs"] = atlas["$defs"].clone();
    let mut schemas = BTreeMap::from([("$atlas", atlas.clone()), ("$history", history)]);
    for &name in generated::SCHEMA_DEFINITIONS {
        schemas.insert(
            name,
            json!({
                "$schema": atlas["$schema"],
                "$defs": atlas["$defs"],
                "$ref": format!("#/$defs/{name}")
            }),
        );
    }
    schemas
        .into_iter()
        .map(|(name, schema)| {
            jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .should_validate_formats(true)
                .should_ignore_unknown_formats(false)
                .build(&schema)
                .map(|validator| (name, validator))
                .map_err(|error| format!("{name}: {error}"))
        })
        .collect()
}

fn validate_value<T: Contract>(value: &Value) -> Result<(), ContractError> {
    let validators = VALIDATORS
        .get_or_init(compile_validators)
        .as_ref()
        .map_err(|error| ContractError::Setup(error.clone()))?;
    let validator = validators
        .get(T::SCHEMA_KEY)
        .ok_or_else(|| ContractError::Setup(format!("unknown shape: {}", T::SCHEMA_KEY)))?;
    validator
        .validate(value)
        .map_err(|error| ContractError::Schema(error.to_string()))
}

/// Validate JSON against its canonical shape, then decode the narrow DTO.
pub fn decode<T: Contract>(bytes: &[u8]) -> Result<T, ContractError> {
    let value: Value = serde_json::from_slice(bytes)?;
    validate_value::<T>(&value)?;
    Ok(serde_json::from_value(value)?)
}

/// Validate a typed DTO before returning it across a JSON boundary.
pub fn validate<T: Contract>(value: &T) -> Result<(), ContractError> {
    validate_value::<T>(&serde_json::to_value(value)?)
}

/// Validate and serialize the DTO's original JSON shape.
pub fn encode<T: Contract>(value: &T) -> Result<Vec<u8>, ContractError> {
    let value = serde_json::to_value(value)?;
    validate_value::<T>(&value)?;
    Ok(serde_json::to_vec(&value)?)
}
