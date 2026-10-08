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
impl StageOwner {
    fn check(&self) -> MediaResult<()> {
        self.directory.check()?;
        let descriptor = self.directory.file.metadata()?;
        let named = std::fs::symlink_metadata(&self.directory.path)?;
        for metadata in [&descriptor, &named] {
            if !metadata.is_dir()
                || metadata.mode() & 0o7777 != 0o700
                || metadata.uid() != rustix::process::geteuid().as_raw()
            {
                return Err(MediaError::Unavailable);
            }
        }
        if descriptor.dev() != named.dev() || descriptor.ino() != named.ino() {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }
    fn lock(&self) -> MediaResult<DirectoryLock<'_>> {
        self.check()?;
        rfs::flock(
            &self.directory.file,
            rfs::FlockOperation::NonBlockingLockExclusive,
        )
        .map_err(|_| MediaError::Unavailable)?;
        Ok(DirectoryLock(&self.directory.file))
    }
    fn read_member(
        &self,
        name: &str,
        maximum: usize,
        budget: &WorkBudget,
    ) -> MediaResult<ReadMember> {
        budget.check()?;
        self.check()?;
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
        let file = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::empty(),
        )?);
        let mut reader = &file;
        let metadata = file.metadata()?;
        check_file(&metadata, maximum)?;
        let before = FileIdentity::of(&metadata);
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let mut buffer = [0u8; 64 * 1024];
        loop {
            budget.check()?;
            let count = reader.read(&mut buffer)?;
            budget.check()?;
            if count == 0 {
                break;
            }
            if count > maximum.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let after = file.metadata()?;
        check_file(&after, maximum)?;
        let named = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::empty(),
        )?)
        .metadata()?;
        check_file(&named, maximum)?;
        if before != FileIdentity::of(&after)
            || before != FileIdentity::of(&named)
            || before.size != bytes.len() as u64
        {
            return Err(MediaError::Unavailable);
        }
        self.check()?;
        budget.check()?;
        Ok(ReadMember {
            file,
            bytes,
            identity: before,
        })
    }
    /// Full stable capacity DATA; abandoned reservations and missing/partial
    /// bodies stay charged. Unknown names or incomplete reservation JSON make
    /// the entire owner unavailable. No file scan issues a stage or admission.
    fn scan(&self, budget: &WorkBudget) -> MediaResult<Catalog> {
        budget.check()?;
        self.check()?;
        let before = FileIdentity::of(&self.directory.file.metadata()?);
        let mut pairs: BTreeMap<String, (bool, bool)> = BTreeMap::new();
        let mut directory = rfs::Dir::read_from(&self.directory.file)?;
        while let Some(entry) = directory.read() {
            budget.check()?;
            let entry = entry?;
            let name = entry
                .file_name()
                .to_str()
                .map_err(|_| MediaError::Unavailable)?;
            if name == "." || name == ".." {
                continue;
            }
            let (id, reservation) = if let Some(id) = name.strip_suffix(".reservation.json") {
                (id, true)
            } else if let Some(id) = name.strip_suffix(".body") {
                (id, false)
            } else {
                return Err(MediaError::Unavailable);
            };
            if !canonical_uuid(id) {
                return Err(MediaError::Unavailable);
            }
            let pair = pairs.entry(id.to_owned()).or_default();
            if reservation {
                if pair.0 {
                    return Err(MediaError::Unavailable);
                }
                pair.0 = true;
            } else {
                if pair.1 {
                    return Err(MediaError::Unavailable);
                }
                pair.1 = true;
            }
            if pairs.len() > MAX_QUEUED_UPLOAD_STAGES {
                return Err(MediaError::TooLarge);
            }
        }
        let mut total = 0usize;
        let mut members = Vec::with_capacity(pairs.len());
        for (id, (reservation, body)) in pairs {
            budget.check()?;
            if !reservation {
                return Err(MediaError::Unavailable);
            }
            let retained =
                self.read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
            let data: ReservationData =
                serde_json::from_slice(&retained.bytes).map_err(|_| MediaError::Unavailable)?;
            validate_reservation(&data, &id)?;
            total = total
                .checked_add(data.staged.byte_size as usize)
                .ok_or(MediaError::TooLarge)?;
            if total > MAX_QUEUED_UPLOAD_RESERVED_BYTES {
                return Err(MediaError::TooLarge);
            }
            let body = if body {
                let read =
                    self.read_member(&body_name(&id), data.staged.byte_size as usize, budget)?;
                Some(read.identity)
            } else {
                None
            };
            members.push(CatalogMember {
                id,
                reservation: retained.identity,
                body,
            });
        }
        self.check()?;
        budget.check()?;
        if before != FileIdentity::of(&self.directory.file.metadata()?) {
            return Err(MediaError::Unavailable);
        }
        Ok(Catalog {
            members,
            reserved_bytes: total,
        })
    }
    fn write_new(&self, name: &str, bytes: &[u8], budget: &WorkBudget) -> MediaResult<()> {
        budget.check()?;
        self.check()?;
        let flags = OFlags::WRONLY
            | OFlags::CREATE
            | OFlags::EXCL
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::CLOEXEC;
        let mut file = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::RUSR | Mode::WUSR,
        )?);
        // Preserve inherited process settings while requiring exact private mode
        // on this descriptor. Any failure leaves this new reservation/body DATA.
        rfs::fchmod(&file, Mode::RUSR | Mode::WUSR)?;
        for chunk in bytes.chunks(64 * 1024) {
            budget.check()?;
            file.write_all(chunk)?;
            budget.check()?;
        }
        platform_fs::sync(&file)?;
        self.directory.sync()?;
        self.check()?;
        budget.check()
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
impl<'grant> NativeQueuedUploadStage<'grant> {
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    /// Borrow this actual stage under its original mutation phase. Principal
    /// and grant DATA copies cannot substitute for the original allocations.
    pub fn current_under_guard<'stage, 'phase, 'tx>(
        &'stage self,
        guard: &'phase a::TransactionAuthorization<'tx>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &'phase WorkBudget,
    ) -> MediaResult<CurrentNativeQueuedUploadStage<'stage, 'phase, 'tx>> {
        if !std::ptr::eq(self.original.principal(), original.principal())
            || !std::ptr::eq(self.source, source)
        {
            return Err(MediaError::Forbidden);
        }
        let current = CurrentNativeQueuedUploadStage {
            custody: &self.custody,
            original: &self.original,
            source: self.source,
            guard,
            budget,
        };
        current.revalidate()?;
        Ok(current)
    }

    /// Retain this actual stage's source preparation after checking its current
    /// original phase. The host must retain this proof in the same sealed native
    /// Source preparation; Media alone cannot establish a generic Source owner.
    pub fn issue_source_preparation_under_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadSourcePreparation<'grant>> {
        {
            let _current = self.current_under_guard(guard, original, source, budget)?;
        }
        Ok(NativeQueuedUploadSourcePreparation {
            custody: Arc::clone(&self.custody),
            original: self.original.clone(),
            source: self.source,
        })
    }
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
impl NativeQueuedUploadSourcePreparation<'_> {
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    pub fn source_reference(&self) -> &a::SourceRef {
        self.source.reference()
    }

    /// Allocation correlation only; callers must separately check current
    /// original guard authority and genuine sealed Source ownership.
    pub fn matches_stage(&self, stage: &NativeQueuedUploadStage<'_>) -> bool {
        Arc::ptr_eq(&self.custody, &stage.custody)
            && Arc::ptr_eq(&self.custody.issuer, &stage.custody.issuer)
            && std::ptr::eq(self.original.principal(), stage.original.principal())
            && std::ptr::eq(self.source, stage.source)
    }

    pub fn current_under_guard<'owner, 'phase, 'tx>(
        &'owner self,
        guard: &'phase a::TransactionAuthorization<'tx>,
        original: &RetainedPrincipal,
        source: &a::SourceGrant,
        budget: &'phase WorkBudget,
    ) -> MediaResult<CurrentNativeQueuedUploadStage<'owner, 'phase, 'tx>> {
        if !std::ptr::eq(self.original.principal(), original.principal())
            || !std::ptr::eq(self.source, source)
        {
            return Err(MediaError::Forbidden);
        }
        let current = CurrentNativeQueuedUploadStage {
            custody: &self.custody,
            original: &self.original,
            source: self.source,
            guard,
            budget,
        };
        current.revalidate()?;
        Ok(current)
    }
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
impl CurrentNativeQueuedUploadStage<'_, '_, '_> {
    /// Comparison DATA; this getter does not detach current-stage authority.
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }

    /// Comparison DATA for the exact retained original grant.
    pub fn source_reference(&self) -> &a::SourceRef {
        self.source.reference()
    }

    pub fn revalidate(&self) -> MediaResult<()> {
        self.budget.check()?;
        authorize_original(self.guard, self.original, self.source)?;
        {
            let _local_custody = self
                .custody
                .owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory_custody = self.custody.owner.lock()?;
            let before = self.custody.owner.scan(self.budget)?;
            revalidate_body(self.custody, self.budget)?;
            if before != self.custody.owner.scan(self.budget)? {
                return Err(MediaError::Unavailable);
            }
        }
        authorize_original(self.guard, self.original, self.source)?;
        self.budget.check()
    }
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
impl NativeQueuedUploadStages {
    pub fn open(path: &Path) -> MediaResult<Self> {
        let owner = Arc::new(StageOwner {
            directory: PrivateDir::open(path, false)?,
            custody: Mutex::new(()),
        });
        owner.check()?;
        Ok(Self { owner })
    }

