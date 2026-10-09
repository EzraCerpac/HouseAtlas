//! Pure catalog validation with actual archived owners. No recovery action,
//! live original authority, body custody or remote-effect proof is created.
use super::{
    homebox_queued_upload_history_catalog::{MAX_CATALOG_MEMBERS, MAX_CATALOG_QUEUES},
    homebox_queued_upload_history_catalog_admission::AdmittedQueuedUploadOriginalCatalogEntry,
};
use crate::{
    access::{OfflineRecoveryAuthority, RecoveryDiscoveryGrant},
    config::recovery::RecoveryPeers,
    domain::{
        queue_recovery::{
            NativeQueueDiscovery, NativeQueueRecoveryEvidence, NativeRetainedEvidence,
            OriginalEnqueue, OriginalEnqueueOwner, QueueRecoveryBindings, QueuedMediaRecovery,
            RecoveryDiscoveryAuthority, RetainedAttempt, RetainedEnqueue, RetainedOutcome,
        },
        stock::{NativeStockContract, ValidatedRequest},
    },
    jobs::{JobId, LeasedJob, QueueConfig, QueueRegistration, ReceiptKey},
    lifecycle::recovery::{
        upload_history_intake::{
            AuthenticatedQueuedUploadOriginalFrame, PreparedQueuedUploadHistoryIntake,
        },
        upload_history_validation::{self, ValidatedQueuedUploadHistoryImage},
    },
    media::{
        WorkBudget,
        native_queued_upload::NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
        native_queued_upload_archived::{
            ArchivedQueuedUploadMediaFacts, ArchivedQueuedUploadMediaRecovery,
        },
    },
    providers::homebox::write::stock::ArchivedQueuedUploadSourceFacts,
    storage::{
        self, ArchivedQueuedUploadOriginalFacts, ArchivedQueuedUploadOriginalOwner,
        ArchivedQueuedUploadOriginalProof,
    },
};
use std::sync::Arc;

// Admission accounting, not process RSS or the already captured archive/image.
// Before each deep decode, reserve all current decoder ceilings together:
// Storage 96 MiB + Source 64 MiB + Media 64 MiB + 32 MiB transient headroom.
const FRAME_DECODE_ALLOWANCE: usize = 256 * 1024 * 1024;
const CATALOG_DECODE_ALLOWANCE: usize = 512 * 1024 * 1024;
// Covers bounded contract construction, complete registry copies, vectors and
// peer metadata. Per-record lookup owns four receipt strings (allowing up to
// five at 16 KiB each), a 16 KiB request ID, a 64-byte digest and object overhead.
// Immutable borrowed archive frames have their separate existing 512 MiB cap.
const FIXED_ALLOWANCE: usize = 32 * 1024 * 1024;
const RECORD_ALLOWANCE: usize = 128 * 1024;
const LOOKUP_TEXT_LIMIT: usize = 16 * 1024;

