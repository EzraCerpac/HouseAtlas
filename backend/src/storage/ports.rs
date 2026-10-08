use super::*;
use serde_json::Value;

/// The contract owner implements these pure, synchronous operations. Required
/// methods deliberately have no permissive defaults. canonical_json must use
/// RFC 8785, including ECMAScript number formatting and UTF-16 property order.
pub trait Contract {
    fn validate_shape(&self, name: &str, value: &Value) -> Result<()>;
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()>;
    fn assert_transition(
        &self,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<u64>;
    fn assert_guards(
        &self,
        original: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
        created: &[ScopedTarget],
    ) -> Result<()>;
    fn assert_final_mutation(
        &self,
        candidate: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<()>;
    fn validate_result(&self, result: &MutationResult, prior: Prior<'_>) -> Result<()>;
    fn canonical_json(&self, value: &Value) -> Result<String>;
    /// Source-event ordering at the published millisecond precision. None means
    /// schema-accepted text has no orderable timestamp, as in the frozen core.
    /// The contract owner reconciles the native parsing profile; wire strings
    /// are retained verbatim and do not establish authorization or epoch order.
    fn timestamp_millis(&self, value: &str) -> Result<Option<i64>>;
}

#[derive(Clone, Copy)]
pub enum Prior<'a> {
    Unspecified,
    Missing,
    Record(&'a Record),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    Read,
    ReadHistory,
    ReadCache,
    ReadAssetManifest,
    Mutate,
    ConfigureSource,
    PublishCache,
}

/// Borrowed, detached data: no SQL handle, transaction, nested-read callback or
/// mutable reference can escape through the authorization seam.
pub struct AuthorizationRequest<'a> {
    pub scope: &'a Scope,
    pub capability: Capability,
    pub targets: &'a [RecordRef],
    pub source: Option<&'a Value>,
    pub source_partition: Option<&'a SourcePartition>,
    pub mutation: Option<&'a MutationAuthorizationContext>,
}
pub trait Authorization {
    type Principal;
    fn authorize(
        &self,
        principal: &Self::Principal,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor>;
    /// Explicitly denied until the concrete native owner consumes the sealed
    /// qualification from this same active transaction.
    fn authorize_presence_mutation(
        &self,
        _principal: &Self::Principal,
        _request: AuthorizationRequest<'_>,
        _qualified: &StockPresenceQualifiedPhase<'_>,
    ) -> Result<VerifiedActor> {
        Err(Error::new(
            "upstream-unavailable",
            "Qualified native presence authorization is unavailable",
        ))
    }
}

pub struct AssetProof {
    pub sha256: String,
    pub byte_size: u64,
}
/// IDs/time come from the server. Asset proof must inspect immutable staged
/// bytes, never echo request metadata. No paths or bytes are opened by storage.
pub trait Runtime {
    fn now(&self) -> Result<String>;
    fn new_id(&self) -> Result<String>;
    fn verify_available_asset(&self, record: &Record) -> Result<AssetProof>;
}
