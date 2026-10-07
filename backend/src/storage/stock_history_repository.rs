//! Bounded indexed history reads over trigger-maintained immutable lookup keys.
use super::{stock_repository, *};
use crate::domain::stock::{Authority, OPERATIONS};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeSet;

pub(super) fn assert_coverage(
    db: &Connection,
    scope: &Scope,
    target: &RecordRef,
    watermark: i64,
) -> Result<()> {
    // The partial index covers the whole watermark, including q-excluded and
    // previously returned rows. Native-only history is never silently omitted.
    let missing: Option<i64> = db.query_row(
        "SELECT seq FROM stock_history_lookup WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND command_id IS NULL AND seq<=?4 ORDER BY seq LIMIT 1",
        params![scope.workspace_id, scope.home_id, target.record_id, watermark],
        |row| row.get(0),
    ).optional()?;
    if missing.is_some() {
        return Err(Error::new(
            "upstream-unavailable",
            "Original stock audit linkage is unavailable",
        ));
    }
    Ok(())
}

pub(super) struct PageQuery<'a> {
    pub scope: &'a Scope,
    pub target: &'a RecordRef,
    pub watermark: i64,
    pub after: i64,
    pub page_size: usize,
    pub q: Option<&'a str>,
}

pub(super) fn page_sequences(db: &Connection, query: &PageQuery<'_>) -> Result<Vec<i64>> {
    let limit = i64::try_from(query.page_size + 1).map_err(|_| stock_repository::incompatible())?;
    let PageQuery {
        scope,
        target,
        watermark,
        after,
        q,
        ..
    } = query;
    if q.is_none_or(|q| "committed".contains(q)) {
        return Ok(db.prepare(
            "SELECT seq FROM audits WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND seq>?4 AND seq<=?5 ORDER BY seq LIMIT ?6",
        )?.query_map(params![scope.workspace_id,scope.home_id,target.record_id,after,watermark,limit], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?);
    }
    let q = q.ok_or_else(stock_repository::incompatible)?;
    // Validated immutable stock commits use this public finite owner catalogue,
    // and links always have CHECK(state='committed'). Reuse its IDs instead of
    // scanning arbitrarily many nonmatches or inventing a second command list.
    let mut sequences = BTreeSet::new();
    let mut statement = db.prepare(
        "SELECT seq FROM stock_history_lookup WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3 AND command_id=?4 AND seq>?5 AND seq<=?6 ORDER BY seq LIMIT ?7",
    )?;
    for operation in OPERATIONS.iter().filter(|operation| {
        operation.authority == Authority::Atlas && operation.id.as_str().contains(q)
    }) {
        for sequence in statement.query_map(
            params![
                scope.workspace_id,
                scope.home_id,
                target.record_id,
                operation.id.as_str(),
                after,
                watermark,
                limit
            ],
            |row| row.get::<_, i64>(0),
        )? {
            sequences.insert(sequence?);
        }
    }
    Ok(sequences.into_iter().take(query.page_size + 1).collect())
}
