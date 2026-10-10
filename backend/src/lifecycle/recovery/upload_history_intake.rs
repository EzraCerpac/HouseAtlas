//! Independently signed, discovery/validation-only startup approval.
//! Expectations come from the administrator's independent configuration, never
//! from a catalog scan, restored actor, current browser role or recovered rows.
//! The image capture reads the existing selected descriptor. This component
//! creates no files and performs no database, provider or recovery operation.

use ring::signature::{ED25519, UnparsedPublicKey};
use sha2::{Digest, Sha256};
use std::{
    fs::Metadata,
    os::unix::fs::{FileExt, MetadataExt},
};

use crate::{
    access::{OfflineRecoveryApproval, OfflineRecoveryAuthority, RecoveryDiscoveryGrant},
    app::{
        homebox_queued_upload_history_catalog::{
            MAX_CATALOG_MEMBERS, equal_bytes, hash_bytes, registry_bytes,
        },
        homebox_queued_upload_history_publication::UnadmittedQueuedUploadOriginalFrame,
    },
    config::recovery::{RecoveryConfig, upload_history_origin::VerifiedQueuedUploadHistoryCatalog},
    domain::queue_recovery::TrustedQueueRegistry,
    jobs::QueueConfig,
    lifecycle::provider_dispatch::queued_upload_history_archive::UnadmittedQueuedUploadHistoryArchive,
    media::{
        WorkBudget,
        recovery::{DatabaseMember, MAX_DATABASE},
    },
    storage,
};

const APPROVAL_DOMAIN: &[u8] = b"houseatlas:queued-upload-history:startup-discovery-validation:1\0";
const MAX_TEXT: usize = 4096;
const MAX_QUEUES: usize = 256;
const MAX_ALIASES_PER_QUEUE: usize = 256;
const MAX_TOTAL_ALIASES: usize = 1024;
const MAX_QUEUE_TEXT_BYTES: usize = 16 * 1024;
const MAX_REGISTRY_BYTES: usize = 4 * 1024 * 1024;
const MAX_APPROVAL_BYTES: usize = MAX_REGISTRY_BYTES + 16 * 1024;
const CHUNK: usize = 64 * 1024;

fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Queued upload startup approval unavailable",
    )
}

fn checkpoint(budget: &WorkBudget) -> storage::Result<()> {
    budget.check().map_err(|_| unavailable())
}

fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_TEXT && !value.chars().any(char::is_control)
}

/// Explicit administrator-selected matching DATA. Supplying this structure is
/// not approval, authentication or a claim that any archive/image is genuine.
/// The ordered registry must include every configured physical queue, even
/// registrations that contain no jobs. No registry is discovered here.
pub struct UploadHistoryStartupExpectations<'a> {
    pub deployment_id: &'a str,
    pub queues: &'a [QueueConfig],
    pub catalog_sha256: [u8; 32],
    pub signed_envelope_sha256: [u8; 32],
    pub catalog_generation: u64,
    pub producer_issuer: &'a str,
    pub producer_public_key_sha256: [u8; 32],
    pub administrator_public_key_sha256: [u8; 32],
    pub selected_image_sha256: [u8; 32],
    pub selected_image_byte_size: u64,
}

/// Frozen bounded independent expectations. This type has no public DATA or
/// signature setter, serde decoder, cloning or unsigned authority conversion.
pub struct ExpectedStartupUploadHistoryBinding {
    deployment_id: String,
    registry: TrustedQueueRegistry,
    registry_bytes: Vec<u8>,
    catalog_sha256: [u8; 32],
    signed_envelope_sha256: [u8; 32],
    catalog_generation: u64,
    producer_issuer: String,
    producer_public_key_sha256: [u8; 32],
    administrator_public_key_sha256: [u8; 32],
    selected_image_sha256: [u8; 32],
    selected_image_byte_size: u64,
    approval_request: Vec<u8>,
}

