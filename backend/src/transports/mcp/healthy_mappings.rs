//! Positive catalog joins only. Metadata coverage is not runtime admission,
//! route qualification or evidence that any operation can execute.

use std::collections::BTreeSet;

use crate::{contracts::stock as wire, domain::stock as domain, http::agents::capabilities};

use super::{OperationMapping, ToolName};

#[test]
fn healthy_finite_operation_mappings() {
    let mappings = OperationMapping::all().expect("published finite catalogs agree");
    assert_eq!(mappings.len(), 164);
    assert_eq!(mappings.len(), wire::OperationId::ALL.len());

    let mut operations = BTreeSet::new();
    let mut families = BTreeSet::new();
    let mut held_metadata = false;
    let mut unsupported_metadata = false;
    for (mapping, expected) in mappings.iter().copied().zip(wire::OperationId::ALL) {
        assert_eq!(mapping.operation(), *expected);
        operations.insert(mapping.operation());
        families.insert(mapping.family());

        let published = wire::operation(mapping.operation()).unwrap();
        let native = mapping.native().operation();
        assert_eq!(mapping.native().as_str(), mapping.operation().as_str());
        assert_eq!(mapping.family(), published.tool_family);
        assert_eq!(mapping.family().as_str(), native.family);
        assert_eq!(mapping.input_schema(), published.input_schema);
        assert_eq!(mapping.input_schema(), native.input_schema);
        assert_eq!(mapping.output_schema(), published.output_schema);
        assert_eq!(mapping.output_schema(), native.output_schema);
        assert_eq!(mapping.output_kind(), native.output_kind);

        let tool = ToolName::from(mapping.family());
        assert_eq!(ToolName::parse(tool.as_str()).unwrap(), tool);
        assert_eq!(tool.family(), mapping.family());

        // These are static disposition rows, never requests or owner calls.
        held_metadata |= matches!(native.disposition, domain::Disposition::Held);
        unsupported_metadata |= matches!(native.disposition, domain::Disposition::Unsupported);
    }
    assert_eq!(operations.len(), 164);
    assert_eq!(families.len(), 10);
    assert_eq!(
        families,
        wire::ToolFamily::ALL
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
    );
    assert!(held_metadata);
    assert!(unsupported_metadata);

    // Keep the actual host's existing read admission separate from the complete
    // mapping. This exact list adds neither download nor child-only identity
    // creation; neither operation is invoked by this metadata check.
    use wire::OperationId::*;
    assert_eq!(
        capabilities::reads(),
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
    );
}
