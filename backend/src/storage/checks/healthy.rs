//! Positive record checkpoint. No stopped controls or production peer claims.
mod support;
use houseatlas_at07_checkpoint::storage::*;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::json;
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};
use support::*;

// Distinct non-cloneable borrowed peer; its authority remains synthetic.
struct BorrowedAuthorization<'a> {
    inner: &'a SyntheticAuthorization,
}
impl Authorization for BorrowedAuthorization<'_> {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        assert_eq!(request.capability, Capability::Mutate);
        assert!(request.mutation.is_some());
        self.inner.authorize(principal, request)
    }
}
fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("fresh disposable output directory required")?,
    );
    fs::create_dir(&directory)?;
    let path = directory.join("healthy.sqlite");
    let oracle = Oracle::start(&root)?;
    let contexts = Rc::new(RefCell::new(vec![]));
    let authorization = SyntheticAuthorization {
        oracle: oracle.clone(),
        contexts: contexts.clone(),
    };
    let runtime = SyntheticRuntime {
        next: Rc::new(Cell::new(80_000)),
    };
    let scope = Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let principal = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let options = StoreOptions {
        allow_synthetic_bootstrap: true,
        ..StoreOptions::default()
    };
    let mut store = AtlasStore::open(
        &path,
        oracle.storage_contract(),
        authorization.clone(),
        runtime.clone(),
        options,
    )?;
    let initial: Snapshot = load(&root, "plan-free.snapshot.json")?;
    store.initialize_synthetic(&initial)?;
    assert_eq!(store.database_version(), 1);
    let room = store.read_record(&principal, &scope, &reference(RecordType::Identity, 200))?;
    let item = store.read_record(&principal, &scope, &reference(RecordType::Identity, 201))?;
    assert_eq!(room.payload["kind"], "location");
    assert_eq!(item.payload["kind"], "item");
    assert!(
        store
            .history(&principal, &scope, &room.reference())?
            .is_empty()
    );
    let scoped_before = store.read_snapshot(&principal, &scope)?;
    assert_eq!(
        oracle.canonical(&scoped_before.homebox_entities)?,
        oracle.canonical(
            &initial
                .homebox_entities
                .iter()
                .filter(|r| r["homeId"] == scope.home_id)
                .collect::<Vec<_>>()
        )?
    );

    let circuit_target = reference(RecordType::Circuit, 406);
    let circuit_command: Mutation = load(&root, "create-circuit.mutation.json")?;
    let circuit = store.execute(&principal, &scope, &circuit_target, &circuit_command)?;
    let room_target = reference(RecordType::Identity, 12_000);
    let item_target = reference(RecordType::Identity, 12_001);
    let room_value = RecordValue {
        record_type: RecordType::Identity,
        payload: json!({"kind":"location","evidenceIds":[id(100)]}),
    };
    let item_value = RecordValue {
        record_type: RecordType::Identity,
        payload: json!({"kind":"item","evidenceIds":[id(100)]}),
    };
    let room_item_batch = BatchMutation {
        schema_version: 1,
        batch_id: id(13_000),
        reason: "Create synthetic room and item".into(),
        commands: vec![
            MutationEntry {
                target: room_target.clone(),
                command: healthy_command(13_001, Operation::Create, None, Some(room_value)),
            },
            MutationEntry {
                target: item_target.clone(),
                command: healthy_command(13_002, Operation::Create, None, Some(item_value.clone())),
            },
        ],
    };
    let per_call_contexts = Rc::new(RefCell::new(vec![]));
    let per_call_authorization = SyntheticAuthorization {
        oracle: oracle.clone(),
        contexts: per_call_contexts.clone(),
    };
    let borrowed_authorization = BorrowedAuthorization {
        inner: &per_call_authorization,
    };
    let stored_authorizer_before = contexts.borrow().len();
    let created = store.execute_batch_json_with_authorization(
        &borrowed_authorization,
        &principal,
        &scope,
        &serde_json::to_value(&room_item_batch)?,
    )?;
    assert_eq!(contexts.borrow().len(), stored_authorizer_before);
    assert_eq!(per_call_contexts.borrow().len(), 4);
    assert_eq!(created.results.len(), 2);
    assert!(!created.replayed);
    let replacement = healthy_command(13_003, Operation::Replace, Some(1), Some(item_value));
    let replaced = store.execute_json_with_authorization(
        &borrowed_authorization,
        &principal,
        &scope,
        &item_target,
        &serde_json::to_value(&replacement)?,
    )?;
    assert_eq!(replaced.record.revision, 2);
    assert_eq!(contexts.borrow().len(), stored_authorizer_before);
    assert_eq!(per_call_contexts.borrow().len(), 8);
    let tombstone = healthy_command(13_004, Operation::Tombstone, Some(2), None);
    let retired = store.execute(&principal, &scope, &item_target, &tombstone)?;
    assert_eq!(retired.record.lifecycle, Lifecycle::Tombstoned);
    assert_eq!(
        store.read_record(&principal, &scope, &item_target)?,
        retired.record
    );
    let restore = healthy_command(13_005, Operation::Restore, Some(3), None);
    let restored = store.execute(&principal, &scope, &item_target, &restore)?;
    assert_eq!(restored.record.revision, 4);
    assert_eq!(restored.record.lifecycle, Lifecycle::Active);
    assert_eq!(restored.record.payload, retired.record.payload);
    let history = store.history(&principal, &scope, &item_target)?;
    assert_eq!(
        history
            .iter()
            .map(|a| a.result_revision)
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 4]
    );
    assert_eq!(
        history.iter().map(|a| a.operation).collect::<Vec<_>>(),
        vec![
            Operation::Create,
            Operation::Replace,
            Operation::Tombstone,
            Operation::Restore
        ]
    );

    // Published remap command with the same held-admission adaptation used by
    // ordinary core: new binding sourceState stays unresolved.
    let mut remap: BatchMutation = load(&root, "import-remap.batch.json")?;
    remap.commands[1]
        .command
        .value
        .as_mut()
        .ok_or("remap value missing")?
        .payload["sourceState"] = json!("unresolved");
    let remapped = store.execute_batch_json(&principal, &scope, &serde_json::to_value(&remap)?)?;
    assert_eq!(remapped.results.len(), 3);
    assert_eq!(
        remapped.results[0].record.payload["reviewStatus"],
        "retired"
    );
    assert_eq!(
        remapped.results[1].record.payload["reviewStatus"],
        "accepted"
    );
    assert_eq!(
        remapped.results[2].record.record_type,
        RecordType::Reconciliation
    );
    let final_snapshot = store.read_snapshot(&principal, &scope)?;
    oracle.validate_snapshot(&final_snapshot)?;
    // The native domain bridge validates these frozen public output names.
    // Exercise generated schemas against actual committed storage outputs.
    let native_contract = oracle.storage_contract();
    native_contract.validate_shape("snapshot", &serde_json::to_value(&final_snapshot)?)?;
    native_contract.validate_shape("record", &serde_json::to_value(&restored.record)?)?;
    for audit in &history {
        native_contract.validate_shape("audit", &serde_json::to_value(audit)?)?;
    }
    store.close()?;
    let mut reopened = AtlasStore::open(
        &path,
        oracle.storage_contract(),
        authorization,
        runtime,
        StoreOptions::default(),
    )?;
    assert_eq!(
        reopened.read_record(&principal, &scope, &item_target)?,
        restored.record
    );
    assert_eq!(reopened.history(&principal, &scope, &item_target)?, history);
    assert_eq!(reopened.read_snapshot(&principal, &scope)?, final_snapshot);
    reopened.close()?;

    // Read-only evidence of the committed write set and exact receipt hashes.
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut committed = vec![
        (
            vec![MutationEntry {
                target: circuit_target,
                command: circuit_command,
            }],
            None,
        ),
        (
            room_item_batch.commands.clone(),
            Some(room_item_batch.clone()),
        ),
        (
            vec![MutationEntry {
                target: item_target.clone(),
                command: replacement,
            }],
            None,
        ),
        (
            vec![MutationEntry {
                target: item_target.clone(),
                command: tombstone,
            }],
            None,
        ),
        (
            vec![MutationEntry {
                target: item_target,
                command: restore,
            }],
            None,
        ),
    ];
    committed.push((remap.commands.clone(), Some(remap)));
    for (entries, batch) in &committed {
        let batch_hash = batch
            .as_ref()
            .map(|batch| {
                let mut envelope = serde_json::to_value(batch)?;
                envelope["scope"] = serde_json::to_value(&scope)?;
                oracle.digest(&envelope)
            })
            .transpose()?;
        if let Some(batch) = batch {
            let (hash, body): (String, String) = db.query_row(
                "SELECT payload_hash,body FROM batch_receipts WHERE batch_id=?1",
                [&batch.batch_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            assert_eq!(Some(hash), batch_hash);
            let results: Vec<MutationResult> = serde_json::from_str(&body)?;
            assert_eq!(results.len(), entries.len());
        }
        for entry in entries {
            let expected=oracle.digest(&json!({"target":ScopedTarget::new(&scope,&entry.target),"command":entry.command,"batchId":batch.as_ref().map(|b| &b.batch_id),"batchHash":batch_hash}))?;
            let (hash,body): (String,String) = db.query_row("SELECT payload_hash,body FROM receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",
                params![scope.workspace_id,scope.home_id,principal.actor_id,entry.command.mutation_id],|r| Ok((r.get(0)?,r.get(1)?)))?;
            assert_eq!(hash, expected);
            let result: MutationResult = serde_json::from_str(&body)?;
            assert!(!result.replayed);
            oracle.validate_result(&result, Prior::Unspecified)?;
        }
    }
    let count = |table: &str| -> rusqlite::Result<u32> {
        db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
    };
    assert_eq!(count("audits")?, 9);
    assert_eq!(count("receipts")?, 9);
    assert_eq!(count("batch_receipts")?, 2);
    assert_eq!(count("binding_reservations")?, 4);
    let lineage: String = db.query_row(
        "SELECT value FROM atlas_rust_metadata WHERE key='lineage'",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(lineage, DATABASE_LINEAGE);
    assert_eq!(contexts.borrow().len(), 16);
    assert_eq!(per_call_contexts.borrow().len(), 8);
    let captured: Vec<_> = contexts
        .borrow()
        .iter()
        .chain(per_call_contexts.borrow().iter())
        .cloned()
        .collect();
    assert_eq!(captured.len(), 24);
    for phases in captured.as_chunks::<4>().0 {
        assert_eq!(
            phases.iter().map(|c| c.phase).collect::<Vec<_>>(),
            vec![
                MutationPhase::Intake,
                MutationPhase::Validate,
                MutationPhase::Candidate,
                MutationPhase::Precommit
            ]
        );
        assert!(phases.iter().all(|c| c.context_id == phases[0].context_id
            && c.original == phases[0].original
            && c.cache_partitions == phases[0].cache_partitions));
    }
    assert_eq!(oracle.counts.borrow().get("transition"), Some(&9));
    assert_eq!(oracle.counts.borrow().get("guards"), Some(&9));
    assert_eq!(oracle.counts.borrow().get("final"), Some(&9));
    let evidence = json!({"lineage":lineage,"databaseVersion":1,"sqliteVersion":rusqlite::version(),"auditRows":count("audits")?,
        "receiptRows":count("receipts")?,"batchReceiptRows":count("batch_receipts")?,"bindingReservations":count("binding_reservations")?,
        "contextsCompared":captured.len(),"storedAuthorizerContexts":contexts.borrow().len(),"borrowedAuthorizerContexts":per_call_contexts.borrow().len(),
        "borrowedAuthorizerPhases":per_call_contexts.borrow().iter().map(|context| context.phase).collect::<Vec<_>>(),
        "nativeOutputShapes":{"snapshot":1,"record":1,"audit":history.len()},
        "contractCalls":*oracle.counts.borrow(),"circuit":circuit,"roomItemBatch":created,
        "restoredItem":restored,"itemHistory":history,"remap":remapped,"snapshot":final_snapshot,
        "peerScope":"AT51 native shapes/numeric types; offline published semantic/JCS oracle; synthetic authorization/runtime","deferred":"replay/rejection/fault/crash/concurrency and full native semantic/access/runtime peer integration"});
    fs::write(
        directory.join("evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!(
        "healthy checkpoint: 9 committed commands; 9 audits; 9 exact-hash receipts; 2 batch receipts; 24 contexts matched; SQLite {}; healthy reopen",
        rusqlite::version()
    );
    println!("evidence: {}", directory.join("evidence.json").display());
    Ok(())
}
