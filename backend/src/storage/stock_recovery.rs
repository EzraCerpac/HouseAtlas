//! Exhaustive stock validation for a read-only recovery image.
//!
//! Call only after native schema/catalog, foreign keys, records and complete
//! native audit/receipt history have been validated on the same read snapshot.
//! Actual retained stock intent supplies digest inputs. No historical guard
//! satisfaction, grants, authority, response delivery or missing native intent
//! is inferred from the reconstructed schema carriers below.
use super::{numeric, repository as repo, stock_projection, stock_repository as stock_repo, *};
use crate::domain::stock::{
    Authority, Disposition, Effect, OutputKind, StockContractPort, ValidatedRequest,
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::collections::BTreeSet;

type ReceiptKey = (String, String, String, String);
type GroupKey = (String, i64);
type StockKey = (String, String, String, String, String, Option<i64>);
type LinkKey = (String, String, i64, i64);

fn incompatible() -> Error {
    Error::new("schema-incompatible", "Stock recovery data is incompatible")
}
fn require(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(incompatible())
    }
}
fn uuid<C: Contract>(native: &C, id: &str) -> Result<()> {
    native.validate_shape("recordRef", &json!({"recordType":"identity","recordId":id}))
}
fn receipt_key(result: &MutationResult) -> ReceiptKey {
    (
        result.audit.workspace_id.clone(),
        result.audit.home_id.clone(),
        result.audit.actor_id.clone(),
        result.audit.mutation_id.clone(),
    )
}
fn ordinal(value: usize) -> Result<i64> {
    i64::try_from(value).map_err(|_| incompatible())
}

