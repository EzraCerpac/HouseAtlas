//! Configured native HomeBox presence preparation. The original Access guard
//! authorizes only the synchronous Store preparation; capture runs afterward.
//! No historical presence is issued by this preparation.
use super::Core;
use crate::{
    access as a,
    config::providers::homebox::TrustedHomeBoxSource,
    providers::homebox::read::{NativeReadCredentialConfig, native_presence_owner as owner},
    storage as s,
};
use std::{fmt, ptr, sync::Arc};

#[derive(Debug)]
pub enum PresencePreparationError {
    Access(a::AccessError),
    Owner(owner::NativePresenceOwnerError),
    Unavailable,
}
impl From<a::AccessError> for PresencePreparationError {
    fn from(value: a::AccessError) -> Self {
        Self::Access(value)
    }
}
impl From<owner::NativePresenceOwnerError> for PresencePreparationError {
    fn from(value: owner::NativePresenceOwnerError) -> Self {
        Self::Owner(value)
    }
}
impl fmt::Display for PresencePreparationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Configured native presence preparation unavailable")
    }
}
impl std::error::Error for PresencePreparationError {}

fn unavailable() -> s::Error {
    s::Error::new("unavailable", "Native presence publication unavailable")
}
fn access_error(_: a::AccessError) -> s::Error {
    unavailable()
}

/// The only Storage authority admitted in this phase. A Store callback uses
/// this already-held original Access guard and never locks Access again.
struct PresencePublishAuthority<'guard, 'tx, 'original> {
    guard: &'guard a::TransactionAuthorization<'tx>,
    principal: &'original a::Principal,
    source: &'original a::SourceGrant,
    partition: &'original a::PartitionGrant,
    lifecycle: &'original a::LifecycleGrant,
    configured: &'original Arc<TrustedHomeBoxSource>,
}
impl s::Authorization for PresencePublishAuthority<'_, '_, '_> {
    type Principal = a::Principal;
    fn authorize(
        &self,
        principal: &a::Principal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let selected =
            serde_json::to_value(self.configured.partition()).map_err(|_| unavailable())?;
        if !ptr::eq(principal, self.principal)
            || !ptr::eq(self.guard.principal(), principal)
            || request.capability != s::Capability::PublishCache
            || !request.targets.is_empty()
            || request.source != Some(&selected)
            || request.mutation.is_some()
            || request.scope != &self.configured.partition().scope()
            || request.source_partition.is_some()
            || self.source.reference().partition() != *self.partition.partition()
            || self.source.reference().key.source_kind != a::SourceKind::HomeboxEntity
        {
            return Err(unavailable());
        }
        let registration: a::SourceRegistration = serde_json::from_value(
            serde_json::to_value(self.configured.registration()).map_err(|_| unavailable())?,
        )
        .map_err(|_| unavailable())?;
        self.guard
            .revalidate_lifecycle(
                self.lifecycle,
                &registration,
                a::LifecycleCapability::PublishCache,
            )
            .map_err(access_error)?;
        self.guard
            .revalidate_source_read(self.partition, std::slice::from_ref(self.source))
            .map_err(access_error)?;
        let metadata = self
            .guard
            .persisted_source_metadata(self.partition)
            .map_err(access_error)?;
        if metadata.registration() != &registration {
            return Err(unavailable());
        }
        self.guard.revalidate().map_err(access_error)?;
        Ok(s::VerifiedActor {
            workspace_id: principal.scope().workspace_id.as_str().into(),
            home_id: principal.scope().home_id.as_str().into(),
            actor_id: principal.actor_id().as_str().into(),
        })
    }
}

/// Consume the actual configured owner against the actual Store while the
/// original PublishCache Access transaction is held. The returned owner may
/// perform native capture only after this method releases both locks.
pub fn prepare_configured<'p>(
    core: &Core,
    principal: &'p a::Principal,
    source: &a::SourceGrant,
    partition: &a::PartitionGrant,
    lifecycle: &a::LifecycleGrant,
    configured: &Arc<TrustedHomeBoxSource>,
    credentials: &Arc<NativeReadCredentialConfig>,
) -> Result<owner::PreparedConfiguredNativePresence<'p>, PresencePreparationError> {
    let access = Arc::clone(&core.access);
    let reader = owner::NativePresenceReader::from_configured(
        configured,
        credentials,
        Arc::clone(&access),
        principal,
        source.clone(),
        partition.clone(),
    )?;
    let registration: a::SourceRegistration = serde_json::from_value(
        serde_json::to_value(configured.registration())
            .map_err(|_| PresencePreparationError::Unavailable)?,
    )
    .map_err(|_| PresencePreparationError::Unavailable)?;
    let mut pending = Some(reader);
    let mut prepared = None;
    let mut store = core
        .store
        .lock()
        .map_err(|_| PresencePreparationError::Unavailable)?;
    access
        .lock()
        .map_err(|_| PresencePreparationError::Unavailable)?
        .with_lifecycle_authorization(
            principal,
            lifecycle,
            &registration,
            a::LifecycleCapability::PublishCache,
            |guard| -> Result<(), PresencePreparationError> {
                let authority = PresencePublishAuthority {
                    guard,
                    principal,
                    source,
                    partition,
                    lifecycle,
                    configured,
                };
                prepared = Some(
                    pending
                        .take()
                        .ok_or(PresencePreparationError::Unavailable)?
                        .prepare(&mut *store, &authority, guard)?,
                );
                Ok(())
            },
        )?;
    prepared.ok_or(PresencePreparationError::Unavailable)
}

