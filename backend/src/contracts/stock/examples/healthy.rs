//! Ordinary, explicit synthetic schema and representation examples only.
//! No service mutation, dispatch, authority decision or witness admission runs.

use houseatlas_backend::contracts::stock::{
    CapabilityStatus, OperationId, OutputObligationKind, PresenceObservation, ProviderOutcomeState,
    RemoteActivityState, ResponseKind, StockRequest, StockResponse, StockValidation, ToolFamily,
    WireField, decode_presence_qualification, decode_presence_witness,
    encode_presence_qualification, encode_presence_witness, families, family, operational_time,
    operations, request_digest, validate_presence_qualification, validate_presence_witness,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error};

fn catalog_examples(validator: &StockValidation) -> Result<(), Box<dyn Error>> {
    let counts = validator.compile_all()?;
    assert_eq!(counts.agent_definitions, 451);
    assert_eq!(counts.atlas_definitions, 48);
    assert_eq!(counts.agent_definitions + counts.atlas_definitions + 4, 503);
    assert_eq!(counts.operation_inputs, 164);
    assert_eq!(counts.operation_outputs, 164);
    assert_eq!(counts.family_inputs, 10);
    assert_eq!(counts.family_outputs, 10);
    assert_eq!(counts.presence_schemas, 2);

    let catalog = operations()?;
    assert_eq!(catalog.len(), OperationId::ALL.len());
    assert_eq!(families()?.len(), ToolFamily::ALL.len());
    let statuses = catalog.iter().fold(BTreeMap::new(), |mut counts, entry| {
        *counts.entry(entry.status).or_insert(0_u64) += 1;
        counts
    });
    assert_eq!(
        statuses,
        BTreeMap::from([
            (CapabilityStatus::SupportedPendingQualification, 150),
            (CapabilityStatus::UnsupportedCapability, 9),
            (CapabilityStatus::ForbiddenAppendOnly, 3),
            (CapabilityStatus::HeldPolicy, 2),
        ])
    );
    // These are catalog metadata counts, never capability admission decisions.
    println!(
        "PASS native offline schema compilation: 503 validators, 164 operation mappings, 10 families"
    );
    Ok(())
}

fn envelope_examples(validator: &StockValidation, fixture: &Value) -> Result<(), Box<dyn Error>> {
    let inputs = fixture["requests"]
        .as_array()
        .expect("seven healthy requests");
    let outputs = fixture["results"]
        .as_array()
        .expect("seven healthy results");
    let digests = fixture["intentDigests"]
        .as_array()
        .expect("seven offline digest references");
    assert_eq!(inputs.len(), 7);
    assert_eq!(outputs.len(), inputs.len());
    assert_eq!(digests.len(), inputs.len());

    let mut requests = Vec::<StockRequest>::new();
    let mut responses = Vec::<StockResponse>::new();
    for ((input, output), digest) in inputs.iter().zip(outputs).zip(digests) {
        let request = validator.decode_request(&serde_json::to_vec(input)?)?;
        assert_eq!(request.raw(), input);
        assert_eq!(
            request_digest(&request),
            digest.as_str().expect("digest string")
        );
        assert_eq!(serde_json::to_value(request.context())?, input["context"]);
        assert_eq!(serde_json::to_value(request.target())?, input["target"]);

        let grouping = family(request.operation()?.tool_family)?;
        assert!(grouping.command_ids.contains(&request.id()));
        validator.validate(&grouping.input_schema, input)?;
        validator.validate(&grouping.output_schema, &output["wire"])?;

        let children = output["children"]
            .as_array()
            .expect("explicit child envelopes");
        let response = StockResponse::parse(validator, &request, output["wire"].clone(), children)?;
        assert_eq!(response.raw(), &output["wire"]);
        assert_eq!(response.command_id(), Some(request.id()));
        assert_eq!(response.request_id(), request.request_id());
        assert_eq!(response.children().len(), children.len());
        assert_eq!(
            response.obligations()[0].kind,
            OutputObligationKind::CurrentResultAuthority
        );
        assert_eq!(response.obligations()[0].value, output["wire"]);
        println!(
            "PASS native healthy envelope, intent digest and correlation: {}",
            request.id()
        );
        requests.push(request);
        responses.push(response);
    }

    assert_eq!(requests[0].approval_receipt_id(), WireField::Absent);
    assert_eq!(requests[1].approval_receipt_id(), WireField::Null);
    assert_eq!(requests[1].payload()["label"], Value::Null);
    assert_eq!(requests[1].payload()["panel"], Value::Null);
    assert_eq!(requests[4].target_value().get("entityId"), None);
    assert_eq!(requests[4].target_value().get("resourceId"), None);
    assert_eq!(
        responses[6].raw()["data"]["devices"][0]["confidence"],
        Value::Null
    );

    let batch = &requests[3];
    let receipt = &responses[3];
    assert_eq!(batch.id(), OperationId::AtlasBatchExecute);
    assert_eq!(batch.children().len(), 2);
    assert_eq!(receipt.kind(), &ResponseKind::AtlasCommitted);
    let mut records = Vec::new();
    let mut audits = Vec::new();
    for (index, (child, child_result)) in
        batch.children().iter().zip(receipt.children()).enumerate()
    {
        assert_eq!(child.raw(), requests[index + 1].raw());
        assert_eq!(child_result.raw(), responses[index + 1].raw());
        assert_eq!(child.request_id(), requests[index + 1].request_id());
        assert_eq!(child.approval_receipt_id(), WireField::Null);
        assert_eq!(child_result.kind(), &ResponseKind::AtlasCommitted);
        assert_eq!(
            child_result.obligations()[0].kind,
            OutputObligationKind::CurrentResultAuthority
        );
        records.extend(
            child_result.raw()["data"]["records"]
                .as_array()
                .expect("records")
                .iter()
                .cloned(),
        );
        audits.extend(
            child_result.raw()["data"]["auditIds"]
                .as_array()
                .expect("audits")
                .iter()
                .cloned(),
        );
    }
    assert_eq!(receipt.raw()["data"]["records"], Value::Array(records));
    assert_eq!(receipt.raw()["data"]["auditIds"], Value::Array(audits));
    assert_eq!(
        responses[5].kind(),
        &ResponseKind::ProviderOutcome {
            state: ProviderOutcomeState::Prepared,
            activity: RemoteActivityState::NotDispatched,
        }
    );
    assert_eq!(operational_time("2026-01-02T12:00:00Z")?, 1_767_355_200_000);
    println!(
        "PASS ordered root/child envelopes, explicit null/omission and ordinary finite clocks"
    );
    Ok(())
}

