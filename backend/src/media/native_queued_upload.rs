//! Descriptor-backed HomeBox upload binding, measured dispatch-body custody
//! and retained preparation DATA validation. This issues no queue admission/
//! Release, invocation/header/native-effect, historical reconstruction or output
//! grant. Reopened reservation DATA cannot
//! reconstruct a live stage. Errors never imply rollback or retry authority.
use rustix::fs::{self as rfs, Mode, OFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{File, Metadata},
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use uuid::Uuid;

use super::{
    MAX_BYTES, MediaError, MediaResult, WorkBudget, content,
    native::{RetainedPrincipal, access_error},
    platform_fs,
    private_fs::PrivateDir,
    types::{ContentType, sha256},
};
use crate::{
    access as a,
    domain::queue_recovery::{
        QueuedMediaRecovery, RetainedAttempt, RetainedEnqueue, RetainedOutcome,
    },
    domain::stock::{
        self as domain, GraphAuthorization, NativeQueueOriginalGraph,
        NativeQueueOriginalPreparation, ValidatedRequest,
    },
    jobs,
    providers::homebox::{read, write::stock as native},
    storage::{self as s, RecordedOriginalUploadEnqueueProof},
};

mod admission;
mod bind;
mod custody;
mod dispatch;
mod facts;
mod guards;
mod historical;
mod original;
mod prepared;
mod prepared_codec;
mod stage;

use custody::{body_name, reservation_name};
use guards::{authorize_original, check_metadata, read_revalidated_body, revalidate_body};
use original::claim_reservation;
use prepared_codec::encode_upload_prepared;

pub const MAX_QUEUED_UPLOAD_STAGES: usize = 64;
pub const MAX_QUEUED_UPLOAD_RESERVED_BYTES: usize = 40 * 1024 * 1024;
const MAX_RESERVATION_BYTES: usize = 32 * 1024;
const MAX_ORIGINAL_FACT_BYTES: usize = 1024 * 1024;
const MAX_QUEUE_ALIASES: usize = 64;
const RESERVATION_FORMAT: &str = "houseatlas-homebox-upload-reservation/1";
pub const NATIVE_QUEUED_UPLOAD_PREPARED_CODEC: &str = "houseatlas-homebox-upload-queued-prepared/1";
const QUEUED_UPLOAD_MEDIA_FORMAT: &str = "houseatlas-homebox-upload-queued-media/1";
const MAX_PREPARED_FIELD_BYTES: usize = 1024 * 1024;

/// Caller metadata is DATA. Filename and framing are checked against measured
/// bytes; MIME alone never qualifies a stage or a source owner.
pub struct NativeQueuedUploadMetadata {
    pub content_type: ContentType,
    pub filename: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReservationData {
    format: String,
    actor_id: String,
    source: a::SourceRef,
    staged: native::StagedUpload,
}
#[derive(PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    size: u64,
    mode: u32,
    owner: u32,
    modified: i64,
    modified_ns: i64,
    changed: i64,
    changed_ns: i64,
}
impl FileIdentity {
    fn of(metadata: &Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            size: metadata.len(),
            mode: metadata.mode(),
            owner: metadata.uid(),
            modified: metadata.mtime(),
            modified_ns: metadata.mtime_nsec(),
            changed: metadata.ctime(),
            changed_ns: metadata.ctime_nsec(),
        }
    }
}
struct StageOwner {
    directory: PrivateDir,
    custody: Mutex<()>,
}
struct DirectoryLock<'a>(&'a File);
impl Drop for DirectoryLock<'_> {
    fn drop(&mut self) {
        let _ = rfs::flock(self.0, rfs::FlockOperation::Unlock);
    }
}
struct ReadMember {
    file: File,
    bytes: Vec<u8>,
    identity: FileIdentity,
}
#[derive(PartialEq, Eq)]
struct CatalogMember {
    id: String,
    reservation: FileIdentity,
    body: Option<FileIdentity>,
}
#[derive(PartialEq, Eq)]
struct Catalog {
    members: Vec<CatalogMember>,
    reserved_bytes: usize,
}

// This allocation is issued only after reservation+body durability and final
// original source checks. Files and metadata cannot reconstruct its identity.
struct UploadIssuer;
struct StageCustody {
    issuer: Arc<UploadIssuer>,
    owner: Arc<StageOwner>,
    staged: native::StagedUpload,
    reservation_bytes: Vec<u8>,
    reservation_identity: FileIdentity,
    body: File,
    body_bytes: Vec<u8>,
    body_identity: FileIdentity,
}

