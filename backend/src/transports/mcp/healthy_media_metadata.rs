//! Real native metadata over the existing missing-original fixture ingress.
//! No byte availability, transfer, renderer, accepted mapping or placement proof.

use super::{
    Client, command, guard, id,
    identity::Fixture,
    infrastructure::{committed, get, history, list},
    target,
};
use crate::{
    app::RequestPrincipal,
    config::FixtureProfile,
    contracts,
    contracts::stock as wire,
    lifecycle::Failure,
    storage,
    transports::mcp::{LocalAtlasSession, lifecycle::AuthenticatedIdentity},
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

const EVIDENCE: u32 = 17101;
const LOCATION: u32 = 17201;

fn retained_asset(client: &Client<'_>) -> Result<storage::Record, Failure> {
    // Actual AT11 issuance and native read authority; no raw SQL or fake record.
    let current = AuthenticatedIdentity::authenticate_post(
        Arc::clone(&client.core.access),
        &client.evidence(),
        client.scope,
    )?;
    let principal = RequestPrincipal::new(current.original().clone());
    let scope = serde_json::from_value(serde_json::to_value(&client.core.home.scope)?)?;
    let reference = storage::RecordRef {
        record_type: storage::RecordType::Asset,
        record_id: id(600),
    };
    let record = client
        .core
        .store
        .lock()
        .map_err(|_| "Store unavailable")?
        .read_record(&principal, &scope, &reference)?;
    let access = client
        .core
        .access
        .lock()
        .map_err(|_| "Access unavailable")?;
    principal.release(&access)?;
    Ok(record)
}

fn public_asset(record: &storage::Record) -> Value {
    let mut payload = record.payload.clone();
    assert!(
        payload
            .as_object_mut()
            .unwrap()
            .remove("storageKey")
            .is_some()
    );
    json!({"target":target("asset",600),"revision":record.revision,
        "lifecycle":record.lifecycle,"payload":payload})
}

fn record_digest(record: &storage::Record) -> Result<String, Failure> {
    let frozen: contracts::AtlasRecord = serde_json::from_value(serde_json::to_value(record)?)?;
    Ok(contracts::semantics::record_digest(&frozen)?)
}

async fn evidence(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
) -> Value {
    let payload = json!({"statement":"Synthetic metadata basis α",
        "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
            "evidenceBasis":"unknown","factAt":null,"retrievedAt":"2026-01-01T12:00:00Z",
            "vantage":null,"uncertainty":{"status":"unknown","explanation":null}},
        "supersedesEvidenceIds":[],"references":[]});
    let intent = command(
        context,
        "atlas.evidence.create",
        target("evidence", EVIDENCE),
        payload.clone(),
        None,
        vec![],
        1200,
    );
    let outcome = client.call(session, &intent).await;
    committed(&outcome, &intent, 1, "active", &payload)
}

#[test]
fn healthy_native_geometry_metadata_pages_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(geometry())
}

