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
    let expected_links = commit.groups.iter().try_fold(0_usize, |total, group| {
        total
            .checked_add(group.native_entries.len())
            .ok_or_else(incompatible)
    })?;
    if commit.groups.is_empty()
        || commit.groups.len() > 100
        || expected_links == 0
        || expected_links > 100
    {
        return Err(incompatible());
    }
    let rows=db.prepare("SELECT ordinal,child_index,operation_id,idempotency_key,request_digest,original_json,entries_json FROM stock_groups WHERE root_operation_id=?1 ORDER BY ordinal LIMIT 101")?.query_map([id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
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
    let actual_keys=db.prepare("SELECT idempotency_key,group_ordinal FROM stock_keys WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND root_operation_id=?4 ORDER BY idempotency_key LIMIT 102")?.query_map(params![scope.workspace_id,scope.home_id,actor,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<i64>>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if actual_keys != expected_keys {
        return Err(incompatible());
    }
    let link_count: i64 = db.query_row(
        "SELECT COUNT(*) FROM (SELECT 1 FROM stock_audit_links WHERE root_operation_id=?1 LIMIT 101)",
        [id],
        |r| r.get(0),
    )?;
    if link_count != expected_links as i64 {
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
                || contract.canonical_json(&serde_json::from_str::<Value>(&receipt.body)?)?
                    != contract.canonical_json(&serde_json::to_value(result)?)?
                || contract.canonical_json(&serde_json::from_str::<Value>(&audit)?)?
                    != contract.canonical_json(&serde_json::to_value(&result.audit)?)?
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

const RETAINED_ROOT_JSON_BUDGET: i64 = 4 * 1024 * 1024;
const RETAINED_TOTAL_JSON_BUDGET: i64 = 16 * 1024 * 1024;
const RETAINED_ROW_LIMIT: i64 = 100;

fn retained_budget_unavailable() -> Error {
    Error::new(
        "upstream-unavailable",
        "Retained stock selection exceeds its read budget",
    )
}

/// Account for every retained stock JSON value before `load` decodes it.
/// Root and group lookups use their existing primary keys; linked native
/// values use the audit and receipt keys, so unrelated retained data is never
/// scanned as part of this check.
pub(crate) fn assert_retained_read_budget(
    db: &Connection,
    scope: &Scope,
    actor: &str,
    id: &str,
) -> Result<usize> {
    let (root_bytes, commit_bytes, original_bytes): (i64, i64, i64) = db
        .query_row(
            "SELECT length(CAST(commit_json AS BLOB))+length(CAST(original_json AS BLOB)),
                    length(CAST(commit_json AS BLOB)), length(CAST(original_json AS BLOB))
             FROM stock_operations
             WHERE operation_id=?1 AND workspace_id=?2 AND home_id=?3 AND actor_id=?4
               AND codec_version=1",
            params![id, scope.workspace_id, scope.home_id, actor],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(incompatible)?;
    if root_bytes < 0 || commit_bytes < 0 || original_bytes < 0 {
        return Err(incompatible());
    }
    if root_bytes > RETAINED_ROOT_JSON_BUDGET {
        return Err(retained_budget_unavailable());
    }
    let mut total_bytes = root_bytes;

    let mut groups = db.prepare(
        "SELECT length(CAST(original_json AS BLOB))+length(CAST(entries_json AS BLOB))
         FROM stock_groups WHERE root_operation_id=?1 ORDER BY ordinal LIMIT 101",
    )?;
    let mut group_rows = groups.query([id])?;
    let mut group_count = 0_i64;
    while let Some(row) = group_rows.next()? {
        group_count += 1;
        let bytes: i64 = row.get(0)?;
        if group_count > RETAINED_ROW_LIMIT {
            return Err(retained_budget_unavailable());
        }
        if bytes < 0 {
            return Err(incompatible());
        }
        total_bytes = total_bytes
            .checked_add(bytes)
            .ok_or_else(retained_budget_unavailable)?;
        if total_bytes > RETAINED_TOTAL_JSON_BUDGET {
            return Err(retained_budget_unavailable());
        }
    }
    if group_count == 0 {
        return Err(incompatible());
    }

    let mut links = db.prepare(
        "SELECT audit_id,workspace_id,home_id,actor_id,mutation_id,
                length(CAST(event_json AS BLOB))
         FROM stock_audit_links WHERE root_operation_id=?1
         ORDER BY group_ordinal,entry_ordinal LIMIT 101",
    )?;
    let mut link_rows = links.query([id])?;
    let mut link_count = 0_i64;
    while let Some(row) = link_rows.next()? {
        link_count += 1;
        if link_count > RETAINED_ROW_LIMIT {
            return Err(retained_budget_unavailable());
        }
        let audit_id: String = row.get(0)?;
        let workspace_id: String = row.get(1)?;
        let home_id: String = row.get(2)?;
        let link_actor: String = row.get(3)?;
        let mutation_id: String = row.get(4)?;
        let event_bytes: i64 = row.get(5)?;
        if workspace_id != scope.workspace_id
            || home_id != scope.home_id
            || link_actor != actor
            || event_bytes < 0
        {
            return Err(incompatible());
        }
        total_bytes = total_bytes
            .checked_add(event_bytes)
            .ok_or_else(retained_budget_unavailable)?;

        let audit_bytes: i64 = db
            .query_row(
                "SELECT length(CAST(body AS BLOB)) FROM audits
                 WHERE audit_id=?1 AND workspace_id=?2 AND home_id=?3",
                params![audit_id, scope.workspace_id, scope.home_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(incompatible)?;
        let receipt_bytes: i64 = db
            .query_row(
                "SELECT length(CAST(body AS BLOB)) FROM receipts
                 WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",
                params![scope.workspace_id, scope.home_id, actor, mutation_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(incompatible)?;
        if audit_bytes < 0 || receipt_bytes < 0 {
            return Err(incompatible());
        }
        total_bytes = total_bytes
            .checked_add(audit_bytes)
            .and_then(|total| total.checked_add(receipt_bytes))
            .ok_or_else(retained_budget_unavailable)?;
        if total_bytes > RETAINED_TOTAL_JSON_BUDGET {
            return Err(retained_budget_unavailable());
        }
    }
    if link_count == 0 {
        return Err(incompatible());
    }
    usize::try_from(total_bytes).map_err(|_| incompatible())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RetainedEventLink {
    pub sequence: i64,
    pub audit_id: String,
    pub root_operation_id: String,
    pub actor_id: String,
    pub group_ordinal: i64,
    pub entry_ordinal: i64,
}

/// Select one bounded page of retained stock audit links at a fixed global
/// watermark. The complete global audit range is budgeted before scope or link
/// predicates can narrow the page.
pub(crate) fn retained_event_links(
    db: &Connection,
    scope: &Scope,
    watermark: i64,
    after: i64,
    page_size: usize,
) -> Result<Vec<RetainedEventLink>> {
    if watermark < 0 || after < 0 || after > watermark || !(1..=100).contains(&page_size) {
        return Err(incompatible());
    }

    let mut preflight = db.prepare(
        "SELECT length(CAST(body AS BLOB)) FROM audits NOT INDEXED
         WHERE seq<=?1 ORDER BY seq LIMIT 4097",
    )?;
    let mut preflight_rows = preflight.query([watermark])?;
    let mut audit_count = 0_i64;
    let mut audit_bytes = 0_i64;
    while let Some(row) = preflight_rows.next()? {
        audit_count += 1;
        let bytes: i64 = row.get(0)?;
        if bytes < 0 {
            return Err(incompatible());
        }
        audit_bytes = audit_bytes
            .checked_add(bytes)
            .ok_or_else(retained_budget_unavailable)?;
        if audit_count > 4096 || audit_bytes > RETAINED_TOTAL_JSON_BUDGET {
            return Err(retained_budget_unavailable());
        }
    }

    let limit = i64::try_from(page_size + 1).map_err(|_| incompatible())?;
    let mut statement = db.prepare(
        "SELECT a.seq,l.audit_id,l.root_operation_id,l.actor_id,l.group_ordinal,l.entry_ordinal
         FROM audits AS a NOT INDEXED
         CROSS JOIN stock_audit_links AS l INDEXED BY sqlite_autoindex_stock_audit_links_1
           ON l.audit_id=a.audit_id
         WHERE a.seq>?1 AND a.seq<=?2
           AND a.workspace_id=?3 AND a.home_id=?4
           AND l.workspace_id=?3 AND l.home_id=?4
         ORDER BY a.seq LIMIT ?5",
    )?;
    let rows = statement
        .query_map(
            params![after, watermark, scope.workspace_id, scope.home_id, limit],
            |row| {
                Ok(RetainedEventLink {
                    sequence: row.get(0)?,
                    audit_id: row.get(1)?,
                    root_operation_id: row.get(2)?,
                    actor_id: row.get(3)?,
                    group_ordinal: row.get(4)?,
                    entry_ordinal: row.get(5)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
