//! Private matching data from a validated retained capture, never authority.
//! Raw direction and hidden members survive normalized/unresolved projections.
use super::{
    NetworkError, NetworkGeneration, NetworkRelation, QualifiedRecord, SourceRegistration,
    model::{ErrorCode, Result},
    validate_generation,
};
use std::collections::BTreeMap;

/// Borrows the exact raw link, its original typed members and its reviewed
/// projection from one complete generation. No grant or public DTO is created.
#[derive(Debug)]
pub struct RetainedLinkBinding<'g> {
    pub link: &'g QualifiedRecord,
    pub from: &'g QualifiedRecord,
    pub to: &'g QualifiedRecord,
    pub relation: &'g NetworkRelation,
}

/// Validate the entire generation once, then index its actual raw members.
/// Runtime owners must bind these records to original grants on the owning
/// Core and current native baseline before public disclosure. Projected ends
/// cannot replace this binding: membership can reverse direction and a reviewed
/// unresolved target deliberately conceals its raw ID. Even resolved links use
/// the same raw binding; no fallback guesses from labels or external-ID spelling.
pub fn retained_link_bindings<'g>(
    source: &SourceRegistration,
    generation: &'g NetworkGeneration,
) -> Result<Vec<RetainedLinkBinding<'g>>> {
    validate_generation(source, generation)?;
    let inventory = &generation.inventory;
    let endpoints: BTreeMap<_, _> = inventory
        .devices
        .iter()
        .chain(&inventory.interfaces)
        .chain(&inventory.segments)
        .map(|row| (row.external_id.as_str(), row))
        .collect();
    let relations: BTreeMap<_, _> = generation
        .network_relations
        .iter()
        .map(|row| (row.external_id.as_str(), row))
        .collect();
    inventory
        .links
        .iter()
        .map(|link| {
            let endpoint = |field| {
                link.value
                    .get(field)
                    .and_then(serde_json::Value::as_str)
                    .and_then(|id| endpoints.get(id).copied())
                    .ok_or_else(invalid)
            };
            Ok(RetainedLinkBinding {
                link,
                from: endpoint("from")?,
                to: endpoint("to")?,
                relation: relations
                    .get(link.external_id.as_str())
                    .copied()
                    .ok_or_else(invalid)?,
            })
        })
        .collect()
}

fn invalid() -> NetworkError {
    NetworkError::new(ErrorCode::InvalidSchema)
}
