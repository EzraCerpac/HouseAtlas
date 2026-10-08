//! Original and retained qualification for specialized Atlas stock mappings.
use super::{stock_repository as repo, *};
use crate::contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState};
use crate::domain::stock::{AtlasDerivation, OperationId, StockContractPort, ValidatedRequest};

pub(crate) fn validate_original<C: Contract>(
    contract: &C,
    request: &ValidatedRequest,
    original: &Snapshot,
    scope: &Scope,
    derivation: &AtlasDerivation,
) -> Result<()> {
    validate_derivation(request, derivation)?;
    validate_original_preimage(contract, original, scope, derivation)
}

/// Only the Store's closed original Presence command may select this mapping.
/// It retains the ordinary exact saved preimage check for remap.
pub(crate) fn validate_original_presence<C: Contract>(
    contract: &C,
    request: &ValidatedRequest,
    original: &Snapshot,
    scope: &Scope,
    derivation: &AtlasDerivation,
) -> Result<()> {
    validate_presence_derivation(request, derivation)?;
    validate_original_preimage(contract, original, scope, derivation)
}

fn validate_original_preimage<C: Contract>(
    contract: &C,
    original: &Snapshot,
    scope: &Scope,
    derivation: &AtlasDerivation,
) -> Result<()> {
    let Some(expected) = derivation_original(derivation) else {
        return Ok(());
    };
    let target = RecordRef {
        record_type: expected.record_type,
        record_id: expected.record_id.clone(),
    };
    let actual = original
        .records
        .iter()
        .find(|record| record.matches(scope, &target))
        .ok_or_else(repo::incompatible)?;
    if contract.canonical_json(&serde_json::to_value(actual)?)?
        != contract.canonical_json(&serde_json::to_value(expected)?)?
    {
        return Err(repo::incompatible());
    }
    Ok(())
}

/// Pure structural check; callers must first retain the original accepted
/// frame or an exact opaque historical cut. This never issues authority.
pub(crate) fn validate_retained_presence_preimage<C: Contract, S: StockContractPort>(
    commit: &StockAtlasCommit,
    stock: &S,
    contract: &C,
) -> Result<()> {
    use crate::domain::stock::ATLAS_DERIVATION_FORMAT;
    let request = ValidatedRequest::parse(stock, commit.original_request.clone())
        .map_err(|_| repo::incompatible())?;
    let (Some(ATLAS_DERIVATION_FORMAT), Some(derivation), None, None) = (
        commit.derivation_format.as_deref(),
        &commit.derivation,
        &commit.child_derivations,
        &commit.asset_review,
    ) else {
        return Err(repo::incompatible());
    };
    if request.id() == OperationId::AtlasBatchExecute || commit.groups.len() != 1 {
        return Err(repo::incompatible());
    }
    let group = &commit.groups[0];
    validate_group_envelope(&request, group, None)?;
    validate_presence_derivation(&request, derivation).map_err(|_| repo::incompatible())?;
    validate_group_original(&request, derivation, group, contract)
}

/// Require exact child alignment and at least one specialized mapper. All-direct
/// batches keep their old metadata-free retained format and execution API.
pub(crate) fn validate_batch_derivations(
    request: &ValidatedRequest,
    derivations: &[Option<AtlasDerivation>],
) -> Result<()> {
    if request.id() != OperationId::AtlasBatchExecute
        || request.children().is_empty()
        || derivations.len() != request.children().len()
        || !derivations.iter().any(Option::is_some)
    {
        return Err(repo::incompatible());
    }
    for (child, derivation) in request.children().iter().zip(derivations) {
        match derivation {
            Some(derivation) => validate_derivation(child, derivation)?,
            None if crate::domain::stock::atlas_direct_operation(child.id()).is_some() => {}
            None => return Err(repo::incompatible()),
        }
    }
    Ok(())
}

