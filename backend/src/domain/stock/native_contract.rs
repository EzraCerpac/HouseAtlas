//! Thin domain binding to genuine offline stock wire3 contracts.
//! This adapter grants no authority and performs no storage/provider operation.
use super::{StockContractPort, StockError, StockResult};
use crate::contracts::stock as native;
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct NativeStockContract {
    validation: native::StockValidation,
}

impl NativeStockContract {
    pub fn new() -> StockResult<Self> {
        native::StockValidation::new()
            .map(|validation| Self { validation })
            .map_err(native_stock_error)
    }
}

impl StockContractPort for NativeStockContract {
    fn validate(&self, local_schema_ref: &str, value: &Value) -> StockResult<()> {
        self.validation
            .validate(local_schema_ref, value)
            .map_err(native_stock_error)
    }
}

fn native_stock_error(error: native::StockError) -> StockError {
    match error {
        native::StockError::Setup(_) => StockError::OwnerUnavailable,
        native::StockError::InvalidContract(_) | native::StockError::UnknownSchema(_) => {
            StockError::InvalidContract
        }
        native::StockError::Correlation(_) => StockError::CorrelationMismatch,
    }
}
