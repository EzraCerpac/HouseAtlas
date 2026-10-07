use super::{
    AccessBoundary, AccessError, AccessResult, Capability, PartitionGrant, Principal, SourceGrant,
    TransactionAuthorization,
};

impl TransactionAuthorization<'_> {
    /// Recheck current read authority and retained source grants against this
    /// guard's original principal without issuing replacement authority.
    /// The caller already retains trusted original grants. The supplied member
    /// set proves neither configured completeness nor generation membership;
    /// provider/root owners remain responsible for Store/core checks.
    pub fn revalidate_source_read(
        &self,
        original_partition: &PartitionGrant,
        original_members: &[SourceGrant],
    ) -> AccessResult<()> {
        self.authorize(self.principal().scope(), Capability::Read)?;
        self.revalidate_source_partition(original_partition)?;
        for member in original_members {
            if member.reference().partition() != *original_partition.partition() {
                return Err(AccessError::NotFound);
            }
            self.revalidate_source(member)?;
        }
        Ok(())
    }
}

impl AccessBoundary {
    /// Hold the existing synchronous read fence while checking the caller's
    /// trusted original partition and member grants at entry and after work.
    /// The supplied member set proves neither configured completeness nor
    /// generation membership. Provider/root owners supply Store/core checks;
    /// this binding supplies no source publication authority.
    pub fn with_source_read_authorization<E: From<AccessError>>(
        &mut self,
        original: &Principal,
        partition: &PartitionGrant,
        members: &[SourceGrant],
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        self.with_read_authorization(original, |guard| {
            guard
                .revalidate_source_read(partition, members)
                .map_err(E::from)?;
            operation(guard)?;
            guard
                .revalidate_source_read(partition, members)
                .map_err(E::from)?;
            Ok(())
        })
    }
}
