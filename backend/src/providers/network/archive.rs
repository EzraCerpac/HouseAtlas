//! Append-only archive of the actual Network inventory response bodies.
//!
//! Every reservation is made from the Store's original reserved generation ID
//! before transport. The catalog never evicts or rewrites retained generations.
//! This Network owner does not issue Storage pins; original Storage reference
//! guard integration remains required for accepted custody transfer.
use super::projection::validate_registration;
use super::{
    CompleteGenerationProposal, DurableNetworkReceipt, Limits, LinkReview, NetworkCapture,
    NetworkError, NetworkGeneration, SourceRegistration, SourceScope, project_capture,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_ACTIVE_SEGMENT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_RETAINED_SEGMENT_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_ARCHIVE_ROW_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const FRAME_PREFIX_BYTES: usize = 12;
const MAX_HEADER_BYTES: usize = 5 * 1024 * 1024;
const FORMAT: &str = "houseatlas-network-raw-segment/1";

fn err() -> NetworkError {
    NetworkError::new(super::ErrorCode::Upstream)
}
fn invalid() -> NetworkError {
    NetworkError::new(super::ErrorCode::InvalidSchema)
}
fn size() -> NetworkError {
    NetworkError::new(super::ErrorCode::SizeLimit)
}
fn ensure(ok: bool) -> Result<(), NetworkError> {
    if ok { Ok(()) } else { Err(invalid()) }
}
type Result<T, E = NetworkError> = std::result::Result<T, E>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct SegmentHeader {
    format: String,
    registration: SourceRegistration,
    source_attestation: SourceScope,
    generation_id: String,
    attempted_at: String,
    retrieved_at: String,
    source_snapshot_at: Option<String>,
    limits: Limits,
    link_review: LinkReview,
    body_bytes: usize,
    body_sha256: String,
    projected_receipt_sha256: String,
}

/// Store-issued capacity and generation reservation. No public constructor or
/// Clone: callers can only obtain it from the open canonical archive.
pub struct NetworkArchiveReservation {
    partition_key: String,
    generation_id: String,
    reserved_bytes: usize,
}

/// The immutable raw body receipt, coupled to the original projected-sidecar
/// receipt and source/generation identity. Its fields cannot be synthesized.
pub struct NetworkArchiveReceipt {
    partition_key: String,
    generation_id: String,
    body_sha256: String,
    projected_receipt_sha256: String,
    segment_sha256: String,
    segment_name: String,
    segment_bytes: usize,
}
impl NetworkArchiveReceipt {
    pub fn partition_key(&self) -> &str {
        &self.partition_key
    }
    pub fn generation_id(&self) -> &str {
        &self.generation_id
    }
    pub fn body_sha256(&self) -> &str {
        &self.body_sha256
    }
    pub fn projected_receipt_sha256(&self) -> &str {
        &self.projected_receipt_sha256
    }
    pub fn segment_sha256(&self) -> &str {
        &self.segment_sha256
    }
    pub fn segment_name(&self) -> &str {
        &self.segment_name
    }
    pub fn segment_bytes(&self) -> usize {
        self.segment_bytes
    }
}

/// Exact original registration/generation/body binding returned by verified
/// archive reopen. This is evidence data, not a live principal, Store pin, or
/// publication receipt.
pub struct ReopenedNetworkCapture {
    header: SegmentHeader,
    body: Vec<u8>,
    generation: NetworkGeneration,
}
impl ReopenedNetworkCapture {
    pub fn body(&self) -> &[u8] {
        &self.body
    }
    pub fn body_sha256(&self) -> &str {
        &self.header.body_sha256
    }
    pub fn projected_receipt_sha256(&self) -> &str {
        &self.header.projected_receipt_sha256
    }
    pub fn registration(&self) -> &SourceRegistration {
        &self.header.registration
    }
    pub fn generation_id(&self) -> &str {
        &self.header.generation_id
    }
    pub fn generation(&self) -> &NetworkGeneration {
        &self.generation
    }
    pub fn retrieved_at(&self) -> &str {
        &self.header.retrieved_at
    }
    pub fn source_snapshot_at(&self) -> Option<&str> {
        self.header.source_snapshot_at.as_deref()
    }
}

/// One row from the complete Network-owned archive catalog. This carries no
/// Store permission; Storage must merge it with its own current/history and
/// in-flight references under the original exclusive guard.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NetworkArchiveReference {
    pub(crate) partition_key: String,
    pub(crate) generation_id: String,
    pub(crate) state: NetworkArchiveReferenceState,
    pub(crate) body_sha256: Option<String>,
    pub(crate) projected_receipt_sha256: Option<String>,
    pub(crate) protected_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NetworkArchiveReferenceState {
    PermanentlyReserved,
    CapacityReserved,
    Sealed,
}

pub struct NetworkImmutableArchive {
    db: Connection,
    segments: PathBuf,
}
impl NetworkImmutableArchive {
    /// Open beneath the already-validated private settings directory. Existing
    /// catalog rows and segment bytes are fully enumerated and hash-verified;
    /// missing, extra, oversized, or partial files fail closed.
    pub fn open(path: &Path) -> Result<Self> {
        if !path.is_absolute() {
            return Err(invalid());
        }
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {}
            Ok(_) => return Err(invalid()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(err()),
        }
        let parent = path.parent().ok_or_else(invalid)?;
        let parent_meta = fs::symlink_metadata(parent).map_err(|_| err())?;
        if !parent_meta.is_dir() || parent_meta.file_type().is_symlink() {
            return Err(invalid());
        }
        let segments = path.with_extension("segments");
        if !segments.exists() {
            fs::create_dir(&segments).map_err(|_| err())?;
            set_private_dir(&segments)?;
            sync_dir(parent)?;
        }
        let meta = fs::symlink_metadata(&segments).map_err(|_| err())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(invalid());
        }
        let db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| err())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| err())?;
        let tables: Vec<String> = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(|_| err())?
            .query_map([], |r| r.get(0))
            .map_err(|_| err())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| err())?;
        if !tables.is_empty() {
            let expected = [
                "network_archive_catalog",
                "network_archive_generation_ids",
                "network_archive_meta",
                "network_archive_reservations",
            ];
            ensure(
                tables.len() == expected.len()
                    && expected.iter().all(|n| tables.iter().any(|t| t == n)),
            )?;
            let versions: Vec<i64> = db
                .prepare("SELECT version FROM network_archive_meta")
                .map_err(|_| err())?
                .query_map([], |r| r.get(0))
                .map_err(|_| err())?
                .collect::<std::result::Result<_, _>>()
                .map_err(|_| err())?;
            ensure(versions == [1])?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
            CREATE TABLE IF NOT EXISTS network_archive_meta(version INTEGER PRIMARY KEY CHECK(version=1));
            INSERT OR IGNORE INTO network_archive_meta VALUES(1);
            CREATE TABLE IF NOT EXISTS network_archive_generation_ids(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,PRIMARY KEY(partition_key,generation_id));
            CREATE TRIGGER IF NOT EXISTS network_archive_ids_no_update BEFORE UPDATE ON network_archive_generation_ids BEGIN SELECT RAISE(ABORT,'permanent generation id'); END;
            CREATE TRIGGER IF NOT EXISTS network_archive_ids_no_delete BEFORE DELETE ON network_archive_generation_ids BEGIN SELECT RAISE(ABORT,'permanent generation id'); END;
            CREATE TABLE IF NOT EXISTS network_archive_reservations(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>0),PRIMARY KEY(partition_key,generation_id));
            CREATE TABLE IF NOT EXISTS network_archive_catalog(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,body_sha256 TEXT NOT NULL,projected_receipt_sha256 TEXT NOT NULL,segment_sha256 TEXT NOT NULL,segment_name TEXT NOT NULL UNIQUE,segment_bytes INTEGER NOT NULL CHECK(segment_bytes>0),header_json TEXT NOT NULL,PRIMARY KEY(partition_key,generation_id));
            CREATE TRIGGER IF NOT EXISTS network_archive_catalog_no_update BEFORE UPDATE ON network_archive_catalog BEGIN SELECT RAISE(ABORT,'immutable catalog'); END;
            CREATE TRIGGER IF NOT EXISTS network_archive_catalog_no_delete BEFORE DELETE ON network_archive_catalog BEGIN SELECT RAISE(ABORT,'immutable catalog'); END;") .map_err(|_| err())?;
        set_private_file(path)?;
        let archive = Self { db, segments };
        archive.verify_complete_catalog()?;
        Ok(archive)
    }

    /// Reserve worst-case raw-row and metadata capacity before the provider is
    /// constructed or called. The generation ID is permanently burned even if
    /// a subsequent transport fails; only unused byte reservation may be
    /// explicitly cancelled before any segment write begins.
    pub fn reserve(
        &mut self,
        registration: &SourceRegistration,
        review: &LinkReview,
        generation_id: &str,
        limits: Limits,
    ) -> Result<NetworkArchiveReservation> {
        validate_registration(registration)?;
        ensure(super::projection::uuid(generation_id))?;
        let partition_key = super::partition_key(&registration.scope)?;
        let reserved_bytes = reservation_size(registration, review, generation_id, limits)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| err())?;
        let total = accounted_bytes(&tx)?;
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM network_archive_generation_ids",
                [],
                |r| r.get(0),
            )
            .map_err(|_| err())?;
        if count >= MAX_ARCHIVE_ENTRIES as i64
            || total
                .checked_add(reserved_bytes)
                .is_none_or(|v| v > MAX_RETAINED_SEGMENT_BYTES)
        {
            return Err(size());
        }
        tx.execute(
            "INSERT INTO network_archive_generation_ids VALUES(?1,?2)",
            params![partition_key, generation_id],
        )
        .map_err(|_| invalid())?;
        tx.execute(
            "INSERT INTO network_archive_reservations VALUES(?1,?2,?3)",
            params![partition_key, generation_id, reserved_bytes as i64],
        )
        .map_err(|_| err())?;
        tx.commit().map_err(|_| err())?;
        Ok(NetworkArchiveReservation {
            partition_key,
            generation_id: generation_id.into(),
            reserved_bytes,
        })
    }

    /// Release only a clean, pre-stage reservation after the producer reports a
    /// definite no-generation outcome. The permanent generation-ID row remains.
    /// No segment/catalog deletion or retained-generation release exists.
    pub fn cancel_before_stage(&mut self, reservation: NetworkArchiveReservation) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| err())?;
        let stored: Option<i64> = tx.query_row("SELECT reserved_bytes FROM network_archive_reservations WHERE partition_key=?1 AND generation_id=?2", params![reservation.partition_key, reservation.generation_id], |r| r.get(0)).optional().map_err(|_| err())?;
        ensure(stored == Some(reservation.reserved_bytes as i64))?;
        tx.execute(
            "DELETE FROM network_archive_reservations WHERE partition_key=?1 AND generation_id=?2",
            params![reservation.partition_key, reservation.generation_id],
        )
        .map_err(|_| err())?;
        tx.commit().map_err(|_| err())?;
        Ok(())
    }

    /// Persist the genuine producer capture into a new sealed segment. The raw
    /// digest is computed before projection; the receipt also binds the actual
    /// native projected-sidecar receipt. Every uncertain failure leaves its
    /// permanent reservation and any written bytes in place for fail-closed
    /// recovery; this method never removes a segment.
    pub fn stage_original(
        &mut self,
        reservation: NetworkArchiveReservation,
        proposal: &CompleteGenerationProposal,
        projected: &DurableNetworkReceipt,
    ) -> Result<NetworkArchiveReceipt> {
        let capture = proposal.original_capture();
        let state = proposal.state();
        let generation = state.generation.as_ref().ok_or_else(invalid)?;
        let expected_partition = super::partition_key(&capture.registration().scope)?;
        ensure(
            reservation.partition_key == expected_partition
                && reservation.generation_id == capture.generation_id()
                && projected.partition_key() == reservation.partition_key
                && projected.generation_id() == reservation.generation_id
                && state.cache.generation_id.as_deref() == Some(capture.generation_id())
                && state.cache.status == super::CacheStatus::Fresh
                && capture.body_sha256().len() == 64
                && capture.body().len() <= MAX_ARCHIVE_ROW_BYTES,
        )?;
        let rebuilt = project_capture(
            capture.registration(),
            NetworkCapture {
                source: capture.source_attestation(),
                document: capture.body(),
                retrieved_at: capture.retrieved_at(),
                source_snapshot_at: capture.source_snapshot_at(),
            },
            &generation.link_review,
            capture.limits(),
        )?;
        ensure(&rebuilt == generation)?;
        let (reserved, existing): (Option<i64>, Option<String>) = (
            self.db.query_row("SELECT reserved_bytes FROM network_archive_reservations WHERE partition_key=?1 AND generation_id=?2", params![reservation.partition_key, reservation.generation_id], |r| r.get(0)).optional().map_err(|_| err())?,
            self.db.query_row("SELECT body_sha256 FROM network_archive_catalog WHERE partition_key=?1 AND generation_id=?2", params![reservation.partition_key, reservation.generation_id], |r| r.get(0)).optional().map_err(|_| err())?,
        );
        ensure(reserved == Some(reservation.reserved_bytes as i64) && existing.is_none())?;
        ensure(projected.sha256().len() == 64)?;
        let header = SegmentHeader {
            format: FORMAT.into(),
            registration: capture.registration().clone(),
            source_attestation: capture.source_attestation().clone(),
            generation_id: capture.generation_id().into(),
            attempted_at: capture.attempted_at().into(),
            retrieved_at: capture.retrieved_at().into(),
            source_snapshot_at: capture.source_snapshot_at().map(str::to_owned),
            limits: capture.limits(),
            link_review: generation.link_review.clone(),
            body_bytes: capture.body().len(),
            body_sha256: capture.body_sha256().into(),
            projected_receipt_sha256: projected.sha256().into(),
        };
        let header_json = serde_json::to_vec(&header).map_err(|_| invalid())?;
        let frame_bytes = FRAME_PREFIX_BYTES
            .checked_add(header_json.len())
            .and_then(|v| v.checked_add(capture.body().len()))
            .ok_or_else(size)?;
        if header_json.len() > MAX_HEADER_BYTES
            || frame_bytes > MAX_ACTIVE_SEGMENT_BYTES
            || frame_bytes > reservation.reserved_bytes
        {
            return Err(size());
        }
        let segment_name = segment_name(&reservation.partition_key, &reservation.generation_id);
        let final_path = self.segments.join(&segment_name);
        let active_path = self.segments.join(format!("{segment_name}.active"));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&active_path)
            .map_err(|_| err())?;
        file.write_all(&(header_json.len() as u32).to_le_bytes())
            .map_err(|_| err())?;
        file.write_all(&(capture.body().len() as u64).to_le_bytes())
            .map_err(|_| err())?;
        file.write_all(&header_json).map_err(|_| err())?;
        file.write_all(capture.body()).map_err(|_| err())?;
        file.sync_all().map_err(|_| err())?;
        drop(file);
        verify_segment(&active_path, &header, capture.body())?;
        fs::rename(&active_path, &final_path).map_err(|_| err())?;
        sync_dir(&self.segments)?;
        verify_segment(&final_path, &header, capture.body())?;
        let segment_sha256 = digest(&read_bounded_segment(&final_path)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| err())?;
        let current: Option<i64> = tx.query_row("SELECT reserved_bytes FROM network_archive_reservations WHERE partition_key=?1 AND generation_id=?2", params![reservation.partition_key, reservation.generation_id], |r| r.get(0)).optional().map_err(|_| err())?;
        ensure(current == Some(reservation.reserved_bytes as i64))?;
        let header_text = String::from_utf8(header_json).map_err(|_| invalid())?;
        tx.execute(
            "INSERT INTO network_archive_catalog VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                reservation.partition_key,
                reservation.generation_id,
                capture.body_sha256(),
                projected.sha256(),
                segment_sha256,
                segment_name,
                frame_bytes as i64,
                header_text
            ],
        )
        .map_err(|_| err())?;
        tx.execute(
            "DELETE FROM network_archive_reservations WHERE partition_key=?1 AND generation_id=?2",
            params![reservation.partition_key, reservation.generation_id],
        )
        .map_err(|_| err())?;
        tx.commit().map_err(|_| err())?;
        Ok(NetworkArchiveReceipt {
            partition_key: reservation.partition_key,
            generation_id: reservation.generation_id,
            body_sha256: capture.body_sha256().into(),
            projected_receipt_sha256: projected.sha256().into(),
            segment_sha256,
            segment_name,
            segment_bytes: frame_bytes,
        })
    }

    /// Reopen exact immutable raw bytes, verify their catalog and both hashes,
    /// and reproject them through the stored original review/limits. No SQL
    /// current pointer or Storage authority is inferred by this operation.
    pub fn reopen(
        &self,
        registration: &SourceRegistration,
        generation_id: &str,
    ) -> Result<ReopenedNetworkCapture> {
        let partition_key = super::partition_key(&registration.scope)?;
        let (name, bytes, catalog_digest, projected_digest, segment_digest, header_json): (String, i64, String, String, String, String) = self.db.query_row(
            "SELECT segment_name,segment_bytes,body_sha256,projected_receipt_sha256,segment_sha256,header_json FROM network_archive_catalog WHERE partition_key=?1 AND generation_id=?2",
            params![partition_key, generation_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|_| err())?;
        if bytes < FRAME_PREFIX_BYTES as i64 || bytes as usize > MAX_ACTIVE_SEGMENT_BYTES {
            return Err(size());
        }
        let path = self.segments.join(&name);
        let segment = read_bounded_segment(&path)?;
        ensure(segment.len() == bytes as usize && digest(&segment) == segment_digest)?;
        let (header, body) = decode_segment(&segment)?;
        ensure(
            header.registration == *registration
                && header.source_attestation == registration.scope
                && header.generation_id == generation_id
                && header.body_sha256 == catalog_digest
                && header.projected_receipt_sha256 == projected_digest
                && serde_json::to_string(&header).map_err(|_| invalid())? == header_json,
        )?;
        ensure(
            body.len() == header.body_bytes
                && body.len() <= MAX_ARCHIVE_ROW_BYTES
                && digest(&body) == header.body_sha256,
        )?;
        let generation = project_capture(
            &header.registration,
            NetworkCapture {
                source: &header.source_attestation,
                document: &body,
                retrieved_at: &header.retrieved_at,
                source_snapshot_at: header.source_snapshot_at.as_deref(),
            },
            &header.link_review,
            header.limits,
        )?;
        ensure(
            header.source_attestation == header.registration.scope
                && generation.scope == header.source_attestation
                && generation.source_revision > 0,
        )?;
        Ok(ReopenedNetworkCapture {
            header,
            body,
            generation,
        })
    }

    /// Complete enumeration of this Network archive's permanent generation
    /// IDs, active reservations, and sealed segments. Storage's current/history
    /// pointers and live Store pins are a separate required part of its GAT
    /// guard; this list is never a default or complete cross-owner substitute.
    pub(crate) fn protected_references(&self) -> Result<Vec<NetworkArchiveReference>> {
        self.verify_complete_catalog()?;
        let mut stmt = self.db.prepare("SELECT g.partition_key,g.generation_id,c.body_sha256,c.segment_bytes,r.reserved_bytes,c.projected_receipt_sha256 FROM network_archive_generation_ids g LEFT JOIN network_archive_catalog c USING(partition_key,generation_id) LEFT JOIN network_archive_reservations r USING(partition_key,generation_id) ORDER BY g.partition_key,g.generation_id").map_err(|_| err())?;
        let mut rows = stmt.query([]).map_err(|_| err())?;
        let mut result = Vec::new();
        while let Some(row) = rows.next().map_err(|_| err())? {
            if result.len() >= MAX_ARCHIVE_ENTRIES {
                return Err(size());
            }
            let partition_key: String = row.get(0).map_err(|_| err())?;
            let generation_id: String = row.get(1).map_err(|_| err())?;
            let body_sha256: Option<String> = row.get(2).map_err(|_| err())?;
            let segment_bytes: Option<i64> = row.get(3).map_err(|_| err())?;
            let reserved_bytes: Option<i64> = row.get(4).map_err(|_| err())?;
            let projected_receipt_sha256: Option<String> = row.get(5).map_err(|_| err())?;
            let (state, protected_bytes) =
                match (body_sha256.is_some(), segment_bytes, reserved_bytes) {
                    (true, Some(bytes), None) if bytes > 0 => {
                        (NetworkArchiveReferenceState::Sealed, bytes as usize)
                    }
                    (false, None, Some(bytes)) if bytes > 0 => (
                        NetworkArchiveReferenceState::CapacityReserved,
                        bytes as usize,
                    ),
                    (false, None, None) => (NetworkArchiveReferenceState::PermanentlyReserved, 0),
                    _ => return Err(invalid()),
                };
            result.push(NetworkArchiveReference {
                partition_key,
                generation_id,
                state,
                body_sha256,
                projected_receipt_sha256,
                protected_bytes,
            });
        }
        drop(rows);
        drop(stmt);
        Ok(result)
    }

    /// Enumerate and verify every catalog row. Bounded at 10,000 and fail-closed
    /// for any orphan, missing, symlinked, partial or hash-mismatched segment.
    fn verify_complete_catalog(&self) -> Result<()> {
        let mut stmt = self.db.prepare("SELECT partition_key,generation_id,body_sha256,projected_receipt_sha256,segment_sha256,segment_name,segment_bytes,header_json FROM network_archive_catalog ORDER BY partition_key,generation_id").map_err(|_| err())?;
        let mut rows = stmt.query([]).map_err(|_| err())?;
        let mut expected = BTreeSet::new();
        let mut count = 0usize;
        let mut total = 0usize;
        while let Some(row) = rows.next().map_err(|_| err())? {
            count = count.checked_add(1).ok_or_else(size)?;
            if count > MAX_ARCHIVE_ENTRIES {
                return Err(size());
            }
            let partition: String = row.get(0).map_err(|_| err())?;
            let generation: String = row.get(1).map_err(|_| err())?;
            let body_hash: String = row.get(2).map_err(|_| err())?;
            let projected_hash: String = row.get(3).map_err(|_| err())?;
            let segment_hash: String = row.get(4).map_err(|_| err())?;
            let name: String = row.get(5).map_err(|_| err())?;
            let segment_bytes: i64 = row.get(6).map_err(|_| err())?;
            let header_json: String = row.get(7).map_err(|_| err())?;
            if segment_bytes <= 0 || segment_bytes as usize > MAX_ACTIVE_SEGMENT_BYTES {
                return Err(size());
            }
            total = total.checked_add(segment_bytes as usize).ok_or_else(size)?;
            if total > MAX_RETAINED_SEGMENT_BYTES {
                return Err(size());
            }
            ensure(name == segment_name(&partition, &generation) && expected.insert(name.clone()))?;
            let path = self.segments.join(&name);
            let bytes = read_bounded_segment(&path)?;
            ensure(bytes.len() == segment_bytes as usize && digest(&bytes) == segment_hash)?;
            let (header, body) = decode_segment(&bytes)?;
            ensure(
                header.body_sha256 == body_hash
                    && header.projected_receipt_sha256 == projected_hash
                    && header.generation_id == generation
                    && header.source_attestation == header.registration.scope
                    && super::partition_key(&header.registration.scope)? == partition
                    && body.len() == header.body_bytes
                    && digest(&body) == body_hash
                    && serde_json::to_string(&header).map_err(|_| invalid())? == header_json,
            )?;
            let projected = project_capture(
                &header.registration,
                NetworkCapture {
                    source: &header.source_attestation,
                    document: &body,
                    retrieved_at: &header.retrieved_at,
                    source_snapshot_at: header.source_snapshot_at.as_deref(),
                },
                &header.link_review,
                header.limits,
            )?;
            validate_registration(&header.registration)?;
            ensure(projected.scope == header.source_attestation)?;
        }
        drop(rows);
        drop(stmt);
        let permanent: i64 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM network_archive_generation_ids",
                [],
                |r| r.get(0),
            )
            .map_err(|_| err())?;
        if permanent < 0 || permanent as usize > MAX_ARCHIVE_ENTRIES {
            return Err(size());
        }
        let unpinned: i64 = self.db.query_row("SELECT (SELECT COUNT(*) FROM network_archive_catalog c LEFT JOIN network_archive_generation_ids g USING(partition_key,generation_id) WHERE g.generation_id IS NULL)+(SELECT COUNT(*) FROM network_archive_reservations r LEFT JOIN network_archive_generation_ids g USING(partition_key,generation_id) WHERE g.generation_id IS NULL)", [], |r| r.get(0)).map_err(|_| err())?;
        ensure(unpinned == 0)?;
        let reserved: i64 = self
            .db
            .query_row(
                "SELECT COALESCE(SUM(reserved_bytes),0) FROM network_archive_reservations",
                [],
                |r| r.get(0),
            )
            .map_err(|_| err())?;
        if reserved < 0
            || total
                .checked_add(reserved as usize)
                .is_none_or(|v| v > MAX_RETAINED_SEGMENT_BYTES)
        {
            return Err(size());
        }
        for entry in fs::read_dir(&self.segments).map_err(|_| err())? {
            let entry = entry.map_err(|_| err())?;
            let ty = entry.file_type().map_err(|_| err())?;
            let name = entry.file_name().into_string().map_err(|_| invalid())?;
            if !ty.is_file() || ty.is_symlink() || !expected.contains(&name) {
                return Err(invalid());
            }
        }
        Ok(())
    }
    pub fn close(self) -> Result<()> {
        self.db.close().map_err(|_| err())
    }
}

