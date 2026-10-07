//! Storage contract adapter over the shared native schema and semantic owner.
//! This module converts carriers and delegates; it owns no graph, transition,
//! canonical-number, timestamp or authorization rules.
use crate::{contracts as c, contracts::semantics as sem, storage as s};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy)]
pub struct NativeContracts;
fn semantic(error: sem::SemanticError) -> s::Error {
    s::Error::new(error.code.as_str(), "Native contract validation failed")
}
fn checked<T: c::Contract>(value: &impl Serialize) -> s::Result<T> {
    c::decode::<T>(&serde_json::to_vec(value)?).map_err(|error| match error {
        c::ContractError::Setup(_) => s::Error::new(
            "schema-incompatible",
            "Native contract setup is unavailable",
        ),
        c::ContractError::UnsupportedNumber(message) => s::Error::new("invalid-contract", message),
        _ => s::Error::new(
            "invalid-contract",
            "Native contract shape validation failed",
        ),
    })
}
fn target(value: &s::ScopedTarget) -> s::Result<sem::MutationTarget> {
    Ok(sem::MutationTarget {
        scope: checked(&s::Scope {
            workspace_id: value.workspace_id.clone(),
            home_id: value.home_id.clone(),
        })?,
        record: checked(&s::RecordRef {
            record_type: value.record_type,
            record_id: value.record_id.clone(),
        })?,
    })
}
impl s::Contract for NativeContracts {
    fn validate_shape(&self, name: &str, value: &Value) -> s::Result<()> {
        // AT07 owns the explicit shape-name dispatch to generated AT51 DTOs.
        s::NativeContract::new(*self).validate_shape(name, value)
    }
    fn validate_snapshot(&self, snapshot: &s::Snapshot) -> s::Result<()> {
        sem::validate_snapshot(&checked(snapshot)?).map_err(semantic)
    }
    fn assert_transition(
        &self,
        current: Option<&s::Record>,
        command: &s::Mutation,
        selected: &s::ScopedTarget,
    ) -> s::Result<u64> {
        let current = current.map(checked::<c::AtlasRecord>).transpose()?;
        sem::assert_transition(current.as_ref(), &checked(command)?, &target(selected)?)
            .map(|result| result.next_revision)
            .map_err(semantic)
    }
    fn assert_guards(
        &self,
        original: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        selected: &s::ScopedTarget,
        created: &[s::ScopedTarget],
    ) -> s::Result<()> {
        let current = current.map(checked::<c::AtlasRecord>).transpose()?;
        let created = created
            .iter()
            .map(|value| {
                if value.workspace_id != selected.workspace_id || value.home_id != selected.home_id
                {
                    return Err(s::Error::new(
                        "invalid-contract",
                        "Created target scope differs",
                    ));
                }
                checked::<c::RecordRef>(&s::RecordRef {
                    record_type: value.record_type,
                    record_id: value.record_id.clone(),
                })
            })
            .collect::<s::Result<Vec<_>>>()?;
        sem::assert_guards(
            &checked(original)?,
            current.as_ref(),
            &checked(command)?,
            &target(selected)?,
            &created,
        )
        .map_err(semantic)
    }
    fn assert_final_mutation(
        &self,
        candidate: &s::Snapshot,
        current: Option<&s::Record>,
        command: &s::Mutation,
        selected: &s::ScopedTarget,
    ) -> s::Result<()> {
        let current = current.map(checked::<c::AtlasRecord>).transpose()?;
        sem::assert_final_mutation(
            &checked(candidate)?,
            current.as_ref(),
            &checked(command)?,
            &target(selected)?,
        )
        .map_err(semantic)
    }
    fn validate_result(&self, result: &s::MutationResult, prior: s::Prior<'_>) -> s::Result<()> {
        let current = match prior {
            s::Prior::Record(record) => Some(checked::<c::AtlasRecord>(record)?),
            _ => None,
        };
        let prior = match prior {
            s::Prior::Unspecified => sem::PriorRecord::Unspecified,
            s::Prior::Missing => sem::PriorRecord::Absent,
            s::Prior::Record(_) => sem::PriorRecord::Record(current.as_ref().ok_or_else(|| {
                s::Error::new("schema-incompatible", "Prior record conversion is missing")
            })?),
        };
        sem::validate_result(&checked(result)?, prior).map_err(semantic)
    }
    fn canonical_json(&self, value: &Value) -> s::Result<String> {
        sem::canonical_json(value).map_err(semantic)
    }
    fn timestamp_millis(&self, _: &str) -> s::Result<Option<i64>> {
        // The semantic owner must expose its existing source-event parser.
        // No transport parser or stricter substitute can replace that profile.
        Err(s::Error::new(
            "schema-incompatible",
            "Native source-event timestamp port unavailable",
        ))
    }
}
