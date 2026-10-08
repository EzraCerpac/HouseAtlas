//! Opaque existing-original renderer evidence. Storage supplies the authoritative
//! existing row and checks it again in its own transaction; Media proves the
//! retained bytes and renderer, never row existence, commit or replay authority.
use serde::Serialize;
use std::sync::Arc;

use crate::{access as a, domain::stock, storage as s};

use super::content::{render_original_preview, validate_original_content};
use super::native::{RetainedPrincipal, access_error, access_scope, project_asset};
use super::recovery_policy::RendererQualification;
use super::types::{
    AssetRecord, Availability, ContentType, Lifecycle, PreviewPolicy, Scope, sha256,
};
use super::{AssetVault, MediaError, MediaResult, WorkBudget};

/// Versioned retained DATA only. Serialization is available for owner audit
/// persistence; neither these facts nor their receipt ID can reconstruct proof.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReceiptFacts {
    format: &'static str,
    renderer: &'static str,
    receipt_id: String,
    scope: Scope,
    asset_id: String,
    revision: u64,
    original_record_digest: String,
    original_sha256: String,
    original_byte_size: u64,
    rendered_sha256: String,
    rendered_byte_size: u64,
    actor_id: String,
}

/// Versioned linkage for retained-plan reproduction, still DATA only. A future
/// replay owner must establish its own current authority and retained carrier.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundReviewFacts<'a> {
    format: &'static str,
    renderer_receipt: &'a ReviewReceiptFacts,
    request_digest: &'a str,
}

impl ReviewReceiptFacts {
    pub fn receipt_id(&self) -> &str {
        &self.receipt_id
    }
}

/// Issued only after an actual bounded render of measured retained bytes. No
/// serde, clone, public fields or public constructor; tied to this vault and the
/// exact original Access allocation. This alone is not a stock review request.
pub struct RenderedAssetReview {
    vault: Arc<AssetVault>,
    original: RetainedPrincipal,
    record: AssetRecord,
    facts: ReviewReceiptFacts,
    qualification: RendererQualification,
}

/// Sealed renderer evidence bound to the complete validated stock request.
/// Losing the original owner/handle loses this capability. Persisted facts
/// cannot adopt a later RequestPrincipal, authorize replay or grant access.
pub struct VerifiedAssetReview {
    rendered: RenderedAssetReview,
    request: stock::ValidatedRequest,
    request_digest: String,
    reviewed_payload: super::types::AssetPayload,
}

fn authorize(
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    scope: &Scope,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if !std::ptr::eq(guard.principal(), original.principal()) {
        return Err(MediaError::Forbidden);
    }
    guard.assert_mutation().map_err(access_error)?;
    guard
        .authorize(&access_scope(scope)?, a::Capability::Mutate)
        .map_err(access_error)?;
    Ok(())
}

fn digest(value: &serde_json::Value) -> MediaResult<String> {
    stock::canonical_digest(value).map_err(|_| MediaError::InvalidInput)
}

fn receipt_id() -> MediaResult<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| MediaError::Unavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

impl AssetVault {
    /// The caller supplies its actual authorized Store row, never client DTOs.
    /// Storage must later check that same preimage in its commit transaction.
    /// An available active owned original is required; the stored preview enum
    /// is never treated as renderer evidence, nor is QualifiedOriginal reused.
    pub fn qualify_asset_review(
        self: &Arc<Self>,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        current: &s::Record,
        budget: &WorkBudget,
    ) -> MediaResult<RenderedAssetReview> {
        let scope = Scope {
            workspace_id: current.workspace_id.clone(),
            home_id: current.home_id.clone(),
        };
        authorize(guard, original, &scope, budget)?;
        let record = project_asset(current)?;
        if record.lifecycle != Lifecycle::Active
            || record.payload.availability != Availability::Available
            || !record.payload.purpose.is_original()
        {
            return Err(MediaError::NotFound);
        }
        let bytes = self.read_retained(&record, budget)?;
        let content_type = ContentType::parse(&record.payload.content_type)?;
        validate_original_content(&bytes, content_type, budget)?;
        let output = render_original_preview(&bytes, content_type, budget)?
            .ok_or(MediaError::Unsupported)?;
        let facts = ReviewReceiptFacts {
            format: "houseatlas-existing-asset-renderer-review/1",
            renderer: "houseatlas-stripped-rgba8-png/1",
            receipt_id: receipt_id()?,
            scope,
            asset_id: record.record_id.clone(),
            revision: record.revision,
            original_record_digest: digest(
                &serde_json::to_value(current).map_err(|_| MediaError::Unavailable)?,
            )?,
            original_sha256: sha256(&bytes),
            original_byte_size: bytes.len() as u64,
            rendered_sha256: sha256(&output),
            rendered_byte_size: output.len() as u64,
            actor_id: original.principal().actor_id().as_str().to_owned(),
        };
        let qualification = RendererQualification::produced(
            &record.scope(),
            &super::vault::PreparedOriginal {
                purpose: record.payload.purpose,
                storage_key: record.payload.storage_key.clone(),
                identity: super::types::BlobIdentity {
                    sha256: facts.original_sha256.clone(),
                    byte_size: facts.original_byte_size,
                },
                content_type,
            },
            super::types::BlobIdentity {
                sha256: facts.rendered_sha256.clone(),
                byte_size: facts.rendered_byte_size,
            },
        );
        authorize(guard, original, &record.scope(), budget)?;
        Ok(RenderedAssetReview {
            vault: self.clone(),
            original: original.clone(),
            record,
            facts,
            qualification,
        })
    }
}

