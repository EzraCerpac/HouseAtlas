//! Native AT07 queue on AtlasStore's private SQLite connection.
//! A QueueSession borrows the store; each operation opens and closes its own SQL
//! transaction. The synchronous provider transport runs after the claim/journal
//! transactions have committed and before finish begins.
#[path = "queue_codec.rs"]
mod codec;
#[path = "queue_handles.rs"]
mod handles;
use super::{AtlasStore, Authorization, Contract, Error, Result, Runtime, VerifiedActor};
use crate::{
    domain::stock::{StockContractPort, ValidatedRequest},
    jobs::*,
};
use codec::*;
pub use handles::{QueueHandles, QueueJournalHandle, QueueJournalPort, QueueStoreHandle};
#[path = "queue_repository.rs"]
mod repository;
use repository::*;
#[path = "queue_journal_checks.rs"]
mod journal_checks;
use journal_checks::*;
#[path = "queue_recovery.rs"]
mod recovery;
pub(crate) use recovery::validate_recovery_queues;
use recovery::*;
#[path = "queue_liability.rs"]
mod liability;
use liability::*;
#[path = "queue_state.rs"]
mod state;
use state::*;
#[path = "queue_outcomes.rs"]
mod outcomes;
use outcomes::*;
#[path = "queue_evidence.rs"]
mod evidence;
use evidence::*;
#[path = "queue_original_preparation.rs"]
mod original_preparation;
pub use original_preparation::{
    QueueOriginalPreparationCommittedData, QueueOriginalPreparationData,
    QueueOriginalPreparationObservation,
};
#[path = "queue_admission.rs"]
mod admission;
#[path = "queue_journal_custody.rs"]
mod journal_custody;
#[path = "queue_original_owner.rs"]
mod original_owner;
pub use journal_custody::{
    OriginalQueueJournalCut, QueueOriginalJournalCommittedData,
    QueueOriginalJournalCommittedObservation,
};
pub use original_owner::{
    OriginalQueuedQuantityAttempt, OriginalQueuedQuantityClaim, OriginalQueuedQuantityEnqueue,
    OriginalQueuedQuantityOwner, QueueOriginalCommittedData, QueueOriginalCommittedObservation,
    RecordedOriginalEnqueue, RecordedOriginalEnqueueProof,
};
#[path = "queue_finish.rs"]
mod finish;
#[path = "queue_journal.rs"]
mod journal;
#[path = "queue_quantity_original.rs"]
mod quantity_original;
#[path = "queue_upload_original.rs"]
mod upload_original;
#[path = "queue_upload_original_owner.rs"]
mod upload_original_owner;
pub use upload_original_owner::{
    OriginalQueuedUploadAttempt, OriginalQueuedUploadClaim, OriginalQueuedUploadEnqueue,
    OriginalQueuedUploadOwner, QueueUploadCommittedData, QueueUploadCommittedObservation,
    RecordedOriginalUploadEnqueue, RecordedOriginalUploadEnqueueProof,
};
#[path = "queue_queries.rs"]
mod queries;
#[path = "queue_resolution.rs"]
mod resolution;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

const MAX_METADATA_BYTES: usize = 1_048_576;

/// Read-only correlation with the original complete queue registration. This
/// creates no row, dispatch permit, occupation claim or replacement authority.
pub(crate) fn validate_quantity_installation_queue(
    db: &Connection,
    config: &QueueConfig,
) -> Result<()> {
    assert_registered(db, config)
}