impl ExpectedStartupUploadHistoryBinding {
    pub fn new(
        input: UploadHistoryStartupExpectations<'_>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        checkpoint(budget)?;
        if !valid_text(input.deployment_id)
            || !valid_text(input.producer_issuer)
            || input.queues.len() > MAX_QUEUES
            || input.catalog_generation == 0
            || input.selected_image_byte_size == 0
            || input.selected_image_byte_size > MAX_DATABASE as u64
            || input.producer_public_key_sha256 == input.administrator_public_key_sha256
        {
            return Err(unavailable());
        }
        let mut alias_count = 0usize;
        for config in input.queues {
            checkpoint(budget)?;
            alias_count = alias_count
                .checked_add(config.registration.aliases.len())
                .ok_or_else(unavailable)?;
            if config.registration.aliases.len() > MAX_ALIASES_PER_QUEUE
                || alias_count > MAX_TOTAL_ALIASES
                || [
                    &config.registration.identity.deployment_id,
                    &config.registration.identity.physical_database_id,
                    &config.registration.dispatcher_owner_id,
                    &config.admission_profile.profile_version,
                ]
                .iter()
                .any(|value| value.len() > MAX_QUEUE_TEXT_BYTES)
            {
                return Err(unavailable());
            }
            for alias in &config.registration.aliases {
                checkpoint(budget)?;
                if [
                    &alias.partition.workspace_id,
                    &alias.partition.home_id,
                    &alias.partition.source_instance_id,
                    &alias.partition.collection_id,
                    &alias.canonical_collection_id,
                ]
                .iter()
                .any(|value| value.len() > MAX_QUEUE_TEXT_BYTES)
                {
                    return Err(unavailable());
                }
            }
            if config.registration.identity.deployment_id != input.deployment_id {
                return Err(unavailable());
            }
        }
        // Existing validators compare alias sets. Count and byte limits above
        // precede all such work and every subsequent deep registry clone.
        // The genuine catalog helper counts and bounds every borrowed registry
        // fact before encoding. Its exact ordered encoding bounds the subsequent
        // immutable registry clone; no JSON/Debug reconstruction is used.
        let encoded = registry_bytes(input.queues, budget)?;
        if encoded.len() > MAX_REGISTRY_BYTES {
            return Err(unavailable());
        }
        let mut request = ApprovalBytes::new(budget);
        request.append(APPROVAL_DOMAIN)?;
        request.field(input.deployment_id.as_bytes())?;
        request.field(&encoded)?;
        request.append(&input.catalog_sha256)?;
        request.append(&input.signed_envelope_sha256)?;
        request.append(&input.catalog_generation.to_be_bytes())?;
        request.field(input.producer_issuer.as_bytes())?;
        request.append(&input.producer_public_key_sha256)?;
        request.append(&input.administrator_public_key_sha256)?;
        request.append(&input.selected_image_sha256)?;
        request.append(&input.selected_image_byte_size.to_be_bytes())?;
        checkpoint(budget)?;
        let registry = TrustedQueueRegistry::new(input.queues)?;
        let result = Self {
            deployment_id: input.deployment_id.to_owned(),
            registry,
            registry_bytes: encoded,
            catalog_sha256: input.catalog_sha256,
            signed_envelope_sha256: input.signed_envelope_sha256,
            catalog_generation: input.catalog_generation,
            producer_issuer: input.producer_issuer.to_owned(),
            producer_public_key_sha256: input.producer_public_key_sha256,
            administrator_public_key_sha256: input.administrator_public_key_sha256,
            selected_image_sha256: input.selected_image_sha256,
            selected_image_byte_size: input.selected_image_byte_size,
            approval_request: request.bytes,
        };
        checkpoint(budget)?;
        Ok(result)
    }

    /// Exact domain-separated bytes for an external administrator to inspect
    /// and sign. This component supplies no signer, key generation or approval.
    pub fn approval_request_bytes(&self) -> &[u8] {
        &self.approval_request
    }

    pub fn deployment_id(&self) -> &str {
        &self.deployment_id
    }

    pub fn queues(&self) -> &[QueueConfig] {
        self.registry.configs()
    }

