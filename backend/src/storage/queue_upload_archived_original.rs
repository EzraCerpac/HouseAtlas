//! Authenticated archive DATA and the separately admitted original/first claim.
//! No live custody, journal/execution witness, descriptor or authority is rebuilt.
//! Root alone mounts this queue sibling and admits the three semantic owners.
use super::*;
use crate::{
    app::{
        homebox_queued_upload_history_catalog_admission::{
            AdmittedQueuedUploadOriginalCatalogEntry, AdmittedQueuedUploadOriginalCatalogIdentity,
        },
        homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame,
    },
    domain::{
        queue_recovery::{OriginalEnqueue, OriginalEnqueueOwner},
        stock,
    },
    lifecycle::recovery::upload_history_intake::AuthenticatedQueuedUploadOriginalFrame,
    media::WorkBudget,
};
use sha2::{Digest as ShaDigest, Sha256};
use std::mem::size_of;

const FACTS_LIMIT: usize = 16 * 1024 * 1024;
const PREPARED_LIMIT: usize = 1024 * 1024;
const ALLOCATION_LIMIT: usize = 96 * 1024 * 1024;
const TEXT_LIMIT: usize = 16 * 1024;
const ALIAS_LIMIT: usize = 64;
const JSON_DEPTH: usize = 64;
const JSON_MEMBERS: usize = 128;
const JSON_ITEMS: usize = 1000;
const JSON_NODES: usize = 32 * 1024;
const CHUNK: usize = 64 * 1024;

fn unavailable() -> Error {
    Error::new("owner-unavailable", "Archived original upload unavailable")
}
fn check(budget: &WorkBudget) -> Result<()> {
    budget.check().map_err(|_| unavailable())
}

/// Pure allocation identity; only a complete successful decoder can mint it.
pub(crate) struct ArchivedQueuedUploadOriginalFactsIdentity {
    _private: (),
}

