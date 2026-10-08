//! Same-invocation Access commit and Storage release, retaining raw Source bytes.
//! A generic or synthetic reader can issue the raw native capture: its identity
//! does not attest configured Source origin. A real configured Source proof must
//! later join the exact same original native allocation. These receipts supply
//! no presence candidate/witness association, admission or current caller authority.
//! Failed Access commits cannot issue an Access and Store boundary receipt.

use std::{collections::BTreeSet, ptr, sync::Arc};

use crate::access::{
    AccessBoundary, AccessError, AccessResult, NATIVE_ACCESS_PACKAGE_VERSION, PartitionGrant,
    PartitionMode, Principal, SourceAuthorityMetadata, SourceGrant, SourceKind, SourceOwner,
    SourcePartition, SourceRef, TransactionAuthorization,
};
use crate::providers::homebox::read::{self, NativePresenceCapture, NativePresenceIdentity};
use crate::storage::{
    self, AtlasStore, Authorization, CachePresenceCommittedData, CachePresenceCommittedObservation,
    CachePresenceStorageReleasedCut, Contract, Runtime,
};

/// Original allocations and complete metadata qualified under an Access guard.
/// The retained raw native identity is a pending Source limb; it can come from a
/// generic or synthetic reader and does not attest configured Source origin.
/// No Clone, constructor from DATA, or release conversion is exposed.
pub struct QualifiedPresenceAccessCut<'original> {
    original_principal: &'original Principal,
    original_source: &'original SourceGrant,
    original_partition: &'original PartitionGrant,
    captured_source_metadata: SourceAuthorityMetadata,
    native_identity: NativePresenceIdentity,
    invocation: Arc<()>,
}

pub fn qualify_original_source<'original>(
    guard: &TransactionAuthorization<'_>,
    original_principal: &'original Principal,
    original_source: &'original SourceGrant,
    original_partition: &'original PartitionGrant,
    native_identity: NativePresenceIdentity,
) -> AccessResult<QualifiedPresenceAccessCut<'original>> {
    check_originals(
        guard,
        original_principal,
        original_source,
        original_partition,
    )?;
    let captured_source_metadata = guard.persisted_source_metadata(original_partition)?;
    if captured_source_metadata.registration().owner != SourceOwner::Homebox {
        return Err(AccessError::NotFound);
    }
    Ok(QualifiedPresenceAccessCut {
        original_principal,
        original_source,
        original_partition,
        captured_source_metadata,
        native_identity,
        invocation: Arc::new(()),
    })
}

fn check_originals(
    guard: &TransactionAuthorization<'_>,
    principal: &Principal,
    source: &SourceGrant,
    partition: &PartitionGrant,
) -> AccessResult<()> {
    if !ptr::eq(principal, guard.principal()) {
        return Err(AccessError::Forbidden);
    }
    guard.assert_mutation()?;
    if source.reference().partition() != *partition.partition()
        || source.reference().key.source_kind != SourceKind::HomeboxEntity
    {
        return Err(AccessError::NotFound);
    }
    guard.revalidate_source(source)?;
    guard.revalidate_source_partition(partition)?;
    Ok(())
}

impl QualifiedPresenceAccessCut<'_> {
    pub fn original_source_ref(&self) -> &SourceRef {
        self.original_source.reference()
    }
    pub fn original_partition(&self) -> &SourcePartition {
        self.original_partition.partition()
    }
    pub fn captured_source_metadata(&self) -> &SourceAuthorityMetadata {
        &self.captured_source_metadata
    }
    pub fn native_access_package_version(&self) -> &'static str {
        NATIVE_ACCESS_PACKAGE_VERSION
    }
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
    pub fn matches_native_capture<P>(&self, capture: &NativePresenceCapture<'_, P>) -> bool {
        self.native_identity.matches_capture(capture)
    }
    fn revalidate(&self, guard: &TransactionAuthorization<'_>) -> AccessResult<()> {
        check_originals(
            guard,
            self.original_principal,
            self.original_source,
            self.original_partition,
        )?;
        if guard.persisted_source_metadata(self.original_partition)?
            != self.captured_source_metadata
        {
            return Err(AccessError::NotFound);
        }
        Ok(())
    }
}

/// Consumed only by the actual Store publication method under this held guard.
pub struct PresencePublication<'guard, 'transaction, 'original, P> {
    guard: &'guard TransactionAuthorization<'transaction>,
    original_reader: &'original P,
    qualified: QualifiedPresenceAccessCut<'original>,
    capture: NativePresenceCapture<'original, P>,
}

/// Genuine Store release awaiting this invocation's outer Access SQL commit.
pub struct PresenceStorageReleasedCut<'original, P> {
    original_reader: &'original P,
    qualified: QualifiedPresenceAccessCut<'original>,
    storage: CachePresenceStorageReleasedCut<'original, P>,
}

