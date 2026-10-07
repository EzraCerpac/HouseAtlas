//! Detached reference/source closure from the published storage context.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use super::SemanticError;
use super::canonical::canonical_json;
use super::common::{items, same_scope, text};
use super::mutations::payload_references;

fn reference(record: &Value) -> Result<Value, SemanticError> {
    Ok(json!({
        "recordType": text(&record["recordType"])?,
        "recordId": text(&record["recordId"])?,
    }))
}

fn reference_key(record: &Value) -> Result<String, SemanticError> {
    canonical_json(&json!([
        text(&record["recordType"])?,
        text(&record["recordId"])?,
    ]))
}

// JavaScript's unique helper keeps the last value for each canonical key and
// sorts those keys using UTF-16 string order.
fn unique(values: Vec<Value>) -> Result<Vec<Value>, SemanticError> {
    let mut by_key = BTreeMap::new();
    for value in values {
        by_key.insert(canonical_json(&value)?, value);
    }
    let mut keyed: Vec<_> = by_key.into_iter().collect();
    keyed.sort_unstable_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
    Ok(keyed.into_iter().map(|(_, value)| value).collect())
}

struct Links {
    refs: Vec<Value>,
    sources: Vec<Value>,
}

fn links(record: &Value, graph: &[Value]) -> Result<Links, SemanticError> {
    let payload = &record["payload"];
    let mut refs = payload_references(payload, record, graph)?;
    let mut sources = Vec::new();
    let record_type = text(&record["recordType"])?;
    if record_type == "binding" {
        if let Some(source) = payload.get("source").filter(|value| !value.is_null()) {
            sources.push(json!({
                "workspaceId": record["workspaceId"],
                "homeId": record["homeId"],
                "key": source,
            }));
        }
        for journal in graph {
            if text(&journal["recordType"])? == "reconciliation"
                && same_scope(record, journal)?
                && text(&journal["payload"]["fromBindingId"])? == text(&record["recordId"])?
            {
                refs.push(reference(journal)?);
            }
        }
    }
    if record_type == "evidence"
        && let Some(source) = payload["provenance"]
            .get("source")
            .filter(|value| !value.is_null())
    {
        sources.push(source.clone());
    }
    if let Some(references) = payload.get("references") {
        for reference in items(references)? {
            if text(&reference["kind"])? == "homebox-attachment" {
                sources.push(reference["entity"].clone());
            }
        }
    }
    if let Some(mappings) = payload.get("mappings") {
        for mapping in items(mappings)? {
            if let Some(source) = mapping
                .get("homeboxEntity")
                .filter(|value| !value.is_null())
            {
                sources.push(source.clone());
            }
        }
    }
    Ok(Links {
        refs: unique(refs)?,
        sources,
    })
}

pub(super) fn reference_closure(
    scope: &Value,
    original: &Value,
    candidate: Option<&Value>,
    entries: &[Value],
    replay_results: Option<&[Value]>,
) -> Result<Value, SemanticError> {
    let mut graph = items(&original["records"])?.to_vec();
    if let Some(candidate) = candidate {
        graph.extend_from_slice(items(&candidate["records"])?);
    }
    for entry in entries {
        if let Some(value) = entry["command"]
            .get("value")
            .filter(|value| !value.is_null())
        {
            let mut submitted = scope
                .as_object()
                .ok_or_else(|| SemanticError::invalid("Expected JSON object"))?
                .clone();
            let target = entry["target"]
                .as_object()
                .ok_or_else(|| SemanticError::invalid("Expected JSON object"))?;
            submitted.extend(target.clone());
            submitted.insert("recordType".to_owned(), value["recordType"].clone());
            submitted.insert("payload".to_owned(), value["payload"].clone());
            graph.push(Value::Object(submitted));
        }
    }
    if let Some(results) = replay_results {
        graph.extend(results.iter().map(|result| result["record"].clone()));
    }

    let mut selected = BTreeMap::new();
    let mut affected = BTreeSet::new();
    for entry in entries {
        let target = &entry["target"];
        let key = reference_key(target)?;
        selected.insert(key.clone(), reference(target)?);
        affected.insert(key);
        for guard in items(&entry["command"]["guards"])? {
            let record = &guard["record"];
            selected.insert(reference_key(record)?, reference(record)?);
        }
    }
    if let Some(results) = replay_results {
        for result in results {
            let record = &result["record"];
            selected.insert(reference_key(record)?, reference(record)?);
        }
    }

    // The graph remains fixed during this walk, including retained versions and
    // remap journals. Its links can be computed once without changing either
    // the forward selection or the reverse affected-record fixed point.
    let direct = graph
        .iter()
        .map(|record| links(record, &graph))
        .collect::<Result<Vec<_>, _>>()?;
    let graph_keys = graph
        .iter()
        .map(reference_key)
        .collect::<Result<Vec<_>, _>>()?;
    loop {
        let mut changed = false;
        for ((record, key), direct) in graph.iter().zip(&graph_keys).zip(&direct) {
            if selected.contains_key(key) {
                for record_ref in &direct.refs {
                    let ref_key = reference_key(record_ref)?;
                    if !selected.contains_key(&ref_key) {
                        selected.insert(ref_key, record_ref.clone());
                        changed = true;
                    }
                }
            }
            let mut depends_on_affected = false;
            for record_ref in &direct.refs {
                if affected.contains(&reference_key(record_ref)?) {
                    depends_on_affected = true;
                    break;
                }
            }
            if depends_on_affected {
                if !selected.contains_key(key) {
                    selected.insert(key.clone(), reference(record)?);
                    changed = true;
                }
                if affected.insert(key.clone()) {
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    let retained_keys: BTreeSet<_> = graph_keys
        .iter()
        .filter(|key| selected.contains_key(*key))
        .cloned()
        .collect();
    let mut source_refs = Vec::new();
    for (key, direct) in graph_keys.iter().zip(direct) {
        if selected.contains_key(key) {
            source_refs.extend(direct.sources);
        }
    }
    let source_refs = unique(source_refs)?;
    let source_partitions = unique(
        source_refs
            .iter()
            .map(|source| {
                json!({
                    "workspaceId": source["workspaceId"],
                    "homeId": source["homeId"],
                    "sourceInstanceId": source["key"]["sourceInstanceId"],
                    "collectionId": source["key"]["collectionId"],
                })
            })
            .collect(),
    )?;
    let mut selected: Vec<_> = selected.into_iter().collect();
    selected
        .sort_unstable_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
    let missing_record_refs: Vec<_> = selected
        .iter()
        .filter(|(key, _)| !retained_keys.contains(key))
        .map(|(_, record_ref)| record_ref.clone())
        .collect();
    let record_refs: Vec<_> = selected
        .into_iter()
        .map(|(_, record_ref)| record_ref)
        .collect();
    Ok(json!({
        "recordRefs": record_refs,
        "missingRecordRefs": missing_record_refs,
        "sourceRefs": source_refs,
        "sourcePartitions": source_partitions,
    }))
}
