use super::*;
use crate::providers::homebox::read::{Attachment, Entity, EntityType, Parent, Timestamp, Uuid};
use serde_json::{Number, Value};
use std::collections::BTreeMap;
use url::Url;

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, WireError> {
    value
        .as_object()
        .ok_or(WireError::Invalid)?
        .get(key)
        .ok_or(WireError::Invalid)
}
fn string(value: &Value, limits: DecodeLimits) -> Result<String, WireError> {
    let s = value.as_str().ok_or(WireError::Invalid)?;
    if s.chars().count() > limits.max_text_chars {
        return Err(WireError::Limit);
    }
    Ok(s.to_owned())
}
fn text(value: &Value, key: &str, limits: DecodeLimits) -> Result<String, WireError> {
    string(field(value, key)?, limits)
}
fn uuid(value: &Value) -> Result<Uuid, WireError> {
    Uuid::parse(value.as_str().ok_or(WireError::Invalid)?).map_err(|_| WireError::Invalid)
}
fn timestamp(value: &Value) -> Result<Timestamp, WireError> {
    Timestamp::parse(value.as_str().ok_or(WireError::Invalid)?).map_err(|_| WireError::Invalid)
}
fn boolean(value: &Value, key: &str) -> Result<bool, WireError> {
    field(value, key)?.as_bool().ok_or(WireError::Invalid)
}
fn number(value: &Value, key: &str) -> Result<f64, WireError> {
    field(value, key)?
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or(WireError::Invalid)
}
fn integer(value: &Value, key: &str) -> Result<u64, WireError> {
    // Native Go pagination emits integer tokens. Do not truncate or coerce strings.
    field(value, key)?.as_u64().ok_or(WireError::Invalid)
}
fn array(value: &Value, limits: DecodeLimits) -> Result<&[Value], WireError> {
    // Go nil slices serialize as null; no source rows are inferred from them.
    let rows = if value.is_null() {
        &[][..]
    } else {
        value.as_array().ok_or(WireError::Invalid)?.as_slice()
    };
    if rows.len() > limits.max_entries {
        return Err(WireError::Limit);
    }
    Ok(rows)
}
fn summary(value: &Value, limits: DecodeLimits) -> Result<Summary, WireError> {
    let entity_type = match value.get("entityType") {
        None | Some(Value::Null) => None,
        Some(kind) => Some(EntityType {
            id: uuid(field(kind, "id")?)?,
            name: text(kind, "name", limits)?,
            is_location: boolean(kind, "isLocation")?,
        }),
    };
    let parent = match value.get("parent") {
        None | Some(Value::Null) => None,
        Some(parent) => Some(Parent {
            id: uuid(field(parent, "id")?)?,
        }),
    };
    Ok(Summary {
        id: uuid(field(value, "id")?)?,
        name: text(value, "name", limits)?,
        archived: boolean(value, "archived")?,
        updated_at: timestamp(field(value, "updatedAt")?)?,
        entity_type,
        parent,
    })
}
fn decoded<T>(bytes: &[u8], source: Value, value: T) -> Decoded<T> {
    Decoded {
        original: bytes.to_vec(),
        source,
        value,
    }
}

/// Decode actual repo.EntityListResult (or its empty PaginationResult).
/// Source authorization, duplicate conflicts across pages and total drift remain
/// reader-owned. Type-less rows are in the item partition per QueryByGroup.
pub fn decode_page(
    bytes: &[u8],
    request: &PageRequest,
    limits: DecodeLimits,
) -> Result<Decoded<Page>, WireError> {
    request.query()?;
    let source = json::parse(bytes, limits)?;
    let page = integer(&source, "page")?;
    let page_size = integer(&source, "pageSize")?;
    let total = integer(&source, "total")?;
    let rows = array(field(&source, "items")?, limits)?;
    if page != request.page || page_size != request.page_size || total > limits.max_entries as u64 {
        return Err(WireError::Pagination);
    }
    let offset = (page - 1)
        .checked_mul(page_size)
        .ok_or(WireError::Pagination)?;
    if rows.len() as u64 != page_size.min(total.saturating_sub(offset)) {
        return Err(WireError::Pagination);
    }
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let item = summary(row, limits)?;
        if item
            .entity_type
            .as_ref()
            .is_some_and(|kind| kind.is_location != request.is_location)
            || (request.is_location && item.entity_type.is_none())
            || (!request.parent_ids.is_empty()
                && !item
                    .parent
                    .as_ref()
                    .is_some_and(|p| request.parent_ids.contains(&p.id)))
        {
            return Err(WireError::Pagination);
        }
        items.push(item);
    }
    Ok(decoded(
        bytes,
        source,
        Page {
            items,
            page,
            page_size,
            total,
        },
    ))
}

