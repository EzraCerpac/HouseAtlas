//! Explicit healthy calendar-date projections and retained timestamp forms.
//! No reader, provider, authority, publication or held control is invoked.
use houseatlas_backend::contracts::{
    HomeboxPageWire, HomeboxProjection, Maintenance, Snapshot, decode, encode,
};
use serde_json::Value;
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let entries: Value = serde_json::from_slice(include_bytes!("maintenance-calendar.json"))?;
    for wire in entries.as_array().expect("three explicit synthetic rows") {
        let typed = decode::<Maintenance>(&serde_json::to_vec(wire)?)?;
        let roundtrip: Value = serde_json::from_slice(&encode(&typed)?)?;
        assert_eq!(roundtrip, *wire);
        assert_eq!(
            typed.scheduled_date.as_deref(),
            wire["scheduledDate"].as_str()
        );
        assert_eq!(
            typed.completed_date.as_deref(),
            wire["completedDate"].as_str()
        );
    }
    println!("PASS native maintenance calendar dates, nulls and numeric cost round-trip");

    let original: Value = serde_json::from_slice(include_bytes!(
        "../../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;
    let mut projection = original["homeboxEntities"][0].clone();
    projection["maintenance"] = entries;
    let typed = decode::<HomeboxProjection>(&serde_json::to_vec(&projection)?)?;
    let roundtrip: Value = serde_json::from_slice(&encode(&typed)?)?;
    assert_eq!(roundtrip, projection);
    assert_eq!(
        roundtrip["sourceUpdatedAt"],
        original["homeboxEntities"][0]["sourceUpdatedAt"]
    );
    assert_eq!(
        roundtrip["retrievedAt"],
        original["homeboxEntities"][0]["retrievedAt"]
    );
    let mut snapshot = original.clone();
    snapshot["homeboxEntities"][0] = projection;
    let typed = decode::<Snapshot>(&serde_json::to_vec(&snapshot)?)?;
    assert_eq!(serde_json::from_slice::<Value>(&encode(&typed)?)?, snapshot);
    println!(
        "PASS native projection/snapshot calendar dates with unchanged source/retrieval times"
    );

    let legacy: Value = serde_json::from_slice(include_bytes!(
        "../../../../packages/contracts/fixtures/homebox-page.wire.json"
    ))?;
    let typed = decode::<HomeboxPageWire>(&serde_json::to_vec(&legacy)?)?;
    assert_eq!(serde_json::from_slice::<Value>(&encode(&typed)?)?, legacy);
    println!("PASS retained healthy HomeBox timestamp maintenance spelling");
    Ok(())
}
