//! Private queue journal checks operations.
use super::*;

pub(super) fn load_journal_view(
    db: &Connection,
    job: &LeasedJob,
) -> Result<Option<JournalEvidenceView>> {
    type Raw = (String, Vec<u8>, String, Vec<u8>, String, String, String);
    let raw:Option<Raw>=db.query_row("SELECT native_codec,native_payload,native_payload_digest,prepared_media,prepared_media_digest,prepared_liability_json,journal_evidence_digest FROM queue_journal WHERE job_id=?1 AND fence=?2",params![job.lease.job_id.0,decimal(job.lease.fence)],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
    let Some((codec, payload, native, media, media_digest, liability_json, journal)) = raw else {
        return Ok(None);
    };
    let liability = liability(&decoded(&liability_json)?)?;
    validate_prepared_liability(job, &liability).map_err(|_| bad())?;
    let calculated = journal_digest(job, &codec, &native, &media_digest, &liability)?;
    if codec.is_empty()
        || codec.len() > 128
        || payload.is_empty()
        || payload.len() > MAX_METADATA_BYTES
        || media.len() > MAX_METADATA_BYTES
        || native != digest(&payload)
        || media_digest != digest(&media)
        || journal != calculated
        || encoded(&liability_value(&liability))? != liability_json
    {
        return Err(bad());
    }
    Ok(Some(JournalEvidenceView {
        native_codec: codec,
        native_payload_digest: Digest::from_hex(native).map_err(|_| bad())?,
        prepared_media_digest: Digest::from_hex(media_digest).map_err(|_| bad())?,
        prepared_liability: liability,
        journal_evidence_digest: Digest::from_hex(journal).map_err(|_| bad())?,
    }))
}

pub(super) fn journal_digest(
    job: &LeasedJob,
    codec: &str,
    native: &str,
    media: &str,
    liability: &StorageLiability,
) -> Result<String> {
    Ok(digest(
        encoded(&json!([
            "houseatlas-queue-journal/1",
            leased_value(job),
            codec,
            native,
            media,
            liability_value(liability)
        ]))?
        .as_bytes(),
    ))
}

pub(super) fn validate_prepared_liability(
    job: &LeasedJob,
    liability: &StorageLiability,
) -> Result<()> {
    if job.pending_byte_liability.required {
        let limit = job
            .pending_byte_liability
            .reserved_bytes
            .ok_or_else(invalid)?;
        if !matches!(liability.accounting, ByteAccounting::Complete{known_bytes,reserved_bytes}
                if known_bytes<=limit && reserved_bytes<=limit)
        {
            return Err(invalid());
        }
    }
    if !job.pending_byte_liability.required
        && (liability.accounting
            != ByteAccounting::Complete {
                known_bytes: 0,
                reserved_bytes: 0,
            }
            || liability.byte_disposition != ByteDisposition::None
            || liability.orphan_candidate_id.is_some()
            || liability.unresolved_attempts != 0)
    {
        return Err(invalid());
    }
    Ok(())
}
