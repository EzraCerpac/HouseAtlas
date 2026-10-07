//! Private queue liability operations.
use super::*;

pub(super) fn account(v: &ByteAccounting) -> (u64, Option<u64>) {
    match v {
        ByteAccounting::Complete {
            known_bytes,
            reserved_bytes,
        } => (*known_bytes, Some(*reserved_bytes)),
        ByteAccounting::Incomplete { known_bytes } => (*known_bytes, None),
    }
}
pub(super) fn merge_facts(to: &mut StorageLiability, from: &StorageLiability) {
    if to.metadata_commit_evidence == MetadataCommitEvidence::NotDispatched {
        to.metadata_commit_evidence = from.metadata_commit_evidence;
    } else if from.metadata_commit_evidence != MetadataCommitEvidence::NotDispatched
        && to.metadata_commit_evidence != from.metadata_commit_evidence
    {
        to.metadata_commit_evidence = MetadataCommitEvidence::Unknown;
    }
    if to.byte_disposition == ByteDisposition::None {
        to.byte_disposition = from.byte_disposition;
    } else if from.byte_disposition != ByteDisposition::None
        && to.byte_disposition != from.byte_disposition
    {
        to.byte_disposition = ByteDisposition::Unknown;
    }
    to.reference_closure_evidence = match (
        to.reference_closure_evidence,
        from.reference_closure_evidence,
    ) {
        (ReferenceClosureEvidence::Incomplete, _) | (_, ReferenceClosureEvidence::Incomplete) => {
            ReferenceClosureEvidence::Incomplete
        }
        (a, b) if a == b => a,
        _ => ReferenceClosureEvidence::Unassessed,
    };
    if to.orphan_candidate_id.is_none() {
        to.orphan_candidate_id = from.orphan_candidate_id.clone();
    }
}
pub(super) fn liability_sum(a: &mut StorageLiability, b: &StorageLiability) -> Result<()> {
    let (known, reserved) = account(&a.accounting);
    let (other_known, other_reserved) = account(&b.accounting);
    let known = sum(known, other_known)?;
    a.accounting = match reserved.zip(other_reserved) {
        Some((x, y)) => ByteAccounting::Complete {
            known_bytes: known,
            reserved_bytes: sum(x, y)?,
        },
        None => ByteAccounting::Incomplete { known_bytes: known },
    };
    a.unresolved_attempts = a
        .unresolved_attempts
        .checked_add(b.unresolved_attempts)
        .ok_or_else(overflow)?;
    merge_facts(a, b);
    Ok(())
}
pub(super) fn attempt_max(a: &mut StorageLiability, b: &StorageLiability) {
    let (known, reserved) = account(&a.accounting);
    let (other_known, other_reserved) = account(&b.accounting);
    a.accounting = match reserved.zip(other_reserved) {
        Some((x, y)) => ByteAccounting::Complete {
            known_bytes: known.max(other_known),
            reserved_bytes: x.max(y),
        },
        None => ByteAccounting::Incomplete {
            known_bytes: known.max(other_known),
        },
    };
    a.unresolved_attempts = a.unresolved_attempts.max(b.unresolved_attempts);
    merge_facts(a, b);
}
pub(super) fn aggregate_liability(db: &Connection, id: &str) -> Result<StorageLiability> {
    let mut q=db.prepare("SELECT fence,liability_json FROM queue_liability_evidence WHERE job_id=?1 ORDER BY event_id")?;
    let mut by_attempt = BTreeMap::<u64, StorageLiability>::new();
    for item in q.query_map([id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (fence, blob) = item?;
        let value = liability(&decoded(&blob)?)?;
        if let Some(prior) = by_attempt.get_mut(&parse_u64(&fence)?) {
            attempt_max(prior, &value);
        } else {
            by_attempt.insert(parse_u64(&fence)?, value);
        }
    }
    let mut values = by_attempt.into_values();
    let mut total = values.next().unwrap_or_else(zero_liability);
    for value in values {
        liability_sum(&mut total, &value)?;
    }
    Ok(total)
}
pub(super) fn append_liability(
    db: &Connection,
    row: &StoredJob,
    fence: u64,
    origin: &str,
    value: &StorageLiability,
) -> Result<StorageLiability> {
    db.execute("INSERT INTO queue_liability_evidence(job_id,fence,origin,liability_json,codec_version) VALUES(?1,?2,?3,?4,1)",params![row.id,decimal(fence),origin,encoded(&liability_value(value))?])?;
    let total = aggregate_liability(db, &row.id)?;
    db.execute(
        "UPDATE queue_jobs SET liability_json=?1 WHERE job_id=?2",
        params![encoded(&liability_value(&total))?, row.id],
    )?;
    Ok(total)
}
pub(super) fn zero_liability() -> StorageLiability {
    StorageLiability {
        accounting: ByteAccounting::Complete {
            known_bytes: 0,
            reserved_bytes: 0,
        },
        metadata_commit_evidence: MetadataCommitEvidence::NotDispatched,
        byte_disposition: ByteDisposition::None,
        reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 0,
    }
}
pub(super) fn reservation_liability(
    pending: PendingByteLiability,
) -> Result<Option<StorageLiability>> {
    if !pending.required {
        return Ok(None);
    }
    Ok(Some(StorageLiability {
        accounting: ByteAccounting::Complete {
            known_bytes: 0,
            reserved_bytes: pending.reserved_bytes.ok_or_else(invalid)?,
        },
        metadata_commit_evidence: MetadataCommitEvidence::NotDispatched,
        byte_disposition: ByteDisposition::None,
        reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 1,
    }))
}