/// Bounded semantic DATA. Caller-supplied contracts never issue an owner proof.
pub struct ArchivedQueuedUploadOriginalFacts<'permit, 'bytes> {
    frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
    identity: Arc<ArchivedQueuedUploadOriginalFactsIdentity>,
    original: ValidatedRequest,
    config: QueueConfig,
    request: EnqueueRequest,
    scope: CanonicalScope,
    enqueue_snapshot: JobSnapshot,
    initial_claim: LeasedJob,
    prepared: PreparedNativeIntent,
    journal_receipt: NativeJournalReceipt,
}
impl<'permit, 'bytes> ArchivedQueuedUploadOriginalFacts<'permit, 'bytes> {
    pub fn decode_authenticated(
        frame: &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes>,
        contracts: &impl stock::StockContractPort,
        budget: &WorkBudget,
    ) -> Result<Self> {
        check(budget)?;
        let framed = UnadmittedQueuedUploadOriginalFrame::parse(frame.original_bytes(), budget)?;
        let original_bytes = section(&framed, "original", FACTS_LIMIT, budget)?;
        let storage_bytes = section(&framed, "storage", FACTS_LIMIT, budget)?;
        let native = section(&framed, "native-payload", PREPARED_LIMIT, budget)?;
        let media = section(&framed, "prepared-media", PREPARED_LIMIT, budget)?;
        let configured = frame
            .registry()
            .get(frame.queue_index())
            .ok_or_else(unavailable)?;
        if frame.generation() == 0 || native.is_empty() || media.is_empty() {
            return Err(unavailable());
        }
        let mut allocations = Allocations {
            bytes: size_of::<Self>() + 256,
            budget,
        };
        let mut root = Reader::new(original_bytes, budget);
        let raw = root.json(&mut allocations)?;
        // Avoid recursive batch parsing and retain this exact producer family.
        if raw["commandId"] != "homebox.file.upload" {
            return Err(unavailable());
        }
        let original = ValidatedRequest::parse(contracts, raw).map_err(|_| unavailable())?;
        root.original_tail(&original, &mut allocations)?;
        root.end()?;
        let mut input = Reader::new(storage_bytes, budget);
        // The storage section repeats the complete semantic original. Compare
        // every field, not just a digest or request ID; do not invent lexical JSON.
        let duplicate = input.json(&mut allocations)?;
        if duplicate != *original.raw() {
            return Err(unavailable());
        }
        drop(duplicate);
        input.original_tail(&original, &mut allocations)?;
        let config = input.config(&mut allocations)?;
        let request = input.request(&mut allocations)?;
        let scope = input.scope(&mut allocations)?;
        let enqueue_snapshot = input.snapshot(&mut allocations)?;
        let initial_claim = input.claim(&mut allocations)?;
        let codec = input.string(128, &mut allocations)?;
        let storage_liability = input.liability()?;
        let journal_receipt = NativeJournalReceipt {
            native_payload_digest: input.digest(&mut allocations)?,
            journal_evidence_digest: input.digest(&mut allocations)?,
        };
        input.end()?;
        // Scalars and strings are bounded before allocation; semantic equality
        // and the independent registry/job join precede the decoder marker.
        config.validate().map_err(|_| unavailable())?;
        request.validate().map_err(|_| unavailable())?;
        allocations.add(
            scope
                .collection_id
                .len()
                .checked_add(size_of::<ResourceRef>() + TEXT_LIMIT)
                .ok_or_else(unavailable)?,
        )?;
        if &config != configured
            || initial_claim.lease.job_id.0 != frame.job_id()
            || enqueue_snapshot.job_id != initial_claim.lease.job_id
            || enqueue_snapshot.receipt != request.receipt
            || enqueue_snapshot.partition != request.partition
            || initial_claim.request != request
            || initial_claim.canonical_scope != scope
            || initial_claim.pending_byte_liability != request.pending_byte_liability
            || initial_claim.attempt != 1
            || initial_claim.lease.fence == 0
            || initial_claim.lease.owner_id != config.registration.dispatcher_owner_id
            || initial_claim.lease.physical_identity != config.registration.identity
            || initial_claim
                .lease
                .expires_at
                .checked_sub(config.lease_duration_ms)
                .is_none_or(|claimed_at| claimed_at < enqueue_snapshot.created_at)
            || config
                .registration
                .resolve(&request.partition, &request.write_scope)
                .map_err(|_| unavailable())?
                != scope
            || request.intent.contract_id != crate::contracts::stock::CONTRACT_VERSION
            || request.intent.operation_id != original.id().as_str()
            || request.intent.request_digest.as_hex() != original.intent_digest()
            || request.receipt.workspace_id != original.context().workspace_id
            || request.receipt.home_id != original.context().home_id
            || original.raw()["idempotencyKey"].as_str()
                != Some(request.receipt.mutation_id.as_str())
            || original.target()["sourceInstanceId"].as_str()
                != Some(request.partition.source_instance_id.as_str())
            || original.target()["collectionId"].as_str()
                != Some(request.partition.collection_id.as_str())
            || original.target()["entityId"].as_str()
                != request.intent.target_external_id.as_deref()
            || !request.pending_byte_liability.required
            || !request
                .pending_byte_liability
                .reserved_bytes
                .is_some_and(|n| n > 0)
            || codec.is_empty()
        {
            return Err(unavailable());
        }
        let ScopeSelection::Resources(impact) = &request.write_scope.selection else {
            return Err(unavailable());
        };
        if impact.len() != 1
            || impact[0].kind != ResourceKind::Entity
            || Some(impact[0].id.as_str()) != request.intent.target_external_id.as_deref()
        {
            return Err(unavailable());
        }
        // Both retained claim and journal facts describe the same reservation N.
        // This is correlation, never liability accumulation or byte availability.
        let reservation =
            reservation_liability(request.pending_byte_liability)?.ok_or_else(unavailable)?;
        if enqueue_snapshot.storage_liability != zero_liability()
            || storage_liability != reservation
        {
            return Err(unavailable());
        }
        validate_prepared_liability(&initial_claim, &storage_liability)?;
        let native_digest = hash_hex(native, budget)?;
        let media_digest = hash_hex(media, budget)?;
        // Reserve conservatively for the genuine sibling codec's temporary
        // Values, decimal strings and canonical serialization before invoking it.
        allocations.add(
            input
                .copied_bytes
                .checked_mul(16)
                .and_then(|n| n.checked_add(CHUNK))
                .ok_or_else(unavailable)?,
        )?;
        if native_digest != journal_receipt.native_payload_digest.as_hex()
            || journal_digest(
                &initial_claim,
                &codec,
                &native_digest,
                &media_digest,
                &storage_liability,
            )? != journal_receipt.journal_evidence_digest.as_hex()
        {
            return Err(unavailable());
        }
        allocations.add(
            native
                .len()
                .checked_add(media.len())
                .ok_or_else(unavailable)?,
        )?;
        let prepared = PreparedNativeIntent {
            codec,
            native_payload: copy_bytes(native, budget)?,
            prepared_media_evidence: copy_bytes(media, budget)?,
            storage_liability,
        };
        check(budget)?;
        let facts = Self {
            frame,
            identity: Arc::new(ArchivedQueuedUploadOriginalFactsIdentity { _private: () }),
            original,
            config,
            request,
            scope,
            enqueue_snapshot,
            initial_claim,
            prepared,
            journal_receipt,
        };
        check(budget)?;
        Ok(facts)
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn config(&self) -> &QueueConfig {
        &self.config
    }
    pub fn request(&self) -> &EnqueueRequest {
        &self.request
    }
    pub fn scope(&self) -> &CanonicalScope {
        &self.scope
    }
    pub fn enqueue_snapshot(&self) -> &JobSnapshot {
        &self.enqueue_snapshot
    }
    pub fn initial_claim(&self) -> &LeasedJob {
        &self.initial_claim
    }
    pub fn prepared(&self) -> &PreparedNativeIntent {
        &self.prepared
    }
    pub fn journal_receipt(&self) -> &NativeJournalReceipt {
        &self.journal_receipt
    }
    pub fn matches_authenticated(
        &self,
        frame: &AuthenticatedQueuedUploadOriginalFrame<'_>,
    ) -> bool {
        std::ptr::eq(self.frame, frame)
    }
    pub(crate) fn frame(&self) -> &'permit AuthenticatedQueuedUploadOriginalFrame<'bytes> {
        self.frame
    }
    pub(crate) fn identity(&self) -> &Arc<ArchivedQueuedUploadOriginalFactsIdentity> {
        &self.identity
    }
}

/// Issued only after Root's genuine Storage/Source/Media semantic admission.
pub struct ArchivedQueuedUploadOriginalOwner<'permit, 'bytes> {
    facts: Arc<ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>>,
    admitted: Arc<AdmittedQueuedUploadOriginalCatalogIdentity>,
}
/// Distinct archived proof; no live RecordedOriginalUploadEnqueueProof is made.
pub struct ArchivedQueuedUploadOriginalProof<'permit, 'bytes> {
    facts: Arc<ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>>,
    admitted: Arc<AdmittedQueuedUploadOriginalCatalogIdentity>,
}
impl<'permit, 'bytes> ArchivedQueuedUploadOriginalOwner<'permit, 'bytes> {
    pub fn from_admitted(
        entry: &AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes>,
        facts: ArchivedQueuedUploadOriginalFacts<'permit, 'bytes>,
        budget: &WorkBudget,
    ) -> Result<Self> {
        check(budget)?;
        if !entry.matches_storage_facts(&facts) {
            return Err(unavailable());
        }
        let owner = Self {
            facts: Arc::new(facts),
            admitted: Arc::clone(entry.identity()),
        };
        check(budget)?;
        Ok(owner)
    }
}
impl<'permit, 'bytes> ArchivedQueuedUploadOriginalProof<'permit, 'bytes> {
    pub(crate) fn admitted_identity(&self) -> &Arc<AdmittedQueuedUploadOriginalCatalogIdentity> {
        &self.admitted
    }
    pub(crate) fn facts(&self) -> &ArchivedQueuedUploadOriginalFacts<'permit, 'bytes> {
        &self.facts
    }
    pub fn matches_authenticated(
        &self,
        frame: &AuthenticatedQueuedUploadOriginalFrame<'_>,
    ) -> bool {
        self.facts.matches_authenticated(frame)
    }
}
impl<'permit, 'bytes> OriginalEnqueueOwner for ArchivedQueuedUploadOriginalOwner<'permit, 'bytes> {
    type Proof = ArchivedQueuedUploadOriginalProof<'permit, 'bytes>;
    fn retained_enqueue(
        &self,
        registration: &QueueRegistration,
        receipt: &ReceiptKey,
        original: &ValidatedRequest,
    ) -> Result<OriginalEnqueue<Self::Proof>> {
        let facts = &self.facts;
        // No allocations or equality traversal of unbounded caller DATA.
        if !bounded_registration(registration)
            || !bounded_receipt(receipt)
            || original.id() != stock::OperationId::HomeboxFileUpload
            || !original.children().is_empty()
            || !bounded_original(original)
            || registration != &facts.config.registration
            || receipt != &facts.request.receipt
            || !same_original(original, &facts.original)
        {
            return Err(unavailable());
        }
        Ok(OriginalEnqueue {
            physical_identity: facts.config.registration.identity.clone(),
            original: facts.original.clone(),
            expected: facts.request.clone(),
            proof: ArchivedQueuedUploadOriginalProof {
                facts: Arc::clone(facts),
                admitted: Arc::clone(&self.admitted),
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
        let job = &self.facts.initial_claim;
        if !bounded_registration(registration)
            || job_id.0.len() > TEXT_LIMIT
            || registration != &self.facts.config.registration
            || !Arc::ptr_eq(&proof.facts, &self.facts)
            || !Arc::ptr_eq(&proof.admitted, &self.admitted)
            || &job.lease.job_id != job_id
            || job.lease.fence != fence
            || job.attempt != attempt
            || attempt != 1
        {
            return Err(unavailable());
        }
        Ok(job.clone())
    }
}

fn same_original(left: &ValidatedRequest, right: &ValidatedRequest) -> bool {
    left.id() == right.id()
        && left.request_id() == right.request_id()
        && left.context() == right.context()
        && left.route() == right.route()
        && left.is_mutation() == right.is_mutation()
        && left.intent_digest() == right.intent_digest()
        && left.children().is_empty()
        && right.children().is_empty()
        && left.raw() == right.raw()
}
fn bounded_receipt(receipt: &ReceiptKey) -> bool {
    [
        &receipt.workspace_id,
        &receipt.home_id,
        &receipt.actor_id,
        &receipt.mutation_id,
    ]
    .iter()
    .all(|s| s.len() <= TEXT_LIMIT)
}
fn bounded_registration(registration: &QueueRegistration) -> bool {
    registration.aliases.len() <= ALIAS_LIMIT
        && [
            &registration.identity.deployment_id,
            &registration.identity.physical_database_id,
            &registration.dispatcher_owner_id,
        ]
        .iter()
        .all(|s| s.len() <= TEXT_LIMIT)
        && registration.aliases.iter().all(|a| {
            [
                &a.partition.workspace_id,
                &a.partition.home_id,
                &a.partition.source_instance_id,
                &a.partition.collection_id,
                &a.canonical_collection_id,
            ]
            .iter()
            .all(|s| s.len() <= TEXT_LIMIT)
        })
}
fn bounded_original(original: &ValidatedRequest) -> bool {
    if original.request_id().len() > TEXT_LIMIT
        || original.intent_digest().len() != 64
        || original.context().workspace_id.len() > TEXT_LIMIT
        || original.context().home_id.len() > TEXT_LIMIT
    {
        return false;
    }
    fn visit(value: &Value, depth: usize, nodes: &mut usize, bytes: &mut usize) -> Option<()> {
        if depth > JSON_DEPTH {
            return None;
        }
        *nodes = nodes.checked_add(1)?;
        *bytes = bytes.checked_add(128)?;
        if *nodes > JSON_NODES || *bytes > FACTS_LIMIT {
            return None;
        }
        match value {
            Value::String(s) => {
                *bytes = bytes.checked_add(s.len().checked_mul(4)?)?;
            }
            Value::Number(n) => {
                // arbitrary_precision can retain unbounded lexical number DATA.
                // Count its borrowed serialization before numeric conversion.
                serde_json::to_writer(NumberLimit(0), n).ok()?;
                if !n.as_f64().is_some_and(f64::is_finite) {
                    return None;
                }
            }
            Value::Array(items) => {
                if items.len() > JSON_ITEMS {
                    return None;
                }
                for v in items {
                    visit(v, depth + 1, nodes, bytes)?;
                }
            }
            Value::Object(items) => {
                if items.len() > JSON_MEMBERS {
                    return None;
                }
                for (k, v) in items {
                    if k.len() > TEXT_LIMIT {
                        return None;
                    }
                    *bytes = bytes.checked_add(k.len().checked_mul(4)?)?;
                    visit(v, depth + 1, nodes, bytes)?;
                }
            }
            _ => {}
        }
        (*bytes <= FACTS_LIMIT).then_some(())
    }
    visit(original.raw(), 0, &mut 0, &mut 0).is_some()
}
struct NumberLimit(usize);
impl std::io::Write for NumberLimit {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len())
            .filter(|n| *n <= 128)
            .ok_or_else(|| std::io::Error::other("Archived number limit"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn section<'a>(
    frame: &UnadmittedQueuedUploadOriginalFrame<'a>,
    name: &str,
    maximum: usize,
    budget: &WorkBudget,
) -> Result<&'a [u8]> {
    let bytes = frame.section(name, budget)?.ok_or_else(unavailable)?;
    if bytes.len() > maximum {
        return Err(unavailable());
    }
    Ok(bytes)
}
fn hash_hex(bytes: &[u8], budget: &WorkBudget) -> Result<String> {
    let mut hash = Sha256::new();
    for part in bytes.chunks(CHUNK) {
        check(budget)?;
        hash.update(part);
    }
    check(budget)?;
    Ok(format!("{:x}", hash.finalize()))
}
fn copy_bytes(bytes: &[u8], budget: &WorkBudget) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    out.try_reserve_exact(bytes.len())
        .map_err(|_| unavailable())?;
    for part in bytes.chunks(CHUNK) {
        check(budget)?;
        out.extend_from_slice(part);
    }
    check(budget)?;
    Ok(out)
}
struct Allocations<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl Allocations<'_> {
    fn add(&mut self, amount: usize) -> Result<()> {
        check(self.budget)?;
        self.bytes = self
            .bytes
            .checked_add(amount)
            .filter(|n| *n <= ALLOCATION_LIMIT)
            .ok_or_else(unavailable)?;
        Ok(())
    }
}

// The only decoder is the inverse of the fixed publication encoder. All tags,
// lengths and counts are inspected as borrowed DATA before allocating children.
#[derive(Clone, Copy)]
struct Reader<'a, 'budget> {
    rest: &'a [u8],
    budget: &'budget WorkBudget,
    copied_bytes: usize,
}
impl<'a, 'budget> Reader<'a, 'budget> {
    fn new(bytes: &'a [u8], budget: &'budget WorkBudget) -> Self {
        Self {
            rest: bytes,
            budget,
            copied_bytes: 0,
        }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        check(self.budget)?;
        let value = self.rest.get(..count).ok_or_else(unavailable)?;
        self.rest = self.rest.get(count..).ok_or_else(unavailable)?;
        Ok(value)
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().map_err(|_| unavailable())?,
        ))
    }
    fn bool(&mut self) -> Result<bool> {
        match self.take(1)? {
            [0] => Ok(false),
            [1] => Ok(true),
            _ => Err(unavailable()),
        }
    }
    fn count(&mut self, maximum: usize) -> Result<usize> {
        let count = usize::try_from(self.u64()?).map_err(|_| unavailable())?;
        if count > maximum {
            return Err(unavailable());
        }
        Ok(count)
    }
    fn bytes(&mut self, maximum: usize) -> Result<&'a [u8]> {
        let length = self.count(maximum)?;
        self.take(length)
    }
    fn text(&mut self, maximum: usize) -> Result<&'a str> {
        std::str::from_utf8(self.bytes(maximum)?).map_err(|_| unavailable())
    }
    fn string(&mut self, maximum: usize, allocations: &mut Allocations<'_>) -> Result<String> {
        let text = self.text(maximum)?;
        allocations.add(
            text.len()
                .checked_add(size_of::<String>())
                .ok_or_else(unavailable)?,
        )?;
        self.copied_bytes = self
            .copied_bytes
            .checked_add(text.len() + size_of::<String>())
            .ok_or_else(unavailable)?;
        Ok(text.to_owned())
    }
    fn tag(&mut self, expected: &str) -> Result<()> {
        if self.text(128)? != expected {
            return Err(unavailable());
        }
        Ok(())
    }
    fn none(&mut self) -> Result<()> {
        if self.bool()? {
            return Err(unavailable());
        }
        Ok(())
    }
    fn optional_u64(&mut self) -> Result<Option<u64>> {
        if self.bool()? {
            Ok(Some(self.u64()?))
        } else {
            Ok(None)
        }
    }
    fn digest(&mut self, allocations: &mut Allocations<'_>) -> Result<Digest> {
        let text = self.text(64)?;
        if text.len() != 64
            || !text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(unavailable());
        }
        allocations.add(64 + size_of::<Digest>())?;
        self.copied_bytes = self
            .copied_bytes
            .checked_add(64 + size_of::<Digest>())
            .ok_or_else(unavailable)?;
        Digest::from_hex(text.to_owned()).map_err(|_| unavailable())
    }
    fn json(&mut self, allocations: &mut Allocations<'_>) -> Result<Value> {
        let bytes = self.bytes(FACTS_LIMIT)?;
        let estimated = JsonProbe::inspect(bytes, self.budget)?;
        // Includes deserializer scratch, raw Value, Domain context cloning,
        // digest's cloned request and canonical serialization/sorted key buffers.
        allocations.add(estimated.checked_mul(4).ok_or_else(unavailable)?)?;
        check(self.budget)?;
        let value = serde_json::from_slice(bytes).map_err(|_| unavailable())?;
        check(self.budget)?;
        Ok(value)
    }
    fn original_tail(
        &mut self,
        original: &ValidatedRequest,
        allocations: &mut Allocations<'_>,
    ) -> Result<()> {
        if self.text(128)? != original.id().as_str() {
            return Err(unavailable());
        }
        let context = self.json(allocations)?;
        if context.as_object().is_none_or(|o| o.len() != 2)
            || context["workspaceId"].as_str() != Some(original.context().workspace_id.as_str())
            || context["homeId"].as_str() != Some(original.context().home_id.as_str())
            || self.text(TEXT_LIMIT)? != original.request_id()
            || self.text(64)? != original.intent_digest()
            || self.text(128)? != "POST"
            || self.text(TEXT_LIMIT)? != "/api/v1/entities/{id}/attachments"
            || self.u64()? != 0
            || !original.children().is_empty()
            || !matches!(original.route(), stock::Route::HomeboxNative(route)
                if route.method == stock::Method::Post && route.path == "/api/v1/entities/{id}/attachments")
        {
            return Err(unavailable());
        }
        Ok(())
    }
    fn partition(&mut self, a: &mut Allocations<'_>) -> Result<SourcePartition> {
        Ok(SourcePartition {
            workspace_id: self.string(TEXT_LIMIT, a)?,
            home_id: self.string(TEXT_LIMIT, a)?,
            source_instance_id: self.string(TEXT_LIMIT, a)?,
            collection_id: self.string(TEXT_LIMIT, a)?,
        })
    }
    fn receipt(&mut self, a: &mut Allocations<'_>) -> Result<ReceiptKey> {
        Ok(ReceiptKey {
            workspace_id: self.string(TEXT_LIMIT, a)?,
            home_id: self.string(TEXT_LIMIT, a)?,
            actor_id: self.string(TEXT_LIMIT, a)?,
            mutation_id: self.string(TEXT_LIMIT, a)?,
        })
    }
    fn physical(&mut self, a: &mut Allocations<'_>) -> Result<PhysicalQueueIdentity> {
        Ok(PhysicalQueueIdentity {
            deployment_id: self.string(TEXT_LIMIT, a)?,
            physical_database_id: self.string(TEXT_LIMIT, a)?,
            configuration_digest: self.digest(a)?,
        })
    }
    fn selection(&mut self, a: &mut Allocations<'_>) -> Result<ScopeSelection> {
        self.tag("resources")?;
        // The genuine original upload producer has exactly one entity impact.
        if self.u64()? != 1 {
            return Err(unavailable());
        }
        self.tag("entity")?;
        a.add(size_of::<ResourceRef>())?;
        Ok(ScopeSelection::Resources(vec![ResourceRef {
            kind: ResourceKind::Entity,
            id: self.string(TEXT_LIMIT, a)?,
        }]))
    }
    fn scope(&mut self, a: &mut Allocations<'_>) -> Result<CanonicalScope> {
        Ok(CanonicalScope {
            collection_id: self.string(TEXT_LIMIT, a)?,
            selection: self.selection(a)?,
        })
    }
    fn pending(&mut self) -> Result<PendingByteLiability> {
        let required = self.bool()?;
        let reserved_bytes = self.optional_u64()?;
        if !required || !reserved_bytes.is_some_and(|n| n > 0) {
            return Err(unavailable());
        }
        Ok(PendingByteLiability {
            required,
            reserved_bytes,
        })
    }
    fn request(&mut self, a: &mut Allocations<'_>) -> Result<EnqueueRequest> {
        Ok(EnqueueRequest {
            receipt: self.receipt(a)?,
            partition: self.partition(a)?,
            intent: IntentMetadata {
                contract_id: self.string(TEXT_LIMIT, a)?,
                operation_id: self.string(TEXT_LIMIT, a)?,
                target_external_id: if self.bool()? {
                    Some(self.string(TEXT_LIMIT, a)?)
                } else {
                    None
                },
                request_digest: self.digest(a)?,
            },
            write_scope: WriteScope {
                source_instance_id: self.string(TEXT_LIMIT, a)?,
                collection_id: self.string(TEXT_LIMIT, a)?,
                selection: self.selection(a)?,
            },
            pending_byte_liability: self.pending()?,
        })
    }
    fn config(&mut self, a: &mut Allocations<'_>) -> Result<QueueConfig> {
        let lease_duration_ms = self.u64()?;
        let retry = RetryPolicy {
            max_attempts: self.u32()?,
            initial_delay_ms: self.u64()?,
            max_delay_ms: self.u64()?,
        };
        let identity = self.physical(a)?;
        let dispatcher_owner_id = self.string(TEXT_LIMIT, a)?;
        let count = self.count(ALIAS_LIMIT)?;
        // Check complete alias keys and collisions with borrowed text before
        // allocating their vector or any alias children.
        let mut probe = *self;
        let mut seen = [None; ALIAS_LIMIT];
        for index in 0..count {
            let partition = [
                probe.text(TEXT_LIMIT)?,
                probe.text(TEXT_LIMIT)?,
                probe.text(TEXT_LIMIT)?,
                probe.text(TEXT_LIMIT)?,
            ];
            let canonical = probe.text(TEXT_LIMIT)?;
            if partition.iter().any(|s| s.is_empty())
                || canonical.is_empty()
                || seen[..index]
                    .iter()
                    .flatten()
                    .any(|(old, name): &([&str; 4], &str)| {
                        old == &partition || (old[2..] == partition[2..] && *name != canonical)
                    })
            {
                return Err(unavailable());
            }
            seen[index] = Some((partition, canonical));
        }
        a.add(
            count
                .checked_mul(size_of::<SourceAlias>())
                .ok_or_else(unavailable)?,
        )?;
        let mut aliases = Vec::new();
        aliases
            .try_reserve_exact(count)
            .map_err(|_| unavailable())?;
        for _ in 0..count {
            aliases.push(SourceAlias {
                partition: self.partition(a)?,
                canonical_collection_id: self.string(TEXT_LIMIT, a)?,
            });
        }
        let profile_version = self.string(TEXT_LIMIT, a)?;
        let qualification = match self.text(128)? {
            "offline-engineering-fixture" => ProfileQualification::OfflineEngineeringFixture,
            "qualified-deployment" => ProfileQualification::QualifiedDeployment {
                evidence_digest: self.digest(a)?,
            },
            _ => return Err(unavailable()),
        };
        let admission_profile = AdmissionProfile {
            profile_version,
            qualification,
            max_waiting_intents: self.u32()?,
            max_admission_wait_ms: self.u64()?,
            max_unresolved_storage_attempts: self.u32()?,
            max_unresolved_storage_bytes: self.u64()?,
        };
        Ok(QueueConfig {
            lease_duration_ms,
            retry,
            registration: QueueRegistration {
                identity,
                dispatcher_owner_id,
                aliases,
            },
            admission_profile,
        })
    }
    fn liability(&mut self) -> Result<StorageLiability> {
        self.tag("complete")?;
        let known_bytes = self.u64()?;
        let reserved_bytes = self.u64()?;
        self.tag("not-dispatched")?;
        self.tag("none")?;
        self.tag("unassessed")?;
        self.none()?;
        let unresolved_attempts = self.u32()?;
        if known_bytes != 0 {
            return Err(unavailable());
        }
        Ok(StorageLiability {
            accounting: ByteAccounting::Complete {
                known_bytes,
                reserved_bytes,
            },
            metadata_commit_evidence: MetadataCommitEvidence::NotDispatched,
            byte_disposition: ByteDisposition::None,
            reference_closure_evidence: ReferenceClosureEvidence::Unassessed,
            orphan_candidate_id: None,
            unresolved_attempts,
        })
    }
    fn snapshot(&mut self, a: &mut Allocations<'_>) -> Result<JobSnapshot> {
        let job_id = JobId(self.string(TEXT_LIMIT, a)?);
        let receipt = self.receipt(a)?;
        let partition = self.partition(a)?;
        self.tag("queued")?;
        if self.u32()? != 0 {
            return Err(unavailable());
        }
        let created_at = self.u64()?;
        let updated_at = self.u64()?;
        let next_attempt_at = self.optional_u64()?;
        self.none()?; // AppliedWrite is impossible in an original queued cut.
        self.none()?; // Likewise, no failure or invocation has occurred.
        self.tag("not-dispatched")?;
        if self.bool()? {
            return Err(unavailable());
        }
        let storage_liability = self.liability()?;
        if self.bool()?
            || job_id.0.is_empty()
            || updated_at != created_at
            || next_attempt_at != Some(created_at)
        {
            return Err(unavailable());
        }
        Ok(JobSnapshot {
            job_id,
            receipt,
            partition,
            status: JobStatus::Queued,
            attempts: 0,
            created_at,
            updated_at,
            next_attempt_at,
            applied: None,
            failure: None,
            remote_activity: RemoteActivity::NotDispatched,
            unknown_scope_fence_retained: false,
            storage_liability,
            body_accepted: false,
        })
    }
    fn claim(&mut self, a: &mut Allocations<'_>) -> Result<LeasedJob> {
        let lease = Lease {
            job_id: JobId(self.string(TEXT_LIMIT, a)?),
            fence: self.u64()?,
            expires_at: self.u64()?,
            owner_id: self.string(TEXT_LIMIT, a)?,
            physical_identity: self.physical(a)?,
        };
        let request = self.request(a)?;
        let attempt = self.u32()?;
        let canonical_scope = self.scope(a)?;
        let pending_byte_liability = self.pending()?;
        Ok(LeasedJob {
            lease,
            request,
            attempt,
            canonical_scope,
            pending_byte_liability,
        })
    }
    fn end(&self) -> Result<()> {
        check(self.budget)?;
        if !self.rest.is_empty() {
            return Err(unavailable());
        }
        Ok(())
    }
}

