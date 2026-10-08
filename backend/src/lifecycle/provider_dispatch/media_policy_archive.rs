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
        self.archive.with_media_catalog(budget, |members| {
            let mut evidence = Vec::with_capacity(members.len());
            for member in members {
                let member = MediaPolicyArchivePacket::decode(
                    &member.bytes,
                    self.archive.destination(),
                    &member.name,
                    &self.read_owner,
                    budget,
                )?;
                evidence.push(member);
            }
            AuthenticatedMediaPolicyArchive::new(
                self.archive.destination(),
                &self.origin,
                evidence,
                &self.read_owner,
                budget,
            )
        })
    }
}
