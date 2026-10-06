//! Only the explicit existing healthy synthetic fixtures are decoded and round-tripped.
use houseatlas_backend::contracts::{
    AtlasDocument, AtlasRecord, BatchMutation, Contract, HomeboxPageWire, HttpHistory, Mutation,
    MutationResult, Snapshot, decode, encode, validate,
};
use serde_json::Value;
use std::{error::Error, fmt::Debug};

fn equivalent_json(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a == b || a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent_json(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| equivalent_json(a, b)))
        }
        _ => left == right,
    }
}

fn fixture<T: Contract + PartialEq + Debug>(name: &str, bytes: &[u8]) -> Result<T, Box<dyn Error>> {
    let value = decode::<T>(bytes)?;
    validate(&value)?;
    let encoded = encode(&value)?;
    let roundtrip = decode::<T>(&encoded)?;
    assert_eq!(value, roundtrip, "typed round-trip: {name}");
    assert!(
        equivalent_json(
            &serde_json::from_slice::<Value>(bytes)?,
            &serde_json::from_slice::<Value>(&encoded)?,
        ),
        "JSON shape round-trip: {name}"
    );
    println!("PASS Rust typed schema and round-trip: {name}");
    Ok(value)
}

fn main() -> Result<(), Box<dyn Error>> {
    let plan_free = include_bytes!("../../../packages/contracts/fixtures/plan-free.snapshot.json");
    fixture::<Snapshot>("plan-free.snapshot.json", plan_free)?;
    fixture::<AtlasDocument>("plan-free.snapshot.json AtlasDocument", plan_free)?;
    fixture::<Snapshot>(
        "optional-geometry.snapshot.json",
        include_bytes!("../../../packages/contracts/fixtures/optional-geometry.snapshot.json"),
    )?;
    fixture::<Snapshot>(
        "import-remap.snapshot.json",
        include_bytes!("../../../packages/contracts/fixtures/import-remap.snapshot.json"),
    )?;
    fixture::<Mutation>(
        "create-circuit.mutation.json",
        include_bytes!("../../../packages/contracts/fixtures/create-circuit.mutation.json"),
    )?;
    let result = fixture::<MutationResult>(
        "create-circuit.result.json",
        include_bytes!("../../../packages/contracts/fixtures/create-circuit.result.json"),
    )?;
    let AtlasRecord::CircuitRecord(circuit) = result.record else {
        unreachable!("existing synthetic result contains a circuit record");
    };
    assert!(circuit.payload.label.is_none());
    assert!(circuit.payload.panel.is_none());
    fixture::<BatchMutation>(
        "import-remap.batch.json",
        include_bytes!("../../../packages/contracts/fixtures/import-remap.batch.json"),
    )?;
    fixture::<HomeboxPageWire>(
        "homebox-page.wire.json",
        include_bytes!("../../../packages/contracts/fixtures/homebox-page.wire.json"),
    )?;
    let empty = fixture::<HttpHistory>(
        "empty.audit-array.json",
        include_bytes!("../../../packages/contracts/history/fixtures/empty.audit-array.json"),
    )?;
    assert!(empty.is_empty());
    fixture::<HttpHistory>(
        "recorded.audit-array.json",
        include_bytes!("../../../packages/contracts/history/fixtures/recorded.audit-array.json"),
    )?;
    fixture::<HttpHistory>(
        "tombstone.audit-array.json",
        include_bytes!("../../../packages/contracts/history/fixtures/tombstone.audit-array.json"),
    )?;
    let contexts: Value = serde_json::from_slice(include_bytes!(
        "../../../packages/contracts/history/fixtures/contexts.json"
    ))?;
    for case in contexts["cases"]
        .as_array()
        .expect("existing context cases")
    {
        if let Some(record) = case.get("committedRecord") {
            fixture::<AtlasRecord>(
                case["file"].as_str().expect("existing context filename"),
                &serde_json::to_vec(record)?,
            )?;
        }
    }
    println!("Healthy existing fixtures passed; no service or controls executed.");
    Ok(())
}