/// Exact immutable cross-lane reference only. Independent activity evidence
/// must already qualify occupancy at the native queued cut; current/final
/// Jobs state is deliberately not substituted for that historical observation.
pub(crate) fn validate_reservation_occupancy(
    db: &Connection,
    attempt: &LeasedJob,
    binding: &crate::providers::homebox::write::stock::PhysicalBinding,
    owner: uuid::Uuid,
) -> Result<()> {
    let identity = &attempt.lease.physical_identity;
    if identity.deployment_id != binding.deployment_id.to_string()
        || identity.physical_database_id != binding.physical_database_id.to_string()
        || identity.configuration_digest.as_hex() != binding.configuration_digest.as_str()
        || attempt.lease.owner_id != owner.to_string()
        || attempt.lease.fence == 0
        || attempt.attempt == 0
    {
        return Err(bad());
    }
    let registration: (String, String, String) = db.query_row(
        "SELECT deployment_id,configuration_digest,owner_id FROM queue_physical WHERE physical_database_id=?1",
        [&identity.physical_database_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| bad())?;
    if registration
        != (
            identity.deployment_id.clone(),
            identity.configuration_digest.as_hex().into(),
            attempt.lease.owner_id.clone(),
        )
    {
        return Err(bad());
    }
    let row = load(db, &attempt.lease.job_id.0)?;
    if row.deployment != identity.deployment_id
        || row.physical != identity.physical_database_id
        || row.request != attempt.request
        || row.scope != attempt.canonical_scope
        || row.request.pending_byte_liability != attempt.pending_byte_liability
    {
        return Err(bad());
    }
    let retained: String = db
        .query_row(
            "SELECT original_leased_job_json FROM queue_attempts WHERE job_id=?1 AND fence=?2",
            params![attempt.lease.job_id.0, decimal(attempt.lease.fence)],
            |row| row.get(0),
        )
        .map_err(|_| bad())?;
    if retained != encoded(&leased_value(attempt))? {
        return Err(bad());
    }
    Ok(())
}

fn bad() -> Error {
    Error::new("schema-incompatible", "Stored queue value is incompatible")
}
fn invalid() -> Error {
    Error::new("invalid-contract", "Queue request is incompatible")
}
fn stale() -> Error {
    Error::new("identity-conflict", "Queue lease is stale")
}
fn conflict() -> Error {
    Error::new(
        "identity-conflict",
        "Queue receipt conflicts with original intent",
    )
}
fn overflow() -> Error {
    Error::new("invalid-contract", "Queue counter overflow")
}
fn encoded(value: &Value) -> Result<String> {
    let text = serde_json::to_string(value)?;
    if text.len() > MAX_METADATA_BYTES {
        return Err(invalid());
    }
    Ok(text)
}
fn decoded(value: &str) -> Result<Value> {
    if value.len() > MAX_METADATA_BYTES {
        return Err(bad());
    }
    Ok(serde_json::from_str(value)?)
}
fn decimal(n: u64) -> String {
    n.to_string()
}
fn sum(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(overflow)
}
fn digest(value: &[u8]) -> String {
    super::migrations::sha256(value)
}

#[derive(Clone, Copy)]
pub enum QueuePhase {
    Entry,
    Precommit,
    Release,
}
pub enum QueueAction<'a> {
    Register(&'a QueueConfig),
    Lease(&'a Lease),
    Reject {
        request: &'a EnqueueRequest,
        reason: AdmissionRejection,
    },
    Dispatch {
        job: &'a LeasedJob,
        journal: &'a JournalEvidenceView,
        now: Timestamp,
    },
    Enqueue(&'a EnqueueRequest),
    Replay {
        snapshot: &'a JobSnapshot,
        stored_original: &'a ValidatedRequest,
    },
    Claim(&'a LeasedJob),
    ExpireWaiter(&'a EnqueueRequest),
    ExpireLease(&'a LeasedJob),
    Finish {
        job: &'a LeasedJob,
        report: &'a FinishReport,
        journal: Option<&'a JournalEvidenceView>,
        steps: &'a [QueueStepEvidence],
    },
    Snapshot(&'a ReceiptKey),
    Held(&'a HeldJob),
    Reconcile {
        job: &'a HeldJob,
        evidence: &'a ReconciliationEvidence,
        disposition: &'a FinishDisposition,
        steps: &'a [QueueStepEvidence],
    },
    RemoteEnd {
        evidence: &'a RemoteEndEvidence,
        job: &'a LeasedJob,
        journal: &'a JournalEvidenceView,
        step: &'a QueueStepEvidence,
    },
    Journal(&'a LeasedJob, &'a PreparedNativeIntent),
}
/// Required owner adapter. Its implementation rechecks current captured access,
/// original stock grant/graph/approval and result disclosure as appropriate.
/// No principal, witness or bearer token is deserialized from queue rows.
pub trait QueueAuthorization {
    type Principal;
    type Witness;
    fn authorize(
        &self,
        principal: &Self::Principal,
        original_witness: &Self::Witness,
        original: &ValidatedRequest,
        phase: QueuePhase,
        action: QueueAction<'_>,
    ) -> Result<VerifiedActor>;
    /// Re-derive every queue-specific field from the immutable stock request:
    /// full physical scope, operation/contract/target, all ordered resource keys,
    /// pending media byte reservation and approval-bound effects. No defaults.
    fn validate_enqueue(
        &self,
        principal: &Self::Principal,
        original_witness: &Self::Witness,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
    ) -> Result<()>;
    /// Decode the retained original with the exact stock schema peer. This
    /// supplies no authority; Replay must authorize this original using the
    /// retained witness, without substituting renewed request facts.
    fn parse_retained_original(&self, value: Value) -> Result<ValidatedRequest>;
    /// Resolve actual qualified termination evidence bytes. A digest or lease
    /// alone cannot establish termination or authorize releasing the slot.
    fn remote_end_step(
        &self,
        principal: &Self::Principal,
        original_witness: &Self::Witness,
        original: &ValidatedRequest,
        evidence: &RemoteEndEvidence,
        job: &LeasedJob,
        journal: &JournalEvidenceView,
    ) -> Result<QueueStepEvidence>;
    /// Return already produced, qualified evidence. These synchronous authority
    /// callbacks perform no provider I/O and receive no SQL handle.
    fn reconciliation_steps(
        &self,
        principal: &Self::Principal,
        original_witness: &Self::Witness,
        original: &ValidatedRequest,
        job: &HeldJob,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<Vec<QueueStepEvidence>>;
}
/// A trusted recovery worker must be explicitly authorized before seeing a
/// queued public original. This does not mint or reconstruct an authority witness.
pub trait QueueDiscovery {
    fn authorize_discovery(&self, registration: &QueueRegistration) -> Result<()>;
    /// Pure owner derivation of the complete immutable enqueue metadata. No
    /// grant or provider readiness is reconstructed by this validation.
    fn validate_retained_enqueue(
        &self,
        original: &ValidatedRequest,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
    ) -> Result<()>;
}
/// Borrowed retained facts only. Codec qualification cannot mint a grant,
/// terminate remote activity, release a fence, or remove byte liabilities.
pub struct QueueRecoveryOutcome<'a> {
    pub at: Timestamp,
    pub kind: &'a str,
    pub report: &'a FinishReport,
    pub reconciliation: Option<&'a Value>,
    pub steps: &'a [QueueStepEvidence],
    pub liabilities: &'a [(String, StorageLiability)],
}
pub struct QueueRecoveryAttempt<'a> {
    pub original: &'a ValidatedRequest,
    pub job: &'a LeasedJob,
    /// Actual retained bytes, not a payload reconstructed from a digest.
    pub prepared: Option<&'a PreparedNativeIntent>,
    pub journal: Option<&'a JournalEvidenceView>,
    pub steps: &'a [QueueStepEvidence],
    pub liabilities: &'a [(String, StorageLiability)],
    pub outcomes: &'a [QueueRecoveryOutcome<'a>],
}
/// Required full-image native/media/evidence codec peer. It validates every
/// retained journal and step against the exact original and leased attempt,
/// including outcome-local evidence cuts, reconciliation and termination facts.
/// Return unavailable for unknown codecs or missing external evidence. These
/// synchronous callbacks receive no database handle and perform no provider I/O.
pub trait QueueRecoveryEvidence {
    fn validate_attempt(&self, config: &QueueConfig, frame: QueueRecoveryAttempt<'_>)
    -> Result<()>;
    /// Full-image Media policy qualification, independent of Jobs membership.
    /// Match actual original renderer/stage provenance to the exact asset or
    /// original upload binding. Image rows, MIME, hashes, correlated native
    /// receipts and mirrored DTOs cannot establish renderer qualification.
    /// Called only for SafeRendered claims, under the same read transaction;
    /// do not reenter Storage, call a provider or revive grants. Original Media
    /// evidence owners must fail closed for unknown/missing archived evidence.
    fn validate_media_policy(&self, _: super::MediaPolicyRecoveryFrame<'_>) -> Result<()> {
        Err(Error::new(
            "owner-unavailable",
            "Independent Media policy evidence is required",
        ))
    }
}
#[derive(Clone, Debug)]
pub struct QueueOriginalIntent {
    pub job_id: JobId,
    pub receipt: ReceiptKey,
    pub original: Value,
    pub intent_digest: Digest,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedNativeIntent {
    pub codec: String,
    /// Exact qualified method/path/body envelope, without credentials or grants.
    pub native_payload: Vec<u8>,
    /// Owner-qualified prepared media/staging evidence, no raw upload body.
    pub prepared_media_evidence: Vec<u8>,
    pub storage_liability: StorageLiability,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepKind {
    ResponseReadback,
    PositiveNoEffect,
    RemoteEnd,
    Reconciliation,
    Other,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueStepEvidence {
    pub kind: StepKind,
    pub codec: String,
    pub payload: Vec<u8>,
    pub response_digest: Option<Digest>,
    pub readback_digest: Option<Digest>,
    pub termination_digest: Option<Digest>,
}
#[derive(Clone, Debug)]
pub struct NativeJournalReceipt {
    pub native_payload_digest: Digest,
    pub journal_evidence_digest: Digest,
}
#[derive(Clone, Debug)]
pub struct JournalEvidenceView {
    pub native_codec: String,
    pub native_payload_digest: Digest,
    pub prepared_media_digest: Digest,
    pub prepared_liability: StorageLiability,
    pub journal_evidence_digest: Digest,
}
/// The qualified writer submits per-step evidence after I/O. QueueStore::finish
/// drains it into the SAME transaction that changes job state. Crash before
/// finish leaves the original lease/slot held; nothing is falsely applied.
#[derive(Clone, Default)]
pub struct QueueEvidenceInbox(Arc<Mutex<InboxEntries>>);
type InboxEntries = BTreeMap<(String, u64), (LeasedJob, Vec<QueueStepEvidence>)>;
impl QueueEvidenceInbox {
    pub fn submit(&self, job: &LeasedJob, evidence: QueueStepEvidence) -> Result<()> {
        if evidence.codec.is_empty()
            || evidence.codec.len() > 128
            || evidence.payload.is_empty()
            || evidence.payload.len() > MAX_METADATA_BYTES
        {
            return Err(invalid());
        }
        let mut pending = self.0.lock().map_err(|_| bad())?;
        let item = pending
            .entry((job.lease.job_id.0.clone(), job.lease.fence))
            .or_insert_with(|| (job.clone(), Vec::new()));
        if item.0 != *job {
            return Err(stale());
        }
        item.1.push(evidence);
        Ok(())
    }
    fn consume_prefix(&self, lease: &Lease, expected: &[QueueStepEvidence]) -> Result<()> {
        let key = (lease.job_id.0.clone(), lease.fence);
        let mut pending = self.0.lock().map_err(|_| bad())?;
        if let Some((_, steps)) = pending.get_mut(&key) {
            if !steps.starts_with(expected) {
                return Err(stale());
            }
            steps.drain(..expected.len());
            if steps.is_empty() {
                pending.remove(&key);
            }
        } else if !expected.is_empty() {
            return Err(stale());
        }
        Ok(())
    }
}

fn authorize_session<Q: QueueAuthorization>(
    authority: &Q,
    principal: &Q::Principal,
    witness: &Q::Witness,
    original: &ValidatedRequest,
    receipt: &ReceiptKey,
    phase: QueuePhase,
    action: QueueAction<'_>,
) -> Result<()> {
    let actor = authority.authorize(principal, witness, original, phase, action)?;
    if actor.workspace_id != receipt.workspace_id
        || actor.home_id != receipt.home_id
        || actor.actor_id != receipt.actor_id
    {
        return Err(Error::new("forbidden", "Queue actor binding changed"));
    }
    Ok(())
}
fn matches_original(
    receipt: &ReceiptKey,
    original: &ValidatedRequest,
    row: &StoredJob,
    config: &QueueConfig,
) -> Result<()> {
    assert_physical(row, config)?;
    if row.request.receipt != *receipt
        || row.original_json != encoded(original.raw())?
        || row.request.intent.request_digest.as_hex() != original.intent_digest()
        || row.request.partition.workspace_id != original.context().workspace_id
        || row.request.partition.home_id != original.context().home_id
    {
        return Err(conflict());
    }
    Ok(())
}
pub struct QueueSession<'a, C, A: Authorization, R, Q: QueueAuthorization<Principal = A::Principal>>
{
    store: &'a mut AtlasStore<C, A, R>,
    config: QueueConfig,
    receipt: &'a ReceiptKey,
    original: &'a ValidatedRequest,
    principal: &'a Q::Principal,
    witness: &'a Q::Witness,
    authority: &'a Q,
    inbox: QueueEvidenceInbox,
}
/// The original typed authority handles remain borrowed and are never stored.
pub struct QueueSessionBinding<'a, P, W> {
    pub receipt: &'a ReceiptKey,
    pub original: &'a ValidatedRequest,
    pub principal: &'a P,
    pub witness: &'a W,
}
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn queue_session<'a, Q: QueueAuthorization<Principal = A::Principal>>(
        &'a mut self,
        config: QueueConfig,
        binding: QueueSessionBinding<'a, Q::Principal, Q::Witness>,
        authority: &'a Q,
        inbox: QueueEvidenceInbox,
    ) -> Result<QueueSession<'a, C, A, R, Q>> {
        let QueueSessionBinding {
            receipt,
            original,
            principal,
            witness,
        } = binding;
        config.validate().map_err(|_| invalid())?;
        if !original.is_mutation()
            || original.context().workspace_id != receipt.workspace_id
            || original.context().home_id != receipt.home_id
        {
            return Err(invalid());
        }
        let actor = authority.authorize(
            principal,
            witness,
            original,
            QueuePhase::Entry,
            QueueAction::Register(&config),
        )?;
        if actor.workspace_id != receipt.workspace_id
            || actor.home_id != receipt.home_id
            || actor.actor_id != receipt.actor_id
        {
            return Err(Error::new("forbidden", "Queue actor binding changed"));
        }
        register(
            &mut self.db,
            &config,
            self.options.stock_activity_profile,
            || {
                authorize_session(
                    authority,
                    principal,
                    witness,
                    original,
                    receipt,
                    QueuePhase::Precommit,
                    QueueAction::Register(&config),
                )
            },
        )?;
        authorize_session(
            authority,
            principal,
            witness,
            original,
            receipt,
            QueuePhase::Release,
            QueueAction::Register(&config),
        )?;
        Ok(QueueSession {
            store: self,
            config,
            receipt,
            original,
            principal,
            witness,
            authority,
            inbox,
        })
    }
    /// Read-only v3 queue codec/history validation for a future full-image
    /// native recovery path. No witness or provider readiness is reconstructed.
    pub fn validate_queue_storage(
        &mut self,
        config: &QueueConfig,
        discovery: &impl QueueDiscovery,
        schemas: &impl StockContractPort,
    ) -> Result<()> {
        discovery.authorize_discovery(&config.registration)?;
        let tx = self.db.transaction()?;
        validate_retained_queue(&tx, config, discovery, schemas)?;
        discovery.authorize_discovery(&config.registration)?;
        tx.commit()?;
        Ok(())
    }
    /// Deterministic FIFO recovery seam. The trusted owner reparses this with
    /// StockContractPort and supplies ORIGINAL typed principal/witness separately.
    pub fn next_queue_original_intent(
        &mut self,
        config: &QueueConfig,
        discovery: &impl QueueDiscovery,
    ) -> Result<Option<QueueOriginalIntent>> {
        discovery.authorize_discovery(&config.registration)?;
        let tx = self.db.transaction()?;
        assert_registered(&tx, config)?;
        let (_, active_id, _, _) = active(&tx, config)?;
        let first = if active_id.is_some() {
            active_id
        } else {
            due_ids(&tx, config)?.into_iter().next()
        };
        let out = first
            .as_ref()
            .map(|id| -> Result<_> {
                let row = load(&tx, id)?;
                Ok(QueueOriginalIntent {
                    job_id: JobId(id.clone()),
                    receipt: row.request.receipt,
                    original: decoded(&row.original_json)?,
                    intent_digest: row.request.intent.request_digest,
                })
            })
            .transpose()?;
        discovery.authorize_discovery(&config.registration)?;
        tx.commit()?;
        Ok(out)
    }
}

impl<C: Contract, A: Authorization, R: Runtime, Q: QueueAuthorization<Principal = A::Principal>>
    QueueStore for QueueSession<'_, C, A, R, Q>
{
    type Error = Error;
    fn enqueue(
        &mut self,
        request: &EnqueueRequest,
        scope: &CanonicalScope,
        config: &QueueConfig,
        now: Timestamp,
    ) -> Result<EnqueueOutcome> {
        self.enqueue_inner(request, scope, config, now)
    }
    fn claim_next(&mut self, now: Timestamp, config: &QueueConfig) -> Result<ClaimOutcome> {
        self.claim_next_inner(now, config)
    }
    fn finish(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        report: &FinishReport,
    ) -> Result<JobSnapshot> {
        self.finish_inner(lease, now, report)
    }
    fn snapshot(&mut self, receipt: &ReceiptKey) -> Result<Option<JobSnapshot>> {
        self.snapshot_inner(receipt)
    }
    fn held_job(&mut self) -> Result<Option<HeldJob>> {
        self.held_job_inner()
    }
    fn reconcile(
        &mut self,
        lease: &Lease,
        now: Timestamp,
        evidence: &ReconciliationEvidence,
        disposition: &FinishDisposition,
    ) -> Result<JobSnapshot> {
        self.reconcile_inner(lease, now, evidence, disposition)
    }
    fn prove_remote_end(
        &mut self,
        evidence: &RemoteEndEvidence,
        now: Timestamp,
    ) -> Result<JobSnapshot> {
        self.prove_remote_end_inner(evidence, now)
    }
}

/// Conservative cross-lane exclusion from actual Jobs rows. This grants no
/// StockActivity permit and converts no scope, lease, epoch or accounting DTO.
pub(crate) fn unresolved_physical_hold(db: &Connection, physical: &str) -> Result<bool> {
    let deployment: Option<String> = db
        .query_row(
            "SELECT deployment_id FROM queue_physical WHERE physical_database_id=?1",
            [physical],
            |r| r.get(0),
        )
        .optional()?;
    let Some(deployment) = deployment else {
        return Ok(false);
    };
    let ids = db
        .prepare(CROSS_LANE_HOLD_CANDIDATES)?
        .query_map(params![deployment, physical], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        let row = load(db, &id)?;
        let liability = &row.liability;
        let known = match liability.accounting {
            ByteAccounting::Complete { known_bytes, .. }
            | ByteAccounting::Incomplete { known_bytes } => known_bytes,
        };
        if row.logical
            || matches!(
                row.remote,
                RemoteActivity::Invoked(
                    InvokedRemoteActivity::Active | InvokedRemoteActivity::EndUnproven
                )
            )
            || liability.reserved_bytes().is_none_or(|n| n > 0)
            || known > 0
            || liability.unresolved_attempts > 0
            || liability.byte_disposition != ByteDisposition::None
        {
            return Ok(true);
        }
    }
    Ok(false)
}
