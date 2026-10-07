//! Storage-owned capture and read-only verification.
//! No SQL handle escapes.
use super::super::{migrations, *};
use super::AtlasStore;
#[path = "recovery_checks.rs"]
mod checks;
use rusqlite::{
    Connection, OpenFlags,
    backup::{Backup, StepResult},
};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryImage {
    pub contract_version: String,
    pub database_lineage: String,
    pub database_schema: u32,
    /// Every retained asset, including tombstones and unavailable originals.
    /// Physical bytes, closed-image hashing and publication remain AT12-owned.
    pub assets: Vec<Record>,
}

fn unavailable() -> Error {
    Error::new(
        "storage-unavailable",
        "Recovery image operation could not complete",
    )
}
// Check standalone DELETE headers before SQLite opens protected staging bytes.
// SQLite fileformat.html#file_format_version_numbers defines offsets 18/19.
fn standalone_header(database: &Path) -> Result<()> {
    if !fs::symlink_metadata(database)
        .map_err(|_| unavailable())?
        .file_type()
        .is_file()
    {
        return Err(checks::incompatible());
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = database.as_os_str().to_os_string();
        name.push(suffix);
        match fs::symlink_metadata(PathBuf::from(name)) {
            Err(error) if error.kind() == ErrorKind::NotFound => (),
            Ok(_) => return Err(checks::incompatible()),
            Err(_) => return Err(unavailable()),
        }
    }
    let mut header = [0_u8; 100];
    File::open(database)
        .map_err(|_| unavailable())?
        .read_exact(&mut header)
        .map_err(|_| checks::incompatible())?;
    if &header[..16] != b"SQLite format 3\0" || header[18] != 1 || header[19] != 1 {
        return Err(checks::incompatible());
    }
    Ok(())
}

/// Checks progress between SQLite/native calls. A single synchronous contract
/// or authorization call must itself be bounded by its owner; it cannot be
/// interrupted by this helper.
fn checkpoint(deadline: Instant, check: &mut dyn FnMut() -> Result<()>) -> Result<()> {
    if Instant::now() >= deadline {
        return Err(unavailable());
    }
    check()?;
    if Instant::now() >= deadline {
        return Err(unavailable());
    }
    Ok(())
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn backup_recovery_to(
        &mut self,
        destination: &Path,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        let deadline = Instant::now() + Duration::from_secs(30);
        checkpoint(deadline, check)?;
        // Caller supplies a trusted private staging directory. create_new does
        // not make an attacker-writable parent directory safe.
        let mut reservation = OpenOptions::new();
        reservation.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            reservation.mode(0o600);
        }
        let file = reservation.open(destination).map_err(|_| unavailable())?;
        drop(file);
        // Open the already-reserved destination only; never reopen the source.
        let mut copy = Connection::open_with_flags(
            destination,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        copy.busy_timeout(Duration::ZERO)?;
        copy.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")?;
        let copied = (|| -> Result<()> {
            let backup = Backup::new(&self.db, &mut copy)?;
            loop {
                checkpoint(deadline, check)?;
                match backup.step(128)? {
                    StepResult::Done => break,
                    StepResult::More => (),
                    // No retry/sleep loop or concurrency qualification claim.
                    StepResult::Busy | StepResult::Locked => return Err(unavailable()),
                    _ => return Err(unavailable()),
                }
            }
            Ok(())
        })(); // Backup dropped before any use of destination connection.
        let prepared = copied.and_then(|()| {
            checkpoint(deadline, check)?;
            // Backup copies persistent mode from the source; restore the
            // standalone output mode only after its handle has been finished.
            let mode: String = copy.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
            if mode != "delete" {
                return Err(unavailable());
            }
            copy.pragma_update(None, "synchronous", "FULL")?;
            Ok(())
        });
        // Explicit close is attempted even if authorization/copy fails. The
        // caller retains its private staging tree for ordinary owned cleanup.
        let closed = copy.close().map_err(|(_, error)| Error::from(error));
        prepared?;
        closed?;
        Self::validate_recovery_image_bounded(&self.contract, destination, deadline, check)
    }

    pub fn validate_recovery_image(
        &self,
        database: &Path,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        Self::validate_recovery_image_bounded(
            &self.contract,
            database,
            Instant::now() + Duration::from_secs(30),
            check,
        )
    }

    /// Detached read-only validation. Requires no source store, creates no
    /// selected database, and performs no migration. Metadata is not authority.
    pub fn validate_existing_recovery_image(
        database: &Path,
        contract: &C,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        Self::validate_recovery_image_bounded(
            contract,
            database,
            Instant::now() + Duration::from_secs(30),
            check,
        )
    }

    /// Open an already closed, validated current-lineage image without CREATE
    /// or migration. Revalidates the same handle before enabling runtime WAL.
    /// The caller supplies fresh trusted authority/runtime and exclusively owns
    /// the selected path throughout; retained metadata supplies no grants.
    pub fn open_existing_recovery_image(
        database: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: super::StoreOptions,
        expected: &RecoveryImage,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Self> {
        if options.allow_synthetic_bootstrap || options.busy_timeout_ms > 60_000 {
            return Err(Error::new(
                "invalid-contract",
                "Existing storage options are incompatible",
            ));
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        checkpoint(deadline, check)?;
        standalone_header(database)?;
        // No SQLITE_OPEN_CREATE. Validation uses this same existing handle.
        let mut db = Connection::open_with_flags(
            database,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let prepared = (|| -> Result<()> {
            db.busy_timeout(Duration::ZERO)?;
            db.pragma_update(None, "query_only", true)?;
            let tx = db.transaction()?;
            let mode: String = tx.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
            if mode != "delete" {
                return Err(checks::incompatible());
            }
            let mut progress = || checkpoint(deadline, check);
            let actual = checks::validate_connection(&tx, &contract, &mut progress)?;
            if &actual != expected {
                return Err(checks::incompatible());
            }
            tx.commit()?;
            checkpoint(deadline, check)?;
            db.pragma_update(None, "query_only", false)?;
            db.busy_timeout(Duration::from_millis(options.busy_timeout_ms))?;
            db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
            let mode: String = db.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
            if mode != "wal" {
                return Err(unavailable());
            }
            checkpoint(deadline, check)
        })();
        if let Err(error) = prepared {
            db.close().map_err(|(_, error)| Error::from(error))?;
            return Err(error);
        }
        Ok(Self {
            db,
            instance: std::sync::Arc::new(()),
            contract,
            authorization,
            runtime,
            options,
        })
    }

    fn validate_recovery_image_bounded(
        contract: &C,
        database: &Path,
        deadline: Instant,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        checkpoint(deadline, check)?;
        standalone_header(database)?;
        checkpoint(deadline, check)?;
        let mut image = Connection::open_with_flags(
            database,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        image.busy_timeout(Duration::ZERO)?;
        image.pragma_update(None, "query_only", true)?;
        let validated = (|| -> Result<RecoveryImage> {
            let tx = image.transaction()?;
            let mode: String = tx.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            if mode != "delete" {
                return Err(checks::incompatible());
            }
            let mut progress = || checkpoint(deadline, check);
            let result = checks::validate_connection(&tx, contract, &mut progress)?;
            tx.commit()?; // Ends read transaction; query_only prevents writes.
            Ok(result)
        })();
        let closed = image.close().map_err(|(_, error)| Error::from(error));
        let result = validated?;
        closed?;
        checkpoint(deadline, check)?;
        Ok(result)
    }
}
