//! Archived prepared-only Media semantics under independently authenticated
//! producer/admin/image/registry input. Authentication is not semantic admission:
//! only Root's complete three-decoder join can enable the recovery adapter.
//! No live issuer, grant, stage, descriptor, body availability or remote end is
//! reconstructed. All comparisons are pure; this leaf performs no I/O.
use super::{WorkBudget, native_queued_upload::NATIVE_QUEUED_UPLOAD_PREPARED_CODEC, types::sha256};
use crate::{
    access as a,
    app::{
        homebox_queued_upload_history_catalog_admission::{
            AdmittedQueuedUploadOriginalCatalogEntry, AdmittedQueuedUploadOriginalCatalogIdentity,
        },
        homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame,
    },
    domain::{
        queue_recovery::{
            NativeRetainedEvidence, QueuedMediaRecovery, RetainedAttempt, RetainedEnqueue,
            RetainedOutcome,
        },
        stock,
    },
    jobs,
    lifecycle::recovery::upload_history_intake::AuthenticatedQueuedUploadOriginalFrame,
    providers::homebox::{read, write::stock as native},
    storage as s,
};
use serde::Serialize;
use std::{io::Write, sync::Arc};

const MAX_FACT_SECTION: usize = 16 * 1024 * 1024;
const MAX_OWNED_BYTES: usize = 64 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_OWNER_BYTES: usize = 10 * 1024 * 1024;
const MAX_RESERVATION_BYTES: usize = 32 * 1024;
const MAX_ALIASES: usize = 64;
const MEDIA_FORMAT: &str = "houseatlas-homebox-upload-queued-media/1";
const RESERVATION_FORMAT: &str = "houseatlas-homebox-upload-reservation/1";

fn unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Authenticated archived upload Media facts unavailable",
    )
}
fn check(budget: &WorkBudget) -> s::Result<()> {
    budget.check().map_err(|_| unavailable())
}

/// A pure decoder marker, issued only after every semantic check succeeds.
/// A matching marker is allocation correlation; it cannot admit archive facts.
pub(crate) struct ArchivedQueuedUploadMediaFactsIdentity {
    _private: (),
}

pub struct ArchivedQueuedUploadMediaImpact {
    partition: jobs::SourcePartition,
    entity_id: String,
    staged: native::StagedUpload,
    snapshot_digest: native::Digest,
}
impl ArchivedQueuedUploadMediaImpact {
    pub fn partition(&self) -> &jobs::SourcePartition {
        &self.partition
    }
    pub fn entity_id(&self) -> &str {
        &self.entity_id
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.staged
    }
    pub fn snapshot_digest(&self) -> &native::Digest {
        &self.snapshot_digest
    }
}