    pub fn registry_bytes(&self) -> &[u8] {
        &self.registry_bytes
    }

    pub fn catalog_sha256(&self) -> &[u8; 32] {
        &self.catalog_sha256
    }

    pub fn signed_envelope_sha256(&self) -> &[u8; 32] {
        &self.signed_envelope_sha256
    }

    pub fn catalog_generation(&self) -> u64 {
        self.catalog_generation
    }

    pub fn producer_issuer(&self) -> &str {
        &self.producer_issuer
    }

    pub fn producer_public_key_sha256(&self) -> &[u8; 32] {
        &self.producer_public_key_sha256
    }

    pub fn selected_image_sha256(&self) -> &[u8; 32] {
        &self.selected_image_sha256
    }

    pub fn selected_image_byte_size(&self) -> u64 {
        self.selected_image_byte_size
    }
}

/// Separately pinned administrator verifier. A producer key cannot also serve
/// as the administrator key. No public key is taken from catalog/image DATA.
pub struct TrustedUploadHistoryAdminVerifier {
    administrator_public_key: [u8; 32],
    administrator_fingerprint: [u8; 32],
    producer_fingerprint: [u8; 32],
}

impl TrustedUploadHistoryAdminVerifier {
    pub fn new(
        administrator_public_key: [u8; 32],
        producer_public_key: [u8; 32],
    ) -> storage::Result<Self> {
        if administrator_public_key == producer_public_key {
            return Err(unavailable());
        }
        Ok(Self {
            administrator_public_key,
            administrator_fingerprint: Sha256::digest(administrator_public_key).into(),
            producer_fingerprint: Sha256::digest(producer_public_key).into(),
        })
    }

    pub fn verify(
        &self,
        expected: ExpectedStartupUploadHistoryBinding,
        signature: &[u8; 64],
        budget: &WorkBudget,
    ) -> storage::Result<VerifiedUploadHistoryStartupApproval> {
        checkpoint(budget)?;
        if expected.administrator_public_key_sha256 != self.administrator_fingerprint
            || expected.producer_public_key_sha256 != self.producer_fingerprint
        {
            return Err(unavailable());
        }
        UnparsedPublicKey::new(&ED25519, self.administrator_public_key)
            .verify(expected.approval_request_bytes(), signature)
            .map_err(|_| unavailable())?;
        checkpoint(budget)?;
        Ok(VerifiedUploadHistoryStartupApproval { expected })
    }
}

/// Private construction follows actual administrator signature verification.
/// It grants discovery/validation only for the signed complete registry. It
/// grants no read disclosure, reopen, dispatch, resume or mutation permission.
pub struct VerifiedUploadHistoryStartupApproval {
    expected: ExpectedStartupUploadHistoryBinding,
}

impl VerifiedUploadHistoryStartupApproval {
    pub fn expectations(&self) -> &ExpectedStartupUploadHistoryBinding {
        &self.expected
    }

    fn discovery_approval(&self) -> storage::Result<OfflineRecoveryApproval> {
        OfflineRecoveryApproval::discovery_validation(
            self.expected.deployment_id.clone(),
            self.expected.registry.configs(),
        )
        .map_err(|_| unavailable())
    }
}

#[derive(PartialEq, Eq)]
struct ImageIdentity {
    device: u64,
    inode: u64,
    byte_size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

impl ImageIdentity {
    fn from_metadata(metadata: Metadata) -> storage::Result<Self> {
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_DATABASE as u64 {
            return Err(unavailable());
        }
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            byte_size: metadata.len(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        })
    }
}

/// Hash capture of the administrator-selected existing image descriptor.
/// It creates no path, file, database or configuration. The configuration owner
/// must keep the selected files closed to writers throughout validation/reopen;
/// metadata pins detect ordinary replacement, not hostile same-owner changes.
/// A matching hash is integrity DATA; it is never image semantic validation.
pub struct SelectedQueuedUploadHistoryImage<'config> {
    config: &'config RecoveryConfig,
    identity: ImageIdentity,
    sha256: [u8; 32],
}