/// Immutable Access and Store boundary receipt retaining a raw native capture.
/// Configured Source origin proof must separately match this exact native
/// allocation before any historical Source authority or witness association.
/// This receipt supplies neither current caller authority nor presence admission.
pub struct PresenceAccessReleasedCut<'original, P> {
    released: PresenceStorageReleasedCut<'original, P>,
}

impl<'guard, 'transaction, 'original, P> PresencePublication<'guard, 'transaction, 'original, P> {
    pub fn guard(&self) -> &'guard TransactionAuthorization<'transaction> {
        self.guard
    }
    pub fn native_capture(&self) -> &NativePresenceCapture<'original, P> {
        &self.capture
    }
    pub fn qualified_access(&self) -> &QualifiedPresenceAccessCut<'original> {
        &self.qualified
    }
    pub fn publish<C: Contract, A: Authorization, R: Runtime, B: Authorization<Principal = P>>(
        self,
        actual_store: &mut AtlasStore<C, A, R>,
        actual_authorization: &B,
        observation: &CachePresenceCommittedObservation,
    ) -> storage::Result<PresenceStorageReleasedCut<'original, P>> {
        self.qualified
            .revalidate(self.guard)
            .map_err(storage_error)?;
        if !ptr::eq(self.original_reader, self.capture.principal())
            || !self.qualified.matches_native_capture(&self.capture)
            || !matches_registration(
                self.qualified.captured_source_metadata(),
                self.capture.fence().registration(),
            )
            || !matches_native_registration(&self.capture)
        {
            return Err(storage_error(AccessError::NotFound));
        }
        let storage = actual_store.publish_native_presence_with_authorization(
            actual_authorization,
            self.capture,
            observation,
        )?;
        if !actual_store.matches_presence_publication(&storage)
            || !self
                .qualified
                .matches_native_capture(storage.native_capture())
            || !ptr::eq(self.original_reader, storage.native_capture().principal())
            || !matches_registration(
                self.qualified.captured_source_metadata(),
                storage.committed().registration(),
            )
        {
            return Err(storage_error(AccessError::NotFound));
        }
        self.qualified
            .revalidate(self.guard)
            .map_err(storage_error)?;
        Ok(PresenceStorageReleasedCut {
            original_reader: self.original_reader,
            qualified: self.qualified,
            storage,
        })
    }
}

/// The operation can return only the opaque packet produced by consuming the
/// publication conduit. A private invocation identity rejects older packets.
/// Successful return attests only Access and Store release. The retained raw
/// capture may be generic/synthetic and supplies no configured Source proof.
/// Store may already have committed when Access fails; the pending packet is
/// then dropped without returning a cut or providing retry/recovery issuance.
pub fn with_presence_storage_release<'original, P, E: From<AccessError>>(
    access: &mut AccessBoundary,
    original_reader: &'original P,
    original_source: &'original SourceGrant,
    original_partition: &'original PartitionGrant,
    capture: NativePresenceCapture<'original, P>,
    native_principal: for<'p> fn(&'p P) -> &'p Principal,
    operation: impl FnOnce(
        &TransactionAuthorization<'_>,
        PresencePublication<'_, '_, 'original, P>,
    ) -> Result<PresenceStorageReleasedCut<'original, P>, E>,
) -> Result<PresenceAccessReleasedCut<'original, P>, E> {
    let original_principal = native_principal(original_reader);
    let mut pending = None;
    let mut expected_invocation = None;
    access.with_mutation_authorization(original_principal, |guard| {
        if !ptr::eq(original_reader, capture.principal())
            || !ptr::eq(native_principal(capture.principal()), guard.principal())
        {
            return Err(E::from(AccessError::Forbidden));
        }
        let qualified = qualify_original_source(
            guard,
            original_principal,
            original_source,
            original_partition,
            capture.retain_native_identity(),
        )
        .map_err(E::from)?;
        let expected = Arc::clone(&qualified.invocation);
        let released = operation(
            guard,
            PresencePublication {
                guard,
                original_reader,
                qualified,
                capture,
            },
        )?;
        if !ptr::eq(
            native_principal(released.storage.native_capture().principal()),
            guard.principal(),
        ) || !released.matches_invocation(
            &expected,
            original_reader,
            original_principal,
            original_source,
            original_partition,
        ) {
            return Err(E::from(AccessError::Forbidden));
        }
        released.qualified.revalidate(guard).map_err(E::from)?;
        expected_invocation = Some(expected);
        pending = Some(released);
        Ok(())
    })?;
    issue_after_access_commit(
        pending.ok_or_else(|| E::from(AccessError::Unavailable))?,
        &expected_invocation.ok_or_else(|| E::from(AccessError::Unavailable))?,
    )
    .map_err(E::from)
}

