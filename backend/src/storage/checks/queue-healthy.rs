//! Offline stock.2 AT07 success: durable enqueue, owner recovery, one native
//! journal, atomic observed finish, and receipt read after a second reopen.
//! The authority, clock, prepared bytes, and evidence are synthetic fixtures.
#[path = "stock-support.rs"]
mod support;

use houseatlas_at07_checkpoint::jobs::{FailureCode, SourcePartition};
use houseatlas_at07_checkpoint::{
    domain::stock::{NativeStockContract, ValidatedRequest},
    jobs::native_homebox::{
        BeforeInvocationFailure, InvocationPermit, NativeHomeBoxWriter, NativeOperationOwner,
        PreparedTransport, QualifiedInvocation, TransportAcknowledgement, TransportReceipt,
    },
    jobs::*,
    storage::*,
};
use serde_json::{Value, json};
use sha2::{Digest as ShaDigest, Sha256};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};
use support::{
    CheckResult, OfflineStockSchemas, PureRustSemantics, SyntheticAuthorization, SyntheticRuntime,
    id,
};

fn original_wire() -> Value {
    json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set",
        "requestId":id(115),"context":{"workspaceId":id(1),"homeId":id(2)},
        "target":{"authority":"homebox","sourceInstanceId":id(3),
            "collectionId":id(4),"resourceKind":"entity","resourceId":id(5)},
        "payload":{"quantity":0},"idempotencyKey":id(215),
        "reason":"Synthetic zero quantity","approvalReceiptId":null,
        "preconditions":{"providerObservation":{"kind":"provider-observation",
            "handle":id(16)},"atlasGuards":[]}})
}

fn digest_bytes(bytes: &[u8]) -> Digest {
    Digest::from_hex(format!("{:x}", Sha256::digest(bytes)))
        .expect("SHA-256 is a lowercase 64 digit digest")
}

fn native_payload() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "method":"PATCH", "path":format!("/api/v1/entities/{}", id(5)),
        "body":{"quantity":0},
    }))
    .expect("Fixed synthetic native envelope")
}

fn response_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({"id":id(5),"quantity":0,"updatedAt":"2026-10-07T01:00:00Z"}))
        .expect("Fixed synthetic response")
}

fn readback_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({"id":id(5),"quantity":0,"updatedAt":"2026-10-07T01:00:00Z"}))
        .expect("Fixed synthetic readback")
}

fn remote_end_bytes() -> Vec<u8> {
    b"synthetic correlated remote end for quantity=0".to_vec()
}

