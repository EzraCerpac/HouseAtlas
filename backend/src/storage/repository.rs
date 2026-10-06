//! SQL is private to storage. Callers never supply table names or connections.
use super::{cache_repository as cache_repo, *};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

pub(crate) fn json<C: Contract, T: Serialize>(contract: &C, value: &T) -> Result<String> {
    contract.canonical_json(&serde_json::to_value(value)?)
}
pub(crate) fn digest<C: Contract, T: Serialize>(contract: &C, value: &T) -> Result<String> {
    Ok(super::migrations::sha256(json(contract, value)?))
}
fn rows<T: DeserializeOwned>(db: &Connection, sql: &str) -> Result<Vec<T>> {
    db.prepare(sql)?
        .query_map([], |r| r.get::<_, String>(0))?
        .map(|row| Ok(serde_json::from_str(&row?)?))
        .collect()
}
pub(crate) fn snapshot(db: &Connection) -> Result<Snapshot> {
    Ok(Snapshot {
        records: rows(db, "SELECT body FROM records ORDER BY rowid")?,
        sources: rows(db, "SELECT body FROM sources ORDER BY rowid")?,
        homebox_entities: rows(db, "SELECT body FROM projections ORDER BY rowid")?,
        caches: rows(db, "SELECT body FROM caches ORDER BY rowid")?,
        network_relations: rows(db, "SELECT body FROM network_relations ORDER BY rowid")?,
        ..Snapshot::default()
    })
}
pub(crate) fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key].as_str().ok_or(Error::new(
        "invalid-contract",
        "Required contract string is missing",
    ))
}
pub(crate) fn partition(value: &Value) -> Result<SourcePartition> {
    Ok(SourcePartition {
        workspace_id: string(value, "workspaceId")?.into(),
        home_id: string(value, "homeId")?.into(),
        source_instance_id: string(value, "sourceInstanceId")?.into(),
        collection_id: string(value, "collectionId")?.into(),
    })
}
pub(crate) fn cache_partitions(
    db: &Connection,
    scope: &Scope,
) -> Result<Vec<MutationCachePartition>> {
    let rows = db.prepare("SELECT s.source_instance_id,s.collection_id,e.epoch FROM sources s LEFT JOIN cache_epochs e USING(workspace_id,home_id,source_instance_id,collection_id) WHERE s.workspace_id=?1 AND s.home_id=?2 ORDER BY s.rowid")?
        .query_map(params![scope.workspace_id,scope.home_id], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, Option<i64>>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(source_instance_id, collection_id, epoch)| {
            Ok(MutationCachePartition {
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
                source_instance_id,
                collection_id,
                cache_epoch: u64::try_from(epoch.ok_or(Error::new(
                    "not-found",
                    "Registered cache partition unavailable",
                ))?)
                .map_err(|_| Error::new("schema-incompatible", "Cache epoch is incompatible"))?,
            })
        })
        .collect()
}
pub(crate) fn read_record(db: &Connection, scope: &Scope, target: &RecordRef) -> Result<Record> {
    let body: Option<String> = db.query_row("SELECT body FROM records WHERE workspace_id=?1 AND home_id=?2 AND record_type=?3 AND record_id=?4",
        params![scope.workspace_id, scope.home_id, target.record_type.as_str(), target.record_id], |r| r.get(0)).optional()?;
    Ok(serde_json::from_str(&body.ok_or(Error::new(
        "not-found",
        "Record unavailable in authorized home",
    ))?)?)
}
pub(crate) fn history(db: &Connection, scope: &Scope, target: &RecordRef) -> Result<Vec<Audit>> {
    read_record(db, scope, target)?;
    db.prepare("SELECT body FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 ORDER BY seq")?
        .query_map(params![scope.workspace_id, scope.home_id, target.record_id], |r| r.get::<_, String>(0))?
        .map(|r| Ok(serde_json::from_str(&r?)?)).collect()
}
pub(crate) fn asset_manifest(db: &Connection, scope: &Scope, target: &RecordRef) -> Result<Value> {
    if target.record_type != RecordType::Asset {
        return Err(Error::new("not-found", "Asset unavailable"));
    }
    let body: Option<String> = db.query_row("SELECT body FROM asset_manifests WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3",
        params![scope.workspace_id, scope.home_id, target.record_id], |r| r.get(0)).optional()?;
    Ok(serde_json::from_str(
        &body.ok_or(Error::new("not-found", "Asset unavailable"))?,
    )?)
}
pub(crate) fn write_record<C: Contract, R: Runtime>(
    db: &Connection,
    contract: &C,
    runtime: &R,
    record: &Record,
    prior: Option<&Record>,
) -> Result<()> {
    let body = json(contract, record)?;
    let revision = sql_revision(record.revision)?;
    if let Some(prior) = prior {
        let count = db.execute("UPDATE records SET home_id=?1,record_type=?2,revision=?3,body=?4 WHERE workspace_id=?5 AND record_id=?6 AND home_id=?7 AND record_type=?8 AND revision=?9",
            params![record.home_id, record.record_type.as_str(), revision, body, record.workspace_id, record.record_id, prior.home_id, prior.record_type.as_str(), sql_revision(prior.revision)?])?;
        if count != 1 {
            return Err(Error::new(
                "revision-conflict",
                "Record changed during transaction",
            ));
        }
    } else {
        db.execute(
            "INSERT INTO records VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                record.workspace_id,
                record.home_id,
                record.record_id,
                record.record_type.as_str(),
                revision,
                body
            ],
        )?;
        if record.record_type == RecordType::Binding {
            let source = &record.payload["source"];
            db.execute(
                "INSERT INTO binding_reservations VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    record.workspace_id,
                    record.home_id,
                    record.record_id,
                    string(source, "sourceInstanceId")?,
                    string(source, "collectionId")?,
                    string(source, "sourceKind")?,
                    string(source, "externalId")?,
                    string(&record.payload, "atlasId")?
                ],
            )?;
        }
    }
    if record.record_type == RecordType::Asset {
        let payload = &record.payload;
        if record.lifecycle == Lifecycle::Active && payload["availability"] == "available" {
            let proof = runtime.verify_available_asset(record)?;
            if payload["sha256"].as_str() != Some(&proof.sha256)
                || super::numeric::safe_integer(&payload["byteSize"]) != Some(proof.byte_size)
            {
                return Err(Error::new(
                    "invalid-transition",
                    "Available asset requires verified immutable staged bytes",
                ));
            }
        }
        db.execute("INSERT INTO asset_manifests VALUES(?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,record_id) DO UPDATE SET body=excluded.body",
            params![record.workspace_id,record.home_id,record.record_id,string(payload,"storageKey")?,json(contract,payload)?])?;
    }
    Ok(())
}
fn sql_revision(revision: u64) -> Result<i64> {
    if revision == 0 || revision > MAX_REVISION {
        return Err(Error::new(
            "invalid-contract",
            "Revision is outside the published integer range",
        ));
    }
    Ok(revision as i64)
}
pub(crate) fn bootstrap<C: Contract, R: Runtime>(
    db: &Connection,
    contract: &C,
    runtime: &R,
    snapshot: &Snapshot,
) -> Result<()> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM records UNION SELECT 1 FROM sources)",
        [],
        |r| r.get(0),
    )?;
    if exists {
        return Err(Error::new(
            "invalid-transition",
            "Bootstrap requires an empty database",
        ));
    }
    contract.validate_snapshot(snapshot)?;
    for source in &snapshot.sources {
        cache_repo::write_source(db, contract, source)?;
    }
    for record in &snapshot.records {
        write_record(db, contract, runtime, record, None)?;
    }
    for cache in &snapshot.caches {
        cache_repo::write_cache(db, contract, cache)?;
        if let Some(generation) = cache["generationId"].as_str() {
            cache_repo::reserve_generation(db, &partition(cache)?, generation)?;
        }
    }
    for projection in &snapshot.homebox_entities {
        cache_repo::write_homebox(db, contract, projection)?;
    }
    for relation in &snapshot.network_relations {
        cache_repo::write_network(db, contract, relation)?;
    }
    Ok(())
}

