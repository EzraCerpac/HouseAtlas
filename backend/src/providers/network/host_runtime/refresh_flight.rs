//! Process-local collection arbitration, never authority or generation proof.
use crate::{app::Core, providers::network as n};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock, Weak},
};

type Flight = tokio::sync::Mutex<()>;
type Flights = BTreeMap<(usize, String), Weak<Flight>>;
const MAX_ACTIVE_FLIGHTS: usize = 10_000;
static FLIGHTS: OnceLock<Mutex<Flights>> = OnceLock::new();

/// Refresh retains this Arc and its original Core handle for the whole call;
/// this is handle lifetime, not a Core mutex guard across transport.
/// Therefore an active Core address cannot be reused, and overlapping runtime
/// instances for that exact Core/partition upgrade the same live mutex.
/// Expired weak entries are removed before lookup; this is bounded memory-only
/// bookkeeping, with no Core/access/Store lock or filesystem operation.
pub(super) fn for_source(
    core: &Arc<Mutex<Core>>,
    source: &n::SourceRegistration,
) -> std::result::Result<Arc<Flight>, n::NetworkError> {
    let key = (Arc::as_ptr(core) as usize, n::partition_key(&source.scope)?);
    let mut flights = FLIGHTS
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .try_lock()
        .map_err(|_| n::NetworkError::new(n::ErrorCode::Upstream))?;
    flights.retain(|_, flight| flight.strong_count() != 0);
    if let Some(flight) = flights.get(&key).and_then(Weak::upgrade) {
        return Ok(flight);
    }
    if flights.len() >= MAX_ACTIVE_FLIGHTS {
        return Err(n::NetworkError::new(n::ErrorCode::SizeLimit));
    }
    let flight = Arc::new(Flight::new(()));
    flights.insert(key, Arc::downgrade(&flight));
    Ok(flight)
}
