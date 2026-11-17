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
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
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
    /// Explicit known-pre-stage disposition under this original native lock.
    /// Prove no projected/raw/ambiguous stage or external reference exists;
    /// when admitted, verify and cancel the exact original reservation. Failure
    /// retains the caller's move-only token. Other owners deny by default.
    fn cancel_proven_pre_stage(
        &mut self,
        _registration: &SourceRegistration,
        _generation_id: &str,
        _admission: Option<&Self::Admission>,
    ) -> Result<()> {
        Err(Error::new(
            "guard-conflict",
            "Original pre-stage disposition unavailable",
        ))
    }
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
    unbound: Option<Arc<AtomicBool>>,
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
                unbound: None,
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
    // Strong same-Store ownership: disposing a candidate or replacing its
    // runtime never silently releases an unresolved read hold. Not persisted.
    read_holds: Vec<Arc<CacheReadHoldState>>,
}

struct CacheReadHoldState {
    issuer: Arc<()>,
    registration: SourceRegistration,
    // Odd = held, even = released. Every observation advances the version.
    version: AtomicU64,
}

/// Original unbound-fence holder's deny-only handle. No serialization or
/// constructor; recovery requires the separate guarded publication entry below.
#[derive(Clone)]
pub(crate) struct CacheReadHold {
    state: Arc<CacheReadHoldState>,
    generation_id: String,
    captured_version: u64,
    unbound: Arc<AtomicBool>,
}
impl CacheReadHold {
    pub(crate) fn activate(&self) {
        if !self.unbound.load(Ordering::SeqCst) {
            return;
        }
        let _ = self
            .state
            .version
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |version| {
                Some(version.checked_add(2).map_or(u64::MAX, |next| next | 1))
            });
    }
    pub(crate) fn is_held(&self) -> bool {
        self.state.version.load(Ordering::SeqCst) & 1 != 0
    }
    fn lift_matching_version(&self) {
        // Saturation is permanently fail-closed. A completion captured before a
        // newer auth observation cannot release that newer hold (no ABA).
        if self.captured_version & 1 != 0 && self.captured_version != u64::MAX {
            let _ = self.state.version.compare_exchange(
                self.captured_version,
                self.captured_version + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
        }
    }
}

/// Original owner must independently validate PublishCache and the separately
/// approved RevalidateSource grant under its same actual authority fence.
pub(crate) trait CacheReadRecoveryAuthorization: Authorization {
    fn authorize_cache_recovery(
        &self,
        principal: &Self::Principal,
        registration: &SourceRegistration,
    ) -> Result<VerifiedActor>;
}
struct RecoveryAuthorization<'a, B> {
    original: &'a B,
    registration: &'a SourceRegistration,
}
impl<B: CacheReadRecoveryAuthorization> Authorization for RecoveryAuthorization<'_, B> {
    type Principal = B::Principal;
    fn authorize(
        &self,
        principal: &B::Principal,
        request: AuthorizationRequest<'_>,
    ) -> Result<VerifiedActor> {
        if request.capability != Capability::PublishCache {
            return Err(disclosure_conflict());
        }
        let actor = self.original.authorize(principal, request)?;
        if self
            .original
            .authorize_cache_recovery(principal, self.registration)?
            != actor
        {
            return Err(disclosure_conflict());
        }
        Ok(actor)
    }
}

