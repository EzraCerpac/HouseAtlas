//! Durable handoff of a genuinely published complete Media reference. Native
//! selection and decoded files are DATA. Producer-issued reads require their
//! still-retained original carrier. The separate historical intake owner must
//! supply explicit independently approved configuration for historical reads.
use super::{
    MediaError, MediaResult, WorkBudget,
    native_policy_archive::{NativeMediaArchiveExpectedMember, NativeMediaArchiveGeneration},
    recovery_policy_archive::{
        MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES, MAX_MEDIA_POLICY_ARCHIVE_MEMBERS,
        MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES, MediaPolicyArchiveOrigin,
        valid_media_policy_archive_member,
    },
    types::Scope,
};
use crate::lifecycle::provider_dispatch::archive::ArchiveDestination;
use rustix::fs::{AtFlags, Mode, OFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, Metadata, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::PathBuf,
    sync::Mutex,
};
use uuid::Uuid;

pub const MAX_NATIVE_MEDIA_REFERENCE_BYTES: usize = 40 * 1024 * 1024;
pub const MAX_NATIVE_MEDIA_REFERENCE_MEMBERS: usize = 10_000;
pub const MAX_NATIVE_MEDIA_REFERENCE_STORE_BYTES: usize = 64 * 1024 * 1024;
const FORMAT: &str = "houseatlas-native-media-reference/1";

pub use super::native_policy_archive::PublishedNativeMediaReference;

/// Explicit trusted directory selection and byte cap. These settings and the
/// candidate destination describe custody; they authenticate no origin.
pub struct NativeMediaPolicyReferenceConfig {
    directory: PathBuf,
    candidate: ArchiveDestination,
    max_bytes: usize,
    max_members: usize,
    max_total_bytes: usize,
}
impl NativeMediaPolicyReferenceConfig {
    pub fn new(
        directory: PathBuf,
        candidate: ArchiveDestination,
        max_bytes: usize,
        max_members: usize,
        max_total_bytes: usize,
    ) -> MediaResult<Self> {
        if !directory.is_absolute()
            || max_bytes == 0
            || max_bytes > MAX_NATIVE_MEDIA_REFERENCE_BYTES
            || max_members == 0
            || max_members > MAX_NATIVE_MEDIA_REFERENCE_MEMBERS
            || max_total_bytes == 0
            || max_total_bytes > MAX_NATIVE_MEDIA_REFERENCE_STORE_BYTES
            || max_bytes > max_total_bytes
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(Self {
            directory,
            candidate,
            max_bytes,
            max_members,
            max_total_bytes,
        })
    }
}