    pub fn stage_under_guard<'grant, R: Read + ?Sized>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        source: &'grant a::SourceGrant,
        metadata: NativeQueuedUploadMetadata,
        input: &mut R,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadStage<'grant>> {
        budget.check()?;
        check_metadata(&metadata)?;
        authorize_original(guard, original, source)?;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            budget.check()?;
            let count = input.read(&mut buffer)?;
            budget.check()?;
            if count == 0 {
                break;
            }
            if count > MAX_BYTES.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        if bytes.is_empty() {
            return Err(MediaError::InvalidInput);
        }
        content::validate_original_content(&bytes, metadata.content_type, budget)?;
        authorize_original(guard, original, source)?;
        // Generate token only after measuring real bounded original body bytes.
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| MediaError::Unavailable)?;
        nonce[6] = (nonce[6] & 0x0f) | 0x40;
        nonce[8] = (nonce[8] & 0x3f) | 0x80;
        let token = Uuid::from_bytes(nonce);
        let staged = native::StagedUpload {
            upload_token: token,
            sha256: native::Digest::parse(sha256(&bytes)).map_err(|_| MediaError::InvalidInput)?,
            byte_size: bytes.len() as u64,
            content_type: metadata.content_type.as_str().into(),
            filename: metadata.filename,
        };
        let reservation = ReservationData {
            format: RESERVATION_FORMAT.into(),
            actor_id: original.principal().actor_id().as_str().into(),
            source: source.reference().clone(),
            staged: staged.clone(),
        };
        let reservation_bytes =
            serde_json::to_vec(&reservation).map_err(|_| MediaError::Unavailable)?;
        if reservation_bytes.len() > MAX_RESERVATION_BYTES {
            return Err(MediaError::TooLarge);
        }
        let local_custody = self
            .owner
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let directory_custody = self.owner.lock()?;
        let before = self.owner.scan(budget)?;
        if before.members.len() >= MAX_QUEUED_UPLOAD_STAGES
            || bytes.len() > MAX_QUEUED_UPLOAD_RESERVED_BYTES.saturating_sub(before.reserved_bytes)
        {
            return Err(MediaError::TooLarge);
        }
        let id = token.to_string();
        // Reservation is durable BEFORE body installation. All errors retain the
        // charged reservation (or fail-closed incomplete DATA), never delete it.
        self.owner
            .write_new(&reservation_name(&id), &reservation_bytes, budget)?;
        self.owner.write_new(&body_name(&id), &bytes, budget)?;
        let actual_reservation =
            self.owner
                .read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
        let actual_body = self.owner.read_member(&body_name(&id), MAX_BYTES, budget)?;
        if actual_reservation.bytes != reservation_bytes || actual_body.bytes != bytes {
            return Err(MediaError::Unavailable);
        }
        let after = self.owner.scan(budget)?;
        if after.members.len() != before.members.len() + 1
            || after.reserved_bytes != before.reserved_bytes + bytes.len()
            || before
                .members
                .iter()
                .any(|member| !after.members.contains(member))
            || !after.members.iter().any(|member| {
                member.id == id
                    && member.reservation == actual_reservation.identity
                    && member.body.as_ref() == Some(&actual_body.identity)
            })
        {
            return Err(MediaError::Unavailable);
        }
        drop(directory_custody);
        drop(local_custody);
        authorize_original(guard, original, source)?;
        budget.check()?;
        let custody = Arc::new(StageCustody {
            issuer: Arc::new(UploadIssuer),
            owner: Arc::clone(&self.owner),
            staged,
            reservation_bytes,
            reservation_identity: actual_reservation.identity,
            body: actual_body.file,
            body_bytes: bytes,
            body_identity: actual_body.identity,
        });
        Ok(NativeQueuedUploadStage {
            original: original.clone(),
            source,
            custody,
        })
    }

    /// Bind only with the same actual stage's source-preparation allocation.
    /// The production host must obtain `proof` from the same sealed native
    /// Source used by `bound`; this matcher cannot prove generic Source identity.
    /// Source/native callbacks are delegated only after Media locks release.
    #[allow(clippy::too_many_arguments)]
    pub fn bind_original_with_source_preparation<'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        proof: &NativeQueuedUploadSourcePreparation<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        budget.check()?;
        if !proof.matches_stage(&stage) {
            return Err(MediaError::Forbidden);
        }
        {
            let _current =
                proof.current_under_guard(guard, &stage.original, stage.source, budget)?;
        }
        self.bind_original(guard, stage, bound, config, budget)
    }

    /// Consume the stage using only the actual installed upload Source's E and
    /// the same Store-borrowed physical phase. No caller-selected proof/config
    /// or ordinary qualification fallback is accepted.
    pub fn bind_original_with_queued_upload_installation<
        'phase,
        'a,
        'p,
        'owner,
        'captured,
        W,
        G,
        F,
        C,
    >(
        &self,
        guard: &'phase a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<
            'a,
            'p,
            'owner,
            W,
            G,
            F,
            C,
            native::QueuedUploadSource<'captured, 'p>,
        >,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, native::QueuedUploadSource<'captured, 'p>>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
    {
        check_queued_upload_binding(
            guard,
            &stage.custody,
            &stage.original,
            stage.source,
            bound,
            physical,
            budget,
        )?;
        let mut original = self.bind_inner(
            guard,
            stage,
            bound,
            physical.queue_config(),
            budget,
            OriginalBindPhase::QueuedUpload(physical),
        )?;
        // The engine has released all Media locks before these Source/phase
        // checks. The SAME actual E still retains the original stage allocation.
        let proof = bound.native().capture().evidence().source_preparation();
        check_queued_upload_binding(
            guard,
            &original.custody,
            &proof.original,
            proof.source,
            bound,
            physical,
            budget,
        )?;
        budget.check()?;
        original.installed_issuer = Some(Arc::new(InstalledQueuedUploadIssuer));
        Ok(original)
    }

    /// Actual native/Domain original qualification is mandatory before and after
    /// binding. Consume the stage once; retain only detached descriptor custody
    /// and exact original facts. This issues no current Access/Store authority.
    pub fn bind_original<'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        self.bind_inner(
            guard,
            stage,
            bound,
            config,
            budget,
            OriginalBindPhase::Ordinary,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn bind_inner<'phase, 'a, 'p, 'owner, W, G, F, C, S>(
        &self,
        guard: &'phase a::TransactionAuthorization<'_>,
        stage: NativeQueuedUploadStage<'_>,
        bound: &NativeQueueOriginalPreparation<'a, 'p, 'owner, W, G, F, C, S>,
        config: &jobs::QueueConfig,
        budget: &WorkBudget,
        phase: OriginalBindPhase<'phase, 'p>,
    ) -> MediaResult<NativeQueuedUploadOriginal>
    where
        G: NativeQueueOriginalGraph<'owner, C, S>,
        F: GraphAuthorization<W, G>,
        C: native::StockContractPort + Sync,
        S: native::FreshPreparationSourcePort,
    {
        budget.check()?;
        if !Arc::ptr_eq(&self.owner, &stage.custody.owner)
            || !std::ptr::eq(stage.original.principal(), bound.captured().principal())
            || !bound
                .captured()
                .source_grants()
                .iter()
                .any(|source| std::ptr::eq(source, stage.source))
            || !bound
                .captured()
                .partition_grants()
                .iter()
                .any(|partition| partition.partition() == &stage.source.reference().partition())
        {
            return Err(MediaError::Forbidden);
        }
        authorize_original(guard, &stage.original, stage.source)?;
        match &phase {
            OriginalBindPhase::Ordinary => bound.revalidate(guard, bound.native().authority()),
            OriginalBindPhase::QueuedUpload(physical) => bound
                .revalidate_with_queued_upload_installation(
                    guard,
                    bound.native().authority(),
                    physical,
                ),
        }
        .map_err(|_| MediaError::Unavailable)?;
        let native = bound.native();
        let command = native.command();
        let request = bound.prepared().request();
        // Bound all detached request/native/configuration facts before any
        // clones or native mapping; the raw snapshot has its separate wire cap.
        let mut facts = FactBudget { bytes: 0, budget };
        facts.json(request.raw())?;
        facts.json(native.command())?;
        facts.json(native.plan())?;
        facts.preflight(native.preflight())?;
        facts.preflight(native.owner_preflight())?;
        facts.queue_config(config)?;
        let owner_entity = command
            .target
            .owner()
            .map_err(|_| MediaError::InvalidInput)?;
        let reference = stage.source.reference();
        if command.command_id != "homebox.file.upload"
            || request.id() != domain::OperationId::HomeboxFileUpload
            || request.raw() != &command.original_wire
            || !request.children().is_empty()
            || request.whole_collection_required()
            || command.target.resource_kind != native::ResourceKind::Attachment
            || command.target.resource_id.is_some()
            || owner_entity.is_nil()
            || !matches!(
                native.authority().qualification,
                native::NativeQualification::Qualified { .. }
            )
            || reference.key.external_id != owner_entity.to_string()
            || reference.key.source_instance_id.as_str()
                != command.target.source_instance_id.to_string()
            || reference.key.collection_id != command.target.collection_id.to_string()
            || reference.workspace_id.as_str() != command.context.workspace_id.to_string()
            || reference.home_id.as_str() != command.context.home_id.to_string()
            || native.preflight().preparation.staged_upload.as_ref() != Some(stage.staged_upload())
            || command.payload.get("staged")
                != Some(
                    &serde_json::to_value(stage.staged_upload())
                        .map_err(|_| MediaError::InvalidInput)?,
                )
            || native.capture().snapshots().len() != 1
            || native.preflight().preparation.snapshots.len() != 1
        {
            return Err(MediaError::InvalidInput);
        }
        let plan = native.plan();
        let path = format!("/api/v1/entities/{owner_entity}/attachments");
        if plan.request.method != native::NativeMethod::Post
            || plan.request.path != path
            || !plan.request.query.is_empty()
            || native::map_stock(command, &native.preflight().preparation)
                .map_err(|_| MediaError::InvalidInput)?
                != *plan
        {
            return Err(MediaError::InvalidInput);
        }
        let native::NativeBody::Multipart {
            file_field,
            stage: planned_stage,
            ..
        } = &plan.request.body
        else {
            return Err(MediaError::InvalidInput);
        };
        if file_field != "file" || planned_stage != stage.staged_upload() {
            return Err(MediaError::InvalidInput);
        }
        let decoded = &native.capture().snapshots()[0];
        let raw = decoded.original();
        let owner_target = command
            .target
            .owner_target()
            .map_err(|_| MediaError::InvalidInput)?;
        if raw.original.is_empty()
            || raw.original.len()
                > crate::providers::homebox::wire::DecodeLimits::default().max_response_bytes
            || raw.target != owner_target
            || raw.path != format!("/api/v1/entities/{owner_entity}")
            || !raw.query.is_empty()
            || raw.scope.workspace_id.as_str() != reference.workspace_id.as_str()
            || raw.scope.home_id.as_str() != reference.home_id.as_str()
            || raw.scope.source_instance_id.as_str() != reference.key.source_instance_id.as_str()
            || raw.scope.collection_id != reference.key.collection_id
            || native.preflight().preparation.snapshots[0].target != owner_target
            || !native.preflight().preparation.snapshots[0].complete
            || &native.preflight().preparation.snapshots[0].digest != decoded.digest()
            || &native.preflight().preparation.snapshots[0].value != decoded.snapshot_value()
        {
            return Err(MediaError::InvalidInput);
        }
        config.validate().map_err(|_| MediaError::InvalidInput)?;
        let physical = &native.authority().physical_binding;
        if config.registration.identity.deployment_id != physical.deployment_id.to_string()
            || config.registration.identity.physical_database_id
                != physical.physical_database_id.to_string()
            || config.registration.identity.configuration_digest.as_hex()
                != physical.configuration_digest.as_str()
        {
            return Err(MediaError::InvalidInput);
        }
        let raw_wire = request.raw();
        let partition = jobs::SourcePartition {
            workspace_id: exact_uuid(
                &raw_wire["context"]["workspaceId"],
                command.context.workspace_id,
            )?,
            home_id: exact_uuid(&raw_wire["context"]["homeId"], command.context.home_id)?,
            source_instance_id: exact_uuid(
                &raw_wire["target"]["sourceInstanceId"],
                command.target.source_instance_id,
            )?,
            collection_id: exact_uuid(
                &raw_wire["target"]["collectionId"],
                command.target.collection_id,
            )?,
        };
        let entity_id = exact_uuid(&raw_wire["target"]["entityId"], owner_entity)?;
        let write_scope = jobs::WriteScope {
            source_instance_id: partition.source_instance_id.clone(),
            collection_id: partition.collection_id.clone(),
            selection: jobs::ScopeSelection::Resources(vec![jobs::ResourceRef {
                kind: jobs::ResourceKind::Entity,
                id: entity_id.clone(),
            }]),
        };
        let canonical_scope = config
            .registration
            .resolve(&partition, &write_scope)
            .map_err(|_| MediaError::InvalidInput)?;
        let pending = jobs::PendingByteLiability {
            required: true,
            reserved_bytes: Some(stage.custody.staged.byte_size),
        };
        let enqueue = jobs::EnqueueRequest {
            receipt: jobs::ReceiptKey {
                workspace_id: partition.workspace_id.clone(),
                home_id: partition.home_id.clone(),
                actor_id: stage.original.principal().actor_id().as_str().into(),
                mutation_id: exact_uuid(&raw_wire["idempotencyKey"], command.idempotency_key)?,
            },
            partition: partition.clone(),
            intent: jobs::IntentMetadata {
                contract_id: crate::contracts::stock::CONTRACT_VERSION.into(),
                operation_id: command.command_id.clone(),
                target_external_id: Some(entity_id.clone()),
                request_digest: jobs::Digest::from_hex(command.request_digest.as_str().into())
                    .map_err(|_| MediaError::InvalidInput)?,
            },
            write_scope,
            pending_byte_liability: pending,
        };
        enqueue.validate().map_err(|_| MediaError::InvalidInput)?;
        let local_custody = self
            .owner
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let directory_custody = self.owner.lock()?;
        let before = self.owner.scan(budget)?;
        revalidate_body(&stage.custody, budget)?;
        if before != self.owner.scan(budget)? {
            return Err(MediaError::Unavailable);
        }
        drop(directory_custody);
        drop(local_custody);
        // A source qualifier may consult this actual stage producer. Never call
        // it while Media owner locks are held.
        match &phase {
            OriginalBindPhase::Ordinary => bound.revalidate(guard, native.authority()),
            OriginalBindPhase::QueuedUpload(physical) => bound
                .revalidate_with_queued_upload_installation(guard, native.authority(), physical),
        }
        .map_err(|_| MediaError::Unavailable)?;
        authorize_original(guard, &stage.original, stage.source)?;
        budget.check()?;
        let impact = NativeQueuedUploadImpact {
            partition,
            entity_id,
            staged: stage.custody.staged.clone(),
            snapshot_digest: decoded.digest().clone(),
        };
        let known_nonzero = NativeQueuedUploadKnownNonzeroAdmission {
            issuer: Arc::clone(&stage.custody.issuer),
            pending,
        };
        let original = NativeQueuedUploadOriginal {
            installed_issuer: None,
            custody: Arc::clone(&stage.custody),
            known_nonzero,
            source_reference: reference.clone(),
            original: request.clone(),
            command: command.clone(),
            plan: plan.clone(),
            authority: native.authority().clone(),
            preflight: native.preflight().clone(),
            owner_preflight: native.owner_preflight().clone(),
            snapshot: NativeQueuedUploadSnapshot {
                original: raw.original.clone(),
                scope: raw.scope.clone(),
                target: raw.target.clone(),
                path: raw.path.clone(),
                query: raw.query.clone(),
                observed_at: raw.observed_at.clone(),
                digest: decoded.digest().clone(),
            },
            capture_digest: native.capture().capture_digest().clone(),
            ordered_impact: vec![impact],
            queue_config: config.clone(),
            enqueue_request: enqueue,
            canonical_scope,
        };
        budget.check()?;
        Ok(original)
    }
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
impl NativeQueuedUploadSnapshot {
    pub fn original(&self) -> &[u8] {
        &self.original
    }
    pub fn scope(&self) -> &read::SourceScope {
        &self.scope
    }
    pub fn target(&self) -> &native::StockTarget {
        &self.target
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn query(&self) -> &[(String, String)] {
        &self.query
    }
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    pub fn digest(&self) -> &native::Digest {
        &self.digest
    }
}
pub struct NativeQueuedUploadImpact {
    partition: jobs::SourcePartition,
    entity_id: String,
    staged: native::StagedUpload,
    snapshot_digest: native::Digest,
}
impl NativeQueuedUploadImpact {
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
/// Opaque detached positive admission for the measured nonzero body. Identity
/// comes from actual stage custody, not from pending-byte DTO fields.
pub struct NativeQueuedUploadKnownNonzeroAdmission {
    issuer: Arc<UploadIssuer>,
    pending: jobs::PendingByteLiability,
}
impl NativeQueuedUploadKnownNonzeroAdmission {
    pub fn matches_original(&self, original: &NativeQueuedUploadOriginal) -> bool {
        Arc::ptr_eq(&self.issuer, &original.custody.issuer)
    }
    pub fn pending_byte_liability(&self) -> jobs::PendingByteLiability {
        self.pending
    }
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
impl InstalledNativeQueuedUploadOrigin<'_> {
    pub fn matches_original(&self, original: &NativeQueuedUploadOriginal) -> bool {
        std::ptr::eq(self.original, original)
            && Arc::ptr_eq(self.custody, &original.custody)
            && Arc::ptr_eq(self.custody_issuer, &original.custody.issuer)
            && original
                .installed_issuer
                .as_ref()
                .is_some_and(|issuer| Arc::ptr_eq(self.installed_issuer, issuer))
    }
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
impl NativeQueuedUploadOriginal {
    /// Pure private-allocation correlation, with no I/O or current authority.
    /// The host separately revalidates the same sealed E under its original
    /// principal/exact grant and the actual Source/native/Domain/physical phase.
    pub fn matches_source_preparation(
        &self,
        proof: &NativeQueuedUploadSourcePreparation<'_>,
    ) -> bool {
        self.installed_origin()
            .is_some_and(|origin| origin.matches_original(self))
            && Arc::ptr_eq(&self.custody, &proof.custody)
            && Arc::ptr_eq(&self.custody.issuer, &proof.custody.issuer)
    }

    /// Present only after the concrete installed binder's final checks. The
    /// borrowed receipt records producer origin, without current authority.
    pub fn installed_origin(&self) -> Option<InstalledNativeQueuedUploadOrigin<'_>> {
        self.installed_issuer
            .as_ref()
            .map(|installed_issuer| InstalledNativeQueuedUploadOrigin {
                original: self,
                installed_issuer,
                custody: &self.custody,
                custody_issuer: &self.custody.issuer,
            })
    }

    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.custody.staged
    }
    pub fn known_nonzero_admission(&self) -> &NativeQueuedUploadKnownNonzeroAdmission {
        &self.known_nonzero
    }
    pub fn source_reference(&self) -> &a::SourceRef {
        &self.source_reference
    }
    pub fn original(&self) -> &ValidatedRequest {
        &self.original
    }
    pub fn command(&self) -> &native::StockCommand {
        &self.command
    }
    pub fn plan(&self) -> &native::NativePlan {
        &self.plan
    }
    pub fn authority(&self) -> &native::StockAuthority {
        &self.authority
    }
    pub fn preflight(&self) -> &native::StockPreflight {
        &self.preflight
    }
    pub fn owner_preflight(&self) -> &native::StockPreflight {
        &self.owner_preflight
    }
    pub fn snapshot(&self) -> &NativeQueuedUploadSnapshot {
        &self.snapshot
    }
    pub fn capture_digest(&self) -> &native::Digest {
        &self.capture_digest
    }
    pub fn ordered_impact(&self) -> &[NativeQueuedUploadImpact] {
        &self.ordered_impact
    }
    pub fn queue_config(&self) -> &jobs::QueueConfig {
        &self.queue_config
    }
    pub fn enqueue_request(&self) -> &jobs::EnqueueRequest {
        &self.enqueue_request
    }
    pub fn canonical_scope(&self) -> &jobs::CanonicalScope {
        &self.canonical_scope
    }
}
fn upload_provenance_unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Original upload Media provenance is unavailable",
    )
}

