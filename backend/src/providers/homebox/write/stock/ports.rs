use super::*;
use serde_json::Value;
use std::future::Future;
use uuid::Uuid;

/// Shared AT51 contracts own closed wire3 validation, catalogue membership and
/// RFC8785/SHA256 canonical intent hashing. Exclusions apply only at the root.
pub trait StockContractPort {
    fn validate_request(&self, wire: &Value) -> Result<StockCommand, StockError>;
    fn digest_native(&self, value: &Value) -> Result<Digest, StockPortFault>;
    fn validate_outcome(&self, outcome: &StockOutcome) -> Result<(), StockPortFault>;
    /// Shared finite RFC3339/calendar parser; freshness belongs to preparation.
    fn validate_observed_at(&self, value: &str) -> Result<(), StockPortFault>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PhysicalBinding {
    pub deployment_id: Uuid,
    pub physical_database_id: Uuid,
    pub configuration_digest: Digest,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StockAuthority {
    pub actor_id: Uuid,
    pub source_epoch: u64,
    pub authority_digest: Digest,
    /// Derived server-side; source aliases sharing this database share a queue.
    pub physical_binding: PhysicalBinding,
    pub qualification: NativeQualification,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeQualification {
    SyntheticFixture,
    /// Server-owned registry evidence for the actual registered build/route.
    /// The upstream source pin alone never constructs this variant.
    Qualified {
        catalog_digest: Digest,
        registered_build_digest: Digest,
        route_qualification_digest: Digest,
    },
}
#[derive(Clone, Copy, Debug)]
pub enum AuthorityPhase<'a> {
    Execute,
    Disclose(&'a StockOutcome),
    /// The generated response identity and GET path have been resolved into
    /// this plan's concrete GET readback. CompleteImpact/Printer retain their
    /// collection scope and require approved impact/printer correlation.
    /// Authorize the exact target/owner or complete approved scope; the original
    /// command and durable dispatch plan remain unchanged.
    /// This transient clone is for GET authority, never redispatch or rehashing.
    Readback(&'a NativePlan),
}
/// Revalidate actor, source epoch, operation, every target/reference/impact,
/// original grants, local guards, retained evidence and output permissions.
pub trait StockAccessPort {
    fn authorize(
        &self,
        command: &StockCommand,
        phase: AuthorityPhase<'_>,
    ) -> impl Future<Output = Result<StockAuthority, StockErrorCode>> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StockPreflight {
    pub preparation: Preparation,
    pub provider_observation: Uuid,
    pub request_digest: Digest,
    pub source_epoch: u64,
    /// Genuine current observed references/impact/route/finite-clock evidence.
    pub preflight_digest: Digest,
}
/// Exact authorized GET preparation, staged metadata and native preservation.
/// Validate observation freshness/identity, all references, qualified native
/// route and response schema, approved impact, and CSV maxRows before admission.
/// Actual upload bytes are accepted only by exclusive admission + liability
/// reservation, never here or in a waiting intent. Real qualification is not
/// inferred from the supplied unqualified engineering profile or source pin.
pub trait StockPreparationPort {
    fn prepare(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> impl Future<Output = Result<StockPreflight, StockErrorCode>> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredOperation {
    pub actor_id: Uuid,
    pub captured_authority: StockAuthority,
    pub operation_id: Uuid,
    pub activity_version: u64,
    pub command: StockCommand,
    pub plan: Option<NativePlan>,
    pub actual_target: Option<StockTarget>,
    /// Exact response member IDs retained for subsequent exact GET correlation.
    pub generated_members: Vec<(String, Vec<Uuid>)>,
    pub outcome: StockOutcome,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StockReservation {
    Reserved(Box<StoredOperation>),
    Existing(Box<StoredOperation>),
    Queued(Box<StoredOperation>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvocationPermit {
    pub operation_id: Uuid,
    pub actor_id: Uuid,
    pub physical_binding: PhysicalBinding,
    pub owner_id: Uuid,
    pub dispatcher_epoch: u64,
    pub source_epoch: u64,
    pub plan_digest: Digest,
    pub qualification: NativeQualification,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Admission {
    Admitted {
        permit: Box<InvocationPermit>,
        operation: Box<StoredOperation>,
    },
    Held(Box<StoredOperation>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StockPortFault {
    Unavailable,
    ContentConflict,
    VersionConflict,
    EvidenceConflict,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchFacts {
    pub response_success: bool,
    pub response_digest: Option<Digest>,
    pub generated_target: Option<StockTarget>,
    pub generated_identity_resolved: bool,
    pub generated_members: Vec<(String, Vec<Uuid>)>,
    pub remote_activity: RemoteActivity,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservationFacts {
    pub readback_digest: Digest,
    pub agrees: bool,
    pub known_effects: Vec<EffectEvidence>,
    pub generated_identity_resolved: bool,
    pub observed_at: String,
    pub impact_evidence_digest: Option<Digest>,
}

/// AT07 owns one durable exclusive invocation per trusted physical provider DB
/// across aliases/jobs/transports. Dedup key is actor/workspace/home/idempotency
/// plus immutable intent digest, NOT a new observation or mapped request body.
/// reserve persists intent; waiting entries are metadata-only bodyAccepted=false.
/// admit atomically checks current grants/guards/observation/route/impact, binds
/// and consumes a trusted human approval when required, reserves byte liability,
/// claims fenced owner/epoch and persists dispatch intent before native I/O.
/// Calls perform native I/O outside SQLite transactions.
///
/// record_dispatch merges against current durable evidence independent of any
/// readback version. save_observation checks version and merges without losing
/// dispatch evidence. Both persist correlated effects, remote activity, logical
/// fences and liability independently. Only qualified correlated ended-proven
/// releases the physical hold. Effect resolution, timeout/cancellation, lease
/// expiry and matching readback do not release it. No automatic write retry.
/// A process stop after admission leaves durable dispatching/held state.
pub trait StockActivityPort {
    fn reserve(
        &self,
        command: &StockCommand,
        authority: &StockAuthority,
    ) -> impl Future<Output = Result<StockReservation, StockPortFault>> + Send;
    fn admit(
        &self,
        reserved: &StoredOperation,
        plan: &NativePlan,
        plan_digest: &Digest,
        preflight: &StockPreflight,
        authority: &StockAuthority,
    ) -> impl Future<Output = Result<Admission, StockPortFault>> + Send;
    fn reject(
        &self,
        reserved: &StoredOperation,
        reason: StockErrorCode,
    ) -> impl Future<Output = Result<StoredOperation, StockPortFault>> + Send;
    fn record_never_invoked(
        &self,
        permit: &InvocationPermit,
    ) -> impl Future<Output = Result<StoredOperation, StockPortFault>> + Send;
    fn record_dispatch(
        &self,
        permit: &InvocationPermit,
        facts: &DispatchFacts,
    ) -> impl Future<Output = Result<StoredOperation, StockPortFault>> + Send;
    fn save_observation(
        &self,
        operation: &StoredOperation,
        facts: &ObservationFacts,
    ) -> impl Future<Output = Result<StoredOperation, StockPortFault>> + Send;
    fn load(
        &self,
        command: &StockCommand,
        actor_id: Uuid,
        operation_id: Uuid,
    ) -> impl Future<Output = Result<StoredOperation, StockPortFault>> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeResponse {
    pub status: u16,
    /// Decoded bounded native JSON or null; headers/errors/credentials excluded.
    pub value: Value,
    /// Digest of the actual bounded native response/artifact, qualified by the
    /// shared decoder. PNG/no-content responses must not hash fabricated JSON.
    pub body_digest: Digest,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchReceipt {
    pub operation_id: Uuid,
    pub plan_digest: Digest,
    pub context: Context,
    pub source_instance_id: Uuid,
    pub collection_id: Uuid,
    pub response: Option<NativeResponse>,
    pub remote_activity: RemoteActivity,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeDispatch {
    /// Capture/admission gate or driver unavailable without trustworthy evidence
    /// of invocation or noninvocation. Carries no receipt and creates no fact.
    /// Preserve admitted intent and every existing hold; never retry dispatch.
    Unavailable,
    /// Exact driver proof of never starting invocation; not a generic HTTP error.
    NeverInvoked,
    Invoked(DispatchReceipt),
}
/// Exactly one bounded, source-bound invocation with permit validation; refuse
/// redirects, real I/O with unqualified catalogs, stale source/dispatcher epochs
/// or source overrides. No retries. Cancellation/lost response does not prove
/// remote end. EndedProven requires independent correlated termination proof.
/// Real drivers independently reject SyntheticFixture and verify qualified
/// registry evidence for the exact active stock.2 catalogue/build/route.
/// An ambiguous gate refusal returns Unavailable, never a fabricated receipt or
/// NeverInvoked. Wrappers must preserve it as unavailable, exclude it from native
/// proof archives and retain their invocation barrier without calling again.
pub trait StockDispatchPort {
    fn dispatch(
        &self,
        permit: &InvocationPermit,
        plan: &NativePlan,
        authority: &StockAuthority,
    ) -> impl Future<Output = NativeDispatch> + Send;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeObservation {
    Present {
        context: Context,
        target: StockTarget,
        value: Value,
        observed_at: String,
        complete: bool,
        impact: Option<ImpactObservation>,
    },
    /// Qualified exact scoped absence, not 404/page omission/name heuristics.
    Absent {
        context: Context,
        target: StockTarget,
        evidence_digest: Digest,
        observed_at: String,
        impact: Option<ImpactObservation>,
    },
    /// Complete authorized action/import impact, or qualified physical printer
    /// acknowledgement. Counts/no-content/list omissions are insufficient.
    Effects {
        context: Context,
        source_instance_id: Uuid,
        collection_id: Uuid,
        effects: Vec<EffectEvidence>,
        complete: bool,
        evidence_digest: Digest,
        observed_at: String,
    },
    Unavailable,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImpactObservation {
    pub effects: Vec<EffectEvidence>,
    pub complete: bool,
    pub evidence_digest: Digest,
}
/// Bounded authorized GETs using the exact readback plan. For complete impact,
/// visit each approved concrete target with its native route and return genuine
/// completeness evidence. Printer observation needs qualified physical request
/// correlation; fetching a label/render bytes is not print acknowledgement.
/// Use the supplied resolved plan, not the operation's immutable dispatch plan.
pub trait StockReadbackPort {
    fn readback(
        &self,
        operation: &StoredOperation,
        plan: &ReadbackPlan,
        authority: &StockAuthority,
    ) -> impl Future<Output = NativeObservation> + Send;
}