fn zero_liability() -> StorageLiability {
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

struct SyntheticResponse {
    response: Vec<u8>,
    readback: Vec<u8>,
    remote_end: Vec<u8>,
}

struct SyntheticPreparedTransport {
    invocations: Rc<Cell<usize>>,
}
impl PreparedTransport for SyntheticPreparedTransport {
    type Payload = Vec<u8>;
    type Response = SyntheticResponse;

    fn invoke(
        &mut self,
        invocation: QualifiedInvocation<Self::Payload>,
    ) -> TransportReceipt<Self::Response> {
        self.invocations.set(self.invocations.get() + 1);
        let (permit, payload) = invocation.into_parts();
        assert_eq!(payload, native_payload());
        assert_eq!(permit.native_payload_digest(), &digest_bytes(&payload));
        let response = SyntheticResponse {
            response: response_bytes(),
            readback: readback_bytes(),
            remote_end: remote_end_bytes(),
        };
        let response_digest = digest_bytes(&response.response);
        let end_digest = digest_bytes(&response.remote_end);
        permit.invoked(
            TransportAcknowledgement::DefiniteResponse {
                response,
                response_digest,
            },
            InvokedRemoteActivity::EndedProven {
                termination_evidence_digest: end_digest,
            },
            zero_liability(),
        )
    }
}

struct SyntheticOwner<J> {
    journal: J,
    expected_request: EnqueueRequest,
}

impl<J: QueueJournalPort> NativeOperationOwner for SyntheticOwner<J> {
    type Payload = Vec<u8>;
    type Response = SyntheticResponse;

    fn prepare_and_journal(
        &mut self,
        job: &LeasedJob,
    ) -> std::result::Result<QualifiedInvocation<Self::Payload>, BeforeInvocationFailure> {
        if job.request != self.expected_request || job.attempt != 1 || job.lease.fence != 1 {
            return Err(BeforeInvocationFailure {
                reason: FailureCode::InvalidPreparedPayload,
                storage_liability: zero_liability(),
            });
        }
        let payload = native_payload();
        let prepared = PreparedNativeIntent {
            codec: "stock.2-native-v1".into(),
            native_payload: payload.clone(),
            prepared_media_evidence: b"qualified synthetic no-media intent".to_vec(),
            storage_liability: zero_liability(),
        };
        let receipt =
            self.journal
                .commit_native(job, &prepared)
                .map_err(|_| BeforeInvocationFailure {
                    reason: FailureCode::InvalidPreparedPayload,
                    storage_liability: zero_liability(),
                })?;
        if receipt.native_payload_digest != digest_bytes(&payload) {
            return Err(BeforeInvocationFailure {
                reason: FailureCode::InvalidPreparedPayload,
                storage_liability: zero_liability(),
            });
        }
        Ok(QualifiedInvocation::from_journaled_intent(
            job,
            payload,
            receipt.native_payload_digest,
            receipt.journal_evidence_digest,
            prepared.storage_liability,
        ))
    }

    fn authorize_dispatch(
        &mut self,
        job: &LeasedJob,
        invocation: &QualifiedInvocation<Self::Payload>,
    ) -> std::result::Result<(), BeforeInvocationFailure> {
        let receipt =
            self.journal
                .authorize_dispatch(job, 1_001)
                .map_err(|_| BeforeInvocationFailure {
                    reason: FailureCode::AccessDenied,
                    storage_liability: zero_liability(),
                })?;
        if invocation.permit().job() != job
            || invocation.payload() != &native_payload()
            || invocation.permit().native_payload_digest() != &receipt.native_payload_digest
            || invocation.permit().journal_evidence_digest() != &receipt.journal_evidence_digest
        {
            return Err(BeforeInvocationFailure {
                reason: FailureCode::InvalidPreparedPayload,
                storage_liability: zero_liability(),
            });
        }
        Ok(())
    }

    fn verify_effects(
        &mut self,
        job: &LeasedJob,
        permit: &InvocationPermit,
        acknowledgement: &TransportAcknowledgement<Self::Response>,
    ) -> WriteOutcome {
        let TransportAcknowledgement::DefiniteResponse {
            response,
            response_digest,
        } = acknowledgement
        else {
            return WriteOutcome::Uncertain {
                reason: FailureCode::OutcomeUnknown,
            };
        };
        if permit.job() != job
            || job.request != self.expected_request
            || response.response != response_bytes()
            || response.readback != readback_bytes()
            || response.remote_end != remote_end_bytes()
            || *response_digest != digest_bytes(&response.response)
        {
            return WriteOutcome::Uncertain {
                reason: FailureCode::OutcomeUnknown,
            };
        }
        let readback_digest = digest_bytes(&response.readback);
        let remote_digest = digest_bytes(&response.remote_end);
        let Ok(inbox) = self.journal.evidence_inbox() else {
            return WriteOutcome::Uncertain {
                reason: FailureCode::OutcomeUnknown,
            };
        };
        let response_step = QueueStepEvidence {
            kind: StepKind::ResponseReadback,
            codec: "stock.2".into(),
            payload: serde_json::to_vec(&json!({
                "response": response.response,
                "readback": response.readback,
            }))
            .expect("Fixed synthetic response evidence"),
            response_digest: Some(response_digest.clone()),
            readback_digest: Some(readback_digest.clone()),
            termination_digest: None,
        };
        let remote_step = QueueStepEvidence {
            kind: StepKind::RemoteEnd,
            codec: "stock.2".into(),
            payload: response.remote_end.clone(),
            response_digest: None,
            readback_digest: None,
            termination_digest: Some(remote_digest),
        };
        if inbox.submit(job, response_step).is_err() || inbox.submit(job, remote_step).is_err() {
            return WriteOutcome::Uncertain {
                reason: FailureCode::OutcomeUnknown,
            };
        }
        WriteOutcome::Applied(AppliedWrite {
            external_id: Some(id(5)),
            source_updated_at: Some("2026-10-07T01:00:00Z".into()),
            observation: ObservedWriteEvidence {
                response_digest: response_digest.clone(),
                readback_digest,
                observed_at: 1_002,
            },
        })
    }
}

fn expected_enqueue(
    original: &ValidatedRequest,
    actor_id: &str,
) -> Result<(EnqueueRequest, CanonicalScope)> {
    if *original.raw() != original_wire() || !original.is_mutation() || actor_id != id(50) {
        return Err(Error::new(
            "invalid-contract",
            "Unexpected synthetic stock intent",
        ));
    }
    let raw = original.raw();
    let partition = SourcePartition {
        workspace_id: original.context().workspace_id.clone(),
        home_id: original.context().home_id.clone(),
        source_instance_id: raw["target"]["sourceInstanceId"]
            .as_str()
            .ok_or_else(|| Error::new("invalid-contract", "Missing source"))?
            .into(),
        collection_id: raw["target"]["collectionId"]
            .as_str()
            .ok_or_else(|| Error::new("invalid-contract", "Missing collection"))?
            .into(),
    };
    let resource_id = raw["target"]["resourceId"]
        .as_str()
        .ok_or_else(|| Error::new("invalid-contract", "Missing resource"))?;
    let write_scope = WriteScope {
        source_instance_id: partition.source_instance_id.clone(),
        collection_id: partition.collection_id.clone(),
        selection: ScopeSelection::Resources(vec![ResourceRef {
            kind: ResourceKind::Entity,
            id: resource_id.into(),
        }]),
    };
    let canonical = CanonicalScope {
        collection_id: "physical-collection".into(),
        selection: write_scope.selection.clone(),
    };
    Ok((
        EnqueueRequest {
            receipt: ReceiptKey {
                workspace_id: partition.workspace_id.clone(),
                home_id: partition.home_id.clone(),
                actor_id: actor_id.into(),
                mutation_id: raw["idempotencyKey"]
                    .as_str()
                    .ok_or_else(|| Error::new("invalid-contract", "Missing key"))?
                    .into(),
            },
            partition,
            intent: IntentMetadata {
                contract_id: "stock.2".into(),
                operation_id: original.id().as_str().into(),
                target_external_id: Some(resource_id.into()),
                request_digest: Digest::from_hex(original.intent_digest().into())
                    .map_err(|_| Error::new("invalid-contract", "Bad digest"))?,
            },
            write_scope,
            pending_byte_liability: PendingByteLiability {
                required: false,
                reserved_bytes: None,
            },
        },
        canonical,
    ))
}

// This witness is supplied again by the current owner process after discovery.
// It is never read from the persisted queue row.
struct OriginalWitness {
    captured_digest: String,
    source_grant: bool,
    graph_access: bool,
    approval_checked: bool,
    result_disclosure: bool,
}

#[derive(Default)]
struct SyntheticQueueAuthority {
    checks: Cell<usize>,
    dispatch_checks: Cell<usize>,
    snapshot_phases: RefCell<Vec<&'static str>>,
}
impl QueueAuthorization for SyntheticQueueAuthority {
    type Principal = VerifiedActor;
    type Witness = OriginalWitness;

    fn authorize(
        &self,
        principal: &VerifiedActor,
        witness: &OriginalWitness,
        original: &ValidatedRequest,
        phase: QueuePhase,
        action: QueueAction<'_>,
    ) -> Result<VerifiedActor> {
        if *original.raw() != original_wire()
            || !original.is_mutation()
            || witness.captured_digest != original.intent_digest()
            || !witness.source_grant
            || !witness.graph_access
            || !witness.approval_checked
            || !witness.result_disclosure
            || principal.workspace_id != original.context().workspace_id
            || principal.home_id != original.context().home_id
            || principal.actor_id != id(50)
        {
            return Err(Error::new(
                "forbidden",
                "Synthetic original authority differs",
            ));
        }
        self.checks.set(self.checks.get() + 1);
        if matches!(action, QueueAction::Dispatch { .. }) {
            self.dispatch_checks.set(self.dispatch_checks.get() + 1);
        }
        if matches!(action, QueueAction::Snapshot(_)) {
            self.snapshot_phases.borrow_mut().push(match phase {
                QueuePhase::Entry => "Entry",
                QueuePhase::Precommit => "Precommit",
                QueuePhase::Release => "Release",
            });
        }
        Ok(principal.clone())
    }

    fn validate_enqueue(
        &self,
        principal: &VerifiedActor,
        witness: &OriginalWitness,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
    ) -> Result<()> {
        self.authorize(
            principal,
            witness,
            original,
            QueuePhase::Entry,
            QueueAction::Enqueue(request),
        )?;
        let (expected, expected_canonical) = expected_enqueue(original, &principal.actor_id)?;
        if *request != expected || *scope != expected_canonical {
            return Err(Error::new(
                "invalid-contract",
                "Synthetic queue derivation differs",
            ));
        }
        Ok(())
    }

    fn parse_retained_original(&self, value: Value) -> Result<ValidatedRequest> {
        let schemas = NativeStockContract::new()
            .map_err(|_| Error::new("schema-incompatible", "Stock validator unavailable"))?;
        ValidatedRequest::parse(&schemas, value)
            .map_err(|_| Error::new("invalid-contract", "Retained stock original invalid"))
    }

    fn remote_end_step(
        &self,
        _principal: &VerifiedActor,
        _witness: &OriginalWitness,
        _original: &ValidatedRequest,
        _evidence: &RemoteEndEvidence,
        _job: &LeasedJob,
        _journal: &JournalEvidenceView,
    ) -> Result<QueueStepEvidence> {
        Err(Error::new(
            "invalid-contract",
            "No separate remote-end action in healthy check",
        ))
    }

    fn reconciliation_steps(
        &self,
        _principal: &VerifiedActor,
        _witness: &OriginalWitness,
        _original: &ValidatedRequest,
        _job: &HeldJob,
        _evidence: &ReconciliationEvidence,
        _disposition: &FinishDisposition,
    ) -> Result<Vec<QueueStepEvidence>> {
        Err(Error::new(
            "invalid-contract",
            "No held action in healthy check",
        ))
    }
}

struct SyntheticDiscovery;
impl QueueDiscovery for SyntheticDiscovery {
    fn authorize_discovery(&self, registration: &QueueRegistration) -> Result<()> {
        if registration.identity.deployment_id == "synthetic-deployment"
            && registration.identity.physical_database_id == "synthetic-physical"
            && registration.dispatcher_owner_id == "synthetic-owner"
        {
            Ok(())
        } else {
            Err(Error::new("forbidden", "Unknown synthetic queue"))
        }
    }

    fn validate_retained_enqueue(
        &self,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()> {
        self.authorize_discovery(&config.registration)?;
        let (expected, expected_scope) = expected_enqueue(original, &id(50))?;
        let registered_scope = config
            .registration
            .resolve(&expected.partition, &expected.write_scope)
            .map_err(|_| Error::new("invalid-contract", "Unknown synthetic alias"))?;
        if *request != expected || *scope != expected_scope || *scope != registered_scope {
            return Err(Error::new(
                "invalid-contract",
                "Retained enqueue derivation differs",
            ));
        }
        Ok(())
    }
}

fn open(
    path: &PathBuf,
    semantics: &PureRustSemantics,
    authorization: &SyntheticAuthorization,
    runtime: &SyntheticRuntime,
) -> Result<AtlasStore<NativeContract<PureRustSemantics>, SyntheticAuthorization, SyntheticRuntime>>
{
    AtlasStore::open(
        path,
        semantics.storage_contract(),
        authorization.clone(),
        runtime.clone(),
        StoreOptions::default(),
    )
}

fn main() -> CheckResult<()> {
    let stock_root = PathBuf::from(std::env::var("HOUSEATLAS_STOCK_ROOT")?);
    let contract_peer = std::env::var("HOUSEATLAS_CONTRACT_PEER")?;
    let domain_peer = std::env::var("HOUSEATLAS_DOMAIN_PEER")?;
    let output = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh private evidence directory required")?,
    );
    fs::create_dir(&output)?;
    let path = output.join("queue.sqlite");
    let schemas = OfflineStockSchemas::load(&stock_root)?;
    let semantics = PureRustSemantics::default();
    let storage_authorization = SyntheticAuthorization::default();
    let runtime = SyntheticRuntime {
        next: Rc::new(Cell::new(90_000)),
    };
    let raw = original_wire();
    let original = ValidatedRequest::parse(&schemas, raw.clone())?;
    assert!(original.is_mutation());
    let actor = VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let witness = OriginalWitness {
        captured_digest: original.intent_digest().into(),
        source_grant: true,
        graph_access: true,
        approval_checked: true,
        result_disclosure: true,
    };
    let queue_authorization = SyntheticQueueAuthority::default();
    let invocations = Rc::new(Cell::new(0));
    let discovery = SyntheticDiscovery;
    let partition = SourcePartition {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(3),
        collection_id: id(4),
    };
    let receipt = ReceiptKey {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
        mutation_id: id(215),
    };
    let config = QueueConfig {
        lease_duration_ms: 1_000,
        retry: RetryPolicy {
            max_attempts: 2,
            initial_delay_ms: 100,
            max_delay_ms: 1_000,
        },
        registration: QueueRegistration {
            identity: PhysicalQueueIdentity {
                deployment_id: "synthetic-deployment".into(),
                physical_database_id: "synthetic-physical".into(),
                configuration_digest: Digest::from_hex("a".repeat(64))
                    .map_err(|e| format!("{e:?}"))?,
            },
            dispatcher_owner_id: "synthetic-owner".into(),
            aliases: vec![SourceAlias {
                partition: partition.clone(),
                canonical_collection_id: "physical-collection".into(),
            }],
        },
        admission_profile: AdmissionProfile::stock_engineering_fixture(),
    };
    let request = EnqueueRequest {
        receipt: receipt.clone(),
        partition: partition.clone(),
        intent: IntentMetadata {
            contract_id: "stock.2".into(),
            operation_id: original.id().as_str().into(),
            target_external_id: Some(id(5)),
            request_digest: Digest::from_hex(original.intent_digest().into())
                .map_err(|e| format!("{e:?}"))?,
        },
        write_scope: WriteScope {
            source_instance_id: id(3),
            collection_id: id(4),
            selection: ScopeSelection::Resources(vec![ResourceRef {
                kind: ResourceKind::Entity,
                id: id(5),
            }]),
        },
        pending_byte_liability: PendingByteLiability {
            required: false,
            reserved_bytes: None,
        },
    };
    let scope = config
        .registration
        .resolve(&request.partition, &request.write_scope)
        .map_err(|e| format!("{e:?}"))?;
    let inbox = QueueEvidenceInbox::default();

    let mut store = open(&path, &semantics, &storage_authorization, &runtime)?;
    {
        let mut session = store.queue_session(
            config.clone(),
            QueueSessionBinding {
                receipt: &receipt,
                original: &original,
                principal: &actor,
                witness: &witness,
            },
            &queue_authorization,
            inbox.clone(),
        )?;
        let EnqueueOutcome::Enqueued(queued) = session.enqueue(&request, &scope, &config, 1_000)?
        else {
            return Err("Fresh enqueue was not queued".into());
        };
        assert_eq!(queued.status, JobStatus::Queued);
        assert!(!queued.body_accepted);
    }
    store.close()?;

    let mut store = open(&path, &semantics, &storage_authorization, &runtime)?;
    let discovered = store
        .next_queue_original_intent(&config, &discovery)?
        .ok_or("Original intent was not discoverable")?;
    assert_eq!(discovered.receipt, receipt);
    assert_eq!(discovered.original, raw);
    assert_eq!(discovered.intent_digest.as_hex(), original.intent_digest());
    // Parse with the published offline stock validator, then supply the captured
    // original witness from this process to authorize the resumed queue session.
    let recovered = ValidatedRequest::parse(&schemas, discovered.original)?;
    assert_eq!(recovered.intent_digest(), witness.captured_digest);
    {
        let session = store.queue_session(
            config.clone(),
            QueueSessionBinding {
                receipt: &receipt,
                original: &recovered,
                principal: &actor,
                witness: &witness,
            },
            &queue_authorization,
            inbox.clone(),
        )?;
        let handles = session.into_handles();
        let writer = NativeHomeBoxWriter::new(
            SyntheticOwner {
                journal: handles.journal,
                expected_request: request.clone(),
            },
            SyntheticPreparedTransport {
                invocations: Rc::clone(&invocations),
            },
        );
        let mut queue =
            WriteQueue::new(handles.store, writer, config.clone()).map_err(|e| format!("{e:?}"))?;
        let DispatchOutcome::Finished(finished) = queue
            .dispatch_next(1_001, || 1_002)
            .map_err(|e| format!("{e:?}"))?
        else {
            return Err("Synthetic native dispatch was not finished".into());
        };
        assert_eq!(finished.status, JobStatus::Succeeded);
        assert_eq!(finished.attempts, 1);
        assert_eq!(
            finished.applied,
            Some(AppliedWrite {
                external_id: Some(id(5)),
                source_updated_at: Some("2026-10-07T01:00:00Z".into()),
                observation: ObservedWriteEvidence {
                    response_digest: digest_bytes(&response_bytes()),
                    readback_digest: digest_bytes(&readback_bytes()),
                    observed_at: 1_002,
                },
            })
        );
        assert!(finished.body_accepted);
        drop(queue);
    }
    store.close()?;

    let mut store = open(&path, &semantics, &storage_authorization, &runtime)?;
    {
        let mut session = store.queue_session(
            config.clone(),
            QueueSessionBinding {
                receipt: &receipt,
                original: &recovered,
                principal: &actor,
                witness: &witness,
            },
            &queue_authorization,
            inbox,
        )?;
        let saved = session
            .snapshot(&receipt)?
            .ok_or("Reopened receipt missing")?;
        assert_eq!(saved.status, JobStatus::Succeeded);
        assert_eq!(saved.attempts, 1);
        assert!(saved.body_accepted);
        let before = queue_authorization.snapshot_phases.borrow().len();
        assert!(session.held_job()?.is_none());
        assert_eq!(
            &queue_authorization.snapshot_phases.borrow()[before..],
            &["Entry", "Precommit", "Release"]
        );
    }
    store.validate_queue_storage(&config, &discovery, &schemas)?;
    store.close()?;
    assert_eq!(invocations.get(), 1);
    assert_eq!(queue_authorization.dispatch_checks.get(), 2);
    let db = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut counts = serde_json::Map::new();
    for table in [
        "queue_physical",
        "queue_aliases",
        "queue_jobs",
        "queue_attempts",
        "queue_journal",
        "queue_evidence",
        "queue_liability_evidence",
        "queue_outcomes",
        "records",
        "audits",
        "receipts",
    ] {
        let count: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })?;
        counts.insert(table.into(), json!(count));
    }
    assert_eq!(counts["queue_attempts"], 1);
    assert_eq!(counts["queue_journal"], 1);
    assert_eq!(counts["queue_outcomes"], 1);
    assert_eq!(counts["queue_evidence"], 2);
    assert_eq!(counts["queue_liability_evidence"], 2);
    let released: bool = db.query_row("SELECT active_job_id IS NULL AND active_fence IS NULL AND expires_at IS NULL FROM queue_physical", [], |row| row.get(0))?;
    assert!(released);
    let outcome: String = db.query_row("SELECT body FROM queue_outcomes", [], |row| row.get(0))?;
    let outcome: Value = serde_json::from_str(&outcome)?;
    assert_eq!(
        outcome["evidenceCut"]
            .as_array()
            .ok_or("Evidence cut missing")?
            .len(),
        2
    );
    assert_eq!(
        outcome["liabilityCut"]
            .as_array()
            .ok_or("Liability cut missing")?
            .len(),
        2
    );
    db.close().map_err(|(_, error)| error)?;
    let evidence = json!({"kind":"fresh-healthy-synthetic", "lineage":DATABASE_LINEAGE,
        "contractPeer":contract_peer,"domainJobsPeer":domain_peer,
        "databaseVersion":DATABASE_VERSION, "runtimePath":"WriteQueue -> NativeHomeBoxWriter -> QueueStoreHandle/QueueJournalHandle -> AtlasStore",
        "intentDigest":original.intent_digest(), "invocations":invocations.get(),
        "authorityChecks":queue_authorization.checks.get(), "finalDispatchChecks":queue_authorization.dispatch_checks.get(),
        "emptyHeldReadAuthorityPhases":["Entry","Precommit","Release"],
        "offlineResources":schemas.resources["resources"].as_array().ok_or("Offline resource map missing")?.len(),
        "schemaChecks":schemas.calls.borrow().clone(), "rowCounts":counts,
        "physicalSlotReleased":released,"reopens":2,"retainedQueueValidated":true,
        "nativePayloadDigest":digest_bytes(&native_payload()).as_hex(),
        "responseDigest":digest_bytes(&response_bytes()).as_hex(),
        "readbackDigest":digest_bytes(&readback_bytes()).as_hex(),
        "remoteEndDigest":digest_bytes(&remote_end_bytes()).as_hex(),
        "limits":"synthetic authority/runtime/prepared transport/evidence; no live provider or held controls"});
    fs::write(
        output.join("evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!(
        "healthy synthetic AT07: enqueue, original recovery, claim, native journal, atomic finish, reopened receipt"
    );
    Ok(())
}
