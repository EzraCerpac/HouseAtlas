//! Versioned bytes from one genuine, handle-free original upload history.
//! This encodes preparation history only: no upload body, invocation, Finish,
//! remote end, authenticated archive origin, discovery grant or restart owner.
//! Unadmitted input validates container framing only; it cannot issue a seal.
use super::homebox_queued_upload_history::RecordedQueuedUploadOriginalHistory;
use crate::{
    domain::stock, jobs, media::WorkBudget, providers::homebox::write::stock as native, storage,
};
use serde::Serialize;
use std::{
    io::Write,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAGIC: &[u8] = b"houseatlas-upload-original-history-frame/1\0";
const FRAME_MAX: usize = 192 * 1024 * 1024;
const FACTS_MAX: usize = 16 * 1024 * 1024;
const RAW_MAX: usize = 64 * 1024 * 1024;
const NAMES: [&str; 21] = [
    "original",
    "storage",
    "media",
    "source",
    "media-owner-raw",
    "source-owner-raw",
    "reservation",
    "native-payload",
    "prepared-media",
    "artifact-00",
    "artifact-01",
    "artifact-02",
    "artifact-03",
    "artifact-04",
    "artifact-05",
    "artifact-06",
    "artifact-07",
    "artifact-08",
    "artifact-09",
    "artifact-10",
    "artifact-11",
];

/// Private issuance requires the closed Root join of three released owner cuts.
/// The bytes are publication DATA, not durable or authenticated custody. This
/// type owns no original/native cut, file, guard, credential or pure owner seal.
pub struct ProducedQueuedUploadOriginalFrame {
    bytes: Vec<u8>,
}
impl ProducedQueuedUploadOriginalFrame {
    pub fn capture(
        history: &RecordedQueuedUploadOriginalHistory,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        check(budget)?;
        let artifacts = history.source().installation().artifacts();
        if artifacts.len() != 12 {
            return Err(unavailable());
        }
        let mut out = Encoder::new(budget);
        out.append(MAGIC)?;
        out.append(&(NAMES.len() as u16).to_be_bytes())?;
        out.section(NAMES[0], FACTS_MAX, |e| original(history.original(), e))?;
        out.section(NAMES[1], FACTS_MAX, |e| storage_facts(history, e))?;
        out.section(NAMES[2], FACTS_MAX, |e| media_facts(history, e))?;
        out.section(NAMES[3], FACTS_MAX, |e| source_facts(history, e))?;
        for (name, bytes) in [
            (NAMES[4], history.media().snapshot().original()),
            (
                NAMES[5],
                history.source().snapshot().original().original.as_slice(),
            ),
            (NAMES[6], history.media().reservation_bytes()),
            (
                NAMES[7],
                history.storage().prepared().native_payload.as_slice(),
            ),
            (
                NAMES[8],
                history
                    .storage()
                    .prepared()
                    .prepared_media_evidence
                    .as_slice(),
            ),
        ] {
            out.section(name, raw_limit(name), |e| e.append(bytes))?;
        }
        for (name, artifact) in NAMES[9..].iter().zip(artifacts) {
            out.section(name, RAW_MAX, |e| e.append(artifact.bytes()))?;
        }
        check(budget)?;
        Ok(Self { bytes: out.bytes })
    }
    pub fn original_bytes(&self) -> &[u8] {
        &self.bytes
    }
}

/// A borrowed, unadmitted framing candidate. Section contents remain untrusted
/// opaque bytes, including JSON facts. No semantic decoding, issuer/grant mint,
/// physical database adoption or current authority follows from this parse.
pub struct UnadmittedQueuedUploadOriginalFrame<'a> {
    bytes: &'a [u8],
}
impl<'a> UnadmittedQueuedUploadOriginalFrame<'a> {
    pub fn parse(bytes: &'a [u8], budget: &WorkBudget) -> storage::Result<Self> {
        check(budget)?;
        if bytes.len() > FRAME_MAX || !bytes.starts_with(MAGIC) {
            return Err(unavailable());
        }
        let mut rest = &bytes[MAGIC.len()..];
        if take(&mut rest, 2)? != (NAMES.len() as u16).to_be_bytes() {
            return Err(unavailable());
        }
        for name in NAMES {
            check(budget)?;
            let len = u16::from_be_bytes(take(&mut rest, 2)?.try_into().map_err(|_| unavailable())?)
                as usize;
            if len != name.len() || take(&mut rest, len)? != name.as_bytes() {
                return Err(unavailable());
            }
            let size = usize::try_from(u64::from_be_bytes(
                take(&mut rest, 8)?.try_into().map_err(|_| unavailable())?,
            ))
            .map_err(|_| unavailable())?;
            let limit = if NAMES[..4].contains(&name) {
                FACTS_MAX
            } else {
                raw_limit(name)
            };
            if size > limit {
                return Err(unavailable());
            }
            take(&mut rest, size)?;
        }
        if !rest.is_empty() {
            return Err(unavailable());
        }
        check(budget)?;
        Ok(Self { bytes })
    }
    pub fn original_bytes(&self) -> &'a [u8] {
        self.bytes
    }
    /// Borrowed section DATA after complete framing validation. This accessor
    /// grants no semantic owner, catalog admission or recovery permission.
    pub fn section(
        &self,
        requested: &str,
        budget: &WorkBudget,
    ) -> storage::Result<Option<&'a [u8]>> {
        check(budget)?;
        let mut rest = &self.bytes[MAGIC.len() + 2..];
        for name in NAMES {
            check(budget)?;
            let name_len =
                u16::from_be_bytes(take(&mut rest, 2)?.try_into().map_err(|_| unavailable())?)
                    as usize;
            take(&mut rest, name_len)?;
            let size = usize::try_from(u64::from_be_bytes(
                take(&mut rest, 8)?.try_into().map_err(|_| unavailable())?,
            ))
            .map_err(|_| unavailable())?;
            let section = take(&mut rest, size)?;
            if name == requested {
                check(budget)?;
                return Ok(Some(section));
            }
        }
        check(budget)?;
        Ok(None)
    }
    /// Exact process-local DATA equality only; a candidate does not become an
    /// issued frame or an authenticated historical owner when this is true.
    pub fn matches_issued(
        &self,
        issued: &ProducedQueuedUploadOriginalFrame,
        budget: &WorkBudget,
    ) -> storage::Result<bool> {
        check(budget)?;
        let expected = issued.original_bytes();
        if self.bytes.len() != expected.len() {
            return Ok(false);
        }
        let mut same = true;
        for (candidate, original) in self.bytes.chunks(64 * 1024).zip(expected.chunks(64 * 1024)) {
            check(budget)?;
            if candidate != original {
                same = false;
                break;
            }
        }
        check(budget)?;
        Ok(same)
    }
}
fn raw_limit(name: &str) -> usize {
    match name {
        "media-owner-raw" | "source-owner-raw" => 10 * 1024 * 1024,
        "native-payload" | "prepared-media" => 1024 * 1024,
        _ => RAW_MAX,
    }
}
fn take<'a>(rest: &mut &'a [u8], len: usize) -> storage::Result<&'a [u8]> {
    let value = rest.get(..len).ok_or_else(unavailable)?;
    *rest = rest.get(len..).ok_or_else(unavailable)?;
    Ok(value)
}