/// Live stage retains the same actual principal and BORROWED original grant
/// allocation for binding. No Clone, serde, public DATA constructor or token
/// lookup can reconstruct it. Binding consumes it exactly once.
pub struct NativeQueuedUploadStage<'grant> {
    original: RetainedPrincipal,
    source: &'grant a::SourceGrant,
    custody: Arc<StageCustody>,
}

/// Owned original-stage source preparation. This retains actual custody and the
/// exact borrowed original grant, without exposing body, path or custody.
/// No Clone, serde or public constructor exists. It establishes no queue,
/// dispatch, historical, current-native or physical registration authority.
pub struct NativeQueuedUploadSourcePreparation<'grant> {
    custody: Arc<StageCustody>,
    original: RetainedPrincipal,
    source: &'grant a::SourceGrant,
}

/// Borrowed current-stage evidence, retaining the actual original phase and
/// custody without retaining Media locks. No Clone, serde, public constructor,
/// body/path access or detached custody ownership is provided.
///
/// Store -> Access -> Media nonblocking locking is permitted. No Source mutex
/// may be held while checking this carrier; no Source/Store callback or reentry
/// occurs while Media locks are held. Final Access checks follow lock release.
pub struct CurrentNativeQueuedUploadStage<'stage, 'phase, 'tx> {
    custody: &'stage StageCustody,
    original: &'stage RetainedPrincipal,
    source: &'stage a::SourceGrant,
    guard: &'phase a::TransactionAuthorization<'tx>,
    budget: &'phase WorkBudget,
}

/// Actual preprovisioned 0700 descriptor custody. New opens can account existing
/// charged DATA but cannot adopt it into a live stage. Capacity is serialized
/// by local try-lock AND nonblocking descriptor flock across independent opens.
/// No pruning/maintenance or rollback is performed, including after body errors.
pub struct NativeQueuedUploadStages {
    owner: Arc<StageOwner>,
}
enum OriginalBindPhase<'phase, 'p> {
    Ordinary,
    QueuedUpload(
        &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<'phase, 'p>,
    ),
}

/// Exact immutable native snapshot facts captured from the actual qualified
/// preparation. No DATA constructor or live source/grant is retained here.
pub struct NativeQueuedUploadSnapshot {
    original: Vec<u8>,
    scope: read::SourceScope,
    target: native::StockTarget,
    path: String,
    query: Vec<(String, String)>,
    observed_at: String,
    digest: native::Digest,
}
pub struct NativeQueuedUploadImpact {
    partition: jobs::SourcePartition,
    entity_id: String,
    staged: native::StagedUpload,
    snapshot_digest: native::Digest,
}
/// Opaque detached positive admission for the measured nonzero body. Identity
/// comes from actual stage custody, not from pending-byte DTO fields.
pub struct NativeQueuedUploadKnownNonzeroAdmission {
    issuer: Arc<UploadIssuer>,
    pending: jobs::PendingByteLiability,
}
struct InstalledQueuedUploadIssuer;

/// Pure correlation of the closed installed producer selection and this exact
/// cut. No Clone, serde or public constructor exists. This is not queue/current
/// authority, restore, disclosure, native-write or recovery evidence. A later
/// owner must independently issue genuine fresh enqueue and claim/Release proof.
pub struct InstalledNativeQueuedUploadOrigin<'cut> {
    original: &'cut NativeQueuedUploadOriginal,
    installed_issuer: &'cut Arc<InstalledQueuedUploadIssuer>,
    custody: &'cut Arc<StageCustody>,
    custody_issuer: &'cut Arc<UploadIssuer>,
}

/// Detached original facts plus actual immutable body descriptors. No Clone,
/// serde, Access/grants/session/provider/SQL handles or current authorization.
/// Root must retain the actual original native/Domain preparation for later live
/// enqueue/Release. No historical queue proof is issued by this stage producer.
pub struct NativeQueuedUploadOriginal {
    installed_issuer: Option<Arc<InstalledQueuedUploadIssuer>>,
    custody: Arc<StageCustody>,
    known_nonzero: NativeQueuedUploadKnownNonzeroAdmission,
    source_reference: a::SourceRef,
    original: ValidatedRequest,
    command: native::StockCommand,
    plan: native::NativePlan,
    authority: native::StockAuthority,
    preflight: native::StockPreflight,
    owner_preflight: native::StockPreflight,
    snapshot: NativeQueuedUploadSnapshot,
    capture_digest: native::Digest,
    ordered_impact: Vec<NativeQueuedUploadImpact>,
    queue_config: jobs::QueueConfig,
    enqueue_request: jobs::EnqueueRequest,
    canonical_scope: jobs::CanonicalScope,
}

