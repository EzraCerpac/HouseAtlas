//! Pure, bounded projections from the pinned native detail endpoints. The
//! caller still owns captured authority, source intake, and final wire3 checks.
use super::super::Timestamp;
use super::*;
use crate::{
    contracts::{
        semantics,
        stock::{HomeboxResourceKind, StockTarget},
    },
    domain::stock::{self as st, OperationId as Op},
    providers::homebox::wire,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn selected<'a>(
    query: &'a HomeBoxReadQuery,
    allowed: &[Op],
) -> st::StockResult<(Op, Option<&'a ListQuery>, &'a str, Option<&'a str>)> {
    let ReadSelection::Resources { operation, page } = query.selection() else {
        return Err(st::StockError::OwnerUnavailable);
    };
    if !allowed.contains(operation)
        || page
            .as_ref()
            .is_some_and(|p| p.cursor.is_some() || p.q.is_some())
    {
        return Err(st::StockError::OwnerUnavailable);
    }
    let StockTarget::Homebox {
        entity_id,
        resource_id,
        ..
    } = query.target()
    else {
        return Err(st::StockError::InvalidContract);
    };
    let owner = if *operation == Op::HomeboxEntityTagsGet {
        resource_id
            .as_deref()
            .ok_or(st::StockError::InvalidContract)?
    } else {
        entity_id
            .as_deref()
            .ok_or(st::StockError::InvalidContract)?
    };
    Ok((*operation, page.as_ref(), owner, resource_id.as_deref()))
}

fn view(
    query: &HomeBoxReadQuery,
    kind: HomeboxResourceKind,
    owner: &str,
    id: &str,
    raw: &Value,
    data: Value,
    at: &Timestamp,
) -> st::StockResult<ResourceView> {
    let digest =
        semantics::canonical_digest(&json!({"scope":query.scope(),"owner":owner,"native":raw}))
            .map_err(|_| st::StockError::InvalidContract)?;
    Ok(ResourceView {
        target: StockTarget::Homebox {
            source_instance_id: query.scope().source_instance_id.as_str().into(),
            collection_id: query.scope().collection_id.clone(),
            resource_kind: kind,
            entity_id: Some(owner.into()),
            resource_id: Some(id.into()),
        },
        observation: ReadObservation::ObservationOnly { digest },
        data,
        retrieved_at: at.clone(),
    })
}

fn page(
    query: &HomeBoxReadQuery,
    selected: Option<&ListQuery>,
    resources: Vec<ResourceView>,
    status: SourceStatus,
) -> st::StockResult<ResourcePage> {
    if resources.len() > selected.map_or(100, |p| p.page_size as usize) {
        return Err(st::StockError::OwnerUnavailable);
    }
    Ok(ResourcePage {
        scope: query.scope().clone(),
        resources,
        next_cursor: None,
        source_status: status,
    })
}

fn rows<'a>(source: &'a Value, key: &str) -> st::StockResult<&'a [Value]> {
    match source.get(key) {
        Some(Value::Null) => Ok(&[]),
        Some(Value::Array(rows)) => Ok(rows),
        _ => Err(st::StockError::InvalidContract),
    }
}

fn id(raw: &Value) -> st::StockResult<&str> {
    let s = raw
        .get("id")
        .and_then(Value::as_str)
        .ok_or(st::StockError::InvalidContract)?;
    super::super::Uuid::parse(s).map_err(|_| st::StockError::InvalidContract)?;
    Ok(s)
}