impl<'config> SelectedQueuedUploadHistoryImage<'config> {
    pub fn capture_existing(
        config: &'config RecoveryConfig,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        checkpoint(budget)?;
        config.check().map_err(|_| unavailable())?;
        let file = config.database.file();
        let before = ImageIdentity::from_metadata(file.metadata().map_err(|_| unavailable())?)?;
        let mut hash = Sha256::new();
        let mut offset = 0u64;
        let mut buffer = [0u8; CHUNK];
        while offset < before.byte_size {
            checkpoint(budget)?;
            let remaining = usize::try_from((before.byte_size - offset).min(CHUNK as u64))
                .map_err(|_| unavailable())?;
            // Positional reads leave the shared descriptor's cursor untouched.
            let read = file
                .read_at(&mut buffer[..remaining], offset)
                .map_err(|_| unavailable())?;
            if read == 0 {
                return Err(unavailable());
            }
            hash.update(&buffer[..read]);
            offset = offset.checked_add(read as u64).ok_or_else(unavailable)?;
        }
        checkpoint(budget)?;
        if file
            .read_at(&mut buffer[..1], offset)
            .map_err(|_| unavailable())?
            != 0
            || ImageIdentity::from_metadata(file.metadata().map_err(|_| unavailable())?)? != before
        {
            return Err(unavailable());
        }
        config.check().map_err(|_| unavailable())?;
        checkpoint(budget)?;
        Ok(Self {
            config,
            identity: before,
            sha256: hash.finalize().into(),
        })
    }

    pub fn configuration(&self) -> &'config RecoveryConfig {
        self.config
    }

    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }

    pub fn byte_size(&self) -> u64 {
        self.identity.byte_size
    }

    pub(crate) fn revalidate(&self, budget: &WorkBudget) -> storage::Result<()> {
        checkpoint(budget)?;
        self.config.check().map_err(|_| unavailable())?;
        if ImageIdentity::from_metadata(
            self.config
                .database
                .file()
                .metadata()
                .map_err(|_| unavailable())?,
        )? != self.identity
        {
            return Err(unavailable());
        }
        checkpoint(budget)
    }
}

/// Actual startup join retaining independently verified approval/origin and
/// descriptor-captured image plus immutable archive readback. It exposes only
/// discovery/validation authority and authenticated frame inputs. Subsequent
/// genuine semantic owner decoders and strict selected-image validation are
/// required before the existing lifecycle can validate/open any recovery.
pub struct PreparedQueuedUploadHistoryIntake<'borrow, 'origin, 'config> {
    approval: &'borrow VerifiedUploadHistoryStartupApproval,
    origin: &'borrow VerifiedQueuedUploadHistoryCatalog<'origin>,
    archive: &'borrow UnadmittedQueuedUploadHistoryArchive,
    image: &'borrow SelectedQueuedUploadHistoryImage<'config>,
    authority: OfflineRecoveryAuthority,
    grant: RecoveryDiscoveryGrant,
}

