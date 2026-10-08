//! Concrete native renderer publication and strict independent catalog policy.
//! Configuration is a mandatory trusted native input, never candidate archive
//! metadata. No callback default, grant restoration or cold-start inference.
use std::{collections::BTreeMap, sync::Arc};

use super::native::{access_error, access_scope};
use super::recovery_policy_archive::{
    AuthenticatedMediaPolicyArchive, MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES,
    MAX_MEDIA_POLICY_ARCHIVE_MEMBERS, MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES,
    MediaPolicyArchiveCatalogEntry, MediaPolicyArchiveOrigin, MediaPolicyArchivePacket,
    MediaPolicyArchiveReadAuthorization, MediaPolicyArchiveWriteAuthorization,
    RestoredMediaPolicyArchiveCut, valid_media_policy_archive_member,
};
use super::review::VerifiedAssetReview;
use super::staged_upload::StagedAssetPlan;
use super::types::{Scope, sha256};
use super::{MediaError, MediaResult, WorkBudget};
use crate::{
    access as a,
    lifecycle::provider_dispatch::{
        archive::{ArchiveDestination, ArchiveReceipt, PrivateStockArchive},
        media_policy_archive::{NativeMediaPolicyArchive, read_media_policy_archive},
    },
    storage as s,
};

/// Actual configured same-Store token and native descriptor plus explicit scope
/// retention policy. Origin strings only describe the trusted host's mapping.
/// The host must select the genuine deployment/DB/archive/generation mapping;
/// neither this constructor nor filesystem ownership authenticates that input.
pub struct NativeMediaArchiveBinding {
    store: s::AssetReviewStoreIdentity,
    archive: Arc<PrivateStockArchive>,
    origin: MediaPolicyArchiveOrigin,
    scopes: Vec<Scope>,
}
impl NativeMediaArchiveBinding {
    pub fn new(
        store: s::AssetReviewStoreIdentity,
        archive: Arc<PrivateStockArchive>,
        origin: MediaPolicyArchiveOrigin,
        scopes: Vec<Scope>,
    ) -> MediaResult<Self> {
        origin.validate()?;
        if scopes.is_empty() || scopes.len() > 10_000 {
            return Err(MediaError::InvalidInput);
        }
        for (index, scope) in scopes.iter().enumerate() {
            scope.validate()?;
            if scopes[..index].contains(scope) {
                return Err(MediaError::InvalidInput);
            }
        }
        if archive.max_frame_bytes() > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES {
            return Err(MediaError::InvalidInput);
        }
        Ok(Self {
            store,
            archive,
            origin,
            scopes,
        })
    }
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.origin
    }
    pub fn destination(&self) -> &ArchiveDestination {
        self.archive.destination()
    }
    pub fn store_identity(&self) -> &s::AssetReviewStoreIdentity {
        &self.store
    }
}

/// Exact independently supplied catalog reference DATA, not authentication.
/// Root configuration may construct these ONLY from its genuine separately
/// admitted immutable native generation, never from the candidate scan/SQL.
pub struct NativeMediaArchiveExpectedMember {
    name: String,
    bytes: Vec<u8>,
}
impl NativeMediaArchiveExpectedMember {
    pub fn new(name: String, bytes: Vec<u8>) -> MediaResult<Self> {
        if !valid_media_policy_archive_member(&name)
            || bytes.is_empty()
            || bytes.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(Self { name, bytes })
    }
}

/// Immutable native configuration/capture generation. No serde, mutable member
/// setter or adoption from a candidate archive. Fresh publication emits it only
/// after actual immutable fsync receipts. Historical admission remains the
/// trusted native configuration boundary, not an inference performed here.
#[derive(Clone)]
pub struct NativeMediaArchiveGeneration {
    destination: ArchiveDestination,
    origin: MediaPolicyArchiveOrigin,
    scopes: Vec<Scope>,
    members: BTreeMap<String, Vec<u8>>,
    catalog: Vec<MediaPolicyArchiveCatalogEntry>,
    total: usize,
    // Retain the actual fresh Store allocation across genuine successors and
    // clones. Independent configuration DATA never supplies producer lineage.
    producer_lineage: Option<s::AssetReviewStoreIdentity>,
}