fn validate_with_cursor<C: Contract, S: StockContractPort, E: QueueRecoveryEvidence>(
    db: &Connection,
    native: &C,
    stock: &S,
    evidence: &E,
    cursor_check: Option<&CursorCheck<'_>>,
    presence_history: Option<&PresenceHistoryCatalog>,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    check()?;
    // Native validation has already checked the canonical bodies, exact child
    // receipts, contiguous order and globally unique native batch membership.
    let mut batched = BTreeSet::new();
    let mut statement = db.prepare("SELECT body FROM batch_receipts ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let results: Vec<MutationResult> = serde_json::from_str(&row.get::<_, String>(0)?)?;
        require(!results.is_empty() && results.len() <= 100)?;
        for result in results {
            check()?;
            require(!result.replayed && batched.insert(receipt_key(&result)))?;
        }
    }
    drop(rows);
    drop(statement);

    let mut root_ids = BTreeSet::new();
    let mut statement = db.prepare("SELECT operation_id FROM stock_operations ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let id: String = row.get(0)?;
        uuid(native, &id)?;
        require(root_ids.insert(id))?;
    }
    drop(rows);
    drop(statement);

    let mut child_ids = BTreeSet::new();
    let mut groups = BTreeSet::new();
    let mut keys = BTreeSet::new();
    let mut links = BTreeSet::new();
    let mut batches = BTreeSet::new();
    let mut statement = db.prepare("SELECT operation_id,workspace_id,home_id,actor_id,idempotency_key,codec_version FROM stock_operations ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let id: String = row.get(0)?;
        let scope = Scope {
            workspace_id: row.get(1)?,
            home_id: row.get(2)?,
        };
        let actor: String = row.get(3)?;
        let key: String = row.get(4)?;
        require(row.get::<_, i64>(5)? == 1)?;
        native.validate_shape("scope", &serde_json::to_value(&scope)?)?;
        uuid(native, &actor)?;
        let commit = stock_repo::load(db, native, &scope, &actor, &id)?;
        check()?;
        let (_, plan) =
            match presence_history.and_then(|catalog| catalog.accepted_frame_for_commit(&commit)) {
                Some(frame) => stock_projection::validate_retained_with_accepted_presence(
                    db, &commit, stock, native, frame,
                )?,
                None => {
                    stock_projection::validate_retained(db, &commit, stock, native)?;
                    stock_projection::retained_plan(db, &commit, stock, native)?
                }
            };
        check()?;
        require(plan.scope() == &scope && plan.root_idempotency_key() == key)?;
        require(keys.insert((
            scope.workspace_id.clone(),
            scope.home_id.clone(),
            actor.clone(),
            key.clone(),
            id.clone(),
            None,
        )))?;
        let batch_id = plan.batch_target_id();
        for (group_index, group) in commit.groups.iter().enumerate() {
            check()?;
            let group_index = ordinal(group_index)?;
            require(groups.insert((id.clone(), group_index)))?;
            uuid(native, &group.operation_id)?;
            if group.child_index.is_some() {
                require(
                    !root_ids.contains(&group.operation_id)
                        && child_ids.insert(group.operation_id.clone()),
                )?;
                let child_key = group.original_request["idempotencyKey"]
                    .as_str()
                    .ok_or_else(incompatible)?;
                require(keys.insert((
                    scope.workspace_id.clone(),
                    scope.home_id.clone(),
                    actor.clone(),
                    child_key.to_owned(),
                    id.clone(),
                    Some(group_index),
                )))?;
            } else {
                require(group.operation_id == id)?;
            }
            for (entry_index, result) in group.native_results.iter().enumerate() {
                check()?;
                let owned = receipt_key(result);
                require(if batch_id.is_some() {
                    batched.contains(&owned)
                } else {
                    !batched.contains(&owned)
                })?;
                require(links.insert((
                    result.audit.audit_id.clone(),
                    id.clone(),
                    group_index,
                    ordinal(entry_index)?,
                )))?;
            }
        }
        if let Some(batch_id) = batch_id {
            require(batches.insert((
                scope.workspace_id.clone(),
                scope.home_id.clone(),
                actor.clone(),
                batch_id.to_owned(),
            )))?;
            // A batch root key has no command receipt. Equality with this
            // operation's native batch ID is allowed; they are distinct roles.
            require(
                repo::receipt(db, repo::ReceiptKind::Command, &scope, &actor, &key)?.is_none(),
            )?;
            let batch = BatchMutation {
                schema_version: 1,
                batch_id: batch_id.to_owned(),
                reason: commit.original_request["reason"]
                    .as_str()
                    .ok_or_else(incompatible)?
                    .to_owned(),
                commands: commit
                    .groups
                    .iter()
                    .flat_map(|group| group.native_entries.clone())
                    .collect(),
            };
            let mut value = serde_json::to_value(&batch)?;
            native.validate_shape("batchMutation", &value)?;
            value["scope"] = serde_json::to_value(&scope)?;
            let expected_hash = repo::digest(native, &value)?;
            let receipt = repo::receipt(db, repo::ReceiptKind::Batch, &scope, &actor, batch_id)?
                .ok_or_else(incompatible)?;
            let results = commit
                .groups
                .iter()
                .flat_map(|group| group.native_results.clone())
                .collect::<Vec<_>>();
            require(
                receipt.hash == expected_hash
                    && native.canonical_json(&serde_json::from_str::<Value>(&receipt.body)?)?
                        == native.canonical_json(&serde_json::to_value(&results)?)?,
            )?;
        }
        check()?;
    }
    drop(rows);
    drop(statement);
    validate_owned_rows(db, groups, keys, links, check)?;
    super::upload_repository::validate_all(db, native, stock, evidence, check)?;
    validate_lookup(db, check)?;
    validate_cursors(db, native, stock, cursor_check, check)?;
    check()
}

fn validate_owned_rows(
    db: &Connection,
    mut groups: BTreeSet<GroupKey>,
    mut keys: BTreeSet<StockKey>,
    mut links: BTreeSet<LinkKey>,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    // Exact set removal plus count equality establishes all-row closure, even
    // for rows not exposed by a history page or a scoped per-root lookup.
    let expected = groups.len();
    let mut count = 0_usize;
    let mut statement =
        db.prepare("SELECT root_operation_id,ordinal FROM stock_groups ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        require(groups.remove(&(row.get(0)?, row.get(1)?)))?;
        count = count.checked_add(1).ok_or_else(incompatible)?;
    }
    require(groups.is_empty() && count == expected)?;
    drop(rows);
    drop(statement);

    let expected = keys.len();
    let mut count = 0_usize;
    let mut statement = db.prepare("SELECT workspace_id,home_id,actor_id,idempotency_key,root_operation_id,group_ordinal FROM stock_keys ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        require(keys.remove(&(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        )))?;
        count = count.checked_add(1).ok_or_else(incompatible)?;
    }
    require(keys.is_empty() && count == expected)?;
    drop(rows);
    drop(statement);

    let expected = links.len();
    let mut count = 0_usize;
    let mut statement = db.prepare("SELECT audit_id,root_operation_id,group_ordinal,entry_ordinal FROM stock_audit_links ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        require(links.remove(&(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?;
        count = count.checked_add(1).ok_or_else(incompatible)?;
    }
    require(links.is_empty() && count == expected)
}

