use super::authority::wrong_scope;
use crate::{access as a, providers::network as n};

/// Complete typed entity closure, including original grouping/interface parents
/// and link/observation endpoints. The Network owner reprojects raw source JSON
/// in validate_state; labels, positions and tree depth confer no membership.
/// Links and observations themselves have no AT11 kind at the accepted pin.
/// This closure is internal publication authorization, not permission to disclose
/// those unsupported rows. Public release additionally calls disclosable().
pub fn generation_references(
    source: &n::SourceRegistration,
    generation: &n::NetworkGeneration,
) -> Result<Vec<a::SourceRef>, n::NetworkError> {
    validate_generation(source, generation)?;
    let inventory = &generation.inventory;
    let mut references = Vec::new();
    for (rows, kind) in [
        (&inventory.groups, a::SourceKind::NetworkGroup),
        (&inventory.devices, a::SourceKind::NetworkDevice),
        (&inventory.interfaces, a::SourceKind::NetworkInterface),
        (&inventory.segments, a::SourceKind::NetworkSegment),
    ] {
        for row in rows {
            // All supported members are captured, not just currently visible
            // endpoints. validate_state verifies every raw parent/member field.
            references.push(a::SourceRef {
                workspace_id: a::CanonicalId::parse(&source.scope.workspace_id)
                    .map_err(|_| wrong_scope())?,
                home_id: a::CanonicalId::parse(&source.scope.home_id).map_err(|_| wrong_scope())?,
                key: a::SourceKey {
                    source_instance_id: a::CanonicalId::parse(&source.scope.source_instance_id)
                        .map_err(|_| wrong_scope())?,
                    collection_id: source.scope.collection_id.clone(),
                    source_kind: kind,
                    external_id: row.external_id.clone(),
                },
            });
        }
    }
    if references.len() > 10_000 {
        return Err(n::NetworkError::new(n::ErrorCode::SizeLimit));
    }
    Ok(references)
}
pub(super) fn validate_generation(
    source: &n::SourceRegistration,
    generation: &n::NetworkGeneration,
) -> Result<(), n::NetworkError> {
    // A shape-validation carrier, never a live pointer, fence or permission.
    let mut state = n::RetainedState::empty(source.scope.clone());
    state.cache.status = n::CacheStatus::Fresh;
    state.cache.generation_id = Some("00000000-0000-4000-8000-000000000001".into());
    state.cache.last_attempt_at = Some(generation.retrieved_at.clone());
    state.cache.last_successful_fetch_at = Some(generation.retrieved_at.clone());
    state.generation = Some(generation.clone());
    n::validate_state(source, &state, Some(&generation.link_review))
}
pub(super) fn disclosable(generation: &n::NetworkGeneration) -> Result<(), n::NetworkError> {
    // AT11 4a0cd4da SourceKind has exactly four Network entity kinds. Neither
    // partition availability nor PublishCache grants can authorize these rows.
    if !generation.inventory.links.is_empty()
        || !generation.network_relations.is_empty()
        || !generation.observations.is_empty()
    {
        return Err(wrong_scope());
    }
    Ok(())
}