fn field_data(raw: &Value) -> st::StockResult<Value> {
    let name = raw
        .get("name")
        .and_then(Value::as_str)
        .ok_or(st::StockError::InvalidContract)?;
    let kind = raw
        .get("type")
        .and_then(Value::as_str)
        .ok_or(st::StockError::InvalidContract)?;
    let value = match kind {
        "text" => {
            json!({"kind":"text","value":raw.get("textValue").and_then(Value::as_str).ok_or(st::StockError::InvalidContract)?})
        }
        "number" => {
            let n = raw
                .get("numberValue")
                .and_then(Value::as_i64)
                .ok_or(st::StockError::InvalidContract)?;
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n) {
                return Err(st::StockError::OwnerUnavailable);
            }
            json!({"kind":"number","value":n})
        }
        "boolean" => {
            json!({"kind":"boolean","value":raw.get("booleanValue").and_then(Value::as_bool).ok_or(st::StockError::InvalidContract)?})
        }
        // The v0.26.2 EntityFieldData omits timeValue. Its absence is explicit.
        "time" => {
            json!({"kind":"time","valueState":"unavailable","reason":"baseline-time-value-unexposed"})
        }
        _ => return Err(st::StockError::OwnerUnavailable),
    };
    Ok(json!({"name":name,"value":value}))
}

/// SOURCE-ONLY detail conversion. Re-decode original bytes with the stock cap;
/// a caller-constructed DTO/source cannot alter the facts projected here.
pub fn detail_resources(
    query: &HomeBoxReadQuery,
    decoded: &wire::Decoded<wire::Detail>,
    retrieved_at: &Timestamp,
    status: SourceStatus,
) -> st::StockResult<ResourcePage> {
    let (operation, selected_page, owner, requested) = selected(
        query,
        &[
            Op::HomeboxEntityTagsGet,
            Op::HomeboxFieldList,
            Op::HomeboxFieldGet,
            Op::HomeboxFileList,
            Op::HomeboxFileGet,
            Op::HomeboxDocumentLinkList,
            Op::HomeboxDocumentLinkGet,
        ],
    )?;
    let owner_id = super::super::Uuid::parse(owner).map_err(|_| st::StockError::InvalidContract)?;
    let fresh = wire::decode_detail(&decoded.original, &owner_id, wire::DecodeLimits::default())
        .map_err(|_| st::StockError::InvalidContract)?;
    if fresh.source != decoded.source || fresh.value.summary.id != decoded.value.summary.id {
        return Err(st::StockError::InvalidContract);
    }
    if operation == Op::HomeboxEntityTagsGet {
        if requested != Some(owner) {
            return Err(st::StockError::CorrelationMismatch);
        }
        let mut tag_ids = Vec::new();
        let mut seen = BTreeSet::new();
        for raw in rows(&fresh.source, "tags")? {
            let tag_id = id(raw)?;
            if !seen.insert(tag_id) {
                return Err(st::StockError::InvalidContract);
            }
            tag_ids.push(tag_id);
        }
        let data = json!({"retrievedAt":retrieved_at,"tagIds":tag_ids});
        let mut resource = view(
            query,
            HomeboxResourceKind::Entity,
            owner,
            owner,
            &fresh.source,
            data,
            retrieved_at,
        )?;
        if let StockTarget::Homebox { entity_id, .. } = &mut resource.target {
            *entity_id = None;
        }
        let resources = vec![resource];
        return page(query, selected_page, resources, status);
    }
    if matches!(operation, Op::HomeboxFileList | Op::HomeboxFileGet) {
        // Frozen file results demand archived:boolean. Native stored files
        // have no such source fact or typed interpretation.
        return Err(st::StockError::OwnerUnavailable);
    }
    if matches!(
        operation,
        Op::HomeboxDocumentLinkList | Op::HomeboxDocumentLinkGet
    ) {
        let get = operation == Op::HomeboxDocumentLinkGet;
        let mut resources = Vec::new();
        for raw in rows(&fresh.source, "attachments")? {
            let attachment_id = id(raw)?;
            let Some(super::super::Attachment::ExternalLink { title, url, .. }) = fresh
                .value
                .attachments
                .iter()
                .find(|a| a.id().as_str() == attachment_id)
            else {
                continue;
            };
            if get && requested != Some(attachment_id) {
                continue;
            }
            // The legacy decoder's false is a presentation convention, not
            // native archival evidence. Frozen wire3 can represent only false,
            // so require that exact fact in the original attachment bytes.
            let archived = raw
                .get("archived")
                .and_then(Value::as_bool)
                .ok_or(st::StockError::OwnerUnavailable)?;
            if archived {
                return Err(st::StockError::OwnerUnavailable);
            }
            let attachment_type = raw
                .get("type")
                .and_then(Value::as_str)
                .ok_or(st::StockError::InvalidContract)?;
            let primary = raw
                .get("primary")
                .and_then(Value::as_bool)
                .ok_or(st::StockError::InvalidContract)?;
            let data = json!({"title":title,"type":attachment_type,"primary":primary,"storage":"external-link","url":url,"archived":archived,"sha256":null,"byteSize":null});
            resources.push(view(
                query,
                HomeboxResourceKind::Attachment,
                owner,
                attachment_id,
                raw,
                data,
                retrieved_at,
            )?);
        }
        if get && resources.len() != 1 {
            return Err(st::StockError::OwnerUnavailable);
        }
        return page(query, selected_page, resources, status);
    }
    let get = operation == Op::HomeboxFieldGet;
    let mut resources = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in rows(&fresh.source, "fields")? {
        let field_id = id(raw)?;
        if !seen.insert(field_id) {
            return Err(st::StockError::InvalidContract);
        }
        if get && requested != Some(field_id) {
            continue;
        }
        resources.push(view(
            query,
            HomeboxResourceKind::Field,
            owner,
            field_id,
            raw,
            field_data(raw)?,
            retrieved_at,
        )?);
    }
    if get && resources.len() != 1 {
        return Err(st::StockError::OwnerUnavailable);
    }
    page(query, selected_page, resources, status)
}

