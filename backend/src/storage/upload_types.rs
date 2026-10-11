//! Checked retained upload data. No live stage, grant or authority is restored.
use super::*;
use crate::media::{staged_upload::StagedFile, types::AssetPayload};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, sync::Arc};

/// Borrows the genuine access principal retained by the host request wrapper.
/// Implementations provide no new authority. Storage requires pointer identity
/// with the sealed media stage and passes the unchanged wrapper to its original
/// per-call authorizer at every native and stock transaction phase.
pub trait StagedUploadPrincipal {
    fn original_upload_principal(&self) -> &crate::access::Principal;
}
impl StagedUploadPrincipal for crate::access::Principal {
    fn original_upload_principal(&self) -> &crate::access::Principal {
        self
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UploadStageBinding {
    pub(super) format: String,
    pub(super) scope: Scope,
    pub(super) actor_id: String,
    pub(super) request_id: String,
    pub(super) asset_id: String,
    pub(super) staged: StagedFile,
    pub(super) payload: AssetPayload,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UploadBinding {
    pub(super) format: String,
    pub(super) stage: UploadStageBinding,
    pub(super) original_request: Value,
    pub(super) request_digest: String,
}

/// Constructed only by storage's strict loader/consumer. These immutable facts
/// qualify retained planning; they cannot authorize a new upload or dispatch.
pub struct ConsumedUpload {
    pub(super) token_hash: String,
    pub(super) binding_digest: String,
    pub(super) binding: UploadBinding,
    pub(super) asset_payload: Value,
    pub(super) root_request: Value,
    pub(super) root_operation_id: String,
    pub(super) group_ordinal: usize,
    pub(super) group_operation_id: String,
    pub(super) asset_audit_id: String,
}

/// Borrowed image data to match against independently retained original Media
/// renderer qualification. Neither variant is a renderer receipt or authority.
pub enum MediaPolicyRecoveryFrame<'a> {
    Asset(&'a Record),
    Upload(&'a ConsumedUpload),
}
impl ConsumedUpload {
    /// Exact retained root envelope, checked by the original Storage loader.
    /// This is immutable comparison data, never upload or recovery authority.
    pub fn root_request(&self) -> &Value {
        &self.root_request
    }
    pub fn asset_request(&self) -> &Value {
        &self.binding.original_request
    }
    pub fn asset_id(&self) -> &str {
        &self.binding.stage.asset_id
    }
    pub fn asset_payload(&self) -> &Value {
        &self.asset_payload
    }
    pub fn staged(&self) -> &StagedFile {
        &self.binding.stage.staged
    }
    pub fn binding_digest(&self) -> &str {
        &self.binding_digest
    }
    pub fn actor_id(&self) -> &str {
        &self.binding.stage.actor_id
    }
    pub fn request_id(&self) -> &str {
        &self.binding.stage.request_id
    }
    pub fn scope(&self) -> &Scope {
        &self.binding.stage.scope
    }
    pub fn root_operation_id(&self) -> &str {
        &self.root_operation_id
    }
    pub fn group_ordinal(&self) -> usize {
        self.group_ordinal
    }
    pub fn group_operation_id(&self) -> &str {
        &self.group_operation_id
    }
    pub fn asset_audit_id(&self) -> &str {
        &self.asset_audit_id
    }
}

/// A checked current original asset in its authorized home. This carrier is
/// data for the owner's existing-asset planner, never a stage or new grant.
/// There is no constructor, deserializer, mutable record or provenance setter.
pub struct ExistingOriginalAsset {
    pub(super) record: Record,
}
impl ExistingOriginalAsset {
    pub fn record(&self) -> &Record {
        &self.record
    }
    pub fn asset_id(&self) -> &str {
        &self.record.record_id
    }
    pub fn revision(&self) -> u64 {
        self.record.revision
    }
    pub fn payload(&self) -> &Value {
        &self.record.payload
    }
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.record.workspace_id.clone(),
            home_id: self.record.home_id.clone(),
        }
    }
    pub fn target(&self) -> RecordRef {
        RecordRef {
            record_type: RecordType::Asset,
            record_id: self.record.record_id.clone(),
        }
    }
}

/// Completion issued only after this Store's durable upload receipt and
/// postcommit checks of the original stage binding and actual available bytes.
/// It grants no disclosure, cleanup, archive admission or replay authority;
/// retained facts alone cannot issue this.
/// No public constructor, Clone or serde can adopt a serialized commit.
pub struct AssetUploadQualifiedCompletion {
    pub(super) instance: Arc<()>,
    original: crate::media::native::RetainedPrincipal,
    commit: StockAtlasCommit,
    consumed: ConsumedUpload,
}
impl AssetUploadQualifiedCompletion {
    pub fn commit(&self) -> &StockAtlasCommit {
        &self.commit
    }
    pub fn original_principal(&self) -> &crate::media::native::RetainedPrincipal {
        &self.original
    }
    pub fn consumed_upload(&self) -> &ConsumedUpload {
        &self.consumed
    }
}

/// Request-local observation of durable commit data and, after postcommit
/// qualification, the one actual completion. Neither state grants a retry.
#[derive(Default)]
pub struct AssetUploadCommitObservation(RefCell<Option<AssetUploadCompletion>>);
enum AssetUploadCompletion {
    Committed(Box<StockAtlasCommit>),
    Qualified(Box<AssetUploadQualifiedCompletion>),
}
impl AssetUploadCommitObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<(StockAtlasCommit, bool)> {
        self.0
            .borrow_mut()
            .take()
            .map(|completion| match completion {
                AssetUploadCompletion::Committed(commit) => (*commit, false),
                AssetUploadCompletion::Qualified(completion) => (completion.commit, true),
            })
    }
    /// Consume the actual qualified completion once. Unqualified SQL commit
    /// data stays available to take() for reconciliation.
    pub fn take_qualified(&self) -> Option<AssetUploadQualifiedCompletion> {
        let mut observed = self.0.borrow_mut();
        match observed.take() {
            Some(AssetUploadCompletion::Qualified(completion)) => Some(*completion),
            other => {
                *observed = other;
                None
            }
        }
    }
    pub(super) fn committed(&self, commit: &StockAtlasCommit) {
        self.0
            .replace(Some(AssetUploadCompletion::Committed(Box::new(
                commit.clone(),
            ))));
    }
    pub(super) fn store_qualified(
        &self,
        commit: &StockAtlasCommit,
        instance: &Arc<()>,
        original: &crate::media::native::RetainedPrincipal,
        consumed: ConsumedUpload,
    ) {
        self.0
            .replace(Some(AssetUploadCompletion::Qualified(Box::new(
                AssetUploadQualifiedCompletion {
                    instance: instance.clone(),
                    original: original.clone(),
                    commit: commit.clone(),
                    consumed,
                },
            ))));
    }
}

// Compile-only carrier property for the configured cross-owner handoff.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AssetUploadQualifiedCompletion>();
};
