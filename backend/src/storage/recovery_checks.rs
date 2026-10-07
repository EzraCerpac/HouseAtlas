//! Exhaustive native row validation; no image writes or repairs.
use super::super::super::{cache_repository as cache_repo, repository as repo};
use super::{RecoveryImage, migrations, *};
use rusqlite::{Connection, Row};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

type RecordKey = (String, String); // SQL primary key: workspace, record ID.
type PartitionKey = (String, String, String, String);
type ReceiptKey = (String, String, String, String);
type Check<'a> = &'a mut dyn FnMut() -> Result<()>;

pub(super) fn incompatible() -> Error {
    Error::new("schema-incompatible", "Recovery image data is incompatible")
}
fn require(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(incompatible()) }
}
fn each(
    db: &Connection,
    sql: &str,
    check: Check<'_>,
    mut accept: impl FnMut(&Row<'_>, &mut dyn FnMut() -> Result<()>) -> Result<()>,
) -> Result<()> {
    let mut statement = db.prepare(sql)?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        accept(row, check)?;
    }
    Ok(())
}
fn native<C: Contract, T: DeserializeOwned>(contract: &C, name: &str, body: &str) -> Result<T> {
    let value: Value = serde_json::from_str(body)?;
    contract.validate_shape(name, &value)?;
    require(contract.canonical_json(&value)? == body)?;
    Ok(serde_json::from_value(value)?)
}
fn hash(value: &str) -> Result<()> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
    )
}
fn record_key(record: &Record) -> RecordKey {
    (record.workspace_id.clone(), record.record_id.clone())
}
fn partition_key(partition: &SourcePartition) -> PartitionKey {
    (
        partition.workspace_id.clone(),
        partition.home_id.clone(),
        partition.source_instance_id.clone(),
        partition.collection_id.clone(),
    )
}
fn sql_partition(row: &Row<'_>) -> Result<PartitionKey> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}
fn receipt_key(audit: &Audit) -> ReceiptKey {
    (
        audit.workspace_id.clone(),
        audit.home_id.clone(),
        audit.actor_id.clone(),
        audit.mutation_id.clone(),
    )
}

fn validate_adjacent_transition<C: Contract>(
    contract: &C,
    prior: &Record,
    result: &MutationResult,
) -> Result<()> {
    contract.validate_result(result, Prior::Record(prior))?;
    if matches!(
        result.audit.operation,
        Operation::Tombstone | Operation::Restore
    ) {
        require(
            contract.canonical_json(&prior.payload)?
                == contract.canonical_json(&result.record.payload)?,
        )?;
    }
    // This projection checks only facts retained in the adjacent outcomes.
    // It is not the original command, and supplies no historical guard proof
    // or receipt-hash input. Reuse the required native transition peer for
    // immutable fields and append-only replacement rules.
    let projection = Mutation {
        schema_version: 1,
        mutation_id: result.audit.mutation_id.clone(),
        operation: result.audit.operation,
        expected_revision: result.audit.previous_revision,
        reason: result.audit.reason.clone(),
        guards: Vec::new(),
        value: (result.audit.operation == Operation::Replace).then(|| RecordValue {
            record_type: result.record.record_type,
            payload: result.record.payload.clone(),
        }),
    };
    let target = ScopedTarget::new(&result.record.scope(), &result.record.reference());
    require(
        contract
            .assert_transition(Some(prior), &projection, &target)
            .map_err(|_| incompatible())?
            == result.record.revision,
    )
}

fn validate_core<C: Contract>(
    db: &Connection,
    contract: &C,
    check: Check<'_>,
) -> Result<RecoveryImage> {
    validate_core_profile(db, contract, check, false)
}
fn validate_core_profile<C: Contract>(
    db: &Connection,
    contract: &C,
    check: Check<'_>,
    activity: bool,
) -> Result<RecoveryImage> {
    check()?;
    if activity {
        migrations::validate_profile(db, true)?;
    } else {
        migrations::validate(db)?;
    }
    let mut integrity_rows = 0;
    each(db, "PRAGMA integrity_check", check, |row, _| {
        integrity_rows += 1;
        require(row.get::<_, String>(0)? == "ok")
    })?;
    require(integrity_rows == 1)?;
    let mut foreign_key_rows = 0;
    each(db, "PRAGMA foreign_key_check", check, |_, _| {
        foreign_key_rows += 1;
        Ok(())
    })?;
    require(foreign_key_rows == 0)?;

    let mut records = BTreeMap::new();
    let mut assets = Vec::new();
    each(
        db,
        "SELECT workspace_id,home_id,record_id,record_type,revision,body FROM records ORDER BY rowid",
        check,
        |row, _| {
            let body: String = row.get(5)?;
            let record: Record = native(contract, "record", &body)?;
            require(
                row.get::<_, String>(0)? == record.workspace_id
                    && row.get::<_, String>(1)? == record.home_id
                    && row.get::<_, String>(2)? == record.record_id
                    && row.get::<_, String>(3)? == record.record_type.as_str()
                    && row.get::<_, i64>(4)?
                        == i64::try_from(record.revision).map_err(|_| incompatible())?,
            )?;
            if record.record_type == RecordType::Asset {
                assets.push(record.clone());
            }
            require(records.insert(record_key(&record), record).is_none())
        },
    )?;

    // Validate all bodies and their real SQL keys before building the unredacted
    // graph. Snapshot's synthetic flag is an internal carrier, not provenance.
    let mut sources = BTreeSet::new();
    each(
        db,
        "SELECT workspace_id,home_id,source_instance_id,collection_id,body FROM sources ORDER BY rowid",
        check,
        |row, _| {
            let source: Value = native(contract, "sourceRegistration", &row.get::<_, String>(4)?)?;
            let key = partition_key(&repo::partition(&source)?);
            require(sql_partition(row)? == key)?;
            require(sources.insert(key))
        },
    )?;
    for (sql, name, homebox, external) in [
        (
            "SELECT workspace_id,home_id,source_instance_id,collection_id,NULL,body FROM caches ORDER BY rowid",
            "cacheStatus",
            false,
            false,
        ),
        (
            "SELECT workspace_id,home_id,source_instance_id,collection_id,external_id,body FROM projections ORDER BY rowid",
            "homeboxProjection",
            true,
            true,
        ),
        (
            "SELECT workspace_id,home_id,source_instance_id,collection_id,external_id,body FROM network_relations ORDER BY rowid",
            "networkRelation",
            false,
            true,
        ),
    ] {
        each(db, sql, check, |row, _| {
            let value: Value = native(contract, name, &row.get::<_, String>(5)?)?;
            let source = if homebox { &value["source"] } else { &value };
            let key = (
                repo::string(&value, "workspaceId")?.to_owned(),
                repo::string(&value, "homeId")?.to_owned(),
                repo::string(source, "sourceInstanceId")?.to_owned(),
                repo::string(source, "collectionId")?.to_owned(),
            );
            require(sql_partition(row)? == key && sources.contains(&key))?;
            if external {
                require(row.get::<_, String>(4)? == repo::string(source, "externalId")?)?;
            }
            Ok(())
        })?;
    }
    check()?;
    let snapshot = repo::snapshot(db)?;
    contract.validate_snapshot(&snapshot)?;
    check()?;
    validate_reservations(db, &records, check)?;
    validate_cache_state(db, contract, &sources, &snapshot, check)?;
    validate_manifests(db, contract, &records, &assets, check)?;
    validate_history(db, contract, &records, check)?;
    check()?;
    Ok(RecoveryImage {
        contract_version: CONTRACT_VERSION.into(),
        database_lineage: DATABASE_LINEAGE.into(),
        database_schema: if activity {
            STOCK_ACTIVITY_DATABASE_VERSION
        } else {
            DATABASE_VERSION
        },
        assets,
    })
}

/// Existing native-only compatibility path does not silently skip app rows.
pub(super) fn validate_connection<C: Contract>(
    db: &Connection,
    contract: &C,
    check: Check<'_>,
) -> Result<RecoveryImage> {
    let image = validate_core(db, contract, check)?;
    // These exact AT12 signatures have no required StockContractPort. Do not
    // certify nonempty stock envelopes/wire/cursor state using native C alone.
    // Native-only upgraded v2 databases legitimately have an empty journal.
    let stock_present: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM stock_operations UNION ALL SELECT 1 FROM stock_groups UNION ALL SELECT 1 FROM stock_keys UNION ALL SELECT 1 FROM stock_audit_links UNION ALL SELECT 1 FROM stock_history_cursors UNION ALL SELECT 1 FROM upload_consumptions)", [], |row|row.get(0))?;
    if stock_present {
        return Err(Error::new(
            "schema-incompatible",
            "Stock recovery requires its exact schema and cursor validation peer",
        ));
    }
    // Native-only images contain one NULL-command lookup per immutable audit.
    // Check the derived index exhaustively here, rather than on history pages.
    let lookup_incompatible: bool = db.query_row("SELECT EXISTS(SELECT seq,workspace_id,home_id,record_id,audit_id,command_id FROM stock_history_lookup EXCEPT SELECT seq,workspace_id,home_id,record_id,audit_id,NULL FROM audits) OR EXISTS(SELECT seq,workspace_id,home_id,record_id,audit_id,NULL FROM audits EXCEPT SELECT seq,workspace_id,home_id,record_id,audit_id,command_id FROM stock_history_lookup)", [], |row| row.get(0))?;
    require(!lookup_incompatible)?;
    let queue_present: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM queue_physical UNION ALL SELECT 1 FROM queue_aliases UNION ALL SELECT 1 FROM queue_jobs UNION ALL SELECT 1 FROM queue_attempts UNION ALL SELECT 1 FROM queue_journal UNION ALL SELECT 1 FROM queue_evidence UNION ALL SELECT 1 FROM queue_liability_evidence UNION ALL SELECT 1 FROM queue_outcomes)", [], |row| row.get(0))?;
    if queue_present {
        return Err(Error::new(
            "schema-incompatible",
            "Queue recovery requires its complete intent, evidence and registration validation peer",
        ));
    }
    check()?;
    Ok(image)
}

