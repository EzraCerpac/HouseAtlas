//! Synthetic SQLite adapter for compiler review. No production schema ownership.
use super::jobs::*;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug)]
pub enum ExampleError {
    Sqlite(rusqlite::Error),
    Conflict,
    InvalidRow,
    StaleLease,
    Exhausted,
}
impl From<rusqlite::Error> for ExampleError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}
impl std::fmt::Display for ExampleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "synthetic SQLite error: {error}"),
            other => write!(f, "{other:?}"),
        }
    }
}
pub type Result<T> = std::result::Result<T, ExampleError>;
fn integer(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| ExampleError::Exhausted)
}
fn unsigned(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| ExampleError::InvalidRow)
}
fn digest(value: String) -> Result<Digest> {
    Digest::from_hex(value).map_err(|_| ExampleError::InvalidRow)
}

pub struct SyntheticSqliteStore {
    connection: Connection,
    config: QueueConfig,
}
impl SyntheticSqliteStore {
    pub fn open(path: &Path, config: &QueueConfig) -> Result<Self> {
        config.validate().map_err(|_| ExampleError::InvalidRow)?;
        let connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS global_writer(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            deployment TEXT NOT NULL, physical TEXT NOT NULL, configuration TEXT NOT NULL,
            owner TEXT NOT NULL, fence INTEGER NOT NULL, active_job INTEGER, expires_at INTEGER);
          CREATE TABLE IF NOT EXISTS jobs(seq INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace TEXT NOT NULL,home TEXT NOT NULL,actor TEXT NOT NULL,mutation TEXT NOT NULL,
            instance TEXT NOT NULL,collection TEXT NOT NULL,contract TEXT NOT NULL,operation TEXT NOT NULL,
            target TEXT,request_digest TEXT NOT NULL,scope_kind TEXT NOT NULL,canonical_collection TEXT NOT NULL,
            pending_required INTEGER NOT NULL,pending_reserved INTEGER,status TEXT NOT NULL,attempts INTEGER NOT NULL,
            created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,next_at INTEGER,
            lease_fence INTEGER,lease_owner TEXT,lease_expires INTEGER,body_accepted INTEGER NOT NULL,
            activity TEXT NOT NULL,termination_digest TEXT,logical_held INTEGER NOT NULL,
            applied_external TEXT,applied_date TEXT,response_digest TEXT,readback_digest TEXT,observed_at INTEGER,
            failure TEXT,evidence TEXT,resolution_digest TEXT,resolution_actor TEXT,
            accounting_complete INTEGER NOT NULL,known_bytes INTEGER NOT NULL,reserved_bytes INTEGER,
            metadata TEXT NOT NULL,bytes TEXT NOT NULL,closure TEXT NOT NULL,orphan TEXT,unresolved INTEGER NOT NULL,
            UNIQUE(workspace,home,actor,mutation));
          CREATE TABLE IF NOT EXISTS scope_resources(job INTEGER NOT NULL REFERENCES jobs(seq),position INTEGER NOT NULL,
            kind TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(job,position));
          CREATE TABLE IF NOT EXISTS liability_evidence(seq INTEGER PRIMARY KEY AUTOINCREMENT,
            job INTEGER NOT NULL REFERENCES jobs(seq),fence INTEGER NOT NULL,
            accounting_complete INTEGER NOT NULL,known_bytes INTEGER NOT NULL,reserved_bytes INTEGER,
            metadata TEXT NOT NULL,bytes TEXT NOT NULL,closure TEXT NOT NULL,orphan TEXT,unresolved INTEGER NOT NULL);")?;
        let registration = &config.registration;
        connection.execute(
            "INSERT OR IGNORE INTO global_writer VALUES(1,?,?,?,?,0,NULL,NULL)",
            params![
                registration.identity.deployment_id,
                registration.identity.physical_database_id,
                registration.identity.configuration_digest.as_hex(),
                registration.dispatcher_owner_id
            ],
        )?;
        let stored: (String, String, String, String) = connection.query_row(
            "SELECT deployment,physical,configuration,owner FROM global_writer WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if stored
            != (
                registration.identity.deployment_id.clone(),
                registration.identity.physical_database_id.clone(),
                registration.identity.configuration_digest.as_hex().into(),
                registration.dispatcher_owner_id.clone(),
            )
        {
            return Err(ExampleError::InvalidRow);
        }
        Ok(Self {
            connection,
            config: config.clone(),
        })
    }
    pub fn slot_count(&self) -> Result<u32> {
        Ok(self
            .connection
            .query_row("SELECT COUNT(*) FROM global_writer", [], |row| row.get(0))?)
    }
    pub fn sqlite_version(&self) -> Result<String> {
        Ok(self
            .connection
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))?)
    }
}