impl<'borrow, 'origin, 'config> PreparedQueuedUploadHistoryIntake<'borrow, 'origin, 'config> {
    pub fn prepare(
        approval: &'borrow VerifiedUploadHistoryStartupApproval,
        origin: &'borrow VerifiedQueuedUploadHistoryCatalog<'origin>,
        archive: &'borrow UnadmittedQueuedUploadHistoryArchive,
        image: &'borrow SelectedQueuedUploadHistoryImage<'config>,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        checkpoint(budget)?;
        image.revalidate(budget)?;
        let expected = approval.expectations();
        if expected.catalog_sha256 != origin.digest()
            || expected.signed_envelope_sha256 != hash_bytes(origin.envelope_bytes(), budget)?
            || expected.catalog_generation != origin.generation()
            || expected.deployment_id != origin.deployment_id()
            || expected.producer_issuer != origin.issuer_id()
            || expected.producer_public_key_sha256 != origin.public_key_fingerprint()
            || expected.selected_image_sha256 != image.sha256()
            || expected.selected_image_byte_size != image.byte_size()
            || origin.expected_origin() != archive.destination()
            || archive.generation() != expected.catalog_generation
            || origin.catalog().queue_count() != expected.queues().len()
            || !equal_bytes(expected.registry_bytes(), origin.registry_bytes(), budget)?
            || !equal_bytes(origin.envelope_bytes(), archive.envelope_bytes(), budget)?
            || !equal_bytes(origin.catalog_bytes(), archive.catalog_bytes(), budget)?
        {
            return Err(unavailable());
        }
        let members = origin.catalog().members();
        if members.len() != archive.members().len() {
            return Err(unavailable());
        }
        for (declared, observed) in members.iter().zip(archive.members()) {
            checkpoint(budget)?;
            if declared.queue_index() >= expected.queues().len()
                || declared.name() != observed.name()
                || declared.byte_size() != observed.bytes().len() as u64
                || declared.sha256() != observed.sha256()
                || declared.sha256() != hash_bytes(observed.bytes(), budget)?
            {
                return Err(unavailable());
            }
            // Framing is independently required here but creates no historical
            // enqueue/native/media proof. Semantic owner decoding comes later.
            UnadmittedQueuedUploadOriginalFrame::parse(observed.bytes(), budget)?;
        }
        image.revalidate(budget)?;
        let authority = OfflineRecoveryAuthority::from_trusted_administrative_approval(
            approval.discovery_approval()?,
        );
        let grant = authority
            .capture_discovery(expected.queues())
            .map_err(|_| unavailable())?;
        checkpoint(budget)?;
        Ok(Self {
            approval,
            origin,
            archive,
            image,
            authority,
            grant,
        })
    }

    pub fn approval(&self) -> &'borrow VerifiedUploadHistoryStartupApproval {
        self.approval
    }

    pub fn origin(&self) -> &'borrow VerifiedQueuedUploadHistoryCatalog<'origin> {
        self.origin
    }

    pub fn archive(&self) -> &'borrow UnadmittedQueuedUploadHistoryArchive {
        self.archive
    }

    pub fn image(&self) -> &'borrow SelectedQueuedUploadHistoryImage<'config> {
        self.image
    }

    pub fn registry(&self) -> &[QueueConfig] {
        self.approval.expectations().queues()
    }

    pub fn authority(&self) -> &OfflineRecoveryAuthority {
        &self.authority
    }

    pub fn grant(&self) -> &RecoveryDiscoveryGrant {
        &self.grant
    }

    pub fn frame(
        &self,
        index: usize,
        budget: &WorkBudget,
    ) -> storage::Result<AuthenticatedQueuedUploadOriginalFrame<'_>> {
        checkpoint(budget)?;
        self.image.revalidate(budget)?;
        let declared = self
            .origin
            .catalog()
            .members()
            .get(index)
            .ok_or_else(unavailable)?;
        let observed = self.archive.members().get(index).ok_or_else(unavailable)?;
        // Both referents are borrowed immutable closed carriers, so the prepare
        // join cannot be replaced by a later catalog/member DATA allocation.
        UnadmittedQueuedUploadOriginalFrame::parse(observed.bytes(), budget)?;
        checkpoint(budget)?;
        Ok(AuthenticatedQueuedUploadOriginalFrame {
            original_bytes: observed.bytes(),
            catalog_digest: self.origin.digest(),
            generation: self.origin.generation(),
            queue_index: declared.queue_index(),
            job_id: declared.job_id(),
            registry: self.registry(),
            frame_sha256: declared.sha256(),
        })
    }
}