impl RenderedAssetReview {
    pub fn facts(&self) -> &ReviewReceiptFacts {
        &self.facts
    }

    pub fn receipt_id(&self) -> &str {
        self.facts.receipt_id()
    }

    fn revalidate_bytes(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        submitted_receipt_id: &str,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        if !self.original.same_original(original) {
            return Err(MediaError::Forbidden);
        }
        authorize(guard, &self.original, &self.record.scope(), budget)?;
        if submitted_receipt_id != self.receipt_id() {
            return Err(MediaError::Conflict);
        }
        // Reopen through this same vault's descriptor-relative bounded reader.
        // It compares actual size/hash to the sealed original; no rendering or
        // receipt regeneration is performed by revalidation.
        let bytes = self.vault.read_retained(&self.record, budget)?;
        if bytes.len() as u64 != self.facts.original_byte_size
            || sha256(&bytes) != self.facts.original_sha256
        {
            return Err(MediaError::Unavailable);
        }
        authorize(guard, &self.original, &self.record.scope(), budget)
    }

    /// Bind the issued receipt to the exact submitted request, including target
    /// revision, scope, evidence, IDs and reason. UUID syntax supplies no proof.
    pub fn bind_request(
        self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        request: &stock::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<VerifiedAssetReview> {
        // Reparse using the actual native stock schema, not a caller label.
        let schemas = stock::NativeStockContract::new().map_err(|_| MediaError::Unavailable)?;
        let request = stock::ValidatedRequest::parse(&schemas, request.raw().clone())
            .map_err(|_| MediaError::InvalidInput)?;
        self.revalidate_bytes(
            guard,
            original,
            request.payload()["rendererReceiptId"]
                .as_str()
                .ok_or(MediaError::InvalidInput)?,
            budget,
        )?;
        let record = &self.record;
        if request.id() != stock::OperationId::AtlasAssetReview
            || request.payload()["treatment"] != "request-preview"
            || request.context().workspace_id != record.workspace_id
            || request.context().home_id != record.home_id
            || request.target()["recordType"] != "asset"
            || request.target()["recordId"] != record.record_id
            || request.raw()["preconditions"]["target"]["kind"] != "atlas"
            // The reparsed native schema bounds this integer to MAX_REVISION;
            // every admitted integral value is exactly representable in f64,
            // including decimal/exponent JSON spellings. No wire rewrite.
            || request.raw()["preconditions"]["target"]["value"].as_f64()
                != Some(record.revision as f64)
        {
            return Err(MediaError::Conflict);
        }
        let mut reviewed_payload = record.payload.clone();
        reviewed_payload.preview_policy = PreviewPolicy::SafeRendered;
        reviewed_payload.evidence_ids =
            serde_json::from_value(request.payload()["evidenceIds"].clone())
                .map_err(|_| MediaError::InvalidInput)?;
        reviewed_payload.validate()?;
        let request_digest = digest(request.raw())?;
        Ok(VerifiedAssetReview {
            rendered: self,
            request,
            request_digest,
            reviewed_payload,
        })
    }
}

impl VerifiedAssetReview {
    pub(super) fn recovery_qualification(&self) -> &RendererQualification {
        &self.rendered.qualification
    }
    pub fn facts(&self) -> &ReviewReceiptFacts {
        self.rendered.facts()
    }
    pub fn request(&self) -> &stock::ValidatedRequest {
        &self.request
    }
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub fn retained_facts(&self) -> BoundReviewFacts<'_> {
        BoundReviewFacts {
            format: "houseatlas-bound-asset-renderer-review/1",
            renderer_receipt: self.facts(),
            request_digest: self.request_digest(),
        }
    }
    pub fn original_principal(&self) -> &RetainedPrincipal {
        &self.rendered.original
    }
    pub fn original_record(&self) -> &AssetRecord {
        &self.rendered.record
    }

    /// Call within the Store's actual precommit fence using its freshly loaded
    /// original row and the exact request being committed. This does not acquire
    /// a Store or Access lock and does not replace Storage's graph/receipt checks.
    pub fn revalidate_before_commit(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        current: &s::Record,
        request: &stock::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        self.check_request(request)?;
        self.rendered
            .revalidate_bytes(guard, original, self.rendered.receipt_id(), budget)?;
        if project_asset(current)? != self.rendered.record
            || digest(&serde_json::to_value(current).map_err(|_| MediaError::Unavailable)?)?
                != self.facts().original_record_digest
        {
            return Err(MediaError::Conflict);
        }
        authorize(guard, original, &self.rendered.record.scope(), budget)
    }

    /// Release checks the actual committed successor, not the now-obsolete
    /// preimage revision. Storage/host still verify its canonical linked receipt
    /// and current disclosure closure, and emit immediately after this check.
    pub fn revalidate_release(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        committed: &s::Record,
        request: &stock::ValidatedRequest,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        self.check_request(request)?;
        self.rendered
            .revalidate_bytes(guard, original, self.rendered.receipt_id(), budget)?;
        let committed = project_asset(committed)?;
        let before = &self.rendered.record;
        if committed.scope() != before.scope()
            || committed.record_id != before.record_id
            || committed.revision != before.revision.checked_add(1).ok_or(MediaError::Conflict)?
            || committed.lifecycle != Lifecycle::Active
            || committed.created_at != before.created_at
            || committed.payload != self.reviewed_payload
        {
            return Err(MediaError::Conflict);
        }
        authorize(guard, original, &before.scope(), budget)
    }

    fn check_request(&self, request: &stock::ValidatedRequest) -> MediaResult<()> {
        if digest(request.raw())? != self.request_digest {
            return Err(MediaError::Conflict);
        }
        Ok(())
    }
}
