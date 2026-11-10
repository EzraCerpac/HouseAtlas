//! Refusal-first OFFLINE PLAN DATA, not a recovery executor or authorization.
//! Caller observations/anchors are untrusted until the original owners bind
//! provenance, closed-state exclusion, descriptors and actual durability.
//! No filesystem, SQL, service, receipt publication, startup hook or CLI exists.
//! In particular, integrity alone and a newly captured copy are not continuity.
use super::persistent::State;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileKind {
    Access,
    AccessWal,
    AccessShm,
    AccessJournal,
    Atlas,
    AtlasWal,
    AtlasShm,
    AtlasJournal,
    Receipt,
}
const FILES: [FileKind; 9] = [
    FileKind::Access,
    FileKind::AccessWal,
    FileKind::AccessShm,
    FileKind::AccessJournal,
    FileKind::Atlas,
    FileKind::AtlasWal,
    FileKind::AtlasShm,
    FileKind::AtlasJournal,
    FileKind::Receipt,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LockKind {
    Server,
    Deploy,
    Backup,
}
const LOCKS: [LockKind; 3] = [LockKind::Server, LockKind::Deploy, LockKind::Backup];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Identity {
    pub device: u64,
    pub inode: u64,
    pub uid: u32,
    pub mode: u32,
    pub links: u64,
}
impl Identity {
    fn safe(&self, uid: u32, directory: bool) -> bool {
        self.inode != 0
            && self.uid == uid
            && self.links >= 1
            && if directory {
                self.mode == 0o40700
            } else {
                self.mode == 0o100600 && self.links == 1
            }
    }
    fn same_except_device(&self, other: &Self) -> bool {
        self.inode == other.inode
            && self.uid == other.uid
            && self.mode == other.mode
            && self.links == other.links
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Image {
    pub identity: Identity,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Presence {
    Absent,
    Present(Image),
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LockObservation {
    pub opened: Identity,
    pub named: Identity,
    /// Recorded claim only. This struct cannot own or prove a native flock.
    pub exclusive_claimed: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ClosedCut {
    pub directory: Identity,
    /// Every database, sidecar and explicit absence must be enumerated.
    pub files: BTreeMap<FileKind, Presence>,
    pub locks: BTreeMap<LockKind, LockObservation>,
    pub writers_closed_claimed: bool,
}
#[derive(Clone, Debug)]
pub struct HistoricalBaseline {
    pub configuration_sha256: String,
    pub cut: ClosedCut,
}
pub struct EvidenceInput {
    pub expected_uid: u32,
    pub configuration_sha256: String,
    pub state_configuration_digest: String,
    pub original_receipt: Vec<u8>,
    pub baseline: Option<HistoricalBaseline>,
    pub current: ClosedCut,
    /// Single-receipt preparation only; coupled/full-profile receipts are held.
    pub other_state_receipts_present: bool,
    pub unresolved_operation_present: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    InvalidEvidence,
    MissingHistoricalBaseline,
    MissingClosedState,
    LeaseMismatch,
    IncompleteInventory,
    ContentChanged,
    IdentityChanged,
    ConfigurationChanged,
    UnsupportedReceipt,
    NoDeviceChange,
    CoupledReceipts,
    UncertainOutcome,
    EventOutOfOrder,
    ObservationChanged,
    OriginalBackupMismatch,
}
impl std::fmt::Display for Hold {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Offline continuity plan held: {self:?}")
    }
}
impl std::error::Error for Hold {}
type Result<T> = std::result::Result<T, Hold>;

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(value: &impl Serialize) -> Result<String> {
    Ok(hash(
        &serde_jcs::to_vec(value).map_err(|_| Hold::InvalidEvidence)?,
    ))
}
fn is_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn image(cut: &ClosedCut, file: FileKind) -> Result<&Image> {
    match cut.files.get(&file) {
        Some(Presence::Present(image)) => Ok(image),
        _ => Err(Hold::IncompleteInventory),
    }
}
fn check_cut(cut: &ClosedCut, uid: u32) -> Result<()> {
    if !cut.writers_closed_claimed {
        return Err(Hold::MissingClosedState);
    }
    if !cut.directory.safe(uid, true) {
        return Err(Hold::IdentityChanged);
    }
    if cut.files.len() != FILES.len() || FILES.iter().any(|key| !cut.files.contains_key(key)) {
        return Err(Hold::IncompleteInventory);
    }
    for present in cut.files.values() {
        if let Presence::Present(i) = present {
            if !i.identity.safe(uid, false) || i.bytes > 256 * 1024 * 1024 || !is_hash(&i.sha256) {
                return Err(Hold::InvalidEvidence);
            }
        }
    }
    for required in [FileKind::Access, FileKind::Atlas, FileKind::Receipt] {
        image(cut, required)?;
    }
    let mut identities = BTreeSet::from([(cut.directory.device, cut.directory.inode)]);
    for present in cut.files.values() {
        if let Presence::Present(i) = present {
            if !identities.insert((i.identity.device, i.identity.inode)) {
                return Err(Hold::IdentityChanged);
            }
        }
    }
    if cut.locks.len() != LOCKS.len() {
        return Err(Hold::LeaseMismatch);
    }
    for key in LOCKS {
        let lock = cut.locks.get(&key).ok_or(Hold::LeaseMismatch)?;
        if !lock.exclusive_claimed || lock.opened != lock.named || !lock.opened.safe(uid, false) {
            return Err(Hold::LeaseMismatch);
        }
        if !identities.insert((lock.opened.device, lock.opened.inode)) {
            return Err(Hold::LeaseMismatch);
        }
    }
    Ok(())
}

/// Still requires authenticated historical provenance and original native
/// lease/file/durability bindings. This is NEVER a permit, even on success.
#[derive(Clone, Debug)]
pub struct PlanData {
    original_receipt_sha256: String,
    candidate_receipt_sha256: String,
    preservation_sha256: String,
    database_cut_sha256: String,
    lease_sha256: String,
    root: Identity,
    receipt_identity: Identity,
    candidate_bytes: u64,
    reserved_identities: Vec<(u64, u64)>,
}
impl PlanData {
    pub fn original_receipt_sha256(&self) -> &str {
        &self.original_receipt_sha256
    }
    pub fn candidate_receipt_sha256(&self) -> &str {
        &self.candidate_receipt_sha256
    }
    pub fn preservation_sha256(&self) -> &str {
        &self.preservation_sha256
    }
    pub fn database_cut_sha256(&self) -> &str {
        &self.database_cut_sha256
    }
    pub fn lease_sha256(&self) -> &str {
        &self.lease_sha256
    }
    pub fn grants_publication_authority(&self) -> bool {
        false
    }
}

/// Compare an exact historical closed cut with current observation data. Only
/// device-number differences are modeled; changed bytes/absence/inodes refuse.
/// Ordinary app writes since an old baseline need separately proven continuity;
/// this first increment intentionally has no exception or inferred chain.
pub fn assess(input: &EvidenceInput) -> Result<PlanData> {
    if input.unresolved_operation_present {
        return Err(Hold::UncertainOutcome);
    }
    if input.other_state_receipts_present {
        return Err(Hold::CoupledReceipts);
    }
    let baseline = input
        .baseline
        .as_ref()
        .ok_or(Hold::MissingHistoricalBaseline)?;
    if !is_hash(&input.configuration_sha256) || !is_hash(&input.state_configuration_digest) {
        return Err(Hold::InvalidEvidence);
    }
    if input.configuration_sha256 != baseline.configuration_sha256 {
        return Err(Hold::ConfigurationChanged);
    }
    check_cut(&baseline.cut, input.expected_uid)?;
    check_cut(&input.current, input.expected_uid)?;
    if !baseline
        .cut
        .directory
        .same_except_device(&input.current.directory)
    {
        return Err(Hold::IdentityChanged);
    }
    for key in LOCKS {
        if !baseline.cut.locks[&key]
            .opened
            .same_except_device(&input.current.locks[&key].opened)
        {
            return Err(Hold::LeaseMismatch);
        }
    }
    if input.original_receipt.is_empty() || input.original_receipt.len() > 16 * 1024 {
        return Err(Hold::InvalidEvidence);
    }
    // Reuse the actual strict persistent receipt type, not a second schema.
    let state: State =
        serde_json::from_slice(&input.original_receipt).map_err(|_| Hold::UnsupportedReceipt)?;
    if state.format != "houseatlas-persistent-server/1"
        || state.atlas_schema != crate::storage::DATABASE_VERSION
        || state.access_schema != crate::access::ACCESS_SCHEMA_VERSION
    {
        return Err(Hold::UnsupportedReceipt);
    }
    if state.configuration_digest != input.state_configuration_digest {
        return Err(Hold::ConfigurationChanged);
    }
    let original = hash(&input.original_receipt);
    for file in FILES {
        match (&baseline.cut.files[&file], &input.current.files[&file]) {
            (Presence::Absent, Presence::Absent) => {}
            (Presence::Present(old), Presence::Present(now)) => {
                if !old.identity.same_except_device(&now.identity) {
                    return Err(Hold::IdentityChanged);
                }
                if old.sha256 != now.sha256 || old.bytes != now.bytes {
                    return Err(Hold::ContentChanged);
                }
            }
            _ => return Err(Hold::ContentChanged),
        }
    }
    let receipt = image(&input.current, FileKind::Receipt)?;
    if receipt.identity.device != input.current.directory.device {
        return Err(Hold::IdentityChanged);
    }
    if receipt.sha256 != original || receipt.bytes != input.original_receipt.len() as u64 {
        return Err(Hold::ContentChanged);
    }
    let old_access = image(&baseline.cut, FileKind::Access)?;
    let old_atlas = image(&baseline.cut, FileKind::Atlas)?;
    if (old_access.identity.device, old_access.identity.inode)
        != (state.access_device, state.access_inode)
        || (old_atlas.identity.device, old_atlas.identity.inode)
            != (state.atlas_device, state.atlas_inode)
    {
        return Err(Hold::IdentityChanged);
    }
    let access = image(&input.current, FileKind::Access)?;
    let atlas = image(&input.current, FileKind::Atlas)?;
    if access.identity.device == state.access_device && atlas.identity.device == state.atlas_device
    {
        return Err(Hold::NoDeviceChange);
    }
    let mut candidate = state;
    candidate.access_device = access.identity.device;
    candidate.atlas_device = atlas.identity.device;
    let candidate_bytes = serde_json::to_vec(&candidate).map_err(|_| Hold::InvalidEvidence)?;
    let databases: BTreeMap<_, _> = input
        .current
        .files
        .iter()
        .filter(|(key, _)| **key != FileKind::Receipt)
        .collect();
    Ok(PlanData {
        original_receipt_sha256: original,
        candidate_receipt_sha256: hash(&candidate_bytes),
        preservation_sha256: digest(&input.current)?,
        database_cut_sha256: digest(&databases)?,
        lease_sha256: digest(&(&input.current.directory, &input.current.locks))?,
        root: input.current.directory.clone(),
        receipt_identity: receipt.identity.clone(),
        candidate_bytes: candidate_bytes.len() as u64,
        reserved_identities: input
            .current
            .files
            .values()
            .filter_map(|value| match value {
                Presence::Present(i) => Some((i.identity.device, i.identity.inode)),
                Presence::Absent => None,
            })
            .chain(
                input
                    .current
                    .locks
                    .values()
                    .map(|lock| (lock.opened.device, lock.opened.inode)),
            )
            .chain(std::iter::once((
                input.current.directory.device,
                input.current.directory.inode,
            )))
            .collect(),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Selected,
    PreservationRecorded,
    StageRecorded,
    PublishStarted,
    PublishedRecorded,
    CompleteRecorded,
    Uncertain,
}
#[derive(Clone, Debug)]
pub struct ObservationData {
    pub database_cut_sha256: String,
    pub lease_sha256: String,
    pub receipt_sha256: String,
    pub receipt_identity: Identity,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StagedReceiptData {
    pub image: Image,
    pub named: Identity,
    pub directory: Identity,
}
/// These record claimed evidence hashes, not actual writes/fsync/rename effects.
#[derive(Clone, Debug)]
pub enum EventData {
    Preservation {
        snapshot_sha256: String,
        manifest_sha256: String,
        sync_record_sha256: String,
    },
    Stage {
        staged: StagedReceiptData,
        sync_record_sha256: String,
    },
    BeginPublication {
        observation: ObservationData,
        staged: StagedReceiptData,
    },
    PublicationObserved {
        observation: ObservationData,
        directory_sync_record_sha256: String,
    },
    Complete(ObservationData),
}
pub struct JournalModel {
    plan: PlanData,
    phase: Phase,
    staged: Option<StagedReceiptData>,
}
impl JournalModel {
    pub fn new(plan: PlanData) -> Self {
        Self {
            plan,
            phase: Phase::Selected,
            staged: None,
        }
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn interrupt(&mut self) {
        self.phase = Phase::Uncertain;
    }
    fn same_cut(&self, observation: &ObservationData, receipt: &str) -> Result<()> {
        let identity = if receipt == self.plan.original_receipt_sha256 {
            &self.plan.receipt_identity
        } else {
            &self
                .staged
                .as_ref()
                .ok_or(Hold::ObservationChanged)?
                .image
                .identity
        };
        if observation.database_cut_sha256 != self.plan.database_cut_sha256
            || observation.lease_sha256 != self.plan.lease_sha256
            || observation.receipt_sha256 != receipt
            || &observation.receipt_identity != identity
        {
            return Err(Hold::ObservationChanged);
        }
        Ok(())
    }
    pub fn record(&mut self, event: EventData) -> Result<()> {
        let post_publication = matches!(
            self.phase,
            Phase::PublishStarted | Phase::PublishedRecorded | Phase::CompleteRecorded
        );
        let result = self.record_inner(event);
        if result.is_err() && post_publication {
            self.phase = Phase::Uncertain;
        }
        result
    }
    fn record_inner(&mut self, event: EventData) -> Result<()> {
        if self.phase == Phase::Uncertain {
            return Err(Hold::UncertainOutcome);
        }
        let next = match (self.phase, event) {
            (
                Phase::Selected,
                EventData::Preservation {
                    snapshot_sha256,
                    manifest_sha256,
                    sync_record_sha256,
                },
            ) => {
                if snapshot_sha256 != self.plan.preservation_sha256
                    || manifest_sha256 != self.plan.preservation_sha256
                    || !is_hash(&sync_record_sha256)
                {
                    return Err(Hold::InvalidEvidence);
                }
                Phase::PreservationRecorded
            }
            (
                Phase::PreservationRecorded,
                EventData::Stage {
                    staged,
                    sync_record_sha256,
                },
            ) => {
                if staged.image.sha256 != self.plan.candidate_receipt_sha256
                    || staged.image.bytes != self.plan.candidate_bytes
                    || staged.directory != self.plan.root
                    || staged.image.identity != staged.named
                    || staged.image.identity.device != self.plan.root.device
                    || !staged.image.identity.safe(self.plan.root.uid, false)
                    || self
                        .plan
                        .reserved_identities
                        .contains(&(staged.image.identity.device, staged.image.identity.inode))
                    || !is_hash(&sync_record_sha256)
                {
                    return Err(Hold::InvalidEvidence);
                }
                self.staged = Some(staged);
                Phase::StageRecorded
            }
            (
                Phase::StageRecorded,
                EventData::BeginPublication {
                    observation,
                    staged,
                },
            ) => {
                if self.staged.as_ref() != Some(&staged) {
                    return Err(Hold::ObservationChanged);
                }
                self.same_cut(&observation, &self.plan.original_receipt_sha256)?;
                Phase::PublishStarted
            }
            (
                Phase::PublishStarted,
                EventData::PublicationObserved {
                    observation,
                    directory_sync_record_sha256,
                },
            ) => {
                self.same_cut(&observation, &self.plan.candidate_receipt_sha256)?;
                if !is_hash(&directory_sync_record_sha256) {
                    return Err(Hold::InvalidEvidence);
                }
                Phase::PublishedRecorded
            }
            (Phase::PublishedRecorded, EventData::Complete(observation)) => {
                self.same_cut(&observation, &self.plan.candidate_receipt_sha256)?;
                Phase::CompleteRecorded
            }
            _ => return Err(Hold::EventOutOfOrder),
        };
        self.phase = next;
        Ok(())
    }
    /// Only identifies the preserved old RECEIPT hash. Never restores DB bytes.
    /// Any later data/sidecar/lease change refuses even metadata rollback data.
    pub fn rollback_candidate(
        &mut self,
        observation: &ObservationData,
        original_backup_sha256: &str,
    ) -> Result<&str> {
        let result = (|| {
            if !matches!(
                self.phase,
                Phase::PublishedRecorded | Phase::CompleteRecorded
            ) {
                return Err(Hold::UncertainOutcome);
            }
            self.same_cut(observation, &self.plan.candidate_receipt_sha256)?;
            if original_backup_sha256 != self.plan.original_receipt_sha256 {
                return Err(Hold::OriginalBackupMismatch);
            }
            Ok(())
        })();
        if let Err(error) = result {
            if matches!(
                self.phase,
                Phase::PublishedRecorded | Phase::CompleteRecorded
            ) {
                self.phase = Phase::Uncertain;
            }
            return Err(error);
        }
        Ok(&self.plan.original_receipt_sha256)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservedOutcome {
    OriginalReceiptOnly,
    CandidateReceiptOnly,
    Diverged,
}
/// Read-only receipt-hash classification after interruption; never changes or
/// resumes a model, and an original hash never proves no prior filesystem effect.
pub fn classify(plan: &PlanData, observation: &ObservationData) -> ObservedOutcome {
    if observation.database_cut_sha256 != plan.database_cut_sha256
        || observation.lease_sha256 != plan.lease_sha256
    {
        return ObservedOutcome::Diverged;
    }
    if observation.receipt_sha256 == plan.original_receipt_sha256 {
        ObservedOutcome::OriginalReceiptOnly
    } else if observation.receipt_sha256 == plan.candidate_receipt_sha256 {
        ObservedOutcome::CandidateReceiptOnly
    } else {
        ObservedOutcome::Diverged
    }
}

#[cfg(test)]
#[path = "continuity_plan_healthy.rs"]
mod healthy;
