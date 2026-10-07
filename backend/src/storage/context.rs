use super::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
struct Node {
    target: RecordRef,
    payload: Value,
}
fn nodes(snapshot: &Snapshot) -> Vec<Node> {
    snapshot
        .records
        .iter()
        .map(|r| Node {
            target: r.reference(),
            payload: r.payload.clone(),
        })
        .collect()
}
fn key(reference: &RecordRef) -> (String, String) {
    (
        reference.record_type.as_str().into(),
        reference.record_id.clone(),
    )
}
fn from_key((record_type, record_id): &(String, String)) -> Result<RecordRef> {
    Ok(serde_json::from_value(
        json!({"recordType":record_type,"recordId":record_id}),
    )?)
}
fn unique<T: Serialize + DeserializeOwned, C: Contract>(
    contract: &C,
    values: Vec<T>,
) -> Result<Vec<T>> {
    let mut ordered = BTreeMap::new();
    for value in values {
        ordered.insert(
            contract
                .canonical_json(&serde_json::to_value(&value)?)?
                .encode_utf16()
                .collect::<Vec<_>>(),
            value,
        );
    }
    Ok(ordered.into_values().collect())
}
fn add_ref(refs: &mut Vec<RecordRef>, record_type: RecordType, id: &Value) {
    if let Some(id) = id.as_str().filter(|s| !s.is_empty()) {
        refs.push(RecordRef {
            record_type,
            record_id: id.into(),
        });
    }
}
fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

/// Matches the published guarded-reference extractor, including retained
/// accepted geometry bindings and their recursively followed remap journals.
fn references<C: Contract>(
    contract: &C,
    payload: &Value,
    graph: &[Node],
) -> Result<Vec<RecordRef>> {
    let mut refs = vec![];
    for field in ["evidenceIds", "supersedesEvidenceIds"] {
        for id in array(&payload[field]) {
            add_ref(&mut refs, RecordType::Evidence, id);
        }
    }
    for (field, kind) in [
        ("atlasId", RecordType::Identity),
        ("originalAssetId", RecordType::Asset),
        ("previousGeometryId", RecordType::Geometry),
        ("fromBindingId", RecordType::Binding),
        ("toBindingId", RecordType::Binding),
    ] {
        add_ref(&mut refs, kind, &payload[field]);
    }
    for field in ["panel", "from", "to"] {
        if payload[field]["kind"] == "atlas-record" {
            refs.push(serde_json::from_value(payload[field]["ref"].clone())?);
        }
    }
    for reference in array(&payload["references"]) {
        if reference["kind"] == "atlas-asset" {
            add_ref(&mut refs, RecordType::Asset, &reference["assetId"]);
        }
    }
    for mapping in array(&payload["mappings"]) {
        add_ref(&mut refs, RecordType::Identity, &mapping["atlasId"]);
        for id in array(&mapping["evidenceIds"]) {
            add_ref(&mut refs, RecordType::Evidence, id);
        }
        if mapping["reviewStatus"] != "accepted" || mapping["homeboxEntity"].is_null() {
            continue;
        }
        let binding = graph.iter().find(|b| {
            b.target.record_type == RecordType::Binding
                && b.payload["atlasId"] == mapping["atlasId"]
                && b.payload["source"] == mapping["homeboxEntity"]["key"]
        });
        if let Some(binding) = binding {
            let mut pending = vec![binding];
            let mut visited = BTreeSet::new();
            while let Some(binding) = pending.pop() {
                if !visited.insert(binding.target.record_id.clone()) {
                    continue;
                }
                refs.push(binding.target.clone());
                for journal in graph.iter().filter(|j| {
                    j.target.record_type == RecordType::Reconciliation
                        && j.payload["fromBindingId"].as_str() == Some(&binding.target.record_id)
                }) {
                    refs.push(journal.target.clone());
                    add_ref(
                        &mut refs,
                        RecordType::Binding,
                        &journal.payload["toBindingId"],
                    );
                    if let Some(next) = graph.iter().find(|b| {
                        b.target.record_type == RecordType::Binding
                            && Some(b.target.record_id.as_str())
                                == journal.payload["toBindingId"].as_str()
                    }) {
                        pending.push(next);
                    }
                }
            }
        }
    }
    unique(contract, refs)
}