fn attachments(value: &Value, limits: DecodeLimits) -> Result<Vec<Attachment>, WireError> {
    let mut result = BTreeMap::new();
    for raw in array(value, limits)? {
        let id = uuid(field(raw, "id")?)?;
        let title = text(raw, "title", limits)?;
        // source ItemAttachment has no byteSize or archived field.
        let mime = match raw.get("mimeType") {
            None => None,
            Some(value) => Some(string(value, limits)?),
        };
        let path = text(raw, "path", limits)?;
        let attachment = if mime.as_deref() == Some("link/url") {
            fluent_uri::Uri::parse(path.as_str()).map_err(|_| WireError::Invalid)?;
            let url = Url::parse(&path).map_err(|_| WireError::Invalid)?;
            if !(path.starts_with("http://") || path.starts_with("https://"))
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(WireError::Invalid);
            }
            Attachment::ExternalLink {
                attachment_id: id,
                title,
                url: path,
                archived: false,
            }
        } else {
            Attachment::StoredFile {
                attachment_id: id,
                title,
                content_type: mime.filter(|s| !s.is_empty()),
                byte_size: None,
                proxy_ref: None,
            }
        };
        if result.insert(attachment.id().clone(), attachment).is_some() {
            return Err(WireError::Invalid);
        }
    }
    Ok(result.into_values().collect())
}

/// Decode repo.EntityOut including native attachments/null Go slices. Paths for
/// stored files are retained in source, never promoted to media capabilities.
pub fn decode_detail(
    bytes: &[u8],
    requested_id: &Uuid,
    limits: DecodeLimits,
) -> Result<Decoded<Detail>, WireError> {
    let source = json::parse(bytes, limits)?;
    let summary = summary(&source, limits)?;
    if summary.id != *requested_id {
        return Err(WireError::WrongEntity);
    }
    let entity = Entity {
        id: summary.id.clone(),
        name: summary.name.clone(),
        description: text(&source, "description", limits)?,
        entity_type: summary.entity_type.clone(),
        parent: summary.parent.clone(),
        archived: summary.archived,
        quantity: Some(number(&source, "quantity")?),
        manufacturer: Some(text(&source, "manufacturer", limits)?),
        model_number: Some(text(&source, "modelNumber", limits)?),
        serial_number: Some(text(&source, "serialNumber", limits)?),
        notes: Some(text(&source, "notes", limits)?),
    };
    let attachments = attachments(field(&source, "attachments")?, limits)?;
    Ok(decoded(
        bytes,
        source,
        Detail {
            summary,
            entity,
            attachments,
        },
    ))
}

fn date(value: &Value) -> Result<Option<CalendarDate>, WireError> {
    let s = value.as_str().ok_or(WireError::Invalid)?;
    if s.is_empty() {
        Ok(None)
    } else {
        CalendarDate::parse(s).map(Some)
    }
}

/// Decode repo.MaintenanceEntryWithDetails[] from the entity endpoint with
/// status=both. Check exact itemID before dropping itemName from the projection.
pub fn decode_maintenance(
    bytes: &[u8],
    requested_id: &Uuid,
    limits: DecodeLimits,
) -> Result<Decoded<MaintenanceLog>, WireError> {
    let source = json::parse(bytes, limits)?;
    let mut result = BTreeMap::new();
    for raw in array(&source, limits)? {
        if uuid(field(raw, "itemID")?)? != *requested_id {
            return Err(WireError::WrongEntity);
        }
        text(raw, "itemName", limits)?;
        let cost_text = text(raw, "cost", limits)?;
        let cost: Number = serde_json::from_str(&cost_text).map_err(|_| WireError::Invalid)?;
        if cost.as_f64().is_none_or(|n| !n.is_finite()) {
            return Err(WireError::Invalid);
        }
        let entry = Maintenance {
            entry_id: uuid(field(raw, "id")?)?,
            name: text(raw, "name", limits)?,
            description: text(raw, "description", limits)?,
            scheduled_date: date(field(raw, "scheduledDate")?)?,
            completed_date: date(field(raw, "completedDate")?)?,
            cost,
        };
        if result.insert(entry.entry_id.clone(), entry).is_some() {
            return Err(WireError::Invalid);
        }
    }
    Ok(decoded(
        bytes,
        source,
        MaintenanceLog {
            entity_id: requested_id.clone(),
            entries: result.into_values().collect(),
        },
    ))
}
