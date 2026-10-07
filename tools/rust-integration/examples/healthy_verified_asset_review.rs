//! Positive Storage consumer for an opaque Media-verified existing-asset
//! review. This helper is mounted by the specialized Atlas example; it uses
//! that fixture's actual Access principal and Store rather than creating a
//! separate authority or listener.

use houseatlas_backend::{
    access as a,
    app::Core,
    contracts::stock as wire,
    domain::stock as st,
    lifecycle::Failure,
    media::{
        Cancellation, WorkBudget,
        types::{AssetPurpose, ContentType, LicenseStatus, PreviewPolicy, Scope, SourceLicense},
    },
    storage as s,
};
use serde_json::{Value, json};
use std::{cell::RefCell, io::Cursor, path::Path, time::Duration};

use super::{id, principal, target};

fn budget() -> Result<WorkBudget, s::Error> {
    WorkBudget::new(Duration::from_secs(10), Cancellation::default())
        .map_err(|_| s::Error::new("unavailable", "Fixture media budget unavailable"))
}

/// Adds the actual privately retained PNG original already prepared by this
/// disposable lifecycle fixture to the synthetic graph used to bootstrap the
/// isolated Store. The content bytes are re-measured by the existing vault;
/// the snapshot receives only the resulting typed payload.
pub fn seed_existing(core: &Core, directory: &Path, published: &mut Value) -> Result<(), Failure> {
    use base64::Engine as _;

    let receipt: Value =
        serde_json::from_slice(&std::fs::read(directory.join("smoke-session.json"))?)?;
    let media = receipt["preparedMedia"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["assetId"] == id(950)))
        .ok_or("Missing privately prepared fixture asset 950")?;
    let encoded = media["originalBase64"]
        .as_str()
        .ok_or("Missing retained fixture bytes")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)?;
    let scope = Scope {
        workspace_id: core.home.scope.workspace_id.clone(),
        home_id: core.home.scope.home_id.clone(),
    };
    let prepared = core.vault.prepare_original(
        &scope,
        AssetPurpose::EvidenceOriginal,
        ContentType::Png,
        &mut Cursor::new(&bytes),
        &budget()?,
    )?;
    let mut payload = prepared.with_provenance(
        SourceLicense {
            status: LicenseStatus::Unknown,
            reference: None,
        },
        vec![id(100)],
    )?;
    if serde_json::to_value(&payload)? != media["payload"] {
        return Err("Measured retained asset metadata differs from lifecycle seed".into());
    }
    // Restrict only synthetic initial policy so this case demonstrates the
    // genuine proof-qualified transition. Measured immutable bytes, purpose
    // and availability remain exactly those supplied by the owner vault.
    payload.preview_policy = PreviewPolicy::DownloadOnly;
    payload.validate()?;
    let records = published["records"]
        .as_array_mut()
        .ok_or("Missing fixture records")?;
    if records.iter().any(|row| row["recordId"] == id(950)) {
        return Err("Fixture asset 950 is already present in the graph".into());
    }
    records.push(json!({
        "schemaVersion": 1,
        "recordType": "asset",
        "recordId": id(950),
        "workspaceId": scope.workspace_id,
        "homeId": scope.home_id,
        "revision": 1,
        "lifecycle": "active",
        "createdAt": "2026-01-02T12:00:00Z",
        "updatedAt": "2026-01-02T12:00:00Z",
        "lastAuditId": id(10950),
        "payload": payload,
    }));
    Ok(())
}

