//! Shared native schema boundary plus a required semantic Contract peer.
//! This adapter supplies no graph, authorization, JCS or timestamp fallback.
use super::*;
use crate::contracts as schema;
use serde_json::Value;

#[derive(Clone)]
pub struct NativeContract<C> {
    semantics: C,
}
impl<C: Contract> NativeContract<C> {
    pub fn new(semantics: C) -> Self {
        Self { semantics }
    }
}
fn checked<T: schema::Contract>(value: &Value) -> Result<()> {
    schema::decode::<T>(&serde_json::to_vec(value)?)
        .map(|_| ())
        .map_err(|error| match error {
            schema::ContractError::UnsupportedNumber(message) => {
                Error::new("invalid-contract", message)
            }
            schema::ContractError::Setup(_) => Error::new(
                "schema-incompatible",
                "Native contract schema setup is unavailable",
            ),
            _ => Error::new(
                "invalid-contract",
                "Native contract shape validation failed",
            ),
        })
}
impl<C: Contract> Contract for NativeContract<C> {
    fn validate_shape(&self, name: &str, value: &Value) -> Result<()> {
        match name {
            "scope" => checked::<schema::Scope>(value),
            "recordRef" => checked::<schema::RecordRef>(value),
            "snapshot" => checked::<schema::Snapshot>(value),
            "record" => checked::<schema::Record>(value),
            "assetPayload" => checked::<schema::AssetPayload>(value),
            "audit" => checked::<schema::Audit>(value),
            "guard" => checked::<schema::Guard>(value),
            "mutation" => checked::<schema::Mutation>(value),
            "mutationResult" => checked::<schema::MutationResult>(value),
            "batchMutation" => checked::<schema::BatchMutation>(value),
            "batchResult" => checked::<schema::BatchResult>(value),
            "sourceRegistration" => checked::<schema::SourceRegistration>(value),
            "cacheStatus" => checked::<schema::CacheStatus>(value),
            "homeboxProjection" => checked::<schema::HomeboxProjection>(value),
            "networkRelation" => checked::<schema::NetworkRelation>(value),
            _ => Err(Error::new(
                "schema-incompatible",
                "Storage native shape adapter requires an explicit schema mapping",
            )),
        }
    }
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        checked::<schema::Snapshot>(&serde_json::to_value(snapshot)?)?;
        self.semantics.validate_snapshot(snapshot)
    }
    fn assert_transition(
        &self,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<u64> {
        self.semantics.assert_transition(current, command, target)
    }
    fn assert_guards(
        &self,
        original: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
        created: &[ScopedTarget],
    ) -> Result<()> {
        self.semantics
            .assert_guards(original, current, command, target, created)
    }
    fn assert_final_mutation(
        &self,
        candidate: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<()> {
        self.semantics
            .assert_final_mutation(candidate, current, command, target)
    }
    fn validate_result(&self, result: &MutationResult, prior: Prior<'_>) -> Result<()> {
        checked::<schema::MutationResult>(&serde_json::to_value(result)?)?;
        self.semantics.validate_result(result, prior)
    }
    fn canonical_json(&self, value: &Value) -> Result<String> {
        self.semantics.canonical_json(value)
    }
    fn timestamp_millis(&self, value: &str) -> Result<Option<i64>> {
        self.semantics.timestamp_millis(value)
    }
}
