use super::{model::*, projection::stamp, validate_state};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FacetStatus {
    Revoked,
    Unavailable,
    Stale,
    Fresh,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObservationFreshness {
    Invalidated,
    Stale,
    Recent,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FacetObservation {
    #[serde(flatten)]
    pub observation: RetainedObservation,
    pub freshness: ObservationFreshness,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetCapabilities {
    pub demand: bool,
    pub diagnostics: bool,
    pub writes: bool,
    pub physical_placement: bool,
    pub electrical_circuits: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFacet {
    #[serde(flatten)]
    pub scope: SourceScope,
    pub read_only: bool,
    pub status: FacetStatus,
    pub cache: CacheMetadata,
    pub age_ms: Option<i64>,
    pub source_revision: Option<u64>,
    pub source_snapshot_at: Option<String>,
    pub groups: Vec<QualifiedRecord>,
    pub devices: Vec<QualifiedRecord>,
    pub interfaces: Vec<QualifiedRecord>,
    pub segments: Vec<QualifiedRecord>,
    pub current_claims: Vec<NetworkRelation>,
    pub history: Vec<NetworkRelation>,
    pub observations: Vec<FacetObservation>,
    pub message: String,
    pub capabilities: FacetCapabilities,
}
/// Pure validated browse projection. No transport, refresh or demand is accepted.
pub fn build_facet(
    source: &SourceRegistration,
    state: &RetainedState,
    now: &str,
    stale_after_ms: i64,
) -> Result<NetworkFacet> {
    validate_state(source, state, None)?;
    let now_ms = stamp(now)?;
    guard(stale_after_ms > 0)?;
    let age_ms = state
        .cache
        .last_successful_fetch_at
        .as_deref()
        .map(stamp)
        .transpose()?
        .map(|at| (now_ms - at).max(0));
    let denied = state.cache.status == CacheStatus::AccessRevoked;
    let generation = if denied {
        None
    } else {
        state.generation.as_ref()
    };
    let stale = generation.is_some()
        && (state.cache.status != CacheStatus::Fresh
            || age_ms.is_some_and(|age| age > stale_after_ms));
    let status = if denied {
        FacetStatus::Revoked
    } else if generation.is_none() {
        FacetStatus::Unavailable
    } else if stale {
        FacetStatus::Stale
    } else {
        FacetStatus::Fresh
    };
    let mut result = NetworkFacet {
        scope: source.scope.clone(),
        read_only: true,
        status,
        cache: state.cache.clone(),
        age_ms,
        source_revision: generation.map(|value| value.source_revision),
        source_snapshot_at: generation.and_then(|value| value.source_snapshot_at.clone()),
        groups: Vec::new(),
        devices: Vec::new(),
        interfaces: Vec::new(),
        segments: Vec::new(),
        current_claims: Vec::new(),
        history: Vec::new(),
        observations: Vec::new(),
        message: match status {
            FacetStatus::Revoked => "Network access is unavailable",
            FacetStatus::Unavailable => "Network data is unavailable",
            FacetStatus::Stale => "Cached Network data; device state is unknown",
            FacetStatus::Fresh => "Network source claims",
        }
        .into(),
        capabilities: FacetCapabilities {
            demand: false,
            diagnostics: false,
            writes: false,
            physical_placement: false,
            electrical_circuits: false,
        },
    };
    if let Some(generation) = generation {
        result.groups = generation.inventory.groups.clone();
        result.devices = generation.inventory.devices.clone();
        result.interfaces = generation.inventory.interfaces.clone();
        result.segments = generation.inventory.segments.clone();
        for relation in &generation.network_relations {
            if relation.temporal_status == TemporalStatus::CurrentClaim {
                result.current_claims.push(relation.clone());
            } else {
                result.history.push(relation.clone());
            }
        }
        for row in &generation.observations {
            let freshness = if row.value.get("invalidatedAt").is_some() {
                ObservationFreshness::Invalidated
            } else if now_ms - stamp(&row.fact_at)? > stale_after_ms {
                ObservationFreshness::Stale
            } else {
                ObservationFreshness::Recent
            };
            result.observations.push(FacetObservation {
                observation: row.clone(),
                freshness,
            });
        }
    }
    Ok(result)
}