struct CatalogIdentity;
pub(crate) struct CatalogProof<'p, 'b> {
    identity: Arc<CatalogIdentity>,
    slot: usize,
    original: ArchivedQueuedUploadOriginalProof<'p, 'b>,
}
struct Record<'p, 'b, 'w> {
    owner: ArchivedQueuedUploadOriginalOwner<'p, 'b>,
    media: ArchivedQueuedUploadMediaRecovery<'p, 'b, 'w>,
    // Borrow decoder DATA for deterministic lookup; it supplies no authority.
    registration: &'p QueueRegistration,
    receipt: ReceiptKey,
    request_id: String,
    intent_digest: String,
}
pub(crate) struct Catalog<'p, 'b, 'w> {
    identity: Arc<CatalogIdentity>,
    records: Vec<Record<'p, 'b, 'w>>,
    budget: &'w WorkBudget,
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Archived upload catalog validation unavailable",
    )
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
impl<'p, 'b, 'w> Catalog<'p, 'b, 'w> {
    fn record(&self, proof: &CatalogProof<'p, 'b>) -> storage::Result<&Record<'p, 'b, 'w>> {
        check(self.budget)?;
        if !Arc::ptr_eq(&self.identity, &proof.identity) {
            return Err(unavailable());
        }
        self.records.get(proof.slot).ok_or_else(unavailable)
    }
}
impl<'p, 'b> OriginalEnqueueOwner for Catalog<'p, 'b, '_> {
    type Proof = CatalogProof<'p, 'b>;
    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> storage::Result<OriginalEnqueue<Self::Proof>> {
        check(self.budget)?;
        // Unique complete registration/actor receipt key plus immutable original
        // lookup labels selects one owner. That owner checks the full bounded
        // semantic original; no trial calls or swallowed owner errors occur.
        let mut matches = self.records.iter().enumerate().filter(|(_, record)| {
            record.registration == registration
                && &record.receipt == receipt
                && record.request_id == original.request_id()
                && record.intent_digest == original.intent_digest()
        });
        let (slot, record) = matches.next().ok_or_else(unavailable)?;
        if matches.next().is_some() {
            return Err(unavailable());
        }
        let retained = record
            .owner
            .retained_enqueue(registration, receipt, original)?;
        Ok(OriginalEnqueue {
            physical_identity: retained.physical_identity,
            original: retained.original,
            expected: retained.expected,
            proof: CatalogProof {
                identity: Arc::clone(&self.identity),
                slot,
                original: retained.proof,
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
    ) -> storage::Result<LeasedJob> {
        self.record(proof)?.owner.retained_attempt(
            registration,
            &proof.original,
            job_id,
            fence,
            attempt,
        )
    }
}
fn enqueue<'a, 'p, 'b>(
    frame: &'a RetainedEnqueue<'_, CatalogProof<'p, 'b>>,
) -> RetainedEnqueue<'a, ArchivedQueuedUploadOriginalProof<'p, 'b>> {
    RetainedEnqueue {
        config: frame.config,
        original: frame.original,
        request: frame.request,
        scope: frame.scope,
        original_proof: &frame.original_proof.original,
    }
}
fn attempt<'a, 'p, 'b>(
    frame: &'a RetainedAttempt<'_, CatalogProof<'p, 'b>>,
) -> RetainedAttempt<'a, ArchivedQueuedUploadOriginalProof<'p, 'b>> {
    RetainedAttempt {
        enqueue: enqueue(&frame.enqueue),
        job: frame.job,
        prepared: frame.prepared,
        journal: frame.journal,
        steps: frame.steps,
        liabilities: frame.liabilities,
        outcomes: frame.outcomes,
    }
}
impl<'p, 'b> QueuedMediaRecovery<CatalogProof<'p, 'b>> for Catalog<'p, 'b, '_> {
    fn validate_original(
        &self,
        frame: &RetainedEnqueue<'_, CatalogProof<'p, 'b>>,
    ) -> storage::Result<()> {
        self.record(frame.original_proof)?
            .media
            .validate_original(&enqueue(frame))
    }
    fn validate_attempt(
        &self,
        frame: &RetainedAttempt<'_, CatalogProof<'p, 'b>>,
    ) -> storage::Result<()> {
        self.record(frame.enqueue.original_proof)?
            .media
            .validate_attempt(&attempt(frame))
    }
    fn validate_outcome(
        &self,
        frame: &RetainedOutcome<'_, '_, CatalogProof<'p, 'b>>,
    ) -> storage::Result<()> {
        let record = self.record(frame.enqueue.original_proof)?;
        let original = enqueue(frame.enqueue);
        QueuedMediaRecovery::validate_outcome(
            &record.media,
            &RetainedOutcome {
                enqueue: &original,
                job: frame.job,
                prepared: frame.prepared,
                journal: frame.journal,
                index: frame.index,
                outcome: frame.outcome,
                previous: frame.previous,
                added_steps: frame.added_steps,
            },
        )
    }
}
impl<'p, 'b> NativeRetainedEvidence<CatalogProof<'p, 'b>> for Catalog<'p, 'b, '_> {
    fn native_codec(&self) -> &str {
        NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
    }
    fn step_codec(&self, _: &storage::StepKind) -> Option<&str> {
        None
    }
    fn validate_prepared(
        &self,
        frame: &RetainedAttempt<'_, CatalogProof<'p, 'b>>,
    ) -> storage::Result<()> {
        self.record(frame.enqueue.original_proof)?
            .media
            .validate_prepared(&attempt(frame))
    }
    fn validate_step(
        &self,
        frame: &RetainedAttempt<'_, CatalogProof<'p, 'b>>,
        index: usize,
        step: &storage::QueueStepEvidence,
    ) -> storage::Result<()> {
        self.record(frame.enqueue.original_proof)?
            .media
            .validate_step(&attempt(frame), index, step)
    }
    fn validate_outcome(
        &self,
        frame: &RetainedOutcome<'_, '_, CatalogProof<'p, 'b>>,
    ) -> storage::Result<()> {
        let record = self.record(frame.enqueue.original_proof)?;
        let original = enqueue(frame.enqueue);
        NativeRetainedEvidence::validate_outcome(
            &record.media,
            &RetainedOutcome {
                enqueue: &original,
                job: frame.job,
                prepared: frame.prepared,
                journal: frame.journal,
                index: frame.index,
                outcome: frame.outcome,
                previous: frame.previous,
                added_steps: frame.added_steps,
            },
        )
    }
}