fn resource_kind(value: &str) -> Result<ResourceKind> {
    Ok(match value {
        "Entity" => ResourceKind::Entity,
        "Location" => ResourceKind::Location,
        "Tag" => ResourceKind::Tag,
        "Template" => ResourceKind::Template,
        "EntityType" => ResourceKind::EntityType,
        "Field" => ResourceKind::Field,
        "File" => ResourceKind::File,
        "Maintenance" => ResourceKind::Maintenance,
        _ => return Err(ExampleError::InvalidRow),
    })
}
fn request(connection: &Connection, id: i64) -> Result<EnqueueRequest> {
    type StoredRequest = (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        bool,
        Option<i64>,
    );
    let (workspace,home,actor,mutation,instance,collection,contract,operation,target,hash,kind,required,reserved):StoredRequest=
      connection.query_row("SELECT workspace,home,actor,mutation,instance,collection,contract,operation,target,request_digest,scope_kind,pending_required,pending_reserved FROM jobs WHERE seq=?",[id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?,row.get(9)?,row.get(10)?,row.get(11)?,row.get(12)?)))?;
    let selection = match kind.as_str() {
        "collection" => ScopeSelection::Collection,
        "resources" => {
            let mut statement = connection
                .prepare("SELECT kind,id FROM scope_resources WHERE job=? ORDER BY position")?;
            let rows = statement.query_map([id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut resources = Vec::new();
            for row in rows {
                let (kind, id) = row?;
                resources.push(ResourceRef {
                    kind: resource_kind(&kind)?,
                    id,
                });
            }
            ScopeSelection::Resources(resources)
        }
        _ => return Err(ExampleError::InvalidRow),
    };
    Ok(EnqueueRequest {
        receipt: ReceiptKey {
            workspace_id: workspace.clone(),
            home_id: home.clone(),
            actor_id: actor,
            mutation_id: mutation,
        },
        partition: SourcePartition {
            workspace_id: workspace,
            home_id: home,
            source_instance_id: instance.clone(),
            collection_id: collection.clone(),
        },
        intent: IntentMetadata {
            contract_id: contract,
            operation_id: operation,
            target_external_id: target,
            request_digest: digest(hash)?,
        },
        write_scope: WriteScope {
            source_instance_id: instance,
            collection_id: collection,
            selection,
        },
        pending_byte_liability: PendingByteLiability {
            required,
            reserved_bytes: reserved.map(unsigned).transpose()?,
        },
    })
}
fn ids(connection: &Connection, sql: &str) -> Result<Vec<i64>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
fn status(value: &str) -> Result<JobStatus> {
    Ok(match value {
        "prepared" => JobStatus::Prepared,
        "queued" => JobStatus::Queued,
        "running" => JobStatus::Running,
        "retry" => JobStatus::RetryScheduled,
        "succeeded" => JobStatus::Succeeded,
        "failed" => JobStatus::Failed,
        "held" => JobStatus::NeedsReconciliation,
        "partial" => JobStatus::Partial,
        "resolved-observed" => JobStatus::ResolvedObserved,
        "resolved-human" => JobStatus::ResolvedByHuman,
        _ => return Err(ExampleError::InvalidRow),
    })
}
fn failure(value: Option<String>) -> Result<Option<FailureCode>> {
    Ok(match value.as_deref() {
        None => None,
        Some("Unavailable") => Some(FailureCode::Unavailable),
        Some("RateLimited") => Some(FailureCode::RateLimited),
        Some("Rejected") => Some(FailureCode::Rejected),
        Some("AccessDenied") => Some(FailureCode::AccessDenied),
        Some("InvalidPreparedPayload") => Some(FailureCode::InvalidPreparedPayload),
        Some("OutcomeUnknown") => Some(FailureCode::OutcomeUnknown),
        Some("LeaseExpired") => Some(FailureCode::LeaseExpired),
        Some("AdmissionWaitExpired") => Some(FailureCode::AdmissionWaitExpired),
        _ => return Err(ExampleError::InvalidRow),
    })
}
fn activity(connection: &Connection, id: i64) -> Result<RemoteActivity> {
    let (state, hash): (String, Option<String>) = connection.query_row(
        "SELECT activity,termination_digest FROM jobs WHERE seq=?",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(match state.as_str() {
        "not-dispatched" => RemoteActivity::NotDispatched,
        "active" => RemoteActivity::Invoked(InvokedRemoteActivity::Active),
        "end-unproven" => RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven),
        "ended-proven" => RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest: digest(hash.ok_or(ExampleError::InvalidRow)?)?,
        }),
        _ => return Err(ExampleError::InvalidRow),
    })
}
type StoredLiability = (
    bool,
    i64,
    Option<i64>,
    String,
    String,
    String,
    Option<String>,
    u32,
);
fn liability(connection: &Connection, id: i64) -> Result<StorageLiability> {
    let(complete,known,reserved,metadata,bytes,closure,orphan,unresolved):StoredLiability=connection.query_row("SELECT accounting_complete,known_bytes,reserved_bytes,metadata,bytes,closure,orphan,unresolved FROM jobs WHERE seq=?",[id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)))?;
    decode_liability((
        complete, known, reserved, metadata, bytes, closure, orphan, unresolved,
    ))
}
fn decode_liability(value: StoredLiability) -> Result<StorageLiability> {
    let (complete, known, reserved, metadata, bytes, closure, orphan, unresolved) = value;
    let accounting = if complete {
        ByteAccounting::Complete {
            known_bytes: unsigned(known)?,
            reserved_bytes: unsigned(reserved.ok_or(ExampleError::InvalidRow)?)?,
        }
    } else {
        if reserved.is_some() {
            return Err(ExampleError::InvalidRow);
        }
        ByteAccounting::Incomplete {
            known_bytes: unsigned(known)?,
        }
    };
    Ok(StorageLiability {
        accounting,
        metadata_commit_evidence: match metadata.as_str() {
            "NotDispatched" => MetadataCommitEvidence::NotDispatched,
            "ObservedNotCommitted" => MetadataCommitEvidence::ObservedNotCommitted,
            "ObservedCommitted" => MetadataCommitEvidence::ObservedCommitted,
            "Unknown" => MetadataCommitEvidence::Unknown,
            _ => return Err(ExampleError::InvalidRow),
        },
        byte_disposition: match bytes.as_str() {
            "None" => ByteDisposition::None,
            "RetainedUnbound" => ByteDisposition::RetainedUnbound,
            "RetainedBound" => ByteDisposition::RetainedBound,
            "Unknown" => ByteDisposition::Unknown,
            _ => return Err(ExampleError::InvalidRow),
        },
        reference_closure_evidence: match closure.as_str() {
            "Unassessed" => ReferenceClosureEvidence::Unassessed,
            "Incomplete" => ReferenceClosureEvidence::Incomplete,
            "OperatorEvidenced" => ReferenceClosureEvidence::OperatorEvidenced,
            _ => return Err(ExampleError::InvalidRow),
        },
        orphan_candidate_id: orphan,
        unresolved_attempts: unresolved,
    })
}
fn snapshot(connection: &Connection, id: i64) -> Result<JobSnapshot> {
    let input = request(connection, id)?;
    type StoredSnapshot = (
        String,
        u32,
        i64,
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        bool,
        bool,
    );
    let(state,attempts,created,updated,next,external,date,response,readback,observed,problem,logical,body):StoredSnapshot=connection.query_row("SELECT status,attempts,created_at,updated_at,next_at,applied_external,applied_date,response_digest,readback_digest,observed_at,failure,logical_held,body_accepted FROM jobs WHERE seq=?",[id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?,row.get(9)?,row.get(10)?,row.get(11)?,row.get(12)?)))?;
    let applied = match (response, readback, observed) {
        (Some(response), Some(readback), Some(at)) => Some(AppliedWrite {
            external_id: external,
            source_updated_at: date,
            observation: ObservedWriteEvidence {
                response_digest: digest(response)?,
                readback_digest: digest(readback)?,
                observed_at: unsigned(at)?,
            },
        }),
        (None, None, None) => None,
        _ => return Err(ExampleError::InvalidRow),
    };
    Ok(JobSnapshot {
        job_id: JobId(id.to_string()),
        receipt: input.receipt,
        partition: input.partition,
        status: status(&state)?,
        attempts,
        created_at: unsigned(created)?,
        updated_at: unsigned(updated)?,
        next_attempt_at: next.map(unsigned).transpose()?,
        applied,
        failure: failure(problem)?,
        remote_activity: activity(connection, id)?,
        unknown_scope_fence_retained: logical,
        storage_liability: liability(connection, id)?,
        body_accepted: body,
    })
}
fn active(connection: &Connection) -> Result<(u64, Option<i64>, Option<u64>)> {
    let (fence, id, expires): (i64, Option<i64>, Option<i64>) = connection.query_row(
        "SELECT fence,active_job,expires_at FROM global_writer WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok((unsigned(fence)?, id, expires.map(unsigned).transpose()?))
}
fn lease(connection: &Connection, id: i64, config: &QueueConfig) -> Result<Lease> {
    let (fence, owner, expires): (i64, String, i64) = connection.query_row(
        "SELECT lease_fence,lease_owner,lease_expires FROM jobs WHERE seq=?",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok(Lease {
        job_id: JobId(id.to_string()),
        fence: unsigned(fence)?,
        expires_at: unsigned(expires)?,
        owner_id: owner,
        physical_identity: config.registration.identity.clone(),
    })
}
fn validate_lease(
    connection: &Connection,
    expected: &Lease,
    config: &QueueConfig,
    require_active: bool,
) -> Result<i64> {
    let id = expected
        .job_id
        .0
        .parse::<i64>()
        .map_err(|_| ExampleError::StaleLease)?;
    if lease(connection, id, config)? != *expected {
        return Err(ExampleError::StaleLease);
    }
    if require_active {
        let (fence, current, _) = active(connection)?;
        if current != Some(id) || fence != expected.fence {
            return Err(ExampleError::StaleLease);
        }
    }
    Ok(id)
}
fn store_activity(connection: &Connection, id: i64, value: &RemoteActivity) -> Result<()> {
    let (state, hash) = match value {
        RemoteActivity::NotDispatched => ("not-dispatched", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::Active) => ("active", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven) => ("end-unproven", None),
        RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
            termination_evidence_digest,
        }) => ("ended-proven", Some(termination_evidence_digest.as_hex())),
    };
    connection.execute(
        "UPDATE jobs SET activity=?,termination_digest=? WHERE seq=?",
        params![state, hash, id],
    )?;
    Ok(())
}
fn accounting_values(value: &ByteAccounting) -> (u64, Option<u64>) {
    match *value {
        ByteAccounting::Complete {
            known_bytes,
            reserved_bytes,
        } => (known_bytes, Some(reserved_bytes)),
        ByteAccounting::Incomplete { known_bytes } => (known_bytes, None),
    }
}
fn safe_sum(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .filter(|total| *total <= MAX_SAFE_INTEGER)
        .ok_or(ExampleError::Exhausted)
}
fn merge_liability_facts(held: &mut StorageLiability, incoming: &StorageLiability) {
    if held.metadata_commit_evidence == MetadataCommitEvidence::NotDispatched {
        held.metadata_commit_evidence = incoming.metadata_commit_evidence;
    } else if incoming.metadata_commit_evidence != MetadataCommitEvidence::NotDispatched
        && incoming.metadata_commit_evidence != held.metadata_commit_evidence
    {
        held.metadata_commit_evidence = MetadataCommitEvidence::Unknown;
    }
    if held.byte_disposition == ByteDisposition::None {
        held.byte_disposition = incoming.byte_disposition;
    } else if incoming.byte_disposition != ByteDisposition::None
        && incoming.byte_disposition != held.byte_disposition
    {
        held.byte_disposition = ByteDisposition::Unknown;
    }
    held.reference_closure_evidence = match (
        held.reference_closure_evidence,
        incoming.reference_closure_evidence,
    ) {
        (ReferenceClosureEvidence::Incomplete, _) | (_, ReferenceClosureEvidence::Incomplete) => {
            ReferenceClosureEvidence::Incomplete
        }
        (left, right) if left == right => left,
        _ => ReferenceClosureEvidence::Unassessed,
    };
    // This scalar is only a representative. Every orphan reference remains in
    // append-only liability_evidence, including different orphans in one attempt.
    if held.orphan_candidate_id.is_none() {
        held.orphan_candidate_id = incoming.orphan_candidate_id.clone();
    }
}
fn merge_attempt_liability(held: &mut StorageLiability, incoming: &StorageLiability) {
    let (known, reserved) = accounting_values(&held.accounting);
    let (incoming_known, incoming_reserved) = accounting_values(&incoming.accounting);
    held.accounting = match reserved.zip(incoming_reserved) {
        Some((reserved, incoming_reserved)) => ByteAccounting::Complete {
            known_bytes: known.max(incoming_known),
            reserved_bytes: reserved.max(incoming_reserved),
        },
        None => ByteAccounting::Incomplete {
            known_bytes: known.max(incoming_known),
        },
    };
    held.unresolved_attempts = held.unresolved_attempts.max(incoming.unresolved_attempts);
    merge_liability_facts(held, incoming);
}
fn append_liability(
    connection: &Connection,
    id: i64,
    fence: u64,
    value: &StorageLiability,
) -> Result<()> {
    let (known, reserved) = accounting_values(&value.accounting);
    if known > MAX_SAFE_INTEGER || reserved.is_some_and(|bytes| bytes > MAX_SAFE_INTEGER) {
        return Err(ExampleError::Exhausted);
    }
    connection.execute("INSERT INTO liability_evidence(job,fence,accounting_complete,known_bytes,reserved_bytes,metadata,bytes,closure,orphan,unresolved) VALUES(?,?,?,?,?,?,?,?,?,?)", params![id,integer(fence)?,reserved.is_some(),integer(known)?,reserved.map(integer).transpose()?,format!("{:?}",value.metadata_commit_evidence),format!("{:?}",value.byte_disposition),format!("{:?}",value.reference_closure_evidence),value.orphan_candidate_id,value.unresolved_attempts])?;
    Ok(())
}
fn store_liability(connection: &Connection, id: i64, value: &StorageLiability) -> Result<()> {
    let evidence_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM liability_evidence WHERE job=?",
        [id],
        |row| row.get(0),
    )?;
    if unsigned(evidence_count)? == 0 {
        // Retain an existing summary if opening an older synthetic checkpoint.
        // Fence zero is a retained baseline, not an invocation capability.
        append_liability(connection, id, 0, &liability(connection, id)?)?;
    }
    let fence: i64 =
        connection.query_row("SELECT lease_fence FROM jobs WHERE seq=?", [id], |row| {
            row.get(0)
        })?;
    append_liability(connection, id, unsigned(fence)?, value)?;
    let mut statement = connection.prepare("SELECT fence,accounting_complete,known_bytes,reserved_bytes,metadata,bytes,closure,orphan,unresolved FROM liability_evidence WHERE job=? ORDER BY seq")?;
    let rows = statement.query_map([id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            (
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ),
        ))
    })?;
    let mut attempts = BTreeMap::<u64, StorageLiability>::new();
    for row in rows {
        let (fence, stored) = row?;
        let incoming = decode_liability(stored)?;
        if let Some(held) = attempts.get_mut(&unsigned(fence)?) {
            merge_attempt_liability(held, &incoming);
        } else {
            attempts.insert(unsigned(fence)?, incoming);
        }
    }
    let mut values = attempts.into_values();
    let mut aggregate = values.next().ok_or(ExampleError::InvalidRow)?;
    for incoming in values {
        let (known, reserved) = accounting_values(&aggregate.accounting);
        let (incoming_known, incoming_reserved) = accounting_values(&incoming.accounting);
        let known_bytes = safe_sum(known, incoming_known)?;
        aggregate.accounting = match reserved.zip(incoming_reserved) {
            Some((left, right)) => ByteAccounting::Complete {
                known_bytes,
                reserved_bytes: safe_sum(left, right)?,
            },
            None => ByteAccounting::Incomplete { known_bytes },
        };
        aggregate.unresolved_attempts = aggregate
            .unresolved_attempts
            .checked_add(incoming.unresolved_attempts)
            .ok_or(ExampleError::Exhausted)?;
        merge_liability_facts(&mut aggregate, &incoming);
    }
    // No finish/reconcile operation is qualified to clean up an older attempt.
    // Monotonic per-attempt maxima can overreserve; they cannot forget liability.
    let value = &aggregate;
    let (complete, known, reserved) = match value.accounting {
        ByteAccounting::Complete {
            known_bytes,
            reserved_bytes,
        } => (true, known_bytes, Some(integer(reserved_bytes)?)),
        ByteAccounting::Incomplete { known_bytes } => (false, known_bytes, None),
    };
    connection.execute("UPDATE jobs SET accounting_complete=?,known_bytes=?,reserved_bytes=?,metadata=?,bytes=?,closure=?,orphan=?,unresolved=? WHERE seq=?",params![complete,integer(known)?,reserved,format!("{:?}",value.metadata_commit_evidence),format!("{:?}",value.byte_disposition),format!("{:?}",value.reference_closure_evidence),value.orphan_candidate_id,value.unresolved_attempts,id])?;
    Ok(())
}
fn store_disposition(
    connection: &Connection,
    id: i64,
    now: Timestamp,
    value: &FinishDisposition,
    evidence: Option<&ReconciliationEvidence>,
) -> Result<()> {
    let prior = snapshot(connection, id)?;
    let persisted_at = now.max(prior.updated_at); // A definite matching ack survives clock skew.
    let (state, next, applied, problem, held) = match value {
        FinishDisposition::Succeeded(applied) => ("succeeded", None, Some(applied), None, false),
        FinishDisposition::Failed(reason) => ("failed", None, None, Some(*reason), false),
        FinishDisposition::RetryAt { at, reason } => {
            if *at <= now {
                return Err(ExampleError::InvalidRow);
            }
            ("retry", Some(integer(*at)?), None, Some(*reason), false)
        }
        FinishDisposition::Hold(reason) => ("held", None, None, Some(*reason), true),
        FinishDisposition::Partial(reason) => ("partial", None, None, Some(*reason), true),
    };
    let state = match evidence.map(|evidence| &evidence.kind) {
        _ if matches!(value, FinishDisposition::RetryAt { .. }) => state,
        None => state,
        Some(ReconciliationKind::CurrentStateObserved) => "resolved-observed",
        Some(ReconciliationKind::Human { .. }) => "resolved-human",
    };
    connection.execute("UPDATE jobs SET status=?,updated_at=?,next_at=?,applied_external=?,applied_date=?,response_digest=?,readback_digest=?,observed_at=?,failure=?,logical_held=?,evidence=COALESCE(?,evidence),resolution_digest=COALESCE(?,resolution_digest),resolution_actor=COALESCE(?,resolution_actor) WHERE seq=?",params![state,integer(persisted_at)?,next,
      applied.and_then(|value|value.external_id.as_deref()),applied.and_then(|value|value.source_updated_at.as_deref()),
      applied.map(|value|value.observation.response_digest.as_hex()),applied.map(|value|value.observation.readback_digest.as_hex()),
      applied.map(|value|integer(value.observation.observed_at)).transpose()?,problem.map(|value|format!("{value:?}")),held,
      evidence.map(|value|value.private_evidence_reference.as_str()),evidence.map(|value|value.evidence_digest.as_hex()),
      evidence.and_then(|value|match &value.kind{ReconciliationKind::Human{actor_id}=>Some(actor_id.as_str()),_=>None}),id])?;
    Ok(())
}
fn queue_snapshot(
    connection: &Connection,
    config: &QueueConfig,
    pending: PendingByteLiability,
) -> Result<QueueSnapshot> {
    let (fence, id, _) = active(connection)?;
    let dispatcher = DispatcherState {
        owner_id: Some(config.registration.dispatcher_owner_id.clone()),
        epoch: fence.max(1),
        active_operation_id: id.map(|id| JobId(id.to_string())),
        activity: id
            .map(|id| activity(connection, id))
            .transpose()?
            .unwrap_or(RemoteActivity::NotDispatched),
    };
    let mut waiting = Vec::new();
    let mut fences = Vec::new();
    let mut known = 0_u64;
    let mut reserved = Some(0_u64);
    let mut unresolved = 0_u32;
    for id in ids(connection, "SELECT seq FROM jobs ORDER BY seq")? {
        let row = snapshot(connection, id)?;
        let input = request(connection, id)?;
        if matches!(row.status, JobStatus::Queued | JobStatus::RetryScheduled) {
            waiting.push(WaitingIntent {
                operation_id: row.job_id.clone(),
                request_digest: input.intent.request_digest.clone(),
                enqueued_at: row.created_at,
            });
        }
        if row.unknown_scope_fence_retained {
            fences.push(LogicalFence {
                operation_id: row.job_id,
                scope: config
                    .registration
                    .resolve(&input.partition, &input.write_scope)
                    .map_err(|_| ExampleError::InvalidRow)?,
            });
        }
        let row_known = match row.storage_liability.accounting {
            ByteAccounting::Complete { known_bytes, .. }
            | ByteAccounting::Incomplete { known_bytes } => known_bytes,
        };
        known = known
            .checked_add(row_known)
            .ok_or(ExampleError::Exhausted)?;
        reserved = reserved
            .zip(row.storage_liability.reserved_bytes())
            .map(|(left, right)| left.checked_add(right).ok_or(ExampleError::Exhausted))
            .transpose()?;
        unresolved = unresolved
            .checked_add(row.storage_liability.unresolved_attempts)
            .ok_or(ExampleError::Exhausted)?;
    }
    let accounting = match reserved {
        Some(reserved_bytes) => ByteAccounting::Complete {
            known_bytes: known,
            reserved_bytes,
        },
        None => ByteAccounting::Incomplete { known_bytes: known },
    };
    Ok(QueueSnapshot {
        identity: config.registration.identity.clone(),
        dispatcher,
        waiting,
        existing_operation: None,
        logical_fences: fences,
        storage_liability: StorageLiability {
            accounting,
            metadata_commit_evidence: MetadataCommitEvidence::Unknown,
            byte_disposition: ByteDisposition::Unknown,
            reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
            orphan_candidate_id: None,
            unresolved_attempts: unresolved,
        },
        pending_byte_liability: pending,
    })
}