struct UploadPreparedIdentity;
struct UploadPreparedIssuer {
    identity: Arc<UploadPreparedIdentity>,
    custody: Arc<StageCustody>,
    dispatch_body_taken: AtomicBool,
}

/// Captured only from the live original admission and its actual current
/// installed phase. No Clone, serde, public DATA constructor, raw upload body,
/// private filesystem path or descriptor access. Prepared bytes include exact
/// native request route/metadata comparison DATA and cannot reconstruct this token.
pub struct NativeQueuedUploadPrepared {
    upload: Arc<NativeQueuedUploadOriginal>,
    issuer: Arc<UploadPreparedIssuer>,
    prepared: s::PreparedNativeIntent,
}

/// Borrowed original plan/stage/intent DATA after exact retained validation.
/// No Clone, serde, public constructor or current/dispatch authority.
pub struct NativeQueuedUploadDecoded<'a> {
    native: &'a NativeQueuedUploadPrepared,
}

/// Comparison/work inputs only; these bounds issue no proof or authority.
pub struct NativeQueuedUploadDispatchBounds<'budget> {
    pub max_bytes: usize,
    pub deadline: Instant,
    pub budget: &'budget WorkBudget,
}

/// One-shot measured local body custody, with no permit, headers, provider
/// authority or public DATA constructor. Failure consumes the opportunity.
pub struct NativeQueuedUploadDispatchBody {
    native: Arc<NativeQueuedUploadPrepared>,
    bytes: Vec<u8>,
    deadline: Instant,
    effective_deadline: Instant,
}

/// Owned historical comparison facts from genuine released original cuts.
/// Only pure issuer markers survive: no stage custody, descriptors, upload
/// body, live principal/grant/Source/configuration owner or prepared owner.
/// No Clone, serde, DATA constructor, current/discovery/dispatch or cold-start
/// authority. This does not infer NeverInvoked, remote end or optional Finish.
/// Copy bounds: owner raw <=10 MiB, two prepared fields <=2 MiB total,
/// reservation <=32 KiB, and all auxiliary facts share a <=1 MiB budget.
pub struct NativeQueuedUploadHistoricalMedia {
    original_issuer: Arc<UploadIssuer>,
    installed_issuer: Arc<InstalledQueuedUploadIssuer>,
    prepared_identity: Arc<UploadPreparedIdentity>,
    original: ValidatedRequest,
    command: native::StockCommand,
    authority: native::StockAuthority,
    plan: native::NativePlan,
    preflight: native::StockPreflight,
    owner_preflight: native::StockPreflight,
    snapshot: NativeQueuedUploadSnapshot,
    capture_digest: native::Digest,
    ordered_impact: Vec<NativeQueuedUploadImpact>,
    source_reference: a::SourceRef,
    queue_config: jobs::QueueConfig,
    enqueue_request: jobs::EnqueueRequest,
    canonical_scope: jobs::CanonicalScope,
    prepared: s::PreparedNativeIntent,
    pending: jobs::PendingByteLiability,
    staged: native::StagedUpload,
    reservation_bytes: Vec<u8>,
    measured_byte_size: u64,
}

#[derive(Serialize)]
struct UploadPreparedPayload<'a> {
    format: &'static str,
    native_source_commit: &'static str,
    contract_version: &'static str,
    original_wire: &'a Value,
    plan: &'a native::NativePlan,
}
#[derive(Serialize)]
struct UploadPreparedPartition<'a> {
    workspace_id: &'a str,
    home_id: &'a str,
    source_instance_id: &'a str,
    collection_id: &'a str,
}
#[derive(Serialize)]
struct UploadPreparedImpact<'a> {
    partition: UploadPreparedPartition<'a>,
    entity_id: &'a str,
    staged: &'a native::StagedUpload,
    snapshot_digest: &'a native::Digest,
}
#[derive(Serialize)]
struct UploadPreparedMedia<'a> {
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
    ordered_impact: [UploadPreparedImpact<'a>; 1],
}
struct PreparedFieldWriter<'a> {
    bytes: Vec<u8>,
    budget: &'a WorkBudget,
}

// Counting writer: no temporary serialized copy can grow beyond the shared
// 1 MiB total detached-facts budget. This measures borrowed facts, not authority.
struct FactBudget<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