/// Bounded comparison DATA. No Clone/serde/public DATA constructor or live
/// custody. Raw sections borrow the SAME genuine authenticated input permit.
pub struct ArchivedQueuedUploadMediaFacts<'permit, 'bytes> {
    frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
    identity: Arc<ArchivedQueuedUploadMediaFactsIdentity>,
    storage_identity: Arc<s::ArchivedQueuedUploadOriginalFactsIdentity>,
    source_identity: Arc<native::ArchivedQueuedUploadSourceFactsIdentity>,
    original: stock::ValidatedRequest,
    command: native::StockCommand,
    authority: native::StockAuthority,
    plan: native::NativePlan,
    preflight: native::StockPreflight,
    owner_preflight: native::StockPreflight,
    capture_digest: native::Digest,
    source: a::SourceRef,
    scope: read::SourceScope,
    target: native::StockTarget,
    path: String,
    query: Vec<(String, String)>,
    observed_at: String,
    snapshot_digest: native::Digest,
    raw_owner: &'bytes [u8],
    reservation: &'bytes [u8],
    ordered_impact: [ArchivedQueuedUploadMediaImpact; 1],
    config: jobs::QueueConfig,
    request: jobs::EnqueueRequest,
    canonical_scope: jobs::CanonicalScope,
    prepared: s::PreparedNativeIntent,
    staged: native::StagedUpload,
}
impl<'permit, 'bytes> ArchivedQueuedUploadMediaFacts<'permit, 'bytes> {
    pub fn decode_authenticated(
        frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
        storage: &s::ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>,
        source: &native::ArchivedQueuedUploadSourceFacts<'permit, 'bytes>,
        budget: &WorkBudget,
    ) -> s::Result<Self> {
        check(budget)?;
        // Actual permits/peer decoder provenance precede all candidate fields.
        if !storage.matches_authenticated(frame)
            || !source.matches_authenticated(frame)
            || !source.matches_storage_facts(storage)
        {
            return Err(unavailable());
        }
        let framing = UnadmittedQueuedUploadOriginalFrame::parse(frame.original_bytes(), budget)?;
        let media = section(&framing, "media", budget)?;
        let raw_owner = section(&framing, "media-owner-raw", budget)?;
        let reservation = section(&framing, "reservation", budget)?;
        let native_payload = section(&framing, "native-payload", budget)?;
        let prepared_media = section(&framing, "prepared-media", budget)?;
        if media.len() > MAX_FACT_SECTION
            || raw_owner.len() > MAX_OWNER_BYTES
            || reservation.len() > MAX_RESERVATION_BYTES
            || native_payload.len() > MAX_JSON_BYTES
            || prepared_media.len() > MAX_JSON_BYTES
        {
            return Err(unavailable());
        }
        // Conservative charged clone bound: every owned string/container/JSON
        // fact is represented in the exact section, with room for typed object
        // overhead and duplicate transient/returned copies. Raw owner/reservation
        // sections remain borrowed. Apply this BEFORE any deep copy below.
        let charged = media
            .len()
            .checked_mul(64)
            .and_then(|v| v.checked_add(native_payload.len()))
            .and_then(|v| v.checked_add(prepared_media.len()))
            .and_then(|v| v.checked_add(4096))
            .ok_or_else(unavailable)?;
        if charged > MAX_OWNED_BYTES {
            return Err(unavailable());
        }
        let original = storage.original();
        let snapshot = source.snapshot();
        let native::NativeBody::Multipart { stage, .. } = &source.plan().request.body else {
            return Err(unavailable());
        };
        let owner_id = source.source_reference().key.external_id.as_str();
        let reserved = stage.byte_size;
        let liability = original_liability(reserved);
        if reserved == 0
            || reserved > MAX_OWNER_BYTES as u64
            || !same_request(original, source.original())
            || original.raw() != &source.command().original_wire
            || original.id() != stock::OperationId::HomeboxFileUpload
            || source.command().command_id != "homebox.file.upload"
            || source.command().approval_receipt_id.is_some()
            || source.preflight().preparation.snapshots.len() != 1
            || source.owner_preflight().preparation.snapshots.len() != 1
            || !source
                .preflight()
                .preparation
                .native_clear_values
                .is_empty()
            || !source
                .owner_preflight()
                .preparation
                .native_clear_values
                .is_empty()
            || source.preflight().preparation.staged_upload.as_ref() != Some(stage)
            || source.owner_preflight().preparation.staged_upload.as_ref() != Some(stage)
            || raw_owner != snapshot.original()
            || raw_owner.is_empty()
            || reservation.is_empty()
            || storage.config().registration.aliases.len() > MAX_ALIASES
            || frame.registry().get(frame.queue_index()) != Some(storage.config())
            || frame.job_id() != storage.initial_claim().lease.job_id.0
            || storage.request().pending_byte_liability
                != (jobs::PendingByteLiability {
                    required: true,
                    reserved_bytes: Some(reserved),
                })
            || storage.initial_claim().pending_byte_liability
                != storage.request().pending_byte_liability
            || storage.prepared().storage_liability != liability
            || storage.prepared().codec != NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
            || storage.prepared().native_payload.as_slice() != native_payload
            || storage.prepared().prepared_media_evidence.as_slice() != prepared_media
            || source.observed_actor() != storage.request().receipt.actor_id
            || source.partition().workspace_id.as_str() != storage.request().partition.workspace_id
            || source.partition().home_id.as_str() != storage.request().partition.home_id
            || source.partition().source_instance_id.as_str()
                != storage.request().partition.source_instance_id
            || source.partition().collection_id.as_str()
                != storage.request().partition.collection_id
        {
            return Err(unavailable());
        }
        // Reproduce the original deterministic encoders against the borrowed
        // candidate sections. JSON streams are exact: no duplicate/unknown key,
        // alternate spelling or parser-normalized DATA can pass this check.
        let mut comparison = Comparison::new(media, budget);
        expected_media(storage, source, stage, owner_id, &mut comparison)?;
        comparison.finish()?;
        let payload = PreparedPayload {
            format: NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
            native_source_commit: native::NATIVE_SOURCE_COMMIT,
            contract_version: native::CONTRACT_VERSION,
            original_wire: &source.command().original_wire,
            plan: source.plan(),
        };
        compare_json(native_payload, &payload, budget)?;
        let impact = PreparedImpact {
            partition: PreparedPartition::new(&storage.request().partition),
            entity_id: owner_id,
            staged: stage,
            snapshot_digest: snapshot.digest(),
        };
        let evidence = PreparedMedia {
            format: MEDIA_FORMAT,
            staged: stage,
            source: source.source_reference(),
            capture_digest: source.capture_digest(),
            snapshot_scope: snapshot.scope(),
            snapshot_target: snapshot.target(),
            snapshot_path: snapshot.path(),
            snapshot_query: snapshot.query(),
            snapshot_observed_at: snapshot.observed_at(),
            snapshot_digest: snapshot.digest(),
            ordered_impact: [impact],
        };
        compare_json(prepared_media, &evidence, budget)?;
        compare_json(
            reservation,
            &Reservation {
                format: RESERVATION_FORMAT,
                actor_id: source.observed_actor(),
                source: source.source_reference(),
                staged: stage,
            },
            budget,
        )?;
        if storage.journal_receipt().native_payload_digest.as_hex() != sha256(native_payload) {
            return Err(unavailable());
        }
        check(budget)?;
        // Semantic producers and all exact encoding/length checks have now
        // succeeded. These clones do not capture Source/Storage/live owners.
        let facts = Self {
            frame,
            identity: Arc::new(ArchivedQueuedUploadMediaFactsIdentity { _private: () }),
            storage_identity: Arc::clone(storage.identity()),
            source_identity: Arc::clone(source.identity()),
            original: original.clone(),
            command: source.command().clone(),
            authority: source.authority().clone(),
            plan: source.plan().clone(),
            preflight: source.preflight().clone(),
            owner_preflight: source.owner_preflight().clone(),
            capture_digest: source.capture_digest().clone(),
            source: source.source_reference().clone(),
            scope: snapshot.scope().clone(),
            target: snapshot.target().clone(),
            path: snapshot.path().to_owned(),
            query: snapshot.query().to_vec(),
            observed_at: snapshot.observed_at().to_owned(),
            snapshot_digest: snapshot.digest().clone(),
            raw_owner,
            reservation,
            ordered_impact: [ArchivedQueuedUploadMediaImpact {
                partition: storage.request().partition.clone(),
                entity_id: owner_id.to_owned(),
                staged: stage.clone(),
                snapshot_digest: snapshot.digest().clone(),
            }],
            config: storage.config().clone(),
            request: storage.request().clone(),
            canonical_scope: storage.scope().clone(),
            prepared: storage.prepared().clone(),
            staged: stage.clone(),
        };
        check(budget)?;
        Ok(facts)
    }
    pub fn matches_authenticated(
        &self,
        frame: &AuthenticatedQueuedUploadOriginalFrame<'_>,
    ) -> bool {
        std::ptr::eq(self.frame, frame)
    }
    pub fn matches_storage_facts(
        &self,
        facts: &s::ArchivedQueuedUploadOriginalFacts<'_, '_>,
    ) -> bool {
        facts.matches_authenticated(self.frame)
            && Arc::ptr_eq(&self.storage_identity, facts.identity())
    }
    pub fn matches_source_facts(
        &self,
        facts: &native::ArchivedQueuedUploadSourceFacts<'_, '_>,
    ) -> bool {
        facts.matches_authenticated(self.frame)
            && Arc::ptr_eq(&self.source_identity, facts.identity())
    }
    pub(crate) fn frame(&self) -> &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes> {
        self.frame
    }
    pub(crate) fn identity(&self) -> &Arc<ArchivedQueuedUploadMediaFactsIdentity> {
        &self.identity
    }
    pub fn original(&self) -> &stock::ValidatedRequest {
        &self.original
    }
    pub fn command(&self) -> &native::StockCommand {
        &self.command
    }
    pub fn authority(&self) -> &native::StockAuthority {
        &self.authority
    }
    pub fn plan(&self) -> &native::NativePlan {
        &self.plan
    }
    pub fn preflight(&self) -> &native::StockPreflight {
        &self.preflight
    }
    pub fn owner_preflight(&self) -> &native::StockPreflight {
        &self.owner_preflight
    }
    pub fn capture_digest(&self) -> &native::Digest {
        &self.capture_digest
    }
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.source
    }
    pub fn owner_original_bytes(&self) -> &[u8] {
        self.raw_owner
    }
    pub fn owner_scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn owner_target(&self) -> &native::StockTarget {
        &self.target
    }
    pub fn owner_path(&self) -> &str {
        &self.path
    }
    pub fn owner_query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn owner_observed_at(&self) -> &str {
        &self.observed_at
    }
    pub fn owner_digest(&self) -> &native::Digest {
        &self.snapshot_digest
    }
    pub fn ordered_impact(&self) -> &[ArchivedQueuedUploadMediaImpact] {
        &self.ordered_impact
    }
    pub fn queue_config(&self) -> &jobs::QueueConfig {
        &self.config
    }
    pub fn enqueue_request(&self) -> &jobs::EnqueueRequest {
        &self.request
    }
    pub fn canonical_scope(&self) -> &jobs::CanonicalScope {
        &self.canonical_scope
    }
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.prepared
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.staged
    }
    pub fn measured_byte_size(&self) -> u64 {
        self.staged.byte_size
    }
    pub fn pending_byte_liability(&self) -> jobs::PendingByteLiability {
        self.request.pending_byte_liability
    }
    pub fn reservation_bytes(&self) -> &[u8] {
        self.reservation
    }
}
fn section<'b>(
    frame: &UnadmittedQueuedUploadOriginalFrame<'b>,
    name: &str,
    budget: &WorkBudget,
) -> s::Result<&'b [u8]> {
    frame.section(name, budget)?.ok_or_else(unavailable)
}
fn same_request(a: &stock::ValidatedRequest, b: &stock::ValidatedRequest) -> bool {
    a.raw() == b.raw()
        && a.id() == b.id()
        && a.context() == b.context()
        && a.request_id() == b.request_id()
        && a.intent_digest() == b.intent_digest()
        && a.route() == b.route()
        && a.children().is_empty()
        && b.children().is_empty()
}
fn original_liability(reserved: u64) -> jobs::StorageLiability {
    jobs::StorageLiability {
        accounting: jobs::ByteAccounting::Complete {
            known_bytes: 0,
            reserved_bytes: reserved,
        },
        metadata_commit_evidence: jobs::MetadataCommitEvidence::NotDispatched,
        byte_disposition: jobs::ByteDisposition::None,
        reference_closure_evidence: jobs::ReferenceClosureEvidence::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 1,
    }
}

