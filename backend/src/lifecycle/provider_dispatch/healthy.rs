//! Fresh in-process synthetic composition only; no recovered dispatch, replay,
//! stopped control, listener, HTTP client, credential or live provider call.
//! Fixture authority/effects are synthetic; the durable SQL and mapping are real.
use super::*;
use crate::jobs::{FailureCode, SourcePartition};
use crate::{
    domain::stock::{NativeStockContract, ValidatedRequest},
    jobs::*,
    storage::*,
};
use serde_json::{Value, json};
use sha2::{Digest as ShaDigest, Sha256};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012}")
}

struct FixtureAuthorization;
impl Authorization for FixtureAuthorization {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        _: AuthorizationRequest<'_>,
    ) -> storage::Result<VerifiedActor> {
        Ok(principal.clone())
    }
}
struct FixtureRuntime(Cell<u64>);
impl Runtime for FixtureRuntime {
    fn now(&self) -> storage::Result<String> {
        Ok("2026-10-07T01:00:00Z".into())
    }
    fn new_id(&self) -> storage::Result<String> {
        let n = self.0.get();
        self.0.set(n + 1);
        Ok(id(n))
    }
    fn verify_available_asset(&self, _: &Record) -> storage::Result<AssetProof> {
        Err(Error::new("unavailable", "No fixture media"))
    }
}
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
    use crate::providers::homebox::write::stock;
    let raw = original_wire();
    let schemas = NativeStockContract::new().unwrap();
    let original = ValidatedRequest::parse(&schemas, raw.clone()).unwrap();
    let target = stock::StockTarget {
        source_instance_id: uuid::Uuid::parse_str(&id(3)).unwrap(),
        collection_id: uuid::Uuid::parse_str(&id(4)).unwrap(),
        resource_kind: stock::ResourceKind::Entity,
        resource_id: Some(uuid::Uuid::parse_str(&id(5)).unwrap()),
        entity_id: None,
    };
    let command = stock::StockCommand {
        command_id: original.id().as_str().into(),
        request_id: uuid::Uuid::parse_str(&id(115)).unwrap(),
        idempotency_key: uuid::Uuid::parse_str(&id(215)).unwrap(),
        context: serde_json::from_value(raw["context"].clone()).unwrap(),
        target: target.clone(),
        payload: raw["payload"].clone(),
        native_sync_behavior: None,
        provider_observation: uuid::Uuid::parse_str(&id(16)).unwrap(),
        approval_receipt_id: None,
        original_wire: raw,
        request_digest: stock::Digest::parse(original.intent_digest().into()).unwrap(),
    };
    let observed = json!({"id":id(5),"quantity":1});
    let preparation = stock::Preparation {
        snapshots: vec![stock::NativeSnapshot {
            target,
            value: observed.clone(),
            digest: stock::Digest::parse(
                digest_bytes(&serde_json::to_vec(&observed).unwrap())
                    .as_hex()
                    .into(),
            )
            .unwrap(),
            complete: true,
            hidden_fields_preserved: true,
        }],
        ..Default::default()
    };
    let mapped = stock::map_stock(&command, &preparation).unwrap();
    assert_eq!(mapped.request.method, stock::NativeMethod::Patch);
    assert_eq!(mapped.request.path, format!("/api/v1/entities/{}", id(5)));
    assert_eq!(
        mapped.request.body,
        stock::NativeBody::Json(json!({"quantity":0}))
    );
    serde_json::to_vec(&mapped).unwrap()
}

fn response_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({"id":id(5),"quantity":0,"updatedAt":"2026-10-07T01:00:00Z"}))
        .expect("Fixed synthetic response")
}

fn readback_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({"id":id(5),"quantity":0,"updatedAt":"2026-10-07T01:00:00Z"}))
        .expect("Fixed synthetic readback")
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
        };
        let response_digest = digest_bytes(&response.response);
        permit.invoked(
            TransportAcknowledgement::DefiniteResponse {
                response,
                response_digest,
            },
            InvokedRemoteActivity::EndUnproven,
            zero_liability(),
        )
    }
}