fn presence_examples(fixture: &Value) -> Result<(), Box<dyn Error>> {
    let witnesses = fixture["presenceWitnesses"]
        .as_array()
        .expect("witness shapes");
    let qualifications = fixture["presenceQualifications"]
        .as_array()
        .expect("qualification shapes");
    assert_eq!(witnesses.len(), 3);
    assert_eq!(qualifications.len(), witnesses.len());
    for (wire, qualification_wire) in witnesses.iter().zip(qualifications) {
        let witness = decode_presence_witness(&serde_json::to_vec(wire)?)?;
        validate_presence_witness(&witness)?;
        assert_eq!(
            serde_json::from_slice::<Value>(&encode_presence_witness(&witness)?)?,
            *wire
        );
        assert_eq!(
            serde_json::to_value(witness.scope())?,
            json!({"workspaceId": wire["workspaceId"], "homeId": wire["homeId"]})
        );
        assert_eq!(
            serde_json::to_value(witness.source_ref())?["key"],
            wire["source"]
        );
        match &witness.observation {
            PresenceObservation::HomeboxEntity {
                source_updated_at, ..
            } => {
                assert_eq!(source_updated_at, &None);
                assert_eq!(wire["observation"]["sourceUpdatedAt"], Value::Null);
            }
            PresenceObservation::NetworkInventory {
                source_snapshot_at, ..
            } => {
                assert_eq!(source_snapshot_at, &None);
                assert_eq!(wire["observation"]["sourceSnapshotAt"], Value::Null);
            }
        }
        let qualification =
            decode_presence_qualification(&serde_json::to_vec(qualification_wire)?)?;
        validate_presence_qualification(&qualification)?;
        assert_eq!(
            serde_json::from_slice::<Value>(&encode_presence_qualification(&qualification)?)?,
            *qualification_wire
        );
        println!(
            "PASS typed presence/qualification shape round-trip: {}",
            wire["source"]["sourceKind"]
        );
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let fixture: Value = serde_json::from_slice(include_bytes!("healthy.json"))?;
    assert_eq!(fixture["synthetic"], true);
    let validator = StockValidation::new()?;
    catalog_examples(&validator)?;
    envelope_examples(&validator, &fixture)?;
    presence_examples(&fixture)?;
    println!(
        "PASS ordinary synthetic stock schemas only; no service, dispatch, authority or witness admission; held controls unrun"
    );
    Ok(())
}