fn decimal_cost(s: &str) -> bool {
    if s.len() > 64 {
        return false;
    }
    let text = s.strip_prefix('-').unwrap_or(s);
    let mut parts = text.split('.');
    let whole = parts.next().unwrap_or("");
    let fractional = parts.next();
    !whole.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && fractional.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_none()
}

/// The native maintenance date and decimal cost spelling survive unchanged.
pub fn maintenance_resources(
    query: &HomeBoxReadQuery,
    decoded: &wire::Decoded<wire::MaintenanceLog>,
    retrieved_at: &Timestamp,
    status: SourceStatus,
) -> st::StockResult<ResourcePage> {
    let (operation, selected_page, owner, requested) = selected(
        query,
        &[Op::HomeboxMaintenanceList, Op::HomeboxMaintenanceGet],
    )?;
    let owner_id = super::super::Uuid::parse(owner).map_err(|_| st::StockError::InvalidContract)?;
    let fresh =
        wire::decode_maintenance(&decoded.original, &owner_id, wire::DecodeLimits::default())
            .map_err(|_| st::StockError::InvalidContract)?;
    if fresh.source != decoded.source || fresh.value.entity_id() != decoded.value.entity_id() {
        return Err(st::StockError::InvalidContract);
    }
    let get = operation == Op::HomeboxMaintenanceGet;
    let raw_rows = fresh
        .source
        .as_array()
        .ok_or(st::StockError::InvalidContract)?;
    let mut resources = Vec::new();
    for entry in fresh.value.entries() {
        let entry_id = entry.entry_id.as_str();
        if get && requested != Some(entry_id) {
            continue;
        }
        let raw = raw_rows
            .iter()
            .find(|r| r.get("id").and_then(Value::as_str) == Some(entry_id))
            .ok_or(st::StockError::InvalidContract)?;
        let cost = raw
            .get("cost")
            .and_then(Value::as_str)
            .ok_or(st::StockError::InvalidContract)?;
        if !decimal_cost(cost) {
            return Err(st::StockError::OwnerUnavailable);
        }
        let data = json!({
            "name":entry.name, "description":entry.description, "cost":cost,
            "scheduledDate":entry.scheduled_date, "completedDate":entry.completed_date,
        });
        resources.push(view(
            query,
            HomeboxResourceKind::Maintenance,
            owner,
            entry_id,
            raw,
            data,
            retrieved_at,
        )?);
    }
    if get && resources.len() != 1 {
        return Err(st::StockError::OwnerUnavailable);
    }
    page(query, selected_page, resources, status)
}
