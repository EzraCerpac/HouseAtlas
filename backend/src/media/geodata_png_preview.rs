//! Trusted single-original PNG display derivation for native Document v2.
//!
//! A supplied GIS visualization may itself be the original PNG Document. This
//! helper derives only that PNG's stripped display pixels; it makes no claim
//! about GIS geometry, composite inputs, placement, source authority or access.
//! The native owner must supply authenticated scoped records/retained bytes and
//! atomically retain the output, lineage and receipt under its existing guards.
use super::{
    MAX_BYTES, MediaError, MediaResult, WorkBudget, content,
    geodata_document::AssetPin,
    types::{Scope, sha256},
};
use crate::contracts::v2;
use serde_json::{Value, json};

const RENDERER: &str = "houseatlas.native-png-display";
const RENDERER_VERSION: &str = "1";
const DESCRIPTION: &str = "Display of the supplied original PNG only; metadata stripped, RGBA8 output. No GIS geometry conversion, composite derivation, spatial alignment or source accuracy qualification.";
const MAX_RECEIPT_BYTES: usize = 16 * 1024;

fn need(ok: bool) -> MediaResult<()> {
    if ok {
        Ok(())
    } else {
        Err(MediaError::InvalidInput)
    }
}

fn shape(name: &str, value: &Value) -> MediaResult<()> {
    v2::validate_value(name, value).map_err(|_| MediaError::InvalidInput)
}

fn canonical(value: &Value) -> MediaResult<String> {
    serde_jcs::to_string(value).map_err(|_| MediaError::InvalidInput)
}

fn config_sha256() -> MediaResult<String> {
    // Pin the actual decoder/encoder sources and locked codec dependencies, not
    // caller-provided renderer labels. An implementation/lock change deliberately
    // requires fresh qualification rather than silently accepting older output.
    let config = json!({
        "profile": "houseatlas.native-png-display-config.v1",
        "contentSourceSha256": sha256(include_bytes!("content.rs")),
        "decoderSourceSha256": sha256(include_bytes!("png_decode.rs")),
        "dependencyLockSha256": sha256(include_bytes!("../../../Cargo.lock")),
        "maxInputBytes": MAX_BYTES,
        "maxPixels": 25_000_000,
        "maxPreviewRowBytes": content::MAX_PNG_PREVIEW_ROW_BYTES,
        "output": "noninterlaced-rgba8-png",
        "rowFilter": 0,
        "compressionLevel": 6,
        "metadata": "stripped",
        "crop": null,
        "inputs": 1
    });
    Ok(sha256(canonical(&config)?.as_bytes()))
}

/// Only actual rendering or full retained re-verification can create this value.
/// It is byte/derivation evidence, never an authorization or persistence receipt.
/// Deliberately has no Deserialize implementation or public fields.
pub(crate) struct QualifiedPngPreview {
    bytes: Vec<u8>,
    asset: AssetPin,
    lineage: Value,
    receipt_canonical: String,
}

impl QualifiedPngPreview {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn asset(&self) -> &AssetPin {
        &self.asset
    }

    pub(crate) fn lineage(&self) -> &Value {
        &self.lineage
    }

    pub(crate) fn receipt_canonical(&self) -> &str {
        &self.receipt_canonical
    }
}

