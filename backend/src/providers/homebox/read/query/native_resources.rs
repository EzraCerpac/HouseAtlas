//! Bounded projections from captured native HomeBox observations.
//! This module performs no source intake, cursor construction, or graph checks.
use super::super::Timestamp;
use super::*;
use crate::{
    contracts::{
        semantics,
        stock::{HomeboxResourceKind, StockTarget},
    },
    domain::stock::{self as st, OperationId as Op},
};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

const NIL: &str = "00000000-0000-0000-0000-000000000000";

fn unavailable<T>() -> st::StockResult<T> {
    Err(st::StockError::OwnerUnavailable)
}
fn invalid<T>() -> st::StockResult<T> {
    Err(st::StockError::InvalidContract)
}
fn id(value: &Value) -> st::StockResult<&str> {
    let value = value.as_str().ok_or(st::StockError::InvalidContract)?;
    super::super::Uuid::parse(value).map_err(|_| st::StockError::InvalidContract)?;
    Ok(value)
}
fn string<'a>(value: &'a Value, key: &str) -> st::StockResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(st::StockError::InvalidContract)
}
fn rows(source: &Value) -> st::StockResult<&[Value]> {
    if source.is_null() {
        return Ok(&[]);
    }
    source
        .as_array()
        .map(Vec::as_slice)
        .ok_or(st::StockError::InvalidContract)
}
fn array_field<'a>(source: &'a Value, key: &str) -> st::StockResult<&'a [Value]> {
    match source.get(key) {
        Some(Value::Null) => Ok(&[]),
        Some(Value::Array(rows)) => Ok(rows),
        _ => Err(st::StockError::InvalidContract),
    }
}
fn relation(value: &Value) -> st::StockResult<Value> {
    match value {
        Value::Null => Ok(Value::Null),
        Value::String(s) if s == NIL => Ok(Value::Null),
        Value::String(s) => {
            let parsed =
                super::super::Uuid::parse(s).map_err(|_| st::StockError::InvalidContract)?;
            Ok(json!(parsed.as_str()))
        }
        _ => invalid(),
    }
}
fn template_relation(value: &Value) -> st::StockResult<Value> {
    let projected = relation(value)?;
    if projected.is_null() && !value.is_null() {
        return invalid();
    }
    Ok(projected)
}
fn target(query: &HomeBoxReadQuery, kind: HomeboxResourceKind, id: &str) -> StockTarget {
    StockTarget::Homebox {
        source_instance_id: query.scope().source_instance_id.as_str().into(),
        collection_id: query.scope().collection_id.clone(),
        resource_kind: kind,
        entity_id: None,
        resource_id: Some(id.to_owned()),
    }
}
fn view(
    query: &HomeBoxReadQuery,
    kind: HomeboxResourceKind,
    raw_id: &Value,
    raw: &Value,
    data: Value,
    retrieved_at: &Timestamp,
) -> st::StockResult<ResourceView> {
    let id = super::super::Uuid::parse(id(raw_id)?)
        .map_err(|_| st::StockError::InvalidContract)?
        .as_str()
        .to_owned();
    let digest = semantics::canonical_digest(&json!({"scope":query.scope(),"resource":raw}))
        .map_err(|_| st::StockError::InvalidContract)?;
    Ok(ResourceView {
        target: target(query, kind, &id),
        observation: ReadObservation::ObservationOnly { digest },
        data,
        retrieved_at: retrieved_at.clone(),
    })
}
fn page(
    query: &HomeBoxReadQuery,
    resources: Vec<ResourceView>,
    retrieved_at: &Timestamp,
    status: SourceStatus,
) -> st::StockResult<ResourcePage> {
    let ReadSelection::Resources { page, .. } = query.selection() else {
        return unavailable();
    };
    if page
        .as_ref()
        .is_some_and(|p| p.cursor.is_some() || p.q.is_some())
        || resources.len() > page.as_ref().map_or(100, |p| p.page_size as usize)
    {
        return unavailable();
    }
    let mut seen = BTreeSet::new();
    for row in &resources {
        let StockTarget::Homebox {
            resource_id: Some(id),
            ..
        } = &row.target
        else {
            return invalid();
        };
        if !seen.insert(id.clone()) {
            return invalid();
        }
    }
    let _ = retrieved_at;
    Ok(ResourcePage {
        scope: query.scope().clone(),
        resources,
        next_cursor: None,
        source_status: status,
    })
}
fn selected(query: &HomeBoxReadQuery) -> st::StockResult<(Op, Option<&ListQuery>, Option<&str>)> {
    let ReadSelection::Resources { operation, page } = query.selection() else {
        return unavailable();
    };
    if page
        .as_ref()
        .is_some_and(|p| p.cursor.is_some() || p.q.is_some())
    {
        return unavailable();
    }
    let StockTarget::Homebox { resource_id, .. } = query.target() else {
        return invalid();
    };
    Ok((*operation, page.as_ref(), resource_id.as_deref()))
}
fn only_requested<'a>(
    rows: &[&'a Value],
    requested: Option<&str>,
    get: bool,
) -> st::StockResult<Vec<&'a Value>> {
    if !get {
        return Ok(rows.to_vec());
    }
    let requested = requested.ok_or(st::StockError::InvalidContract)?;
    let found: Vec<_> = rows
        .iter()
        .copied()
        .filter(|row| row.get("id").and_then(Value::as_str) == Some(requested))
        .collect();
    if found.len() != 1 {
        return unavailable();
    }
    Ok(found)
}
fn tag_data(raw: &Value) -> st::StockResult<Value> {
    let name = string(raw, "name")?;
    let mut data = Map::new();
    data.insert("name".into(), json!(name));
    for key in ["color", "description", "icon"] {
        if let Some(value) = raw.get(key) {
            data.insert(key.into(), value.clone());
        }
    }
    let parent = raw
        .get("parentId")
        .ok_or(st::StockError::OwnerUnavailable)?;
    data.insert("parentId".into(), relation(parent)?);
    Ok(Value::Object(data))
}
fn type_data(raw: &Value) -> st::StockResult<Value> {
    let name = string(raw, "name")?;
    let icon = string(raw, "icon").map_err(|_| st::StockError::OwnerUnavailable)?;
    let is_location = raw
        .get("isLocation")
        .and_then(Value::as_bool)
        .ok_or(st::StockError::OwnerUnavailable)?;
    let relation = match (raw.get("defaultTemplateId"), raw.get("defaultTemplate")) {
        (Some(Value::Null), Some(v)) if !v.is_null() => return invalid(),
        (Some(v), Some(nested)) if !nested.is_null() => {
            let a = template_relation(v)?;
            let b = template_relation(nested.get("id").ok_or(st::StockError::InvalidContract)?)?;
            if a != b {
                return invalid();
            }
            a
        }
        (Some(v), _) => template_relation(v)?,
        (None, Some(Value::Null)) => Value::Null,
        (None, Some(v)) => template_relation(v.get("id").ok_or(st::StockError::InvalidContract)?)?,
        (None, None) => return unavailable(),
    };
    Ok(json!({"name":name,"icon":icon,"isLocation":is_location,"defaultTemplateId":relation}))
}
fn field_data(field: &Value) -> st::StockResult<Value> {
    let name = string(field, "name")?;
    let kind = string(field, "type")?;
    let value = match kind {
        "text" => json!({"kind":"text","value":string(field,"textValue")?}),
        "number" => {
            let number = field
                .get("numberValue")
                .and_then(Value::as_i64)
                .ok_or(st::StockError::InvalidContract)?;
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&number) {
                return unavailable();
            }
            json!({"kind":"number","value":number})
        }
        "boolean" => {
            json!({"kind":"boolean","value":field.get("booleanValue").and_then(Value::as_bool).ok_or(st::StockError::InvalidContract)?})
        }
        "time" => {
            // TemplateField exposes timeValue; EntityFieldData does not.
            let value = string(field, "timeValue")?;
            Timestamp::parse(value).map_err(|_| st::StockError::OwnerUnavailable)?;
            json!({"kind":"time","value":value})
        }
        _ => return unavailable(),
    };
    let field_id = id(field.get("id").ok_or(st::StockError::InvalidContract)?)?;
    Ok(json!({"id":field_id,"name":name,"value":value}))
}
fn template_data(query: &HomeBoxReadQuery, raw: &Value) -> st::StockResult<Value> {
    let name = string(raw, "name")?;
    let fields = array_field(raw, "fields")?
        .iter()
        .map(field_data)
        .collect::<st::StockResult<Vec<_>>>()?;
    let mut data = Map::new();
    data.insert("name".into(), json!(name));
    data.insert("fields".into(), json!(fields));
    for key in [
        "description",
        "notes",
        "defaultName",
        "defaultDescription",
        "defaultManufacturer",
        "defaultModelNumber",
        "defaultQuantity",
        "defaultInsured",
        "defaultLifetimeWarranty",
        "defaultWarrantyDetails",
    ] {
        if let Some(v) = raw.get(key) {
            data.insert(key.into(), v.clone());
        }
    }
    for (native, stock) in [
        ("includePurchaseFields", "includePurchaseDetails"),
        ("includeSoldFields", "includeSoldDetails"),
        ("includeWarrantyFields", "includeWarrantyDetails"),
    ] {
        if let Some(v) = raw.get(native) {
            if !v.is_boolean() {
                return invalid();
            }
            data.insert(stock.into(), v.clone());
        }
    }
    if let Some(location) = raw.get("defaultLocation") {
        if location.is_null() {
            data.insert("defaultLocation".into(), Value::Null);
        } else {
            data.insert(
                "defaultLocation".into(),
                qualify(query, HomeboxResourceKind::Entity, location)?,
            );
        }
    }
    if let Some(tags) = raw.get("defaultTags") {
        let tags = tags.as_array().ok_or(st::StockError::InvalidContract)?;
        data.insert(
            "defaultTags".into(),
            Value::Array(
                tags.iter()
                    .map(|tag| qualify(query, HomeboxResourceKind::Tag, tag))
                    .collect::<st::StockResult<Vec<_>>>()?,
            ),
        );
    }
    Ok(Value::Object(data))
}
fn qualify(
    query: &HomeBoxReadQuery,
    kind: HomeboxResourceKind,
    value: &Value,
) -> st::StockResult<Value> {
    let id = id(value.get("id").ok_or(st::StockError::InvalidContract)?)?;
    serde_json::to_value(target(query, kind, id)).map_err(|_| st::StockError::InvalidContract)
}
fn path_data(raw: &Value, retrieved_at: &Timestamp) -> st::StockResult<Value> {
    let name = string(raw, "name")?;
    let _id = id(raw.get("id").ok_or(st::StockError::InvalidContract)?)?;
    // Path observations describe names and native location/item classification;
    // they do not establish the source's full entity type or placement graph.
    Ok(json!({"name":name,"retrievedAt":retrieved_at}))
}
fn flatten_tree<'a>(
    nodes: &'a [Value],
    parent: Option<&str>,
    out: &mut Vec<(&'a Value, Option<String>)>,
) -> st::StockResult<()> {
    for node in nodes {
        let node_id = id(node.get("id").ok_or(st::StockError::InvalidContract)?)?;
        if out.len() >= 100 {
            return unavailable();
        }
        out.push((node, parent.map(str::to_owned)));
        let children = match node.get("children") {
            Some(Value::Array(v)) => v.as_slice(),
            Some(Value::Null) => &[],
            None => return unavailable(),
            _ => return invalid(),
        };
        flatten_tree(children, Some(node_id), out)?;
    }
    Ok(())
}

