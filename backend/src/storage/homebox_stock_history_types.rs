//! Required original disclosure peer for data-only native HomeBox history.
use super::{Authorization, Result, Scope, SourcePartition, SourceRegistration, VerifiedActor};
use crate::{domain::stock::OwnerResult, providers::homebox::write::stock::WireTarget};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HomeBoxStockHistoryPhase {
    Entry,
    Page,
    CursorPrecommit,
    Release,
}

/// Detached exact query and bounded validated output; no SQL or authority handle.
pub struct HomeBoxStockHistoryFrame<'a> {
    pub phase: HomeBoxStockHistoryPhase,
    pub request: &'a Value,
    pub scope: &'a Scope,
    pub target: &'a WireTarget,
    pub partition: &'a SourcePartition,
    pub registration: Option<&'a SourceRegistration>,
    /// Page plus at most one lookahead entry; empty at intake. These are minimal
    /// operation cuts, not private preflight, invocation or producer records.
    pub entries: &'a [Value],
    pub result: Option<&'a OwnerResult>,
}

/// The host retains the unchanged original principal allocation and genuine
/// captured SourceGrant/PartitionGrant. Every callback must revalidate those
/// handles, session/scope, exact request/target and disclosure of the entire
/// supplied page/result (including an empty page). No new capture, substitution,
/// permission inferred from retained rows, native I/O or Storage reentry.
/// Native ReadCache authorization separately checks both source and partition;
/// this required callback qualifies original mediated-history disclosure.
pub trait HomeBoxStockHistoryAuthorization: Authorization {
    fn authorize_homebox_stock_history(
        &self,
        principal: &Self::Principal,
        frame: HomeBoxStockHistoryFrame<'_>,
    ) -> Result<VerifiedActor>;
}