// Allocation-free JSON preflight, including semantic duplicate keys (escaped
// and literal spellings compare as Unicode scalars). serde never sees an
// unbounded container/string or a duplicate that its Value map would collapse.
struct JsonProbe<'a, 'budget> {
    bytes: &'a [u8],
    position: usize,
    nodes: usize,
    heap: usize,
    next_check: usize,
    budget: &'budget WorkBudget,
}
#[derive(Clone, Copy)]
struct JsonKey<'a> {
    raw: &'a str,
    hash: [u8; 32],
}
impl<'a, 'budget> JsonProbe<'a, 'budget> {
    fn inspect(bytes: &'a [u8], budget: &'budget WorkBudget) -> Result<usize> {
        check(budget)?;
        std::str::from_utf8(bytes).map_err(|_| unavailable())?;
        let mut probe = Self {
            bytes,
            position: 0,
            nodes: 0,
            heap: 0,
            next_check: 0,
            budget,
        };
        probe.value(0)?;
        probe.space()?;
        if probe.position != bytes.len() {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(probe.heap)
    }
    fn tick(&mut self) -> Result<()> {
        if self.position >= self.next_check {
            check(self.budget)?;
            self.next_check = self.position.saturating_add(CHUNK);
        }
        Ok(())
    }
    fn add(&mut self, bytes: usize) -> Result<()> {
        self.heap = self
            .heap
            .checked_add(bytes)
            .filter(|n| *n <= FACTS_LIMIT)
            .ok_or_else(unavailable)?;
        Ok(())
    }
    fn space(&mut self) -> Result<()> {
        while self
            .bytes
            .get(self.position)
            .is_some_and(|b| matches!(b, b' ' | b'\n' | b'\r' | b'\t'))
        {
            self.tick()?;
            self.position += 1;
        }
        Ok(())
    }
    fn punctuation(&mut self, byte: u8) -> Result<()> {
        self.space()?;
        self.tick()?;
        if self.bytes.get(self.position) != Some(&byte) {
            return Err(unavailable());
        }
        self.position += 1;
        Ok(())
    }
    fn string(&mut self, maximum: usize) -> Result<&'a str> {
        self.punctuation(b'"')?;
        let start = self.position;
        loop {
            self.tick()?;
            let byte = *self.bytes.get(self.position).ok_or_else(unavailable)?;
            if byte == b'"' {
                let raw = std::str::from_utf8(&self.bytes[start..self.position])
                    .map_err(|_| unavailable())?;
                if raw.len() > maximum {
                    return Err(unavailable());
                }
                self.position += 1;
                let mut chars = JsonChars { rest: raw };
                let mut count = 0usize;
                while chars.next()?.is_some() {
                    if count.is_multiple_of(1024) {
                        check(self.budget)?;
                    }
                    count += 1;
                }
                self.add(raw.len().checked_mul(4).ok_or_else(unavailable)?)?;
                return Ok(raw);
            }
            if byte < 0x20 || self.position - start >= maximum {
                return Err(unavailable());
            }
            self.position += 1;
            if byte == b'\\' {
                let escaped = *self.bytes.get(self.position).ok_or_else(unavailable)?;
                self.position += 1;
                match escaped {
                    b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => {}
                    b'u' => {
                        let hex = self
                            .bytes
                            .get(self.position..self.position + 4)
                            .ok_or_else(unavailable)?;
                        if !hex.iter().all(u8::is_ascii_hexdigit) {
                            return Err(unavailable());
                        }
                        self.position += 4;
                    }
                    _ => return Err(unavailable()),
                }
            }
        }
    }
    fn value(&mut self, depth: usize) -> Result<()> {
        self.space()?;
        self.tick()?;
        self.nodes = self
            .nodes
            .checked_add(1)
            .filter(|n| *n <= JSON_NODES)
            .ok_or_else(unavailable)?;
        if depth > JSON_DEPTH {
            return Err(unavailable());
        }
        self.add(128)?;
        match self
            .bytes
            .get(self.position)
            .copied()
            .ok_or_else(unavailable)?
        {
            b'"' => {
                self.string(PREPARED_LIMIT)?;
            }
            b'{' => {
                self.position += 1;
                self.space()?;
                let mut keys: [Option<JsonKey<'_>>; JSON_MEMBERS] = [None; JSON_MEMBERS];
                let mut count = 0;
                if self.bytes.get(self.position) != Some(&b'}') {
                    loop {
                        check(self.budget)?;
                        if count >= JSON_MEMBERS {
                            return Err(unavailable());
                        }
                        let raw = self.string(TEXT_LIMIT)?;
                        let mut hasher = Sha256::new();
                        let mut chars = JsonChars { rest: raw };
                        while let Some(c) = chars.next()? {
                            hasher.update((c as u32).to_be_bytes());
                        }
                        let hash: [u8; 32] = hasher.finalize().into();
                        for old in keys[..count].iter().flatten() {
                            if old.hash == hash && equal_keys(old.raw, raw)? {
                                return Err(unavailable());
                            }
                        }
                        keys[count] = Some(JsonKey { raw, hash });
                        count += 1;
                        self.add(128)?;
                        self.punctuation(b':')?;
                        self.value(depth + 1)?;
                        self.space()?;
                        if self.bytes.get(self.position) != Some(&b',') {
                            break;
                        }
                        self.position += 1;
                    }
                }
                self.punctuation(b'}')?;
            }
            b'[' => {
                self.position += 1;
                self.space()?;
                let mut count = 0;
                if self.bytes.get(self.position) != Some(&b']') {
                    loop {
                        if count >= JSON_ITEMS {
                            return Err(unavailable());
                        }
                        self.value(depth + 1)?;
                        count += 1;
                        self.space()?;
                        if self.bytes.get(self.position) != Some(&b',') {
                            break;
                        }
                        self.position += 1;
                    }
                }
                self.punctuation(b']')?;
            }
            b't' => self.literal(b"true")?,
            b'f' => self.literal(b"false")?,
            b'n' => self.literal(b"null")?,
            b'-' | b'0'..=b'9' => self.number()?,
            _ => return Err(unavailable()),
        }
        Ok(())
    }
    fn literal(&mut self, literal: &[u8]) -> Result<()> {
        if self.bytes.get(self.position..self.position + literal.len()) != Some(literal) {
            return Err(unavailable());
        }
        self.position += literal.len();
        Ok(())
    }
    fn digits(&mut self) -> Result<()> {
        let start = self.position;
        while self
            .bytes
            .get(self.position)
            .is_some_and(u8::is_ascii_digit)
        {
            self.position += 1;
            if self.position - start > 128 {
                return Err(unavailable());
            }
        }
        if start == self.position {
            return Err(unavailable());
        }
        Ok(())
    }
    fn number(&mut self) -> Result<()> {
        let start = self.position;
        if self.bytes.get(self.position) == Some(&b'-') {
            self.position += 1;
        }
        if self.bytes.get(self.position) == Some(&b'0') {
            self.position += 1;
        } else {
            self.digits()?;
        }
        if self.bytes.get(self.position) == Some(&b'.') {
            self.position += 1;
            self.digits()?;
        }
        if self
            .bytes
            .get(self.position)
            .is_some_and(|b| matches!(b, b'e' | b'E'))
        {
            self.position += 1;
            if self
                .bytes
                .get(self.position)
                .is_some_and(|b| matches!(b, b'+' | b'-'))
            {
                self.position += 1;
            }
            self.digits()?;
        }
        if self.position - start > 128 {
            return Err(unavailable());
        }
        self.add(128)
    }
}
struct JsonChars<'a> {
    rest: &'a str,
}
impl JsonChars<'_> {
    fn hex(&mut self) -> Result<u16> {
        let raw = self.rest.get(..4).ok_or_else(unavailable)?;
        let scalar = u16::from_str_radix(raw, 16).map_err(|_| unavailable())?;
        self.rest = &self.rest[4..];
        Ok(scalar)
    }
    fn next(&mut self) -> Result<Option<char>> {
        let Some(first) = self.rest.chars().next() else {
            return Ok(None);
        };
        self.rest = &self.rest[first.len_utf8()..];
        if first != '\\' {
            return Ok(Some(first));
        }
        let escaped = self.rest.chars().next().ok_or_else(unavailable)?;
        self.rest = &self.rest[escaped.len_utf8()..];
        let value = match escaped {
            '"' => '"',
            '\\' => '\\',
            '/' => '/',
            'b' => '\u{8}',
            'f' => '\u{c}',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            'u' => {
                let high = self.hex()?;
                let scalar = if (0xd800..=0xdbff).contains(&high) {
                    if !self.rest.starts_with("\\u") {
                        return Err(unavailable());
                    }
                    self.rest = &self.rest[2..];
                    let low = self.hex()?;
                    if !(0xdc00..=0xdfff).contains(&low) {
                        return Err(unavailable());
                    }
                    0x10000 + (((high as u32) - 0xd800) << 10) + ((low as u32) - 0xdc00)
                } else {
                    high as u32
                };
                char::from_u32(scalar).ok_or_else(unavailable)?
            }
            _ => return Err(unavailable()),
        };
        Ok(Some(value))
    }
}
fn equal_keys(left: &str, right: &str) -> Result<bool> {
    let mut left = JsonChars { rest: left };
    let mut right = JsonChars { rest: right };
    loop {
        match (left.next()?, right.next()?) {
            (None, None) => return Ok(true),
            (a, b) if a == b => {}
            _ => return Ok(false),
        }
    }
}
