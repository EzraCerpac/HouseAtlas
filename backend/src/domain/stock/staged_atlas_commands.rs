//! Qualified mapping of a media-owned sealed stage and its original stock intent.
//! No bytes, source witness, authority or consumed-token receipt are fabricated.
//! Storage must consume the original stage in its existing atomic transaction.

use super::atlas_commands::{map_group, map_group_with_payload, plan_atlas_commands_with};
use super::{
    AtlasCommandPlan, OperationId, StockError, StockResult, ValidatedRequest, canonical_digest,
};
use crate::media::staged_upload::StagedAssetPlan;
use crate::storage::{Contract, Operation};

/// Privately constructed qualified data, borrowing the exact live media seal.
/// Read-only access neither authorizes execution nor consumes an upload token.
pub struct StagedAtlasCommandPlan<'u> {
    staged: &'u StagedAssetPlan,
    plan: AtlasCommandPlan,
}

impl<'u> StagedAtlasCommandPlan<'u> {
    pub fn staged(&self) -> &'u StagedAssetPlan {
        self.staged
    }

    pub fn plan(&self) -> &AtlasCommandPlan {
        &self.plan
    }
}

/// Map one original asset create, optionally with explicitly connected evidence
/// creates inside the existing ordered `atlas.batch.execute` root. The host's
/// three-child upload batch may finish with its guarded PLACE identity replace.
/// Full envelopes remain unchanged, including guards and approval references.
pub fn plan_staged_atlas_commands<'u>(
    root: &ValidatedRequest,
    staged: &'u StagedAssetPlan,
    native: &impl Contract,
) -> StockResult<StagedAtlasCommandPlan<'u>> {
    let asset = asset_request(root)?;
    if staged.request().id() != OperationId::AtlasAssetCreate
        || canonical_digest(asset.raw())? != canonical_digest(staged.request().raw())?
        || asset.target()["recordType"] != "asset"
        || asset.target()["recordId"] != staged.asset_id()
    {
        return Err(StockError::CorrelationMismatch);
    }
    let place = upload_place_replacement(root)?;
    for (index, child) in root.children().iter().enumerate() {
        if child.id() != OperationId::AtlasAssetCreate
            && place != Some(index)
            && (child.id() != OperationId::AtlasEvidenceCreate
                || !explicitly_connected(child, asset, staged.asset_id())?)
        {
            return Err(StockError::CapabilityHeld);
        }
    }
    let payload =
        serde_json::to_value(staged.payload()).map_err(|_| StockError::OwnerUnavailable)?;
    let plan = plan_atlas_commands_with(root, native, |request, index| {
        if request.id() == OperationId::AtlasAssetCreate {
            map_group_with_payload(request, index, native, Operation::Create, &payload)
        } else {
            map_group(request, index, native)
        }
    })?;
    Ok(StagedAtlasCommandPlan { staged, plan })
}

fn upload_place_replacement(root: &ValidatedRequest) -> StockResult<Option<usize>> {
    let children = root.children();
    if children
        .iter()
        .all(|child| child.id() != OperationId::AtlasIdentityReplace)
    {
        return Ok(None);
    }
    if children.len() != 3
        || children[0].id() != OperationId::AtlasAssetCreate
        || children[1].id() != OperationId::AtlasEvidenceCreate
        || children[2].id() != OperationId::AtlasIdentityReplace
    {
        return Err(StockError::CapabilityHeld);
    }
    let place = &children[2];
    let evidence_ids = place.payload()["evidenceIds"]
        .as_array()
        .ok_or(StockError::InvalidContract)?;
    if place.target()["recordType"] != "identity"
        || place.payload()["kind"] != "location"
        || place.raw()["preconditions"]["target"]["kind"] != "atlas"
        || !evidence_ids
            .iter()
            .any(|id| id == &children[1].target()["recordId"])
    {
        return Err(StockError::CapabilityHeld);
    }
    Ok(Some(2))
}

fn asset_request(root: &ValidatedRequest) -> StockResult<&ValidatedRequest> {
    if root.id() == OperationId::AtlasAssetCreate {
        return Ok(root);
    }
    if root.id() != OperationId::AtlasBatchExecute {
        return Err(StockError::CapabilityHeld);
    }
    let mut assets = root
        .children()
        .iter()
        .filter(|request| request.id() == OperationId::AtlasAssetCreate);
    let asset = assets.next().ok_or(StockError::CapabilityHeld)?;
    if assets.next().is_some() {
        return Err(StockError::CapabilityHeld);
    }
    Ok(asset)
}

fn explicitly_connected(
    evidence: &ValidatedRequest,
    asset: &ValidatedRequest,
    asset_id: &str,
) -> StockResult<bool> {
    let evidence_ids = asset.payload()["evidenceIds"]
        .as_array()
        .ok_or(StockError::InvalidContract)?;
    let references = evidence.payload()["references"]
        .as_array()
        .ok_or(StockError::InvalidContract)?;
    Ok(evidence_ids
        .iter()
        .any(|id| id == &evidence.target()["recordId"])
        || references.iter().any(|reference| {
            reference["kind"] == "atlas-asset" && reference["assetId"] == asset_id
        }))
}
