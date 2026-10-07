use houseatlas_at36_stock_harness::{
    domain::{queue_recovery::*, stock::*},
    jobs::{SourcePartition, *},
    storage::*,
};
use serde_json::json;
use std::cell::{Cell, RefCell};

pub type CheckResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const FIXTURE_PROFILE: &str = "at36-recovery-synthetic/1";
pub fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
pub fn digest(value: &str) -> CheckResult<Digest> {
    Digest::from_hex(value.to_owned()).map_err(|e| format!("{e:?}").into())
}
fn missing() -> Error {
    Error::new("owner-unavailable", "Synthetic proof is unavailable")
}
fn require(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(missing()) }
}

pub fn config(database: &str, partition: SourcePartition) -> QueueConfig {
    QueueConfig {
        lease_duration_ms: 1_000,
        retry: RetryPolicy {
            max_attempts: 2,
            initial_delay_ms: 100,
            max_delay_ms: 1_000,
        },
        registration: QueueRegistration {
            identity: PhysicalQueueIdentity {
                deployment_id: "fixture-deployment".into(),
                physical_database_id: database.into(),
                configuration_digest: Digest::from_hex("a".repeat(64))
                    .expect("fixed lowercase SHA256"),
            },
            dispatcher_owner_id: "fixture-owner".into(),
            aliases: vec![SourceAlias {
                partition,
                canonical_collection_id: database.into(),
            }],
        },
        admission_profile: AdmissionProfile::stock_engineering_fixture(),
    }
}
pub fn zero_liability() -> StorageLiability {
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
pub fn fixture_prepared() -> PreparedNativeIntent {
    PreparedNativeIntent {
        codec: "at36-fixture-native/1".into(),
        native_payload: serde_json::to_vec(&json!({
            "method":"PATCH","path":format!("/api/v1/entities/{}",id(5)),"body":{"quantity":0}
        }))
        .expect("fixed synthetic envelope"),
        prepared_media_evidence: b"at36-fixture-no-media/1; quantity=0".to_vec(),
        storage_liability: zero_liability(),
    }
}

// This independent fixture grant is issued before an image exists. No AT11
// capability, old live witness or image field creates recovery permission.
pub struct FixtureRecoveryGrant {
    registry: Vec<QueueConfig>,
}
impl FixtureRecoveryGrant {
    pub fn issue(registry: &[QueueConfig]) -> Self {
        Self {
            registry: registry.to_vec(),
        }
    }
}
pub struct FixtureRecoveryAuthority<'a> {
    pub issued: &'a FixtureRecoveryGrant,
    pub checks: Cell<usize>,
}
impl RecoveryDiscoveryAuthority for FixtureRecoveryAuthority<'_> {
    type Grant = FixtureRecoveryGrant;
    fn revalidate(
        &self,
        grant: &Self::Grant,
        registry: &[QueueConfig],
        registration: &QueueRegistration,
    ) -> Result<()> {
        require(
            std::ptr::eq(grant, self.issued)
                && grant.registry == registry
                && registry.iter().any(|c| c.registration == *registration),
        )?;
        self.checks.set(self.checks.get() + 1);
        Ok(())
    }
}

