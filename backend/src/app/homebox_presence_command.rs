//! Same invocation stock presence command composition. The Storage cut stays
//! pending until the outer original Access transaction commits successfully.
use super::{Core, RequestPrincipal};
use crate::{access as a, domain, storage as s};
use std::{fmt, sync::Arc};

#[derive(Debug)]
pub enum PresenceCommandError {
    Access(a::AccessError),
    Storage(s::Error),
    Unavailable,
}

/// The concrete HTTP stock owner constructs its native Transaction from this
/// exact held Access guard, Prepared request, and Store-issued invocation.
/// The executor cannot return authority from the short Access phase.
pub(crate) trait OriginalPresenceCommandExecutor<'call, 'origin, 'reader, W, G> {
    fn execute<'phase, 'tx>(
        &mut self,
        store: &mut super::Store,
        guard: &'phase a::TransactionAuthorization<'tx>,
        peers: s::StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader>,
        invocation: &s::StockPresenceCommandInvocation,
    ) -> Result<s::StockPresenceStorageReleasedCut<'call, 'origin, 'reader>, PresenceCommandError>;
}
impl From<a::AccessError> for PresenceCommandError {
    fn from(value: a::AccessError) -> Self {
        Self::Access(value)
    }
}
impl From<s::Error> for PresenceCommandError {
    fn from(value: s::Error) -> Self {
        Self::Storage(value)
    }
}
impl fmt::Display for PresenceCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Original stock presence command unavailable")
    }
}
impl std::error::Error for PresenceCommandError {}

/// Borrow the complete original captured grants, then hold the same Store and
/// Access mutation transaction through the concrete stock executor. Its
/// accepted cut is promoted only after the outer Access commit returns.
pub(crate) fn execute_original_presence_command<'call, 'origin, 'reader, W, G, E>(
    core: &Core,
    principal: &'call RequestPrincipal,
    prepared: &'call domain::stock::PreparedRequest<W, G>,
    publications: &'call [&'call super::homebox_presence::ConfiguredPresenceReleased<
        'origin,
        'reader,
    >],
    age: &domain::qualified::ConfiguredCacheAge,
    executor: &mut E,
) -> Result<s::StockPresenceAcceptedCut<'call, 'origin, 'reader>, PresenceCommandError>
where
    E: OriginalPresenceCommandExecutor<'call, 'origin, 'reader, W, G>,
{
    let sources = principal.sources.borrow();
    let partitions = principal.partitions.borrow();
    let original_access = domain::qualified::OriginalPresenceAccess {
        principal: principal.principal.principal(),
        sources: &sources,
        partitions: &partitions,
    };
    let mut store = core
        .store
        .lock()
        .map_err(|_| PresenceCommandError::Unavailable)?;
    if !Arc::ptr_eq(&store.configured_authorization().0, &core.access) {
        return Err(PresenceCommandError::Unavailable);
    }
    let mut access = core
        .access
        .lock()
        .map_err(|_| PresenceCommandError::Unavailable)?;
    let mut pending = None;
    let mut invocation = None;
    access.with_mutation_authorization(
        principal.principal.principal(),
        |guard| -> Result<(), PresenceCommandError> {
            let (peers, issued) = store.prepare_presence_command(
                principal,
                prepared,
                guard,
                &original_access,
                publications,
                age,
            )?;
            let released = executor.execute(&mut store, guard, peers, &issued)?;
            pending = Some(released);
            invocation = Some(issued);
            Ok(())
        },
    )?;
    let accepted = s::promote_presence_access_released(
        pending.ok_or(PresenceCommandError::Unavailable)?,
        &invocation.ok_or(PresenceCommandError::Unavailable)?,
        principal,
        prepared,
    )?;
    if !accepted.matches_store(&*store)
        || !accepted.matches_original_preparation(principal, prepared)
    {
        return Err(PresenceCommandError::Unavailable);
    }
    Ok(accepted)
}