fn links<C: Contract>(
    contract: &C,
    scope: &Scope,
    node: &Node,
    graph: &[Node],
) -> Result<(Vec<RecordRef>, Vec<Value>)> {
    let mut refs = references(contract, &node.payload, graph)?;
    let mut sources = vec![];
    let payload = &node.payload;
    if node.target.record_type == RecordType::Binding {
        if !payload["source"].is_null() {
            sources.push(json!({"workspaceId":scope.workspace_id,"homeId":scope.home_id,"key":payload["source"]}));
        }
        for journal in graph.iter().filter(|j| {
            j.target.record_type == RecordType::Reconciliation
                && j.payload["fromBindingId"].as_str() == Some(&node.target.record_id)
        }) {
            refs.push(journal.target.clone());
        }
    }
    if node.target.record_type == RecordType::Evidence && !payload["provenance"]["source"].is_null()
    {
        sources.push(payload["provenance"]["source"].clone());
    }
    for reference in array(&payload["references"]) {
        if reference["kind"] == "homebox-attachment" {
            sources.push(reference["entity"].clone());
        }
    }
    for mapping in array(&payload["mappings"]) {
        if !mapping["homeboxEntity"].is_null() {
            sources.push(mapping["homeboxEntity"].clone());
        }
    }
    Ok((unique(contract, refs)?, sources))
}

pub(crate) fn closure<C: Contract>(
    contract: &C,
    scope: &Scope,
    original: &Snapshot,
    candidate: Option<&Snapshot>,
    entries: &[MutationEntry],
    replay: Option<&Replay>,
) -> Result<MutationClosure> {
    closure_with_extra(contract, scope, original, candidate, entries, replay, &[])
}
pub(crate) fn closure_with_extra<C: Contract>(
    contract: &C,
    scope: &Scope,
    original: &Snapshot,
    candidate: Option<&Snapshot>,
    entries: &[MutationEntry],
    replay: Option<&Replay>,
    extra: &[RecordRef],
) -> Result<MutationClosure> {
    let mut graph = nodes(original);
    if let Some(candidate) = candidate {
        graph.extend(nodes(candidate));
    }
    for entry in entries {
        if let Some(value) = &entry.command.value {
            graph.push(Node {
                target: RecordRef {
                    record_type: value.record_type,
                    record_id: entry.target.record_id.clone(),
                },
                payload: value.payload.clone(),
            });
        }
    }
    if let Some(replay) = replay {
        for r in &replay.results {
            graph.push(Node {
                target: r.record.reference(),
                payload: r.record.payload.clone(),
            });
        }
    }
    let mut selected: BTreeSet<_> = entries
        .iter()
        .flat_map(|e| {
            std::iter::once(key(&e.target)).chain(e.command.guards.iter().map(|g| key(&g.record)))
        })
        .collect();
    selected.extend(extra.iter().map(key));
    if let Some(replay) = replay {
        selected.extend(replay.results.iter().map(|r| key(&r.record.reference())));
    }
    let mut affected: BTreeSet<_> = entries.iter().map(|e| key(&e.target)).collect();
    // Cache links once: reverse dependencies and reconciliation cycles reach a
    // fixed point without repeated extraction or any fabricated source facts.
    let linked = graph
        .iter()
        .map(|n| links(contract, scope, n, &graph))
        .collect::<Result<Vec<_>>>()?;
    loop {
        let before = (selected.len(), affected.len());
        for (node, (refs, _)) in graph.iter().zip(&linked) {
            if selected.contains(&key(&node.target)) {
                selected.extend(refs.iter().map(key));
            }
            if refs.iter().any(|r| affected.contains(&key(r))) {
                selected.insert(key(&node.target));
                affected.insert(key(&node.target));
            }
        }
        if before == (selected.len(), affected.len()) {
            break;
        }
    }
    // JS sorts canonical [type,id] keys, rather than object-key strings.
    let mut ordered = BTreeMap::new();
    for k in &selected {
        ordered.insert(contract.canonical_json(&json!([k.0, k.1]))?, from_key(k)?);
    }
    let record_refs: Vec<_> = ordered.into_values().collect();
    let missing_record_refs = record_refs
        .iter()
        .filter(|r| !graph.iter().any(|n| n.target == **r))
        .cloned()
        .collect();
    let source_refs = unique(
        contract,
        graph
            .iter()
            .zip(&linked)
            .filter(|(n, _)| selected.contains(&key(&n.target)))
            .flat_map(|(_, (_, sources))| sources.clone())
            .collect::<Vec<_>>(),
    )?;
    let source_partitions = unique(contract, source_refs.iter().map(|r| serde_json::from_value(json!({
        "workspaceId":r["workspaceId"],"homeId":r["homeId"],"sourceInstanceId":r["key"]["sourceInstanceId"],"collectionId":r["key"]["collectionId"]})))
        .collect::<std::result::Result<Vec<SourcePartition>, _>>()?)?;
    Ok(MutationClosure {
        record_refs,
        missing_record_refs,
        source_refs,
        source_partitions,
    })
}

