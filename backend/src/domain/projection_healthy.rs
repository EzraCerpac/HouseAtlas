//! Healthy generated partition joins, without a provider or persisted state.
use super::*;
use serde_json::{Value, json};

fn admit(snapshot: &Snapshot) {
    use crate::storage::Contract;
    let retained = serde_json::from_value(serde_json::to_value(snapshot).unwrap()).unwrap();
    crate::http::contracts::NativeContracts
        .validate_snapshot(&retained)
        .unwrap();
}

fn authority() -> AuthorizedHome {
    AuthorizedHome {
        home: HomeSummary {
            scope: Scope {
                workspace_id: "00000000-0000-4000-8000-000000000001".into(),
                home_id: "00000000-0000-4000-8000-000000000002".into(),
            },
            label: "Synthetic home".into(),
        },
        other_homes: vec![],
        can_edit_homebox: false,
    }
}

fn remap(value: &mut Value, copy: u128) {
    match value {
        Value::String(text) => {
            if let Ok(id) = uuid::Uuid::parse_str(text)
                && !matches!(&text[text.len() - 12..], "000000000001" | "000000000002")
            {
                *text = uuid::Uuid::from_u128(id.as_u128() + copy * 1_000_000).to_string();
            }
        }
        Value::Array(values) => values.iter_mut().for_each(|value| remap(value, copy)),
        Value::Object(values) => values.values_mut().for_each(|value| remap(value, copy)),
        _ => {}
    }
}

fn collection(value: &mut Value, name: &str) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(|value| collection(value, name)),
        Value::Object(values) => {
            if let Some(value) = values.get_mut("collectionId") {
                *value = json!(name);
            }
            values
                .values_mut()
                .for_each(|value| collection(value, name));
        }
        _ => {}
    }
}

#[test]
fn healthy_partition_indexes_preserve_joins_order_and_freshness() {
    let original = crate::lifecycle::fixture().unwrap();
    let authority = authority();
    let mut combined = original.clone();
    let fields = [
        "records",
        "sources",
        "homeboxEntities",
        "caches",
        "networkRelations",
    ];
    for field in fields {
        combined[field] = json!([]);
    }
    let mut isolated = Vec::new();
    for copy in 0..12 {
        let mut part = original.clone();
        remap(&mut part, copy);
        // Neighboring partitions share either the collection or source instance.
        // Both components must participate in the entity/cache join.
        collection(&mut part, if copy % 2 == 0 { "shared" } else { "separate" });
        if copy % 2 == 1 {
            let preceding = format!(
                "00000000-0000-4000-8000-{:012}",
                10 + (copy - 1) * 1_000_000
            );
            fn source_instance(value: &mut Value, instance: &str) {
                match value {
                    Value::Array(v) => v.iter_mut().for_each(|v| source_instance(v, instance)),
                    Value::Object(v) => {
                        if let Some(id) = v.get_mut("sourceInstanceId") {
                            *id = json!(instance);
                        }
                        v.values_mut().for_each(|v| source_instance(v, instance));
                    }
                    _ => {}
                }
            }
            source_instance(&mut part, &preceding);
            part["caches"][0]["lastSuccessfulFetchAt"] = json!("2026-01-02T11:00:00Z");
            part["caches"][0]["lastAttemptAt"] = json!("2026-01-02T11:00:00Z");
            for entity in part["homeboxEntities"].as_array_mut().unwrap() {
                entity["retrievedAt"] = json!("2026-01-02T11:00:00Z");
            }
        }
        for field in fields {
            combined[field]
                .as_array_mut()
                .unwrap()
                .extend(part[field].as_array().unwrap().iter().cloned());
        }
        isolated.push(serde_json::from_value::<Snapshot>(part).unwrap());
    }
    let before = combined.clone();
    let mut snapshot: Snapshot = serde_json::from_value(combined).unwrap();
    // The same source identity in another workspace has independent ownership.
    let mut other_cache = snapshot.caches[0].clone();
    other_cache.partition.scope.workspace_id = "00000000-0000-4000-8000-000000000099".into();
    other_cache.last_successful_fetch_at = Some("2026-01-02T10:00:00Z".into());
    snapshot.caches.push(other_cache);
    let mut other_source = snapshot.sources[0].clone();
    other_source.partition.scope.workspace_id = "00000000-0000-4000-8000-000000000099".into();
    other_source.owner = SourceOwner::Network;
    snapshot.sources.push(other_source);
    admit(&snapshot);
    let retained = serde_json::to_value(&snapshot).unwrap();
    for now in ["2026-01-02T12:05:00Z", "2026-01-02T12:16:00Z"] {
        let actual =
            serde_json::to_value(project_current(&snapshot, &authority, now, &[]).unwrap())
                .unwrap();
        let mut entries = Vec::new();
        let mut caches = Vec::new();
        for part in &isolated {
            let expected =
                serde_json::to_value(project_current(part, &authority, now, &[]).unwrap()).unwrap();
            entries.extend(expected["entries"].as_array().unwrap().iter().cloned());
            caches.extend(expected["caches"].as_array().unwrap().iter().cloned());
        }
        assert_eq!(actual["entries"], json!(entries));
        assert_eq!(actual["caches"], json!(caches));
        assert_eq!(
            actual["entries"][0]["cacheStatus"],
            if now.ends_with("05:00Z") {
                "fresh"
            } else {
                "stale"
            }
        );
        assert_eq!(actual["entries"][2]["cacheStatus"], "stale");
        assert_eq!(actual["caches"][0]["owner"], "homebox");
    }
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), retained);
    assert_eq!(before["sources"].as_array().unwrap().len(), 12);
}

#[test]
fn healthy_status_owners_follow_exact_partition_order() {
    let mut snapshot: Snapshot = serde_json::from_str(include_str!(
        "../../../packages/contracts/fixtures/plan-free.snapshot.json"
    ))
    .unwrap();
    let network = snapshot
        .sources
        .iter()
        .find(|source| source.owner == SourceOwner::Network)
        .unwrap();
    let mut cache = snapshot.caches[0].clone();
    cache.partition = network.partition.clone();
    snapshot.caches.insert(0, cache);
    admit(&snapshot);
    let projected = serde_json::to_value(
        project_current(&snapshot, &authority(), "2026-01-02T12:05:00Z", &[]).unwrap(),
    )
    .unwrap();
    assert_eq!(projected["caches"][0]["owner"], "network");
    assert_eq!(projected["caches"][1]["owner"], "homebox");
    assert_eq!(
        projected["caches"][0]["sourceInstanceId"],
        network.partition.source_instance_id
    );
    assert_eq!(
        projected["caches"][1]["sourceInstanceId"],
        snapshot.caches[1].partition.source_instance_id
    );
}
