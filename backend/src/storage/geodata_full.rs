//! Explicit full native v5 + Stock/Jobs + original Document profile.
//! The predecessor's 29 tables and inner ledger/metadata are never rewritten.
use super::{geodata::GeodataOwners, *};
use rusqlite::{
    Connection, OpenFlags,
    backup::{Backup, StepResult},
    params,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::Path,
};
pub const LINEAGE: &str = "houseatlas-rust-storage/geodata-full/1";
pub const VERSION: u32 = 1;
pub const CONTRACT: &str = "2.0.0";
pub(crate) const SQL: &str = include_str!("../../migrations/0001_geodata_full.sql");
const CORE: &[(u32, &str)] = &[
    (1, include_str!("../../migrations/0001_rust_core.sql")),
    (2, include_str!("../../migrations/0002_stock_intents.sql")),
    (3, include_str!("../../migrations/0003_queue.sql")),
    (
        4,
        include_str!("../../migrations/0004_stock_history_lookup.sql"),
    ),
    (
        5,
        include_str!("../../migrations/0005_upload_consumption.sql"),
    ),
];
fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Full native Document profile is incompatible",
    )
}
fn need(b: bool) -> Result<()> {
    if b { Ok(()) } else { Err(incompatible()) }
}
fn catalog(db: &Connection) -> Result<Vec<(String, String, String, String)>> {
    Ok(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<rusqlite::Result<_>>()?)
}
fn inner_reference() -> Result<Connection> {
    let db = Connection::open_in_memory()?;
    for (version, sql) in CORE {
        db.execute_batch(sql)?;
        db.execute(
            "INSERT INTO atlas_rust_migrations VALUES(?1,?2)",
            params![version, migrations::sha256(sql)],
        )?;
    }
    db.pragma_update(None, "user_version", 5)?;
    Ok(db)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversionReceipt {
    pub format: String,
    pub conversion_id: String,
    pub source_lineage: String,
    pub source_schema: u32,
    pub source_contract: String,
    pub source_database_sha256: String,
    pub source_database_bytes: u64,
    pub retained_rows_sha256: String,
    pub target_lineage: String,
}
pub(crate) fn conversion_receipt(db: &Connection) -> Result<(String, ConversionReceipt)> {
    let rows = db
        .prepare("SELECT id,sha256,body FROM atlas_full_conversion")?
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    need(rows.len() == 1 && rows[0].0 == 1)?;
    let (digest, body) = (&rows[0].1, &rows[0].2);
    let value = crate::contracts::v2::parse_value(body.as_bytes()).map_err(|_| incompatible())?;
    need(serde_jcs::to_string(&value)? == *body && migrations::sha256(body) == *digest)?;
    let receipt: ConversionReceipt = serde_json::from_value(value)?;
    fn hash(s: &str) -> bool {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }
    need(
        receipt.format == "houseatlas-native-full-conversion/1"
            && receipt.source_lineage == DATABASE_LINEAGE
            && receipt.source_schema == 5
            && receipt.source_contract == "1.0.0"
            && receipt.target_lineage == LINEAGE
            && receipt.source_database_bytes > 0
            && receipt.source_database_bytes <= 64 * 1024 * 1024
            && hash(&receipt.source_database_sha256)
            && hash(&receipt.retained_rows_sha256),
    )?;
    let identity = serde_jcs::to_string(
        &serde_json::json!({"sourceDatabaseSha256":receipt.source_database_sha256,"retainedRowsSha256":receipt.retained_rows_sha256,"targetLineage":LINEAGE}),
    )?;
    need(receipt.conversion_id == migrations::sha256(&identity))?;
    Ok((digest.clone(), receipt))
}
pub(crate) fn validate_catalog(db: &Connection) -> Result<()> {
    let reference = inner_reference()?;
    reference.execute_batch(SQL)?;
    need(catalog(db)? == catalog(&reference)?)?;
    need(db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? == 5)?;
    for table in [
        "atlas_rust_metadata",
        "atlas_rust_migrations",
        "atlas_full_metadata",
    ] {
        let sql = match table {
            "atlas_rust_metadata" => "SELECT key,value FROM atlas_rust_metadata ORDER BY key",
            "atlas_full_metadata" => "SELECT key,value FROM atlas_full_metadata ORDER BY key",
            _ => "SELECT version,sha256 FROM atlas_rust_migrations ORDER BY version",
        };
        need(exact_rows(db, sql)? == exact_rows(&reference, sql)?)?;
    }
    let rows = db
        .prepare("SELECT version,sha256 FROM atlas_full_migrations ORDER BY version")?
        .query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    need(rows == vec![(VERSION, migrations::sha256(SQL))])?;
    conversion_receipt(db)?;
    Ok(())
}
fn exact_rows(db: &Connection, sql: &str) -> Result<Vec<Vec<rusqlite::types::Value>>> {
    let mut st = db.prepare(sql)?;
    let n = st.column_count();
    Ok(st
        .query_map([], |r| (0..n).map(|i| r.get(i)).collect())?
        .collect::<rusqlite::Result<_>>()?)
}
/// Detached report only. It grants neither a live source nor queue authority.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FullProfileCopyReport {
    pub format: String,
    pub source_database_sha256: String,
    pub source_database_bytes: u64,
    pub target_database_sha256: String,
    pub target_database_bytes: u64,
    pub target_lineage: String,
    pub outer_schema: u32,
    pub preserved_tables: Vec<String>,
    pub retained_rows_sha256: String,
    pub conversion_receipt_sha256: String,
}
fn closed(path: &Path) -> Result<(File, u64, u64)> {
    let pin = super::store::ClosedSource::open(path, &mut || Ok(()))?;
    pin.require_delete()?;
    let file = File::from(
        rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| incompatible())?,
    );
    let m = file.metadata().map_err(|_| incompatible())?;
    Ok((file, m.dev(), m.ino()))
}
fn file_digest(file: &mut File, check: &mut dyn FnMut() -> Result<()>) -> Result<(String, u64)> {
    use sha2::{Digest, Sha256};
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(|_| incompatible())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut block = [0u8; 65536];
    loop {
        check()?;
        let n = file.read(&mut block).map_err(|_| incompatible())?;
        if n == 0 {
            break;
        }
        size = size.checked_add(n as u64).ok_or_else(incompatible)?;
        need(size <= 256 * 1024 * 1024)?;
        hash.update(&block[..n]);
    }
    Ok((format!("{:x}", hash.finalize()), size))
}
fn retained_rows(
    db: &Connection,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<(Vec<String>, String)> {
    use rusqlite::types::ValueRef;
    use sha2::{Digest, Sha256};
    let names=inner_reference()?.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name")?.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    need(names.len() == 29)?;
    let mut hash = Sha256::new();
    let mut all_names = names.clone();
    all_names.extend(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'sqlite_*' AND name != 'sqlite_schema' ORDER BY name")?.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?);
    for name in &all_names {
        check()?;
        hash.update((name.len() as u64).to_be_bytes());
        hash.update(name.as_bytes());
        let mut st = db.prepare(&format!("SELECT rowid,* FROM {name} ORDER BY rowid"))?;
        let columns = st.column_count();
        let mut rows = st.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            hash.update([0xff]);
            for i in 0..columns {
                match row.get_ref(i)? {
                    ValueRef::Null => hash.update([0]),
                    ValueRef::Integer(n) => {
                        hash.update([1]);
                        hash.update(n.to_be_bytes());
                    }
                    ValueRef::Real(n) => {
                        hash.update([2]);
                        hash.update(n.to_bits().to_be_bytes());
                    }
                    ValueRef::Text(b) => {
                        hash.update([3]);
                        hash.update((b.len() as u64).to_be_bytes());
                        hash.update(b);
                    }
                    ValueRef::Blob(b) => {
                        hash.update([4]);
                        hash.update((b.len() as u64).to_be_bytes());
                        hash.update(b);
                    }
                }
            }
        }
    }
    Ok((names, format!("{:x}", hash.finalize())))
}
pub(crate) fn legacy_assets(db: &Connection) -> Result<Vec<crate::media::types::AssetRecord>> {
    let mut records = std::collections::BTreeMap::new();
    for table in ["records", "receipts", "batch_receipts"] {
        let sql = match table {
            "records" => "SELECT body FROM records",
            "receipts" => "SELECT body FROM receipts",
            _ => "SELECT body FROM batch_receipts",
        };
        for body in db.prepare(sql)?.query_map([], |r| r.get::<_, String>(0))? {
            let value: serde_json::Value = serde_json::from_str(&body?)?;
            let results = if table == "records" {
                vec![&value]
            } else if table == "receipts" {
                vec![&value["record"]]
            } else {
                value
                    .as_array()
                    .ok_or_else(incompatible)?
                    .iter()
                    .map(|v| &v["record"])
                    .collect()
            };
            for r in results {
                if r["recordType"] == "asset" {
                    let a: crate::media::types::AssetRecord = serde_json::from_value(r.clone())?;
                    records.insert(
                        (
                            a.workspace_id.clone(),
                            a.record_id.clone(),
                            a.revision,
                            a.payload.sha256.clone(),
                        ),
                        a,
                    );
                }
            }
        }
    }
    Ok(records.into_values().collect())
}
pub(crate) fn retained_bytes(
    record: &crate::media::types::AssetRecord,
    vault: &crate::media::AssetVault,
    budget: &crate::media::WorkBudget,
) -> Result<Option<Vec<u8>>> {
    use crate::media::{MediaError, types::Availability};
    if record.payload.availability != Availability::Available
        && record.payload.storage_key
            != record
                .scope()
                .storage_key(&record.payload.sha256)
                .map_err(|_| incompatible())?
    {
        return Ok(None);
    }
    match vault.read_retained(record, budget) {
        Ok(b) => Ok(Some(b)),
        Err(MediaError::NotFound) if record.payload.availability == Availability::Missing => {
            Ok(None)
        }
        Err(_) => Err(Error::new(
            "asset-unavailable",
            "Retained predecessor bytes unavailable",
        )),
    }
}
pub(crate) fn validate_legacy_bytes(
    db: &Connection,
    vault: &crate::media::AssetVault,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let budget = crate::media::WorkBudget::new(
        std::time::Duration::from_secs(10),
        crate::media::Cancellation::default(),
    )
    .map_err(|_| incompatible())?;
    for record in legacy_assets(db)? {
        check()?;
        retained_bytes(&record, vault, &budget)?;
    }
    Ok(())
}
/// Explicit offline copy, never a startup migration. Source must be a selected
/// closed snapshot under its owner's fence. Caller supplies exact source hash
/// and complete independent peers; no registry or media claims are inferred.
#[allow(clippy::too_many_arguments)]
pub fn copy_v5_to_full<
    C: Contract,
    S: crate::domain::stock::StockContractPort,
    D: QueueDiscovery,
    E: QueueRecoveryEvidence,
>(
    source: &Path,
    destination: &Path,
    expected_source_sha256: &str,
    contract: &C,
    peers: &RecoveryValidationPeers<'_, S, D, E>,
    owners: &GeodataOwners,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<FullProfileCopyReport> {
    let pin = super::store::ClosedSource::open(source, check)?;
    pin.require_delete()?;
    let (mut file, device, inode) = closed(source)?;
    let before = file_digest(&mut file, check)?;
    need(
        before.0 == expected_source_sha256 && pin.sha256() == before.0 && pin.bytes() == before.1,
    )?;
    let mut uri = url::Url::from_file_path(source).map_err(|_| incompatible())?;
    uri.query_pairs_mut()
        .append_pair("mode", "ro")
        .append_pair("immutable", "1");
    let db = Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    super::store::validate_v5_full_peers(&db, contract, peers, check)?;
    validate_legacy_bytes(&db, owners.vault(), check)?;
    let expected = retained_rows(&db, check)?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(destination)
        .map_err(|_| incompatible())?;
    let target = destination.join("atlas.sqlite");
    drop(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&target)
            .map_err(|_| incompatible())?,
    );
    let mut copy = Connection::open(&target)?;
    {
        let backup = Backup::new(&db, &mut copy)?;
        loop {
            check()?;
            match backup.step(128)? {
                StepResult::Done => break,
                StepResult::More => {}
                _ => {
                    return Err(Error::new(
                        "storage-unavailable",
                        "Closed source copy unavailable",
                    ));
                }
            }
        }
    }
    copy.execute_batch("PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;")?;
    let tx = copy.transaction()?;
    tx.execute_batch(SQL)?;
    tx.execute(
        "INSERT INTO atlas_full_migrations VALUES(?1,?2)",
        params![VERSION, migrations::sha256(SQL)],
    )?;
    let identity = serde_jcs::to_string(
        &serde_json::json!({"sourceDatabaseSha256":before.0,"retainedRowsSha256":expected.1,"targetLineage":LINEAGE}),
    )?;
    let ancestry = ConversionReceipt {
        format: "houseatlas-native-full-conversion/1".into(),
        conversion_id: migrations::sha256(&identity),
        source_lineage: DATABASE_LINEAGE.into(),
        source_schema: 5,
        source_contract: "1.0.0".into(),
        source_database_sha256: before.0.clone(),
        source_database_bytes: before.1,
        retained_rows_sha256: expected.1.clone(),
        target_lineage: LINEAGE.into(),
    };
    let body = serde_jcs::to_string(&ancestry)?;
    let ancestry_sha = migrations::sha256(&body);
    tx.execute(
        "INSERT INTO atlas_full_conversion VALUES(1,?1,?2)",
        params![ancestry_sha, body],
    )?;
    need(retained_rows(&tx, check)? == expected)?;
    super::store::validate_geodata_full_core(&tx, contract, peers, check)?;
    let budget = crate::media::WorkBudget::new(
        std::time::Duration::from_secs(10),
        crate::media::Cancellation::default(),
    )
    .map_err(|_| incompatible())?;
    owners.recovery(&tx).validate_document_closure(&budget)?;
    tx.commit()?;
    let target_vault =
        crate::media::AssetVault::open(&destination.join("media")).map_err(|_| incompatible())?;
    let media_budget = crate::media::WorkBudget::new(
        std::time::Duration::from_secs(10),
        crate::media::Cancellation::default(),
    )
    .map_err(|_| incompatible())?;
    for record in legacy_assets(&db)? {
        check()?;
        if let Some(bytes) = retained_bytes(&record, owners.vault(), &media_budget)? {
            target_vault
                .restore_retained(&record, &bytes, &media_budget)
                .map_err(|_| incompatible())?;
        }
    }
    validate_legacy_bytes(&copy, &target_vault, check)?;
    copy.pragma_update(None, "journal_mode", "DELETE")?;
    copy.close().map_err(|(_, e)| Error::from(e))?;
    pin.check(check)?;
    let current = fs::symlink_metadata(source).map_err(|_| incompatible())?;
    need(
        current.dev() == device
            && current.ino() == inode
            && file_digest(&mut file, check)? == before,
    )?;
    let (mut target_file, _, _) = closed(&target)?;
    let after = file_digest(&mut target_file, check)?;
    target_file.sync_all().map_err(|_| incompatible())?;
    File::open(destination)
        .and_then(|f| f.sync_all())
        .map_err(|_| incompatible())?;
    Ok(FullProfileCopyReport {
        format: "houseatlas-native-full-profile-copy/1".into(),
        source_database_sha256: before.0,
        source_database_bytes: before.1,
        target_database_sha256: after.0,
        target_database_bytes: after.1,
        target_lineage: LINEAGE.into(),
        outer_schema: VERSION,
        preserved_tables: expected.0,
        retained_rows_sha256: expected.1,
        conversion_receipt_sha256: ancestry_sha,
    })
}
