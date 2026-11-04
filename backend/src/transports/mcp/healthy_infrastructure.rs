//! Fictional stored descriptors over real Access/StockService/SQLite owners.
//! No physical device control, relation inference or provider operation.

use super::{Client, command, guard, id, identity::Fixture, target};
use crate::{contracts::stock as wire, lifecycle::Failure, transports::mcp::LocalAtlasSession};
use serde_json::{Value, json};
use std::collections::BTreeSet;

struct Scenario {
    kind: &'static str,
    first_id: u32,
    query: &'static str,
    initial: Value,
    replacement: Value,
    panel: bool,
}

fn committed(
    outcome: &Value,
    intent: &Value,
    revision: u64,
    lifecycle: &str,
    payload: &Value,
) -> Value {
    assert_eq!(outcome["status"], "committed");
    assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
    let expected = json!({"target":intent["target"],"revision":revision,
        "lifecycle":lifecycle,"payload":payload});
    assert_eq!(outcome["data"]["records"], json!([expected]));
    expected
}

async fn get(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &Value,
    request_id: u32,
) {
    let kind = expected["target"]["recordType"].as_str().unwrap();
    let request = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.get"),
        "requestId":id(request_id),"context":context,
        "target":expected["target"],"payload":{}});
    let result = client.call(session, &request).await;
    assert_eq!(result["status"], "read");
    assert_eq!(result["data"]["records"], json!([expected]));
    assert_eq!(result["data"]["sourceStatus"], "current");
    assert_eq!(result["data"]["nextCursor"], Value::Null);
}

async fn list(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    scenario: &Scenario,
    expected: &[Value],
    include_archived: bool,
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,
        "commandId":format!("atlas.{}.list",scenario.kind),
        "requestId":id(first_request_id),"context":context,
        "target":{"authority":"atlas","recordType":scenario.kind},
        "payload":{"pageSize":1,"cursor":null,"includeArchived":include_archived,
            "q":scenario.query}});
    let mut seen = Vec::new();
    let mut cursors = BTreeSet::new();
    for (index, record) in expected.iter().enumerate() {
        request["requestId"] = json!(id(first_request_id + index as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["sourceStatus"], "current");
        assert_eq!(result["data"]["records"], json!([record]));
        seen.push(result["data"]["records"][0].clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < expected.len() {
            let cursor = next
                .as_str()
                .ok_or("Native descriptor list cursor required")?;
            assert!(!cursor.is_empty());
            assert!(cursors.insert(cursor.to_owned()));
            request["payload"]["cursor"] = next.clone();
        } else {
            assert_eq!(next, &Value::Null);
        }
    }
    assert_eq!(seen.as_slice(), expected);
    Ok(seen)
}

async fn history(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    steps: &[(Value, Value)],
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let kind = steps[0].0["target"]["recordType"].as_str().unwrap();
    let mut request = json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.history"),
        "requestId":id(first_request_id),"context":context,
        "target":steps[0].0["target"],
        "payload":{"pageSize":1,"cursor":null,"includeArchived":false,
            "q":format!("atlas.{kind}.")}});
    let validation = wire::StockValidation::new()?;
    let mut entries: Vec<Value> = Vec::new();
    let mut cursors = BTreeSet::new();
    for (index, (intent, outcome)) in steps.iter().enumerate() {
        request["requestId"] = json!(id(first_request_id + index as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["completeness"], "atlas-owned-audit");
        let page = result["data"]["entries"]
            .as_array()
            .ok_or("Missing native descriptor history")?;
        assert_eq!(page.len(), 1);
        let entry = &page[0];
        let parsed = wire::StockRequest::parse(&validation, intent.clone())?;
        assert_eq!(entry["eventId"], outcome["data"]["auditIds"][0]);
        assert_eq!(entry["commandId"], intent["commandId"]);
        assert_eq!(entry["requestDigest"], parsed.intent_digest());
        assert_eq!(entry["actorId"], id(7));
        assert_eq!(entry["target"], intent["target"]);
        assert_eq!(entry["state"], "committed");
        assert!(entry.get("beforeDigest").is_some());
        if index == 0 {
            assert_eq!(entry["beforeDigest"], Value::Null);
            assert_eq!(intent["preconditions"]["target"], Value::Null);
        } else {
            assert_eq!(entry["beforeDigest"], entries[index - 1]["afterDigest"]);
        }
        assert_eq!(entry["afterDigest"].as_str().unwrap().len(), 64);
        assert_eq!(intent["approvalReceiptId"], Value::Null);
        entries.push(entry.clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < steps.len() {
            let cursor = next
                .as_str()
                .ok_or("Native descriptor history cursor required")?;
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
fn healthy_native_valve_lifecycle_lists_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy(Scenario {
            kind: "valve",
            first_id: 5101,
            query: "00000000-0000-4000-8000-0000000051",
            initial: json!({"label":null,"medium":"unknown","evidenceIds":[id(7101)]}),
            replacement: json!({"label":"Synthetic valve descriptor α 水",
                "medium":"water","evidenceIds":[id(7102)]}),
            panel: false,
        }))
}

#[test]
fn healthy_native_circuit_lifecycle_lists_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy(Scenario {
            kind: "circuit",
            first_id: 6101,
            query: "00000000-0000-4000-8000-0000000061",
            initial: json!({"label":null,"panel":null,"evidenceIds":[id(7101)]}),
            replacement: json!({"label":"Synthetic circuit descriptor α 電",
                "panel":{"kind":"atlas-record","ref":{"recordType":"identity",
                    "recordId":id(7201)}},"evidenceIds":[id(7102)]}),
            panel: true,
        }))
}

