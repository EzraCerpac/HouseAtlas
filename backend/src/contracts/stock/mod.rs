//! Native stock wire3 contracts. These checks do not grant capability, dispatch
//! providers, admit presence, authorize disclosure, or persist results.

mod catalog;
mod correlation;
mod digest;
mod envelope;
mod presence;
mod schema;

pub use catalog::*;
pub use correlation::*;
pub use digest::*;
pub use envelope::*;
pub use presence::*;
pub use schema::SchemaCounts;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::fmt;

pub const CONTRACT_VERSION: &str = "0.3.0-at34.stock.2";
pub const WIRE_SCHEMA_VERSION: u64 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StockError {
    Setup(String),
    InvalidContract(String),
    UnknownSchema(String),
    Correlation(String),
}

impl StockError {
    pub fn setup(message: impl Into<String>) -> Self {
        Self::Setup(message.into())
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::InvalidContract(message.into())
    }
    pub fn correlation(message: impl Into<String>) -> Self {
        Self::Correlation(message.into())
    }
}

impl fmt::Display for StockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (kind, message) = match self {
            Self::Setup(message) => ("schema setup", message),
            Self::InvalidContract(message) => ("invalid contract", message),
            Self::UnknownSchema(message) => ("unknown schema", message),
            Self::Correlation(message) => ("result correlation", message),
        };
        write!(formatter, "stock {kind}: {message}")
    }
}

impl std::error::Error for StockError {}

impl From<super::ContractError> for StockError {
    fn from(error: super::ContractError) -> Self {
        Self::invalid(error.to_string())
    }
}

impl From<serde_json::Error> for StockError {
    fn from(error: serde_json::Error) -> Self {
        Self::invalid(error.to_string())
    }
}

impl From<super::semantics::SemanticError> for StockError {
    fn from(error: super::semantics::SemanticError) -> Self {
        Self::invalid(error.to_string())
    }
}

pub type StockResult<T> = Result<T, StockError>;

/// A typed stock DTO with a fixed published agent-schema definition.
pub trait StockContract: DeserializeOwned + Serialize {
    const SCHEMA_REF: &'static str;
}

/// Complete native schema validation against embedded adopted resources.
/// It performs no IO or runtime capability decision. Every call validates the
/// exact input value without defaults, stripping, coercion or normalization.
#[derive(Debug, Clone, Copy, Default)]
pub struct StockValidation;

impl StockValidation {
    pub fn new() -> StockResult<Self> {
        schema::initialize()?;
        Ok(Self)
    }

    /// Same narrow signature as the domain's StockContractPort checker.
    pub fn validate(&self, local_schema_ref: &str, value: &Value) -> StockResult<()> {
        schema::validate(local_schema_ref, value)
    }

    pub fn compile_all(&self) -> StockResult<SchemaCounts> {
        schema::compile_all()
    }

    pub fn decode_request(&self, bytes: &[u8]) -> StockResult<StockRequest> {
        StockRequest::parse(self, super::json_value::parse(bytes)?)
    }

    pub fn decode<T: StockContract>(&self, bytes: &[u8]) -> StockResult<T> {
        let value = super::json_value::parse(bytes)?;
        self.validate(T::SCHEMA_REF, &value)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn validate_typed<T: StockContract>(&self, value: &T) -> StockResult<()> {
        self.validate(T::SCHEMA_REF, &serde_json::to_value(value)?)
    }

    pub fn encode<T: StockContract>(&self, value: &T) -> StockResult<Vec<u8>> {
        self.validate_typed(value)?;
        Ok(serde_json::to_vec(value)?)
    }
}
