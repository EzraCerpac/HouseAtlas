//! Positive pure mapping examples over public synthetic frozen records.
//! Actual AT51 stock/frozen validators and NativeSemantics are used. These
//! plans are not executed: no Storage/Access/source/renderer qualification,
//! replay, rejection, concurrency, byte delivery or held control is claimed.
use houseatlas_backend::{
    contracts::{AssetPayloadPreviewPolicy, BindingPayloadSourceState},
    domain::{native_semantics::NativeSemantics, stock as st},
    storage as s,
};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
type Check<T = ()> = Result<T, Box<dyn std::error::Error>>;
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn request(command: &str, record: &s::Record, n: u64, payload: Value, create: bool) -> Value {
    json!({"schemaVersion":3,"commandId":command,"requestId":id(n),
        "context":record.scope(),"target":{"authority":"atlas",
            "recordType":record.record_type,"recordId":if create { id(n+1000) } else {record.record_id.clone()}},
        "payload":payload,"idempotencyKey":id(n+2000),"reason":"Healthy synthetic mapping",
        "preconditions":{"target":if create {Value::Null} else {json!({"kind":"atlas","value":record.revision})},
            "guards":[{"target":{"authority":"atlas","recordType":"evidence","recordId":id(100)},
                "revision":{"kind":"atlas","value":1}}]},"approvalReceiptId":null})
}
fn main() -> Check {
    let root = PathBuf::from(std::env::args().nth(1).ok_or("Repository root required")?);
    let out = PathBuf::from(
        std::env::args()
            .nth(2)
            .ok_or("NEW evidence file required")?,
    );
    let mut records = Vec::new();
    for name in ["optional-geometry", "import-remap"] {
        let snapshot: s::Snapshot = serde_json::from_slice(&fs::read(
            root.join(format!("packages/contracts/fixtures/{name}.snapshot.json")),
        )?)?;
        records.extend(snapshot.records.into_iter().filter(|r| r.home_id == id(2)));
    }
    let stock = st::NativeStockContract::new()?;
    let native = s::NativeContract::new(NativeSemantics::native());
    let mut direct = Vec::new();
    for descriptor in st::OPERATIONS {
        let Some(operation) = st::atlas_direct_operation(descriptor.id) else {
            continue;
        };
        let record = records
            .iter()
            .find(|r| r.record_type.as_str() == descriptor.resource_kind)
            .ok_or("Published example record required")?;
        let payload = if matches!(operation, s::Operation::Create | s::Operation::Replace) {
            record.payload.clone()
        } else {
            json!({})
        };
        let raw = request(
            descriptor.id.as_str(),
            record,
            700_000 + direct.len() as u64,
            payload,
            operation == s::Operation::Create,
        );
        let accepted = st::ValidatedRequest::parse(&stock, raw.clone())?;
        let plan = st::plan_atlas_commands(&accepted, &native)?;
        let entry = &plan.groups()[0].native_entries()[0];
        assert_eq!(entry.command.operation, operation);
        assert_eq!(plan.original_request(), &raw);
        assert_eq!(plan.request_digest(), accepted.intent_digest());
        assert_eq!(
            plan.root_idempotency_key(),
            raw["idempotencyKey"].as_str().unwrap()
        );
        direct.push(
            json!({"commandId":descriptor.id,"native":entry,"requestDigest":plan.request_digest()}),
        );
    }
    assert_eq!(direct.len(), 31);
    let binding = records
        .iter()
        .rev()
        .find(|r| r.record_type == s::RecordType::Binding && r.record_id == id(301))
        .unwrap()
        .clone();
    let geometry = records
        .iter()
        .find(|r| r.record_type == s::RecordType::Geometry)
        .unwrap()
        .clone();
    let asset = records
        .iter()
        .find(|r| r.record_type == s::RecordType::Asset)
        .unwrap()
        .clone();
    let mut create_payload = binding.payload.clone();
    create_payload
        .as_object_mut()
        .unwrap()
        .remove("sourceState");
    let mut geometry_payload = geometry.payload.clone();
    geometry_payload
        .as_object_mut()
        .unwrap()
        .remove("importedAt");
    let mut tombstoned = binding.clone();
    tombstoned.lifecycle = s::Lifecycle::Tombstoned;
    let evidence = json!([id(100)]);
    let native_remap: Value = serde_json::from_slice(&fs::read(
        root.join("packages/contracts/fixtures/import-remap.batch.json"),
    )?)?;
    let remapped_source =
        native_remap["commands"][1]["command"]["value"]["payload"]["source"].clone();
    let mut cases = vec![
        (
            request(
                "atlas.binding.create",
                &binding,
                710_000,
                create_payload,
                true,
            ),
            st::AtlasDerivation::BindingCreate {
                source_state: BindingPayloadSourceState::Unresolved,
            },
        ),
        (
            request(
                "atlas.binding.review",
                &binding,
                710_001,
                json!({"reviewStatus":"accepted","evidenceIds":evidence}),
                false,
            ),
            st::AtlasDerivation::BindingReview {
                original: binding.clone(),
            },
        ),
        (
            request(
                "atlas.binding.restore",
                &tombstoned,
                710_002,
                json!({}),
                false,
            ),
            st::AtlasDerivation::BindingRestore {
                original: tombstoned,
            },
        ),
        (
            request(
                "atlas.binding.remap",
                &binding,
                710_003,
                json!({"oldBindingId":binding.record_id,"newBindingId":id(712_003),"journalId":id(712_004),
                    "source":remapped_source,"reason":"import-id-remap","evidenceIds":evidence}),
                false,
            ),
            st::AtlasDerivation::BindingRemap {
                original: binding.clone(),
                source_state: BindingPayloadSourceState::Unresolved,
            },
        ),
        (
            request(
                "atlas.geometry.create",
                &geometry,
                710_004,
                geometry_payload,
                true,
            ),
            st::AtlasDerivation::GeometryCreate {
                imported_at: "2026-01-03T12:00:00Z".into(),
            },
        ),
    ];
    for (n, treatment, preview_policy) in [
        (710_005, "block", AssetPayloadPreviewPolicy::Blocked),
        (
            710_006,
            "download-only",
            AssetPayloadPreviewPolicy::DownloadOnly,
        ),
    ] {
        cases.push((
            request(
                "atlas.asset.review",
                &asset,
                n,
                json!({"treatment":treatment,"rendererReceiptId":null,"evidenceIds":evidence}),
                false,
            ),
            st::AtlasDerivation::AssetReview {
                original: asset.clone(),
                preview_policy,
                renderer_receipt_id: None,
            },
        ));
    }
    let mut derived = Vec::new();
    for (raw, derivation) in cases {
        let accepted = st::ValidatedRequest::parse(&stock, raw.clone())?;
        let plan = st::plan_derived_atlas_commands(&accepted, &derivation, &native)?;
        assert_eq!(plan.original_request(), &raw);
        assert_eq!(plan.request_digest(), accepted.intent_digest());
        let entries = plan.groups()[0].native_entries();
        if accepted.id() == st::OperationId::AtlasBindingRemap {
            assert_eq!(entries.len(), 3);
            assert_eq!(entries[0].target.record_id, binding.record_id);
            assert_eq!(entries[1].target.record_id, id(712_003));
            assert_eq!(entries[2].target.record_id, id(712_004));
            assert_eq!(
                entries[0].command.value.as_ref().unwrap().payload["source"],
                binding.payload["source"]
            );
            let ids: std::collections::BTreeSet<_> =
                entries.iter().map(|e| &e.command.mutation_id).collect();
            assert_eq!(ids.len(), 3);
        }
        if accepted.id() == st::OperationId::AtlasAssetReview {
            let payload = &entries[0].command.value.as_ref().unwrap().payload;
            for (key, value) in asset.payload.as_object().unwrap() {
                if key != "previewPolicy" && key != "evidenceIds" {
                    assert_eq!(&payload[key], value);
                }
            }
        }
        derived.push(json!({"request":raw,"derivation":derivation,"entries":entries}));
    }
    let evidence = json!({"directMappings":direct,"specializedExamples":derived,
        "actualPeers":["NativeStockContract","NativeContract","NativeSemantics"],
        "executedPlans":0,"rendererReceiptQualified":false,"stagedAssetCreate":"unchanged existing sealed mapper",
        "heldControlsExecuted":0,"providerCalls":0,"listeners":0});
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(out)?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec_pretty(&evidence)?)?;
    println!(
        "PASS 31 direct mappings and seven healthy specialized mapping examples; no execution qualification"
    );
    Ok(())
}
