use super::{PreparedRequest, StockResult, ValidatedRequest};
use serde_json::Value;

/// AT51 validates this entire exact value against stock wire3 / frozen Atlas
/// draft2020-12 closure offline. No defaults, stripping, coercion, remote refs,
/// byte-count string lengths or weaker union interpretation are permitted.
pub trait StockContractPort {
    fn validate(&self, local_schema_ref: &str, value: &Value) -> StockResult<()>;
}

/// Input facts come from the host's verified principal, never wire request
/// claims. W is the captured immutable original authority witness; G is the
/// owner's complete resolved original/candidate/impact/reference graph.
pub trait StockAuthorityPort<P> {
    type Witness;
    type Graph;

    fn capture(&self, principal: &P, request: &ValidatedRequest) -> StockResult<Self::Witness>;

    fn authorize_graph(
        &self,
        principal: &P,
        witness: &Self::Witness,
        request: &ValidatedRequest,
        graph: &Self::Graph,
    ) -> StockResult<()>;

    /// Check captured session, role, home, source/collection/media/policy epochs
    /// and original grants without refreshing, substitution or rebase.
    fn revalidate(
        &self,
        principal: &P,
        witness: &Self::Witness,
        request: &ValidatedRequest,
    ) -> StockResult<()>;

    /// Separate output disclosure permission. Must check the actual owning
    /// graph, records, history, new provider identities, path relationships,
    /// resource/media handles and every Network endpoint/source key. It receives
    /// the full exact result even when no target-bearing row is present.
    fn authorize_result(
        &self,
        principal: &P,
        prepared: &PreparedRequest<Self::Witness, Self::Graph>,
        request: &ValidatedRequest,
        result: &Value,
    ) -> StockResult<()>;

    /// Current exact identity and owner check for each target-bearing result.
    /// An exception purpose is a narrow obligation to prove that relationship;
    /// it is never permission to accept arbitrary same-partition resources.
    fn disclose(
        &self,
        principal: &P,
        prepared: &PreparedRequest<Self::Witness, Self::Graph>,
        request: &ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: DisclosurePurpose,
    ) -> StockResult<()>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisclosurePurpose {
    ExactTarget,
    ScopedPage,
    NewProviderIdentity,
    AncestorPath,
    RemapRecord,
    FeatureResource,
    /// Prove the exact effect identity, actual owner, parent/reference links
    /// and effect semantics against the original captured and approved impact
    /// graph. Qualified cascades may involve other kinds; same-partition
    /// membership or a matching primary kind never supplies this proof.
    /// Generated identities require qualified correlation to the admitted
    /// creation operation and its original approved intent.
    ImpactGraph,
}

/// Resolves complete current target/reference/impact and final candidate graph,
/// source observations, real whole-collection entitlement, route qualification,
/// policy and exact-impact approval requirements. No HTTP or approval spending
/// belongs here. Returned G must remain coupled to the original witness.
pub trait StockPreparerPort<P, W> {
    type Graph;
    fn resolve(
        &mut self,
        principal: &P,
        witness: &W,
        request: &ValidatedRequest,
    ) -> StockResult<Self::Graph>;
}

pub trait StockQueryPort<P, W, G> {
    /// Reads/preparation never request refresh, collector demand or mutations.
    fn query(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult>;
}

pub trait StockCommandPort<P, W, G> {
    /// Atlas: one atomic owner transaction preserves raw root and ordered
    /// child IDs/keys/targets/guards/payloads; validates full final graph and
    /// captured authority immediately precommit; commits record/audit/receipt
    /// and approved witness admissions together. Root and child receipts use
    /// their respective exact intent digests.
    /// New source-presence admission stays held until the reviewed AT07 atomic
    /// transaction integrates the presence helper's actual candidate/final
    /// graph checks. Never synthesize present from mapping acceptance.
    /// HomeBox, including print/import/bulk: admission delegates to the single
    /// physical durable write queue. No direct provider transport may bypass it.
    /// Approval is bound/consumed atomically with admission, never preparation.
    /// Immediately before actual provider invocation, its write owner must
    /// re-resolve and revalidate the complete current target/reference/impact
    /// graph, exact preparation/provider-observation/precondition facts and
    /// approval-bound effects against this original immutable request/intent
    /// and captured authority. No grant, generation, observation or impact
    /// substitution/rebase supplies that check. The earlier preparation check
    /// and this service's call-time revalidation do not discharge this final
    /// queue-owner obligation; provider HTTP remains outside SQLite transactions.
    fn execute(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult>;
}

#[derive(Clone, Debug)]
pub struct OwnerResult {
    pub wire: Value,
    /// Durable ordered child results for lossless batch correlation. Stock's
    /// public batch arm is flattened atlasReceipt; these are internal owner
    /// receipts, not invented wire fields. Empty for every nonbatch operation.
    pub children: Vec<Value>,
}
