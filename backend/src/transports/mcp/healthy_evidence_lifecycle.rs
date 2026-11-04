//! Positive retirement/restoration of unreferenced fictional evidence.
//! Reuses real Access/StockService/SQLite; no replacement or media operation.

use super::{Client, command, id, identity::Fixture, target};
use crate::{contracts::stock as wire, lifecycle::Failure, transports::mcp::LocalAtlasSession};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const QUERY: &str = "Synthetic MCP evidence lifecycle";

fn committed(
    outcome: &Value,
    intent: &Value,
    revision: u64,
    lifecycle: &str,
    payload: &Value,
) -> Value {
    assert_eq!(outcome["status"], "committed");
    assert_eq!(outcome["data"]["auditIds"].as_array().unwrap().len(), 1);
    let record = json!({"target":intent["target"],"revision":revision,
        "lifecycle":lifecycle,"payload":payload});
    assert_eq!(outcome["data"]["records"], json!([record]));
    record
}

async fn get(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &Value,
    request_id: u32,
) {
    let request = json!({"schemaVersion":3,"commandId":"atlas.evidence.get",
        "requestId":id(request_id),"context":context,
        "target":expected["target"],"payload":{}});
    let result = client.call(session, &request).await;
    assert_eq!(result["status"], "read");
    // Full canonical equality includes every explicit unknown/null payload key.
    assert_eq!(result["data"]["records"], json!([expected]));
    assert_eq!(result["data"]["sourceStatus"], "current");
    assert_eq!(result["data"]["nextCursor"], Value::Null);
}

async fn list(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    expected: &[Value],
    include_archived: bool,
    first_request_id: u32,
) -> Result<Vec<Value>, Failure> {
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.evidence.list",
        "requestId":id(first_request_id),"context":context,
        "target":{"authority":"atlas","recordType":"evidence"},
        "payload":{"pageSize":2,"cursor":null,"includeArchived":include_archived,
            "q":QUERY}});
    let mut seen = Vec::new();
    let mut cursors = BTreeSet::new();
    for (page, records) in expected.chunks(2).enumerate() {
        request["requestId"] = json!(id(first_request_id + page as u32));
        let result = client.call(session, &request).await;
        assert_eq!(result["status"], "read");
        assert_eq!(result["data"]["sourceStatus"], "current");
        assert_eq!(result["data"]["records"], json!(records));
        let returned = result["data"]["records"].as_array().unwrap();
        seen.extend(returned.iter().cloned());
        let next = &result["data"]["nextCursor"];
        if (page + 1) * 2 < expected.len() {
            let cursor = next
                .as_str()
                .ok_or("Native evidence list continuation required")?;
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
    let mut request = json!({"schemaVersion":3,"commandId":"atlas.evidence.history",
        "requestId":id(first_request_id),"context":context,
        "target":target("evidence",4102),
        "payload":{"pageSize":1,"cursor":null,"includeArchived":false,
            "q":"atlas.evidence."}});
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
            .ok_or("Missing native evidence lifecycle history")?;
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
        } else {
            assert_eq!(entry["beforeDigest"], entries[index - 1]["afterDigest"]);
        }
        assert_eq!(entry["afterDigest"].as_str().unwrap().len(), 64);
        entries.push(entry.clone());
        let next = &result["data"]["nextCursor"];
        if index + 1 < steps.len() {
            let cursor = next
                .as_str()
                .ok_or("Native evidence history continuation required")?;
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
fn healthy_native_evidence_tombstone_restore_pages_history_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy())
}

async fn healthy() -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let context = fixture.context.clone();
    let (expected, steps, before_history) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let mut records = Vec::new();
        let mut steps = Vec::new();
        // No other record refers to these new fictional evidence IDs. Empty
        // references/supersedes and null source require no dependency guards.
        for (index, record_id) in [4103, 4101, 4102].into_iter().enumerate() {
            let payload = json!({"statement":format!(
                    "Synthetic MCP evidence lifecycle {record_id} α"),
                "provenance":{"source":null,"sourceRevision":null,
                    "sourceConfidence":null,"evidenceBasis":"unknown","factAt":null,
                    "retrievedAt":"2026-01-01T12:00:00Z","vantage":null,
                    "uncertainty":{"status":"unknown","explanation":null}},
                "supersedesEvidenceIds":[],"references":[]});
            let intent = command(
                &context,
                "atlas.evidence.create",
                target("evidence", record_id),
                payload.clone(),
                None,
                vec![],
                700 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            records.push(committed(&outcome, &intent, 1, "active", &payload));
            if record_id == 4102 {
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
            vec![json!(id(4101)), json!(id(4102)), json!(id(4103))]
        );
        get(&client, &mut session, &context, &records[1], 9000).await;
        list(&client, &mut session, &context, &records, false, 9010).await?;
        let original_payload = records[1]["payload"].clone();
        // These admitted commands have empty payloads: append-only evidence
        // content is retained, never replaced. Target CAS remains mandatory.
        for (index, operation, revision, lifecycle) in [
            (0, "tombstone", 2, "tombstoned"),
            (1, "restore", 3, "active"),
        ] {
            let intent = command(
                &context,
                &format!("atlas.evidence.{operation}"),
                target("evidence", 4102),
                json!({}),
                Some(revision - 1),
                vec![],
                710 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            records[1] = committed(&outcome, &intent, revision, lifecycle, &original_payload);
            get(&client, &mut session, &context, &records[1], 9020 + index).await;
            let active = if operation == "tombstone" {
                vec![records[0].clone(), records[2].clone()]
            } else {
                records.clone()
            };
            list(
                &client,
                &mut session,
                &context,
                &active,
                false,
                9030 + 10 * index,
            )
            .await?;
            list(
                &client,
                &mut session,
                &context,
                &records,
                true,
                9050 + 10 * index,
            )
            .await?;
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 9100).await?;
        session.close();
        (records, steps, before_history)
    };
    // Reopen only SQLite, retaining actual Access; begin fresh cursor chains.
    let fixture = fixture.reopen()?;
    {
        let client = fixture.client();
        let mut session = client.open().await;
        assert_eq!(
            list(&client, &mut session, &context, &expected, false, 9200).await?,
            expected
        );
        list(&client, &mut session, &context, &expected, true, 9210).await?;
        for (index, record) in expected.iter().enumerate() {
            get(&client, &mut session, &context, record, 9220 + index as u32).await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 9300).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