impl QueueStore for SyntheticSqliteStore {
    type Error = ExampleError;
    fn enqueue(
        &mut self,
        input: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<EnqueueOutcome> {
        if config != &self.config
            || config
                .registration
                .resolve(&input.partition, &input.write_scope)
                .map_err(|_| ExampleError::InvalidRow)?
                != *scope
        {
            return Err(ExampleError::InvalidRow);
        }
        input.validate().map_err(|_| ExampleError::InvalidRow)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let receipt = &input.receipt;
        let existing: Option<i64> = transaction
            .query_row(
                "SELECT seq FROM jobs WHERE workspace=? AND home=? AND actor=? AND mutation=?",
                params![
                    receipt.workspace_id,
                    receipt.home_id,
                    receipt.actor_id,
                    receipt.mutation_id
                ],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            if request(&transaction, id)? != *input {
                return Err(ExampleError::Conflict);
            }
            let row = snapshot(&transaction, id)?;
            transaction.commit()?;
            return Ok(EnqueueOutcome::Replayed(row));
        }
        let state = queue_snapshot(&transaction, config, input.pending_byte_liability)?;
        if let QueueDecision::RejectedBeforeDispatch { reason } = decide_admission(
            &config.registration,
            &config.admission_profile,
            &state,
            scope,
            None,
            true,
        )
        .map_err(|_| ExampleError::InvalidRow)?
        {
            transaction.commit()?;
            return Ok(EnqueueOutcome::RejectedBeforeDispatch { reason });
        }
        let kind = match input.write_scope.selection {
            ScopeSelection::Collection => "collection",
            ScopeSelection::Resources(_) => "resources",
        };
        transaction.execute("INSERT INTO jobs(workspace,home,actor,mutation,instance,collection,contract,operation,target,request_digest,scope_kind,canonical_collection,pending_required,pending_reserved,status,attempts,created_at,updated_at,next_at,body_accepted,activity,logical_held,accounting_complete,known_bytes,reserved_bytes,metadata,bytes,closure,unresolved) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',0,?,?,?,0,'not-dispatched',0,1,0,0,'NotDispatched','None','Unassessed',0)",params![receipt.workspace_id,receipt.home_id,receipt.actor_id,receipt.mutation_id,input.partition.source_instance_id,input.partition.collection_id,input.intent.contract_id,input.intent.operation_id,input.intent.target_external_id,input.intent.request_digest.as_hex(),kind,scope.collection_id,input.pending_byte_liability.required,input.pending_byte_liability.reserved_bytes.map(integer).transpose()?,integer(now)?,integer(now)?,integer(now)?])?;
        let id = transaction.last_insert_rowid();
        if let ScopeSelection::Resources(resources) = &input.write_scope.selection {
            for (index, resource) in resources.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO scope_resources VALUES(?,?,?,?)",
                    params![
                        id,
                        index as i64,
                        format!("{:?}", resource.kind),
                        resource.id
                    ],
                )?;
            }
        }
        let result = snapshot(&transaction, id)?;
        transaction.commit()?;
        Ok(EnqueueOutcome::Enqueued(result))
    }
    fn claim_next(&mut self, now: Timestamp, config: &QueueConfig) -> Result<ClaimOutcome> {
        if config != &self.config {
            return Err(ExampleError::InvalidRow);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for id in ids(
            &transaction,
            "SELECT seq FROM jobs WHERE status='queued' AND attempts=0 ORDER BY seq",
        )? {
            let waiter = snapshot(&transaction, id)?;
            if config.admission_profile.never_dispatched_wait_expired(
                waiter.created_at,
                now,
                waiter.attempts,
            ) {
                transaction.execute(
                    "UPDATE jobs SET status='failed',updated_at=MAX(updated_at,?),next_at=NULL,failure='AdmissionWaitExpired' WHERE seq=?",
                    params![integer(now)?, id],
                )?;
            }
        }
        let (fence, current, expires) = active(&transaction)?;
        if let Some(id) = current {
            let expires_at = expires.ok_or(ExampleError::InvalidRow)?;
            if now >= expires_at {
                // This branch is compiled only; expiry qualification remains stopped.
                let prior = snapshot(&transaction, id)?;
                if prior.status == JobStatus::Running {
                    transaction.execute("UPDATE jobs SET status='held',updated_at=MAX(updated_at,?),failure='LeaseExpired',logical_held=1 WHERE seq=?", params![integer(now)?, id])?;
                } else {
                    transaction.execute(
                        "UPDATE jobs SET updated_at=MAX(updated_at,?) WHERE seq=?",
                        params![integer(now)?, id],
                    )?;
                }
                store_activity(
                    &transaction,
                    id,
                    &RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven),
                )?;
                let result = snapshot(&transaction, id)?;
                transaction.commit()?;
                return Ok(ClaimOutcome::HeldForReconciliation(result));
            }
            transaction.commit()?;
            return Ok(ClaimOutcome::Busy { expires_at });
        }
        let candidate:Option<i64>=transaction.query_row("SELECT seq FROM jobs WHERE status IN ('queued','retry') AND next_at<=? ORDER BY seq LIMIT 1",[integer(now)?],|row|row.get(0)).optional()?;
        let Some(id) = candidate else {
            transaction.commit()?;
            return Ok(ClaimOutcome::Idle);
        };
        let input = request(&transaction, id)?;
        let canonical_scope = config
            .registration
            .resolve(&input.partition, &input.write_scope)
            .map_err(|_| ExampleError::InvalidRow)?;
        let state = queue_snapshot(&transaction, config, input.pending_byte_liability)?;
        match decide_admission(
            &config.registration,
            &config.admission_profile,
            &state,
            &canonical_scope,
            Some(&JobId(id.to_string())),
            true,
        )
        .map_err(|_| ExampleError::InvalidRow)?
        {
            QueueDecision::QueueMetadata { reason } => {
                transaction.commit()?;
                return Ok(ClaimOutcome::Waiting { reason });
            }
            QueueDecision::RejectedBeforeDispatch { reason } => {
                transaction.execute(
                    "UPDATE jobs SET status='failed',updated_at=MAX(updated_at,?) WHERE seq=?",
                    params![integer(now)?, id],
                )?;
                transaction.commit()?;
                return Ok(ClaimOutcome::RejectedBeforeDispatch { reason });
            }
            QueueDecision::ReadyForExclusiveDispatch => {}
            _ => return Err(ExampleError::InvalidRow),
        }
        let fence = fence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(ExampleError::Exhausted)?;
        let expires_at = now
            .checked_add(config.lease_duration_ms)
            .ok_or(ExampleError::Exhausted)?;
        let attempt = snapshot(&transaction, id)?
            .attempts
            .checked_add(1)
            .ok_or(ExampleError::Exhausted)?;
        transaction.execute(
            "UPDATE global_writer SET fence=?,active_job=?,expires_at=? WHERE singleton=1",
            params![integer(fence)?, id, integer(expires_at)?],
        )?;
        // Admission and immutable intent are durable BEFORE staging bytes/I/O.
        transaction.execute("UPDATE jobs SET status='running',attempts=?,updated_at=MAX(updated_at,?),next_at=NULL,lease_fence=?,lease_owner=?,lease_expires=?,body_accepted=1,logical_held=1,activity='active' WHERE seq=?",params![attempt,integer(now)?,integer(fence)?,config.registration.dispatcher_owner_id,integer(expires_at)?,id])?;
        if input.pending_byte_liability.required {
            let reservation = StorageLiability {
                accounting: ByteAccounting::Complete {
                    known_bytes: 0,
                    reserved_bytes: input
                        .pending_byte_liability
                        .reserved_bytes
                        .ok_or(ExampleError::InvalidRow)?,
                },
                metadata_commit_evidence: MetadataCommitEvidence::NotDispatched,
                byte_disposition: ByteDisposition::None,
                reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 1,
            };
            store_liability(&transaction, id, &reservation)?;
        }
        let result = LeasedJob {
            lease: lease(&transaction, id, config)?,
            request: input.clone(),
            attempt,
            canonical_scope,
            pending_byte_liability: input.pending_byte_liability,
        };
        transaction.commit()?;
        Ok(ClaimOutcome::Claimed(result))
    }
    fn finish(
        &mut self,
        expected: &Lease,
        now: Timestamp,
        report: &FinishReport,
    ) -> Result<JobSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = validate_lease(&transaction, expected, &self.config, true)?;
        store_disposition(&transaction, id, now, &report.disposition, None)?;
        store_activity(&transaction, id, &report.remote_activity)?;
        store_liability(&transaction, id, &report.storage_liability)?;
        if matches!(
            report.remote_activity,
            RemoteActivity::NotDispatched
                | RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven { .. })
        ) {
            transaction.execute(
                "UPDATE global_writer SET active_job=NULL,expires_at=NULL WHERE singleton=1",
                [],
            )?;
        }
        let result = snapshot(&transaction, id)?;
        transaction.commit()?;
        Ok(result)
    }
    fn snapshot(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let id: Option<i64> = transaction
            .query_row(
                "SELECT seq FROM jobs WHERE workspace=? AND home=? AND actor=? AND mutation=?",
                params![
                    receipt.workspace_id,
                    receipt.home_id,
                    receipt.actor_id,
                    receipt.mutation_id
                ],
                |row| row.get(0),
            )
            .optional()?;
        let result = id.map(|id| snapshot(&transaction, id)).transpose()?;
        transaction.commit()?;
        Ok(result)
    }
    fn held_job(&mut self) -> Result<Option<HeldJob>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let id:Option<i64>=transaction.query_row("SELECT seq FROM jobs WHERE status IN ('held','partial') AND logical_held=1 ORDER BY seq LIMIT 1",[],|row|row.get(0)).optional()?;
        let result = if let Some(id) = id {
            let RemoteActivity::Invoked(remote_activity) = activity(&transaction, id)? else {
                return Err(ExampleError::InvalidRow);
            };
            Some(HeldJob {
                lease: lease(&transaction, id, &self.config)?,
                request: request(&transaction, id)?,
                attempt: snapshot(&transaction, id)?.attempts,
                remote_activity,
            })
        } else {
            None
        };
        transaction.commit()?;
        Ok(result)
    }
    fn reconcile(
        &mut self,
        expected: &Lease,
        now: Timestamp,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = validate_lease(&transaction, expected, &self.config, false)?;
        if !snapshot(&transaction, id)?.unknown_scope_fence_retained
            || evidence.private_evidence_reference.is_empty()
            || matches!(
                disposition,
                FinishDisposition::Hold(_) | FinishDisposition::Partial(_)
            )
        {
            return Err(ExampleError::InvalidRow);
        }
        store_disposition(&transaction, id, now, disposition, Some(evidence))?;
        // Deliberately no global_writer/activity/liability update here.
        let result = snapshot(&transaction, id)?;
        transaction.commit()?;
        Ok(result)
    }
    fn prove_remote_end(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: Timestamp,
    ) -> Result<JobSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = validate_lease(&transaction, &evidence.lease, &self.config, false)?;
        store_activity(
            &transaction,
            id,
            &RemoteActivity::Invoked(InvokedRemoteActivity::EndedProven {
                termination_evidence_digest: evidence.termination_evidence_digest.clone(),
            }),
        )?;
        transaction.execute(
            "UPDATE jobs SET updated_at=MAX(updated_at,?) WHERE seq=?",
            params![integer(now)?, id],
        )?;
        let (fence, current, _) = active(&transaction)?;
        if current == Some(id) && fence == evidence.lease.fence {
            transaction.execute(
                "UPDATE global_writer SET active_job=NULL,expires_at=NULL WHERE singleton=1",
                [],
            )?;
        }
        // No logical fence, effect, liability or byte cleanup changes.
        let result = snapshot(&transaction, id)?;
        transaction.commit()?;
        Ok(result)
    }
}
