//! Positive catalog joins only. Metadata coverage is not runtime admission,
//! route qualification or evidence that any operation can execute.

use std::collections::BTreeSet;

use crate::{contracts::stock as wire, domain::stock as domain, http::agents::capabilities};

use super::{NativeSchemas, OperationMapping, PortError, ToolName};

#[test]
fn healthy_admitted_family_input_descriptors() {
    let schemas = NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )
    .unwrap();
    let families = wire::families().unwrap();
    for family in families {
        // Synthetic descriptor selection only, never a runtime grant or call.
        // Include another family's operation to exercise the intersection.
        let selected = family.command_ids[0];
        let other = families
            .iter()
            .find(|other| other.name != family.name)
            .unwrap()
            .command_ids[0];
        let admitted = BTreeSet::from([selected, other]);
        let schema = schemas
            .admitted_input_schema(&family.input_schema, &admitted)
            .unwrap();
        let original = schemas.schema(&family.input_schema).unwrap();
        assert_eq!(
            original["oneOf"].as_array().unwrap().len(),
            family.command_ids.len()
        );
        let reference = wire::operation(selected).unwrap().input_schema.as_str();
        let local = format!(
            "#/$defs/agent__{}",
            reference.strip_prefix("#/$defs/").unwrap()
        );
        assert_eq!(schema["oneOf"], serde_json::json!([{"$ref":local}]));
        assert_eq!(schema["type"], "object");
        for (name, definition) in schema["$defs"].as_object().unwrap() {
            assert_eq!(Some(definition), original["$defs"].get(name));
        }
        // Selected definitions stay identical to the full family's definitions;
        // materialization must still provide a closed, offline schema.
        jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .offline()
            .build(&serde_json::Value::Object(schema))
            .unwrap();
        assert!(matches!(
            schemas.admitted_input_schema(&family.input_schema, &BTreeSet::from([other])),
            Err(PortError::Unavailable)
        ));
    }
}

#[test]
fn healthy_finite_operation_mappings() {
    let mappings = OperationMapping::all().expect("published finite catalogs agree");
    assert_eq!(mappings.len(), 168);
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
    assert_eq!(operations.len(), 168);
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
            HomeboxEntityGet,
            HomeboxEntityList,
            HomeboxLocationGet,
            HomeboxLocationList,
        ]
    );
}