pub(super) fn validate_connection_with_peers<
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
>(
    db: &Connection,
    contract: &C,
    peers: &super::RecoveryValidationPeers<'_, S, D, E>,
    check: Check<'_>,
) -> Result<RecoveryImage> {
    let image = validate_core(db, contract, check)?;
    super::super::super::stock_recovery::validate(db, contract, peers.stock, check)?;
    check()?;
    super::super::super::queue::validate_recovery_queues(
        db,
        peers.queues,
        peers.discovery,
        peers.stock,
        peers.evidence,
        check,
    )?;
    check()?;
    Ok(image)
}

pub(super) fn validate_connection_with_activity_peers<
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
    W: crate::providers::homebox::write::stock::StockContractPort,
    AD: StockActivityRecoveryDiscovery,
    AE: StockActivityRecoveryEvidence,
>(
    db: &Connection,
    contract: &C,
    base: &super::RecoveryValidationPeers<'_, S, D, E>,
    activity: &StockActivityRecoveryPeers<'_, W, AD, AE>,
    check: Check<'_>,
) -> Result<RecoveryImage> {
    let image = validate_core_profile(db, contract, check, true)?;
    super::super::super::stock_recovery::validate(db, contract, base.stock, check)?;
    check()?;
    // Independent Jobs rows keep their own registry, codecs and original claims.
    // They are never used as native activity producer/attempt evidence.
    super::super::super::queue::validate_recovery_queues(
        db,
        base.queues,
        base.discovery,
        base.stock,
        base.evidence,
        check,
    )?;
    check()?;
    super::super::super::stock_activity::validate_recovery_activity(db, activity, check)?;
    check()?;
    Ok(image)
}

