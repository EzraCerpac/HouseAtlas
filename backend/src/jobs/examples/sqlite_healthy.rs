//! Healthy synthetic consumer, compiled from an external pinned Cargo harness.
//! This SQLite adapter is an example, not the shared AT07 production adapter.
//! Only successful writes, exact receipt replay and clean restart run in main.

#[path = "../mod.rs"]
#[allow(dead_code)] // Other lifecycle branches are compiled but deliberately unrun.
mod jobs;

use jobs::*;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::path::Path;

#[derive(Debug)]
enum ExampleError {
    Sqlite(rusqlite::Error),
    IdempotencyConflict,
    InvalidRow,
    StaleLease,
    Exhausted,
}

impl std::fmt::Display for ExampleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "synthetic SQLite error: {error}"),
            other => write!(f, "{other:?}"),
        }
    }
}

impl From<rusqlite::Error> for ExampleError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

type Result<T> = std::result::Result<T, ExampleError>;
type StoredSnapshot = (
    String,
    u32,
    i64,
    i64,
    Option<i64>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn integer(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| ExampleError::Exhausted)
}

fn unsigned(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| ExampleError::InvalidRow)
}

struct SyntheticSqliteStore(Connection);

impl SyntheticSqliteStore {
    fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS jobs (
               seq INTEGER PRIMARY KEY AUTOINCREMENT,
               workspace TEXT NOT NULL, home TEXT NOT NULL,
               actor TEXT NOT NULL, mutation TEXT NOT NULL,
               instance TEXT NOT NULL, collection TEXT NOT NULL,
               contract TEXT NOT NULL, operation TEXT NOT NULL,
               target TEXT, payload BLOB NOT NULL,
               status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
               next_at INTEGER, applied_external TEXT, applied_date TEXT,
               failure TEXT, evidence TEXT,
               UNIQUE(workspace,home,actor,mutation)
             );
             CREATE TABLE IF NOT EXISTS global_writer (
               singleton INTEGER PRIMARY KEY CHECK(singleton=1),
               fence INTEGER NOT NULL, active_job INTEGER REFERENCES jobs(seq),
               expires_at INTEGER
             );
             INSERT OR IGNORE INTO global_writer VALUES(1,0,NULL,NULL);",
        )?;
        Ok(Self(connection))
    }
}

fn request(connection: &Connection, id: i64) -> Result<EnqueueRequest> {
    Ok(connection.query_row(
        "SELECT workspace,home,actor,mutation,instance,collection,
                contract,operation,target,payload FROM jobs WHERE seq=?",
        [id],
        |row| {
            let workspace_id: String = row.get(0)?;
            let home_id: String = row.get(1)?;
            Ok(EnqueueRequest {
                receipt: ReceiptKey {
                    workspace_id: workspace_id.clone(),
                    home_id: home_id.clone(),
                    actor_id: row.get(2)?,
                    mutation_id: row.get(3)?,
                },
                partition: SourcePartition {
                    workspace_id,
                    home_id,
                    source_instance_id: row.get(4)?,
                    collection_id: row.get(5)?,
                },
                prepared: PreparedWrite {
                    contract_id: row.get(6)?,
                    operation_id: row.get(7)?,
                    target_external_id: row.get(8)?,
                    payload: row.get(9)?,
                },
            })
        },
    )?)
}

fn failure_name(code: FailureCode) -> &'static str {
    match code {
        FailureCode::Unavailable => "unavailable",
        FailureCode::RateLimited => "rate-limited",
        FailureCode::Rejected => "rejected",
        FailureCode::AccessDenied => "access-denied",
        FailureCode::InvalidPreparedPayload => "invalid-prepared-payload",
        FailureCode::OutcomeUnknown => "outcome-unknown",
        FailureCode::LeaseExpired => "lease-expired",
    }
}

