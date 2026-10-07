//! Private queue recovery operations.
use super::*;

/// Validate only the supplied trusted registration. A full recovery companion
/// must enumerate every retained registration and qualify its evidence peers.
pub(super) fn validate_retained_queue(
    db: &Connection,
    config: &QueueConfig,
    discovery: &impl QueueDiscovery,
    schemas: &impl StockContractPort,
) -> Result<()> {
    use std::collections::BTreeSet;
    assert_registered(db, config)?;
    let mut fk = db.prepare("PRAGMA foreign_key_check")?;
    if fk.query([])?.next()?.is_some() {
        return Err(bad());
    }
    let (fence, active_id, active_fence, active_expires) = active(db, config)?;
    let next_sequence: String=db.query_row("SELECT next_sequence FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",
        params![config.registration.identity.deployment_id,config.registration.identity.physical_database_id],|r|r.get(0))?;
    let ids = all_ids(db, config)?;
    let mut sequences = BTreeSet::new();
    let mut fences = BTreeSet::new();
    let mut seen_active = false;
    for id in &ids {
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
        discovery.validate_retained_enqueue(&original, &row.request, &row.scope, config)?;
        if aggregate_liability(db, id)? != row.liability {
            return Err(bad());
        }
        let mut q=db.prepare("SELECT fence,original_leased_job_json FROM queue_attempts WHERE job_id=?1 ORDER BY length(fence),fence COLLATE BINARY")?;
        let attempts = q
            .query_map([id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if attempts.len() != row.attempts as usize {
            return Err(bad());
        }
        let mut latest = None;
        for (index, (fence_text, body)) in attempts.into_iter().enumerate() {
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
            let steps = retained_steps(db, &attempt)?;
            let outcomes = retained_outcomes(db, &attempt)?;
            let mut origins = Vec::new();
            if attempt.pending_byte_liability.required {
                origins.push("claim");
            }
            if journal.is_some() {
                origins.push("journal");
            }
            let finish_count = outcomes
                .iter()
                .filter(|outcome| outcome.kind == "finish")
                .count();
            if finish_count > 1 {
                return Err(bad());
            }
            if finish_count == 1 {
                origins.push("finish");
            }
            if liability_events
                .iter()
                .map(|(origin, _)| origin.as_str())
                .collect::<Vec<_>>()
                != origins
            {
                return Err(bad());
            }
            let mut prior_at = 0;
            for (outcome_index, outcome) in outcomes.iter().enumerate() {
                if outcome.at < prior_at || outcome.at > row.updated {
                    return Err(bad());
                }
                prior_at = outcome.at;
                check_finish_evidence(&outcome.report, &outcome.steps).map_err(|_| bad())?;
                if outcome.kind == "admission-reject" {
                    require_retry_proof(
                        outcomes
                            .get(outcome_index.checked_sub(1).ok_or_else(bad)?)
                            .ok_or_else(bad)?,
                    )?;
                    if outcome.report.disposition != FinishDisposition::Failed(FailureCode::Rejected)
                        || !outcome.steps.iter().any(|e| e.kind == StepKind::Other
                            && e.codec == "houseatlas-admission/1"
                            && decoded(std::str::from_utf8(&e.payload).unwrap_or("")).ok()
                                == Some(json!({"format":"houseatlas-admission/1","at":outcome.at.to_string(),"reason":"Rejected"})))
                    { return Err(bad()); }
                }
                if outcome.kind == "finish"
                    && !outcome.liabilities.iter().any(|(origin, liability)| {
                        origin == "finish" && liability == &outcome.report.storage_liability
                    })
                {
                    return Err(bad());
                }
            }
            if attempt.attempt < row.attempts {
                require_retry_proof(outcomes.last().ok_or_else(bad)?)?;
            } else {
                validate_latest_outcome(&row, outcomes.last())?;
            }
            latest = Some((attempt, journal, steps));
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
    Ok(())
}
