//! Private queue outcomes operations.
use super::*;

pub(super) struct AttemptOutcome {
    pub(super) at: u64,
    pub(super) kind: String,
    pub(super) report: FinishReport,
    pub(super) reconciliation: Option<Value>,
    pub(super) steps: Vec<QueueStepEvidence>,
    pub(super) liabilities: Vec<(String, StorageLiability)>,
}
pub(super) fn event_cut(db: &Connection, job: &LeasedJob, liabilities: bool) -> Result<Value> {
    let sql = if liabilities {
        "SELECT event_id,origin,liability_json FROM queue_liability_evidence WHERE job_id=?1 AND fence=?2 ORDER BY event_id"
    } else {
        "SELECT event_id,'',digest FROM queue_evidence WHERE job_id=?1 AND fence=?2 ORDER BY event_id"
    };
    let mut query = db.prepare(sql)?;
    let mut cut = Vec::new();
    for row in query.query_map(params![job.lease.job_id.0, decimal(job.lease.fence)], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (id, origin, value) = row?;
        if id <= 0 {
            return Err(bad());
        }
        let hash = if liabilities {
            digest(encoded(&json!({"origin":origin,"liability":value}))?.as_bytes())
        } else {
            value
        };
        cut.push(json!({"id":id.to_string(),"digest":hash}));
    }
    Ok(Value::Array(cut))
}
pub(super) fn validate_event_cut(
    db: &Connection,
    job: &LeasedJob,
    liabilities: bool,
    saved: &Value,
) -> Result<usize> {
    let saved = saved.as_array().ok_or_else(bad)?;
    let actual = event_cut(db, job, liabilities)?;
    let actual = actual.as_array().ok_or_else(bad)?;
    if !actual.starts_with(saved) {
        return Err(bad());
    }
    Ok(saved.len())
}
pub(super) fn retained_liabilities(
    db: &Connection,
    job: &LeasedJob,
) -> Result<Vec<(String, StorageLiability)>> {
    let mut query = db.prepare("SELECT origin,liability_json,codec_version FROM queue_liability_evidence WHERE job_id=?1 AND fence=?2 ORDER BY event_id")?;
    let mut values = Vec::new();
    for row in query.query_map(params![job.lease.job_id.0, decimal(job.lease.fence)], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, u32>(2)?,
        ))
    })? {
        let (origin, body, version) = row?;
        let value = liability(&decoded(&body)?)?;
        if version != 1
            || !matches!(origin.as_str(), "claim" | "journal" | "finish")
            || encoded(&liability_value(&value))? != body
        {
            return Err(bad());
        }
        values.push((origin, value));
    }
    Ok(values)
}
pub(super) fn append_outcome(
    db: &Connection,
    job: &LeasedJob,
    now: u64,
    report: &FinishReport,
    kind: &str,
    reconciliation: Option<Value>,
) -> Result<()> {
    let evidence_cut = event_cut(db, job, false)?;
    let liability_cut = event_cut(db, job, true)?;
    let body = encoded(
        &json!({"format":"houseatlas-queue-outcome/1","job":leased_value(job),
        "at":now.to_string(),"kind":kind,"report":report_value(report),"reconciliation":reconciliation,
        "evidenceCut":evidence_cut,"liabilityCut":liability_cut}),
    )?;
    db.execute(
        "INSERT INTO queue_outcomes(job_id,fence,body,digest,codec_version) VALUES(?1,?2,?3,?4,1)",
        params![
            job.lease.job_id.0,
            decimal(job.lease.fence),
            body,
            digest(body.as_bytes())
        ],
    )?;
    Ok(())
}
pub(super) fn retained_outcomes(db: &Connection, job: &LeasedJob) -> Result<Vec<AttemptOutcome>> {
    let mut q=db.prepare("SELECT body,digest,codec_version FROM queue_outcomes WHERE job_id=?1 AND fence=?2 ORDER BY event_id")?;
    let rows = q
        .query_map(params![job.lease.job_id.0, decimal(job.lease.fence)], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u32>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::new();
    for (body, hash, version) in rows {
        let value = decoded(&body)?;
        let report = report(&value["report"])?;
        let at = parse_u64(value["at"].as_str().ok_or_else(bad)?)?;
        let kind = value["kind"].as_str().ok_or_else(bad)?.to_owned();
        let evidence_count = validate_event_cut(db, job, false, &value["evidenceCut"])?;
        let liability_count = validate_event_cut(db, job, true, &value["liabilityCut"])?;
        let steps = retained_steps(db, job)?
            .into_iter()
            .take(evidence_count)
            .collect();
        let liabilities = retained_liabilities(db, job)?
            .into_iter()
            .take(liability_count)
            .collect();
        let reconciliation = match &value["reconciliation"] {
            Value::Null => None,
            Value::Object(_) => Some(value["reconciliation"].clone()),
            _ => return Err(bad()),
        };
        if !matches!(kind.as_str(), "finish" | "reconcile" | "admission-reject")
            || version != 1
            || hash != digest(body.as_bytes())
            || (kind == "reconcile") != reconciliation.is_some()
            || encoded(
                &json!({"format":"houseatlas-queue-outcome/1","job":leased_value(job),
                "at":at.to_string(),"kind":kind,"report":report_value(&report),"reconciliation":reconciliation,
                "evidenceCut":value["evidenceCut"],"liabilityCut":value["liabilityCut"]}),
            )? != body
        {
            return Err(bad());
        }
        out.push(AttemptOutcome {
            at,
            kind,
            report,
            reconciliation,
            steps,
            liabilities,
        });
    }
    Ok(out)
}
pub(super) fn require_retry_proof(outcome: &AttemptOutcome) -> Result<()> {
    let steps = &outcome.steps;
    if !matches!(
        outcome.report.disposition,
        FinishDisposition::RetryAt { .. }
    ) || !matches!(
        outcome.report.remote_activity,
        RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
    ) {
        return Err(bad());
    }
    check_finish_evidence(&outcome.report, steps).map_err(|_| bad())
}
pub(super) fn validate_latest_outcome(
    row: &StoredJob,
    outcome: Option<&AttemptOutcome>,
) -> Result<()> {
    let Some(outcome) = outcome else {
        if !matches!(
            row.status,
            JobStatus::Running | JobStatus::NeedsReconciliation
        ) {
            return Err(bad());
        }
        return Ok(());
    };
    let (state, next, applied, failure, logical) = match &outcome.report.disposition {
        FinishDisposition::Succeeded(a) => (JobStatus::Succeeded, None, Some(a), None, false),
        FinishDisposition::Failed(r) => (JobStatus::Failed, None, None, Some(*r), false),
        FinishDisposition::RetryAt { at, reason } => (
            JobStatus::RetryScheduled,
            Some(*at),
            None,
            Some(*reason),
            false,
        ),
        FinishDisposition::Hold(r) => (JobStatus::NeedsReconciliation, None, None, Some(*r), true),
        FinishDisposition::Partial(r) => (JobStatus::Partial, None, None, Some(*r), true),
    };
    let state = if outcome.kind == "reconcile" && state != JobStatus::RetryScheduled {
        match outcome
            .reconciliation
            .as_ref()
            .and_then(|r| r["kind"].as_str())
        {
            Some("CurrentStateObserved") => JobStatus::ResolvedObserved,
            Some(s) if s.starts_with("Human {") => JobStatus::ResolvedByHuman,
            _ => return Err(bad()),
        }
    } else {
        state
    };
    if row.status != state
        || row.next != next
        || row.applied.as_ref() != applied
        || row.failure != failure
        || row.logical != logical
    {
        return Err(bad());
    }
    if outcome.kind == "reconcile"
        && (row.reconciliation != outcome.reconciliation
            || !outcome.steps.iter().any(|e| {
                e.kind == StepKind::Reconciliation
                    && e.codec == "houseatlas-reconciliation/1"
                    && decoded(std::str::from_utf8(&e.payload).unwrap_or("")).ok()
                        == outcome.reconciliation
            }))
    {
        return Err(bad());
    }
    if row.status == JobStatus::RetryScheduled {
        require_retry_proof(outcome)?;
    }
    Ok(())
}
pub(super) fn validate_retry(db: &Connection, row: &StoredJob, config: &QueueConfig) -> Result<()> {
    let job = row.leased(config)?;
    if load_journal_view(db, &job)?.is_none() {
        return Err(bad());
    }
    let outcomes = retained_outcomes(db, &job)?;
    require_retry_proof(outcomes.last().ok_or_else(bad)?)?;
    validate_latest_outcome(row, outcomes.last())
}
