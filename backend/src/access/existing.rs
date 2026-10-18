//! Compiled Access catalogue/meta/epoch validation, separately from normal use.

use std::{fs, path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags, TransactionBehavior};

use super::{ACCESS_SCHEMA_VERSION, AccessError, AccessResult, store};

#[derive(Eq, PartialEq)]
struct SchemaEntry {
    kind: String,
    name: String,
    table: String,
    sql: Option<Vec<String>>,
}

pub(super) fn open(path: &Path) -> AccessResult<Connection> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AccessError::Unavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AccessError::InvalidInput);
    }

    let expected = compiled_catalogue()?;
    let flags = OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let mut validation =
        Connection::open_with_flags(path, flags | OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    validation.busy_timeout(Duration::from_millis(5000))?;
    validate(&mut validation, &expected)?;
    drop(validation);

    // No CREATE flag, chmod, directory creation or migration fallback. Recovery
    // owns trusted path selection and exclusion of writers/replacement.
    let mut db = Connection::open_with_flags(path, flags | OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    db.busy_timeout(Duration::from_millis(5000))?;
    validate(&mut db, &expected)?;
    db.pragma_update(None, "foreign_keys", true)?;
    Ok(db)
}

pub(super) fn validate_closed_read_only(path: &Path) -> AccessResult<()> {
    // The caller owns trusted path selection and a coherent closed-state fence.
    // READ_ONLY SQL is not a guarantee against live WAL/SHM filesystem effects.
    let metadata = fs::symlink_metadata(path).map_err(|_| AccessError::Unavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AccessError::InvalidInput);
    }
    let expected = compiled_catalogue()?;
    let mut db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_NOFOLLOW | OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    db.busy_timeout(Duration::from_millis(5000))?;
    validate(&mut db, &expected)
}

pub(super) fn validate_current_read_only(db: &mut Connection) -> AccessResult<()> {
    // Retain the owner's original connection and its connection-local policy.
    validate(db, &compiled_catalogue()?)
}

fn compiled_catalogue() -> AccessResult<Vec<SchemaEntry>> {
    // The reference is private in-memory metadata only. No initialization SQL
    // is ever sent to the selected persistence, including the validation path.
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(include_str!("schema.sql"))?;
    catalogue(&reference)
}

fn validate(db: &mut Connection, expected: &[SchemaEntry]) -> AccessResult<()> {
    // Catalogue and metadata share one deferred read snapshot. The selected
    // connection executes no DML, DDL, persistent PRAGMA or session operation.
    let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
    if catalogue(&tx)? != expected {
        return Err(AccessError::Unavailable);
    }
    let count: i64 = tx.query_row("SELECT count(*) FROM access_meta", [], |row| row.get(0))?;
    let version: i64 = tx.query_row("SELECT version FROM access_meta WHERE id=1", [], |row| {
        row.get(0)
    })?;
    if count != 1 || version != ACCESS_SCHEMA_VERSION {
        return Err(AccessError::Unavailable);
    }
    // Keep the persisted epoch opaque and unchanged; validate its known spelling.
    store::epoch(&tx)?;
    tx.commit()?;
    Ok(())
}

fn catalogue(db: &Connection) -> AccessResult<Vec<SchemaEntry>> {
    let mut statement =
        db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")?;
    let rows = statement.query_map([], |row| {
        Ok(SchemaEntry {
            kind: row.get(0)?,
            name: row.get(1)?,
            table: row.get(2)?,
            sql: row.get::<_, Option<String>>(3)?.map(|sql| sql_tokens(&sql)),
        })
    })?;
    rows.collect::<Result<_, _>>().map_err(AccessError::from)
}

// Token boundaries preserve SQL meaning: NOTNULL differs from NOT NULL, and
// quoted literals/identifiers retain exact spelling and escaped delimiters.
// This matches known compiled/published DDL, not arbitrary equivalent schemas.
fn sql_tokens(sql: &str) -> Vec<String> {
    let mut characters = sql.chars().peekable();
    let mut tokens = Vec::new();
    while let Some(character) = characters.next() {
        if character.is_ascii_whitespace() {
            continue;
        }
        let mut token = String::from(character);
        if matches!(character, '\'' | '"' | '`' | '[') {
            let delimiter = if character == '[' { ']' } else { character };
            while let Some(next) = characters.next() {
                token.push(next);
                if next == delimiter {
                    if delimiter != ']' && characters.peek() == Some(&delimiter) {
                        token.push(characters.next().expect("Peeked SQL delimiter"));
                    } else {
                        break;
                    }
                }
            }
        } else if character.is_ascii_alphanumeric() || character == '_' {
            token.make_ascii_lowercase();
            while characters
                .peek()
                .is_some_and(|next| next.is_ascii_alphanumeric() || *next == '_')
            {
                token.push(
                    characters
                        .next()
                        .expect("Peeked SQL token")
                        .to_ascii_lowercase(),
                );
            }
        }
        tokens.push(token);
    }
    tokens
}