pub(crate) fn validate_retained_preimage<C: Contract, S: StockContractPort>(
    commit: &StockAtlasCommit,
    stock: &S,
    contract: &C,
) -> Result<()> {
    use crate::domain::stock::{ATLAS_BATCH_DERIVATION_FORMAT, ATLAS_DERIVATION_FORMAT};
    let request = ValidatedRequest::parse(stock, commit.original_request.clone())
        .map_err(|_| repo::incompatible())?;
    match (
        commit.derivation_format.as_deref(),
        &commit.derivation,
        &commit.child_derivations,
        &commit.asset_review,
    ) {
        (None, None, None, None) => Ok(()),
        (Some(ATLAS_DERIVATION_FORMAT), Some(derivation), None, None) => {
            if request.id() == OperationId::AtlasBatchExecute || commit.groups.len() != 1 {
                return Err(repo::incompatible());
            }
            validate_retained_group(&request, derivation, &commit.groups[0], None, contract)
        }
        (Some(ATLAS_BATCH_DERIVATION_FORMAT), None, Some(derivations), None) => {
            validate_batch_derivations(&request, derivations).map_err(|_| repo::incompatible())?;
            if commit.groups.len() != request.children().len() {
                return Err(repo::incompatible());
            }
            for (index, ((child, derivation), group)) in request
                .children()
                .iter()
                .zip(derivations)
                .zip(&commit.groups)
                .enumerate()
            {
                validate_group_envelope(child, group, Some(index))?;
                if let Some(derivation) = derivation {
                    validate_retained_group(child, derivation, group, Some(index), contract)?;
                }
            }
            Ok(())
        }
        (Some(ATLAS_VERIFIED_ASSET_REVIEW_FORMAT), Some(derivation), None, Some(facts)) => {
            validate_verified_review_data(&request, derivation, facts, commit, contract)?;
            validate_group_envelope(&request, &commit.groups[0], None)?;
            validate_group_original(&request, derivation, &commit.groups[0], contract)
        }
        _ => Err(repo::incompatible()),
    }
}

fn validate_group_envelope(
    request: &ValidatedRequest,
    group: &StockCommitGroup,
    child_index: Option<usize>,
) -> Result<()> {
    if group.child_index != child_index
        || group.original_request != *request.raw()
        || group.request_digest != request.intent_digest()
    {
        return Err(repo::incompatible());
    }
    Ok(())
}

fn validate_retained_group<C: Contract>(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
    group: &StockCommitGroup,
    child_index: Option<usize>,
    contract: &C,
) -> Result<()> {
    validate_group_envelope(request, group, child_index)?;
    validate_derivation(request, derivation).map_err(|_| repo::incompatible())?;
    validate_group_original(request, derivation, group, contract)
}

fn validate_group_original<C: Contract>(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
    group: &StockCommitGroup,
    contract: &C,
) -> Result<()> {
    let Some(original) = derivation_original(derivation) else {
        return Ok(());
    };
    if original.workspace_id != request.context().workspace_id
        || original.home_id != request.context().home_id
    {
        return Err(repo::incompatible());
    }
    let before_digest = super::repository::digest(contract, original)?;
    // An original must link to its own child group's audit, never a sibling's.
    let mut matches = group.native_results.iter().filter(|result| {
        result.audit.record.record_type == original.record_type
            && result.audit.record.record_id == original.record_id
    });
    let result = matches.next().ok_or_else(repo::incompatible)?;
    if matches.next().is_some()
        || result.audit.workspace_id != original.workspace_id
        || result.audit.home_id != original.home_id
        || result.audit.previous_revision != Some(original.revision)
        || result.audit.before_digest.as_deref() != Some(before_digest.as_str())
    {
        return Err(repo::incompatible());
    }
    Ok(())
}

pub(crate) fn validate_derivation(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
) -> Result<()> {
    let request_error = || Error::new("invalid-contract", "Derived stock mapping is incompatible");
    use OperationId as O;
    let aligned = matches!(
        (request.id(), derivation),
        (O::AtlasBindingCreate, AtlasDerivation::BindingCreate { .. })
            | (O::AtlasBindingReview, AtlasDerivation::BindingReview { .. })
            | (
                O::AtlasBindingRestore,
                AtlasDerivation::BindingRestore { .. }
            )
            | (O::AtlasBindingRemap, AtlasDerivation::BindingRemap { .. })
            | (
                O::AtlasGeometryCreate,
                AtlasDerivation::GeometryCreate { .. }
            )
            | (O::AtlasAssetReview, AtlasDerivation::AssetReview { .. })
    );
    if !aligned {
        return Err(request_error());
    }

    match derivation {
        AtlasDerivation::BindingCreate { source_state }
        | AtlasDerivation::BindingRemap { source_state, .. }
            if *source_state != BindingPayloadSourceState::Unresolved =>
        {
            return Err(request_error());
        }
        AtlasDerivation::AssetReview {
            preview_policy,
            renderer_receipt_id,
            ..
        } => {
            if *preview_policy == AssetPayloadPreviewPolicy::SafeRendered
                || request.payload()["treatment"] == "request-preview"
                || renderer_receipt_id.is_some()
            {
                return Err(Error::new(
                    "upstream-unavailable",
                    "Renderer qualification is unavailable",
                ));
            }
            if *preview_policy == AssetPayloadPreviewPolicy::Blocked
                && request.payload()["treatment"] != "block"
                || *preview_policy == AssetPayloadPreviewPolicy::DownloadOnly
                    && request.payload()["treatment"] != "download-only"
            {
                return Err(request_error());
            }
        }
        _ => {}
    }
    if let AtlasDerivation::GeometryCreate { imported_at } = derivation
        && (request.id() != OperationId::AtlasGeometryCreate
            || crate::domain::stock::operational_time(imported_at).is_err())
    {
        return Err(request_error());
    }
    Ok(())
}

