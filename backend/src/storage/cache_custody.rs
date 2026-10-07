//! Custody and residency on the original Store connection. Native receipt,
//! catalog and recovery verification remain mandatory original producer ports.
use super::super::{cache_repository as repo, *};
use super::AtlasStore;
use rusqlite::{Transaction, TransactionBehavior};
use serde_json::Value;
use std::{fmt, sync::Arc};

pub const CACHE_PROTECTED_ENTRY_LIMIT: usize = 10_000;
pub const CACHE_ACTIVE_SEGMENT_BYTES: u64 = 16 * 1024 * 1024;
pub const CACHE_PROTECTED_CAPACITY_BYTES: u64 = 256 * 1024 * 1024;
pub const CACHE_ROW_BYTES: u64 = 10 * 1024 * 1024;

/// Development defaults, not deployed configuration or retention authority.
#[derive(Debug, Clone, Copy)]
pub struct CacheCapacityLimits {
    pub active_segment_bytes: u64,
    pub protected_capacity_bytes: u64,
    pub row_bytes: u64,
    pub protected_entries: usize,
}
impl Default for CacheCapacityLimits {
    fn default() -> Self {
        Self {
            active_segment_bytes: CACHE_ACTIVE_SEGMENT_BYTES,
            protected_capacity_bytes: CACHE_PROTECTED_CAPACITY_BYTES,
            row_bytes: CACHE_ROW_BYTES,
            protected_entries: CACHE_PROTECTED_ENTRY_LIMIT,
        }
    }
}

/// Implement on the original Native staged object, retaining its native receipt.
/// These borrows are metadata, not proof. The original reference owner must
/// verify this exact concrete object against its immutable bytes and receipt.
pub trait OriginalStagedCachePublication {
    fn registration(&self) -> &SourceRegistration;
    fn cache(&self) -> &CacheStatus;
    fn homebox_entities(&self) -> &[Value];
    fn network_relations(&self) -> &[Value];
    /// Lowercase SHA256 of the native immutable body, never projected-row JCS.
    fn native_sha256(&self) -> &str;
}

/// Original Native/catalog/recovery owner. No empty or permissive default.
/// Lock order is original Store first, then this owner; do not reacquire Access
/// or Store from `lock`, `enumerate` or `verify_staged`.
pub trait OriginalCacheReferences {
    type Staged: OriginalStagedCachePublication;
    type Guard<'a>: OriginalCacheReferenceGuard<Staged = Self::Staged>
    where
        Self: 'a;
    fn lock(&mut self) -> Result<Self::Guard<'_>>;
}