impl NativeQueuedUploadOriginal {
    /// Pure comparison against the installed cut retained by Storage's actual
    /// released original enqueue. Matching DTOs cannot create this provenance.
    pub fn validate_original(
        &self,
        proof: &RecordedOriginalUploadEnqueueProof,
        registration: &jobs::QueueRegistration,
        original: &ValidatedRequest,
        request: &jobs::EnqueueRequest,
        scope: &jobs::CanonicalScope,
    ) -> s::Result<()> {
        let pending = self.known_nonzero.pending_byte_liability();
        if !std::ptr::eq(self, proof.upload_cut().as_ref())
            || !self
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(self))
            || !self.known_nonzero.matches_original(self)
            || !pending.required
            || pending.reserved_bytes != Some(self.custody.staged.byte_size)
            || pending.reserved_bytes != Some(self.custody.body_bytes.len() as u64)
            || self.custody.staged.byte_size == 0
        {
            return Err(upload_provenance_unavailable());
        }
        if registration != &self.queue_config.registration
            || original.raw() != self.original.raw()
            || original.intent_digest() != self.original.intent_digest()
            || request != &self.enqueue_request
            || scope != &self.canonical_scope
            || request.pending_byte_liability != pending
            || request.intent.request_digest.as_hex() != original.intent_digest()
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    /// The actual Storage Release-qualified matcher runs before DATA checks.
    /// Only its exact initial claim can qualify this unprepared attempt.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_unprepared_attempt(
        &self,
        proof: &RecordedOriginalUploadEnqueueProof,
        registration: &jobs::QueueRegistration,
        original: &ValidatedRequest,
        request: &jobs::EnqueueRequest,
        scope: &jobs::CanonicalScope,
        job: &jobs::LeasedJob,
    ) -> s::Result<()> {
        if !proof.matches_released_attempt(job) || !std::ptr::eq(self, proof.upload_cut().as_ref())
        {
            return Err(upload_provenance_unavailable());
        }
        self.validate_original(proof, registration, original, request, scope)?;
        if job.request != *request
            || job.canonical_scope != *scope
            || job.pending_byte_liability != self.known_nonzero.pending_byte_liability()
            || job.lease.physical_identity != registration.identity
            || job.lease.owner_id != registration.dispatcher_owner_id
            || job.attempt != 1
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }
}

