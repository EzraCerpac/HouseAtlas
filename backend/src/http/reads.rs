//! Canonical frozen record/history/page reads over the actual storage peer.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, domain_error, failure, json_response,
};
use crate::storage::Contract;
use crate::{
    app::{HomeAuthority, Reads},
    domain as d,
    http::contracts::NativeContracts,
    storage as s,
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::sync::Arc;

type ScopedRecord = (String, String, String, String);
fn no_query(uri: &Uri) -> Result<(), super::HttpFailure> {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    Ok(())
}
fn target(kind: String, id: String) -> Result<d::RecordRef, super::HttpFailure> {
    let raw = json!({"recordType":kind,"recordId":id});
    NativeContracts
        .validate_shape("recordRef", &raw)
        .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    serde_json::from_value(raw).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))
}
pub(super) async fn record(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<ScopedRecord>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
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
            |core, p, home| {
                let target = target(kind, id)?;
                let mut query = d::Queries {
                    store: Reads(
                        core.store
                            .get_mut()
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    ),
                    access: HomeAuthority {
                        access: Arc::clone(&core.access),
                        home: home.clone(),
                    },
                };
                let result = query
                    .record(p, &home.scope, &target)
                    .map_err(domain_error)?;
                let value = serde_json::to_value(result)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                NativeContracts
                    .validate_shape("record", &value)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                Ok(json_response(value))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn history(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<ScopedRecord>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
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
            |core, p, home| {
                let target = target(kind, id)?;
                let mut query = d::Queries {
                    store: Reads(
                        core.store
                            .get_mut()
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                    ),
                    access: HomeAuthority {
                        access: Arc::clone(&core.access),
                        home: home.clone(),
                    },
                };
                let audits = query
                    .history(p, &home.scope, &target)
                    .map_err(domain_error)?;
                let value = serde_json::to_value(audits)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                crate::contracts::decode::<crate::contracts::HttpHistory>(
                    &serde_json::to_vec(&value)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                )
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                Ok(json_response(value))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn list(
    host: Host,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    workspace_id: String,
    home_id: String,
    collection: &'static str,
) -> HttpResult {
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
            |core, p, home| {
                let scope: s::Scope = serde_json::from_value(
                    serde_json::to_value(&home.scope)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                )
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let snapshot = core
                    .store
                    .get_mut()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                    .read_snapshot(p, &scope)
                    .map_err(|error| domain_error(crate::app::storage_error(error)))?;
                s::Contract::validate_snapshot(&NativeContracts, &snapshot)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let (items, shape): (Vec<Value>, &str) = match collection {
                    "records" => (
                        snapshot
                            .records
                            .iter()
                            .map(serde_json::to_value)
                            .collect::<Result<_, _>>()
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                        "record",
                    ),
                    "homebox/entities" => {
                        // Browser DTOs can replace unsafe external URLs with null;
                        // the frozen projection shape cannot. Retain exact safe URLs.
                        for projection in &snapshot.homebox_entities {
                            for attachment in projection["attachments"]
                                .as_array()
                                .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
                            {
                                if attachment["kind"] == "external-link"
                                    && !attachment["url"]
                                        .as_str()
                                        .is_some_and(|url| d::safe_web_url(url, false))
                                {
                                    return Err(domain_error(d::DomainError::UpstreamIncomplete));
                                }
                            }
                        }
                        (snapshot.homebox_entities, "homeboxProjection")
                    }
                    "network/relations" => (snapshot.network_relations, "networkRelation"),
                    _ => return Err(failure(StatusCode::SERVICE_UNAVAILABLE)),
                };
                for value in &items {
                    NativeContracts
                        .validate_shape(shape, value)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                }
                for status in &snapshot.caches {
                    NativeContracts
                        .validate_shape("cacheStatus", status)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                }
                let page = host
                    .pages
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                    .page(
                        &uri,
                        p,
                        headers.cookie.as_deref(),
                        collection,
                        items,
                        snapshot.caches,
                    )?;
                Ok(json_response(page))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn records(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(host, headers, uri, method, workspace_id, home_id, "records").await
}
pub(super) async fn homebox(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(
        host,
        headers,
        uri,
        method,
        workspace_id,
        home_id,
        "homebox/entities",
    )
    .await
}
pub(super) async fn network(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(
        host,
        headers,
        uri,
        method,
        workspace_id,
        home_id,
        "network/relations",
    )
    .await
}
pub(super) async fn view(
    state: State<Host>,
    path: Path<(String, String)>,
    headers: Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    super::scoped(state, path, headers, uri, method).await
}
