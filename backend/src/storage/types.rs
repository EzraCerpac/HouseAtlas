use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub const CONTRACT_VERSION: &str = "1.0.0";
pub const MAX_REVISION: u64 = 9_007_199_254_740_991;
pub const MUTATION_AUTHORIZATION_CONTEXT_FORMAT: &str = "atlas-mutation-authorization-context/1";

/// Wire carriers for the published schema. Payload validation remains owned by
/// the contract adapter; these are not replacements for generated domain types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub workspace_id: String,
    pub home_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordType {
    Identity,
    Binding,
    Evidence,
    LocationSemantics,
    Circuit,
    Valve,
    Relation,
    Geometry,
    Asset,
    Reconciliation,
}
impl RecordType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Identity => "identity",
            Self::Binding => "binding",
            Self::Evidence => "evidence",
            Self::LocationSemantics => "location-semantics",
            Self::Circuit => "circuit",
            Self::Valve => "valve",
            Self::Relation => "relation",
            Self::Geometry => "geometry",
            Self::Asset => "asset",
            Self::Reconciliation => "reconciliation",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRef {
    pub record_type: RecordType,
    pub record_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedTarget {
    pub workspace_id: String,
    pub home_id: String,
    pub record_type: RecordType,
    pub record_id: String,
}
impl ScopedTarget {
    pub fn new(scope: &Scope, target: &RecordRef) -> Self {
        Self {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            record_type: target.record_type,
            record_id: target.record_id.clone(),
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Active,
    Tombstoned,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Create,
    Replace,
    Tombstone,
    Restore,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub schema_version: u32,
    pub workspace_id: String,
    pub home_id: String,
    pub record_type: RecordType,
    pub record_id: String,
    pub revision: u64,
    pub lifecycle: Lifecycle,
    pub created_at: String,
    pub updated_at: String,
    pub last_audit_id: String,
    pub payload: Value,
}
impl Record {
    pub fn scope(&self) -> Scope {
        Scope {
            workspace_id: self.workspace_id.clone(),
            home_id: self.home_id.clone(),
        }
    }
    pub fn reference(&self) -> RecordRef {
        RecordRef {
            record_type: self.record_type,
            record_id: self.record_id.clone(),
        }
    }
    pub(crate) fn matches(&self, scope: &Scope, target: &RecordRef) -> bool {
        self.workspace_id == scope.workspace_id
            && self.home_id == scope.home_id
            && self.record_type == target.record_type
            && self.record_id == target.record_id
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Guard {
    pub record: RecordRef,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordValue {
    pub record_type: RecordType,
    pub payload: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    pub schema_version: u32,
    pub mutation_id: String,
    pub operation: Operation,
    #[serde(deserialize_with = "required_nullable")]
    pub expected_revision: Option<u64>,
    pub reason: String,
    pub guards: Vec<Guard>,
    #[serde(
        default,
        deserialize_with = "non_null_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub value: Option<RecordValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationEntry {
    pub target: RecordRef,
    pub command: Mutation,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchMutation {
    pub schema_version: u32,
    pub batch_id: String,
    pub reason: String,
    pub commands: Vec<MutationEntry>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Audit {
    pub schema_version: u32,
    pub audit_id: String,
    pub workspace_id: String,
    pub home_id: String,
    pub record: RecordRef,
    pub operation: Operation,
    #[serde(deserialize_with = "required_nullable")]
    pub previous_revision: Option<u64>,
    pub result_revision: u64,
    pub actor_id: String,
    pub at: String,
    pub reason: String,
    pub mutation_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub before_digest: Option<String>,
    pub after_digest: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationResult {
    pub schema_version: u32,
    pub record: Record,
    pub audit: Audit,
    pub replayed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchResult {
    pub schema_version: u32,
    pub batch_id: String,
    pub results: Vec<MutationResult>,
    pub replayed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub contract_version: String,
    pub synthetic: bool,
    pub sources: Vec<Value>,
    pub records: Vec<Record>,
    pub homebox_entities: Vec<Value>,
    pub caches: Vec<Value>,
    pub network_relations: Vec<Value>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            contract_version: CONTRACT_VERSION.into(),
            synthetic: true,
            sources: vec![],
            records: vec![],
            homebox_entities: vec![],
            caches: vec![],
            network_relations: vec![],
        }
    }
}
impl Snapshot {
    pub(crate) fn scoped(&self, scope: &Scope) -> Self {
        let filter = |rows: &[Value]| {
            rows.iter()
                .filter(|r| value_in_scope(r, scope))
                .cloned()
                .collect()
        };
        Self {
            contract_version: self.contract_version.clone(),
            synthetic: self.synthetic,
            sources: filter(&self.sources),
            records: self
                .records
                .iter()
                .filter(|r| r.scope() == *scope)
                .cloned()
                .collect(),
            homebox_entities: filter(&self.homebox_entities),
            caches: filter(&self.caches),
            network_relations: filter(&self.network_relations),
        }
    }
}
pub(crate) fn value_in_scope(row: &Value, scope: &Scope) -> bool {
    row["workspaceId"].as_str() == Some(&scope.workspace_id)
        && row["homeId"].as_str() == Some(&scope.home_id)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedActor {
    pub workspace_id: String,
    pub home_id: String,
    pub actor_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePartition {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationCachePartition {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
    pub cache_epoch: u64,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MutationClosure {
    pub record_refs: Vec<RecordRef>,
    pub missing_record_refs: Vec<RecordRef>,
    pub source_refs: Vec<Value>,
    pub source_partitions: Vec<SourcePartition>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPrecondition {
    pub revision: u64,
    pub lifecycle: Lifecycle,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GuardPrecondition {
    pub record: RecordRef,
    pub expected_revision: u64,
    pub current_revision: Option<u64>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreconditions {
    pub target: RecordRef,
    pub operation: Operation,
    pub expected_revision: Option<u64>,
    pub current: Option<CurrentPrecondition>,
    pub required_guards: Vec<RecordRef>,
    pub guards: Vec<GuardPrecondition>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreconditions {
    pub created_in_batch: Vec<RecordRef>,
    pub commands: Vec<CommandPreconditions>,
}
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MutationPhase {
    Intake,
    Validate,
    Candidate,
    Precommit,
    Replay,
    ReplayPrecommit,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Replay {
    pub results: Vec<MutationResult>,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MutationAuthorizationContext {
    pub format: &'static str,
    pub schema_version: u32,
    pub context_id: String,
    pub phase: MutationPhase,
    pub scope: Scope,
    pub entries: Vec<MutationEntry>,
    pub targets: Vec<RecordRef>,
    pub batch: Option<BatchMutation>,
    pub original: Snapshot,
    pub candidate: Option<Snapshot>,
    pub closure: MutationClosure,
    pub cache_partitions: Vec<MutationCachePartition>,
    pub preconditions: Option<MutationPreconditions>,
    pub replay: Option<Replay>,
}
fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
fn non_null_value<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<RecordValue>, D::Error> {
    RecordValue::deserialize(deserializer).map(Some)
}
