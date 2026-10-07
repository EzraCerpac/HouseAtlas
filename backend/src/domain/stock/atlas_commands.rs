//! Pure mapping of accepted stock Atlas requests to frozen native command plans.
//!
//! A plan is not a stock receipt or an execution capability. The native owner
//! must retain its complete stock envelopes, keys, digests and group linkage in
//! the same transaction as records, audits and receipts before executing it.
//! Authorization, final graph checks, approvals and presence admission stay
//! with that owner; this module performs no reads, writes or authority capture.

use super::{Authority, Effect, OperationId, StockError, StockResult, ValidatedRequest};
use crate::storage::{Contract, Guard, MutationEntry, Operation, Scope};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Immutable accepted root intent and ordered mapped operation groups.
#[derive(Clone, Debug)]
pub struct AtlasCommandPlan {
    original_request: Value,
    request_digest: String,
    scope: Scope,
    root_idempotency_key: String,
    batch_target_id: Option<String>,
    root_guards: Vec<Guard>,
    groups: Vec<AtlasCommandGroup>,
}

impl AtlasCommandPlan {
    pub fn original_request(&self) -> &Value {
        &self.original_request
    }
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn root_idempotency_key(&self) -> &str {
        &self.root_idempotency_key
    }
    /// Stock target.batchId is distinct from the root idempotency key.
    pub fn batch_target_id(&self) -> Option<&str> {
        self.batch_target_id.as_deref()
    }
    /// Batch root guards must be checked separately against the same prestate.
    /// For a single command these also occur in its native mutation; they are
    /// never merged into or substituted for the submitted child guard arrays.
    pub fn root_guards(&self) -> &[Guard] {
        &self.root_guards
    }
    pub fn groups(&self) -> &[AtlasCommandGroup] {
        &self.groups
    }
}

/// One stock command and its native entries. A single root has no child index;
/// batch children retain their original zero-based order and exact envelopes.
#[derive(Clone, Debug)]
pub struct AtlasCommandGroup {
    child_index: Option<usize>,
    original_request: Value,
    request_digest: String,
    native_entries: Vec<MutationEntry>,
}

impl AtlasCommandGroup {
    pub fn child_index(&self) -> Option<usize> {
        self.child_index
    }
    pub fn original_request(&self) -> &Value {
        &self.original_request
    }
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub fn native_entries(&self) -> &[MutationEntry] {
        &self.native_entries
    }
}

/// Map only published forms with an exact frozen command representation.
/// The required native Contract validates every resulting scope, target, guard,
/// mutation and batch shape; it does not authorize or execute the plan.
pub fn plan_atlas_commands(
    request: &ValidatedRequest,
    contracts: &impl Contract,
) -> StockResult<AtlasCommandPlan> {
    plan_atlas_commands_with(request, contracts, |child, index| {
        map_group(child, index, contracts)
    })
}

pub(super) fn plan_atlas_commands_with(
    request: &ValidatedRequest,
    contracts: &impl Contract,
    map: impl Fn(&ValidatedRequest, Option<usize>) -> StockResult<AtlasCommandGroup>,
) -> StockResult<AtlasCommandPlan> {
    require_atlas_write(request)?;
    check_reason(request.raw())?;
    let scope = decode(contracts, "scope", request.raw()["context"].clone())?;
    let root_idempotency_key = text(request.raw(), "idempotencyKey")?.to_owned();
    let root_guards = native_guards(request.raw(), contracts)?;
    let (batch_target_id, groups) = if request.id() == OperationId::AtlasBatchExecute {
        let batch_id = text(request.target(), "batchId")?.to_owned();
        let groups = request
            .children()
            .iter()
            .enumerate()
            .map(|(index, child)| {
                if child.context() != request.context() {
                    return Err(StockError::InvalidContract);
                }
                map(child, Some(index))
            })
            .collect::<StockResult<Vec<_>>>()?;
        require_unique_batch_entries(&groups)?;
        let entries: Vec<_> = groups
            .iter()
            .flat_map(|group| group.native_entries.iter().cloned())
            .collect();
        // Validate the native batch without treating its receipt as a stock
        // receipt. Root stock guards and root key remain separate above.
        let _: crate::storage::BatchMutation = decode(
            contracts,
            "batchMutation",
            json!({"schemaVersion": 1, "batchId": batch_id,
                "reason": request.raw()["reason"], "commands": entries}),
        )?;
        (Some(batch_id), groups)
    } else {
        (None, vec![map(request, None)?])
    };
    Ok(AtlasCommandPlan {
        original_request: request.raw().clone(),
        request_digest: request.intent_digest().to_owned(),
        scope,
        root_idempotency_key,
        batch_target_id,
        root_guards,
        groups,
    })
}

pub(super) fn map_group(
    request: &ValidatedRequest,
    child_index: Option<usize>,
    contracts: &impl Contract,
) -> StockResult<AtlasCommandGroup> {
    let operation = native_operation(request.id())?;
    map_group_with_payload(
        request,
        child_index,
        contracts,
        operation,
        request.payload(),
    )
}