/// Concrete offline comparison only for the genuine released original enqueue
/// and its unprepared initial claim. Prepared bytes, journals, step/liability
/// prefixes beyond the exact claim reservation and outcomes remain unavailable;
/// this issues no recovery permission
/// or current native/Access authority and performs no I/O or native callbacks.
impl QueuedMediaRecovery<RecordedOriginalUploadEnqueueProof> for NativeQueuedUploadOriginal {
    fn validate_original(
        &self,
        enqueue: &RetainedEnqueue<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        NativeQueuedUploadOriginal::validate_original(
            self,
            enqueue.original_proof,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
        )?;
        if enqueue.config != &self.queue_config {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    fn validate_attempt(
        &self,
        attempt: &RetainedAttempt<'_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        let enqueue = &attempt.enqueue;
        self.validate_unprepared_attempt(
            enqueue.original_proof,
            &enqueue.config.registration,
            enqueue.original,
            enqueue.request,
            enqueue.scope,
            attempt.job,
        )?;
        if enqueue.config != &self.queue_config
            || attempt.prepared.is_some()
            || attempt.journal.is_some()
            || !attempt.steps.is_empty()
            || attempt.liabilities.len() != 1
            || attempt.liabilities[0].0 != "claim"
            || attempt.liabilities[0].1
                != claim_reservation(self).map_err(|_| upload_provenance_unavailable())?
            || !attempt.outcomes.is_empty()
        {
            return Err(upload_provenance_unavailable());
        }
        Ok(())
    }

    fn validate_outcome(
        &self,
        _: &RetainedOutcome<'_, '_, RecordedOriginalUploadEnqueueProof>,
    ) -> s::Result<()> {
        Err(upload_provenance_unavailable())
    }
}

/// Local measured custody supplies a positive reservation, not evidence of
/// remotely retained bytes, metadata commit or reference closure.
fn claim_reservation(upload: &NativeQueuedUploadOriginal) -> MediaResult<jobs::StorageLiability> {
    let pending = upload.known_nonzero.pending_byte_liability();
    if !upload
        .installed_origin()
        .is_some_and(|origin| origin.matches_original(upload))
        || !upload.known_nonzero.matches_original(upload)
        || !pending.required
        || pending.reserved_bytes != Some(upload.custody.staged.byte_size)
        || pending.reserved_bytes != Some(upload.custody.body_bytes.len() as u64)
        || upload.custody.staged.byte_size == 0
        || pending != upload.enqueue_request.pending_byte_liability
    {
        return Err(MediaError::Unavailable);
    }
    Ok(jobs::StorageLiability {
        accounting: jobs::ByteAccounting::Complete {
            known_bytes: 0,
            reserved_bytes: upload.custody.staged.byte_size,
        },
        metadata_commit_evidence: jobs::MetadataCommitEvidence::NotDispatched,
        byte_disposition: jobs::ByteDisposition::None,
        reference_closure_evidence: jobs::ReferenceClosureEvidence::Unassessed,
        orphan_candidate_id: None,
        unresolved_attempts: 1,
    })
}

struct UploadPreparedIssuer {
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
impl NativeQueuedUploadPrepared {
    pub fn capture_original<'phase, 'tx, 'bundle, 'native: 'phase, 'owner, 'captured, 'p>(
        admission: &crate::app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        guard: &'phase a::TransactionAuthorization<'tx>,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        budget.check()?;
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        let upload = admission.upload_cut();
        let liability = claim_reservation(upload)?;
        let prepared = encode_upload_prepared(upload, liability, budget)?;
        let captured = Self {
            upload: Arc::clone(upload),
            issuer: Arc::new(UploadPreparedIssuer {
                custody: Arc::clone(&upload.custody),
                dispatch_body_taken: AtomicBool::new(false),
            }),
            prepared,
        };
        captured.revalidate_original_phase(admission, guard, physical, budget)?;
        Ok(captured)
    }

    /// Recheck the actual live original installed phase and bounded descriptor
    /// custody at Entry, Precommit or fresh Release. This performs local file
    /// reads; matching prepared DATA alone supplies no current authority.
    pub fn revalidate_original_phase<
        'phase,
        'tx,
        'bundle,
        'native: 'phase,
        'owner,
        'captured,
        'p,
    >(
        &self,
        admission: &crate::app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        guard: &'phase a::TransactionAuthorization<'tx>,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        let upload = admission.upload_cut();
        if !self.matches_original(upload) {
            return Err(MediaError::Unavailable);
        }
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        let native = admission.preparation().native();
        let source = native.source();
        let proof = native.capture().evidence().source_preparation();
        if !upload.matches_source_preparation(proof) {
            return Err(MediaError::Unavailable);
        }
        let liability = claim_reservation(upload)?;
        if self.prepared.storage_liability != liability {
            return Err(MediaError::Unavailable);
        }
        {
            let _current = proof.current_under_guard(
                guard,
                source.original(),
                source.original_source(),
                budget,
            )?;
        }
        // Bounded local descriptor I/O under Media custody; no Source mutex,
        // native/Store callback, network work, await or reentry surrounds it.
        {
            let owner = &upload.custody.owner;
            let _local = owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory = owner.lock()?;
            let before = owner.scan(budget)?;
            revalidate_body(&upload.custody, budget)?;
            if before != owner.scan(budget)? {
                return Err(MediaError::Unavailable);
            }
        }
        // Root/Source/Access phase fences run only after Media locks release.
        admission
            .revalidate_phase(guard, physical)
            .map_err(|_| MediaError::Unavailable)?;
        {
            let _current = proof.current_under_guard(
                guard,
                source.original(),
                source.original_source(),
                budget,
            )?;
        }
        if !self.matches_original(admission.upload_cut())
            || !upload.matches_source_preparation(proof)
        {
            return Err(MediaError::Unavailable);
        }
        budget.check()
    }

    pub fn upload_cut(&self) -> &Arc<NativeQueuedUploadOriginal> {
        &self.upload
    }
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.prepared
    }

    /// Bounded retained DATA decoding under this actual original issuer. No
    /// filesystem read, cold-start admission or reconstructed proof is issued.
    pub fn decode_retained_data<'a>(
        &'a self,
        candidate: &s::PreparedNativeIntent,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadDecoded<'a>> {
        if !self.matches_original(&self.upload) {
            return Err(MediaError::Unavailable);
        }
        budget.check()?;
        let liability = claim_reservation(&self.upload)?;
        if candidate.codec != NATIVE_QUEUED_UPLOAD_PREPARED_CODEC
            || candidate.native_payload.len() > MAX_PREPARED_FIELD_BYTES
            || candidate.prepared_media_evidence.len() > MAX_PREPARED_FIELD_BYTES
            || candidate.storage_liability != liability
        {
            return Err(MediaError::Unavailable);
        }
        let expected = encode_upload_prepared(&self.upload, liability, budget)?;
        budget.check()?;
        let _: Value = serde_json::from_slice(&candidate.native_payload)
            .map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        let _: Value = serde_json::from_slice(&candidate.prepared_media_evidence)
            .map_err(|_| MediaError::Unavailable)?;
        budget.check()?;
        // Exact canonical bytes reject unknown, duplicate, missing or changed
        // fields even where a general JSON parser would accept their spelling.
        if candidate != &expected || self.prepared != expected {
            return Err(MediaError::Unavailable);
        }
        Ok(NativeQueuedUploadDecoded { native: self })
    }

    pub fn validate_prepared_journal<'a>(
        &'a self,
        journal: &s::OriginalUploadJournalCut,
        attempt: &s::OriginalQueuedUploadAttempt,
        candidate: &s::PreparedNativeIntent,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadDecoded<'a>> {
        if !journal.matches_attempt(attempt)
            || !std::ptr::eq(self, journal.native_preparation().as_ref())
            || !Arc::ptr_eq(&self.upload, journal.upload_cut())
            || candidate != journal.prepared()
        {
            return Err(MediaError::Unavailable);
        }
        self.decode_retained_data(candidate, budget)
    }
    /// Actual original/issuer custody correlation only, with no current grant.
    pub fn matches_original(&self, upload: &Arc<NativeQueuedUploadOriginal>) -> bool {
        Arc::ptr_eq(&self.upload, upload)
            && Arc::ptr_eq(&self.issuer.custody, &upload.custody)
            && Arc::ptr_eq(&self.issuer.custody.issuer, &upload.custody.issuer)
            && upload
                .installed_origin()
                .is_some_and(|origin| origin.matches_original(upload))
            && upload.known_nonzero.matches_original(upload)
    }
}

