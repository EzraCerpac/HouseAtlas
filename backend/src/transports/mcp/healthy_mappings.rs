//! Positive catalog joins only. Metadata coverage is not runtime admission,
//! route qualification or evidence that any operation can execute.

use std::collections::BTreeSet;

use crate::{contracts::stock as wire, domain::stock as domain, http::agents::capabilities};

use super::{NativeSchemas, OperationMapping, PortError, ToolName};

#[test]
fn synthetic_admitted_batch_child_descriptors() {
    use serde_json::{Value, json};

    let fixtures: Value = serde_json::from_slice(include_bytes!(
        "../../../../fixtures/integration/mcp-batch-discovery.json"
    ))
    .unwrap();
    assert_eq!(fixtures["synthetic"], true);
    let schemas = NativeSchemas::from_bytes(
        include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json"),
        include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json"),
    )
    .unwrap();
    let family = "#/$defs/family_input_atlas_records";
    let original = schemas.schema(family).unwrap();
    let batch_key = "agent__request_atlas_batch_execute";
    let items_path = "/properties/payload/properties/commands/items";
    let canonical = &original["$defs"][batch_key];
    assert_eq!(
        canonical.pointer(items_path).unwrap()["oneOf"]
            .as_array()
            .unwrap()
            .len(),
        39
    );
    for case in fixtures["cases"].as_array().unwrap() {
        let admitted: BTreeSet<_> = case["admittedCommandIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| wire::OperationId::parse(id.as_str().unwrap()).unwrap())
            .collect();
        let schema = schemas.admitted_input_schema(family, &admitted).unwrap();
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .offline()
            .build(&Value::Object(schema.clone()))
            .unwrap();
        let expected = &case["expectedChildCommandIds"];
        if expected.is_null() {
            assert!(schema["$defs"].get(batch_key).is_none());
            continue;
        }
        let expected: Vec<_> = expected
            .as_array()
            .unwrap()
            .iter()
            .map(|id| {
                let id = wire::OperationId::parse(id.as_str().unwrap()).unwrap();
                let reference = wire::operation(id).unwrap().input_schema.as_str();
                let local = format!(
                    "#/$defs/agent__{}",
                    reference.strip_prefix("#/$defs/").unwrap()
                );
                json!({"$ref":local})
            })
            .collect();
        let mut expected_batch = canonical.clone();
        *expected_batch.pointer_mut(items_path).unwrap() = if expected.is_empty() {
            Value::Bool(false)
        } else {
            json!({"oneOf":expected})
        };
        assert_eq!(
            schema["$defs"][batch_key], expected_batch,
            "{}",
            case["name"]
        );
        // Validate bytes only. No authority, stock service, durable effects or
        // provider is involved, and array bounds never become batch execution.
        for count in [0, 1, 100, 101] {
            let mut request = fixtures["batch"].clone();
            request["payload"]["commands"] = json!(vec![fixtures["child"].clone(); count]);
            let has_circuit = admitted.contains(&wire::OperationId::AtlasCircuitCreate);
            assert_eq!(
                validator.is_valid(&request),
                has_circuit && (1..=100).contains(&count)
            );
        }
    }
    let all = wire::OperationId::ALL.iter().copied().collect();
    let full = schemas.admitted_input_schema(family, &all).unwrap();
    assert_eq!(&full["$defs"][batch_key], canonical);
    assert_eq!(
        schemas.schema(family).unwrap(),
        original,
        "canonical resource is unchanged"
    );
}

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
