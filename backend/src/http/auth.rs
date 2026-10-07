//! Same-origin session transport over the actual access boundary.
use super::{
    CheckedHeaders, Host, HttpFailure, HttpResult, access_error, evidence, failure, headers,
    json_response,
};
use crate::access::{SessionInfo, SessionReceipt};
use axum::{
    body::to_bytes,
    extract::{ConnectInfo, Extension, Request, State},
    http::{HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use std::net::SocketAddr;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse<'a> {
    schema_version: crate::contracts::ConstInt<1>,
    actor_id: &'a str,
    csrf_token: &'a str,
    expires_at: String,
}
fn session_response(info: &SessionInfo) -> HttpResult {
    let expires_at = time::OffsetDateTime::from_unix_timestamp_nanos(
        i128::from(info.expires_at_ms()) * 1_000_000,
    )
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
    .format(&time::format_description::well_known::Rfc3339)
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    Ok(axum::Json(SessionResponse {
        schema_version: crate::contracts::ConstInt,
        actor_id: info.actor_id().as_str(),
        csrf_token: info.csrf_token(),
        expires_at,
    })
    .into_response())
}
fn receipt_response(receipt: SessionReceipt) -> HttpResult {
    let mut response = session_response(receipt.info())?;
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(receipt.set_cookie())
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
    );
    Ok(response)
}
fn url(host: &Host, uri: &Uri) -> String {
    format!(
        "{}{}",
        host.origin,
        uri.path_and_query().map_or("/", |p| p.as_str())
    )
}
fn no_query(uri: &Uri) -> Result<(), HttpFailure> {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    Ok(())
}
fn login_metadata(request: &Request) -> Result<(), HttpFailure> {
    let oversized = || failure(StatusCode::PAYLOAD_TOO_LARGE);
    if let Some(length) =
        headers::single(request.headers(), "content-length").map_err(|_| oversized())?
        && (length.is_empty()
            || !length.bytes().all(|b| b.is_ascii_digit())
            || length.parse::<u64>().map_err(|_| oversized())? > 4096)
    {
        return Err(oversized());
    }
    let unsupported = || failure(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let content_type = headers::single(request.headers(), "content-type")
        .map_err(|_| unsupported())?
        .ok_or_else(unsupported)?;
    let supported = match content_type.split_once(';') {
        None => content_type.eq_ignore_ascii_case("application/json"),
        Some((kind, charset)) => {
            kind.trim_end().eq_ignore_ascii_case("application/json")
                && charset.trim_start().eq_ignore_ascii_case("charset=utf-8")
        }
    };
    if !supported {
        return Err(unsupported());
    }
    Ok(())
}
pub(super) async fn login(
    State(host): State<Host>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    request: Request,
) -> HttpResult {
    no_query(request.uri())?;
    login_metadata(&request)?;
    let checked = request
        .extensions()
        .get::<CheckedHeaders>()
        .cloned()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    let uri = request.uri().clone();
    let method = request.method().clone();
    // Bound actual streamed bytes, independent of Content-Length claims. The
    // access peer separately validates its strict bounded login JSON.
    let body = to_bytes(request.into_body(), 4096)
        .await
        .map_err(|_| failure(StatusCode::PAYLOAD_TOO_LARGE))?;
    tokio::task::spawn_blocking(move || {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let request_url = url(&host, &uri);
        let observed =
            evidence(&host.origin, &checked, &uri, &request_url, &method).map_err(access_error)?;
        // The transport's actual connection IP is the client key; source ports
        // and forwarded metadata never establish a separate client identity.
        let receipt = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .login(&observed, &body, &address.ip().to_string())
            .map_err(access_error)?;
        receipt_response(receipt)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn session(
    State(host): State<Host>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    tokio::task::spawn_blocking(move || {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let request_url = url(&host, &uri);
        let observed =
            evidence(&host.origin, &checked, &uri, &request_url, &method).map_err(access_error)?;
        let info = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .session_info(&observed)
            .map_err(access_error)?;
        session_response(&info)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn session_head() -> Response {
    let mut response = HttpFailure::for_status(StatusCode::METHOD_NOT_ALLOWED).into_response();
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static("GET"));
    response
}
pub(super) async fn rotate(
    State(host): State<Host>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    tokio::task::spawn_blocking(move || {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let request_url = url(&host, &uri);
        let observed =
            evidence(&host.origin, &checked, &uri, &request_url, &method).map_err(access_error)?;
        let receipt = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .rotate_session(&observed)
            .map_err(access_error)?;
        receipt_response(receipt)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn logout(
    State(host): State<Host>,
    Extension(checked): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    tokio::task::spawn_blocking(move || {
        let core = host
            .core
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let request_url = url(&host, &uri);
        let observed =
            evidence(&host.origin, &checked, &uri, &request_url, &method).map_err(access_error)?;
        let cookie = core
            .access
            .lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
            .logout(&observed)
            .map_err(access_error)?;
        let mut response = json_response(serde_json::json!({"schemaVersion":1,"signedOut":true}));
        response.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        );
        Ok(response)
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
