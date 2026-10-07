//! New attachment intent referencing an existing scoped original unchanged.
//! Resolution, measured-byte verification and authorization stay with owners.

use super::{
    AtlasCommandPlan, MeasuredAttachmentOriginal, OperationId, StockError, StockResult,
    ValidatedRequest, canonical_digest, plan_atlas_commands,
};
use crate::{
    access::Principal,
    media::types::{AssetPurpose, Scope as MediaScope},
    storage::{Contract, ExistingOriginalAsset, Lifecycle, Record, RecordType},
};
use serde_json::{Value, json};

/// Qualified plan data borrowing Storage's exact resolved original and Media's
/// measured original. Neither carrier grants attachment authority.
pub struct ExistingAssetAttachmentPlan<'a> {
    asset: &'a ExistingOriginalAsset,
    measured: &'a MeasuredAttachmentOriginal,
    plan: AtlasCommandPlan,
}

impl ExistingAssetAttachmentPlan<'_> {
    pub fn asset(&self) -> &ExistingOriginalAsset {
        self.asset
    }

    pub fn measured(&self) -> &MeasuredAttachmentOriginal {
        self.measured
    }

    pub fn plan(&self) -> &AtlasCommandPlan {
        &self.plan
    }
}

/// Plan evidence-create then guarded PLACE-replace for identical scoped bytes.
/// The host must use Storage's authorized original resolver with its original
/// principal and Media's measured original, then retain the same witness/graph/fence
/// through ordinary native stock execution. No asset command, stage consumption
/// or asset provenance update is emitted. The native owner rechecks all guards,
/// current availability, graph membership, audits and result authorization.
pub fn plan_existing_asset_attachment<'a>(
    principal: &Principal,
    root: &ValidatedRequest,
    asset: &'a ExistingOriginalAsset,
    measured: &'a MeasuredAttachmentOriginal,
    native: &impl Contract,
) -> StockResult<ExistingAssetAttachmentPlan<'a>> {
    if !std::ptr::eq(principal, measured.original_principal().principal())
        || principal.scope().workspace_id.as_str() != root.context().workspace_id
        || principal.scope().home_id.as_str() != root.context().home_id
        || root.raw()["requestId"] != measured.request_id()
        || root.raw()["idempotencyKey"] != measured.idempotency_key()
    {
        return Err(StockError::AuthorityChanged);
    }
    let prepared = measured.prepared();
    let record = asset.record();
    native
        .validate_shape(
            "record",
            &serde_json::to_value(record).map_err(|_| StockError::OwnerUnavailable)?,
        )
        .map_err(|error| {
            if error.code == "invalid-contract" {
                StockError::InvalidContract
            } else {
                StockError::OwnerUnavailable
            }
        })?;
    let scope = MediaScope {
        workspace_id: root.context().workspace_id.clone(),
        home_id: root.context().home_id.clone(),
    };
    let key = scope
        .storage_key(&prepared.identity.sha256)
        .map_err(|_| StockError::InvalidContract)?;
    if record.record_type != RecordType::Asset
        || record.lifecycle != Lifecycle::Active
        || record.workspace_id != scope.workspace_id
        || record.home_id != scope.home_id
        || record.payload["owner"] != "atlas"
        || record.payload["availability"] != "available"
        || record.payload["purpose"] != "evidence-original"
        || prepared.purpose != AssetPurpose::EvidenceOriginal
        || prepared.storage_key != key
        || record.payload["storageKey"] != key
        || record.payload["sha256"] != prepared.identity.sha256
        || canonical_digest(&record.payload["byteSize"])?
            != canonical_digest(&json!(prepared.identity.byte_size))?
        || record.payload["contentType"] != prepared.content_type.as_str()
    {
        return Err(StockError::CorrelationMismatch);
    }
    let children = root.children();
    if root.id() != OperationId::AtlasBatchExecute
        || children.len() != 2
        || children[0].id() != OperationId::AtlasEvidenceCreate
        || children[1].id() != OperationId::AtlasIdentityReplace
    {
        return Err(StockError::CapabilityHeld);
    }
    let evidence = &children[0];
    let place = &children[1];
    let evidence_ids = place.payload()["evidenceIds"]
        .as_array()
        .ok_or(StockError::InvalidContract)?;
    if evidence.payload()["references"]
        != json!([{"kind":"atlas-asset","assetId":asset.asset_id()}])
        || place.target()["recordType"] != "identity"
        || place.payload()["kind"] != "location"
        || place.raw()["preconditions"]["target"]["kind"] != "atlas"
        || evidence_ids
            .iter()
            .filter(|id| *id == &evidence.target()["recordId"])
            .count()
            != 1
    {
        return Err(StockError::CorrelationMismatch);
    }
    for request in [root, evidence, place] {
        require_asset_guard(request.raw(), record)?;
    }
    let plan = plan_atlas_commands(root, native)?;
    Ok(ExistingAssetAttachmentPlan {
        asset,
        measured,
        plan,
    })
}

fn require_asset_guard(raw: &Value, asset: &Record) -> StockResult<()> {
    let guards = raw["preconditions"]["guards"]
        .as_array()
        .ok_or(StockError::InvalidContract)?;
    let expected = json!({"target":{"authority":"atlas","recordType":"asset",
        "recordId":asset.record_id},"revision":{"kind":"atlas","value":asset.revision}});
    let digest = canonical_digest(&expected)?;
    let mut count = 0;
    for guard in guards {
        if canonical_digest(guard)? == digest {
            count += 1;
        }
    }
    if count != 1 {
        return Err(StockError::CorrelationMismatch);
    }
    Ok(())
}
