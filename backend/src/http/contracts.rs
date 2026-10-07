//! Root profile delegates all storage semantics to the exact native domain peer.
use crate::{domain::native_semantics::NativeSemantics, storage as s};
use serde_json::Value;
#[derive(Clone, Copy)]
pub struct NativeContracts;
fn native() -> NativeSemantics {
    NativeSemantics::native()
}
impl s::Contract for NativeContracts {
    fn validate_shape(&self, name: &str, value: &Value) -> s::Result<()> {
        native().validate_shape(name, value)
    }
    fn validate_snapshot(&self, snapshot: &s::Snapshot) -> s::Result<()> {
        native().validate_snapshot(snapshot)
    }
    fn assert_transition(
        &self,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
    ) -> s::Result<u64> {
        native().assert_transition(current, command, target)
    }
    fn assert_guards(
        &self,
        original: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
        created: &[s::ScopedTarget],
    ) -> s::Result<()> {
        native().assert_guards(original, current, command, target, created)
    }
    fn assert_final_mutation(
        &self,
        candidate: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        target: &s::ScopedTarget,
    ) -> s::Result<()> {
        native().assert_final_mutation(candidate, current, command, target)
    }
    fn validate_result(&self, result: &s::MutationResult, prior: s::Prior<'_>) -> s::Result<()> {
        native().validate_result(result, prior)
    }
    fn canonical_json(&self, value: &Value) -> s::Result<String> {
        native().canonical_json(value)
    }
    fn timestamp_millis(&self, value: &str) -> s::Result<Option<i64>> {
        native().timestamp_millis(value)
    }
}