async fn geometry() -> Result<(), Failure> {
    let fixture = Fixture::with_profile(FixtureProfile::GeometryMetadata)?;
    let context = fixture.context.clone();
    let selection = ("geometry", "00000000-0000-4000-8000-0000000181");
    let (expected, steps, before_history, basis, location, original) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let original = retained_asset(&client)?;
        assert_eq!(original.payload["availability"], "missing");
        assert_eq!(original.payload["previewPolicy"], "blocked");
        get(
            &client,
            &mut session,
            &context,
            &public_asset(&original),
            18000,
        )
        .await;
        let basis = evidence(&client, &mut session, &context).await;
        let location_payload = json!({"kind":"location","evidenceIds":[id(EVIDENCE)]});
        let location_intent = command(
            &context,
            "atlas.identity.create",
            target("identity", LOCATION),
            location_payload.clone(),
            None,
            vec![guard("evidence", EVIDENCE)],
            1210,
        );
        let location_outcome = client.call(&mut session, &location_intent).await;
        let location = committed(
            &location_outcome,
            &location_intent,
            1,
            "active",
            &location_payload,
        );
        let mut records = Vec::new();
        let mut steps = Vec::new();
        for (index, record_id) in [18103, 18101, 18102].into_iter().enumerate() {
            let mappings = if record_id == 18102 {
                json!([{"producerRoomId":"Synthetic proposed room α","atlasId":id(LOCATION),
                    "homeboxEntity":null,"reviewStatus":"proposed","evidenceIds":[id(EVIDENCE)]}])
            } else {
                json!([])
            };
            let payload = json!({"producer":"magicplan","producerVersion":null,
                "exportFormat":"synthetic-metadata-unselected α","originalAssetId":id(600),
                "coordinateUnits":"unknown","scale":null,"transform":null,"geometryVersion":1,
                "previousGeometryId":null,"mappings":mappings,"evidenceIds":[id(EVIDENCE)]});
            assert!(payload.get("importedAt").is_none());
            let mut guards = vec![guard("asset", 600), guard("evidence", EVIDENCE)];
            if record_id == 18102 {
                guards.push(guard("identity", LOCATION));
            }
            let intent = command(
                &context,
                "atlas.geometry.create",
                target("geometry", record_id),
                payload.clone(),
                None,
                guards,
                1220 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            let imported = outcome["data"]["records"][0]["payload"]["importedAt"].clone();
            crate::domain::stock::operational_time(
                imported.as_str().ok_or("Missing owner import time")?,
            )?;
            let mut expected = payload;
            expected["importedAt"] = imported;
            records.push(committed(&outcome, &intent, 1, "active", &expected));
            if record_id == 18102 {
                steps.push((intent, outcome));
            }
        }
        records.sort_by(|left, right| {
            left["target"]["recordId"]
                .as_str()
                .cmp(&right["target"]["recordId"].as_str())
        });
        assert_eq!(
            records
                .iter()
                .map(|r| r["target"]["recordId"].clone())
                .collect::<Vec<_>>(),
            vec![json!(id(18101)), json!(id(18102)), json!(id(18103))]
        );
        get(&client, &mut session, &context, &records[1], 18010).await;
        list(
            &client,
            &mut session,
            &context,
            selection,
            &records,
            false,
            18020,
        )
        .await?;
        let retained_payload = records[1]["payload"].clone();
        for (index, operation, revision, lifecycle) in [
            (0, "tombstone", 2, "tombstoned"),
            (1, "restore", 3, "active"),
        ] {
            let intent = command(
                &context,
                &format!("atlas.geometry.{operation}"),
                target("geometry", 18102),
                json!({}),
                Some(revision - 1),
                vec![
                    guard("asset", 600),
                    guard("evidence", EVIDENCE),
                    guard("identity", LOCATION),
                ],
                1230 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            records[1] = committed(&outcome, &intent, revision, lifecycle, &retained_payload);
            get(&client, &mut session, &context, &records[1], 18030 + index).await;
            let active = if operation == "tombstone" {
                vec![records[0].clone(), records[2].clone()]
            } else {
                records.clone()
            };
            list(
                &client,
                &mut session,
                &context,
                selection,
                &active,
                false,
                18100 + 10 * index,
            )
            .await?;
            list(
                &client,
                &mut session,
                &context,
                selection,
                &records,
                true,
                18200 + 10 * index,
            )
            .await?;
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 18300).await?;
        assert_eq!(retained_asset(&client)?, original);
        session.close();
        (records, steps, before_history, basis, location, original)
    };
    let fixture = fixture.reopen()?;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        assert_eq!(
            list(
                &client,
                &mut session,
                &context,
                selection,
                &expected,
                false,
                18400
            )
            .await?,
            expected
        );
        list(
            &client,
            &mut session,
            &context,
            selection,
            &expected,
            true,
            18410,
        )
        .await?;
        for (index, record) in expected.iter().chain([&basis, &location]).enumerate() {
            get(
                &client,
                &mut session,
                &context,
                record,
                18500 + index as u32,
            )
            .await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 18600).await?,
            before_history
        );
        assert_eq!(retained_asset(&client)?, original);
        session.close();
    }
    drop(fixture);
    Ok(())
}

