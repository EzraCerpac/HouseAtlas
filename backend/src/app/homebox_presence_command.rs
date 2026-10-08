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

/// The caller supplies its genuine stock authorizer, validated preparation and
/// already released configured publications. No fallback or replay is admitted.
#[allow(clippy::too_many_arguments)]
pub fn execute_configured_presence_command<'call, 'origin, 'reader, W, G, B, S>(
    core: &Core,
    principal: &'call RequestPrincipal,
    prepared: &'call domain::stock::PreparedRequest<W, G>,
    original_access: &'call domain::qualified::OriginalPresenceAccess<'call>,
    publications: &'call [&'call super::homebox_presence::ConfiguredPresenceReleased<
        'origin,
        'reader,
    >],
    age: &'call domain::qualified::ConfiguredCacheAge,
    authorization: &B,
    contracts: &S,
    mapping: s::PresenceCommandMapping<'_>,
    observation: &s::StockPresenceCommittedObservation,
) -> Result<s::StockPresenceAcceptedCut<'call, 'origin, 'reader>, PresenceCommandError>
where
    B: s::StockAuthorization<Principal = RequestPrincipal>,
    S: domain::stock::StockContractPort,
{
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
                original_access,
                publications,
                age,
            )?;
            let released = store.execute_presence_stock_json_with_authorization(
                authorization,
                principal,
                contracts,
                prepared.request().raw(),
                mapping,
                peers,
                observation,
            )?;
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