fn validate_reservations(
    db: &Connection,
    records: &BTreeMap<RecordKey, Record>,
    check: Check<'_>,
) -> Result<()> {
    let mut expected = BTreeSet::new();
    for record in records
        .values()
        .filter(|r| r.record_type == RecordType::Binding)
    {
        check()?;
        let source = &record.payload["source"];
        let atlas_id = repo::string(&record.payload, "atlasId")?;
        let identity = records
            .get(&(record.workspace_id.clone(), atlas_id.to_owned()))
            .ok_or_else(incompatible)?;
        require(
            identity.home_id == record.home_id && identity.record_type == RecordType::Identity,
        )?;
        expected.insert((
            record.workspace_id.clone(),
            record.home_id.clone(),
            record.record_id.clone(),
            repo::string(source, "sourceInstanceId")?.to_owned(),
            repo::string(source, "collectionId")?.to_owned(),
            repo::string(source, "sourceKind")?.to_owned(),
            repo::string(source, "externalId")?.to_owned(),
            atlas_id.to_owned(),
        ));
    }
    let mut actual = BTreeSet::new();
    each(
        db,
        "SELECT workspace_id,home_id,record_id,source_instance_id,collection_id,source_kind,external_id,atlas_id FROM binding_reservations ORDER BY rowid",
        check,
        |row, _| {
            require(actual.insert((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            )))
        },
    )?;
    require(actual == expected)
}