async fn asset_list(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: Option<&Value>,
    include_archived: bool,
    request_id: u32,
) {
    let request = json!({"schemaVersion":3,"commandId":"atlas.asset.list","requestId":id(request_id),
        "context":context,"target":{"authority":"atlas","recordType":"asset"},
        "payload":{"pageSize":1,"cursor":null,"includeArchived":include_archived,"q":id(600)}});
    let result = client.call(session, &request).await;
    assert_eq!(result["status"], "read");
    assert_eq!(result["data"]["sourceStatus"], "current");
    assert_eq!(
        result["data"]["records"],
        json!(expected.into_iter().collect::<Vec<_>>())
    );
    assert_eq!(result["data"]["nextCursor"], Value::Null);
    for record in result["data"]["records"].as_array().unwrap() {
        assert!(record["payload"].get("storageKey").is_none());
    }
}

async fn asset_history(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    seed: &storage::Record,
    steps: &[(Value, Value, storage::Record)],
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.asset.history",
        "requestId":id(first_request_id),"context":context,"target":target("asset",600),
        "payload":{"pageSize":1,"cursor":null,"includeArchived":false,"q":"atlas.asset."}});
    let validation = wire::StockValidation::new()?;
    let mut entries: Vec<Value> = Vec::new();
    let mut cursors = BTreeSet::new();
    // Bootstrap has no audit prehistory despite revision 1 and lastAuditId.
    if steps.is_empty() {
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["completeness"], "atlas-owned-audit");
        assert_eq!(result["data"]["entries"], json!([]));
        assert_eq!(result["data"]["nextCursor"], Value::Null);
        return Ok(entries);
    }
    for (index, (intent, outcome, record)) in steps.iter().enumerate() {
        request["requestId"] = json!(id(first_request_id + index as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["completeness"], "atlas-owned-audit");
        let page = result["data"]["entries"]
            .as_array()
            .ok_or("Missing actual asset history")?;
        assert_eq!(page.len(), 1);
        let entry = &page[0];
        let parsed = wire::StockRequest::parse(&validation, intent.clone())?;
        assert_eq!(entry["eventId"], outcome["data"]["auditIds"][0]);
        assert_eq!(entry["eventId"], record.last_audit_id);
        assert_ne!(entry["eventId"], seed.last_audit_id);
        assert_eq!(entry["commandId"], intent["commandId"]);
        assert_eq!(entry["requestDigest"], parsed.intent_digest());
        assert_eq!(entry["actorId"], id(7));
        assert_eq!(entry["target"], intent["target"]);
        assert_eq!(entry["state"], "committed");
        let before = if index == 0 {
            record_digest(seed)?
        } else {
            record_digest(&steps[index - 1].2)?
        };
        assert_eq!(entry["beforeDigest"], before);
        assert!(!entry["beforeDigest"].is_null());
        assert_eq!(entry["afterDigest"], record_digest(record)?);
        if index > 0 {
            assert_eq!(entry["beforeDigest"], entries[index - 1]["afterDigest"]);
        }
        entries.push(entry.clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < steps.len() {
            let cursor = next
                .as_str()
                .ok_or("Actual asset history cursor required")?;
            assert!(!cursor.is_empty());
            assert!(cursors.insert(cursor.to_owned()));
            request["payload"]["cursor"] = next.clone();
        } else {
            assert_eq!(next, &Value::Null);
        }
    }
    Ok(entries)
}

#[test]
fn healthy_native_missing_asset_metadata_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(asset())
}