fn validate_lookup(db: &Connection, check: &mut dyn FnMut() -> Result<()>) -> Result<()> {
    // Streaming equivalent of bidirectional EXCEPT against migration 4's
    // exact relation. NULL commands retain native-only prehistory faithfully.
    let mut expected = 0_usize;
    let mut statement = db.prepare("SELECT a.seq,a.workspace_id,a.home_id,a.record_id,a.audit_id,l.command_id,h.seq,h.workspace_id,h.home_id,h.record_id,h.audit_id,h.command_id FROM audits a LEFT JOIN stock_audit_links l ON l.audit_id=a.audit_id AND l.workspace_id=a.workspace_id AND l.home_id=a.home_id AND l.actor_id=json_extract(a.body,'$.actorId') AND l.mutation_id=json_extract(a.body,'$.mutationId') LEFT JOIN stock_history_lookup h ON h.seq=a.seq ORDER BY a.seq")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        require(
            row.get::<_, Option<i64>>(6)? == Some(row.get(0)?)
                && row.get::<_, Option<String>>(7)? == Some(row.get(1)?)
                && row.get::<_, Option<String>>(8)? == Some(row.get(2)?)
                && row.get::<_, Option<String>>(9)? == Some(row.get(3)?)
                && row.get::<_, Option<String>>(10)? == Some(row.get(4)?)
                && row.get::<_, Option<String>>(11)? == row.get::<_, Option<String>>(5)?,
        )?;
        expected = expected.checked_add(1).ok_or_else(incompatible)?;
    }
    drop(rows);
    drop(statement);
    let mut count = 0_usize;
    let mut statement = db.prepare("SELECT seq FROM stock_history_lookup ORDER BY seq")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let _: i64 = row.get(0)?;
        count = count.checked_add(1).ok_or_else(incompatible)?;
    }
    require(count == expected)
}

fn validate_cursors<C: Contract, S: StockContractPort>(
    db: &Connection,
    native: &C,
    stock: &S,
    cursor_check: Option<&CursorCheck<'_>>,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let max_seq: i64 = db.query_row("SELECT COALESCE(MAX(seq),0) FROM audits", [], |row| {
        row.get(0)
    })?;
    let mut statement = db.prepare("SELECT cursor_id,workspace_id,home_id,actor_id,query_json,watermark,after_seq,codec_version FROM stock_history_cursors ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let id: String = row.get(0)?;
        let scope = Scope {
            workspace_id: row.get(1)?,
            home_id: row.get(2)?,
        };
        let actor: String = row.get(3)?;
        let body: String = row.get(4)?;
        let watermark: i64 = row.get(5)?;
        let after: i64 = row.get(6)?;
        let parsed: Value = serde_json::from_str(&body)?;
        if parsed["format"] == stock_activity::history_repository::HOMEBOX_HISTORY_CURSOR_FORMAT {
            cursor_check.ok_or_else(incompatible)?(
                stock_activity::history_repository::RetainedHistoryCursor {
                    id: &id,
                    scope: &scope,
                    actor: &actor,
                    query_json: &body,
                    watermark,
                    after_sequence: after,
                    codec_version: row.get(7)?,
                },
                check,
            )?;
            continue;
        }
        require(
            row.get::<_, i64>(7)? == 1 && 0 < after && after < watermark && watermark <= max_seq,
        )?;
        native.validate_shape("scope", &serde_json::to_value(&scope)?)?;
        uuid(native, &id)?;
        uuid(native, &actor)?;
        let query: Value = serde_json::from_str(&body)?;
        require(native.canonical_json(&query)? == body)?;
        let mut payload = query["payload"]
            .as_object()
            .ok_or_else(incompatible)?
            .clone();
        require(!payload.contains_key("cursor"))?;
        payload.insert("cursor".into(), Value::Null);
        // ID and NULL cursor are schema-only carrier fields, not a recovered
        // original request, historical principal, predecessor or grant.
        let original = ValidatedRequest::parse(
            stock,
            json!({
                "schemaVersion":3,"commandId":query["commandId"],"context":scope,
                "requestId":id,"target":query["target"],"payload":payload
            }),
        )
        .map_err(|_| incompatible())?;
        let operation = original.operation();
        require(
            operation.authority == Authority::Atlas
                && operation.effect == Effect::Read
                && operation.disposition == Disposition::AtlasOwned
                && operation.output_kind == OutputKind::History
                && original.target()["authority"] == "atlas",
        )?;
        let mut stripped = original.payload().clone();
        stripped
            .as_object_mut()
            .ok_or_else(incompatible)?
            .remove("cursor");
        require(native.canonical_json(&json!({"commandId":original.id().as_str(),"target":original.target(),"payload":stripped}))? == body)?;
        let target: RecordRef = serde_json::from_value(
            json!({"recordType":original.target()["recordType"],"recordId":original.target()["recordId"]}),
        )?;
        native.validate_shape("recordRef", &serde_json::to_value(&target)?)?;
        repo::read_record(db, &scope, &target).map_err(|_| incompatible())?;
        let page_size = numeric::safe_integer(&original.payload()["pageSize"])
            .filter(|size| (1..=100).contains(size))
            .ok_or_else(incompatible)?;
        let q = original.payload().get("q").and_then(Value::as_str);
        let mut prefix_rank = 0_u64;
        let mut after_matches = false;
        let mut remaining = false;
        let mut history = db.prepare("SELECT seq,command_id FROM stock_history_lookup WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND seq<=?4 ORDER BY seq")?;
        let mut audits = history.query(params![
            scope.workspace_id,
            scope.home_id,
            target.record_id,
            watermark
        ])?;
        while let Some(audit) = audits.next()? {
            check()?;
            let seq: i64 = audit.get(0)?;
            let command = audit
                .get::<_, Option<String>>(1)?
                .ok_or_else(incompatible)?;
            let matches = q.is_none_or(|q| command.contains(q) || "committed".contains(q));
            if matches && seq <= after {
                prefix_rank = prefix_rank.checked_add(1).ok_or_else(incompatible)?;
                if seq == after {
                    after_matches = true;
                }
            } else if matches {
                remaining = true;
            }
        }
        require(
            after_matches && prefix_rank > 0 && prefix_rank.is_multiple_of(page_size) && remaining,
        )?;
        // Reader actor is a UUID-bound cursor field, not the mutation author.
        // Both includeArchived values preserve historical tombstones.
        check()?;
    }
    Ok(())
}