#[derive(Debug)]
pub enum PresencePublicationError {
    Access(a::AccessError),
    Store(s::Error),
    Unavailable,
}
impl From<a::AccessError> for PresencePublicationError {
    fn from(value: a::AccessError) -> Self {
        Self::Access(value)
    }
}
impl From<s::Error> for PresencePublicationError {
    fn from(value: s::Error) -> Self {
        Self::Store(value)
    }
}
impl fmt::Display for PresencePublicationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Configured native presence publication unavailable")
    }
}
impl std::error::Error for PresencePublicationError {}

/// A closed same-invocation Store and Access release joined to the configured
/// native origin. This is neither a historical witness nor current admission.
pub struct ConfiguredPresenceReleased<'origin, 'principal> {
    origin: &'origin Arc<owner::ConfiguredNativePresenceOrigin<'principal>>,
    released: a::historical_presence::PresenceAccessReleasedCut<'origin, a::Principal>,
}
impl<'origin, 'principal> ConfiguredPresenceReleased<'origin, 'principal> {
    pub fn origin(&self) -> &owner::ConfiguredNativePresenceOrigin<'principal> {
        self.origin
    }
    pub fn committed(&self) -> &s::CachePresenceCommittedData {
        self.released.committed()
    }
    pub fn native_generation(&self) -> &crate::providers::homebox::read::NativePresenceGeneration {
        self.released.native_generation()
    }
    pub fn native_access_package_version(&self) -> &'static str {
        self.released.native_access_package_version()
    }
}

fn native_principal(principal: &a::Principal) -> &a::Principal {
    principal
}

fn same_registration(
    configured: &TrustedHomeBoxSource,
    metadata: &a::SourceAuthorityMetadata,
    committed: &s::SourceRegistration,
) -> bool {
    match (
        serde_json::to_value(configured.registration()),
        serde_json::to_value(metadata.registration()),
    ) {
        (Ok(configured_metadata), Ok(access_metadata)) => {
            configured_metadata == access_metadata && configured.registration() == committed
        }
        _ => false,
    }
}

/// Consume only a capture returned by the actual configured owner. The origin
/// remains caller-owned so Access can borrow its exact retained source grants
/// through the final release without constructing a self-borrowing receipt.
/// The supplied lifecycle grant is freshly checked here; this API does not
/// claim it is the same allocation used during preparation.
pub fn publish_configured<'origin, 'principal: 'origin>(
    core: &Core,
    selected: &Arc<TrustedHomeBoxSource>,
    origin: &'origin Arc<owner::ConfiguredNativePresenceOrigin<'principal>>,
    capture: crate::providers::homebox::read::NativePresenceCapture<'principal, a::Principal>,
    lifecycle: &a::LifecycleGrant,
    observation: &s::CachePresenceCommittedObservation,
) -> Result<ConfiguredPresenceReleased<'origin, 'principal>, PresencePublicationError> {
    if !Arc::ptr_eq(selected, origin.configured())
        || !origin.matches_capture(&capture)
        || !ptr::eq(origin.original_principal(), capture.principal())
        || origin.original_source().reference().partition()
            != *origin.original_partition().partition()
        || *origin.partition() != selected.partition()
        || origin.registration() != selected.registration()
        || origin.scope() != selected.scope()
    {
        return Err(PresencePublicationError::Unavailable);
    }
    let mut store = core
        .store
        .lock()
        .map_err(|_| PresencePublicationError::Unavailable)?;
    let mut access = core
        .access
        .lock()
        .map_err(|_| PresencePublicationError::Unavailable)?;
    let released = a::historical_presence::with_presence_storage_release(
        &mut access,
        origin.original_principal(),
        origin.original_source(),
        origin.original_partition(),
        capture,
        native_principal,
        |guard, publication| {
            if !origin.matches_capture(publication.native_capture())
                || !ptr::eq(
                    publication.native_capture().principal(),
                    origin.original_principal(),
                )
                || publication.qualified_access().captured_source_metadata()
                    != origin.source_metadata()
            {
                return Err(PresencePublicationError::Unavailable);
            }
            let authority = PresencePublishAuthority {
                guard,
                principal: origin.original_principal(),
                source: origin.original_source(),
                partition: origin.original_partition(),
                lifecycle,
                configured: selected,
            };
            publication
                .publish(&mut *store, &authority, observation)
                .map_err(PresencePublicationError::from)
        },
    )?;
    if !origin.matches_capture(released.native_capture())
        || !released.compares_exact_original_allocation(
            origin.original_principal(),
            origin.original_source(),
            origin.original_partition(),
        )
        || released.captured_source_metadata() != origin.source_metadata()
        || released.original_source_ref() != origin.original_source().reference()
        || released.original_partition() != origin.original_partition().partition()
        || !same_registration(
            selected,
            released.captured_source_metadata(),
            released.committed().registration(),
        )
        || released.committed().cache().generation_id.as_deref()
            != Some(origin.reserved_generation_id())
    {
        return Err(PresencePublicationError::Unavailable);
    }
    Ok(ConfiguredPresenceReleased { origin, released })
}
