//! Private queue repository operations.
use super::*;

pub(super) struct StoredJob {
    pub(super) id: String,
    pub(super) deployment: String,
    pub(super) physical: String,
    pub(super) sequence: u64,
    pub(super) original_json: String,
    pub(super) request: EnqueueRequest,
    pub(super) scope: CanonicalScope,
    pub(super) status: JobStatus,
    pub(super) attempts: u32,
    pub(super) created: u64,
    pub(super) updated: u64,
    pub(super) next: Option<u64>,
    pub(super) lease_fence: Option<u64>,
    pub(super) lease_owner: Option<String>,
    pub(super) lease_expires: Option<u64>,
    pub(super) body_accepted: bool,
    pub(super) remote: RemoteActivity,
    pub(super) logical: bool,
    pub(super) applied: Option<AppliedWrite>,
    pub(super) failure: Option<FailureCode>,
    pub(super) liability: StorageLiability,
    pub(super) reconciliation: Option<Value>,
}
impl StoredJob {
    pub(super) fn snapshot(&self) -> JobSnapshot {
        debug_assert!(self.sequence > 0);
        JobSnapshot {
            job_id: JobId(self.id.clone()),
            receipt: self.request.receipt.clone(),
            partition: self.request.partition.clone(),
            status: self.status,
            attempts: self.attempts,
            created_at: self.created,
            updated_at: self.updated,
            next_attempt_at: self.next,
            applied: self.applied.clone(),
            failure: self.failure,
            remote_activity: self.remote.clone(),
            unknown_scope_fence_retained: self.logical,
            storage_liability: self.liability.clone(),
            body_accepted: self.body_accepted,
        }
    }
    pub(super) fn lease(&self, config: &QueueConfig) -> Result<Lease> {
        if self.deployment != config.registration.identity.deployment_id
            || self.physical != config.registration.identity.physical_database_id
        {
            return Err(stale());
        }
        Ok(Lease {
            job_id: JobId(self.id.clone()),
            fence: self.lease_fence.ok_or_else(stale)?,
            expires_at: self.lease_expires.ok_or_else(stale)?,
            owner_id: self.lease_owner.clone().ok_or_else(stale)?,
            physical_identity: config.registration.identity.clone(),
        })
    }
    pub(super) fn leased(&self, config: &QueueConfig) -> Result<LeasedJob> {
        Ok(LeasedJob {
            lease: self.lease(config)?,
            request: self.request.clone(),
            attempt: self.attempts,
            canonical_scope: self.scope.clone(),
            pending_byte_liability: self.request.pending_byte_liability,
        })
    }
}
pub(super) fn load(db: &Connection, id: &str) -> Result<StoredJob> {
    type Raw = (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        String,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        String,
    );
    let x:Raw=db.query_row("SELECT deployment_id,physical_database_id,sequence,original_json,request_json,canonical_scope_json,status,attempts,created_at,updated_at,next_attempt_at,lease_fence,lease_owner,lease_expires,body_accepted,activity,termination_digest,logical_fence,applied_json,failure,liability_json FROM queue_jobs WHERE job_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?,r.get(13)?,r.get(14)?,r.get(15)?,r.get(16)?,r.get(17)?,r.get(18)?,r.get(19)?,r.get(20)?)))?;
    let (
        deployment,
        physical,
        sequence,
        original_json,
        request_json,
        scope_json,
        status_name,
        attempts,
        created,
        updated,
        next,
        lease_fence,
        lease_owner,
        lease_expires,
        body,
        activity_name,
        termination,
        logical,
        applied_json,
        failure_json,
        liability_json,
    ) = x;
    let parsed_sequence = parse_u64(&sequence)?;
    let expected_id = format!(
        "q{}",
        digest(
            format!(
                "{}:{}:{}:{}",
                deployment.len(),
                deployment,
                physical,
                parsed_sequence
            )
            .as_bytes()
        )
    );
    if expected_id != id {
        return Err(bad());
    }
    let request = request(&decoded(&request_json)?)?;
    let sql_receipt: (String, String, String, String) = db.query_row(
        "SELECT workspace_id,home_id,actor_id,mutation_id FROM queue_jobs WHERE job_id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    if sql_receipt
        != (
            request.receipt.workspace_id.clone(),
            request.receipt.home_id.clone(),
            request.receipt.actor_id.clone(),
            request.receipt.mutation_id.clone(),
        )
        || encoded(&request_value(&request))? != request_json
    {
        return Err(bad());
    }
    let stored_digest: String = db.query_row(
        "SELECT intent_digest FROM queue_jobs WHERE job_id=?1",
        [id],
        |r| r.get(0),
    )?;
    if stored_digest != request.intent.request_digest.as_hex() {
        return Err(bad());
    }
    let scope = scope(&decoded(&scope_json)?)?;
    if encoded(&scope_value(&scope))? != scope_json {
        return Err(bad());
    }
    let (reconciliation_json, codec_version): (Option<String>, i64) = db.query_row(
        "SELECT reconciliation_json,codec_version FROM queue_jobs WHERE job_id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let retained_applied = applied_json
        .as_deref()
        .map(|value| applied(&decoded(value)?))
        .transpose()?;
    let retained_liability = liability(&decoded(&liability_json)?)?;
    let retained_reconciliation = reconciliation_json.as_deref().map(decoded).transpose()?;
    if codec_version != 1
        || retained_applied
            .as_ref()
            .map(|value| encoded(&applied_value(value)))
            .transpose()?
            != applied_json
        || encoded(&liability_value(&retained_liability))? != liability_json
        || retained_reconciliation.as_ref().map(encoded).transpose()? != reconciliation_json
    {
        return Err(bad());
    }
    if attempts < 0
        || attempts > u32::MAX as i64
        || !matches!(body, 0 | 1)
        || !matches!(logical, 0 | 1)
    {
        return Err(bad());
    }
    Ok(StoredJob {
        id: id.to_owned(),
        deployment,
        physical,
        sequence: parsed_sequence,
        original_json,
        request,
        scope,
        status: status(&status_name)?,
        attempts: attempts as u32,
        created: parse_u64(&created)?,
        updated: parse_u64(&updated)?,
        next: next.as_deref().map(parse_u64).transpose()?,
        lease_fence: lease_fence.as_deref().map(parse_u64).transpose()?,
        lease_owner,
        lease_expires: lease_expires.as_deref().map(parse_u64).transpose()?,
        body_accepted: body == 1,
        remote: activity(&activity_name, termination)?,
        logical: logical == 1,
        applied: retained_applied,
        failure: failure_json.as_deref().map(failure).transpose()?,
        liability: retained_liability,
        reconciliation: retained_reconciliation,
    })
}
pub(super) fn all_ids(db: &Connection, c: &QueueConfig) -> Result<Vec<String>> {
    let r = &c.registration.identity;
    let mut q=db.prepare("SELECT job_id FROM queue_jobs WHERE deployment_id=?1 AND physical_database_id=?2 ORDER BY length(sequence),sequence COLLATE BINARY")?;
    Ok(
        q.query_map(params![r.deployment_id, r.physical_database_id], |row| {
            row.get(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?,
    )
}
pub(super) fn due_ids(db: &Connection, c: &QueueConfig) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for id in all_ids(db, c)? {
        let row = load(db, &id)?;
        if matches!(row.status, JobStatus::Queued | JobStatus::RetryScheduled) {
            out.push(id);
        }
    }
    Ok(out)
}
pub(super) fn register(
    db: &mut Connection,
    c: &QueueConfig,
    precommit: impl FnOnce() -> Result<()>,
) -> Result<()> {
    c.validate().map_err(|_| invalid())?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let r = &c.registration;
    let configuration = encoded(&config_value(c))?;
    let prior:Option<(String,String,String)>=tx.query_row("SELECT configuration_digest,configuration_json,owner_id FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",params![r.identity.deployment_id,r.identity.physical_database_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
    match prior {
        Some((hash, blob, owner))
            if hash == r.identity.configuration_digest.as_hex()
                && blob == configuration
                && owner == r.dispatcher_owner_id => {}
        Some(_) => return Err(conflict()),
        None => {
            tx.execute("INSERT INTO queue_physical(deployment_id,physical_database_id,configuration_digest,configuration_json,owner_id,next_sequence,fence) VALUES(?1,?2,?3,?4,?5,'0','0')",params![r.identity.deployment_id,r.identity.physical_database_id,r.identity.configuration_digest.as_hex(),configuration,r.dispatcher_owner_id])?;
        }
    }
    for alias in &r.aliases {
        let p = &alias.partition;
        let prior:Option<(String,String)>=tx.query_row("SELECT physical_database_id,canonical_collection_id FROM queue_aliases WHERE deployment_id=?1 AND workspace_id=?2 AND home_id=?3 AND source_instance_id=?4 AND collection_id=?5",params![r.identity.deployment_id,p.workspace_id,p.home_id,p.source_instance_id,p.collection_id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
        match prior {
            Some((physical, canonical))
                if physical == r.identity.physical_database_id
                    && canonical == alias.canonical_collection_id => {}
            Some(_) => return Err(conflict()),
            None => {
                tx.execute(
                    "INSERT INTO queue_aliases VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        r.identity.deployment_id,
                        r.identity.physical_database_id,
                        p.workspace_id,
                        p.home_id,
                        p.source_instance_id,
                        p.collection_id,
                        alias.canonical_collection_id
                    ],
                )?;
            }
        }
    }
    assert_registered(&tx, c)?;
    precommit()?;
    tx.commit()?;
    Ok(())
}
pub(super) fn assert_registered(db: &Connection, c: &QueueConfig) -> Result<()> {
    c.validate().map_err(|_| invalid())?;
    let r = &c.registration;
    let (hash, blob, owner): (String, String, String) = db.query_row(
        "SELECT configuration_digest,configuration_json,owner_id FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",
        params![r.identity.deployment_id, r.identity.physical_database_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|_| conflict())?;
    if hash != r.identity.configuration_digest.as_hex()
        || blob != encoded(&config_value(c))?
        || owner != r.dispatcher_owner_id
    {
        return Err(conflict());
    }
    let mut q = db.prepare("SELECT workspace_id,home_id,source_instance_id,collection_id,canonical_collection_id FROM queue_aliases WHERE deployment_id=?1 AND physical_database_id=?2")?;
    let rows = q
        .query_map(
            params![r.identity.deployment_id, r.identity.physical_database_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() != r.aliases.len()
        || rows.iter().any(|(w, h, s, c, p)| {
            !r.aliases.iter().any(|a| {
                a.partition.workspace_id == *w
                    && a.partition.home_id == *h
                    && a.partition.source_instance_id == *s
                    && a.partition.collection_id == *c
                    && a.canonical_collection_id == *p
            })
        })
    {
        return Err(conflict());
    }
    Ok(())
}
pub(super) fn assert_physical(row: &StoredJob, config: &QueueConfig) -> Result<()> {
    if row.deployment != config.registration.identity.deployment_id
        || row.physical != config.registration.identity.physical_database_id
    {
        return Err(conflict());
    }
    Ok(())
}
type PhysicalSlot = (u64, Option<String>, Option<u64>, Option<u64>);
pub(super) fn active(db: &Connection, c: &QueueConfig) -> Result<PhysicalSlot> {
    let r = &c.registration.identity;
    let (fence,id,active_fence,expires):(String,Option<String>,Option<String>,Option<String>)=db.query_row("SELECT fence,active_job_id,active_fence,expires_at FROM queue_physical WHERE deployment_id=?1 AND physical_database_id=?2",params![r.deployment_id,r.physical_database_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
    Ok((
        parse_u64(&fence)?,
        id,
        active_fence.as_deref().map(parse_u64).transpose()?,
        expires.as_deref().map(parse_u64).transpose()?,
    ))
}
pub(super) fn update_active(
    db: &Connection,
    c: &QueueConfig,
    id: Option<&str>,
    fence: Option<u64>,
    expires: Option<u64>,
) -> Result<()> {
    let r = &c.registration.identity;
    db.execute("UPDATE queue_physical SET active_job_id=?1,active_fence=?2,expires_at=?3 WHERE deployment_id=?4 AND physical_database_id=?5",params![id,fence.map(decimal),expires.map(decimal),r.deployment_id,r.physical_database_id])?;
    Ok(())
}
pub(super) fn validate_lease(
    db: &Connection,
    c: &QueueConfig,
    lease: &Lease,
    require_active: bool,
) -> Result<StoredJob> {
    if lease.physical_identity != c.registration.identity {
        return Err(stale());
    }
    let row = load(db, &lease.job_id.0).map_err(|_| stale())?;
    if row.lease(c)? != *lease {
        return Err(stale());
    }
    let original: String = db
        .query_row(
            "SELECT original_leased_job_json FROM queue_attempts WHERE job_id=?1 AND fence=?2",
            params![lease.job_id.0, decimal(lease.fence)],
            |r| r.get(0),
        )
        .map_err(|_| stale())?;
    if original != encoded(&leased_value(&row.leased(c)?))? {
        return Err(stale());
    }
    if require_active {
        let (_, id, fence, _) = active(db, c)?;
        if id.as_deref() != Some(&lease.job_id.0) || fence != Some(lease.fence) {
            return Err(stale());
        }
    }
    Ok(row)
}
pub(super) fn validate_job(db: &Connection, c: &QueueConfig, job: &LeasedJob) -> Result<StoredJob> {
    let row = validate_lease(db, c, &job.lease, true)?;
    if row.leased(c)? != *job {
        return Err(stale());
    }
    Ok(row)
}
pub(super) fn queue_snapshot(
    db: &Connection,
    c: &QueueConfig,
    pending: PendingByteLiability,
) -> Result<QueueSnapshot> {
    let (fence, active_id, _, _) = active(db, c)?;
    let dispatcher = DispatcherState {
        owner_id: Some(c.registration.dispatcher_owner_id.clone()),
        epoch: fence.max(1),
        active_operation_id: active_id.clone().map(JobId),
        activity: active_id
            .as_deref()
            .map(|id| load(db, id).map(|j| j.remote))
            .transpose()?
            .unwrap_or(RemoteActivity::NotDispatched),
    };
    let mut waiting = Vec::new();
    let mut logical_fences = Vec::new();
    let mut total = zero_liability();
    for id in all_ids(db, c)? {
        let row = load(db, &id)?;
        if matches!(row.status, JobStatus::Queued | JobStatus::RetryScheduled) {
            waiting.push(WaitingIntent {
                operation_id: JobId(id.clone()),
                request_digest: row.request.intent.request_digest.clone(),
                enqueued_at: row.created,
            });
        }
        if row.logical {
            logical_fences.push(LogicalFence {
                operation_id: JobId(id),
                scope: row.scope.clone(),
            });
        }
        liability_sum(&mut total, &row.liability)?;
    }
    Ok(QueueSnapshot {
        identity: c.registration.identity.clone(),
        dispatcher,
        waiting,
        existing_operation: None,
        logical_fences,
        storage_liability: total,
        pending_byte_liability: pending,
    })
}
pub(super) fn disposition(
    db: &Connection,
    row: &StoredJob,
    now: u64,
    value: &FinishDisposition,
    evidence: Option<&ReconciliationEvidence>,
) -> Result<()> {
    let (state, next, applied, failure, logical) = match value {
        FinishDisposition::Succeeded(v) => (
            "succeeded",
            None,
            Some(encoded(&applied_value(v))?),
            None,
            false,
        ),
        FinishDisposition::Failed(v) => ("failed", None, None, Some(format!("{v:?}")), false),
        FinishDisposition::RetryAt { at, reason } if *at > now => (
            "retry",
            Some(decimal(*at)),
            None,
            Some(format!("{reason:?}")),
            false,
        ),
        FinishDisposition::RetryAt { .. } => return Err(invalid()),
        FinishDisposition::Hold(v) => ("held", None, None, Some(format!("{v:?}")), true),
        FinishDisposition::Partial(v) => ("partial", None, None, Some(format!("{v:?}")), true),
    };
    let state = if matches!(value, FinishDisposition::RetryAt { .. }) {
        state
    } else {
        match evidence.map(|e| &e.kind) {
            Some(ReconciliationKind::CurrentStateObserved) => "resolved-observed",
            Some(ReconciliationKind::Human { .. }) => "resolved-human",
            None => state,
        }
    };
    let evidence_json=evidence.map(|e|json!({"reference":e.private_evidence_reference,"digest":e.evidence_digest.as_hex(),"kind":format!("{:?}",e.kind)})).map(|v|encoded(&v)).transpose()?;
    db.execute("UPDATE queue_jobs SET status=?1,updated_at=?2,next_attempt_at=?3,applied_json=?4,failure=?5,logical_fence=?6,reconciliation_json=COALESCE(?7,reconciliation_json) WHERE job_id=?8",params![state,decimal(now.max(row.updated)),next,applied,failure,logical as i64,evidence_json,row.id])?;
    Ok(())
}
pub(super) fn store_activity(db: &Connection, id: &str, remote: &RemoteActivity) -> Result<()> {
    let (state, hash) = activity_parts(remote);
    db.execute(
        "UPDATE queue_jobs SET activity=?1,termination_digest=?2 WHERE job_id=?3",
        params![state, hash, id],
    )?;
    Ok(())
}
