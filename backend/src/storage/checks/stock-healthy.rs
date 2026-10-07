//! Fresh successful stock commands/history only; no replay or held controls.
#[path = "stock-support.rs"]
mod support;
use houseatlas_at07_checkpoint::{
    domain::stock::{self, StockContractPort},
    storage::*,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{cell::Cell, fs, path::PathBuf, rc::Rc};
use support::*;

fn guard(kind: RecordType, record: u64) -> Value {
    json!({"target":{"authority":"atlas","recordType":kind,"recordId":id(record)},
        "revision":{"kind":"atlas","value":1}})
}
fn circuit_create(record: u64, key: u64, request: u64, payload: &Value, reason: &str) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.circuit.create","requestId":id(request),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"circuit","recordId":id(record)},
        "payload":payload,"idempotencyKey":id(key),"reason":reason,
        "preconditions":{"target":null,"guards":[guard(RecordType::Evidence,100)]},"approvalReceiptId":null})
}
fn history_request(request: u64, cursor: Value, page_size: u64) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.circuit.history","requestId":id(request),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"circuit","recordId":id(406)},
        "payload":{"cursor":cursor,"pageSize":page_size,"includeArchived":false}})
}
fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let stock_root = PathBuf::from(std::env::var("HOUSEATLAS_STOCK_ROOT")?);
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh evidence directory required")?,
    );
    fs::create_dir(&output)?;
    let path = output.join("stock-healthy.sqlite");
    let schemas = OfflineStockSchemas::load(&stock_root)?;
    let semantics = PureRustSemantics::default();
    let authorization = SyntheticAuthorization::default();
    let runtime = SyntheticRuntime {
        next: Rc::new(Cell::new(90_000)),
    };
    let principal = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let initial: Snapshot = load(&root, "packages/contracts/fixtures/plan-free.snapshot.json")?;
    let native_create: Value = load(
        &root,
        "packages/contracts/fixtures/create-circuit.mutation.json",
    )?;
    let native_result: Value = load(
        &root,
        "packages/contracts/fixtures/create-circuit.result.json",
    )?;
    assert_eq!(native_result["record"]["recordId"], id(406));
    let mut store = AtlasStore::open(
        &path,
        semantics.storage_contract(),
        authorization.clone(),
        runtime.clone(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&initial)?;
    let create = circuit_create(
        406,
        1_000,
        95_001,
        &native_create["value"]["payload"],
        native_create["reason"]
            .as_str()
            .ok_or("Fixture reason required")?,
    );
    let accepted = stock::ValidatedRequest::parse(&schemas, create.clone())?;
    let created = store.execute_stock_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &create,
    )?;
    assert_eq!(created.original_request, create);
    assert_eq!(created.request_digest, accepted.intent_digest());
    assert!(!created.replayed);
    assert_eq!(created.groups.len(), 1);
    assert_eq!(created.groups[0].child_index, None);
    assert_eq!(created.groups[0].operation_id, created.operation_id);
    assert_eq!(created.wire["data"]["records"][0]["revision"], 1);
    assert!(created.children.is_empty());
    let mut replace = create.clone();
    replace["commandId"] = json!("atlas.circuit.replace");
    replace["requestId"] = json!(id(95_002));
    replace["idempotencyKey"] = json!(id(1_001));
    replace["reason"] = json!("Synthetic reviewed circuit label");
    replace["payload"]["label"] = json!("Synthetic circuit");
    replace["preconditions"]["target"] = json!({"kind":"atlas","value":1});
    let replaced = store.execute_stock_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &replace,
    )?;
    assert!(!replaced.replayed);
    assert_eq!(replaced.wire["data"]["records"][0]["revision"], 2);
    assert_eq!(
        replaced.wire["data"]["records"][0]["payload"]["label"],
        "Synthetic circuit"
    );
    let mut first_request = history_request(95_003, Value::Null, 1);
    first_request["payload"]["pageSize"] = serde_json::from_str("1.0")?;
    let first = store.stock_history_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &first_request,
    )?;
    assert_eq!(
        first.wire["data"]["entries"]
            .as_array()
            .ok_or("First entries required")?
            .len(),
        1
    );
    assert_eq!(
        first.wire["data"]["entries"][0]["commandId"],
        "atlas.circuit.create"
    );
    assert_eq!(
        first.wire["data"]["entries"][0]["requestDigest"],
        created.request_digest
    );
    let cursor = first.wire["data"]["nextCursor"]
        .as_str()
        .ok_or("Continuation required")?
        .to_owned();
    let mut second_request = history_request(95_004, json!(cursor), 1);
    second_request["payload"]["pageSize"] = serde_json::from_str("1e0")?;
    let second = store.stock_history_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &second_request,
    )?;
    assert_eq!(
        second.wire["data"]["entries"]
            .as_array()
            .ok_or("Second entries required")?
            .len(),
        1
    );
    assert_eq!(
        second.wire["data"]["entries"][0]["commandId"],
        "atlas.circuit.replace"
    );
    assert_eq!(
        second.wire["data"]["entries"][0]["requestDigest"],
        replaced.request_digest
    );
    assert_eq!(second.wire["data"]["nextCursor"], Value::Null);
    let mut searched_request = history_request(95_005, Value::Null, 10);
    searched_request["payload"]["q"] = json!("atlas.circuit.replace");
    let searched = store.stock_history_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &searched_request,
    )?;
    assert_eq!(
        searched.wire["data"]["entries"],
        second.wire["data"]["entries"]
    );
    assert_eq!(searched.wire["data"]["nextCursor"], Value::Null);
    let children = vec![
        circuit_create(
            407,
            1_052,
            95_006,
            &native_create["value"]["payload"],
            "Synthetic first batch circuit",
        ),
        circuit_create(
            408,
            1_053,
            95_007,
            &native_create["value"]["payload"],
            "Synthetic second batch circuit",
        ),
    ];
    let batch = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(95_008),
        "context":{"workspaceId":id(1),"homeId":id(2)},"target":{"authority":"atlas","kind":"batch","batchId":id(1_051)},
        "idempotencyKey":id(1_050),"reason":"Synthetic ordered circuit batch","approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[guard(RecordType::Identity,201)]},"payload":{"commands":children}});
    let batched = store.execute_stock_json_with_authorization(
        &authorization,
        &principal,
        &schemas,
        &batch,
    )?;
    assert!(!batched.replayed);
    assert_eq!(batched.original_request, batch);
    assert_eq!(batched.groups.len(), 2);
    assert_eq!(batched.children.len(), 2);
    let mut public_records = Vec::new();
    let mut public_audits = Vec::new();
    for (index, group) in batched.groups.iter().enumerate() {
        assert_eq!(group.child_index, Some(index));
        assert_eq!(group.original_request, batch["payload"]["commands"][index]);
        assert_eq!(group.native_entries[0].command.guards.len(), 1);
        assert_eq!(
            group.native_entries[0].command.guards[0].record,
            reference(RecordType::Evidence, 100)
        );
        assert_eq!(batched.children[index]["operationId"], group.operation_id);
        public_records.extend(
            batched.children[index]["data"]["records"]
                .as_array()
                .ok_or("Child records required")?
                .clone(),
        );
        public_audits.extend(
            batched.children[index]["data"]["auditIds"]
                .as_array()
                .ok_or("Child audits required")?
                .clone(),
        );
    }
    assert_eq!(batched.wire["data"]["records"], json!(public_records));
    assert_eq!(batched.wire["data"]["auditIds"], json!(public_audits));
    assert_eq!(
        batched.wire["data"]["records"][0]["target"]["recordId"],
        id(407)
    );
    assert_eq!(
        batched.wire["data"]["records"][1]["target"]["recordId"],
        id(408)
    );
    assert_ne!(batched.operation_id, batched.groups[0].operation_id);
    assert_ne!(
        batched.groups[0].operation_id,
        batched.groups[1].operation_id
    );
    schemas.validate("#/$defs/result_atlas_batch_execute", &batched.wire)?;
    let final_snapshot = store.read_snapshot(&principal, &scope)?;
    assert_eq!(
        final_snapshot.records.len(),
        initial
            .records
            .iter()
            .filter(|r| r.scope() == scope)
            .count()
            + 3
    );
    store.close()?;
    let mut reopened = AtlasStore::open(
        &path,
        semantics.storage_contract(),
        authorization.clone(),
        runtime,
        StoreOptions::default(),
    )?;
    assert_eq!(reopened.read_snapshot(&principal, &scope)?, final_snapshot);
    assert_eq!(
        reopened
            .read_record(&principal, &scope, &reference(RecordType::Circuit, 406))?
            .revision,
        2
    );
    reopened.close()?;
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count = |table: &str| -> rusqlite::Result<i64> {
        db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
    };
    assert_eq!(count("records")?, i64::try_from(initial.records.len())? + 3);
    assert_eq!(count("audits")?, 4);
    assert_eq!(count("receipts")?, 4);
    assert_eq!(count("batch_receipts")?, 1);
    assert_eq!(count("stock_operations")?, 3);
    assert_eq!(count("stock_groups")?, 4);
    assert_eq!(count("stock_keys")?, 5);
    assert_eq!(count("stock_audit_links")?, 4);
    assert_eq!(count("stock_history_cursors")?, 1);
    for commit in [&created, &replaced, &batched] {
        let stored: String = db.query_row(
            "SELECT commit_json FROM stock_operations WHERE operation_id=?1",
            [&commit.operation_id],
            |row| row.get(0),
        )?;
        assert_eq!(serde_json::from_str::<StockAtlasCommit>(&stored)?, *commit);
    }
    assert!(!semantics.counts.borrow().contains_key("timestamp"));
    assert_eq!(semantics.counts.borrow().get("transition"), Some(&4));
    assert_eq!(semantics.counts.borrow().get("guards"), Some(&4));
    assert_eq!(semantics.counts.borrow().get("final"), Some(&4));
    let evidence = json!({"format":"houseatlas-stock-healthy-check/1","outcome":"accepted",
        "nativeSemanticPeer":"e8 public pure Rust peer","domainPeer":"298 public stock owner mapper",
        "stockContractPeer":"fde9586f41c32924543fe7066fb0481b02744b8c",
        "scope":"Fresh synthetic create/replace, ordered two-child create batch, two history pages, matching search, persistence reopen",
        "actualEntryPoints":["execute_stock_json_with_authorization","stock_history_json_with_authorization"],
        "committedNativeCommands":4,"stockRootOperations":3,"stockGroups":4,"permanentStockKeys":5,
        "historyPages":2,"matchingSearches":1,"storedCursors":1,"rootGuardSeparateClosure":true,
        "nativeSemanticCalls":*semantics.counts.borrow(),"stockSchemaCalls":*schemas.calls.borrow(),
        "nativeAuthorizationFrames":*authorization.native_frames.borrow(),"stockAuthorizationFrames":*authorization.stock_frames.borrow(),
        "historyAuthorizationFrames":*authorization.history_frames.borrow(),"schemaResources":schemas.resources,
        "created":created,"replaced":replaced,"batch":batched,"historyFirst":first.wire,"historySecond":second.wire,"historySearch":searched.wire,
        "finalSnapshot":final_snapshot,"databaseLineage":DATABASE_LINEAGE,"sqliteVersion":rusqlite::version(),
        "schemaProfile":"Exact offline Draft202012 resources and required arm references; formats enabled, unknown formats fail; no defaults or HTTP/file retrieval; ordinary format values only",
        "deferred":"Production authority/runtime/service composition, format-boundary parity, timestamp ordering, presence/provider qualification, replay/negative/fault/race controls"});
    fs::write(
        output.join("evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!(
        "healthy stock checkpoint: 4 native commands, 3 stock roots, 4 groups, 5 keys; paged/search history and reopen retained"
    );
    println!("evidence: {}", output.join("evidence.json").display());
    Ok(())
}