pub struct FixtureProof {
    receipt: ReceiptKey,
    original_digest: String,
}
pub struct FixtureOwner {
    pub original: ValidatedRequest,
    pub request: EnqueueRequest,
    pub primary: QueueConfig,
    pub admitted: RefCell<Option<LeasedJob>>,
    pub journal: RefCell<Option<NativeJournalReceipt>>,
    pub original_checks: Cell<usize>,
    pub attempt_checks: Cell<usize>,
    pub native_checks: Cell<usize>,
}
impl OriginalEnqueueOwner for FixtureOwner {
    type Proof = FixtureProof;
    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> Result<OriginalEnqueue<Self::Proof>> {
        require(
            *registration == self.primary.registration
                && *receipt == self.request.receipt
                && original.raw() == self.original.raw()
                && original.intent_digest() == self.original.intent_digest(),
        )?;
        self.original_checks.set(self.original_checks.get() + 1);
        Ok(OriginalEnqueue {
            physical_identity: self.primary.registration.identity.clone(),
            original: self.original.clone(),
            expected: self.request.clone(),
            proof: FixtureProof {
                receipt: self.request.receipt.clone(),
                original_digest: self.original.intent_digest().to_owned(),
            },
        })
    }
    fn retained_attempt(
        &self,
        registration: &QueueRegistration,
        proof: &Self::Proof,
        job_id: &JobId,
        fence: u64,
        attempt: u32,
    ) -> Result<LeasedJob> {
        require(
            *registration == self.primary.registration
                && proof.receipt == self.request.receipt
                && proof.original_digest == self.original.intent_digest(),
        )?;
        let job = self.admitted.borrow().as_ref().ok_or_else(missing)?.clone();
        require(job.lease.job_id == *job_id && job.lease.fence == fence && job.attempt == attempt)?;
        Ok(job)
    }
}
impl QueuedMediaRecovery<FixtureProof> for FixtureOwner {
    fn validate_original(&self, frame: &RetainedEnqueue<'_, FixtureProof>) -> Result<()> {
        require(
            frame.config == &self.primary
                && frame.request == &self.request
                && frame.original.raw() == self.original.raw()
                && frame.original.id() == OperationId::HomeboxEntityQuantitySet
                && frame.original.payload()["quantity"] == 0
                && frame.original_proof.receipt == self.request.receipt
                && frame.original_proof.original_digest == self.original.intent_digest()
                && frame.request.pending_byte_liability
                    == PendingByteLiability {
                        required: false,
                        reserved_bytes: None,
                    },
        )
    }
    fn validate_attempt(&self, frame: &RetainedAttempt<'_, FixtureProof>) -> Result<()> {
        self.validate_original(&frame.enqueue)?;
        require(
            self.admitted.borrow().as_ref() == Some(frame.job)
                && frame.steps.is_empty()
                && frame.outcomes.is_empty(),
        )?;
        match frame.prepared {
            None => require(frame.liabilities.is_empty())?,
            Some(prepared) => require(
                prepared.prepared_media_evidence == fixture_prepared().prepared_media_evidence
                    && prepared.storage_liability == zero_liability()
                    && frame.liabilities == [("journal".into(), zero_liability())],
            )?,
        }
        self.attempt_checks.set(self.attempt_checks.get() + 1);
        Ok(())
    }
    fn validate_outcome(&self, _: &RetainedOutcome<'_, '_, FixtureProof>) -> Result<()> {
        Err(missing())
    }
}
impl NativeRetainedEvidence<FixtureProof> for FixtureOwner {
    fn native_codec(&self) -> &str {
        "at36-fixture-native/1"
    }
    fn step_codec(&self, _: &StepKind) -> Option<&str> {
        None
    }
    fn validate_prepared(&self, frame: &RetainedAttempt<'_, FixtureProof>) -> Result<()> {
        let prepared = frame.prepared.ok_or_else(missing)?;
        let journal = frame.journal.ok_or_else(missing)?;
        let retained = self.journal.borrow();
        let receipt = retained.as_ref().ok_or_else(missing)?;
        require(
            *prepared == fixture_prepared()
                && journal.native_payload_digest == receipt.native_payload_digest
                && journal.journal_evidence_digest == receipt.journal_evidence_digest
                && self.admitted.borrow().as_ref() == Some(frame.job),
        )?;
        self.native_checks.set(self.native_checks.get() + 1);
        Ok(())
    }
    fn validate_step(
        &self,
        _: &RetainedAttempt<'_, FixtureProof>,
        _: usize,
        _: &QueueStepEvidence,
    ) -> Result<()> {
        Err(missing())
    }
    fn validate_outcome(&self, _: &RetainedOutcome<'_, '_, FixtureProof>) -> Result<()> {
        Err(missing())
    }
}

