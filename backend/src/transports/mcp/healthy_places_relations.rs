//! Proposed place semantics and uncertain documented native connections only.
//! No accepted place, membership/access relation, topology or provider claims.

use super::{
    command, guard, id,
    identity::Fixture,
    infrastructure::{committed, get, history, list},
    target,
};
use crate::lifecycle::Failure;
use serde_json::{Value, json};

struct Scenario {
    kind: &'static str,
    identity_kind: &'static str,
    identity_ids: &'static [u32],
    first_id: u32,
    query: &'static str,
    initial: Value,
    replacement: Value,
    initial_guards: Vec<Value>,
    replace_guards: Vec<Value>,
    retained_guards: Vec<Value>,
}

fn endpoint(record_id: u32) -> Value {
    json!({"kind":"atlas-record","ref":{"recordType":"identity","recordId":id(record_id)}})
}

#[test]
fn healthy_native_location_semantics_lifecycle_pages_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy(Scenario {
            kind: "location-semantics",
            identity_kind: "location",
            identity_ids: &[8201, 8202],
            first_id: 9101,
            query: "00000000-0000-4000-8000-0000000091",
            // Optional label/elevation are omitted, never invented as null.
            initial: json!({"atlasId":id(8201),"semanticKind":"unclassified",
                "reviewStatus":"proposed","evidenceIds":[id(8101)]}),
            replacement: json!({"atlasId":id(8202),"semanticKind":"floor",
                "reviewStatus":"proposed","label":"Synthetic proposed floor α 階",
                "elevation":{"status":"unknown"},"evidenceIds":[id(8102)]}),
            initial_guards: vec![guard("evidence", 8101), guard("identity", 8201)],
            replace_guards: vec![
                guard("evidence", 8101),
                guard("evidence", 8102),
                guard("identity", 8201),
                guard("identity", 8202),
            ],
            retained_guards: vec![guard("evidence", 8102), guard("identity", 8202)],
        }))
}

#[test]
fn healthy_native_documented_relation_lifecycle_pages_and_reopen() -> Result<(), Failure> {
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    tokio::runtime::Builder::new_current_thread()
        .build()?
        .block_on(healthy(Scenario {
            kind: "relation",
            identity_kind: "item",
            identity_ids: &[8201, 8202, 8203],
            first_id: 10101,
            query: "00000000-0000-4000-8000-0000000101",
            initial: json!({"kind":"documented-connection","from":endpoint(8201),
                "to":endpoint(8202),"medium":"unknown",
                "uncertainty":{"status":"unknown","explanation":null},
                "evidenceIds":[id(8101)]}),
            replacement: json!({"kind":"documented-connection","from":endpoint(8202),
                "to":endpoint(8203),"medium":"unknown",
                "uncertainty":{"status":"unknown",
                    "explanation":"Synthetic documentary correction α 接続"},
                "evidenceIds":[id(8102)]}),
            initial_guards: vec![
                guard("evidence", 8101),
                guard("identity", 8201),
                guard("identity", 8202),
            ],
            replace_guards: vec![
                guard("evidence", 8101),
                guard("evidence", 8102),
                guard("identity", 8201),
                guard("identity", 8202),
                guard("identity", 8203),
            ],
            retained_guards: vec![
                guard("evidence", 8102),
                guard("identity", 8202),
                guard("identity", 8203),
            ],
        }))
}

async fn healthy(scenario: Scenario) -> Result<(), Failure> {
    let fixture = Fixture::new()?;
    let context = fixture.context.clone();
    let selection = (scenario.kind, scenario.query);
    let (expected, steps, before_history, dependencies) = {
        let client = fixture.client();
        let mut session = client.open().await;
        let mut dependencies = Vec::new();
        for (index, evidence_id) in [8101, 8102].into_iter().enumerate() {
            let payload = json!({"statement":format!("Synthetic documentary basis {evidence_id} α"),
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
                900 + index as u32,
            );
            let outcome = client.call(&mut session, &intent).await;
            dependencies.push(committed(&outcome, &intent, 1, "active", &payload));
        }
        // Real native identities with exact kind and evidence revision guards.
        for (index, record_id) in scenario.identity_ids.iter().enumerate() {
            let payload = json!({"kind":scenario.identity_kind,"evidenceIds":[id(8101)]});
            let intent = command(
                &context,
                "atlas.identity.create",
                target("identity", *record_id),
                payload.clone(),
                None,
                vec![guard("evidence", 8101)],
                910 + index as u32,
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
                scenario.initial_guards.clone(),
                920 + index as u32,
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
        get(&client, &mut session, &context, &records[1], 14000).await;
        list(
            &client,
            &mut session,
            &context,
            selection,
            &records,
            false,
            14010,
        )
        .await?;
        for (index, operation, revision, lifecycle) in [
            (0, "replace", 2, "active"),
            (1, "tombstone", 3, "tombstoned"),
            (2, "restore", 4, "active"),
        ] {
            let (payload, guards) = if operation == "replace" {
                (
                    scenario.replacement.clone(),
                    scenario.replace_guards.clone(),
                )
            } else {
                (json!({}), scenario.retained_guards.clone())
            };
            let intent = command(
                &context,
                &format!("atlas.{}.{operation}", scenario.kind),
                target(scenario.kind, scenario.first_id + 1),
                payload,
                Some(revision - 1),
                guards,
                930 + index,
            );
            let outcome = client.call(&mut session, &intent).await;
            records[1] = committed(
                &outcome,
                &intent,
                revision,
                lifecycle,
                &scenario.replacement,
            );
            get(&client, &mut session, &context, &records[1], 14020 + index).await;
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
                14100 + 10 * index,
            )
            .await?;
            list(
                &client,
                &mut session,
                &context,
                selection,
                &records,
                true,
                14200 + 10 * index,
            )
            .await?;
            steps.push((intent, outcome));
        }
        let before_history = history(&client, &mut session, &context, &steps, 14300).await?;
        session.close();
        (records, steps, before_history, dependencies)
    };
    // Reopen only SQLite, retaining Access; list/history use fresh cursor chains.
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
                14400,
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
            14410,
        )
        .await?;
        for (index, record) in expected.iter().chain(&dependencies).enumerate() {
            get(
                &client,
                &mut session,
                &context,
                record,
                14500 + index as u32,
            )
            .await;
        }
        assert_eq!(
            history(&client, &mut session, &context, &steps, 14600).await?,
            before_history
        );
        session.close();
    }
    drop(fixture);
    Ok(())
}