// Version 1 facts use ordered fields, big-endian integer scalars, u64-length
// UTF-8/binary/JSON values and u64-count vectors. Options use 0/1; enums use
// explicit UTF-8 names. JSON preserves values, not nonexistent lexical request
// bytes. No Debug strings, lossy dates or synthesized unknown values are used.
struct Encoder<'a> {
    bytes: Vec<u8>,
    limit: usize,
    budget: &'a WorkBudget,
}
impl<'a> Encoder<'a> {
    fn new(budget: &'a WorkBudget) -> Self {
        Self {
            bytes: Vec::new(),
            limit: FRAME_MAX,
            budget,
        }
    }
    fn append(&mut self, bytes: &[u8]) -> storage::Result<()> {
        check(self.budget)?;
        let end = self
            .bytes
            .len()
            .checked_add(bytes.len())
            .ok_or_else(unavailable)?;
        if end > self.limit || end > FRAME_MAX {
            return Err(unavailable());
        }
        self.bytes
            .try_reserve(bytes.len())
            .map_err(|_| unavailable())?;
        for part in bytes.chunks(64 * 1024) {
            check(self.budget)?;
            self.bytes.extend_from_slice(part);
        }
        check(self.budget)
    }
    fn section(
        &mut self,
        name: &str,
        maximum: usize,
        body: impl FnOnce(&mut Self) -> storage::Result<()>,
    ) -> storage::Result<()> {
        self.append(
            &u16::try_from(name.len())
                .map_err(|_| unavailable())?
                .to_be_bytes(),
        )?;
        self.append(name.as_bytes())?;
        let at = self.bytes.len();
        self.append(&[0; 8])?;
        let start = self.bytes.len();
        self.limit = start
            .checked_add(maximum)
            .ok_or_else(unavailable)?
            .min(FRAME_MAX);
        body(self)?;
        let size = u64::try_from(self.bytes.len() - start).map_err(|_| unavailable())?;
        check(self.budget)?;
        self.bytes[at..at + 8].copy_from_slice(&size.to_be_bytes());
        self.limit = FRAME_MAX;
        check(self.budget)
    }
    fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> storage::Result<()> {
        let at = self.bytes.len();
        self.append(&[0; 8])?;
        let start = self.bytes.len();
        serde_json::to_writer(&mut *self, value).map_err(|_| unavailable())?;
        let size = u64::try_from(self.bytes.len() - start).map_err(|_| unavailable())?;
        check(self.budget)?;
        self.bytes[at..at + 8].copy_from_slice(&size.to_be_bytes());
        check(self.budget)
    }
}
impl Write for Encoder<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.append(bytes)
            .map_err(|_| std::io::Error::other("Upload frame unavailable"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
trait Encode {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()>;
}
impl Encode for str {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.len().encode(e)?;
        e.append(self.as_bytes())
    }
}
impl Encode for String {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.as_str().encode(e)
    }
}
impl Encode for u64 {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&self.to_be_bytes())
    }
}
impl Encode for u32 {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&self.to_be_bytes())
    }
}
impl Encode for u16 {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&self.to_be_bytes())
    }
}
impl Encode for i64 {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&self.to_be_bytes())
    }
}
impl Encode for usize {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        u64::try_from(*self).map_err(|_| unavailable())?.encode(e)
    }
}
impl Encode for bool {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&[u8::from(*self)])
    }
}
impl<T: Encode> Encode for Option<T> {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        e.append(&[u8::from(self.is_some())])?;
        if let Some(value) = self {
            value.encode(e)?;
        }
        Ok(())
    }
}
impl<T: Encode> Encode for [T] {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.len().encode(e)?;
        for v in self {
            check(e.budget)?;
            v.encode(e)?;
        }
        Ok(())
    }
}
impl<T: Encode> Encode for Vec<T> {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.as_slice().encode(e)
    }
}
impl<A: Encode, B: Encode> Encode for (A, B) {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.0.encode(e)?;
        self.1.encode(e)
    }
}
impl Encode for jobs::Digest {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.as_hex().encode(e)
    }
}
impl Encode for native::Digest {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.as_str().encode(e)
    }
}
impl Encode for Duration {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.as_secs().encode(e)?;
        self.subsec_nanos().encode(e)
    }
}
impl Encode for SystemTime {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self.duration_since(UNIX_EPOCH) {
            Ok(d) => {
                false.encode(e)?;
                d.encode(e)
            }
            Err(v) => {
                true.encode(e)?;
                v.duration().encode(e)
            }
        }
    }
}
macro_rules! fields {
    ($ty:ty, $($field:ident),+ $(,)?) => { impl Encode for $ty { fn encode(&self,e:&mut Encoder<'_>)->storage::Result<()> { $(self.$field.encode(e)?;)+ Ok(()) } } };
}
macro_rules! variants {
    ($ty:ty, $($variant:ident => $name:literal),+ $(,)?) => { impl Encode for $ty { fn encode(&self,e:&mut Encoder<'_>)->storage::Result<()> { match self { $(Self::$variant => $name.encode(e)),+ } } } };
}
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
fields!(
    jobs::AppliedWrite,
    external_id,
    source_updated_at,
    observation
);
fields!(
    jobs::ObservedWriteEvidence,
    response_digest,
    readback_digest,
    observed_at
);
fields!(
    jobs::JobSnapshot,
    job_id,
    receipt,
    partition,
    status,
    attempts,
    created_at,
    updated_at,
    next_attempt_at,
    applied,
    failure,
    remote_activity,
    unknown_scope_fence_retained,
    storage_liability,
    body_accepted
);
fields!(
    jobs::Lease,
    job_id,
    fence,
    expires_at,
    owner_id,
    physical_identity
);
fields!(
    jobs::LeasedJob,
    lease,
    request,
    attempt,
    canonical_scope,
    pending_byte_liability
);
fields!(
    storage::NativeJournalReceipt,
    native_payload_digest,
    journal_evidence_digest
);
variants!(jobs::ResourceKind, Entity=>"entity", Location=>"location", Tag=>"tag", Template=>"template", EntityType=>"entity-type", Field=>"field", File=>"file", Maintenance=>"maintenance");
variants!(jobs::JobStatus, Prepared=>"prepared", Queued=>"queued", Running=>"running", RetryScheduled=>"retry-scheduled", Succeeded=>"succeeded", Failed=>"failed", NeedsReconciliation=>"needs-reconciliation", Partial=>"partial", ResolvedObserved=>"resolved-observed", ResolvedByHuman=>"resolved-by-human");
variants!(jobs::FailureCode, Unavailable=>"unavailable", RateLimited=>"rate-limited", Rejected=>"rejected", AccessDenied=>"access-denied", InvalidPreparedPayload=>"invalid-prepared-payload", OutcomeUnknown=>"outcome-unknown", LeaseExpired=>"lease-expired", AdmissionWaitExpired=>"admission-wait-expired");
variants!(jobs::MetadataCommitEvidence, NotDispatched=>"not-dispatched", ObservedNotCommitted=>"observed-not-committed", ObservedCommitted=>"observed-committed", Unknown=>"unknown");
variants!(jobs::ByteDisposition, None=>"none", RetainedUnbound=>"retained-unbound", RetainedBound=>"retained-bound", Unknown=>"unknown");
variants!(jobs::ReferenceClosureEvidence, Unassessed=>"unassessed", Incomplete=>"incomplete", OperatorEvidenced=>"operator-evidenced");
impl Encode for jobs::JobId {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        self.0.encode(e)
    }
}
impl Encode for jobs::ScopeSelection {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self {
            Self::Collection => "collection".encode(e),
            Self::Resources(v) => {
                "resources".encode(e)?;
                v.encode(e)
            }
        }
    }
}
impl Encode for jobs::ProfileQualification {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self {
            Self::OfflineEngineeringFixture => "offline-engineering-fixture".encode(e),
            Self::QualifiedDeployment { evidence_digest } => {
                "qualified-deployment".encode(e)?;
                evidence_digest.encode(e)
            }
        }
    }
}
impl Encode for jobs::ByteAccounting {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self {
            Self::Complete {
                known_bytes,
                reserved_bytes,
            } => {
                "complete".encode(e)?;
                known_bytes.encode(e)?;
                reserved_bytes.encode(e)
            }
            Self::Incomplete { known_bytes } => {
                "incomplete".encode(e)?;
                known_bytes.encode(e)
            }
        }
    }
}
impl Encode for jobs::RemoteActivity {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self {
            Self::NotDispatched => "not-dispatched".encode(e),
            Self::Invoked(v) => {
                "invoked".encode(e)?;
                v.encode(e)
            }
        }
    }
}
impl Encode for jobs::InvokedRemoteActivity {
    fn encode(&self, e: &mut Encoder<'_>) -> storage::Result<()> {
        match self {
            Self::Active => "active".encode(e),
            Self::EndUnproven => "end-unproven".encode(e),
            Self::EndedProven {
                termination_evidence_digest,
            } => {
                "ended-proven".encode(e)?;
                termination_evidence_digest.encode(e)
            }
        }
    }
}

fn original(value: &stock::ValidatedRequest, e: &mut Encoder<'_>) -> storage::Result<()> {
    e.json(value.raw())?;
    value.id().as_str().encode(e)?;
    e.json(value.context())?;
    value.request_id().encode(e)?;
    value.intent_digest().encode(e)?;
    // This producer is specifically an original native upload. Refuse rather
    // than invent encodings for unrelated route families or batch children.
    let stock::Route::HomeboxNative(route) = value.route() else {
        return Err(unavailable());
    };
    let method = match route.method {
        stock::Method::Get => "GET",
        stock::Method::Post => "POST",
        stock::Method::Put => "PUT",
        stock::Method::Delete => "DELETE",
        stock::Method::Patch => "PATCH",
        stock::Method::PatchOrPut => "PATCH_OR_PUT",
    };
    method.encode(e)?;
    route.path.encode(e)?;
    if !value.children().is_empty() {
        return Err(unavailable());
    }
    0usize.encode(e)
}
fn native_facts(
    command: &native::StockCommand,
    authority: &native::StockAuthority,
    plan: &native::NativePlan,
    preflight: &native::StockPreflight,
    owner_preflight: &native::StockPreflight,
    digest: &native::Digest,
    e: &mut Encoder<'_>,
) -> storage::Result<()> {
    e.json(command)?;
    native_authority(authority, e)?;
    e.json(plan)?;
    native_preflight(preflight, e)?;
    native_preflight(owner_preflight, e)?;
    digest.encode(e)
}
fn native_authority(v: &native::StockAuthority, e: &mut Encoder<'_>) -> storage::Result<()> {
    e.json(&v.actor_id)?;
    v.source_epoch.encode(e)?;
    v.authority_digest.encode(e)?;
    e.json(&v.physical_binding.deployment_id)?;
    e.json(&v.physical_binding.physical_database_id)?;
    v.physical_binding.configuration_digest.encode(e)?;
    match &v.qualification {
        native::NativeQualification::SyntheticFixture => "synthetic-fixture".encode(e),
        native::NativeQualification::Qualified {
            catalog_digest,
            registered_build_digest,
            route_qualification_digest,
        } => {
            "qualified".encode(e)?;
            catalog_digest.encode(e)?;
            registered_build_digest.encode(e)?;
            route_qualification_digest.encode(e)
        }
    }
}
fn native_preflight(v: &native::StockPreflight, e: &mut Encoder<'_>) -> storage::Result<()> {
    v.preparation.snapshots.len().encode(e)?;
    for s in &v.preparation.snapshots {
        e.json(&s.target)?;
        e.json(&s.value)?;
        s.digest.encode(e)?;
        s.complete.encode(e)?;
        s.hidden_fields_preserved.encode(e)?;
    }
    e.json(&v.preparation.staged_upload)?;
    v.preparation.native_clear_values.len().encode(e)?;
    for c in &v.preparation.native_clear_values {
        c.command_id.encode(e)?;
        c.field.encode(e)?;
        e.json(&c.native_value)?;
        e.json(&c.native_readback_value)?;
    }
    e.json(&v.provider_observation)?;
    v.request_digest.encode(e)?;
    v.source_epoch.encode(e)?;
    v.preflight_digest.encode(e)
}
fn storage_facts(
    h: &RecordedQueuedUploadOriginalHistory,
    e: &mut Encoder<'_>,
) -> storage::Result<()> {
    let s = h.storage();
    original(s.original(), e)?;
    s.config().encode(e)?;
    s.request().encode(e)?;
    s.scope().encode(e)?;
    s.enqueue_snapshot().encode(e)?;
    s.initial_claim().encode(e)?;
    s.prepared().codec.encode(e)?;
    s.prepared().storage_liability.encode(e)?;
    s.journal_receipt().encode(e)
}
fn media_facts(
    h: &RecordedQueuedUploadOriginalHistory,
    e: &mut Encoder<'_>,
) -> storage::Result<()> {
    let m = h.media();
    original(m.original(), e)?;
    native_facts(
        m.command(),
        m.authority(),
        m.plan(),
        m.preflight(),
        m.owner_preflight(),
        m.capture_digest(),
        e,
    )?;
    let s = m.snapshot();
    e.json(s.scope())?;
    e.json(s.target())?;
    s.path().encode(e)?;
    s.query().encode(e)?;
    s.observed_at().encode(e)?;
    s.digest().encode(e)?;
    m.ordered_impact().len().encode(e)?;
    for impact in m.ordered_impact() {
        impact.partition().encode(e)?;
        impact.entity_id().encode(e)?;
        e.json(impact.staged_upload())?;
        impact.snapshot_digest().encode(e)?;
    }
    e.json(m.source_reference())?;
    m.queue_config().encode(e)?;
    m.enqueue_request().encode(e)?;
    m.canonical_scope().encode(e)?;
    m.prepared().codec.encode(e)?;
    m.prepared().storage_liability.encode(e)?;
    m.pending_byte_liability().encode(e)?;
    e.json(m.staged_upload())?;
    m.measured_byte_size().encode(e)
}
fn source_facts(
    h: &RecordedQueuedUploadOriginalHistory,
    e: &mut Encoder<'_>,
) -> storage::Result<()> {
    let s = h.source();
    original(s.original(), e)?;
    native_facts(
        s.command(),
        s.authority(),
        s.plan(),
        s.preflight(),
        s.owner_preflight(),
        s.capture_digest(),
        e,
    )?;
    let metadata = s.source_metadata();
    metadata.access_epoch().encode(e)?;
    metadata.source_registration_version().encode(e)?;
    metadata.source_registration_sha256().encode(e)?;
    e.json(metadata.registration())?;
    e.json(s.source_reference())?;
    e.json(s.partition())?;
    s.observed_actor().encode(e)?;
    s.observed_workspace().encode(e)?;
    s.observed_home().encode(e)?;
    e.json(&s.observed_role())?;
    let snap = s.snapshot();
    let raw = snap.original();
    e.json(&raw.scope)?;
    e.json(&raw.target)?;
    raw.path.encode(e)?;
    raw.query.encode(e)?;
    raw.observed_at.encode(e)?;
    e.json(snap.source())?;
    e.json(snap.snapshot_value())?;
    snap.digest().encode(e)?;
    snap.method().encode(e)?;
    snap.status().encode(e)?;
    let limits = snap.original_decode_limits();
    limits.max_response_bytes.encode(e)?;
    limits.max_entries.encode(e)?;
    limits.max_text_chars.encode(e)?;
    let install = s.installation();
    let d = install.descriptor();
    d.installed_release.encode(e)?;
    d.source_commit.encode(e)?;
    d.executable_sha256.encode(e)?;
    e.json(&d.context)?;
    e.json(&d.owner)?;
    d.account_id.encode(e)?;
    d.group_id.encode(e)?;
    native_authority(&d.authority, e)?;
    d.policy_id.encode(e)?;
    d.policy_version.encode(e)?;
    d.policy_epoch.encode(e)?;
    d.policy_digest.encode(e)?;
    d.allowed_types.encode(e)?;
    d.maximum_bytes.encode(e)?;
    d.freshness.encode(e)?;
    e.json(install.reviewed_policy())?;
    install.catalog_digest().encode(e)?;
    install.route_digest().encode(e)?;
    install.artifacts().len().encode(e)?;
    for artifact in install.artifacts() {
        use native::QueuedUploadHistoricalArtifactRole as R;
        let role = match artifact.role() {
            R::Executable => "executable",
            R::BuildProvenance => "build-provenance",
            R::EffectiveConfiguration => "effective-configuration",
            R::ReviewedSource => "reviewed-source",
        };
        role.encode(e)?;
        artifact.logical_pin().is_some().encode(e)?;
        if let Some(pin) = artifact.logical_pin() {
            pin.encode(e)?;
        }
        artifact.digest().encode(e)?;
        artifact.retrieved_at().encode(e)?;
        for f in [artifact.before(), artifact.after()] {
            f.device().encode(e)?;
            f.inode().encode(e)?;
            f.length().encode(e)?;
            f.modified_seconds().encode(e)?;
            f.modified_nanoseconds().encode(e)?;
            f.is_file().encode(e)?;
        }
    }
    Ok(())
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Original upload publication frame unavailable",
    )
}

/// Exact bounded encoding of independently supplied queue configuration, DATA
/// only. The actual catalog owner checks complete registry semantics separately.
pub(crate) fn queue_registry_frame_bytes(
    configs: &[jobs::QueueConfig],
    budget: &WorkBudget,
) -> storage::Result<Vec<u8>> {
    check(budget)?;
    let mut out = Encoder::new(budget);
    out.limit = 4 * 1024 * 1024;
    configs.encode(&mut out)?;
    check(budget)?;
    Ok(out.bytes)
}