/// Borrowed original plan/stage/intent DATA after exact retained validation.
/// No Clone, serde, public constructor or current/dispatch authority.
pub struct NativeQueuedUploadDecoded<'a> {
    native: &'a NativeQueuedUploadPrepared,
}
impl NativeQueuedUploadDecoded<'_> {
    pub fn plan(&self) -> &native::NativePlan {
        &self.native.upload.plan
    }
    pub fn staged_upload(&self) -> &native::StagedUpload {
        &self.native.upload.custody.staged
    }
    pub fn prepared(&self) -> &s::PreparedNativeIntent {
        &self.native.prepared
    }
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
impl NativeQueuedUploadDispatchBody {
    pub fn capture_under_guard<'phase, 'tx, 'bundle, 'native: 'phase, 'owner, 'captured, 'p>(
        native: &Arc<NativeQueuedUploadPrepared>,
        journal: &s::OriginalUploadJournalCut,
        attempt: &s::OriginalQueuedUploadAttempt,
        admission: &crate::app::homebox_queued_upload_admission::OriginalQueuedUploadAdmission<
            'bundle,
            'native,
            'owner,
            'captured,
            'p,
        >,
        guard: &'phase a::TransactionAuthorization<'tx>,
        physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<
            'phase,
            'p,
        >,
        bounds: NativeQueuedUploadDispatchBounds<'_>,
    ) -> MediaResult<Self> {
        // SAME prepared issuer owns this opportunity across all Arc copies.
        native
            .issuer
            .dispatch_body_taken
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| MediaError::Unavailable)?;
        let NativeQueuedUploadDispatchBounds {
            max_bytes,
            deadline,
            budget,
        } = bounds;
        check_body_deadline(deadline, budget)?;
        if !journal.matches_attempt(attempt)
            || !Arc::ptr_eq(native, journal.native_preparation())
            || !Arc::ptr_eq(native.upload_cut(), journal.upload_cut())
            || !Arc::ptr_eq(native.upload_cut(), admission.upload_cut())
            || native.prepared() != journal.prepared()
        {
            return Err(MediaError::Unavailable);
        }
        let body_size = native.upload.custody.staged.byte_size;
        if body_size == 0 || body_size > max_bytes.min(MAX_BYTES) as u64 {
            return Err(MediaError::TooLarge);
        }
        native.validate_prepared_journal(journal, attempt, native.prepared(), budget)?;
        native.revalidate_original_phase(admission, guard, physical, budget)?;
        let source_deadline = admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(budget)
            .map_err(|_| MediaError::Unavailable)?;
        let effective_deadline = deadline.min(source_deadline);
        check_body_deadline(effective_deadline, budget)?;
        let bytes = {
            let custody = &native.upload.custody;
            let owner = &custody.owner;
            let _local = owner
                .custody
                .try_lock()
                .map_err(|_| MediaError::Unavailable)?;
            let _directory = owner.lock()?;
            let before = owner.scan(budget)?;
            let bytes = read_revalidated_body(custody, budget)?;
            if before != owner.scan(budget)? || bytes.len() > max_bytes {
                return Err(MediaError::Unavailable);
            }
            bytes
        };
        // No Media locks surround actual Root/Source/Access phase callbacks.
        native.revalidate_original_phase(admission, guard, physical, budget)?;
        native.validate_prepared_journal(journal, attempt, native.prepared(), budget)?;
        if admission
            .preparation()
            .native()
            .source()
            .original_capture_deadline(budget)
            .map_err(|_| MediaError::Unavailable)?
            != source_deadline
        {
            return Err(MediaError::Unavailable);
        }
        check_body_deadline(deadline, budget)?;
        check_body_deadline(effective_deadline, budget)?;
        Ok(Self {
            native: Arc::clone(native),
            bytes,
            deadline,
            effective_deadline,
        })
    }

    /// Pure same-preparation allocation correlation, without current authority.
    pub fn matches_preparation(&self, native: &Arc<NativeQueuedUploadPrepared>) -> bool {
        Arc::ptr_eq(&self.native, native) && native.matches_original(native.upload_cut())
    }

    pub fn into_bytes(
        self,
        stage: &native::StagedUpload,
        max_bytes: usize,
        deadline: Instant,
        budget: &WorkBudget,
    ) -> MediaResult<Vec<u8>> {
        check_body_deadline(self.deadline, budget)?;
        check_body_deadline(self.effective_deadline, budget)?;
        check_body_deadline(deadline, budget)?;
        if deadline > self.deadline
            || stage != &self.native.upload.custody.staged
            || self.bytes.len() > max_bytes
            || stage.byte_size != self.bytes.len() as u64
            || stage.sha256.as_str() != sha256(&self.bytes)
        {
            return Err(MediaError::Unavailable);
        }
        check_body_deadline(self.deadline, budget)?;
        check_body_deadline(self.effective_deadline, budget)?;
        check_body_deadline(deadline, budget)?;
        Ok(self.bytes)
    }
}
fn check_body_deadline(deadline: Instant, budget: &WorkBudget) -> MediaResult<()> {
    budget.check()?;
    if Instant::now() >= deadline {
        return Err(MediaError::Unavailable);
    }
    Ok(())
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
fn encode_upload_prepared(
    upload: &NativeQueuedUploadOriginal,
    storage_liability: jobs::StorageLiability,
    budget: &WorkBudget,
) -> MediaResult<s::PreparedNativeIntent> {
    let native::NativeBody::Multipart { stage, .. } = &upload.plan.request.body else {
        return Err(MediaError::Unavailable);
    };
    if stage != &upload.custody.staged || upload.ordered_impact.len() != 1 {
        return Err(MediaError::Unavailable);
    }
    let impact = &upload.ordered_impact[0];
    let snapshot = &upload.snapshot;
    let native_payload = encode_prepared_field(
        &UploadPreparedPayload {
            format: NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
            native_source_commit: native::NATIVE_SOURCE_COMMIT,
            contract_version: native::CONTRACT_VERSION,
            original_wire: &upload.command.original_wire,
            plan: &upload.plan,
        },
        budget,
    )?;
    let prepared_media_evidence = encode_prepared_field(
        &UploadPreparedMedia {
            format: QUEUED_UPLOAD_MEDIA_FORMAT,
            staged: &upload.custody.staged,
            source: &upload.source_reference,
            capture_digest: &upload.capture_digest,
            snapshot_scope: &snapshot.scope,
            snapshot_target: &snapshot.target,
            snapshot_path: &snapshot.path,
            snapshot_query: &snapshot.query,
            snapshot_observed_at: &snapshot.observed_at,
            snapshot_digest: &snapshot.digest,
            ordered_impact: [UploadPreparedImpact {
                partition: UploadPreparedPartition {
                    workspace_id: &impact.partition.workspace_id,
                    home_id: &impact.partition.home_id,
                    source_instance_id: &impact.partition.source_instance_id,
                    collection_id: &impact.partition.collection_id,
                },
                entity_id: &impact.entity_id,
                staged: &impact.staged,
                snapshot_digest: &impact.snapshot_digest,
            }],
        },
        budget,
    )?;
    Ok(s::PreparedNativeIntent {
        codec: NATIVE_QUEUED_UPLOAD_PREPARED_CODEC.into(),
        native_payload,
        prepared_media_evidence,
        storage_liability,
    })
}
struct PreparedFieldWriter<'a> {
    bytes: Vec<u8>,
    budget: &'a WorkBudget,
}
impl Write for PreparedFieldWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_PREPARED_FIELD_BYTES.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes.extend_from_slice(bytes);
        self.budget.check().map_err(std::io::Error::other)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.budget.check().map_err(std::io::Error::other)
    }
}
fn encode_prepared_field<T: Serialize>(value: &T, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    budget.check()?;
    let mut writer = PreparedFieldWriter {
        bytes: Vec::new(),
        budget,
    };
    serde_json::to_writer(&mut writer, value).map_err(|_| MediaError::Unavailable)?;
    budget.check()?;
    Ok(writer.bytes)
}

