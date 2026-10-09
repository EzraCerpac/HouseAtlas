//! Mutation preconditions and final-candidate decisions from the published contract.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::common::{items, js_equal, number, record_key, record_ref_key, same_scope, text};
use super::{SemanticCode, SemanticError};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

pub(super) fn assert_transition(
    current: Option<&Value>,
    command: &Value,
    target: &Value,
) -> Result<u64, SemanticError> {
    let operation = text(&command["operation"])?;
    if operation == "create" {
        if current.is_some() {
            return Err(SemanticError::new(
                SemanticCode::IdentityConflict,
                "Permanent record ID already exists",
            ));
        }
    } else {
        let Some(current) = current else {
            return Err(SemanticError::new(
                SemanticCode::NotFound,
                "Record not found in authorized scope",
            ));
        };
        if !same_scope(current, target)?
            || text(&current["recordType"])? != text(&target["recordType"])?
            || text(&current["recordId"])? != text(&target["recordId"])?
        {
            return Err(SemanticError::new(
                SemanticCode::NotFound,
                "Record not found in authorized scope",
            ));
        }
        let revision = number(&current["revision"])?;
        if revision != number(&command["expectedRevision"])? {
            return Err(SemanticError::new(
                SemanticCode::RevisionConflict,
                "Re-read and review the current record before retrying",
            ));
        }
        if revision == MAX_SAFE_INTEGER {
            return Err(SemanticError::new(
                SemanticCode::InvalidTransition,
                "Revision exhausted",
            ));
        }
        let required_lifecycle = if operation == "restore" {
            "tombstoned"
        } else {
            "active"
        };
        if text(&current["lifecycle"])? != required_lifecycle {
            return Err(SemanticError::new(
                SemanticCode::InvalidTransition,
                "Lifecycle precondition failed",
            ));
        }
    }

    let record_type = text(&target["recordType"])?;
    if let Some(value) = command.get("value") {
        if text(&value["recordType"])? != record_type {
            return Err(SemanticError::new(
                SemanticCode::InvalidContract,
                "Route and payload record type mismatch",
            ));
        }
        if let Some(current) = current {
            let a = &current["payload"];
            let b = &value["payload"];
            if record_type == "identity" && text(&a["kind"])? != text(&b["kind"])? {
                return Err(SemanticError::new(
                    SemanticCode::InvalidTransition,
                    "Physical identity kind is immutable",
                ));
            }
            if record_type == "binding"
                && (text(&a["atlasId"])? != text(&b["atlasId"])?
                    || !js_equal(&a["source"], &b["source"]))
            {
                return Err(SemanticError::new(
                    SemanticCode::InvalidTransition,
                    "Binding identity/source key is immutable; use reviewed reconciliation",
                ));
            }
            if matches!(record_type, "evidence" | "reconciliation" | "geometry") {
                return Err(SemanticError::new(
                    SemanticCode::InvalidTransition,
                    "Evidence, geometry versions and reconciliation journal are append-only",
                ));
            }
            if record_type == "asset" {
                for key in [
                    "owner",
                    "purpose",
                    "storageKey",
                    "sha256",
                    "byteSize",
                    "contentType",
                ] {
                    let changed = if key == "byteSize" {
                        number(&a[key])? != number(&b[key])?
                    } else {
                        text(&a[key])? != text(&b[key])?
                    };
                    if changed {
                        return Err(SemanticError::new(
                            SemanticCode::InvalidTransition,
                            "Original asset manifest identity/content is immutable",
                        ));
                    }
                }
            }
        }
    }

    match current {
        Some(record) => Ok((number(&record["revision"])? + 1.0) as u64),
        None => Ok(1),
    }
}

#[derive(Default)]
struct References {
    keys: BTreeSet<[String; 4]>,
    values: Vec<Value>,
}

fn add_reference(
    refs: &mut References,
    target: &Value,
    record_type: &str,
    record_id: &Value,
) -> Result<(), SemanticError> {
    let record_id = text(record_id)?;
    if refs
        .keys
        .insert(record_ref_key(target, record_type, record_id)?)
    {
        refs.values
            .push(json!({ "recordType": record_type, "recordId": record_id }));
    }
    Ok(())
}

fn add_reference_ids(
    refs: &mut References,
    target: &Value,
    payload: &Value,
    field: &str,
    record_type: &str,
) -> Result<(), SemanticError> {
    if let Some(ids) = payload.get(field) {
        for id in items(ids)? {
            add_reference(refs, target, record_type, id)?;
        }
    }
    Ok(())
}