/// Holds the actual exclusive reference/catalog lock for its whole lifetime.
/// Enumeration must be complete, including every immutable staged/ambiguous
/// row, active disclosure, recovery and archive reference. Missing catalogs,
/// unknown custody, overflow and unverifiable bytes must return an error.
/// Implementations must never release references or delete rows in Drop.
pub trait OriginalCacheReferenceGuard {
    type Staged: OriginalStagedCachePublication;
    /// Original non-cloneable capacity reservation consumed by Native staging.
    type Admission;
    fn enumerate(&mut self, output: &mut CacheProtectionSink<'_>) -> Result<()>;
    /// Verify original issuer/receipt and exact full registration, partition,
    /// generation and native digest against original immutable stored bytes.
    fn verify_staged(&mut self, staged: &Self::Staged) -> Result<()>;
    /// Under the original catalog lock, exclude external publication ambiguity
    /// and any disclosure/recovery/archive reference for this exact candidate.
    /// A native durable stage alone is not a publication; unknown disposition
    /// must fail closed rather than treating SQL pointer absence as sufficient.
    fn verify_unpublished(&mut self, staged: &Self::Staged) -> Result<()>;
    /// Before transport/staging, atomically reserve the next complete bounded
    /// generation including catalog/segment overhead and other admissions.
    /// Enforce immutable rotation and total protected capacity, retaining all
    /// rows/references. The original reservation must survive Store release and
    /// bind this exact registration/candidate; actual staging must enforce it.
    fn admit_candidate(
        &mut self,
        registration: &SourceRegistration,
        generation_id: &str,
        native_bytes_upper_bound: u64,
        limits: CacheCapacityLimits,
        protected: &[ProtectedCacheGeneration],
    ) -> Result<Self::Admission>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheProtectionReason {
    Current,
    History,
    InFlightOrAmbiguous,
    Disclosure,
    Staged,
    StagedOrAmbiguous,
    Recovery,
    Archive,
}

/// Read-only inventory metadata. Possession never proves authority or custody.
#[derive(Debug)]
pub struct ProtectedCacheGeneration {
    registration: SourceRegistration,
    generation_id: String,
    native_sha256: Option<String>,
    reason: CacheProtectionReason,
}
impl ProtectedCacheGeneration {
    pub fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
    pub fn generation_id(&self) -> &str {
        &self.generation_id
    }
    pub fn native_sha256(&self) -> Option<&str> {
        self.native_sha256.as_deref()
    }
    pub fn reason(&self) -> CacheProtectionReason {
        self.reason
    }
}

/// Store-created bounded sink. An enumeration error remains sticky even if a
/// faulty peer ignores an individual `protect` error and returns success.
pub struct CacheProtectionSink<'a> {
    contract: &'a dyn Contract,
    entries: &'a mut Vec<ProtectedCacheGeneration>,
    failed: Option<Error>,
}
impl CacheProtectionSink<'_> {
    pub fn protect(
        &mut self,
        registration: &SourceRegistration,
        generation_id: &str,
        native_sha256: Option<&str>,
        reason: CacheProtectionReason,
    ) -> Result<()> {
        if let Some(error) = &self.failed {
            return Err(error.clone());
        }
        let result = (|| {
            if self.entries.len() >= CACHE_PROTECTED_ENTRY_LIMIT {
                return Err(capacity_error());
            }
            self.contract
                .validate_shape("sourceRegistration", &serde_json::to_value(registration)?)?;
            self.contract.validate_shape(
                "recordRef",
                &serde_json::to_value(RecordRef {
                    record_type: RecordType::Identity,
                    record_id: generation_id.to_owned(),
                })?,
            )?;
            if let Some(digest) = native_sha256 {
                validate_digest(digest)?;
            }
            self.entries.push(ProtectedCacheGeneration {
                registration: registration.clone(),
                generation_id: generation_id.into(),
                native_sha256: native_sha256.map(str::to_owned),
                reason,
            });
            Ok(())
        })();
        if let Err(error) = &result {
            self.failed = Some(error.clone());
        }
        result
    }
}

