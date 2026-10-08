//! Pending Access prerequisite for an eventual historical presence issuer.
//!
//! This captures only the Access limb under a held transaction guard. It does
//! not attest native source qualification, a raw complete generation or native
//! epoch, Store commit, Access release, presence admission or offline authority.
//! An eventual private issuer still requires a real opaque committed source
//! proof and successful Access release from the same invocation. A boolean,
//! `Result`, cache status or generic substitute cannot supply those peers.

use std::ptr;

use crate::access::{
    AccessError, AccessResult, NATIVE_ACCESS_PACKAGE_VERSION, PartitionGrant, Principal,
    SourceAuthorityMetadata, SourceGrant, SourcePartition, SourceRef, TransactionAuthorization,
};

/// Original borrowed allocations and the complete metadata read under the guard.
///
/// Private fields and absence of Clone/serde prevent construction from DATA or
/// duplication of this cut. The cut may outlive a rolled-back Access transaction;
/// it carries no accepted historical authority and has no conversion to one.
/// Metadata fields and the native Access version declaration remain DATA.
/// Subsequent correlation neither refreshes nor revalidates the originals.
/// The inputs alone do not establish their origin in a Source capture closure;
/// the eventual actual Source peer must bind these allocations to that same
/// original owner and capture closure, including its committed proof.
pub struct QualifiedPresenceAccessCut<'original> {
    original_principal: &'original Principal,
    original_source: &'original SourceGrant,
    original_partition: &'original PartitionGrant,
    captured_source_metadata: SourceAuthorityMetadata,
}

/// Check the exact original principal and retained grants through the held guard.
///
/// The guard is used only during this call and is not retained. Successful return
/// records this Access qualification cut, not native SourcePhase qualification
/// or proof that either Store committed or Access released successfully.
pub fn qualify_original_source<'original>(
    guard: &TransactionAuthorization<'_>,
    original_principal: &'original Principal,
    original_source: &'original SourceGrant,
    original_partition: &'original PartitionGrant,
) -> AccessResult<QualifiedPresenceAccessCut<'original>> {
    if !ptr::eq(original_principal, guard.principal()) {
        return Err(AccessError::Forbidden);
    }
    guard.assert_mutation()?;
    if original_source.reference().partition() != *original_partition.partition() {
        return Err(AccessError::NotFound);
    }
    guard.revalidate_source(original_source)?;
    guard.revalidate_source_partition(original_partition)?;
    let captured_source_metadata = guard.persisted_source_metadata(original_partition)?;

    Ok(QualifiedPresenceAccessCut {
        original_principal,
        original_source,
        original_partition,
        captured_source_metadata,
    })
}

impl QualifiedPresenceAccessCut<'_> {
    /// Original source identity DATA, without exposing or reissuing its grant.
    pub fn original_source_ref(&self) -> &SourceRef {
        self.original_source.reference()
    }

    /// Original partition identity DATA, without exposing its grant.
    pub fn original_partition(&self) -> &SourcePartition {
        self.original_partition.partition()
    }

    /// Complete owned metadata captured at qualification, never a fresh check.
    pub fn captured_source_metadata(&self) -> &SourceAuthorityMetadata {
        &self.captured_source_metadata
    }

    /// Native Access producer declaration; compatibility still needs acceptance.
    pub fn native_access_package_version(&self) -> &'static str {
        NATIVE_ACCESS_PACKAGE_VERSION
    }

    /// Correlate all three exact original allocations without checking authority.
    ///
    /// Distinct cloned grants or principals are never interchangeable for this
    /// correlation. This only matches the inputs chosen at qualification; it
    /// does not establish their origin in a Source capture closure, native source
    /// proof or release evidence.
    pub fn compares_exact_original_allocation(
        &self,
        principal: &Principal,
        source: &SourceGrant,
        partition: &PartitionGrant,
    ) -> bool {
        ptr::eq(self.original_principal, principal)
            && ptr::eq(self.original_source, source)
            && ptr::eq(self.original_partition, partition)
    }
}
