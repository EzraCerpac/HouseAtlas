//! Read-only descriptor observations joined to admitted archived Media DATA.
//! This supplies no live stage, body grant, retry, restore or dispatch authority.
//! observe/revalidate perform descriptor I/O and must finish outside Storage
//! callbacks or held Storage transactions. Descriptors are current independent
//! read-only inputs, not proof of historical descriptor lineage.
use super::{MAX_BYTES, WorkBudget, native_queued_upload_archived::ArchivedQueuedUploadMediaFacts};
use crate::{
    app::homebox_queued_upload_history_catalog_admission::AdmittedQueuedUploadOriginalCatalogEntry,
    storage,
};
use sha2::{Digest as _, Sha256};
use std::{
    fs::File,
    io::ErrorKind,
    os::unix::fs::{FileExt, MetadataExt},
};

const CHUNK: usize = 64 * 1024;
const MAX_RESERVATION_BYTES: usize = 32 * 1024;

// Private descriptor baseline: identities and inode details are not exposed.
#[derive(PartialEq, Eq)]
struct ArchivedUploadFileObservation {
    device: u64,
    inode: u64,
    mode: u32,
    uid: u32,
    links: u64,
    byte_size: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}
impl ArchivedUploadFileObservation {
    fn capture(file: &File, budget: &WorkBudget) -> storage::Result<Self> {
        check(budget)?;
        let flags = rustix::fs::fcntl_getfl(file).map_err(|_| unavailable())?;
        if flags & rustix::fs::OFlags::ACCMODE != rustix::fs::OFlags::RDONLY {
            return Err(unavailable());
        }
        check(budget)?;
        let metadata = file.metadata().map_err(|_| unavailable())?;
        if !metadata.is_file()
            || metadata.mode() & 0o7777 != 0o600
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.nlink() != 1
        {
            return Err(unavailable());
        }
        let observed = Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            mode: metadata.mode(),
            uid: metadata.uid(),
            links: metadata.nlink(),
            byte_size: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        };
        check(budget)?;
        Ok(observed)
    }
}

/// Exact borrowed descriptors and sealed admission remain alive together. The
/// successful observation describes these bytes during its bounded read; it
/// cannot promise future availability or qualify MIME/content from a digest.
pub struct ArchivedQueuedUploadBodyObservation<'borrow, 'permit, 'bytes> {
    entry: &'borrow AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes>,
    facts: &'borrow ArchivedQueuedUploadMediaFacts<'permit, 'bytes>,
    reservation: &'borrow File,
    body: &'borrow File,
    reservation_observation: ArchivedUploadFileObservation,
    body_observation: ArchivedUploadFileObservation,
}
impl<'borrow, 'permit, 'bytes> ArchivedQueuedUploadBodyObservation<'borrow, 'permit, 'bytes> {
    pub fn observe(
        entry: &'borrow AdmittedQueuedUploadOriginalCatalogEntry<'permit, 'bytes>,
        facts: &'borrow ArchivedQueuedUploadMediaFacts<'permit, 'bytes>,
        reservation: &'borrow File,
        body: &'borrow File,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        // Real allocation/admission provenance precedes every candidate file or
        // metadata read. Equality labels cannot replace this three-owner seal.
        check(budget)?;
        if !entry.matches_media_facts(facts) {
            return Err(unavailable());
        }
        let expected_reservation = facts.reservation_bytes();
        let size = facts.measured_byte_size();
        if expected_reservation.is_empty()
            || expected_reservation.len() > MAX_RESERVATION_BYTES
            || size == 0
            || size > MAX_BYTES as u64
            || size != facts.staged_upload().byte_size
        {
            return Err(unavailable());
        }
        let reservation_observation = ArchivedUploadFileObservation::capture(reservation, budget)?;
        let body_observation = ArchivedUploadFileObservation::capture(body, budget)?;
        if reservation_observation.byte_size != expected_reservation.len() as u64
            || body_observation.byte_size != size
            || reservation_observation.device == body_observation.device
                && reservation_observation.inode == body_observation.inode
        {
            return Err(unavailable());
        }
        let observation = Self {
            entry,
            facts,
            reservation,
            body,
            reservation_observation,
            body_observation,
        };
        observation.revalidate(budget)?;
        Ok(observation)
    }
    pub fn reservation_byte_size(&self) -> u64 {
        self.reservation_observation.byte_size
    }
    pub fn body_byte_size(&self) -> u64 {
        self.body_observation.byte_size
    }
    /// The actual archived staged digest matched by the observation, not a new
    /// body permission or a substituted historical identity.
    pub fn archived_staged_sha256(&self) -> &str {
        self.facts.staged_upload().sha256.as_str()
    }