pub(super) fn map_group_with_payload(
    request: &ValidatedRequest,
    child_index: Option<usize>,
    contracts: &impl Contract,
    operation: Operation,
    payload: &Value,
) -> StockResult<AtlasCommandGroup> {
    require_atlas_write(request)?;
    check_reason(request.raw())?;
    let target = decode(
        contracts,
        "recordRef",
        json!({"recordType": request.target()["recordType"],
            "recordId": request.target()["recordId"]}),
    )?;
    let guards = native_guards(request.raw(), contracts)?;
    let expected_revision = if operation == Operation::Create {
        if !request.raw()["preconditions"]["target"].is_null() {
            return Err(StockError::CapabilityHeld);
        }
        Value::Null
    } else {
        let revision = &request.raw()["preconditions"]["target"];
        if revision["kind"] != "atlas" {
            return Err(StockError::CapabilityHeld);
        }
        revision["value"].clone()
    };
    let mut mutation = json!({"schemaVersion": 1,
        "mutationId": request.raw()["idempotencyKey"], "operation": operation,
        "expectedRevision": expected_revision, "reason": request.raw()["reason"],
        "guards": guards});
    if matches!(operation, Operation::Create | Operation::Replace) {
        mutation["value"] = json!({"recordType": request.target()["recordType"],
            "payload": payload});
    }
    let command = decode(contracts, "mutation", mutation)?;
    Ok(AtlasCommandGroup {
        child_index,
        original_request: request.raw().clone(),
        request_digest: request.intent_digest().to_owned(),
        native_entries: vec![MutationEntry { target, command }],
    })
}

fn native_operation(id: OperationId) -> StockResult<Operation> {
    use OperationId::*;
    Ok(match id {
        AtlasIdentityCreate
        | AtlasEvidenceCreate
        | AtlasLocationSemanticsCreate
        | AtlasCircuitCreate
        | AtlasValveCreate
        | AtlasRelationCreate
        | AtlasReconciliationCreate => Operation::Create,
        AtlasIdentityReplace
        | AtlasLocationSemanticsReplace
        | AtlasCircuitReplace
        | AtlasValveReplace
        | AtlasRelationReplace => Operation::Replace,
        AtlasIdentityTombstone
        | AtlasBindingTombstone
        | AtlasEvidenceTombstone
        | AtlasLocationSemanticsTombstone
        | AtlasCircuitTombstone
        | AtlasValveTombstone
        | AtlasRelationTombstone
        | AtlasGeometryTombstone
        | AtlasAssetTombstone
        | AtlasReconciliationTombstone => Operation::Tombstone,
        AtlasIdentityRestore
        | AtlasEvidenceRestore
        | AtlasLocationSemanticsRestore
        | AtlasCircuitRestore
        | AtlasValveRestore
        | AtlasRelationRestore
        | AtlasGeometryRestore
        | AtlasAssetRestore
        | AtlasReconciliationRestore => Operation::Restore,
        // These need actual original/candidate semantics, verified staged media,
        // derived import time, or atomic remap/presence/approval composition.
        AtlasBindingCreate | AtlasBindingReview | AtlasBindingRestore | AtlasBindingRemap
        | AtlasGeometryCreate | AtlasAssetCreate | AtlasAssetReview => {
            return Err(StockError::CapabilityHeld);
        }
        _ => return Err(StockError::CapabilityHeld),
    })
}

fn require_atlas_write(request: &ValidatedRequest) -> StockResult<()> {
    if request.operation().authority != Authority::Atlas
        || request.operation().effect != Effect::Write
    {
        return Err(StockError::CapabilityHeld);
    }
    Ok(())
}

fn require_unique_batch_entries(groups: &[AtlasCommandGroup]) -> StockResult<()> {
    let mut mutation_ids = BTreeSet::new();
    let mut targets = BTreeSet::new();
    for entry in groups.iter().flat_map(|group| &group.native_entries) {
        if !mutation_ids.insert(entry.command.mutation_id.as_str())
            || !targets.insert((
                entry.target.record_type.as_str(),
                entry.target.record_id.as_str(),
            ))
        {
            // The published catalog and native owner require unique child keys
            // and targets even though the stock array shape alone permits them.
            return Err(StockError::CapabilityHeld);
        }
    }
    Ok(())
}

fn check_reason(request: &Value) -> StockResult<()> {
    // Stock permits 4096 code points; frozen Mutation/BatchMutation permit 1024.
    // Retain the entire valid stock reason and hold an unmappable request.
    if text(request, "reason")?.chars().count() > 1024 {
        return Err(StockError::CapabilityHeld);
    }
    Ok(())
}

fn native_guards(request: &Value, contracts: &impl Contract) -> StockResult<Vec<Guard>> {
    request["preconditions"]["guards"]
        .as_array()
        .ok_or(StockError::InvalidContract)?
        .iter()
        .map(|guard| {
            if guard["target"]["authority"] != "atlas" || guard["revision"]["kind"] != "atlas" {
                return Err(StockError::CapabilityHeld);
            }
            decode(
                contracts,
                "guard",
                json!({"record": {"recordType": guard["target"]["recordType"],
                    "recordId": guard["target"]["recordId"]},
                    "expectedRevision": guard["revision"]["value"]}),
            )
        })
        .collect()
}

fn decode<T: DeserializeOwned>(
    contracts: &impl Contract,
    shape: &str,
    value: Value,
) -> StockResult<T> {
    contracts.validate_shape(shape, &value).map_err(|error| {
        // The stock request was already accepted. A stricter frozen form is a
        // held mapping; an unavailable native contract peer stays unavailable.
        if error.code == "invalid-contract" {
            StockError::CapabilityHeld
        } else {
            StockError::OwnerUnavailable
        }
    })?;
    serde_json::from_value(value).map_err(|_| StockError::OwnerUnavailable)
}

fn text<'a>(value: &'a Value, field: &str) -> StockResult<&'a str> {
    value[field].as_str().ok_or(StockError::InvalidContract)
}
