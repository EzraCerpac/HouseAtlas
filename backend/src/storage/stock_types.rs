//! Durable stock metadata, with authority kept in borrowed required peers.
use super::*;
use crate::domain::stock::{AtlasCommandPlan, OwnerResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// No authorization handle or SQL access is contained in this frame.
pub struct StockMutationFrame<'a> {
    pub plan: &'a AtlasCommandPlan,
    pub native: &'a MutationAuthorizationContext,
    pub closure: &'a MutationClosure,
    pub commit: Option<&'a StockAtlasCommit>,
}
pub struct StockHistoryFrame<'a> {
    pub request: &'a Value,
    pub scope: &'a Scope,
    pub target: &'a RecordRef,
    /// Validated page and at most one lookahead audit; never the full history.
    /// Intake is empty. Authority remains bound to the original principal/target.
    pub audits: &'a [Audit],
    pub result: Option<&'a OwnerResult>,
}
/// Required synchronous checks use the same original principal as native
/// authorization. The implementation owns original opaque authority handles.
pub trait StockAuthorization: Authorization {
    fn authorize_stock_mutation(
        &self,
        principal: &Self::Principal,
        frame: StockMutationFrame<'_>,
    ) -> Result<VerifiedActor>;
    fn authorize_stock_history(
        &self,
        principal: &Self::Principal,
        frame: StockHistoryFrame<'_>,
    ) -> Result<VerifiedActor>;
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockCommitGroup {
    pub child_index: Option<usize>,
    pub original_request: Value,
    pub request_digest: String,
    pub operation_id: String,
    pub native_entries: Vec<MutationEntry>,
    pub native_results: Vec<MutationResult>,
}
/// Returned only after one durable native+stock commit, or a reauthorized
/// retained receipt. The outer stock service still controls output disclosure.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockAtlasCommit {
    pub original_request: Value,
    pub request_digest: String,
    pub operation_id: String,
    pub actor_id: String,
    pub replayed: bool,
    pub groups: Vec<StockCommitGroup>,
    pub wire: Value,
    pub children: Vec<Value>,
}
impl StockAtlasCommit {
    pub fn owner_result(&self) -> OwnerResult {
        OwnerResult {
            wire: self.wire.clone(),
            children: self.children.clone(),
        }
    }
}
