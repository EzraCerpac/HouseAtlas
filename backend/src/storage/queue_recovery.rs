//! Private queue recovery operations.
use super::*;

use std::collections::BTreeSet;

/// Validate one trusted registration, preserving the existing diagnostic API.
pub(super) fn validate_retained_queue(
    db: &Connection,
    config: &QueueConfig,
    discovery: &impl QueueDiscovery,
    schemas: &impl StockContractPort,
) -> Result<()> {
    let mut check = || Ok(());
    validate_foreign_keys(db, &mut check)?;
    validate_queue(db, config, discovery, schemas, None, &mut check)
}

/// Validate the complete physical registry and every queue descendant in a
/// single read-only image transaction. Trusted configs come from the owner,
/// never from configuration_json. Codec evidence remains data, not authority.
pub(crate) fn validate_recovery_queues(
    db: &Connection,
    configs: &[QueueConfig],
    discovery: &impl QueueDiscovery,
    schemas: &impl StockContractPort,
    evidence: &impl QueueRecoveryEvidence,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    check()?;
    let mut trusted = BTreeSet::new();
    for config in configs {
        check()?;
        config.validate().map_err(|_| bad())?;
        discovery.authorize_discovery(&config.registration)?;
        check()?;
        let identity = &config.registration.identity;
        if !trusted.insert((
            identity.deployment_id.clone(),
            identity.physical_database_id.clone(),
        )) {
            return Err(bad());
        }
    }
    let mut query = db.prepare(
        "SELECT deployment_id,physical_database_id FROM queue_physical ORDER BY deployment_id,physical_database_id",
    )?;
    let mut retained = BTreeSet::new();
    for row in query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        check()?;
        if !retained.insert(row?) {
            return Err(bad());
        }
    }
    if trusted != retained {
        return Err(bad());
    }
    validate_foreign_keys(db, check)?;
    for config in configs {
        check()?;
        discovery.authorize_discovery(&config.registration)?;
        check()?;
        validate_queue(db, config, discovery, schemas, Some(evidence), check)?;
        check()?;
        discovery.authorize_discovery(&config.registration)?;
    }
    check()
}

fn validate_foreign_keys(db: &Connection, check: &mut dyn FnMut() -> Result<()>) -> Result<()> {
    check()?;
    let mut fk = db.prepare("PRAGMA foreign_key_check")?;
    if fk.query([])?.next()?.is_some() {
        return Err(bad());
    }
    check()
}

fn retained_prepared(
    db: &Connection,
    job: &LeasedJob,
    journal: Option<&JournalEvidenceView>,
) -> Result<Option<PreparedNativeIntent>> {
    let Some(journal) = journal else {
        return Ok(None);
    };
    let (codec, native_payload, prepared_media_evidence, liability_json): (
        String,
        Vec<u8>,
        Vec<u8>,
        String,
    ) = db.query_row(
        "SELECT native_codec,native_payload,prepared_media,prepared_liability_json FROM queue_journal WHERE job_id=?1 AND fence=?2",
        params![job.lease.job_id.0, decimal(job.lease.fence)],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let prepared = PreparedNativeIntent {
        codec,
        native_payload,
        prepared_media_evidence,
        storage_liability: liability(&decoded(&liability_json)?)?,
    };
    if prepared.codec != journal.native_codec
        || digest(&prepared.native_payload) != journal.native_payload_digest.as_hex()
        || digest(&prepared.prepared_media_evidence) != journal.prepared_media_digest.as_hex()
        || prepared.storage_liability != journal.prepared_liability
    {
        return Err(bad());
    }
    Ok(Some(prepared))
}

fn remote_progresses(prior: &RemoteActivity, next: &RemoteActivity) -> bool {
    match prior {
        RemoteActivity::NotDispatched => next == &RemoteActivity::NotDispatched,
        RemoteActivity::Invoked(InvokedRemoteActivity::Active) => {
            matches!(next, RemoteActivity::Invoked(_))
        }
        RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven) => matches!(
            next,
            RemoteActivity::Invoked(
                InvokedRemoteActivity::EndUnproven | InvokedRemoteActivity::EndedProven { .. }
            )
        ),
        RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. }) => prior == next,
    }
}

