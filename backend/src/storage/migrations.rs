use super::{CONTRACT_VERSION, Error, Result};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

pub const DATABASE_VERSION: u32 = 2;
pub const DATABASE_LINEAGE: &str = "houseatlas-rust-storage/1";
const MIGRATIONS: &[(u32, &str)] = &[
    (1, include_str!("../../migrations/0001_rust_core.sql")),
    (2, include_str!("../../migrations/0002_stock_intents.sql")),
];

pub(crate) fn sha256(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

pub(crate) fn migrate(connection: &mut Connection) -> Result<()> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let incompatible = || {
        Error::new(
            "schema-incompatible",
            "Database lineage or migration history is incompatible",
        )
    };
    let version: u32 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > DATABASE_VERSION {
        return Err(incompatible());
    }
    if version == 0 {
        // Literal SQLite internal prefix, including views/triggers/indexes in the
        // unknown-object check. A legacy JS database is never silently adopted.
        let existing: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*')",
            [],
            |r| r.get(0),
        )?;
        if existing {
            return Err(incompatible());
        }
    } else {
        let validate = || -> rusqlite::Result<bool> {
            let rows = tx
                .prepare("SELECT version,sha256 FROM atlas_rust_migrations ORDER BY version")?
                .query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let metadata = |key| {
                tx.query_row(
                    "SELECT value FROM atlas_rust_metadata WHERE key=?1",
                    [key],
                    |r| r.get::<_, String>(0),
                )
                .optional()
            };
            Ok(rows
                == MIGRATIONS
                    .iter()
                    .filter(|(v, _)| *v <= version)
                    .map(|(v, sql)| (*v, sha256(sql)))
                    .collect::<Vec<_>>()
                && metadata("lineage")?.as_deref() == Some(DATABASE_LINEAGE)
                && metadata("contractVersion")?.as_deref() == Some(CONTRACT_VERSION))
        };
        if !validate().map_err(|_| incompatible())? {
            return Err(incompatible());
        }
    }
    for (next, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > version) {
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO atlas_rust_migrations VALUES(?1,?2)",
            rusqlite::params![next, sha256(sql)],
        )?;
        tx.pragma_update(None, "user_version", next)?;
    }
    tx.commit()?;
    Ok(())
}