// A consuming export is private to this module. The explicit external
// referents must be the very same immutable owners joined by prepare; they
// supply the permit lifetime independently of the short image/config borrow.
fn export_prepared<'external, 'origin>(
    prepared: PreparedQueuedUploadHistoryIntake<'_, 'origin, '_>,
    approval: &'external VerifiedUploadHistoryStartupApproval,
    origin: &'external VerifiedQueuedUploadHistoryCatalog<'origin>,
    archive: &'external UnadmittedQueuedUploadHistoryArchive,
    budget: &WorkBudget,
) -> storage::Result<ExportedIntake<'external>> {
    checkpoint(budget)?;
    if !std::ptr::eq(prepared.approval, approval)
        || !std::ptr::eq(prepared.origin, origin)
        || !std::ptr::eq(prepared.archive, archive)
    {
        return Err(unavailable());
    }
    prepared.image.revalidate(budget)?;
    let members = origin.catalog().members();
    if members.len() > MAX_CATALOG_MEMBERS || members.len() != archive.members().len() {
        return Err(unavailable());
    }
    let registry = approval.expectations().queues();
    let mut frames = Vec::new();
    frames
        .try_reserve_exact(members.len())
        .map_err(|_| unavailable())?;
    for (declared, observed) in members.iter().zip(archive.members()) {
        checkpoint(budget)?;
        if declared.queue_index() >= registry.len()
            || declared.name() != observed.name()
            || declared.byte_size() != observed.bytes().len() as u64
            || declared.sha256() != observed.sha256()
            || declared.sha256() != hash_bytes(observed.bytes(), budget)?
        {
            return Err(unavailable());
        }
        UnadmittedQueuedUploadOriginalFrame::parse(observed.bytes(), budget)?;
        frames.push(AuthenticatedQueuedUploadOriginalFrame {
            original_bytes: observed.bytes(),
            catalog_digest: origin.digest(),
            generation: origin.generation(),
            queue_index: declared.queue_index(),
            job_id: declared.job_id(),
            registry,
            frame_sha256: declared.sha256(),
        });
    }
    prepared.image.revalidate(budget)?;
    let identity = ImageIdentity::from_metadata(
        prepared
            .image
            .configuration()
            .database
            .file()
            .metadata()
            .map_err(|_| unavailable())?,
    )?;
    if identity != prepared.image.identity {
        return Err(unavailable());
    }
    checkpoint(budget)?;
    Ok(ExportedIntake {
        frames,
        registry,
        authority: prepared.authority,
        grant: prepared.grant,
        pin: FullImagePin {
            identity,
            sha256: prepared.image.sha256(),
        },
    })
}

struct ExportedIntake<'external> {
    frames: Vec<AuthenticatedQueuedUploadOriginalFrame<'external>>,
    registry: &'external [QueueConfig],
    authority: OfflineRecoveryAuthority,
    grant: RecoveryDiscoveryGrant,
    pin: FullImagePin,
}

/// Config-independent closed-image pin. No metadata or digest setter exists.
pub(super) struct FullImagePin {
    identity: ImageIdentity,
    sha256: [u8; 32],
}
impl FullImagePin {
    pub(super) fn revalidate(
        &self,
        config: &RecoveryConfig,
        budget: &WorkBudget,
    ) -> storage::Result<()> {
        // Reuse capture's bounded positional read and full metadata/config
        // checks on the ORIGINAL descriptor, without creating a path or DB.
        let observed = SelectedQueuedUploadHistoryImage::capture_existing(config, budget)?;
        if observed.identity != self.identity || observed.sha256 != self.sha256 {
            return Err(unavailable());
        }
        let expected = config.expected_database.as_ref().ok_or_else(unavailable)?;
        if expected.file != "atlas.sqlite"
            || expected.byte_size != self.identity.byte_size
            || expected.sha256 != hex_digest(self.sha256)
        {
            return Err(unavailable());
        }
        checkpoint(budget)
    }
}

