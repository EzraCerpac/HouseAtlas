//! Read-qualified saved Atlas source, not replay or mutation authorization.
use super::{Record, RecordRef, Scope, StockAtlasCommit, StockRetainedPreparation};
use crate::domain::stock::{AtlasCommandPlan, ValidatedRequest};

/// No clone, serde, public constructor or execution method. The inherited
/// binding pins the actual Store, semantic owner, inner principal allocation
/// and full original wrapper address. Host retains that entire original Box.
/// A hit or miss establishes neither retry safety nor replay/Media permission.
pub struct StockAtlasReplayPreparation {
    pub(super) read: StockRetainedPreparation,
    pub(super) saved: Option<(ValidatedRequest, AtlasCommandPlan)>,
}
impl StockAtlasReplayPreparation {
    pub fn scope(&self) -> &Scope {
        &self.read.scope
    }
    pub fn selector(&self) -> &ValidatedRequest {
        &self.read.request
    }
    /// A selected child is read data within its complete saved root. This
    /// does not authorize standalone execution of the child or its root.
    pub fn selected_group(&self) -> Option<usize> {
        self.read.group
    }
    /// Internal qualification facts after Prepare. Never serialize these
    /// before the matching fresh Disclosure/Release checks.
    pub fn retained_commit(&self) -> Option<&StockAtlasCommit> {
        self.read.commit.as_ref()
    }
    pub fn saved_root(&self) -> Option<&ValidatedRequest> {
        self.saved.as_ref().map(|(root, _)| root)
    }
    /// Saved mapping DATA, including exact original group/entry order. No
    /// current CAS, historical Access handle or renderer proof is recreated.
    pub fn saved_plan(&self) -> Option<&AtlasCommandPlan> {
        self.saved.as_ref().map(|(_, plan)| plan)
    }
    pub fn targets(&self) -> &[RecordRef] {
        &self.read.targets
    }
    /// Actual records at the preparation read cut; final disclosure rereads
    /// current facts under the same original captured authority.
    pub fn current_records(&self) -> &[Record] {
        &self.read.current_records
    }
}
