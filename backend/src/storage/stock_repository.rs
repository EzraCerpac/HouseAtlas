//! Fixed private SQL for immutable stock ownership and audit correlation.
use super::{repository as repo, repository::ReceiptKind, *};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

pub(crate) fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Stored stock receipt is incompatible",
    )
}
pub(crate) fn conflict() -> Error {
    Error::new(
        "idempotency-conflict",
        "Stock key belongs to another intent or operation group",
    )
}
pub(crate) fn assert_core_keys_free(
    db: &Connection,
    scope: &Scope,
    actor: &str,
    entries: &[MutationEntry],
    batch: Option<&BatchMutation>,
) -> Result<()> {
    for id in entries
        .iter()
        .map(|e| e.command.mutation_id.as_str())
        .chain(batch.map(|b| b.batch_id.as_str()))
    {
        if key(db, scope, actor, id)?.is_some() {
            return Err(conflict());
        }
    }
    Ok(())
}
pub(crate) fn key(
    db: &Connection,
    scope: &Scope,
    actor: &str,
    key: &str,
) -> Result<Option<(String, Option<i64>)>> {
    Ok(db.query_row("SELECT root_operation_id,group_ordinal FROM stock_keys WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND idempotency_key=?4",params![scope.workspace_id,scope.home_id,actor,key],|r|Ok((r.get(0)?,r.get(1)?))).optional()?)
}
pub(crate) fn load<C: Contract>(
    db: &Connection,
    contract: &C,
    scope: &Scope,
    actor: &str,
    id: &str,
) -> Result<StockAtlasCommit> {
    let (body,original,digest,key):(String,String,String,String)=db.query_row("SELECT commit_json,original_json,request_digest,idempotency_key FROM stock_operations WHERE operation_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4",params![id,scope.workspace_id,scope.home_id,actor],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let commit: StockAtlasCommit = serde_json::from_str(&body)?;
    if commit.operation_id != id
        || commit.actor_id != actor
        || commit.replayed
        || commit.request_digest != digest
        || commit.original_request != serde_json::from_str::<Value>(&original)?
        || commit.original_request["idempotencyKey"] != key
    {
        return Err(incompatible());
    }
    let rows=db.prepare("SELECT ordinal,child_index,operation_id,idempotency_key,request_digest,original_json,entries_json FROM stock_groups WHERE root_operation_id=?1 ORDER BY ordinal")?.query_map([id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() != commit.groups.len() || rows.is_empty() {
        return Err(incompatible());
    }
    let mut expected_keys = vec![(key, None)];
    for (ordinal, group) in commit.groups.iter().enumerate() {
        if group.child_index.is_some() {
            expected_keys.push((
                group.original_request["idempotencyKey"]
                    .as_str()
                    .ok_or_else(incompatible)?
                    .to_owned(),
                Some(ordinal as i64),
            ));
        }
    }
    expected_keys.sort();
    let actual_keys=db.prepare("SELECT idempotency_key,group_ordinal FROM stock_keys WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND root_operation_id=?4 ORDER BY idempotency_key")?.query_map(params![scope.workspace_id,scope.home_id,actor,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<i64>>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if actual_keys != expected_keys {
        return Err(incompatible());
    }
    let batch_id = commit.original_request["target"]["batchId"].as_str();
    let batch_hash = if let Some(batch_id) = batch_id {
        let batch = BatchMutation {
            schema_version: 1,
            batch_id: batch_id.into(),
            reason: commit.original_request["reason"]
                .as_str()
                .ok_or_else(incompatible)?
                .into(),
            commands: commit
                .groups
                .iter()
                .flat_map(|g| g.native_entries.clone())
                .collect(),
        };
        let mut value = serde_json::to_value(batch)?;
        value["scope"] = serde_json::to_value(scope)?;
        Some(repo::digest(contract, &value)?)
    } else {
        None
    };
    for (ordinal, (row, group)) in rows.iter().zip(&commit.groups).enumerate() {
        if row.0 != ordinal as i64
            || row.1 != group.child_index.map(|i| i as i64)
            || row.2 != group.operation_id
            || group.original_request["idempotencyKey"] != row.3
            || row.4 != group.request_digest
            || serde_json::from_str::<Value>(&row.5)? != group.original_request
            || serde_json::from_str::<Vec<MutationEntry>>(&row.6)? != group.native_entries
            || group.native_results.len() != group.native_entries.len()
        {
            return Err(incompatible());
        }
        for (entry_ordinal, (entry, result)) in group
            .native_entries
            .iter()
            .zip(&group.native_results)
            .enumerate()
        {
            let (hash,command_id,digest,state,event):(String,String,String,String,String)=db.query_row("SELECT payload_hash,command_id,request_digest,state,event_json FROM stock_audit_links WHERE audit_id=?1 AND root_operation_id=?2 AND group_ordinal=?3 AND entry_ordinal=?4 AND workspace_id=?5 AND home_id=?6 AND actor_id=?7 AND mutation_id=?8",params![result.audit.audit_id,id,ordinal as i64,entry_ordinal as i64,scope.workspace_id,scope.home_id,actor,entry.command.mutation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
            let receipt = repo::receipt(
                db,
                ReceiptKind::Command,
                scope,
                actor,
                &entry.command.mutation_id,
            )?
            .ok_or_else(incompatible)?;
            let expected_hash = repo::digest(
                contract,
                &json!({"target":ScopedTarget::new(scope,&entry.target),"command":entry.command,"batchId":batch_id,"batchHash":batch_hash}),
            )?;
            let audit: String = db.query_row(
                "SELECT body FROM audits WHERE audit_id=?1",
                [&result.audit.audit_id],
                |r| r.get(0),
            )?;
            if receipt.hash != hash
                || hash != expected_hash
                || serde_json::from_str::<MutationResult>(&receipt.body)? != *result
                || serde_json::from_str::<Audit>(&audit)? != result.audit
                || group.original_request["commandId"] != command_id
                || group.request_digest != digest
                || state != "committed"
                || serde_json::from_str::<Value>(&event)? != event_wire(group, &result.audit)
            {
                return Err(incompatible());
            }
        }
    }
    Ok(commit)
}
pub(crate) fn event_wire(group: &StockCommitGroup, audit: &Audit) -> Value {
    json!({"eventId":audit.audit_id,"commandId":group.original_request["commandId"],"at":audit.at,"actorId":audit.actor_id,
      "requestDigest":group.request_digest,"state":"committed","target":{"authority":"atlas","recordType":audit.record.record_type,"recordId":audit.record.record_id},
      "beforeDigest":audit.before_digest,"afterDigest":audit.after_digest})
}
pub(crate) fn persist(
    db: &Connection,
    scope: &Scope,
    commit: &StockAtlasCommit,
    hashes: &[String],
) -> Result<()> {
    if commit.replayed {
        return Err(incompatible());
    }
    db.execute(
        "INSERT INTO stock_operations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1)",
        params![
            commit.operation_id,
            scope.workspace_id,
            scope.home_id,
            commit.actor_id,
            commit.original_request["idempotencyKey"]
                .as_str()
                .ok_or_else(incompatible)?,
            commit.request_digest,
            serde_json::to_string(&commit.original_request)?,
            serde_json::to_string(commit)?
        ],
    )?;
    for (ordinal, group) in commit.groups.iter().enumerate() {
        db.execute(
            "INSERT INTO stock_groups VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                commit.operation_id,
                ordinal as i64,
                group.child_index.map(|i| i as i64),
                group.operation_id,
                group.original_request["idempotencyKey"]
                    .as_str()
                    .ok_or_else(incompatible)?,
                group.request_digest,
                serde_json::to_string(&group.original_request)?,
                serde_json::to_string(&group.native_entries)?
            ],
        )?;
    }
    db.execute(
        "INSERT INTO stock_keys VALUES(?1,?2,?3,?4,?5,NULL)",
        params![
            scope.workspace_id,
            scope.home_id,
            commit.actor_id,
            commit.original_request["idempotencyKey"]
                .as_str()
                .ok_or_else(incompatible)?,
            commit.operation_id
        ],
    )?;
    let mut offset = 0;
    for (ordinal, group) in commit.groups.iter().enumerate() {
        if group.child_index.is_some() {
            db.execute(
                "INSERT INTO stock_keys VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    scope.workspace_id,
                    scope.home_id,
                    commit.actor_id,
                    group.original_request["idempotencyKey"]
                        .as_str()
                        .ok_or_else(incompatible)?,
                    commit.operation_id,
                    ordinal as i64
                ],
            )?;
        }
        for (entry_ordinal, (entry, result)) in group
            .native_entries
            .iter()
            .zip(&group.native_results)
            .enumerate()
        {
            let hash = hashes.get(offset).ok_or_else(incompatible)?;
            offset += 1;
            db.execute("INSERT INTO stock_audit_links VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'committed',?12)",params![result.audit.audit_id,commit.operation_id,ordinal as i64,entry_ordinal as i64,scope.workspace_id,scope.home_id,commit.actor_id,entry.command.mutation_id,hash,group.original_request["commandId"].as_str().ok_or_else(incompatible)?,group.request_digest,serde_json::to_string(&event_wire(group,&result.audit))?])?;
        }
    }
    if offset != hashes.len() {
        return Err(incompatible());
    }
    Ok(())
}