/// Convert only captured decoded native observations with complete resource facts.
/// This function does not establish access, ancestry, or whole-source disclosure.
pub(super) fn native_resources(
    query: &HomeBoxReadQuery,
    source: &Value,
    retrieved_at: &Timestamp,
    status: SourceStatus,
) -> st::StockResult<ResourcePage> {
    let (op, _page, requested) = selected(query)?;
    let (kind, selected_rows) = match op {
        Op::HomeboxTagList | Op::HomeboxTagGet => {
            let all: Vec<&Value> = if op == Op::HomeboxTagList {
                rows(source)?.iter().collect()
            } else {
                vec![source]
            };
            let selected = only_requested(&all, requested, op == Op::HomeboxTagGet)?;
            (HomeboxResourceKind::Tag, selected)
        }
        Op::HomeboxEntityTypeList => {
            let all = rows(source)?.iter().collect::<Vec<_>>();
            (HomeboxResourceKind::EntityType, all)
        }
        Op::HomeboxTemplateGet => {
            let raw_id = source.get("id").ok_or(st::StockError::InvalidContract)?;
            if Some(id(raw_id)?) != requested {
                return unavailable();
            }
            (HomeboxResourceKind::Template, vec![source])
        }
        Op::HomeboxEntityPath => {
            let path = rows(source)?;
            if path
                .iter()
                .filter(|row| row["id"].as_str() == requested)
                .count()
                != 1
                || path.last().and_then(|row| row["id"].as_str()) != requested
            {
                return unavailable();
            }
            let mut resources = Vec::new();
            for raw in path {
                let rid = raw.get("id").ok_or(st::StockError::InvalidContract)?;
                let data = path_data(raw, retrieved_at)?;
                resources.push(view(
                    query,
                    HomeboxResourceKind::Entity,
                    rid,
                    raw,
                    data,
                    retrieved_at,
                )?);
            }
            if resources.len() > 100 {
                return unavailable();
            }
            return page(query, resources, retrieved_at, status);
        }
        Op::HomeboxLocationTree => {
            let mut flat = Vec::new();
            flatten_tree(rows(source)?, None, &mut flat)?;
            let mut resources = Vec::new();
            for (raw, parent) in flat {
                let rid = raw.get("id").ok_or(st::StockError::InvalidContract)?;
                let name = string(raw, "name")?;
                let mut data = json!({"name":name,"retrievedAt":retrieved_at});
                if let Some(parent_id) = parent {
                    data["parentId"] = json!(parent_id);
                }
                resources.push(view(
                    query,
                    HomeboxResourceKind::Entity,
                    rid,
                    raw,
                    data,
                    retrieved_at,
                )?);
            }
            if resources.len() > 100 {
                return unavailable();
            }
            return page(query, resources, retrieved_at, status);
        }
        _ => return unavailable(),
    };
    let mut resources = Vec::new();
    for raw in selected_rows {
        let rid = raw.get("id").ok_or(st::StockError::InvalidContract)?;
        let data = match op {
            Op::HomeboxTagList | Op::HomeboxTagGet => tag_data(raw)?,
            Op::HomeboxEntityTypeList => type_data(raw)?,
            Op::HomeboxTemplateGet => template_data(query, raw)?,
            _ => return unavailable(),
        };
        resources.push(view(query, kind.clone(), rid, raw, data, retrieved_at)?);
    }
    page(query, resources, retrieved_at, status)
}