/// Opaque complete producer snapshot. Only this native publication owner can
/// construct it; decoded/configured DATA cannot issue a capture. No Clone/serde.
pub struct PublishedNativeMediaReference {
    generation: NativeMediaArchiveGeneration,
    audit_id: String,
}
impl PublishedNativeMediaReference {
    fn published(generation: NativeMediaArchiveGeneration, audit_id: &str) -> Self {
        Self {
            generation,
            audit_id: audit_id.into(),
        }
    }
    pub(super) fn generation(&self) -> &NativeMediaArchiveGeneration {
        &self.generation
    }
    pub(super) fn audit_id(&self) -> &str {
        &self.audit_id
    }
}
impl NativeMediaArchiveGeneration {
    /// Mandatory independent configuration input. This performs strict bounded
    /// mechanical admission; it does NOT authenticate the supplied reference's
    /// origin or historical producer. The actual native configuration owner must
    /// already qualify the complete generation/destination/producer provenance.
    /// Do not feed candidate catalog bytes, guessed hashes/paths or SQL facts.
    pub fn from_trusted_configuration(
        binding: &NativeMediaArchiveBinding,
        members: Vec<NativeMediaArchiveExpectedMember>,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        budget.check()?;
        let mut generation = Self::empty(binding);
        for member in members {
            budget.check()?;
            generation.insert(member.name, member.bytes)?;
        }
        // Validate closed codecs and all configured scope/origin correlations
        // against independently supplied complete reference bytes before use.
        let reader = NativeMediaArchiveReadOwner {
            generation: generation.clone(),
        };
        for (name, bytes) in &generation.members {
            MediaPolicyArchivePacket::decode(bytes, &generation.destination, name, &reader, budget)
                .map_err(|_| MediaError::InvalidInput)?;
        }
        budget.check()?;
        Ok(generation)
    }
    fn empty(binding: &NativeMediaArchiveBinding) -> Self {
        Self {
            destination: binding.destination().clone(),
            origin: binding.origin.clone(),
            scopes: binding.scopes.clone(),
            members: BTreeMap::new(),
            catalog: Vec::new(),
            total: 0,
            producer_lineage: None,
        }
    }
    pub(super) fn reference_parts(
        &self,
    ) -> (
        &ArchiveDestination,
        &MediaPolicyArchiveOrigin,
        &[Scope],
        &BTreeMap<String, Vec<u8>>,
    ) {
        (&self.destination, &self.origin, &self.scopes, &self.members)
    }
    /// Mechanical closed source validation only; emits no generation or lineage.
    pub(super) fn validate_reference_data(
        destination: &ArchiveDestination,
        origin: &MediaPolicyArchiveOrigin,
        scopes: &[Scope],
        members: Vec<NativeMediaArchiveExpectedMember>,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        origin.validate()?;
        if scopes.is_empty() || scopes.len() > 10_000 {
            return Err(MediaError::InvalidInput);
        }
        for (index, scope) in scopes.iter().enumerate() {
            budget.check()?;
            scope.validate()?;
            if scopes[..index].contains(scope) {
                return Err(MediaError::InvalidInput);
            }
        }
        let mut generation = Self {
            destination: destination.clone(),
            origin: origin.clone(),
            scopes: scopes.to_vec(),
            members: BTreeMap::new(),
            catalog: Vec::new(),
            total: 0,
            producer_lineage: None,
        };
        for member in members {
            budget.check()?;
            generation.insert(member.name, member.bytes)?;
        }
        let reader = NativeMediaArchiveReadOwner::new(generation);
        for (name, bytes) in &reader.generation.members {
            budget.check()?;
            MediaPolicyArchivePacket::decode(bytes, destination, name, &reader, budget)
                .map_err(|_| MediaError::InvalidInput)?;
        }
        budget.check()
    }
    fn insert(&mut self, name: String, bytes: Vec<u8>) -> MediaResult<()> {
        if self.members.len() >= MAX_MEDIA_POLICY_ARCHIVE_MEMBERS
            || self.members.contains_key(&name)
            || bytes.is_empty()
            || bytes.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBER_BYTES
            || !valid_media_policy_archive_member(&name)
            || bytes.len() > MAX_MEDIA_POLICY_ARCHIVE_TOTAL_BYTES.saturating_sub(self.total)
        {
            return Err(MediaError::TooLarge);
        }
        let entry = MediaPolicyArchiveCatalogEntry::new(&name, sha256(&bytes), bytes.len() as u64)?;
        let position = self
            .catalog
            .binary_search_by(|existing| existing.name().cmp(&name))
            .unwrap_or_else(|position| position);
        self.catalog.insert(position, entry);
        self.total += bytes.len();
        self.members.insert(name, bytes);
        Ok(())
    }
    pub fn origin(&self) -> &MediaPolicyArchiveOrigin {
        &self.origin
    }
    pub fn member_count(&self) -> usize {
        self.members.len()
    }
}

