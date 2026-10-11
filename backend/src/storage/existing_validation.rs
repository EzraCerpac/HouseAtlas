//! Schema-only validation for explicit offline metadata compatibility.
//! The selected database is never initialized, adopted or opened for writes.
use super::{Result, migrations};
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::{path::Path, time::Duration};

pub(crate) fn validate_existing_receipt_schema(path: &Path) -> Result<()> {
    let mut db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.busy_timeout(Duration::ZERO)?;
    db.pragma_update(None, "query_only", true)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
    // This delegates the exact default-v5 ledger, lineage and compiled catalog
    // check; only the separate reference connection receives initialization SQL.
    migrations::validate(&tx)?;
    tx.commit()?;
    db.close().map_err(|(_, error)| error.into())
}