fn reservation_size(
    registration: &SourceRegistration,
    review: &LinkReview,
    generation_id: &str,
    limits: Limits,
) -> Result<usize> {
    let worst = SegmentHeader {
        format: FORMAT.into(),
        registration: registration.clone(),
        source_attestation: registration.scope.clone(),
        generation_id: generation_id.into(),
        attempted_at: "9".repeat(64),
        retrieved_at: "9".repeat(64),
        source_snapshot_at: Some("9".repeat(64)),
        limits,
        link_review: review.clone(),
        body_bytes: MAX_ARCHIVE_ROW_BYTES,
        body_sha256: "f".repeat(64),
        projected_receipt_sha256: "f".repeat(64),
    };
    let header = serde_json::to_vec(&worst).map_err(|_| invalid())?;
    if header.len() > MAX_HEADER_BYTES {
        return Err(size());
    }
    let required = FRAME_PREFIX_BYTES
        .checked_add(header.len())
        .and_then(|v| v.checked_add(MAX_ARCHIVE_ROW_BYTES))
        .ok_or_else(size)?;
    if required > MAX_ACTIVE_SEGMENT_BYTES {
        return Err(size());
    }
    Ok(required)
}
fn accounted_bytes(db: &Connection) -> Result<usize> {
    let (segments, reservations): (i64, i64) = db.query_row("SELECT COALESCE((SELECT SUM(segment_bytes) FROM network_archive_catalog),0),COALESCE((SELECT SUM(reserved_bytes) FROM network_archive_reservations),0)", [], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|_| err())?;
    if segments < 0 || reservations < 0 {
        return Err(invalid());
    }
    (segments as usize)
        .checked_add(reservations as usize)
        .ok_or_else(size)
}
fn segment_name(partition: &str, generation: &str) -> String {
    let mut h = Sha256::new();
    h.update(partition.as_bytes());
    h.update([0]);
    h.update(generation.as_bytes());
    format!("network-{:x}.seg", h.finalize())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read_bounded_segment(path: &Path) -> Result<Vec<u8>> {
    let path_meta = fs::symlink_metadata(path).map_err(|_| err())?;
    if !path_meta.is_file()
        || path_meta.file_type().is_symlink()
        || path_meta.len() > MAX_ACTIVE_SEGMENT_BYTES as u64
    {
        return Err(invalid());
    }
    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|_| err())?;
    let opened_meta = file.metadata().map_err(|_| err())?;
    if !opened_meta.is_file() || opened_meta.len() > MAX_ACTIVE_SEGMENT_BYTES as u64 {
        return Err(invalid());
    }
    let mut bounded = file.take(MAX_ACTIVE_SEGMENT_BYTES as u64 + 1);
    let mut bytes = Vec::with_capacity(opened_meta.len() as usize);
    bounded.read_to_end(&mut bytes).map_err(|_| err())?;
    if bytes.len() as u64 > MAX_ACTIVE_SEGMENT_BYTES as u64 {
        return Err(size());
    }
    ensure(bytes.len() as u64 == opened_meta.len())?;
    Ok(bytes)
}