/// Concrete immutable full-catalog/exact-member verifier. It owns the admitted
/// independent reference; there is no caller-supplied authorization callback.
pub struct NativeMediaArchiveReadOwner {
    generation: NativeMediaArchiveGeneration,
}
impl NativeMediaArchiveReadOwner {
    pub fn new(generation: NativeMediaArchiveGeneration) -> Self {
        Self { generation }
    }
    pub fn read<'a>(
        &'a self,
        archive: Arc<PrivateStockArchive>,
        budget: &WorkBudget,
    ) -> s::Result<AuthenticatedMediaPolicyArchive<'a, Self>> {
        if archive.destination() != &self.generation.destination {
            return Err(unavailable());
        }
        // The actual bridge owns bounded descriptor scan/stability/custody. Its
        // returned proof borrows this SAME verifier rather than a temporary one.
        read_media_policy_archive(&archive, &self.generation.origin, self, budget)
    }
}
impl MediaPolicyArchiveReadAuthorization for NativeMediaArchiveReadOwner {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        member: &str,
        bytes: &[u8],
        cut: &RestoredMediaPolicyArchiveCut,
    ) -> s::Result<()> {
        if destination != &self.generation.destination
            || cut.origin() != &self.generation.origin
            || !self.generation.scopes.contains(cut.scope())
            || cut.member_name() != member
            || self
                .generation
                .members
                .get(member)
                .is_none_or(|expected| expected.as_slice() != bytes)
        {
            return Err(unavailable());
        }
        Ok(())
    }
    fn authorize_catalog(
        &self,
        destination: &ArchiveDestination,
        origin: &MediaPolicyArchiveOrigin,
        members: &[MediaPolicyArchiveCatalogEntry],
    ) -> s::Result<()> {
        if destination != &self.generation.destination
            || origin != &self.generation.origin
            || members != self.generation.catalog
        {
            return Err(unavailable());
        }
        Ok(())
    }
}
fn unavailable() -> s::Error {
    s::Error::new(
        "owner-unavailable",
        "Independent native Media archive generation is unavailable",
    )
}

// A temporary publication policy is private and tied to the exact opaque
// native Store completion, original guard, proof, packet and configured owner.
struct ReviewWritePermit<'a, 'g> {
    binding: &'a NativeMediaArchiveBinding,
    completion: &'a s::AssetReviewQualifiedCompletion,
    proof: &'a VerifiedAssetReview,
    packet: &'a MediaPolicyArchivePacket,
    guard: &'a a::TransactionAuthorization<'g>,
    budget: &'a WorkBudget,
}
impl MediaPolicyArchiveWriteAuthorization for ReviewWritePermit<'_, '_> {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        packet: &MediaPolicyArchivePacket,
    ) -> MediaResult<()> {
        self.budget.check()?;
        let original = self.completion.original_principal();
        if !self.binding.store.matches_completion(self.completion)
            || !std::ptr::eq(packet, self.packet)
            || destination != self.binding.destination()
            || packet.cut().origin() != &self.binding.origin
            || !self.binding.scopes.contains(packet.cut().scope())
            || !std::ptr::eq(original.principal(), self.guard.principal())
            || !std::ptr::eq(
                original.principal(),
                self.proof.original_principal().principal(),
            )
            || !std::ptr::eq(
                original.principal(),
                packet.original_principal().principal(),
            )
            || packet.cut().commit() != self.completion.commit()
        {
            return Err(MediaError::Forbidden);
        }
        self.guard
            .authorize(&access_scope(packet.cut().scope())?, a::Capability::Mutate)
            .map_err(access_error)?;
        self.proof.revalidate_release(
            self.guard,
            original,
            packet.cut().record(),
            self.proof.request(),
            self.budget,
        )
    }
}