impl<P> PresenceStorageReleasedCut<'_, P> {
    fn matches_invocation(
        &self,
        expected: &Arc<()>,
        reader: &P,
        principal: &Principal,
        source: &SourceGrant,
        partition: &PartitionGrant,
    ) -> bool {
        Arc::ptr_eq(expected, &self.qualified.invocation)
            && ptr::eq(reader, self.original_reader)
            && ptr::eq(reader, self.storage.native_capture().principal())
            && self
                .qualified
                .compares_exact_original_allocation(principal, source, partition)
            && self
                .qualified
                .matches_native_capture(self.storage.native_capture())
            && matches_registration(
                self.qualified.captured_source_metadata(),
                self.storage.committed().registration(),
            )
    }
}

/// Private issuer of the bounded Access and Store receipt after Access commits.
fn issue_after_access_commit<'original, P>(
    released: PresenceStorageReleasedCut<'original, P>,
    expected: &Arc<()>,
) -> AccessResult<PresenceAccessReleasedCut<'original, P>> {
    if !Arc::ptr_eq(expected, &released.qualified.invocation) {
        return Err(AccessError::Forbidden);
    }
    Ok(PresenceAccessReleasedCut { released })
}

impl<P> PresenceAccessReleasedCut<'_, P> {
    pub(crate) fn native_capture(&self) -> &NativePresenceCapture<'_, P> {
        self.released.storage.native_capture()
    }
    /// Pointer correlation only; this neither exports grants nor checks authority.
    pub fn compares_exact_original_allocation(
        &self,
        principal: &Principal,
        source: &SourceGrant,
        partition: &PartitionGrant,
    ) -> bool {
        self.released
            .qualified
            .compares_exact_original_allocation(principal, source, partition)
    }
    pub fn native_access_package_version(&self) -> &'static str {
        NATIVE_ACCESS_PACKAGE_VERSION
    }
    pub fn captured_source_metadata(&self) -> &SourceAuthorityMetadata {
        self.released.qualified.captured_source_metadata()
    }
    pub fn native_generation(&self) -> &read::NativePresenceGeneration {
        self.native_capture().native()
    }
    pub fn original_source_ref(&self) -> &SourceRef {
        self.released.qualified.original_source_ref()
    }
    pub fn original_partition(&self) -> &SourcePartition {
        self.released.qualified.original_partition()
    }
    pub fn committed(&self) -> &CachePresenceCommittedData {
        self.released.storage.committed()
    }
}

fn storage_error(error: AccessError) -> storage::Error {
    storage::Error::new(
        error.code(),
        "Original native presence publication unavailable",
    )
}

fn matches_registration(
    metadata: &SourceAuthorityMetadata,
    durable: &storage::SourceRegistration,
) -> bool {
    let access = metadata.registration();
    access.workspace_id.as_str() == durable.workspace_id
        && access.home_id.as_str() == durable.home_id
        && access.source_instance_id.as_str() == durable.source_instance_id
        && access.collection_id == durable.collection_id
        && access.owner == SourceOwner::Homebox
        && durable.owner == storage::SourceOwner::Homebox
        && matches!(
            (access.partition_mode, durable.partition_mode),
            (
                PartitionMode::ExclusiveHome,
                storage::PartitionMode::ExclusiveHome
            ) | (
                PartitionMode::ReviewedEntityAllowlist,
                storage::PartitionMode::ReviewedEntityAllowlist
            )
        )
        && access.allowed_external_ids == durable.allowed_external_ids
}

fn matches_native_registration<P>(capture: &NativePresenceCapture<'_, P>) -> bool {
    let native = capture.native();
    let source = native.registration();
    let durable = capture.fence().registration();
    source.workspace_id.as_str() == durable.workspace_id
        && source.home_id.as_str() == durable.home_id
        && source.source_instance_id.as_str() == durable.source_instance_id
        && source.collection_id == durable.collection_id
        && source.owner == "homebox"
        && durable.owner == storage::SourceOwner::Homebox
        && matches!(
            (source.partition_mode, durable.partition_mode),
            (
                read::PartitionMode::ExclusiveHome,
                storage::PartitionMode::ExclusiveHome
            ) | (
                read::PartitionMode::ReviewedEntityAllowlist,
                storage::PartitionMode::ReviewedEntityAllowlist
            )
        )
        && source
            .allowed_external_ids
            .iter()
            .map(|id| id.as_str())
            .collect::<BTreeSet<_>>()
            == durable
                .allowed_external_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
        && source.scope() == *native.scope()
        && native.scope() == &capture.generation().cache().scope()
}
