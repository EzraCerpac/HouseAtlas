//! Fresh accepted native stock commands and recorded paging/search only.
//! Original peers: actual AT07 storage, AT51 contracts, installed AT36 adapters;
//! explicit synthetic authority/preparer/runtime. No AT11 runtime qualification.
//! Run only with a NEW output directory and published synthetic fixture root.
//! No replay, bad cursor, omission, mutation control, provider, queue or JS runs.
#[path = "native_storage_healthy_support.rs"]
mod support;
use houseatlas_at36_stock_harness::{
    domain::{native_semantics::NativeSemantics, stock::*},
    storage::*,
};
use serde_json::{Value, json};
use std::{cell::RefCell, fs, path::PathBuf, rc::Rc};
use support::*;

type SyntheticStore =
    AtlasStore<NativeContract<NativeSemantics>, SyntheticStoreAuthorization, SyntheticRuntime>;

fn guard(record_type: RecordType, record: u64) -> Value {
    json!({"target":{"authority":"atlas","recordType":record_type,"recordId":id(record)},
        "revision":{"kind":"atlas","value":1}})
}
fn create(record: u64, key: u64, request: u64, payload: &Value, reason: &str) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.circuit.create","requestId":id(request),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"circuit","recordId":id(record)},
        "payload":payload,"idempotencyKey":id(key),"reason":reason,
        "preconditions":{"target":null,"guards":[guard(RecordType::Evidence,100)]},
        "approvalReceiptId":null})
}
fn history(request: u64, cursor: Value, page_size: Value) -> Value {
    json!({"schemaVersion":3,"commandId":"atlas.circuit.history","requestId":id(request),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","recordType":"circuit","recordId":id(406)},
        "payload":{"cursor":cursor,"pageSize":page_size,"includeArchived":false}})
}

fn execute(
    store: &mut SyntheticStore,
    schemas: &NativeStockContract,
    authority: &SyntheticAuthority<'_>,
    raw: Value,
) -> CheckResult<OwnerResult> {
    let principal = authority.principal;
    let prepared = prepare(
        principal,
        raw.clone(),
        schemas,
        authority,
        &mut SyntheticPreparer,
    )?;
    let scoped = SyntheticScopedAuthorization {
        principal,
        prepared: &prepared,
        observations: authority.observations.clone(),
    };
    let mut commands = NativeAtlasCommands::from_store(store, &scoped, schemas);
    let output = dispatch_prepared(
        principal,
        &prepared,
        schemas,
        authority,
        &mut InactiveOwner,
        &mut commands,
    )?;
    assert_eq!(prepared.request().raw(), &raw);
    assert_eq!(
        output.wire["data"]["requestDigest"],
        prepared.request().intent_digest()
    );
    assert_eq!(output.wire["replayed"], false);
    Ok(output)
}

fn query(
    store: &mut SyntheticStore,
    native: &NativeContract<NativeSemantics>,
    schemas: &NativeStockContract,
    authority: &SyntheticAuthority<'_>,
    raw: Value,
) -> CheckResult<OwnerResult> {
    let principal = authority.principal;
    let prepared = prepare(
        principal,
        raw.clone(),
        schemas,
        authority,
        &mut SyntheticPreparer,
    )?;
    let scoped = SyntheticScopedAuthorization {
        principal,
        prepared: &prepared,
        observations: authority.observations.clone(),
    };
    let reads = NativeStockReads::from_store(store, native, &scoped);
    let mut queries = AtlasReads::new(reads, schemas.clone());
    let output = dispatch_prepared(
        principal,
        &prepared,
        schemas,
        authority,
        &mut queries,
        &mut InactiveOwner,
    )?;
    assert_eq!(prepared.request().raw(), &raw);
    assert_eq!(output.wire["data"]["completeness"], "atlas-owned-audit");
    assert!(output.children.is_empty());
    Ok(output)
}

