//! Unresolved bindings and retained synthetic correction journals only.
//! No source presence, provider contact, remap invocation or external adoption.

use super::{
    Client, command, guard, id,
    identity::Fixture,
    infrastructure::{committed, get, history, list},
    target,
};
use crate::{lifecycle::Failure, transports::mcp::LocalAtlasSession};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const EVIDENCE_A: u32 = 11101;
const EVIDENCE_B: u32 = 11102;
const IDENTITY: u32 = 11201;

#[derive(Clone, Copy)]
enum Family {
    Binding,
    Reconciliation,
}

fn current_guard(record: &Value) -> Value {
    json!({"target":record["target"],
        "revision":{"kind":"atlas","value":record["revision"]}})
}

async fn dependencies(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
) -> Vec<Value> {
    let mut records = Vec::new();
    for (index, evidence_id) in [EVIDENCE_A, EVIDENCE_B].into_iter().enumerate() {
        let payload = json!({"statement":format!("Synthetic correction basis {evidence_id} α"),
            "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,
                "evidenceBasis":"unknown","factAt":null,
                "retrievedAt":"2026-01-01T12:00:00Z","vantage":null,
                "uncertainty":{"status":"unknown","explanation":null}},
            "supersedesEvidenceIds":[],"references":[]});
        let intent = command(
            context,
            "atlas.evidence.create",
            target("evidence", evidence_id),
            payload.clone(),
            None,
            vec![],
            1000 + index as u32,
        );
        let outcome = client.call(session, &intent).await;
        committed(&outcome, &intent, 1, "active", &payload);
        records.push(outcome["data"]["records"][0].clone());
    }
    let payload = json!({"kind":"item","evidenceIds":[id(EVIDENCE_A)]});
    let intent = command(
        context,
        "atlas.identity.create",
        target("identity", IDENTITY),
        payload.clone(),
        None,
        vec![guard("evidence", EVIDENCE_A)],
        1010,
    );
    let outcome = client.call(session, &intent).await;
    committed(&outcome, &intent, 1, "active", &payload);
    records.push(outcome["data"]["records"][0].clone());
    records
}

async fn create_binding(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    record_id: u32,
    serial: u32,
) -> (Value, Value) {
    let payload = json!({"atlasId":id(IDENTITY),
        "source":{"sourceInstanceId":id(10),"collectionId":"synthetic-collection-a",
            "sourceKind":"homebox-entity","externalId":id(record_id + 20000)},
        "reviewStatus":"proposed","evidenceIds":[id(EVIDENCE_A)]});
    // Existing fictional exclusive-home source configuration; no provider call.
    // The client cannot supply the derived sourceState.
    assert!(payload.get("sourceState").is_none());
    let intent = command(
        context,
        "atlas.binding.create",
        target("binding", record_id),
        payload.clone(),
        None,
        vec![guard("identity", IDENTITY), guard("evidence", EVIDENCE_A)],
        serial,
    );
    let outcome = client.call(session, &intent).await;
    let mut expected = payload;
    expected["sourceState"] = json!("unresolved");
    committed(&outcome, &intent, 1, "active", &expected);
    (intent, outcome)
}

async fn review_binding(
    client: &Client<'_>,
    session: &mut LocalAtlasSession<'_>,
    context: &Value,
    original: &Value,
    status: &str,
    evidence_id: u32,
    serial: u32,
) -> (Value, Value) {
    let mut evidence = BTreeSet::from([id(evidence_id)]);
    for old in original["payload"]["evidenceIds"].as_array().unwrap() {
        evidence.insert(old.as_str().unwrap().to_owned());
    }
    let mut guards = vec![guard("identity", IDENTITY)];
    guards.extend(evidence.into_iter().map(|record_id| {
        json!({"target":{"authority":"atlas","recordType":"evidence","recordId":record_id},
            "revision":{"kind":"atlas","value":1}})
    }));
    let revision = original["revision"].as_u64().unwrap();
    let intent = command(
        context,
        "atlas.binding.review",
        original["target"].clone(),
        json!({"reviewStatus":status,"evidenceIds":[id(evidence_id)]}),
        Some(revision),
        guards,
        serial,
    );
    let outcome = client.call(session, &intent).await;
    let mut expected = original["payload"].clone();
    expected["reviewStatus"] = json!(status);
    expected["evidenceIds"] = json!([id(evidence_id)]);
    assert_eq!(expected["sourceState"], "unresolved");
    committed(&outcome, &intent, revision + 1, "active", &expected);
    (intent, outcome)
}

#[test]
fn healthy_native_unresolved_binding_lifecycle_pages_and_reopen() -> Result<(), Failure> {
    run(Family::Binding)
}

#[test]
fn healthy_native_reconciliation_lifecycle_pages_and_reopen() -> Result<(), Failure> {
    run(Family::Reconciliation)
}

fn run(family: Family) -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy(family))
}

