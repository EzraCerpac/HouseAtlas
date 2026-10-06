//! Accepted numeric spellings only. No rejection, replay, or held controls.
#[allow(dead_code)]
mod support;
use houseatlas_at07_checkpoint::storage::*;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};
use support::*;

const STAGED_SYNTHETIC_BYTES: &[u8] = b"synthetic-bytes!";
#[derive(Clone)]
struct ByteRuntime {
    inner: SyntheticRuntime,
    verifications: Rc<Cell<usize>>,
}
impl Runtime for ByteRuntime {
    fn now(&self) -> Result<String> {
        self.inner.now()
    }
    fn new_id(&self) -> Result<String> {
        self.inner.new_id()
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        self.verifications.set(self.verifications.get() + 1);
        Ok(AssetProof {
            sha256: format!("{:x}", Sha256::digest(STAGED_SYNTHETIC_BYTES)),
            byte_size: STAGED_SYNTHETIC_BYTES.len() as u64,
        })
    }
}
fn decimal_carriers(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (name, value) in fields {
                if matches!(
                    name.as_str(),
                    "schemaVersion"
                        | "revision"
                        | "expectedRevision"
                        | "previousRevision"
                        | "resultRevision"
                        | "cacheEpoch"
                        | "expectedCacheEpoch"
                ) && let Some(integer) = value.as_u64()
                {
                    *value = json!(integer as f64);
                } else {
                    decimal_carriers(value);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(decimal_carriers),
        _ => {}
    }
}
fn main() -> CheckResult<()> {
    let root = PathBuf::from(std::env::var("HOUSEATLAS_ROOT")?);
    let directory = PathBuf::from(std::env::args().nth(1).ok_or("fresh output required")?);
    fs::create_dir(&directory)?;
    let path = directory.join("numeric-healthy.sqlite");
    let oracle = Oracle::start(&root)?;
    let contexts = Rc::new(RefCell::new(vec![]));
    let authorization = SyntheticAuthorization {
        oracle: oracle.clone(),
        contexts: contexts.clone(),
    };
    let verifications = Rc::new(Cell::new(0));
    let runtime = ByteRuntime {
        inner: SyntheticRuntime {
            next: Rc::new(Cell::new(90_000)),
        },
        verifications: verifications.clone(),
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
    let initial: Snapshot = load(&root, "plan-free.snapshot.json")?;
    let mut initial_wire = serde_json::to_value(&initial)?;
    decimal_carriers(&mut initial_wire);
    let decoded: Snapshot = serde_json::from_value(initial_wire.clone())?;
    assert!(
        decoded
            .records
            .iter()
            .zip(&initial.records)
            .all(
                |(decoded, original)| decoded.schema_version == original.schema_version
                    && decoded.revision == original.revision
            )
    );
    assert_eq!(
        oracle.canonical_json(&initial_wire)?,
        oracle.canonical(&decoded)?
    );
    let mut store = AtlasStore::open(
        &path,
        oracle.clone(),
        authorization.clone(),
        runtime.clone(),
        StoreOptions {
            allow_synthetic_bootstrap: true,
            ..StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&decoded)?;

    let item_target = reference(RecordType::Identity, 201);
    let old = store.read_record(&principal, &scope, &item_target)?;
    let command = healthy_command(
        20_001,
        Operation::Replace,
        Some(1),
        Some(RecordValue {
            record_type: RecordType::Identity,
            payload: old.payload.clone(),
        }),
    );
    let mut command_wire = serde_json::to_value(&command)?;
    decimal_carriers(&mut command_wire);
    command_wire["expectedRevision"] = serde_json::from_str("1e0")?;
    let normalized: Mutation = serde_json::from_value(command_wire.clone())?;
    assert_eq!(normalized, command);
    assert_eq!(
        oracle.canonical_json(&command_wire)?,
        oracle.canonical(&normalized)?
    );
    let changed = store.execute_json(&principal, &scope, &item_target, &command_wire)?;
    assert_eq!(changed.record.revision, 2);

    let batch = BatchMutation {
        schema_version: 1,
        batch_id: id(20_002),
        reason: "Accepted decimal/exponent numeric carriers".into(),
        commands: vec![MutationEntry {
            target: reference(RecordType::Identity, 20_003),
            command: healthy_command(
                20_004,
                Operation::Create,
                None,
                Some(RecordValue {
                    record_type: RecordType::Identity,
                    payload: json!({"kind":"item","evidenceIds":[id(100)]}),
                }),
            ),
        }],
    };
    let mut batch_wire = serde_json::to_value(&batch)?;
    decimal_carriers(&mut batch_wire);
    batch_wire["schemaVersion"] = serde_json::from_str("1e0")?;
    assert_eq!(
        oracle.canonical_json(&batch_wire)?,
        oracle.canonical(&batch)?
    );
    let created = store.execute_batch_json(&principal, &scope, &batch_wire)?;
    assert_eq!(created.results.len(), 1);
    let mut batch_result_wire = serde_json::to_value(&created)?;
    decimal_carriers(&mut batch_result_wire);
    let decoded_batch_result: BatchResult = serde_json::from_value(batch_result_wire)?;
    assert_eq!(decoded_batch_result, created);
    let mut changed_wire = serde_json::to_value(&changed)?;
    decimal_carriers(&mut changed_wire);
    let decoded_result: MutationResult = serde_json::from_value(changed_wire)?;
    assert_eq!(decoded_result, changed);

    let staged_digest = format!("{:x}", Sha256::digest(STAGED_SYNTHETIC_BYTES));
    let asset_target = reference(RecordType::Asset, 20_005);
    let asset = healthy_command(
        20_006,
        Operation::Create,
        None,
        Some(RecordValue {
            record_type: RecordType::Asset,
            payload: json!({"owner":"atlas","purpose":"evidence-original","storageKey":"synthetic/numeric-bytes",
                "sha256":staged_digest,"byteSize":16.0,"contentType":"application/octet-stream",
                "sourceLicense":{"status":"unknown","reference":null},"availability":"available","previewPolicy":"blocked","evidenceIds":[id(100)]}),
        }),
    );
    let saved_asset = store.execute(&principal, &scope, &asset_target, &asset)?;
    assert_eq!(verifications.get(), 1);
    assert_eq!(STAGED_SYNTHETIC_BYTES.len(), 16);
    assert_eq!(saved_asset.record.payload["byteSize"].as_f64(), Some(16.0));
    let manifest = store.read_asset_manifest(&principal, &scope, &asset_target)?;
    assert_eq!(
        oracle.canonical_json(&manifest)?,
        oracle.canonical_json(&saved_asset.record.payload)?
    );

    let partition = SourcePartition {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(10),
        collection_id: "synthetic-collection-a".into(),
    };
    let prepared = store.prepare_cache_publication(&principal, &scope, &partition)?;
    let cache = CacheStatus {
        schema_version: 1,
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(10),
        collection_id: partition.collection_id.clone(),
        status: CacheState::Fresh,
        last_successful_fetch_at: Some("2026-01-03T12:00:00Z".into()),
        last_attempt_at: Some("2026-01-03T12:00:00Z".into()),
        generation_id: Some(prepared.fence().reserved_generation_id().into()),
        consistency: "non-transactional-offset-pages".into(),
        error: None,
    };
    let generation = CacheGeneration {
        cache,
        homebox_entities: prepared.state().homebox_entities.clone(),
        network_relations: vec![],
        complete: true,
        expected_generation_id: prepared.fence().baseline_generation_id().map(str::to_owned),
        expected_cache_epoch: prepared.fence().baseline_cache_epoch().value(),
    };
    let mut generation_wire = serde_json::to_value(&generation)?;
    decimal_carriers(&mut generation_wire);
    generation_wire["expectedCacheEpoch"] = serde_json::from_str("0e0")?;
    store.replace_cache_generation_json(&principal, &scope, &generation_wire)?;
    let state = store.read_cache_for_publication(&principal, &scope, &partition)?;
    let mut state_wire = serde_json::to_value(&state)?;
    decimal_carriers(&mut state_wire);
    let decoded_state: CachePublicationState = serde_json::from_value(state_wire)?;
    assert_eq!(decoded_state.cache_epoch, state.cache_epoch);
    assert_eq!(decoded_state.cache, state.cache);
    assert_eq!(oracle.canonical(&decoded_state)?, oracle.canonical(&state)?);
    let boundary: MutationCachePartition = serde_json::from_str(&format!(
        r#"{{"workspaceId":"{}","homeId":"{}","sourceInstanceId":"{}","collectionId":"synthetic-boundary","cacheEpoch":9007199254740991.0}}"#,
        id(1),
        id(2),
        id(10)
    ))?;
    assert_eq!(boundary.cache_epoch, MAX_REVISION);
    let snapshot = store.read_snapshot(&principal, &scope)?;
    oracle.validate_snapshot(&snapshot)?;
    store.close()?;
    let mut reopened = AtlasStore::open(
        &path,
        oracle.clone(),
        authorization,
        runtime,
        StoreOptions::default(),
    )?;
    assert_eq!(
        oracle.canonical(&reopened.read_snapshot(&principal, &scope)?)?,
        oracle.canonical(&snapshot)?
    );
    reopened.close()?;
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let target = ScopedTarget::new(&scope, &item_target);
    let payload_hash: String = db.query_row(
        "SELECT payload_hash FROM receipts WHERE workspace_id=?1 AND mutation_id=?2",
        params![scope.workspace_id, command.mutation_id],
        |r| r.get(0),
    )?;
    assert_eq!(
        payload_hash,
        oracle.digest(
            &json!({"target":target,"command":command_wire,"batchId":null,"batchHash":null})
        )?
    );
    let batch_hash: String = db.query_row(
        "SELECT payload_hash FROM batch_receipts WHERE workspace_id=?1 AND batch_id=?2",
        params![scope.workspace_id, batch.batch_id],
        |r| r.get(0),
    )?;
    let mut envelope = batch_wire
        .as_object()
        .ok_or("batch object required")?
        .clone();
    envelope.insert("scope".into(), serde_json::to_value(&scope)?);
    assert_eq!(batch_hash, oracle.digest(&Value::Object(envelope))?);
    fs::write(
        directory.join("evidence.json"),
        serde_json::to_vec_pretty(&json!({
            "lineage":DATABASE_LINEAGE,"sqliteVersion":rusqlite::version(),"committedCommands":3,"completePublications":1,
            "acceptedNumericSpellings":["schemaVersion:1.0","schemaVersion:1e0","expectedRevision:1e0","guard expectedRevision:1.0","byteSize:16.0","expectedCacheEpoch:0e0","cacheEpoch:9007199254740991.0"],
            "singleReceiptHashMatchesRawNumericInput":true,"batchReceiptHashMatchesRawNumericInput":true,
            "stagedSyntheticByteCount":STAGED_SYNTHETIC_BYTES.len(),"stagedSyntheticSha256":staged_digest,"actualByteProofCalls":verifications.get(),
            "contextsCompared":contexts.borrow().len(),"contractCalls":*oracle.counts.borrow(),"healthyReopen":true,
            "peerScope":"offline published contract oracle; synthetic authority/time/IDs; actual immutable in-memory synthetic bytes",
            "deferred":"all held negative/replay/denial/fault/crash/concurrency controls; native Contract/JCS/timestamp/access/runtime/provider integration"
        }))?,
    )?;
    println!(
        "numeric healthy checkpoint: 3 committed commands; 1 complete publication; decimal/exponent carriers accepted; 16 actual synthetic bytes verified; original input JCS receipt hashes matched; safe-integer boundary accepted; healthy reopen"
    );
    println!("evidence: {}", directory.join("evidence.json").display());
    Ok(())
}