fn add_endpoint_reference(
    refs: &mut References,
    target: &Value,
    endpoint: &Value,
) -> Result<(), SemanticError> {
    if endpoint.get("kind").and_then(Value::as_str) == Some("atlas-record") {
        add_reference(
            refs,
            target,
            text(&endpoint["ref"]["recordType"])?,
            &endpoint["ref"]["recordId"],
        )?;
    }
    Ok(())
}

fn find_record<'a>(
    records: &'a [Value],
    target: &Value,
    record_type: &str,
    record_id: &str,
) -> Result<Option<&'a Value>, SemanticError> {
    for record in records {
        if same_scope(target, record)?
            && text(&record["recordType"])? == record_type
            && text(&record["recordId"])? == record_id
        {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

fn find_geometry_binding<'a>(
    records: &'a [Value],
    target: &Value,
    mapping: &Value,
) -> Result<Option<&'a Value>, SemanticError> {
    for record in records {
        if same_scope(target, record)?
            && text(&record["recordType"])? == "binding"
            && text(&record["payload"]["atlasId"])? == text(&mapping["atlasId"])?
            && js_equal(
                &record["payload"]["source"],
                &mapping["homeboxEntity"]["key"],
            )
        {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

// Historical accepted geometry reads the whole retained remap closure, including
// retired bindings. A visited set gives the published recursive walk its cycle
// stopping behavior without adding a new graph-validation rule here.
fn add_binding_closure(
    refs: &mut References,
    records: &[Value],
    target: &Value,
    binding: &Value,
) -> Result<(), SemanticError> {
    let mut visited = BTreeSet::from([text(&binding["recordId"])?.to_owned()]);
    add_reference(refs, target, "binding", &binding["recordId"])?;
    let mut pending = vec![(binding, 0)];
    while let Some((binding, start)) = pending.pop() {
        let mut outgoing = None;
        for (index, journal) in records.iter().enumerate().skip(start) {
            if same_scope(target, journal)?
                && text(&journal["recordType"])? == "reconciliation"
                && text(&journal["payload"]["fromBindingId"])? == text(&binding["recordId"])?
            {
                outgoing = Some((index, journal));
                break;
            }
        }
        let Some((index, journal)) = outgoing else {
            continue;
        };
        pending.push((binding, index + 1));
        add_reference(refs, target, "reconciliation", &journal["recordId"])?;
        add_reference(refs, target, "binding", &journal["payload"]["toBindingId"])?;
        if let Some(next) = find_record(
            records,
            target,
            "binding",
            text(&journal["payload"]["toBindingId"])?,
        )? && visited.insert(text(&next["recordId"])?.to_owned())
        {
            add_reference(refs, target, "binding", &next["recordId"])?;
            pending.push((next, 0));
        }
    }
    Ok(())
}

pub(super) fn required_references(
    snapshot: &Value,
    current: Option<&Value>,
    command: &Value,
    target: &Value,
) -> Result<Vec<Value>, SemanticError> {
    let records = items(&snapshot["records"])?;
    let mut refs = References::default();
    let current_payload = current.map(|record| &record["payload"]);
    let proposed_payload = command.get("value").map(|value| &value["payload"]);
    for payload in current_payload.into_iter().chain(proposed_payload) {
        for reference in payload_references(payload, target, records)? {
            add_reference(
                &mut refs,
                target,
                text(&reference["recordType"])?,
                &reference["recordId"],
            )?;
        }
    }
    Ok(refs.values)
}

pub(super) fn payload_references(
    payload: &Value,
    target: &Value,
    records: &[Value],
) -> Result<Vec<Value>, SemanticError> {
    let mut refs = References::default();
    add_reference_ids(&mut refs, target, payload, "evidenceIds", "evidence")?;
    add_reference_ids(
        &mut refs,
        target,
        payload,
        "supersedesEvidenceIds",
        "evidence",
    )?;
    for (field, record_type) in [
        ("atlasId", "identity"),
        ("originalAssetId", "asset"),
        ("previousGeometryId", "geometry"),
        ("fromBindingId", "binding"),
        ("toBindingId", "binding"),
    ] {
        if let Some(id) = payload.get(field).filter(|id| !id.is_null()) {
            add_reference(&mut refs, target, record_type, id)?;
        }
    }
    if let Some(elevation) = payload.get("elevation")
        && elevation["status"] == "known"
    {
        add_reference(&mut refs, target, "identity", &elevation["datumAtlasId"])?;
    }
    if let Some(panel) = payload.get("panel") {
        add_endpoint_reference(&mut refs, target, panel)?;
    }
    for field in ["from", "to"] {
        if let Some(endpoint) = payload.get(field) {
            add_endpoint_reference(&mut refs, target, endpoint)?;
        }
    }
    if let Some(references) = payload.get("references") {
        for reference in items(references)? {
            if text(&reference["kind"])? == "atlas-asset" {
                add_reference(&mut refs, target, "asset", &reference["assetId"])?;
            }
        }
    }
    if let Some(mappings) = payload.get("mappings") {
        for mapping in items(mappings)? {
            add_reference(&mut refs, target, "identity", &mapping["atlasId"])?;
            add_reference_ids(&mut refs, target, mapping, "evidenceIds", "evidence")?;
            if text(&mapping["reviewStatus"])? == "accepted"
                && !mapping["homeboxEntity"].is_null()
                && let Some(binding) = find_geometry_binding(records, target, mapping)?
            {
                add_binding_closure(&mut refs, records, target, binding)?;
            }
        }
    }
    Ok(refs.values)
}

pub(super) fn assert_guards(
    snapshot: &Value,
    current: Option<&Value>,
    command: &Value,
    target: &Value,
    created_in_batch: &[Value],
) -> Result<(), SemanticError> {
    let refs = required_references(snapshot, current, command, target)?;
    let records = items(&snapshot["records"])?;
    let mut guards = BTreeSet::new();
    for guard in items(&command["guards"])? {
        let key = record_ref_key(
            target,
            text(&guard["record"]["recordType"])?,
            text(&guard["record"]["recordId"])?,
        )?;
        if !guards.insert(key.clone()) {
            return Err(SemanticError::new(
                SemanticCode::InvalidContract,
                "Duplicate guard target",
            ));
        }
        let mut found = None;
        for record in records {
            if record_key(record)? == key {
                found = Some(record);
                break;
            }
        }
        if match found {
            Some(record) => number(&record["revision"])? != number(&guard["expectedRevision"])?,
            None => true,
        } {
            return Err(SemanticError::new(
                SemanticCode::GuardConflict,
                "Referenced record changed or is outside this home",
            ));
        }
    }

    let target_key = record_key(target)?;
    let mut created = BTreeSet::new();
    for record in created_in_batch {
        created.insert(record_ref_key(
            target,
            text(&record["recordType"])?,
            text(&record["recordId"])?,
        )?);
    }
    for reference in refs {
        let key = record_ref_key(
            target,
            text(&reference["recordType"])?,
            text(&reference["recordId"])?,
        )?;
        if key == target_key || created.contains(&key) {
            continue;
        }
        if !guards.contains(&key) {
            return Err(SemanticError::new(
                SemanticCode::GuardConflict,
                "Existing reference requires a revision guard",
            ));
        }
    }
    Ok(())
}

pub(super) fn assert_final_mutation(
    snapshot: &Value,
    _current: Option<&Value>,
    command: &Value,
    target: &Value,
) -> Result<(), SemanticError> {
    if text(&command["operation"])? != "create" {
        return Ok(());
    }
    let records = items(&snapshot["records"])?;
    let target_key = record_key(target)?;
    let mut created = None;
    for record in records {
        if record_key(record)? == target_key {
            created = Some(record);
            break;
        }
    }
    let Some(record) = created else {
        return Err(SemanticError::new(
            SemanticCode::InvalidContract,
            "Final candidate is missing created record",
        ));
    };

    let record_type = text(&record["recordType"])?;
    if record_type == "reconciliation" {
        let payload = &record["payload"];
        let from = find_record(records, target, "binding", text(&payload["fromBindingId"])?)?;
        let to = find_record(records, target, "binding", text(&payload["toBindingId"])?)?;
        let retired_from = from
            .is_some_and(|record| record["payload"]["reviewStatus"].as_str() == Some("retired"));
        let active_accepted_to = to.is_some_and(|record| {
            record["lifecycle"].as_str() == Some("active")
                && record["payload"]["reviewStatus"].as_str() == Some("accepted")
        });
        if !retired_from || !active_accepted_to {
            return Err(SemanticError::new(
                SemanticCode::InvalidTransition,
                "New remap journal requires retired source and active accepted destination",
            ));
        }
    }
    if record_type == "geometry" {
        for mapping in items(&record["payload"]["mappings"])? {
            if text(&mapping["reviewStatus"])? != "accepted" || mapping["homeboxEntity"].is_null() {
                continue;
            }
            let binding = find_geometry_binding(records, target, mapping)?;
            let active_accepted = binding.is_some_and(|record| {
                record["lifecycle"].as_str() == Some("active")
                    && record["payload"]["reviewStatus"].as_str() == Some("accepted")
            });
            if !active_accepted {
                return Err(SemanticError::new(
                    SemanticCode::InvalidTransition,
                    "New accepted mapping requires a current active accepted binding",
                ));
            }
        }
    }
    Ok(())
}
