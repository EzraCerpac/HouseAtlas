use super::{
    AccessError, AccessResult, PartitionGrant, SourceRegistration, TransactionAuthorization, store,
};

/// Owned metadata from the persisted source registration and access epoch.
/// Metadata equality does not authorize an operation or establish Store binding.
/// Callers must freshly check authority at each phase and final owned Store
/// boundary; validation of the same NativeStore remains caller-owned.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceAuthorityMetadata {
    access_epoch: String,
    source_registration_version: u64,
    source_registration_sha256: String,
    registration: SourceRegistration,
}

impl SourceAuthorityMetadata {
    pub fn access_epoch(&self) -> &str {
        &self.access_epoch
    }

    pub fn source_registration_version(&self) -> u64 {
        self.source_registration_version
    }

    pub fn source_registration_sha256(&self) -> &str {
        &self.source_registration_sha256
    }

    pub fn registration(&self) -> &SourceRegistration {
        &self.registration
    }
}

impl TransactionAuthorization<'_> {
    /// Revalidate the retained partition against this guard's original principal
    /// and read its persisted full registration, version and opaque access epoch.
    /// The digest uses the established canonical contract, not caller metadata.
    /// The owned result supplies no authority, presence admission or Store binding;
    /// callers must freshly check each phase and final owned Store boundary.
    pub fn persisted_source_metadata(
        &self,
        original: &PartitionGrant,
    ) -> AccessResult<SourceAuthorityMetadata> {
        self.revalidate_source_partition(original)?;
        let row = self
            .authority
            .checked_partition(self.principal(), original.partition())?;
        let access_epoch = store::epoch(self.authority.db)?;
        let source_registration_version =
            u64::try_from(row.version.0).map_err(|_| AccessError::Unavailable)?;
        if !(1..=9_007_199_254_740_991).contains(&source_registration_version) {
            return Err(AccessError::Unavailable);
        }
        let registration_value =
            serde_json::to_value(&row.registration).map_err(|_| AccessError::Unavailable)?;
        let source_registration_sha256 =
            crate::contracts::semantics::canonical_digest(&registration_value)
                .map_err(|_| AccessError::Unavailable)?;
        Ok(SourceAuthorityMetadata {
            access_epoch: access_epoch.0,
            source_registration_version,
            source_registration_sha256,
            registration: row.registration,
        })
    }
}