struct AttemptHistory<'a> {
    attempt: &'a LeasedJob,
    journal: Option<&'a JournalEvidenceView>,
    steps: &'a [QueueStepEvidence],
    liabilities: &'a [(String, StorageLiability)],
    outcomes: &'a [AttemptOutcome],
}
fn validate_attempt_history(
    row: &StoredJob,
    facts: AttemptHistory<'_>,
    last_reconciliation: &mut Option<Value>,
    last_outcome_at: &mut u64,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let AttemptHistory {
        attempt,
        journal,
        steps,
        liabilities,
        outcomes,
    } = facts;
    let mut origins = Vec::new();
    if attempt.pending_byte_liability.required {
        origins.push("claim");
    }
    if journal.is_some() {
        origins.push("journal");
    }
    let mut prior: Option<&AttemptOutcome> = None;
    let mut step_cut = 0;
    for outcome in outcomes {
        check()?;
        if outcome.at < *last_outcome_at
            || outcome.at > row.updated
            || outcome.steps.len() < step_cut
            || !steps.starts_with(&outcome.steps)
            || !liabilities.starts_with(&outcome.liabilities)
        {
            return Err(bad());
        }
        *last_outcome_at = outcome.at;
        let permitted = match prior {
            None => {
                outcome.kind == "finish"
                    || (outcome.kind == "reconcile" && outcome.at >= attempt.lease.expires_at)
            }
            Some(previous) => match (&previous.kind[..], &previous.report.disposition) {
                ("finish", FinishDisposition::Hold(_)) => {
                    outcome.kind == "reconcile"
                        || (outcome.kind == "finish"
                            && previous.report.remote_activity.blocks_invocation())
                }
                ("finish", FinishDisposition::Partial(_)) => outcome.kind == "reconcile",
                ("finish" | "reconcile", FinishDisposition::RetryAt { .. }) => {
                    outcome.kind == "admission-reject"
                }
                _ => false,
            },
        };
        if !permitted {
            return Err(bad());
        }
        check_finish_evidence(&outcome.report, &outcome.steps).map_err(|_| bad())?;
        if matches!(
            outcome.report.remote_activity,
            RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
        ) && journal.is_none()
        {
            return Err(bad());
        }
        if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) = &outcome.report.remote_activity
            && !prior.is_some_and(|previous| {
                previous.report.remote_activity == outcome.report.remote_activity
            })
            && !outcome.steps[step_cut..].iter().any(|step| {
                step.kind == StepKind::RemoteEnd
                    && step.termination_digest.as_ref() == Some(termination_evidence_digest)
            })
        {
            return Err(bad());
        }
        if outcome.kind == "finish" {
            if matches!(outcome.report.remote_activity, RemoteActivity::Invoked(_))
                && journal.is_none()
            {
                return Err(bad());
            }
            origins.push("finish");
            if outcome.liabilities.len() != origins.len()
                || !outcome.liabilities.last().is_some_and(|(origin, value)| {
                    origin == "finish" && value == &outcome.report.storage_liability
                })
                || prior.is_some_and(|previous| {
                    outcome.report.remote_activity == RemoteActivity::NotDispatched
                        && previous.kind == "finish"
                })
            {
                return Err(bad());
            }
        } else if outcome.liabilities.len() != origins.len() {
            return Err(bad());
        }
        if outcome.kind == "reconcile" {
            let marker = outcome.steps[step_cut..].last().ok_or_else(bad)?;
            let activity_valid = match prior {
                Some(previous) => remote_progresses(
                    &previous.report.remote_activity,
                    &outcome.report.remote_activity,
                ),
                None => matches!(
                    outcome.report.remote_activity,
                    RemoteActivity::Invoked(
                        InvokedRemoteActivity::EndUnproven
                            | InvokedRemoteActivity::EndedProven { .. }
                    )
                ),
            };
            if marker.kind != StepKind::Reconciliation
                || marker.codec != "houseatlas-reconciliation/1"
                || decoded(std::str::from_utf8(&marker.payload).unwrap_or("")).ok()
                    != outcome.reconciliation
                || !matches!(outcome.report.remote_activity, RemoteActivity::Invoked(_))
                || matches!(
                    outcome.report.disposition,
                    FinishDisposition::Hold(_) | FinishDisposition::Partial(_)
                )
                || !activity_valid
            {
                return Err(bad());
            }
            if matches!(
                outcome.report.disposition,
                FinishDisposition::RetryAt { .. }
            ) && outcome
                .reconciliation
                .as_ref()
                .and_then(|value| value["kind"].as_str())
                != Some("CurrentStateObserved")
            {
                return Err(bad());
            }
            *last_reconciliation = outcome.reconciliation.clone();
        }
        if outcome.kind == "admission-reject" {
            require_retry_proof(prior.ok_or_else(bad)?)?;
            let added = &outcome.steps[step_cut..];
            if outcome.report.disposition != FinishDisposition::Failed(FailureCode::Rejected)
                || added.len() != 1
                || added[0].kind != StepKind::Other
                || added[0].codec != "houseatlas-admission/1"
                || decoded(std::str::from_utf8(&added[0].payload).unwrap_or("")).ok()
                    != Some(
                        json!({"format":"houseatlas-admission/1","at":outcome.at.to_string(),"reason":"Rejected"}),
                    )
                || outcome.report.remote_activity != prior.ok_or_else(bad)?.report.remote_activity
            {
                return Err(bad());
            }
        }
        step_cut = outcome.steps.len();
        prior = Some(outcome);
    }
    if liabilities
        .iter()
        .map(|(origin, _)| origin.as_str())
        .collect::<Vec<_>>()
        != origins
    {
        return Err(bad());
    }
    let tail = &steps[step_cut..];
    if !tail.is_empty() {
        let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) = &row.remote
        else {
            return Err(bad());
        };
        if attempt.attempt != row.attempts
            || tail.len() != 1
            || journal.is_none()
            || tail[0].kind != StepKind::RemoteEnd
            || tail[0].termination_digest.as_ref() != Some(termination_evidence_digest)
            || prior.is_some_and(|outcome| {
                matches!(
                    outcome.report.remote_activity,
                    RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
                )
            })
        {
            return Err(bad());
        }
    }
    Ok(())
}