fn read_segment(path: &Path) -> Result<(SegmentHeader, Vec<u8>)> {
    let bytes = read_bounded_segment(path)?;
    decode_segment(&bytes)
}

fn decode_segment(bytes: &[u8]) -> Result<(SegmentHeader, Vec<u8>)> {
    if bytes.len() < FRAME_PREFIX_BYTES || bytes.len() > MAX_ACTIVE_SEGMENT_BYTES {
        return Err(size());
    }
    let mut prefix = [0u8; FRAME_PREFIX_BYTES];
    prefix.copy_from_slice(&bytes[..FRAME_PREFIX_BYTES]);
    let header_len = u32::from_le_bytes(prefix[..4].try_into().map_err(|_| invalid())?) as usize;
    let body_len = u64::from_le_bytes(prefix[4..].try_into().map_err(|_| invalid())?) as usize;
    if header_len == 0 || header_len > MAX_HEADER_BYTES || body_len > MAX_ARCHIVE_ROW_BYTES {
        return Err(size());
    }
    let expected = FRAME_PREFIX_BYTES
        .checked_add(header_len)
        .and_then(|v| v.checked_add(body_len))
        .ok_or_else(size)?;
    if expected != bytes.len() {
        return Err(invalid());
    }
    let header_end = FRAME_PREFIX_BYTES + header_len;
    let header: SegmentHeader =
        serde_json::from_slice(&bytes[FRAME_PREFIX_BYTES..header_end]).map_err(|_| invalid())?;
    let body = bytes[header_end..].to_vec();
    if header.format != FORMAT {
        return Err(invalid());
    }
    Ok((header, body))
}
fn verify_segment(path: &Path, expected: &SegmentHeader, expected_body: &[u8]) -> Result<()> {
    let (header, body) = read_segment(path)?;
    ensure(&header == expected && body == expected_body && digest(&body) == expected.body_sha256)?;
    Ok(())
}
fn sync_dir(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|_| err())
}
fn set_private_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| err())?;
    }
    Ok(())
}
fn set_private_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| err())?;
    }
    Ok(())
}