#[derive(Default)]
pub(super) struct CachePinRegistry {
    entries: Vec<ProtectedCacheGeneration>,
}
impl CachePinRegistry {
    pub(super) fn reserve(&mut self, fence: &CachePublicationFence) -> Result<()> {
        if self.entries.len() >= CACHE_PROTECTED_ENTRY_LIMIT {
            return Err(capacity_error());
        }
        if self.entries.iter().any(|pin| same_candidate(pin, fence)) {
            return Err(Error::new(
                "idempotency-conflict",
                "Cache candidate is already in flight",
            ));
        }
        self.entries.push(ProtectedCacheGeneration {
            registration: fence.registration.clone(),
            generation_id: fence.reserved_generation_id.clone(),
            native_sha256: None,
            reason: CacheProtectionReason::InFlightOrAmbiguous,
        });
        Ok(())
    }
    fn bind(&mut self, fence: &CachePublicationFence, digest: &str) -> Result<()> {
        validate_digest(digest)?;
        let pin = self
            .entries
            .iter_mut()
            .find(|pin| same_candidate(pin, fence))
            .ok_or(Error::new(
                "guard-conflict",
                "Original cache candidate pin unavailable",
            ))?;
        if pin
            .native_sha256
            .as_deref()
            .is_some_and(|prior| prior != digest)
        {
            return Err(Error::new(
                "guard-conflict",
                "Native candidate digest changed",
            ));
        }
        pin.native_sha256 = Some(digest.into());
        Ok(())
    }
    fn check(&self, fence: &CachePublicationFence, digest: &str) -> Result<()> {
        validate_digest(digest)?;
        let pin = self
            .entries
            .iter()
            .find(|pin| same_candidate(pin, fence))
            .ok_or(Error::new(
                "guard-conflict",
                "Original cache candidate pin unavailable",
            ))?;
        if pin
            .native_sha256
            .as_deref()
            .is_some_and(|prior| prior != digest)
        {
            return Err(Error::new(
                "guard-conflict",
                "Native candidate digest changed",
            ));
        }
        Ok(())
    }
}
fn same_candidate(pin: &ProtectedCacheGeneration, fence: &CachePublicationFence) -> bool {
    pin.registration == fence.registration && pin.generation_id == fence.reserved_generation_id
}
fn validate_digest(digest: &str) -> Result<()> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(Error::new(
            "invalid-contract",
            "Native generation digest is invalid",
        ));
    }
    Ok(())
}
fn capacity_error() -> Error {
    Error::new(
        "size-limit",
        "Complete protected generation inventory exceeds capacity",
    )
}

/// Ordinary publication errors retain the exact original fence. They do not
/// assert whether publication committed; only a live candidate guard can do so.
#[derive(Debug)]
pub struct RejectedCachePublication {
    error: Error,
    fence: Box<CachePublicationFence>,
}
impl RejectedCachePublication {
    pub fn error(&self) -> &Error {
        &self.error
    }
    pub fn into_parts(self) -> (Error, CachePublicationFence) {
        (self.error, *self.fence)
    }
}
pub struct RejectedStagedCachePublication<T> {
    error: Error,
    fence: Box<CachePublicationFence>,
    staged: Box<T>,
}
impl<T> fmt::Debug for RejectedStagedCachePublication<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RejectedStagedCachePublication")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}
impl<T> RejectedStagedCachePublication<T> {
    pub fn error(&self) -> &Error {
        &self.error
    }
    pub fn staged(&self) -> &T {
        &self.staged
    }
    pub fn into_parts(self) -> (Error, CachePublicationFence, T) {
        (self.error, *self.fence, *self.staged)
    }
}
pub struct PublishedStagedCachePublication<T> {
    cache: CacheStatus,
    staged: T,
}
impl<T> PublishedStagedCachePublication<T> {
    pub fn cache(&self) -> &CacheStatus {
        &self.cache
    }
    pub fn staged(&self) -> &T {
        &self.staged
    }
    pub fn into_parts(self) -> (CacheStatus, T) {
        (self.cache, self.staged)
    }
}

