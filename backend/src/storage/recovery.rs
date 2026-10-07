//! Storage-owned capture and read-only verification.
//! No SQL handle escapes.
use super::super::{migrations, *};
use super::{AtlasStore, StoreOptions};
use crate::{domain::stock::StockContractPort, jobs::QueueConfig};
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

/// Exact schema/evidence peers and the complete owner-selected queue registry.
/// Trusted configuration, credentials and original authority handles remain
/// outside the image. Verification supplies no permission to resume dispatch.
pub struct RecoveryValidationPeers<'a, S, D, E> {
    pub stock: &'a S,
    pub queues: &'a [QueueConfig],
    pub discovery: &'a D,
    pub evidence: &'a E,
}

type Verifier<'a, C> =
    &'a mut dyn FnMut(&Connection, &C, &mut dyn FnMut() -> Result<()>) -> Result<RecoveryImage>;

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Native-only compatibility API; populated images require explicit peers.
    pub fn backup_recovery_to(
        &mut self,
        destination: &Path,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        backup_image(
            &self.db,
            &self.contract,
            destination,
            check,
            &mut checks::validate_connection,
        )
    }
    pub fn validate_recovery_image(
        &self,
        database: &Path,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        Self::validate_existing_recovery_image(database, &self.contract, check)
    }
    /// Detached read-only validation. No source store, CREATE or migration.
    pub fn validate_existing_recovery_image(
        database: &Path,
        contract: &C,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        validate_image(
            contract,
            database,
            Instant::now() + Duration::from_secs(30),
            check,
            &mut checks::validate_connection,
        )
    }
    /// Strict existing-state reopen; expected metadata is not a grant or a
    /// whole-image authentication digest. Caller exclusively binds the path.
    pub fn open_existing_recovery_image(
        database: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
        expected: &RecoveryImage,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Self> {
        let db = open_existing_connection(
            database,
            &contract,
            &options,
            expected,
            false,
            check,
            &mut checks::validate_connection,
        )?;
        Ok(Self::from_existing_connection(
            db,
            contract,
            authorization,
            runtime,
            options,
        ))
    }
    pub fn backup_recovery_to_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        &mut self,
        destination: &Path,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_peers(db, native, peers, progress)
        };
        backup_image(&self.db, &self.contract, destination, check, &mut verify)
    }
    pub fn validate_recovery_image_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        &self,
        database: &Path,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        Self::validate_existing_recovery_image_with_peers(database, &self.contract, peers, check)
    }
    /// Full detached native/stock/queue validation; no original grants restored.
    pub fn validate_existing_recovery_image_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        database: &Path,
        contract: &C,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_peers(db, native, peers, progress)
        };
        validate_image(
            contract,
            database,
            Instant::now() + Duration::from_secs(30),
            check,
            &mut verify,
        )
    }
    /// Revalidate full existing state on the same no-CREATE/no-migration handle
    /// before WAL. Newly supplied runtime authority must reauthorize every read,
    /// stock operation, queue original/witness and final native dispatch.
    #[allow(
        clippy::too_many_arguments,
        reason = "Mirrors strict existing-state constructor plus required borrowed validation peers"
    )]
    pub fn open_existing_recovery_image_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
    >(
        database: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
        expected: &RecoveryImage,
        peers: &RecoveryValidationPeers<'_, S, D, E>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Self> {
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_peers(db, native, peers, progress)
        };
        let db = open_existing_connection(
            database,
            &contract,
            &options,
            expected,
            false,
            check,
            &mut verify,
        )?;
        Ok(Self::from_existing_connection(
            db,
            contract,
            authorization,
            runtime,
            options,
        ))
    }
    /// Explicit profile-6 capture. Original producer/native/media evidence and
    /// independent discovery are required; this never scans for dispatch work.
    pub fn backup_stock_activity_recovery_to_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
        W: crate::providers::homebox::write::stock::StockContractPort,
        AD: StockActivityRecoveryDiscovery,
        AE: StockActivityRecoveryEvidence,
    >(
        &mut self,
        destination: &Path,
        base: &RecoveryValidationPeers<'_, S, D, E>,
        activity: &StockActivityRecoveryPeers<'_, W, AD, AE>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        if !self.options.stock_activity_profile {
            return Err(checks::incompatible());
        }
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_activity_peers(db, native, base, activity, progress)
        };
        backup_image(&self.db, &self.contract, destination, check, &mut verify)
    }

    /// Detached native activity validation; actual records are delivered only
    /// to the required offline owner evidence peer, with no SQL/grant leakage.
    pub fn validate_existing_stock_activity_recovery_image_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
        W: crate::providers::homebox::write::stock::StockContractPort,
        AD: StockActivityRecoveryDiscovery,
        AE: StockActivityRecoveryEvidence,
    >(
        database: &Path,
        contract: &C,
        base: &RecoveryValidationPeers<'_, S, D, E>,
        activity: &StockActivityRecoveryPeers<'_, W, AD, AE>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<RecoveryImage> {
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_activity_peers(db, native, base, activity, progress)
        };
        validate_image(
            contract,
            database,
            Instant::now() + Duration::from_secs(30),
            check,
            &mut verify,
        )
    }

    /// Same-handle strict existing profile-6 reopen, no CREATE/migration or
    /// original session/queued-handoff/permit reconstruction. Runtime authority
    /// remains independently supplied and must qualify every later operation.
    #[allow(
        clippy::too_many_arguments,
        reason = "Explicit existing-image constructor with separate native activity and base peers"
    )]
    pub fn open_existing_stock_activity_recovery_image_with_peers<
        S: StockContractPort,
        D: QueueDiscovery,
        E: QueueRecoveryEvidence,
        W: crate::providers::homebox::write::stock::StockContractPort,
        AD: StockActivityRecoveryDiscovery,
        AE: StockActivityRecoveryEvidence,
    >(
        database: &Path,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
        expected: &RecoveryImage,
        base: &RecoveryValidationPeers<'_, S, D, E>,
        activity: &StockActivityRecoveryPeers<'_, W, AD, AE>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Self> {
        let mut verify = |db: &Connection, native: &C, progress: &mut dyn FnMut() -> Result<()>| {
            checks::validate_connection_with_activity_peers(db, native, base, activity, progress)
        };
        let db = open_existing_connection(
            database,
            &contract,
            &options,
            expected,
            true,
            check,
            &mut verify,
        )?;
        Ok(Self::from_existing_connection(
            db,
            contract,
            authorization,
            runtime,
            options,
        ))
    }

    fn from_existing_connection(
        db: Connection,
        contract: C,
        authorization: A,
        runtime: R,
        options: StoreOptions,
    ) -> Self {
        Self {
            db,
            instance: std::sync::Arc::new(()),
            cache_pins: super::cache_custody::CachePinRegistry::default(),
            contract,
            authorization,
            runtime,
            options,
        }
    }
}