fn snapshot(connection: &Connection, id: i64) -> Result<JobSnapshot> {
    let request = request(connection, id)?;
    let (status, attempts, created_at, updated_at, next_at, external, date, failure): StoredSnapshot = connection.query_row(
        "SELECT status,attempts,created_at,updated_at,next_at,
                applied_external,applied_date,failure FROM jobs WHERE seq=?",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                  row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?)),
    )?;
    let status = match status.as_str() {
        "queued" => JobStatus::Queued,
        "running" => JobStatus::Running,
        "retry" => JobStatus::RetryScheduled,
        "succeeded" => JobStatus::Succeeded,
        "failed" => JobStatus::Failed,
        "held" => JobStatus::NeedsReconciliation,
        _ => return Err(ExampleError::InvalidRow),
    };
    let failure = match failure.as_deref() {
        None => None,
        Some("unavailable") => Some(FailureCode::Unavailable),
        Some("rate-limited") => Some(FailureCode::RateLimited),
        Some("rejected") => Some(FailureCode::Rejected),
        Some("access-denied") => Some(FailureCode::AccessDenied),
        Some("invalid-prepared-payload") => Some(FailureCode::InvalidPreparedPayload),
        Some("outcome-unknown") => Some(FailureCode::OutcomeUnknown),
        Some("lease-expired") => Some(FailureCode::LeaseExpired),
        Some(_) => return Err(ExampleError::InvalidRow),
    };
    Ok(JobSnapshot {
        job_id: JobId(id.to_string()),
        receipt: request.receipt,
        partition: request.partition,
        status,
        attempts,
        created_at: unsigned(created_at)?,
        updated_at: unsigned(updated_at)?,
        next_attempt_at: next_at.map(unsigned).transpose()?,
        applied: (status == JobStatus::Succeeded).then_some(AppliedWrite {
            external_id: external,
            source_updated_at: date,
        }),
        failure,
    })
}

fn active(connection: &Connection) -> Result<(i64, Option<i64>, Option<u64>)> {
    let (fence, job, expires_at): (i64, Option<i64>, Option<i64>) = connection.query_row(
        "SELECT fence,active_job,expires_at FROM global_writer WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if fence < 0 {
        return Err(ExampleError::InvalidRow);
    }
    Ok((fence, job, expires_at.map(unsigned).transpose()?))
}

fn commit_disposition(
    connection: &mut Connection,
    lease: &Lease,
    now: Timestamp,
    disposition: &FinishDisposition,
    evidence: Option<&ReconciliationEvidence>,
) -> Result<JobSnapshot> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (fence, id, expires_at) = active(&transaction)?;
    let id = id.ok_or(ExampleError::StaleLease)?;
    if lease.job_id.0 != id.to_string()
        || integer(lease.fence)? != fence
        || Some(lease.expires_at) != expires_at
    {
        return Err(ExampleError::StaleLease);
    }
    let prior = snapshot(&transaction, id)?;
    if !matches!(
        prior.status,
        JobStatus::Running | JobStatus::NeedsReconciliation
    ) {
        return Err(ExampleError::StaleLease);
    }
    let persisted_at = now.max(prior.updated_at);
    if let Some(evidence) = evidence
        && (prior.status != JobStatus::NeedsReconciliation
            || evidence.private_evidence_reference.is_empty()
            || matches!(disposition, FinishDisposition::Hold(_)))
    {
        return Err(ExampleError::InvalidRow);
    }
    let (status, next_at, applied, failure) = match disposition {
        FinishDisposition::Succeeded(applied) => ("succeeded", None, Some(applied), None),
        FinishDisposition::Failed(reason) => ("failed", None, None, Some(*reason)),
        FinishDisposition::RetryAt { at, reason } => {
            if *at <= now {
                return Err(ExampleError::InvalidRow);
            }
            ("retry", Some(integer(*at)?), None, Some(*reason))
        }
        FinishDisposition::Hold(reason) => ("held", None, None, Some(*reason)),
    };
    transaction.execute(
        "UPDATE jobs SET status=?,updated_at=?,next_at=?,applied_external=?,
         applied_date=?,failure=?,evidence=COALESCE(?,evidence) WHERE seq=?",
        params![
            status,
            integer(persisted_at)?,
            next_at,
            applied.and_then(|value| value.external_id.as_deref()),
            applied.and_then(|value| value.source_updated_at.as_deref()),
            failure.map(failure_name),
            evidence.map(|value| value.private_evidence_reference.as_str()),
            id
        ],
    )?;
    if !matches!(disposition, FinishDisposition::Hold(_)) {
        transaction.execute(
            "UPDATE global_writer SET active_job=NULL,expires_at=NULL WHERE singleton=1",
            [],
        )?;
    }
    let result = snapshot(&transaction, id)?;
    transaction.commit()?;
    Ok(result)
}

impl QueueStore for SyntheticSqliteStore {
    type Error = ExampleError;