#[allow(clippy::too_many_arguments)]
fn check_queued_upload_binding<'phase, 'a, 'p, 'owner, 'captured, W, G, F, C>(
    guard: &'phase a::TransactionAuthorization<'_>,
    custody: &Arc<StageCustody>,
    original: &RetainedPrincipal,
    grant: &a::SourceGrant,
    bound: &NativeQueueOriginalPreparation<
        'a,
        'p,
        'owner,
        W,
        G,
        F,
        C,
        native::QueuedUploadSource<'captured, 'p>,
    >,
    physical: &'phase crate::app::homebox_queued_upload::OriginalQueuedUploadPhysical<'phase, 'p>,
    budget: &WorkBudget,
) -> MediaResult<()>
where
    G: NativeQueueOriginalGraph<'owner, C, native::QueuedUploadSource<'captured, 'p>>,
    F: GraphAuthorization<W, G>,
    C: native::StockContractPort + Sync,
{
    budget.check()?;
    let source = bound.native().source();
    let captured = source.captured();
    let configured = source.configured();
    let selected_source = source.original_source();
    let selected_partition = source.original_partition();
    let proof = bound.native().capture().evidence().source_preparation();
    if !Arc::ptr_eq(custody, &proof.custody)
        || !Arc::ptr_eq(&custody.issuer, &proof.custody.issuer)
        || !std::ptr::eq(original.principal(), proof.original.principal())
        || !std::ptr::eq(grant, proof.source)
        || !std::ptr::eq(original.principal(), source.original().principal())
        || !std::ptr::eq(original.principal(), captured.principal())
        || !std::ptr::eq(guard.principal(), captured.principal())
        || !std::ptr::eq(captured, bound.captured())
        || !std::ptr::eq(captured, physical.captured())
        || !std::ptr::eq(grant, selected_source)
        || !std::ptr::eq(selected_source, physical.source())
        || !std::ptr::eq(selected_partition, physical.partition())
        || !captured
            .source_grants()
            .iter()
            .any(|item| std::ptr::eq(item, selected_source))
        || !captured
            .partition_grants()
            .iter()
            .any(|item| std::ptr::eq(item, selected_partition))
        || selected_source.reference().partition() != *selected_partition.partition()
        || selected_partition.partition() != &configured.source().partition()
        || !configured.source().contains(selected_source.reference())
        || !Arc::ptr_eq(configured, physical.configured())
        || !physical.matches_configured_store()
        || physical.queue_config() != configured.queue()
        || physical.registration() != configured.physical()
        || physical.source_metadata() != configured.metadata()
    {
        return Err(MediaError::Forbidden);
    }
    guard
        .revalidate_source_partition(selected_partition)
        .map_err(access_error)?;
    if guard
        .persisted_source_metadata(selected_partition)
        .map_err(access_error)?
        != *configured.metadata()
    {
        return Err(MediaError::Forbidden);
    }
    {
        let _current = proof.current_under_guard(guard, original, grant, budget)?;
    }
    // No Source or Store callback, network work or reentry surrounds these
    // bounded Media descriptor checks. All Media locks have now been dropped.
    authorize_original(guard, original, grant)?;
    budget.check()
}

