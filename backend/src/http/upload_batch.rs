//! Fresh upload batch data from actual intake and a genuinely sealed asset.
use crate::{
    app::{RequestPrincipal, ServerRuntime},
    domain::stock::{self as st, OperationId as O},
    http::{
        qualified_upload_plan::{self, ResolvedPlace},
        upload_intake::UploadMetadata,
    },
    media::staged_upload::StagedAssetPlan,
    storage::Runtime,
};
use serde_json::json;

/// Server facts for this one fresh intake; no Deserialize or public constructor.
/// These IDs/time are data and confer no authority or consumed-upload proof.
pub struct FreshUploadInputs {
    batch_id: String,
    evidence_id: String,
    evidence_request_id: String,
    evidence_key: String,
    identity_request_id: String,
    identity_key: String,
    retrieved_at: String,
}

impl FreshUploadInputs {
    /// Call once after actual intake, before entering the commit fence. This
    /// separate helper uses only the real host's ID issuer and clock; the pure
    /// builder below performs no IO. The asset ID remains exclusively Media's.
    pub fn capture_server_intake() -> st::StockResult<Self> {
        let runtime = ServerRuntime;
        let issue = || {
            runtime
                .new_id()
                .map_err(|_| st::StockError::OwnerUnavailable)
        };
        Ok(Self {
            batch_id: issue()?,
            evidence_id: issue()?,
            evidence_request_id: issue()?,
            evidence_key: issue()?,
            identity_request_id: issue()?,
            identity_key: issue()?,
            retrieved_at: runtime
                .now()
                .map_err(|_| st::StockError::OwnerUnavailable)?,
        })
    }
}

/// Preserve the exact original UI intent and authentic Media asset envelope.
/// `selection` must have been resolved with this same original principal before
/// the mutation fence, because the resolver performs genuine Access/Store reads.
/// This function is pure and returns the actual owner's stage-borrowing plan.
pub fn plan_fresh_upload_batch<'u>(
    principal: &RequestPrincipal,
    selection: &ResolvedPlace<'_, '_>,
    metadata: &UploadMetadata,
    staged: &'u StagedAssetPlan,
    inputs: &FreshUploadInputs,
) -> st::StockResult<st::StagedAtlasCommandPlan<'u>> {
    if !std::ptr::eq(selection.metadata(), metadata) {
        return Err(st::StockError::AuthorityChanged);
    }
    let guards = selection.stock_guards();
    let asset = staged.request();
    // Never repair/rebind an already sealed child. Resolve first, then build and
    // seal its original intent with these complete original+semantics guards.
    if asset.id() != O::AtlasAssetCreate
        || asset.target()["recordId"] != staged.asset_id()
        || asset.raw()["context"] != json!(metadata.context)
        || asset.raw()["reason"] != metadata.reason
        || asset.raw()["preconditions"]["guards"] != guards
        || !asset.raw()["preconditions"]["target"].is_null()
        || !asset.raw()["approvalReceiptId"].is_null()
    {
        return Err(st::StockError::AuthorityChanged);
    }
    let schemas = st::NativeStockContract::new()?;
    let evidence = st::ValidatedRequest::parse(
        &schemas,
        json!({
            "schemaVersion": 3, "commandId": "atlas.evidence.create",
            "requestId": inputs.evidence_request_id, "context": metadata.context,
            "target": {"authority": "atlas", "recordType": "evidence",
                "recordId": inputs.evidence_id},
            "payload": evidence_payload(metadata, inputs, staged.asset_id()),
            "idempotencyKey": inputs.evidence_key, "reason": metadata.reason,
            "preconditions": {"target": null, "guards": guards},
            "approvalReceiptId": null
        }),
    )?;
    let identity = selection.identity_request(
        &inputs.identity_request_id,
        &inputs.identity_key,
        &inputs.evidence_id,
    )?;
    let root = st::ValidatedRequest::parse(
        &schemas,
        json!({
            "schemaVersion": 3, "commandId": "atlas.batch.execute",
            "requestId": metadata.request_id, "context": metadata.context,
            "target": {"authority": "atlas", "kind": "batch", "batchId": inputs.batch_id},
            "payload": {"commands": [asset.raw().clone(), evidence.raw().clone(), identity.raw().clone()]},
            "idempotencyKey": metadata.idempotency_key, "reason": metadata.reason,
            "preconditions": {"target": null, "guards": guards},
            "approvalReceiptId": null
        }),
    )?;
    // Existing root qualification preserves outer/inner principal identity and
    // original metadata/file/license/purpose, then calls the genuine factory.
    qualified_upload_plan::qualify(principal, selection, &root, staged)
}

/// Build a fresh evidence intent referencing the exact authorized original.
pub fn plan_existing_upload_batch<'u>(
    principal: &RequestPrincipal,
    selection: &ResolvedPlace<'_, '_>,
    metadata: &UploadMetadata,
    asset: &'u crate::storage::ExistingOriginalAsset,
    measured: &'u crate::domain::stock::MeasuredAttachmentOriginal,
    inputs: &FreshUploadInputs,
) -> st::StockResult<st::ExistingAssetAttachmentPlan<'u>> {
    if !std::ptr::eq(selection.metadata(), metadata) {
        return Err(st::StockError::AuthorityChanged);
    }
    let guards = qualified_upload_plan::existing_stock_guards(selection, asset)?;
    let schemas = st::NativeStockContract::new()?;
    let evidence = st::ValidatedRequest::parse(
        &schemas,
        json!({
            "schemaVersion":3,"commandId":"atlas.evidence.create",
            "requestId":inputs.evidence_request_id,"context":metadata.context,
            "target":{"authority":"atlas","recordType":"evidence","recordId":inputs.evidence_id},
            "payload":evidence_payload(metadata, inputs, asset.asset_id()),
            "idempotencyKey":inputs.evidence_key,"reason":metadata.reason,
            "preconditions":{"target":null,"guards":guards},"approvalReceiptId":null
        }),
    )?;
    let mut identity = selection
        .identity_request(
            &inputs.identity_request_id,
            &inputs.identity_key,
            &inputs.evidence_id,
        )?
        .raw()
        .clone();
    identity["preconditions"]["guards"] = guards.clone();
    let identity = st::ValidatedRequest::parse(&schemas, identity)?;
    let root = st::ValidatedRequest::parse(
        &schemas,
        json!({
            "schemaVersion":3,"commandId":"atlas.batch.execute","requestId":metadata.request_id,
            "context":metadata.context,"target":{"authority":"atlas","kind":"batch","batchId":inputs.batch_id},
            "payload":{"commands":[evidence.raw().clone(),identity.raw().clone()]},
            "idempotencyKey":metadata.idempotency_key,"reason":metadata.reason,
            "preconditions":{"target":null,"guards":guards},"approvalReceiptId":null
        }),
    )?;
    qualified_upload_plan::qualify_existing(principal, selection, &root, asset, measured)
}

/// Preserve browser labels separately from server retrieval and unknown fact time.
fn evidence_payload(
    metadata: &UploadMetadata,
    inputs: &FreshUploadInputs,
    asset_id: &str,
) -> serde_json::Value {
    let payload = json!({
        "statement":metadata.statement,"provenance":{
            "source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"unknown",
            "factAt":null,"retrievedAt":inputs.retrieved_at,"vantage":metadata.capture.as_ref().map(|capture| capture.vantage()),
            "uncertainty":{"status":"unknown","explanation":null}},
        "supersedesEvidenceIds":[],"references":[{"kind":"atlas-asset","assetId":asset_id}]
    });
    payload
}
