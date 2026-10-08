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