    fn enqueue(&mut self, input: &EnqueueRequest, now: Timestamp) -> Result<EnqueueOutcome> {
        input.validate().map_err(|_| ExampleError::InvalidRow)?;
        let transaction = self
            .0
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
        let outcome = if let Some(id) = existing {
            if request(&transaction, id)? != *input {
                return Err(ExampleError::IdempotencyConflict);
            }
            EnqueueOutcome::Replayed(snapshot(&transaction, id)?)
        } else {
            transaction.execute(
                "INSERT INTO jobs(workspace,home,actor,mutation,instance,collection,
                 contract,operation,target,payload,status,created_at,updated_at,next_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)",
                params![
                    receipt.workspace_id,
                    receipt.home_id,
                    receipt.actor_id,
                    receipt.mutation_id,
                    input.partition.source_instance_id,
                    input.partition.collection_id,
                    input.prepared.contract_id,
                    input.prepared.operation_id,
                    input.prepared.target_external_id,
                    input.prepared.payload,
                    integer(now)?,
                    integer(now)?,
                    integer(now)?
                ],
            )?;
            EnqueueOutcome::Enqueued(snapshot(&transaction, transaction.last_insert_rowid())?)
        };
        transaction.commit()?;
        Ok(outcome)
    }

    fn claim_next(&mut self, now: Timestamp, duration: u64) -> Result<ClaimOutcome> {
        let transaction = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (fence, current, expires_at) = active(&transaction)?;
        if let Some(id) = current {
            let expires_at = expires_at.ok_or(ExampleError::InvalidRow)?;
            let mut current = snapshot(&transaction, id)?;
            let outcome = if current.status == JobStatus::NeedsReconciliation {
                ClaimOutcome::HeldForReconciliation(current)
            } else if now >= expires_at {
                transaction.execute(
                    "UPDATE jobs SET status='held',updated_at=?,failure='lease-expired' WHERE seq=?",
                    params![integer(now)?, id],
                )?;
                current = snapshot(&transaction, id)?;
                ClaimOutcome::HeldForReconciliation(current)
            } else {
                ClaimOutcome::Busy { expires_at }
            };
            transaction.commit()?;
            return Ok(outcome);
        }
        let id: Option<i64> = transaction.query_row(
            "SELECT seq FROM jobs WHERE status IN ('queued','retry') AND next_at<=? ORDER BY seq LIMIT 1",
            [integer(now)?], |row| row.get(0),
        ).optional()?;
        let Some(id) = id else {
            transaction.commit()?;
            return Ok(ClaimOutcome::Idle);
        };
        let fence = fence.checked_add(1).ok_or(ExampleError::Exhausted)?;
        let expires_at = now.checked_add(duration).ok_or(ExampleError::Exhausted)?;
        let attempt = snapshot(&transaction, id)?
            .attempts
            .checked_add(1)
            .ok_or(ExampleError::Exhausted)?;
        transaction.execute(
            "UPDATE global_writer SET fence=?,active_job=?,expires_at=? WHERE singleton=1",
            params![fence, id, integer(expires_at)?],
        )?;
        transaction.execute(
            "UPDATE jobs SET status='running',attempts=?,updated_at=?,next_at=NULL WHERE seq=?",
            params![attempt, integer(now)?, id],
        )?;
        let job = LeasedJob {
            lease: Lease {
                job_id: JobId(id.to_string()),
                fence: fence as u64,
                expires_at,
            },
            request: request(&transaction, id)?,
            attempt,
        };
        transaction.commit()?;
        Ok(ClaimOutcome::Claimed(job))
    }

    fn finish(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot> {
        commit_disposition(&mut self.0, lease, now, disposition, None)
    }

    fn snapshot(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>> {
        let id: Option<i64> = self
            .0
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
        id.map(|id| snapshot(&self.0, id)).transpose()
    }

    fn held_job(&mut self) -> Result<Option<HeldJob>> {
        let transaction = self
            .0
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let (fence, id, expires_at) = active(&transaction)?;
        let Some(id) = id else {
            return Ok(None);
        };
        let current = snapshot(&transaction, id)?;
        if current.status != JobStatus::NeedsReconciliation {
            return Ok(None);
        }
        Ok(Some(HeldJob {
            lease: Lease {
                job_id: current.job_id,
                fence: fence as u64,
                expires_at: expires_at.ok_or(ExampleError::InvalidRow)?,
            },
            request: request(&transaction, id)?,
            attempt: current.attempts,
        }))
    }

    fn reconcile(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot> {
        commit_disposition(&mut self.0, lease, now, disposition, Some(evidence))
    }
}

#[derive(Default)]
struct SyntheticWriter {
    calls: Vec<(SourcePartition, u64)>,
}

impl HomeBoxWriter for SyntheticWriter {
    fn write(&mut self, job: &LeasedJob) -> WriteOutcome {
        // Synthetic accepted operation; these bytes are never sent to a provider.
        assert_eq!(
            job.request.prepared.contract_id,
            "at36-synthetic-prepared/1"
        );
        assert_eq!(job.request.prepared.operation_id, "healthy-acknowledgement");
        self.calls
            .push((job.request.partition.clone(), job.lease.fence));
        WriteOutcome::Applied(AppliedWrite {
            external_id: job.request.prepared.target_external_id.clone(),
            source_updated_at: Some("2025-12-01T00:00:00Z".into()),
        })
    }
}

fn synthetic_request(
    home: &str,
    instance: &str,
    collection: &str,
    mutation: &str,
) -> EnqueueRequest {
    let workspace = "00000000-0000-4000-8000-000000000001";
    EnqueueRequest {
        receipt: ReceiptKey {
            workspace_id: workspace.into(),
            home_id: home.into(),
            actor_id: "00000000-0000-4000-8000-000000009001".into(),
            mutation_id: mutation.into(),
        },
        partition: SourcePartition {
            workspace_id: workspace.into(),
            home_id: home.into(),
            source_instance_id: instance.into(),
            collection_id: collection.into(),
        },
        prepared: PreparedWrite {
            contract_id: "at36-synthetic-prepared/1".into(),
            operation_id: "healthy-acknowledgement".into(),
            target_external_id: Some("00000000-0000-4000-8000-000000000500".into()),
            payload: b"synthetic opaque prepared bytes; not a provider dialect".to_vec(),
        },
    }
}

fn main() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("synthetic clock has a UTC timestamp")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "houseatlas-at36-healthy-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).expect("exclusive fresh synthetic directory");
    let path = directory.join("queue.sqlite");
    let config = QueueConfig {
        lease_duration_ms: 10_000,
        retry: RetryPolicy {
            max_attempts: 3,
            initial_delay_ms: 100,
            max_delay_ms: 1_000,
        },
    };
    // Full source scopes copied from the published healthy plan-free snapshot.
    let first = synthetic_request(
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000010",
        "synthetic-collection-a",
        "00000000-0000-4000-8000-000000009011",
    );
    let second = synthetic_request(
        "00000000-0000-4000-8000-000000000003",
        "00000000-0000-4000-8000-000000000011",
        "synthetic-collection-b",
        "00000000-0000-4000-8000-000000009012",
    );
    let store = SyntheticSqliteStore::open(&path).expect("synthetic database opens");
    let mut queue =
        WriteQueue::new(store, SyntheticWriter::default(), config).expect("valid config");
    assert!(matches!(
        queue.enqueue(&first, 100),
        Ok(EnqueueOutcome::Enqueued(_))
    ));
    assert!(matches!(
        queue.enqueue(&second, 100),
        Ok(EnqueueOutcome::Enqueued(_))
    ));
    assert!(matches!(
        queue.enqueue(&first, 101),
        Ok(EnqueueOutcome::Replayed(_))
    ));
    let DispatchOutcome::Finished(first_done) = queue.dispatch_next(102, || 103).unwrap() else {
        panic!("first healthy command completes");
    };
    assert_eq!(first_done.status, JobStatus::Succeeded);
    assert_eq!(first_done.attempts, 1);
    assert_eq!(first_done.partition, first.partition);
    let (store, first_writer) = queue.into_parts();
    assert_eq!(first_writer.calls.len(), 1);
    drop(store); // Clean close/reopen, never a crash or fault-recovery control.

    let store = SyntheticSqliteStore::open(&path).expect("synthetic database reopens");
    let mut queue = WriteQueue::new(store, SyntheticWriter::default(), config).unwrap();
    assert_eq!(queue.snapshot(&first.receipt).unwrap(), Some(first_done));
    assert!(matches!(
        queue.enqueue(&first, 104),
        Ok(EnqueueOutcome::Replayed(_))
    ));
    let DispatchOutcome::Finished(second_done) = queue.dispatch_next(105, || 106).unwrap() else {
        panic!("second healthy command completes");
    };
    assert_eq!(second_done.status, JobStatus::Succeeded);
    assert_eq!(second_done.attempts, 1);
    assert_eq!(second_done.partition, second.partition);
    assert_eq!(
        queue.dispatch_next(107, || 108).unwrap(),
        DispatchOutcome::Idle
    );
    let (store, second_writer) = queue.into_parts();
    assert_eq!(second_writer.calls.len(), 1);
    assert!(second_writer.calls[0].1 > first_writer.calls[0].1);
    assert_eq!(
        store
            .0
            .query_row("SELECT COUNT(*) FROM global_writer", [], |row| row
                .get::<_, u32>(0))
            .unwrap(),
        1
    );
    let sqlite_version: String = store
        .0
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap();
    drop(store);
    std::fs::remove_file(path).expect("synthetic database removed");
    std::fs::remove_dir(directory).expect("synthetic directory removed");
    println!(
        "healthy queue: 2 partitions, 2 writes, exact replay, clean durable restart, 1 global slot, fences {} -> {}, SQLite {sqlite_version}",
        first_writer.calls[0].1, second_writer.calls[0].1
    );
}
