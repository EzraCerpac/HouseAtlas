//! Authenticated current-head read. Historical Stock get/list/history remain
//! available separately; this route never guesses a head from dates or IDs.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, failure, json_response, stock_reads,
};
use crate::{
    domain::{self as d, stock as st},
    media as m, storage as s,
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use m::service::MediaStoragePort;
use serde_json::{Value, json};
use std::time::Duration;

pub(super) async fn current(
    State(host): State<Host>,
    Path((workspace_id, home_id, building_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() || !m::types::is_uuid(&building_id) {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(&host, &headers, &uri, &method,
            Some(d::Scope {workspace_id, home_id}), false, |core, principal, home| {
            let selected = s::Scope {
                workspace_id: home.scope.workspace_id.clone(),
                home_id: home.scope.home_id.clone(),
            };
            let contracts = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
            let raw = json!({"schemaVersion":3,"commandId":"atlas.scene-association.list",
                "requestId":crate::app::new_id().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                "context":home.scope,"target":{"authority":"atlas","recordType":"scene-association"},
                "payload":{"pageSize":1,"cursor":null,"includeArchived":false}});
            let request = st::ValidatedRequest::parse(&contracts, raw)
                .map_err(stock_reads::http_error)?;
            let graph = stock_reads::snapshot(&core.store, principal, &request)
                .map_err(stock_reads::http_error)?;
            let head = match st::current_scene_head(&graph, &selected, &building_id) {
                Ok(Some(head)) => head,
                Ok(None) => return Ok(json_response(json!({"status":"unavailable",
                    "reason":"no-current-association","association":null}))),
                Err(st::SceneHeadError::Unavailable) => return Ok(json_response(json!({
                    "status":"unavailable","reason":"current-source-unavailable",
                    "association":null}))),
                Err(st::SceneHeadError::Conflict) => return Err(failure(StatusCode::CONFLICT)),
            };
            let docs = head.payload["sourceDocuments"].as_array()
                .ok_or_else(|| failure(StatusCode::CONFLICT))?;
            if docs.len() != 2 { return Err(failure(StatusCode::CONFLICT)); }
            let media_scope = m::types::Scope {
                workspace_id: selected.workspace_id.clone(), home_id: selected.home_id.clone(),
            };
            let owner = m::native::NativeMediaStorage::new(&core.store);
            let budget = m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default())
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let mut primary = None;
            let mut historical = None;
            for doc in docs {
                let id = doc["originalAssetId"].as_str()
                    .ok_or_else(|| failure(StatusCode::CONFLICT))?;
                let owned = owner.read_owned_asset(principal, &media_scope, id)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                if owned.record.payload != owned.manifest
                    || owned.record.revision != doc["originalAssetRevision"].as_u64()
                        .ok_or_else(|| failure(StatusCode::CONFLICT))?
                    || owned.record.payload.sha256 != doc["originalSha256"]
                { return Err(failure(StatusCode::CONFLICT)); }
                let bytes = core.vault.read_retained(&owned.record, &budget)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                match doc["role"].as_str() {
                    Some("primary-scene") if primary.is_none() => primary = Some(bytes),
                    Some("documentary-sheet") if historical.is_none() => historical = Some(bytes),
                    _ => return Err(failure(StatusCode::CONFLICT)),
                }
            }
            let primary = primary.ok_or_else(|| failure(StatusCode::CONFLICT))?;
            let historical = historical.ok_or_else(|| failure(StatusCode::CONFLICT))?;
            let facts = m::scene_association::qualify_document(&primary, &head.payload, &budget)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            if m::types::sha256(&historical) != facts.historical_source_receipt_sha256 {
                return Err(failure(StatusCode::CONFLICT));
            }
            let native_floors = m::geometry_bundle::floors(&graph, &selected,
                &building_id, &core.vault, &budget)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
            let proposed = head.payload["sourceFloors"].as_array()
                .ok_or_else(|| failure(StatusCode::CONFLICT))?;
            if proposed.iter().any(|floor| !native_floors.iter().any(|item|
                floor["nativeFloorKey"] == item.descriptor.key
                    && floor["nativeGeometryId"] == item.descriptor.geometry_id
                    && floor["nativeGeometryRevision"] == item.descriptor.geometry_revision
                    && floor["nativeOriginalAssetId"] == item.descriptor.original_asset_id
                    && floor["nativeOriginalSha256"] == item.descriptor.original_sha256)) {
                return Err(failure(StatusCode::CONFLICT));
            }
            Ok(json_response(json!({"status":"available","association":head})))
        })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

const MAX_HEAD_RESPONSE_BYTES: usize = 4096;

/// Compact native-chain metadata only. This deliberately does not re-qualify
/// current descriptor keys or retained scene bytes, so a previously committed
/// head can still be compared after the building's evidence frame changes.
fn head_response(graph: &s::Snapshot, selected: &s::Scope, building_id: &str) -> HttpResult {
    let (status, reason, head) = match st::current_scene_head(graph, selected, building_id) {
        Ok(Some(head)) => (
            "available",
            None,
            json!({
                "recordId": head.record_id,
                "revision": head.revision,
                "payloadSha256": st::canonical_digest(&head.payload)
                    .map_err(stock_reads::http_error)?,
            }),
        ),
        Ok(None) => ("unavailable", Some("no-current-association"), Value::Null),
        Err(st::SceneHeadError::Unavailable) => (
            "unavailable",
            Some("current-source-unavailable"),
            Value::Null,
        ),
        Err(st::SceneHeadError::Conflict) => return Err(failure(StatusCode::CONFLICT)),
    };
    let body = json!({
        "schema": "houseatlas.native-scene-head.v1",
        "scope": {
            "workspaceId": selected.workspace_id,
            "homeId": selected.home_id,
        },
        "buildingId": building_id,
        "status": status,
        "reason": reason,
        "head": head,
    });
    if serde_json::to_vec(&body)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
        .len()
        > MAX_HEAD_RESPONSE_BYTES
    {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    Ok(json_response(body))
}

pub(super) async fn head(
    State(host): State<Host>,
    Path((workspace_id, home_id, building_id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() || !m::types::is_uuid(&building_id) {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            false,
            |core, principal, home| {
                let selected = s::Scope {
                    workspace_id: home.scope.workspace_id.clone(),
                    home_id: home.scope.home_id.clone(),
                };
                let contracts = st::NativeStockContract::new().map_err(stock_reads::http_error)?;
                let raw = json!({
                    "schemaVersion": 3,
                    "commandId": "atlas.scene-association.list",
                    "requestId": crate::app::new_id()
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    "context": home.scope,
                    "target": {"authority": "atlas", "recordType": "scene-association"},
                    "payload": {"pageSize": 1, "cursor": null, "includeArchived": false},
                });
                let request = st::ValidatedRequest::parse(&contracts, raw)
                    .map_err(stock_reads::http_error)?;
                let graph = stock_reads::snapshot(&core.store, principal, &request)
                    .map_err(stock_reads::http_error)?;
                head_response(&graph, &selected, &building_id)
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