struct UploadWritePermit<'a, 'g> {
    binding: &'a NativeMediaArchiveBinding,
    completion: &'a s::AssetUploadQualifiedCompletion,
    stage: &'a StagedAssetPlan,
    packet: &'a MediaPolicyArchivePacket,
    guard: &'a a::TransactionAuthorization<'g>,
    budget: &'a WorkBudget,
}
impl MediaPolicyArchiveWriteAuthorization for UploadWritePermit<'_, '_> {
    fn authorize_archive(
        &self,
        destination: &ArchiveDestination,
        packet: &MediaPolicyArchivePacket,
    ) -> MediaResult<()> {
        self.budget.check()?;
        let original = self.completion.original_principal();
        if !self
            .binding
            .store
            .matches_upload_completion(self.completion)
            || !std::ptr::eq(packet, self.packet)
            || destination != self.binding.destination()
            || packet.cut().origin() != &self.binding.origin
            || !self.binding.scopes.contains(packet.cut().scope())
            || !std::ptr::eq(original.principal(), self.guard.principal())
            || !original.same_original(self.stage.original_principal())
            || !original.same_original(packet.original_principal())
            || packet.cut().commit() != self.completion.commit()
            || !packet
                .cut()
                .matches_consumed_upload(self.completion.consumed_upload())
        {
            return Err(MediaError::Forbidden);
        }
        self.guard
            .authorize(&access_scope(packet.cut().scope())?, a::Capability::Mutate)
            .map_err(access_error)?;
        // The real stage's opaque renderer qualification and exact native
        // commit association remain mandatory even at the write-policy call.
        let mut live = super::recovery_policy::MediaPolicyEvidence::default();
        live.retain_upload(self.stage, self.completion.commit())
    }
}