fn validate_cache_state<C: Contract>(
    db: &Connection,
    contract: &C,
    sources: &BTreeSet<PartitionKey>,
    snapshot: &Snapshot,
    check: Check<'_>,
) -> Result<()> {
    let mut epochs = BTreeSet::new();
    each(
        db,
        "SELECT workspace_id,home_id,source_instance_id,collection_id,epoch FROM cache_epochs ORDER BY rowid",
        check,
        |row, _| {
            let key = sql_partition(row)?;
            let epoch = row.get::<_, i64>(4)?;
            require(
                sources.contains(&key)
                    && epoch >= 0
                    && epoch <= MAX_REVISION as i64
                    && epochs.insert(key),
            )
        },
    )?;
    require(epochs == *sources)?;
    each(
        db,
        "SELECT workspace_id,home_id,source_instance_id,collection_id,generation_id FROM cache_generations ORDER BY rowid",
        check,
        |row, _| {
            require(sources.contains(&sql_partition(row)?))?;
            // Reuse the exact published UUID lexical constraint without inventing a
            // registration/presence record. RecordRef has no existence semantics.
            contract.validate_shape(
                "recordRef",
                &json!({"recordType":"identity","recordId":row.get::<_,String>(4)?}),
            )
        },
    )?;
    for cache in &snapshot.caches {
        check()?;
        if let Some(generation) = cache["generationId"].as_str() {
            require(cache_repo::generation_reserved(
                db,
                &repo::partition(cache)?,
                generation,
            )?)?;
        }
    }
    Ok(())
}

fn validate_manifests<C: Contract>(
    db: &Connection,
    contract: &C,
    records: &BTreeMap<RecordKey, Record>,
    assets: &[Record],
    check: Check<'_>,
) -> Result<()> {
    let mut manifests = BTreeSet::new();
    each(
        db,
        "SELECT workspace_id,home_id,record_id,storage_key,body FROM asset_manifests ORDER BY rowid",
        check,
        |row, _| {
            let key = (row.get::<_, String>(0)?, row.get::<_, String>(2)?);
            let record = records.get(&key).ok_or_else(incompatible)?;
            let body = row.get::<_, String>(4)?;
            let payload: Value = serde_json::from_str(&body)?;
            require(
                record.record_type == RecordType::Asset
                    && row.get::<_, String>(1)? == record.home_id
                    && row.get::<_, String>(3)? == repo::string(&record.payload, "storageKey")?
                    && contract.canonical_json(&payload)? == body
                    && contract.canonical_json(&record.payload)? == body
                    && manifests.insert(key),
            )
        },
    )?;
    require(manifests == assets.iter().map(record_key).collect())
}

