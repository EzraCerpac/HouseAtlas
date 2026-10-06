//! Private fixed SQL for trusted source/cache operations. No provider transport.
use super::{repository as repo, *};
use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::Value;

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
pub(crate) fn write_homebox<C: Contract>(db: &Connection, contract: &C, row: &Value) -> Result<()> {
    let source = &row["source"];
    db.execute(
        "INSERT INTO projections VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            repo::string(row, "workspaceId")?,
            repo::string(row, "homeId")?,
            repo::string(source, "sourceInstanceId")?,
            repo::string(source, "collectionId")?,
            repo::string(source, "externalId")?,
            repo::json(contract, row)?
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
        write_homebox(db, contract, row)?;
    }
    for row in network {
        write_network(db, contract, row)?;
    }
    Ok(())
}