pub struct FixtureLiveWitness {
    pub original_digest: String,
}
pub struct FixtureLiveAuthority<'a> {
    pub owner: &'a FixtureOwner,
    pub registry: &'a [QueueConfig],
}
impl QueueAuthorization for FixtureLiveAuthority<'_> {
    type Principal = VerifiedActor;
    type Witness = FixtureLiveWitness;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        witness: &FixtureLiveWitness,
        original: &ValidatedRequest,
        _: QueuePhase,
        action: QueueAction<'_>,
    ) -> Result<VerifiedActor> {
        require(
            principal.workspace_id == self.owner.request.receipt.workspace_id
                && principal.home_id == self.owner.request.receipt.home_id
                && principal.actor_id == self.owner.request.receipt.actor_id
                && witness.original_digest == self.owner.original.intent_digest()
                && original.raw() == self.owner.original.raw(),
        )?;
        match action {
            QueueAction::Register(config) => require(self.registry.contains(config))?,
            QueueAction::Enqueue(request) => require(request == &self.owner.request)?,
            QueueAction::Snapshot(receipt) => require(receipt == &self.owner.request.receipt)?,
            QueueAction::Claim(job) => require(
                job.request == self.owner.request
                    && job.lease.physical_identity == self.owner.primary.registration.identity,
            )?,
            QueueAction::Journal(job, prepared) => require(
                self.owner.admitted.borrow().as_ref() == Some(job)
                    && *prepared == fixture_prepared(),
            )?,
            _ => return Err(missing()),
        }
        Ok(principal.clone())
    }
    fn validate_enqueue(
        &self,
        _: &VerifiedActor,
        witness: &FixtureLiveWitness,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
    ) -> Result<()> {
        require(
            witness.original_digest == original.intent_digest()
                && original.raw() == self.owner.original.raw()
                && request == &self.owner.request
                && self
                    .owner
                    .primary
                    .registration
                    .resolve(&request.partition, &request.write_scope)
                    .map_err(|_| missing())?
                    == *scope,
        )
    }
    fn parse_retained_original(&self, raw: serde_json::Value) -> Result<ValidatedRequest> {
        ValidatedRequest::parse(&NativeStockContract::new().map_err(|_| missing())?, raw)
            .map_err(|_| missing())
    }
    fn remote_end_step(
        &self,
        _: &VerifiedActor,
        _: &FixtureLiveWitness,
        _: &ValidatedRequest,
        _: &RemoteEndEvidence,
        _: &LeasedJob,
        _: &JournalEvidenceView,
    ) -> Result<QueueStepEvidence> {
        Err(missing())
    }
    fn reconciliation_steps(
        &self,
        _: &VerifiedActor,
        _: &FixtureLiveWitness,
        _: &ValidatedRequest,
        _: &HeldJob,
        _: &ReconciliationEvidence,
        _: &FinishDisposition,
    ) -> Result<Vec<QueueStepEvidence>> {
        Err(missing())
    }
}
pub struct FixtureStoreAuthority;
impl Authorization for FixtureStoreAuthority {
    type Principal = VerifiedActor;
    fn authorize(
        &self,
        principal: &VerifiedActor,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        require(
            principal.workspace_id == request.scope.workspace_id
                && principal.home_id == request.scope.home_id,
        )?;
        Ok(principal.clone())
    }
}
pub struct FixtureRuntime {
    next: Cell<u64>,
}
impl FixtureRuntime {
    pub fn new() -> Self {
        Self {
            next: Cell::new(90_000),
        }
    }
}
impl Runtime for FixtureRuntime {
    fn now(&self) -> Result<String> {
        Ok("2026-10-07T12:00:00Z".into())
    }
    fn new_id(&self) -> Result<String> {
        let next = self.next.get();
        self.next.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
        Err(missing())
    }
}