async fn healthy(scenario: Scenario) -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let context = fixture.context.clone();
    let (expected, steps, before_history, dependencies) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let mut dependencies = Vec::new();
        // Actual evidence owners, never a fabricated dependency or result.
        for (index, evidence_id) in [7101, 7102].into_iter().enumerate() {
            let payload = json!({"statement":format!("Synthetic descriptor basis {evidence_id} α"),
                "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
                    "evidenceBasis":"unknown","factAt":null,
                    "retrievedAt":"2026-01-01T12:00:00Z","vantage":null,
                    "uncertainty":{"status":"unknown","explanation":null}},
                "supersedesEvidenceIds":[],"references":[]});
            let intent = command(
                &context,
                "atlas.evidence.create",
                target("evidence", evidence_id),
                payload.clone(),
                None,
                vec![],
                800 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            dependencies.push(committed(&outcome, &intent, 1, "active", &payload));
        }
        if scenario.panel {
            let payload = json!({"kind":"item","evidenceIds":[id(7101)]});
            let intent = command(
                &context,
                "atlas.identity.create",
                target("identity", 7201),
                payload.clone(),
                None,
                vec![guard("evidence", 7101)],
                810,
            );
            let outcome = client.call(&mut session, &intent).await;
            dependencies.push(committed(&outcome, &intent, 1, "active", &payload));
        }
        let mut records = Vec::new();
        let mut steps = Vec::new();
        for (index, record_id) in [
            scenario.first_id + 2,
            scenario.first_id,
            scenario.first_id + 1,
        ]
        .into_iter()
        .enumerate()
        {
            let intent = command(
                &context,
                &format!("atlas.{}.create", scenario.kind),
                target(scenario.kind, record_id),
                scenario.initial.clone(),
                None,
                vec![guard("evidence", 7101)],
                820 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            records.push(committed(&outcome, &intent, 1, "active", &scenario.initial));
            if record_id == scenario.first_id + 1 {
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
            (0..3)
                .map(|offset| json!(id(scenario.first_id + offset)))
                .collect::<Vec<_>>()
        );
        get(&client, &mut session, &context, &records[1], 12000).await;
        list(
            &client,
            &mut session,
            &context,
            &scenario,
            &records,
            false,
            12010,
        )
        .await?;
        for (index, operation, revision, lifecycle) in [
            (0, "replace", 2, "active"),
            (1, "tombstone", 3, "tombstoned"),
            (2, "restore", 4, "active"),
        ] {
            // Replacement guards cover both old and new evidence references.
            // Later transitions cover the retained replacement and panel only.
            let mut guards = vec![guard("evidence", 7102)];
            if operation == "replace" {
                guards.push(guard("evidence", 7101));
            }
            if scenario.panel {
                guards.push(guard("identity", 7201));
            }
            let payload = if operation == "replace" {
                scenario.replacement.clone()
            } else {
                json!({})
            };
            let intent = command(
                &context,
                &format!("atlas.{}.{operation}", scenario.kind),
                target(scenario.kind, scenario.first_id + 1),
                payload,
                Some(revision - 1),
                guards,
                830 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            records[1] = committed(&outcome, &intent, revision, lifecycle, &scenario.replacement);
            get(&client, &mut session, &context, &records[1], 12020 + index).await;
            let active = if operation == "tombstone" {
                vec![records[0].clone(), records[2].clone()]
            } else {
                records.clone()
            };
            list(
                &client,
                &mut session,
                &context,
                &scenario,
                &active,
                false,
                12100 + 10 * index,
            )
            .await?;
            list(
                &client,
                &mut session,
                &context,
                &scenario,
                &records,
                true,
                12200 + 10 * index,
            )
            .await?;
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 12300).await?;
        session.close();
        (records, steps, before_history, dependencies)
    };
    // Strict SQLite reopen only; actual Access is retained, fresh cursor chains.
    let fixture = fixture.reopen()?;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        assert_eq!(
            list(
                &client,
                &mut session,
                &context,
                &scenario,
                &expected,
                false,
                12400,
            )
            .await?,
            expected
        );
        list(
            &client,
            &mut session,
            &context,
            &scenario,
            &expected,
            true,
            12410,
        )
        .await?;
        for (index, record) in expected.iter().chain(&dependencies).enumerate() {
            get(&client, &mut session, &context, record, 12500 + index as u32).await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 12600).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
