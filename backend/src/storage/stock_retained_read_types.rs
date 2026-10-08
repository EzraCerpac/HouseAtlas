//! Detached retained data. None of these preparations authorizes retry/replay.
use super::*;
use crate::{domain::stock::ValidatedRequest, media::native::RetainedPrincipal};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StockRetainedReadPhase {
    Intake,
    Prepare,
    Disclosure,
    Release,
}
/// Mandatory semantic owner receives actual saved audits and current records.
/// No connection or permission factory escapes. No reentry, I/O, substitute
/// principal, grant refresh after witness sealing, or permissive defaults.
pub struct StockRetainedReadFrame<'a> {
    pub phase: StockRetainedReadPhase,
    pub scope: &'a Scope,
    pub intent: Option<&'a ValidatedRequest>,
    pub targets: &'a [RecordRef],
    pub current_records: &'a [Record],
    pub commit: Option<&'a StockAtlasCommit>,
    pub audits: &'a [Audit],
    pub events: &'a [StockOperationEvent],
    /// Complete validated immutable root closures across the fixed watermark.
    /// Original request/source refs and native saved records require qualification.
    pub retained_commits: &'a [StockAtlasCommit],
    pub output: Option<&'a Value>,
}
/// Stable identity of the original semantic read owner. This is an identity
/// pin, never an authorization grant. Host retains it with the original Box
/// and graph witness; fresh guards borrow the same allocation.
#[derive(Clone)]
pub struct StockRetainedReadOwner(pub(super) Arc<()>);
impl StockRetainedReadOwner {
    pub fn new() -> Self {
        Self(Arc::new(()))
    }
}
impl Default for StockRetainedReadOwner {
    fn default() -> Self {
        Self::new()
    }
}
pub trait StockRetainedReadAuthorization: Authorization {
    fn retained_read_owner(&self) -> &StockRetainedReadOwner;
    fn authorize_stock_retained_read(
        &self,
        principal: &Self::Principal,
        frame: StockRetainedReadFrame<'_>,
    ) -> Result<VerifiedActor>;
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockOperationEventTarget {
    pub authority: &'static str,
    pub record_type: RecordType,
    pub record_id: String,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockOperationEvent {
    pub event_id: String,
    pub root_operation_id: String,
    pub operation_id: String,
    pub command_id: String,
    pub actor_id: String,
    /// Exact native Audit.at. Never a new retrieval time or sorting key.
    pub at: String,
    pub target: StockOperationEventTarget,
    pub request_digest: String,
    pub state: &'static str,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockOperationEventPage {
    pub format: &'static str,
    pub resolved_scope: Scope,
    pub coverage: &'static str,
    pub completeness: &'static str,
    pub order: &'static str,
    pub entries: Vec<StockOperationEvent>,
    pub next_cursor: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockRetainedInspection {
    pub format: &'static str,
    pub resolved_scope: Scope,
    pub coverage: &'static str,
    pub outcome: &'static str,
    /// Neither a hit nor absence establishes permission/safety to retry.
    pub retry_safety: &'static str,
    pub root_operation_id: Option<String>,
    pub operation_id: Option<String>,
    pub command_id: String,
    pub request_digest: String,
}
/// The immutable original public command receipt, after genuine SQL validation
/// and fresh authorized disclosure. Historical SafeRendered metadata is not a
/// live preview grant or a rehydrated renderer proof. These release facts are
/// deliberately unknown: retained SQL does not record delivery/Media release.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockRetainedCommittedResult {
    pub original_request_id: String,
    pub wire: Value,
    pub children: Vec<Value>,
    pub original_media_release: &'static str,
    pub original_http_delivery: &'static str,
}
/// A separate read response: lookup transport correlation never rewrites the
/// original receipt. Absence is not proof of rollback or permission to retry.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockRetainedReconciliation {
    pub format: &'static str,
    pub lookup_request_id: String,
    pub inspection: StockRetainedInspection,
    pub committed_result: Option<StockRetainedCommittedResult>,
}
// Retaining this actual Arc prevents principal-address reuse from qualifying a
// different Access allocation. Host also retains the ENTIRE original Box; no
// replacement wrapper or deserialized identity can use these data carriers.
pub(super) struct StockReadBinding {
    pub(super) instance: Arc<()>,
    pub(super) owner: StockRetainedReadOwner,
    pub(super) principal: RetainedPrincipal,
    pub(super) wrapper_address: usize,
    pub(super) actor: VerifiedActor,
}
/// Authorized internal qualification facts after Prepare. Host must not emit
/// these facts or serialize them before separate Disclosure and Release checks.
pub struct StockRetainedPreparation {
    pub(super) binding: StockReadBinding,
    pub(super) scope: Scope,
    pub(super) request: ValidatedRequest,
    pub(super) group: Option<usize>,
    pub(super) commit: Option<StockAtlasCommit>,
    pub(super) targets: Vec<RecordRef>,
    pub(super) current_records: Vec<Record>,
}
impl StockRetainedPreparation {
    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn targets(&self) -> &[RecordRef] {
        &self.targets
    }
    pub fn current_records(&self) -> &[Record] {
        &self.current_records
    }
}
/// Authorized internal qualification facts, including complete historical
/// source closure. Getters serve host sealing, never external disclosure.
pub struct StockOperationEventPreparation {
    pub(super) binding: StockReadBinding,
    pub(super) scope: Scope,
    pub(super) page_size: usize,
    pub(super) watermark: i64,
    pub(super) after: i64,
    pub(super) rows: Vec<(i64, StockOperationEvent)>,
    pub(super) audits: Vec<Audit>,
    pub(super) snapshot: Arc<StockOperationEventSnapshot>,
    pub(super) targets: Vec<RecordRef>,
    pub(super) current_records: Vec<Record>,
}
impl StockOperationEventPreparation {
    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn page_size(&self) -> usize {
        self.page_size
    }
    pub fn targets(&self) -> &[RecordRef] {
        &self.targets
    }
    pub fn current_records(&self) -> &[Record] {
        &self.current_records
    }
    pub fn retained_commits(&self) -> &[StockAtlasCommit] {
        &self.snapshot.retained_commits
    }
    pub fn snapshot_closure(&self) -> &StockOperationEventSnapshot {
        &self.snapshot
    }
    pub fn audits(&self) -> &[Audit] {
        &self.audits
    }
    pub fn events(&self) -> impl Iterator<Item = &StockOperationEvent> {
        self.rows.iter().map(|(_, e)| e)
    }
    pub fn has_more(&self) -> bool {
        self.rows.len() > self.page_size
    }
}
/// Bounded detached fixed-watermark facts for initial historical source capture.
/// Not an authority, replay handle, serialized cursor, or mutable SQL snapshot.
/// Host qualifies this entire closure before sealing the original principal.
#[derive(PartialEq)]
pub struct StockOperationEventSnapshot {
    pub(super) watermark: i64,
    pub(super) retained_commits: Vec<StockAtlasCommit>,
    pub(super) targets: Vec<RecordRef>,
    pub(super) rows: Vec<(i64, StockOperationEvent)>,
    pub(super) audits: Vec<Audit>,
}
impl StockOperationEventSnapshot {
    pub fn watermark(&self) -> i64 {
        self.watermark
    }
    pub fn retained_commits(&self) -> &[StockAtlasCommit] {
        &self.retained_commits
    }
    pub fn targets(&self) -> &[RecordRef] {
        &self.targets
    }
}
/// Same Store/original wrapper/actual Access allocation, fixed audit snapshot.
/// Non-serializable, no clone/default/authority/replay methods. Registry keeps
/// the full original Box and performs fresh actual current-session checks.
pub struct StockRetainedContinuation {
    pub(super) binding: StockReadBinding,
    pub(super) id: String,
    pub(super) scope: Scope,
    pub(super) page_size: usize,
    pub(super) watermark: i64,
    pub(super) after: i64,
    pub(super) snapshot: Arc<StockOperationEventSnapshot>,
}
impl StockRetainedContinuation {
    pub fn cursor_id(&self) -> &str {
        &self.id
    }
    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn page_size(&self) -> usize {
        self.page_size
    }
}
pub struct StockOperationEvents {
    pub page: StockOperationEventPage,
    pub continuation: Option<StockRetainedContinuation>,
}