/// Refused pre-stage disposition returns the original move-only custody.
pub struct RejectedPreStageCacheCandidate<T> {
    error: Error,
    fence: CachePublicationFence,
    admission: Option<T>,
}
impl<T> RejectedPreStageCacheCandidate<T> {
    pub fn into_parts(self) -> (Error, CachePublicationFence, Option<T>) {
        (self.error, self.fence, self.admission)
    }
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

pub(super) fn read_hold_error() -> Error {
    Error::new(
        "access-revoked",
        "Cache requires separately authorized source revalidation",
    )
}
fn disclosure_conflict() -> Error {
    Error::new(
        "guard-conflict",
        "Original cache disclosure pin unavailable",
    )
}

impl CachePinRegistry {
    pub(super) fn held_partitions(&self, scope: &Scope) -> Vec<SourcePartition> {
        self.read_holds
            .iter()
            .filter(|hold| {
                hold.registration.scope() == *scope && hold.version.load(Ordering::SeqCst) & 1 != 0
            })
            .map(|hold| hold.registration.partition())
            .collect()
    }
    pub(super) fn ensure_readable(&self, partition: &SourcePartition) -> Result<()> {
        if self.read_holds.iter().any(|hold| {
            hold.registration.partition() == *partition
                && hold.version.load(Ordering::SeqCst) & 1 != 0
        }) {
            return Err(read_hold_error());
        }
        Ok(())
    }
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
            unbound: Some(Arc::new(AtomicBool::new(true))),
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
        if let Some(unbound) = &pin.unbound {
            unbound.store(false, Ordering::SeqCst);
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
                unbound: entry.unbound.clone(),
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
    /// Register while the original candidate is unbound, before transport.
    /// Its deny-only handle can arm without Core/Store contention. Strong Store
    /// ownership lasts until this Store closes, independently of candidate pins.
    pub(crate) fn cache_read_hold(
        &mut self,
        fence: &CachePublicationFence,
    ) -> Result<CacheReadHold> {
        if !Arc::ptr_eq(&self.instance, &fence.issuer)
            || fence.registration.partition() != fence.partition
            || repo::source(&self.db, &fence.partition)? != fence.registration
            || !self
                .cache_pins
                .entries
                .iter()
                .any(|pin| same_candidate(pin, fence) && pin.native_sha256.is_none())
        {
            return Err(disclosure_conflict());
        }
        let state = if let Some(state) = self
            .cache_pins
            .read_holds
            .iter()
            .find(|state| state.registration == fence.registration)
        {
            state.clone()
        } else {
            if self.cache_pins.read_holds.len() >= CACHE_PROTECTED_ENTRY_LIMIT {
                return Err(capacity_error());
            }
            let state = Arc::new(CacheReadHoldState {
                issuer: self.instance.clone(),
                registration: fence.registration.clone(),
                version: AtomicU64::new(0),
            });
            self.cache_pins.read_holds.push(state.clone());
            state
        };
        let unbound = self
            .cache_pins
            .entries
            .iter()
            .find(|pin| same_candidate(pin, fence))
            .and_then(|pin| pin.unbound.clone())
            .ok_or_else(disclosure_conflict)?;
        Ok(CacheReadHold {
            captured_version: state.version.load(Ordering::SeqCst),
            state,
            generation_id: fence.reserved_generation_id.clone(),
            unbound,
        })
    }

    /// Both independent grants are repeated by the original owner at the
    /// existing publication precommit. Only its definite fresh receipt may
    /// lift this exact version; no old failure metadata is replayed.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn publish_revalidated_staged_generation<
        B: CacheReadRecoveryAuthorization,
        P: OriginalCacheReferences,
    >(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        fence: CachePublicationFence,
        staged: P::Staged,
        references: &mut P,
        hold: CacheReadHold,
    ) -> std::result::Result<
        PublishedStagedCachePublication<P::Staged>,
        RejectedStagedCachePublication<P::Staged>,
    > {
        if !Arc::ptr_eq(&self.instance, &hold.state.issuer)
            || hold.state.registration != fence.registration
            || hold.generation_id != fence.reserved_generation_id
            || !self
                .cache_pins
                .read_holds
                .iter()
                .any(|state| Arc::ptr_eq(state, &hold.state))
        {
            return staged_outcome(Err(disclosure_conflict()), fence, staged);
        }
        let registration = fence.registration.clone();
        let authorization = RecoveryAuthorization {
            original: authorization,
            registration: &registration,
        };
        let published = self.publish_staged_generation_with_authorization(
            &authorization,
            principal,
            fence,
            staged,
            references,
        )?;
        // No fallible work after COMMIT. A newer hold stays armed even though
        // this definite publication receipt must still be reported honestly.
        hold.lift_matching_version();
        Ok(published)
    }
    /// Dispose only an original, unbound candidate proven never staged. This
    /// does not release history, publication or disclosure custody. Store and
    /// original Native locks remain held through proof and native cancellation;
    /// every refusal returns both original handles, with no Drop cleanup.
    pub fn abandon_pre_stage_cache_candidate<'a, P: OriginalCacheReferences>(
        &'a mut self,
        fence: CachePublicationFence,
        admission: Option<<P::Guard<'a> as OriginalCacheReferenceGuard>::Admission>,
        references: &'a mut P,
    ) -> std::result::Result<
        (),
        Box<
            RejectedPreStageCacheCandidate<
                <P::Guard<'a> as OriginalCacheReferenceGuard>::Admission,
            >,
        >,
    > {
        let result =
            self.abandon_pre_stage_cache_candidate_inner(&fence, admission.as_ref(), references);
        result.map_err(|error| {
            Box::new(RejectedPreStageCacheCandidate {
                error,
                fence,
                admission,
            })
        })
    }
    fn abandon_pre_stage_cache_candidate_inner<'a, P: OriginalCacheReferences>(
        &'a mut self,
        fence: &CachePublicationFence,
        admission: Option<&<P::Guard<'a> as OriginalCacheReferenceGuard>::Admission>,
        references: &'a mut P,
    ) -> Result<()> {
        if !Arc::ptr_eq(&self.instance, &fence.issuer)
            || fence.registration.partition() != fence.partition
        {
            return Err(disclosure_conflict());
        }
        let pins = &mut self.cache_pins;
        let live = pins.live_disclosures();
        let index = pins
            .entries
            .iter()
            .position(|pin| same_candidate(pin, fence))
            .ok_or_else(disclosure_conflict)?;
        if pins.entries[index].native_sha256.is_some()
            || pins
                .entries
                .iter()
                .filter(|pin| same_candidate(pin, fence))
                .count()
                != 1
            || live.iter().any(|pin| {
                pin.registration == fence.registration
                    && pin.generation_id == fence.reserved_generation_id
            })
        {
            return Err(disclosure_conflict());
        }
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if repo::source(&transaction, &fence.partition)? != fence.registration {
            return Err(disclosure_conflict());
        }
        let mut original: P::Guard<'a> = references.lock()?;
        let mut protected = Vec::new();
        let mut sink = CacheProtectionSink {
            contract: &self.contract,
            entries: &mut protected,
            failed: None,
        };
        enumerate_sql(&transaction, &mut sink)?;
        if protected.iter().any(|pin| same_candidate(pin, fence)) {
            return Err(disclosure_conflict());
        }
        let mut sink = CacheProtectionSink {
            contract: &self.contract,
            entries: &mut protected,
            failed: None,
        };
        original.enumerate(&mut sink)?;
        if let Some(error) = sink.failed {
            return Err(error);
        }
        if protected
            .iter()
            .filter(|pin| same_candidate(pin, fence))
            .any(|pin| {
                admission.is_none()
                    || pin.origin != CacheProtectionOrigin::OriginalOwner
                    || pin.native_sha256.is_some()
                    || !matches!(
                        pin.reason,
                        CacheProtectionReason::InFlightOrAmbiguous | CacheProtectionReason::History
                    )
            })
        {
            return Err(disclosure_conflict());
        }
        // The original owner proves projected/raw absence and cancels the
        // exact admission. Nothing fallible follows this native operation.
        original.cancel_proven_pre_stage(
            &fence.registration,
            &fence.reserved_generation_id,
            admission,
        )?;
        if let Some(unbound) = &pins.entries[index].unbound {
            unbound.store(false, Ordering::SeqCst);
        }
        pins.entries.remove(index);
        // Read-only Store transaction: rollback on exit changes no SQL.
        Ok(())
    }
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
        self.cache_pins
            .ensure_readable(&read.registration.partition())?;
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

#[cfg(test)]
mod pre_stage_tests {
    use super::*;
    use crate::http::contracts::NativeContracts;
    use std::cell::Cell;
    type Check = std::result::Result<(), Box<dyn std::error::Error>>;
    fn id(n: u64) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    struct Authority;
    impl Authorization for Authority {
        type Principal = VerifiedActor;
        fn authorize(
            &self,
            actor: &VerifiedActor,
            _: AuthorizationRequest<'_>,
        ) -> Result<VerifiedActor> {
            Ok(actor.clone())
        }
    }
    struct Clock(Cell<u64>);
    impl Runtime for Clock {
        fn now(&self) -> Result<String> {
            Ok("2026-10-07T12:00:00Z".into())
        }
        fn new_id(&self) -> Result<String> {
            let n = self.0.get();
            self.0.set(n + 1);
            Ok(id(n))
        }
        fn verify_available_asset(&self, _: &Record) -> Result<AssetProof> {
            Err(disclosure_conflict())
        }
    }
    type TestStore = AtlasStore<NativeContracts, Authority, Clock>;
    struct Stage;
    impl OriginalStagedCachePublication for Stage {
        fn registration(&self) -> &SourceRegistration {
            unreachable!()
        }
        fn cache(&self) -> &CacheStatus {
            unreachable!()
        }
        fn homebox_entities(&self) -> &[Value] {
            unreachable!()
        }
        fn network_relations(&self) -> &[Value] {
            unreachable!()
        }
        fn native_sha256(&self) -> &str {
            unreachable!()
        }
    }
    struct Admission {
        issuer: Arc<()>,
        registration: SourceRegistration,
        id: String,
    }
    struct References {
        registration: SourceRegistration,
        candidate: String,
        issuer: Arc<()>,
        protected: Option<CacheProtectionReason>,
        deny: bool,
        cancellations: usize,
    }
    struct Guard<'a>(&'a mut References);
    impl OriginalCacheReferences for References {
        type Staged = Stage;
        type Guard<'a> = Guard<'a>;
        fn lock(&mut self) -> Result<Guard<'_>> {
            Ok(Guard(self))
        }
    }
    impl OriginalCacheReferenceGuard for Guard<'_> {
        type Staged = Stage;
        type Admission = Admission;
        fn enumerate(&mut self, sink: &mut CacheProtectionSink<'_>) -> Result<()> {
            if let Some(reason) = self.0.protected {
                sink.protect(&self.0.registration, &self.0.candidate, None, reason)?;
            }
            Ok(())
        }
        fn verify_staged(&mut self, _: &Stage) -> Result<()> {
            Err(disclosure_conflict())
        }
        fn verify_unpublished(&mut self, _: &Stage) -> Result<()> {
            Err(disclosure_conflict())
        }
        fn admit_candidate(
            &mut self,
            _: &SourceRegistration,
            _: &str,
            _: u64,
            _: CacheCapacityLimits,
            _: &[ProtectedCacheGeneration],
        ) -> Result<Admission> {
            Err(disclosure_conflict())
        }
        fn cancel_proven_pre_stage(
            &mut self,
            registration: &SourceRegistration,
            id: &str,
            admission: Option<&Admission>,
        ) -> Result<()> {
            if self.0.deny
                || registration != &self.0.registration
                || id != self.0.candidate
                || admission.is_some_and(|token| {
                    !Arc::ptr_eq(&token.issuer, &self.0.issuer)
                        || &token.registration != registration
                        || token.id != id
                })
            {
                return Err(disclosure_conflict());
            }
            self.0.cancellations += 1;
            Ok(())
        }
    }
    fn fixture() -> std::result::Result<
        (tempfile::TempDir, TestStore, VerifiedActor, References),
        Box<dyn std::error::Error>,
    > {
        let root = tempfile::tempdir()?;
        let mut store = AtlasStore::open(
            root.path().join("store.sqlite"),
            NativeContracts,
            Authority,
            Clock(Cell::new(100)),
            StoreOptions::default(),
        )?;
        let registration: SourceRegistration = serde_json::from_value(
            serde_json::json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","owner":"network","partitionMode":"exclusive-home","allowedExternalIds":[]}),
        )?;
        let actor = VerifiedActor {
            workspace_id: id(1),
            home_id: id(2),
            actor_id: id(50),
        };
        store.register_source(&actor, &registration)?;
        let refs = References {
            registration,
            candidate: id(100),
            issuer: Arc::new(()),
            protected: None,
            deny: false,
            cancellations: 0,
        };
        Ok((root, store, actor, refs))
    }
    fn prepare(
        store: &mut TestStore,
        actor: &VerifiedActor,
        refs: &References,
    ) -> CachePublicationFence {
        store
            .prepare_cache_publication(
                actor,
                &refs.registration.scope(),
                &refs.registration.partition(),
            )
            .unwrap()
            .into_parts()
            .1
    }
    #[test]
    fn pre_stage_disposition_returns_custody_on_wrong_store_or_native_refusal() -> Check {
        let (_root, mut store, actor, mut refs) = fixture()?;
        let (_other_root, mut other, other_actor, other_refs) = fixture()?;
        let _other_fence = prepare(&mut other, &other_actor, &other_refs);
        let fence = prepare(&mut store, &actor, &refs);
        let token = Admission {
            issuer: refs.issuer.clone(),
            registration: refs.registration.clone(),
            id: refs.candidate.clone(),
        };
        let rejected = other
            .abandon_pre_stage_cache_candidate(fence, Some(token), &mut refs)
            .err()
            .unwrap();
        let (error, fence, token) = rejected.into_parts();
        assert_eq!(error.code, "guard-conflict");
        assert_eq!(refs.cancellations, 0);
        refs.deny = true;
        let rejected = store
            .abandon_pre_stage_cache_candidate(fence, token, &mut refs)
            .err()
            .unwrap();
        let (_, fence, token) = rejected.into_parts();
        assert!(
            store
                .cache_pins
                .entries
                .iter()
                .any(|pin| same_candidate(pin, &fence))
        );
        refs.deny = false;
        store
            .abandon_pre_stage_cache_candidate(fence, token, &mut refs)
            .map_err(|e| e.into_parts().0)?;
        assert!(store.cache_pins.entries.is_empty());
        assert_eq!(refs.cancellations, 1);
        assert_eq!(other.cache_pins.entries.len(), 1);
        Ok(())
    }
    #[test]
    fn pre_stage_disposition_protects_bound_sql_and_native_references() -> Check {
        for mode in 0..7 {
            let (_root, mut store, actor, mut refs) = fixture()?;
            let fence = prepare(&mut store, &actor, &refs);
            match mode {
                0 => store.cache_pins.bind(&fence, &"a".repeat(64))?,
                1 => repo::reserve_generation(
                    &store.db,
                    &fence.partition,
                    &fence.reserved_generation_id,
                )?,
                2 => {
                    // A current pointer without its history row is ambiguous too.
                    let cache = serde_json::json!({"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","generationId":refs.candidate});
                    repo::write_cache(&store.db, &NativeContracts, &cache)?;
                }
                3 => refs.protected = Some(CacheProtectionReason::StagedOrAmbiguous),
                4 => refs.protected = Some(CacheProtectionReason::Recovery),
                5 => refs.protected = Some(CacheProtectionReason::Disclosure),
                _ => refs.deny = true, // raw/partial stage proof unavailable
            }
            let rejected = store
                .abandon_pre_stage_cache_candidate(fence, None, &mut refs)
                .err()
                .expect("Protected candidate must refuse");
            let (_, fence, admission) = rejected.into_parts();
            assert!(admission.is_none());
            assert!(
                store
                    .cache_pins
                    .entries
                    .iter()
                    .any(|pin| same_candidate(pin, &fence))
            );
            assert_eq!(refs.cancellations, 0);
        }
        Ok(())
    }
    #[test]
    fn pre_stage_pin_only_disposition_preserves_previous_cache_and_other_pin() -> Check {
        let (_root, mut store, actor, mut refs) = fixture()?;
        let seed = prepare(&mut store, &actor, &refs);
        let previous = CacheStatus {
            schema_version: 1,
            workspace_id: id(1),
            home_id: id(2),
            source_instance_id: id(12),
            collection_id: "inventory".into(),
            status: CacheState::Fresh,
            last_successful_fetch_at: Some("2026-10-07T12:00:00Z".into()),
            last_attempt_at: Some("2026-10-07T12:00:00Z".into()),
            generation_id: Some(id(100)),
            consistency: "non-transactional-offset-pages".into(),
            error: None,
        };
        store.publish_prepared_generation(&actor, seed, &previous, &[], &[])?;
        refs.candidate = id(101);
        let before = store.read_cache_for_publication(
            &actor,
            &refs.registration.scope(),
            &refs.registration.partition(),
        )?;
        let fence = prepare(&mut store, &actor, &refs);
        let other = prepare(&mut store, &actor, &refs);
        store
            .abandon_pre_stage_cache_candidate(fence, None, &mut refs)
            .map_err(|e| e.into_parts().0)?;
        let after = store.read_cache_for_publication(
            &actor,
            &refs.registration.scope(),
            &refs.registration.partition(),
        )?;
        assert_eq!(
            serde_json::to_value(&before)?,
            serde_json::to_value(&after)?
        );
        assert_eq!(store.cache_pins.entries.len(), 2);
        assert!(
            store
                .cache_pins
                .entries
                .iter()
                .any(|pin| same_candidate(pin, &other))
        );
        assert_eq!(after.cache.as_ref(), Some(&previous));
        Ok(())
    }
    #[test]
    fn read_hold_survives_empty_candidate_disposal_and_covers_store_readers() -> Check {
        let (root, mut store, actor, mut refs) = fixture()?;
        // SQLite's existing-only NOFOLLOW open rejects the macOS /var alias.
        let database = std::fs::canonicalize(root.path())?.join("store.sqlite");
        let seed = prepare(&mut store, &actor, &refs);
        let previous = CacheStatus {
            schema_version: 1,
            workspace_id: id(1),
            home_id: id(2),
            source_instance_id: id(12),
            collection_id: "inventory".into(),
            status: CacheState::Fresh,
            last_successful_fetch_at: Some("2026-10-07T12:00:00Z".into()),
            last_attempt_at: Some("2026-10-07T12:00:00Z".into()),
            generation_id: Some(id(100)),
            consistency: "non-transactional-offset-pages".into(),
            error: None,
        };
        store.publish_prepared_generation(&actor, seed, &previous, &[], &[])?;
        let pinned = store.read_cache_partition_pinned_with_authorization(
            &Authority,
            &actor,
            &refs.registration.scope(),
            &refs.registration.partition(),
        )?;
        refs.candidate = id(101);
        let fence = prepare(&mut store, &actor, &refs);
        let hold = store.cache_read_hold(&fence)?;
        hold.activate();
        store
            .abandon_pre_stage_cache_candidate(fence, None, &mut refs)
            .map_err(|e| e.into_parts().0)?;
        assert!(hold.is_held());
        // The retired candidate loses even its deny-only activation permit.
        let version = hold.state.version.load(Ordering::SeqCst);
        hold.activate();
        assert_eq!(hold.state.version.load(Ordering::SeqCst), version);
        let partition = refs.registration.partition();
        let scope = refs.registration.scope();
        assert_eq!(
            store
                .read_cache_partition_with_authorization(&Authority, &actor, &scope, &partition)
                .err()
                .unwrap()
                .code,
            "access-revoked"
        );
        let (read, pin) = pinned.into_parts();
        assert_eq!(
            store
                .validate_cache_disclosure_pin(&pin.unwrap(), &read)
                .err()
                .unwrap()
                .code,
            "access-revoked"
        );
        for snapshot in [
            store
                .read_snapshot(&actor, &scope)
                .map_err(|e| format!("held snapshot: {e:?}"))?,
            store
                .read_snapshot_with_authorization(&Authority, &actor, &scope)
                .map_err(|e| format!("held borrowed snapshot: {e:?}"))?,
            store
                .read_pack_cut(&Authority, &actor, &scope)
                .map_err(|e| format!("held pack: {e:?}"))?
                .0,
        ] {
            assert_eq!(snapshot.caches[0]["status"], "access-revoked");
        }
        assert_eq!(
            store
                .read_cache_for_publication(&actor, &scope, &partition)?
                .cache,
            Some(previous.clone())
        );
        // Holds are explicitly same-Store RAM protection. With no successful
        // original failure CAS, closing/reopening does not invent a durable denial.
        store
            .close()
            .map_err(|e| format!("close held Store: {e:?}"))?;
        let mut reopened = AtlasStore::open_existing(
            &database,
            NativeContracts,
            Authority,
            Clock(Cell::new(200)),
            StoreOptions::default(),
        )
        .map_err(|e| format!("reopen Store: {e:?}"))?;
        assert_eq!(
            reopened
                .read_cache_partition_with_authorization(&Authority, &actor, &scope, &partition)?
                .state
                .cache,
            Some(previous)
        );
        let prepared = reopened
            .prepare_cache_publication(&actor, &scope, &partition)
            .map_err(|e| format!("prepare durable failure: {e:?}"))?;
        let (_, fence) = prepared.into_parts();
        reopened
            .record_prepared_cache_failure(
                &actor,
                fence,
                &CacheFailure {
                    code: FailureCode::Auth,
                    status: None,
                },
            )
            .map_err(|e| format!("durable failure: {e:?}"))?;
        reopened
            .close()
            .map_err(|e| format!("close durable Store: {e:?}"))?;
        let mut reopened = AtlasStore::open_existing(
            &database,
            NativeContracts,
            Authority,
            Clock(Cell::new(300)),
            StoreOptions::default(),
        )
        .map_err(|e| format!("reopen Store: {e:?}"))?;
        assert_eq!(
            reopened.read_snapshot(&actor, &scope)?.caches[0]["status"],
            "access-revoked"
        );
        Ok(())
    }
    #[test]
    fn read_hold_version_and_same_store_fence_prevent_stale_release() -> Check {
        let (_root, mut store, actor, refs) = fixture()?;
        let (_other_root, mut other, _, _) = fixture()?;
        let fence = prepare(&mut store, &actor, &refs);
        assert_eq!(
            other.cache_read_hold(&fence).err().unwrap().code,
            "guard-conflict"
        );
        let first = store.cache_read_hold(&fence)?;
        first.activate();
        let old_recovery = store.cache_read_hold(&fence)?;
        first.activate();
        old_recovery.lift_matching_version();
        assert!(first.is_held());
        let matching = store.cache_read_hold(&fence)?;
        matching.lift_matching_version();
        assert!(!first.is_held());
        store.cache_pins.bind(&fence, &"a".repeat(64))?;
        first.activate();
        assert!(!first.is_held());
        Ok(())
    }
    #[test]
    fn read_hold_arms_during_authorization_before_snapshot_or_cache_release() -> Check {
        struct Arm<'a> {
            hold: &'a CacheReadHold,
            calls: Cell<usize>,
            at: usize,
        }
        impl Authorization for Arm<'_> {
            type Principal = VerifiedActor;
            fn authorize(
                &self,
                actor: &VerifiedActor,
                request: AuthorizationRequest<'_>,
            ) -> Result<VerifiedActor> {
                if request.capability == Capability::ReadCache {
                    self.calls.set(self.calls.get() + 1);
                    if self.calls.get() == self.at {
                        self.hold.activate();
                    }
                }
                Ok(actor.clone())
            }
        }
        let (_root, mut store, actor, refs) = fixture()?;
        let fence = prepare(&mut store, &actor, &refs);
        let hold = store.cache_read_hold(&fence)?;
        let scope = refs.registration.scope();
        let partition = refs.registration.partition();
        for mode in 0..3 {
            let authority = Arm {
                hold: &hold,
                calls: Cell::new(0),
                at: if mode == 2 { 2 } else { 1 },
            };
            let error = match mode {
                0 => store
                    .read_snapshot_with_authorization(&authority, &actor, &scope)
                    .err()
                    .unwrap(),
                1 => store
                    .read_pack_cut(&authority, &actor, &scope)
                    .err()
                    .unwrap(),
                _ => store
                    .read_cache_partition_with_authorization(&authority, &actor, &scope, &partition)
                    .err()
                    .unwrap(),
            };
            assert_eq!(error.code, "access-revoked");
            store.cache_read_hold(&fence)?.lift_matching_version();
            assert!(!hold.is_held());
        }
        Ok(())
    }
}