/// Owns the existing Store's IMMEDIATE transaction and actual peer guard. This
/// excludes another Store call and keeps catalog/recovery/disclosure pins live.
/// Inventory getters confer no Access grant. No deletion or retention release.
pub struct CacheResidencyGuard<'a, G> {
    transaction: Transaction<'a>,
    issuer: Arc<()>,
    references: G,
    protected: Vec<ProtectedCacheGeneration>,
}
impl<G: OriginalCacheReferenceGuard> CacheResidencyGuard<'_, G> {
    pub fn protected(&self) -> &[ProtectedCacheGeneration] {
        &self.protected
    }
    /// Original producer, retained under the same transaction and pins. Recovery
    /// must verify immutable bytes and transfer custody here before transition.
    pub fn original_references(&mut self) -> &mut G {
        &mut self.references
    }
    /// Call after preparing the original fence and before any provider work.
    /// Returns the genuine Native capacity reservation, never a DTO permit.
    pub fn admit_before_transport(
        &mut self,
        fence: &CachePublicationFence,
        native_bytes_upper_bound: u64,
    ) -> Result<G::Admission> {
        if !Arc::ptr_eq(&self.issuer, &fence.issuer)
            || native_bytes_upper_bound == 0
            || native_bytes_upper_bound > CACHE_ROW_BYTES
            || !self.protected.iter().any(|pin| same_candidate(pin, fence))
            || repo::source(&self.transaction, &fence.partition)? != fence.registration
            || repo::generation_reserved(
                &self.transaction,
                &fence.partition,
                &fence.reserved_generation_id,
            )?
        {
            return Err(Error::new(
                "guard-conflict",
                "Original bounded cache admission unavailable",
            ));
        }
        self.references.admit_candidate(
            &fence.registration,
            &fence.reserved_generation_id,
            native_bytes_upper_bound,
            CacheCapacityLimits::default(),
            &self.protected,
        )
    }
    /// Even a SQL commit error returns the original producer guard to its owner.
    pub fn release(self) -> (G, Result<()>) {
        let Self {
            transaction,
            references,
            ..
        } = self;
        (references, transaction.commit().map_err(Error::from))
    }
}

