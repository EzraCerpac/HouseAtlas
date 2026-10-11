//! Pure projection of native Atlas results and retained stock commit metadata.
//!
//! These borrowed views are not a durable receipt, execution capability or
//! authority proof. The host must supply metadata from the same native atomic
//! stock commit as the results. Stock dispatch still authorizes every disclosed
//! result and revalidates the original principal before release. No IDs, times,
//! grants, original preimages or successful execution are manufactured here.

use super::{
    AtlasCommandPlan, Authority, Effect, OperationId, OwnerResult, StockContractPort, StockError,
    StockResult, ValidatedRequest, canonical_bytes, request_digest,
};
use crate::{
    domain::{DomainError, native_storage::native_error},
    storage::{self, Contract, Lifecycle, MutationEntry, MutationResult, Operation, Prior, Record},
};
use serde_json::{Value, json};

/// Borrow only the original root metadata returned by the native stock owner.
/// Its actor is the owner's verified durable actor, not a request claim. The
/// actual owner commit supplies durable metadata; this view grants no execution.
#[derive(Clone, Copy, Debug)]
pub struct AtlasCommitView<'a> {
    pub original_request: &'a Value,
    pub request_digest: &'a str,
    pub operation_id: &'a str,
    pub actor_id: &'a str,
    pub replayed: bool,
    pub groups: &'a [AtlasCommitGroupView<'a>],
}

/// One retained root/child operation group with its actual native results.
/// A single operation uses child_index=None and the same metadata as its root.
#[derive(Clone, Copy, Debug)]
pub struct AtlasCommitGroupView<'a> {
    pub child_index: Option<usize>,
    pub original_request: &'a Value,
    pub request_digest: &'a str,
    pub operation_id: &'a str,
    pub replayed: bool,
    pub native_results: &'a [MutationResult],
}

/// Correlate an immutable accepted plan with genuine owner results, then build
/// unreleased exact stock mutation-result envelopes. This cannot execute a plan
/// through frozen commands or establish that arbitrary supplied views persisted.
pub fn map_atlas_commit(
    request: &ValidatedRequest,
    plan: &AtlasCommandPlan,
    commit: &AtlasCommitView<'_>,
    stock: &impl StockContractPort,
    native: &impl Contract,
) -> StockResult<OwnerResult> {
    require(
        request.operation().authority == Authority::Atlas
            && request.operation().effect == Effect::Write,
    )?;
    require(request.raw() == plan.original_request())?;
    require(request.intent_digest() == plan.request_digest())?;
    require(
        plan.scope().workspace_id == request.context().workspace_id
            && plan.scope().home_id == request.context().home_id,
    )?;
    require(request.raw()["idempotencyKey"] == plan.root_idempotency_key())?;
    validate_stock(
        stock,
        request.operation().input_schema,
        commit.original_request,
    )?;
    check_retained_intent(
        request.raw(),
        commit.original_request,
        request.intent_digest(),
        commit.request_digest,
        commit.replayed,
    )?;

    let batch = request.id() == OperationId::AtlasBatchExecute;
    let count = if batch { request.children().len() } else { 1 };
    require(plan.groups().len() == count && commit.groups.len() == count)?;
    if batch {
        require(plan.batch_target_id() == request.target()["batchId"].as_str())?;
    } else {
        require(plan.batch_target_id().is_none())?;
    }

    let mut records = Vec::new();
    let mut audit_ids = Vec::new();
    let mut children = Vec::new();
    for (index, (group_plan, group)) in plan.groups().iter().zip(commit.groups).enumerate() {
        let expected = if batch {
            &request.children()[index]
        } else {
            request
        };
        let child_index = if batch { Some(index) } else { None };
        require(group.child_index == child_index && group_plan.child_index() == child_index)?;
        require(expected.raw() == group_plan.original_request())?;
        require(expected.intent_digest() == group_plan.request_digest())?;
        require(group.replayed == commit.replayed)?;
        validate_stock(
            stock,
            expected.operation().input_schema,
            group.original_request,
        )?;
        if batch {
            // Parent intent retains every child transport/approval ID. No
            // independent child renewal or envelope substitution is permitted.
            require(
                native
                    .canonical_json(group.original_request)
                    .map_err(native_output_error)?
                    == native
                        .canonical_json(group_plan.original_request())
                        .map_err(native_output_error)?,
            )?;
            require(
                group.original_request == &commit.original_request["payload"]["commands"][index],
            )?;
        } else {
            require(group.original_request == commit.original_request)?;
            require(group.operation_id == commit.operation_id)?;
        }
        check_retained_intent(
            expected.raw(),
            group.original_request,
            expected.intent_digest(),
            group.request_digest,
            !batch && commit.replayed,
        )?;
        require(group.native_results.len() == group_plan.native_entries().len())?;
        require(!group.native_results.is_empty())?;

        let mut group_records = Vec::new();
        let mut group_audits = Vec::new();
        for (entry, result) in group_plan.native_entries().iter().zip(group.native_results) {
            check_native_result(
                entry,
                result,
                plan.scope(),
                commit.actor_id,
                group.replayed,
                native,
            )?;
            group_records.push(public_record(&result.record)?);
            group_audits.push(Value::String(result.audit.audit_id.clone()));
        }
        let wire = receipt_wire(
            expected,
            group.operation_id,
            group.request_digest,
            group.replayed,
            &group_records,
            &group_audits,
        );
        validate_stock(stock, expected.operation().output_schema, &wire)?;
        if batch {
            children.push(wire);
        }
        records.extend(group_records);
        audit_ids.extend(group_audits);
    }
    let wire = receipt_wire(
        request,
        commit.operation_id,
        commit.request_digest,
        commit.replayed,
        &records,
        &audit_ids,
    );
    validate_stock(stock, request.operation().output_schema, &wire)?;
    Ok(OwnerResult { wire, children })
}

