//! Same-origin stock host with exact caller envelopes and original AT11 authority.
pub mod capabilities;
mod errors;
pub mod mcp;
pub(crate) mod mcp_transport;
pub mod stock_dispatch;

use super::{CheckedHeaders, Host, HttpResult, authorized_read, failure, intake, json_response};
use crate::{domain as d, domain::stock as st};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::json;

pub(super) fn is_stock_response(response: &axum::response::Response) -> bool {
    response
        .extensions()
        .get::<errors::StockResponse>()
        .is_some()
}

pub(super) async fn admission(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(&host, &headers, &uri, &method, Some(d::Scope { workspace_id, home_id }), false, |_, p, home| {
            Ok(json_response(json!({"schemaVersion":3,"scope":home.scope,"commandIds":capabilities::admitted(&p.principal).iter().map(|id|id.as_str()).collect::<Vec<_>>(),"revision":"native-stock-host:3","maximumReasonCodePoints":1024})))
        })
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) async fn invoke(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    // Auth checks precede decoding the bounded envelope. Query is transport only;
    // no session, principal, scope grant or credential is accepted from it.
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
            |core, p, _| {
                let query = uri
                    .query()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if query.len() > 32_768 {
                    return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
                }
                let mut values = url::form_urlencoded::parse(query.as_bytes());
                let (name, value) = values
                    .next()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if name != "request" || values.next().is_some() || value.len() > 16_384 {
                    return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
                }
                let raw = intake::json(value.as_bytes())?;
                let contracts =
                    st::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
                let request = st::ValidatedRequest::parse(&contracts, raw.clone())
                    .map_err(super::stock_reads::http_error)?;
                let id = request.request_id();
                if request.is_mutation() {
                    return errors::response(st::StockError::CapabilityDenied, id);
                }
                match stock_dispatch::execute_with_downloads(
                    core,
                    p,
                    raw,
                    &host.atlas_download_handles,
                ) {
                    Ok(result) => Ok(json_response(result.wire)),
                    Err(error) => errors::response(error, id),
                }
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}

pub(super) fn command_response(
    core: &crate::app::Core,
    principal: &crate::app::RequestPrincipal,
    raw: serde_json::Value,
) -> HttpResult {
    let contracts = st::NativeStockContract::new().map_err(super::stock_reads::http_error)?;
    let request = st::ValidatedRequest::parse(&contracts, raw.clone())
        .map_err(super::stock_reads::http_error)?;
    let id = request.request_id();
    match stock_dispatch::execute(core, principal, raw) {
        Ok(result) => Ok(json_response(result.wire)),
        Err(error) => errors::response(error, id),
    }
}
