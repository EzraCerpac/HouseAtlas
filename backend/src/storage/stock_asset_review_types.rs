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
pub struct AssetReviewCommitObservation(RefCell<Option<AssetReviewCompletion>>);
enum AssetReviewCompletion {
    Committed(StockAtlasCommit),
    Qualified(AssetReviewQualifiedCompletion),
}

/// Completion issued only after this Store's durable receipt and successor
/// checks and the original Media proof's release. This retains live custody;
/// it grants no disclosure, archive admission, replay or invocation authority.
/// No constructor, Clone or serde can adopt a serialized commit as completion.
pub struct AssetReviewQualifiedCompletion {
    instance: Arc<()>,
    original: media::native::RetainedPrincipal,
    commit: StockAtlasCommit,
}
impl AssetReviewQualifiedCompletion {
    pub fn commit(&self) -> &StockAtlasCommit {
        &self.commit
    }
    pub fn original_principal(&self) -> &media::native::RetainedPrincipal {
        &self.original
    }
}

/// Identity of one actual Store allocation, including across moves/borrows.
/// Reopening the same database issues a different identity. Identity alone
/// establishes no qualification, disclosure or authority.
#[derive(Clone)]
pub struct AssetReviewStoreIdentity(Arc<()>);
impl AssetReviewStoreIdentity {
    pub fn matches_completion(&self, completion: &AssetReviewQualifiedCompletion) -> bool {
        Arc::ptr_eq(&self.0, &completion.instance)
    }
    pub fn matches_upload_completion(&self, completion: &AssetUploadQualifiedCompletion) -> bool {
        Arc::ptr_eq(&self.0, &completion.instance)
    }
    pub(super) fn from_instance(instance: &Arc<()>) -> Self {
        Self(instance.clone())
    }
}

// Compile-only carrier properties for the configured cross-owner handoff.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AssetReviewQualifiedCompletion>();
    assert_send_sync::<AssetReviewStoreIdentity>();
};

impl AssetReviewCommitObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<(StockAtlasCommit, bool)> {
        self.0
            .borrow_mut()
            .take()
            .map(|completion| match completion {
                AssetReviewCompletion::Committed(commit) => (commit, false),
                AssetReviewCompletion::Qualified(completion) => (completion.commit, true),
            })
    }
    /// Consume the actual qualified completion once. An unqualified SQL
    /// observation remains available to take() for honest reconciliation data.
    pub fn take_qualified(&self) -> Option<AssetReviewQualifiedCompletion> {
        let mut observed = self.0.borrow_mut();
        match observed.take() {
            Some(AssetReviewCompletion::Qualified(completion)) => Some(completion),
            other => {
                *observed = other;
                None
            }
        }
    }
    pub(super) fn committed(&self, commit: &StockAtlasCommit) {
        self.0
            .replace(Some(AssetReviewCompletion::Committed(commit.clone())));
    }
    pub(super) fn store_qualified(
        &self,
        commit: &StockAtlasCommit,
        instance: &Arc<()>,
        original: &media::native::RetainedPrincipal,
    ) {
        self.0.replace(Some(AssetReviewCompletion::Qualified(
            AssetReviewQualifiedCompletion {
                instance: instance.clone(),
                original: original.clone(),
                commit: commit.clone(),
            },
        )));
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
