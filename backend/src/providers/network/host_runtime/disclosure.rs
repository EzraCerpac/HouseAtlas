use super::authority::wrong_scope;
use crate::{access as a, providers::network as n};
use std::collections::BTreeMap;

/// Matching data reconstructed from the fully validated retained generation.
/// These selectors issue no permission: the actual AT11 owner alone captures
/// grants with the genuine principal and its original member handles.
pub(super) struct GenerationMembership {
    pub entities: Vec<a::SourceRef>,
    pub links: Vec<a::NetworkLinkRef>,
    pub observations: Vec<a::NetworkObservationRef>,
}

/// Complete typed entity closure, including grouping/interface parents and all
/// original link/observation members. Raw hidden endpoints stay in the closure.
pub fn generation_references(
    source: &n::SourceRegistration,
    generation: &n::NetworkGeneration,
) -> Result<Vec<a::SourceRef>, n::NetworkError> {
    Ok(generation_membership(source, generation)?.entities)
}

pub(super) fn generation_membership(
    source: &n::SourceRegistration,
    generation: &n::NetworkGeneration,
) -> Result<GenerationMembership, n::NetworkError> {
    validate_generation(source, generation)?;
    let inventory = &generation.inventory;
    let mut entities = Vec::new();
    let mut endpoints = BTreeMap::new();
    for (rows, kind) in [
        (&inventory.groups, a::SourceKind::NetworkGroup),
        (&inventory.devices, a::SourceKind::NetworkDevice),
        (&inventory.interfaces, a::SourceKind::NetworkInterface),
        (&inventory.segments, a::SourceKind::NetworkSegment),
    ] {
        for row in rows {
            let reference = a::SourceRef {
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
            };
            // IDs are unique across the actual inventory. Observations occupy
            // a separate namespace and never enter this endpoint map.
            endpoints.insert(row.external_id.clone(), reference.clone());
            entities.push(reference);
        }
    }
    if entities.len() + inventory.links.len() + generation.observations.len() > 20_000 {
        return Err(n::NetworkError::new(n::ErrorCode::SizeLimit));
    }
    let partition = a::SourcePartition {
        workspace_id: a::CanonicalId::parse(&source.scope.workspace_id)
            .map_err(|_| wrong_scope())?,
        home_id: a::CanonicalId::parse(&source.scope.home_id).map_err(|_| wrong_scope())?,
        source_instance_id: a::CanonicalId::parse(&source.scope.source_instance_id)
            .map_err(|_| wrong_scope())?,
        collection_id: source.scope.collection_id.clone(),
    };
    let mut links = Vec::new();
    for row in &inventory.links {
        let endpoint = |name| -> Result<a::SourceRef, n::NetworkError> {
            let id = row
                .value
                .get(name)
                .and_then(serde_json::Value::as_str)
                .ok_or_else(wrong_scope)?;
            endpoints.get(id).cloned().ok_or_else(wrong_scope)
        };
        // Use the raw direction and original hidden target, never normalized
        // relation endpoints (which can be reversed or projected unresolved).
        links.push(
            a::NetworkLinkRef::new(
                partition.clone(),
                row.external_id.clone(),
                endpoint("from")?,
                endpoint("to")?,
            )
            .map_err(|_| wrong_scope())?,
        );
    }
    let mut observations = Vec::new();
    for row in &generation.observations {
        let member = |field: &str| -> Result<Option<a::SourceRef>, n::NetworkError> {
            row.value
                .get(field)
                .map(|id| {
                    endpoints
                        .get(id.as_str().ok_or_else(wrong_scope)?)
                        .cloned()
                        .ok_or_else(wrong_scope)
                })
                .transpose()
        };
        observations.push(
            a::NetworkObservationRef::new(
                partition.clone(),
                row.external_id.clone(),
                row.value
                    .get("collectorId")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(wrong_scope)?,
                member("deviceId")?,
                member("interfaceId")?,
            )
            .map_err(|_| wrong_scope())?,
        );
    }
    Ok(GenerationMembership {
        entities,
        links,
        observations,
    })
}

pub(super) fn validate_generation(
    source: &n::SourceRegistration,
    generation: &n::NetworkGeneration,
) -> Result<(), n::NetworkError> {
    // Delegate directly to the accepted projector; no invented live cache
    // pointer, authority DTO or membership witness is used for validation.
    let document = serde_json::json!({
        "revision": generation.source_revision,
        "inventory": n::projection::inventory_values(generation),
        "observations": generation.observations.iter().map(|row| row.value.clone()).collect::<Vec<_>>()
    });
    let bytes = serde_json::to_vec(&document)
        .map_err(|_| n::NetworkError::new(n::ErrorCode::InvalidSchema))?;
    let expected = n::project_capture(
        source,
        n::NetworkCapture {
            source: &generation.scope,
            document: &bytes,
            retrieved_at: &generation.retrieved_at,
            source_snapshot_at: generation.source_snapshot_at.as_deref(),
        },
        &generation.link_review,
        n::Limits::default(),
    )?;
    if generation != &expected {
        return Err(wrong_scope());
    }
    Ok(())
}