pub fn healthy(core: &Core, cookie: &str, csrf: &str) -> Result<s::StockAtlasCommit, Failure> {
    let path = format!(
        "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
        core.home.scope.workspace_id, core.home.scope.home_id
    );
    let principal = Box::new(principal(core, cookie, csrf, true, &path)?);
    let retained = principal.principal.retained();
    let scope = s::Scope {
        workspace_id: core.home.scope.workspace_id.clone(),
        home_id: core.home.scope.home_id.clone(),
    };
    let target_ref = s::RecordRef {
        record_type: s::RecordType::Asset,
        record_id: id(950),
    };
    let contracts = st::NativeStockContract::new()?;
    let validator = wire::StockValidation::new()?;

    // Pin both the complete graph preimage and the exact authorized asset row
    // before Media creates opaque renderer evidence.
    let (original, original_pin) = {
        let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
        let original = store.read_snapshot(&principal, &scope)?;
        let pinned =
            store.capture_asset_review_original(&principal, retained, &scope, &target_ref)?;
        (original, pinned)
    };
    let original_record = original_pin.record().clone();
    if original_record.record_id != id(950)
        || original_record.revision != 1
        || original_record.lifecycle != s::Lifecycle::Active
        || original_record.payload["availability"] != "available"
        || original_record.payload["previewPolicy"] != "download-only"
    {
        return Err("Fixture asset 950 is not the retained available original".into());
    }

    // Issue only genuine Source/partition grants for the source-bearing rows
    // in this exact original snapshot. The review command itself adds no
    // source disclosure requirement.
    let mut references = Vec::<a::SourceRef>::new();
    for record in &original.records {
        if record.record_type == s::RecordType::Binding && !record.payload["source"].is_null() {
            let reference: a::SourceRef = serde_json::from_value(json!({
                "workspaceId":scope.workspace_id,
                "homeId":scope.home_id,
                "key":record.payload["source"]
            }))?;
            if !references.contains(&reference) {
                references.push(reference);
            }
        }
    }
    let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
    let mut source_grants = Vec::new();
    let mut partition_grants = Vec::new();
    for reference in &references {
        source_grants.push(access.authorize_source(principal.principal.principal(), reference)?);
        let partition = reference.partition();
        if !partition_grants
            .iter()
            .any(|grant: &a::PartitionGrant| grant.partition() == &partition)
        {
            partition_grants.push(
                access.authorize_source_partition(principal.principal.principal(), &partition)?,
            );
        }
    }

    let committed = RefCell::new(None);
    access.with_mutation_authorization::<Failure>(principal.principal.principal(), |guard| {
        let budget = budget()?;
        let rendered =
            core.vault
                .qualify_asset_review(guard, retained, &original_record, &budget)?;
        let raw = json!({
            "schemaVersion": 3,
            "commandId": "atlas.asset.review",
            "requestId": id(12001),
            "context": {"workspaceId":scope.workspace_id,"homeId":scope.home_id},
            "target": target("asset", 950),
            "payload": {
                "treatment": "request-preview",
                "rendererReceiptId": rendered.receipt_id(),
                "evidenceIds": [id(100)]
            },
            "idempotencyKey": id(12002),
            "reason": "Fresh opaque renderer review of the retained synthetic original",
            "approvalReceiptId": null,
            "preconditions": {
                "target": {"kind":"atlas","value":1},
                "guards": [super::guard("evidence", 100, original.records.iter().find(|record| record.record_id == id(100)).ok_or("Original evidence unavailable")?.revision)]
            }
        });
        let typed_request = wire::StockRequest::parse(&validator, raw.clone())?;
        let validated = st::ValidatedRequest::parse(&contracts, raw.clone())?;
        let proof = rendered.bind_request(guard, retained, &validated, &budget)?;
        if !std::ptr::eq(
            proof.original_principal().principal(),
            principal.principal.principal(),
        ) {
            return Err("Renderer proof lost its original Access principal".into());
        }
        let bound = {
            let store = core.store.lock().map_err(|_| "Store unavailable")?;
            store.prepare_verified_asset_review(
                &principal,
                &contracts,
                &raw,
                &original_pin,
                &proof,
            )?
        };
        if bound.plan().groups().len() != 1 || bound.plan().groups()[0].child_index().is_some() {
            return Err("Verified review did not produce one single-command owner plan".into());
        }
        match bound.derivation() {
            st::AtlasDerivation::AssetReview {
                original,
                preview_policy,
                renderer_receipt_id,
            } if original == &original_record
                && *preview_policy
                    == houseatlas_backend::contracts::AssetPayloadPreviewPolicy::SafeRendered
                && renderer_receipt_id.as_deref() == Some(proof.facts().receipt_id()) => {}
            _ => return Err("Store plan did not retain the qualified review derivation".into()),
        }
        let authorization = super::healthy_mixed_derived_atlas::FixtureAuthorization::new(
            guard,
            &principal,
            &raw,
            &source_grants,
            &partition_grants,
            &original,
            bound.plan(),
        );
        let commit = core
            .store
            .lock()
            .map_err(|_| "Store unavailable")?
            .execute_verified_asset_review_stock_json_with_authorization(
                &authorization,
                &principal,
                &contracts,
                &raw,
                s::AssetReviewCommitPeers::new(&bound, guard, &budget),
            )?;
        wire::StockResponse::parse(
            &validator,
            &typed_request,
            commit.wire.clone(),
            &commit.children,
        )?;
        assert!(!commit.replayed);
        assert_eq!(commit.wire["operationId"], commit.operation_id);
        assert_eq!(commit.groups.len(), 1);
        assert_eq!(commit.groups[0].operation_id, commit.operation_id);
        assert!(commit.children.is_empty());
        assert_eq!(commit.groups[0].native_results.len(), 1);
        let result = &commit.groups[0].native_results[0];
        assert_eq!(result.record.record_id, id(950));
        assert_eq!(result.record.revision, 2);
        assert_eq!(result.record.payload["previewPolicy"], "safe-rendered");
        assert_eq!(result.record.payload["availability"], "available");
        assert_eq!(result.audit.audit_id, result.record.last_audit_id);
        assert_eq!(result.audit.record.record_id, id(950));
        assert_eq!(result.audit.result_revision, 2);
        assert_eq!(commit.wire["status"], "committed");
        assert_eq!(commit.wire["commandId"], "atlas.asset.review");
        assert_eq!(commit.wire["requestId"], raw["requestId"]);
        assert_eq!(commit.wire["data"]["requestDigest"], commit.request_digest);
        assert_eq!(
            commit.wire["data"]["auditIds"],
            json!([result.audit.audit_id])
        );
        assert_eq!(commit.wire["data"]["records"][0]["revision"], 2);
        assert_eq!(
            commit.wire["data"]["records"][0]["payload"]["previewPolicy"],
            "safe-rendered"
        );
        let facts = serde_json::to_value(
            commit
                .asset_review
                .as_ref()
                .ok_or("Missing retained renderer facts")?,
        )?;
        assert_eq!(facts["format"], "houseatlas-bound-asset-renderer-review/1");
        assert_eq!(
            facts["rendererReceipt"]["format"],
            "houseatlas-existing-asset-renderer-review/1"
        );
        assert_eq!(facts["rendererReceipt"]["assetId"], id(950));
        assert_eq!(facts["rendererReceipt"]["revision"], 1);
        assert_eq!(
            facts["rendererReceipt"]["actorId"],
            principal.principal.principal().actor_id().as_str()
        );
        assert_eq!(
            facts["rendererReceipt"]["originalSha256"],
            original_record.payload["sha256"]
        );
        assert!(
            facts["rendererReceipt"]["renderedSha256"]
                .as_str()
                .is_some_and(|value| value.len() == 64)
        );
        assert!(
            facts["rendererReceipt"]["renderedByteSize"]
                .as_u64()
                .is_some_and(|value| value > 0)
        );
        assert_eq!(
            facts["rendererReceipt"]["receiptId"],
            proof.facts().receipt_id()
        );
        assert_eq!(facts["requestDigest"], proof.request_digest());
        assert_eq!(
            serde_json::to_value(
                commit
                    .asset_review
                    .as_ref()
                    .ok_or("Missing retained renderer facts")?
            )?,
            serde_json::to_value(bound.retained_facts())?
        );
        assert_eq!(commit.derivation.as_ref(), Some(bound.derivation()));
        assert_eq!(
            commit.derivation_format.as_deref(),
            Some(s::ATLAS_VERIFIED_ASSET_REVIEW_FORMAT)
        );
        *committed.borrow_mut() = Some(commit);
        Ok(())
    })?;
    drop(access);
    let commit = committed
        .into_inner()
        .ok_or("Verified review did not return a Store commit")?;
    // ReadAuthority reacquires Access, so obtain the durable successor only
    // after releasing the Access mutex and its transaction guard.
    let post = core
        .store
        .lock()
        .map_err(|_| "Store unavailable")?
        .read_snapshot(&principal, &scope)?;
    let unchanged_asset = |snapshot: &s::Snapshot| {
        snapshot
            .records
            .iter()
            .find(|record| record.record_id == id(600))
            .cloned()
    };
    assert_eq!(unchanged_asset(&post), unchanged_asset(&original));
    let reviewed_after = post
        .records
        .iter()
        .find(|record| record.record_id == id(950))
        .ok_or("Reviewed asset disappeared from the Store")?;
    assert_eq!(reviewed_after.revision, 2);
    assert_eq!(reviewed_after.payload["previewPolicy"], "safe-rendered");
    Ok(commit)
}
