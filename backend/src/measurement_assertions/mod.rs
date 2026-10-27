//! Measurement assertion domain contracts and validation.
//! Persistence, request authority and HTTP composition live in their owning
//! modules. This module supplies no geometry writer or closure endpoint.
mod decimal;
mod model_update;
pub mod online_contract;
mod types;
mod validation;

pub use decimal::*;
pub use model_update::*;
pub use types::*;
pub use validation::{active_assertions, validate_assertion, validate_history, validate_model_pin};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidationError(pub &'static str);

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for ValidationError {}

pub type ValidationResult<T> = Result<T, ValidationError>;

#[cfg(test)]
mod synthetic_contract_tests;