type CursorCheck<'a> = dyn Fn(
        stock_activity::history_repository::RetainedHistoryCursor<'_>,
        &mut dyn FnMut() -> Result<()>,
    ) -> Result<()>
    + 'a;
pub(super) fn validate<C: Contract, S: StockContractPort, E: QueueRecoveryEvidence>(
    db: &Connection,
    native: &C,
    stock: &S,
    evidence: &E,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    validate_with_cursor(db, native, stock, evidence, None, None, check)
}
pub(super) fn validate_with_activity<
    C: Contract,
    S: StockContractPort,
    E: QueueRecoveryEvidence,
    N: crate::providers::homebox::write::stock::StockContractPort,
>(
    db: &Connection,
    native: &C,
    stock: &S,
    evidence: &E,
    activity: &N,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let cursor_check = |cursor: stock_activity::history_repository::RetainedHistoryCursor<'_>,
                        check: &mut dyn FnMut() -> Result<()>| {
        stock_activity::history_repository::validate_cursor(
            db, native, stock, activity, cursor, check,
        )
    };
    validate_with_cursor(
        db,
        native,
        stock,
        evidence,
        Some(&cursor_check),
        None,
        check,
    )
}

/// Explicit Presence reopen supplies only the opaque accepted history catalog.
/// Every saved Present commit must match one exact catalog frame; unmatched
/// commits still pass the ordinary strict retained validator.
pub(super) fn validate_with_activity_and_presence<
    C: Contract,
    S: StockContractPort,
    E: QueueRecoveryEvidence,
    N: crate::providers::homebox::write::stock::StockContractPort,
>(
    db: &Connection,
    native: &C,
    stock: &S,
    evidence: &E,
    activity: &N,
    history: &PresenceHistoryCatalog,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let cursor_check = |cursor: stock_activity::history_repository::RetainedHistoryCursor<'_>,
                        check: &mut dyn FnMut() -> Result<()>| {
        stock_activity::history_repository::validate_cursor(
            db, native, stock, activity, cursor, check,
        )
    };
    validate_with_cursor(
        db,
        native,
        stock,
        evidence,
        Some(&cursor_check),
        Some(history),
        check,
    )
}
