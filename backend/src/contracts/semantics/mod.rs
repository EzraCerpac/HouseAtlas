//! Native domain semantics from the published contracts and mutation context.
//! These pure functions do not authorize, fetch, mutate a graph, or persist it.
//! Canonical hashing deliberately uses the finite JavaScript IEEE-754 model;
//! retained DTO number tokens do not imply lossless browser or digest arithmetic.

mod canonical;
mod closure;
mod common;
mod formats;
mod graph;
mod history;
mod mutations;
mod timestamps;

use serde::Serialize;
use serde_json::{Value, json};
use std::fmt;

use super::{
    AtlasRecord, BatchMutation, BatchMutationCommandsItem, Contract, HttpHistory, Mutation,
    MutationResult, RecordRef, Scope, Snapshot, SourceRef,
};

pub use canonical::{canonical_json, digest as canonical_digest};
pub(super) use formats::published_uri_format;
pub(super) use timestamps::parse_milliseconds as finite_timestamp_millis;
pub(super) use timestamps::published_date_format;
pub(super) use timestamps::published_date_time_format;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticCode {
    InvalidContract,
    IdentityConflict,
    Forbidden,
    NotFound,
    InvalidTransition,
    RevisionConflict,
    GuardConflict,
}

impl SemanticCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidContract => "invalid-contract",
            Self::IdentityConflict => "identity-conflict",
            Self::Forbidden => "forbidden",
            Self::NotFound => "not-found",
            Self::InvalidTransition => "invalid-transition",
            Self::RevisionConflict => "revision-conflict",
            Self::GuardConflict => "guard-conflict",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticError {
    pub code: SemanticCode,
    pub message: String,
}

impl SemanticError {
    pub fn new(code: SemanticCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(SemanticCode::InvalidContract, message)
    }
}

impl fmt::Display for SemanticError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for SemanticError {}

impl From<super::ContractError> for SemanticError {
    fn from(error: super::ContractError) -> Self {
        Self::invalid(error.to_string())
    }
}

impl From<serde_json::Error> for SemanticError {
    fn from(error: serde_json::Error) -> Self {
        Self::invalid(error.to_string())
    }
}

/// Existing scope and record-reference DTOs composed into a mutation route.
#[derive(Debug, Clone, PartialEq)]
pub struct MutationTarget {
    pub scope: Scope,
    pub record: RecordRef,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transition {
    pub next_revision: u64,
}

/// Keep the original record preimage for each submitted command.
#[derive(Debug, Clone, Copy)]
pub struct FinalMutation<'a> {
    pub current: Option<&'a AtlasRecord>,
    pub command: &'a Mutation,
    pub target: &'a MutationTarget,
}

/// Mirrors the published result validator's omitted/null/record distinction.
#[derive(Debug, Clone, Copy)]
pub enum PriorRecord<'a> {
    Unspecified,
    Absent,
    Record(&'a AtlasRecord),
}

pub(super) enum PriorValue<'a> {
    Unspecified,
    Absent,
    Record(&'a Value),
}

pub fn validate_snapshot(snapshot: &Snapshot) -> Result<(), SemanticError> {
    graph::validate_snapshot(&shape_value(snapshot)?)
}

pub fn assert_transition(
    current: Option<&AtlasRecord>,
    command: &Mutation,
    target: &MutationTarget,
) -> Result<Transition, SemanticError> {
    let target = target_value(target)?;
    let command = shape_value(command)?;
    let current = current.map(json_value).transpose()?;
    // The published helper checks scoped existence before current shape/CAS.
    if command["operation"] != "create"
        && let Some(current) = &current
        && common::record_key(current)? == common::record_key(&target)?
    {
        super::validate_value::<AtlasRecord>(current)?;
    }
    mutations::assert_transition(current.as_ref(), &command, &target)
        .map(|next_revision| Transition { next_revision })
}

