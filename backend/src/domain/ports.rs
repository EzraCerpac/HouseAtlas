use super::{
    Audit, BatchResult, CanonicalBatch, CanonicalMutation, DomainResult, HomeSummary,
    MutationResult, Record, RecordRef, Scope, Snapshot,
};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Capability {
    Read,
    ReadHistory,
    Mutate,
}

/// Produced only by the injected access adapter from current server authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizedHome {
    pub home: HomeSummary,
    pub other_homes: Vec<HomeSummary>,
    pub can_edit_homebox: bool,
}

/// P is the host's opaque verified principal, not a JSON authorization object.
/// AT11 must check current scope, session, role and grants on every call. Storage
/// still checks authority inside its own read/write transactions.
pub trait AccessPort<P> {
    fn authorize(
        &self,
        principal: &P,
        scope: &Scope,
        capability: Capability,
    ) -> DomainResult<AuthorizedHome>;

    /// Validate authority captured in P, including session, role, home membership
    /// and every relevant source/media policy epoch. A policy change invalidates
    /// this request even if the home allows a new Read request. Do not refresh
    /// stale P into new authority. Storage must use the same captured witness.
    /// This required release check is not general home-read authorization.
    fn revalidate(&self, principal: &P, scope: &Scope, capability: Capability) -> DomainResult<()>;
}

/// Returns a frozen-contract-validated snapshot narrowed to current source
/// grants, including canonical revoked cache rows (projection emits generic
/// public markers). Reading must never cause
/// refresh, collector demand or an upstream write. AT07 checks scope/existence
/// and returns recorded audit entries in ascending durable sequence.
pub trait ReadPort<P> {
    fn snapshot(&mut self, principal: &P, scope: &Scope) -> DomainResult<Snapshot>;
    fn record(&mut self, principal: &P, scope: &Scope, target: &RecordRef) -> DomainResult<Record>;
    fn history(
        &mut self,
        principal: &P,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Vec<Audit>>;
}

/// Atomic command port. The adapter derives actor/source authority from P,
/// enforces final graph guards and referenced revisions within its transaction,
/// retains receipts and commits record/audit/receipt together. New explicit
/// source-presence admissions remain held by the storage/access integration.
pub trait CommandPort<P> {
    fn execute(
        &mut self,
        principal: &P,
        scope: &Scope,
        target: &RecordRef,
        command: &CanonicalMutation,
    ) -> DomainResult<MutationResult>;

    fn execute_batch(
        &mut self,
        principal: &P,
        scope: &Scope,
        batch: &CanonicalBatch,
    ) -> DomainResult<BatchResult>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContractShape {
    RecordRef,
    Mutation,
    BatchMutation,
}

/// AT51 supplies validation against the published atlas.schema.json definitions.
/// It must validate the entire supplied value, without normalization, defaults,
/// field stripping or remote schema retrieval. A no-op is only a synthetic stub.
pub trait ContractPort {
    fn validate(&self, shape: ContractShape, value: &Value) -> DomainResult<()>;
}