fn validate_history<C: Contract>(
    db: &Connection,
    contract: &C,
    records: &BTreeMap<RecordKey, Record>,
    check: Check<'_>,
) -> Result<()> {
    let mut receipts: BTreeMap<ReceiptKey, MutationResult> = BTreeMap::new();
    let mut audit_results = BTreeMap::new();
    each(
        db,
        "SELECT workspace_id,home_id,actor_id,mutation_id,payload_hash,body FROM receipts ORDER BY rowid",
        check,
        |row, _| {
            hash(&row.get::<_, String>(4)?)?;
            let result: MutationResult =
                native(contract, "mutationResult", &row.get::<_, String>(5)?)?;
            require(
                !result.replayed
                    && (
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ) == receipt_key(&result.audit),
            )?;
            contract.validate_result(&result, Prior::Unspecified)?;
            require(
                records
                    .get(&record_key(&result.record))
                    .is_some_and(|current| {
                        current.home_id == result.record.home_id
                            && current.record_type == result.record.record_type
                            && current.revision >= result.record.revision
                    }),
            )?;
            require(
                audit_results
                    .insert(result.audit.audit_id.clone(), result.clone())
                    .is_none(),
            )?;
            require(
                receipts
                    .insert(receipt_key(&result.audit), result)
                    .is_none(),
            )
        },
    )?;
    let mut seq = 0_i64;
    let mut audit_sequence = BTreeMap::new();
    let mut last: BTreeMap<RecordKey, MutationResult> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    each(
        db,
        "SELECT seq,workspace_id,home_id,record_id,audit_id,body FROM audits ORDER BY seq",
        check,
        |row, _| {
            seq = seq.checked_add(1).ok_or_else(incompatible)?;
            let audit: Audit = native(contract, "audit", &row.get::<_, String>(5)?)?;
            require(
                row.get::<_, i64>(0)? == seq
                    && row.get::<_, String>(1)? == audit.workspace_id
                    && row.get::<_, String>(2)? == audit.home_id
                    && row.get::<_, String>(3)? == audit.record.record_id
                    && row.get::<_, String>(4)? == audit.audit_id
                    && seen.insert(audit.audit_id.clone()),
            )?;
            let result = audit_results
                .get(&audit.audit_id)
                .ok_or_else(incompatible)?;
            require(result.audit == audit)?;
            audit_sequence.insert(audit.audit_id.clone(), seq);
            let key = record_key(&result.record);
            if let Some(prior) = last.get(&key) {
                validate_adjacent_transition(contract, &prior.record, result)?;
            } else if audit.operation == Operation::Create {
                contract.validate_result(result, Prior::Missing)?;
            }
            // Noncreate first audited transitions can follow an unaudited seed.
            last.insert(key, result.clone());
            Ok(())
        },
    )?;
    require(seen.len() == audit_results.len())?;
    for (key, result) in last {
        check()?;
        require(
            records
                .get(&key)
                .is_some_and(|current| *current == result.record),
        )?;
    }
    let mut batched = BTreeSet::new();
    each(
        db,
        "SELECT workspace_id,home_id,actor_id,batch_id,payload_hash,body FROM batch_receipts ORDER BY rowid",
        check,
        |row, check| {
            hash(&row.get::<_, String>(4)?)?;
            let body = row.get::<_, String>(5)?;
            let value: Value = serde_json::from_str(&body)?;
            require(contract.canonical_json(&value)? == body)?;
            let results: Vec<MutationResult> = serde_json::from_value(value)?;
            require(!results.is_empty() && results.len() <= 100)?;
            let scope = Scope {
                workspace_id: row.get(0)?,
                home_id: row.get(1)?,
            };
            let actor = row.get::<_, String>(2)?;
            contract.validate_shape(
                "batchResult",
                &serde_json::to_value(BatchResult {
                    schema_version: 1,
                    batch_id: row.get(3)?,
                    results: results.clone(),
                    replayed: false,
                })?,
            )?;
            let mut targets = BTreeSet::new();
            let mut mutations = BTreeSet::new();
            let mut previous_seq: Option<i64> = None;
            for result in results {
                check()?;
                let key = receipt_key(&result.audit);
                let current_seq = *audit_sequence
                    .get(&result.audit.audit_id)
                    .ok_or_else(incompatible)?;
                require(
                    previous_seq.is_none_or(|prior| prior.checked_add(1) == Some(current_seq)),
                )?;
                previous_seq = Some(current_seq);
                require(
                    result.record.scope() == scope
                        && result.audit.actor_id == actor
                        && !result.replayed
                        && receipts.get(&key) == Some(&result)
                        && targets.insert((
                            result.record.record_type.as_str(),
                            result.record.record_id.clone(),
                        ))
                        && mutations.insert(result.audit.mutation_id.clone())
                        && batched.insert(key),
                )?;
            }
            Ok(())
        },
    )?;
    // Original native commands/guards/batch envelopes are not persisted. Hash
    // syntax, canonical outcomes and complete key/audit/child linkage above are
    // verifiable; reconstructing payload_hash from invented intent is not.
    Ok(())
}