fn validate_current_activity(
    row: &StoredJob,
    attempt: &LeasedJob,
    last: Option<&AttemptOutcome>,
    steps: &[QueueStepEvidence],
) -> Result<()> {
    let consumed = last.map_or(0, |outcome| outcome.steps.len());
    if consumed > steps.len() {
        return Err(bad());
    }
    match last {
        None if row.status == JobStatus::Running => {
            if row.remote != RemoteActivity::Invoked(InvokedRemoteActivity::Active) {
                return Err(bad());
            }
        }
        None if row.status == JobStatus::NeedsReconciliation => {
            if row.failure != Some(FailureCode::LeaseExpired)
                || row.updated < attempt.lease.expires_at
                || !matches!(
                    row.remote,
                    RemoteActivity::Invoked(
                        InvokedRemoteActivity::EndUnproven
                            | InvokedRemoteActivity::EndedProven { .. }
                    )
                )
            {
                return Err(bad());
            }
        }
        None => return Err(bad()),
        Some(outcome) => {
            let progresses = match &outcome.report.remote_activity {
                RemoteActivity::NotDispatched => row.remote == RemoteActivity::NotDispatched,
                RemoteActivity::Invoked(InvokedRemoteActivity::Active) => {
                    matches!(row.remote, RemoteActivity::Invoked(_))
                }
                RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven) => {
                    matches!(
                        row.remote,
                        RemoteActivity::Invoked(
                            InvokedRemoteActivity::EndUnproven
                                | InvokedRemoteActivity::EndedProven { .. }
                        )
                    )
                }
                RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. }) => {
                    row.remote == outcome.report.remote_activity
                }
            };
            if !progresses {
                return Err(bad());
            }
        }
    }
    if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
        termination_evidence_digest,
    }) = &row.remote
    {
        let ended_in_outcome =
            last.is_some_and(|outcome| outcome.report.remote_activity == row.remote);
        if !ended_in_outcome
            && (steps.len() != consumed + 1
                || steps[consumed].kind != StepKind::RemoteEnd
                || steps[consumed].termination_digest.as_ref() != Some(termination_evidence_digest))
        {
            return Err(bad());
        }
    }
    Ok(())
}