fn main() -> CheckResult<()> {
    let fixtures = PathBuf::from(std::env::var("HOUSEATLAS_FIXTURE_ROOT")?);
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("New output directory required")?,
    );
    fs::create_dir(&output)?;
    let initial: Snapshot =
        serde_json::from_slice(&fs::read(fixtures.join("plan-free.snapshot.json"))?)?;
    let native_create: Value =
        serde_json::from_slice(&fs::read(fixtures.join("create-circuit.mutation.json"))?)?;
    let schemas = NativeStockContract::new()?;
    let native = NativeContract::new(NativeSemantics::native());
    let principal = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let observations = Rc::new(RefCell::new(Vec::new()));
    let authority = SyntheticAuthority {
        principal: &principal,
        observations: observations.clone(),
    };
    let mut store = AtlasStore::open(
        output.join("native-stock-history.sqlite"),
        native.clone(),
        SyntheticStoreAuthorization,
        SyntheticRuntime::new(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&initial)?;

    let create_request = create(
        406,
        1_000,
        95_001,
        &native_create["value"]["payload"],
        native_create["reason"]
            .as_str()
            .ok_or("Published reason required")?,
    );
    let created = execute(&mut store, &schemas, &authority, create_request.clone())?;
    assert_eq!(created.wire["data"]["records"][0]["revision"], 1);
    let mut replace_request = create_request;
    replace_request["commandId"] = json!("atlas.circuit.replace");
    replace_request["requestId"] = json!(id(95_002));
    replace_request["idempotencyKey"] = json!(id(1_001));
    replace_request["reason"] = json!("Synthetic reviewed circuit label");
    replace_request["payload"]["label"] = json!("Synthetic circuit");
    replace_request["preconditions"]["target"] = json!({"kind":"atlas","value":1});
    let replaced = execute(&mut store, &schemas, &authority, replace_request)?;
    assert_eq!(replaced.wire["data"]["records"][0]["revision"], 2);

    let children = vec![
        create(
            407,
            1_052,
            95_006,
            &native_create["value"]["payload"],
            "Synthetic first batch circuit",
        ),
        create(
            408,
            1_053,
            95_007,
            &native_create["value"]["payload"],
            "Synthetic second batch circuit",
        ),
    ];
    let batch_request = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(95_008),
        "context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"atlas","kind":"batch","batchId":id(1_051)},
        "idempotencyKey":id(1_050),"reason":"Synthetic ordered circuit batch","approvalReceiptId":null,
        "preconditions":{"target":null,"guards":[guard(RecordType::Identity,201)]},
        "payload":{"commands":children}});
    let batch = execute(&mut store, &schemas, &authority, batch_request.clone())?;
    assert_eq!(batch.children.len(), 2);
    let mut records = Vec::new();
    let mut audits = Vec::new();
    for (index, child) in batch.children.iter().enumerate() {
        let request = ValidatedRequest::parse(
            &schemas,
            batch_request["payload"]["commands"][index].clone(),
        )?;
        assert_eq!(child["requestId"], request.request_id());
        assert_eq!(child["data"]["requestDigest"], request.intent_digest());
        assert_eq!(child["data"]["records"][0]["target"], *request.target());
        assert_eq!(child["data"]["records"][0]["revision"], 1);
        records.extend(
            child["data"]["records"]
                .as_array()
                .ok_or("Child records required")?
                .iter()
                .cloned(),
        );
        audits.extend(
            child["data"]["auditIds"]
                .as_array()
                .ok_or("Child audits required")?
                .iter()
                .cloned(),
        );
    }
    assert_eq!(batch.wire["data"]["records"], json!(records));
    assert_eq!(batch.wire["data"]["auditIds"], json!(audits));
    assert_eq!(
        batch.wire["data"]["records"][0]["target"]["recordId"],
        id(407)
    );
    assert_eq!(
        batch.wire["data"]["records"][1]["target"]["recordId"],
        id(408)
    );
    assert_ne!(batch.wire["operationId"], batch.children[0]["operationId"]);
    assert_ne!(
        batch.children[0]["operationId"],
        batch.children[1]["operationId"]
    );

    let first = query(
        &mut store,
        &native,
        &schemas,
        &authority,
        history(95_003, Value::Null, serde_json::from_str("1.0")?),
    )?;
    let first_entries = first.wire["data"]["entries"]
        .as_array()
        .ok_or("First page entries required")?;
    assert_eq!(first_entries.len(), 1);
    assert_eq!(first_entries[0]["commandId"], "atlas.circuit.create");
    assert_eq!(
        first_entries[0]["requestDigest"],
        created.wire["data"]["requestDigest"]
    );
    assert_eq!(
        first_entries[0]["eventId"],
        created.wire["data"]["auditIds"][0]
    );
    let cursor = first.wire["data"]["nextCursor"]
        .as_str()
        .ok_or("Healthy continuation required")?
        .to_owned();
    let second = query(
        &mut store,
        &native,
        &schemas,
        &authority,
        history(95_004, json!(cursor), serde_json::from_str("1e0")?),
    )?;
    let second_entries = second.wire["data"]["entries"]
        .as_array()
        .ok_or("Second page entries required")?;
    assert_eq!(second_entries.len(), 1);
    assert_eq!(second_entries[0]["commandId"], "atlas.circuit.replace");
    assert_eq!(
        second_entries[0]["requestDigest"],
        replaced.wire["data"]["requestDigest"]
    );
    assert_eq!(
        second_entries[0]["eventId"],
        replaced.wire["data"]["auditIds"][0]
    );
    assert_eq!(second.wire["data"]["nextCursor"], Value::Null);
    let mut search_request = history(95_005, Value::Null, json!(10));
    search_request["payload"]["q"] = json!("atlas.circuit.replace");
    let search = query(&mut store, &native, &schemas, &authority, search_request)?;
    assert_eq!(
        search.wire["data"]["entries"],
        second.wire["data"]["entries"]
    );
    assert_eq!(search.wire["data"]["nextCursor"], Value::Null);

    let history_frames = observations
        .borrow()
        .iter()
        .filter(|event| event["kind"] == "historyAuthorization")
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(history_frames.len(), 6);
    for pair in history_frames.as_chunks::<2>().0 {
        assert_eq!(pair[0]["auditCount"], 0);
        assert_eq!(pair[0]["resultPresent"], false);
        assert_eq!(pair[1]["auditCount"], 2);
        assert_eq!(pair[1]["resultPresent"], true);
    }
    store.close()?;
    let evidence = json!({
        "scope":"One fresh successful synthetic native storage command/history example",
        "actualAdapters":["NativeAtlasCommands","NativeStockReads","AtlasReads","NativeSemantics::native","NativeStockContract"],
        "nativeEntryPoints":["execute_stock_json_with_authorization","stock_history_json_with_authorization"],
        "committedNativeCommands":4,"freshStockRoots":3,"orderedBatchChildren":2,
        "historyPages":2,"matchingSearches":1,
        "mandatoryOutputCorrelationDisclosureAndFinalRevalidation":true,
        "syntheticPeers":["verified actor fixture","original request witness","requested-target graph","scoped native+stock authorization","server IDs/time"],
        "actualAt11RuntimeGuardQualified":false,
        "created":created.wire,"replaced":replaced.wire,"batch":batch.wire,"batchChildren":batch.children,
        "historyFirst":first.wire,"historySecond":second.wire,"matchingSearch":search.wire,
        "observations":*observations.borrow(),"databaseLineage":DATABASE_LINEAGE,"sqliteVersion":rusqlite::version(),
        "unrun":"Replay/bad-cursor/omission/guard-reversal/adversarial/fault/concurrency/provider/queue/JavaScript controls",
        "watermark":"Actual owner source behavior; no insertion-between-pages control was run"
    });
    fs::write(
        output.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!(
        "PASS fresh create/replace/ordered batch; two durable history pages and matching search"
    );
    println!(
        "evidence: {}",
        output.join("healthy-evidence.json").display()
    );
    Ok(())
}
