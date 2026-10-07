//! Explicit host admission, independent of catalog disposition and browser role.
use crate::{access, contracts::stock as wire};

pub fn reads() -> Vec<wire::OperationId> {
    use wire::OperationId::*;
    vec![
        AtlasIdentityList,
        AtlasBindingList,
        AtlasEvidenceList,
        AtlasLocationSemanticsList,
        AtlasCircuitList,
        AtlasValveList,
        AtlasRelationList,
        AtlasGeometryList,
        AtlasAssetList,
        AtlasReconciliationList,
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
    // HTTP Host provides both the genuine issuer and authenticated redemption.
    // The Core-only MCP catalog continues to use reads() without this operation.
    operations.push(wire::OperationId::AtlasAssetDownload);
    if principal.role() == access::Role::Editor {
        operations.extend(wire::OperationId::ALL.iter().copied().filter(|id| {
            crate::domain::stock::OperationId::parse(id.as_str())
                .is_some_and(|id| crate::domain::stock::atlas_direct_operation(id).is_some())
        }));
        // Execution still validates every ordered child through the same closed
        // planner map and its original-principal transaction fence.
        operations.push(wire::OperationId::AtlasBatchExecute);
    }
    operations
}