/// Native renderer producer owner. It publishes only opaque SAME-Store qualified
/// completions and records expected bytes/catalog only after actual sync. Host
/// serializes it under Core -> Store -> Access -> owner -> native custody,
/// with no Store or Access reentry from the publisher.
/// Upload publication additionally retains the genuine native stage. It has no
/// data-only completion entrypoint or historical grant adoption.
pub struct NativeMediaArchiveOwner {
    binding: NativeMediaArchiveBinding,
    generation: NativeMediaArchiveGeneration,
    published_reference: Option<PublishedNativeMediaReference>,
}
impl NativeMediaArchiveOwner {
    /// Empty newly selected process issuer, not automatic cold-start admission.
    /// Before any publication, strict descriptor read must match the empty
    /// independent generation. Existing files cannot be adopted by this method.
    pub fn fresh(binding: NativeMediaArchiveBinding) -> Self {
        let mut generation = NativeMediaArchiveGeneration::empty(&binding);
        generation.producer_lineage = Some(binding.store.clone());
        Self {
            generation,
            binding,
            published_reference: None,
        }
    }
    /// Resume from a separately admitted complete native reference generation;
    /// do not reconstruct it from the candidate archive or recovered SQL image.
    pub fn configured(
        binding: NativeMediaArchiveBinding,
        generation: NativeMediaArchiveGeneration,
    ) -> MediaResult<Self> {
        if generation.destination != *binding.destination()
            || generation.origin != binding.origin
            || generation.scopes != binding.scopes
        {
            return Err(MediaError::Forbidden);
        }
        Ok(Self {
            binding,
            generation,
            published_reference: None,
        })
    }
    /// One-time extraction after genuine publication and complete postcatalog
    /// qualification. Mechanically configured historical DATA cannot mint it.
    pub fn take_published_reference(&mut self) -> Option<PublishedNativeMediaReference> {
        self.published_reference.take()
    }
    pub fn generation(&self) -> NativeMediaArchiveGeneration {
        self.generation.clone()
    }
    pub fn binding(&self) -> &NativeMediaArchiveBinding {
        &self.binding
    }
    pub fn publish_review(
        &mut self,
        completion: s::AssetReviewQualifiedCompletion,
        proof: &VerifiedAssetReview,
        guard: &a::TransactionAuthorization<'_>,
        budget: &WorkBudget,
    ) -> MediaResult<ArchiveReceipt> {
        budget.check()?;
        if !self.binding.store.matches_completion(&completion)
            || self
                .generation
                .producer_lineage
                .as_ref()
                .is_some_and(|original_store| !original_store.matches_completion(&completion))
            || !std::ptr::eq(
                completion.original_principal().principal(),
                guard.principal(),
            )
            || !std::ptr::eq(
                completion.original_principal().principal(),
                proof.original_principal().principal(),
            )
        {
            return Err(MediaError::Forbidden);
        }
        let commit = completion.commit();
        let committed = commit
            .groups
            .iter()
            .flat_map(|group| &group.native_results)
            .find(|result| {
                result.record.record_type == s::RecordType::Asset
                    && result.record.record_id == proof.original_record().record_id
            })
            .ok_or(MediaError::Conflict)?;
        let packet = MediaPolicyArchivePacket::encode_review(
            proof,
            guard,
            completion.original_principal(),
            &committed.record,
            commit,
            &self.binding.origin,
            self.binding.archive.max_frame_bytes(),
            budget,
        )?;
        let permit = ReviewWritePermit {
            binding: &self.binding,
            completion: &completion,
            proof,
            packet: &packet,
            guard,
            budget,
        };
        let next = Self::publish_packet(&self.binding, &self.generation, &packet, permit, budget)?;
        self.generation = next.0;
        self.published_reference = self.generation.producer_lineage.is_some().then(|| {
            PublishedNativeMediaReference::published(
                self.generation.clone(),
                packet.cut().audit_id(),
            )
        });
        Ok(next.1)
    }
    /// Capture only after the actual Store qualified its fresh non-replayed
    /// completion, strict consumed binding and current original bytes. The host
    /// retains that SAME Store/Access fence and genuine stage until publication
    /// returns; no Store or Access reentry occurs here. A download-only stage
    /// cannot supply the required real SafeRendered renderer qualification.
    /// Any failure after SQL/archive publication never implies rollback/retry.
    pub fn publish_upload(
        &mut self,
        completion: s::AssetUploadQualifiedCompletion,
        stage: &StagedAssetPlan,
        guard: &a::TransactionAuthorization<'_>,
        budget: &WorkBudget,
    ) -> MediaResult<ArchiveReceipt> {
        budget.check()?;
        if !self.binding.store.matches_upload_completion(&completion)
            || self
                .generation
                .producer_lineage
                .as_ref()
                .is_some_and(|original_store| {
                    !original_store.matches_upload_completion(&completion)
                })
            || !std::ptr::eq(
                completion.original_principal().principal(),
                guard.principal(),
            )
            || !completion
                .original_principal()
                .same_original(stage.original_principal())
        {
            return Err(MediaError::Forbidden);
        }
        let packet = MediaPolicyArchivePacket::encode_upload(
            stage,
            completion.commit(),
            guard,
            &self.binding.origin,
            self.binding.archive.max_frame_bytes(),
            budget,
        )?;
        if !packet
            .cut()
            .matches_consumed_upload(completion.consumed_upload())
        {
            return Err(MediaError::Conflict);
        }
        let permit = UploadWritePermit {
            binding: &self.binding,
            completion: &completion,
            stage,
            packet: &packet,
            guard,
            budget,
        };
        let next = Self::publish_packet(&self.binding, &self.generation, &packet, permit, budget)?;
        self.generation = next.0;
        self.published_reference = self.generation.producer_lineage.is_some().then(|| {
            PublishedNativeMediaReference::published(
                self.generation.clone(),
                packet.cut().audit_id(),
            )
        });
        Ok(next.1)
    }
    fn publish_packet<W: MediaPolicyArchiveWriteAuthorization>(
        binding: &NativeMediaArchiveBinding,
        generation: &NativeMediaArchiveGeneration,
        packet: &MediaPolicyArchivePacket,
        permit: W,
        budget: &WorkBudget,
    ) -> MediaResult<(NativeMediaArchiveGeneration, ArchiveReceipt)> {
        let mut next = generation.clone();
        // Bound the complete resulting generation BEFORE durable publication.
        next.insert(packet.member_name().into(), packet.bytes().to_vec())?;
        let reader = NativeMediaArchiveReadOwner::new(generation.clone());
        let native = NativeMediaPolicyArchive::new(
            binding.archive.clone(),
            binding.origin.clone(),
            permit,
            reader,
        );
        // Authenticate the entire current catalog before writing; no adoption of
        // plausible existing members and no default-success empty-directory rule.
        native.read(budget).map_err(|_| MediaError::Unavailable)?;
        let receipt = native.append(packet, budget)?;
        if receipt.name() != packet.member_name() || receipt.sha256() != sha256(packet.bytes()) {
            return Err(MediaError::Unavailable);
        }
        // Reauthenticate the complete actual post-publication catalog before
        // emitting its immutable native generation. Failure can follow durable
        // publication and never implies rollback or a retry permission.
        let next_reader = NativeMediaArchiveReadOwner::new(next.clone());
        next_reader
            .read(binding.archive.clone(), budget)
            .map_err(|_| MediaError::Unavailable)?;
        Ok((next, receipt))
    }
}
