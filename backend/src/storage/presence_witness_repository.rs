//! Fixed append-only witness SQL, called only by the private active-Store hook.
//! Schema proposal is NOT a migration installer and is never executed here.
use super::{repository as repo, *};
use crate::contracts::stock as wire;
use rusqlite::{Transaction, params};

fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Atomic presence witness linkage is incompatible",
    )
}

pub(crate) fn check_final_rows<C: Contract>(
    tx: &Transaction<'_>,
    contract: &C,
    result: &MutationResult,
    command_hash: &str,
) -> Result<()> {
    if tx.is_autocommit() || result.replayed {
        return Err(incompatible());
    }
    let record = repo::read_record(tx, &result.record.scope(), &result.record.reference())?;
    let audit_body:String=tx.query_row("SELECT body FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND audit_id=?4",
        params![result.record.workspace_id,result.record.home_id,result.record.record_id,result.audit.audit_id],|row|row.get(0))?;
    let audit: Audit = serde_json::from_str(&audit_body)?;
    let receipt = repo::receipt(
        tx,
        repo::ReceiptKind::Command,
        &result.record.scope(),
        &result.audit.actor_id,
        &result.audit.mutation_id,
    )?
    .ok_or_else(incompatible)?;
    if record != result.record
        || audit != result.audit
        || audit_body != repo::json(contract, &result.audit)?
        || receipt.hash != command_hash
        || !repo::retained_json_matches(contract, result, &receipt.body)?
    {
        return Err(incompatible());
    }
    Ok(())
}

/// The engine retains the original ordered batch digest and writes this row
/// before precommit. Check the exact row without reconstructing its intent.
pub(crate) fn check_batch_receipt<C: Contract>(
    tx: &Transaction<'_>,
    contract: &C,
    scope: &Scope,
    actor_id: &str,
    batch: &BatchMutation,
    original_hash: &str,
    results: &[MutationResult],
) -> Result<()> {
    if tx.is_autocommit() {
        return Err(incompatible());
    }
    let receipt = repo::receipt(
        tx,
        repo::ReceiptKind::Batch,
        scope,
        actor_id,
        &batch.batch_id,
    )?
    .ok_or_else(incompatible)?;
    if receipt.hash != original_hash
        || !repo::retained_json_matches(contract, &results, &receipt.body)?
    {
        return Err(incompatible());
    }
    Ok(())
}

pub(crate) fn append<C: Contract>(
    tx: &Transaction<'_>,
    contract: &C,
    stamped: &[wire::PresenceWitness],
) -> Result<()> {
    if tx.is_autocommit() {
        return Err(incompatible());
    }
    for witness in stamped {
        wire::validate_presence_witness(witness).map_err(|_| incompatible())?;
        let revision = numeric::safe_integer(&serde_json::to_value(&witness.binding_revision)?)
            .filter(|revision| *revision > 0)
            .ok_or_else(incompatible)?;
        let body = repo::json(contract, witness)?;
        tx.execute("INSERT INTO presence_witnesses(workspace_id,home_id,binding_record_id,binding_revision,audit_id,actor_id,mutation_id,body) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![witness.workspace_id,witness.home_id,witness.binding_record_id,i64::try_from(revision).map_err(|_|incompatible())?,witness.audit_id,witness.actor_id,witness.mutation_id,body])?;
    }
    Ok(())
}