pub(crate) struct Receipt {
    pub hash: String,
    pub body: String,
}
#[derive(Clone, Copy)]
pub(crate) enum ReceiptKind {
    Command,
    Batch,
}
pub(crate) fn receipt(
    db: &Connection,
    kind: ReceiptKind,
    scope: &Scope,
    actor: &str,
    id: &str,
) -> Result<Option<Receipt>> {
    let sql = match kind {
        ReceiptKind::Command => {
            "SELECT payload_hash,body FROM receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4"
        }
        ReceiptKind::Batch => {
            "SELECT payload_hash,body FROM batch_receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND batch_id=?4"
        }
    };
    Ok(db
        .query_row(
            sql,
            params![scope.workspace_id, scope.home_id, actor, id],
            |r| {
                Ok(Receipt {
                    hash: r.get(0)?,
                    body: r.get(1)?,
                })
            },
        )
        .optional()?)
}
pub(crate) fn write_receipt(
    db: &Connection,
    kind: ReceiptKind,
    scope: &Scope,
    actor: &str,
    id: &str,
    hash: &str,
    body: &str,
) -> Result<()> {
    let sql = match kind {
        ReceiptKind::Command => "INSERT INTO receipts VALUES(?1,?2,?3,?4,?5,?6)",
        ReceiptKind::Batch => "INSERT INTO batch_receipts VALUES(?1,?2,?3,?4,?5,?6)",
    };
    db.execute(
        sql,
        params![scope.workspace_id, scope.home_id, actor, id, hash, body],
    )?;
    Ok(())
}
pub(crate) fn write_audit<C: Contract>(db: &Connection, contract: &C, audit: &Audit) -> Result<()> {
    db.execute(
        "INSERT INTO audits(workspace_id,home_id,record_id,audit_id,body) VALUES(?1,?2,?3,?4,?5)",
        params![
            audit.workspace_id,
            audit.home_id,
            audit.record.record_id,
            audit.audit_id,
            json(contract, audit)?
        ],
    )?;
    Ok(())
}
