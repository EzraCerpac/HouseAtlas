//! Standalone positive checkpoint, compiled against the actual storage sources.
//! It runs no replay/rejection/fault/concurrency controls or legacy test aliases.
//! The pure JS contract is an offline oracle, not a production Rust peer.
use houseatlas_at07_checkpoint::storage::*;
use rusqlite::{Connection, OpenFlags, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    rc::Rc,
};

type CheckResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;
struct OracleProcess {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Drop for OracleProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Clone)]
struct Oracle {
    process: Rc<RefCell<OracleProcess>>,
    counts: Rc<RefCell<BTreeMap<String, usize>>>,
}
impl Oracle {
    fn start(root: &Path) -> CheckResult<Self> {
        let mut child = Command::new("node")
            .arg(root.join("backend/src/storage/checks/oracle.mjs"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let input = child.stdin.take().ok_or("oracle stdin missing")?;
        let output = BufReader::new(child.stdout.take().ok_or("oracle stdout missing")?);
        Ok(Self {
            process: Rc::new(RefCell::new(OracleProcess {
                child,
                input,
                output,
            })),
            counts: Rc::new(RefCell::new(BTreeMap::new())),
        })
    }
    fn call(&self, operation: &str, args: Value) -> Result<Value> {
        let fail = || {
            Error::new(
                "checkpoint-error",
                "Offline contract oracle could not complete",
            )
        };
        *self
            .counts
            .borrow_mut()
            .entry(operation.into())
            .or_default() += 1;
        let mut process = self.process.borrow_mut();
        writeln!(
            process.input,
            "{}",
            json!({"operation":operation,"args":args})
        )
        .map_err(|_| fail())?;
        process.input.flush().map_err(|_| fail())?;
        let mut line = String::new();
        process.output.read_line(&mut line).map_err(|_| fail())?;
        let response: Value = serde_json::from_str(&line).map_err(|_| fail())?;
        if response["ok"] != true {
            return Err(Error::new(
                match response["code"].as_str() {
                    Some("invalid-contract") => "invalid-contract",
                    Some("invalid-transition") => "invalid-transition",
                    Some("revision-conflict") => "revision-conflict",
                    Some("guard-conflict") => "guard-conflict",
                    Some("identity-conflict") => "identity-conflict",
                    _ => "checkpoint-error",
                },
                "Published contract oracle returned an error",
            ));
        }
        Ok(response["value"].clone())
    }
    fn unit(&self, operation: &str, args: Value) -> Result<()> {
        self.call(operation, args).map(|_| ())
    }
    fn canonical<T: Serialize>(&self, value: &T) -> Result<String> {
        self.canonical_json(&serde_json::to_value(value)?)
    }
    fn digest(&self, value: &Value) -> Result<String> {
        self.call("digest", json!({"value":value}))?
            .as_str()
            .map(str::to_owned)
            .ok_or(Error::new("checkpoint-error", "Digest missing"))
    }
}
impl Contract for Oracle {
    fn validate_shape(&self, name: &str, value: &Value) -> Result<()> {
        self.unit("shape", json!({"name":name,"value":value}))
    }
    fn validate_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        self.unit("snapshot", json!({"snapshot":snapshot}))
    }
    fn assert_transition(
        &self,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<u64> {
        self.call(
            "transition",
            json!({"current":current,"command":command,"target":target}),
        )?
        .as_u64()
        .ok_or(Error::new("checkpoint-error", "Revision missing"))
    }
    fn assert_guards(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
        created: &[ScopedTarget],
    ) -> Result<()> {
        self.unit("guards",json!({"snapshot":snapshot,"current":current,"command":command,"target":target,"created":created}))
    }
    fn assert_final_mutation(
        &self,
        snapshot: &Snapshot,
        current: Option<&Record>,
        command: &Mutation,
        target: &ScopedTarget,
    ) -> Result<()> {
        self.unit(
            "final",
            json!({"snapshot":snapshot,"current":current,"command":command,"target":target}),
        )
    }
    fn validate_result(&self, result: &MutationResult, prior: Prior<'_>) -> Result<()> {
        let (kind, record) = match prior {
            Prior::Unspecified => ("unspecified", None),
            Prior::Missing => ("missing", None),
            Prior::Record(r) => ("record", Some(r)),
        };
        self.unit(
            "result",
            json!({"result":result,"priorKind":kind,"prior":record}),
        )
    }
    fn canonical_json(&self, value: &Value) -> Result<String> {
        self.call("canonical", json!({"value":value}))?
            .as_str()
            .map(str::to_owned)
            .ok_or(Error::new("checkpoint-error", "Canonical JSON missing"))
    }
}
#[derive(Clone)]
struct SyntheticAuthorization {
    oracle: Oracle,
    contexts: Rc<RefCell<Vec<MutationAuthorizationContext>>>,
}
impl Authorization for SyntheticAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        // Synthetic principal only. This is not the real access boundary.
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        if let Some(context) = request.mutation {
            // Compare every detached Rust context with the published extractor.
            let expected = self
                .oracle
                .call("context", serde_json::to_value(context)?)?;
            assert_eq!(
                self.oracle.canonical(context)?,
                self.oracle.canonical_json(&expected)?
            );
            for snapshot in std::iter::once(&context.original).chain(context.candidate.as_ref()) {
                assert!(snapshot.records.iter().all(|r| r.scope() == *request.scope));
            }
            assert!(context.replay.is_none());
            self.contexts.borrow_mut().push(context.clone());
        }
        Ok(principal.clone())
    }
}
#[derive(Clone)]
struct SyntheticRuntime {
    next: Rc<Cell<u64>>,
}
impl Runtime for SyntheticRuntime {
    fn now(&self) -> Result<String> {
        Ok("2026-01-03T12:00:00Z".into())
    }
    fn new_id(&self) -> Result<String> {
        let n = self.next.get();
        self.next.set(n + 1);
        Ok(id(n))
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        // No assets are made available by this checkpoint.
        Err(Error::new(
            "checkpoint-error",
            "Checkpoint has no staged media",
        ))
    }
}
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn reference(kind: RecordType, n: u64) -> RecordRef {
    RecordRef {
        record_type: kind,
        record_id: id(n),
    }
}
fn load<T: DeserializeOwned>(root: &Path, name: &str) -> CheckResult<T> {
    Ok(serde_json::from_slice(&fs::read(
        root.join("packages/contracts/fixtures").join(name),
    )?)?)
}
fn healthy_command(
    n: u64,
    operation: Operation,
    revision: Option<u64>,
    value: Option<RecordValue>,
) -> Mutation {
    Mutation {
        schema_version: 1,
        mutation_id: id(n),
        operation,
        expected_revision: revision,
        reason: "Healthy synthetic room/item checkpoint".into(),
        guards: vec![Guard {
            record: reference(RecordType::Evidence, 100),
            expected_revision: 1,
        }],
        value,
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
        oracle.clone(),
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
    let created = store.execute_batch(&principal, &scope, &room_item_batch)?;
    assert_eq!(created.results.len(), 2);
    assert!(!created.replayed);
    let replacement = healthy_command(13_003, Operation::Replace, Some(1), Some(item_value));
    let replaced = store.execute_json(
        &principal,
        &scope,
        &item_target,
        &serde_json::to_value(&replacement)?,
    )?;
    assert_eq!(replaced.record.revision, 2);
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
    store.close()?;
    let mut reopened = AtlasStore::open(
        &path,
        oracle.clone(),
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
    let captured = contexts.borrow();
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
        "contextsCompared":captured.len(),"contractCalls":*oracle.counts.borrow(),"circuit":circuit,"roomItemBatch":created,
        "restoredItem":restored,"itemHistory":history,"remap":remapped,"snapshot":final_snapshot,
        "peerScope":"published pure contract oracle and synthetic authorization/runtime only","deferred":"replay/rejection/fault/crash/concurrency and native peer integration"});
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