/// Definite absence from all Core publication history/current pointers under
/// original live pins. This is never permission to delete native bytes or to
/// release disclosure/recovery/archive/ambiguous references.
pub struct UnpublishedCacheCandidateGuard<'a, G: OriginalCacheReferenceGuard> {
    residency: CacheResidencyGuard<'a, G>,
    fence: CachePublicationFence,
    staged: G::Staged,
    digest: String,
}
impl<G: OriginalCacheReferenceGuard> UnpublishedCacheCandidateGuard<'_, G> {
    pub fn registration(&self) -> &SourceRegistration {
        self.fence.registration()
    }
    pub fn partition(&self) -> &SourcePartition {
        self.fence.partition()
    }
    pub fn reserved_generation_id(&self) -> &str {
        self.fence.reserved_generation_id()
    }
    pub fn native_sha256(&self) -> &str {
        &self.digest
    }
    pub fn staged(&self) -> &G::Staged {
        &self.staged
    }
    pub fn protected(&self) -> &[ProtectedCacheGeneration] {
        self.residency.protected()
    }
    pub fn original_references(&mut self) -> &mut G {
        self.residency.original_references()
    }
    /// Returns exact staged custody, original fence and original reference guard
    /// on both success and release failure; no implicit disposal in either case.
    pub fn release(self) -> (CachePublicationFence, G::Staged, G, Result<()>) {
        let (references, result) = self.residency.release();
        (self.fence, self.staged, references, result)
    }
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn publish_prepared_generation_with_custody(
        &mut self,
        principal: &A::Principal,
        fence: CachePublicationFence,
        cache: &CacheStatus,
        homebox_entities: &[Value],
        network_relations: &[Value],
    ) -> std::result::Result<CacheStatus, RejectedCachePublication> {
        self.cache_transaction()
            .publish_prepared_generation_ref(
                principal,
                &fence,
                cache,
                homebox_entities,
                network_relations,
            )
            .map_err(|error| RejectedCachePublication {
                error,
                fence: Box::new(fence),
            })
    }
    pub fn publish_prepared_generation_with_custody_and_authorization<B: Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        fence: CachePublicationFence,
        cache: &CacheStatus,
        homebox_entities: &[Value],
        network_relations: &[Value],
    ) -> std::result::Result<CacheStatus, RejectedCachePublication> {
        self.cache_transaction_with_authorization(authorization)
            .publish_prepared_generation_ref(
                principal,
                &fence,
                cache,
                homebox_entities,
                network_relations,
            )
            .map_err(|error| RejectedCachePublication {
                error,
                fence: Box::new(fence),
            })
    }

    pub fn publish_staged_generation<P: OriginalCacheReferences>(
        &mut self,
        principal: &A::Principal,
        fence: CachePublicationFence,
        staged: P::Staged,
        references: &mut P,
    ) -> std::result::Result<
        PublishedStagedCachePublication<P::Staged>,
        RejectedStagedCachePublication<P::Staged>,
    > {
        let result = (|| {
            let mut original = references.lock()?;
            self.bind_staged(&fence, &staged, &mut original)?;
            self.cache_transaction().publish_prepared_generation_ref(
                principal,
                &fence,
                staged.cache(),
                staged.homebox_entities(),
                staged.network_relations(),
            )
        })();
        staged_outcome(result, fence, staged)
    }
    pub fn publish_staged_generation_with_authorization<
        B: Authorization,
        P: OriginalCacheReferences,
    >(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        fence: CachePublicationFence,
        staged: P::Staged,
        references: &mut P,
    ) -> std::result::Result<
        PublishedStagedCachePublication<P::Staged>,
        RejectedStagedCachePublication<P::Staged>,
    > {
        let result = (|| {
            let mut original = references.lock()?;
            self.bind_staged(&fence, &staged, &mut original)?;
            self.cache_transaction_with_authorization(authorization)
                .publish_prepared_generation_ref(
                    principal,
                    &fence,
                    staged.cache(),
                    staged.homebox_entities(),
                    staged.network_relations(),
                )
        })();
        staged_outcome(result, fence, staged)
    }
    fn bind_staged<G: OriginalCacheReferenceGuard>(
        &mut self,
        fence: &CachePublicationFence,
        staged: &G::Staged,
        references: &mut G,
    ) -> Result<()> {
        match_staged(&self.instance, fence, staged)?;
        references.verify_staged(staged)?;
        self.cache_pins.bind(fence, staged.native_sha256())
    }

    /// Internal residency boundary, not a disclosure authorization. Caller must
    /// retain original Access grants separately through final release.
    pub fn guard_cache_residency<'a, P: OriginalCacheReferences>(
        &'a mut self,
        references: &'a mut P,
    ) -> Result<CacheResidencyGuard<'a, P::Guard<'a>>> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut original = references.lock()?;
        let mut protected = Vec::new();
        let mut sink = CacheProtectionSink {
            contract: &self.contract,
            entries: &mut protected,
            failed: None,
        };
        enumerate_sql(&transaction, &mut sink)?;
        for pin in &self.cache_pins.entries {
            sink.protect(
                &pin.registration,
                &pin.generation_id,
                pin.native_sha256.as_deref(),
                pin.reason,
            )?;
        }
        original.enumerate(&mut sink)?;
        if let Some(error) = sink.failed {
            return Err(error);
        }
        Ok(CacheResidencyGuard {
            transaction,
            issuer: Arc::clone(&self.instance),
            references: original,
            protected,
        })
    }

    pub fn guard_unpublished_candidate<'a, P: OriginalCacheReferences>(
        &'a mut self,
        fence: CachePublicationFence,
        staged: <P::Guard<'a> as OriginalCacheReferenceGuard>::Staged,
        references: &'a mut P,
    ) -> std::result::Result<
        UnpublishedCacheCandidateGuard<'a, P::Guard<'a>>,
        RejectedStagedCachePublication<<P::Guard<'a> as OriginalCacheReferenceGuard>::Staged>,
    > {
        let result = self.acquire_candidate_residency(&fence, &staged, references);
        match result {
            Ok(residency) => {
                let digest = staged.native_sha256().to_owned();
                Ok(UnpublishedCacheCandidateGuard {
                    residency,
                    fence,
                    staged,
                    digest,
                })
            }
            Err(error) => Err(RejectedStagedCachePublication {
                error,
                fence: Box::new(fence),
                staged: Box::new(staged),
            }),
        }
    }

    fn acquire_candidate_residency<'a, P: OriginalCacheReferences>(
        &'a mut self,
        fence: &CachePublicationFence,
        staged: &<P::Guard<'a> as OriginalCacheReferenceGuard>::Staged,
        references: &'a mut P,
    ) -> Result<CacheResidencyGuard<'a, P::Guard<'a>>> {
        match_staged(&self.instance, fence, staged)?;
        self.cache_pins.check(fence, staged.native_sha256())?;
        let mut residency = self.guard_cache_residency(references)?;
        residency.references.verify_staged(staged)?;
        residency.references.verify_unpublished(staged)?;
        if residency.protected.iter().any(|pin| {
            same_candidate(pin, fence)
                && !matches!(
                    pin.reason,
                    CacheProtectionReason::InFlightOrAmbiguous | CacheProtectionReason::Staged
                )
        }) {
            return Err(Error::new(
                "guard-conflict",
                "Candidate has external protected or ambiguous references",
            ));
        }
        if repo::source(&residency.transaction, &fence.partition)? != fence.registration
            || repo::generation_reserved(
                &residency.transaction,
                &fence.partition,
                &fence.reserved_generation_id,
            )?
            || repo::cache(&residency.transaction, &fence.partition)?.is_some_and(|cache| {
                cache.generation_id.as_deref() == Some(fence.reserved_generation_id.as_str())
            })
        {
            return Err(Error::new(
                "guard-conflict",
                "Candidate publication is protected or changed",
            ));
        }
        Ok(residency)
    }
}

