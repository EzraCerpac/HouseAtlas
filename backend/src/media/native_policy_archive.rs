//! Concrete native review publication and strict independent catalog policy.
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
        }
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

/// Native review producer owner. It publishes only opaque SAME-Store qualified
/// completions and records expected bytes/catalog only after actual sync. Host
/// serializes it under its existing Access -> owner -> Store/custody lock order.
/// It has no upload/data-only completion entrypoint or historical grant adoption.
pub struct NativeMediaArchiveOwner {
    binding: NativeMediaArchiveBinding,
    generation: NativeMediaArchiveGeneration,
}
impl NativeMediaArchiveOwner {
    /// Empty newly selected process issuer, not automatic cold-start admission.
    /// Before any publication, strict descriptor read must match the empty
    /// independent generation. Existing files cannot be adopted by this method.
    pub fn fresh(binding: NativeMediaArchiveBinding) -> Self {
        Self {
            generation: NativeMediaArchiveGeneration::empty(&binding),
            binding,
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
        })
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
        let mut next = self.generation.clone();
        // Bound the complete resulting generation BEFORE durable publication.
        next.insert(packet.member_name().into(), packet.bytes().to_vec())?;
        let reader = NativeMediaArchiveReadOwner::new(self.generation.clone());
        let permit = ReviewWritePermit {
            binding: &self.binding,
            completion: &completion,
            proof,
            packet: &packet,
            guard,
            budget,
        };
        let native = NativeMediaPolicyArchive::new(
            self.binding.archive.clone(),
            self.binding.origin.clone(),
            permit,
            reader,
        );
        // Authenticate the entire current catalog before writing; no adoption of
        // plausible existing members and no default-success empty-directory rule.
        native.read(budget).map_err(|_| MediaError::Unavailable)?;
        let receipt = native.append(&packet, budget)?;
        if receipt.name() != packet.member_name() || receipt.sha256() != sha256(packet.bytes()) {
            return Err(MediaError::Unavailable);
        }
        // Reauthenticate the complete actual post-publication catalog before
        // emitting its immutable native generation. Failure can follow durable
        // publication and never implies rollback or a retry permission.
        let next_reader = NativeMediaArchiveReadOwner::new(next.clone());
        next_reader
            .read(self.binding.archive.clone(), budget)
            .map_err(|_| MediaError::Unavailable)?;
        self.generation = next;
        Ok(receipt)
    }
}