fn preconditions<C: Contract>(
    contract: &C,
    original: &Snapshot,
    entries: &[MutationEntry],
) -> Result<MutationPreconditions> {
    let graph = nodes(original);
    let created_in_batch: Vec<_> = entries
        .iter()
        .filter(|e| e.command.operation == Operation::Create)
        .map(|e| e.target.clone())
        .collect();
    let commands = entries
        .iter()
        .map(|entry| {
            let current = original
                .records
                .iter()
                .find(|r| r.reference() == entry.target);
            let mut refs = vec![];
            if let Some(current) = current {
                refs.extend(references(contract, &current.payload, &graph)?);
            }
            if let Some(value) = &entry.command.value {
                refs.extend(references(contract, &value.payload, &graph)?);
            }
            let required_guards = unique(contract, refs)?
                .into_iter()
                .filter(|r| *r != entry.target && !created_in_batch.contains(r))
                .collect();
            Ok(CommandPreconditions {
                target: entry.target.clone(),
                operation: entry.command.operation,
                expected_revision: entry.command.expected_revision,
                current: current.map(|r| CurrentPrecondition {
                    revision: r.revision,
                    lifecycle: r.lifecycle,
                }),
                required_guards,
                guards: entry
                    .command
                    .guards
                    .iter()
                    .map(|g| GuardPrecondition {
                        record: g.record.clone(),
                        expected_revision: g.expected_revision,
                        current_revision: original
                            .records
                            .iter()
                            .find(|r| r.reference() == g.record)
                            .map(|r| r.revision),
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(MutationPreconditions {
        created_in_batch,
        commands,
    })
}

pub(crate) struct ContextInput<'a> {
    pub context_id: &'a str,
    pub phase: MutationPhase,
    pub scope: &'a Scope,
    pub entries: &'a [MutationEntry],
    pub batch: Option<&'a BatchMutation>,
    pub original: &'a Snapshot,
    pub cache_partitions: &'a [MutationCachePartition],
    pub candidate: Option<&'a Snapshot>,
    pub replay: Option<&'a Replay>,
}
pub(crate) fn build<C: Contract>(
    contract: &C,
    input: ContextInput<'_>,
) -> Result<MutationAuthorizationContext> {
    let original = input.original.scoped(input.scope);
    let candidate = input.candidate.map(|c| c.scoped(input.scope));
    let preconditions = match input.phase {
        MutationPhase::Validate | MutationPhase::Candidate | MutationPhase::Precommit => {
            Some(preconditions(contract, &original, input.entries)?)
        }
        _ => None,
    };
    let closure = closure(
        contract,
        input.scope,
        &original,
        candidate.as_ref(),
        input.entries,
        input.replay,
    )?;
    Ok(MutationAuthorizationContext {
        format: MUTATION_AUTHORIZATION_CONTEXT_FORMAT,
        schema_version: 1,
        context_id: input.context_id.into(),
        phase: input.phase,
        scope: input.scope.clone(),
        entries: input.entries.to_vec(),
        targets: input.entries.iter().map(|e| e.target.clone()).collect(),
        batch: input.batch.cloned(),
        original,
        candidate,
        closure,
        cache_partitions: unique(contract, input.cache_partitions.to_vec())?,
        preconditions,
        replay: input.replay.cloned(),
    })
}