pub fn required_references(
    snapshot: &Snapshot,
    current: Option<&AtlasRecord>,
    command: &Mutation,
    target: &MutationTarget,
) -> Result<Vec<RecordRef>, SemanticError> {
    let snapshot = shape_value(snapshot)?;
    let current = current.map(json_value).transpose()?;
    let command = shape_value(command)?;
    let target = target_value(target)?;
    mutations::required_references(&snapshot, current.as_ref(), &command, &target)?
        .into_iter()
        .map(|value| serde_json::from_value(value).map_err(Into::into))
        .collect()
}

pub fn assert_guards(
    snapshot: &Snapshot,
    current: Option<&AtlasRecord>,
    command: &Mutation,
    target: &MutationTarget,
    created_in_batch: &[RecordRef],
) -> Result<(), SemanticError> {
    let snapshot = shape_value(snapshot)?;
    let current = current.map(json_value).transpose()?;
    let command = shape_value(command)?;
    let target = target_value(target)?;
    let created = created_in_batch
        .iter()
        .map(shape_value)
        .collect::<Result<Vec<_>, _>>()?;
    mutations::assert_guards(&snapshot, current.as_ref(), &command, &target, &created)
}

/// Storage calls this against the original graph before building candidates.
pub fn validate_mutation_preconditions(
    snapshot: &Snapshot,
    current: Option<&AtlasRecord>,
    command: &Mutation,
    target: &MutationTarget,
    created_in_batch: &[RecordRef],
) -> Result<Transition, SemanticError> {
    let transition = assert_transition(current, command, target)?;
    assert_guards(snapshot, current, command, target, created_in_batch)?;
    Ok(transition)
}

/// Checks new create decisions; historical retained records use snapshot rules.
pub fn assert_final_mutation(
    snapshot: &Snapshot,
    current: Option<&AtlasRecord>,
    command: &Mutation,
    target: &MutationTarget,
) -> Result<(), SemanticError> {
    let command = shape_value(command)?;
    if command["operation"] != "create" {
        return Ok(());
    }
    let snapshot = shape_value(snapshot)?;
    let target = target_value(target)?;
    let current = current.map(json_value).transpose()?;
    mutations::assert_final_mutation(&snapshot, current.as_ref(), &command, &target)
}