fn hex_digest(digest: [u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Own the original selected configuration; permits borrow only immutable
/// external verified inputs. No self-reference or authority reissuance exists.
pub(super) struct OwnedQueuedUploadHistoryIntake<'external> {
    pub(super) config: RecoveryConfig,
    pub(super) frames: Vec<AuthenticatedQueuedUploadOriginalFrame<'external>>,
    pub(super) registry: &'external [QueueConfig],
    pub(super) authority: OfflineRecoveryAuthority,
    pub(super) grant: RecoveryDiscoveryGrant,
    pub(super) pin: FullImagePin,
}
impl<'external> OwnedQueuedUploadHistoryIntake<'external> {
    pub(super) fn new<'origin>(
        mut config: RecoveryConfig,
        approval: &'external VerifiedUploadHistoryStartupApproval,
        origin: &'external VerifiedQueuedUploadHistoryCatalog<'origin>,
        archive: &'external UnadmittedQueuedUploadHistoryArchive,
        budget: &WorkBudget,
    ) -> storage::Result<Self> {
        checkpoint(budget)?;
        let expected = approval.expectations();
        let binding = DatabaseMember {
            file: "atlas.sqlite".to_owned(),
            sha256: hex_digest(*expected.selected_image_sha256()),
            byte_size: expected.selected_image_byte_size(),
        };
        if config
            .expected_database
            .as_ref()
            .is_some_and(|old| old != &binding)
        {
            return Err(unavailable());
        }
        // Bind verified approval bytes before any capture/semantic/open work.
        config.expected_database = Some(binding);
        let image = SelectedQueuedUploadHistoryImage::capture_existing(&config, budget)?;
        let prepared =
            PreparedQueuedUploadHistoryIntake::prepare(approval, origin, archive, &image, budget)?;
        let ExportedIntake {
            frames,
            registry,
            authority,
            grant,
            pin,
        } = export_prepared(prepared, approval, origin, archive, budget)?;
        pin.revalidate(&config, budget)?;
        Ok(Self {
            config,
            frames,
            registry,
            authority,
            grant,
            pin,
        })
    }
}

/// A single archive frame joined to actual administrator approval, verified
/// producer origin, exact complete registry and the selected image capture.
/// This is the input permit for subsequent owner semantic decoders. Framing
/// and authentication never manufacture enqueue, media or native owner proofs.
/// No public constructor, cloning or serde decoder can issue this permit.
pub struct AuthenticatedQueuedUploadOriginalFrame<'frame> {
    original_bytes: &'frame [u8],
    catalog_digest: [u8; 32],
    generation: u64,
    queue_index: usize,
    job_id: &'frame str,
    registry: &'frame [QueueConfig],
    frame_sha256: [u8; 32],
}

impl<'frame> AuthenticatedQueuedUploadOriginalFrame<'frame> {
    pub fn original_bytes(&self) -> &'frame [u8] {
        self.original_bytes
    }

    pub fn catalog_digest(&self) -> [u8; 32] {
        self.catalog_digest
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn queue_index(&self) -> usize {
        self.queue_index
    }

    pub fn job_id(&self) -> &'frame str {
        self.job_id
    }

    pub fn registry(&self) -> &'frame [QueueConfig] {
        self.registry
    }

    pub fn frame_sha256(&self) -> [u8; 32] {
        self.frame_sha256
    }
}

struct ApprovalBytes<'a> {
    bytes: Vec<u8>,
    budget: &'a WorkBudget,
}

impl<'a> ApprovalBytes<'a> {
    fn new(budget: &'a WorkBudget) -> Self {
        Self {
            bytes: Vec::new(),
            budget,
        }
    }

    fn append(&mut self, bytes: &[u8]) -> storage::Result<()> {
        checkpoint(self.budget)?;
        if self
            .bytes
            .len()
            .checked_add(bytes.len())
            .is_none_or(|size| size > MAX_APPROVAL_BYTES)
        {
            return Err(unavailable());
        }
        self.bytes
            .try_reserve(bytes.len())
            .map_err(|_| unavailable())?;
        for chunk in bytes.chunks(CHUNK) {
            checkpoint(self.budget)?;
            self.bytes.extend_from_slice(chunk);
        }
        checkpoint(self.budget)
    }

    fn field(&mut self, bytes: &[u8]) -> storage::Result<()> {
        let length = u64::try_from(bytes.len()).map_err(|_| unavailable())?;
        self.append(&length.to_be_bytes())?;
        self.append(bytes)
    }
}
