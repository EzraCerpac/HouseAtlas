//! Distinct, explicitly selected outer catalog. No installer/startup conversion.
//! All SQL access is private to children of the original Store module.
use super::super::{Error, Result};
use crate::contracts::measurement_assertions as wire;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::sync::Arc;

pub const MEASUREMENT_LINEAGE: &str = "houseatlas-rust-storage/geodata-measurements/1";
pub const MEASUREMENT_CATALOG_VERSION: u32 = 1;
pub const MEASUREMENT_CONTRACT: &str = "1.0.0";
pub const MEASUREMENT_RECOVERY_FORMAT: &str = "houseatlas-native-geodata-measurements-recovery/1";
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MeasurementProfileSelection {
    #[default]
    Disabled,
    MeasurementsV1,
}
/// Issued only by the explicit strict same-handle opener after complete native,
/// Document, measurement and media qualification. No public field/constructor.
#[derive(Clone)]
pub struct MeasurementProfileIdentity {
    pub(super) instance: Arc<()>,
}
pub(super) const INPUTS: &[(&str, &str)] = &[
    (
        "backend/migrations/0001_rust_core.sql",
        include_str!("../../migrations/0001_rust_core.sql"),
    ),
    (
        "backend/migrations/0002_stock_intents.sql",
        include_str!("../../migrations/0002_stock_intents.sql"),
    ),
    (
        "backend/migrations/0003_queue.sql",
        include_str!("../../migrations/0003_queue.sql"),
    ),
    (
        "backend/migrations/0004_stock_history_lookup.sql",
        include_str!("../../migrations/0004_stock_history_lookup.sql"),
    ),
    (
        "backend/migrations/0005_upload_consumption.sql",
        include_str!("../../migrations/0005_upload_consumption.sql"),
    ),
    (
        "backend/migrations/0001_geodata_full.sql",
        include_str!("../../migrations/0001_geodata_full.sql"),
    ),
    (
        "backend/migrations/0001_geodata_measurements.sql",
        include_str!("../../migrations/0001_geodata_measurements.sql"),
    ),
];
fn invalid() -> Error {
    Error::new("schema-incompatible", "Measurement catalog is incompatible")
}
fn require(ok: bool) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn sha(bytes: impl AsRef<[u8]>) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}
pub fn measurement_catalog_pin() -> Result<String> {
    let ddl: Vec<Value> = INPUTS
        .iter()
        .map(|(path, sql)| json!({"path":path,"sha256":sha(sql.as_bytes())}))
        .collect();
    wire::digest(&json!({"domain":"houseatlas.measurement-catalog/1","ddl":ddl}))
        .map_err(|_| invalid())
}
fn catalog(db: &Connection) -> Result<Vec<(String, String, String, String)>> {
    Ok(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")?
        .query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<rusqlite::Result<_>>()?)
}
fn metadata(db: &Connection, sql: &str) -> Result<Vec<(String, String)>> {
    Ok(db
        .prepare(sql)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}
/// Only a fresh IN-MEMORY reference receives DDL here. The supplied dataset
/// remains read-only; no unknown table or old-profile mismatch is ignored.
pub(super) fn validate_catalog(db: &Connection) -> Result<()> {
    let reference = Connection::open_in_memory()?;
    for (index, (_, sql)) in INPUTS.iter().enumerate() {
        reference.execute_batch(sql)?;
        if index < 5 {
            let ordinal = i64::try_from(index + 1).map_err(|_| invalid())?;
            reference.execute(
                "INSERT INTO atlas_rust_migrations VALUES(?1,?2)",
                params![ordinal, sha(sql.as_bytes())],
            )?;
        }
    }
    reference.pragma_update(None, "user_version", 5)?;
    reference.execute(
        "INSERT INTO atlas_full_migrations VALUES(1,?1)",
        params![sha(INPUTS[5].1.as_bytes())],
    )?;
    reference.execute(
        "INSERT INTO atlas_measurement_migrations VALUES(1,?1)",
        params![sha(INPUTS[6].1.as_bytes())],
    )?;
    reference.execute(
        "INSERT INTO atlas_measurement_metadata VALUES('catalogSha256',?1)",
        params![measurement_catalog_pin()?],
    )?;
    require(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? == 5
            && catalog(db)? == catalog(&reference)?,
    )?;
    for sql in [
        "SELECT key,value FROM atlas_rust_metadata ORDER BY key",
        "SELECT key,value FROM atlas_full_metadata ORDER BY key",
        "SELECT key,value FROM atlas_measurement_metadata ORDER BY key",
    ] {
        require(metadata(db, sql)? == metadata(&reference, sql)?)?;
    }
    for sql in [
        "SELECT CAST(version AS TEXT),sha256 FROM atlas_rust_migrations ORDER BY version",
        "SELECT CAST(version AS TEXT),sha256 FROM atlas_full_migrations ORDER BY version",
        "SELECT CAST(version AS TEXT),sha256 FROM atlas_measurement_migrations ORDER BY version",
    ] {
        require(metadata(db, sql)? == metadata(&reference, sql)?)?;
    }
    // Preserve authentic native-v5 -> full-Document ancestry. A measurement
    // declaration cannot create/replace this receipt or reinterpret its target.
    super::super::geodata_full::conversion_receipt(db)?;
    reference.close().map_err(|(_, e)| Error::from(e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // FROZEN/UNREGISTERED/UNEXECUTED. Source identity only, not image acceptance.
    #[test]
    fn measurement_selection_defaults_disabled_and_keeps_reserved_profiles() {
        assert_eq!(
            MeasurementProfileSelection::default(),
            MeasurementProfileSelection::Disabled
        );
        assert_eq!(super::super::super::DATABASE_VERSION, 5);
        assert_eq!(super::super::super::STOCK_ACTIVITY_DATABASE_VERSION, 6);
        assert_eq!(MEASUREMENT_CATALOG_VERSION, 1);
        assert_eq!(
            MEASUREMENT_LINEAGE,
            "houseatlas-rust-storage/geodata-measurements/1"
        );
        assert_eq!(super::super::super::geodata_full::CONTRACT, "2.0.0");
    }
    #[test]
    fn catalog_pin_covers_ordered_seven_ddl_inputs() {
        assert_eq!(INPUTS.len(), 7);
        assert_eq!(
            measurement_catalog_pin().unwrap(),
            "06d37cd0ebdec502a700f25575ebee23868e52381d0270e2c0b322a360c0475c"
        );
    }
}
