//! Private fixed SQL for trusted source/cache operations. No provider transport.
use super::{repository as repo, *};
use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Registration-only catalog cut. No projection/cache-status table is read.
/// Every selected text column is gated in SQLite before copying into Rust.
pub(crate) fn catalog_registrations<C: Contract>(
    db: &Connection,
    contract: &C,
    scope: &Scope,
    budget: &crate::catalog_budget::Budget,
) -> crate::catalog_budget::Result<Vec<SourceRegistration>> {
    use crate::catalog_budget::{MAX_CANDIDATES, MAX_REGISTRATION_BYTES, Unavailable};
    budget.check()?;
    let mut statement = db.prepare(
        "SELECT CASE WHEN length(CAST(body AS BLOB)) BETWEEN 1 AND 65536 THEN body ELSE NULL END,
                CASE WHEN length(CAST(source_instance_id AS BLOB))=36 THEN source_instance_id ELSE NULL END,
                CASE WHEN length(CAST(collection_id AS BLOB)) BETWEEN 1 AND 16384 THEN collection_id ELSE NULL END
         FROM sources WHERE workspace_id=?1 AND home_id=?2
         ORDER BY source_instance_id,collection_id LIMIT 65"
    ).map_err(|_| Unavailable)?;
    budget.check()?;
    let mut rows = statement.query(params![scope.workspace_id, scope.home_id])
        .map_err(|_| Unavailable)?;
    budget.check()?;
    let mut registrations = Vec::new();
    while let Some(row) = rows.next().map_err(|_| Unavailable)? {
        budget.check()?;
        if registrations.len() == MAX_CANDIDATES { return Err(Unavailable); }
        let body = row.get::<_, Option<String>>(0).map_err(|_| Unavailable)?.ok_or(Unavailable)?;
        let instance = row.get::<_, Option<String>>(1).map_err(|_| Unavailable)?.ok_or(Unavailable)?;
        let collection = row.get::<_, Option<String>>(2).map_err(|_| Unavailable)?.ok_or(Unavailable)?;
        if body.len() > MAX_REGISTRATION_BYTES { return Err(Unavailable); }
        budget.check()?;
        let value: Value = serde_json::from_str(&body).map_err(|_| Unavailable)?;
        budget.check()?;
        contract.validate_shape("sourceRegistration", &value).map_err(|_| Unavailable)?;
        budget.check()?;
        let registration: SourceRegistration = serde_json::from_value(value).map_err(|_| Unavailable)?;
        if registration.scope() != *scope || registration.source_instance_id != instance
            || registration.collection_id != collection
        { return Err(Unavailable); }
        budget.check()?;
        registrations.push(registration);
    }
    budget.check()?;
    Ok(registrations)
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use crate::catalog_budget::Budget;
    use crate::http::contracts::NativeContracts;

    fn scope() -> Scope {
        Scope { workspace_id: "10000000-0000-4000-8000-000000000001".into(),
            home_id: "10000000-0000-4000-8000-000000000002".into() }
    }
    fn registration(n: usize) -> SourceRegistration {
        SourceRegistration { workspace_id: scope().workspace_id, home_id: scope().home_id,
            source_instance_id: format!("10000000-0000-4000-8000-{n:012}"),
            collection_id: "Synthetic / α + %".into(), owner: SourceOwner::Homebox,
            partition_mode: PartitionMode::ExclusiveHome, allowed_external_ids: vec![] }
    }
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        // No records, projections, caches or network tables exist: successful
        // reads prove this seam needs registration metadata only.
        db.execute_batch("CREATE TABLE sources(workspace_id TEXT,home_id TEXT,source_instance_id TEXT,collection_id TEXT,body TEXT)").unwrap();
        db
    }
    fn insert(db: &Connection, row: &SourceRegistration) {
        db.execute("INSERT INTO sources VALUES(?1,?2,?3,?4,?5)", params![
            row.workspace_id, row.home_id, row.source_instance_id, row.collection_id,
            serde_json::to_string(row).unwrap()
        ]).unwrap();
    }
    #[test]
    fn never_published_targets_scope_and_candidate_cap_need_no_projection_rows() {
        let db = database();
        for n in 1..=64 { insert(&db, &registration(n)); }
        let mut foreign = registration(99);
        foreign.home_id = "10000000-0000-4000-8000-000000000003".into();
        insert(&db, &foreign);
        let rows = catalog_registrations(&db, &NativeContracts, &scope(), &Budget::start()).unwrap();
        assert_eq!(rows.len(), 64);
        assert_eq!(rows[0], registration(1));
        insert(&db, &registration(65));
        assert!(catalog_registrations(&db, &NativeContracts, &scope(), &Budget::start()).is_err());
    }
    #[test]
    fn oversized_registration_and_body_key_mismatch_are_not_empty_success() {
        let db = database();
        insert(&db, &registration(1));
        db.execute("UPDATE sources SET body=?1", ["x".repeat(65_537)]).unwrap();
        assert!(catalog_registrations(&db, &NativeContracts, &scope(), &Budget::start()).is_err());
        db.execute("UPDATE sources SET body=?1", [serde_json::to_string(&registration(2)).unwrap()]).unwrap();
        assert!(catalog_registrations(&db, &NativeContracts, &scope(), &Budget::start()).is_err());
    }
}