/// Explicit inert selection; the actual audit UUID is the canonical filename.
pub struct NativeMediaPolicyReferenceSelection {
    audit_id: String,
    origin: MediaPolicyArchiveOrigin,
}
impl NativeMediaPolicyReferenceSelection {
    pub fn new(audit_id: String, origin: MediaPolicyArchiveOrigin) -> MediaResult<Self> {
        if !canonical_uuid(&audit_id) {
            return Err(MediaError::InvalidInput);
        }
        origin.validate()?;
        Ok(Self { audit_id, origin })
    }
    pub fn member_name(&self) -> String {
        reference_name(&self.audit_id)
    }
    pub fn audit_id(&self) -> &str {
        &self.audit_id
    }
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.origin
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DestinationData {
    directory: PathBuf,
    device: u64,
    inode: u64,
    owner: u32,
}
impl DestinationData {
    fn candidate(destination: &ArchiveDestination) -> Self {
        Self {
            directory: destination.directory().into(),
            device: destination.device(),
            inode: destination.inode(),
            owner: destination.owner(),
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemberData {
    name: String,
    packet: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    format: String,
    audit_id: String,
    origin: MediaPolicyArchiveOrigin,
    candidate: DestinationData,
    scopes: Vec<Scope>,
    members: Vec<MemberData>,
}

/// Closed decoded unadmitted DATA. No generation conversion, live producer,
/// authority or historical origin qualification is exposed.
pub struct NativeMediaPolicyReferenceData {
    envelope: Envelope,
    byte_size: usize,
}
impl NativeMediaPolicyReferenceData {
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.envelope.origin
    }
    pub fn member_name(&self) -> String {
        reference_name(&self.envelope.audit_id)
    }
    pub fn byte_size(&self) -> usize {
        self.byte_size
    }
    pub fn member_count(&self) -> usize {
        self.envelope.members.len()
    }
    pub fn members(&self) -> impl Iterator<Item = (&str, &[u8])> {
        self.envelope
            .members
            .iter()
            .map(|member| (member.name.as_str(), member.packet.as_bytes()))
    }
    pub fn into_expected_members(
        self,
        budget: &WorkBudget,
    ) -> MediaResult<Vec<NativeMediaArchiveExpectedMember>> {
        let mut members = Vec::with_capacity(self.envelope.members.len());
        for member in self.envelope.members {
            budget.check()?;
            members.push(NativeMediaArchiveExpectedMember::new(
                member.name,
                member.packet.into_bytes(),
            )?);
        }
        budget.check()?;
        Ok(members)
    }
}

/// Original one-time persisted producer lineage retained in this process. The
/// private expected body, actual reference destination and capture are owned;
/// file/JSON/hash callers cannot construct it. Not Clone/serde or a grant.
pub struct IssuedNativeMediaReference {
    capture: PublishedNativeMediaReference,
    destination: DestinationData,
    bytes: Vec<u8>,
    identity: Identity,
}
impl IssuedNativeMediaReference {
    pub fn selection(&self) -> MediaResult<NativeMediaPolicyReferenceSelection> {
        NativeMediaPolicyReferenceSelection::new(
            self.capture.audit_id().to_owned(),
            self.capture.generation().reference_parts().1.clone(),
        )
    }
}

/// Borrowed original issued lineage remains mandatory throughout this proof's
/// lifetime. A generation clone retains only already-issued process provenance.
pub struct NativeMediaPolicyReferenceRead<'a> {
    issued: &'a IssuedNativeMediaReference,
}
impl NativeMediaPolicyReferenceRead<'_> {
    pub fn generation(&self) -> NativeMediaArchiveGeneration {
        self.issued.capture.generation().clone()
    }
}

#[derive(PartialEq, Eq)]
struct Identity {
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
impl Identity {
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
struct DirectoryLock<'a>(&'a File);
impl Drop for DirectoryLock<'_> {
    fn drop(&mut self) {
        let _ = rustix::fs::flock(self.0, rustix::fs::FlockOperation::Unlock);
    }
}

/// Descriptor custody for an independently selected, preprovisioned directory.
/// No directory creation, archive adoption, administrator default or SQL I/O.
/// A crash can leave a pending member, which makes the complete catalog
/// unavailable. Reconciliation requires a separately qualified operator; this
/// store performs no maintenance or automatic adoption of those files.
pub struct NativeMediaPolicyReferenceStore {
    directory: File,
    destination: DestinationData,
    candidate: ArchiveDestination,
    max_bytes: usize,
    max_members: usize,
    max_total_bytes: usize,
    custody: Mutex<()>,
}
impl NativeMediaPolicyReferenceStore {
    pub fn open(config: NativeMediaPolicyReferenceConfig) -> MediaResult<Self> {
        let path = &config.directory;
        if path.canonicalize()? != *path
            || config.candidate.directory().canonicalize()? != config.candidate.directory()
        {
            return Err(MediaError::InvalidInput);
        }
        if path.starts_with(config.candidate.directory())
            || config.candidate.directory().starts_with(path)
        {
            return Err(MediaError::InvalidInput);
        }
        let flags = OFlags::DIRECTORY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(flags.bits() as i32)
            .open(path)?;
        let metadata = directory.metadata()?;
        check_directory(&metadata)?;
        let named = std::fs::symlink_metadata(path)?;
        if Identity::of(&metadata) != Identity::of(&named)
            || (metadata.dev() == config.candidate.device()
                && metadata.ino() == config.candidate.inode())
        {
            return Err(MediaError::InvalidInput);
        }
        let store = Self {
            directory,
            destination: DestinationData {
                directory: path.clone(),
                device: metadata.dev(),
                inode: metadata.ino(),
                owner: metadata.uid(),
            },
            candidate: config.candidate,
            max_bytes: config.max_bytes,
            max_members: config.max_members,
            max_total_bytes: config.max_total_bytes,
            custody: Mutex::new(()),
        };
        store.destination_current()?;
        Ok(store)
    }
    fn destination_current(&self) -> MediaResult<()> {
        for metadata in [
            self.directory.metadata()?,
            std::fs::symlink_metadata(&self.destination.directory)?,
        ] {
            check_directory(&metadata)?;
            if metadata.dev() != self.destination.device
                || metadata.ino() != self.destination.inode
                || metadata.uid() != self.destination.owner
            {
                return Err(MediaError::Unavailable);
            }
        }
        // Candidate path is still the actual selected descriptor identity DATA.
        let candidate = std::fs::symlink_metadata(self.candidate.directory())?;
        check_directory(&candidate)?;
        if candidate.dev() != self.candidate.device()
            || candidate.ino() != self.candidate.inode()
            || candidate.uid() != self.candidate.owner()
        {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }
    fn lock(&self) -> MediaResult<DirectoryLock<'_>> {
        self.destination_current()?;
        rustix::fs::flock(
            &self.directory,
            rustix::fs::FlockOperation::NonBlockingLockExclusive,
        )
        .map_err(|_| MediaError::Unavailable)?;
        Ok(DirectoryLock(&self.directory))
    }
    /// By-value one-time handoff. Existing final members are always refused,
    /// including identical bytes; publication does not grant retry or adoption.
    /// An error can follow final link or file/directory sync, leaving durable
    /// final DATA without an Issued carrier. It implies no rollback, adoption or
    /// retry authority. Any reconciliation requires a separately qualified
    /// operator; pending crash files intentionally make the catalog unavailable.
    pub fn persist(
        &self,
        capture: PublishedNativeMediaReference,
        budget: &WorkBudget,
    ) -> MediaResult<IssuedNativeMediaReference> {
        budget.check()?;
        let (candidate, origin, scopes, members) = capture.generation().reference_parts();
        if candidate != &self.candidate
            || !canonical_uuid(capture.audit_id())
            || !members.contains_key(&format!("{}.media-policy.json", capture.audit_id()))
        {
            return Err(MediaError::Unavailable);
        }
        let mut data = Vec::with_capacity(members.len());
        for (name, bytes) in members {
            budget.check()?;
            data.push(MemberData {
                name: name.clone(),
                packet: std::str::from_utf8(bytes)
                    .map_err(|_| MediaError::InvalidInput)?
                    .to_owned(),
            });
        }
        let envelope = Envelope {
            format: FORMAT.into(),
            audit_id: capture.audit_id().to_owned(),
            origin: origin.clone(),
            candidate: DestinationData::candidate(candidate),
            scopes: scopes.to_vec(),
            members: data,
        };
        validate_envelope(&envelope, &self.candidate, budget)?;
        let bytes = encode_bounded(&envelope, self.max_bytes, budget)?;
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let _lock = self.lock()?;
        let name = reference_name(capture.audit_id());
        let before = self.scan(budget)?;
        if before.members.iter().any(|(existing, _)| existing == &name) {
            return Err(MediaError::Unavailable);
        }
        if before.members.len() >= self.max_members
            || bytes.len() > self.max_total_bytes.saturating_sub(before.total)
        {
            return Err(MediaError::TooLarge);
        }
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| MediaError::Unavailable)?;
        let pending = format!("pending-{}", Uuid::from_bytes(nonce));
        let flags = OFlags::WRONLY
            | OFlags::CREATE
            | OFlags::EXCL
            | OFlags::NONBLOCK
            | OFlags::NOFOLLOW
            | OFlags::CLOEXEC;
        let fd = rustix::fs::openat(&self.directory, &pending, flags, Mode::RUSR | Mode::WUSR)?;
        let mut file = File::from(fd);
        let result = (|| {
            rustix::fs::fchmod(&file, Mode::RUSR | Mode::WUSR)?;
            for chunk in bytes.chunks(64 * 1024) {
                budget.check()?;
                file.write_all(chunk)?;
            }
            budget.check()?;
            file.sync_all()?;
            self.destination_current()?;
            // Atomic absent-only publication: EXIST is an error, never matches().
            rustix::fs::linkat(
                &self.directory,
                &pending,
                &self.directory,
                &name,
                AtFlags::empty(),
            )
            .map_err(|_| MediaError::Unavailable)?;
            rustix::fs::unlinkat(&self.directory, &pending, AtFlags::empty())?;
            self.directory.sync_all()?;
            budget.check()?;
            self.destination_current()?;
            let actual = self.read_bytes(&name, budget)?;
            if actual.bytes != bytes {
                return Err(MediaError::Unavailable);
            }
            let after = self.scan(budget)?;
            if after.members.len() != before.members.len() + 1
                || before
                    .members
                    .iter()
                    .any(|old| !after.members.contains(old))
                || !after
                    .members
                    .iter()
                    .any(|(member, identity)| member == &name && identity == &actual.identity)
            {
                return Err(MediaError::Unavailable);
            }
            Ok(actual.identity)
        })();
        if result.is_err() {
            let _ = rustix::fs::unlinkat(&self.directory, &pending, AtFlags::empty());
        }
        let identity = result?;
        Ok(IssuedNativeMediaReference {
            capture,
            destination: DestinationData {
                directory: self.destination.directory.clone(),
                device: self.destination.device,
                inode: self.destination.inode,
                owner: self.destination.owner,
            },
            bytes,
            identity,
        })
    }
    pub fn read_data(
        &self,
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<NativeMediaPolicyReferenceData> {
        budget.check()?;
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let _lock = self.lock()?;
        let before = self.scan(budget)?;
        let bytes = self.read_bytes(&selection.member_name(), budget)?;
        let envelope = self.decode_selected(&bytes.bytes, selection, budget)?;
        if before != self.scan(budget)? {
            return Err(MediaError::Unavailable);
        }
        Ok(NativeMediaPolicyReferenceData {
            envelope,
            byte_size: bytes.bytes.len(),
        })
    }
    /// Exact comparison following a bounded stable filesystem read. The
    /// expected generation must come from the separate intake owner's explicit
    /// independent administrative configuration, never from this decoded DATA.
    /// Matching provides no grant and cannot mint producer lineage. This
    /// method performs filesystem I/O and must run before entering a Storage
    /// callback; Storage receives only already-authenticated offline evidence.
    pub(super) fn match_expected_generation(
        &self,
        selection: &NativeMediaPolicyReferenceSelection,
        expected: &NativeMediaArchiveGeneration,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        let (candidate, origin, scopes, members) = expected.reference_parts();
        if candidate != &self.candidate || origin != selection.origin() {
            return Err(MediaError::Unavailable);
        }
        let data = self.read_data(selection, budget)?;
        if data.envelope.candidate != DestinationData::candidate(candidate)
            || &data.envelope.origin != origin
            || data.envelope.scopes != scopes
            || data.envelope.members.len() != members.len()
        {
            return Err(MediaError::Unavailable);
        }
        for (actual, (name, bytes)) in data.envelope.members.iter().zip(members) {
            budget.check()?;
            if &actual.name != name || actual.packet.as_bytes() != bytes.as_slice() {
                return Err(MediaError::Unavailable);
            }
        }
        budget.check()
    }
    /// Without the independently retained original issuer this is unavailable.
    /// Explicit historical administrative intake is owned by the separate
    /// historical authority, never inferred by this producer-issued read path.
    pub fn read_issued<'a>(
        &self,
        selection: &NativeMediaPolicyReferenceSelection,
        issued: Option<&'a IssuedNativeMediaReference>,
        budget: &WorkBudget,
    ) -> MediaResult<NativeMediaPolicyReferenceRead<'a>> {
        budget.check()?;
        let issued = issued.ok_or(MediaError::Unavailable)?;
        let (candidate, origin, _, _) = issued.capture.generation().reference_parts();
        if issued.destination != self.destination
            || candidate != &self.candidate
            || issued.capture.audit_id() != selection.audit_id
            || origin != &selection.origin
        {
            return Err(MediaError::Unavailable);
        }
        let _local = self
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let _lock = self.lock()?;
        let before = self.scan(budget)?;
        let bytes = self.read_bytes(&selection.member_name(), budget)?;
        self.decode_selected(&bytes.bytes, selection, budget)?;
        if bytes.bytes != issued.bytes
            || bytes.identity != issued.identity
            || before != self.scan(budget)?
        {
            return Err(MediaError::Unavailable);
        }
        budget.check()?;
        Ok(NativeMediaPolicyReferenceRead { issued })
    }
    fn decode_selected(
        &self,
        bytes: &[u8],
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<Envelope> {
        budget.check()?;
        let envelope: Envelope =
            serde_json::from_slice(bytes).map_err(|_| MediaError::InvalidInput)?;
        if envelope.audit_id != selection.audit_id || envelope.origin != selection.origin {
            return Err(MediaError::Unavailable);
        }
        validate_envelope(&envelope, &self.candidate, budget)?;
        budget.check()?;
        Ok(envelope)
    }
    // Complete catalog DATA proves bounded stable custody/capacity only. It
    // never admits origin, adopts an existing final or resurrects a producer.
    fn scan(&self, budget: &WorkBudget) -> MediaResult<Catalog> {
        self.destination_current()?;
        let before = Identity::of(&self.directory.metadata()?);
        let mut directory = rustix::fs::Dir::read_from(&self.directory)?;
        let mut members = Vec::new();
        let mut total = 0usize;
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
            if !name
                .strip_suffix(".media-reference.json")
                .is_some_and(canonical_uuid)
                || members.len() >= self.max_members
            {
                return Err(MediaError::Unavailable);
            }
            let read = self.read_bytes(name, budget)?;
            total = total
                .checked_add(read.bytes.len())
                .ok_or(MediaError::TooLarge)?;
            if total > self.max_total_bytes {
                return Err(MediaError::TooLarge);
            }
            members.push((name.to_owned(), read.identity));
        }
        members.sort_by(|left, right| left.0.cmp(&right.0));
        if members.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err(MediaError::Unavailable);
        }
        budget.check()?;
        self.destination_current()?;
        if before != Identity::of(&self.directory.metadata()?) {
            return Err(MediaError::Unavailable);
        }
        Ok(Catalog { members, total })
    }
    fn read_bytes(&self, name: &str, budget: &WorkBudget) -> MediaResult<ReadBytes> {
        self.destination_current()?;
        let directory_before = Identity::of(&self.directory.metadata()?);
        let flags = OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let fd = rustix::fs::openat(&self.directory, name, flags, Mode::empty())?;
        let mut file = File::from(fd);
        let metadata = file.metadata()?;
        check_member(&metadata, self.max_bytes)?;
        let before = Identity::of(&metadata);
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let mut chunk = [0u8; 64 * 1024];
        loop {
            budget.check()?;
            let read = file.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            if read > self.max_bytes.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&chunk[..read]);
        }
        budget.check()?;
        let after = file.metadata()?;
        check_member(&after, self.max_bytes)?;
        let named_fd = rustix::fs::openat(&self.directory, name, flags, Mode::empty())?;
        let named = File::from(named_fd).metadata()?;
        check_member(&named, self.max_bytes)?;
        if before != Identity::of(&after)
            || before != Identity::of(&named)
            || before.size != bytes.len() as u64
            || directory_before != Identity::of(&self.directory.metadata()?)
        {
            return Err(MediaError::Unavailable);
        }
        self.destination_current()?;
        Ok(ReadBytes {
            bytes,
            identity: before,
        })
    }
}
#[derive(PartialEq, Eq)]
struct Catalog {
    members: Vec<(String, Identity)>,
    total: usize,
}
struct ReadBytes {
    bytes: Vec<u8>,
    identity: Identity,
}
fn check_directory(metadata: &Metadata) -> MediaResult<()> {
    if !metadata.is_dir()
        || metadata.mode() & 0o7777 != 0o700
        || metadata.uid() != rustix::process::geteuid().as_raw()
    {
        return Err(MediaError::Unavailable);
    }
    Ok(())
}
fn check_member(metadata: &Metadata, maximum: usize) -> MediaResult<()> {
    if !metadata.is_file()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.len() == 0
    {
        return Err(MediaError::Unavailable);
    }
    if metadata.len() > maximum as u64 {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}
fn canonical_uuid(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id)
}
fn reference_name(id: &str) -> String {
    format!("{id}.media-reference.json")
}
fn validate_envelope(
    envelope: &Envelope,
    candidate: &ArchiveDestination,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    if envelope.format != FORMAT
        || !canonical_uuid(&envelope.audit_id)
        || envelope.candidate != DestinationData::candidate(candidate)
        || envelope.members.is_empty()
        || envelope.members.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBERS
    {
        return Err(MediaError::InvalidInput);
    }
    let mut total = 0usize;
    let mut previous: Option<&str> = None;
    let mut members = Vec::with_capacity(envelope.members.len());
    let mut contains_audit = false;
    let selected = format!("{}.media-policy.json", envelope.audit_id);
    for member in &envelope.members {
        budget.check()?;
        let bytes = member.packet.as_bytes();
        if !valid_media_policy_archive_member(&member.name)
            || bytes.is_empty()
            || bytes.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES
            || previous.is_some_and(|name| name >= member.name.as_str())
        {
            return Err(MediaError::InvalidInput);
        }
        total = total.checked_add(bytes.len()).ok_or(MediaError::TooLarge)?;
        if total > MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES {
            return Err(MediaError::TooLarge);
        }
        previous = Some(&member.name);
        contains_audit |= member.name == selected;
        members.push(NativeMediaArchiveExpectedMember::new(
            member.name.clone(),
            bytes.to_vec(),
        )?);
    }
    if !contains_audit {
        return Err(MediaError::InvalidInput);
    }
    NativeMediaArchiveGeneration::validate_reference_data(
        candidate,
        &envelope.origin,
        &envelope.scopes,
        members,
        budget,
    )
}
// serde's writer can never grow the envelope beyond the configured cap and
// checks the cooperative budget at each write, including encoded JSON strings.
struct BoundedWriter<'a> {
    bytes: Vec<u8>,
    maximum: usize,
    budget: &'a WorkBudget,
}
impl Write for BoundedWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > self.maximum.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn encode_bounded(
    envelope: &Envelope,
    maximum: usize,
    budget: &WorkBudget,
) -> MediaResult<Vec<u8>> {
    let mut writer = BoundedWriter {
        bytes: Vec::new(),
        maximum,
        budget,
    };
    serde_json::to_writer(&mut writer, envelope).map_err(|_| MediaError::Unavailable)?;
    budget.check()?;
    Ok(writer.bytes)
}
