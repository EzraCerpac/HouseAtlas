//! Loopback TLS routes and browser DTO projection. No source/provider transport.
pub mod contracts;
use crate::{
    access as a,
    app::{Core, HomeAuthority, Reads, RequestPrincipal},
    domain as d,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Host {
    pub core: Arc<Mutex<Core>>,
    pub origin: String,
    pub files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
}
type HttpResult = Result<Response, (StatusCode, Json<Value>)>;
fn failure(status: StatusCode, state: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({"status":state})))
}
fn access_error(error: a::AccessError) -> (StatusCode, Json<Value>) {
    failure(
        StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
        if error == a::AccessError::Unauthenticated {
            "expired"
        } else {
            "denied"
        },
    )
}
fn domain_error(error: d::DomainError) -> (StatusCode, Json<Value>) {
    let status = match error {
        d::DomainError::Unauthenticated => StatusCode::UNAUTHORIZED,
        d::DomainError::Forbidden => StatusCode::FORBIDDEN,
        d::DomainError::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    };
    failure(
        status,
        if status == StatusCode::UNAUTHORIZED {
            "expired"
        } else {
            "unavailable"
        },
    )
}
fn evidence<'a>(
    origin: &str,
    headers: &'a HeaderMap,
    uri: &Uri,
    url: &'a str,
    method: &Method,
) -> Result<a::RequestEvidence<'a>, a::AccessError> {
    let expected = origin
        .strip_prefix("https://")
        .ok_or(a::AccessError::Forbidden)?;
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let authority = uri.authority().map(|a| a.as_str());
    if host.or(authority) != Some(expected)
        || host.is_some_and(|host| host != expected)
        || authority.is_some_and(|authority| authority != expected)
        || uri.scheme_str().is_some_and(|scheme| scheme != "https")
    {
        return Err(a::AccessError::Forbidden);
    }
    let value = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    Ok(a::RequestEvidence {
        method: match *method {
            Method::GET => a::Method::Get,
            Method::HEAD => a::Method::Head,
            _ => a::Method::Other,
        },
        url,
        origin: value("origin"),
        sec_fetch_site: value("sec-fetch-site"),
        referer: value("referer"),
        cookie: value("cookie"),
        authorization: value("authorization"),
        csrf: None,
    })
}
fn prepared_view(
    host: &Host,
    headers: &HeaderMap,
    uri: &Uri,
    method: &Method,
    scope: Option<d::Scope>,
) -> Result<d::CurrentOutput, (StatusCode, Json<Value>)> {
    let mut core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?;
    let scope = scope.unwrap_or_else(|| core.home.scope.clone());
    let url = format!(
        "{}{}",
        host.origin,
        uri.path_and_query().map_or("/", |p| p.as_str())
    );
    let request = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let principal = core
        .access
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
        .authorize(
            &request,
            &crate::app::access_scope(&scope).map_err(access_error)?,
            a::Action::Read,
        )
        .map_err(access_error)?;
    let authority = HomeAuthority {
        access: Arc::clone(&core.access),
        home: core.home.clone(),
    };
    let mut queries = d::Queries {
        store: Reads(&mut core.store),
        access: authority,
    };
    queries
        .current(
            &RequestPrincipal::new(principal),
            &scope,
            &crate::app::now()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?,
            &[],
        )
        .map_err(domain_error)
}
/// Deliberate narrow projection for AT10's browser wire proposal. Unimplemented
/// extension facts stay unknown/absent; the read-only graph excludes Network.
fn browser_view(view: d::CurrentOutput) -> Result<Value, (StatusCode, Json<Value>)> {
    let mut v = serde_json::to_value(view)
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?;
    for entry in v["entries"]
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
    {
        entry["key"] = Value::String(
            json!([
                entry["source"]["sourceInstanceId"],
                entry["source"]["collectionId"],
                entry["source"]["sourceKind"],
                entry["source"]["externalId"]
            ])
            .to_string(),
        );
        entry["aliases"] = json!([]);
        entry["mobility"] = json!("unknown");
        entry["networkBound"] = json!(false);
        entry["networkStates"] = json!([]);
        entry["networkRelations"] = json!([]);
    }
    Ok(v)
}
fn json_response(v: Value) -> Response {
    let mut response = Json(v).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("constant header"),
    );
    response
}
async fn current(
    State(host): State<Host>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        Ok(json_response(browser_view(prepared_view(
            &host, &headers, &uri, &method, None,
        )?)?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn scoped(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        Ok(json_response(browser_view(prepared_view(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
        )?)?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn rooms(
    State(host): State<Host>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(
            serde_json::to_value(view.rooms(false))
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?,
        ))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn items(
    State(host): State<Host>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(
            serde_json::to_value(view.items(false))
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?,
        ))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn homes(
    State(host): State<Host>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(serde_json::to_value(view.homes).map_err(
            |_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
        )?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn session(
    State(host): State<Host>,
    headers: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let core = host.core.lock().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?;
        let url = format!("{}{}", host.origin, uri.path_and_query().map_or("/", |p| p.as_str()));
        let info = core.access.lock().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?.session_info(&evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?).map_err(access_error)?;
        let expires = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(info.expires_at_ms()) * 1_000_000).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?.format(&time::format_description::well_known::Rfc3339).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?;
        Ok(json_response(json!({"schemaVersion":1,"actorId":info.actor_id(),"csrfToken":info.csrf_token(),"expiresAt":expires})))
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?
}
async fn static_file(State(host): State<Host>, uri: Uri) -> HttpResult {
    if uri.path() == "/favicon.ico" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let key = if uri.path() == "/" {
        "/index.html"
    } else {
        uri.path()
    };
    let (kind, bytes) = host
        .files
        .get(key)
        .ok_or_else(|| failure(StatusCode::NOT_FOUND, "unavailable"))?;
    let mut response = bytes.clone().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        kind.parse()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?,
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("constant header"),
    );
    Ok(response)
}
pub fn router(host: Host) -> Router {
    Router::new()
        .route("/api/atlas/view", get(current))
        .route(
            "/api/atlas/homes/{workspace_id}/{home_id}/view",
            get(scoped),
        )
        .route("/api/atlas/rooms", get(rooms))
        .route("/api/atlas/items", get(items))
        .route("/api/atlas/homes", get(homes))
        .route("/api/atlas/auth/session", get(session))
        .fallback(get(static_file))
        .with_state(host)
}