fn body<T: DeserializeOwned>(db: &Connection, sql: &str, p: &SourcePartition) -> Result<Option<T>> {
    let body: Option<String> = db
        .query_row(
            sql,
            params![
                p.workspace_id,
                p.home_id,
                p.source_instance_id,
                p.collection_id
            ],
            |r| r.get(0),
        )
        .optional()?;
    body.map(|b| serde_json::from_str(&b).map_err(Error::from))
        .transpose()
}
pub(crate) fn source(db: &Connection, p: &SourcePartition) -> Result<SourceRegistration> {
    body(db,"SELECT body FROM sources WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",p)?
        .ok_or(Error::new("not-found", "Registered source unavailable"))
}
pub(crate) fn cache(db: &Connection, p: &SourcePartition) -> Result<Option<CacheStatus>> {
    body(
        db,
        "SELECT body FROM caches WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",
        p,
    )
}
pub(crate) fn publication_state(
    db: &Connection,
    p: &SourcePartition,
) -> Result<CachePublicationState> {
    source(db, p)?;
    let rows = |sql| -> Result<Vec<Value>> {
        db.prepare(sql)?
            .query_map(
                params![
                    p.workspace_id,
                    p.home_id,
                    p.source_instance_id,
                    p.collection_id
                ],
                |r| r.get::<_, String>(0),
            )?
            .map(|r| serde_json::from_str(&r?).map_err(Error::from))
            .collect()
    };
    Ok(CachePublicationState {
        cache: cache(db, p)?,
        cache_epoch: epoch(db, p)?,
        homebox_entities: rows(
            "SELECT body FROM projections WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4 ORDER BY rowid",
        )?,
        network_relations: rows(
            "SELECT body FROM network_relations WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4 ORDER BY rowid",
        )?,
    })
}
pub(crate) fn epoch(db: &Connection, p: &SourcePartition) -> Result<u64> {
    let epoch: Option<i64> = db.query_row("SELECT epoch FROM cache_epochs WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",
        params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id],|r| r.get(0)).optional()?;
    let value = u64::try_from(epoch.ok_or(Error::new(
        "not-found",
        "Registered cache partition unavailable",
    ))?)
    .map_err(|_| Error::new("schema-incompatible", "Cache epoch is incompatible"))?;
    if value > MAX_REVISION {
        return Err(Error::new(
            "schema-incompatible",
            "Cache epoch is incompatible",
        ));
    }
    Ok(value)
}
pub(crate) fn advance_epoch(db: &Connection, p: &SourcePartition) -> Result<()> {
    let prior = epoch(db, p)?;
    if prior == MAX_REVISION {
        return Err(Error::new("invalid-transition", "Cache epoch exhausted"));
    }
    let count=db.execute("UPDATE cache_epochs SET epoch=epoch+1 WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4 AND epoch=?5",
        params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id,prior as i64])?;
    if count != 1 {
        return Err(Error::new(
            "guard-conflict",
            "Cache epoch changed during transaction",
        ));
    }
    Ok(())
}
pub(crate) fn write_source<C: Contract>(
    db: &Connection,
    contract: &C,
    source: &Value,
) -> Result<()> {
    let p = repo::partition(source)?;
    db.execute(
        "INSERT INTO sources VALUES(?1,?2,?3,?4,?5)",
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id,
            repo::json(contract, source)?
        ],
    )?;
    db.execute(
        "INSERT INTO cache_epochs VALUES(?1,?2,?3,?4,0)",
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id
        ],
    )?;
    Ok(())
}
pub(crate) fn write_cache<C: Contract>(db: &Connection, contract: &C, cache: &Value) -> Result<()> {
    let p = repo::partition(cache)?;
    db.execute("INSERT INTO caches VALUES(?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,home_id,source_instance_id,collection_id) DO UPDATE SET body=excluded.body",
        params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id,repo::json(contract,cache)?])?;
    Ok(())
}
pub(crate) fn generation_reserved(db: &Connection, p: &SourcePartition, id: &str) -> Result<bool> {
    Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM cache_generations WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4 AND generation_id=?5)",
        params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id,id],|r| r.get(0))?)
}
pub(crate) fn reserve_generation(db: &Connection, p: &SourcePartition, id: &str) -> Result<()> {
    db.execute(
        "INSERT INTO cache_generations VALUES(?1,?2,?3,?4,?5)",
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id,
            id
        ],
    )?;
    Ok(())
}
/// Projection bodies retain the provider's exact JSON numbers. They are not
/// mutation digests or receipts, which still use the published JCS contract.
pub(crate) fn projection_json(row: &Value) -> Result<String> {
    Ok(serde_json::to_string(row)?)
}
pub(crate) fn write_homebox(db: &Connection, row: &Value) -> Result<()> {
    let source = &row["source"];
    db.execute(
        "INSERT INTO projections VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            repo::string(row, "workspaceId")?,
            repo::string(row, "homeId")?,
            repo::string(source, "sourceInstanceId")?,
            repo::string(source, "collectionId")?,
            repo::string(source, "externalId")?,
            projection_json(row)?
        ],
    )?;
    Ok(())
}
pub(crate) fn write_network<C: Contract>(db: &Connection, contract: &C, row: &Value) -> Result<()> {
    let p = repo::partition(row)?;
    db.execute(
        "INSERT INTO network_relations VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            p.workspace_id,
            p.home_id,
            p.source_instance_id,
            p.collection_id,
            repo::string(row, "externalId")?,
            repo::json(contract, row)?
        ],
    )?;
    Ok(())
}
pub(crate) fn replace_projections<C: Contract>(
    db: &Connection,
    contract: &C,
    p: &SourcePartition,
    homebox: &[Value],
    network: &[Value],
) -> Result<()> {
    db.execute("DELETE FROM projections WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id])?;
    db.execute("DELETE FROM network_relations WHERE workspace_id=?1 AND home_id=?2 AND source_instance_id=?3 AND collection_id=?4",params![p.workspace_id,p.home_id,p.source_instance_id,p.collection_id])?;
    for row in homebox {
        write_homebox(db, row)?;
    }
    for row in network {
        write_network(db, contract, row)?;
    }
    Ok(())
}
