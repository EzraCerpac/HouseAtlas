//! Compiler-only stock.2 synthetic consumer. Execution is explicitly stopped.
//! No claim is made that any assertion here has been run for the stock.2 delta.
#[path = "../mod.rs"]
#[allow(dead_code)]
mod jobs;
mod sqlite_store;
use jobs::*;
use sqlite_store::SyntheticSqliteStore;

#[derive(Default)]
struct SyntheticWriter {
    calls: Vec<(SourcePartition, u64)>,
}
impl HomeBoxWriter for SyntheticWriter {
    fn write(&mut self, job: &LeasedJob) -> DispatchReport {
        // Reserved exclusive admission precedes intake; this fake accepts no bytes.
        assert!(!job.pending_byte_liability.required);
        self.calls
            .push((job.request.partition.clone(), job.lease.fence));
        DispatchReport::Invoked(InvocationReport {
            outcome: WriteOutcome::Applied(AppliedWrite {
                external_id: job.request.intent.target_external_id.clone(),
                source_updated_at: Some("2025-12-01T00:00:00Z".into()),
                observation: ObservedWriteEvidence {
                    response_digest: hash('2'),
                    readback_digest: hash('3'),
                    observed_at: 103,
                },
            }),
            remote_activity: InvokedRemoteActivity::EndedProven {
                termination_evidence_digest: hash('4'),
            },
            storage_liability: StorageLiability {
                accounting: ByteAccounting::Complete {
                    known_bytes: 0,
                    reserved_bytes: 0,
                },
                metadata_commit_evidence: MetadataCommitEvidence::ObservedCommitted,
                byte_disposition: ByteDisposition::None,
                reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
                orphan_candidate_id: None,
                unresolved_attempts: 0,
            },
        })
    }
}
fn hash(value: char) -> Digest {
    Digest::from_hex(value.to_string().repeat(64)).unwrap()
}
fn request(home: &str, instance: &str, collection: &str, mutation: &str) -> EnqueueRequest {
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
        intent: IntentMetadata {
            contract_id: "at36-synthetic-metadata/1".into(),
            operation_id: "healthy-acknowledgement".into(),
            target_external_id: Some("00000000-0000-4000-8000-000000000500".into()),
            request_digest: hash('1'),
        },
        write_scope: WriteScope {
            source_instance_id: instance.into(),
            collection_id: collection.into(),
            selection: ScopeSelection::Collection,
        },
        pending_byte_liability: PendingByteLiability {
            required: false,
            reserved_bytes: None,
        },
    }
}
fn main() {
    let first = request(
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000010",
        "synthetic-collection-a",
        "00000000-0000-4000-8000-000000009011",
    );
    let second = request(
        "00000000-0000-4000-8000-000000000003",
        "00000000-0000-4000-8000-000000000011",
        "synthetic-collection-b",
        "00000000-0000-4000-8000-000000009012",
    );
    let config = QueueConfig {
        lease_duration_ms: 10_000,
        retry: RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 100,
            max_delay_ms: 1_000,
        },
        registration: QueueRegistration {
            identity: PhysicalQueueIdentity {
                deployment_id: "00000000-0000-4000-8000-000000008001".into(),
                physical_database_id: "00000000-0000-4000-8000-000000008002".into(),
                configuration_digest: hash('5'),
            },
            dispatcher_owner_id: "00000000-0000-4000-8000-000000008003".into(),
            aliases: vec![
                SourceAlias {
                    partition: first.partition.clone(),
                    canonical_collection_id: "physical-collection-a".into(),
                },
                SourceAlias {
                    partition: second.partition.clone(),
                    canonical_collection_id: "physical-collection-b".into(),
                },
            ],
        },
        admission_profile: AdmissionProfile::stock_engineering_fixture(),
    };
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "houseatlas-at36-stock-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("queue.sqlite");
    let store = SyntheticSqliteStore::open(&path, &config).unwrap();
    let mut queue = WriteQueue::new(store, SyntheticWriter::default(), config.clone()).unwrap();
    let EnqueueOutcome::Enqueued(queued) = queue.enqueue(&first, 100).unwrap() else {
        panic!("synthetic metadata enqueued")
    };
    assert!(!queued.body_accepted);
    assert!(matches!(
        queue.enqueue(&second, 101),
        Ok(EnqueueOutcome::Enqueued(_))
    ));
    let DispatchOutcome::Finished(done) = queue.dispatch_next(102, || 103).unwrap() else {
        panic!("synthetic accepted write")
    };
    assert_eq!(done.status, JobStatus::Succeeded);
    let (store, writer) = queue.into_parts();
    assert_eq!(writer.calls.len(), 1);
    drop(store);
    let store = SyntheticSqliteStore::open(&path, &config).unwrap();
    let mut queue = WriteQueue::new(store, SyntheticWriter::default(), config).unwrap();
    assert_eq!(queue.snapshot(&first.receipt).unwrap(), Some(done));
    assert!(matches!(
        queue.dispatch_next(104, || 105),
        Ok(DispatchOutcome::Finished(_))
    ));
    let (store, second_writer) = queue.into_parts();
    assert!(second_writer.calls[0].1 > writer.calls[0].1);
    assert_eq!(store.slot_count().unwrap(), 1);
    let version = store.sqlite_version().unwrap();
    drop(store);
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(directory).unwrap();
    println!(
        "UNQUALIFIED synthetic queue consumer: 2 aliases, 1 physical DB, metadata only waiting, SQLite {version}"
    );
}