struct SyntheticOwner<J> {
    journal: J,
    expected_request: EnqueueRequest,
    committed_journal: Rc<RefCell<Option<NativeJournalReceipt>>>,
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
        *self.committed_journal.borrow_mut() = Some(receipt.clone());
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
            || *response_digest != digest_bytes(&response.response)
        {
            return WriteOutcome::Uncertain {
                reason: FailureCode::OutcomeUnknown,
            };
        }
        let readback_digest = digest_bytes(&response.readback);
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
        if inbox.submit(job, response_step).is_err() {
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

#[test]
fn healthy_fresh_native_dispatch() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("atlas.sqlite");
    let store = AtlasStore::open(
        &path,
        crate::http::contracts::NativeContracts,
        FixtureAuthorization,
        FixtureRuntime(Cell::new(90000)),
        StoreOptions::default(),
    )
    .unwrap();
    let original =
        ValidatedRequest::parse(&NativeStockContract::new().unwrap(), original_wire()).unwrap();
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
    let authority = SyntheticQueueAuthority::default();
    let (request, _) = expected_enqueue(&original, &actor.actor_id).unwrap();
    let config = QueueConfig {
        lease_duration_ms: 1000,
        retry: RetryPolicy {
            max_attempts: 1,
            initial_delay_ms: 100,
            max_delay_ms: 1000,
        },
        registration: QueueRegistration {
            identity: PhysicalQueueIdentity {
                deployment_id: "synthetic-deployment".into(),
                physical_database_id: "synthetic-physical".into(),
                configuration_digest: digest_bytes(b"synthetic config"),
            },
            dispatcher_owner_id: "synthetic-owner".into(),
            aliases: vec![SourceAlias {
                partition: request.partition.clone(),
                canonical_collection_id: "physical-collection".into(),
            }],
        },
        admission_profile: AdmissionProfile::stock_engineering_fixture(),
    };
    let invocations = Rc::new(Cell::new(0));
    let mut host = ProviderDispatcher::new(
        store,
        SyntheticPreparedTransport {
            invocations: Rc::clone(&invocations),
        },
        TrustedDispatcherConfig::new(config).unwrap(),
    );
    {
        let committed = Rc::new(RefCell::new(None));
        let mut bound = host
            .bind(
                QueueSessionBinding {
                    receipt: &request.receipt,
                    original: &original,
                    principal: &actor,
                    witness: &witness,
                },
                &authority,
                |journal| SyntheticOwner {
                    journal,
                    expected_request: request.clone(),
                    committed_journal: committed.clone(),
                },
            )
            .unwrap();
        let EnqueueOutcome::Enqueued(queued) = bound.enqueue(&request, 1000).unwrap() else {
            panic!("fresh enqueue")
        };
        assert_eq!(queued.status, JobStatus::Queued);
        assert!(!queued.body_accepted);
        let DispatchOutcome::Finished(finished) = bound.dispatch_next(1001, || 1002).unwrap()
        else {
            panic!("fresh finish")
        };
        assert_eq!(finished.status, JobStatus::Succeeded);
        assert_eq!(finished.attempts, 1);
        assert_eq!(
            finished.remote_activity,
            RemoteActivity::Invoked(InvokedRemoteActivity::EndUnproven)
        );
        assert!(!finished.unknown_scope_fence_retained);
        assert_eq!(
            finished
                .applied
                .as_ref()
                .unwrap()
                .source_updated_at
                .as_deref(),
            Some("2026-10-07T01:00:00Z")
        );
        assert_eq!(bound.snapshot(&request.receipt).unwrap(), Some(finished));
        assert!(committed.borrow().is_some());
    }
    assert_eq!(invocations.get(), 1);
    assert_eq!(authority.dispatch_checks.get(), 2);
    let (store, _) = host.into_parts();
    store.close().unwrap();
    let db =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let (state, activity, original_json): (String, String, String) = db
        .query_row(
            "SELECT status,activity,original_json FROM queue_jobs",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, "succeeded");
    assert_eq!(activity, "end-unproven");
    assert_eq!(
        serde_json::from_str::<Value>(&original_json).unwrap(),
        original_wire()
    );
    let active: String = db
        .query_row("SELECT active_job_id FROM queue_physical", [], |r| r.get(0))
        .unwrap();
    assert!(!active.is_empty());
    for (table, count) in [
        ("queue_attempts", 1),
        ("queue_journal", 1),
        ("queue_evidence", 1),
        ("queue_outcomes", 1),
    ] {
        let actual: i64 = db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(actual, count);
    }
}
