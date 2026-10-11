//! Custody and residency on the original Store connection. Native receipt,
//! catalog and recovery verification remain mandatory original producer ports.
use super::super::{cache_repository as repo, *};
use super::AtlasStore;
use rusqlite::{Transaction, TransactionBehavior};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::{Arc, Weak},
};

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
    /// Planning coverage only, never reclamation authority. Existing owners
    /// without an actual complete disclosure/recovery registry remain unknown.
    fn reclamation_coverage(&self) -> CacheReferenceCoverage {
        CacheReferenceCoverage::Unknown
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheReferenceCoverage {
    Unknown,
    /// Original owner has enumerated all live disclosure, retained history,
    /// recovery and external pins under the same exclusive reference guard.
    Complete,
}

/// Distinguishes a burned identifier fact from a retained payload reference.
/// Original owners cannot label their own history as a Store reservation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheProtectionOrigin {
    StoreReservation,
    StoreReference,
    StorePin,
    OriginalOwner,
}

/// Read-only inventory metadata. Possession never proves authority or custody.
#[derive(Debug)]
pub struct ProtectedCacheGeneration {
    registration: SourceRegistration,
    generation_id: String,
    native_sha256: Option<String>,
    reason: CacheProtectionReason,
    origin: CacheProtectionOrigin,
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
    pub fn origin(&self) -> CacheProtectionOrigin {
        self.origin
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
        self.protect_with_origin(
            registration,
            generation_id,
            native_sha256,
            reason,
            CacheProtectionOrigin::OriginalOwner,
        )
    }
    fn protect_with_origin(
        &mut self,
        registration: &SourceRegistration,
        generation_id: &str,
        native_sha256: Option<&str>,
        reason: CacheProtectionReason,
        origin: CacheProtectionOrigin,
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
                origin,
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
    disclosures: Vec<Weak<CacheDisclosureLease>>,
}

struct CacheDisclosureLease {
    issuer: Arc<()>,
    registration: SourceRegistration,
    generation_id: String,
    baseline_sha256: [u8; 32],
}

/// Original same-Store lifetime pin. No public constructor, Clone, persistence
/// or release operation. Retaining the enclosing original disclosure's Arc
/// retains this token; dropping it performs no IO or lock acquisition.
pub struct CacheDisclosurePin {
    lease: Arc<CacheDisclosureLease>,
}
impl CacheDisclosurePin {
    pub fn registration(&self) -> &SourceRegistration {
        &self.lease.registration
    }
    pub fn generation_id(&self) -> &str {
        &self.lease.generation_id
    }
}

/// Issued only by the actual authorized Store read. The optional pin is absent
/// only when the validated Network baseline has no generation pointer.
pub struct PinnedCacheRead {
    read: RegisteredCacheRead,
    pin: Option<CacheDisclosurePin>,
}
impl PinnedCacheRead {
    pub fn read(&self) -> &RegisteredCacheRead {
        &self.read
    }
    pub fn into_parts(self) -> (RegisteredCacheRead, Option<CacheDisclosurePin>) {
        (self.read, self.pin)
    }
}

fn disclosure_baseline_digest(read: &RegisteredCacheRead) -> Result<[u8; 32]> {
    Ok(Sha256::digest(serde_json::to_vec(&(&read.registration, &read.state))?).into())
}

fn disclosure_conflict() -> Error {
    Error::new(
        "guard-conflict",
        "Original cache disclosure pin unavailable",
    )
}

impl CachePinRegistry {
    fn live_disclosures(&mut self) -> Vec<Arc<CacheDisclosureLease>> {
        self.disclosures.retain(|pin| pin.strong_count() != 0);
        self.disclosures.iter().filter_map(Weak::upgrade).collect()
    }
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
            origin: CacheProtectionOrigin::StorePin,
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

/// An explicit owner request for these exact archived bytes. No age/count
/// cutoff, broad partition release, or deletion capability is represented.
#[derive(Debug)]
pub struct CacheReclamationRequest {
    registration: SourceRegistration,
    generation_id: String,
    native_sha256: String,
}
impl CacheReclamationRequest {
    pub fn archived_payload(
        registration: SourceRegistration,
        generation_id: String,
        native_sha256: String,
    ) -> Result<Self> {
        if registration.owner != SourceOwner::Network {
            return Err(reclamation_error());
        }
        validate_digest(&native_sha256)?;
        Ok(Self {
            registration,
            generation_id,
            native_sha256,
        })
    }
}
#[derive(Debug)]
pub struct CacheReclamationPolicy {
    revision: String,
    requests: Vec<CacheReclamationRequest>,
}
impl CacheReclamationPolicy {
    pub fn new(revision: String, requests: Vec<CacheReclamationRequest>) -> Result<Self> {
        if revision.is_empty()
            || revision.len() > 128
            || revision.trim() != revision
            || !revision.is_ascii()
            || revision.bytes().any(|byte| byte.is_ascii_control())
            || requests.len() > CACHE_PROTECTED_ENTRY_LIMIT
        {
            return Err(reclamation_error());
        }
        let mut keys = BTreeSet::new();
        for request in &requests {
            if !keys.insert(generation_key(
                &request.registration,
                &request.generation_id,
            )) {
                return Err(reclamation_error());
            }
        }
        Ok(Self { revision, requests })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheReclamationBlocker {
    OwnerPolicyAbsent,
    ExternalReferencesUnknown,
    UnknownGeneration,
    UnknownPublicationDisposition,
    RegistrationConflict,
    NativeDigestUnavailableOrConflicting,
    RequestedDigestMismatch,
    RetainedReference(CacheProtectionReason),
}
/// Advisory metadata only. Even an empty blocker list supplies no authority,
/// proof, receipt, grant, or method capable of deleting bytes or burned IDs.
#[derive(Debug)]
pub struct CacheReclamationEntry {
    pub registration: SourceRegistration,
    pub generation_id: String,
    pub native_sha256: Option<String>,
    pub reference_count: usize,
    pub reasons: Vec<CacheProtectionReason>,
    pub blockers: Vec<CacheReclamationBlocker>,
    pub burned_identifier_present: bool,
}
impl CacheReclamationEntry {
    pub fn owner_policy_candidate(&self) -> bool {
        self.blockers.is_empty()
    }
}
#[derive(Debug)]
pub struct CacheReclamationPlan {
    pub policy_revision: String,
    pub coverage: CacheReferenceCoverage,
    pub entries: Vec<CacheReclamationEntry>,
}
type GenerationKey = (String, String, String, String, String);
fn generation_key(registration: &SourceRegistration, id: &str) -> GenerationKey {
    (
        registration.workspace_id.clone(),
        registration.home_id.clone(),
        registration.source_instance_id.clone(),
        registration.collection_id.clone(),
        id.to_owned(),
    )
}
fn reclamation_error() -> Error {
    Error::new(
        "guard-conflict",
        "Explicit cache reclamation planning policy unavailable",
    )
}
fn build_reclamation_plan(
    policy: &CacheReclamationPolicy,
    protected: &[ProtectedCacheGeneration],
    coverage: CacheReferenceCoverage,
) -> Result<CacheReclamationPlan> {
    let mut groups: BTreeMap<GenerationKey, Vec<&ProtectedCacheGeneration>> = BTreeMap::new();
    for reference in protected {
        groups
            .entry(generation_key(
                reference.registration(),
                reference.generation_id(),
            ))
            .or_default()
            .push(reference);
    }
    for request in &policy.requests {
        groups
            .entry(generation_key(
                &request.registration,
                &request.generation_id,
            ))
            .or_default();
    }
    if groups.len() > CACHE_PROTECTED_ENTRY_LIMIT {
        return Err(capacity_error());
    }
    let requests = policy
        .requests
        .iter()
        .map(|request| {
            (
                generation_key(&request.registration, &request.generation_id),
                request,
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut entries = Vec::with_capacity(groups.len());
    for (key, references) in groups {
        let requested = requests.get(&key).copied();
        let registration = references
            .first()
            .map(|r| &r.registration)
            .or_else(|| requested.map(|r| &r.registration))
            .ok_or_else(reclamation_error)?;
        let mut blockers = Vec::new();
        let mut block = |reason| {
            if !blockers.contains(&reason) {
                blockers.push(reason);
            }
        };
        if coverage == CacheReferenceCoverage::Unknown {
            block(CacheReclamationBlocker::ExternalReferencesUnknown);
        }
        if requested.is_none() {
            block(CacheReclamationBlocker::OwnerPolicyAbsent);
        }
        if references.is_empty() {
            block(CacheReclamationBlocker::UnknownGeneration);
        }
        if references.iter().any(|r| &r.registration != registration)
            || requested.is_some_and(|r| &r.registration != registration)
        {
            block(CacheReclamationBlocker::RegistrationConflict);
        }
        let burned = references
            .iter()
            .any(|r| r.origin == CacheProtectionOrigin::StoreReservation);
        if !burned {
            block(CacheReclamationBlocker::UnknownPublicationDisposition);
        }
        let digests = references
            .iter()
            .filter_map(|r| r.native_sha256())
            .collect::<BTreeSet<_>>();
        let digest = if digests.len() == 1 {
            digests.first().copied()
        } else {
            None
        };
        if digest.is_none()
            || !references.iter().any(|r| {
                r.origin == CacheProtectionOrigin::OriginalOwner
                    && r.reason == CacheProtectionReason::Archive
                    && r.native_sha256.is_some()
            })
        {
            block(CacheReclamationBlocker::NativeDigestUnavailableOrConflicting);
        }
        if requested.is_some_and(|r| Some(r.native_sha256.as_str()) != digest) {
            block(CacheReclamationBlocker::RequestedDigestMismatch);
        }
        for reference in &references {
            // Only the Core's burned-ID FACT and explicitly selected verified
            // archive residency may be candidates. Actual retained history from
            // an original owner remains protected, even with the same reason.
            let burned_fact = reference.origin == CacheProtectionOrigin::StoreReservation
                && reference.reason == CacheProtectionReason::History;
            let archive = reference.origin == CacheProtectionOrigin::OriginalOwner
                && reference.reason == CacheProtectionReason::Archive
                && reference.native_sha256.is_some();
            if !burned_fact && !archive {
                block(CacheReclamationBlocker::RetainedReference(reference.reason));
            }
        }
        entries.push(CacheReclamationEntry {
            registration: registration.clone(),
            generation_id: key.4,
            native_sha256: digest.map(str::to_owned),
            reference_count: references.len(),
            reasons: references.iter().map(|r| r.reason).collect(),
            blockers,
            burned_identifier_present: burned,
        });
    }
    Ok(CacheReclamationPlan {
        policy_revision: policy.revision.clone(),
        coverage,
        entries,
    })
}

/// Owns the existing Store's IMMEDIATE transaction and actual peer guard. This
/// excludes another Store call and keeps catalog/recovery/disclosure pins live.
/// Inventory getters confer no Access grant. No deletion or retention release.
pub struct CacheResidencyGuard<'a, G> {
    transaction: Transaction<'a>,
    issuer: Arc<()>,
    contract: &'a dyn Contract,
    references: G,
    protected: Vec<ProtectedCacheGeneration>,
    // Keep the actual original tokens live for this whole inventory boundary,
    // even if their last reader owner releases its Arc after enumeration.
    _disclosure_pins: Vec<Arc<CacheDisclosureLease>>,
}
impl<G: OriginalCacheReferenceGuard> CacheResidencyGuard<'_, G> {
    pub fn protected(&self) -> &[ProtectedCacheGeneration] {
        &self.protected
    }
    /// Read-only source plan, not a deletion permit. Re-enumerate original
    /// references because admission can add a reservation after guard creation.
    /// The same Store transaction, issuer and original peer lock stay held.
    pub fn plan_reclamation(
        &mut self,
        policy: &CacheReclamationPolicy,
    ) -> Result<CacheReclamationPlan> {
        let mut protected = self
            .protected
            .iter()
            .filter(|entry| entry.origin != CacheProtectionOrigin::OriginalOwner)
            .map(|entry| ProtectedCacheGeneration {
                registration: entry.registration.clone(),
                generation_id: entry.generation_id.clone(),
                native_sha256: entry.native_sha256.clone(),
                reason: entry.reason,
                origin: entry.origin,
            })
            .collect::<Vec<_>>();
        let mut sink = CacheProtectionSink {
            contract: self.contract,
            entries: &mut protected,
            failed: None,
        };
        self.references.enumerate(&mut sink)?;
        if let Some(error) = sink.failed {
            return Err(error);
        }
        for request in &policy.requests {
            self.contract.validate_shape(
                "sourceRegistration",
                &serde_json::to_value(&request.registration)?,
            )?;
            self.contract.validate_shape(
                "recordRef",
                &serde_json::to_value(RecordRef {
                    record_type: RecordType::Identity,
                    record_id: request.generation_id.clone(),
                })?,
            )?;
        }
        self.protected = protected;
        build_reclamation_plan(
            policy,
            &self.protected,
            self.references.reclamation_coverage(),
        )
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
    /// Perform the existing actual authorized registered read, then acquire a
    /// same-instance generation pin before the exclusive Store borrow exits.
    /// Caller-supplied snapshots or generation selectors never issue a pin.
    /// The supplied authorizer is the original borrowed per-call read fence;
    /// this function never reenters the configured authorizer or Access owner.
    pub fn read_cache_partition_pinned_with_authorization<B: Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        scope: &Scope,
        partition: &SourcePartition,
    ) -> Result<PinnedCacheRead> {
        let read = self.read_cache_partition_with_authorization(
            authorization,
            principal,
            scope,
            partition,
        )?;
        if read.registration.owner != SourceOwner::Network {
            return Err(disclosure_conflict());
        }
        let pin = if let Some(generation_id) = read
            .state
            .cache
            .as_ref()
            .and_then(|cache| cache.generation_id.as_ref())
        {
            if !repo::generation_reserved(&self.db, partition, generation_id)? {
                return Err(disclosure_conflict());
            }
            let live = self.cache_pins.live_disclosures();
            if live.len() >= CACHE_PROTECTED_ENTRY_LIMIT {
                return Err(capacity_error());
            }
            let lease = Arc::new(CacheDisclosureLease {
                issuer: Arc::clone(&self.instance),
                registration: read.registration.clone(),
                generation_id: generation_id.clone(),
                baseline_sha256: disclosure_baseline_digest(&read)?,
            });
            self.cache_pins.disclosures.push(Arc::downgrade(&lease));
            Some(CacheDisclosurePin { lease })
        } else {
            None
        };
        Ok(PinnedCacheRead { read, pin })
    }

    /// Check the original allocation and entire captured registered baseline.
    /// Current-pointer/authority revalidation remains the original reader's
    /// separate release check; supersession never silently drops a live pin.
    pub fn validate_cache_disclosure_pin(
        &self,
        pin: &CacheDisclosurePin,
        read: &RegisteredCacheRead,
    ) -> Result<()> {
        if !Arc::ptr_eq(&self.instance, &pin.lease.issuer)
            || pin.registration() != &read.registration
            || read.registration.owner != SourceOwner::Network
            || read
                .state
                .cache
                .as_ref()
                .and_then(|cache| cache.generation_id.as_deref())
                != Some(pin.generation_id())
            || disclosure_baseline_digest(read)? != pin.lease.baseline_sha256
        {
            return Err(disclosure_conflict());
        }
        Ok(())
    }

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
        let disclosure_pins = self.cache_pins.live_disclosures();
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
            sink.protect_with_origin(
                &pin.registration,
                &pin.generation_id,
                pin.native_sha256.as_deref(),
                pin.reason,
                CacheProtectionOrigin::StorePin,
            )?;
        }
        for pin in &disclosure_pins {
            if !Arc::ptr_eq(&pin.issuer, &self.instance) {
                return Err(disclosure_conflict());
            }
            sink.protect_with_origin(
                &pin.registration,
                &pin.generation_id,
                None,
                CacheProtectionReason::Disclosure,
                CacheProtectionOrigin::StorePin,
            )?;
        }
        original.enumerate(&mut sink)?;
        if let Some(error) = sink.failed {
            return Err(error);
        }
        Ok(CacheResidencyGuard {
            transaction,
            issuer: Arc::clone(&self.instance),
            contract: &self.contract,
            references: original,
            protected,
            _disclosure_pins: disclosure_pins,
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
            sink.protect_with_origin(
                &registration,
                &generation_id,
                None,
                reason,
                if reason == CacheProtectionReason::History {
                    CacheProtectionOrigin::StoreReservation
                } else {
                    CacheProtectionOrigin::StoreReference
                },
            )?;
        }
    }
    Ok(())
}
