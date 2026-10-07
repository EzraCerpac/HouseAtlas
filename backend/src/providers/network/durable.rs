//! Native SQLite retained sidecar. Separate from Atlas cache/publication storage.
//! It commits immutable generation rows before the host publishes their pointer.
use super::sidecar::{MAX_PACKET_BYTES, MAX_ROW_BYTES, MAX_ROWS};
use super::{
    model::{Result, guard},
    projection::validate_registration,
    *,
};
use crate::storage::OriginalStagedCachePublication;
use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use std::{collections::BTreeSet, path::Path};

pub struct SqliteNetworkSidecar {
    db: Connection,
    sources: Vec<SourceRegistration>,
    archive: super::NetworkImmutableArchive,
}
pub struct DurableNetworkReceipt {
    partition_key: String,
    generation_id: String,
    sha256: String,
}
impl DurableNetworkReceipt {
    pub fn partition_key(&self) -> &str {
        &self.partition_key
    }
    pub fn generation_id(&self) -> &str {
        &self.generation_id
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}
impl SqliteNetworkSidecar {
    /// Trusted private host path and immutable source registry, never browser
    /// input. Native SQLite FULL/WAL commits supply the durable stage boundary.
    pub fn open(path: &Path, sources: &[SourceRegistration]) -> Result<Self> {
        let mut keys = BTreeSet::new();
        for source in sources {
            validate_registration(source)?;
            guard(keys.insert(partition_key(&source.scope)?))?;
        }
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            guard(meta.is_file() && !meta.file_type().is_symlink())?;
        }
        let db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(sql_error)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(sql_error)?;
        let tables: Vec<String> = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(sql_error)?
            .query_map([], |r| r.get(0))
            .map_err(sql_error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(sql_error)?;
        if !tables.is_empty() {
            guard(
                tables.len() == 2
                    && tables.iter().any(|v| v == "core_network_meta")
                    && tables.iter().any(|v| v == "core_network_generations"),
            )?;
            let versions: Vec<i64> = db
                .prepare("SELECT version FROM core_network_meta")
                .map_err(sql_error)?
                .query_map([], |r| r.get(0))
                .map_err(sql_error)?
                .collect::<std::result::Result<_, _>>()
                .map_err(sql_error)?;
            guard(versions == [1])?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
            CREATE TABLE IF NOT EXISTS core_network_meta(version INTEGER PRIMARY KEY CHECK(version=1));
            INSERT OR IGNORE INTO core_network_meta VALUES(1);
            CREATE TABLE IF NOT EXISTS core_network_generations(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(partition_key,generation_id));
            CREATE TRIGGER IF NOT EXISTS core_network_no_update BEFORE UPDATE ON core_network_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;
            CREATE TRIGGER IF NOT EXISTS core_network_no_delete BEFORE DELETE ON core_network_generations BEGIN SELECT RAISE(ABORT,'immutable generation'); END;").map_err(sql_error)?;
        let archive =
            super::NetworkImmutableArchive::open(&path.with_extension("raw-archive.sqlite"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| NetworkError::new(ErrorCode::Upstream))?;
        }
        Ok(Self {
            db,
            sources: sources.to_vec(),
            archive,
        })
    }
    pub fn close(self) -> Result<()> {
        self.archive.close()?;
        self.db
            .close()
            .map_err(|_| NetworkError::new(ErrorCode::Upstream))
    }
    pub fn reserve_original_capture(
        &mut self,
        source: &SourceRegistration,
        review: &LinkReview,
        generation_id: &str,
        limits: Limits,
    ) -> Result<super::NetworkArchiveReservation> {
        guard(self.sources.iter().any(|v| v == source))?;
        self.archive.reserve(source, review, generation_id, limits)
    }
    pub fn cancel_original_capture(
        &mut self,
        reservation: super::NetworkArchiveReservation,
    ) -> Result<()> {
        self.archive.cancel_before_stage(reservation)
    }
    pub fn stage_original_capture(
        &mut self,
        reservation: super::NetworkArchiveReservation,
        proposal: &CompleteGenerationProposal,
        projected: &DurableNetworkReceipt,
    ) -> Result<super::NetworkArchiveReceipt> {
        self.archive
            .stage_original(reservation, proposal, projected)
    }
    pub fn reopen_original_capture(
        &self,
        source: &SourceRegistration,
        generation_id: &str,
    ) -> Result<super::ReopenedNetworkCapture> {
        guard(self.sources.iter().any(|v| v == source))?;
        self.archive.reopen(source, generation_id)
    }
    pub(crate) fn protected_archive_references(
        &self,
    ) -> Result<Vec<super::archive::NetworkArchiveReference>> {
        self.archive.protected_references()
    }
}
impl DurableNetworkSidecar for SqliteNetworkSidecar {
    type Receipt = DurableNetworkReceipt;
    fn stage(&mut self, source: &SourceRegistration, row: &SidecarRow) -> Result<Self::Receipt> {
        guard(
            self.sources.iter().any(|v| v == source)
                && row.partition_key == partition_key(&source.scope)?,
        )?;
        validate_sidecar_packet(
            &SidecarPacket {
                format: SIDECAR_FORMAT.into(),
                rows: vec![row.clone()],
            },
            &self.sources,
        )?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        bound_stored_rows(&tx)?;
        let mut rows: Vec<SidecarRow> = tx.prepare("SELECT partition_key,generation_id,sha256,body FROM core_network_generations ORDER BY partition_key,generation_id").map_err(sql_error)?
            .query_map([], |r| Ok(SidecarRow { partition_key: r.get(0)?, generation_id: r.get(1)?, sha256: r.get(2)?, body: r.get(3)? })).map_err(sql_error)?
            .collect::<std::result::Result<_, _>>().map_err(sql_error)?;
        let existing = rows
            .iter()
            .find(|v| v.partition_key == row.partition_key && v.generation_id == row.generation_id);
        validate_immutable_replay(existing, row)?;
        if existing.is_none() {
            rows.push(row.clone());
            validate_sidecar_packet(
                &SidecarPacket {
                    format: SIDECAR_FORMAT.into(),
                    rows,
                },
                &self.sources,
            )?;
            tx.execute(
                "INSERT INTO core_network_generations VALUES(?1,?2,?3,?4)",
                params![row.partition_key, row.generation_id, row.sha256, row.body],
            )
            .map_err(sql_error)?;
        }
        tx.commit().map_err(sql_error)?;
        Ok(DurableNetworkReceipt {
            partition_key: row.partition_key.clone(),
            generation_id: row.generation_id.clone(),
            sha256: row.sha256.clone(),
        })
    }
    fn load(&self, source: &SourceRegistration, generation_id: &str) -> Result<SidecarRow> {
        guard(self.sources.iter().any(|v| v == source))?;
        bound_stored_rows(&self.db)?;
        let row = self.db.query_row("SELECT partition_key,generation_id,sha256,body FROM core_network_generations WHERE partition_key=?1 AND generation_id=?2",
            params![partition_key(&source.scope)?,generation_id], |r| Ok(SidecarRow { partition_key:r.get(0)?,generation_id:r.get(1)?,sha256:r.get(2)?,body:r.get(3)? })).map_err(sql_error)?;
        validate_sidecar_packet(
            &SidecarPacket {
                format: SIDECAR_FORMAT.into(),
                rows: vec![row.clone()],
            },
            &self.sources,
        )?;
        Ok(row)
    }
}

/// Exact Network owner adapter for Store's OriginalCacheReferences GAT. The
/// GAT guard takes the existing sidecar mutex only after Store has opened its
/// transaction; this is not a second reference store or an Access/Store callback.
pub struct NetworkCacheReferences<'a> {
    sidecar: &'a std::sync::Mutex<SqliteNetworkSidecar>,
    source: &'a SourceRegistration,
    review: &'a LinkReview,
    limits: Limits,
}
impl<'a> NetworkCacheReferences<'a> {
    pub fn new(
        sidecar: &'a std::sync::Mutex<SqliteNetworkSidecar>,
        source: &'a SourceRegistration,
        review: &'a LinkReview,
        limits: Limits,
    ) -> Self {
        Self {
            sidecar,
            source,
            review,
            limits,
        }
    }
}
pub struct NetworkCacheReferenceGuard<'a> {
    source: &'a SourceRegistration,
    review: &'a LinkReview,
    limits: Limits,
    sidecar: std::sync::MutexGuard<'a, SqliteNetworkSidecar>,
}
impl<'owner> crate::storage::OriginalCacheReferences for NetworkCacheReferences<'owner> {
    type Staged =
        super::StagedNetworkPublication<super::NetworkStagingReceipt<DurableNetworkReceipt>>;
    type Guard<'a>
        = NetworkCacheReferenceGuard<'a>
    where
        Self: 'a;
    fn lock(&mut self) -> crate::storage::Result<Self::Guard<'_>> {
        let sidecar = self
            .sidecar
            .try_lock()
            .map_err(|_| storage_network_conflict())?;
        Ok(NetworkCacheReferenceGuard {
            source: self.source,
            review: self.review,
            limits: self.limits,
            sidecar,
        })
    }
}
impl crate::storage::OriginalCacheReferenceGuard for NetworkCacheReferenceGuard<'_> {
    type Staged =
        super::StagedNetworkPublication<super::NetworkStagingReceipt<DurableNetworkReceipt>>;
    type Admission = super::NetworkArchiveReservation;

    fn enumerate(
        &mut self,
        output: &mut crate::storage::CacheProtectionSink<'_>,
    ) -> crate::storage::Result<()> {
        let refs = self
            .sidecar
            .protected_archive_references()
            .map_err(storage_network_error)?;
        for reference in refs {
            let source = self
                .sidecar
                .sources
                .iter()
                .find(|source| {
                    super::partition_key(&source.scope).ok().as_deref()
                        == Some(reference.partition_key.as_str())
                })
                .ok_or_else(storage_network_conflict)?;
            let registration = storage_registration(source)?;
            let reason = match reference.state {
                super::archive::NetworkArchiveReferenceState::PermanentlyReserved => {
                    crate::storage::CacheProtectionReason::StagedOrAmbiguous
                }
                super::archive::NetworkArchiveReferenceState::CapacityReserved => {
                    crate::storage::CacheProtectionReason::InFlightOrAmbiguous
                }
                super::archive::NetworkArchiveReferenceState::Sealed => {
                    crate::storage::CacheProtectionReason::Archive
                }
            };
            output.protect(
                &registration,
                &reference.generation_id,
                reference.body_sha256.as_deref(),
                reason,
            )?;
        }
        Ok(())
    }

    fn verify_staged(&mut self, staged: &Self::Staged) -> crate::storage::Result<()> {
        let receipt = staged.receipt();
        let original = receipt.original();
        let capture = self
            .sidecar
            .reopen_original_capture(self.source, original.generation_id())
            .map_err(storage_network_error)?;
        let source_registration = storage_registration(capture.registration())?;
        let expected_row =
            super::stage_row(self.source, staged.proposal()).map_err(storage_network_error)?;
        let stored_row = self
            .sidecar
            .load(self.source, original.generation_id())
            .map_err(storage_network_error)?;
        if &source_registration != staged.registration()
            || capture.registration() != self.source
            || staged.cache().generation_id.as_deref() != Some(original.generation_id())
            || staged.native_sha256() != capture.body_sha256()
            || capture.projected_receipt_sha256() != receipt.projected().sha256()
            || receipt.projected().partition_key() != expected_row.partition_key
            || receipt.projected().generation_id() != expected_row.generation_id
            || receipt.projected().sha256() != expected_row.sha256
            || stored_row != expected_row
            || capture.generation()
                != staged
                    .proposal()
                    .state()
                    .generation
                    .as_ref()
                    .ok_or_else(storage_network_conflict)?
        {
            return Err(storage_network_conflict());
        }
        Ok(())
    }

    fn verify_unpublished(&mut self, _staged: &Self::Staged) -> crate::storage::Result<()> {
        // Network has no original unpublished-disposition receipt yet. A raw
        // archive row cannot prove absence from publication history.
        Err(storage_network_conflict())
    }

    fn admit_candidate(
        &mut self,
        registration: &crate::storage::SourceRegistration,
        generation_id: &str,
        native_bytes_upper_bound: u64,
        limits: crate::storage::CacheCapacityLimits,
        protected: &[crate::storage::ProtectedCacheGeneration],
    ) -> crate::storage::Result<Self::Admission> {
        let network_registration: SourceRegistration = serde_json::from_value(
            serde_json::to_value(registration).map_err(crate::storage::Error::from)?,
        )
        .map_err(crate::storage::Error::from)?;
        if registration.owner != crate::storage::SourceOwner::Network
            || registration != &storage_registration(self.source)?
            || &network_registration != self.source
            || native_bytes_upper_bound == 0
            || native_bytes_upper_bound > limits.row_bytes
            || limits.active_segment_bytes as usize != super::archive::MAX_ACTIVE_SEGMENT_BYTES
            || limits.protected_capacity_bytes as usize
                != super::archive::MAX_RETAINED_SEGMENT_BYTES
            || limits.row_bytes as usize != super::archive::MAX_ARCHIVE_ROW_BYTES
            || limits.protected_entries != super::archive::MAX_ARCHIVE_ENTRIES
            || !protected
                .iter()
                .any(|p| p.registration() == registration && p.generation_id() == generation_id)
        {
            return Err(storage_network_conflict());
        }
        let archive_refs = self
            .sidecar
            .protected_archive_references()
            .map_err(storage_network_error)?;
        // Do not let a projected-only or otherwise untracked Network pointer
        // disappear from capacity accounting. Every Network Store pin must map
        // to an immutable/reserved catalog generation with its exact digest.
        for pin in protected
            .iter()
            .filter(|p| p.registration().owner == crate::storage::SourceOwner::Network)
        {
            let source = self
                .sidecar
                .sources
                .iter()
                .find(|s| storage_registration(s).ok().as_ref() == Some(pin.registration()))
                .ok_or_else(storage_network_conflict)?;
            let key = super::partition_key(&source.scope).map_err(storage_network_error)?;
            let found = archive_refs
                .iter()
                .find(|r| r.partition_key == key && r.generation_id == pin.generation_id());
            // The exact fence candidate is inserted by Store before this
            // callback, so its first admission necessarily precedes its first
            // Network catalog row. No other missing Network pin is accepted.
            if pin.registration() == registration
                && pin.generation_id() == generation_id
                && pin.reason() == crate::storage::CacheProtectionReason::InFlightOrAmbiguous
                && found.is_none()
            {
                continue;
            }
            let found = found.ok_or_else(storage_network_conflict)?;
            if pin
                .native_sha256()
                .is_some_and(|digest| found.body_sha256.as_deref() != Some(digest))
                || found.state == super::archive::NetworkArchiveReferenceState::PermanentlyReserved
            {
                return Err(storage_network_conflict());
            }
        }
        self.sidecar
            .reserve_original_capture(self.source, self.review, generation_id, self.limits)
            .map_err(storage_network_error)
    }
}