/// The asset must come from the native owner's authenticated scoped lookup;
/// schema validation alone does not establish its authority. Hash the exact
/// retained original before invoking the existing bounded PNG decoder/encoder.
pub(crate) fn qualify(
    scope: &Scope,
    original: &AssetPin,
    original_asset: &Value,
    original_png: &[u8],
    output_asset_id: &str,
    output_revision: u64,
    budget: &WorkBudget,
) -> MediaResult<QualifiedPngPreview> {
    budget.check()?;
    scope.validate()?;
    shape("geodataAssetPin", &json!(original))?;
    shape("geodataAssetRecord", original_asset)?;
    need(
        original_asset["workspaceId"] == scope.workspace_id
            && original_asset["homeId"] == scope.home_id
            && original_asset["recordId"] == original.asset_id
            && original_asset["revision"] == original.revision
            && original_asset["lifecycle"] == "active"
            && original_asset["payload"]["purpose"] == "original"
            && original_asset["payload"]["contentType"] == "image/png"
            && original_asset["payload"]["availability"] == "available"
            && original_asset["payload"]["sha256"] == original.sha256
            && original_asset["payload"]["bytes"] == original.bytes
            && original_png.len() <= MAX_BYTES
            && original_png.len() as u64 == original.bytes
            && sha256(original_png) == original.sha256
            && output_asset_id != original.asset_id,
    )?;
    // Validate caller-selected output identity before doing pixel work. Output
    // hash/size below are replaced exclusively with measured renderer results.
    shape(
        "geodataAssetPin",
        &json!({
            "assetId": output_asset_id, "revision": output_revision,
            "sha256": original.sha256, "bytes": original.bytes
        }),
    )?;
    budget.check()?;
    let bytes = content::render_png(original_png, budget)?;
    let asset = AssetPin {
        asset_id: output_asset_id.into(),
        revision: output_revision,
        sha256: sha256(&bytes),
        bytes: bytes.len() as u64,
    };
    shape("geodataAssetPin", &json!(asset))?;
    let config_sha256 = config_sha256()?;
    let receipt = json!({
        "profile": "houseatlas.geodata-derivation-receipt.v1",
        "scope": scope,
        "inputs": [original],
        "output": asset,
        "renderer": RENDERER,
        "rendererVersion": RENDERER_VERSION,
        "rendererConfigSha256": config_sha256,
        "sourceCropExtent": null,
        "description": DESCRIPTION
    });
    shape("geodataDerivationReceipt", &receipt)?;
    let receipt_canonical = canonical(&receipt)?;
    need(receipt_canonical.len() <= MAX_RECEIPT_BYTES)?;
    let lineage = json!({
        "asset": asset,
        "inputs": [original],
        "renderer": RENDERER,
        "rendererVersion": RENDERER_VERSION,
        "rendererConfigSha256": config_sha256,
        "qualificationReceiptSha256": sha256(receipt_canonical.as_bytes()),
        "sourceCropExtent": null,
        "description": DESCRIPTION
    });
    shape("geodataPreviewLineage", &lineage)?;
    budget.check()?;
    Ok(QualifiedPngPreview {
        bytes,
        asset,
        lineage,
        receipt_canonical,
    })
}

/// Recompute all trusted metadata and render the exact retained original again.
/// A valid receipt hash or caller-selected PNG alone cannot qualify a preview.
/// The owner separately checks output asset scope/lifecycle/license/availability
/// and revalidates its native/source access guards before returning any bytes.
#[allow(clippy::too_many_arguments)]
pub(crate) fn verify_retained(
    scope: &Scope,
    original: &AssetPin,
    original_asset: &Value,
    original_png: &[u8],
    preview_png: &[u8],
    lineage: &Value,
    receipt_canonical: &[u8],
    budget: &WorkBudget,
) -> MediaResult<QualifiedPngPreview> {
    budget.check()?;
    need(preview_png.len() <= MAX_BYTES && receipt_canonical.len() <= MAX_RECEIPT_BYTES)?;
    shape("geodataPreviewLineage", lineage)?;
    let output: AssetPin =
        serde_json::from_value(lineage["asset"].clone()).map_err(|_| MediaError::InvalidInput)?;
    let qualified = qualify(
        scope,
        original,
        original_asset,
        original_png,
        &output.asset_id,
        output.revision,
        budget,
    )?;
    need(
        qualified.bytes() == preview_png
            && qualified.asset() == &output
            && qualified.lineage() == lineage
            && qualified.receipt_canonical().as_bytes() == receipt_canonical,
    )?;
    budget.check()?;
    Ok(qualified)
}
