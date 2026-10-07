//! Pure mapping from storage's checked durable upload consumption.
//! This restores no media stage, principal, grant or execution authority.

use super::staged_atlas_commands::plan_upload_atlas_commands;
use super::{AtlasCommandPlan, StockError, StockResult, ValidatedRequest, canonical_digest};
use crate::storage::{ConsumedUpload, Contract};

/// Regenerate the original upload's native plan using its retained creation
/// payload. Storage must first validate the complete durable root/asset binding,
/// actor, scope, group and native receipt/audit/manifest association in the same
/// snapshot before issuing this private-field carrier. Call with the validated
/// original retained root; current response authorization remains owner work.
pub fn plan_retained_staged_atlas_commands(
    root: &ValidatedRequest,
    consumed: &ConsumedUpload,
    native: &impl Contract,
) -> StockResult<AtlasCommandPlan> {
    let plan = plan_upload_atlas_commands(
        root,
        consumed.asset_request(),
        consumed.asset_id(),
        native,
        || Ok(consumed.asset_payload().clone()),
    )?;
    let group = plan
        .groups()
        .get(consumed.group_ordinal())
        .ok_or(StockError::CorrelationMismatch)?;
    if plan.scope() != consumed.scope()
        || canonical_digest(group.original_request())?
            != canonical_digest(consumed.asset_request())?
    {
        return Err(StockError::CorrelationMismatch);
    }
    Ok(plan)
}
