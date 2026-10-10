//! Positive native contract boundaries and a fresh empty archive census.
//! Synthetic schema values only: no listener, provider, credential, populated
//! archive deletion, release decision, retained capture or runtime grant.
use houseatlas_backend::{
    contracts::{self, Contract, GeometryRecord, LocationElevation, LocationSemanticsRecord,
        NetworkRelation, Optional, stock::StockValidation},
    domain::stock::{NativeStockContract, ValidatedRequest, request_digest},
    providers::network::{MAX_ARCHIVE_ENTRIES, MAX_RETAINED_SEGMENT_BYTES, SqliteNetworkSidecar},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{error::Error, fmt::Debug};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn pinned_contracts() -> Result<()> {
    let contracts = NativeStockContract::new()?;
    let validation = StockValidation::new()?;
    let context = json!({"workspaceId":id(1), "homeId":id(2)});
    let target = json!({
        "authority":"homebox", "sourceInstanceId":id(10),
        "collectionId":"synthetic-collection-Δ-地下", "resourceKind":"attachment",
        "entityId":id(500), "resourceId":id(501)
    });
    let original = json!({
        "schemaVersion":4, "commandId":"homebox.file.download", "requestId":id(5000),
        "context":context, "target":target, "payload":{}
    });
    // Keep the caller's complete wire bytes independently of the native intent
    // digest. Its documented requestId exclusion does not seal raw transport bytes.
    let sealed_wire = serde_json::to_vec(&original)?;
    let sealed_wire_sha256 = Sha256::digest(&sealed_wire);
    let parsed = ValidatedRequest::parse_pinned_homebox_download_v4(
        &contracts,
        serde_json::from_slice(&sealed_wire)?,
    )?;
    assert_eq!(parsed.raw(), &original);
    assert_eq!(parsed.target(), &target);
    assert_eq!(parsed.target().as_object().ok_or("Missing target")?.len(), 6);
    assert_eq!(parsed.context().workspace_id, id(1));
    assert_eq!(parsed.context().home_id, id(2));
    assert_eq!(parsed.request_id(), id(5000));
    assert_eq!(parsed.raw()["schemaVersion"], 4);
    assert_eq!(parsed.payload(), &json!({}));
    assert_eq!(parsed.intent_digest(), request_digest(&original)?);
    assert_eq!(serde_json::to_vec(parsed.raw())?, sealed_wire);
    assert_eq!(Sha256::digest(serde_json::to_vec(parsed.raw())?), sealed_wire_sha256);

    // This is a schema/correlation example, not an issued artifact or proof of
    // a provider capture. Every token, time and body below is synthetic.
    let body = b"synthetic pinned file body";
    let result = json!({
        "schemaVersion":4, "commandId":"homebox.file.download", "requestId":id(5000),
        "artifact":{
            "scope":{"workspaceId":id(1), "homeId":id(2), "sourceInstanceId":id(10),
                "collectionId":target["collectionId"]},
            "target":target, "downloadToken":id(5001),
            "sha256":format!("{:x}",Sha256::digest(body)), "byteSize":body.len(),
            "contentType":"text/plain",
            "localCapture":{"semantics":"process-local-pinned-snapshot",
                "beforeRetrievedAt":"2026-01-02T12:00:00Z",
                "bodyRetrievedAt":"2026-01-02T12:00:01Z",
                "afterRetrievedAt":"2026-01-02T12:00:02Z", "statuses":[200,200,200]}
        }
    });
    validation.validate(
        "urn:houseatlas:pinned-homebox-file:4#/$defs/result_homebox_file_capture_v4",
        &result,
    )?;
    assert_eq!(result["schemaVersion"], 4);
    assert_eq!(result["commandId"], parsed.raw()["commandId"]);
    assert_eq!(result["requestId"], parsed.raw()["requestId"]);
    assert_eq!(result["artifact"]["target"], parsed.raw()["target"]);
    for field in ["workspaceId", "homeId"] {
        assert_eq!(result["artifact"]["scope"][field], parsed.raw()["context"][field]);
    }
    for field in ["sourceInstanceId", "collectionId"] {
        assert_eq!(result["artifact"]["scope"][field], parsed.raw()["target"][field]);
    }

    // The old UUID-only v3 request remains on the actual generic v3 port.
    // No v4-to-v3 fallback or opaque value substitution is exercised.
    let mut v3_original = original;
    v3_original["schemaVersion"] = json!(3);
    v3_original["target"]["collectionId"] = json!(id(11));
    let v3 = ValidatedRequest::parse(&contracts, v3_original.clone())?;
    let v3_wire = validation.decode_request(&serde_json::to_vec(&v3_original)?)?;
    assert_eq!(v3.raw(), &v3_original);
    assert_eq!(v3_wire.raw(), &v3_original);
    assert_eq!(v3.raw()["schemaVersion"], 3);
    assert_eq!(v3.intent_digest(), v3_wire.intent_digest());
    Ok(())
}

fn cloned_record(snapshot: &Value, kind: &str) -> Result<Value> {
    snapshot["records"]
        .as_array()
        .ok_or("Missing published synthetic records")?
        .iter()
        .find(|record| record["recordType"] == kind)
        .cloned()
        .ok_or_else(|| format!("Missing published synthetic {kind} record").into())
}

fn canonical_roundtrip<T: Contract + PartialEq + Debug>(original: &Value) -> Result<T> {
    // decode invokes the actual native json_value parser before schema and
    // typed decoding. Paired arbitrary-precision features are pinned in Cargo.
    let decoded = contracts::decode::<T>(&serde_json::to_vec(original)?)?;
    contracts::validate(&decoded)?;
    let encoded = contracts::encode(&decoded)?;
    assert_eq!(contracts::decode::<T>(&encoded)?, decoded);
    assert_eq!(serde_json::from_slice::<Value>(&encoded)?, *original);
    Ok(decoded)
}

fn exact_retained_numbers() -> Result<()> {
    let geometry_fixture: Value = serde_json::from_slice(include_bytes!(
        "../../packages/contracts/fixtures/optional-geometry.snapshot.json"
    ))?;
    let saved_fixture: Value = serde_json::from_slice(include_bytes!(
        "../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))?;

    let mut geometry = cloned_record(&geometry_fixture, "geometry")?;
    let null_geometry = canonical_roundtrip::<GeometryRecord>(&geometry)?;
    assert!(null_geometry.payload.scale.is_none());
    assert!(null_geometry.payload.transform.is_none());
    geometry["payload"]["scale"] = serde_json::from_str("1e-1000")?;
    geometry["payload"]["transform"] = serde_json::from_str(
        "[9007199254740993,0,0,1,1e-1000,-1e-1000]",
    )?;
    let exact_geometry = canonical_roundtrip::<GeometryRecord>(&geometry)?;
    assert_eq!(
        exact_geometry.payload.scale.as_ref().ok_or("Missing scale")?.as_number().to_string(),
        "1e-1000",
    );
    let transform = exact_geometry.payload.transform.as_ref().ok_or("Missing transform")?;
    assert_eq!(transform.len(), 6);
    assert_eq!(transform[0].as_number().to_string(), "9007199254740993");
    assert_eq!(transform[4].as_number().to_string(), "1e-1000");
    assert_eq!(transform[5].as_number().to_string(), "-1e-1000");

    let mut location = cloned_record(&saved_fixture, "location-semantics")?;
    location["payload"]["semanticKind"] = json!("floor");
    // Existing source IDs/evidence and the explicitly named datum stay intact;
    // this clone supplies no physical placement, access or provider fact.
    for token in ["-1e-1000", "9007199254740993", "0"] {
        location["payload"]["elevation"] = json!({
            "status":"known", "metres":serde_json::from_str::<Value>(token)?,
            "datumAtlasId":id(200)
        });
        let exact_location = canonical_roundtrip::<LocationSemanticsRecord>(&location)?;
        let Optional::Present(LocationElevation::Known(elevation)) = &exact_location.payload.elevation
        else {
            return Err("Missing decoded known elevation".into());
        };
        assert_eq!(elevation.metres.as_number().to_string(), token);
        assert_eq!(elevation.datum_atlas_id, id(200));
    }

    let mut network = saved_fixture["networkRelations"]
        .as_array()
        .and_then(|relations| relations.first())
        .ok_or("Missing published synthetic Network relation")?
        .clone();
    // Canonical retained Network relation revision is unbounded nonnegative
    // integer. Fresh native provider admission remains capped at MAX_SAFE_INTEGER;
    // this typed stored-read example neither calls nor widens that provider.
    network["sourceRevision"] = serde_json::from_str("9007199254740993")?;
    let exact_network = canonical_roundtrip::<NetworkRelation>(&network)?;
    assert_eq!(
        exact_network.source_revision.as_ref().ok_or("Missing Network revision")?.as_number().to_string(),
        "9007199254740993",
    );
    network["sourceRevision"] = Value::Null;
    assert!(canonical_roundtrip::<NetworkRelation>(&network)?.source_revision.is_none());
    Ok(())
}

fn empty_archive_census() -> Result<()> {
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-exact-read-")
        .tempdir_in("/tmp")?;
    // Only this previously absent private synthetic store is created. The
    // snapshot checks its actual sidecar/archive leases and catalogue census.
    // Darwin's /tmp is a symlink; the owner requires its original parent to be
    // canonical. Keep the TempDir handle for cleanup of this same fresh tree.
    let canonical_directory = std::fs::canonicalize(scratch.path())?;
    let sidecar = SqliteNetworkSidecar::open(&canonical_directory.join("network.sqlite"), &[])?;
    let census = sidecar.archive_custody_snapshot()?;
    assert_eq!(census.permanent_id_count, 0);
    assert_eq!(census.remaining_id_slots, MAX_ARCHIVE_ENTRIES);
    assert_eq!(census.sealed_segment_bytes, 0);
    assert_eq!(census.active_reservation_count, 0);
    assert_eq!(census.active_reservation_bytes, 0);
    assert_eq!(census.remaining_byte_capacity, MAX_RETAINED_SEGMENT_BYTES);
    assert!(census.references.is_empty());
    sidecar.close()?;
    // Dispose solely the fresh synthetic directory after native owners close.
    scratch.close()?;
    Ok(())
}

fn main() -> Result<()> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    pinned_contracts()?;
    exact_retained_numbers()?;
    empty_archive_census()?;
    println!("PASS synthetic native exact read contracts: opaque v4 and UUID v3, canonical retained numeric tokens, fresh empty archive census; no provider or populated archive operation");
    Ok(())
}