async fn healthy(family: Family) -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let context = fixture.context.clone();
    let (kind, first_id, query) = match family {
        Family::Binding => ("binding", 12101, "00000000-0000-4000-8000-0000000121"),
        Family::Reconciliation => (
            "reconciliation",
            15101,
            "00000000-0000-4000-8000-0000000151",
        ),
    };
    let selection = (kind, query);
    let (expected, steps, before_history, dependencies) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let mut dependencies = dependencies(&client, &mut session, &context).await;
        let mut records = Vec::new();
        let mut steps = Vec::new();
        let mut primary_guards = Vec::new();
        for (index, record_id) in [first_id + 2, first_id, first_id + 1]
            .into_iter()
            .enumerate()
        {
            let (intent, outcome, guards) = match family {
                Family::Binding => {
                    let (intent, outcome) = create_binding(
                        &client,
                        &mut session,
                        &context,
                        record_id,
                        1020 + index as u32,
                    )
                    .await;
                    (
                        intent,
                        outcome,
                        vec![guard("identity", IDENTITY), guard("evidence", EVIDENCE_B)],
                    )
                }
                Family::Reconciliation => {
                    let from_id = 14101 + 2 * index as u32;
                    let to_id = from_id + 1;
                    let mut pair = Vec::new();
                    for (offset, binding_id, status, evidence_id) in [
                        (0, from_id, "retired", EVIDENCE_A),
                        (1, to_id, "accepted", EVIDENCE_B),
                    ] {
                        let (_, created) = create_binding(
                            &client,
                            &mut session,
                            &context,
                            binding_id,
                            1040 + 4 * index as u32 + 2 * offset,
                        )
                        .await;
                        let (_, reviewed) = review_binding(
                            &client,
                            &mut session,
                            &context,
                            &created["data"]["records"][0],
                            status,
                            evidence_id,
                            1041 + 4 * index as u32 + 2 * offset,
                        )
                        .await;
                        let retained = reviewed["data"]["records"][0].clone();
                        assert_eq!(retained["revision"], 2);
                        assert_eq!(retained["payload"]["reviewStatus"], status);
                        assert_eq!(retained["payload"]["sourceState"], "unresolved");
                        pair.push(retained.clone());
                        dependencies.push(retained);
                    }
                    // Distinct, same-identity pairs have no outgoing edge from
                    // any destination: all three correction journals are acyclic.
                    assert_ne!(pair[0]["target"], pair[1]["target"]);
                    let guards = vec![
                        guard("identity", IDENTITY),
                        guard("evidence", EVIDENCE_B),
                        current_guard(&pair[0]),
                        current_guard(&pair[1]),
                    ];
                    let payload = json!({"atlasId":id(IDENTITY),"fromBindingId":id(from_id),
                        "toBindingId":id(to_id),"reason":"reviewed-correction",
                        "evidenceIds":[id(EVIDENCE_B)]});
                    let intent = command(
                        &context,
                        "atlas.reconciliation.create",
                        target(kind, record_id),
                        payload.clone(),
                        None,
                        guards.clone(),
                        1070 + index as u32,
                    );
                    let outcome = client.call(&mut session, &intent).await;
                    committed(&outcome, &intent, 1, "active", &payload);
                    (intent, outcome, guards)
                }
            };
            records.push(outcome["data"]["records"][0].clone());
            if record_id == first_id + 1 {
                primary_guards = guards;
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
                .map(|offset| json!(id(first_id + offset)))
                .collect::<Vec<_>>()
        );
        get(&client, &mut session, &context, &records[1], 16000).await;
        list(
            &client,
            &mut session,
            &context,
            selection,
            &records,
            false,
            16010,
        )
        .await?;
        if let Family::Binding = family {
            let (intent, outcome) = review_binding(
                &client,
                &mut session,
                &context,
                &records[1],
                "rejected",
                EVIDENCE_B,
                1080,
            )
            .await;
            records[1] = outcome["data"]["records"][0].clone();
            get(&client, &mut session, &context, &records[1], 16020).await;
            steps.push((intent, outcome));
        }
        let retained_payload = records[1]["payload"].clone();
        for (index, operation, lifecycle) in
            [(0, "tombstone", "tombstoned"), (1, "restore", "active")]
        {
            let previous_revision = records[1]["revision"].as_u64().unwrap();
            let intent = command(
                &context,
                &format!("atlas.{kind}.{operation}"),
                records[1]["target"].clone(),
                json!({}),
                Some(previous_revision),
                primary_guards.clone(),
                1090 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            committed(
                &outcome,
                &intent,
                previous_revision + 1,
                lifecycle,
                &retained_payload,
            );
            records[1] = outcome["data"]["records"][0].clone();
            get(&client, &mut session, &context, &records[1], 16030 + index).await;
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
                16100 + 10 * index,
            )
            .await?;
            list(
                &client,
                &mut session,
                &context,
                selection,
                &records,
                true,
                16200 + 10 * index,
            )
            .await?;
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 16300).await?;
        session.close();
        (records, steps, before_history, dependencies)
    };
    // Only SQLite is reopened, with retained Access and fresh native cursor chains.
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
                16400,
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
            16410,
        )
        .await?;
        for (index, record) in expected.iter().chain(&dependencies).enumerate() {
            get(
                &client,
                &mut session,
                &context,
                record,
                16500 + index as u32,
            )
            .await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 16600).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