fn staged_outcome<T>(
    result: Result<CacheStatus>,
    fence: CachePublicationFence,
    staged: T,
) -> std::result::Result<PublishedStagedCachePublication<T>, RejectedStagedCachePublication<T>> {
    match result {
        Ok(cache) => Ok(PublishedStagedCachePublication { cache, staged }),
        Err(error) => Err(RejectedStagedCachePublication {
            error,
            fence: Box::new(fence),
            staged: Box::new(staged),
        }),
    }
}
fn match_staged<T: OriginalStagedCachePublication>(
    instance: &Arc<()>,
    fence: &CachePublicationFence,
    staged: &T,
) -> Result<()> {
    if !Arc::ptr_eq(instance, &fence.issuer)
        || staged.registration() != &fence.registration
        || fence.registration.partition() != fence.partition
        || staged.cache().partition() != fence.partition
        || staged.cache().generation_id.as_deref() != Some(fence.reserved_generation_id.as_str())
    {
        return Err(Error::new(
            "guard-conflict",
            "Original staged candidate does not match its Store fence",
        ));
    }
    validate_digest(staged.native_sha256())
}
fn enumerate_sql(db: &rusqlite::Connection, sink: &mut CacheProtectionSink<'_>) -> Result<()> {
    for (sql, reason) in [
        (
            "SELECT workspace_id,home_id,source_instance_id,collection_id,generation_id FROM cache_generations ORDER BY workspace_id,home_id,source_instance_id,collection_id,generation_id",
            CacheProtectionReason::History,
        ),
        (
            "SELECT workspace_id,home_id,source_instance_id,collection_id,json_extract(body,'$.generationId') FROM caches WHERE json_extract(body,'$.generationId') IS NOT NULL ORDER BY workspace_id,home_id,source_instance_id,collection_id",
            CacheProtectionReason::Current,
        ),
    ] {
        let mut statement = db.prepare(sql)?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let partition = SourcePartition {
                workspace_id: row.get(0)?,
                home_id: row.get(1)?,
                source_instance_id: row.get(2)?,
                collection_id: row.get(3)?,
            };
            let registration = repo::source(db, &partition)?;
            if registration.partition() != partition {
                return Err(Error::new(
                    "schema-incompatible",
                    "Protected source registration is incompatible",
                ));
            }
            let generation_id: String = row.get(4)?;
            if reason == CacheProtectionReason::Current
                && !repo::generation_reserved(db, &partition, &generation_id)?
            {
                return Err(Error::new(
                    "schema-incompatible",
                    "Current generation reservation unavailable",
                ));
            }
            sink.protect(&registration, &generation_id, None, reason)?;
        }
    }
    Ok(())
}
