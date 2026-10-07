//! Stock.2 root-only intent exclusions, using the accepted native canonicalizer.

use serde_json::Value;

use super::{StockError, StockRequest, StockResult};

/// The immutable request stores this digest at schema acceptance. Ordered
/// arrays, explicit null, omitted fields and every child envelope remain intact.
pub fn request_digest(request: &StockRequest) -> &str {
    request.intent_digest()
}

pub(crate) fn intent_digest_value(request: &Value) -> StockResult<String> {
    let mut intent = request.clone();
    let root = intent
        .as_object_mut()
        .ok_or_else(|| StockError::invalid("stock request must be an object"))?;
    root.remove("requestId");
    root.remove("approvalReceiptId");
    if root
        .get("target")
        .and_then(|target| target.get("authority"))
        .and_then(Value::as_str)
        == Some("homebox")
        && let Some(preconditions) = root.get_mut("preconditions").and_then(Value::as_object_mut)
    {
        preconditions.remove("providerObservation");
    }
    super::super::semantics::canonical_digest(&intent)
        .map_err(|error| StockError::invalid(error.to_string()))
}