/// Enabled only after Root's complete semantic admission. It retains a pure
/// final-entry identity and DATA, not the entry or any live owner/descriptor.
pub struct ArchivedQueuedUploadMediaRecovery<'permit, 'bytes, 'budget> {
    admitted: Arc<AdmittedQueuedUploadOriginalCatalogIdentity>,
    facts: ArchivedQueuedUploadMediaFacts<'permit, 'bytes>,
    budget: &'budget WorkBudget,
}
impl<'permit, 'bytes, 'budget> ArchivedQueuedUploadMediaRecovery<'permit, 'bytes, 'budget> {
    pub fn from_admitted(
        entry: &AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes>,
        facts: ArchivedQueuedUploadMediaFacts<'permit, 'bytes>,
        budget: &'budget WorkBudget,
    ) -> s::Result<Self> {
        check(budget)?;
        if !entry.matches_media_facts(&facts) {
            return Err(unavailable());
        }
        let admitted = Arc::clone(entry.identity());
        check(budget)?;
        Ok(Self {
            admitted,
            facts,
            budget,
        })
    }
    fn validate_enqueue(
        &self,
        enqueue: &RetainedEnqueue<'_, s::ArchivedQueuedUploadOriginalProof<'permit, 'bytes>>,
    ) -> s::Result<()> {
        check(self.budget)?;
        let proof = enqueue.original_proof;
        // The actual admitted entry identity AND permit precede all retained DATA.
        if !Arc::ptr_eq(&self.admitted, proof.admitted_identity())
            || !proof.matches_authenticated(self.facts.frame())
        {
            return Err(unavailable());
        }
        let storage = proof.facts();
        if !self.facts.matches_storage_facts(storage)
            || !storage.matches_authenticated(self.facts.frame())
            || enqueue.config != self.facts.queue_config()
            || !same_request(enqueue.original, self.facts.original())
            || enqueue.request != self.facts.enqueue_request()
            || enqueue.scope != self.facts.canonical_scope()
            || storage.config() != enqueue.config
            || storage.request() != enqueue.request
            || storage.scope() != enqueue.scope
            || !same_request(storage.original(), enqueue.original)
            || storage.prepared() != self.facts.prepared()
        {
            return Err(unavailable());
        }
        check(self.budget)
    }
    fn validate_frame(
        &self,
        frame: &RetainedAttempt<'_, s::ArchivedQueuedUploadOriginalProof<'permit, 'bytes>>,
    ) -> s::Result<()> {
        self.validate_enqueue(&frame.enqueue)?;
        let storage = frame.enqueue.original_proof.facts();
        let (Some(prepared), Some(journal)) = (frame.prepared, frame.journal) else {
            return Err(unavailable());
        };
        let liability = &self.facts.prepared.storage_liability;
        if frame.job != storage.initial_claim()
            || prepared != self.facts.prepared()
            || journal.native_codec != NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
            || journal.native_payload_digest != storage.journal_receipt().native_payload_digest
            || journal.journal_evidence_digest != storage.journal_receipt().journal_evidence_digest
            || journal.native_payload_digest.as_hex() != sha256(&prepared.native_payload)
            || journal.prepared_media_digest.as_hex() != sha256(&prepared.prepared_media_evidence)
            || journal.prepared_liability != *liability
            || frame.job.pending_byte_liability != self.facts.pending_byte_liability()
            || frame.liabilities.len() != 2
            || frame.liabilities[0].0 != "claim"
            || frame.liabilities[1].0 != "journal"
            || frame.liabilities[0].1 != *liability
            || frame.liabilities[1].1 != *liability
            || !frame.steps.is_empty()
            || !frame.outcomes.is_empty()
        {
            return Err(unavailable());
        }
        check(self.budget)
    }
    fn unsupported(&self) -> s::Result<()> {
        check(self.budget)?;
        Err(unavailable())
    }
}
impl<'p, 'b> QueuedMediaRecovery<s::ArchivedQueuedUploadOriginalProof<'p, 'b>>
    for ArchivedQueuedUploadMediaRecovery<'p, 'b, '_>
{
    fn validate_original(
        &self,
        frame: &RetainedEnqueue<'_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
    ) -> s::Result<()> {
        self.validate_enqueue(frame)
    }
    fn validate_attempt(
        &self,
        frame: &RetainedAttempt<'_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
    ) -> s::Result<()> {
        self.validate_frame(frame)
    }
    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
    ) -> s::Result<()> {
        self.unsupported()
    }
}
impl<'p, 'b> NativeRetainedEvidence<s::ArchivedQueuedUploadOriginalProof<'p, 'b>>
    for ArchivedQueuedUploadMediaRecovery<'p, 'b, '_>
{
    fn native_codec(&self) -> &str {
        NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
    }
    fn step_codec(&self, _: &s::StepKind) -> Option<&str> {
        None
    }
    fn validate_prepared(
        &self,
        frame: &RetainedAttempt<'_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
    ) -> s::Result<()> {
        self.validate_frame(frame)
    }
    fn validate_step(
        &self,
        _: &RetainedAttempt<'_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
        _: usize,
        _: &s::QueueStepEvidence,
    ) -> s::Result<()> {
        self.unsupported()
    }
    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, s::ArchivedQueuedUploadOriginalProof<'p, 'b>>,
    ) -> s::Result<()> {
        self.unsupported()
    }
}

