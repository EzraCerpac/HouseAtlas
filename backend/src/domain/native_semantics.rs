//! External composition candidate only. Timestamp parsing and raw-current
//! transition admission are required owner functions, presently unavailable.
//! This module supplies neither a fallback nor authority, storage or transport.

use crate::{contracts as schema, storage};
use schema::semantics;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use storage::Contract;

pub type TimestampMillis = fn(&str) -> storage::Result<Option<i64>>;
pub type TransitionFromValue = fn(
    Option<&Value>,
    &schema::Mutation,
    &semantics::MutationTarget,
) -> Result<semantics::Transition, semantics::SemanticError>;

#[derive(Clone, Copy)]
pub struct NativeSemantics {
    timestamp_millis: TimestampMillis,
    transition_from_value: TransitionFromValue,
}

impl NativeSemantics {
    /// Both functions must be the actual reviewed contract-owner functions.
    /// No constructor default, refresh, alternate parser or rejection shim is
    /// provided. Supplying arbitrary functions does not qualify this component.
    pub fn new(
        timestamp_millis: TimestampMillis,
        transition_from_value: TransitionFromValue,
    ) -> Self {
        Self {
            timestamp_millis,
            transition_from_value,
        }
    }
}

impl Contract for NativeSemantics {
    fn validate_shape(&self, name: &str, value: &Value) -> storage::Result<()> {
        // AT07's mapping validates directly and does not delegate this method
        // to its semantic peer; reuse the actual mapping without duplicating it.
        storage::NativeContract::new(*self).validate_shape(name, value)
    }

    fn validate_snapshot(&self, snapshot: &storage::Snapshot) -> storage::Result<()> {
        semantics::validate_snapshot(&carrier(snapshot)?).map_err(semantic_error)
    }

    fn assert_transition(
        &self,
        current: Option<&storage::Record>,
        command: &storage::Mutation,
        target: &storage::ScopedTarget,
    ) -> storage::Result<u64> {
        let target = mutation_target(target)?;
        let command = checked(command)?;
        // Keep the optional native current as raw detached JSON. Decoding its
        // typed payload here would preempt the owner's scoped-existence and
        // create-existing decision. Only the required owner function can apply
        // current shape checks in that function's original order.
        let current = current.map(serde_json::to_value).transpose()?;
        (self.transition_from_value)(current.as_ref(), &command, &target)
            .map(|transition| transition.next_revision)
            .map_err(semantic_error)
    }

    fn assert_guards(
        &self,
        original: &storage::Snapshot,
        current: Option<&storage::Record>,
        command: &storage::Mutation,
        target: &storage::ScopedTarget,
        created: &[storage::ScopedTarget],
    ) -> storage::Result<()> {
        // Standalone reference/guard functions require previously shape-checked
        // current records. AT07 calls its transition seam first in transactions.
        let current = current.map(checked::<schema::AtlasRecord>).transpose()?;
        let mut created_refs = Vec::with_capacity(created.len());
        for entry in created {
            if entry.workspace_id != target.workspace_id || entry.home_id != target.home_id {
                return Err(storage::Error::new(
                    "invalid-contract",
                    "Created reference is outside the mutation scope",
                ));
            }
            created_refs.push(mutation_target(entry)?.record);
        }
        semantics::assert_guards(
            &carrier(original)?,
            current.as_ref(),
            &carrier(command)?,
            &mutation_target(target)?,
            &created_refs,
        )
        .map_err(semantic_error)
    }

    fn assert_final_mutation(
        &self,
        candidate: &storage::Snapshot,
        current: Option<&storage::Record>,
        command: &storage::Mutation,
        target: &storage::ScopedTarget,
    ) -> storage::Result<()> {
        let current = current.map(carrier::<schema::AtlasRecord>).transpose()?;
        // AT07 validates the complete final graph before invoking this method
        // for each command in original order, retaining each original preimage.
        semantics::assert_final_mutation(
            &carrier(candidate)?,
            current.as_ref(),
            &carrier(command)?,
            &mutation_target(target)?,
        )
        .map_err(semantic_error)
    }

    fn validate_result(
        &self,
        result: &storage::MutationResult,
        prior: storage::Prior<'_>,
    ) -> storage::Result<()> {
        let previous = match prior {
            storage::Prior::Record(record) => Some(carrier::<schema::AtlasRecord>(record)?),
            _ => None,
        };
        let prior = match prior {
            storage::Prior::Unspecified => semantics::PriorRecord::Unspecified,
            storage::Prior::Missing => semantics::PriorRecord::Absent,
            storage::Prior::Record(_) => {
                semantics::PriorRecord::Record(previous.as_ref().expect("prior record branch"))
            }
        };
        semantics::validate_result(&carrier(result)?, prior).map_err(semantic_error)
    }

    fn canonical_json(&self, value: &Value) -> storage::Result<String> {
        semantics::canonical_json(value).map_err(semantic_error)
    }

    fn timestamp_millis(&self, value: &str) -> storage::Result<Option<i64>> {
        (self.timestamp_millis)(value)
    }
}

fn carrier<T: DeserializeOwned>(value: &impl Serialize) -> storage::Result<T> {
    Ok(serde_json::from_value(serde_json::to_value(value)?)?)
}

fn checked<T: schema::Contract>(value: &impl Serialize) -> storage::Result<T> {
    schema::decode(&serde_json::to_vec(value)?).map_err(|error| match error {
        schema::ContractError::Setup(_) => storage::Error::new(
            "schema-incompatible",
            "Native contract schema setup is unavailable",
        ),
        _ => storage::Error::new(
            "invalid-contract",
            "Native contract shape validation failed",
        ),
    })
}

fn mutation_target(target: &storage::ScopedTarget) -> storage::Result<semantics::MutationTarget> {
    Ok(semantics::MutationTarget {
        scope: checked(&storage::Scope {
            workspace_id: target.workspace_id.clone(),
            home_id: target.home_id.clone(),
        })?,
        record: checked(&storage::RecordRef {
            record_type: target.record_type,
            record_id: target.record_id.clone(),
        })?,
    })
}

fn semantic_error(error: semantics::SemanticError) -> storage::Error {
    // AT07's error carrier requires static sanitized messages. Preserve every
    // public domain category; never leak dynamic graph details or change it to
    // unavailable. Full semantic messages remain available at the owner API.
    storage::Error::new(
        error.code.as_str(),
        "Native semantic contract validation failed",
    )
}
