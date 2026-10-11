//! Positive published presence representations only. No Access issuance,
//! transaction adapter invocation, observation qualification or witness write.
use houseatlas_backend::contracts::{self, stock as wire};
use serde_json::Value;
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let fixture: Value = serde_json::from_slice(include_bytes!(
        "../../contracts/stock/examples/healthy.json"
    ))?;
    let witnesses = fixture["presenceWitnesses"]
        .as_array()
        .ok_or("witness shapes")?;
    let qualifications = fixture["presenceQualifications"]
        .as_array()
        .ok_or("qualification shapes")?;
    assert_eq!(witnesses.len(), 3);
    assert_eq!(qualifications.len(), witnesses.len());
    for (raw, qualification) in witnesses.iter().zip(qualifications) {
        let witness = wire::decode_presence_witness(&serde_json::to_vec(raw)?)?;
        wire::validate_presence_witness(&witness)?;
        let current = wire::decode_presence_qualification(&serde_json::to_vec(qualification)?)?;
        wire::validate_presence_qualification(&current)?;
        assert_eq!(witness.authority, current.authority);
        assert_eq!(
            serde_json::from_slice::<Value>(&wire::encode_presence_witness(&witness)?)?,
            *raw
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&wire::encode_presence_qualification(&current)?)?,
            *qualification
        );
        assert_eq!(
            witness.authority.authority_context_version,
            wire::PresenceAuthorityContextVersion::V1
        );
        assert!(witness.authority.source_registration_sha256.len() == 64);
        match &witness.observation {
            wire::PresenceObservation::HomeboxEntity {
                source_updated_at, ..
            } => {
                assert_eq!(source_updated_at, &None);
                assert_eq!(raw["observation"]["sourceUpdatedAt"], Value::Null);
            }
            wire::PresenceObservation::NetworkInventory {
                source_snapshot_at, ..
            } => {
                assert_eq!(source_snapshot_at, &None);
                assert_eq!(raw["observation"]["sourceSnapshotAt"], Value::Null);
            }
        }
        // Accepted integral decimal/exponent spellings keep exact wire tokens.
        for token in ["1.0", "1e0"] {
            let mut numeric = raw.clone();
            numeric["bindingRevision"] = serde_json::from_str(token)?;
            numeric["authority"]["sourceRegistrationVersion"] = serde_json::from_str(token)?;
            let decoded = wire::decode_presence_witness(&serde_json::to_vec(&numeric)?)?;
            assert_eq!(
                serde_json::from_slice::<Value>(&wire::encode_presence_witness(&decoded)?)?,
                numeric
            );
        }
    }
    let full_registration = serde_json::json!({
        "workspaceId":"00000000-0000-4000-8000-000000000001",
        "homeId":"00000000-0000-4000-8000-000000000002",
        "sourceInstanceId":"00000000-0000-4000-8000-000000000003",
        "collectionId":"synthetic / α + %", "owner":"homebox",
        "partitionMode":"reviewed-entity-allowlist", "allowedExternalIds":[]
    });
    let registration: houseatlas_backend::storage::SourceRegistration =
        serde_json::from_value(full_registration.clone())?;
    assert_eq!(serde_json::to_value(&registration)?, full_registration);
    let digest = contracts::semantics::canonical_digest(&full_registration)?;
    assert_eq!(
        digest,
        "2d92148dcf74a36d62902921c90ba7823615f3e3f76e298e4ccec919b15800ad"
    );
    println!(
        "PASS 3 published presence representation pairs, 6 accepted numeric carriers, explicit native null dates and full-registration canonical digest; metadata peers are synthetic; no adapter/admission/retention/schema execution"
    );
    Ok(())
}