    pub fn revalidate(&self, budget: &WorkBudget) -> storage::Result<()> {
        check(budget)?;
        if !self.entry.matches_media_facts(self.facts) {
            return Err(unavailable());
        }
        self.fence(budget)?;
        let mut buffer = [0u8; CHUNK];
        let expected = self.facts.reservation_bytes();
        let mut offset = 0usize;
        while offset < expected.len() {
            self.fence(budget)?;
            let length = CHUNK.min(expected.len().checked_sub(offset).ok_or_else(unavailable)?);
            let count = read_at(
                self.reservation,
                &mut buffer[..length],
                offset as u64,
                budget,
            )?;
            if count == 0 {
                return Err(unavailable());
            }
            let end = offset
                .checked_add(count)
                .filter(|n| *n <= expected.len())
                .ok_or_else(unavailable)?;
            if buffer[..count] != expected[offset..end] {
                return Err(unavailable());
            }
            offset = end;
            self.fence(budget)?;
        }
        self.require_eof(self.reservation, expected.len() as u64, budget)?;
        self.fence(budget)?;
        let mut digest = Sha256::new();
        let size = self.body_observation.byte_size;
        let mut offset = 0u64;
        while offset < size {
            self.fence(budget)?;
            let length = usize::try_from(
                size.checked_sub(offset)
                    .ok_or_else(unavailable)?
                    .min(CHUNK as u64),
            )
            .map_err(|_| unavailable())?;
            let count = read_at(self.body, &mut buffer[..length], offset, budget)?;
            if count == 0 {
                return Err(unavailable());
            }
            digest.update(&buffer[..count]);
            offset = offset
                .checked_add(count as u64)
                .filter(|n| *n <= size)
                .ok_or_else(unavailable)?;
            self.fence(budget)?;
        }
        self.require_eof(self.body, size, budget)?;
        if format!("{:x}", digest.finalize()) != self.facts.staged_upload().sha256.as_str() {
            return Err(unavailable());
        }
        self.fence(budget)
    }
    fn require_eof(&self, file: &File, offset: u64, budget: &WorkBudget) -> storage::Result<()> {
        self.fence(budget)?;
        if read_at(file, &mut [0u8; 1], offset, budget)? != 0 {
            return Err(unavailable());
        }
        self.fence(budget)
    }
    fn fence(&self, budget: &WorkBudget) -> storage::Result<()> {
        check(budget)?;
        if !self.entry.matches_media_facts(self.facts)
            || ArchivedUploadFileObservation::capture(self.reservation, budget)?
                != self.reservation_observation
            || ArchivedUploadFileObservation::capture(self.body, budget)? != self.body_observation
        {
            return Err(unavailable());
        }
        check(budget)
    }
}
fn read_at(
    file: &File,
    buffer: &mut [u8],
    offset: u64,
    budget: &WorkBudget,
) -> storage::Result<usize> {
    loop {
        check(budget)?;
        match file.read_at(buffer, offset) {
            Ok(count) => {
                check(budget)?;
                return Ok(count);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(_) => return Err(unavailable()),
        }
    }
}
fn check(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Admitted archived upload descriptor observation unavailable",
    )
}