fn storage_registration(
    source: &SourceRegistration,
) -> crate::storage::Result<crate::storage::SourceRegistration> {
    serde_json::from_value(serde_json::to_value(source).map_err(crate::storage::Error::from)?)
        .map_err(crate::storage::Error::from)
}
fn storage_network_error(_: NetworkError) -> crate::storage::Error {
    crate::storage::Error::new(
        "upstream-unavailable",
        "Network original catalog is unavailable",
    )
}
fn storage_network_conflict() -> crate::storage::Error {
    crate::storage::Error::new(
        "guard-conflict",
        "Network original catalog cannot prove custody",
    )
}
// Inspect SQLite lengths before materializing retained strings. The exact
// canonical-packet quota is still checked by validate_sidecar_packet at stage.
fn bound_stored_rows(db: &Connection) -> Result<()> {
    let (count, bytes, largest): (i64, i64, i64) = db.query_row(
        "SELECT COUNT(*),COALESCE(SUM(length(CAST(partition_key AS BLOB))+length(CAST(generation_id AS BLOB))+length(CAST(sha256 AS BLOB))+length(CAST(body AS BLOB))),0),COALESCE(MAX(length(CAST(body AS BLOB))),0) FROM core_network_generations",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(sql_error)?;
    if count > MAX_ROWS as i64 || bytes > MAX_PACKET_BYTES as i64 || largest > MAX_ROW_BYTES as i64
    {
        return Err(NetworkError::new(ErrorCode::SizeLimit));
    }
    Ok(())
}
fn sql_error(_error: rusqlite::Error) -> NetworkError {
    NetworkError::new(ErrorCode::Upstream)
}