fn authorize_original(
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    source: &a::SourceGrant,
) -> MediaResult<()> {
    let principal = original.principal();
    let reference = source.reference();
    if !std::ptr::eq(guard.principal(), principal)
        || reference.key.source_kind != a::SourceKind::HomeboxEntity
        || reference.workspace_id != principal.scope().workspace_id
        || reference.home_id != principal.scope().home_id
    {
        return Err(MediaError::Forbidden);
    }
    guard.assert_mutation().map_err(access_error)?;
    guard
        .authorize(principal.scope(), a::Capability::Mutate)
        .map_err(access_error)?;
    guard.revalidate_source(source).map_err(access_error)?;
    guard
        .authorize(principal.scope(), a::Capability::ReadCacheEntity(reference))
        .map_err(access_error)?;
    guard.revalidate().map(|_| ()).map_err(access_error)
}
fn check_metadata(metadata: &NativeQueuedUploadMetadata) -> MediaResult<()> {
    if metadata.filename.is_empty()
        || metadata.filename.chars().count() > 255
        || metadata.filename.contains("..")
        || metadata.filename.contains(['/', '\\'])
        || metadata.filename.chars().any(char::is_control)
    {
        return Err(MediaError::InvalidInput);
    }
    Ok(())
}
fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}
fn reservation_name(id: &str) -> String {
    format!("{id}.reservation.json")
}
fn body_name(id: &str) -> String {
    format!("{id}.body")
}
fn check_file(metadata: &Metadata, maximum: usize) -> MediaResult<()> {
    if !metadata.is_file()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.nlink() != 1
    {
        return Err(MediaError::Unavailable);
    }
    if metadata.len() > maximum as u64 {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}
fn validate_reservation(data: &ReservationData, id: &str) -> MediaResult<()> {
    if data.format != RESERVATION_FORMAT
        || data.staged.upload_token.to_string() != id
        || data.staged.byte_size == 0
        || data.staged.byte_size > MAX_BYTES as u64
        || !canonical_uuid(&data.actor_id)
        || data.source.key.source_kind != a::SourceKind::HomeboxEntity
        || !canonical_uuid(&data.source.key.external_id)
        || !canonical_uuid(&data.source.key.collection_id)
    {
        return Err(MediaError::Unavailable);
    }
    let content_type = ContentType::parse(&data.staged.content_type)?;
    check_metadata(&NativeQueuedUploadMetadata {
        content_type,
        filename: data.staged.filename.clone(),
    })
}
fn exact_uuid(raw: &Value, expected: Uuid) -> MediaResult<String> {
    let raw = raw.as_str().ok_or(MediaError::InvalidInput)?;
    if expected.is_nil() || raw.len() != 36 || Uuid::parse_str(raw).ok() != Some(expected) {
        return Err(MediaError::InvalidInput);
    }
    Ok(raw.into())
}
fn revalidate_body(custody: &StageCustody, budget: &WorkBudget) -> MediaResult<()> {
    read_revalidated_body(custody, budget).map(|_| ())
}
fn read_revalidated_body(custody: &StageCustody, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    budget.check()?;
    let body_size = usize::try_from(custody.staged.byte_size).map_err(|_| MediaError::TooLarge)?;
    if body_size == 0 || body_size > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    let id = custody.staged.upload_token.to_string();
    let reservation =
        custody
            .owner
            .read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
    let body = custody
        .owner
        .read_member(&body_name(&id), body_size, budget)?;
    if reservation.identity != custody.reservation_identity
        || reservation.bytes != custody.reservation_bytes
        || body.identity != custody.body_identity
        || body.bytes != custody.body_bytes
        || FileIdentity::of(&custody.body.metadata()?) != custody.body_identity
        || custody.staged.byte_size != body.bytes.len() as u64
        || custody.staged.sha256.as_str() != sha256(&body.bytes)
    {
        return Err(MediaError::Unavailable);
    }
    budget.check()?;
    Ok(body.bytes)
}

// Counting writer: no temporary serialized copy can grow beyond the shared
// 1 MiB total detached-facts budget. This measures borrowed facts, not authority.
struct FactBudget<'a> {
    bytes: usize,
    budget: &'a WorkBudget,
}
impl Write for FactBudget<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_ORIGINAL_FACT_BYTES.saturating_sub(self.bytes) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl FactBudget<'_> {
    fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> MediaResult<()> {
        self.budget.check()?;
        serde_json::to_writer(&mut *self, value).map_err(|_| MediaError::TooLarge)?;
        self.budget.check()
    }
    fn preflight(&mut self, preflight: &native::StockPreflight) -> MediaResult<()> {
        if preflight.preparation.snapshots.len() != 1
            || !preflight.preparation.native_clear_values.is_empty()
        {
            return Err(MediaError::InvalidInput);
        }
        let snapshot = &preflight.preparation.snapshots[0];
        self.json(&(
            &snapshot.target,
            &snapshot.value,
            &snapshot.digest,
            snapshot.complete,
            snapshot.hidden_fields_preserved,
            &preflight.preparation.staged_upload,
            preflight.provider_observation,
            &preflight.request_digest,
            preflight.source_epoch,
            &preflight.preflight_digest,
        ))
    }
    fn queue_config(&mut self, config: &jobs::QueueConfig) -> MediaResult<()> {
        if config.registration.aliases.len() > MAX_QUEUE_ALIASES {
            return Err(MediaError::TooLarge);
        }
        let identity = &config.registration.identity;
        let profile = &config.admission_profile;
        // Native/queue digest constructors already strictly bound those fields.
        let qualification = match &profile.qualification {
            jobs::ProfileQualification::OfflineEngineeringFixture => "offline-engineering-fixture",
            jobs::ProfileQualification::QualifiedDeployment { evidence_digest } => {
                evidence_digest.as_hex()
            }
        };
        self.json(&(
            identity.deployment_id.as_str(),
            identity.physical_database_id.as_str(),
            identity.configuration_digest.as_hex(),
            config.registration.dispatcher_owner_id.as_str(),
            config.lease_duration_ms,
            config.retry.max_attempts,
            config.retry.initial_delay_ms,
            config.retry.max_delay_ms,
            profile.profile_version.as_str(),
            qualification,
            profile.max_waiting_intents,
            profile.max_admission_wait_ms,
            profile.max_unresolved_storage_attempts,
            profile.max_unresolved_storage_bytes,
        ))?;
        for alias in &config.registration.aliases {
            self.budget.check()?;
            self.json(&(
                alias.partition.workspace_id.as_str(),
                alias.partition.home_id.as_str(),
                alias.partition.source_instance_id.as_str(),
                alias.partition.collection_id.as_str(),
                alias.canonical_collection_id.as_str(),
            ))?;
        }
        Ok(())
    }
}
