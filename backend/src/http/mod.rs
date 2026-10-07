//! Loopback TLS routes and browser DTO projection. No source/provider transport.
pub mod contracts;
mod headers;
mod response;
use crate::{
    access as a,
    app::{Core, HomeAuthority, Reads, RequestPrincipal},
    domain as d,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Request, State},
    http::{Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use headers::CheckedHeaders;
use response::{HttpFailure, ResponseIds, private_headers};
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
    response_ids: Arc<ResponseIds>,
}
impl Host {
    pub fn new(
        core: Core,
        origin: String,
        files: Arc<BTreeMap<String, (String, Vec<u8>)>>,
    ) -> crate::storage::Result<Self> {
        Ok(Self {
            core: Arc::new(Mutex::new(core)),
            origin,
            files,
            response_ids: Arc::new(ResponseIds::new()?),
        })
    }
}
type HttpResult = Result<Response, HttpFailure>;
fn failure(status: StatusCode) -> HttpFailure {
    HttpFailure::for_status(status)
}
fn access_error(error: a::AccessError) -> HttpFailure {
    HttpFailure::for_status(
        StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
    )
}
fn domain_error(error: d::DomainError) -> HttpFailure {
    use crate::contracts::ApiErrorCode as C;
    let (status, code) = match error {
        d::DomainError::Unauthenticated => (StatusCode::UNAUTHORIZED, C::Unauthenticated),
        d::DomainError::Forbidden => (StatusCode::FORBIDDEN, C::Forbidden),
        d::DomainError::NotFound => (StatusCode::NOT_FOUND, C::NotFound),
        d::DomainError::InvalidContract => (StatusCode::UNPROCESSABLE_ENTITY, C::InvalidContract),
        d::DomainError::RevisionRequired { .. } => {
            (StatusCode::PRECONDITION_REQUIRED, C::RevisionRequired)
        }
        d::DomainError::RevisionConflict { .. } => {
            (StatusCode::PRECONDITION_FAILED, C::RevisionConflict)
        }
        d::DomainError::GuardConflict { .. } => (StatusCode::PRECONDITION_FAILED, C::GuardConflict),
        d::DomainError::IdentityConflict => (StatusCode::CONFLICT, C::IdentityConflict),
        d::DomainError::IdempotencyConflict => (StatusCode::CONFLICT, C::IdempotencyConflict),
        d::DomainError::InvalidTransition => (StatusCode::CONFLICT, C::InvalidTransition),
        d::DomainError::UpstreamIncomplete => {
            (StatusCode::SERVICE_UNAVAILABLE, C::UpstreamIncomplete)
        }
        d::DomainError::UpstreamUnavailable => {
            (StatusCode::SERVICE_UNAVAILABLE, C::UpstreamUnavailable)
        }
    };
    HttpFailure {
        status,
        code,
        current_revision: error.current_revision(),
    }
}
async fn response_adapter(State(host): State<Host>, mut request: Request, next: Next) -> Response {
    let request_id = host.response_ids.next();
    let checked = CheckedHeaders::read(request.headers(), request.version()).and_then(|headers| {
        headers.check_authority(&host.origin, request.uri())?;
        Ok(headers)
    });
    let mut response = match checked {
        Ok(headers) => {
            request.extensions_mut().insert(headers);
            next.run(request).await
        }
        Err(error) => access_error(error).into_response(),
    };
    if response.status().is_client_error() || response.status().is_server_error() {
        let error = response
            .extensions()
            .get::<HttpFailure>()
            .cloned()
            .unwrap_or_else(|| HttpFailure::for_status(response.status()));
        let allow = response.headers().get(header::ALLOW).cloned();
        response = error.response(request_id);
        if let Some(allow) = allow {
            response.headers_mut().insert(header::ALLOW, allow);
        }
    }
    private_headers(&mut response);
    response
}
fn evidence<'a>(
    origin: &str,
    headers: &'a CheckedHeaders,
    uri: &Uri,
    url: &'a str,
    method: &Method,
) -> Result<a::RequestEvidence<'a>, a::AccessError> {
    headers.check_authority(origin, uri)?;
    Ok(a::RequestEvidence {
        method: match *method {
            Method::GET => a::Method::Get,
            Method::HEAD => a::Method::Head,
            Method::POST => a::Method::Post,
            _ => a::Method::Other,
        },
        url,
        origin: headers.origin.as_deref(),
        sec_fetch_site: headers.sec_fetch_site.as_deref(),
        referer: headers.referer.as_deref(),
        cookie: headers.cookie.as_deref(),
        authorization: headers.authorization.as_deref(),
        csrf: headers.csrf.as_deref(),
    })
}
fn prepared_view(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: Option<d::Scope>,
) -> Result<d::CurrentOutput, HttpFailure> {
    let mut core = host
        .core
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
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
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
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
            &crate::app::now().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
            &[],
        )
        .map_err(domain_error)
}
/// Deliberate narrow projection for AT10's browser wire proposal. Unimplemented
/// extension facts stay unknown/absent; the read-only graph excludes Network.
fn browser_view(view: d::CurrentOutput) -> Result<Value, HttpFailure> {
    let mut v = serde_json::to_value(view).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    for entry in v["entries"]
        .as_array_mut()
        .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
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
    Json(v).into_response()
}
async fn current(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        Ok(json_response(browser_view(prepared_view(
            &host, &headers, &uri, &method, None,
        )?)?))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn scoped(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
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
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn rooms(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(
            serde_json::to_value(view.rooms(false))
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        ))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn items(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(
            serde_json::to_value(view.items(false))
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        ))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn homes(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let view = prepared_view(&host, &headers, &uri, &method, None)?;
        Ok(json_response(
            serde_json::to_value(view.homes)
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
        ))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn session(
    State(host): State<Host>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let core = host.core.lock().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        let url = format!("{}{}", host.origin, uri.path_and_query().map_or("/", |p| p.as_str()));
        let info = core.access.lock().map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?.session_info(&evidence(&host.origin, &headers, &uri, &url, &method).map_err(access_error)?).map_err(access_error)?;
        let expires = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(info.expires_at_ms()) * 1_000_000).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?.format(&time::format_description::well_known::Rfc3339).map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        Ok(json_response(json!({"schemaVersion":1,"actorId":info.actor_id(),"csrfToken":info.csrf_token(),"expiresAt":expires})))
    }).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
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
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
    let mut response = bytes.clone().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        kind.parse()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
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
        .layer(middleware::from_fn_with_state(
            host.clone(),
            response_adapter,
        ))
        .with_state(host)
}