async fn asset() -> Result<(), Failure> {
    let fixture = Fixture::with_profile(FixtureProfile::GeometryMetadata)?;
    let context = fixture.context.clone();
    let (seed, expected, steps, before_history, basis) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let seed = retained_asset(&client)?;
        let ingress = crate::lifecycle::fixture_with_profile(FixtureProfile::GeometryMetadata)?;
        let seeded = ingress["records"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["recordId"] == id(600))
            .unwrap();
        assert_eq!(serde_json::to_value(&seed)?, *seeded);
        assert_eq!(seed.revision, 1);
        assert_eq!(seed.payload["availability"], "missing");
        assert_eq!(seed.payload["previewPolicy"], "blocked");
        let initial = public_asset(&seed);
        get(&client, &mut session, &context, &initial, 19000).await;
        asset_list(
            &client,
            &mut session,
            &context,
            Some(&initial),
            false,
            19001,
        )
        .await;
        asset_list(&client, &mut session, &context, Some(&initial), true, 19002).await;
        assert!(
            asset_history(&client, &mut session, &context, &seed, &[], 19010)
                .await?
                .is_empty()
        );
        let basis = evidence(&client, &mut session, &context).await;
        let mut expected_payload = initial["payload"].clone();
        expected_payload["previewPolicy"] = json!("download-only");
        expected_payload["evidenceIds"] = json!([id(EVIDENCE)]);
        let mut steps = Vec::new();
        let mut expected = initial;
        for (index, operation, revision, lifecycle) in [
            (0, "review", 2, "active"),
            (1, "tombstone", 3, "tombstoned"),
            (2, "restore", 4, "active"),
        ] {
            let (payload, guards) = if operation == "review" {
                (
                    json!({"treatment":"download-only","rendererReceiptId":null,"evidenceIds":[id(EVIDENCE)]}),
                    vec![guard("evidence", 100), guard("evidence", EVIDENCE)],
                )
            } else {
                (json!({}), vec![guard("evidence", EVIDENCE)])
            };
            let intent = command(
                &context,
                &format!("atlas.asset.{operation}"),
                target("asset", 600),
                payload,
                Some(revision - 1),
                guards,
                1240 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            expected = committed(&outcome, &intent, revision, lifecycle, &expected_payload);
            assert!(expected["payload"].get("storageKey").is_none());
            assert_eq!(expected["payload"]["availability"], "missing");
            let raw = retained_asset(&client)?;
            let mut private_expected = seed.payload.clone();
            private_expected["previewPolicy"] = json!("download-only");
            private_expected["evidenceIds"] = json!([id(EVIDENCE)]);
            assert_eq!(raw.payload, private_expected);
            assert_eq!(public_asset(&raw), expected);
            get(&client, &mut session, &context, &expected, 19100 + index).await;
            let active = if operation == "tombstone" {
                None
            } else {
                Some(&expected)
            };
            asset_list(
                &client,
                &mut session,
                &context,
                active,
                false,
                19200 + index,
            )
            .await;
            asset_list(
                &client,
                &mut session,
                &context,
                Some(&expected),
                true,
                19300 + index,
            )
            .await;
            steps.push((intent, outcome, raw));
        }
        let before_history =
            asset_history(&client, &mut session, &context, &seed, &steps, 19400).await?;
        session.close();
        (seed, expected, steps, before_history, basis)
    };
    let fixture = fixture.reopen()?;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        assert_eq!(retained_asset(&client)?, steps.last().unwrap().2);
        get(&client, &mut session, &context, &expected, 19500).await;
        get(&client, &mut session, &context, &basis, 19501).await;
        asset_list(
            &client,
            &mut session,
            &context,
            Some(&expected),
            false,
            19510,
        )
        .await;
        asset_list(
            &client,
            &mut session,
            &context,
            Some(&expected),
            true,
            19511,
        )
        .await;
        assert_eq!(
            asset_history(&client, &mut session, &context, &seed, &steps, 19600).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