fn backup_image<C: Contract>(
    db: &Connection,
    contract: &C,
    destination: &Path,
    check: &mut dyn FnMut() -> Result<()>,
    verify: Verifier<'_, C>,
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
        let backup = Backup::new(db, &mut copy)?;
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
    validate_image(contract, destination, deadline, check, verify)
}

fn open_existing_connection<C: Contract>(
    database: &Path,
    contract: &C,
    options: &StoreOptions,
    expected: &RecoveryImage,
    activity: bool,
    check: &mut dyn FnMut() -> Result<()>,
    verify: Verifier<'_, C>,
) -> Result<Connection> {
    if options.stock_activity_profile != activity
        || options.allow_synthetic_bootstrap
        || options.busy_timeout_ms > 60_000
        || expected.database_schema
            != if activity {
                STOCK_ACTIVITY_DATABASE_VERSION
            } else {
                DATABASE_VERSION
            }
    {
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
        let actual = verify(&tx, contract, &mut progress)?;
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
    Ok(db)
}

fn validate_image<C: Contract>(
    contract: &C,
    database: &Path,
    deadline: Instant,
    check: &mut dyn FnMut() -> Result<()>,
    verify: Verifier<'_, C>,
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
        let result = verify(&tx, contract, &mut progress)?;
        tx.commit()?; // Ends read transaction; query_only prevents writes.
        Ok(result)
    })();
    let closed = image.close().map_err(|(_, error)| Error::from(error));
    let result = validated?;
    closed?;
    checkpoint(deadline, check)?;
    Ok(result)
}
