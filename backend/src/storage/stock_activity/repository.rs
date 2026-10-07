use super::*;
use rusqlite::{OptionalExtension, params};

pub(super) struct Row {
    pub operation: StoredOperation,
    pub permit: Option<InvocationPermit>,
    pub body_accepted: bool,
}
pub(super) fn register(
    db: &Connection,
    registration: &StockActivityRegistration,
) -> PortResult<()> {
    let binding = &registration.physical_binding;
    let prior: Option<(String,String,String,String)> = db.query_row("SELECT deployment_id,configuration_digest,owner_id,dispatcher_epoch FROM stock_activity_physical WHERE physical_database_id=?1", [binding.physical_database_id.to_string()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(unavailable)?;
    let expected = (
        binding.deployment_id.to_string(),
        binding.configuration_digest.as_str().into(),
        registration.owner_id.to_string(),
        registration.dispatcher_epoch.to_string(),
    );
    if prior.as_ref().is_some_and(|row| row != &expected) {
        return Err(StockPortFault::EvidenceConflict);
    }
    check_jobs_registry(db, registration)?;
    if prior.is_none() {
        db.execute(
            "INSERT INTO stock_activity_physical VALUES(?1,?2,?3,?4,?5,NULL)",
            params![
                binding.physical_database_id.to_string(),
                expected.0,
                expected.1,
                expected.2,
                expected.3
            ],
        )
        .map_err(unavailable)?;
    }
    Ok(())
}
fn check_jobs_registry(
    db: &Connection,
    registration: &StockActivityRegistration,
) -> PortResult<()> {
    let row: Option<(String,String,String)> = db.query_row("SELECT deployment_id,configuration_digest,owner_id FROM queue_physical WHERE physical_database_id=?1",[registration.physical_binding.physical_database_id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(unavailable)?;
    if row.is_some_and(|r| {
        r != (
            registration.physical_binding.deployment_id.to_string(),
            registration
                .physical_binding
                .configuration_digest
                .as_str()
                .into(),
            registration.owner_id.to_string(),
        )
    }) {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
}
pub(super) fn occupied(
    db: &Connection,
    registration: &StockActivityRegistration,
) -> PortResult<bool> {
    check_jobs_registry(db, registration)?;
    // No scope/epoch/liability conversion: conservative physical-database hold
    // while a distinct lane's effect/accounting qualification is unresolved.
    if crate::storage::queue::unresolved_physical_hold(
        db,
        &registration
            .physical_binding
            .physical_database_id
            .to_string(),
    )
    .map_err(evidence)?
    {
        return Ok(true);
    }
    db.query_row("SELECT EXISTS(SELECT 1 FROM queue_physical WHERE physical_database_id=?1 AND active_job_id IS NOT NULL) OR EXISTS(SELECT 1 FROM stock_activity_physical WHERE physical_database_id=?1 AND active_operation_id IS NOT NULL) OR EXISTS(SELECT 1 FROM stock_activity_operations WHERE physical_database_id=?1 AND (logical_hold=1 OR liability_hold=1))",[registration.physical_binding.physical_database_id.to_string()],|r|r.get(0)).map_err(unavailable)
}
pub(super) fn load(db: &Connection, id: Uuid) -> PortResult<Row> {
    let (json,permit,accepted,version,digest,physical): (String,Option<String>,bool,String,String,String) = db.query_row("SELECT operation_json,permit_json,body_accepted,activity_version,intent_digest,physical_database_id FROM stock_activity_operations WHERE operation_id=?1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(unavailable)?;
    let operation = codec::decode_operation(&json).map_err(evidence)?;
    let permit = permit
        .map(|json| codec::decode_permit(&json).map_err(evidence))
        .transpose()?;
    if operation.operation_id != id
        || operation.activity_version.to_string() != version
        || operation.command.request_digest.as_str() != digest
        || operation
            .captured_authority
            .physical_binding
            .physical_database_id
            .to_string()
            != physical
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    let keys:(String,String,String,String,bool,bool)=db.query_row("SELECT actor_id,workspace_id,home_id,idempotency_key,logical_hold,liability_hold FROM stock_activity_operations WHERE operation_id=?1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(unavailable)?;
    if keys
        != (
            operation.actor_id.to_string(),
            operation.command.context.workspace_id.to_string(),
            operation.command.context.home_id.to_string(),
            operation.command.idempotency_key.to_string(),
            operation.outcome.unknown_scope_fence_retained,
            liability_hold(&operation.outcome.storage_liability),
        )
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    // Validate every retained fact's private codec; current outcome is a summary.
    let rows = db.prepare("SELECT kind,facts_json,operation_json,activity_version FROM stock_activity_events WHERE operation_id=?1 ORDER BY sequence").map_err(unavailable)?.query_map([id.to_string()], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(unavailable)?.collect::<rusqlite::Result<Vec<_>>>().map_err(unavailable)?;
    let mut last = None;
    let mut admissions = 0;
    let mut approval = None;
    for (kind, facts, event_operation, version) in rows {
        match kind.as_str() {
            "admit" => {
                let (_, _, admission) = codec::decode_admission(&facts).map_err(evidence)?;
                admissions += 1;
                approval = admission.approval;
            }
            "dispatch" => {
                codec::decode_dispatch(&facts).map_err(evidence)?;
            }
            "observation" => {
                codec::decode_observation(&facts).map_err(evidence)?;
            }
            _ => {
                let value: serde_json::Value = serde_json::from_str(&facts).map_err(evidence)?;
                if crate::contracts::semantics::canonical_json(&value).map_err(evidence)? != facts {
                    return Err(StockPortFault::EvidenceConflict);
                }
            }
        }
        let event = codec::decode_operation(&event_operation).map_err(evidence)?;
        if event.activity_version.to_string() != version
            || !event.outcome.well_formed()
            || last.is_none() && (kind != "reserve" || event.activity_version != 1)
            || event.operation_id != id
            || last.as_ref().is_some_and(|p: &StoredOperation| {
                p.activity_version.checked_add(1) != Some(event.activity_version)
                    || p.command != event.command
                    || p.captured_authority != event.captured_authority
            })
        {
            return Err(StockPortFault::EvidenceConflict);
        }
        super::journal::check(last.as_ref(), &event, &kind, &facts, permit.as_ref())?;
        last = Some(event);
    }
    let approved:Option<(String,String)>=db.query_row("SELECT approval_receipt_id,evidence_digest FROM stock_activity_approvals WHERE operation_id=?1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(unavailable)?;
    if approved
        != approval.map(|a| {
            (
                a.receipt_id.to_string(),
                a.evidence_digest.as_str().to_owned(),
            )
        })
        || admissions > 1
        || (admissions == 1) != accepted
        || accepted != permit.is_some()
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    if last.as_ref() != Some(&operation) {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(Row {
        operation,
        permit,
        body_accepted: accepted,
    })
}
pub(super) fn append(
    db: &Connection,
    operation: &StoredOperation,
    kind: &str,
    facts: &str,
) -> PortResult<()> {
    let json = codec::encode_operation(operation).map_err(evidence)?;
    db.execute("INSERT INTO stock_activity_events(operation_id,kind,activity_version,facts_json,operation_json) VALUES(?1,?2,?3,?4,?5)",params![operation.operation_id.to_string(),kind,operation.activity_version.to_string(),facts,json]).map_err(unavailable)?;
    Ok(())
}
pub(super) fn update(
    db: &Connection,
    operation: &mut StoredOperation,
    permit: Option<&InvocationPermit>,
    accepted: bool,
    kind: &str,
    facts: &str,
) -> PortResult<()> {
    let prior = operation.activity_version;
    operation.activity_version = prior
        .checked_add(1)
        .ok_or(StockPortFault::EvidenceConflict)?;
    let liability_hold = liability_hold(&operation.outcome.storage_liability);
    let changed = db.execute("UPDATE stock_activity_operations SET activity_version=?1,operation_json=?2,permit_json=?3,body_accepted=?4,logical_hold=?5,liability_hold=?6 WHERE operation_id=?7 AND activity_version=?8",params![operation.activity_version.to_string(),codec::encode_operation(operation).map_err(evidence)?,permit.map(codec::encode_permit).transpose().map_err(evidence)?,accepted,operation.outcome.unknown_scope_fence_retained,liability_hold,operation.operation_id.to_string(),prior.to_string()]).map_err(unavailable)?;
    if changed != 1 {
        return Err(StockPortFault::VersionConflict);
    }
    append(db, operation, kind, facts)
}
pub(super) fn verify_permit(
    row: &Row,
    permit: &InvocationPermit,
    registration: &StockActivityRegistration,
) -> PortResult<()> {
    if row.permit.as_ref() != Some(permit)
        || !row.body_accepted
        || permit.operation_id != row.operation.operation_id
        || permit.actor_id != row.operation.actor_id
        || permit.physical_binding != registration.physical_binding
        || permit.owner_id != registration.owner_id
        || permit.dispatcher_epoch != registration.dispatcher_epoch
        || permit.source_epoch != registration.source_epoch
        || permit.qualification != registration.qualification
    {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
}
pub(super) fn release(
    db: &Connection,
    registration: &StockActivityRegistration,
    id: Uuid,
) -> PortResult<()> {
    let changed=db.execute("UPDATE stock_activity_physical SET active_operation_id=NULL WHERE physical_database_id=?1 AND active_operation_id=?2",params![registration.physical_binding.physical_database_id.to_string(),id.to_string()]).map_err(unavailable)?;
    if changed != 1 {
        return Err(StockPortFault::EvidenceConflict);
    }
    Ok(())
}

/// Profile-aware Jobs interlock. This does not mint a Jobs state/lease/permit.
pub(crate) fn jobs_hold(
    db: &Connection,
    profile: bool,
    physical: &str,
    deployment: &str,
    configuration: &str,
    owner: &str,
) -> super::super::Result<Option<crate::jobs::QueueWaitReason>> {
    if !profile {
        return Ok(None);
    }
    let row: Option<(String,String,String,Option<String>)> = db.query_row("SELECT deployment_id,configuration_digest,owner_id,active_operation_id FROM stock_activity_physical WHERE physical_database_id=?1",[physical],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let Some(row) = row else {
        return Ok(None);
    };
    if row.0 != deployment || row.1 != configuration || row.2 != owner {
        return Err(super::super::Error::new(
            "schema-incompatible",
            "Activity physical registry differs",
        ));
    }
    if row.3.is_some() {
        return Ok(Some(crate::jobs::QueueWaitReason::PhysicalActivityHeld));
    }
    let logical:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM stock_activity_operations WHERE physical_database_id=?1 AND (logical_hold=1 OR liability_hold=1))",[physical],|r|r.get(0))?;
    Ok(logical.then_some(crate::jobs::QueueWaitReason::LogicalOutcomeHeld))
}

fn liability_hold(liability: &StorageLiability) -> bool {
    !liability.accounting_complete
        || liability.reserved_bytes.is_some_and(|v| v > 0)
        || liability.known_bytes > 0
        || liability.unresolved_attempts > 0
        || !matches!(liability.byte_disposition, ByteDisposition::None)
}
