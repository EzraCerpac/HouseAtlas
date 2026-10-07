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

pub(crate) fn validate_retained_preimage<C: Contract, S: StockContractPort>(
    commit: &StockAtlasCommit,
    stock: &S,
    contract: &C,
) -> Result<()> {
    match (&commit.derivation_format, &commit.derivation) {
        (None, None) => return Ok(()),
        (Some(format), Some(derivation))
            if format == crate::domain::stock::ATLAS_DERIVATION_FORMAT =>
        {
            let request = ValidatedRequest::parse(stock, commit.original_request.clone())
                .map_err(|_| repo::incompatible())?;
            validate_derivation(&request, derivation).map_err(|_| repo::incompatible())?;
            let Some(original) = derivation_original(derivation) else {
                return Ok(());
            };
            if original.workspace_id != request.context().workspace_id
                || original.home_id != request.context().home_id
            {
                return Err(repo::incompatible());
            }
            let before_digest = super::repository::digest(contract, original)?;
            let mut matches = commit
                .groups
                .iter()
                .flat_map(|group| group.native_results.iter())
                .filter(|result| {
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
        _ => Err(repo::incompatible()),
    }
}

pub(crate) fn validate_derivation(
    request: &ValidatedRequest,
    derivation: &AtlasDerivation,
) -> Result<()> {
    let request_error = || Error::new("invalid-contract", "Derived stock mapping is incompatible");
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
    if let AtlasDerivation::GeometryCreate { imported_at } = derivation {
        if request.id() != OperationId::AtlasGeometryCreate
            || crate::domain::stock::operational_time(imported_at).is_err()
        {
            return Err(request_error());
        }
    }
    Ok(())
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
