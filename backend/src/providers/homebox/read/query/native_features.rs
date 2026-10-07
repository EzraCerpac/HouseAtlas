//! Native metadata query projections, not artifact or credential brokerage.
use super::super::Timestamp;
use super::*;
use crate::domain::stock as st;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

pub(super) fn asset_lookup(
    query: &HomeBoxReadQuery,
    request: &st::ValidatedRequest,
    decoded: &crate::providers::homebox::wire::Decoded<crate::providers::homebox::wire::Detail>,
    retrieved_at: &Timestamp,
) -> st::StockResult<FeatureRead> {
    use crate::{
        contracts::{
            semantics,
            stock::{HomeboxResourceKind, StockTarget},
        },
        providers::homebox::wire,
    };
    let ReadSelection::Feature(FeatureQuery::Query {
        view: QueryView::AssetLookup,
        ..
    }) = query.selection()
    else {
        return Err(st::StockError::OwnerUnavailable);
    };
    let fresh = wire::decode_detail(
        &decoded.original,
        &decoded.value.summary.id,
        wire::DecodeLimits::default(),
    )
    .map_err(|_| st::StockError::InvalidContract)?;
    // Formatting aliases need the source owner's qualified correlation.
    if fresh.source != decoded.source || fresh.source["assetId"] != request.payload()["assetId"] {
        return Err(st::StockError::OwnerUnavailable);
    }
    let digest =
        semantics::canonical_digest(&json!({"scope":query.scope(),"resource":fresh.source}))
            .map_err(|_| st::StockError::InvalidContract)?;
    let row = ResourceView {
        target: StockTarget::Homebox {
            source_instance_id: query.scope().source_instance_id.as_str().into(),
            collection_id: query.scope().collection_id.clone(),
            resource_kind: HomeboxResourceKind::Entity,
            entity_id: None,
            resource_id: Some(fresh.value.summary.id.as_str().into()),
        },
        observation: ReadObservation::ObservationOnly { digest },
        data: json!({"name":fresh.value.summary.name,"description":fresh.value.entity.description,
            "entityType":fresh.value.summary.entity_type,"parentId":fresh.value.summary.parent.as_ref().map(|p|p.id.as_str()),
            "archived":fresh.value.summary.archived,"quantity":fresh.source["quantity"],
            "retrievedAt":retrieved_at,"updatedAt":fresh.value.summary.updated_at}),
        retrieved_at: retrieved_at.clone(),
    };
    Ok(FeatureRead {
        scope: query.scope().clone(),
        retrieved_at: retrieved_at.clone(),
        data: FeatureData::Query(json!({"kind":"asset-lookup","rows":[row]})),
    })
}

fn fields(source: &Value, names: &[&str]) -> st::StockResult<Value> {
    let mut result = Map::new();
    for name in names {
        result.insert(
            (*name).into(),
            source
                .get(*name)
                .ok_or(st::StockError::InvalidContract)?
                .clone(),
        );
    }
    Ok(Value::Object(result))
}

fn rows(source: &Value) -> st::StockResult<&[Value]> {
    match source {
        Value::Null => Ok(&[]), // Native Go nil slice is an observed empty slice.
        Value::Array(rows) => Ok(rows),
        _ => Err(st::StockError::InvalidContract),
    }
}

pub(super) fn native_feature(
    query: &HomeBoxReadQuery,
    request: &st::ValidatedRequest,
    source: &Value,
    retrieved_at: &Timestamp,
) -> st::StockResult<FeatureRead> {
    let ReadSelection::Feature(FeatureQuery::Query { view, limit }) = query.selection() else {
        return Err(st::StockError::OwnerUnavailable);
    };
    let kind = match view {
        QueryView::Currency => "currency",
        QueryView::Statistics => "statistics",
        QueryView::StatisticsLocations => "statistics-locations",
        QueryView::StatisticsTags => "statistics-tags",
        QueryView::StatisticsPurchasePrice => "statistics-purchase-price",
        QueryView::BarcodeProduct => "barcode-product",
        // Asset lookup needs native asset-ID/request correlation; collection
        // maintenance still needs the date-only/date-time owner reconciliation.
        QueryView::AssetLookup | QueryView::Maintenance => {
            return Err(st::StockError::OwnerUnavailable);
        }
    };
    let data = match view {
        QueryView::Currency => json!({"kind":kind,"currency":fields(source,
            &["code","decimals","name","symbol","local"])?}),
        QueryView::Statistics => json!({"kind":kind,"statistics":fields(source,
            &["totalItemPrice","totalItems","totalLocations","totalTags","totalUsers","totalWithWarranty"])?}),
        QueryView::StatisticsLocations | QueryView::StatisticsTags => {
            let mut projected = Vec::new();
            let mut seen = BTreeSet::new();
            for row in rows(source)? {
                let id = row["id"].as_str().ok_or(st::StockError::InvalidContract)?;
                super::super::Uuid::parse(id).map_err(|_| st::StockError::InvalidContract)?;
                if !seen.insert(id) {
                    return Err(st::StockError::InvalidContract);
                }
                projected.push(fields(row, &["id", "name", "total"])?);
            }
            json!({"kind":kind,"rows":projected})
        }
        QueryView::StatisticsPurchasePrice => {
            let mut data = fields(source, &["start", "end", "valueAtStart", "valueAtEnd"])?;
            let mut entries = Vec::new();
            for row in rows(
                source
                    .get("entries")
                    .ok_or(st::StockError::InvalidContract)?,
            )? {
                entries.push(fields(row, &["date", "value"])?);
            }
            data["kind"] = json!(kind);
            data["entries"] = json!(entries);
            data
        }
        QueryView::BarcodeProduct => {
            let mut projected = Vec::new();
            for row in rows(source)? {
                if row["barcode"] != request.payload()["barcode"] {
                    return Err(st::StockError::CorrelationMismatch);
                }
                let mut data = fields(row, &["barcode", "manufacturer", "modelNumber", "notes"])?;
                data["sourceName"] = row
                    .get("search_engine_name")
                    .ok_or(st::StockError::InvalidContract)?
                    .clone();
                // There is no managed image handle in the native response.
                // Preserve source image fields privately; token availability
                // remains unknown until the actual image broker is supplied.
                data["imageToken"] = Value::Null;
                projected.push(data);
            }
            json!({"kind":kind,"rows":projected})
        }
        _ => return Err(st::StockError::OwnerUnavailable),
    };
    for key in ["rows", "entries"] {
        if data[key]
            .as_array()
            .is_some_and(|rows| rows.len() as u64 > *limit)
        {
            return Err(st::StockError::OwnerUnavailable);
        }
    }
    // Native number tokens and operational timestamp spellings are cloned,
    // never parsed through floats or calendar-to-midnight conversions.
    Ok(FeatureRead {
        scope: query.scope().clone(),
        retrieved_at: retrieved_at.clone(),
        data: FeatureData::Query(data),
    })
}