/// Final graph first, then per-command create decisions in submitted order.
/// This does not construct the candidate or run authorization callbacks.
pub fn validate_final_candidate(
    snapshot: &Snapshot,
    commands: &[FinalMutation<'_>],
) -> Result<(), SemanticError> {
    let snapshot = shape_value(snapshot)?;
    graph::validate_snapshot(&snapshot)?;
    for entry in commands {
        let command = shape_value(entry.command)?;
        let target = target_value(entry.target)?;
        let current = entry.current.map(json_value).transpose()?;
        mutations::assert_final_mutation(&snapshot, current.as_ref(), &command, &target)?;
    }
    Ok(())
}

pub fn validate_result(
    result: &MutationResult,
    prior: PriorRecord<'_>,
) -> Result<(), SemanticError> {
    let result = shape_value(result)?;
    let previous = match prior {
        PriorRecord::Record(record) => Some(json_value(record)?),
        _ => None,
    };
    let prior = match prior {
        PriorRecord::Unspecified => PriorValue::Unspecified,
        PriorRecord::Absent => PriorValue::Absent,
        PriorRecord::Record(_) => PriorValue::Record(previous.as_ref().expect("record branch")),
    };
    history::validate_result(&result, prior)
}

/// Bare recorded audit array, in storage sequence order; no invented prehistory
/// or sorting is introduced by the semantic component.
pub fn validate_history(history: &HttpHistory) -> Result<(), SemanticError> {
    shape_value(history).map(|_| ())
}

pub fn record_digest(record: &AtlasRecord) -> Result<String, SemanticError> {
    canonical::digest(&shape_value(record)?)
}

/// Exact published ordered batch hash: {scope, ...batch}.
pub fn batch_digest(scope: &Scope, batch: &BatchMutation) -> Result<String, SemanticError> {
    let scope = shape_value(scope)?;
    let mut value = shape_value(batch)?;
    value
        .as_object_mut()
        .ok_or_else(|| SemanticError::invalid("Expected batch object"))?
        .insert("scope".to_owned(), scope);
    canonical::digest(&value)
}

/// Exact published mutation receipt hash: {target, command, batchId, batchHash}.
pub fn mutation_digest(
    target: &MutationTarget,
    command: &Mutation,
    batch_id: Option<&str>,
    batch_hash: Option<&str>,
) -> Result<String, SemanticError> {
    canonical::digest(
        &json!({"target": target_value(target)?, "command": shape_value(command)?,
        "batchId": batch_id, "batchHash": batch_hash}),
    )
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceClosure {
    pub record_refs: Vec<RecordRef>,
    pub missing_record_refs: Vec<RecordRef>,
    pub source_refs: Vec<SourceRef>,
    pub source_partitions: Vec<SourcePartition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePartition {
    pub workspace_id: String,
    pub home_id: String,
    pub source_instance_id: String,
    pub collection_id: String,
}

/// Pure detached reference facts. It performs no grant/authority decision.
pub fn reference_closure(
    scope: &Scope,
    original: &Snapshot,
    candidate: Option<&Snapshot>,
    entries: &[BatchMutationCommandsItem],
    replay_results: Option<&[MutationResult]>,
) -> Result<ReferenceClosure, SemanticError> {
    let scope = shape_value(scope)?;
    let original = scoped_snapshot(shape_value(original)?, &scope)?;
    let candidate = candidate
        .map(shape_value)
        .transpose()?
        .map(|snapshot| scoped_snapshot(snapshot, &scope))
        .transpose()?;
    let entries = entries
        .iter()
        .map(json_value)
        .collect::<Result<Vec<_>, _>>()?;
    // Every entry uses existing recordRef/mutation schemas, even outside a batch envelope.
    for entry in &entries {
        super::validate_value::<RecordRef>(&entry["target"])?;
        super::validate_value::<Mutation>(&entry["command"])?;
    }
    let replay = replay_results
        .map(|results| {
            results
                .iter()
                .map(shape_value)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let value = closure::reference_closure(
        &scope,
        &original,
        candidate.as_ref(),
        &entries,
        replay.as_deref(),
    )?;
    Ok(ReferenceClosure {
        record_refs: serde_json::from_value(value["recordRefs"].clone())?,
        missing_record_refs: serde_json::from_value(value["missingRecordRefs"].clone())?,
        source_refs: serde_json::from_value(value["sourceRefs"].clone())?,
        source_partitions: serde_json::from_value(value["sourcePartitions"].clone())?,
    })
}

fn json_value<T: Serialize>(value: &T) -> Result<Value, SemanticError> {
    let value = serde_json::to_value(value)?;
    super::ensure_numbers_supported(&value).map_err(SemanticError::invalid)?;
    canonical::normalize_numbers(value)
}

fn shape_value<T: Contract>(value: &T) -> Result<Value, SemanticError> {
    let value = json_value(value)?;
    super::validate_value::<T>(&value)?;
    Ok(value)
}

fn target_value(target: &MutationTarget) -> Result<Value, SemanticError> {
    let scope = shape_value(&target.scope)?;
    let record = shape_value(&target.record)?;
    Ok(
        json!({"workspaceId": scope["workspaceId"], "homeId": scope["homeId"],
        "recordType": record["recordType"], "recordId": record["recordId"]}),
    )
}

fn scoped_snapshot(mut snapshot: Value, scope: &Value) -> Result<Value, SemanticError> {
    for field in [
        "sources",
        "records",
        "homeboxEntities",
        "caches",
        "networkRelations",
    ] {
        let filtered = common::items(&snapshot[field])?
            .iter()
            .map(|row| common::same_scope(row, scope).map(|included| (row, included)))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|(_, included)| *included)
            .map(|(row, _)| row.clone())
            .collect();
        snapshot[field] = Value::Array(filtered);
    }
    Ok(snapshot)
}
