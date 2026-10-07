//! Native SQLite retained sidecar. Separate from Atlas cache/publication storage.
//! It commits immutable generation rows before the host publishes their pointer.
use super::sidecar::{MAX_PACKET_BYTES, MAX_ROW_BYTES, MAX_ROWS};
use super::{
    model::{Result, guard},
    projection::validate_registration,
    *,
};
use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use std::{collections::BTreeSet, path::Path};

pub struct SqliteNetworkSidecar {
    db: Connection,
    sources: Vec<SourceRegistration>,
}
pub struct DurableNetworkReceipt {
    partition_key: String,
    generation_id: String,
    sha256: String,
}
impl DurableNetworkReceipt {
    pub fn partition_key(&self) -> &str {
        &self.partition_key
    }
    pub fn generation_id(&self) -> &str {
        &self.generation_id
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}
impl SqliteNetworkSidecar {
    /// Trusted private host path and immutable source registry, never browser
    /// input. Native SQLite FULL/WAL commits supply the durable stage boundary.
    pub fn open(path: &Path, sources: &[SourceRegistration]) -> Result<Self> {
        let mut keys = BTreeSet::new();
        for source in sources {
            validate_registration(source)?;
            guard(keys.insert(partition_key(&source.scope)?))?;
        }
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            guard(meta.is_file() && !meta.file_type().is_symlink())?;
        }
        let db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(sql_error)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(sql_error)?;
        let tables: Vec<String> = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(sql_error)?
            .query_map([], |r| r.get(0))
            .map_err(sql_error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(sql_error)?;
        if !tables.is_empty() {
            guard(
                tables.len() == 2
                    && tables.iter().any(|v| v == "core_network_meta")
                    && tables.iter().any(|v| v == "core_network_generations"),
            )?;
            let versions: Vec<i64> = db
                .prepare("SELECT version FROM core_network_meta")
                .map_err(sql_error)?
                .query_map([], |r| r.get(0))
                .map_err(sql_error)?
                .collect::<std::result::Result<_, _>>()
                .map_err(sql_error)?;
            guard(versions == [1])?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
            CREATE TABLE IF NOT EXISTS core_network_meta(version INTEGER PRIMARY KEY CHECK(version=1));
            INSERT OR IGNORE INTO core_network_meta VALUES(1);
            CREATE TABLE IF NOT EXISTS core_network_generations(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(partition_key,generation_id));
            CREATE TRIGGER IF NOT EXISTS core_network_no_update BEFORE UPDATE ON core_network_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;
            CREATE TRIGGER IF NOT EXISTS core_network_no_delete BEFORE DELETE ON core_network_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;").map_err(sql_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| NetworkError::new(ErrorCode::Upstream))?;
        }
        Ok(Self {
            db,
            sources: sources.to_vec(),
        })
    }
    pub fn close(self) -> Result<()> {
        self.db
            .close()
            .map_err(|_| NetworkError::new(ErrorCode::Upstream))
    }
}
impl DurableNetworkSidecar for SqliteNetworkSidecar {
    type Receipt = DurableNetworkReceipt;
    fn stage(&mut self, source: &SourceRegistration, row: &SidecarRow) -> Result<Self::Receipt> {
        guard(
            self.sources.iter().any(|v| v == source)
                && row.partition_key == partition_key(&source.scope)?,
        )?;
        validate_sidecar_packet(
            &SidecarPacket {
                format: SIDECAR_FORMAT.into(),
                rows: vec![row.clone()],
            },
            &self.sources,
        )?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        bound_stored_rows(&tx)?;
        let mut rows: Vec<SidecarRow> = tx.prepare("SELECT partition_key,generation_id,sha256,body FROM core_network_generations ORDER BY partition_key,generation_id").map_err(sql_error)?
            .query_map([], |r| Ok(SidecarRow { partition_key: r.get(0)?, generation_id: r.get(1)?, sha256: r.get(2)?, body: r.get(3)? })).map_err(sql_error)?
            .collect::<std::result::Result<_, _>>().map_err(sql_error)?;
        let existing = rows
            .iter()
            .find(|v| v.partition_key == row.partition_key && v.generation_id == row.generation_id);
        validate_immutable_replay(existing, row)?;
        if existing.is_none() {
            rows.push(row.clone());
            validate_sidecar_packet(
                &SidecarPacket {
                    format: SIDECAR_FORMAT.into(),
                    rows,
                },
                &self.sources,
            )?;
            tx.execute(
                "INSERT INTO core_network_generations VALUES(?1,?2,?3,?4)",
                params![row.partition_key, row.generation_id, row.sha256, row.body],
            )
            .map_err(sql_error)?;
        }
        tx.commit().map_err(sql_error)?;
        Ok(DurableNetworkReceipt {
            partition_key: row.partition_key.clone(),
            generation_id: row.generation_id.clone(),
            sha256: row.sha256.clone(),
        })
    }
    fn load(&self, source: &SourceRegistration, generation_id: &str) -> Result<SidecarRow> {
        guard(self.sources.iter().any(|v| v == source))?;
        bound_stored_rows(&self.db)?;
        let row = self.db.query_row("SELECT partition_key,generation_id,sha256,body FROM core_network_generations WHERE partition_key=?1 AND generation_id=?2",
            params![partition_key(&source.scope)?,generation_id], |r| Ok(SidecarRow { partition_key:r.get(0)?,generation_id:r.get(1)?,sha256:r.get(2)?,body:r.get(3)? })).map_err(sql_error)?;
        validate_sidecar_packet(
            &SidecarPacket {
                format: SIDECAR_FORMAT.into(),
                rows: vec![row.clone()],
            },
            &self.sources,
        )?;
        Ok(row)
    }
}
// Inspect SQLite lengths before materializing retained strings. The exact
// canonical-packet quota is still checked by validate_sidecar_packet at stage.
fn bound_stored_rows(db: &Connection) -> Result<()> {
    let (count, bytes, largest): (i64, i64, i64) = db.query_row(
        "SELECT COUNT(*),COALESCE(SUM(length(CAST(partition_key AS BLOB))+length(CAST(generation_id AS BLOB))+length(CAST(sha256 AS BLOB))+length(CAST(body AS BLOB))),0),COALESCE(MAX(length(CAST(body AS BLOB))),0) FROM core_network_generations",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(sql_error)?;
    if count > MAX_ROWS as i64 || bytes > MAX_PACKET_BYTES as i64 || largest > MAX_ROW_BYTES as i64
    {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    Ok(())
}
fn sql_error(_error: rusqlite::Error) -> NetworkError {
    NetworkError::new(ErrorCode::Upstream)
}
