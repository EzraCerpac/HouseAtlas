//! Private queue evidence operations.
use super::*;

pub(super) fn insert_evidence(
    db: &Connection,
    job: &LeasedJob,
    items: &[QueueStepEvidence],
) -> Result<()> {
    let journal = load_journal_view(db, job)?;
    for e in items {
        if e.codec.is_empty()
            || e.codec.len() > 128
            || e.payload.is_empty()
            || e.payload.len() > MAX_METADATA_BYTES
        {
            return Err(invalid());
        }
        let kind = step_kind(&e.kind);
        let blob = encoded(&step_envelope(job, e, journal.as_ref()))?;
        db.execute("INSERT INTO queue_evidence(job_id,fence,kind,codec,payload,envelope_json,digest) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![job.lease.job_id.0,decimal(job.lease.fence),kind,e.codec,e.payload,blob,digest(blob.as_bytes())])?;
    }
    Ok(())
}
pub(super) fn step_kind(kind: &StepKind) -> &'static str {
    match kind {
        StepKind::ResponseReadback => "response-readback",
        StepKind::PositiveNoEffect => "positive-no-effect",
        StepKind::RemoteEnd => "remote-end",
        StepKind::Reconciliation => "reconciliation",
        StepKind::Other => "other",
    }
}
pub(super) fn step_envelope(
    job: &LeasedJob,
    e: &QueueStepEvidence,
    journal: Option<&JournalEvidenceView>,
) -> Value {
    json!({"format":"houseatlas-queue-step/1","job":leased_value(job),
        "journal":journal.map(|j|j.journal_evidence_digest.as_hex()),
        "kind":step_kind(&e.kind),"codec":e.codec,"payloadDigest":digest(&e.payload),
        "response":e.response_digest.as_ref().map(Digest::as_hex),
        "readback":e.readback_digest.as_ref().map(Digest::as_hex),
        "termination":e.termination_digest.as_ref().map(Digest::as_hex)})
}
pub(super) fn retained_steps(db: &Connection, job: &LeasedJob) -> Result<Vec<QueueStepEvidence>> {
    let journal = load_journal_view(db, job)?;
    let mut q = db.prepare("SELECT kind,codec,payload,envelope_json,digest FROM queue_evidence WHERE job_id=?1 AND fence=?2 ORDER BY event_id")?;
    let rows = q
        .query_map(params![job.lease.job_id.0, decimal(job.lease.fence)], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::new();
    for (kind, codec, payload, envelope, hash) in rows {
        let meta = decoded(&envelope)?;
        let field = |name: &str| -> Result<Option<Digest>> {
            match &meta[name] {
                Value::Null => Ok(None),
                Value::String(s) => Ok(Some(Digest::from_hex(s.clone()).map_err(|_| bad())?)),
                _ => Err(bad()),
            }
        };
        let kind = match kind.as_str() {
            "response-readback" => StepKind::ResponseReadback,
            "positive-no-effect" => StepKind::PositiveNoEffect,
            "remote-end" => StepKind::RemoteEnd,
            "reconciliation" => StepKind::Reconciliation,
            "other" => StepKind::Other,
            _ => return Err(bad()),
        };
        let step = QueueStepEvidence {
            kind,
            codec,
            payload,
            response_digest: field("response")?,
            readback_digest: field("readback")?,
            termination_digest: field("termination")?,
        };
        if step.codec.is_empty()
            || step.codec.len() > 128
            || step.payload.is_empty()
            || step.payload.len() > MAX_METADATA_BYTES
            || hash != digest(envelope.as_bytes())
            || encoded(&step_envelope(job, &step, journal.as_ref()))? != envelope
        {
            return Err(bad());
        }
        out.push(step);
    }
    Ok(out)
}
pub(super) fn check_finish_evidence(
    report: &FinishReport,
    evidence: &[QueueStepEvidence],
) -> Result<()> {
    check_disposition_evidence(&report.disposition, evidence)?;
    if matches!(report.remote_activity, RemoteActivity::Invoked(_))
        && matches!(report.disposition, FinishDisposition::Failed(_))
        && !evidence
            .iter()
            .any(|e| e.kind == StepKind::PositiveNoEffect)
    {
        return Err(invalid());
    }
    if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
        termination_evidence_digest,
    }) = &report.remote_activity
        && !evidence.iter().any(|e| {
            e.kind == StepKind::RemoteEnd
                && e.termination_digest.as_ref() == Some(termination_evidence_digest)
        })
    {
        return Err(invalid());
    }
    Ok(())
}
pub(super) fn check_disposition_evidence(
    disposition: &FinishDisposition,
    evidence: &[QueueStepEvidence],
) -> Result<()> {
    if let FinishDisposition::Succeeded(a) = disposition
        && !evidence.iter().any(|e| {
            e.kind == StepKind::ResponseReadback
                && e.response_digest.as_ref() == Some(&a.observation.response_digest)
                && e.readback_digest.as_ref() == Some(&a.observation.readback_digest)
        })
    {
        return Err(invalid());
    }
    if matches!(disposition, FinishDisposition::RetryAt { .. })
        && !evidence
            .iter()
            .any(|e| e.kind == StepKind::PositiveNoEffect)
    {
        return Err(invalid());
    }
    Ok(())
}
