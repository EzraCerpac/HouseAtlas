//! Lossless conversion of genuinely available decoded cache entity facts.
//! No refresh, file capability, inferred placement, tags/fields, or history.
use super::super::{CacheState, PreviousGeneration, Timestamp, cache_freshness, decode};
use super::*;
use crate::{
    contracts::{
        semantics,
        stock::{HomeboxResourceKind, StockTarget},
    },
    domain::stock::{self as st, OperationId as Op},
};
use serde_json::{Value, json};

/// Pure cache projection for entity/location get/list only. The host must read
/// the actual same-store partition under original captured authority first.
/// Native search/cursor ownership and more-than-one-page data need the real
/// query owner; this helper never invents a cursor or truncates a full result.
pub fn cached_entity_page(
    query: &HomeBoxReadQuery,
    previous: &PreviousGeneration,
    now: &Timestamp,
    stale_after_ms: u64,
) -> st::StockResult<ResourcePage> {
    let ReadSelection::Resources { operation, page } = query.selection() else {
        return Err(st::StockError::OwnerUnavailable);
    };
    let locations = match operation {
        Op::HomeboxLocationGet | Op::HomeboxLocationList => true,
        Op::HomeboxEntityGet | Op::HomeboxEntityList => false,
        _ => return Err(st::StockError::OwnerUnavailable),
    };
    if previous.cache().scope() != *query.scope()
        || previous.quarantine
        || previous.cache().quarantined()
    {
        return Err(st::StockError::OwnerUnavailable);
    }
    if page
        .as_ref()
        .is_some_and(|p| p.cursor.is_some() || p.q.is_some())
    {
        return Err(st::StockError::OwnerUnavailable);
    }
    let StockTarget::Homebox { resource_id, .. } = query.target() else {
        return Err(st::StockError::InvalidContract);
    };
    let (cache, _) = cache_freshness(previous.cache(), now, stale_after_ms);
    let source_status = match cache.status {
        CacheState::Fresh => SourceStatus::Current,
        CacheState::Stale | CacheState::Error => SourceStatus::Stale,
        CacheState::Empty => SourceStatus::Unavailable,
        CacheState::AccessRevoked => return Err(st::StockError::OwnerUnavailable),
    };
    let mut resources = Vec::new();
    for row in previous.entities() {
        // A retained descriptor may explicitly have an unverified native route.
        // This read exposes no navigation, so validate only the disclosed facts
        // on a copy. Keep the original descriptor in the retained row and digest;
        // never bless a route or weaken the native-navigation validator.
        let mut facts = row.clone();
        facts.native_links.clear();
        decode::validate_projection(&facts, query.scope())
            .map_err(|_| st::StockError::InvalidContract)?;
        let is_location = row
            .entity
            .entity_type
            .as_ref()
            .is_some_and(|t| t.is_location);
        if is_location != locations
            || resource_id
                .as_ref()
                .is_some_and(|id| id != row.entity.id.as_str())
            || page
                .as_ref()
                .is_some_and(|p| !p.include_archived && row.entity.archived)
        {
            continue;
        }
        let mut data = json!({"name":row.entity.name,"description":row.entity.description,"entityType":row.entity.entity_type,"parentId":row.entity.parent.as_ref().map(|p|&p.id),"archived":row.entity.archived,"retrievedAt":row.retrieved_at,"updatedAt":row.source_updated_at,"attachmentIds":row.attachments.iter().map(|a|a.id()).collect::<Vec<_>>(),"maintenanceIds":row.maintenance.iter().map(|m|&m.entry_id).collect::<Vec<_>>()});
        if let Some(quantity) = row.entity.quantity {
            data["quantity"] = json!(quantity);
        }
        let mut scalars = serde_json::Map::new();
        for (key, value) in [
            ("manufacturer", &row.entity.manufacturer),
            ("modelNumber", &row.entity.model_number),
            ("serialNumber", &row.entity.serial_number),
            ("notes", &row.entity.notes),
        ] {
            if let Some(value) = value {
                scalars.insert(key.into(), json!(value));
            }
        }
        if !scalars.is_empty() {
            data["scalars"] = Value::Object(scalars);
        }
        let digest = semantics::canonical_digest(
            &serde_json::to_value(row).map_err(|_| st::StockError::InvalidContract)?,
        )
        .map_err(|_| st::StockError::InvalidContract)?;
        resources.push(ResourceView {
            target: StockTarget::Homebox {
                source_instance_id: query.scope().source_instance_id.as_str().into(),
                collection_id: query.scope().collection_id.clone(),
                resource_kind: HomeboxResourceKind::Entity,
                entity_id: None,
                resource_id: Some(row.entity.id.as_str().into()),
            },
            observation: ReadObservation::ObservationOnly { digest },
            data,
            retrieved_at: row.retrieved_at.clone(),
        });
    }
    resources.sort_by(|a, b| {
        // UUID identities define only a stable listing order, never placement.
        let id = |r: &ResourceView| match &r.target {
            StockTarget::Homebox { resource_id, .. } => resource_id.clone(),
            _ => None,
        };
        id(a).cmp(&id(b))
    });
    if resources.len() > page.as_ref().map_or(100, |p| p.page_size as usize) {
        return Err(st::StockError::OwnerUnavailable);
    }
    Ok(ResourcePage {
        scope: query.scope().clone(),
        resources,
        next_cursor: None,
        source_status,
    })
}