pub(crate) fn validate_presence_derivation(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
) -> Result<()> {
    let accepted = matches!(
        (request.id(), derivation),
        (
            OperationId::AtlasBindingCreate,
            AtlasDerivation::BindingCreate {
                source_state: BindingPayloadSourceState::Present
            }
        ) | (
            OperationId::AtlasBindingRemap,
            AtlasDerivation::BindingRemap {
                source_state: BindingPayloadSourceState::Present,
                ..
            }
        )
    );
    if accepted {
        Ok(())
    } else {
        Err(Error::new(
            "invalid-contract",
            "Derived stock mapping is incompatible",
        ))
    }
}

fn derivation_original(derivation: &AtlasDerivation) -> Option<&Record> {
    match derivation {
        AtlasDerivation::BindingReview { original }
        | AtlasDerivation::BindingRestore { original }
        | AtlasDerivation::BindingRemap { original, .. }
        | AtlasDerivation::AssetReview { original, .. } => Some(original),
        AtlasDerivation::BindingCreate { .. } | AtlasDerivation::GeometryCreate { .. } => None,
    }
}

/// Retained DATA qualification only; no method here issues opaque Media proof,
/// original principal, Store custody or replay permission.
fn validate_verified_review_data<C: Contract>(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
    facts: &RetainedAssetReviewFacts,
    commit: &StockAtlasCommit,
    contract: &C,
) -> Result<()> {
    let AtlasDerivation::AssetReview {
        original,
        preview_policy: AssetPayloadPreviewPolicy::SafeRendered,
        renderer_receipt_id: Some(receipt_id),
    } = derivation
    else {
        return Err(repo::incompatible());
    };
    let receipt = &facts.renderer_receipt;
    let measured: crate::media::types::AssetRecord =
        serde_json::from_value(serde_json::to_value(original)?)?;
    contract.validate_shape("record", &serde_json::to_value(original)?)?;
    contract.validate_shape(
        "recordRef",
        &serde_json::json!({"recordType":"asset", "recordId":receipt.receipt_id}),
    )?;
    let digest = |s: &str| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    if request.id() != OperationId::AtlasAssetReview
        || request.payload()["treatment"] != "request-preview"
        || request.payload()["rendererReceiptId"] != *receipt_id
        || commit.replayed
        || commit.groups.len() != 1
        || commit.groups[0].native_results.len() != 1
        || commit.groups[0].native_entries.len() != 1
        || facts.format != "houseatlas-bound-asset-renderer-review/1"
        || receipt.format != "houseatlas-existing-asset-renderer-review/1"
        || receipt.renderer != "houseatlas-stripped-rgba8-png/1"
        || receipt.receipt_id != *receipt_id
        || receipt.actor_id != commit.actor_id
        || receipt.scope.workspace_id != original.workspace_id
        || receipt.scope.home_id != original.home_id
        || receipt.asset_id != original.record_id
        || receipt.revision != original.revision
        || original.record_type != RecordType::Asset
        || original.lifecycle != Lifecycle::Active
        || measured.payload.availability != crate::media::types::Availability::Available
        || !measured.payload.purpose.is_original()
        || receipt.original_sha256 != measured.payload.sha256
        || receipt.original_byte_size != measured.payload.byte_size
        || receipt.original_byte_size == 0
        || receipt.rendered_byte_size == 0
        || receipt.original_byte_size > crate::media::MAX_BYTES as u64
        || receipt.rendered_byte_size > crate::media::MAX_BYTES as u64
        || !digest(&receipt.original_sha256)
        || !digest(&receipt.rendered_sha256)
        || receipt.original_record_digest
            != crate::domain::stock::canonical_digest(&serde_json::to_value(original)?)
                .map_err(|_| repo::incompatible())?
        || facts.request_digest
            != crate::domain::stock::canonical_digest(request.raw())
                .map_err(|_| repo::incompatible())?
        || commit.groups[0].operation_id != commit.operation_id
    {
        return Err(repo::incompatible());
    }
    Ok(())
}
