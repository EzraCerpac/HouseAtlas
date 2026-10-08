//! Native private-directory custody with mandatory independent Media policies.
//! Origin configuration and filesystem identity are matching data, not authority.
use super::archive::{ArchiveReceipt, PrivateStockArchive};
use crate::{
    media::{
        MediaError, MediaResult, WorkBudget,
        recovery_policy_archive::{
            AuthenticatedMediaPolicyArchive, MediaPolicyArchiveOrigin, MediaPolicyArchivePacket,
            MediaPolicyArchiveReadAuthorization, MediaPolicyArchiveWriteAuthorization,
        },
    },
    storage,
};
use std::sync::Arc;

/// Opened native custody and actual owner-selected origin. Construction neither
/// authenticates a recovered image nor creates a production origin policy.
/// Read/write owners must independently qualify the original native origin,
/// generation, producer provenance and complete catalog, without SQL reentry.
/// Select a dedicated Media-only preprovisioned directory. The complete reader
/// rejects HomeBox producer files and all other unknown or pending members;
/// sharing its descriptor with another format cannot establish a valid catalog.
pub struct NativeMediaPolicyArchive<W, R> {
    archive: Arc<PrivateStockArchive>,
    origin: MediaPolicyArchiveOrigin,
    write_owner: W,
    read_owner: R,
}
impl<W: MediaPolicyArchiveWriteAuthorization, R: MediaPolicyArchiveReadAuthorization>
    NativeMediaPolicyArchive<W, R>
{
    pub fn new(
        archive: Arc<PrivateStockArchive>,
        origin: MediaPolicyArchiveOrigin,
        write_owner: W,
        read_owner: R,
    ) -> Self {
        Self {
            archive,
            origin,
            write_owner,
            read_owner,
        }
    }
    /// A success receipt follows actual immutable file and directory sync.
    /// Publication failure after a native SQL commit does not undo that commit.
    pub fn append(
        &self,
        packet: &MediaPolicyArchivePacket,
        budget: &WorkBudget,
    ) -> MediaResult<ArchiveReceipt> {
        budget.check()?;
        if packet.cut().origin() != &self.origin {
            return Err(MediaError::Unavailable);
        }
        self.archive.retain_media(packet, &self.write_owner, budget)
    }
    /// Entire authenticated catalog is collected before any Storage callback.
    /// No filesystem scan occurs inside the returned offline frame matcher.
    pub fn read(
        &self,
        budget: &WorkBudget,
    ) -> storage::Result<AuthenticatedMediaPolicyArchive<'_, R>> {
        read_media_policy_archive(&self.archive, &self.origin, &self.read_owner, budget)
    }
}

/// Read through the actual descriptor while borrowing the independent policy
/// owner for the complete offline evidence lifetime. No temporary wrapper can
/// outlive its authority owner, and no scan occurs inside the frame matcher.
pub fn read_media_policy_archive<'a, R: MediaPolicyArchiveReadAuthorization>(
    archive: &PrivateStockArchive,
    origin: &MediaPolicyArchiveOrigin,
    read_owner: &'a R,
    budget: &WorkBudget,
) -> storage::Result<AuthenticatedMediaPolicyArchive<'a, R>> {
    archive.with_media_catalog(budget, |members| {
        let mut evidence = Vec::with_capacity(members.len());
        for member in members {
            evidence.push(MediaPolicyArchivePacket::decode(
                &member.bytes,
                archive.destination(),
                &member.name,
                read_owner,
                budget,
            )?);
        }
        AuthenticatedMediaPolicyArchive::new(
            archive.destination(),
            origin,
            evidence,
            read_owner,
            budget,
        )
    })
}