fn validate_queue(
    db: &Connection,
    config: &QueueConfig,
    discovery: &impl QueueDiscovery,
    schemas: &impl StockContractPort,
    evidence: Option<&dyn QueueRecoveryEvidence>,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    check()?;
    assert_registered(db, config)?;
    let (fence, active_id, active_fence, active_expires) = active(db, config)?;
    let next_sequence: String=db.query_row("SELECT next_sequence FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",
        params![config.registration.identity.deployment_id,config.registration.identity.physical_database_id],|r|r.get(0))?;
    let identity = &config.registration.identity;
    let mut query = db.prepare("SELECT job_id FROM queue_jobs WHERE deployment_id=?1 AND physical_database_id=?2 ORDER BY length(sequence),sequence COLLATE BINARY")?;
    let mut ids = Vec::new();
    for id in query.query_map(
        params![identity.deployment_id, identity.physical_database_id],
        |r| r.get::<_, String>(0),
    )? {
        check()?;
        ids.push(id?);
    }
    let mut sequences = BTreeSet::new();
    let mut fences = BTreeSet::new();
    let mut seen_active = false;
    for id in &ids {
        check()?;
        let row = load(db, id)?;
        assert_physical(&row, config)?;
        validate_job_state(&row)?;
        if row.sequence == 0 || !sequences.insert(row.sequence) {
            return Err(bad());
        }
        let original =
            ValidatedRequest::parse(schemas, decoded(&row.original_json)?).map_err(|_| bad())?;
        if !original.is_mutation()
            || encoded(original.raw())? != row.original_json
            || original.intent_digest() != row.request.intent.request_digest.as_hex()
            || original.id().as_str() != row.request.intent.operation_id
            || original.context().workspace_id != row.request.receipt.workspace_id
            || original.context().home_id != row.request.receipt.home_id
            || original.raw()["idempotencyKey"].as_str() != Some(&row.request.receipt.mutation_id)
            || config
                .registration
                .resolve(&row.request.partition, &row.request.write_scope)
                .map_err(|_| bad())?
                != row.scope
        {
            return Err(bad());
        }
        check()?;
        discovery.validate_retained_enqueue(&original, &row.request, &row.scope, config)?;
        check()?;
        if aggregate_liability(db, id)? != row.liability {
            return Err(bad());
        }
        check()?;
        let mut q=db.prepare("SELECT fence,original_leased_job_json FROM queue_attempts WHERE job_id=?1 ORDER BY length(fence),fence COLLATE BINARY")?;
        let mut attempts = Vec::new();
        for attempt in q.query_map([id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            check()?;
            attempts.push(attempt?);
        }
        if attempts.len() != row.attempts as usize {
            return Err(bad());
        }
        let mut latest = None;
        let mut last_reconciliation = None;
        let mut last_outcome_at = row.created;
        for (index, (fence_text, body)) in attempts.into_iter().enumerate() {
            check()?;
            let attempt = leased(&decoded(&body)?)?;
            let f = parse_u64(&fence_text)?;
            if f == 0
                || !fences.insert(f)
                || attempt.lease.job_id.0 != *id
                || attempt.lease.fence != f
                || attempt.lease.physical_identity != config.registration.identity
                || attempt.lease.owner_id != config.registration.dispatcher_owner_id
                || attempt.request != row.request
                || attempt.canonical_scope != row.scope
                || attempt.pending_byte_liability != row.request.pending_byte_liability
                || attempt.attempt != u32::try_from(index + 1).map_err(|_| bad())?
                || encoded(&leased_value(&attempt))? != body
            {
                return Err(bad());
            }
            let journal = load_journal_view(db, &attempt)?;
            check()?;
            if let Some(reservation) = reservation_liability(attempt.pending_byte_liability)? {
                let retained:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM queue_liability_evidence WHERE job_id=?1 AND fence=?2 AND origin='claim' AND liability_json=?3 AND codec_version=1)",
                    params![id,decimal(f),encoded(&liability_value(&reservation))?],|r|r.get(0))?;
                if !retained {
                    return Err(bad());
                }
            }
            if let Some(j) = journal.as_ref() {
                let retained:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM queue_liability_evidence WHERE job_id=?1 AND fence=?2 AND origin='journal' AND liability_json=?3 AND codec_version=1)",
                    params![id,decimal(f),encoded(&liability_value(&j.prepared_liability))?],|r|r.get(0))?;
                if !retained {
                    return Err(bad());
                }
            }
            let liability_events = retained_liabilities(db, &attempt)?;
            check()?;
            let steps = retained_steps(db, &attempt)?;
            check()?;
            let outcomes = retained_outcomes(db, &attempt)?;
            check()?;
            for _ in &liability_events {
                check()?;
            }
            for _ in &steps {
                check()?;
            }
            validate_attempt_history(
                &row,
                AttemptHistory {
                    attempt: &attempt,
                    journal: journal.as_ref(),
                    steps: &steps,
                    liabilities: &liability_events,
                    outcomes: &outcomes,
                },
                &mut last_reconciliation,
                &mut last_outcome_at,
                check,
            )?;
            if attempt.attempt < row.attempts {
                require_retry_proof(outcomes.last().ok_or_else(bad)?)?;
            } else {
                validate_latest_outcome(&row, outcomes.last())?;
                validate_current_activity(&row, &attempt, outcomes.last(), &steps)?;
            }
            if let Some(evidence) = evidence {
                check()?;
                let prepared = retained_prepared(db, &attempt, journal.as_ref())?;
                let borrowed = outcomes
                    .iter()
                    .map(|outcome| QueueRecoveryOutcome {
                        at: outcome.at,
                        kind: &outcome.kind,
                        report: &outcome.report,
                        reconciliation: outcome.reconciliation.as_ref(),
                        steps: &outcome.steps,
                        liabilities: &outcome.liabilities,
                    })
                    .collect::<Vec<_>>();
                check()?;
                evidence.validate_attempt(
                    config,
                    QueueRecoveryAttempt {
                        original: &original,
                        job: &attempt,
                        prepared: prepared.as_ref(),
                        journal: journal.as_ref(),
                        steps: &steps,
                        liabilities: &liability_events,
                        outcomes: &borrowed,
                    },
                )?;
                check()?;
            }
            latest = Some((attempt, journal, steps));
        }
        if row.reconciliation != last_reconciliation {
            return Err(bad());
        }
        if let Some((attempt, journal, steps)) = latest {
            if attempt != row.leased(config)? || !row.body_accepted {
                return Err(bad());
            }
            if let Some(applied) = &row.applied
                && (journal.is_none()
                    || !steps.iter().any(|e| {
                        e.kind == StepKind::ResponseReadback
                            && e.response_digest.as_ref()
                                == Some(&applied.observation.response_digest)
                            && e.readback_digest.as_ref()
                                == Some(&applied.observation.readback_digest)
                    }))
            {
                return Err(bad());
            }
            if let RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
                termination_evidence_digest,
            }) = &row.remote
                && (journal.is_none()
                    || !steps.iter().any(|e| {
                        e.kind == StepKind::RemoteEnd
                            && e.termination_digest.as_ref() == Some(termination_evidence_digest)
                    }))
            {
                return Err(bad());
            }
        } else if row.body_accepted
            || row.lease_fence.is_some()
            || row.lease_owner.is_some()
            || row.lease_expires.is_some()
            || row.remote != RemoteActivity::NotDispatched
            || row.logical
        {
            return Err(bad());
        }
        if row.status == JobStatus::Succeeded && row.applied.is_none() {
            return Err(bad());
        }
        if row.remote.blocks_invocation()
            && (active_id.as_deref() != Some(id)
                || active_fence != row.lease_fence
                || active_expires != row.lease_expires)
        {
            return Err(bad());
        }
        if active_id.as_deref() == Some(id) {
            seen_active = true;
            if !row.remote.blocks_invocation() || active_fence != Some(fence) {
                return Err(bad());
            }
        }
        check()?;
    }
    let max_sequence = sequences.last().copied().unwrap_or(0);
    let max_fence = fences.last().copied().unwrap_or(0);
    if max_sequence != parse_u64(&next_sequence)?
        || max_sequence != ids.len() as u64
        || max_fence != fence
        || max_fence != fences.len() as u64
        || active_id.is_some() != seen_active
    {
        return Err(bad());
    }
    check()
}
