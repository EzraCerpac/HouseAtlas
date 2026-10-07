//! Explicit host admission, independent of catalog disposition and browser role.
use crate::{access, contracts::stock as wire};

pub fn reads() -> Vec<wire::OperationId> {
    use wire::OperationId::*;
    vec![
        AtlasIdentityGet,
        AtlasBindingGet,
        AtlasEvidenceGet,
        AtlasLocationSemanticsGet,
        AtlasCircuitGet,
        AtlasValveGet,
        AtlasRelationGet,
        AtlasGeometryGet,
        AtlasAssetGet,
        AtlasReconciliationGet,
        AtlasIdentityHistory,
        AtlasBindingHistory,
        AtlasEvidenceHistory,
        AtlasLocationSemanticsHistory,
        AtlasCircuitHistory,
        AtlasValveHistory,
        AtlasRelationHistory,
        AtlasGeometryHistory,
        AtlasAssetHistory,
        AtlasReconciliationHistory,
    ]
}
pub fn admitted(principal: &access::Principal) -> Vec<wire::OperationId> {
    let mut operations = reads();
    if principal.role() == access::Role::Editor {
        operations.push(wire::OperationId::AtlasCircuitCreate);
    }
    // Identity-create is currently child-only; neither catalog's flat admission
    // nor this host advertises it as an independently executable operation.
    operations
}