fn check_retained_intent(
    current: &Value,
    retained: &Value,
    expected_digest: &str,
    stored_digest: &str,
    allow_root_renewal: bool,
) -> StockResult<()> {
    require(stored_digest == expected_digest)?;
    require(request_digest(retained)? == stored_digest)?;
    if !allow_root_renewal {
        // Full envelopes retain transport/approval IDs and every child field.
        // Canonical numeric spellings do not change that immutable intent.
        return require(canonical_bytes(current)? == canonical_bytes(retained)?);
    }
    // Compare actual canonical intent as well as its digest. Only this root's
    // transport request ID and approval receipt may differ during replay.
    require(retained_atlas_intent_matches(current, retained)?)
}

/// Compare the actual canonical Atlas intent, not only its digest. This pure
/// data check excludes only this root's transport request and approval receipt
/// IDs; all ordered child envelopes and submitted facts remain bound. It
/// grants no replay, mutation, Media release or disclosure authority.
pub fn retained_atlas_intent_matches(current: &Value, retained: &Value) -> StockResult<bool> {
    Ok(canonical_bytes(&atlas_intent(current)?)? == canonical_bytes(&atlas_intent(retained)?)?)
}

fn atlas_intent(value: &Value) -> StockResult<Value> {
    let mut intent = value.clone();
    let root = intent
        .as_object_mut()
        .ok_or(StockError::CorrelationMismatch)?;
    require(
        root.get("target")
            .and_then(|target| target.get("authority"))
            .and_then(Value::as_str)
            == Some("atlas"),
    )?;
    root.remove("requestId");
    root.remove("approvalReceiptId");
    Ok(intent)
}

fn check_native_result(
    entry: &MutationEntry,
    result: &MutationResult,
    scope: &storage::Scope,
    actor_id: &str,
    replayed: bool,
    native: &impl Contract,
) -> StockResult<()> {
    let value = serde_json::to_value(result)
        .map_err(|_| StockError::Domain(DomainError::UpstreamIncomplete))?;
    native
        .validate_shape("mutationResult", &value)
        .map_err(native_output_error)?;
    // Original preimages are absent from the published return carriers. Native
    // transaction validation supplies prior-record/final-graph proof; this
    // retained-result check validates the self-contained frozen result without
    // inventing a prior or reading a newer record during replay.
    native
        .validate_result(result, Prior::Unspecified)
        .map_err(native_output_error)?;
    let record = &result.record;
    let audit = &result.audit;
    require(record.scope() == *scope && record.reference() == entry.target)?;
    require(
        audit.workspace_id == scope.workspace_id
            && audit.home_id == scope.home_id
            && audit.record == entry.target,
    )?;
    require(audit.actor_id == actor_id)?;
    require(
        audit.mutation_id == entry.command.mutation_id
            && audit.operation == entry.command.operation
            && audit.previous_revision == entry.command.expected_revision
            && audit.reason == entry.command.reason,
    )?;
    require(result.replayed == replayed)?;
    let revision = match entry.command.expected_revision {
        None => 1,
        Some(previous) => previous
            .checked_add(1)
            .ok_or(StockError::CorrelationMismatch)?,
    };
    require(record.revision == revision && audit.result_revision == revision)?;
    let lifecycle = if entry.command.operation == Operation::Tombstone {
        Lifecycle::Tombstoned
    } else {
        Lifecycle::Active
    };
    require(record.lifecycle == lifecycle)?;
    if let Some(value) = &entry.command.value {
        require(record.record_type == value.record_type)?;
        let submitted = native
            .canonical_json(&value.payload)
            .map_err(native_output_error)?;
        let committed = native
            .canonical_json(&record.payload)
            .map_err(native_output_error)?;
        require(submitted == committed)?;
    }
    Ok(())
}

fn public_record(record: &Record) -> StockResult<Value> {
    let mut payload = record.payload.clone();
    if record.record_type == storage::RecordType::Asset {
        payload
            .as_object_mut()
            .ok_or(StockError::Domain(DomainError::UpstreamIncomplete))?
            .remove("storageKey");
    }
    Ok(
        json!({"target":{"authority":"atlas", "recordType":record.record_type,
        "recordId":record.record_id}, "revision":record.revision,
        "lifecycle":record.lifecycle, "payload":payload}),
    )
}

fn receipt_wire(
    request: &ValidatedRequest,
    operation_id: &str,
    digest: &str,
    replayed: bool,
    records: &[Value],
    audit_ids: &[Value],
) -> Value {
    json!({"schemaVersion":3,"commandId":request.id().as_str(),
        "requestId":request.request_id(),"resolvedScope":request.context(),
        "status":"committed","replayed":replayed,"operationId":operation_id,
        "data":{"records":records,"auditIds":audit_ids,"requestDigest":digest}})
}

fn validate_stock(stock: &impl StockContractPort, schema: &str, value: &Value) -> StockResult<()> {
    stock.validate(schema, value).map_err(|error| match error {
        StockError::OwnerUnavailable | StockError::Domain(DomainError::UpstreamUnavailable) => {
            error
        }
        _ => StockError::Domain(DomainError::UpstreamIncomplete),
    })
}

fn native_output_error(error: storage::Error) -> StockError {
    StockError::Domain(match native_error(error) {
        DomainError::UpstreamUnavailable => DomainError::UpstreamUnavailable,
        _ => DomainError::UpstreamIncomplete,
    })
}

fn require(condition: bool) -> StockResult<()> {
    if condition {
        Ok(())
    } else {
        Err(StockError::CorrelationMismatch)
    }
}
