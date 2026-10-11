//! Descriptor-anchored immutable upload history DATA. Readback is unadmitted;
//! neither an archive scan nor successful sync grants recovery permission.
use super::archive::{ArchiveDestination, ArchiveError};
use crate::media::WorkBudget;
use rustix::fs::{AtFlags, Mode, OFlags};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
};

pub(super) const MEMBER_LIMIT: usize = 64;
pub(super) const TOTAL_LIMIT: usize = 512 * 1024 * 1024;
pub(super) const CATALOG_LIMIT: usize = 4 * 1024 * 1024;
pub(super) const ENVELOPE_LIMIT: usize = 5 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;
pub(super) const FRAME_LIMIT: usize = 192 * 1024 * 1024;

/// Complete descriptor sync receipt. This carries publication facts only.
pub struct PublishedQueuedUploadHistoryCatalog {
    name: String,
    sha256: [u8; 32],
    generation: u64,
}
impl PublishedQueuedUploadHistoryCatalog {
    pub fn catalog_name(&self) -> &str {
        &self.name
    }
    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub(super) fn completed(name: String, sha256: [u8; 32], generation: u64) -> Self {
        Self {
            name,
            sha256,
            generation,
        }
    }
}

#[derive(PartialEq, Eq)]
struct Identity {
    device: u64,
    inode: u64,
    size: u64,
    modified: i64,
    modified_ns: i64,
    changed: i64,
    changed_ns: i64,
}
impl Identity {
    fn read(file: &File, maximum: usize) -> Result<Self, ArchiveError> {
        let m = file.metadata().map_err(|_| ArchiveError::Unavailable)?;
        if !m.is_file()
            || m.mode() & 0o7777 != 0o600
            || m.uid() != rustix::process::geteuid().as_raw()
            || m.len() > maximum as u64
        {
            return Err(ArchiveError::Unavailable);
        }
        Ok(Self {
            device: m.dev(),
            inode: m.ino(),
            size: m.len(),
            modified: m.mtime(),
            modified_ns: m.mtime_nsec(),
            changed: m.ctime(),
            changed_ns: m.ctime_nsec(),
        })
    }
}
pub(super) fn check(budget: &WorkBudget) -> Result<(), ArchiveError> {
    budget.check().map_err(|_| ArchiveError::Unavailable)
}
pub(super) fn digest(bytes: &[u8], budget: &WorkBudget) -> Result<[u8; 32], ArchiveError> {
    let mut hasher = Sha256::new();
    for chunk in bytes.chunks(CHUNK) {
        check(budget)?;
        hasher.update(chunk);
    }
    check(budget)?;
    Ok(hasher.finalize().into())
}
pub(super) fn destination_current(
    directory: &File,
    destination: &ArchiveDestination,
) -> Result<(), ArchiveError> {
    let named = std::fs::symlink_metadata(destination.directory())
        .map_err(|_| ArchiveError::Unavailable)?;
    let opened = directory
        .metadata()
        .map_err(|_| ArchiveError::Unavailable)?;
    for m in [named, opened] {
        if !m.is_dir()
            || m.mode() & 0o7777 != 0o700
            || m.uid() != destination.owner()
            || m.uid() != rustix::process::geteuid().as_raw()
            || m.dev() != destination.device()
            || m.ino() != destination.inode()
        {
            return Err(ArchiveError::Unavailable);
        }
    }
    Ok(())
}
pub(super) fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 160
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        && name.starts_with("upload-history-")
        && !name.contains("..")
}
fn read_member_inner(
    directory: &File,
    name: &str,
    maximum: usize,
    budget: &WorkBudget,
    sync: bool,
) -> Result<(Vec<u8>, Identity), ArchiveError> {
    if !safe_name(name) {
        return Err(ArchiveError::Conflict);
    }
    check(budget)?;
    let fd = rustix::fs::openat(
        directory,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| ArchiveError::Unavailable)?;
    let mut file = File::from(fd);
    let before = Identity::read(&file, maximum)?;
    let length = usize::try_from(before.size).map_err(|_| ArchiveError::TooLarge)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length)
        .map_err(|_| ArchiveError::TooLarge)?;
    let mut buffer = [0u8; CHUNK];
    while bytes.len() < length {
        check(budget)?;
        let remaining = (length - bytes.len()).min(CHUNK);
        let n = file
            .read(&mut buffer[..remaining])
            .map_err(|_| ArchiveError::Unavailable)?;
        if n == 0 {
            return Err(ArchiveError::Conflict);
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
    check(budget)?;
    if file
        .read(&mut buffer[..1])
        .map_err(|_| ArchiveError::Unavailable)?
        != 0
        || Identity::read(&file, maximum)? != before
    {
        return Err(ArchiveError::Conflict);
    }
    if sync {
        file.sync_all().map_err(|_| ArchiveError::Unavailable)?;
    }
    if Identity::read(&file, maximum)? != before {
        return Err(ArchiveError::Conflict);
    }
    // Reopen the name to detect descriptor/name substitution during the read.
    let named = File::from(
        rustix::fs::openat(
            directory,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ArchiveError::Unavailable)?,
    );
    if Identity::read(&named, maximum)? != before {
        return Err(ArchiveError::Conflict);
    }
    check(budget)?;
    Ok((bytes, before))
}
pub(super) fn retain_member(
    directory: &File,
    name: &str,
    bytes: &[u8],
    maximum: usize,
    budget: &WorkBudget,
) -> Result<(), ArchiveError> {
    if !safe_name(name) {
        return Err(ArchiveError::Conflict);
    }
    if bytes.len() > maximum {
        return Err(ArchiveError::TooLarge);
    }
    check(budget)?;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| ArchiveError::Unavailable)?;
    let temporary = format!("upload-history-pending-{}", uuid::Uuid::from_bytes(nonce));
    let fd = rustix::fs::openat(
        directory,
        &temporary,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map_err(|_| ArchiveError::Unavailable)?;
    let mut file = File::from(fd);
    let result = (|| {
        rustix::fs::fchmod(&file, Mode::RUSR | Mode::WUSR)
            .map_err(|_| ArchiveError::Unavailable)?;
        for chunk in bytes.chunks(CHUNK) {
            check(budget)?;
            file.write_all(chunk)
                .map_err(|_| ArchiveError::Unavailable)?;
        }
        check(budget)?;
        file.sync_all().map_err(|_| ArchiveError::Unavailable)?;
        match rustix::fs::linkat(directory, &temporary, directory, name, AtFlags::empty()) {
            Ok(()) => {
                let (linked, identity) = read_member_inner(directory, name, maximum, budget, true)?;
                if identity != Identity::read(&file, maximum)? || linked.len() != bytes.len() {
                    return Err(ArchiveError::Conflict);
                }
                for (a, b) in linked.chunks(CHUNK).zip(bytes.chunks(CHUNK)) {
                    check(budget)?;
                    if a != b {
                        return Err(ArchiveError::Conflict);
                    }
                }
            }
            Err(rustix::io::Errno::EXIST) => {
                let (existing, _) = read_member_inner(directory, name, maximum, budget, true)?;
                if existing.len() != bytes.len() {
                    return Err(ArchiveError::Conflict);
                }
                for (a, b) in existing.chunks(CHUNK).zip(bytes.chunks(CHUNK)) {
                    check(budget)?;
                    if a != b {
                        return Err(ArchiveError::Conflict);
                    }
                }
            }
            Err(_) => return Err(ArchiveError::Unavailable),
        }
        rustix::fs::unlinkat(directory, &temporary, AtFlags::empty())
            .map_err(|_| ArchiveError::Unavailable)?;
        check(budget)?;
        directory
            .sync_all()
            .map_err(|_| ArchiveError::Unavailable)?;
        check(budget)
    })();
    if result.is_err() {
        let _ = rustix::fs::unlinkat(directory, &temporary, AtFlags::empty());
    }
    // Already linked immutable files remain DATA if a later step fails.
    result
}

/// Independently selected catalog reference. Caller-supplied expectation DATA
/// is not issuer authentication, operator approval or a discovery grant.
pub struct TrustedUploadHistoryArchiveReference<'a> {
    name: &'a str,
    envelope_sha256: [u8; 32],
    generation: u64,
    registry: &'a [crate::jobs::QueueConfig],
}
impl<'a> TrustedUploadHistoryArchiveReference<'a> {
    pub fn new(
        name: &'a str,
        envelope_sha256: [u8; 32],
        generation: u64,
        registry: &'a [crate::jobs::QueueConfig],
    ) -> Result<Self, ArchiveError> {
        if registry.len() > 256 || name != catalog_name(generation, envelope_sha256) {
            return Err(ArchiveError::Configuration);
        }
        Ok(Self {
            name,
            envelope_sha256,
            generation,
            registry,
        })
    }
    pub fn catalog_name(&self) -> &str {
        self.name
    }
    pub fn envelope_sha256(&self) -> [u8; 32] {
        self.envelope_sha256
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn registry(&self) -> &[crate::jobs::QueueConfig] {
        self.registry
    }
}
/// Checked local bytes remain unadmitted even when they match an independently
/// supplied catalog reference. Origin verification and approval are separate.
pub struct UnadmittedQueuedUploadHistoryArchive {
    envelope: Vec<u8>,
    catalog: Vec<u8>,
    generation: u64,
    destination: ArchiveDestination,
    members: Vec<UnadmittedQueuedUploadHistoryMember>,
}
pub struct UnadmittedQueuedUploadHistoryMember {
    name: String,
    bytes: Vec<u8>,
    sha256: [u8; 32],
    identity: Identity,
}
impl UnadmittedQueuedUploadHistoryMember {
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }
}
impl UnadmittedQueuedUploadHistoryArchive {
    pub fn envelope_bytes(&self) -> &[u8] {
        &self.envelope
    }
    pub fn catalog_bytes(&self) -> &[u8] {
        &self.catalog
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn destination(&self) -> &ArchiveDestination {
        &self.destination
    }
    pub fn members(&self) -> &[UnadmittedQueuedUploadHistoryMember] {
        &self.members
    }
}
pub(super) fn catalog_name(generation: u64, hash: [u8; 32]) -> String {
    format!("upload-history-{generation}-{}.catalog", hex_digest(hash))
}
pub(super) fn frame_name(hash: [u8; 32]) -> String {
    format!("upload-history-{}.frame", hex_digest(hash))
}
fn hex_digest(hash: [u8; 32]) -> String {
    use std::fmt::Write;
    let mut text = String::with_capacity(64);
    for byte in hash {
        let _ = write!(text, "{byte:02x}");
    }
    text
}
pub(super) fn read_archive(
    directory: &File,
    destination: &ArchiveDestination,
    expected: &TrustedUploadHistoryArchiveReference<'_>,
    maximum: usize,
    budget: &WorkBudget,
) -> Result<UnadmittedQueuedUploadHistoryArchive, ArchiveError> {
    use crate::config::recovery::upload_history_origin::UnadmittedSignedQueuedUploadHistoryCatalog;
    destination_current(directory, destination)?;
    let (envelope, envelope_identity) = read_member_inner(
        directory,
        expected.catalog_name(),
        ENVELOPE_LIMIT,
        budget,
        false,
    )?;
    if digest(&envelope, budget)? != expected.envelope_sha256() {
        return Err(ArchiveError::Conflict);
    }
    let signed = UnadmittedSignedQueuedUploadHistoryCatalog::parse(&envelope, budget)
        .map_err(|_| ArchiveError::Conflict)?;
    let catalog = signed.catalog();
    if catalog.generation() != expected.generation()
        || !signed.origin().matches_destination(destination)
        || !catalog
            .matches_registry(expected.registry(), budget)
            .map_err(|_| ArchiveError::Configuration)?
        || catalog.members().len() > MEMBER_LIMIT
        || signed.catalog_bytes().len() > CATALOG_LIMIT
    {
        return Err(ArchiveError::Conflict);
    }
    let mut members = Vec::new();
    members
        .try_reserve_exact(catalog.members().len())
        .map_err(|_| ArchiveError::TooLarge)?;
    let mut total = 0usize;
    for (index, member) in catalog.members().iter().enumerate() {
        check(budget)?;
        if member.name() != frame_name(member.sha256())
            || catalog.members()[..index]
                .iter()
                .any(|old| old.name() == member.name())
        {
            return Err(ArchiveError::Conflict);
        }
        let size = usize::try_from(member.byte_size()).map_err(|_| ArchiveError::TooLarge)?;
        if size > maximum.min(FRAME_LIMIT) {
            return Err(ArchiveError::TooLarge);
        }
        total = total.checked_add(size).ok_or(ArchiveError::TooLarge)?;
        if total > TOTAL_LIMIT {
            return Err(ArchiveError::TooLarge);
        }
        let (bytes, identity) = read_member_inner(directory, member.name(), size, budget, false)?;
        let hash = digest(&bytes, budget)?;
        if bytes.len() != size || hash != member.sha256() {
            return Err(ArchiveError::Conflict);
        }
        crate::app::homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame::parse(&bytes,budget)
            .map_err(|_|ArchiveError::Conflict)?;
        members.push(UnadmittedQueuedUploadHistoryMember {
            name: member.name().to_owned(),
            bytes,
            sha256: hash,
            identity,
        });
    }
    let mut catalog_bytes = Vec::new();
    catalog_bytes
        .try_reserve_exact(signed.catalog_bytes().len())
        .map_err(|_| ArchiveError::TooLarge)?;
    for chunk in signed.catalog_bytes().chunks(CHUNK) {
        check(budget)?;
        catalog_bytes.extend_from_slice(chunk);
    }
    // Re-read every selected descriptor/name after the whole set has been
    // captured, rather than asserting a full directory inventory. Older
    // generations and unreferenced partial DATA are deliberately retained.
    for member in &members {
        let (current, identity) =
            read_member_inner(directory, member.name(), member.bytes.len(), budget, false)?;
        if identity != member.identity || current.len() != member.bytes.len() {
            return Err(ArchiveError::Conflict);
        }
        for (a, b) in current.chunks(CHUNK).zip(member.bytes.chunks(CHUNK)) {
            check(budget)?;
            if a != b {
                return Err(ArchiveError::Conflict);
            }
        }
    }
    let (current, identity) = read_member_inner(
        directory,
        expected.catalog_name(),
        ENVELOPE_LIMIT,
        budget,
        false,
    )?;
    if identity != envelope_identity || digest(&current, budget)? != expected.envelope_sha256() {
        return Err(ArchiveError::Conflict);
    }
    destination_current(directory, destination)?;
    check(budget)?;
    Ok(UnadmittedQueuedUploadHistoryArchive {
        envelope,
        catalog: catalog_bytes,
        generation: expected.generation(),
        destination: destination.clone(),
        members,
    })
}