pub(crate) type CatalogDiscovery<'a, 'p, 'b, 'w> = NativeQueueDiscovery<
    'a,
    NativeStockContract,
    OfflineRecoveryAuthority,
    Catalog<'p, 'b, 'w>,
    Catalog<'p, 'b, 'w>,
>;
pub(crate) type CatalogEvidence<'a, 'peer, 'p, 'b, 'w> = NativeQueueRecoveryEvidence<
    'a,
    'peer,
    NativeStockContract,
    OfflineRecoveryAuthority,
    Catalog<'p, 'b, 'w>,
    Catalog<'p, 'b, 'w>,
    Catalog<'p, 'b, 'w>,
>;

/// Compose only genuine archived peers for the complete supplied authenticated
/// frame group. The caller supplies the independently trusted full registry and
/// authority/grant; neither catalog DATA nor recovered actor IDs issues them.
/// The callback borrows operation-scoped peers and cannot retain their owners.
pub(crate) fn with_authenticated_catalog_peers<R>(
    frames: &[AuthenticatedQueuedUploadOriginalFrame<'_>],
    registry: &[QueueConfig],
    authority: &OfflineRecoveryAuthority,
    grant: &RecoveryDiscoveryGrant,
    budget: &WorkBudget,
    operation: impl FnOnce(
        &RecoveryPeers<'_, CatalogDiscovery<'_, '_, '_, '_>, CatalogEvidence<'_, '_, '_, '_, '_>>,
    ) -> storage::Result<R>,
) -> storage::Result<R> {
    check(budget)?;
    if registry.len() > MAX_CATALOG_QUEUES || frames.len() > MAX_CATALOG_MEMBERS {
        return Err(unavailable());
    }
    for queue in registry {
        check(budget)?;
        authority.revalidate(grant, registry, &queue.registration)?;
    }
    for frame in frames {
        check(budget)?;
        if !std::ptr::eq(frame.registry(), registry)
            || frame.generation() == 0
            || frames.first().is_some_and(|first| {
                first.generation() != frame.generation()
                    || first.catalog_digest() != frame.catalog_digest()
            })
        {
            return Err(unavailable());
        }
    }
    let contracts = NativeStockContract::new().map_err(|_| unavailable())?;
    let mut catalog = Catalog {
        identity: Arc::new(CatalogIdentity),
        records: Vec::new(),
        budget,
    };
    catalog
        .records
        .try_reserve_exact(frames.len())
        .map_err(|_| unavailable())?;
    let mut retained = FIXED_ALLOWANCE;
    for (slot, frame) in frames.iter().enumerate() {
        check(budget)?;
        reserve_transient(retained)?;
        if frames[..slot].iter().any(|previous| {
            previous.queue_index() == frame.queue_index() && previous.job_id() == frame.job_id()
        }) {
            return Err(unavailable());
        }
        let storage =
            ArchivedQueuedUploadOriginalFacts::decode_authenticated(frame, &contracts, budget)?;
        if catalog.records.iter().any(|previous| {
            previous.registration == &storage.config().registration
                && previous.receipt == storage.request().receipt
        }) {
            return Err(unavailable());
        }
        let source =
            ArchivedQueuedUploadSourceFacts::decode_authenticated(frame, &storage, budget)?;
        let media =
            ArchivedQueuedUploadMediaFacts::decode_authenticated(frame, &storage, &source, budget)?;
        let admitted = AdmittedQueuedUploadOriginalCatalogEntry::admit(
            frame, &storage, &source, &media, budget,
        )?;
        // Successful monotonic leaf charges include every retained deep copy.
        // Source DATA dies after this admission, so its entire transient ceiling
        // is reserved above but never accumulated as retained catalog memory.
        retained = retained
            .checked_add(storage.decoded_allocation_charge())
            .and_then(|n| n.checked_add(media.decoded_allocation_charge()))
            .and_then(|n| n.checked_add(RECORD_ALLOWANCE))
            .filter(|n| *n <= CATALOG_DECODE_ALLOWANCE)
            .ok_or_else(unavailable)?;
        let registration = &frame
            .registry()
            .get(frame.queue_index())
            .ok_or_else(unavailable)?
            .registration;
        let receipt = &storage.request().receipt;
        if [
            &receipt.workspace_id,
            &receipt.home_id,
            &receipt.actor_id,
            &receipt.mutation_id,
        ]
        .iter()
        .any(|value| value.len() > LOOKUP_TEXT_LIMIT)
            || storage.original().request_id().len() > LOOKUP_TEXT_LIMIT
            || storage.original().intent_digest().len() != 64
        {
            return Err(unavailable());
        }
        let receipt = storage.request().receipt.clone();
        let request_id = storage.original().request_id().to_owned();
        let intent_digest = storage.original().intent_digest().to_owned();
        let owner = ArchivedQueuedUploadOriginalOwner::from_admitted(&admitted, storage, budget)?;
        let media = ArchivedQueuedUploadMediaRecovery::from_admitted(&admitted, media, budget)?;
        catalog.records.push(Record {
            owner,
            media,
            registration,
            receipt,
            request_id,
            intent_digest,
        });
    }
    check(budget)?;
    // The same bounded working allowance covers callback owner delegation and
    // validation clones. It remains available even after the final frame.
    reserve_transient(retained)?;
    let discovery = NativeQueueDiscovery::new(
        registry,
        QueueRecoveryBindings {
            stock_contract_id: crate::contracts::stock::CONTRACT_VERSION,
            contracts: &contracts,
            authority,
            grant,
            original_owner: &catalog,
            media: &catalog,
        },
    )?;
    let evidence = NativeQueueRecoveryEvidence::new(&discovery, &catalog);
    let peers = RecoveryPeers::new(registry, &discovery, &evidence).map_err(|_| unavailable())?;
    let result = operation(&peers)?;
    for queue in registry {
        check(budget)?;
        authority.revalidate(grant, registry, &queue.registration)?;
    }
    check(budget)?;
    Ok(result)
}
fn reserve_transient(retained: usize) -> storage::Result<()> {
    retained
        .checked_add(FRAME_DECODE_ALLOWANCE)
        .filter(|n| *n <= CATALOG_DECODE_ALLOWANCE)
        .map(|_| ())
        .ok_or_else(unavailable)
}

pub fn validate_catalog_image(
    intake: &PreparedQueuedUploadHistoryIntake<'_, '_, '_>,
    budget: &WorkBudget,
) -> storage::Result<ValidatedQueuedUploadHistoryImage> {
    check(budget)?;
    let members = intake.origin().catalog().members();
    if intake.registry().len() > MAX_CATALOG_QUEUES
        || members.len() > MAX_CATALOG_MEMBERS
        || members.len() != intake.archive().members().len()
    {
        return Err(unavailable());
    }
    // Complete immutable permit storage precedes every decoder borrow. No Vec
    // growth, permit move or subset selection occurs after these borrows begin.
    let mut frames = Vec::new();
    frames
        .try_reserve_exact(members.len())
        .map_err(|_| unavailable())?;
    for slot in 0..members.len() {
        frames.push(intake.frame(slot, budget)?);
    }
    with_authenticated_catalog_peers(
        &frames,
        intake.registry(),
        intake.authority(),
        intake.grant(),
        budget,
        |peers| upload_history_validation::validate_selected_image(intake.image(), peers, budget),
    )
}