// Exact reproduction of the original Root ordered field encoder against
// independently decoded expected facts. This allocates no candidate JSON or
// encoder Vec. Scalar tags/counts/lengths and every byte must match.
struct Comparison<'a> {
    rest: &'a [u8],
    budget: &'a WorkBudget,
}
impl<'a> Comparison<'a> {
    fn new(rest: &'a [u8], budget: &'a WorkBudget) -> Self {
        Self { rest, budget }
    }
    fn put(&mut self, bytes: &[u8]) -> s::Result<()> {
        check(self.budget)?;
        if self.rest.get(..bytes.len()) != Some(bytes) {
            return Err(unavailable());
        }
        self.rest = self.rest.get(bytes.len()..).ok_or_else(unavailable)?;
        check(self.budget)
    }
    fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> s::Result<()> {
        let mut count = Count {
            bytes: 0,
            budget: self.budget,
        };
        serde_json::to_writer(&mut count, value).map_err(|_| unavailable())?;
        count.bytes.encode(self)?;
        serde_json::to_writer(&mut *self, value).map_err(|_| unavailable())?;
        check(self.budget)
    }
    fn finish(self) -> s::Result<()> {
        check(self.budget)?;
        if self.rest.is_empty() {
            Ok(())
        } else {
            Err(unavailable())
        }
    }
}
impl Write for Comparison<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.put(bytes).map_err(std::io::Error::other)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        check(self.budget).map_err(std::io::Error::other)
    }
}
struct Count<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl Write for Count<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        check(self.budget).map_err(std::io::Error::other)?;
        self.bytes = self
            .bytes
            .checked_add(bytes.len())
            .filter(|v| *v <= MAX_JSON_BYTES)
            .ok_or_else(|| std::io::Error::other("bounded JSON unavailable"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        check(self.budget).map_err(std::io::Error::other)
    }
}
fn compare_json<T: Serialize + ?Sized>(
    bytes: &[u8],
    value: &T,
    budget: &WorkBudget,
) -> s::Result<()> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err(unavailable());
    }
    let mut out = Comparison::new(bytes, budget);
    serde_json::to_writer(&mut out, value).map_err(|_| unavailable())?;
    out.finish()
}
trait Encode {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()>;
}
impl Encode for str {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.len().encode(out)?;
        out.put(self.as_bytes())
    }
}
impl Encode for String {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.as_str().encode(out)
    }
}
macro_rules! scalar { ($($t:ty),+) => { $(impl Encode for $t { fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> { out.put(&self.to_be_bytes()) } })+ }; }
scalar!(u64, u32, u16, i64);
impl Encode for usize {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        u64::try_from(*self).map_err(|_| unavailable())?.encode(out)
    }
}
impl Encode for bool {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        out.put(&[u8::from(*self)])
    }
}
impl<T: Encode> Encode for Option<T> {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.is_some().encode(out)?;
        if let Some(v) = self {
            v.encode(out)?;
        }
        Ok(())
    }
}
impl<T: Encode> Encode for [T] {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.len().encode(out)?;
        for v in self {
            check(out.budget)?;
            v.encode(out)?;
        }
        Ok(())
    }
}
impl<T: Encode> Encode for Vec<T> {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.as_slice().encode(out)
    }
}
impl<A: Encode, B: Encode> Encode for (A, B) {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.0.encode(out)?;
        self.1.encode(out)
    }
}
impl Encode for jobs::Digest {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.as_hex().encode(out)
    }
}
impl Encode for native::Digest {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        self.as_str().encode(out)
    }
}
macro_rules! fields { ($ty:ty, $($field:ident),+ $(,)?) => { impl Encode for $ty { fn encode(&self,out:&mut Comparison<'_>)->s::Result<()> { $(self.$field.encode(out)?;)+ Ok(()) } } }; }
macro_rules! variants { ($ty:ty, $($v:ident => $name:literal),+ $(,)?) => { impl Encode for $ty { fn encode(&self,out:&mut Comparison<'_>)->s::Result<()> { match self { $(Self::$v=>$name.encode(out)),+ } } } }; }
fields!(
    jobs::SourcePartition,
    workspace_id,
    home_id,
    source_instance_id,
    collection_id
);
fields!(
    jobs::ReceiptKey,
    workspace_id,
    home_id,
    actor_id,
    mutation_id
);
fields!(
    jobs::IntentMetadata,
    contract_id,
    operation_id,
    target_external_id,
    request_digest
);
fields!(
    jobs::EnqueueRequest,
    receipt,
    partition,
    intent,
    write_scope,
    pending_byte_liability
);
fields!(
    jobs::PhysicalQueueIdentity,
    deployment_id,
    physical_database_id,
    configuration_digest
);
fields!(jobs::SourceAlias, partition, canonical_collection_id);
fields!(
    jobs::QueueRegistration,
    identity,
    dispatcher_owner_id,
    aliases
);
fields!(
    jobs::RetryPolicy,
    max_attempts,
    initial_delay_ms,
    max_delay_ms
);
fields!(
    jobs::QueueConfig,
    lease_duration_ms,
    retry,
    registration,
    admission_profile
);
fields!(
    jobs::AdmissionProfile,
    profile_version,
    qualification,
    max_waiting_intents,
    max_admission_wait_ms,
    max_unresolved_storage_attempts,
    max_unresolved_storage_bytes
);
fields!(jobs::ResourceRef, kind, id);
fields!(
    jobs::WriteScope,
    source_instance_id,
    collection_id,
    selection
);
fields!(jobs::CanonicalScope, collection_id, selection);
fields!(jobs::PendingByteLiability, required, reserved_bytes);
fields!(
    jobs::StorageLiability,
    accounting,
    metadata_commit_evidence,
    byte_disposition,
    reference_closure_evidence,
    orphan_candidate_id,
    unresolved_attempts
);
variants!(jobs::ResourceKind,Entity=>"entity",Location=>"location",Tag=>"tag",Template=>"template",EntityType=>"entity-type",Field=>"field",File=>"file",Maintenance=>"maintenance");
variants!(jobs::MetadataCommitEvidence,NotDispatched=>"not-dispatched",ObservedNotCommitted=>"observed-not-committed",ObservedCommitted=>"observed-committed",Unknown=>"unknown");
variants!(jobs::ByteDisposition,None=>"none",RetainedUnbound=>"retained-unbound",RetainedBound=>"retained-bound",Unknown=>"unknown");
variants!(jobs::ReferenceClosureEvidence,Unassessed=>"unassessed",Incomplete=>"incomplete",OperatorEvidenced=>"operator-evidenced");
impl Encode for jobs::ScopeSelection {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        match self {
            Self::Collection => "collection".encode(out),
            Self::Resources(v) => {
                "resources".encode(out)?;
                v.encode(out)
            }
        }
    }
}
impl Encode for jobs::ProfileQualification {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        match self {
            Self::OfflineEngineeringFixture => "offline-engineering-fixture".encode(out),
            Self::QualifiedDeployment { evidence_digest } => {
                "qualified-deployment".encode(out)?;
                evidence_digest.encode(out)
            }
        }
    }
}
impl Encode for jobs::ByteAccounting {
    fn encode(&self, out: &mut Comparison<'_>) -> s::Result<()> {
        match self {
            Self::Complete {
                known_bytes,
                reserved_bytes,
            } => {
                "complete".encode(out)?;
                known_bytes.encode(out)?;
                reserved_bytes.encode(out)
            }
            Self::Incomplete { known_bytes } => {
                "incomplete".encode(out)?;
                known_bytes.encode(out)
            }
        }
    }
}

fn original(expected: &stock::ValidatedRequest, out: &mut Comparison<'_>) -> s::Result<()> {
    out.json(expected.raw())?;
    expected.id().as_str().encode(out)?;
    out.json(expected.context())?;
    expected.request_id().encode(out)?;
    expected.intent_digest().encode(out)?;
    let stock::Route::HomeboxNative(route) = expected.route() else {
        return Err(unavailable());
    };
    if !matches!(route.method, stock::Method::Post)
        || route.path != "/api/v1/entities/{id}/attachments"
        || !expected.children().is_empty()
    {
        return Err(unavailable());
    }
    "POST".encode(out)?;
    route.path.encode(out)?;
    0usize.encode(out)
}
fn authority(v: &native::StockAuthority, out: &mut Comparison<'_>) -> s::Result<()> {
    out.json(&v.actor_id)?;
    v.source_epoch.encode(out)?;
    v.authority_digest.encode(out)?;
    out.json(&v.physical_binding.deployment_id)?;
    out.json(&v.physical_binding.physical_database_id)?;
    v.physical_binding.configuration_digest.encode(out)?;
    let native::NativeQualification::Qualified {
        catalog_digest,
        registered_build_digest,
        route_qualification_digest,
    } = &v.qualification
    else {
        return Err(unavailable());
    };
    "qualified".encode(out)?;
    catalog_digest.encode(out)?;
    registered_build_digest.encode(out)?;
    route_qualification_digest.encode(out)
}
fn preflight(v: &native::StockPreflight, out: &mut Comparison<'_>) -> s::Result<()> {
    if v.preparation.snapshots.len() != 1 || !v.preparation.native_clear_values.is_empty() {
        return Err(unavailable());
    }
    v.preparation.snapshots.len().encode(out)?;
    for s in &v.preparation.snapshots {
        out.json(&s.target)?;
        out.json(&s.value)?;
        s.digest.encode(out)?;
        s.complete.encode(out)?;
        s.hidden_fields_preserved.encode(out)?;
    }
    out.json(&v.preparation.staged_upload)?;
    0usize.encode(out)?;
    out.json(&v.provider_observation)?;
    v.request_digest.encode(out)?;
    v.source_epoch.encode(out)?;
    v.preflight_digest.encode(out)
}
fn expected_media(
    storage: &s::ArchivedQueuedUploadOriginalFacts<'_, '_>,
    source: &native::ArchivedQueuedUploadSourceFacts<'_, '_>,
    stage: &native::StagedUpload,
    owner_id: &str,
    out: &mut Comparison<'_>,
) -> s::Result<()> {
    original(storage.original(), out)?;
    out.json(source.command())?;
    authority(source.authority(), out)?;
    out.json(source.plan())?;
    preflight(source.preflight(), out)?;
    preflight(source.owner_preflight(), out)?;
    source.capture_digest().encode(out)?;
    let snapshot = source.snapshot();
    out.json(snapshot.scope())?;
    out.json(snapshot.target())?;
    snapshot.path().encode(out)?;
    snapshot.query().encode(out)?;
    snapshot.observed_at().encode(out)?;
    snapshot.digest().encode(out)?;
    1usize.encode(out)?;
    storage.request().partition.encode(out)?;
    owner_id.encode(out)?;
    out.json(stage)?;
    snapshot.digest().encode(out)?;
    out.json(source.source_reference())?;
    storage.config().encode(out)?;
    storage.request().encode(out)?;
    storage.scope().encode(out)?;
    storage.prepared().codec.encode(out)?;
    storage.prepared().storage_liability.encode(out)?;
    storage.request().pending_byte_liability.encode(out)?;
    out.json(stage)?;
    stage.byte_size.encode(out)
}
#[derive(Serialize)]
struct PreparedPayload<'a> {
    format: &'static str,
    native_source_commit: &'static str,
    contract_version: &'static str,
    original_wire: &'a serde_json::Value,
    plan: &'a native::NativePlan,
}
#[derive(Serialize)]
struct PreparedPartition<'a> {
    workspace_id: &'a str,
    home_id: &'a str,
    source_instance_id: &'a str,
    collection_id: &'a str,
}
impl<'a> PreparedPartition<'a> {
    fn new(p: &'a jobs::SourcePartition) -> Self {
        Self {
            workspace_id: &p.workspace_id,
            home_id: &p.home_id,
            source_instance_id: &p.source_instance_id,
            collection_id: &p.collection_id,
        }
    }
}
#[derive(Serialize)]
struct PreparedImpact<'a> {
    partition: PreparedPartition<'a>,
    entity_id: &'a str,
    staged: &'a native::StagedUpload,
    snapshot_digest: &'a native::Digest,
}
#[derive(Serialize)]
struct PreparedMedia<'a> {
    format: &'static str,
    staged: &'a native::StagedUpload,
    source: &'a a::SourceRef,
    capture_digest: &'a native::Digest,
    snapshot_scope: &'a read::SourceScope,
    snapshot_target: &'a native::StockTarget,
    snapshot_path: &'a str,
    snapshot_query: &'a [(String, String)],
    snapshot_observed_at: &'a str,
    snapshot_digest: &'a native::Digest,
    ordered_impact: [PreparedImpact<'a>; 1],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reservation<'a> {
    format: &'static str,
    actor_id: &'a str,
    source: &'a a::SourceRef,
    staged: &'a native::StagedUpload,
}
