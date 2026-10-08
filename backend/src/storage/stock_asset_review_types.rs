//! Store custody and renderer peers; retained facts are data, never authority.
use super::*;
use crate::{access, domain::stock, media};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, sync::Arc};

pub const ATLAS_VERIFIED_ASSET_REVIEW_FORMAT: &str = "atlas-verified-asset-review/1";

/// Issued only by an authorized read on this Store. No serde or constructor.
pub struct AssetReviewOriginal {
    pub(super) instance: Arc<()>,
    pub(super) principal: media::native::RetainedPrincipal,
    pub(super) record: Record,
}
impl AssetReviewOriginal {
    pub fn record(&self) -> &Record {
        &self.record
    }
}

/// Pure planned data with the actual opaque peers retained by borrow.
pub struct VerifiedAssetReviewPlan<'a> {
    pub(super) original: &'a AssetReviewOriginal,
    pub(super) proof: &'a media::review::VerifiedAssetReview,
    pub(super) request: stock::ValidatedRequest,
    pub(super) plan: stock::AtlasCommandPlan,
    pub(super) derivation: stock::AtlasDerivation,
    pub(super) facts: RetainedAssetReviewFacts,
}
impl VerifiedAssetReviewPlan<'_> {
    /// Borrow the actual original opaque proof for the host's postcommit
    /// provenance capture. Retained data cannot create this carrier.
    pub(crate) fn media_proof(&self) -> &media::review::VerifiedAssetReview {
        self.proof
    }
    pub fn plan(&self) -> &stock::AtlasCommandPlan {
        &self.plan
    }
    pub fn derivation(&self) -> &stock::AtlasDerivation {
        &self.derivation
    }
    pub fn retained_facts(&self) -> &RetainedAssetReviewFacts {
        &self.facts
    }
}

/// Borrowed actual Access fence and budget, never reconstructed from facts.
pub struct AssetReviewCommitPeers<'a, 'g> {
    pub(super) bound: &'a VerifiedAssetReviewPlan<'a>,
    pub(super) guard: &'a access::TransactionAuthorization<'g>,
    pub(super) budget: &'a media::WorkBudget,
    pub(super) observation: Option<&'a AssetReviewCommitObservation>,
}
/// Request-local data observation. A durable receipt is captured only after the
/// SQL commit; Store qualification is marked after its postcommit release.
/// Neither state grants disclosure or a retry.
#[derive(Default)]
pub struct AssetReviewCommitObservation(RefCell<Option<(StockAtlasCommit, bool)>>);
impl AssetReviewCommitObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<(StockAtlasCommit, bool)> {
        self.0.borrow_mut().take()
    }
    pub(super) fn committed(&self, commit: &StockAtlasCommit) {
        self.0.replace(Some((commit.clone(), false)));
    }
    pub(super) fn store_qualified(&self) {
        if let Some((_, qualified)) = self.0.borrow_mut().as_mut() {
            *qualified = true;
        }
    }
}
impl<'a, 'g> AssetReviewCommitPeers<'a, 'g> {
    pub fn new(
        bound: &'a VerifiedAssetReviewPlan<'a>,
        guard: &'a access::TransactionAuthorization<'g>,
        budget: &'a media::WorkBudget,
    ) -> Self {
        Self {
            bound,
            guard,
            budget,
            observation: None,
        }
    }
    pub fn observing(mut self, observation: &'a AssetReviewCommitObservation) -> Self {
        self.observation = Some(observation);
        self
    }
}

/// Versioned serialized measurements for receipt/history reconstruction only.
/// Deserializing this cannot create a Store pin, renderer proof or commit peers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedAssetReviewFacts {
    pub(super) format: String,
    pub(super) renderer_receipt: RendererReceiptData,
    pub(super) request_digest: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RendererReceiptData {
    pub format: String,
    pub renderer: String,
    pub receipt_id: String,
    pub scope: Scope,
    pub asset_id: String,
    pub revision: u64,
    pub original_record_digest: String,
    pub original_sha256: String,
    pub original_byte_size: u64,
    pub rendered_sha256: String,
    pub rendered_byte_size: u64,
    pub actor_id: String,
}
